// Menu "Bảo quản chủng giống" — thay file Excel "File tổng SỐ LÔ" + các sheet theo dõi
// độ ổn định (DOD-*/SUBTILIS/CLAUSII) + sheet Lọc tính lịch đến hạn kiểm.
//
// Chưa làm ở lát cắt này: in nhãn ống (các sheet "Nhãn"), sẽ dựng từ chính dòng lô.
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Loader2, ChevronRight, ChevronDown, AlertTriangle, Search } from "lucide-react";
import { fetchLenmenSettings } from "./lib/lenmenApi.js";
import {
  fetchSeedLots, insertSeedLot, fetchStability, saveStabilityPoint,
  parseProtocol, dueCheckpoints, monthsSince,
  DIEU_KIEN_LUU_LABEL, STABILITY_CRITERIA,
} from "./lib/seedLotsApi.js";

const inputCls = "border border-slate-300 rounded-md px-3 py-2 text-sm";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "–");

/* ---------------------------- Thêm lô ống chủng ---------------------------- */

function AddLotForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const empty = {
    soLo: "", maChung: "", tenChung: "", dieuKienLuu: "am_20", ngaySanXuat: "",
    nguonGoc: "", matDo: "", nhiemKhuan: "Đạt", doDongDeu: "Đạt",
    khaNangTaoBaoTu: "Đạt", tinhTrangSx: "", nguoiLam: "",
  };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await onAdd({ ...form, matDo: form.matDo === "" ? null : Number(form.matDo) });
      setForm(empty); setOpen(false);
    } catch (err) {
      setError(err.message || String(err));
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-3 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-md">
        <Plus className="w-4 h-4" /> Thêm lô ống chủng
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
      <div><label className="text-xs text-slate-500">Điều kiện lưu</label>
        <select value={form.dieuKienLuu} onChange={set("dieuKienLuu")} className={`block mt-1 ${inputCls}`}>
          {Object.entries(DIEU_KIEN_LUU_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>
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
      <p className="text-[11px] text-slate-400 w-full">Bỏ trống hạn dùng thì hệ thống tự tính NSX + 1 năm, đúng như nhãn đang in.</p>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}

/* --------------------------- Ma trận độ ổn định --------------------------- */

// Dựng lại đúng bố cục sheet DOD-*: dòng = chỉ tiêu, cột = mốc tháng.
function StabilityMatrix({ lot, points, protocol, onSave }) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const empty = { mocThang: "", ngayKiem: "", me: "", matDoOngChung: "", doDongDeu: "Đạt",
    matDoCoDac: "", khaNangTaoBaoTu: "Đạt", gioiHanNhiemKhuan: "Đạt" };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const cols = points.map((p) => p.mocThang);
  const due = dueCheckpoints(lot, points, protocol);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await onSave({ ...form, seedLotId: lot.id });
      setForm(empty); setAdding(false);
    } catch (err) { setError(err.message || String(err)); }
    setSaving(false);
  };

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="font-semibold text-sm">Theo dõi độ ổn định</div>
        <div className="flex items-center gap-2">
          {due.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="w-3 h-3" />
              Đến hạn: {due.map((d) => `${d.thang} tháng (${d.chi_tieu.join(", ")})`).join(" · ")}
            </span>
          )}
          <button onClick={() => setAdding((v) => !v)}
            className="text-xs border border-slate-300 rounded-md px-2.5 py-1 bg-white hover:bg-slate-50">
            {adding ? "Đóng" : "Nhập mốc kiểm"}
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="text-sm text-slate-400 py-3">Chưa có mốc theo dõi nào.</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">Chỉ tiêu</th>
                <th className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">Ngưỡng</th>
                {cols.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium text-[11px] text-slate-400">
                    {m === 0 ? "Ban đầu" : `${m} tháng`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-500">Mẻ</td>
                <td className="px-3 py-1.5 text-slate-300">–</td>
                {points.map((p) => <td key={p.id} className="px-3 py-1.5 text-right font-mono">{p.me || "–"}</td>)}
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-500">Ngày kiểm</td>
                <td className="px-3 py-1.5 text-slate-300">–</td>
                {points.map((p) => <td key={p.id} className="px-3 py-1.5 text-right">{fmtDate(p.ngayKiem)}</td>)}
              </tr>
              {STABILITY_CRITERIA.map((c) => (
                <tr key={c.key} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-700">{c.label}</td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-400">{c.nguong}</td>
                  {points.map((p) => (
                    <td key={p.id} className="px-3 py-1.5 text-right">
                      {p[c.key] == null || p[c.key] === "" ? <span className="text-slate-300">–</span> : String(p[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <form onSubmit={submit} className="mt-3 bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-slate-500">Mốc (tháng) *</label>
            <input required inputMode="numeric" value={form.mocThang} onChange={set("mocThang")} placeholder="0 = ban đầu" className={`block mt-1 ${inputCls} w-28`} /></div>
          <div><label className="text-xs text-slate-500">Ngày kiểm</label>
            <input type="date" value={form.ngayKiem} onChange={set("ngayKiem")} className={`block mt-1 ${inputCls}`} /></div>
          <div><label className="text-xs text-slate-500">Mẻ</label>
            <input value={form.me} onChange={set("me")} placeholder="010223BSM" className={`block mt-1 ${inputCls} w-32 font-mono`} /></div>
          <div><label className="text-xs text-slate-500">Mật độ ống chủng</label>
            <input inputMode="decimal" value={form.matDoOngChung} onChange={set("matDoOngChung")} className={`block mt-1 ${inputCls} w-24 text-right`} /></div>
          <div><label className="text-xs text-slate-500">Mật độ cô đặc</label>
            <input inputMode="decimal" value={form.matDoCoDac} onChange={set("matDoCoDac")} className={`block mt-1 ${inputCls} w-24 text-right`} /></div>
          <div><label className="text-xs text-slate-500">Độ đồng đều</label>
            <input value={form.doDongDeu} onChange={set("doDongDeu")} className={`block mt-1 ${inputCls} w-24`} /></div>
          <div><label className="text-xs text-slate-500">Tạo bào tử</label>
            <input value={form.khaNangTaoBaoTu} onChange={set("khaNangTaoBaoTu")} className={`block mt-1 ${inputCls} w-24`} /></div>
          <div><label className="text-xs text-slate-500">Nhiễm khuẩn</label>
            <input value={form.gioiHanNhiemKhuan} onChange={set("gioiHanNhiemKhuan")} className={`block mt-1 ${inputCls} w-24`} /></div>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-md">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Lưu mốc
          </button>
          <p className="text-[11px] text-slate-400 w-full">Nhập lại cùng một mốc sẽ ghi đè kết quả cũ của mốc đó.</p>
          {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
        </form>
      )}
    </div>
  );
}

/* --------------------------------- Panel --------------------------------- */

export default function SeedLotPanel() {
  const [lots, setLots] = useState([]);
  const [protocol, setProtocol] = useState([]);
  const [stability, setStability] = useState({});   // { [lotId]: [point, ...] }
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [dieuKien, setDieuKien] = useState("ALL");

  const load = useCallback(async () => {
    try {
      const [rows, settings] = await Promise.all([fetchSeedLots(), fetchLenmenSettings()]);
      setLots(rows);
      setProtocol(parseProtocol(settings));
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Chỉ nạp mốc theo dõi khi mở lô ra xem — sổ có thể vài trăm lô, tải hết là thừa.
  const toggle = async (lot) => {
    if (expanded === lot.id) { setExpanded(null); return; }
    setExpanded(lot.id);
    if (!stability[lot.id]) {
      const points = await fetchStability(lot.id);
      setStability((s) => ({ ...s, [lot.id]: points }));
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lots.filter((l) => {
      if (dieuKien !== "ALL" && l.dieuKienLuu !== dieuKien) return false;
      if (!needle) return true;
      return `${l.soLo} ${l.maChung} ${l.tenChung || ""} ${l.nguonGoc || ""}`.toLowerCase().includes(needle);
    });
  }, [lots, q, dieuKien]);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
      <Loader2 className="w-4 h-4 animate-spin" /> Đang tải sổ chủng giống…
    </div>;
  }
  if (error) {
    return <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
      Không tải được: {error}
      <div className="text-xs text-rose-600 mt-1">
        Kiểm tra đã chạy <code className="bg-white px-1 rounded">supabase/migration_lenmen_giong.sql</code> chưa.
      </div>
    </div>;
  }

  return (
    <>
      <AddLotForm onAdd={addLot} />

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-slate-500">Tìm kiếm</label>
          <div className="relative mt-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Số lô, mã chủng, nguồn gốc…"
              className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Điều kiện lưu</label>
          <select value={dieuKien} onChange={(e) => setDieuKien(e.target.value)} className={`block mt-1 ${inputCls} bg-white`}>
            <option value="ALL">Tất cả</option>
            {Object.entries(DIEU_KIEN_LUU_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Chưa có lô ống chủng nào.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((lot) => {
            const points = stability[lot.id] || [];
            const months = monthsSince(lot.ngaySanXuat);
            const isOpen = expanded === lot.id;
            return (
              <div key={lot.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <button onClick={() => toggle(lot)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  <span className="font-mono text-sm font-medium">{lot.soLo}</span>
                  <span className="font-mono text-xs text-slate-500">{lot.maChung}</span>
                  <span className="text-xs text-slate-600 flex-1 truncate">{lot.tenChung || "–"}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">
                    {DIEU_KIEN_LUU_LABEL[lot.dieuKienLuu] || "Chưa rõ"}
                  </span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    NSX {fmtDate(lot.ngaySanXuat)} · HSD {fmtDate(lot.hanSuDung)}
                    {months != null ? ` · ${months} tháng` : ""}
                  </span>
                </button>
                {isOpen && (
                  <>
                    <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div><div className="text-slate-500">Nguồn gốc</div><div className="font-medium">{lot.nguonGoc || "–"}</div></div>
                      <div><div className="text-slate-500">Mật độ (10⁹ CFU/ml)</div><div className="font-medium">{lot.matDo ?? "–"}</div></div>
                      <div><div className="text-slate-500">Nhiễm khuẩn</div><div className="font-medium">{lot.nhiemKhuan || "–"}</div></div>
                      <div><div className="text-slate-500">Độ đồng đều</div><div className="font-medium">{lot.doDongDeu || "–"}</div></div>
                      <div><div className="text-slate-500">Khả năng tạo bào tử</div><div className="font-medium">{lot.khaNangTaoBaoTu || "–"}</div></div>
                      <div><div className="text-slate-500">Tình trạng SX</div><div className="font-medium">{lot.tinhTrangSx || "–"}</div></div>
                      <div><div className="text-slate-500">Người làm</div><div className="font-medium">{lot.nguoiLam || "–"}</div></div>
                    </div>
                    <StabilityMatrix lot={lot} points={points} protocol={protocol} onSave={savePoint} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
