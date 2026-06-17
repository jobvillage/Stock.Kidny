// =====================
// CONFIG
// =====================
let autoRefreshTimer = null;
const STAFF_CENTERS = ['ไตบน', 'ไตล่าง', 'ไตดี'];
let withdrawSummaryRows = [];
let withdrawSummaryPrintMeta = {
  date: '',
  center: '',
  product: '',
};

function refreshProductSelects() {
  document.querySelectorAll('.product-select').forEach((select) => {
    const oldValue = select.value;

    select.innerHTML = PRODUCTS.map((product) => `
      <option value="${escapeHtml(product)}">${escapeHtml(product)}</option>
    `).join('');

    if (oldValue) {
      select.value = oldValue;
    }

    enhanceProductSelect(select);
  });
}

function refreshStockProductFilter() {
  const select = document.getElementById('stock-product-filter');
  if (!select) return;

  const oldValue = select.value;
  if (select.tomselect) {
    select.tomselect.destroy();
  }

  const products = [...new Set(PRODUCTS || [])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'th'));

  select.innerHTML = `
    <option value=""></option>
    ${products.map((product) => `
      <option value="${escapeHtml(product)}">${escapeHtml(product)}</option>
    `).join('')}
  `;

  if (oldValue && products.includes(oldValue)) {
    select.value = oldValue;
  } else {
    select.value = '';
  }

  enhanceStockProductFilter(select);
}

function enhanceStockProductFilter(select) {
  if (!select || select.tomselect || typeof TomSelect === 'undefined') return;

  if (typeof shouldUseNativeSelectOnAndroid === 'function' && shouldUseNativeSelectOnAndroid()) {
    select.classList.add('native-android-select');
    return;
  }

  const ts = new TomSelect(select, {
    create: false,
    allowEmptyOption: true,
    plugins: ['clear_button'],
    maxOptions: 80,
    dropdownParent: 'body',
    placeholder: 'พิมพ์หรือเลือกสินค้า',
    openOnFocus: true,
    onFocus: function () {
      this.open();
    },
    onDropdownOpen: function () {
      if (typeof positionTomSelectDropdown === 'function') {
        positionTomSelectDropdown(this);
      }
    },
  });

  if (!select.value) {
    ts.clear(true);
  }

  ts.wrapper.classList.add('stock-product-filter-select');
  ts.control_input.setAttribute('placeholder', 'พิมพ์หรือเลือกสินค้า');
}

const formRequestIds = {
  in: newRequestId('in'),
  out: newRequestId('out'),
  transfer: newRequestId('transfer'),
};

document.addEventListener('DOMContentLoaded', () => {
  loadProductsFromSupabase()
    .then(() => {
      refreshProductSelects();
      refreshStockProductFilter();

      setToday('in-date');
      setToday('out-date');
      setToday('withdraw-summary-date');
      setToday('transfer-date');

      addProductRow('in');
      addProductRow('out');
      addProductRow('transfer');

      bindStaticEvents();
      restoreSession();
    })
    .catch((error) => {
      console.error('เริ่มระบบไม่สำเร็จ:', error);
      showToast('❌ โหลดรายการสินค้าไม่สำเร็จ', 'error');
    });
});

function showTab(tab) {
  let activeSegment = null;

  document.querySelectorAll('.segment').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isActive);
    if (isActive) activeSegment = btn;
  });

  activeSegment?.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'center',
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    const isTarget = panel.dataset.panel === tab;
    panel.classList.toggle('is-active', isTarget);
    panel.hidden = !isTarget;
  });

  const label = document.getElementById('active-mode-label');
  if (label && typeof modeLabels !== 'undefined') {
    label.textContent = modeLabels[tab] || '';
  }

  if (tab === 'request_status') {
    if (typeof markStaffRequestStatusSeen === 'function') {
      markStaffRequestStatusSeen();
    }

    // ใช้ตัวเดียวพอ ห้ามเรียก fetchRequestStatuses ซ้ำ
    if (typeof fetchRequestStatus === 'function') {
      fetchRequestStatus();
    }
  }

  if (tab === 'pending') {
    if (typeof markAdminPendingSeen === 'function') {
      markAdminPendingSeen();
    }

    if (typeof fetchPendingTransfers === 'function') {
      fetchPendingTransfers();
    }
  }

  if (tab === 'po_status') {
    if (typeof fetchPoStatus === 'function') {
      fetchPoStatus();
    }
  }

  if (tab === 'withdraw_summary') {
    renderWithdrawSummaryScaffold();
  }

  if (tab === 'stock') {
    if (typeof fetchStockViewTransfers === 'function') {
      fetchStockViewTransfers();
    }

    if (typeof renderStockDashboard === 'function') {
      renderStockDashboard();
    }
  }

}

