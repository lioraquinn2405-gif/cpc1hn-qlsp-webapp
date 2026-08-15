-- Danh mục chủng giống + bổ sung cột kho, theo file "THEO DÕI CHỦNG".
-- Chạy sau migration_lenmen_giong_kho.sql.
--
-- File này có thứ 2 file trước không có: quy tắc mã hoá chủng, danh mục chủng gốc,
-- và số ống tồn thật. Trước đó mọi lô đều để tồn = 0 vì sổ cũ chỉ ghi tình trạng bằng lời.

/* ============================== Danh mục chủng ============================== */

-- Mã chủng đánh theo quy tắc AAbb.c.Dd:
--   AA  tiền mã     PL = phân lập, SX = sản xuất, NC = nghiên cứu
--   bb  chủng       01 B.subtilis · 02 B.clausii · 03 Bifido · 04 B.coagulans
--                   05 Saccharomyces · 06 Lactobacillus
--   c   nhà cung cấp 1 Legend Bio · 2 Viện · 3 CPC1HN
--   D   dạng lưu    G = glycerol, Đ = đông khô
--   d   thứ tự chủng cùng một nguồn
-- Không tách 5 thành phần này thành 5 cột: mã là khoá nghiệp vụ người dùng gõ tay và
-- đọc trực tiếp, tách ra chỉ tổ phải ghép lại ở mọi chỗ hiển thị.
create table if not exists lenmen_strains (
  ma_chung text primary key,
  ten_loai text,
  -- Khay lưu trong tủ: A B.subtilis · B B.clausii · C Bifido/Lacto/Saccharo · D B.coagulans
  khay text,
  nha_cung_cap text,
  -- Diễn giải nguồn gốc, vd "BS/Huyền/Bào tử/glycerol" = chủng/người phân lập/dạng/môi trường
  thong_tin text,
  -- Vòng đời chủng: Gốc, NC, NC -> SX, Chuẩn bị sản xuất, ĐANG SX, Ngừng cấp, Ngừng mua
  tinh_trang text,
  ghi_chu text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists lenmen_strains_set_updated_at on lenmen_strains;
create trigger lenmen_strains_set_updated_at
  before update on lenmen_strains
  for each row execute function set_updated_at();

/* ========================= Bổ sung cột cho sổ lô ========================= */

alter table lenmen_seed_lots
  -- "ống", "ống 1,5ml", "Ống đông khô" — đơn vị khác nhau theo dạng lưu, cần ghi rõ
  -- vì 1 ống đông khô và 1 ống glycerol không tương đương nhau.
  add column if not exists don_vi_tinh text,
  add column if not exists thong_tin text;

/* ==================================== RLS ==================================== */

alter table lenmen_strains enable row level security;

create policy "lenmen_strains_select_approved" on lenmen_strains for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "lenmen_strains_insert_approved" on lenmen_strains for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
create policy "lenmen_strains_update_approved" on lenmen_strains for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
