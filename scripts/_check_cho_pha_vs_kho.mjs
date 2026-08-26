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

const KHO_WHITELIST = new Set(JSON.parse(fs.readFileSync(
  "/tmp/claude-1000/-home-admin1/b0db7554-33af-43c7-8e82-2ab160abe88e/scratchpad/kho_whitelist.json", "utf8"
)));
const REPORT_START = new Date("2026-07-01");

const EXPIRY_MONTHS = 13;
const DISPOSAL_MONTHS = 24;
function monthsSince(rec) {
  if (!rec.dot_san_xuat) return null;
  const m = String(rec.dot_san_xuat).match(/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const start = new Date(Number(m[2]), Number(m[1]) - 1, 1);
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
function classify(rec) {
  const months = monthsSince(rec);
  const disposed = (months != null && months >= DISPOSAL_MONTHS) || rec.huy_thu_cong;
  const expired = months != null && months >= EXPIRY_MONTHS;
  const reasons = [];
  if (expired) reasons.push("expired");
  const nk = norm(rec.nhiem_khuan);
  const isFail = nk.includes("khong");
  const legacySubPattern = isFail && /sub/.test(norm(rec.nhiem_con_nao));
  const isPassSub = rec.strain === "clausii" && ((!isFail && nk.includes("dat") && nk.includes("sub")) || legacySubPattern);
  const isPass = !isFail && !isPassSub && nk.includes("dat");
  const missingNhiemConNao = isFail && !isPassSub && !rec.nhiem_con_nao;
  if (!nk || missingNhiemConNao) {
    if (reasons.length) return disposed ? "da-huy" : "cho-xu-ly";
    return "cho-kqkn";
  }
  if (rec.strain === "clausii") {
    if (!isPass && !isPassSub) reasons.push("fail");
  } else if (!isPass) reasons.push("fail");
  if (reasons.length) return disposed ? "da-huy" : "cho-xu-ly";
  return "cho-pha";
}
function statusOf(rec) {
  if (rec.da_pha) return "da-pha";
  if (rec.cho_sx) return "cho-sx";
  if (rec.pending_delete) return "cho-xoa";
  return classify(rec);
}

const all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("materials").select("*").range(from, from + 999);
  if (error) throw error;
  all.push(...data);
  if (data.length < 1000) break;
}

const choPha = all.filter((r) => statusOf(r) === "cho-pha");
console.log(`Tổng số chai đang "Chờ pha" trên web: ${choPha.length}`);

const oldNotInKho = choPha.filter((r) => {
  if (!r.thoi_gian_thu) return false;
  const thu = new Date(r.thoi_gian_thu);
  if (isNaN(thu) || thu >= REPORT_START) return false;
  return !KHO_WHITELIST.has(r.so_lo);
});
console.log(`\nChai "Chờ pha", thu TRƯỚC 01/07/2026, KHÔNG có trong file tồn kho (nghi đã pha thật nhưng web chưa cập nhật): ${oldNotInKho.length}`);
for (const r of oldNotInKho) {
  console.log(`${r.so_lo}\t${r.strain}\tthu=${r.thoi_gian_thu}\tloai=${r.loai}`);
}

const oldInKho = choPha.filter((r) => {
  if (!r.thoi_gian_thu) return false;
  const thu = new Date(r.thoi_gian_thu);
  if (isNaN(thu) || thu >= REPORT_START) return false;
  return KHO_WHITELIST.has(r.so_lo);
});
console.log(`\n(Đối chiếu) Chai "Chờ pha" thu trước 01/07/2026 mà VẪN có trong file tồn kho (khớp, không vấn đề): ${oldInKho.length}`);
for (const r of oldInKho) console.log(`${r.so_lo}\t${r.strain}\tthu=${r.thoi_gian_thu}`);

const noThu = choPha.filter((r) => !r.thoi_gian_thu);
console.log(`\n(Không đối chiếu được vì thiếu "Thời gian thu"): ${noThu.length}`);
for (const r of noThu) console.log(`${r.so_lo}\t${r.strain}\tdot_san_xuat=${r.dot_san_xuat}`);
