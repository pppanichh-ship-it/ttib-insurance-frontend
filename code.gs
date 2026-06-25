/**
 * ============================================================================
 * APPS SCRIPT — Code.gs  v5.2
 * Insurance Compare Pro — TTIB Broker
 *
 * [FIXES v5.2 — ใหม่]
 *   FIX-5  STATUS_ARCHIVE_MAP ไม่มี "ไม่สนใจ" → SHEET_NAME.NOT_INT
 *          เดิมมีแค่ "ยกเลิก" กับ "ปิดการขาย" 2 สถานะ ทำให้เวลา admin
 *          เปลี่ยนสถานะเป็น "ไม่สนใจ" แถวไม่ถูก archive ไปชีต "ไม่สนใจ"
 *          เลย (ค้างอยู่ในชีต "ติดต่อฝ่ายขาย" ตลอด) ทั้งที่ fixArchiveSheetHeaders()
 *          เตรียม header ของชีตนี้รอไว้แล้ว
 *
 *   FIX-6  appendPremiumRow() ไม่เคยใช้พารามิเตอร์ group ตอนค้นหาคอลัมน์ปลายทาง
 *          ใน PREMIUM sheet (เทียบ company+plan เท่านั้น) ถ้าบริษัท/แผนเดียวกัน
 *          มีหลายกลุ่ม (group) จะจับคอลัมน์แรกที่ตรงแล้วเขียนเบี้ยทับผิดกลุ่มได้
 *          → เพิ่มการเทียบ groupRow (row 3) เข้าไปในเงื่อนไขด้วย ให้ตรงกับ
 *          key รูปแบบ company|plan|group ที่ user-form.js ใช้จริง
 *
 *   FIX-7  handleEditLead() มี key "time" ซ้ำกัน 2 ครั้งใน fieldMap
 *          (ไม่กระทบผลลัพธ์ เพราะ JS object literal ใช้ค่าหลังสุด แต่รก) → ลบซ้ำ
 *
 * [FIXES v5.1 — ของเดิม]
 *   FIX-1  rowIndex offset: _rowToLead ใน admin-script.js ส่ง i+1 แต่ต้องการ
 *          sheet row จริง = i+2 (header=row1, data=row2+)
 *          → handleGetLeads ส่งกลับ rowIdx = i + 2 แทน i + 1
 *          → _parseLeadsFromWorkbook ส่ง rowIdx = i + 2 แทน i + 1
 *
 *   FIX-2  archiveRow — flush ก่อน deleteRow เพื่อป้องกัน index เลื่อน
 *
 *   FIX-3  handleUpdateStatus — รองรับ payload.status AND payload.newStatus
 *          (มีอยู่แล้วใน v5.0 แต่เพิ่ม log ให้ชัด)
 *
 *   FIX-4  handleSubmitContact — รองรับ rowData ที่ส่งมาจาก user-form.js
 *          (sfSubmit ส่ง 16 columns: index 0-15 ตรงกับ SALES_HEADERS)
 *          row[15] = "รอติดต่อ" มาจาก sfSubmit เองแล้ว ไม่ต้องเติมใหม่
 *
 *   NOTE   user-form.js sfSubmit ใช้ mode:'cors' → ต้องแก้เป็น 'no-cors'
 *          (แก้ใน user-form.js ไม่ใช่ Apps Script — ไฟล์นี้แก้ฝั่ง server
 *          ไม่ได้ ปัญหา CORS ของ Apps Script Web App ต้องแก้ที่ fetch() call
 *          ฝั่ง client เท่านั้น)
 *          → ดูคอมเมนต์ // [JS-FIX] ในไฟล์ user-form.js
 *
 * actions ที่รองรับ:
 *   submitContact  — บันทึกลูกค้าใหม่
 *   addPackage     — เพิ่มแผนประกัน (BIZ + COVERAGE + MARK + DETAIL)
 *   updateStatus   — เปลี่ยนสถานะ (ใช้ rowIndex โดยตรง)
 *   updateNote     — บันทึก staffNote (ใช้ rowIndex โดยตรง)
 *   updateRenewal  — อัปเดตวันต่ออายุ (ใช้ rowIndex โดยตรง)
 *   deleteLead     — ลบแถว (ใช้ rowIndex โดยตรง)
 *   editLead       — แก้ไขข้อมูลลูกค้า (ใช้ rowIndex โดยตรง)
 *   logInterest    — บันทึก log เมื่อลูกค้าสนใจใบเสนอราคาออนไลน์
 *   getLeads       — ดึงข้อมูล Leads ทั้งหมด (GET)
 *
 * Header ชีต "ติดต่อฝ่ายขาย" (A–T):
 *   A วันที่-เวลา       B ประเภท          C ธุรกิจ
 *   D บริษัทประกัน      E แผนประกัน        F กลุ่ม
 *   G ประเภทคุ้มครอง    H ทุนประกัน        I เบี้ยประกัน
 *   J ชื่อลูกค้า        K โทรศัพท์         L อีเมล
 *   M เวลาที่สะดวก      N ที่อยู่            O หมายเหตุ
 *   P สถานะ            Q โน้ตเจ้าหน้าที่   R เลขกรมธรรม์
 *   S วันคุ้มครอง       T วันต่ออายุ
 * ============================================================================
 */

// ── Configuration ─────────────────────────────────────────────────────────────

var SHEET_ID          = "1aeCf4-Kl3LxMKTuQGMHHKfKtJi4MBln3wCuvhEvgSsk"; // [NOTE] ตรวจสอบว่า ID นี้ถูกต้อง
var DRIVE_FOLDER_NAME = "Insurance_CustomerPhotos";

var SHEET_NAME = {
  SALES:        "ติดต่อฝ่ายขาย",
  BIZ:          "ข้อมูลดึงออกมาใช้",
  PREMIUM:      "เบี้ยประกันทั้งหมด",
  MARK:         "หัวข้อคุ้มครอง (เครื่องหมาย)",
  DETAIL:       "หัวข้อคุ้มครอง (รายละเอียด)",
  HISTORY:      "ประวัติการทำงาน",
  NOT_INT:      "ไม่สนใจ",
  CANCEL:       "ยกเลิก",
  PENDING_PREM: "PendingPremiums",
  INTEREST_LOG: "InterestLog",
  FAVORITES_LOG:"FavoritesLog",
  CHATBOT_LOG: "ChatbotLog" // [NEW] ชีทสำหรับเก็บประวัติการแชท (ถ้าต้องการ)
};

