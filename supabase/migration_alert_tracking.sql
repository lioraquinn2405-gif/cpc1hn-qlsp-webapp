-- Chạy trong SQL Editor nếu bạn đã chạy schema.sql từ trước (bổ sung cột theo dõi
-- đã gửi cảnh báo hạn dùng cho từng nguyên liệu, tránh gửi trùng mail mỗi ngày).

alter table materials add column if not exists last_alert_month smallint;
