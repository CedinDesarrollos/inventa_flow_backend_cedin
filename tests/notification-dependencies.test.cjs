const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NOTIFICATIONS_ENABLED = 'true';
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/unused';
process.env.SMTP_USER = 'synthetic@example.invalid';
process.env.SMTP_PASSWORD = 'synthetic-only';
process.env.SMTP_FROM = 'Test <synthetic@example.invalid>';

const nodemailer = require('nodemailer');
const originalTransport = nodemailer.createTransport;
const messages = [];
let smtpConfig;
nodemailer.createTransport = options => {
    smtpConfig = options;
    const transport = originalTransport({ streamTransport: true, buffer: true });
    return { sendMail: async message => { const result = await transport.sendMail(message); messages.push(result.message.toString()); return result; } };
};
const email = require('../dist/lib/email');
nodemailer.createTransport = originalTransport;

test('Nodemailer generates welcome/reset MIME using configured credentials without network', async () => {
    assert.equal(smtpConfig.auth.user, process.env.SMTP_USER);
    assert.equal(smtpConfig.auth.pass, process.env.SMTP_PASSWORD);
    assert.equal(await email.sendWelcomeEmail('patient@example.invalid', 'Synthetic', 'synthetic-user', 'synthetic-password'), true);
    assert.equal(await email.sendPasswordResetEmail('patient@example.invalid', 'Synthetic', 'https://example.invalid/reset-password?token=synthetic'), true);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /synthetic-user/);
    assert.match(messages[1], /reset-password/);
});

test('updated Baileys preserves database credentials and binary session keys', async () => {
    const { prisma } = require('../dist/lib/prisma');
    const { usePrismaAuthState } = require('../dist/services/notifications/providers/usePrismaAuthState');
    const store = new Map();
    const old = {};
    for (const method of ['findUnique', 'upsert', 'delete']) old[method] = prisma.baileysSession[method];
    prisma.baileysSession.findUnique = async ({ where }) => store.has(where.id) ? { data: store.get(where.id) } : null;
    prisma.baileysSession.upsert = async ({ where, create }) => { store.set(where.id, create.data); return {}; };
    prisma.baileysSession.delete = async ({ where }) => { store.delete(where.id); return {}; };
    try {
        const initial = await usePrismaAuthState();
        await initial.saveCreds();
        const reloaded = await usePrismaAuthState();
        assert.deepEqual(reloaded.state.creds.signedIdentityKey.public, initial.state.creds.signedIdentityKey.public);
        const binary = Buffer.from([1, 2, 3]);
        await initial.state.keys.set({ session: { 'synthetic-key': binary } });
        assert.deepEqual((await reloaded.state.keys.get('session', ['synthetic-key']))['synthetic-key'], binary);
        await initial.state.keys.set({ session: { 'synthetic-key': null } });
        assert.deepEqual(await reloaded.state.keys.get('session', ['synthetic-key']), {});
    } finally {
        Object.assign(prisma.baileysSession, old);
        await prisma.$disconnect();
    }
});

test('disabled staging notifications cannot initialize providers or send mail/messages', async () => {
    const previous = process.env.NOTIFICATIONS_ENABLED;
    process.env.NOTIFICATIONS_ENABLED = 'false';
    try {
        const count = messages.length;
        assert.equal(await email.sendWelcomeEmail('synthetic@example.invalid', 'Synthetic', 'synthetic', 'synthetic'), false);
        assert.equal(messages.length, count);
        const { NotificationService } = require('../dist/services/notifications/NotificationService');
        const service = new NotificationService();
        service.twilioProvider.initialize = async () => { throw new Error('Must not initialize'); };
        service.baileysProvider.initialize = async () => { throw new Error('Must not initialize'); };
        await service.initialize();
        await assert.rejects(service.sendMessage({patientId: 'synthetic', message: 'Synthetic'}), /disabled/);
    } finally { process.env.NOTIFICATIONS_ENABLED = previous; }
});
