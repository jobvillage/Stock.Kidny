let localStock = {};
let pendingTransfers = [];
let stockViewTransfers = [];

const DB_STOCK_CACHE_KEY = 'stock_cache_v1';

function saveStockCache() {
  try {
    localStorage.setItem(DB_STOCK_CACHE_KEY, JSON.stringify({
      stock: localStock,
      savedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('Save stock cache failed:', error);
  }
}

function loadStockCache() {
  try {
    const cached = localStorage.getItem(DB_STOCK_CACHE_KEY);
    if (!cached) return false;

    const data = JSON.parse(cached);
    if (!data.stock) return false;

    localStock = data.stock;

    refreshInBadges();
    refreshOutInfo();
    refreshTransferInfo();

    setSyncStatus('โหลดข้อมูลจากเครื่องแล้ว กำลังซิงก์...', 'loading');
    return true;
  } catch (error) {
    console.warn('Load stock cache failed:', error);
    return false;
  }
}

// =====================
// FETCH STOCK / TRANSFER
// =====================
async function fetchStock() {
  setSyncStatus('กำลังโหลดสต็อก', 'loading');

  try {
    const { data, error } = await supabaseClient.rpc('get_stock_items');

    if (error) {
      throw error;
    }

    // reset localStock ก่อนเติมข้อมูลใหม่จาก Supabase
    localStock = {};

    (data || []).forEach((item) => {
      const center = item.center;
      const product = item.product;

      if (!localStock[center]) {
        localStock[center] = {};
      }

      localStock[center][product] = Number(item.qty) || 0;
    });

    refreshInBadges();
    refreshOutInfo();
    refreshTransferInfo();
    renderStockDashboard();
    fetchPendingPoSummary();
    renderHubStockDashboard();

    setSyncStatus('โหลดสต็อกแล้ว', 'ready');

  } catch (error) {
    console.error('Supabase stock error:', error);

    const box = document.getElementById('stock-dashboard-grid');
    if (box) {
      box.innerHTML = `<div class="empty-state error-state">${error.message || 'โหลดข้อมูลสต็อกไม่สำเร็จ'}</div>`;
    }

    setSyncStatus('โหลดสต็อกไม่สำเร็จ', 'error');
  }
}

async function fetchPendingTransfers() {
  if (!currentUser || !canAccessTab('pending')) return;

  const box = document.getElementById('pending-transfers');
  if (box) box.innerHTML = '<div class="empty-state">กำลังโหลดรายการขอเบิก...</div>';

  try {
    const { data, error } = await supabaseClient.rpc('get_pending_stock_requests');

    if (error) {
      throw error;
    }

    pendingTransfers = (data || []).map((item) => ({
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

    renderPendingTransfers();

  } catch (error) {
    console.error('Supabase pending stock requests error:', error);
    pendingTransfers = [];
    renderPendingTransfers(error.message || 'โหลดรายการรอจัดของไม่สำเร็จ');
  }
}

function setSyncStatus(text, state = 'loading') {
  const el = document.getElementById('sync-status');
  if (!el) return;

  el.textContent = text;
  el.classList.toggle('is-ready', state === 'ready');
  el.classList.toggle('is-error', state === 'error');
}

async function submitStockOutSupabase() {
  if (!requirePermission('out')) return;

  const btn = document.getElementById('btn-out') || document.querySelector('[data-submit="out"]');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('out-date').value;
  const center = document.getElementById('out-center').value;
  const note = document.getElementById('out-note').value.trim();
  const requestId = formRequestIds.out;

  if (!date || !center) {
    showToast('⚠️ กรุณากรอกวันที่และศูนย์ที่เบิก', 'error');
    return;
  }

  if (!enforceOwnCenter('out', center)) return;

  const rows = document.querySelectorAll('#out-products .product-row');
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้าเบิกออก', 'error');
    return;
  }

  btn.disabled = true;

  // Staff: สร้างใบเบิกส่งให้ Admin จัดของก่อน ยังไม่ตัด Stock
  if (currentUser.role === 'center_staff') {
    showToast('', 'loading', 'กำลังส่งใบเบิกไปยัง Admin...');

    try {
      const { data, error } = await supabaseClient.rpc('create_stock_request', {
        p_request_id: requestId,
        p_staff_code: currentUser.code,
        p_staff_name: currentUser.name,
        p_date: date,
        p_center: center,
        p_note: note,
        p_items: items,
      });

      if (error) {
        throw error;
      }

      if (!data || data.success !== true) {
        throw new Error(data?.message || 'สร้างใบเบิกไม่สำเร็จ');
      }

      if (data.duplicate === true) {
        showToast('⚠️ ใบเบิกนี้ถูกบันทึกไปแล้ว ไม่บันทึกซ้ำ', 'error');
        return;
      }

      showToast('✅ ส่งใบเบิกให้ Admin แล้ว รอจัดของ', 'success');

      formRequestIds.out = newRequestId('out');
      resetForm('out');

    } catch (error) {
      console.error('Supabase create_stock_request error:', error);
      showToast(`❌ ${error.message || 'สร้างใบเบิกไม่สำเร็จ'}`, 'error');
    } finally {
      btn.disabled = false;
    }

    return;
  }

  // Admin หรือ role อื่นที่มีสิทธิ์: เบิกออกและตัด Stock ทันทีเหมือนเดิม
  const stockCheck = validateStockEnough(center, items);
  if (!stockCheck.ok) {
    showToast(stockCheck.message, 'error');
    btn.disabled = false;
    return;
  }

  showToast('', 'loading', 'กำลังบันทึกเบิกออก...');

  try {
    const { data, error } = await supabaseClient.rpc('stock_out', {
      p_request_id: requestId,
      p_staff_code: currentUser.code,
      p_date: date,
      p_center: center,
      p_note: note,
      p_items: items,
    });

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'บันทึกเบิกออกไม่สำเร็จ');
    }

    if (data.duplicate === true) {
      showToast('⚠️ รายการนี้ถูกบันทึกไปแล้ว ไม่บันทึกซ้ำ', 'error');
      return;
    }

    updateLocalStock('out', center, items);

    showToast('✅ บันทึกเบิกออกสำเร็จ', 'success');

    formRequestIds.out = newRequestId('out');
    resetForm('out');

  } catch (error) {
    console.error('Supabase stock_out error:', error);
    showToast(`❌ ${error.message || 'บันทึกเบิกออกไม่สำเร็จ'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function fetchPendingPoSummary() {
  try {
    const { data, error } = await supabaseClient.rpc('get_pending_po_summary');

    if (error) {
      throw error;
    }

    pendingPoSummary = {};

    (data || []).forEach((item) => {
      pendingPoSummary[item.product] = Number(item.qty) || 0;
    });

    renderStockDashboard();

  } catch (error) {
    console.error('Pending PO summary error:', error);
  }
}