function bindStaticEvents() {
  document.querySelectorAll('.segment').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;

      showTab(tab);
    });
  });

  document.querySelectorAll('[data-add-row]').forEach((button) => {
    button.addEventListener('click', () => addProductRow(button.dataset.addRow));
  });

  document.querySelectorAll('[data-submit]').forEach((button) => {
    button.addEventListener('click', () => submitByType(button.dataset.submit));
  });

  document.getElementById('btn-login')?.addEventListener('click', login);

  document.getElementById('login-code')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('login-password')?.focus();
  });

  document.getElementById('login-password')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login();
  });

  document.getElementById('stock-center-filter')?.addEventListener('change', () => {
    renderStockDashboard();
    fetchStockViewTransfers();
  });

  document.getElementById('stock-product-filter')?.addEventListener('change', () => {
    renderStockDashboard();
  });

  document.getElementById('stock-product-type-filter')?.addEventListener('change', () => {
    renderStockDashboard();
  });

  document.getElementById('btn-refresh-hub-stock')?.addEventListener('click', async () => {
    if (typeof fetchFreshStock === 'function') {
      await fetchFreshStock();
    } else {
      await fetchStock();
    }
    renderHubStockDashboard();
  });

  document.getElementById('toggle-password')?.addEventListener('click', togglePasswordVisibility);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-refresh-transfers')?.addEventListener('click', fetchPendingTransfers);
  document.getElementById('in-center')?.addEventListener('change', refreshInBadges);
  document.getElementById('out-center')?.addEventListener('change', refreshOutInfo);
  document.getElementById('btn-withdraw-summary-refresh')?.addEventListener('click', renderWithdrawSummaryScaffold);
  document.getElementById('withdraw-summary-date')?.addEventListener('change', renderWithdrawSummaryScaffold);
  document.getElementById('withdraw-summary-center')?.addEventListener('change', renderWithdrawSummaryScaffold);
  document.getElementById('withdraw-summary-product')?.addEventListener('change', renderWithdrawSummaryScaffold);
  document.getElementById('btn-withdraw-summary-print')?.addEventListener('click', printWithdrawSummary);
  initWithdrawSummaryProductFilter();
  if (typeof initStaffOutTransactionHistory === 'function') {
    initStaffOutTransactionHistory();
  }
  document.getElementById('transfer-from-center')?.addEventListener('change', refreshTransferInfo);
  document.getElementById('transfer-to-center')?.addEventListener('change', filterTransferTargetCenters);
  document.getElementById('hub-product-filter')?.addEventListener('change', renderHubStockDashboard);
  document.getElementById('btn-refresh-po-status')?.addEventListener('click', fetchPoStatus);
  document.querySelectorAll('.po-status-filter').forEach((button) => {
    button.addEventListener('click', () => setPoStatusFilter(button.dataset.poStatusFilter));
  });
  document.getElementById('btn-refresh-request-status')?.addEventListener('click', fetchRequestStatus);
  document.getElementById('btn-fetch-staff-request-history')?.addEventListener('click', fetchStaffRequestHistory);
  document.getElementById('staff-request-history-status')?.addEventListener('change', fetchStaffRequestHistory);
  document.getElementById('staff-request-history-center')?.addEventListener('change', fetchStaffRequestHistory);
  document.getElementById('staff-request-history-id')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && typeof fetchStaffRequestHistory === 'function') {
      fetchStaffRequestHistory();
    }
  });
  document.getElementById('btn-fetch-request-history')?.addEventListener('click', fetchAdminRequestHistory);
  document.getElementById('request-history-status')?.addEventListener('change', fetchAdminRequestHistory);
  document.getElementById('request-history-center')?.addEventListener('change', fetchAdminRequestHistory);
  document.getElementById('request-history-id')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && typeof fetchAdminRequestHistory === 'function') {
      fetchAdminRequestHistory();
    }
  });
  document.getElementById('btn-refresh-stock-view')?.addEventListener('click', refreshStockViewOnly);
  document.getElementById('btn-auto-po-stock-view')?.addEventListener('click', openAutoPoFromStock);
  document.getElementById('btn-print-stock-view')?.addEventListener('click', printStockView);
}

