# 毕业照片选择系统

一个轻量级的班级毕业照片投票网站，支持照片浏览、每人选8张、自动统计汇总。

## 功能特点

- 📱 **手机优先**：响应式设计，微信内置浏览器完美兼容
- 🔐 **密码访问**：班级密码控制访问，短期使用后失效
- 👤 **姓名登记**：填写姓名后开始选择，防止重复提交
- 📸 **分类浏览**：个人照 / 小组照 / 集体照 分类筛选
- ✅ **强制8张**：必须选满8张才能提交，实时进度提示
- ⏰ **截止时间**：截止前可反复修改，截止后锁定
- 📊 **统计看板**：管理员总览 + 个人看板
- 📥 **导出CSV**：一键导出所有人的选择结果

## 技术栈

- 后端：Node.js + Express + SQLite（零配置数据库）
- 前端：纯 HTML + CSS + JS
- 存储：阿里云 OSS（你已有）
- 部署：支持本地运行或部署到免费云平台

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填写以下配置：

```bash
# 班级访问密码（分享给同学）
CLASS_PASSWORD=你的班级密码

# 管理员密码（你自己用）
ADMIN_PASSWORD=admin123

# 截止时间（ISO 8601 格式）
DEADLINE=2024-12-31T23:59:59

# 阿里云 OSS 配置
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=your-bucket
OSS_ACCESS_KEY_ID=your-key
OSS_ACCESS_KEY_SECRET=your-secret
OSS_ENDPOINT=https://your-bucket.oss-cn-hangzhou.aliyuncs.com
```

### 3. 将照片上传到阿里云 OSS

建议按以下目录结构上传：

```
your-bucket/
├── graduation/
│   ├── personal/      # 个人照
│   ├── group/         # 小组照
│   └── class/         # 集体照
```

### 4. 导入照片到系统

访问管理员页面 `http://localhost:3000/admin.html`，在"导入照片"标签页中批量导入照片列表。

导入格式：
```
个人照|graduation/personal/img_001.jpg|张三
小组照|graduation/group/img_002.jpg|小组1
集体照|graduation/class/img_003.jpg|全班合影
```

或者使用命令行工具批量导入：

```bash
# 扫描 OSS 并自动生成导入列表
node scripts/scan-oss.js
```

### 5. 启动服务

```bash
npm start
```

服务将在 `http://localhost:3000` 运行。

## 部署到免费平台

### 推荐：Hugging Face Spaces（完全免费 + 数据持久化）

**为什么选择 Hugging Face Spaces？**
- ✅ 完全免费，无需信用卡
- ✅ 提供 2vCPU + 16GB RAM
- ✅ **`/data` 目录持久化** — SQLite 数据不会丢失
- ✅ 无休眠，24/7 运行
- ✅ 直接从 GitHub 部署

#### 部署步骤

