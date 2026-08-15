// Thống kê / báo cáo kho chủng giống.
//
// Ba câu hỏi mà sổ Excel phải mở nhiều sheet mới trả lời được, gom về một chỗ:
//   1. Còn bao nhiêu ống, ở kho nào, của chủng nào?
//   2. Lô nào quá hạn hoặc sắp hết hạn?
//   3. Lô nào đến hạn kiểm mà chưa làm? (đúng cột "Chỉ tiêu cần thực hiện" của sheet Lọc)
import React, { useMemo } from "react";
import { AlertTriangle, CalendarClock, PackageCheck } from "lucide-react";
import { DIEU_KIEN_LUU_LABEL, dueCheckpoints, danhGiaMoc, monthsSince } from "./lib/seedLotsApi.js";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "–");
const SAP_HET_HAN_NGAY = 90;

function Card({ icon: Icon, title, children, tone = "slate" }) {
  const border = { slate: "border-slate-200", rose: "border-rose-200", amber: "border-amber-200" }[tone];
  return (
    <div className={`bg-white rounded-lg border ${border} p-4`}>
      <div className="flex items-center gap-2 font-semibold text-sm mb-3">
        <Icon className="w-4 h-4 text-slate-400" /> {title}
      </div>
      {children}
    </div>
  );
}

const Th = ({ children, className = "" }) => (
  <th className={`px-3 py-2 text-left font-medium text-[11px] text-slate-400 ${className}`}>{children}</th>
);

