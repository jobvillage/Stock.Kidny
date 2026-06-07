// ===============================
// Shared Global Config
// ===============================
var SESSION_KEY = window.SESSION_KEY || 'stockAppSessionV2';
var STOCK_CACHE_KEY = window.STOCK_CACHE_KEY || 'stockAppCachedStockV1';
var TRANSFER_CACHE_KEY = window.TRANSFER_CACHE_KEY || 'stockAppCachedPendingTransfersV1';

var CENTERS = window.CENTERS || [
  'Hub Admin',
  'สต็อกใหญ่',
  'ไตบน',
  'ไตล่าง',
  'ไตดี'
];

var PRODUCTS = window.PRODUCTS || [];
var STAFF_CENTER_BY_CODE = window.STAFF_CENTER_BY_CODE || {
  staff1: 'ไตบน',
  staff2: 'ไตล่าง',
  staff3: 'ไตดี',
};

window.SESSION_KEY = SESSION_KEY;
window.STOCK_CACHE_KEY = STOCK_CACHE_KEY;
window.TRANSFER_CACHE_KEY = TRANSFER_CACHE_KEY;
window.CENTERS = CENTERS;
window.PRODUCTS = PRODUCTS;
window.STAFF_CENTER_BY_CODE = STAFF_CENTER_BY_CODE;

function normalizeCenterName(center) {
  const raw = String(center || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');

  if (key === 'hub admin') return 'Hub Admin';
  if (raw === 'สต็อกใหญ่') return 'สต็อกใหญ่';
  if (raw === 'ไตบน') return 'ไตบน';
  if (raw === 'ไตล่าง') return 'ไตล่าง';
  if (raw === 'ไตดี') return 'ไตดี';

  return raw;
}

window.normalizeCenterName = normalizeCenterName;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.escapeHtml = escapeHtml;

function newRequestId(type) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateText = `${yyyy}${mm}${dd}`;

  let prefix = 'REQ';

  if (type === 'po') {
    prefix = 'PO';
  }

  if (type === 'pr') {
    prefix = 'PR';
  }

  if (type === 'transfer') {
    const timeText = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const randomText = Math.random().toString(36).slice(2, 6).toUpperCase();

    return `TRF-${dateText}-${timeText}-${randomText}`;
  }

  const key = `stock_request_counter_${prefix}_${dateText}`;
  const current = Number(localStorage.getItem(key) || '0') + 1;

  localStorage.setItem(key, String(current));

  return `${prefix}-${dateText}-${String(current).padStart(3, '0')}`;
}

window.newRequestId = newRequestId;

async function newSupabaseDocumentId(prefix) {
  const normalizedPrefix = String(prefix || '').trim().toUpperCase() || 'REQ';
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateText = `${yyyy}${mm}${dd}`;
  const idPrefix = `${normalizedPrefix}-${dateText}-`;

  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    return newRequestId(normalizedPrefix.toLowerCase());
  }

  const documentSource = normalizedPrefix === 'PR'
    ? { table: 'pr_requests', column: 'pr_id' }
    : { table: 'po_cmo_requests', column: 'po_id' };

  const { data, error } = await supabaseClient
    .from(documentSource.table)
    .select(documentSource.column)
    .like(documentSource.column, `${idPrefix}%`)
    .order(documentSource.column, { ascending: true })
    .limit(1000);

  if (error) {
    throw error;
  }

  const usedNumbers = new Set(
    (data || [])
      .map((item) => Number(String(item[documentSource.column] || '').replace(idPrefix, '')))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `${idPrefix}${String(nextNumber).padStart(3, '0')}`;
}

window.newSupabaseDocumentId = newSupabaseDocumentId;

function collectItemsFromRows(rows) {
  const items = [];

  rows.forEach((row) => {
    const product = row.querySelector('select')?.value;
    const qtyInput = row.querySelector('input[type=number]');
    const qtyText = String(qtyInput?.value || '').trim();

    if (!product || !qtyText) return;

    if (!/^\d+$/.test(qtyText)) {
      throw new Error('กรุณากรอกจำนวนเป็นเลขจำนวนเต็มเท่านั้น ห้ามใส่จุดทศนิยม');
    }

    const qty = Number(qtyText);

    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error('จำนวนสินค้าต้องเป็นเลขจำนวนเต็มมากกว่า 0');
    }

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
    const availableQty = typeof getStockQty === 'function'
      ? getStockQty(center, product)
      : ((localStock[center] || {})[product] || 0);
    if (qty > availableQty) {
      return {
        ok: false,
        message: `⚠️ ${product} (${center}): จำนวนไม่พอ มี ${availableQty} ชิ้น`,
      };
    }
  }

  return { ok: true, message: '' };
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
