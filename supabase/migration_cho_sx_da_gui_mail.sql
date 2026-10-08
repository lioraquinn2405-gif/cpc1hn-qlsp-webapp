-- Chạy trong SQL Editor. Thêm cột da_gui_mail_at: thời điểm NCV tích "Đã gửi mail" ở tab "Chờ SX".
-- Nhịp đã gửi mail xuống nhóm riêng, và sau 30 ngày kể từ mốc này tự chuyển sang "Đã pha".

alter table materials add column if not exists da_gui_mail_at timestamptz;
