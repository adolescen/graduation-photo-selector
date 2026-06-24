FROM node:20

WORKDIR /app
COPY . .
RUN npm install

EXPOSE 7860
ENV PORT=7860
ENV HF_DATA_DIR=/data

CMD ["node", "server.js"]
