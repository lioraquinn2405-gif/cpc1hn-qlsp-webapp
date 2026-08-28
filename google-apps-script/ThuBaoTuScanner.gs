/**
 * QUÉT MAIL GMAIL "THU BÀO TỬ" TỰ ĐỘNG — KHÔNG CẦN GOOGLE SHEET.
 *
 * Đây là 1 project Apps Script ĐỘC LẬP, không gắn với Sheet nào, không dùng
 * SpreadsheetApp — chạy trực tiếp trên script.google.com.
 *
 * Cách cài đặt (làm 1 lần):
 * 1. Vào https://script.google.com — ĐĂNG NHẬP ĐÚNG tài khoản Gmail đang có
 *    nhãn "Thu bào tử" (script chỉ đọc được hộp mail của tài khoản đang đăng
 *    nhập chạy script, không đọc được tài khoản khác).
 * 2. Bấm "New project". Xoá hết code mẫu (Code.gs trống), dán toàn bộ nội
 *    dung file này vào.
 * 3. Icon bánh răng bên trái (Project Settings) > mục "Script Properties" >
 *    Add script property, thêm đủ 3 dòng:
 *      SUPABASE_URL         = https://xxxxxxxxxxxx.supabase.co
 *      SUPABASE_SERVICE_KEY = service_role key (Supabase Dashboard > Project
 *                              Settings > API > service_role secret)
 *      ALERT_EMAIL          = email bạn muốn nhận thông báo kết quả quét mail
 *      QC_ALERT_EMAIL       = (không bắt buộc) email QC nhận riêng mail cảnh
 *                              báo "chưa nhập kết quả QC" — nhiều người thì
 *                              cách nhau bằng dấu phẩy. Để trống thì mail này
 *                              vẫn gửi về ALERT_EMAIL như các mail khác.
 * 4. Quay lại icon </> (Editor). Ở thanh trên cùng, chỗ dropdown chọn hàm để
 *    chạy (bên trái nút "Run"), chọn "scanThuBaoTu" rồi bấm Run.
 *    - Lần đầu Google hiện màn xin quyền: bấm Continue/Advanced > "Go to
 *      [tên project] (unsafe)" > Allow. (Chữ "unsafe" chỉ vì Google chưa xác
 *      minh app của bên thứ 3 — an toàn vì đây là script do chính bạn tạo.)
 *    - Sau khi chạy xong, kiểm tra email ALERT_EMAIL để xem kết quả.
 * 5. Nếu kết quả ổn, chọn hàm "setupThuBaoTuTrigger" rồi bấm Run 1 lần —
 *    từ đó script tự quét mỗi ngày 1 lần lúc 7h sáng, không cần mở lại trang
 *    này nữa. (Muốn tắt: icon đồng hồ bên trái "Triggers" > xoá trigger đó.)
 *
 * --- Cấu trúc nhãn Gmail ---
 * KHÔNG CẦN sửa bộ lọc Gmail bạn đã đặt sẵn — mail mới vẫn cứ vào nhãn "Thu bào
 * tử" như cũ. Script tự thêm 2 nhãn phụ để tự nhớ việc: "Thu bào tử/Đã quét"
 * (đã lấy dữ liệu thành công) và "Thu bào tử/Lỗi" (không đọc được/không có dữ
 * liệu, kể cả mail "Re:" chỉ có trả lời — cần nhập tay). Mail nào đã có 1 trong
 * 2 nhãn phụ này rồi sẽ KHÔNG bị quét lại các lần sau — nhờ vậy mỗi lần quét chỉ
 * xử lý đúng mail mới, không tốn công quét lại mail cũ đã xong. Email báo cáo
 * kết quả do chính script gửi tự được gắn nhãn "Thu bào tử/Báo cáo" riêng,
 * không lẫn vào chỗ khác.
 */

var THU_LABEL_NAME = "Thu bào tử";
var THU_LABEL_DONE = "Thu bào tử/Đã quét";
var THU_LABEL_ERROR = "Thu bào tử/Lỗi";
var THU_LABEL_REPORT = "Thu bào tử/Báo cáo";

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
function findRowByLabel_(rows, re) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].length && re.test(norm_(rows[i][0]))) return rows[i];
  }
  return null;
}
function firstNumber_(s) {
  var m = String(s == null ? "" : s).match(/-?[\d.,]+/);
  return m ? num_(m[0]) : null;
}
function parseVnDateIso_(s) {
  var m = String(s || "").trim().match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (!m) return null;
  var day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  var mm = (month < 10 ? "0" : "") + month, dd = (day < 10 ? "0" : "") + day;
  return year + "-" + mm + "-" + dd;
}

