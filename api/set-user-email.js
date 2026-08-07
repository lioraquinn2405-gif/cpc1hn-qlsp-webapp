// Vercel serverless function — set email cho 1 tài khoản TRỰC TIẾP (auto-confirm), không qua
// luồng "gửi email xác nhận" của Supabase Auth (luồng đó vướng giới hạn 2 email/giờ mặc định +
// yêu cầu email cũ hợp lệ). Cần SUPABASE_SERVICE_KEY (quyền admin) nên phải chạy ở server,
// KHÔNG được gọi trực tiếp từ trình duyệt với service key.
//
// CHỈ ADMIN được gọi endpoint này (tự sửa email của chính mình, hoặc DUYỆT/sửa email của người
// khác — dùng khi duyệt 1 yêu cầu ở profiles.pending_email, hoặc sửa trực tiếp trong tab "Người
// dùng"). Người dùng thường KHÔNG gọi endpoint này — họ gửi yêu cầu qua RPC
// request_own_email_change (xem src/lib/profilesApi.js), chỉ ghi vào pending_email, chưa có
// hiệu lực đăng nhập cho tới khi admin duyệt qua đây.
import { requireAdmin } from "./_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { targetUserId, newEmail } = req.body || {};
  if (!newEmail || typeof newEmail !== "string" || !newEmail.includes("@")) {
    res.status(400).json({ error: "Email không hợp lệ" });
    return;
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { admin, callerId } = auth;
  const target = targetUserId || callerId;

  const { error: updErr } = await admin.auth.admin.updateUserById(target, {
    email: newEmail,
    email_confirm: true,
  });
  if (updErr) {
    res.status(400).json({ error: updErr.message });
    return;
  }
  await admin.from("profiles").update({ email: newEmail, pending_email: null }).eq("id", target);

  res.status(200).json({ ok: true });
}
