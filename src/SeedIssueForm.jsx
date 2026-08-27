// In ấn cho "Bảo quản chủng giống" — tiện ích thuần (không phải component), mở cửa sổ mới,
// ghi HTML tự chứa, gọi window.print(), cùng letterhead CPC1HN cho cả 3 loại tài liệu:
//   1. Phiếu xuất/nhập chủng — dựng lại đúng mẫu Word đang dùng ("GMP26Form xuất nhập
//      chủng.docx"), 1 giao dịch/1 tờ. Dùng từ MovementModal (in ngay khi đang điền, kể cả
//      chưa lưu) và MovementLog (in lại 1 lượt đã lưu).
//   2. Sổ lịch sử xuất/nhập của 1 lô — gộp TOÀN BỘ movements của lô đó thành 1 bảng, có số
//      dư chạy, thay cho việc lục nhiều phiếu lẻ.
//   3. Bảng kiểm kê chủng giống theo tủ — danh sách lô còn hàng trong 1 hay nhiều tủ, có
//      tổng cộng, để đối chiếu khi đếm ống thật.
// Cùng cách in như SeedLabel.jsx — không đấu CSS với phần còn lại của app, in ra giống nhau
// mọi máy. Mỗi lượt xuất/nhập trong DB gắn đúng 1 lô (seed_lot_id not null) nên phiếu ở đây
// luôn là 1 dòng chủng — không hỗ trợ gộp nhiều chủng trong 1 phiếu.
import { splitTenChung } from "./SeedLabel.jsx";
import { MUC_DICH_LABEL, MOVEMENT_LABEL, DIEU_KIEN_LUU_LABEL } from "./lib/seedLotsApi.js";

// Logo CPC1HN lấy thẳng từ file mẫu Word (word/media/image1.png), nhúng base64 để bản in
// tự chứa hoàn toàn, không phụ thuộc file ngoài.
const LOGO_B64 = "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";

export const MOI_LOAI = { xuat: "xuất", nhap: "nhập" };
export const TIEU_DE = { xuat: "PHIẾU XUẤT CHỦNG", nhap: "PHIẾU NHẬP CHỦNG" };
export const NGUOI_THUC_HIEN_LABEL = { xuat: "Người xuất", nhap: "Người nhập" };

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const isoToVN = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN");
};
const nowVN = () => new Date().toLocaleString("vi-VN");

// Letterhead dùng chung cho cả 3 loại tài liệu — tách riêng để không lặp lại logo/quốc hiệu
// 3 lần trong file.
const LETTERHEAD_CSS = `
  .header td { vertical-align: top; padding: 0 4pt; font-size: 10pt; }
  .header .logo { width: 20mm; }
  .header .logo img { width: 18mm; }
  .header .bold { font-weight: bold; }
  .header .right { text-align: center; }
  .header .underline { border-bottom: 0.5pt solid #000; display:inline-block; }
  .header .addr { font-size: 9pt; }
  h1 { text-align:center; font-size: 18pt; margin: 14pt 0 10pt; }
`;
function renderLetterheadHTML() {
  return `<table class="header">
    <tr>
      <td class="logo" rowspan="2"><img src="data:image/png;base64,${LOGO_B64}" alt="CPC1HN" /></td>
      <td class="bold">CÔNG TY CỔ PHẦN DƯỢC PHẨM</td>
      <td class="bold right">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</td>
    </tr>
    <tr>
      <td class="bold">CPC1 HÀ NỘI</td>
      <td class="bold right"><span class="underline">Độc lập – Tự do – Hạnh phúc</span></td>
    </tr>
    <tr>
      <td class="addr" colspan="2">Địa chỉ: Cụm CN Hà Bình Phương - Thường Tín – Hà Nội<br/>Điện thoại: 04.33765503 – số máy lẻ 2801</td>
      <td></td>
    </tr>
  </table>`;
}

// "Tên" trên phiếu là tên loài vi sinh vật (vd "Bacillus clausii"), khác "Mã chủng" (vd
// "G3") — suy từ tenChung của lô (tách đúng cách splitTenChung dùng ở nhãn); rất nhiều lô để
// trống tenChung nên còn dự phòng loaiTheoMa[maChung] từ danh mục chủng, truyền vào qua
// fallbackTen. Không để người dùng tự gõ — bấm đúng từ lô nào thì phải ra đúng tên loài lô đó.
export function tenLoaiCuaLo(lot, fallbackTen = "") {
  return splitTenChung(lot?.tenChung).loai || fallbackTen || "";
}

