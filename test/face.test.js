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
    AUTO_SCAN_ON_START: 'false',
    FACE_ENABLED: 'false'
  });
});

after(() => {
  app.server.close();
  app.restoreEnv();
});

test('POST /api/admin/face/cluster returns 503 when face recognition disabled', async () => {
  const loginRes = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });

  const res = await request(app.baseUrl, '/api/admin/face/cluster', {
    method: 'POST',
    headers: { 'X-Admin-Token': loginRes.body.token }
  });

  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.success, false);
});

test('POST /api/face/search returns 503 when face recognition disabled', async () => {
  const userRes = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'FaceUser', classPassword: 'class-secret' }
  });

  const res = await request(app.baseUrl, '/api/face/search', {
    method: 'POST',
    headers: { 'X-Session-Token': userRes.body.token }
  });

  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.success, false);
});

test('GET /api/photos supports faceGroupId filter', async () => {
  const userRes = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'FilterUser', classPassword: 'class-secret' }
  });

  const token = userRes.body.token;

  const allRes = await request(app.baseUrl, '/api/photos?category=all&page=1&limit=50', {
    headers: { 'X-Session-Token': token }
  });
  assert.strictEqual(allRes.status, 200);
  assert.strictEqual(allRes.body.photos.length, 0);

  const groupRes = await request(app.baseUrl, '/api/photos?category=all&faceGroupId=1&page=1&limit=50', {
    headers: { 'X-Session-Token': token }
  });
  assert.strictEqual(groupRes.status, 200);
  assert.strictEqual(groupRes.body.photos.length, 0);
});
