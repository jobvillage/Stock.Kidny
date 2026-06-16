const PR_APPROVER_CODES = ['user1', 'user2'];
const PR_PO_MANAGER_CODES = ['user3', 'user4'];
const PR_APPROVER_BY_CODE = {
  user1: 'daeng',
  user2: 'toy',
};

const PR_CENTER_DISPLAY_NAME = {
  'ไตล่าง': 'บริษัท ลำพูนเพื่อนไต จำกัด',
  'ไตบน': 'บริษัท คิดนี่แคร์ลำพูน จำกัด',
  'ไตดี': 'บริษัท ไตดีลำพูน จำกัด',
};

function getPrCenterDisplayName(center) {
  return PR_CENTER_DISPLAY_NAME[center] || center;
}

const PR_COMPANIES = [
  {
    name: 'Aeonmed',
    items: ['Hemo B (online)', 'K3 Ca3.5(online)'],
  },
  {
    name: 'ฟีนิกซ์',
    items: ['K2 Ca 2.5', 'K2 Ca 3', 'K2 Ca 3.5', 'K3 Ca 2.5', 'K3 Ca 3.0', 'K3 Ca 3.5', 'Hemo B (น้ำยา B)'],
  },
  {
    name: 'NSS',
    items: ['0.9% NSS (น้ำเกลือ)'],
  },
  {
    name: 'Citrosteril',
    items: ['Citrosteril'],
  },
  {
    name: 'Renaton',
    items: ['น้ำยาล้างตัวกรอง Renaton (ถังเขียว)'],
  },
  {
    name: 'MDT (ฝาขาว)',
    items: ['น้ำยาเครื่องล้างตัวกรอง MDT (ฝาขาว)'],
  },
  {
    name: 'Meditop',
    items: ['น้ำยาเครื่องล้างตัวกรอง Kidney Clean (ฝาดำ)'],
  },
  {
    name: 'ทั่วไป',
    items: ['30% Citric acid', '5% Peroxan (manual) (ฝาดำ)', 'Chlorox', 'รายการอื่นๆ'],
  },
];

let prApprovalRecords = [];
let prOpenedPoRecords = [];
let prOpenedPrIds = new Set();
let prOpenPoRows = [];
let prOpenPoSelectedPrId = '';
let prOpenPoDocumentId = '';
let prOpenedPoEditingId = '';
let prOpenedPoEditExtraRows = {};
let prVendorProductCompanyMap = new Map();
let prVendorProductCompanyLoaded = false;
let prProductTypeMap = new Map();
let prProductTypeLoaded = false;
let addDataVendorMetaMap = new Map();

