/**
 * 개인 및 부대 일정관리 체계 & 공개 메모장
 * Core Application Logic (with Safe Storage & Supabase v2 Integration)
 */

// ==========================================
// 0. 안전한 스토리지 유틸리티 (file:// 프로토콜 보안 에러 방지)
// ==========================================
const MemoryStorage = {};
const SafeStorage = {
  getItem(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage 접근 불가, 메모리 저장소 사용:', e);
    }
    return MemoryStorage[key] || null;
  },
  setItem(key, value) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage 쓰기 불가, 메모리 저장소 사용:', e);
    }
    MemoryStorage[key] = String(value);
  },
  removeItem(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) { }
    delete MemoryStorage[key];
  }
};

// ==========================================
// 1. 전역 상태 관리 (State)
// ==========================================
const AppState = {
  supabase: null,
  isSupabaseConnected: false,

  // 메모 및 일정 데이터 (메모리 캐시)
  memos: [],
  schedules: [],

  // 필터 및 캘린더 상태
  currentFilter: 'all',
  selectedDate: null, // 'YYYY-MM-DD' or null
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0-based

  // 선택된 이모지 및 색상
  selectedEmoji: '💪',
  selectedColor: 'yellow',

  // D-Day 기본 설정
  ddayConfig: {
    enlistDate: '2026-03-01',
    dischargeDate: '2027-08-31',
    vacationTitle: '다음 정기 휴가',
    vacationDate: '2026-12-05',
    vacationDesc: '목표: 3박 4일 포상 & 정기휴가',
    trainingTitle: '부대 주요 훈련',
    trainingDate: '2026-11-28',
    trainingDesc: '대대 전술종합평가 훈련'
  }
};

// ==========================================
// 2. 초기화 (Initialization - 이중 실행 방지 및 즉시 실행 지원)
// ==========================================
let isAppInitialized = false;

async function startApplication() {
  if (isAppInitialized) return;
  isAppInitialized = true;

  console.log('[App] 일정관리 체계 애플리케이션 초기화 시작...');

  try { initClock(); } catch (e) { console.error('시계 초기화 에러:', e); }
  try { loadDdayConfig(); } catch (e) { console.error('D-Day 설정 로드 에러:', e); }
  try { setupEventListeners(); } catch (e) { console.error('이벤트 리스너 등록 에러:', e); }
  try { renderCalendar(); } catch (e) { console.error('캘린더 렌더링 에러:', e); }
  try { updateDdayUI(); } catch (e) { console.error('D-Day UI 렌더링 에러:', e); }

  // Supabase 클라이언트 초기화 및 데이터 로드
  try {
    await initSupabaseClient();
  } catch (e) {
    console.warn('Supabase 초기화 예외:', e);
  }

  try {
    await reloadAllData();
  } catch (e) {
    console.error('데이터 로드 에러:', e);
  }

  console.log('[App] 애플리케이션 준비 완료.');
}

// DOMContentLoaded가 이미 발생했을 수도 있으므로 readyState 확인
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApplication);
} else {
  // 이미 문서가 준비되었으므로 즉시 실행
  startApplication();
}

// ==========================================
// 3. Supabase 초기화 및 연결 관리
// ==========================================
async function initSupabaseClient() {
  // 1) SafeStorage 설정 확인
  let url = SafeStorage.getItem('unit_supabase_url');
  let key = SafeStorage.getItem('unit_supabase_key');

  // 2) 없으면 config.js 값 사용
  if (!url && window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.SUPABASE_URL) {
    url = window.SUPABASE_CONFIG.SUPABASE_URL;
  }
  if (!key && window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.SUPABASE_ANON_KEY) {
    key = window.SUPABASE_CONFIG.SUPABASE_ANON_KEY;
  }

  // 값이 채워져 있는지 확인
  if (url && key && url.trim() !== '' && key.trim() !== '' && !url.includes('YOUR_')) {
    try {
      if (window.supabase) {
        AppState.supabase = window.supabase.createClient(url.trim(), key.trim());

        // ping 테스트
        const { error } = await AppState.supabase.from('memos').select('id').limit(1);

        if (!error) {
          AppState.isSupabaseConnected = true;
          updateDbStatusUI(true);
          return;
        } else {
          console.warn('Supabase ping 실패:', error.message);
        }
      }
    } catch (e) {
      console.warn('Supabase 접속 초기화 에러:', e);
    }
  }

  // Supabase 미연결 시 로컬 모드
  AppState.isSupabaseConnected = false;
  updateDbStatusUI(false);
}