function cleanWithdrawSummaryText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWithdrawSummaryItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const product = cleanWithdrawSummaryText(item.product || item.Product || item.name || '');
      const qty = Number(item.qty ?? item.quantity ?? item.Qty ?? 0) || 0;
      const unit = cleanWithdrawSummaryText(item.unit || item.Unit || item.uom || '');
      const sourceCenter = cleanWithdrawSummaryText(
        item.source_center
        || item.sourceCenter
        || item.stock_center
        || item.stockCenter
        || item.center
        || ''
      );

      return { product, qty, unit, sourceCenter };
    })
    .filter((item) => item.product && item.qty > 0);
}

function isWithdrawSummaryCompletedRequest(request = {}) {
  const status = String(request.status || '').toLowerCase();
  return status === 'completed'
    || status === 'success'
    || status === 'picked'
    || Boolean(request.picked_at);
}

function getWithdrawSummaryRequestItems(request = {}) {
  const preparedItems = normalizeWithdrawSummaryItems(request.prepared_items);
  if (isWithdrawSummaryCompletedRequest(request) && preparedItems.length) {
    return preparedItems;
  }

  return normalizeWithdrawSummaryItems(request.items);
}

function getWithdrawSummaryDateRange(dateText) {
  const date = dateText || new Date().toISOString().split('T')[0];
  return {
    date,
    start: new Date(`${date}T00:00:00+07:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999+07:00`).toISOString(),
  };
}

function formatWithdrawSummaryDate(dateText) {
  if (!dateText) return '-';
  const [yyyy, mm, dd] = String(dateText).split('-');
  if (!yyyy || !mm || !dd) return dateText;
  return `${dd}/${mm}/${yyyy}`;
}

function initWithdrawSummaryProductFilter() {
  const select = document.getElementById('withdraw-summary-product');
  if (!select) return;

  const oldValue = select.value;
  if (select.tomselect) {
    select.tomselect.destroy();
  }

  const options = typeof getProductOptions === 'function'
    ? getProductOptions()
    : (PRODUCTS || []).map((product) => `<option value="${escapeHtml(product)}">${escapeHtml(product)}</option>`).join('');

  select.innerHTML = `
    <option value="">ทุกสินค้า</option>
    ${options}
  `;
  if (oldValue) select.value = oldValue;

  if (typeof enhanceStockProductFilter === 'function') {
    enhanceStockProductFilter(select);
  } else if (typeof enhanceProductSelect === 'function') {
    enhanceProductSelect(select);
  }
}

function getWithdrawSummaryUnit(center, product, fallback = '') {
  if (fallback) return fallback;
  if (typeof getStockUnit === 'function') {
    return getStockUnit(center, product) || '';
  }
  return '';
}

function findWithdrawSummaryTransaction(card, transactions) {
  const cleanProduct = cleanWithdrawSummaryText(card.product);
  const cleanCenter = cleanWithdrawSummaryText(card.center);

  return (transactions || []).find((tx) => {
    const txProduct = cleanWithdrawSummaryText(tx.stock_balance_product || tx.product);
    const txCenter = cleanWithdrawSummaryText(tx.stock_balance_center || tx.source_center || tx.center);
    const action = String(tx.action || '').toUpperCase();

    return action === 'STOCK_OUT'
      && txProduct === cleanProduct
      && (!cleanCenter || txCenter === cleanCenter);
  }) || null;
}

