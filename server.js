require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const OSS = require('ali-oss');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== 阿里云 OSS 客户端 ======
const ossClient = (() => {
  try {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID || '';
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || '';
    const bucket = process.env.OSS_BUCKET || '';
    const region = process.env.OSS_REGION || '';
    
    if (!accessKeyId || !accessKeySecret) {
      console.log('ℹ️ OSS AccessKey 未配置，将使用直接 URL 模式');
      return null;
    }
    
    if (!region || !bucket) {
      console.log('ℹ️ OSS region 或 bucket 未配置，将使用直接 URL 模式');
      return null;
    }
    
    // 使用 region + bucket 方式初始化（AccessPoint 端点不支持 list 操作）
    return new OSS({
      region: region,
      accessKeyId: accessKeyId,
      accessKeySecret: accessKeySecret,
      bucket: bucket,
    });
  } catch (err) {
    console.error('⚠️ OSS 客户端初始化失败:', err.message);
    return null;
  }
})();

// ====== 数据库初始化 ======
let dbPath = process.env.HF_DATA_DIR ? '/data/database.sqlite' : path.join(__dirname, 'database.sqlite');
const dbDir = path.dirname(dbPath);

try {
  if (!require('fs').existsSync(dbDir)) {
    require('fs').mkdirSync(dbDir, { recursive: true });
  }
  require('fs').accessSync(dbDir, require('fs').constants.W_OK);
} catch (err) {
  console.warn('⚠️ 无法写入数据库目录，使用内存数据库:', err.message);
  dbPath = ':memory:';
}

const db = new sqlite3.Database(dbPath);

db.on('error', (err) => {
  console.error('SQLite 错误:', err.message);
});

if (dbPath === ':memory:') {
  console.log('📌 使用内存数据库，重启后数据会丢失。请定期导出 CSV 备份。');
}

// 创建会话表（用于安全认证）
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    photo_ids TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oss_key TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    display_name TEXT,
    sort_order INTEGER DEFAULT 0
  )`);
});

// ====== 工具函数 ======
function getDeadline() {
  return process.env.DEADLINE ? new Date(process.env.DEADLINE) : null;
}

function isDeadlinePassed() {
  const deadline = getDeadline();
  return deadline ? new Date() > deadline : false;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getOSSUrl(ossKey, isThumbnail = false) {
  if (ossClient) {
    const options = { expires: 86400 };
    if (isThumbnail) {
      options.process = 'image/resize,w_400,quality_80';
    }
    return ossClient.signatureUrl(ossKey, options);
  }
  const endpoint = process.env.OSS_ENDPOINT || '';
  const base = endpoint.replace(/\/$/, '');
  const encodedKey = encodeURIComponent(ossKey).replace(/%2F/g, '/');
  if (isThumbnail) {
    return `${base}/${encodedKey}?x-oss-process=image/resize,w_400,quality_80`;
  }
  return `${base}/${encodedKey}`;
}

function getOSSFullUrl(ossKey) {
  if (ossClient) {
    return ossClient.signatureUrl(ossKey, { expires: 86400 });
  }
  const endpoint = process.env.OSS_ENDPOINT || '';
  const base = endpoint.replace(/\/$/, '');
  const encodedKey = encodeURIComponent(ossKey).replace(/%2F/g, '/');
  return `${base}/${encodedKey}`;
}

// HTML 转义函数（防止 XSS）
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ====== 认证中间件 ======
// 检查用户 session token
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }
  
  db.get(
    `SELECT s.user_id, s.type, u.name 
     FROM sessions s 
     JOIN users u ON s.user_id = u.id 
     WHERE s.token = ? AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))`,
    [token],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
      }
      req.userId = row.user_id;
      req.userName = row.name;
      next();
    }
  );
}

// 检查管理员 token（支持 Header 或 POST body）
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.token;
  if (!token) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
  // 检查数据库中的 admin session token
  db.get(
    `SELECT * FROM sessions WHERE token = ? AND type = 'admin' AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    [token],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ success: false, message: '未授权或会话已过期' });
      }
      next();
    }
  );
}

