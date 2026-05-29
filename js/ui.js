let productsLoaded = false;

async function loadProductsFromSupabase() {
  try {
    productsLoaded = false;

    const { data, error } = await supabaseClient.rpc('get_stock_items');

    if (error) {
      throw error;
    }

    const productMap = new Map();
    (data || [])
      .map((item) => item.product)
      .filter(Boolean)
      .forEach((product) => {
        const key = typeof normalizeProductKey === 'function'
          ? normalizeProductKey(product)
          : String(product).trim().toLowerCase();
        if (!productMap.has(key)) productMap.set(key, product);
      });

    const uniqueProducts = [...productMap.values()]
      .sort((a, b) => a.localeCompare(b, 'th'));

    PRODUCTS.splice(0, PRODUCTS.length, ...uniqueProducts);

    productsLoaded = true;

    console.log('✅ PRODUCTS loaded:', PRODUCTS);
  } catch (error) {
    console.error('โหลดสินค้าไม่สำเร็จ:', error);
    PRODUCTS.splice(0, PRODUCTS.length);
  }
}

const modeLabels = {
  in: 'รับสินค้าเข้า',
  out: 'ใบขอเบิก',
  request_status: 'สถานะใบขอเบิก',
  transfer: 'เปิด PO',
  pending: 'รายการขอเบิก',
  po_status: 'สถานะ PO',
  stock: 'ดู Stock',
};

function setToday(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = new Date().toISOString().split('T')[0];
}

// =====================
// TABS
// =====================
function switchTab(tab, force = false) {
  if (!['in', 'out', 'request_status', 'transfer', 'pending', 'po_status', 'stock'].includes(tab)) return;
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

  if (tab === 'request_status') {
    fetchRequestStatus();
  }

  if (tab === 'stock') {
    renderStockDashboard();
  }

  if (tab === 'transfer') {
    renderHubStockDashboard();
  }

  if (tab === 'po_status') {
    fetchPoStatus();
  }
}

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

function updatePendingBadge(count = 0) {
  const badge = document.getElementById('pending-badge');
  if (!badge) return;

  const total = Number(count) || 0;
  badge.textContent = String(total);
  badge.hidden = total <= 0;
}

// =====================
// TOAST
// =====================
let toastTimer;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

function getProductOptions() {
  return PRODUCTS.map((product) => `<option value="${escapeHtml(product)}">${escapeHtml(product)}</option>`).join('');
}

function renderProductDatalist() {
  const list = document.getElementById('product-list');
  if (!list) return;
  list.innerHTML = getProductOptions();
}

function addProductRow(type) {
  const container = document.getElementById(`${type}-products`);
  if (!container) return;

  const row = document.createElement('div');
  row.className = `product-row row-${type}`;

  if (type === 'in') {
    row.innerHTML = `
      <select class="product-select" aria-label="เลือกรายการสินค้า">
        <option value=""></option>
        ${getProductOptions()}
      </select>
      <div class="inline-stock" aria-label="คงเหลือเดิม">
        <span class="qty-val">—</span>
        <span class="qty-label" hidden></span>
      </div>
      <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวนรับเข้า" />
      <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
    `;

    const productSelect = row.querySelector('.product-select');

    productSelect.addEventListener('change', (event) => {
      updateInlineStock(event.currentTarget);
    });

    row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));

    container.appendChild(row);
    enhanceProductSelect(productSelect);
    row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));
    container.appendChild(row);
    enhanceProductSelect(row.querySelector('.product-select'));
    return;
  }

  if (type === 'out') {
    row.innerHTML = `
      <select class="product-select" aria-label="เลือกรายการสินค้า">
        <option value=""></option>
        ${getProductOptions()}
      </select>
      <div class="inline-stock" aria-label="คงเหลือเดิม">
        <span class="qty-val">—</span>
        <span class="qty-label" hidden></span>
      </div>
      <input type="number" min="1" step="1" inputmode="numeric" pattern="[0-9]*" placeholder="จำนวน" aria-label="จำนวน" />
      <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
    `;

    const productSelect = row.querySelector('.product-select');

    productSelect.addEventListener('change', (event) => {
      updateStockInfo(event.currentTarget);
    });

    row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));

    container.appendChild(row);
    enhanceProductSelect(productSelect);
    return;
  }

  row.innerHTML = `
    <select class="product-select" aria-label="เลือกรายการสินค้า">
      <option value=""></option>
      ${getProductOptions()}
    </select>
    <input type="number" min="1" step="1" inputmode="numeric" pattern="[0-9]*" placeholder="จำนวน" aria-label="จำนวน" />
    <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
  `;

  const productSelect = row.querySelector('.product-select');

  productSelect.addEventListener('change', (event) => {
    if (type === 'transfer') updateTransferStockInfo(event.currentTarget);
    else updateStockInfo(event.currentTarget);
  });

  row.querySelector('.btn-remove-row').addEventListener('click', (event) => removeRow(event.currentTarget));

  container.appendChild(row);
  enhanceProductSelect(productSelect);
  if (type === 'transfer' && typeof updateTransferConversionMode === 'function') {
    updateTransferConversionMode();
  }

  const info = document.createElement('div');
  info.className = 'stock-info';
  info.innerHTML = `คงเหลือ: <span class="val">—</span>`;
  container.appendChild(info);
}