function renderWithdrawSummaryRows(rows = []) {
  const list = document.getElementById('withdraw-summary-list');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">ไม่พบรายการเบิกตามตัวกรอง</div>';
    return;
  }

  list.innerHTML = `
    <div class="withdraw-summary-table-card">
      <div class="withdraw-summary-table-title">
        <div>
          <span>รายการเบิกแบบ Transaction</span>
          <strong>${rows.length.toLocaleString()} รายการ</strong>
        </div>
        <button class="btn-request-secondary withdraw-summary-card-print" type="button" onclick="printWithdrawSummary()">
          <span>ปริ้นท์</span>
          <strong>สรุป</strong>
        </button>
      </div>
      <div class="withdraw-summary-table-wrap">
        <div class="withdraw-summary-table">
          <div class="withdraw-summary-table-head">
            <span>ศูนย์</span>
            <span>รายการ</span>
            <span>จำนวน</span>
            <span>หน่วย</span>
            <span>คงเหลือล่าสุด</span>
            <span>รายละเอียด</span>
          </div>
          ${rows.map((row) => {
            const balanceText = row.balanceAfter === null || row.balanceAfter === undefined
              ? '-'
              : Number(row.balanceAfter || 0).toLocaleString();
            const detailRows = (row.details || []).map((detail) => {
              const isCompleted = detail.status === 'completed';
              const statusText = isCompleted ? 'ตัดสต็อกแล้ว' : 'ยังไม่ตัดสต็อก';
              const detailBalance = detail.balanceAfter === null || detail.balanceAfter === undefined
                ? '-'
                : Number(detail.balanceAfter || 0).toLocaleString();

              return `
                <span class="withdraw-summary-detail-token">
                  <strong>${escapeHtml(detail.requestId || '-')}</strong>
                  <em class="withdraw-status-pill ${isCompleted ? 'is-completed' : 'is-pending'}">${statusText}</em>
                  <span>${Number(detail.qty || 0).toLocaleString()} ${escapeHtml(detail.unit || row.unit || '')}</span>
                </span>
              `;
            }).join('');

            return `
              <details class="withdraw-summary-row-details">
                <summary class="withdraw-summary-table-row">
                <span data-label="ศูนย์">${escapeHtml(row.center || '-')}</span>
                <strong data-label="รายการ">${escapeHtml(row.product || '-')}</strong>
                <span data-label="จำนวน">${Number(row.qty || 0).toLocaleString()}</span>
                <span data-label="หน่วย">${escapeHtml(row.unit || '-')}</span>
                <span data-label="คงเหลือล่าสุด">${escapeHtml(balanceText)}</span>
                <span data-label="รายละเอียด">
                  <span class="withdraw-summary-dropdown-button">
                      <span class="withdraw-summary-arrow" aria-hidden="true">⌄</span>
                      <small>${(row.details || []).length.toLocaleString()}</small>
                  </span>
                </span>
                </summary>
                <div class="withdraw-summary-detail-strip">
                  ${detailRows || '<span class="withdraw-summary-dropdown-empty">ไม่มีรายละเอียด</span>'}
                </div>
              </details>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderWithdrawSummaryCards(cards = []) {
  renderWithdrawSummaryRows(cards);
}

function groupWithdrawSummaryRows(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const center = cleanWithdrawSummaryText(row.center);
    const product = cleanWithdrawSummaryText(row.product);
    const unit = cleanWithdrawSummaryText(row.unit);
    const key = `${center}||${product}||${unit}`;
    const existing = groups.get(key) || {
      date: row.date,
      center: row.center,
      product: row.product,
      qty: 0,
      unit: row.unit,
      status: 'completed',
      balanceAfter: null,
      balanceCreatedAt: '',
      details: [],
    };

    const rowCreatedAt = row.balanceCreatedAt || row.createdAt || '';
    existing.qty += Number(row.qty || 0);
    existing.status = existing.status === 'completed' && row.status === 'completed'
      ? 'completed'
      : 'pending';

    if (row.balanceAfter !== null && row.balanceAfter !== undefined) {
      if (!existing.balanceCreatedAt || String(rowCreatedAt) >= String(existing.balanceCreatedAt)) {
        existing.balanceAfter = row.balanceAfter;
        existing.balanceCreatedAt = rowCreatedAt;
      }
    }

    existing.details.push({
      requestId: row.requestId,
      qty: row.qty,
      unit: row.unit,
      status: row.status,
      balanceAfter: row.balanceAfter,
      createdAt: rowCreatedAt,
    });

    groups.set(key, existing);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    details: group.details.sort((a, b) => String(a.requestId || '').localeCompare(String(b.requestId || ''), 'th')),
  }));
}