function updateDbStatusUI(isConnected) {
  const statusBtn = document.getElementById('dbStatusBtn');
  const statusText = document.getElementById('dbStatusText');
  const banner = document.getElementById('dbAlertBanner');

  if (statusBtn && statusText) {
    if (isConnected) {
      statusBtn.className = 'status-btn status-connected';
      statusText.textContent = '🟢 Supabase DB 실시간 연동됨';
      if (banner) banner.style.display = 'none';
    } else {
      statusBtn.className = 'status-btn status-disconnected';
      statusText.textContent = '🟡 로컬 데모 모드 (연결 설정)';
      if (banner) banner.style.display = 'flex';
    }
  }
}

// ==========================================
// 4. 데이터 로드 및 저장
// ==========================================
async function reloadAllData() {
  await Promise.all([loadSchedules(), loadMemos()]);
  renderSchedules();
  renderMemos();
  renderCalendar();
  updateDdayUI();
}

async function loadSchedules() {
  if (AppState.isSupabaseConnected && AppState.supabase) {
    try {
      const { data, error } = await AppState.supabase
        .from('schedules')
        .select('*')
        .order('start_date', { ascending: true });

      if (!error && data) {
        AppState.schedules = data;
        return;
      }
    } catch (e) {
      console.error('Supabase 일정 로드 오류:', e);
    }
  }

  // Fallback: SafeStorage
  const saved = SafeStorage.getItem('unit_local_schedules');
  if (saved) {
    try {
      AppState.schedules = JSON.parse(saved);
    } catch (e) {
      AppState.schedules = getDefaultSchedules();
    }
  } else {
    AppState.schedules = getDefaultSchedules();
    SafeStorage.setItem('unit_local_schedules', JSON.stringify(AppState.schedules));
  }
}

async function loadMemos() {
  if (AppState.isSupabaseConnected && AppState.supabase) {
    try {
      const { data, error } = await AppState.supabase
        .from('memos')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        AppState.memos = data;
        return;
      }
    } catch (e) {
      console.error('Supabase 메모 로드 오류:', e);
    }
  }

  // Fallback: SafeStorage
  const saved = SafeStorage.getItem('unit_local_memos');
  if (saved) {
    try {
      AppState.memos = JSON.parse(saved);
    } catch (e) {
      AppState.memos = getDefaultMemos();
    }
  } else {
    AppState.memos = getDefaultMemos();
    SafeStorage.setItem('unit_local_memos', JSON.stringify(AppState.memos));
  }
}

function getDefaultSchedules() {
  const today = new Date();
  const format = (d) => d.toISOString().split('T')[0];
  const addDays = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return format(d);
  };

  return [
    {
      id: 'sample-sched-1',
      title: '대대 전술종합평가 훈련',
      type: 'unit',
      start_date: addDays(3),
      end_date: addDays(5),
      location: '대연병장 및 종합훈련장',
      memo: '단독군장 준비 및 장비 점검 완료할 것',
      priority: 'urgent',
      created_at: new Date().toISOString()
    },
    {
      id: 'sample-sched-2',
      title: '정기 외박 / 휴가',
      type: 'vacation',
      start_date: addDays(10),
      end_date: addDays(13),
      location: '서울 본가',
      memo: '복귀시간 20:00 준수',
      priority: 'important',
      created_at: new Date().toISOString()
    },
    {
      id: 'sample-sched-3',
      title: '주간 야간 당직사령 / 근무',
      type: 'duty',
      start_date: addDays(1),
      end_date: addDays(1),
      location: '지휘통제실',
      memo: '근무교대 15분 전 도착 완료',
      priority: 'normal',
      created_at: new Date().toISOString()
    },
    {
      id: 'sample-sched-4',
      title: '부대 친선 풋살 토너먼트',
      type: 'unit',
      start_date: addDays(7),
      end_date: addDays(7),
      location: '연병장',
      memo: '중대 대항 토너먼트',
      priority: 'normal',
      created_at: new Date().toISOString()
    }
  ];
}