// Tách 1 email dạng bảng (đã qua getPlainBody, cột cách nhau bởi tab hoặc
// nhiều khoảng trắng) thành các chai NL thu được. Trả về null nếu không nhận
// diện được dòng "Số lô ký hiệu" — coi như không đúng định dạng, bỏ qua.
function parseThuBaoTuBody_(plainText) {
  var lines = String(plainText || "").split(/\r?\n/)
    // Mail "Re:" (trả lời) thường trích dẫn lại nội dung gốc với dấu ">" ở đầu
    // mỗi dòng — phải bỏ đi trước khi nhận diện nhãn cột.
    .map(function (l) { return l.replace(/^(>\s*)+/, "").replace(/\s+$/, ""); })
    .filter(function (l) { return l.trim().length; });
  var rows = lines.map(function (l) {
    // Gmail xuất mỗi dòng bảng với 1 dấu tab thừa ở đầu (vd "\tSố lô ký hiệu\t...") —
    // phải trim() trước khi tách, nếu không ô đầu tiên (nhãn cột) sẽ luôn ra rỗng.
    var trimmed = l.trim();
    var cells = trimmed.split(/\t+/);
    if (cells.length < 2) cells = trimmed.split(/ {2,}/);
    return cells.map(function (c) { return c.trim(); });
  });

  var soLoRow = findRowByLabel_(rows, /^so\s*lo\s*ky\s*hieu/);
  if (!soLoRow) return null;

  var prodHeaderIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].length && /^ma\s*vat\s*tu/.test(norm_(rows[i][0]))) { prodHeaderIdx = i; break; }
  }
  var prodData = prodHeaderIdx >= 0 ? rows[prodHeaderIdx + 1] : null;
  var tenNL = prodData ? (prodData[1] || "") : "";
  var meSanXuat = prodData ? (prodData[3] || "") : "";
  var ngaySanXuat = prodData ? (prodData[4] || "") : "";

  var ngayThuRow = findRowByLabel_(rows, /^ngay\s*thu/);
  var nguoiThuRow = findRowByLabel_(rows, /^nguoi\s*thu/);
  var phRow = findRowByLabel_(rows, /^ph$/);
  var camQuanRow = findRowByLabel_(rows, /^cam\s*quan/);
  var vDichRow = findRowByLabel_(rows, /the\s*tich.*thu\s*duoc/);
  var batThuongRow = findRowByLabel_(rows, /^bat\s*thuong/);

  var soLoList = soLoRow.slice(1);
  var phList = phRow ? phRow.slice(1) : [];
  var camQuanList = camQuanRow ? camQuanRow.slice(1) : [];
  var vDichList = vDichRow ? vDichRow.slice(1) : [];

  var bottles = soLoList.filter(function (s) { return s; }).map(function (soLo, idx) {
    return {
      so_lo: soLo,
      ph: firstNumber_(phList[idx]),
      cam_quan: camQuanList[idx] || "",
      v_dich: firstNumber_(vDichList[idx]),
    };
  });

  // Hàng "Bất thường" đôi khi có thêm chai ngoài các cột chuẩn (vd chai 6,7,8)
  // hoặc ghi đè thể tích 1 chai đã có, dạng "030526SF1.C6=10L 030526SF1.C7=8L".
  // Chai phát sinh thêm không có cột pH/cảm quan riêng — tạm lấy theo chai đầu
  // tiên trong dòng chuẩn, cần NCV kiểm tra/sửa tay nếu thực tế khác.
  if (batThuongRow) {
    var text2 = batThuongRow.slice(1).join(" ");
    var re = /([0-9A-Za-z.\-]+)\s*=\s*([\d.,]+)\s*L/gi;
    var m2;
    var fallbackPh = bottles.length ? bottles[0].ph : null;
    var fallbackCamQuan = bottles.length ? bottles[0].cam_quan : "";
    while ((m2 = re.exec(text2))) {
      var soLo2 = m2[1], vol2 = num_(m2[2]);
      var existing = null;
      for (var k = 0; k < bottles.length; k++) if (bottles[k].so_lo === soLo2) { existing = bottles[k]; break; }
      if (existing) existing.v_dich = vol2;
      else bottles.push({ so_lo: soLo2, ph: fallbackPh, cam_quan: fallbackCamQuan, v_dich: vol2 });
    }
  }

  // Lô/chai thật luôn có dạng "...C<số>" (do splitLo_ tách ra) — chai nào không
  // khớp (vd tách nhầm ra "0" từ 1 ô lệch cột) là dữ liệu rác, loại bỏ ngay từ
  // đây thay vì lỡ đẩy lên Supabase thành 1 dòng vô nghĩa.
  bottles = bottles.filter(function (b) { return /c\d+$/i.test(String(b.so_lo || "").trim()); });

  if (!bottles.length) return null;

  var strain = detectStrain_([tenNL, soLoList.join(" ")].join(" "));
  var dotSanXuat = ngaySanXuat ? ngaySanXuat.replace(/\./g, "/") : "";
  var thoiGianThu = parseVnDateIso_(ngayThuRow ? ngayThuRow[1] : "");
  var nguoiThu = nguoiThuRow ? (nguoiThuRow[1] || "") : "";

  // Dòng "Kết luận: ..." (vd cảnh báo không đạt thể tích/chỉ tiêu) không nằm
  // trong bảng, chỉ là 1 dòng văn bản riêng — bắt nguyên văn để đưa vào ghi chú
  // cho NCV thấy ngay cảnh báo mà không cần mở lại mail.
  var ketLuanLine = null;
  for (var li = 0; li < lines.length; li++) {
    if (/^ket\s*luan/.test(norm_(lines[li]))) { ketLuanLine = lines[li]; break; }
  }
  var ketLuan = ketLuanLine ? ketLuanLine.replace(/^[^:]*:\s*/, "").trim() : "";

  var noteParts = [];
  if (nguoiThu) noteParts.push("Người thu: " + nguoiThu);
  if (ketLuan) noteParts.push("Kết luận: " + ketLuan);
  var ghiChu = noteParts.join(" · ");

  var out = [];
  bottles.forEach(function (b) {
    var split = splitLo_(b.so_lo);
    var row = { strain: strain, ten_nl: tenNL, so_lo: b.so_lo, lo: split.lo || meSanXuat, chai: split.chai };
    if (dotSanXuat) row.dot_san_xuat = dotSanXuat;
    if (thoiGianThu) row.thoi_gian_thu = thoiGianThu;
    if (b.v_dich != null) row.v_dich = b.v_dich;
    if (b.ph != null) {
      var p = parsePh_(b.ph);
      row.ph = p.ph;
      row.ph_invalid = p.ph_invalid;
    }
    if (b.cam_quan) row.cam_quan = b.cam_quan;
    if (ghiChu) row.ghi_chu = ghiChu;
    out.push(row);
  });
  return out;
}

