// Menu "Bảo quản chủng giống" — thay file Excel "File tổng SỐ LÔ" + các sheet theo dõi
// độ ổn định (DOD-*/SUBTILIS/CLAUSII) + sheet Lọc tính lịch đến hạn kiểm.
//
// Hai kho vật lý: tủ −20°C và nitơ lỏng. Mỗi lô nằm ở đúng một kho, có số ống tồn,
// xuất/nhập ghi vào nhật ký (DB tự cộng trừ tồn — xem migration_lenmen_giong_kho.sql).
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Loader2, ChevronRight, ChevronDown, AlertTriangle, Search,
  Snowflake, Tag, ArrowUpFromLine, ArrowDownToLine, X, BarChart3, List, Trash2, Printer, Pencil, BookOpen, ClipboardList, Check,
} from "lucide-react";
import { fetchLenmenSettings } from "./lib/lenmenApi.js";
import {
  fetchSeedLots, insertSeedLot, fetchStability, saveStabilityPoint,
  fetchMovements, fetchMovementPeople, recordMovement, updateMovement, summarizeByKho, fetchAllStability, fetchStrains, giaiMaChung, huyLot,
  fetchExportRequests, createExportRequest, deleteExportRequest,
  parseProtocol, dueCheckpoints, monthsSince,
  DIEU_KIEN_LUU_LABEL, STABILITY_CRITERIA, MOVEMENT_LABEL, MUC_DICH_XUAT, MUC_DICH_LABEL,
} from "./lib/seedLotsApi.js";
import SeedLabelModal from "./SeedLabel.jsx";
import { openPhieuPrint, renderPhieuHTML, renderSoLoHistoryHTML, printKiemKe, tenLoaiCuaLo, NGUOI_THUC_HIEN_LABEL } from "./SeedIssueForm.jsx";
import SeedReport from "./SeedReport.jsx";
import SeedStabilityChart from "./SeedStabilityChart.jsx";

const inputCls = "border border-slate-300 rounded-md px-3 py-2 text-sm";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "–");
const KHO_KEYS = Object.keys(DIEU_KIEN_LUU_LABEL);

// Mỗi lô chia 2 hàng: hàng 1 = định danh (số lô/mã chủng/tên chủng) + thao tác, hàng 2 =
// thông tin phụ (kho/tồn/quá hạn/NSX) — tách ra cho thoáng thay vì nhồi hết 1 hàng như trước.
// Cột cố định riêng cho từng hàng, dùng chung giữa hàng dữ liệu và hàng tiêu đề để luôn khớp
// cột (tránh lệch như hồi còn flex-wrap, mỗi hàng rộng khác nhau tuỳ độ dài chữ).
const LOT_ROW1_GRID = "grid grid-cols-[28px_20px_92px_84px_minmax(140px,1fr)_auto] gap-x-3 items-center";
const LOT_ROW2_GRID = "grid grid-cols-[48px_92px_72px_76px_1fr] gap-x-3 items-center";

// Lý do huỷ chọn nhanh — vẫn ghi chuỗi tự do vào DB (không có CHECK constraint như Mục đích
// xuất), "Khác" mở ô gõ tay để không bị bó buộc.
const LY_DO_HUY_OPTIONS = ["Quá hạn dùng", "Nhiễm khuẩn", "Hỏng tủ / sự cố bảo quản", "Không đạt độ ổn định", "Khác"];

/* ------------------------------ Tổng quan kho ------------------------------ */

