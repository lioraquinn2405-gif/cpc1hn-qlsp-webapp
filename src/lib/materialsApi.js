import { supabase } from "./supabaseClient.js";

const MATERIAL_FIELDS = [
  ["id", "id"], ["strain", "strain"], ["stt", "stt"], ["tenNL", "ten_nl"],
  ["chung", "chung"], ["dotSanXuat", "dot_san_xuat"], ["thoiGianThu", "thoi_gian_thu"], ["soLo", "so_lo"],
  ["lo", "lo"], ["chai", "chai"], ["loChung", "lo_chung"], ["vDich", "v_dich"],
  ["camQuan", "cam_quan"], ["pH", "ph"], ["mdNhan", "md_nhan"], ["mdSH", "md_sh"],
  ["tyLeBaoTu", "ty_le_bao_tu"], ["nhiemKhuan", "nhiem_khuan"],
  ["nhiemConNao", "nhiem_con_nao"], ["tinhTrangSrc", "tinh_trang_src"],
  ["ghiChu", "ghi_chu"], ["meChe", "me_che"], ["daPha", "da_pha"], ["daPhaAt", "da_pha_at"],
  ["phaProduct", "pha_product"], ["phaMe", "pha_me"], ["loai", "loai"],
  ["phInvalid", "ph_invalid"], ["pendingDelete", "pending_delete"], ["deletedAt", "deleted_at"],
  ["choSX", "cho_sx"], ["choSxAt", "cho_sx_at"], ["mixPlanId", "mix_plan_id"], ["mixPlanMeSo", "mix_plan_me_so"],
  ["createdBy", "created_by"], ["updatedBy", "updated_by"],
];
const PRODUCT_FIELDS = [
  ["maSP", "ma_sp"], ["tenSP", "ten_sp"], ["pool", "pool"],
  ["thanhPhan", "thanh_phan"], ["hamLuong", "ham_luong"],
  ["tubeMl", "tube_ml"], ["soOngNhip", "so_ong_nhip"], ["ncv", "ncv"],
  ["pool2", "pool2"], ["hamLuong2", "ham_luong2"], ["thanhPhan2", "thanh_phan2"], ["allowOtherLoai", "allow_other_loai"],
  ["sortOrder", "sort_order"],
];

const toCamel = (fields) => (row) =>
  Object.fromEntries(fields.map(([camel, snake]) => [camel, row[snake]]));
const toSnakeKey = (fields) => (camel) =>
  fields.find(([c]) => c === camel)?.[1] ?? camel;

const materialToCamel = toCamel(MATERIAL_FIELDS);
const materialSnakeKey = toSnakeKey(MATERIAL_FIELDS);
const productToCamel = toCamel(PRODUCT_FIELDS);
const productSnakeKey = toSnakeKey(PRODUCT_FIELDS);
const productToSnake = (p) =>
  Object.fromEntries(PRODUCT_FIELDS.map(([camel, snake]) => [snake, p[camel]]));

const PAGE_SIZE = 1000;

export async function fetchMaterials() {
  // Supabase/PostgREST giới hạn tối đa PAGE_SIZE dòng mỗi lần gọi — phải tự phân
  // trang để lấy hết, nếu không dữ liệu vượt quá PAGE_SIZE sẽ âm thầm bị cắt mất.
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("materials")
      .select("*")
      .order("so_lo", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all.map(materialToCamel);
}

export async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("ma_sp");
  if (error) throw error;
  return data.map(productToCamel);
}

export async function updateMaterialField(id, field, value, actorId) {
  const patch = { [materialSnakeKey(field)]: value };
  if (actorId) patch.updated_by = actorId;
  const { error } = await supabase.from("materials").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updateMaterialFields(id, patchByFields, actorId) {
  const snakePatch = Object.fromEntries(
    Object.entries(patchByFields).map(([k, v]) => [materialSnakeKey(k), v])
  );
  if (actorId) snakePatch.updated_by = actorId;
  const { error } = await supabase.from("materials").update(snakePatch).eq("id", id);
  if (error) throw error;
}

export async function removeMaterial(id) {
  const { error } = await supabase.from("materials").delete().eq("id", id);
  if (error) throw error;
}

export async function confirmMixBatch(ids, patchByFields, actorId) {
  const snakePatch = Object.fromEntries(
    Object.entries(patchByFields).map(([k, v]) => [materialSnakeKey(k), v])
  );
  if (actorId) snakePatch.updated_by = actorId;
  const { error } = await supabase.from("materials").update(snakePatch).in("id", ids);
  if (error) throw error;
}

export async function insertMaterialsBulk(rows) {
  const payload = rows.map((r) => {
    const { id, ...rest } = r;
    // Chỉ gửi field caller thực sự cung cấp — field bị bỏ qua hoàn toàn (không gửi
    // null tường minh) để Postgres tự áp dụng giá trị default (vd cột not-null
    // như ph_invalid, da_pha) thay vì báo lỗi vi phạm ràng buộc.
    const obj = {};
    for (const [camel, snake] of MATERIAL_FIELDS) {
      if (camel === "id") continue;
      if (camel in rest) obj[snake] = rest[camel];
    }
    return obj;
  });
  const saved = [];
  for (let i = 0; i < payload.length; i += PAGE_SIZE) {
    const chunk = payload.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("materials")
      .upsert(chunk, { onConflict: "so_lo" })
      .select();
    if (error) throw error;
    saved.push(...data);
  }
  return saved.map(materialToCamel);
}

export async function addProduct(product) {
  const { error } = await supabase.from("products").insert(productToSnake(product));
  if (error) throw error;
}

export async function updateProductField(maSP, field, value) {
  const { error } = await supabase
    .from("products")
    .update({ [productSnakeKey(field)]: value })
    .eq("ma_sp", maSP);
  if (error) throw error;
}

export async function removeProduct(maSP) {
  const { error } = await supabase.from("products").delete().eq("ma_sp", maSP);
  if (error) throw error;
}

export async function reorderProducts(orderedMaSPs) {
  const results = await Promise.all(
    orderedMaSPs.map((maSP, i) => supabase.from("products").update({ sort_order: i }).eq("ma_sp", maSP))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export function subscribeMaterials(onChange) {
  const channel = supabase
    .channel("materials-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
