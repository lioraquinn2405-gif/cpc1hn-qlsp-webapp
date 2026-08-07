-- Chạy trong SQL Editor. Thêm cột "thời gian thu" (ngày thu dịch bào tử, lấy tự động từ
-- mail "Thu bào tử") — khác với dot_san_xuat vốn là ngày sản xuất môi trường nuôi cấy.

alter table materials add column if not exists thoi_gian_thu date;
