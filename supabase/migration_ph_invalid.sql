-- Chạy trong SQL Editor: thêm cờ đánh dấu "pH nhập sai" (khác với "chưa nhập"),
-- vd khi Excel gốc lỡ gõ nhầm 1 ngày tháng vào ô pH (đọc ra số serial như 45664).

alter table materials add column if not exists ph_invalid boolean not null default false;