function enhanceProductSelect(select) {
  if (!select || select.tomselect) return;

  const ts = new TomSelect(select, {
    create: false,
    allowEmptyOption: false,
    maxOptions: 50,
    dropdownParent: 'body',
    placeholder: '— เลือกรายการสินค้า —',
    onDropdownOpen: function () {
      positionTomSelectDropdown(this);
    },
  });

  ts.control_input.setAttribute('placeholder', '— เลือกรายการสินค้า —');
}

function positionTomSelectDropdown(ts) {
  if (!ts || !ts.dropdown || !ts.control) return;

  requestAnimationFrame(() => {
    const controlRect = ts.control.getBoundingClientRect();
    const dropdown = ts.dropdown;

    const spaceBelow = window.innerHeight - controlRect.bottom;
    const maxDropdownHeight = Math.max(160, Math.min(280, spaceBelow - 12));

    dropdown.style.position = 'absolute';
    dropdown.style.left = `${controlRect.left + window.scrollX}px`;
    dropdown.style.width = `${controlRect.width}px`;
    dropdown.style.zIndex = '9999';
    dropdown.style.top = `${controlRect.bottom + window.scrollY + 6}px`;
    dropdown.style.maxHeight = `${maxDropdownHeight}px`;
    dropdown.style.overflowY = 'auto';
  });
}

function updateStockInfo(select) {
  const row = select.closest('.product-row');
  const next = row?.nextElementSibling;
  const inlineBadge = row?.querySelector('.inline-stock');

  const product = select.value;
  if (!product) {
    if (inlineBadge) {
      const valEl = inlineBadge.querySelector('.qty-val');
      if (valEl) {
        valEl.textContent = '—';
        valEl.className = 'qty-val';
      }
      if (typeof setInlineStockUnit === 'function') {
        setInlineStockUnit(inlineBadge, '');
      }
    }

    if (next?.classList.contains('stock-info')) {
      next.style.display = 'none';
    }

    return;
  }

  const center = document.getElementById('out-center')?.value;
  const qty = typeof getStockQty === 'function'
    ? getStockQty(center, product)
    : ((getStockForCenter('out') || {})[product] || 0);
  const cls = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';
  const unit = typeof getStockUnit === 'function' ? getStockUnit(center, product) : '';

  if (inlineBadge) {
    const valEl = inlineBadge.querySelector('.qty-val');
    if (valEl) {
      valEl.textContent = qty;
      valEl.className = `qty-val ${cls}`;
    }
    if (typeof setInlineStockUnit === 'function') {
      setInlineStockUnit(inlineBadge, unit);
    }
    return;
  }

  if (!next || !next.classList.contains('stock-info')) return;

  const qtyText = typeof getStockQtyWithUnit === 'function'
    ? getStockQtyWithUnit(center, product, qty)
    : String(qty);

  next.style.display = 'flex';
  next.innerHTML = `สินค้า: <strong>${escapeHtml(product)}</strong> <span aria-hidden="true">|</span> คงเหลือ: <span class="val ${cls}">${escapeHtml(qtyText)}</span>`;
}

function clearRequestStatusBadge() {
  localStorage.setItem('request_status_seen_at', new Date().toISOString());

  const badge = document.querySelector(
    '#tab-request-status .badge, #tab-request-status .tab-badge, #tab-request-status .segment-badge'
  );

  if (badge) {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}
