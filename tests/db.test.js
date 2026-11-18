/**
 * 데이터베이스 및 KST 헬퍼 단위 테스트
 */
const assert = require('assert');
const { getKSTDateString, getKSTDateTimeString } = require('../src/config');
const db = require('../src/database');

console.log('--- [Test 1] KST 시간대 헬퍼 검증 ---');
const kstDate = getKSTDateString();
const kstDateTime = getKSTDateTimeString();
console.log(`KST Date: ${kstDate}`);
console.log(`KST DateTime: ${kstDateTime}`);
assert.match(kstDate, /^\d{4}-\d{2}-\d{2}$/, 'KST 날짜 형식이 올바르지 않습니다.');
assert.match(kstDateTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'KST 일시 형식이 올바르지 않습니다.');

console.log('--- [Test 2] 대화방 등록 및 조회 검증 ---');
db.upsertRoom('test-room-1', '가족 단톡방', 'group');
db.upsertRoom('test-room-2', '업무 회의방', 'group');
const rooms = db.listRooms();
assert(rooms.length >= 2, '대화방이 2개 이상 조회되어야 합니다.');
console.log(`등록된 대화방: ${rooms.map(r => r.name).join(', ')}`);

console.log('--- [Test 3] 메시지 저장 및 페이징 검증 ---');
const msgId1 = db.insertMessage({
  roomId: 'test-room-1',
  roomName: '가족 단톡방',
  sender: '아빠',
  message: '오늘 저녁 6시에 모이자!',
  messageType: 'text',
  source: 'android',
});
const msgId2 = db.insertMessage({
  roomId: 'test-room-1',
  roomName: '가족 단톡방',
  sender: '엄마',
  message: '알겠어요 저녁 사진 보냅니다',
  messageType: 'image',
  attachmentPath: '/downloads/KakaoArchive/가족 단톡방/2026-11-18/dinner.jpg',
  attachmentName: 'dinner.jpg',
  source: 'mac',
});
assert(msgId1 > 0 && msgId2 > 0, '메시지가 성공적으로 삽입되어야 합니다.');

const messages = db.listMessages({ roomId: 'test-room-1', limit: 10 });
assert(messages.length >= 2, '메시지 2건 이상 조회되어야 합니다.');
console.log(`조회된 메시지 수: ${messages.length}`);

console.log('--- [Test 4] 스케줄러 등록 및 조회 검증 ---');
db.upsertSchedule({
  id: 'sched-1',
  name: '1시간 주기 가족방 요약 및 미디어 백업',
  roomIds: ['test-room-1'],
  intervalType: '1h',
  options: { downloadMedia: true, aiSummary: true },
  isActive: 1,
});
const sched = db.getSchedule('sched-1');
assert.strictEqual(sched.name, '1시간 주기 가족방 요약 및 미디어 백업');
assert.deepStrictEqual(sched.room_ids, ['test-room-1']);
assert.strictEqual(sched.options.downloadMedia, true);

console.log('--- [Test 5] 게시판(Board) 포스트 등록 검증 ---');
const postId = db.insertBoardPost({
  title: '[가족 단톡방] 1시간 대화 요약 리포트',
  roomName: '가족 단톡방',
  summary: '저녁 식사 약속(18시) 확정 및 저녁 메뉴 사진 공유됨.',
  messageCount: 2,
  mediaCount: 1,
  periodStart: '2026-11-18 11:00:00',
  periodEnd: '2026-11-18 12:00:00',
  contentJson: { highlights: ['18시 저녁 식사'] },
});
assert(postId > 0, '게시글이 성공적으로 등록되어야 합니다.');
const posts = db.listBoardPosts({ limit: 5 });
assert(posts.length >= 1, '게시판 목록이 조회되어야 합니다.');
console.log(`게시판 최신 글: ${posts[0].title}`);

console.log('--- [Test 6] 보안 감사 로그 검증 ---');
db.insertAuditLog('TEST_EVENT', '127.0.0.1', 'Node-Test-Agent', { status: 'success' });
const logs = db.listAuditLogs(5);
assert(logs.length >= 1, '감사 로그가 1건 이상 조회되어야 합니다.');

console.log('--- [Test 7] 시스템 전체 통계 검증 ---');
const stats = db.getStats();
console.log('시스템 통계:', stats);
assert(stats.roomsCount >= 2);
assert(stats.messagesCount >= 2);

console.log('\n✅ 모든 데이터베이스 및 KST 검증 테스트 통과!');
