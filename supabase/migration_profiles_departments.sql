-- Chạy trong SQL Editor SAU migration_profiles.sql: mở rộng vai trò theo phòng ban
-- (RD, QA, QC, KH) thay vì chỉ admin/qc, và tự gán vai trò theo phòng ban chọn lúc
-- đăng ký. Admin vẫn được gán tay qua tab "Người dùng" như trước.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'rd', 'qa', 'qc', 'kh'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, department, employee_code, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'employee_code',
    case upper(new.raw_user_meta_data ->> 'department')
      when 'RD' then 'rd'
      when 'QA' then 'qa'
      when 'QC' then 'qc'
      when 'KH' then 'kh'
      else 'qc'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
