// =====================
// CONFIG — ฝังหลังบ้าน
// =====================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby6HftKeGFb0nrEYydWwH4Ps98patvyHfmGX0q1v5acpKSeqiuW9e5p_RIg0Qucz0K5rw/exec';
const SESSION_KEY = 'stockAppSessionV2';
const STOCK_CACHE_KEY = 'stockAppCachedStockV1';
const TRANSFER_CACHE_KEY = 'stockAppCachedPendingTransfersV1';

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

// =====================
// SUPABASE CONFIG
// =====================
const SUPABASE_URL = 'https://bqoenwdfjiogftacmqhb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxb2Vud2RmamlvZ2Z0YWNtcWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjgwNjEsImV4cCI6MjA5MzY0NDA2MX0.GpHgm4kSjiL7gXOCEOAwEgCMeMCIG7R4y4jmcIAy33o';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// =====================
// AUTH / PERMISSIONS
// =====================

let currentUser = null;

const ROLE_PERMISSIONS = {
  stock_receiver: ['in', 'stock'],
  center_staff: ['out', 'transfer', 'pending', 'stock'],
  committee: ['stock'],
  admin: ['in', 'out', 'transfer', 'pending', 'stock', 'committee'],
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

// localStock แยกตามศูนย์ เช่น localStock['ไตดี']['K3 Ca 3.5'] = 10
let localStock = {};
CENTERS.forEach((center) => {
  localStock[center] = {};
  PRODUCTS.forEach((product) => {
    localStock[center][product] = 0;
  });
});

let pendingTransfers = [];
let stockViewTransfers = [];

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
  stock: 'ดู Stock',
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

  document.getElementById('stock-center-filter')?.addEventListener('change', () => {
    renderStockDashboard();
    fetchStockViewTransfers();
  });

  document.getElementById('stock-product-filter')?.addEventListener('change', () => {
    renderStockDashboard();
    renderStockViewTransfers();
  });

  document.getElementById('btn-refresh-stock-view')?.addEventListener('click', () => {
    fetchStock();
    fetchStockViewTransfers();
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

    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));

    showToast('✅ เข้าสู่ระบบสำเร็จ', 'success');

    applyLoginState();

  } catch (error) {
    console.error('Supabase login error:', error);
    showToast(`❌ ${error.message || 'เชื่อมต่อระบบ Login ไม่สำเร็จ'}`, 'error');
  }
}

async function logout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  location.reload();
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
  const savedUser = localStorage.getItem(SESSION_KEY);

  if (!savedUser) {
    showLoginScreen();
    return;
  }

  try {
    currentUser = normalizeUser(JSON.parse(savedUser));
    applyLoginState();
  } catch (error) {
    localStorage.removeItem(SESSION_KEY);
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

function applyLoginState() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;

  const centerText = currentUser.center ? ` • ${currentUser.center}` : '';
  document.getElementById('current-user-name').textContent = `${currentUser.code} - ${currentUser.name}`;
  document.getElementById('current-user-role').textContent = `${ROLE_LABELS[currentUser.role] || currentUser.role}${centerText}`;

  setPersonFieldsFromUser();
  applyPermissionUI();

  // โหลดจาก cache ก่อน เพื่อให้หน้าเว็บแสดงผลเร็ว
  loadStockCache();

  // แล้วค่อยโหลดข้อมูลจริงจาก Apps Script ทับ
  fetchStock();

  if (canAccessTab('pending')) fetchPendingTransfers();
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

// =====================
// TABS
// =====================
function switchTab(tab, force = false) {
  if (!['in', 'out', 'transfer', 'pending', 'stock'].includes(tab)) return;
  if (!force && !requirePermission(tab)) return;

  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === tab);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });

  const label = document.getElementById('active-mode-label');
  if (label) label.textContent = modeLabels[tab] || '';

  if (tab === 'pending') {
    fetchPendingTransfers();
  }

  if (tab === 'stock') {
    renderStockDashboard();
    fetchStockViewTransfers();
  }
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