// Supabase (PostgREST) yêu cầu MỌI dòng gửi trong 1 lần bulk insert phải có
// đúng cùng bộ cột — 1 chai thiếu pH/thể tích sẽ có bộ cột khác chai đủ dữ
// liệu, gửi chung sẽ bị từ chối cả loạt ("All object keys must match"). Nhóm
// lại theo đúng bộ cột rồi gửi riêng từng nhóm.
function groupRowsByKeySignature_(rows) {
  var groups = {}, order = [];
  rows.forEach(function (row) {
    var sig = Object.keys(row).sort().join(",");
    if (!groups[sig]) { groups[sig] = []; order.push(sig); }
    groups[sig].push(row);
  });
  return order.map(function (sig) { return groups[sig]; });
}

function upsertMaterialRows_(rows, url, key) {
  if (!rows.length) return;
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
  if (code < 200 || code >= 300) throw new Error("mã lỗi " + code + ": " + resp.getContentText());
}

// Thử CHỈ cập nhật thời gian thu cho 1 lô đã có sẵn (PATCH có điều kiện
// so_lo=eq., không phải upsert) — nếu lô đó thật ra CHƯA tồn tại (0 dòng bị
// ảnh hưởng), trả về false để nơi gọi biết mà tạo mới đầy đủ, tránh vừa không
// đụng tới dữ liệu QC đã có, vừa không mất lô thật sự mới.
function tryUpdateThoiGianThu_(soLo, thoiGianThu, url, key) {
  var resp = UrlFetchApp.fetch(url + "/rest/v1/materials?so_lo=eq." + encodeURIComponent(soLo), {
    method: "patch",
    contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "return=representation" },
    payload: JSON.stringify({ thoi_gian_thu: thoiGianThu }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("mã lỗi " + code + " khi cập nhật " + soLo + ": " + resp.getContentText());
  var affected = JSON.parse(resp.getContentText() || "[]");
  return affected.length > 0;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function hasLabel_(thread, labelName) {
  return thread.getLabels().some(function (l) { return l.getName() === labelName; });
}

// Logic dùng chung, không phụ thuộc UI — dùng được cả khi chạy tay lẫn từ trigger.
function runThuBaoTuScan_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) {
    return { ok: false, message: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY trong Script Properties." };
  }

  var doneLabel = getOrCreateLabel_(THU_LABEL_DONE);
  var errorLabel = getOrCreateLabel_(THU_LABEL_ERROR);

  // KHÔNG loại nhãn "Đã quét" ra khỏi tìm kiếm (khác bản cũ) — Gmail chỉ gắn
  // nhãn được ở cấp CẢ THREAD, không phải từng mail riêng. Nếu 1 thread cũ đã
  // "Đã quét" mà sau đó có thêm mail GỐC mới (vd NCV gửi lại đúng chủ đề cũ nên
  // Gmail tự gộp chung 1 thread), loại theo nhãn sẽ bỏ sót mail mới đó mãi mãi.
  // Thay vào đó, bên dưới tự so số mail gốc đã xử lý lần trước (lưu trong Script
  // Properties) với số mail gốc hiện có trong thread để biết có gì mới không.
  // Vẫn loại nhãn "Lỗi" (định dạng lạ, thử lại không tự khác được, cần nhập tay)
  // và "Báo cáo" (mail do CHÍNH script gửi — chữ "Thu bào tử" trong đó có thể bị
  // bộ lọc Gmail của bạn tự gắn luôn nhãn "Thu bào tử", khiến script quét nhầm
  // báo cáo hôm trước thành mail mới rồi báo lỗi lặp lại mỗi ngày).
  var threads = GmailApp.search(
    'label:"' + THU_LABEL_NAME + '" -label:"' + THU_LABEL_ERROR + '" -label:"' + THU_LABEL_REPORT + '"', 0, 50);

  var mailCount = 0, bottleCount = 0, skippedReplyOnly = 0, failed = [], details = [];
  threads.forEach(function (thread) {
    try {
      // Chỉ lấy dữ liệu từ mail GỐC (Fwd/thông báo ban đầu) — bỏ hẳn mail "Re:"
      // (trả lời/thảo luận), không dùng để nhập liệu dù có tách được hay không.
      var sourceMessages = thread.getMessages().filter(function (m) { return !/^re:/i.test(m.getSubject()); });
      if (!sourceMessages.length) {
        // Cả thread chỉ toàn mail trả lời, không có mail gốc nào để lấy dữ liệu
        // — chuyển sang Lỗi để nhập tay, không tính vào failed[] (không phải lỗi
        // tạm thời, không cần thử lại).
        errorLabel.addToThread(thread);
        skippedReplyOnly++;
        return;
      }

      // Thread đã "Đã quét" từ lần trước VÀ số mail gốc không tăng thêm — không
      // có gì mới, bỏ qua (tránh quét lại vô ích mỗi ngày). Nếu số mail gốc tăng
      // (có mail mới thêm vào thread cũ) thì vẫn xử lý tiếp bên dưới dù đã "Đã
      // quét" — an toàn vì lô đã có sẵn chỉ được cập nhật thời gian thu, không
      // đụng tới pH/thể tích/kết quả QC đã nhập (xem tryUpdateThoiGianThu_).
      var countKey = "thuBaoTu_srcCount_" + thread.getId();
      var lastCount = parseInt(props.getProperty(countKey) || "0", 10);
      if (hasLabel_(thread, THU_LABEL_DONE) && sourceMessages.length <= lastCount) {
        return;
      }

      var rows = [];
      sourceMessages.forEach(function (message) {
        var parsed = parseThuBaoTuBody_(message.getPlainBody());
        if (parsed && parsed.length) rows = rows.concat(parsed);
      });

      // Bỏ trùng theo so_lo — 1 lô có thể xuất hiện 2 lần nếu có nhiều mail gốc
      // trong cùng thread, gửi trùng lên Supabase cùng 1 lần sẽ bị lỗi
      // "ON CONFLICT ... 2 lần".
      var seen = {}, dedup = [];
      rows.forEach(function (r) { if (!seen[r.so_lo]) { seen[r.so_lo] = true; dedup.push(r); } });
      rows = dedup;

      if (rows.length) {
        var newRows = [];
        rows.forEach(function (r) {
          // Thử cập nhật thời gian thu trước — nếu lô đã có sẵn trên web rồi thì
          // CHỈ thêm thời gian thu, không đụng tới pH/thể tích/cảm quan/ghi chú
          // NCV/QC có thể đã tự nhập khác đi. Nếu chưa có sẵn (chưa cập nhật
          // được dòng nào), coi là lô mới và tạo đầy đủ.
          var updated = r.thoi_gian_thu ? tryUpdateThoiGianThu_(r.so_lo, r.thoi_gian_thu, url, key) : false;
          if (!updated) newRows.push(r);
        });

        groupRowsByKeySignature_(newRows).forEach(function (group) { upsertMaterialRows_(group, url, key); });

        bottleCount += rows.length;
        mailCount++;
        doneLabel.addToThread(thread); // thành công
        props.setProperty(countKey, String(sourceMessages.length)); // nhớ đã xử lý tới đây, chỉ quét lại nếu có thêm mail gốc mới

        // Liệt kê chi tiết từng chai (số lô, thể tích, pH) để NCV kiểm tra ngay
        // trên email báo cáo, không cần mở web.
        details.push(
          thread.getFirstMessageSubject() + " (" + rows.length + " chai):\n" +
          rows.map(function (r) {
            return "  - " + r.so_lo + ": " + (r.v_dich != null ? r.v_dich + " L" : "thiếu thể tích") +
              ", pH " + (r.ph != null ? r.ph : "thiếu pH");
          }).join("\n")
        );
      } else {
        // Không tách được bảng dữ liệu (định dạng lạ) — không phải lỗi tạm thời,
        // thử lại cũng không tự khác đi được, nên chuyển thẳng sang Lỗi luôn.
        errorLabel.addToThread(thread);
        failed.push(thread.getFirstMessageSubject() + ": không nhận diện được bảng dữ liệu, cần nhập tay.");
      }
    } catch (err) {
      // Lỗi khi gọi Supabase (vd tạm thời mất kết nối) — CHỦ Ý KHÔNG gắn nhãn
      // Lỗi, để lần quét sau tự động thử lại (khác lỗi định dạng ở trên).
      failed.push(thread.getFirstMessageSubject() + ": " + err.message);
    }
  });

  return {
    ok: true,
    threadCount: threads.length,
    mailCount: mailCount,
    bottleCount: bottleCount,
    failed: failed,
    details: details,
    message: "Đã quét " + threads.length + " mail mới: " + mailCount + " mail đọc được (" + bottleCount + " chai)" +
      (skippedReplyOnly ? ", " + skippedReplyOnly + " mail chỉ là trả lời (chuyển vào Lỗi để nhập tay)" : "") +
      (failed.length ? ", " + failed.length + " mail lỗi/không nhận diện được, cần nhập tay." : "."),
  };
}

// Gửi email báo cáo và tự gắn nhãn "Thu bào tử/Báo cáo" NGAY LÚC GỬI (dùng
// createDraft().send() thay vì MailApp — lấy được thread ngay để gắn nhãn,
// không cần tìm lại bằng search nên không lo lệch/chậm/lẫn vào "Mới").
// toEmailOverride: dùng khi muốn gửi tới người khác ALERT_EMAIL (vd cảnh báo
// QC gửi riêng qua QC_ALERT_EMAIL, xem runQcPendingCheck_).
// htmlBody: nếu có, mail hiện dạng bảng HTML (body thường vẫn gửi kèm làm bản
// dự phòng cho những nơi không hiện được HTML).
function sendThuBaoTuReport_(subject, body, toEmailOverride, htmlBody) {
  var toEmail = toEmailOverride || PropertiesService.getScriptProperties().getProperty("ALERT_EMAIL") || Session.getActiveUser().getEmail();
  if (!toEmail) return;
  var reportLabel = getOrCreateLabel_(THU_LABEL_REPORT);
  var options = htmlBody ? { htmlBody: htmlBody } : {};
  var sent = GmailApp.createDraft(toEmail, subject, body, options).send();
  reportLabel.addToThread(sent.getThread());
}

// Chạy tay từ Apps Script editor (chọn hàm này > Run) để test, hoặc theo lịch
// tự động (setupThuBaoTuTrigger). Không có UI để hiện hộp thoại nên luôn gửi
// email tóm tắt kết quả tới ALERT_EMAIL (hoặc email tài khoản đang chạy script
// nếu chưa cấu hình ALERT_EMAIL) — mở email lên là biết ngay kết quả.
function scanThuBaoTu() {
  var result = runThuBaoTuScan_();
  var body = result.message +
    (result.details && result.details.length ? "\n\n" + result.details.join("\n\n") : "") +
    (result.failed && result.failed.length ? "\n\nMail cần nhập tay:\n" + result.failed.join("\n") : "");
  sendThuBaoTuReport_("[Pha chế sinh phẩm] Kết quả quét mail Thu bào tử", body);
  Logger.log(body);
}

// HÀM DEBUG #3 — tìm 1 mail "Re:" (loại vẫn báo "không nhận diện được") và in
// ra nội dung TỪNG message trong thread đó, để biết vì sao vẫn không tách được.
function debugThuBaoTuReply() {
  var threads = GmailApp.search('label:"' + THU_LABEL_NAME + '"', 0, 50);
  var target = null;
  for (var i = 0; i < threads.length; i++) {
    if (/^re:/i.test(threads[i].getFirstMessageSubject())) { target = threads[i]; break; }
  }
  if (!target) {
    Logger.log('Không tìm thấy mail "Re:" nào trong nhãn ' + THU_LABEL_NAME);
    return;
  }
  var msgs = target.getMessages();
  Logger.log("Thread có " + msgs.length + " message. Subject: " + target.getFirstMessageSubject());
  msgs.forEach(function (msg, i) {
    Logger.log("--- MESSAGE " + i + " SUBJECT: " + msg.getSubject() + " ---");
    Logger.log("--- MESSAGE " + i + " PLAIN BODY ---\n" + JSON.stringify(msg.getPlainBody()));
  });
}

// HÀM DEBUG TẠM THỜI — chạy 1 lần để xem Gmail thực sự trả về nội dung email
// dạng gì (giúp chỉnh lại logic tách bảng cho đúng). Sau khi xong việc debug
// có thể xoá hàm này đi, không ảnh hưởng các hàm khác.
function debugThuBaoTuRaw() {
  var threads = GmailApp.search('label:"' + THU_LABEL_NAME + '"', 0, 1);
  if (!threads.length) {
    Logger.log("Không tìm thấy mail nào có nhãn " + THU_LABEL_NAME);
    return;
  }
  var msg = threads[0].getMessages()[0];
  Logger.log("=== SUBJECT ===\n" + msg.getSubject());
  Logger.log("=== PLAIN BODY (raw, có ký tự đặc biệt hiện dạng \\t \\n) ===\n" + JSON.stringify(msg.getPlainBody()));
}

// HÀM DEBUG #2 — chạy thẳng bộ tách dữ liệu (parseThuBaoTuBody_) trên vài mail
// thật đang có nhãn "Thu bào tử" (bất kể đã "Đã xử lý" hay chưa) và in ra kết
// quả từng mail. Giúp biết chắc code mới đã chạy đúng chưa, tách biệt với
// chuyện nhãn "Đã xử lý" có lọc đúng hay không.
function debugThuBaoTuParse() {
  var threads = GmailApp.search('label:"' + THU_LABEL_NAME + '"', 0, 3);
  if (!threads.length) {
    Logger.log("Không tìm thấy mail nào có nhãn " + THU_LABEL_NAME);
    return;
  }
  threads.forEach(function (thread, i) {
    thread.getMessages().forEach(function (message) {
      var parsed = parseThuBaoTuBody_(message.getPlainBody());
      Logger.log("--- Mail " + i + ": " + thread.getFirstMessageSubject() + " ---");
      Logger.log(JSON.stringify(parsed));
    });
  });
}

/* ------------------------------------------------------------------ *
 * Hạn trả kết quả QC: QC_ALERT_DAYS ngày kể từ thời gian thu — quá hạn mà
 * vẫn chưa có kết quả nhiễm khuẩn (nhiem_khuan trống) thì gửi mail MỖI NGÀY
 * lúc 8h sáng (không phải 1 lần) tới khi QC nhập xong. Trên web: quá hạn thì
 * tô đỏ đậm, kèm ghi chú hạn trả KQ ngay tại ô nhập nhiễm khuẩn (xử lý ở phía
 * React, không liên quan tới phần gửi mail này).
 * ------------------------------------------------------------------ */

var QC_ALERT_DAYS = 15; // hạn trả KQ QC = 15 ngày kể từ thời gian thu (khớp với QC_DEADLINE_DAYS bên web)

function daysSinceIso_(isoDate) {
  var m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  var now = new Date();
  var startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfNow - d) / 86400000);
}

