// =====================
// CONFIG — ฝังหลังบ้าน
// =====================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw8Z3jtbpRZB5ZslPK2u_Cdtcw_hiVVP9Gg6xOHnkSgBbT2xhrEikOid5cLcdcPdG5a/exec';
const SESSION_KEY = 'stockAppSessionV2';

const CENTERS = ['ไตบน', 'ไตล่าง', 'ไตดี'];

const PRODUCTS = [
  'K3 Ca 3.5',
  'K3 Ca 2.5',
  'K2 Ca 2.5',
  'Hemo B',
  'NSS',
  'น้ำยา On-line',
  'Citrosteri',
];

// แก้ mapping staff ได้ตรงนี้
// staff1 รับสินค้าเข้าได้อย่างเดียว
// staff2+ เบิก / transfer / รับ transfer ได้เฉพาะศูนย์ตัวเอง
// หมายเหตุ: ถ้าใช้จริงควรย้าย password ไปตรวจใน Google Apps Script / Sheet ไม่ควรฝังในหน้าเว็บระยะยาว
const STAFF_ACCOUNTS = {
  staff1: {
    code: 'staff1',
    password: '1111',
    name: 'Staff 1',
    role: 'stock_receiver',
    center: '',
    permissions: ['in'],
  },
  staff2: {
    code: 'staff2',
    password: '2222',
    name: 'Staff 2',
    role: 'center_staff',
    center: 'ไตบน',
    permissions: ['out', 'transfer', 'pending'],
  },
  staff3: {
    code: 'staff3',
    password: '3333',
    name: 'Staff 3',
    role: 'center_staff',
    center: 'ไตล่าง',
    permissions: ['out', 'transfer', 'pending'],
  },
  staff4: {
    code: 'staff4',
    password: '4444',
    name: 'Staff 4',
    role: 'center_staff',
    center: 'ไตดี',
    permissions: ['out', 'transfer', 'pending'],
  },
};

const ROLE_LABELS = {
  stock_receiver: 'รับสินค้าเข้าเท่านั้น',
  center_staff: 'เจ้าหน้าที่ประจำศูนย์',
};

// localStock แยกตามศูนย์ เช่น localStock['ไตดี']['K3 Ca 3.5'] = 10
let localStock = {};
CENTERS.forEach((center) => {
  localStock[center] = {};
  PRODUCTS.forEach((product) => {
    localStock[center][product] = 0;
  });
});

let currentUser = null;
let pendingTransfers = [];

const formRequestIds = {
  in: newRequestId('in'),
  out: newRequestId('out'),
  transfer: newRequestId('transfer'),
};

const modeLabels = {
  in: 'รับสินค้าเข้า',
  out: 'เบิกสินค้าออก',
  transfer: 'Transfer / ยืมของ',
  pending: 'ยืนยันรับของเข้า',
};

function newRequestId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// =====================
// INIT
// =====================
document.addEventListener('DOMContentLoaded', () => {
  setToday('in-date');
  setToday('out-date');
  setToday('transfer-date');

  addProductRow('in');
  addProductRow('out');
  addProductRow('transfer');

  bindStaticEvents();
  restoreSession();
});

function bindStaticEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll('[data-add-row]').forEach((button) => {
    button.addEventListener('click', () => addProductRow(button.dataset.addRow));
  });

  document.querySelectorAll('[data-submit]').forEach((button) => {
    button.addEventListener('click', () => submitByType(button.dataset.submit));
  });

  document.getElementById('btn-login')?.addEventListener('click', login);
  document.getElementById('login-code')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('login-password')?.focus();
  });
  document.getElementById('login-password')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login();
  });
  document.getElementById('toggle-password')?.addEventListener('click', togglePasswordVisibility);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-refresh-transfers')?.addEventListener('click', fetchPendingTransfers);

  document.getElementById('in-center')?.addEventListener('change', refreshInBadges);
  document.getElementById('out-center')?.addEventListener('change', refreshOutInfo);
  document.getElementById('transfer-from-center')?.addEventListener('change', refreshTransferInfo);
  document.getElementById('transfer-to-center')?.addEventListener('change', filterTransferTargetCenters);
}

