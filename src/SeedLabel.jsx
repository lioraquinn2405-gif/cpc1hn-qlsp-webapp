// Tạo nhãn chủng giống để in — dựng lại đúng 2 mẫu đang dùng trong file Excel:
//
//   NHÃN ỐNG  : một dòng gọn, in cả tờ nhiều ô giống nhau để dán từng ống
//               "Bacillus subtilis BH1 PL01.3.G4 Lô 010526 NSX: 20/05/26 HSD: 19/05/27"
//   NHÃN HỘP  : khối chi tiết dán ngoài hộp/khay
//               Chủng giống / Mã chủng / Số lô / NSX / HSD / Nguồn gốc / Người làm
//
// In bằng cách mở cửa sổ riêng với HTML tự chứa: không phải đấu với layout và CSS của
// app, và bản in ra giống nhau trên mọi máy.
import React, { useState } from "react";
import { X, Printer } from "lucide-react";

const d2 = (n) => String(n).padStart(2, "0");

// "20/05/26" — nhãn ống dùng năm 2 số cho ngắn, đúng như mẫu đang in.
function fmtShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
// "20/05/2026" — nhãn hộp ghi đủ 4 số năm.
function fmtFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Nhãn hộp tách tên chi thành 2 ô ("Bacillus clausii" | "G3"), trong khi sổ lưu gộp
 * một chuỗi viết tắt ("B.clausii G3"). Bung viết tắt và tách phần định danh cuối.
 */
export function splitTenChung(tenChung) {
  const t = (tenChung || "").trim();
  if (!t) return { loai: "", ma: "" };
  const expanded = t.replace(/^B\./i, "Bacillus ").replace(/^L\./i, "Lactobacillus ").replace(/\s+/g, " ");
  const parts = expanded.split(" ");
  if (parts.length >= 3) return { loai: parts.slice(0, -1).join(" "), ma: parts[parts.length - 1] };
  return { loai: expanded, ma: "" };
}

/** Dòng chữ trên nhãn ống — giữ nguyên thứ tự và cách ghi của mẫu cũ. */
export function tubeLabelText(lot) {
  return [
    [lot.tenChung, lot.maChung].filter(Boolean).join(" "),
    `Lô ${lot.soLo}`,
    `NSX: ${fmtShort(lot.ngaySanXuat)}`,
    `HSD: ${fmtShort(lot.hanSuDung)}`,
  ].join(" ");
}