function getPrUserCode() {
  return String(currentUser?.code || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isPrApprovalUser() {
  return PR_APPROVER_CODES.includes(getPrUserCode());
}

function isPrPoManagerUser() {
  return currentUser?.role === 'pr_po_manager' || PR_PO_MANAGER_CODES.includes(getPrUserCode());
}

function setupPrPoWorkspaceForSpecialUsers() {
  if (isPrApprovalUser()) {
    currentUser.permissions = ['pr_approval'];
    setPrModeLabel('pr_approval', 'อนุมัติ PR');
    renderPrNav([
      { tab: 'pr_approval', icon: '✅', label: 'อนุมัติ PR' },
    ]);
    renderPrApprovalPanels();
    bindPrWorkspaceTabs();
    fetchPrApprovalRecords();
    return true;
  }

  if (isPrPoManagerUser()) {
    currentUser.permissions = ['pr_approved', 'pr_open_po', 'stock', 'pr_add_data', 'pr_export_data'];
    setPrModeLabel('pr_approved', 'PR ที่อนุมัติ');
    setPrModeLabel('pr_open_po', 'เปิด PO');
    setPrModeLabel('pr_add_data', 'Add Data');
    setPrModeLabel('pr_export_data', 'Export Data');
    renderPrNav([
      { tab: 'pr_approved', icon: '✅', label: 'PR ที่อนุมัติ' },
      { tab: 'pr_open_po', icon: '📝', label: 'เปิด PO' },
      { tab: 'stock', icon: '📦', label: 'Stock' },
      { tab: 'pr_add_data', icon: '➕', label: 'Add Data' },
      { tab: 'pr_export_data', icon: '📤', label: 'Export Data' },
    ]);
    renderPrManagerPanels();
    bindPrWorkspaceTabs();
    fetchPrManagerRecords();
    return true;
  }

  return false;
}

function setPrModeLabel(tab, label) {
  if (typeof modeLabels !== 'undefined') {
    modeLabels[tab] = label;
  }
}

function renderPrNav(tabs) {
  const nav = document.querySelector('.segmented-control');
  if (!nav) return;

  nav.classList.remove('tab-grid-five');
  nav.innerHTML = tabs.map((item) => `
    <button class="segment" type="button" data-tab="${escapeHtml(item.tab)}">
      <span class="segment-icon">${escapeHtml(item.icon)}</span>
      <span>${escapeHtml(item.label)}</span>
    </button>
  `).join('');
}

function bindPrWorkspaceTabs() {
  document.querySelectorAll('.segmented-control [data-tab]').forEach((button) => {
    if (button.dataset.prBound === '1') return;
    button.dataset.prBound = '1';
    button.addEventListener('click', () => {
      if (typeof switchTab === 'function') {
        switchTab(button.dataset.tab);
      } else if (typeof showTab === 'function') {
        showTab(button.dataset.tab);
      }
    });
  });

  document.querySelectorAll('[data-pr-company]').forEach((button) => {
    if (button.dataset.prBound === '1') return;
    button.dataset.prBound = '1';
    button.addEventListener('click', () => {
      const record = prApprovalRecords.find((item) => item.po_id === button.dataset.prPoId);
      if (!record) return;

      const company = getPrCompanyGroups(record.items).find((item) => item.name === button.dataset.prCompany);
      if (!company) return;

      const card = button.closest('.pr-po-card');
      card?.querySelectorAll('[data-pr-company]').forEach((item) => {
        item.classList.toggle('is-selected', item === button);
      });

      openPrApprovalPreviewModal(company, record, button.dataset.prStatus || 'pending');
    });
  });

  document.querySelectorAll('[data-pr-approve]').forEach((button) => {
    if (button.dataset.prBound === '1') return;
    button.dataset.prBound = '1';
    button.addEventListener('click', () => approvePrRequest(button.dataset.prPoId || '', button.dataset.prApprove || '', button));
  });

  document.querySelectorAll('[data-pr-print-approved]').forEach((button) => {
    if (button.dataset.prBound === '1') return;
    button.dataset.prBound = '1';
    button.addEventListener('click', () => printApprovedPrDocument(button.dataset.prPrintApproved || ''));
  });
}

function openPrApprovalPreviewModal(company, record, variant) {
  const existing = document.querySelector('.pr-modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'pr-modal-backdrop';
  backdrop.innerHTML = `
    <div class="pr-modal" role="dialog" aria-modal="true" aria-label="ใบ PR ${escapeHtml(company.name)}">
      <button class="pr-modal-close" type="button" aria-label="ปิด">×</button>
      ${renderPrApprovalPreview(company, record, variant)}
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => backdrop.remove();
  backdrop.querySelector('.pr-modal-close')?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
}

function ensurePrPanel(tab, className = '') {
  let panel = document.querySelector(`[data-panel="${tab}"]`);
  if (panel) return panel;

  panel = document.createElement('section');
  panel.className = `panel ${className}`.trim();
  panel.dataset.panel = tab;
  panel.id = `panel-${tab}`;

  const nav = document.querySelector('.segmented-control');
  nav?.parentElement?.appendChild(panel);
  return panel;
}

function renderPrApprovalPanels() {
  const panel = ensurePrPanel('pr_approval', 'panel-pr-approval');
  const pendingRecords = prApprovalRecords.filter(isPrPendingRecord);
  const approvedRecords = prApprovalRecords.filter(isPrApprovedRecord);

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">✅</span>
      <div>
        <h2>อนุมัติ PR</h2>
        <p>ตรวจสอบ PR ที่รออนุมัติและ PR ที่อนุมัติแล้ว แยกตามหมวดสินค้าและบริษัท</p>
      </div>
    </div>

    <div class="pr-approval-grid">
      ${renderPrApprovalSection('PR ที่รออนุมัติ', 'รออนุมัติ', 'pending', pendingRecords)}
      ${renderPrApprovalSection('PR ที่อนุมัติแล้ว', 'อนุมัติแล้ว', 'approved', approvedRecords)}
    </div>
  `;
}

async function fetchPrApprovalRecords() {
  const pendingBox = document.querySelector('[data-pr-list="pending"]');
  if (pendingBox) {
    pendingBox.innerHTML = '<div class="empty-state">กำลังโหลดรายการ PR ที่รออนุมัติ...</div>';
  }

  try {
    await fetchPrVendorProductCompanyMap();
    await fetchPrProductTypeMap();

    console.log('prVendorProductCompanyMap size:', prVendorProductCompanyMap.size);
    console.log('map entries:', [...prVendorProductCompanyMap.entries()]);

    const { data, error } = await supabaseClient.rpc('get_pr_approval_status');

    if (error) {
      throw error;
    }

    prApprovalRecords = (data || []).map(normalizePrApprovalRecord);
    renderPrApprovalPanels();
    bindPrWorkspaceTabs();

  } catch (error) {
    console.error('fetchPrApprovalRecords error:', error);
    const panel = ensurePrPanel('pr_approval', 'panel-pr-approval');
    const box = panel.querySelector('[data-pr-list="pending"]');
    if (box) {
      box.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดรายการ PR ไม่สำเร็จ')}</div>`;
    }
  }
}

async function fetchPrManagerRecords() {
  try {
    await fetchPrVendorProductCompanyMap();
    await fetchPrProductTypeMap();

    const { data, error } = await supabaseClient.rpc('get_pr_approval_status');

    if (error) {
      throw error;
    }

    const { data: poData, error: poError } = await supabaseClient.rpc('get_po_status');
    if (poError) {
      console.warn('get_po_status for opened PR/PO failed:', poError);
      prOpenedPoRecords = [];
      prOpenedPrIds = new Set();
    } else {
      prOpenedPoRecords = (poData || [])
        .filter(isPrOpenedPoRecord)
        .map(normalizePrOpenedPoRecord);
      prOpenedPrIds = new Set(prOpenedPoRecords.map((po) => po.pr_id).filter(Boolean));
    }

    prApprovalRecords = (data || []).map(normalizePrApprovalRecord);
    renderApprovedPrPanel();
    renderOpenPoPanel();
    bindPrWorkspaceTabs();

  } catch (error) {
    console.error('fetchPrManagerRecords error:', error);
    const panel = ensurePrPanel('pr_approved', 'panel-pr-approved');
    panel.innerHTML = `
      <div class="panel-title">
        <span class="title-icon">✅</span>
        <div>
          <h2>PR ที่อนุมัติ</h2>
          <p>รายการ PR ที่ผ่านการอนุมัติและพร้อมนำไปเปิด PO</p>
        </div>
      </div>
      <div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดรายการ PR ที่อนุมัติไม่สำเร็จ')}</div>
    `;
  }
}

function normalizePrApprovalRecord(raw) {
  return {
    po_id: raw.po_id || raw.poId || raw.po_no || raw.poNo || '',
    po_date: raw.po_date || '',
    po_person: raw.po_person || '',
    center: raw.center || '',
    status: raw.status || '',
    note: raw.note || '',
    pr_daeng_approved_at: raw.pr_daeng_approved_at || '',
    pr_daeng_approved_by_code: raw.pr_daeng_approved_by_code || '',
    pr_daeng_approved_by_name: raw.pr_daeng_approved_by_name || '',
    pr_toy_approved_at: raw.pr_toy_approved_at || '',
    pr_toy_approved_by_code: raw.pr_toy_approved_by_code || '',
    pr_toy_approved_by_name: raw.pr_toy_approved_by_name || '',
    items: normalizeItems(raw.items).map((item) => ({
      ...item,
      product: item.product || item.name || '',
      qty: Number(item.qty || item.quantity || 0),
      unit: item.unit || '',
      unit_per_box: item.unit_per_box ?? item.unitPerBox ?? null,
      unitPerBox: item.unitPerBox ?? item.unit_per_box ?? null,
      unit_qty: item.unit_qty ?? item.unitQty ?? null,
      unitQty: item.unitQty ?? item.unit_qty ?? null,
      unit_price: item.unit_price ?? item.unitPrice ?? null,
      unitPrice: item.unitPrice ?? item.unit_price ?? null,
      total_price: item.total_price ?? item.totalPrice ?? item.line_total ?? item.lineTotal ?? null,
      totalPrice: item.totalPrice ?? item.total_price ?? item.line_total ?? item.lineTotal ?? null,
    })).filter((item) => item.product),
    created_at: raw.created_at || '',
    updated_at: raw.updated_at || '',
  };
}

function isPrPendingRecord(record) {
  const status = String(record.status || '').toLowerCase();
  return isPrDocumentRecord(record)
    && (status === 'pr_pending_approval' || status === 'pending')
    && !isPrFullyApproved(record);
}

function isPrApprovedRecord(record) {
  const status = String(record.status || '').toLowerCase();
  return isPrDocumentRecord(record)
    && (status === 'pr_approved' || status === 'approved' || isPrFullyApproved(record));
}

function isPrFullyApproved(record) {
  return Boolean(record.pr_daeng_approved_at && record.pr_toy_approved_at);
}

function isPrDocumentRecord(record = {}) {
  return String(record.po_id || '').toUpperCase().startsWith('PR-');
}

function isPrOpenedPoRecord(raw = {}) {
  const poId = String(raw.po_id || raw.poId || raw.po_no || raw.poNo || raw.request_id || raw.id || '').toUpperCase();
  return poId.startsWith('PO-') && Boolean(getPrIdFromPoRecord(raw));
}

function getPrIdFromPoRecord(raw = {}) {
  const items = normalizeItems(raw.items);
  const itemPrId = items
    .map((item) => item.pr_id || item.prId || item.pr_no || item.prNo || '')
    .find((value) => String(value || '').toUpperCase().startsWith('PR-'));

  if (itemPrId) return String(itemPrId).trim();

  const noteText = String(raw.note || raw.remark || raw.remarks || '').trim();
  const noteMatch = noteText.match(/PR-\d{8}-\d{3}/i);
  return noteMatch ? noteMatch[0].toUpperCase() : '';
}

function normalizePrOpenedPoRecord(raw = {}) {
  const poId = raw.po_id || raw.poId || raw.po_no || raw.poNo || raw.request_id || raw.id || '';

  return {
    po_id: poId,
    po_date: raw.po_date || raw.request_date || raw.created_date || '',
    po_person: raw.po_person || raw.person || raw.staff_name || '',
    center: raw.center || raw.stock_center || '',
    status: raw.status || '',
    note: raw.note || '',
    pr_id: getPrIdFromPoRecord(raw),
    items: normalizeItems(raw.items).map((item) => ({
      ...item,
      product: item.product || item.name || '',
      qty: Number(item.qty || item.quantity || 0),
      unit: item.unit || '',
      unit_per_box: item.unit_per_box ?? item.unitPerBox ?? null,
      unitPerBox: item.unitPerBox ?? item.unit_per_box ?? null,
      unit_qty: item.unit_qty ?? item.unitQty ?? null,
      unitQty: item.unitQty ?? item.unit_qty ?? null,
      unit_price: item.unit_price ?? item.unitPrice ?? null,
      unitPrice: item.unitPrice ?? item.unit_price ?? null,
      total_price: item.total_price ?? item.totalPrice ?? item.line_total ?? item.lineTotal ?? null,
      totalPrice: item.totalPrice ?? item.total_price ?? item.line_total ?? item.lineTotal ?? null,
    })).filter((item) => item.product),
    created_at: raw.created_at || '',
    updated_at: raw.updated_at || '',
  };
}

function renderPrApprovalSection(title, status, variant, records = []) {
  const totalItems = records.reduce((sum, record) => sum + record.items.length, 0);

  return `
    <section class="pr-main-card pr-approval-section pr-approval-board" data-pr-section="${escapeHtml(variant)}" data-pr-status="${escapeHtml(variant)}">
      <div class="pr-approval-board-top">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>ทั้งหมด ${totalItems} รายการ แยกเป็นหมวดสินค้าและบริษัทดังนี้</p>
        </div>
        <span class="pr-status-pill ${variant === 'approved' ? 'is-approved' : ''}">${escapeHtml(status)}</span>
      </div>

      <div class="pr-po-list" data-pr-list="${escapeHtml(variant)}">
        ${records.length
          ? records.map((record) => renderPrApprovalPoCard(record, variant)).join('')
          : `<div class="empty-state">${variant === 'approved' ? 'ยังไม่มี PR ที่อนุมัติแล้ว' : 'ยังไม่มี PR ที่รออนุมัติ'}</div>`
        }
      </div>
    </section>
  `;
}

function renderPrApprovalPoCard(record, variant) {
  const companyGroups = getPrCompanyGroups(record.items);
  const complete = isPrFullyApproved(record);
  const companyButtons = companyGroups.map((company) => `
    <button
      class="pr-company-large-button"
      type="button"
      data-pr-company="${escapeHtml(company.name)}"
      data-pr-po-id="${escapeHtml(record.po_id)}"
      data-pr-status="${escapeHtml(variant)}"
    >
      ${escapeHtml(company.name)}
    </button>
  `).join('');

  return `
    <article class="pr-po-card">
      <div class="pr-po-card-top">
        <div>
          <span>เลข PR</span>
          <strong>${escapeHtml(record.po_id || '-')}</strong>
          <small>อ้างอิงเลข PO เดิม</small>
        </div>
        <span class="pr-status-pill ${(variant === 'approved' || complete) ? 'is-approved' : ''}">
          ${(variant === 'approved' || complete) ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
        </span>
      </div>

      <div class="pr-request-meta">
        <div><span>วันที่เปิด PR</span><strong>${escapeHtml(record.po_date || '-')}</strong></div>
        <div><span>ผู้เปิด PR</span><strong>${escapeHtml(record.po_person || '-')}</strong></div>
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(getPrCenterDisplayName(record.center || '-'))}</strong></div>
      </div>

      <div class="pr-company-button-list">
        ${companyButtons || '<div class="empty-state">ไม่มีรายการสินค้าในใบนี้</div>'}
      </div>

      ${variant === 'approved' ? '' : `
        <div class="pr-approval-board-actions">
          ${renderPrApproverButton(record, 'daeng', 'พี่แดงอนุมัติ')}
          ${renderPrApproverButton(record, 'toy', 'พี่ต้อยอนุมัติ')}
        </div>
      `}
    </article>
  `;
}

function renderPrApproverButton(record, approver, label) {
  const currentApprover = PR_APPROVER_BY_CODE[getPrUserCode()] || '';
  const approved = approver === 'daeng'
    ? Boolean(record.pr_daeng_approved_at)
    : Boolean(record.pr_toy_approved_at);
  const canToggle = currentApprover === approver;

  return `
    <button
      class="${approved ? 'is-approved' : ''}"
      type="button"
      data-pr-approve="${escapeHtml(approver)}"
      data-pr-po-id="${escapeHtml(record.po_id)}"
      ${canToggle ? '' : 'disabled'}
    >
      ${approved ? '✓ ' : ''}${escapeHtml(label)}
    </button>
  `;
}

async function approvePrRequest(poId, approver, button) {
  if (!poId || !approver) return;

  const currentApprover = PR_APPROVER_BY_CODE[getPrUserCode()] || '';
  if (currentApprover !== approver) {
    showToast('⛔ ผู้ใช้นี้ไม่มีสิทธิ์กดปุ่มอนุมัตินี้', 'error');
    return;
  }

  const record = prApprovalRecords.find((item) => item.po_id === poId);
  const alreadyApproved = approver === 'daeng'
    ? Boolean(record?.pr_daeng_approved_at)
    : Boolean(record?.pr_toy_approved_at);
  const actionText = alreadyApproved ? 'ยกเลิกอนุมัติ' : 'อนุมัติ';
  const ok = confirm(`ยืนยัน${approver === 'daeng' ? 'พี่แดง' : 'พี่ต้อย'}${actionText} PR ${poId} ใช่ไหม?`);
  if (!ok) return;

  if (button) button.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกการอนุมัติ PR...');

  try {
    const { data, error } = await supabaseClient.rpc('approve_pr_request', {
      p_po_id: poId,
      p_approver: approver,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || '',
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'อนุมัติ PR ไม่สำเร็จ');
    }

    showToast(`✅ ${data.message || 'บันทึกการอนุมัติแล้ว'}`, 'success');
    await fetchPrApprovalRecords();

  } catch (error) {
    console.error('approvePrRequest error:', error);
    showToast(`❌ ${error.message || 'อนุมัติ PR ไม่สำเร็จ'}`, 'error');
    if (button) button.disabled = false;
  }
}

function getPrCompanyGroups(items = []) {
  const groups = new Map();

  items.forEach((item) => {
    const groupName = getPrApprovalGroupNameForItem(item);
    if (!groups.has(groupName)) {
      groups.set(groupName, { name: groupName, items: [] });
    }
    groups.get(groupName).items.push(item);
  });

  return Array.from(groups.values());
}

function getPrApprovalGroupNameForItem(item = {}) {
  const product = item.product || item.name || '';
  const productType = getPrProductTypeForProduct(product, item.product_type || item.productType || item.type || item.category);

  if (isPrDialysisProductType(productType)) {
    return getPrCompanyNameForProduct(product);
  }

  return productType || 'ทั่วไป';
}

function getPrProductTypeForProduct(product, fallbackType = '') {
  const normalizedProduct = normalizePrProductName(product);
  if (!normalizedProduct) return String(fallbackType || '').trim();

  return String(fallbackType || prProductTypeMap.get(normalizedProduct) || '').trim();
}

function isPrDialysisProductType(productType) {
  const normalizedType = normalizePrProductName(productType);
  const dialysisType = normalizePrProductName('น้ำยาฟอกไต');
  return Boolean(normalizedType && dialysisType && normalizedType.includes(dialysisType));
}

async function fetchPrVendorProductCompanyMap() {
  if (prVendorProductCompanyLoaded || typeof supabaseClient === 'undefined') return prVendorProductCompanyMap;

  try {
    const { data, error } = await supabaseClient
      .from('vendor_products')
      .select('product, updated_at, vendors(vendor_name)')
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    const nextMap = new Map();

    (data || []).forEach((row) => {
      const productKey = normalizePrProductName(row.product);
      if (!productKey || nextMap.has(productKey)) return;

      const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
      const vendorName = String(vendor?.vendor_name || '').trim();
      if (vendorName) {
        nextMap.set(productKey, vendorName);
      }
    });

    // ✅ เพิ่มตรงนี้
    console.log('=== vendor_products raw data ===', data);
    console.log('=== prVendorProductCompanyMap ===', [...nextMap.entries()]);

    prVendorProductCompanyMap = nextMap;
    prVendorProductCompanyLoaded = true;

  } catch (error) {
    console.warn('Load PR vendor product company map failed:', error);
    prVendorProductCompanyLoaded = true;
  }

  return prVendorProductCompanyMap;
}

async function fetchPrProductTypeMap() {
  if (prProductTypeLoaded || typeof supabaseClient === 'undefined') return prProductTypeMap;

  try {
    const { data, error } = await supabaseClient
      .from('stock_items')
      .select('product, product_type, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    const nextMap = new Map();

    (data || []).forEach((row) => {
      const productKey = normalizePrProductName(row.product);
      const productType = String(row.product_type || '').trim();
      if (!productKey || !productType || nextMap.has(productKey)) return;
      nextMap.set(productKey, productType);
    });

    prProductTypeMap = nextMap;
    prProductTypeLoaded = true;
  } catch (error) {
    console.warn('Load PR product type map failed:', error);
    prProductTypeLoaded = true;
  }

  return prProductTypeMap;
}

function getPrCompanyNameForProduct(product) {
  const normalizedProduct = normalizePrProductName(product);

  // 1. ลองจาก Supabase map ก่อน
  const vendorCompany = prVendorProductCompanyMap.get(normalizedProduct);
  if (vendorCompany) return vendorCompany;

  // 2. fallback: ลองจาก PR_COMPANIES (hardcoded)
  for (const company of PR_COMPANIES) {
    const found = company.items.some(
      (item) => normalizePrProductName(item) === normalizedProduct
    );
    if (found) return company.name;
  }

  return 'ทั่วไป';
}

function normalizePrProductName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function renderPrApprovalPreview(company, record, variant) {
  return `
    <article class="pr-document-preview">
      <div class="pr-document-head">
        <div>
          <h4>📦 ใบ PR</h4>
          <p>Stock Management System</p>
        </div>
        <div>
          <span>เลข PR</span>
          <strong>${escapeHtml(record.po_id || '-')}</strong>
        </div>
      </div>

      <div class="pr-document-meta">
        <div><span>วันที่เปิด PR</span><strong>${escapeHtml(record.po_date || '-')}</strong></div>
        <div><span>ผู้เปิด PR</span><strong>${escapeHtml(record.po_person || '-')}</strong></div>
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(getPrCenterDisplayName(record.center || '-'))}</strong></div>
        <div><span>สถานะ</span><strong>${variant === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</strong></div>
      </div>

      <div class="pr-document-company">🟢 ${escapeHtml(company.name)}</div>

      <div class="pr-document-table">
        <div class="pr-document-table-head">
          <span>ลำดับ</span>
          <span>รายการสินค้า</span>
          <span>จำนวน</span>
        </div>
        ${company.items.map((item, index) => `
          <div class="pr-document-table-row">
            <span>${index + 1}</span>
            <strong>${escapeHtml(item.product || item)}</strong>
            <span>${Number(item.qty || 0).toLocaleString()}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderPrManagerPanels() {
  renderApprovedPrPanel();
  renderOpenPoPanel();
  renderAddDataPanel();
  renderExportDataPanel();
}

function renderApprovedPrPanel() {
  const panel = ensurePrPanel('pr_approved', 'panel-pr-approved');
  const pendingRecords = prApprovalRecords.filter(isPrPendingRecord);
  const approvedRecords = prApprovalRecords.filter(isPrApprovedRecord);

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">✅</span>
      <div>
        <h2>PR ที่อนุมัติ</h2>
        <p>ติดตาม PR ที่รออนุมัติ และรายการที่อนุมัติครบพร้อมนำไปเปิด PO</p>
      </div>
    </div>

    ${renderPrManagerStatusSection('PR ที่ยังไม่อนุมัติ', 'รออนุมัติ', 'pending', pendingRecords)}

    <div class="section-divider"></div>

    ${renderPrManagerStatusSection('PR ที่อนุมัติแล้ว', 'อนุมัติแล้ว', 'approved', approvedRecords)}
  `;
}

function renderPrManagerStatusSection(title, status, variant, records = []) {
  const totalItems = records.reduce((sum, record) => sum + record.items.length, 0);

  return `
    <section class="pr-main-card pr-approval-section pr-approval-board" data-pr-manager-section="${escapeHtml(variant)}">
      <div class="pr-approval-board-top">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>ทั้งหมด ${records.length} ใบ / ${totalItems} รายการ</p>
        </div>
        <span class="pr-status-pill ${variant === 'approved' ? 'is-approved' : ''}">${escapeHtml(status)}</span>
      </div>

      <div class="pr-card-list">
        ${records.length
          ? records.map((record) => renderApprovedPrStatusCard(record, variant)).join('')
          : `<div class="empty-state">${variant === 'approved' ? 'ยังไม่มี PR ที่อนุมัติครบ 2 คน' : 'ยังไม่มี PR ที่รออนุมัติ'}</div>`
        }
      </div>
    </section>
  `;
}

function renderApprovedPrStatusCard(record, variant = 'approved') {
  const itemRows = record.items.map((item) => `
    <div class="pr-item-row">
      <strong>${escapeHtml(item.product || '-')}</strong>
      <span>${Number(item.qty || 0).toLocaleString()}</span>
      <span>${escapeHtml(item.unit || '-')}</span>
      <small>${escapeHtml(getPrCompanyNameForProduct(item.product))}</small>
    </div>
  `).join('');

  return `
    <article class="pr-request-card">
      <div class="pr-request-top">
        <div>
          <span>เลข PR</span>
          <strong>${escapeHtml(record.po_id || '-')}</strong>
        </div>
        <div class="pr-request-actions">
          <span class="pr-status-pill ${variant === 'approved' ? 'is-approved' : ''}">
            ${variant === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
          </span>
          ${variant === 'approved'
            ? `<button type="button" data-pr-print-approved="${escapeHtml(record.po_id || '')}">พิมพ์</button>`
            : ''
          }
        </div>
      </div>
      <div class="pr-request-meta">
        <div><span>วันที่เปิด PR</span><strong>${escapeHtml(record.po_date || '-')}</strong></div>
        <div><span>ผู้เปิด PR</span><strong>${escapeHtml(record.po_person || '-')}</strong></div>
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(getPrCenterDisplayName(record.center || '-'))}</strong></div>
        ${variant === 'pending' ? `
          <div><span>พี่แดง</span><strong>${record.pr_daeng_approved_at ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</strong></div>
          <div><span>พี่ต้อย</span><strong>${record.pr_toy_approved_at ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</strong></div>
        ` : ''}
      </div>
      <div class="pr-item-head">
        <span>สินค้า</span>
        <span>จำนวน</span>
        <span>หน่วย</span>
        <span>บริษัท</span>
      </div>
      <div class="pr-placeholder-list">
        ${itemRows || '<div class="empty-state">ไม่มีรายการสินค้า</div>'}
      </div>
    </article>
  `;
}

function printApprovedPrDocument(poId) {
  const record = prApprovalRecords.find((item) => item.po_id === poId);

  if (!record) {
    showToast('❌ ไม่พบข้อมูล PR นี้', 'error');
    return;
  }

  const itemRows = (record.items || []).map((item, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td>${escapeHtml(item.product || '-')}</td>
      <td class="num">${Number(item.qty || 0).toLocaleString()}</td>
      <td class="num">${escapeHtml(item.unit || '-')}</td>
      <td>${escapeHtml(getPrCompanyNameForProduct(item.product))}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบ PR ${escapeHtml(record.po_id || '')}</title>
      <style>
        body {
          font-family: "Sarabun", Arial, sans-serif;
          color: #111827;
          padding: 24px;
          background: #ffffff;
        }

        .doc {
          max-width: 860px;
          margin: 0 auto;
        }

        .head {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          border-bottom: 2px solid #d7dde5;
          padding-bottom: 18px;
          margin-bottom: 22px;
        }

        h1 {
          margin: 0 0 6px;
          font-size: 30px;
        }

        .muted {
          color: #64748b;
          font-weight: 700;
        }

        .pr-id {
          color: #3f7bdd;
          font-size: 24px;
          font-weight: 800;
          text-align: right;
        }

        .meta {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 22px;
        }

        .meta div {
          background: #f4f6f8;
          border-radius: 8px;
          padding: 12px 14px;
        }

        .meta span {
          display: block;
          color: #6b7280;
          font-weight: 700;
          margin-bottom: 4px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #d7dde5;
          margin-top: 12px;
        }

        th {
          background: #edf1f5;
          color: #64748b;
          text-align: left;
          padding: 12px;
        }

        td {
          border-top: 1px solid #e5e7eb;
          padding: 12px;
          font-weight: 700;
        }

        .num {
          text-align: center;
        }

        .approval {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          margin-top: 28px;
        }

        .approval div {
          border: 1px solid #d7dde5;
          border-radius: 8px;
          padding: 14px;
          min-height: 74px;
        }

        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="doc">
        <div class="head">
          <div>
            <h1>📦 ใบ PR</h1>
            <div class="muted">Stock Management System</div>
          </div>
          <div>
            <div class="muted">เลข PR</div>
            <div class="pr-id">${escapeHtml(record.po_id || '-')}</div>
          </div>
        </div>

        <div class="meta">
          <div><span>วันที่เปิด PR</span>${escapeHtml(record.po_date || '-')}</div>
          <div><span>ผู้เปิด PR</span>${escapeHtml(record.po_person || '-')}</div>
          <div><span>ศูนย์รับเข้า</span>${escapeHtml(record.center || '-')}</div>
          <div><span>สถานะ</span>อนุมัติแล้ว</div>
          <div><span>พี่แดงอนุมัติ</span>${escapeHtml(record.pr_daeng_approved_by_name || '-')}</div>
          <div><span>พี่ต้อยอนุมัติ</span>${escapeHtml(record.pr_toy_approved_by_name || '-')}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 70px;" class="num">ลำดับ</th>
              <th>รายการสินค้า</th>
              <th style="width: 110px;" class="num">จำนวน</th>
              <th style="width: 100px;" class="num">หน่วย</th>
              <th style="width: 150px;">บริษัท</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="5" class="num">ไม่มีรายการสินค้า</td></tr>'}
          </tbody>
        </table>

        <div class="approval">
          <div><strong>ผู้อนุมัติ 1</strong><br>${escapeHtml(record.pr_daeng_approved_by_name || '-')}</div>
          <div><strong>ผู้อนุมัติ 2</strong><br>${escapeHtml(record.pr_toy_approved_by_name || '-')}</div>
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

function renderOpenPoPanel() {
  const panel = ensurePrPanel('pr_open_po', 'panel-pr-open-po');
  const approvedRecords = prApprovalRecords.filter(isPrApprovedRecord);
  const availableApprovedRecords = approvedRecords.filter((record) => !prOpenedPrIds.has(record.po_id));
  const selectedRecord = getSelectedApprovedPrForPo(availableApprovedRecords);
  if (selectedRecord) {
    ensurePrOpenPoRowsFromSelectedRecord(selectedRecord);
  }
  const centerOptions = getPrPoStockLocations().map((center) => `
    <option value="${escapeHtml(center)}"${center === selectedRecord?.center ? ' selected' : ''}>
      ${escapeHtml(center)}
    </option>
  `).join('');
  const prOptions = availableApprovedRecords.map((record) => `
    <option value="${escapeHtml(record.po_id)}"${record.po_id === selectedRecord?.po_id ? ' selected' : ''}>
      ${escapeHtml(record.po_id)} - ${escapeHtml(record.po_person || '-')}
    </option>
  `).join('');

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon transfer">📝</span>
      <div>
        <h2>เปิด PO</h2>
        <p>โครงหน้าสำหรับแปลง PR ที่อนุมัติแล้วเป็น PO</p>
      </div>
    </div>

    <section class="pr-main-card">
      <div class="form-grid">
        <div class="field-group">
          <label for="pr-po-id">เลขที่ PO</label>
          <input type="text" id="pr-po-id" value="${escapeHtml(prOpenPoDocumentId)}" placeholder="กำลังดึงเลข PO..." readonly />
        </div>
        <div class="field-group">
          <label for="pr-po-date">วันที่เปิด PO</label>
          <input type="date" id="pr-po-date" value="${escapeHtml(getPrTodayDate())}" />
        </div>
        <div class="field-group">
          <label for="pr-po-person">ผู้เปิด PO</label>
          <input type="text" id="pr-po-person" value="${escapeHtml(currentUser?.name || currentUser?.code || '')}" readonly />
        </div>
        <div class="field-group">
          <label for="pr-po-ref">อ้างอิง PR</label>
          <select id="pr-po-ref" data-pr-open-po-ref>
            <option value=""${selectedRecord ? '' : ' selected'}>— เลือก PR ที่อนุมัติแล้ว —</option>
            ${prOptions}
          </select>
        </div>
        <div class="field-group">
          <label for="pr-po-center">สต็อกที่จะรับเข้า</label>
          <select id="pr-po-center">
            ${centerOptions}
          </select>
        </div>
        <div class="field-group field-group-full">
          <label for="pr-po-note">หมายเหตุ</label>
          <input type="text" id="pr-po-note" placeholder="เช่น รอบสั่งซื้อประจำเดือน / บริษัทที่เกี่ยวข้อง" />
        </div>
      </div>
    </section>

    <section class="pr-main-card pr-po-items-card">
      <div class="products-header">
        <div>
          <span>รายการสินค้าใน PO</span>
          <small>${selectedRecord ? 'ระบบดึงรายการจาก PR ที่เลือกมาให้แล้ว กรอกจำนวนต่อกล่องและราคารวม' : 'เลือก PR ที่อนุมัติแล้วก่อนเพิ่มรายการสินค้า'}</small>
        </div>
        <button class="btn-add-row transfer" type="button" data-add-pr-po-row ${selectedRecord ? '' : 'disabled'}>+ เพิ่มรายการ</button>
      </div>
      ${selectedRecord ? `
        <div class="pr-price-head">
          <span></span>
          <span>รายการสินค้า</span>
          <span>จำนวน</span>
          <span>ต่อกล่อง</span>
          <span>ราคาต่อหน่วย</span>
          <span>ราคารวม</span>
          <span></span>
        </div>
        <div class="pr-placeholder-list" data-pr-po-items>
          ${renderPrOpenPoRows(selectedRecord)}
        </div>
        <div class="pr-total-box">
          <span>สรุปราคารวม</span>
          <strong data-pr-po-total>${formatPrCurrency(getPrOpenPoTotal())} บาท</strong>
        </div>
        <button class="btn-submit btn-submit-transfer" type="button" data-save-pr-po ${prOpenPoRows.length ? '' : 'disabled'}>
          <span>📝</span>
          <span>บันทึก PO</span>
        </button>
      ` : `
        <div class="empty-state">เลือก PR ที่อนุมัติแล้วก่อน ระบบจึงจะแสดงรายการสินค้าใน PO</div>
      `}
    </section>

    <div class="section-divider"></div>

    ${renderPrOpenedPoSection()}
  `;

  bindPrOpenPoPanel(panel);
  refreshNextPoDocumentIdInput();
}

function getSelectedApprovedPrForPo(approvedRecords = prApprovalRecords.filter(isPrApprovedRecord)) {
  if (!approvedRecords.length) {
    prOpenPoSelectedPrId = '';
    prOpenPoRows = [];
    return null;
  }

  if (!prOpenPoSelectedPrId || !approvedRecords.some((record) => record.po_id === prOpenPoSelectedPrId)) {
    prOpenPoSelectedPrId = '';
    prOpenPoRows = [];
    return null;
  }

  return approvedRecords.find((record) => record.po_id === prOpenPoSelectedPrId) || null;
}

function renderPrOpenedPoSection() {
  const sortedPoRecords = [...prOpenedPoRecords]
    .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
  const totalItems = sortedPoRecords.reduce((sum, po) => sum + po.items.length, 0);

  return `
    <section class="pr-main-card pr-approval-section pr-approval-board">
      <div class="pr-approval-board-top">
        <div>
          <h3>PO ที่เปิดแล้ว</h3>
          <p>ทั้งหมด ${sortedPoRecords.length} ใบ / ${totalItems} รายการ</p>
        </div>
        <span class="pr-status-pill is-approved">เปิด PO แล้ว</span>
      </div>

      <div class="pr-card-list">
        ${sortedPoRecords.length
          ? sortedPoRecords.map(renderPrOpenedPoCard).join('')
          : '<div class="empty-state">ยังไม่มี PO ที่เปิดจาก PR</div>'
        }
      </div>
    </section>
  `;
}

function renderPrOpenedPoCard(po) {
  const isEditing = prOpenedPoEditingId === po.po_id;
  const visibleItems = (po.items || []).filter((item) => !item._deleted);
  const editRows = getPrOpenedPoEditRows(po);
  const itemRows = isEditing
    ? editRows
        .map(({ item, index, isNew }, visibleIndex, visibleRows) => renderPrOpenedPoEditRow(po, item, index, isNew, visibleIndex, visibleRows.length))
        .join('')
    : visibleItems.map((item) => `
      <div class="pr-item-row">
        <strong>${escapeHtml(item.product || '-')}</strong>
        <span>${Number(item.qty || 0).toLocaleString()}</span>
        <span>${escapeHtml(item.unit || '-')}</span>
        <small>${escapeHtml(getPrCompanyNameForProduct(item.product))}</small>
      </div>
    `).join('');

  return `
    <article class="pr-request-card" data-opened-po-card="${escapeHtml(po.po_id || '')}">
      <div class="pr-request-top">
        <div>
          <span>เลข PO</span>
          <strong>${escapeHtml(po.po_id || '-')}</strong>
          <small>อ้างอิง PR ${escapeHtml(po.pr_id || '-')}</small>
        </div>
        <div class="pr-request-actions">
          <span class="pr-status-pill is-approved">เปิด PO แล้ว</span>
          ${isEditing ? '' : `
            <button class="btn-po-edit" type="button" data-edit-opened-po="${escapeHtml(po.po_id || '')}">
              แก้ไข
            </button>
          `}
        </div>
      </div>
      <div class="pr-request-meta">
        <div><span>วันที่เปิด PO</span><strong>${escapeHtml(po.po_date || '-')}</strong></div>
        <div><span>ผู้เปิด PO</span><strong>${escapeHtml(po.po_person || '-')}</strong></div>
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(po.center || '-')}</strong></div>
      </div>
      ${isEditing ? `
        <div class="pr-opened-po-edit-head">
          <span></span>
          <span>รายการสินค้า</span>
          <span>จำนวน</span>
          <span>ต่อกล่อง</span>
          <span>ราคาต่อหน่วย</span>
          <span>ราคารวม</span>
          <span></span>
        </div>
      ` : `
        <div class="pr-item-head">
          <span>สินค้า</span>
          <span>จำนวน</span>
          <span>หน่วย</span>
          <span>บริษัท</span>
        </div>
      `}
      <div class="pr-placeholder-list">
        ${itemRows || '<div class="empty-state">ไม่มีรายการสินค้า</div>'}
      </div>
      ${isEditing ? `
        <div class="pr-opened-po-edit-actions">
          <button class="btn-secondary pr-opened-po-add-row" type="button" data-add-opened-po-edit-row="${escapeHtml(po.po_id || '')}">
            + เพิ่มรายการ
          </button>
          <button class="btn-primary" type="button" data-save-opened-po-edit="${escapeHtml(po.po_id || '')}">
            บันทึก
          </button>
          <button class="btn-secondary" type="button" data-cancel-opened-po-edit>
            ยกเลิก
          </button>
        </div>
      ` : ''}
    </article>
  `;
}

function getPrOpenedPoNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getPrOpenedPoUnitPerBox(item) {
  const explicitValue = item?.unit_per_box ?? item?.unitPerBox;
  if (explicitValue !== null && explicitValue !== undefined && explicitValue !== '') {
    return getPrOpenedPoNumber(explicitValue);
  }

  const qty = getPrOpenedPoNumber(item?.qty);
  const unitQty = getPrOpenedPoNumber(item?.unit_qty ?? item?.unitQty);
  return qty > 0 && unitQty > 0 ? unitQty / qty : 0;
}

function getPrOpenedPoLineTotal(item) {
  const directTotal = getPrOpenedPoNumber(
    item?.total_price
    ?? item?.totalPrice
    ?? item?.line_total
    ?? item?.lineTotal
  );

  if (directTotal > 0) return directTotal;

  const unitQty = getPrOpenedPoNumber(item?.unit_qty ?? item?.unitQty);
  const unitPrice = getPrOpenedPoNumber(item?.unit_price ?? item?.unitPrice);
  return unitQty > 0 && unitPrice > 0 ? unitQty * unitPrice : 0;
}

function getPrOpenedPoEditRows(po) {
  const baseRows = (po.items || [])
    .map((item, index) => ({ item, index, isNew: false }))
    .filter(({ item }) => !item._deleted);
  const extraRows = (prOpenedPoEditExtraRows[po.po_id] || [])
    .map((item, i) => ({ item, index: (po.items || []).length + i, isNew: true }));

  return baseRows.concat(extraRows);
}

function getPrOpenedPoEditSourceItem(po, rowIndex) {
  const baseCount = po?.items?.length || 0;
  if (rowIndex < baseCount) {
    return po?.items?.[rowIndex] || {};
  }

  return prOpenedPoEditExtraRows[po?.po_id]?.[rowIndex - baseCount] || {};
}

function renderPrOpenedPoEditRow(po, item, index, isNew = false, visibleIndex = 0, totalRows = 1) {
  const qty = getPrOpenedPoNumber(item?.qty);
  const unitPerBox = getPrOpenedPoUnitPerBox(item);
  const unitQty = qty * unitPerBox;
  const total = getPrOpenedPoLineTotal(item);
  const unitPrice = unitQty > 0 && total > 0 ? total / unitQty : 0;
  const unit = getPrOpenPoItemUnit(item, { center: po.center, items: po.items });
  const selectedProduct = item.product || '';
  const productCell = isNew
    ? `
      <select class="product-select pr-opened-po-product-select" data-opened-po-edit-product>
        <option value="">— เลือกรายการสินค้า —</option>
        ${getPrOpenPoProductOptions(selectedProduct)}
      </select>
    `
    : `
      <strong class="pr-opened-po-product pr-po-mobile-field" data-label="รายการสินค้า" data-opened-po-edit-product-name="${escapeHtml(selectedProduct)}">
        ${escapeHtml(selectedProduct || '-')}
      </strong>
    `;

  return `
    <div class="pr-opened-po-edit-row" data-opened-po-edit-row="${index}" data-opened-po-edit-is-new="${isNew ? '1' : '0'}">
      <div class="pr-row-order-controls pr-opened-po-order-controls">
        <button type="button" data-move-opened-po-edit-row="${index}" data-opened-po-edit-po-id="${escapeHtml(po.po_id || '')}" data-direction="up" ${visibleIndex <= 0 ? 'disabled' : ''} aria-label="à¹€à¸¥à¸·à¹ˆà¸­à¸™à¸‚à¸¶à¹‰à¸™">↑</button>
        <button type="button" data-move-opened-po-edit-row="${index}" data-opened-po-edit-po-id="${escapeHtml(po.po_id || '')}" data-direction="down" ${visibleIndex >= totalRows - 1 ? 'disabled' : ''} aria-label="à¹€à¸¥à¸·à¹ˆà¸­à¸™à¸¥à¸‡">↓</button>
      </div>
      ${productCell}
      <div class="qty-input-with-unit pr-po-mobile-field" data-label="จำนวน">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(qty || '')}" data-opened-po-edit-qty />
        <span>${escapeHtml(unit || item.unit || 'หน่วย')}</span>
      </div>
      <label class="pr-po-mobile-field" data-label="ต่อกล่อง">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(unitPerBox || '')}" data-opened-po-edit-unit-per-box />
      </label>
      <span class="pr-unit-price pr-po-mobile-field" data-label="ราคาต่อหน่วย">${unitPrice ? formatPrCurrency(unitPrice) : '0.00'}</span>
      <label class="pr-po-mobile-field" data-label="ราคารวม">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(total || '')}" data-opened-po-edit-total />
      </label>
      <button class="btn-remove-row" type="button" data-remove-opened-po-edit-row="${index}" data-opened-po-edit-po-id="${escapeHtml(po.po_id || '')}" aria-label="ลบรายการ">×</button>
    </div>
  `;
}

function refreshPrOpenedPoEditRowTotal(rowEl) {
  if (!rowEl) return;

  const qty = getPrOpenedPoNumber(rowEl.querySelector('[data-opened-po-edit-qty]')?.value);
  const unitPerBox = getPrOpenedPoNumber(rowEl.querySelector('[data-opened-po-edit-unit-per-box]')?.value);
  const total = getPrOpenedPoNumber(rowEl.querySelector('[data-opened-po-edit-total]')?.value);
  const unitQty = qty * unitPerBox;
  const unitPrice = unitQty > 0 && total > 0 ? total / unitQty : 0;
  const unitPriceEl = rowEl.querySelector('.pr-unit-price');

  if (unitPriceEl) {
    unitPriceEl.textContent = unitPrice ? formatPrCurrency(unitPrice) : '0.00';
  }
}

function handlePrOpenedPoEditInput(event) {
  refreshPrOpenedPoEditRowTotal(event.currentTarget);
}

function refreshPrOpenedPoMoveButtons(card) {
  if (!card) return;

  const rows = Array.from(card.querySelectorAll('[data-opened-po-edit-row]'));
  rows.forEach((rowEl, index) => {
    rowEl.dataset.openedPoEditRow = String(index);
    rowEl.querySelectorAll('[data-move-opened-po-edit-row]').forEach((button) => {
      button.dataset.moveOpenedPoEditRow = String(index);
    });
    rowEl.querySelectorAll('[data-remove-opened-po-edit-row]').forEach((button) => {
      button.dataset.removeOpenedPoEditRow = String(index);
    });

    const upButton = rowEl.querySelector('[data-move-opened-po-edit-row][data-direction="up"]');
    const downButton = rowEl.querySelector('[data-move-opened-po-edit-row][data-direction="down"]');

    if (upButton) upButton.disabled = index === 0;
    if (downButton) downButton.disabled = index === rows.length - 1;
  });
}

function isMeaningfulPrOpenedPoItem(item) {
  return Boolean(
    String(item?.product || '').trim()
    || getPrOpenedPoNumber(item?.qty) > 0
    || getPrOpenedPoNumber(item?.unit_per_box ?? item?.unitPerBox) > 0
    || getPrOpenedPoNumber(item?.total_price ?? item?.totalPrice) > 0
  );
}

function syncPrOpenedPoEditState(poId, card) {
  const po = prOpenedPoRecords.find((record) => record.po_id === poId);
  if (!po || !card) return;

  const items = getPrOpenedPoEditedItems(po, card)
    .filter(isMeaningfulPrOpenedPoItem)
    .map((item) => {
      const nextItem = { ...item };
      delete nextItem._deleted;
      return nextItem;
    });

  po.items = items;
  prOpenedPoEditExtraRows[poId] = [];
  refreshPrOpenedPoMoveButtons(card);
}

function movePrOpenedPoEditRow(button) {
  const rowEl = button?.closest('[data-opened-po-edit-row]');
  const card = button?.closest('[data-opened-po-card]');
  if (!rowEl || !card) return;

  const direction = button.dataset.direction || '';
  if (direction === 'up') {
    const previous = rowEl.previousElementSibling;
    if (previous?.matches('[data-opened-po-edit-row]')) {
      rowEl.parentElement.insertBefore(rowEl, previous);
    }
  } else if (direction === 'down') {
    const next = rowEl.nextElementSibling;
    if (next?.matches('[data-opened-po-edit-row]')) {
      rowEl.parentElement.insertBefore(next, rowEl);
    }
  }

  syncPrOpenedPoEditState(card.dataset.openedPoCard || '', card);
}

function addPrOpenedPoEditRow(poId) {
  if (!poId) return;

  const card = document.querySelector(`[data-opened-po-card="${CSS.escape(poId)}"]`);
  if (card) {
    syncPrOpenedPoEditState(poId, card);
  }

  if (!Array.isArray(prOpenedPoEditExtraRows[poId])) {
    prOpenedPoEditExtraRows[poId] = [];
  }

  // ✅ flush ค่าจาก DOM กลับเข้า extraRows ก่อน render
  prOpenedPoEditExtraRows[poId].push({
    product: '',
    qty: '',
    unit: '',
    unit_per_box: null,
    unitPerBox: null,
    unit_qty: null,
    unitQty: null,
    unit_price: null,
    unitPrice: null,
    total_price: null,
    totalPrice: null,
  });

  renderOpenPoPanel();
}

function handlePrOpenedPoProductSelection(event) {
  const rowEl = event.target.closest('[data-opened-po-edit-row]');
  if (!rowEl) return;

  const po = prOpenedPoRecords.find((record) => record.po_id === prOpenedPoEditingId);
  const product = String(event.target.value || '').trim();
  const unit = getPrOpenPoBestStockUnit(product, po?.center || '');
  const unitEl = rowEl.querySelector('.qty-input-with-unit > span');
  if (unitEl) {
    unitEl.textContent = unit || 'หน่วย';
  }

  const rowIndex = Number(rowEl.dataset.openedPoEditRow);
  const baseCount = po?.items?.length || 0;
  if (Number.isFinite(rowIndex) && rowIndex >= baseCount) {
    const extraIndex = rowIndex - baseCount;
    if (prOpenedPoEditExtraRows[po?.po_id]?.[extraIndex]) {
      prOpenedPoEditExtraRows[po.po_id][extraIndex].product = product;
      prOpenedPoEditExtraRows[po.po_id][extraIndex].unit = unit;
    }
  }
}

function getPrOpenedPoEditedItems(po, card) {
  return Array.from(card.querySelectorAll('[data-opened-po-edit-row]')).map((rowEl) => {
    const rowIndex = Number(rowEl.dataset.openedPoEditRow);
    const item = Number.isFinite(rowIndex) ? getPrOpenedPoEditSourceItem(po, rowIndex) : {};
    const product = String(
      rowEl?.querySelector('[data-opened-po-edit-product]')?.value
      || rowEl?.querySelector('[data-opened-po-edit-product-name]')?.dataset.openedPoEditProductName
      || item.product
      || ''
    ).trim();
    const qty = getPrOpenedPoNumber(rowEl?.querySelector('[data-opened-po-edit-qty]')?.value);
    const unitPerBox = getPrOpenedPoNumber(rowEl?.querySelector('[data-opened-po-edit-unit-per-box]')?.value);
    const totalPrice = getPrOpenedPoNumber(rowEl?.querySelector('[data-opened-po-edit-total]')?.value);
    const unitQty = unitPerBox > 0 ? qty * unitPerBox : null;
    const unitPrice = unitQty > 0 && totalPrice > 0 ? totalPrice / unitQty : null;
    const unit = item.unit || getPrOpenPoBestStockUnit(product, po.center);

    return {
      ...item,
      product,
      qty,
      unit,
      unit_per_box: unitPerBox > 0 ? unitPerBox : null,
      unitPerBox: unitPerBox > 0 ? unitPerBox : null,
      unit_qty: unitQty,
      unitQty,
      unit_price: unitPrice,
      unitPrice,
      total_price: totalPrice,
      totalPrice,
    };
  });
}

async function savePrOpenedPoEdit(poId, button) {
  const po = prOpenedPoRecords.find((record) => record.po_id === poId);
  const card = button?.closest('.pr-request-card');

  if (!po || !card) {
    showToast('ไม่พบข้อมูล PO ที่ต้องการแก้ไข', 'error');
    return;
  }

  const items = getPrOpenedPoEditedItems(po, card);
  const invalidItem = items.find((item) => !item.product || Number(item.qty) <= 0);
  if (invalidItem) {
    showToast('กรุณาระบุจำนวนสินค้าใน PO ให้มากกว่า 0', 'error');
    return;
  }

  if (button) button.disabled = true;
  showToast('', 'loading', 'กำลังบันทึกการแก้ไข PO...');

  try {
    let data = null;
    let error = null;

    const rpcResult = await supabaseClient.rpc('update_po_cmo_items', {
      p_po_id: poId,
      p_staff_code: currentUser?.code || '',
      p_staff_name: currentUser?.name || currentUser?.code || '',
      p_items: items,
    });

    data = rpcResult.data;
    error = rpcResult.error;

    if (error && typeof isRpcSignatureError === 'function' && isRpcSignatureError(error)) {
      const directResult = await supabaseClient
        .from('po_cmo_requests')
        .update({
          items,
          edited_by_code: currentUser?.code || '',
          edited_by_name: currentUser?.name || currentUser?.code || '',
          edited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('po_id', poId)
        .select('po_id, items')
        .single();

      data = directResult.data ? { success: true, po_id: directResult.data.po_id } : null;
      error = directResult.error;
    }

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึกการแก้ไข PO ไม่สำเร็จ');
    }

    prOpenedPoEditingId = '';
    delete prOpenedPoEditExtraRows[poId];
    showToast('บันทึกการแก้ไข PO เรียบร้อย', 'success');
    await fetchPrManagerRecords();

    if (typeof fetchPoStatus === 'function') {
      fetchPoStatus();
    }
  } catch (error) {
    console.error('savePrOpenedPoEdit error:', error);
    showToast(`บันทึกการแก้ไข PO ไม่สำเร็จ: ${error.message || error}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function ensurePrOpenPoRowsFromSelectedRecord(record) {
  if (!record) {
    prOpenPoRows = [];
    return;
  }

  if (prOpenPoRows.length) return;

  prOpenPoRows = (record.items || [])
    .map((item, index) => ({
      id: `po-row-${record.po_id || 'pr'}-${index}-${Math.random().toString(16).slice(2)}`,
      itemIndex: String(index),
      product: item.product || '',
      unit: item.unit || '',
      qty: String(Number(item.qty || 0) || ''),
      unitPerBox: '',
      unitQty: '',
      total: '',
    }));
}

function getPrPoStockLocations() {
  if (typeof getPickStockLocations === 'function') {
    return getPickStockLocations();
  }

  return Array.isArray(window.CENTERS) && window.CENTERS.length
    ? window.CENTERS
    : ['Hub Admin', 'สต็อกใหญ่', 'ไตบน', 'ไตล่าง', 'ไตดี'];
}

function getPrTodayDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function refreshNextPoDocumentId(excludedIds = []) {
  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient?.rpc) {
      const { data, error } = await supabaseClient.rpc('next_po_cmo_id');
      if (!error && data) {
        const rpcPoId = String(data || '').trim();
        if (rpcPoId && !excludedIds.includes(rpcPoId)) {
          return rpcPoId;
        }
      } else if (error) {
        console.warn('next_po_cmo_id fallback:', error);
      }
    }

    return typeof newSupabaseDocumentId === 'function'
      ? await newSupabaseDocumentId('PO', excludedIds)
      : newRequestId('po');
  } catch (error) {
    console.warn('refreshNextPoDocumentId error:', error);
    return typeof newRequestId === 'function' ? newRequestId('po') : `PO-${Date.now()}`;
  }
}

async function refreshNextPoDocumentIdInput(excludedIds = []) {
  const input = document.getElementById('pr-po-id');
  if (!input) return '';

  if (prOpenPoDocumentId && !excludedIds.includes(prOpenPoDocumentId)) {
    input.value = prOpenPoDocumentId;
    return prOpenPoDocumentId;
  }

  input.placeholder = 'กำลังดึงเลข PO...';
  const nextPoId = await refreshNextPoDocumentId(excludedIds);
  prOpenPoDocumentId = nextPoId;

  if (document.getElementById('pr-po-id') === input) {
    input.value = nextPoId;
  }

  return nextPoId;
}

function bindPrOpenPoPanel(panel) {
  panel.querySelector('[data-pr-open-po-ref]')?.addEventListener('change', (event) => {
    prOpenPoSelectedPrId = event.target.value;
    prOpenPoRows = [];
    renderOpenPoPanel();
  });

  panel.querySelector('#pr-po-center')?.addEventListener('change', (event) => {
    refreshPrOpenPoUnitsForCenter(event.target.value);
  });

  panel.querySelector('[data-add-pr-po-row]')?.addEventListener('click', addPrOpenPoRow);

  panel.querySelector('[data-pr-po-items]')?.addEventListener('change', handlePrOpenPoRowChange);
  panel.querySelector('[data-pr-po-items]')?.addEventListener('input', handlePrOpenPoRowChange);

  panel.querySelectorAll('[data-pr-po-product]').forEach((select) => {
    if (typeof enhanceStockProductFilter === 'function') {
      enhanceStockProductFilter(select);
    } else if (typeof enhanceProductSelect === 'function') {
      enhanceProductSelect(select);
    }
  });

  panel.querySelectorAll('[data-remove-pr-po-row]').forEach((button) => {
    button.addEventListener('click', () => {
      prOpenPoRows = prOpenPoRows.filter((row) => row.id !== button.dataset.removePrPoRow);
      renderOpenPoPanel();
    });
  });

  panel.querySelectorAll('[data-move-pr-po-row]').forEach((button) => {
    button.addEventListener('click', () => {
      movePrOpenPoRow(button.dataset.movePrPoRow || '', button.dataset.direction || '');
    });
  });

  panel.querySelectorAll('[data-move-opened-po-edit-row]').forEach((button) => {
    button.addEventListener('click', () => movePrOpenedPoEditRow(button));
  });

  panel.querySelectorAll('[data-remove-opened-po-edit-row]').forEach((button) => {
    button.addEventListener('click', () => {
      const poId = button.dataset.openedPoEditPoId;
      const card = button.closest('[data-opened-po-card]');
      const rowEl = button.closest('[data-opened-po-edit-row]');

      if (rowEl) {
        rowEl.remove();
      }

      if (card) {
        syncPrOpenedPoEditState(poId, card);
      }

      renderOpenPoPanel();
    });
  });

  panel.querySelector('[data-save-pr-po]')?.addEventListener('click', savePrOpenPoDraft);

  panel.querySelectorAll('[data-edit-opened-po]').forEach((button) => {
    button.addEventListener('click', () => {
      prOpenedPoEditingId = button.dataset.editOpenedPo || '';
      renderOpenPoPanel();
    });
  });

  panel.querySelectorAll('[data-cancel-opened-po-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      prOpenedPoEditingId = '';
      prOpenedPoEditExtraRows = {};
      renderOpenPoPanel();
    });
  });

  panel.querySelectorAll('[data-add-opened-po-edit-row]').forEach((button) => {
    button.addEventListener('click', () => addPrOpenedPoEditRow(button.dataset.addOpenedPoEditRow || ''));
  });

  panel.querySelectorAll('[data-save-opened-po-edit]').forEach((button) => {
    button.addEventListener('click', () => savePrOpenedPoEdit(button.dataset.saveOpenedPoEdit || '', button));
  });

  panel.querySelectorAll('[data-opened-po-edit-row]').forEach((rowEl) => {
    rowEl.addEventListener('input', handlePrOpenedPoEditInput);
  });

  panel.querySelectorAll('[data-opened-po-edit-product]').forEach((select) => {
    select.addEventListener('change', handlePrOpenedPoProductSelection);
    if (typeof enhanceStockProductFilter === 'function') {
      enhanceStockProductFilter(select);
    } else if (typeof enhanceProductSelect === 'function') {
      enhanceProductSelect(select);
    }
  });
}

function movePrOpenPoRow(rowId, direction) {
  const currentIndex = prOpenPoRows.findIndex((row) => row.id === rowId);
  if (currentIndex < 0) return;

  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= prOpenPoRows.length) return;

  const rows = [...prOpenPoRows];
  [rows[currentIndex], rows[nextIndex]] = [rows[nextIndex], rows[currentIndex]];
  prOpenPoRows = rows;
  renderOpenPoPanel();
}

function addPrOpenPoRow() {
  const approvedRecord = getSelectedApprovedPrForPo();
  if (!approvedRecord) {
    showToast('⚠️ กรุณาเลือก PR ที่อนุมัติแล้วก่อน', 'error');
    return;
  }

  // ✅ flush ค่าจาก DOM กลับเข้า prOpenPoRows ก่อน render
  document.querySelectorAll('[data-pr-po-row]').forEach((rowEl) => {
    const row = prOpenPoRows.find((item) => item.id === rowEl.dataset.prPoRow);
    if (!row) return;
    const qtyEl = rowEl.querySelector('[data-pr-po-qty]');
    const unitPerBoxEl = rowEl.querySelector('[data-pr-po-unit-per-box]');
    const totalEl = rowEl.querySelector('[data-pr-po-line-total]');
    if (qtyEl) row.qty = qtyEl.value;
    if (unitPerBoxEl) {
      row.unitPerBox = unitPerBoxEl.value;
      row.unitQty = (Number(row.qty) || 0) * (Number(row.unitPerBox) || 0);
    }
    if (totalEl) row.total = totalEl.value;
  });

  prOpenPoRows.push({
    id: `po-row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    itemIndex: '',
    product: '',
    unit: '',
    qty: '',
    unitPerBox: '',
    unitQty: '',
    total: '',
  });
  renderOpenPoPanel();
}

function handlePrOpenPoRowChange(event) {
  const rowEl = event.target.closest('[data-pr-po-row]');
  if (!rowEl) return;

  const row = prOpenPoRows.find((item) => item.id === rowEl.dataset.prPoRow);
  if (!row) return;

  if (event.target.matches('[data-pr-po-product]')) {
    row.product = event.target.value;
    const record = getSelectedApprovedPrForPo();
    const itemIndex = getPrOpenPoRecordItemIndexByProduct(record, row.product);
    row.itemIndex = itemIndex >= 0 ? String(itemIndex) : '';
    const item = itemIndex >= 0 ? record?.items?.[itemIndex] : null;
    const selectedCenter = document.getElementById('pr-po-center')?.value || record?.center || '';
    row.unit = item?.unit || getPrOpenPoBestStockUnit(row.product, selectedCenter);
    if (item && !row.qty) {
      row.qty = String(Number(item.qty || 0) || '');
    }
    renderOpenPoPanel();
    return;
  }

  if (event.target.matches('[data-pr-po-qty]')) {
    row.qty = event.target.value;
  }

  if (event.target.matches('[data-pr-po-unit-qty]')) {
    row.unitQty = event.target.value;
  }

  if (event.target.matches('[data-pr-po-unit-per-box]')) {
    row.unitPerBox = event.target.value;
    row.unitQty = (Number(row.qty) || 0) * (Number(row.unitPerBox) || 0);
  }

  if (event.target.matches('[data-pr-po-qty]')) {
    row.qty = event.target.value;
    row.unitQty = (Number(row.qty) || 0) * (Number(row.unitPerBox) || 0);
  }

  if (event.target.matches('[data-pr-po-line-total]')) {
    row.total = event.target.value;
  }

  refreshPrOpenPoTotals();
}

function renderPrOpenPoRows(record) {
  if (!record) {
    return '<div class="empty-state">ยังไม่มี PR ที่อนุมัติแล้วให้เปิด PO</div>';
  }

  if (!prOpenPoRows.length) {
    return '<div class="empty-state">PR นี้ไม่มีรายการสินค้า</div>';
  }

  return prOpenPoRows.map((row) => renderPrOpenPoRow(row, record)).join('');
}

function getPrOpenPoProductKey(value) {
  if (typeof normalizeProductKey === 'function') {
    return normalizeProductKey(value);
  }

  return String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getPrOpenPoRecordItemIndexByProduct(record, product) {
  if (!record || !product) return -1;

  const targetProduct = getPrOpenPoProductKey(product);
  return (record.items || []).findIndex((item) => (
    getPrOpenPoProductKey(item.product) === targetProduct
  ));
}

function getPrOpenPoSourceItem(record, row) {
  const itemIndexText = String(row?.itemIndex ?? '').trim();
  if (!record || itemIndexText === '' || !/^\d+$/.test(itemIndexText)) return null;

  return record.items?.[Number(itemIndexText)] || null;
}

function getPrOpenPoBestStockUnit(product, preferredCenter = '') {
  const normalizedProduct = getPrOpenPoProductKey(product);
  if (!normalizedProduct) return '';

  const unitScores = new Map();
  const stockUnits = typeof localStockUnits !== 'undefined' ? localStockUnits : {};
  const knownCenters = [
    preferredCenter,
    ...getPrPoStockLocations(),
    ...Object.keys(stockUnits || {}),
  ].filter(Boolean);
  const centers = [...new Set(knownCenters)];

  centers.forEach((center, centerIndex) => {
    const unitMap = stockUnits?.[center] || {};
    const matchedProduct = Object.keys(unitMap)
      .find((stockProduct) => getPrOpenPoProductKey(stockProduct) === normalizedProduct);
    const unit = String(matchedProduct ? unitMap[matchedProduct] : '').trim();
    if (!unit) return;

    const key = unit.toLowerCase();
    const current = unitScores.get(key) || {
      unit,
      count: 0,
      bestPriority: Number.MAX_SAFE_INTEGER,
    };
    current.count += 1;
    current.bestPriority = Math.min(current.bestPriority, center === preferredCenter ? 0 : centerIndex + 1);
    unitScores.set(key, current);
  });

  const bestUnit = [...unitScores.values()]
    .sort((a, b) => b.count - a.count || a.bestPriority - b.bestPriority)[0];

  if (bestUnit?.unit) return bestUnit.unit;

  return typeof getStockUnit === 'function'
    ? getStockUnit(preferredCenter, product)
    : '';
}

function getPrOpenPoProductOptions(selectedProduct = '') {
  const selectedKey = getPrOpenPoProductKey(selectedProduct);
  const productMap = new Map();

  if (Array.isArray(PRODUCTS)) {
    PRODUCTS.forEach((product) => {
      const key = getPrOpenPoProductKey(product);
      if (key && !productMap.has(key)) productMap.set(key, product);
    });
  }

  if (selectedProduct && selectedKey && !productMap.has(selectedKey)) {
    productMap.set(selectedKey, selectedProduct);
  }

  return [...productMap.values()]
    .sort((a, b) => String(a).localeCompare(String(b), 'th'))
    .map((product) => `
      <option value="${escapeHtml(product)}"${getPrOpenPoProductKey(product) === selectedKey ? ' selected' : ''}>
        ${escapeHtml(product)}
      </option>
    `).join('');
}

function renderPrOpenPoRow(row, record) {
  const rowIndex = prOpenPoRows.findIndex((item) => item.id === row.id);
  const sourceItem = getPrOpenPoSourceItem(record, row);
  const selectedProduct = row.product || sourceItem?.product || '';
  const unitQty = (Number(row.qty) || 0) * (Number(row.unitPerBox) || 0);
  const unitPrice = unitQty > 0 ? (Number(row.total) || 0) / unitQty : 0;
  const selectedItem = sourceItem || (selectedProduct ? { product: selectedProduct, unit: row.unit } : null);
  const unit = getPrOpenPoItemUnit(selectedItem, record);

  return `
    <div class="pr-price-row pr-open-po-row" data-pr-po-row="${escapeHtml(row.id)}">
      <div class="pr-row-order-controls">
        <button type="button" data-move-pr-po-row="${escapeHtml(row.id)}" data-direction="up" ${rowIndex <= 0 ? 'disabled' : ''} aria-label="เลื่อนรายการขึ้น">↑</button>
        <button type="button" data-move-pr-po-row="${escapeHtml(row.id)}" data-direction="down" ${rowIndex >= prOpenPoRows.length - 1 ? 'disabled' : ''} aria-label="เลื่อนรายการลง">↓</button>
      </div>
      <select class="product-select" data-pr-po-product>
        <option value="">— เลือกรายการสินค้า —</option>
        ${getPrOpenPoProductOptions(selectedProduct)}
      </select>
      <div class="qty-input-with-unit pr-po-mobile-field" data-label="จำนวน">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(row.qty)}" data-pr-po-qty />
        <span>${escapeHtml(unit || 'หน่วย')}</span>
      </div>
      <label class="pr-po-mobile-field" data-label="ต่อกล่อง">
        <input type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(row.unitPerBox || '')}" data-pr-po-unit-per-box />
      </label>
      <span class="pr-unit-price pr-po-mobile-field" data-label="ราคาต่อหน่วย">${unitPrice ? formatPrCurrency(unitPrice) : '0.00'}</span>
      <label class="pr-po-mobile-field" data-label="ราคารวม">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(row.total)}" data-pr-po-line-total />
      </label>
      <button class="btn-remove-row" type="button" data-remove-pr-po-row="${escapeHtml(row.id)}" aria-label="ลบรายการ">×</button>
    </div>
  `;
}

function getPrOpenPoItemUnit(item, record) {
  if (!item) return '';

  const directUnit = String(
    item.unit
    || item.Unit
    || item.unit_name
    || item.product_unit
    || item.uom
    || ''
  ).trim();

  if (directUnit) return directUnit;

  const product = item.product || item.name || '';
  const selectedCenter = document.getElementById('pr-po-center')?.value || record?.center || '';
  return getPrOpenPoBestStockUnit(product, selectedCenter);
}

function refreshPrOpenPoUnitsForCenter(center) {
  const record = getSelectedApprovedPrForPo();

  document.querySelectorAll('[data-pr-po-row]').forEach((rowEl) => {
    const row = prOpenPoRows.find((item) => item.id === rowEl.dataset.prPoRow);
    if (!row) return;

    const sourceItem = getPrOpenPoSourceItem(record, row);
    const product = row.product || sourceItem?.product || '';
    if (!product) return;

    row.unit = sourceItem?.unit || getPrOpenPoBestStockUnit(product, center);
    const unit = getPrOpenPoItemUnit(sourceItem || { product, unit: row.unit }, { ...record, center });
    const unitEl = rowEl.querySelector('.qty-input-with-unit > span');
    if (unitEl) {
      unitEl.textContent = unit || 'หน่วย';
    }
  });
}

function refreshPrOpenPoTotals() {
  document.querySelectorAll('[data-pr-po-row]').forEach((rowEl) => {
    const row = prOpenPoRows.find((item) => item.id === rowEl.dataset.prPoRow);
    const unitPrice = getPrOpenPoUnitPrice(row);
    const unitPriceEl = rowEl.querySelector('.pr-unit-price');
    if (unitPriceEl) {
      unitPriceEl.textContent = unitPrice ? formatPrCurrency(unitPrice) : '0.00';
    }
  });

  const totalEl = document.querySelector('[data-pr-po-total]');
  if (totalEl) {
    totalEl.textContent = `${formatPrCurrency(getPrOpenPoTotal())} บาท`;
  }

  const saveButton = document.querySelector('[data-save-pr-po]');
  if (saveButton) {
    saveButton.disabled = !getValidPrOpenPoRows().length;
  }
}

function getPrOpenPoUnitPrice(row) {
  const qty = Number(row?.unitQty || 0);
  const total = Number(row?.total || 0);
  return qty > 0 && total > 0 ? total / qty : 0;
}

function getPrOpenPoTotal() {
  return prOpenPoRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
}

function getValidPrOpenPoRows() {
  return prOpenPoRows.filter((row) => (
    String(row.product || '').trim() !== ''
    && Number(row.qty) > 0
  ));
}

function formatPrCurrency(value) {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function savePrOpenPoDraft() {
  const record = getSelectedApprovedPrForPo();
  const validRows = getValidPrOpenPoRows();
  const poIdInput = document.getElementById('pr-po-id');
  const date = document.getElementById('pr-po-date')?.value || '';
  const person = document.getElementById('pr-po-person')?.value.trim() || currentUser?.name || currentUser?.code || '';
  const center = document.getElementById('pr-po-center')?.value || record?.center || '';
  const note = document.getElementById('pr-po-note')?.value.trim() || '';
  const button = document.querySelector('[data-save-pr-po]');

  if (!record) {
    showToast('⚠️ กรุณาเลือก PR ที่อนุมัติแล้วก่อน', 'error');
    return;
  }

  if (!date) {
    showToast('⚠️ กรุณาเลือกวันที่เปิด PO', 'error');
    document.getElementById('pr-po-date')?.focus();
    return;
  }

  if (!center) {
    showToast('⚠️ กรุณาเลือกสต็อกที่จะรับเข้า', 'error');
    document.getElementById('pr-po-center')?.focus();
    return;
  }

  if (!validRows.length) {
    showToast('⚠️ กรุณาเลือกรายการสินค้า พร้อมระบุจำนวน และจำนวนต่อกล่อง', 'error');
    return;
  }

  const items = validRows.map((row) => {
    const sourceItem = getPrOpenPoSourceItem(record, row) || {};
    const product = row.product || sourceItem.product || '';
    const qty = Number(row.qty) || 0;
    const unitPerBox = Number(row.unitPerBox) > 0 ? Number(row.unitPerBox) : null;
    const unitQty = unitPerBox === null ? null : qty * unitPerBox;
    const totalPrice = Number(row.total) || 0;
    const unitPrice = unitQty > 0 ? totalPrice / unitQty : null;
    const unit = row.unit || getPrOpenPoItemUnit(sourceItem.product ? sourceItem : { product }, record);

    return {
      product,
      qty,
      unit,
      unit_per_box: unitPerBox,
      unitPerBox,
      unit_qty: unitQty,
      unitQty,
      unit_price: unitPrice,
      unitPrice,
      total_price: totalPrice,
      totalPrice,
      pr_id: record.po_id,
      prId: record.po_id,
      pr_line_index: row.itemIndex === '' ? null : Number(row.itemIndex),
      prLineIndex: row.itemIndex === '' ? null : Number(row.itemIndex),
      company: getPrCompanyNameForProduct(product),
      center,
      stock_center: center,
    };
  }).filter((item) => item.product && item.qty > 0);

  const noteWithPr = [
    `อ้างอิง PR ${record.po_id}`,
    note,
  ].filter(Boolean).join(' / ');

  if (button) button.disabled = true;
  showToast('', 'loading', 'กำลังบันทึก PO...');

  try {
    let data = null;
    let error = null;
    const attemptedPoIds = [];
    let nextPoId = String(poIdInput?.value || prOpenPoDocumentId || '').trim();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clientRequestId = nextPoId || await refreshNextPoDocumentIdInput(attemptedPoIds);
      if (poIdInput) poIdInput.value = clientRequestId;
      attemptedPoIds.push(clientRequestId);

      const createPoParams = {
        p_client_request_id: clientRequestId,
        p_staff_code: currentUser?.code || '',
        p_date: date,
        p_person: person,
        p_center: center,
        p_note: noteWithPr,
        p_items: items,
      };

      const result = await supabaseClient.rpc('create_po_cmo', createPoParams);
      data = result.data;
      error = result.error;

      if (error) {
        throw error;
      }

      if (data?.duplicate !== true) {
        break;
      }

      nextPoId = await refreshNextPoDocumentIdInput(attemptedPoIds);
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึก PO ไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      throw new Error('เลข PO ซ้ำกับรายการเดิม กรุณากดบันทึกใหม่อีกครั้ง');
    }

    showToast(`✅ บันทึก PO สำเร็จ: ${data.po_id || ''}`, 'success');
    prOpenPoRows = [];
    prOpenPoSelectedPrId = '';
    prOpenPoDocumentId = '';
    document.getElementById('pr-po-date') && (document.getElementById('pr-po-date').value = '');
    document.getElementById('pr-po-person') && (document.getElementById('pr-po-person').value = '');
    document.getElementById('pr-po-center') && (document.getElementById('pr-po-center').value = '');
    document.getElementById('pr-po-note') && (document.getElementById('pr-po-note').value = '');

    const prSelector = document.querySelector('[data-pr-open-po-ref]');
    if (prSelector) prSelector.value = '';
    await fetchPrManagerRecords();

    if (typeof fetchPoStatus === 'function') {
      fetchPoStatus();
    }

    if (typeof fetchPendingPoSummary === 'function') {
      fetchPendingPoSummary();
    }

  } catch (error) {
    console.error('savePrOpenPoDraft error:', error);
    showToast(`❌ ${error.message || 'บันทึก PO ไม่สำเร็จ'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAddDataPanel() {
  const panel = ensurePrPanel('pr_add_data', 'panel-pr-add-data');
  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">➕</span>
      <div>
        <h2>Add Data</h2>
        <p>โครงหน้าสำหรับเพิ่มสินค้าและข้อมูลบริษัทที่ใช้ใน PO</p>
      </div>
    </div>

    <div class="pr-layout pr-add-data-layout">
      <section class="pr-main-card">
        <div class="pr-card-head">
          <div>
            <h3>บริษัทและสินค้า</h3>
            <p>เพิ่มข้อมูลบริษัทผู้ขายก่อน แล้วผูกสินค้าเข้ากับบริษัทนั้น</p>
          </div>
          <button class="btn-add-row" type="button">แก้ไข</button>
        </div>

        <div class="pr-add-data-section">
          <div class="pr-add-data-section-head">
            <h4>บริษัทผู้ขาย</h4>
            <span>ข้อมูลสำหรับเปิด PO และส่งเอกสารให้บริษัท</span>
          </div>

          <div class="form-grid">
            <div class="field-group field-group-full">
              <label>ชื่อบริษัท</label>
              <select id="add-data-vendor-name">
                <option value="">พิมพ์หรือเลือกบริษัท</option>
              </select>
            </div>
            <div class="field-group field-group-full">
              <label>ที่อยู่ 1</label>
              <input id="add-data-vendor-address-1" type="text" placeholder="ที่อยู่บรรทัดที่ 1" />
            </div>
            <div class="field-group field-group-full">
              <label>ที่อยู่ 2</label>
              <input id="add-data-vendor-address-2" type="text" placeholder="ที่อยู่บรรทัดที่ 2" />
            </div>
            <div class="field-group">
              <label>เบอร์โทร</label>
              <input id="add-data-vendor-phone" type="tel" placeholder="เบอร์โทร" />
            </div>
            <div class="field-group">
              <label>E-mail</label>
              <input id="add-data-vendor-email" type="email" placeholder="email@example.com" />
            </div>
          </div>
        </div>

        <div class="pr-add-data-section">
          <div class="pr-add-data-section-head">
            <h4>สินค้า</h4>
            <span>รายการสินค้าและสต็อกเริ่มต้นที่ผูกกับบริษัทนี้</span>
          </div>

        <div class="form-grid">
          <div class="field-group field-group-full">
            <label>ชื่อสินค้า</label>
            <input id="add-data-product-name" type="text" placeholder="กรอกชื่อสินค้า" />
          </div>
          <div class="field-group field-group-full">
            <label>Product type</label>
            <select id="add-data-product-type">
              <option value="">พิมพ์หรือเลือก Product type</option>
              ${getAddDataProductTypeOptions()}
            </select>
          </div>
          <div class="field-group field-group-full">
            <label>รายการสินค้าของบริษัท</label>
            <select id="add-data-product-select">
              <option value="">— เลือกสินค้าจาก Stock —</option>
              ${typeof getProductOptions === 'function' ? getProductOptions() : ''}
            </select>
          </div>
          <div class="field-group field-group-full">
            <label>Location</label>
            <div class="pr-check-grid">
              ${['Hub Admin', 'สต็อกใหญ่', 'ไตบน', 'ไตล่าง', 'ไตดี'].map((center) => `
                <label class="pr-location-check">
                  <input type="checkbox" value="${escapeHtml(center)}" data-add-data-location />
                  <span class="pr-location-check-box" aria-hidden="true"></span>
                  <span class="pr-location-check-text">${escapeHtml(center)}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="field-group field-group-full">
            <label>สต็อกเดิม</label>
            <div class="pr-stock-qty-grid">
              ${['Hub Admin', 'สต็อกใหญ่', 'ไตบน', 'ไตล่าง', 'ไตดี'].map((center) => `
                <label class="pr-stock-qty-box">
                  <span>${escapeHtml(center)}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputmode="decimal"
                    placeholder="0"
                    data-add-data-current-stock-qty="${escapeHtml(center)}"
                  />
                </label>
              `).join('')}
            </div>
          </div>
          <div class="field-group field-group-full">
            <label>เพิ่มสต็อกใหม่</label>
            <div class="pr-stock-qty-grid">
              ${['Hub Admin', 'สต็อกใหญ่', 'ไตบน', 'ไตล่าง', 'ไตดี'].map((center) => `
                <label class="pr-stock-qty-box">
                  <span>${escapeHtml(center)}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputmode="decimal"
                    placeholder="0"
                    data-add-data-stock-qty="${escapeHtml(center)}"
                  />
                </label>
              `).join('')}
            </div>
          </div>
          <div class="field-group field-group-full">
            <label>Cost สินค้า</label>
            <div class="pr-add-data-cost-row">
              <input id="add-data-cost-qty" type="number" min="0" step="0.001" inputmode="decimal" placeholder="จำนวน" />
              <input id="add-data-cost-unit-qty" type="number" min="0" step="0.001" inputmode="decimal" placeholder="จำนวนชิ้น" />
              <input id="add-data-cost-unit-price" type="text" inputmode="decimal" placeholder="ราคาต่อชิ้น" />
              <input id="add-data-cost-total-price" type="text" inputmode="decimal" placeholder="ราคารวม" />
              <input id="add-data-product-unit" type="text" placeholder="หน่วย เช่น แกลลอน / ลัง / ชิ้น" />
            </div>
          </div>
        </div>
        </div>

        <div class="pr-add-data-actions">
          <button class="btn-submit" type="button" onclick="saveAddDataVendorProduct(this)">
            บันทึกข้อมูล
          </button>
        </div>
      </section>
    </div>
  `;

  const productSelect = document.getElementById('add-data-product-select');
  if (productSelect) {
    enhanceAddDataProductSelect(productSelect);
  }

  const productTypeSelect = document.getElementById('add-data-product-type');
  if (productTypeSelect) {
    loadAddDataProductTypeSelect(productTypeSelect);
  }

  const vendorSelect = document.getElementById('add-data-vendor-name');
  if (vendorSelect) {
    loadAddDataVendorSelect(vendorSelect);
  }

  enhanceAddDataLocationChecks();
  enhanceAddDataStockQtyInputs();
  enhanceAddDataCostInputs();
  bindAddDataProductDetailEvents(productSelect);
}

function enhanceAddDataLocationChecks() {
  document.querySelectorAll('[data-add-data-location]').forEach((input) => {
    const label = input.closest('.pr-location-check');
    const syncCheckedState = () => {
      label?.classList.toggle('is-checked', input.checked);
    };

    input.addEventListener('change', syncCheckedState);
    syncCheckedState();
  });
}

function getAddDataStockQtyInput(center) {
  return document.querySelector(`[data-add-data-stock-qty="${CSS.escape(center)}"]`);
}

function getAddDataCurrentStockQtyInput(center) {
  return document.querySelector(`[data-add-data-current-stock-qty="${CSS.escape(center)}"]`);
}

function syncAddDataLocationFromQty(center, qtyValue) {
  const qty = Number(qtyValue);
  if (!center || !Number.isFinite(qty) || qty <= 0) return;

  const checkbox = Array.from(document.querySelectorAll('[data-add-data-location]'))
    .find((input) => input.value === center);

  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function enhanceAddDataStockQtyInputs() {
  document.querySelectorAll('[data-add-data-stock-qty]').forEach((input) => {
    input.addEventListener('input', () => {
      syncAddDataLocationFromQty(input.dataset.addDataStockQty || '', input.value);
    });
  });
}

function parseAddDataDecimal(value) {
  const cleaned = String(value ?? '').trim().replace(/,/g, '.');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getAddDataCostValues() {
  const qty = Number(document.getElementById('add-data-cost-qty')?.value || 0);
  const unitQty = Number(document.getElementById('add-data-cost-unit-qty')?.value || 0);
  const unitPrice = parseAddDataDecimal(document.getElementById('add-data-cost-unit-price')?.value);
  const totalPrice = parseAddDataDecimal(document.getElementById('add-data-cost-total-price')?.value);
  return {
    qty: Number.isFinite(qty) ? qty : 0,
    unitQty: Number.isFinite(unitQty) ? unitQty : 0,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
  };
}

function refreshAddDataCostCalculation(changedField = '') {
  const qtyInput = document.getElementById('add-data-cost-qty');
  const unitQtyInput = document.getElementById('add-data-cost-unit-qty');
  const unitPriceInput = document.getElementById('add-data-cost-unit-price');
  const totalPriceInput = document.getElementById('add-data-cost-total-price');
  if (!qtyInput || !unitQtyInput || !unitPriceInput || !totalPriceInput) return;

  const qty = Number(qtyInput.value || 0);
  const unitQty = Number(unitQtyInput.value || 0);
  const unitPrice = parseAddDataDecimal(unitPriceInput.value);
  const totalPrice = parseAddDataDecimal(totalPriceInput.value);
  const totalUnitQty = qty * unitQty;

  if (changedField === 'total' && totalUnitQty > 0 && totalPrice >= 0) {
    unitPriceInput.value = totalPrice ? (totalPrice / totalUnitQty).toFixed(2) : '';
    return;
  }

  if ((changedField === 'qty' || changedField === 'unitQty' || changedField === 'unitPrice') && totalUnitQty > 0 && unitPrice >= 0) {
    totalPriceInput.value = unitPrice ? (totalUnitQty * unitPrice).toFixed(2) : '';
  }
}

function enhanceAddDataCostInputs() {
  document.getElementById('add-data-cost-qty')?.addEventListener('input', () => {
    refreshAddDataCostCalculation('qty');
  });
  document.getElementById('add-data-cost-unit-qty')?.addEventListener('input', () => {
    refreshAddDataCostCalculation('unitQty');
  });
  document.getElementById('add-data-cost-unit-price')?.addEventListener('input', () => {
    refreshAddDataCostCalculation('unitPrice');
  });
  document.getElementById('add-data-cost-total-price')?.addEventListener('input', () => {
    refreshAddDataCostCalculation('total');
  });
}

function getAddDataVendorKey(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function loadAddDataVendorSelect(select) {
  if (!select || typeof supabaseClient === 'undefined') return;

  const currentValue = select.tomselect ? select.tomselect.getValue() : select.value;

  try {
    const { data, error } = await supabaseClient
      .from('vendors')
      .select('vendor_name, address_1, address_2, phone, email, is_active')
      .eq('is_active', true)
      .order('vendor_name', { ascending: true });

    if (error) throw error;

    addDataVendorMetaMap = new Map();
    const vendors = (data || [])
      .map((vendor) => ({
        name: String(vendor.vendor_name || '').trim(),
        address1: vendor.address_1 || '',
        address2: vendor.address_2 || '',
        phone: vendor.phone || '',
        email: vendor.email || '',
      }))
      .filter((vendor) => vendor.name);

    vendors.forEach((vendor) => {
      addDataVendorMetaMap.set(getAddDataVendorKey(vendor.name), vendor);
    });

    if (select.tomselect) {
      select.tomselect.clearOptions();
      vendors.forEach((vendor) => {
        select.tomselect.addOption({ value: vendor.name, text: vendor.name });
      });
      select.tomselect.refreshOptions(false);
    } else {
      select.innerHTML = `
        <option value=""></option>
        ${vendors.map((vendor) => `
          <option value="${escapeHtml(vendor.name)}">${escapeHtml(vendor.name)}</option>
        `).join('')}
      `;
    }

    enhanceAddDataVendorSelect(select);

    if (currentValue) {
      setAddDataFieldValue('add-data-vendor-name', currentValue);
    }
  } catch (error) {
    console.warn('Load vendors failed:', error);
    enhanceAddDataVendorSelect(select);
  }
}

function enhanceAddDataVendorSelect(select) {
  if (!select || select.tomselect) return;

  if (typeof TomSelect === 'undefined') {
    return;
  }

  if (typeof shouldUseNativeSelectOnAndroid === 'function' && shouldUseNativeSelectOnAndroid()) {
    select.classList.add('native-android-select');
    return;
  }

  const ts = new TomSelect(select, {
    create: true,
    persist: false,
    allowEmptyOption: true,
    maxOptions: 80,
    dropdownParent: 'body',
    placeholder: 'พิมพ์หรือเลือกบริษัท',
    plugins: {
      clear_button: {
        title: 'ล้างชื่อบริษัท',
      },
    },
    onDropdownOpen: function () {
      if (typeof positionTomSelectDropdown === 'function') {
        positionTomSelectDropdown(this);
      }
    },
    onChange: function (value) {
      handleAddDataVendorSelection(value);
    },
  });

  ts.wrapper.classList.add('stock-product-filter-select', 'add-data-vendor-filter-select');
  ts.control_input.setAttribute('placeholder', 'พิมพ์หรือเลือกบริษัท');
}

function handleAddDataVendorSelection(vendorName) {
  const selectedVendor = String(vendorName || '').trim();
  if (!selectedVendor) {
    setAddDataFieldValue('add-data-vendor-address-1', '');
    setAddDataFieldValue('add-data-vendor-address-2', '');
    setAddDataFieldValue('add-data-vendor-phone', '');
    setAddDataFieldValue('add-data-vendor-email', '');
    return;
  }

  const vendor = addDataVendorMetaMap.get(getAddDataVendorKey(selectedVendor));
  if (!vendor) {
    setAddDataFieldValue('add-data-vendor-address-1', '');
    setAddDataFieldValue('add-data-vendor-address-2', '');
    setAddDataFieldValue('add-data-vendor-phone', '');
    setAddDataFieldValue('add-data-vendor-email', '');
    return;
  }

  setAddDataFieldValue('add-data-vendor-address-1', vendor.address1 || '');
  setAddDataFieldValue('add-data-vendor-address-2', vendor.address2 || '');
  setAddDataFieldValue('add-data-vendor-phone', vendor.phone || '');
  setAddDataFieldValue('add-data-vendor-email', vendor.email || '');
}

function getAddDataProductTypeKey(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getAddDataKnownProductTypes() {
  const productTypes = [];
  const seen = new Set();
  const addType = (value) => {
    const productType = String(value || '').trim();
    const key = getAddDataProductTypeKey(productType);
    if (!productType || seen.has(key)) return;
    seen.add(key);
    productTypes.push(productType);
  };

  if (typeof localStockTypes !== 'undefined') {
    Object.values(localStockTypes || {}).forEach((centerTypes) => {
      Object.values(centerTypes || {}).forEach(addType);
    });
  }

  prProductTypeMap.forEach(addType);

  return productTypes;
}

function getAddDataProductTypeOptions() {
  return getAddDataKnownProductTypes()
    .map((productType) => `<option value="${escapeHtml(productType)}">${escapeHtml(productType)}</option>`)
    .join('');
}

async function loadAddDataProductTypeSelect(select) {
  if (!select) return;

  const currentValue = select.tomselect ? select.tomselect.getValue() : select.value;
  const productTypes = [];
  const seen = new Set();
  const addType = (value) => {
    const productType = String(value || '').trim();
    const key = getAddDataProductTypeKey(productType);
    if (!productType || seen.has(key)) return;
    seen.add(key);
    productTypes.push(productType);
  };

  getAddDataKnownProductTypes().forEach(addType);

  if (typeof supabaseClient !== 'undefined') {
    try {
      const { data, error } = await supabaseClient
        .from('stock_items')
        .select('product_type')
        .not('product_type', 'is', null)
        .order('product_type', { ascending: true });

      if (error) throw error;
      (data || []).forEach((row) => addType(row.product_type));
    } catch (error) {
      console.warn('Load stock product types failed:', error);
    }

    try {
      const { data, error } = await supabaseClient
        .from('vendor_products')
        .select('product_type')
        .not('product_type', 'is', null)
        .order('product_type', { ascending: true });

      if (error) throw error;
      (data || []).forEach((row) => addType(row.product_type));
    } catch (error) {
      console.warn('Load vendor product types failed:', error);
    }
  }

  if (select.tomselect) {
    select.tomselect.clearOptions();
    productTypes.forEach((productType) => {
      select.tomselect.addOption({ value: productType, text: productType });
    });
    select.tomselect.refreshOptions(false);
  } else {
    select.innerHTML = `
      <option value=""></option>
      ${productTypes.map((productType) => `
        <option value="${escapeHtml(productType)}">${escapeHtml(productType)}</option>
      `).join('')}
    `;
  }

  enhanceAddDataProductTypeSelect(select);

  if (currentValue) {
    setAddDataFieldValue('add-data-product-type', currentValue);
  }
}

function enhanceAddDataProductTypeSelect(select) {
  if (!select || select.tomselect) return;

  if (typeof TomSelect === 'undefined') {
    return;
  }

  if (typeof shouldUseNativeSelectOnAndroid === 'function' && shouldUseNativeSelectOnAndroid()) {
    select.classList.add('native-android-select');
    return;
  }

  const ts = new TomSelect(select, {
    create: true,
    persist: false,
    allowEmptyOption: true,
    maxOptions: 80,
    dropdownParent: 'body',
    placeholder: 'พิมพ์หรือเลือก Product type',
    plugins: {
      clear_button: {
        title: 'ล้าง Product type',
      },
    },
    onDropdownOpen: function () {
      if (typeof positionTomSelectDropdown === 'function') {
        positionTomSelectDropdown(this);
      }
    },
  });

  ts.wrapper.classList.add('stock-product-filter-select', 'add-data-product-type-filter-select');
  ts.control_input.setAttribute('placeholder', 'พิมพ์หรือเลือก Product type');
}

function enhanceAddDataProductSelect(select) {
  if (!select || select.tomselect) return;

  if (typeof shouldUseNativeSelectOnAndroid === 'function' && shouldUseNativeSelectOnAndroid()) {
    select.classList.add('native-android-select');
    return;
  }

  const ts = new TomSelect(select, {
    create: false,
    allowEmptyOption: true,
    maxOptions: 50,
    dropdownParent: 'body',
    placeholder: '— เลือกสินค้าจาก Stock —',
    plugins: {
      clear_button: {
        title: 'ล้างรายการสินค้า',
      },
    },
    onDropdownOpen: function () {
      if (typeof positionTomSelectDropdown === 'function') {
        positionTomSelectDropdown(this);
      }
    },
    onChange: function (value) {
      handleAddDataProductSelection(value);
    },
  });

  ts.wrapper.classList.add('stock-product-filter-select', 'add-data-product-filter-select');
  ts.control_input.setAttribute('placeholder', '— เลือกสินค้าจาก Stock —');
}

function bindAddDataProductDetailEvents(select) {
  if (!select) return;
  select.addEventListener('change', () => {
    handleAddDataProductSelection(select.value);
  });
}

function setAddDataFieldValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  const nextValue = value === undefined || value === null ? '' : String(value).trim();

  if (input.tomselect) {
    if (nextValue && !input.tomselect.options[nextValue]) {
      input.tomselect.addOption({ value: nextValue, text: nextValue });
    }
    input.tomselect.setValue(nextValue, true);
    input.value = nextValue;
    return;
  }

  input.value = nextValue;
}

function resetAddDataForm() {
  [
    'add-data-vendor-name',
    'add-data-vendor-address-1',
    'add-data-vendor-address-2',
    'add-data-vendor-phone',
    'add-data-vendor-email',
    'add-data-product-name',
    'add-data-product-type',
    'add-data-product-unit',
    'add-data-cost-qty',
    'add-data-cost-unit-qty',
    'add-data-cost-unit-price',
    'add-data-cost-total-price',
  ].forEach((id) => setAddDataFieldValue(id, ''));

  const productSelect = document.getElementById('add-data-product-select');
  if (productSelect) {
    if (productSelect.tomselect) {
      productSelect.tomselect.clear(true);
    }
    productSelect.value = '';
  }

  document.querySelectorAll('[data-add-data-location]').forEach((input) => {
    input.checked = false;
    input.closest('.pr-location-check')?.classList.remove('is-checked');
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  document.querySelectorAll('[data-add-data-stock-qty], [data-add-data-current-stock-qty]').forEach((input) => {
    input.value = '';
  });
}

function getAddDataExistingStockCenters(product) {
  if (!product || typeof localStock === 'undefined') return [];

  const normalizedProduct = typeof normalizeProductKey === 'function'
    ? normalizeProductKey(product)
    : String(product || '').trim().toLowerCase();

  return getPrPoStockLocations().filter((center) => {
    const stock = localStock?.[center] || {};
    return Object.keys(stock).some((stockProduct) => {
      const normalizedStockProduct = typeof normalizeProductKey === 'function'
        ? normalizeProductKey(stockProduct)
        : String(stockProduct || '').trim().toLowerCase();
      return normalizedStockProduct === normalizedProduct;
    });
  });
}

function parseAddDataLocationList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function setAddDataLocationChecks(locations) {
  const selected = new Set((locations || []).map((item) => (
    typeof normalizeCenterName === 'function' ? normalizeCenterName(item) : item
  )));

  document.querySelectorAll('[data-add-data-location]').forEach((input) => {
    const center = typeof normalizeCenterName === 'function'
      ? normalizeCenterName(input.value)
      : input.value;
    input.checked = selected.has(center);
    input.closest('.pr-location-check')?.classList.toggle('is-checked', input.checked);
  });
}

function getAddDataStockQtyMap(product) {
  const qtyMap = {};
  getPrPoStockLocations().forEach((center) => {
    qtyMap[center] = typeof getStockQty === 'function'
      ? getStockQty(center, product)
      : Number(localStock?.[center]?.[product] || 0);
  });
  return qtyMap;
}

function getAddDataProductKey(value) {
  if (typeof normalizeStockProductKeyForLoad === 'function') {
    return normalizeStockProductKeyForLoad(value);
  }
  if (typeof normalizeProductKey === 'function') {
    return normalizeProductKey(value);
  }
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function fetchAddDataStockRows(product) {
  if (!product || typeof supabaseClient === 'undefined') return null;

  try {
    const { data, error } = await supabaseClient.rpc('get_stock_items');

    if (error) throw error;

    const targetProduct = getAddDataProductKey(product);
    const allowedCenters = new Set(getPrPoStockLocations().map((center) => (
      typeof normalizeCenterName === 'function' ? normalizeCenterName(center) : center
    )));

    return (data || []).filter((row) => {
      const center = typeof normalizeCenterName === 'function'
        ? normalizeCenterName(row.center)
        : row.center;
      return allowedCenters.has(center) && getAddDataProductKey(row.product) === targetProduct;
    });
  } catch (error) {
    console.warn('Load add data stock rows failed:', error);
    return null;
  }
}

function getAddDataStockCentersFromRows(rows) {
  return [...new Set((rows || [])
    .map((row) => (typeof normalizeCenterName === 'function' ? normalizeCenterName(row.center) : row.center))
    .filter(Boolean))];
}

function getAddDataStockQtyMapFromRows(rows) {
  const qtyMap = {};
  getPrPoStockLocations().forEach((center) => {
    qtyMap[center] = 0;
  });

  (rows || []).forEach((row) => {
    const center = typeof normalizeCenterName === 'function'
      ? normalizeCenterName(row.center)
      : row.center;
    if (!center) return;
    qtyMap[center] = Number(qtyMap[center] || 0) + (Number(row.qty) || 0);
  });

  return qtyMap;
}

function setAddDataStockQtyInputs(qtyMap = {}) {
  getPrPoStockLocations().forEach((center) => {
    const input = getAddDataCurrentStockQtyInput(center);
    if (!input) return;

    const qty = Number(qtyMap[center] || 0);
    input.value = Number.isFinite(qty) ? String(qty) : '0';
  });

  document.querySelectorAll('[data-add-data-stock-qty]').forEach((input) => {
    input.value = '';
  });
}

function getAddDataSelectedStockQtyMap() {
  const qtyMap = {};

  document.querySelectorAll('[data-add-data-stock-qty]').forEach((input) => {
    const center = input.dataset.addDataStockQty || '';
    const qtyText = input.value;
    const qty = qtyText === '' || qtyText === undefined || qtyText === null ? 0 : Number(qtyText);
    qtyMap[center] = qty;
  });

  return qtyMap;
}

function getAddDataSetStockQtyMap() {
  const qtyMap = {};

  document.querySelectorAll('[data-add-data-current-stock-qty]').forEach((input) => {
    const center = input.dataset.addDataCurrentStockQty || '';
    const qtyText = input.value;
    const qty = qtyText === '' || qtyText === undefined || qtyText === null ? 0 : Number(qtyText);
    qtyMap[center] = qty;
  });

  return qtyMap;
}

async function fetchAddDataProductVendorMeta(product) {
  if (!product || typeof supabaseClient === 'undefined') return null;

  try {
    const { data, error } = await supabaseClient
      .from('vendor_products')
      .select('unit, product_type, default_location, cost_qty, cost_unit_qty, cost_unit_price, cost_total_price, cost_unit, vendors(vendor_name, address_1, address_2, phone, email)')
      .eq('product', product)
      .eq('is_active', true)
      .limit(1);

    if (error) {
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;

    const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
    return {
      vendorName: vendor?.vendor_name || '',
      address1: vendor?.address_1 || '',
      address2: vendor?.address_2 || '',
      phone: vendor?.phone || '',
      email: vendor?.email || '',
      unit: row.unit || '',
      productType: row.product_type || '',
      costQty: row.cost_qty ?? '',
      costUnitQty: row.cost_unit_qty ?? '',
      costUnitPrice: row.cost_unit_price ?? '',
      costTotalPrice: row.cost_total_price ?? '',
      costUnit: row.cost_unit || '',
      locations: parseAddDataLocationList(row.default_location),
    };
  } catch (error) {
    console.warn('Load vendor product meta failed:', error);
    return null;
  }
}

function getAddDataProductType(product) {
  const selectedProduct = String(product || '').trim();
  if (!selectedProduct) return '';

  if (typeof getStockProductType === 'function') {
    const stockProductType = getStockProductType('', selectedProduct);
    if (stockProductType) return stockProductType;
  }

  return getPrProductTypeForProduct(selectedProduct);
}

async function handleAddDataProductSelection(product) {
  const selectedProduct = String(product || '').trim();
  if (!selectedProduct) return;

  const meta = await fetchAddDataProductVendorMeta(selectedProduct);
  const fallbackCompany = typeof getPrCompanyNameForProduct === 'function'
    ? getPrCompanyNameForProduct(selectedProduct)
    : '';
  const stockUnit = typeof getStockUnit === 'function' ? getStockUnit('', selectedProduct) : '';
  const productType = meta?.productType || getAddDataProductType(selectedProduct);
  const stockRows = await fetchAddDataStockRows(selectedProduct);
  const stockLocations = stockRows
    ? getAddDataStockCentersFromRows(stockRows)
    : getAddDataExistingStockCenters(selectedProduct);
  const stockQtyMap = stockRows
    ? getAddDataStockQtyMapFromRows(stockRows)
    : getAddDataStockQtyMap(selectedProduct);

  setAddDataFieldValue('add-data-vendor-name', meta?.vendorName || (fallbackCompany && fallbackCompany !== 'ทั่วไป' ? fallbackCompany : ''));
  setAddDataFieldValue('add-data-vendor-address-1', meta?.address1 || '');
  setAddDataFieldValue('add-data-vendor-address-2', meta?.address2 || '');
  setAddDataFieldValue('add-data-vendor-phone', meta?.phone || '');
  setAddDataFieldValue('add-data-vendor-email', meta?.email || '');
  setAddDataFieldValue('add-data-product-type', productType);
  setAddDataFieldValue('add-data-product-unit', meta?.unit || stockUnit);
  setAddDataFieldValue('add-data-cost-qty', meta?.costQty || '');
  setAddDataFieldValue('add-data-cost-unit-qty', meta?.costUnitQty || '');
  setAddDataFieldValue('add-data-cost-unit-price', meta?.costUnitPrice || '');
  setAddDataFieldValue('add-data-cost-total-price', meta?.costTotalPrice || '');
  if (meta?.costUnit && !document.getElementById('add-data-product-unit')?.value) {
    setAddDataFieldValue('add-data-product-unit', meta.costUnit);
  }

  setAddDataLocationChecks(stockLocations);
  setAddDataStockQtyInputs(stockQtyMap);
  refreshAddDataCostCalculation('total');
}

async function saveAddDataVendorProduct(button) {
  const vendorName = document.getElementById('add-data-vendor-name')?.value.trim() || 'ไม่ระบุบริษัท';
  const productInput = document.getElementById('add-data-product-name')?.value.trim() || '';
  const productSelect = document.getElementById('add-data-product-select')?.value.trim() || '';
  const product = productInput || productSelect;
  const productType = document.getElementById('add-data-product-type')?.value.trim() || '';
  const unitInput = document.getElementById('add-data-product-unit')?.value.trim() || '';
  const unit = unitInput || (typeof getStockUnit === 'function' ? getStockUnit('', product) : '');
  const costValues = getAddDataCostValues();
  const stockQtyMap = getAddDataSelectedStockQtyMap();
  const setStockQtyMap = getAddDataSetStockQtyMap();
  const locations = Array.from(document.querySelectorAll('[data-add-data-location]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
  const selectedStockQtyMap = locations.reduce((map, center) => ({
    ...map,
    [center]: stockQtyMap[center] || 0,
  }), {});
  const selectedSetStockQtyMap = locations.reduce((map, center) => ({
    ...map,
    [center]: setStockQtyMap[center] || 0,
  }), {});

  if (!product) {
    showToast('⚠️ กรุณากรอกหรือเลือกรายการสินค้า', 'error');
    return;
  }

  if (!locations.length) {
    showToast('⚠️ กรุณาเลือกสต็อกที่จะบันทึกสินค้า', 'error');
    return;
  }

  const invalidQtyCenter = Object.entries(selectedStockQtyMap)
    .find(([, qty]) => !Number.isFinite(Number(qty)) || Number(qty) < 0);
  if (invalidQtyCenter) {
    showToast(`⚠️ กรุณาระบุจำนวนของ ${invalidQtyCenter[0]} เป็นตัวเลข 0 หรือมากกว่า`, 'error');
    return;
  }

  const invalidSetQtyCenter = Object.entries(selectedSetStockQtyMap)
    .find(([, qty]) => !Number.isFinite(Number(qty)) || Number(qty) < 0);
  if (invalidSetQtyCenter) {
    showToast(`⚠️ กรุณาระบุสต็อกเดิมของ ${invalidSetQtyCenter[0]} เป็นตัวเลข 0 หรือมากกว่า`, 'error');
    return;
  }

  if ([costValues.qty, costValues.unitQty, costValues.unitPrice, costValues.totalPrice].some((value) => !Number.isFinite(value) || value < 0)) {
    showToast('⚠️ กรุณาระบุข้อมูล Cost เป็นตัวเลข 0 หรือมากกว่า', 'error');
    return;
  }

  if (button?.disabled) return;
  if (button) button.disabled = true;

  showToast('', 'loading', 'กำลังบันทึกข้อมูลบริษัทและสินค้า...');

  try {
    const saveParams = {
      p_vendor_name: vendorName,
      p_address_1: document.getElementById('add-data-vendor-address-1')?.value.trim() || '',
      p_address_2: document.getElementById('add-data-vendor-address-2')?.value.trim() || '',
      p_phone: document.getElementById('add-data-vendor-phone')?.value.trim() || '',
      p_email: document.getElementById('add-data-vendor-email')?.value.trim() || '',
      p_product: product,
      p_unit: unit,
      p_product_type: productType,
      p_default_location: locations.join(', '),
      p_locations: locations,
      p_qty: 0,
      p_stock_qtys: selectedStockQtyMap,
      p_set_stock_qtys: selectedSetStockQtyMap,
      p_cost_qty: costValues.qty,
      p_cost_unit_qty: costValues.unitQty,
      p_cost_unit_price: costValues.unitPrice,
      p_cost_total_price: costValues.totalPrice,
      p_cost_unit: unit,
    };

    let { data, error } = await supabaseClient.rpc('save_vendor_product', saveParams);

    if (error && typeof isRpcSignatureError === 'function' && isRpcSignatureError(error)) {
      const { p_product_type, ...paramsWithoutProductType } = saveParams;
      const fallback = await supabaseClient.rpc('save_vendor_product', paramsWithoutProductType);
      data = fallback.data;
      error = fallback.error;

      if (error && isRpcSignatureError(error)) {
        const { p_set_stock_qtys, ...legacyParams } = paramsWithoutProductType;
        const legacyFallback = await supabaseClient.rpc('save_vendor_product', legacyParams);
        data = legacyFallback.data;
        error = legacyFallback.error;
      }
    }

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึกข้อมูลไม่สำเร็จ');
    }

    showToast(`✅ ${data.message || 'บันทึกข้อมูลเรียบร้อย'}`, 'success');
    prVendorProductCompanyLoaded = false;
    prVendorProductCompanyMap = new Map();
    prProductTypeLoaded = false;
    prProductTypeMap = new Map();
    resetAddDataForm();
    const vendorSelect = document.getElementById('add-data-vendor-name');
    if (vendorSelect) {
      await loadAddDataVendorSelect(vendorSelect);
    }
    if (typeof fetchStock === 'function') {
      await fetchStock();
    }
  } catch (error) {
    console.error('save_vendor_product error:', error);
    showToast(`❌ ${error.message || 'บันทึกข้อมูลไม่สำเร็จ'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}


