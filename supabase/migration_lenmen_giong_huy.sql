-- Huỷ lô chủng giống. Chạy sau migration_lenmen_giong_danhmuc.sql.
--
-- Huỷ khác xuất: xuất là lấy ra dùng, huỷ là bỏ đi (quá hạn, nhiễm, hỏng). Nhật ký
-- lenmen_seed_movements đã có loai='huy'; ở đây thêm dấu trên chính lô để giao diện
-- hiện "Đã huỷ" và chặn thao tác tiếp, thay vì chỉ thấy tồn = 0 mà không rõ vì sao.
alter table lenmen_seed_lots
  add column if not exists da_huy boolean not null default false,
  add column if not exists ngay_huy date,
  add column if not exists ly_do_huy text;

create index if not exists lenmen_seed_lots_da_huy_idx on lenmen_seed_lots (da_huy);
