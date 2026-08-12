// Logic nghiệp vụ thuần của "Cảnh báo lên men" — không đụng React, không đụng Supabase,
// để test được và để chỉ có MỘT nguồn sự thật.
//
// App cũ phải giữ đồng bộ tay 3 bản sao của luật kết luận QC (index.html, sync-sheet.js,
// prompt AI) và README của nó ghi rõ đây là chỗ dễ lệch nhất. Gộp sang đây thì mọi nơi
// (panel React, api/ai-lenmen-*.js) đều import từ file này.

/* ------------------------------ Chủng men ------------------------------ */

// Dữ liệu thật có rất nhiều cách viết/hoa-thường cho cùng một chủng
// ("Bacillus clausii G3", "Bacillus Clausii G3", "Bacillus clausii G3-pilot"...).
// Quy về một tên chuẩn để lọc/nhóm/áp công thức.
export function canonicalStrainName(rawMaterial) {
  const name = (rawMaterial || "").trim();
  const lower = name.toLowerCase();
  if (lower.includes("clausii g3")) return "Bacillus clausii G3";
  if (lower.includes("subtilis bh1")) return "Bacillus subtilis BH1";
  if (lower.includes("coagulans")) return "Bacillus coagulans";
  if (lower.includes("lactobacillus")) return "Lactobacillus";
  if (lower.includes("clausii g10")) return "Bacillus clausii G10";
  return name;
}

// "1000L" -> 1000, "" -> 0
export function parseScaleLiters(scaleStr) {
  const match = (scaleStr || "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

/* ---------------------------- Kết luận QC ---------------------------- */

/**
 * NGOẠI LỆ SUBTILIS — luật quan trọng nhất của hệ thống này:
 * nhiễm Bacillus subtilis ĐƠN THUẦN vẫn tính là ĐẠT (subtilis là chủng đang sản xuất,
 * lẫn sang là chuyện thường và không làm hỏng lô). Nhiễm bất kỳ thứ gì khác — kể cả khi
 * có kèm subtilis — thì CẢNH BÁO.
 *
 * @param {Array<{position: string, detail: string}>} failPositions vị trí phát hiện nhiễm
 * @returns {{isInfected: boolean, contaminant: string}}
 */
export function computeQcConclusion(failPositions) {
  const fails = failPositions || [];
  if (fails.length === 0) return { isInfected: false, contaminant: "Không nhiễm" };

  const nonSubtilis = fails.filter((f) => !/subtilis/i.test(f.detail || ""));
  if (nonSubtilis.length === 0) return { isInfected: false, contaminant: "Bacillus subtilis (Đạt)" };

  const summary = [...new Set(nonSubtilis.map((f) => f.detail))].join(", ");
  return { isInfected: true, contaminant: summary };
}

// Chuỗi "Vị trí: kết quả; Vị trí: kết quả" lưu ở cột qc_result — giữ nguyên định dạng
// của app cũ để lô cũ và lô mới đọc lên giống nhau.
export function formatQcResult(okPositions, failPositions) {
  return [
    ...(okPositions || []).map((p) => `${p}: Không nhiễm`),
    ...(failPositions || []).map((f) => `${f.position}: ${f.detail}`),
  ].join("; ");
}

/* -------------------------- Định lượng mật độ -------------------------- */

// Chỉ 2 chủng có công thức tự tính; chủng khác trả null và giữ cách ước lượng cũ.
export function densityFormulaForStrain(rawMaterial, formulaConfig) {
  const strain = canonicalStrainName(rawMaterial);
  if (strain === "Bacillus subtilis BH1") return formulaConfig.bh1;
  if (strain === "Bacillus clausii G3") return formulaConfig.g3;
  return null;
}

// Số chai lấy mẫu: lô 1000L lấy chaiPer1000L chai, cỡ khác quy đổi theo tỉ lệ (tối thiểu 1).
export function chaiCountForScale(scale, chaiPer1000L) {
  const liters = parseScaleLiters(scale);
  if (!liters) return chaiPer1000L;
  return Math.max(1, Math.round((liters / 1000) * chaiPer1000L));
}

/**
 * Số ống thành phẩm của lô = tổng theo từng chai của
 *   (mật độ sau heat × thể tích × hệ số nhân) ÷ d1 ÷ d2
 * mult/d1/d2 là hằng số theo chủng, admin sửa được trong Cài đặt.
 *
 * Trả null khi chủng không có công thức, hoặc chưa chai nào nhập đủ cả thể tích lẫn
 * mật độ sau heat — null nghĩa là "chưa tính được", khác hẳn với 0.
 */
export function computeFinishedTubesFromDensity(rawMaterial, rows, formulaConfig) {
  const formula = densityFormulaForStrain(rawMaterial, formulaConfig);
  if (!formula || !formula.mult || !formula.d1 || !formula.d2) return null;

  let total = 0;
  let hasValid = false;
  for (const r of rows || []) {
    const volume = parseFloat(r.volume);
    const densityAfter = parseFloat(r.density_after);
    if (!volume || !densityAfter) continue;
    total += (densityAfter * volume * formula.mult) / formula.d1 / formula.d2;
    hasValid = true;
  }
  return hasValid ? Math.round(total) : null;
}

/**
 * Định lượng chỉ áp dụng cho lô từ mốc cutoff trở đi — lô cũ hơn đã "Đã xử lý", để yên.
 * productionBatch dạng "m/yyyy".
 */
export function isDensityEligible(productionBatch, cutoffMonth, cutoffYear) {
  const parts = (productionBatch || "").split("/");
  const month = parseInt(parts[0], 10);
  const year = parseInt(parts[1], 10);
  if (!month || !year) return false;
  if (year !== cutoffYear) return year > cutoffYear;
  return month >= cutoffMonth;
}

/* ------------------------------ Sắp xếp ------------------------------ */

// Đợt sản xuất "m/yyyy" -> số so sánh được (yyyymm), mới nhất lên đầu.
export function productionBatchOrderKey(productionBatch) {
  const parts = (productionBatch || "").split("/");
  const month = parseInt(parts[0], 10) || 0;
  const year = parseInt(parts[1], 10) || 0;
  return year * 100 + month;
}

export function sortBatchesNewestFirst(batches) {
  return [...(batches || [])].sort(
    (a, b) =>
      productionBatchOrderKey(b.productionBatch) - productionBatchOrderKey(a.productionBatch) ||
      (b.id || 0) - (a.id || 0)
  );
}
