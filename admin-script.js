
// แก้ไข URL นี้ให้เป็น URL สำหรับแก้ไข (Editor) ของ Google Sheets ของคุณ
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1aeCf4-Kl3LxMKTuQGMHHKfKtJi4MBln3wCuvhEvgSsk/edit?gid=1295594860#gid=1295594860';

// แก้ไข URL นี้ให้เป็น URL สำหรับแก้ไขโปรเจกต์ Apps Script ของคุณ
const APPS_SCRIPT_EDIT_URL = 'https://script.google.com/u/0/home/projects/14WvaNAubfiIO2MmWJNhVJHCS4HodnO-68rDLfMZbF6hUsaCL5uuKHfXx/edit';

// URL สำหรับดู Execution Log ของ Apps Script (Admin Link)
const APPS_SCRIPT_EXEC_URL = 'https://script.google.com/macros/s/AKfycbx8V7IPOwRNcm8cylLogQ7WWSiRMqPgdEvF7dyr9aNLhBZf0xcmoZBH8_k5Wg5NQm8SQQ/exec';

const ADMIN_SHEET_NAMES = {
  LEADS: 'ติดต่อฝ่ายขาย', // เปลี่ยนชื่อชีทให้ตรงกับที่ระบบบันทึก Lead
  FAVORITES: 'FavoritesLog',
};

const CRM_STATUSES = {
  PENDING:   'รอติดต่อ',
  CONTACTED: 'ติดต่อแล้ว',
  SENT:      'ส่งข้อมูลแล้ว',
  CLOSED:    'ปิดการขาย',
  CANCELLED: 'ยกเลิก',
};

