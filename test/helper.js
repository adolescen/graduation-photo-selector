const http = require('node:http');
const Module = require('module');

let shimmed = false;

function startTestApp(envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, envOverrides);

    delete require.cache[require.resolve('../server.js')];

    if (!shimmed) {
      const originalResolveFilename = Module._resolveFilename;
      Module._resolveFilename = function (request, parent, isMain, options) {
        if (request === 'sqlite3') {
          return require.resolve('./sqlite3-shim.js');
        }
        return originalResolveFilename.call(this, request, parent, isMain, options);
      };
      shimmed = true;
    }

    const app = require('../server.js');

    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        server,
        restoreEnv: () => {
          process.env = originalEnv;
        }
      });
    });
  });
}

function request(baseUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (options.headers) {
      Object.entries(options.headers).forEach(([k, v]) => {
        if (v !== undefined) headers[k] = v;
      });
    }
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

module.exports = { startTestApp, request };
