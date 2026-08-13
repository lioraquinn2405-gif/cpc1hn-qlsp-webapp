import { supabase } from "./supabaseClient.js";

const FIELDS = [
  ["id", "id"], ["maSP", "ma_sp"], ["soOngMucTieu", "so_ong_muc_tieu"],
  ["ketQua", "ket_qua"], ["trangThai", "trang_thai"], ["ghiChu", "ghi_chu"],
  ["createdBy", "created_by"], ["decidedBy", "decided_by"], ["decidedAt", "decided_at"],
  ["createdAt", "created_at"], ["supersededById", "superseded_by_id"],
];
const toCamel = (row) => Object.fromEntries(FIELDS.map(([camel, snake]) => [camel, row[snake]]));

export async function fetchMixPlans(maSP) {
  const { data, error } = await supabase
    .from("mix_plans")
    .select("*")
    .eq("ma_sp", maSP)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data.map(toCamel);
}

/** Lấy nhiều kế hoạch theo id (dùng ở tab "Chờ SX" — mỗi mẻ đang chờ SX cần soi lại đúng ket_qua gốc
 * của kế hoạch đã Duyệt để hiện lại bảng mẻ pha đầy đủ, cho NCV đối chiếu trước khi xác nhận đã pha). */
export async function fetchMixPlansByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("mix_plans").select("*").in("id", ids);
  if (error) throw error;
  return data.map(toCamel);
}

export async function insertMixPlan({ maSP, soOngMucTieu, ketQua, createdBy }) {
  const { data, error } = await supabase
    .from("mix_plans")
    .insert({ ma_sp: maSP, so_ong_muc_tieu: soOngMucTieu, ket_qua: ketQua, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function decideMixPlan(id, { trangThai, ghiChu, decidedBy }) {
  const { data, error } = await supabase
    .from("mix_plans")
    .update({ trang_thai: trangThai, ghi_chu: ghiChu ?? null, decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return toCamel(data);
}

/** Lưu 1 kế hoạch kèm quyết định duyệt ngay (người tính = người duyệt, trường hợp phổ biến ở đội nhỏ). */
export async function saveMixPlanDecision({ maSP, soOngMucTieu, ketQua, trangThai, ghiChu, actorId }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("mix_plans")
    .insert({
      ma_sp: maSP, so_ong_muc_tieu: soOngMucTieu, ket_qua: ketQua,
      trang_thai: trangThai, ghi_chu: ghiChu ?? null,
      created_by: actorId, decided_by: actorId, decided_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function removeMixPlan(id) {
  const { error } = await supabase.from("mix_plans").delete().eq("id", id);
  if (error) throw error;
}

/** Nhờ AI (DeepSeek, qua api/ai-review-mix-plan.js) giải thích/rà soát 1 kết quả kế hoạch đã tính
 * xong — AI chỉ diễn giải, không tự tính lại. Bấm nút "AI rà soát" mới gọi (không tự động). */
export async function reviewMixPlanWithAi(planSummary) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Chưa đăng nhập.");
  const res = await fetch("/api/ai-review-mix-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ planSummary }),
  });
  const rawText = await res.text();
  let body;
  try { body = JSON.parse(rawText); } catch { body = {}; }
  // Chưa xác định được nguyên nhân lỗi thật (báo NCV 2026-08-10, server luôn trả JSON hợp lệ khi
  // tự test trực tiếp) — tạm in kèm mã HTTP + đoạn đầu nội dung thô để biết chính xác đang nhận về
  // cái gì (server lỗi không phải JSON? bị chặn ở tầng khác trước khi tới server?), XOÁ SAU KHI
  // xác định xong nguyên nhân, đừng để lại vĩnh viễn.
  if (!res.ok) throw new Error(body.error || `Không rà soát được (HTTP ${res.status}, phản hồi: ${rawText.slice(0, 200) || "(rỗng)"})`);
  return body.explanation;
}

/** Lưu bản đã SỬA của 1 kế hoạch "Cần điều chỉnh": tạo 1 dòng lịch sử MỚI (không ghi đè) rồi đánh
 * dấu dòng GỐC là "đã sửa, xem dòng mới" qua superseded_by_id — dòng gốc vẫn còn nguyên làm lưu vết. */
export async function saveEditedMixPlanDecision({ originalId, maSP, soOngMucTieu, ketQua, trangThai, ghiChu, actorId }) {
  const saved = await saveMixPlanDecision({ maSP, soOngMucTieu, ketQua, trangThai, ghiChu, actorId });
  const { error } = await supabase.from("mix_plans").update({ superseded_by_id: saved.id }).eq("id", originalId);
  if (error) throw error;
  return saved;
}
