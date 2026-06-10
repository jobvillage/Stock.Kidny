const PR_APPROVER_CODES = ['user1', 'user2'];
const PR_PO_MANAGER_CODES = ['user3', 'user4'];
const PR_APPROVER_BY_CODE = {
  user1: 'daeng',
  user2: 'toy',
};

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
let prOpenPoRows = [];
let prOpenPoSelectedPrId = '';
let prOpenPoSelectedCompany = '';
let prVendorProductCompanyMap = new Map();
let prVendorProductCompanyLoaded = false;

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
        <p>ตรวจสอบ PR ที่รออนุมัติและ PR ที่อนุมัติแล้ว แยกตามบริษัท</p>
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

    const { data, error } = await supabaseClient.rpc('get_pr_approval_status');

    if (error) {
      throw error;
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
      product: item.product || item.name || '',
      qty: Number(item.qty || item.quantity || 0),
      unit: item.unit || '',
    })).filter((item) => item.product),
    created_at: raw.created_at || '',
    updated_at: raw.updated_at || '',
  };
}

function isPrPendingRecord(record) {
  const status = String(record.status || '').toLowerCase();
  return isPrDocumentRecord(record)
    && status !== 'received'
    && status !== 'pr_approved'
    && status !== 'approved'
    && !isPrFullyApproved(record)
    && status !== 'cancelled';
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

function renderPrApprovalSection(title, status, variant, records = []) {
  const totalItems = records.reduce((sum, record) => sum + record.items.length, 0);

  return `
    <section class="pr-main-card pr-approval-section pr-approval-board" data-pr-section="${escapeHtml(variant)}" data-pr-status="${escapeHtml(variant)}">
      <div class="pr-approval-board-top">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>ทั้งหมด ${totalItems} รายการ แยกเป็นบริษัทดังนี้</p>
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
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(record.center || '-')}</strong></div>
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
    const companyName = getPrCompanyNameForProduct(item.product);
    if (!groups.has(companyName)) {
      groups.set(companyName, { name: companyName, items: [] });
    }
    groups.get(companyName).items.push(item);
  });

  return Array.from(groups.values());
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
        <div><span>สถานะ</span><strong>${variant === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</strong></div>
      </div>

      <div class="pr-document-company">🟢 บริษัท ${escapeHtml(company.name)}</div>

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
  const approvedRecords = prApprovalRecords.filter(isPrApprovedRecord);

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">✅</span>
      <div>
        <h2>PR ที่อนุมัติ</h2>
        <p>รายการ PR ที่ผ่านการอนุมัติและพร้อมนำไปเปิด PO</p>
      </div>
    </div>

    <div class="pr-card-list">
      ${approvedRecords.length
        ? approvedRecords.map((record) => renderApprovedPrStatusCard(record)).join('')
        : '<div class="empty-state">ยังไม่มี PR ที่อนุมัติครบ 2 คน</div>'
      }
    </div>
  `;
}

function renderApprovedPrStatusCard(record) {
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
          <span class="pr-status-pill is-approved">อนุมัติแล้ว</span>
          <button type="button" data-pr-print-approved="${escapeHtml(record.po_id || '')}">พิมพ์</button>
        </div>
      </div>
      <div class="pr-request-meta">
        <div><span>วันที่เปิด PR</span><strong>${escapeHtml(record.po_date || '-')}</strong></div>
        <div><span>ผู้เปิด PR</span><strong>${escapeHtml(record.po_person || '-')}</strong></div>
        <div><span>ศูนย์รับเข้า</span><strong>${escapeHtml(record.center || '-')}</strong></div>
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
  const selectedRecord = getSelectedApprovedPrForPo(approvedRecords);
  ensurePrOpenPoRowsFromSelectedRecord(selectedRecord);
  const centerOptions = getPrPoStockLocations().map((center) => `
    <option value="${escapeHtml(center)}"${center === selectedRecord?.center ? ' selected' : ''}>
      ${escapeHtml(center)}
    </option>
  `).join('');
  const prOptions = approvedRecords.map((record) => `
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
            <option value="">— เลือก PR ที่อนุมัติแล้ว —</option>
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
          <small>${selectedRecord ? 'ระบบดึงรายการจาก PR ที่เลือกมาให้แล้ว กรอกจำนวนหน่วยและราคารวม' : 'เลือก PR ที่อนุมัติแล้วก่อนเพิ่มรายการสินค้า'}</small>
        </div>
        <button class="btn-add-row transfer" type="button" data-add-pr-po-row ${selectedRecord ? '' : 'disabled'}>+ เพิ่มรายการ</button>
      </div>
      <div class="pr-price-head">
        <span>รายการสินค้า</span>
        <span>จำนวน</span>
        <span>จำนวนหน่วย</span>
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
      <button class="btn-submit btn-submit-transfer" type="button" data-save-pr-po ${selectedRecord && prOpenPoRows.length ? '' : 'disabled'}>
        <span>📝</span>
        <span>บันทึก PO</span>
      </button>
    </section>
  `;

  bindPrOpenPoPanel(panel);
}

function getSelectedApprovedPrForPo(approvedRecords = prApprovalRecords.filter(isPrApprovedRecord)) {
  if (!approvedRecords.length) {
    prOpenPoSelectedPrId = '';
    prOpenPoRows = [];
    return null;
  }

  if (!prOpenPoSelectedPrId || !approvedRecords.some((record) => record.po_id === prOpenPoSelectedPrId)) {
    prOpenPoSelectedPrId = approvedRecords[0].po_id;
  }

  return approvedRecords.find((record) => record.po_id === prOpenPoSelectedPrId) || null;
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
      qty: String(Number(item.qty || 0) || ''),
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

function bindPrOpenPoPanel(panel) {
  panel.querySelector('[data-pr-open-po-ref]')?.addEventListener('change', (event) => {
    prOpenPoSelectedPrId = event.target.value;
    prOpenPoSelectedCompany = '';
    prOpenPoRows = [];
    renderOpenPoPanel();
  });

  panel.querySelector('[data-add-pr-po-row]')?.addEventListener('click', addPrOpenPoRow);

  panel.querySelector('[data-pr-po-items]')?.addEventListener('change', handlePrOpenPoRowChange);
  panel.querySelector('[data-pr-po-items]')?.addEventListener('input', handlePrOpenPoRowChange);

  panel.querySelectorAll('[data-remove-pr-po-row]').forEach((button) => {
    button.addEventListener('click', () => {
      prOpenPoRows = prOpenPoRows.filter((row) => row.id !== button.dataset.removePrPoRow);
      renderOpenPoPanel();
    });
  });

  panel.querySelector('[data-save-pr-po]')?.addEventListener('click', savePrOpenPoDraft);
}

function addPrOpenPoRow() {
  const approvedRecord = getSelectedApprovedPrForPo();
  if (!approvedRecord) {
    showToast('⚠️ กรุณาเลือก PR ที่อนุมัติแล้วก่อน', 'error');
    return;
  }

  prOpenPoRows.push({
    id: `po-row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    itemIndex: '',
    qty: '',
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
    row.itemIndex = event.target.value;
    const record = getSelectedApprovedPrForPo();
    const item = record?.items?.[Number(row.itemIndex)];
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

function renderPrOpenPoRow(row, record) {
  const companyFilter = prOpenPoSelectedCompany || '';
  const options = record.items
    .map((item, index) => ({ item, index, company: getPrCompanyNameForProduct(item.product) }))
    .filter((entry) => !companyFilter || entry.company === companyFilter)
    .map(({ item, index, company }) => `
      <option value="${index}"${String(index) === String(row.itemIndex) ? ' selected' : ''}>
        ${escapeHtml(item.product || '-')} (${escapeHtml(company)})
      </option>
    `).join('');

  const unitPrice = getPrOpenPoUnitPrice(row);
  const selectedItem = record.items?.[Number(row.itemIndex)] || null;
  const unit = getPrOpenPoItemUnit(selectedItem, record);

  return `
    <div class="pr-price-row pr-open-po-row" data-pr-po-row="${escapeHtml(row.id)}">
      <select data-pr-po-product>
        <option value="">— เลือกรายการสินค้า —</option>
        ${options}
      </select>
      <div class="qty-input-with-unit">
        <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(row.qty)}" data-pr-po-qty />
        <span>${escapeHtml(unit || 'หน่วย')}</span>
      </div>
      <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(row.unitQty || '')}" data-pr-po-unit-qty />
      <span class="pr-unit-price">${unitPrice ? formatPrCurrency(unitPrice) : '0.00'}</span>
      <input type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(row.total)}" data-pr-po-line-total />
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

  if (typeof getStockUnit !== 'function') return '';

  const product = item.product || item.name || '';
  const selectedCenter = document.getElementById('pr-po-center')?.value || record?.center || '';
  return getStockUnit(selectedCenter, product);
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
    row.itemIndex !== ''
    && Number(row.qty) > 0
    && Number(row.unitQty) > 0
    && Number(row.total) > 0
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
    showToast('⚠️ กรุณาเลือกรายการสินค้า พร้อมระบุจำนวน จำนวนหน่วย และราคารวม', 'error');
    return;
  }

  const items = validRows.map((row) => {
    const sourceItem = record.items[Number(row.itemIndex)] || {};
    const qty = Number(row.qty) || 0;
    const unitQty = Number(row.unitQty) || 0;
    const totalPrice = Number(row.total) || 0;
    const unitPrice = unitQty > 0 ? totalPrice / unitQty : 0;
    const unit = getPrOpenPoItemUnit(sourceItem, record);

    return {
      product: sourceItem.product || '',
      qty,
      unit,
      unit_qty: unitQty,
      unitQty,
      unit_price: unitPrice,
      unitPrice,
      total_price: totalPrice,
      totalPrice,
      pr_id: record.po_id,
      prId: record.po_id,
      pr_line_index: Number(row.itemIndex),
      prLineIndex: Number(row.itemIndex),
      company: getPrCompanyNameForProduct(sourceItem.product),
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

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const createPoParams = {
        p_client_request_id: typeof newSupabaseDocumentId === 'function'
          ? await newSupabaseDocumentId('PO')
          : newRequestId('po'),
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
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึก PO ไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      throw new Error('เลข PO ซ้ำกับรายการเดิม กรุณากดบันทึกใหม่อีกครั้ง');
    }

    showToast(`✅ บันทึก PO สำเร็จ: ${data.po_id || ''}`, 'success');
    prOpenPoRows = [];
    renderOpenPoPanel();

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
              <input id="add-data-vendor-name" type="text" placeholder="กรอกชื่อบริษัท" />
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
  input.value = value === undefined || value === null ? '' : String(value).trim();
}

function resetAddDataForm() {
  [
    'add-data-vendor-name',
    'add-data-vendor-address-1',
    'add-data-vendor-address-2',
    'add-data-vendor-phone',
    'add-data-vendor-email',
    'add-data-product-name',
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
      .select('unit, default_location, cost_qty, cost_unit_qty, cost_unit_price, cost_total_price, cost_unit, vendors(vendor_name, address_1, address_2, phone, email)')
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

async function handleAddDataProductSelection(product) {
  const selectedProduct = String(product || '').trim();
  if (!selectedProduct) return;

  const meta = await fetchAddDataProductVendorMeta(selectedProduct);
  const fallbackCompany = typeof getPrCompanyNameForProduct === 'function'
    ? getPrCompanyNameForProduct(selectedProduct)
    : '';
  const stockUnit = typeof getStockUnit === 'function' ? getStockUnit('', selectedProduct) : '';
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
      const { p_set_stock_qtys, ...fallbackParams } = saveParams;
      const fallback = await supabaseClient.rpc('save_vendor_product', fallbackParams);
      data = fallback.data;
      error = fallback.error;
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
    resetAddDataForm();
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

function renderExportDataPanel() {
  const panel = ensurePrPanel('pr_export_data', 'panel-pr-export-data');
  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">📤</span>
      <div>
        <h2>Export Data</h2>
        <p>เลือกข้อมูลจาก Supabase เพื่อเตรียม Export เป็น CSV</p>
      </div>
    </div>

    <section class="pr-main-card">
      <div class="pr-card-head">
        <div>
          <h3>เลือก Table ที่ต้องการ Export</h3>
          <p>ยังเป็นโครงหน้า ยังไม่เชื่อมการดาวน์โหลดจริง</p>
        </div>
        <button class="btn-submit btn-submit-transfer" type="button">Export CSV</button>
      </div>
      <div class="pr-export-grid">
        <label><input type="checkbox" /> เลือกทั้งหมด</label>
        <label><input type="checkbox" checked /> po_cmo_requests</label>
        <label><input type="checkbox" checked /> stock_items</label>
        <label><input type="checkbox" checked /> stock_requests</label>
        <label><input type="checkbox" checked /> transactions</label>
      </div>
    </section>
  `;
}
