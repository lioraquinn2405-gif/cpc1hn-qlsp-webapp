-- Chạy trong SQL Editor. Thêm cột ma_hoa_than_ong (Mã hóa thân ống, vd "32126I") cho từng sản phẩm
-- ở tab "Sản phẩm" -> Danh mục; khi tạo thông tin gửi mail ở "Chờ SX" ô "Mã hóa lô" tự lấy giá trị này.

alter table products add column if not exists ma_hoa_than_ong text;
