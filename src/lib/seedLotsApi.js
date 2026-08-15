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
  ["soOng", "so_ong"], ["soOngBanDau", "so_ong_ban_dau"], ["viTri", "vi_tri"],
  ["donViTinh", "don_vi_tinh"], ["thongTin", "thong_tin"],
  ["daHuy", "da_huy"], ["ngayHuy", "ngay_huy"], ["lyDoHuy", "ly_do_huy"],
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

// Ba nơi lưu. gui_80 là gửi ngoài chứ không phải tủ của xưởng — ghi rõ trong nhãn để
// người tra cứu biết là không xuống kho lấy ngay được.
export const DIEU_KIEN_LUU_LABEL = {
  am_20: "Tủ −20°C",
  nito_long: "Nitơ lỏng (−196°C)",
  gui_80: "Tủ −80°C (gửi ngoài)",
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

/* ---------------------------- Xuất / nhập kho ---------------------------- */

const MOVEMENT_FIELDS = [
  ["id", "id"], ["seedLotId", "seed_lot_id"], ["loai", "loai"], ["ngay", "ngay"],
  ["soOng", "so_ong"], ["mucDich", "muc_dich"], ["nguoiThucHien", "nguoi_thuc_hien"],
  ["mucDichLoai", "muc_dich_loai"], ["loSanXuat", "lo_san_xuat"],
  ["ghiChu", "ghi_chu"], ["createdBy", "created_by"], ["createdAt", "created_at"],
];
const movementToCamel = toCamel(MOVEMENT_FIELDS);

export const MOVEMENT_LABEL = { nhap: "Nhập kho", xuat: "Xuất kho", huy: "Huỷ" };

// 3 mục đích xuất kho. Xuất để SẢN XUẤT bắt buộc có số lô: kết quả kiểm nghiệm của lô
// đó sau này phải truy ngược được về đúng ống chủng đã dùng, nếu không thì lô nhiễm
// khuẩn sẽ không biết truy từ đâu. DB cũng chặn (constraint lenmen_movement_sx_can_lo).
export const MUC_DICH_XUAT = [
  { value: "san_xuat", label: "Sản xuất", canLo: true },
  { value: "nghien_cuu", label: "Nghiên cứu", canLo: false },
  { value: "gui_kiem_nghiem", label: "Gửi kiểm nghiệm", canLo: false },
];
export const MUC_DICH_LABEL = Object.fromEntries(MUC_DICH_XUAT.map((m) => [m.value, m.label]));

export async function fetchMovements(seedLotId) {
  const { data, error } = await supabase
    .from("lenmen_seed_movements")
    .select("*")
    .eq("seed_lot_id", seedLotId)
    .order("ngay", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data.map(movementToCamel);
}

/**
 * Ghi 1 lần xuất/nhập. Số tồn KHÔNG sửa ở đây — trigger lenmen_apply_movement trong DB
 * tự cộng/trừ và chặn xuất quá tồn, nên hai người thao tác cùng lúc vẫn ra số đúng.
 * Trả về dòng lô đã cập nhật để giao diện hiển thị tồn mới.
 */
export async function recordMovement(move, actorId) {
  const payload = {
    seed_lot_id: move.seedLotId,
    loai: move.loai,
    ngay: move.ngay || new Date().toISOString().slice(0, 10),
    so_ong: Number(move.soOng),
    muc_dich: move.mucDich || null,
    muc_dich_loai: move.mucDichLoai || null,
    lo_san_xuat: move.loSanXuat ? String(move.loSanXuat).trim() : null,
    nguoi_thuc_hien: move.nguoiThucHien || null,
    ghi_chu: move.ghiChu || null,
  };
  if (actorId) payload.created_by = actorId;

  const { error } = await supabase.from("lenmen_seed_movements").insert(payload);
  if (error) throw error;

  const { data, error: e2 } = await supabase
    .from("lenmen_seed_lots").select("*").eq("id", move.seedLotId).single();
  if (e2) throw e2;
  return lotToCamel(data);
}

/** Tồn kho gộp theo từng kho, để hiện thẻ tổng quan đầu trang. */
export function summarizeByKho(lots) {
  const out = {};
  for (const key of Object.keys(DIEU_KIEN_LUU_LABEL)) out[key] = { soLo: 0, soOng: 0 };
  out.chua_ro = { soLo: 0, soOng: 0 };
  for (const l of lots || []) {
    const k = l.dieuKienLuu && out[l.dieuKienLuu] ? l.dieuKienLuu : "chua_ro";
    out[k].soLo += 1;
    out[k].soOng += Number(l.soOng) || 0;
  }
  return out;
}

/** Lấy toàn bộ mốc theo dõi (dùng cho trang thống kê, không phải mở từng lô). */
export async function fetchAllStability() {
  const { data, error } = await supabase
    .from("lenmen_seed_stability")
    .select("*")
    .order("seed_lot_id", { ascending: true })
    .order("moc_thang", { ascending: true });
  if (error) throw error;
  return data.map(stabilityToCamel);
}

// Ngưỡng đạt để chấm mốc theo dõi. Chỉ tiêu định tính coi là không đạt khi ghi rõ
// "không đạt"; ô trống nghĩa là CHƯA ĐO, không phải trượt.
export function danhGiaMoc(point) {
  const fails = [];
  if (point.matDoOngChung != null && Number(point.matDoOngChung) < 1) fails.push("Mật độ ống chủng < 10⁹");
  if (point.matDoCoDac != null && Number(point.matDoCoDac) < 1) fails.push("Mật độ cô đặc < 10¹⁰");
  for (const [k, label] of [["doDongDeu", "Độ đồng đều"], ["khaNangTaoBaoTu", "Khả năng tạo bào tử"], ["gioiHanNhiemKhuan", "Giới hạn nhiễm khuẩn"]]) {
    const v = (point[k] || "").toLowerCase();
    if (v && /không đạt|khong dat|fail/.test(v)) fails.push(label);
  }
  const daDo = ["matDoOngChung", "matDoCoDac", "doDongDeu", "khaNangTaoBaoTu", "gioiHanNhiemKhuan"]
    .some((k) => point[k] != null && point[k] !== "");
  if (!daDo) return { trangThai: "chua_do", fails };
  return { trangThai: fails.length ? "khong_dat" : "dat", fails };
}

/* ---------------------------- Danh mục chủng ---------------------------- */

const STRAIN_FIELDS = [
  ["maChung", "ma_chung"], ["tenLoai", "ten_loai"], ["khay", "khay"],
  ["nhaCungCap", "nha_cung_cap"], ["thongTin", "thong_tin"],
  ["tinhTrang", "tinh_trang"], ["ghiChu", "ghi_chu"],
];
const strainToCamel = toCamel(STRAIN_FIELDS);

export async function fetchStrains() {
  const { data, error } = await supabase
    .from("lenmen_strains").select("*").order("khay").order("ma_chung");
  if (error) throw error;
  return data.map(strainToCamel);
}

// Mã chủng đánh theo quy tắc AAbb.c.Dd — giải mã để hiện chú thích khi cần, thay vì
// bắt người dùng nhớ bảng quy ước nằm trong sheet "Ma Hoa Chung".
const TIEN_MA = { PL: "Phân lập", SX: "Sản xuất", NC: "Nghiên cứu" };
const MA_CHUNG_LOAI = {
  "01": "B.subtilis", "02": "B.clausii", "03": "Bifidobacterium",
  "04": "B.coagulans", "05": "Saccharomyces", "06": "Lactobacillus",
};
const NHA_CUNG_CAP = { 1: "Legend Bio", 2: "Viện", 3: "CPC1HN" };
const DANG_LUU = { G: "Glycerol", "Đ": "Đông khô" };

export function giaiMaChung(maChung) {
  const m = String(maChung || "").match(/^([A-Z]{2})(\d{2})\.(\d)\.([GĐ])(\d+)$/i);
  if (!m) return null;
  const [, aa, bb, c, d] = m;
  return {
    tienMa: TIEN_MA[aa.toUpperCase()] || aa,
    loai: MA_CHUNG_LOAI[bb] || bb,
    nhaCungCap: NHA_CUNG_CAP[Number(c)] || c,
    dangLuu: DANG_LUU[d.toUpperCase()] || d,
  };
}

/**
 * Huỷ lô: ghi 1 lượt 'huy' vào nhật ký rồi đánh dấu lô đã huỷ.
 *
 * Huỷ khác xuất — xuất là lấy ra dùng, huỷ là bỏ đi. Vẫn đi qua nhật ký để giữ vết
 * ai huỷ, bao nhiêu ống, vì lý do gì (yêu cầu GMP), chứ không sửa thẳng tồn kho.
 */
export async function huyLot(lot, { soOng, ngay, lyDo, nguoiThucHien }, actorId) {
  const sl = Number(soOng) || 0;
  if (sl > 0) {
    // Trigger trong DB tự trừ tồn và chặn huỷ quá số đang có.
    await recordMovement({
      seedLotId: lot.id, loai: "huy", ngay, soOng: sl,
      mucDich: lyDo, nguoiThucHien,
    }, actorId);
  }
  const patch = {
    daHuy: true,
    ngayHuy: ngay || new Date().toISOString().slice(0, 10),
    lyDoHuy: lyDo || null,
  };
  return updateSeedLot(lot.id, patch, actorId);
}
