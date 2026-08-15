// Menu "Cảnh báo lên men" — port từ app Node + SQLite chạy riêng trước đây
// (canhbaolenmen.dtpduyetquytrinhsanxuat.io.vn) thành 1 mục trong sidebar, dưới "Sản phẩm".
//
// Lát cắt hiện tại: XEM Danh sách lô + Định lượng mật độ. Sửa/thêm lô, Kế hoạch sản xuất
// và Tổng quan làm ở các commit sau — hệ cũ vẫn chạy song song cho tới khi đủ parity.
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search, CircleDashed } from "lucide-react";
import { fetchBatches, subscribeBatches, fetchLenmenSettings, parseDensityConfig } from "./lib/lenmenApi.js";
import {
  canonicalStrainName, chaiCountForScale, computeFinishedTubesFromDensity,
  densityFormulaForStrain, isDensityEligible, sortBatchesNewestFirst,
} from "./lib/lenmenFormula.js";
import LenMenOverview from "./LenMenOverview.jsx";

const PAGE_SIZE = 15;
const PREP_STATUSES = ["Chờ lên men", "Chờ pha", "Chờ hủy", "Đã xử lý"];

const fmtInt = (v) => (v == null ? "–" : Number(v).toLocaleString("vi-VN"));

/* ------------------------------- Nhãn trạng thái ------------------------------- */

// Nhiễm subtilis đơn thuần vẫn ĐẠT — hiển thị màu hổ phách để phân biệt với "sạch hoàn
// toàn" (xanh), vì QC cần thấy ngay là lô có nhiễm nhưng được chấp nhận.
function QcBadge({ batch }) {
  if (batch.isInfected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap">
        <AlertTriangle className="w-3 h-3" /> Cảnh báo
      </span>
    );
  }
  if ((batch.contaminant || "").toLowerCase().includes("subtilis")) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
        <CheckCircle2 className="w-3 h-3" /> Đạt (nhiễm B.subtilis)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3" /> Đạt
    </span>
  );
}

const PREP_STYLE = {
  "Chờ lên men": "bg-slate-100 text-slate-600",
  "Chờ pha": "bg-sky-100 text-sky-700",
  "Chờ hủy": "bg-rose-100 text-rose-700",
  "Đã xử lý": "bg-slate-100 text-slate-500",
};

