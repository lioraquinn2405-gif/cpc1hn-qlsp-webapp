-- CẤP LẠI MẬT KHẨU CHO 1 TÀI KHOẢN
-- Chạy trong Supabase SQL Editor (KHÔNG chạy trong Table Editor — Table Editor không tự băm
-- mật khẩu, sẽ làm hỏng tài khoản vĩnh viễn).
--
-- Cách dùng: mỗi lần cần cấp lại, chỉ sửa 2 chỗ được đánh dấu <<< bên dưới rồi bấm Run
-- (Ctrl+Enter). Nên bấm "Save" (góc trên SQL Editor) để lưu lại, lần sau mở ra sửa tiếp luôn.

update auth.users
set encrypted_password = extensions.crypt('MAT_KHAU_MOI', extensions.gen_salt('bf'))  -- <<< sửa mật khẩu mới ở đây
where phone = '84xxxxxxxxx';  -- <<< sửa SĐT ở đây — KHÔNG có dấu +, xem cột "Phone" trong Authentication > Users

-- Nếu tài khoản đó đăng nhập bằng EMAIL thay vì SĐT thì dùng bản này thay thế
-- (xoá/comment khối "update" ở trên, bỏ comment khối dưới):

-- update auth.users
-- set encrypted_password = extensions.crypt('MAT_KHAU_MOI', extensions.gen_salt('bf'))
-- where email = 'ten@gmail.com';
