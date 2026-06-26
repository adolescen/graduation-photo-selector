require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const OSS = require('ali-oss');
const crypto = require('crypto');
const multer = require('multer');

const faceClient = require('./lib/face-client');

const app = express();
const PORT = process.env.PORT || 3000;

// 文件上传配置：仅内存存储，不持久化参考照片
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 最大 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/webp') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 jpg/png/webp 图片'));
    }
  }
});

// 选择数量配置（默认8张；显式设置为0表示暂停选择）
const parsedSelectionCount = parseInt(process.env.SELECTION_COUNT, 10);
const SELECTION_COUNT = Number.isNaN(parsedSelectionCount) ? 8 : parsedSelectionCount;

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 速率限制中间件
const createJsonRateLimit = (max, windowMinutes) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试' });
  }
});

const authRateLimit = createJsonRateLimit(10, 15);
const adminLoginRateLimit = createJsonRateLimit(5, 15);

// 显式路由：根路径访问首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 显式路由：/admin 访问管理页（不加 .html）
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

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
// 兼容三种部署环境：
// 1. 本地开发：数据库在项目根目录 database.sqlite
// 2. Hugging Face Spaces：HF_DATA_DIR=/data
// 3. 阿里云 ECS：DATA_DIR=/var/lib/graduation-photo-selector
const dataDir = process.env.DATA_DIR
  || (process.env.HF_DATA_DIR ? '/data' : __dirname);
const dbPath = path.join(dataDir, process.env.DATABASE_NAME || 'database.sqlite');
const dbDir = path.dirname(dbPath);

