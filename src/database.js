/**
 * SQLite 데이터베이스 관리 (Node.js 22+ 내장 node:sqlite 활용)
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { DATA_DIR, getKSTDateTimeString } = require('./config');

const dbPath = path.join(DATA_DIR, 'archive.db');
const db = new DatabaseSync(dbPath);

// WAL 모드 및 외래키 활성화
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 1. 테이블 초기화
db.exec(`
  -- 대화방 테이블
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'group',
    is_monitored INTEGER DEFAULT 0,
    last_message_at TEXT,
    created_at TEXT NOT NULL
  );

  -- 메시지 테이블
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    sender TEXT NOT NULL,
    message TEXT,
    message_type TEXT DEFAULT 'text',
    attachment_path TEXT,
    attachment_name TEXT,
    sent_at TEXT NOT NULL,
    source TEXT DEFAULT 'android',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_sent ON messages(room_id, sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at DESC);

  -- 자동 스케줄러 설정 테이블
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    room_ids TEXT NOT NULL, -- JSON array of room IDs
    interval_type TEXT NOT NULL, -- 10m, 30m, 1h, 6h, 12h, 1d, 1w, once
    custom_cron TEXT,
    options TEXT NOT NULL, -- JSON object: { downloadMedia, aiSummary, notify }
    is_active INTEGER DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL
  );

  -- 게시판(Board) 피드 테이블 (요약 및 정리 리포트)
  CREATE TABLE IF NOT EXISTS board_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    room_name TEXT NOT NULL,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    media_count INTEGER DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    content_json TEXT, -- 대화 전문 및 미디어 목록 JSON
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_board_posts_created ON board_posts(created_at DESC);

  -- 보안 감사 로그 (공통 지침 7번 준수)
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    client_ip TEXT,
    user_agent TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
`);

console.log(`[Database] SQLite 초기화 완료: ${dbPath}`);

// --- 대화방 (Rooms) 관련 메서드 ---
function upsertRoom(id, name, type = 'group') {
  const stmt = db.prepare(`
    INSERT INTO rooms (id, name, type, last_message_at, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      last_message_at = excluded.last_message_at
  `);
  const now = getKSTDateTimeString();
  stmt.run(String(id), name, type, now, now);
}

function listRooms() {
  const stmt = db.prepare(`
    SELECT r.*, COUNT(m.id) as message_count
    FROM rooms r
    LEFT JOIN messages m ON r.id = m.room_id
    GROUP BY r.id
    ORDER BY r.last_message_at DESC, r.created_at DESC
  `);
  return stmt.all();
}

function setRoomMonitored(id, isMonitored) {
  const stmt = db.prepare('UPDATE rooms SET is_monitored = ? WHERE id = ?');
  stmt.run(isMonitored ? 1 : 0, String(id));
}

// --- 메시지 (Messages) 관련 메서드 ---
function insertMessage({ roomId, roomName, sender, message, messageType = 'text', attachmentPath = null, attachmentName = null, sentAt = null, source = 'android' }) {
  const now = getKSTDateTimeString();
  const actualSentAt = sentAt || now;
  
  // 방 정보 자동 등록/갱신
  upsertRoom(roomId, roomName);

  const stmt = db.prepare(`
    INSERT INTO messages (room_id, room_name, sender, message, message_type, attachment_path, attachment_name, sent_at, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    String(roomId),
    roomName,
    sender,
    message || '',
    messageType,
    attachmentPath,
    attachmentName,
    actualSentAt,
    source,
    now
  );
  return result.lastInsertRowid;
}

function listMessages({ roomId = null, limit = 50, offset = 0, query = null }) {
  let sql = 'SELECT * FROM messages';
  const conditions = [];
  const params = [];

  if (roomId) {
    conditions.push('room_id = ?');
    params.push(String(roomId));
  }
  if (query) {
    conditions.push('(message LIKE ? OR sender LIKE ? OR room_name LIKE ?)');
    const q = `%${query}%`;
    params.push(q, q, q);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function countMessages({ roomId = null, query = null }) {
  let sql = 'SELECT COUNT(*) as count FROM messages';
  const conditions = [];
  const params = [];

  if (roomId) {
    conditions.push('room_id = ?');
    params.push(String(roomId));
  }
  if (query) {
    conditions.push('(message LIKE ? OR sender LIKE ? OR room_name LIKE ?)');
    const q = `%${query}%`;
    params.push(q, q, q);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return row ? row.count : 0;
}

// --- 스케줄러 (Schedules) 관련 메서드 ---
function upsertSchedule({ id, name, roomIds, intervalType, customCron = null, options = {}, isActive = 1 }) {
  const stmt = db.prepare(`
    INSERT INTO schedules (id, name, room_ids, interval_type, custom_cron, options, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      room_ids = excluded.room_ids,
      interval_type = excluded.interval_type,
      custom_cron = excluded.custom_cron,
      options = excluded.options,
      is_active = excluded.is_active
  `);
  const now = getKSTDateTimeString();
  const roomIdsJson = typeof roomIds === 'string' ? roomIds : JSON.stringify(roomIds || []);
  const optionsJson = typeof options === 'string' ? options : JSON.stringify(options || {});
  
  stmt.run(id, name, roomIdsJson, intervalType, customCron, optionsJson, isActive ? 1 : 0, now);
}

function listSchedules() {
  const stmt = db.prepare('SELECT * FROM schedules ORDER BY created_at DESC');
  const rows = stmt.all();
  return rows.map(r => ({
    ...r,
    room_ids: JSON.parse(r.room_ids || '[]'),
    options: JSON.parse(r.options || '{}'),
    is_active: Boolean(r.is_active),
  }));
}

function getSchedule(id) {
  const stmt = db.prepare('SELECT * FROM schedules WHERE id = ?');
  const r = stmt.get(id);
  if (!r) return null;
  return {
    ...r,
    room_ids: JSON.parse(r.room_ids || '[]'),
    options: JSON.parse(r.options || '{}'),
    is_active: Boolean(r.is_active),
  };
}

function updateScheduleRun(id, lastRunAt, nextRunAt) {
  const stmt = db.prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?');
  stmt.run(lastRunAt, nextRunAt, id);
}

function deleteSchedule(id) {
  const stmt = db.prepare('DELETE FROM schedules WHERE id = ?');
  stmt.run(id);
}

// --- 게시판 (Board Posts) 관련 메서드 ---
function insertBoardPost({ title, roomName, summary, messageCount = 0, mediaCount = 0, periodStart = null, periodEnd = null, contentJson = null }) {
  const now = getKSTDateTimeString();
  const stmt = db.prepare(`
    INSERT INTO board_posts (title, room_name, summary, message_count, media_count, period_start, period_end, content_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const contentStr = typeof contentJson === 'string' ? contentJson : JSON.stringify(contentJson || {});
  const res = stmt.run(title, roomName, summary || '', messageCount, mediaCount, periodStart, periodEnd, contentStr, now);
  return res.lastInsertRowid;
}

function listBoardPosts({ limit = 20, offset = 0 }) {
  const stmt = db.prepare('SELECT id, title, room_name, summary, message_count, media_count, period_start, period_end, created_at FROM board_posts ORDER BY id DESC LIMIT ? OFFSET ?');
  return stmt.all(Number(limit), Number(offset));
}

function getBoardPost(id) {
  const stmt = db.prepare('SELECT * FROM board_posts WHERE id = ?');
  return stmt.get(Number(id));
}

// --- 보안 감사 로그 (Audit Logs) 관련 메서드 ---
function insertAuditLog(eventType, clientIp, userAgent, details) {
  const now = getKSTDateTimeString();
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details || {});
  const stmt = db.prepare(`
    INSERT INTO audit_logs (event_type, client_ip, user_agent, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(eventType, clientIp || 'unknown', userAgent || 'unknown', detailsStr, now);

  // 최대 10,000건 유지 (자동 로테이션)
  db.exec('DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 10000)');
}

function listAuditLogs(limit = 100) {
  const stmt = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?');
  return stmt.all(Number(limit));
}

// --- 시스템 통계 (Stats) ---
function getStats() {
  const roomsCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
  const messagesCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const mediaCount = db.prepare("SELECT COUNT(*) as count FROM messages WHERE message_type IN ('image', 'video', 'file')").get().count;
  const schedulesCount = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE is_active = 1').get().count;
  const postsCount = db.prepare('SELECT COUNT(*) as count FROM board_posts').get().count;

  return {
    roomsCount,
    messagesCount,
    mediaCount,
    schedulesCount,
    postsCount,
  };
}

module.exports = {
  db,
  upsertRoom,
  listRooms,
  setRoomMonitored,
  insertMessage,
  listMessages,
  countMessages,
  upsertSchedule,
  listSchedules,
  getSchedule,
  updateScheduleRun,
  deleteSchedule,
  insertBoardPost,
  listBoardPosts,
  getBoardPost,
  insertAuditLog,
  listAuditLogs,
  getStats,
};
