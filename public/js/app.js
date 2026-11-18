/**
 * kt-archive 프론트엔드 통합 클라이언트 스크립트
 */

let activeRoomId = null;
let currentSummaryDate = null;
let currentDailySummaryData = null;
let currentViewMode = 'timeline'; // 'timeline' or 'daily'
let ws = null;
let roomsData = [];
let roomDisplayCount = 5; // 상위 5개 기본 표시, 더보기 클릭 시 +5개씩 증가

// 1. 초기화
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  loadStats();
  loadRooms();
  loadBoard();
  loadMedia();
  loadSchedules();
  setupEventListeners();
  initDailySummaryFeature();
  initMergeRoomsFeature();
  setupMobileLifecycle();
  initPwa();
});

// 2. 탭 전환
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));

  if (tabId === 'rooms') loadRooms();
  else if (tabId === 'board') loadBoard();
  else if (tabId === 'media') loadMedia();
  else if (tabId === 'scheduler') loadSchedules();
}

// 3. WebSocket 실시간 연결 및 자동 재연결
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateWsStatus(false, '연결 시도 중...');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] 연결 성공');
    updateWsStatus(true, '실시간 수신 중');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('[WebSocket] 메시지 파싱 오류:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WebSocket] 연결 끊김, 3초 후 재연결 시도');
    updateWsStatus(false, '재연결 대기');
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('[WebSocket] 오류:', err);
    updateWsStatus(false, '오류 발생');
  };
}

function updateWsStatus(isConnected, text) {
  const pill = document.getElementById('wsStatusPill');
  const txt = document.getElementById('wsStatusText');
  if (pill && txt) {
    pill.classList.toggle('connected', isConnected);
    txt.textContent = text;
  }
}

function handleWsMessage(payload) {
  if (payload.type === 'new_message') {
    loadStats();
    // 현재 열려있는 대화방 메시지면 피드에 즉시 추가
    if (activeRoomId === payload.data.roomId) {
      appendMessageToFeed(payload.data);
    }
    // 대화방 목록 갱신
    loadRooms();
  } else if (payload.type === 'new_board_post') {
    loadStats();
    loadBoard();
  } else if (payload.type === 'new_media') {
    loadStats();
    loadMedia();
    if (activeRoomId === payload.data.roomId) {
      loadMessages(activeRoomId);
    }
  }
}

// 4. 시스템 통계 로드
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (json.success) {
      document.getElementById('statRooms').textContent = json.data.roomsCount;
      document.getElementById('statMessages').textContent = json.data.messagesCount;
      document.getElementById('statMedia').textContent = json.data.mediaCount;
    }
  } catch (err) {
    console.error('통계 로드 실패:', err);
  }
}

// 5. 대화방 목록 로드
async function loadRooms() {
  try {
    const res = await fetch('/api/rooms');
    const json = await res.json();
    if (!json.success) return;

    roomsData = json.data;
    renderRoomList(roomsData);
    renderSchedulerRoomCheckboxes(roomsData);
  } catch (err) {
    console.error('대화방 로드 실패:', err);
  }
}

function renderRoomList(rooms) {
  const listEl = document.getElementById('roomList');
  if (!rooms || rooms.length === 0) {
    listEl.innerHTML = '<li class="empty-state">등록된 대화방이 없습니다.<br><small>카톡 웹훅 또는 맥북 동기화 시 자동 등록됩니다.</small></li>';
    return;
  }

  // 1. 검색어 필터링
  const searchInput = document.getElementById('roomSearchInput');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const filtered = query 
    ? rooms.filter(r => (r.name && r.name.toLowerCase().includes(query)))
    : rooms;

  if (filtered.length === 0) {
    listEl.innerHTML = '<li class="empty-state">검색 결과가 없습니다.</li>';
    return;
  }

  // 2. 상위 roomDisplayCount개 슬라이스 (기본 5개, 더보기 시 +5개)
  const visibleRooms = filtered.slice(0, roomDisplayCount);
  const remainingCount = filtered.length - visibleRooms.length;

  let html = visibleRooms.map(room => `
    <li class="room-item ${room.id === activeRoomId ? 'active' : ''}" data-id="${room.id}">
      <div class="room-info">
        <span class="room-name">${escapeHtml(room.name)}</span>
        <span class="room-time">${room.last_message_at || room.created_at}</span>
      </div>
      <div class="room-badges">
        <span class="badge-count">${room.message_count}</span>
      </div>
    </li>
  `).join('');

  // 3. 더보기 버튼 (남은 대화방이 있는 경우)
  if (remainingCount > 0) {
    html += `
      <li class="load-more-item">
        <button id="btnLoadMoreRooms" class="btn-load-more-rooms" type="button">
          <span>대화방 더보기 (+5개)</span>
          <span class="remaining-badge">${remainingCount}개 남음</span>
          <span class="arrow-icon">▼</span>
        </button>
      </li>
    `;
  }

  listEl.innerHTML = html;

  // 4. 대화방 클릭 이벤트 바인딩
  listEl.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => {
      const roomId = item.getAttribute('data-id');
      selectRoom(roomId);
    });
  });

  // 5. 더보기 버튼 클릭 이벤트
  const btnMore = document.getElementById('btnLoadMoreRooms');
  if (btnMore) {
    btnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      roomDisplayCount += 5;
      renderRoomList(roomsData);
    });
  }
}

