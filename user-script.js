
const COMPANY_COLORS = {
  AAGI: "#1D9E75", BKI: "#378ADD", TMSTH: "#BA7517",
  CHUBB: "#D85A30", MSIG: "#7F77DD", TIP: "#D4537E"
};

const COMPANY_LOGOS = {
  AAGI:  "https://www.allianz.co.th/content/dam/onemarketing/azay/allianz-co-th/about-allianz-ayudhya/news-index/aagi-news/aetna-thailand-became-allianz-group/Azay-logo-W1520x510.jpg",
  BKI:   "https://www.innwhy.com/wp-content/uploads/2018/01/BKI-Logo.jpg",
  TMSTH: "https://www.ttib.co.th/wp-content/uploads/2025/01/d3a63128386b3bba292b33951ea54277.jpeg",
  CHUBB: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRC2X4zWILUoOENR3rotGIHzdVAaMZlwET7pg&s",
  MSIG:  "https://www.msig-thai.com/sites/msig_th_revamp/files/inline-images/msig_brand_new.jpg",
  TIP:   "https://play-lh.googleusercontent.com/sw2IuQKxW-mhBjCe3DzR5SaIQXSDhTSZ-SmWCSNRk1RRywNWXGcE6ldXCi1W6iblwo0T=w600-h300-pc0xffffff-pd"
};

const AGENCY_LOGO    = "https://www.ttib.co.th/wp-content/uploads/2024/12/TTIB-Ninja-Logo.webp";
const APPS_SCRIPT_URL= "https://script.google.com/macros/s/AKfycbx8V7IPOwRNcm8cylLogQ7WWSiRMqPgdEvF7dyr9aNLhBZf0xcmoZBH8_k5Wg5NQm8SQQ/exec";
const GOOGLE_SHEET_URL="https://docs.google.com/spreadsheets/d/e/2PACX-1vQlFYTlNWmXoNCgVTHfcIV-b3BOpYOby1MLdYhdNCSsLG64MHXMWZiVDPfKcOYSZFIzgQ_iEdjM_3VX/pub?output=xlsx";
const PRINT_DELAY    = 1000;

const SHEET_NAMES = {
  BIZ:      'ข้อมูลดึงออกมาใช้',
  PREMIUM:  'เบี้ยประกันทั้งหมด',
  MARK:     'หัวข้อคุ้มครอง (เครื่องหมาย)',
  DETAIL:   'หัวข้อคุ้มครอง (รายละเอียด)',
  ADDRESS:  'ที่อยู่',
};

// =============================================================================
// STATE
// =============================================================================

let allBusinessMappings   = [];
let cachedBizList         = [];
let premiumDatabase       = {};
let globalDetailRows      = [];
let globalCurrentRenderedPlans = [];
let rawBizData   = [];
let rawPremData  = [];
let rawDetailData= [];
let rawMarkData  = []; // This line is not dead code, it's used.
let rawAddressData = [];
let recentSearches = []; // [NEW] For recently searched businesses
let favoritePlans = [];
let markDatabase = {}; // This line is not dead code, it's used.
// window._pendingLeadAction = null; // เก็บชื่อฟังก์ชันที่ต้องการทำงานหลังกรอกข้อมูลครบ - REMOVED
let _detailColCache = {};

// =============================================================================
// UTILITIES
// =============================================================================

function fmt(n) { return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

function normalize(str) {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase();
}
function normalizeKey(company, plan, group) {
  const g = (group && group !== '-' && group !== '—') ? normalize(group) : '';
  return normalize(company) + "|" + normalize(plan) + "|" + g;
}
function isValidCoverage(val) {
  const v = String(val || '').trim();
  return v !== '' && v !== '-' && v !== '—' && v !== '0' && v.toLowerCase() !== 'n/a' && !v.startsWith('ไม่คุ้มครอง');
}
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function debounce(fn, delay = 180) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
const debouncedRender = debounce(render, 180);

/**
 * [NEW] Animate a number value in a DOM element.
 */
function animateValue(el, start, end, duration = 500) {
  if (!el || start === end) {
    if (el) el.innerHTML = `${fmt(end)} <span class="unit">${el.querySelector('.unit')?.innerHTML || 'บาท'}</span>`;
    return;
  }
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const easedProgress = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const currentValue = Math.floor(easedProgress * (end - start) + start);
    el.innerHTML = `${fmt(currentValue)} <span class="unit">${el.querySelector('.unit')?.innerHTML || 'บาท'}</span>`;
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

function parseAssetPart(assetStr, label) {
  if (!assetStr) return '-';
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ':([^|]+)');
  const m  = assetStr.match(re);
  return m ? m[1].trim() : '-';
}

const _runtimeColorCache = {};
function getCompanyColor(companyName) {
  if (!companyName) return '#888780';
  const key = companyName.toUpperCase();
  if (COMPANY_COLORS[key]) return COMPANY_COLORS[key];
  if (_runtimeColorCache[key]) return _runtimeColorCache[key];
  const c = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
  _runtimeColorCache[key] = c;
  return c;
}

function getInsuranceTypeFilter(plans) {
  const types = plans.map(p => String(p.covType || "").toLowerCase());
  const isAllRisk = types.some(t => t.includes("ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)"));
  const isFire = types.some(t => t.includes("ประกันแบบระบุภัย (Named Perils)"));
  return { isAllRisk, isFire, showAll: !isAllRisk && !isFire };
}

function getDetailCellValue(row, colIdx) {
  if (colIdx === undefined || colIdx === -1) return '—';
  return String(row[colIdx] || '—').trim();
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadExcelData() {
  const statusEl = document.getElementById('load-status');
  try {
    if (statusEl) {
      statusEl.style.cssText = "background:#fef3c7;color:#92400e;border-color:#fde68a;";
      statusEl.textContent   = "⏳ กำลังโหลดข้อมูลประกันภัย...";
    }

    let response;
    // ── เพิ่มระบบ Retry (พยายามใหม่ 2 ครั้ง) เพื่อป้องกันความผิดพลาดชั่วคราว ──
    for (let i = 0; i <= 2; i++) {
      try {
        response = await fetch(GOOGLE_SHEET_URL + "&t=" + Date.now());
        if (response.ok) break;
      } catch (e) {
        if (i === 2) throw e;
        await new Promise(r => setTimeout(r, 1000)); // รอ 1 วินาทีก่อนลองใหม่
      }
    }

    if (!response || !response.ok) throw new Error("HTTP " + (response?.status || "Unknown Connection Error"));

    const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type:'array', cellDates:true });
    
    // บันทึก workbook ลง global เพื่อให้ admin-script.js นำไป parse ต่อได้โดยไม่ต้องโหลดใหม่
    window._adminWorkbook = workbook;

    const toArr = name => workbook.Sheets[name] ? XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1}) : null;

    rawBizData    = toArr(SHEET_NAMES.BIZ);
    rawPremData   = toArr(SHEET_NAMES.PREMIUM);
    rawDetailData = toArr(SHEET_NAMES.DETAIL);
    rawMarkData   = toArr(SHEET_NAMES.MARK);
    rawAddressData= toArr(SHEET_NAMES.ADDRESS);

    // บันทึกข้อมูลที่อยู่ลง sessionStorage เพื่อให้หน้า user-form.html นำไปใช้ทำ autocomplete
    try {
      if (rawAddressData) sessionStorage.setItem('ttib_address_data', JSON.stringify(rawAddressData));
    } catch (e) {
      console.warn("ไม่สามารถบันทึก address data ลง sessionStorage:", e);
    }

    if (!rawBizData || !rawPremData || !rawMarkData || !rawDetailData || !rawAddressData)
      throw new Error("ข้อมูลในไฟล์ Excel ไม่ครบถ้วน (กรุณาเช็คชื่อ Sheet)");

    if (statusEl) {
      statusEl.style.cssText = "background:#e1f5ee;color:#0f6e56;border-color:#9fe1cb;";
      statusEl.textContent   = "✅ โหลดข้อมูลสำเร็จ";
      setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
    }
    processRawData();
  } catch (err) {
    if (statusEl) {
      statusEl.style.cssText = "background:#fde8e8;color:#9b1c1c;border-color:#f8b4b4;";
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        statusEl.textContent = "❌ ไม่สามารถโหลดข้อมูลได้ (กรุณาใช้ Local Server เช่น Live Server หรือปิด Ad-blocker)";
      } else {
        statusEl.textContent = "❌ " + err.message;
      }
    }
    console.error(err);
  }
}

function processRawData() {
  _detailColCache = {};
  parseBizSheet(); parsePremSheet(); parseMarkSheet();
  globalDetailRows = rawDetailData;
  populateDropdowns();
  checkIncomingQuote();
  render(); // เรียก render() ทันทีเมื่อโหลดข้อมูลเสร็จ เพื่อแสดงผล Empty State หรือข้อมูลเริ่มต้น
}

/**
 * ตรวจสอบพารามิเตอร์ URL ว่ามีการส่งลิงก์ใบเสนอราคามาหรือไม่
 */
function checkIncomingQuote() {
  const params = new URLSearchParams(window.location.search);
  const qBase64 = params.get('quote');
  if (!qBase64) return;

  try {
    // ถอดรหัส Base64 เป็น JSON (รองรับภาษาไทยโดยใช้ escape/unescape hack)
    const jsonStr = decodeURIComponent(escape(atob(qBase64.replace(/ /g, '+'))));
    const data = JSON.parse(jsonStr);
    if (data && data.customer) {
      showWebQuoteView(data);
    }
  } catch (e) {
    console.error("[TTIB] Failed to parse quote link:", e);
  }
}

/**
 * แสดงหน้าใบเสนอราคาแบบเต็มหน้าจอ (Web View)
 */
function showWebQuoteView(data) {
  const container = document.createElement('div');
  container.id = 'web-quote-viewer';
  container.style.cssText = 'position:fixed; inset:0; background:#f1f5f9; z-index:99999; overflow-y:auto; padding:20px 10px;';
  
  container.innerHTML = `
    <div style="max-width:900px; margin:0 auto; padding-bottom:60px;">
      <div style="display:flex; justify-content:center; gap:12px; margin-bottom:25px;" class="no-print">
        <button id="btn-interest-quote" style="background:#10b981; color:#fff; border:none; padding:12px 24px; border-radius:50px; font-weight:700; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(16,185,129,0.3); transition:all 0.2s;">
          <i class="ti ti-circle-check" style="font-size:20px;"></i> สนใจทำรายการนี้
        </button>
        <button onclick="window.print()" style="background:#0f172a; color:#fff; border:none; padding:12px 24px; border-radius:50px; font-weight:700; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
          <i class="ti ti-printer" style="font-size:18px;"></i> พิมพ์เอกสาร / บันทึก PDF
        </button>
        <button onclick="openShareQuoteModal(null)" style="background:#fff; color:#4258d3; border:1px solid #4258d3; padding:12px 24px; border-radius:50px; font-weight:700; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(66,88,211,0.1);">
          <i class="ti ti-share" style="font-size:18px;"></i> แชร์ลิงก์
        </button>
        <button onclick="location.href='user.html'" style="background:#fff; color:#475569; border:1px solid #cbd5e1; padding:12px 24px; border-radius:50px; font-weight:700; cursor:pointer; font-family:inherit; box-shadow:0 2px 6px rgba(0,0,0,0.05);">
          กลับหน้าหลัก
        </button>
      </div>
      ${getSingleQuoteHTML(data)}
    </div>
    <div id="sticky-quote-bar" class="no-print" style="position:fixed; bottom:0; left:0; right:0; background:rgba(255,255,255,0.9); backdrop-filter:blur(10px); padding:15px; border-top:1px solid #e2e8f0; display:flex; justify-content:center; transform:translateY(100%); transition:transform 0.3s; z-index:100000; box-shadow:0 -4px 20px rgba(0,0,0,0.05);">
       <button id="btn-interest-sticky" style="background:#10b981; color:#fff; border:none; padding:12px 40px; border-radius:50px; font-weight:800; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:10px; box-shadow:0 4px 15px rgba(16,185,129,0.3); transition:all 0.2s;">
          <i class="ti ti-circle-check" style="font-size:22px;"></i> สนใจทำรายการนี้
       </button>
    </div>
    <style>
      @media print { .no-print { display:none !important; } body { background:#fff !important; padding:0 !important; } #web-quote-viewer { position:static !important; padding:0 !important; } #sticky-quote-bar { display:none !important; } }
      .app-container, header, footer, .floating-contact, #load-status { display:none !important; }
    </style>
  `;
  
  document.body.appendChild(container);
  window._currentQuoteData = data; // บันทึกข้อมูลใบเสนอราคาปัจจุบันไว้สำหรับแชร์

  // จัดการการแสดงผลแถบลอยเมื่อเลื่อนหน้าจอ (Show sticky bar on scroll)
  container.addEventListener('scroll', () => {
    const bar = document.getElementById('sticky-quote-bar');
    if (bar) {
      if (container.scrollTop > 150) {
        bar.style.transform = 'translateY(0)';
      } else {
        bar.style.transform = 'translateY(100%)';
      }
    }
  });

  // ผูกเหตุการณ์คลิกให้กับปุ่มสนใจ
  const interestBtn = document.getElementById('btn-interest-quote');
  if (interestBtn) {
    interestBtn.onclick = () => handleInterestClick(data);
  }

  const stickyBtn = document.getElementById('btn-interest-sticky');
  if (stickyBtn) {
    stickyBtn.onclick = () => handleInterestClick(data);
  }

  document.title = "ใบเสนอราคาออนไลน์ - คุณ" + data.customer;
  document.body.style.overflow = 'hidden';
}

/**
 * จัดการเมื่อลูกค้าคลิกปุ่ม "สนใจทำรายการนี้"
 */
async function handleInterestClick(data) {
  const btns = [
    document.getElementById('btn-interest-quote'),
    document.getElementById('btn-interest-sticky')
  ].filter(Boolean);

  btns.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2 ti-spin"></i> กำลังส่งข้อมูล...';
  });

  const msg = `สวัสดีครับ ผมสนใจทำรายการประกันภัยตามใบเสนอราคาออนไลน์นี้:\nแผน: ${data.plan}\nบริษัท: ${data.company}\nเบี้ยรวม: ${data.premium}\nชื่อผู้ติดต่อ: ${data.customer}\nเบอร์โทร: ${data.phone}\n\nกรุณาติดต่อกลับเพื่อดำเนินการขั้นต่อไปด้วยครับ`;
  const encodedMsg = encodeURIComponent(msg);

  // 1. ส่งสัญญาณไปยัง Backend (Apps Script) เพื่อบันทึกว่าลูกค้าเปิดดูและสนใจ
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // Apps Script ต้องการ text/plain + no-cors
      mode: 'no-cors',
      body: JSON.stringify({
        action: 'logInterest',
        customer: data.customer,
        plan: data.plan,
        timestamp: new Date().toLocaleString('th-TH')
      })
    });
  } catch (e) { console.warn("Backend logging skipped"); }

  // 2. เปิดช่องทางติดต่อสื่อสารหลัก (เช่น LINE หรือ WhatsApp ของบริษัท)
  // ในที่นี้เลือกเปิด LINE พร้อมข้อความอัตโนมัติ
  window.open(`https://line.me/R/msg/text/?${encodedMsg}`, '_blank');

  // [SUGGESTION] เปลี่ยนจาก alert เป็น Toast Notification เพื่อ UX ที่ดีขึ้น
  // alert('ขอบคุณที่ให้ความสนใจ! ระบบได้ส่งข้อมูลความสนใจของท่านให้เจ้าหน้าที่แล้ว และกำลังนำท่านไปยังช่องทางแชทเพื่อสอบถามเพิ่มเติมครับ');
  showUserToast('แจ้งความสนใจสำเร็จ! กำลังนำท่านไปยังแอปพลิเคชัน LINE', 'success');

  
  btns.forEach(btn => {
    btn.style.background = '#059669';
    btn.innerHTML = '<i class="ti ti-check"></i> แจ้งความสนใจสำเร็จ';
  });
}

function parseBizSheet() {
  allBusinessMappings = [];
  for (let i = 1; i < rawBizData.length; i++) {
    if (!rawBizData[i]) continue;
    const [cat, biz, comp, plan, grp, covType] = rawBizData[i].map(v => String(v||'').trim());
    if (biz && plan) allBusinessMappings.push({ category:cat, business:biz, company:comp, plan, group:grp, covType, searchKey:normalizeKey(comp,plan,grp) });
  }
  cachedBizList = [...new Set(allBusinessMappings.map(m => m.business))].sort((a, b) => a.localeCompare(b, 'th'));
  
  try {
    sessionStorage.setItem('ttib_biz_list', JSON.stringify(cachedBizList));
    const mappingsForForm = allBusinessMappings.map(({ searchKey, ...rest }) => rest);
    sessionStorage.setItem('ttib_biz_mappings', JSON.stringify(mappingsForForm));
  } catch (e) {
    console.warn("ไม่สามารถบันทึก biz data ลง sessionStorage:", e);
  }
}

function parsePremSheet() {
  premiumDatabase = {};
  if (rawPremData.length <= 3) return;
  const compRow  = rawPremData[0]||[];
  const planRow  = rawPremData[1];
  const groupRow = rawPremData[2];
  let lastComp = "";
  for (let r = 3; r < rawPremData.length; r++) {
    if (!rawPremData[r]) continue;
    const sumInsured = Number(String(rawPremData[r][0]||'').replace(/,/g,''));
    if (!sumInsured) continue;
    premiumDatabase[sumInsured] = {};
    for (let c = 1; c < planRow.length; c++) {
      const cc = String(compRow[c]||'').trim();
      if (cc) lastComp = cc;
      if (!lastComp || !planRow[c]) continue;
      const key = normalizeKey(lastComp, planRow[c], groupRow[c]);
      premiumDatabase[sumInsured][key] = Number(String(rawPremData[r][c]||'').replace(/,/g,''))||0;
    }
  }
  try {
    sessionStorage.setItem('ttib_premium_db', JSON.stringify(premiumDatabase));
  } catch (e) {
    console.warn("ไม่สามารถบันทึก premium data ลง sessionStorage:", e);
  }
}

function parseMarkSheet() {
  markDatabase = {};
  if (!rawMarkData || rawMarkData.length <= 3) return;
  
  const compRow  = rawMarkData[0] || [];
  const planRow  = rawMarkData[1] || [];
  const groupRow = rawMarkData[2] || [];
  let lastComp = "";

  for (let c = 1; c < planRow.length; c++) {
    const cc = String(compRow[c] || '').trim();
    const cp = String(planRow[c] || '').trim();
    if (cc) lastComp = cc;
    if (!lastComp || !cp) continue;

    let currentGroup = String(groupRow[c] || '').trim();
    if (currentGroup.toUpperCase().startsWith("SME ")) {
      currentGroup = currentGroup.substring(4).trim();
    }

    let checkGroup = currentGroup;
    if (normalize(checkGroup) === "service") {
      checkGroup = "Servicing Business";
    }

    let count = 0;
    for (let r = 3; r < rawMarkData.length; r++) {
      // [PATCH] ข้ามแถวที่เป็น header หมวดหมู่ — ไม่นับเป็นความคุ้มครอง
      const topicVal = String(rawMarkData[r]?.[0] || '').trim();
      if (/บริษัทที่ประกันภัยคุ้มครอง|แผนประกันภัย|กลุ่มประกัน/.test(topicVal)) continue;

      const v = String(rawMarkData[r]?.[c] || '').trim();
      if (v === '1' || v === '✓' || v.toLowerCase() === 'yes') count++;
    }

    const compNorm  = normalize(lastComp);
    const planNorm  = normalize(cp);
    const groupNorm = normalize(checkGroup);

    if (groupNorm && currentGroup !== '-' && currentGroup !== '—') {
      let matched = false;
      allBusinessMappings.forEach(mapping => {
        if (normalize(mapping.company) === compNorm && 
            normalize(mapping.plan) === planNorm && 
            normalize(mapping.group) === groupNorm) {
          const fallbackKey = normalizeKey(mapping.company, mapping.plan, mapping.group);
          markDatabase[fallbackKey] = count;
          matched = true;
        }
      });
      
      if (!matched) {
        const primaryKey = normalizeKey(lastComp, cp, checkGroup);
        markDatabase[primaryKey] = count;
        if (checkGroup !== currentGroup) {
          markDatabase[normalizeKey(lastComp, cp, currentGroup)] = count;
        }
      }
    } else {
      allBusinessMappings.forEach(mapping => {
        if (normalize(mapping.company) === compNorm && normalize(mapping.plan) === planNorm) {
          const fallbackKey = normalizeKey(mapping.company, mapping.plan, mapping.group);
          markDatabase[fallbackKey] = count;
        }
      });
      markDatabase[normalizeKey(lastComp, cp, "")] = count;
    }
  }
}

