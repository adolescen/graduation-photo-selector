const { startTestApp, request } = require('./helper.js');

(async () => {
  const app = await startTestApp({
    ADMIN_PASSWORD: 'admin-secret',
    CLASS_PASSWORD: 'class-secret',
    HF_DATA_DIR: '/data',
    AUTO_SCAN_ON_START: 'false'
  });
  const userRes = await request(app.baseUrl, '/api/users', {
    method: 'POST',
    body: { name: 'StatsUser', classPassword: 'class-secret' }
  });
  const adminTokenForImport = (await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  })).body.token;

  const photos = [];
  for (let i = 1; i <= 8; i++) {
    photos.push({ ossKey: `stats/${i}.jpg`, category: 'stats', displayName: `p${i}` });
  }

  const imp = await request(app.baseUrl, '/api/admin/import-photos', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminTokenForImport },
    body: { photos }
  });
  console.log('import', imp.status, imp.body);

  const sel = await request(app.baseUrl, '/api/selections', {
    method: 'POST',
    headers: { 'X-Session-Token': userRes.body.token },
    body: { photoIds: [1, 2, 3, 4, 5, 6, 7, 8] }
  });
  console.log('sel', sel.status, sel.body);

  const adminToken = (await request(app.baseUrl, '/api/admin/login', {
    method: 'POST',
    body: { password: 'admin-secret' }
  })).body.token;

  const stats = await request(app.baseUrl, '/api/admin/stats', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken }
  });
  console.log('stats', stats.status, stats.body);
  app.server.close();
})();