// 대화방 선택
function selectRoom(roomId) {
  activeRoomId = roomId;
  const room = roomsData.find(r => r.id === roomId);
  if (!room) return;

  document.querySelectorAll('.room-item').forEach(el => el.classList.toggle('active', el.getAttribute('data-id') === roomId));
  document.getElementById('currentRoomTitle').textContent = room.name;
  document.getElementById('currentRoomMeta').textContent = `메시지 ${room.message_count}건 | 최종 활동: ${room.last_message_at || '-'}`;

  loadMessages(roomId);
  loadRoomDailySummaries(roomId);
}

// 6. 메시지 피드 로드
async function loadMessages(roomId) {
  const feed = document.getElementById('messageFeed');
  feed.innerHTML = '<div class="loading-item">메시지 불러오는 중...</div>';

  try {
    const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}&limit=100`);
    const json = await res.json();
    if (!json.success) return;

    if (json.data.length === 0) {
      feed.innerHTML = '<div class="empty-state">아직 저장된 메시지가 없습니다.</div>';
      return;
    }

    feed.innerHTML = json.data.reverse().map(msg => renderMessageHtml(msg)).join('');
    feed.scrollTop = feed.scrollHeight;
  } catch (err) {
    feed.innerHTML = '<div class="empty-state">메시지 로딩 실패</div>';
  }
}

function renderMessageHtml(msg) {
  let mediaHtml = '';
  if (msg.attachment_path) {
    if (msg.message_type === 'image') {
      mediaHtml = `<div class="media-attachment"><img src="${msg.attachment_path}" alt="사진" class="media-thumbnail" onclick="openMediaPreview('${msg.attachment_path}', '${escapeHtml(msg.attachment_name || '사진')}', 'image')"></div>`;
    } else if (msg.message_type === 'video') {
      mediaHtml = `<div class="media-attachment"><video src="${msg.attachment_path}" controls class="media-thumbnail"></video></div>`;
    } else {
      mediaHtml = `<div class="media-attachment"><a href="${msg.attachment_path}" target="_blank" class="btn-sm btn-outline">📎 ${escapeHtml(msg.attachment_name || '파일 다운로드')}</a></div>`;
    }
  }

  return `
    <div class="message-bubble" data-id="${msg.id}">
      <span class="message-sender">${escapeHtml(msg.sender)}</span>
      <div class="bubble-content">
        ${escapeHtml(msg.message)}
        ${mediaHtml}
      </div>
      <span class="message-time">${msg.sent_at}</span>
    </div>
  `;
}

function appendMessageToFeed(msg) {
  const feed = document.getElementById('messageFeed');
  if (feed.querySelector('.empty-state')) {
    feed.innerHTML = '';
  }
  const div = document.createElement('div');
  div.innerHTML = renderMessageHtml(msg);
  feed.appendChild(div.firstElementChild);
  feed.scrollTop = feed.scrollHeight;
}

// 7. 아카이브 게시판 피드 로드
async function loadBoard() {
  const feed = document.getElementById('boardFeed');
  try {
    const res = await fetch('/api/board?limit=30');
    const json = await res.json();
    if (!json.success || json.data.length === 0) {
      feed.innerHTML = '<div class="empty-state">아직 발행된 게시판 리포트가 없습니다.<br>자동 스케줄러를 등록하거나 수동 실행해 보세요!</div>';
      return;
    }

    feed.innerHTML = json.data.map(post => `
      <div class="board-card" onclick="openPostModal(${post.id})">
        <div class="board-card-title">${escapeHtml(post.title)}</div>
        <div class="board-card-meta">
          <span>대화방: <strong>${escapeHtml(post.room_name)}</strong></span>
          <span>메시지: ${post.message_count}건</span>
          <span>미디어: ${post.media_count}건</span>
        </div>
        <div class="board-card-summary">${escapeHtml(post.summary)}</div>
        <div class="board-card-meta" style="margin-top:auto;">
          <span>생성일: ${post.created_at}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    feed.innerHTML = '<div class="empty-state">게시판 로드 실패</div>';
  }
}

