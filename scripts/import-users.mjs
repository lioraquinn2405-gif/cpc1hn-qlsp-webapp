// Tạo hàng loạt tài khoản đăng nhập từ file "danh sách users (1).xlsx" (cột: Tên Tài khoản,
// Tên đăng nhập [số điện thoại], Mật khẩu, Phòng ban, Vai trò). Dùng service_role key nên bỏ
// qua RLS — KHÔNG được commit .env, key này có toàn quyền trên database.
// Chạy: node scripts/import-users.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function toE164VN(phoneVn) {
  const digits = String(phoneVn).replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("0") ? "+84" + digits.slice(1) : null;
}

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// Excel đôi khi lưu số điện thoại dưới dạng SỐ (mất số 0 đầu) thay vì text — số điện thoại VN
// luôn đủ 10 chữ số bắt đầu bằng 0, nên nếu chỉ còn 9 chữ số thì thêm lại số 0 đã mất.
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 9) return "0" + digits;
  return digits;
}

const ROLE_MAP = { admin: "admin", rd: "rd", qa: "qa", qc: "qc", kh: "kh", ktv: "ktv" };
function normalizeRole(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return ROLE_MAP[key] || "qc"; // không nhận diện được -> mặc định qc, để admin tự sửa sau
}

const env = loadEnv();
if (!env.SUPABASE_SERVICE_KEY) {
  console.error("Thiếu SUPABASE_SERVICE_KEY trong .env — không thể tạo tài khoản (cần quyền admin).");
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const xlsxPath = path.join(ROOT, "danh sách users (1).xlsx");
const buf = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

const seenPhones = new Set();
const users = [];
for (const row of rows) {
  const phoneRaw = row["Tên đăng nhập"];
  if (!phoneRaw) continue; // bỏ dòng ghi chú (giữ nguyên tài khoản admin Gmail cũ)
  const phone = normalizePhone(phoneRaw);
  if (seenPhones.has(phone)) {
    console.log(`  BỎ QUA (trùng số điện thoại đã xử lý): ${row["Tên Tài khoản"]} — ${phone}`);
    continue;
  }
  seenPhones.add(phone);
  users.push({
    fullName: String(row["Tên Tài khoản"] || "").trim(),
    phone,
    password: normalizePhone(row["Mật khẩu"]),
    department: String(row["Phòng ban"] || "").trim().toUpperCase(),
    role: normalizeRole(row["Vai trò"]),
  });
}

console.log(`Đọc được ${users.length} tài khoản cần tạo (đã bỏ trùng)${DRY_RUN ? " — DRY RUN, không ghi gì cả" : ""}.\n`);

let created = 0, skipped = 0, failed = 0;
for (const u of users) {
  const e164 = toE164VN(u.phone);
  if (!e164) {
    console.log(`  BỎ QUA (số điện thoại không đúng định dạng VN): ${u.fullName} — ${u.phone}`);
    skipped++;
    continue;
  }
  if (DRY_RUN) {
    console.log(`  [dry-run] ${u.fullName} | ${e164} | pass=${u.password} | ${u.department} | role=${u.role}`);
    continue;
  }
  // Dùng thẳng trường phone gốc của Supabase Auth (không qua email giả nữa) — xem
  // src/lib/... / src/App.jsx (toAuthCredential) cho phần đăng nhập tương ứng.
  const { data, error } = await supabase.auth.admin.createUser({
    phone: e164,
    password: u.password,
    phone_confirm: true, // bỏ qua bước xác nhận OTP, đăng nhập được ngay
    user_metadata: { full_name: u.fullName, department: u.department },
  });
  if (error) {
    if (error.message?.toLowerCase().includes("already been registered") || error.code === "phone_exists") {
      console.log(`  BỎ QUA (đã tồn tại): ${u.fullName} — ${e164}`);
      skipped++;
    } else {
      console.error(`  LỖI tạo ${u.fullName} (${e164}): ${error.message}`);
      failed++;
    }
    continue;
  }
  // Trigger handle_new_user chỉ tự suy role theo phòng ban (rd/qa/qc/kh) — không biết
  // admin/ktv, nên phải ghi đè đúng role thật + duyệt sẵn (status approved) ngay sau đó,
  // đồng thời lưu SĐT thật (dạng nhập liệu quen thuộc, không phải +84) vào cột phone riêng
  // để hiện đúng trong Table Editor / tab "Người dùng".
  const { error: updErr } = await supabase
    .from("profiles")
    .update({ role: u.role, status: "approved", full_name: u.fullName, department: u.department, phone: u.phone })
    .eq("id", data.user.id);
  if (updErr) {
    console.error(`  Tạo tài khoản OK nhưng lỗi cập nhật vai trò cho ${u.fullName}: ${updErr.message}`);
    failed++;
  } else {
    console.log(`  OK: ${u.fullName} | ${e164} | ${u.department} | ${u.role}`);
    created++;
  }
}

console.log(`\n=== Xong: ${created} tạo mới, ${skipped} đã tồn tại (bỏ qua), ${failed} lỗi ===`);