function MiniTable({ cols, rows, empty }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-2">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-slate-50">
          <tr>{cols.map((c) => <Th key={c.key} className={c.right ? "text-right" : ""}>{c.label}</Th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 ${c.right ? "text-right" : ""} ${c.mono ? "font-mono" : ""}`}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SeedReport({ lots, allStability, protocol }) {
  const stat = useMemo(() => {
    const now = new Date();
    const byLot = {};
    for (const p of allStability || []) (byLot[p.seedLotId] ||= []).push(p);

    // Tồn theo chủng — gộp cả 2 kho vì câu hỏi thường là "chủng này còn mấy ống".
    const theoChung = {};
    for (const l of lots) {
      const k = l.maChung || "(chưa có mã)";
      theoChung[k] ||= { maChung: k, tenChung: l.tenChung || "", soLo: 0, soOng: 0 };
      theoChung[k].soLo += 1;
      theoChung[k].soOng += Number(l.soOng) || 0;
      if (!theoChung[k].tenChung && l.tenChung) theoChung[k].tenChung = l.tenChung;
    }

    const quaHan = [], sapHetHan = [], denHanKiem = [];
    for (const l of lots) {
      if (l.hanSuDung) {
        const hsd = new Date(l.hanSuDung);
        const conLai = Math.round((hsd - now) / 86400000);
        if (conLai < 0) quaHan.push({ ...l, conLai });
        else if (conLai <= SAP_HET_HAN_NGAY) sapHetHan.push({ ...l, conLai });
      }
      const due = dueCheckpoints(l, byLot[l.id] || [], protocol, now);
      if (due.length) denHanKiem.push({ lot: l, due });
    }
    quaHan.sort((a, b) => a.conLai - b.conLai);
    sapHetHan.sort((a, b) => a.conLai - b.conLai);

    let dat = 0, khongDat = 0, chuaDo = 0;
    const mocKhongDat = [];
    for (const p of allStability || []) {
      const { trangThai, fails } = danhGiaMoc(p);
      if (trangThai === "dat") dat++;
      else if (trangThai === "khong_dat") {
        khongDat++;
        const lot = lots.find((l) => l.id === p.seedLotId);
        mocKhongDat.push({ lot, point: p, fails });
      } else chuaDo++;
    }

    return {
      theoChung: Object.values(theoChung).sort((a, b) => b.soOng - a.soOng || a.maChung.localeCompare(b.maChung)),
      quaHan, sapHetHan, denHanKiem, dat, khongDat, chuaDo,
      mocKhongDat, tongMoc: (allStability || []).length,
    };
  }, [lots, allStability, protocol]);

  return (
    <div className="space-y-3">
      <Card icon={PackageCheck} title="Tồn kho theo chủng">
        <MiniTable
          cols={[
            { key: "maChung", label: "Mã chủng", mono: true },
            { key: "tenChung", label: "Tên chủng" },
            { key: "soLo", label: "Số lô", right: true },
            { key: "soOng", label: "Số ống còn", right: true },
          ]}
          rows={stat.theoChung.map((r) => ({ ...r, tenChung: r.tenChung || "–" }))}
          empty="Chưa có lô nào."
        />
        <p className="text-[11px] text-slate-400 mt-2">
          Gộp cả hai kho ({Object.values(DIEU_KIEN_LUU_LABEL).join(" và ")}). Lọc riêng từng kho ở các thẻ đầu trang.
        </p>
      </Card>

      <Card icon={CalendarClock} title="Đến hạn kiểm độ ổn định" tone="amber">
        <MiniTable
          cols={[
            { key: "soLo", label: "Số lô", mono: true },
            { key: "maChung", label: "Mã chủng", mono: true },
            { key: "tuoi", label: "Tuổi lô", right: true },
            { key: "moc", label: "Mốc còn thiếu" },
          ]}
          rows={stat.denHanKiem.map(({ lot, due }) => ({
            soLo: lot.soLo,
            maChung: lot.maChung,
            tuoi: monthsSince(lot.ngaySanXuat) != null ? monthsSince(lot.ngaySanXuat) + " tháng" : "–",
            moc: due.map((d) => `${d.thang}t (${d.chi_tieu.join(", ")})`).join(" · "),
          }))}
          empty="Không có lô nào đến hạn kiểm."
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card icon={AlertTriangle} title={`Quá hạn dùng (${stat.quaHan.length})`} tone="rose">
          <MiniTable
            cols={[
              { key: "soLo", label: "Số lô", mono: true },
              { key: "maChung", label: "Mã chủng", mono: true },
              { key: "hsd", label: "HSD" },
              { key: "soOng", label: "Còn", right: true },
            ]}
            rows={stat.quaHan.map((l) => ({ soLo: l.soLo, maChung: l.maChung, hsd: fmtDate(l.hanSuDung), soOng: l.soOng ?? 0 }))}
            empty="Không có lô nào quá hạn."
          />
        </Card>

        <Card icon={CalendarClock} title={`Sắp hết hạn trong ${SAP_HET_HAN_NGAY} ngày (${stat.sapHetHan.length})`} tone="amber">
          <MiniTable
            cols={[
              { key: "soLo", label: "Số lô", mono: true },
              { key: "maChung", label: "Mã chủng", mono: true },
              { key: "conLai", label: "Còn lại", right: true },
              { key: "soOng", label: "Còn", right: true },
            ]}
            rows={stat.sapHetHan.map((l) => ({ soLo: l.soLo, maChung: l.maChung, conLai: l.conLai + " ngày", soOng: l.soOng ?? 0 }))}
            empty="Không có lô nào sắp hết hạn."
          />
        </Card>
      </div>

      <Card icon={PackageCheck} title="Kết quả theo dõi độ ổn định">
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            ["Mốc đạt", stat.dat, "text-emerald-700"],
            ["Mốc không đạt", stat.khongDat, "text-rose-700"],
            ["Mốc chưa có số liệu", stat.chuaDo, "text-slate-500"],
          ].map(([label, val, cls]) => (
            <div key={label}>
              <div className="text-xs text-slate-500">{label}</div>
              <div className={`text-base font-semibold mt-0.5 ${cls}`}>{val}</div>
            </div>
          ))}
        </div>
        <MiniTable
          cols={[
            { key: "soLo", label: "Số lô", mono: true },
            { key: "moc", label: "Mốc", right: true },
            { key: "ly_do", label: "Chỉ tiêu không đạt" },
          ]}
          rows={stat.mocKhongDat.map(({ lot, point, fails }) => ({
            soLo: lot?.soLo || "?",
            moc: point.mocThang === 0 ? "Ban đầu" : point.mocThang + " tháng",
            ly_do: fails.join(", "),
          }))}
          empty={`Tất cả ${stat.tongMoc} mốc đã ghi nhận đều đạt hoặc chưa có số liệu.`}
        />
      </Card>
    </div>
  );
}
