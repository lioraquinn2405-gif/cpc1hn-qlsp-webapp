// Tổng quan "Cảnh báo lên men" — thống kê + đồ thị cho báo cáo.
//
// Màu ở đây là MÀU TRẠNG THÁI (đạt / chấp nhận / cảnh báo), không phải màu phân biệt
// chuỗi dữ liệu, nên luôn đi kèm nhãn chữ chứ không để người đọc đoán theo màu.
import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Boxes, Flame } from "lucide-react";
import { canonicalStrainName, productionBatchOrderKey } from "./lib/lenmenFormula.js";
import { nkOutcome, baseLotNumber } from "./lib/materialsQc.js";
import NLTrendPanel from "./NLTrendPanel.jsx";

const DAT = "#047857";        // emerald-700 — đạt
const SUBTILIS = "#b45309";   // amber-700  — đạt nhưng có nhiễm subtilis
const CANH_BAO = "#be123c";   // rose-700   — cảnh báo
const TRUNG_TINH = "#475569"; // slate-600  — chuỗi đơn, không mang nghĩa trạng thái

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const pct = (a, b) => (b ? (a / b) * 100 : 0);

function Tile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <Icon className="w-4 h-4" style={{ color: color || "#94a3b8" }} />
      </div>
      <div className="text-2xl font-semibold mt-1" style={{ color: color || "#1e293b" }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children, note }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="font-semibold text-sm mb-3">{title}</div>
      {children}
      {note && <p className="text-[11px] text-slate-400 mt-2">{note}</p>}
    </div>
  );
}

/* --------------------- Thanh ngang xếp chồng (kết luận QC) --------------------- */

function StackedBar({ parts, total }) {
  return (
    <div>
      {/* Khe 2px giữa các mảng để chúng không dính thành một khối liền */}
      <div className="flex gap-[2px] h-7 rounded overflow-hidden">
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} style={{ background: p.color, width: `${pct(p.value, total)}%` }}
            title={`${p.label}: ${fmt(p.value)} lô`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
            {p.label}
            <b className="text-slate-800">{fmt(p.value)}</b>
            <span className="text-slate-400">({pct(p.value, total).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Thanh xếp hạng ------------------------------ */

function RankBars({ rows, color = TRUNG_TINH, unit = "lô" }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-2">Không có dữ liệu.</div>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-44 shrink-0 truncate text-slate-600" title={r.label}>{r.label}</span>
          <div className="flex-1 bg-slate-100 rounded-sm h-4 relative">
            <div className="h-4 rounded-sm" style={{ width: `${pct(r.value, max)}%`, background: color }} />
          </div>
          <span className="w-16 text-right font-medium text-slate-700">{fmt(r.value)} {unit}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------- Xu hướng theo tháng --------------------------- */

const W = 680, H = 220, PAD = { top: 14, right: 16, bottom: 40, left: 40 };

function TrendChart({ months }) {
  if (months.length < 2) {
    return <div className="text-sm text-slate-400 py-6 text-center">Chưa đủ dữ liệu nhiều tháng để vẽ xu hướng.</div>;
  }
  const yMax = Math.max(...months.map((m) => m.tyLe), 10) * 1.15;
  const sx = (i) => PAD.left + (i / Math.max(1, months.length - 1)) * (W - PAD.left - PAD.right);
  const sy = (v) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const ticks = [0, yMax / 2, yMax];
  // Nhãn trục x thưa ra khi nhiều tháng, tránh chữ chồng lên nhau
  const buoc = Math.ceil(months.length / 12);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label="Tỷ lệ lô cảnh báo theo tháng">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
              {t.toFixed(0)}%
            </text>
          </g>
        ))}
        <polyline fill="none" stroke={CANH_BAO} strokeWidth="2" strokeLinejoin="round"
          points={months.map((m, i) => `${sx(i)},${sy(m.tyLe)}`).join(" ")} />
        {months.map((m, i) => (
          <circle key={m.key} cx={sx(i)} cy={sy(m.tyLe)} r="4" fill={CANH_BAO} stroke="#fff" strokeWidth="2">
            <title>{m.key}: {m.nhiem}/{m.tong} lô cảnh báo ({m.tyLe.toFixed(1)}%)</title>
          </circle>
        ))}
        {months.map((m, i) => (i % buoc === 0 ? (
          <text key={m.key} x={sx(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize="9" fill="#94a3b8"
            transform={`rotate(-40 ${sx(i)} ${H - PAD.bottom + 14})`}>{m.key}</text>
        ) : null))}
      </svg>
      <p className="text-[11px] text-slate-400">
        Rê chuột lên từng điểm để xem số lô. Tháng ít lô thì tỷ lệ dao động mạnh — đọc kèm số tuyệt đối.
      </p>
    </div>
  );
}

/* ------------------------------- Đối chiếu NL ------------------------------- */

const CHAI_OUTCOME = {
  pass: { label: "Đạt", color: DAT },
  pass_sub: { label: "Đạt (sub)", color: SUBTILIS },
  fail: { label: "Không đạt", color: CANH_BAO },
};

function ChaiOutcomeBadge({ outcome }) {
  const m = outcome ? CHAI_OUTCOME[outcome] : null;
  if (!m) return <span className="text-[11px] text-slate-400">Chưa QC</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: `${m.color}1a`, color: m.color }}>
      {m.label}
    </span>
  );
}