function setToday(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = new Date().toISOString().split('T')[0];
}

// =====================
// LOGIN / LOGOUT / PERMISSION
// =====================
function login() {
  const codeInput = document.getElementById('login-code');
  const passwordInput = document.getElementById('login-password');
  const code = String(codeInput?.value || '').trim().toLowerCase();
  const password = String(passwordInput?.value || '').trim();

  if (!code || !password) {
    showToast('⚠️ กรุณากรอกรหัสเจ้าหน้าที่และรหัสผ่าน', 'error');
    return;
  }

  const user = STAFF_ACCOUNTS[code];
  if (!user) {
    showToast('❌ ไม่พบรหัสเจ้าหน้าที่นี้ในระบบ', 'error');
    writeLoginLog('LOGIN_FAIL', { staffCode: code, reason: 'staff_not_found' });
    return;
  }

  if (String(user.password) !== password) {
    showToast('❌ รหัสผ่านไม่ถูกต้อง', 'error');
    passwordInput.value = '';
    passwordInput.focus();
    writeLoginLog('LOGIN_FAIL', { staffCode: code, staffName: user.name, reason: 'wrong_password' });
    return;
  }

  // ไม่เก็บ password ลง localStorage เพื่อความปลอดภัย
  const { password: _password, ...safeUser } = user;
  currentUser = { ...safeUser };
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  passwordInput.value = '';
  applyLoginState();
  writeLoginLog('LOGIN', { staffCode: currentUser.code, staffName: currentUser.name, role: currentUser.role, center: currentUser.center || '' });
  showToast(`✅ เข้าสู่ระบบแล้ว: ${currentUser.code}`, 'success');
}

function logout() {
  const userBeforeLogout = currentUser ? { ...currentUser } : null;
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  pendingTransfers = [];

  const codeInput = document.getElementById('login-code');
  const passwordInput = document.getElementById('login-password');
  if (codeInput) codeInput.value = '';
  if (passwordInput) passwordInput.value = '';

  document.getElementById('login-screen').hidden = false;
  document.getElementById('app-shell').hidden = true;
  setSyncStatus('กรุณาเข้าสู่ระบบ', 'loading');

  if (userBeforeLogout) {
    writeLoginLog('LOGOUT', {
      staffCode: userBeforeLogout.code,
      staffName: userBeforeLogout.name,
      role: userBeforeLogout.role,
      center: userBeforeLogout.center || '',
    });
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

function writeLoginLog(action, extra = {}) {
  try {
    const params = new URLSearchParams({
      action: 'loginLog',
      logAction: action,
      staffCode: extra.staffCode || '',
      staffName: extra.staffName || '',
      role: extra.role || '',
      center: extra.center || '',
      reason: extra.reason || '',
      device: navigator.userAgent || '',
      timestamp: new Date().toISOString(),
    });

    fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: 'GET',
      mode: 'no-cors',
    }).catch(() => {});
  } catch (error) {
    // ไม่ให้ log ล้มแล้วกระทบการใช้งานหลัก
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved?.code && STAFF_ACCOUNTS[saved.code]) {
      const { password: _password, ...safeUser } = STAFF_ACCOUNTS[saved.code];
      currentUser = { ...safeUser };
      applyLoginState();
      return;
    }
  } catch (error) {
    localStorage.removeItem(SESSION_KEY);
  }

  logout();
}

function applyLoginState() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;

  const centerText = currentUser.center ? ` • ${currentUser.center}` : '';
  document.getElementById('current-user-name').textContent = `${currentUser.code} - ${currentUser.name}`;
  document.getElementById('current-user-role').textContent = `${ROLE_LABELS[currentUser.role] || currentUser.role}${centerText}`;

  setPersonFieldsFromUser();
  applyPermissionUI();
  fetchStock();

  if (canAccessTab('pending')) fetchPendingTransfers();
}

