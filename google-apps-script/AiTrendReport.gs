/**
 * DỰ ÁN APPS SCRIPT ĐỘC LẬP — KHÔNG gắn vào Google Sheet nào cả, KHÔNG liên quan gì
 * tới việc đồng bộ dữ liệu hay bảo trì hàng ngày (2 việc đó nằm ở Code.gs và
 * DailyMaintenance.gs — 2 dự án riêng khác).
 * Cách tạo: script.google.com > New project > xoá code mẫu > dán TOÀN BỘ file này
 * vào > đặt tên project (vd "CPC1HN - Báo cáo AI").
 *
 * Việc: gửi báo cáo NL "Chờ xử lý" hàng tháng (ngày 30) kèm phân tích xu hướng bằng
 * AI (DeepSeek) — liệt kê từng lô đang chờ xử lý, biểu đồ nhiễm khuẩn theo tháng
 * (tự vẽ bằng code, không qua dịch vụ ngoài), và 1 đoạn phân tích/khuyến nghị do AI
 * viết dựa trên prompt cố định do NCV soạn.
 *
 * Trước khi chạy: Project Settings (icon bánh răng) > Script Properties > thêm:
 *   SUPABASE_URL         = https://xxxxxxxxxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY = service_role key (Project Settings > API trong Supabase)
 *   ALERT_EMAIL           = địa chỉ nhận báo cáo
 *   DEEPSEEK_API_KEY      = khoá API DeepSeek (thiếu khoá này báo cáo vẫn gửi được,
 *                           chỉ bỏ qua phần phân tích AI)
 *
 * Sau khi cấu hình xong: mở dropdown chọn hàm (cạnh nút "Chạy" ▷) ở trên cùng, chọn
 * "setupMonthlyPendingReportTrigger", bấm "Chạy" (Run) đúng 1 lần — script sẽ tự
 * đặt lịch gửi báo cáo ngày 30 hàng tháng, không cần làm lại.
 * Muốn chạy thử ngay xem có lỗi gì không: chọn "sendPendingProcessingReport" rồi
 * bấm "Chạy", xem kết quả ở "Nhật ký thực thi" (Execution log) hoặc chờ mail tới.
 */

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

/* ------------------------------------------------------------------ *
 * Báo cáo NL "Chờ xử lý" hàng tháng (ngày 30) + phân tích xu hướng AI
 * (DeepSeek). Logic phân loại "chờ xử lý" PORT Y HỆT từ classify() trong
 * src/App.jsx — sửa 1 bên thì phải soát lại bên kia, đừng để lệch.
 * ------------------------------------------------------------------ */

var PENDING_EXPIRY_MONTHS = 13;
var PENDING_DISPOSAL_MONTHS = 24;

// Trả về { isPending: bool, reasons: [string] } — isPending=true nghĩa là NL này
// thuộc "Chờ xử lý" (không tính "Đã huỷ" — quá 24 tháng thì loại khỏi báo cáo này).
function classifyPendingReason_(m) {
  var months = monthsSince_(m);
  var expired = months != null && months >= PENDING_EXPIRY_MONTHS;
  var disposed = months != null && months >= PENDING_DISPOSAL_MONTHS;
  var reasons = [];
  if (expired) reasons.push("Hết hạn dùng (quá " + PENDING_EXPIRY_MONTHS + " tháng kể từ đợt SX)");

  var nk = norm_(m.nhiem_khuan);
  var hasSub = /sub/.test(norm_(m.nhiem_con_nao));
  var isFail = nk.indexOf("khong") !== -1;
  var isPass = !isFail && nk.indexOf("dat") !== -1;

  if (!nk) {
    // Chưa có kết quả nhiễm khuẩn: chỉ vào "chờ xử lý" nếu đã hết hạn khi chưa
    // kịp test (nếu không thì đang ở "chờ KQKN", không phải "chờ xử lý").
    if (reasons.length) return { isPending: !disposed, reasons: reasons };
    return { isPending: false, reasons: [] };
  }

  if (m.strain === "clausii") {
    // clausii nhiễm chéo subtilis (hasSub) được xếp "Loại 2", KHÔNG phải chờ xử lý.
    if (!isPass && !hasSub) {
      reasons.push("Không đạt kiểm nhiễm khuẩn" + (m.nhiem_con_nao ? " (nhiễm " + m.nhiem_con_nao + ")" : ""));
    }
  } else if (!isPass) {
    reasons.push("Không đạt kiểm nhiễm khuẩn"); // subtilis: KHÔNG kèm tên vi khuẩn, khớp đúng classify() trong App.jsx
  }

  if (!reasons.length) return { isPending: false, reasons: [] };
  return { isPending: !disposed, reasons: reasons };
}

