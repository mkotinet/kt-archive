/**
 * 맥북 kakao-mcp 고화질 미디어 및 과거 대화 내역 동기화 엔드포인트
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DOWNLOAD_DIR, WEBHOOK_SECRET, getKSTDateString, getKSTDateTimeString } = require('../config');
const db = require('../database');

function createSyncRouter(broadcastWs) {
  const router = express.Router();

  // 안전한 폴더/파일명 정리 헬퍼
  function sanitizePathSegment(name) {
    return (name || 'common').replace(/[/\\?%*:|"<>]/g, '_').trim();
  }

  // Multer 디스크 스토리지 구성: /downloads/KakaoArchive/{roomName}/{YYYY-MM-DD}/
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const roomName = sanitizePathSegment(req.body.roomName || '일반대화');
      const dateStr = getKSTDateString();
      const targetDir = path.join(DOWNLOAD_DIR, roomName, dateStr);
      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      const original = file.originalname || 'media_file';
      const timestamp = Date.now();
      const ext = path.extname(original);
      const base = path.basename(original, ext);
      const safeName = `${sanitizePathSegment(base)}_${timestamp}${ext}`;
      cb(null, safeName);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 최대 500MB 단일 파일 허용
  });

  // 미디어 파일 업로드 (사진, 동영상, 음성, 문서 등)
  router.post('/media', upload.single('file'), (req, res) => {
    const secret = req.headers['x-sync-secret'] || req.headers['x-webhook-secret'] || req.query.secret;
    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid secret key' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { roomId, roomName, sender, message, sentAt, mediaType } = req.body;
    const finalRoomName = roomName || '카카오톡 미디어';
    const finalRoomId = roomId || 'room_' + Date.now();
    const finalSender = sender || '알 수 없음';
    
    // 파일 타입 결정
    let determinedType = mediaType || 'file';
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
      determinedType = 'image';
    } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
      determinedType = 'video';
    } else if (['.m4a', '.mp3', '.wav', '.ogg'].includes(ext)) {
      determinedType = 'audio';
    }

    // DB에 메시지 및 첨부파일 정보 기록
    const relativePath = path.relative(DOWNLOAD_DIR, req.file.path);
    const msgId = db.insertMessage({
      roomId: finalRoomId,
      roomName: finalRoomName,
      sender: finalSender,
      message: message || `[${determinedType.toUpperCase()}] ${req.file.originalname}`,
      messageType: determinedType,
      attachmentPath: `/media/${relativePath}`, // 정적 서빙 경로
      attachmentName: req.file.originalname,
      sentAt: sentAt || getKSTDateTimeString(),
      source: 'mac_sync',
    });

    console.log(`[Media Uploaded] ${req.file.path} (ID: ${msgId})`);

    // 실시간 브로드캐스트
    if (typeof broadcastWs === 'function') {
      broadcastWs({
        type: 'new_media',
        data: {
          id: msgId,
          roomId: finalRoomId,
          roomName: finalRoomName,
          sender: finalSender,
          messageType: determinedType,
          attachmentPath: `/media/${relativePath}`,
          attachmentName: req.file.originalname,
          sentAt: sentAt || getKSTDateTimeString(),
        },
      });
    }

    return res.status(200).json({
      success: true,
      messageId: msgId,
      filePath: req.file.path,
      servePath: `/media/${relativePath}`,
    });
  });

  // 대량 메시지/대화내역 일괄 동기화
  router.post('/messages', express.json({ limit: '50mb' }), (req, res) => {
    const secret = req.headers['x-sync-secret'] || req.headers['x-webhook-secret'] || req.query.secret;
    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid secret key' });
    }

    const { messages = [] } = req.body;
    let insertedCount = 0;

    for (const msg of messages) {
      try {
        db.insertMessage({
          roomId: msg.roomId,
          roomName: msg.roomName,
          sender: msg.sender,
          message: msg.message,
          messageType: msg.messageType || 'text',
          attachmentPath: msg.attachmentPath,
          attachmentName: msg.attachmentName,
          sentAt: msg.sentAt,
          source: 'mac_history',
        });
        insertedCount++;
      } catch (err) {
        console.error('[Sync Error]', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      insertedCount,
      totalReceived: messages.length,
    });
  });

  // 현재 모니터링/선택된 대화방 목록 조회 (맥북 에이전트가 어떤 방을 동기화할지 확인할 때 사용)
  router.get('/monitored-rooms', (req, res) => {
    const rooms = db.listRooms();
    const monitored = rooms.filter(r => r.is_monitored === 1);
    return res.status(200).json({
      success: true,
      rooms: monitored.length > 0 ? monitored : rooms, // 설정된 방이 없으면 전체 전달
    });
  });

  return router;
}

module.exports = createSyncRouter;
