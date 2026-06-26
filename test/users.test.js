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

test('POST /api/users creates a new user with valid class password', async () => {
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'Alice', classPassword: 'class-secret' }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.token);
  assert.strictEqual(res.body.exists, false);
});

test('POST /api/users returns exists=true for existing user', async () => {
  await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'Bob', classPassword: 'class-secret' }
  });
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'Bob', classPassword: 'class-secret' }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.exists, true);
});

test('POST /api/users with wrong class password returns 401', async () => {
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'Charlie', classPassword: 'wrong' }
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/users with empty name returns 400', async () => {
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: '   ', classPassword: 'class-secret' }
  });
  assert.strictEqual(res.status, 400);
});

test('POST /api/users with too long name returns 400', async () => {
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'a'.repeat(21), classPassword: 'class-secret' }
  });
  assert.strictEqual(res.status, 400);
});
