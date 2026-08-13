-- Cho phép chuyển tay 1 chai bất kỳ sang "Chờ xử lý" ngay (đối xứng với huy_thu_cong đã có
-- cho "Đã huỷ") — dùng khi thực tế chai đã cần xử lý nhưng dữ liệu QC chưa đủ để hệ thống tự
-- phân loại đúng (vd nhập liệu sai/thiếu, hoặc phát hiện qua đối chiếu thực tế).
alter table materials add column if not exists cho_xu_ly_thu_cong boolean not null default false;
