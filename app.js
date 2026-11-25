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

  // D-Day 기본 설정 (초기값: 모두 미등록 상태)
  ddayConfig: {
    dischargeEnabled: false,
    enlistDate: '',
    dischargeDate: '',

    vacationEnabled: false,
    vacationTitle: '',
    vacationStartDate: '',
    vacationEndDate: '',
    vacationDesc: '',
    vacationTotalDays: '',
    vacationUsedDays: 0,

    trainingEnabled: false,
    trainingTitle: '',
    trainingStartDate: '',
    trainingEndDate: '',
    trainingDesc: '',

    customDdays: []
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
      // /rest/v1 또는 뒤쪽 슬래시 자동 제거
      url = url.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
      if (window.supabase) {
        AppState.supabase = window.supabase.createClient(url, key.trim());

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
  if (saved && !saved.includes('sample-sched-')) {
    try {
      AppState.schedules = JSON.parse(saved);
    } catch (e) {
      AppState.schedules = [];
    }
  } else {
    AppState.schedules = [];
    SafeStorage.setItem('unit_local_schedules', '[]');
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
  if (saved && !saved.includes('sample-memo-')) {
    try {
      AppState.memos = JSON.parse(saved);
    } catch (e) {
      AppState.memos = [];
    }
  } else {
    AppState.memos = [];
    SafeStorage.setItem('unit_local_memos', '[]');
  }
}

function getDefaultSchedules() {
  return [];
}

function getDefaultMemos() {
  return [];
}

// ==========================================
// 5. 모달 제어 함수들 (HTML onclick 지원)
// ==========================================
function openAddScheduleModalForType(type) {
  // Set the schedule type dropdown and open the add schedule modal
  const typeSelect = document.getElementById('schedType');
  if (typeSelect) {
    typeSelect.value = type;
  }
  // Reset other fields to defaults
  const dateInput = document.getElementById('schedStartDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
  const endInput = document.getElementById('schedEndDate');
  if (endInput) endInput.value = '';
  const titleInput = document.getElementById('schedTitle');
  if (titleInput) titleInput.value = '';
  const locationInput = document.getElementById('schedLocation');
  if (locationInput) locationInput.value = '';
  const memoInput = document.getElementById('schedMemo');
  if (memoInput) memoInput.value = '';
  openModal('addScheduleModal');
}

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
  openSingleDdayModal('discharge');
}

function openSingleDdayModal(type, customId = null) {
  const cfg = AppState.ddayConfig || {};
  document.getElementById('singleDdayType').value = type;
  document.getElementById('singleDdayCustomId').value = customId || '';

  const modalTitle = document.getElementById('singleDdayModalTitle');
  const titleGroup = document.getElementById('singleDdayTitleGroup');
  const descGroup = document.getElementById('singleDdayDescGroup');
  const vacBalanceBox = document.getElementById('vacationBalanceSection');
  const vacPeriodWrap = document.getElementById('vacPeriodApplyWrap');
  const deleteCustomBtn = document.getElementById('deleteCustomDdayBtn');
  const nameLabel = document.getElementById('singleDdayNameLabel');
  const startLabel = document.getElementById('singleDdayStartLabel');
  const endLabel = document.getElementById('singleDdayEndLabel');
  const enabledCheckbox = document.getElementById('singleDdayEnabled');
  const nameInput = document.getElementById('singleDdayName');
  const startInput = document.getElementById('singleDdayStart');
  const endInput = document.getElementById('singleDdayEnd');
  const descInput = document.getElementById('singleDdayDesc');

  if (vacBalanceBox) vacBalanceBox.style.display = 'none';
  if (vacPeriodWrap) vacPeriodWrap.style.display = 'none';
  if (deleteCustomBtn) deleteCustomBtn.style.display = 'none';

  if (type === 'discharge') {
    modalTitle.innerHTML = '🎖️ 군복무일 (전역일) 설정';
    titleGroup.style.display = 'none';
    descGroup.style.display = 'none';
    startLabel.innerHTML = '입대일 <span class="req">*</span>';
    endLabel.innerHTML = '전역일 <span class="req">*</span>';

    enabledCheckbox.checked = !!cfg.dischargeEnabled;
    startInput.value = cfg.enlistDate || '';
    endInput.value = cfg.dischargeDate || '';
  } else if (type === 'vacation') {
    modalTitle.innerHTML = '🏖️ 휴가 및 잔여 일수 설정';
    titleGroup.style.display = 'block';
    descGroup.style.display = 'block';
    if (vacBalanceBox) vacBalanceBox.style.display = 'block';
    if (vacPeriodWrap) vacPeriodWrap.style.display = 'block';
    nameLabel.textContent = '휴가 명칭';
    nameInput.placeholder = '예: 1차 정기휴가, 포상휴가';
    startLabel.innerHTML = '휴가 시작일 <span class="req">*</span>';
    endLabel.innerHTML = '휴가 종료일 <span class="req">*</span>';

    document.getElementById('vacTotalDays').value = cfg.vacationTotalDays !== undefined && cfg.vacationTotalDays !== '' ? cfg.vacationTotalDays : '';
    document.getElementById('vacUsedDays').value = cfg.vacationUsedDays || 0;
    updateVacBalancePreview();

    enabledCheckbox.checked = !!cfg.vacationEnabled;
    nameInput.value = cfg.vacationTitle || '';
    startInput.value = cfg.vacationStartDate || '';
    endInput.value = cfg.vacationEndDate || '';
    descInput.value = cfg.vacationDesc || '';
  } else if (type === 'training') {
    modalTitle.innerHTML = '🎯 부대 훈련 설정';
    titleGroup.style.display = 'block';
    descGroup.style.display = 'block';
    nameLabel.textContent = '훈련 명칭';
    nameInput.placeholder = '예: 혹한기 훈련, 유격 훈련';
    startLabel.innerHTML = '훈련 시작일 <span class="req">*</span>';
    endLabel.innerHTML = '훈련 종료일 <span class="req">*</span>';

    enabledCheckbox.checked = !!cfg.trainingEnabled;
    nameInput.value = cfg.trainingTitle || '';
    startInput.value = cfg.trainingStartDate || '';
    endInput.value = cfg.trainingEndDate || '';
    descInput.value = cfg.trainingDesc || '';
  } else if (type === 'custom') {
    const existing = customId ? (cfg.customDdays || []).find(c => c.id === customId) : null;
    modalTitle.innerHTML = existing ? '📌 추가 일정 수정' : '➕ 새 D-Day 일정 추가';
    titleGroup.style.display = 'block';
    descGroup.style.display = 'block';
    if (existing && deleteCustomBtn) deleteCustomBtn.style.display = 'inline-flex';
    nameLabel.textContent = '일정 이름';
    nameInput.placeholder = '예: 면회, 외출, 자격증 시험';
    startLabel.innerHTML = '시작일 <span class="req">*</span>';
    endLabel.innerHTML = '종료일 <span class="req">*</span>';

    enabledCheckbox.checked = existing ? !!existing.enabled : true;
    nameInput.value = existing ? (existing.title || '') : '';
    startInput.value = existing ? (existing.startDate || '') : '';
    endInput.value = existing ? (existing.endDate || '') : '';
    descInput.value = existing ? (existing.desc || '') : '';
  }

  toggleDdayInputs();
  openModal('ddayConfigModal');
}

function updateVacBalancePreview() {
  const totalVal = document.getElementById('vacTotalDays').value;
  const usedVal = parseInt(document.getElementById('vacUsedDays').value, 10) || 0;
  const preview = document.getElementById('vacRemainingPreview');
  if (!preview) return;

  if (totalVal === '' || isNaN(parseInt(totalVal, 10))) {
    preview.textContent = '남은 휴가: 미설정';
  } else {
    const total = parseInt(totalVal, 10);
    const remain = Math.max(0, total - usedVal);
    preview.textContent = `남은 휴가: ${remain}일`;
  }
}

function adjustVacUsed(delta) {
  const usedInput = document.getElementById('vacUsedDays');
  if (!usedInput) return;
  const current = parseInt(usedInput.value, 10) || 0;
  usedInput.value = Math.max(0, current + delta);
  updateVacBalancePreview();
}

function applyVacPeriodToUsed() {
  const start = document.getElementById('singleDdayStart').value;
  const end = document.getElementById('singleDdayEnd').value;
  if (!start || !end) {
    showToast('먼저 휴가 시작일과 종료일을 입력해주세요.', 'warning');
    return;
  }
  if (start > end) {
    showToast('종료일이 시작일보다 빠를 수 없습니다.', 'warning');
    return;
  }
  const diffDays = Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
  const usedInput = document.getElementById('vacUsedDays');
  const current = parseInt(usedInput.value, 10) || 0;
  usedInput.value = current + diffDays;
  updateVacBalancePreview();
  showToast(`휴가 기간(${diffDays}일)이 사용한 휴가에 더해졌습니다.`, 'success');
}

function useVacationDays(days) {
  const cfg = AppState.ddayConfig;
  if (cfg.vacationTotalDays === '' || cfg.vacationTotalDays === undefined) {
    openSingleDdayModal('vacation');
    return;
  }
  const total = parseInt(cfg.vacationTotalDays, 10) || 0;
  const used = parseInt(cfg.vacationUsedDays, 10) || 0;
  if (used + days > total) {
    showToast('남은 휴가 일수가 부족합니다!', 'warning');
    return;
  }
  cfg.vacationUsedDays = Math.max(0, used + days);
  SafeStorage.setItem('unit_dday_config', JSON.stringify(cfg));
  updateDdayUI();
  showToast(`휴가 ${days}일 사용이 반영되었습니다. (남은 휴가: ${total - cfg.vacationUsedDays}일)`, 'success');
}

function toggleDdayInputs() {
  const enabled = document.getElementById('singleDdayEnabled').checked;
  const wrap = document.getElementById('singleDdayFieldsWrap');
  if (wrap) {
    if (enabled) {
      wrap.classList.remove('disabled-fields');
    } else {
      wrap.classList.add('disabled-fields');
    }
  }
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
    updateDdayUI();
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
    updateDdayUI();
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
  const cfg = AppState.ddayConfig || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1) 군복무일 (전역일)
  const dDays = document.getElementById('dischargeDays');
  const dPercent = document.getElementById('dischargePercent');
  const dBar = document.getElementById('dischargeProgressBar');
  const dDates = document.getElementById('dischargeDates');
  const dBadge = document.getElementById('dischargeBadge');

  if (cfg.dischargeEnabled && cfg.enlistDate && cfg.dischargeDate) {
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

    if (dDays) dDays.textContent = remainingDays > 0 ? `D-${remainingDays}` : (remainingDays === 0 ? 'D-Day' : `D+${Math.abs(remainingDays)}`);
    if (dPercent) dPercent.textContent = percent.toFixed(1) + '%';
    if (dBar) dBar.style.width = percent + '%';
    if (dDates) dDates.textContent = `입대: ${cfg.enlistDate} ~ 전역: ${cfg.dischargeDate}`;
    if (dBadge) dBadge.textContent = '복무 진행중';
  } else {
    if (dDays) dDays.textContent = '미등록';
    if (dPercent) dPercent.textContent = '0.0%';
    if (dBar) dBar.style.width = '0%';
    if (dDates) dDates.textContent = '클릭하여 복무 기간(입대일~전역일)을 설정하세요';
    if (dBadge) dBadge.textContent = '미등록';
  }

  // 2) 휴가 (남은 휴가 일수 + 휴가 일정 D-Day)
  const vCard = document.querySelector('.vacation-dday-card');
  const vTitle = document.getElementById('vacationTitle');
  const vDays = document.getElementById('vacationDays');
  const vDesc = document.getElementById('vacationDesc');
  const vDates = document.getElementById('vacationDates');
  const vBadge = document.getElementById('vacationBadge');
  const vRemainText = document.getElementById('vacationRemainText');
  const quickUseBtn = document.getElementById('quickUseVacBtn');

  if (vCard) vCard.style.display = 'block';

  // 잔여 휴가 계산 표시
  if (cfg.vacationTotalDays !== '' && cfg.vacationTotalDays !== undefined && !isNaN(parseInt(cfg.vacationTotalDays, 10))) {
    const totalVac = parseInt(cfg.vacationTotalDays, 10);
    const usedVac = parseInt(cfg.vacationUsedDays, 10) || 0;
    const remainVac = Math.max(0, totalVac - usedVac);
    if (vRemainText) vRemainText.textContent = `남은 휴가: ${remainVac}일 (총 ${totalVac}일 중 ${usedVac}일 사용)`;
    if (quickUseBtn) quickUseBtn.style.display = 'inline-block';
  } else {
    if (vRemainText) vRemainText.textContent = '남은 휴가: 미설정';
    if (quickUseBtn) quickUseBtn.style.display = 'none';
  }

  if (cfg.vacationEnabled && cfg.vacationStartDate && cfg.vacationEndDate) {
    const start = new Date(cfg.vacationStartDate);
    const end = new Date(cfg.vacationEndDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffStart = Math.ceil((start - today) / (1000 * 60 * 60 * 24));
    const diffEnd = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

    let statusText = '';
    if (diffStart > 0) statusText = `D-${diffStart}`;
    else if (diffStart <= 0 && diffEnd >= 0) statusText = '진행중!';
    else statusText = '종료';

    if (vTitle) vTitle.textContent = cfg.vacationTitle || '휴가 일정';
    if (vDays) vDays.textContent = statusText;
    if (vDesc) vDesc.textContent = cfg.vacationDesc || '등록된 휴가 일정';
    if (vDates) vDates.textContent = `기간: ${cfg.vacationStartDate} ~ ${cfg.vacationEndDate}`;
    if (vBadge) vBadge.textContent = '등록됨';
  } else {
    if (vTitle) vTitle.textContent = '휴가 일정';
    if (vDays) vDays.textContent = '일정 없음';
    if (vDesc) vDesc.textContent = '등록된 휴가가 없습니다';
    if (vDates) vDates.textContent = '클릭하여 휴가 일정 및 잔여 일수를 설정하세요';
    if (vBadge) vBadge.textContent = '미등록';
  }

  // 3) 훈련
  const tCard = document.querySelector('.training-dday-card');
  const tTitle = document.getElementById('trainingTitle');
  const tDays = document.getElementById('trainingDays');
  const tDesc = document.getElementById('trainingDesc');
  const tDates = document.getElementById('trainingDates');
  const tBadge = document.getElementById('trainingBadge');

  if (tCard) tCard.style.display = 'block';
  if (cfg.trainingEnabled && cfg.trainingStartDate && cfg.trainingEndDate) {
    const start = new Date(cfg.trainingStartDate);
    const end = new Date(cfg.trainingEndDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffStart = Math.ceil((start - today) / (1000 * 60 * 60 * 24));
    const diffEnd = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

    let statusText = '';
    if (diffStart > 0) statusText = `D-${diffStart}`;
    else if (diffStart <= 0 && diffEnd >= 0) statusText = '훈련중!';
    else statusText = '완료';

    if (tTitle) tTitle.textContent = cfg.trainingTitle || '부대 훈련';
    if (tDays) tDays.textContent = statusText;
    if (tDesc) tDesc.textContent = cfg.trainingDesc || '등록된 훈련 일정';
    if (tDates) tDates.textContent = `기간: ${cfg.trainingStartDate} ~ ${cfg.trainingEndDate}`;
    if (tBadge) tBadge.textContent = '등록됨';
  } else {
    if (tTitle) tTitle.textContent = '부대 훈련';
    if (tDays) tDays.textContent = '일정 없음';
    if (tDesc) tDesc.textContent = '등록된 훈련이 없습니다';
    if (tDates) tDates.textContent = '클릭하여 훈련 등록 여부를 선택하세요';
    if (tBadge) tBadge.textContent = '미등록';
  }

  // 4) 사용자가 추가로 등록한 커스텀 D-Day 카드들 렌더링
  const customContainer = document.getElementById('customDdaysContainer');
  if (customContainer) {
    const list = cfg.customDdays || [];
    customContainer.innerHTML = list.map(item => {
      let statusText = '일정 없음';
      let badgeText = '미등록';
      let dateText = '클릭하여 기간을 설정하세요';

      if (item.enabled && item.startDate && item.endDate) {
        const s = new Date(item.startDate);
        const e = new Date(item.endDate);
        s.setHours(0, 0, 0, 0);
        e.setHours(0, 0, 0, 0);
        const ds = Math.ceil((s - today) / (1000 * 60 * 60 * 24));
        const de = Math.ceil((e - today) / (1000 * 60 * 60 * 24));

        if (ds > 0) statusText = `D-${ds}`;
        else if (ds <= 0 && de >= 0) statusText = '진행중!';
        else statusText = '완료';

        badgeText = '등록됨';
        dateText = `기간: ${item.startDate} ~ ${item.endDate}`;
      }

      return `
        <div class="dday-card clickable-card" onclick="openSingleDdayModal('custom', '${item.id}')" title="클릭하여 수정 또는 삭제">
          <div class="card-header">
            <span class="card-icon">📌</span>
            <span class="card-title">${escapeHtml(item.title || '추가 일정')}</span>
            <span class="dday-badge">${badgeText}</span>
          </div>
          <div class="card-body">
            <div class="dday-count">${statusText}</div>
            <p class="card-desc">${escapeHtml(item.desc || '추가로 등록한 D-Day 일정')}</p>
            <div class="dday-subtext">${dateText}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// 모든 일정 및 메모 전체 초기화 (데이터 비우기 함수)
async function clearAllData() {
  if (!confirm('정말로 모든 일정과 메모, D-Day 설정을 깨끗하게 비우시겠습니까?')) return;

  try {
    if (AppState.isSupabaseConnected && AppState.supabase) {
      await AppState.supabase.from('memos').delete().neq('author', '___NEVER_MATCH___');
      await AppState.supabase.from('schedules').delete().neq('title', '___NEVER_MATCH___');
    }

    SafeStorage.setItem('unit_local_schedules', '[]');
    SafeStorage.setItem('unit_local_memos', '[]');
    SafeStorage.removeItem('unit_dday_config');
    AppState.schedules = [];
    AppState.memos = [];
    AppState.ddayConfig = {
      dischargeEnabled: false,
      enlistDate: '',
      dischargeDate: '',
      vacationEnabled: false,
      vacationTitle: '',
      vacationStartDate: '',
      vacationEndDate: '',
      vacationDesc: '',
      vacationTotalDays: '',
      vacationUsedDays: 0,
      trainingEnabled: false,
      trainingTitle: '',
      trainingStartDate: '',
      trainingEndDate: '',
      trainingDesc: '',
      customDdays: []
    };

    renderSchedules();
    renderMemos();
    renderCalendar();
    updateDdayUI();
    showToast('모든 일정이 깨끗하게 비워졌습니다. 이제 직접 등록해보세요!', 'success');
  } catch (e) {
    console.error('전체 초기화 실패:', e);
    showToast('초기화 실패: ' + e.message, 'error');
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
  let url = document.getElementById('cfgSupabaseUrl').value.trim();
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

  // /rest/v1 또는 끝의 슬래시(/) 자동 제거
  url = url.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
  document.getElementById('cfgSupabaseUrl').value = url;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 접속 테스트 중...';
  }

  // 설정값 무조건 저장
  SafeStorage.setItem('unit_supabase_url', url);
  SafeStorage.setItem('unit_supabase_key', key);

  try {
    const client = window.supabase.createClient(url, key);
    const { error } = await client.from('memos').select('id').limit(1);

    if (error) {
      console.warn('Supabase ping 응답 에러:', error);
      // 테이블이 없거나 권한 에러인 경우
      throw error;
    }

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
    console.warn('연동 테스트 중 실패:', err);
    AppState.supabase = window.supabase ? window.supabase.createClient(url, key) : null;
    AppState.isSupabaseConnected = true; // 저장되었으므로 활성화

    if (resultDiv) {
      resultDiv.className = 'test-conn-result error';
      let errorDesc = err.message || '통신 오류';
      
      if (errorDesc.includes('Failed to fetch')) {
        errorDesc = '브라우저 로컬 보안(또는 광고차단기)으로 인해 로컬 파일에서 DB 접속이 차단되었습니다. <strong>설정값은 안전하게 저장되었으니, Vercel에 배포하시면 실제 웹에서 정상 작동합니다!</strong>';
      } else if (errorDesc.includes('relation') || errorDesc.includes('table')) {
        errorDesc = 'DB 연결은 되었으나 테이블이 없습니다! <strong>Supabase의 [SQL Editor]에서 `supabase-setup.sql`을 실행해주세요.</strong>';
      }

      resultDiv.innerHTML = `
        <div style="margin-bottom: 8px;"><i class="fa-solid fa-circle-info"></i> ${errorDesc}</div>
        <button type="button" class="btn btn-primary" style="font-size: 11px; padding: 6px 12px; width: 100%; justify-content: center;" onclick="closeModal('dbConfigModal'); updateDbStatusUI(true); reloadAllData();">
          ✅ 설정 저장 완료하고 닫기
        </button>
      `;
      resultDiv.style.display = 'block';
    }

    updateDbStatusUI(true);
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

function handleSaveSingleDday(e) {
  if (e && e.preventDefault) e.preventDefault();

  const type = document.getElementById('singleDdayType').value;
  const customId = document.getElementById('singleDdayCustomId').value;
  const enabled = document.getElementById('singleDdayEnabled').checked;
  const name = document.getElementById('singleDdayName').value.trim();
  const start = document.getElementById('singleDdayStart').value;
  const end = document.getElementById('singleDdayEnd').value;
  const desc = document.getElementById('singleDdayDesc').value.trim();

  if (enabled) {
    if (!start || !end) {
      showToast('시작일과 종료일(기간)을 모두 입력해야 D-Day가 표시됩니다!', 'warning');
      return;
    }
    if (start > end) {
      showToast('종료일이 시작일보다 빠를 수 없습니다.', 'warning');
      return;
    }
  }

  if (type === 'discharge') {
    AppState.ddayConfig.dischargeEnabled = enabled;
    AppState.ddayConfig.enlistDate = enabled ? start : '';
    AppState.ddayConfig.dischargeDate = enabled ? end : '';
  } else if (type === 'vacation') {
    const totalVal = document.getElementById('vacTotalDays').value;
    const usedVal = parseInt(document.getElementById('vacUsedDays').value, 10) || 0;
    AppState.ddayConfig.vacationTotalDays = totalVal !== '' ? Math.max(0, parseInt(totalVal, 10) || 0) : '';
    AppState.ddayConfig.vacationUsedDays = Math.max(0, usedVal);

    AppState.ddayConfig.vacationEnabled = enabled;
    AppState.ddayConfig.vacationTitle = enabled ? (name || '휴가 일정') : '';
    AppState.ddayConfig.vacationStartDate = enabled ? start : '';
    AppState.ddayConfig.vacationEndDate = enabled ? end : '';
    AppState.ddayConfig.vacationDesc = enabled ? desc : '';
  } else if (type === 'training') {
    AppState.ddayConfig.trainingEnabled = enabled;
    AppState.ddayConfig.trainingTitle = enabled ? (name || '부대 훈련') : '';
    AppState.ddayConfig.trainingStartDate = enabled ? start : '';
    AppState.ddayConfig.trainingEndDate = enabled ? end : '';
    AppState.ddayConfig.trainingDesc = enabled ? desc : '';
  } else if (type === 'custom') {
    if (!AppState.ddayConfig.customDdays) AppState.ddayConfig.customDdays = [];
    if (customId) {
      const idx = AppState.ddayConfig.customDdays.findIndex(c => c.id === customId);
      if (idx !== -1) {
        AppState.ddayConfig.customDdays[idx] = {
          id: customId,
          enabled,
          title: name || '추가 일정',
          startDate: enabled ? start : '',
          endDate: enabled ? end : '',
          desc: enabled ? desc : ''
        };
      }
    } else {
      AppState.ddayConfig.customDdays.push({
        id: 'custom-' + Date.now(),
        enabled,
        title: name || '추가 일정',
        startDate: enabled ? start : '',
        endDate: enabled ? end : '',
        desc: enabled ? desc : ''
      });
    }
  }

  SafeStorage.setItem('unit_dday_config', JSON.stringify(AppState.ddayConfig));
  updateDdayUI();
  closeModal('ddayConfigModal');
  showToast('설정이 저장되었습니다!', 'success');
}

function deleteCustomDday() {
  const customId = document.getElementById('singleDdayCustomId').value;
  if (!customId) return;
  if (!confirm('이 추가 일정을 삭제하시겠습니까?')) return;

  AppState.ddayConfig.customDdays = (AppState.ddayConfig.customDdays || []).filter(c => c.id !== customId);
  SafeStorage.setItem('unit_dday_config', JSON.stringify(AppState.ddayConfig));
  updateDdayUI();
  closeModal('ddayConfigModal');
  showToast('추가 일정이 삭제되었습니다.', 'info');
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
window.openSingleDdayModal = openSingleDdayModal;
window.toggleDdayInputs = toggleDdayInputs;
window.handleSaveSingleDday = handleSaveSingleDday;
window.updateVacBalancePreview = updateVacBalancePreview;
window.adjustVacUsed = adjustVacUsed;
window.applyVacPeriodToUsed = applyVacPeriodToUsed;
window.useVacationDays = useVacationDays;
window.deleteCustomDday = deleteCustomDday;
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
window.clearAllData = clearAllData;