function printWithdrawSummary() {
  if (!withdrawSummaryRows.length) {
    showToast('⚠️ ไม่มีรายการสำหรับพิมพ์สรุป', 'error');
    return;
  }

  const rowsHtml = withdrawSummaryRows.map((row, index) => {
    const balanceText = row.balanceAfter === null || row.balanceAfter === undefined
      ? '-'
      : Number(row.balanceAfter || 0).toLocaleString();
    const requestList = (row.details || [])
      .map((detail) => {
        const statusText = detail.status === 'completed' ? 'ตัดแล้ว' : 'ยังไม่ตัด';
        return `${detail.requestId || '-'} (${statusText})`;
      })
      .join(', ');

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.center || '-')}</td>
        <td>${escapeHtml(row.product || '-')}</td>
        <td>${Number(row.qty || 0).toLocaleString()}</td>
        <td>${escapeHtml(row.unit || '-')}</td>
        <td>${escapeHtml(balanceText)}</td>
        <td>${escapeHtml(requestList || '-')}</td>
      </tr>
    `;
  }).join('');

  const html = `
    <!doctype html>
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <title>สรุปยอดเบิก</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { font-family: Arial, "Tahoma", sans-serif; margin: 0; color: #172033; }
          h1 { margin: 0 0 4px; font-size: 18px; }
          .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0 10px; color: #475569; font-size: 11px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5px; }
          th, td { border: 1px solid #d7dee9; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #eef2f7; color: #475569; }
          th:nth-child(1), td:nth-child(1) { width: 28px; }
          th:nth-child(2), td:nth-child(2) { width: 54px; }
          th:nth-child(4), td:nth-child(4) { width: 44px; }
          th:nth-child(5), td:nth-child(5) { width: 44px; }
          th:nth-child(6), td:nth-child(6) { width: 54px; }
          th:nth-child(7), td:nth-child(7) { width: 135px; }
          td:nth-child(1), td:nth-child(4), td:nth-child(6) { text-align: center; }
          td { overflow-wrap: anywhere; }
        </style>
      </head>
      <body>
        <h1>สรุปยอดเบิก</h1>
        <div class="meta">
          <div>วันที่: ${escapeHtml(formatWithdrawSummaryDate(withdrawSummaryPrintMeta.date || ''))}</div>
          <div>ศูนย์: ${escapeHtml(withdrawSummaryPrintMeta.center || 'ทุกศูนย์')}</div>
          <div>สินค้า: ${escapeHtml(withdrawSummaryPrintMeta.product || 'ทุกสินค้า')}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>ลำดับ</th>
              <th>ศูนย์</th>
              <th>รายการ</th>
              <th>จำนวน</th>
              <th>หน่วย</th>
              <th>คงเหลือล่าสุด</th>
              <th>เลขใบเบิก / สถานะ</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;

  const oldFrame = document.getElementById('withdraw-summary-print-frame');
  if (oldFrame) oldFrame.remove();

  const printFrame = document.createElement('iframe');
  printFrame.id = 'withdraw-summary-print-frame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.opacity = '0';
  printFrame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(printFrame);

  const frameWindow = printFrame.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    printFrame.remove();
    showToast('⚠️ ไม่สามารถเปิดหน้าพิมพ์สรุปยอดเบิกได้', 'error');
    return;
  }

  const cleanupPrintFrame = () => {
    setTimeout(() => {
      printFrame.remove();
      window.focus();
      document.getElementById('withdraw-summary-center')?.focus();
    }, 250);
  };

  frameWindow.addEventListener('afterprint', cleanupPrintFrame, { once: true });
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 250);

  setTimeout(() => {
    if (document.body.contains(printFrame)) cleanupPrintFrame();
  }, 3000);
}

