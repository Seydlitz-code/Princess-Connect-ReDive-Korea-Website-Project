FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# npm start는 PID 1이 npm이라 SIGTERM 시 종료·로그가 실패처럼 보일 수 있음(Railway 재배포 등).
CMD ["node", "server.js"]
