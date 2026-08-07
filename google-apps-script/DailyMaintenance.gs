/**
 * DỰ ÁN APPS SCRIPT ĐỘC LẬP — KHÔNG gắn vào Google Sheet nào cả.
 * Cách tạo: script.google.com > New project > xoá code mẫu > dán TOÀN BỘ file này
 * vào > đặt tên project (vd "CPC1HN - Bảo trì hàng ngày").
 *
 * Việc: 3 việc bảo trì hàng ngày, chạy nền tự động theo giờ (không cần mở gì cả):
 *   1. Cảnh báo hạn dùng NL — gửi mail khi 1 NL chưa pha chạm mốc 3/6/9/12/13 tháng
 *      kể từ Đợt SX (mốc 13 = quá hạn, hệ thống tự chuyển NL đó sang "chờ xử lý").
 *   2. Dọn Thùng rác quá 30 ngày (xoá vĩnh viễn NL đã xoá mềm quá lâu).
 *   3. Tự động chuyển "Chờ SX" quá 30 ngày sang "Đã pha" (phòng khi NCV quên bấm
 *      "Xác nhận đã pha" tay trong app — lớp phòng thủ THỨ 2, lớp thứ 1 chạy ngay
 *      trong app mỗi khi có người mở web, xem reload() trong src/App.jsx).
 *
 * Trước khi chạy: Project Settings (icon bánh răng) > Script Properties > thêm:
 *   SUPABASE_URL         = https://xxxxxxxxxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY = service_role key (Project Settings > API trong Supabase)
 *   ALERT_EMAIL           = địa chỉ nhận cảnh báo hạn dùng NL
 *
 * Sau khi cấu hình xong: mở dropdown chọn hàm (cạnh nút "Chạy" ▷) ở trên cùng,
 * chọn "setupDailyMaintenanceTrigger", bấm "Chạy" (Run) đúng 1 lần — script sẽ tự
 * đặt lịch chạy nền mỗi ngày lúc 8h sáng từ đó về sau, không cần làm lại.
 * Muốn chạy thử ngay xem có lỗi gì không: chọn 1 trong 3 hàm
 * checkExpiryAlerts / purgeOldTrash / confirmChoSXOverdueNow rồi bấm "Chạy",
 * xem kết quả ở "Nhật ký thực thi" (Execution log).
 */

function parseDotSanXuat_(s) {
  var str = String(s || "").trim();
  var m = str.match(/^(\d{1,2})\/(\d{2,4})$/); // M/YY hoặc M/YYYY
  if (m) {
    var month1 = parseInt(m[1], 10), year1 = parseInt(m[2], 10);
    if (year1 < 100) year1 += 2000;
    return (month1 >= 1 && month1 <= 12) ? new Date(year1, month1 - 1, 1) : null;
  }
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // D/M/YY hoặc D/M/YYYY
  if (m) {
    var month2 = parseInt(m[2], 10), year2 = parseInt(m[3], 10);
    if (year2 < 100) year2 += 2000;
    return (month2 >= 1 && month2 <= 12) ? new Date(year2, month2 - 1, 1) : null;
  }
  return null;
}
function parseSoLoDate_(soLo) {
  var s = String(soLo || "").trim();
  var m = s.match(/^(\d{2})(\d{2})(\d{2})/);
  if (m) {
    var month = parseInt(m[2], 10), year = 2000 + parseInt(m[3], 10);
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
  }
  m = s.match(/^(\d{2})([A-La-l])\d/);
  if (m) {
    var year2 = 2000 + parseInt(m[1], 10);
    var month2 = m[2].toUpperCase().charCodeAt(0) - 64;
    return new Date(year2, month2 - 1, 1);
  }
  return null;
}
function productionDate_(m) {
  return parseSoLoDate_(m.so_lo) || parseDotSanXuat_(m.dot_san_xuat);
}
function monthsSince_(material) {
  var d = productionDate_(material);
  if (!d) return null;
  var now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}
function milestoneLabel_(months) {
  if (months >= 13) return "ĐÃ QUÁ HẠN DÙNG — hệ thống tự chuyển sang \"chờ xử lý\"";
  if (months === 12) return "CÒN KHOẢNG 1 THÁNG là hết hạn dùng";
  return "đã để " + months + " tháng kể từ đợt sản xuất, chưa pha";
}

