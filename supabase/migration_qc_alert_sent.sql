-- Chạy trong SQL Editor. Cột lưu "số ngày kể từ thu tại lần cảnh báo QC gần
-- nhất" cho 1 chai — dùng để lặp lại cảnh báo mỗi vài ngày (không phải chỉ gửi
-- 1 lần) cho tới khi QC nhập kết quả.
alter table materials add column if not exists qc_last_alert_day smallint;