async function renderWithdrawSummaryScaffold() {
  const list = document.getElementById('withdraw-summary-list');
  if (!list || typeof supabaseClient === 'undefined') return;

  const selectedDate = document.getElementById('withdraw-summary-date')?.value || '';
  const selectedCenter = document.getElementById('withdraw-summary-center')?.value || '';
  const productFilter = cleanWithdrawSummaryText(document.getElementById('withdraw-summary-product')?.value || '');
  const centerFilter = currentUser?.role === 'center_staff'
    ? cleanWithdrawSummaryText(currentUser.center)
    : cleanWithdrawSummaryText(selectedCenter);
  const { date, start, end } = getWithdrawSummaryDateRange(selectedDate);

  list.innerHTML = '<div class="empty-state">กำลังโหลดสรุปยอดเบิก...</div>';

  try {
    let requestQuery = supabaseClient
      .from('stock_requests')
      .select('request_id, request_date, center, status, items, prepared_items, picked_at, created_at')
      .eq('request_date', date)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (centerFilter) {
      requestQuery = requestQuery.eq('center', centerFilter);
    }

    const { data: requests, error: requestError } = await requestQuery;
    if (requestError) throw requestError;

    let transactionQuery = supabaseClient
      .from('transactions')
      .select('request_id, action, center, source_center, product, qty, stock_balance_center, stock_balance_product, stock_balance_after, created_at')
      .eq('action', 'STOCK_OUT')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (centerFilter) {
      transactionQuery = transactionQuery.eq('center', centerFilter);
    }

    let { data: transactions, error: transactionError } = await transactionQuery;

    if (transactionError && /column|source_center|stock_balance/i.test(`${transactionError.message || ''} ${transactionError.details || ''}`)) {
      const fallback = await supabaseClient
        .from('transactions')
        .select('request_id, action, center, product, qty, created_at')
        .eq('action', 'STOCK_OUT')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(2000);

      transactions = fallback.data;
      transactionError = fallback.error;
    }

    if (transactionError) throw transactionError;

    let rows = [];

    (requests || []).forEach((request) => {
      const requestCenter = cleanWithdrawSummaryText(request.center);
      const completed = isWithdrawSummaryCompletedRequest(request);
      const items = getWithdrawSummaryRequestItems(request);

      items.forEach((item) => {
        const itemCenter = cleanWithdrawSummaryText(item.sourceCenter || requestCenter);
        if (centerFilter && itemCenter && itemCenter !== centerFilter && requestCenter !== centerFilter) return;

        const center = itemCenter || requestCenter || centerFilter || '';
        const row = {
          date: request.request_date || date,
          requestId: request.request_id,
          createdAt: request.created_at || '',
          center,
          product: item.product,
          qty: item.qty,
          unit: item.unit || getWithdrawSummaryUnit(center, item.product),
          status: completed ? 'completed' : 'pending',
          balanceAfter: null,
        };

        rows.push(row);
      });
    });

    rows = rows.map((row) => {
      const tx = findWithdrawSummaryTransaction(row, transactions || []);
      return {
        ...row,
        unit: row.unit || getWithdrawSummaryUnit(row.center, row.product),
        balanceAfter: tx?.stock_balance_after ?? null,
        balanceCreatedAt: tx?.created_at || row.createdAt || '',
        status: tx ? 'completed' : row.status,
      };
    });

    if (productFilter) {
      rows = rows.filter((row) => cleanWithdrawSummaryText(row.product) === productFilter);
    }

    rows = rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      const requestCompare = String(a.requestId || '').localeCompare(String(b.requestId || ''), 'th');
      if (requestCompare !== 0) return requestCompare;
      return a.product.localeCompare(b.product, 'th');
    });

    rows = groupWithdrawSummaryRows(rows).sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      const centerCompare = String(a.center || '').localeCompare(String(b.center || ''), 'th');
      if (centerCompare !== 0) return centerCompare;
      return String(a.product || '').localeCompare(String(b.product || ''), 'th');
    });

    withdrawSummaryRows = rows;
    withdrawSummaryPrintMeta = {
      date,
      center: centerFilter || '',
      product: productFilter || '',
    };
    renderWithdrawSummaryRows(rows);
  } catch (error) {
    console.error('renderWithdrawSummaryScaffold error:', error);
    withdrawSummaryRows = [];
    list.innerHTML = `<div class="empty-state error-state">❌ ${escapeHtml(error.message || 'โหลดสรุปยอดเบิกไม่สำเร็จ')}</div>`;
  }
}

