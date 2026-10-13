const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeConfigErrors } = require('../dist/config/validation');
const valid = { NODE_ENV: 'production', JWT_SECRET: 'synthetic-secret', DATABASE_URL: 'postgresql://test@localhost/test', PORT: '8080', CORS_ORIGIN: 'https://admin.cedin.com.py, http://localhost:5173, ', PUBLIC_URL: 'https://inventaflowbackendcedin-production.up.railway.app', UPLOAD_DIR: '/app/public/uploads' };
test('production configuration accepts public URLs and a persistent upload directory', () => {
    assert.deepEqual(runtimeConfigErrors(valid), []);
    assert.deepEqual(runtimeConfigErrors({ ...valid, API_URL: 'inventa_flow_backend_cedin.railway.internal' }), []);
});
test('configuration rejects missing secrets, invalid database, port and internal public links without printing values', () => {
    for (const [name, value] of [['JWT_SECRET', ''], ['DATABASE_URL', 'mysql://private-value'], ['PORT', '65536'], ['CORS_ORIGIN', 'http://localhost:5173'], ['UPLOAD_DIR', ''], ['PUBLIC_URL', 'https://backend.railway.internal'], ['PUBLIC_URL', 'http://localhost:3000'], ['FRONTEND_URL', 'malformed-private-value']]) {
        const errors = runtimeConfigErrors({ ...valid, [name]: value });
        assert(errors.some(error => error.includes(name)), name);
        assert(!errors.some(error => error.includes('private-value')));
    }
});