var QC_RED_DAYS = 20; // khớp QC_RED_DAYS bên web — quá mốc này tô đỏ trong bảng mail

function esc_(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

// Bảng HTML liệt kê đầy đủ các chai đang quá hạn, dàn cột giống hệt bảng NL
// trên web (Số lô, Thời gian thu, V dịch, Cảm quan, pH, MĐ nhãn, MĐ SH, Bào tử
// %) kèm tô đỏ/cam giống web, để QC nhìn quen mắt, không cần mở web mới hiểu.
function buildQcHtmlTable_(toAlert) {
  var headers = ["Số lô", "Thời gian thu", "V dịch (L)", "Cảm quan", "pH", "MĐ nhãn", "MĐ SH", "Bào tử %", "Nhiễm khuẩn", "Trạng thái"];
  var thead = "<tr>" + headers.map(function (h) {
    return '<th style="padding:8px 10px;border:1px solid #e2e8f0;background:#f8fafc;text-align:left;font-size:14px">' + h + "</th>";
  }).join("") + "</tr>";

  var rowsHtml = toAlert.map(function (x) {
    var m = x.m;
    var red = x.days >= QC_RED_DAYS;
    var bg = red ? "#fecaca" : "#ffffff";
    var badge = '<span style="padding:3px 10px;border-radius:999px;font-size:13px;font-weight:700;' +
      (red ? "background:#dc2626;color:#fff" : "background:#fef3c7;color:#92400e") + '">Quá hạn ' + x.days + "d</span>";
    var cell = function (v, alignRight) {
      return '<td style="padding:8px 10px;border:1px solid #e2e8f0;font-size:14px' + (alignRight ? ";text-align:right" : "") + '">' + esc_(v) + "</td>";
    };
    // Cột nhiễm khuẩn để trống — chính là trường đang thiếu, không cần ghi chú
    // thêm chữ gì, để trống là đủ nói lên vấn đề.
    var missingCell = '<td style="padding:8px 10px;border:1px solid #e2e8f0;font-size:14px"></td>';
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:8px 10px;border:1px solid #e2e8f0;font-size:14px;font-family:monospace">' + esc_(m.so_lo) + "</td>" +
      cell(m.thoi_gian_thu) + cell(m.v_dich, true) + cell(m.cam_quan) + cell(m.ph, true) +
      cell(m.md_nhan, true) + cell(m.md_sh, true) + cell(m.ty_le_bao_tu, true) +
      missingCell +
      '<td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center">' + badge + "</td>" +
      "</tr>";
  }).join("");

  return '<table style="border-collapse:collapse;font-family:Arial,sans-serif">' +
    "<thead>" + thead + "</thead><tbody>" + rowsHtml + "</tbody></table>";
}

// Logic dùng chung, không phụ thuộc UI. Mỗi lần chạy liệt kê ĐẦY ĐỦ toàn bộ
// chai đang quá hạn (giống hệt trạng thái trên web tại thời điểm đó) — không
// lọc bớt theo "đã báo hôm qua chưa", nên chạy tay nhiều lần trong ngày để
// test cũng luôn ra đúng danh sách đầy đủ.
function runQcPendingCheck_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) {
    return { ok: false, message: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY trong Script Properties." };
  }

  // Lấy hết NL còn hoạt động (chưa xoá, chưa pha, có thời gian thu), rồi TỰ lọc
  // "chưa QC" bằng code — y hệt cách web đang xét (trim rỗng = chưa QC) — thay
  // vì nhờ Supabase lọc, để tránh lệch nhau vì NULL/chuỗi rỗng/khoảng trắng.
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?pending_delete=eq.false&da_pha=eq.false&thoi_gian_thu=not.is.null" +
      "&select=id,so_lo,ten_nl,strain,lo,chai,thoi_gian_thu,v_dich,cam_quan,ph,md_nhan,md_sh,ty_le_bao_tu,nhiem_khuan",
    { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() >= 300) {
    return { ok: false, message: "Lỗi khi lấy dữ liệu NL: " + resp.getContentText() };
  }
  var allMaterials = JSON.parse(resp.getContentText());
  var materials = allMaterials.filter(function (m) { return !String(m.nhiem_khuan || "").trim(); });

  var toAlert = materials
    .map(function (m) { return { m: m, days: daysSinceIso_(m.thoi_gian_thu) }; })
    .filter(function (x) { return x.days != null && x.days >= QC_ALERT_DAYS; });

  if (!toAlert.length) {
    return { ok: true, count: 0, message: "Không có chai nào quá hạn " + QC_ALERT_DAYS + " ngày chưa nhập kết quả QC." };
  }

  toAlert.sort(function (a, b) { return b.days - a.days; });
  var lines = toAlert.map(function (x) {
    var m = x.m;
    return "- " + (m.strain === "clausii" ? "B. clausii" : "B. subtilis") + " · lô " + m.lo + " · chai " + m.chai +
      " (số lô: " + m.so_lo + ") — đã " + x.days + " ngày kể từ thu, chưa nhập kết quả QC.";
  });
  var webUrl = "https://qlsp.dtpduyetquytrinhsanxuat.io.vn/";
  var heading = "Danh sách chai NL đang quá hạn " + QC_ALERT_DAYS + " ngày kể từ thời gian thu vẫn chưa nhập kết quả kiểm nghiệm (" +
    toAlert.length + " chai)";
  var closingLine = "Hãy truy cập " + webUrl + " để nhập kết quả sớm nhất có thể nhé. Chúc bạn có một ngày làm việc vui vẻ ^_^";
  var body = heading + ":\n\n" + lines.join("\n") + "\n\n" + closingLine;
  // Viết thường "chưa" (chữ IN HOA có dấu đôi khi bị lỗi phông ở 1 số trình đọc
  // mail) — nhấn mạnh bằng màu đỏ + cỡ chữ to hơn thay vì viết hoa.
  var headingHtml = "Danh sách chai NL đang quá hạn " + QC_ALERT_DAYS + " ngày kể từ thời gian thu vẫn " +
    '<span style="color:#dc2626;font-size:1.15em">chưa</span>' +
    " nhập kết quả kiểm nghiệm (" + toAlert.length + " chai)";
  // Bọc chung 1 font-family ở ngoài cùng — nếu không khai báo, mỗi trình đọc
  // mail sẽ tự chọn phông khác nhau (có nơi ra chữ serif nhìn lỗi/lạ mắt).
  var htmlBody = '<div style="font-family:Arial,Helvetica,sans-serif">' +
    '<p style="font-size:20px;font-weight:800;color:#111827;margin-bottom:14px">' + headingHtml + "</p>" +
    buildQcHtmlTable_(toAlert) +
    '<p style="margin-top:18px;font-size:17px;font-weight:700;color:#b91c1c">Hãy truy cập ' +
    '<a href="' + webUrl + '" style="color:#2563eb">' + webUrl + '</a>' +
    ' để nhập kết quả sớm nhất có thể nhé. Chúc bạn có một ngày làm việc vui vẻ ^_^</p>' +
    "</div>";

  var qcEmail = props.getProperty("QC_ALERT_EMAIL"); // để trống = gửi về ALERT_EMAIL như cũ (dùng khi test)
  sendThuBaoTuReport_("[Pha chế sinh phẩm] Cảnh báo: " + toAlert.length + " chai NL chưa đủ KQKN", body, qcEmail, htmlBody);

  return { ok: true, count: toAlert.length, message: "Đã gửi cảnh báo cho " + toAlert.length + " chai." };
}

