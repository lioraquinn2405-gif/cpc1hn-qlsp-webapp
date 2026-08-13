-- Cho phép chuyển tay 1 chai đang "Chờ xử lý" sang "Đã huỷ" ngay, thay vì phải chờ đủ
-- DISPOSAL_MONTHS (24 tháng) mới tự động chuyển.
alter table materials add column if not exists huy_thu_cong boolean not null default false;
