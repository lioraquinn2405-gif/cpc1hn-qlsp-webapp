// Ô nhập ngày LUÔN hiện dd/mm/yyyy — input type="date" gốc hiện theo ngôn ngữ trình duyệt/hệ điều
// hành của MÁY ĐANG MỞ WEB (có máy để tiếng Anh sẽ ra mm/dd/yyyy, dễ đọc nhầm ngày/tháng), không có
// cách nào ép định dạng hiển thị của nó bằng CSS/JS. Tự dựng ô nhập dạng text có mask + bảng lịch
// bấm chọn riêng (NCV muốn bấm chọn thay vì gõ tay — phản hồi 2026-09) thay thế — value/onChange
// vẫn nhận/trả ISO "YYYY-MM-DD" (rỗng nếu chưa nhập xong) y hệt input type="date" gốc, onChange vẫn
// nhận 1 "event" có e.target.value để mọi nơi gọi cũ (set("ngay"), (e) => setDateFrom(e.target.value)...)
// không cần sửa lại.
import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const POPUP_W = 240; // khớp w-60 bên dưới

const isoToDisplay = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const displayToIso = (s) => {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const WEEKDAYS_VN = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]; // tuần bắt đầu Thứ 2, đúng quy ước VN.

// Lưới ngày của 1 tháng, LUÔN đủ 6 hàng x 7 cột (42 ô, có ngày tháng trước/sau để lấp đầy hàng đầu/
// cuối, mờ đi khi hiện) — số hàng cố định để bảng lịch không đổi chiều cao khi lật qua tháng ít/nhiều
// hàng hơn (tránh giật layout mỗi lần bấm sang tháng).
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  // getDay(): 0=CN..6=T7 -> quy về 0=T2..6=CN để khớp WEEKDAYS_VN.
  const firstWeekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function DateInputVN({ value, onChange, className, disabled, title }) {
  const [text, setText] = useState(isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth()); // 0-11
  // Giống cách EditText/EditNum đã vá bug "nhảy chữ/nhảy số" — chỉ đồng bộ lại từ value khi ô
  // không đang được focus, tránh dữ liệu tải lại (Realtime) đè lùi lúc đang gõ dở.
  const focusedRef = useRef(false);
  const wrapRef = useRef(null);
  const popupRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => { if (!focusedRef.current) setText(isoToDisplay(value)); }, [value]);

  // Bảng lịch hiện qua Portal gắn thẳng vào <body> (KHÔNG nằm trong cây DOM của ô input nữa) —
  // nhiều ô ngày nằm trong bảng có overflow-x-auto (thanh cuộn ngang mỗi nhóm lô), nếu bảng lịch
  // vẫn nằm trong khung đó sẽ bị cắt mất phần dưới/phải mỗi khi tràn ra ngoài khung nhìn thấy của
  // khung cuộn (lỗi thực tế NCV gặp: lịch chỉ hiện đúng 1 hàng đầu). Portal + position:fixed theo
  // toạ độ input (getBoundingClientRect) thoát hẳn mọi khung overflow/cuộn của cha, luôn hiện đủ.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - POPUP_W - 4));
    // Không đủ chỗ phía dưới (gần cuối màn hình) -> bật lịch lên PHÍA TRÊN input thay vì để tràn
    // xuống ngoài màn hình, mất luôn phần dưới lịch giống lỗi cũ.
    const openUp = rect.bottom + 300 > window.innerHeight && rect.top > 300;
    setPos({ left, top: openUp ? null : rect.bottom + 4, bottom: openUp ? window.innerHeight - rect.top + 4 : null });
  }, [open]);

  // Mở lịch thì luôn nhảy về đúng tháng của giá trị hiện có (hoặc tháng hiện tại nếu chưa có
  // giá trị) — không giữ nguyên tháng đang xem dở từ lần mở trước, dễ gây nhầm "chọn nhầm tháng".
  const openCalendar = () => {
    if (disabled) return;
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const now = new Date();
    setViewYear(m ? parseInt(m[1], 10) : now.getFullYear());
    setViewMonth(m ? parseInt(m[2], 10) - 1 : now.getMonth());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // Popup giờ ở ngoài cây DOM của wrapRef (portal) — phải tính CẢ 2 vùng (input + popup) mới
    // coi là "trong", không thì bấm chọn ngày trong popup sẽ bị hiểu nhầm là bấm ra ngoài.
    const onDocDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    // Cuộn trang/khung cha (kể cả khung overflow-x-auto bên trong) thì đóng lịch luôn thay vì
    // định vị lại liên tục — vị trí input đã đổi, giữ lịch mở ở toạ độ cũ sẽ lệch khỏi ô.
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const handleChange = (e) => {
    // Tự chèn "/" sau ngày (2 số) và tháng (2 số) khi gõ liền số không tự gõ "/", để gõ nhanh
    // bằng bàn phím số vẫn ra đúng khuôn dd/mm/yyyy mà không cần tự bấm dấu "/".
    const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
    let out = digits.slice(0, 2);
    if (digits.length > 2) out += "/" + digits.slice(2, 4);
    if (digits.length > 4) out += "/" + digits.slice(4, 8);
    setText(out);
    if (out === "") { onChange({ target: { value: "" } }); return; }
    const iso = displayToIso(out);
    if (iso) onChange({ target: { value: iso } });
  };

  const pickDay = (d) => {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setText(isoToDisplay(iso));
    onChange({ target: { value: iso } });
    setOpen(false);
  };

  const goMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };

  const grid = open ? buildMonthGrid(viewYear, viewMonth) : null;
  const today = todayIso();

  return (
    <div ref={wrapRef} className="relative inline-block">
      <div className="relative">
        <input type="text" inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10}
          value={text} disabled={disabled} title={title}
          onFocus={() => { focusedRef.current = true; }}
          onChange={handleChange}
          onBlur={() => { focusedRef.current = false; setText(isoToDisplay(value)); }}
          className={`${className} pr-6`} />
        {!disabled && (
          <button type="button" tabIndex={-1} onClick={() => (open ? setOpen(false) : openCalendar())}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600">
            <Calendar className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && pos && createPortal(
        <div ref={popupRef} style={{ position: "fixed", left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined }}
          className="z-[1000] bg-white border border-slate-200 rounded-lg shadow-lg p-2 w-60 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" onClick={() => goMonth(-1)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-medium text-slate-700">Tháng {viewMonth + 1}/{viewYear}</span>
            <button type="button" onClick={() => goMonth(1)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-400 mb-1">
            {WEEKDAYS_VN.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((d, i) => {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const inMonth = d.getMonth() === viewMonth;
              const isSelected = iso === value;
              const isToday = iso === today;
              return (
                <button type="button" key={i} onClick={() => pickDay(d)}
                  className={`h-6 rounded text-[11px] ${!inMonth ? "text-slate-300" : "text-slate-700"} ${
                    isSelected ? "bg-emerald-600 text-white font-semibold" : isToday ? "bg-emerald-50 font-semibold" : "hover:bg-slate-100"
                  }`}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
            <button type="button" onClick={() => pickDay(new Date())} className="text-emerald-700 hover:underline">Hôm nay</button>
            {value && (
              <button type="button" onClick={() => { setText(""); onChange({ target: { value: "" } }); setOpen(false); }}
                className="text-slate-400 hover:text-rose-600 hover:underline">Xoá</button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