function getDefaultMemos() {
  return [
    {
      id: 'sample-memo-1',
      author: '3소대 김병장',
      category: '응원',
      content: '오늘 하루도 다치지 말고 무사히 훈련 마칩시다! 충성! 💪',
      emoji: '💪',
      color: 'yellow',
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString()
    },
    {
      id: 'sample-memo-2',
      author: '민성이 친구 현우',
      category: '응원',
      content: '민성아 휴가 때 보자! 맛있는 치킨 피자 사줄 테니까 힘내라! 🔥',
      emoji: '🍕',
      color: 'blue',
      created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString()
    },
    {
      id: 'sample-memo-3',
      author: '행정보급관',
      category: '부대안내',
      content: '금일 일과 후 생활관 방역 및 개인 관물대 정리정돈 철저히 바람.',
      emoji: '📢',
      color: 'green',
      created_at: new Date(Date.now() - 1000 * 60 * 360).toISOString()
    },
    {
      id: 'sample-memo-4',
      author: '방문자 수진',
      category: '자유',
      content: '사이트 디자인 너무 멋져요! 항상 나라 지켜주셔서 감사합니다 🎖️',
      emoji: '⭐',
      color: 'purple',
      created_at: new Date(Date.now() - 1000 * 60 * 720).toISOString()
    }
  ];
}

// ==========================================
// 5. 모달 제어 함수들 (HTML onclick 지원)
// ==========================================
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

function openAddScheduleModal() {
  const dateInput = document.getElementById('schedStartDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
  openModal('addScheduleModal');
}

function openDbConfigModal() {
  const url = SafeStorage.getItem('unit_supabase_url') || (window.SUPABASE_CONFIG?.SUPABASE_URL || '');
  const key = SafeStorage.getItem('unit_supabase_key') || (window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || '');

  const urlInput = document.getElementById('cfgSupabaseUrl');
  const keyInput = document.getElementById('cfgSupabaseKey');
  const resDiv = document.getElementById('testConnResult');

  if (urlInput) urlInput.value = url;
  if (keyInput) keyInput.value = key;
  if (resDiv) resDiv.style.display = 'none';

  openModal('dbConfigModal');
}

function openDdayModal() {
  const cfg = AppState.ddayConfig;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setVal('cfgEnlistDate', cfg.enlistDate);
  setVal('cfgDischargeDate', cfg.dischargeDate);
  setVal('cfgVacationTitle', cfg.vacationTitle);
  setVal('cfgVacationDate', cfg.vacationDate);
  setVal('cfgTrainingTitle', cfg.trainingTitle);
  setVal('cfgTrainingDate', cfg.trainingDate);

  openModal('ddayConfigModal');
}

// ==========================================
// 6. 메모 등록 & 삭제 핸들러
// ==========================================
async function handleMemoSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const author = document.getElementById('memoAuthor').value.trim();
  const category = document.getElementById('memoCategory').value;
  const content = document.getElementById('memoContent').value.trim();
  const password = document.getElementById('memoPassword').value.trim();
  const emoji = AppState.selectedEmoji || '💬';
  const color = AppState.selectedColor || 'yellow';

  if (!author || !content) {
    showToast('작성자와 메모 내용을 모두 입력해주세요.', 'warning');
    return;
  }

  const newMemo = {
    author,
    category,
    content,
    emoji,
    color,
    password: password || null,
    created_at: new Date().toISOString()
  };

  const submitBtn = document.getElementById('submitMemoBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장중...';
  }

  try {
    if (AppState.isSupabaseConnected && AppState.supabase) {
      const { data, error } = await AppState.supabase
        .from('memos')
        .insert([newMemo])
        .select();

      if (error) throw error;
      showToast('🎉 Supabase DB에 메모가 등록되었습니다!', 'success');
    } else {
      newMemo.id = 'local-memo-' + Date.now();
      AppState.memos.unshift(newMemo);
      SafeStorage.setItem('unit_local_memos', JSON.stringify(AppState.memos));
      showToast('로컬 메모장에 등록되었습니다 (DB 연동 시 전세계 공개)', 'success');
    }

    const form = document.getElementById('memoForm');
    if (form) form.reset();
    const charNum = document.getElementById('charNum');
    if (charNum) charNum.textContent = '0';

    await loadMemos();
    renderMemos();
  } catch (err) {
    console.error('메모 등록 에러:', err);
    showToast('메모 등록 실패: ' + (err.message || '오류 발생'), 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 메모 게시하기';
    }
  }
}

