-- Chạy trong SQL Editor: thêm bảng profiles (họ tên/email/vai trò/trạng thái duyệt),
-- tự tạo profile khi có tài khoản mới (đăng ký hoặc admin tạo tay đều qua trigger này),
-- và siết materials/products chỉ cho tài khoản đã được admin duyệt (status = 'approved').
-- Không ảnh hưởng Google Apps Script / scripts/import-xlsx.mjs vì cả hai dùng
-- service_role key, luôn bỏ qua RLS.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  department text,
  employee_code text,
  role text not null default 'qc' check (role in ('admin', 'qc')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles_select_auth" on profiles;
create policy "profiles_select_auth" on profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Tự tạo dòng profiles khi có user mới trong auth.users (đăng ký qua form hoặc
-- admin tạo tay trong Dashboard đều kích hoạt). security definer để bỏ qua RLS
-- của chính bảng profiles khi insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, department, employee_code)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'employee_code'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Cột audit trên materials: nullable, không default — Apps Script/import-xlsx
-- chèn dữ liệu không kèm field này vẫn hợp lệ.
alter table materials add column if not exists created_by uuid references auth.users(id);
alter table materials add column if not exists updated_by uuid references auth.users(id);

-- Siết materials/products: phải là tài khoản đã được duyệt (status = 'approved'),
-- không chỉ cần đăng nhập (authenticated) như trước.
drop policy if exists "materials_select_auth" on materials;
drop policy if exists "materials_insert_auth" on materials;
drop policy if exists "materials_update_auth" on materials;
drop policy if exists "materials_delete_auth" on materials;

create policy "materials_select_approved" on materials for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "materials_insert_approved" on materials for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "materials_update_approved" on materials for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "materials_delete_approved" on materials for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));

drop policy if exists "products_select_auth" on products;
drop policy if exists "products_insert_auth" on products;
drop policy if exists "products_update_auth" on products;

create policy "products_select_approved" on products for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "products_insert_approved" on products for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "products_update_approved" on products for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));

-- QUAN TRỌNG: chạy dòng dưới đây MỘT LẦN, thay email của tài khoản admin hiện tại,
-- để có admin đầu tiên duyệt được người khác qua giao diện (không ai vào được UI
-- để tự duyệt đầu tiên nếu chưa có admin nào).
-- update profiles set role = 'admin', status = 'approved' where email = 'ban@vidu.com';
