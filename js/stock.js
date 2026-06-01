let pendingPoSummary = {};

const STOCK_VIEW_RULES = {
  'ไตบน': {
    products: [],
    levels: {},
  },
  'ไตล่าง': {
    products: [],
    levels: {},
  },
  'ไตดี': {
    products: [],
    levels: {},
  },
};

let stockMinMaxFromSupabase = {};

function setStockUnit(center, product, unit) {
  const normalizedUnit = String(unit || '').trim();
  if (!center || !product || !normalizedUnit) return;

  if (!localStockUnits[center]) {
    localStockUnits[center] = {};
  }

  localStockUnits[center][product] = normalizedUnit;
}

function setStockProductType(center, product, type) {
  const normalizedType = String(type || '').trim();
  if (!center || !product || !normalizedType) return;

  if (!localStockTypes[center]) {
    localStockTypes[center] = {};
  }

  localStockTypes[center][product] = normalizedType;
}

function getStockProductType(center, product) {
  const type = String(localStockTypes?.[center]?.[product] || '').trim();
  if (type || !product) return type;

  const normalizedProduct = normalizeProductKey(product);
  const matchedTypeProduct = Object.keys(localStockTypes?.[center] || {})
    .find((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct);

  if (matchedTypeProduct) {
    return String(localStockTypes[center][matchedTypeProduct] || '').trim();
  }

  const matchedCenter = Object.keys(localStockTypes || {})
    .find((stockCenter) => Object.keys(localStockTypes?.[stockCenter] || {})
      .some((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct));

  if (!matchedCenter) return '';

  const matchedProduct = Object.keys(localStockTypes?.[matchedCenter] || {})
    .find((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct);

  return matchedProduct ? String(localStockTypes[matchedCenter][matchedProduct] || '').trim() : '';
}

function getStockUnit(center, product) {
  const unit = String(localStockUnits?.[center]?.[product] || '').trim();
  if (unit || !product) return unit;

  const normalizedProduct = normalizeProductKey(product);
  const normalizedUnitProduct = Object.keys(localStockUnits?.[center] || {})
    .find((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct);

  if (normalizedUnitProduct) {
    return String(localStockUnits[center][normalizedUnitProduct] || '').trim();
  }

  const matchedCenter = Object.keys(localStockUnits || {})
    .find((stockCenter) => Object.keys(localStockUnits?.[stockCenter] || {})
      .some((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct));

  if (!matchedCenter) return '';

  const matchedProduct = Object.keys(localStockUnits?.[matchedCenter] || {})
    .find((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct);

  return matchedProduct ? String(localStockUnits[matchedCenter][matchedProduct] || '').trim() : '';
}

function getStockQtyWithUnit(center, product, qty) {
  const unit = getStockUnit(center, product);
  return unit ? `${qty} ${unit}` : String(qty);
}

function normalizeProductKey(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findStockProductKey(center, product) {
  const stock = localStock?.[center] || {};
  if (Object.prototype.hasOwnProperty.call(stock, product)) return product;

  const normalizedProduct = normalizeProductKey(product);
  return Object.keys(stock)
    .find((stockProduct) => normalizeProductKey(stockProduct) === normalizedProduct)
    || product;
}

function getStockWriteProductKey(center, product) {
  const matchedProduct = findStockProductKey(center, product);
  return Object.prototype.hasOwnProperty.call(localStock?.[center] || {}, matchedProduct)
    ? matchedProduct
    : product;
}

function getStockQty(center, product) {
  const stockProduct = findStockProductKey(center, product);
  return Number(localStock?.[center]?.[stockProduct] || 0);
}

function getPendingPoQty(product) {
  if (Object.prototype.hasOwnProperty.call(pendingPoSummary || {}, product)) {
    return Number(pendingPoSummary[product] || 0);
  }

  const normalizedProduct = normalizeProductKey(product);
  const matchedProduct = Object.keys(pendingPoSummary || {})
    .find((poProduct) => normalizeProductKey(poProduct) === normalizedProduct);

  return matchedProduct ? Number(pendingPoSummary[matchedProduct] || 0) : 0;
}

function setInlineStockUnit(badge, unit) {
  const labelEl = badge?.querySelector('.qty-label');
  if (!labelEl) return;

  labelEl.textContent = unit || '';
  labelEl.hidden = !unit;
}

function setStockMinMaxFromSupabase(center, product, minQty, maxQty) {
  if (!center || !product) return;

  if (!stockMinMaxFromSupabase[center]) {
    stockMinMaxFromSupabase[center] = {};
  }

  stockMinMaxFromSupabase[center][product] = {
    min: minQty,
    max: maxQty,
  };
}

function getStockViewRule(center) {
  return STOCK_VIEW_RULES[center] || { products: [], levels: {} };
}

function getStockMinMax(center, product) {
  const rule = getStockViewRule(center);
  const normalizedProduct = normalizeProductKey(product);
  const stockLevelProduct = Object.keys(stockMinMaxFromSupabase?.[center] || {})
    .find((itemProduct) => normalizeProductKey(itemProduct) === normalizedProduct);
  const ruleLevelProduct = Object.keys(rule.levels || {})
    .find((itemProduct) => normalizeProductKey(itemProduct) === normalizedProduct);
  const level = stockMinMaxFromSupabase?.[center]?.[stockLevelProduct]
    || rule.levels?.[ruleLevelProduct]
    || {};
  const min = Number(level.min);
  const max = Number(level.max);

  return {
    min: Number.isFinite(min) && min > 0 ? min : '',
    max: Number.isFinite(max) && max > 0 ? max : '',
  };
}

function getTransferTrendQty(center, product) {
  const normalizedProduct = normalizeProductKey(product);

  return (stockViewTransfers || []).reduce((total, transfer) => {
    const items = normalizeItems(transfer.items);
    const qty = items
      .filter((item) => normalizeProductKey(item.product) === normalizedProduct)
      .reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

    if (!qty) return total;
    if (transfer.toCenter === center) return total + qty;
    if (transfer.fromCenter === center) return total - qty;
    return total;
  }, 0);
}

function getStockOrderMessage(center, product, currentQty) {
  const { min, max } = getStockMinMax(center, product);
  if (min === '' || max === '') return '';

  const projectedQty = Number(currentQty || 0) + getTransferTrendQty(center, product);
  return projectedQty < min ? 'สินค้าต้องเปิด PO' : '';
}

function getAutoPoQty(center, product, currentQty) {
  const { min, max } = getStockMinMax(center, product);
  if (min === '' || max === '') return 0;

  const projectedQty = Number(currentQty || 0) + getTransferTrendQty(center, product);
  if (projectedQty >= min) return 0;

  return Math.max(1, Math.ceil(max - projectedQty));
}

function getStockProductsForCenter(center, productList) {
  const allowedProducts = getStockViewRule(center).products || [];
  if (!allowedProducts.length) return productList;
  return productList.filter((product) => allowedProducts.includes(product));
}

function getStockDashboardProducts(stockCenters, primaryCenter, selectedProduct) {
  let productList = [
    ...stockCenters.flatMap((center) => Object.keys(localStock[center] || {})),
    ...Object.keys(pendingPoSummary || {})
  ];

  const configuredProducts = getStockViewRule(primaryCenter).products || [];
  if (configuredProducts.length) {
    productList.push(...configuredProducts);
  }

  productList = [...new Set(productList)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'th'));

  if (selectedProduct) {
    const normalizedSelectedProduct = normalizeProductKey(selectedProduct);
    productList = productList.filter((product) => normalizeProductKey(product) === normalizedSelectedProduct);
  }

  if (currentUser?.role === 'center_staff' && primaryCenter) {
    productList = getStockProductsForCenter(primaryCenter, productList);
  }

  return productList;
}

function getStockDashboardCenters(selectedCenter) {
  const stockCenters = getAllStockCenters();
  return selectedCenter
    ? stockCenters.filter((center) => center === selectedCenter)
    : stockCenters;
}

function getStockTransferFilterCenter() {
  if (currentUser?.role === 'center_staff' && currentUser.center) {
    return currentUser.center;
  }

  return getStockCenterFilter();
}

// =====================
// PRODUCT ROWS
// =====================
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
    setInlineStockUnit(badge, '');
    return;
  }

  const center = document.getElementById('in-center')?.value;
  const qty = getStockQty(center, product);
  const unit = getStockUnit(center, product);

  valEl.textContent = qty;
  valEl.className = `qty-val${qty <= 0 ? ' empty' : qty <= 5 ? ' low' : ''}`;
  setInlineStockUnit(badge, unit);
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
  const qty = getStockQty(fromCenter, product);
  const cls = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';
  const qtyText = getStockQtyWithUnit(fromCenter, product, qty);

  next.style.display = 'flex';
  next.innerHTML = `ต้นทาง: <strong>${escapeHtml(fromCenter)}</strong> <span aria-hidden="true">|</span> ${escapeHtml(product)} คงเหลือ: <span class="val ${cls}">${escapeHtml(qtyText)}</span>`;
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

    await refreshAppDataAfterAction();
    formRequestIds.in = newRequestId('in');
    resetForm('in');

  } catch (error) {
    console.error('Supabase stock_in error:', error);
    showToast(`❌ ${error.message || 'บันทึกรับเข้าไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function updateLocalStock(type, center, items) {
  if (!localStock[center]) localStock[center] = {};

  items.forEach(({ product, qty }) => {
    const stockProduct = getStockWriteProductKey(center, product);
    const currentQty = Number(localStock[center][stockProduct] || 0);
    localStock[center][stockProduct] = type === 'in'
      ? currentQty + qty
      : Math.max(0, currentQty - qty);
  });

  refreshInBadges();
  refreshOutInfo();
  refreshTransferInfo();

  if (typeof renderStockDashboard === 'function') {
    renderStockDashboard();
  }

  if (typeof renderHubStockDashboard === 'function') {
    renderHubStockDashboard();
  }

  // Do not persist optimistic local changes. Supabase fetch is the source of truth.
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

function getStockCenterFilter() {
  return document.getElementById('stock-center-filter')?.value || '';
}

function getStockProductFilter() {
  const value = document.getElementById('stock-product-filter')?.value || '';
  return value === '__all__' ? '' : value;
}

function getStockProductTypeFilter() {
  return document.getElementById('stock-product-type-filter')?.value || '';
}

function getAllStockCenters() {
  const configuredCenters = Array.isArray(window.CENTERS) ? window.CENTERS : [];
  const stockCenters = Object.keys(localStock || {}).map((center) => (
    typeof normalizeCenterName === 'function' ? normalizeCenterName(center) : center
  ));

  return [...new Set([...configuredCenters, ...stockCenters])]
    .filter(Boolean);
}

function renderStockDashboard() {
  const box = document.getElementById('stock-dashboard-grid');
  if (!box) return;

  try {
    const selectedCenter = document.getElementById('stock-center-filter')?.value || '';
    const selectedProduct = getStockProductFilter();
    const selectedProductType = getStockProductTypeFilter();

    const stockCenters = getStockDashboardCenters(selectedCenter);
    const primaryCenter = stockCenters[0] || currentUser?.center || selectedCenter || '';

    let productList = getStockDashboardProducts(stockCenters, primaryCenter, selectedProduct);
    if (selectedProductType) {
      const normalizedType = normalizeProductKey(selectedProductType);
      productList = productList.filter((product) => (
        normalizeProductKey(getStockProductType(primaryCenter, product)) === normalizedType
      ));
    }

    if (productList.length === 0) {
      box.innerHTML = '<div class="empty-state">ไม่พบรายการสินค้า</div>';
      return;
    }

    let columns = [];

    if (stockCenters.length === 1 && primaryCenter) {
      columns = [
        {
          key: `stock-${primaryCenter}`,
          label: primaryCenter,
          className: primaryCenter === 'Hub Admin' ? 'stock-col-hub' : 'stock-col-main',
          getValue: (product) => getStockQty(primaryCenter, product)
        },
        {
          key: 'min',
          label: 'Min',
          className: 'stock-col-minmax',
          getValue: (product) => getStockMinMax(primaryCenter, product).min
        },
        {
          key: 'max',
          label: 'Max',
          className: 'stock-col-minmax',
          getValue: (product) => getStockMinMax(primaryCenter, product).max
        },
        {
          key: 'order',
          label: 'สั่งสินค้า',
          className: 'stock-col-order',
          getValue: (product) => {
            const currentQty = getStockQty(primaryCenter, product);
            return getStockOrderMessage(primaryCenter, product, currentQty);
          }
        },
      ];
    } else {
      stockCenters.forEach((center) => {
        columns.push({
          key: `stock-${center}`,
          label: center,
          className: center === 'Hub Admin' ? 'stock-col-hub' : 'stock-col-main',
          getValue: (product) => getStockQty(center, product)
        });
      });
    }

    // เปิด PO ให้อยู่ช่องสุดท้ายเสมอ
    columns.push({
      key: 'po',
      label: 'เปิด PO',
      className: 'stock-col-po',
      getValue: (product) => getPendingPoQty(product)
    });

    const gridTemplate = `repeat(${columns.length}, minmax(120px, 1fr))`;

    const fixedRows = productList.map((product) => `
      <div class="stock-fixed-cell stock-product-name">${escapeHtml(product)}</div>
    `).join('');

    const scrollHead = `
      <div class="stock-scroll-head stock-scroll-row" style="grid-template-columns: ${gridTemplate};">
        ${columns.map((col) => `<div>${escapeHtml(col.label)}</div>`).join('')}
      </div>
    `;

    const scrollRows = productList.map((product) => `
      <div class="stock-scroll-row" style="grid-template-columns: ${gridTemplate};">
        ${columns.map((col) => `
          <div class="${col.className}">
            ${col.getValue(product)}
          </div>
        `).join('')}
      </div>
    `).join('');

    box.innerHTML = `
      <div class="stock-split-table" style="--stock-col-count: ${columns.length};">
        <div class="stock-fixed-side">
          <div class="stock-fixed-head">รายการสินค้า</div>
          ${fixedRows}
        </div>

        <div class="stock-scroll-side">
          <div class="stock-scroll-inner">
            ${scrollHead}
            ${scrollRows}
          </div>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('renderStockDashboard error:', error);
    box.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message || 'แสดง Stock ไม่สำเร็จ')}</div>`;
  }
}

async function fetchStockViewTransfers() {
  const box = document.getElementById('stock-transfer-list');

  const selectedCenter = getStockTransferFilterCenter();

  if (box) {
    box.innerHTML = '<div class="empty-state">กำลังโหลดรายการ Transfer...</div>';
  }

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
    renderStockDashboard();

  } catch (error) {
    console.error('Stock view transfer error:', error);
    stockViewTransfers = [];
    if (box) {
      box.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message || 'โหลดรายการ Transfer ไม่สำเร็จ')}</div>`;
    }
  }
}

async function refreshStockViewOnly() {
  const button = document.getElementById('btn-refresh-stock-view');
  if (button) button.disabled = true;

  try {
    if (typeof fetchFreshStock === 'function') {
      await fetchFreshStock();
    } else if (typeof fetchStock === 'function') {
      await fetchStock();
    }

    if (typeof fetchPendingPoSummary === 'function') {
      await fetchPendingPoSummary();
    }

    if (typeof fetchStockViewTransfers === 'function') {
      await fetchStockViewTransfers();
    }

    renderStockDashboard();
    showToast('✅ รีเฟรชสต็อกแล้ว', 'success');
  } catch (error) {
    console.error('refreshStockViewOnly error:', error);
    showToast(`❌ ${error.message || 'รีเฟรชสต็อกไม่สำเร็จ'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function getAutoPoItemsFromStockView() {
  const selectedCenter = document.getElementById('stock-center-filter')?.value || '';
  const selectedProduct = getStockProductFilter();
  const stockCenters = getStockDashboardCenters(selectedCenter);
  const primaryCenter = stockCenters[0] || currentUser?.center || selectedCenter || '';

  if (!primaryCenter || stockCenters.length !== 1) {
    return {
      center: '',
      items: [],
      message: 'กรุณาเลือกศูนย์เดียวก่อนเปิด PO อัตโนมัติ',
    };
  }

  const productList = getStockDashboardProducts(stockCenters, primaryCenter, selectedProduct);
  const items = productList.map((product) => {
    const currentQty = getStockQty(primaryCenter, product);
    const qty = getAutoPoQty(primaryCenter, product, currentQty);
    return { product, qty };
  }).filter((item) => item.product && item.qty > 0);

  return {
    center: primaryCenter,
    items,
    message: items.length ? '' : 'ยังไม่มีสินค้าที่ต้องเปิด PO',
  };
}

function setPoSelectValue(select, value) {
  if (!select) return;

  if (select.tomselect) {
    select.tomselect.setValue(value, true);
    return;
  }

  select.value = value;
}

function fillPoFormFromStockItems(center, items) {
  if (typeof renderPoCmoForm === 'function') {
    renderPoCmoForm();
  }

  const poCenter = document.getElementById('po-center');
  if (poCenter) {
    poCenter.value = center;
  }

  const poPerson = document.getElementById('po-person');
  if (poPerson && !poPerson.value.trim()) {
    poPerson.value = currentUser?.name || currentUser?.code || '';
  }

  const poNote = document.getElementById('po-note');
  if (poNote && !poNote.value.trim()) {
    poNote.value = 'เปิด PO อัตโนมัติจากหน้า Stock';
  }

  const container = document.getElementById('po-products');
  if (!container) return;

  container.innerHTML = '';

  items.forEach((item) => {
    addPoRow();
    const row = container.querySelector('.product-row:last-child');
    setPoSelectValue(row?.querySelector('select'), item.product);

    const qtyInput = row?.querySelector('input[type="number"]');
    if (qtyInput) {
      qtyInput.value = item.qty;
    }
  });
}

function openAutoPoFromStock() {
  if (typeof canAccessTab === 'function' && !canAccessTab('transfer')) {
    showToast('⚠️ ผู้ใช้นี้ไม่มีสิทธิ์เปิด PO', 'error');
    return;
  }

  const { center, items, message } = getAutoPoItemsFromStockView();

  if (!items.length) {
    showToast(`⚠️ ${message}`, 'error');
    return;
  }

  if (typeof showTab === 'function') {
    showTab('transfer');
  } else {
    switchTab('transfer');
  }

  const transferPanel = document.getElementById('panel-transfer');
  if (transferPanel) {
    transferPanel.hidden = false;
    transferPanel.classList.add('is-active');
  }

  fillPoFormFromStockItems(center, items);
  showToast(`✅ เตรียมรายการเปิด PO อัตโนมัติ ${items.length} รายการแล้ว`, 'success');
}

function printStockView() {
  const stockSection = document.querySelector('#panel-stock .stock-view-section');
  if (!stockSection) return;

  const printWindow = window.open('', '_blank', 'width=1100,height=780');
  if (!printWindow) {
    showToast('⚠️ กรุณาอนุญาต Pop-up เพื่อปริ้นท์สต็อก', 'error');
    return;
  }

  const printedAt = new Date().toLocaleString('th-TH');
  const center = currentUser?.role === 'center_staff'
    ? currentUser.center
    : (document.getElementById('stock-center-filter')?.value || 'ทุกสต็อก');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>สต็อกคงเหลือ</title>
      <style>
        body {
          margin: 24px;
          color: #111827;
          font-family: Arial, sans-serif;
        }
        h1 {
          margin: 0 0 6px;
          font-size: 22px;
        }
        .print-meta {
          margin-bottom: 16px;
          color: #64748b;
          font-size: 13px;
        }
        .products-header,
        .stock-header-actions {
          display: none !important;
        }
        .stock-split-table {
          width: 100%;
          display: grid;
          grid-template-columns: 190px 1fr;
          border: 1px solid #d1d5db;
          border-radius: 0;
          overflow: hidden;
        }
        .stock-scroll-inner {
          min-width: 0 !important;
          width: 100%;
        }
        .stock-scroll-row {
          display: grid;
          grid-template-columns: repeat(var(--stock-col-count, 5), minmax(95px, 1fr)) !important;
        }
        .stock-fixed-head,
        .stock-fixed-cell,
        .stock-scroll-row > div {
          min-height: 48px;
          box-sizing: border-box;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          border-bottom: 1px solid #d1d5db;
          font-size: 12px;
          font-weight: 700;
        }
        .stock-fixed-head,
        .stock-scroll-head > div {
          background: #f1f5f9;
        }
        .stock-scroll-row > div {
          justify-content: center;
          text-align: center;
          border-left: 1px solid #e5e7eb;
        }
        .stock-col-order {
          white-space: normal !important;
          color: #b45309;
        }
      </style>
    </head>
    <body>
      <h1>สต็อกคงเหลือ</h1>
      <div class="print-meta">ศูนย์: ${escapeHtml(center)} | พิมพ์เมื่อ: ${escapeHtml(printedAt)}</div>
      ${stockSection.innerHTML}
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderStockViewTransfers() {
  const box = document.getElementById('stock-transfer-list');
  if (!box) return;

  const selectedProduct = getStockProductFilter();

  const filteredTransfers = stockViewTransfers
    .map((transfer) => {
      const items = normalizeItems(transfer.items);
      const normalizedSelectedProduct = normalizeProductKey(selectedProduct);
      const filteredItems = selectedProduct
        ? items.filter((item) => normalizeProductKey(item.product) === normalizedSelectedProduct)
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

function renderHubStockDashboard() {
  const box = document.getElementById('hub-stock-dashboard');
  if (!box) return;

  const selectedProduct = document.getElementById('hub-product-filter')?.value || '';
  const productsToShow = selectedProduct ? [selectedProduct] : PRODUCTS;

  box.innerHTML = `
    <div class="hub-stock-table">
      <div class="hub-stock-head">
        <span>รายการสินค้า</span>
        <span class="hub-stock-head-qty">จำนวน</span>
      </div>

      ${productsToShow.map((product) => {
        const qty = getStockQty('Hub Admin', product);
        const statusClass = qty <= 0 ? 'empty' : qty <= 5 ? 'low' : 'ok';

        return `
          <div class="hub-stock-row">
            <div class="hub-stock-name">${escapeHtml(product)}</div>
            <div class="hub-stock-qty ${statusClass}">${qty}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

