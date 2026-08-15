// Đồ thị độ ổn định của một lô chủng giống, dùng cho báo cáo.
//
// MỘT trục y duy nhất. Hai chỉ tiêu có đơn vị khác nhau (mật độ ống chủng tính theo
// 10⁹ CFU/ml, mật độ cô đặc theo 10¹⁰ CFU/ml) nên KHÔNG vẽ 2 trục — thay vào đó cả hai
// đều được đọc là "gấp bao nhiêu lần ngưỡng đạt của chính nó", vì giá trị trong sổ vốn
// đã ghi theo bội số của ngưỡng (3.33 nghĩa là 3,33×10⁹). Nhờ vậy đường mốc 1,0 là
// ngưỡng chung cho cả hai, và so sánh giữa chúng mới có nghĩa.
import React, { useState, useMemo } from "react";

const SERIES = [
  { key: "matDoOngChung", label: "Mật độ ống chủng", nguong: "10⁹ CFU/ml", color: "#2a78d6" },
  { key: "matDoCoDac", label: "Mật độ cô đặc", nguong: "10¹⁰ CFU/ml", color: "#eb6834" },
];

const W = 640, H = 260;
const PAD = { top: 16, right: 18, bottom: 34, left: 44 };

export default function SeedStabilityChart({ points }) {
  const [hover, setHover] = useState(null);

  const data = useMemo(() => {
    const pts = [...(points || [])]
      .filter((p) => SERIES.some((s) => p[s.key] != null && p[s.key] !== ""))
      .sort((a, b) => a.mocThang - b.mocThang);
    if (!pts.length) return null;

    const xs = pts.map((p) => Number(p.mocThang));
    const vals = pts.flatMap((p) => SERIES.map((s) => Number(p[s.key])).filter(Number.isFinite));
    const xMax = Math.max(...xs, 1);
    // Trục luôn bao gồm mốc 1,0 để đường ngưỡng không rơi ra ngoài khung.
    const yMax = Math.max(...vals, 1) * 1.15;

    const sx = (m) => PAD.left + (Number(m) / xMax) * (W - PAD.left - PAD.right);
    const sy = (v) => H - PAD.bottom - (Number(v) / yMax) * (H - PAD.top - PAD.bottom);

    const series = SERIES.map((s) => ({
      ...s,
      pts: pts
        .filter((p) => p[s.key] != null && p[s.key] !== "" && Number.isFinite(Number(p[s.key])))
        .map((p) => ({ moc: Number(p.mocThang), v: Number(p[s.key]), x: sx(p.mocThang), y: sy(p[s.key]) })),
    })).filter((s) => s.pts.length);

    // Chỉ đánh dấu mốc có số liệu, tránh trục dày đặc nhãn.
    const ticksX = [...new Set(xs)].sort((a, b) => a - b);
    const step = yMax / 4;
    const ticksY = [0, step, step * 2, step * 3, step * 4];

    return { pts, series, sx, sy, ticksX, ticksY, yMax, nguongY: sy(1) };
  }, [points]);

  if (!data) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center">
        Chưa có số liệu mật độ nào để vẽ đồ thị.
      </div>
    );
  }

  const { series, ticksX, ticksY, sx, sy, nguongY } = data;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label="Đồ thị mật độ theo mốc theo dõi độ ổn định">
        {/* lưới + trục y: mờ, không tranh chấp với dữ liệu */}
        {ticksY.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* ngưỡng đạt = 1,0 lần */}
        <line x1={PAD.left} x2={W - PAD.right} y1={nguongY} y2={nguongY}
          stroke="#e11d48" strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={W - PAD.right} y={nguongY - 5} textAnchor="end" fontSize="10" fill="#e11d48">
          Ngưỡng đạt (1,0×)
        </text>

        {/* trục x */}
        {ticksX.map((m) => (
          <text key={m} x={sx(m)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize="10" fill="#94a3b8">
            {m === 0 ? "Ban đầu" : m + "t"}
          </text>
        ))}
        <text x={(W + PAD.left) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">
          Mốc theo dõi (tháng kể từ NSX)
        </text>

        {series.map((s) => (
          <g key={s.key}>
            <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              points={s.pts.map((p) => `${p.x},${p.y}`).join(" ")} />
            {s.pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2"
                onMouseEnter={() => setHover({ ...p, label: s.label, color: s.color })}
                onMouseLeave={() => setHover(null)} />
            ))}
            {/* nhãn trực tiếp ở điểm cuối — không ghi số lên mọi điểm */}
            <text x={s.pts[s.pts.length - 1].x - 6} y={s.pts[s.pts.length - 1].y - 9}
              textAnchor="end" fontSize="10" fill="#475569">
              {s.pts[s.pts.length - 1].v}
            </text>
          </g>
        ))}

        {hover && (
          <g pointerEvents="none">
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={H - PAD.bottom} stroke="#cbd5e1" strokeWidth="1" />
            <circle cx={hover.x} cy={hover.y} r="6.5" fill="none" stroke={hover.color} strokeWidth="2" />
          </g>
        )}
      </svg>

      <div className="flex items-center gap-4 flex-wrap mt-1">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span className="w-3 h-[3px] rounded-full" style={{ background: s.color }} />
            {s.label} <span className="text-slate-400">(ngưỡng {s.nguong})</span>
          </span>
        ))}
      </div>

      {hover && (
        <div className="mt-1 text-xs text-slate-700">
          <b>{hover.label}</b> tại mốc {hover.moc === 0 ? "ban đầu" : hover.moc + " tháng"}:{" "}
          <b>{hover.v}</b>× ngưỡng
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-2">
        Trục dọc là <b>bội số của ngưỡng đạt</b> — sổ vốn ghi theo cách đó (3,33 nghĩa là 3,33×10⁹).
        Nhờ vậy hai chỉ tiêu khác đơn vị vẫn đọc chung một trục, không phải vẽ hai trục.
      </p>
    </div>
  );
}