try {
  if (!require('fs').existsSync(dbDir)) {
    require('fs').mkdirSync(dbDir, { recursive: true });
  }
  require('fs').accessSync(dbDir, require('fs').constants.W_OK);
} catch (err) {
  console.error('❌ 无法写入数据库目录，启动失败:', err.message);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.on('error', (err) => {
  console.error('SQLite 错误:', err.message);
});

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
    sort_order INTEGER DEFAULT 0,
    face_group_id INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS face_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aliyun_entity_id TEXT UNIQUE NOT NULL,
    aliyun_face_id TEXT,
    representative_photo_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS face_search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    result_group_id INTEGER,
    confidence REAL,
    searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

const OSS_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7天

function getOSSUrl(ossKey, isThumbnail = false) {
  if (ossClient) {
    const options = { expires: OSS_URL_EXPIRES_SECONDS };
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
    return ossClient.signatureUrl(ossKey, { expires: OSS_URL_EXPIRES_SECONDS });
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
app.post('/api/auth/verify', authRateLimit, (req, res) => {
  const { password } = req.body;
  if (password === process.env.CLASS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 注册/登录用户（按姓名）— 验证班级密码 + 生成 sessionToken
app.post('/api/users', authRateLimit, (req, res) => {
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
  
  if (photoIds.length !== SELECTION_COUNT) {
    return res.status(400).json({ success: false, message: `必须选择恰好${SELECTION_COUNT}张照片` });
  }
  
  // 验证 photoIds：唯一、正整数、存在性
  const uniqueIds = new Set(photoIds);
  if (uniqueIds.size !== SELECTION_COUNT) {
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
      
      if (rows.length !== SELECTION_COUNT) {
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
  let { category = 'all', page = 1, limit = 50, faceGroupId = null } = req.query;

  page = parseInt(page);
  limit = parseInt(limit);
  if (faceGroupId !== null) faceGroupId = parseInt(faceGroupId);

  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const offset = (page - 1) * limit;

  let sql = 'SELECT id, oss_key, category, display_name FROM photos';
  let countSql = 'SELECT COUNT(*) as total FROM photos';
  const params = [];
  const countParams = [];
  const conditions = [];

  if (category !== 'all') {
    conditions.push('category = ?');
    params.push(category);
    countParams.push(category);
  }

  if (!isNaN(faceGroupId) && faceGroupId > 0) {
    conditions.push('face_group_id = ?');
    params.push(faceGroupId);
    countParams.push(faceGroupId);
  }

  if (conditions.length > 0) {
    const whereClause = ' WHERE ' + conditions.join(' AND ');
    sql += whereClause;
    countSql += whereClause;
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
    isDeadlinePassed: isDeadlinePassed(),
    selectionCount: SELECTION_COUNT
  });
});

// 健康检查端点（无认证，供负载均衡/监控探针使用）
app.get('/health', (req, res) => {
  db.get('SELECT 1', [], (err) => {
    if (err) {
      return res.status(503).json({ status: 'error', message: '数据库连接异常', db: 'down' });
    }
    res.json({ status: 'ok', db: 'up', timestamp: new Date().toISOString() });
  });
});

// 管理员登录 — 返回短期 token（不建议长期存储）
app.post('/api/admin/login', adminLoginRateLimit, (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    const token = generateToken();
    // 存储管理员 token（30 分钟有效）
    db.run(
      'INSERT INTO sessions (token, user_id, type, expires_at) VALUES (?, ?, ?, datetime(\'now\', \'+30 minutes\'))',
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
          completedUsers: userRows.filter(u => u.photo_ids && JSON.parse(u.photo_ids).length === SELECTION_COUNT).length,
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
      
      db.all('SELECT id, oss_key, display_name FROM photos', [], (err, photoRows) => {
        if (err) return res.status(500).json({ success: false, message: '数据库错误' });

        const photoNameById = {};
        photoRows.forEach(p => {
          const fileName = p.display_name || p.oss_key.split('/').pop() || '';
          photoNameById[p.id] = fileName;
        });

        const count = SELECTION_COUNT;
        const photoColumns = Array.from({ length: count }, (_, i) => `照片${i + 1}`).join(',');
        let csv = '﻿姓名,已选照片数量,' + photoColumns + ',更新时间\n';

        rows.forEach(row => {
          const photoIds = row.photo_ids ? JSON.parse(row.photo_ids) : [];
          const photoNames = Array.from({ length: count }, (_, i) => {
            const pid = photoIds[i];
            return pid !== undefined ? (photoNameById[pid] || pid) : '';
          });
          csv += `${escapeHtml(row.name)},${photoIds.length},${photoNames.join(',')},${row.updated_at || ''}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="selections.csv"');
        res.send(csv);
      });
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

// 人脸聚类（管理员）
app.post('/api/admin/face/cluster', requireAdmin, async (req, res) => {
  if (!faceClient.isFaceEnabled()) {
    return res.status(503).json({ success: false, message: '人脸识别未启用或未配置' });
  }

  try {
    await faceClient.clearFaceDatabase();
    db.run('DELETE FROM face_groups');
    db.run('UPDATE photos SET face_group_id = NULL');

    db.all('SELECT id, oss_key FROM photos ORDER BY id', [], async (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });

      let processed = 0;
      let grouped = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const result = await faceClient.detectAndRegisterFace(row.oss_key);
          if (result) {
            db.run(
              'INSERT INTO face_groups (aliyun_entity_id, aliyun_face_id, representative_photo_id) VALUES (?, ?, ?)',
              [result.entityId, result.faceId, row.id],
              function (err) {
                if (!err) {
                  db.run('UPDATE photos SET face_group_id = ? WHERE id = ?', [this.lastID, row.id]);
                }
              }
            );
            grouped++;
          }
          processed++;
        } catch (e) {
          errors.push({ photoId: row.id, message: e.message });
          processed++;
        }
      }

      res.json({
        success: true,
        message: `人脸聚类完成：处理 ${processed} 张，成功分组 ${grouped} 张`,
        processed,
        grouped,
        errors: errors.slice(0, 20)
      });
    });
  } catch (err) {
    console.error('人脸聚类失败:', err);
    res.status(500).json({ success: false, message: '人脸聚类失败: ' + err.message });
  }
});

// 清理人脸库（管理员）
app.post('/api/admin/face/clear', requireAdmin, async (req, res) => {
  if (!faceClient.isFaceEnabled()) {
    return res.status(503).json({ success: false, message: '人脸识别未启用或未配置' });
  }

  try {
    const deletedCount = await faceClient.clearFaceDatabase();
    db.run('DELETE FROM face_groups');
    db.run('UPDATE photos SET face_group_id = NULL');
    db.run('DELETE FROM face_search_logs');

    res.json({ success: true, message: `已清理 ${deletedCount} 个人脸组` });
  } catch (err) {
    console.error('清理人脸库失败:', err);
    res.status(500).json({ success: false, message: '清理人脸库失败: ' + err.message });
  }
});

// 按人脸搜索照片（用户）
app.post('/api/face/search', requireAuth, upload.single('photo'), async (req, res) => {
  if (!faceClient.isFaceEnabled()) {
    return res.status(503).json({ success: false, message: '人脸识别未启用或未配置' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传照片' });
  }

  try {
    const result = await faceClient.searchFace(req.file.buffer);

    if (!result) {
      return res.json({ success: true, found: false, photos: [] });
    }

    db.get(
      'SELECT id FROM face_groups WHERE aliyun_entity_id = ?',
      [result.entityId],
      (err, groupRow) => {
        if (err || !groupRow) {
          return res.json({ success: true, found: false, photos: [] });
        }

        db.run(
          'INSERT INTO face_search_logs (user_id, result_group_id, confidence) VALUES (?, ?, ?)',
          [req.userId, groupRow.id, result.confidence]
        );

        db.all(
          'SELECT id, oss_key, category, display_name FROM photos WHERE face_group_id = ? ORDER BY sort_order, id',
          [groupRow.id],
          (err, rows) => {
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
              found: true,
              faceGroupId: groupRow.id,
              confidence: result.confidence,
              photos
            });
          }
        );
      }
    );
  } catch (err) {
    console.error('人脸搜索失败:', err);
    res.status(500).json({ success: false, message: '人脸搜索失败: ' + err.message });
  }
});

// ====== 启动 ======
// 自动检测：如果数据库中无照片，自动扫描 OSS 导入
function autoDetectAndImport() {
  if (process.env.AUTO_SCAN_ON_START === 'false') {
    console.log('ℹ️ AUTO_SCAN_ON_START=false，跳过自动扫描');
    startServer();
    return;
  }

  if (!ossClient) {
    console.log('ℹ️ OSS 未配置，跳过自动扫描');
    return;
  }
  
  db.get('SELECT COUNT(*) as count FROM photos', [], (err, row) => {
    if (err) {
      console.error('⚠️ 检查照片数量失败:', err.message);
      startServer();
      return;
    }
    
    if (row.count > 0) {
      console.log(`📸 数据库中已有 ${row.count} 张照片，跳过自动扫描`);
      startServer();
      return;
    }
    
    console.log('🔍 数据库中无照片，开始自动扫描 OSS...');
    
    scanOSSRoot().then(({ categories, photos }) => {
      if (photos.length === 0) {
        console.log('⚠️ OSS 中未扫描到照片，请确认 OSS_ROOT_PREFIX 配置正确');
        startServer();
        return;
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
      console.log(`✅ 自动扫描完成：导入 ${inserted} 张照片，${categories.length} 个分类`);
      console.log(`   分类: ${categories.join(', ')}`);
      startServer();
    }).catch(err => {
      console.error('⚠️ 自动扫描失败:', err.message);
      console.log('   请检查 OSS 配置是否正确，或手动在管理员页面导入');
      startServer();
    });
  });
}

function startServer() {
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
}

if (require.main === module) {
  autoDetectAndImport();
}

module.exports = app;
