// =============================================================================
// user-form.js — Standalone Contact Form Script
// อ้างอิง pattern จาก user-script.js ทุก section
// =============================================================================

const SHEET_NAMES = {
  BIZ:      'ข้อมูลดึงออกมาใช้',
  PREMIUM:  'เบี้ยประกันทั้งหมด',
  MARK:     'หัวข้อคุ้มครอง (เครื่องหมาย)',
  DETAIL:   'หัวข้อคุ้มครอง (รายละเอียด)',
  ADDRESS:  'ที่อยู่',
};

const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlFYTlNWmXoNCgVTHfcIV-b3BOpYOby1MLdYhdNCSsLG64MHXMWZiVDPfKcOYSZFIzgQ_iEdjM_3VX/pub?output=xlsx";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx8V7IPOwRNcm8cylLogQ7WWSiRMqPgdEvF7dyr9aNLhBZf0xcmoZBH8_k5Wg5NQm8SQQ/exec";

// ดึงค่าคงที่จาก user-script.js (จำลองเพื่อความ standalone)
const SF_COMPANY_LOGOS = {
  AAGI:  "https://www.allianz.co.th/content/dam/onemarketing/azay/allianz-co-th/about-allianz-ayudhya/news-index/aagi-news/aetna-thailand-became-allianz-group/Azay-logo-W1520x510.jpg",
  BKI:   "https://www.innwhy.com/wp-content/uploads/2018/01/BKI-Logo.jpg",
  TMSTH: "https://www.ttib.co.th/wp-content/uploads/2025/01/d3a63128386b3bba292b33951ea54277.jpeg",
  CHUBB: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRC2X4zWILUoOENR3rotGIHzdVAaMZlwET7pg&s",
  MSIG:  "https://www.msig-thai.com/sites/msig_th_revamp/files/inline-images/msig_brand_new.jpg",
  TIP:   "https://play-lh.googleusercontent.com/sw2IuQKxW-mhBjCe3DzR5SaIQXSDhTSZ-SmWCSNRk1RRywNWXGcE6ldXCi1W6iblwo0T=w600-h300-pc0xffffff-pd"
};

// =============================================================================
// 1. URL PARAMS — อ่าน / apply ค่าจาก URL (compat กับ user-script.js)
// =============================================================================

/**
 * sfLoadVisiblePlans — อ่าน plans ทั้งหมดที่ user-script.js ส่งมา
 * เรียกใน DOMContentLoaded หลัง sfApplyUrlParams()
 */
function sfLoadVisiblePlans() {
  try {
    const raw = sessionStorage.getItem('ttib_visible_plans');
    if (!raw) return;

    const payload = JSON.parse(raw);

    // ตรวจ timestamp ไม่เกิน 30 นาที
    if (Date.now() - payload.timestamp > 30 * 60 * 1000) {
      sessionStorage.removeItem('ttib_visible_plans');
      return;
    }

    sfState.visiblePlans = payload.plans || [];
    if (payload.biz && !sfState.bizName) {
      sfState.bizName = payload.biz;
    }

    // ถ้ามีข้อมูลแผนติดมา และยังไม่มี category ให้ดึงจากแผนแรกในรายการ
    if (sfState.visiblePlans.length > 0 && !sfState.category) {
      sfState.category = sfState.visiblePlans[0].category;
    }

    console.log(`[TTIB Form] รับ ${sfState.visiblePlans.length} plans จาก user-script`);

    // [NEW] แสดงผลสรุปรวมเสมอหากมีข้อมูลแผนส่งมา
    if (sfState.visiblePlans.length > 0) sfRenderAllPlansInfo(sfState.visiblePlans);
  } catch (e) {
    console.warn('[TTIB Form] sfLoadVisiblePlans error:', e);
  }
}

function sfParseUrlParams() {
  const params = {};
  const searchStr = window.location.search.substring(1);
  if (!searchStr) return params;

  searchStr.split('&').forEach(pair => {
    let [key, value] = pair.split('=');
    // แปลง + กลับเป็นช่องว่างก่อน decodeURIComponent
    value = decodeURIComponent((value || '').replace(/\+/g, ' '));
    key = decodeURIComponent((key || '').replace(/\+/g, ' '));
    if (key) params[key.trim()] = value.trim();
  });
  return params;
}

/**
 * sfApplyUrlParams — นำค่าจาก URL ไปใส่ใน Hidden Inputs และ Pre-fill ฟอร์ม
 * ใช้ id element เดียวกับ user-script.js (customer-source, campaign-name ฯลฯ)
 */
function sfApplyUrlParams() {
  const p = sfParseUrlParams();

  const finalSource   = p.source   || p.utm_source   || '';
  const setVal = (id, val, stateKey) => {
    if (val !== undefined && val !== null && val !== '') {
      const el = document.getElementById(id);
      if (el) el.value = val;
      if (stateKey) sfState[stateKey] = val;
    }
  };

  // ── ชื่อ ──
  setVal('sf-fname', p.fname, 'firstName');
  setVal('sf-lname', p.lname, 'lastName');
  setVal('sf-phone', p.phone, 'phone');
  setVal('sf-email', p.email, 'email');

  // ── ข้อมูลทรัพย์สิน ──
  setVal('sf-area',       p.area,  'area');
  setVal('sf-stock',      p.stock, 'stock');
  setVal('sf-equipment',  p.equip, 'equipment');
  setVal('sf-renovation', p.renov, 'renovation');
  setVal('sf-staff',      p.staff, 'staff');

  // ── แผนประกัน ──
  if (p.comp)  sfState.company  = p.comp;
  if (p.plan)  sfState.plan     = p.plan;
  if (p.group) sfState.group    = p.group;
  if (p.prem)  sfState.premium  = p.prem;
  if (p.cov)   sfState.covType  = p.cov;
  if (p.cat)   sfState.category = p.cat;

  // ── biz — [FIX] แยก set input และ state ออกจากกัน ──
  // กรณี isNotFound: ไม่ set bizName ลง state และไม่แสดงชื่อใน input
  // กรณีปกติ: set ทั้ง input และ state
  if (p.isNotFound === 'true') {
    sfState.bizName = ''; // [FIX] clear ให้ชัดเจน ไม่ให้ค้างจาก setVal
    const searchEl = document.getElementById('sf-biz-search');
    if (searchEl) searchEl.value = '';
    sfHandleNotFound();
  } else if (p.biz) {
    sfState.bizName = p.biz;
    const searchEl = document.getElementById('sf-biz-search');
    if (searchEl) searchEl.value = p.biz;
  }

  // ── tracking ──
  sfState.source   = finalSource;
}

// =============================================================================
// 2. STATE — เก็บข้อมูลฟอร์มทั้งหมด (ตรงกับ csFormData ใน user-script.js)
// =============================================================================

const sfState = {

  source:   '',

  // แผนที่เลือก
  company: '',
  plan: '',
  group: '',
  premium: '',
  visiblePlans: [],

  // Step 0: ธุรกิจ
  bizName:    '',
  bizCustom:  '',
  isNotFound: false,
  category:   '',
  covType:    'all',
  sumInsured: '',

  // ข้อมูลลูกค้า
  firstName: '',
  lastName:  '',
  phone:    '',
  email:    '',
  establishmentName: '',
  branchCount: '1',
  multiAddress: '',
  time:     '',
  addrNo:   '',
  addrMoo:  '',
  addrRoad: '',
  addrSub:  '',
  addrDist: '',
  addrProv: '',
  addrZip:  '',
  address:  '',

  // ข้อมูลทรัพย์สิน
  insuredStatus: '',
  area:        '',
  photoData:   null, // [NEW] เพิ่ม state สำหรับเก็บข้อมูลรูปภาพ
  stock:       '',
  equipment:   '',
  renovation:  '',
  staff:       '', // จำนวนพนักงาน
  claimVal:    'N', // เคยเคลมประกันหรือไม่ (Y/N)
  totalAssetValue: '', // New property for calculated total asset value
};

// =============================================================================
// 3. STEP NAVIGATION (ตรงกับ _renderContactStep / sfGoToStep ใน user-script.js)
// =============================================================================

/**
 * sfRenderAllPlansInfo — แสดงข้อมูลสรุปกรณีสอบถามหลายแผนพร้อมกัน (Multi-plan inquiry)
 * ปรับปรุง Banner ให้กำลังใจให้ระบุถึงแผนที่ลูกค้าดูค้างไว้
 */
