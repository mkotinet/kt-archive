# KT-Archive (카카오톡 아카이브 & 웹 대시보드 서비스)

시놀로지 NAS(Portainer) 환경에서 구동되는 **카카오톡 실시간 아카이브, 대화방 검색, 미디어 저장 및 주기적 타임라인 피드 발행 웹 서비스**입니다.

- **서비스 도메인**: `https://kt.danminlove.com`
- **시놀로지 호스트 저장소**: `/volume1/Download/KakaoArchive/`
- **배포 인프라**: Synology DS1019+ Portainer (Stack ID: 23, `kt-archive`, Node.js 22 내장 SQLite)

---

## 📌 주요 문서 목록

| 문서명 | 파일 링크 | 설명 |
| :--- | :--- | :--- |
| **서비스 기획서** | [서비스기획서.md](./서비스기획서.md) | 요구사항 분석, 3대 구축 방안 비교, 채택된 하이브리드 아키텍처 및 상세 UI/기능 설계 |
| **기술 레포트** | [기술레포트.md](./기술레포트.md) | 시스템 아키텍처, 4대 탭 기능, DB 스키마, REST API 엔드포인트 명세, 핵심 기술적 문제 해결(RCA) |
| **제작 히스토리** | [제작히스토리.md](./제작히스토리.md) | 전체 개발 일정, 단계별 수행 타임라인, 생성 및 수정된 소스코드/산출물 변경 이력 |

---

## 🏗️ 시스템 아키텍처 (하이브리드 모드)

```
[ 안드로이드 스마트폰 ] ──(카톡 알림 실시간 웹훅: 0초 딜레이)──┐
  (메신저봇R 스크립트)                                      │
                                                           ▼
[ 맥북 (MacBook) ] ────(고화질 미디어/과거내역 업로드)───▶ [ 시놀로지 Portainer (Node.js 22) ]
  (kakao-mcp / sync-agent)                                 │ • 웹 대시보드 (kt.danminlove.com)
                                                           │ • 자동 스케줄러 (10m, 1h, 12h, 1w)
                                                           │ • 내장 SQLite DB (archive.db)
                                                           │ • WebSocket 실시간 브로드캐스트
                                                           ▼
                                            [ 시놀로지 영구 스토리지 ]
                                            • /volume1/Download/KakaoArchive/
                                            • /volume2/docker/kt-archive/data/
```

1. **24시간 실시간 수신 (안드로이드 메신저봇R)**:
   - 스마트폰 데이터 무제한 요금제를 활용하여 맥북이 꺼져 있어도 실시간 텍스트 대화를 0초 딜레이로 시놀로지에 자동 저장합니다.
2. **고화질 미디어/과거 대화 동기화 (맥북 카톡 MCP)**:
   - 맥북을 사용할 때 원클릭 동기화 에이전트를 통해 카카오톡의 원본 사진, 동영상, 과거 대화 내역을 시놀로지 대용량 저장소(`/volume1/Download/KakaoArchive`)로 일괄 업로드합니다.
3. **읽음 '1' 사라짐 없는 안전 열람**:
   - 상대방에게 읽음 표시를 남기지 않고 웹 대시보드에서 안전하게 모든 대화와 미디어를 열람 및 검색할 수 있습니다.
4. **유연한 자동 스케줄러 & 타임라인 피드**:
   - 10분, 30분, 1시간, 6시간, 12시간, 매일, 주 1회, 1회성 등 원하는 주기를 대화방별로 설정하여 정기 아카이브 및 참여자 발언 통계, 주요 하이라이트를 아카이브 게시판에 자동 발행합니다.

---

## 🚀 빠른 시작 가이드

### 1. Docker Compose 배포
```yaml
services:
  kt-archive:
    container_name: kt-archive
    image: node:22-alpine
    working_dir: /app
    volumes:
      - kt_archive_data:/data
      - /volume1/Download:/downloads
    ports:
      - "5180:5180"
    environment:
      - PORT=5180
      - DATA_DIR=/data
      - DOWNLOAD_DIR=/downloads/KakaoArchive
      - TZ=Asia/Seoul
    restart: always
```

### 2. 안드로이드 메신저봇R 연동
1. 플레이스토어에서 **메신저봇R** 앱 설치
2. `android/kakaotalk_forwarder.js` 코드를 복사하여 스크립트에 등록 후 활성화

### 3. 맥북 미디어 동기화 에이전트 실행
```bash
python3 mac-agent/kakao_sync_agent.py --once
```