// Chạy tay (chọn hàm, Run) để test.
function checkQcPending() {
  var result = runQcPendingCheck_();
  Logger.log(result.message);
}

// HÀM DEBUG — nếu số chai vẫn lệch so với web, chạy hàm này để xem chính xác
// đang rớt ở bước lọc nào (tổng số NL, số chưa QC, số đã quá hạn).
function debugQcPendingCount() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?pending_delete=eq.false&da_pha=eq.false&thoi_gian_thu=not.is.null" +
      "&select=id,so_lo,thoi_gian_thu,nhiem_khuan",
    { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true }
  );
  var all = JSON.parse(resp.getContentText());
  Logger.log("Tổng NL (chưa xoá, chưa pha, có thời gian thu): " + all.length);

  var chuaQc = all.filter(function (m) { return !String(m.nhiem_khuan || "").trim(); });
  Logger.log("Trong đó CHƯA có kết quả nhiễm khuẩn: " + chuaQc.length);

  var qua15 = chuaQc.filter(function (m) { return daysSinceIso_(m.thoi_gian_thu) >= QC_ALERT_DAYS; });
  Logger.log("Trong đó đã quá " + QC_ALERT_DAYS + " ngày: " + qua15.length);

  // In luôn từng dòng để đối chiếu trực tiếp với web.
  qua15.forEach(function (m) {
    Logger.log(m.so_lo + " — thời gian thu " + m.thoi_gian_thu + " — nhiễm khuẩn=\"" + m.nhiem_khuan + "\"");
  });
}