function sfRenderAllPlansInfo(plans) {
  const banner       = document.getElementById('sf-selected-plan-banner');
  const helperText   = document.getElementById('sf-plan-helper-text');
  const noPlanBanner = document.getElementById('sf-no-plan-banner');

  if (noPlanBanner) noPlanBanner.style.display = 'none';
  if (helperText) {
    const compCount = new Set(plans.map(p => p.company)).size;
    helperText.style.display = 'flex';
    helperText.innerHTML = `
      <i class="ti ti-layout-grid" style="font-size:14px;"></i>
      แผนประกันแนะนำสำหรับคุณ (${compCount} บริษัท, ${plans.length} แพ็คเกจ)`;
  }

  if (banner) {
    const byCompany = {};
    plans.forEach(p => {
      if (!byCompany[p.company]) byCompany[p.company] = [];
      byCompany[p.company].push(p);
    });

    const companyTags = Object.keys(byCompany).map(comp => {
      const logoUrl = SF_COMPANY_LOGOS[comp.toUpperCase()];
      const planList = byCompany[comp];

      return `
      <div class="sf-plan-mini-card">
        <div class="sf-plan-mini-logo">
        ${logoUrl
          ? `<img src="${escSf(logoUrl)}" alt="${escSf(comp)}">`
          : `<div style="width:100%; height:100%; background:var(--brand); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:#fff;">${escSf(comp.substring(0,3))}</div>`
        }
        </div>
        <div class="sf-plan-mini-info">
          <div class="sf-plan-mini-name">${escSf(comp)}</div>
          <div class="sf-plan-mini-meta">
            <span class="sf-plan-mini-count">${planList.length} แพ็คเกจ</span>
          </div>
        </div>
      </div>`;
    }).join('');

    banner.innerHTML = `
    <div style="width:100%; display:flex; flex-direction:column; gap:12px;">
      <div style="font-size:11px; font-weight:800; color:var(--brand); text-transform:uppercase; letter-spacing:1px; display:flex; align-items:center; gap:6px; padding-left:2px; opacity:0.9;">
        <i class="ti ti-sparkles" style="font-size:15px; color:#f59e0b;"></i> แผนประกันภัยที่ระบบคัดเลือกให้ธุรกิจของคุณ
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px; width:100%;">
        ${companyTags}
      </div>
    </div>`;
    
    banner.style.display        = 'flex';
    banner.style.background     = '#f1f5f9';
    banner.style.padding        = '20px';
    banner.style.borderWidth    = '2px';
    banner.style.borderColor    = 'var(--brand)';

    banner.classList.add('shimmering');
    setTimeout(() => banner.classList.remove('shimmering'), 1200);
  }
}

/**
 * sfRenderSelectedPlan — แสดง Banner แผนประกันที่เลือก
 */
function sfRenderSelectedPlan() {
  const banner = document.getElementById('sf-selected-plan-banner');
  const helperText = document.getElementById('sf-plan-helper-text');
  const noPlanBanner = document.getElementById('sf-no-plan-banner');
  
  if (!banner || !helperText || !noPlanBanner) return;

  // [REVERT] แยก Logic การแสดงผล Banner กลับมาเหมือนเดิม
  // Case 1: มีการเลือกแผนประกันเฉพาะเจาะจง (comp และ plan ถูกส่งมา)
  if (sfState.company && sfState.plan && !sfState.isNotFound) {
    if (noPlanBanner) noPlanBanner.style.display = 'none';

    // สร้างโครงสร้าง HTML ของ Single Plan Banner ขึ้นมาใหม่ (หากยังไม่มี)
    if (!document.getElementById('sf-plan-comp-name')) {
      if (banner) {
        banner.style.padding = '15px';
        banner.style.background = 'var(--white)';
        banner.style.borderColor = 'var(--brand)';
        banner.innerHTML = `
          <div id="sf-plan-logo-wrap"></div>
          <div style="flex:1;">
            <div id="sf-plan-comp-name" style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;"></div>
            <div id="sf-plan-title-name" style="font-size:15px; font-weight:800; color:var(--brand);"></div>
            <div id="sf-plan-group-name" style="font-size:11px; color:var(--text-muted); font-weight:600;"></div>
          </div>
          <div id="sf-plan-price-tag" style="text-align:right; font-weight:800; color:var(--brand); font-size:16px;"></div>
        `;
      }
    }

    // อัปเดตข้อมูลใน Banner
    const compName = document.getElementById('sf-plan-comp-name');
    const planName = document.getElementById('sf-plan-title-name');
    const groupName = document.getElementById('sf-plan-group-name');
    const logoWrap = document.getElementById('sf-plan-logo-wrap');

    if (compName) compName.textContent = sfState.company;
    if (planName) planName.textContent = sfState.plan;
    if (groupName) groupName.textContent = sfState.group ? `กลุ่ม: ${sfState.group}` : '';

    if (logoWrap) {
      const logoUrl = SF_COMPANY_LOGOS[sfState.company.toUpperCase()];
      logoWrap.innerHTML = logoUrl ? 
        `<img src="${logoUrl}" alt="${sfState.company}">` : 
        `<div style="width:40px; height:40px; background:#f1f5f9; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; text-align:center; color:var(--brand); border:1px solid #e2e8f0;">${sfState.company.substring(0,3)}</div>`;
    }

    if (banner) {
      banner.style.display = 'flex';
      banner.classList.add('shimmering');
      setTimeout(() => { banner.classList.remove('shimmering'); }, 1200);
    }
    if (helperText) {
      helperText.style.display = 'flex';
      helperText.innerHTML = `<i class="ti ti-discount-check-filled" style="font-size: 14px;"></i> คุณกำลังเลือกแผนนี้`;
    }
  }
  // Case 2: ไม่ได้เลือกแผนเฉพาะ แต่มีรายการแผนที่ส่งมาจากหน้าก่อนหน้า
  else if (sfState.visiblePlans && sfState.visiblePlans.length > 0) {
    sfRenderAllPlansInfo(sfState.visiblePlans);
  } 
  // Case 3: ไม่มีข้อมูลแผนใดๆ เลย (เช่น เข้าหน้าฟอร์มโดยตรง)
  else {
    banner.style.display = 'none';
    helperText.style.display = 'none';
    noPlanBanner.style.display = 'flex';
  }
}

// =============================================================================

/**
 * sfToggleBranchType — สลับโหมดการแสดงผลที่อยู่ (แห่งเดียว vs หลายแห่ง)
 */
function sfToggleBranchType(val) {
  sfState.branchCount = val;
  const singleWrap = document.getElementById('sf-single-addr-wrap');
  const multiWrap  = document.getElementById('sf-multi-addr-wrap');
  
  if (singleWrap && multiWrap) {
    if (val === 'M') {
      singleWrap.style.display = 'none';
      multiWrap.style.display  = 'block';
      ['sub','dist','prov','zip'].forEach(k => sfShowError('err-addr-'+k, false));
    } else {
      singleWrap.style.display = 'block';
      multiWrap.style.display  = 'none';
      sfShowError('err-multi-address', false);
    }
  }
}
window.sfToggleBranchType = sfToggleBranchType;

/**
 * sfBackToMain — กลับหน้าหลัก
 */
function sfBackToMain() {
  location.href = 'index.html?from_form=true';
}
window.sfBackToMain = sfBackToMain;

// 4. VALIDATION — ตรงกับ _validateAndSaveStep ใน user-script.js
// =============================================================================

/**
 * sfShowError — toggle error state บน input + message
 */
function sfShowError(id, show, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', show);
  if (show && msg) el.textContent = msg;

  // ไฮไลต์ input ที่เกี่ยวข้อง
  const inputId = id.replace('err-', 'sf-');
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('error', show);
}

/**
 * sfValidateStep — ตรวจสอบ required fields (ตรงกับ logic ใน user-script.js _validateAndSaveStep)
 */
