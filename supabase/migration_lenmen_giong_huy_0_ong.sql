-- Huỷ 1 lô đã hết ống (so_ong = 0) trước đó KHÔNG ghi được vào lenmen_seed_movements —
-- constraint cũ bắt buộc so_ong > 0 cho MỌI loại (nhập/xuất/huỷ), nên NCV xác nhận huỷ mà
-- lô hết ống sẵn thì không hiện gì ở "Nhật ký xuất/nhập" cả, dù lô đã bị đánh dấu Đã huỷ.
-- Nới đúng cho loại "huy" được phép so_ong = 0 (huỷ lô rỗng), "nhap"/"xuat" vẫn bắt buộc > 0
-- như cũ (xuất/nhập 0 ống là vô nghĩa, không nới). Chạy 1 lần trong Supabase Dashboard >
-- SQL Editor.

alter table lenmen_seed_movements
  drop constraint if exists lenmen_seed_movements_so_ong_check;
alter table lenmen_seed_movements
  add constraint lenmen_seed_movements_so_ong_check
  check (so_ong > 0 or (so_ong = 0 and loai = 'huy'));
