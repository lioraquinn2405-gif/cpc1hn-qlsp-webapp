-- Chạy trong SQL Editor. Thêm 2 cột mô tả quy trình xử lý bán thành phẩm cho "Lịch sử pha chế" —
-- mỗi SP có quy trình riêng (có SP hấp sau đóng ống, có SP hấp/duy trì nhiệt ngay trong tank).
alter table finished_batches add column if not exists xu_ly_sau_dong_ong text;
alter table finished_batches add column if not exists quy_trinh_khac text;