async function handleMemoDelete(memoId) {
  const memo = AppState.memos.find(m => m.id === memoId);
  if (!memo) return;

  if (memo.password) {
    const inputPw = prompt('작성 시 입력한 삭제 비밀번호를 입력해주세요:');
    if (inputPw === null) return;
    if (inputPw !== memo.password) {
      showToast('비밀번호가 일치하지 않습니다.', 'error');
      return;
    }
  } else {
    if (!confirm('이 메모를 정말 삭제하시겠습니까?')) return;
  }

  try {
    if (AppState.isSupabaseConnected && AppState.supabase) {
      const { error } = await AppState.supabase
        .from('memos')
        .delete()
        .eq('id', memoId);

      if (error) throw error;
      showToast('메모가 삭제되었습니다.', 'info');
    } else {
      AppState.memos = AppState.memos.filter(m => m.id !== memoId);
      SafeStorage.setItem('unit_local_memos', JSON.stringify(AppState.memos));
      showToast('메모가 삭제되었습니다.', 'info');
    }

    await loadMemos();
    renderMemos();
  } catch (err) {
    console.error('메모 삭제 에러:', err);
    showToast('삭제 실패: ' + err.message, 'error');
  }
}

// ==========================================
// 7. 일정 등록 & 삭제 핸들러
// ==========================================
async function handleScheduleSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const title = document.getElementById('schedTitle').value.trim();
  const type = document.getElementById('schedType').value;
  const priority = document.getElementById('schedPriority').value;
  const start_date = document.getElementById('schedStartDate').value;
  const end_date = document.getElementById('schedEndDate').value || null;
  const location = document.getElementById('schedLocation').value.trim() || null;
  const memo = document.getElementById('schedMemo').value.trim() || null;

  if (!title || !start_date) {
    showToast('일정 제목과 시작일을 입력해주세요.', 'warning');
    return;
  }

  const newSchedule = {
    title,
    type,
    priority,
    start_date,
    end_date,
    location,
    memo,
    created_at: new Date().toISOString()
  };

  try {
    if (AppState.isSupabaseConnected && AppState.supabase) {
      const { data, error } = await AppState.supabase
        .from('schedules')
        .insert([newSchedule])
        .select();

      if (error) throw error;
      showToast('새 일정이 등록되었습니다!', 'success');
    } else {
      newSchedule.id = 'local-sched-' + Date.now();
      AppState.schedules.push(newSchedule);
      SafeStorage.setItem('unit_local_schedules', JSON.stringify(AppState.schedules));
      showToast('새 일정이 저장되었습니다 (로컬)', 'success');
    }

    closeModal('addScheduleModal');
    const form = document.getElementById('scheduleForm');
    if (form) form.reset();

    await loadSchedules();
    renderSchedules();
    renderCalendar();
  } catch (err) {
    console.error('일정 등록 실패:', err);
    showToast('일정 등록 실패: ' + err.message, 'error');
  }
}

async function handleScheduleDelete(schedId) {
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;

  try {
    if (AppState.isSupabaseConnected && AppState.supabase) {
      const { error } = await AppState.supabase
        .from('schedules')
        .delete()
        .eq('id', schedId);

      if (error) throw error;
      showToast('일정이 삭제되었습니다.', 'info');
    } else {
      AppState.schedules = AppState.schedules.filter(s => s.id !== schedId);
      SafeStorage.setItem('unit_local_schedules', JSON.stringify(AppState.schedules));
      showToast('일정이 삭제되었습니다.', 'info');
    }

    await loadSchedules();
    renderSchedules();
    renderCalendar();
  } catch (err) {
    console.error('일정 삭제 에러:', err);
    showToast('삭제 실패: ' + err.message, 'error');
  }
}

