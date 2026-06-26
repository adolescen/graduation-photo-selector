#!/usr/bin/env bash
set -e

# 阿里云 ECS 一键部署脚本
# 用法：
#   1. 在 ECS 上安装 Docker
#   2. 复制本脚本到 ECS: scp scripts/ecs-deploy.sh root@<ecs-ip>:/opt/
#   3. SSH 登录后执行: bash /opt/ecs-deploy.sh

APP_NAME="graduation-photo-selector"
REPO_URL="https://github.com/adolescen/graduation-photo-selector.git"
INSTALL_DIR="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
ENV_FILE="/opt/${APP_NAME}.env"
PORT="${PORT:-7860}"

echo "==> 部署 ${APP_NAME} 到阿里云 ECS"

# 1. 安装 Docker（如果未安装）
if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
fi

# 2. 创建数据目录
echo "==> 创建数据目录 ${DATA_DIR}"
mkdir -p "${DATA_DIR}"
chmod 755 "${DATA_DIR}"

# 3. 拉取/更新代码
echo "==> 拉取最新代码..."
if [ -d "${INSTALL_DIR}/.git" ]; then
  cd "${INSTALL_DIR}"
  git pull origin master
else
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
fi

# 4. 检查环境变量文件
if [ ! -f "${ENV_FILE}" ]; then
  echo "==> 首次部署，请编辑环境变量文件: ${ENV_FILE}"
  cp .env.example "${ENV_FILE}"
  echo "================================================"
  echo "请修改 ${ENV_FILE} 中的真实配置后再运行本脚本"
  echo "================================================"
  exit 1
fi

# 5. 构建 Docker 镜像
echo "==> 构建 Docker 镜像..."
docker build -t "${APP_NAME}:latest" .

# 6. 停止并删除旧容器
echo "==> 停止旧容器..."
docker rm -f "${APP_NAME}" 2>/dev/null || true

# 7. 启动新容器
echo "==> 启动新容器..."
docker run -d \
  --name "${APP_NAME}" \
  --restart unless-stopped \
  -p "${PORT}:7860" \
  -v "${DATA_DIR}:/var/lib/${APP_NAME}" \
  -v "${ENV_FILE}:/app/.env:ro" \
  -e "DATA_DIR=/var/lib/${APP_NAME}" \
  "${APP_NAME}:latest"

# 8. 等待服务启动
echo "==> 等待服务启动..."
sleep 5

# 9. 健康检查
if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  echo "==> 部署成功！健康检查通过"
  echo "    访问地址: http://<ECS公网IP>:${PORT}"
else
  echo "==> 健康检查失败，请查看日志: docker logs ${APP_NAME}"
  exit 1
fi

# 10. 显示定时备份提示
echo ""
echo "==> 建议配置每日备份:"
echo "    crontab -e"
echo "    0 2 * * * bash ${INSTALL_DIR}/scripts/backup.sh ${ENV_FILE}"
