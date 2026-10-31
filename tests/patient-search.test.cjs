const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchPatients } = require('../dist/lib/patient-search');

const patients = [
    { id: 'maria', firstName: 'María José', lastName: 'González Benítez', identifier: '4.567.890', phone: '+595 981 123456' },
    { id: 'ruth', firstName: 'Ruth', lastName: 'Cabrera Ruiz', identifier: '1234567', phone: null }
];
const ids = (q) => searchPatients(patients, q).map((p) => p.id);

test('patient search tolerates word order, accents, partial words, typos and formatted documents', () => {
    assert.deepEqual(ids('maria benitez'), ['maria']);
    assert.deepEqual(ids('ruiz RUTH'), ['ruth']);
    assert.deepEqual(ids('gonzales'), ['maria']);
    assert.deepEqual(ids('cabr'), ['ruth']);
    assert.deepEqual(ids('4.567.890'), ['maria']);
    assert.deepEqual(ids('pedro'), []);
});
