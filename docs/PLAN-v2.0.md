# 毕业照片选择系统 v2.0 实施计划

## Context

用户已确认 PRD 方案：
1. **人脸识别照片聚合**：Approach A — 阿里云人脸识别
2. **微信端国内平台迁移**：Approach C — 阿里云 ECS 轻量服务器
3. **数据库**：继续使用 SQLite，部署在 ECS 本地持久化磁盘
4. **域名**：暂不备案，使用 ECS 公网 IP / 阿里云临时域名

下阶段目标：先迁移到阿里云 ECS 让微信访问稳定，再集成人脸识别提升选图效率。

## Milestone 1：阿里云 ECS 部署迁移（优先）

### 目标
- 将服务从 Hugging Face Spaces 迁移到阿里云 ECS 轻量服务器。
- 保证微信内置浏览器能稳定、快速访问。
- 保持现有所有功能不变（同学选图、管理员看板、CSV 导出、OSS 扫描）。

### 关键修改

#### 1.1 数据库目录配置（server.js）
- 当前逻辑：`HF_DATA_DIR` 存在时用 `/data/database.sqlite`，否则用项目目录下的 `database.sqlite`。
- 改为：统一读取 `DATA_DIR` 环境变量，默认 `./data`。
- ECS 上 `DATA_DIR=/var/lib/graduation-photo-selector`，挂载到云盘持久化目录。
- 保持 HF Spaces 兼容：若 `HF_DATA_DIR` 存在，也映射到 `DATA_DIR`。

#### 1.2 Dockerfile 调整
- 当前：`mkdir -p /data && chmod 777 /data`
- 改为：创建 `/var/lib/graduation-photo-selector` 目录，设置合适权限；保持 7860 端口默认，但 ECS 上通过 80/443 反向代理。

#### 1.3 新增部署脚本与文档
- 新增 `scripts/ecs-deploy.sh`：
  - 安装 Docker（如未安装）。
  - 拉取 GitHub 最新代码。
  - 构建镜像。
  - 运行容器，挂载数据目录和 `.env`。
  - 配置 systemd 服务或 cron 自动更新。
- 新增 `docs/DEPLOY-ECS.md`：
  - 购买 ECS 轻量服务器建议配置（1 核 2G、CentOS/Ubuntu）。
  - 安全组开放 80/443（或直接用 7860）。
  - Docker 安装、.env 配置、SSL（可选，可用 certbot）。
  - 备份策略：每日 cron 导出 CSV + 复制 database.sqlite 到 OSS。

#### 1.4 CI/CD（可选但推荐）
- 保留现有 `.github/workflows/sync-to-hf.yml` 作为 HF Spaces 备份。
- 新增 `.github/workflows/build-and-push-ecs.yml`（可选）：
  - 推送时构建 Docker 镜像并上传到阿里云容器镜像服务 ACR。
  - 通过 SSH 登录 ECS 执行 `docker pull && docker restart`。
  - 初次实施可先用 `scripts/ecs-deploy.sh` 手动部署，CI 作为后续优化。

#### 1.5 微信内置浏览器适配
- 检查 `public/index.html`、`public/admin.html`、`public/dashboard.html` 是否使用了第三方 CDN 资源（当前没有）。
- 确保 CSS/JS 全部本地加载，避免微信拦截。
- OSS 图片域名使用国内 Endpoint，避免海外域名被限速。

#### 1.6 健康检查与备份
- 新增 `/health` 已存在，ECS 上可用作探针。
- 新增 `scripts/backup.sh`：导出 CSV + 复制 SQLite 到 OSS 指定目录。
- 新增 systemd timer 或 cron 每日执行备份。

### 验证
1. ECS 上 `docker run` 启动成功，`/health` 返回 ok。
2. 微信内置浏览器访问首页 < 3 秒。
3. 完成一次完整选图流程并导出 CSV。
4. 重启 ECS / 容器后数据不丢失。

## Milestone 2：人脸识别照片聚合

### 目标
- 让同学上传一张参考照片，系统自动聚合同一个人的照片。
- 降低在数百张照片里翻找的时间。

### 关键修改

#### 2.1 新增依赖（package.json）
- `ali-oss` 已存在。
- 新增 `@alicloud/facebody20191230`（阿里云人脸搜索/人脸比对 SDK）或直接使用 OpenAPI 调用。
- 新增 `multer` 已存在，用于接收用户上传的参考照片。

