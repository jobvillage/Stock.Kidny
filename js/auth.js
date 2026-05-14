// =====================
// AUTH / PERMISSIONS
// =====================
const AUTH_SESSION_KEY = 'stock_app_session_v1';

let currentUser = null;

const ROLE_PERMISSIONS = {
  stock_receiver: ['in', 'pending', 'po_status', 'stock'],
  center_staff: ['out', 'request_status', 'transfer', 'po_status'],
  committee: ['stock'],
  admin: ['in', 'pending', 'po_status', 'stock', 'committee'],
};

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function normalizeUser(user) {
  return {
    code: user.code || '',
    name: user.name || '',
    role: user.role || '',
    center: user.center || '',
    permissions: user.permissions || getPermissionsForRole(user.role),
  };
}

function userCan(permission) {
  return currentUser?.permissions?.includes(permission);
}

const ROLE_LABELS = {
  stock_receiver: 'รับสินค้าเข้าเท่านั้น',
  center_staff: 'เจ้าหน้าที่ประจำศูนย์',
};

async function login() {
  const codeInput = document.getElementById('login-code');
  const passwordInput = document.getElementById('login-password');

  const staffCode = String(codeInput?.value || '').trim().toLowerCase();
  const password = String(passwordInput?.value || '').trim();

  if (!staffCode || !password) {
    showToast('⚠️ กรุณากรอกรหัสเจ้าหน้าที่และรหัสผ่าน', 'error');
    return;
  }

  showToast('', 'loading', 'กำลังเข้าสู่ระบบ...');

  try {
    const { data, error } = await supabaseClient.rpc('login_staff', {
      p_user_code: staffCode,
      p_password: password,
    });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      showToast('❌ รหัสเจ้าหน้าที่หรือรหัสผ่านไม่ถูกต้อง', 'error');

      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }

      return;
    }

    const user = data[0];

    currentUser = normalizeUser({
      code: user.user_code,
      name: user.staff_name,
      role: user.role,
      center: user.center || '',
    });

    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(currentUser));

    showToast('✅ เข้าสู่ระบบสำเร็จ', 'success');

    applyLoginState();
    if (typeof startRealtime === 'function') {
      startRealtime();
    }

  } catch (error) {
    console.error('Supabase login error:', error);
    showToast(`❌ ${error.message || 'เชื่อมต่อระบบ Login ไม่สำเร็จ'}`, 'error');
  }
}

async function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  currentUser = null;
  location.reload();
  if (typeof stopRealtime === 'function') {
    stopRealtime();
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const button = document.getElementById('toggle-password');
  if (!input || !button) return;

  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  button.textContent = willShow ? 'ซ่อน' : 'แสดง';
  button.setAttribute('aria-label', willShow ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
}

function restoreSession() {
  const savedUser = localStorage.getItem(AUTH_SESSION_KEY);

  if (!savedUser) {
    showLoginScreen();
    return;
  }

  try {
    currentUser = normalizeUser(JSON.parse(savedUser));
    applyLoginState();
  } catch (error) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    currentUser = null;
    showLoginScreen();
  }
}

function showLoginScreen() {
  const loginScreen = document.getElementById('login-screen');
  const appShell = document.getElementById('app-shell');

  if (loginScreen) loginScreen.hidden = false;
  if (appShell) appShell.hidden = true;
}

function applyRolePageLabels() {
  const transferTabText = document.querySelector('#tab-transfer span:last-child');
  const transferTitle = document.querySelector('#panel-transfer h2');
  const transferDesc = document.querySelector('#panel-transfer .panel-title p');

  if (currentUser?.role === 'center_staff') {
    if (transferTabText) transferTabText.textContent = 'เปิด PO';
    if (transferTitle) transferTitle.textContent = 'เปิด PO';
    if (transferDesc) transferDesc.textContent = 'เปิด PO / คำขอ PO เพื่อส่งรายการให้ผู้จัดของ';

    if (typeof modeLabels !== 'undefined') {
      modeLabels.transfer = 'เปิด PO';
    }

    renderPoCmoForm();
    return;
  }

  if (transferTabText) transferTabText.textContent = 'Hub Stock';
  if (transferTitle) transferTitle.textContent = 'Hub Stock';
  if (transferDesc) transferDesc.textContent = 'จัดการสต็อกสำหรับ Hub Admin';

  if (typeof modeLabels !== 'undefined') {
    modeLabels.transfer = 'Hub Stock';
  }
}

