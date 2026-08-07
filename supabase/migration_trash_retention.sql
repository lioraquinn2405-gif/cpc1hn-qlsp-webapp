-- Chạy trong SQL Editor: thêm cột lưu thời điểm đưa vào Thùng rác, dùng để tự
-- động xoá vĩnh viễn sau 30 ngày.

alter table materials add column if not exists deleted_at timestamptz;