#### 2.2 数据库表变更（server.js）
- 新增 `face_groups` 表：
  ```sql
  CREATE TABLE IF NOT EXISTS face_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aliyun_face_id TEXT,
    representative_photo_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- 为 `photos` 表增加 `face_group_id INTEGER` 字段。
- 新增 `face_search_logs` 表（可选，用于审计和调试）：
  ```sql
  CREATE TABLE IF NOT EXISTS face_search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    result_group_id INTEGER,
    confidence REAL
  );
  ```

#### 2.3 后端接口（server.js 新增模块）
- `POST /api/admin/face/cluster`：管理员触发人脸聚类。
  - 遍历 `photos` 表，对每张照片调用阿里云人脸检测。
  - 将人脸特征注册到阿里云人脸搜索库（库名如 `graduation-photo-selector`）。
  - 根据返回的 FaceId 分组，写入 `face_groups` 表，并更新 `photos.face_group_id`。
  - 注意：照片 URL 需使用 OSS 签名 URL，有效期要足够完成处理。
- `POST /api/face/search`：同学上传参考照片查询。
  - 使用 `multer` 接收上传图片，限制大小（如 5MB）、格式（jpg/png）。
  - 调用阿里云人脸搜索 1:N。
  - 返回匹配到的 `face_group_id` 及该组照片列表。
  - 不持久化参考照片，处理完成后删除临时文件。
- `GET /api/photos?faceGroupId=xxx`：扩展现有照片列表接口，支持按人脸组过滤。

#### 2.4 人脸识别服务封装
- 新增 `lib/face-client.js`：
  - 初始化阿里云 Facebody 客户端。
  - 封装 `detectAndRegisterFace(ossKey, dbPhotoId)`。
  - 封装 `searchFace(imageBuffer)`。
  - 封装 `clearFaceDatabase()`（活动结束后清理人脸库）。

#### 2.5 前端界面
- `public/index.html`：
  - 在“选择照片页”顶部增加「按人脸找照片」入口。
  - 新增人脸搜索弹窗：上传/拍照 → 显示聚合结果 → 在该结果中选择照片。
- `public/js/app.js`：
  - 新增 `openFaceSearch()`、`submitFaceSearch()`、`renderFaceGroupPhotos()` 函数。
  - 聚合结果中点击照片即可选中，与现有选择流程打通。
- `public/admin.html`：
  - 在「导入照片」tab 增加「人脸聚类」按钮。
  - 显示聚类状态（已分组照片数 / 总照片数）。
  - 增加「清理人脸库」按钮（活动结束后）。

#### 2.6 隐私与合规
- 在页面前增加授权文案：
  > “上传照片仅用于帮你找到自己的照片，事件结束后管理员会清理人脸数据。”
- 参考照片不上传到 OSS，仅在内存中临时处理。
- 阿里云人脸搜索库名通过环境变量配置，支持多班级隔离。

#### 2.7 环境变量扩展（.env.example）
```bash
# 数据目录（ECS 上挂载持久化磁盘）
DATA_DIR=/var/lib/graduation-photo-selector

# 阿里云人脸识别
FACE_ENABLED=true
FACE_ALIYUN_ACCESS_KEY_ID=your-access-key
FACE_ALIYUN_ACCESS_KEY_SECRET=your-access-secret
FACE_ALIYUN_ENDPOINT=facebody.cn-shanghai.aliyuncs.com
FACE_DB_NAME=graduation-photo-selector
FACE_SEARCH_REGION=cn-shanghai
```

### 验证
1. 管理员导入照片后点击「人脸聚类」，所有照片被正确分组。
2. 同学上传参考照片，3 秒内返回自己的照片集合。
3. 同一人主要照片召回率 ≥ 80%（用真实班级照片测试）。
4. 非班级成员上传参考照片返回空或低置信度提示。
5. 活动结束后管理员可清理人脸库。

## 测试策略

- 单元测试：
  - 新增 `test/face.test.js`：模拟阿里云 Facebody 客户端，测试聚类和搜索接口。
  - 测试文件上传限制、无 faceGroupId 过滤、聚类后照片分组正确性。
- 集成测试：
  - ECS 部署后完整 E2E：进入 → 登记 → 人脸搜索 → 选图 → 提交 → 导出 CSV。
- 回归测试：
  - `npm test` 全部通过，`npx eslint .` 无错误。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| ECS 固定成本超出预算 | 每月几十元固定支出 | 选择最低配轻量服务器；活动结束后可释放 |
| 阿里云人脸识别准确率不足 | 同学找不到照片 | 保留瀑布流浏览作为 fallback；管理员可手动校正 |
| 人脸数据合规争议 | 法律/家长信任风险 | 明确授权文案；事件后清理人脸库；参考照片不持久化 |
| SQLite 并发锁（ECS 也可能多用户同时提交） | 提交失败 | 使用 WAL 模式；必要时升级到 RDS MySQL |
| 部署中断导致活动受影响 | 无法访问 | 保留 HF Spaces 作为备份入口；活动前预热 ECS |

## 执行顺序

1. 先实施 Milestone 1（ECS 部署迁移），完成后发布 `v1.2.0`。
2. 验证 ECS 稳定运行、微信访问正常。
3. 再实施 Milestone 2（人脸识别），完成后发布 `v2.0.0`。
4. 每次 Milestone 完成后运行 `npm test`、`npx eslint .`、创建 GitHub Release。

## 关键文件清单

### Milestone 1
- [server.js](../server.js) — 数据目录逻辑调整
- [Dockerfile](../Dockerfile) — 数据目录创建
- [scripts/ecs-deploy.sh](../scripts/ecs-deploy.sh) — 新增
- [scripts/backup.sh](../scripts/backup.sh) — 新增
- [docs/DEPLOY-ECS.md](DEPLOY-ECS.md) — 新增
- [.env.example](../.env.example) — 新增 DATA_DIR

### Milestone 2
- [server.js](../server.js) — 新增人脸相关接口
- [package.json](../package.json) — 新增阿里云 Facebody SDK
- [lib/face-client.js](../lib/face-client.js) — 新增
- [public/index.html](../public/index.html) — 新增人脸搜索入口
- [public/js/app.js](../public/js/app.js) — 新增人脸搜索逻辑
- [public/admin.html](../public/admin.html) — 新增聚类按钮
- [.env.example](../.env.example) — 新增人脸识别配置
- [test/face.test.js](../test/face.test.js) — 新增测试
