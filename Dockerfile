FROM node:20

WORKDIR /app
COPY . .
RUN npm install

# 确保 Hugging Face Spaces 持久化目录和 ECS 默认数据目录可写
RUN mkdir -p /data /var/lib/graduation-photo-selector && chmod 777 /data /var/lib/graduation-photo-selector

EXPOSE 7860
ENV PORT=7860
ENV HF_DATA_DIR=/data
ENV DATA_DIR=/data

CMD ["node", "server.js"]
