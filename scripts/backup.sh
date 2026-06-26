#!/usr/bin/env bash
set -e

# 每日备份脚本
# 用法：bash scripts/backup.sh /path/to/.env
# 建议通过 cron 每日执行：
#   0 2 * * * bash /opt/graduation-photo-selector/scripts/backup.sh /opt/graduation-photo-selector.env

ENV_FILE="${1:-/app/.env}"
APP_NAME="graduation-photo-selector"
DATA_DIR="/var/lib/${APP_NAME}"
DB_PATH="${DATA_DIR}/database.sqlite"
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: 环境变量文件不存在: ${ENV_FILE}"
  exit 1
fi

# 加载环境变量
set -a
source "${ENV_FILE}"
set +a

mkdir -p "${BACKUP_DIR}"

echo "==> 开始备份 ${TIMESTAMP}"

# 1. 备份 SQLite 数据库
if [ -f "${DB_PATH}" ]; then
  cp "${DB_PATH}" "${BACKUP_DIR}/database-${TIMESTAMP}.sqlite"
  echo "==> 数据库已备份: ${BACKUP_DIR}/database-${TIMESTAMP}.sqlite"
else
  echo "WARNING: 数据库文件不存在: ${DB_PATH}"
fi

# 2. 导出 CSV（如果服务正在运行）
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
BASE_URL="http://localhost:7860"
CSV_FILE="${BACKUP_DIR}/selections-${TIMESTAMP}.csv"

if [ -n "${ADMIN_PASSWORD}" ] && curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  TOKEN=$(curl -fsS -X POST "${BASE_URL}/api/admin/login" \
    -H 'Content-Type: application/json' \
    -d "{\"password\":\"${ADMIN_PASSWORD}\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

  if [ -n "${TOKEN}" ]; then
    curl -fsS -X POST "${BASE_URL}/api/admin/export" \
      -H "X-Admin-Token: ${TOKEN}" \
      -o "${CSV_FILE}"
    echo "==> CSV 已导出: ${CSV_FILE}"
  else
    echo "WARNING: 管理员登录失败，CSV 导出跳过"
  fi
else
  echo "WARNING: 服务未运行或未配置 ADMIN_PASSWORD，CSV 导出跳过"
fi

# 3. 上传到 OSS（如果已配置）
if command -v ossutil >/dev/null 2>&1 && [ -n "${OSS_BUCKET}" ]; then
  ossutil cp -r "${BACKUP_DIR}/" "oss://${OSS_BUCKET}/backups/${APP_NAME}/" --update
  echo "==> 备份已上传到 OSS"
fi

# 4. 清理 7 天前的本地备份
find "${BACKUP_DIR}" -type f -mtime +7 -delete

echo "==> 备份完成"