// Giống classifyPendingReason_ nhưng KHÔNG loại "Đã huỷ" ra — dùng riêng cho biểu đồ xu
// hướng nhiễm khuẩn theo tháng (gộp cả Chờ xử lý + Đã huỷ để nhìn được xu hướng dài hơn,
// vì rất nhiều lô nhiễm khuẩn cuối cùng cũng bị đẩy tiếp sang Đã huỷ sau khi quá 24 tháng).
function classifyForTrend_(m) {
  var months = monthsSince_(m);
  var disposed = months != null && months >= PENDING_DISPOSAL_MONTHS;
  var expired = months != null && months >= PENDING_EXPIRY_MONTHS;

  var nk = norm_(m.nhiem_khuan);
  var hasSub = /sub/.test(norm_(m.nhiem_con_nao));
  var isFail = nk.indexOf("khong") !== -1;
  var isPass = !isFail && nk.indexOf("dat") !== -1;

  var isNhiemKhuan = false;
  if (nk) {
    isNhiemKhuan = (m.strain === "clausii") ? (!isPass && !hasSub) : !isPass;
  }
  if (!isNhiemKhuan && !expired) return { bucket: null };
  return { bucket: disposed ? "da-huy" : "cho-xu-ly", isNhiemKhuan: isNhiemKhuan, isQuaHan: expired };
}

function fetchTrendMaterials_(url, key) {
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?da_pha=eq.false&pending_delete=eq.false&select=*",
    { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() >= 300) throw new Error("Lỗi khi lấy dữ liệu NL (trend): " + resp.getContentText());
  var all = JSON.parse(resp.getContentText());
  var out = [];
  all.forEach(function (m) {
    var c = classifyForTrend_(m);
    if (c.bucket) out.push({ m: m, bucket: c.bucket, isNhiemKhuan: c.isNhiemKhuan, isQuaHan: c.isQuaHan, date: productionDate_(m) });
  });
  return out;
}

// Gộp số lô NHIỄM KHUẨN theo tháng (tăng dần theo thời gian, trái->phải cho biểu đồ dễ đọc),
// tách riêng subtilis/clausii để thấy chủng nào bị nhiễm nhiều ở giai đoạn nào.
function buildMonthlyNhiemKhuanSeries_(trendItems) {
  var byMonth = {};
  trendItems.forEach(function (x) {
    if (!x.isNhiemKhuan || !x.date) return;
    var key = x.date.getFullYear() + "-" + ("0" + (x.date.getMonth() + 1)).slice(-2);
    if (!byMonth[key]) byMonth[key] = { subtilis: 0, clausii: 0 };
    if (x.m.strain === "clausii") byMonth[key].clausii++; else byMonth[key].subtilis++;
  });
  var keys = Object.keys(byMonth).sort();
  return keys.map(function (k) {
    return { key: k, label: monthKeyLabel_(k).replace("Tháng ", ""), subtilis: byMonth[k].subtilis, clausii: byMonth[k].clausii };
  });
}

// Chuỗi text gọn — đưa cho AI đọc làm NGỮ CẢNH cho phần phân tích xu hướng viết bằng lời
// (câu hỏi 3 trong prompt gốc), KHÔNG nhờ AI vẽ biểu đồ nữa (đã thử 2 cách — Google Charts
// service và nhờ AI tự vẽ SVG — đều không ổn định/không ra đều đặn). Biểu đồ giờ do code tự
// vẽ thẳng (buildSvgChartHtml_), chắc chắn ra mỗi lần, không phụ thuộc dịch vụ ngoài hay AI.
function buildMonthlySeriesText_(series) {
  if (!series || !series.length) return "(Không có tháng nào có lô nhiễm khuẩn.)";
  return series.map(function (s) {
    return "Tháng " + s.label + ": B. subtilis " + s.subtilis + " lô, B. clausii " + s.clausii + " lô";
  }).join("\n");
}

// Dựng biểu đồ cột chồng (stacked) bằng Apps Script Charts service — trả về ẢNH PNG THẬT
// (Blob), không phải mã SVG. LÝ DO: đã thử vẽ <svg> thẳng trong email (cả code tự vẽ lẫn nhờ
// AI vẽ) — Gmail ÂM THẦM XOÁ mọi thẻ <svg> chèn trong HTML email vì lý do bảo mật (đã xác
// minh, đây là hành vi biết trước của Gmail, không phải lỗi code) — nên dù vẽ đúng cỡ nào,
// Gmail cũng không hiện. Ảnh PNG gắn qua inlineImages (cid:) thì Gmail hiển thị bình thường.
function buildTrendChartBlob_(series) {
  if (!series || series.length < 2) return null;
  var table = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, "Tháng")
    .addColumn(Charts.ColumnType.NUMBER, "B. subtilis")
    .addColumn(Charts.ColumnType.NUMBER, "B. clausii");
  series.forEach(function (s) { table.addRow([s.label, s.subtilis, s.clausii]); });
  var chart = Charts.newColumnChart()
    .setDataTable(table.build())
    .setTitle("Số lô nhiễm khuẩn theo tháng (gộp Chờ xử lý + Đã huỷ)")
    .setXAxisTitle("Tháng sản xuất")
    .setYAxisTitle("Số lô nhiễm khuẩn")
    .setColors(["#3b82f6", "#f97316"])
    .setDimensions(720, 360)
    .setStacked()
    .build();
  return chart.getBlob().setName("trend-chart.png");
}

