-- Cập nhật danh sách "Mục đích xuất kho" chủng giống theo đúng nghiệp vụ thực tế: bỏ
-- "Gửi kiểm nghiệm" (bucket này trước đó đã gộp nhầm cả DOD vào — xem
-- migration_lenmen_giong_mucdich.sql dòng 26-29), tách riêng "Theo dõi DOD", thêm "Huỷ".
-- Chạy sau migration_lenmen_giong_mucdich.sql, 1 lần trong Supabase Dashboard > SQL Editor.

-- Tên constraint theo đúng quy ước mặc định của Postgres cho CHECK khai báo inline theo
-- cột (<table>_<column>_check) — migration trước khai báo check ngay trong add column,
-- không đặt tên riêng.
alter table lenmen_seed_movements
  drop constraint if exists lenmen_seed_movements_muc_dich_loai_check;

-- Dữ liệu cũ gán "gui_kiem_nghiem" thực chất phần lớn là theo dõi DOD (xem lại rationale
-- ở migration trước) — chuyển sang nhóm mới cho đúng, không để mồ côi khỏi MUC_DICH_LABEL.
update lenmen_seed_movements
set muc_dich_loai = 'theo_doi_dod'
where muc_dich_loai = 'gui_kiem_nghiem';

alter table lenmen_seed_movements
  add constraint lenmen_seed_movements_muc_dich_loai_check
  check (muc_dich_loai in ('theo_doi_dod', 'nghien_cuu', 'san_xuat', 'huy'));

-- lenmen_movement_sx_can_lo (bắt buộc lo_san_xuat khi muc_dich_loai = 'san_xuat') không
-- đổi — value 'san_xuat' vẫn giữ nguyên tên, ràng buộc đó vẫn đúng.
