-- Chạy trong SQL Editor. Thêm cột thời điểm lô NL chuyển sang "Đã pha" (khác created_at/updated_at).
alter table materials add column if not exists da_pha_at timestamptz;
