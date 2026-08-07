-- Chạy trong SQL Editor. Thêm 2 cột mô tả quy trình xử lý còn lại cho "Lịch sử pha chế".
alter table finished_batches add column if not exists xu_ly_nguyen_lieu_dau_vao text;
alter table finished_batches add column if not exists xu_ly_btp_sau_pha text;