// ==========================================
// 8. 필터, 캘린더, D-Day 제어
// ==========================================
function setScheduleFilter(filterType, element) {
  AppState.currentFilter = filterType;

  document.querySelectorAll('.filter-tabs .filter-btn').forEach(b => b.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  } else {
    const btn = document.querySelector(`.filter-tabs .filter-btn[data-filter="${filterType}"]`);
    if (btn) btn.classList.add('active');
  }

  renderSchedules();
}

function resetDateFilter() {
  AppState.selectedDate = null;
  renderCalendar();
  renderSchedules();
}

function changeMonth(delta) {
  AppState.calendarMonth += delta;
  if (AppState.calendarMonth < 0) {
    AppState.calendarMonth = 11;
    AppState.calendarYear--;
  } else if (AppState.calendarMonth > 11) {
    AppState.calendarMonth = 0;
    AppState.calendarYear++;
  }
  renderCalendar();
}

function goToday() {
  const now = new Date();
  AppState.calendarYear = now.getFullYear();
  AppState.calendarMonth = now.getMonth();
  AppState.selectedDate = null;
  renderCalendar();
  renderSchedules();
}

function selectCalendarDate(dateStr) {
  if (AppState.selectedDate === dateStr) {
    AppState.selectedDate = null;
  } else {
    AppState.selectedDate = dateStr;
  }
  renderCalendar();
  renderSchedules();
}

