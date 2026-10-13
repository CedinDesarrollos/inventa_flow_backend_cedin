const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const { PrismaClient, Prisma } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

test('clinical workflow: real login, patient, appointment, partial/full payment, reports and upload persistence', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const source = new URL(process.env.TEST_DATABASE_URL);
    assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Disposable local database only');
    const admin = new Pool({ connectionString: source.toString() });
    const name = `inventa_workflow_${process.pid}`;
    const directory = mkdtempSync(path.join(os.tmpdir(), 'inventa-workflow-'));
    let pool, prisma, server, created = false;
    try {
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        const url = new URL(source); url.pathname = '/' + name;
        pool = new Pool({ connectionString: url.toString() });
        for (const migration of require('node:fs').readdirSync(path.join(__dirname, '../prisma/migrations')).sort()) {
            const file = path.join(__dirname, '../prisma/migrations', migration, 'migration.sql');
            if (require('node:fs').existsSync(file)) await pool.query(readFileSync(file, 'utf8'));
        }
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) }); global.prisma = prisma;
        Object.assign(process.env, { JWT_SECRET: 'synthetic-workflow-secret', DATABASE_URL: url.toString(), UPLOAD_DIR: directory, PUBLIC_URL: 'https://public.example.invalid', CORS_ORIGIN: 'https://admin.cedin.com.py' });
        const { app } = require('../dist/app');
        let base;
        async function start() { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
        await start();
        async function request(route, { method = 'GET', token, body, form } = {}) {
            return fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
        }
        async function json(response, status) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
        const users = await Promise.all(['ADMIN', 'SECRETARY', 'PROFESSIONAL', 'DEVELOPER'].map(async role => prisma.user.create({ data: { role, email: `${role.toLowerCase()}@example.invalid`, username: `synthetic.${role.toLowerCase()}`, fullName: `Synthetic ${role}`, passwordHash: await bcrypt.hash('Synthetic123!', 4), pinHash: await bcrypt.hash('654321', 4) } })));
        const tokens = {};
        for (const user of users) {
            const logged = await json(await request('/api/auth/login', { method: 'POST', body: { identifier: user.email, password: 'Synthetic123!' } }), 200);
            assert(logged.token); tokens[user.role] = logged.token;
        }
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { identifier: users[0].email, password: 'wrong' } })).status, 401);
        const patient = await json(await request('/api/patients', { method: 'POST', token: tokens.SECRETARY, body: { firstName: 'Synthetic', lastName: 'Workflow', identifier: 'synthetic-workflow' } }), 201);
        const found = await json(await request('/api/patients?search=synthetic-workflow', { token: tokens.SECRETARY }), 200);
        assert(found.some(row => row.id === patient.id));
        const appointment = await json(await request('/api/appointments', { method: 'POST', token: tokens.SECRETARY, body: { patientId: patient.id, doctorId: users[2].id, date: '2026-10-15T14:00:00.000Z', duration: 30, type: 'CONSULTATION' } }), 201);
        const profile = await prisma.professional.create({ data: { userId: users[2].id, firstName: 'Synthetic', lastName: 'Doctor', specialty: 'Medicina General', registrationNumber: 'QA-ONLY', email: users[2].email, color: 'blue' } });
        await prisma.clinicalRecord.create({ data: { patientId: patient.id, doctorId: users[2].id, content: { type: 'doc', content: [] } } });
        function noCredentialFields(value) {
            if (!value || typeof value !== 'object') return;
            for (const [key, nested] of Object.entries(value)) {
                assert(!['passwordHash', 'pinHash', 'resetToken'].includes(key), `Credential field exposed: ${key}`);
                noCredentialFields(nested);
            }
        }
        const registered = await json(await request('/api/auth/register', { method: 'POST', token: tokens.ADMIN, body: { email: 'synthetic-new@example.invalid', fullName: 'Synthetic registered user', password: 'Synthetic123!', role: 'SECRETARY' } }), 201);
        noCredentialFields(registered);
        for (const user of users) {
            const token = tokens[user.role];
            const agenda = await json(await request('/api/appointments?start=2026-10-15T00:00:00.000Z&end=2026-10-15T23:59:59.999Z', { token }), 200);
            assert.equal(agenda[0].doctor.fullName, users[2].fullName);
            assert.equal(agenda[0].doctor.professional.registrationNumber, 'QA-ONLY');
            const detail = await json(await request(`/api/patients/${patient.id}`, { token }), 200);
            assert.equal(detail.clinicalRecords[0].doctor.username, users[2].username);
            const professionals = await json(await request('/api/professionals', { token }), 200);
            assert.equal(professionals[0].id, profile.id);
            assert.equal(professionals[0].user.fullName, users[2].fullName);
            const available = await json(await request('/api/availability/professionals?date=2026-10-16T14:00:00.000Z&duration=30', { token }), 200);
            assert.equal(available[0].user.id, users[2].id);
            for (const body of [agenda, detail, professionals, available]) noCredentialFields(body);
        }
        await json(await request(`/api/appointments/${appointment.id}`, { method: 'PUT', token: tokens.PROFESSIONAL, body: { date: '2026-10-15T15:00:00.000Z' } }), 200);
        await json(await request(`/api/appointments/${appointment.id}/status`, { method: 'PATCH', token: tokens.PROFESSIONAL, body: { status: 'CONFIRMED' } }), 200);
        const transactionBody = { patientId: patient.id, doctorId: users[2].id, appointmentId: appointment.id, type: 'TICKET', paymentMethod: 'CASH', subtotal: 100, savings: 0, total: 100, initialPayment: 25, items: [{ customDescription: 'Synthetic consultation', quantity: 1, unitPrice: 100, coverage: 0, copay: 100 }] };
        const paymentStatusBefore = (await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus;
        for (const overrides of [
            { initialPayment: 101 }, { initialPayment: 100.001 }, { total: 0, initialPayment: 0.01 },
            { payments: [], initialPayment: 101 },
            { payments: [{ amount: 60, paymentMethod: 'CASH' }, { amount: 41, paymentMethod: 'CARD' }] },
            { total: 0.014, payments: [{ amount: 0.006, paymentMethod: 'CASH' }, { amount: 0.006, paymentMethod: 'CARD' }] },
            { payments: [{ amount: 0.001, paymentMethod: 'CASH' }] }
        ]) {
            await json(await request('/api/transactions', { method: 'POST', token: tokens.SECRETARY, body: { ...transactionBody, ...overrides } }), 400);
            assert.equal(await prisma.transaction.count(), 0, 'Rejected payment created a transaction');
            assert.equal(await prisma.transactionItem.count(), 0, 'Rejected payment created transaction items');
            assert.equal(await prisma.payment.count(), 0, 'Rejected payment created a receipt');
            assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, paymentStatusBefore);
        }
        for (const overrides of [
            { initialPayment: 100 }, { initialPayment: 0 },
            { total: 0.3, payments: [{ amount: 0.1, paymentMethod: 'CASH' }, { amount: 0.2, paymentMethod: 'CARD' }] },
            { total: 100, payments: [{ amount: 60, paymentMethod: 'CASH' }, { amount: 40, paymentMethod: 'CARD' }] },
            { total: 1.015, initialPayment: 0.015 }
        ]) {
            const { appointmentId, ...unlinkedBody } = transactionBody;
            const result = await json(await request('/api/transactions', { method: 'POST', token: tokens.PROFESSIONAL, body: { ...unlinkedBody, ...overrides } }), 201);
            const receipts = await prisma.payment.findMany({ where: { transactionId: result.id } });
            const receiptTotal = receipts.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
            assert.equal(receiptTotal.toFixed(2), Number(result.amountPaid).toFixed(2));
            assert.equal(Number(result.balance).toFixed(2), (Number(result.total) - Number(result.amountPaid)).toFixed(2));
            assert(Number(result.balance) >= 0);
            assert.equal(result.status, Number(result.balance) === 0 ? 'COMPLETED' : Number(result.amountPaid) > 0 ? 'PARTIAL' : 'PENDING');
            await prisma.transaction.delete({ where: { id: result.id } });
        }
        const transaction = await json(await request('/api/transactions', { method: 'POST', token: tokens.SECRETARY, body: transactionBody }), 201);
        assert.equal(transaction.appointmentId, appointment.id);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PARTIAL');
        assert.equal(Number(transaction.balance), 75);
        assert.equal(transaction.status, 'PARTIAL');
        const route = `/api/transactions/${transaction.id}/payments`;
        assert.equal((await request(route, { method: 'POST', token: tokens.PROFESSIONAL, body: { amount: 75, paymentMethod: 'CASH' } })).status, 403);
        assert.equal((await request(route, { method: 'POST', token: tokens.SECRETARY, body: { amount: 76, paymentMethod: 'CASH' } })).status, 400);
        assert.equal(await prisma.payment.count(), 1);
        const paid = await json(await request(route, { method: 'POST', token: tokens.SECRETARY, body: { amount: 75, paymentMethod: 'CARD' } }), 200);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PAID');
        assert.equal(Number(paid.transaction.balance), 0); assert.equal(paid.transaction.status, 'COMPLETED');
        assert.equal((await json(await request(route, { token: tokens.SECRETARY }), 200)).length, 2);
        await json(await request('/api/reports/kpis?startDate=2026-10-01&endDate=2026-10-31', { token: tokens.ADMIN }), 200);
        await json(await request(`/api/appointments/${appointment.id}/status`, { method: 'PATCH', token: tokens.SECRETARY, body: { status: 'CANCELLED' } }), 200);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'CANCELLED');
        const form = new FormData(); const content = '%PDF-1.4\nSynthetic test\n%%EOF';
        form.append('file', new Blob([content], { type: 'application/pdf' }), 'synthetic.pdf');
        const upload = await json(await request('/api/upload', { method: 'POST', token: tokens.SECRETARY, form }), 200);
        assert(upload.url.startsWith(process.env.PUBLIC_URL + '/uploads/'));
        await new Promise(resolve => server.close(resolve)); server = undefined;
        await start();
        assert.equal(await (await request('/uploads/' + upload.filename)).text(), content);
        assert.equal(await prisma.patient.count(), 1); assert.equal(await prisma.transaction.count(), 1);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (prisma) await prisma.$disconnect(); if (pool) await pool.end(); delete global.prisma;
        if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
        rmSync(directory, { recursive: true, force: true });
    }
});
