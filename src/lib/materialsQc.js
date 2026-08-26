// Logic kết luận QC + suy ngày sản xuất của 1 chai NL — tách từ App.jsx để dùng chung cho cả
// "Xu hướng NL" (NLTrendPanel.jsx) và "Đối chiếu NL" (LenMenOverview.jsx), tránh mỗi nơi tự
// mirror lại luật này (App.jsx vẫn dùng parseSoLoDate/parseDotSanXuat cho vài chỗ khác).

const DIACRITICS_RE = new RegExp(String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93), "g");
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "").replace(/đ/g, "d").trim();

/** Kết quả QC 1 chai NL. null = chưa có kết quả QC (bỏ qua khi thống kê).
 * "fail" = nhiễm khuẩn thật (sẽ đi Chờ xử lý/Đã huỷ). "pass_sub" = nhiễm chéo subtilis
 * (chỉ clausii, tự Loại 2, KHÔNG phải chờ xử lý) — vẫn là 1 dạng nhiễm đáng theo dõi riêng
 * nhưng KHÔNG tính vào "fail" vì không bị huỷ/chờ xử lý. */
export function nkOutcome(rec) {
  const nk = norm(rec.nhiemKhuan);
  if (!nk) return null;
  const isFail = nk.includes("khong");
  const legacySubPattern = isFail && /sub/.test(norm(rec.nhiemConNao));
  const isPassSub = rec.strain === "clausii" && ((!isFail && nk.includes("dat") && nk.includes("sub")) || legacySubPattern);
  if (isFail && !isPassSub) return "fail";
  if (isPassSub) return "pass_sub";
  return "pass";
}

// "26G05SA1.C1" -> "26G05SA1" — mã lô NL luôn là mã lô lên men + ".C{số chai}".
export function baseLotNumber(soLo) {
  const s = String(soLo || "").trim();
  const i = s.indexOf(".");
  return i === -1 ? s : s.slice(0, i);
}

/* ---------- Suy ngày sản xuất từ số lô / cột "Đợt SX" ---------- */

export function parseDotSanXuat(s) {
  const str = String(s || "").trim();
  let m = str.match(/^(\d{1,2})\/(\d{2,4})$/); // M/YY hoặc M/YYYY
  if (m) {
    const month = parseInt(m[1], 10);
    let year = parseInt(m[2], 10);
    if (year < 100) year += 2000;
    return month >= 1 && month <= 12 ? new Date(year, month - 1, 1) : null;
  }
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // D/M/YY hoặc D/M/YYYY
  if (m) {
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return month >= 1 && month <= 12 ? new Date(year, month - 1, 1) : null;
  }
  return null;
}
export function parseSoLoDate(soLo) {
  const s = String(soLo || "").trim();
  // Dạng phổ biến: ddMMyy... ở đầu số lô (vd "010126SF1.C1" = 01/01/26)
  let m = s.match(/^(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const month = parseInt(m[2], 10), year = 2000 + parseInt(m[3], 10);
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
  }
  // Dạng mới từ 2026: yy + chữ cái tháng (A=1/2026 ... L=12) + số thứ tự (vd "26F01SA1" = 6/2026)
  m = s.match(/^(\d{2})([A-La-l])\d/);
  if (m) {
    const year = 2000 + parseInt(m[1], 10);
    const month = m[2].toUpperCase().charCodeAt(0) - 64;
    return new Date(year, month - 1, 1);
  }
  return null;
}
// Số lô luôn mã hoá ngày sản xuất ở đầu và không bao giờ trống, đáng tin hơn cột
// "Đợt SX" nhập tay (hay để trống hoặc ghi nhiều định dạng khác nhau) — ưu tiên đọc
// ngày từ số lô, chỉ dùng "Đợt SX" khi không tách được từ số lô.
export function productionDate(rec) {
  return parseSoLoDate(rec.soLo) || parseDotSanXuat(rec.dotSanXuat);
}

/* ---------- Thống kê xu hướng NL theo tháng (tab "Xu hướng NL") ---------- */

/** Gộp thống kê nhiễm khuẩn theo THÁNG SẢN XUẤT (productionDate — suy từ số lô, luôn có sẵn và
 * không đổi theo thời gian, khác "updatedAt" trước đây hay bị rỗng/trễ với dữ liệu cũ) — cho phép
 * trải dài đúng nhiều năm dữ liệu thật (kể cả lô từ 2023/2024), không chỉ năm hiện tại. Mỗi tháng
 * theo dõi CẢ 2 việc: (a) tiến độ nhập KQKN (đã nhập/còn tồn đọng — qcDone/qcPending trên tổng sản
 * lượng thật totalProduced), (b) trong số đã có KQ, tỉ lệ không đạt/nhiễm chéo/đạt. Trả về Map
 * "YYYY-MM" -> stats, sắp XƯA -> MỚI. */
export function computeNLTrendStats(materials) {
  const byMonth = new Map();
  for (const m of materials) {
    if (m.pendingDelete) continue; // đã xoá mềm (Thùng rác) — không tính vào sản lượng thật
    const pd = productionDate(m);
    if (!pd) continue;
    const mk = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(mk)) {
      byMonth.set(mk, {
        totalProduced: 0, qcDone: 0, qcPending: 0, fail: 0, passSub: 0, pass: 0,
        byStrain: { subtilis: { total: 0, fail: 0 }, clausii: { total: 0, fail: 0 } },
        byReason: {},
      });
    }
    const acc = byMonth.get(mk);
    acc.totalProduced++;
    const outcome = nkOutcome(m);
    if (outcome == null) { acc.qcPending++; continue; }
    acc.qcDone++;
    acc[outcome === "fail" ? "fail" : outcome === "pass_sub" ? "passSub" : "pass"]++;
    const strainKey = m.strain === "clausii" ? "clausii" : "subtilis";
    acc.byStrain[strainKey].total++;
    if (outcome === "fail") {
      acc.byStrain[strainKey].fail++;
      const reason = m.nhiemConNao || "Không rõ";
      acc.byReason[reason] = (acc.byReason[reason] || 0) + 1;
    }
  }
  return new Map([...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function monthLabelVN(mk) {
  const [y, m] = mk.split("-");
  return `Tháng ${parseInt(m, 10)}/${y}`;
}
