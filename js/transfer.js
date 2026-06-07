async function submitTransfer() {
  if (!requirePermission('transfer')) return;

  const btn = document.getElementById('btn-transfer') || document.querySelector('[data-submit="transfer"]');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('transfer-date').value;
  const fromCenter = document.getElementById('transfer-from-center').value;
  const toCenter = document.getElementById('transfer-to-center').value;
  const note = document.getElementById('transfer-note').value.trim();
  const requestId = newRequestId('transfer');
  formRequestIds.transfer = requestId;
  const convertFromProduct = document.getElementById('transfer-convert-from')?.value || '';
  const convertToProduct = document.getElementById('transfer-convert-to')?.value || '';
  const isProductConversion = Boolean(convertFromProduct || convertToProduct);

  if (!date || !fromCenter || !toCenter) {
    showToast('⚠️ กรุณากรอกวันที่ ศูนย์ต้นทาง และศูนย์ปลายทาง', 'error');
    return;
  }

  if (fromCenter === toCenter && !isProductConversion) {
    showToast('⚠️ ศูนย์ต้นทางและปลายทางต้องไม่ใช่ศูนย์เดียวกัน', 'error');
    return;
  }

  if (!enforceOwnCenter('transfer', fromCenter)) return;

  const rows = document.querySelectorAll('#transfer-products .product-row');
  let items = collectItemsFromRows(rows);

  if (isProductConversion) {
    if (!convertFromProduct || !convertToProduct) {
      showToast('⚠️ กรุณาเลือกสินค้าให้ครบทั้งช่องแปลงจากและแปลงเป็น', 'error');
      return;
    }

    if (convertFromProduct === convertToProduct) {
      showToast('⚠️ สินค้าที่แปลงจากและแปลงเป็นต้องไม่ใช่รายการเดียวกัน', 'error');
      return;
    }

    let invalidQty = false;
    const totalQty = Array.from(rows).reduce((sum, row) => {
      const qtyText = String(row.querySelector('input[type=number]')?.value || '').trim();
      if (!qtyText) return sum;
      if (!/^\d+$/.test(qtyText)) {
        invalidQty = true;
        return sum;
      }
      return sum + Number(qtyText || 0);
    }, 0);

    if (invalidQty) {
      showToast('⚠️ กรุณากรอกจำนวนเป็นเลขจำนวนเต็มเท่านั้น', 'error');
      return;
    }

    items = totalQty > 0
      ? [{ product: convertFromProduct, qty: totalQty, target_product: convertToProduct, targetProduct: convertToProduct }]
      : [];
  }

  if (fromCenter === toCenter && isProductConversion) {
    items = items.map((item) => ({
      ...item,
      target_product: item.target_product || item.targetProduct || convertToProduct,
      targetProduct: item.targetProduct || item.target_product || convertToProduct,
    }));
  }

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
    const isImmediateTransfer = ['admin', 'adminR'].includes(currentUser?.role);
    const rpcName = isImmediateTransfer ? 'transfer_stock_now' : 'create_transfer';
    const { data, error } = await supabaseClient.rpc(rpcName, {
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
    if (isImmediateTransfer) {
      const targetItems = items.map((item) => ({
        product: item.target_product || item.targetProduct || item.product,
        qty: item.qty,
      }));
      updateLocalStock('in', toCenter, targetItems);
    }

    showToast(
      isImmediateTransfer
        ? '✅ Transfer สำเร็จ สต็อกปลายทางถูกเพิ่มแล้ว'
        : '✅ สร้าง Transfer แล้ว รอศูนย์ปลายทางกดยืนยันรับ',
      'success'
    );

    formRequestIds.transfer = newRequestId('transfer');
    resetTransferForm();

    if (typeof refreshAppDataAfterAction === 'function') {
      await refreshAppDataAfterAction();
    } else {
      if (canAccessTab('pending')) {
        await fetchPendingTransfers();
      }

      if (typeof fetchFreshStock === 'function') {
        await fetchFreshStock();
      } else if (typeof fetchStock === 'function') {
        await fetchStock();
      }
    }

  } catch (error) {
    console.error('Supabase transfer error:', error);
    showToast(`❌ ${error.message || 'สร้าง Transfer ไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

const PO_CENTER_CACHE_KEY = 'po_center_cache_v1';
const PO_EMAIL_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycby6HftKeGFb0nrEYydWwH4Ps98patvyHfmGX0q1v5acpKSeqiuW9e5p_RIg0Qucz0K5rw/exec';

function getPoCenterCache() {
  try {
    return JSON.parse(localStorage.getItem(PO_CENTER_CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function savePoCenterToCache(poId, center) {
  if (!poId || !center) return;

  const cache = getPoCenterCache();
  cache[poId] = center;
  localStorage.setItem(PO_CENTER_CACHE_KEY, JSON.stringify(cache));
}

function buildPoEmailPayload(po) {
  return {
    po_id: po.po_id || po.po_no || po.po_number || '',
    po_date: po.po_date || '',
    po_person: po.po_person || '',
    center: getPoCenter(po),
    note: po.note || '',
    status: po.status || '',
    items: Array.isArray(po.items) ? po.items : [],
    sent_by_code: currentUser?.code || '',
    sent_by_name: currentUser?.name || currentUser?.code || '',
  };
}

async function sendPoEmail(poId, button) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);

  if (!po) {
    showToast('❌ ไม่พบข้อมูล PR นี้', 'error');
    return;
  }

  if (!PO_EMAIL_WEB_APP_URL) {
    showToast('⚠️ ยังไม่ได้ตั้งค่า Apps Script สำหรับส่งอีเมล PR', 'error');
    return;
  }

  const targetButton = button || document.querySelector(`[data-email-po-id="${CSS.escape(poId)}"]`);
  if (targetButton?.disabled) return;

  if (targetButton) {
    targetButton.disabled = true;
    targetButton.classList.add('is-sending');
    targetButton.innerHTML = '<span>📧</span><span>กำลังส่ง...</span>';
  }

  showToast('', 'loading', 'กำลังส่งอีเมล PR...');

  try {
    await fetch(PO_EMAIL_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(buildPoEmailPayload(po)),
    });

    if (targetButton) {
      targetButton.innerHTML = '<span>📧</span><span>ส่งอีกครั้ง</span>';
      targetButton.classList.add('is-sent');
    }

    showToast('✅ ส่งคำขออีเมล PR แล้ว', 'success');
  } catch (error) {
    console.error('send_po_email error:', error);
    if (targetButton) {
      targetButton.innerHTML = '<span>📧</span><span>ส่งอีเมล PR</span>';
    }
    showToast(`❌ ${error.message || 'ส่งอีเมล PR ไม่สำเร็จ'}`, 'error');
  } finally {
    if (targetButton) {
      targetButton.disabled = false;
      targetButton.classList.remove('is-sending');
    }
  }
}

function resetTransferForm() {
  const productContainer = document.getElementById('transfer-products');
  productContainer.innerHTML = '';
  addProductRow('transfer');

  document.getElementById('transfer-person').value = `${currentUser.name} (${currentUser.code})`;
  document.getElementById('transfer-note').value = '';
  document.getElementById('transfer-to-center').value = '';
  ['transfer-convert-from', 'transfer-convert-to'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    if (select.tomselect) select.tomselect.clear(true);
    select.value = '';
    if (select.tomselect) {
      select.tomselect.control_input.setAttribute('placeholder', '— เลือกรายการสินค้า —');
    }
  });
  updateTransferConversionMode();
  setToday('transfer-date');

  if (currentUser.role === 'center_staff') {
    lockSelectToValue('transfer-from-center', currentUser.center);
  }

  filterTransferTargetCenters();
  refreshTransferInfo();
}

function updateTransferConversionMode() {
  const isConverting = Boolean(
    document.getElementById('transfer-convert-from')?.value
    || document.getElementById('transfer-convert-to')?.value
  );

  document.querySelectorAll('#transfer-products .product-row.row-transfer').forEach((row) => {
    const select = row.querySelector('.product-select');
    if (!select) return;

    if (isConverting) {
      if (select.tomselect) {
        select.tomselect.clear(true);
        select.tomselect.disable();
      } else {
        select.value = '';
        select.disabled = true;
      }
      select.classList.add('is-locked');
      return;
    }

    if (select.tomselect) {
      select.tomselect.enable();
    } else {
      select.disabled = false;
    }
    select.classList.remove('is-locked');
  });
}

// =====================
// PENDING TRANSFERS
// =====================
function getPickStockLocations() {
  const locations = Array.isArray(window.CENTERS) && window.CENTERS.length
    ? window.CENTERS
    : ['Hub Admin', 'สต็อกใหญ่'];

  return [...new Set(locations)].filter(Boolean);
}

function renderPickLocationOptions(selectedValue = 'สต็อกใหญ่') {
  return getPickStockLocations().map((center) => `
    <option value="${escapeHtml(center)}"${center === selectedValue ? ' selected' : ''}>
      ${escapeHtml(center)}
    </option>
  `).join('');
}

function renderPendingTransfers(errorMessage = '') {
  const box = document.getElementById('pending-transfers');
  const badge = document.getElementById('pending-badge');

  if (!box) return;

  if (badge) {
    badge.hidden = pendingTransfers.length === 0;
    badge.textContent = pendingTransfers.length;
  }

  if (errorMessage) {
    box.innerHTML = `<div class="empty-state">❌ ${escapeHtml(errorMessage)}</div>`;
    return;
  }

  if (!pendingTransfers.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีรายการขอเบิก</div>';
    return;
  }

  box.innerHTML = pendingTransfers.map((request) => {
    const canRequestTransfer = Boolean(request.center);
    const editRequestButton = `
        <button
          class="btn-po-edit request-edit-inline"
          type="button"
          onclick="enableStockRequestEdit('${escapeHtml(request.requestId || '')}')"
        >
          แก้ไข
        </button>
      `;
    const transferToCenterButton = canRequestTransfer
      ? `
        <button
          class="btn-request-secondary request-transfer-inline"
          type="button"
          onclick="toggleRequestTransferBox('${escapeHtml(request.requestId || '')}')"
        >
          Transfer
        </button>
      `
      : '';
    const requestEditedStamp = request.editedAt
      ? `
        <small class="request-edited-stamp">
          แก้ไขรายการโดย ${escapeHtml(request.editedByName || request.editedByCode || '-')}
          เมื่อ ${new Date(request.editedAt).toLocaleString('th-TH')}
        </small>
      `
      : '';

    const itemRows = (request.items || []).map((item, index) => {
      const product = item.product || '';
      const qty = Number(item.qty) || 0;
      const unit = String(
        item.Unit
        || item.unit
        || item.unit_name
        || (typeof getStockUnit === 'function' ? getStockUnit(request.center, product) : '')
        || ''
      ).trim();
      const qtyText = unit ? `${qty} ${unit}` : String(qty);
      const remainingQty = typeof getStockQty === 'function'
        ? getStockQty(request.center, product)
        : ((localStock[request.center] || {})[product] || 0);
      const remainingText = unit ? `${remainingQty} ${unit}` : String(remainingQty);

      return `
        <div class="pick-item-row">
          <div class="pick-item-name">
            <strong>${escapeHtml(product)}</strong>
            <small>จำนวนที่ขอ: ${escapeHtml(qtyText)} | คงเหลือ: ${escapeHtml(remainingText)}</small>
          </div>

          <div class="pick-item-source">
            <select
              class="pick-stock-location"
              data-request-id="${escapeHtml(request.requestId)}"
              data-product="${escapeHtml(product)}"
              data-index="${index}"
              aria-label="เลือกสต็อกที่จะตัด"
            >
              ${renderPickLocationOptions(item.source_center || item.sourceCenter || item.center || request.center || 'สต็อกใหญ่')}
            </select>
          </div>

          <div class="pick-item-qty">
            <label>จำนวนที่จัด</label>

            <div class="pick-qty-edit-row">
              <input 
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${qty}"
                readonly
                data-max="${qty}"
                data-request-id="${escapeHtml(request.requestId)}"
                data-product="${escapeHtml(product)}"
                data-index="${index}"
                class="prepared-qty-input"
                oninput="this.value = this.value.replace(/[^0-9]/g, '')"
              />

              <button 
                type="button"
                class="btn-edit-qty"
                onclick="togglePreparedQtyEdit(this)"
                aria-label="แก้ไขจำนวน"
                title="แก้ไขจำนวน"
              >
                ✎
              </button>
            </div>
          </div>
        </div>  
      `;
    }).join('');

    return `
      <article class="stock-request-card ${canRequestTransfer ? 'is-taidee-request' : ''}" data-request-id="${escapeHtml(request.requestId || '')}">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลขใบเบิก</span>
            <strong>${escapeHtml(request.requestId || '-')}</strong>
          </div>
          <div class="request-head-actions">
            ${editRequestButton}
            <span class="request-status-pill">รอดำเนินการ</span>
            ${transferToCenterButton}
            ${requestEditedStamp}
          </div>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เบิก</span>
            <strong>${escapeHtml(request.date || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์</span>
            <strong>${escapeHtml(request.center || '-')}</strong>
          </div>
          <div>
            <span>ผู้เบิก</span>
            <strong>${escapeHtml(request.staffName || request.staffCode || '-')}</strong>
          </div>
        </div>

        ${request.note ? `
          <div class="stock-request-note">
            <span>หมายเหตุ</span>
            <p>${escapeHtml(request.note)}</p>
          </div>
        ` : ''}

        ${canRequestTransfer ? `
          <div class="request-transfer-box" data-transfer-box="${escapeHtml(request.requestId || '')}" hidden>
            <div class="form-grid request-transfer-grid">
              <div class="field-group">
                <label for="request-transfer-from-${escapeHtml(request.requestId || '')}">จากสต็อก</label>
                <select id="request-transfer-from-${escapeHtml(request.requestId || '')}" class="request-transfer-from">
                  ${renderPickLocationOptions('สต็อกใหญ่')}
                </select>
              </div>

              <div class="field-group">
                <label for="request-transfer-to-${escapeHtml(request.requestId || '')}">ไปสต็อก</label>
                <select id="request-transfer-to-${escapeHtml(request.requestId || '')}" class="request-transfer-to">
                  ${renderPickLocationOptions(request.center || 'ไตดี')}
                </select>
              </div>
            </div>

            <div class="request-transfer-actions">
              <button
                class="btn-request-secondary request-transfer-cancel"
                type="button"
                onclick="toggleRequestTransferBox('${escapeHtml(request.requestId || '')}')"
              >
                ยกเลิก
              </button>
              <button
                class="btn-request-primary request-transfer-confirm"
                type="button"
                onclick="transferRequestItemsToCenter('${escapeHtml(request.requestId || '')}')"
              >
                ยืนยัน Transfer
              </button>
            </div>
          </div>
        ` : ''}

        <div class="stock-request-items">
          <div class="stock-request-section-title">รายการสินค้า</div>

          <div class="po-items-table">
            <div class="po-items-head">
              <div>สินค้า</div>
              <div>ตัดจากสต็อก</div>
              <div>จำนวน</div>
            </div>

            ${itemRows}
          </div>
        </div>

        <div class="stock-request-actions">
          <button 
            class="btn-request-secondary" 
            type="button"
            onclick="printPickList('${escapeHtml(request.requestId || '')}')"
          >
            พิมพ์ใบจัดของ
          </button>
          <button 
            class="btn-request-primary" 
            type="button"
            onclick="completeStockRequest('${escapeHtml(request.requestId)}')"
          >
            ยืนยันจัดของ
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function enableStockRequestEdit(requestId) {
  const request = pendingTransfers.find((item) => item.requestId === requestId);
  const card = document.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);

  if (!request || !card) {
    showToast('❌ ไม่พบใบขอเบิกนี้', 'error');
    return;
  }

  if (card.querySelector('.request-edit-list')) {
    showToast('กำลังอยู่ในโหมดแก้ไขแล้ว', 'error');
    return;
  }

  const itemBox = card.querySelector('.po-items-table');
  if (!itemBox) return;

  const items = Array.isArray(request.items) ? request.items : [];
  const editRows = items.map((item) => {
    const product = item.product || '';
    const qty = Number(item.qty) || 0;

    return `
      <div class="po-edit-row request-edit-row">
        <select class="request-edit-product">
          <option value=""></option>
          ${PRODUCTS.map((p) => `
            <option value="${escapeHtml(p)}" ${p === product ? 'selected' : ''}>
              ${escapeHtml(p)}
            </option>
          `).join('')}
        </select>

        <input class="po-edit-qty request-edit-qty" type="number" min="1" value="${qty}" />

        <button
          class="btn-remove-row"
          type="button"
          onclick="this.closest('.request-edit-row').remove()"
        >
          ×
        </button>
      </div>
    `;
  }).join('');

  itemBox.innerHTML = `
    <div class="po-items-head">
      <div>สินค้า</div>
      <div>จำนวน</div>
      <div></div>
    </div>

    <div class="request-edit-list">
      ${editRows}
    </div>
  `;

  card.querySelectorAll('.request-edit-product').forEach((select) => {
    if (typeof enhanceProductSelect === 'function') {
      enhanceProductSelect(select);
    }
  });

  card.querySelector('.request-edit-footer')?.remove();

  const editFooter = document.createElement('div');
  editFooter.className = 'po-edit-footer request-edit-footer';
  editFooter.innerHTML = `
    <button
      class="btn-request-secondary"
      type="button"
      onclick="addStockRequestEditRow('${escapeHtml(requestId)}')"
    >
      + เพิ่มรายการ
    </button>

    <button
      class="btn-request-secondary"
      type="button"
      onclick="fetchPendingTransfers()"
    >
      ยกเลิก
    </button>

    <button
      class="btn-request-primary"
      type="button"
      onclick="saveStockRequestEdit('${escapeHtml(requestId)}')"
    >
      บันทึกแก้ไข
    </button>
  `;

  const stockItems = card.querySelector('.stock-request-items');
  if (stockItems) {
    stockItems.insertAdjacentElement('afterend', editFooter);
  } else {
    card.appendChild(editFooter);
  }
}

function addStockRequestEditRow(requestId) {
  const card = document.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
  const list = card?.querySelector('.request-edit-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'po-edit-row request-edit-row';
  row.innerHTML = `
    <select class="request-edit-product">
      <option value=""></option>
      ${getProductOptions()}
    </select>

    <input class="po-edit-qty request-edit-qty" type="number" min="1" placeholder="จำนวน" />

    <button class="btn-remove-row" type="button" onclick="this.closest('.request-edit-row').remove()">×</button>
  `;

  list.appendChild(row);

  const select = row.querySelector('.request-edit-product');
  if (select && typeof enhanceProductSelect === 'function') {
    enhanceProductSelect(select);
  }
}

async function saveStockRequestEdit(requestId) {
  const card = document.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
  if (!card) return;

  const rows = card.querySelectorAll('.request-edit-row');
  const items = Array.from(rows).map((row) => {
    const product = row.querySelector('.request-edit-product')?.value || '';
    const qty = Number(row.querySelector('.request-edit-qty')?.value) || 0;

    return { product, qty };
  }).filter((item) => item.product && item.qty > 0);

  if (items.length === 0) {
    showToast('⚠️ กรุณาใส่รายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  showToast('', 'loading', 'กำลังบันทึกการแก้ไขใบขอเบิก...');

  try {
    const { data, error } = await supabaseClient.rpc('update_stock_request_items', {
      p_request_id: requestId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_items: items,
    });

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'แก้ไขใบขอเบิกไม่สำเร็จ');
    }

    showToast('✅ แก้ไขใบขอเบิกสำเร็จ', 'success');
    await fetchPendingTransfers();

  } catch (error) {
    console.error('saveStockRequestEdit error:', error);
    showToast(`❌ ${error.message || 'แก้ไขใบขอเบิกไม่สำเร็จ'}`, 'error');
  }
}

function getRequestItemUnit(request, item) {
  const product = item.product || '';
  return String(
    item.Unit
    || item.unit
    || item.unit_name
    || (typeof getStockUnit === 'function' ? getStockUnit(request.center, product) : '')
    || ''
  ).trim();
}

function getRequestStaffDisplay(request = {}) {
  return String(
    request.staffName
    || request.staff_name
    || request.requester_name
    || request.requesterName
    || request.staffCode
    || request.staff_code
    || ''
  ).trim();
}

function getRequestItemSourceCenter(item = {}) {
  return String(
    item.source_center
    || item.sourceCenter
    || item.stock_center
    || item.stockCenter
    || item.center
    || ''
  ).trim();
}

function isRequestTransferPreparedItem(item = {}) {
  return Boolean(
    item.request_transfer === true
    || item.requestTransfer === true
    || item.transfer_from_center
    || item.transferFromCenter
  );
}

function getRequestItemTransferFromCenter(item = {}) {
  return String(
    item.transfer_from_center
    || item.transferFromCenter
    || item.from_center
    || item.fromCenter
    || getRequestItemSourceCenter(item)
    || ''
  ).trim();
}

function renderRequestHistoryCards(requestList, options = {}) {
  if (!requestList.length) {
    return `<div class="empty-state">${escapeHtml(options.emptyText || 'ไม่พบใบเบิกย้อนหลัง')}</div>`;
  }

  return requestList.map((request) => {
    const isCompleted = request.status === 'completed';
    const isCancelled = request.status === 'cancelled';
    const staffDisplay = getRequestStaffDisplay(request);
    const items = Array.isArray(request.prepared_items) && request.prepared_items.length
      ? request.prepared_items
      : request.items || [];
    const isTransferCompleted = isCompleted && items.some((item) => isRequestTransferPreparedItem(item));
    const sourceColumnHead = isTransferCompleted ? 'โอนจากสต็อก' : 'ตัดสต็อกที่';

    const itemRows = items.map((item) => {
      const unit = getRequestItemUnit(request, item);
      const qty = Number(item.qty) || 0;
      const sourceCenter = isCompleted
        ? (isTransferCompleted ? getRequestItemTransferFromCenter(item) : getRequestItemSourceCenter(item))
        : '';

      return `
        <div class="po-item-row">
          <div class="po-item-name">${escapeHtml(item.product || '-')}</div>
          ${isCompleted ? `
            <div class="po-item-source-location">${escapeHtml(sourceCenter || '—')}</div>
          ` : ''}
          <div class="po-item-qty">${qty}</div>
          <div class="po-item-unit">${escapeHtml(unit)}</div>
        </div>
      `;
    }).join('');

    const statusText = isCancelled
      ? 'ใบเบิกนี้ถูกยกเลิก'
      : isCompleted
        ? 'จัดเตรียมเรียบร้อย'
        : 'รอดำเนินการ';
    const sectionTitle = isCompleted
      ? 'รายการที่จัดเตรียมแล้ว'
      : 'รายการที่ขอเบิก';
    const requestId = request.request_id || request.requestId || '';
    const printButton = isCancelled
      ? ''
      : `
        <button
          class="btn-request-secondary request-print-inline"
          type="button"
          onclick="${isCompleted ? 'printCompletedRequestPickList' : 'printStaffPendingRequest'}('${escapeHtml(requestId)}')"
        >
          ${isCompleted ? 'พิมพ์ใบเบิก' : 'พิมพ์ใบขอเบิก'}
        </button>
      `;

    return `
      <article class="stock-request-card">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลขใบเบิก</span>
            <strong>${escapeHtml(requestId || '-')}</strong>
          </div>

          <div class="request-head-actions">
            <span class="overview-pill ${isCompleted ? 'is-ready' : ''} ${isCancelled ? 'is-cancelled' : ''}">
              ${escapeHtml(statusText)}
            </span>
            ${printButton}
          </div>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เบิก</span>
            <strong>${escapeHtml(request.request_date || request.date || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์</span>
            <strong>${escapeHtml(request.center || '-')}</strong>
          </div>
          <div>
            <span>ผู้เบิก</span>
            <strong>${escapeHtml(staffDisplay || '-')}</strong>
          </div>
          <div>
            <span>จัดของเมื่อ</span>
            <strong>${request.picked_at ? new Date(request.picked_at).toLocaleString('th-TH') : '-'}</strong>
          </div>
        </div>

        ${request.note ? `
          <div class="stock-request-note">
            <span>หมายเหตุ</span>
            <p>${escapeHtml(request.note)}</p>
          </div>
        ` : ''}

        <div class="stock-request-items">
          <div class="stock-request-section-title">
            ${escapeHtml(sectionTitle)}
          </div>

          <div class="po-items-table ${isCompleted ? 'has-source-location' : ''}">
            <div class="po-items-head">
              <div>สินค้า</div>
              ${isCompleted ? `<div>${escapeHtml(sourceColumnHead)}</div>` : ''}
              <div>จำนวน</div>
              <div>หน่วย</div>
            </div>

            ${itemRows}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function fetchStaffPendingRequests() {
  if (!currentUser || currentUser.role !== 'center_staff') return;

  const box = document.getElementById('staff-pending-requests');
  if (!box) return;

  box.innerHTML = '<div class="empty-state">กำลังโหลดใบขอเบิกที่รอแอดมินจัดของ...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_pending_stock_requests');

    if (error) throw error;

    const ownRequests = (data || [])
      .filter((item) => item.staff_code === currentUser.code)
      .map((item) => ({
        requestId: item.request_id,
        date: item.request_date,
        center: item.center,
        staffCode: item.staff_code || '',
        staffName: item.staff_name || '',
        note: item.note || '',
        status: item.status,
        items: item.items || [],
        createdAt: item.created_at,
      }));

    window.staffPendingRequestList = ownRequests;
    renderStaffPendingRequests(ownRequests);

  } catch (error) {
    console.error('fetchStaffPendingRequests error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดใบขอเบิกที่รอแอดมินจัดของไม่สำเร็จ')}</div>`;
  }
}

function renderStaffPendingRequests(requestList) {
  const box = document.getElementById('staff-pending-requests');
  if (!box) return;

  if (!requestList.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีใบขอเบิกที่รอแอดมินจัดของ</div>';
    return;
  }

  box.innerHTML = requestList.map((request) => {
    const requestId = request.requestId || request.request_id || '';
    const staffDisplay = getRequestStaffDisplay(request);
    const itemRows = (request.items || []).map((item) => {
      const unit = getRequestItemUnit(request, item);

      return `
        <div class="po-item-row">
          <div class="po-item-name">${escapeHtml(item.product || '-')}</div>
          <div class="po-item-qty">${Number(item.qty) || 0}</div>
          <div class="po-item-unit">${escapeHtml(unit)}</div>
        </div>
      `;
    }).join('');

    return `
      <article class="stock-request-card">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลขใบเบิก</span>
            <strong>${escapeHtml(requestId || '-')}</strong>
          </div>

          <div class="request-head-actions">
            <span class="overview-pill">รอแอดมินจัดของ</span>
            <button
              class="btn-request-secondary request-print-inline"
              type="button"
              onclick="printStaffPendingRequest('${escapeHtml(requestId)}')"
            >
              พิมพ์ใบขอเบิก
            </button>
          </div>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เบิก</span>
            <strong>${escapeHtml(request.date || request.request_date || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์</span>
            <strong>${escapeHtml(request.center || '-')}</strong>
          </div>
          <div>
            <span>ผู้เบิก</span>
            <strong>${escapeHtml(staffDisplay || '-')}</strong>
          </div>
        </div>

        ${request.note ? `
          <div class="stock-request-note">
            <span>หมายเหตุ</span>
            <p>${escapeHtml(request.note)}</p>
          </div>
        ` : ''}

        <div class="stock-request-items">
          <div class="stock-request-section-title">รายการที่ขอเบิก</div>

          <div class="po-items-table">
            <div class="po-items-head">
              <div>สินค้า</div>
              <div>จำนวน</div>
              <div>หน่วย</div>
            </div>

            ${itemRows}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function fetchAdminRequestHistory() {
  if (!currentUser || !['admin', 'adminR', 'stock_receiver'].includes(currentUser.role)) return;

  const box = document.getElementById('request-history-list');
  if (!box) return;

  const status = document.getElementById('request-history-status')?.value || '';
  const center = document.getElementById('request-history-center')?.value || '';
  const requestId = document.getElementById('request-history-id')?.value.trim() || '';

  box.innerHTML = '<div class="empty-state">กำลังโหลดใบเบิกย้อนหลัง...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_admin_stock_request_history', {
      p_status: status,
      p_center: center,
      p_request_id: requestId,
      p_staff_code: '',
    });

    if (error) {
      throw error;
    }

    window.adminRequestHistoryList = data || [];
    box.innerHTML = renderRequestHistoryCards(window.adminRequestHistoryList, {
      emptyText: 'ไม่พบใบเบิกย้อนหลังตามตัวกรอง',
    });

  } catch (error) {
    console.error('fetchAdminRequestHistory error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดใบเบิกย้อนหลังไม่สำเร็จ')}</div>`;
  }
}

async function fetchStaffRequestHistory() {
  if (!currentUser || currentUser.role !== 'center_staff') return;

  const box = document.getElementById('request-status-list');
  if (!box) return;

  const status = document.getElementById('staff-request-history-status')?.value || '';
  const center = document.getElementById('staff-request-history-center')?.value || '';
  const requestId = document.getElementById('staff-request-history-id')?.value.trim() || '';

  box.innerHTML = '<div class="empty-state">กำลังโหลดใบเบิกย้อนหลัง...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_admin_stock_request_history', {
      p_status: status,
      p_center: center,
      p_request_id: requestId,
      p_staff_code: '',
    });

    if (error) {
      throw error;
    }

    window.currentRequestStatusList = data || [];
    box.innerHTML = renderRequestHistoryCards(window.currentRequestStatusList, {
      emptyText: 'ไม่พบใบเบิกย้อนหลังตามตัวกรอง',
    });

  } catch (error) {
    console.error('fetchStaffRequestHistory error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดใบเบิกย้อนหลังไม่สำเร็จ')}</div>`;
  }
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

function toggleRequestTransferBox(requestId) {
  const box = document.querySelector(`[data-transfer-box="${CSS.escape(requestId)}"]`);
  if (!box) return;

  const card = box.closest('.stock-request-card');
  const isOpening = box.hidden;

  box.hidden = !isOpening;
  setRequestTransferMode(card, isOpening);
}

function setRequestTransferMode(card, enabled) {
  if (!card) return;

  card.classList.toggle('is-transfer-mode', Boolean(enabled));
  card.querySelectorAll('.pick-stock-location').forEach((select) => {
    select.disabled = Boolean(enabled);
  });
}

async function transferRequestItemsToCenter(requestId) {
  if (!requestId) return;
  if (!['admin', 'adminR', 'stock_receiver'].includes(currentUser?.role)) return;

  const request = pendingTransfers.find((item) => item.requestId === requestId);
  if (!request) {
    showToast('❌ ไม่พบใบขอเบิกนี้', 'error');
    return;
  }

  const card = document.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
  if (!card) {
    showToast('❌ ไม่พบการ์ดใบขอเบิกนี้บนหน้าจอ', 'error');
    return;
  }

  const box = card.querySelector(`[data-transfer-box="${CSS.escape(requestId)}"]`);
  const sourceCenter = box?.querySelector('.request-transfer-from')?.value || '';
  const targetCenter = box?.querySelector('.request-transfer-to')?.value || request.center;

  if (!sourceCenter || !targetCenter) {
    showToast('⚠️ กรุณาเลือกสต็อกต้นทางและปลายทาง', 'error');
    return;
  }

  if (sourceCenter === targetCenter) {
    showToast('⚠️ สต็อกต้นทางและปลายทางต้องไม่ใช่สต็อกเดียวกัน', 'error');
    return;
  }

  const rows = Array.from(card.querySelectorAll('.pick-item-row'));
  const items = [];

  rows.forEach((row) => {
    const input = row.querySelector('.prepared-qty-input');
    const product = input?.dataset.product || '';
    const qty = Number(input?.value) || 0;

    if (!product || qty <= 0) return;
    items.push({ product, qty });
  });

  if (!items.length) {
    showToast('⚠️ ไม่มีรายการที่ต้อง Transfer', 'error');
    return;
  }

  for (const item of items) {
    const availableQty = typeof getStockQty === 'function'
      ? getStockQty(sourceCenter, item.product)
      : ((localStock[sourceCenter] || {})[item.product] || 0);
    if (item.qty > availableQty) {
      const unit = typeof getStockUnit === 'function' ? getStockUnit(sourceCenter, item.product) : '';
      showToast(`⚠️ ${item.product} (${sourceCenter}): จำนวนไม่พอ มี ${availableQty}${unit ? ` ${unit}` : ''}`, 'error');
      return;
    }
  }

  const ok = confirm(`ยืนยัน Transfer รายการใบเบิก ${requestId} จาก ${sourceCenter} ไป ${targetCenter} ใช่ไหม?`);
  if (!ok) return;

  const button = card.querySelector('.request-transfer-inline');
  if (button) button.disabled = true;

  showToast('', 'loading', `กำลัง Transfer ไป ${targetCenter}...`);

  try {
    const transferId = `${requestId}-AUTO-${Date.now()}`;
    const { data, error } = await supabaseClient.rpc('transfer_stock_now', {
      p_transfer_id: transferId,
      p_staff_code: currentUser.code,
      p_date: new Date().toISOString().split('T')[0],
      p_from_center: sourceCenter,
      p_to_center: targetCenter,
      p_note: `Auto transfer for request ${requestId}`,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'Transfer ไม่สำเร็จ');
    }

    updateLocalStock('out', sourceCenter, items);
    updateLocalStock('in', targetCenter, items);

    const preparedItems = items.map((item) => ({
      ...item,
      request_transfer: true,
      requestTransfer: true,
      transfer_from_center: sourceCenter,
      transferFromCenter: sourceCenter,
      transfer_to_center: targetCenter,
      transferToCenter: targetCenter,
      source_center: targetCenter,
      sourceCenter: targetCenter,
      stock_center: targetCenter,
      center: targetCenter,
    }));

    await completeTransferredStockRequest(requestId, preparedItems);

    rows.forEach((row) => {
      const select = row.querySelector('.pick-stock-location');
      if (select) select.value = targetCenter;
    });
    setRequestTransferMode(card, true);

    if (typeof fetchFreshStock === 'function') {
      await fetchFreshStock();
    } else if (typeof fetchStock === 'function') {
      await fetchStock();
    }

    pendingTransfers = pendingTransfers.filter((item) => item.requestId !== requestId);

    if (typeof updatePendingBadge === 'function') {
      updatePendingBadge(pendingTransfers.length);
    }

    card.remove();

    showToast(`✅ Transfer ไปพักที่ ${targetCenter} เรียบร้อย`, 'success');
    if (box) box.hidden = true;

  } catch (error) {
    console.error('transferRequestItemsToCenter error:', error);
    showToast(`❌ ${error.message || 'Transfer ไปศูนย์ปลายทางไม่สำเร็จ'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function completeTransferredStockRequest(requestId, items) {
  const { data, error } = await supabaseClient.rpc('complete_stock_request_after_transfer', {
    p_request_id: requestId,
    p_staff_code: currentUser.code,
    p_items: items,
  });

  if (error) {
    throw new Error(error.message || 'ปิดใบเบิกหลัง Transfer ไม่สำเร็จ');
  }

  if (!data || data.success !== true) {
    throw new Error(data?.message || 'ปิดใบเบิกหลัง Transfer ไม่สำเร็จ');
  }

  return data;
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

function togglePreparedQtyEdit(button) {
  const row = button.closest('.pick-qty-edit-row');
  const input = row?.querySelector('.prepared-qty-input');
  if (!input) return;

  if (input.hasAttribute('readonly')) {
    input.removeAttribute('readonly');
    input.focus();
    input.select();
    button.classList.add('is-editing');
    button.textContent = '✓';
    button.setAttribute('title', 'ยืนยันจำนวน');
    return;
  }

  let value = String(input.value || '').replace(/[^0-9]/g, '');
  let num = Number(value || 0);

  if (num < 0) num = 0;

  input.value = num;
  input.setAttribute('readonly', true);

  button.classList.remove('is-editing');
  button.textContent = '✎';
  button.setAttribute('title', 'แก้ไขจำนวน');
}

async function completeStockRequest(requestId) {
  if (!requestId) return;

  const card = Array.from(document.querySelectorAll('.stock-request-card'))
    .find((el) => el.innerHTML.includes(requestId));

  if (!card) {
    showToast('❌ ไม่พบใบเบิกนี้บนหน้าจอ', 'error');
    return;
  }

  const inputs = card.querySelectorAll('.prepared-qty-input');

  const allItems = Array.from(inputs)
    .map((input) => {
      const row = input.closest('.pick-item-row');
      const sourceCenter = row?.querySelector('.pick-stock-location')?.value || 'สต็อกใหญ่';

      return {
        product: input.dataset.product,
        qty: Number(input.value) || 0,
        source_center: sourceCenter,
        sourceCenter,
        stock_center: sourceCenter,
        center: sourceCenter,
      };
    })
    .filter((item) => item.product);

  const items = allItems.filter((item) => item.qty > 0);

  if (items.length === 0 && allItems.length > 0) {
    await cancelStockRequest(requestId, allItems);
    return;
  }

  if (items.length === 0) {
    showToast('⚠️ กรุณาระบุจำนวนที่จัดอย่างน้อย 1 รายการ', 'error');
    return;
  }

  const stockCheckMap = new Map();
  items.forEach((item) => {
    const key = `${item.source_center}::${item.product}`;
    const currentQty = stockCheckMap.get(key)?.qty || 0;
    stockCheckMap.set(key, {
      sourceCenter: item.source_center,
      product: item.product,
      qty: currentQty + item.qty,
    });
  });

  const stockCheck = Array.from(stockCheckMap.values()).reduce((result, item) => {
    if (!result.ok) return result;

    const availableQty = typeof getStockQty === 'function'
      ? getStockQty(item.sourceCenter, item.product)
      : ((localStock[item.sourceCenter] || {})[item.product] || 0);
    if (item.qty > availableQty) {
      return {
        ok: false,
        message: `⚠️ ${item.product} (${item.sourceCenter}): จำนวนไม่พอ มี ${availableQty} ชิ้น`,
      };
    }

    return result;
  }, { ok: true, message: '' });

  if (!stockCheck.ok) {
    showToast(stockCheck.message, 'error');
    return;
  }

  const ok = confirm('ยืนยันจัดของและตัดสต็อกใช่ไหม?');
  if (!ok) return;

  showToast('', 'loading', 'กำลังยืนยันจัดของ...');

  try {
    const { data, error } = await supabaseClient.rpc('complete_stock_request', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_items: allItems,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'ยืนยันจัดของไม่สำเร็จ');
    }

    showToast('✅ จัดของและตัดสต็อกสำเร็จ', 'success');

    if (typeof fetchFreshStock === 'function') {
      await fetchFreshStock();
    } else if (typeof fetchStock === 'function') {
      await fetchStock();
    }

    await fetchPendingTransfers();

  } catch (error) {
    console.error('complete_stock_request error:', error);
    showToast(`❌ ${error.message || 'ยืนยันจัดของไม่สำเร็จ'}`, 'error');
  }
}

async function cancelStockRequest(requestId, items = []) {
  const ok = confirm(`ยืนยันยกเลิกใบเบิก ${requestId} ใช่ไหม? รายการนี้จะไม่ตัดสต็อก`);
  if (!ok) return;

  showToast('', 'loading', 'กำลังยกเลิกใบเบิก...');

  try {
    const { data, error } = await supabaseClient.rpc('cancel_stock_request', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'ยกเลิกใบเบิกไม่สำเร็จ');
    }

    showToast('✅ ยกเลิกใบเบิกเรียบร้อย', 'success');
    fetchPendingTransfers();

  } catch (error) {
    console.error('cancel_stock_request error:', error);
    showToast(`❌ ${error.message || 'ยกเลิกใบเบิกไม่สำเร็จ'}`, 'error');
  }
}

function renderPoCmoForm() {
  const panel = document.getElementById('panel-transfer');
  if (!panel) return;

  const poCenterOptions = getPickStockLocations().map((center) => `
    <option value="${escapeHtml(center)}"${center === currentUser?.center ? ' selected' : ''}>
      ${escapeHtml(center)}
    </option>
  `).join('');

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon transfer">📝</span>
      <div>
        <h2>เปิด PR</h2>
        <p>สร้างรายการสั่งสินค้า เพื่อรอรับสินค้าเข้าสต็อก</p>
      </div>
    </div>

    <div class="form-grid">
      <div class="field-group">
        <label for="po-date">วันที่เปิด PR</label>
        <input type="date" id="po-date" />
      </div>

      <div class="field-group">
        <label for="po-person">ผู้เปิด PR</label>
        <input type="text" id="po-person" placeholder="กรอกชื่อผู้เปิด PR"/>
      </div>

      <div class="field-group">
        <label for="po-center">ศูนย์ที่จะรับเข้า</label>
        <select id="po-center">
          <option value="">— เลือกศูนย์ —</option>
          ${poCenterOptions}
        </select>
      </div>

      <div class="field-group field-group-full">
        <label for="po-note">หมายเหตุ</label>
        <input type="text" id="po-note" placeholder="หมายเหตุ"/>
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="products-header">
      <div>
        <span>รายการสินค้าเปิด PR</span>
        <small>เลือกสินค้าและจำนวนที่ต้องการสั่ง</small>
      </div>
      <button class="btn-add-row transfer" type="button" id="btn-add-po-row">
        + เพิ่มรายการ
      </button>
    </div>

    <div id="po-products" class="product-list"></div>

    <button class="btn-submit btn-submit-transfer" id="btn-submit-po" type="button">
      <span>📝</span>
      <span>บันทึกรายการเปิด PR</span>
    </button>

    <div class="section-divider"></div>

    <section class="pr-history-panel">
      <div class="panel-title compact-title">
        <span class="title-icon">📄</span>
        <div>
          <h2>ค้นหา PR ย้อนหลัง</h2>
          <p>เรียกดู PR ที่เปิดแล้วตามสถานะ ศูนย์ หรือเลข PR</p>
        </div>
      </div>

      <div class="request-history-filters stock-view-toolbar-3">
        <div class="field-group">
          <label for="pr-history-status">สถานะ PR</label>
          <select id="pr-history-status">
            <option value="">ทุกสถานะ</option>
            <option value="pr_pending_approval" selected>รออนุมัติ</option>
            <option value="pr_approved">อนุมัติแล้ว</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
        </div>

        <div class="field-group">
          <label for="pr-history-center">ศูนย์รับเข้า</label>
          <select id="pr-history-center">
            <option value="">ทุกศูนย์</option>
            ${poCenterOptions}
          </select>
        </div>

        <div class="field-group">
          <label for="pr-history-id">เลขที่ PR</label>
          <input type="text" id="pr-history-id" placeholder="เช่น PR-20260606-001" />
        </div>
      </div>

      <button class="btn-request-secondary pr-history-refresh" id="btn-fetch-pr-history" type="button">
        <span>ค้นหา</span>
        <strong>เรียกดู PR ย้อนหลัง</strong>
      </button>

      <div id="pr-history-list" class="request-history-list">
        <div class="empty-state">กำลังโหลด PR ที่รออนุมัติ...</div>
      </div>
    </section>
  `;

  setToday('po-date');
  if (currentUser?.role === 'center_staff' && currentUser.center) {
    lockSelectToValue('po-center', currentUser.center);
  }

  document.getElementById('btn-add-po-row')?.addEventListener('click', addPoRow);
  document.getElementById('btn-submit-po')?.addEventListener('click', submitPoCmo);
  document.getElementById('po-center')?.addEventListener('change', updateAllPoRowUnits);
  document.getElementById('btn-fetch-pr-history')?.addEventListener('click', fetchPrOpenHistory);

  addPoRow();
  fetchPrOpenHistory({ autoPending: true });
}

function getPrOpenHistoryStatusText(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pr_approved' || normalized === 'approved') return 'อนุมัติแล้ว';
  if (normalized === 'cancelled') return 'ยกเลิก';
  return 'รออนุมัติ';
}

function renderPrOpenHistoryCards(records = []) {
  if (!records.length) {
    return '<div class="empty-state">ไม่พบ PR ย้อนหลังตามตัวกรอง</div>';
  }

  return records.map((record) => {
    const items = normalizeItems(record.items);
    const statusText = getPrOpenHistoryStatusText(record.status);
    const isApproved = statusText === 'อนุมัติแล้ว';
    const itemRows = items.map((item) => {
      const unit = String(item.unit || item.Unit || '').trim();
      return `
        <div class="po-item-row">
          <div class="po-item-name">${escapeHtml(item.product || '-')}</div>
          <div class="po-item-qty">${Number(item.qty || 0).toLocaleString()}</div>
          <div class="po-item-unit">${escapeHtml(unit)}</div>
        </div>
      `;
    }).join('');

    return `
      <article class="stock-request-card pr-history-card">
        <div class="stock-request-head pr-history-head">
          <div>
            <span class="overview-label">เลข PR</span>
            <strong>${escapeHtml(record.po_id || '-')}</strong>
          </div>
          <span class="overview-pill ${isApproved ? 'is-completed' : ''}">${escapeHtml(statusText)}</span>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เปิด PR</span>
            <strong>${escapeHtml(record.po_date || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์รับเข้า</span>
            <strong>${escapeHtml(record.center || '-')}</strong>
          </div>
          <div>
            <span>ผู้เปิด PR</span>
            <strong>${escapeHtml(record.po_person || '-')}</strong>
          </div>
        </div>

        ${record.note ? `
          <div class="stock-request-note">
            <span>หมายเหตุ</span>
            <p>${escapeHtml(record.note)}</p>
          </div>
        ` : ''}

        <div class="stock-request-items">
          <div class="stock-request-section-title">รายการสินค้าเปิด PR</div>
          <div class="po-items-table">
            <div class="po-items-head">
              <div>สินค้า</div>
              <div>จำนวน</div>
              <div>หน่วย</div>
            </div>
            ${itemRows || '<div class="empty-state">ไม่มีรายการสินค้า</div>'}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function fetchPrOpenHistory(options = {}) {
  const box = document.getElementById('pr-history-list');
  if (!box) return;

  const status = options.autoPending
    ? 'pr_pending_approval'
    : (document.getElementById('pr-history-status')?.value || '');
  const center = document.getElementById('pr-history-center')?.value || '';
  const prId = document.getElementById('pr-history-id')?.value.trim() || '';

  box.innerHTML = `<div class="empty-state">${options.autoPending ? 'กำลังโหลด PR ที่รออนุมัติ...' : 'กำลังโหลด PR ย้อนหลัง...'}</div>`;

  try {
    const { data, error } = await supabaseClient.rpc('get_pr_approval_status');

    if (error) {
      throw error;
    }

    const searchText = prId.toLowerCase();
    window.currentPrOpenHistoryList = (data || [])
      .filter((record) => String(record.po_id || '').toUpperCase().startsWith('PR-'))
      .filter((record) => !status || String(record.status || '') === status)
      .filter((record) => !center || String(record.center || '') === center)
      .filter((record) => !searchText || String(record.po_id || '').toLowerCase().includes(searchText));

    box.innerHTML = renderPrOpenHistoryCards(window.currentPrOpenHistoryList);

  } catch (error) {
    console.error('fetchPrOpenHistory error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลด PR ย้อนหลังไม่สำเร็จ')}</div>`;
  }
}

function renderAdminTransferForm() {
  const panel = document.getElementById('panel-in');
  if (!panel) return;

  const centerOptions = getPickStockLocations().map((center) => `
    <option value="${escapeHtml(center)}">${escapeHtml(center)}</option>
  `).join('');

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon transfer">🔁</span>
      <div>
        <h2>Transfer Stock</h2>
        <p>ย้ายสต็อกระหว่างศูนย์ กรณีรับสินค้าเข้าไว้ผิดสต็อก</p>
      </div>
    </div>

    <div class="form-grid">
      <div class="field-group">
        <label for="transfer-date">วันที่ย้ายสต็อก</label>
        <input type="date" id="transfer-date" />
      </div>

      <div class="field-group">
        <label for="transfer-person">ผู้ทำรายการ</label>
        <input type="text" id="transfer-person" placeholder="ชื่อผู้ทำรายการ" readonly />
      </div>

      <div class="field-group">
        <label for="transfer-from-center">จากสต็อก</label>
        <select id="transfer-from-center">
          <option value="">— เลือกสต็อกต้นทาง —</option>
          ${centerOptions}
        </select>
      </div>

      <div class="field-group">
        <label for="transfer-to-center">ไปสต็อก</label>
        <select id="transfer-to-center">
          <option value="">— เลือกสต็อกปลายทาง —</option>
          ${centerOptions}
        </select>
      </div>

      <div class="field-group">
        <label for="transfer-convert-from">แปลงจากสินค้า</label>
        <select id="transfer-convert-from" class="product-select">
          <option value=""></option>
          ${getProductOptions()}
        </select>
      </div>

      <div class="field-group">
        <label for="transfer-convert-to">สินค้าที่แปลงแล้ว</label>
        <select id="transfer-convert-to" class="product-select">
          <option value=""></option>
          ${getProductOptions()}
        </select>
      </div>

      <div class="field-group field-group-full">
        <label for="transfer-note">หมายเหตุ</label>
        <input type="text" id="transfer-note" placeholder="เช่น แก้ไขการรับเข้าผิดสต็อก / เลข PO ที่เกี่ยวข้อง" />
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="products-header">
      <div>
        <span>รายการสินค้าที่ต้องย้าย</span>
        <small>เลือกสินค้าจากสต็อกต้นทาง และระบุจำนวนที่ต้องการย้าย</small>
      </div>
      <button class="btn-add-row transfer" type="button" id="btn-add-transfer-row">
        + เพิ่มรายการ
      </button>
    </div>

    <div class="products-columns products-columns-transfer" aria-hidden="true">
      <span>สินค้า</span>
      <span>จำนวน</span>
      <span></span>
    </div>

    <div id="transfer-products" class="product-list"></div>

    <button class="btn-submit btn-submit-transfer" id="btn-transfer" type="button" data-submit="transfer">
      <span>🔁</span>
      <span>บันทึก Transfer Stock</span>
    </button>
  `;

  setToday('transfer-date');
  document.getElementById('transfer-person').value = `${currentUser.name} (${currentUser.code})`;
  document.getElementById('btn-add-transfer-row')?.addEventListener('click', () => addProductRow('transfer'));
  document.getElementById('btn-transfer')?.addEventListener('click', submitTransfer);
  document.getElementById('transfer-from-center')?.addEventListener('change', refreshTransferInfo);
  document.getElementById('transfer-to-center')?.addEventListener('change', filterTransferTargetCenters);
  document.getElementById('transfer-convert-from')?.addEventListener('change', () => {
    filterTransferTargetCenters();
    updateTransferConversionMode();
  });
  document.getElementById('transfer-convert-to')?.addEventListener('change', () => {
    filterTransferTargetCenters();
    updateTransferConversionMode();
  });
  enhanceStockProductFilter(document.getElementById('transfer-convert-from'));
  enhanceStockProductFilter(document.getElementById('transfer-convert-to'));
  ['transfer-convert-from', 'transfer-convert-to'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select?.tomselect) return;

    select.tomselect.wrapper.classList.add('transfer-convert-select');
    select.tomselect.control_input.setAttribute('placeholder', '— เลือกรายการสินค้า —');
  });

  addProductRow('transfer');
  updateTransferConversionMode();
  filterTransferTargetCenters();
}

function getPoCenter(po = {}) {
  const poId = po.po_id || po.poId || po.po_no || po.poNo || po.request_id || po.id || '';
  const centerFromCache = getPoCenterCache()[poId] || '';
  const items = Array.isArray(po.items) ? po.items : [];
  const centerFromItems = items
    .map((item) => item.center || item.stock_center || item.stockCenter || '')
    .find(Boolean) || '';

  const staffCode = String(
    po.staff_code
    || po.staffCode
    || po.created_by_code
    || po.createdByCode
    || po.user_code
    || po.userCode
    || ''
  ).trim().toLowerCase();

  const centerByStaffCode = window.STAFF_CENTER_BY_CODE?.[staffCode] || '';

  return po.center
    || po.stock_center
    || po.stockCenter
    || po.receive_center
    || po.receiveCenter
    || po.request_center
    || po.requestCenter
    || po.created_by_center
    || po.createdByCenter
    || po.po_center
    || po.poCenter
    || centerFromCache
    || centerFromItems
    || centerByStaffCode
    || (currentUser?.role === 'center_staff' ? currentUser.center : '')
    || '';
}

function isRpcSignatureError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|function .* not found|Could not find|schema cache|parameter|argument/i.test(text);
}

function canReceivePo() {
  return ['admin', 'adminR', 'stock_receiver'].includes(currentUser?.role);
}

function canEditPo(po = {}) {
  if (!isReceiveablePoRecord(po)) {
    return false;
  }

  if (!po || ['received', 'partial_received'].includes(po.status)) {
    return false;
  }

  if (['admin', 'adminR'].includes(currentUser?.role)) {
    return true;
  }

  const poCenter = getPoCenter(po);
  return Boolean(currentUser?.center && poCenter && poCenter === currentUser.center);
}

function addPoRow() {
  const container = document.getElementById('po-products');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'product-row row-out po-row';

  row.innerHTML = `
    <select class="product-select" aria-label="เลือกรายการสินค้า">
      <option value=""></option>
      ${getProductOptions()}
    </select>

    <div class="qty-input-with-unit po-qty-input-wrap">
      <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวนเปิด PR" />
      <span class="qty-unit po-unit-label" hidden></span>
    </div>

    <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
  `;

  row.querySelector('.btn-remove-row')?.addEventListener('click', (event) => removeRow(event.currentTarget));

  container.appendChild(row);

  const select = row.querySelector('.product-select');
  if (select && typeof enhanceProductSelect === 'function') {
    select.addEventListener('change', () => updatePoRowUnit(row));
    enhanceProductSelect(select);
  }

  updatePoRowUnit(row);
}

function updatePoRowUnit(row) {
  if (!row) return;

  const product = row.querySelector('.product-select')?.value || '';
  const center = document.getElementById('po-center')?.value || currentUser?.center || '';
  const unit = product && typeof getStockUnit === 'function' ? getStockUnit(center, product) : '';
  const wrap = row.querySelector('.po-qty-input-wrap');
  const label = row.querySelector('.po-unit-label');

  if (!wrap || !label) return;

  label.textContent = unit;
  label.hidden = !unit;
  wrap.classList.toggle('has-unit', Boolean(unit));
}

function updateAllPoRowUnits() {
  document.querySelectorAll('#po-products .po-row').forEach((row) => updatePoRowUnit(row));
}

async function submitPoCmo() {
  const btn = document.getElementById('btn-submit-po');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('po-date')?.value;
  const person = document.getElementById('po-person')?.value.trim() || '';
  const center = document.getElementById('po-center')?.value || currentUser?.center || '';
  const note = document.getElementById('po-note')?.value.trim() || '';
  const rows = document.querySelectorAll('#po-products .product-row');

  const items = Array.from(rows).map((row) => {
    const product = row.querySelector('select')?.value || '';
    const qty = Number(row.querySelector('input[type="number"]')?.value) || 0;
    const unit = product && typeof getStockUnit === 'function' ? getStockUnit(center, product) : '';

    return { product, qty, unit, center, stock_center: center };
  }).filter((item) => item.product && item.qty > 0);

  if (!date) {
    showToast('⚠️ กรุณาเลือกวันที่เปิด PR', 'error');
    return;
  }

  if (!person) {
    showToast('⚠️ กรุณากรอกชื่อผู้เปิด PR', 'error');
    document.getElementById('po-person')?.focus();
    return;
  }

  if (!center) {
    showToast('⚠️ กรุณาเลือกศูนย์ที่จะรับสินค้าเข้า', 'error');
    document.getElementById('po-center')?.focus();
    return;
  }

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกรายการเปิด PR...');

  try {
    let data = null;
    let error = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const createPrParams = {
        p_client_request_id: typeof newSupabaseDocumentId === 'function'
          ? await newSupabaseDocumentId('PR')
          : newRequestId('pr'),
        p_staff_code: currentUser?.code || '',
        p_date: date,
        p_person: person,
        p_center: center,
        p_note: note,
        p_items: items,
      };

      const result = await supabaseClient.rpc('create_pr_request', createPrParams);
      data = result.data;
      error = result.error;

      if (error && isRpcSignatureError(error)) {
        const { p_center, ...fallbackParams } = createPrParams;
        const fallback = await supabaseClient.rpc('create_pr_request', fallbackParams);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw error;
      }

      if (data?.duplicate !== true) {
        break;
      }
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึก PR ไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      throw new Error('เลข PR ซ้ำกับรายการเดิม กรุณากดบันทึกใหม่อีกครั้ง');
    }

    showToast(`✅ บันทึก PR สำเร็จ: ${data.po_id || ''}`, 'success');

    savePoCenterToCache(data.po_id || data.poId || data.po_no || data.poNo || '', center);

    const poSearch = document.getElementById('po-status-search');
    if (poSearch) poSearch.value = '';

    await fetchPoStatus();

    if (typeof fetchPendingPoSummary === 'function') {
      await fetchPendingPoSummary();
    }

    const poNote = document.getElementById('po-note');
    if (poNote) poNote.value = '';

    const poPerson = document.getElementById('po-person');
    if (poPerson) poPerson.value = '';

    const poCenter = document.getElementById('po-center');
    if (poCenter && currentUser?.center) poCenter.value = currentUser.center;

    const container = document.getElementById('po-products');
    if (container) {
      container.innerHTML = '';
      addPoRow();
    }

    if (document.getElementById('po-date')) {
      setToday('po-date');
    }

    if (Array.isArray(window.currentPrOpenHistoryList)) {
      await fetchPrOpenHistory();
    }

  } catch (error) {
    console.error('create_pr_request error:', error);
    showToast(`❌ ${error.message || 'บันทึก PR ไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function fetchPoStatus() {
  const box = document.getElementById('po-status-list');
  if (!box) return;

  box.innerHTML = '<div class="empty-state">กำลังโหลดสถานะ PO...</div>';

  try {
    const [{ data, error }, prResult] = await Promise.all([
      supabaseClient.rpc('get_po_status'),
      fetchPrStatusForPoPage(),
    ]);

    if (error) {
      throw error;
    }

    const recordsById = new Map();
    [...(data || []), ...(prResult || [])]
      .filter((po) => isPoDocumentRecord(po))
      .forEach((po) => {
        const poId = po.po_id || po.po_no || po.po_number || po.request_id || po.id || '';
        if (!poId || recordsById.has(poId)) return;
        recordsById.set(poId, po);
      });

    let poList = Array.from(recordsById.values())
      .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));

    // ค้นหาเลข PO
    const keyword = String(document.getElementById('po-status-search')?.value || '')
      .trim()
      .toLowerCase();

    if (keyword) {
      poList = poList.filter((po) => {
        const poNo = String(
          po.po_no ||
          po.po_number ||
          po.po_id ||
          po.request_id ||
          po.id ||
          ''
        ).toLowerCase();

        return poNo.includes(keyword);
      });
    }

    // PO ที่รับเข้าแล้ว: Staff เห็น 1 วัน, adminR เห็น 7 วัน
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let receivedVisibleMs = null;

    if (currentUser?.role === 'center_staff') {
      receivedVisibleMs = 1 * oneDayMs;
    }

    if (currentUser?.role === 'adminR') {
      receivedVisibleMs = 7 * oneDayMs;
    }

    if (receivedVisibleMs !== null) {
      poList = poList.filter((po) => {
        if (po.status !== 'received') return true;

        const receivedDateText =
          po.received_at ||
          po.completed_at ||
          po.updated_at ||
          po.created_at;

        if (!receivedDateText) return false;

        const receivedDate = new Date(receivedDateText);

        return now - receivedDate <= receivedVisibleMs;
      });
    }

    const statusFilter = getPoStatusFilter();

    if (statusFilter === 'received') {
      poList = poList.filter((po) => po.status === 'received');
    }

    if (statusFilter === 'pending') {
      poList = poList.filter((po) => po.status !== 'received');
    }

    renderPoStatus(poList);

  } catch (error) {
    console.error('fetchPoStatus error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดสถานะ PO ไม่สำเร็จ')}</div>`;
  }
}

async function fetchPrStatusForPoPage() {
  try {
    const { data, error } = await supabaseClient.rpc('get_pr_approval_status');

    if (error) {
      console.warn('get_pr_approval_status skipped for PO status:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.warn('get_pr_approval_status unavailable for PO status:', error);
    return [];
  }
}

function isPoDocumentRecord(po = {}) {
  const documentId = String(po.po_id || po.po_no || po.po_number || '').toUpperCase();
  return documentId.startsWith('PO-') || documentId.startsWith('PR-');
}

function isReceiveablePoRecord(po = {}) {
  return String(po.po_id || po.po_no || po.po_number || '').toUpperCase().startsWith('PO-');
}

function getPoStatusFilter() {
  return document.querySelector('.po-status-filter.is-active')?.dataset.poStatusFilter || 'pending';
}

function setPoStatusFilter(value) {
  const nextFilter = value === 'received' ? 'received' : 'pending';

  document.querySelectorAll('.po-status-filter').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.poStatusFilter === nextFilter);
  });

  fetchPoStatus();
}

function getPoItemUnit(item = {}, center = '') {
  const product = item.product || '';
  return String(
    item.Unit
    || item.unit
    || item.unit_name
    || (typeof getStockUnit === 'function' ? getStockUnit(center, product) : '')
    || ''
  ).trim();
}

function formatPoQty(qty, unit = '') {
  const qtyText = String(Number(qty) || 0);
  return unit ? `${qtyText} ${unit}` : qtyText;
}

function getPoLineReceivedStates(po = {}) {
  const requestedItems = Array.isArray(po.items) ? po.items : [];
  const receivedItems = Array.isArray(po.received_items) ? po.received_items : [];
  const states = requestedItems.map((item, index) => ({
    ...item,
    lineIndex: index,
    product: item.product || '',
    requestedQty: Number(item.qty) || 0,
    receivedQty: 0,
    remainingQty: Number(item.qty) || 0,
  }));

  const addReceivedToLine = (lineIndex, qty, allowOverReceived = false) => {
    const state = states[lineIndex];
    if (!state || qty <= 0) return qty;

    const remaining = Math.max(0, state.requestedQty - state.receivedQty);
    const usedQty = allowOverReceived ? qty : Math.min(remaining, qty);
    state.receivedQty += usedQty;
    state.remainingQty = Math.max(0, state.requestedQty - state.receivedQty);

    return qty - usedQty;
  };

  const pendingReceived = [];

  receivedItems.forEach((received) => {
    const product = received.product || '';
    const qty = Number(received.qty) || 0;
    if (!product) return;

    const lineIndexValue = received.line_index ?? received.lineIndex ?? received.po_line_index ?? received.poLineIndex;
    const lineIndex = lineIndexValue === undefined || lineIndexValue === null || lineIndexValue === ''
      ? -1
      : Number(lineIndexValue);

    if (Number.isInteger(lineIndex) && states[lineIndex]?.product === product) {
      const overflowQty = addReceivedToLine(lineIndex, qty, true);
      if (overflowQty > 0) pendingReceived.push({ product, qty: overflowQty });
      return;
    }

    pendingReceived.push({ product, qty });
  });

  pendingReceived.forEach((received) => {
    let remainingQty = received.qty;

    const exactLine = states.findIndex((state) => (
      state.product === received.product
      && state.remainingQty > 0
      && state.remainingQty === remainingQty
    ));

    if (exactLine >= 0) {
      remainingQty = addReceivedToLine(exactLine, remainingQty);
    }

    states.forEach((state, index) => {
      if (remainingQty <= 0 || state.product !== received.product || state.remainingQty <= 0) return;
      remainingQty = addReceivedToLine(index, remainingQty);
    });
  });

  return states;
}

function renderPoStatus(poList) {
  const box = document.getElementById('po-status-list');
  if (!box) return;

  window.currentPoStatusList = poList;
  const badge = document.getElementById('po-status-badge');
  const pendingCount = poList.filter((po) => po.status !== 'received').length;

  if (badge) {
    badge.hidden = pendingCount === 0;
    badge.textContent = pendingCount;
  }

  if (!poList.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีรายการ PO</div>';
    return;
  }

  box.innerHTML = poList.map((po) => {
    const statusText = po.status === 'received' ? 'รับเข้าแล้ว' : 'รอรับสินค้า';
    const statusClass = po.status === 'received' ? 'is-ready' : '';
    const poCenter = getPoCenter(po);

    const items = Array.isArray(po.items) ? po.items : [];
    const receivedStates = getPoLineReceivedStates(po);

    const itemList = items.map((item, index) => {
      const receivedState = receivedStates[index] || {};
      const product = item.product || '';
      const orderedQty = Number(receivedState.requestedQty ?? item.qty) || 0;
      const unit = getPoItemUnit(item, poCenter);
      const receivedQty = Number(receivedState.receivedQty) || 0;
      const remainingQty = Number(receivedState.remainingQty ?? Math.max(0, orderedQty - receivedQty)) || 0;
      const isFullyReceived = orderedQty > 0 && receivedQty >= orderedQty;
      const isPartiallyReceived = receivedQty > 0 && remainingQty > 0;

      let receivedLabel = '';

      if (isFullyReceived) {
        receivedLabel = `
          <small class="po-received-label is-complete">
            รับเข้าแล้วครบ ${receivedQty}/${orderedQty}
          </small>
        `;
      } else if (isPartiallyReceived) {
        receivedLabel = `
          <small class="po-received-label is-partial">
            รับเข้าแล้ว ${receivedQty}/${orderedQty}
          </small>
        `;
      } else {
        receivedLabel = `
          <small class="po-received-label is-waiting">
            ยังไม่รับเข้า
          </small>
        `;
      }

      return `
        <div 
          class="po-item-row ${isFullyReceived ? 'is-received-complete' : ''}" 
          data-product="${escapeHtml(product)}" 
          data-qty="${orderedQty}"
        >
          <div class="po-item-name">${escapeHtml(product || '-')}</div>

          <div class="po-item-qty po-item-qty-with-status">
            <strong>${orderedQty}</strong>
            ${receivedLabel}
          </div>

          <div class="po-item-unit">${escapeHtml(unit)}</div>
        </div>
      `;
    }).join('');

    return `
      <article class="stock-request-card" data-po-id="${escapeHtml(po.po_id || '')}">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลข PR</span>
            <strong>${escapeHtml(po.po_id || '-')}</strong>
          </div>

          <div class="po-status-box">
            <div class="po-status-top">
              <span class="overview-pill ${statusClass}">${statusText}</span>

              <button 
                class="btn-po-print" 
                type="button"
                onclick="printPoDocument('${escapeHtml(po.po_id || '')}')"
              >
                🖨️ พิมพ์ PR
              </button>

              ${canEditPo(po) ? `
                <button 
                  class="btn-po-edit" 
                  type="button"
                  data-edit-po-id="${escapeHtml(po.po_id || '')}"
                >
                  ✎ แก้ไข
                </button>
              ` : ''}
            </div>

            ${po.edited_at ? `
              <small class="po-edited-stamp">
                แก้ไขล่าสุดโดย ${escapeHtml(po.edited_by_name || po.edited_by_code || '-')}
                • ${new Date(po.edited_at).toLocaleString('th-TH')}
              </small>
            ` : ''}
          </div>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เปิด PR</span>
            <strong>${escapeHtml(po.po_date || '-')}</strong>
          </div>
          <div>
            <span>ผู้เปิด PR</span>
            <strong>${escapeHtml(po.po_person || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์รับเข้า</span>
            <strong>${escapeHtml(poCenter || '-')}</strong>
          </div>
        </div>

        ${po.note ? `
          <div class="stock-request-note">
            <span>หมายเหตุ</span>
            <p>${escapeHtml(po.note)}</p>
          </div>
        ` : ''}

        <div class="stock-request-items">
          <div class="stock-request-section-title">รายการสินค้า</div>

          <div class="po-items-table">
            <div class="po-items-head">
              <div>สินค้า</div>
              <div>จำนวน</div>
              <div>หน่วย</div>
            </div>

            ${itemList}
          </div>
        </div>

        ${isReceiveablePoRecord(po) && canReceivePo() && po.status !== 'received' ? `
          <div class="po-receive-actions">
            <button 
              class="btn-po-receive" 
              type="button" 
              data-receive-po-full="${escapeHtml(po.po_id || '')}"
            >
              รับเข้าทั้งใบ
            </button>

            <button 
              class="btn-po-receive-secondary" 
              type="button" 
              data-open-partial-po="${escapeHtml(po.po_id || '')}"
            >
              รับบางรายการ
            </button>
          </div>
        ` : ''}

        <div class="po-email-actions">
          <button
            class="btn-po-email"
            type="button"
            data-email-po-id="${escapeHtml(po.po_id || '')}"
            onclick="sendPoEmail('${escapeHtml(po.po_id || '')}', this)"
          >
            <span>📧</span>
            <span>ส่งอีเมล PR</span>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function enablePoEdit(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);
  const card = document.querySelector(`[data-po-id="${poId}"]`);

  if (!po || !card) {
    showToast('❌ ไม่พบข้อมูล PO นี้', 'error');
    return;
  }

  if (!canEditPo(po)) {
    showToast('⚠️ แก้ไขได้เฉพาะ PO ของศูนย์ตัวเอง', 'error');
    return;
  }

  card.classList.add('is-editing-po');

  if (card.querySelector('.po-edit-list')) {
    showToast('กำลังอยู่ในโหมดแก้ไขแล้ว', 'error');
    return;
  }

  const itemBox = card.querySelector('.po-items-table');
  if (!itemBox) return;

  const items = Array.isArray(po.items) ? po.items : [];

  if (!items.length) {
    showToast('⚠️ ไม่พบรายการสินค้าใน PO นี้', 'error');
    return;
  }

  const editRows = items.map((item) => {
    const product = item.product || '';
    const qty = Number(item.qty) || 0;

    return `
      <div class="po-edit-row">
        <select class="po-edit-product">
          <option value=""></option>
          ${PRODUCTS.map((p) => `
            <option value="${escapeHtml(p)}" ${p === product ? 'selected' : ''}>
              ${escapeHtml(p)}
            </option>
          `).join('')}
        </select>

        <input class="po-edit-qty" type="number" min="1" value="${qty}" />

        <button 
          class="btn-remove-row" 
          type="button" 
          onclick="this.closest('.po-edit-row').remove()"
        >
          ×
        </button>
      </div>
    `;
  }).join('');

  itemBox.innerHTML = `
    <div class="po-items-head">
      <div>สินค้า</div>
      <div>จำนวน</div>
      <div></div>
    </div>

    <div class="po-edit-list">
      ${editRows}
    </div>
  `;

  card.querySelectorAll('.po-edit-product').forEach((select) => {
    if (typeof enhanceProductSelect === 'function') {
      enhanceProductSelect(select);
    }
  });

  // ลบ footer เก่าถ้ามี
  card.querySelector('.po-edit-footer')?.remove();

  const editFooter = document.createElement('div');
  editFooter.className = 'po-edit-footer';

  editFooter.innerHTML = `
    <button 
      class="btn-request-secondary" 
      type="button" 
      onclick="addPoEditRow('${escapeHtml(poId)}')"
    >
      + เพิ่มรายการ
    </button>

    <button 
      class="btn-request-secondary" 
      type="button" 
      onclick="fetchPoStatus()"
    >
      ยกเลิก
    </button>

    <button 
      class="btn-request-primary" 
      type="button" 
      onclick="savePoEdit('${escapeHtml(poId)}')"
    >
      บันทึกแก้ไข
    </button>
  `;

  const stockItems = card.querySelector('.stock-request-items');
  if (stockItems) {
    stockItems.insertAdjacentElement('afterend', editFooter);
  } else {
    card.appendChild(editFooter);
  }
}

function addPoEditRow(poId) {
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  const list = card?.querySelector('.po-edit-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'po-edit-row';
  row.innerHTML = `
    <select class="po-edit-product">
      <option value=""></option>
      ${getProductOptions()}
    </select>

    <input class="po-edit-qty" type="number" min="1" placeholder="จำนวน" />

    <button class="btn-remove-row" type="button" onclick="this.closest('.po-edit-row').remove()">×</button>
  `;

  list.appendChild(row);

  const select = row.querySelector('.po-edit-product');
  if (select && typeof enhanceProductSelect === 'function') {
    enhanceProductSelect(select);
  }
}

async function savePoEdit(poId) {
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  if (!card) return;

  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);
  if (!canEditPo(po)) {
    showToast('⚠️ แก้ไขได้เฉพาะ PO ของศูนย์ตัวเอง', 'error');
    return;
  }

  const rows = card.querySelectorAll('.po-edit-row');

  const items = Array.from(rows).map((row) => {
    const product = row.querySelector('.po-edit-product')?.value || '';
    const qty = Number(row.querySelector('.po-edit-qty')?.value) || 0;

    return { product, qty };
  }).filter((item) => item.product && item.qty > 0);

  if (items.length === 0) {
    showToast('⚠️ กรุณาใส่รายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  showToast('', 'loading', 'กำลังบันทึกการแก้ไข PO...');

  try {
    const { data, error } = await supabaseClient.rpc('update_po_items', {
      p_po_id: poId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_items: items,
    });

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'แก้ไข PO ไม่สำเร็จ');
    }

    showToast('✅ แก้ไข PO สำเร็จ', 'success');
    fetchPoStatus();
    fetchPendingPoSummary?.();

  } catch (error) {
    console.error('savePoEdit error:', error);
    showToast(`❌ ${error.message || 'แก้ไข PO ไม่สำเร็จ'}`, 'error');
  }
}

document.addEventListener('click', (event) => {
  const receiveFullButton = event.target.closest('[data-receive-po-full]');
  if (receiveFullButton) {
    event.preventDefault();
    receivePoFull(receiveFullButton.dataset.receivePoFull || '');
    return;
  }

  const openPartialButton = event.target.closest('[data-open-partial-po]');
  if (openPartialButton) {
    event.preventDefault();
    openPartialReceivePo(openPartialButton.dataset.openPartialPo || '');
    return;
  }

  const saveSingleButton = event.target.closest('[data-save-single-partial-po]');
  if (saveSingleButton) {
    event.preventDefault();
    saveSinglePartialReceivePo(saveSingleButton.dataset.saveSinglePartialPo || '', saveSingleButton);
    return;
  }

  const saveEditsButton = event.target.closest('[data-save-partial-po-edits]');
  if (saveEditsButton) {
    event.preventDefault();
    savePartialPoQuantityEdits(saveEditsButton.dataset.savePartialPoEdits || '', saveEditsButton);
    return;
  }

  const button = event.target.closest('[data-edit-po-id]');
  if (!button) return;

  const poId = button.dataset.editPoId;
  enablePoEdit(poId);
});

function printPoDocument(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);

  if (!po) {
    showToast('❌ ไม่พบข้อมูล PO นี้', 'error');
    return;
  }

  const items = Array.isArray(po.items) ? po.items : [];
  const poCenter = getPoCenter(po);
  const receivedStates = getPoLineReceivedStates(po);

  const statusText = po.status === 'received'
    ? 'รับเข้าแล้ว'
    : po.status === 'partial_received'
      ? 'รับเข้าบางส่วน'
      : 'รอรับสินค้า';

  const itemRows = items.map((item, index) => {
    const receivedState = receivedStates[index] || {};
    const product = item.product || '';
    const orderedQty = Number(receivedState.requestedQty ?? item.qty) || 0;
    const receivedQty = Number(receivedState.receivedQty) || 0;
    const remainingQty = Number(receivedState.remainingQty ?? Math.max(0, orderedQty - receivedQty)) || 0;

    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(product || '-')}</td>
        <td class="num">${orderedQty}</td>
        <td class="num">${receivedQty}</td>
        <td class="num">${remainingQty}</td>
        <td></td>
        <td></td>
      </tr>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบ PR ${escapeHtml(po.po_id || '')}</title>
      <style>
        body {
          font-family: "Sarabun", Arial, sans-serif;
          color: #111827;
          padding: 24px;
          background: #ffffff;
        }

        .doc {
          max-width: 820px;
          margin: 0 auto;
        }

        h1 {
          margin: 0 0 6px;
          text-align: center;
          font-size: 24px;
        }

        .subtitle {
          text-align: center;
          color: #64748b;
          font-size: 13px;
          margin-bottom: 22px;
        }

        .meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 22px;
          margin-bottom: 18px;
          font-size: 14px;
        }

        .meta div {
          border-bottom: 1px solid #d1d5db;
          padding: 7px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 14px;
          font-size: 13px;
        }

        th, td {
          border: 1px solid #d1d5db;
          padding: 8px;
          vertical-align: middle;
        }

        th {
          background: #f3f4f6;
          text-align: center;
          font-weight: 800;
        }

        .center {
          text-align: center;
        }

        .num {
          text-align: center;
          font-weight: 800;
        }

        .note-box {
          margin-top: 18px;
          border: 1px solid #d1d5db;
          padding: 10px 12px;
          min-height: 44px;
          font-size: 14px;
        }

        .signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          margin-top: 58px;
          text-align: center;
          font-size: 14px;
        }

        .line {
          border-top: 1px solid #111827;
          padding-top: 8px;
        }

        @media print {
          body {
            padding: 0;
          }

          .doc {
            max-width: 100%;
          }
        }
      </style>
    </head>

    <body>
      <div class="doc">
        <h1>ใบขอซื้อ / PR</h1>
        <div class="subtitle">สำหรับตรวจเช็กรายการเมื่อสินค้ามาส่ง</div>

        <div class="meta">
          <div><strong>เลข PR:</strong> ${escapeHtml(po.po_id || '-')}</div>
          <div><strong>สถานะ:</strong> ${escapeHtml(statusText)}</div>
          <div><strong>วันที่เปิด PR:</strong> ${escapeHtml(po.po_date || '-')}</div>
          <div><strong>ผู้เปิด PR:</strong> ${escapeHtml(po.po_person || '-')}</div>
          <div><strong>ศูนย์รับเข้า:</strong> ${escapeHtml(poCenter || '-')}</div>
          <div><strong>วันที่พิมพ์:</strong> ${new Date().toLocaleString('th-TH')}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 42px;">ลำดับ</th>
              <th>รายการสินค้า</th>
              <th style="width: 80px;">จำนวน PR</th>
              <th style="width: 90px;">รับเข้าแล้ว</th>
              <th style="width: 80px;">คงเหลือ</th>
              <th style="width: 100px;">จำนวนที่มาส่ง</th>
              <th style="width: 130px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || `
              <tr>
                <td colspan="7" class="center">ไม่มีรายการสินค้า</td>
              </tr>
            `}
          </tbody>
        </table>

        ${po.note ? `
          <div class="note-box">
            <strong>หมายเหตุ PR:</strong> ${escapeHtml(po.note)}
          </div>
        ` : `
          <div class="note-box">
            <strong>หมายเหตุ PR:</strong>
          </div>
        `}

        <div class="signatures">
          <div>
            <div class="line">ผู้ตรวจรับสินค้า</div>
          </div>
          <div>
            <div class="line">ผู้ส่งสินค้า / ผู้เกี่ยวข้อง</div>
          </div>
        </div>
      </div>

      <script>
        window.onload = function () {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    showToast('⚠️ กรุณาอนุญาต Pop-up เพื่อพิมพ์ PR', 'error');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function printPickList(requestId) {
  const request = pendingTransfers.find((item) => item.requestId === requestId);

  if (!request) {
    showToast('❌ ไม่พบใบขอเบิกนี้', 'error');
    return;
  }

  const card = document.querySelector(`[data-request-id="${requestId}"]`);
  const inputs = card ? card.querySelectorAll('.prepared-qty-input') : [];

  const preparedItems = inputs.length
    ? Array.from(inputs).map((input) => ({
        product: input.dataset.product || '',
        requestedQty: Number(input.dataset.max) || 0,
        preparedQty: Number(input.value) || 0,
      }))
    : (request.items || []).map((item) => ({
        product: item.product,
        requestedQty: Number(item.qty) || 0,
        preparedQty: Number(item.qty) || 0,
      }));

  const itemRows = preparedItems.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.product || '-')}</td>
      <td class="num">${item.requestedQty}</td>
      <td class="num">${item.preparedQty}</td>
      <td></td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบจัดของ ${escapeHtml(request.requestId || '')}</title>
      <style>
        body {
          font-family: "Sarabun", Arial, sans-serif;
          padding: 24px;
          color: #111827;
        }

        .doc {
          max-width: 760px;
          margin: 0 auto;
        }

        h1 {
          text-align: center;
          font-size: 24px;
          margin: 0 0 20px;
        }

        .meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 20px;
          margin-bottom: 18px;
          font-size: 14px;
        }

        .meta div {
          border-bottom: 1px solid #d1d5db;
          padding: 6px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 14px;
          font-size: 14px;
        }

        th, td {
          border: 1px solid #d1d5db;
          padding: 8px;
        }

        th {
          background: #f3f4f6;
          text-align: center;
        }

        .num {
          text-align: center;
          font-weight: 700;
        }

        .signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin-top: 52px;
          text-align: center;
          font-size: 14px;
        }

        .line {
          border-top: 1px solid #111827;
          padding-top: 8px;
        }

        @media print {
          body {
            padding: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="doc">
        <h1>ใบจัดของ</h1>

        <div class="meta">
          <div><strong>เลขใบเบิก:</strong> ${escapeHtml(request.requestId || '-')}</div>
          <div><strong>วันที่เบิก:</strong> ${escapeHtml(request.date || '-')}</div>
          <div><strong>ศูนย์:</strong> ${escapeHtml(request.center || '-')}</div>
          <div><strong>ผู้เบิก:</strong> ${escapeHtml(request.staffName || request.staffCode || '-')}</div>
          <div><strong>ผู้จัดของ:</strong> ${escapeHtml(currentUser?.name || currentUser?.code || '-')}</div>
          <div><strong>วันที่พิมพ์:</strong> ${new Date().toLocaleString('th-TH')}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 46px;">ลำดับ</th>
              <th>รายการสินค้า</th>
              <th style="width: 90px;">จำนวนขอ</th>
              <th style="width: 90px;">จำนวนจัด</th>
              <th style="width: 120px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div class="signatures">
          <div>
            <div class="line">ผู้จัดของ</div>
          </div>
          <div>
            <div class="line">ผู้รับของ</div>
          </div>
        </div>
      </div>

      <script>
        window.onload = function () {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('⚠️ กรุณาอนุญาต Pop-up เพื่อพิมพ์ใบจัดของ', 'error');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function printCompletedRequestPickList(requestId) {
  const request = [
    ...(window.currentRequestStatusList || []),
    ...(window.adminRequestHistoryList || []),
  ].find((item) => (item.request_id || item.requestId) === requestId);

  if (!request) {
    showToast('❌ ไม่พบใบขอเบิกนี้', 'error');
    return;
  }

  const items = Array.isArray(request.prepared_items) && request.prepared_items.length
    ? request.prepared_items
    : request.items || [];

  const itemRows = items.map((item, index) => {
    const product = item.product || '';
    const qty = Number(item.qty) || 0;
    const unit = String(
      item.Unit
      || item.unit
      || item.unit_name
      || (typeof getStockUnit === 'function' ? getStockUnit(request.center, product) : '')
      || ''
    ).trim();

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(product || '-')}</td>
        <td class="num">${qty}</td>
        <td>${escapeHtml(unit)}</td>
        <td></td>
      </tr>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบเบิก ${escapeHtml(request.request_id || '')}</title>
      <style>
        body { font-family: "Sarabun", Arial, sans-serif; padding: 24px; color: #111827; }
        .doc { max-width: 760px; margin: 0 auto; }
        h1 { text-align: center; font-size: 24px; margin: 0 0 20px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin-bottom: 18px; font-size: 14px; }
        .meta div { border-bottom: 1px solid #d1d5db; padding: 6px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; }
        th { background: #f3f4f6; text-align: center; }
        .num { text-align: center; font-weight: 700; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 52px; text-align: center; font-size: 14px; }
        .line { border-top: 1px solid #111827; padding-top: 8px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc">
        <h1>ใบเบิกสินค้า</h1>

        <div class="meta">
          <div><strong>เลขใบเบิก:</strong> ${escapeHtml(request.request_id || '-')}</div>
          <div><strong>วันที่เบิก:</strong> ${escapeHtml(request.request_date || '-')}</div>
          <div><strong>ศูนย์:</strong> ${escapeHtml(request.center || '-')}</div>
          <div><strong>จัดของเมื่อ:</strong> ${request.picked_at ? new Date(request.picked_at).toLocaleString('th-TH') : '-'}</div>
          <div><strong>วันที่พิมพ์:</strong> ${new Date().toLocaleString('th-TH')}</div>
          <div><strong>สถานะ:</strong> จัดเตรียมเรียบร้อย</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 46px;">ลำดับ</th>
              <th>รายการสินค้า</th>
              <th style="width: 90px;">จำนวน</th>
              <th style="width: 90px;">หน่วย</th>
              <th style="width: 120px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <div class="signatures">
          <div><div class="line">ผู้ส่งมอบ</div></div>
          <div><div class="line">ผู้รับของ</div></div>
        </div>
      </div>

      <script>
        window.onload = function () {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('⚠️ กรุณาอนุญาต Pop-up เพื่อพิมพ์ใบเบิก', 'error');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function printStaffPendingRequest(requestId) {
  const request = [
    ...(window.staffPendingRequestList || []),
    ...(window.currentRequestStatusList || []),
    ...(window.adminRequestHistoryList || []),
  ]
    .find((item) => (item.requestId || item.request_id) === requestId);

  if (!request) {
    showToast('❌ ไม่พบใบขอเบิกนี้', 'error');
    return;
  }

  const items = Array.isArray(request.items) ? request.items : [];
  const itemRows = items.map((item, index) => {
    const unit = getRequestItemUnit(request, item);

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.product || '-')}</td>
        <td class="num">${Number(item.qty) || 0}</td>
        <td>${escapeHtml(unit)}</td>
        <td></td>
      </tr>
    `;
  }).join('');

  const requestNo = request.requestId || request.request_id || '';
  const requestDate = request.date || request.request_date || '';
  const staffName = request.staffName || request.staff_name || request.staffCode || request.staff_code || '';

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบขอเบิก ${escapeHtml(requestNo)}</title>
      <style>
        body { font-family: "Sarabun", Arial, sans-serif; padding: 24px; color: #111827; }
        .doc { max-width: 760px; margin: 0 auto; }
        h1 { text-align: center; font-size: 24px; margin: 0 0 20px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin-bottom: 18px; font-size: 14px; }
        .meta div { border-bottom: 1px solid #d1d5db; padding: 6px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; }
        th { background: #f3f4f6; text-align: center; }
        .num { text-align: center; font-weight: 700; }
        .note { margin-top: 14px; border: 1px solid #d1d5db; padding: 10px; font-size: 14px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 52px; text-align: center; font-size: 14px; }
        .line { border-top: 1px solid #111827; padding-top: 8px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc">
        <h1>ใบขอเบิกสินค้า</h1>

        <div class="meta">
          <div><strong>เลขใบเบิก:</strong> ${escapeHtml(requestNo || '-')}</div>
          <div><strong>วันที่เบิก:</strong> ${escapeHtml(requestDate || '-')}</div>
          <div><strong>ศูนย์:</strong> ${escapeHtml(request.center || '-')}</div>
          <div><strong>ผู้เบิก:</strong> ${escapeHtml(staffName || '-')}</div>
          <div><strong>วันที่พิมพ์:</strong> ${new Date().toLocaleString('th-TH')}</div>
          <div><strong>สถานะ:</strong> รอแอดมินจัดของ</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 46px;">ลำดับ</th>
              <th>รายการสินค้า</th>
              <th style="width: 90px;">จำนวน</th>
              <th style="width: 90px;">หน่วย</th>
              <th style="width: 120px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        ${request.note ? `<div class="note"><strong>หมายเหตุ:</strong> ${escapeHtml(request.note)}</div>` : ''}

        <div class="signatures">
          <div><div class="line">ผู้เบิก</div></div>
          <div><div class="line">ผู้อนุมัติ / ผู้จัดของ</div></div>
        </div>
      </div>

      <script>
        window.onload = function () {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('⚠️ กรุณาอนุญาต Pop-up เพื่อพิมพ์ใบขอเบิก', 'error');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function getPoRemainingItems(po) {
  return getPoLineReceivedStates(po)
    .filter((item) => item.product && item.remainingQty > 0);
}

async function receivePoFull(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);

  if (!po) {
    showToast('❌ ไม่พบ PO นี้', 'error');
    return;
  }

  const items = getPoRemainingItems(po).map((item) => ({
    product: item.product,
    qty: item.remainingQty,
    lineIndex: item.lineIndex,
    line_index: item.lineIndex,
    center: getPoCenter(po),
    stock_center: getPoCenter(po),
  }));

  if (items.length === 0) {
    showToast('⚠️ PO นี้รับสินค้าเข้าครบแล้ว', 'error');
    return;
  }

  const targetCenter = getPoCenter(po);
  const ok = confirm(`ยืนยันรับสินค้าเข้าทั้งใบ${targetCenter ? ` เข้าสต็อก ${targetCenter}` : ''} ใช่ไหม?`);
  if (!ok) return;

  await receivePoItems(poId, items);
}

function openPartialReceivePo(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);
  const card = document.querySelector(`[data-po-id="${poId}"]`);

  if (card) {
    card.classList.remove('is-editing-po');
  }

  if (!po) {
    showToast('❌ ไม่พบข้อมูล PO นี้ กรุณารีเฟรชรายการ', 'error');
    return;
  }

  if (!card) {
    showToast('❌ ไม่พบการ์ด PO นี้บนหน้าจอ', 'error');
    return;
  }

  const remainingItems = getPoRemainingItems(po);
  const itemBox = card.querySelector('.po-items-table');
  if (!itemBox) return;

  const receiveActions = card.querySelector('.po-receive-actions');
  if (receiveActions) {
    receiveActions.style.display = 'none';
  }

  if (remainingItems.length === 0) {
    showToast('⚠️ PO นี้ไม่มีรายการค้างรับเข้าแล้ว', 'error');
    return;
  }

  itemBox.innerHTML = `
    <div class="po-partial-table">
      <div class="po-partial-grid po-partial-header">
        <div>สินค้า</div>
        <div>PO เดิม</div>
        <div>รับเข้าแล้ว</div>
        <div>คงเหลือ</div>
        <div>รับเข้าครั้งนี้</div>
        <div>บันทึก</div>
      </div>

      ${remainingItems.map((item) => `
        <div class="po-partial-row po-partial-line po-partial-grid">
          <div class="po-item-name">${escapeHtml(item.product)}</div>

          <div class="po-item-qty" data-role="requested-qty">${item.requestedQty}</div>

          <div class="po-item-qty" data-role="received-qty">${item.receivedQty}</div>

          <div class="po-item-qty" data-role="remaining-qty">${item.remainingQty}</div>

          <div class="po-receive-input-cell">
          <input
            class="po-partial-qty"
            type="number"
            min="0"
            value="${item.remainingQty}"
            data-product="${escapeHtml(item.product)}"
            data-requested-qty="${item.requestedQty}"
            data-received-qty="${item.receivedQty}"
            data-remaining-qty="${item.remainingQty}"
            data-line-index="${item.lineIndex}"
            data-original-value="${item.remainingQty}"
            oninput="markPartialReceiveDirty(this)"
          />
          </div>

          <div class="po-save-cell">
            <button 
              class="btn-save-partial-line" 
              type="button"
              data-save-single-partial-po="${escapeHtml(poId)}"
            >
              บันทึก
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const actionBox = card.querySelector('.po-receive-actions');

  if (actionBox) {
    actionBox.style.display = '';
    actionBox.classList.add('is-partial-mode');

    actionBox.innerHTML = `
      <button 
        class="btn-po-receive" 
        type="button" 
        data-receive-po-full="${escapeHtml(poId)}"
      >
        รับเข้าทั้งใบ
      </button>

      <button 
        class="btn-po-receive-secondary" 
        type="button" 
        data-open-partial-po="${escapeHtml(poId)}"
      >
        รีเฟรชรายการค้างรับ
      </button>

      <button 
        class="btn-po-finish" 
        type="button" 
        data-save-partial-po-edits="${escapeHtml(poId)}"
      >
        เสร็จสิ้น
      </button>
    `;
  }
}

function markPartialReceiveDirty(input) {
  if (!input) return;
  input.dataset.dirty = String(input.value !== input.dataset.originalValue);
}

async function savePartialReceivePo(poId, options = {}) {
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  if (!card) return;

  const dirtyOnly = options.dirtyOnly === true;
  const fallbackRefresh = options.fallbackRefresh === true;
  const inputs = Array.from(card.querySelectorAll('.po-partial-qty'))
    .filter((input) => !dirtyOnly || input.dataset.dirty === 'true');

  const items = inputs.map((input) => {
    const product = input.dataset.product || '';
    let qty = Number(input.value) || 0;

    if (qty < 0) qty = 0;

    return { product, qty };
  }).map((item, index) => {
    const input = inputs[index];
    const lineIndex = Number(input?.dataset.lineIndex ?? -1);
    return {
      ...item,
      lineIndex: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
      line_index: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
    };
  }).filter((item) => item.product && item.qty > 0);

  if (items.length === 0) {
    if (fallbackRefresh) {
      await fetchPoStatus();
      return;
    }

    showToast('⚠️ กรุณาระบุจำนวนรับเข้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  await receivePoItems(poId, items);
}

async function savePartialPoQuantityEdits(poId, button) {
  const card = document.querySelector(`[data-po-id="${CSS.escape(poId)}"]`);
  if (!card) {
    showToast('❌ ไม่พบการ์ด PO นี้บนหน้าจอ', 'error');
    return;
  }

  const inputs = Array.from(card.querySelectorAll('.po-partial-qty'))
    .filter((input) => input.dataset.dirty === 'true');

  if (inputs.length === 0) {
    await fetchPoStatus();
    return;
  }

  const items = inputs.map((input) => {
    const lineIndex = Number(input.dataset.lineIndex ?? -1);
    const receivedQty = Number(input.dataset.receivedQty || 0);
    const editedRemainingQty = Math.max(0, Number(input.value) || 0);

    return {
      product: input.dataset.product || '',
      qty: receivedQty + editedRemainingQty,
      remainingQty: editedRemainingQty,
      lineIndex: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
      line_index: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
      input,
    };
  }).filter((item) => item.product && item.lineIndex !== undefined);

  if (!items.length) {
    showToast('⚠️ ไม่พบรายการที่ต้องแก้ไข', 'error');
    return;
  }

  const ok = confirm('ยืนยันบันทึกยอด PO ที่แก้ไข โดยยังไม่รับเข้าสต็อก ใช่ไหม?');
  if (!ok) return;

  if (button) button.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกยอด PO ที่แก้ไข...');

  try {
    const { data, error } = await supabaseClient.rpc('update_po_line_quantities', {
      p_po_id: poId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_items: items.map(({ input, ...item }) => item),
    });

    if (error) throw error;

    if (!data || data.success !== true || Number(data.matched_count ?? data.matchedCount ?? 0) <= 0) {
      throw new Error(data?.message || 'บันทึกยอด PO ที่แก้ไขไม่สำเร็จ');
    }

    items.forEach(({ input, qty, remainingQty }) => {
      const row = input.closest('.po-partial-row, .po-partial-line');
      input.dataset.requestedQty = String(qty);
      input.dataset.remainingQty = String(remainingQty);
      input.dataset.originalValue = String(remainingQty);
      input.dataset.dirty = 'false';
      setPartialReceiveCell(row, 'requested-qty', qty);
      setPartialReceiveCell(row, 'remaining-qty', remainingQty);
    });

    showToast('✅ บันทึกยอด PO ที่แก้ไขแล้ว ยังไม่ได้รับเข้าสต็อก', 'success');
    await fetchPoStatus();
    fetchPendingPoSummary?.();

  } catch (error) {
    console.error('savePartialPoQuantityEdits error:', error);
    showToast(`❌ ${error.message || 'บันทึกยอด PO ที่แก้ไขไม่สำเร็จ'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function receivePoItems(poId, items, options = {}) {
  const shouldRefreshPoStatus = options.refreshPoStatus !== false;
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId) || {};
  const targetCenter = options.center || getPoCenter(po) || currentUser?.center || '';

  const validItems = (items || [])
    .map((item) => ({
      product: item.product,
      qty: Number(item.qty || 0),
      remainingQty: Number(item.remainingQty || item.remaining_qty || 0),
      lineIndex: item.lineIndex ?? item.line_index,
      center: item.center || item.stock_center || targetCenter,
      ...getPoReceiveLineMeta(po, item),
    }))
    .filter((item) => item.product && item.qty > 0);

  if (validItems.length === 0) {
    showToast('⚠️ กรุณากรอกจำนวนสินค้าที่ต้องการรับเข้า', 'error');
    return null;
  }

  showToast('', 'loading', 'กำลังรับสินค้าเข้า...');

  try {
    const receiveParams = {
      p_receive_request_id: newRequestId('receive-po'),
      p_po_id: poId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_center: targetCenter,
      p_items: validItems.map((item) => ({
        product: item.product,
        qty: item.qty,
        line_index: item.lineIndex,
        lineIndex: item.lineIndex,
        unit: item.unit,
        unit_qty: item.unit_qty,
        unitQty: item.unit_qty,
        unit_price: item.unit_price,
        unitPrice: item.unit_price,
        total_price: item.total_price,
        totalPrice: item.total_price,
        center: item.center || targetCenter,
        stock_center: item.center || targetCenter,
      })),
    };

    let { data, error } = await supabaseClient.rpc('receive_po_items', receiveParams);

    if (error && isRpcSignatureError(error)) {
      const { p_center, ...fallbackParams } = receiveParams;
      const fallback = await supabaseClient.rpc('receive_po_items', fallbackParams);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'รับสินค้าเข้าไม่สำเร็จ');
    }

    showToast(`✅ ${data.message || 'รับสินค้าเข้าสำเร็จ'}`, 'success');

    if (shouldRefreshPoStatus) {
      await fetchPoStatus();
    }

    if (typeof fetchFreshStock === 'function') {
      await fetchFreshStock();
    } else {
      await fetchStock();
    }
    fetchPendingPoSummary?.();

    return data;

  } catch (error) {
    console.error('receivePoItems error:', error);
    showToast(`❌ ${error.message || 'รับสินค้าเข้าไม่สำเร็จ'}`, 'error');
    return null;
  }
}

function getPoReceiveLineMeta(po = {}, receivedItem = {}) {
  const lineIndexValue = receivedItem.lineIndex ?? receivedItem.line_index;
  const lineIndex = lineIndexValue === undefined || lineIndexValue === null || lineIndexValue === ''
    ? -1
    : Number(lineIndexValue);
  const poItems = Array.isArray(po.items) ? po.items : [];
  const poLine = Number.isInteger(lineIndex) && lineIndex >= 0
    ? poItems[lineIndex]
    : poItems.find((item) => item.product === receivedItem.product);

  if (!poLine) {
    return {};
  }

  const unit = getPoItemUnit(poLine, getPoCenter(po));
  const unitQty = Number(
    poLine.unit_qty
    ?? poLine.unitQty
    ?? poLine.unit_count
    ?? poLine.unitCount
    ?? 0
  ) || null;
  const totalPrice = Number(
    poLine.total_price
    ?? poLine.totalPrice
    ?? poLine.line_total
    ?? poLine.lineTotal
    ?? 0
  ) || null;
  const unitPrice = Number(
    poLine.unit_price
    ?? poLine.unitPrice
    ?? 0
  ) || (totalPrice && unitQty ? totalPrice / unitQty : null);

  return {
    unit,
    unit_qty: unitQty,
    unit_price: unitPrice,
    total_price: totalPrice,
  };
}

function setPartialReceiveCell(row, role, value) {
  const cell = row.querySelector(`[data-role="${role}"]`);
  if (cell) {
    cell.textContent = value;
  }
}

function updatePartialReceiveRowAfterSave(row, receivedThisTime) {
  const input = row.querySelector('.po-partial-qty');
  const button = row.querySelector('.btn-save-partial-line');

  if (!input) return;

  const requestedQty = Number(input.dataset.requestedQty || 0);
  const oldReceivedQty = Number(input.dataset.receivedQty || 0);

  const newReceivedQty = oldReceivedQty + receivedThisTime;
  const nextRequestedQty = Math.max(requestedQty, newReceivedQty);
  const newRemainingQty = Math.max(0, nextRequestedQty - newReceivedQty);

  input.dataset.requestedQty = String(nextRequestedQty);
  input.dataset.receivedQty = String(newReceivedQty);
  input.dataset.remainingQty = String(newRemainingQty);

  setPartialReceiveCell(row, 'requested-qty', nextRequestedQty);
  setPartialReceiveCell(row, 'received-qty', newReceivedQty);
  setPartialReceiveCell(row, 'remaining-qty', newRemainingQty);

  if (newRemainingQty <= 0) {
    input.value = 0;
    input.dataset.originalValue = '0';
    input.disabled = true;

    if (button) {
      button.disabled = true;
      button.textContent = 'ครบแล้ว';
    }

    row.classList.add('is-received-complete');
    return;
  }

  input.value = newRemainingQty;
  input.dataset.originalValue = String(newRemainingQty);
}

async function saveSinglePartialReceivePo(poId, button) {
  const row = button.closest('.po-partial-row, .po-partial-line');
  if (!row) {
    showToast('❌ ไม่พบแถวรายการรับเข้า', 'error');
    return;
  }

  const input = row.querySelector('.po-partial-qty');
  if (!input) {
    showToast('❌ ไม่พบช่องจำนวนรับเข้า', 'error');
    return;
  }

  const product = input.dataset.product || '';
  const remainingQty = Number(input.dataset.remainingQty || 0);
  const lineIndex = Number(input.dataset.lineIndex ?? -1);
  let qty = Number(input.value) || 0;

  if (!product) {
    showToast('⚠️ ไม่พบชื่อสินค้า', 'error');
    return;
  }

  if (qty <= 0) {
    showToast('⚠️ กรุณาใส่จำนวนรับเข้า', 'error');
    input.focus();
    return;
  }

  const ok = confirm(`ยืนยันรับเข้า ${product} จำนวน ${qty} ชิ้น ใช่ไหม?`);
  if (!ok) return;

  button.disabled = true;

  const result = await receivePoItems(
    poId,
    [
      {
        product,
        qty,
        remainingQty,
        lineIndex: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
        line_index: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : undefined,
      },
    ],
    {
      refreshPoStatus: false,
    }
  );

  if (!result || result.success !== true) {
    button.disabled = false;
    return;
  }

  updatePartialReceiveRowAfterSave(row, qty);
  input.dataset.dirty = 'false';

  if (!row.classList.contains('is-received-complete')) {
    button.disabled = false;
  }
}

async function fetchRequestStatus() {
  if (currentUser?.role === 'center_staff' && typeof fetchStaffRequestHistory === 'function') {
    if (typeof fetchStaffPendingRequests === 'function') {
      await fetchStaffPendingRequests();
    }
    await fetchStaffRequestHistory();
    return;
  }

  const box = document.getElementById('request-status-list');
  if (!box) return;

  box.innerHTML = '<div class="empty-state">กำลังโหลดสถานะใบขอเบิก...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_recent_completed_stock_requests', {
      p_staff_code: currentUser?.code || '',
    });

    if (error) {
      throw error;
    }

    renderRequestStatus(data || []);

  } catch (error) {
    console.error('fetchRequestStatus error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดสถานะใบขอเบิกไม่สำเร็จ')}</div>`;
  }
}

function renderRequestStatus(requestList) {
  const box = document.getElementById('request-status-list');
  if (!box) return;

  window.currentRequestStatusList = requestList || [];

  const badge = document.getElementById('request-status-badge');

  // ปิด badge เก่าถาวร ไม่ให้นับ completed ทุกครั้งที่ login
  // badge แจ้งเตือนจริงให้ใช้ระบบ seen/unseen ใน app.js เท่านั้น
  if (badge) {
    badge.hidden = true;
    badge.textContent = '';
    badge.style.display = 'none';
  }

  if (!requestList.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีใบเบิกที่ต้องแสดง</div>';
    return;
  }

  box.innerHTML = renderRequestHistoryCards(requestList, {
    emptyText: 'ยังไม่มีใบเบิกที่ต้องแสดง',
  });
}
