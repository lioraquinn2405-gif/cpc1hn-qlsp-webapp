-- Chạy trong SQL Editor: siết quyền, chỉ tài khoản đã đăng nhập mới đọc/ghi được
-- materials và products (trước đây anon key đọc/ghi tự do). Không ảnh hưởng tới
-- Google Apps Script (dùng service_role key, luôn bỏ qua RLS).

drop policy if exists "materials_select_all" on materials;
drop policy if exists "materials_insert_all" on materials;
drop policy if exists "materials_update_all" on materials;
drop policy if exists "materials_delete_all" on materials;

create policy "materials_select_auth" on materials for select
  using (auth.role() = 'authenticated');
create policy "materials_insert_auth" on materials for insert
  with check (auth.role() = 'authenticated');
create policy "materials_update_auth" on materials for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "materials_delete_auth" on materials for delete
  using (auth.role() = 'authenticated');

drop policy if exists "products_select_all" on products;
drop policy if exists "products_insert_all" on products;
drop policy if exists "products_update_all" on products;

create policy "products_select_auth" on products for select
  using (auth.role() = 'authenticated');
create policy "products_insert_auth" on products for insert
  with check (auth.role() = 'authenticated');
create policy "products_update_auth" on products for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
