-- Chạy trong SQL Editor SAU migration_ktv_role_and_own_email.sql:
-- 1) Thêm cột phone riêng (tách khỏi email) — để "Tên đăng nhập" (SĐT) và "Gmail đăng nhập"
--    (email thật, nếu có) hiện thành 2 cột riêng biệt, dễ nhìn trong Table Editor.
-- 2) Backfill cột phone cho các tài khoản đã tạo trước đó (đang mã hoá SĐT trong email nội bộ
--    dạng "<sdt>@cpc1hn.local"), đồng thời dọn cột email về NULL cho các tài khoản này vì đó
--    không phải email thật.
-- 3) Tạo 1 VIEW ở schema public (để hiện ra ngay trong Table Editor mà không cần đổi sang
--    schema "auth") gộp profiles + auth.users, có thêm cột encrypted_password để xem cho biết.
--    REVOKE khỏi anon/authenticated để KHÔNG bị lộ qua REST API công khai (chỉ Dashboard —
--    kết nối bằng quyền chủ database — mới xem được).

alter table profiles add column if not exists phone text;

update profiles
set phone = split_part(email, '@', 1),
    email = null
where email like '%@cpc1hn.local';

create or replace view public.user_accounts_admin_view as
select
  p.id,
  p.full_name,
  p.phone,
  p.email,
  u.encrypted_password,
  p.role,
  p.status,
  p.department,
  p.employee_code,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id;

revoke all on public.user_accounts_admin_view from anon, authenticated;