// ====== 自动扫描 OSS 根目录 ======
async function scanOSSRoot() {
  if (!ossClient) {
    throw new Error('OSS 客户端未配置');
  }
  
  const rootPrefix = process.env.OSS_ROOT_PREFIX || '';
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const isImage = (key) => imageExts.includes(path.extname(key).toLowerCase());
  
  const result = await ossClient.list({
    prefix: rootPrefix,
    delimiter: '/',
    'max-keys': 1000
  });
  
  const categories = [];
  
  if (result.prefixes) {
    for (const prefix of result.prefixes) {
      let categoryName = prefix;
      if (rootPrefix && categoryName.startsWith(rootPrefix)) {
        categoryName = categoryName.slice(rootPrefix.length);
      }
      categoryName = categoryName.replace(/\/$/, '');
      
      if (categoryName) {
        categories.push({ prefix, name: categoryName });
      }
    }
  }
  
  const allPhotos = [];
  
  for (const cat of categories) {
    let marker = null;
    do {
      const listResult = await ossClient.list({
        prefix: cat.prefix,
        marker: marker,
        'max-keys': 1000
      });
      
      if (listResult.objects) {
        for (const obj of listResult.objects) {
          if (isImage(obj.name)) {
            allPhotos.push({
              category: cat.name,
              ossKey: obj.name,
              displayName: path.basename(obj.name, path.extname(obj.name))
            });
          }
        }
      }
      
      marker = listResult.nextMarker;
    } while (marker);
  }
  
  return { categories: categories.map(c => c.name), photos: allPhotos };
}

// ====== API 路由 ======

// 验证班级密码（仅前端校验，返回 classToken 用于后续认证）
app.post('/api/auth/verify', (req, res) => {
  const { password } = req.body;
  if (password === process.env.CLASS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 注册/登录用户（按姓名）— 验证班级密码 + 生成 sessionToken
app.post('/api/users', (req, res) => {
  const { name, classPassword } = req.body;
  
  if (!classPassword || classPassword !== process.env.CLASS_PASSWORD) {
    return res.status(401).json({ success: false, message: '班级密码错误' });
  }
  
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '姓名不能为空' });
  }
  
  const trimmed = name.trim();
  if (trimmed.length > 20) {
    return res.status(400).json({ success: false, message: '姓名不能超过20个字符' });
  }
  
  db.get('SELECT id FROM users WHERE name = ?', [trimmed], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    
    if (row) {
      // 已存在用户，生成新 sessionToken
      const token = generateToken();
      db.run(
        'INSERT INTO sessions (token, user_id, type) VALUES (?, ?, ?)',
        [token, row.id, 'user'],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: '创建会话失败' });
          res.json({ success: true, token, userId: row.id, name: trimmed, exists: true });
        }
      );
    } else {
      // 新建用户
      db.run('INSERT INTO users (name) VALUES (?)', [trimmed], function(err) {
        if (err) return res.status(500).json({ success: false, message: '创建用户失败' });
        const userId = this.lastID;
        const token = generateToken();
        db.run(
          'INSERT INTO sessions (token, user_id, type) VALUES (?, ?, ?)',
          [token, userId, 'user'],
          (err) => {
            if (err) return res.status(500).json({ success: false, message: '创建会话失败' });
            res.json({ success: true, token, userId, name: trimmed, exists: false });
          }
        );
      });
    }
  });
});

// 获取用户选择（需要认证）
app.get('/api/users/selection', requireAuth, (req, res) => {
  db.get(
    `SELECT s.photo_ids, s.updated_at 
     FROM selections s 
     WHERE s.user_id = ?`,
    [req.userId],
    (err, row) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      res.json({
        success: true,
        userId: req.userId,
        name: req.userName,
        photoIds: row && row.photo_ids ? JSON.parse(row.photo_ids) : [],
        updatedAt: row ? row.updated_at : null
      });
    }
  );
});

