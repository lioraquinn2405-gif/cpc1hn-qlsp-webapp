import { supabase } from "./supabaseClient.js";

const FIELDS = [
  ["id", "id"], ["tenSP", "ten_sp"], ["phaMe", "pha_me"], ["soLuongDuKien", "so_luong_du_kien"],
  ["tenHoanThien", "ten_hoan_thien"], ["soLo", "so_lo"], ["nsx", "nsx"], ["hsd", "hsd"],
  ["xuLyNguyenLieuDauVao", "xu_ly_nguyen_lieu_dau_vao"], ["xuLyBtpSauPha", "xu_ly_btp_sau_pha"],
  ["xuLySauDongOng", "xu_ly_sau_dong_ong"], ["quyTrinhKhac", "quy_trinh_khac"],
  ["createdBy", "created_by"], ["createdAt", "created_at"],
];
const toCamel = (row) => Object.fromEntries(FIELDS.map(([camel, snake]) => [camel, row[snake]]));
const snakeKey = (camel) => FIELDS.find(([c]) => c === camel)?.[1] ?? camel;

export async function fetchFinishedBatches() {
  const { data, error } = await supabase.from("finished_batches").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toCamel);
}

/** Tạo dòng lưu vết ngay lúc "Xác nhận đã pha" — 1 dòng / 1 mẻ (ten_sp+pha_me), bỏ qua nếu đã có
 * (không nên xảy ra vì pha_me luôn mới, nhưng phòng khi bấm xác nhận 2 lần).
 * Dùng ten_sp (không phải ma_sp) để khớp đúng cột thật đang có trên bảng finished_batches — mã SP
 * (ma_sp) có thể đổi bất cứ lúc nào trong tab "Sản phẩm", nên ProductionHistoryPanel tự tra lại
 * đúng ma_sp hiện tại bằng cách khớp tên (xem norm() trong App.jsx) thay vì lưu chết 1 bản copy dễ lệch. */
export async function createFinishedBatch({ tenSP, phaMe, soLuongDuKien, createdBy }) {
  const { error } = await supabase
    .from("finished_batches")
    .upsert(
      { ten_sp: tenSP, pha_me: phaMe, so_luong_du_kien: soLuongDuKien ?? null, created_by: createdBy },
      { onConflict: "ten_sp,pha_me", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function updateFinishedBatchField(id, field, value) {
  const { error } = await supabase.from("finished_batches").update({ [snakeKey(field)]: value }).eq("id", id);
  if (error) throw error;
}