1. **注册 Hugging Face 账号**
   打开 [huggingface.co](https://huggingface.co) 注册（支持 GitHub 快捷登录）

2. **创建 Space**
   - 点击头像 → **New Space**
   - Space name: `graduation-photo-selector`
   - License: MIT
   - Select the Space SDK: **Docker**
   - 点击 **Create Space**

3. **连接 GitHub**
   - 在 Space 设置中，选择 **GitHub** 作为代码来源
   - 连接你的 GitHub 账号 `adolescen`
   - 选择仓库 `graduation-photo-selector`
   - 选择分支 `master`
   - 点击 **Link to GitHub**

4. **配置环境变量**
   在 Space 的 **Settings** → **Variables and Secrets** 中添加：

   ```
   CLASS_PASSWORD=你的班级密码
   ADMIN_PASSWORD=你的管理员密码
   DEADLINE=2024-12-31T23:59:59
   OSS_REGION=oss-cn-hangzhou
   OSS_BUCKET=adolescen
   OSS_ACCESS_KEY_ID=你的AccessKey
   OSS_ACCESS_KEY_SECRET=你的AccessKeySecret
   OSS_ENDPOINT=https://jiangnan-1287723839582687.oss-cn-hangzhou.oss-accesspoint.aliyuncs.com
   HF_DATA_DIR=/data
   ```

5. **等待构建**
   Hugging Face 会自动拉取代码并构建 Docker 镜像。首次构建需要 3-5 分钟。

6. **导入照片**
   部署成功后，访问：
   ```
   https://adolescen-graduation-photo-selector.hf.space/admin.html
   ```
   输入管理员密码，在 **导入照片** 标签页中导入照片列表。

7. **分享链接**
   ```
   https://adolescen-graduation-photo-selector.hf.space
   ```
   将链接和班级密码发到班级群。

---

### 备选：Render（免费但有休眠）

如果你不想用 Hugging Face，Render 也是一个选择，但免费版有 15 分钟休眠机制：
- 15 分钟无访问后休眠，下次访问需等待 30 秒唤醒
- SQLite 数据在休眠后可能丢失（需要定期导出 CSV 备份）

部署步骤见 [Render 部署指南](https://render.com/docs/deploy-node-express-app)。

---

## 本地运行

```bash
npm install
npm start
```

服务将在 `http://localhost:3000` 运行。

---
## 使用流程

### 同学端
1. 打开网站链接，输入班级密码
2. 填写真实姓名
3. 浏览照片，使用分类筛选快速定位
4. 点击照片选中，再次点击取消
5. 必须选满 **8张**，提交按钮才会激活
6. 提交前会弹出确认窗口，展示已选8张照片
7. 可随时进入"我的选择"查看或修改

### 管理员端
1. 访问 `/admin.html`，输入管理员密码
2. 查看统计看板：参与人数、完成率、截止时间
3. 查看每个人选了什么照片
4. 查看照片热度（哪张照片最受欢迎）
5. 导出 CSV 到 Excel 进一步处理

## 注意事项

1. **照片隐私**：毕业照片涉及肖像权，建议设置班级密码并控制传播范围
2. **OSS 费用**：几百张照片通过缩略图访问，流量费用很低（阿里云 OSS 按量计费，通常几毛钱）
3. **数据备份**：`database.sqlite` 是数据库文件，定期备份以防丢失
4. **截止日期**：超过截止日期后，系统会锁定选择，只能查看统计
5. **SQLite 限制**：并发写入性能一般，但班级几十人同时访问完全没问题

## 照片缩略图

阿里云 OSS 支持图片处理，系统会自动在 URL 后添加缩略图参数：

```
?x-oss-process=image/resize,w_400,quality_80
```

确保你的 OSS Bucket 已开启图片处理服务（默认支持）。

## 常见问题

**Q: 照片还没上传到 OSS，怎么批量处理？**  
A: 先将照片从百度网盘下载到本地，然后使用阿里云 OSS 控制台或 ossutil 工具批量上传。

**Q: 如何快速获取所有照片的 OSS 路径？**  
A: 在阿里云 OSS 控制台，可以导出文件列表；或者使用本项目的 `scripts/scan-oss.js` 脚本扫描。

**Q: 同学误操作提交了别人的名字怎么办？**  
A: 管理员可以在统计页面看到重复或异常姓名，提醒同学重新提交即可。数据库会保留最新记录。

**Q: 可以限制每人只能提交一次吗？**  
A: 当前设计是截止前可修改，如需严格限制一次，可以修改 `server.js` 中的更新逻辑。

## 目录结构

```
graduation-photo-selector/
├── server.js              # 后端主文件
├── database.sqlite        # 数据库文件（自动创建）
├── package.json
├── .env.example           # 环境变量示例
├── .env                   # 环境变量（不提交到 Git）
├── public/
│   ├── index.html         # 主页面（选择照片）
│   ├── admin.html         # 管理员看板
│   ├── dashboard.html     # 个人看板
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── scripts/
    └── scan-oss.js        # OSS 扫描工具（可选）
```

## License

MIT
