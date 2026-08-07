-- Chạy trong SQL Editor. Tách "Thành phần" thành 2 ô riêng cho SP 2 thành phần (vd Co-biozin:
-- Thành phần = "B. clausii", Thành phần 2 = "B. subtilis") thay vì gộp chung 1 chuỗi.

alter table products add column if not exists thanh_phan2 text;
