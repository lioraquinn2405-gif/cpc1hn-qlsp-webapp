// Tổng quan "Cảnh báo lên men" — thống kê + đồ thị cho báo cáo.
//
// Màu ở đây là MÀU TRẠNG THÁI (đạt / chấp nhận / cảnh báo), không phải màu phân biệt
// chuỗi dữ liệu, nên luôn đi kèm nhãn chữ chứ không để người đọc đoán theo màu.
import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Boxes, Flame } from "lucide-react";
import { canonicalStrainName, productionBatchOrderKey } from "./lib/lenmenFormula.js";

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

/* --------------------------------- Tổng quan --------------------------------- */

export default function LenMenOverview({ batches }) {
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

  return (
    <div className="space-y-3">
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
    </div>
  );
}
