---
title: 毕业照片选择系统
emoji: 📸
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# 毕业照片选择系统

一个轻量级的班级毕业照片投票网站，支持瀑布流浏览、每人选 8 张入册、自动统计汇总。从百度网盘迁移到阿里云 OSS，解决班级群选照片不方便的问题。

## 功能特性

| 功能 | 说明 |
|------|------|
| 📱 **手机优先** | 响应式设计，微信内置浏览器完美兼容 |
| 🔐 **密码访问** | 班级密码控制入口，短期使用 |
| 👤 **姓名登记** | 填写真实姓名，后端 session token 认证，防止重复/篡改 |
| 🏞️ **瀑布流浏览** | CSS Columns 瀑布流，照片按自然比例显示，支持无限滚动 |
| 👁️ **图片查看器** | 放大、缩小、拖拽平移、双指缩放、滚轮缩放、双击重置、ESC 关闭 |
| ✅ **灵活选 8 张** | 选择时不限制数量，提交弹窗中可查看大图并取消多余照片，保留恰好 8 张 |
| 🏷️ **自动分类** | 扫描 OSS 根目录下的子文件夹，自动识别为分类（如校园服单人/校园服小组/篮球服单人/运动服小组） |
| 🔍 **自动扫描导入** | 启动时自动检测，数据库为空则自动扫描 OSS 并导入照片 |
| 💾 **分类缓存** | 切换分类时先读取缓存，秒加载，避免反复等待 |
| ⏰ **截止时间** | 截止前可反复修改，截止后锁定 |
| 📊 **统计看板** | 管理员总览（参与人数/完成率/照片热度）+ 个人看板 |
| 📥 **导出 CSV** | 一键导出所有人的选择结果到 Excel |

## 技术栈

- **后端**：Node.js + Express + SQLite（零配置数据库）
- **前端**：纯 HTML + CSS + JS（无框架依赖）
- **存储**：阿里云 OSS（签名 URL 访问，支持图片处理缩略图）
- **部署**：Hugging Face Spaces（Docker，免费持久化 `/data`）

## 快速部署（Hugging Face Spaces）

### 1. 准备代码

确保代码已推送到 GitHub：
```bash
git clone https://github.com/adolescen/graduation-photo-selector.git
cd graduation-photo-selector
```

### 2. 创建 Hugging Face Space