// 提交/更新选择（需要认证，从 session 获取 userId）
app.post('/api/selections', requireAuth, (req, res) => {
  const { photoIds } = req.body;
  
  if (!Array.isArray(photoIds)) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }
  
  if (photoIds.length !== 8) {
    return res.status(400).json({ success: false, message: '必须选择恰好8张照片' });
  }
  
  // 验证 photoIds：唯一、正整数、存在性
  const uniqueIds = new Set(photoIds);
  if (uniqueIds.size !== 8) {
    return res.status(400).json({ success: false, message: '选中的照片不能重复' });
  }
  
  // 验证所有 ID 是正整数
  for (const id of photoIds) {
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '照片ID格式错误' });
    }
  }
  
  // 验证所有 ID 在数据库中存在
  db.all(
    'SELECT id FROM photos WHERE id IN (' + photoIds.map(() => '?').join(',') + ')',
    photoIds,
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      if (rows.length !== 8) {
        return res.status(400).json({ success: false, message: '部分照片不存在，请刷新后重试' });
      }
      
      if (isDeadlinePassed()) {
        return res.status(403).json({ success: false, message: '已超过截止时间，无法修改' });
      }
      
      const photoIdsJson = JSON.stringify(photoIds);
      
      db.get('SELECT id FROM selections WHERE user_id = ?', [req.userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });
        
        if (row) {
          db.run(
            'UPDATE selections SET photo_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            [photoIdsJson, req.userId],
            (err) => {
              if (err) return res.status(500).json({ success: false, message: '更新失败' });
              res.json({ success: true, message: '选择已更新' });
            }
          );
        } else {
          db.run(
            'INSERT INTO selections (user_id, photo_ids) VALUES (?, ?)',
            [req.userId, photoIdsJson],
            (err) => {
              if (err) return res.status(500).json({ success: false, message: '提交失败' });
              res.json({ success: true, message: '选择已提交' });
            }
          );
        }
      });
    }
  );
});

// 获取照片列表（需要认证，限制分页）
app.get('/api/photos', requireAuth, (req, res) => {
  let { category = 'all', page = 1, limit = 10000 } = req.query;
  
  page = parseInt(page);
  limit = parseInt(limit);
  
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = 10000;
  if (limit > 10000) limit = 10000;
  
  const offset = (page - 1) * limit;
  
  let sql = 'SELECT id, oss_key, category, display_name FROM photos';
  let countSql = 'SELECT COUNT(*) as total FROM photos';
  const params = [];
  const countParams = [];
  
  if (category !== 'all') {
    sql += ' WHERE category = ?';
    countSql += ' WHERE category = ?';
    params.push(category);
    countParams.push(category);
  }
  
  sql += ' ORDER BY sort_order, id LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  db.get(countSql, countParams, (err, countRow) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      const photos = rows.map(row => ({
        id: row.id,
        ossKey: row.oss_key,
        category: row.category,
        displayName: escapeHtml(row.display_name || row.oss_key.split('/').pop()),
        thumbnailUrl: getOSSUrl(row.oss_key, true),
        fullUrl: getOSSFullUrl(row.oss_key)
      }));
      
      res.json({
        success: true,
        photos,
        total: countRow.total,
        page: page,
        totalPages: Math.ceil(countRow.total / limit)
      });
    });
  });
});

// 获取分类列表（需要认证）
app.get('/api/categories', requireAuth, (req, res) => {
  db.all('SELECT DISTINCT category FROM photos ORDER BY category', [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    res.json({ success: true, categories: rows.map(r => escapeHtml(r.category)) });
  });
});

// 获取系统设置（公开，无敏感信息）
app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    deadline: process.env.DEADLINE || null,
    isDeadlinePassed: isDeadlinePassed()
  });
});