function setPersonFieldsFromUser() {
  const displayName = `${currentUser.name} (${currentUser.code})`;
  ['in-person', 'out-person', 'transfer-person'].forEach((id) => {
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

// =====================
// TABS
// =====================
function switchTab(tab, force = false) {
  if (!['in', 'out', 'transfer', 'pending'].includes(tab)) return;
  if (!force && !requirePermission(tab)) return;

  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === tab);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });

  const label = document.getElementById('active-mode-label');
  if (label) label.textContent = modeLabels[tab];

  if (tab === 'pending') fetchPendingTransfers();
}

// =====================
// PRODUCT ROWS
// =====================
function getProductOptions() {
  return PRODUCTS.map((product) => `<option value="${escapeHtml(product)}">${escapeHtml(product)}</option>`).join('');
}

function addProductRow(type) {
  const container = document.getElementById(`${type}-products`);
  if (!container) return;

  const row = document.createElement('div');
  row.className = `product-row row-${type}`;

  if (type === 'in') {
    row.innerHTML = `
      <select aria-label="เลือกรายการสินค้า">
        <option value="">— เลือกรายการสินค้า —</option>
        ${getProductOptions()}
      </select>
      <div class="inline-stock" aria-label="คงเหลือเดิม">
        <span class="qty-val">—</span>
        <span class="qty-label">ชิ้น</span>
      </div>
      <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวนรับเข้า" />
      <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
    `;

    row.querySelector('select').addEventListener('change', (event) => updateInlineStock(event.currentTarget));
    row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));
    container.appendChild(row);
    return;
  }

  row.innerHTML = `
    <select aria-label="เลือกรายการสินค้า">
      <option value="">— เลือกรายการสินค้า —</option>
      ${getProductOptions()}
    </select>
    <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวน" />
    <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
  `;

  row.querySelector('select').addEventListener('change', (event) => {
    if (type === 'transfer') updateTransferStockInfo(event.currentTarget);
    else updateStockInfo(event.currentTarget);
  });
  row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));
  container.appendChild(row);

  const info = document.createElement('div');
  info.className = 'stock-info';
  info.innerHTML = `คงเหลือ: <span class="val">—</span>`;
  container.appendChild(info);
}

function removeRow(btn) {
  const row = btn.closest('.product-row');
  if (!row) return;

  const container = row.parentElement;
  const activeRows = container.querySelectorAll('.product-row').length;
  if (activeRows <= 1) {
    showToast('⚠️ ต้องมีรายการสินค้าอย่างน้อย 1 แถว', 'error');
    return;
  }

  const next = row.nextElementSibling;
  row.classList.add('is-removing');

  window.setTimeout(() => {
    if (next && next.classList.contains('stock-info')) next.remove();
    row.remove();
  }, 180);
}

function getStockForCenter(type) {
  const center = document.getElementById(`${type}-center`)?.value;
  return center ? localStock[center] || {} : {};
}

function getTransferSourceStock() {
  const center = document.getElementById('transfer-from-center')?.value;
  return center ? localStock[center] || {} : {};
}

function updateInlineStock(select) {
  const row = select.closest('.product-row');
  const badge = row?.querySelector('.inline-stock');
  if (!badge) return;

  const product = select.value;
  const valEl = badge.querySelector('.qty-val');

  if (!product) {
    valEl.textContent = '—';
    valEl.className = 'qty-val';
    return;
  }

  const stock = getStockForCenter('in');
  const qty = stock[product] || 0;

  valEl.textContent = qty;
  valEl.className = `qty-val${qty <= 0 ? ' empty' : qty <= 5 ? ' low' : ''}`;
}

function updateStockInfo(select) {
  const row = select.closest('.product-row');
  const next = row?.nextElementSibling;
  if (!next || !next.classList.contains('stock-info')) return;

  const product = select.value;
  if (!product) {
    next.style.display = 'none';
    return;
  }

  const stock = getStockForCenter('out');
  const qty = stock[product] || 0;
  const cls = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';

  next.style.display = 'flex';
  next.innerHTML = `สินค้า: <strong>${escapeHtml(product)}</strong> <span aria-hidden="true">|</span> คงเหลือ: <span class="val ${cls}">${qty} ชิ้น</span>`;
}

