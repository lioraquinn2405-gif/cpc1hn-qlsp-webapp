import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "-") return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
};
const parsePh = (s) => {
  const v = num(s);
  // Excel đôi khi lưu 1 ngày tháng bị gõ nhầm vào ô pH dưới dạng số serial (vd 45664) —
  // pH thật luôn trong khoảng 0-14. Ngoài khoảng đó là dữ liệu SAI (đánh dấu riêng),
  // khác với "chưa nhập" (v == null).
  if (v == null) return { ph: null, ph_invalid: false };
  if (v < 0 || v > 14) return { ph: null, ph_invalid: true };
  return { ph: v, ph_invalid: false };
};
const DIACRITICS_RE = new RegExp(
  String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93),
  "g"
);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "").replace(/đ/g, "d").trim();
const detectStrain = (txt) => {
  const j = norm(txt);
  if (/sf\d/.test(j) || /\bg4\b/.test(j) || /subtil/.test(j)) return "subtilis";
  if (/sa\d/.test(j) || /\bg3\b/.test(j) || /claus/.test(j)) return "clausii";
  return null;
};
const splitLo = (s) => {
  s = (s || "").trim();
  const m = s.match(/^(.*?)[.\s]*(C\d+)$/i);
  return m ? { lo: m[1].trim(), chai: m[2].toUpperCase() } : { lo: s, chai: "" };
};

const HEADER_RULES = [
  [/lo\s*chung/, "loChung"], [/so\s*lo/, "soLo"], [/nhiem\s*con/, "nhiemConNao"],
  [/nhiem/, "nhiemKhuan"], [/^stt/, "stt"], [/ten/, "tenNL"], [/dot/, "dotSanXuat"],
  [/the\s*tich|dich/, "vDich"], [/cam\s*quan/, "camQuan"], [/nhan/, "mdNhan"],
  [/sh|sinh\s*hoc/, "mdSH"], [/bao\s*tu/, "tyLeBaoTu"], [/tinh\s*trang/, "tinhTrangSrc"],
  [/ghi\s*chu/, "ghiChu"], [/^me|me\s*pha/, "meChe"], [/^ph$|do\s*ph/, "pH"], [/chung/, "chung"],
];
function mapHeader(cells) {
  const map = {};
  cells.forEach((cell, i) => {
    const n = norm(cell);
    if (!n) return;
    for (const [re, key] of HEADER_RULES) {
      if (map[key] != null) continue;
      if (re.test(n)) { map[key] = i; break; }
    }
  });
  return map;
}

function findHeaderRowIndex(grid) {
  // Vài sheet nguồn có tới 2-3 hàng "trông giống tiêu đề" (hàng ghi chú/hướng dẫn
  // cũng lặp lại chữ "Số lô"). Chọn hàng khớp được NHIỀU cột nhất, không phải hàng
  // đầu tiên tình cờ chứa chữ "Số lô".
  let bestIdx = -1, bestScore = 0;
  const limit = Math.min(grid.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = grid[i];
    if (!row.some((c) => /so\s*lo/.test(norm(c)))) continue;
    const score = Object.keys(mapHeader(row)).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}
function parseWorkbook(wb) {
  const out = [];
  const perSheet = {};
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: false });
    if (!grid.length) continue;
    const hIdx = findHeaderRowIndex(grid);
    if (hIdx < 0) { perSheet[name] = { found: 0, note: "không có hàng tiêu đề chứa 'Số lô'" }; continue; }
    const map = mapHeader(grid[hIdx]);
    let found = 0, skippedNoStrain = 0;
    for (let i = hIdx + 1; i < grid.length; i++) {
      const r = grid[i];
      const g = (k) => (map[k] != null ? String(r[map[k]] ?? "").trim() : "");
      const soLo = g("soLo");
      if (!soLo) continue;
      if (!/\d{2}/.test(soLo)) continue; // dòng tiêu đề/ghi chú lẫn vào (vd "Chủng", "G3"), lô thật luôn có mã ngày tháng
      const strain = detectStrain([g("tenNL"), g("chung"), soLo, name].join(" "));
      if (!strain) { skippedNoStrain++; continue; }
      const { lo, chai } = splitLo(soLo);
      const tinhTrangSrc = g("tinhTrangSrc");
      const daPha = /da\s*pha/.test(norm(tinhTrangSrc));
      out.push({
        strain, stt: g("stt"), ten_nl: g("tenNL"), chung: g("chung"),
        dot_san_xuat: g("dotSanXuat"), so_lo: soLo, lo, chai, lo_chung: g("loChung"),
        v_dich: num(g("vDich")), cam_quan: g("camQuan"), ...parsePh(g("pH")),
        md_nhan: num(g("mdNhan")), md_sh: num(g("mdSH")), ty_le_bao_tu: num(g("tyLeBaoTu")),
        nhiem_khuan: g("nhiemKhuan"), nhiem_con_nao: g("nhiemConNao"), tinh_trang_src: tinhTrangSrc,
        ghi_chu: g("ghiChu"), me_che: g("meChe"), da_pha: daPha,
        pha_product: daPha ? (g("ghiChu") || null) : null,
        pha_me: daPha ? (g("meChe") || null) : null,
      });
      found++;
    }
    perSheet[name] = { found, skippedNoStrain };
  }
  return { rows: out, perSheet };
}

