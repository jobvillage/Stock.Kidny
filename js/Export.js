// export.js — Export Data Panel
const EXPORT_TABLES = [
  {
    key: 'po_cmo_requests',
    label: 'po_cmo_requests',
    hasDate: true, dateCol: 'created_at', productCol: null, centerCol: 'center',
    includeCols: ['po_id', 'po_date', 'center', 'status', 'items_prId', 'items_center', 'items_product', 'items_qty', 'items_unit_qty', 'items_unit_price', 'items_total_price','usage_status'],
  },
  {
    key: 'stock_lot_movements',
    label: 'stock_lot_movements',
    hasDate: true, dateCol: 'created_at', productCol: 'product', centerCol: 'source_center',
    includeCols: ['created_at', 'transaction_action', 'movement_type', 'source_center', 'product', 'lot_no', 'po_id', 'qty', 'unit_price', 'total_cost'],
  },
  {
    key: 'stock_requests',
    label: 'stock_requests',
    hasDate: true, dateCol: 'created_at', productCol: null, centerCol: 'center',
    includeCols: ['request_id', 'created_at', 'picked_at', 'center', 'status', 'items_product', 'items_qty', 'prepared_items_qty'],
  },
  {
    key: 'stock_lots',
    label: 'stock_lots',
    hasDate: true, dateCol: 'received_at', productCol: 'product', centerCol: 'center',
    includeCols: ['lot_no', 'po_id', 'center', 'product', 'received_qty', 'remaining_qty', 'unit_price', 'total_price', 'vendor_name', 'received_at'],
  },
  {
    key: 'stock_items',
    label: 'stock_items',
    hasDate: false, dateCol: null, productCol: 'product', centerCol: 'center',
    includeCols: ['center', 'product', 'qty', 'unit'],
  },
  {
    key: 'transactions',
    label: 'transactions',
    hasDate: true, dateCol: 'created_at', productCol: 'product', centerCol: 'center',
    includeCols: ['created_at', 'action', 'request_id', 'product', 'qty', 'fifo_unit_cost', 'fifo_cost_total', 'center'],
  },
];

// ดึงรายชื่อสินค้าทั้งหมดจาก PRODUCTS ที่โหลดไว้แล้ว
function getExportProductOptions() {
  const products = typeof PRODUCTS !== 'undefined' ? PRODUCTS : [];
  return products.map((p) => {
    const name = typeof p === 'string' ? p : (p.product || p.name || '');
    return name;
  }).filter(Boolean).sort();
}

function renderExportDataPanel() {
  const panel = ensurePrPanel('pr_export_data', 'panel-pr-export-data');

  const productOptions = getExportProductOptions()
    .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join('');

  panel.innerHTML = `
    <div class="panel-title">
      <span class="title-icon">📤</span>
      <div>
        <h2>Export Data</h2>
        <p>เลือกข้อมูลจาก Supabase แล้วดาวน์โหลดเป็น CSV</p>
      </div>
    </div>

    <section class="pr-main-card">
      <div class="pr-card-head">
        <div>
          <h3>ตัวกรองข้อมูล</h3>
          <p>ถ้า Table ไม่มีวันที่หรือสินค้า จะดึงมาทั้งหมด</p>
        </div>
      </div>

      <div class="pr-export-filters">
        <div class="field-group">
          <label>ตั้งแต่วันที่</label>
          <input type="date" id="export-date-from" max="${new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field-group">
          <label>ถึงวันที่</label>
          <input type="date" id="export-date-to" max="${new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field-group">
          <label>ชื่อสินค้า</label>
          <input
            type="text"
            id="export-product-input"
            list="export-product-list"
            placeholder="พิมพ์หรือเลือกสินค้า..."
            autocomplete="off"
          />
          <datalist id="export-product-list">
            ${productOptions}
          </datalist>
        </div>
        <div class="field-group">
        <label>ศูนย์</label>
        <select id="export-center">
            <option value="">⏳ กำลังโหลด...</option>
        </select>
        </div>
      </div>
    </section>

    <section class="pr-main-card">
      <div class="pr-card-head">
        <div>
          <h3>เลือก Table ที่ต้องการ Export</h3>
        </div>
        <button class="btn-submit btn-submit-transfer" type="button" id="export-csv-btn">
          ⬇️ Export CSV
        </button>
      </div>
      <div class="pr-export-grid">
        <label>
          <input type="checkbox" id="export-select-all" />
          เลือกทั้งหมด
        </label>
        ${EXPORT_TABLES.map((t) => `
          <label>
            <input type="checkbox" class="export-table-checkbox" value="${t.key}" checked />
            ${t.label}
            ${!t.hasDate ? '<small>(ดึงทั้งหมด ไม่กรองวันที่)</small>' : ''}
          </label>
        `).join('')}
      </div>
    </section>

    <div id="export-status" style="padding: 12px 0; color: var(--text-secondary); font-size: 14px;"></div>
  `;

  // Select all checkbox
  const selectAll = panel.querySelector('#export-select-all');
  const checkboxes = panel.querySelectorAll('.export-table-checkbox');

  selectAll.addEventListener('change', () => {
    checkboxes.forEach((cb) => { cb.checked = selectAll.checked; });
  });

  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      selectAll.checked = [...checkboxes].every((c) => c.checked);
    });
  });

  // Export button
  panel.querySelector('#export-csv-btn').addEventListener('click', handleExportCsv);

  loadExportCenters();
}

