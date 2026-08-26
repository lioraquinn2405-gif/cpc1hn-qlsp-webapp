-- Thêm 2 cột còn thiếu để lưu đủ 3 người ký trên phiếu xuất/nhập chủng in ra
-- (nguoi_thuc_hien = Người xuất/nhập đã có sẵn). Chạy sau migration_lenmen_giong_mucdich2.sql,
-- 1 lần trong Supabase Dashboard > SQL Editor.

alter table lenmen_seed_movements
  add column if not exists nguoi_kiem_tra text,
  add column if not exists nguoi_phe_duyet text;
