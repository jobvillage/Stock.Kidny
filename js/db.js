let localStock = {};
let localStockUnits = {};
let localStockTypes = {};
let pendingTransfers = [];
let stockViewTransfers = [];

const DB_STOCK_CACHE_KEY = 'stock_cache_v1';
const DB_STOCK_CACHE_MAX_AGE_MS = 60 * 1000;

function clearStockCache() {
  try {
    localStorage.removeItem(DB_STOCK_CACHE_KEY);
  } catch (error) {
    console.warn('Clear stock cache failed:', error);
  }
}

function saveStockCache() {
  try {
    localStorage.setItem(DB_STOCK_CACHE_KEY, JSON.stringify({
      stock: localStock,
      units: localStockUnits,
      types: localStockTypes,
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

    const savedAt = data.savedAt ? new Date(data.savedAt).getTime() : 0;
    if (!savedAt || Date.now() - savedAt > DB_STOCK_CACHE_MAX_AGE_MS) {
      clearStockCache();
      return false;
    }

    localStock = data.stock;
    localStockUnits = data.units || {};
    localStockTypes = data.types || {};

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

async function fetchFreshStock() {
  clearStockCache();
  return fetchStock();
}

async function fetchStockUnitsFromTable() {
  const { data, error } = await supabaseClient
    .from('stock_items')
    .select('center, product, unit, product_type');

  if (error) {
    console.warn('Load stock units failed:', error);
    return;
  }

  (data || []).forEach((item) => {
    const center = typeof normalizeCenterName === 'function'
      ? normalizeCenterName(item.center)
      : item.center;

    if (typeof setStockUnit === 'function') {
      setStockUnit(center, item.product, item.unit);
    }

    if (typeof setStockProductType === 'function') {
      setStockProductType(center, item.product, item.product_type);
    }
  });
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
    localStockUnits = {};
    localStockTypes = {};
    stockMinMaxFromSupabase = {};

    (data || []).forEach((item) => {
      const center = typeof normalizeCenterName === 'function'
        ? normalizeCenterName(item.center)
        : item.center;
      const product = item.product;

      if (!localStock[center]) {
        localStock[center] = {};
      }

      localStock[center][product] = Number(item.qty) || 0;

      if (typeof setStockUnit === 'function') {
        setStockUnit(center, product, item.Unit || item.unit || item.unit_name || item.product_unit || item.uom);
      }

      if (typeof setStockProductType === 'function') {
        setStockProductType(center, product, item.product_type || item.type || item.category || item.product_category);
      }

      if (typeof setStockMinMaxFromSupabase === 'function') {
        setStockMinMaxFromSupabase(
          center,
          product,
          item.min_qty,
          item.max_qty
        );
      }
    });

    await fetchStockUnitsFromTable();

    refreshInBadges();
    refreshOutInfo();
    refreshTransferInfo();
    renderStockDashboard();
    fetchPendingPoSummary();
    renderHubStockDashboard();
    saveStockCache();

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
      editedByCode: item.edited_by_code || '',
      editedByName: item.edited_by_name || '',
      editedAt: item.edited_at || null,
    }));

    if (!Object.keys(localStockUnits || {}).length) {
      await fetchStockUnitsFromTable();
    }

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

function getTodayTextForRequestId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function getNextStockRequestIdFromSupabase() {
  const { data, error } = await supabaseClient.rpc('get_next_stock_request_id');

  if (error) {
    console.error('getNextStockRequestIdFromSupabase error:', error);
    throw new Error('สร้างเลขใบเบิกไม่สำเร็จ');
  }

  console.log('NEW REQUEST ID FROM SUPABASE:', data);

  return data;
}

async function refreshAppDataAfterAction() {
  try {
    if (typeof fetchStock === 'function') {
      await fetchFreshStock();
    }

    if (typeof fetchPendingTransfers === 'function') {
      await fetchPendingTransfers();
    }

    if (typeof fetchRequestStatus === 'function') {
      await fetchRequestStatus();
    }

    if (typeof fetchPoStatus === 'function') {
      await fetchPoStatus();
    }

    if (typeof fetchPendingPoSummary === 'function') {
      await fetchPendingPoSummary();
    }

    console.log('รีเฟรชข้อมูลหลังทำรายการแล้ว');
  } catch (error) {
    console.warn('refreshAppDataAfterAction error:', error);
  }
}

function getStockRequestItemsWithoutMin(center, items) {
  if (!center || !Array.isArray(items)) return [];

  return items.filter((item) => {
    if (!item?.product) return false;
    const productType = typeof getStockProductType === 'function'
      ? getStockProductType(center, item.product)
      : '';
    const normalizedType = typeof normalizeProductKey === 'function'
      ? normalizeProductKey(productType)
      : String(productType || '').trim();
    const normalizedDialysisType = typeof normalizeProductKey === 'function'
      ? normalizeProductKey('น้ำยาฟอกไต')
      : 'น้ำยาฟอกไต';
    const isDialysisFluid = typeof normalizeProductKey === 'function'
      ? normalizedType.includes(normalizedDialysisType)
      : String(productType || '').trim() === 'น้ำยาฟอกไต';

    if (!isDialysisFluid) return false;

    const minMax = typeof getSupabaseStockMinMax === 'function'
      ? getSupabaseStockMinMax(center, item.product)
      : {};
    const minQty = Number(minMax?.min);

    return !Number.isFinite(minQty) || minQty <= 0;
  });
}

async function submitStockOutSupabase() {
  if (!requirePermission('out')) return;

  const btn = document.getElementById('btn-out') || document.querySelector('[data-submit="out"]');
  if (!btn || btn.disabled) return;

  const date = document.getElementById('out-date').value;
  const center = document.getElementById('out-center').value;
  const note = document.getElementById('out-note').value.trim();
  const outPerson = document.getElementById('out-person')?.value.trim() || '';

  if (!date || !center) {
    showToast('⚠️ กรุณากรอกวันที่และศูนย์ที่เบิก', 'error');
    return;
  }

  if (!outPerson) {
    showToast('⚠️ กรุณากรอกชื่อผู้เบิกใช้', 'error');
    document.getElementById('out-person')?.focus();
    return;
  }

  if (!enforceOwnCenter('out', center)) return;

  const rows = document.querySelectorAll('#out-products .product-row');
  const items = collectItemsFromRows(rows);

  if (items.length === 0) {
    showToast('⚠️ กรุณาเพิ่มรายการสินค้าเบิกออก', 'error');
    return;
  }

  if (currentUser.role === 'center_staff') {
    btn.disabled = true;
    showToast('', 'loading', 'กำลังตรวจสอบ Min ของสินค้า...');

    try {
      if (typeof fetchFreshStock === 'function') {
        await fetchFreshStock();
      } else if (typeof fetchStock === 'function') {
        await fetchStock();
      }
    } catch (error) {
      btn.disabled = false;
      showToast(`❌ ${error.message || 'โหลดข้อมูล Min ไม่สำเร็จ'}`, 'error');
      return;
    }

    const itemsWithoutMin = getStockRequestItemsWithoutMin(center, items);

    if (itemsWithoutMin.length > 0) {
      const productNames = itemsWithoutMin
        .map((item) => item.product)
        .filter(Boolean)
        .join(', ');

      showToast(
        `⚠️ ${productNames} ยังไม่ได้กำหนด Min ในสต็อก ${center} กรุณาแจ้งแอดมินก่อนเบิก`,
        'error'
      );
      btn.disabled = false;
      return;
    }
  }

  btn.disabled = true;

  // Staff: สร้างใบเบิกส่งให้ Admin จัดของก่อน ยังไม่ตัด Stock
  if (currentUser.role === 'center_staff') {
    showToast('', 'loading', 'กำลังส่งใบเบิกไปยัง Admin...');

    try {
      const requestId = await getNextStockRequestIdFromSupabase();

      console.log('REQUEST ID USING:', requestId);

      const { data, error } = await supabaseClient.rpc('create_stock_request', {
        p_request_id: requestId,
        p_staff_code: currentUser.code,
        p_staff_name: outPerson,
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

      await refreshAppDataAfterAction();
      formRequestIds.out = '';
      resetForm('out');

      const outPersonInput = document.getElementById('out-person');
      if (outPersonInput) {
        outPersonInput.value = '';
        outPersonInput.placeholder = 'กรอกชื่อผู้เบิกใช้';
      }

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
    const requestId = await getNextStockRequestIdFromSupabase();

    console.log('REQUEST ID USING:', requestId);

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

    await refreshAppDataAfterAction();
    formRequestIds.out = '';
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
