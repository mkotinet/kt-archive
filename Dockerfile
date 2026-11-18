# Node.js 22 Alpine 경량 이미지 (내장 node:sqlite 지원)
FROM node:22-alpine

# 시간대 설정 (KST)
ENV TZ=Asia/Seoul
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

WORKDIR /app

# 의존성 복사 및 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 소스코드 복사
COPY src/ ./src/
COPY public/ ./public/

# 볼륨 디렉토리 준비
RUN mkdir -p /app/data /downloads/KakaoArchive

ENV PORT=5180
ENV DATA_DIR=/app/data
ENV DOWNLOAD_DIR=/downloads/KakaoArchive
ENV NODE_ENV=production

EXPOSE 5180

CMD ["node", "src/server.js"]
