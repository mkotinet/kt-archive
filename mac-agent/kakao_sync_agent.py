#!/usr/bin/env python3
"""
맥북 카카오톡 MCP 미디어 & 대화내역 시놀로지 고속 동기화 에이전트
(MacBook KakaoTalk MCP -> Synology NAS /volume1/Download/KakaoArchive)
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.error
from pathlib import Path

# 설정
SYNOLOGY_URL = os.environ.get("SYNOLOGY_URL", "https://kt.danminlove.com")
SECRET_KEY = os.environ.get("WEBHOOK_SECRET", "danminlove-kt-secret-key-2026")
KAKAO_MCP_DIR = Path.home() / ".gemini/mcp-servers/kakao-mcp"
KAKAOCLI_BIN = Path.home() / ".local/share/kakao-mcp/bin/kakaocli"
CONFIG_PATH = Path.home() / ".config/kakao-mcp/config.json"

sys.path.insert(0, str(KAKAO_MCP_DIR / "src"))

def log(msg):
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] [KT-Sync-Agent] {msg}")

def load_user_id():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                d = json.load(f)
                return d.get("user_id")
        except Exception:
            pass
    return None

def fetch_monitored_rooms():
    """시놀로지에서 모니터링 대상 방 목록 가져오기"""
    url = f"{SYNOLOGY_URL}/api/sync/monitored-rooms?secret={SECRET_KEY}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mac-Sync-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("rooms", [])
    except Exception as e:
        log(f"시놀로지 모니터링 방 목록 조회 실패: {e}")
        return []

def get_kakaocli_chats():
    """kakaocli로 로컬 카카오톡 대화방 목록 조회"""
    uid = load_user_id()
    cmd = f'"{KAKAOCLI_BIN}" chats --json'
    if uid:
        cmd += f' --user-id {uid}'
    try:
        out = os.popen(cmd).read()
        return json.loads(out)
    except Exception as e:
        log(f"kakaocli 대화방 조회 실패: {e}")
        return []

def upload_media_to_synology(file_path, room_name, room_id, sender, message, media_type):
    """멀티파트 파일 업로드로 시놀로지 /volume1/Download/ 에 저장"""
    url = f"{SYNOLOGY_URL}/api/sync/media"
    boundary = "----WebKitFormBoundary" + str(int(time.time() * 1000))
    
    filename = os.path.basename(file_path)
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    body = []
    def add_field(name, val):
        body.append(f"--{boundary}\r\n".encode("utf-8"))
        body.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.append(f"{val}\r\n".encode("utf-8"))

    add_field("roomName", room_name)
    add_field("roomId", str(room_id))
    add_field("sender", sender)
    add_field("message", message)
    add_field("mediaType", media_type)

    body.append(f"--{boundary}\r\n".encode("utf-8"))
    body.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"))
    body.append(b"Content-Type: application/octet-stream\r\n\r\n")
    body.append(file_bytes)
    body.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))

    payload = b"".join(body)

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "x-sync-secret": SECRET_KEY,
        "User-Agent": "Mac-Sync-Agent/1.0"
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            if res_json.get("success"):
                log(f"미디어 업로드 완료: {filename} -> {res_json.get('filePath')}")
                return True
    except Exception as e:
        log(f"미디어 업로드 실패 ({filename}): {e}")
    return False

def sync_messages_batch(messages):
    """대량 메시지 배치 전송"""
    if not messages:
        return
    url = f"{SYNOLOGY_URL}/api/sync/messages"
    payload = json.dumps({"messages": messages}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "x-sync-secret": SECRET_KEY,
        "User-Agent": "Mac-Sync-Agent/1.0"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            log(f"메시지 배치 동기화 성공: {data.get('insertedCount')} / {len(messages)} 건")
    except Exception as e:
        log(f"메시지 배치 전송 오류: {e}")

def run_sync_once():
    log("=== 맥북 -> 시놀로지 카카오톡 동기화 시작 ===")
    uid = load_user_id()
    if not uid:
        log("오류: 카카오톡 user_id를 찾을 수 없습니다. config.json을 확인하세요.")
        return

    # 1. 로컬 카카오톡 대화방 목록 조회
    chats = get_kakaocli_chats()
    log(f"로컬 대화방 {len(chats)}개 감지됨")

    # 2. 최근 대화 동기화
    for chat in chats[:5]: # 활성 상위 5개 방 우선 동기화
        chat_id = chat.get("id") or chat.get("chatId")
        chat_name = chat.get("title") or chat.get("name") or "이름 없는 대화방"
        log(f"방 동기화 처리 중: [{chat_id}] {chat_name}")

        # kakaocli history 조회
        cmd = f'"{KAKAOCLI_BIN}" history --chat-id {chat_id} --limit 20'
        if uid:
            cmd += f' --user-id {uid}'
        try:
            out = os.popen(cmd).read()
            history = json.loads(out)
            batch = []
            for item in history.get("messages", []):
                batch.append({
                    "roomId": str(chat_id),
                    "roomName": chat_name,
                    "sender": item.get("senderName") or "알 수 없음",
                    "message": item.get("message") or "",
                    "messageType": item.get("type", "text"),
                    "sentAt": item.get("sentAt")
                })
            sync_messages_batch(batch)
        except Exception as e:
            log(f"대화 내역 추출 실패 ({chat_name}): {e}")

    log("=== 동기화 완료 ===")

def main():
    parser = argparse.ArgumentParser(description="KakaoTalk Mac to Synology Sync Agent")
    parser.add_argument("--once", action="store_true", help="1회 동기화 실행 후 종료")
    parser.add_argument("--interval", type=int, default=600, help="주기적 동기화 간격(초, 기본 600초=10분)")
    args = parser.parse_args()

    if args.once:
        run_sync_once()
    else:
        log(f"주기적 동기화 모드 시작 (간격: {args.interval}초)")
        while True:
            try:
                run_sync_once()
            except Exception as e:
                log(f"동기화 루프 오류: {e}")
            time.sleep(args.interval)

if __name__ == "__main__":
    main()
