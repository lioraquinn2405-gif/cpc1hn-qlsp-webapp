// Truy cập dữ liệu "Cảnh báo lên men" (3 bảng lenmen_*) — cùng khuôn với materialsApi.js:
// map camelCase <-> snake_case ở đúng một chỗ, tự phân trang, và trả về object đã camel hoá
// để component không phải biết tên cột Postgres.
import { supabase } from "./supabaseClient.js";

const BATCH_FIELDS = [
  ["id", "id"], ["rawMaterial", "raw_material"], ["lotNumber", "lot_number"],
  ["productionBatch", "production_batch"], ["factory", "factory"], ["scale", "scale"],
  ["finishedTubes", "finished_tubes"], ["qcResult", "qc_result"], ["isInfected", "is_infected"],
  ["contaminant", "contaminant"], ["notes", "notes"], ["qcDetails", "qc_details"],
  ["prepStatus", "prep_status"], ["densityDetails", "density_details"],
  ["concentrateSystem", "concentrate_system"], ["finalConcentrateStatus", "final_concentrate_status"],
  ["finalConcentrateDetail", "final_concentrate_detail"], ["plannedTime", "planned_time"],
  ["createdBy", "created_by"], ["updatedBy", "updated_by"],
  ["createdAt", "created_at"], ["updatedAt", "updated_at"],
];

const KHSX_FIELDS = [
  ["id", "id"], ["weekStart", "week_start"], ["rowKey", "row_key"], ["dayIndex", "day_index"],
  ["cellType", "cell_type"], ["freeText", "free_text"], ["lotNumber", "lot_number"],
  ["linkedBatchId", "linked_batch_id"], ["updatedBy", "updated_by"], ["updatedAt", "updated_at"],
];

const toCamel = (fields) => (row) =>
  Object.fromEntries(fields.map(([camel, snake]) => [camel, row[snake]]));
const toSnakeKey = (fields) => (camel) =>
  fields.find(([c]) => c === camel)?.[1] ?? camel;

const batchToCamel = toCamel(BATCH_FIELDS);
const batchSnakeKey = toSnakeKey(BATCH_FIELDS);
const khsxToCamel = toCamel(KHSX_FIELDS);

const PAGE_SIZE = 1000;

/* ------------------------------ Danh sách lô ------------------------------ */

export async function fetchBatches() {
  // PostgREST cắt ở PAGE_SIZE dòng mỗi lần gọi — phải tự phân trang, nếu không dữ liệu
  // vượt ngưỡng sẽ bị thiếu một cách âm thầm (xem fetchMaterials).
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("lenmen_batches")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all.map(batchToCamel);
}

function batchToSnake(batch) {
  const obj = {};
  for (const [camel, snake] of BATCH_FIELDS) {
    // Bỏ qua field caller không cung cấp để Postgres tự áp default (vd is_infected not null),
    // thay vì gửi null tường minh làm vi phạm ràng buộc.
    if (camel === "id" || camel === "createdAt" || camel === "updatedAt") continue;
    if (camel in batch) obj[snake] = batch[camel];
  }
  return obj;
}

export async function insertBatch(batch, actorId) {
  const payload = batchToSnake(batch);
  if (actorId) { payload.created_by = actorId; payload.updated_by = actorId; }
  const { data, error } = await supabase.from("lenmen_batches").insert(payload).select().single();
  if (error) throw error;
  return batchToCamel(data);
}

export async function updateBatch(id, patchByFields, actorId) {
  const patch = Object.fromEntries(
    Object.entries(patchByFields).map(([k, v]) => [batchSnakeKey(k), v])
  );
  if (actorId) patch.updated_by = actorId;
  // Trigger lenmen_auto_prep_status có thể tự đổi prep_status khi QC nhập kết quả cho lô
  // đang "Chờ lên men" — .select() để lấy lại giá trị DB đã chốt, không đoán ở client.
  const { data, error } = await supabase.from("lenmen_batches").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return batchToCamel(data);
}

export async function removeBatch(id) {
  const { error } = await supabase.from("lenmen_batches").delete().eq("id", id);
  if (error) throw error;
}

export function subscribeBatches(onChange) {
  const channel = supabase
    .channel("lenmen-batches-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "lenmen_batches" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* --------------------------- Kế hoạch sản xuất --------------------------- */

export async function fetchKhsxWeek(weekStart) {
  const { data, error } = await supabase
    .from("lenmen_khsx_plans")
    .select("*")
    .eq("week_start", weekStart);
  if (error) throw error;
  return data.map(khsxToCamel);
}

export async function saveKhsxCell(cell, actorId) {
  const lot = (cell.lotNumber || "").trim();
  const payload = {
    week_start: cell.weekStart,
    row_key: cell.rowKey,
    day_index: cell.dayIndex,
    cell_type: lot ? "fermentation" : "free_text",
    free_text: cell.freeText || "",
    lot_number: lot || null,
    linked_batch_id: cell.linkedBatchId ?? null,
  };
  if (actorId) payload.updated_by = actorId;
  const { data, error } = await supabase
    .from("lenmen_khsx_plans")
    .upsert(payload, { onConflict: "week_start,row_key,day_index" })
    .select()
    .single();
  if (error) throw error;
  return khsxToCamel(data);
}

/* -------------------------------- Cài đặt -------------------------------- */

// Bảng key/value -> object phẳng cho tiện dùng. Chỉ admin ghi được (RLS), nên
// component phải ẩn nút lưu với vai trò khác thay vì để người dùng bấm rồi báo lỗi.
export async function fetchLenmenSettings() {
  const { data, error } = await supabase.from("lenmen_settings").select("key, value");
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.key, r.value]));
}

export async function saveLenmenSettings(patch, actorId) {
  const rows = Object.entries(patch).map(([key, value]) => ({
    key,
    value: value == null ? null : String(value),
    ...(actorId ? { updated_by: actorId } : {}),
  }));
  const { error } = await supabase.from("lenmen_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

// Cài đặt lưu dạng chuỗi; giao diện cần số. Gom việc ép kiểu về một chỗ để component
// không rải parseFloat khắp nơi, và có sẵn giá trị mặc định khi bảng còn trống.
export function parseDensityConfig(settings) {
  const n = (key, fallback) => {
    const v = parseFloat(settings?.[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    cutoffMonth: n("density_cutoff_month", 5),
    cutoffYear: n("density_cutoff_year", 2026),
    chaiPer1000L: n("density_chai_per_1000l", 5),
    unitVolume: settings?.density_unit_volume || "L",
    unitDensity: settings?.density_unit_density || "10^8 CFU/ml",
    formula: {
      bh1: { mult: n("density_formula_bh1_mult", 1000), d1: n("density_formula_bh1_d1", 5.2), d2: n("density_formula_bh1_d2", 4.5) },
      g3: { mult: n("density_formula_g3_mult", 1000), d1: n("density_formula_g3_d1", 5.2), d2: n("density_formula_g3_d2", 4.5) },
    },
  };
}
