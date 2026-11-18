/**
 * 대시보드 프론트엔드용 RESTful API 라우터
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const scheduler = require('../services/scheduler');
const { DOWNLOAD_DIR, getKSTDateTimeString } = require('../config');

const router = express.Router();

// 시스템 통계
router.get('/stats', (req, res) => {
  return res.json({ success: true, data: db.getStats() });
});

// 대화방 목록
router.get('/rooms', (req, res) => {
  const rooms = db.listRooms();
  return res.json({ success: true, data: rooms });
});

// 대화방 이름 변경
router.patch('/rooms/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: '새 대화방 이름을 입력하세요.' });
  }
  const ok = db.updateRoomName(id, name.trim());
  return res.json({ success: ok, roomId: id, name: name.trim() });
});

// 대화방 병합 (발신자별로 파편화된 방들을 단체방으로 통합)
router.post('/rooms/merge', (req, res) => {
  const { targetRoomId, sourceRoomIds } = req.body;
  if (!targetRoomId || !sourceRoomIds || !Array.isArray(sourceRoomIds)) {
    return res.status(400).json({ success: false, error: 'targetRoomId와 sourceRoomIds 배열이 필요합니다.' });
  }
  const result = db.mergeRooms(targetRoomId, sourceRoomIds);
  return res.json(result);
});

// 대화방 모니터링 토글
router.post('/rooms/:id/monitor', (req, res) => {
  const { id } = req.params;
  const { isMonitored } = req.body;
  db.setRoomMonitored(id, isMonitored);
  return res.json({ success: true, roomId: id, isMonitored: Boolean(isMonitored) });
});

// 대화방 일별 집계 목록 (KST YYYY-MM-DD 그룹핑)
router.get('/rooms/:id/daily-summaries', (req, res) => {
  const { id } = req.params;
  const summaries = db.getRoomDailySummaries(id);
  return res.json({ success: true, roomId: id, data: summaries });
});

// 대화방 특정 일자의 대화 분석 및 일일 브리핑 요약
router.get('/rooms/:id/daily/:date', (req, res) => {
  const { id, date } = req.params;
  const messages = db.getRoomMessagesByDate(id, date);
  if (!messages || messages.length === 0) {
    return res.json({
      success: true,
      roomId: id,
      date,
      messageCount: 0,
      summary: '해당 일자에 기록된 대화 내역이 없습니다.',
      keyEvents: [],
      senderStats: {},
      messages: [],
    });
  }

  // 발언자별 통계
  const senderStats = {};
  messages.forEach(m => {
    senderStats[m.sender] = (senderStats[m.sender] || 0) + 1;
  });

  // 주요 키워드 및 업무 보고 감지
  const keyEvents = [];
  messages.forEach(m => {
    const text = m.message || '';
    if (text.includes('TBM') || text.includes('조출')) {
      keyEvents.push({ type: 'TBM', sender: m.sender, time: m.sent_at, snippet: text.substring(0, 100) });
    } else if (text.includes('작업 종료') || text.includes('철야 작업')) {
      keyEvents.push({ type: '작업종료', sender: m.sender, time: m.sent_at, snippet: text.substring(0, 100) });
    } else if (text.includes('통제구역') || text.includes('안전') || text.includes('점검')) {
      keyEvents.push({ type: '안전점검', sender: m.sender, time: m.sent_at, snippet: text.substring(0, 100) });
    } else if (text.includes('도면') || text.includes('설치') || text.includes('공사')) {
      keyEvents.push({ type: '공사보고', sender: m.sender, time: m.sent_at, snippet: text.substring(0, 100) });
    }
  });

  // 일일 브리핑 요약문 작성
  const topSenders = Object.entries(senderStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s, c]) => `${s}(${c}건)`)
    .join(', ');

  const summary = `📅 [${date} 일일 대화 종합 요약]\n` +
    `• 총 대화량: ${messages.length}건 (주요 발언자: ${topSenders})\n` +
    `• 주요 현장 보고: 총 ${keyEvents.length}건 확인됨 ` +
    (keyEvents.length > 0 ? `(${keyEvents.map(e => e.type).slice(0, 4).join(', ')})` : '') + `\n` +
    (keyEvents.length > 0 ? `• 최근 이슈: ${keyEvents[keyEvents.length - 1].sender} - ${keyEvents[keyEvents.length - 1].snippet.replace(/\n/g, ' ')}` : '• 일상적인 대화 및 업무 소통 진행');

  return res.json({
    success: true,
    roomId: id,
    roomName: messages[0].room_name,
    date,
    messageCount: messages.length,
    summary,
    keyEvents,
    senderStats,
    messages,
  });
});

// 특정 일자의 요약을 [아카이브 게시판] 피드로 발행
router.post('/rooms/:id/daily/:date/publish', (req, res) => {
  const { id, date } = req.params;
  const messages = db.getRoomMessagesByDate(id, date);
  if (!messages || messages.length === 0) {
    return res.status(400).json({ success: false, error: '발행할 대화 내역이 없습니다.' });
  }

  const roomName = messages[0].room_name;
  const mediaCount = messages.filter(m => m.attachment_path || ['image', 'video', 'file'].includes(m.message_type)).length;

  const postId = db.insertBoardPost({
    title: `[${roomName}] ${date} 일일 대화 리포트 & 브리핑`,
    roomName,
    summary: req.body.summary || `${date} 총 ${messages.length}건의 대화 및 현장 이슈 정리`,
    messageCount: messages.length,
    mediaCount,
    periodStart: messages[0].sent_at,
    periodEnd: messages[messages.length - 1].sent_at,
    contentJson: {
      date,
      keyEvents: req.body.keyEvents || [],
      senderStats: req.body.senderStats || {},
      messages: messages.slice(0, 100),
    },
  });

  return res.json({ success: true, postId, message: '게시판에 성공적으로 발행되었습니다.' });
});

// 메시지 목록 및 검색
router.get('/messages', (req, res) => {
  const { roomId, query, limit = 50, offset = 0 } = req.query;
  const messages = db.listMessages({ roomId, query, limit, offset });
  const total = db.countMessages({ roomId, query });
  return res.json({ success: true, data: messages, total });
});

// 미디어 파일 목록
router.get('/media', (req, res) => {
  const { roomId, limit = 60, offset = 0 } = req.query;
  const messages = db.listMessages({ roomId, limit, offset });
  const mediaList = messages.filter(m => m.attachment_path || ['image', 'video', 'file', 'audio', 'image_notice', 'video_notice'].includes(m.message_type));
  
  const mapped = mediaList.map(m => {
    let exists = false;
    let fullPath = null;
    if (m.attachment_path) {
      const cleanRel = m.attachment_path.replace(/^\/media\//, '');
      fullPath = path.join(DOWNLOAD_DIR, cleanRel);
      exists = fs.existsSync(fullPath);
    }
    return {
      ...m,
      isDownloaded: exists,
      downloadUrl: exists ? `/api/media/${m.id}/download` : (m.attachment_path || null),
    };
  });

  return res.json({ success: true, data: mapped });
});

// 미디어 파일 직접 다운로드
router.get('/media/:id/download', (req, res) => {
  const { id } = req.params;
  const stmt = db.db.prepare('SELECT * FROM messages WHERE id = ?');
  const msg = stmt.get(Number(id));
  if (!msg || !msg.attachment_path) {
    return res.status(404).json({ success: false, error: '해당 미디어 파일을 찾을 수 없습니다.' });
  }

  const cleanRel = msg.attachment_path.replace(/^\/media\//, '');
  const fullPath = path.isAbsolute(msg.attachment_path) ? msg.attachment_path : path.join(DOWNLOAD_DIR, cleanRel);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: '서버 스토리지에 파일이 존재하지 않습니다.' });
  }

  const filename = msg.attachment_name || path.basename(fullPath);
  return res.download(fullPath, filename);
});

// 스케줄 목록
router.get('/schedules', (req, res) => {
  const schedules = db.listSchedules();
  return res.json({ success: true, data: schedules });
});

// 스케줄 등록 및 수정
router.post('/schedules', (req, res) => {
  const { id, name, roomIds, intervalType, customCron, options, isActive = 1 } = req.body;
  const scheduleId = id || 'sched_' + crypto.randomUUID().substring(0, 8);
  const schedData = {
    id: scheduleId,
    name: name || '자동 수집 및 정리 스케줄',
    roomIds: roomIds || [],
    intervalType: intervalType || '1h',
    customCron,
    options: options || { downloadMedia: true, aiSummary: true },
    isActive: isActive ? 1 : 0,
  };

  db.upsertSchedule(schedData);
  const updated = db.getSchedule(scheduleId);
  scheduler.scheduleJob(updated);

  return res.json({ success: true, data: updated });
});

// 스케줄 즉시 수동 실행 (온디맨드 트리거)
router.post('/schedules/:id/run', async (req, res) => {
  const { id } = req.params;
  try {
    await scheduler.executeSchedule(id);
    return res.json({ success: true, message: '스케줄이 성공적으로 실행되었습니다.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 스케줄 삭제
router.delete('/schedules/:id', (req, res) => {
  const { id } = req.params;
  scheduler.cancelJob(id);
  db.deleteSchedule(id);
  return res.json({ success: true, message: '스케줄이 삭제되었습니다.' });
});

// 게시판 피드 목록
router.get('/board', (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const posts = db.listBoardPosts({ limit, offset });
  return res.json({ success: true, data: posts });
});

// 게시판 상세 조회
router.get('/board/:id', (req, res) => {
  const { id } = req.params;
  const post = db.getBoardPost(id);
  if (!post) {
    return res.status(404).json({ success: false, error: '게시글을 찾을 수 없습니다.' });
  }
  return res.json({
    success: true,
    data: {
      ...post,
      content_json: JSON.parse(post.content_json || '{}'),
    },
  });
});

// 보안 감사 로그 (관리자용)
router.get('/audit-logs', (req, res) => {
  const { limit = 50 } = req.query;
  const logs = db.listAuditLogs(limit);
  return res.json({ success: true, data: logs });
});

module.exports = router;
