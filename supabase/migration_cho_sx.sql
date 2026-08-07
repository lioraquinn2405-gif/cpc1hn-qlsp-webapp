-- Chạy trong SQL Editor. Thêm trạng thái "Chờ SX" (đã lên lệnh sản xuất, chờ pha thật) cho nguyên
-- liệu — khi 1 kế hoạch mẻ pha được DUYỆT, các lô NL đã dùng chuyển sang trạng thái này (không còn
-- được tính vào kế hoạch pha chế nào khác nữa, tránh 2 người tính trùng cùng 1 chai). cho_sx_at dùng
-- để tự động chuyển "Đã pha" sau 30 ngày nếu NCV quên xác nhận tay. mix_plan_id/mix_plan_me_so đánh
-- dấu rõ NL này thuộc đúng mẻ nào của kế hoạch nào, để xác nhận "Đã pha" riêng từng mẻ.

alter table materials add column if not exists cho_sx boolean not null default false;
alter table materials add column if not exists cho_sx_at timestamptz;
alter table materials add column if not exists mix_plan_id bigint references mix_plans(id) on delete set null;
alter table materials add column if not exists mix_plan_me_so integer;