// Gọi từ trigger thời gian lúc 8h sáng (xem setupThuBaoTuTrigger) — không hiện
// hộp thoại, chỉ ghi log (giống cách checkExpiryAlertsScheduled đã làm).
function checkQcPendingScheduled() {
  var result = runQcPendingCheck_();
  Logger.log(result.message);
}

// Bật cả 2 lịch chạy tự động: quét mail Thu bào tử lúc 7h, kiểm tra QC chưa
// nhập kết quả lúc 8h (tách giờ khác nhau theo yêu cầu).
function setupThuBaoTuTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "scanThuBaoTu" || fn === "dailyThuBaoTuJob" || fn === "checkQcPendingScheduled") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("scanThuBaoTu").timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger("checkQcPendingScheduled").timeBased().everyDays(1).atHour(8).create();
  sendThuBaoTuReport_("[Pha chế sinh phẩm] Đã bật quét mail Thu bào tử tự động",
    'Từ nay script sẽ tự quét mail trong nhãn "' + THU_LABEL_NAME + '" lúc 7h sáng, và kiểm tra chai quá hạn ' +
    QC_ALERT_DAYS + ' ngày chưa nhập kết quả QC lúc 8h sáng (nhắc lại mỗi ngày tới khi nhập xong), kết quả sẽ gửi qua email này.');
}
