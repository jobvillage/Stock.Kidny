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
    const itemRows = (request.items || []).map((item, index) => {
      const product = item.product || '';
      const qty = Number(item.qty) || 0;

      return `
        <div class="pick-item-row">
          <div class="pick-item-name">
            <strong>${escapeHtml(product)}</strong>
            <small>จำนวนที่ขอ: ${qty} ชิ้น</small>
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
      <article class="stock-request-card" data-request-id="${escapeHtml(request.requestId || '')}">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลขใบเบิก</span>
            <strong>${escapeHtml(request.requestId || '-')}</strong>
          </div>
          <span class="request-status-pill">รอดำเนินการ</span>
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

        <div class="stock-request-items">
          <div class="stock-request-section-title">รายการสินค้า</div>

          <div class="po-items-table">
            <div class="po-items-head">
              <div>สินค้า</div>
              <div>จำนวน</div>
              <div>หน่วย</div>
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
  let max = Number(input.dataset.max) || 0;
  let num = Number(value || 0);

  if (num < 0) num = 0;
  if (max > 0 && num > max) num = max;

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

  const items = Array.from(inputs)
    .map((input) => ({
      product: input.dataset.product,
      qty: Number(input.value) || 0,
    }))
    .filter((item) => item.product && item.qty > 0);

  if (items.length === 0) {
    showToast('⚠️ กรุณาระบุจำนวนที่จัดอย่างน้อย 1 รายการ', 'error');
    return;
  }

  const ok = confirm('ยืนยันจัดของและตัดสต็อกใช่ไหม?');
  if (!ok) return;

  showToast('', 'loading', 'กำลังยืนยันจัดของ...');

  try {
    const { data, error } = await supabaseClient.rpc('complete_stock_request', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'ยืนยันจัดของไม่สำเร็จ');
    }

    showToast('✅ จัดของและตัดสต็อกสำเร็จ', 'success');

    fetchStock();
    fetchPendingTransfers();

  } catch (error) {
    console.error('complete_stock_request error:', error);
    showToast(`❌ ${error.message || 'ยืนยันจัดของไม่สำเร็จ'}`, 'error');
  }
}

function renderPoCmoForm() {
  const panel = document.getElementById('panel-transfer');
  if (!panel) return;

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon transfer">📝</span>
      <div>
        <h2>เปิด PO</h2>
        <p>สร้างรายการสั่งสินค้า เพื่อรอรับสินค้าเข้าสต็อก</p>
      </div>
    </div>

    <div class="form-grid">
      <div class="field-group">
        <label for="po-date">วันที่เปิด PO</label>
        <input type="date" id="po-date" />
      </div>

      <div class="field-group">
        <label for="po-person">ผู้เปิด PO</label>
        <input type="text" id="po-person" placeholder="กรอกชื่อผู้เปิด PO"/>
      </div>

      <div class="field-group field-group-full">
        <label for="po-note">หมายเหตุ</label>
        <input type="text" id="po-person" placeholder="หมายเหตุ"/>
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="products-header">
      <div>
        <span>รายการสินค้าเปิด PO</span>
        <small>เลือกสินค้าและจำนวนที่ต้องการสั่ง</small>
      </div>
      <button class="btn-add-row transfer" type="button" id="btn-add-po-row">
        + เพิ่มรายการ
      </button>
    </div>

    <div id="po-products" class="product-list"></div>

    <button class="btn-submit btn-submit-transfer" id="btn-submit-po" type="button">
      <span>📝</span>
      <span>บันทึกรายการเปิด PO</span>
    </button>
  `;

  setToday('po-date');

  document.getElementById('btn-add-po-row')?.addEventListener('click', addPoRow);
  document.getElementById('btn-submit-po')?.addEventListener('click', submitPoCmo);

  addPoRow();
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

    <input type="number" min="1" inputmode="numeric" placeholder="จำนวน" aria-label="จำนวนเปิด PO" />

    <button class="btn-remove-row" type="button" title="ลบรายการ" aria-label="ลบรายการ">×</button>
  `;

  row.querySelector('.btn-remove-row')?.addEventListener('click', (event) => removeRow(event.currentTarget));

  container.appendChild(row);

  const select = row.querySelector('.product-select');
  if (select && typeof enhanceProductSelect === 'function') {
    enhanceProductSelect(select);
  }
}

async function submitPoCmo() {
  const btn = document.getElementById('btn-submit-po');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('po-date')?.value;
  const person = document.getElementById('po-person')?.value.trim() || '';
  const note = document.getElementById('po-note')?.value.trim() || '';
  const rows = document.querySelectorAll('#po-products .product-row');

  const items = Array.from(rows).map((row) => {
    const product = row.querySelector('select')?.value || '';
    const qty = Number(row.querySelector('input[type="number"]')?.value) || 0;

    return { product, qty };
  }).filter((item) => item.product && item.qty > 0);

  if (!date) {
    showToast('⚠️ กรุณาเลือกวันที่เปิด PO', 'error');
    return;
  }

  if (!person) {
    showToast('⚠️ กรุณากรอกชื่อผู้เปิด PO', 'error');
    document.getElementById('po-person')?.focus();
    return;
  }

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  btn.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกรายการเปิด PO...');

  try {
    const { data, error } = await supabaseClient.rpc('create_po_cmo', {
      p_client_request_id: newRequestId('po'),
      p_staff_code: currentUser?.code || '',
      p_date: date,
      p_person: person,
      p_note: note,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึก PO ไม่สำเร็จ');
    }

    showToast(`✅ บันทึก PO สำเร็จ: ${data.po_id || ''}`, 'success');

    fetchPoStatus();

    const poNote = document.getElementById('po-note');
    if (poNote) poNote.value = '';

    const poPerson = document.getElementById('po-person');
    if (poPerson) poPerson.value = '';

    const container = document.getElementById('po-products');
    if (container) {
      container.innerHTML = '';
      addPoRow();
    }

    if (document.getElementById('po-date')) {
      setToday('po-date');
    }

  } catch (error) {
    console.error('create_po_cmo error:', error);
    showToast(`❌ ${error.message || 'บันทึก PO ไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function fetchPoStatus() {
  const box = document.getElementById('po-status-list');
  if (!box) return;

  box.innerHTML = '<div class="empty-state">กำลังโหลดสถานะ PO...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_po_status');

    if (error) {
      throw error;
    }

    let poList = data || [];

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

    // Staff: PO ที่รับเข้าแล้ว ให้ยังเห็นได้ไม่เกิน 1 วัน แล้วค่อยหาย
    if (currentUser?.role === 'center_staff') {
      const oneDayMs = 24 * 60 * 60 * 1000;
      const now = new Date();

      poList = poList.filter((po) => {
        if (po.status !== 'received') return true;

        const receivedDateText =
          po.received_at ||
          po.completed_at ||
          po.updated_at ||
          po.created_at;

        if (!receivedDateText) return false;

        const receivedDate = new Date(receivedDateText);

        return now - receivedDate <= oneDayMs;
      });
    }

    renderPoStatus(poList);

  } catch (error) {
    console.error('fetchPoStatus error:', error);
    box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดสถานะ PO ไม่สำเร็จ')}</div>`;
  }
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

    const items = Array.isArray(po.items) ? po.items : [];

    const itemList = items.map((item) => {
      return `
        <div class="po-item-row" data-product="${escapeHtml(item.product || '')}" data-qty="${Number(item.qty) || 0}">
          <div class="po-item-name">${escapeHtml(item.product || '-')}</div>
          <div class="po-item-qty">${Number(item.qty) || 0}</div>
          <div class="po-item-unit">ชิ้น</div>
        </div>
      `;
    }).join('');

    return `
      <article class="stock-request-card" data-po-id="${escapeHtml(po.po_id || '')}">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลข PO</span>
            <strong>${escapeHtml(po.po_id || '-')}</strong>
          </div>

          <div class="po-status-box">
            <div class="po-status-top">
              <span class="overview-pill ${statusClass}">${statusText}</span>

              ${po.status !== 'received' ? `
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
            <span>วันที่เปิด PO</span>
            <strong>${escapeHtml(po.po_date || '-')}</strong>
          </div>
          <div>
            <span>ผู้เปิด PO</span>
            <strong>${escapeHtml(po.po_person || '-')}</strong>
          </div>
          <div>
            <span>สถานะ</span>
            <strong>${statusText}</strong>
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

        ${(currentUser?.role === 'admin' || currentUser?.role === 'stock_receiver') && po.status !== 'received' ? `
          <div class="po-receive-actions">
            <button 
              class="btn-po-receive" 
              type="button" 
              onclick="receivePoFull('${escapeHtml(po.po_id || '')}')"
            >
              รับเข้าทั้งใบ
            </button>

            <button 
              class="btn-po-receive-secondary" 
              type="button" 
              onclick="openPartialReceivePo('${escapeHtml(po.po_id || '')}')"
            >
              รับบางรายการ
            </button>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function enablePoEdit(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);
  const card = document.querySelector(`[data-po-id="${poId}"]`);

  if (card) {
    card.classList.add('is-editing-po');
  }

  if (!po || !card) {
    showToast('❌ ไม่พบข้อมูล PO นี้', 'error');
    return;
  }

  // กันกดแก้ไขซ้ำตอนอยู่ในโหมดแก้ไขแล้ว
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

        <button class="btn-remove-row" type="button" onclick="this.closest('.po-edit-row').remove()">×</button>
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

    <div class="po-edit-actions">
      <button class="btn-request-secondary" type="button" onclick="addPoEditRow('${escapeHtml(poId)}')">
        + เพิ่มรายการ
      </button>

      <button class="btn-request-primary" type="button" onclick="savePoEdit('${escapeHtml(poId)}')">
        บันทึกแก้ไข
      </button>
    </div>
  `;
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
}

async function savePoEdit(poId) {
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  if (!card) return;

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
  const button = event.target.closest('[data-edit-po-id]');
  if (!button) return;

  const poId = button.dataset.editPoId;
  enablePoEdit(poId);
});

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

