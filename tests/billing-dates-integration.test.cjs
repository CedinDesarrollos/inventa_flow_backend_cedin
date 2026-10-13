const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const jwt = require('jsonwebtoken');
const { clinicDateRange, clinicShiftRange } = require('../dist/lib/clinic-dates');

test('clinic day and shift boundaries use Asuncion with exclusive ends', () => {
    const day = clinicDateRange('2026-10-12');
    assert.equal(day.gte.toISOString(), '2026-10-12T03:00:00.000Z');
    assert.equal(day.lt.toISOString(), '2026-10-13T03:00:00.000Z');
    assert.equal(clinicShiftRange('2026-10-12', 'MORNING').lt.toISOString(), '2026-10-12T17:00:00.000Z');
    assert.equal(clinicShiftRange('2026-10-12', 'AFTERNOON').gte.toISOString(), '2026-10-12T17:00:00.000Z');
    assert.equal(clinicDateRange('2024-07-01').gte.toISOString(), '2024-07-01T04:00:00.000Z');
    for (const args of [['2026-02-30'], ['2026-10-13', '2026-10-12'], ['invalid']]) assert.throws(() => clinicDateRange(...args), RangeError);
});

test('billing migrations preserve legacy data; settlement, concurrency and daily receipts reconcile', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const source = new URL(process.env.TEST_DATABASE_URL);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
    const name = `inventa_billing_dates_${process.pid}`;
    const admin = new Pool({ connectionString: source.toString() });
    let pool, prisma, server, created = false;
    try {
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        const url = new URL(source); url.pathname = '/' + name;
        pool = new Pool({ connectionString: url.toString() });
        const migrations = path.join(__dirname, '../prisma/migrations');
        await pool.query(readFileSync(path.join(migrations, '20261011000000_baseline/migration.sql'), 'utf8'));
        const legacyPatient = '10000000-0000-4000-8000-000000000001';
        const legacyAppointment = '10000000-0000-4000-8000-000000000002';
        const legacyTransaction = '10000000-0000-4000-8000-000000000003';
        await pool.query(`INSERT INTO inventa_clinical_app.patients (id, first_name, last_name, identifier, updated_at) VALUES ($1,'Synthetic','Legacy','legacy-qa',NOW())`, [legacyPatient]);
        await pool.query(`INSERT INTO inventa_clinical_app.appointments (id,patient_id,date,duration,type,payment_status,updated_at) VALUES ($1,$2,'2026-10-12 10:00',30,'CONSULTATION','PARTIAL',NOW())`, [legacyAppointment, legacyPatient]);
        await pool.query(`INSERT INTO inventa_clinical_app.transactions (id,patient_id,type,status,payment_method,subtotal,total,amount_paid,balance,created_at,updated_at) VALUES ($1,$2,'TICKET','COMPLETED','CASH',100,100,100,0,'1999-01-01',NOW())`, [legacyTransaction, legacyPatient]);
        for (const folder of readdirSync(migrations).sort().filter(folder => folder !== '20261011000000_baseline' && folder !== 'migration_lock.toml')) {
            const sql = readFileSync(path.join(migrations, folder, 'migration.sql'), 'utf8');
            await pool.query(sql); await pool.query(sql);
        }
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) }); global.prisma = prisma;
        process.env.JWT_SECRET = 'synthetic-billing-test'; process.env.DATABASE_URL = url.toString();
        const { app } = require('../dist/app'); server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const users = {};
        for (const role of ['ADMIN', 'SECRETARY', 'PROFESSIONAL']) users[role] = await prisma.user.create({ data: { role, email: `${role}@example.invalid`, fullName: `Synthetic ${role}`, passwordHash: 'synthetic-only' } });
        async function request(route, { role = 'SECRETARY', method = 'GET', body } = {}) {
            return fetch(base + route, { method, headers: { Authorization: 'Bearer ' + jwt.sign({ role, userId: users[role].id }, process.env.JWT_SECRET), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        }
        async function json(response, expected = 200) { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
        assert.equal((await prisma.transaction.findUnique({ where: { id: legacyTransaction } })).appointmentId, null);
        for (const role of ['SECRETARY', 'PROFESSIONAL']) assert.equal((await request(`/api/transactions/${legacyTransaction}/appointment`, { role, method: 'PATCH', body: { appointmentId: legacyAppointment } })).status, 403);
        for (let i = 0; i < 2; i++) await json(await request(`/api/transactions/${legacyTransaction}/appointment`, { role: 'ADMIN', method: 'PATCH', body: { appointmentId: legacyAppointment } }));
        assert.equal((await prisma.appointment.findUnique({ where: { id: legacyAppointment } })).paymentStatus, 'PAID');
        const patient = await prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Billing', identifier: 'billing-qa' } });
        const appointment = await json(await request('/api/appointments', { method: 'POST', body: { patientId: patient.id, doctorId: users.PROFESSIONAL.id, date: '2026-10-23T14:00:00.000Z', duration: 30, type: 'CONSULTATION' } }), 201);
        const payload = { patientId: patient.id, doctorId: users.PROFESSIONAL.id, appointmentId: appointment.id, type: 'TICKET', paymentMethod: 'CASH', subtotal: 100, savings: 0, total: 100, initialPayment: 25, items: [{ customDescription: 'Synthetic consultation', quantity: 1, unitPrice: 100, coverage: 0, copay: 100 }] };
        const { doctorId, ...linkedWithoutDoctor } = payload;
        const account = await json(await request('/api/transactions', { method: 'POST', body: linkedWithoutDoctor }), 201);
        assert.equal(account.doctorId, users.PROFESSIONAL.id);
        const initial = await prisma.payment.findFirst({ where: { transactionId: account.id } });
        await prisma.transaction.update({ where: { id: account.id }, data: { createdAt: new Date('2026-10-12T22:00:00.000Z') } });
        await prisma.payment.update({ where: { id: initial.id }, data: { createdAt: new Date('2026-10-12T22:00:00.000Z') } });
        const paid = await json(await request(`/api/transactions/${account.id}/payments`, { method: 'POST', body: { amount: 75, paymentMethod: 'CARD' } }));
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PAID');
        await prisma.payment.update({ where: { id: paid.payment.id }, data: { createdAt: new Date('2026-10-13T00:01:00.000Z') } });
        let report = await json(await request(`/api/transactions?cashFlow=true&patientId=${patient.id}&startDate=2026-10-12&endDate=2026-10-12`));
        assert.equal(report.length, 2); assert.equal(report.reduce((sum, row) => sum + Number(row.amountPaid), 0), 100);
        assert(report.some(row => row.createdAt === '2026-10-13T00:01:00.000Z'));
        await prisma.payment.update({ where: { id: paid.payment.id }, data: { createdAt: new Date('2026-10-13T17:00:00.000Z') } });
        report = await json(await request(`/api/transactions?cashFlow=true&patientId=${patient.id}&startDate=2026-10-12&endDate=2026-10-12`));
        assert.equal(report.reduce((sum, row) => sum + Number(row.amountPaid), 0), 25);
        report = await json(await request(`/api/transactions?cashFlow=true&patientId=${patient.id}&startDate=2026-10-13&endDate=2026-10-13`));
        assert.equal(report.length, 1); assert.equal(Number(report[0].amountPaid), 75);
        const morning = await json(await request('/api/cash-close?date=2026-10-13&shift=MORNING'));
        const afternoon = await json(await request('/api/cash-close?date=2026-10-13&shift=AFTERNOON'));
        assert.equal(morning.liveTotals.total, 0); assert.equal(afternoon.liveTotals.total, 75);
        assert.equal((await request('/api/transactions?startDate=invalid&endDate=invalid')).status, 400);
        assert.equal((await request('/api/cash-close?date=2026-02-30')).status, 400);
        assert.equal((await request('/api/transactions', { method: 'POST', body: { ...payload, patientId: legacyPatient } })).status, 400);
        const second = await json(await request('/api/transactions', { method: 'POST', body: { ...payload, total: 50, initialPayment: 0 } }), 201);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PARTIAL');
        const race = await Promise.all([1, 2].map(() => request(`/api/transactions/${second.id}/payments`, { method: 'POST', body: { amount: 50, paymentMethod: 'CASH' } })));
        assert.deepEqual(race.map(r => r.status).sort(), [200, 400]);
        assert.equal(await prisma.payment.count({ where: { transactionId: second.id } }), 1);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PAID');
        await json(await request(`/api/transactions/${account.id}/void`, { role: 'ADMIN', method: 'PATCH', body: {} }));
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PAID');
        await json(await request(`/api/transactions/${second.id}/void`, { role: 'ADMIN', method: 'PATCH', body: {} }));
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).paymentStatus, 'PENDING');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (prisma) await prisma.$disconnect(); if (pool) await pool.end(); delete global.prisma;
        if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
    }
});