function dedupeBySoLo(rows) {
  const seen = new Map();
  let dupes = 0;
  for (const r of rows) {
    if (seen.has(r.so_lo)) { dupes++; continue; }
    seen.set(r.so_lo, r);
  }
  return { unique: Array.from(seen.values()), dupes };
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/import-xlsx.mjs <duong-dan-file.xlsx>"); process.exitCode = 1; return; }
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  // Dùng service_role key (bỏ qua RLS) vì từ khi bật đăng nhập bắt buộc, anon key
  // không còn quyền ghi materials nữa. Thêm SUPABASE_SERVICE_KEY vào .env (KHÔNG
  // đặt tiền tố VITE_ để không bị lộ ra bundle trình duyệt).
  const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Thiếu VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY trong .env"); process.exitCode = 1; return; }
  if (!env.SUPABASE_SERVICE_KEY) console.log('Cảnh báo: không thấy SUPABASE_SERVICE_KEY trong .env, đang dùng anon key — sẽ lỗi quyền ghi nếu RLS đã siết yêu cầu đăng nhập.');

  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: "buffer" });
  const { rows: rawRows, perSheet } = parseWorkbook(wb);

  console.log("Các tab đọc được:");
  for (const [name, info] of Object.entries(perSheet)) {
    console.log(`  - ${name}: ${info.found ?? 0} dòng hợp lệ` + (info.skippedNoStrain ? `, bỏ qua ${info.skippedNoStrain} dòng không nhận diện được chủng` : "") + (info.note ? ` (${info.note})` : ""));
  }
  if (!rawRows.length) { console.log("Không có dòng nào để đẩy."); return; }

  const { unique: rows, dupes } = dedupeBySoLo(rawRows);
  console.log(`Tổng ${rawRows.length} dòng, trùng "Số lô" giữa các tab: ${dupes} (giữ bản ghi xuất hiện đầu tiên, bỏ qua các lần lặp lại sau) → còn ${rows.length} dòng duy nhất sẽ đẩy lên.`);

  const chunkSize = 200;
  let pushed = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const resp = await fetch(`${url}/rest/v1/materials?on_conflict=so_lo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!resp.ok) {
      console.error(`Lỗi ở lô ${i}-${i + chunk.length}: HTTP ${resp.status} — ${await resp.text()}`);
      process.exitCode = 1;
      return;
    }
    pushed += chunk.length;
    console.log(`Đã đẩy ${pushed}/${rows.length} dòng...`);
  }
  console.log(`Hoàn tất: đã nạp/cập nhật ${pushed} bản ghi vào Supabase.`);
}

await main();
