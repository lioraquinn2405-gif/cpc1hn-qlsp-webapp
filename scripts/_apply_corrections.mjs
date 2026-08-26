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

const TO_DA_PHA = [
  "010526SF1.C1","010526SF1.C2","010526SF1.C3","010526SF1.C4","010526SF1.C5",
  "010526SF1.C6","010526SF1.C8","010526SF1.C9","010526SF1.C10",
  "020526SF1.C1","020526SF1.C2","020526SF1.C3","020526SF1.C4","020526SF1.C5","020526SF1.C6",
  "020426SF1.C1","020426SF1.C2","020426SF1.C3","020426SF1.C4","020426SF1.C5","020426SF1.C6",
];
const TO_DA_HUY = [
  "040426SA1.C1",
  "26F01SA1.C1","26F01SA1.C2","26F01SA1.C3","26F01SA1.C4",
  "26F02SA1.C2","26F02SA1.C3","26F02SA1.C4",
];

const { data: d1, error: e1 } = await supabase
  .from("materials").update({ da_pha: true }).in("so_lo", TO_DA_PHA).select("so_lo");
if (e1) throw e1;
console.log(`Đã chuyển "Đã pha": ${d1.length}/${TO_DA_PHA.length}`);
if (d1.length !== TO_DA_PHA.length) {
  const found = new Set(d1.map((r) => r.so_lo));
  console.log("Không tìm thấy:", TO_DA_PHA.filter((x) => !found.has(x)));
}

const { data: d2, error: e2 } = await supabase
  .from("materials").update({ huy_thu_cong: true }).in("so_lo", TO_DA_HUY).select("so_lo");
if (e2) throw e2;
console.log(`Đã chuyển "Đã huỷ": ${d2.length}/${TO_DA_HUY.length}`);
if (d2.length !== TO_DA_HUY.length) {
  const found = new Set(d2.map((r) => r.so_lo));
  console.log("Không tìm thấy:", TO_DA_HUY.filter((x) => !found.has(x)));
}
