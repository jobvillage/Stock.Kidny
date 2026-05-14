// =====================
// CONFIG
// =====================

const STAFF_CENTERS = ['ไตบน', 'ไตล่าง', 'ไตดี'];

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

const formRequestIds = {
  in: newRequestId('in'),
  out: newRequestId('out'),
  transfer: newRequestId('transfer'),
};

document.addEventListener('DOMContentLoaded', () => {
  loadProductsFromSupabase()
    .then(() => {
      setToday('in-date');
      setToday('out-date');
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

function bindStaticEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
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

  document.getElementById('btn-refresh-hub-stock')?.addEventListener('click', () => {
    fetchStock();
    renderHubStockDashboard();
  });

  document.getElementById('toggle-password')?.addEventListener('click', togglePasswordVisibility);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-refresh-transfers')?.addEventListener('click', fetchPendingTransfers);
  document.getElementById('in-center')?.addEventListener('change', refreshInBadges);
  document.getElementById('out-center')?.addEventListener('change', refreshOutInfo);
  document.getElementById('transfer-from-center')?.addEventListener('change', refreshTransferInfo);
  document.getElementById('transfer-to-center')?.addEventListener('change', filterTransferTargetCenters);
  document.getElementById('hub-product-filter')?.addEventListener('change', renderHubStockDashboard);
  document.getElementById('btn-refresh-po-status')?.addEventListener('click', fetchPoStatus);
  document.getElementById('btn-refresh-request-status')?.addEventListener('click', fetchRequestStatus);
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