async function openPostModal(id) {
  try {
    const res = await fetch(`/api/board/${id}`);
    const json = await res.json();
    if (!json.success) return;

    const post = json.data;
    document.getElementById('modalPostTitle').textContent = post.title;
    document.getElementById('modalPostMeta').innerHTML = `
      대화방: <strong>${escapeHtml(post.room_name)}</strong> | 
      기간: ${post.period_start || '-'} ~ ${post.period_end || '-'} | 
      메시지: ${post.message_count}건 | 미디어: ${post.media_count}건
    `;
    document.getElementById('modalPostSummary').textContent = post.summary;

    const msgsEl = document.getElementById('modalPostMessages');
    const sample = (post.content_json && post.content_json.messagesSample) || [];
    if (sample.length > 0) {
      msgsEl.innerHTML = sample.map(m => `
        <div class="sample-msg-row">
          <strong>${escapeHtml(m.sender)}:</strong> ${escapeHtml(m.message)}
          <small>(${m.sent_at})</small>
        </div>
      `).join('');
    } else {
      msgsEl.innerHTML = '<span class="hint">포함된 대화 샘플이 없습니다.</span>';
    }

    document.getElementById('postDetailDialog').showModal();
  } catch (err) {
    alert('게시글을 불러올 수 없습니다.');
  }
}