function sfValidateStep() {
  let valid = true;

    // ── ส่วนที่ 1: ธุรกิจ ──────────────────────────────────────────────────
    const bizSearch = document.getElementById('sf-biz-search')?.value.trim();
    const bizCustom = document.getElementById('sf-biz-custom')?.value.trim();

    if (sfState.isNotFound) {
      const hasBizCustom = !!bizCustom;
      sfShowError('err-biz-custom', !hasBizCustom, 'ช่วยระบุประเภทธุรกิจของคุณสักนิดครับ');
      if (!hasBizCustom) valid = false;
    } else {
      const hasBiz = sfState.bizName || bizSearch;
      sfShowError('err-biz', !hasBiz, 'ช่วยค้นหาหรือเลือกประเภทธุรกิจของคุณด้วยครับ');
      if (!hasBiz) valid = false;
    }

    // ── ตรวจสอบข้อมูลทรัพย์สิน (Asset Fields Numeric Validation) ──
    const assetFields = [
      { id: 'area', label: 'ทุนประกันภัยตัวอาคาร' },
      { id: 'stock', label: 'ทรัพย์สินภายในอาคาร' },
      { id: 'equipment', label: 'มูลค่าเครื่องจักร' },
      { id: 'renovation', label: 'สต็อกสินค้า' }, 
      { id: 'staff', label: 'จำนวนพนักงาน' }
    ];

    assetFields.forEach(f => {
      const val = document.getElementById(`sf-${f.id}`)?.value.replace(/,/g, '').trim();
      if (val && isNaN(Number(val))) {
        sfShowError(`err-${f.id}`, true, `ช่อง${f.label}รบกวนกรอกเฉพาะตัวเลขนะครับ`);
        valid = false;
      } else {
        sfShowError(`err-${f.id}`, false);
      }
    });

    // ── ส่วนที่ 2: ชื่อ + เบอร์โทร + ที่อยู่ ──────────────────────────────────
    const requiredFields = [
      { id: 'fname', label: 'ชื่อ', msg: 'ขอทราบชื่อของคุณด้วยครับ' },
      { id: 'lname', label: 'นามสกุล', msg: 'ขอทราบนามสกุลด้วยครับ' },
      { id: 'phone', label: 'เบอร์โทรศัพท์', msg: 'โปรดระบุเบอร์โทรศัพท์เพื่อการติดต่อกลับครับ' },
      { id: 'time',  label: 'ช่วงเวลาที่สะดวก', msg: 'ช่วยเลือกเวลาที่สะดวกให้เจ้าหน้าที่ติดต่อกลับครับ' }
    ];

    if (sfState.branchCount === 'M') {
      requiredFields.push({ id: 'multi-address', label: 'ที่อยู่ทั้งหมด', msg: 'รบกวนระบุรายละเอียดที่อยู่ให้ครบถ้วนครับ' });
    } else {
      requiredFields.push(
        { id: 'addr-sub',  label: 'แขวง/ตำบล', msg: 'ช่วยระบุแขวง/ตำบลด้วยครับ' },
        { id: 'addr-dist', label: 'เขต/อำเภอ', msg: 'ช่วยระบุเขต/อำเภอด้วยครับ' },
        { id: 'addr-prov', label: 'จังหวัด', msg: 'ช่วยระบุจังหวัดด้วยครับ' },
        { id: 'addr-zip',  label: 'รหัสไปรษณีย์', msg: 'ช่วยระบุรหัสไปรษณีย์ด้วยครับ' }
      );
    }

    // 1. ตรวจสอบค่าว่างพื้นฐาน (Refactored)
    requiredFields.forEach(f => {
      const el = document.getElementById(`sf-${f.id}`);
      if (!el || !el.value.trim()) {
        sfShowError(`err-${f.id}`, true, f.msg);
        valid = false;
      } else {
        sfShowError(`err-${f.id}`, false);
      }
    });
    // 2. ตรวจสอบรูปแบบข้อมูลเชิงลึก
    if (valid) {
      const phone = document.getElementById('sf-phone')?.value.trim().replace(/[-\s]/g, '');
      if (!/^0[2,3,4,5,6,8,9]\d{7,8}$/.test(phone)) {
        sfShowError('err-phone', true, 'เบอร์โทรศัพท์ควรมี 9-10 หลัก และขึ้นต้นด้วย 0 ครับ');
        valid = false;
      }

      const email = document.getElementById('sf-email')?.value.trim();
      if (valid && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sfShowError('err-email', true, 'รูปแบบอีเมลดูไม่ถูกต้อง รบกวนตรวจสอบอีกครั้งนะครับ');
        valid = false;
      }

      // 3. ตรวจสอบความถูกต้องของที่อยู่กับฐานข้อมูล (Address Integrity)
      if (valid && sfState.branchCount === '1' && sfAddressData.length > 1) {
        const sub  = document.getElementById('sf-addr-sub').value.trim();
        const zip  = document.getElementById('sf-addr-zip').value.trim();
        const match = sfAddressData.slice(1).some(r => String(r[0]).trim() === sub && String(r[3]).trim() === zip);
        
        if (!match) {
          sfShowError('err-addr-zip', true, 'รหัสไปรษณีย์ไม่ตรงกับตำบลที่เลือกไว้ รบกวนตรวจสอบอีกครั้งครับ');
          valid = false;
        }
      }
    }

  if (!valid) {
    const firstError = document.querySelector('.sf-inp.error');
    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return valid;
}

// =============================================================================
// 5. SAVE STATE — ตรงกับ _saveCurrentStepToState ใน user-script.js
// =============================================================================

/**
 * sfSaveStep — อ่านค่าจาก DOM → sfState (เหมือน logic ใน user-script.js ทุก step)
 */
function sfSaveStep() {
  const g = id => document.getElementById(id)?.value?.trim() || '';

    // Save Business & Assets
    sfState.bizCustom  = g('sf-biz-custom');
    sfState.insuredStatus = g('sf-insured-status');
    sfState.area          = g('sf-area');
    sfState.stock         = g('sf-stock');
    sfState.equipment     = g('sf-equipment');
    sfState.renovation    = g('sf-renovation'); // สลับกับ equipment ตามคำขอ
    sfState.staff         = g('sf-staff');
    sfState.claimVal      = g('sf-claim-val') || 'N';
    // sfState.claimCount    = g('sf-claim-count'); // ถูกลบออก
    // sfState.claimAmt      = g('sf-claim-amt'); // ถูกลบออก
    // sfState.claimReason   = g('sf-claim-reason'); // ถูกลบออก

    // sfState.bizName set แล้วใน sfSelectBiz()
    if (!sfState.isNotFound && !sfState.bizName) {
      sfState.bizName = g('sf-biz-search');
    }

    sfState.firstName = g('sf-fname');
    sfState.lastName  = g('sf-lname');
    sfState.establishmentName = g('sf-establishment-name');
    sfState.branchCount = document.getElementById('sf-branch-count')?.value || '1';
    sfState.multiAddress = g('sf-multi-address');
    sfState.phone     = g('sf-phone');
    sfState.email     = g('sf-email');
    sfState.time      = g('sf-time');
    sfState.addrNo    = g('sf-addr-no');
    sfState.addrMoo   = g('sf-addr-moo');
    sfState.addrRoad  = g('sf-addr-road');
    sfState.addrSub   = g('sf-addr-sub');
    sfState.addrDist  = g('sf-addr-dist');
    sfState.addrProv  = g('sf-addr-prov');
    sfState.addrZip   = g('sf-addr-zip');

    let parts = [];
    if (sfState.branchCount === 'M') {
      parts = [`[หลายสถานที่ประกอบการ]`, sfState.multiAddress];
    } else {
      parts = [
        sfState.establishmentName,
        sfState.addrNo   ? `เลขที่ ${sfState.addrNo}`   : '',
        sfState.addrMoo  ? `หมู่ ${sfState.addrMoo}`    : '',
        sfState.addrRoad ? `ถ.${sfState.addrRoad}`       : '',
        sfState.addrSub  ? `ต./แขวง ${sfState.addrSub}` : '',
        sfState.addrDist ? `อ./เขต ${sfState.addrDist}` : '',
        sfState.addrProv ? `จ.${sfState.addrProv}`       : '',
        sfState.addrZip  || '',
      ];
    }
    sfState.address = parts.filter(Boolean).join(' ');
}
// =============================================================================
// 6. BIZ SEARCH — ตรงกับ filterBusinessOptions / selectBusinessSuggestion ใน user-script.js
// =============================================================================

let sfBizMappings = []; 
let sfPremiumDatabase = {};
let sfAddressData = []; // โหลดจาก sessionStorage['ttib_address_data']

/**
 * sfLoadDataFromSheet — ดึงข้อมูลโดยตรงจาก Google Sheets โดยใช้ SHEET_NAMES
 * สำหรับกรณีเปิดหน้าฟอร์มแยก หรือ Session เดิมหมดอายุ
 */
async function sfLoadDataFromSheet() {
  const loader = document.getElementById('sf-load-status');
  try {
    if (loader) loader.style.display = 'block';
    const response = await fetch(GOOGLE_SHEET_URL + "&t=" + Date.now());
    if (!response.ok) throw new Error("HTTP " + response.status);
    
    const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: 'array' });
    const toArr = name => workbook.Sheets[name] ? XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) : null;

    // 1. ดึงรายชื่อธุรกิจจาก Sheet BIZ
    const bizRows = toArr(SHEET_NAMES.BIZ);
    if (bizRows) {
      sfBizMappings = []; 
      for (let i = 1; i < bizRows.length; i++) {
        const row = bizRows[i];
        if (!row) continue;

        const cat     = String(row[0] || '').trim();
        const biz     = String(row[1] || '').trim();
        const comp    = String(row[2] || '').trim();
        const plan    = String(row[3] || '').trim();
        const grp     = String(row[4] || '').trim();
        const covType = String(row[5] || '').trim();

        if (biz && plan) {
          sfBizMappings.push({ category: cat, business: biz, company: comp, plan, group: grp, covType });
        }
      }
      sfBizList = [...new Set(sfBizMappings.map(m => m.business))].sort((a, b) => a.localeCompare(b, 'th'));
      
      sessionStorage.setItem('ttib_biz_list', JSON.stringify(sfBizList));
      sessionStorage.setItem('ttib_biz_mappings', JSON.stringify(sfBizMappings));
    }

    // 2. ดึงข้อมูลเบี้ยประกันจาก Sheet PREMIUM
    const premRows = toArr(SHEET_NAMES.PREMIUM);
    if (premRows && premRows.length > 3) {
      sfPremiumDatabase = {};
      const compRow  = premRows[0] || [];
      const planRow  = premRows[1] || [];
      const groupRow = premRows[2] || [];
      let lastComp = "";
      
      for (let r = 3; r < premRows.length; r++) {
        const sum = Number(String(premRows[r][0] || '').replace(/,/g, ''));
        if (!sum) continue;
        sfPremiumDatabase[sum] = {};
        for (let c = 1; c < planRow.length; c++) {
          const cc = String(compRow[c] || '').trim();
          if (cc) lastComp = cc;
          if (!lastComp || !planRow[c]) continue;
          const g = (groupRow[c] && groupRow[c] !== '-' && groupRow[c] !== '—') ? sfNormalize(groupRow[c]) : '';
          const key = sfNormalize(lastComp) + "|" + sfNormalize(planRow[c]) + "|" + g;
          sfPremiumDatabase[sum][key] = Number(String(premRows[r][c] || '').replace(/,/g, '')) || 0;
        }
      }
      sessionStorage.setItem('ttib_premium_db', JSON.stringify(sfPremiumDatabase));
    }

    // 3. ดึงข้อมูลที่อยู่จาก Sheet ADDRESS
    const addrRows = toArr(SHEET_NAMES.ADDRESS);
    if (addrRows) {
      sfAddressData = addrRows;
      sfInitAddress();
      sessionStorage.setItem('ttib_address_data', JSON.stringify(sfAddressData));
    }

    if (sfState.bizName) {
      sfSelectBiz(sfState.bizName);
    }

    // [FIX] หลังจากโหลด Database สำเร็จ ให้บังคับ Re-render แผนแนะนำอีกครั้ง 
    // เพื่อเปลี่ยนจากราคาสำรอง (Payload) เป็นราคาจริงที่ตรงตามทุนประกันในหน้าจอ
    if (!sfState.company && sfState.visiblePlans && sfState.visiblePlans.length > 0) {
      sfRenderAllPlansInfo(sfState.visiblePlans);
    }

    console.log(`[TTIB Form] Data synced from Google Sheets: ${sfBizList.length} biz found.`);
    if (loader) setTimeout(() => loader.style.display = 'none', 800);
  } catch (err) {
    console.error('[TTIB Form] Load Sheet Error:', err.message);
    if (loader) {
      loader.classList.remove('sf-loader-animated');
      loader.style.background = '#fee2e2';
      loader.style.color = '#991b1b';
      loader.style.borderColor = '#fca5a5';
      loader.innerHTML = `<i class="ti ti-alert-circle"></i> ไม่สามารถโหลดข้อมูลได้ กรุณารีเฟรชหน้าจอ`;
      loader.style.display = 'block'; // ประกันว่า element จะแสดงผลแม้เกิด error ทันที
    }
  }
}

