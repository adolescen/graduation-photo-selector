FROM node:20

WORKDIR /app
COPY . .
RUN npm install

# 确保 Hugging Face Spaces 持久化目录可写
RUN mkdir -p /data && chmod 777 /data

EXPOSE 7860
ENV PORT=7860
ENV HF_DATA_DIR=/data

CMD ["node", "server.js"]
