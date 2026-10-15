const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const jwt = require('jsonwebtoken');
const { validCashTotals, sameCashTotals } = require('../dist/services/cash-close-totals');

test('expected cash totals reject malformed amounts and compare at currency precision', () => {
    const totals = { total: 0.3, cash: 0.3, card: 0, insurance: 0 };
    for (const value of [null, {}, { ...totals, total: '0.3' }, { ...totals, cash: -1 }, { ...totals, card: NaN }, { ...totals, insurance: Infinity }]) assert.equal(validCashTotals(value), false);
    assert.equal(validCashTotals(totals), true);
    assert.equal(sameCashTotals({ ...totals, total: 0.1 + 0.2 }, totals), true);
    assert.equal(sameCashTotals({ ...totals, cash: 0.29 }, totals), false);
});

test('cash close validates totals and authenticated signer while preserving signed cuts', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const source = new URL(process.env.TEST_DATABASE_URL);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
    const name = `inventa_cash_totals_${process.pid}`;
    const admin = new Pool({ connectionString: source.toString() });
    let pool, prisma, server, created = false;
    try {
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        const url = new URL(source); url.pathname = '/' + name;
        pool = new Pool({ connectionString: url.toString() });
        const migrations = path.join(__dirname, '../prisma/migrations');
        for (const folder of readdirSync(migrations).sort().filter(folder => folder !== 'migration_lock.toml')) {
            await pool.query(readFileSync(path.join(migrations, folder, 'migration.sql'), 'utf8'));
        }
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) }); global.prisma = prisma;
        process.env.JWT_SECRET = 'synthetic-cash-totals-test'; process.env.DATABASE_URL = url.toString();
        const { app } = require('../dist/app'); server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const user = await prisma.user.create({ data: { role: 'SECRETARY', email: 'cash@example.invalid', fullName: 'Synthetic Cashier', passwordHash: 'synthetic-only' } });
        const secondSigner = await prisma.user.create({ data: { role: 'ADMIN', email: 'second@cash.invalid', fullName: 'Second Signer', passwordHash: 'synthetic-only' } });
        const secondToken = jwt.sign({ role: 'ADMIN', userId: secondSigner.id }, process.env.JWT_SECRET);
        const token = jwt.sign({ role: user.role, userId: user.id }, process.env.JWT_SECRET);
        async function request(route, body, authToken = token) {
            return fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + authToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        }
        async function json(response, expected = 200) { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
        const patient = await prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Cash', identifier: 'cash-totals-qa' } });
        // Account created on a prior day: only the receipt date determines the close.
        const account = await prisma.transaction.create({ data: { patientId: patient.id, type: 'TICKET', status: 'PARTIAL', paymentMethod: 'CASH', subtotal: 1000, total: 1000, amountPaid: 60.3, balance: 939.7, createdAt: new Date('2026-10-01T12:00:00Z') } });
        async function payment(amount, paymentMethod, date) {
            return prisma.payment.create({ data: { transactionId: account.id, amount, paymentMethod, createdBy: user.id, createdAt: new Date(date) } });
        }
        await payment(999, 'CASH', '2026-10-12T02:59:59Z'); // Previous clinic day.
        await payment(0.1, 'CASH', '2026-10-12T03:00:00Z');
        await payment(0.2, 'CASH', '2026-10-12T16:59:59Z');
        await payment(20, 'CARD', '2026-10-12T17:00:00Z'); // Exactly 14:00: afternoon only.
        await payment(40, 'INSURANCE', '2026-10-13T02:59:59Z');
        await payment(888, 'CASH', '2026-10-13T03:00:00Z'); // Next clinic day.
        const all = { total: 60.3, cash: 0.3, card: 20, insurance: 40 };
        const morning = { total: 0.3, cash: 0.3, card: 0, insurance: 0 };
        const afternoon = { total: 60, cash: 0, card: 20, insurance: 40 };
        const payload = { date: '2026-10-12', shift: 'ALL_DAY', role: 'CAJERO', note: 'Synthetic close' };
        const sign = (body, authToken) => request('/api/cash-close/sign', { ...payload, ...body }, authToken);
        for (const [shift, totals] of [['ALL_DAY', all], ['MORNING', morning], ['AFTERNOON', afternoon]]) {
            assert.deepEqual((await json(await request(`/api/cash-close?date=2026-10-12&shift=${shift}`))).liveTotals, totals);
        }
        for (const key of Object.keys(all)) {
            const mismatch = await json(await sign({ totals: { ...all, [key]: all[key] + 1 } }), 409);
            assert.equal(mismatch.code, 'CASH_CLOSE_TOTALS_CHANGED');
            assert.deepEqual(mismatch.liveTotals, all);
            assert.equal(await prisma.cashClose.count(), 0);
        }
        for (const totals of [{}, { ...all, cash: -1 }, { ...all, card: '20' }]) await json(await sign({ totals }), 400);
        for (const body of [{ date: '2026-02-30' }, { shift: 'INVALID' }]) await json(await sign(body), 400);
        const close = await json(await sign({ totals: all }));
        assert.equal(close.signatures[0].role, 'CAJERO');
        assert.deepEqual(close.signatures[0].snapshot, all);
        assert.equal(Number(close.totalAmount), all.total);
        assert.equal(Number(close.totalCash), all.cash);
        assert.equal(Number(close.totalCard), all.card);
        assert.equal(Number(close.totalInsurance), all.insurance);
        const laterPayment = await payment(5, 'CASH', '2026-10-12T12:00:00Z');
        const duplicate = await json(await sign({ totals: all }), 409);
        assert.equal(duplicate.code, 'CASH_CLOSE_ALREADY_SIGNED');
        await json(await sign({ totals: all }, secondToken), 409);
        const afterPayment = await json(await request('/api/cash-close?date=2026-10-12'));
        assert.deepEqual(afterPayment.subsequentPayments, { count: 1, totals: { total: 5, cash: 5, card: 0, insurance: 0 } });
        const unchanged = await prisma.cashClose.findUnique({ where: { id: close.id } });
        assert.equal(unchanged.signatures.length, 1);
        assert.equal(Number(unchanged.totalAmount), all.total);
        // Omitted/null totals remain compatible, but never supply the saved amounts.
        const updated = await json(await sign({}, secondToken));
        assert.equal(updated.id, close.id);
        assert.equal(updated.signatures.length, 2);
        assert.deepEqual(updated.signatures[0], close.signatures[0]);
        assert.deepEqual(updated.signatures[1].snapshot, { ...all, total: 65.3, cash: 5.3 });
        assert.equal(Number(updated.totalAmount), all.total);
        assert.equal(updated.closedAt, close.closedAt);
        assert.equal(updated.closedBy, close.closedBy);
        assert.equal(close.signatures[0].paymentSnapshot.length, 4);
        assert.equal(updated.signatures[1].paymentSnapshot.length, 5);
        assert(!close.signatures[0].paymentSnapshot.some(p => p.id === laterPayment.id));
        assert(updated.signatures[1].paymentSnapshot.some(p => p.id === laterPayment.id));
        assert.equal((await json(await request('/api/cash-close?date=2026-10-12'))).subsequentPayments.count, 0);
        for (const [shift, totals] of [['MORNING', { ...morning, total: 5.3, cash: 5.3 }], ['AFTERNOON', afternoon]]) {
            const signed = await json(await sign({ shift, totals }));
            assert.deepEqual(signed.signatures[0].snapshot, totals);
        }
        const empty = await json(await sign({ date: '2026-10-15', totals: null }));
        assert.deepEqual(empty.signatures[0].snapshot, { total: 0, cash: 0, card: 0, insurance: 0 });

        for (const [role, label] of [['SECRETARY', 'CAJERO'], ['PROFESSIONAL', 'MEDICO'], ['ADMIN', 'ADMIN'], ['DEVELOPER', 'DEVELOPER']]) {
            await t.test(`${role} signs only with its current account identity, even when the client claims another role`, async () => {
                const signer = await prisma.user.create({ data: { role, email: `${role}@cash.invalid`, fullName: `Synthetic ${role}`, passwordHash: 'synthetic-only' } });
                // Simulate a valid but outdated token that still claims ADMIN.
                const signerToken = jwt.sign({ role: 'ADMIN', userId: signer.id }, process.env.JWT_SECRET);
                const signed = await json(await request('/api/cash-close/sign', {
                    date: '2026-10-16', role: role === 'ADMIN' ? 'CAJERO' : 'ADMIN',
                    userId: user.id, name: 'Forged identity', note: 'Role check'
                }, signerToken));
                const signature = signed.signatures.at(-1);
                assert.equal(signature.role, label);
                assert.equal(signature.userId, signer.id);
                assert.equal(signature.name, signer.fullName);
                const saved = await prisma.cashClose.findUnique({ where: { id: signed.id } });
                assert.deepEqual(saved.signatures.at(-1), signature);
            });
        }
        await t.test('client role is optional and arbitrary payloads cannot change the signer role', async () => {
            let day = 17;
            for (const extra of [{}, { role: null }, { role: { ADMIN: true } }]) {
                const signed = await json(await request('/api/cash-close/sign', { date: `2026-10-${day++}`, note: 'Real role only', ...extra }));
                assert.equal(signed.signatures.at(-1).role, 'CAJERO');
                assert.equal(signed.signatures.at(-1).userId, user.id);
            }
            // A changed account role takes effect even with the old token and client role.
            await prisma.user.update({ where: { id: user.id }, data: { role: 'PROFESSIONAL' } });
            const signed = await json(await sign({ date: '2026-10-20', role: 'ADMIN' }));
            assert.equal(signed.signatures.at(-1).role, 'MEDICO');
            const original = await json(await request('/api/cash-close?date=2026-10-17'));
            assert.equal(original.close.signatures[0].role, 'CAJERO');
        });
        await t.test('simultaneous duplicate requests create one close and one signature', async () => {
            const responses = await Promise.all(Array.from({ length: 8 }, () => sign({ date: '2026-10-21' })));
            assert.deepEqual(responses.map(r => r.status).sort(), [200, 409, 409, 409, 409, 409, 409, 409]);
            for (const response of responses.filter(r => r.status === 409)) assert.equal((await response.json()).code, 'CASH_CLOSE_ALREADY_SIGNED');
            const closes = await prisma.cashClose.findMany({ where: { date: new Date('2026-10-21T00:00:00Z') } });
            assert.equal(closes.length, 1);
            assert.equal(closes[0].signatures.length, 1);
        });
        await t.test('different simultaneous signers are retained and retries do not overwrite evidence', async () => {
            const responses = await Promise.all([token, secondToken].map(auth => sign({ date: '2026-10-22' }, auth)));
            for (const response of responses) await json(response);
            const before = await prisma.cashClose.findFirst({ where: { date: new Date('2026-10-22T00:00:00Z') } });
            assert.equal(before.signatures.length, 2);
            assert.equal(new Set(before.signatures.map(s => s.userId)).size, 2);
            await json(await sign({ date: '2026-10-22', note: 'Must not replace', snapshot: { total: 999 } }), 409);
            const after = await prisma.cashClose.findUnique({ where: { id: before.id } });
            assert.deepEqual(after, before);
        });
        await t.test('historical cuts keep totals and signatures without inventing receipt evidence', async () => {
            const legacySignature = { userId: user.id, role: 'CAJERO', name: 'Historical', timestamp: '2026-10-23T10:00:00Z', note: 'Preserve me', snapshot: { total: 123, cash: 123, card: 0, insurance: 0 } };
            const legacy = await prisma.cashClose.create({ data: { date: new Date('2026-10-23T00:00:00Z'), closedBy: user.id, totalAmount: 123, totalCash: 123, signatures: [legacySignature] } });
            assert.equal((await json(await request('/api/cash-close?date=2026-10-23'))).subsequentPayments, null);
            await json(await sign({ date: '2026-10-23' }), 409);
            const signed = await json(await sign({ date: '2026-10-23' }, secondToken));
            assert.equal(Number(signed.totalAmount), 123);
            assert.equal(Number(signed.totalCash), 123);
            assert.equal(signed.closedAt, legacy.closedAt.toISOString());
            assert.deepEqual(signed.signatures[0], legacySignature);
            assert.deepEqual(signed.signatures[1].paymentSnapshot, []);
        });
        await t.test('an unsigned historical draft receives its first server-calculated cut', async () => {
            const draft = await prisma.cashClose.create({ data: { date: new Date('2026-10-24T00:00:00Z'), closedBy: user.id, totalAmount: 999, totalCash: 999 } });
            const signed = await json(await sign({ date: '2026-10-24' }, secondToken));
            assert.equal(signed.id, draft.id);
            assert.equal(Number(signed.totalAmount), 0);
            assert.equal(signed.closedBy, secondSigner.id);
            assert.equal(signed.signatures.length, 1);
            await json(await sign({ date: '2026-10-24' }, secondToken), 409);
            assert.equal((await prisma.cashClose.findUnique({ where: { id: draft.id } })).signatures.length, 1);
        });
        await t.test('unauthenticated, inactive and deleted accounts cannot add signatures', async () => {
            const count = await prisma.cashClose.count();
            const body = { date: '2026-10-18', role: 'ADMIN', note: 'Must not save' };
            await json(await request('/api/cash-close/sign', body, ''), 401);
            await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
            await json(await request('/api/cash-close/sign', body), 401);
            const missing = await prisma.user.create({ data: { role: 'ADMIN', email: 'deleted@cash.invalid', fullName: 'Deleted', passwordHash: 'synthetic-only' } });
            const missingToken = jwt.sign({ role: 'ADMIN', userId: missing.id }, process.env.JWT_SECRET);
            await prisma.user.delete({ where: { id: missing.id } });
            await json(await request('/api/cash-close/sign', body, missingToken), 401);
            assert.equal(await prisma.cashClose.count(), count);
        });
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (prisma) await prisma.$disconnect(); if (pool) await pool.end(); delete global.prisma;
        if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
    }
});