/**
 * sfInitAddress — เริ่มต้นระบบที่อยู่ (เหมือน _initAddressDropdowns ใน user-script.js)
 */
function sfInitAddress() {
  try {
    // ตรวจสอบว่ามีข้อมูลในตัวแปรอยู่แล้วหรือไม่ (ถ้าไม่มีค่อยดึงจาก cache)
    if (!sfAddressData || sfAddressData.length <= 1) {
      const cached = sessionStorage.getItem('ttib_address_data');
      if (!cached) return;
      sfAddressData = JSON.parse(cached);
    }
    if (!sfAddressData || sfAddressData.length <= 1) return;

    const subList = document.getElementById('sf-list-sub');
    if (!subList) return;

    // เริ่มต้น: ใส่ข้อมูลทั้งหมดลงใน datalists เพื่อให้เริ่มค้นหาได้ทุกช่อง
    const populate = (listId, idx) => {
      const list = document.getElementById(listId);
      if (!list) return;
      const items = [...new Set(sfAddressData.slice(1).map(r => String(r[idx] || '').trim()))].sort();
      list.innerHTML = items.map(v => `<option value="${escSf(v)}">`).join('');
    };

    populate('sf-list-sub', 0);
    populate('sf-list-dist', 1);
    populate('sf-list-prov', 2);
    populate('sf-list-zip', 3);

    // ผูก Event Listeners (เลียนแบบ oninput ใน HTML)
    document.getElementById('sf-addr-sub')?.addEventListener('input', sfOnAddrSubChange);
    document.getElementById('sf-addr-dist')?.addEventListener('input', sfOnAddrDistChange);
    document.getElementById('sf-addr-prov')?.addEventListener('input', sfOnAddrProvChange);

    // ── ตรวจสอบข้อมูลที่มีอยู่แล้วและสั่งกรองทันที (กรณีกดย้อนกลับหรือ Pre-fill) ──
    sfOnAddrSubChange();
  } catch (e) {
    console.warn('[TTIB Form] Address init failed:', e);
  }
}

function sfOnAddrSubChange() {
  const sub = document.getElementById('sf-addr-sub')?.value;
  const distInp = document.getElementById('sf-addr-dist');
  const distList = document.getElementById('sf-list-dist');
  if (!distInp || !distList) return;

  const matches = sfAddressData.slice(1).filter(r => String(r[0]).trim() === sub);
  const matchedDists = [...new Set(matches.map(r => String(r[1]).trim()))].sort();

  distList.innerHTML = matchedDists.map(d => `<option value="${escSf(d)}">`).join('');

  if (matchedDists.length === 1) {
    distInp.value = matchedDists[0];
  }
  sfFilterProvAndZip();
}

function sfOnAddrDistChange() { sfFilterProvAndZip(); }
function sfOnAddrProvChange() { sfFilterZip(); }

function sfFilterProvAndZip() {
  const sub = document.getElementById('sf-addr-sub')?.value;
  const dist = document.getElementById('sf-addr-dist')?.value;
  const provInp = document.getElementById('sf-addr-prov');
  const provList = document.getElementById('sf-list-prov');
  if (!provInp || !provList) return;

  let matches = sfAddressData.slice(1);
  if (sub) matches = matches.filter(r => String(r[0]).trim() === sub);
  if (dist) matches = matches.filter(r => String(r[1]).trim() === dist);

  const provs = [...new Set(matches.map(r => String(r[2]).trim()))].sort();
  provList.innerHTML = provs.map(p => `<option value="${escSf(p)}">`).join('');

  if (provs.length === 1 && provInp.value !== provs[0]) {
    provInp.value = provs[0];
  }
  sfFilterZip();
}

function sfFilterZip() {
  const sub = document.getElementById('sf-addr-sub')?.value;
  const dist = document.getElementById('sf-addr-dist')?.value;
  const prov = document.getElementById('sf-addr-prov')?.value;
  const zipInp = document.getElementById('sf-addr-zip');
  const zipList = document.getElementById('sf-list-zip');
  if (!zipInp || !zipList) return;

  let matches = sfAddressData.slice(1);
  if (sub) matches = matches.filter(r => String(r[0]).trim() === sub);
  if (dist) matches = matches.filter(r => String(r[1]).trim() === dist);
  if (prov) matches = matches.filter(r => String(r[2]).trim() === prov);

  const zips = [...new Set(matches.map(r => String(r[3]).trim()))].sort();
  zipList.innerHTML = zips.map(z => `<option value="${escSf(z)}">`).join('');

  if (zips.length === 1) {
    zipInp.value = zips[0];
  }
}

let sfBizList = []; // โหลดจาก sessionStorage['ttib_biz_list'] เหมือน user-script.js

function sfNormalize(str) {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase();
}

/**
 * sfAnimatePrice — อนิมชั่นเลขวิ่ง (Counter Up) พร้อมเอฟเฟกต์สีเมื่อราคาลดลง
 */
function sfAnimatePrice(el, targetValue, duration = 800, includeSuffix = true) {
  if (!el || isNaN(targetValue)) return;
  
  // ยกเลิก animation เดิมถ้ามี
  if (el._sfAnimId) cancelAnimationFrame(el._sfAnimId);

  const startValue = parseFloat(el.dataset.currentValue) || 0;
  const startTime = performance.now();

  // ตรวจสอบทิศทางการเปลี่ยนแปลงราคา (ต้องไม่ใช่การโหลดครั้งแรกที่มีค่าเป็น 0)
  if (startValue > 0) {
    if (el._sfColorTimeout) clearTimeout(el._sfColorTimeout);

    if (targetValue < startValue) {
      el.classList.add('sf-price-reduced');
      el.classList.remove('sf-price-increased');
    } else if (targetValue > startValue) {
      el.classList.add('sf-price-increased');
      el.classList.remove('sf-price-reduced');
    }

    // ลบเอฟเฟกต์สีออกหลังจากอนิเมชั่นจบลงเล็กน้อย
    el._sfColorTimeout = setTimeout(() => {
      el.classList.remove('sf-price-reduced', 'sf-price-increased');
    }, duration + 200);
  } else {
    el.classList.remove('sf-price-reduced', 'sf-price-increased');
  }

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing: easeOutExpo ช่วยให้ตอนจบดูนุ่มนวล
    const easedProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const currentValue = Math.floor(startValue + (targetValue - startValue) * easedProgress);

    const formatted = currentValue.toLocaleString('th-TH');
    if (currentValue > 0) {
      el.textContent = includeSuffix ? formatted + ' บาท' : formatted;
    } else {
      el.textContent = 'ระบบกำลังคำนวณ...';
    }
    el.dataset.currentValue = currentValue;

    if (progress < 1) {
      el._sfAnimId = requestAnimationFrame(update);
    } else {
      const finalFormatted = targetValue.toLocaleString('th-TH');
      el.textContent = includeSuffix ? finalFormatted + ' บาท' : finalFormatted;
      el.dataset.currentValue = targetValue;
      delete el._sfAnimId;
    }
  }

  el._sfAnimId = requestAnimationFrame(update);
}



/**
 * ช่วยใส่ Comma ให้ตัวเลขทั่วไปขณะพิมพ์
 */
function sfFormatSimpleNumber(el) {
  let val = el.value.replace(/[^0-9]/g, '');
  el.value = val ? Number(val).toLocaleString('th-TH') : '';
}

/**
 * sfCalculateTotalAssetValue — คำนวณมูลค่าทรัพย์สินรวม
 */
function sfCalculateTotalAssetValue() {
  const toNum = (id) => {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = String(el.value || '').replace(/[^0-9.]/g, '');
    return parseFloat(val) || 0;
  };

  const total = toNum('sf-area') + toNum('sf-stock') + toNum('sf-equipment') + toNum('sf-renovation');
  sfState.totalAssetValue = total.toLocaleString('th-TH');
  // อัปเดต sumInsured ใน state ไปพร้อมกันเพื่อให้ราคาใน Banner เปลี่ยนตาม
  sfState.sumInsured = total; 

  // อัปเดตราคาในรายการแผนแนะนำ (visiblePlans) ให้สอดคล้องกับทุนประกันที่คำนวณได้ใหม่
  if ((!sfState.company || !sfState.plan) && sfState.visiblePlans && sfState.visiblePlans.length > 0) {
    const isDbReady = sfPremiumDatabase && Object.keys(sfPremiumDatabase).length > 0;
    if (isDbReady) {
      sfState.visiblePlans.forEach(p => {
        const g = (p.group && p.group !== '-' && p.group !== '—') ? sfNormalize(p.group) : '';
        const key = sfNormalize(p.company) + "|" + sfNormalize(p.plan) + "|" + g;
        // ค้นหาเบี้ยประกันใหม่จากฐานข้อมูลตามทุนรวม (total)
        p.premium = sfPremiumDatabase[total]?.[key] || 0;
      });
    }
  }

  sfRenderSelectedPlan();

  const displayEl = document.getElementById('sf-total-asset-value');
  if (displayEl) {
    sfAnimatePrice(displayEl, total, 800, true); // Animate to the new total, with suffix
  }
}