// Tóm tắt gọn (không liệt kê từng lô, chỉ đếm theo tháng) các lô ĐÃ HUỶ vì nhiễm khuẩn —
// đưa thêm vào prompt AI để phân tích mùa vụ mà không làm phình bảng dữ liệu chính (vốn
// chỉ dành cho "Chờ xử lý" theo đúng prompt gốc của NCV).
function buildDaHuySummaryText_(trendItems) {
  var daHuyNK = trendItems.filter(function (x) { return x.bucket === "da-huy" && x.isNhiemKhuan; });
  if (!daHuyNK.length) return "(Không có lô Đã huỷ nào do nhiễm khuẩn.)";
  var series = buildMonthlyNhiemKhuanSeries_(daHuyNK);
  var lines = series.map(function (s) {
    return "Tháng " + s.label + ": subtilis " + s.subtilis + " lô, clausii " + s.clausii + " lô (đều do nhiễm khuẩn, đã quá 24 tháng nên chuyển Đã huỷ)";
  });
  return lines.join("\n");
}

function fetchPendingProcessingMaterials_(url, key) {
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/materials?da_pha=eq.false&pending_delete=eq.false&select=*",
    { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() >= 300) {
    throw new Error("Lỗi khi lấy dữ liệu NL: " + resp.getContentText());
  }
  var all = JSON.parse(resp.getContentText());
  var out = [];
  all.forEach(function (m) {
    var c = classifyPendingReason_(m);
    if (c.isPending) out.push({ m: m, reasons: c.reasons, date: productionDate_(m) });
  });
  return out;
}

// Nhóm theo tháng sản xuất (suy từ số lô/đợt SX), sắp THÁNG GẦN NHẤT lên đầu.
// Item không xác định được ngày (rất hiếm) gom vào nhóm "khong-xac-dinh" ở cuối.
function groupByMonthDesc_(items) {
  var groups = {};
  items.forEach(function (x) {
    var key = x.date ? (x.date.getFullYear() + "-" + ("0" + (x.date.getMonth() + 1)).slice(-2)) : "khong-xac-dinh";
    (groups[key] = groups[key] || []).push(x);
  });
  var keys = Object.keys(groups).filter(function (k) { return k !== "khong-xac-dinh"; }).sort().reverse();
  if (groups["khong-xac-dinh"]) keys.push("khong-xac-dinh");
  return keys.map(function (k) { return { key: k, items: groups[k] }; });
}
function monthKeyLabel_(key) {
  if (key === "khong-xac-dinh") return "Không xác định được ngày sản xuất";
  var parts = key.split("-");
  return "Tháng " + parseInt(parts[1], 10) + "/" + parts[0];
}
function fmtNum_(v, digits) {
  if (v == null || v === "" || isNaN(v)) return "–";
  return Number(v).toFixed(digits == null ? 2 : digits);
}
function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

var PENDING_ROW_COLS = [
  "Số lô", "Chủng", "Lô chủng", "V dịch (L)", "Cảm quan", "pH",
  "MĐ nhãn", "MĐ SH", "Bào tử %", "Nhiễm khuẩn", "Nhiễm con nào", "Lý do chờ xử lý", "Ghi chú",
];
function pendingRowCells_(x) {
  var m = x.m;
  return [
    m.so_lo, m.strain === "clausii" ? "B. clausii" : "B. subtilis", m.lo_chung || "–",
    fmtNum_(m.v_dich, 1), m.cam_quan || "–", fmtNum_(m.ph),
    fmtNum_(m.md_nhan, 2), fmtNum_(m.md_sh, 2), fmtNum_(m.ty_le_bao_tu, 1),
    m.nhiem_khuan || "–", m.nhiem_con_nao || "–", x.reasons.join("; "), m.ghi_chu || "",
  ];
}

function buildPendingReportHtml_(groups, total) {
  var thStyle = "border:1px solid #ddd;padding:4px 8px;background:#f1f5f9;text-align:left;white-space:nowrap;";
  var tdStyle = "border:1px solid #ddd;padding:4px 8px;";
  var html = "<div style=\"font-family:Arial,sans-serif;font-size:13px;color:#1e293b;\">";
  html += "<h2 style=\"margin:0 0 4px;\">Báo cáo Nguyên liệu \"Chờ xử lý\" — " + total + " chai</h2>";
  html += "<p style=\"color:#64748b;margin:0 0 16px;\">Xếp theo tháng sản xuất, tháng gần nhất lên đầu.</p>";
  groups.forEach(function (g) {
    html += "<h3 style=\"margin:20px 0 6px;\">" + escapeHtml_(monthKeyLabel_(g.key)) + " — " + g.items.length + " chai</h3>";
    html += "<table style=\"border-collapse:collapse;width:100%;margin-bottom:8px;\"><thead><tr>";
    PENDING_ROW_COLS.forEach(function (c) { html += "<th style=\"" + thStyle + "\">" + c + "</th>"; });
    html += "</tr></thead><tbody>";
    g.items.forEach(function (x) {
      html += "<tr>";
      pendingRowCells_(x).forEach(function (cell) { html += "<td style=\"" + tdStyle + "\">" + escapeHtml_(cell) + "</td>"; });
      html += "</tr>";
    });
    html += "</tbody></table>";
  });
  html += "</div>";
  return html;
}

