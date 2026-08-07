-- Chạy trong SQL Editor. Thêm cột sort_order để admin có thể kéo thả sắp xếp lại thứ tự
-- hiển thị sản phẩm trong tab "Sản phẩm" (thay vì luôn xếp theo Mã SP A-Z). Sản phẩm hiện có
-- được gán số thứ tự ban đầu theo đúng thứ tự A-Z hiện tại để không bị xáo trộn.

alter table products add column if not exists sort_order integer;

update products
set sort_order = ranked.rn
from (
  select ma_sp, row_number() over (order by ma_sp) - 1 as rn
  from products
) ranked
where products.ma_sp = ranked.ma_sp
  and products.sort_order is null;