function updateTransferStockInfo(select) {
  const row = select.closest('.product-row');
  const next = row?.nextElementSibling;
  if (!next || !next.classList.contains('stock-info')) return;

  const product = select.value;
  if (!product) {
    next.style.display = 'none';
    return;
  }

  const fromCenter = document.getElementById('transfer-from-center')?.value || 'ศูนย์ต้นทาง';
  const stock = getTransferSourceStock();
  const qty = stock[product] || 0;
  const cls = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';

  next.style.display = 'flex';
  next.innerHTML = `ต้นทาง: <strong>${escapeHtml(fromCenter)}</strong> <span aria-hidden="true">|</span> ${escapeHtml(product)} คงเหลือ: <span class="val ${cls}">${qty} ชิ้น</span>`;
}

function refreshInBadges() {
  document.querySelectorAll('#in-products .product-row.row-in').forEach((row) => {
    const select = row.querySelector('select');
    if (select) updateInlineStock(select);
  });
}

function refreshOutInfo() {
  document.querySelectorAll('#out-products .product-row.row-out').forEach((row) => {
    const select = row.querySelector('select');
    if (select && select.value) updateStockInfo(select);
  });
}

function refreshTransferInfo() {
  filterTransferTargetCenters();
  document.querySelectorAll('#transfer-products .product-row.row-transfer').forEach((row) => {
    const select = row.querySelector('select');
    if (select && select.value) updateTransferStockInfo(select);
  });
}

// =====================
// FETCH STOCK / TRANSFER
// =====================
async function fetchStock() {
  setSyncStatus('กำลังโหลดสต็อก...', 'loading');

  try {
    const res = await fetch(`${SCRIPT_URL}?action=getStock`);
    const data = await res.json();

    if (data.stock) {
      Object.entries(data.stock).forEach(([key, val]) => {
        const sep = key.indexOf('::');
        if (sep === -1) return;

        const center = key.substring(0, sep);
        const product = key.substring(sep + 2);
        if (!localStock[center]) localStock[center] = {};
        localStock[center][product] = Number(val) || 0;
      });

      refreshInBadges();
      refreshOutInfo();
      refreshTransferInfo();
      setSyncStatus('โหลดสต็อกแล้ว', 'ready');
      return;
    }

    setSyncStatus('ไม่พบข้อมูลสต็อก', 'error');
  } catch (error) {
    setSyncStatus('โหลดสต็อกไม่สำเร็จ', 'error');
  }
}

async function fetchPendingTransfers() {
  if (!currentUser || !canAccessTab('pending')) return;

  const box = document.getElementById('pending-transfers');
  if (box) box.innerHTML = '<div class="empty-state">กำลังโหลดรายการรอรับ...</div>';

  try {
    const params = new URLSearchParams({
      action: 'getTransfers',
      status: 'pending',
      center: currentUser.center,
      staffCode: currentUser.code,
    });
    const res = await fetch(`${SCRIPT_URL}?${params.toString()}`);
    const data = await res.json();
    pendingTransfers = Array.isArray(data.transfers) ? data.transfers : [];
    renderPendingTransfers();
  } catch (error) {
    pendingTransfers = [];
    renderPendingTransfers('ยังโหลดรายการ Transfer ไม่ได้ — ต้องเพิ่ม action getTransfers ใน Google Apps Script ก่อน');
  }
}

function setSyncStatus(text, state = 'loading') {
  const el = document.getElementById('sync-status');
  if (!el) return;

  el.textContent = text;
  el.classList.toggle('is-ready', state === 'ready');
  el.classList.toggle('is-error', state === 'error');
}

// =====================
// SUBMIT
// =====================
function submitByType(type) {
  if (type === 'transfer') {
    submitTransfer();
    return;
  }
  submitForm(type);
}