/* ------------------------------- HTML để in ------------------------------- */

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Kích thước nhãn do người dùng đo trên tờ nhãn thật rồi nhập vào — KHÔNG suy ra được
// từ file Excel (độ rộng cột Excel không phải milimet).
function printDocument(lot, tubeCount, kt) {
  const text = esc(tubeLabelText(lot));
  const { loai, ma } = splitTenChung(lot.tenChung);
  const cells = Array.from({ length: tubeCount }, () => `<div class="o">${text}</div>`).join("");

  const hop = [
    ["Chủng giống", `${esc(loai)}${ma ? " — " + esc(ma) : ""}`],
    ["Mã chủng", esc(lot.maChung)],
    ["Số lô", esc(lot.soLo)],
    ["NSX", esc(fmtFull(lot.ngaySanXuat))],
    ["HSD", esc(fmtFull(lot.hanSuDung))],
    ["Nguồn gốc", esc(lot.nguonGoc)],
    ["Người làm", esc(lot.nguoiLam)],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");

  const KT = kt;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Nhãn ${esc(lot.maChung)} - Lô ${esc(lot.soLo)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; margin:0; }
  h2 { font-size: 12pt; margin: 0 0 4mm; }
  /* Nhãn ống: lưới 7 cột như tờ nhãn đang in */
  .luoi { display:grid; grid-template-columns: repeat(${KT.cot}, ${KT.rong}mm); gap:${KT.cach}mm; }
  .o { border:0.3mm solid #000; padding:1mm; font-size:${KT.chu}pt; line-height:1.2;
       width:${KT.rong}mm; height:${KT.cao}mm; box-sizing:border-box;
       display:flex; align-items:center; justify-content:center; text-align:center;
       overflow:hidden; word-break:break-word; }
  /* Nhãn hộp */
  .hop { margin-top:8mm; page-break-before:always; }
  table { border-collapse:collapse; width:110mm; font-size:11pt; }
  th, td { border:0.3mm solid #000; padding:2mm 3mm; text-align:left; }
  th { width:35mm; font-weight:600; background:#f0f0f0; }
  @media screen { body { padding:10mm; background:#f8fafc; } }
</style></head><body>
  <h2>Nhãn ống — ${text}</h2>
  <div class="luoi">${cells}</div>
  <div class="hop"><h2>Nhãn hộp</h2><table>${hop}</table></div>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;
}

/* --------------------------------- Modal --------------------------------- */

// Mặc định theo tờ nhãn A4 hay dùng; đo lại tờ thật rồi sửa cho khớp.
const KT_MAC_DINH = { cot: 7, rong: 25, cao: 15, cach: 1, chu: 5 };
const KT_KEY = "lenmen-kich-thuoc-nhan";

export default function SeedLabelModal({ lot, onClose }) {
  const [count, setCount] = useState(28);
  // Nhớ kích thước đã đo để lần in sau khỏi nhập lại.
  const [kt, setKt] = useState(() => {
    try { return { ...KT_MAC_DINH, ...JSON.parse(localStorage.getItem(KT_KEY) || "{}") }; }
    catch { return KT_MAC_DINH; }
  });
  const setKtField = (k) => (e) => {
    const v = { ...kt, [k]: Number(e.target.value) || 0 };
    setKt(v);
    try { localStorage.setItem(KT_KEY, JSON.stringify(v)); } catch { /* bỏ qua */ }
  };
  const { loai, ma } = splitTenChung(lot.tenChung);

  const inNhan = () => {
    const w = window.open("", "_blank");
    if (!w) { alert("Trình duyệt chặn cửa sổ bật lên — cho phép pop-up rồi thử lại."); return; }
    w.document.write(printDocument(lot, Math.max(1, Math.min(200, Number(count) || 1)), kt));
    w.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-semibold text-sm">Tạo nhãn — lô {lot.soLo}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs text-slate-500 mb-1.5">Nhãn ống (xem trước)</div>
            <div className="border border-slate-800 bg-white flex items-center justify-center text-center overflow-hidden"
              style={{ width: kt.rong + "mm", height: kt.cao + "mm", fontSize: kt.chu + "pt", lineHeight: 1.2, padding: "1mm" }}>
              {tubeLabelText(lot)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Khung trên đúng bằng kích thước sẽ in ra.</p>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1.5">Nhãn hộp (xem trước)</div>
            <table className="text-xs border border-slate-800 border-collapse">
              <tbody>
                {[
                  ["Chủng giống", loai + (ma ? " — " + ma : "")],
                  ["Mã chủng", lot.maChung],
                  ["Số lô", lot.soLo],
                  ["NSX", fmtFull(lot.ngaySanXuat)],
                  ["HSD", fmtFull(lot.hanSuDung)],
                  ["Nguồn gốc", lot.nguonGoc],
                  ["Người làm", lot.nguoiLam],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th className="border border-slate-800 px-2 py-1 text-left bg-slate-100 font-medium w-28">{k}</th>
                    <td className="border border-slate-800 px-2 py-1">{v || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs text-slate-500 mb-2">
              Kích thước nhãn ống — <span className="text-amber-700">đo trên tờ nhãn thật rồi nhập vào</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {[["cot", "Số cột"], ["rong", "Rộng (mm)"], ["cao", "Cao (mm)"], ["cach", "Cách nhau (mm)"], ["chu", "Cỡ chữ (pt)"]].map(([k, label]) => (
                <div key={k}>
                  <label className="text-[11px] text-slate-500">{label}</label>
                  <input type="number" min="1" value={kt[k]} onChange={setKtField(k)}
                    className="block mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm w-24 text-right" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-500">Số nhãn ống cần in</label>
              <input type="number" min="1" max="200" value={count} onChange={(e) => setCount(e.target.value)}
                className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-28" />
            </div>
            <button onClick={inNhan}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-md">
              <Printer className="w-4 h-4" /> In nhãn
            </button>
          </div>

          {!lot.ngaySanXuat && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Lô này chưa có ngày sản xuất nên nhãn sẽ thiếu NSX/HSD. Bổ sung NSX trước khi in.
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            Nhãn ống in lưới 7 cột trên khổ A4; nhãn hộp in sang trang riêng.
          </p>
        </div>
      </div>
    </div>
  );
}
