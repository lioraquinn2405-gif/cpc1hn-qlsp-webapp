-- Chạy trong SQL Editor SAU migration_profiles_departments.sql:
-- 1) Thêm vai trò "ktv" (kỹ thuật viên) vào danh sách hợp lệ.
-- 2) Cho phép user tự cập nhật CỘT EMAIL hiển thị (profiles.email) của CHÍNH MÌNH qua 1 hàm
--    RPC hẹp (security definer) — KHÔNG mở rộng policy update trực tiếp trên bảng profiles,
--    để tránh user tự nâng quyền role/status của chính mình (policy update hiện tại chỉ cho
--    admin sửa, xem migration_profiles.sql).

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'rd', 'qa', 'qc', 'kh', 'ktv'));

create or replace function public.update_own_profile_email(new_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new_email where id = auth.uid();
end;
$$;

grant execute on function public.update_own_profile_email(text) to authenticated;