async function handleExportCsv() {
  const dateFrom = document.getElementById('export-date-from')?.value || '';
  const dateTo   = document.getElementById('export-date-to')?.value || '';
  const product  = document.getElementById('export-product-input')?.value?.trim() || '';
  const center   = document.getElementById('export-center')?.value?.trim() || '';

  const selectedTables = [...document.querySelectorAll('.export-table-checkbox:checked')]
    .map((cb) => cb.value);

  if (!selectedTables.length) {
    showToast('⚠️ กรุณาเลือก Table อย่างน้อย 1 รายการ', 'error');
    return;
  }

  showToast('⏳ กำลัง Export ข้อมูล...', 'info');

  try {
    const wb = XLSX.utils.book_new();

    for (const tableKey of selectedTables) {
      const tableDef = EXPORT_TABLES.find((t) => t.key === tableKey);
      if (!tableDef) continue;

      const data = await fetchExportTableData(tableDef, dateFrom, dateTo, product, center);
      const cleaned = (data || []).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v !== null && typeof v === 'object' ? JSON.stringify(v) : v,
          ])
        )
      );

      const ws = cleaned.length
        ? XLSX.utils.json_to_sheet(cleaned)
        : XLSX.utils.aoa_to_sheet([['ไม่พบข้อมูลตามเงื่อนไข']]);

      XLSX.utils.book_append_sheet(wb, ws, tableDef.label.slice(0, 31));
    }

    const filename = buildExportFilename('export', dateFrom, dateTo, product).replace('.csv', '.xlsx');
    XLSX.writeFile(wb, filename);

    showToast('✅ Export เสร็จสิ้น', 'success');

  } catch (err) {
    console.error('Export error:', err);
    showToast('❌ เกิดข้อผิดพลาดในการ Export', 'error');
  }
}

function expandJsonbRows(data, filterProduct) {
  if (!data?.length) return data;

  const firstRow = data[0];
  const arrayCols = Object.keys(firstRow).filter((k) => Array.isArray(firstRow[k]));

  if (!arrayCols.length) return data;

  const mainCol = arrayCols[0];
  const expanded = [];

  for (const row of data) {
    const items = Array.isArray(row[mainCol]) ? row[mainCol] : [];
    const baseRow = { ...row };
    arrayCols.forEach((col) => { baseRow[col] = ''; });

    if (!items.length) {
      expanded.push(baseRow);
      continue;
    }

    for (const item of items) {
      if (filterProduct && !String(item.product || '').toLowerCase().includes(filterProduct.toLowerCase())) continue;

      const itemFields = {};
      Object.entries(item).forEach(([k, v]) => {
        itemFields[`${mainCol}_${k}`] = typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '');
      });

      arrayCols.slice(1).forEach((col) => {
        const otherItems = Array.isArray(row[col]) ? row[col] : [];
        const match = otherItems.find((o) => o.product === item.product) || {};
        Object.entries(match).forEach(([k, v]) => {
          itemFields[`${col}_${k}`] = typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '');
        });
      });

      expanded.push({ ...baseRow, ...itemFields });
    }
  }

  return expanded;
}

async function fetchExportTableData(tableDef, dateFrom, dateTo, product, center) {
  let query = supabaseClient.from(tableDef.key).select('*');

  if (tableDef.hasDate && tableDef.dateCol) {
    if (dateFrom) query = query.gte(tableDef.dateCol, `${dateFrom}T00:00:00+00:00`);
    if (dateTo)   query = query.lte(tableDef.dateCol, `${dateTo}T23:59:59+00:00`);
  }

  if (product && tableDef.productCol) {
    query = query.ilike(tableDef.productCol, `%${product}%`);
  }

  if (center) {
    const centerCol = tableDef.centerCol || 'center';
    // ✅ เพิ่ม po_cmo_requests
    const hasCenterCol = ['transactions', 'stock_items', 'stock_lots', 'stock_requests', 'po_cmo_requests'].includes(tableDef.key);
    const hasCustomCenter = !!tableDef.centerCol;
    if (hasCenterCol || hasCustomCenter) {
      query = query.eq(centerCol, center);
    }
  }

  query = query.order(tableDef.dateCol || 'id', { ascending: true });

  const { data, error } = await query;
  if (error) throw error;

  const expanded = expandJsonbRows(data || [], product);

  if (tableDef.includeCols?.length) {
  const dateCols = ['created_at', 'picked_at', 'received_at', 'po_date', 'updated_at'];
  return expanded.map((row) =>
      Object.fromEntries(
      tableDef.includeCols
          .filter((col) => col in row)
          .map((col) => [
          col,
          dateCols.includes(col) ? formatExportDate(row[col]) : row[col]
          ])
      )
  );
  }

  return expanded;
}

function buildExportFilename(tableKey, dateFrom, dateTo, product) {
  const parts = [tableKey];
  if (dateFrom) parts.push(dateFrom);
  if (dateTo)   parts.push(dateTo);
  if (product)  parts.push(product.replace(/\s+/g, '_'));
  return parts.join('_') + '.csv';
}

function parseThaiDate(value) {
  if (!value) return '';
  const parts = value.split('/');
  if (parts.length !== 3) return '';
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function loadExportCenters() {
  const select = document.getElementById('export-center');
  if (!select) return;

  const { data, error } = await supabaseClient
    .from('stock_items')
    .select('center')
    .order('center');

  if (error || !data) return;

  const centers = [...new Set(data.map((r) => r.center).filter(Boolean))].sort();

  select.innerHTML = `<option value="">ทุกศูนย์</option>` +
    centers.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function formatExportDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}