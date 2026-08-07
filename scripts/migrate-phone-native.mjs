// Chuyển các tài khoản đang đăng nhập bằng "email giả" (SĐT@cpc1hn.local) sang dùng trường
// phone GỐC của Supabase Auth (tách riêng khỏi email) — để 1 tài khoản dùng được cả SĐT lẫn
// email thật song song, không còn ghi đè lẫn nhau. Không đụng tới auth.users.email hiện có
// (giữ nguyên làm lối đăng nhập dự phòng, không xoá gì).
// Chạy: node scripts/migrate-phone-native.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function toE164(phoneVn) {
  const digits = String(phoneVn).replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return "+84" + digits.slice(1);
  return null;
}

const env = loadEnv();
if (!env.SUPABASE_SERVICE_KEY) {
  console.error("Thieu SUPABASE_SERVICE_KEY trong .env");
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: profiles, error } = await supabase
  .from("profiles")
  .select("id, full_name, phone")
  .not("phone", "is", null);
if (error) {
  console.error("Loi doc profiles:", error.message);
  process.exit(1);
}

console.log(`Tim thay ${profiles.length} profile co SDT${DRY_RUN ? " -- DRY RUN, khong ghi gi ca" : ""}.\n`);

let migrated = 0, skipped = 0, failed = 0;
for (const p of profiles) {
  const e164 = toE164(p.phone);
  if (!e164) {
    console.log(`  BO QUA (so dien thoai khong dung dinh dang VN): ${p.full_name} - ${p.phone}`);
    skipped++;
    continue;
  }

  const { data: userData, error: getErr } = await supabase.auth.admin.getUserById(p.id);
  if (getErr) {
    console.error(`  LOI doc auth user ${p.full_name}: ${getErr.message}`);
    failed++;
    continue;
  }
  if (userData.user.phone) {
    console.log(`  BO QUA (da co phone native): ${p.full_name} - ${userData.user.phone}`);
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] se set phone native: ${p.full_name} -> ${e164}`);
    continue;
  }

  const { error: updErr } = await supabase.auth.admin.updateUserById(p.id, {
    phone: e164,
    phone_confirm: true,
  });
  if (updErr) {
    console.error(`  LOI set phone cho ${p.full_name} (${e164}): ${updErr.message}`);
    failed++;
  } else {
    console.log(`  OK: ${p.full_name} -> ${e164}`);
    migrated++;
  }
}

console.log(`\n=== Xong: ${migrated} migrate, ${skipped} bo qua, ${failed} loi ===`);
