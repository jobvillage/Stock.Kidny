// =====================
// AUTH / PERMISSIONS
// =====================
const AUTH_SESSION_KEY = 'stock_app_session_v1';

let currentUser = null;

const ROLE_PERMISSIONS = {
  stock_receiver: ['in', 'pending', 'po_status', 'stock'],
  center_staff: ['out', 'request_status', 'transfer', 'po_status', 'stock', 'withdraw_summary'],
  committee: ['stock'],

  admin: ['in', 'pending', 'transfer', 'po_status', 'stock', 'withdraw_summary', 'committee'],
  adminR: ['in', 'pending', 'transfer', 'po_status', 'stock', 'withdraw_summary'],

  pr_approver: ['pr_approval'],
  pr_po_manager: ['pr_approved', 'pr_open_po', 'stock', 'pr_add_data', 'pr_export_data'],
};

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function normalizeUser(user) {
  const role = user.role || '';

  return {
    code: user.code || '',
    name: user.name || '',
    role,
    center: user.center || '',
    permissions: getPermissionsForRole(role),
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

    if (typeof window.startRequestNotificationPolling === 'function') {
      window.startRequestNotificationPolling();
    }

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
  stopAutoRefresh();
  localStorage.removeItem(AUTH_SESSION_KEY);
  currentUser = null;
  location.reload();
  if (typeof stopRealtime === 'function') {
    stopRealtime();
  }
  
  if (typeof window.stopRequestNotificationPolling === 'function') {
    window.stopRequestNotificationPolling();
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

    // เริ่มเช็กแจ้งเตือนหลัง restore login สำเร็จ
    if (typeof window.startRequestNotificationPolling === 'function') {
      window.startRequestNotificationPolling();
    }

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
  if (typeof setupPrPoWorkspaceForSpecialUsers === 'function' && setupPrPoWorkspaceForSpecialUsers()) {
    return;
  }

  const inTabIcon = document.querySelector('#tab-in .segment-icon');
  const inTabText = document.querySelector('#tab-in span:last-child');
  const transferTabText = document.querySelector('#tab-transfer span:last-child');
  const transferTitle = document.querySelector('#panel-transfer h2');
  const transferDesc = document.querySelector('#panel-transfer .panel-title p');

  if (['admin', 'adminR'].includes(currentUser?.role)) {
    if (inTabIcon) inTabIcon.textContent = '🔁';
    if (inTabText) inTabText.textContent = 'Transfer';

    if (typeof modeLabels !== 'undefined') {
      modeLabels.in = 'Transfer';
    }

    if (typeof renderAdminTransferForm === 'function') {
      renderAdminTransferForm();
    }
  } else {
    if (inTabIcon) inTabIcon.textContent = '📥';
    if (inTabText) inTabText.textContent = 'รับเข้า';

    if (typeof modeLabels !== 'undefined') {
      modeLabels.in = 'รับสินค้าเข้า';
    }
  }

  if (['center_staff', 'admin', 'adminR'].includes(currentUser?.role)) {
    if (transferTabText) transferTabText.textContent = 'เปิด PR';
    if (transferTitle) transferTitle.textContent = 'เปิด PR';
    if (transferDesc) transferDesc.textContent = 'เปิด PR / คำขอ PO เพื่อส่งรายการให้ผู้จัดของ';

    if (typeof modeLabels !== 'undefined') {
      modeLabels.transfer = 'เปิด PR';
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

  // ใบขอเบิก: ให้กรอกชื่อผู้เบิกใช้ทุกครั้ง
  const outPerson = document.getElementById('out-person');
  if (outPerson) {
    outPerson.value = '';
    outPerson.placeholder = 'กรอกชื่อผู้เบิกใช้';
    outPerson.disabled = false;
    outPerson.readOnly = false;
  }

  // Transfer เดิม: คงไว้ ไม่แตะ PO
  const transferPerson = document.getElementById('transfer-person');
  if (transferPerson) {
    transferPerson.value = displayName;
  }
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

  applyRoleTabOrder();

  const tabBox = document.querySelector('.segment')?.parentElement;

  if (tabBox) {
    const visibleTabs = Array.from(tabBox.querySelectorAll('.segment'))
      .filter((btn) => !btn.hidden);

    tabBox.classList.toggle('tab-grid-five', visibleTabs.length === 5);

    visibleTabs.forEach((btn) => {
      btn.classList.remove('is-last-single');
    });

    if (visibleTabs.length === 5) {
      visibleTabs[4].classList.add('is-last-single');
    }
  }

  if (currentUser.role === 'center_staff') {
    lockSelectToValue('out-center', currentUser.center);
    lockSelectToValue('withdraw-summary-center', currentUser.center);
    lockSelectToValue('transfer-from-center', currentUser.center);
    unlockSelect('stock-center-filter');
    setStockCenterDefaultToOwnCenter();
    setStaffRequestHistoryDefaultToOwnCenter();
    filterTransferTargetCenters();
  } else {
    unlockSelect('out-center');
    unlockSelect('withdraw-summary-center');
    unlockSelect('transfer-from-center');
    unlockSelect('transfer-to-center');
    unlockSelect('stock-center-filter');
    filterTransferTargetCenters();
  }

  const firstAllowedTab = currentUser.permissions[0] || 'in';
  switchTab(firstAllowedTab, true);
}

function applyRoleTabOrder() {
  const orderByRole = {
    center_staff: ['out', 'request_status', 'transfer', 'po_status', 'stock', 'withdraw_summary'],
    admin: ['in', 'pending', 'transfer', 'po_status', 'stock', 'withdraw_summary', 'committee'],
    adminR: ['in', 'pending', 'transfer', 'po_status', 'stock', 'withdraw_summary'],
    stock_receiver: ['in', 'pending', 'po_status', 'stock'],
  };
  const order = orderByRole[currentUser?.role] || currentUser?.permissions || [];

  document.querySelectorAll('[data-tab]').forEach((button) => {
    const index = order.indexOf(button.dataset.tab);
    button.style.order = index >= 0 ? String(index + 1) : '';
  });
}

function setStockCenterDefaultToOwnCenter() {
  const select = document.getElementById('stock-center-filter');
  if (!select || !currentUser?.center) return;

  select.value = currentUser.center;
}

function setStaffRequestHistoryDefaultToOwnCenter() {
  const select = document.getElementById('staff-request-history-center');
  if (!select || !currentUser?.center) return;

  select.value = currentUser.center;
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
    option.hidden = false;
  });
}

function enforceOwnCenter(type, center) {
  if (currentUser.role !== 'center_staff') return true;
  if (center === currentUser.center) return true;

  showToast(`⛔ ${currentUser.code} ทำรายการได้เฉพาะศูนย์ ${currentUser.center}`, 'error');
  return false;
}