function KhoCards({ lots, active, setActive }) {
  const sum = summarizeByKho(lots);
  const cards = [
    ...KHO_KEYS.map((k) => ({ key: k, label: DIEU_KIEN_LUU_LABEL[k], ...sum[k] })),
    { key: "chua_ro", label: "Chưa gán kho", ...sum.chua_ro },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
      {cards.map((c) => {
        const on = active === c.key;
        return (
          <button key={c.key} onClick={() => setActive(on ? "ALL" : c.key)}
            className={`bg-white rounded-lg border p-4 text-left transition ${on ? "border-slate-800 ring-1 ring-slate-800" : "border-slate-200 hover:border-slate-300"}`}>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Snowflake className="w-3.5 h-3.5" /> {c.label}
            </div>
            <div className="text-base font-semibold text-slate-800 mt-1">{c.soOng.toLocaleString("vi-VN")} ống</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{c.soLo} lô</div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------- Thêm lô ống chủng ---------------------------- */

function AddLotForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const empty = {
    soLo: "", maChung: "", tenChung: "", dieuKienLuu: "am_20", ngaySanXuat: "",
    nguonGoc: "", matDo: "", soOng: "", viTri: "", nguoiLam: "",
    nhiemKhuan: "Đạt", doDongDeu: "Đạt", khaNangTaoBaoTu: "Đạt",
  };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await onAdd({
        ...form,
        matDo: form.matDo === "" ? null : Number(form.matDo),
        soOng: form.soOng === "" ? 0 : Number(form.soOng),
        soOngBanDau: form.soOng === "" ? null : Number(form.soOng),
      });
      setForm(empty); setOpen(false);
    } catch (err) { setError(err.message || String(err)); }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-3 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-md">
        <Plus className="w-4 h-4" /> Nhập lô chủng mới
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mb-3 bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap items-end gap-3">
      <div><label className="text-xs text-slate-500">Số lô *</label>
        <input required value={form.soLo} onChange={set("soLo")} placeholder="010526" className={`block mt-1 ${inputCls} w-28 font-mono`} /></div>
      <div><label className="text-xs text-slate-500">Mã chủng *</label>
        <input required value={form.maChung} onChange={set("maChung")} placeholder="PL01.3.G4" className={`block mt-1 ${inputCls} w-32 font-mono`} /></div>
      <div><label className="text-xs text-slate-500">Tên chủng</label>
        <input value={form.tenChung} onChange={set("tenChung")} placeholder="B.subtilis BH1" className={`block mt-1 ${inputCls} w-40`} /></div>
      <div><label className="text-xs text-slate-500">Kho</label>
        <select value={form.dieuKienLuu} onChange={set("dieuKienLuu")} className={`block mt-1 ${inputCls}`}>
          {KHO_KEYS.map((k) => <option key={k} value={k}>{DIEU_KIEN_LUU_LABEL[k]}</option>)}
        </select></div>
      <div><label className="text-xs text-slate-500">Vị trí trong kho</label>
        <input value={form.viTri} onChange={set("viTri")} placeholder="Tủ 2 – Ngăn 3 – Hộp A" className={`block mt-1 ${inputCls} w-44`} /></div>
      <div><label className="text-xs text-slate-500">Số ống nhập</label>
        <input inputMode="numeric" value={form.soOng} onChange={set("soOng")} className={`block mt-1 ${inputCls} w-24 text-right`} /></div>
      <div><label className="text-xs text-slate-500">Ngày sản xuất</label>
        <input type="date" value={form.ngaySanXuat} onChange={set("ngaySanXuat")} className={`block mt-1 ${inputCls}`} /></div>
      <div><label className="text-xs text-slate-500">Nguồn gốc</label>
        <input value={form.nguonGoc} onChange={set("nguonGoc")} placeholder="2200122.C3" className={`block mt-1 ${inputCls} w-36`} /></div>
      <div><label className="text-xs text-slate-500">Mật độ (10⁹ CFU/ml)</label>
        <input inputMode="decimal" value={form.matDo} onChange={set("matDo")} className={`block mt-1 ${inputCls} w-28 text-right`} /></div>
      <div><label className="text-xs text-slate-500">Người làm</label>
        <input value={form.nguoiLam} onChange={set("nguoiLam")} className={`block mt-1 ${inputCls} w-28`} /></div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-md">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Lưu
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(""); }} className="text-sm text-slate-500 hover:text-slate-700 px-2">Huỷ</button>
      </div>
      <p className="text-[11px] text-slate-400 w-full">Bỏ trống hạn dùng thì hệ thống tự tính NSX + 1 năm, đúng như nhãn đang in. Lưu xong bấm “Nhãn” để in nhãn ống và nhãn hộp.</p>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}

/* ----------------------------- Xuất / nhập kho ----------------------------- */

/** `prefill`/`onApproved` chỉ dùng khi mở modal này để ADMIN DUYỆT 1 đề nghị xuất do QC gửi
 * (xem nút "Duyệt" ở tab Đề nghị xuất) — điền sẵn dữ liệu QC đã nhập, admin sửa lại thoải
 * mái nếu cần, bắt buộc điền thêm Người kiểm tra/Người phê duyệt như xuất bình thường; lưu
 * xong (`onApproved`) mới xoá dòng đề nghị gốc — không sửa gì khác trong luồng Xuất/Nhập
 * trực tiếp (prefill/onApproved đều undefined) so với trước. */
function MovementModal({ lot, loai, fallbackTen, people = { thucHien: [], kiemTra: [], pheDuyet: [] }, onNewPeople, prefill, onApproved, onClose, onDone }) {
  const [form, setForm] = useState({
    soOng: "", ngay: new Date().toISOString().slice(0, 10), mucDich: "", nguoiThucHien: "", ghiChu: "",
    nguoiKiemTra: "", nguoiPheDuyet: "",
    mucDichLoai: "san_xuat", loSanXuat: "",
    ...prefill,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const laXuat = loai !== "nhap";
  const canLoSanXuat = laXuat && form.mucDichLoai === "san_xuat";
  const nguoiLabel = NGUOI_THUC_HIEN_LABEL[laXuat ? "xuat" : "nhap"];

  // Dùng chung cho Lưu lẫn In phiếu — cả 2 đều thật sự lưu (In phiếu KHÔNG submit form nên
  // required trên input không tự chặn, phải kiểm tay). Phiếu thiếu số lô sản xuất bắt buộc
  // thì không cho lưu cũng không cho in, tránh in ra 1 tờ GMP thiếu đúng thông tin bắt buộc.
  const validate = () => {
    if (!form.soOng || Number(form.soOng) <= 0) { setError("Số ống là bắt buộc."); return false; }
    if (canLoSanXuat && !form.loSanXuat.trim()) {
      setError('Xuất để "Sản xuất" thì phải điền Số lô sản xuất.');
      return false;
    }
    if (prefill && (!form.nguoiKiemTra.trim() || !form.nguoiPheDuyet.trim())) {
      setError("Duyệt đề nghị xuất phải điền đủ Người kiểm tra và Người phê duyệt.");
      return false;
    }
    return true;
  };

  const doSave = async (openWin) => {
    setSaving(true); setError("");
    try {
      const updated = await recordMovement({
        ...form, seedLotId: lot.id, loai,
        mucDichLoai: laXuat ? form.mucDichLoai : null,
        loSanXuat: canLoSanXuat ? form.loSanXuat : null,
      });
      // Cửa sổ in đã mở SẴN trước bước lưu (đồng bộ trong lúc bấm) — chỉ còn ghi nội dung
      // vào, không mở mới ở đây, vì mở sau 1 bước async thế này sẽ bị trình duyệt chặn popup.
      if (openWin) {
        openWin.document.write(renderPhieuHTML({
          loai, ten: tenLoaiCuaLo(lot, fallbackTen),
          maChung: lot.maChung, soLo: lot.soLo, nsx: lot.ngaySanXuat, hd: lot.hanSuDung,
          soLuong: form.soOng, ngay: form.ngay,
          mucDichText: laXuat ? MUC_DICH_LABEL[form.mucDichLoai] : form.mucDich,
          mucDichLoai: laXuat ? form.mucDichLoai : null,
          loSanXuat: canLoSanXuat ? form.loSanXuat : null,
          nguoiThucHien: form.nguoiThucHien, nguoiKiemTra: form.nguoiKiemTra, nguoiPheDuyet: form.nguoiPheDuyet,
        }));
        openWin.document.close();
      }
      onNewPeople?.({ thucHien: form.nguoiThucHien, kiemTra: form.nguoiKiemTra, pheDuyet: form.nguoiPheDuyet });
      onDone(updated);
      await onApproved?.();
      onClose();
    } catch (err) {
      if (openWin) openWin.close(); // đóng luôn cửa sổ trắng đã mở nếu lưu lỗi
      setError(err.message || String(err));
    }
    setSaving(false);
  };

  const submit = (e) => { e.preventDefault(); if (validate()) doSave(null); };

  const inPhieu = () => {
    if (!validate()) return;
    // Mở cửa sổ NGAY trong lúc bấm (đồng bộ) rồi mới lưu — không đợi lưu xong mới mở, vì
    // mở sau await sẽ bị trình duyệt coi là popup tự bật và chặn.
    const w = window.open("", "_blank");
    if (!w) { setError("Trình duyệt chặn cửa sổ bật lên — cho phép pop-up rồi thử lại."); return; }
    doSave(w);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-semibold text-sm">{prefill ? "Duyệt đề nghị xuất" : MOVEMENT_LABEL[loai]} — lô {lot.soLo}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {prefill && (
            <div className="bg-sky-50 border border-sky-200 rounded-md p-2.5 text-xs text-sky-700">
              Dữ liệu điền sẵn từ đề nghị xuất — sửa lại nếu cần, rồi bắt buộc điền thêm Người kiểm tra/Người
              phê duyệt trước khi lưu.
            </div>
          )}
          <div className="text-xs text-slate-500">
            Tồn hiện tại: <span className="font-medium text-slate-800">{lot.soOng ?? 0} ống</span>
            {" · "}{DIEU_KIEN_LUU_LABEL[lot.dieuKienLuu] || "chưa gán kho"}
            {lot.viTri ? ` · ${lot.viTri}` : ""}
          </div>
          <div className="flex gap-3">
            <div><label className="text-xs text-slate-500">Số ống *</label>
              <input required inputMode="numeric" min="1" value={form.soOng} onChange={set("soOng")}
                className={`block mt-1 ${inputCls} w-28 text-right`} /></div>
            <div><label className="text-xs text-slate-500">Ngày</label>
              <input type="date" value={form.ngay} onChange={set("ngay")} className={`block mt-1 ${inputCls}`} /></div>
          </div>
          {laXuat ? (
            <>
              <div>
                <label className="text-xs text-slate-500">Mục đích xuất kho *</label>
                <select value={form.mucDichLoai} onChange={set("mucDichLoai")} className={`block mt-1 ${inputCls} w-full bg-white`}>
                  {MUC_DICH_XUAT.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {canLoSanXuat && (
                <div>
                  <label className="text-xs text-slate-500">Số lô sản xuất *</label>
                  <input required value={form.loSanXuat} onChange={set("loSanXuat")} placeholder="030825BSM"
                    className={`block mt-1 ${inputCls} w-full font-mono`} />
                  <p className="text-[11px] text-amber-700 mt-1">
                    Bắt buộc: kết quả kiểm nghiệm của lô này sau đó sẽ gắn ngược về ống chủng vừa xuất,
                    để khi lô nhiễm khuẩn còn truy được nguyên nhân.
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Ghi chú thêm</label>
                <input value={form.mucDich} onChange={set("mucDich")} placeholder="không bắt buộc"
                  className={`block mt-1 ${inputCls} w-full`} />
              </div>
            </>
          ) : (
            <div><label className="text-xs text-slate-500">Nhập từ đâu</label>
              <input value={form.mucDich} onChange={set("mucDich")} placeholder="Cấy chuyền từ lô 010725"
                className={`block mt-1 ${inputCls} w-full`} /></div>
          )}
          {/* Gợi ý tên — tách riêng theo đúng vai trò đã từng đứng tên, không trộn lẫn: ai
              chỉ từng là Người xuất thì không hiện gợi ý ở ô Kiểm tra/Phê duyệt. Gõ để lọc,
              hoặc bấm mũi tên trong ô để xổ ra chọn hẳn. Vẫn gõ được tên mới bình thường —
              danh sách chỉ để gợi ý, không giới hạn giá trị được nhập. */}
          <datalist id="nguoi-thuc-hien-list">
            {people.thucHien.map((p) => <option key={p} value={p} />)}
          </datalist>
          <datalist id="nguoi-kiem-tra-list">
            {people.kiemTra.map((p) => <option key={p} value={p} />)}
          </datalist>
          <datalist id="nguoi-phe-duyet-list">
            {people.pheDuyet.map((p) => <option key={p} value={p} />)}
          </datalist>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500">{nguoiLabel}</label>
              <input list="nguoi-thuc-hien-list" value={form.nguoiThucHien} onChange={set("nguoiThucHien")} className={`block mt-1 ${inputCls} w-full`} /></div>
            <div><label className="text-xs text-slate-500">Người kiểm tra</label>
              <input list="nguoi-kiem-tra-list" value={form.nguoiKiemTra} onChange={set("nguoiKiemTra")} className={`block mt-1 ${inputCls} w-full`} /></div>
            <div><label className="text-xs text-slate-500">Người phê duyệt</label>
              <input list="nguoi-phe-duyet-list" value={form.nguoiPheDuyet} onChange={set("nguoiPheDuyet")} className={`block mt-1 ${inputCls} w-full`} /></div>
          </div>
          <p className="text-[11px] text-slate-400">
            3 ô {nguoiLabel}/Người kiểm tra/Người phê duyệt chỉ để in tên rõ trên phiếu — chữ ký vẫn ký tay lên bản in.
          </p>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3">Huỷ</button>
          <button type="button" onClick={inPhieu} disabled={saving}
            className="flex items-center gap-2 text-slate-700 text-sm px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            <Printer className="w-4 h-4" /> In phiếu
          </button>
          <button type="submit" disabled={saving}
            className={`flex items-center gap-2 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50 ${laXuat ? "bg-slate-800 hover:bg-slate-900" : "bg-emerald-600 hover:bg-emerald-700"}`}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Lưu
          </button>
        </div>
      </form>
    </div>
  );
}

/** QC gửi đề nghị xuất — KHÔNG ghi vào lenmen_seed_movements, không trừ tồn, không có Người
 * kiểm tra/Người phê duyệt (việc của admin lúc duyệt). Rút gọn từ MovementModal, chỉ đúng
 * các trường NCV yêu cầu QC nhập: Số ống, Ngày, Mục đích (+ Lô sản xuất nếu Sản xuất),
 * Người xuất. RLS chặn insert cho ai không phải admin/QC — nút gọi modal này cũng đã ẩn với
 * vai trò khác ở ngoài (canXuatChung). */
function ExportRequestModal({ lot, actorId, people = { thucHien: [] }, onNewPeople, onClose, onDone }) {
  const [form, setForm] = useState({
    soOng: "", ngay: new Date().toISOString().slice(0, 10),
    mucDichLoai: "san_xuat", loSanXuat: "", nguoiThucHien: "", ghiChu: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canLoSanXuat = form.mucDichLoai === "san_xuat";

  const submit = async (e) => {
    e.preventDefault();
    if (!form.soOng || Number(form.soOng) <= 0) { setError("Số ống là bắt buộc."); return; }
    if (canLoSanXuat && !form.loSanXuat.trim()) {
      setError('Xuất để "Sản xuất" thì phải điền Số lô sản xuất.');
      return;
    }
    setSaving(true); setError("");
    try {
      await createExportRequest({ ...form, seedLotId: lot.id, loSanXuat: canLoSanXuat ? form.loSanXuat : null }, actorId);
      onNewPeople?.({ thucHien: form.nguoiThucHien });
      onDone();
      onClose();
    } catch (err) { setError(err.message || String(err)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-semibold text-sm">Đề nghị xuất — lô {lot.soLo}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-sky-50 border border-sky-200 rounded-md p-2.5 text-xs text-sky-700">
            Đề nghị này CHƯA trừ tồn kho, CHƯA vào Nhật ký xuất/nhập — admin duyệt xong mới
            chính thức ghi nhận.
          </div>
          <div className="text-xs text-slate-500">
            Tồn hiện tại: <span className="font-medium text-slate-800">{lot.soOng ?? 0} ống</span>
          </div>
          <div className="flex gap-3">
            <div><label className="text-xs text-slate-500">Số ống *</label>
              <input required inputMode="numeric" min="1" value={form.soOng} onChange={set("soOng")}
                className={`block mt-1 ${inputCls} w-28 text-right`} /></div>
            <div><label className="text-xs text-slate-500">Ngày xuất</label>
              <input type="date" value={form.ngay} onChange={set("ngay")} className={`block mt-1 ${inputCls}`} /></div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Mục đích xuất *</label>
            <select value={form.mucDichLoai} onChange={set("mucDichLoai")} className={`block mt-1 ${inputCls} w-full bg-white`}>
              {MUC_DICH_XUAT.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {canLoSanXuat && (
            <div><label className="text-xs text-slate-500">Số lô sản xuất *</label>
              <input required value={form.loSanXuat} onChange={set("loSanXuat")} placeholder="030825BSM"
                className={`block mt-1 ${inputCls} w-full font-mono`} /></div>
          )}
          <datalist id="dnx-nguoi-thuc-hien-list">
            {people.thucHien.map((p) => <option key={p} value={p} />)}
          </datalist>
          <div><label className="text-xs text-slate-500">Người xuất (Họ và tên)</label>
            <input list="dnx-nguoi-thuc-hien-list" value={form.nguoiThucHien} onChange={set("nguoiThucHien")}
              className={`block mt-1 ${inputCls} w-full`} /></div>
          <div><label className="text-xs text-slate-500">Ghi chú thêm</label>
            <input value={form.ghiChu} onChange={set("ghiChu")} placeholder="không bắt buộc"
              className={`block mt-1 ${inputCls} w-full`} /></div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3">Huỷ bỏ</button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Gửi đề nghị xuất
          </button>
        </div>
      </form>
    </div>
  );
}

/** Sửa 1 lượt xuất/nhập đã lưu — CHỈ admin (nút gọi modal này đã bị ẩn với người khác ở
 * MovementLog, và RLS chặn ở DB nếu ai đó cố gọi thẳng API). Không cho sửa Loại/Số ống —
 * xem lý do ở updateMovement trong lib/seedLotsApi.js. */
function EditMovementModal({ move, lot, people = { thucHien: [], kiemTra: [], pheDuyet: [] }, onNewPeople, onClose, onDone }) {
  const [form, setForm] = useState({
    ngay: move.ngay || new Date().toISOString().slice(0, 10),
    mucDich: move.mucDich || "", mucDichLoai: move.mucDichLoai || "san_xuat", loSanXuat: move.loSanXuat || "",
    nguoiThucHien: move.nguoiThucHien || "", nguoiKiemTra: move.nguoiKiemTra || "", nguoiPheDuyet: move.nguoiPheDuyet || "",
    ghiChu: move.ghiChu || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const laXuat = move.loai !== "nhap";
  const canLoSanXuat = laXuat && form.mucDichLoai === "san_xuat";
  const nguoiLabel = NGUOI_THUC_HIEN_LABEL[laXuat ? "xuat" : "nhap"];

  const submit = async (e) => {
    e.preventDefault();
    if (canLoSanXuat && !form.loSanXuat.trim()) { setError('Xuất để "Sản xuất" thì phải điền Số lô sản xuất.'); return; }
    setSaving(true); setError("");
    try {
      await updateMovement(move.id, {
        ...form,
        mucDichLoai: laXuat ? form.mucDichLoai : null,
        loSanXuat: canLoSanXuat ? form.loSanXuat : null,
      });
      onNewPeople?.({ thucHien: form.nguoiThucHien, kiemTra: form.nguoiKiemTra, pheDuyet: form.nguoiPheDuyet });
      onDone();
      onClose();
    } catch (err) { setError(err.message || String(err)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-semibold text-sm">Sửa lượt {MOVEMENT_LABEL[move.loai]} — lô {lot.soLo}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2">
            {MOVEMENT_LABEL[move.loai]} <b className="text-slate-700">{move.soOng} ống</b> — Loại và Số ống không sửa
            được ở đây (ảnh hưởng tồn kho đã tính) — nhập sai số lượng thì tạo 1 lượt mới để điều chỉnh.
          </div>
          <div>
            <label className="text-xs text-slate-500">Ngày</label>
            <input type="date" value={form.ngay} onChange={set("ngay")} className={`block mt-1 ${inputCls}`} />
          </div>
          {laXuat ? (
            <>
              <div>
                <label className="text-xs text-slate-500">Mục đích xuất kho *</label>
                <select value={form.mucDichLoai} onChange={set("mucDichLoai")} className={`block mt-1 ${inputCls} w-full bg-white`}>
                  {MUC_DICH_XUAT.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {canLoSanXuat && (
                <div>
                  <label className="text-xs text-slate-500">Số lô sản xuất *</label>
                  <input required value={form.loSanXuat} onChange={set("loSanXuat")} placeholder="030825BSM"
                    className={`block mt-1 ${inputCls} w-full font-mono`} />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Ghi chú thêm</label>
                <input value={form.mucDich} onChange={set("mucDich")} placeholder="không bắt buộc"
                  className={`block mt-1 ${inputCls} w-full`} />
              </div>
            </>
          ) : (
            <div><label className="text-xs text-slate-500">Nhập từ đâu</label>
              <input value={form.mucDich} onChange={set("mucDich")} placeholder="Cấy chuyền từ lô 010725"
                className={`block mt-1 ${inputCls} w-full`} /></div>
          )}
          <datalist id="edit-nguoi-thuc-hien-list">{people.thucHien.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="edit-nguoi-kiem-tra-list">{people.kiemTra.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="edit-nguoi-phe-duyet-list">{people.pheDuyet.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500">{nguoiLabel}</label>
              <input list="edit-nguoi-thuc-hien-list" value={form.nguoiThucHien} onChange={set("nguoiThucHien")} className={`block mt-1 ${inputCls} w-full`} /></div>
            <div><label className="text-xs text-slate-500">Người kiểm tra</label>
              <input list="edit-nguoi-kiem-tra-list" value={form.nguoiKiemTra} onChange={set("nguoiKiemTra")} className={`block mt-1 ${inputCls} w-full`} /></div>
            <div><label className="text-xs text-slate-500">Người phê duyệt</label>
              <input list="edit-nguoi-phe-duyet-list" value={form.nguoiPheDuyet} onChange={set("nguoiPheDuyet")} className={`block mt-1 ${inputCls} w-full`} /></div>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3">Huỷ</button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Lưu thay đổi
          </button>
        </div>
      </form>
    </div>
  );
}

function MovementLog({ moves, lot, fallbackTen, isAdmin, onEdit }) {
  if (!moves.length) return <div className="text-sm text-slate-400 py-2">Chưa có lượt xuất/nhập nào.</div>;
  const inLai = (m) => {
    const ok = openPhieuPrint({
      loai: m.loai, ten: tenLoaiCuaLo(lot, fallbackTen),
      maChung: lot.maChung, soLo: lot.soLo, nsx: lot.ngaySanXuat, hd: lot.hanSuDung,
      soLuong: m.soOng, ngay: m.ngay,
      mucDichText: m.mucDichLoai ? MUC_DICH_LABEL[m.mucDichLoai] : m.mucDich,
      mucDichLoai: m.mucDichLoai, loSanXuat: m.loSanXuat,
      nguoiThucHien: m.nguoiThucHien, nguoiKiemTra: m.nguoiKiemTra, nguoiPheDuyet: m.nguoiPheDuyet,
    });
    if (!ok) alert("Trình duyệt chặn cửa sổ bật lên — cho phép pop-up rồi thử lại.");
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-slate-50">
          <tr>
            {["Ngày", "Loại", "Số ống", "Mục đích", "Lô sản xuất", "Người thực hiện", ""].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5">{fmtDate(m.ngay)}</td>
              <td className="px-3 py-1.5">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${m.loai === "nhap" ? "bg-emerald-100 text-emerald-700" : m.loai === "xuat" ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"}`}>
                  {MOVEMENT_LABEL[m.loai]}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right font-medium">{m.loai === "nhap" ? "+" : "−"}{m.soOng}</td>
              <td className="px-3 py-1.5 whitespace-normal">
                {m.mucDichLoai ? MUC_DICH_LABEL[m.mucDichLoai] : (m.mucDich || "–")}
                {m.mucDichLoai && m.mucDich ? <span className="text-slate-400"> · {m.mucDich}</span> : null}
              </td>
              <td className="px-3 py-1.5 font-mono">{m.loSanXuat || "–"}</td>
              <td className="px-3 py-1.5">{m.nguoiThucHien || "–"}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-2">
                  {isAdmin && (
                    <button onClick={() => onEdit(m)} title="Sửa lượt này (chỉ admin)" className="text-slate-400 hover:text-slate-700">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {m.loai !== "huy" && (
                    <button onClick={() => inLai(m)} title="In lại phiếu" className="text-slate-400 hover:text-slate-700">
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Đề nghị xuất ------------------------------ */

/** Hàng chờ duyệt — admin thấy đề nghị của mọi người (nút "Duyệt"), QC chỉ thấy đề nghị của
 * chính mình (RLS đã lọc sẵn ở fetchExportRequests, không lọc lại ở đây) và chỉ có nút rút. */
function RequestQueue({ requests, lots, profilesById, isAdmin, onApprove, onDeleteReq }) {
  const lotById = useMemo(() => Object.fromEntries(lots.map((l) => [l.id, l])), [lots]);
  if (!requests.length) {
    return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Không có đề nghị nào đang chờ.</div>;
  }
  const nameOf = (id) => {
    if (!id) return "–";
    const p = profilesById?.[id];
    return p?.fullName || p?.email || "–";
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-slate-50">
          <tr>
            {["Ngày đề nghị", "Lô", "Số ống", "Mục đích", "Lô sản xuất", "Người xuất", "Người đề nghị", ""].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const lot = lotById[r.seedLotId];
            return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{fmtDate(r.ngay)}</td>
                <td className="px-3 py-1.5">
                  {lot ? <><span className="font-mono font-medium">{lot.soLo}</span> <span className="text-slate-400">· {lot.maChung}</span></> : "(lô đã xoá)"}
                </td>
                <td className="px-3 py-1.5 text-right font-medium">{r.soOng}</td>
                <td className="px-3 py-1.5">{r.mucDichLoai ? MUC_DICH_LABEL[r.mucDichLoai] : "–"}</td>
                <td className="px-3 py-1.5 font-mono">{r.loSanXuat || "–"}</td>
                <td className="px-3 py-1.5">{r.nguoiThucHien || "–"}</td>
                <td className="px-3 py-1.5">{nameOf(r.createdBy)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {isAdmin && lot && (
                      <button onClick={() => onApprove(r, lot)} title="Duyệt — mở form Xuất đã điền sẵn"
                        className="flex items-center gap-1 text-xs border border-emerald-300 text-emerald-700 rounded-md px-2 py-1 hover:bg-emerald-50">
                        <Check className="w-3.5 h-3.5" /> Duyệt
                      </button>
                    )}
                    <button onClick={() => onDeleteReq(r)} title={isAdmin ? "Xoá đề nghị" : "Rút đề nghị"}
                      className="text-slate-400 hover:text-rose-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- Huỷ lô --------------------------------- */

/** Huỷ 1 hoặc nhiều lô cùng lúc — `lots` luôn là mảng (1 phần tử = huỷ 1 lô như trước, nhiều
 * phần tử = huỷ hàng loạt theo lô đã tích chọn). Huỷ hàng loạt luôn huỷ HẾT số đang tồn của
 * từng lô (không cho sửa số ống riêng từng lô trong 1 form — muốn huỷ 1 phần thì huỷ lẻ). */
function HuyModal({ lots, onClose, onDone }) {
  const isBulk = lots.length > 1;
  const [form, setForm] = useState({
    soOng: String(lots[0].soOng ?? 0), ngay: new Date().toISOString().slice(0, 10),
    lyDoChon: LY_DO_HUY_OPTIONS[0], lyDoKhac: "", nguoiThucHien: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lyDo = form.lyDoChon === "Khác" ? form.lyDoKhac.trim() : form.lyDoChon;

  const submit = async (e) => {
    e.preventDefault();
    if (!lyDo) { setError("Phải ghi lý do huỷ."); return; }
    setSaving(true); setError("");
    const loi = [];
    for (const lot of lots) {
      try {
        const updated = await huyLot(lot, {
          soOng: isBulk ? lot.soOng : form.soOng, ngay: form.ngay, lyDo, nguoiThucHien: form.nguoiThucHien,
        });
        onDone(updated);
      } catch (err) {
        loi.push(`${lot.soLo}: ${err.message || String(err)}`);
      }
    }
    if (loi.length) setError(`Huỷ lỗi ${loi.length}/${lots.length} lô — ${loi.join("; ")}`);
    else onClose();
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-semibold text-sm">{isBulk ? `Huỷ ${lots.length} lô đã chọn` : `Huỷ lô ${lots[0].soLo}`}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-rose-50 border border-rose-200 rounded-md p-2.5 text-xs text-rose-700">
            Huỷ là bỏ đi, khác với xuất dùng. Lô sẽ bị đánh dấu <b>Đã huỷ</b> và không xuất/nhập được nữa.
            Nhật ký vẫn giữ nguyên vết.
          </div>
          {isBulk ? (
            <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
              {lots.map((l) => (
                <div key={l.id} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                  <span><span className="font-mono font-medium">{l.soLo}</span> · {l.maChung}</span>
                  <span className="text-slate-500">{l.soOng ?? 0} ống</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3">
              <div><label className="text-xs text-slate-500">Số ống huỷ</label>
                <input required inputMode="numeric" value={form.soOng} onChange={set("soOng")}
                  className={`block mt-1 ${inputCls} w-28 text-right`} />
                <p className="text-[11px] text-slate-400 mt-0.5">Đang tồn {lots[0].soOng ?? 0}</p></div>
              <div><label className="text-xs text-slate-500">Ngày huỷ</label>
                <input type="date" value={form.ngay} onChange={set("ngay")} className={`block mt-1 ${inputCls}`} /></div>
            </div>
          )}
          {isBulk && (
            <div><label className="text-xs text-slate-500">Ngày huỷ</label>
              <input type="date" value={form.ngay} onChange={set("ngay")} className={`block mt-1 ${inputCls}`} /></div>
          )}
          <div>
            <label className="text-xs text-slate-500">Lý do huỷ *</label>
            <select value={form.lyDoChon} onChange={set("lyDoChon")} className={`block mt-1 ${inputCls} w-full bg-white`}>
              {LY_DO_HUY_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.lyDoChon === "Khác" && (
              <input required value={form.lyDoKhac} onChange={set("lyDoKhac")} placeholder="Ghi rõ lý do…"
                className={`block mt-2 ${inputCls} w-full`} />
            )}
          </div>
          <div><label className="text-xs text-slate-500">Người thực hiện</label>
            <input value={form.nguoiThucHien} onChange={set("nguoiThucHien")} className={`block mt-1 ${inputCls} w-full`} /></div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3">Huỷ bỏ</button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {isBulk ? `Xác nhận huỷ ${lots.length} lô` : "Xác nhận huỷ"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* --------------------------- Ma trận độ ổn định --------------------------- */

function StabilityMatrix({ lot, points, protocol, onSave }) {
  // Bảng nhập trực tiếp: cột = mốc theo dõi, dòng = chỉ tiêu — đúng bố cục sheet DOD cũ,
  // gõ thẳng vào ô thay vì mở form riêng cho từng mốc.
  const [cols, setCols] = useState([]);
  const [dirty, setDirty] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mocMoi, setMocMoi] = useState("");

  useEffect(() => {
    setCols(points.map((p) => ({ ...p })));
    setDirty(new Set());
  }, [points]);

  const due = dueCheckpoints(lot, points, protocol);

  const setCell = (moc, field, value) => {
    setCols((cs) => cs.map((c) => (c.mocThang === moc ? { ...c, [field]: value } : c)));
    setDirty((d) => new Set(d).add(moc));
  };

  const themMoc = () => {
    const m = Number(mocMoi);
    if (!Number.isInteger(m) || m < 0) { setError("Mốc phải là số tháng, 0 = ban đầu."); return; }
    if (cols.some((c) => c.mocThang === m)) { setError(`Mốc ${m} tháng đã có rồi.`); return; }
    setError("");
    setCols((cs) => [...cs, { mocThang: m, seedLotId: lot.id }].sort((a, b) => a.mocThang - b.mocThang));
    setDirty((d) => new Set(d).add(m));
    setMocMoi("");
  };

  const luu = async () => {
    setSaving(true); setError("");
    try {
      for (const moc of dirty) {
        const c = cols.find((x) => x.mocThang === moc);
        if (c) await onSave({ ...c, seedLotId: lot.id });
      }
      setDirty(new Set());
    } catch (e) { setError(e.message || String(e)); }
    setSaving(false);
  };

  const cellCls = "w-full border border-transparent hover:border-slate-300 focus:border-emerald-400 focus:outline-none rounded px-1.5 py-1 text-xs text-right bg-transparent";
  const DONG = [
    { key: "me", label: "Mẻ", nguong: "", mono: true },
    { key: "ngayKiem", label: "Ngày kiểm", nguong: "", type: "date" },
    ...STABILITY_CRITERIA.map((c) => ({ key: c.key, label: c.label, nguong: c.nguong })),
  ];

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="font-semibold text-sm">Theo dõi độ ổn định</div>
        <div className="flex items-center gap-2 flex-wrap">
          {due.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="w-3 h-3" />
              Đến hạn: {due.map((d) => `${d.thang} tháng (${d.chi_tieu.join(", ")})`).join(" · ")}
            </span>
          )}
          <input value={mocMoi} onChange={(e) => setMocMoi(e.target.value)} inputMode="numeric"
            placeholder="mốc (tháng)" className="border border-slate-300 rounded-md px-2 py-1 text-xs w-28" />
          <button onClick={themMoc} className="text-xs border border-slate-300 rounded-md px-2.5 py-1 bg-white hover:bg-slate-50">
            + Thêm mốc
          </button>
          <button onClick={luu} disabled={saving || !dirty.size}
            className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-md px-3 py-1">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Lưu bảng{dirty.size ? ` (${dirty.size})` : ""}
          </button>
        </div>
      </div>

      {cols.length === 0 ? (
        <div className="text-sm text-slate-400 py-2">Chưa có mốc nào — nhập số tháng rồi bấm “Thêm mốc”.</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">Chỉ tiêu</th>
                <th className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">Ngưỡng</th>
                {cols.map((c) => (
                  <th key={c.mocThang}
                    className={`px-3 py-2 text-right font-medium text-[11px] ${dirty.has(c.mocThang) ? "text-emerald-700" : "text-slate-400"}`}>
                    {c.mocThang === 0 ? "Ban đầu" : `${c.mocThang} tháng`}
                    {dirty.has(c.mocThang) ? " •" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DONG.map((d) => (
                <tr key={d.key} className="border-t border-slate-100">
                  <td className="px-3 py-1 text-slate-700">{d.label}</td>
                  <td className="px-3 py-1 text-[11px] text-slate-400">{d.nguong || "–"}</td>
                  {cols.map((c) => (
                    <td key={c.mocThang} className="px-1 py-0.5">
                      <input type={d.type || "text"} value={c[d.key] ?? ""}
                        onChange={(e) => setCell(c.mocThang, d.key, e.target.value)}
                        className={`${cellCls} ${d.mono ? "font-mono" : ""}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      {dirty.size > 0 && (
        <p className="text-[11px] text-amber-700 mt-2">
          Có {dirty.size} mốc đang sửa chưa lưu (đánh dấu •). Bấm “Lưu bảng” để ghi lại.
        </p>
      )}

      {cols.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 mt-3">
          <div className="font-semibold text-sm mb-2">Đồ thị độ ổn định</div>
          <SeedStabilityChart points={points} />
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Panel --------------------------------- */

export default function SeedLotPanel({ isAdmin, isQC, canXuatChung, actorId, profilesById = {}, setNote }) {
  const [lots, setLots] = useState([]);
  const [protocol, setProtocol] = useState([]);
  const [stability, setStability] = useState({});
  const [movements, setMovements] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [kho, setKho] = useState("ALL");
  const [loai, setLoai] = useState("ALL");        // theo loài (danh mục chủng)
  const [maChung, setMaChung] = useState("ALL");
  const [tuNgay, setTuNgay] = useState("");       // lọc theo NSX
  const [denNgay, setDenNgay] = useState("");
  const [trangThai, setTrangThai] = useState("ALL");
  const [labelLot, setLabelLot] = useState(null);
  const [moveCtx, setMoveCtx] = useState(null);   // { lot, loai, prefill?, onApproved? }
  const [requestCtx, setRequestCtx] = useState(null); // lô đang gửi đề nghị xuất (QC)
  const [huyLotCtx, setHuyLotCtx] = useState(null); // mảng lô đang huỷ (1 phần tử = huỷ lẻ)
  const [selected, setSelected] = useState(new Set()); // id lô đã tích chọn để huỷ hàng loạt
  const [editCtx, setEditCtx] = useState(null); // { move, lot } — sửa 1 lượt xuất/nhập đã lưu (chỉ admin)
  const [view, setView] = useState("kho");       // "kho" | "baocao"
  const [allStability, setAllStability] = useState([]);
  const [strains, setStrains] = useState([]);
  // Gợi ý tên cho 3 ô ký — tách riêng theo đúng vai trò, ai chỉ từng đứng "Người xuất" thì
  // không gợi ý sang ô "Người kiểm tra"/"Người phê duyệt".
  const [people, setPeople] = useState({ thucHien: [], kiemTra: [], pheDuyet: [] });

  const load = useCallback(async () => {
    try {
      const [rows, settings, allMoc, dsChung] = await Promise.all([
        fetchSeedLots(), fetchLenmenSettings(), fetchAllStability(), fetchStrains(),
      ]);
      setLots(rows);
      setAllStability(allMoc);
      setStrains(dsChung);
      setProtocol(parseProtocol(settings));
      setError("");
    } catch (e) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Tách riêng khỏi load() chính: nếu chưa chạy migration_lenmen_giong_phieu.sql (thiếu cột
  // nguoi_kiem_tra/nguoi_phe_duyet) thì chỉ mất gợi ý tên, không kéo sập cả trang.
  useEffect(() => {
    fetchMovementPeople().then(setPeople).catch(() => {});
  }, []);
  // Cho thêm ngay tên vừa gõ vào đúng danh sách theo vai trò, khỏi phải tải lại trang mới
  // dùng lại được trong cùng phiên làm việc (vd xuất 2 lô liên tiếp, đổi người kiểm tra khác
  // nhau). "roleNames" dạng { thucHien, kiemTra, pheDuyet } — khớp đúng field nào mới thêm
  // vào đúng danh sách đó, không trộn vai trò.
  const addPeople = useCallback((roleNames) => {
    setPeople((prev) => {
      const next = { ...prev };
      for (const key of ["thucHien", "kiemTra", "pheDuyet"]) {
        const v = (roleNames[key] || "").trim();
        if (v && !next[key].includes(v)) next[key] = [...next[key], v].sort((a, b) => a.localeCompare(b, "vi"));
      }
      return next;
    });
  }, []);

  // Đề nghị xuất chờ duyệt — RLS tự lọc theo người gọi (QC chỉ thấy của mình, admin thấy
  // hết), không cần lọc lại ở JS. Tách khỏi load() chính vì phụ thuộc migration riêng
  // (migration_lenmen_giong_de_nghi_xuat.sql) — thiếu thì chỉ mất tab này, không sập trang.
  const [requests, setRequests] = useState([]);
  const reloadRequests = useCallback(() => {
    fetchExportRequests().then(setRequests).catch(() => {});
  }, []);
  useEffect(() => { reloadRequests(); }, [reloadRequests]);

  // Chỉ nạp mốc theo dõi + nhật ký kho khi mở lô ra xem — sổ có thể vài trăm lô.
  const toggle = async (lot) => {
    if (expanded === lot.id) { setExpanded(null); return; }
    setExpanded(lot.id);
    if (!stability[lot.id]) {
      const points = await fetchStability(lot.id);
      setStability((s) => ({ ...s, [lot.id]: points }));
    }
    if (!movements[lot.id]) {
      const moves = await fetchMovements(lot.id);
      setMovements((m) => ({ ...m, [lot.id]: moves }));
    }
  };

  const addLot = async (form) => {
    const saved = await insertSeedLot(form);
    setLots((prev) => [saved, ...prev]);
  };

  const savePoint = async (point) => {
    const saved = await saveStabilityPoint(point);
    setStability((s) => {
      const list = (s[point.seedLotId] || []).filter((p) => p.mocThang !== saved.mocThang);
      return { ...s, [point.seedLotId]: [...list, saved].sort((a, b) => a.mocThang - b.mocThang) };
    });
  };

  // Tồn kho do trigger DB tính, nên lấy lại dòng lô đã cập nhật thay vì tự cộng trừ ở đây.
  const afterMove = async (updatedLot) => {
    setLots((prev) => prev.map((l) => (l.id === updatedLot.id ? updatedLot : l)));
    const moves = await fetchMovements(updatedLot.id);
    setMovements((m) => ({ ...m, [updatedLot.id]: moves }));
  };

  // Loài lấy từ danh mục chủng (lô không tự lưu loài, chỉ có mã chủng).
  const loaiTheoMa = useMemo(
    () => Object.fromEntries(strains.map((x) => [x.maChung, x.tenLoai || ""])), [strains]
  );
  const dsLoai = useMemo(
    () => [...new Set(lots.map((l) => loaiTheoMa[l.maChung]).filter(Boolean))].sort(), [lots, loaiTheoMa]
  );
  const dsMaChung = useMemo(
    () => [...new Set(lots.map((l) => l.maChung).filter(Boolean))].sort(), [lots]
  );

  // In sổ lịch sử xuất/nhập của 1 lô — gộp toàn bộ movements (không chỉ phần đã cache) thành
  // 1 bảng có số dư chạy. Mở cửa sổ NGAY lúc bấm (đồng bộ) rồi mới fetch nếu cần, đúng kỹ
  // thuật đã dùng ở "In phiếu" — mở sau 1 bước async sẽ bị trình duyệt chặn popup.
  const inSoLo = async (lot) => {
    const w = window.open("", "_blank");
    if (!w) { alert("Trình duyệt chặn cửa sổ bật lên — cho phép pop-up rồi thử lại."); return; }
    let moves = movements[lot.id];
    if (!moves) {
      moves = await fetchMovements(lot.id);
      setMovements((m) => ({ ...m, [lot.id]: moves }));
    }
    w.document.write(renderSoLoHistoryHTML({ lot, ten: tenLoaiCuaLo(lot, loaiTheoMa[lot.maChung]), movements: moves }));
    w.document.close();
  };

  // In bảng kiểm kê — theo đúng tủ đang chọn ở bộ lọc, hoặc gộp tất cả tủ (+ "Chưa gán kho")
  // nếu đang xem "Tất cả kho". Chỉ lấy lô còn hàng thật (chưa huỷ, còn ống) — không có gì để
  // đếm thì không liệt kê. Dùng thẳng `lots` (đầy đủ), không phụ thuộc ô tìm kiếm/bộ lọc khác.
  const inKiemKe = () => {
    const khoList = kho === "ALL" ? [...KHO_KEYS, "chua_ro"] : [kho];
    const groups = khoList.map((k) => {
      const rows = lots
        .filter((l) => !l.daHuy && (l.soOng ?? 0) > 0 && (k === "chua_ro" ? !l.dieuKienLuu : l.dieuKienLuu === k))
        .map((l) => ({
          maChung: l.maChung, tenChung: tenLoaiCuaLo(l, loaiTheoMa[l.maChung]), soLo: l.soLo,
          viTri: l.viTri, ngaySanXuat: l.ngaySanXuat, hanSuDung: l.hanSuDung, soOng: l.soOng,
        }))
        .sort((a, b) => a.maChung.localeCompare(b.maChung) || a.soLo.localeCompare(b.soLo));
      return { khoLabel: k === "chua_ro" ? "Chưa gán kho" : DIEU_KIEN_LUU_LABEL[k], rows };
    }).filter((g) => g.rows.length > 0 || khoList.length === 1); // xem 1 tủ cụ thể thì vẫn in dù rỗng, gộp tất cả thì bỏ tủ rỗng cho gọn
    const khoLabelFallback = kho === "chua_ro" ? "Chưa gán kho" : (DIEU_KIEN_LUU_LABEL[kho] || "");
    const ok = printKiemKe({ groups: groups.length ? groups : [{ khoLabel: khoLabelFallback, rows: [] }] });
    if (!ok) alert("Trình duyệt chặn cửa sổ bật lên — cho phép pop-up rồi thử lại.");
  };

  const coLoc = kho !== "ALL" || loai !== "ALL" || maChung !== "ALL" || tuNgay || denNgay || trangThai !== "ALL" || q;
  const xoaLoc = () => { setKho("ALL"); setLoai("ALL"); setMaChung("ALL"); setTuNgay(""); setDenNgay(""); setTrangThai("ALL"); setQ(""); };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const homNay = new Date().toISOString().slice(0, 10);
    return lots.filter((l) => {
      if (kho !== "ALL") {
        if (kho === "chua_ro" ? l.dieuKienLuu : l.dieuKienLuu !== kho) return false;
      }
      if (loai !== "ALL" && loaiTheoMa[l.maChung] !== loai) return false;
      if (maChung !== "ALL" && l.maChung !== maChung) return false;
      if (tuNgay && (!l.ngaySanXuat || l.ngaySanXuat < tuNgay)) return false;
      if (denNgay && (!l.ngaySanXuat || l.ngaySanXuat > denNgay)) return false;
      if (trangThai === "con" && !((l.soOng ?? 0) > 0 && !l.daHuy)) return false;
      if (trangThai === "het" && (l.soOng ?? 0) > 0) return false;
      if (trangThai === "qua_han" && !(l.hanSuDung && l.hanSuDung < homNay)) return false;
      if (trangThai === "da_huy" && !l.daHuy) return false;
      if (!needle) return true;
      // Tìm cả trong ghi chú: có lô mà 2 sổ ghi số khác nhau (vd 010121 / 010122),
      // người tra cứu gõ số nào cũng phải ra.
      return `${l.soLo} ${l.maChung} ${l.tenChung || ""} ${l.nguonGoc || ""} ${l.viTri || ""} ${l.ghiChu || ""}`
        .toLowerCase().includes(needle);
    });
  }, [lots, q, kho, loai, maChung, tuNgay, denNgay, trangThai, loaiTheoMa]);

  // Chọn hàng loạt để huỷ — chỉ tính lô CHƯA huỷ, và chỉ trong phạm vi đang lọc/hiện trên màn
  // hình (đỡ huỷ nhầm lô đang bị ẩn bởi bộ lọc). "Chọn tất cả" bật/tắt theo đúng tập này.
  const selectableFiltered = useMemo(() => filtered.filter((l) => !l.daHuy), [filtered]);
  const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((l) => selected.has(l.id));
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(selectableFiltered.map((l) => l.id)));
  const toggleSelectOne = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectedLots = lots.filter((l) => selected.has(l.id));

  if (loading) {
    return <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
      <Loader2 className="w-4 h-4 animate-spin" /> Đang tải sổ chủng giống…
    </div>;
  }
  if (error) {
    return <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
      Không tải được: {error}
      <div className="text-xs text-rose-600 mt-1">
        Kiểm tra đã chạy <code className="bg-white px-1 rounded">migration_lenmen_giong.sql</code> và{" "}
        <code className="bg-white px-1 rounded">migration_lenmen_giong_kho.sql</code> chưa.
      </div>
    </div>;
  }

  const tabCls = (on) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-md transition ${on ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`;

  return (
    <>
      <div className="flex gap-1 mb-3">
        <button className={tabCls(view === "kho")} onClick={() => setView("kho")}>
          <List className="w-3.5 h-3.5" /> Kho chủng giống
        </button>
        <button className={tabCls(view === "baocao")} onClick={() => setView("baocao")}>
          <BarChart3 className="w-3.5 h-3.5" /> Thống kê / Báo cáo
        </button>
        {canXuatChung && (
          <button className={tabCls(view === "de_nghi")} onClick={() => setView("de_nghi")}>
            <ClipboardList className="w-3.5 h-3.5" /> Đề nghị xuất
            {requests.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-600 text-white">{requests.length}</span>
            )}
          </button>
        )}
      </div>

      {view === "baocao" && <SeedReport lots={lots} allStability={allStability} protocol={protocol} />}

      {view === "de_nghi" && canXuatChung && (
        <RequestQueue requests={requests} lots={lots} profilesById={profilesById} isAdmin={isAdmin}
          onApprove={(req, lot) => setMoveCtx({
            lot, loai: "xuat",
            prefill: {
              soOng: String(req.soOng), ngay: req.ngay, mucDichLoai: req.mucDichLoai || "san_xuat",
              loSanXuat: req.loSanXuat || "", nguoiThucHien: req.nguoiThucHien || "", mucDich: req.ghiChu || "",
            },
            onApproved: async () => { await deleteExportRequest(req.id); reloadRequests(); },
          })}
          onDeleteReq={(req) => {
            if (!window.confirm(`${isAdmin ? "Xoá" : "Rút"} đề nghị xuất ${req.soOng} ống này?`)) return;
            deleteExportRequest(req.id).then(reloadRequests);
          }} />
      )}

      {view === "kho" && (<>
      <KhoCards lots={lots} active={kho} setActive={setKho} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <AddLotForm onAdd={addLot} />
        <button onClick={inKiemKe}
          className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Printer className="w-4 h-4" /> In kiểm kê{kho === "ALL" ? " (tất cả kho)" : ` — ${kho === "chua_ro" ? "Chưa gán kho" : DIEU_KIEN_LUU_LABEL[kho]}`}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs text-slate-500">Tìm kiếm</label>
          <div className="relative mt-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Số lô, mã chủng, nguồn gốc, vị trí…"
              className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Kho</label>
          <select value={kho} onChange={(e) => setKho(e.target.value)} className={`block mt-1 ${inputCls} bg-white`}>
            <option value="ALL">Tất cả kho</option>
            {KHO_KEYS.map((k) => <option key={k} value={k}>{DIEU_KIEN_LUU_LABEL[k]}</option>)}
            <option value="chua_ro">Chưa gán kho</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Loài</label>
          <select value={loai} onChange={(e) => setLoai(e.target.value)} className={`block mt-1 ${inputCls} bg-white max-w-[200px]`}>
            <option value="ALL">Tất cả loài</option>
            {dsLoai.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Mã chủng</label>
          <select value={maChung} onChange={(e) => setMaChung(e.target.value)} className={`block mt-1 ${inputCls} bg-white font-mono`}>
            <option value="ALL">Tất cả mã</option>
            {dsMaChung.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">NSX từ</label>
          <input type="date" value={tuNgay} onChange={(e) => setTuNgay(e.target.value)} className={`block mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="text-xs text-slate-500">đến</label>
          <input type="date" value={denNgay} onChange={(e) => setDenNgay(e.target.value)} className={`block mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Trạng thái</label>
          <select value={trangThai} onChange={(e) => setTrangThai(e.target.value)} className={`block mt-1 ${inputCls} bg-white`}>
            <option value="ALL">Tất cả</option>
            <option value="con">Còn ống</option>
            <option value="het">Hết ống</option>
            <option value="qua_han">Quá hạn</option>
            <option value="da_huy">Đã huỷ</option>
          </select>
        </div>
        {coLoc && (
          <button onClick={xoaLoc} className="text-xs text-slate-500 hover:text-slate-700 underline pb-2">Xoá lọc</button>
        )}
        <div className="w-full text-[11px] text-slate-400">
          Đang hiện <b className="text-slate-600">{filtered.length}</b>/{lots.length} lô
          {" · "}<b className="text-slate-600">{filtered.reduce((s2, l) => s2 + (Number(l.soOng) || 0), 0)}</b> ống
        </div>
      </div>

      {!isQC && selectableFiltered.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-2 mb-3 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            Chọn tất cả ({selectableFiltered.length} lô đang hiện)
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-slate-400">Đã chọn {selected.size} lô</span>
              <button onClick={() => setHuyLotCtx(selectedLots)}
                className="flex items-center gap-1 text-rose-600 border border-rose-200 rounded-md px-2 py-1 hover:bg-rose-50 ml-auto">
                <Trash2 className="w-3.5 h-3.5" /> Huỷ {selected.size} lô đã chọn
              </button>
              <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-slate-600">Bỏ chọn</button>
            </>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Không có lô nào khớp bộ lọc.
        </div>
      ) : (
        <div className="space-y-2">
          <div className={`${LOT_ROW1_GRID} px-4 text-[11px] text-slate-400`}>
            <span /><span />
            <span>Số lô</span><span>Mã chủng</span><span>Tên chủng</span>
            <span className="text-right">Thao tác</span>
          </div>
          {filtered.map((lot) => {
            const isOpen = expanded === lot.id;
            const months = monthsSince(lot.ngaySanXuat);
            const hetHan = lot.hanSuDung && new Date(lot.hanSuDung) < new Date();
            return (
              <div key={lot.id} className={`bg-white rounded-lg border overflow-hidden ${lot.daHuy ? "border-slate-200 opacity-70" : "border-slate-200"}`}>
                <div className="px-4 pt-3 pb-2">
                  <div className={`${LOT_ROW1_GRID}`}>
                    <div className="flex items-center">
                      {!isQC && !lot.daHuy && (
                        <input type="checkbox" checked={selected.has(lot.id)} onChange={() => toggleSelectOne(lot.id)}
                          onClick={(e) => e.stopPropagation()} className="shrink-0" title="Chọn để huỷ hàng loạt" />
                      )}
                    </div>
                    {/* display:contents — nút vẫn bắt click, nhưng không tự tạo box riêng, để 3
                        span con nằm ĐÚNG vào 3 cột lưới của hàng thay vì gộp chung 1 cột co giãn
                        như flex trước đây (khiến các hàng lệch cột nhau vì độ dài chữ khác nhau). */}
                    <button onClick={() => toggle(lot)} className="contents cursor-pointer">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="font-mono text-sm font-medium truncate text-left">{lot.soLo}</span>
                      <span className="font-mono text-xs text-slate-500 truncate text-left"
                        title={(() => { const g = giaiMaChung(lot.maChung); return g ? `${g.tienMa} · ${g.loai} · ${g.nhaCungCap} · ${g.dangLuu}` : ""; })()}>
                        {lot.maChung}
                      </span>
                      <span className="text-xs text-slate-600 truncate text-left">
                        {lot.tenChung || loaiTheoMa[lot.maChung] || "–"}
                      </span>
                    </button>
                    {/* Icon-only + title (hover ra chữ) thay vì icon+chữ — 5 nút cùng lúc (Nhập/
                        Xuất/Huỷ/Nhãn/Kiểm kê lô) mà để chữ đầy đủ thì không đủ chỗ, bị dồn xuống
                        nhiều dòng trông rối. Cùng kiểu nút tròn nhỏ như cột thao tác ở Nhật ký
                        xuất/nhập bên dưới. */}
                    <div className="flex items-center justify-end gap-1 flex-nowrap">
                      {lot.daHuy ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap"
                          title={[lot.lyDoHuy, lot.ngayHuy ? "ngày " + fmtDate(lot.ngayHuy) : ""].filter(Boolean).join(" — ")}>
                          Đã huỷ
                        </span>
                      ) : (<>
                      {!isQC && (
                        <button onClick={() => setMoveCtx({ lot, loai: "nhap" })} title="Nhập kho"
                          className="p-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canXuatChung && (
                        <button
                          onClick={() => (isAdmin ? setMoveCtx({ lot, loai: "xuat" }) : setRequestCtx(lot))}
                          title={isAdmin ? "Xuất kho" : "Gửi đề nghị xuất — admin sẽ duyệt"}
                          disabled={(lot.soOng ?? 0) === 0}
                          className="p-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                          <ArrowUpFromLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isQC && (
                        <button onClick={() => setHuyLotCtx([lot])} title="Huỷ lô"
                          className="p-1.5 rounded-md border border-slate-300 text-rose-600 hover:bg-rose-50 hover:border-rose-300">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      </>)}
                      {!isQC && (<>
                      <button onClick={() => setLabelLot(lot)} title="Tạo nhãn ống và nhãn hộp"
                        className="p-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
                        <Tag className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => inSoLo(lot)} title="In sổ lịch sử xuất/nhập của lô này"
                        className="p-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
                        <BookOpen className="w-3.5 h-3.5" />
                      </button>
                      </>)}
                    </div>
                  </div>
                  {/* Hàng 2 — thông tin phụ (kho/tồn/quá hạn/NSX), thụt vào ngang mã lô để tách
                      khỏi hàng định danh + thao tác ở trên cho thoáng. */}
                  <div className={`${LOT_ROW2_GRID} mt-1.5`}>
                    <span />
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap justify-self-start">
                      {DIEU_KIEN_LUU_LABEL[lot.dieuKienLuu] || "Chưa gán kho"}
                    </span>
                    <span className={`text-xs font-medium whitespace-nowrap ${(lot.soOng ?? 0) === 0 ? "text-slate-300" : "text-slate-800"}`}>
                      {lot.soOng ?? 0} ống
                    </span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap justify-self-start ${hetHan ? "bg-rose-100 text-rose-700" : "invisible"}`}>
                      Quá hạn
                    </span>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      NSX {fmtDate(lot.ngaySanXuat)}{months != null ? ` · ${months} tháng` : ""}
                    </span>
                  </div>
                </div>

                {isOpen && (
                  <>
                    <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div><div className="text-slate-500">Khay</div><div className="font-medium">{strains.find((x) => x.maChung === lot.maChung)?.khay || "–"}</div></div>
                      <div><div className="text-slate-500">Đơn vị tính</div><div className="font-medium">{lot.donViTinh || "–"}</div></div>
                      <div className="col-span-2"><div className="text-slate-500">Thông tin chủng</div><div className="font-medium">{lot.thongTin || strains.find((x) => x.maChung === lot.maChung)?.thongTin || "–"}</div></div>
                      <div><div className="text-slate-500">Vị trí trong kho</div><div className="font-medium">{lot.viTri || "–"}</div></div>
                      <div><div className="text-slate-500">Hạn dùng</div><div className="font-medium">{fmtDate(lot.hanSuDung)}</div></div>
                      <div><div className="text-slate-500">Nguồn gốc</div><div className="font-medium">{lot.nguonGoc || "–"}</div></div>
                      <div><div className="text-slate-500">Mật độ (10⁹ CFU/ml)</div><div className="font-medium">{lot.matDo ?? "–"}</div></div>
                      <div><div className="text-slate-500">Nhiễm khuẩn</div><div className="font-medium">{lot.nhiemKhuan || "–"}</div></div>
                      <div><div className="text-slate-500">Độ đồng đều</div><div className="font-medium">{lot.doDongDeu || "–"}</div></div>
                      <div><div className="text-slate-500">Khả năng tạo bào tử</div><div className="font-medium">{lot.khaNangTaoBaoTu || "–"}</div></div>
                      <div><div className="text-slate-500">Người làm</div><div className="font-medium">{lot.nguoiLam || "–"}</div></div>
                      {lot.tinhTrangSx && (
                        <div className="col-span-2 sm:col-span-4"><div className="text-slate-500">Tình trạng SX</div><div className="font-medium">{lot.tinhTrangSx}</div></div>
                      )}
                      {lot.daHuy && (
                        <div className="col-span-2 sm:col-span-4 bg-rose-50 border border-rose-200 rounded-md p-2">
                          <div className="text-rose-700 font-medium">Đã huỷ ngày {fmtDate(lot.ngayHuy)}</div>
                          <div className="text-rose-600">{lot.lyDoHuy || "Không ghi lý do"}</div>
                        </div>
                      )}
                      {lot.ghiChu && (
                        <div className="col-span-2 sm:col-span-4"><div className="text-slate-500">Ghi chú</div><div className="text-slate-600">{lot.ghiChu}</div></div>
                      )}
                    </div>

                    <div className="border-t border-slate-200 p-4">
                      <div className="font-semibold text-sm mb-2">Nhật ký xuất / nhập</div>
                      <MovementLog moves={movements[lot.id] || []} lot={lot} fallbackTen={loaiTheoMa[lot.maChung]}
                        isAdmin={isAdmin} onEdit={(move) => setEditCtx({ move, lot })} />
                    </div>

                    <StabilityMatrix lot={lot} points={stability[lot.id] || []} protocol={protocol} onSave={savePoint} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      </>)}

      {labelLot && <SeedLabelModal lot={labelLot} onClose={() => setLabelLot(null)} />}
      {huyLotCtx && (
        <HuyModal lots={huyLotCtx} onClose={() => { setHuyLotCtx(null); setSelected(new Set()); }}
          onDone={(updated) => afterMove(updated)} />
      )}
      {moveCtx && (
        <MovementModal lot={moveCtx.lot} loai={moveCtx.loai} fallbackTen={loaiTheoMa[moveCtx.lot.maChung]}
          people={people} onNewPeople={addPeople} prefill={moveCtx.prefill} onApproved={moveCtx.onApproved}
          onClose={() => setMoveCtx(null)} onDone={afterMove} />
      )}
      {requestCtx && (
        <ExportRequestModal lot={requestCtx} actorId={actorId} people={people} onNewPeople={addPeople}
          onClose={() => setRequestCtx(null)}
          onDone={() => { setNote?.("Đã gửi đề nghị xuất — chờ admin duyệt."); reloadRequests(); }} />
      )}
      {editCtx && (
        <EditMovementModal move={editCtx.move} lot={editCtx.lot} people={people} onNewPeople={addPeople}
          onClose={() => setEditCtx(null)}
          onDone={async () => {
            const moves = await fetchMovements(editCtx.lot.id);
            setMovements((m) => ({ ...m, [editCtx.lot.id]: moves }));
          }} />
      )}
    </>
  );
}
