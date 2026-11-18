/**
 * 자동 스케줄러 엔진 (10분, 30분, 1시간, 12시간, 일간, 주간, 1회성 등)
 */
const cron = require('node-cron');
const db = require('../database');
const { getKSTDateTimeString, getKSTDateString } = require('../config');

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.broadcastWs = null;
  }

  setBroadcastWs(broadcastWs) {
    this.broadcastWs = broadcastWs;
  }

  /**
   * intervalType을 표준 Cron 표현식으로 변환
   */
  getIntervalCron(intervalType, customCron) {
    if (customCron) return customCron;
    switch (intervalType) {
      case '10m': return '*/10 * * * *';
      case '30m': return '*/30 * * * *';
      case '1h':  return '0 * * * *';
      case '6h':  return '0 */6 * * *';
      case '12h': return '0 */12 * * *';
      case '1d':  return '0 9 * * *'; // 매일 오전 9시 KST
      case '1w':  return '0 9 * * 1'; // 매주 월요일 오전 9시 KST
      default:    return '0 * * * *';
    }
  }

  /**
   * 서버 시작 시 DB에 등록된 활성 스케줄 모두 로드
   */
  init() {
    const schedules = db.listSchedules();
    console.log(`[Scheduler] 등록된 스케줄 ${schedules.length}개 로딩 중...`);
    for (const sched of schedules) {
      if (sched.is_active) {
        this.scheduleJob(sched);
      }
    }
  }

  /**
   * 단일 스케줄 등록 및 실행 예약
   */
  scheduleJob(sched) {
    // 기존 작업이 있으면 취소
    this.cancelJob(sched.id);

    if (sched.interval_type === 'once') {
      console.log(`[Scheduler] 1회성 스케줄 등록: ${sched.name}`);
      return;
    }

    const cronExpr = this.getIntervalCron(sched.interval_type, sched.custom_cron);
    if (!cron.validate(cronExpr)) {
      console.error(`[Scheduler] 유효하지 않은 Cron 표현식: ${cronExpr}`);
      return;
    }

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[Scheduler] 정기 스케줄 실행: ${sched.name}`);
      await this.executeSchedule(sched.id);
    }, {
      timezone: 'Asia/Seoul',
    });

    this.jobs.set(sched.id, task);
    console.log(`[Scheduler] 스케줄 등록 완료: [${sched.id}] ${sched.name} (${cronExpr})`);
  }

  cancelJob(id) {
    if (this.jobs.has(id)) {
      this.jobs.get(id).stop();
      this.jobs.delete(id);
    }
  }

  /**
   * 스케줄 실행 본체 (메시지 집계, 요약 정리, 게시판 카드 발행)
   */
  async executeSchedule(scheduleId) {
    const sched = db.getSchedule(scheduleId);
    if (!sched) return;

    const now = getKSTDateTimeString();
    const lastRun = sched.last_run_at || '1970-01-01 00:00:00';

    try {
      // 1. 대상 대화방 메시지 집계
      const targetRoomIds = sched.room_ids || [];
      const rooms = db.listRooms().filter(r => targetRoomIds.length === 0 || targetRoomIds.includes(r.id));

      for (const room of rooms) {
        // 지난 실행 이후의 메시지 추출
        const messages = db.listMessages({ roomId: room.id, limit: 200 });
        if (messages.length === 0) continue;

        // 요약 및 통계 계산
        const textCount = messages.filter(m => m.message_type === 'text').length;
        const mediaCount = messages.filter(m => m.message_type !== 'text').length;
        
        // 발언자 집계
        const senders = {};
        for (const m of messages) {
          senders[m.sender] = (senders[m.sender] || 0) + 1;
        }
        const topSenders = Object.entries(senders)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([s, c]) => `${s}(${c}건)`)
          .join(', ');

        // 핵심 대화 발췌
        const recentHighlights = messages
          .slice(0, 5)
          .map(m => `• [${m.sender}] ${m.message.substring(0, 60)}`)
          .join('\n');

        const summary = `총 ${messages.length}건의 대화 (텍스트: ${textCount}건, 미디어: ${mediaCount}건)\n주요 참여자: ${topSenders || '없음'}\n\n[주요 대화 발췌]\n${recentHighlights}`;
        const title = `[${room.name}] ${sched.name} 자동 정리 리포트 (${getKSTDateString()})`;

        // 2. 게시판 피드에 포스트 발행
        const postId = db.insertBoardPost({
          title,
          roomName: room.name,
          summary,
          messageCount: messages.length,
          mediaCount,
          periodStart: lastRun,
          periodEnd: now,
          contentJson: {
            scheduleId: sched.id,
            scheduleName: sched.name,
            topSenders,
            messagesSample: messages.slice(0, 20),
          },
        });

        console.log(`[Scheduler] 게시판 포스트 발행 완료: ID ${postId} (${title})`);

        // 3. 실시간 알림 브로드캐스트
        if (typeof this.broadcastWs === 'function') {
          this.broadcastWs({
            type: 'new_board_post',
            data: {
              id: postId,
              title,
              roomName: room.name,
              summary,
              messageCount: messages.length,
              mediaCount,
              createdAt: now,
            },
          });
        }
      }

      // 스케줄 실행 시각 갱신
      db.updateScheduleRun(sched.id, now, null);

      // 1회성 스케줄이면 비활성화
      if (sched.interval_type === 'once') {
        db.upsertSchedule({
          ...sched,
          isActive: 0,
        });
        this.cancelJob(sched.id);
      }
    } catch (err) {
      console.error(`[Scheduler Error in ${sched.name}]`, err);
    }
  }
}

const schedulerService = new SchedulerService();
module.exports = schedulerService;