function selectEmoji(emoji, el) {
  AppState.selectedEmoji = emoji;
  document.querySelectorAll('#emojiSelector .emoji-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
}

function selectColor(color, el) {
  AppState.selectedColor = color;
  document.querySelectorAll('#colorSelector .color-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
}

async function refreshMemos() {
  const btn = document.getElementById('refreshMemosBtn');
  const icon = btn ? btn.querySelector('i') : null;
  if (icon) icon.classList.add('fa-spin');

  await loadMemos();
  renderMemos();

  if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 500);
  showToast('메모 목록을 새로고침했습니다.', 'info');
}

// ==========================================
// 9. UI 렌더링 함수들
// ==========================================
function renderSchedules() {
  const container = document.getElementById('scheduleList');
  if (!container) return;

  const countAll = document.getElementById('countAll');
  const countUnit = document.getElementById('countUnit');
  const countPersonal = document.getElementById('countPersonal');
  const countVacation = document.getElementById('countVacation');
  const countDuty = document.getElementById('countDuty');

  const allList = AppState.schedules;
  if (countAll) countAll.textContent = allList.length;
  if (countUnit) countUnit.textContent = allList.filter(s => s.type === 'unit').length;
  if (countPersonal) countPersonal.textContent = allList.filter(s => s.type === 'personal').length;
  if (countVacation) countVacation.textContent = allList.filter(s => s.type === 'vacation').length;
  if (countDuty) countDuty.textContent = allList.filter(s => s.type === 'duty').length;

  let filtered = allList;
  if (AppState.currentFilter !== 'all') {
    filtered = filtered.filter(s => s.type === AppState.currentFilter);
  }

  const resetBtn = document.getElementById('resetDateFilterBtn');
  const titleElem = document.getElementById('selectedDateTitle');

  if (AppState.selectedDate) {
    if (resetBtn) resetBtn.style.display = 'inline-block';
    if (titleElem) titleElem.textContent = `📌 ${AppState.selectedDate} 일정 보기`;
    filtered = filtered.filter(s => {
      if (!s.start_date) return false;
      if (s.start_date === AppState.selectedDate) return true;
      if (s.end_date && s.start_date <= AppState.selectedDate && AppState.selectedDate <= s.end_date) {
        return true;
      }
      return false;
    });
  } else {
    if (resetBtn) resetBtn.style.display = 'none';
    if (titleElem) titleElem.textContent = '📌 전체 등록 일정 목록';
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <i class="fa-regular fa-calendar-xmark" style="font-size: 32px; margin-bottom: 10px; display: block;"></i>
        해당하는 일정이 없습니다. [+ 새 일정 등록] 버튼을 눌러 추가해보세요!
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const typeLabel = {
      unit: '🛡️ 부대',
      personal: '👤 개인',
      vacation: '🏖️ 휴가/외출',
      duty: '⏰ 당직/근무'
    }[item.type] || '기타';

    const priorityBadge = item.priority === 'urgent'
      ? '<span class="priority-badge urgent">긴급</span>'
      : item.priority === 'important'
        ? '<span class="priority-badge important">중요</span>'
        : '';

    const dateStr = item.end_date && item.end_date !== item.start_date
      ? `${item.start_date} ~ ${item.end_date}`
      : item.start_date;

    return `
      <div class="schedule-card type-${item.type}">
        <div class="schedule-main">
          <div class="schedule-meta">
            <span class="tag-badge">${typeLabel}</span>
            ${priorityBadge}
          </div>
          <div class="schedule-item-title">${escapeHtml(item.title)}</div>
          <div class="schedule-item-details">
            <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
            ${item.location ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.location)}</span>` : ''}
          </div>
          ${item.memo ? `<div class="schedule-item-memo">${escapeHtml(item.memo)}</div>` : ''}
        </div>
        <button class="item-delete-btn" onclick="handleScheduleDelete('${item.id}')" title="삭제">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
    `;
  }).join('');
}

function renderMemos() {
  const grid = document.getElementById('memoGrid');
  const countElem = document.getElementById('memoCount');
  if (countElem) countElem.textContent = AppState.memos.length;
  if (!grid) return;

  if (AppState.memos.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px 10px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-md);">
        <i class="fa-regular fa-comments" style="font-size: 32px; margin-bottom: 10px; display: block;"></i>
        아직 등록된 공개 메모가 없습니다. 첫 응원의 한마디를 남겨보세요!
      </div>
    `;
    return;
  }

  grid.innerHTML = AppState.memos.map(m => {
    const timeAgo = formatTimeAgo(m.created_at);
    const colorClass = m.color ? `color-${m.color}` : 'color-yellow';

    return `
      <div class="memo-card ${colorClass}">
        <div>
          <div class="memo-card-top">
            <div class="memo-author-wrap">
              <span class="memo-emoji">${m.emoji || '💬'}</span>
              <span class="memo-author-name">${escapeHtml(m.author)}</span>
            </div>
            <span class="memo-tag-pill">${escapeHtml(m.category || '응원')}</span>
          </div>
          <div class="memo-card-body">${escapeHtml(m.content)}</div>
        </div>
        <div class="memo-card-footer">
          <span>${timeAgo}</span>
          <button class="memo-delete-action" onclick="handleMemoDelete('${m.id}')" title="메모 삭제">
            <i class="fa-regular fa-trash-can"></i> 삭제
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderCalendar() {
  const container = document.getElementById('calendarDays');
  const title = document.getElementById('calendarMonthYear');
  if (!container || !title) return;

  const year = AppState.calendarYear;
  const month = AppState.calendarMonth;

  title.textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();

  const todayStr = new Date().toISOString().split('T')[0];

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevLastDate - i;
    html += `<div class="cal-day-cell other-month">${d}</div>`;
  }

  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === AppState.selectedDate;

    const daySchedules = AppState.schedules.filter(s => {
      if (!s.start_date) return false;
      if (s.start_date === dateStr) return true;
      if (s.end_date && s.start_date <= dateStr && dateStr <= s.end_date) return true;
      return false;
    });

    let dotsHtml = '';
    if (daySchedules.length > 0) {
      dotsHtml = '<div class="cal-dot-container">';
      daySchedules.slice(0, 3).forEach(s => {
        dotsHtml += `<span class="cal-dot ${s.type}"></span>`;
      });
      dotsHtml += '</div>';
    }

    const classes = ['cal-day-cell'];
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');

    html += `
      <div class="${classes.join(' ')}" onclick="selectCalendarDate('${dateStr}')">
        <span>${d}</span>
        ${dotsHtml}
      </div>
    `;
  }

  container.innerHTML = html;
}

function updateDdayUI() {
  const cfg = AppState.ddayConfig;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1) 전역일
  const enlist = new Date(cfg.enlistDate);
  const discharge = new Date(cfg.dischargeDate);
  enlist.setHours(0, 0, 0, 0);
  discharge.setHours(0, 0, 0, 0);

  const totalServiceTime = discharge - enlist;
  const elapsedServiceTime = today - enlist;
  const remainingDays = Math.ceil((discharge - today) / (1000 * 60 * 60 * 24));

  let percent = 0;
  if (totalServiceTime > 0) {
    percent = Math.min(100, Math.max(0, (elapsedServiceTime / totalServiceTime) * 100));
  }

  const dDays = document.getElementById('dischargeDays');
  const dPercent = document.getElementById('dischargePercent');
  const dBar = document.getElementById('dischargeProgressBar');
  const dDates = document.getElementById('dischargeDates');

  if (dDays) dDays.textContent = remainingDays > 0 ? `D-${remainingDays}` : (remainingDays === 0 ? 'D-Day' : `D+${Math.abs(remainingDays)}`);
  if (dPercent) dPercent.textContent = percent.toFixed(1) + '%';
  if (dBar) dBar.style.width = percent + '%';
  if (dDates) dDates.textContent = `입대: ${cfg.enlistDate} ~ 전역: ${cfg.dischargeDate}`;

  // 2) 휴가
  if (cfg.vacationDate) {
    const vacDate = new Date(cfg.vacationDate);
    vacDate.setHours(0, 0, 0, 0);
    const vacDiff = Math.ceil((vacDate - today) / (1000 * 60 * 60 * 24));
    const vTitle = document.getElementById('vacationTitle');
    const vDays = document.getElementById('vacationDays');
    const vDates = document.getElementById('vacationDates');
    if (vTitle) vTitle.textContent = cfg.vacationTitle || '휴가 일정';
    if (vDays) vDays.textContent = vacDiff > 0 ? `D-${vacDiff}` : (vacDiff === 0 ? 'D-Day' : `종료`);
    if (vDates) vDates.textContent = `예정일: ${cfg.vacationDate}`;
  }

  // 3) 훈련
  if (cfg.trainingDate) {
    const trnDate = new Date(cfg.trainingDate);
    trnDate.setHours(0, 0, 0, 0);
    const trnDiff = Math.ceil((trnDate - today) / (1000 * 60 * 60 * 24));
    const tTitle = document.getElementById('trainingTitle');
    const tDays = document.getElementById('trainingDays');
    const tDates = document.getElementById('trainingDates');
    if (tTitle) tTitle.textContent = cfg.trainingTitle || '부대 훈련';
    if (tDays) tDays.textContent = trnDiff > 0 ? `D-${trnDiff}` : (trnDiff === 0 ? 'D-Day' : `완료`);
    if (tDates) tDates.textContent = `예정일: ${cfg.trainingDate}`;
  }
}

function loadDdayConfig() {
  const saved = SafeStorage.getItem('unit_dday_config');
  if (saved) {
    try {
      AppState.ddayConfig = { ...AppState.ddayConfig, ...JSON.parse(saved) };
    } catch (e) { }
  }
}

// ==========================================
// 10. Supabase 설정 및 D-Day 저장 핸들러
// ==========================================
async function handleSaveDbConfig() {
  const url = document.getElementById('cfgSupabaseUrl').value.trim();
  const key = document.getElementById('cfgSupabaseKey').value.trim();
  const resultDiv = document.getElementById('testConnResult');
  const saveBtn = document.getElementById('saveDbConfigBtn');

  if (!url || !key) {
    if (resultDiv) {
      resultDiv.className = 'test-conn-result error';
      resultDiv.textContent = 'URL과 API Key를 모두 입력해주세요.';
      resultDiv.style.display = 'block';
    }
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 접속 테스트 중...';
  }

  try {
    const client = window.supabase.createClient(url, key);
    const { error } = await client.from('memos').select('id').limit(1);

    if (error) {
      throw new Error(`연결 실패: ${error.message} (SQL 테이블을 먼저 생성했는지 확인하세요)`);
    }

    SafeStorage.setItem('unit_supabase_url', url);
    SafeStorage.setItem('unit_supabase_key', key);
    AppState.supabase = client;
    AppState.isSupabaseConnected = true;

    if (resultDiv) {
      resultDiv.className = 'test-conn-result success';
      resultDiv.innerHTML = '<i class="fa-solid fa-circle-check"></i> Supabase 연동 성공! 실시간 데이터베이스가 활성화됩니다.';
      resultDiv.style.display = 'block';
    }

    updateDbStatusUI(true);
    showToast('Supabase 실시간 연동 성공!', 'success');

    setTimeout(() => {
      closeModal('dbConfigModal');
      reloadAllData();
    }, 1200);

  } catch (err) {
    if (resultDiv) {
      resultDiv.className = 'test-conn-result error';
      resultDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message}`;
      resultDiv.style.display = 'block';
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-link"></i> 연동 테스트 및 저장';
    }
  }
}