const MISMATCH_LABEL = {
  "len-men-nhiem-nl-dat": "Lên men nhiễm — NL đạt",
  "len-men-dat-nl-khong-dat": "Lên men đạt — NL không đạt",
};

function MismatchBadge({ mismatch }) {
  if (!mismatch) return <span className="text-slate-300">–</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap">
      <AlertTriangle className="w-3 h-3" /> {MISMATCH_LABEL[mismatch]}
    </span>
  );
}

// Lô lên men bị coi là "lệch" nếu kết luận QC của nó không khớp với kết luận của (ít nhất
// 1) chai NL sinh ra từ nó — vd lên men báo nhiễm nhưng chai NL sau xử lý lại đạt.
function mismatchOf(batch, outcome) {
  if (batch.isInfected && (outcome === "pass" || outcome === "pass_sub")) return "len-men-nhiem-nl-dat";
  if (!batch.isInfected && outcome === "fail") return "len-men-dat-nl-khong-dat";
  return null;
}

function NLReconcile({ batches, materials }) {
  const [level, setLevel] = useState("lo"); // "lo" | "chai"
  const [q, setQ] = useState("");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [onlyMismatch, setOnlyMismatch] = useState(false);

  const joined = useMemo(() => {
    const byLot = new Map();
    for (const m of materials || []) {
      if (m.pendingDelete) continue;
      const lot = baseLotNumber(m.soLo);
      if (!lot) continue;
      if (!byLot.has(lot)) byLot.set(lot, []);
      byLot.get(lot).push(m);
    }

    const rows = [];
    let unmatched = 0;
    for (const b of batches) {
      const chai = byLot.get(b.lotNumber);
      if (!chai || !chai.length) { unmatched++; continue; }
      let pass = 0, passSub = 0, fail = 0, pending = 0, mismatch = null;
      const chaiRows = chai.map((m) => {
        const outcome = nkOutcome(m);
        if (outcome === "pass") pass++;
        else if (outcome === "pass_sub") passSub++;
        else if (outcome === "fail") fail++;
        else pending++;
        if (!mismatch) mismatch = mismatchOf(b, outcome);
        return { m, outcome };
      });
      rows.push({ batch: b, chaiRows, pass, passSub, fail, pending, mismatch });
    }
    rows.sort((a, b) =>
      productionBatchOrderKey(b.batch.productionBatch) - productionBatchOrderKey(a.batch.productionBatch) ||
      (b.batch.id || 0) - (a.batch.id || 0));
    return { rows, unmatched };
  }, [batches, materials]);

  const reasonOptions = useMemo(() => {
    const set = new Set();
    for (const r of joined.rows) {
      for (const t of String(r.batch.contaminant || "").split(",").map((x) => x.trim()).filter(Boolean)) set.add(t);
      for (const { m } of r.chaiRows) if (m.nhiemConNao) set.add(m.nhiemConNao);
    }
    return [...set].sort();
  }, [joined]);

  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return joined.rows.filter((r) => {
      if (onlyMismatch && !r.mismatch) return false;
      if (qq && !r.batch.lotNumber.toLowerCase().includes(qq) &&
        !r.chaiRows.some(({ m }) => (m.soLo || "").toLowerCase().includes(qq))) return false;
      if (reasonFilter !== "ALL") {
        const inContaminant = (r.batch.contaminant || "").includes(reasonFilter);
        const inChai = r.chaiRows.some(({ m }) => m.nhiemConNao === reasonFilter);
        if (!inContaminant && !inChai) return false;
      }
      return true;
    });
  }, [joined, q, reasonFilter, onlyMismatch]);

  const mismatchRows = joined.rows.filter((r) => r.mismatch);
  const mismatchTubes = mismatchRows.reduce((a, r) => a + (Number(r.batch.finishedTubes) || 0), 0);

  const selectCls = "border border-slate-300 rounded-md px-3 py-2 text-sm bg-white";
  const tabCls = (on) => `px-3 py-1.5 rounded-md text-xs font-medium transition ${on ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          <button className={tabCls(level === "lo")} onClick={() => setLevel("lo")}>Theo lô NL</button>
          <button className={tabCls(level === "chai")} onClick={() => setLevel("chai")}>Theo chai NL</button>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-slate-500">Tìm mã lô</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="vd: 26G05SA1"
            className={`w-full mt-1 ${selectCls}`} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Loại nhiễm</label>
          <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}
            className={`block mt-1 ${selectCls} max-w-[220px]`}>
            <option value="ALL">Tất cả</option>
            {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2">
          <input type="checkbox" checked={onlyMismatch} onChange={(e) => setOnlyMismatch(e.target.checked)} />
          Chỉ hiện lô lệch kết luận
        </label>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile icon={Boxes} label="Lô lên men có dữ liệu NL" value={fmt(joined.rows.length)}
          sub={joined.unmatched ? `${fmt(joined.unmatched)} lô chưa có dữ liệu NL để đối chiếu` : "đã khớp mã lô đầy đủ"} />
        <Tile icon={AlertTriangle} label="Lô lệch kết luận" value={fmt(mismatchRows.length)}
          sub={`${pct(mismatchRows.length, joined.rows.length).toFixed(1)}% lô có dữ liệu đối chiếu`} color={CANH_BAO} />
        <Tile icon={Flame} label="Ống thành phẩm của các lô lệch" value={fmt(mismatchTubes)}
          sub="tổng ống lên men của các lô lệch kết luận" color={CANH_BAO} />
      </div>

      {level === "lo" ? (
        <Card title="Đối chiếu theo lô NL" note="Đạt/Không đạt/Chưa QC tính trên các chai NL sinh ra từ lô lên men này.">
          {filteredRows.length === 0 ? (
            <div className="text-sm text-slate-400 py-2">Không có lô nào khớp bộ lọc.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-slate-50">
                  <tr>
                    {["Mã lô lên men", "Chủng", "Đợt SX", "Ống thành phẩm", "KL QC lên men", "Số chai NL", "Đạt", "Không đạt", "Chưa QC", "Lệch kết luận"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.batch.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-mono font-medium">{r.batch.lotNumber}</td>
                      <td className="px-3 py-1.5">{r.batch.rawMaterial || "–"}</td>
                      <td className="px-3 py-1.5">{r.batch.productionBatch || "–"}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(r.batch.finishedTubes)}</td>
                      <td className="px-3 py-1.5" style={{ color: r.batch.isInfected ? CANH_BAO : DAT }}>
                        {r.batch.isInfected ? "Cảnh báo" : "Đạt"}
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmt(r.chaiRows.length)}</td>
                      <td className="px-3 py-1.5 text-right" style={{ color: DAT }}>{fmt(r.pass + r.passSub)}</td>
                      <td className="px-3 py-1.5 text-right" style={{ color: CANH_BAO }}>{fmt(r.fail)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{fmt(r.pending)}</td>
                      <td className="px-3 py-1.5"><MismatchBadge mismatch={r.mismatch} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Đối chiếu theo chai NL">
          {filteredRows.length === 0 ? (
            <div className="text-sm text-slate-400 py-2">Không có lô nào khớp bộ lọc.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-slate-50">
                  <tr>
                    {["Mã lô lên men", "Số lô NL (chai)", "KL QC lên men", "KL QC NL (chai)", "Nhiễm con nào (NL)", "Lệch?"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.flatMap((r) => r.chaiRows.map(({ m, outcome }) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-mono font-medium">{r.batch.lotNumber}</td>
                      <td className="px-3 py-1.5 font-mono">{m.soLo}</td>
                      <td className="px-3 py-1.5" style={{ color: r.batch.isInfected ? CANH_BAO : DAT }}>
                        {r.batch.isInfected ? "Cảnh báo" : "Đạt"}
                      </td>
                      <td className="px-3 py-1.5"><ChaiOutcomeBadge outcome={outcome} /></td>
                      <td className="px-3 py-1.5 text-slate-500">{m.nhiemConNao || "–"}</td>
                      <td className="px-3 py-1.5"><MismatchBadge mismatch={mismatchOf(r.batch, outcome)} /></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- Tổng quan --------------------------------- */

export default function LenMenOverview({ batches, materials, actorId, setNote }) {
  const s = useMemo(() => {
    const tong = batches.length;
    const nhiem = batches.filter((b) => b.isInfected);
    // Ngoại lệ subtilis: không tính là nhiễm, nhưng vẫn phải thấy được vì là tín hiệu sớm.
    const subtilis = batches.filter((b) => !b.isInfected && (b.contaminant || "").toLowerCase().includes("subtilis"));
    const sach = tong - nhiem.length - subtilis.length;
    const ongAnhHuong = nhiem.reduce((a, b) => a + (Number(b.finishedTubes) || 0), 0);

    const theoThang = {};
    for (const b of batches) {
      const k = b.productionBatch;
      if (!k) continue;
      theoThang[k] ||= { key: k, tong: 0, nhiem: 0 };
      theoThang[k].tong++;
      if (b.isInfected) theoThang[k].nhiem++;
    }
    const months = Object.values(theoThang)
      .sort((a, b) => productionBatchOrderKey(a.key) - productionBatchOrderKey(b.key))
      .map((m) => ({ ...m, tyLe: pct(m.nhiem, m.tong) }));

    const theoChung = {};
    for (const b of nhiem) {
      const k = canonicalStrainName(b.rawMaterial) || "(không rõ)";
      theoChung[k] = (theoChung[k] || 0) + 1;
    }
    const chung = Object.entries(theoChung).map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);

    const theoTacNhan = {};
    for (const b of nhiem) {
      for (const t of String(b.contaminant || "(không ghi)").split(",").map((x) => x.trim()).filter(Boolean)) {
        theoTacNhan[t] = (theoTacNhan[t] || 0) + 1;
      }
    }
    const tacNhan = Object.entries(theoTacNhan).map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);

    const ganDay = [...nhiem]
      .sort((a, b) => productionBatchOrderKey(b.productionBatch) - productionBatchOrderKey(a.productionBatch) || b.id - a.id)
      .slice(0, 10);

    return { tong, nhiem: nhiem.length, subtilis: subtilis.length, sach, ongAnhHuong, months, chung, tacNhan, ganDay };
  }, [batches]);

  const [view, setView] = useState("tongquan"); // "tongquan" | "xuhuong" | "doichieu"
  const tabCls = (on) => `px-3 py-1.5 rounded-md text-xs font-medium transition ${on ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`;

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button className={tabCls(view === "tongquan")} onClick={() => setView("tongquan")}>Tổng quan lên men</button>
        <button className={tabCls(view === "xuhuong")} onClick={() => setView("xuhuong")}>Xu hướng NL</button>
        <button className={tabCls(view === "doichieu")} onClick={() => setView("doichieu")}>Đối chiếu NL</button>
      </div>

      {view === "xuhuong" ? (
        <NLTrendPanel materials={materials} actorId={actorId} setNote={setNote} />
      ) : view === "doichieu" ? (
        <NLReconcile batches={batches} materials={materials} />
      ) : (
      <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Boxes} label="Tổng số lô" value={fmt(s.tong)} sub="lô lên men đã ghi nhận" />
        <Tile icon={AlertTriangle} label="Lô cảnh báo" value={fmt(s.nhiem)}
          sub={`${pct(s.nhiem, s.tong).toFixed(1)}% tổng số lô`} color={CANH_BAO} />
        <Tile icon={CheckCircle2} label="Đạt — nhiễm B.subtilis" value={fmt(s.subtilis)}
          sub="ngoại lệ, vẫn tính là đạt" color={SUBTILIS} />
        <Tile icon={Flame} label="Ống bị ảnh hưởng" value={fmt(s.ongAnhHuong)}
          sub="tổng ống của các lô cảnh báo" color={CANH_BAO} />
      </div>

      <Card title="Kết luận QC toàn bộ lô">
        <StackedBar total={s.tong} parts={[
          { label: "Đạt", value: s.sach, color: DAT },
          { label: "Đạt — nhiễm B.subtilis", value: s.subtilis, color: SUBTILIS },
          { label: "Cảnh báo", value: s.nhiem, color: CANH_BAO },
        ]} />
      </Card>

      <Card title="Xu hướng tỷ lệ lô cảnh báo theo đợt sản xuất">
        <TrendChart months={s.months} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Chủng men có nhiều lô cảnh báo nhất"
          note="Đếm số lô cảnh báo, chưa chia cho tổng lô của từng chủng — chủng sản xuất nhiều tự nhiên sẽ đứng đầu.">
          <RankBars rows={s.chung} color={CANH_BAO} />
        </Card>
        <Card title="Tác nhân nhiễm thường gặp"
          note="Một lô ghi nhiều tác nhân sẽ được đếm ở từng tác nhân.">
          <RankBars rows={s.tacNhan} color={CANH_BAO} unit="lượt" />
        </Card>
      </div>

      <Card title="Lô cảnh báo gần nhất">
        {s.ganDay.length === 0 ? (
          <div className="text-sm text-slate-400 py-2">Không có lô nào bị cảnh báo.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-slate-50">
                <tr>
                  {["Mã lô", "Chủng men", "Đợt SX", "Tác nhân", "Ống ảnh hưởng"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-[11px] text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.ganDay.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono font-medium">{b.lotNumber}</td>
                    <td className="px-3 py-1.5">{b.rawMaterial || "–"}</td>
                    <td className="px-3 py-1.5">{b.productionBatch || "–"}</td>
                    <td className="px-3 py-1.5 whitespace-normal" style={{ color: CANH_BAO }}>{b.contaminant || "–"}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(b.finishedTubes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  );
}