// 8. 미디어 갤러리 로드
async function loadMedia() {
  const grid = document.getElementById('mediaGrid');
  try {
    const res = await fetch('/api/media?limit=60');
    const json = await res.json();
    if (!json.success || json.data.length === 0) {
      grid.innerHTML = '<div class="empty-state">저장된 미디어가 없습니다. 맥북 동기화 에이전트를 통해 사진/동영상을 백업해 보세요.</div>';
      return;
    }

    grid.innerHTML = json.data.map(item => {
      let preview = '📎';
      const fileUrl = item.attachment_path || '';
      const downloadHref = item.downloadUrl || `/api/media/${item.id}/download` || fileUrl;

      if (item.message_type === 'image') {
        preview = `<img src="${fileUrl}" alt="${escapeHtml(item.attachment_name || '사진')}" loading="lazy">`;
      } else if (item.message_type === 'video') {
        preview = `🎥 <small>동영상</small>`;
      } else {
        preview = `📄 <small>파일</small>`;
      }

      return `
        <div class="media-card" data-id="${item.id}">
          <div class="media-preview-container" onclick="openMediaPreview('${fileUrl}', '${escapeHtml(item.attachment_name || '미디어')}', '${item.message_type}', ${item.id})">
            ${preview}
          </div>
          <div class="media-card-info">
            <div class="media-card-name" title="${escapeHtml(item.attachment_name || item.message)}">${escapeHtml(item.attachment_name || item.message)}</div>
            <div class="media-card-date">${escapeHtml(item.room_name)} · ${item.sent_at}</div>
            <div class="media-card-actions">
              <a href="${downloadHref}" download="${escapeHtml(item.attachment_name || 'download')}" class="btn-sm btn-media-download" onclick="event.stopPropagation();">
                💾 다운로드
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = '<div class="empty-state">미디어 로드 실패</div>';
  }
}

function openMediaPreview(filePath, name, type, id) {
  const dialog = document.getElementById('mediaPreviewDialog');
  const title = document.getElementById('mediaPreviewTitle');
  const body = document.getElementById('mediaPreviewBody');

  const downloadHref = id ? `/api/media/${id}/download` : filePath;

  title.textContent = name;
  let contentHtml = '';
  if (type === 'image') {
    contentHtml = `<img src="${filePath}" style="max-width:100%; max-height:65vh; display:block; margin:0 auto 12px; border-radius:8px;">`;
  } else if (type === 'video') {
    contentHtml = `<video src="${filePath}" controls autoplay style="max-width:100%; max-height:65vh; display:block; margin:0 auto 12px; border-radius:8px;"></video>`;
  } else {
    contentHtml = `<div style="padding:24px; text-align:center; font-size:1.2rem;">📄 ${escapeHtml(name)}</div>`;
  }

  body.innerHTML = `
    ${contentHtml}
    <div style="display:flex; justify-content:center; gap:10px; margin-top:12px;">
      <a href="${downloadHref}" download="${escapeHtml(name)}" class="btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
        💾 PC/스마트폰으로 원본 다운로드
      </a>
      <a href="${filePath}" target="_blank" class="btn-outline" style="text-decoration:none; display:inline-flex; align-items:center;">
        새 탭에서 열기
      </a>
    </div>
  `;

  dialog.showModal();
}

// 9. 스케줄러 관리
function renderSchedulerRoomCheckboxes(rooms) {
  const box = document.getElementById('schedRoomCheckboxes');
  if (!box) return;

  if (rooms.length === 0) {
    box.innerHTML = '<span class="hint">등록된 대화방이 없습니다.</span>';
    return;
  }

  box.innerHTML = rooms.map(r => `
    <label>
      <input type="checkbox" name="schedRooms" value="${r.id}">
      ${escapeHtml(r.name)} (${r.message_count}건)
    </label>
  `).join('');
}

async function loadSchedules() {
  const list = document.getElementById('scheduleList');
  try {
    const res = await fetch('/api/schedules');
    const json = await res.json();
    if (!json.success || json.data.length === 0) {
      list.innerHTML = '<div class="empty-state">등록된 자동 스케줄이 없습니다.</div>';
      return;
    }

    list.innerHTML = json.data.map(s => `
      <div class="schedule-card">
        <div class="schedule-info">
          <h4>${escapeHtml(s.name)}</h4>
          <div class="schedule-meta">
            주기: <strong>${s.interval_type}</strong> | 
            대상 방: ${s.room_ids.length > 0 ? `${s.room_ids.length}개 방` : '전체 방'} | 
            최근 실행: ${s.last_run_at || '없음'}
          </div>
        </div>
        <div class="chat-actions">
          <button class="btn-sm" onclick="runScheduleNow('${s.id}')">즉시 실행</button>
          <button class="btn-sm btn-outline btn-danger" onclick="deleteSchedule('${s.id}')">삭제</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state">스케줄 로드 실패</div>';
  }
}

async function runScheduleNow(id) {
  try {
    const res = await fetch(`/api/schedules/${id}/run`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      alert('스케줄이 성공적으로 실행되어 게시판에 새 리포트가 등록되었습니다!');
      loadBoard();
      loadSchedules();
    } else {
      alert('스케줄 실행 실패: ' + json.error);
    }
  } catch (err) {
    alert('요청 중 오류가 발생했습니다.');
  }
}

async function deleteSchedule(id) {
  if (!confirm('정말 이 스케줄을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      loadSchedules();
    }
  } catch (err) {
    alert('삭제 실패');
  }
}

// 10. 이벤트 리스너 등록
function setupEventListeners() {
  // 모달 닫기
  document.getElementById('btnClosePostModal')?.addEventListener('click', () => {
    document.getElementById('postDetailDialog').close();
  });
  document.getElementById('btnCloseMediaModal')?.addEventListener('click', () => {
    document.getElementById('mediaPreviewDialog').close();
  });

  // 대화방 새로고침
  document.getElementById('btnRefreshRooms')?.addEventListener('click', () => {
    roomDisplayCount = 5;
    loadRooms();
  });

  // 대화방 검색어 입력 시 5개 리셋 & 실시간 필터링
  const roomSearchInput = document.getElementById('roomSearchInput');
  if (roomSearchInput) {
    roomSearchInput.addEventListener('input', () => {
      roomDisplayCount = 5;
      renderRoomList(roomsData);
    });
  }

  // 스케줄 폼 제출
  document.getElementById('schedulerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('schedName').value.trim();
    const intervalType = document.getElementById('schedInterval').value;
    const downloadMedia = document.getElementById('optDownloadMedia').checked;
    const aiSummary = document.getElementById('optAiSummary').checked;

    const checkedRooms = Array.from(document.querySelectorAll('input[name="schedRooms"]:checked')).map(cb => cb.value);

    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          intervalType,
          roomIds: checkedRooms,
          options: { downloadMedia, aiSummary },
        }),
      });
      const json = await res.json();
      if (json.success) {
        alert('스케줄이 성공적으로 등록되었습니다.');
        document.getElementById('schedulerForm').reset();
        loadSchedules();
      }
    } catch (err) {
      alert('스케줄 저장 실패: ' + err.message);
    }
  });

  // 게시판 버튼에서 스케줄 탭으로 이동
  document.getElementById('btnCreateSchedulePost')?.addEventListener('click', () => {
    switchTab('scheduler');
  });
}