/** Dựng HTML phiếu — tách riêng khỏi openPhieuPrint để chỗ gọi có thể window.open() TRƯỚC
 * (đồng bộ, ngay trong lúc bấm) rồi mới lưu xong mới ghi nội dung vào — nếu mở cửa sổ SAU 1
 * bước async (vd đợi lưu DB) thì trình duyệt sẽ coi là popup tự bật và chặn luôn. */
export function renderPhieuHTML({ loai, ten, maChung, soLo, nsx, hd, soLuong, mucDichText, mucDichLoai, loSanXuat, ngay, nguoiThucHien, nguoiKiemTra, nguoiPheDuyet }) {
  const tuLoai = MOI_LOAI[loai];
  const d = ngay ? new Date(ngay) : new Date();
  const ngayStr = Number.isNaN(d.getTime())
    ? "ngày &emsp; tháng &emsp; năm 20&emsp;"
    : `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>${esc(TIEU_DE[loai])}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13pt; color:#000; margin:0; }
  table { border-collapse: collapse; width:100%; }
  ${LETTERHEAD_CSS}
  .field { margin: 4pt 0; }
  .data { margin-top: 8pt; }
  .data th, .data td { border: 0.5pt solid #000; padding: 4pt 6pt; font-size: 13pt; }
  .data th { font-weight:bold; text-align:center; }
  .data td.c { text-align:center; }
  .ngay { text-align:right; font-style:italic; margin: 14pt 0 4pt; }
  .sign { margin-top: 4pt; text-align:center; }
  .sign th { font-weight:bold; padding-bottom: 4pt; width:33%; }
  .sign .name { height: 10pt; font-weight: 500; }
  .sign .space { height: 60pt; }
  @media screen { body { padding:14mm; background:#f8fafc; } }
</style></head><body>
  ${renderLetterheadHTML()}
  <h1>${esc(TIEU_DE[loai])}</h1>
  <p class="field">Tên: ${esc(ten)}</p>
  <p class="field">Mục đích ${tuLoai}: ${esc(mucDichText)}</p>
  ${mucDichLoai === "san_xuat" ? `<p class="field">Lô sản xuất liên quan: ${esc(loSanXuat)}</p>` : ""}
  <table class="data">
    <thead><tr><th>STT</th><th>Mã chủng</th><th>Số lô chủng</th><th>NSX</th><th>HD</th><th>Số lượng</th></tr></thead>
    <tbody>
      <tr>
        <td class="c">1</td><td>${esc(maChung)}</td><td>${esc(soLo)}</td>
        <td class="c">${esc(isoToVN(nsx))}</td><td class="c">${esc(isoToVN(hd))}</td><td class="c">${esc(soLuong)}</td>
      </tr>
    </tbody>
  </table>
  <p class="ngay">Hà Nội, ${ngayStr}</p>
  <table class="sign">
    <tr><th>${esc(NGUOI_THUC_HIEN_LABEL[loai])}</th><th>Người kiểm tra</th><th>Người phê duyệt</th></tr>
    <tr><td class="space"></td><td class="space"></td><td class="space"></td></tr>
    <tr><td class="name">${esc(nguoiThucHien)}</td><td class="name">${esc(nguoiKiemTra)}</td><td class="name">${esc(nguoiPheDuyet)}</td></tr>
  </table>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;
}

/** Mở cửa sổ + in ngay, tất cả trong 1 lần gọi đồng bộ (dùng khi KHÔNG có bước lưu DB xen
 * giữa, vd in lại từ lịch sử). Trả về false nếu bị chặn pop-up. */
export function openPhieuPrint(data) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(renderPhieuHTML(data));
  w.document.close();
  return true;
}

/* ============================ Sổ lịch sử xuất/nhập (1 lô) ============================ */

/** Dựng HTML sổ lịch sử — gộp TOÀN BỘ movements của 1 lô thành 1 bảng, tính số dư chạy
 * (Còn lại) thay vì phải lục nhiều phiếu lẻ. Lô tạo mới KHÔNG sinh movement cho số ống ban
 * đầu (AddLotForm ghi thẳng so_ong/so_ong_ban_dau lên lenmen_seed_lots) nên số dư phải bắt
 * đầu từ soOngBanDau — dòng cuối phải khớp lot.soOng hiện tại, dùng để tự kiểm tra.
 * Tách riêng khỏi việc mở cửa sổ (giống renderPhieuHTML) — chỗ gọi cần window.open() TRƯỚC
 * nếu phải đợi fetch movements (tránh bị chặn popup do mở cửa sổ sau 1 bước async). */
export function renderSoLoHistoryHTML({ lot, ten, movements }) {
  const opening = lot.soOngBanDau ?? lot.soOng ?? 0;
  const sorted = [...(movements || [])].sort((a, b) => {
    if (a.ngay !== b.ngay) return (a.ngay || "") < (b.ngay || "") ? -1 : 1;
    return (a.id || 0) - (b.id || 0);
  });
  let running = opening;
  const rowsHtml = sorted.map((m, i) => {
    running += m.loai === "nhap" ? Number(m.soOng) : -Number(m.soOng);
    const mucDich = [m.mucDichLoai ? MUC_DICH_LABEL[m.mucDichLoai] : null, m.mucDich || null].filter(Boolean).join(" · ");
    return `<tr>
      <td class="c">${i + 1}</td><td class="c">${esc(isoToVN(m.ngay))}</td><td class="c">${esc(MOVEMENT_LABEL[m.loai])}</td>
      <td class="c">${m.loai === "nhap" ? "+" : "−"}${esc(m.soOng)}</td>
      <td>${esc(mucDich)}</td><td class="c">${esc(m.loSanXuat)}</td>
      <td>${esc(m.nguoiThucHien)}</td><td>${esc(m.nguoiKiemTra)}</td><td>${esc(m.nguoiPheDuyet)}</td>
      <td class="c b">${esc(running)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Sổ lô ${esc(lot.soLo)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color:#000; margin:0; }
  table { border-collapse: collapse; width:100%; }
  ${LETTERHEAD_CSS}
  .info { margin: 10pt 0; }
  .info td { padding: 2pt 10pt 2pt 0; font-size: 10.5pt; }
  .info b { font-weight: 600; }
  .data { margin-top: 6pt; }
  .data th, .data td { border: 0.5pt solid #000; padding: 3pt 5pt; font-size: 9.5pt; }
  .data th { font-weight:bold; text-align:center; background:#f0f0f0; }
  .data td.c { text-align:center; }
  .data td.b { font-weight: 700; }
  .tong { text-align:right; font-weight:700; margin-top:6pt; }
  .footer { margin-top: 10pt; font-size: 9pt; color:#555; }
  @media screen { body { padding:12mm; background:#f8fafc; } }
</style></head><body>
  ${renderLetterheadHTML()}
  <h1>SỔ THEO DÕI XUẤT/NHẬP CHỦNG GIỐNG</h1>
  <table class="info">
    <tr><td><b>Mã chủng:</b> ${esc(lot.maChung)}</td><td><b>Tên loài:</b> ${esc(ten)}</td><td><b>Số lô:</b> ${esc(lot.soLo)}</td></tr>
    <tr><td><b>Kho:</b> ${esc(DIEU_KIEN_LUU_LABEL[lot.dieuKienLuu] || "Chưa gán kho")}</td><td><b>Vị trí:</b> ${esc(lot.viTri) || "–"}</td><td><b>Nguồn gốc:</b> ${esc(lot.nguonGoc) || "–"}</td></tr>
    <tr><td><b>NSX:</b> ${esc(isoToVN(lot.ngaySanXuat)) || "–"}</td><td><b>HSD:</b> ${esc(isoToVN(lot.hanSuDung)) || "–"}</td><td><b>Số ống ban đầu:</b> ${esc(opening)}</td></tr>
  </table>
  <table class="data">
    <thead><tr>
      <th>STT</th><th>Ngày</th><th>Loại</th><th>Số ống</th><th>Mục đích</th><th>Lô SX liên quan</th>
      <th>Người xuất/nhập</th><th>Người kiểm tra</th><th>Người phê duyệt</th><th>Còn lại</th>
    </tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="10" class="c">Chưa có lượt xuất/nhập nào.</td></tr>`}</tbody>
  </table>
  <p class="tong">Tồn hiện tại: ${esc(lot.soOng ?? 0)} ống</p>
  <p class="footer">In lúc: ${esc(nowVN())}</p>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;
}

/* ============================ Bảng kiểm kê chủng giống ============================ */

/** Dựng + mở cửa sổ in bảng kiểm kê — 1 lần gọi đồng bộ (không có fetch xen giữa, dữ liệu
 * đã có sẵn trong state lots của SeedLotPanel). `groups`: [{ khoLabel, rows }], rows đã lọc
 * sẵn (còn hàng thật, chưa huỷ) và sắp xếp — hàm này chỉ render, không tự lọc/sắp. */
export function printKiemKe({ groups, ngay }) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const multi = groups.length > 1;
  let tongLo = 0, tongOng = 0;

  const groupsHtml = groups.map((g) => {
    const soLo = g.rows.length;
    const soOng = g.rows.reduce((a, r) => a + (Number(r.soOng) || 0), 0);
    tongLo += soLo; tongOng += soOng;
    const rowsHtml = g.rows.map((r, i) => `<tr>
        <td class="c">${i + 1}</td><td>${esc(r.maChung)}</td><td>${esc(r.tenChung)}</td><td>${esc(r.soLo)}</td>
        <td>${esc(r.viTri) || "–"}</td><td class="c">${esc(isoToVN(r.ngaySanXuat)) || "–"}</td>
        <td class="c">${esc(isoToVN(r.hanSuDung)) || "–"}</td><td class="c b">${esc(r.soOng)}</td>
      </tr>`).join("");
    return `
      <h2>${esc(g.khoLabel)}</h2>
      <table class="data">
        <thead><tr><th>STT</th><th>Mã chủng</th><th>Tên chủng</th><th>Số lô</th><th>Vị trí</th><th>NSX</th><th>HSD</th><th>Số ống còn</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="c">Không có lô nào còn hàng trong tủ này.</td></tr>`}</tbody>
      </table>
      <p class="cong">Cộng — ${esc(g.khoLabel)}: ${soLo} lô, ${soOng} ống</p>`;
  }).join("");

  const d = ngay ? new Date(ngay) : new Date();
  const ngayStr = `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Bảng kiểm kê chủng giống</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color:#000; margin:0; }
  table { border-collapse: collapse; width:100%; }
  ${LETTERHEAD_CSS}
  h2 { font-size: 12pt; margin: 12pt 0 4pt; }
  .sub { text-align:center; font-size:10.5pt; color:#333; margin-top:-6pt; }
  .data th, .data td { border: 0.5pt solid #000; padding: 3pt 5pt; font-size: 9.5pt; }
  .data th { font-weight:bold; text-align:center; background:#f0f0f0; }
  .data td.c { text-align:center; }
  .data td.b { font-weight: 700; }
  .cong { text-align:right; font-weight:700; margin: 2pt 0 0; }
  .tongcong { text-align:right; font-weight:700; font-size:12pt; margin-top:10pt; border-top:0.5pt solid #000; padding-top:6pt; }
  .ngay { text-align:right; font-style:italic; margin: 14pt 0 4pt; }
  .sign { margin-top: 4pt; text-align:center; }
  .sign th { font-weight:bold; padding-bottom: 4pt; width:50%; }
  .sign .name { height: 10pt; font-weight: 500; }
  .sign .space { height: 60pt; }
  @media screen { body { padding:12mm; background:#f8fafc; } }
</style></head><body>
  ${renderLetterheadHTML()}
  <h1>BẢNG KIỂM KÊ CHỦNG GIỐNG</h1>
  <p class="sub">${multi ? "Tất cả kho" : esc(groups[0]?.khoLabel || "")}</p>
  ${groupsHtml}
  ${multi ? `<p class="tongcong">TỔNG CỘNG TOÀN KHO: ${tongLo} lô, ${tongOng} ống</p>` : ""}
  <p class="ngay">Hà Nội, ${ngayStr}</p>
  <table class="sign">
    <tr><th>Người kiểm kê</th><th>Người xác nhận</th></tr>
    <tr><td class="space"></td><td class="space"></td></tr>
    <tr><td class="name"></td><td class="name"></td></tr>
  </table>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;

  w.document.write(html);
  w.document.close();
  return true;
}
