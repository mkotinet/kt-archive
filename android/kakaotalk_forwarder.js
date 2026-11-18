/**
 * [메신저봇R 전용] 카카오톡 실시간 텍스트 시놀로지 포워더 (v3.5)
 * - 단체 카톡방 알림에서 방 이름(conversationTitle / subText) 정밀 추출 지원
 * - 발신자별로 대화방이 쪼개지는 결함 완벽 차단
 * - 중복 전송 방지 캐시 탑재
 * - API 1, API 2, onNotificationPosted 3중 통합 지원
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

// 중복 전송 방지용 캐시 (최근 5초 내 중복 메시지 차단)
const sentCache = {};

function isDuplicate(key) {
  const now = Date.now();
  if (sentCache[key] && (now - sentCache[key] < 5000)) {
    return true;
  }
  sentCache[key] = now;
  // 오래된 캐시 정리
  for (const k in sentCache) {
    if (now - sentCache[k] > 30000) delete sentCache[k];
  }
  return false;
}

// 2. 통합 메시지 전송 함수
function sendToServer(roomName, senderName, messageText, isGroupChat, packageName) {
  if (!messageText || String(messageText).trim() === "") return;

  const room = String(roomName || "알 수 없는 대화방").trim();
  const sender = String(senderName || "알 수 없음").trim();
  const msg = String(messageText).trim();

  // 중복 전송 방지
  const cacheKey = room + "_" + sender + "_" + msg.substring(0, 30);
  if (isDuplicate(cacheKey)) {
    return;
  }

  const payload = {
    room: room,
    sender: sender,
    msg: msg,
    isGroupChat: Boolean(isGroupChat),
    sentAt: getKSTDateString(),
    packageName: packageName || "com.kakao.talk"
  };

  try {
    const url = new java.net.URL(SERVER_URL);
    const conn = url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
    conn.setRequestProperty("x-webhook-secret", SECRET_KEY);
    conn.setRequestProperty("User-Agent", "Android-MessengerBotR/3.5");
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
    Log.i("[KT-Archive] 전송 완료 (HTTP " + responseCode + "): [" + room + "] " + sender);
    conn.disconnect();
  } catch (e) {
    Log.e("[KT-Archive] 전송 실패: " + e.message);
  }
}

// 3. Android 알림 리스너 정밀 파싱 (onNotificationPosted)
// 카카오톡의 extras(android.conversationTitle, android.subText)에서 단체방 명칭 우선 추출
function onNotificationPosted(sbn, sm) {
  try {
    const packageName = String(sbn.getPackageName());
    if (!packageName.includes("kakao")) return;

    const notification = sbn.getNotification();
    if (!notification || !notification.extras) return;
    const extras = notification.extras;

    const convoTitle = extras.getCharSequence("android.conversationTitle");
    const subText = extras.getCharSequence("android.subText");
    const title = extras.getCharSequence("android.title");
    const text = extras.getCharSequence("android.text");

    const message = text ? String(text) : "";
    const sender = title ? String(title) : "상대방";

    // 단체방 이름 결정 우선순위:
    // 1. android.conversationTitle (단체방 공식 타이틀)
    // 2. android.subText (단체방 상단 서브텍스트)
    // 3. 1:1 대화방인 경우 sender가 곧 방 이름
    let room = "";
    let isGroup = false;

    if (convoTitle && String(convoTitle).trim() !== "") {
      room = String(convoTitle).trim();
      isGroup = true;
    } else if (subText && String(subText).trim() !== "" && !String(subText).includes("@")) {
      room = String(subText).trim();
      isGroup = true;
    } else {
      room = sender;
      isGroup = false;
    }

    if (message) {
      sendToServer(room, sender, message, isGroup, packageName);
    }
  } catch (e) {
    // onNotificationPosted 예외는 조용히 무시 (response 호환 모드로 대체)
  }
}

// 4. API 1 (레거시 response 함수 호환)
function response(room, msg, sender, isGroupChat, replier, ImageDB, packageName) {
  if (packageName && !packageName.includes("kakao") && packageName !== "debug") return;

  // 디버깅 명령: !핑 입력 시 카톡방에 즉시 답장
  if (msg === "!핑" && replier) {
    replier.reply("🚀 [KT-Archive v3.5] 메신저봇R이 시놀로지와 정상 통신 중입니다!");
  }

  sendToServer(room, sender, msg, isGroupChat, packageName);
}

// 5. API 2 (신형 BotManager 모드 호환)
if (typeof BotManager !== "undefined") {
  try {
    const bot = BotManager.getCurrentBot();
    bot.on("message", function(msg) {
      const room = msg.room;
      const sender = (msg.author && msg.author.name) ? msg.author.name : "상대방";
      const content = msg.content;
      sendToServer(room, sender, content, msg.isGroupChat, msg.packageName);
    });
  } catch (e) {}
}

// 6. 한국 표준시(KST) 시간 헬퍼
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