async function submitForm(type) {
  if (!requirePermission(type)) return;

  const btn = document.getElementById(`btn-${type}`);
  if (!btn || btn.disabled) return;

  const date = document.getElementById(`${type}-date`).value;
  const center = document.getElementById(`${type}-center`).value;
  const person = document.getElementById(`${type}-person`).value.trim();
  const note = document.getElementById(`${type}-note`).value.trim();
  const requestId = formRequestIds[type];

  if (!date || !center || !person) {
    showToast(`⚠️ กรุณากรอกวันที่ ศูนย์ และชื่อผู้${type === 'in' ? 'รับเข้า' : 'เบิกใช้'}`, 'error');
    return;
  }

  if (type === 'out' && !enforceOwnCenter(type, center)) return;

  const rows = document.querySelectorAll(`#${type}-products .product-row`);
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้า', 'error');
    return;
  }

  if (type === 'out') {
    const stockCheck = validateStockEnough(center, items);
    if (!stockCheck.ok) {
      showToast(stockCheck.message, 'error');
      return;
    }
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึก...');

  try {
    const params = new URLSearchParams({
      action: type === 'in' ? 'stockIn' : 'stockOut',
      date,
      center,
      person: `${currentUser.name} (${currentUser.code})`,
      note,
      requestId,

      staffCode: currentUser.code,
      staffName: currentUser.name,
      staffRole: currentUser.role,
      staffCenter: currentUser.center || '',

      items: JSON.stringify(items),
    });

    await fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: 'GET',
      mode: 'no-cors',
    });

    updateLocalStock(type, center, items);
    showToast('✅ บันทึกสำเร็จ!', 'success');
    formRequestIds[type] = newRequestId(type);
    resetForm(type);
  } catch (error) {
    showToast('❌ เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function submitTransfer() {
  if (!requirePermission('transfer')) return;

  const btn = document.getElementById('btn-transfer');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('transfer-date').value;
  const fromCenter = document.getElementById('transfer-from-center').value;
  const toCenter = document.getElementById('transfer-to-center').value;
  const person = document.getElementById('transfer-person').value.trim();
  const note = document.getElementById('transfer-note').value.trim();
  const requestId = formRequestIds.transfer;

  if (!date || !fromCenter || !toCenter || !person) {
    showToast('⚠️ กรุณากรอกวันที่ ศูนย์ต้นทาง ศูนย์ปลายทาง และผู้ทำรายการ', 'error');
    return;
  }

  if (fromCenter === toCenter) {
    showToast('⚠️ ศูนย์ต้นทางและปลายทางต้องไม่ใช่ศูนย์เดียวกัน', 'error');
    return;
  }

  if (!enforceOwnCenter('transfer', fromCenter)) return;

  const rows = document.querySelectorAll('#transfer-products .product-row');
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้า Transfer', 'error');
    return;
  }

  const stockCheck = validateStockEnough(fromCenter, items);
  if (!stockCheck.ok) {
    showToast(stockCheck.message, 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังสร้างรายการ Transfer...');

  try {
    const params = new URLSearchParams({
      action: 'createTransfer',
      date,
      fromCenter,
      toCenter,
      person: `${currentUser.name} (${currentUser.code})`,
      note,
      requestId,
      transferId: requestId,
      status: 'pending',

      staffCode: currentUser.code,
      staffName: currentUser.name,
      staffRole: currentUser.role,
      staffCenter: currentUser.center || '',

      items: JSON.stringify(items),
    });

    await fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: 'GET',
      mode: 'no-cors',
    });

    // Transfer จะหักออกจากศูนย์ต้นทางทันที แต่ยังไม่เพิ่มเข้าศูนย์ปลายทางจนกว่าจะกดรับ
    updateLocalStock('out', fromCenter, items);
    showToast('✅ สร้าง Transfer แล้ว รอศูนย์ปลายทางกดยืนยันรับ', 'success');
    formRequestIds.transfer = newRequestId('transfer');
    resetTransferForm();
  } catch (error) {
    showToast('❌ สร้าง Transfer ไม่สำเร็จ กรุณาลองใหม่', 'error');
  } finally {
    btn.disabled = false;
  }
}

