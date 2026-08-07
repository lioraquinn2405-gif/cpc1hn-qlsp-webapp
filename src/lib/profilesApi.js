import { supabase } from "./supabaseClient.js";

const PROFILE_FIELDS = [
  ["id", "id"], ["email", "email"], ["pendingEmail", "pending_email"], ["phone", "phone"], ["fullName", "full_name"],
  ["department", "department"], ["employeeCode", "employee_code"],
  ["role", "role"], ["status", "status"], ["createdAt", "created_at"],
];

const toCamel = (row) =>
  Object.fromEntries(PROFILE_FIELDS.map(([camel, snake]) => [camel, row[snake]]));
const toSnakeKey = (camel) => PROFILE_FIELDS.find(([c]) => c === camel)?.[1] ?? camel;

export async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? toCamel(data) : null;
}

export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at");
  if (error) throw error;
  return data.map(toCamel);
}

// User thường GỬI YÊU CẦU đổi email (ghi vào profiles.pending_email của CHÍNH MÌNH) — chưa có
// hiệu lực đăng nhập, chỉ admin duyệt (setUserEmail) mới áp dụng thật. Dùng RPC riêng (security
// definer, chỉ đụng đúng 1 cột) vì RLS "profiles_update_admin" chỉ cho admin update trực tiếp
// bảng profiles (tránh user tự nâng quyền role/status của chính mình).
export async function requestEmailChange(newEmail) {
  const { error } = await supabase.rpc("request_own_email_change", { new_email: newEmail });
  if (error) throw error;
}

// Set email TRỰC TIẾP (auto-confirm, không gửi email xác nhận) qua Vercel serverless function
// api/set-user-email.js — CHỈ admin gọi được (tự sửa email chính mình hoặc duyệt yêu cầu của ai
// đó); tự động xoá pending_email sau khi áp dụng.
export async function setUserEmail({ targetUserId, newEmail }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Chưa đăng nhập.");
  const res = await fetch("/api/set-user-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ targetUserId, newEmail }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Không sửa được email.");
  return body;
}

// Admin tạo tài khoản mới ngay trong web app (họ tên/SĐT/mật khẩu) qua api/admin-create-user.js
// — mật khẩu chỉ đi qua đúng request này rồi Supabase băm ngay, không lưu/hiện lại ở đâu khác.
export async function adminCreateUser({ fullName, phone, password, department, role }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Chưa đăng nhập.");
  const res = await fetch("/api/create-employee", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ fullName, phone, password, department, role }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Không tạo được tài khoản.");
  return body;
}

export async function updateProfile(id, patch) {
  const snakePatch = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [toSnakeKey(k), v])
  );
  const { error } = await supabase.from("profiles").update(snakePatch).eq("id", id);
  if (error) throw error;
}

export async function signUp({ email, password, fullName, department, employeeCode }) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, department, employee_code: employeeCode } },
  });
  if (error) throw error;
}
