// Đối soát logic đã port với dữ liệu thật của hệ thống cũ:
//
//   node scripts/_lenmen-parity-check.mjs lenmen-export.json
//
// Với mỗi lô có qc_details, tính lại kết luận QC bằng src/lib/lenmenFormula.js rồi so với
// is_infected/contaminant mà app Node cũ đã lưu. Lệch = logic port sai, phải sửa TRƯỚC khi
// cutover. Chạy lại lần nữa ngay trước khi tắt hệ cũ để chắc dữ liệu phát sinh thêm vẫn khớp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeQcConclusion } from "../src/lib/lenmenFormula.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = process.argv[2];
if (!src) {
  console.error("Cách dùng: node scripts/_lenmen-parity-check.mjs <lenmen-export.json>");
  console.error("(xuất JSON từ data.db — xem hướng dẫn trong scripts/import-lenmen.mjs)");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", src), "utf8"));

let checked = 0, noDetails = 0, badJson = 0;
let mismatchInfected = 0, mismatchContaminant = 0;
const samples = [];

for (const b of data.batches || []) {
  if (!b.qc_details) { noDetails++; continue; }
  let details;
  try { details = JSON.parse(b.qc_details); } catch { badJson++; continue; }
  if (!details || !Array.isArray(details.fail)) { badJson++; continue; }

  checked++;
  const got = computeQcConclusion(details.fail);
  const oldInfected = !!b.is_infected;

  if (got.isInfected !== oldInfected) {
    mismatchInfected++;
    if (samples.length < 10) {
      samples.push({ lo: b.lot_number, cu: oldInfected, moi: got.isInfected, fail: details.fail });
    }
  } else if ((got.contaminant || "") !== (b.contaminant || "")) {
    mismatchContaminant++;
    if (samples.length < 10) {
      samples.push({ lo: b.lot_number, tacNhanCu: b.contaminant, tacNhanMoi: got.contaminant });
    }
  }
}

console.log("Đã đối soát        :", checked, "lô");
// Lô cũ nhập trước khi có ô tích theo vị trí — kết luận nằm ở chuỗi qc_result, không tính lại được.
console.log("Chưa có qc_details :", noDetails, "lô (nhập trước khi có ô tích theo vị trí)");
if (badJson) console.log("qc_details hỏng    :", badJson, "lô");
console.log("Lệch Đạt/Nhiễm     :", mismatchInfected);
console.log("Lệch mô tả tác nhân:", mismatchContaminant);

if (samples.length) {
  console.log("\nVí dụ lệch:");
  for (const s of samples) console.log("  " + JSON.stringify(s));
}

const failed = mismatchInfected + mismatchContaminant;
console.log(failed === 0 ? "\n✓ Khớp hoàn toàn." : "\n✗ Có " + failed + " lô lệch — sửa logic trước khi cutover.");
process.exitCode = failed === 0 ? 0 : 1;
