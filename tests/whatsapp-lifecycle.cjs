// Tests execute the compiled production modules with isolated transports and persistence.
// No patient data, database connection, or actual WhatsApp/Twilio traffic is used.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
const originalTimeout = global.setTimeout;
const originalClear = global.clearTimeout;
const originalConsole = { ...console };
const baseline = process.listenerCount('uncaughtException');
const sockets = [];
const timers = new Set();
let authGate = null;
let failAuth = false;
let dbWipes = 0;
let credentialsSaved = 0;
let maxLiveSockets = 0;
let twilioClients = 0;
const twilioMessages = [];
const messages = [];
const notifications = [];
const reminderUpdates = [];
const reminderLogs = [];
const patient = { id: 'test-patient', firstName: 'Test', lastName: 'Patient', phone: '595000000001', identifier: 'TEST' };
const conversation = { id: 'test-conversation', patientId: patient.id };
const appointment = { id: 'test-appointment', date: new Date('2027-01-01T12:00:00Z'), reminders: [{ id: 'test-reminder', createdAt: new Date() }] };
let relationship = null;
const prisma = {
  systemSetting: { findUnique: async () => null },
  patient: { findFirst: async () => patient, findUnique: async () => patient },
  conversation: { findFirst: async () => conversation, update: async () => conversation },
  patientRelationship: { findFirst: async () => relationship },
  appointment: { findFirst: async () => appointment, update: async ({ data }) => Object.assign(appointment, data) },
  appointmentReminder: { update: async ({ data }) => reminderUpdates.push(data) },
  conversationMessage: { create: async ({ data }) => { messages.push(data); return data; }, updateMany: async () => ({ count: 1 }) },
  notificationLog: { create: async ({ data }) => reminderLogs.push(data) },
  baileysSession: { deleteMany: async () => { dbWipes++; } },
};
const makeSocket = options => {
  const ev = new EventEmitter();
  const socket = {
    ev, options, ended: false, sent: [], reads: [],
    user: { id: '595000000002:1@s.whatsapp.net' },
    end() { this.ended = true; ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } }); },
    async logout() { this.loggedOut = true; this.end(); },
    async sendMessage(jid, data) { this.sent.push({ jid, data }); return { key: { id: 'manual-message' } }; },
    async readMessages(keys) { this.reads.push(keys); },
  };
  sockets.push(socket);
  maxLiveSockets = Math.max(maxLiveSockets, sockets.filter(s => !s.ended).length);
  return socket;
};
const authState = async () => {
  if (failAuth) throw new Error('simulated auth database failure');
  if (authGate) await authGate;
  return { state: { creds: {}, keys: {} }, saveCreds: async () => { credentialsSaved++; } };
};
Module._load = function(request, parent, isMain) {
  if (request === '@whiskeysockets/baileys') return { __esModule: true, default: makeSocket, DisconnectReason: { loggedOut: 401, timedOut: 408, restartRequired: 515 }, downloadMediaMessage: async () => Buffer.from('media') };
  if (request.endsWith('/usePrismaAuthState')) return { usePrismaAuthState: authState };
  if (request.endsWith('/lib/prisma')) return { prisma };
  if (request.endsWith('/nps/NpsService')) return { NpsService: class { async handleIncomingMessage() { return false; } } };
  if (request === './notification.controller') return { createNotification: async data => notifications.push(data) };
  if (request === 'twilio') return () => {
    twilioClients++;
    return { messages: { create: async data => { twilioMessages.push(data); return { sid: 'test-twilio-message' }; } } };
  };
  return originalLoad.apply(this, arguments);
};
global.setTimeout = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; };
global.clearTimeout = timer => timers.delete(timer);
for (const key of ['log', 'warn', 'error']) console[key] = () => {};
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-only';
process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+595000000002';
process.env.PUBLIC_URL = 'https://example.test';
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
const advance = async () => {
  assert.equal(timers.size, 1, 'only one reconnect timer');
  const timer = [...timers][0];
  timers.delete(timer);
  timer.callback();
  await settle();
  return timer.delay;
};
const emitClose = (socket, reason = 405) => socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: reason } } } });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } });
(async () => {
  const { BaileysProvider } = require(path.join(root, 'dist/services/notifications/providers/BaileysProvider'));
  const { notificationService } = require(path.join(root, 'dist/services/notifications/NotificationService'));
  const { handleTwilioIncoming, handleTwilioStatus } = require(path.join(root, 'dist/controllers/webhook.controller'));
  const whatsappController = require(path.join(root, 'dist/controllers/whatsapp.controller'));
  for (let i = 0; i < 100; i++) new BaileysProvider();
  assert.equal(process.listenerCount('uncaughtException'), baseline, 'unused providers do not retain process listeners');

  // Exercise the real controller and service: 300 automatic responses retain no WhatsApp instance.
  const expected = { confirm_yes: ['CONFIRMED', 'confirmed'], confirm_cancel: ['CANCELLED', 'cancelled'], confirm_reschedule: ['CONFIRMED', 'rescheduled'] };
  for (let i = 0; i < 300; i++) {
    const payload = Object.keys(expected)[i % 3];
    const res = response();
    await handleTwilioIncoming({ body: { From: 'whatsapp:+595000000001', ButtonPayload: payload } }, res);
    assert.equal(res.code, 200);
    if (payload !== 'confirm_reschedule') assert.equal(appointment.status, expected[payload][0]);
    assert.equal(reminderUpdates.at(-1).status, expected[payload][1]);
    assert.equal(twilioMessages.length, i + 1);
    assert.equal(messages.at(-2).provider, 'twilio');
  }
  assert.equal(notifications.length, 300, 'staff notifications are preserved');
  assert.equal(twilioClients, 1, 'one lazily initialized Twilio client');
  assert.equal(sockets.length, 0, 'Twilio automatic responses do not open WhatsApp');
  assert.equal(process.listenerCount('uncaughtException'), baseline);
  for (const text of ['confirmo', 'cancelar', 'reagendar']) {
    const res = response();
    await handleTwilioIncoming({ body: { From: 'whatsapp:+595000000001', Body: text } }, res);
    assert.equal(res.code, 200);
  }
  relationship = { relative: { phone: '595000000099', firstName: 'Guardian' } };
  await notificationService.sendAppointmentReminder({ patientId: patient.id, appointmentId: appointment.id, templateId: 'HXtest', patientName: 'Test', date: '01/01/2027', time: '09:00', doctorName: 'Doctor', branchName: 'Clinic' });
  assert.equal(twilioMessages.at(-1).to, 'whatsapp:595000000099');
  assert.equal(twilioMessages.at(-1).contentSid, 'HXtest');
  assert.deepEqual(JSON.parse(twilioMessages.at(-1).contentVariables), { '1': 'Test', '2': '01/01/2027', '3': '09:00', '4': 'Doctor', '5': 'Clinic' });
  assert.equal(reminderLogs.at(-1).status, 'SENT');
  relationship = null;
  await notificationService.sendMessage({ patientId: patient.id, userId: 'test-doctor', message: 'fallback' });
  assert.equal(twilioMessages.at(-1).body, 'fallback', 'manual fallback to Twilio remains');
  assert.equal(sockets.length, 0);
  const statusResponse = response();
  await handleTwilioStatus({ body: { MessageSid: 'test', MessageStatus: 'read' } }, statusResponse);
  assert.equal(statusResponse.code, 200);

  // Concurrent reconnects share a socket. Manual WhatsApp does not depend on Twilio configuration.
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  const reconnectResponses = Array.from({ length: 30 }, response);
  await Promise.all(reconnectResponses.map(res => whatsappController.reconnect({}, res)));
  assert.ok(reconnectResponses.every(res => res.code === 200));
  assert.equal(sockets.length, 1);
  assert.equal(process.listenerCount('uncaughtException'), baseline + 1);
  const manual = sockets.at(-1);
  manual.ev.emit('connection.update', { qr: 'test-qr' });
  assert.equal((await notificationService.getBaileysStatus()).status, 'waiting_qr');
  manual.ev.emit('connection.update', { connection: 'open' });
  await notificationService.sendMessage({ patientId: patient.id, userId: 'test-doctor', message: 'manual' });
  await notificationService.sendMessage({ patientId: patient.id, userId: 'test-doctor', message: 'photo', mediaUrl: 'https://example.test/image.png' });
  await notificationService.sendMessage({ patientId: patient.id, userId: 'test-doctor', message: 'document', mediaUrl: 'https://example.test/file.pdf' });
  assert.equal(manual.sent.length, 3);
  assert.equal(manual.sent[0].data.text, 'manual');
  assert.ok(manual.sent[1].data.image);
  assert.ok(manual.sent[2].data.document);
  assert.equal(messages.at(-1).provider, 'baileys');
  manual.ev.emit('creds.update', {});
  await settle();
  assert.equal(credentialsSaved, 1);
  await notificationService.disconnectBaileys();
  assert.equal(timers.size, 0);
  assert.equal(process.listenerCount('uncaughtException'), baseline);
  assert.equal(dbWipes, 0, 'disconnect preserves linked credentials');

  const provider = new BaileysProvider();
  let incoming = 0, receipts = 0, chats = 0;
  provider.setMessageHandler(() => incoming++);
  provider.setMessageUpdateHandler(() => receipts++);
  provider.setChatUpdateHandler(() => chats++);
  await provider.initialize();
  sockets.at(-1).ev.emit('messages.upsert', { type: 'notify', messages: [] });
  sockets.at(-1).ev.emit('messages.update', []);
  sockets.at(-1).ev.emit('chats.update', []);
  await settle();
  assert.deepEqual([incoming, receipts, chats], [1, 1, 1]);

  const delays = [];
  for (let i = 0; i < 500; i++) {
    const old = sockets.at(-1);
    const staleCallbacks = old.ev.listeners('connection.update');
    emitClose(old, i % 2 ? 408 : 405);
    emitClose(old, 515);
    assert.equal(old.ended, true);
    assert.equal(old.ev.eventNames().length, 0, 'provider releases all its socket listeners');
    assert.equal((await provider.getStatus()).connected, false);
    const delay = await advance();
    delays.push(delay);
    assert.ok(delay >= 2000 && delay <= 60000);
    for (const cb of staleCallbacks) cb({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    assert.equal(timers.size, 0, 'obsolete close callbacks cannot logout or reconnect');
    assert.equal(dbWipes, 0);
    assert.equal(process.listenerCount('uncaughtException'), baseline + 1);
  }
  assert.deepEqual(delays.slice(0, 7), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(maxLiveSockets, 1, 'never two simultaneous sockets');
  sockets.at(-1).ev.emit('connection.update', { connection: 'open' });
  await provider.markAsRead({ id: 'read-test' }, false);
  assert.equal(sockets.at(-1).reads.length, 1);
  assert.equal((await provider.downloadMedia({})).toString(), 'media');
  emitClose(sockets.at(-1));
  assert.equal([...timers][0].delay, 2000, 'backoff resets after successful connection');
  await provider.disconnect();
  assert.equal(timers.size, 0, 'disconnect cancels scheduled reconnect');
  assert.equal(process.listenerCount('uncaughtException'), baseline);

  // Disconnect during authentication must not create a late socket or interfere with a new initialization.
  let release;
  authGate = new Promise(resolve => { release = resolve; });
  const pending = provider.initialize();
  await provider.disconnect();
  const countBefore = sockets.length;
  authGate = null;
  await provider.initialize();
  assert.equal(sockets.length, countBefore + 1);
  release();
  await pending;
  assert.equal(sockets.length, countBefore + 1);
  assert.equal(timers.size, 0);

  // Crypto recovery preserves credentials, deduplicates recovery, and cancels on explicit logout.
  const handler = process.listeners('uncaughtException').find(cb => cb === provider.recoverCryptoCrash);
  assert.ok(handler);
  const cryptoError = new Error('Unsupported state or unable to authenticate data');
  handler(cryptoError);
  handler(cryptoError);
  assert.equal(timers.size, 1);
  assert.equal(dbWipes, 0);
  await advance();
  const logoutSocket = sockets.at(-1);
  await provider.logout();
  assert.equal(logoutSocket.loggedOut, true);
  assert.equal(dbWipes, 1);
  assert.equal(timers.size, 0);
  assert.equal(process.listenerCount('uncaughtException'), baseline);

  // Failed initialization is recoverable without unhandled rejections or parallel attempts.
  failAuth = true;
  await assert.rejects(provider.initialize(), /simulated auth/);
  assert.equal(timers.size, 1);
  await advance();
  assert.equal(timers.size, 1);
  failAuth = false;
  await advance();
  assert.equal(timers.size, 0);
  emitClose(sockets.at(-1), 401);
  await settle();
  assert.equal(dbWipes, 2, 'real logged-out sessions can still be paired again');
  assert.equal(timers.size, 0);
  assert.equal(process.listenerCount('uncaughtException'), baseline);
  originalConsole.log('PASS: 300 automatic replies, reminder template/guardian routing, manual messages/media/fallback, receipts, 500 reconnections, backoff, stale events, in-flight cancellation, crypto recovery, logout and initialization failure.');
})().catch(err => { originalConsole.error(err); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  global.setTimeout = originalTimeout;
  global.clearTimeout = originalClear;
  Object.assign(console, originalConsole);
});
