/**
 * [메신저봇R 전용] 카카오톡 실시간 텍스트 시놀로지 포워더 (API 1 & API 2 완벽 호환 v3.0)
 */

const SERVER_URL = "https://kt.danminlove.com/api/webhook/kakaotalk";
const SECRET_KEY = "danminlove-kt-secret-key-2026";

// 1. SSL 인증서 보안 검증 무력화 (사설/와일드카드 SSL 100% 통과)
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
} catch (e) {
  Log.e("[KT-Archive] SSL 설정 오류: " + e.message);
}

// 2. 통합 메시지 처리 함수
function handleMessage(room, msg, sender, isGroupChat, packageName, replier) {
  // 카카오톡 알림이 아니면 무시 (디버그 테스트룸 예외 허용)
  if (packageName && !packageName.includes("kakao") && packageName !== "debug") return;

  // 디버깅 명령: !핑 입력 시 카톡방에 즉시 답장
  if (msg === "!핑" && replier) {
    replier.reply("🚀 [KT-Archive] 메신저봇R이 시놀로지 서버와 정상 통신 중입니다!");
  }

  const payload = {
    room: String(room || "테스트방"),
    sender: String(sender || "테스트유저"),
    msg: String(msg || ""),
    isGroupChat: Boolean(isGroupChat),
    sentAt: getKSTDateString(),
    packageName: packageName || "com.kakao.talk"
  };

  // 서버로 직접 HTTP 전송
  try {
    const url = new java.net.URL(SERVER_URL);
    const conn = url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
    conn.setRequestProperty("x-webhook-secret", SECRET_KEY);
    conn.setRequestProperty("User-Agent", "Android-MessengerBotR/3.0");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    conn.setDoOutput(true);

    const os = conn.getOutputStream();
    const writer = new java.io.OutputStreamWriter(os, "UTF-8");
    writer.write(JSON.stringify(payload));
    writer.flush();
    writer.close();
    os.close();

    const responseCode = conn.getResponseCode();
    Log.i("[KT-Archive] 전송 완료 (HTTP " + responseCode + "): [" + payload.room + "] " + payload.sender);
    conn.disconnect();
  } catch (e) {
    Log.e("[KT-Archive] 전송 실패: " + e.message);
  }
}

// 3. API 1 (레거시 모드 호환)
function response(room, msg, sender, isGroupChat, replier, ImageDB, packageName) {
  handleMessage(room, msg, sender, isGroupChat, packageName, replier);
}

// 4. API 2 (신형 BotManager 모드 호환)
if (typeof BotManager !== "undefined") {
  try {
    const bot = BotManager.getCurrentBot();
    bot.on("message", function(msg) {
      handleMessage(
        msg.room,
        msg.content,
        (msg.author && msg.author.name) ? msg.author.name : "상대방",
        msg.isGroupChat,
        msg.packageName,
        msg
      );
    });
  } catch (e) {}
}

// 5. KST 시간 헬퍼
function getKSTDateString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const kst = new Date(utc + (9 * 60 * 60 * 1000));
  return kst.getFullYear() + '-' + 
    String(kst.getMonth() + 1).padStart(2, '0') + '-' + 
    String(kst.getDate()).padStart(2, '0') + ' ' + 
    String(kst.getHours()).padStart(2, '0') + ':' + 
    String(kst.getMinutes()).padStart(2, '0') + ':' + 
    String(kst.getSeconds()).padStart(2, '0');
}
