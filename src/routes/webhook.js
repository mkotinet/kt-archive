/**
 * 안드로이드 메신저봇R 실시간 카카오톡 웹훅 엔드포인트
 */
const express = require('express');
const crypto = require('crypto');
const { WEBHOOK_SECRET, getKSTDateTimeString } = require('../config');
const db = require('../database');

function createWebhookRouter(broadcastWs) {
  const router = express.Router();

  // POST /api/webhook/kakaotalk
  router.post('/kakaotalk', (req, res) => {
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Android-MessengerBot';

    // 1. 보안 인증 검사
    const secret = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret !== WEBHOOK_SECRET) {
      db.insertAuditLog('WEBHOOK_AUTH_FAILED', clientIp, userAgent, { reason: 'Invalid secret key' });
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid secret key' });
    }

    // 2. 바디 데이터 정규화
    // 메신저봇R 또는 안드로이드 알림 리스너 페이로드 호환
    const room = req.body.room || req.body.roomName || '알 수 없는 대화방';
    const sender = req.body.sender || req.body.author || '알 수 없음';
    const message = req.body.msg || req.body.message || req.body.text || '';
    const isGroupChat = req.body.isGroupChat !== undefined ? Boolean(req.body.isGroupChat) : true;
    const sentAt = req.body.sentAt || getKSTDateTimeString();

    // 방 ID 생성 (방 이름 기반 안정적인 해시 ID 생성)
    const roomId = req.body.roomId || 'room_' + crypto.createHash('md5').update(room).digest('hex').substring(0, 16);

    // 메시지 타입 감지
    let messageType = 'text';
    if (message.includes('사진을 보냈습니다')) messageType = 'image_notice';
    else if (message.includes('동영상을 보냈습니다')) messageType = 'video_notice';
    else if (message.includes('파일을 보냈습니다')) messageType = 'file_notice';
    else if (message.includes('이모티콘을 보냈습니다')) messageType = 'emoticon_notice';

    // 3. DB 저장
    const msgId = db.insertMessage({
      roomId,
      roomName: room,
      sender,
      message,
      messageType,
      sentAt,
      source: 'android',
    });

    // 4. 보안 감사 로그
    db.insertAuditLog('WEBHOOK_MESSAGE_RECEIVED', clientIp, userAgent, {
      roomId,
      roomName: room,
      sender,
      messageLength: message.length,
    });

    // 5. 웹 대시보드 실시간 브로드캐스트 (WebSocket)
    if (typeof broadcastWs === 'function') {
      broadcastWs({
        type: 'new_message',
        data: {
          id: msgId,
          roomId,
          roomName: room,
          sender,
          message,
          messageType,
          sentAt,
          source: 'android',
        },
      });
    }

    return res.status(200).json({
      success: true,
      messageId: msgId,
      roomId,
      receivedAt: sentAt,
    });
  });

  return router;
}

module.exports = createWebhookRouter;