// Hiện hộp thoại nếu chạy có UI (hiếm khi có ở dự án độc lập này); nếu không có UI
// (chạy trực tiếp trong Apps Script bằng nút "Chạy", hoặc chạy nền từ trigger) thì
// ghi vào Nhật ký thực thi thay thế, không báo lỗi.
function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
function ScriptTriggers_removeExisting_(fnName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

var ALERT_MILESTONES = [3, 6, 9, 12, 13];

// Logic dùng chung. KHÔNG gọi SpreadsheetApp.getUi() ở đây — hàm này còn được
// gọi từ trigger thời gian (chạy nền, không có UI để hiện hộp thoại), gọi getUi()
// trong ngữ cảnh đó sẽ ném lỗi và làm hỏng cả trigger tự động.
function runExpiryCheck_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var toEmail = props.getProperty("ALERT_EMAIL");
  if (!url || !key || !toEmail) {
    return { ok: false, message: 'Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / ALERT_EMAIL trong Script Properties.' };
  }

  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?da_pha=eq.false&select=id,so_lo,ten_nl,strain,dot_san_xuat,chai,lo,last_alert_month",
    { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() >= 300) {
    return { ok: false, message: "Lỗi khi lấy dữ liệu NL: " + resp.getContentText() };
  }
  var materials = JSON.parse(resp.getContentText());

  var toNotify = [];
  materials.forEach(function (m) {
    var months = monthsSince_(m);
    if (months == null) return;
    var hit = -1;
    for (var i = ALERT_MILESTONES.length - 1; i >= 0; i--) {
      if (months >= ALERT_MILESTONES[i]) { hit = ALERT_MILESTONES[i]; break; }
    }
    if (hit === -1) return;
    if (m.last_alert_month === hit) return; // mốc này đã báo rồi
    toNotify.push({ material: m, months: months, milestone: hit });
  });

  if (!toNotify.length) {
    return { ok: true, count: 0, message: "Không có NL nào chạm mốc cảnh báo mới hôm nay." };
  }

  toNotify.sort(function (a, b) { return b.milestone - a.milestone; });
  var lines = toNotify.map(function (x) {
    var m = x.material;
    return "- [" + x.milestone + " tháng] " + (m.strain === "clausii" ? "B. clausii" : "B. subtilis") +
      " · lô " + m.lo + " · chai " + m.chai + " (số lô: " + m.so_lo + ") — " + milestoneLabel_(x.months);
  });
  var body = "Danh sách nguyên liệu cần chú ý hạn dùng (" + toNotify.length + " chai):\n\n" +
    lines.join("\n") +
    "\n\nMốc cảnh báo: 3, 6, 9, 12 tháng (nhắc nhở), 13 tháng (quá hạn, tự chuyển sang \"chờ xử lý\").";

  MailApp.sendEmail(toEmail, "[Pha chế sinh phẩm] Cảnh báo hạn dùng NL — " + toNotify.length + " chai cần xử lý", body);

  toNotify.forEach(function (x) {
    UrlFetchApp.fetch(url + "/rest/v1/materials?id=eq." + x.material.id, {
      method: "patch",
      contentType: "application/json",
      headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "return=minimal" },
      payload: JSON.stringify({ last_alert_month: x.milestone }),
      muteHttpExceptions: true,
    });
  });

  return { ok: true, count: toNotify.length, message: "Đã gửi mail cảnh báo cho " + toNotify.length + " chai tới " + toEmail + "." };
}

// Chạy thử thủ công — chọn hàm này trong dropdown rồi bấm "Chạy".
function checkExpiryAlerts() {
  var result = runExpiryCheck_();
  notify_(result.message);
}

var TRASH_RETENTION_DAYS = 30;
// Khớp đúng CHO_SX_RETENTION_DAYS trong src/App.jsx — sửa 1 bên thì phải sửa bên kia.
var CHO_SX_RETENTION_DAYS = 30;

// Logic dùng chung — không gọi getUi(), an toàn để chạy từ trigger thời gian.
function purgeOldTrash_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) return { ok: false, message: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY, bỏ qua dọn Thùng rác." };

  var cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?pending_delete=eq.true&deleted_at=lt." + encodeURIComponent(cutoff),
    {
      method: "delete",
      headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "return=representation" },
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() >= 300) {
    return { ok: false, message: "Lỗi khi dọn Thùng rác: " + resp.getContentText() };
  }
  var deleted = JSON.parse(resp.getContentText() || "[]");
  return { ok: true, message: "Đã xoá vĩnh viễn " + deleted.length + " bản ghi trong Thùng rác quá " + TRASH_RETENTION_DAYS + " ngày." };
}

