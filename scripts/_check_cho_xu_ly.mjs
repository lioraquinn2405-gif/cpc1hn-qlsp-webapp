import fs from "node:fs";
// Node 18 chưa có WebSocket toàn cục — supabase-js luôn khởi tạo RealtimeClient dù
// script này không dùng realtime, cần polyfill giả để không crash lúc tạo client.
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

const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Thiếu VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }
const supabase = createClient(url, key);

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

const choXuLy = all.filter((r) => statusOf(r) === "cho-xu-ly");
console.log(`Tổng số chai đang ở "Chờ xử lý" trên web: ${choXuLy.length}`);
for (const r of choXuLy) {
  console.log(`${r.so_lo}\t${r.strain}\tnhiem_khuan=${r.nhiem_khuan}\tnhiem_con_nao=${r.nhiem_con_nao}\thuy_thu_cong=${r.huy_thu_cong}`);
}