// [FIX-5] เพิ่ม "ไม่สนใจ" → NOT_INT ที่ขาดไป (ของเดิมมีแค่ 2 รายการ)
var STATUS_ARCHIVE_MAP = {
  "ยกเลิก":    SHEET_NAME.CANCEL,
  "ปิดการขาย": SHEET_NAME.HISTORY,
  "ไม่สนใจ":   SHEET_NAME.NOT_INT,
};

var SALES_HEADERS = [
  "วันที่-เวลา",         // A [0]  col 1
  "ประเภท",              // B [1]  col 2
  "ธุรกิจ",              // C [2]  col 3
  "บริษัทประกัน",        // D [3]  col 4
  "แผนประกัน",           // E [4]  col 5
  "กลุ่ม",               // F [5]  col 6
  "ประเภทความคุ้มครอง",  // G [6]  col 7
  "ทุนประกัน",           // H [7]  col 8
  "เบี้ยประกัน",         // I [8]  col 9
  "ชื่อลูกค้า",          // J [9]  col 10
  "โทรศัพท์",            // K [10] col 11
  "อีเมล",               // L [11] col 12
  "เวลาที่สะดวก",        // M [12] col 13
  "ที่อยู่",              // N [13] col 14
  "หมายเหตุ",            // O [14] col 15
  "สถานะ",               // P [15] col 16
  "โน้ตเจ้าหน้าที่",     // Q [16] col 17
  "เลขกรมธรรม์",         // R [17] col 18
  "วันคุ้มครอง",          // S [18] col 19
  "วันต่ออายุ",           // T [19] col 20
];

var FAVORITES_LOG_HEADERS = [
  "Timestamp",
  "UserID",
  "Business",
  "Company",
  "Plan",
  "Group"
];

