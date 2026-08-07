/**
 * Dán toàn bộ file này vào Google Apps Script GẮN VỚI Google Sheet dùng làm
 * nơi nhập liệu trung gian (Extensions > Apps Script trong Google Sheets).
 *
 * File này CHỈ còn đúng 1 việc: đọc dữ liệu từ Sheet và đẩy lên hệ thống
 * (Supabase). Hầu như không bao giờ cần sửa lại — mọi thay đổi khác (cảnh
 * báo hạn dùng, dọn Thùng rác, tự chuyển Chờ SX, báo cáo AI...) giờ nằm ở
 * 2 dự án Apps Script ĐỘC LẬP khác (không gắn Sheet, tự chạy nền theo giờ),
 * để sửa phần nào chỉ cần dán lại đúng phần đó — xem chi tiết bên dưới.
 *
 * ĐÃ TÁCH RA (2026-07-30) — dán vào 2 dự án MỚI, riêng biệt trên script.google.com
 * (menu "New project", KHÔNG gắn vào Sheet nào cả, giống hệt file ThuBaoTuScanner.gs
 * đã có sẵn từ trước):
 *   1. DailyMaintenance.gs — cảnh báo hạn dùng NL + dọn Thùng rác quá 30 ngày +
 *      tự động chuyển "Chờ SX" quá 30 ngày sang "Đã pha". Đây là 3 việc hay cần
 *      sửa/thêm nhất (gắn với các tính năng trong app) nên tách riêng, không dính
 *      tới phần AI bên dưới.
 *   2. AiTrendReport.gs — báo cáo NL "Chờ xử lý" hàng tháng kèm phân tích xu hướng
 *      AI (DeepSeek). Phần này to và ít liên quan tới 2 việc trên, tách hẳn ra để
 *      không phải đụng tới khi chỉ sửa phần vận hành hàng ngày, và ngược lại.
 * Trước khi chạy: Project Settings (icon bánh răng) > Script Properties > thêm các khoá:
 *   SUPABASE_URL         = https://xxxxxxxxxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY = service_role key (Project Settings > API trong Supabase)
 * (Cần thêm CẢ ALERT_EMAIL và DEEPSEEK_API_KEY ở 2 dự án kia — không cần ở đây.)
 *
 * Dùng service_role key (không phải anon key) vì key này chỉ chạy trên server
 * của Google, không lộ ra trình duyệt — cho phép ghi dữ liệu bỏ qua RLS an toàn.
 *
 * Sheet cần có 1 hàng tiêu đề (hàng đầu tiên có ô chứa "Số lô") với các cột
 * tương tự file Excel QC vẫn dùng: STT, Tên NL, Chủng, Đợt SX, Số lô, Lô chủng,
 * Thể tích dịch, Cảm quan, pH, MĐ nhãn, MĐ SH, Bào tử %, Tình trạng, Ghi chú,
 * Mẻ pha, Nhiễm khuẩn, Nhiễm con nào.
 *
 * (Quét mail Gmail "Thu bào tử" tự động nằm ở file riêng ThuBaoTuScanner.gs —
 * không cần Sheet, chạy độc lập trên script.google.com.)
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Pha chế")
    .addItem("Đẩy dữ liệu lên hệ thống", "pushToSupabase")
    .addToUi();
}

var DIACRITICS_RE = new RegExp(
  String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93),
  "g"
);
function norm_(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/đ/g, "d")
    .trim();
}
function num_(v) {
  if (v === "" || v == null) return null;
  var t = String(v).replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "-") return null;
  var n = parseFloat(t);
  return isFinite(n) ? n : null;
}
function parsePh_(v) {
  var n = num_(v);
  // Excel đôi khi lưu 1 ngày tháng bị gõ nhầm vào ô pH dưới dạng số serial (vd 45664) —
  // pH thật luôn trong khoảng 0-14. Ngoài khoảng đó là dữ liệu SAI (đánh dấu riêng),
  // khác với "chưa nhập" (n == null).
  if (n == null) return { ph: null, ph_invalid: false };
  if (n < 0 || n > 14) return { ph: null, ph_invalid: true };
  return { ph: n, ph_invalid: false };
}
function detectStrain_(txt) {
  var j = norm_(txt);
  if (/sf\d/.test(j) || /\bg4\b/.test(j) || /subtil/.test(j)) return "subtilis";
  if (/sa\d/.test(j) || /\bg3\b/.test(j) || /claus/.test(j)) return "clausii";
  return null;
}
function splitLo_(s) {
  s = String(s || "").trim();
  var m = s.match(/^(.*?)[.\s]*(C\d+)$/i);
  return m ? { lo: m[1].trim(), chai: m[2].toUpperCase() } : { lo: s, chai: "" };
}

var HEADER_RULES = [
  [/lo\s*chung/, "lo_chung"], [/so\s*lo/, "so_lo"], [/nhiem\s*con/, "nhiem_con_nao"],
  [/nhiem/, "nhiem_khuan"], [/^stt/, "stt"], [/ten/, "ten_nl"], [/dot/, "dot_san_xuat"],
  [/the\s*tich|dich/, "v_dich"], [/cam\s*quan/, "cam_quan"], [/nhan/, "md_nhan"],
  [/sh|sinh\s*hoc/, "md_sh"], [/bao\s*tu/, "ty_le_bao_tu"], [/tinh\s*trang/, "tinh_trang_src"],
  [/ghi\s*chu/, "ghi_chu"], [/^me|me\s*pha/, "me_che"], [/^ph$|do\s*ph/, "ph"], [/chung/, "chung"],
];
function mapHeader_(cells) {
  var map = {};
  cells.forEach(function (cell, i) {
    var n = norm_(cell);
    if (!n) return;
    for (var k = 0; k < HEADER_RULES.length; k++) {
      var re = HEADER_RULES[k][0], key = HEADER_RULES[k][1];
      if (map[key] != null) continue;
      if (re.test(n)) { map[key] = i; break; }
    }
  });
  return map;
}

function findHeaderRowIndex_(grid) {
  // Vài sheet nguồn có tới 2-3 hàng "trông giống tiêu đề" (hàng ghi chú/hướng dẫn
  // cũng lặp lại chữ "Số lô"). Chọn hàng khớp được NHIỀU cột nhất, không phải hàng
  // đầu tiên tình cờ chứa chữ "Số lô".
  var bestIdx = -1, bestScore = 0;
  var limit = Math.min(grid.length, 15);
  for (var i = 0; i < limit; i++) {
    var row = grid[i];
    if (!row.some(function (c) { return /so\s*lo/.test(norm_(c)); })) continue;
    var score = Object.keys(mapHeader_(row)).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}
function collectRowsFromSheet_(sheet) {
  var grid = sheet.getDataRange().getValues();
  var rows = [];
  var skipped = 0;
  if (!grid.length) return { rows: rows, skipped: skipped };

  var hIdx = findHeaderRowIndex_(grid);
  if (hIdx < 0) return { rows: rows, skipped: skipped };
  var map = mapHeader_(grid[hIdx]);

  for (var r = hIdx + 1; r < grid.length; r++) {
    var row = grid[r];
    var g = function (k) { return map[k] != null ? String(row[map[k]] == null ? "" : row[map[k]]).trim() : ""; };
    var soLo = g("so_lo");
    if (!soLo) continue;
    if (!/\d{2}/.test(soLo)) continue; // dòng tiêu đề/ghi chú lẫn vào (vd "Chủng", "G3"), lô thật luôn có mã ngày tháng
    var strain = detectStrain_([g("ten_nl"), g("chung"), soLo, sheet.getName()].join(" "));
    if (!strain) { skipped++; continue; }
    var split = splitLo_(soLo);
    // Chuẩn hoá so_lo về đúng 1 dạng "<lô>.<chai>" (vd "26F01SA1.C1") trước khi đẩy lên — đây là
    // cột dùng làm khoá chống trùng (on_conflict=so_lo) khi upsert. Sheet nguồn có lúc gõ dấu chấm
    // có lúc gõ khoảng trắng giữa lô và chai (splitLo_ đọc được cả 2 dạng) — nếu giữ nguyên text thô
    // từ sheet, 2 cách gõ khác nhau cho CÙNG 1 chai thật sẽ bị coi là so_lo khác nhau, upsert không
    // khớp được vào dòng cũ (vd đã có kết quả QC) mà tạo thêm 1 dòng mới rỗng QC — gây trùng lặp thật
    // sự trong hệ thống (1 chai hiện ở cả "Chờ KQKN" lẫn trạng thái QC cũ của nó).
    var soLoNorm = split.chai ? (split.lo + "." + split.chai) : soLo;
    var tinhTrangSrc = g("tinh_trang_src");
    var daPha = /da\s*pha/.test(norm_(tinhTrangSrc));
    rows.push({
      strain: strain, stt: g("stt"), ten_nl: g("ten_nl"), chung: g("chung"),
      dot_san_xuat: g("dot_san_xuat"), so_lo: soLoNorm, lo: split.lo, chai: split.chai,
      lo_chung: g("lo_chung"), v_dich: num_(g("v_dich")), cam_quan: g("cam_quan"),
      ph: parsePh_(g("ph")).ph, ph_invalid: parsePh_(g("ph")).ph_invalid,
      md_nhan: num_(g("md_nhan")), md_sh: num_(g("md_sh")),
      ty_le_bao_tu: num_(g("ty_le_bao_tu")), nhiem_khuan: g("nhiem_khuan"),
      nhiem_con_nao: g("nhiem_con_nao"), tinh_trang_src: tinhTrangSrc, ghi_chu: g("ghi_chu"),
      me_che: g("me_che"), da_pha: daPha,
      pha_product: daPha ? (g("ghi_chu") || null) : null,
      pha_me: daPha ? (g("me_che") || null) : null,
    });
  }
  return { rows: rows, skipped: skipped };
}

function pushToSupabase() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) {
    SpreadsheetApp.getUi().alert("Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_KEY trong Script Properties.");
    return;
  }

  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var rows = [];
  var skipped = 0;
  sheets.forEach(function (sheet) {
    var result = collectRowsFromSheet_(sheet);
    rows = rows.concat(result.rows);
    skipped += result.skipped;
  });

  if (!rows.length) {
    SpreadsheetApp.getUi().alert(
      "Không có dòng hợp lệ nào để đẩy (thiếu cột \"Số lô\", hoặc không nhận diện được chủng ở tab nào)."
    );
    return;
  }

  var resp = UrlFetchApp.fetch(url + "/rest/v1/materials?on_conflict=so_lo", {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    SpreadsheetApp.getUi().alert(
      "Đã đẩy " + rows.length + " dòng lên hệ thống." +
      (skipped ? " (" + skipped + " dòng bị bỏ qua vì không nhận diện được chủng)" : "")
    );
  } else {
    SpreadsheetApp.getUi().alert("Lỗi khi đẩy dữ liệu (mã " + code + "): " + resp.getContentText());
  }
}