// Chạy thử thủ công — chọn hàm này trong dropdown rồi bấm "Chạy".
function purgeOldTrash() {
  var result = purgeOldTrash_();
  notify_(result.message);
}

// Logic dùng chung — không gọi getUi(), an toàn để chạy từ trigger thời gian. Lớp phòng thủ THỨ 2
// (bên cạnh client-side trong reload(), src/App.jsx) cho ca "Chờ SX" quá CHO_SX_RETENTION_DAYS ngày
// mà không NCV nào mở web để tự động chuyển "Đã pha" — phòng khi không ai mở app trong lúc đó.
function autoConfirmChoSX_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) return { ok: false, message: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY, bỏ qua tự động chuyển Chờ SX." };

  var cutoff = new Date(Date.now() - CHO_SX_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  var headers = { apikey: key, Authorization: "Bearer " + key };
  var selectResp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?select=id,strain,pha_product,mix_plan_id,mix_plan_me_so&cho_sx=eq.true&da_pha=eq.false&cho_sx_at=lt." + encodeURIComponent(cutoff),
    { method: "get", headers: headers, muteHttpExceptions: true }
  );
  if (selectResp.getResponseCode() >= 300) return { ok: false, message: "Lỗi khi tra Chờ SX quá hạn: " + selectResp.getContentText() };
  var rows = JSON.parse(selectResp.getContentText() || "[]");
  if (!rows.length) return { ok: true, message: "Không có NL Chờ SX nào quá " + CHO_SX_RETENTION_DAYS + " ngày." };

  // Gộp theo đúng mẻ (mix_plan_id + mix_plan_me_so) — mỗi mẻ nhận CHUNG 1 mã mẻ tự động, giống hệt
  // lúc NCV tự bấm "Xác nhận đã pha" tay (xem ChoSXPanel, src/App.jsx).
  var groups = {};
  rows.forEach(function (r) {
    var k = r.mix_plan_id + "-" + r.mix_plan_me_so;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  var todayStr = Utilities.formatDate(new Date(), "GMT+7", "yyMMdd");
  var confirmedGroups = 0;
  Object.keys(groups).forEach(function (k) {
    var groupRows = groups[k];
    var r0 = groupRows[0];
    var phaMe = (r0.pha_product || r0.strain) + "-P" + r0.mix_plan_id + "M" + r0.mix_plan_me_so + "-" + todayStr + "-AUTO30D";
    var ids = groupRows.map(function (r) { return r.id; }).join(",");
    var patchResp = UrlFetchApp.fetch(
      url + "/rest/v1/materials?id=in.(" + ids + ")",
      {
        method: "patch",
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        payload: JSON.stringify({ da_pha: true, pha_me: phaMe }),
        muteHttpExceptions: true,
      }
    );
    if (patchResp.getResponseCode() < 300) confirmedGroups++;
  });
  return { ok: true, message: "Đã tự động chuyển Đã pha cho " + confirmedGroups + " mẻ (" + rows.length + " chai) Chờ SX quá " + CHO_SX_RETENTION_DAYS + " ngày." };
}

// Chạy thử thủ công — chọn hàm này trong dropdown rồi bấm "Chạy".
function confirmChoSXOverdueNow() {
  var result = autoConfirmChoSX_();
  notify_(result.message);
}

// Gọi từ trigger thời gian (chạy nền hàng ngày) — không hiện hộp thoại, chỉ ghi log.
function dailyMaintenanceScheduled_() {
  var expiry = runExpiryCheck_();
  Logger.log(expiry.message);
  var purged = purgeOldTrash_();
  Logger.log(purged.message);
  var choSx = autoConfirmChoSX_();
  Logger.log(choSx.message);
}

// Chỉ cần chạy 1 LẦN DUY NHẤT (chọn hàm này rồi bấm "Chạy") để đặt lịch — sau đó cả
// 3 việc bảo trì ở trên tự chạy nền mỗi ngày lúc 8h sáng, không cần làm lại.
function setupDailyMaintenanceTrigger() {
  ScriptTriggers_removeExisting_("dailyMaintenanceScheduled_");
  ScriptApp.newTrigger("dailyMaintenanceScheduled_").timeBased().everyDays(1).atHour(8).create();
  notify_(
    "Đã đặt lịch chạy bảo trì hàng ngày lúc 8h sáng (cảnh báo hạn dùng + dọn Thùng rác + " +
    "tự chuyển Chờ SX quá hạn) — chạy nền, tự gửi mail/log, không cần mở gì thêm."
  );
}
