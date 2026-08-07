// Dùng chung cho mọi api/*.js cần quyền admin (service role) — tạo Supabase client bằng
// SUPABASE_SERVICE_KEY, xác thực token của người gọi, và xác nhận họ là admin đã duyệt.
// File nằm trong api/_lib/ (không phải api/ trực tiếp) nên Vercel KHÔNG coi đây là 1 route.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Trả về { admin, callerId, role } nếu người gọi đã đăng nhập VÀ đã được duyệt (status=approved) —
// không yêu cầu role admin. Dùng cho các endpoint mà người dùng thường (NCV...) được gọi, chỉ cần
// chặn tài khoản chưa duyệt/chưa đăng nhập. Tự gửi response lỗi 401/403 và trả về null nếu không đạt
// — caller chỉ cần `if (!auth) return;`.
export async function requireApprovedUser(req, res) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Thiếu token đăng nhập" });
    return null;
  }

  const admin = createAdminClient();
  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !callerAuth?.user) {
    res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
    return null;
  }
  const callerId = callerAuth.user.id;

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", callerId)
    .maybeSingle();
  if (!callerProfile || callerProfile.status !== "approved") {
    res.status(403).json({ error: "Tài khoản chưa được duyệt" });
    return null;
  }

  return { admin, callerId, role: callerProfile.role };
}

// Trả về { admin, callerId } nếu người gọi là admin đã duyệt; nếu không, tự gửi response lỗi
// tương ứng (401/403) và trả về null — caller chỉ cần `if (!auth) return;`.
export async function requireAdmin(req, res) {
  const auth = await requireApprovedUser(req, res);
  if (!auth) return null;
  if (auth.role !== "admin") {
    res.status(403).json({ error: "Chỉ admin mới thực hiện được thao tác này." });
    return null;
  }
  return auth;
}
