// Tab "Xu hướng NL" — phân tích tỉ lệ NL không đạt kiểm nhiễm khuẩn theo tháng. Tách ra từ
// App.jsx để nhúng làm 1 tab con trong Cảnh báo lên men > Tổng quan (LenMenOverview.jsx),
// cạnh "Tổng quan lên men" và "Đối chiếu NL" — cả 3 đều là báo cáo xu hướng nhiễm khuẩn của
// cùng 1 chuỗi sản xuất (lên men → NL) nên gộp về 1 chỗ thay vì tách 2 menu như trước.
import React, { useState, useEffect, useMemo } from "react";
import { ChevronUp, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { computeNLTrendStats, monthLabelVN } from "./lib/materialsQc.js";
import { fetchNLTrendReports, saveNLTrendReport, requestNLTrendAI, OVERVIEW_REPORT_MONTH } from "./lib/nlTrendReportsApi.js";

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? "–"
  : v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }));

function NLTrendStat({ label, value, sub, tone = "slate" }) {
  const toneCls = { slate: "text-slate-800", rose: "text-rose-600", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Line chart 1 chuỗi (đơn), tỉ lệ % không đạt theo tháng — SVG tay, không dùng thư viện ngoài. Mảnh
 * (2px), đầu mút bo tròn, có hover crosshair+tooltip, gridline mờ, không cần legend vì tiêu đề đã
 * nêu tên chuỗi (đúng nguyên tắc "1 chuỗi thì không cần hộp legend"). */
function NLTrendLineChart({ points }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 200, padL = 36, padR = 12, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  if (points.length === 0) return <div className="text-xs text-slate-400 text-center py-10">Chưa đủ dữ liệu để vẽ xu hướng.</div>;
  const maxY = Math.max(10, ...points.map((p) => p.pct)) * 1.15;
  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - (v / maxY) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 220 }}>
        {ticksY.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e1e0d9" strokeWidth={1} />
            <text x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#898781">{fmt(t, 0)}%</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#e11d48" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.pct)} r={hover === i ? 5 : 3.5} fill="#e11d48"
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        {points.map((p, i) => (
          (points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
            <text key={`lbl-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#898781">{p.label.replace("Tháng ", "T")}</text>
          )
        ))}
      </svg>
      {hover != null && (
        <div className="absolute bg-slate-800 text-white text-[11px] rounded px-2 py-1 pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].pct) / H) * 100}%` }}>
          {points[hover].label}: {fmt(points[hover].pct, 1)}% ({points[hover].fail}/{points[hover].total})
        </div>
      )}
    </div>
  );
}

/** Bar chart ngang gọn — dùng cho phân tích theo hạng mục (nhiễm con nào / theo chủng). Mảnh, có
 * khoảng cách rõ giữa các thanh, nhãn trực tiếp (không cần bảng chú giải riêng vì mỗi thanh đã tự có
 * nhãn tên ngay cạnh). */
function NLTrendBarChart({ items, color = "#e11d48" }) {
  if (!items.length) return <div className="text-xs text-slate-400 text-center py-6">Không có dữ liệu.</div>;
  const max = Math.max(1, ...items.map((it) => it.value));
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <div className="w-36 shrink-0 text-slate-600 truncate" title={it.label}>{it.label}</div>
          <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: color, minWidth: it.value > 0 ? "6px" : 0 }} />
          </div>
          <div className="w-10 shrink-0 text-right text-slate-500 tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Phân tích tỉ lệ NL không đạt kiểm nhiễm khuẩn theo tháng, từ đúng dữ liệu materials hiện có
 * (nhóm theo tháng nhập kết quả QC — xem computeNLTrendStats), chia thành các tab tháng riêng
 * + 1 tab "Toàn bộ" gộp hết. Đánh giá AI CHỈ chạy khi NCV chủ động bấm nút (không tự động) —
 * lưu lại theo từng tháng để không phải tạo lại mỗi lần xem. */