const STATUS_COLORS = {
  'รอติดต่อ':      { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  'ติดต่อแล้ว':    { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  'ส่งข้อมูลแล้ว': { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  'ปิดการขาย':     { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  'ยกเลิก':        { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
};

const LEAD_COLS = {
  TIMESTAMP:  0,
  CATEGORY:   1,
  BUSINESS:   2,
  COMPANY:    3,
  PLAN:       4,
  GROUP:      5,
  COV_TYPE:   6,
  SUM:        7,
  PREMIUM:    8,
  NAME:       9,
  PHONE:      10,
  EMAIL:      11,
  TIME:       12,
  ADDRESS:    13,
  NOTE:       14,
  STATUS:     15,
  STAFF_NOTE: 16,
  POLICY_NO:  17,
  POLICY_DATE:18,
  RENEWAL_DATE:19,
};

const ADMIN_PAGE_SIZE = 20; // จำนวนรายการต่อหน้า

// =============================================================================
// ADMIN STATE
// =============================================================================

let adminLeadsData    = [];   // raw rows from leads sheet
let rawLeadsSheet     = null; // raw 2D array
let _dbSourceChart    = null; // instance สำหรับ Pie Chart ใน Dashboard
let _dbCategoryChart  = null; // instance สำหรับ Bar Chart ประเภทงาน
let _dashboardSalesChart = null; // instance สำหรับกราฟยอดขายหน้า Dashboard
let adminFavoritesLogData = []; // [NEW] ข้อมูลจากชีท FavoritesLog
let _modalOpenGuard = false; // ป้องกันการเปิด Modal ซ้อนกันด้วยการคลิกซ้ำ

// =============================================================================
// ADMIN PROCESSING
// =============================================================================
function processRawData() {
  console.log('[Admin] Initializing raw data processing...');
  if (typeof _detailColCache !== 'undefined') _detailColCache = {};
  parseBizSheet();
  parsePremSheet();
  parseMarkSheet();
  
  // ตรวจสอบและตั้งค่าข้อมูลรายละเอียดความคุ้มครอง
  if (typeof rawDetailData !== 'undefined' && rawDetailData) {
    globalDetailRows = rawDetailData;
    parseCoverageTopics(); // นิยามฟังก์ชันไว้ด้านล่างเพื่อสกัดหัวข้อสำหรับหน้า Add Package
  }

  populateDropdowns();
  parseLeadsSheet();      // admin extra
  fetchFavoritesLogDirectly(); // [NEW] ดึงข้อมูล Favorites
  
  // [REMOVED] updateAdminQuickStats() ถูกเรียกภายใน parseLeadsSheet เรียบร้อยแล้ว
  // เพื่อให้แน่ใจว่าตัวเลขสถิติอัปเดตหลังจากข้อมูล Leads ถูกประมวลผลเสร็จสิ้น

  if (typeof checkIncomingQuote === 'function') checkIncomingQuote();
}

/**
 * parseCoverageTopics — สกัดรายชื่อหัวข้อความคุ้มครองจาก Detail Sheet
 * เพื่อนำไปแสดงในรายการ Checkbox ของหน้า "เพิ่มแผนประกันใหม่" (Add Package Modal)
 */
function parseCoverageTopics() {
  if (!globalDetailRows || globalDetailRows.length <= 3) return;
  const topics = [];
  for (let r = 3; r < globalDetailRows.length; r++) {
    const name = String(globalDetailRows[r][1] || '').trim();
    // กรองเอาเฉพาะชื่อหัวข้อความคุ้มครองจริง (ข้ามแถวหมวดหมู่หรือสัญลักษณ์พิเศษ)
    if (name && !/บริษัทที่ประกันภัยคุ้มครอง|แผนประกันภัย|กลุ่มประกัน/.test(name)) {
      topics.push({ name });
    }
  }
  // บันทึกลง global variable สำหรับใช้ใน _populateAddPackageLists
  window.coverageTopics = topics.filter((v, i, a) => a.findIndex(t => t.name === v.name) === i);
  console.log(`[Admin] Parsed ${window.coverageTopics.length} coverage topics for Add Package tool.`);
}

// =============================================================================
// LEADS SHEET PARSING
// =============================================================================

function parseLeadsSheet() {
  adminLeadsData = [];
  const wb = window._adminWorkbook;
  if (!wb) {
    // ถ้า workbook ถูกเก็บไว้ใน loadExcelData ให้ดึงมาตรง ๆ
    fetchLeadsDirectly();
    return;
  }
  _parseLeadsFromWorkbook(wb);
}

/**
 * [NEW] ดึงข้อมูลจากชีท FavoritesLog ผ่าน Apps Script
 */
async function fetchFavoritesLogDirectly() {
  try {
    const resp = await fetch(APPS_SCRIPT_URL + '?action=getFavoritesLog&t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
    const json = await resp.json();
    if (json && json.data && Array.isArray(json.data)) {
      adminFavoritesLogData = json.data.map(row => ({
        userId: row.userId,
        timestamp: row.timestamp,
        business: row.business,
        company: row.company,
        plan: row.plan,
        group: row.group,
        covType: row.covType,
        category: row.category,
      }));
      console.log(`[Admin] Fetched ${adminFavoritesLogData.length} favorite logs.`);
    } else {
      throw new Error("Invalid data format from getFavoritesLog");
    }
  } catch (e) {
    console.warn('[Admin] fetchFavoritesLogDirectly failed:', e.message);
    // ในกรณีที่ดึงข้อมูลไม่สำเร็จ เราจะปล่อยให้ array เป็นค่าว่างไปก่อน
    // และอาจแสดงข้อความแจ้งเตือนบน Dashboard แทน
    adminFavoritesLogData = [];
  }
}

async function fetchLeadsDirectly() {
  // ดึงจาก Apps Script โดยตรง (GET เพื่ออ่าน leads)
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(APPS_SCRIPT_URL + '?action=getLeads&t=' + Date.now(), {
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
    const json = await resp.json();
    const leads = (json && json.data) ? json.data : json;
    if (Array.isArray(leads)) {
      adminLeadsData = leads.map((row, i) => _rowToLead(row, row.rowIndex ?? row.rowIdx ?? (i + 1)));
      updateAdminQuickStats();
      _updateSidebarBadge();
    } else {
      throw new Error("ข้อมูล Lead ไม่ถูกต้อง");
    }
  } catch (e) {
    console.warn('[Admin] fetchLeadsDirectly failed:', e.message);
    // [FIX] fallback: ใช้ข้อมูลจาก Workbook เดิมที่มีอยู่แล้วในหน่วยความจำเพื่อลดการโหลด Excel ใหม่
    if (window._adminWorkbook) {
      _parseLeadsFromWorkbook(window._adminWorkbook);
    } else {
      // กรณีที่ยังไม่มีข้อมูล Workbook เลย จึงค่อยดาวน์โหลดจาก Google Sheet โดยตรง
      await fetchLeadsFromSheet();
    }
  } finally {
    clearTimeout(tid);
  }
}

function openFavoritesDashboardModal() {
  if (!adminFavoritesLogData.length) {
    const html = `
      ${_modalHeader('❤️ แผนประกันยอดนิยม', 'favoritesDashboardModal')}
      <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
        <div style="font-size:36px;margin-bottom:12px;">💔</div>
        <div style="font-size:15px;font-weight:600;">ไม่พบข้อมูลแผนประกันที่ถูกใจ</div>
        <div style="font-size:13px;margin-top:8px;">อาจเป็นเพราะยังไม่มีผู้ใช้งานกดถูกใจแผนประกัน หรือเกิดข้อผิดพลาดในการโหลดข้อมูล</div>
      </div>`;
    _openModal('favoritesDashboardModal', html);
    return;
  }

  // --- Process Stats ---
  const totalFavorites = adminFavoritesLogData.length;
  const uniqueUsers = new Set(adminFavoritesLogData.map(f => f.userId)).size;

  const byPlan = {};
  adminFavoritesLogData.forEach(f => {
    const key = `${f.company} - ${f.plan}`;
    byPlan[key] = (byPlan[key] || 0) + 1;
  });
  const topPlans = Object.entries(byPlan).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const byCompany = {};
  adminFavoritesLogData.forEach(f => {
    byCompany[f.company] = (byCompany[f.company] || 0) + 1;
  });
  const topCompanies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const byBusiness = {};
  adminFavoritesLogData.forEach(f => {
    if (f.business && f.business !== 'null') {
      byBusiness[f.business] = (byBusiness[f.business] || 0) + 1;
    }
  });
  const topBusinesses = Object.entries(byBusiness).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // --- Build HTML ---
  const statCard = (icon, label, value, color = '#ef4444') =>
    `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
      <div style="font-size:22px;margin-bottom:6px;">${icon}</div>
      <div style="font-size:22px;font-weight:800;color:${color};line-height:1.2;">${value}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:700;text-transform:uppercase;">${label}</div>
    </div>`;

  const listRows = (items, color) => items.map(([name, count]) => {
    const barW = Math.max(4, Math.round((count / (items[0]?.[1] || 1)) * 100));
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:3px;">
        <span style="color:#1e293b;">${escapeHtml(name)}</span>
        <span style="color:${color}; font-weight:700;">${count} ครั้ง</span>
      </div>
      <div style="background:#f1f5f9;border-radius:6px;height:10px;overflow:hidden;">
        <div style="width:${barW}%;height:100%;background:${color};border-radius:6px;"></div>
      </div>
    </div>`;
  }).join('');

  const html = `
    ${_modalHeader('❤️ แผนประกันยอดนิยม', 'favoritesDashboardModal', '', false).replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    <div style="overflow:auto;flex:1;padding:20px 24px;background:#f8fafc;">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
        ${statCard('❤️', 'ยอดกดถูกใจทั้งหมด', totalFavorites)}
        ${statCard('👤', 'จำนวนผู้ใช้งาน', uniqueUsers, '#f97316')}
        ${statCard('⭐', 'แผนยอดนิยม', topPlans[0]?.[0] || '-', '#be185d')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:16px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">⭐ 5 แผนประกันที่ถูกใจมากที่สุด</div>
          ${listRows(topPlans, '#be185d')}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">🏢 5 บริษัทที่ถูกใจมากที่สุด</div>
          ${topCompanies.map(([name, count]) => {
            const barW = Math.max(4, Math.round((count / (topCompanies[0]?.[1] || 1)) * 100));
            const cColor = COMPANY_COLORS[name.toUpperCase()] || '#64748b';
            return `<div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:3px;">
                <span style="color:#1e293b;">${escapeHtml(name)}</span>
                <span style="color:${cColor}; font-weight:700;">${count} ครั้ง</span>
              </div>
              <div style="background:#f1f5f9;border-radius:6px;height:10px;overflow:hidden;">
                <div style="width:${barW}%;height:100%;background:${cColor};border-radius:6px;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px; grid-column: span 1 / span 2;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">📈 5 ประเภทธุรกิจที่กดถูกใจมากที่สุด</div>
          ${listRows(topBusinesses, '#0f766e')}
        </div>
      </div>
    </div>`;

  _openModal('favoritesDashboardModal', html);

  // ปรับแต่ง Modal ให้เต็มหน้าจอ
  const modal = document.getElementById('favoritesDashboardModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }
}


async function fetchLeadsFromSheet() {
  try {
    const resp = await fetch(GOOGLE_SHEET_URL + '&t=' + Date.now());
    if (!resp.ok) return;
    const wb = XLSX.read(new Uint8Array(await resp.arrayBuffer()), { type: 'array', cellDates: true });
    // บันทึก workbook ลง global เพื่อป้องกันการโหลดไฟล์ซ้ำในอนาคต
    if (!window._adminWorkbook) window._adminWorkbook = wb;
    _parseLeadsFromWorkbook(wb);
  } catch (e) {
    console.warn('[Admin] fetchLeadsFromSheet failed:', e.message);
  }
}

function _parseLeadsFromWorkbook(wb) {
  const leadsSheet = wb.Sheets[ADMIN_SHEET_NAMES.LEADS];
  

  if (!leadsSheet) { 
    console.warn(`[Admin] Sheet "${ADMIN_SHEET_NAMES.LEADS}" not found in workbook.`);
    adminLeadsData = [];
    rawLeadsSheet = null;
    updateAdminQuickStats();
    _updateSidebarBadge(0);
    return; 
  }

  rawLeadsSheet = XLSX.utils.sheet_to_json(leadsSheet, { header: 1 });
  adminLeadsData = [];
  for (let i = 1; i < rawLeadsSheet.length; i++) {
    const row = rawLeadsSheet[i];
    if (!row || !row[LEAD_COLS.NAME]) continue;
    // i ใน rawLeadsSheet: 0=header(row 1), 1=data(row 2) ดังนั้น rowIdx = i + 1
    adminLeadsData.push(_rowToLead(row, i + 1));
  }
  updateAdminQuickStats();
  _updateSidebarBadge();
  
  // เรียกใช้งานระบบตรวจสอบความถูกต้อง
  if (typeof debugCheckParseLeads === 'function') {
    debugCheckParseLeads();
  }
}

function _extractTag(str, tag) {
  if (!str) return '';
  const re = new RegExp(`\\[${tag}:\\s*(.*?)\\]`, 'i');
  const m = str.match(re);
  return m ? m[1].trim() : '';
}

/**
 * ปรับปรุงการแสดงผล Timestamp ให้กระชับ (Concise)
 * เช่น "25/5/2567 14:30:15" -> "25/5/67 14:30"
 */
function _fmtCompact(n) {
  const num = Number(n);
  if (isNaN(num)) return n;
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString('th-TH');
}

function _parseLeadTimestamp(ts) {
  if (!ts || ts === '-') return null;
  const s = String(ts).split(' GMT')[0].trim();
  
  const match = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})[\s,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (match) {
    let year = parseInt(match[3]);
    if (year >= 2400) year -= 543;
    return new Date(year, parseInt(match[2]) - 1, parseInt(match[1]),
      parseInt(match[4]), parseInt(match[5]), parseInt(match[6] || 0)).getTime();
  }
  
  if (s.match(/^\d{4}-\d{2}-\d{2}T/)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  
  return null;
}

function _fmtTsConcise(ts) {
  if (!ts || ts === '-') return '-';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  let s = String(ts).split(' GMT')[0].trim();

  const match = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})\s+(\d{1,2}):(\d{1,2})/);
  if (match) {
    const day = match[1];
    const month = months[parseInt(match[2]) - 1] || '';
    let year = parseInt(match[3]);
    if (year < 2400) year += 543;
    const yearStr = String(year).slice(-2);
    const hour = match[4].padStart(2, '0');
    const min = match[5].padStart(2, '0');
    return `${day} ${month} ${yearStr} (${hour}:${min})`;
  }

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{1,2})/);
  if (isoMatch) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const month = months[d.getMonth()];
      const year = d.getFullYear() + 543;
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${String(year).slice(-2)} (${hh}:${mm})`;
    }
  }

  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime())) {
    const d = dateObj.getDate();
    const m = months[dateObj.getMonth()];
    let y = dateObj.getFullYear();
    if (y < 2400) y += 543;
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    return `${d} ${m} ${String(y).slice(-2)} (${hh}:${mm})`;
  }
  return s;
}

function _fmtDateOnly(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const s = String(dateStr).split(' GMT')[0].trim();
  const match = s.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})/);
  if (match) {
    const day = match[1];
    const month = months[parseInt(match[2]) - 1] || '';
    const year = match[3].slice(-2);
    return `${day} ${month} ${year}`;
  }
  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime())) {
    const d = dateObj.getDate();
    const m = months[dateObj.getMonth()];
    let y = dateObj.getFullYear();
    if (y < 2400) y += 543;
    return `${d} ${m} ${String(y).slice(-2)}`;
  }
  return s;
}

function _rowToLead(row, rowIdx) {
  if (!row || typeof row !== 'object') return null;
  const isObj = !Array.isArray(row);

  const get = (colIdx, propName) => {
    const propMap = {
      timestamp: 'timestamp', category: 'category', business: 'business',
      company: 'company', plan: 'plan', group: 'group', covType: 'covType',
      sum: 'sum', premium: 'premium', name: 'name', phone: 'phone',
      email: 'email', time: 'time', address: 'address', note: 'note',
      status: 'status', staffNote: 'staffNote', policyNo: 'policyNo',
      policyDate: 'policyDate', renewalDate: 'renewalDate'
    };
    const prop = propMap[propName] || propName;
    const val = (isObj && prop) ? row[prop] : row[colIdx];
    return (val !== undefined && val !== null) ? String(val).trim() : '';
  };

  const addressRaw = get(LEAD_COLS.ADDRESS, 'address');
  const noteRaw = get(LEAD_COLS.NOTE, 'note');
  const assetMatch = noteRaw.match(/\[ทรัพย์สิน:\s*(.*?)\]/i);
  const assetStr   = assetMatch ? assetMatch[1] : '';

  // แยกชื่อสถานประกอบการออกจากที่อยู่เพื่อความชัดเจนในการแสดงผลและค้นหา
  let estName = '-';
  let displayAddr = addressRaw;
  let isMulti = addressRaw.startsWith('[หลายสถานที่ประกอบการ]');

  if (isMulti) {
    estName = 'หลายสถานที่ประกอบการ';
    displayAddr = addressRaw.replace('[หลายสถานที่ประกอบการ]', '').trim() || '-';
  } else if (addressRaw && addressRaw !== '-') {
    // ตรวจสอบ Address Markers เพื่อแยกชื่อสถานประกอบการออกจากส่วนที่เหลือของที่อยู่
    const markers = ['เลขที่', 'หมู่', 'ถ.', 'ต./แขวง', 'อ./เขต', 'จ.'];
    let splitIdx = -1;
    for (const m of markers) {
      const foundIdx = addressRaw.indexOf(' ' + m); 
      if (foundIdx !== -1 && (splitIdx === -1 || foundIdx < splitIdx)) {
        splitIdx = foundIdx;
      }
    }
    if (splitIdx !== -1) {
      estName = addressRaw.substring(0, splitIdx).trim() || '-';
      displayAddr = addressRaw.substring(splitIdx).trim();
    }
  }

  return {
    rowIdx,
    timestamp:   get(LEAD_COLS.TIMESTAMP, 'timestamp'),
    category:    get(LEAD_COLS.CATEGORY, 'category') || 'Non-Package',
    business:    get(LEAD_COLS.BUSINESS, 'business'),
    company:     get(LEAD_COLS.COMPANY, 'company'),
    plan:        get(LEAD_COLS.PLAN, 'plan'),
    group:       get(LEAD_COLS.GROUP, 'group'),
    covType:     get(LEAD_COLS.COV_TYPE, 'covType'),
    sum:         get(LEAD_COLS.SUM, 'sum'),
    premium:     get(LEAD_COLS.PREMIUM, 'premium'),
    name:        get(LEAD_COLS.NAME, 'name'),
    phone:       get(LEAD_COLS.PHONE, 'phone'),
    email:       get(LEAD_COLS.EMAIL, 'email'),
    time:        get(LEAD_COLS.TIME, 'time'),
    address:     displayAddr,
    establishmentName: estName,
    note:        noteRaw,
    isMultiLocation: isMulti,
    source:      _extractTag(noteRaw, 'source'),
    status:      get(LEAD_COLS.STATUS, 'status') || CRM_STATUSES.PENDING,
    staffNote:   get(LEAD_COLS.STAFF_NOTE, 'staffNote'),
    policyNo:    get(LEAD_COLS.POLICY_NO, 'policyNo'),
    policyDate:  get(LEAD_COLS.POLICY_DATE, 'policyDate'),
    renewalDate: get(LEAD_COLS.RENEWAL_DATE, 'renewalDate'),
    // parsed assets
    insuredStatus: parseAssetPart(assetStr, 'สถานะ'),
    area:          parseAssetPart(assetStr, 'ทุนอาคาร'),
    stock:         parseAssetPart(assetStr, 'ทรัพย์สินภายใน'),
    equipment:     parseAssetPart(assetStr, 'เครื่องจักร'),
renovation:    parseAssetPart(assetStr, 'สต็อกสินค้า'),
     staff:         parseAssetPart(assetStr, 'พนักงาน'),
     claimInfo:     parseAssetPart(assetStr, 'เคลม'),
   };
}

// =============================================================================
// QUICK STATS — อัปเดต DOM
// =============================================================================

function updateAdminQuickStats() {
  const counts = _countByStatus();
  const pending   = (counts[CRM_STATUSES.PENDING]   || 0);
  const contacted = (counts[CRM_STATUSES.CONTACTED] || 0);
  const sent      = (counts[CRM_STATUSES.SENT]      || 0);
  const closed    = (counts[CRM_STATUSES.CLOSED]    || 0);
  const nonPkg    = adminLeadsData.filter(l => l.category === 'Non-Package').length;
  const total     = adminLeadsData.length;

  _setQs('qs-pending',   pending);
  _setQs('qs-contacted', contacted);
  _setQs('qs-sent',      sent);
  _setQs('qs-closed',    closed);
  _setQs('qs-history',   total);
  _updateSidebarBadge(pending);

  // อัปเดต UI พิเศษสำหรับ Non-Package (ถ้ามี element)
  const npEl = document.getElementById('qs-non-package');
  if (npEl) {
    npEl.textContent = nonPkg;
    npEl.parentElement.style.display = nonPkg > 0 ? '' : 'none';
  }

  // อัปเดตกราฟหน้า Dashboard
  _updateDashboardCharts();
}

/**
 * จัดการข้อมูล: กรองและแสดงผลลูกค้าที่ขอแผนแบบ Non-Package (จาก user-form.js)
 */
function viewNonPackageLeads(page = 1, search = '', statusFilter = 'all') {
  const s = (search || '').trim().toLowerCase();
  let leads = adminLeadsData
    .map((l, i) => ({ ...l, _origIdx: i }))
    .filter(l => l.category === 'Non-Package');

  if (statusFilter && statusFilter !== 'all') {
    leads = leads.filter(l => l.status === statusFilter);
  }

  if (s) {
    leads = leads.filter(l =>
      l.name.toLowerCase().includes(s) ||
      l.establishmentName.toLowerCase().includes(s) ||
      l.address.toLowerCase().includes(s) ||
      l.phone.includes(s) ||
      l.business.toLowerCase().includes(s)
    );
  }

  const statusCounts = {};
  adminLeadsData.filter(l => l.category === 'Non-Package').forEach(l => {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  });

  const tabStyle = (st) => `
    padding: 6px 14px; border-radius: 10px; font-size: 12px; font-weight: 600;
    cursor: pointer; border: none; transition: all 0.2s; font-family: inherit;
    ${st === statusFilter ? 'background:#c2410c; color:#fff;' : 'background:#fff; color:#64748b; border:1px solid #e2e8f0;'}
  `;

  const rightHeaderHtml = `<button onclick="exportNonPackageExcel()" style="background:#c2410c;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif; display:flex; align-items:center; gap:6px;">
    <i class="ti ti-download"></i> <span>Export Excel</span>
  </button>`;

  const pageCb = `viewNonPackageLeads({PAGE}, '${s.replace(/'/g, "\\'").replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}', '${statusFilter}')`;

  const html = `
    ${_modalHeader('🏢 คำขอธุรกิจใหม่ (Non-Package)', 'historyModal', rightHeaderHtml).replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    <div style="padding:14px 24px;background:#fff7ed;border-bottom:1px solid #fdba74;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;font-weight:700;color:#c2410c;">รายการลูกค้าที่ระบบไม่พบประเภทธุรกิจและต้องการให้เจ้าหน้าที่ดูแลเป็นพิเศษ</span>
        <span style="font-size:12px;color:#64748b;">พบ ${leads.length} รายการ</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div style="position:relative;flex:1;min-width:200px;">
          <i class="ti ti-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#94a3b8;"></i>
          <input type="text" id="nonpkg-search-inp" placeholder="ค้นหาชื่อ, เบอร์ หรือธุรกิจ..." value="${escapeHtml(s)}" 
            oninput="debounce(() => viewNonPackageLeads(1, this.value, '${statusFilter}'), 250)()"
            style="width:100%;padding:8px 12px 8px 36px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:'Sarabun',sans-serif;outline:none;"
            onfocus="this.style.borderColor='#c2410c'" onblur="this.style.borderColor='#e2e8f0'">
        </div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;">
          <button style="${tabStyle('all')}" onclick="viewNonPackageLeads(1, document.getElementById('nonpkg-search-inp')?.value || '', 'all')">ทั้งหมด (${adminLeadsData.filter(l => l.category === 'Non-Package').length})</button>
          ${Object.values(CRM_STATUSES).map(st => {
            const cnt = statusCounts[st] || 0;
            if (cnt === 0) return '';
            return `<button style="${tabStyle(st)}" onclick="viewNonPackageLeads(1, document.getElementById('nonpkg-search-inp')?.value || '', '${st.replace(/'/g, "\\'")}')">${escapeHtml(st)} (${cnt})</button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div style="overflow:auto; flex:1; background:#fff; border-radius:0;">
      ${_buildLeadTable(leads, 'Non-Package', '', null, page, pageCb, true)}
    </div>`;

  _openModal('historyModal', html);

  const modal = document.getElementById('historyModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }

  const inp = document.getElementById('nonpkg-search-inp');
  if (inp && s) {
    inp.focus();
    inp.setSelectionRange(s.length, s.length);
  }
}

/**
 * กรองรายชื่อตาม Tag (Source หรือ Campaign) เมื่อคลิกที่ Badge ในตาราง
 */
function filterLeadsByTag(tagName, tagValue) {
  if (!tagValue) return;

  const leads = adminLeadsData
    .map((l, i) => ({ ...l, _origIdx: i }))
    .filter(l => l.source === tagValue);

  const titleIcon = '📢';
  const label = 'แหล่งที่มา';

  const html = `
    ${_modalHeader(`${titleIcon} ${label}: ${escapeHtml(tagValue)}`, 'historyModal')}
    <div style="padding:14px 24px;background:#f0f9ff;border-bottom:1px solid #bae6fd;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:13px;font-weight:700;color:#0369a1;">แสดงรายการลูกค้าจาก${label} ${escapeHtml(tagValue)}</span>
      <span style="font-size:12px;color:#64748b;">พบ ${leads.length} รายการ</span>
    </div>
    <div style="overflow:auto;max-height:calc(85vh - 120px);background:#fff;border-radius:0 0 18px 18px;">
      ${_buildLeadTable(leads, `${label} Filter`)}
    </div>`;
  _openModal('historyModal', html);
}

function _setQs(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _updateSidebarBadge(count) {
  const el = document.getElementById('sidebar-tracking-cnt');
  if (!el) return;
  const n = count !== undefined ? count : adminLeadsData.filter(l => l.status === CRM_STATUSES.PENDING).length;
  el.textContent = n;
  el.style.display = n > 0 ? '' : 'none';
}

function _countByStatus() {
  const map = {};
  adminLeadsData.forEach(l => { map[l.status] = (map[l.status] || 0) + 1; });
  return map;
}


// =============================================================================
// SHARED MODAL HELPERS
// =============================================================================

function _openModal(id, html = null) { // html is now optional
  const modal = document.getElementById(id);
  if (!modal) return;
  const modalWin = modal.querySelector('.modal-win');
  if (modalWin && html !== null) { // Only update content if html is provided
    modalWin.innerHTML = html;
  }

  modal.classList.add('active');
}

function _closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// click-outside to close
document.addEventListener('click', e => {
   ['historyModal','trackingModal','contactedModal',
    'closedModal','dashboardModal','addPackageModal'
   ].forEach(id => {
    const m = document.getElementById(id);
    if (m && e.target === m) m.classList.remove('active');
  });
});

// =============================================================================
// LEAD TABLE BUILDER (shared)
// =============================================================================

function _groupActionPanel() {
  return `
    <div id="group-action-panel" style="display:none; padding:12px 24px; background:#f0f9ff; border-bottom:1px solid #bae6fd; align-items:center; gap:15px; position:sticky; top:60px; z-index:5;">
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:20px; height:20px; background:#185FA5; color:#fff; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800;" id="selected-leads-count">0</div>
        <span style="font-size:13px; font-weight:700; color:#0369a1;">รายการที่เลือก</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap;">
        <span style="font-size:12px; color:#64748b; font-weight:600;">เปลี่ยนสถานะเป็น:</span>
        <select id="bulk-status-select" style="font-size:12px; padding:6px 12px; border-radius:10px; border:1px solid #bae6fd; outline:none; font-family:inherit; cursor:pointer; background:#fff;">
          ${Object.values(CRM_STATUSES).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
        <button onclick="applyBulkStatusUpdate(this)" style="background:#185FA5; color:#fff; border:none; padding:7px 16px; border-radius:10px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; transition:all 0.2s;">
          <i class="ti ti-check"></i> อัปเดตทั้งหมด
        </button>
      </div>
    </div>`;
}

function _statusBadge(status) {
  const s = STATUS_COLORS[status] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
  return `<span style="background:${s.bg};color:${s.text};border:1px solid ${s.border};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">${escapeHtml(status)}</span>`;
}

function _statusSelectHTML(currentStatus, leadIdx) {
  const s = STATUS_COLORS[currentStatus] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
  return `<select onchange="const c=STATUS_COLORS[this.value]; this.style.backgroundColor=c.bg; this.style.color=c.text; this.style.borderColor=c.border; updateLeadStatus(${leadIdx},this.value, this)"
    style="font-size:calc(var(--admin-table-fs) - 2px); font-weight:800; padding:4px 26px 4px 12px; border-radius:20px; border:1px solid ${s.border}; background:${s.bg} url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%223%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E') no-repeat right 10px center; color:${s.text}; font-family:inherit; cursor:pointer; outline:none; appearance:none; transition:all 0.2s; min-width:115px; height:28px;">
    ${Object.values(CRM_STATUSES).map(st =>
      `<option value="${escapeHtml(st)}" ${st === currentStatus ? 'selected' : ''} style="background:#fff; color:#334155; font-weight:400;">${escapeHtml(st)}</option>`
    ).join('')}
  </select>`;
}

function _buildLeadTable(leads, title, extraColsHeader = '', extraColsFn = null, currentPage = 1, pageCallback = '', hideInsuranceColumns = false, showActionButtons = true) {
  if (!leads.length) {
    return `<div style="text-align:center;padding:60px 20px;color:#94a3b8;">
      <div style="font-size:36px;margin-bottom:12px;">📭</div>
      <div style="font-size:15px;font-weight:600;">ไม่มีข้อมูลในขณะนี้</div>
    </div>`;
  }

  // Pagination Logic
  const totalItems = leads.length;
  const totalPages = Math.ceil(totalItems / ADMIN_PAGE_SIZE);
  const startIdx   = (currentPage - 1) * ADMIN_PAGE_SIZE;
  const pageLeads  = leads.slice(startIdx, startIdx + ADMIN_PAGE_SIZE);

  const now = new Date();
  const tableContentHtml = pageLeads.map((l, i) => {
    const extra = extraColsFn ? extraColsFn(l, l._origIdx ?? i) : '';
    const sourceBadge = l.source ? `<span class="badge-source" style="cursor:pointer;" onclick="filterLeadsByTag('source', '${escapeHtml(l.source).replace(/'/g, "\\'")}')"><i class="ti ti-world-share"></i> ${escapeHtml(l.source)}</span>` : '';

    const initialBg = l.isMultiLocation ? '#fffbeb' : ''; // สีพื้นหลังสำหรับไฮไลต์
    const highlightStyle = l.isMultiLocation ? `background:${initialBg}; border-left: 4px solid #f59e0b;` : '';
    
    // ตรวจสอบข้อมูลใหม่ (ภายใน 24 ชม.)
    let isNew = false;
    const lDate = _parseLeadTimestamp(l.timestamp);
    if (lDate !== null) {
      if ((Date.now() - lDate) < (24 * 60 * 60 * 1000)) isNew = true;
    }

    return `<tr onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"
      style="border-bottom:1px solid #f1f5f9;transition:background 0.12s;${highlightStyle}" class="lead-row" data-idx="${l._origIdx ?? i}">
      <td style="padding:11px 14px;"><input type="checkbox" class="lead-checkbox" onchange="updateGroupActionUI()" style="width:16px; height:16px; cursor:pointer; accent-color:#4258d3;"></td>
      <td style="padding:11px 14px;font-size:calc(var(--admin-table-fs) - 1px);color:#94a3b8;white-space:nowrap;">
        ${escapeHtml(_fmtTsConcise(l.timestamp))}
        ${isNew ? '<div style="margin-top:6px;"><span style="background:var(--grad-brand, linear-gradient(135deg, #10b981 0%, #059669 100%)); color:#fff; font-size:10px; padding:3px 8px; border-radius:12px; font-weight:800; display:inline-flex; align-items:center; gap:4px; box-shadow:0 2px 6px rgba(16,185,129,0.3); animation: pulse 2s infinite;"><i class="ti ti-flame" style="font-size:12px;"></i> NEW</span></div>' : ''}
      </td>
      <td style="padding:11px 14px;">
        <div style="font-size:var(--admin-table-fs);font-weight:700;color:#0f172a;">${escapeHtml(l.name)}</div>
        <div style="font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;margin-top:1px;">Phone : ${escapeHtml(l.phone)}</div>
        ${l.email && l.email !== '-' ? `<div style="font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;margin-top:1px;">E-mail : ${escapeHtml(l.email)}</div>` : ''}
        ${l.time && l.time !== '-' ? `<div style="font-size:10px; color:#f59e0b; font-weight:700; margin-top:2px;"><i class="ti ti-clock"></i> สะดวก: ${escapeHtml(l.time)}</div>` : ''}
        <div style="display:flex;gap:5px;margin-top:5px;">${sourceBadge}</div>
      </td>
      <td style="padding:11px 14px; max-width:200px;">
        <div style="font-size:calc(var(--admin-table-fs) - 1px);color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(l.business || '-')}</div>
        ${l.insuredStatus && l.insuredStatus !== '-' ? `<div style="font-size:10px; color:#64748b; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="ti ti-user-check"></i> ${escapeHtml(l.insuredStatus)}</div>` : ''}
      </td>
    <td style="padding:11px 14px; max-width:220px; vertical-align:top;">
        ${l.establishmentName && l.establishmentName !== '-' ? `<div style="font-size:11px; color:#185FA5; font-weight:700; margin-top:2px;"><i class="ti ti-building"></i> ${escapeHtml(l.establishmentName)}</div>` : ''}
      <div style="font-size:calc(var(--admin-table-fs) - 1px);font-weight:600;color:#1e293b; white-space:normal; word-break:break-word; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${escapeHtml(l.address)}">${escapeHtml(l.address)}</div>
    </td>
    <td style="padding:11px 14px;font-size:calc(var(--admin-table-fs) - 1px);color:#0F766E;font-weight:700;">
        <div style="font-weight:700;">${(() => { const raw = String(l.sum || '').trim(); if (!raw) return '-'; const num = Number(raw.replace(/,/g, '')); return isNaN(num) ? escapeHtml(l.sum) : escapeHtml(num.toLocaleString('th-TH')) + ' บาท'; })()}</div>
        <div style="font-size:11px;color:#64748b;font-weight:400;margin-top:4px;">
          ${l.area && l.area !== '-' ? `<div>ทุนอาคาร : ${escapeHtml(l.area).replace(/บาท/, ' บาท')}</div>` : ''}
          ${l.stock && l.stock !== '-' ? `<div>ทรัพย์สินภายใน : ${escapeHtml(l.stock).replace(/บาท/, ' บาท')}</div>` : ''}
          ${l.equipment && l.equipment !== '-' ? `<div>เครื่องจักร : ${escapeHtml(l.equipment).replace(/บาท/, ' บาท')}</div>` : ''}
          ${l.renovation && l.renovation !== '-' ? `<div>สต็อกสินค้า : ${escapeHtml(l.renovation).replace(/บาท/, ' บาท')}</div>` : ''}
          ${l.staff && l.staff !== '-' ? `<div>จำนวนพนักงาน : ${escapeHtml(l.staff).replace(/คน/, ' คน')}</div>` : ''}
          ${l.claimInfo && l.claimInfo !== '-' ? `<div>เคยเคลม : ${escapeHtml(l.claimInfo)}</div>` : ''}
        </div>
      </td>
<td style="padding:11px 14px;">${_statusSelectHTML(l.status, l._origIdx ?? i)}</td>
      ${showActionButtons ? `<td style="padding:11px 14px;">
        <div style="display:flex;gap:6px;">
          <button onclick="exportCustomerQuotePDF_FromAdmin(${l._origIdx ?? i})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#e1f5ee;border:1px solid #9fe1cb;border-radius:8px;cursor:pointer;color:#0f6e56;transition:all 0.2s;" 
            onmouseover="this.style.background='#d1fae5';this.style.transform='translateY(-1px)'" 
            onmouseout="this.style.background='#e1f5ee';this.style.transform=''"
            title="พิมพ์ใบเสนอราคา (PDF)">
            <i class="ti ti-printer" style="font-size:16px;"></i>
          </button>
          <button onclick="openShareModal(${l._origIdx ?? i})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;cursor:pointer;color:#c2410c;transition:all 0.2s;" 
            onmouseover="this.style.background='#ffedd5';this.style.transform='translateY(-1px)'" 
            onmouseout="this.style.background='#fff7ed';this.style.transform=''"
            title="ส่งข้อมูลให้ลูกค้า (Share)">
            <i class="ti ti-share" style="font-size:16px;"></i>
          </button>
          <button onclick="openEditLeadModal(${l._origIdx ?? i})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;cursor:pointer;color:#0369a1;transition:all 0.2s;" 
            onmouseover="this.style.background='#e0f2fe';this.style.transform='translateY(-1px)'" 
            onmouseout="this.style.background='#f0f9ff';this.style.transform=''"
            title="แก้ไขข้อมูล">
            <i class="ti ti-edit" style="font-size:16px;"></i>
          </button>
          <button onclick="deleteLead(${l._origIdx ?? i})"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#fef2f2;border:1px solid #fee2e2;border-radius:8px;cursor:pointer;color:#dc2626;transition:all 0.2s;" 
            onmouseover="this.style.background='#fee2e2';this.style.transform='translateY(-1px)'" 
            onmouseout="this.style.background='#fef2f2';this.style.transform=''"
            title="ลบรายการ">
            <i class="ti ti-trash" style="font-size:16px;"></i>
          </button>
        </div>
      </td>` : ''}
      ${extra}
    </tr>`;
  }).join('');

  const tableRowsHtml = `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;table-layout:auto;">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
          <th style="padding:12px 14px; width:45px;"><input type="checkbox" id="lead-check-all" onclick="toggleSelectAllLeads(this)" style="width:16px; height:16px; cursor:pointer; accent-color:#4258d3;"></th>
          <th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:0.5px; min-width:120px;">วันที่บันทึก</th>
          <th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:200px;">ชื่อลูกค้า / การติดต่อ</th>
          <th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:150px;">ประเภทธุรกิจ</th>
          ${hideInsuranceColumns ? '' : `<th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:180px;">สถานที่</th>`}
          ${hideInsuranceColumns ? '' : `<th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:100px;">ทุนประกัน</th>`}
          <th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:120px;">สถานะ</th>
          <th style="padding:12px 14px;text-align:left;font-size:calc(var(--admin-table-fs) - 2px);color:#64748b;font-weight:800;text-transform:uppercase; min-width:120px;">จัดการข้อมูล</th>
          ${extraColsHeader}
        </tr>
      </thead>
      <tbody>${tableContentHtml}</tbody>
    </table>
  </div>`;

  // Pagination HTML
  let paginationHtml = '';
  if (totalPages > 1 && pageCallback) {
    const btn = (p, label, active = false, disabled = false) => {
      const action = pageCallback
        .replace('__TTIB_PAGE__', p)
        .replace('{PAGE}', p);
      return `<button onclick="${action}" ${disabled ? 'disabled' : ''} style="padding:6px 12px; border:1px solid #e2e8f0; background:${active ? '#4258d3' : '#fff'}; color:${active ? '#fff' : '#64748b'}; border-radius:8px; cursor:pointer; font-weight:700; font-size:12px; transition:all 0.2s; display:flex; align-items:center; gap:4px;" ${!disabled ? 'onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\''+(active?'#4258d3':'#fff')+'\'"' : ''}>${label}</button>`;
    };

    paginationHtml = `
      <div style="padding:16px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="font-size:12px; color:#64748b; font-weight:600;">แสดง ${startIdx + 1} - ${Math.min(startIdx + ADMIN_PAGE_SIZE, totalItems)} จาก ${totalItems} รายการ</div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${btn(1, '<i class="ti ti-chevrons-left"></i>', false, currentPage === 1)}
          ${btn(currentPage - 1, '<i class="ti ti-chevron-left"></i>', false, currentPage === 1)}
          <span style="font-size:13px; font-weight:800; color:#1e293b; margin:0 10px;">หน้า ${currentPage} / ${totalPages}</span>
          ${btn(currentPage + 1, '<i class="ti ti-chevron-right"></i>', false, currentPage === totalPages)}
          ${btn(totalPages, '<i class="ti ti-chevrons-right"></i>', false, currentPage === totalPages)}
        </div>
      </div>`;
  }

  return _groupActionPanel() + tableRowsHtml + paginationHtml;
}

function _modalHeader(title, closeModalId, rightHtml = '', showExport = true) {
  const exportBtn = showExport ? `<button onclick="exportLeadsExcel()" class="admin-action-btn export" style="width:auto;padding:0 10px;font-size:12px;" title="Export to Excel"><i class="ti ti-file-spreadsheet"></i> Excel</button>` : '';
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid #e2e8f0;background:#fff;border-radius:18px 18px 0 0;position:sticky;top:0;z-index:10;">
    <h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">${title}</h2>
    <div style="display:flex;align-items:center;gap:8px;">
      ${exportBtn}
      ${rightHtml}
      <span onclick="_closeModal('${closeModalId}')" style="font-size:26px;color:#94a3b8;cursor:pointer;line-height:1;">&times;</span>
    </div>
  </div>`;
}

function _searchBar(placeholder, oninput) {
  return `<div style="position:relative;max-width:340px;">
    <i class="ti ti-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#94a3b8;"></i>
    <input type="text" placeholder="${escapeHtml(placeholder)}" oninput="debounce(() => ${oninput}, 250)()"
      style="width:100%;padding:9px 12px 9px 36px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:'Sarabun',sans-serif;outline:none;"
      onfocus="this.style.borderColor='#4258d3'" onblur="this.style.borderColor='#e2e8f0'">
  </div>`;
}

// =============================================================================
// TRACKING MODAL — คิวทั้งหมด (รอติดต่อ + ส่งข้อมูลแล้ว)
// =============================================================================

function openTrackingModal() {
  if (_modalOpenGuard) return;
  _modalOpenGuard = true;
  _renderTrackingModal('', 'all', 1);
  setTimeout(() => { _modalOpenGuard = false; }, 300);
}

function _renderTrackingModal(search, activeTab = 'all', page = 1, categoryFilter = 'all') {
  const s = (search || '').trim().toLowerCase();
  
  // กรองข้อมูลพื้นฐาน (เฉพาะ Pending และ Sent)
  let allTracking = adminLeadsData
    .map((l, i) => ({ ...l, _origIdx: i }))
    .filter(l => l.status === CRM_STATUSES.PENDING || l.status === CRM_STATUSES.SENT);

  const pendingCount = allTracking.filter(l => l.status === CRM_STATUSES.PENDING).length;
  const sentCount    = allTracking.filter(l => l.status === CRM_STATUSES.SENT).length;
  const packageCount = allTracking.filter(l => l.category !== 'Non-Package').length;
  const nonPackageCount = allTracking.filter(l => l.category === 'Non-Package').length;

  // กรองตาม Tab ที่เลือก
  let leads = allTracking;
  let statusFilter = activeTab;
  let activeCategoryFilter = categoryFilter;

  if (activeTab === 'package') {
    statusFilter = 'all';
    activeCategoryFilter = 'package';
  } else if (activeTab === 'non-package') {
    statusFilter = 'all';
    activeCategoryFilter = 'non-package';
  }

  if (statusFilter === 'pending') leads = leads.filter(l => l.status === CRM_STATUSES.PENDING);
  if (statusFilter === 'sent')    leads = leads.filter(l => l.status === CRM_STATUSES.SENT);

  if (activeCategoryFilter === 'package') {
    leads = leads.filter(l => l.category !== 'Non-Package');
  } else if (activeCategoryFilter === 'non-package') {
    leads = leads.filter(l => l.category === 'Non-Package');
  }
  
  // กรองตามคำค้นหา
  if (s) {
    leads = leads.filter(l => 
      l.name.toLowerCase().includes(s) || 
      l.establishmentName.toLowerCase().includes(s) || // เพิ่มการค้นหาจากชื่อสถานประกอบการ
      l.address.toLowerCase().includes(s) || // เพิ่มการค้นหาจากที่อยู่
      l.phone.includes(s) || 
      l.business.toLowerCase().includes(s)
    );
  }

  const tabStyle = (id) => `
    padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 700; 
    cursor: pointer; border: none; transition: all 0.2s; font-family: inherit;
    ${activeTab === id ? 'background:#4258d3; color:#fff; box-shadow: 0 4px 12px rgba(66,88,211,0.2);' : 'background:transparent; color:#64748b;'}
  `;

  const pageCb = `_renderTrackingModal('${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}', '${activeTab}', __TTIB_PAGE__, '${categoryFilter}')`;

  const html = `
    ${_modalHeader('⏳ จัดการคิวงาน', 'trackingModal', 
      `<button onclick="refreshLeads()" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; color:#475569;">
        <i class="ti ti-refresh"></i> รีเฟรชข้อมูล
      </button>`).replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    
    <div style="padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
      <!-- Stats summary bar -->
       <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
         <div style="background: #fff; padding: 12px; border-radius: 14px; border: 1px solid #e2e8f0; text-align: center;">
           <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">งานทั้งหมด</div>
           <div style="font-size: 20px; font-weight: 800; color: #1e293b;">${pendingCount + sentCount}</div>
         </div>
         <div style="background: #fff; padding: 12px; border-radius: 14px; border: 1.5px solid #fde68a; text-align: center;">
           <div style="font-size: 10px; font-weight: 800; color: #92400e; text-transform: uppercase;">รอติดต่อ</div>
           <div style="font-size: 20px; font-weight: 800; color: #92400e;">${pendingCount}</div>
         </div>
         <div style="background: #fff; padding: 12px; border-radius: 14px; border: 1.5px solid #a5b4fc; text-align: center;">
           <div style="font-size: 10px; font-weight: 800; color: #3730a3; text-transform: uppercase;">ส่งข้อมูลแล้ว</div>
           <div style="font-size: 20px; font-weight: 800; color: #3730a3;">${sentCount}</div>
         </div>
       </div>

       <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
         <div style="display: flex; background: #f1f5f9; padding: 4px; border-radius: 14px;">
           <button style="${tabStyle('all')}" onclick="_renderTrackingModal(document.getElementById('track-search-inp')?.value || '', 'all', 1, 'all')">ทั้งหมด (${pendingCount + sentCount})</button>
           <button style="${tabStyle('pending')}" onclick="_renderTrackingModal(document.getElementById('track-search-inp')?.value || '', 'pending', 1, 'all')">รอติดต่อ (${pendingCount})</button>
           <button style="${tabStyle('sent')}" onclick="_renderTrackingModal(document.getElementById('track-search-inp')?.value || '', 'sent', 1, 'all')">ส่งข้อมูลแล้ว (${sentCount})</button>
           <button style="${tabStyle('package')}" onclick="_renderTrackingModal(document.getElementById('track-search-inp')?.value || '', 'package', 1, 'package')">Package (${packageCount})</button>
           <button style="${tabStyle('non-package')}" onclick="_renderTrackingModal(document.getElementById('track-search-inp')?.value || '', 'non-package', 1, 'non-package')">Non-Package (${nonPackageCount})</button>
         </div>
         <div style="position: relative; flex: 1; min-width: 260px;">
           <i class="ti ti-search" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 16px;"></i>
           <input type="text" id="track-search-inp" placeholder="ค้นหาชื่อ, เบอร์ หรือธุรกิจ..." 
                  value="${escapeHtml(s)}"
                   style="width: 100%; padding: 11px 16px 11px 40px; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 14px; font-family: inherit; outline: none;"
                   oninput="debounce(() => _renderTrackingModal(this.value, '${activeTab}', 1, '${categoryFilter}'), 250)()">
         </div>
       </div>
     </div>

    <div style="overflow: auto; flex: 1; background: #fff; border-radius: 0;">
      ${_buildLeadTable(leads, 'คิวงาน', '', null, page, pageCb)}
    </div>`;

  _openModal('trackingModal', html);

  // ปรับแต่ง Modal ให้แสดงผลเต็มหน้าจอ (Full Screen)
  const modal = document.getElementById('trackingModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0'; // ลบ padding รอบนอกออก
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0'
    });
  }
  
  // คืนค่า Focus ให้ช่องค้นหาหลังจาก Render ใหม่
  const inp = document.getElementById('track-search-inp');
  if (inp && s) {
    inp.focus();
    inp.setSelectionRange(s.length, s.length);
  }
}

// =============================================================================
// CONTACTED MODAL — ติดต่อแล้ว
// =============================================================================

function openContactedModal() {
  _renderContactedModal('');
}

function _renderContactedModal(search) {
  const s = search.trim().toLowerCase();
  const leads = adminLeadsData
    .map((l, i) => ({ ...l, _origIdx: i }))
    .filter(l => l.status === CRM_STATUSES.CONTACTED)
    .filter(l => !s || l.name.toLowerCase().includes(s) || l.phone.includes(s));

  const html = `
    ${_modalHeader('📞 ติดต่อแล้ว', 'contactedModal').replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    <div style="padding:16px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      ${_searchBar('ค้นหา...', "_renderContactedModal(this.value)")}
      <span style="font-size:12px;color:#64748b;">${leads.length} รายการ</span>
    </div>
    <div style="overflow:auto; flex:1; background:#fff; border-radius:0;">
      ${_buildLeadTable(leads, 'ติดต่อแล้ว')}
    </div>`;

  _openModal('contactedModal', html);

  const modal = document.getElementById('contactedModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }
}

// =============================================================================
// CLOSED MODAL — ปิดการขาย
// =============================================================================

function openClosedModal() {
  _renderClosedModal('', 1);
}

function _renderClosedModal(search, page = 1) {
  const s = search.trim().toLowerCase();
  const leads = adminLeadsData
    .map((l, i) => ({ ...l, _origIdx: i }))
    .filter(l => l.status === CRM_STATUSES.CLOSED)
    .filter(l => !s || l.name.toLowerCase().includes(s) || l.phone.includes(s))
    .sort((a, b) => {
      const ta = _parseLeadTimestamp(a.timestamp) || 0;
      const tb = _parseLeadTimestamp(b.timestamp) || 0;
      return tb - ta;
    });

  const extraHeader = `<th style="padding:12px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;">หมายเลขกรมธรรม์</th>`;

  const extraFn = (l, idx) => `
    <td style="padding:11px 14px;">
      <div style="font-size:12px;font-weight:600;color:#1e293b;">${escapeHtml(l.policyNo || '-')}</div>
      <div style="font-size:11px;color:#64748b;">${escapeHtml(_fmtDateOnly(l.policyDate || ''))}</div>
    </td>`;

  const totalPremium = leads.reduce((sum, l) => {
    const n = parseFloat(String(l.premium || '').replace(/[^0-9.]/g, ''));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const pageCb = `_renderClosedModal('${s.replace(/'/g,"\\'")}', {PAGE})`;

  const html = `
    ${_modalHeader('✅ ปิดการขาย', 'closedModal').replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    <div style="padding:14px 24px;background:#e1f5ee;border-bottom:1px solid #9fe1cb;display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
      <div style="font-size:13px;font-weight:700;color:#085041;">
        ปิดการขาย ${leads.length} ราย
      </div>

      ${_searchBar('ค้นหา...', "_renderClosedModal(this.value)")}
    </div>
<div style="overflow:auto; flex:1; background:#fff; border-radius:0;">
       ${_buildLeadTable(leads, 'ปิดการขาย', extraHeader, extraFn, page, pageCb, false, false)}
     </div>`;

  _openModal('closedModal', html);

  const modal = document.getElementById('closedModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }
}

// =============================================================================
// HISTORY MODAL — ประวัติทั้งหมด
// =============================================================================

function openHistoryModal() {
  _renderHistoryModal('', 'all', '', '', 'date_desc', 1);
}

function _renderHistoryModal(search, statusFilter, startDate = '', endDate = '', sortBy = 'date_desc', page = 1) {
  const s = search.trim().toLowerCase();
  let leads = adminLeadsData.map((l, i) => ({ ...l, _origIdx: i }));
  if (statusFilter && statusFilter !== 'all') leads = leads.filter(l => l.status === statusFilter); // [FIX] ใช้ s แทน search
  if (s) {
    leads = leads.filter(l => 
      l.name.toLowerCase().includes(s) || 
      l.establishmentName.toLowerCase().includes(s) || // เพิ่มการค้นหาจากชื่อสถานประกอบการ
      l.address.toLowerCase().includes(s) || 
      l.phone.includes(s) || 
      l.business.toLowerCase().includes(s) || 
      l.company.toLowerCase().includes(s));
  }

  // 1. กรองตามช่วงวันที่
  if (startDate || endDate) {
    const startTs = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : null;
    const endTs = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : null;
    leads = leads.filter(l => {
      const lDate = _parseLeadTimestamp(l.timestamp);
      if (lDate === null) return false;
      if (startTs && lDate < startTs) return false;
      if (endTs && lDate > endTs) return false;
      return true;
    });
  }

  // 2. จัดเรียงข้อมูล (Sorting)
  leads.sort((a, b) => {
    if (sortBy === 'date_desc' || sortBy === 'date_asc') {
      const ta = _parseLeadTimestamp(a.timestamp) || 0;
      const tb = _parseLeadTimestamp(b.timestamp) || 0;
      return sortBy === 'date_desc' ? tb - ta : ta - tb;
    }
    if (sortBy === 'prem_desc' || sortBy === 'prem_asc') {
      const pa = parseFloat(String(a.premium || '').replace(/[^0-9.]/g, '')) || 0;
      const pb = parseFloat(String(b.premium || '').replace(/[^0-9.]/g, '')) || 0;
      return sortBy === 'prem_desc' ? pb - pa : pa - pb;
    }
    return 0;
  });

  const filterBtns = ['all', ...Object.values(CRM_STATUSES)].map(st => {
    const label = st === 'all' ? 'ทั้งหมด' : st;
    const count = st === 'all' ? adminLeadsData.length : adminLeadsData.filter(l => l.status === st).length;
    const active = st === statusFilter;
    return `<button onclick="_renderHistoryModal(document.getElementById('hist-search-inp')?.value || '','${escapeHtml(st)}', document.getElementById('hist-start-date')?.value, document.getElementById('hist-end-date')?.value, document.getElementById('hist-sort')?.value)"
      style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${active ? '#4258d3' : '#e2e8f0'};background:${active ? '#4258d3' : '#fff'};color:${active ? '#fff' : '#475569'};font-family:'Sarabun',sans-serif;">
      ${escapeHtml(label)} (${count})
    </button>`;
  }).join('');

  const pageCb = `_renderHistoryModal('${s.replace(/'/g,"\\'")}', '${statusFilter}', '${startDate}', '${endDate}', '${sortBy}', {PAGE})`;

  const rightHeaderHtml = `<button onclick="exportLeadsExcel()" style="background:#0f6e56;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif; display:flex; align-items:center; gap:6px;">
    <i class="ti ti-download"></i> <span>Export Excel</span>
  </button>`;

  const header = _modalHeader('📜 ประวัติการทำงานทั้งหมด', 'historyModal', rightHeaderHtml).replace('border-radius:18px 18px 0 0;', 'border-radius:0;');

  // สร้างรายการอัพเดทสถานะ
  const updateItems = statusChangeLog.slice(-10).reverse().map(log => {
    const d = new Date(log.timestamp);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() + 543;
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    const dateStr = `${day}/${month}/${year}`;
    const timeStr = `${hour}:${min}:${sec}`;
    const statusColors = {
      'รอติดต่อ': '#FEF3C7',
      'ติดต่อแล้ว': '#DBEAFE',
      'ส่งข้อมูลแล้ว': '#E0E7FF',
      'ปิดการขาย': '#D1FAE5',
      'ยกเลิก': '#FEE2E2'
    };
    const bgColor = statusColors[log.newStatus] || '#f1f5f9';
    const icon = log.newStatus === 'ปิดการขาย' ? '✅' : log.newStatus === 'ยกเลิก' ? '❌' : '🔄';
    return `<div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:${bgColor}15; border-radius:10px; border:1px solid ${bgColor}40; margin-bottom:8px;">
      <span style="font-size:16px;">${icon}</span>
      <div style="flex:1;">
        <div style="font-size:13px; font-weight:700; color:#1e293b;">${escapeHtml(log.name)}</div>
        <div style="font-size:11px; color:#64748b;">${escapeHtml(log.oldStatus)} → ${escapeHtml(log.newStatus)}</div>
      </div>
      <div style="font-size:11px; color:#94a3b8; text-align:right;">
        <div>${dateStr}</div>
        <div>${timeStr} น.</div>
      </div>
    </div>`;
  }).join('');

  const html = `
    ${header}
    <div style="padding:14px 24px; background:#fef3c7; border-bottom:1px solid #fcd34d;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <i class="ti ti-bell" style="color:#92400e; font-size:18px;"></i>
        <span style="font-size:14px; font-weight:700; color:#92400e;">อัปเดทสถานะล่าสุด (${statusChangeLog.length} รายการ)</span>
      </div>
      <div style="max-height:180px; overflow-y:auto;">${updateItems || '<div style="color:#64748b; font-size:12px;">ยังไม่มีการอัปเดทสถานะ</div>'}</div>
    </div>
    <div style="padding:14px 24px; background:#f8fafc;border-bottom:1px solid #e2e8f0;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${filterBtns}</div>
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
        <div style="position:relative;max-width:340px; flex:1;">
          <i class="ti ti-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#94a3b8;"></i>
          <input type="text" id="hist-search-inp" placeholder="ค้นหาชื่อ, เบอร์ หรือธุรกิจ..." value="${escapeHtml(search)}"
            oninput="debounce(() => _renderHistoryModal(this.value,'${escapeHtml(statusFilter)}', document.getElementById('hist-start-date')?.value, document.getElementById('hist-end-date')?.value, document.getElementById('hist-sort')?.value), 250)()"
            style="width:100%;padding:9px 12px 9px 36px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:'Sarabun',sans-serif;outline:none;"
            onfocus="this.style.borderColor='#4258d3'" onblur="this.style.borderColor='#e2e8f0'">
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#64748b; font-weight:600;">เรียงตาม:</span>
          <select id="hist-sort" onchange="_renderHistoryModal(document.getElementById('hist-search-inp')?.value, '${escapeHtml(statusFilter)}', document.getElementById('hist-start-date')?.value, document.getElementById('hist-end-date')?.value, this.value)"
            style="padding:7px 10px; border:1px solid #e2e8f0; border-radius:10px; font-size:12px; font-family:inherit; outline:none; color:#475569; background:#fff;">
            <option value="date_desc" ${sortBy === 'date_desc' ? 'selected' : ''}>ล่าสุด -> เก่าสุด</option>
            <option value="date_asc" ${sortBy === 'date_asc' ? 'selected' : ''}>เก่าสุด -> ล่าสุด</option>
            <option value="prem_desc" ${sortBy === 'prem_desc' ? 'selected' : ''}>เบี้ยประกัน (สูง-ต่ำ)</option>
            <option value="prem_asc" ${sortBy === 'prem_asc' ? 'selected' : ''}>เบี้ยประกัน (ต่ำ-สูง)</option>
          </select>
          <span style="font-size:12px; color:#64748b; font-weight:600; margin-left:8px;">วันที่:</span>
          <input type="date" id="hist-start-date" value="${startDate}" 
            onchange="_renderHistoryModal(document.getElementById('hist-search-inp')?.value, '${escapeHtml(statusFilter)}', this.value, document.getElementById('hist-end-date')?.value, document.getElementById('hist-sort')?.value)"
            style="padding:7px 10px; border:1px solid #e2e8f0; border-radius:10px; font-size:12px; font-family:inherit; outline:none; color:#475569;">
          <span style="font-size:12px; color:#64748b;">ถึง</span>
          <input type="date" id="hist-end-date" value="${endDate}" 
            onchange="_renderHistoryModal(document.getElementById('hist-search-inp')?.value, '${escapeHtml(statusFilter)}', document.getElementById('hist-start-date')?.value, this.value, document.getElementById('hist-sort')?.value)"
            style="padding:7px 10px; border:1px solid #e2e8f0; border-radius:10px; font-size:12px; font-family:inherit; outline:none; color:#475569;">
          <button onclick="_renderHistoryModal(document.getElementById('hist-search-inp')?.value, '${escapeHtml(statusFilter)}', '', '', 'date_desc')" 
            style="background:none; border:none; color:#ef4444; font-size:12px; font-weight:700; cursor:pointer; padding:0 5px;">ล้างตัวกรอง</button>
        </div>
      </div>
    </div>
    <div style="overflow:auto; flex:1; background:#fff; border-radius:0;">
      ${_buildLeadTable(leads, 'ประวัติ', '', null, page, pageCb)}
    </div>`;

  _openModal('historyModal', html);

  const modal = document.getElementById('historyModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }

  // คืนค่า Focus ให้ช่องค้นหาหลังจาก Render ใหม่เพื่อให้พิมพ์ต่อเนื่องได้
  const inp = document.getElementById('hist-search-inp');
  if (inp && s) {
    inp.focus();
    inp.setSelectionRange(s.length, s.length);
  }
}

// =============================================================================
// DASHBOARD MODAL — สถิติและรายงาน
// =============================================================================

function openDashboardModal() {
  const counts = _countByStatus();
  const total  = adminLeadsData.length;
  const closed = counts[CRM_STATUSES.CLOSED] || 0;
  const convRate = total ? ((closed / total) * 100).toFixed(1) : '0.0';

  // premium sum
  const totalPrem = adminLeadsData
    .filter(l => l.status === CRM_STATUSES.CLOSED)
    .reduce((s, l) => s + (parseFloat(String(l.premium || '').replace(/[^0-9.]/g, '')) || 0), 0);

  // by company
  const byCompany = {};
  adminLeadsData.forEach(l => {
    const companies = l.company.split(',').map(c => c.trim());
    companies.forEach(c => {
      if (!c) return;
      byCompany[c] = byCompany[c] || { total: 0, closed: 0 };
      byCompany[c].total++;
      if (l.status === CRM_STATUSES.CLOSED) byCompany[c].closed++;
    });
  });

  // ประมวลผลข้อมูลตาม Source เพื่อทำ Pie Chart
  const sourceStats = {};
  adminLeadsData.forEach(l => {
    const src = l.source || 'Direct/Other';
    if (!sourceStats[src]) sourceStats[src] = { total: 0, closed: 0 };
    sourceStats[src].total++;
    if (l.status === CRM_STATUSES.CLOSED) sourceStats[src].closed++;
  });

  // ประมวลผลข้อมูลตาม Category (Package vs Non-Package)
  const pkgCount = adminLeadsData.filter(l => l.category === 'Package').length;
  const nonPkgCount = adminLeadsData.filter(l => l.category === 'Non-Package').length;

  // by business
  const byBiz = {};
  adminLeadsData.forEach(l => {
    if (!l.business) return;
    byBiz[l.business] = (byBiz[l.business] || 0) + 1;
  });
  const topBiz = Object.entries(byBiz).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // by month (last 6)
  const byMonth = {};
  adminLeadsData.forEach(l => {
    const ts = _parseLeadTimestamp(l.timestamp);
    if (!ts) return;
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort().slice(-6);

  const statCard = (icon, label, value, color = '#0f172a') =>
    `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
      <div style="font-size:22px;margin-bottom:6px;">${icon}</div>
      <div style="font-size:22px;font-weight:800;color:${color};line-height:1.2;">${value}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:700;text-transform:uppercase;">${label}</div>
    </div>`;

  const companyRows = Object.entries(byCompany)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([comp, d]) => {
      const rate = d.total ? ((d.closed / d.total) * 100).toFixed(0) : 0;
      const barW = Math.max(4, Math.round((d.total / Math.max(...Object.values(byCompany).map(x => x.total))) * 100));
      const cColor = COMPANY_COLORS[comp.toUpperCase()] || '#64748b';
      return `<div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:3px;">
          <span style="color:#1e293b;">${escapeHtml(comp)}</span>
          <span style="color:#64748b;">${d.total} leads · ${rate}% ปิด</span>
        </div>
        <div style="background:#f1f5f9;border-radius:6px;height:10px;overflow:hidden;">
          <div style="width:${barW}%;height:100%;background:${cColor};border-radius:6px;"></div>
        </div>
      </div>`;
    }).join('');

  const bizRows = topBiz.map(([biz, count]) => {
    const barW = Math.max(4, Math.round((count / (topBiz[0]?.[1] || 1)) * 100));
    return `<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
        <span style="font-weight:600;color:#1e293b;">${escapeHtml(biz)}</span>
        <span style="color:#64748b;">${count} รายการ</span>
      </div>
      <div style="background:#f1f5f9;border-radius:4px;height:8px;">
        <div style="width:${barW}%;height:100%;background:#4258d3;border-radius:4px;"></div>
      </div>
    </div>`;
  }).join('');

  const monthRows = months.map(m => {
    const cnt = byMonth[m] || 0;
    const barH = Math.max(4, Math.round((cnt / Math.max(...months.map(k => byMonth[k] || 0))) * 80));
    const [yr, mo] = m.split('-');
    const moName = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(mo)-1];
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
      <div style="font-size:11px;font-weight:700;color:#1D9E75;">${cnt}</div>
      <div style="width:28px;background:#1D9E75;border-radius:4px 4px 0 0;height:${barH}px;"></div>
      <div style="font-size:10px;color:#64748b;">${moName}</div>
    </div>`;
  }).join('');

  const html = `
    ${_modalHeader('📊 สถิติและรายงาน', 'dashboardModal',
      `<button onclick="exportDashboardPDF()" style="background:#0f172a;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">
        <i class="ti ti-printer"></i> พิมพ์
      </button>`).replace('border-radius:18px 18px 0 0;', 'border-radius:0;')}
    <div style="overflow:auto;flex:1;padding:20px 24px;background:#f8fafc;">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
        ${statCard('📥', 'รับ Lead ทั้งหมด', total)}
        ${statCard('⏳', 'รอติดต่อ', counts[CRM_STATUSES.PENDING] || 0, '#92400E')}
        ${statCard('📞', 'ติดต่อแล้ว', counts[CRM_STATUSES.CONTACTED] || 0, '#4258d3')}
        ${statCard('✅', 'ปิดการขาย', closed, '#0F766E')}
        ${statCard('📈', 'อัตราปิด', convRate + '%', '#BA7517')}
        ${statCard('💰', 'เบี้ยรวม (ปิด)', _fmtCompact(totalPrem) + ' บาท', '#0F766E')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">📦 Leads ตามบริษัท</div>
          ${companyRows || '<div style="color:#94a3b8;font-size:12px;">ยังไม่มีข้อมูล</div>'}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">🏢 ธุรกิจยอดนิยม</div>
          ${bizRows || '<div style="color:#94a3b8;font-size:12px;">ยังไม่มีข้อมูล</div>'}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin-top:16px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">📦 ประเภทงาน (Package vs Non-Package)</div>
          <div style="height:280px; position:relative;">
            <canvas id="chart-category-bar"></canvas>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin-top:16px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;">📢 สัดส่วนการปิดการขายแยกตามแหล่งที่มา</div>
          <div style="height:280px; position:relative;">
            <canvas id="chart-source-pie"></canvas>
          </div>
        </div>
      </div>

      ${months.length ? `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin-top:16px;">
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:16px;">📅 Leads รายเดือน (6 เดือนล่าสุด)</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;padding-bottom:4px;">
          ${monthRows}
        </div>
      </div>` : ''}

    </div>`;

  _openModal('dashboardModal', html);
  
  // ปรับแต่ง Modal Dashboard ให้เต็มหน้าจอ
  const modal = document.getElementById('dashboardModal');
  const win = modal?.querySelector('.modal-win');
  if (modal && win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
  }

  // วาดแผนภูมิหลังจาก Modal แสดงผลแล้ว
  setTimeout(() => {
    _renderCategoryBarChart(pkgCount, nonPkgCount);
    _renderSourcePieChart(sourceStats);
  }, 100);
}

/**
 * ฟังก์ชันวาด Pie Chart สำหรับ Dashboard
 */
function _renderSourcePieChart(sourceStats) {
  const canvas = document.getElementById('chart-source-pie');
  if (!canvas) return;

  if (_dbSourceChart) _dbSourceChart.destroy();

  const labels = Object.keys(sourceStats);
  const closedData = labels.map(s => sourceStats[s].closed);
  
  _dbSourceChart = new Chart(canvas.getContext('2d'), {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: closedData,
        backgroundColor: ['#0f6e56', '#185FA5', '#BA7517', '#D4537E', '#7F77DD', '#D85A30', '#64748b'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { family: 'Sarabun', size: 11 }, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const src = labels[item.dataIndex];
              const stats = sourceStats[src];
              const rate = stats.total ? ((stats.closed / stats.total) * 100).toFixed(1) : 0;
              return ` ปิดการขาย: ${item.raw} ราย (Conv. Rate: ${rate}%)`;
            }
          }
        }
      }
    }
  });
}

/**
 * ฟังก์ชันวาด Bar Chart สำหรับหมวดหมู่งาน (Package vs Non-Package)
 */
function _renderCategoryBarChart(pkgCount, nonPkgCount) {
  const canvas = document.getElementById('chart-category-bar');
  if (!canvas) return;

  if (_dbCategoryChart) _dbCategoryChart.destroy();

  _dbCategoryChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Package (งานมาตรฐาน)', 'Non-Package (งานพิเศษ)'],
      datasets: [{
        label: 'จำนวน Lead',
        data: [pkgCount, nonPkgCount],
        backgroundColor: ['#185FA5', '#f59e0b'],
        borderRadius: 8,
        barThickness: 50
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = pkgCount + nonPkgCount;
              const pct = total ? ((item.raw / total) * 100).toFixed(1) : 0;
              return ` จำนวน: ${item.raw} ราย (${pct}%)`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { family: 'Sarabun' } },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Sarabun', weight: '700' } }
        }
      }
    }
  });
}


/**
 * อ่านข้อมูลจาก Lead และส่งไปยังฟังก์ชัน Export PDF ใน user-script.js
 */
function exportCustomerQuotePDF_FromAdmin(idx) {
  const lead = adminLeadsData[idx];
  if (!lead || typeof exportCustomerQuotePDF !== 'function') return;
  
  // แมปชื่อตัวแปรให้ตรงกับที่ getSingleQuoteHTML ใน user-script.js ต้องการ
  const pdfData = {
    ...lead,
    customer: lead.name,
    sumInsured: lead.sum
  };
  exportCustomerQuotePDF(pdfData);
}

/**
 * คัดลอกข้อความลง Clipboard พร้อมแจ้งเตือน
 */
function copyToClipboard(text, successMsg) {
  const fallbackCopy = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      if (successMsg) alert(successMsg);
    } catch (err) {
      console.error('Failed to copy:', err);
    } finally {
      textarea.remove();
    }
  };

  if (!navigator.clipboard?.writeText) {
    fallbackCopy();
    return;
  }

  navigator.clipboard.writeText(text)
    .then(() => { if (successMsg) alert(successMsg); })
    .catch(() => fallbackCopy());
}

/**
 * เปิดหน้าต่างเลือกช่องทางส่งใบเสนอราคา (Share Modal)
 */
function openShareModal(idx) {
  const lead = adminLeadsData[idx];
  if (!lead) return;

  // สร้าง Web Link (Online Quote)
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/admin\.html$/, '/index.html');
  const quoteData = { ...lead, customer: lead.name, sumInsured: lead.sum };
  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(quoteData))));
  const webLink = `${baseUrl}?quote=${encodedData}`;

  // สร้างข้อความรายละเอียดเบื้องต้นสำหรับส่งให้ลูกค้า
  const msg = `เรียน คุณ${lead.name}\n\nทาง TTIB ขอส่งรายละเอียดแผนประกันภัย ${lead.plan}\n- ทุนประกัน: ${lead.sum} บาท\n- เบี้ยประกันภัย: ${lead.premium} บาท/ปี\n\nดูรายละเอียดใบเสนอราคาออนไลน์ได้ที่นี่:\n${webLink}\n\nขอบคุณครับ\nฝ่ายขาย TTIB`;
  
  const encodedMsg = encodeURIComponent(msg);
  const phone = (lead.phone || '').replace(/[^0-9]/g, '');
  const waPhone = phone.startsWith('0') ? '66' + phone.substring(1) : phone;

  const overlay = document.createElement('div');
  overlay.id = 'share-lead-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="modal-win" style="max-width:450px; width:100%; border-radius:20px; overflow:hidden; box-shadow: var(--sh-lg); border: 1px solid #e2e8f0; background:#fff;">
      <div class="m-header" style="background:#fff; border-bottom:1px solid #f1f5f9; padding:16px 20px; display:flex; justify-content:space-between; align-items:center;">
        <h2 style="font-size:16px; font-weight:800; color:#1e293b; margin:0;"><i class="ti ti-share" style="color:#f97316;"></i> ส่งข้อมูลใบเสนอราคา</h2>
        <span onclick="this.closest('#share-lead-overlay').remove()" style="cursor:pointer; font-size:24px; color:#94a3b8; line-height:1;">&times;</span>
      </div>
      <div class="m-body" style="padding:24px;">
        <div style="background:#f8fafc; border-radius:12px; padding:15px; margin-bottom:20px; border:1px solid #e2e8f0;">
          <div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">ตัวอย่างข้อความที่ส่ง</div>
          <div style="font-size:13px; color:#475569; white-space:pre-wrap; line-height:1.6;">${escapeHtml(msg)}</div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <a href="https://line.me/R/msg/text/?${encodedMsg}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#06C755; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-brand-line" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">LINE</span>
          </a>
          <a href="https://wa.me/${waPhone}?text=${encodedMsg}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#25D366; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-brand-whatsapp" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">WhatsApp</span>
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(webLink)}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#1877F2; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-brand-facebook" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Facebook</span>
          </a>
          <a href="mailto:${lead.email || ''}?subject=${encodeURIComponent('ใบเสนอราคาประกันภัย - TTIB')}&body=${encodedMsg}" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#ef4444; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-mail" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Email</span>
          </a>
          <button id="copy-message-btn" data-message="" style="border:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; background:#64748b; color:#fff; border-radius:12px; transition:transform 0.2s; font-family:inherit;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-copy" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">คัดลอกข้อความ</span>
          </button>
          <button id="copy-weblink-btn" data-link="${webLink}" style="border:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; background:#185FA5; color:#fff; border-radius:12px; transition:transform 0.2s; grid-column: span 2;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-link" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">คัดลอกลิงก์ใบเสนอราคา (Web Link)</span>
          </button>
        </div>
        <p style="margin-top:20px; font-size:11px; color:#94a3b8; text-align:center; line-height:1.5;">* หมายเหตุ: คุณต้องทำการดาวน์โหลดไฟล์ PDF จากหน้าแสดงผล และแนบส่งไฟล์ให้ลูกค้าแยกต่างหากในแอปแชท</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const copyMessageBtn = document.getElementById('copy-message-btn');
  if (copyMessageBtn) copyMessageBtn.dataset.message = msg;
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });

  // ผูก Event Listener สำหรับปุ่มคัดลอกข้อความ
  if (copyMessageBtn) {
    copyMessageBtn.addEventListener('click', () => {
      copyToClipboard(copyMessageBtn.dataset.message, 'คัดลอกข้อความสำเร็จ! ท่านสามารถนำไปวางในแชท Facebook หรือแอปอื่นๆ ได้ทันที');
    });
  }
  // ผูก Event Listener สำหรับปุ่มคัดลอกลิงก์
  const copyWeblinkBtn = document.getElementById('copy-weblink-btn');
  if (copyWeblinkBtn) {
    copyWeblinkBtn.addEventListener('click', () => {
      copyToClipboard(copyWeblinkBtn.dataset.link, 'คัดลอกลิงก์ใบเสนอราคาออนไลน์สำเร็จ!');
    });
  }
}

// =============================================================================
// ADD PACKAGE MODAL
// =============================================================================

function openAddPackageModal() {
  const modal = document.getElementById('addPackageModal');
  if (!modal) return;
  
  // ล้างข้อมูลเดิมในฟอร์มก่อนเปิด (Improvement)
  const form = document.getElementById('add-package-form');
  if (form) form.reset();

  // คืนค่าปุ่มเลือกบริษัททั้งหมดเป็นสถานะเริ่มต้น
  const toggleBtn = document.getElementById('btn-toggle-all-comp');
  if (toggleBtn) {
    toggleBtn.textContent = 'เลือกทั้งหมด';
    toggleBtn.onclick = () => toggleAllAddCompanies(true);
    toggleBtn.style.color = '';
  }

  _populateAddPackageLists();
  modal.classList.add('active');

  // ปรับแต่ง Modal เพิ่มแผนประกันใหม่ให้เต็มหน้าจอ
  const win = modal.querySelector('.modal-win');
  if (win) {
    modal.style.padding = '0';
    Object.assign(win.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0'
    });
  }
}

function closeAddPackageModal() {
  _closeModal('addPackageModal');
}

/**
 * เลือก/ยกเลิกเลือก บริษัทประกันทั้งหมดในหน้าเพิ่มแผนประกัน
 */
function toggleAllAddCompanies(checked) {
  const checkboxes = document.querySelectorAll('.add-comp-chk');
  checkboxes.forEach(cb => cb.checked = checked);
  
  const btn = document.getElementById('btn-toggle-all-comp');
  if (btn) {
    if (checked) {
      btn.textContent = 'ล้างทั้งหมด';
      btn.onclick = () => toggleAllAddCompanies(false);
      btn.style.color = '#ef4444'; // สีแดงสำหรับคำสั่งล้างข้อมูล
    } else {
      btn.textContent = 'เลือกทั้งหมด';
      btn.onclick = () => toggleAllAddCompanies(true);
      btn.style.color = ''; // กลับไปใช้สีหลักจาก CSS
    }
  }
}

function _populateAddPackageLists() {
  // สร้างรายการ Checkbox บริษัทประกันจากค่าสีที่กำหนดไว้ใน user-script.js
  const compBody = document.getElementById('add-company-list');
  if (compBody && typeof COMPANY_COLORS !== 'undefined') {
    const companies = Object.keys(COMPANY_COLORS);
    compBody.innerHTML = companies.map(c => `
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; background:#fff; padding:6px 12px; border:1px solid #e2e8f0; border-radius:10px; transition:var(--transition-smooth); white-space:nowrap;" onmouseover="this.style.borderColor='#4258d3'" onmouseout="this.style.borderColor='#e2e8f0'">
        <input type="checkbox" class="add-comp-chk" value="${c}" style="width:16px; height:16px; cursor:pointer; accent-color:${COMPANY_COLORS[c]}">
        <span style="font-size:13px; font-weight:700; color:${COMPANY_COLORS[c]};">${c}</span>
      </label>
    `).join('');
  }

  // สร้างรายการ Auto-complete สำหรับบริษัทอื่นๆ โดยดึงจากฐานข้อมูลที่มีอยู่
  const customDataList = document.getElementById('all-companies-list');
  if (customDataList && typeof allBusinessMappings !== 'undefined') {
    const existingCompanies = [...new Set(allBusinessMappings.map(m => m.company))]
      .filter(c => c && !Object.keys(COMPANY_COLORS || {}).includes(c.toUpperCase())) // กรองบริษัทที่มี Checkbox อยู่แล้วออก
      .sort();
    customDataList.innerHTML = existingCompanies.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  // Coverage (หลัก)
  const covBody = document.getElementById('add-coverage-list-body');
  if (covBody) {
    const topics = window.coverageTopics || [];
    covBody.innerHTML = topics.map((t, i) =>
      `<div class="add-item" data-name="${escapeHtml(t.name)}">
        <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:6px;cursor:pointer;">
          <input type="checkbox" id="add-cov-${i}" value="${escapeHtml(t.name)}" style="width:15px;height:15px;accent-color:#1D9E75;cursor:pointer;">
          <span style="font-size:13px;color:#334155;">${escapeHtml(t.name)}</span>
          <input type="text" placeholder="ระบุค่า..." style="margin-left:auto;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;width:160px;font-family:'Sarabun',sans-serif;" id="add-cov-val-${i}">
        </label>
      </div>`
    ).join('');
  }

  // Mark
  const markBody = document.getElementById('add-mark-list')?.querySelector('.add-section-body');
  if (markBody && rawMarkData && rawMarkData.length > 3) {
    const markTopics = rawMarkData.slice(3).map(r => String(r?.[0] || '').trim()).filter(Boolean);
    markBody.innerHTML = markTopics.map((t, i) =>
      `<div class="add-item" data-name="${escapeHtml(t)}">
        <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:6px;cursor:pointer;">
          <input type="checkbox" id="add-mark-${i}" value="${escapeHtml(t)}" style="width:15px;height:15px;accent-color:#185FA5;cursor:pointer;">
          <span style="font-size:13px;color:#334155;">${escapeHtml(t)}</span>
        </label>
      </div>`
    ).join('');
  }

  // Detail
  const detBody = document.getElementById('add-detail-list-body');
  if (detBody && globalDetailRows && globalDetailRows.length > 3) {
    const detTopics = globalDetailRows.slice(3).map(r => String(r?.[0] || '').trim()).filter(Boolean);
    detBody.innerHTML = detTopics.map((t, i) =>
      `<div class="add-item" data-name="${escapeHtml(t)}">
        <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:6px;cursor:pointer;">
          <input type="checkbox" id="add-det-${i}" value="${escapeHtml(t)}" style="width:15px;height:15px;accent-color:#BA7517;cursor:pointer;">
          <span style="font-size:13px;color:#334155;">${escapeHtml(t)}</span>
          <input type="text" placeholder="รายละเอียด..." style="margin-left:auto;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;width:200px;font-family:'Sarabun',sans-serif;" id="add-det-val-${i}">
        </label>
      </div>`
    ).join('');
  }
}

function filterAddModalList(inputEl, bodyId) {
  const s = inputEl.value.trim().toLowerCase();
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.querySelectorAll('.add-item').forEach(item => {
    const name = (item.dataset.name || '').toLowerCase();
    item.style.display = !s || name.includes(s) ? '' : 'none';
  });
}

async function saveNewPackage() {
  const get = (id) => document.getElementById(id)?.value?.trim() || '';
  const cat     = get('add-cat');
  const biz     = get('add-biz');
  const plan    = get('add-plan');
  const group   = get('add-group');
  const covType = get('add-covtype');
  const sum     = parseFloat(get('add-sum').replace(/,/g, ''));
  const premium = parseFloat(get('add-premium').replace(/,/g, ''));

  // รวบรวมบริษัทจาก Checkbox และจากช่องกรอก Manual
  let selectedCompanies = [...document.querySelectorAll('.add-comp-chk:checked')].map(cb => cb.value);
  const customComp = get('add-company-custom');
  if (customComp) {
    const customList = customComp.split(',').map(s => s.trim()).filter(Boolean);
    selectedCompanies = [...new Set([...selectedCompanies, ...customList])]; // Deduplicate
  }

  if (!cat || !biz || selectedCompanies.length === 0 || !plan) {
    alert('⚠️ กรุณากรอกข้อมูลที่จำเป็น (ประเภท, ธุรกิจ, เลือกอย่างน้อย 1 บริษัท, ชื่อแผน)');
    return;
  }
  if (!sum || !premium) {
    alert('⚠️ กรุณากรอกทุนประกันและเบี้ยประกัน');
    return;
  }

  // collect coverage values
  const covValues = {};
  document.querySelectorAll('[id^="add-cov-"]:not([id*="-val-"]):checked').forEach(chk => {
    const idx = chk.id.replace('add-cov-', '');
    const val = document.getElementById('add-cov-val-' + idx)?.value?.trim() || '✓';
    covValues[chk.value] = val;
  });

  const markValues = {};
  document.querySelectorAll('[id^="add-mark-"]:checked').forEach(chk => {
    markValues[chk.value] = '1';
  });

  const detailValues = {};
  document.querySelectorAll('[id^="add-det-"]:not([id*="-val-"]):checked').forEach(chk => {
    const idx = chk.id.replace('add-det-', '');
    const val = document.getElementById('add-det-val-' + idx)?.value?.trim() || '✓';
    detailValues[chk.value] = val;
  });

  const payload = {
    action: 'addPackage',
    category: cat, business: biz, companies: selectedCompanies, plan, group, covType,
    sumInsured: sum, premium,
    coverageValues: covValues,
    markValues,
    detailValues,
  };

  const btn = document.querySelector('#addPackageModal .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    alert('✅ บันทึกแผนใหม่สำเร็จ! กรุณา Refresh ข้อมูลเพื่อดูผล');
    closeAddPackageModal();
    setTimeout(() => loadExcelData(), 1500);
  } catch (e) {
    alert('❌ บันทึกไม่สำเร็จ กรุณาลองใหม่\n' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกแผนใหม่'; }
  }
}

// =============================================================================
// DELETE LEAD — ลบข้อมูลลูกค้า
// =============================================================================

async function deleteLead(leadIdx) {
  const lead = adminLeadsData[leadIdx];
  if (!lead) return;

  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลของ คุณ${lead.name}?\n(ธุรกิจ: ${lead.business})\n\n** ข้อมูลจะถูกลบออกจากระบบอย่างถาวร **`)) {
    return;
  }

  try {
    await _postToAppsScript({
      action: 'deleteLead',
      rowIndex: lead.rowIdx, // ใช้ค่า rowIdx ที่เป็นลำดับแถวจริงตรงๆ
    });
    alert('ลบข้อมูลสำเร็จ');
    await refreshLeads(); // โหลดข้อมูลใหม่เพื่อให้ UI ตรงกับ Spreadsheet
  } catch (e) {
    alert('ไม่สามารถลบข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
    console.error('[Admin] deleteLead failed:', e);
  }
}

// =============================================================================
// EDIT LEAD — แก้ไขข้อมูลลูกค้า
// =============================================================================

function openEditLeadModal(leadIdx) {
  const lead = adminLeadsData[leadIdx];
  if (!lead) return;

  // 1. แยกข้อมูลทรัพย์สินออกจาก Note (ดึงส่วนที่อยู่ในวงเล็บ [ทรัพย์สิน: ...])
  const assetMatch = (lead.note || '').match(/\[ทรัพย์สิน:\s*(.*?)\]/i);
  const assetStr   = assetMatch ? assetMatch[1] : '';
  
  const [fName, ...lNameParts] = (lead.name || '').trim().split(/\s+/);
  const lName = lNameParts.join(' ');

  // 2. ลบ tags พิเศษออกเพื่อให้เหลือแต่ข้อความหมายเหตุจริง ๆ ใน textarea
  const plainNote = (lead.note || '')
    .replace(/\[ทรัพย์สิน:.*?\]/gi, '')
    .replace(/\[source:.*?\]/gi, '')
    .trim();

  // 3. ดึงข้อมูลย่อย (เรียกใช้ parseAssetPart จาก user-script.js ที่โหลดไว้แล้ว)
  const insuredStatus = parseAssetPart(assetStr, 'สถานะ');
  const area          = parseAssetPart(assetStr, 'ทุนอาคาร').replace('บาท', '');
  const stock         = parseAssetPart(assetStr, 'ทรัพย์สินภายใน').replace('บาท', '');
  const equipment     = parseAssetPart(assetStr, 'เครื่องจักร').replace('บาท', ''); // สลับตามคำขอ
  const renovation    = parseAssetPart(assetStr, 'สต็อกสินค้า').replace('บาท', ''); // สลับตามคำขอ
  const staff         = parseAssetPart(assetStr, 'พนักงาน').replace('คน', '');
  const claimInfo     = parseAssetPart(assetStr, 'เคลม');
  const assetNote     = parseAssetPart(assetStr, 'หมายเหตุ');

  const overlay = document.createElement('div');
  overlay.id = 'edit-lead-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="modal-win" style="max-width:600px; width:100%; border-radius:20px; overflow:hidden; box-shadow: var(--sh-lg); border: 1px solid #e2e8f0;">
      <div class="m-header">
        <h2 style="font-size:17px; font-weight:800; color:#1e293b;"><i class="ti ti-edit" style="color:#4258d3;"></i> แก้ไขข้อมูลลูกค้า</h2>
        <span onclick="this.closest('#edit-lead-overlay').remove()" class="m-close">&times;</span>
      </div>
      
      <div class="m-body" style="background:#f8fafc; padding:24px;">
        
        <div class="cs-section-title">ข้อมูลพื้นฐานและแผน</div>
        <div class="cs-sum-grid" style="margin-bottom:16px;">
          <div class="cs-sum-card cs-sum-span2">
            <div class="cs-sum-lbl">ธุรกิจ</div>
            <input type="text" id="edit-biz" value="${escapeHtml(lead.business)}" class="fctrl" style="margin-top:4px; font-weight:700;">
          </div>
          <div class="cs-sum-card cs-sum-span2">
            <div class="cs-sum-lbl">ชื่อสถานประกอบการ / สาขา</div>
            <input type="text" id="edit-est-name" value="${escapeHtml(lead.establishmentName)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">ทุนประกัน</div>
            <input type="text" id="edit-sum" value="${escapeHtml(lead.sum)}" class="fctrl" style="margin-top:4px; color:#0F766E; font-weight:800;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">หมวดหมู่</div>
            <div class="cs-sum-val" style="margin-top:6px; font-weight:700; color:#4258d3; font-size:11px;">
               <span class="cs-tag" style="background:${(lead.category==='Non-Package'?'#fff7ed':'#f0fdf4')}; color:${(lead.category==='Non-Package'?'#c2410c':'#15803d')}; border:1px solid ${(lead.category==='Non-Package'?'#fdba74':'#86efac')}; padding:2px 8px; border-radius:6px; font-weight:700;">${escapeHtml(lead.category || 'Package')}</span>
            </div>
          </div>
        </div>

        <div class="cs-section-title">ข้อมูลติดต่อลูกค้า</div>
        <div class="cs-sum-grid">
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">ชื่อ</div>
            <input type="text" id="edit-fname" value="${escapeHtml(fName)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">นามสกุล</div>
            <input type="text" id="edit-lname" value="${escapeHtml(lName)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">เบอร์โทร</div>
            <input type="text" id="edit-phone" value="${escapeHtml(lead.phone)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">อีเมล</div>
            <input type="email" id="edit-email" value="${escapeHtml(lead.email)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">ช่วงเวลาที่สะดวก</div>
            <select class="fctrl" id="edit-time" style="margin-top:4px;">
              <option value="">-- เลือกเวลา --</option>
              <option value="สะดวกทั้งวัน" ${lead.time === 'สะดวกทั้งวัน' ? 'selected' : ''}>สะดวกทั้งวัน</option>
              <option value="09:00 - 12:00" ${lead.time === '09:00 - 12:00' ? 'selected' : ''}>09:00–12:00 (เช้า)</option>
              <option value="13:00 - 17:00" ${lead.time === '13:00 - 17:00' ? 'selected' : ''}>13:00–17:00 (บ่าย)</option>
              <option value="17:00 - 20:00" ${lead.time === '17:00 - 20:00' ? 'selected' : ''}>17:00–20:00 (เย็น)</option>
            </select>
          </div>
          <div class="cs-sum-card"></div>
        </div>

        <div class="cs-section-title" style="margin-top:14px;">ข้อมูลรายละเอียดทรัพย์สิน</div>
        <div class="cs-sum-grid" style="margin-bottom:16px;">
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">สถานะผู้ทำประกัน</div>
            <select id="edit-asset-status" class="fctrl" style="margin-top:4px; border-color:#e2e8f0;">
              <option value="-" ${insuredStatus === '-' ? 'selected' : ''}>ไม่ระบุ</option>
              <option value="เจ้าของ" ${insuredStatus === 'เจ้าของ' ? 'selected' : ''}>เจ้าของ</option>
              <option value="ผู้เช่า" ${insuredStatus === 'ผู้เช่า' ? 'selected' : ''}>ผู้เช่า</option>
            </select>
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">ทุนประกันภัยตัวอาคาร (บาท)</div>
            <input type="text" id="edit-asset-area" value="${escapeHtml(area)}" class="fctrl" style="margin-top:4px;" placeholder="เช่น 500,000">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">ทรัพย์สินภายในอาคาร (บาท)</div>
            <input type="text" id="edit-asset-stock" value="${escapeHtml(stock)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">เครื่องจักร ( บาท )</div>
            <input type="text" id="edit-asset-equipment" value="${escapeHtml(equipment)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">สต็อกสินค้า (บาท)</div>
            <input type="text" id="edit-asset-renovation" value="${escapeHtml(renovation)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card">
            <div class="cs-sum-lbl">จำนวนพนักงาน</div>
            <input type="text" id="edit-asset-staff" value="${escapeHtml(staff)}" class="fctrl" style="margin-top:4px;">
          </div>
          <div class="cs-sum-card cs-sum-span2">
            <div class="cs-sum-lbl">ประวัติการเคลม / หมายเหตุทรัพย์สิน</div>
            <input type="text" id="edit-asset-claim" value="${escapeHtml(claimInfo)}${assetNote !== '-' ? ' | ' + assetNote : ''}" class="fctrl" style="margin-top:4px;">
          </div>
        </div>

        <div class="cs-section-title">ที่อยู่</div>
        <div class="cs-sum-card" style="width:100%; margin-bottom:16px;">
          <textarea id="edit-address" rows="2" class="fctrl" style="margin-top:4px; resize:vertical; font-size:13px; border-color:#e2e8f0;">${escapeHtml(lead.address)}</textarea>
        </div>

        <div class="cs-section-title">บันทึกเพิ่มเติมจากลูกค้า (Notes)</div>
        <div class="cs-sum-card" style="width:100%;">
          <textarea id="edit-note" rows="3" class="fctrl" style="margin-top:4px; resize:vertical; font-size:13px; border-color:#e2e8f0;">${escapeHtml(plainNote)}</textarea>
        </div>

      </div>

      <div class="m-footer" style="justify-content:flex-end; gap:10px;">
        <button onclick="this.closest('#edit-lead-overlay').remove()" class="btn-cancel">
          ยกเลิก
        </button>
        <button type="button" onclick="copyCustomerDataToClipboard(${leadIdx})" class="btn-cancel" style="background:#f0f9ff; border-color:#bae6fd; color:#0369a1;">
          <i class="ti ti-copy"></i> คัดลอกข้อมูล
        </button>
        <button id="btn-save-edit" onclick="saveEditedLead(${leadIdx}, this)" class="btn-submit">
          💾 บันทึกการแก้ไข
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

/**
 * คัดลอกข้อมูลลูกค้า (ชื่อ, เบอร์, อีเมล) ไปยัง Clipboard
 */
function copyCustomerDataToClipboard(leadIdx) {
  const lead = adminLeadsData[leadIdx];
  if (!lead) return;
  const dataToCopy = `ชื่อ: ${lead.name}\nเบอร์โทร: ${lead.phone}\nอีเมล: ${lead.email || '-'}`;
  copyToClipboard(dataToCopy, 'คัดลอกข้อมูลลูกค้าสำเร็จ!');
}

async function saveEditedLead(leadIdx, btn) {
  const lead = adminLeadsData[leadIdx];
  if (!lead) return;

  // 1. รวมข้อมูลทรัพย์สินกลับเป็น String รูปแบบ Tag [ทรัพย์สิน: ...]
  const assetParts = [
    `สถานะ:${document.getElementById('edit-asset-status').value || '-'}`,
    `ทุนอาคาร:${document.getElementById('edit-asset-area').value || '-'}บาท`,
    `ทรัพย์สินภายใน:${document.getElementById('edit-asset-stock').value || '-'}บาท`,
    `เครื่องจักร:${document.getElementById('edit-asset-equipment').value || '-'}บาท`,
    `สต็อกสินค้า:${document.getElementById('edit-asset-renovation').value || '-'}บาท`,
    `พนักงาน:${document.getElementById('edit-asset-staff').value || '-'}คน`,
    `เคลม:${document.getElementById('edit-asset-claim').value || '-'}`
  ].join(' | ');

  // 2. ประกอบ Note ใหม่ (ข้อความ + [ทรัพย์สิน: ...] + Tags การตลาดเดิม)
  const plainNoteContent = document.getElementById('edit-note').value.trim();
  const finalNoteParts = [
    plainNoteContent,
    `[ทรัพย์สิน: ${assetParts}]`,
    lead.source ? `[source: ${lead.source}]` : '',
  ].filter(Boolean);

  const finalNote = finalNoteParts.join(' ');
  const fullName = `${document.getElementById('edit-fname').value.trim()} ${document.getElementById('edit-lname').value.trim()}`.trim();
  
  // ประกอบที่อยู่กลับโดยรวม Establishment Name เข้าไปข้างหน้า (ถ้ามี)
  const newEstName = document.getElementById('edit-est-name').value.trim();
  const rawAddr = document.getElementById('edit-address').value.trim();
  let finalAddr = rawAddr;
  if (newEstName && newEstName !== '-' && !lead.isMultiLocation) {
    // ตรวจสอบว่าในที่อยู่ใหม่มีชื่อสถานประกอบการอยู่แล้วหรือไม่ เพื่อป้องกันการใส่ซ้ำ
    if (!rawAddr.startsWith(newEstName)) {
      finalAddr = newEstName + ' ' + rawAddr;
    }
  } else if (lead.isMultiLocation) {
    finalAddr = '[หลายสถานที่ประกอบการ] ' + rawAddr;
  }

  const newData = {
    name:     fullName,
    phone:    document.getElementById('edit-phone').value.trim(),
    email:    document.getElementById('edit-email').value.trim(),
    business: document.getElementById('edit-biz').value.trim(),
    sum:      document.getElementById('edit-sum').value.trim(),
    time:     document.getElementById('edit-time').value.trim(),
    address:  finalAddr,
    establishmentName: lead.isMultiLocation ? 'หลายสถานที่ประกอบการ' : (newEstName || '-'),
    isMultiLocation: lead.isMultiLocation,
    note:     finalNote,
  };

  if (!newData.name || !newData.phone) {
    alert('กรุณากรอกชื่อและเบอร์โทรศัพท์');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ กำลังบันทึก...';

  try {
    await _postToAppsScript({
      action: 'editLead',
      rowIndex: lead.rowIdx, // ใช้ค่า rowIdx ที่เป็นลำดับแถวจริงตรงๆ
      ...newData
    });
    
    // อัปเดตข้อมูลในตัวแปรโลคอลทันทีไม่ต้องรอรีโหลด
    Object.assign(lead, newData);
    
    document.getElementById('edit-lead-overlay').remove();
    updateAdminQuickStats();
    alert('แก้ไขข้อมูลเรียบร้อยแล้ว');
  } catch (e) {
    alert('ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
    btn.disabled = false;
    btn.textContent = '💾 บันทึกการแก้ไข';
    console.error('[Admin] saveEditedLead failed:', e);
  }
}

// =============================================================================
// UPDATE LEAD STATUS — เปลี่ยนสถานะ
// =============================================================================

let statusChangeLog = [];

async function updateLeadStatus(leadIdx, newStatus, selectEl) {
  const lead = adminLeadsData[leadIdx];
  if (!lead) return;

  const oldStatus = lead.status;
  const now = new Date();
  lead.status = newStatus;
  lead.statusUpdatedAt = now;
  statusChangeLog.push({
    leadIdx: leadIdx,
    name: lead.name,
    oldStatus: oldStatus,
    newStatus: newStatus,
    timestamp: now
  });
  if (statusChangeLog.length > 50) {
    statusChangeLog = statusChangeLog.slice(-50);
  }
  updateAdminQuickStats();

  // ถ้าปิดการขาย — สร้างเลขกรมธรรม์อัตโนมัติ
if (newStatus === CRM_STATUSES.CLOSED && !lead.policyNo) {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    let year = now.getFullYear() + 543;
    const yearBE = String(year).slice(-2);
    const closedLeads = adminLeadsData.filter(l => l.status === CRM_STATUSES.CLOSED);
    const nextNum = String(closedLeads.length + 1).padStart(5, '0');
    const pNo = `SME-${month}-${yearBE}-${nextNum}`;
    const pDate = prompt(`วันที่คุ้มครองเริ่มต้น (YYYY-MM-DD):`) || '';
    let rDate = '';
    if (pDate) {
      const pDateObj = new Date(pDate);
      if (!isNaN(pDateObj.getTime())) {
        const rDateObj = new Date(pDateObj.getFullYear() + 1, pDateObj.getMonth(), pDateObj.getDate());
        rDate = rDateObj.toISOString().split('T')[0];
      } else {
        console.error('Invalid date format:', pDate);
        return;
      }
      const dateRegex = /^(?:\d{4}-)?(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;
      if (!dateRegex.test(pDate)) {
        console.error('Invalid date format:', pDate);
        return;
      }
    }
    lead.policyNo    = pNo;
    lead.policyDate  = pDate;
    lead.renewalDate = rDate;
  }
  try {
    await _postToAppsScript({
      action: 'updateStatus',
      rowIndex: lead.rowIdx,   // ใช้ค่า rowIdx ที่เป็นลำดับแถวจริงตรงๆ
      status: newStatus,
      policyNo:    lead.policyNo    || '',
      policyDate:  lead.policyDate  || '',
      renewalDate: lead.renewalDate || '',
    });
    if (typeof showAdminToast === 'function') {
      showAdminToast(`อัปเดตสถานะเป็น "${newStatus}" สำเร็จ`, 'success');
    }
  } catch (e) {
    lead.status = oldStatus;
    if (selectEl) {
      selectEl.value = oldStatus;
      const c = STATUS_COLORS[oldStatus] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
      selectEl.style.backgroundColor = c.bg;
      selectEl.style.color = c.text;
      selectEl.style.borderColor = c.border;
    }
    updateAdminQuickStats();
    if (typeof showAdminToast === 'function') {
      showAdminToast('เกิดข้อผิดพลาดในการอัปเดตสถานะ', 'error');
    }
    console.error('[Admin] updateLeadStatus failed:', e);
  }
}
// =============================================================================
// REFRESH LEADS
// =============================================================================

async function refreshLeads() {
  const btn = document.querySelector('[onclick="refreshLeads()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-refresh"></i> กำลังโหลด...'; }
  // เปลี่ยนมาใช้ fetchLeadsDirectly เพื่อดึงข้อมูลผ่าน API ที่รวดเร็วกว่า
  await fetchLeadsDirectly();
  updateAdminQuickStats();
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> รีเฟรช'; }
}

// =============================================================================
// EXPORT LEADS EXCEL
// =============================================================================

function exportLeadsExcel() {
  if (!adminLeadsData.length) { alert('⚠️ ไม่มีข้อมูล Leads'); return; }

  const headers = [
    'วันที่', 'ประเภท', 'ธุรกิจ', 'ชื่อสถานประกอบการ', 'ชื่อลูกค้า', 'เบอร์โทร', 'อีเมล', 
    'ทุนประกันหลัก', 'เบี้ยประกัน', 'สถานะผู้ทำประกัน', 
    'ทุนอาคาร (บาท)', 'สินค้า/สต็อก (บาท)', 'เครื่องจักร (บาท)', 'ตกแต่ง (บาท)', 'พนักงาน (คน)', 
    'บริษัท', 'แผน', 'กลุ่ม', 'ประเภทคุ้มครอง', 
    'เวลาสะดวก', 'ที่อยู่', 'หมายเหตุ', 'สถานะ', 
    'เลขกรมธรรม์', 'วันคุ้มครอง', 'วันต่ออายุ'
  ];

  const rows = adminLeadsData.map(l => [
    l.timestamp, l.category, l.business, l.establishmentName || '-', l.name, l.phone, l.email, l.sum, l.premium,
    l.insuredStatus || '-', l.area || '-', l.stock || '-', l.equipment || '-', l.renovation || '-', l.staff || '-',
    l.company, l.plan, l.group, l.covType, l.time, l.address,
    l.note, l.status, l.policyNo, l.policyDate, l.renewalDate,
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => ({ wch: [12,12,20,25,18,14,20,15,12,15,14,15,14,14,12,12,20,12,15,12,30,30,12,14,12,12][i] || 15 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `TTIB_Leads_${date}.xlsx`);
}

function exportNonPackageExcel() {
  const leads = adminLeadsData.filter(l => l.category === 'Non-Package');
  if (!leads.length) { alert('⚠️ ไม่มีข้อมูล Non-Package Leads'); return; }

  const headers = [
    'วันที่', 'ประเภท', 'ธุรกิจ', 'ชื่อสถานประกอบการ', 'ชื่อลูกค้า', 'เบอร์โทร', 'อีเมล',
    'ทุนประกันหลัก', 'เบี้ยประกัน', 'สถานะผู้ทำประกัน',
    'ทุนอาคาร (บาท)', 'สินค้า/สต็อก (บาท)', 'เครื่องจักร (บาท)', 'ตกแต่ง (บาท)', 'พนักงาน (คน)',
    'เวลาสะดวก', 'ที่อยู่', 'หมายเหตุ', 'สถานะ',
    'เลขกรมธรรม์', 'วันคุ้มครอง', 'วันต่ออายุ'
  ];

  const rows = leads.map(l => [
    l.timestamp, l.category, l.business, l.establishmentName || '-', l.name, l.phone, l.email, l.sum, l.premium,
    l.insuredStatus || '-', l.area || '-', l.stock || '-', l.equipment || '-', l.renovation || '-', l.staff || '-',
    l.time, l.address, l.note, l.status, l.policyNo, l.policyDate, l.renewalDate
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => ({ wch: [12,12,20,25,18,14,20,15,12,15,14,15,14,14,12,12,30,30,12,14,12,12][i] || 15 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Non-Package Leads');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `TTIB_NonPackage_${date}.xlsx`);
}

function exportLeadsToExcel() {
  exportLeadsExcel();
}

// =============================================================================
// DASHBOARD PDF
// =============================================================================

function exportDashboardPDF() {
  const win = window.open('', '_blank');
  if (!win) { alert('❌ Browser บล็อก popup'); return; }
  const counts  = _countByStatus();
  const total   = adminLeadsData.length;
  const closed  = counts[CRM_STATUSES.CLOSED] || 0;
  const convRate= total ? ((closed / total) * 100).toFixed(1) : '0.0';
  const totalPrem = adminLeadsData
    .filter(l => l.status === CRM_STATUSES.CLOSED)
    .reduce((s, l) => s + (parseFloat(String(l.premium || '').replace(/[^0-9.]/g, '')) || 0), 0);
  const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
    <title>รายงานสถิติ TTIB</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:'Sarabun',sans-serif;color:#0f172a;background:#fff;padding:20px}
    .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
    .stat{border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center}
    .stat-val{font-size:32px;font-weight:800;color:#0f6e56}.stat-lbl{font-size:12px;color:#64748b}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th{background:#f8fafc;padding:9px 12px;text-align:left;border-bottom:2px solid #e2e8f0;font-weight:800}
    td{padding:9px 12px;border-bottom:1px solid #f1f5f9}
    .btn{position:fixed;top:16px;right:16px;background:#0f172a;color:#fff;padding:10px 20px;border-radius:30px;border:none;cursor:pointer;font-weight:700;}
    @media print{.btn{display:none}}</style></head><body>
    <button class="btn" onclick="window.print()">🖨️ พิมพ์</button>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
      <img src="${AGENCY_LOGO}" style="height:55px;">
      <div><h1 style="margin:0;font-size:20px;">รายงานสรุปผลการดำเนินงาน</h1>
      <div style="font-size:12px;color:#64748b;">TTIB Insurance Broker · ณ วันที่ ${today}</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">รับ Lead ทั้งหมด</div></div>
      <div class="stat"><div class="stat-val">${closed}</div><div class="stat-lbl">ปิดการขาย</div></div>
      <div class="stat"><div class="stat-val">${convRate}%</div><div class="stat-lbl">อัตราปิดการขาย</div></div>
      <div class="stat"><div class="stat-val">${counts[CRM_STATUSES.PENDING]||0}</div><div class="stat-lbl">รอติดต่อ</div></div>
      <div class="stat"><div class="stat-val">${counts[CRM_STATUSES.CONTACTED]||0}</div><div class="stat-lbl">ติดต่อแล้ว</div></div>
      <div class="stat"><div class="stat-val" style="font-size:22px;">${fmt(totalPrem)} บาท</div><div class="stat-lbl">เบี้ยรวม (ปิดการขาย)</div></div>
    </div>
    <h3>รายการลูกค้าทั้งหมด</h3>
    <table><thead><tr><th>วันที่</th><th>ลูกค้า</th><th>ธุรกิจ</th><th>บริษัทประกัน</th><th>ทุน</th><th>สถานะ</th></tr></thead>
    <tbody>${adminLeadsData.map(l => `<tr>
      <td>${escapeHtml(l.timestamp)}</td>
      <td>${escapeHtml(l.name)}<br><span style="color:#64748b;font-size:11px;">${escapeHtml(l.phone)}</span></td>
      <td>${escapeHtml(l.business)}</td>
      <td>${escapeHtml(l.company)}</td>
      <td>${escapeHtml(l.sum)}</td>
      <td>${escapeHtml(l.status)}</td>
    </tr>`).join('')}</tbody></table>
    <div style="margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;">เอกสารนี้จัดทำโดยระบบ TTIB CRM · ${today}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),${PRINT_DELAY});<\/script>
    </body></html>`);
  win.document.close();
}

// =============================================================================
// INTERNAL POST HELPER
// =============================================================================

async function _postToAppsScript(payload, retries = 2) {
  if (!navigator.onLine) {
    alert('❌ คุณกำลังออฟไลน์ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
    throw new Error('Offline');
  }

  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    
    try {
      const resp = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      
      clearTimeout(tid);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      
      let result;
      try {
        result = await resp.json();
      } catch (e) {
        return resp; // Return raw response if not JSON
      }
      
      if (result && result.status === 'error') {
        throw new Error(result.message || 'บันทึกข้อมูลไม่สำเร็จ');
      }
      
      return result;
    } catch (err) {
      clearTimeout(tid);
      if (i === retries) {
        console.error('[Admin] POST failed after retries:', err);
        throw err;
      }
      console.warn(`[Admin] Retry ${i + 1}/${retries} due to: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000)); // รอ 1 วินาทีก่อน retry
    }
  }
}

// =============================================================================
// DASHBOARD QUICK SEARCH
// =============================================================================

let _activeSearchStatus = 'all';

/**
 * เปลี่ยนสถานะการกรองในหน้าค้นหาด่วน
 */
function filterDashboardSearchByStatus(status) {
  _activeSearchStatus = status;
  const query = document.getElementById('admin-dashboard-search')?.value || '';
  dashboardQuickSearch(query);
}

/**
 * ค้นหาข้อมูลลูกค้าจากหน้า Dashboard โดยไม่ต้องเปิด Modal
 */
function dashboardQuickSearch(query, page = 1, startDateVal = document.getElementById('admin-search-start')?.value, endDateVal = document.getElementById('admin-search-end')?.value, activeStatus = _activeSearchStatus) {
  const container = document.getElementById('admin-search-results');
  const statsGrid = document.getElementById('admin-quick-stats');
  const placeholder = document.getElementById('admin-dashboard-placeholder');
  
  _activeSearchStatus = activeStatus || 'all';
  const s = String(query || '').trim().toLowerCase();
  
  if (!s && !startDateVal && !endDateVal) {
    _activeSearchStatus = 'all';
    container.style.display = 'none';
    statsGrid.style.display = 'grid';
    if (placeholder) placeholder.style.display = 'block';
    return;
  }
  
  let leads = adminLeadsData.map((l, i) => ({ ...l, _origIdx: i }));

  // 1. กรองด้วยข้อความ
  if (s) {
    leads = leads.filter(l => 
      l.name.toLowerCase().includes(s) || 
      l.establishmentName.toLowerCase().includes(s) || // เพิ่มการค้นหาจากชื่อสถานประกอบการ
      l.address.toLowerCase().includes(s) || // เพิ่มการค้นหาจากที่อยู่
      l.phone.includes(s) || 
      l.business.toLowerCase().includes(s)
    );
  }

  // 2. กรองด้วยช่วงวันที่ (อ้างอิงจาก timestamp ของ lead)
  if (startDateVal || endDateVal) {
    const startTs = startDateVal ? new Date(startDateVal).setHours(0, 0, 0, 0) : null;
    const endTs = endDateVal ? new Date(endDateVal).setHours(23, 59, 59, 999) : null;

    leads = leads.filter(l => {
      const lDate = _parseLeadTimestamp(l.timestamp);
      if (lDate === null) return false;
      if (startTs && lDate < startTs) return false;
      if (endTs && lDate > endTs) return false;
      return true;
    });
  }

  // คำนวณจำนวนแยกตามสถานะสำหรับปุ่ม Filter
  const filterBtnsHtml = ['all', ...Object.values(CRM_STATUSES)].map(st => {
    const label = st === 'all' ? 'ทั้งหมด' : st;
    const active = st === _activeSearchStatus;
    const count = leads.filter(l => st === 'all' || l.status === st).length;
    
    if (count === 0 && st !== 'all') return ''; 
    return `<button onclick="filterDashboardSearchByStatus('${escapeHtml(st)}')"
      style="padding:6px 14px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${active ? '#4258d3' : '#e2e8f0'};background:${active ? '#4258d3' : '#fff'};color:${active ? '#fff' : '#475569'};font-family:inherit;white-space:nowrap;transition:all 0.2s;">
      ${escapeHtml(label)} (${count})
    </button>`;
  }).join('');

  // กรองตามสถานะที่เลือก
  if (_activeSearchStatus !== 'all') {
    leads = leads.filter(l => l.status === _activeSearchStatus);
  }

  const escapedQuery = s.replace(/'/g, "\\'");
  const escapedStart = String(startDateVal || '').replace(/'/g, "\\'");
  const escapedEnd = String(endDateVal || '').replace(/'/g, "\\'");
  const escapedStatus = String(_activeSearchStatus || 'all').replace(/'/g, "\\'");
  const pageCb = `dashboardQuickSearch('${escapedQuery}', {PAGE}, '${escapedStart}', '${escapedEnd}', '${escapedStatus}')`;
    
  container.style.display = 'block';
  statsGrid.style.display = 'none';
  if (placeholder) placeholder.style.display = 'none';
  
  if (leads.length === 0) {
    container.innerHTML = `
      <div style="padding: 60px; text-align: center; color: #94a3b8;">
        <i class="ti ti-search-off" style="font-size: 40px; margin-bottom: 12px; opacity: 0.5;"></i>
        <p style="font-size: 15px; font-weight: 600;">ไม่พบข้อมูลที่ตรงกับ "${escapeHtml(s)}"</p>
      </div>`;
    return;
  }
  
  container.innerHTML = `
    <div style="padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom:12px;">
        <div style="font-size: 14px; font-weight: 800; color: #1e293b;">
          ผลการค้นหาด่วน: ${s ? `"${escapeHtml(s)}"` : 'ช่วงวันที่เลือก'} 
          <span style="font-weight:400; color:#64748b; margin-left:8px;">(${leads.length} รายการ)</span>
        </div>
        <button onclick="clearDashboardSearch()" style="background: none; border: none; color: #ef4444; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          <i class="ti ti-x"></i> ล้างการค้นหา
        </button>
      </div>
      <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;">
        ${filterBtnsHtml}
      </div>
    </div>
    <div style="overflow: auto; max-height: 600px; background: #fff;">
      ${_buildLeadTable(leads, 'Dashboard Search', '', null, page, pageCb)}
    </div>`;
}

function clearDashboardSearch() {
  const inp = document.getElementById('admin-dashboard-search');
  const start = document.getElementById('admin-search-start');
  const end = document.getElementById('admin-search-end');
  
  if (inp) inp.value = '';
  if (start) start.value = '';
  if (end) end.value = '';
  
  dashboardQuickSearch('');
}

// =============================================================================
// GROUP ACTION LOGIC
// =============================================================================

/**
 * เลือก/ยกเลิกเลือก ทั้งหมดในตารางที่กำลังแสดงผล
 */
function toggleSelectAllLeads(master) {
  const checkboxes = document.querySelectorAll('.lead-checkbox');
  checkboxes.forEach(cb => cb.checked = master.checked);
  updateGroupActionUI();
}

/**
 * อัปเดตการแสดงผลของแถบ Group Action
 */
function updateGroupActionUI() {
  const selected = document.querySelectorAll('.lead-checkbox:checked');
  const panel = document.getElementById('group-action-panel');
  const countEl = document.getElementById('selected-leads-count');
  
  if (!panel || !countEl) return;

  if (selected.length > 0) {
    panel.style.display = 'flex';
    countEl.textContent = selected.length;
  } else {
    panel.style.display = 'none';
    const master = document.getElementById('lead-check-all');
    if (master) master.checked = false;
  }
}

/**
 * ประมวลผลการเปลี่ยนสถานะแบบกลุ่ม
 */
async function applyBulkStatusUpdate(btn) {
  const selected = document.querySelectorAll('.lead-checkbox:checked');
  const newStatus = document.getElementById('bulk-status-select').value;
  if (!selected.length) return;

  if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น "${newStatus}" สำหรับลูกค้าจำนวน ${selected.length} รายหรือไม่?`)) return;

  btn.disabled = true;
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i class="ti ti-loader-2 ti-spin"></i> กำลังดำเนินการ...';
  let successCount = 0;

  for (const chk of selected) {
    const row = chk.closest('tr');
    const idx = parseInt(row.dataset.idx);
    const lead = adminLeadsData[idx];
    if (!lead) continue;

    const oldStatus = lead.status; // [FIX] เก็บสถานะเดิมไว้เผื่อต้อง rollback
    lead.status = newStatus; // optimistic update
    
    // UI Update FIX
    const selectEl = row.querySelector('select');
    if (selectEl) {
      selectEl.value = newStatus;
      const c = STATUS_COLORS[newStatus] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
      selectEl.style.backgroundColor = c.bg;
      selectEl.style.color = c.text;
      selectEl.style.borderColor = c.border;
    }

    try {
      await _postToAppsScript({
        action: 'updateStatus',
        rowIndex: lead.rowIdx,
        status: newStatus,
        // [FIX] รักษาข้อมูลกรมธรรม์เดิมไว้ แทนการส่งค่าว่างทับ
        policyNo:    lead.policyNo    || '',
        policyDate:  lead.policyDate  || '',
        renewalDate: lead.renewalDate || '',
      });
      successCount++;
    } catch (e) {
      lead.status = oldStatus; // [FIX] rollback หากบันทึกไม่สำเร็จ
      if (selectEl) {
        selectEl.value = oldStatus;
        const c = STATUS_COLORS[oldStatus] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
        selectEl.style.backgroundColor = c.bg;
        selectEl.style.color = c.text;
        selectEl.style.borderColor = c.border;
      }
      console.warn('[Admin] Bulk update failed for row', lead.rowIdx, e);
    }
  }

  if (successCount > 0 && typeof showAdminToast === 'function') {
    showAdminToast(`อัปเดตสถานะลูกค้า ${successCount} ราย เป็น "${newStatus}" สำเร็จ`, 'success');
  }

  updateAdminQuickStats();
  alert(`ดำเนินการเปลี่ยนสถานะเป็น "${newStatus}" เรียบร้อยแล้ว`);
  
  // Reset UI
  const master = document.getElementById('lead-check-all');
  if (master) master.checked = false;
  selected.forEach(cb => cb.checked = false);
  updateGroupActionUI();
  
  btn.disabled = false;
  btn.innerHTML = originalHTML;
}

// =============================================================================
// ADMIN LINKS
// =============================================================================
function openSourceSheet() {
  window.open(SOURCE_SHEET_URL, '_blank');
}

/**
 * เปิด Google Apps Script Backend ในแท็บใหม่
 */
function openAppsScriptBackend() {
  window.open(APPS_SCRIPT_EDIT_URL, '_blank');
}

/**
 * เปิดหน้า Execution Log ของ Apps Script ในแท็บใหม่
 */
function openAppsScriptExecutions() {
  window.open(APPS_SCRIPT_EXEC_URL, '_blank');
}

// =============================================================================
// DASHBOARD MAIN CHARTS
// =============================================================================

/**
  * วาดกราฟสรุปยอดขาย (ทุนประกันที่ปิดการขาย) ในหน้า Dashboard หลัก
  */
 function _updateDashboardCharts() {
   const canvas = document.getElementById('chart-dashboard-sales');
   if (!canvas) return;

   // กรองเฉพาะรายการที่ปิดการขาย (CLOSED)
   const closedLeads = adminLeadsData.filter(l => l.status === CRM_STATUSES.CLOSED);

   // เตรียมข้อมูล 6 เดือนล่าสุด
   const salesByMonth = {};
   const now = new Date();
   for (let i = 5; i >= 0; i--) {
     const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
     const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
     salesByMonth[key] = 0;
   }

   // รวมยอดทุนประกันแยกตามเดือน
    closedLeads.forEach(l => {
      const ts = _parseLeadTimestamp(l.timestamp);
      if (!ts) return;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (salesByMonth.hasOwnProperty(key)) {
        const sum = parseFloat(String(l.sum || '').replace(/[^0-9.]/g, '')) || 0;
        salesByMonth[key] += sum;
      }
    });

   const labels = Object.keys(salesByMonth).map(k => {
     const [yr, mo] = k.split('-');
     return ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(mo)-1];
   });
   const data = Object.values(salesByMonth);

   // คำนวณสถิติเพิ่มเติม
   const total = adminLeadsData.length;
   const closed = closedLeads.length;
   const convRate = total ? ((closed / total) * 100).toFixed(1) : '0.0';
   const totalSales = data.reduce((sum, v) => sum + v, 0);
   const avgSales = data.length > 0 ? Math.round(totalSales / data.length) : 0;
   
   // หาทุนประกันสูงสุด
   const maxSumInsured = closedLeads.length > 0 
     ? Math.max(...closedLeads.map(l => parseFloat(String(l.sum || '').replace(/[^0-9.]/g, '')) || 0))
     : 0;

   // อัปเดตสถิติใน UI
   _setQs('qs-avg-sales', avgSales > 0 ? fmt(avgSales) + ' บาท' : '—');
   _setQs('qs-conv-rate', convRate > 0 ? convRate + '%' : '—');
   _setQs('qs-max-premium', maxSumInsured > 0 ? fmt(maxSumInsured) + ' บาท' : '—');

   // แสดง/ซ่อน overlay ถ้าไม่มีข้อมูล
   const emptyOverlay = document.getElementById('dashboard-chart-empty');
   if (emptyOverlay) {
     emptyOverlay.style.display = closedLeads.length === 0 ? 'flex' : 'none';
   }

   if (_dashboardSalesChart) _dashboardSalesChart.destroy();

   _dashboardSalesChart = new Chart(canvas.getContext('2d'), {
     type: 'line',
     data: {
       labels: labels,
       datasets: [{
         label: 'ยอดทุนประกัน (บาท)',
         data: data,
         borderColor: '#4258d3',
         backgroundColor: 'rgba(66, 88, 211, 0.1)',
         borderWidth: 3,
         fill: true,
         tension: 0.4,
         pointBackgroundColor: '#fff',
         pointBorderColor: '#4258d3',
         pointBorderWidth: 2,
         pointRadius: 4,
         pointHoverRadius: 6
       }]
     },
     options: {
       responsive: true,
       maintainAspectRatio: false,
       plugins: {
         legend: { display: false },
         tooltip: {
           callbacks: {  label: (ctx) => ` ยอดทุนประกัน: ${ctx.raw.toLocaleString()} บาท`}
         }
       },
       scales: {
         y: {
           beginAtZero: true,
           grid: { color: '#f1f5f9' },
           ticks: { font: { family: 'Sarabun' }, callback: v => _fmtCompact(v) }
         },
         x: { grid: { display: false }, ticks: { font: { family: 'Sarabun', weight: '600' } } }
       }
     }
   });
 }

// =============================================================================
// EXPOSE GLOBAL FUNCTIONS FOR HTML ONCLICK
// =============================================================================
window.openTrackingModal       = openTrackingModal;
window.openContactedModal      = openContactedModal;
window.openClosedModal         = openClosedModal;
window.openHistoryModal        = openHistoryModal;
window.openFavoritesDashboardModal = openFavoritesDashboardModal; // [NEW]
window.openDashboardModal      = openDashboardModal;
window.openAddPackageModal     = openAddPackageModal;
window.openSourceSheet         = openSourceSheet;
window.openAppsScriptBackend   = openAppsScriptBackend;
window.openAppsScriptExecutions= openAppsScriptExecutions;
window.viewNonPackageLeads     = viewNonPackageLeads;
window.filterLeadsByTag        = filterLeadsByTag;
window.refreshLeads            = refreshLeads;
window.exportLeadsExcel        = exportLeadsExcel;
window.exportNonPackageExcel = exportNonPackageExcel;
window.exportDashboardPDF      = exportDashboardPDF;
window.toggleAllAddCompanies   = toggleAllAddCompanies;
window.closeAddPackageModal    = closeAddPackageModal;
window.saveNewPackage          = saveNewPackage;
window.dashboardQuickSearch    = dashboardQuickSearch;
window.filterDashboardSearchByStatus = filterDashboardSearchByStatus;
window.clearDashboardSearch    = clearDashboardSearch;
window.filterAddModalList      = filterAddModalList;
window.deleteLead              = deleteLead;
window.openEditLeadModal       = openEditLeadModal;
window.saveEditedLead          = saveEditedLead;
window.copyCustomerDataToClipboard = copyCustomerDataToClipboard;
window.updateLeadStatus        = updateLeadStatus;
window.exportCustomerQuotePDF_FromAdmin = exportCustomerQuotePDF_FromAdmin;
window.openShareModal          = openShareModal;
window.toggleSelectAllLeads    = toggleSelectAllLeads;
window.updateGroupActionUI     = updateGroupActionUI;
window.applyBulkStatusUpdate   = applyBulkStatusUpdate;
window.exportLeadsToExcel      = exportLeadsToExcel;
window.showAdminToast          = showAdminToast;
window.debugCheckParseLeads    = debugCheckParseLeads;

// =============================================================================
// TOAST NOTIFICATIONS & DEBUG
// =============================================================================
function debugCheckParseLeads() {
  if (!adminLeadsData || adminLeadsData.length === 0) {
    console.log('[Debug] adminLeadsData is empty. Nothing to check.');
    return;
  }
  
  let isSortedCorrect = true;
  const order = 'เก่าไปใหม่';
  
  for (let i = 0; i < adminLeadsData.length - 1; i++) {
    if (adminLeadsData[i].rowIdx >= adminLeadsData[i+1].rowIdx) {
      isSortedCorrect = false;
      break;
    }
  }

  console.log('--- [TTIB Debug: Data Integrity Check] ---');
  if (isSortedCorrect) {
    console.log(`✅ เรียงลำดับถูกต้อง: ข้อมูลเรียง${order} (rowIdx เรียงขึ้นตั้งแต่บนลงล่าง)`);
  } else {
    console.error(`❌ ข้อผิดพลาด: การเรียงลำดับผิดปกติ (คาดหวัง${order})`);
  }
  console.log(`📌 จำนวนรายการทั้งหมด: ${adminLeadsData.length}`);
  console.log(`📌 รายการบนสุด (เก่าสุด): rowIdx=${adminLeadsData[0].rowIdx}, ชื่อ=${adminLeadsData[0].name}`);
  console.log(`📌 รายการล่างสุด (ใหม่สุด): rowIdx=${adminLeadsData[adminLeadsData.length - 1].rowIdx}, ชื่อ=${adminLeadsData[adminLeadsData.length - 1].name}`);
  console.log('--------------------------------------------');
}
function showAdminToast(message, type = 'success') {
  let container = document.getElementById('admin-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-toast-container';
    container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const bgColor = type === 'success' ? '#10b981' : '#ef4444';
  const icon = type === 'success' ? 'ti-check' : 'ti-alert-circle';
  toast.style.cssText = `background: ${bgColor}; color: #fff; padding: 12px 20px; border-radius: 8px; font-family: 'Sarabun', sans-serif; font-size: 14px; font-weight: 600; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 8px; transform: translateX(120%); opacity: 0; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); min-width: 250px;`;
  
  toast.innerHTML = `<i class="ti ${icon}" style="font-size: 18px;"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
  });

  // Remove after 3.5 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}