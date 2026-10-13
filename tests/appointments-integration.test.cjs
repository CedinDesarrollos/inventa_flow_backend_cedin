const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const jwt = require('jsonwebtoken');

test('real PostgreSQL enforces own-agenda access while preserving authorized operations', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const source = new URL(process.env.TEST_DATABASE_URL);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
    const name = `inventa_access_${process.pid}`;
    const admin = new Pool({ connectionString: source.toString() });
    let pool, prisma, server, created = false;
    try {
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        const url = new URL(source); url.pathname = '/' + name;
        pool = new Pool({ connectionString: url.toString() });
        await pool.query(readFileSync(require('node:path').join(__dirname, '../prisma/migrations/20261011000000_baseline/migration.sql'), 'utf8'));
        // Inject a local test adapter; production TLS configuration is unchanged.
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
        global.prisma = prisma;
        process.env.JWT_SECRET = 'integration-test-secret';
        process.env.DATABASE_URL = url.toString();
        const { app } = require('../dist/app');
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const doctors = await Promise.all(['one', 'two'].map(key => prisma.user.create({ data: {
            email: `${key}@example.invalid`, fullName: `Synthetic ${key}`, passwordHash: 'not-a-real-password', role: 'PROFESSIONAL'
        } })));
        const patient = await prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Patient', identifier: 'synthetic-only' } });
        function auth(userId, role = 'PROFESSIONAL') { return jwt.sign({ userId, role }, process.env.JWT_SECRET); }
        async function request(path, { method = 'GET', token, body } = {}) {
            return fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        }
        const own = auth(doctors[0].id), other = auth(doctors[1].id);
        const body = { patientId: patient.id, date: '2026-10-12T10:00:00.000Z', duration: 20, type: 'CONSULTATION' };
        const response = await request('/api/appointments', { method: 'POST', token: own, body });
        assert.equal(response.status, 201);
        const appointment = await response.json();
        assert.equal(appointment.doctorId, doctors[0].id);
        assert.equal((await request('/api/appointments', { method: 'POST', token: own, body })).status, 409);
        const range = '?start=2026-10-01T00:00:00.000Z&end=2026-10-31T23:59:59.999Z';
        assert.equal((await (await request('/api/appointments' + range, { token: own })).json()).length, 1);
        assert.deepEqual(await (await request('/api/appointments' + range, { token: other })).json(), []);
        assert.equal((await request(`/api/appointments/${appointment.id}`, { method: 'PUT', token: other, body: { notes: 'forbidden' } })).status, 403);
        assert.equal((await request(`/api/appointments/${appointment.id}`, { method: 'PUT', token: own, body: { notes: 'authorized' } })).status, 200);
        assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).notes, 'authorized');
        const adminToken = auth(doctors[0].id, 'ADMIN');
        async function edit(data, expected = 200) {
            const response = await request(`/api/appointments/${appointment.id}`, { method: 'PUT', token: own, body: data });
            assert.equal(response.status, expected);
            return prisma.appointment.findUnique({ where: { id: appointment.id } });
        }
        let updated = await edit({ date: '2026-10-12T17:00:00.000Z' });
        assert.equal(updated.endDate.toISOString(), '2026-10-12T17:20:00.000Z');
        updated = await edit({ duration: 30 });
        assert.equal(updated.endDate.toISOString(), '2026-10-12T17:30:00.000Z');
        updated = await edit({ date: '2026-10-12T18:00:00.000Z', duration: 40 });
        assert.equal(updated.endDate.toISOString(), '2026-10-12T18:40:00.000Z');
        const blocker = await prisma.appointment.create({ data: { ...body, date: new Date('2026-10-12T19:00:00.000Z'), doctorId: doctors[0].id, endDate: null } });
        updated = await edit({ date: '2026-10-12T18:50:00.000Z' }, 409);
        assert.equal(updated.date.toISOString(), '2026-10-12T18:00:00.000Z');
        await edit({ date: '2026-10-12T18:20:00.000Z' }); // Exact boundary at 19:00 is allowed.
        const otherBlocker = await prisma.appointment.create({ data: { ...body, date: new Date('2026-10-12T18:20:00.000Z'), doctorId: doctors[1].id } });
        assert.equal((await request(`/api/appointments/${appointment.id}`, { method: 'PUT', token: adminToken, body: { doctorId: doctors[1].id } })).status, 409);
        await edit({ date: '2026-10-12T18:20:00.000Z' }); // Excludes itself.
        updated = await edit({ date: '2026-10-12T19:00:00.000Z', isOverbooking: true });
        assert.equal(updated.isOverbooking, true);
        updated = await edit({ notes: 'keep-overbooking' });
        assert.equal(updated.isOverbooking, true);
        assert.equal(updated.endDate.toISOString(), '2026-10-12T19:40:00.000Z');
        await edit({ isOverbooking: false }, 409);
        await edit({ duration: 0 }, 400);
        await edit({ duration: Number.MAX_SAFE_INTEGER }, 400);
        await edit({ date: 'invalid' }, 400);
        assert.equal((await request('/api/appointments/missing', { method: 'PUT', token: adminToken, body: { notes: 'test' } })).status, 404);
        const cancelled = await prisma.appointment.create({ data: { ...body, date: new Date('2026-10-12T20:00:00.000Z'), doctorId: doctors[0].id, status: 'CANCELLED' } });
        await edit({ date: '2026-10-12T20:00:00.000Z', isOverbooking: false });
        // A stale endDate must not hide a legacy conflict either.
        await prisma.appointment.update({ where: { id: blocker.id }, data: { endDate: new Date('2026-10-12T18:00:00.000Z') } });
        await edit({ date: '2026-10-12T19:00:00.000Z' }, 409);
        // Walk-in remains an explicit exception to scheduled overlap checks.
        await edit({ date: '2026-10-12T19:00:00.000Z', status: 'CONFIRMED' });
        // Two normal concurrent creates for one doctor/time: exactly one succeeds.
        const race = await Promise.all([1, 2].map(() => request('/api/appointments', { method: 'POST', token: own, body: { ...body, date: '2026-10-12T21:00:00.000Z' } })));
        assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
        const winning = await race.find(r => r.status === 201).json();
        const later = await prisma.appointment.create({ data: { ...body, date: new Date('2026-10-12T22:00:00.000Z'), doctorId: doctors[0].id } });
        const rescheduleRace = await Promise.all([winning.id, later.id].map(id => request(`/api/appointments/${id}`, { method: 'PUT', token: own, body: { date: '2026-10-12T23:00:00.000Z' } })));
        assert.deepEqual(rescheduleRace.map(r => r.status).sort(), [200, 409]);
        await prisma.appointment.deleteMany({ where: { id: { in: [blocker.id, otherBlocker.id, cancelled.id, winning.id, later.id] } } });
        assert.equal((await request(`/api/appointments/${appointment.id}/status`, { method: 'PATCH', token: own, body: { status: 'CONFIRMED' } })).status, 200);
        assert.equal((await request(`/api/appointments/${appointment.id}`, { method: 'DELETE', token: other })).status, 403);
        assert.equal((await request(`/api/appointments/${appointment.id}`, { method: 'DELETE', token: auth(doctors[1].id, 'SECRETARY') })).status, 204);
        assert.equal(await prisma.appointment.count(), 0);
        assert.equal((await request('/api/db-check', { token: auth(doctors[0].id, 'ADMIN') })).status, 200);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (prisma) await prisma.$disconnect();
        if (pool) await pool.end();
        delete global.prisma;
        if (created) await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
    }
});
