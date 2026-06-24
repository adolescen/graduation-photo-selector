FROM node:20-alpine

# 创建 /data 目录并设置权限（SQLite 持久化存储）
RUN mkdir -p /data && chmod 777 /data

WORKDIR /app
COPY . .
RUN npm install

EXPOSE 7860
ENV PORT=7860
ENV HF_DATA_DIR=/data

CMD ["node", "server.js"]
