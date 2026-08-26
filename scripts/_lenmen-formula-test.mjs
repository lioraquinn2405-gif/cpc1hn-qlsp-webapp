// Test cho logic nghiệp vụ lên men:  node --test scripts/_lenmen-formula-test.mjs
//
// Ngoại lệ subtilis và công thức số ống là 2 chỗ sai thì hỏng dữ liệu QC thật, nên
// khoá lại bằng test ngay từ lúc port, trước khi dựng giao diện.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStrainName, computeQcConclusion, formatQcResult, chaiCountForScale,
  computeFinishedTubesFromDensity, isDensityEligible, sortBatchesNewestFirst,
} from "../src/lib/lenmenFormula.js";

const FORMULA = { bh1: { mult: 1000, d1: 5.2, d2: 4.5 }, g3: { mult: 1000, d1: 5.2, d2: 4.5 } };

test("canonicalStrainName gom được các cách viết khác nhau", () => {
  assert.equal(canonicalStrainName("Bacillus Clausii G3"), "Bacillus clausii G3");
  assert.equal(canonicalStrainName("Bacillus clausii G3-pilot"), "Bacillus clausii G3");
  assert.equal(canonicalStrainName("Bacillus subtilis BH1"), "Bacillus subtilis BH1");
  assert.equal(canonicalStrainName("Lactobacillus Paracasein"), "Lactobacillus");
  assert.equal(canonicalStrainName("Chủng lạ"), "Chủng lạ");
});

test("không có vị trí nhiễm nào thì ĐẠT", () => {
  assert.deepEqual(computeQcConclusion([]), { isInfected: false, contaminant: "Không nhiễm" });
});

test("NGOẠI LỆ: nhiễm subtilis đơn thuần vẫn ĐẠT", () => {
  const r = computeQcConclusion([
    { position: "Sau LM", detail: "Nhiễm subtilis" },
    { position: "Cô đặc", detail: "nhiễm Subtilis" },
  ]);
  assert.equal(r.isInfected, false);
  assert.equal(r.contaminant, "Bacillus subtilis (Đạt)");
});

test("nhiễm thứ khác thì CẢNH BÁO, kể cả khi có kèm subtilis", () => {
  const r = computeQcConclusion([
    { position: "Sau LM", detail: "Nhiễm subtilis" },
    { position: "Cô đặc", detail: "Gram (-)" },
  ]);
  assert.equal(r.isInfected, true);
  assert.equal(r.contaminant, "Gram (-)", "chỉ liệt kê tác nhân KHÔNG phải subtilis");
});

test("gộp trùng tác nhân, giữ nguyên thứ tự xuất hiện", () => {
  const r = computeQcConclusion([
    { position: "A", detail: "Gram (+)" },
    { position: "B", detail: "Gram (-)" },
    { position: "C", detail: "Gram (+)" },
  ]);
  assert.equal(r.contaminant, "Gram (+), Gram (-)");
});

test("formatQcResult giữ đúng định dạng chuỗi của app cũ", () => {
  assert.equal(
    formatQcResult(["Ống chủng"], [{ position: "Cô đặc", detail: "Gram (-)" }]),
    "Ống chủng: Không nhiễm; Cô đặc: Gram (-)"
  );
});

test("số chai lấy mẫu quy đổi theo cỡ lô, tối thiểu 1", () => {
  assert.equal(chaiCountForScale("1000L", 5), 5);
  assert.equal(chaiCountForScale("2000L", 5), 10);
  assert.equal(chaiCountForScale("250L", 5), 1);
  assert.equal(chaiCountForScale("", 5), 5, "không rõ cỡ lô thì dùng mặc định");
});

test("công thức số ống cộng dồn theo từng chai", () => {
  const rows = [
    { volume: "10", density_before: "350", density_after: "325" },
    { volume: "8", density_after: "300" },
  ];
  const expected = Math.round((325 * 10 * 1000) / 5.2 / 4.5 + (300 * 8 * 1000) / 5.2 / 4.5);
  assert.equal(computeFinishedTubesFromDensity("Bacillus subtilis BH1", rows, FORMULA), expected);
});

test("chai thiếu thể tích hoặc mật độ sau heat thì bị bỏ qua", () => {
  const rows = [
    { volume: "10", density_after: "325" },
    { volume: "", density_after: "300" },
    { volume: "8", density_after: "" },
  ];
  assert.equal(
    computeFinishedTubesFromDensity("Bacillus clausii G3", rows, FORMULA),
    Math.round((325 * 10 * 1000) / 5.2 / 4.5)
  );
});

test("chưa chai nào nhập đủ -> null (khác 0)", () => {
  assert.equal(computeFinishedTubesFromDensity("Bacillus subtilis BH1", [{ volume: "", density_after: "" }], FORMULA), null);
});

test("chủng không có công thức -> null", () => {
  assert.equal(
    computeFinishedTubesFromDensity("Bacillus coagulans", [{ volume: "10", density_after: "325" }], FORMULA),
    null
  );
});

test("định lượng chỉ áp dụng từ mốc cutoff trở đi", () => {
  assert.equal(isDensityEligible("5/2026", 5, 2026), true, "đúng tháng mốc");
  assert.equal(isDensityEligible("4/2026", 5, 2026), false);
  assert.equal(isDensityEligible("1/2027", 5, 2026), true, "năm sau thì luôn tính");
  assert.equal(isDensityEligible("12/2025", 5, 2026), false);
  assert.equal(isDensityEligible("", 5, 2026), false, "thiếu đợt SX thì không tính");
});

test("sắp xếp mới nhất lên đầu theo đợt SX rồi tới id", () => {
  const sorted = sortBatchesNewestFirst([
    { id: 1, productionBatch: "1/2026" },
    { id: 2, productionBatch: "12/2025" },
    { id: 3, productionBatch: "1/2026" },
  ]);
  assert.deepEqual(sorted.map((b) => b.id), [3, 1, 2]);
});