document.addEventListener('keydown', (event) => {
  const input = event.target;

  if (!input.matches('input[type="number"]')) return;

  const blockedKeys = ['.', '-', '+', 'e', 'E'];

  if (blockedKeys.includes(event.key)) {
    event.preventDefault();
  }
});

document.addEventListener('input', (event) => {
  const input = event.target;

  if (!input.matches('input[type="number"]')) return;

  input.value = input.value.replace(/[^\d]/g, '');
});

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    console.log('หยุด Auto Refresh แล้ว');
  }
}

function startAutoRefreshForCurrentTab(tab) {
  stopAutoRefresh();

  // Staff: ใช้เฉพาะหน้าสถานะใบขอเบิก
  if (tab === 'request_status' && currentUser?.role === 'center_staff') {
    autoRefreshTimer = setInterval(async () => {
      if (typeof fetchRequestStatus === 'function') {
        await fetchRequestStatus();
      }
    }, 60000); // ทุก 60 วินาที

    console.log('เริ่ม Auto Refresh: สถานะใบขอเบิก');
    return;
  }

  // Admin/adminR: ใช้เฉพาะหน้ารายการขอเบิก
  if (tab === 'pending' && ['admin', 'adminR', 'stock_receiver'].includes(currentUser?.role)) {
    autoRefreshTimer = setInterval(async () => {
      if (typeof fetchPendingTransfers === 'function') {
        await fetchPendingTransfers();

        // ถ้าไม่มีรายการรอจัดของแล้ว ให้หยุด refresh
        if (Array.isArray(pendingTransfers) && pendingTransfers.length === 0) {
          stopAutoRefresh();
        }
      }
    }, 60000); // ทุก 60 วินาที

    console.log('เริ่ม Auto Refresh: รายการขอเบิก');
    return;
  }
}

let stockRequestChannel = null;

/* =====================
   COMMON BADGE HELPERS
===================== */

