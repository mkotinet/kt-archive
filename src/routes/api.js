/**
 * 대시보드 프론트엔드용 RESTful API 라우터
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const scheduler = require('../services/scheduler');
const { getKSTDateTimeString } = require('../config');

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

// 대화방 모니터링 토글
router.post('/rooms/:id/monitor', (req, res) => {
  const { id } = req.params;
  const { isMonitored } = req.body;
  db.setRoomMonitored(id, isMonitored);
  return res.json({ success: true, roomId: id, isMonitored: Boolean(isMonitored) });
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
  const mediaList = messages.filter(m => m.attachment_path || ['image', 'video', 'file', 'audio'].includes(m.message_type));
  return res.json({ success: true, data: mediaList });
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
