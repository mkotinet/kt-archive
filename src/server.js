/**
 * kt-archive 메인 웹 서버 & WebSocket 허브
 */
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

const { PORT, DOWNLOAD_DIR } = require('./config');
const scheduler = require('./services/scheduler');
const apiRouter = require('./routes/api');
const createWebhookRouter = require('./routes/webhook');
const createSyncRouter = require('./routes/sync');

const app = express();
const server = http.createServer(app);

// WebSocket 서버 초기화
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastWs(payload) {
  const messageStr = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// 스케줄러에 WebSocket 브로드캐스트 함수 등록 및 스케줄러 시작
scheduler.setBroadcastWs(broadcastWs);
scheduler.init();

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '..', 'public')));
// 다운로드된 미디어 폴더 서빙 (/media/room/date/file)
app.use('/media', express.static(DOWNLOAD_DIR));

// 라우터 등록
app.use('/api', apiRouter);
app.use('/api/webhook', createWebhookRouter(broadcastWs));
app.use('/api/sync', createSyncRouter(broadcastWs));

// SPA 폴백 라우트
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// WebSocket 연결 이벤트
wss.on('connection', ws => {
  console.log('[WebSocket] 새 클라이언트 연결됨');
  ws.send(JSON.stringify({ type: 'connected', message: 'kt-archive 실시간 스트림 연결 성공' }));

  ws.on('close', () => {
    console.log('[WebSocket] 클라이언트 연결 해제');
  });
});

// 서버 기동
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  kt-archive 웹 서비스 가동 완료 (Port: ${PORT})`);
  console.log(`  로컬 URL:    http://localhost:${PORT}`);
  console.log(`  도메인:      https://kt.danminlove.com`);
  console.log(`  미디어 저장: ${DOWNLOAD_DIR}`);
  console.log(`====================================================`);
});
