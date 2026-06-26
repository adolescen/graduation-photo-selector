const assert = require('node:assert');
const { test, before, after } = require('node:test');
const { startTestApp, request } = require('./helper.js');

let app;

async function createUser(name) {
  const res = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name, classPassword: 'class-secret' }
  });
  return res.body.token;
}

async function importPhotos(token) {
  const res = await request(app.baseUrl, '/api/admin/import-photos', {
    method: 'POST',
    headers: { 'X-Admin-Token': token },
    body: {
      photos: [
        { ossKey: 'test/01.jpg', category: 'test', displayName: 'p1' },
        { ossKey: 'test/02.jpg', category: 'test', displayName: 'p2' },
        { ossKey: 'test/03.jpg', category: 'test', displayName: 'p3' },
        { ossKey: 'test/04.jpg', category: 'test', displayName: 'p4' },
        { ossKey: 'test/05.jpg', category: 'test', displayName: 'p5' },
        { ossKey: 'test/06.jpg', category: 'test', displayName: 'p6' },
        { ossKey: 'test/07.jpg', category: 'test', displayName: 'p7' },
        { ossKey: 'test/08.jpg', category: 'test', displayName: 'p8' },
        { ossKey: 'test/09.jpg', category: 'test', displayName: 'p9' }
      ]
    }
  });
  return res.body;
}

before(async () => {
  app = await startTestApp({
    CLASS_PASSWORD: 'class-secret',
    ADMIN_PASSWORD: 'admin-secret',
    SELECTION_COUNT: '8',
    DEADLINE: '2030-01-01T00:00:00',
    HF_DATA_DIR: '/data',
    AUTO_SCAN_ON_START: 'false'
  });

  const adminRes = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });
  app.adminToken = adminRes.body.token;
  await importPhotos(app.adminToken);
});

after(() => {
  app.server.close();
  app.restoreEnv();
});

test('submitting exactly SELECTION_COUNT photos succeeds', async () => {
  const token = await createUser('SelUser1');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8] }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('submitting fewer photos returns 400', async () => {
  const token = await createUser('SelUser2');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3] }
  });
  assert.strictEqual(res.status, 400);
});

test('submitting more photos returns 400', async () => {
  const token = await createUser('SelUser3');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }
  });
  assert.strictEqual(res.status, 400);
});

test('submitting duplicate photo ids returns 400', async () => {
  const token = await createUser('SelUser4');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 1, 2, 3, 4, 5, 6, 7] }
  });
  assert.strictEqual(res.status, 400);
});

test('submitting non-positive integer ids returns 400', async () => {
  const token = await createUser('SelUser5');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, -1] }
  });
  assert.strictEqual(res.status, 400);
});

test('submitting non-existent photo ids returns 400', async () => {
  const token = await createUser('SelUser6');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 999] }
  });
  assert.strictEqual(res.status, 400);
});

test('submitting after deadline returns 403', async () => {
  app.server.close();
  app.restoreEnv();
  app = await startTestApp({
    CLASS_PASSWORD: 'class-secret',
    ADMIN_PASSWORD: 'admin-secret',
    SELECTION_COUNT: '8',
    DEADLINE: '2020-01-01T00:00:00',
    HF_DATA_DIR: '/data',
    AUTO_SCAN_ON_START: 'false'
  });
  const adminRes = await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  });
  await importPhotos(adminRes.body.token);

  const token = await createUser('LateUser');
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8] }
  });
  assert.strictEqual(res.status, 403);
});

test('submitting without token returns 401', async () => {
  const res = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8] }
  });
  assert.strictEqual(res.status, 401);
});
