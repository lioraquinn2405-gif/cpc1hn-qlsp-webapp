-- Chạy 1 LẦN DUY NHẤT trong SQL Editor để tạo sẵn hàm rút gọn cho việc cấp lại mật khẩu.
-- Sau khi tạo xong, mỗi lần cần cấp lại mật khẩu chỉ cần gõ 1 dòng ngắn (xem cuối file), không
-- cần nhớ cú pháp update/crypt/gen_salt nữa.

create or replace function public.admin_reset_password(target_phone text, new_password text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update auth.users
  set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf'))
  where phone = target_phone;
end;
$$;

-- ============================================================
-- TỪ NAY VỀ SAU, cấp lại mật khẩu chỉ cần chạy đúng 1 dòng này trong SQL Editor
-- (sửa SĐT và mật khẩu mới, không có dấu + trước SĐT):
--
-- select admin_reset_password('84xxxxxxxxx', 'MAT_KHAU_MOI');
-- ============================================================
