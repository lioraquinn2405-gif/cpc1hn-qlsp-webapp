-- Cho phép SỬA 1 lượt xuất/nhập chủng đã lưu (khắc phục lỡ gõ sai mục đích/lô sản xuất/tên
-- người ký) — CHỈ admin. Trước đó bảng lenmen_seed_movements chưa có policy UPDATE nào nên
-- RLS mặc định chặn hết, kể cả admin — phải thêm policy này thì nút Sửa mới ghi được.
-- Chạy sau migration_lenmen_giong_phieu.sql, 1 lần trong Supabase Dashboard > SQL Editor.

create policy "lenmen_seed_movements_update_admin" on lenmen_seed_movements for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