// =============================================================================
// DROPDOWNS
// =============================================================================

function populateDropdowns() {
  const bizSel = document.getElementById('sel-biz');
  if (bizSel) {
    const list = cachedBizList.length > 0 
      ? cachedBizList 
      : [...new Set(allBusinessMappings.map(m => m.business))].sort((a, b) => a.localeCompare(b, 'th'));
    
    bizSel.innerHTML = '<option value="">-- กรุณาเลือกธุรกิจ --</option>';
    list.forEach(b => bizSel.appendChild(new Option(b, b)));
  }
  filterBusinessOptions();
}

/**
 * [NEW] Loads recent searches from localStorage.
 */
function loadRecentSearches() {
  try {
    const saved = localStorage.getItem('ttib_recent_searches');
    if (saved) {
      recentSearches = JSON.parse(saved);
    }
    renderRecentSearches();
  } catch (e) {
    console.warn("Could not load recent searches:", e);
    recentSearches = [];
  }
}

/**
 * [NEW] Adds a business to the recent searches list.
 */
function addRecentSearch(bizName) {
  if (!bizName) return;
  // Remove if it already exists to move it to the front
  recentSearches = recentSearches.filter(b => b !== bizName);
  // Add to the front
  recentSearches.unshift(bizName);
  // Keep only the last 5 searches
  if (recentSearches.length > 5) {
    recentSearches.pop();
  }
  localStorage.setItem('ttib_recent_searches', JSON.stringify(recentSearches));
  renderRecentSearches();
}

/**
 * [NEW] Renders the recent search buttons below the search input.
 */
function renderRecentSearches() {
  const container = document.getElementById('recent-searches-container');
  if (!container) return;
  container.innerHTML = recentSearches.map(biz =>
    `<button class="recent-search-btn" onclick="selectBusinessSuggestion('${escapeHtml(biz)}')">${escapeHtml(biz)}</button>`
  ).join('');
}

// [FIX Bug1+2] filterBusinessOptions — แก้ bracket ไม่สมดุล + วนซ้ำ list สองชั้น
function filterBusinessOptions() {
  const searchInput    = document.getElementById('inp-search-biz');
  const clearBtn       = document.getElementById('btn-clear-biz');
  const suggestionsBox = document.querySelector('.biz-suggestions');
  if (!searchInput || !suggestionsBox) return;

  if (document.activeElement === searchInput) {
    resetNotFoundBtn();
  }

  const rawVal = searchInput.value;
  if (clearBtn) clearBtn.classList.toggle('show', rawVal.length > 0);

  // 1. แยกคำค้นหาเป็นกลุ่มคำ (Tokens) โดยใช้ช่องว่างเป็นตัวแบ่ง
  const searchTokens = rawVal.toLowerCase().trim().split(/\s+/).filter(t => t);

  const list = cachedBizList.length > 0
    ? cachedBizList
    : [...new Set(allBusinessMappings.map(m => m.business))].sort((a, b) => a.localeCompare(b, 'th'));

  let html = '';
  let matchCount = 0;
  const MAX_DISPLAY = 150; // เพิ่มจำนวนรายการแนะนำให้มากขึ้นเมื่อพื้นที่แสดงผลกว้างขึ้น

  for (let i = 0; i < list.length; i++) {
    const bizName = list[i];
    const normBiz = normalize(bizName); // Normalize ข้อมูลต้นทาง (ตัดช่องว่าง, ตัวเล็ก)

    // 2. ตรวจสอบว่า "ทุกคำ" ที่ค้นหา ต้องมีอยู่ในชื่อธุรกิจ (AND Logic)
    // ใช้ normalize กับแต่ละ token เพื่อให้เทียบกับ normBiz ได้อย่างแม่นยำที่สุด
    const isMatch = searchTokens.length === 0 || 
                    searchTokens.every(token => normBiz.includes(normalize(token)));

    if (!isMatch) continue;

    matchCount++;
    html += `<div class="biz-suggestion-item" onclick="selectBusinessSuggestion('${escapeHtml(bizName)}')">
      <i class="ti ti-search" style="margin-right:8px; opacity:0.5;"></i> ${escapeHtml(bizName)}
    </div>`;
    if (matchCount >= MAX_DISPLAY) break;
  }

  if (matchCount > 0 || searchTokens.length === 0) {
    suggestionsBox.innerHTML = html || '';
    suggestionsBox.classList.add('show');
  } else {
    // แสดง UI ที่สวยงามขึ้นเมื่อไม่พบธุรกิจ
    suggestionsBox.innerHTML = `
      <div style="padding: 20px; text-align: center; background: #fff; border-radius: 0 0 12px 12px; animation: fadeUp 0.3s ease-out both;">
        <div style="width: 100px; height: 100px; background: linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px; position: relative; border: 3px solid #fff; box-shadow: 0 5px 15px rgba(24, 95, 165, 0.1);">
          <img src="https://www.ttib.co.th/wp-content/uploads/2025/01/40act-35-3.svg" style="width: 100px; height: 100px; position: relative; z-index: 2;" alt="No results animation">
          <div style="position: absolute; width: 110%; height: 110%; border: 1px dashed #bae6fd; border-radius: 50%; animation: slowSpin 10s linear infinite; z-index: 1;"></div>
        </div>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--text-1); margin-bottom: 8px;">ไม่พบธุรกิจที่ค้นหา</h3>
        <p style="font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 15px;">
          หากธุรกิจของคุณไม่อยู่ในรายการ กรุณากดปุ่มด้านล่างเพื่อให้เจ้าหน้าที่ช่วยเหลือ
        </p>
        <button onclick="handleNotFoundBiz();" style="background: var(--grad-brand); color: #fff; border: none; padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.25s ease; box-shadow: 0 4px 15px rgba(24, 95, 165, 0.2), 0 1px 3px rgba(24, 95, 165, 0.3); transform: translateY(0);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 20px rgba(24, 95, 165, 0.25), 0 2px 5px rgba(24, 95, 165, 0.35)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(24, 95, 165, 0.2), 0 1px 3px rgba(24, 95, 165, 0.3)';">
          <i class="ti ti-help-circle"></i> แจ้งธุรกิจที่ไม่อยู่ในรายการ
        </button>
      </div>
    `;
    suggestionsBox.classList.add('show');
  }
}

function selectBusinessSuggestion(val) {
  const searchInput    = document.getElementById('inp-search-biz');
  const bizSel         = document.getElementById('sel-biz');
  const suggestionsBox = document.querySelector('.biz-suggestions');

  if (searchInput) searchInput.value = val;
  if (bizSel) {
    bizSel.value = val;
    window.companyCardIndexes = {};
  }
  if (suggestionsBox) suggestionsBox.classList.remove('show');

  // [NEW] Add selected business to recent searches
  addRecentSearch(val);

  resetNotFoundBtn();
  render();
}

function clearSearchBiz() {
  const searchInput = document.getElementById('inp-search-biz');
  const bizSel      = document.getElementById('sel-biz');
  const clearBtn    = document.getElementById('btn-clear-biz');
  const suggestionsBox = document.querySelector('.biz-suggestions');
  // [FIX] เพิ่ม reset sum
  const sumInput    = document.getElementById('inp-sum');
  const btnMinus    = document.getElementById('btn-sum-minus');
  const btnPlus     = document.getElementById('btn-sum-plus');
  const MIN_SUM     = 500000;

  if (searchInput) {
    searchInput.value = '';
    if (bizSel) bizSel.value = '';
    if (suggestionsBox) suggestionsBox.classList.remove('show');
    if (clearBtn) clearBtn.classList.remove('show');

    // [FIX] รีเซ็ต sum กลับ 500,000
    if (sumInput) {
      sumInput.value = MIN_SUM.toLocaleString('th-TH');
      if (btnMinus) btnMinus.disabled = true;  // 500k = min → ปิดปุ่ม -
      if (btnPlus)  btnPlus.disabled  = false;
    }

    resetNotFoundBtn();
    window.companyCardIndexes = {};
    render();
  }
}

function resetAllFilters() {
  const searchInp = document.getElementById('inp-search-biz');
  const bizSel    = document.getElementById('sel-biz');
  const covSel    = document.getElementById('sel-cov');
  const sortSel   = document.getElementById('sel-sort');
  const sumRange  = document.getElementById('inp-sum-range');
  const sumValue  = document.getElementById('sum-range-value');
  const sumInp    = document.getElementById('inp-sum');
  const clearBtn  = document.getElementById('btn-clear-biz'); // [FIX] เพิ่ม

  if (searchInp) searchInp.value = '';
  if (bizSel)    bizSel.value = '';
  if (covSel)    covSel.value = 'all';
  if (sortSel)   sortSel.value = 'coverage';
  if (clearBtn)  clearBtn.classList.remove('show'); // [FIX] ซ่อนปุ่ม X

  document.querySelectorAll(
    '#inp-fname, #inp-lname, #inp-phone, #inp-email, ' +
    '#inp-area, #inp-stock, #inp-equip, #inp-renov, #inp-staff'
  ).forEach(el => {
    el.value = '';
    el.classList.remove('error');
  });

  window.csFormData = {};
  toggleAdvancedInfo(false);

  const DEFAULT_SUM = Number(sumRange?.min ?? 500000);
  if (sumRange) sumRange.value = DEFAULT_SUM;
  if (sumInp)   sumInp.value   = DEFAULT_SUM;
  if (sumValue) sumValue.textContent = DEFAULT_SUM.toLocaleString('th-TH') + ' บาท';

  const suggestionsBox = document.querySelector('.biz-suggestions');
  if (suggestionsBox) suggestionsBox.classList.remove('show');

  resetNotFoundBtn();
  window.companyCardIndexes = {};
  window.activeMultiCards   = [];

  render();
}

function onBizChange() { 
  resetNotFoundBtn();
  render(); 
}

/**
 * นำผู้ใช้ไปยังหน้าฟอร์มรับข้อมูล (user-form.html) พร้อมส่งค่า Filter ปัจจุบันไปด้วย
 */
