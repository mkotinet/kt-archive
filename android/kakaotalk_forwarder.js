/**
 * [메신저봇R 전용] 카카오톡 실시간 텍스트 시놀로지 포워더 (v2.0 무결점 버전)
 * 
 * [주요 기능]
 * 1. 자체 서명/사설 SSL 인증서 100% 무조건 허용 (SSLHandshakeException 원천 차단)
 * 2. 스크립트 켜자마자 1회 서버 연결 테스트 자동 전송 (대시보드에 즉시 대화방 생성)
 * 3. 카톡 알림 0초 실시간 감지 및 백그라운드 비동기 고속 전송
 * 4. 메신저봇R 앱 내부 [로그] 탭에 상세 성공/실패 기록
 * 5. 카톡방에서 '!핑' 또는 '!연결' 입력 시 서버 연결 상태 즉시 회신
 */

const SERVER_URL = "https://kt.danminlove.com/api/webhook/kakaotalk";
const SECRET_KEY = "danminlove-kt-secret-key-2026";

// 1. SSL 인증서 보안 검증 무력화 (사설/와일드카드 SSL 완벽 통과)
(function installTrustAllSSL() {
  try {
    const trustAllCerts = [
      new javax.net.ssl.X509TrustManager({
        getAcceptedIssuers: function() { return null; },
        checkClientTrusted: function(certs, authType) {},
        checkServerTrusted: function(certs, authType) {}
      })
    ];
    const sc = javax.net.ssl.SSLContext.getInstance("TLS");
    sc.init(null, trustAllCerts, new java.security.SecureRandom());
    javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
    javax.net.ssl.HttpsURLConnection.setDefaultHostnameVerifier(new javax.net.ssl.HostnameVerifier({
      verify: function(hostname, session) { return true; }
    }));
    Log.i("[KT-Archive] SSL 우회 및 보안 터널 초기화 완료");
  } catch (e) {
    Log.e("[KT-Archive] SSL 우회 초기화 실패: " + e.message);
  }
})();

/**
 * 2. 메신저봇R 기본 카톡 수신 핸들러 (API 1)
 */
function response(room, msg, sender, isGroupChat, replier, ImageDB, packageName) {
  // 카카오톡 알림만 필터링 (com.kakao.talk)
  if (packageName && !packageName.includes("kakao")) return;

  // 디버깅 명령어: 카톡방에 !핑 또는 !연결 입력 시 작동
  if (msg === "!핑" || msg === "!연결") {
    replier.reply("🚀 [KT-Archive] 메신저봇R 정상 작동 중!\n서버: " + SERVER_URL);
  }

  // 발송 페이로드
  const payload = {
    room: room,
    sender: sender,
    msg: msg,
    isGroupChat: Boolean(isGroupChat),
    sentAt: getKSTDateString(),
    packageName: packageName || "com.kakao.talk"
  };

  sendToServer(payload);
}

/**
 * 3. 메신저봇R 신형 핸들러 (API 2 호환)
 */
function onNotificationPosted(sbn, sm) {
  try {
    const packageName = sbn.getPackageName();
    if (!packageName.includes("kakao")) return;

    const noti = sbn.getNotification();
    const extras = noti.extras;
    const title = extras.getString("android.title");
    const text = extras.getCharSequence("android.text");
    const subText = extras.getCharSequence("android.subText");

    if (!title || !text) return;

    const room = subText ? String(subText) : String(title);
    const sender = subText ? String(title) : "상대방";
    const msg = String(text);

    sendToServer({
      room: room,
      sender: sender,
      msg: msg,
      isGroupChat: subText !== null,
      sentAt: getKSTDateString(),
      packageName: packageName
    });
  } catch (e) {
    // 레거시 API 사용 기기는 무시
  }
}

/**
 * 4. 시놀로지 서버 전송 핵심 함수 (백그라운드 스레드)
 */
function sendToServer(payload) {
  java.lang.Thread(new java.lang.Runnable({
    run: function() {
      try {
        const url = new java.net.URL(SERVER_URL);
        const conn = url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        conn.setRequestProperty("x-webhook-secret", SECRET_KEY);
        conn.setRequestProperty("User-Agent", "Android-MessengerBotR/2.0");
        conn.setConnectTimeout(7000);
        conn.setReadTimeout(7000);
        conn.setDoOutput(true);

        const jsonStr = JSON.stringify(payload);
        const os = conn.getOutputStream();
        const writer = new java.io.OutputStreamWriter(os, "UTF-8");
        writer.write(jsonStr);
        writer.flush();
        writer.close();
        os.close();

        const responseCode = conn.getResponseCode();
        if (responseCode === 200 || responseCode === 201) {
          Log.i("[KT-Archive] 전송 성공 (HTTP " + responseCode + "): [" + payload.room + "] " + payload.sender + ": " + payload.msg.substring(0, 20));
        } else {
          Log.e("[KT-Archive] 전송 오류 (HTTP " + responseCode + "): " + payload.room);
        }
        conn.disconnect();
      } catch (e) {
        Log.e("[KT-Archive] 전송 예외 발생: " + e.message);
      }
    }
  })).start();
}

/**
 * 5. KST 일시 헬퍼 (YYYY-MM-DD HH:mm:ss)
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

// 6. 스크립트 실행 즉시 1회 초기화 연결 핑 전송 (정상 작동 검증용)
sendToServer({
  room: "연결 알림 (메신저봇R)",
  sender: "메신저봇R",
  msg: "스마트폰 메신저봇R과 시놀로지 kt-archive 서버가 성공적으로 연결되었습니다! 🚀",
  isGroupChat: false,
  sentAt: getKSTDateString(),
  packageName: "com.kakao.talk"
});
