-- Chạy SAU khi đã nhập dữ liệu cũ bằng scripts/import-lenmen.mjs.
--
-- Script nhập giữ nguyên id cũ (để lenmen_khsx_plans.linked_batch_id còn trỏ đúng lô),
-- nhưng chèn id tường minh thì sequence của cột identity không tự nhảy theo. Không chạy
-- file này thì lần thêm lô mới đầu tiên trên web sẽ xin id = 1 và báo trùng khoá.
select setval(
  pg_get_serial_sequence('lenmen_batches', 'id'),
  coalesce((select max(id) from lenmen_batches), 1)
);

select setval(
  pg_get_serial_sequence('lenmen_khsx_plans', 'id'),
  coalesce((select max(id) from lenmen_khsx_plans), 1)
);

-- Kiểm tra nhanh sau khi nhập: số lô, số lô còn chờ xử lý, và số ô kế hoạch có liên kết
-- sang Danh sách lô (phải khớp với hệ thống cũ).
select
  (select count(*) from lenmen_batches) as so_lo,
  (select count(*) from lenmen_batches where prep_status = 'Chờ lên men') as cho_len_men,
  (select count(*) from lenmen_batches where is_infected) as lo_nhiem,
  (select count(*) from lenmen_khsx_plans) as o_ke_hoach,
  (select count(*) from lenmen_khsx_plans where linked_batch_id is not null) as o_co_lien_ket;