// Bảng dữ liệu dạng text (pipe-delimited) để đưa vào prompt AI — không cần đẹp,
// chỉ cần AI đọc được đầy đủ, có cả cột "Thời gian thu" (ngày cụ thể nếu có, không
// thì tháng suy từ số lô) để AI tự tính tuổi lô đúng như yêu cầu trong prompt.
function buildPendingDataText_(groups) {
  var header = ["Số lô", "Thời gian thu", "Lô chủng", "V dịch (L)", "Cảm quan", "pH",
    "MĐ nhân", "MĐ SH", "Bào tử %", "Nhiễm khuẩn", "Nhiễm con nào", "Loại/Trạng thái", "Ghi chú"];
  var lines = [header.join(" | ")];
  groups.forEach(function (g) {
    g.items.forEach(function (x) {
      var m = x.m;
      var thoiGian = m.thoi_gian_thu ? m.thoi_gian_thu : (x.date ? monthKeyLabel_(g.key) : "?");
      lines.push([
        m.so_lo, thoiGian, m.lo_chung || "", fmtNum_(m.v_dich, 1), m.cam_quan || "",
        fmtNum_(m.ph), fmtNum_(m.md_nhan, 2), fmtNum_(m.md_sh, 2), fmtNum_(m.ty_le_bao_tu, 1),
        m.nhiem_khuan || "", m.nhiem_con_nao || "", x.reasons.join("; "), m.ghi_chu || "",
      ].join(" | "));
    });
  });
  return lines.join("\n");
}

