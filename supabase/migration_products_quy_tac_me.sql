-- Chạy trong SQL Editor. Thêm cột quy_tac_me (jsonb) cho "quy tắc mẻ riêng" của từng sản phẩm, sửa được ở
-- tab Sản phẩm -> Danh mục (cột "Quy tắc mẻ"). Dạng: {"maxV":2000,"minV":1000,"maxLots":3,"oneLo":true}
--   maxV = cỡ lô tối đa (L), minV = cỡ lô tối thiểu (L), maxLots = tối đa chai/mẻ, oneLo = chỉ dùng NL của
--   cùng 1 lô sản xuất trong 1 mẻ, wholeBottle = dùng hết chai (không chia dở), goodMin/goodMax = khoảng cỡ lô lý tưởng. Để trống (null) = dùng quy tắc chung (tank 1080L, ≤3 chai/mẻ, mẻ ≥700L).

alter table products add column if not exists quy_tac_me jsonb;

-- Baciforte (chốt NCV 2026-10-27/28): chỉ có clausii; cỡ lô tối đa 2000L, tối thiểu 1000L, tối đa 3 chai NL/mẻ,
-- cùng 1 lô, DÙNG HẾT chai (không chia dở cho mẻ sau); mẻ lý tưởng 1300-1700L, không được thì đẩy sát trần 2000L.
-- (Chạy lại file này an toàn: ghi đè quy tắc cũ của Baciforte.)
update products
set quy_tac_me = '{"maxV":2000,"minV":1000,"maxLots":3,"oneLo":true,"wholeBottle":true,"goodMin":1300,"goodMax":1700}'::jsonb
where ten_sp ilike '%baciforte%';