function handleResetDbConfig() {
  if (confirm('Supabase 설정을 지우고 로컬 모드로 전환하시겠습니까?')) {
    SafeStorage.removeItem('unit_supabase_url');
    SafeStorage.removeItem('unit_supabase_key');
    AppState.supabase = null;
    AppState.isSupabaseConnected = false;
    updateDbStatusUI(false);
    closeModal('dbConfigModal');
    showToast('로컬 모드로 전환되었습니다.', 'info');
    reloadAllData();
  }
}

function handleSaveDdayConfig(e) {
  if (e && e.preventDefault) e.preventDefault();

  AppState.ddayConfig = {
    enlistDate: document.getElementById('cfgEnlistDate').value,
    dischargeDate: document.getElementById('cfgDischargeDate').value,
    vacationTitle: document.getElementById('cfgVacationTitle').value.trim() || '다음 정기 휴가',
    vacationDate: document.getElementById('cfgVacationDate').value,
    trainingTitle: document.getElementById('cfgTrainingTitle').value.trim() || '부대 주요 훈련',
    trainingDate: document.getElementById('cfgTrainingDate').value
  };

  SafeStorage.setItem('unit_dday_config', JSON.stringify(AppState.ddayConfig));
  updateDdayUI();
  closeModal('ddayConfigModal');
  showToast('D-Day 설정이 업데이트되었습니다.', 'success');
}