// Prompt CỐ ĐỊNH do NCV soạn (2026-07-29) — chỉ thay phần [DỮ LIỆU] bằng bảng thật.
// KHÔNG tự ý sửa nội dung prompt này nếu chưa hỏi lại NCV.
function buildDeepSeekPrompt_(dataText, daHuySummaryText, monthlySeriesText) {
  return "VAI TRÒ: Bạn là chuyên viên kiểm soát chất lượng và nghiên cứu phát triển, \n" +
    "phân tích dữ liệu nguyên liệu bào tử probiotic (Bacillus clausii và \n" +
    "Bacillus subtilis) trong nhà máy đạt Thực hành sản xuất tốt.\n\n" +
    "BỐI CẢNH: Dưới đây là dữ liệu các lô nguyên liệu bị hệ thống chuyển vào \n" +
    "danh sách \"Chờ xử lý\". Mỗi dòng là một chai (ký hiệu C1, C2, C3...) tách ra \n" +
    "từ một lô mẹ. Tất cả lô trong danh sách này đều CHƯA được đem pha chế.\n\n" +
    "Một lô rơi vào danh sách \"Chờ xử lý\" vì một trong các lý do sau:\n" +
    "- Không đạt kiểm nghiệm: phần lớn là KHÔNG ĐẠT NHIỄM KHUẨN; đôi khi do \n" +
    "  chỉ tiêu khác.\n" +
    "- Quá hạn: đã lưu quá 13 tháng mà chưa đem pha chế.\n" +
    "- Bản ghi lỗi (dữ liệu rác): xem quy tắc bắt buộc bên dưới.\n\n" +
    "QUY TẮC BẮT BUỘC — LỌC DỮ LIỆU RÁC TRƯỚC TIÊN:\n" +
    "Trước khi phân tích bất cứ điều gì, hãy áp dụng quy tắc này cho từng lô:\n" +
    "NẾU lô đã quá 6 tháng kể từ ngày thu VÀ mọi kết quả kiểm nghiệm đều Đạt,\n" +
    "THÌ lô đó là bản ghi lỗi / dữ liệu rác — một lô đã đạt kiểm nghiệm không thể \n" +
    "để quá 6 tháng mà không đem pha chế, nên bản ghi này không phản ánh một \n" +
    "quyết định kiểm soát chất lượng thật.\n" +
    "=> Đưa các lô này vào một mục riêng tên \"Dữ liệu rác / bản ghi lỗi\", và \n" +
    "KHÔNG đưa chúng vào bất kỳ phép đếm, tính tỉ lệ, thống kê chỉ tiêu, hay \n" +
    "phân tích xu hướng nào ở các phần sau. Chỉ liệt kê để tôi rà soát và \n" +
    "làm sạch dữ liệu.\n\n" +
    "TỪ ĐIỂN CỘT (giữ nguyên tên cột theo hệ thống):\n" +
    "- Số lô: mã lô.\n" +
    "- Thời gian thu: ngày thu dịch (dùng để tính tuổi lô).\n" +
    "- Lô chủng: lô giống dùng để lên men.\n" +
    "- V dịch (L): thể tích dịch, tính bằng lít.\n" +
    "- Cảm quan: Đạt hoặc Không đạt.\n" +
    "- pH.\n" +
    "- MĐ nhân: tổng mật độ tế bào.\n" +
    "- MĐ SH: mật độ bào tử.\n" +
    "- Bào tử %: tỉ lệ bào tử, bằng MĐ SH chia cho MĐ nhân.\n" +
    "- Nhiễm khuẩn: Đạt hoặc Không đạt.\n" +
    "- Nhiễm con nào: tên vi sinh vật gây nhiễm (nếu có).\n" +
    "- Loại / Trạng thái: lý do lô bị chuyển vào danh sách (ví dụ: Quá hạn).\n\n" +
    "YÊU CẦU PHÂN TÍCH (thực hiện lần lượt, luôn kèm số liệu cụ thể):\n" +
    "1. Sau khi đã tách nhóm dữ liệu rác, phân loại từng lô CÒN LẠI theo lý do \n" +
    "   thật: Không đạt nhiễm khuẩn / Không đạt chỉ tiêu khác / Quá hạn. \n" +
    "   Đếm số lô và tính tỉ lệ phần trăm cho mỗi nhóm.\n" +
    "2. Tách riêng theo chủng (Bacillus clausii so với Bacillus subtilis) và \n" +
    "   theo lô mẹ; so sánh giữa chúng.\n" +
    "3. Phân tích xu hướng theo thời gian dựa trên ngày thu và mã lô: lý do nào \n" +
    "   tăng hay giảm theo từng tháng và năm? Chủng nào và chỉ tiêu nào hỏng \n" +
    "   nhiều nhất?\n" +
    "4. Thống kê từng chỉ tiêu (pH, MĐ nhân, MĐ SH, Bào tử %): giá trị nhỏ nhất, \n" +
    "   lớn nhất, trung bình; chỉ ra các lô bất thường. Kiểm tra mối tương quan, \n" +
    "   ví dụ: pH thấp hay bỏ trống có đi kèm với Bào tử % thấp hoặc nhiễm khuẩn \n" +
    "   hay không.\n" +
    "5. Với những trường hợp không thuộc nhóm rác nhưng vẫn nghi ngờ về chất \n" +
    "   lượng dữ liệu (ô để trống, giá trị vô lý, ngày sai định dạng), hãy liệt \n" +
    "   kê riêng và nêu rõ.\n" +
    "6. Đưa ra giả thuyết nguyên nhân gốc cho từng nhóm lý do thật (vì sao nhiều \n" +
    "   lô không đạt nhiễm khuẩn? vì sao có lô quá hạn?) kèm khuyến nghị hành \n" +
    "   động: cách xử lý các lô hiện tại, cách ngăn tái diễn, và cách làm sạch \n" +
    "   dữ liệu.\n\n" +
    "ĐẦU RA:\n" +
    "- Trước tiên: mục \"Dữ liệu rác / bản ghi lỗi\" (danh sách các lô bị loại, \n" +
    "  có ghi lý do loại), tách hẳn khỏi phần phân tích.\n" +
    "- Bảng tóm tắt cho các lô còn lại: Số lô | Chủng | Lý do | các chỉ tiêu \n" +
    "  chính | Ghi chú.\n" +
    "- Phần nhận định xu hướng (kèm số liệu, không nói chung chung).\n" +
    "- Phần khuyến nghị.\n" +
    "- Cuối cùng: nêu rõ những giả định đã dùng và những dữ liệu còn thiếu để \n" +
    "  phân tích sâu hơn.\n" +
    "Nếu dữ liệu chưa đủ để kết luận ở mục nào, hãy nói rõ thay vì suy đoán.\n\n" +
    "DỮ LIỆU:\n" + dataText +
    // Phần bổ sung THÊM VÀO SAU prompt gốc (không sửa 1 chữ nào ở trên) — cho câu hỏi
    // "xu hướng theo thời gian" (mục 3) có thêm dữ liệu lô ĐÃ HUỶ vì nhiễm khuẩn, để trả
    // lời được câu hỏi "giai đoạn/mùa nào trong năm hay bị nhiễm khuẩn hơn".
    (daHuySummaryText ? (
      "\n\nDỮ LIỆU BỔ SUNG — số lô ĐÃ HUỶ (quá 24 tháng) vì lý do nhiễm khuẩn, gộp theo " +
      "tháng sản xuất (không phải danh sách \"Chờ xử lý\" ở trên, đây là các lô đã bị đẩy " +
      "tiếp sang trạng thái Đã huỷ sau này). Dùng thêm dữ liệu này CHỈ để trả lời câu hỏi 3 " +
      "(xu hướng theo thời gian) cho kỹ hơn — cụ thể: có mẫu hình theo MÙA trong năm không " +
      "(vd mùa hè/mùa mưa dễ nhiễm hơn), không dùng cho các phép đếm/tỉ lệ ở câu 1, 2, 4 vì " +
      "đó là dữ liệu của danh sách Chờ xử lý riêng:\n" + daHuySummaryText
    ) : "") +
    // Số liệu theo tháng — chỉ để AI THAM KHẢO khi viết mục 3 (xu hướng thời gian) cho có
    // số liệu cụ thể, KHÔNG nhờ AI vẽ biểu đồ nữa (biểu đồ giờ do code tự vẽ, xem
    // buildSvgChartHtml_ — đã thử nhờ AI vẽ nhưng không ra đều đặn mỗi lần chạy).
    "\n\nSỐ LIỆU THAM KHẢO THEO THÁNG (số lô nhiễm khuẩn, gộp Chờ xử lý + Đã huỷ, đã tính sẵn " +
    "— dùng số liệu này khi viết mục 3 xu hướng thời gian cho cụ thể, không cần vẽ gì cả):\n" +
    monthlySeriesText +
    // Yêu cầu TÓM TẮT — thêm SAU CÙNG, tách biệt hoàn toàn khỏi prompt gốc của NCV.
    "\n\nYÊU CẦU THÊM (ngoài 6 yêu cầu phân tích ở trên): viết 1 đoạn TÓM TẮT ngắn gọn kiểu " +
    "abstract bài báo khoa học (3-5 câu, đi thẳng vào số liệu và kết luận quan trọng nhất — vd " +
    "tổng bao nhiêu lô, lý do chính là gì, giai đoạn/mùa nào đáng chú ý nhất, khuyến nghị cấp " +
    "bách nhất) — để đọc lướt là hiểu ngay không cần đọc hết phần phân tích dài bên dưới. Đặt " +
    "đoạn này NGAY ĐẦU CÂU TRẢ LỜI, bọc chính xác giữa 2 dòng đánh dấu sau (giữ nguyên cú pháp, " +
    "không thêm ký tự nào khác trên 2 dòng đó):\n" +
    "<<<TOMTAT>>>\n(đoạn tóm tắt ở đây)\n<<<HETTOMTAT>>>\n" +
    "Sau dòng <<<HETTOMTAT>>> mới bắt đầu phần \"Dữ liệu rác / bản ghi lỗi\" như yêu cầu ở trên.";
}

