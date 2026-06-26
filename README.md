# Graduation Photo Selector

<p align="center">
  <strong>班级毕业照片选择系统</strong><br>
  一个轻量、安全的班级毕业照投票与汇总工具
</p>

<p align="center">
  <a href="https://github.com/adolescen/graduation-photo-selector/releases">
    <img src="https://img.shields.io/github/v/release/adolescen/graduation-photo-selector?display_name=tag" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

## 简介

**Graduation Photo Selector** 是一个面向班级毕业相册选片的 Web 应用。同学通过手机浏览器即可浏览、挑选自己最满意的毕业照，管理员可在后台查看统计、导出汇总 CSV。

本项目后期以 **GitHub** 作为主版本管理仓库，Hugging Face Space 作为部署运行环境之一。

## 功能特性

- **响应式移动端体验**：针对微信内置浏览器和手机屏幕优化
- **班级密码访问**：单密码控制同学入口
- **姓名登记 + Session 认证**：后端生成 session token，防止身份篡改
- **瀑布流浏览**：CSS Columns 瀑布流，支持无限滚动
- **图片查看器**：支持放大、缩小、拖拽平移、双指缩放、双击重置
- **灵活选 N 张**：选择阶段不限制数量，提交弹窗中可取消多余照片，保留恰好 N 张
- **OSS 自动分类**：扫描 OSS 根目录下的子文件夹，自动识别为照片分类
- **自动扫描导入**：启动时自动检测数据库，为空时自动扫描 OSS 导入
- **分类缓存**：首次加载后缓存，切换分类秒加载
- **截止时间控制**：截止前可修改，截止后锁定
- **管理员看板**：参与人数、完成率、照片热度、个人选择明细
- **CSV 导出**：一键导出全班选择结果
- **健康检查**：`/health` 端点供监控探针使用
- **API 限流**：班级密码和管理员登录接口均有 rate limit 保护

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 数据库 | SQLite（文件型，零配置） |
| 前端 | 原生 HTML + CSS + JavaScript |
| 对象存储 | 阿里云 OSS（签名 URL + 图片处理） |
| 部署 | Hugging Face Spaces（Docker） |
| 测试 | Node.js 内置 `node --test` |
| 代码质量 | ESLint |

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/adolescen/graduation-photo-selector.git
cd graduation-photo-selector

# 安装依赖
npm install

# 复制环境变量模板并编辑
cp .env.example .env
# 修改 .env 中的密码、截止时间、OSS 配置等

# 启动服务
npm start
```

服务默认在 `http://localhost:3000` 运行。

开发模式（自动重启）：

```bash
npm run dev
```

### 环境变量

复制 `.env.example` 为 `.env`，并按需填写：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `CLASS_PASSWORD` | 是 | 班级入口密码 |
| `ADMIN_PASSWORD` | 是 | 管理员后台密码 |
| `DEADLINE` | 否 | 截止时间，ISO 8601 格式，如 `2026-07-15T23:59:59` |
| `SELECTION_COUNT` | 否 | 每人需选照片数量，默认 `8`；设为 `0` 表示暂停选择 |
| `OSS_REGION` | 否 | 阿里云 OSS Region，如 `oss-cn-hangzhou` |
| `OSS_BUCKET` | 否 | OSS Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | 否 | 阿里云 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | 否 | 阿里云 AccessKey Secret |
| `OSS_ENDPOINT` | 否 | OSS 访问域名 |
| `OSS_ROOT_PREFIX` | 否 | 照片根目录，如 `江南中学毕业照/`，留空表示扫描根目录 |
| `AUTO_SCAN_ON_START` | 否 | 启动时是否自动扫描 OSS，默认 `true`；照片较多时可设为 `false` |
| `HF_DATA_DIR` | 否 | Hugging Face Spaces 持久化目录，通常设为 `/data` |
| `PORT` | 否 | 服务端口，默认 `3000` |

