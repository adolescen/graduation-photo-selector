const assert = require('node:assert');
const { test, before, after } = require('node:test');
const { startTestApp, request } = require('./helper.js');

let app;

before(async () => {
  app = await startTestApp({
    CLASS_PASSWORD: 'class-secret',
    ADMIN_PASSWORD: 'admin-secret',
    SELECTION_COUNT: '8',
    DEADLINE: '2030-01-01T00:00:00',
    HF_DATA_DIR: '/data',
    AUTO_SCAN_ON_START: 'false'
  });
});

after(() => {
  app.server.close();
  app.restoreEnv();
});

test('POST /api/auth/verify with correct password returns success', async () => {
  const res = await request(app.baseUrl, '/api/auth/verify', {
    method: 'POST',
    body: { password: 'class-secret' }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('POST /api/auth/verify with wrong password returns 401', async () => {
  const res = await request(app.baseUrl, '/api/auth/verify', {
    method: 'POST',
    body: { password: 'wrong' }
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('POST /api/auth/verify with empty password returns 401', async () => {
  const res = await request(app.baseUrl, '/api/auth/verify', {
    method: 'POST',
    body: { password: '' }
  });
  assert.strictEqual(res.status, 401);
});