function getSeenIds(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeenIds(key, ids) {
  localStorage.setItem(key, JSON.stringify([...new Set(ids)]));
}

function setTabBadge(selector, count) {
  const tab = document.querySelector(selector);
  if (!tab) return;

  tab.querySelectorAll(
    '.auto-noti-badge, .badge, .tab-badge, .segment-badge, .nav-badge, .count-badge, [class*="badge"]'
  ).forEach((badge) => badge.remove());

  if (!count || count <= 0) return;

  const badge = document.createElement('span');
  badge.className = 'auto-noti-badge';
  badge.textContent = count;
  badge.style.display = 'inline-flex';

  tab.appendChild(badge);
}

/* =====================
   ADMIN NOTIFICATION
===================== */

async function getAdminPendingRequestIds() {
  const { data, error } = await supabaseClient.rpc('get_pending_stock_requests');

  if (error) {
    console.warn('getAdminPendingRequestIds error:', error);
    return [];
  }

  return (data || [])
    .map((item) => item.request_id || item.requestId)
    .filter(Boolean);
}

async function checkAdminPendingBadge() {
  if (!['admin', 'adminR', 'stock_receiver'].includes(currentUser?.role)) return;

  const key = `seen_pending_requests_${currentUser.role}`;
  const seen = getSeenIds(key);
  const ids = await getAdminPendingRequestIds();

  const unreadCount = ids.filter((id) => !seen.has(id)).length;

  console.log('ADMIN PENDING BADGE:', unreadCount, ids);

  setTabBadge('[data-tab="pending"]', unreadCount);
}

async function markAdminPendingSeen() {
  if (!['admin', 'adminR', 'stock_receiver'].includes(currentUser?.role)) return;

  const key = `seen_pending_requests_${currentUser.role}`;
  const ids = await getAdminPendingRequestIds();

  saveSeenIds(key, ids);
  setTabBadge('[data-tab="pending"]', 0);
}

/* =====================
   STAFF NOTIFICATION
===================== */

async function getStaffReadyRequestIds() {
  if (!currentUser?.code) return [];

  const { data, error } = await supabaseClient.rpc('get_staff_ready_request_ids', {
    p_staff_code: currentUser.code,
  });

  if (error) {
    console.warn('getStaffReadyRequestIds error:', error);
    return [];
  }

  return (data || [])
    .map((item) => item.request_id || item.requestId)
    .filter(Boolean);
}

async function checkStaffRequestStatusBadge() {
  if (currentUser?.role !== 'center_staff') return;

  const activePanel = document.querySelector('.panel.is-active')?.dataset.panel;

  if (activePanel === 'request_status') {
    await markStaffRequestStatusSeen();
    return;
  }

  const key = `seen_request_status_${currentUser.code}`;
  const seen = getSeenIds(key);
  const ids = await getStaffReadyRequestIds();

  const unreadCount = ids.filter((id) => !seen.has(id)).length;

  console.log('STAFF REQUEST STATUS BADGE:', unreadCount, ids);

  setTabBadge('[data-tab="request_status"]', unreadCount);
}

async function markStaffRequestStatusSeen() {
  if (currentUser?.role !== 'center_staff') return;

  const key = `seen_request_status_${currentUser.code}`;
  const ids = await getStaffReadyRequestIds();

  saveSeenIds(key, ids);

  setTabBadge('[data-tab="request_status"]', 0);

  const oldBadge = document.getElementById('request-status-badge');
  if (oldBadge) {
    oldBadge.hidden = true;
    oldBadge.textContent = '';
    oldBadge.style.display = 'none';
  }
}

/* =====================
   INITIAL CHECK
===================== */

async function checkRequestNotifications() {
  if (!currentUser) return;

  if (currentUser.role === 'center_staff') {
    await checkStaffRequestStatusBadge();
  }

  if (['admin', 'adminR', 'stock_receiver'].includes(currentUser.role)) {
    await checkAdminPendingBadge();
  }
}

/* =====================
   REALTIME
===================== */

function startRequestNotificationPolling() {
  stopRequestNotificationPolling();

  if (!currentUser) return;

  // เช็กครั้งแรกตอน login/restore session
  checkRequestNotifications();

  const role = currentUser.role;
  const staffCode = currentUser.code;

  stockRequestChannel = supabaseClient.channel(`stock_requests_realtime_${role}_${staffCode || 'admin'}`);

    stockRequestChannel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'stock_requests',
    },
    (payload) => {
      console.log('REALTIME DEBUG ALL STOCK_REQUESTS:', payload);
    }
  );
  
  // Admin/adminR: ฟังเฉพาะใบขอเบิกใหม่
  if (['admin', 'adminR', 'stock_receiver'].includes(role)) {
    stockRequestChannel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'stock_requests',
      },
      async (payload) => {
        const row = payload.new || {};

        console.log('REALTIME ADMIN INSERT:', row);

        // รับเฉพาะใบขอเบิกที่รอจัดของ
        if (row.status !== 'pending_pick') return;

        await checkAdminPendingBadge();

        const activePanel = document.querySelector('.panel.is-active')?.dataset.panel;

        if (activePanel === 'pending' && typeof fetchPendingTransfers === 'function') {
          fetchPendingTransfers();
        }
      }
    );
  }

  // Staff: ฟังเฉพาะใบของตัวเอง
  if (role === 'center_staff' && staffCode) {
    stockRequestChannel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'stock_requests',
      },
      async (payload) => {
        const row = payload.new || {};

        console.log('REALTIME STAFF UPDATE:', row);

        // รับเฉพาะใบของ staff คนนี้ และต้อง completed แล้ว
        if (row.staff_code !== staffCode) return;
        if (row.status !== 'completed') return;

        await checkStaffRequestStatusBadge();

        const activePanel = document.querySelector('.panel.is-active')?.dataset.panel;

        if (activePanel === 'request_status' && typeof fetchRequestStatus === 'function') {
          fetchRequestStatus();
        }
      }
    );
  }

  stockRequestChannel.subscribe((status) => {
    console.log('STOCK REQUEST REALTIME STATUS:', status);
  });
}

function stopRequestNotificationPolling() {
  if (stockRequestChannel) {
    supabaseClient.removeChannel(stockRequestChannel);
    stockRequestChannel = null;
    console.log('หยุด Stock Request Realtime แล้ว');
  }
}

window.startRequestNotificationPolling = startRequestNotificationPolling;
window.stopRequestNotificationPolling = stopRequestNotificationPolling;