// เก็บตัวแปรสำหรับ Debounce
let sfSearchTimeout;

/**
 * sfFilterBiz — กรองธุรกิจ + แสดง dropdown
 * [BUG FIX] ใช้ตัวแปร searchTokens สม่ำเสมอ (เดิมตั้งชื่อ tokens แล้วใช้ searchTokens → ReferenceError)
 */
function sfFilterBiz() {
  const searchEl = document.getElementById('sf-biz-search');
  if (!searchEl) return;

  // [FIX] guard ก่อน setTimeout — ไม่สร้าง timeout เลยถ้าอยู่ใน notFound mode
  if (sfState.isNotFound) {
    sfHideSuggestions();
    return;
  }

  clearTimeout(sfSearchTimeout);
  sfSearchTimeout = setTimeout(() => {
    const rawVal  = searchEl.value;
    const trimmed = rawVal.trim();

    if (!trimmed) {
      sfHideSuggestions();
      return;
    }

    if (sfState.bizName && sfState.bizName !== trimmed) {
      sfState.bizName = '';
      sfState.visiblePlans = [];
      const selDiv = document.getElementById('sf-biz-selected');
      if (selDiv) selDiv.style.display = 'none';
      sfRenderSelectedPlan();
    }

    const searchTokens = trimmed
      .split(/\s+/)
      .map(t => sfNormalize(t))
      .filter(t => t);

    const MAX_DISPLAY = 40;
    const matches = sfBizList.filter(bizName => {
      const normBiz = sfNormalize(bizName);
      return searchTokens.every(token => normBiz.includes(token));
    }).slice(0, MAX_DISPLAY);

    sfShowSuggestions(matches, rawVal);
  }, 200);
}

/**
 * sfShowSuggestions — render dropdown (เหมือน suggestionsBox ใน user-script.js)
 */
