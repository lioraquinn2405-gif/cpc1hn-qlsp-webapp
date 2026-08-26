import fs from "node:fs";
globalThis.WebSocket ??= class {};
import { createClient } from "@supabase/supabase-js";

function loadEnv(p) {
  const text = fs.readFileSync(p, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv("/home/admin1/cpc1hn-qlsp-webapp/.env");
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const XU_LY_NL_DAU_VAO = "Không";
const XU_LY_BTP_SAU_PHA = "Thanh trùng cuối 70 độ/ 40 phút. Duy trì nhiệt độ 50 độ C sau pha và trong quá trình đóng";
const XU_LY_SAU_DONG_ONG = "Không";

const BATCHES = [
  { soLo: "26G04SA1.C3", pha_me: "32010826C13", soLuong: 190000, quyTrinhKhac: "Không" },
  { soLo: "26G04SA1.C4", pha_me: "32010826C14", soLuong: 190000, quyTrinhKhac: "Không" },
  { soLo: "26G04SA1.C1", pha_me: "32010826C09", soLuong: 197516, quyTrinhKhac: "Không" },
  { soLo: "26G04SA1.C2", pha_me: "32010826C10", soLuong: 191506, quyTrinhKhac: "Không" },
  { soLo: "26G01SA1.C1", pha_me: "32010826C11", soLuong: 120793, quyTrinhKhac: "Không" },
  { soLo: "26G01SA1.C2", pha_me: "32010826C12", soLuong: 121154, quyTrinhKhac: "Không" },
  { soLo: "26G02SA1.C1", pha_me: "32010826C01", soLuong: 123798, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G02SA1.C2", pha_me: "32010826C02", soLuong: 119391, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G02SA1.C3", pha_me: "32010826C03", soLuong: 122196, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G02SA1.C4", pha_me: "32010826C04", soLuong: 125401, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G03SA1.C1", pha_me: "32010826C05", soLuong: 180288, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G03SA1.C2", pha_me: "32010826C06", soLuong: 177083, quyTrinhKhac: "PHA VỈ 10 Ạ" },
  { soLo: "26G03SA1.C3", pha_me: "32010826C07", soLuong: 170513, quyTrinhKhac: "Không" },
  { soLo: "26G03SA1.C4", pha_me: "32010826C08", soLuong: 156130, quyTrinhKhac: "Không" },
];
const MA_SP = "PG0045";
const nowIso = new Date().toISOString();

for (const b of BATCHES) {
  const { data, error } = await supabase
    .from("materials")
    .update({ da_pha: true, da_pha_at: nowIso, pha_product: MA_SP, pha_me: b.pha_me, loai: 1 })
    .eq("so_lo", b.soLo)
    .select("so_lo");
  if (error) { console.error("Lỗi materials", b.soLo, error.message); continue; }
  if (!data.length) { console.error("KHÔNG TÌM THẤY materials.so_lo =", b.soLo); continue; }
  console.log("OK materials:", b.soLo, "->", b.pha_me);
}

const fbRows = BATCHES.map((b) => ({
  ten_sp: "Progermila",
  pha_me: b.pha_me,
  so_luong_du_kien: b.soLuong,
  xu_ly_nguyen_lieu_dau_vao: XU_LY_NL_DAU_VAO,
  xu_ly_btp_sau_pha: XU_LY_BTP_SAU_PHA,
  xu_ly_sau_dong_ong: XU_LY_SAU_DONG_ONG,
  quy_trinh_khac: b.quyTrinhKhac,
}));
const { data: fbData, error: fbError } = await supabase
  .from("finished_batches")
  .insert(fbRows)
  .select("pha_me");
if (fbError) { console.error("Lỗi finished_batches:", fbError.message); }
else console.log(`\nĐã ghi finished_batches: ${fbData.length}/${BATCHES.length}`);