1. 打开 [huggingface.co](https://huggingface.co) → 注册/登录
2. 点击头像 → **New Space**
3. 配置：
   - Space name: `graduation-photo-selector`
   - License: MIT
   - SDK: **Docker**
   - 点击 **Create Space**
4. 连接 GitHub：
   - Space → **Files** → **Settings** → **Git**
   - 连接 GitHub → 选择 `graduation-photo-selector` → 分支 `master` → **Link to GitHub**

### 3. 配置环境变量

Space → **Settings** → **Variables and Secrets**，添加：

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `CLASS_PASSWORD` | Secret | 班级密码（如 `20260306`） |
| `ADMIN_PASSWORD` | Secret | 管理员密码（如 `admin0306`） |
| `DEADLINE` | Variable | 截止时间 `2026-07-15T23:59:59` |
| `OSS_REGION` | Variable | `oss-cn-hangzhou` |
| `OSS_BUCKET` | Variable | `adolescen` |
| `OSS_ACCESS_KEY_ID` | Secret | 阿里云 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | Secret | 阿里云 AccessKey Secret |
| `OSS_ROOT_PREFIX` | Variable | 照片根目录（如 `江南中学毕业照/`） |
| `HF_DATA_DIR` | Variable | `/data`（持久化目录） |

> ⚠️ **安全提醒**：首次部署后，建议去阿里云控制台撤销旧 AccessKey，生成新的并更新环境变量。

### 4. 重启并等待构建

点击 **Factory reboot**，等待 3-5 分钟构建完成。

### 5. 访问验证

```
https://你的用户名-graduation-photo-selector.hf.space       → 首页（自动加载照片）
https://你的用户名-graduation-photo-selector.hf.space/admin  → 管理员看板
```

如果数据库中无照片，启动时会**自动扫描 OSS** 导入。

---

## 本地运行

```bash
npm install
npm start
```

服务在 `http://localhost:3000` 运行。

### 环境变量（.env）

```bash
CLASS_PASSWORD=你的班级密码
ADMIN_PASSWORD=你的管理员密码
DEADLINE=2026-07-15T23:59:59
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=adolescen
OSS_ACCESS_KEY_ID=你的AccessKey
OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
OSS_ROOT_PREFIX=江南中学毕业照/
```

---

## 使用流程

### 同学端

1. 打开链接 → 输入**班级密码** → 进入
2. 填写**真实姓名** → 后端生成 session token
3. 浏览照片：
   - 点击分类按钮筛选（如校园服单人）
   - 滚动瀑布流，无限滚动自动加载
   - 点击照片 = **选中/取消**（蓝色边框 + ✓ 标记）
   - 点击左上角 👁 = **查看大图**（支持放大、平移、缩放）
4. 选择任意数量（建议先多选，再筛选）
5. 点击**提交选择** → 弹窗显示所有候选照片
   - 每张照片可点击**取消**（红色 ✕）
   - 点击 👁 = **查看大图**确认质量
   - 恰好 8 张时，**确认提交**按钮激活
6. 可随时点击 **"我的选择"** 查看已提交的 8 张
7. 点击 **"退出"** 可切换身份（同学 ↔ 管理员）

### 管理员端

1. 访问 `/admin` → 输入管理员密码
2. **统计看板**：
   - 参与人数 / 已完成 / 完成率
   - 按人查看选择了哪些照片
   - 照片热度（哪张最受欢迎）
   - 点击缩略图可查看大图
3. **导出 CSV**：一键下载所有人的选择结果
4. **导入照片**：
   - 自动扫描：一键扫描 OSS 根目录，自动按文件夹分类
   - 手动导入：粘贴 `分类|OSS路径|名称` 格式列表

---

## 目录结构

```
graduation-photo-selector/
├── server.js                 # Express 后端 + SQLite + OSS 签名 URL
├── Dockerfile               # Node.js 20 + /data 持久化
├── package.json
├── .env.example             # 环境变量模板
├── .env                     # 本地环境变量（不提交）
├── .gitignore
├── README.md
├── public/
│   ├── index.html           # 主页面：瀑布流选照片
│   ├── admin.html           # 管理员看板：统计 + 导入 + 导出
│   ├── dashboard.html       # 个人看板：查看已选 8 张
│   ├── css/
│   │   └── style.css        # 响应式样式 + 瀑布流 + 查看器
│   └── js/
│       ├── app.js           # 主页面逻辑：无限滚动 + 选择 + 提交弹窗
│       └── photo-viewer.js  # 通用图片查看器：缩放/平移/手势
├── scripts/
│   └── scan-oss.js          # 扫描 OSS 根目录并输出导入列表
└── database.sqlite          # SQLite 数据库（运行后自动生成）
```

---

## 安全说明

本项目已针对安全审计进行修复：

- **API 认证**：所有敏感路由需要 `X-Session-Token`，后端从 session 表验证身份
- **用户隔离**：选择提交时后端从 session 获取 userId，拒绝篡改他人数据
- **Admin 认证**：管理员 token 存入数据库 session 表，30 分钟有效期，不通过 URL 传递
- **XSS 防护**：所有动态内容使用 DOM API + `textContent` 插入，后端输出统一 `escapeHtml`
- **选择验证**：后端验证 8 个唯一整数 ID，且均在数据库中存在
- **分页限制**：limit 限制 1-100，防止滥用

---

## OSS 照片目录结构

系统会自动扫描根目录下的**子文件夹**作为分类：

```
adolescen bucket/
├── 江南中学毕业照/          ← OSS_ROOT_PREFIX
│   ├── 校园服单人/          → 自动识别为分类"校园服单人"
│   ├── 校园服小组/          → 自动识别为分类"校园服小组"
│   ├── 篮球服单人/          → 自动识别为分类"篮球服单人"
│   └── 运动服小组/          → 自动识别为分类"运动服小组"
```

---

## 常见问题

**Q: 首次部署后照片没有自动加载？**  
A: 检查 Container logs 中是否有自动扫描日志。如果 OSS 配置错误，会在日志中显示具体原因。

**Q: 切换分类时照片加载慢？**  
A: 首次加载后数据会缓存到 sessionStorage，24 小时内再次切换同一分类会秒加载。

**Q: 如何更新照片（新增/删除）？**  
A: 在 OSS 上修改后，进入 admin 页面点击 **"开始自动扫描"**，系统会自动重新导入。

**Q: 数据会丢失吗？**  
A: Hugging Face 的 `/data` 目录通常持久化，但免费版偶尔会因休眠重置。建议定期在 admin 页面导出 CSV 备份。

**Q: 可以限制每人只能提交一次吗？**  
A: 当前设计截止前可修改。如需严格限制，可修改 `server.js` 中的更新逻辑（将 UPDATE 改为拒绝重复提交）。

---

## License

MIT
