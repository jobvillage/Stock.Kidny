let pendingPoSummary = {};

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
    return;
  }

  const stock = getStockForCenter('in');
  const qty = stock[product] || 0;

  valEl.textContent = qty;
  valEl.className = `qty-val${qty <= 0 ? ' empty' : qty <= 5 ? ' low' : ''}`;
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

function getStockCenterFilter() {
  return document.getElementById('stock-center-filter')?.value || '';
}

function getStockProductFilter() {
  return document.getElementById('stock-product-filter')?.value || '';
}

function renderStockDashboard() {
  const box = document.getElementById('stock-dashboard-grid');
  if (!box) return;

  const selectedProduct = document.getElementById('stock-product-filter')?.value || '';
  const productsToShow = selectedProduct ? [selectedProduct] : PRODUCTS;

  const hubStock = localStock['Hub Admin'] || {};
  const mainStock = localStock['สต็อกใหญ่'] || {};

  const rows = productsToShow.map((product) => {
    const hubQty = Number(hubStock[product]) || 0;
    const mainQty = Number(mainStock[product]) || 0;
    const poQty = Number(pendingPoSummary[product]) || 0;

    return `
      <div class="stock-table-row">
        <div class="stock-table-product">${escapeHtml(product)}</div>
        <div class="stock-table-qty">${hubQty}</div>
        <div class="stock-table-qty">${mainQty}</div>
        <div class="stock-table-po">${poQty}</div>
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div class="stock-table-main">
      <div class="stock-table-head">
        <div>รายการสินค้า</div>
        <div>Hub Admin</div>
        <div>สต็อกใหญ่</div>
        <div>เปิด PO</div>
      </div>

      ${rows}
    </div>
  `;
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

function renderHubStockDashboard() {
  const box = document.getElementById('hub-stock-dashboard');
  if (!box) return;

  const selectedProduct = document.getElementById('hub-product-filter')?.value || '';
  const productsToShow = selectedProduct ? [selectedProduct] : PRODUCTS;

  const hubStock = localStock['Hub Admin'] || {};

  box.innerHTML = `
    <div class="hub-stock-table">
      <div class="hub-stock-head">
        <span>รายการสินค้า</span>
        <span class="hub-stock-head-qty">จำนวน</span>
      </div>

      ${productsToShow.map((product) => {
        const qty = Number(hubStock[product]) || 0;
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