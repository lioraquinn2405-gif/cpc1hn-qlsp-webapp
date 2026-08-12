// Bảo quản chủng giống: sổ lô ống chủng + theo dõi độ ổn định theo mốc tháng.
// Cùng khuôn các *Api.js khác — map camel <-> snake ở một chỗ.
import { supabase } from "./supabaseClient.js";

const LOT_FIELDS = [
  ["id", "id"], ["soLo", "so_lo"], ["maChung", "ma_chung"], ["tenChung", "ten_chung"],
  ["dieuKienLuu", "dieu_kien_luu"], ["ngaySanXuat", "ngay_san_xuat"],
  ["hanSuDung", "han_su_dung"], ["ngaySanXuatRaw", "ngay_san_xuat_raw"],
  ["nguonGoc", "nguon_goc"], ["matDo", "mat_do"], ["nhiemKhuan", "nhiem_khuan"],
  ["doDongDeu", "do_dong_deu"], ["khaNangTaoBaoTu", "kha_nang_tao_bao_tu"],
  ["tinhTrangSx", "tinh_trang_sx"], ["nguoiLam", "nguoi_lam"], ["ghiChu", "ghi_chu"],
  ["createdBy", "created_by"], ["updatedBy", "updated_by"],
  ["createdAt", "created_at"], ["updatedAt", "updated_at"],
];

const STABILITY_FIELDS = [
  ["id", "id"], ["seedLotId", "seed_lot_id"], ["mocThang", "moc_thang"],
  ["ngayKiem", "ngay_kiem"], ["me", "me"],
  ["matDoOngChung", "mat_do_ong_chung"], ["doDongDeu", "do_dong_deu"],
  ["matDoCoDac", "mat_do_co_dac"], ["khaNangTaoBaoTu", "kha_nang_tao_bao_tu"],
  ["gioiHanNhiemKhuan", "gioi_han_nhiem_khuan"], ["ghiChu", "ghi_chu"],
  ["createdBy", "created_by"], ["updatedBy", "updated_by"],
];

const toCamel = (fields) => (row) =>
  Object.fromEntries(fields.map(([camel, snake]) => [camel, row[snake]]));
const toSnakeKey = (fields) => (camel) =>
  fields.find(([c]) => c === camel)?.[1] ?? camel;

const lotToCamel = toCamel(LOT_FIELDS);
const lotSnakeKey = toSnakeKey(LOT_FIELDS);
const stabilityToCamel = toCamel(STABILITY_FIELDS);

export const DIEU_KIEN_LUU_LABEL = {
  am_20: "Tủ −20°C",
  nito_long: "Nitơ lỏng (−196°C)",
};

// Ngưỡng đạt của 5 chỉ tiêu theo dõi, in kèm bảng để người nhập khỏi phải nhớ.
export const STABILITY_CRITERIA = [
  { key: "matDoOngChung", label: "Mật độ ống chủng", nguong: "≥ 10⁹ CFU/ml", numeric: true },
  { key: "doDongDeu", label: "Độ đồng đều", nguong: "Xét OD NCC1" },
  { key: "matDoCoDac", label: "Mật độ cô đặc", nguong: "≥ 10¹⁰ CFU/ml", numeric: true },
  { key: "khaNangTaoBaoTu", label: "Khả năng tạo bào tử", nguong: "≥ 70%" },
  { key: "gioiHanNhiemKhuan", label: "Giới hạn nhiễm khuẩn", nguong: "Không có tạp nhiễm" },
];

/* --------------------------------- Sổ lô --------------------------------- */

export async function fetchSeedLots() {
  const { data, error } = await supabase
    .from("lenmen_seed_lots")
    .select("*")
    .order("ngay_san_xuat", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data.map(lotToCamel);
}

function lotToSnake(lot) {
  const obj = {};
  for (const [camel, snake] of LOT_FIELDS) {
    if (["id", "createdAt", "updatedAt"].includes(camel)) continue;
    // Chuỗi rỗng -> bỏ hẳn field, để cột date không nhận "" (Postgres báo lỗi kiểu)
    if (camel in lot && lot[camel] !== "" && lot[camel] != null) obj[snake] = lot[camel];
  }
  return obj;
}

export async function insertSeedLot(lot, actorId) {
  const payload = lotToSnake(lot);
  if (actorId) { payload.created_by = actorId; payload.updated_by = actorId; }
  const { data, error } = await supabase
    .from("lenmen_seed_lots").insert(payload).select().single();
  if (error) throw error;
  return lotToCamel(data);
}

export async function updateSeedLot(id, patchByFields, actorId) {
  const patch = Object.fromEntries(
    Object.entries(patchByFields).map(([k, v]) => [lotSnakeKey(k), v === "" ? null : v])
  );
  if (actorId) patch.updated_by = actorId;
  // Trigger tự điền hạn dùng khi bỏ trống — lấy lại dòng DB đã chốt.
  const { data, error } = await supabase
    .from("lenmen_seed_lots").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return lotToCamel(data);
}

/* ------------------------------ Độ ổn định ------------------------------ */

export async function fetchStability(seedLotId) {
  const { data, error } = await supabase
    .from("lenmen_seed_stability")
    .select("*")
    .eq("seed_lot_id", seedLotId)
    .order("moc_thang", { ascending: true });
  if (error) throw error;
  return data.map(stabilityToCamel);
}

export async function saveStabilityPoint(point, actorId) {
  const payload = {
    seed_lot_id: point.seedLotId,
    moc_thang: Number(point.mocThang),
    ngay_kiem: point.ngayKiem || null,
    me: point.me || null,
    mat_do_ong_chung: point.matDoOngChung === "" ? null : point.matDoOngChung,
    do_dong_deu: point.doDongDeu || null,
    mat_do_co_dac: point.matDoCoDac === "" ? null : point.matDoCoDac,
    kha_nang_tao_bao_tu: point.khaNangTaoBaoTu || null,
    gioi_han_nhiem_khuan: point.gioiHanNhiemKhuan || null,
    ghi_chu: point.ghiChu || null,
  };
  if (actorId) payload.updated_by = actorId;
  const { data, error } = await supabase
    .from("lenmen_seed_stability")
    .upsert(payload, { onConflict: "seed_lot_id,moc_thang" })
    .select()
    .single();
  if (error) throw error;
  return stabilityToCamel(data);
}

/* ----------------------------- Lịch đến hạn ----------------------------- */

const DEFAULT_PROTOCOL = [
  { thang: 1, chi_tieu: ["Định lượng"] },
  { thang: 3, chi_tieu: ["Định lượng"] },
  { thang: 6, chi_tieu: ["Định lượng", "Khả năng tạo bào tử"] },
  { thang: 9, chi_tieu: ["Định lượng"] },
  { thang: 12, chi_tieu: ["Định lượng", "Khả năng tạo bào tử"] },
];

export function parseProtocol(settings) {
  try {
    const raw = settings?.seed_stability_protocol;
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PROTOCOL;
  } catch {
    return DEFAULT_PROTOCOL;
  }
}

export function monthsSince(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

/**
 * Mốc nào theo protocol đã tới hạn mà chưa có dòng kết quả tương ứng.
 * Đây chính là cột "Chỉ tiêu cần thực hiện" mà sheet "Lọc" đang tính bằng công thức.
 */
export function dueCheckpoints(lot, stabilityPoints, protocol, now = new Date()) {
  const months = monthsSince(lot.ngaySanXuat, now);
  if (months == null) return [];
  const done = new Set((stabilityPoints || []).map((p) => Number(p.mocThang)));
  return protocol.filter((p) => months >= p.thang && !done.has(p.thang));
}
