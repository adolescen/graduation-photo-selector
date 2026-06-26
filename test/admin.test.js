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

test('POST /api/admin/login with correct password returns token', async () => {
  const res = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.token);
});

test('POST /api/admin/login with wrong password returns 401', async () => {
  const res = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'wrong' }
  });
  assert.strictEqual(res.status, 401);
});

test('expired admin token is rejected', async () => {
  const loginRes = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });
  const token = loginRes.body.token;

  const { __sharedDb } = require('./sqlite3-shim.js');
  __sharedDb.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute') WHERE token = ?").run(token);

  const res = await request(app.baseUrl, '/api/admin/export', {
    method: 'POST',
    headers: { 'X-Admin-Token': token }
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/admin/export returns CSV with BOM and correct headers', async () => {
  const loginRes = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });
  const res = await request(app.baseUrl, '/api/admin/export', {
    method: 'POST',
    headers: { 'X-Admin-Token': loginRes.body.token }
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.startsWith('﻿姓名,已选照片数量,照片ID列表,更新时间'));
});

test('POST /api/admin/stats returns correct completedUsers count', async () => {
  const userRes = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'StatsUser', classPassword: 'class-secret' }
  });

  const adminToken = (await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  })).body.token;

  await request(app.baseUrl, '/api/admin/import-photos', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken },
    body: {
      photos: Array.from({ length: 8 }, (_, i) => ({
        ossKey: `stats/${i + 1}.jpg`,
        category: 'stats',
        displayName: `p${i + 1}`
      }))
    }
  });

  await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': userRes.body.token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8] }
  });

  const res = await request(app.baseUrl, '/api/admin/stats', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.completedUsers, 1);
});