// ==========================================
// 11. 이벤트 리스너 보조 등록
// ==========================================
function setupEventListeners() {
  const memoTextarea = document.getElementById('memoContent');
  if (memoTextarea) {
    memoTextarea.addEventListener('input', (e) => {
      const charNum = document.getElementById('charNum');
      if (charNum) charNum.textContent = e.target.value.length;
    });
  }

  // 모달 바깥 어두운 배경 클릭 시 닫기
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
      }
    });
  });
}

// ==========================================
// 12. 유틸리티 함수들
// ==========================================
function initClock() {
  function tick() {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dayName = days[now.getDay()];
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    const clockElem = document.getElementById('liveClock');
    if (clockElem) {
      clockElem.textContent = `${y}.${m}.${d} (${dayName}) ${hh}:${mm}:${ss}`;
    }
  }
  tick();
  setInterval(tick, 1000);
}

function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}일 전`;

  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.25s ease reverse';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// ==========================================
// 13. 전역 window 스코프에 노출 (HTML onclick 100% 호환 보장)
// ==========================================
window.openModal = openModal;
window.closeModal = closeModal;
window.openAddScheduleModal = openAddScheduleModal;
window.openDbConfigModal = openDbConfigModal;
window.openDdayModal = openDdayModal;
window.setScheduleFilter = setScheduleFilter;
window.resetDateFilter = resetDateFilter;
window.changeMonth = changeMonth;
window.goToday = goToday;
window.selectCalendarDate = selectCalendarDate;
window.selectEmoji = selectEmoji;
window.selectColor = selectColor;
window.refreshMemos = refreshMemos;
window.handleMemoSubmit = handleMemoSubmit;
window.handleMemoDelete = handleMemoDelete;
window.handleScheduleSubmit = handleScheduleSubmit;
window.handleScheduleDelete = handleScheduleDelete;
window.handleSaveDbConfig = handleSaveDbConfig;
window.handleResetDbConfig = handleResetDbConfig;
window.handleSaveDdayConfig = handleSaveDdayConfig;
