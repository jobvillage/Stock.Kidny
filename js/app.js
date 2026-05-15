// =====================
// CONFIG
// =====================
let autoRefreshTimer = null;
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

function refreshStockProductFilter() {
  const select = document.getElementById('stock-product-filter');
  if (!select) return;

  const oldValue = select.value;

  const products = [...new Set(PRODUCTS || [])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'th'));

  select.innerHTML = `
    <option value="">ทุกสินค้า</option>
    ${products.map((product) => `
      <option value="${escapeHtml(product)}">${escapeHtml(product)}</option>
    `).join('')}
  `;

  if (oldValue && products.includes(oldValue)) {
    select.value = oldValue;
  }
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
  document.querySelectorAll('.segment').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    const isTarget = panel.dataset.panel === tab;
    panel.classList.toggle('is-active', isTarget);
    panel.hidden = !isTarget;
  });

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

  if (tab === 'stock') {
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