export default function NLTrendPanel({ materials, actorId, setNote }) {
  const statsByMonth = useMemo(() => computeNLTrendStats(materials), [materials]);
  const monthKeys = useMemo(() => [...statsByMonth.keys()].reverse(), [statsByMonth]); // mới nhất trước
  // Nhóm theo năm để bấm 1 năm mới xổ ra các tháng của năm đó — trước đó liệt kê phẳng hết mọi
  // tháng từ trước tới nay (2021...2026, kể cả năm lỗi 2036 do lô nhập sai ngày) nhìn rất rối.
  const monthsByYear = useMemo(() => {
    const map = new Map();
    for (const mk of monthKeys) {
      const y = mk.slice(0, 4);
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(mk);
    }
    return map;
  }, [monthKeys]);
  const years = useMemo(() => [...monthsByYear.keys()], [monthsByYear]); // đã sắp mới nhất trước (theo monthKeys)
  const [expandedYear, setExpandedYear] = useState(() => monthKeys[0]?.slice(0, 4) ?? null);
  const [selected, setSelected] = useState("overview");
  const [reports, setReports] = useState({}); // reportMonth ("YYYY-MM-01") -> row
  const [loadingReports, setLoadingReports] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    fetchNLTrendReports()
      .then((rows) => setReports(Object.fromEntries(rows.map((r) => [r.reportMonth, r]))))
      // Không hiện nguyên văn lỗi Postgres/Supabase (có thể lộ tên bảng/schema thật) — chỉ báo
      // chung chung, đủ để NCV biết cần báo lại admin kiểm tra migration.
      .catch(() => setNote("Không tải được đánh giá AI đã lưu trước đó — có thể do chưa chạy đủ migration. Vẫn xem được số liệu, chỉ phần đánh giá đã lưu bị ảnh hưởng."))
      .finally(() => setLoadingReports(false));
  }, [setNote]);

  const overviewStats = useMemo(() => {
    const acc = {
      totalProduced: 0, qcDone: 0, qcPending: 0, fail: 0, passSub: 0, pass: 0,
      byStrain: { subtilis: { total: 0, fail: 0 }, clausii: { total: 0, fail: 0 } }, byReason: {},
    };
    for (const s of statsByMonth.values()) {
      acc.totalProduced += s.totalProduced; acc.qcDone += s.qcDone; acc.qcPending += s.qcPending;
      acc.fail += s.fail; acc.passSub += s.passSub; acc.pass += s.pass;
      for (const strain of ["subtilis", "clausii"]) {
        acc.byStrain[strain].total += s.byStrain[strain].total;
        acc.byStrain[strain].fail += s.byStrain[strain].fail;
      }
      for (const [reason, n] of Object.entries(s.byReason)) acc.byReason[reason] = (acc.byReason[reason] || 0) + n;
    }
    return acc;
  }, [statsByMonth]);

  // % không đạt tính trên số ĐÃ CÓ KQ (qcDone) — không tính trên totalProduced, để không bị pha
  // loãng bởi lô còn tồn đọng chưa QC (đặc biệt tháng gần đây, QC chưa kịp trả hết).
  const linePoints = useMemo(() => monthKeys.slice().reverse().map((mk) => {
    const s = statsByMonth.get(mk);
    return { label: monthLabelVN(mk), pct: s.qcDone ? (s.fail / s.qcDone) * 100 : 0, fail: s.fail, total: s.qcDone };
  }), [monthKeys, statsByMonth]);

  const isOverview = selected === "overview";
  const curStats = isOverview ? overviewStats : statsByMonth.get(selected);
  const curLabel = isOverview ? "Toàn bộ dữ liệu" : monthLabelVN(selected);
  // "Toàn bộ" dùng chung đúng 1 cơ chế lưu/hiện với từng tháng, chỉ khác khoá lưu là hằng số
  // OVERVIEW_REPORT_MONTH (ngày mốc giả) thay vì "YYYY-MM-01" thật — tận dụng lại constraint
  // unique(report_month) sẵn có, không cần state/nhánh xử lý riêng cho "Toàn bộ" nữa.
  const reportMonthKey = isOverview ? OVERVIEW_REPORT_MONTH : `${selected}-01`;
  const savedReport = reports[reportMonthKey];

  const runAi = async () => {
    if (!curStats) return;
    setAiLoading(true); setAiError("");
    try {
      const explanation = await requestNLTrendAI(curStats, curLabel);
      const createdAt = new Date().toISOString();
      setReports((prev) => ({ ...prev, [reportMonthKey]: { reportMonth: reportMonthKey, stats: curStats, aiAssessment: explanation, createdAt } }));
      // Lưu lại để lần sau khỏi tạo lại — nếu lưu lỗi (vd chưa chạy migration), vẫn giữ nguyên
      // đánh giá vừa tạo trên màn hình, chỉ báo riêng là chưa lưu được, không lộ lỗi DB gốc.
      try {
        await saveNLTrendReport({ reportMonth: reportMonthKey, stats: curStats, aiAssessment: explanation, createdBy: actorId });
      } catch {
        setNote("Đã tạo đánh giá nhưng không lưu lại được — có thể do chưa chạy đủ migration. Đánh giá vẫn hiện ở dưới, chỉ là lần sau mở lại sẽ phải tạo lại.");
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const reasonItems = curStats ? Object.entries(curStats.byReason).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })) : [];
  const strainItems = curStats ? [
    { label: "Subtilis", value: curStats.byStrain.subtilis.fail },
    { label: "Clausii", value: curStats.byStrain.clausii.fail },
  ] : [];

  const aiText = savedReport?.aiAssessment;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setSelected("overview")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${isOverview ? "bg-[#28374a] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            Toàn bộ
          </button>
          {years.map((y) => (
            <button key={y} onClick={() => setExpandedYear(expandedYear === y ? null : y)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition ${expandedYear === y ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              Năm {y}
              {expandedYear === y ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ))}
          {!loadingReports && monthKeys.length === 0 && (
            <span className="text-xs text-slate-400 px-2 py-1.5">Chưa có lô NL nào để thống kê.</span>
          )}
        </div>
        {expandedYear && monthsByYear.has(expandedYear) && (
          <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-slate-100">
            {monthsByYear.get(expandedYear).map((mk) => (
              <button key={mk} onClick={() => setSelected(mk)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${selected === mk ? "bg-[#28374a] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                {monthLabelVN(mk)}
              </button>
            ))}
          </div>
        )}
      </div>

      {curStats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NLTrendStat label="Tổng lô sản xuất" value={fmt(curStats.totalProduced, 0)} sub={curLabel} />
            <NLTrendStat label="Đã nhập KQ QC" value={fmt(curStats.qcDone, 0)}
              sub={curStats.totalProduced ? `${fmt((curStats.qcDone / curStats.totalProduced) * 100, 1)}% tổng lô` : "–"} />
            <NLTrendStat label="Chưa nhập KQ QC" value={fmt(curStats.qcPending, 0)} tone="amber"
              sub={curStats.totalProduced ? `${fmt((curStats.qcPending / curStats.totalProduced) * 100, 1)}% tổng lô` : "–"} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NLTrendStat label="Không đạt (nhiễm)" value={fmt(curStats.fail, 0)} tone="rose"
              sub={curStats.qcDone ? `${fmt((curStats.fail / curStats.qcDone) * 100, 1)}% số lô đã QC` : "–"} />
            <NLTrendStat label="Nhiễm chéo subtilis (clausii Loại 2)" value={fmt(curStats.passSub, 0)} tone="amber"
              sub={curStats.qcDone ? `${fmt((curStats.passSub / curStats.qcDone) * 100, 1)}% số lô đã QC` : "–"} />
            <NLTrendStat label="Đạt" value={fmt(curStats.pass, 0)} tone="emerald"
              sub={curStats.qcDone ? `${fmt((curStats.pass / curStats.qcDone) * 100, 1)}% số lô đã QC` : "–"} />
          </div>

          {isOverview && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold text-sm mb-3">Xu hướng tỉ lệ không đạt theo tháng</h3>
              <NLTrendLineChart points={linePoints} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold text-sm mb-3">Không đạt theo loại nhiễm (nhiễm con nào)</h3>
              <NLTrendBarChart items={reasonItems} color="#e11d48" />
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold text-sm mb-3">Không đạt theo chủng</h3>
              <NLTrendBarChart items={strainItems} color="#0284c7" />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <button disabled={aiLoading} onClick={runAi}
                className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {aiLoading ? "Đang phân tích..." : aiText ? "Tạo lại đánh giá AI" : "Tạo đánh giá AI"}
              </button>
              <span className="text-[11px] text-slate-400">AI phân tích dựa trên đúng số liệu thống kê ở trên, không tự bịa số khác.</span>
            </div>
            {aiError && <p className="mt-2 text-xs text-rose-600">Lỗi: {aiError}</p>}
            {aiText && (
              <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm text-slate-700 whitespace-pre-wrap">
                {aiText}
                {savedReport?.createdAt && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    Lập lúc {new Date(savedReport.createdAt).toLocaleString("vi-VN")}
                  </p>
                )}
              </div>
            )}
            {!aiText && !aiLoading && (
              <p className="mt-2 text-xs text-slate-400">Chưa có đánh giá AI cho {isOverview ? "toàn bộ dữ liệu" : curLabel.toLowerCase()} — bấm nút phía trên để tạo.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