function callDeepSeekAnalysis_(dataText, daHuySummaryText, monthlySeriesText) {
  var key = PropertiesService.getScriptProperties().getProperty("DEEPSEEK_API_KEY");
  if (!key) return "(Chưa cấu hình DEEPSEEK_API_KEY trong Script Properties nên bỏ qua phần phân tích AI.)";

  var resp = UrlFetchApp.fetch("https://api.deepseek.com/chat/completions", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    payload: JSON.stringify({
      // deepseek-chat/deepseek-reasoner bị khai tử 2026-07-24, đổi sang dòng v4. Bật "thinking"
      // để có suy luận sâu (cần cho phân tích tương quan/xu hướng) — chỉ đổi model name KHÔNG
      // đủ, phải bật thêm cờ này (nếu không sẽ âm thầm chạy chế độ không suy luận).
      // max_tokens 8000 THỰC TẾ bị lỗi (2026-07-30): model "nghĩ" (thinking) chiếm hết token,
      // không còn chỗ viết câu trả lời -> content rỗng dù không báo lỗi gì. Nâng hẳn lên 60000
      // (không tốn thêm phí nếu không dùng hết, chỉ là trần tối đa) để chắc chắn đủ chỗ.
      model: "deepseek-v4-pro",
      messages: [
        // system message chỉ hướng dẫn CÁCH TRÌNH BÀY, không đụng nội dung yêu cầu phân
        // tích (prompt gốc của NCV ở message "user" giữ nguyên 100%, không sửa).
        { role: "system", content: "Khi trả lời có bảng, LUÔN viết đúng cú pháp bảng Markdown chuẩn " +
          "(dòng tiêu đề, rồi 1 dòng phân cách dạng |---|---|---|, rồi các dòng dữ liệu) — email sẽ " +
          "tự động chuyển bảng Markdown thành bảng HTML đẹp, nên đừng bỏ dòng phân cách." },
        { role: "user", content: buildDeepSeekPrompt_(dataText, daHuySummaryText, monthlySeriesText) },
      ],
      temperature: 0.3,
      max_tokens: 60000,
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    return "(Lỗi khi gọi DeepSeek — mã " + resp.getResponseCode() + ": " + resp.getContentText() + ")";
  }
  var json = JSON.parse(resp.getContentText());
  var choice = json.choices && json.choices[0];
  var content = choice && choice.message && choice.message.content;
  if (content) return content;

  // content rỗng — chẩn đoán rõ lý do thay vì im lặng để lần sau dễ sửa.
  if (choice && choice.finish_reason === "length") {
    return "(AI bị dừng giữa chừng vì hết giới hạn token (max_tokens) trước khi kịp viết câu trả lời — " +
      "thường do phần \"suy luận\" (thinking) chiếm hết chỗ. Cần tăng thêm max_tokens trong code.)";
  }
  return "(DeepSeek trả về nhưng không đọc được nội dung phân tích. Phản hồi thô: " +
    resp.getContentText().slice(0, 500) + ")";
}

// Xử lý **đậm** trong 1 dòng (sau khi đã escape HTML) -> <b>đậm</b>.
function mdInline_(escapedLine) {
  return escapedLine.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
// Có phải dòng bảng Markdown "| a | b | c |" không (bỏ qua dòng phân cách |---|---|).
function isTableRow_(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}
function isTableSepRow_(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.indexOf("-") !== -1;
}
function splitTableCells_(line) {
  var t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map(function (c) { return c.trim(); });
}

// Chuyển text phân tích AI (Markdown DeepSeek trả về) thành HTML có bảng/tiêu đề/chữ
// đậm/danh sách thật, thay vì hiện nguyên ký tự "|", "##", "**" rối mắt. Chỉ xử lý đúng
// các cú pháp Markdown DeepSeek hay dùng cho báo cáo dạng này (bảng, heading, đậm, gạch
// đầu dòng, --- ) — không cần bao quát 100% chuẩn Markdown.
function analysisTextToHtml_(text) {
  var lines = String(text || "").split("\n");
  var html = "";
  var i = 0;
  var inList = false;
  var thStyle = "border:1px solid #ddd;padding:4px 8px;background:#f1f5f9;text-align:left;";
  var tdStyle = "border:1px solid #ddd;padding:4px 8px;vertical-align:top;";

  function closeList() { if (inList) { html += "</ul>"; inList = false; } }

  while (i < lines.length) {
    var raw = lines[i];
    var line = raw.trim();

    if (!line) { closeList(); i++; continue; }

    // Bảng: dòng |...| theo sau bởi dòng phân cách |---|---|
    if (isTableRow_(line) && i + 1 < lines.length && isTableSepRow_(lines[i + 1].trim())) {
      closeList();
      var header = splitTableCells_(line);
      html += "<table style=\"border-collapse:collapse;width:100%;margin:10px 0;font-size:12px;\"><thead><tr>";
      header.forEach(function (c) { html += "<th style=\"" + thStyle + "\">" + mdInline_(escapeHtml_(c)) + "</th>"; });
      html += "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && isTableRow_(lines[i].trim())) {
        var cells = splitTableCells_(lines[i].trim());
        html += "<tr>";
        cells.forEach(function (c) { html += "<td style=\"" + tdStyle + "\">" + mdInline_(escapeHtml_(c)) + "</td>"; });
        html += "</tr>";
        i++;
      }
      html += "</tbody></table>";
      continue;
    }

    // Heading ###/##/#
    var hMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      closeList();
      var level = Math.min(hMatch[1].length + 1, 5); // # -> h2, ## -> h3, ...(giữ nhỏ hơn h1 tiêu đề mail)
      html += "<h" + level + " style=\"margin:16px 0 6px;\">" + mdInline_(escapeHtml_(hMatch[2])) + "</h" + level + ">";
      i++; continue;
    }

    // Gạch ngang rời (không phải dòng phân cách bảng)
    if (/^-{3,}$/.test(line)) {
      closeList();
      html += "<hr style=\"margin:16px 0;border:none;border-top:1px solid #ddd;\">";
      i++; continue;
    }

    // Gạch đầu dòng
    var liMatch = line.match(/^[-*]\s+(.*)$/);
    if (liMatch) {
      if (!inList) { html += "<ul style=\"margin:6px 0;padding-left:20px;\">"; inList = true; }
      html += "<li>" + mdInline_(escapeHtml_(liMatch[1])) + "</li>";
      i++; continue;
    }

    // Đoạn văn thường
    closeList();
    html += "<p style=\"margin:6px 0;\">" + mdInline_(escapeHtml_(line)) + "</p>";
    i++;
  }
  closeList();
  return "<div style=\"font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#1e293b;\">" + html + "</div>";
}

function runPendingProcessingReport_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var toEmail = props.getProperty("ALERT_EMAIL");
  if (!url || !key || !toEmail) {
    return { ok: false, message: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY / ALERT_EMAIL trong Script Properties." };
  }

  var items = fetchPendingProcessingMaterials_(url, key);
  var groups = groupByMonthDesc_(items);
  var listHtml = buildPendingReportHtml_(groups, items.length);
  var dataText = buildPendingDataText_(groups);

  // Gộp thêm dữ liệu "Đã huỷ" (chỉ dùng cho biểu đồ + phần bổ sung cho AI, KHÔNG liệt kê
  // từng lô vào bảng chính — bảng chính vẫn đúng đúng phạm vi "Chờ xử lý" như prompt gốc).
  var trendItems = fetchTrendMaterials_(url, key);
  var series = buildMonthlyNhiemKhuanSeries_(trendItems);
  var daHuySummaryText = buildDaHuySummaryText_(trendItems);

  var monthlySeriesText = buildMonthlySeriesText_(series);

  // Bọc try/catch riêng cho phần biểu đồ: lỗi ở đây (nếu có) KHÔNG được làm hỏng cả email
  // (list + AI vẫn phải gửi được), nhưng phải HIỆN RÕ lý do lỗi trong email thay vì im
  // lặng biến mất.
  var chartBlob = null;
  var chartErrorMsg = "";
  try {
    if (!series || series.length < 2) {
      chartErrorMsg = "(Không đủ dữ liệu để vẽ biểu đồ — cần ít nhất 2 tháng có lô nhiễm khuẩn. Số tháng hiện có: " + (series ? series.length : 0) + ")";
    } else {
      chartBlob = buildTrendChartBlob_(series);
      if (!chartBlob) chartErrorMsg = "(buildTrendChartBlob_ trả về rỗng dù đủ dữ liệu — lỗi không xác định.)";
    }
  } catch (e) {
    chartErrorMsg = "(Lỗi khi vẽ biểu đồ: " + e.message + ")";
  }

  var rawAnalysis = callDeepSeekAnalysis_(dataText, daHuySummaryText, monthlySeriesText);
  var extracted = extractSummary_(rawAnalysis);
  var analysisHtml = analysisTextToHtml_(extracted.rest);

  var summaryHtml = "";
  if (extracted.summary) {
    summaryHtml = "<div style=\"background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;" +
      "padding:16px 20px;margin:0 0 20px;font-family:Arial,sans-serif;\">" +
      "<div style=\"font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#92400e;" +
      "font-weight:bold;margin-bottom:6px;\">Tóm tắt nhanh</div>" +
      "<div style=\"font-size:16px;font-weight:bold;color:#78350f;line-height:1.5;\">" +
      mdInline_(escapeHtml_(extracted.summary)) + "</div></div>";
  }

  var chartHtml = "<h2 style=\"font-family:Arial,sans-serif;\">Xu hướng nhiễm khuẩn theo tháng</h2>";
  var inlineImages = {};
  if (chartBlob) {
    chartHtml += "<img src=\"cid:trendChart\" style=\"max-width:100%;\">";
    inlineImages.trendChart = chartBlob;
  } else {
    chartHtml += "<p style=\"font-family:Arial,sans-serif;font-size:12px;color:#dc2626;\">" + escapeHtml_(chartErrorMsg) + "</p>";
  }

  var fullHtml = summaryHtml + listHtml +
    "<hr style=\"margin:24px 0;border:none;border-top:1px solid #ddd;\">" +
    chartHtml +
    "<hr style=\"margin:24px 0;border:none;border-top:1px solid #ddd;\">" +
    "<h2 style=\"font-family:Arial,sans-serif;\">Phân tích xu hướng (AI)</h2>" +
    analysisHtml;

  var subject = "[Pha chế sinh phẩm] Báo cáo NL Chờ xử lý — " + items.length + " chai (" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/yyyy") + ")";
  var mailOptions = { htmlBody: fullHtml };
  if (chartBlob) mailOptions.inlineImages = inlineImages;
  MailApp.sendEmail(toEmail, subject, "Email này cần xem ở dạng HTML.", mailOptions);

  return { ok: true, count: items.length, message: "Đã gửi báo cáo NL Chờ xử lý (" + items.length + " chai) tới " + toEmail + "." };
}

