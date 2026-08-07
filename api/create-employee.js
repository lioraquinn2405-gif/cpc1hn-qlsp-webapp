// Tạo tài khoản nhân viên mới (họ tên/SĐT làm tên đăng nhập/mật khẩu) NGAY TRONG WEB APP — chỉ
// admin gọi được (requireAdmin). Mật khẩu chỉ đi qua đúng 1 lượt HTTPS tới đây rồi chuyển thẳng
// cho Supabase Auth băm (bcrypt) ngay lập tức — không log, không lưu lại ở bất kỳ đâu, không
// trả về lại trong response. Cùng cơ chế với supabase/functions/create-user-by-phone (Edge
// Function) và scripts/import-users.mjs — chỉ khác là gọi được thẳng từ UI thay vì phải vào
// Supabase Dashboard/Studio.
// LƯU Ý: file KHÔNG được đặt tên có chữ "admin" trong đường dẫn (vd api/admin-create-user.js) —
// nhiều trình chặn quảng cáo/theo dõi (uBlock, AdGuard...) tự động chặn request có "admin" trong
// URL, gây lỗi 404 giả ở phía trình duyệt dù server hoạt động đúng (bug thật gặp 2026-07-30).
import { requireAdmin } from "./_lib/adminAuth.js";

const ROLE_SET = new Set(["admin", "rd", "qa", "qc", "kh", "ktv"]);

function toE164VN(phoneVn) {
  const digits = String(phoneVn).replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("0") ? "+84" + digits.slice(1) : null;
}
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 9 ? "0" + digits : digits;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { fullName, phone: phoneRaw, password, department, role: roleInput } = req.body || {};
  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    res.status(400).json({ error: "Thiếu họ tên." });
    return;
  }
  if (!phoneRaw || typeof phoneRaw !== "string") {
    res.status(400).json({ error: "Thiếu số điện thoại." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Mật khẩu phải từ 6 ký tự trở lên." });
    return;
  }

  const phone = normalizePhone(phoneRaw);
  const e164 = toE164VN(phone);
  if (!e164) {
    res.status(400).json({ error: `Số điện thoại không đúng định dạng VN (10 số, bắt đầu 0): ${phoneRaw}` });
    return;
  }
  const dept = String(department || "").trim().toUpperCase();
  const role = ROLE_SET.has(String(roleInput || "").toLowerCase()) ? String(roleInput).toLowerCase() : "qc";

  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { admin } = auth;

  const { data, error } = await admin.auth.admin.createUser({
    phone: e164,
    password,
    phone_confirm: true,
    user_metadata: { full_name: fullName.trim(), department: dept },
  });

  if (error) {
    const already = error.message?.toLowerCase().includes("already been registered") || error.code === "phone_exists";
    res.status(already ? 409 : 400).json({ error: already ? `Số điện thoại đã có tài khoản: ${e164}` : error.message });
    return;
  }

  const { error: updErr } = await admin
    .from("profiles")
    .update({ role, status: "approved", full_name: fullName.trim(), department: dept, phone })
    .eq("id", data.user.id);

  if (updErr) {
    res.status(500).json({ error: `Tạo tài khoản OK nhưng lỗi cập nhật hồ sơ: ${updErr.message}` });
    return;
  }

  res.status(200).json({ ok: true, userId: data.user.id, phone: e164 });
}