// Column index (1-based) สำหรับ sheet.getRange()
var COL = {
  TIMESTAMP:    1,
  TYPE:         2,
  BUSINESS:     3,
  COMPANY:      4,
  PLAN:         5,
  GROUP:        6,
  COV_TYPE:     7,
  SUM:          8,
  PREMIUM:      9,
  NAME:         10,
  PHONE:        11,
  EMAIL:        12,
  TIME:         13,
  ADDRESS:      14,
  NOTE:         15,
  STATUS:       16,
  STAFF_NOTE:   17,
  POLICY_NO:    18,
  POLICY_DATE:  19,
  RENEWAL_DATE: 20,
  TOTAL:        SALES_HEADERS.length, // 20 columns total
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
  * Handles POST requests to the web app.
  * This is the main entry point for actions like submitting forms or calling the AI.
  */
 function doPost(e) {
   // [CORS FIX] Handle OPTIONS preflight requests inline (Apps Script doesn't route to doOptions)
   if (e.parameter && e.parameter.action === "OPTIONS" || (e.postData && e.postData.contents === "{}")) {
     return ContentService.createTextOutput()
       .addHeader('Access-Control-Allow-Origin', '*')
       .addHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
       .addHeader('Access-Control-Allow-Headers', 'Content-Type');
   }
   try {
     var raw     = (e.postData && e.postData.contents) ? e.postData.contents : "{}";
     var payload = JSON.parse(raw);
     var action  = String(payload.action || (e.parameter && e.parameter.action) || "").trim();

    var result;
    switch (action) {
      case "submitContact":  result = handleSubmitContact(payload);  break;
      case "addPackage":     result = handleAddPackage(payload);     break;
      case "updateStatus":   result = handleUpdateStatus(payload);   break;
      case "updateNote":     result = handleUpdateNote(payload);     break;
      case "updateRenewal":  result = handleUpdateRenewal(payload);  break;
      case "deleteLead":     result = handleDeleteLead(payload);     break;
      case "editLead":       result = handleEditLead(payload);       break;
      case "logInterest":    result = handleLogInterest(payload);    break;
      case "callGemini":     result = callGeminiAPI(payload.userMessage, payload.knowledgeBase); break;
      case "logFavorite":    result = handleLogFavorite(payload);    break;
      case "clearUserFavorites": result = handleClearUserFavorites(payload); break;
      default:
        result = { status: "error", message: "unknown action: " + action };
    }
    return buildResponse(result);

  } catch (err) {
    Logger.log("doPost error: " + err.message + "\n" + err.stack);
    return buildResponse({ status: "error", message: err.message });
  }
}

function doGet(e) {
  var action = (e.parameter && e.parameter.action) || "";

  if (action === "getLeads") return handleGetLeads();
  
  // [NEW] รองรับ callGemini ผ่าน GET เพื่อหลีกเลี่ยง CORS preflight
  if (action === "callGemini") {
    var msg = e.parameter.msg || "";
    var kb  = e.parameter.kb  || "";
    return buildResponse(callGeminiAPI(msg, kb));
  }
  return buildResponse({
    status:    "ok",
    service:   "Insurance Compare Pro — Apps Script",
    version:   "5.2",
    actions:   [
      "submitContact", "addPackage", "updateStatus", "updateNote",
      "updateRenewal", "deleteLead", "editLead", "logInterest", "getLeads", "clearUserFavorites", "callGemini",
      "logFavorite"
      
    ],
    timestamp: new Date().toISOString()
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: getLeads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [NEW] รับคำถามจาก Frontend, เรียก Gemini API, และส่งคำตอบกลับไป
 */
function callGeminiAPI(userMessage, knowledgeBase) {
  // 1. ดึง API Key จาก Script Properties ที่เก็บไว้อย่างปลอดภัย
  //    (ตั้งค่าได้ที่ Project Settings > Script Properties)
  var API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) {
    Logger.log("Gemini API Key not found in Script Properties.");
    return { error: "GEMINI_API_KEY not set in Script Properties." };
  }

  var API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + API_KEY;

  // 2. สร้าง Prompt ที่จะส่งให้ AI
  var promptText = "คุณคือ 'TTIB AI Assistant' ผู้เชี่ยวชาญด้านประกันภัยของบริษัท TTIB Insurance Broker หน้าที่ของคุณคือตอบคำถามเกี่ยวกับประกันภัยสำหรับธุรกิจ SME เท่านั้น โดยใช้ข้อมูลจาก 'ข้อมูลความรู้พื้นฐาน' ที่ให้มานี้เป็นหลักในการตอบ: \n\n" + knowledgeBase + "\n\n--- คำถามจากลูกค้า ---\nคำถาม: \"" + userMessage + "\"\n\n--- คำตอบของคุณ ---\nตอบด้วยภาษาไทยที่สุภาพ เข้าใจง่าย และเป็นมิตร หากคำถามไม่เกี่ยวกับประกันภัย หรือไม่สามารถหาคำตอบจากข้อมูลที่มีได้ ให้ตอบว่า \"ขออภัยครับ ผมสามารถให้ข้อมูลได้เฉพาะเรื่องประกันภัยเท่านั้น หากต้องการรายละเอียดเพิ่มเติม สามารถติดต่อเจ้าหน้าที่ได้โดยตรงครับ\"";

  var requestBody = {
    "contents": [{ "parts": [{ "text": promptText }] }]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(API_URL, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    if (responseCode === 200) {
      var data = JSON.parse(responseBody);
      return { text: data.candidates[0].content.parts[0].text };
    }
    return { error: "Gemini API Error: " + responseCode, details: responseBody };
  } catch (e) {
    return { error: e.message };
  }
}
// [FIX-1] rowIdx = i + 2 (header=row1, แถวข้อมูลแรก=row2, i เริ่มจาก 0)
// ─────────────────────────────────────────────────────────────────────────────

function handleGetLeads() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet || sheet.getLastRow() < 2) {
    return buildResponse({ status: "ok", data: [] });
  }

  var lastRow = sheet.getLastRow();
  var data    = sheet.getRange(2, 1, lastRow - 1, COL.TOTAL).getValues();

  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[COL.NAME - 1] && !r[COL.PHONE - 1]) continue; // ข้ามแถวที่ไม่มีชื่อและเบอร์
    rows.push({
      // [FIX-1] i=0 คือแถว 2 ใน sheet (header=row1) ดังนั้น rowIdx = i + 2
      // ใช้ for-loop แทน filter().map() เพื่อให้ rowIdx ตรงกับเลขแถวจริงในชีตเสมอ
      // (filter().map() เดิม將會ทำให้ index เลื่อนหากมีแถวว่างระลึกในกลางสedsheet)
      rowIdx:      i + 2,
      timestamp:   String(r[COL.TIMESTAMP - 1]  || ""),
      category:    String(r[COL.TYPE - 1]        || ""),
      business:    String(r[COL.BUSINESS - 1]    || ""),
      company:     String(r[COL.COMPANY - 1]     || ""),
      plan:        String(r[COL.PLAN - 1]         || ""),
      group:       String(r[COL.GROUP - 1]        || ""),
      covType:     String(r[COL.COV_TYPE - 1]    || ""),
      sum:         String(r[COL.SUM - 1]          || ""),
      premium:     String(r[COL.PREMIUM - 1]     || ""),
      name:        String(r[COL.NAME - 1]         || ""),
      phone:       String(r[COL.PHONE - 1]        || ""),
      email:       String(r[COL.EMAIL - 1]       || ""),
      time:        String(r[COL.TIME - 1]         || ""),
      address:     String(r[COL.ADDRESS - 1]     || ""),
      note:        String(r[COL.NOTE - 1]         || ""),
      status:      String(r[COL.STATUS - 1]      || "รอติดต่อ"),
      staffNote:   String(r[COL.STAFF_NOTE - 1]  || ""),
      policyNo:    String(r[COL.POLICY_NO - 1]   || ""),
      policyDate:  String(r[COL.POLICY_DATE - 1] || ""),
      renewalDate: String(r[COL.RENEWAL_DATE - 1]|| ""),
    });
  }

  return buildResponse({ status: "ok", data: rows });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 1: submitContact
// [FIX-4] user-form.js (sfSubmit) ส่ง rowData[0..15] ครบ 16 columns
//         index 15 = "รอติดต่อ" ส่งมาแล้ว ไม่ต้อง override ซ้ำ
//         แต่ยังคง fallback ไว้สำหรับกรณีที่ไม่ได้ส่ง status มา
// ─────────────────────────────────────────────────────────────────────────────

function handleSubmitContact(payload) {
  var row   = payload.rowData || [];
  var name  = String(row[COL.NAME  - 1] || "").trim();
  var phone = String(row[COL.PHONE - 1] || "").trim();

  if (!name && !phone) {
    return { status: "error", message: "ชื่อลูกค้าหรือเบอร์โทรจำเป็น" };
  }

// [FIX-TS] สร้าง timestamp ตรงกันเสมอ (Apps Script generate) เพื่อป้องกัน format ไม่สอดคล้อง
   var tsCol = COL.TIMESTAMP - 1;
   var existingTs = String(row[tsCol] || "").trim();
   var isISOTimestamp = /^\d{4}-\d{2}-\d{2}T/.test(existingTs);
   if (!existingTs || isISOTimestamp) {
     row[tsCol] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/M/yyyy HH:mm:ss");
   }

  // [FIX-4] ตั้งสถานะเริ่มต้นเฉพาะเมื่อไม่มีค่าส่งมา (user-form.js ส่ง "รอติดต่อ" อยู่แล้ว)
  if (!row[COL.STATUS - 1] || String(row[COL.STATUS - 1]).trim() === "") {
    row[COL.STATUS - 1] = "รอติดต่อ";
  }

  // [NEW] อัปโหลดรูปภาพ (ถ้ามี)
  var photoUrl = "";
  if (payload.photoData && String(payload.photoData).startsWith("data:")) {
    try {
      photoUrl = uploadBase64Photo(payload.photoData, name, phone);
    } catch (photoErr) {
      Logger.log("Photo upload failed: " + photoErr.message);
    }
  }

  // เตรียม fullRow ให้ครบ COL.TOTAL columns
  var fullRow = new Array(COL.TOTAL).fill("");
  for (var i = 0; i < Math.min(row.length, COL.TOTAL); i++) {
    fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : "";
  }

  // [NEW] เพิ่ม URL ของรูปภาพลงในคอลัมน์ "โน้ตเจ้าหน้าที่" (Staff Note) ซึ่งอยู่ถัดจาก "สถานะ"
  if (photoUrl) {
    // หากมีโน้ตเดิมอยู่แล้ว ให้ขึ้นบรรทัดใหม่
    var existingNote = fullRow[COL.STAFF_NOTE - 1] || "";
    fullRow[COL.STAFF_NOTE - 1] = existingNote ? (existingNote + "\n" + photoUrl) : photoUrl;
  }

  var sheet = getOrCreateSheet(SHEET_NAME.SALES, SALES_HEADERS);
  sheet.appendRow(fullRow);

  var lastRow = sheet.getLastRow();
  _formatDataRow(sheet, lastRow);
  SpreadsheetApp.flush();

  Logger.log("submitContact: " + name + " / " + phone + " row=" + lastRow);
  
  // [CONSISTENCY-1] ส่งข้อมูลแถวใหม่กลับไปทั้งหมด เพื่อให้ client update state ได้ทันที
  var newLeadData = _rowValuesToLeadObject(fullRow, lastRow);

  return {
    status:   "ok",
    action:   "submitContact",
    customer: name,
    phone:    phone,
    rowIndex: lastRow,   // ส่งกลับ rowIndex จริงเพื่อให้ client ใช้ได้ทันที
    // ส่งข้อมูล lead ใหม่กลับไปให้ client อัปเดต state ได้เลย ไม่ต้อง fetch ใหม่
    // This makes the UI feel much faster.
    newLead: newLeadData,
    photoUrl: photoUrl
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 2: addPackage
// ─────────────────────────────────────────────────────────────────────────────

function handleAddPackage(payload) {
  var companies = [];
  if (Array.isArray(payload.companies)) {
    companies = payload.companies;
  } else if (payload.company) {
    companies = String(payload.company).split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  }

  if (!companies.length) {
    return { status: "error", message: "ต้องระบุบริษัทประกันอย่างน้อย 1 บริษัท" };
  }
  if (!payload.plan) {
    return { status: "error", message: "ต้องระบุชื่อแผนประกัน" };
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. BIZ sheet
  var bizHeaders = ["ประเภท", "ธุรกิจ", "บริษัทประกัน", "แผนประกัน", "กลุ่ม", "ประเภทความคุ้มครอง"];
  var bizSheet   = getOrCreateSheet(SHEET_NAME.BIZ, bizHeaders);

  companies.forEach(function(comp) {
    bizSheet.appendRow([
      payload.category || "",
      payload.business || "",
      comp,
      payload.plan     || "",
      payload.group    || "",
      payload.covType  || "",
    ]);
  });

  // 2. PendingPremiums sheet
  var pendingHeaders = [
    "วันที่บันทึก", "ประเภท", "ธุรกิจ", "บริษัทประกัน", "แผนประกัน",
    "กลุ่ม", "ประเภทความคุ้มครอง", "ทุนประกัน", "เบี้ยประกัน",
    "ความคุ้มครอง (JSON)", "markValues (JSON)", "รายละเอียด (JSON)",
  ];
  var pendingSheet = getOrCreateSheet(SHEET_NAME.PENDING_PREM, pendingHeaders);
  pendingSheet.appendRow([
    new Date().toLocaleString("th-TH"),
    payload.category       || "",
    payload.business       || "",
    companies.join(", "),
    payload.plan           || "",
    payload.group          || "",
    payload.covType        || "",
    payload.sumInsured     || 0,
    payload.premium        || 0,
    JSON.stringify(payload.coverageValues || {}),
    JSON.stringify(payload.markValues     || {}),
    JSON.stringify(payload.detailValues   || {}),
  ]);

  // 3. MARK sheet
  if (payload.markValues && Object.keys(payload.markValues).length > 0) {
    companies.forEach(function(comp) {
      appendMarkColumn(ss, comp, payload.plan, payload.group, payload.markValues);
    });
  }

  // 4. DETAIL sheet
  if (payload.detailValues && Object.keys(payload.detailValues).length > 0) {
    companies.forEach(function(comp) {
      appendDetailColumn(ss, comp, payload.plan, payload.group, payload.detailValues);
    });
  }

  // 5. PREMIUM sheet
  if (payload.sumInsured && payload.premium) {
    companies.forEach(function(comp) {
      appendPremiumRow(ss, comp, payload.plan, payload.group, payload.sumInsured, payload.premium);
    });
  }

  SpreadsheetApp.flush();
  Logger.log("addPackage: " + companies.join(", ") + " / " + payload.plan);
  return {
    status:    "ok",
    action:    "addPackage",
    plan:      payload.plan,
    companies: companies
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 3: updateStatus
// ─────────────────────────────────────────────────────────────────────────────

function handleUpdateStatus(payload) {
  var newStatus = String(payload.status || payload.newStatus || "").trim();
  var rowIndex  = parseInt(payload.rowIndex, 10);

  if (!newStatus) return { status: "error", message: "status จำเป็น" };
  if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) {
    return { status: "error", message: "rowIndex ไม่ถูกต้อง (ต้องเป็น integer >= 2) ได้รับ: " + payload.rowIndex };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet) return { status: "error", message: "ไม่พบชีต: " + SHEET_NAME.SALES };
  if (rowIndex > sheet.getLastRow()) {
    return { status: "error", message: "rowIndex=" + rowIndex + " เกินจำนวนแถวทั้งหมด " + sheet.getLastRow() };
  }

  sheet.getRange(rowIndex, COL.STATUS).setValue(newStatus);

  if (payload.policyNo)    sheet.getRange(rowIndex, COL.POLICY_NO).setValue(payload.policyNo);
  if (payload.policyDate)  sheet.getRange(rowIndex, COL.POLICY_DATE).setValue(payload.policyDate);
  if (payload.renewalDate) sheet.getRange(rowIndex, COL.RENEWAL_DATE).setValue(payload.renewalDate);

  SpreadsheetApp.flush();

  // [CRITICAL FIX] Do not archive/delete the row anymore.
  // The row must remain in the SALES sheet to ensure data consistency for the admin panel,
  // which reads exclusively from this sheet. All filtering is now handled on the client-side.

  Logger.log("updateStatus: row " + rowIndex + " → " + newStatus);
  return { status: "ok", action: "updateStatus", newStatus: newStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 4: updateNote
// ─────────────────────────────────────────────────────────────────────────────

function handleUpdateNote(payload) {
  var staffNote = String(payload.staffNote || payload.note || "").trim();
  var rowIndex  = parseInt(payload.rowIndex, 10);

  if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) {
    return { status: "error", message: "rowIndex ไม่ถูกต้อง ได้รับ: " + payload.rowIndex };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet) return { status: "error", message: "ไม่พบชีต: " + SHEET_NAME.SALES };

  sheet.getRange(rowIndex, COL.STAFF_NOTE).setValue(staffNote);
  SpreadsheetApp.flush();

  Logger.log("updateNote: row " + rowIndex);
  return { status: "ok", action: "updateNote", rowIndex: rowIndex };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 5: updateRenewal
// ─────────────────────────────────────────────────────────────────────────────

function handleUpdateRenewal(payload) {
  var renewalDate = String(payload.renewalDate || "").trim();
  var rowIndex    = parseInt(payload.rowIndex, 10);

  if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) {
    return { status: "error", message: "rowIndex ไม่ถูกต้อง ได้รับ: " + payload.rowIndex };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet) return { status: "error", message: "ไม่พบชีต: " + SHEET_NAME.SALES };

  sheet.getRange(rowIndex, COL.RENEWAL_DATE).setValue(renewalDate);
  SpreadsheetApp.flush();

  Logger.log("updateRenewal: row " + rowIndex + " → " + renewalDate);
  return { status: "ok", action: "updateRenewal", rowIndex: rowIndex, renewalDate: renewalDate };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 6: deleteLead
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 6: deleteLead
// [FIX-FUTURE-PROOF] รองรับ rowIndex เป็น array ด้วย เพื่อให้ bulk-delete (ถ้ามีในอนาคต)
//                     ปลอดภัยจาก row-shift — ลบจากแถวมากไปน้อยเสมอ
// ─────────────────────────────────────────────────────────────────────────────

function handleDeleteLead(payload) {
  var rowIndexes = Array.isArray(payload.rowIndexes)
    ? payload.rowIndexes.map(function(n) { return parseInt(n, 10); })
    : [parseInt(payload.rowIndex, 10)];

  rowIndexes = rowIndexes.filter(function(n) { return n && !isNaN(n) && n >= 2; });
  if (!rowIndexes.length) {
    return { status: "error", message: "rowIndex ไม่ถูกต้อง ได้รับ: " + payload.rowIndex };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet) return { status: "error", message: "ไม่พบชีต: " + SHEET_NAME.SALES };

  // [FIX-FUTURE-PROOF] เรียงจากแถวมากไปน้อย เพื่อให้ deleteRow แต่ละครั้ง
  // ไม่กระทบ rowIndex ของแถวอื่นที่ยังรอประมวลผลอยู่ใน batch เดียวกัน
  rowIndexes.sort(function(a, b) { return b - a; });

  var deletedNames = [];
  rowIndexes.forEach(function(rowIndex) {
    if (rowIndex > sheet.getLastRow()) return; // ข้ามถ้าเกินจำนวนแถวปัจจุบันแล้ว
    var nameCell = sheet.getRange(rowIndex, COL.NAME).getValue(); // อ่านชื่อก่อนลบ
    sheet.deleteRow(rowIndex);
    deletedNames.push(String(nameCell));
  });

  SpreadsheetApp.flush(); // [PERF-3] ย้าย flush() มาเรียกครั้งเดียวนอก loop
  Logger.log("deleteLead: rows " + rowIndexes.join(",") + " (" + deletedNames.join(", ") + ")");
  return { status: "ok", action: "deleteLead", rowIndexes: rowIndexes, deleted: deletedNames };
}
// ─────────────────────────────────────────────────────────────────────────────
// ACTION 7: editLead
// [FIX-7] fieldMap เดิมมี key "time" ซ้ำกัน 2 ครั้ง (ไม่กระทบผลลัพธ์ แต่รก) → ลบซ้ำ
// ─────────────────────────────────────────────────────────────────────────────

function handleEditLead(payload) {
  var rowIndex = parseInt(payload.rowIndex, 10);

  if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) {
    return { status: "error", message: "rowIndex ไม่ถูกต้อง ได้รับ: " + payload.rowIndex };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES);
  if (!sheet) return { status: "error", message: "ไม่พบชีต: " + SHEET_NAME.SALES };

  // [FIX-7] ลบ key "time" ที่ซ้ำออกแล้ว (ของเดิมมี time: COL.TIME สองบรรทัด)
  var fieldMap = {
    name:     COL.NAME,
    phone:    COL.PHONE,
    email:    COL.EMAIL,
    business: COL.BUSINESS,
    sum:      COL.SUM,
    time:     COL.TIME,
    note:     COL.NOTE,
    address:  COL.ADDRESS,
  };

  var updated = [];
  Object.keys(fieldMap).forEach(function(field) {
    if (payload[field] !== undefined && payload[field] !== null) {
      sheet.getRange(rowIndex, fieldMap[field]).setValue(payload[field]);
      updated.push(field);
    }
  });

  SpreadsheetApp.flush();

  Logger.log("editLead: row " + rowIndex + " updated: " + updated.join(", "));
  return { status: "ok", action: "editLead", rowIndex: rowIndex, updated: updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 8: logInterest
// ─────────────────────────────────────────────────────────────────────────────

function handleLogInterest(payload) {
  var logHeaders = ["วันที่", "ลูกค้า", "แผน", "หมายเหตุ"];
  var logSheet   = getOrCreateSheet(SHEET_NAME.INTEREST_LOG, logHeaders);

  logSheet.appendRow([
    payload.timestamp || new Date().toLocaleString("th-TH"),
    payload.customer  || "",
    payload.plan      || "",
    "ลูกค้าเปิดดูและกดสนใจใบเสนอราคาออนไลน์",
  ]);

  SpreadsheetApp.flush();
  Logger.log("logInterest: " + payload.customer + " / " + payload.plan);
  return { status: "ok", action: "logInterest" };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 9: logFavorite
// ─────────────────────────────────────────────────────────────────────────────

function handleLogFavorite(payload) {
  var favoriteData = payload.favoriteData || {};
  if (!favoriteData.userId || !favoriteData.plan) {
    return { status: "error", message: "userId and plan are required for logging favorites." };
  }

  var logSheet = getOrCreateSheet(SHEET_NAME.FAVORITES_LOG, FAVORITES_LOG_HEADERS);

  // จัดเรียงข้อมูลตาม FAVORITES_LOG_HEADERS
  var row = [
    favoriteData.timestamp || new Date().toLocaleString('th-TH'),
    favoriteData.userId,
    favoriteData.business || '',
    favoriteData.company || '',
    favoriteData.plan || '',
    favoriteData.group || '',
  ];

  logSheet.appendRow(row);
  SpreadsheetApp.flush();

  Logger.log("logFavorite: " + favoriteData.userId + " / " + favoriteData.plan);
  return { status: "ok", action: "logFavorite" };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 10: clearUserFavorites
// ─────────────────────────────────────────────────────────────────────────────

function handleClearUserFavorites(payload) {
  var userId = payload.userId;
  if (!userId) {
    return { status: "error", message: "userId is required for clearing favorites." };
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var logSheet = ss.getSheetByName(SHEET_NAME.FAVORITES_LOG);

  if (!logSheet || logSheet.getLastRow() < 2) {
    Logger.log("clearUserFavorites: Sheet is empty or not found. Nothing to clear for user: " + userId);
    return { status: "ok", action: "clearUserFavorites", message: "Sheet was empty." };
  }

  var data = logSheet.getDataRange().getValues();
  var header = data[0];
  var userIdColIndex = header.indexOf("UserID"); // ค้นหา index ของคอลัมน์ UserID

  if (userIdColIndex === -1) {
    return { status: "error", message: "UserID column not found in FavoritesLog sheet." };
  }

  // กรองข้อมูลทั้งหมดที่ไม่ใช่ของ UserID นี้
  var newData = data.filter(function(row, index) {
    return index === 0 || row[userIdColIndex] !== userId;
  });

  logSheet.clearContents(); // ล้างข้อมูลทั้งหมดในชีท
  logSheet.getRange(1, 1, newData.length, header.length).setValues(newData); // เขียนข้อมูลที่กรองแล้วกลับไป
  SpreadsheetApp.flush();

  Logger.log("clearUserFavorites: Cleared favorites for user: " + userId);
  return { status: "ok", action: "clearUserFavorites" };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Photo Upload
// ─────────────────────────────────────────────────────────────────────────────

function uploadBase64Photo(dataUrl, customerName, phone) {
  var match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) throw new Error("รูปแบบ Base64 ไม่ถูกต้อง");

  var mimeType   = match[1];
  var base64Data = match[2];
  var extension  = mimeType.split("/")[1].replace("jpeg", "jpg");
  var timestamp  = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd_HHmmss");
  var safeName   = (customerName || "unknown").replace(/[^a-zA-Zก-ฮ0-9]/g, "_");
  var filename   = safeName + "_" + phone + "_" + timestamp + "." + extension;

  var decoded = Utilities.base64Decode(base64Data);
  var blob    = Utilities.newBlob(decoded, mimeType, filename);
  var folder  = getDriveFolder(DRIVE_FOLDER_NAME);
  var file    = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}

function getDriveFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.getRootFolder().createFolder(folderName);
}

// ─────────────────────────────────────────────────────────────────────────────
// [NEW] HELPERS — Photo Upload
// ─────────────────────────────────────────────────────────────────────────────

function uploadBase64Photo(dataUrl, customerName, phone) {
  var match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) throw new Error("รูปแบบ Base64 ไม่ถูกต้อง");

  var mimeType   = match[1];
  var base64Data = match[2];
  var extension  = mimeType.split("/")[1].replace("jpeg", "jpg");
  var timestamp  = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd_HHmmss");
  var safeName   = (customerName || "unknown").replace(/[^a-zA-Zก-ฮ0-9]/g, "_");
  var filename   = safeName + "_" + phone + "_" + timestamp + "." + extension;

  var decoded = Utilities.base64Decode(base64Data);
  var blob    = Utilities.newBlob(decoded, mimeType, filename);
  var folder  = getDriveFolder(DRIVE_FOLDER_NAME);
  var file    = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}

function getDriveFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.getRootFolder().createFolder(folderName);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — MARK Sheet
// ─────────────────────────────────────────────────────────────────────────────

function appendMarkColumn(ss, company, plan, group, markValues) {
  var sheet = ss.getSheetByName(SHEET_NAME.MARK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME.MARK);
    sheet.getRange(1, 1).setValue("บริษัทประกัน");
    sheet.getRange(2, 1).setValue("แผนประกัน");
    sheet.getRange(3, 1).setValue("กลุ่ม");
  }

  var newCol = Math.max(sheet.getLastColumn(), 1) + 1;
  sheet.getRange(1, newCol).setValue(company || "");
  sheet.getRange(2, newCol).setValue(plan    || "");
  sheet.getRange(3, newCol).setValue(group   || "");

  var lastDataRow = sheet.getLastRow();
  for (var r = 4; r <= lastDataRow; r++) {
    var topic = String(sheet.getRange(r, 1).getValue() || "").trim();
    if (!topic) continue;
    var hasIt = markValues.hasOwnProperty(topic) && markValues[topic] === "1";
    sheet.getRange(r, newCol).setValue(hasIt ? "1" : "");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — DETAIL Sheet
// ─────────────────────────────────────────────────────────────────────────────

function appendDetailColumn(ss, company, plan, group, detailValues) {
  var sheet = ss.getSheetByName(SHEET_NAME.DETAIL);
  if (!sheet) {
    Logger.log("ไม่พบ DETAIL sheet — ข้ามการบันทึก details");
    return;
  }

  var newCol = Math.max(sheet.getLastColumn(), 1) + 1;
  sheet.getRange(1, newCol).setValue(company || "");
  sheet.getRange(2, newCol).setValue(plan    || "");
  sheet.getRange(3, newCol).setValue(group   || "");

  var lastDataRow = sheet.getLastRow();
  // [BUG-FIX] The loop should start from row 4 (r = 4) because rows 1-3 are headers
  // (Company, Plan, Group). The original r = 3 was attempting to match the "Group" header row.
  for (var r = 4; r <= lastDataRow; r++) {
    var topic = String(sheet.getRange(r, 1).getValue() || "").trim();
    if (!topic) continue;
    var val = detailValues[topic] || "";
    sheet.getRange(r, newCol).setValue(val);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — PREMIUM Sheet
// [FIX-6] เดิม targetCol หาแค่ company+plan ตรงกัน ไม่เช็ค group เลย
//         ทำให้ถ้ามีหลาย group ใต้ company+plan เดียวกัน จะจับคอลัมน์แรกที่เจอ
//         แล้วเขียนเบี้ยทับผิด group ได้ → เพิ่มการอ่าน groupRow (row 3) และ
//         เทียบ group ด้วย ให้ตรงกับ key รูปแบบ company|plan|group ที่
//         user-form.js ใช้จริงตอนสร้าง sfPremiumDatabase
// ─────────────────────────────────────────────────────────────────────────────

function appendPremiumRow(ss, company, plan, group, sumInsured, premium) {
  var sheet = ss.getSheetByName(SHEET_NAME.PREMIUM);
  if (!sheet) return;

  var compRow  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var planRow  = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var groupRow = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0]; // [FIX-6]

  // normalize group ของแผนที่กำลังจะเพิ่ม (ถือ "-" / "—" / ว่าง เป็น "ไม่มี group" เหมือนกัน)
  var normTargetGroup = (group && group !== "-" && group !== "—") ? normalizeStr(group) : "";

  var targetCol = -1;
  var lastComp = "";
  // [BUG-FIX] Loop must start from c = 0 to check all columns.
  // The original c = 1 skipped the first data column (column B).
  for (var c = 0; c < planRow.length; c++) {
    if (c === 0) continue; // Skip Sum Insured column (A)

    var cc = String(compRow[c] || "").trim();
    if (cc) lastComp = cc;

    var gg = String(groupRow[c] || "").trim();
    var normGg = (gg && gg !== "-" && gg !== "—") ? normalizeStr(gg) : ""; // [FIX-6]

    if (normalizeStr(lastComp) === normalizeStr(company) && normalizeStr(String(planRow[c] || "")) === normalizeStr(plan) && normGg === normTargetGroup) {
      targetCol = c + 1;
      break;
    }
  }

  if (targetCol === -1) {
    Logger.log("appendPremiumRow: ไม่พบคอลัมน์สำหรับ " + company + "/" + plan + "/" + (group || "-"));
    return;
  }

  var lastRow = sheet.getLastRow();
  var sumRows = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
  var targetRow = -1;
  for (var r = 0; r < sumRows.length; r++) {
    if (Number(String(sumRows[r][0] || "").replace(/,/g, "")) === Number(sumInsured)) {
      targetRow = r + 4;
      break;
    }
  }

  if (targetRow === -1) {
    sheet.appendRow([sumInsured]);
    targetRow = sheet.getLastRow();
  }

  sheet.getRange(targetRow, targetCol).setValue(Number(premium) || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Archive
// [FIX-2] flush ก่อน deleteRow เพื่อป้องกัน index เลื่อนจาก pending writes
// ─────────────────────────────────────────────────────────────────────────────

function archiveRow(ss, sourceSheet, rowIndex, targetSheetName, rowData) {
  var targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetSheetName);
    targetSheet.appendRow(SALES_HEADERS);
    _formatHeaderRange(targetSheet.getRange(1, 1, 1, SALES_HEADERS.length));
    targetSheet.setFrozenRows(1);
  } else if (targetSheet.getLastRow() === 0) {
    targetSheet.appendRow(SALES_HEADERS);
    _formatHeaderRange(targetSheet.getRange(1, 1, 1, SALES_HEADERS.length));
    targetSheet.setFrozenRows(1);
  }

  var targetLastCol = targetSheet.getLastColumn();
  if (targetLastCol < SALES_HEADERS.length) {
    targetSheet.getRange(1, 1, 1, SALES_HEADERS.length).setValues([SALES_HEADERS]);
  }

  var fullRowData = new Array(COL.TOTAL).fill("");
  for (var i = 0; i < Math.min(rowData.length, COL.TOTAL); i++) {
    fullRowData[i] = rowData[i] !== undefined ? rowData[i] : "";
  }

  targetSheet.appendRow(fullRowData);

  // [FIX-2] flush ทั้ง append และก่อน deleteRow
  SpreadsheetApp.flush();
  sourceSheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Sheet Management
// ─────────────────────────────────────────────────────────────────────────────

function getOrCreateSheet(sheetName, headers) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      _formatHeaderRange(sheet.getRange(1, 1, 1, headers.length));
      sheet.setFrozenRows(1);
    }
  } else if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    _formatHeaderRange(sheet.getRange(1, 1, 1, headers.length));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _formatHeaderRange(range) {
  range
    .setFontWeight("bold")
    .setBackground("#1E293B")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function _formatDataRow(sheet, rowIndex) {
  var range = sheet.getRange(rowIndex, 1, 1, COL.TOTAL);
  range.setFontSize(11).setVerticalAlignment("middle").setWrap(false);
  range.setBackground(rowIndex % 2 === 0 ? "#f8fafc" : "#ffffff");

  sheet.getRange(rowIndex, COL.STATUS)
    .setBackground("#fef9c3")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
}

function normalizeStr(str) {
  return String(str || "").replace(/\s+/g, "").toLowerCase();
}

function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    // [CORS FIX] Allow requests from any origin.
    // For production, you should restrict this to your actual domain for security.
    // Example: .setHeader('Access-Control-Allow-Origin', 'https://your-production-domain.com')
    .addHeader('Access-Control-Allow-Origin', '*');
}

/**
 * [NEW-HELPER] Converts an array of row values into a structured lead object.
 * This reduces code duplication between handleGetLeads and handleSubmitContact.
 * @param {Array} r The array of values for a single row.
 * @param {number} rowIndex The actual row number in the sheet (1-based).
 * @return {Object} A structured lead object.
 */
function _rowValuesToLeadObject(r, rowIndex) {
  return {
    rowIdx:      rowIndex,
    timestamp:   String(r[COL.TIMESTAMP - 1]  || ""),
    category:    String(r[COL.TYPE - 1]        || ""),
    business:    String(r[COL.BUSINESS - 1]    || ""),
    company:     String(r[COL.COMPANY - 1]     || ""),
    plan:        String(r[COL.PLAN - 1]         || ""),
    group:       String(r[COL.GROUP - 1]        || ""),
    covType:     String(r[COL.COV_TYPE - 1]    || ""),
    sum:         String(r[COL.SUM - 1]          || ""),
    premium:     String(r[COL.PREMIUM - 1]     || ""),
    name:        String(r[COL.NAME - 1]         || ""),
    phone:       String(r[COL.PHONE - 1]        || ""),
    email:       String(r[COL.EMAIL - 1]       || ""),
    time:        String(r[COL.TIME - 1]         || ""),
    address:     String(r[COL.ADDRESS - 1]     || ""),
    note:        String(r[COL.NOTE - 1]         || ""),
    status:      String(r[COL.STATUS - 1]      || "รอติดต่อ"),
    staffNote:   String(r[COL.STAFF_NOTE - 1]  || ""),
    policyNo:    String(r[COL.POLICY_NO - 1]   || ""),
    policyDate:  String(r[COL.POLICY_DATE - 1] || ""),
    renewalDate: String(r[COL.RENEWAL_DATE - 1]|| ""),
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — รัน 1 ครั้งจาก Script Editor เพื่อสร้าง/ซ่อมแซม header
// ─────────────────────────────────────────────────────────────────────────────

function initSalesSheet() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME.SALES) || ss.insertSheet(SHEET_NAME.SALES);

  var existingCols = sheet.getLastRow() > 0 ? sheet.getLastColumn() : 0;

  if (existingCols === 0) {
    sheet.getRange(1, 1, 1, SALES_HEADERS.length).setValues([SALES_HEADERS]);
    Logger.log("สร้าง Header ใหม่ทั้งหมด");
  } else if (existingCols < SALES_HEADERS.length) {
    for (var c = existingCols + 1; c <= SALES_HEADERS.length; c++) {
      sheet.getRange(1, c).setValue(SALES_HEADERS[c - 1]);
    }
    Logger.log("เพิ่ม Header ที่ขาด: " + SALES_HEADERS.slice(existingCols).join(", "));
  } else {
    Logger.log("Header ครบแล้ว (" + existingCols + " columns)");
  }

  _formatHeaderRange(sheet.getRange(1, 1, 1, SALES_HEADERS.length));
  sheet.setFrozenRows(1);

  var colWidths = {
    1:  150, 3:  180, 4:  120, 5:  200,
    7:  120, 8:  100, 9:  100, 10: 160,
    11: 120, 12: 200, 14: 250, 15: 300,
    16: 120, 17: 250, 18: 130, 19: 110, 20: 110,
  };

  Object.keys(colWidths).forEach(function(c) {
    sheet.setColumnWidth(Number(c), colWidths[c]);
  });

  SpreadsheetApp.flush();
  Logger.log("initSalesSheet เสร็จสมบูรณ์");
  return "✅ initSalesSheet สำเร็จ — " + SALES_HEADERS.length + " columns";
}

function fixArchiveSheetHeaders() {
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var targets = [SHEET_NAME.HISTORY, SHEET_NAME.NOT_INT, SHEET_NAME.CANCEL];
  targets.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var existing = sheet.getLastColumn();
    if (existing < SALES_HEADERS.length) {
      sheet.getRange(1, 1, 1, SALES_HEADERS.length).setValues([SALES_HEADERS]);
      _formatHeaderRange(sheet.getRange(1, 1, 1, SALES_HEADERS.length));
      Logger.log("แก้ไข header: " + name);
    }
  });
  SpreadsheetApp.flush();
  return "✅ fixArchiveSheetHeaders สำเร็จ";
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — ทดสอบ actions
// ─────────────────────────────────────────────────────────────────────────────

function testSubmitContact() {
  var result = handleSubmitContact({
    rowData: [
      new Date().toLocaleString("th-TH"),
      "Package", "ร้านอาหาร", "AAGI", "SME Basic", "SME", "All Risk",
      "500000", "8500", "ทดสอบ ระบบ", "0812345678", "test@ttib.co.th",
      "09:00 - 12:00", "กรุงเทพฯ", "ทดสอบระบบ", "รอติดต่อ"
    ],
    photoData: null
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function testUpdateStatus() {
  var result = handleUpdateStatus({ rowIndex: 2, status: "ติดต่อแล้ว" });
  Logger.log(JSON.stringify(result));
  return result;
}

function testUpdateNote() {
  var result = handleUpdateNote({ rowIndex: 2, staffNote: "นัดวันที่ 15 มี.ค." });
  Logger.log(JSON.stringify(result));
  return result;
}

function testUpdateRenewal() {
  var result = handleUpdateRenewal({ rowIndex: 2, renewalDate: "2026-03-15" });
  Logger.log(JSON.stringify(result));
  return result;
}

function testEditLead() {
  var result = handleEditLead({ rowIndex: 2, name: "ทดสอบ แก้ไข", phone: "0898765432" });
  Logger.log(JSON.stringify(result));
  return result;
}