// Tách phần "TÓM TẮT" (được AI bọc giữa 2 dòng đánh dấu theo yêu cầu trong prompt) ra khỏi
// phần còn lại — nếu AI lỡ không tuân theo đúng định dạng (không có gì đảm bảo 100%), summary
// sẽ rỗng và toàn bộ text vẫn hiện bình thường ở phần phân tích, không mất dữ liệu.
function extractSummary_(text) {
  var s = String(text || "");
  var m = s.match(/<<<TOMTAT>>>([\s\S]*?)<<<HETTOMTAT>>>/);
  if (!m) return { summary: "", rest: s };
  return { summary: m[1].trim(), rest: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim() };
}

// Chạy thử thủ công — chọn hàm này trong dropdown rồi bấm "Chạy". Gửi luôn báo cáo thật
// (không phải chế độ xem trước) — dùng khi muốn xem báo cáo ngay mà không đợi tới ngày 30.
function sendPendingProcessingReport() {
  var result = runPendingProcessingReport_();
  notify_(result.message);
}

// Gọi từ trigger thời gian (chạy nền ngày 30 hàng tháng) — không hiện hộp thoại.
function sendPendingProcessingReportScheduled() {
  var result = runPendingProcessingReport_();
  Logger.log(result.message);
}

// Chỉ cần chạy 1 LẦN DUY NHẤT (chọn hàm này rồi bấm "Chạy") để đặt lịch — sau đó báo
// cáo tự gửi vào ngày 30 hàng tháng lúc 8h sáng, không cần làm lại.
function setupMonthlyPendingReportTrigger() {
  ScriptTriggers_removeExisting_("sendPendingProcessingReportScheduled");
  ScriptApp.newTrigger("sendPendingProcessingReportScheduled").timeBased().onMonthDay(30).atHour(8).create();
  notify_(
    "Đã đặt lịch gửi báo cáo NL Chờ xử lý + phân tích AI vào ngày 30 hàng tháng lúc 8h sáng. " +
    "(Tháng 2 không có ngày 30 — Google sẽ tự chạy vào ngày cuối cùng của tháng đó thay thế.)"
  );
}
