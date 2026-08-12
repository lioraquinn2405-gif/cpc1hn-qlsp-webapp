// Nhập dữ liệu "Cảnh báo lên men" từ SQLite (data.db của app Node cũ) lên Supabase.
//
//   node scripts/import-lenmen.mjs ../canhbaolenmen-handover/data.db
//   node scripts/import-lenmen.mjs lenmen-export.json      (đã xuất sẵn ra JSON)
//   node scripts/import-lenmen.mjs <nguồn> --dry-run       (chỉ đếm, không ghi)
//
// Chạy được nhiều lần: upsert theo lot_number (lô) và (week_start,row_key,day_index) (ô kế
// hoạch), nên nhập lại không nhân bản. Cần SUPABASE_SERVICE_KEY trong .env vì RLS chỉ cho
// tài khoản đã duyệt ghi, còn script này chạy ngoài phiên đăng nhập.
//
// LƯU Ý id: giữ nguyên id cũ để lenmen_khsx_plans.linked_batch_id trỏ đúng lô. Sau khi
// nhập xong phải chạy supabase/migration_lenmen_after_import.sql để đẩy sequence lên quá
// id lớn nhất, nếu không lần thêm lô mới đầu tiên trên web sẽ đụng khoá trùng.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// File này là ESM nên không có require sẵn — node:sqlite chỉ nạp khi thật sự cần
// (nguồn là .db), và phải nạp kiểu này để bắt được lỗi khi Node quá cũ.
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/* -------------------------------------------------------------------------- */
/* Đọc nguồn                                                                   */
/* -------------------------------------------------------------------------- */

// node:sqlite chỉ có từ Node 22.5 trở lên. App cũ đóng gói sẵn 1 bản node đủ mới trong
// node-bin/, nên nếu node ở đây quá cũ thì chỉ cần xuất JSON bằng bản đó rồi nhập lại.
function readFromSqlite(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    console.error(
      "Node hiện tại (" + process.version + ") chưa có node:sqlite.\n" +
      "Xuất JSON bằng bản node đi kèm app cũ rồi nhập lại:\n\n" +
      "  cd <thư-mục-canhbaolenmen-handover>\n" +
      "  ./node-bin/bin/node --experimental-sqlite -e \"\n" +
      "    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data.db');\n" +
      "    const q=(s)=>db.prepare(s).all();\n" +
      "    console.log(JSON.stringify({batches:q('select * from batches'),\n" +
      "      khsx:q('select * from khsx_plans'),settings:q('select * from settings')}));\n" +
      "  \" > lenmen-export.json\n\n" +
      "  node scripts/import-lenmen.mjs lenmen-export.json"
    );
    process.exit(1);
  }
  const db = new DatabaseSync(dbPath);
  const q = (s) => db.prepare(s).all();
  return { batches: q("select * from batches"), khsx: q("select * from khsx_plans"), settings: q("select * from settings") };
}

function readSource(src) {
  if (!fs.existsSync(src)) { console.error("Không thấy file: " + src); process.exit(1); }
  if (src.endsWith(".json")) return JSON.parse(fs.readFileSync(src, "utf8"));
  return readFromSqlite(src);
}

/* -------------------------------------------------------------------------- */
/* Chuyển đổi                                                                  */
/* -------------------------------------------------------------------------- */

const PREP_STATUS = new Set(["Chờ lên men", "Chờ pha", "Chờ hủy", "Đã xử lý"]);

// SQLite lưu "YYYY-MM-DD HH:MM:SS" theo giờ UTC (datetime('now')); thêm Z để Postgres
// không hiểu nhầm là giờ địa phương rồi lệch 7 tiếng.
function toTimestamp(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t) ? t.replace(" ", "T") + "Z" : t;
}

// qc_details/density_details là chuỗi JSON trong SQLite, cột jsonb bên Postgres cần object.
// Lô cũ có thể chứa chuỗi hỏng — bỏ qua thay vì làm hỏng cả lần nhập.
function toJson(v, label, lot, warnings) {
  if (v == null || v === "") return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    warnings.push("Lô " + lot + ": " + label + " không phải JSON hợp lệ, đã bỏ trống");
    return null;
  }
}

function mapBatch(r, warnings) {
  const status = (r.prep_status || "").trim();
  if (status && !PREP_STATUS.has(status)) {
    warnings.push("Lô " + r.lot_number + ": trạng thái lạ \"" + status + "\", đã để trống");
  }
  return {
    id: r.id,
    raw_material: r.raw_material || null,
    lot_number: String(r.lot_number || "").trim(),
    production_batch: r.production_batch || null,
    factory: r.factory || null,
    scale: r.scale || null,
    finished_tubes: Number.isFinite(Number(r.finished_tubes)) ? Number(r.finished_tubes) : null,
    qc_result: r.qc_result || null,
    is_infected: !!r.is_infected,
    contaminant: r.contaminant || null,
    notes: r.notes || null,
    qc_details: toJson(r.qc_details, "qc_details", r.lot_number, warnings),
    prep_status: PREP_STATUS.has(status) ? status : null,
    density_details: toJson(r.density_details, "density_details", r.lot_number, warnings),
    concentrate_system: r.concentrate_system || null,
    final_concentrate_status: r.final_concentrate_status || null,
    final_concentrate_detail: r.final_concentrate_detail || null,
    planned_time: r.planned_time || null,
    created_at: toTimestamp(r.created_at) || new Date().toISOString(),
  };
}

