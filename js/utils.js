// ===============================
// Shared Global Config
// ===============================
var SESSION_KEY = window.SESSION_KEY || 'stockAppSessionV2';
var STOCK_CACHE_KEY = window.STOCK_CACHE_KEY || 'stockAppCachedStockV1';
var TRANSFER_CACHE_KEY = window.TRANSFER_CACHE_KEY || 'stockAppCachedPendingTransfersV1';

var CENTERS = window.CENTERS || [
  'Hub Admin',
  'สต็อกใหญ่'
];

var PRODUCTS = window.PRODUCTS || [];

window.SESSION_KEY = SESSION_KEY;
window.STOCK_CACHE_KEY = STOCK_CACHE_KEY;
window.TRANSFER_CACHE_KEY = TRANSFER_CACHE_KEY;
window.CENTERS = CENTERS;
window.PRODUCTS = PRODUCTS;

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

  const key = `stock_request_counter_${prefix}_${dateText}`;
  const current = Number(localStorage.getItem(key) || '0') + 1;

  localStorage.setItem(key, String(current));

  return `${prefix}-${dateText}-${String(current).padStart(3, '0')}`;
}

window.newRequestId = newRequestId;

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