function getPoRemainingItems(po) {
  const requestedItems = Array.isArray(po.items) ? po.items : [];
  const receivedItems = Array.isArray(po.received_items) ? po.received_items : [];

  return requestedItems.map((item) => {
    const product = item.product || '';
    const requestedQty = Number(item.qty) || 0;

    const receivedQty = receivedItems
      .filter((received) => received.product === product)
      .reduce((sum, received) => sum + (Number(received.qty) || 0), 0);

    return {
      product,
      requestedQty,
      receivedQty,
      remainingQty: Math.max(0, requestedQty - receivedQty),
    };
  }).filter((item) => item.product && item.remainingQty > 0);
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
  }));

  if (items.length === 0) {
    showToast('⚠️ PO นี้รับสินค้าเข้าครบแล้ว', 'error');
    return;
  }

  const ok = confirm('ยืนยันรับสินค้าเข้าทั้งใบใช่ไหม?');
  if (!ok) return;

  await receivePoItems(poId, items);
}

function openPartialReceivePo(poId) {
  const po = window.currentPoStatusList?.find((item) => item.po_id === poId);
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  if (card) {
    card.classList.remove('is-editing-po');
  }

  if (!po || !card) return;

  const remainingItems = getPoRemainingItems(po);
  const itemBox = card.querySelector('.po-items-table');
  if (!itemBox) return;

  // ซ่อนปุ่มรับเข้าทั้งใบ / รับบางรายการ ตอนอยู่โหมดแก้ไข
  const receiveActions = card.querySelector('.po-receive-actions');
  if (receiveActions) {
    receiveActions.style.display = 'none';
  }

  if (remainingItems.length === 0) {
    showToast('⚠️ PO นี้ไม่มีรายการค้างรับเข้าแล้ว', 'error');
    return;
  }

  itemBox.innerHTML = `
    <div class="po-items-head po-partial-head">
      <div>สินค้า</div>
      <div>รับเข้า</div>
      <div>ค้างรับ</div>
      <div>บันทึก</div>
    </div>

    ${remainingItems.map((item) => `
      <div class="po-partial-row">
        <div class="po-item-name">${escapeHtml(item.product)}</div>

        <input
          class="po-partial-qty"
          type="number"
          min="0"
          max="${item.remainingQty}"
          value="${item.remainingQty}"
          data-product="${escapeHtml(item.product)}"
          data-max="${item.remainingQty}"
        />

        <div class="po-item-unit">${item.remainingQty}</div>

        <button 
          class="btn-save-partial-line" 
          type="button"
          onclick="saveSinglePartialReceivePo('${escapeHtml(poId)}', this)"
        >
          บันทึก
        </button>
      </div>
    `).join('')}
  `;

  const actionBox = card.querySelector('.po-receive-actions');

  if (actionBox) {
    actionBox.style.display = '';
    actionBox.classList.add('is-partial-mode');

    actionBox.innerHTML = `
      <button 
        class="btn-po-receive" 
        type="button" 
        onclick="receivePoFull('${escapeHtml(poId)}')"
      >
        รับเข้าทั้งใบ
      </button>

      <button 
        class="btn-po-receive-secondary" 
        type="button" 
        onclick="openPartialReceivePo('${escapeHtml(poId)}')"
      >
        รับบางรายการ
      </button>

      <button 
        class="btn-po-finish" 
        type="button" 
        onclick="fetchPoStatus()"
      >
        เสร็จสิ้น
      </button>
    `;
  }
}