function mapKhsx(r) {
  return {
    week_start: r.week_start,
    row_key: r.row_key,
    day_index: Number(r.day_index),
    cell_type: r.cell_type === "fermentation" ? "fermentation" : "free_text",
    free_text: r.free_text || null,
    lot_number: r.lot_number || null,
    linked_batch_id: r.linked_batch_id ?? null,
  };
}

// Chỉ mang sang cài đặt đặc thù của lên men. Tài khoản/phân quyền đã có ở tab "Người dùng"
// của trang lớn nên bỏ; *_last_sent giữ lại để Apps Script không gửi trùng mail ngay sau
// khi chuyển. Khoá không nằm trong danh sách này sẽ bị bỏ qua và báo ra cuối.
const SETTING_KEYS = new Set([
  "density_cutoff_month", "density_cutoff_year", "density_chai_per_1000l",
  "density_unit_volume", "density_unit_density",
  "density_formula_bh1_mult", "density_formula_bh1_d1", "density_formula_bh1_d2",
  "density_formula_g3_mult", "density_formula_g3_d1", "density_formula_g3_d2",
  "reminder_email", "reminder_day", "reminder_hour", "reminder_last_sent",
  "weekly_emails", "weekly_day", "weekly_hour", "weekly_last_sent",
  "monthly_emails", "monthly_day", "monthly_hour", "monthly_last_sent",
  "khsx_emails",
]);

/* -------------------------------------------------------------------------- */

async function upsertAll(supabase, table, rows, onConflict, dryRun) {
  if (!rows.length) { console.log("  " + table + ": không có dòng nào"); return 0; }
  if (dryRun) { console.log("  " + table + ": " + rows.length + " dòng (dry-run, chưa ghi)"); return 0; }
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) { console.error("  " + table + " lỗi ở dòng " + i + ": " + error.message); process.exit(1); }
    done += chunk.length;
    process.stdout.write("  " + table + ": " + done + "/" + rows.length + "\r");
  }
  console.log("  " + table + ": " + done + "/" + rows.length + " ✓        ");
  return done;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const src = args.find((a) => !a.startsWith("--"));
  if (!src) { console.error("Cách dùng: node scripts/import-lenmen.mjs <data.db|export.json> [--dry-run]"); process.exit(1); }

  // --dry-run chỉ đọc và kiểm tra dữ liệu nguồn nên không cần .env — chạy được ngay
  // trên máy chưa cấu hình Supabase để soát trước khi đụng vào dữ liệu thật.
  let supabase = null;
  if (!dryRun) {
    const env = loadEnv();
    const url = env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_KEY;
    if (!url || !key) { console.error("Thiếu VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY trong .env"); process.exit(1); }
    // nạp động: --dry-run chạy được cả khi chưa npm install
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(url, key, { auth: { persistSession: false } });
  }

  const raw = readSource(src);
  const warnings = [];

  const seen = new Set();
  const batches = [];
  for (const r of raw.batches || []) {
    const row = mapBatch(r, warnings);
    if (!row.lot_number) { warnings.push("Bỏ 1 dòng không có mã lô (id " + r.id + ")"); continue; }
    if (seen.has(row.lot_number)) { warnings.push("Mã lô trùng trong nguồn: " + row.lot_number + " — chỉ giữ dòng đầu"); continue; }
    seen.add(row.lot_number);
    batches.push(row);
  }

  const khsx = (raw.khsx || []).map(mapKhsx).filter((r) => r.week_start && r.row_key && Number.isInteger(r.day_index));

  const skipped = [];
  const settings = [];
  for (const s of raw.settings || []) {
    if (SETTING_KEYS.has(s.key)) settings.push({ key: s.key, value: s.value == null ? null : String(s.value) });
    else skipped.push(s.key);
  }

  console.log("Nguồn: " + src + (dryRun ? "  (DRY RUN)" : ""));
  await upsertAll(supabase, "lenmen_batches", batches, "lot_number", dryRun);
  await upsertAll(supabase, "lenmen_khsx_plans", khsx, "week_start,row_key,day_index", dryRun);
  await upsertAll(supabase, "lenmen_settings", settings, "key", dryRun);

  if (skipped.length) console.log("\nCài đặt bỏ qua (đã có ở trang lớn hoặc không còn dùng): " + skipped.join(", "));
  if (warnings.length) { console.log("\nCảnh báo:"); for (const w of warnings) console.log("  - " + w); }
  if (!dryRun && batches.length) {
    console.log("\nCòn 1 bước: chạy supabase/migration_lenmen_after_import.sql trong SQL Editor để đẩy sequence id.");
  }
}

main();
