# 阿里云 ECS 部署指南

本指南说明如何将毕业照片选择系统部署到阿里云 ECS 轻量服务器，以获得更稳定的微信访问体验。

## 推荐配置

- **实例类型**：阿里云 ECS 轻量应用服务器（或 ECS 共享型 n4）
- **配置**：1 核 2G 内存、40GB 云盘（最低配即可）
- **系统**：Ubuntu 22.04 LTS 或 CentOS 8
- **带宽**：3Mbps 及以上
- **费用**：约 50-100 元/月

## 前置条件

1. 已购买阿里云 ECS 实例，并获取公网 IP。
2. 已在安全组中开放访问端口（默认 `7860`，或自定义 80/443）。
3. 已准备 `.env` 文件，包含真实环境变量（CLASS_PASSWORD、ADMIN_PASSWORD、OSS 配置等）。

## 快速部署

### 1. 本地准备

复制部署脚本和环境变量到 ECS：

```bash
scp scripts/ecs-deploy.sh root@<ECS公网IP>:/opt/
scp .env root@<ECS公网IP>:/opt/graduation-photo-selector.env
```

### 2. 登录 ECS 执行部署

```bash
ssh root@<ECS公网IP>
bash /opt/ecs-deploy.sh
```

首次运行会提示你编辑 `/opt/graduation-photo-selector.env`，请修改后再次运行脚本。

### 3. 访问服务

部署成功后访问：

```
http://<ECS公网IP>:7860
```

管理员后台：

```
http://<ECS公网IP>:7860/admin
```

## 使用 80/443 端口（可选）

如果希望使用标准 80 或 443 端口，可以在 ECS 上安装 Nginx 反向代理：

```bash
apt update && apt install -y nginx
```

创建 `/etc/nginx/sites-available/graduation-photo-selector`：

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:7860;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/graduation-photo-selector /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

## 配置 HTTPS（可选）

使用 Let's Encrypt 免费证书：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

> 注意：使用自定义域名需要完成 ICP 备案。MVP 阶段可直接使用 ECS 公网 IP 访问。

## 数据持久化

数据库和备份默认存储在 ECS 的 `/var/lib/graduation-photo-selector` 目录，该目录已挂载到容器内。即使容器重建，数据也不会丢失。

## 每日自动备份

编辑 ECS 的 crontab：

```bash
crontab -e
```

添加：

```
0 2 * * * bash /opt/graduation-photo-selector/scripts/backup.sh /opt/graduation-photo-selector.env >> /var/log/graduation-backup.log 2>&1
```

备份内容：
- SQLite 数据库副本
- 全班选择结果 CSV
- （可选）上传到 OSS

## 更新服务

代码更新后，重新执行部署脚本：

```bash
ssh root@<ECS公网IP>
bash /opt/ecs-deploy.sh
```

脚本会自动拉取 GitHub 最新代码、重建镜像、重启容器。

## 故障排查

### 查看容器日志

```bash
docker logs graduation-photo-selector
```

### 健康检查

```bash
curl http://localhost:7860/health
```

### 数据库位置

```bash
/var/lib/graduation-photo-selector/database.sqlite
```

### 备份位置

```bash
/var/lib/graduation-photo-selector/backups/
```

## 保留 HF Spaces 作为备份入口

当前 `.github/workflows/sync-to-hf.yml` 仍会保持 HF Spaces 与 GitHub `master` 分支同步。在 ECS 稳定运行前，可以保留 HF Spaces 地址作为备用入口。

## 迁移后检查清单

- [ ] ECS 上 `/health` 返回 ok
- [ ] 微信内置浏览器访问首页 < 3 秒
- [ ] 班级密码能正常进入
- [ ] 能完成选图并提交
- [ ] 管理员能登录、查看统计、导出 CSV
- [ ] 重启 ECS 后数据不丢失
- [ ] 每日备份 cron 已配置
- [ ] 已将新地址分发到班级群
