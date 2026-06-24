require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const OSS = require('ali-oss');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== 阿里云 OSS 客户端 ======
const ossClient = (() => {
  const endpoint = process.env.OSS_ENDPOINT || '';
  if (!endpoint) return null;
  
  return new OSS({
    endpoint: endpoint,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  });
})();

// ====== 数据库初始化 ======
const dbPath = process.env.HF_DATA_DIR ? '/data/database.sqlite' : path.join(__dirname, 'database.sqlite');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
if (!require('fs').existsSync(dbDir)) {
  require('fs').mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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

// ====== 自动扫描 OSS 根目录 ======
async function scanOSSRoot() {
  if (!ossClient) {
    throw new Error('OSS 客户端未配置');
  }
  
  const rootPrefix = process.env.OSS_ROOT_PREFIX || '';
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const isImage = (key) => imageExts.includes(path.extname(key).toLowerCase());
  
  // 1. 扫描根目录下的所有子文件夹（作为分类）
  const result = await ossClient.list({
    prefix: rootPrefix,
    delimiter: '/',
    'max-keys': 1000
  });
  
  const categories = [];
  
  if (result.prefixes) {
    for (const prefix of result.prefixes) {
      // 提取分类名：去掉根前缀，去掉末尾 /
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
  
  // 2. 扫描每个分类下的图片
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

// 验证班级密码
app.post('/api/auth/verify', (req, res) => {
  const { password } = req.body;
  if (password === process.env.CLASS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 注册/登录用户（按姓名）
app.post('/api/users', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '姓名不能为空' });
  }

  const trimmed = name.trim();
  
  db.get('SELECT id FROM users WHERE name = ?', [trimmed], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    
    if (row) {
      return res.json({ success: true, userId: row.id, name: trimmed, exists: true });
    }
    
    db.run('INSERT INTO users (name) VALUES (?)', [trimmed], function(err) {
      if (err) return res.status(500).json({ success: false, message: '创建用户失败' });
      res.json({ success: true, userId: this.lastID, name: trimmed, exists: false });
    });
  });
});

// 获取用户选择
app.get('/api/users/:name/selection', (req, res) => {
  const { name } = req.params;
  
  db.get(
    `SELECT s.photo_ids, s.updated_at, u.id as user_id
     FROM users u
     LEFT JOIN selections s ON u.id = s.user_id
     WHERE u.name = ?`,
    [name],
    (err, row) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      if (!row) return res.status(404).json({ success: false, message: '用户不存在' });
      
      res.json({
        success: true,
        userId: row.user_id,
        photoIds: row.photo_ids ? JSON.parse(row.photo_ids) : [],
        updatedAt: row.updated_at
      });
    }
  );
});

// 提交/更新选择
app.post('/api/selections', (req, res) => {
  const { userId, photoIds } = req.body;
  
  if (!userId || !Array.isArray(photoIds)) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }
  
  if (photoIds.length !== 8) {
    return res.status(400).json({ success: false, message: '必须选择恰好8张照片' });
  }
  
  if (isDeadlinePassed()) {
    return res.status(403).json({ success: false, message: '已超过截止时间，无法修改' });
  }
  
  const photoIdsJson = JSON.stringify(photoIds);
  
  db.get('SELECT id FROM selections WHERE user_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    
    if (row) {
      db.run(
        'UPDATE selections SET photo_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [photoIdsJson, userId],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: '更新失败' });
          res.json({ success: true, message: '选择已更新' });
        }
      );
    } else {
      db.run(
        'INSERT INTO selections (user_id, photo_ids) VALUES (?, ?)',
        [userId, photoIdsJson],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: '提交失败' });
          res.json({ success: true, message: '选择已提交' });
        }
      );
    }
  });
});

// 获取照片列表（分页、分类）
app.get('/api/photos', (req, res) => {
  const { category = 'all', page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
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
  params.push(parseInt(limit), offset);
  
  db.get(countSql, countParams, (err, countRow) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: '数据库错误' });
      
      const photos = rows.map(row => ({
        id: row.id,
        ossKey: row.oss_key,
        category: row.category,
        displayName: row.display_name || row.oss_key.split('/').pop(),
        thumbnailUrl: getOSSUrl(row.oss_key, true),
        fullUrl: getOSSFullUrl(row.oss_key)
      }));
      
      res.json({
        success: true,
        photos,
        total: countRow.total,
        page: parseInt(page),
        totalPages: Math.ceil(countRow.total / parseInt(limit))
      });
    });
  });
});

// 获取分类列表
app.get('/api/categories', (req, res) => {
  db.all('SELECT DISTINCT category FROM photos ORDER BY category', [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: '数据库错误' });
    res.json({ success: true, categories: rows.map(r => r.category) });
  });
});

// 获取系统设置
app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    deadline: process.env.DEADLINE || null,
    isDeadlinePassed: isDeadlinePassed()
  });
});

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 管理员统计
app.get('/api/admin/stats', (req, res) => {
  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
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
            displayName: p.display_name || p.oss_key.split('/').pop(),
            count: 0,
            selectedBy: []
          };
        });
        
        const userSelections = userRows.map(u => {
          const photoIds = u.photo_ids ? JSON.parse(u.photo_ids) : [];
          photoIds.forEach(pid => {
            if (photoStats[pid]) {
              photoStats[pid].count++;
              photoStats[pid].selectedBy.push(u.name);
            }
          });
          return {
            id: u.id,
            name: u.name,
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

// 导出 CSV
app.get('/api/admin/export', (req, res) => {
  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
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
        csv += `${row.name},${photoIds.length},"${photoIds.join(',')}",${row.updated_at || ''}\n`;
      });
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="selections.csv"');
      res.send(csv);
    }
  );
});

// 批量导入照片（管理员）
app.post('/api/admin/import-photos', (req, res) => {
  const { password, photos } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
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
app.post('/api/admin/auto-scan', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
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
app.listen(PORT, () => {
  console.log(`毕业照片选择系统已启动: http://localhost:${PORT}`);
  console.log(`截止时间: ${process.env.DEADLINE || '未设置'}`);
});
