-- Chạy trong SQL Editor SAU migration_profiles_phone_admin_view.sql:
-- Đổi luồng "thêm/đổi email" từ user thường sang mô hình YÊU CẦU + ADMIN DUYỆT:
-- 1) Cột pending_email: nơi lưu tạm email user MUỐN đổi sang, chờ admin duyệt (chưa có hiệu lực
--    đăng nhập, chưa ghi vào auth.users, chỉ hiển thị cho admin xem trong tab "Người dùng").
-- 2) RPC request_own_email_change: cho user thường tự ghi pending_email của CHÍNH MÌNH (không
--    đụng được của người khác, không tự nâng quyền vì chỉ đụng đúng 1 cột này).

alter table profiles add column if not exists pending_email text;

create or replace function public.request_own_email_change(new_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set pending_email = new_email where id = auth.uid();
end;
$$;

grant execute on function public.request_own_email_change(text) to authenticated;