function PrepBadge({ status }) {
  if (!status) return <span className="text-slate-300">–</span>;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${PREP_STYLE[status] || "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

/* ---------------------------------- Bộ lọc ---------------------------------- */

function FilterBar({ months, strains, filters, setFilters, showStatus }) {
  const set = (patch) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const selectCls = "border border-slate-300 rounded-md px-3 py-2 text-sm bg-white";
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 mb-3 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="text-xs text-slate-500">Tìm kiếm</label>
        <div className="relative mt-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Mã lô, chủng men…"
            className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500">Đợt sản xuất</label>
        <select value={filters.month} onChange={(e) => set({ month: e.target.value })} className={`block mt-1 ${selectCls}`}>
          <option value="ALL">Tất cả</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-500">Chủng men</label>
        <select value={filters.strain} onChange={(e) => set({ strain: e.target.value })} className={`block mt-1 ${selectCls}`}>
          <option value="ALL">Tất cả</option>
          {strains.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {showStatus && (
        <div>
          <label className="text-xs text-slate-500">Trạng thái</label>
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={`block mt-1 ${selectCls}`}>
            <option value="ALL">Tất cả</option>
            <option value="INFECTED">Chỉ lô cảnh báo</option>
            <option value="PASS">Chỉ lô đạt</option>
            {PREP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function Pagination({ total, page, setPage }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const btn = "px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center justify-between gap-2 mt-3 text-xs text-slate-500">
      <span>Hiển thị {from}–{to} trong tổng số {total} lô</span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
        <span>{page}/{pages}</span>
        <button className={btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
      </div>
    </div>
  );
}

const TH = ({ children, className = "" }) => (
  <th className={`px-3 py-2 font-medium text-[11px] text-slate-400 text-left whitespace-nowrap ${className}`}>{children}</th>
);
const TD = ({ children, className = "" }) => (
  <td className={`px-3 py-1.5 align-top ${className}`}>{children}</td>
);

function EmptyCard({ children }) {
  return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">{children}</div>;
}

/* ------------------------------ Bảng nhiễm khuẩn ------------------------------ */

function BatchTable({ rows }) {
  if (!rows.length) return <EmptyCard>Không có lô nào khớp bộ lọc.</EmptyCard>;
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-slate-50">
          <tr>
            <TH>Chủng men</TH><TH>Mã lô</TH><TH>Đợt SX</TH><TH>Xưởng</TH><TH>Cỡ lô</TH>
            <TH className="text-right">Ống thành phẩm</TH><TH>Kết luận QC</TH><TH>Trạng thái</TH>
            <TH className="whitespace-normal">Chi tiết nhiễm / ghi chú</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
              <TD className="whitespace-normal">{b.rawMaterial || "–"}</TD>
              <TD className="font-mono font-medium text-slate-800">{b.lotNumber}</TD>
              <TD>{b.productionBatch || "–"}</TD>
              <TD>{b.factory || "–"}</TD>
              <TD>{b.scale || "–"}</TD>
              <TD className="text-right font-medium">{fmtInt(b.finishedTubes)}</TD>
              <TD><QcBadge batch={b} /></TD>
              <TD><PrepBadge status={b.prepStatus} /></TD>
              <TD className="whitespace-normal text-slate-500 max-w-[260px]">
                {b.isInfected
                  ? <span className="text-rose-600">{b.contaminant}</span>
                  : <span className="text-slate-400">Không phát hiện nhiễm vi khuẩn lạ</span>}
                {b.notes ? <div className="text-[11px] text-slate-400 mt-0.5">{b.notes}</div> : null}
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Bảng định lượng ------------------------------ */

function DensityTable({ rows, config }) {
  if (!rows.length) {
    return (
      <EmptyCard>
        Không có lô nào từ {String(config.cutoffMonth).padStart(2, "0")}/{config.cutoffYear} khớp bộ lọc.
      </EmptyCard>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-slate-50">
          <tr>
            <TH>Chủng men</TH><TH>Mã lô</TH><TH>Đợt SX</TH><TH>Cỡ lô</TH>
            <TH className="text-right">Số chai</TH><TH className="text-right">Ống thành phẩm</TH><TH>Tình trạng</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const details = Array.isArray(b.densityDetails) ? b.densityDetails : [];
            const hasData = details.some((r) => r && (r.volume || r.density_after));
            // Tính lại tại chỗ thay vì tin cột finishedTubes: nếu admin đổi công thức trong
            // Cài đặt thì bảng phải phản ánh ngay, không đợi nhập lại từng lô.
            const computed = computeFinishedTubesFromDensity(b.rawMaterial, details, config.formula);
            const hasFormula = !!densityFormulaForStrain(b.rawMaterial, config.formula);
            return (
              <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                <TD className="whitespace-normal">{b.rawMaterial || "–"}</TD>
                <TD className="font-mono font-medium text-slate-800">{b.lotNumber}</TD>
                <TD>{b.productionBatch || "–"}</TD>
                <TD>{b.scale || "–"}</TD>
                <TD className="text-right">{chaiCountForScale(b.scale, config.chaiPer1000L)}</TD>
                <TD className="text-right font-medium">
                  {hasFormula ? fmtInt(computed ?? b.finishedTubes) : <span className="text-slate-300">–</span>}
                </TD>
                <TD>
                  {hasData ? (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" /> Đã nhập
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      <CircleDashed className="w-3 h-3" /> Chưa nhập
                    </span>
                  )}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- Panel --------------------------------- */

export default function LenMenPanel({ tab }) {
  const [batches, setBatches] = useState([]);
  const [config, setConfig] = useState(() => parseDensityConfig({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", month: "ALL", strain: "ALL", status: "ALL", page: 1 });

  const load = useCallback(async () => {
    try {
      const [rows, settings] = await Promise.all([fetchBatches(), fetchLenmenSettings()]);
      setBatches(rows);
      setConfig(parseDensityConfig(settings));
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nhiều QC nhập cùng lúc — nạp lại khi có thay đổi, như tab Quản lý NL.
  useEffect(() => subscribeBatches(() => { load(); }), [load]);

  const months = useMemo(
    () => [...new Set(batches.map((b) => b.productionBatch).filter(Boolean))]
      .sort((a, b) => {
        const [ma, ya] = a.split("/").map(Number);
        const [mb, yb] = b.split("/").map(Number);
        return yb - ya || mb - ma;
      }),
    [batches]
  );
  const strains = useMemo(
    () => [...new Set(batches.map((b) => canonicalStrainName(b.rawMaterial)).filter(Boolean))].sort(),
    [batches]
  );

  const isDensityTab = tab === "lenmen-density";

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    let rows = batches.filter((b) => {
      if (filters.month !== "ALL" && b.productionBatch !== filters.month) return false;
      if (filters.strain !== "ALL" && canonicalStrainName(b.rawMaterial) !== filters.strain) return false;
      if (q && !`${b.lotNumber || ""} ${b.rawMaterial || ""}`.toLowerCase().includes(q)) return false;
      if (!isDensityTab && filters.status !== "ALL") {
        if (filters.status === "INFECTED") return b.isInfected;
        if (filters.status === "PASS") return !b.isInfected;
        return b.prepStatus === filters.status;
      }
      return true;
    });
    if (isDensityTab) {
      rows = rows.filter((b) => isDensityEligible(b.productionBatch, config.cutoffMonth, config.cutoffYear));
    }
    return sortBatchesNewestFirst(rows);
  }, [batches, filters, isDensityTab, config]);

  const pageRows = filtered.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE);
  const setPage = (page) => setFilters((f) => ({ ...f, page }));

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
        <Loader2 className="w-4 h-4 animate-spin" /> Đang tải dữ liệu lên men…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
        Không tải được dữ liệu: {error}
        <div className="text-xs text-rose-600 mt-1">
          Kiểm tra đã chạy <code className="bg-white px-1 rounded">supabase/migration_lenmen.sql</code> chưa.
        </div>
      </div>
    );
  }

  // Tổng quan tính thẳng từ toàn bộ lô đã nạp, không lọc theo bộ lọc của Danh sách lô —
  // báo cáo phải phản ánh toàn cảnh, không phụ thuộc người dùng đang lọc gì.
  if (tab === "lenmen-overview") return <LenMenOverview batches={batches} />;

  if (tab === "lenmen-khsx") {
    return <EmptyCard>Kế hoạch sản xuất đang được chuyển sang, tạm thời dùng ở hệ thống cũ.</EmptyCard>;
  }

  return (
    <>
      <FilterBar
        months={months} strains={strains} filters={filters} setFilters={setFilters}
        showStatus={!isDensityTab}
      />
      {isDensityTab
        ? <DensityTable rows={pageRows} config={config} />
        : <BatchTable rows={pageRows} />}
      <Pagination total={filtered.length} page={filters.page} setPage={setPage} />
    </>
  );
}
