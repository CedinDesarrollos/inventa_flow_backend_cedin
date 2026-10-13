const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:65432/unused';
const { app } = require('../dist/app');
const { prisma } = require('../dist/lib/prisma');
const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const patient = '33333333-3333-4333-8333-333333333333';
let server, base, calls;
const original = [];
function mock(model, method, fn) {
    original.push([prisma[model], method, prisma[model][method]]);
    prisma[model][method] = fn;
}
function token(role = 'ADMIN', options = {}, payload = {}) {
    return jwt.sign({ userId: own, role, email: 'test@example.invalid', ...payload }, process.env.JWT_SECRET, options);
}
function request(path, { method = 'GET', auth, body } = {}) {
    return fetch(base + path, { method, headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    for (const [object, key, value] of original.splice(0).reverse()) object[key] = value;
    calls = [];
    original.push([prisma, '$transaction', prisma.$transaction]);
    original.push([prisma, '$executeRaw', prisma.$executeRaw]);
    original.push([prisma, '$queryRaw', prisma.$queryRaw]);
    prisma.$transaction = async callback => callback(prisma);
    prisma.$executeRaw = async () => 1;
    prisma.$queryRaw = async () => [];
    mock('appointment', 'findMany', async args => { calls.push(args); return []; });
    mock('appointment', 'findUnique', async () => ({ doctorId: own, date: new Date('2026-10-12T10:00:00.000Z'), duration: 20, status: 'SCHEDULED', isOverbooking: false }));
    mock('appointment', 'findFirst', async () => null);
    mock('appointment', 'create', async args => { calls.push(args); return args.data; });
    mock('appointment', 'update', async args => { calls.push(args); return args.data; });
    mock('appointment', 'delete', async args => { calls.push(args); return {}; });
    mock('appointment', 'updateMany', async args => { calls.push(args); return { count: 0 }; });
});
after(async () => {
    for (const [object, key, value] of original.splice(0).reverse()) object[key] = value;
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
});

const appointmentOperations = [
    ['GET', '/api/appointments'], ['POST', '/api/appointments'],
    ['PUT', '/api/appointments/existing'], ['PATCH', '/api/appointments/existing/status'],
    ['DELETE', '/api/appointments/existing'], ['POST', '/api/appointments/close-agenda']
];
for (const [method, path] of appointmentOperations) {
    test(`${method} ${path} rejects missing, invalid and expired tokens`, async () => {
        for (const auth of [undefined, 'invalid', token('ADMIN', { expiresIn: -1 })]) {
            const response = await request(path, { method, auth, ...(method !== 'GET' ? { body: {} } : {}) });
            assert.equal(response.status, 401);
        }
        assert.equal(calls.length, 0);
    });
}
for (const path of ['/api/availability/slots', '/api/clinical-records/patient', '/api/reports/kpis', '/api/upload', '/api/reminders/stats', '/api/whatsapp/status', '/api/patients', '/api/costs', '/api/transactions/existing/payments', '/api/db-check']) {
    test(`${path} requires authentication`, async () => {
        const response = await request(path, { ...(path === '/api/upload' ? { method: 'POST', body: {} } : {}) });
        assert.equal(response.status, 401);
    });
}
test('health is public and CORS preflight succeeds without authentication', async () => {
    const response = await request('/api/health');
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.status, 'ok');
    assert.deepEqual(Object.keys(health).sort(), ['status', 'timestamp']);
    const cors = await fetch(base + '/api/appointments', { method: 'OPTIONS', headers: {
        Origin: 'https://inventaflowfrontendcedin-production.up.railway.app',
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization,Content-Type'
    } });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get('access-control-allow-origin'), 'https://inventaflowfrontendcedin-production.up.railway.app');
});
test('login remains public; public registration and professional registration are rejected', async () => {
    assert.equal((await request('/api/auth/login', { method: 'POST', body: {} })).status, 400);
    assert.equal((await request('/api/auth/register', { method: 'POST', body: {} })).status, 401);
    assert.equal((await request('/api/auth/register', { method: 'POST', auth: token('PROFESSIONAL'), body: {} })).status, 403);
    assert.equal((await request('/api/auth/register', { method: 'POST', auth: token('ADMIN'), body: {} })).status, 400);
});
test('unknown roles and JWT payloads without identity cannot access appointments', async () => {
    assert.equal((await request('/api/appointments', { auth: token('UNKNOWN') })).status, 403);
    const noIdentity = jwt.sign({ role: 'PROFESSIONAL' }, process.env.JWT_SECRET);
    assert.equal((await request('/api/appointments', { auth: noIdentity })).status, 401);
});
test('all supported roles can read appointments and professionals are scoped automatically', async () => {
    for (const role of ['ADMIN', 'DEVELOPER', 'SECRETARY', 'PROFESSIONAL']) {
        assert.equal((await request('/api/appointments', { auth: token(role) })).status, 200);
        assert.equal(calls.at(-1).where.doctorId, role === 'PROFESSIONAL' ? own : undefined);
    }
    assert.equal((await request(`/api/appointments?doctorId=${other}`, { auth: token('PROFESSIONAL') })).status, 403);
});
test('professionals create appointments only in their own agenda', async () => {
    const body = { patientId: patient, date: '2026-10-12T10:00:00.000Z', duration: 20, type: 'CONSULTATION' };
    assert.equal((await request('/api/appointments', { method: 'POST', auth: token('PROFESSIONAL'), body })).status, 201);
    assert.equal(calls.at(-1).data.doctorId, own);
    assert.equal((await request('/api/appointments', { method: 'POST', auth: token('PROFESSIONAL'), body: { ...body, doctorId: other } })).status, 403);
});
test('ownership checks cover update, status and delete, including missing appointments', async () => {
    for (const [method, path, body] of [
        ['PUT', '/api/appointments/existing', { notes: 'test' }],
        ['PATCH', '/api/appointments/existing/status', { status: 'CONFIRMED' }],
        ['DELETE', '/api/appointments/existing', undefined]
    ]) {
        mock('appointment', 'findUnique', async () => ({ doctorId: other, date: new Date('2026-10-12T10:00:00.000Z'), duration: 20, status: 'SCHEDULED', isOverbooking: false }));
        assert.equal((await request(path, { method, auth: token('PROFESSIONAL'), body })).status, 403);
        mock('appointment', 'findUnique', async () => null);
        assert.equal((await request(path, { method, auth: token('PROFESSIONAL'), body })).status, 404);
        mock('appointment', 'findUnique', async () => ({ doctorId: own, date: new Date('2026-10-12T10:00:00.000Z'), duration: 20, status: 'SCHEDULED', isOverbooking: false }));
        assert.equal((await request(path, { method, auth: token('PROFESSIONAL'), body })).status, method === 'DELETE' ? 204 : 200);
    }
    assert.equal((await request('/api/appointments/existing', { method: 'PUT', auth: token('PROFESSIONAL'), body: { doctorId: other } })).status, 403);
});
test('professionals cannot close every doctor agenda by omitting doctorId', async () => {
    assert.equal((await request('/api/appointments/close-agenda', { method: 'POST', auth: token('PROFESSIONAL'), body: {} })).status, 200);
    assert.equal(calls.at(-1).where.doctorId, own);
    assert.equal((await request('/api/appointments/close-agenda', { method: 'POST', auth: token('PROFESSIONAL'), body: { doctorId: other } })).status, 403);
});
test('payment and cost authorization does not leak into medication routes', async () => {
    mock('medicationCatalog', 'findMany', async () => []);
    mock('payment', 'findMany', async () => []);
    mock('costCategory', 'findMany', async () => []);
    assert.equal((await request('/api/medications', { auth: token('PROFESSIONAL') })).status, 200);
    assert.equal((await request('/api/transactions/existing/payments', { auth: token('SECRETARY') })).status, 200);
    assert.equal((await request('/api/transactions/existing/payments', { method: 'POST', auth: token('PROFESSIONAL'), body: {} })).status, 403);
    assert.equal((await request('/api/cost-categories', { auth: token('SECRETARY') })).status, 403);
    assert.equal((await request('/api/cost-categories', { auth: token('ADMIN') })).status, 200);
    assert.equal((await request('/api/db-check', { auth: token('PROFESSIONAL') })).status, 403);
});
test('non-administrators cannot create users, change roles or reset other passwords', async () => {
    for (const role of ['PROFESSIONAL', 'SECRETARY']) {
        for (const [method, path] of [['POST', '/api/users'], ['PUT', '/api/users/existing'], ['DELETE', '/api/users/existing'], ['POST', '/api/users/existing/reset-password']]) {
            assert.equal((await request(path, { method, auth: token(role), body: { role: 'ADMIN' } })).status, 403);
        }
    }
    for (const role of ['ADMIN', 'DEVELOPER']) {
        assert.equal((await request('/api/users', { method: 'POST', auth: token(role), body: {} })).status, 400);
    }
});

test('initial and split overpayments are rejected before opening a database transaction', async () => {
    let writes = 0;
    prisma.$transaction = async () => { writes++; throw new Error('Unexpected write'); };
    const body = { patientId: patient, type: 'TICKET', paymentMethod: 'CASH', subtotal: 100, savings: 0, total: 100, items: [] };
    for (const extra of [
        { initialPayment: 101 },
        { payments: [{ amount: 60, paymentMethod: 'CASH' }, { amount: 41, paymentMethod: 'CARD' }] },
        { total: 0.014, payments: [{ amount: 0.006, paymentMethod: 'CASH' }, { amount: 0.006, paymentMethod: 'CARD' }] }
    ]) {
        const response = await request('/api/transactions', { method: 'POST', auth: token('PROFESSIONAL'), body: { ...body, ...extra } });
        assert.equal(response.status, 400);
    }
    assert.equal(writes, 0);
});
