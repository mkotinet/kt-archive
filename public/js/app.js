/**
 * kt-archive 프론트엔드 통합 클라이언트 스크립트
 */

let activeRoomId = null;
let ws = null;
let roomsData = [];

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
  setupMobileLifecycle();
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
  if (rooms.length === 0) {
    listEl.innerHTML = '<li class="empty-state">등록된 대화방이 없습니다.<br><small>카톡 웹훅 또는 맥북 동기화 시 자동 등록됩니다.</small></li>';
    return;
  }

  listEl.innerHTML = rooms.map(room => `
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

  listEl.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => {
      const roomId = item.getAttribute('data-id');
      selectRoom(roomId);
    });
  });
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
      if (item.message_type === 'image') {
        preview = `<img src="${item.attachment_path}" alt="${escapeHtml(item.attachment_name || '사진')}">`;
      } else if (item.message_type === 'video') {
        preview = `🎥`;
      }

      return `
        <div class="media-card" onclick="openMediaPreview('${item.attachment_path}', '${escapeHtml(item.attachment_name || '미디어')}', '${item.message_type}')">
          <div class="media-preview-container">
            ${preview}
          </div>
          <div class="media-card-info">
            <div class="media-card-name">${escapeHtml(item.attachment_name || item.message)}</div>
            <div class="media-card-date">${escapeHtml(item.room_name)} · ${item.sent_at}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = '<div class="empty-state">미디어 로드 실패</div>';
  }
}

function openMediaPreview(path, name, type) {
  const dialog = document.getElementById('mediaPreviewDialog');
  const title = document.getElementById('mediaPreviewTitle');
  const body = document.getElementById('mediaPreviewBody');

  title.textContent = name;
  if (type === 'image') {
    body.innerHTML = `<img src="${path}" style="max-width:100%; max-height:75vh; display:block; margin:auto; border-radius:8px;">`;
  } else if (type === 'video') {
    body.innerHTML = `<video src="${path}" controls autoplay style="max-width:100%; max-height:75vh; display:block; margin:auto; border-radius:8px;"></video>`;
  } else {
    body.innerHTML = `<p>다운로드 파일: <a href="${path}" download class="btn-primary">다운로드 (${escapeHtml(name)})</a></p>`;
  }

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
  document.getElementById('btnRefreshRooms')?.addEventListener('click', loadRooms);

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