> ⚠️ **安全提示**：`.env` 文件不应提交到 Git。生产环境请使用平台提供的 Secrets/Variables 功能。

## 部署到 Hugging Face Spaces

1. 在 [Hugging Face](https://huggingface.co) 创建一个 **Docker** 类型的 Space
2. 在 Space Settings 中连接本 GitHub 仓库的 `master` 分支
3. 在 Space Settings → **Variables and Secrets** 中配置上述环境变量
4. 点击 **Factory reboot** 等待构建完成

访问地址：

```
https://<用户名>-graduation-photo-selector.hf.space       # 同学入口
https://<用户名>-graduation-photo-selector.hf.space/admin # 管理员后台
```

## 项目结构

```
graduation-photo-selector/
├── server.js                 # Express 后端 + SQLite + OSS 签名 URL
├── Dockerfile               # Node.js 20 + /data 持久化
├── package.json
├── .env.example             # 环境变量模板
├── .gitignore
├── README.md
├── public/                  # 前端静态资源
│   ├── index.html           # 同学选照片主页
│   ├── admin.html           # 管理员看板
│   ├── dashboard.html       # 个人已选照片看板
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js           # 主页面逻辑
│       └── photo-viewer.js  # 图片查看器
├── scripts/
│   └── scan-oss.js          # 扫描 OSS 输出导入列表
└── test/                    # 测试文件
    ├── helper.js
    ├── sqlite3-shim.js
    ├── auth.test.js
    ├── users.test.js
    ├── selection.test.js
    └── admin.test.js
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/settings` | 获取选择数量、截止时间等配置 |
| POST | `/api/auth/verify` | 验证班级密码 |
| POST | `/api/users` | 用户登记/登录 |
| POST | `/api/selections` | 提交照片选择 |
| GET | `/api/photos` | 分页获取照片列表 |
| POST | `/api/admin/login` | 管理员登录 |
| POST | `/api/admin/stats` | 统计信息 |
| POST | `/api/admin/export` | 导出 CSV |
| POST | `/api/admin/import-photos` | 手动导入照片 |
| POST | `/api/admin/auto-scan` | 触发 OSS 自动扫描 |

## 测试

```bash
# 运行全部测试
npm test

# 运行 lint
npm run lint
```

测试使用 `node --test` 运行，并通过 `better-sqlite3` 兼容层在内存数据库中执行，避免污染本地 `database.sqlite`。

## 安全说明

- **密码验证**：班级密码和管理员密码均通过环境变量配置，不硬编码在代码中
- **Session 认证**：敏感操作需携带 `X-Session-Token` 或 `X-Admin-Token`
- **管理员 Token**：存入数据库，30 分钟过期，不通过 URL 传递
- **输入校验**：后端校验选择数量、ID 唯一性、ID 存在性、截止时间等
- **XSS 防护**：动态内容使用 DOM API + `textContent` 插入
- **限流保护**：`/api/auth/verify`、`/api/users`、`/api/admin/login` 均有 rate limit

## OSS 照片目录结构

系统将 `OSS_ROOT_PREFIX` 下的**子文件夹**识别为分类：

```
<bucket>/
└── 江南中学毕业照/          # OSS_ROOT_PREFIX
    ├── 校园服单人/          → 分类：校园服单人
    ├── 校园服小组/          → 分类：校园服小组
    ├── 篮球服单人/          → 分类：篮球服单人
    └── 运动服小组/          → 分类：运动服小组
```

## 版本管理

- 主仓库：[https://github.com/adolescen/graduation-photo-selector](https://github.com/adolescen/graduation-photo-selector)
- 版本发布：通过 [GitHub Releases](https://github.com/adolescen/graduation-photo-selector/releases) 管理
- 部署镜像：Hugging Face Space 从 GitHub `master` 分支同步

## License

[MIT](LICENSE)

## Changelog

详见 [GitHub Releases](https://github.com/adolescen/graduation-photo-selector/releases)。
