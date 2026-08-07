-- Chạy trong SQL Editor. Cho phép 1 sản phẩm clausii-loai1/loai2 CHẤP NHẬN dùng loại NL còn lại
-- làm dự phòng khi loại chính không đủ (vd Progermila ưu tiên loại 1 nhưng vẫn dùng được loại 2;
-- Co-biozin ưu tiên loại 2 nhưng vẫn dùng được loại 1) — mặc định false (giữ nguyên hành vi cũ:
-- chỉ dùng đúng loại đã khai báo).

alter table products add column if not exists allow_other_loai boolean not null default false;
