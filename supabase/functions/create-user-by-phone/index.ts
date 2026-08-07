// Tạo 1 tài khoản đăng nhập bằng SĐT trực tiếp (cùng cơ chế đã dùng cho 32 tài khoản thật
// qua scripts/import-users.mjs) — vì Supabase Dashboard > Users > "Add user" chỉ nhận email,
// không có ô SĐT. Deploy 1 lần qua Supabase Studio (Edge Functions), sau đó admin chỉ cần vào
// tab "Invoke" của hàm này để tạo tài khoản mới, không cần chạy gì trên máy.
//
// Bảo vệ bằng 1 mã bí mật riêng (header x-admin-secret, đặt trong Function Secrets là
// ADMIN_CREATE_SECRET) thay vì JWT — vì hàm deploy với --no-verify-jwt / "Enforce JWT" tắt để
// gọi được thẳng từ tab Invoke mà không cần token đăng nhập thật.
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLE_SET = new Set(["admin", "rd", "qa", "qc", "kh", "ktv"]);

function toE164VN(phoneVn: string): string | null {
  const digits = String(phoneVn).replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("0") ? "+84" + digits.slice(1) : null;
}

// Excel/người dùng đôi khi gõ thiếu số 0 đầu (9 chữ số) — thêm lại cho đúng định dạng VN.
function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 9 ? "0" + digits : digits;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const expectedSecret = (Deno.env.get("ADMIN_CREATE_SECRET") || "").trim();
  const providedSecret = (req.headers.get("x-admin-secret") || "").trim();
  if (!expectedSecret) {
    return json({ error: "Server chưa đọc được secret ADMIN_CREATE_SECRET (chưa lưu, sai tên, hoặc chưa deploy lại)." }, 500);
  }
  if (providedSecret !== expectedSecret) {
    return json({ error: `Mã xác thực gửi lên không khớp (độ dài nhận được: ${providedSecret.length}).` }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body phải là JSON hợp lệ." }, 400);
  }

  const fullName = String(body.fullName || "").trim();
  const phoneRaw = String(body.phone || "").trim();
  const password = String(body.password || "").trim();
  const department = String(body.department || "").trim().toUpperCase();
  const roleInput = String(body.role || "").trim().toLowerCase();

  if (!fullName || !phoneRaw || !password) {
    return json({ error: "Thiếu họ tên, số điện thoại, hoặc mật khẩu." }, 400);
  }
  if (password.length < 6) {
    return json({ error: "Mật khẩu phải từ 6 ký tự trở lên." }, 400);
  }

  const phone = normalizePhone(phoneRaw);
  const e164 = toE164VN(phone);
  if (!e164) {
    return json({ error: `Số điện thoại không đúng định dạng VN (10 số, bắt đầu 0): ${phoneRaw}` }, 400);
  }
  const role = ROLE_SET.has(roleInput) ? roleInput : "qc";

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    phone: e164,
    password,
    phone_confirm: true, // bỏ qua OTP thật, đăng nhập được ngay — giống 32 tài khoản đã tạo trước
    user_metadata: { full_name: fullName, department },
  });

  if (error) {
    const already = error.message?.toLowerCase().includes("already been registered") || error.code === "phone_exists";
    return json(
      { error: already ? `Số điện thoại đã có tài khoản: ${e164}` : error.message },
      already ? 409 : 400,
    );
  }

  // Trigger handle_new_user chỉ tự suy role rd/qa/qc/kh theo phòng ban và để status mặc định
  // (pending) — ghi đè role thật (kể cả admin/ktv), duyệt sẵn, và lưu SĐT dạng quen thuộc.
  const { error: updErr } = await supabaseAdmin
    .from("profiles")
    .update({ role, status: "approved", full_name: fullName, department, phone })
    .eq("id", data.user.id);

  if (updErr) {
    return json(
      { warning: `Tạo tài khoản OK nhưng lỗi cập nhật hồ sơ: ${updErr.message}`, userId: data.user.id, phone: e164 },
      207,
    );
  }

  return json({ ok: true, userId: data.user.id, phone: e164, fullName, department, role });
});