// 11. 모바일 라이프사이클 대응 (공통 지침 5 준수)
function setupMobileLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[Mobile Lifecycle] 화면 복귀 감지 -> 데이터 갱신');
      loadStats();
      if (activeRoomId) loadMessages(activeRoomId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        initWebSocket();
      }
    }
  });

  window.addEventListener('pageshow', () => {
    loadStats();
  });

  window.addEventListener('online', () => {
    console.log('[Network] 온라인 복구');
    initWebSocket();
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 12. PWA & 앱으로 보내기 (홈 화면에 추가) 모듈
let deferredPrompt = null;

function initPwa() {
  // 12.1. 서비스 워커 등록
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[PWA] ServiceWorker registered with scope:', reg.scope))
        .catch(err => console.warn('[PWA] ServiceWorker registration error:', err));
    });
  }

  // 12.2. 안드로이드/Chrome beforeinstallprompt 이벤트 감지
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt captured');
    const directBox = document.getElementById('pwaDirectInstallBox');
    if (directBox) directBox.style.display = 'block';
  });

  // 12.3. 앱 설치 완료 감지
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed!');
    deferredPrompt = null;
    const directBox = document.getElementById('pwaDirectInstallBox');
    if (directBox) directBox.style.display = 'none';
  });

  // 12.4. 상단 '앱으로 보내기' 버튼 클릭
  const btnPwaInstall = document.getElementById('btnPwaInstall');
  const pwaDialog = document.getElementById('pwaGuideDialog');
  const btnClosePwaModal = document.getElementById('btnClosePwaModal');

  if (btnPwaInstall && pwaDialog) {
    btnPwaInstall.addEventListener('click', () => {
      // 기기 OS 감지하여 해당 탭 기본 활성화
      const ua = navigator.userAgent.toLowerCase();
      const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIos) {
        selectPwaTab('ios');
      } else {
        selectPwaTab('android');
      }

      if (deferredPrompt) {
        const directBox = document.getElementById('pwaDirectInstallBox');
        if (directBox) directBox.style.display = 'block';
      }

      pwaDialog.showModal();
    });
  }

  if (btnClosePwaModal && pwaDialog) {
    btnClosePwaModal.addEventListener('click', () => {
      pwaDialog.close();
    });
  }

  // 모달 배경 클릭 시 닫기
  if (pwaDialog) {
    pwaDialog.addEventListener('click', (e) => {
      if (e.target === pwaDialog) pwaDialog.close();
    });
  }

  // 12.5. 안드로이드 원클릭 직접 설치 트리거
  const btnDirectInstall = document.getElementById('btnPwaDirectInstall');
  if (btnDirectInstall) {
    btnDirectInstall.addEventListener('click', async () => {
      if (!deferredPrompt) {
        alert('브라우저 메뉴(⋮)에서 [홈 화면에 추가] 또는 [앱 설치]를 선택해주세요! 📲');
        return;
      }
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] Install choice outcome:', outcome);
      deferredPrompt = null;
      const directBox = document.getElementById('pwaDirectInstallBox');
      if (directBox) directBox.style.display = 'none';

      if (outcome === 'accepted') {
        alert('카카오 아카이브 앱이 스마트폰 홈 화면에 추가되었습니다! ✨');
        if (pwaDialog) pwaDialog.close();
      }
    });
  }

  // 12.6. iOS / Android 탭 전환
  const tabIos = document.getElementById('tabPwaIos');
  const tabAndroid = document.getElementById('tabPwaAndroid');

  if (tabIos) tabIos.addEventListener('click', () => selectPwaTab('ios'));
  if (tabAndroid) tabAndroid.addEventListener('click', () => selectPwaTab('android'));

  // 12.7. 다른 앱/기기로 공유하기 (Web Share API)
  const btnShare = document.getElementById('btnShareApp');
  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      const shareUrl = window.location.origin;
      if (navigator.share) {
        try {
          await navigator.share({
            title: '카카오 아카이브 (KT Archive)',
            text: '카카오톡 실시간 메시지 아카이브 & 대시보드 웹 서비스입니다.',
            url: shareUrl,
          });
        } catch (err) {
          if (err.name !== 'AbortError') console.warn('[Share] Share error:', err);
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl);
          alert('웹 서비스 주소가 복사되었습니다! 카톡이나 메시지로 전달해주세요:\n' + shareUrl);
        } catch {
          prompt('아래 링크를 복사하여 모바일에서 접속하세요:', shareUrl);
        }
      }
    });
  }
}

