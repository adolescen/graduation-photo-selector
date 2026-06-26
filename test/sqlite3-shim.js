const http = require('node:http');
const Database = require('better-sqlite3');

// 测试专用 sqlite3 兼容层：将 node-sqlite3 API 代理到 better-sqlite3 内存数据库
const sharedDb = new Database(':memory:');
sharedDb.pragma('foreign_keys = OFF');

function normalizeSql(sql) {
  return sql
    .replace(/datetime\(\s*'now'\s*\)/gi, "datetime('now', 'localtime')")
    .replace(/datetime\(\s*'now',\s*'([^']+)'\s*\)/gi, "datetime('now', 'localtime', '$1')");
}

function createShim() {
  return {
    Database: class SQLite3Shim {
      constructor(path) {
        this._db = sharedDb;
      }

      on(event, handler) {}

      serialize(fn) {
        if (fn) fn();
      }

      run(sql, params = [], cb) {
        try {
          const normalizedSql = normalizeSql(sql);
          const info = this._db.prepare(normalizedSql).run(...normalize(params));
          if (typeof cb === 'function') cb.call({ lastID: info.lastInsertRowid, changes: info.changes }, null);
          return { lastID: info.lastInsertRowid, changes: info.changes };
        } catch (err) {
          if (typeof cb === 'function') cb(err);
          throw err;
        }
      }

      get(sql, params = [], cb) {
        try {
          const normalizedSql = normalizeSql(sql);
          const row = this._db.prepare(normalizedSql).get(...normalize(params));
          if (typeof cb === 'function') cb(null, row);
          return row;
        } catch (err) {
          if (typeof cb === 'function') cb(err);
          throw err;
        }
      }

      all(sql, params = [], cb) {
        try {
          const normalizedSql = normalizeSql(sql);
          const rows = this._db.prepare(normalizedSql).all(...normalize(params));
          if (typeof cb === 'function') cb(null, rows);
          return rows;
        } catch (err) {
          if (typeof cb === 'function') cb(err);
          throw err;
        }
      }

      prepare(sql) {
        const stmt = this._db.prepare(sql);
        return {
          run: (...params) => stmt.run(...params),
          finalize: () => {}
        };
      }

      close(cb) {
        if (typeof cb === 'function') cb();
      }
    },
    verbose: () => createShim()
  };
}

function normalize(params) {
  return Array.isArray(params) ? params : [params];
}

module.exports = createShim();
module.exports.__sharedDb = sharedDb;