function collectItemsFromRows(rows) {
  const items = [];

  rows.forEach((row) => {
    const product = row.querySelector('select')?.value;
    const qty = parseInt(row.querySelector('input[type=number]')?.value, 10);

    if (!product || !qty || qty < 1) return;
    items.push({ product, qty });
  });

  return mergeDuplicateItems(items);
}

function mergeDuplicateItems(items) {
  const map = new Map();

  items.forEach(({ product, qty }) => {
    map.set(product, (map.get(product) || 0) + Number(qty || 0));
  });

  return Array.from(map.entries()).map(([product, qty]) => ({ product, qty }));
}

function validateStockEnough(center, items) {
  for (const { product, qty } of items) {
    const availableQty = (localStock[center] || {})[product] || 0;
    if (qty > availableQty) {
      return {
        ok: false,
        message: `⚠️ ${product} (${center}): จำนวนไม่พอ มี ${availableQty} ชิ้น`,
      };
    }
  }

  return { ok: true, message: '' };
}

function updateLocalStock(type, center, items) {
  if (!localStock[center]) localStock[center] = {};

  items.forEach(({ product, qty }) => {
    const currentQty = localStock[center][product] || 0;
    localStock[center][product] = type === 'in'
      ? currentQty + qty
      : Math.max(0, currentQty - qty);
  });

  refreshInBadges();
  refreshOutInfo();
  refreshTransferInfo();
}

function resetForm(type) {
  const productContainer = document.getElementById(`${type}-products`);
  productContainer.innerHTML = '';
  addProductRow(type);

  document.getElementById(`${type}-person`).value = `${currentUser.name} (${currentUser.code})`;
  document.getElementById(`${type}-note`).value = '';
  setToday(`${type}-date`);

  if (type === 'in') {
    refreshInBadges();
  } else {
    if (currentUser.role === 'center_staff') lockSelectToValue('out-center', currentUser.center);
    refreshOutInfo();
  }
}

function resetTransferForm() {
  const productContainer = document.getElementById('transfer-products');
  productContainer.innerHTML = '';
  addProductRow('transfer');

  document.getElementById('transfer-person').value = `${currentUser.name} (${currentUser.code})`;
  document.getElementById('transfer-note').value = '';
  document.getElementById('transfer-to-center').value = '';
  setToday('transfer-date');

  if (currentUser.role === 'center_staff') {
    lockSelectToValue('transfer-from-center', currentUser.center);
  }

  filterTransferTargetCenters();
  refreshTransferInfo();
}

// =====================
// PENDING TRANSFERS
// =====================
function renderPendingTransfers(errorText = '') {
  const box = document.getElementById('pending-transfers');
  if (!box) return;

  if (errorText) {
    box.innerHTML = `<div class="empty-state error-state">${escapeHtml(errorText)}</div>`;
    return;
  }

  const visibleTransfers = pendingTransfers.filter((transfer) => {
    const toCenter = transfer.toCenter || transfer.to_center || transfer.destinationCenter || '';
    const status = String(transfer.status || 'pending').toLowerCase();
    return status === 'pending' && toCenter === currentUser.center;
  });

  if (!visibleTransfers.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีรายการรอรับเข้าศูนย์ของคุณ</div>';
    return;
  }

  box.innerHTML = visibleTransfers.map((transfer, index) => renderTransferCard(transfer, index)).join('');

  box.querySelectorAll('[data-accept-transfer]').forEach((button) => {
    button.addEventListener('click', () => acceptTransfer(button.dataset.acceptTransfer));
  });
}