function sfShowSuggestions(matches, rawVal) {
  const searchEl = document.getElementById('sf-biz-search');
  if (!searchEl) return;

  const drop = document.createElement('div');
  drop.id = 'sf-biz-suggestions-drop';
  drop.style.cssText = `
    position:absolute;top:100%;left:0;right:0;
    background:#fff;border:1.5px solid var(--brand,#0f6e56);
    border-top:none;border-radius:0 0 10px 10px;
    max-height:250px;overflow-y:auto;z-index:200;
    box-shadow:0 8px 24px rgba(0,0,0,0.1);
  `;

  if (matches.length === 0) {
    drop.innerHTML = `
      <div style="padding:14px;font-size:13px;color:#64748b;text-align:center;">
        <i class="ti ti-search-off" style="font-size:20px;display:block;margin-bottom:5px;opacity:0.5;"></i>
       หากไม่พบธุรกิจที่ค้นหา กรุณากดปุ่ม "ไม่พบธุรกิจ"
      </div>
      <div onclick="sfHandleNotFound()" style="
        padding:12px 14px;font-size:13px;font-weight:700;
        color:#854d0e;background:#fefce8;cursor:pointer;
        border-top:1px solid #fde047;
        display:flex;align-items:center;gap:8px;">
        <i class="ti ti-help-circle"></i> ระบุธุรกิจที่ไม่อยู่ในรายการ →
      </div>`;
  } else {
    matches.forEach(biz => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding:11px 14px;font-size:14px;cursor:pointer;
        border-bottom:1px solid #f1f5f9;transition:background 0.15s;color:#1e293b;
        display:flex;align-items:center;gap:8px;`;
      item.innerHTML = `<i class="ti ti-search" style="color:#94a3b8;font-size:14px;"></i> ${escSf(biz)}`;
      
      item.addEventListener('mouseenter', () => item.style.background = '#f0fdf4');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('click', () => sfSelectBiz(biz));
      drop.appendChild(item);
    });

    const nfItem = document.createElement('div');
    nfItem.style.cssText = `
      padding:10px 14px;font-size:12px;font-weight:700;
      color:#ca8a04;background:#fefce8;cursor:pointer;
      border-top:1px solid #fde047;
      display:flex;align-items:center;gap:8px;`;
    nfItem.innerHTML = '<i class="ti ti-help-circle"></i> ไม่พบธุรกิจของคุณ?';
    nfItem.addEventListener('click', sfHandleNotFound);
    drop.appendChild(nfItem);
  }

  const wrapper = searchEl.parentElement;
  if (wrapper) {
    wrapper.style.position = 'relative';
    wrapper.appendChild(drop);
  }
}

function sfHideSuggestions() {
  document.getElementById('sf-biz-suggestions-drop')?.remove();
}

/**
 * sfSelectBiz — เลือกธุรกิจ (เหมือน selectBusinessSuggestion ใน user-script.js)
 */
function sfSelectBiz(bizName) {
  const matches = sfBizMappings.filter(m => m.business === bizName);
  if (matches.length > 0) {
    sfState.category = matches[0].category;
    const isChanged = !!sfState.bizName && sfState.bizName !== bizName;
    const hasVisiblePlans = sfState.visiblePlans && sfState.visiblePlans.length > 0;
    const shouldRebuildPlans = !sfState.company && (!hasVisiblePlans || isChanged);

    if (shouldRebuildPlans) {
      const currentSum = Number(String(sfState.sumInsured || '0').replace(/,/g, ''));
      
      sfState.visiblePlans = matches.map(m => {
        const g = (m.group && m.group !== '-' && m.group !== '—') ? sfNormalize(m.group) : '';
        const key = sfNormalize(m.company) + "|" + sfNormalize(m.plan) + "|" + g;
        const prem = (sfPremiumDatabase[currentSum] && sfPremiumDatabase[currentSum][key]) || 0;
        return {
          company: m.company, plan: m.plan, group: m.group, covType: m.covType, premium: prem
        };
      });

      console.log(`[TTIB Form] sfSelectBiz: rebuild visiblePlans (${sfState.visiblePlans.length} แผน) สำหรับ "${bizName}"`);
    } else {
      console.log(`[TTIB Form] sfSelectBiz: คง visiblePlans เดิม (${sfState.visiblePlans?.length || 0} แผน) ไว้`);
    }
  } else {
    sfState.category = '';
  }

  sfState.bizName    = bizName;
  sfState.isNotFound = false;

  const searchEl = document.getElementById('sf-biz-search');
  if (searchEl) searchEl.value = bizName;

  const currentSumVal = sfState.sumInsured;

  // หากมีแผนประกันเฉพาะที่เลือกไว้ ให้คำนวณเบี้ยใหม่
  if (currentSumVal && sfState.company && sfState.plan) {
    const currentSumNum = Number(String(currentSumVal).replace(/,/g, ''));
    const key = sfNormalize(sfState.company) + "|" + sfNormalize(sfState.plan) + "|" + sfNormalize(sfState.group || '');
    sfState.premium = sfPremiumDatabase[currentSumNum]?.[key] || '0';
  }

  sfRenderSelectedPlan();

  const selectedDiv  = document.getElementById('sf-biz-selected');
  const selectedText = document.getElementById('sf-biz-selected-text');
  if (selectedDiv && selectedText) {
    selectedText.textContent = bizName;
    selectedDiv.style.display = 'flex';
  }

  sfResetNotFoundBtn();
  sfShowError('err-biz', false);
  sfHideSuggestions();
}

/**
 * sfClearBiz — ล้างธุรกิจที่เลือก (เหมือน clearSearchBiz ใน user-script.js)
 */
function sfClearBiz() {
  sfState.bizName    = '';
  sfState.isNotFound = false;
  sfState.visiblePlans = []; // ล้างแผนแนะนำเดิมทิ้งเมื่อมีการล้างค่าธุรกิจ

  const searchEl    = document.getElementById('sf-biz-search');
  const selectedDiv = document.getElementById('sf-biz-selected');
  const nfGroup     = document.getElementById('sf-notfound-group');

  if (searchEl)    { searchEl.value = ''; }
  if (selectedDiv)   selectedDiv.style.display = 'none';
  
  sfResetNotFoundBtn();
}

/**
 * sfHandleNotFound — เมื่อไม่พบธุรกิจในรายการ (เหมือน handleNotFoundBiz ใน user-script.js)
 */
function sfHandleNotFound() {
  sfState.isNotFound = true;
  sfState.category   = '';
  sfHideSuggestions(); 

  const nfGroup = document.getElementById('sf-notfound-group');
  const searchGroup = document.getElementById('sf-search-group');

  if (nfGroup) nfGroup.style.display = 'block';
  if (searchGroup) searchGroup.style.display = 'none';
  
  document.getElementById('sf-biz-selected')?.style &&
    (document.getElementById('sf-biz-selected').style.display = 'none');

  setTimeout(() => document.getElementById('sf-biz-custom')?.focus(), 100);
  sfRenderSelectedPlan();
}

/**
 * sfResetNotFoundBtn — รีเซ็ตสถานะปุ่มไม่พบธุรกิจ (เหมือน resetNotFoundBtn ใน user-script.js)
 */
function sfResetNotFoundBtn() {
  const btn = document.querySelector('.btn-not-found');
  const nfGroup = document.getElementById('sf-notfound-group');
  const searchGroup = document.getElementById('sf-search-group');

  if (btn) {
    btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = '';
    btn.innerHTML = '<i class="ti ti-help-circle"></i> <span>ไม่พบธุรกิจ</span>';
  }
  if (nfGroup) nfGroup.style.display = 'none';
  if (searchGroup) searchGroup.style.display = 'block';
  sfRenderSelectedPlan();
}

/**
 * Alias สำหรับเรียกใช้ sfHandleNotFound (เพื่อให้ compat กับปุ่ม handleNotFoundBiz จากหน้าหลัก)
 */
function handleNotFoundBiz() { sfHandleNotFound(); }
window.handleNotFoundBiz = handleNotFoundBiz;

// =============================================================================
// 7. RADIO CHIP & CLAIM TOGGLE — ตรงกับ _csSelectRadio / _csToggleClaim ใน user-script.js
// =============================================================================

/**
 * sfSelectChip — visual radio chip (เหมือน _csSelectRadio ใน user-script.js)
 */
function sfSelectChip(el, groupId, hiddenId) {
  document.querySelectorAll(`#${groupId} .sf-radio-chip`).forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = el.dataset.val || el.textContent.trim();
}

/**
 * sfToggleClaim — toggle เคย/ไม่เคย (เหมือน _csToggleClaim ใน user-script.js)
 */
function sfToggleClaim(val) {
  document.getElementById('sf-claim-val').value = val;

  const yBtn   = document.getElementById('sf-claim-yes-btn');
  const nBtn   = document.getElementById('sf-claim-no-btn');

  if (yBtn)   yBtn.className   = 'sf-toggle-btn' + (val === 'Y' ? ' active-y' : '');
  if (nBtn)   nBtn.className   = 'sf-toggle-btn' + (val === 'N' ? ' active-n' : '');

  sfState.claimVal = val;
}

// =============================================================================
// 8. DATA HELPERS — สำหรับเตรียมข้อมูลก่อนส่ง
// =============================================================================

/**
 * sfBuildAssetSummaryString — สร้างสตริงสรุปทรัพย์สินสำหรับบันทึกลง Spreadsheet
 * เพื่อให้ฟังก์ชัน parseAssetPart ใน admin-script.js และ user-script.js อ่านได้
 */
function sfBuildAssetSummaryString() {
  const data = sfState;
  const parts = [
    `สถานะ:${data.insuredStatus || '-'}`,
    `ทุนอาคาร:${data.area        || '-'} บาท`,
    `ทรัพย์สินภายใน:${data.stock || '-'} บาท`,
    `เครื่องจักร:${data.equipment || '-'} บาท`,
    `สต็อกสินค้า:${data.renovation || '-'} บาท`,
    `พนักงาน:${data.staff || '-'} คน`,
    `เคลม:${data.claimVal === 'Y' ? `เคย` : 'ไม่เคย'}`, // ปรับแก้: ไม่แสดงรายละเอียดการเคลม
    data.totalAssetValue ? `รวมมูลค่าทรัพย์สิน:${data.totalAssetValue} บาท` : '',
  ];
  return parts.filter(Boolean).join(' | ');
}




// =============================================================================
// 9. SUBMIT — ตรงกับ submitContactForm ใน user-script.js
// =============================================================================

/**
 * sfSubmit — ส่งข้อมูลฟอร์ม
 * rowDataArray 16 คอลัมน์ — compat กับ submitContactForm ใน user-script.js
 */
async function sfSubmit() {
  // 1. Validate everything at once (ตรวจสอบช่องกรอกข้อมูลก่อน)
  if (!sfValidateStep()) return;

  // 2. ตรวจสอบการยินยอม PDPA หลังข้อมูลชุดอื่นถูกต้องแล้ว
  const consent = document.getElementById('sf-consent');
  if (!consent?.checked) {
    sfShowStatus('⚠️ กรุณายืนยันการยินยอมข้อมูลส่วนบุคคลก่อนส่ง', 'warn');
    consent?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Save all fields and render hidden summary for asset parsing
  sfSaveStep();

  const loadingOverlay = document.getElementById('sf-submit-loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';

  const btn = document.getElementById('sf-submit-btn');
  if (btn) { 
    btn.disabled = true; 
    btn.classList.add('sf-btn-loading');
    btn.innerHTML = '<i class="ti ti-loader-2 ti-spin"></i> กำลังส่งข้อมูล...'; 
  }

  // ── bizText ───────────────────────────────────────────────────────────────
  // ดึงค่าจาก state ได้ทันทีเพราะ sfSaveStep() บันทึกมาแล้ว
  const bizText = sfState.isNotFound
    ? `อื่นๆ: ${sfState.bizCustom || 'ไม่ระบุ'}`
    : (sfState.bizName || 'ไม่ระบุ');

  // ── sumInsured ────────────────────────────────────────────────────────────
  const cleanSum = String(sfState.sumInsured || '0').replace(/,/g, '');
  const sumDisplay = !isNaN(parseFloat(cleanSum)) && parseFloat(cleanSum) > 0
    ? Number(cleanSum).toLocaleString('th-TH')
    : (sfState.sumInsured || '-');

  const fullName = `${sfState.firstName} ${sfState.lastName}`.trim();

  // ── assetSummary ──────────────────────────────────────────────────────────
  const assetSummary = sfBuildAssetSummaryString();

  const noteWithAsset = [
    assetSummary                ? `[ทรัพย์สิน: ${assetSummary}]`         : '',
    sfState.source              ? `[source: ${sfState.source}]`           : '',
  ].filter(Boolean).join(' ');

  // ── plansText — รองรับทั้งเลือกแผนเดียวและหลายแผน ────────────────────────
  let companyText  = sfState.company  || '-';
  let planText     = sfState.plan     || '-';
  let groupText    = sfState.group    || '-';
  let premiumText  = sfState.premium  || '-';

  // ถ้าไม่ได้เลือกแผนเฉพาะ แต่มี visiblePlans จาก user-script.js
  if ((!sfState.company || !sfState.plan) && sfState.visiblePlans?.length > 0) {
    companyText = sfState.visiblePlans
      .map(p => p.company)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .join(', ');

    groupText = sfState.visiblePlans
      .map(p => p.group)
      .filter((v, i, a) => v && v !== '-' && v !== '—' && a.indexOf(v) === i)
      .join(', ') || '-';

    planText = sfState.visiblePlans
      .map(p => p.plan)
      .join(', ');

    premiumText = sfState.visiblePlans
      .filter(p => p.premium > 0)
      .map(p => `${p.company}: ${Number(p.premium).toLocaleString('th-TH')}`)
      .join(', ') || '-';
  }

  // ── rowDataArray 16 คอลัมน์ ───────────────────────────────────────────────
  const rowDataArray = [
    new Date().toLocaleString('th-TH'),             // [0]  timestamp
    sfState.category ? sfState.category : (sfState.isNotFound ? 'Non-Package' : 'Package'), // [1] Category (Mark)
    bizText,                                         // [2]  ธุรกิจ
    companyText,                                     // [3]  บริษัทประกันภัย
    planText,                                        // [4]  แผนประกันภัย
    groupText,                                       // [5]  กลุ่มประกันภัย
    '-',                                             // [6]  ประเภทความคุ้มครอง (ลบการส่งออกค่านี้)
    sumDisplay,                                      // [7]  ทุนประกัน
    premiumText,                                     // [8]  เบี้ยประกัน
    fullName        || '-',                          // [9]  ชื่อลูกค้า
    sfState.phone   || '-',                          // [10] เบอร์โทร
    sfState.email   || '-',                          // [11] อีเมล
    sfState.time    || '-',                          // [12] ช่วงเวลาที่สะดวก
    sfState.address || '-',                          // [13] ที่อยู่
    noteWithAsset   || '-',                          // [14] หมายเหตุ + ทรัพย์สิน
    'รอติดต่อ',                                      // [15] สถานะ
  ];

  console.log('[TTIB Submit] Sending Row Data:', { timestamp: rowDataArray[0], category: rowDataArray[1], business: rowDataArray[2] });

  // ── formPayload สำหรับ sessionStorage ────────────────────────────────────
  const formPayload = {
    rowData: rowDataArray,
    structured: {
      photoData:     sfState.photoData, // [NEW] เพิ่ม photoData
      bizName:       bizText,
      covType:       sfState.covType,
      sumInsured:    sfState.sumInsured,
      firstName:     sfState.firstName,
      lastName:      sfState.lastName,
      phone:         sfState.phone,
      email:         sfState.email,
      time:          sfState.time,
      address:       sfState.address,
      addrNo:        sfState.addrNo,
      addrMoo:       sfState.addrMoo,
      addrRoad:      sfState.addrRoad,
      addrSub:       sfState.addrSub,
      addrDist:      sfState.addrDist,
      addrProv:      sfState.addrProv,
      addrZip:       sfState.addrZip,
      insuredStatus: sfState.insuredStatus,
      area:          sfState.area,
      stock:         sfState.stock,
      equipment:     sfState.equipment,
      renovation:    sfState.renovation,
      staff:         sfState.staff,
      claimVal:      sfState.claimVal,
      isNotFound:    sfState.isNotFound,
      totalAssetValue: sfState.totalAssetValue, // Add to payload
      bizCustom:     sfState.bizCustom,
      source:        sfState.source,
      // ── เพิ่ม: ข้อมูลแผนประกัน ──
      company:       companyText,
      plan:          planText,
      group:         groupText,
      premium:       premiumText,
      visiblePlans:  sfState.visiblePlans || [],
    },
    source:    sfState.source,
    timestamp: new Date().toISOString(),
  };

  // ── sessionStorage ────────────────────────────────────────────────────────
  try {
    sessionStorage.setItem('ttib_lead_form_data', JSON.stringify(formPayload));
  } catch (e) {
    console.warn('[TTIB Form] sessionStorage ไม่พร้อมใช้งาน:', e);
  }

  // ── ส่ง Google Apps Script (retry 2 ครั้ง) ───────────────────────────────
  sfShowStatus('⏳ กำลังส่งข้อมูล...', 'pending');

  const appsScriptUrl = (typeof FORM_APPS_SCRIPT_URL !== 'undefined')
    ? FORM_APPS_SCRIPT_URL
    : (typeof APPS_SCRIPT_URL !== 'undefined' ? APPS_SCRIPT_URL : null);

  let submitted = false;

    if (appsScriptUrl) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const ctrl = new AbortController();
          const tid  = setTimeout(() => ctrl.abort(), 12000);

          // [FIX] no-cors + text/plain — ไม่ trigger CORS preflight
          await fetch(appsScriptUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body:    JSON.stringify({ action: 'submitContact', rowData: rowDataArray, photoData: sfState.photoData }), // [NEW] ส่ง photoData
            mode:    'no-cors',
            signal:  ctrl.signal,
          });
          clearTimeout(tid);

          // [FIX] no-cors response เป็น opaque อ่านไม่ได้
          // Network ไม่ error = GAS รับ request แล้ว → ถือว่าสำเร็จ
          submitted = true;
          break;

        } catch (err) {
          clearTimeout && clearTimeout(); // cleanup ถ้า abort
          console.warn(`[TTIB Form] Attempt ${attempt} failed:`, err.message);
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
      }
    } else {
      submitted = true; // ไม่มี URL → ผ่าน sessionStorage อย่างเดียว
    }

  // ── แสดงผล + Redirect ────────────────────────────────────────────────────
  if (submitted) {
    sfShowSuccessScreen();

    // ฟังก์ชันพาผู้ใช้กลับหน้าหลักพร้อมพาไปดูตารางเปรียบเทียบ
    const redirectBack = () => sfReturnAndAction('compare');

    setTimeout(() => {
      if (!document.getElementById('sf-share-overlay')) redirectBack();
    }, 8000);

  } else {
    sfShowStatus('❌ ไม่สามารถส่งข้อมูลได้ กรุณาลองใหม่อีกครั้ง', 'error');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('sf-btn-loading');
      btn.innerHTML = '<i class="ti ti-send"></i> ส่งข้อมูลให้ฝ่ายขาย';
    }
  }
}

