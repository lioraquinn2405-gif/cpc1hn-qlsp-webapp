-- Chạy trong SQL Editor: thêm cột đánh dấu "chờ xoá" (Thùng rác) cho nguyên liệu
-- ở tab "NL chờ pha" — bấm xoá sẽ chuyển vào đây thay vì xoá thật ngay lập tức.

alter table materials add column if not exists pending_delete boolean not null default false;
