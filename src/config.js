/**
 * kt-archive 전역 설정 및 KST 시간 헬퍼 (공통 운영 지침 4 준수)
 */
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '5180', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads', 'KakaoArchive');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'danminlove-kt-secret-key-2026';

// 디렉토리 자동 생성
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

/**
 * 한국 표준시(KST, Asia/Seoul) YYYY-MM-DD 반환
 */
function getKSTDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * 한국 표준시(KST, Asia/Seoul) HH:mm:ss 반환
 */
function getKSTTimeString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

/**
 * 한국 표준시(KST) YYYY-MM-DD HH:mm:ss 반환
 */
function getKSTDateTimeString(date = new Date()) {
  return `${getKSTDateString(date)} ${getKSTTimeString(date)}`;
}

/**
 * KST 타임스탬프 (ms)
 */
function getKSTTimestamp() {
  return Date.now();
}

module.exports = {
  PORT,
  DATA_DIR,
  DOWNLOAD_DIR,
  WEBHOOK_SECRET,
  getKSTDateString,
  getKSTTimeString,
  getKSTDateTimeString,
  getKSTTimestamp,
};