async function savePartialReceivePo(poId) {
  const card = document.querySelector(`[data-po-id="${poId}"]`);
  if (!card) return;

  const inputs = card.querySelectorAll('.po-partial-qty');

  const items = Array.from(inputs).map((input) => {
    const product = input.dataset.product || '';
    const max = Number(input.dataset.max) || 0;
    let qty = Number(input.value) || 0;

    if (qty < 0) qty = 0;
    if (qty > max) qty = max;

    return { product, qty };
  }).filter((item) => item.product && item.qty > 0);

  if (items.length === 0) {
    showToast('⚠️ กรุณาระบุจำนวนรับเข้าอย่างน้อย 1 รายการ', 'error');
    return;
  }

  await receivePoItems(poId, items);
}

async function receivePoItems(poId, items) {
  showToast('', 'loading', 'กำลังรับสินค้าเข้า...');

  try {
    const { data, error } = await supabaseClient.rpc('receive_po_items', {
      p_receive_request_id: newRequestId('receive-po'),
      p_po_id: poId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_items: items,
    });

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'รับสินค้าเข้าไม่สำเร็จ');
    }

    showToast(`✅ ${data.message || 'รับสินค้าเข้าสำเร็จ'}`, 'success');

    fetchPoStatus();
    fetchStock();
    fetchPendingPoSummary?.();

  } catch (error) {
    console.error('receivePoItems error:', error);
    showToast(`❌ ${error.message || 'รับสินค้าเข้าไม่สำเร็จ'}`, 'error');
  }
}