function goToUserForm(comp = '', plan = '', group = '', bizFromFav = '', sumFromFav = '') {
  let biz = bizFromFav || document.getElementById('sel-biz')?.value || '';
  const sum = sumFromFav || document.getElementById('inp-sum')?.value || '';
  const cov = document.getElementById('sel-cov')?.value || 'all';

  const params = new URLSearchParams();

  // หากข้อมูลแผน (การ์ด) และธุรกิจว่างเปล่า (กรณีคลิกปุ่มติดต่อโดยยังไม่ได้เลือกแผน/ธุรกิจ)
  // ให้ระบบเปิดโหมด "ไม่พบธุรกิจ" อัตโนมัติ เพื่อให้ผู้ใช้ไปกรอกข้อมูลเองที่หน้าฟอร์ม
  if (!comp && !biz) {
    window._csIsNotFoundClicked = true;
    const searchInp = document.getElementById('inp-search-biz');
    if (searchInp && searchInp.value.trim()) biz = searchInp.value.trim();
  }

  if (biz && biz !== "__other__") params.set('biz', biz);
  if (sum)  params.set('sum', sum);
  if (cov && cov !== 'all') params.set('cov', cov);

  // ส่ง Category ของธุรกิจปัจจุบันไปด้วย
  const currentBizMapping = allBusinessMappings.find(m => normalize(m.business) === normalize(biz));
  if (currentBizMapping && currentBizMapping.category) params.set('cat', currentBizMapping.category);

  // -- เก็บข้อมูลผู้ติดต่อและทรัพย์สิน --
  const gv = (id) => document.getElementById(id)?.value || '';
  if (gv('inp-fname')) params.set('fname', gv('inp-fname'));
  if (gv('inp-lname')) params.set('lname', gv('inp-lname'));
  if (gv('inp-phone')) params.set('phone', gv('inp-phone'));
  if (gv('inp-email')) params.set('email', gv('inp-email'));
  
  // Asset fields
  if (gv('inp-area'))  params.set('area',  gv('inp-area'));
  if (gv('inp-stock')) params.set('stock', gv('inp-stock'));
  if (gv('inp-equip')) params.set('equip', gv('inp-equip'));
  if (gv('inp-renov')) params.set('renov', gv('inp-renov'));
  if (gv('inp-staff')) params.set('staff', gv('inp-staff'));

  if (window._csIsNotFoundClicked) params.set('isNotFound', 'true');

  // ── ถ้ากดจาก card เฉพาะ ส่งแผนนั้นไปด้วย ──
  if (comp && plan) {
    params.set('comp',  comp);
    params.set('plan',  plan);
    params.set('group', group || '');
  }

  // ── ส่ง plans ที่แสดงบนหน้าจอผ่าน sessionStorage ──
  try {
    let plansToStore = [];

    // [NEW] ถ้ากดจาก card เฉพาะ (comp มีค่า) ให้ส่งแค่ plan นั้น
    if (comp && plan) {
      const selectedPlan = (globalCurrentRenderedPlans || []).find(p => 
        normalize(p.company) === normalize(comp) &&
        normalize(p.plan) === normalize(plan) &&
        normalize(p.group || '') === normalize(group || '')
      );
      if (selectedPlan) {
        plansToStore.push(selectedPlan);
      }
    } 
    // ถ้ากดจากปุ่มรวม ให้ส่งทุก plans ที่แสดงผล
    else {
      plansToStore = (globalCurrentRenderedPlans || []);
    }
    const allPlans = plansToStore.map(p => ({
      company: p.company  || '',
      plan:    p.plan     || '',
      group:   p.group    || '',
      covType: p.covType  || '',
      category: p.category || '',
    }));

    // เพิ่ม premium จาก activeMultiCards (card ที่แสดงอยู่จริงๆ)
    const activePremMap = {};
    (window.activeMultiCards || []).forEach(d => {
      const key = `${d.plan.company}|${d.plan.plan}|${d.plan.group || ''}`;
      activePremMap[key] = d.premium || 0;
    });

    const plansWithPrem = allPlans.map(p => ({
      ...p,
      premium: activePremMap[`${p.company}|${p.plan}|${p.group}`] || 0,
      coverageCount: markDatabase[normalizeKey(p.company, p.plan, p.group)] || 0,
    }));

    sessionStorage.setItem('ttib_visible_plans', JSON.stringify({
      plans:     plansWithPrem,
      biz:       biz,
      sum:       sum,
      cov:       cov,
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.warn('[TTIB] ไม่สามารถบันทึก visible plans:', e);
  }

  // ── ส่งต่อ marketing params ──
  const curParams = new URLSearchParams(window.location.search);
  ['source', 'campaign', 'utm_source', 'utm_campaign'].forEach(k => {
    if (curParams.has(k)) params.set(k, curParams.get(k));
  });

  const queryString = params.toString();
  window.location.href = 'user-form.html' + (queryString ? '?' + queryString : '');
}
window.goToUserForm = goToUserForm;

/**
 * resetNotFoundBtn — รีเซ็ตสถานะปุ่ม + global state
 * [FIX] เพิ่ม guard ไม่ reset ซ้ำถ้าไม่จำเป็น + ล้าง bizDetail ใน csFormData
 */
function resetNotFoundBtn() {
  // guard: ถ้า state ปกติอยู่แล้ว ไม่ต้องทำอะไร
  if (!window._csIsNotFoundClicked) return;

  window._csIsNotFoundClicked = false;

  const btn = document.querySelector('.btn-not-found');
  if (btn) {
    btn.style.background  = '';
    btn.style.borderColor = '';
    btn.style.color       = '';
    btn.innerHTML = '<i class="ti ti-help-circle"></i><span>ไม่พบธุรกิจของคุณ?</span>';
  }

  // [FIX] ล้าง bizDetail ออกจาก csFormData เพื่อไม่ให้ค้างไปยัง Modal ถัดไป
  if (window.csFormData) {
    window.csFormData.bizDetail = '';
  }
}

/**
 * handleNotFoundBiz — เมื่อผู้ใช้กด "ไม่พบธุรกิจ" บนหน้าหลัก
 * [FIX] แยก UX เป็น 2 ระดับ:
 *   1. ตั้ง state + update btn ก่อน
 *   2. redirect พร้อม delay เล็กน้อย เพื่อให้ผู้ใช้เห็น feedback
 *   3. ถ้า goToUserForm ถูก intercept ในอนาคต ก็แก้ที่จุดเดียว
 * รองรับทั้งการนำทางไปยังหน้าฟอร์ม และการสลับ UI ในหน้าฟอร์ม (sf)
 */
function handleNotFoundBiz() {
  // กรณีอยู่ในหน้าฟอร์ม (user-form.html)
  const isFormPage = !!document.getElementById('sf-biz-search');
  if (isFormPage) {
    window._sfIsNotFound = true;
    sfFilterBiz(); // เรียกใช้งาน UI Toggle เพื่อซ่อนการค้นหา
    return;
  }

  // กรณีอยู่หน้าหลัก (Comparison Page)
  window._csIsNotFoundClicked = true;

  // ล้าง bizSel เพื่อไม่ให้ค้างค่าธุรกิจเดิม
  const bizSel = document.getElementById('sel-biz');
  if (bizSel) bizSel.value = '';

  // อัปเดต btn ให้ feedback ผู้ใช้ก่อน redirect
  const btn = document.querySelector('.btn-not-found');
  if (btn) {
    btn.style.background  = '#fef3c7';
    btn.style.borderColor = '#fcd34d';
    btn.style.color       = '#92400e';
    btn.innerHTML = '<i class="ti ti-loader-2"></i><span>กำลังนำทาง...</span>';
    btn.style.pointerEvents = 'none'; // [FIX] ป้องกัน double-click
  }

  // [FIX] delay 300ms เพื่อให้ผู้ใช้เห็น feedback ก่อน redirect
  setTimeout(() => goToUserForm(), 300);
}

// =============================================================================
// RENDER & CHARTS
// =============================================================================

function render() {
  const bizSel = document.getElementById('sel-biz');
  if (!allBusinessMappings.length || !bizSel || !bizSel.value) {
    _renderEmptyState();
    globalCurrentRenderedPlans = [];
    return;
  }

  // [PERF] ย้ายการเข้าถึง DOM มาไว้หลังจากตรวจสอบเงื่อนไขแล้ว
  const sumInput = document.getElementById('inp-sum');
  const covSel   = document.getElementById('sel-cov');
  const selectedBiz = bizSel.value;
  const normBiz     = normalize(selectedBiz);
  const selectedSum = sumInput ? (Number(String(sumInput.value).replace(/,/g, ''))||0) : 0;
  const sortBy      = covSel ? covSel.value : 'coverage'; // [FIX] เปลี่ยนค่าเริ่มต้นเป็น 'coverage'

  let validPlans = allBusinessMappings.filter(m => normalize(m.business) === normBiz);

  const currentPremiums = [];
  validPlans.forEach(plan => {
    currentPremiums.push(premiumDatabase[selectedSum]?.[plan.searchKey]??0);
  });

  let indices   = validPlans.map((_,i)=>i);
  if (sortBy === 'coverage') {
    indices.sort((a, b) => {
      const countA = markDatabase[validPlans[a].searchKey] || 0;
      const countB = markDatabase[validPlans[b].searchKey] || 0;
      return countB - countA; // เรียงจากมากไปน้อย
    });
  } else if (sortBy === 'prem-asc' || sortBy === 'prem-desc') {
    indices.sort((a, b) => {
      const premA = currentPremiums[a] || 0;
      const premB = currentPremiums[b] || 0;
      if (premA === 0 && premB > 0) return 1;  // แผนที่ไม่มีราคา (ติดต่อเจ้าหน้าที่) ไปอยู่ท้ายสุด
      if (premB === 0 && premA > 0) return -1;
      return sortBy === 'prem-asc' ? premA - premB : premB - premA;
    });
  }

  const sortedPlans    = indices.map(i=>validPlans[i]);
  const sortedPremiums = indices.map(i=>currentPremiums[i]);
  globalCurrentRenderedPlans = sortedPlans;
  
  const statsEl = document.getElementById('stats'); // This line is not dead code, it's used.
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><div class="lbl">แผนที่รับทำ</div><div class="val">${sortedPlans.length}</div><div class="sub">แผนประกันภัย</div></div>`;
  }

  const tableArea  = document.getElementById('table-area');
  if (!sortedPlans.length) {
    if (tableArea)  tableArea.innerHTML='<div class="no-result">🔍 ไม่พบแผนประกันที่ตรงกับเงื่อนไขที่เลือก</div>';
    return;
  }
  renderTinderUI(sortedPlans, sortedPremiums, selectedSum, selectedBiz);
}
/**
 * [NEW] _renderEmptyState - แสดงผลเมื่อยังไม่ได้เลือกธุรกิจ
 * แยกโค้ดส่วนนี้ออกมาเพื่อให้ฟังก์ชัน render() หลักกระชับขึ้น
 */
function _renderEmptyState() {
  const statsEl = document.getElementById('stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><div class="lbl">แผนที่รับทำ</div><div class="val">0</div><div class="sub">แผนประกันภัย</div></div>
      <div class="stat"><div class="lbl">เบี้ยต่ำสุด</div><div class="val" style="color:#1D9E75">N/A</div><div class="sub">ต่อปี</div></div>
      <div class="stat"><div class="lbl">เบี้ยเฉลี่ย</div><div class="val" style="color:#BA7517">N/A</div><div class="sub">ต่อปี</div></div>
      <div class="stat"><div class="lbl">เบี้ยสูงสุด</div><div class="val" style="color:#D85A30">N/A</div><div class="sub">ต่อปี</div></div>`;
  }
  const tableArea = document.getElementById('table-area');
  if (tableArea) {
    tableArea.innerHTML = `
      <div class="empty-state-wrapper" style="display: flex; justify-content: center; align-items: center; padding: 40px 0; animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;">
        <div class="empty-state-card" style="background: #fff; border-radius: 40px; padding: 40px; box-shadow: var(--sh-lg); border: 1px solid #e2e8f0; text-align: center; max-width: 520px; position: relative; overflow: hidden;">
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 10px; background: var(--grad-brand);"></div>
          <img src="https://www.ttib.co.th/wp-content/uploads/2025/01/5a6f7fa425e5b12ac9d3b5dff2df0007.gif" style="width: 180px; height: auto; margin: 0 auto 30px;" alt="Welcome Animation">
          <h2 style="font-size: 28px; font-weight: 800; color: var(--text-1); margin-bottom: 12px; letter-spacing: -0.5px; font-family: 'IBM Plex Sans Thai', sans-serif;">พร้อมค้นหาแผนประกันที่ใช่!</h2>
          <p style="font-size: 16px; color: var(--text-2); line-height: 1.7; margin: 0 auto; max-width: 420px; font-weight: 500;">กรุณาเลือกประเภทธุรกิจในช่อง <strong style="color:var(--accent);">ค้นหาธุรกิจ</strong> ด้านบน เพื่อให้เราคัดสรรแผนประกันที่ดีที่สุดสำหรับคุณ</p>
        </div>
      </div>`;
  }
}
// =============================================================================
// TINDER CARD UI
// =============================================================================

window.companyCardIndexes = {};
window.activeMultiCards   = [];

function renderTinderUI(plans, premiums, sumInsured = 0, businessName = '') {
  const container = document.getElementById('table-area');
  if (!container) return;
  if (!plans || !plans.length) {
    container.innerHTML = '<div class="no-result">🔍 ไม่พบแผนประกัน</div>';
    window.activeMultiCards = []; // This line is not dead code, it's used.
    return;
  }
  window.currentPlans    = plans;
  window.currentPremiums = premiums;

  const companyGroups = {};
  plans.forEach((plan, idx) => {
    const compKey = plan.company ? String(plan.company).trim().toUpperCase() : 'UNKNOWN';
    if (!companyGroups[compKey]) companyGroups[compKey] = [];
    companyGroups[compKey].push({ plan, premium: premiums[idx], globalIdx: idx });
  });
  Object.keys(companyGroups).forEach(comp => {
    const len = companyGroups[comp].length;
    if (window.companyCardIndexes[comp] === undefined) window.companyCardIndexes[comp] = 0;
    else window.companyCardIndexes[comp] = Math.max(0, Math.min(window.companyCardIndexes[comp], len - 1));
  });
  window.activeMultiCards = [];

  const isInitialRender = !container.querySelector('.multi-tinder-grid');
  let html = '';

  if (isInitialRender) {
    html += '<div class="multi-tinder-grid" style="display:flex;flex-wrap:wrap;gap:30px;justify-content:center;align-items:flex-start;width:100%;padding:10px 0;">';
  }

  Object.keys(companyGroups).forEach(comp => {
    const group      = companyGroups[comp];
    const curIdx     = window.companyCardIndexes[comp];
    const item       = group[curIdx];
    window.activeMultiCards.push(item);
    const plan       = item.plan;
    const price      = Number(item.premium) || 0;
    const cColor     = COMPANY_COLORS[plan.company.toUpperCase()] || "#4258d3";
    const cLogo      = COMPANY_LOGOS[plan.company.toUpperCase()];
    const compEscaped = comp.replace(/'/g, "\\'");
    const cardId     = `plan-card-${comp.replace(/[^a-zA-Z0-9]/g, '')}`;
  const isFavorited = favoritePlans.some(p => normalizeKey(p.company, p.plan, p.group) === normalizeKey(plan.company, plan.plan, plan.group));

    if (!isInitialRender) {
      const cardEl = document.getElementById(cardId);
      if (cardEl) {
        // การ์ดมีอยู่แล้ว → animate ค่าใหม่
      // [FAV] อัปเดตสถานะหัวใจ
      const heartCheckbox = cardEl.querySelector('.plan-summary .container input');
      if (heartCheckbox && heartCheckbox.checked !== isFavorited) {
        heartCheckbox.checked = isFavorited;
      }
      // [FAV] อัปเดต data attributes
      const heartLabel = cardEl.querySelector('.plan-summary .container');
      if (heartLabel) {
        heartLabel.dataset.sum = sumInsured;
        heartLabel.dataset.premium = price;
      }

        const sumEl   = cardEl.querySelector('.sum-insured-value');
        const priceEl = cardEl.querySelector('.premium-value-main');
        const oldSum   = Number(sumEl?.dataset.value   || '0');
        const oldPrice = Number(priceEl?.dataset.value || '0');
        if (sumEl)   { animateValue(sumEl,   oldSum,   sumInsured); sumEl.dataset.value   = sumInsured; } // [FIX] guard ก่อน set
        if (priceEl) { animateValue(priceEl, oldPrice, price);      priceEl.dataset.value = price;      } // [FIX] guard ก่อน set
        return;
      }
      // [FIX] การ์ดหายจาก DOM → rebuild แล้ว inject เข้า grid โดยตรง
      const gridEl = container.querySelector('.multi-tinder-grid');
      if (gridEl) {
        gridEl.insertAdjacentHTML('beforeend',
          buildTinderCardHTML(cardId, plan, price, sumInsured, cColor, cLogo, compEscaped, curIdx, group.length, businessName)
        );
      }
      return;
    }

    html += buildTinderCardHTML(cardId, plan, price, sumInsured, cColor, cLogo, compEscaped, curIdx, group.length, businessName);
  });

  if (isInitialRender) {
    html += '</div>';
    container.innerHTML = html; // This line is not dead code, it's used.
  }
}
function buildTinderCardHTML(cardId, plan, price, sumInsured, cColor, cLogo, compEscaped, curIdx, groupLength, businessName) {
  // ── สร้างส่วนแสดงผลรายละเอียด (ที่จะซ่อนไว้) ──
  const isFavorited = favoritePlans.some(p => normalizeKey(p.company, p.plan, p.group) === normalizeKey(plan.company, plan.plan, plan.group));
  let detailHtml = "";
  const mIdx = getMarkSheetColumnIndex(plan.company, plan.plan, plan.group);

  // [NEW] แสดงรายการความคุ้มครองทั้งหมดเสมอ และทำเครื่องหมายว่าคุ้มครองหรือไม่
  const topicItems = new Map();
  for (let r = 3; r < rawMarkData.length; r++) {
    const row = rawMarkData[r];
    if (!row || !row[0] || !row[1]) continue;
    const category = String(row[0]).trim();
    const itemName = String(row[1]).trim();
    if (/หมวดหมู่ประกันภัย/.test(category)) continue;

    const val = mIdx !== -1 ? String(row[mIdx] || '').trim() : '';
    const isOk = val === '1' || val === '✓' || val.toLowerCase() === 'yes';

    if (!topicItems.has(category)) topicItems.set(category, []);
    topicItems.get(category).push({ name: itemName, covered: isOk });
  }

  let isFirstGroup = true;
  topicItems.forEach((items, category) => {
    // [NEW] กรองเอาเฉพาะรายการที่คุ้มครอง
    const coveredItems = items.filter(item => item.covered);

    // [NEW] ถ้าในหมวดหมู่นี้ไม่มีรายการที่คุ้มครองเลย ให้ข้ามไป ไม่ต้องแสดงผล
    if (coveredItems.length === 0) return;

    const categoryEsc = escapeHtml(category);
    detailHtml += `
      <details class="cov-group" ${isFirstGroup ? 'open' : ''}>
        <summary>${categoryEsc}</summary>
        <div class="cov-items-list">
          ${coveredItems.map(item => `
            <div class="cov-item is-covered">
              <i class="ti ti-circle-check-filled"></i>
              <span>${escapeHtml(item.name)}</span>
            </div>
          `).join('')}
        </div>
      </details>`;
    isFirstGroup = false;
  });

  return `
    <div id="${cardId}" class="plan-container" style="--brand-color: ${cColor};" data-plan-active="false">
      <article class="plan-summary" onclick="togglePlanDetail(this, true)">
        <label class="container" 
          onclick="toggleFavorite(this); event.stopPropagation()"
          data-business="${escapeHtml(businessName || '')}"
          data-company="${escapeHtml(plan.company)}"
          data-plan="${escapeHtml(plan.plan)}"
          data-group="${escapeHtml(plan.group || '')}"
          data-covtype="${escapeHtml(plan.covType || '')}"
          data-category="${escapeHtml(plan.category || '')}">
          <input type="checkbox" ${isFavorited ? 'checked' : ''} onchange="event.stopPropagation()" />
          <div class="checkmark">
            <svg viewBox="0 0 256 256">
              <rect fill="none" height="256" width="256"></rect>
              <path
                d="M224.6,51.9a59.5,59.5,0,0,0-43-19.9,60.5,60.5,0,0,0-44,17.6L128,59.1l-7.5-7.4C97.2,28.3,59.2,26.3,35.9,47.4a59.9,59.9,0,0,0-2.3,87l83.1,83.1a15.9,15.9,0,0,0,22.6,0l81-81C243.7,113.2,245.6,75.2,224.6,51.9Z"
                stroke-width="20px" stroke="#000" fill="none"></path>
            </svg>
          </div>
        </label>
        <div class="summary-header">
          <div class="summary-logo">
            ${cLogo ? `<img src="${cLogo}" alt="${escapeHtml(plan.company)}" style="width:100%; height:100%; object-fit:contain;">` : `<span>${escapeHtml(plan.company)}</span>`}
          </div>
          <div class="summary-title">
             <div class="summary-company-name">${escapeHtml(plan.company)}</div>
            <div class="plan-name">${escapeHtml(plan.plan)}</div>
            <div class="cov-type-name" style="font-size:11px; color:var(--accent); font-weight:700; margin-top:2px;">${escapeHtml(plan.covType || 'Package')}</div>
            ${plan.group ? `<div class="group-name">${escapeHtml(plan.group)}</div>` : ''}
          </div>
        </div>
        <div class="stat-block summary-footer">
          <div class="stat-item"><div class="stat-label">ทุนประกัน</div><div class="stat-value sum-insured-value" data-value="${sumInsured}">${fmt(sumInsured)}<span class="unit"> บาท</span></div></div>
          <div class="stat-item"><div class="stat-label">เบี้ยเริ่มต้น</div><div class="stat-value premium-value-main" data-value="${price}">${price > 0 ? `${fmt(price)}<span class="unit"> บาท</span>` : 'ติดต่อเจ้าหน้าที่'}</div></div>
        </div>
          <button type="button" class="btn-h" style="margin-top:12px; height:42px; font-size:14px; border-radius:12px;" onclick="event.stopPropagation(); goToUserForm('${escapeHtml(plan.company)}', '${escapeHtml(plan.plan)}', '${escapeHtml(plan.group)}')">
            <i class="ti ti-phone-call"></i>
            <span>สนใจทำประกันภัย</span>
          </button>
      </article>
      <div class="plan-detail-hover">
        <div class="tinder-nav">
          <button class="tinder-nav-btn tinder-btn-prev" onclick="moveCompanyCard('${compEscaped}',-1, event)" ${curIdx === 0 ? 'disabled' : ''}>&#8249;</button>
          <button class="tinder-nav-btn tinder-btn-next" onclick="moveCompanyCard('${compEscaped}',1, event)" ${curIdx === groupLength - 1 ? 'disabled' : ''}>&#8250;</button>
        </div>
        <div class="tinder-card">
          <button class="detail-close-btn" onclick="togglePlanDetail(this, false)" title="ปิด"><i class="ti ti-x"></i></button>
          <div class="tinder-counter">${curIdx + 1} / ${groupLength}</div>
          <div class="tc-header">
            <div class="tc-company-name">${escapeHtml(plan.company)}</div>
            <div class="tc-plan-name">${escapeHtml(plan.plan)}</div>
            ${plan.group ? `<div class="tc-group-name">กลุ่ม: ${escapeHtml(plan.group)}</div>` : ''}
          </div>
          <div class="cov-section-title">รายการที่คุ้มครอง</div>
          <div class="tc-table-scroll">
            ${detailHtml || '<div class="no-cov-data">ไม่มีข้อมูลความคุ้มครอง</div>'}
          </div>
          <div class="tc-footer">
            <button class="btn-h" onclick="openDetailModal()">
              <i class="ti ti-clipboard-list"></i>
                <span>รายละเอียด</span>
            </button>
          </div>
        </div>
      </div>
      <div class="plan-detail-overlay" onclick="togglePlanDetail(this, false)"></div>
    </div>`;
}

/**
 * [NEW] Toggles the detail view for a plan card.
 * @param {HTMLElement} el 
 * @param {boolean} [forceShow]
 */
function togglePlanDetail(el, forceShow) {
  const container = el.closest('.plan-container');
  if (!container) return;
  
  const isActive = container.classList.contains('is-active');
  const shouldShow = forceShow !== undefined ? forceShow : !isActive;

  // ถ้าคลิกเพื่อเปิดการ์ดใหม่ ให้ปิดการ์ดอื่นที่เปิดอยู่ก่อน
  if (shouldShow && !isActive) {
    document.querySelectorAll('.plan-container.is-active').forEach(activeCard => {
      if (activeCard !== container) {
        activeCard.classList.remove('is-active');
        document.body.classList.remove('plan-detail-is-active');
      }
    });
  }

  if (shouldShow) {
    container.classList.add('is-active');
    document.body.classList.add('plan-detail-is-active');
  } else {
    container.classList.remove('is-active');
    document.body.classList.remove('plan-detail-is-active');
  }
}

function moveCompanyCard(company, direction, event) {
  if (event) event.stopPropagation(); // ป้องกันไม่ให้ event bubble ไปยัง parent และปิด detail view
  const companyGroups = {};
  window.currentPlans.forEach((plan, idx) => {
    const compKey = plan.company ? String(plan.company).trim().toUpperCase() : 'UNKNOWN';
    if (!companyGroups[compKey]) companyGroups[compKey] = [];
    companyGroups[compKey].push({ plan, premium: window.currentPremiums[idx], globalIdx: idx });
  });

  const group = companyGroups[company];
  if (!group || window.companyCardIndexes[company] === undefined) return;

  const newIndex = window.companyCardIndexes[company] + direction;
  if (newIndex < 0 || newIndex >= group.length) return;

  window.companyCardIndexes[company] = newIndex;

  // สร้าง HTML ใหม่เฉพาะการ์ดที่เปลี่ยน
  const item = group[newIndex];
  const plan = item.plan;
  const price = Number(item.premium) || 0;
  const sumInsured = Number(String(document.getElementById('inp-sum')?.value || '0').replace(/,/g, '')) || 0;
  const cColor = COMPANY_COLORS[plan.company.toUpperCase()] || "#4258d3";
  const cLogo = COMPANY_LOGOS[plan.company.toUpperCase()];
  const compEscaped = company.replace(/'/g, "\\'");
  const cardId = `plan-card-${company.replace(/[^a-zA-Z0-9]/g, '')}`;

  const newCardHTML = buildTinderCardHTML(cardId, plan, price, sumInsured, cColor, cLogo, compEscaped, newIndex, group.length, document.getElementById('sel-biz')?.value || '');

  // แทนที่การ์ดเก่าด้วยการ์ดใหม่
  const oldCard = document.getElementById(cardId);
  if (oldCard) {
    oldCard.outerHTML = newCardHTML;
    // เปิดการ์ดใหม่โดยอัตโนมัติ
    document.getElementById(cardId)?.classList.add('is-active');
  }
}

function getMarkSheetColumnIndex(company, plan, group) {
  if (!rawMarkData || rawMarkData.length < 3) return -1;

  const targetKeyStrict   = normalizeKey(company, plan, group);
  const targetKeyFallback = normalizeKey(company, plan, ""); 
  const compRow  = rawMarkData[0] || [];
  const planRow  = rawMarkData[1] || [];
  const groupRow = rawMarkData[2] || [];
  let lastComp = "";
  let fallbackIndex = -1;

  for (let i = 1; i < planRow.length; i++) {
    const cc = String(compRow[i] || '').trim();
    if (cc) lastComp = cc;
    if (!planRow[i]) continue;
    const currentGroup = String(groupRow[i] || '').trim();
    const ck = normalizeKey(lastComp, planRow[i], currentGroup);
    if (ck === targetKeyStrict) return i;
    if (!currentGroup && normalizeKey(lastComp, planRow[i], "") === targetKeyFallback) {
      fallbackIndex = i;
    }
  }
  return fallbackIndex;
}

  updateFavoritesButton();


/**
 * [FAV-LOG] Creates or retrieves a unique anonymous ID for the user from localStorage.
 */
function getOrCreateUserId() {
  let userId = localStorage.getItem('ttib_user_id');
  if (!userId) {
    // Generate a simple unique ID
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('ttib_user_id', userId);
  }
  return userId;
}

/**
 * [FAV-LOG] Sends the favorite plan data to Google Sheet for logging.
 * This is a "fire-and-forget" request to not block the user's UI.
 */
function logFavoriteToSheet(planData, isAdding) {
  // For now, we only log when a user *adds* a favorite.
  if (!isAdding) return;

  // Create a copy of the data and remove fields we don't want to log.
  const { sumInsured, premium, ...logData } = planData;

  const payload = {
    action: 'logFavorite',
    favoriteData: {
      userId: getOrCreateUserId(),
      timestamp: new Date().toLocaleString('th-TH'),
      // Send the cleaned data without sumInsured and premium
      ...logData
    }
  };

  try {
    // Using fetch with 'no-cors' for fire-and-forget logging.
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      mode: 'no-cors'
    });
    console.log('[FAV] Logged to sheet:', planData.plan);
  } catch (e) {
    // This is a non-critical error, so we just log it to the console.
    console.warn('Could not log favorite to sheet:', e);
  }
}

/**
 * [FAV] Adds or removes a plan from the favorites list.
 */
function toggleFavorite(labelEl) {
  // Find the parent container for this card
  const container = labelEl.closest('.plan-container');
  if (!container) return;

  // Get sum and premium from the display elements within the same card
  const sumEl = container.querySelector('.sum-insured-value');
  const premEl = container.querySelector('.premium-value-main');

  const planData = {
    business: labelEl.dataset.business, // [NEW] Save business name
    company:  labelEl.dataset.company,
    plan:     labelEl.dataset.plan,
    group:    labelEl.dataset.group,
    covType:  labelEl.dataset.covtype,
    category: labelEl.dataset.category,
    sumInsured: Number(sumEl?.dataset.value || '0'),
    premium:    Number(premEl?.dataset.value || '0'),
  };

  const planId = normalizeKey(planData.company, planData.plan, planData.group);
  const checkbox = labelEl.querySelector('input[type="checkbox"]');
  const isFavorited = checkbox.checked; // The state *after* the click

  const existingIndex = favoritePlans.findIndex(p => normalizeKey(p.company, p.plan, p.group) === planId);

  if (isFavorited && existingIndex === -1) {
    favoritePlans.push(planData);
    // --- [FAV-LOG] Log to Google Sheet ---
    logFavoriteToSheet(planData, true);
    // ------------------------------------
  } else if (!isFavorited && existingIndex > -1) {
    favoritePlans.splice(existingIndex, 1);
    // logFavoriteToSheet(planData, false); // Logging removal can be added later if needed
  }

  saveFavorites();
  updateFavoritesButton();
}

/**
 * [FAV] Saves the favorite plans to localStorage.
 */
function saveFavorites() {
  try {
    localStorage.setItem('ttib_favorite_plans', JSON.stringify(favoritePlans));
  } catch (e) {
    console.warn("Could not save favorites to localStorage:", e);
  }
}

/**
 * [FAV] Loads favorite plans from localStorage on startup.
 */
function loadFavorites() {
  try {
    const saved = localStorage.getItem('ttib_favorite_plans');
    if (saved) {
      favoritePlans = JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Could not load favorites from localStorage:", e);
    favoritePlans = [];
  }
  updateFavoritesButton();
}

/**
 * [FAV] Updates the favorite button UI with the count of saved plans.
 */
function updateFavoritesButton() {
  const favBtn = document.getElementById('btn-favorites');
  if (!favBtn) return;

  let countEl = favBtn.querySelector('.fav-count');
  if (!countEl) {
    countEl = document.createElement('span');
    countEl.className = 'fav-count';
    favBtn.appendChild(countEl);
  }

  if (favoritePlans.length > 0) {
    countEl.textContent = favoritePlans.length;
    countEl.classList.add('show');
  } else {
    countEl.classList.remove('show');
  }
}

/**
 * [FAV] Opens the modal to display the list of favorite plans.
 */
function openFavoritesModal() {
  const modal = document.getElementById('favoritesModal');
  if (!modal) return;
  modal.classList.add('active');
  const target = modal.querySelector('.modal-win');
  if (!target) return;

  // ทำให้ Modal เต็มหน้าจอสำหรับ Mobile
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    modal.style.padding = '0';
    Object.assign(target.style, { // ใช้ Object.assign เพื่อความกระชับ
      width: '100%',
      height: '100%',
      maxWidth: '100vw',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
    // ทำให้ส่วน body ของ modal สามารถ scroll ได้
    const bodyEl = target.querySelector('.m-body');
    if (bodyEl) {
      bodyEl.style.flex = '1';
    }
  }
  const uniqueBusinesses = new Set(favoritePlans.map(p => p.business).filter(Boolean));
  const businessCount = uniqueBusinesses.size;

  const clearBtnHtml = favoritePlans.length > 0 ?
    `<button class="btn-clear-favs" onclick="clearAllFavorites()">
      <i class="ti ti-trash"></i> ล้างทั้งหมด
    </button>` : '';

  const titleParts = [];
  if (businessCount > 0) {
    titleParts.push(`${businessCount} ธุรกิจ`);
  }
  if (favoritePlans.length > 0) {
    titleParts.push(`${favoritePlans.length} แผน`);
  }
  const titleCount = titleParts.length > 0 ? `(${titleParts.join(', ')})` : '';

  let contentHtml = `
    <div class="m-header" style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:16px 20px; position:sticky; top:0; z-index:10;">
      <h2 style="display:flex; align-items:center; gap:10px; font-size:16px; color:#1e293b;">
        <i class="ti ti-heart-filled" style="color:#F43F5E;"></i> 
        รายการโปรด ${titleCount}
      </h2>
      <div style="display:flex; align-items:center; gap:12px;">
        ${clearBtnHtml}
        <span class="m-close" onclick="this.closest('.modal-overlay').classList.remove('active')" style="font-size:24px;">&times;</span>
      </div>
    </div>`;

  if (favoritePlans.length === 0) {
    contentHtml += `<div style="text-align:center; padding:80px 20px; background:#fff;">
      <div style="width:120px; height:120px; background:#f1f5f9; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 25px;">
        <i class="ti ti-heart-broken" style="font-size:56px; color:#cbd5e1;"></i>
      </div>
      <p style="font-size:16px; color:#475569; font-weight:700;">ยังไม่มีแผนประกันที่บันทึกไว้</p>
      <p style="font-size:13px; color:#94a3b8; max-width:320px; margin:8px auto 0; line-height:1.6;">
        กดที่รูปหัวใจ <i class="ti ti-heart"></i> บนการ์ดแผนประกันเพื่อบันทึกแผนที่สนใจไว้ดูภายหลัง
      </p>
    </div>`;
  } else {
    const favListHtml = favoritePlans.map(item => {
      const cColor = getCompanyColor(item.company);
      const cLogo = COMPANY_LOGOS[item.company.toUpperCase()];
      const planId = normalizeKey(item.company, item.plan, item.group);
      const isChecked = favoritePlans.some(p => normalizeKey(p.company, p.plan, p.group) === planId);

      return `
        <div class="plan-summary fav-card" style="--brand-color: ${cColor}; width:100%; max-width:420px; margin:0 auto;">
          <label class="container" onclick="toggleFavorite(this); this.parentElement.remove(); event.stopPropagation()"
            data-business="${escapeHtml(item.business || '')}"
            data-company="${escapeHtml(item.company)}" data-plan="${escapeHtml(item.plan)}" data-group="${escapeHtml(item.group || '')}"
            data-covtype="${escapeHtml(item.covType || '')}" data-category="${escapeHtml(item.category || '')}"
            data-sum="${item.sumInsured}" data-premium="${item.premium}">
            <input type="checkbox" ${isChecked ? 'checked' : ''} />
            <div class="checkmark"><svg viewBox="0 0 256 256"><rect fill="none" height="256" width="256"></rect><path d="M224.6,51.9a59.5,59.5,0,0,0-43-19.9,60.5,60.5,0,0,0-44,17.6L128,59.1l-7.5-7.4C97.2,28.3,59.2,26.3,35.9,47.4a59.9,59.9,0,0,0-2.3,87l83.1,83.1a15.9,15.9,0,0,0,22.6,0l81-81C243.7,113.2,245.6,75.2,224.6,51.9Z" stroke-width="20px" stroke="#000" fill="none"></path></svg></div>
          </label>
          <div class="summary-header">
            <div class="summary-logo" style="width:60px; height:60px;">${cLogo ? `<img src="${cLogo}" alt="${escapeHtml(item.company)}">` : `<span>${escapeHtml(item.company)}</span>`}</div>
            <div class="summary-title">
              ${item.business ? `<div class="cs-tag" style="margin-bottom:6px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; font-size:11px;">${escapeHtml(item.business)}</div>` : ''}
              <div class="summary-company-name" style="font-size:14px;">${escapeHtml(item.company)}</div>
              <div class="plan-name" style="font-size:12px; color: var(--text-2);">${escapeHtml(item.plan)}</div>
              ${item.group ? `<div class="group-name">${escapeHtml(item.group)}</div>` : ''}
              ${item.covType ? `<div class="cs-tag cs-tag-type" style="margin-top:6px; font-size:10px;">${escapeHtml(item.covType)}</div>` : ''}
            </div>
          </div>
          <button type="button" class="btn-h" style="margin-top:12px; width:100%; height: 40px; font-size: 13px; border-radius: 10px;" onclick="goToUserForm('${escapeHtml(item.company)}', '${escapeHtml(item.plan)}', '${escapeHtml(item.group || '')}', '${escapeHtml(item.business || '')}', '${item.sumInsured || ''}')">
            <i class="ti ti-phone-call"></i>
            <span>สนใจแผนนี้</span>
          </button>
        </div>`;
    }).join('');
    contentHtml += `<div class="m-body fav-list-container">${favListHtml}</div>`;
  }

  target.innerHTML = contentHtml;
}

/**
 * [FAV] Clears all favorite plans and refreshes the modal.
 */
async function clearAllFavorites() {
  if (confirm(`คุณต้องการล้างรายการโปรดทั้งหมด ${favoritePlans.length} รายการใช่หรือไม่?`)) {
    const userId = getOrCreateUserId(); // ดึง User ID มาก่อนล้าง

    favoritePlans = [];
    saveFavorites();
    updateFavoritesButton();

    // [FIX] ล้างสถานะหัวใจบนการ์ดที่แสดงผลอยู่ทั้งหมด
    document.querySelectorAll('.plan-summary .container input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = false;
    });

    openFavoritesModal(); // Re-render the modal to show the empty state

    // [NEW] ส่งคำสั่งลบข้อมูลไปยัง Google Sheet
    try {
      const payload = {
        action: 'clearUserFavorites',
        userId: userId
      };
      // ใช้ fetch แบบปกติ (ไม่ใช่ no-cors) เพื่อรอการตอบกลับและจัดการข้อผิดพลาดได้
      await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          mode: 'no-cors'  // [FIX]
      });
      const result = await response.json();
      if (result.status === 'ok') {
        console.log(`[FAV] Cleared favorites for user ${userId} from Google Sheet.`);
      } else {
        throw new Error(result.message || 'Unknown error from Apps Script');
      }
    } catch (e) {
      console.log(`[FAV] Cleared favorites for user ${userId} from Google Sheet.`);
      // อาจจะมีการแจ้งเตือนผู้ใช้เพิ่มเติมถ้าจำเป็น
    }
  }
}

// =============================================================================
// DETAIL MODAL (READ-ONLY)
// =============================================================================


// =============================================================================
// DETAIL MODAL (READ-ONLY)
// =============================================================================

function openDetailModal() {
  const el = document.getElementById('detailModal');
  console.log('openDetailModal() ถูกเรียกใช้งาน');
  if (!el) return;
  el.classList.add('active');
  renderDetailModalContent();

  // ปรับแต่ง Modal รายละเอียดให้แสดงผลเต็มหน้าจอ (Full Screen)
  const modalWin = el.querySelector('.modal-win');
  if (modalWin) {
    el.style.padding = '0';
    Object.assign(modalWin.style, {
      maxWidth: '100%',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      borderRadius: '0',
      margin: '0',
      display: 'flex',
      flexDirection: 'column'
    });
    const area = modalWin.querySelector('#modal-table-area');
    if (area) {
      Object.assign(area.style, { height: '100%', display: 'flex', flexDirection: 'column' });
    }
  }
}

function closeDetailModal() {
  const el = document.getElementById('detailModal');
  if (el) el.classList.remove('active');
  // Memory cleanup: ล้างเนื้อหา HTML ขนาดใหญ่ทันทีเพื่อให้ Garbage Collector ทำงานได้ง่ายขึ้น
  const target = document.getElementById('modal-table-area');
  if (target) {
    target.innerHTML = '';
  }
}

/**
 * ค้นหาลำดับคอลัมน์ใน Sheet รายละเอียดความคุ้มครอง โดยรองรับระบบ Fallback
 * เพื่อให้การดึงข้อมูลแม่นยำแม้ชื่อกลุ่มธุรกิจหรือชื่อแผนจะมีการเว้นวรรคที่ต่างกัน
 * 
 * @param {string} companyName - ชื่อบริษัทประกัน (AAGI, BKI, etc.)
 * @param {string} planName - ชื่อแผนประกันภัย
 * @param {string} groupName - ชื่อกลุ่มธุรกิจ (SME, Retail, etc.)
 * @returns {number} ลำดับคอลัมน์ (Column Index) หรือ -1 หากไม่พบข้อมูล
 */
function getDetailSheetColumnIndex(companyName, planName, groupName) {
  // [FIX] ป้องกันปัญหา groupName เป็น null หรือ undefined ทำให้ Cache Key ผิดพลาด
  const gName = (groupName === null || groupName === undefined) ? "" : groupName;

  const targetKey = normalizeKey(companyName, planName, gName);
  if (_detailColCache[targetKey] !== undefined) return _detailColCache[targetKey];

  // 1. ตรวจสอบความพร้อมของข้อมูลและ Cache
  if (!globalDetailRows || globalDetailRows.length < 3) return -1;

  // 2. เตรียมข้อมูลแถวหัวตาราง
  const compRow  = globalDetailRows[0] || [];
  const planRow  = globalDetailRows[1] || [];
  const groupRow = globalDetailRows[2] || [];
  const maxCols  = Math.max(compRow.length, planRow.length, groupRow.length);

  // 3. เริ่มการค้นหาแบบลำดับขั้น
  let lastCompany = "";
  let exactIdx    = -1;
  let fallback1   = -1; // Fallback 1: บริษัทตรง + แผนตรง (ไม่สนกลุ่ม)
  let fallback2   = -1; // Fallback 2: แผนตรงอย่างเดียว

  // Normalize ข้อมูลเป้าหมายล่วงหน้า
  const targetCompNorm = normalize(companyName);
  const targetPlanNorm = normalize(planName);

  for (let i = 1; i < maxCols; i++) {
    const currentCompRaw  = String(compRow[i]  || '').trim();
    const currentPlanRaw  = String(planRow[i]  || '').trim();
    const currentGroupRaw = String(groupRow[i] || '').trim();

    if (currentCompRaw) lastCompany = currentCompRaw;
    if (!currentPlanRaw) continue;

    const currentCompNorm = normalize(lastCompany);
    const currentPlanNorm = normalize(currentPlanRaw);

    // ระดับ 1: จับคู่แบบแม่นยำ (Exact Match)
    const currentKey = normalizeKey(lastCompany, currentPlanRaw, currentGroupRaw);
    if (currentKey === targetKey) {
      exactIdx = i;
      break; // พบผลลัพธ์ที่ดีที่สุดแล้ว ออกจาก Loop
    }

    // ระดับ 2: จับคู่ บริษัท + แผน (Fallback 1)
    if (fallback1 === -1 && currentCompNorm === targetCompNorm && currentPlanNorm === targetPlanNorm) {
      fallback1 = i;
    }

    // ระดับ 3: จับคู่ชื่อแผนเพียงอย่างเดียว (Fallback 2)
    if (fallback2 === -1 && currentPlanNorm === targetPlanNorm) {
      fallback2 = i;
    }
  }

  // 4. เลือก Index ที่ดีที่สุดและบันทึกลง Cache
  const finalIdx = exactIdx !== -1 ? exactIdx : (fallback1 !== -1 ? fallback1 : fallback2);
  _detailColCache[targetKey] = finalIdx;

  return finalIdx;
}

// [PATCH] renderDetailModalContent — ยกเลิกการแยก isSection/header หมวดหมู่ทั้งหมด
function renderDetailModalContent(searchTerm="") {
  const target = document.getElementById('modal-table-area');
  if (!target) return;

  // ค้นหาคำค้นหาปัจจุบัน (ถ้ามี) เพื่อให้การ Render ใหม่ไม่ทำลายสิ่งที่พิมพ์ค้างไว้
  const searchInp = document.querySelector('.m-header input[type=text]');
  if (searchTerm === "" && searchInp) {
    searchTerm = searchInp.value;
  }

  const showDiff = document.getElementById('chk-diff-only')?.checked || false;

  // ตรวจสอบสถานะการเลือกบริษัทจาก Checkbox เดิมใน DOM (ถ้ามี)
  const allPlans = globalCurrentRenderedPlans;
  let selectedIndices = [];
  const existingChecks = document.querySelectorAll('.dt-plan-chk');
  if (existingChecks.length > 0) {
    existingChecks.forEach(cb => { if (cb.checked) selectedIndices.push(parseInt(cb.value)); });
  } else {
    // ครั้งแรกที่เปิด ให้เลือกทุกบริษัทเป็นค่าเริ่มต้น
    allPlans.forEach((_, i) => selectedIndices.push(i));
  }

  const selectedBiz = document.getElementById('sel-biz')?.value||"ไม่ระบุ";
  const sumInput    = document.getElementById('inp-sum')?.value||"";
  const sumDisplay  = sumInput ? Number(sumInput.replace(/,/g,'')).toLocaleString('th-TH')+' บาท' : 'ไม่ระบุ';
  const s = searchTerm.trim().toLowerCase();

  // สร้างรายการ Checkbox สำหรับเลือกบริษัท (รูปแบบการ์ดเหมือน renderComparisonQuoteContent)
  const planChecklist = allPlans.map((p, i) => {
    const isChecked = selectedIndices.includes(i);
    const cColor = getCompanyColor(p.company);
    const cLogo  = COMPANY_LOGOS[p.company.toUpperCase()];
    return `
      <label style="display:flex; align-items:center; gap:12px; padding:10px 16px; background:#fff; border:1.5px solid ${isChecked ? cColor : '#e2e8f0'}; border-radius:12px; cursor:pointer; min-width:260px; transition:all 0.2s; flex-shrink:0; box-shadow: ${isChecked ? '0 4px 12px '+cColor+'15' : 'none'};" onmouseover="this.style.background='#f8fafc'">
        <input type="checkbox" class="dt-plan-chk" id="dt-chk-${i}" value="${i}" ${isChecked ? 'checked' : ''} 
               onchange="renderDetailModalContent(document.querySelector('.dt-modal-header input[type=text]')?.value || '')" 
               style="width:20px; height:20px; accent-color:${cColor}; cursor:pointer; flex-shrink:0;">
        <div style="width:60px; display:flex; justify-content:center;">
          ${cLogo ? `<img src="${cLogo}" style="height:24px; max-width:100%; object-fit:contain;">` : `<span style="background:${cColor}; color:#fff; font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px;">${escapeHtml(p.company)}</span>`}
        </div>
        <div style="flex:1; overflow:hidden;">
          <div style="font-size:14px; font-weight:700; color:${isChecked ? cColor : '#1e293b'}; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(p.plan)}</div>
          <div style="font-size:11px; color:#64748b;">${escapeHtml(p.covType || 'Package')}</div>
        </div>
      </label>
    `;
  }).join('');
  
  let html = `<div class="m-header dt-modal-header" style="border-bottom:1px solid #e2e8f0;padding:15px 24px;margin-bottom:0;background:#fff;border-radius:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px; position:sticky; top:0; z-index:102;">
    <div style="display:flex;align-items:center;gap:20px;flex:1;min-width:300px;">
      <div>
        <h2 style="margin:0;font-size:20px;color:#1e293b;"><i class="ti ti-list-details" style="color:#185FA5;"></i> รายละเอียดความคุ้มครอง</h2>
        <div style="font-size:18px;color:#64748b;margin-top:2px;">ธุรกิจ: <span style="color:#0f766e;font-weight:700;">${escapeHtml(selectedBiz)}</span></div>
      </div>
      <div style="position:relative;flex:1;max-width:280px;">
        <i class="ti ti-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8; z-index:10;"></i>
        <input type="text" placeholder="ค้นหาความคุ้มครอง..." value="${escapeHtml(searchTerm)}" oninput="renderDetailModalContent(this.value)"
          style="width:100%;padding:10px 12px 10px 38px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:13px;font-family:inherit;outline:none;background:#f8fafc;transition:border-color 0.2s; position:relative; z-index:1;"
          onfocus="this.style.borderColor='#185FA5'" onblur="this.style.borderColor='#e2e8f0'">
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:13px;color:#475569;background:#fff;padding:8px 14px;border-radius:12px;border:1px solid #e2e8f0;transition:all 0.2s;box-shadow:var(--sh-sm);" onmouseover="this.style.background='#f8fafc'">
        <input type="checkbox" id="chk-diff-only" onchange="renderDetailModalContent(document.querySelector('.dt-modal-header input[type=text]')?.value || '')" ${showDiff ? 'checked' : ''} style="width:16px;height:16px;accent-color:#185FA5;cursor:pointer;">
        <span style="font-weight:700;">ไฮไลต์ความต่าง</span>
      </label>
    </div>
    <span class="m-close" onclick="closeDetailModal()" style="font-size:28px;color:#94a3b8;cursor:pointer;">&times;</span>
  </div>
  <div class="dt-plan-checklist-bar" style="display:flex; gap:15px; overflow-x:auto; padding:15px 24px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; align-items:center; scrollbar-width:thin; position:sticky; top:var(--dt-modal-header-height, 70px); z-index:101;">
    <div style="display:flex; flex-direction:column; gap:4px; margin-right:10px; border-right:2px solid #cbd5e1; padding-right:15px; flex-shrink:0;">
      <span style="font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase; white-space:nowrap; letter-spacing:0.5px;">เลือกแสดงผล</span>
      <div style="display:flex; gap:10px;">
        <button onclick="toggleAllDetailPlans(true)" style="background:none; border:none; color:#185FA5; font-size:12px; font-weight:700; cursor:pointer; padding:0; text-decoration:underline;">ทั้งหมด</button>
        <button onclick="toggleAllDetailPlans(false)" style="background:none; border:none; color:#64748b; font-size:12px; font-weight:700; cursor:pointer; padding:0; text-decoration:underline;">ล้างค่า</button>
      </div>
    </div>
    ${planChecklist}
  </div>
  <div style="overflow:auto;flex:1;background:#f8fafc; position:relative;">`;

  const activePlans = allPlans.filter((_, i) => selectedIndices.includes(i));

  if (!allPlans.length || !globalDetailRows.length) {
    console.warn('renderDetailModalContent: ไม่พบข้อมูลแผนประกันภัย หรือข้อมูลรายละเอียด');
    html += '<div style="text-align:center;padding:80px 20px;color:#64748b;background:#fff;"><div style="font-size:40px;margin-bottom:15px;">🔍</div><div style="font-size:16px;font-weight:600;">ไม่พบข้อมูลแผนประกันภัย</div></div>';
  } else if (!activePlans.length) {
    console.warn('renderDetailModalContent: ไม่ได้เลือกแผนประกันภัยที่ใช้งานอยู่เพื่อแสดงผล');
    html += '<div style="text-align:center;padding:80px 20px;color:#64748b;background:#fff;"><div style="font-size:40px;margin-bottom:15px;">📋</div><div style="font-size:16px;font-weight:600;">กรุณาเลือกอย่างน้อย 1 บริษัทเพื่อดูรายละเอียด</div></div>';
  } else {
    const planMeta = activePlans.map(p => ({
      planObj:p, colIdx:getDetailSheetColumnIndex(p.company,p.plan,p.group), color:getCompanyColor(p.company)
    }));
    const typeFilter = getInsuranceTypeFilter(allPlans);
    let currentTypeFilterActive = true;

    html += `<table style="width:100%;border-collapse:separate;border-spacing:0;text-align:left;background:#fff;table-layout:fixed; position:relative;">
      <thead style="position:sticky;top:0;z-index:100;background:#fff;">
        <tr><th style="padding:20px 16px;width:260px;background:#f8fafc;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;color:#475569;font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">รายการความคุ้มครอง</th>`;
    activePlans.forEach(p => {
      const cColor = getCompanyColor(p.company);
      const cLogo  = COMPANY_LOGOS[p.company.toUpperCase()];
      html += `<th style="padding:16px 12px;width:200px;border-bottom:4px solid ${cColor};text-align:center;border-right:1px solid #e2e8f0;background:#fff;vertical-align:top;">
        ${cLogo?`<img src="${cLogo}" style="height:32px;max-width:100%;object-fit:contain;margin-bottom:8px;">`:`<div style="background:${cColor};color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:6px;display:inline-block;margin-bottom:8px;">${escapeHtml(p.company)}</div>`}
        <div style="font-size:13px;color:#1e293b;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.plan)}</div>
        ${p.group?`<div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px;">กลุ่ม: ${escapeHtml(p.group)}</div>`:''}
      </th>`;
    });
    html += '</tr></thead><tbody>';

    // ตัวแปรสำหรับเช็คความเปลี่ยนแปลงของหมวดหมู่ในการวาด Section Header
    let lastCategory = "";

    for (let r=3; r<globalDetailRows.length; r++) {
      const row = globalDetailRows[r];
      if (!row) continue;

      // อ่านค่าคอลัมน์ A (หมวดหมู่) และคอลัมน์ B (หัวข้อความคุ้มครอง) พร้อมทำความสะอาดเว้นวรรคส่วนเกินเพื่อความแม่นยำของลำดับตัวเลข
      const category = row[0] ? String(row[0]).trim().replace(/\s+/g, ' ') : ""; 
      const topic    = row[1] ? String(row[1]).trim() : ""; 
      const rowText = (String(row[0]||'') + String(row[1]||'')).toLowerCase();

      // [FIX] ตรวจสอบหมวดหมู่ประเภทภัยและแสดงแถวหัวข้อ (All Risk / Named Perils)
      if (/ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)/i.test(rowText)) { 
        currentTypeFilterActive = typeFilter.showAll || typeFilter.isAllRisk; 
        if (currentTypeFilterActive) {
          html += `<tr style="background:#eff6ff;"><td colspan="${activePlans.length + 1}" style="padding:15px 16px; font-weight:800; color:#185FA5; border-bottom:2px solid #dbeafe; font-size:14px;"><i class="ti ti-shield-check"></i> ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)</td></tr>`;
        }
        continue; 
      }
      if (/ประกันแบบระบุภัย (Named Perils)/i.test(rowText)) { 
        currentTypeFilterActive = typeFilter.showAll || typeFilter.isFire; 
        if (currentTypeFilterActive) {
          html += `<tr style="background:#fefce8;"><td colspan="${activePlans.length + 1}" style="padding:15px 16px; font-weight:800; color:#854d0e; border-bottom:2px solid #fef08a; font-size:14px;"><i class="ti ti-flame"></i> ประกันแบบระบุภัย (Named Perils)</td></tr>`;
        }
        continue; 
      }

      if (!topic) continue;
      if (!currentTypeFilterActive) continue;

      // ค้นหาคำค้นหา (รวมถึงค้นหาจากชื่อหมวดหมู่ตัวเลขได้ด้วย เช่น พิมพ์ "1.1")
      const isMatch = !s || topic.toLowerCase().includes(s) || category.toLowerCase().includes(s);
      if (!isMatch) continue;

      let hasAnyValidData = false;
      const planMatches = [];
      planMeta.forEach(meta => {
        const dv  = getDetailCellValue(row, meta.colIdx);
        const ok  = isValidCoverage(dv);
        if (ok) hasAnyValidData = true;
        planMatches.push({ planObj:meta.planObj, detailVal:escapeHtml(dv), isCovered:ok, color:meta.color });
      });

      if (!hasAnyValidData) continue;

      // แทรกแถวหมวดหมู่ (Section Header Row) เมื่อรหัส/ชื่อหมวดหมู่หลักมีการเปลี่ยนแปลงตามลำดับแถว
      if (category && category.toLowerCase() !== lastCategory.toLowerCase()) {
        html += `<tr>
          <td colspan="${activePlans.length + 1}" style="padding: 12px 16px; background: #f1f5f9; color: #1e293b; font-weight: 700; font-size: 13px; border-bottom: 1px solid #cbd5e1; border-top: 1px solid #cbd5e1; text-align: left;">
            <span style="color: #185FA5; font-weight: 900; margin-right: 6px;">■</span> ${escapeHtml(category)}
          </td>
        </tr>`;
        lastCategory = category;
      }

      // ตรวจสอบความต่างระหว่างแผนในแถวนี้
      const values = planMatches.map(p => p.isCovered ? p.detailVal.trim().toLowerCase() : '—');
      const isDifferent = new Set(values).size > 1;

      // กำหนด Style สำหรับแถวที่ต่างกัน
      const rowStyle = (isDifferent && showDiff) ? 'background:#fffbeb;' : '';
      const diffBadge = (isDifferent && showDiff) ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:2px 5px;border-radius:4px;margin-left:8px;font-weight:800;vertical-align:middle;border:1px solid #fcd34d;">DIFF</span>' : '';

      html += `<tr style="${rowStyle}" onmouseover="this.style.background='${(isDifferent && showDiff) ? '#fef9c3' : '#f0f9ff'}'" onmouseout="this.style.background='${(isDifferent && showDiff) ? '#fffbeb' : 'transparent'}'">
        <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;border-right:1px solid #e2e8f0;color:#475569;font-weight:600;font-size:13px; padding-left: 24px;">${escapeHtml(topic)}${diffBadge}</td>`;
      planMatches.forEach(pd => {
        const cellValStyle = (isDifferent && showDiff) ? 'font-weight:700;color:#1e293b;' : '';
        html += pd.isCovered
          ? `<td style="padding:14px 12px;border-bottom:1px solid #f1f5f9;border-right:1px solid #e2e8f0;text-align:center;font-size:13px;font-weight:500;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="color:#10b981;font-size:18px;font-weight:900;"><i class="ti ti-circle-check-filled"></i></span><span style="${cellValStyle}">${pd.detailVal}</span></div></td>`
          : `<td style="padding:14px 12px;border-bottom:1px solid #f1f5f9;border-right:1px solid #e2e8f0;text-align:center;color:#cbd5e1;font-size:14px;"><i class="ti ti-minus"></i></td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
  }

  html += `</div><div style="padding:18px 24px;background:#fff;text-align:right;border-radius:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div style="font-size:12px;color:#94a3b8;">* รายละเอียดนี้ใช้เพื่อการเปรียบเทียบเบื้องต้นเท่านั้น</div>
    <div style="display:flex;gap:10px;">
      <button onclick="exportDetailPDF()" style="background:#0f766e;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:700;cursor:pointer;font-family:'Sarabun',sans-serif;display:flex;align-items:center;gap:8px;"><i class="ti ti-printer"></i> พิมพ์รายละเอียด</button>
      <button onclick="closeDetailModal()" style="background:#1e293b;color:#fff;border:none;padding:10px 30px;border-radius:10px;font-weight:700;cursor:pointer;font-family:'Sarabun',sans-serif;"><i class="ti ti-x"></i> ปิด</button>
    </div>
  </div>`;
  target.innerHTML = html;

  // คืนค่า Focus ให้ช่องค้นหาหลังจาก Render ใหม่เพื่อให้พิมพ์ต่อเนื่องได้
  const inp = target.querySelector('.m-header input[type="text"]');
  if (inp && searchTerm !== "") {
    inp.focus();
    inp.setSelectionRange(searchTerm.length, searchTerm.length);
  }

  // Calculate header height and set CSS variable for sticky positioning
  const headerEl = target.querySelector('.dt-modal-header');
  if (headerEl) {
    // Use requestAnimationFrame to ensure layout is stable before measuring
    requestAnimationFrame(() => {
      let headerHeight = headerEl.offsetHeight;
      if (headerHeight <= 0) {
        // หากยังวัดค่าไม่ได้ (เช่น อยู่ระหว่าง Transition) ให้ลองใหม่ในเฟรมถัดไป
        requestAnimationFrame(() => {
          headerHeight = headerEl.offsetHeight;
          if (headerHeight > 0) document.documentElement.style.setProperty('--dt-modal-header-height', `${headerHeight}px`);
        });
      } else {
        document.documentElement.style.setProperty('--dt-modal-header-height', `${headerHeight}px`);
      }
    });
  }
}


/**
 * เปิดหน้าต่างแชร์ใบเสนอราคา (Share Modal) สำหรับผู้ใช้
 */
function openShareQuoteModal(data) {
  const quote = data || window._currentQuoteData; // Removed || window._lastQuoteData as it's never assigned
  if (!quote) { alert('ไม่พบข้อมูลใบเสนอราคา'); return; }

  // สร้าง Web Link (Online Quote) โดยอ้างอิงตำแหน่งโฟลเดอร์ปัจจุบัน
  const baseUrl = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/') + '/user.html';
  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(quote))));
  const webLink = `${baseUrl}?quote=${encodedData}`;

  const msg = `ใบเสนอราคาประกันภัยจาก TTIB\nเสนอแก่: คุณ${quote.customer}\nแผน: ${quote.plan}\nเบี้ยรวม: ${quote.premium}\n\nดูรายละเอียดออนไลน์ได้ที่นี่:\n${webLink}`;
  const encodedMsg = encodeURIComponent(msg);

  const overlay = document.createElement('div');
  overlay.id = 'share-quote-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="modal-win" style="max-width:450px; width:100%; border-radius:20px; overflow:hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; background:#fff;">
      <div class="m-header" style="background:#fff; border-bottom:1px solid #f1f5f9; padding:16px 20px; display:flex; justify-content:space-between; align-items:center;">
        <h2 style="font-size:16px; font-weight:800; color:#1e293b; margin:0;"><i class="ti ti-share" style="color:#4258d3;"></i> แชร์ใบเสนอราคา</h2>
        <span onclick="this.closest('#share-quote-overlay').remove()" style="cursor:pointer; font-size:24px; color:#94a3b8; line-height:1;">&times;</span>
      </div>
      <div class="m-body" style="padding:24px;">
        <div style="background:#f8fafc; border-radius:12px; padding:15px; margin-bottom:20px; border:1px solid #e2e8f0;">
          <div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">ข้อความที่จะแชร์</div>
          <div style="font-size:13px; color:#475569; white-space:pre-wrap; line-height:1.6; max-height:100px; overflow-y:auto;">${escapeHtml(msg)}</div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <a href="https://line.me/R/msg/text/?${encodedMsg}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#06C755; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-brand-line" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">LINE</span>
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(webLink)}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#1877F2; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-brand-facebook" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Facebook</span>
          </a>
          <a href="mailto:?subject=${encodeURIComponent('ใบเสนอราคาประกันภัย - TTIB')}&body=${encodedMsg}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#ef4444; color:#fff; border-radius:12px; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-mail" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Email</span>
          </a>
          <button type="button" id="copy-quote-link-btn" data-link="${escapeHtml(webLink)}" style="border:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; background:#185FA5; color:#fff; border-radius:12px; transition:transform 0.2s; font-family:inherit;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <i class="ti ti-link" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">คัดลอกลิงก์</span>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });

  // ผูก Event Listener สำหรับปุ่มคัดลอกลิงก์
  const copyWeblinkBtn = document.getElementById('copy-quote-link-btn');
  if (copyWeblinkBtn) {
    copyWeblinkBtn.addEventListener('click', () => {
      copyToClipboard(copyWeblinkBtn.dataset.link, 'คัดลอกลิงก์ใบเสนอราคาสำเร็จ!');
    });
  }
}

/**
 * คัดลอกข้อความลง Clipboard พร้อมแจ้งเตือน
 */
function copyToClipboard(text, successMsg) {
  if (!navigator.clipboard) {
    // Fallback สำหรับ browser รุ่นเก่า
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      if (successMsg) alert(successMsg);
    } catch (err) { console.error('Fallback copy failed', err); }
    document.body.removeChild(textArea);
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    if (successMsg) alert(successMsg);
  }).catch(err => console.error('Failed to copy: ', err));
}

// =============================================================================
// COMPARISON QUOTE MODAL
// =============================================================================

function openComparisonQuoteModal(leadData = null) {
  const modal=document.getElementById('compareQuoteModal');
  console.log('openComparisonQuoteModal() ถูกเรียกใช้งาน');
  if(!modal) return;

  if (leadData) modal.dataset.leadData = JSON.stringify(leadData);
  else delete modal.dataset.leadData;

  modal.classList.add('active');
  renderComparisonQuoteContent(leadData);
}

function closeComparisonQuoteModal() {
  const m=document.getElementById('compareQuoteModal');
  if(m) m.classList.remove('active');
}


function renderComparisonQuoteContent(passedLeadData = null) {
  const modal=document.getElementById('compareQuoteModal');
  if(!modal) return;
  const target=modal.querySelector('.modal-win');
  if(!target) return;

  // [FIX] จำสถานะ Checkbox เดิมไว้ก่อนโดนเขียนทับ (เพื่อไม่ให้ตารางหายเวลาพิมพ์ข้อมูล)
  const prevShowDetails = document.getElementById('cq-show-details')?.checked || false;
  const prevHighlight   = document.getElementById('cq-highlight-diff')?.checked || false;

  // เพิ่มเงื่อนไข: ต้องมีการกรอกข้อมูลผู้ติดต่อก่อนเข้าดูตารางเปรียบเทียบ (Lead Gate)
  const biz  = passedLeadData ? (passedLeadData.business || passedLeadData.bizName) : (document.getElementById('sel-biz')?.value || 'ไม่ระบุ');
  const sum  = passedLeadData ? passedLeadData.sum : (document.getElementById('inp-sum')?.value || '');
  
  // ตรวจสอบให้แน่ใจว่า activePlans เป็น Array
  const activePlans = Array.isArray(window.activeMultiCards) ? window.activeMultiCards : [];

  if(!activePlans.length){
    console.warn('renderComparisonQuoteContent: ไม่พบแผนประกันภัยที่ใช้งานอยู่สำหรับการเปรียบเทียบ');
    target.innerHTML=`<div class="m-header"><h2>ตารางเปรียบเทียบแผนประกัน</h2><span class="m-close" onclick="closeComparisonQuoteModal()">&times;</span></div><div style="text-align:center;padding:60px 20px;color:#94a3b8;"><div style="font-size:40px;margin-bottom:12px;">📋</div><div style="font-size:15px;font-weight:600;">กรุณาเลือกประเภทธุรกิจเพื่อเริ่มการเปรียบเทียบ</div></div>`;
    return;
  }

  const checklist=activePlans.map((d,i)=>{
    const cColor=getCompanyColor(d.plan.company);
    const cLogo=COMPANY_LOGOS[d.plan.company.toUpperCase()];
    return `<label for="cq-chk-${i}" style="display:flex;align-items:center;gap:15px;padding:14px 18px;background:#fff;border:1.5px solid #e2e8f0;border-radius:14px;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 5px rgba(0,0,0,0.02);" onmouseover="this.style.borderColor='${cColor}';this.style.background='#fcfdfe';" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#fff';">
      <input type="checkbox" id="cq-chk-${i}" value="${i}" checked onchange="updateComparisonUI()" style="width:22px;height:22px;accent-color:${cColor};cursor:pointer;flex-shrink:0;">
      <div style="width:70px;height:40px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:8px;padding:4px;border:1px solid #f1f5f9;">
      ${cLogo?`<img src="${cLogo}" style="max-height:100%;max-width:100%;object-fit:contain;">`:`<span style="background:${cColor};color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;text-align:center;">${escapeHtml(d.plan.company)}</span>`}
      </div>
      <div style="flex:1;overflow:hidden;">
        <div style="font-size:14px;font-weight:800;color:#1e293b;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;">${escapeHtml(d.plan.plan)}</div>
        <div style="font-size:11px;color:#64748b;font-weight:600;">${escapeHtml(d.plan.covType||'Package')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
        <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:2px;">เบี้ยเริ่มต้น</div>
        <div style="font-size:16px;font-weight:800;color:${cColor};line-height:1.2;">${d.premium>0?fmt(d.premium)+' บาท':'ติดต่อเจ้าหน้าที่'}</div>
        <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-top:2px;">ต่อปี</div>
      </div>
    </label>`;
  }).join('');

  target.innerHTML=`
    <div class="m-header" style="border-bottom:1px solid #e2e8f0;padding:15px 24px;margin-bottom:0;background:#fff;border-radius:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px; position:sticky; top:0; z-index:102;">
      <div style="display:flex;align-items:center;gap:10px;">
        <h2 style="margin:0;font-size:20px;color:#1e293b;"><i class="ti ti-table-column" style="color:#185FA5;"></i> เปรียบเทียบแผนประกันภัย</h2>
        <div style="font-size:20px;color:#64748b;margin-top:2px;">ธุรกิจ: <span style="color:#0f766e;font-weight:700;">${escapeHtml(biz)}</span></div>
      </div>
      <span class="m-close" onclick="closeComparisonQuoteModal()" style="font-size:28px;color:#94a3b8;cursor:pointer;">&times;</span>
    </div>
    <div style="padding:24px;background:#f8fafc;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding:0 5px; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; gap:10px; align-items:center;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; font-size:13px; color:#475569; background:#fff; padding:8px 14px; border-radius:10px; border:1px solid #e2e8f0; transition:all 0.2s;" onmouseover="this.style.background='#f8fafc'">
            <input type="checkbox" id="cq-highlight-diff" onchange="updateComparisonUI()" ${prevHighlight ? 'checked' : ''} style="width:16px; height:16px; accent-color:#185FA5; cursor:pointer;">
            <span style="font-weight:700;">ไฮไลต์ความต่าง</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; font-size:13px; color:#475569; background:#fff; padding:8px 14px; border-radius:10px; border:1px solid #e2e8f0; transition:all 0.2s;" onmouseover="this.style.background='#f8fafc'">
            <input type="checkbox" id="cq-show-details" onchange="updateComparisonUI()" ${prevShowDetails ? 'checked' : ''} style="width:16px; height:16px; accent-color:#185FA5; cursor:pointer;">
            <span style="font-weight:700;">แสดงตัวอย่างตาราง</span>
          </label>
        </div>
        <div style="display:flex; gap:8px;">
          <button onclick="_toggleAllCheckboxes(true, '[id^=cq-chk-]', updateComparisonUI)" style="background:none; border:none; color:#185FA5; font-size:12px; font-weight:700; cursor:pointer; text-decoration:underline;">เลือกทั้งหมด</button>
          <button onclick="_toggleAllCheckboxes(false, '[id^=cq-chk-]', updateComparisonUI)" style="background:none; border:none; color:#64748b; font-size:12px; font-weight:700; cursor:pointer; text-decoration:underline;">ล้างทั้งหมด</button>
        </div>
      </div>
      <div style="max-height:35vh;overflow-y:auto;display:grid;grid-template-columns:1fr;gap:10px;padding-right:5px;">${checklist}</div>
      <div id="cq-detail-table-wrap" style="display:none; margin-top:20px; background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:auto; max-height:40vh;"></div>
      <div style="display:flex;gap:12px;margin-top:24px;">
        <button onclick="exportComparisonPDF()" style="flex:2;background:#185FA5;color:#fff;border:none;padding:16px;border-radius:14px;font-size:15px;font-weight:800;cursor:pointer;font-family:'Sarabun',sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 8px 20px rgba(15,23,42,0.2);">
          <i class="ti ti-printer" style="font-size:20px;"></i> สร้างตารางเปรียบเทียบ (PDF)
        </button>
        <button onclick="closeComparisonQuoteModal()" style="flex:1;background:#fff;color:#64748b;border:1.5px solid #e2e8f0;padding:16px;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:'Sarabun',sans-serif;">ยกเลิก</button>
      </div>
    </div>`;

  // [FIX] สั่งอัปเดต UI ทันทีหลัง Render เสร็จ เพื่อวาดตารางพรีวิว (ถ้าเคยเปิดไว้)
  if (prevShowDetails) updateComparisonUI();
}

// =============================================================================
// PDF EXPORTS
// =============================================================================

function exportDetailPDF() {
  const selectedBiz=document.getElementById('sel-biz')?.value||"ไม่ระบุ";
  const sumInput=document.getElementById('inp-sum')?.value||"";
  const sumDisplay=sumInput?Number(sumInput.replace(/,/g,'')).toLocaleString('th-TH')+' THB':'ไม่ระบุ'; // Fixed: used sumInput instead of undefined selectedSumForPrice
  if(!globalCurrentRenderedPlans.length||!globalDetailRows.length){alert("⚠️ ไม่พบข้อมูล");return;}
  const win=window.open('','_blank');
  if(!win){alert("❌ Browser บล็อก popup");return;}

  const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const planMeta=globalCurrentRenderedPlans.map(p=>({planObj:p,colIdx:getDetailSheetColumnIndex(p.company,p.plan,p.group),color:getCompanyColor(p.company)}));

  // สร้างส่วนหัวของตาราง (บริษัทประกัน)
  let headerHtml=`<th class="topic-header" style="width:250px; background:#f8fafc; border-bottom:3px solid #e2e8f0; padding:20px; text-align:left;">รายการความคุ้มครอง (Coverage Description)</th>`;
  planMeta.forEach(meta=>{
    const p=meta.planObj;
    const cLogo = COMPANY_LOGOS[p.company.toUpperCase()];
    headerHtml+=`
      <th style="border-bottom:4px solid ${meta.color}; text-align:center; padding:15px; background:#fff; vertical-align:top; height:140px;">
        <div style="height:70px; display:flex; align-items:center; justify-content:center; margin-bottom:10px;">
          ${cLogo ? `<img src="${cLogo}" style="max-height:60px; max-width:140px; object-fit:contain; filter: contrast(1.1);">` : `<span style="background:${meta.color}; color:#fff; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800;">${escapeHtml(p.company)}</span>`}
        </div>
        <div style="font-size:13px; font-weight:800; color:#0f172a;">${escapeHtml(p.company)}</div>
        <div style="font-size:11px; font-weight:600; color:#64748b; margin-top:2px;">${escapeHtml(p.plan)}</div>
      </th>`;
  });

  const typeFilter=getInsuranceTypeFilter(globalCurrentRenderedPlans);
  let currentTypeFilterActive=true;
  
  let coveredRowsHtml = "";

    for (let r=3; r<globalDetailRows.length; r++) {
      const row = globalDetailRows[r]; if (!row) continue;
      const topic = String(row[1] || '').trim();
      const rowText = (String(row[0]||'') + String(row[1]||'')).toLowerCase();

    if(/บริษัทที่ประกันภัยคุ้มครอง/.test(topic)) continue;

      if (/ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)/i.test(rowText)) { 
        currentTypeFilterActive = typeFilter.showAll || typeFilter.isAllRisk; 
        if (currentTypeFilterActive) coveredRowsHtml += `<tr style="background:#f8fafc;"><td colspan="${planMeta.length + 1}" style="padding:12px 20px; font-weight:800; color:#185FA5; background:#eff6ff; border-bottom:1px solid #dbeafe;">ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)</td></tr>`;
        continue; 
      }
      if (/ประกันแบบระบุภัย (Named Perils)/i.test(rowText)) { 
        currentTypeFilterActive = typeFilter.showAll || typeFilter.isFire; 
        if (currentTypeFilterActive) coveredRowsHtml += `<tr style="background:#fffbeb;"><td colspan="${planMeta.length + 1}" style="padding:12px 20px; font-weight:800; color:#854d0e; background:#fefce8; border-bottom:1px solid #fef08a;">ประกันแบบระบุภัย (Named Perils)</td></tr>`;
        continue; 
      }

      if (!topic) continue;
    if(!currentTypeFilterActive) continue;

    let hasAnyValidData=false;
    const cells = planMeta.map(meta => {
      const val = getDetailCellValue(row, meta.colIdx);
      const isOk = isValidCoverage(val);
      if(isOk) hasAnyValidData = true;
      return { val, isOk, color: meta.color };
    });

    if(!cells.some(c => c.isOk)) continue;

    let rowHtml = `<tr class="item-row"><td style="padding:12px 20px;font-size:13px; font-weight:600; color:#475569; border-bottom:1px solid #f1f5f9; background:#fcfdfe;">${escapeHtml(topic)}</td>`;
    cells.forEach(c => {
      rowHtml += `<td style="padding:12px; border-bottom:1px solid #f1f5f9; text-align:center;">
        ${c.isOk ? `<div style="display:flex; flex-direction:column; align-items:center; gap:2px;"><span style="color:${c.color}; font-weight:900; font-size:16px;">✓</span><span style="font-size:12px; font-weight:700; color:#1e293b;">${escapeHtml(c.val)}</span></div>` : `<span style="color:#d1d5db; font-size:14px;">—</span>`}
      </td>`;
    });
    rowHtml += `</tr>`;
    coveredRowsHtml += rowHtml;
  }

  const finalTableBody = coveredRowsHtml;

  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>ใบเปรียบเทียบรายละเอียด — ${escapeHtml(selectedBiz)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css">
    <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
        body { background: #f1f5f9; padding: 25px; font-family: 'Sarabun', sans-serif; margin: 0; color: #1e293b; }
        .pdf-container { background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; overflow: hidden; max-width: 100%; margin: 0 auto; }
        .pdf-page-header { padding: 30px 40px; border-bottom: 2px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }
        .pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .topic-header { width: 250px; background: #f8fafc; color: #475569; font-weight: 800; text-transform: uppercase; text-align: left; vertical-align: middle; }
        .item-row td { border-bottom: 1px solid #f1f5f9; }
        .item-row:nth-child(even) { background: #fcfdfe; }
        .btn-print-fixed {
            position: fixed; top: 20px; right: 20px; z-index: 9999;
            background: #0f172a; color: #fff; padding: 11px 24px; border-radius: 40px; border: none;
            font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,.28); transition: transform .15s;
        }
        .btn-print-fixed:hover { transform: scale(1.04); }
        @media print {
            body { background: #fff; padding: 0; margin: 0; }
            .pdf-container { border: none; box-shadow: none; border-radius: 0; max-width: 100%; width: 100%; }
            .btn-print-fixed { display: none !important; }
            .pdf-table { width: 100% !important; }
        }
    </style>
</head>
<body>
    <button class="btn-print-fixed" onclick="window.print()"><i class="ti ti-printer"></i> พิมพ์ / บันทึก PDF</button>
    <div class="pdf-container">
        <div class="pdf-page-header">
            <img src="${AGENCY_LOGO}" style="height:60px;" alt="TTIB">
            <div style="text-align:right;">
                <h1 style="margin:0; font-size:22px; color:#1e293b; font-weight:800;">ตารางเปรียบเทียบรายละเอียดความคุ้มครอง</h1>
                <div style="font-size:13px; color:#64748b; margin-top:4px;">ธุรกิจ: <strong>${escapeHtml(selectedBiz)}</strong> | ทุน: <strong>${sumDisplay}</strong> | วันที่จัดทำ: ${today}</div>
            </div>
        </div>
        <table class="pdf-table">
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${finalTableBody}</tbody>
        </table>
        <div style="padding:20px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #f1f5f9;">* ข้อมูลนี้ใช้สำหรับการเปรียบเทียบเบื้องต้นเท่านั้น เงื่อนไขและข้อยกเว้นฉบับเต็มโปรดอ้างอิงตามกรมธรรม์ประกันภัย</div>
    </div>
    <script>window.onload = () => setTimeout(() => window.print(), ${PRINT_DELAY});</script>
</body>
</html>`);
  win.document.close();
}


function exportComparisonPDF(providedCards, passedLeadData = null) {
  const activePlans = window.activeMultiCards || [];
  let selectedCards = [];

  // ── 1. กำหนดรายการแผนที่จะ Export ──────────────────────────────────────────
  if (providedCards && Array.isArray(providedCards)) {
    selectedCards = providedCards;
  } else {
    const checkboxes = document.querySelectorAll('[id^="cq-chk-"]');
    selectedCards = [...checkboxes]
      .filter(c => c.checked)
      .map(c => activePlans[Number(c.value)])
      .filter(Boolean);
  }

  if (!selectedCards.length) { alert("⚠️ กรุณาเลือกบริษัทอย่างน้อย 1 บริษัท"); return; }

  // ── 2. ตรวจสอบความพร้อมของข้อมูล ──────────────────────────────────────────
  if (!rawMarkData || rawMarkData.length < 4) {
    alert("⚠️ ไม่พบข้อมูลแผนประกันภัย (Mark Sheet) กรุณาโหลดข้อมูลใหม่");
    return;
  }

  const shouldHighlight = document.getElementById('cq-highlight-diff')?.checked || false;

  // ── 3. รวบรวม Lead / Customer Data ─────────────────────────────────────────
  let finalLeadData = passedLeadData;
  if (!finalLeadData) {
    const modal = document.getElementById('compareQuoteModal');
    if (modal && modal.dataset.leadData) {
      try { finalLeadData = JSON.parse(modal.dataset.leadData); } catch (e) { /* ignore */ }
    }
  }

  const selectedBiz = finalLeadData
    ? (finalLeadData.business || finalLeadData.bizName || 'ไม่ระบุ')
    : (document.getElementById('sel-biz')?.value || 'ไม่ระบุ');

  const custData   = finalLeadData || window.csFormData || {};
  
  const sumVal     = finalLeadData ? finalLeadData.sum : (document.getElementById('inp-sum')?.value || '');
  const numSum     = parseFloat(String(sumVal).replace(/,/g, ''));
  const sumDisplay = (!isNaN(numSum) && numSum > 0) ? numSum.toLocaleString('th-TH') : 'ไม่ระบุ';
   const sumColor = selectedCards.length === 1 ? getCompanyColor(selectedCards[0].plan.company) : '#1e293b';

  // ── 4. เปิดหน้าต่างใหม่ ──────────────────────────────────────────────────────
  const win = window.open('', '_blank');
  if (!win) { alert("❌ Browser บล็อก popup — กรุณาอนุญาต popup แล้วลองใหม่"); return; }

  // ── 5. หา Column Index ใน Mark Sheet — ใช้ getMarkSheetColumnIndex() ที่มีอยู่แล้ว ────
  const colIndexes = selectedCards.map(d =>
    getMarkSheetColumnIndex(d.plan.company, d.plan.plan, d.plan.group)
  );

  // ── 6. สร้างแถวหัวตาราง (Company Header Row) ────────────────────────────────
  const headerRow = selectedCards.map((d, i) => {
    const c     = getCompanyColor(d.plan.company);
    const cLogo = COMPANY_LOGOS[d.plan.company.toUpperCase()];
    const noCol = colIndexes[i] === -1;
    return `<th style="text-align:center;padding:16px 14px;background:#fff;border-bottom:4px solid ${c};min-width:160px;vertical-align:middle;height:150px;">
      <div style="height:80px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;background:#fff;border-radius:8px;">
        ${cLogo
          ? `<img src="${cLogo}" style="max-height:70px;max-width:140px;object-fit:contain;filter:contrast(1.1);">`
          : `<div style="background:${c};color:#fff;font-size:13px;font-weight:800;padding:8px 16px;border-radius:8px;">${escapeHtml(d.plan.company)}</div>`}
      </div>
      <div style="font-size:13px;font-weight:800;color:#0f172a;line-height:1.3;margin-top:4px;">${escapeHtml(d.plan.plan)}</div>
      ${noCol ? `<div style="font-size:10px;color:#f87171;margin-top:4px;">ไม่พบข้อมูล</div>` : ''}
    </th>`;
  }).join('');

  // ── 7. สร้างแถวเบี้ยประกัน (Premium Row) ────────────────────────────────────
  let tableRows = '';
  tableRows += `<tr style="border-bottom:2px solid #e2e8f0;background:#f8fafc;page-break-inside:avoid;">
    <td class="comp-table-topic" style="padding:14px 20px;font-size:13px;font-weight:800;color:#1e293b;border-right:1px solid #e2e8f0;background:#f8fafc;position:sticky;left:0;z-index:10;">
      เบี้ยประกันสุทธิ (Net Premium)
    </td>
    ${selectedCards.map(d => {
      const c = getCompanyColor(d.plan.company);
      return `<td style="text-align:center;padding:14px;border-left:1px solid #f1f5f9;background:#fcfdfe;border-right:1px solid #f1f5f9;">
        <div style="font-size:18px;font-weight:900;color:${c};line-height:1.2;">${d.premium > 0 ? fmt(d.premium) + ' บาท' : 'ติดต่อบริษัท'}</div>
        ${d.premium > 0 ? `<div style="font-size:10px;color:#94a3b8;font-weight:600;margin-top:2px;">ต่อปี</div>` : ''}
      </td>`;
    }).join('')}
  </tr>`;

  // ── 8. Coverage Rows จาก Mark Sheet (Single-Pass — Section Header + Topic ติดกัน) ──
  let lastSectionCategory = "";

  for (let r = 3; r < rawMarkData.length; r++) {
    const row = rawMarkData[r];
    if (!row) continue;

    // col[0] = หมวดหมู่ (Category), col[1] = รายการ (Topic)
    const category = row[0] ? String(row[0]).trim() : "";
    const topic    = row[1] ? String(row[1]).trim() : "";
    if (!topic) continue;

    // ข้ามแถว System Marker
    if (/บริษัทที่ประกันภัยคุ้มครอง|แผนประกันภัย|กลุ่มประกัน/.test(topic)) continue;

    // นับจำนวนที่คุ้มครองในแต่ละแผน
    const coverCounts = selectedCards.map((_, i) => {
      const colIdx = colIndexes[i];
      if (colIdx === -1) return 0;
      const v = String(row[colIdx] ?? '').trim();
      return (v === '1' || v === '✓' || v.toLowerCase() === 'yes') ? 1 : 0;
    });

    if (!coverCounts.some(c => c > 0)) continue; // ไม่มีบริษัทใดคุ้มครอง → ข้าม

    // แทรก Section Header เมื่อหมวดหมู่เปลี่ยน (ทำก่อน Topic Row)
    if (category && category !== lastSectionCategory) {
      tableRows += `<tr style="background:#f1f5f9;page-break-inside:avoid;">
        <td colspan="${selectedCards.length + 1}" class="comp-table-topic"
            style="padding:10px 20px;font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;
                   letter-spacing:1px;border-bottom:1px solid #e2e8f0;border-top:1px solid #e2e8f0;
                   background:#f1f5f9;position:sticky;left:0;z-index:10;">
          <span style="color:#185FA5;font-weight:900;margin-right:8px;">■</span>${escapeHtml(category)}
        </td>
      </tr>`;
      lastSectionCategory = category;
    }

    // ตรวจสอบความต่าง (Diff)
    const hasNotCovered  = coverCounts.some(c => c === 0);
    const isDifferent    = hasNotCovered; // ถ้ามีบางบริษัทไม่คุ้มครอง = ต่างกัน
    const rowBg          = (isDifferent && shouldHighlight) ? 'background:#fffbeb;' : '';
    const diffBadge      = (isDifferent && shouldHighlight)
      ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:2px 5px;border-radius:4px;margin-left:8px;font-weight:800;vertical-align:middle;border:1px solid #fcd34d;">DIFF</span>'
      : '';

    const cells = selectedCards.map((d, i) => {
      const c = getCompanyColor(d.plan.company);
      return `<td style="text-align:center;padding:9px 12px;border-left:1px solid #f1f5f9;">
        ${coverCounts[i] > 0
          ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
               <span style="color:${c};font-size:18px;font-weight:800;"><i class="ti ti-circle-check-filled"></i></span>
             </div>`
          : `<span style="color:#d1d5db;font-size:16px;">—</span>`}
      </td>`;
    }).join('');

    tableRows += `<tr style="border-bottom:1px solid #f1f5f9;${rowBg}">
      <td style="padding:9px 14px;font-size:12px;color:#374151;font-weight:600;border-right:1px solid #e2e8f0;">
        ${escapeHtml(topic)}${diffBadge}
      </td>
      ${cells}
    </tr>`;
  }

  // ── 9. Detail Coverage Section จาก globalDetailRows ──────────────────────────
  if (globalDetailRows && globalDetailRows.length > 3) {
    tableRows += `<tr style="background:#e0f2fe;page-break-inside:avoid;">
      <td colspan="${selectedCards.length + 1}" class="comp-table-topic"
          style="padding:12px 20px;font-size:12px;font-weight:800;color:#0369a1;text-transform:uppercase;
                 letter-spacing:1px;border-bottom:2px solid #bae6fd;border-top:2px solid #bae6fd;
                 background:#e0f2fe;position:sticky;left:0;z-index:10;">
        <span style="margin-right:8px;"></span>รายละเอียดความคุ้มครองเพิ่มเติม (Detailed Coverage)
      </td>
    </tr>`;

    // ใช้ getDetailSheetColumnIndex() เพื่อหา Column Index ใน Detail Sheet
    const detailColIdxs   = selectedCards.map(d =>
      getDetailSheetColumnIndex(d.plan.company, d.plan.plan, d.plan.group)
    );
    const detailTypeFilter = getInsuranceTypeFilter(selectedCards.map(d => d.plan));
    let   detailActive     = true;
    let   lastDetailCat    = "";

    for (let r = 3; r < globalDetailRows.length; r++) {
      const row = globalDetailRows[r];
      if (!row) continue;

      // col[0] = หมวดหมู่, col[1] = รายการ
      const dCat   = row[0] ? String(row[0]).trim().replace(/\s+/g, ' ') : "";
      const dTopic = row[1] ? String(row[1]).trim() : "";
      if (!dTopic) continue;

      // [FIX] ปรับการเช็คหมวดหมู่ให้แม่นยำและสอดคล้องกับฟังก์ชันอื่น (รองรับทั้ง row[0], row[1])
      const rowText = (String(row[0]||'') + String(row[1]||'')).toLowerCase();
      if (/ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)/i.test(rowText)) { detailActive = detailTypeFilter.showAll || detailTypeFilter.isAllRisk; continue; }
      if (/ประกันแบบระบุภัย (Named Perils)/i.test(rowText)) { detailActive = detailTypeFilter.showAll || detailTypeFilter.isFire; continue; }
      if (!detailActive) continue;

      const dCells = selectedCards.map((_, i) => {
        const val  = getDetailCellValue(row, detailColIdxs[i]);
        const isOk = isValidCoverage(val);
        return { val, isOk, color: getCompanyColor(selectedCards[i].plan.company) };
      });
      if (!dCells.some(c => c.isOk)) continue;

      // Section Header เมื่อหมวดหมู่เปลี่ยน
      if (dCat && dCat !== lastDetailCat) {
        tableRows += `<tr style="background:#f8fafc;page-break-inside:avoid;">
          <td colspan="${selectedCards.length + 1}" class="comp-table-topic"
              style="padding:9px 20px;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;
                     letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;border-top:1px solid #e2e8f0;
                     background:#f8fafc;position:sticky;left:0;z-index:8;">
            <span style="color:#185FA5;margin-right:6px;">▸</span>${escapeHtml(dCat)}
          </td>
        </tr>`;
        lastDetailCat = dCat;
      }

      const dVals   = dCells.map(c => c.isOk ? c.val.trim().toLowerCase() : '—');
      const dDiff   = new Set(dVals).size > 1;
      const dRowBg  = (dDiff && shouldHighlight) ? 'background:#fff7ed;' : '';
      const dBadge  = (dDiff && shouldHighlight)
        ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:2px 5px;border-radius:4px;margin-left:8px;font-weight:800;vertical-align:middle;border:1px solid #fcd34d;">DIFF</span>'
        : '';

      tableRows += `<tr style="border-bottom:1px solid #f1f5f9;${dRowBg}page-break-inside:avoid;">
        <td class="comp-table-topic"
            style="padding:10px 14px;font-size:12px;color:#374151;font-weight:600;border-right:1px solid #e2e8f0;background:inherit;position:sticky;left:0;z-index:5;">
          ${escapeHtml(dTopic)}${dBadge}
        </td>
        ${dCells.map(c => `
          <td style="text-align:center;padding:9px 12px;border-left:1px solid #f1f5f9;">
            ${c.isOk
              ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                   <span style="color:${c.color};font-weight:900;font-size:16px;"><i class="ti ti-circle-check-filled"></i></span>
                   <span style="font-size:11px;font-weight:700;">${escapeHtml(c.val)}</span>
                 </div>`
              : `<span style="color:#d1d5db;font-size:14px;">—</span>`}
          </td>`).join('')}
      </tr>`;
    }
  }

  // ── 10. Info Summary Grid (Customer / Business / Asset) ──────────────────────
  const infoGrid = `
    <div class="info-summary-grid">
      <div class="info-col">
        <div class="info-label">ข้อมูลใบเสนอราคา</div>
        <div class="info-sub-value">ทุนประกันภัย: <strong style="color:${sumColor}; font-size: 14px;">${sumDisplay}${!isNaN(numSum) && numSum > 0 ? ' บาท' : ''}</strong></div>
        <div class="info-sub-value">ธุรกิจ: <strong style="color:#1e293b;">${window._csIsNotFoundClicked ? 'อื่นๆ: ' + escapeHtml(custData.bizDetail || 'ไม่ระบุ') : escapeHtml(selectedBiz)}</strong></div>
      </div>
    </div>`;

  // ── 11. เขียน HTML ลงหน้าต่างใหม่ ───────────────────────────────────────────
  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>เปรียบเทียบแผนประกัน — ${escapeHtml(selectedBiz)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css">
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Sarabun', sans-serif; color: #1e293b; background: #f1f5f9; margin: 0; padding: 25px; }
    .box { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
    .doc-header { background: #fff; border-bottom: 2px solid #f1f5f9; padding: 25px 35px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; }
    .doc-header-left { display: flex; align-items: center; gap: 20px; flex: 1; min-width: 300px; }
    .doc-header-right { text-align: right; flex-shrink: 0; }
    .doc-title { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; margin: 0; }
    .doc-subtitle { font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .doc-date-label { font-size: 10px; color: #94a3b8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-date-val { font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 2px; }
    .info-summary-grid { display: grid; grid-template-columns: 1fr; gap: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;padding: 15px 20px; margin-bottom: 25px; }
    .info-col { padding: 0; border-right: none; }
    .info-label { font-size: 10px; color: #94a3b8; font-weight: 800; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
    .info-value { font-size: 14px; font-weight: 800; color: #1e293b; line-height: 1.4; }
    .info-sub-value { font-size: 12px; color: #475569; font-weight: 600; line-height: 1.4; }
    .info-detail { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.5; }
    .info-detail strong { font-weight: 700; color: #1e293b; }
    /* ── ปุ่มพิมพ์ลอยอยู่ที่มุมขวาล่าง ── */
    .btn-print-fixed {
      position: fixed; bottom: 30px; right: 30px; z-index: 9999;
      background: #0f172a; color: #fff; padding: 14px 28px; border-radius: 50px; border: none;
      font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.28); transition: transform .15s;
    }
    .btn-print-fixed:hover { transform: scale(1.04); }
    .table-wrap { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: 1000px; }
    /* Watermark styles */
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 100%;
      height: 100%;
      background-image: url('${AGENCY_LOGO}');
      background-repeat: no-repeat;
      background-position: center center;
      background-size: 80%;
      opacity: 0.04;
      z-index: -10; /* Behind content */
      pointer-events: none; /* Don't block interaction */
    }
    thead tr th { vertical-align: top; border-right: 1px solid #f1f5f9; }
    thead tr th:first-child { text-align: left; padding: 14px 20px; background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 800; border-bottom: 2px solid #e2e8f0; width: 240px; height: auto; position: sticky; left: 0; z-index: 20; }
    thead tr th:last-child { border-right: none; }
    tbody tr td { border-right: 1px solid #f1f5f9; }
    tbody tr td:last-child { border-right: none; }
    tbody tr td.comp-table-topic { padding: 12px 20px; font-size: 13px; font-weight: 600; color: #334155; border-right: 1px solid #f1f5f9; background: #fcfdfe; position: sticky; left: 0; z-index: 10; }
    tbody tr:hover { background: #f0fdf4; }
    .footer { padding: 18px 30px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8; }
    @media print {
      body { background: #fff; padding: 0; }
      .box { border: none; border-radius: 0; box-shadow: none; position: relative; } /* Add position: relative here */
      .btn-print-fixed { display: none !important; }
      .table-wrap { overflow-x: hidden; }
      table { table-layout: auto; min-width: auto; }
      thead tr th:first-child, tbody tr td.comp-table-topic { position: static; }
      .info-summary-grid { grid-template-columns: 1fr; gap: 15px; padding: 15px 20px; }
      .info-col { border-right: none; padding: 0; border-bottom: none; margin-bottom: 0; }
      .watermark { display: block !important; } /* Ensure watermark is always visible in print */
    }
    .logo-footer-fixed { position: fixed; bottom: 8mm; left: 10mm; z-index: 9999; display: none; }
    @media print { .logo-footer-fixed { display: block !important; } }
  </style>
  <style>
    /* [NEW] Mobile Responsiveness for PDF Preview */
    @media screen and (max-width: 768px) {
      body { padding: 10px; }
      .doc-header { flex-direction: column; align-items: flex-start; gap: 15px; padding: 20px; }
      .doc-header-right { text-align: left; }
      .doc-title { font-size: 20px; }
      .info-summary-grid { padding: 15px; }
      .btn-print-fixed {
        bottom: 15px; right: 15px;
        padding: 12px 20px;
        font-size: 13px;
        width: calc(100% - 30px);
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="logo-footer-fixed"><img src="${AGENCY_LOGO}" style="height: 40px; width: auto; opacity: 0.8;"></div>
  <button class="btn-print-fixed" onclick="window.print()">
    <i class="ti ti-printer"></i> บันทึก PDF
  </button>
  <div class="box" style="position:relative;"> <!-- Explicitly set position:relative -->
    <div class="watermark"></div> <!-- Watermark as a direct child of .box -->
    <div class="doc-header">
      <div class="doc-header-left">
        <img src="${AGENCY_LOGO}" style="height:65px;width:auto;" alt="TTIB">
        <div style="flex:1;">
          <div class="doc-title">สรุปผลเปรียบเทียบแผนประกันภัย</div>
          <div class="doc-subtitle">TTIB Insurance Broker Proposal Summary</div>
        </div>
      </div>
      <div class="doc-header-right">
        <div class="doc-date-label">วันที่จัดทำ</div>
        <div class="doc-date-val">${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
    </div>
    <div style="padding:25px 35px;">${infoGrid}</div>
    <div class="table-wrap">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:1000px;">
        <thead>
          <tr>
            <th style="text-align:center;padding:14px 20px;background:#f8fafc;color:#64748b;font-size:25px;font-weight:800;border-bottom:2px solid #e2e8f0;width:240px;position:sticky;left:0;z-index:20;vertical-align:middle;">รายการ</th>
            ${headerRow}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="footer">เอกสารนี้จัดทำเพื่อประกอบการพิจารณาเบื้องต้นเท่านั้น ความคุ้มครอง เงื่อนไข และข้อยกเว้นที่สมบูรณ์อ้างอิงตามกรมธรรม์ประกันภัยจากบริษัทผู้รับประกันภัยเท่านั้น</div>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), ${PRINT_DELAY});<\/script>
</body>
</html>`);

  win.document.close();

  // ปิด Modal หากยังเปิดอยู่
  if (document.getElementById('compareQuoteModal')?.classList.contains('active')) {
    closeComparisonQuoteModal();
  }
}

function exportCustomerQuotePDF(customerData) {
  if(!customerData) return;
  const win=window.open('','_blank');
  if(!win){alert("❌ Browser บล็อก popup กรุณาอนุญาตการเปิดหน้าต่างใหม่");return;}
  const companies=String(customerData.company||'').split(',').map(s=>s.trim()).filter(Boolean);
  const plans    =String(customerData.plan||'').split('+').map(s=>s.trim()).filter(Boolean);
  // [FIX Bug5] ลบ "บาท" ทุกตำแหน่งก่อน split
  const premiums =String(customerData.premium||'').replace(/บาท/g,'').split('/').map(s=>s.trim()).filter(Boolean);
  const groups   =String(customerData.group||'').split(',').map(s=>s.trim()).filter(Boolean);
  let fullHtml=`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ใบเสนอราคา — ${escapeHtml(customerData.customer||'ลูกค้า')}</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
    </head><body class="q-doc-body">
    <button class="btn-print-quote" onclick="window.print()"><i class="ti ti-printer"></i> พิมพ์ / บันทึก PDF</button>`;
  companies.forEach((comp,idx)=>{
    const singleData={...customerData,company:comp,plan:(plans[idx]||plans[0]||'-').trim(),premium:(premiums[idx]||(premiums.length>0?premiums[0]:'0')).trim(),group:(groups[idx]||(groups.length>0?groups[0]:'-')).trim()};
    fullHtml+=getSingleQuoteHTML(singleData);
    if(idx<companies.length-1) fullHtml+='<div style="page-break-after:always;height:30px;"></div>';
  });
  fullHtml+=`<script>window.onload=()=>setTimeout(()=>window.print(),${PRINT_DELAY});<\/script></body></html>`;
  win.document.write(fullHtml);
  win.document.close();
}

// [PATCH] getSingleQuoteHTML — ยกเลิก isSection / section header rows
function getSingleQuoteHTML(customerData) {
  const cColor=getCompanyColor(customerData.company)||'#0f6e56';
  const cleanSum=String(customerData.sumInsured||'').replace(/,/g,'');
  const sumDisplay=isNaN(parseFloat(cleanSum))?customerData.sumInsured:fmt(parseFloat(cleanSum));
  const quoteNumber='QT-'+new Date().getFullYear().toString().slice(-2)+String(new Date().getMonth()+1).padStart(2,'0')+'-'+Math.floor(Math.random()*100000).toString().padStart(5,'0');
  const issuedDate=new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});
  const expireDate=new Date(Date.now()+365*86400000).toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});
  const logoUrl=COMPANY_LOGOS[customerData.company.toUpperCase()];
  const insurerLogoHtml=logoUrl?`<img src="${logoUrl}" alt="${escapeHtml(customerData.company)}" class="insurer-logo-img">`:`<div class="insurer-logo-fallback" style="background:${cColor};">${escapeHtml(customerData.company)}</div>`;
  const planForLookup=customerData.plan; const groupForLookup=customerData.group||'';

  const d = customerData;
  const parts = [
    d.addrNo ? `เลขที่ ${d.addrNo}` : '',
    d.addrMoo ? `หมู่ ${d.addrMoo}` : '',
    d.addrRoad ? `ถ.${d.addrRoad}` : '',
    d.addrSub ? `ต./แขวง ${d.addrSub}` : '',
    d.addrDist ? `อ./เขต ${d.addrDist}` : '',
    d.addrProv ? `จ.${d.addrProv}` : '',
    d.addrZip || ''
  ].filter(Boolean);
  const displayAddr = parts.length > 0 ? parts.join(' ') : (customerData.address || '-');

  const typeFilter=getInsuranceTypeFilter([{ covType: customerData.covType || '' }]);
  let detailRows=''; let detailCount=0;
  if(globalDetailRows&&globalDetailRows.length>3){
    const detailColIdx=getDetailSheetColumnIndex(customerData.company,planForLookup,groupForLookup);
    if(detailColIdx!==-1){
      let currentTypeFilterActive=true;
      for(let r=3;r<globalDetailRows.length;r++){
        const row=globalDetailRows[r]; if(!row||!row[0]) continue;
        const topic=String(row[0]).trim(); if(!topic) continue;

        // [PATCH] ข้ามแถว header หมวดหมู่
        if(/หมวดหมู่ประกันภัย/.test(topic)) continue;

        // [FIX] ปรับให้ตรงกับฟังก์ชันอื่นๆ
        const rowText = (String(row[0]||'') + String(row[1]||'')).toLowerCase();
        if(/ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)/i.test(rowText)) { currentTypeFilterActive = typeFilter.showAll || typeFilter.isAllRisk; continue; }
        if(/ประกันแบบระบุภัย (Named Perils)/i.test(rowText)) { currentTypeFilterActive = typeFilter.showAll || typeFilter.isFire; continue; }
        if(!currentTypeFilterActive) continue;

        const val=getDetailCellValue(row,detailColIdx);
        if(!isValidCoverage(val)) continue;
        detailCount++;
        detailRows+=`<tr class="detail-row"><td class="cov-num">${detailCount}</td><td class="detail-topic">${escapeHtml(topic)}</td><td class="detail-val"><span class="cov-check">✓</span>${escapeHtml(val)}</td></tr>`;
      }
    }
  }
  const detailSectionHtml=detailCount>0?`<div class="section-wrap"><div class="section-head"><span class="section-icon">◈</span><span>รายละเอียดความคุ้มครองและเงื่อนไข</span><span class="section-badge">${detailCount} รายการ</span></div><table class="cov-table"><thead><tr><th class="col-num">#</th><th>รายการ</th><th class="col-val">ผลประโยชน์</th></tr></thead><tbody>${detailRows}</tbody></table></div>`:'';
  const noteRaw=String(customerData.note||'');
  const assetMatch=noteRaw.match(/\[ทรัพย์สิน:(.*?)\]/);
  const assetStr=assetMatch?assetMatch[1]:'';
  const noteClean=noteRaw.replace(/\[ทรัพย์สิน:.*?\]/,'').trim(); // No change here, this is for cleaning the note string
  const areaRaw=customerData.area||parseAssetPart(assetStr,'ทุนอาคาร')||'0';
  const stockRaw      = customerData.stock      || parseAssetPart(assetStr, 'ทรัพย์สินภายใน')    || '-';
  const equipmentRaw  = customerData.equipment  || parseAssetPart(assetStr, 'เครื่องจักร')  || '-';
  const renovationRaw = customerData.renovation || parseAssetPart(assetStr, 'สต็อกสินค้า')    || '-'; // สลับตามคำขอ
  const staffRaw      = customerData.staff      || parseAssetPart(assetStr, 'พนักงาน')  || '-';
  const rawPremium=String(customerData.premium||'').replace(/[^0-9.]/g,'');
  const premiumNum=parseFloat(rawPremium)||0;
  const vatAmt=Math.round(premiumNum*0.007);
  const totalAmt=premiumNum+vatAmt;
  return `<div class="q-doc" style="--q-theme-color:${cColor};--q-theme-color-light:${cColor}18;--q-theme-color-border:${cColor}55;margin-bottom:40px;">
    <div class="q-topbar"></div>
    <div class="q-header"><img src="${AGENCY_LOGO}" class="q-agency-logo" alt="TTIB"><div><div class="q-agency-name">TTIB Insurance Broker Co., Ltd.</div></div><div class="q-doc-title"><h1>ใบเสนอราคา</h1><div class="en">Insurance Quotation</div><div class="q-doc-num">${quoteNumber}</div></div></div>
    <div class="q-meta-band">
      <div class="q-meta-cell"><div class="meta-lbl">ผู้ทำประกันภัย (Insured)</div><div class="meta-val">${escapeHtml(customerData.customer)}</div><div class="meta-sub">โทร: ${escapeHtml(customerData.phone)}${customerData.email&&customerData.email!=='-'?' E-mail: '+escapeHtml(customerData.email):''}</div>${displayAddr&&displayAddr!=='-'?`<div class="meta-sub">${escapeHtml(displayAddr)}</div>`:''}</div>
      <div class="q-meta-cell"><div class="meta-lbl">วันที่ออก</div><div class="meta-val">${issuedDate}</div><div class="meta-accent">หมดอายุ: ${expireDate}</div></div>
      <div class="q-meta-cell"><div class="meta-lbl">เจ้าหน้าที่</div><div class="meta-val">ฝ่ายขาย TTIB</div><div class="meta-sub">033-044-414</div><div class="meta-sub">www.ttib.co.th</div></div>
    </div>
    <div class="q-body">
      <div class="section-wrap"><div class="section-head"><span class="section-icon">◈</span><span>ข้อมูลทรัพย์สิน</span></div>
        <div class="info-grid">
          <div class="info-cell"><div class="ic-lbl">ทุนประกันภัยตัวอาคาร</div><div class="ic-val">${escapeHtml(areaRaw)}${areaRaw !== '-' && areaRaw !== '0' && !String(areaRaw).includes('บาท') ? ' บาท' : ''}</div></div>
          <div class="info-cell"><div class="ic-lbl">ทรัพย์สินภายในอาคาร</div><div class="ic-val">${escapeHtml(stockRaw)}${stockRaw !== '-' && !String(stockRaw).includes('บาท') ? ' บาท' : ''}</div></div>
          <div class="info-cell"><div class="ic-lbl">มูลค่าเครื่องจักร</div><div class="ic-val">${escapeHtml(equipmentRaw)}${equipmentRaw !== '-' && !String(equipmentRaw).includes('บาท') ? ' บาท' : ''}</div></div>
          <div class="info-cell"><div class="ic-lbl">สต็อกสินค้า</div><div class="ic-val">${escapeHtml(renovationRaw)}${renovationRaw !== '-' && !String(renovationRaw).includes('บาท') ? ' บาท' : ''}</div></div>
          <div class="info-cell"><div class="ic-lbl">จำนวนพนักงาน</div><div class="ic-val">${escapeHtml(staffRaw)}${staffRaw !== '-' && !String(staffRaw).includes('คน') ? ' คน' : ''}</div></div>
          <div class="info-cell full-width"><div class="ic-lbl">สถานที่ตั้ง</div><div class="ic-val">${escapeHtml(displayAddr)}</div></div>
        </div>
      </div>
      <div class="section-wrap"><div class="section-head"><span class="section-icon">◈</span><span>แผนประกันภัยที่นำเสนอ</span></div>
        <div class="plan-card">
          <div class="insurer-logos-col">${insurerLogoHtml}</div>
          <div class="plan-info">
            <div class="plan-name-row"><span class="plan-name">${escapeHtml(customerData.plan)}</span><span class="plan-company">ผู้รับประกันภัย: ${escapeHtml(customerData.company)}</span></div>
            <div class="plan-badges">${customerData.covType?`<span class="plan-badge">${escapeHtml(customerData.covType)}</span>`:''}</div>
          </div>
        </div>
      </div>
      ${detailSectionHtml}
      <div class="section-wrap"><div class="section-head"><span class="section-icon">◈</span><span>สรุปเบี้ยประกันภัย</span></div>
        <div class="pricing-block">
          <div class="price-row"><div><div class="price-lbl">ทุนประกันภัย</div></div><div class="price-amt" style="color:${cColor};">${escapeHtml(String(sumDisplay))}<span class="price-unit">บาท</span></div></div>
          <div class="price-row subtotal"><div><div class="price-lbl">เบี้ยประกันสุทธิ</div></div><div class="price-amt">${fmt(premiumNum)}<span class="price-unit">บาท</span></div></div>
          ${premiumNum>0?`<div class="price-row subtotal"><div><div class="price-lbl">อากรแสตมป์ (0.7%)</div></div><div class="price-amt">${fmt(vatAmt)}<span class="price-unit">บาท</span></div></div>
          <div class="price-row total-row"><div><div class="price-lbl" style="font-size:15px;">เบี้ยประกันรวม</div></div><div class="price-amt">${fmt(totalAmt)}<span class="price-unit">บาท/ปี</span></div></div>`:''}
        </div>
      </div>
      ${noteClean&&noteClean!=='-'?`<div class="remark-box"><div class="remark-lbl">หมายเหตุ</div><div class="remark-text">${escapeHtml(noteClean)}</div></div>`:''}
      <div class="signature-area">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้เสนอราคา</div><div class="sig-sub">เจ้าหน้าที่ฝ่ายขาย TTIB</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้ทำประกันภัย</div><div class="sig-sub">${escapeHtml(customerData.customer)}</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้มีอำนาจอนุมัติ</div><div class="sig-sub">ผู้จัดการฝ่ายรับประกัน</div></div>
      </div>
    </div>
    <div class="q-footer">
      <div class="disclaimer">* เอกสารนี้จัดทำเพื่อการพิจารณาเบื้องต้นเท่านั้น ความคุ้มครองและเงื่อนไขที่สมบูรณ์ระบุในกรมธรรม์ประกันภัย · อายุ 30 วันนับจากวันที่ออก</div>
      <div class="footer-bar"><div class="footer-contacts"><div class="footer-contact-item"><i class="ti ti-phone"></i> 033-044-414</div><div class="footer-contact-item"><i class="ti ti-mail"></i> sales@ttib.co.th</div><div class="footer-contact-item"><i class="ti ti-world"></i> www.ttib.co.th</div></div><div class="footer-stamp">เลขที่ ${quoteNumber}<br>ออกเมื่อ: ${new Date().toLocaleString('th-TH')}</div></div>
    </div>
  </div>`;
}

// =============================================================================
// CLICK OUTSIDE TO CLOSE
// =============================================================================

document.addEventListener('click', e => {
  ['detailModal','compareQuoteModal','historyModal','trackingModal','contactedModal','closedModal','dashboardModal','addPackageModal'].forEach(id => {
    const modal=document.getElementById(id);
    if(modal && e.target===modal) modal.classList.remove('active');
  });

  const suggestionsBox = document.querySelector('.biz-suggestions');
  const searchInput = document.getElementById('inp-search-biz');
  if (suggestionsBox && !suggestionsBox.contains(e.target) && e.target !== searchInput) {
    suggestionsBox.classList.remove('show');
  }
});

// =============================================================================
// INIT
// =============================================================================

// =============================================================================
// INITIALIZATION (Consolidated DOMContentLoaded)
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {

  const searchInp = document.getElementById('inp-search-biz');
  if (searchInp) {
    searchInp.addEventListener('focus', filterBusinessOptions);
    searchInp.addEventListener('click', filterBusinessOptions);
    searchInp.addEventListener('input', filterBusinessOptions);
  }
  loadRecentSearches(); // [NEW] Load recent searches on startup
  loadFavorites(); // [FAV] Load saved favorites on startup

  // [NEW] Sum Insured Input with +/- buttons
  const sumInput = document.getElementById('inp-sum');
  const btnMinus = document.getElementById('btn-sum-minus');
  const btnPlus = document.getElementById('btn-sum-plus');
  const MIN_SUM = 500000;
  const MAX_SUM = 50000000;
  const STEP = 500000;

  const updateSumFromInput = () => {
    let val = parseFloat(String(sumInput.value).replace(/,/g, '')) || MIN_SUM;
    val = Math.max(MIN_SUM, Math.min(MAX_SUM, val));
    sumInput.value = val.toLocaleString('th-TH');
    btnMinus.disabled = (val <= MIN_SUM);
    btnPlus.disabled = (val >= MAX_SUM);
    debouncedRender();
  };

  const adjustSum = (amount) => {
    let currentVal = parseFloat(String(sumInput.value).replace(/,/g, '')) || MIN_SUM;
    let newVal = currentVal + amount;
    newVal = Math.max(MIN_SUM, Math.min(MAX_SUM, newVal));
    sumInput.value = newVal.toLocaleString('th-TH');
    updateSumFromInput();
  };

  if (sumInput && btnMinus && btnPlus) {
    btnMinus.addEventListener('click', () => adjustSum(-STEP));
    btnPlus.addEventListener('click', () => adjustSum(STEP));

    sumInput.addEventListener('change', updateSumFromInput);
    sumInput.addEventListener('input', () => {
      // Allow typing commas
      const currentVal = sumInput.value;
      const numericVal = currentVal.replace(/[^0-9]/g, '');
      if (numericVal) {
        sumInput.value = Number(numericVal).toLocaleString('th-TH');
      }
    });

    // Initial state
    sumInput.value = MIN_SUM.toLocaleString('th-TH');
    updateSumFromInput();
  }

  // โหลดที่อยู่จาก Cache เพื่อความรวดเร็ว
  try {
    const cached = sessionStorage.getItem('ttib_address_data');
    if (cached) rawAddressData = JSON.parse(cached);
  } catch (e) {}

  loadExcelData();
  const params = new URLSearchParams(window.location.search);
  if (params.get('isNotFound') === 'true') {
    window._sfIsNotFound = true;
    if (typeof sfFilterBiz === 'function') sfFilterBiz();
  }
});

// =============================================================================
// CHATBOT LOGIC (GEMINI API)
// =============================================================================

const chatbotToggler = document.querySelector(".chatbot-toggler");
const sendChatBtn = document.querySelector(".chat-input span");
const chatInput = document.querySelector(".chat-input textarea");
const chatbox = document.querySelector(".chatbox");
const closeBtn = document.querySelector(".chatbot header span");

let userMessage;
const GEMINI_API_KEY = "https://script.google.com/macros/s/AKfycbx8V7IPOwRNcm8cylLogQ7WWSiRMqPgdEvF7dyr9aNLhBZf0xcmoZBH8_k5Wg5NQm8SQQ/exec";

const createChatLi = (message, className) => {
    const chatLi = document.createElement("li");
    chatLi.classList.add("chat", className);
    let chatContent = className === "outgoing" 
        ? `<p>${message}</p>`
        : `<div class="chatbot-avatar">
             <img src="https://www.ttib.co.th/wp-content/uploads/2025/01/b8b928246b261a35e621427914cd564a.webp" alt="Avatar" style="width:100%; height:100%; object-fit:cover;">
           </div><p>${message}</p>`;
    chatLi.innerHTML = chatContent;
    return chatLi;
}

const generateResponse = (incomingChatLi) => {
    const messageElement = incomingChatLi.querySelector("p");

    let knowledgeBase = "ข้อมูลความรู้พื้นฐานเกี่ยวกับประกันภัย:\n";
    if (typeof globalDetailRows !== 'undefined' && globalDetailRows.length > 3) {
        for (let i = 3; i < Math.min(globalDetailRows.length, 50); i++) { // จำกัด 50 แถว ไม่ให้ URL ยาวเกิน
            const row = globalDetailRows[i];
            if (row && row[0] && row[1]) {
                knowledgeBase += `- ${String(row[0]).trim()}: ${String(row[1]).trim()}\n`;
            }
        }
    }

    // [FIX] ใช้ GET แทน POST เพื่อหลีกเลี่ยง CORS preflight
    const params = new URLSearchParams({
        action: 'callGemini',
        msg: userMessage,
        kb: knowledgeBase.substring(0, 2000) // จำกัดความยาว URL
    });

    fetch(`${APPS_SCRIPT_URL}?${params}`, { method: 'GET' })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(response => {
            if (response.text) {
                messageElement.textContent = response.text.trim();
            } else {
                // ถ้า response เป็น JSON แต่ไม่มี key 'text'
                throw new Error(response.error || "ไม่ได้รับคำตอบที่ถูกต้องจากระบบ");
            }
        })
        .catch(error => {
            messageElement.classList.add("error");
            messageElement.textContent = "ขออภัยค่ะ เกิดข้อผิดพลาด: " + error.message;
        })
        .finally(() => chatbox.scrollTo(0, chatbox.scrollHeight));
}

const handleChat = () => {
    userMessage = chatInput.value.trim();
    if(!userMessage) return;
    chatInput.value = "";

    chatbox.appendChild(createChatLi(userMessage, "outgoing"));
    chatbox.scrollTo(0, chatbox.scrollHeight);

    setTimeout(() => {
        const incomingChatLi = createChatLi("กำลังพิมพ์...", "incoming");
        chatbox.appendChild(incomingChatLi);
        chatbox.scrollTo(0, chatbox.scrollHeight);
        generateResponse(incomingChatLi);
    }, 600);
}

if (sendChatBtn) {
    sendChatBtn.addEventListener("click", handleChat);
}
if (chatbotToggler) {
    chatbotToggler.addEventListener("click", () => {
        document.body.classList.toggle("show-chatbot");
        // สลับไอคอน
        chatbotToggler.querySelector('.chatbot-icon-open').style.display = document.body.classList.contains('show-chatbot') ? 'none' : 'block';
        chatbotToggler.querySelector('.ti-x').style.display = document.body.classList.contains('show-chatbot') ? 'block' : 'none';
    });
}
chatInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChat();
    }
});

// =============================================================================
// COMPARISON MODAL UI HELPERS
// =============================================================================

function updateComparisonUI() {
  const showDetails = document.getElementById('cq-show-details')?.checked || false;
  const tableWrap = document.getElementById('cq-detail-table-wrap');
  if (!tableWrap) return;

  if (showDetails) {
    tableWrap.style.display = 'block';
    // ลบการส่ง leadData เนื่องจากฟังก์ชันปลายทางไม่ได้ใช้งาน
    tableWrap.innerHTML = _buildComparisonDetailTableHTML();
  } else {
    tableWrap.style.display = 'none';
    tableWrap.innerHTML = '';
  }
}

function _buildComparisonDetailTableHTML() {
  const activePlans = Array.isArray(window.activeMultiCards) ? window.activeMultiCards : [];
  const checkboxes = document.querySelectorAll('[id^="cq-chk-"]');
  const selectedIndices = [...checkboxes].filter(c => c.checked).map(c => Number(c.value));
  const selectedCards = selectedIndices.map(i => activePlans[i]).filter(Boolean);
  
  if (!selectedCards.length) return '<div style="padding:60px 20px; text-align:center; color:#94a3b8; font-size:14px;"><i class="ti ti-click" style="font-size:32px; display:block; margin-bottom:12px; opacity:0.5;"></i>กรุณาเลือกบริษัทประกันอย่างน้อย 1 แห่ง<br>เพื่อแสดงตารางเปรียบเทียบรายละเอียด</div>';

  const shouldHighlight = document.getElementById('cq-highlight-diff')?.checked || false;
  const planMeta = selectedCards.map(d => ({
    planObj: d.plan,
    colIdx: getDetailSheetColumnIndex(d.plan.company, d.plan.plan, d.plan.group),
    color: getCompanyColor(d.plan.company)
  }));

  const typeFilter = getInsuranceTypeFilter(selectedCards.map(d => d.plan));
  let currentTypeFilterActive = true;

  let headerHtml = `<th style="width:240px; background:#f8fafc; border-bottom:2px solid #cbd5e1; border-right:2px solid #e2e8f0; padding:18px 20px; text-align:left; position:sticky; left:0; top:0; z-index:50; font-size:11px; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:1px;">รายการความคุ้มครอง</th>`;
  selectedCards.forEach((d, i) => {
    const c = planMeta[i].color;
    headerHtml += `<th style="text-align:center; padding:18px 12px; border-bottom:4px solid ${c}; border-right:1px solid #f1f5f9; background:#fff; min-width:180px; vertical-align:top; position:sticky; top:0; z-index:40;">
      <div style="font-size:12px; font-weight:900; color:${c}; margin-bottom:5px; text-transform:uppercase;">${escapeHtml(d.plan.company)}</div>
      <div style="font-size:11px; color:#1e293b; font-weight:800; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; height:32px;">${escapeHtml(d.plan.plan)}</div>
      ${d.premium > 0 ? `<div style="margin-top:10px; display:inline-block; background:${c}10; color:${c}; padding:4px 10px; border-radius:8px; font-size:13px; font-weight:900;">${fmt(d.premium)} ฿</div>` : ''}
    </th>`;
  });

  let rowsHtml = '';
  let lastCategory = "";
  for (let r = 3; r < globalDetailRows.length; r++) {
    const row = globalDetailRows[r];
    if (!row) continue;

    const rowText = (String(row[0]||'') + String(row[1]||'')).toLowerCase();

    if (/ประกันแบบเสี่ยงภัยทุกชนิด \(All Risk\)/i.test(rowText)) { 
      currentTypeFilterActive = typeFilter.showAll || typeFilter.isAllRisk; 
      if (currentTypeFilterActive) {
        rowsHtml += `<tr style="background:#eff6ff;"><td colspan="${selectedCards.length + 1}" style="padding:12px 20px; font-weight:800; color:#185FA5; border-bottom:1.5px solid #dbeafe; position:sticky; left:0; z-index:10;"><i class="ti ti-shield-check"></i> ประกันแบบเสี่ยงภัยทุกชนิด (All Risk)</td></tr>`;
      }
      continue; 
    }
    if (/ประกันแบบระบุภัย \(Named Perils\)/i.test(rowText)) { 
      currentTypeFilterActive = typeFilter.showAll || typeFilter.isFire; 
      if (currentTypeFilterActive) {
        rowsHtml += `<tr style="background:#fefce8;"><td colspan="${selectedCards.length + 1}" style="padding:12px 20px; font-weight:800; color:#854d0e; border-bottom:1.5px solid #fef08a; position:sticky; left:0; z-index:10;"><i class="ti ti-flame"></i> ประกันแบบระบุภัย (Named Perils)</td></tr>`;
      }
      continue; 
    }

    const category = row[0] ? String(row[0]).trim() : "";
    const topic    = row[1] ? String(row[1]).trim() : "";
    if (!topic) continue;
    if (!currentTypeFilterActive) continue;

    const cells = planMeta.map(meta => {
      const val = getDetailCellValue(row, meta.colIdx);
      const isOk = isValidCoverage(val);
      return { val, isOk, color: meta.color };
    });

    if (!cells.some(c => c.isOk)) continue;

    if (category && category !== lastCategory) {
      rowsHtml += `<tr>
        <td colspan="${selectedCards.length + 1}" style="padding:12px 20px; background:#f1f5f9; color:#475569; font-size:12px; font-weight:800; border-bottom:1px solid #e2e8f0; border-top:1px solid #e2e8f0; position:sticky; left:0; z-index:10;">
          <i class="ti ti-folder" style="color:#185FA5; margin-right:6px;"></i> ${escapeHtml(category)}
        </td>
      </tr>`;
      lastCategory = category;
    }

    const values = cells.map(c => c.isOk ? c.val.trim().toLowerCase() : '—');
    const isDifferent = new Set(values).size > 1;
    const rowStyle = (isDifferent && shouldHighlight) ? 'background:#fffbeb;' : '';

    rowsHtml += `<tr style="${rowStyle}" onmouseover="this.style.background='${(isDifferent && shouldHighlight)?'#fef9c3':'#f9fafb'}'" onmouseout="this.style.background='${(isDifferent && shouldHighlight)?'#fffbeb':'transparent'}'">
      <td style="padding:14px 20px; border-bottom:1px solid #f1f5f9; font-size:13px; font-weight:600; color:#334155; position:sticky; left:0; background:inherit; z-index:20; border-right:2px solid #e2e8f0; padding-left:32px;">${escapeHtml(topic)}</td>`;
    cells.forEach(c => {
      rowsHtml += `<td style="padding:14px 12px; border-bottom:1px solid #f1f5f9; border-right:1px solid #f1f5f9; text-align:center; font-size:13px; background:inherit;">
        ${c.isOk ? `<i class="ti ti-circle-check-filled" style="color:${c.color}; font-size:20px; display:block; margin-bottom:4px;"></i><span style="color:#1e293b; font-weight:700;">${escapeHtml(c.val)}</span>` : `<span style="color:#cbd5e1; font-size:14px;"><i class="ti ti-minus"></i></span>`}
      </td>`;
    });
    rowsHtml += `</tr>`;
  }

  // [FIX] ลบ `} </table>\`; } </table>\`;` ที่ซ้ำซ้อนออก — คืนค่าเพียง string เดียว
  return `<table style="width:100%; border-collapse:separate; border-spacing:0; background:#fff; table-layout:fixed; min-width:800px;">
    <thead style="position:sticky; top:0; z-index:40; background:#fff;"><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}