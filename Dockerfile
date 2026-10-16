# Node 20 은 2026-04 지원 종료. sanitize-html(htmlparser2 12)은 Node 22.12+ 필요.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# 앱은 파일을 읽기만 하므로 root 가 아닌 기본 node 사용자로 실행한다.
USER node

# npm start는 PID 1이 npm이라 SIGTERM 시 종료·로그가 실패처럼 보일 수 있음(Railway 재배포 등).
CMD ["node", "server.js"]
