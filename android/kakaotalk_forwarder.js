/**
 * [메신저봇R 전용] 카카오톡 실시간 텍스트 시놀로지 포워더 (v3.6 무결점 안정화 버전)
 * - 메신저봇R Rhino 엔진 100% 컴파일 통과 (불필요한 리스너 제거 및 ES5 호환)
 * - API 1 (response) & API 2 (BotManager) 듀얼 완벽 호환
 * - SSL 인증서 검증 우회 (자체서명/와일드카드 통과)
 * - 중복 전송 방지 캐시 탑재
 */

var SERVER_URL = "https://kt.danminlove.com/api/webhook/kakaotalk";
var SECRET_KEY = "danminlove-kt-secret-key-2026";

// 1. SSL 인증서 보안 검증 무력화 (사설/와일드카드 SSL 100% 통과)
try {
  var trustAllCerts = [
    new javax.net.ssl.X509TrustManager({
      getAcceptedIssuers: function() { return null; },
      checkClientTrusted: function(certs, authType) {},
      checkServerTrusted: function(certs, authType) {}
    })
  ];
  var sc = javax.net.ssl.SSLContext.getInstance("TLS");
  sc.init(null, trustAllCerts, new java.security.SecureRandom());
  javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
  javax.net.ssl.HttpsURLConnection.setDefaultHostnameVerifier(new javax.net.ssl.HostnameVerifier({
    verify: function(hostname, session) { return true; }
  }));
} catch (e) {
  Log.e("[KT-Archive] SSL 설정 오류: " + e.message);
}

// 2. 중복 전송 방지용 캐시 (최근 4초 내 동일 메시지 중복 전송 차단)
var sentCache = {};

function isDuplicateMessage(key) {
  var now = Date.now();
  if (sentCache[key] && (now - sentCache[key] < 4000)) {
    return true;
  }
  sentCache[key] = now;
  // 오래된 캐시 청소
  for (var k in sentCache) {
    if (now - sentCache[k] > 20000) {
      delete sentCache[k];
    }
  }
  return false;
}

// 3. 서버 HTTP 전송 코어 함수
function sendToServer(room, sender, msg, isGroupChat, packageName) {
  if (!msg || String(msg).trim() === "") return;

  var roomName = String(room || "알 수 없는 대화방").trim();
  var senderName = String(sender || "알 수 없음").trim();
  var messageText = String(msg).trim();

  // 중복 체크
  var cacheKey = roomName + "_" + senderName + "_" + messageText.substring(0, 30);
  if (isDuplicateMessage(cacheKey)) {
    return;
  }

  var payload = {
    room: roomName,
    sender: senderName,
    msg: messageText,
    isGroupChat: Boolean(isGroupChat),
    sentAt: getKSTDateString(),
    packageName: packageName || "com.kakao.talk"
  };

  try {
    var url = new java.net.URL(SERVER_URL);
    var conn = url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
    conn.setRequestProperty("x-webhook-secret", SECRET_KEY);
    conn.setRequestProperty("User-Agent", "Android-MessengerBotR/3.6");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    conn.setDoOutput(true);

    var os = conn.getOutputStream();
    var writer = new java.io.OutputStreamWriter(os, "UTF-8");
    writer.write(JSON.stringify(payload));
    writer.flush();
    writer.close();
    os.close();

    var responseCode = conn.getResponseCode();
    Log.i("[KT-Archive] 전송 완료 (HTTP " + responseCode + "): [" + roomName + "] " + senderName);
    conn.disconnect();
  } catch (err) {
    Log.e("[KT-Archive] 전송 실패: " + err.message);
  }
}

// 4. API 1 (레거시 response 함수 모드)
function response(room, msg, sender, isGroupChat, replier, ImageDB, packageName) {
  if (packageName && !packageName.includes("kakao") && packageName !== "debug") return;

  // 디버깅 명령: 카톡방에 !핑 입력 시 즉시 응답
  if (msg === "!핑" && replier) {
    replier.reply("🚀 [KT-Archive v3.6] 메신저봇R이 시놀로지와 정상 통신 중입니다!");
  }

  sendToServer(room, sender, msg, isGroupChat, packageName);
}

// 5. API 2 (신형 BotManager 모드)
if (typeof BotManager !== "undefined") {
  try {
    var bot = BotManager.getCurrentBot();
    bot.on("message", function(msg) {
      if (msg.packageName && !msg.packageName.includes("kakao") && msg.packageName !== "debug") return;
      var room = msg.room;
      var sender = (msg.author && msg.author.name) ? msg.author.name : "상대방";
      var content = msg.content;
      sendToServer(room, sender, content, msg.isGroupChat, msg.packageName);
    });
  } catch (e) {
    Log.e("[KT-Archive] BotManager 설정 오류: " + e.message);
  }
}

// 6. 한국 표준시(KST) 시간 헬퍼 (Rhino ES5 완전 호환)
function padZero(num) {
  return num < 10 ? "0" + num : String(num);
}

function getKSTDateString() {
  var now = new Date();
  var utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  var kst = new Date(utc + (9 * 60 * 60 * 1000));
  return kst.getFullYear() + "-" + 
    padZero(kst.getMonth() + 1) + "-" + 
    padZero(kst.getDate()) + " " + 
    padZero(kst.getHours()) + ":" + 
    padZero(kst.getMinutes()) + ":" + 
    padZero(kst.getSeconds());
}
