-- Chuẩn hoá mục đích xuất kho + bắt buộc số lô khi xuất để sản xuất.
-- Chạy sau migration_lenmen_giong_huy.sql.
--
-- Lý do bắt buộc: kết quả kiểm nghiệm của lô sản xuất sau này phải truy ngược được về
-- đúng ống chủng đã dùng. Không có số lô ở đây thì khi lô sản xuất nhiễm khuẩn, không
-- ai biết nó ra từ ống chủng nào.

alter table lenmen_seed_movements
  add column if not exists muc_dich_loai text
    check (muc_dich_loai in ('nghien_cuu', 'san_xuat', 'gui_kiem_nghiem')),
  -- Số lô sản xuất / mẻ lên men mà ống chủng này được dùng cho.
  add column if not exists lo_san_xuat text;

/* --------------------------- Chuẩn hoá dữ liệu cũ --------------------------- */

-- Sổ cũ ghi tự do ("NC", "SX", "sx", "DOD", "Kiểm tra DOD"...). Quy về 3 nhóm, giữ
-- nguyên chữ gốc ở cột muc_dich để không mất sắc thái người ghi.
update lenmen_seed_movements
set muc_dich_loai = 'nghien_cuu'
where muc_dich_loai is null and lower(trim(muc_dich)) in ('nc', 'nghiên cứu', 'nghien cuu');

update lenmen_seed_movements
set muc_dich_loai = 'san_xuat'
where muc_dich_loai is null and lower(trim(muc_dich)) in ('sx', 'sản xuất', 'san xuat');

update lenmen_seed_movements
set muc_dich_loai = 'gui_kiem_nghiem'
where muc_dich_loai is null
  and (lower(muc_dich) like '%dod%' or lower(muc_dich) like '%kiểm nghiệm%' or lower(muc_dich) like '%kiem nghiem%');

-- Các dòng còn lại ("NC+SX", "Lưu tủ -80", "Xuất chủng hết hạn"...) cố ý để trống:
-- gán bừa vào một nhóm sẽ làm sai thống kê, mà đoán hộ người ghi thì nguy hiểm hơn.

/* ------------------------------ Ràng buộc mới ------------------------------ */

-- NOT VALID: chỉ soi dòng THÊM MỚI và dòng bị sửa từ nay trở đi. Dòng lịch sử nhập từ
-- Excel không có số lô sản xuất (sổ cũ không ghi) — bắt chúng tuân thủ thì phải bịa số
-- lô, còn hơn cả việc để trống. Muốn siết cả dữ liệu cũ thì bổ sung số lô rồi chạy
--   alter table lenmen_seed_movements validate constraint lenmen_movement_sx_can_lo;
alter table lenmen_seed_movements
  drop constraint if exists lenmen_movement_sx_can_lo;
alter table lenmen_seed_movements
  add constraint lenmen_movement_sx_can_lo
  check (muc_dich_loai is distinct from 'san_xuat' or (lo_san_xuat is not null and btrim(lo_san_xuat) <> ''))
  not valid;

-- Tra ngược "lô sản xuất này dùng ống chủng nào" — câu hỏi được hỏi khi lô nhiễm khuẩn.
create index if not exists lenmen_seed_movements_lo_sx_idx
  on lenmen_seed_movements (lo_san_xuat) where lo_san_xuat is not null;