function applyLoginState() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;

  const centerText = currentUser.center ? ` • ${currentUser.center}` : '';
  document.getElementById('current-user-name').textContent = `${currentUser.code} - ${currentUser.name}`;
  document.getElementById('current-user-role').textContent = `${ROLE_LABELS[currentUser.role] || currentUser.role}${centerText}`;

  setPersonFieldsFromUser();
  applyRolePageLabels();
  applyPermissionUI();

  // โหลดจาก cache ก่อน เพื่อให้หน้าเว็บแสดงผลเร็ว
  loadStockCache();

  // แล้วค่อยโหลดข้อมูลจริงจาก Apps Script ทับ
  fetchStock();
  
  if (canAccessTab('request_status') && typeof fetchRequestStatus === 'function') {
    fetchRequestStatus();
  }
  if (canAccessTab('pending')) fetchPendingTransfers();
  if (canAccessTab('po_status') && typeof fetchPoStatus === 'function') {
    fetchPoStatus();
  }
}

function setPersonFieldsFromUser() {
  const displayName = `${currentUser.name} (${currentUser.code})`;

  // รับเข้า: ให้พิมพ์ชื่อผู้รับเข้าเอง
  const inPerson = document.getElementById('in-person');
  if (inPerson) {
    inPerson.value = '';
    inPerson.placeholder = 'กรอกชื่อผู้รับสินค้า';
    inPerson.disabled = false;
    inPerson.readOnly = false;
  }

  // เบิกออก / Transfer: ใช้ชื่อคนที่ Login อัตโนมัติ
  ['out-person', 'transfer-person'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = displayName;
  });
}

function canAccessTab(tab) {
  return Boolean(currentUser?.permissions?.includes(tab));
}

function requirePermission(tab) {
  if (canAccessTab(tab)) return true;
  showToast('⛔ รหัสนี้ไม่มีสิทธิ์ใช้งานเมนูนี้', 'error');
  return false;
}

function applyPermissionUI() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const allowed = canAccessTab(button.dataset.tab);
    button.hidden = !allowed;
    button.disabled = !allowed;
    button.classList.toggle('is-disabled', !allowed);
  });

  const firstAllowedTab = currentUser.permissions[0] || 'in';
  switchTab(firstAllowedTab, true);

  if (currentUser.role === 'center_staff') {
    lockSelectToValue('out-center', currentUser.center);
    lockSelectToValue('transfer-from-center', currentUser.center);
    filterTransferTargetCenters();
  } else {
    unlockSelect('out-center');
    unlockSelect('transfer-from-center');
  }
}

function lockSelectToValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.disabled = true;
  el.classList.add('is-locked');
}

function unlockSelect(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = false;
  el.classList.remove('is-locked');
}

function filterTransferTargetCenters() {
  const fromCenter = document.getElementById('transfer-from-center')?.value;
  const toSelect = document.getElementById('transfer-to-center');
  if (!toSelect) return;

  Array.from(toSelect.options).forEach((option) => {
    option.hidden = Boolean(option.value && option.value === fromCenter);
  });

  if (toSelect.value && toSelect.value === fromCenter) {
    toSelect.value = '';
  }
}

function enforceOwnCenter(type, center) {
  if (currentUser.role !== 'center_staff') return true;
  if (center === currentUser.center) return true;

  showToast(`⛔ ${currentUser.code} ทำรายการได้เฉพาะศูนย์ ${currentUser.center}`, 'error');
  return false;
}