// 管理员登录 — 返回短期 token（不建议长期存储）
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    const token = generateToken();
    // 存储管理员 token（30 分钟有效）
    db.run(
      'INSERT INTO sessions (token, user_id, type, expires_at) VALUES (?, ?, ?, datetime("now", "+30 minutes"))',
      [token, 0, 'admin'],
      (err) => {
        if (err) return res.status(500).json({ success: false, message: '创建会话失败' });
        res.json({ success: true, token });
      }
    );
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 管理员统计（POST 方式，token 在 body 中）
app.post('/api/admin/stats', requireAdmin, (req, res) => {
  db.all(
    `SELECT u.id, u.name, s.photo_ids, s.updated_at
     FROM users u
     LEFT JOIN selections s ON u.id = s.user_id
     ORDER BY u.name`,
    [],
    (err, userRows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      db.all('SELECT id, oss_key, display_name FROM photos', [], (err, photoRows) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });
        
        const photoStats = {};
        photoRows.forEach(p => {
          photoStats[p.id] = {
            id: p.id,
            ossKey: p.oss_key,
            displayName: escapeHtml(p.display_name || p.oss_key.split('/').pop()),
            count: 0,
            selectedBy: []
          };
        });
        
        const userSelections = userRows.map(u => {
          const photoIds = u.photo_ids ? JSON.parse(u.photo_ids) : [];
          photoIds.forEach(pid => {
            if (photoStats[pid]) {
              photoStats[pid].count++;
              photoStats[pid].selectedBy.push(escapeHtml(u.name));
            }
          });
          return {
            id: u.id,
            name: escapeHtml(u.name),
            photoIds: photoIds,
            photoCount: photoIds.length,
            updatedAt: u.updated_at
          };
        });
        
        const photoStatsArray = Object.values(photoStats).sort((a, b) => b.count - a.count);
        
        res.json({
          success: true,
          totalUsers: userRows.length,
          completedUsers: userRows.filter(u => u.photo_ids && JSON.parse(u.photo_ids).length === 8).length,
          userSelections,
          photoStats: photoStatsArray
        });
      });
    }
  );
});

// 导出 CSV（POST 方式）
app.post('/api/admin/export', requireAdmin, (req, res) => {
  db.all(
    `SELECT u.name, s.photo_ids, s.updated_at
     FROM users u
     LEFT JOIN selections s ON u.id = s.user_id
     ORDER BY u.name`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      let csv = '\uFEFF姓名,已选照片数量,照片ID列表,更新时间\n';
      rows.forEach(row => {
        const photoIds = row.photo_ids ? JSON.parse(row.photo_ids) : [];
        csv += `${escapeHtml(row.name)},${photoIds.length},"${photoIds.join(',')}",${row.updated_at || ''}\n`;
      });
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="selections.csv"');
      res.send(csv);
    }
  );
});

// 批量导入照片（管理员）
app.post('/api/admin/import-photos', requireAdmin, (req, res) => {
  const { photos } = req.body;
  
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ success: false, message: '照片列表为空' });
  }
  
  const stmt = db.prepare('INSERT OR IGNORE INTO photos (oss_key, category, display_name, sort_order) VALUES (?, ?, ?, ?)');
  let inserted = 0;
  
  photos.forEach((photo, index) => {
    const { ossKey, category, displayName } = photo;
    if (ossKey && category) {
      stmt.run(ossKey, category, displayName || null, index);
      inserted++;
    }
  });
  
  stmt.finalize();
  res.json({ success: true, message: `已导入 ${inserted} 张照片` });
});

// 自动扫描并导入照片（管理员）
app.post('/api/admin/auto-scan', requireAdmin, async (req, res) => {
  if (!ossClient) {
    return res.status(500).json({ success: false, message: 'OSS 客户端未配置' });
  }
  
  try {
    const { categories, photos } = await scanOSSRoot();
    
    if (photos.length === 0) {
      return res.json({ success: true, message: '未扫描到照片', categories: [], imported: 0 });
    }
    
    const stmt = db.prepare('INSERT OR IGNORE INTO photos (oss_key, category, display_name, sort_order) VALUES (?, ?, ?, ?)');
    let inserted = 0;
    
    photos.forEach((photo, index) => {
      if (photo.ossKey && photo.category) {
        stmt.run(photo.ossKey, photo.category, photo.displayName || null, index);
        inserted++;
      }
    });
    
    stmt.finalize();
    
    res.json({
      success: true,
      message: `已扫描并导入 ${inserted} 张照片，共 ${categories.length} 个分类`,
      categories,
      imported: inserted
    });
  } catch (err) {
    console.error('扫描失败:', err);
    res.status(500).json({ success: false, message: '扫描失败: ' + err.message });
  }
});

// ====== 启动 ======
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`毕业照片选择系统已启动: http://localhost:${PORT}`);
  console.log(`截止时间: ${process.env.DEADLINE || '未设置'}`);
  console.log(`数据库: ${dbPath === ':memory:' ? '内存模式' : dbPath}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM，正在关闭...');
  server.close(() => {
    db.close(() => {
      process.exit(0);
    });
  });
});