function renderTransferCard(transfer, index) {
  const transferId = transfer.transferId || transfer.transfer_id || transfer.requestId || transfer.id || `transfer-${index}`;
  const fromCenter = transfer.fromCenter || transfer.from_center || transfer.sourceCenter || '—';
  const toCenter = transfer.toCenter || transfer.to_center || transfer.destinationCenter || '—';
  const date = transfer.date || transfer.createdAt || transfer.created_at || '—';
  const person = transfer.person || transfer.createdBy || transfer.created_by || '—';
  const note = transfer.note || '';
  const items = normalizeItems(transfer.items);

  const itemList = items.length
    ? items.map((item) => `
        <li class="transfer-item-row">
          <span class="transfer-item-name">${escapeHtml(item.product)}</span>
          <span class="transfer-item-meta">
            <strong class="transfer-item-qty">${Number(item.qty) || 0}</strong>
            <span class="transfer-item-unit">ชิ้น</span>
          </span>
        </li>
      `).join('')
    : '<li class="transfer-item-row">ไม่มีรายละเอียดสินค้า</li>';
    
  return `
    <article class="transfer-card">
      <div class="transfer-card-head">
        <div>
          <strong>${escapeHtml(fromCenter)} → ${escapeHtml(toCenter)}</strong>
          <span>${escapeHtml(date)} • ${escapeHtml(person)}</span>
        </div>
        <span class="transfer-status">รอรับ</span>
      </div>
      <ul class="transfer-items">${itemList}</ul>
      ${note ? `<p class="transfer-note">หมายเหตุ: ${escapeHtml(note)}</p>` : ''}
      <button class="btn-accept-transfer" type="button" data-accept-transfer="${escapeHtml(transferId)}">ยืนยันรับเข้าสต็อก</button>
    </article>
  `;
}

function normalizeItems(rawItems) {
  if (Array.isArray(rawItems)) return rawItems;

  if (typeof rawItems === 'string') {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
}

async function acceptTransfer(transferId) {
  if (!requirePermission('pending')) return;

  const transfer = pendingTransfers.find((item, index) => {
    const id = item.transferId || item.transfer_id || item.requestId || item.id || `transfer-${index}`;
    return String(id) === String(transferId);
  });

  if (!transfer) {
    showToast('❌ ไม่พบรายการ Transfer นี้', 'error');
    return;
  }

  const toCenter = transfer.toCenter || transfer.to_center || transfer.destinationCenter || '';
  if (toCenter !== currentUser.center) {
    showToast(`⛔ รับได้เฉพาะรายการที่ส่งเข้า ${currentUser.center}`, 'error');
    return;
  }

  const items = normalizeItems(transfer.items);
  if (!items.length) {
    showToast('❌ รายการนี้ไม่มีข้อมูลสินค้า', 'error');
    return;
  }

  showToast('', 'loading', 'กำลังยืนยันรับของ...');

  try {
    const params = new URLSearchParams({
      action: 'acceptTransfer',
      transferId,
      acceptedBy: `${currentUser.name} (${currentUser.code})`,
      acceptedByCode: currentUser.code,
      acceptedByName: currentUser.name,
      acceptedByRole: currentUser.role,
      acceptedCenter: currentUser.center,
      items: JSON.stringify(items),
    });

    await fetch(`${SCRIPT_URL}?${params.toString()}`, {
      method: 'GET',
      mode: 'no-cors',
    });

    updateLocalStock('in', currentUser.center, items);
    pendingTransfers = pendingTransfers.filter((item, index) => {
      const id = item.transferId || item.transfer_id || item.requestId || item.id || `transfer-${index}`;
      return String(id) !== String(transferId);
    });
    renderPendingTransfers();
    showToast('✅ รับเข้าสต็อกเรียบร้อย', 'success');
  } catch (error) {
    showToast('❌ ยืนยันรับไม่สำเร็จ กรุณาลองใหม่', 'error');
  }
}

// =====================
// TOAST
// =====================
let toastTimer;
function showToast(msg, type = 'success', label = '') {
  const el = document.getElementById('toast');
  if (!el) return;

  el.className = `toast ${type}`;
  el.innerHTML = type === 'loading' ? `<div class="spinner"></div>${escapeHtml(label)}` : escapeHtml(msg);
  el.classList.add('show');

  clearTimeout(toastTimer);
  if (type !== 'loading') {
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 3400);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