async function saveSinglePartialReceivePo(poId, button) {
  const row = button.closest('.po-partial-row');
  if (!row) return;

  const input = row.querySelector('.po-partial-qty');
  if (!input) return;

  const product = input.dataset.product || '';
  const max = Number(input.dataset.max) || 0;
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

  if (qty > max) {
    qty = max;
    input.value = max;
  }

  const ok = confirm(`ยืนยันรับเข้า ${product} จำนวน ${qty} ชิ้น ใช่ไหม?`);
  if (!ok) return;

  await receivePoItems(poId, [
    {
      product,
      qty,
    },
  ]);
}

async function fetchRequestStatus() {
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

  const badge = document.getElementById('request-status-badge');
  const readyCount = (requestList || []).filter((request) => request.status === 'completed').length;

  if (badge) {
    badge.hidden = readyCount === 0;
    badge.textContent = readyCount;
  }

  if (!requestList.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีใบเบิกที่ต้องแสดง</div>';
    return;
  }

  box.innerHTML = requestList.map((request) => {
    const items = Array.isArray(request.prepared_items) && request.prepared_items.length
      ? request.prepared_items
      : request.items || [];

    const itemRows = items.map((item) => `
      <div class="po-item-row">
        <div class="po-item-name">${escapeHtml(item.product || '-')}</div>
        <div class="po-item-qty">${Number(item.qty) || 0}</div>
        <div class="po-item-unit">ชิ้น</div>
      </div>
    `).join('');

    return `
      <article class="stock-request-card">
        <div class="stock-request-head">
          <div>
            <span class="overview-label">เลขใบเบิก</span>
            <strong>${escapeHtml(request.request_id || '-')}</strong>
          </div>

          <span class="overview-pill ${request.status === 'completed' ? 'is-ready' : ''}">
            ${request.status === 'completed' ? 'จัดเตรียมเรียบร้อย' : 'รอดำเนินการ'}
          </span>
        </div>

        <div class="stock-request-meta">
          <div>
            <span>วันที่เบิก</span>
            <strong>${escapeHtml(request.request_date || '-')}</strong>
          </div>
          <div>
            <span>ศูนย์</span>
            <strong>${escapeHtml(request.center || '-')}</strong>
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
            ${request.status === 'completed' ? 'รายการที่จัดเตรียมแล้ว' : 'รายการที่ขอเบิก'}
          </div>

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