function selectPwaTab(os) {
  const tabIos = document.getElementById('tabPwaIos');
  const tabAndroid = document.getElementById('tabPwaAndroid');
  const panelIos = document.getElementById('panelPwaIos');
  const panelAndroid = document.getElementById('panelPwaAndroid');

  if (os === 'ios') {
    tabIos?.classList.add('active');
    tabAndroid?.classList.remove('active');
    if (panelIos) panelIos.style.display = 'block';
    if (panelAndroid) panelAndroid.style.display = 'none';
  } else {
    tabAndroid?.classList.add('active');
    tabIos?.classList.remove('active');
    if (panelAndroid) panelAndroid.style.display = 'block';
    if (panelIos) panelIos.style.display = 'none';
  }
}

// ==========================================
// 13. [고도화 1 & 3] 일별 대화 요약 (Daily Summary) 기능
// ==========================================
function initDailySummaryFeature() {
  const btnTimeline = document.getElementById('btnViewTimeline');
  const btnDaily = document.getElementById('btnViewDailySummary');
  const dailyDatesBar = document.getElementById('dailyDatesBar');
  const searchBar = document.getElementById('messageSearchBar');
  const feed = document.getElementById('messageFeed');
  const dailyView = document.getElementById('dailySummaryView');

  if (btnTimeline) {
    btnTimeline.addEventListener('click', () => {
      currentViewMode = 'timeline';
      btnTimeline.classList.add('active');
      btnDaily?.classList.remove('active');
      if (searchBar) searchBar.style.display = 'block';
      if (feed) feed.style.display = 'flex';
      if (dailyDatesBar) dailyDatesBar.style.display = 'none';
      if (dailyView) dailyView.style.display = 'none';
    });
  }

  if (btnDaily) {
    btnDaily.addEventListener('click', () => {
      if (!activeRoomId) {
        alert('먼저 대화방을 선택해주세요!');
        return;
      }
      currentViewMode = 'daily';
      btnDaily.classList.add('active');
      btnTimeline?.classList.remove('active');
      if (searchBar) searchBar.style.display = 'none';
      if (feed) feed.style.display = 'none';
      if (dailyDatesBar) dailyDatesBar.style.display = 'flex';
      if (dailyView) dailyView.style.display = 'block';

      if (currentSummaryDate) {
        loadDailySummary(activeRoomId, currentSummaryDate);
      } else {
        loadRoomDailySummaries(activeRoomId);
      }
    });
  }
}

