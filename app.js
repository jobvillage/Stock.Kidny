// =====================
// CONFIG — ฝังหลังบ้าน
// =====================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw8Z3jtbpRZB5ZslPK2u_Cdtcw_hiVVP9Gg6xOHnkSgBbT2xhrEikOid5cLcdcPdG5a/exec';

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

// localStock แยกตามศูนย์ เช่น localStock['ไตดี']['K3 Ca 3.5'] = 10
let localStock = {};
CENTERS.forEach((center) => {
  localStock[center] = {};
  PRODUCTS.forEach((product) => {
    localStock[center][product] = 0;
  });
});

const formRequestIds = {
  in: newRequestId('in'),
  out: newRequestId('out'),
};

const modeLabels = {
  in: 'รับสินค้าเข้า',
  out: 'เบิกสินค้าออก',
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
  addProductRow('in');
  addProductRow('out');
  bindStaticEvents();
  fetchStock();
});

function bindStaticEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll('[data-add-row]').forEach((button) => {
    button.addEventListener('click', () => addProductRow(button.dataset.addRow));
  });

  document.querySelectorAll('[data-submit]').forEach((button) => {
    button.addEventListener('click', () => submitForm(button.dataset.submit));
  });

  document.getElementById('in-center').addEventListener('change', refreshInBadges);
  document.getElementById('out-center').addEventListener('change', refreshOutInfo);
}

function setToday(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = new Date().toISOString().split('T')[0];
}

// =====================
// TABS
// =====================
function switchTab(tab) {
  if (!['in', 'out'].includes(tab)) return;

  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === tab);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });

  const label = document.getElementById('active-mode-label');
  if (label) label.textContent = modeLabels[tab];
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
    <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวนเบิกออก" />
    <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
  `;

  row.querySelector('select').addEventListener('change', (event) => updateStockInfo(event.currentTarget));
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

// ดึง stock ของศูนย์ที่เลือก
function getStockForCenter(type) {
  const center = document.getElementById(`${type}-center`).value;
  return center ? localStock[center] || {} : {};
}

// อัพเดท badge คงเหลือในหน้ารับเข้า
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

// อัพเดท stock-info ในหน้าเบิก
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

// refresh badge ทุกแถวเมื่อเปลี่ยนศูนย์ (หน้ารับเข้า)
function refreshInBadges() {
  document.querySelectorAll('#in-products .product-row.row-in').forEach((row) => {
    const select = row.querySelector('select');
    if (select) updateInlineStock(select);
  });
}

// refresh stock-info ทุกแถวเมื่อเปลี่ยนศูนย์ (หน้าเบิก)
function refreshOutInfo() {
  document.querySelectorAll('#out-products .product-row.row-out').forEach((row) => {
    const select = row.querySelector('select');
    if (select && select.value) updateStockInfo(select);
  });
}

// =====================
// FETCH STOCK
// =====================
async function fetchStock() {
  setSyncStatus('กำลังโหลดสต็อก...', 'loading');

  try {
    const res = await fetch(`${SCRIPT_URL}?action=getStock`);
    const data = await res.json();

    if (data.stock) {
      // data.stock = { 'ไตดี::K3 Ca 3.5': 10, ... }
      // แปลงเป็น localStock[center][product]
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
      setSyncStatus('โหลดสต็อกแล้ว', 'ready');
      return;
    }

    setSyncStatus('ไม่พบข้อมูลสต็อก', 'error');
  } catch (error) {
    setSyncStatus('โหลดสต็อกไม่สำเร็จ', 'error');
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
async function submitForm(type) {
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

  const rows = document.querySelectorAll(`#${type}-products .product-row`);
  const items = [];

  for (const row of rows) {
    const product = row.querySelector('select')?.value;
    const qty = parseInt(row.querySelector('input[type=number]')?.value, 10);

    if (!product || !qty || qty < 1) continue;

    if (type === 'out') {
      const availableQty = (localStock[center] || {})[product] || 0;
      if (qty > availableQty) {
        showToast(`⚠️ ${product} (${center}): เบิกเกินคงเหลือ มี ${availableQty} ชิ้น`, 'error');
        return;
      }
    }

    items.push({ product, qty });
  }

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้า', 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึก...');

  try {
    const params = new URLSearchParams({
      action: type === 'in' ? 'stockIn' : 'stockOut',
      date,
      center,
      person,
      note,
      requestId,
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

function updateLocalStock(type, center, items) {
  if (!localStock[center]) localStock[center] = {};

  items.forEach(({ product, qty }) => {
    const currentQty = localStock[center][product] || 0;
    localStock[center][product] = type === 'in'
      ? currentQty + qty
      : Math.max(0, currentQty - qty);
  });
}

function resetForm(type) {
  const productContainer = document.getElementById(`${type}-products`);
  productContainer.innerHTML = '';
  addProductRow(type);

  document.getElementById(`${type}-person`).value = '';
  document.getElementById(`${type}-note`).value = '';
  setToday(`${type}-date`);

  if (type === 'in') {
    refreshInBadges();
  } else {
    refreshOutInfo();
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
