/**
 * [메신저봇R 전용] 카카오톡 실시간 텍스트 시놀로지 포워더
 * 
 * [설치 방법]
 * 1. 안드로이드 스마트폰에 '메신저봇R' 앱 설치 및 알림 읽기 권한 허용
 * 2. 봇 생성 후 아래 코드를 그대로 복사하여 붙여넣고 저장
 * 3. 봇 활성화(ON)
 */

const SERVER_URL = "https://kt.danminlove.com/api/webhook/kakaotalk";
const SECRET_KEY = "danminlove-kt-secret-key-2026"; // src/config.js 의 WEBHOOK_SECRET 과 동일

/**
 * 메신저봇R 기본 수신 함수
 */
function response(room, msg, sender, isGroupChat, replier, ImageDB, packageName) {
  // 1. 카카오톡 패키지만 필터링
  if (packageName !== "com.kakao.talk") return;

  // 2. 발송할 페이로드 구성
  const payload = {
    room: room,
    sender: sender,
    msg: msg,
    isGroupChat: isGroupChat,
    sentAt: getKSTDateString(),
    packageName: packageName
  };

  // 3. 백그라운드 스레드에서 비동기 HTTP POST 전송 (UI 프리징 방지)
  java.lang.Thread(new java.lang.Runnable({
    run: function() {
      try {
        const url = new java.net.URL(SERVER_URL);
        const conn = url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        conn.setRequestProperty("x-webhook-secret", SECRET_KEY);
        conn.setRequestProperty("User-Agent", "Android-MessengerBotR/1.0");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setDoOutput(true);

        const jsonStr = JSON.stringify(payload);
        const os = conn.getOutputStream();
        const writer = new java.io.OutputStreamWriter(os, "UTF-8");
        writer.write(jsonStr);
        writer.flush();
        writer.close();
        os.close();

        const responseCode = conn.getResponseCode();
        if (responseCode === 200) {
          // 전송 성공 로그 (필요 시 주석 해제)
          // Log.i("[KT-Archive] 전송 완료: " + room + " - " + sender);
        } else {
          Log.e("[KT-Archive] 전송 실패 응답 코드: " + responseCode);
        }
        conn.disconnect();
      } catch (e) {
        Log.e("[KT-Archive] 전송 예외 발생: " + e.message);
      }
    }
  })).start();
}

/**
 * KST 일시 헬퍼 (YYYY-MM-DD HH:mm:ss)
 */
function getKSTDateString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const kstTime = new Date(utc + (9 * 60 * 60 * 1000));
  
  const y = kstTime.getFullYear();
  const m = String(kstTime.getMonth() + 1).padStart(2, '0');
  const d = String(kstTime.getDate()).padStart(2, '0');
  const h = String(kstTime.getHours()).padStart(2, '0');
  const min = String(kstTime.getMinutes()).padStart(2, '0');
  const s = String(kstTime.getSeconds()).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min + ':' + s;
}