async function loadRoomDailySummaries(roomId) {
  const chipsContainer = document.getElementById('dateChipsContainer');
  if (!chipsContainer) return;

  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/daily-summaries`);
    const json = await res.json();
    if (!json.success || !json.data || json.data.length === 0) {
      chipsContainer.innerHTML = '<span class="hint">기록된 일별 대화가 없습니다.</span>';
      return;
    }

    const summaries = json.data;
    // 최신 날짜를 기본값으로 지정
    if (!currentSummaryDate || !summaries.find(s => s.date === currentSummaryDate)) {
      currentSummaryDate = summaries[0].date;
    }

    chipsContainer.innerHTML = summaries.map(s => `
      <button type="button" class="date-chip ${s.date === currentSummaryDate ? 'active' : ''}" data-date="${s.date}">
        <span>${s.date}</span>
        <span class="chip-count">${s.total_messages}건</span>
        ${s.total_media > 0 ? `<span class="chip-media">📸${s.total_media}</span>` : ''}
      </button>
    `).join('');

    chipsContainer.querySelectorAll('.date-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const d = chip.getAttribute('data-date');
        currentSummaryDate = d;
        chipsContainer.querySelectorAll('.date-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-date') === d));
        loadDailySummary(roomId, d);
      });
    });

    if (currentViewMode === 'daily') {
      loadDailySummary(roomId, currentSummaryDate);
    }
  } catch (err) {
    console.error('일별 집계 로드 실패:', err);
  }
}

async function loadDailySummary(roomId, dateStr) {
  const card = document.getElementById('dailySummaryCard');
  if (!card) return;

  card.innerHTML = `<div class="daily-summary-loading">${dateStr} 대화 분석 및 일일 브리핑 요약 생성 중...</div>`;

  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/daily/${encodeURIComponent(dateStr)}`);
    const json = await res.json();
    if (!json.success) {
      card.innerHTML = `<div class="empty-state">요약 로드 실패: ${escapeHtml(json.error || '오류')}</div>`;
      return;
    }

    currentDailySummaryData = json;

    // 발언자 순위 뱃지
    const senderEntries = Object.entries(json.senderStats || {}).sort((a, b) => b[1] - a[1]);
    const senderPillsHtml = senderEntries.map(([s, c]) => `
      <span class="sender-pill"><strong>${escapeHtml(s)}</strong> <small>(${c}건)</small></span>
    `).join('');

    // 주요 현장 보고/이슈 뱃지
    const eventsHtml = (json.keyEvents || []).map(ev => `
      <div class="event-item-card">
        <span class="event-badge badge-${ev.type}">${ev.type}</span>
        <div class="event-body">
          <span class="event-sender">${escapeHtml(ev.sender)} <small>${ev.time}</small></span>
          <p class="event-snippet">${escapeHtml(ev.snippet)}</p>
        </div>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="daily-card-header">
        <div class="daily-title-group">
          <span class="daily-badge">📅 일일 종합 브리핑</span>
          <h4>[${escapeHtml(json.roomName || '대화방')}] ${dateStr}</h4>
          <span class="daily-meta">총 대화 ${json.messageCount}건 · 참여자 ${senderEntries.length}명</span>
        </div>
        <button class="btn-sm btn-primary" id="btnPublishToBoard" type="button">
          📢 아카이브 게시판으로 발행
        </button>
      </div>

      <!-- 요약 본문 카드 -->
      <div class="daily-summary-text-box">
        <pre class="daily-summary-pre">${escapeHtml(json.summary)}</pre>
      </div>

      <!-- 참여 발언자 분포 -->
      <div class="daily-section">
        <h5>👥 참여 발언자 분포</h5>
        <div class="sender-pills-row">${senderPillsHtml || '<span class="hint">-</span>'}</div>
      </div>

      <!-- 주요 현장 보고 타임라인 -->
      ${eventsHtml ? `
        <div class="daily-section">
          <h5>🚨 주요 현장 보고 & 이슈 (${json.keyEvents.length}건)</h5>
          <div class="events-list-container">${eventsHtml}</div>
        </div>
      ` : ''}

      <!-- 해당 날짜 대화 원문 미리보기 토글 -->
      <details class="daily-transcript-details">
        <summary>📜 ${dateStr} 전체 대화 원문 (${json.messages.length}건) 열람</summary>
        <div class="transcript-feed">
          ${json.messages.map(m => `
            <div class="transcript-row">
              <span class="t-time">${m.sent_at.substring(11)}</span>
              <strong class="t-sender">${escapeHtml(m.sender)}:</strong>
              <span class="t-msg">${escapeHtml(m.message)}</span>
              ${m.attachment_path ? `<a href="${m.attachment_path}" target="_blank" class="t-file">📎첨부</a>` : ''}
            </div>
          `).join('')}
        </div>
      </details>
    `;

    // 게시판 발행 버튼 바인딩
    const btnPub = document.getElementById('btnPublishToBoard');
    if (btnPub) {
      btnPub.addEventListener('click', () => publishCurrentDailySummary(roomId, dateStr));
    }

  } catch (err) {
    card.innerHTML = `<div class="empty-state">대화 요약 로드 중 오류가 발생했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

async function publishCurrentDailySummary(roomId, dateStr) {
  if (!currentDailySummaryData) return;
  const btn = document.getElementById('btnPublishToBoard');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/daily/${encodeURIComponent(dateStr)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: currentDailySummaryData.summary,
        keyEvents: currentDailySummaryData.keyEvents,
        senderStats: currentDailySummaryData.senderStats,
      }),
    });
    const json = await res.json();
    if (json.success) {
      alert(`✨ [${dateStr}] 일일 요약이 아카이브 게시판에 성공적으로 발행되었습니다!`);
      loadBoard();
      loadStats();
    } else {
      alert(`발행 실패: ${json.error || '오류'}`);
    }
  } catch (err) {
    alert(`발행 오류: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==========================================
// 14. [고도화 1] 대화방 병합 (Merge Rooms) 기능
// ==========================================
function initMergeRoomsFeature() {
  const btnOpen = document.getElementById('btnOpenMergeModal');
  const btnClose = document.getElementById('btnCloseMergeModal');
  const btnCancel = document.getElementById('btnCancelMerge');
  const btnExecute = document.getElementById('btnExecuteMerge');
  const modal = document.getElementById('mergeRoomsDialog');
  const targetSelect = document.getElementById('mergeTargetRoom');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      populateMergeModal();
      modal.showModal();
    });
  }

  if (btnClose && modal) btnClose.addEventListener('click', () => modal.close());
  if (btnCancel && modal) btnCancel.addEventListener('click', () => modal.close());

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.close();
    });
  }

  if (targetSelect) {
    targetSelect.addEventListener('change', () => {
      renderMergeSourceCheckboxes(targetSelect.value);
    });
  }

  if (btnExecute) {
    btnExecute.addEventListener('click', executeRoomMerge);
  }
}