function saveStockCache() {
  try {
    localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify({
      stock: localStock,
      savedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('Save stock cache failed:', error);
  }
}

function loadStockCache() {
  try {
    const cached = localStorage.getItem(STOCK_CACHE_KEY);
    if (!cached) return false;

    const data = JSON.parse(cached);
    if (!data.stock) return false;

    localStock = data.stock;

    refreshInBadges();
    refreshOutInfo();
    refreshTransferInfo();

    setSyncStatus('โหลดข้อมูลจากเครื่องแล้ว กำลังซิงก์...', 'loading');
    return true;
  } catch (error) {
    console.warn('Load stock cache failed:', error);
    return false;
  }
}

// =====================
// FETCH STOCK / TRANSFER
// =====================
async function fetchStock() {
  setSyncStatus('กำลังโหลดสต็อกจาก Supabase...', 'loading');

  try {
    const { data, error } = await supabaseClient.rpc('get_stock_items');

    if (error) {
      throw error;
    }

    // reset localStock ก่อนเติมข้อมูลใหม่
    localStock = {};
    CENTERS.forEach((center) => {
      localStock[center] = {};
      PRODUCTS.forEach((product) => {
        localStock[center][product] = 0;
      });
    });

    (data || []).forEach((item) => {
      const center = item.center;
      const product = item.product;

      if (!localStock[center]) {
        localStock[center] = {};
      }

      localStock[center][product] = Number(item.qty) || 0;
    });

    refreshInBadges();
    refreshOutInfo();
    refreshTransferInfo();
    renderStockDashboard();

    setSyncStatus('โหลดสต็อกแล้ว', 'ready');

  } catch (error) {
    console.error('Supabase stock error:', error);
    setSyncStatus('โหลดสต็อกไม่สำเร็จ', 'error');
  }
}

async function fetchPendingTransfers() {
  if (!currentUser || !canAccessTab('pending')) return;

  const box = document.getElementById('pending-transfers');
  if (box) box.innerHTML = '<div class="empty-state">กำลังโหลดรายการรอรับ...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_pending_transfers', {
      p_center: currentUser.center,
    });

    if (error) {
      throw error;
    }

    pendingTransfers = (data || []).map((item) => ({
      transferId: item.transfer_id,
      date: item.transfer_date || item.created_at,
      fromCenter: item.from_center,
      toCenter: item.to_center,
      status: item.status,
      person: item.created_by_name || item.created_by_code || '',
      note: item.note || '',
      items: item.items || [],
    }));

    renderPendingTransfers();

  } catch (error) {
    console.error('Supabase pending transfer error:', error);
    pendingTransfers = [];
    renderPendingTransfers(error.message || 'โหลดรายการรอรับไม่สำเร็จ');
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
  if (type === 'in') {
    submitStockInSupabase();
    return;
  }

  if (type === 'out') {
    submitStockOutSupabase();
    return;
  }

  if (type === 'transfer') {
    submitTransfer();
    return;
  }

  submitForm(type);
}

async function submitStockInSupabase() {
  if (!requirePermission('in')) return;

  const btn = document.getElementById('btn-in');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('in-date').value;
  const center = document.getElementById('in-center').value;
  const receiverName = document.getElementById('in-person').value.trim();
  const note = document.getElementById('in-note').value.trim();
  const requestId = formRequestIds.in;

  if (!date || !center || !receiverName) {
    showToast('⚠️ กรุณากรอกวันที่ ศูนย์ และชื่อผู้รับเข้า', 'error');
    return;
  }

  const rows = document.querySelectorAll('#in-products .product-row');
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้า', 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกรับเข้า...');

  try {
    const { data, error } = await supabaseClient.rpc('stock_in', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_date: date,
      p_center: center,
      p_receiver_name: receiverName,
      p_note: note,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึกรับเข้าไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      showToast('⚠️ รายการนี้ถูกบันทึกไปแล้ว ไม่บันทึกซ้ำ', 'error');
      return;
    }

    updateLocalStock('in', center, items);

    showToast('✅ บันทึกรับเข้าสำเร็จ', 'success');

    formRequestIds.in = newRequestId('in');
    resetForm('in');

  } catch (error) {
    console.error('Supabase stock_in error:', error);
    showToast(`❌ ${error.message || 'บันทึกรับเข้าไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function submitStockOutSupabase() {
  if (!requirePermission('out')) return;

  const btn = document.getElementById('btn-out') || document.querySelector('[data-submit="out"]');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('out-date').value;
  const center = document.getElementById('out-center').value;
  const note = document.getElementById('out-note').value.trim();
  const requestId = formRequestIds.out;

  if (!date || !center) {
    showToast('⚠️ กรุณากรอกวันที่และศูนย์ที่เบิก', 'error');
    return;
  }

  if (!enforceOwnCenter('out', center)) return;

  const rows = document.querySelectorAll('#out-products .product-row');
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้าเบิกออก', 'error');
    return;
  }

  const stockCheck = validateStockEnough(center, items);
  if (!stockCheck.ok) {
    showToast(stockCheck.message, 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกเบิกออก...');

  try {
    const { data, error } = await supabaseClient.rpc('stock_out', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_date: date,
      p_center: center,
      p_note: note,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึกเบิกออกไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      showToast('⚠️ รายการนี้ถูกบันทึกไปแล้ว ไม่บันทึกซ้ำ', 'error');
      return;
    }

    updateLocalStock('out', center, items);

    showToast('✅ บันทึกเบิกออกสำเร็จ', 'success');

    formRequestIds.out = newRequestId('out');
    resetForm('out');

  } catch (error) {
    console.error('Supabase stock_out error:', error);
    showToast(`❌ ${error.message || 'บันทึกเบิกออกไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function submitTransfer() {
  if (!requirePermission('transfer')) return;

  const btn = document.getElementById('btn-transfer') || document.querySelector('[data-submit="transfer"]');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('transfer-date').value;
  const fromCenter = document.getElementById('transfer-from-center').value;
  const toCenter = document.getElementById('transfer-to-center').value;
  const note = document.getElementById('transfer-note').value.trim();
  const requestId = formRequestIds.transfer;

  if (!date || !fromCenter || !toCenter) {
    showToast('⚠️ กรุณากรอกวันที่ ศูนย์ต้นทาง และศูนย์ปลายทาง', 'error');
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
    const { data, error } = await supabaseClient.rpc('create_transfer', {
      p_transfer_id: requestId,
      p_staff_code: currentUser.code,
      p_date: date,
      p_from_center: fromCenter,
      p_to_center: toCenter,
      p_note: note,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'สร้าง Transfer ไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      showToast('⚠️ รายการนี้ถูกบันทึกไปแล้ว ไม่บันทึกซ้ำ', 'error');
      return;
    }

    updateLocalStock('out', fromCenter, items);

    showToast('✅ สร้าง Transfer แล้ว รอศูนย์ปลายทางกดยืนยันรับ', 'success');

    formRequestIds.transfer = newRequestId('transfer');
    resetTransferForm();

    if (canAccessTab('pending')) {
      fetchPendingTransfers();
    }

  } catch (error) {
    console.error('Supabase create_transfer error:', error);
    showToast(`❌ ${error.message || 'สร้าง Transfer ไม่สำเร็จ'}`, 'error');
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

  if (type === 'in') {
  document.getElementById(`${type}-person`).value = '';
  } else {
    document.getElementById(`${type}-person`).value = `${currentUser.name} (${currentUser.code})`;
  }
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

function updatePendingBadge(count = 0) {
  const badge = document.getElementById('pending-badge');
  if (!badge) return;

  const total = Number(count) || 0;
  badge.textContent = String(total);
  badge.hidden = total <= 0;
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

  updatePendingBadge(visibleTransfers.length);

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

  if (toCenter !== currentUser.center && currentUser.role !== 'admin') {
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
    const { data, error } = await supabaseClient.rpc('accept_transfer', {
      p_transfer_id: transferId,
      p_staff_code: currentUser.code,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'ยืนยันรับไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      showToast('⚠️ รายการนี้ถูกรับเข้าแล้ว ไม่เพิ่มซ้ำ', 'error');
      fetchPendingTransfers();
      return;
    }

    updateLocalStock('in', toCenter, items);

    pendingTransfers = pendingTransfers.filter((item, index) => {
      const id = item.transferId || item.transfer_id || item.requestId || item.id || `transfer-${index}`;
      return String(id) !== String(transferId);
    });

    renderPendingTransfers();

    if (typeof updatePendingBadge === 'function') {
      updatePendingBadge(pendingTransfers.length);
    }

    showToast('✅ รับเข้าสต็อกเรียบร้อย', 'success');

  } catch (error) {
    console.error('Supabase accept_transfer error:', error);
    showToast(`❌ ${error.message || 'ยืนยันรับไม่สำเร็จ กรุณาลองใหม่'}`, 'error');
  }
}

function getStockCenterFilter() {
  return document.getElementById('stock-center-filter')?.value || '';
}

function getStockProductFilter() {
  return document.getElementById('stock-product-filter')?.value || '';
}

function renderStockDashboard() {
  const box = document.getElementById('stock-dashboard-grid');
  if (!box) return;

  const selectedCenter = getStockCenterFilter();
  const selectedProduct = getStockProductFilter();

  const centersToShow = selectedCenter ? [selectedCenter] : CENTERS;
  const productsToShow = selectedProduct ? [selectedProduct] : PRODUCTS;

  const html = centersToShow.map((center) => {
    const stock = localStock[center] || {};

    const rows = productsToShow.map((product) => {
      const qty = Number(stock[product]) || 0;
      const cls = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';

      return `
        <div class="stock-dashboard-row">
          <span>${escapeHtml(product)}</span>
          <strong class="${cls}">${qty} ชิ้น</strong>
        </div>
      `;
    }).join('');

    return `
      <article class="stock-dashboard-card">
        <div class="stock-dashboard-head">
          <strong>${escapeHtml(center)}</strong>
        </div>
        <div class="stock-dashboard-body">
          ${rows}
        </div>
      </article>
    `;
  }).join('');

  box.innerHTML = html || '<div class="empty-state">ไม่มีข้อมูลสต็อก</div>';
}

async function fetchStockViewTransfers() {
  const box = document.getElementById('stock-transfer-list');
  if (!box) return;

  const selectedCenter = getStockCenterFilter();

  box.innerHTML = '<div class="empty-state">กำลังโหลดรายการ Transfer...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_pending_transfers', {
      p_center: selectedCenter,
    });

    if (error) {
      throw error;
    }

    stockViewTransfers = (data || []).map((item) => ({
      transferId: item.transfer_id,
      date: item.transfer_date || item.created_at,
      fromCenter: item.from_center,
      toCenter: item.to_center,
      status: item.status,
      person: item.created_by_name || item.created_by_code || '',
      note: item.note || '',
      items: item.items || [],
    }));

    renderStockViewTransfers();

  } catch (error) {
    console.error('Stock view transfer error:', error);
    stockViewTransfers = [];
    box.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message || 'โหลดรายการ Transfer ไม่สำเร็จ')}</div>`;
  }
}

function renderStockViewTransfers() {
  const box = document.getElementById('stock-transfer-list');
  if (!box) return;

  const selectedProduct = getStockProductFilter();

  const filteredTransfers = stockViewTransfers
    .map((transfer) => {
      const items = normalizeItems(transfer.items);
      const filteredItems = selectedProduct
        ? items.filter((item) => item.product === selectedProduct)
        : items;

      return {
        ...transfer,
        items: filteredItems,
      };
    })
    .filter((transfer) => normalizeItems(transfer.items).length > 0);

  if (!filteredTransfers.length) {
    box.innerHTML = '<div class="empty-state">ไม่มีรายการ Transfer ที่ตรงกับฟิลเตอร์</div>';
    return;
  }

  box.innerHTML = filteredTransfers.map((transfer) => {
    const items = normalizeItems(transfer.items);
    const itemText = items.length
      ? items.map(item => `${escapeHtml(item.product)} ${Number(item.qty) || 0} ชิ้น`).join(' / ')
      : 'ไม่มีรายละเอียดสินค้า';

    return `
      <article class="stock-transfer-card">
        <div class="stock-transfer-top">
          <strong>${escapeHtml(transfer.fromCenter)} → ${escapeHtml(transfer.toCenter)}</strong>
          <span class="transfer-status">รอรับ</span>
        </div>

        <div class="stock-transfer-detail">
          <p>${itemText}</p>
          <small>
            วันที่: ${escapeHtml(transfer.date || '-')}
            ${transfer.person ? ` • ผู้ทำรายการ: ${escapeHtml(transfer.person)}` : ''}
          </small>
          ${transfer.note ? `<small>หมายเหตุ: ${escapeHtml(transfer.note)}</small>` : ''}
        </div>
      </article>
    `;
  }).join('');
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