/**
 * sfShowStatus — แสดง status message (เหมือน updateStatus ใน user-script.js)
 */
function sfShowStatus(msg, type) {
  const el = document.getElementById('sf-status');
  if (!el) return;
  const styles = {
    pending: 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;',
    success: 'background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;',
    warn:    'background:#fef3c7;color:#92400e;border:1px solid #fcd34d;',
    error:   'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;',
  };
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:700;margin-top:12px;${styles[type] || styles.pending}`;
  el.textContent = msg;
}

/**
 * sfShowSuccessScreen — แสดงหน้า success แทน form panels
 */
function sfShowSuccessScreen() {
  document.getElementById('sf-main-form-flow').style.display = 'none'; // ซ่อนฟอร์มหลัก
  const loadingOverlay = document.getElementById('sf-submit-loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';

  const successEl = document.getElementById('sf-success-screen');
  if (successEl) {
    successEl.style.display = 'block';
    
    // [NEW] สร้างปุ่มต่างๆ แล้วใส่เข้าไปใน sf-success-actions
    const actionsContainer = successEl.querySelector('.sf-success-actions');
    if (actionsContainer) {
      actionsContainer.innerHTML = `
        <button class="sf-btn sf-btn-submit" onclick="sfReturnAndAction('compare')" style="width: 100%; max-width: 320px;">
          <i class="ti ti-table-column"></i> ดูตารางเปรียบเทียบแผน
        </button>
        <div style="display: flex; gap: 12px; margin-top: 5px;">
          <button class="sf-btn-share-outline" onclick="openShareInquiryModal()">
            <i class="ti ti-share-3"></i> แชร์ข้อมูลคำขอ
          </button>
          <button class="sf-btn-home" onclick="location.href='index.html?from_form=true'">
            <i class="ti ti-home-2"></i> กลับหน้าหลัก
          </button>
        </div>
      `;
    }
  }
}

// ฟังก์ชันสำหรับส่งสถานะกลับไปยังหน้าหลัก
function sfReturnAndAction(type) {
  if (type === 'compare') sessionStorage.setItem('pendingComparison', 'true');
  
  const redirectUrl = 'index.html?from_form=true';
  window.location.href = redirectUrl;
}
// =============================================================================
// 10. UTILITY — ตรงกับ escapeHtml / normalize ใน user-script.js
// =============================================================================

/**
 * escSf — escape HTML (เหมือน escapeHtml ใน user-script.js)
 */
function escSf(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * คัดลอกข้อความลง Clipboard พร้อมแจ้งเตือน
 */
function copyToClipboard(text, successMsg) {
  if (!navigator.clipboard) {
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

/**
 * เปิดหน้าต่างแชร์ข้อมูล (Share Modal) สำหรับ Lead ที่เพิ่งส่ง
 */
function openShareInquiryModal() {
  const data = sfState;
  // สร้างข้อมูลสำหรับแสดงผลใน user.html (Online Quote View)
  const quote = {
    customer: `${data.firstName} ${data.lastName}`.trim() || "-",
    phone: data.phone || "-",
    email: data.email || "-",
    business: data.bizName || data.bizCustom || (sfState.isNotFound ? "Non-Package" : "Package"),
    sumInsured: data.sumInsured ? Number(data.sumInsured).toLocaleString('th-TH') : "-",
    premium: "รอเจ้าหน้าที่ติดต่อกลับ",
    plan: "แผนประกันภัยที่เหมาะสมสำหรับธุรกิจ",
    company: "TTIB เลือกสรรให้คุณ",
    address: data.address || "-"
  };

  const baseUrl = window.location.origin + window.location.pathname.replace('user-form.html', 'index.html');
  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(quote))));
  const webLink = `${baseUrl}?quote=${encodedData}`;

  const msg = `ข้อมูลการขอรับคำปรึกษาประกันภัย TTIB\nเสนอแก่: คุณ${quote.customer}\nธุรกิจ: ${quote.business}\nทุนประกัน: ${quote.sumInsured} บาท\n\nดูรายละเอียดคำขอออนไลน์:\n${webLink}`;
  const encodedMsg = encodeURIComponent(msg);

  const overlay = document.createElement('div');
  overlay.id = 'sf-share-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="sf-card" style="max-width:450px; width:100%; border-radius:20px; overflow:hidden; padding:0; box-shadow:0 20px 50px rgba(0,0,0,0.3); border:none;">
      <div style="background:#fff; border-bottom:1px solid #f1f5f9; padding:16px 20px; display:flex; justify-content:space-between; align-items:center;">
        <h2 style="font-size:16px; font-weight:800; color:var(--brand); margin:0;"><i class="ti ti-share"></i> แชร์ข้อมูลคำขอของฉัน</h2>
        <span onclick="this.closest('#sf-share-overlay').remove()" style="cursor:pointer; font-size:24px; color:#94a3b8; line-height:1;">&times;</span>
      </div>
      <div style="padding:24px;">
        <div style="background:var(--bg); border-radius:12px; padding:15px; margin-bottom:20px; border:1px solid var(--border);">
          <div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">ข้อความที่แชร์</div>
          <div style="font-size:13px; color:var(--text); white-space:pre-wrap; line-height:1.6; max-height:100px; overflow-y:auto;">${escSf(msg)}</div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <a href="https://line.me/R/msg/text/?${encodedMsg}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#06C755; color:#fff; border-radius:12px;"><i class="ti ti-brand-line" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">LINE</span></a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(webLink)}" target="_blank" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#1877F2; color:#fff; border-radius:12px;"><i class="ti ti-brand-facebook" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Facebook</span></a>
          <a href="mailto:?subject=${encodeURIComponent('ข้อมูลขอรับคำปรึกษาประกันภัย - TTIB')}&body=${encodedMsg}" style="text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:16px 10px; background:#ef4444; color:#fff; border-radius:12px;"><i class="ti ti-mail" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">Email</span></a>
          <button onclick="copyToClipboard('${webLink}', 'คัดลอกลิงก์ข้อมูลสำเร็จ!')" style="border:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; background:var(--brand); color:#fff; border-radius:12px; font-family:inherit;"><i class="ti ti-link" style="font-size:24px;"></i> <span style="font-size:12px; font-weight:700;">คัดลอกลิงก์</span></button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });
}

window.copyToClipboard = copyToClipboard;
window.openShareInquiryModal = openShareInquiryModal;

// =============================================================================
// 11. CLICK OUTSIDE — ปิด dropdown (เหมือน document.addEventListener ใน user-script.js)
// =============================================================================

document.addEventListener('click', e => {
  const drop     = document.getElementById('sf-biz-suggestions-drop');
  const searchEl = document.getElementById('sf-biz-search');
  if (drop && searchEl && !drop.contains(e.target) && e.target !== searchEl) {
    sfHideSuggestions();
  }
});

// =============================================================================
// 12. INIT — ตรงกับ DOMContentLoaded ใน user-script.js
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => { // ทำให้ event listener เป็น async

  // 12.1 โหลดแผนที่ส่งมาจากหน้า Comparison ก่อน (Session Storage)
  sfLoadVisiblePlans();

  // 12.1.1 URL params + pre-fill (จะไม่ทับ visiblePlans ถ้า biz ตรงกัน)
  sfApplyUrlParams();

  // 12.1.2 Render แผนประกันที่เลือก
  sfRenderSelectedPlan();

  // 12.2 โหลดข้อมูลหลัก (Biz และ Address)
  const cachedList = sessionStorage.getItem('ttib_biz_list');
  const cachedAddr = sessionStorage.getItem('ttib_address_data');
  const cachedMaps = sessionStorage.getItem('ttib_biz_mappings');
  const cachedPrem = sessionStorage.getItem('ttib_premium_db');

  if (cachedList && cachedAddr) {
    try {
      sfBizList = JSON.parse(cachedList);
      sfAddressData = JSON.parse(cachedAddr);
      if (cachedMaps) sfBizMappings = JSON.parse(cachedMaps);
      if (cachedPrem) sfPremiumDatabase = JSON.parse(cachedPrem);
      
      // [FIX] Race condition: บังคับให้ Path ของ Cache เป็น Asynchronous 
      // เพื่อให้ลำดับการ Render UI เป็นไปตามลำดับขั้นตอนที่ถูกต้อง
      await Promise.resolve();

      console.log(`[TTIB Form] โหลดข้อมูลจาก cache สำเร็จ (${sfBizList.length} biz)`);
      sfInitAddress();

      // กรณีมีชื่อธุรกิจจาก URL ให้ทำการ Seek Category ทันทีที่โหลด Mapping เสร็จ
      if (sfState.bizName) sfSelectBiz(sfState.bizName);

    } catch (e) {
      console.warn('[TTIB Form] Error parsing cached data, falling back to sheet:', e);
      await sfLoadDataFromSheet();
    }
  } else {
    // หากไม่มีข้อมูลใน cache เลย (เปิดฟอร์มครั้งแรกแบบ direct) ให้ดึงจาก Sheet ทันที
    await sfLoadDataFromSheet(); // รอให้การโหลดข้อมูลจาก Sheet เสร็จสิ้น
  }

  // 12.4 แสดงผลข้อมูลแผนประกันที่เลือก
  sfRenderSelectedPlan();

  // 12.5 ป้องกัน double submit เมื่อกด Back หลัง redirect (เหมือน user-script.js)
  sfCalculateTotalAssetValue(); // Initial calculation on load
  if (performance?.navigation?.type === 2) {
    const successEl = document.getElementById('sf-success-screen');
    if (successEl) successEl.style.display = 'none';
  }

  console.log('[TTIB Form] Standalone form initialized');
  console.log('[TTIB Form] Source:',   sfState.source   || '(ไม่ระบุ)');
});

// [NEW] เพิ่มฟังก์ชันจัดการการอัปโหลดรูปภาพทั้งหมด
document.addEventListener('DOMContentLoaded', () => {
  const uploadArea = document.getElementById('sf-photo-upload-area');
  const fileInput = document.getElementById('sf-photo-input');
  const promptEl = document.getElementById('sf-photo-prompt');
  const previewWrapper = document.getElementById('sf-photo-preview-wrapper');
  const previewImg = document.getElementById('sf-photo-preview');
  const clearBtn = document.getElementById('sf-photo-clear-btn');

  if (!uploadArea || !fileInput || !promptEl || !previewWrapper || !previewImg || !clearBtn) return;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      sfShowError('err-photo', true, 'กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      sfShowError('err-photo', true, 'ขนาดรูปภาพต้องไม่เกิน 5MB');
      return;
    }

    sfShowError('err-photo', false);
    const reader = new FileReader();
    reader.onload = (e) => {
      sfState.photoData = e.target.result;
      previewImg.src = e.target.result;
      promptEl.style.display = 'none';
      previewWrapper.style.display = 'block';
    };
    reader.readAsDataURL(file);
  };

  const clearFile = () => {
    sfState.photoData = null;
    fileInput.value = ''; // Clear the file input
    promptEl.style.display = 'block';
    previewWrapper.style.display = 'none';
    previewImg.src = '';
    sfShowError('err-photo', false);
  };

  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering the upload area click
    clearFile();
  });

  // Drag and Drop events
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragover'), false);
  });

  uploadArea.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]), false);
});

// =============================================================================
// 13. PUBLIC API — ตรงกับ sfGetFormData / sfLoadFromSessionStorage ใน user-script.js
//     handleFormReturn() ใน user-script.js อ่านจาก key 'ttib_lead_form_data'
// =============================================================================

/** sfGetFormData — ดึง state ปัจจุบัน (ใช้โดย index.html หากต้องการ) */
function sfGetFormData() { return { ...sfState }; }

/**
 * sfLoadFromSessionStorage — อ่าน formPayload ที่บันทึกไว้
 * handleFormReturn() ใน user-script.js ใช้ key เดียวกัน: 'ttib_lead_form_data'
 */
function sfLoadFromSessionStorage() {
  try {
    const raw = sessionStorage.getItem('ttib_lead_form_data');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[TTIB] ไม่สามารถโหลดข้อมูลจาก sessionStorage:', e);
    return null;
  }
}

window.sfGetFormData             = sfGetFormData;
window.sfLoadFromSessionStorage  = sfLoadFromSessionStorage;

/** sfValidateAll — Alias สำหรับเรียกตรวจสอบทั้งฟอร์ม */
function sfValidateAll() {
  return sfValidateStep();
}
window.sfValidateAll = sfValidateAll;

/**
 * sfClearCard — ฟังก์ชันล้างข้อมูลแบบระบุขอบเขต (เฉพาะใน Card ของตัวเอง)
 */
function sfClearCard(btn) {
  // Trigger Shake Effect
  if (btn) {
    btn.classList.remove('sf-shake');
    void btn.offsetWidth; // Force Reflow
    btn.classList.add('sf-shake');
    setTimeout(() => btn.classList.remove('sf-shake'), 400);
  }

  // ค้นหาพาเนลที่ปุ่มนี้สังกัดอยู่
  const card = btn.closest('.sf-card');
  if (!card) return;

  // 1. ล้าง Input ทั้งหมด (Text, Number, Tel, Email, Hidden)
  const inputs = card.querySelectorAll('input');
  inputs.forEach(inp => {
    inp.value = '';
    inp.classList.remove('error');
    // รีเซ็ต Radio Chips ถ้ามี
    if (inp.type === 'hidden') {
      const groupId = inp.id.replace('sf-', '') + '-group';
      const chips = card.querySelectorAll('.sf-radio-chip');
      chips.forEach(c => c.classList.remove('selected'));
    }
  });

  // 2. ล้าง Select ทั้งหมด
  const selects = card.querySelectorAll('select');
  selects.forEach(sel => {
    sel.selectedIndex = 0;
    sel.classList.remove('error');
  });

  // 3. ซ่อนข้อความแจ้งเตือน Error ทั้งหมดในกล่องนี้
  const errors = card.querySelectorAll('.sf-inp-error-msg');
  errors.forEach(err => err.classList.remove('show'));

  // 4. กรณีพิเศษ: หากเป็นกล่องธุรกิจ ให้เรียกใช้ฟังก์ชันจัดการ UI เฉพาะทาง
  if (card.querySelector('#sf-biz-search')) sfClearBiz();
  
  // 5. กรณีพิเศษ: หากเป็นกล่องทรัพย์สิน ให้คำนวณยอดรวมใหม่
  if (card.querySelector('#sf-total-asset-value')) sfCalculateTotalAssetValue();
  
  // 6. กรณีพิเศษ: รีเซ็ต Claim Toggle
  if (card.querySelector('#sf-claim-val')) sfToggleClaim('N');
}

/**
 * sfVerifySubmitConnection — ฟังก์ชันตรวจสอบการเชื่อมต่อของปุ่มส่งข้อมูล
 * ใช้ตรวจสอบว่าปุ่มใน HTML และฟังก์ชันใน JS ทำงานร่วมกันได้หรือไม่
 */
function sfVerifySubmitConnection() {
  const btn = document.getElementById('sf-submit-btn');
  const hasFunction = typeof window.sfSubmit === 'function';
  const hasOnclick = btn?.getAttribute('onclick') === 'sfSubmit()';

  if (btn && hasFunction && hasOnclick) {
    alert('✅ การตรวจสอบสำเร็จ: ปุ่ม "ส่งข้อมูลให้ฝ่ายขาย" เชื่อมต่อกับฟังก์ชัน sfSubmit() เรียบร้อยแล้ว และพร้อมทำงานครับ');
  } else {
    let errorMsg = '❌ พบปัญหาในการทำงานของปุ่ม:\n';
    if (!btn) errorMsg += '- ไม่พบ Element ID "sf-submit-btn" ในหน้า HTML\n';
    if (!hasFunction) errorMsg += '- ไม่พบฟังก์ชัน "sfSubmit" ในไฟล์ JavaScript\n';
    if (btn && !hasOnclick) errorMsg += '- คุณสมบัติ onclick ใน HTML ไม่ตรงกับ "sfSubmit()"\n';
    alert(errorMsg);
  }
}
window.sfVerifySubmitConnection = sfVerifySubmitConnection;