function populateMergeModal() {
  const targetSelect = document.getElementById('mergeTargetRoom');
  if (!targetSelect || !roomsData) return;

  targetSelect.innerHTML = roomsData.map(r => `
    <option value="${r.id}" ${r.id === activeRoomId ? 'selected' : ''}>
      ${escapeHtml(r.name)} (${r.message_count}건)
    </option>
  `).join('');

  renderMergeSourceCheckboxes(targetSelect.value);
}

function renderMergeSourceCheckboxes(targetRoomId) {
  const container = document.getElementById('mergeSourceCheckboxes');
  if (!container || !roomsData) return;

  const sources = roomsData.filter(r => r.id !== targetRoomId);
  if (sources.length === 0) {
    container.innerHTML = '<span class="hint">합칠 다른 대화방이 없습니다.</span>';
    return;
  }

  container.innerHTML = sources.map(r => `
    <label class="merge-checkbox-item">
      <input type="checkbox" name="mergeSourceRoom" value="${r.id}">
      <span class="room-title">${escapeHtml(r.name)}</span>
      <span class="room-msg-count">${r.message_count}건</span>
    </label>
  `).join('');
}

async function executeRoomMerge() {
  const targetSelect = document.getElementById('mergeTargetRoom');
  const targetRoomId = targetSelect ? targetSelect.value : null;
  const checkedBoxes = document.querySelectorAll('input[name="mergeSourceRoom"]:checked');

  if (!targetRoomId) {
    alert('통합 대상 대화방을 선택하세요.');
    return;
  }

  const sourceRoomIds = Array.from(checkedBoxes).map(cb => cb.value);
  if (sourceRoomIds.length === 0) {
    alert('흡수하여 합칠 대화방을 1개 이상 선택해주세요.');
    return;
  }

  const targetRoom = roomsData.find(r => r.id === targetRoomId);
  const targetName = targetRoom ? targetRoom.name : '선택한 대상 방';

  const confirmMsg = `정말 ${sourceRoomIds.length}개의 대화방을 [${targetName}]으로 합치시겠습니까?\n` +
    `선택한 방들의 모든 대화와 미디어가 대상 방으로 이전되며, 빈 방은 정리됩니다.`;

  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btnExecuteMerge');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/rooms/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetRoomId, sourceRoomIds }),
    });
    const json = await res.json();
    if (json.success) {
      alert(`✨ 성공적으로 ${json.mergedCount}개의 대화방이 [${json.targetRoomName}]으로 병합되었습니다!`);
      const modal = document.getElementById('mergeRoomsDialog');
      if (modal) modal.close();
      await loadRooms();
      selectRoom(targetRoomId);
    } else {
      alert(`대화방 병합 실패: ${json.error || '오류'}`);
    }
  } catch (err) {
    alert(`병합 통신 오류: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}
