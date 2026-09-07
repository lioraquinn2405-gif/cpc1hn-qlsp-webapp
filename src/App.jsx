import React, { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import {
  PackageOpen, AlertTriangle, CheckCircle2, Beaker, Boxes, Users, FlaskConical,
  Plus, Trash2, ChevronRight, ChevronDown, ChevronUp, Droplets, Loader2, Ban, LogOut, X, RotateCcw,
  Calculator, XCircle, HelpCircle, Settings, Mail, KeyRound, GripVertical, Factory, Sparkles, Menu,
  Search,
  ShieldAlert, Snowflake, Copy,
} from "lucide-react";
import LenMenPanel from "./LenMenPanel.jsx";
import SeedLotPanel from "./SeedLotPanel.jsx";
import DateInputVN from "./DateInputVN.jsx";
import { supabase, supabaseConfigured } from "./lib/supabaseClient.js";
import {
  fetchMaterials, fetchProducts, updateMaterialField, updateMaterialFields, removeMaterial,
  confirmMixBatch, insertMaterialsBulk, addProduct, updateProductField,
  removeProduct, subscribeMaterials, reorderProducts,
} from "./lib/materialsApi.js";
import { fetchProfile, fetchProfiles, updateProfile, setUserEmail, requestEmailChange, signUp, adminCreateUser } from "./lib/profilesApi.js";
import { parseDotSanXuat, parseSoLoDate, productionDate, monthLabelVN } from "./lib/materialsQc.js";
import { planSingleComponent, planTwoComponent, TANK_MAX_L, MAX_LOTS_PER_BATCH, MAX_CLOSING_OVERSHOOT } from "./lib/mixPlanner.js";
import { fetchMixPlans, fetchMixPlansByIds, saveMixPlanDecision, saveEditedMixPlanDecision, removeMixPlan, reviewMixPlanWithAi } from "./lib/mixPlansApi.js";
import { fetchFinishedBatches, createFinishedBatch, updateFinishedBatchField } from "./lib/finishedBatchesApi.js";

// "Chờ SX" KHÔNG nằm trong danh sách này nữa (2026-07-30, NCV yêu cầu) — chuyển sang nằm trong mục
// "Pha chế" (cạnh "Pha chế NCV"/"Pha chế SX") vì về bản chất là 1 bước của quy trình pha chế, không
// phải trạng thái nguyên liệu thô như các mục còn lại — xem Sidebar, render riêng ở đó.
const NL_TABS = [
  { key: "cho-kqkn", label: "Chờ KQKN", icon: FlaskConical },
  { key: "cho-pha", label: "Chờ pha", icon: Boxes },
  { key: "cho-xu-ly", label: "Chờ xử lý", icon: AlertTriangle },
  { key: "da-pha", label: "Đã pha", icon: PackageOpen },
  { key: "da-huy", label: "Đã huỷ", icon: Ban },
];
const STATUS_LABEL = {
  "cho-kqkn": "Chờ KQKN", "cho-pha": "Chờ pha", "cho-xu-ly": "Chờ xử lý",
  "da-pha": "Đã pha", "da-huy": "Đã huỷ", "cho-sx": "Chờ SX", "cho-xoa": "Thùng rác",
};
const STRAIN_OPTIONS = [
  { value: "subtilis", label: "Bacillus subtilis" },
  { value: "clausii", label: "Bacillus clausii" },
];

// Các mục con của "Cảnh báo lên men" (xem LenMenPanel.jsx). Khoá đều mang tiền tố
// lenmen- để phân biệt rõ với các tab của phần pha chế.
const LENMEN_TABS = [
  { key: "lenmen-batches", label: "Danh sách lô" },
  { key: "lenmen-khsx", label: "Kế hoạch sản xuất" },
  { key: "lenmen-overview", label: "Tổng quan" },
];

const POOL_LABEL = {
  "subtilis": "Bacillus subtilis",
  "clausii-loai1": "Bacillus clausii (1)",
  "clausii-loai2": "Bacillus clausii (2)",
};

/* ---------- Tiện ích ---------- */
const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "-") return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
};
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? "–"
  : v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sci = (v) => (v == null ? "–" : Number(v).toExponential(2).replace("e+", "×10^"));
const SUP_DIGITS = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
const toSup = (s) => String(s).split("").map((c) => SUP_DIGITS[c] ?? c).join("");
// Dạng gọn cho ô đang gõ tự do (vd Hàm lượng đích, chấp nhận cả "4e8") — phẩy thập phân kiểu
// vi-VN, số mũ viết kiểu chữ nhỏ bên trên (10⁸, không phải 10^8) + bỏ số 0 thừa ở cuối (4,2×10⁸
// thay vì 4,20×10⁸), khác sci() ở trên (luôn giữ đúng 2 chữ số thập phân + ký hiệu ^, dùng cho
// bảng số liệu cần thẳng hàng).
const sciVN = (v) => {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) === 0) return "";
  const [mStr, eStr] = Number(v).toExponential(2).split("e");
  return `${parseFloat(mStr).toString().replace(".", ",")}×10${toSup(parseInt(eStr, 10))}`;
};

// Đăng nhập cho phép gõ email THẬT hoặc SỐ ĐIỆN THOẠI — dùng thẳng 2 trường độc lập
// (email/phone) mà Supabase Auth hỗ trợ sẵn, KHÔNG còn quy đổi SĐT thành email giả nữa
// (cách cũ khiến 1 tài khoản chỉ dùng được 1 trong 2 cách). Số điện thoại lưu ở dạng chuẩn
// quốc tế (+84...) trên auth.users — xem scripts/migrate-phone-native.mjs.
function toE164VN(identifier) {
  const digits = (identifier || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `+84${digits.slice(1)}`;
  if (digits.length === 9) return `+84${digits}`; // phòng trường hợp mất số 0 đầu
  return null;
}
// { email } hoặc { phone } tuỳ định dạng gõ vào, để truyền thẳng cho signInWithPassword.
function toAuthCredential(identifier) {
  const t = (identifier || "").trim();
  if (t.includes("@")) return { email: t };
  return { phone: toE164VN(t) || t };
}
// Tài khoản tạo TRƯỚC khi có trường phone gốc vẫn còn "email giả" dạng <sdt>@cpc1hn.local
// trên auth.users (không bị xoá khi migrate, chỉ để dự phòng) — chỉ dùng để hiển thị đẹp,
// không dùng để đăng nhập nữa.
const LEGACY_PHONE_EMAIL_DOMAIN = "cpc1hn.local";
function identityLabel(user) {
  if (!user) return "";
  if (user.phone) return user.phone.replace(/^\+?84/, "0"); // Supabase trả về không có dấu "+"
  if (user.email?.endsWith(`@${LEGACY_PHONE_EMAIL_DOMAIN}`)) return user.email.split("@")[0];
  return user.email || "";
}
const DIACRITICS_RE = new RegExp(String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93), "g");
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "").replace(/đ/g, "d").trim();

/* ---------- Phân luồng tự động ---------- */
// parseDotSanXuat/parseSoLoDate/productionDate chuyển sang lib/materialsQc.js (dùng chung
// với NLTrendPanel.jsx) — import ở đầu file.

// parseSoLoDate cố tình bỏ qua 2 số đầu (ngày/số thứ tự trong tháng), chỉ lấy
// tháng/năm cho tính hạn dùng theo tháng. Hàm này lấy CẢ 2 số đó để so sánh
// lô nào sản xuất trước/sau CÙNG trong 1 tháng (dùng để sắp xếp tab Chờ xử lý,
// không dùng cho tính hạn dùng).
function parseSoLoOrderKey(soLo) {
  const s = String(soLo || "").trim();
  let m = s.match(/^(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = 2000 + parseInt(m[3], 10);
    if (month >= 1 && month <= 12) return year * 10000 + month * 100 + day;
  }
  m = s.match(/^(\d{2})([A-La-l])(\d+)/);
  if (m) {
    const year = 2000 + parseInt(m[1], 10);
    const month = m[2].toUpperCase().charCodeAt(0) - 64;
    const seq = parseInt(m[3], 10);
    return year * 10000 + month * 100 + seq;
  }
  return null;
}
const EXPIRY_MONTHS = 13;
function monthsSince(rec) {
  const d = productionDate(rec);
  if (!d) return null;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}
const DISPOSAL_MONTHS = 24;
const TRASH_RETENTION_DAYS = 30;
// Số NL ở "Chờ SX" (đã lên lệnh SX từ 1 kế hoạch mẻ pha đã DUYỆT) mà quá số ngày này chưa được NCV
// tự bấm "Xác nhận đã pha" thì tự động chuyển "Đã pha" — coi như chắc chắn đã pha xong trong lúc đó,
// tránh treo "Chờ SX" vô thời hạn nếu quên xác nhận. Xem applyPlanApprovalToMaterials + reload().
const CHO_SX_RETENTION_DAYS = 30;
// Hạn trả kết quả QC: QC_DEADLINE_DAYS ngày kể từ thời gian thu (hiện ghi chú
// hạn trả KQ + Apps Script bắt đầu gửi mail cảnh báo mỗi ngày, xem
// ThuBaoTuScanner.gs). Quá QC_RED_DAYS ngày (muộn hơn) mới tô đỏ đậm.
const QC_DEADLINE_DAYS = 15;
const QC_RED_DAYS = 20;
function daysSinceThu(rec) {
  if (!rec.thoiGianThu) return null;
  const d = new Date(rec.thoiGianThu);
  if (isNaN(d)) return null;
  const now = new Date();
  const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfNow - startOfD) / 86400000);
}
function classify(rec) {
  const months = monthsSince(rec);
  const expired = months != null && months >= EXPIRY_MONTHS;
  const disposed = months != null && months >= DISPOSAL_MONTHS;
  const nearExpiry = !expired && months === EXPIRY_MONTHS - 1;
  const reasons = [];
  if (expired) reasons.push(`Hết hạn dùng (quá ${EXPIRY_MONTHS} tháng kể từ đợt SX)`);

  // Nhiễm khuẩn: "Đạt" / "Đạt (sub)" (chỉ clausii — nhiễm chéo subtilis, tự động Loại 2, KHÔNG
  // phải chờ xử lý) / "Không đạt" (nhiễm khuẩn thật, áp dụng cả 2 chủng — bắt buộc QC chọn thêm
  // con nhiễm ở cột "Nhiễm con nào" thì mới đủ điều kiện chuyển "Chờ xử lý", tránh thiếu dữ liệu).
  const nk = norm(rec.nhiemKhuan);
  const isFail = nk.includes("khong");
  // Tương thích ngược: dữ liệu CŨ (trước khi có option "Đạt (sub)") đánh dấu Loại 2 bằng
  // "Không đạt" + chọn "B.subtilis" ở Nhiễm con nào — vẫn phải nhận diện đúng là Loại 2,
  // không được đẩy nhầm sang "Chờ xử lý" chỉ vì đổi cách nhập liệu.
  const legacySubPattern = isFail && /sub/.test(norm(rec.nhiemConNao));
  // "dat" VÀ "sub" cùng lúc (khớp đúng "đạt (sub)") — không chỉ "sub" đơn lẻ, tránh khớp nhầm
  // với ghi chú tự do kiểu cũ vô tình có chữ "subtilis" trong đó (dữ liệu lịch sử không sạch).
  const isPassSub = rec.strain === "clausii" && ((!isFail && nk.includes("dat") && nk.includes("sub")) || legacySubPattern);
  const isPass = !isFail && !isPassSub && nk.includes("dat");
  // Mọi lựa chọn ở "Nhiễm con nào" (kể cả "Gram dương sinh bào tử") đều là nhóm chung chung,
  // không đủ để xác định đúng VK — bắt buộc QC ghi rõ tên VK vào Ghi chú TRƯỚC khi cho chuyển
  // "Chờ xử lý", tránh chuyển tab mất dòng ngay giữa lúc QC còn đang nhập dở dữ liệu (chốt với
  // NCV, phản hồi 2026-08-10 — lúc đầu chỉ chặn 2/3 lựa chọn, test thực tế lộ ra vẫn nhảy sớm
  // với lựa chọn thứ 3 nên mở rộng chặn cả 3).
  const missingGhiChu = isFail && !isPassSub && !!rec.nhiemConNao && !rec.ghiChu;
  const missingNhiemConNao = isFail && !isPassSub && !rec.nhiemConNao;

  if (!nk || missingNhiemConNao || missingGhiChu) {
    if (reasons.length) return { status: disposed ? "da-huy" : "cho-xu-ly", loai: null, expired, nearExpiry, reasons };
    return { status: "cho-kqkn", loai: null, chuaQC: true, nearExpiry, qcDays: daysSinceThu(rec), needsNhiemConNao: missingNhiemConNao, needsGhiChu: missingGhiChu };
  }

  let loai = null;
  if (rec.strain === "clausii") {
    if (isPass) loai = 1;
    else if (isPassSub) loai = 2;
    else reasons.push(`Không đạt kiểm nhiễm khuẩn (nhiễm ${rec.nhiemConNao})`);
  } else if (!isPass) {
    reasons.push(`Không đạt kiểm nhiễm khuẩn (nhiễm ${rec.nhiemConNao})`);
  }

  if (reasons.length) return { status: disposed ? "da-huy" : "cho-xu-ly", loai: null, expired, nearExpiry, reasons };

  // Nhiễm khuẩn "Đạt" mới chỉ là 1 vế — MĐ SH và Bào tử % là số liệu định lượng bắt buộc
  // trước khi cho pha (chốt với NCV 2026-08-28, sau khi phát hiện lô 26H02SA1 nhảy thẳng
  // "Chờ pha" dù 2 cột này còn trống — trước đây chỉ xét mỗi Nhiễm khuẩn). Giữ ở "Chờ KQKN"
  // tới khi QC nhập đủ, không chặn ở "Nhiễm khuẩn" (đã Đạt) mà chặn riêng ở 2 cột này.
  const needsMdSH = rec.mdSH == null;
  const needsBaoTu = rec.tyLeBaoTu == null;
  if (needsMdSH || needsBaoTu) {
    return { status: "cho-kqkn", loai: null, chuaQC: false, nearExpiry, qcDays: daysSinceThu(rec), needsMdSH, needsBaoTu };
  }

  return { status: "cho-pha", loai, nearExpiry };
}
const statusOf = (rec) => {
  if (rec.daPha) return { status: "da-pha", loai: rec.loai };
  if (rec.choSX) return { status: "cho-sx", loai: rec.loai };
  if (rec.pendingDelete) return { status: "cho-xoa", loai: null };
  // Chuyển tay (bù cho thực tế không khớp dữ liệu QC/kho) — đặt TRƯỚC classify() để có hiệu
  // lực bất kể dữ liệu QC đủ hay thiếu, khác với huy_thu_cong bản cũ (chỉ có tác dụng khi đã
  // sẵn có lý do chờ xử lý/hết hạn, không ép được từ "Chờ pha"/"Chờ KQKN" thẳng sang Đã huỷ).
  if (rec.huyThuCong) return { status: "da-huy", loai: null };
  if (rec.choXuLyThuCong) return { status: "cho-xu-ly", loai: null, reasons: ["Chuyển tay sang Chờ xử lý"] };
  return classify(rec);
};

// nkOutcome()/computeNLTrendStats()/monthLabelVN() chuyển sang lib/materialsQc.js — dùng
// chung cho "Xu hướng NL" (NLTrendPanel.jsx) và "Đối chiếu NL" (LenMenOverview.jsx), tránh
// mỗi nơi tự mirror lại luật kết luận QC.

/* ---------- Công thức pha ----------
 *  V_pha(L) = MĐ_SH(×10¹⁰) × V_dịch(L) × 10¹⁰ / hàm_lượng(cfu/ml)
 *  Số ống(nghìn) = V_pha(L) / thể_tích_ống(ml)
 */
function tinhPha(rec, sp) {
  if (!rec.mdSH || !rec.vDich || !sp?.hamLuong) return null;
  const vPhaL = (rec.mdSH * 1e10 * rec.vDich) / sp.hamLuong;
  const soOng = (vPhaL * 1000) / sp.tubeMl;
  return { vPhaL, soOng, soOngNghin: soOng / 1000 };
}

/* ================================================================== */
export default function App() {
  if (!supabaseConfigured) return <SetupNeeded />;
  return <AuthGate />;
}

function SetupNeeded() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md bg-white border border-amber-200 rounded-lg p-6 space-y-3">
        <div className="flex items-center gap-2 text-amber-600"><AlertTriangle className="w-5 h-5" /><h1 className="font-semibold">Chưa cấu hình Supabase</h1></div>
        <p className="text-sm text-slate-600">Tạo file <code className="bg-slate-100 px-1 rounded">.env</code> từ <code className="bg-slate-100 px-1 rounded">.env.example</code>, điền <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_URL</code> và <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> lấy từ Supabase Dashboard &gt; Project Settings &gt; API, rồi khởi động lại <code className="bg-slate-100 px-1 rounded">npm run dev</code>.</p>
      </div>
    </div>
  );
}

function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = đang tải, null = chưa đăng nhập

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!session) return <Login />;
  return <Gated session={session} />;
}

function Gated({ session }) {
  const [profile, setProfile] = useState(undefined); // undefined = đang tải, null = chưa có profile

  const loadProfile = useCallback(async () => {
    setProfile(undefined);
    try {
      const p = await fetchProfile(session.user.id);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, [session.user.id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (profile === undefined) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!profile || profile.status === "pending") {
    return <StatusScreen title="Tài khoản đang chờ admin duyệt"
      message="Tài khoản của bạn đã đăng ký thành công nhưng cần admin duyệt trước khi dùng được. Vui lòng chờ hoặc liên hệ quản trị viên."
      onRefresh={loadProfile} />;
  }
  if (profile.status === "rejected") {
    return <StatusScreen title="Tài khoản bị từ chối"
      message="Admin đã từ chối tài khoản này. Liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn." />;
  }
  return <Connected session={session} profile={profile} />;
}

function StatusScreen({ title, message, onRefresh }) {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-lg border border-slate-200 p-6 space-y-3 text-center">
        <Brand />
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{message}</p>
        <div className="flex items-center justify-center gap-4 pt-1">
          {onRefresh && <button onClick={onRefresh} className="text-xs text-emerald-600 hover:underline">Tải lại</button>}
          <button onClick={() => supabase.auth.signOut()} className="text-xs text-slate-500 hover:underline">Đăng xuất</button>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 mb-2 justify-center">
      <img src="/logo.png" alt="CPC1HN" className="w-9 h-9 object-contain shrink-0"
        onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <div className="min-w-0 text-left">
        <div className="font-bold text-base leading-tight">CPC1HN</div>
        <div className="text-xs text-slate-500 truncate">Quản lý pha chế sinh phẩm</div>
      </div>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState("signin");
  if (mode === "signup") return <SignUpCard onBack={() => setMode("signin")} />;
  return <SignInCard onSignUp={() => setMode("signup")} />;
}

function SignInCard({ onSignUp }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ ...toAuthCredential(identifier), password });
    if (error) setError(error.message === "Invalid login credentials" ? "Sai email/số điện thoại hoặc mật khẩu." : error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-lg border border-slate-200 p-6 space-y-4">
        <Brand />
        <div>
          <label className="text-xs text-slate-500">Email hoặc số điện thoại</label>
          <input type="text" required autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Mật khẩu</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-[#28374a] text-white text-sm py-2.5 rounded-md hover:opacity-90 disabled:opacity-50">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} Đăng nhập
        </button>
        <p className="text-center text-xs text-slate-400">Quên mật khẩu? Liên hệ admin để được cấp lại.</p>
        <p className="text-[11px] text-slate-400 text-center">
          Chưa có tài khoản?{" "}
          <button type="button" onClick={onSignUp} className="text-emerald-600 hover:underline">Đăng ký ngay</button>
        </p>
      </form>
    </div>
  );
}

function SignUpCard({ onBack }) {
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Mật khẩu xác nhận không khớp."); return; }
    if (password.length < 6) { setError("Mật khẩu cần ít nhất 6 ký tự."); return; }
    setLoading(true);
    try {
      await signUp({ email, password, fullName, department, employeeCode });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-lg border border-slate-200 p-6 space-y-3 text-center">
          <Brand />
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm text-slate-700">Đăng ký thành công! Tài khoản đang chờ admin duyệt trước khi dùng được.</p>
          <button onClick={onBack} className="text-sm text-emerald-600 hover:underline">Quay lại đăng nhập</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-lg border border-slate-200 p-6 space-y-3">
        <Brand />
        <div>
          <label className="text-xs text-slate-500">Họ và tên</label>
          <input required autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-slate-500">Phòng ban</label>
            <select required value={department} onChange={(e) => setDepartment(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
              <option value="" disabled>– chọn –</option>
              <option value="RD">RD</option>
              <option value="QA">QA</option>
              <option value="QC">QC</option>
              <option value="KH">KH</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-slate-500">Mã nhân viên</label>
            <input required value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Mật khẩu</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Xác nhận mật khẩu</label>
          <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white text-sm py-2.5 rounded-md hover:bg-emerald-700 disabled:opacity-50">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} Đăng ký
        </button>
        <button type="button" onClick={onBack} className="w-full text-xs text-slate-400 hover:text-slate-600 text-center">Quay lại đăng nhập</button>
      </form>
    </div>
  );
}

function Connected({ session, profile }) {
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("cho-pha");
  const [strainFilter, setStrainFilter] = useState("all");
  // Bộ lọc bảng NL (áp dụng cho mọi tab NL: Chờ KQKN/Chờ pha/Chờ xử lý/Đã pha/Đã huỷ/Thùng rác) —
  // tách riêng khỏi strainFilter (vốn ở Sidebar, không đổi khi chuyển tab) vì đây là lọc trong
  // phạm vi 1 tab, không cần nhớ lại khi chuyển tab khác.
  const [loQuery, setLoQuery] = useState("");
  const [statusTagFilter, setStatusTagFilter] = useState("all");
  const [dateField, setDateField] = useState("thoiGianThu");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [note, setNote] = useState("");
  // Sidebar trên điện thoại (màn hẹp hơn breakpoint sm) ẩn mặc định, mở dạng overlay có nút menu
  // riêng — sidebar cố định 240px như cũ chỉ áp dụng từ sm trở lên (xem <Sidebar>/<aside>). Tự đóng
  // lại mỗi khi chuyển tab để không phải tự tay đóng sau khi bấm chọn 1 mục.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [tab]);
  // Sau khi "Xác nhận đã pha" (cả 2 nơi), nhảy sang tab Sản phẩm > Lịch sử pha chế, mở đúng đến
  // sản phẩm vừa pha — { maSP } hoặc null.
  const [spFocus, setSpFocus] = useState(null);
  const goToProductionHistory = (maSP) => { setSpFocus({ maSP, ts: Date.now() }); setTab("sp-history"); };
  const actorId = session.user.id;
  const isAdmin = profile.role === "admin";
  // Phân quyền theo vai trò (profile.role) — chốt với NCV 2026-07-30: admin sửa được mọi thứ; RD sửa
  // được toàn bộ phần SẢN XUẤT (Pha chế NCV/Pha chế SX/Chờ SX/Sản phẩm) nhưng KHÔNG được đụng vào
  // "Quản lý NL" (mọi tab NL — kể cả Chờ KQKN); QC CHỈ sửa được đúng các cột kết quả kiểm nghiệm
  // (Cảm quan/pH/MĐ nhãn/MĐ SH/Bào tử %/Nhiễm khuẩn/Nhiễm con nào/Ghi chú) trong tab Chờ KQKN, không
  // đụng gì khác kể cả Thời gian thu/Lô chủng/V dịch của chính tab đó; KH chỉ được bấm "Tính kế
  // hoạch" (xem trước, không lưu) ở Pha chế SX, còn lại xem-only; QA/ktv xem-only hoàn toàn, không
  // ngoại lệ. Xem thêm memory feedback_role_permissions.
  const canEditNL = isAdmin;
  const canEditQcResults = isAdmin || profile.role === "qc";
  // Bảo quản chủng giống: chỉ admin + QC được xuất chủng (QC chỉ gửi đề nghị, admin duyệt
  // mới ghi thật vào lịch sử — xem migration_lenmen_giong_de_nghi_xuat.sql). QC chỉ được gửi
  // đề nghị xuất + xem tồn — không đụng Nhập/Huỷ/Nhãn/Sổ lô (isQC tách riêng khỏi
  // canXuatChung để không ảnh hưởng vai trò khác đang xem được các nút đó bình thường).
  const isQC = profile.role === "qc";
  const canXuatChung = isAdmin || isQC;
  const canEditProduction = isAdmin || profile.role === "rd";
  const canPreviewPlan = isAdmin || profile.role === "rd" || profile.role === "kh";

  const reload = useCallback(async () => {
    try {
      const [m, p, pr] = await Promise.all([fetchMaterials(), fetchProducts(), fetchProfiles()]);
      const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const expired = m.filter((r) => r.pendingDelete && r.deletedAt && new Date(r.deletedAt).getTime() < cutoff);
      if (expired.length) {
        await Promise.all(expired.map((r) => removeMaterial(r.id).catch(() => {})));
      }
      const expiredIds = new Set(expired.map((r) => r.id));
      let mAfterTrash = m.filter((r) => !expiredIds.has(r.id));

      // Chờ SX quá CHO_SX_RETENTION_DAYS ngày mà NCV chưa tự "Xác nhận đã pha" -> tự động chuyển
      // "Đã pha" (coi như chắc chắn đã pha xong trong lúc đó) — gộp theo đúng mẻ (mixPlanId+meSo) để
      // cả mẻ nhận CHUNG 1 mã mẻ tự động, giống hệt lúc NCV tự bấm xác nhận tay (xem ChoSXPanel).
      const choSxCutoff = Date.now() - CHO_SX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const choSxExpired = mAfterTrash.filter((r) => r.choSX && !r.daPha && r.choSxAt && new Date(r.choSxAt).getTime() < choSxCutoff);
      if (choSxExpired.length) {
        const byMe = {};
        choSxExpired.forEach((r) => { (byMe[`${r.mixPlanId}-${r.mixPlanMeSo}`] ||= []).push(r); });
        const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
        await Promise.all(Object.values(byMe).map((rows) => {
          const r0 = rows[0];
          const phaMe = `${r0.phaProduct || r0.strain}-P${r0.mixPlanId}M${r0.mixPlanMeSo}-${todayStr}-AUTO30D`;
          return confirmMixBatch(rows.map((r) => r.id), { daPha: true, daPhaAt: new Date().toISOString(), phaMe, phaProduct: r0.phaProduct }, actorId).catch(() => {});
        }));
        const choSxExpiredIds = new Set(choSxExpired.map((r) => r.id));
        mAfterTrash = mAfterTrash.map((r) => (choSxExpiredIds.has(r.id) ? { ...r, daPha: true } : r));
      }

      setMaterials(mAfterTrash);
      setProducts(p);
      setProfiles(pr);
    } catch (err) {
      setNote(`Lỗi tải dữ liệu: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const profilesById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  const updateUserProfile = (id, patch) => {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    updateProfile(id, patch).catch((err) => { setNote(`Lỗi cập nhật người dùng: ${err.message}`); reload(); });
  };

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const unsubscribe = subscribeMaterials(() => reload());
    return unsubscribe;
  }, [reload]);

  const editField = useCallback((id, field, value) => {
    if (field === "pH") {
      const patch = { pH: value, phInvalid: false };
      setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
      updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi lưu: ${err.message}`));
      return;
    }
    // 3 số MĐ nhãn / MĐ SH (mật độ SAU HẤP) / Bào tử % luôn khớp công thức MĐ SH = MĐ nhãn ×
    // Bào tử % ⟺ Bào tử % = MĐ SH / MĐ nhãn × 100 ⟺ MĐ nhãn = MĐ SH / Bào tử % × 100 — QC chỉ cần
    // nhập ĐÚNG 2/3 số, số còn lại tự tính. Ô đang gõ tay LUÔN lưu đúng giá trị vừa gõ (không bao
    // giờ tự ghi đè lại) — CHỈ tính lại 1 trong 2 ô KIA theo đúng công thức: sửa MĐ nhãn hoặc MĐ SH
    // thì Bào tử % tự tính lại (không tự đổi MĐ nhãn/MĐ SH kia); sửa Bào tử % thì MĐ SH tự tính lại
    // theo MĐ nhãn hiện có (giữ nguyên MĐ nhãn, khớp cách tính cũ trước khi thêm chiều thứ 3).
    if (field === "mdNhan" || field === "mdSH" || field === "tyLeBaoTu") {
      const row = materials.find((r) => r.id === id);
      const mdNhan = field === "mdNhan" ? value : row?.mdNhan;
      const mdSH = field === "mdSH" ? value : row?.mdSH;
      const tyLeBaoTuInput = field === "tyLeBaoTu" ? value : row?.tyLeBaoTu;
      const patch = { [field]: value };
      if (field !== "tyLeBaoTu" && mdNhan != null && mdSH != null) {
        patch.tyLeBaoTu = mdNhan !== 0 ? Math.round((mdSH / mdNhan) * 100 * 100) / 100 : null;
      } else if (field !== "mdSH" && mdNhan != null && tyLeBaoTuInput != null) {
        patch.mdSH = Math.round(mdNhan * tyLeBaoTuInput / 100 * 100) / 100;
      } else if (field !== "mdNhan" && mdSH != null && tyLeBaoTuInput != null) {
        patch.mdNhan = tyLeBaoTuInput !== 0 ? Math.round((mdSH / tyLeBaoTuInput) * 100 * 100) / 100 : null;
      }
      setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
      updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi lưu: ${err.message}`));
      return;
    }
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value, updatedBy: actorId } : r)));
    updateMaterialField(id, field, value, actorId).catch((err) => setNote(`Lỗi lưu: ${err.message}`));
  }, [actorId, materials]);
  const removeRec = (id) => {
    setMaterials((prev) => prev.filter((r) => r.id !== id));
    removeMaterial(id).catch((err) => setNote(`Lỗi xoá: ${err.message}`));
  };
  const softDeleteRec = (id) => {
    const patch = { pendingDelete: true, deletedAt: new Date().toISOString() };
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
    updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi: ${err.message}`));
  };
  const restoreRec = (id) => {
    const patch = { pendingDelete: false, deletedAt: null };
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
    updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi: ${err.message}`));
  };

  const confirmMix = async (ids, maSP, me, loai, soLuongDuKien) => {
    const patch = { daPha: true, daPhaAt: new Date().toISOString(), phaProduct: maSP, phaMe: me, loai };
    setMaterials((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, ...patch, updatedBy: actorId } : r)));
    try {
      await confirmMixBatch(ids, patch, actorId);
      const tenSP = products.find((p) => p.maSP === maSP)?.tenSP;
      await createFinishedBatch({ tenSP, phaMe: me, soLuongDuKien, createdBy: actorId });
      goToProductionHistory(maSP);
    } catch (err) { setNote(`Lỗi xác nhận pha: ${err.message}`); reload(); }
  };

  const addLot = async ({ strain, lo, soChai }) => {
    const trimmedLo = lo.trim();
    const existing = materials.find((r) => r.lo === trimmedLo);
    if (existing) {
      const statusLabel = STATUS_LABEL[statusOf(existing).status] || "?";
      throw new Error(`Lô "${trimmedLo}" đã tồn tại trong hệ thống — đang ở "${statusLabel}".`);
    }
    const d = parseSoLoDate(trimmedLo);
    const dotSanXuat = d ? `${d.getMonth() + 1}/${d.getFullYear()}` : "";
    const tenNL = strain === "clausii" ? "Bacillus clausii" : "Bacillus subtilis";
    const chung = strain === "clausii" ? "G3" : "G4";
    const rows = Array.from({ length: soChai }, (_, i) => {
      const chai = `C${i + 1}`;
      return { strain, tenNL, chung, dotSanXuat, soLo: `${trimmedLo}.${chai}`, lo: trimmedLo, chai, daPha: false, phInvalid: false, createdBy: actorId };
    });
    await insertMaterialsBulk(rows);
    setNote(`Đã thêm lô ${trimmedLo} (${soChai} chai) — chờ QC nhập kết quả.`);
    setTab("cho-kqkn");
    setStrainFilter(strain);
    reload();
  };

  // Bù chai bị quét thiếu (Apps Script quét mail đôi khi sót dòng) — nối tiếp số chai lớn
  // nhất đang có trong lô, không tự đoán số bị thiếu vì không biết chính xác chai nào sót.
  const addBottleToLot = async (lo, count) => {
    const existing = materials.filter((r) => r.lo === lo);
    if (!existing.length) throw new Error(`Không tìm thấy lô "${lo}".`);
    const { strain, tenNL, chung, dotSanXuat } = existing[0];
    const chaiNum = (r) => parseInt(String(r.chai || "").replace(/[^0-9]/g, ""), 10) || 0;
    const maxChai = Math.max(...existing.map(chaiNum));
    const rows = Array.from({ length: count }, (_, i) => {
      const chai = `C${maxChai + i + 1}`;
      return { strain, tenNL, chung, dotSanXuat, soLo: `${lo}.${chai}`, lo, chai, daPha: false, phInvalid: false, createdBy: actorId };
    });
    await insertMaterialsBulk(rows);
    setNote(`Đã thêm ${count} chai vào lô ${lo}.`);
    reload();
  };

  // Chuyển trạng thái tay — bù cho trường hợp thực tế (đối chiếu kho/sản xuất) không khớp dữ
  // liệu QC hiện có trên hệ thống, thay vì phải nhờ sửa DB thủ công mỗi lần.
  const forceDaPha = (id) => {
    const patch = { daPha: true, daPhaAt: new Date().toISOString() };
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
    updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi: ${err.message}`));
  };
  const forceChoXuLy = (id) => {
    const patch = { choXuLyThuCong: true, huyThuCong: false };
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
    updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi: ${err.message}`));
  };
  const forceDaHuy = (id) => {
    const patch = { huyThuCong: true, choXuLyThuCong: false };
    setMaterials((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, updatedBy: actorId } : r)));
    updateMaterialFields(id, patch, actorId).catch((err) => setNote(`Lỗi: ${err.message}`));
  };

  const counts = useMemo(() => {
    const empty = () => ({ all: 0, subtilis: 0, clausii: 0 });
    const c = { "cho-pha": empty(), "cho-sx": empty(), "cho-kqkn": empty(), "cho-xu-ly": empty(), "da-pha": empty(), "da-huy": empty(), "cho-xoa": empty() };
    const choSxMeGroups = new Set(); // đếm số MẺ (không phải số chai NL) — hiện ở badge "Chờ SX"
    for (const r of materials) {
      const status = statusOf(r).status;
      c[status].all++;
      if (r.strain === "subtilis" || r.strain === "clausii") c[status][r.strain]++;
      if (status === "cho-sx") choSxMeGroups.add(`${r.mixPlanId}-${r.mixPlanMeSo}`);
    }
    c["cho-sx"].meCount = choSxMeGroups.size;
    return c;
  }, [materials]);

  // Khớp lô sản xuất (vd "26G02SA1") hoặc đúng 1 chai (gõ thêm ".C1", chỉ cần chứa trong soLo,
  // không cần gõ đủ cả mã lô — vd gõ ".c3" là ra ngay chai C3 của mọi lô).
  const matchesLoQuery = (r) => {
    const q = loQuery.trim().toLowerCase();
    if (!q) return true;
    return (r.lo || "").toLowerCase().includes(q) || (r.soLo || "").toLowerCase().includes(q);
  };
  const matchesStatusTag = (r) => {
    if (statusTagFilter === "all") return true;
    const st = statusOf(r);
    switch (statusTagFilter) {
      case "loai1": return st.loai === 1;
      case "loai2": return st.loai === 2;
      case "het-han": return !!st.expired;
      case "gan-het-han": return !!st.nearExpiry;
      case "qua-han-qc": return st.status === "cho-kqkn" && st.qcDays != null && st.qcDays >= QC_DEADLINE_DAYS;
      case "thieu-du-lieu": return !!(st.needsNhiemConNao || st.needsGhiChu || st.chuaQC || st.needsMdSH || st.needsBaoTu);
      default: return true;
    }
  };
  // "Ngày thu mẫu" (thoiGianThu) so YYYY-MM-DD; "Đợt SX" (dotSanXuat, dạng M/YYYY) chỉ có độ phân
  // giải tháng nên quy về "YYYY-MM" trước khi so — cả 2 dạng chuỗi đều so trực tiếp được theo thứ
  // tự thời gian (không cần parse ra số).
  const dateKeyOf = (r) => {
    if (dateField === "thoiGianThu") return r.thoiGianThu || null;
    const d = parseDotSanXuat(r.dotSanXuat);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
  };
  const matchesDateRange = (r) => {
    if (!dateFrom && !dateTo) return true;
    const key = dateKeyOf(r);
    if (!key) return false;
    if (dateFrom && key < dateFrom) return false;
    if (dateTo && key > dateTo) return false;
    return true;
  };
  const hasActiveFilter = !!loQuery.trim() || statusTagFilter !== "all" || !!dateFrom || !!dateTo;
  const resetFilters = () => { setLoQuery(""); setStatusTagFilter("all"); setDateFrom(""); setDateTo(""); };

  const filtered = (status) => materials
    .filter((r) => statusOf(r).status === status)
    .filter((r) => status === "cho-xoa" || strainFilter === "all" || r.strain === strainFilter)
    .filter(matchesLoQuery)
    .filter(matchesStatusTag)
    .filter(matchesDateRange);

  // Đo chiều cao thanh sticky trên cùng (breadcrumb + subtitle + note nếu có) để các panel con (vd
  // header "Sửa tay kế hoạch") có thể tự dán dính NGAY DƯỚI nó khi cuộn, không bị đè lên nhau — chiều
  // cao đổi theo việc note có hiện hay không nên phải đo bằng ResizeObserver thay vì số cố định.
  const topbarRef = useRef(null);
  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const setVar = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="h-screen bg-slate-100 text-slate-800 font-sans flex overflow-hidden">
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 sm:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <Sidebar tab={tab} setTab={setTab} counts={counts} userEmail={identityLabel(session.user)} userFullName={profile?.fullName} isAdmin={isAdmin}
        strainFilter={strainFilter} setStrainFilter={setStrainFilter}
        onOpenHistoryAll={() => { setSpFocus(null); setTab("sp-history"); }}
        mobileOpen={mobileNavOpen} />

      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto">
        <div ref={topbarRef} className="sticky top-0 z-20">
          <Breadcrumb tab={tab} focusMaSP={spFocus?.maSP} products={products} />
          <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 bg-white border-b border-slate-200">
            <button onClick={() => setMobileNavOpen(true)} className="sm:hidden shrink-0 p-1 -ml-1 text-slate-500 hover:text-slate-800" title="Mở menu">
              <Menu className="w-5 h-5" />
            </button>
            <p className="text-xs text-slate-400 truncate">Bacillus subtilis / Bacillus clausii · thu bào tử → QC → phân luồng → pha chế</p>
          </div>
          {note && (
            <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs px-4 py-2 flex items-center justify-between">
              <span>{note}</span>
              <button onClick={() => setNote("")} className="text-emerald-600 hover:underline">Ẩn</button>
            </div>
          )}
        </div>

        <main className="p-3 sm:p-4 max-w-[1280px] mx-auto w-full">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang tải dữ liệu từ Supabase…
            </div>
          ) : (
            <>
              {tab === "cho-kqkn" && canEditNL && <AddLotForm onAdd={addLot} />}
              {(tab === "cho-pha" || tab === "cho-kqkn" || tab === "cho-xu-ly" || tab === "da-pha" || tab === "da-huy" || tab === "cho-xoa") && (() => {
                const rows = filtered(tab);
                return (
                  <>
                    <NLFilterBar loQuery={loQuery} setLoQuery={setLoQuery}
                      statusTagFilter={statusTagFilter} setStatusTagFilter={setStatusTagFilter}
                      dateField={dateField} setDateField={setDateField}
                      dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
                      hasActiveFilter={hasActiveFilter} onReset={resetFilters}
                      resultCount={rows.length} />
                    {tab === "cho-xu-ly" && <ChoXuLyMonthlyReport rows={rows} setNote={setNote} />}
                    <MaterialTable rows={rows} status={tab} onEdit={editField} onRemove={removeRec}
                      onSoftDelete={softDeleteRec} onRestore={restoreRec} profilesById={profilesById}
                      canEditNL={canEditNL} canEditQcResults={canEditQcResults} onAddBottle={addBottleToLot}
                      onForceDaPha={forceDaPha} onForceChoXuLy={forceChoXuLy} onForceDaHuy={forceDaHuy} setNote={setNote} />
                  </>
                );
              })()}
              {/* Chờ SX nằm trong mục "Pha chế", không có bộ lọc theo chủng (subtilis/clausii) như
                  "Quản lý NL" — mỗi mẻ vốn đã gộp cả 2 chủng, lọc riêng từng chủng sẽ hiện mẻ thiếu. */}
              {tab === "cho-sx" && <ChoSXPanel choSxMaterials={materials.filter((r) => statusOf(r).status === "cho-sx")} allMaterials={materials} products={products} actorId={actorId} setNote={setNote} onConfirmed={goToProductionHistory} canEdit={canEditProduction} />}
              {tab === "pha" && <MixPanel materials={materials} products={products} onConfirm={confirmMix} canEdit={canEditProduction} />}
              {tab === "ke-hoach" && <MixPlanPanel materials={materials} products={products} actorId={actorId} setNote={setNote} reload={reload} canEdit={canEditProduction} canPreview={canPreviewPlan} role={profile.role} userLabel={profile?.fullName || identityLabel(session.user)} />}
              {tab === "sp" && <ProductPanel products={products} setProducts={setProducts} setNote={setNote} isAdmin={isAdmin} canEdit={canEditProduction} />}
              {tab === "sp-history" && <ProductionHistoryPanel products={products} setNote={setNote} focusMaSP={spFocus?.maSP} focusTs={spFocus?.ts} canEdit={canEditProduction} />}
              {LENMEN_TABS.some((t) => t.key === tab) && <LenMenPanel tab={tab} materials={materials} actorId={actorId} setNote={setNote} />}
              {tab === "giong" && <SeedLotPanel isAdmin={isAdmin} isQC={isQC} canXuatChung={canXuatChung} actorId={actorId} profilesById={profilesById} setNote={setNote} />}
              {tab === "users" && isAdmin && <UsersPanel profiles={profiles} onUpdate={updateUserProfile} currentUserId={actorId} onCreated={reload} />}
              {tab === "account" && <AccountSettingsPanel session={session} profile={profile} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------------- Sidebar ---------------- */
function Sidebar({ tab, setTab, counts, userEmail, userFullName, isAdmin, strainFilter, setStrainFilter, onOpenHistoryAll, mobileOpen }) {
  const displayEmail = userEmail;
  const [nlOpen, setNlOpen] = useState(false);
  const [phaOpen, setPhaOpen] = useState(false);
  const [spOpen, setSpOpen] = useState(false);
  const [lenMenOpen, setLenMenOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState({});
  const isPhaTab = tab === "pha" || tab === "ke-hoach" || tab === "cho-sx";
  const isNlTab = NL_TABS.some((t) => t.key === tab) || tab === "cho-xoa";
  const isSpTab = tab === "sp" || tab === "sp-history";
  const isLenMenTab = LENMEN_TABS.some((t) => t.key === tab);
  const SIDEBAR_BG = "#28374a";
  const ACTIVE_TEXT = "#28374a";
  const isStatusOpen = (key) => (manualOpen[key] !== undefined ? manualOpen[key] : tab === key);
  const toggleStatus = (key) => setManualOpen((prev) => ({ ...prev, [key]: !isStatusOpen(key) }));
  const selectStrain = (statusKey, strainValue) => {
    setTab(statusKey);
    setStrainFilter(strainValue);
    setManualOpen((prev) => ({ ...prev, [statusKey]: true }));
  };
  return (
    <aside
      className={`w-60 shrink-0 text-white flex flex-col h-screen fixed inset-y-0 left-0 z-40 transition-transform duration-200 sm:static sm:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      style={{ backgroundColor: SIDEBAR_BG }}>
      <div className="flex items-center gap-2 px-4 py-4 bg-white">
        <img src="/logo.png" alt="CPC1HN" className="w-8 h-8 shrink-0 object-contain"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <div className="min-w-0">
          <div className="font-bold text-base leading-tight truncate" style={{ color: SIDEBAR_BG }}>CPC1HN</div>
          <div className="text-[11px] text-slate-500 truncate">Quản lý pha chế sinh phẩm</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 text-sm">
        <button onClick={() => setPhaOpen((o) => !o)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/10 transition ${isPhaTab ? "bg-white/10 font-medium" : ""}`}>
          <Beaker className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Pha chế</span>
          {phaOpen ? <ChevronDown className="w-3.5 h-3.5 text-amber-400" /> : <ChevronRight className="w-3.5 h-3.5 text-amber-400" />}
        </button>
        {phaOpen && (
          <div className="mx-2 my-1 py-1 rounded-md bg-black/15">
            <button onClick={() => setTab("pha")}
              className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === "pha" ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
              style={tab === "pha" ? { color: ACTIVE_TEXT } : undefined}>
              <span className="flex-1 text-left">Pha chế NCV</span>
            </button>
            <button onClick={() => setTab("ke-hoach")}
              className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === "ke-hoach" ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
              style={tab === "ke-hoach" ? { color: ACTIVE_TEXT } : undefined}>
              <span className="flex-1 text-left">Pha chế SX</span>
            </button>
            <button onClick={() => setTab("cho-sx")}
              className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === "cho-sx" ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
              style={tab === "cho-sx" ? { color: ACTIVE_TEXT } : undefined}>
              <span className="flex-1 text-left">Chờ SX</span>
              {counts["cho-sx"].meCount > 0 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/15"
                  style={tab === "cho-sx" ? { backgroundColor: `${ACTIVE_TEXT}1a`, color: ACTIVE_TEXT } : undefined}>{counts["cho-sx"].meCount}</span>
              )}
            </button>
          </div>
        )}

        <button onClick={() => setNlOpen((o) => !o)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/10 transition ${isNlTab ? "bg-white/10 font-medium" : ""}`}>
          <Boxes className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Quản lý NL</span>
          {nlOpen ? <ChevronDown className="w-3.5 h-3.5 text-amber-400" /> : <ChevronRight className="w-3.5 h-3.5 text-amber-400" />}
        </button>
        {nlOpen && (
          <div className="mx-2 my-1 py-1 rounded-md bg-black/15">
            {NL_TABS.map((t) => {
              const active = tab === t.key;
              const headerActive = active && strainFilter === "all";
              const open = isStatusOpen(t.key);
              return (
                <div key={t.key}>
                  <button onClick={() => selectStrain(t.key, "all")}
                    className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${headerActive ? "bg-white font-medium" : active ? "bg-white/10 font-medium" : "text-white/85 hover:bg-white/10"}`}
                    style={headerActive ? { color: ACTIVE_TEXT } : undefined}>
                    <span className="flex-1 text-left">{t.label}</span>
                    {counts[t.key].all > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/15"
                        style={headerActive ? { backgroundColor: `${ACTIVE_TEXT}1a`, color: ACTIVE_TEXT } : undefined}>{counts[t.key].all}</span>
                    )}
                    <span onClick={(e) => { e.stopPropagation(); toggleStatus(t.key); }} className="p-0.5 -m-0.5 shrink-0">
                      {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </span>
                  </button>
                  {open && (
                    <div className="pb-1">
                      {STRAIN_OPTIONS.map((s) => {
                        const leafActive = active && strainFilter === s.value;
                        const n = counts[t.key][s.value];
                        return (
                          <button key={s.value} onClick={() => selectStrain(t.key, s.value)}
                            className={`w-full flex items-center gap-2 pl-12 pr-3 py-1.5 text-[12px] transition rounded ${leafActive ? "bg-white font-medium" : "text-white/70 hover:bg-white/10"}`}
                            style={leafActive ? { color: ACTIVE_TEXT } : undefined}>
                            <span className="flex-1 text-left">{s.label}</span>
                            {n > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/15"
                                style={leafActive ? { backgroundColor: `${ACTIVE_TEXT}1a`, color: ACTIVE_TEXT } : undefined}>{n}</span>
                            )}
                          </button>
                        );
                      })}
                      {t.key === "cho-pha" && (() => {
                        const trashActive = tab === "cho-xoa";
                        const n = counts["cho-xoa"].all;
                        return (
                          <button onClick={() => { setTab("cho-xoa"); setManualOpen((prev) => ({ ...prev, "cho-pha": true })); }}
                            className={`w-full flex items-center gap-2 pl-12 pr-3 py-1.5 text-[12px] transition rounded ${trashActive ? "bg-white font-medium" : "text-white/70 hover:bg-white/10"}`}
                            style={trashActive ? { color: ACTIVE_TEXT } : undefined}>
                            <Trash2 className="w-3 h-3 shrink-0" />
                            <span className="flex-1 text-left">Thùng rác</span>
                            {n > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/15"
                                style={trashActive ? { backgroundColor: `${ACTIVE_TEXT}1a`, color: ACTIVE_TEXT } : undefined}>{n}</span>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button onClick={() => setSpOpen((o) => !o)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/10 transition ${isSpTab ? "bg-white/10 font-medium" : ""}`}>
          <Droplets className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Sản phẩm</span>
          {spOpen ? <ChevronDown className="w-3.5 h-3.5 text-amber-400" /> : <ChevronRight className="w-3.5 h-3.5 text-amber-400" />}
        </button>
        {spOpen && (
          <div className="mx-2 my-1 py-1 rounded-md bg-black/15">
            <button onClick={() => setTab("sp")}
              className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === "sp" ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
              style={tab === "sp" ? { color: ACTIVE_TEXT } : undefined}>
              <span className="flex-1 text-left">Danh mục</span>
            </button>
            <button onClick={onOpenHistoryAll}
              className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === "sp-history" ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
              style={tab === "sp-history" ? { color: ACTIVE_TEXT } : undefined}>
              <span className="flex-1 text-left">Lịch sử pha chế</span>
            </button>
          </div>
        )}
        {/* Cảnh báo lên men — công đoạn TRƯỚC nguyên liệu (thu bào tử), gộp từ app chạy riêng
            trước đây. Đặt dưới "Sản phẩm" theo đúng thứ tự quy trình. */}
        <button onClick={() => setLenMenOpen((o) => !o)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/10 transition ${isLenMenTab ? "bg-white/10 font-medium" : ""}`}>
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Cảnh báo lên men</span>
          {lenMenOpen ? <ChevronDown className="w-3.5 h-3.5 text-amber-400" /> : <ChevronRight className="w-3.5 h-3.5 text-amber-400" />}
        </button>
        {lenMenOpen && (
          <div className="mx-2 my-1 py-1 rounded-md bg-black/15">
            {LENMEN_TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-[13px] transition rounded ${tab === t.key ? "bg-white font-medium" : "text-white/85 hover:bg-white/10"}`}
                style={tab === t.key ? { color: ACTIVE_TEXT } : undefined}>
                <span className="flex-1 text-left">{t.label}</span>
              </button>
            ))}
          </div>
        )}
        {/* Bảo quản chủng giống — sổ lô ống chủng + theo dõi độ ổn định, thay file Excel
            "File tổng SỐ LÔ". Là menu riêng, không nằm trong Cảnh báo lên men. */}
        <SidebarLink active={tab === "giong"} icon={Snowflake} activeText={ACTIVE_TEXT} onClick={() => setTab("giong")}>Bảo quản chủng giống</SidebarLink>
        {isAdmin && <SidebarLink active={tab === "users"} icon={Users} activeText={ACTIVE_TEXT} onClick={() => setTab("users")}>Người dùng</SidebarLink>}
      </nav>
      <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
        <div className="flex-1 min-w-0" title={userFullName ? `${userFullName} — ${userEmail}` : userEmail}>
          {userFullName && <div className="text-xs text-white truncate">{userFullName}</div>}
          <div className="text-[11px] text-white/60 truncate">{displayEmail}</div>
        </div>
        <button onClick={() => setTab("account")} title="Tài khoản của tôi"
          className={`p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white shrink-0 ${tab === "account" ? "bg-white/10" : ""}`}>
          <Settings className="w-4 h-4" />
        </button>
        <button onClick={() => supabase.auth.signOut()} title="Đăng xuất"
          className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white shrink-0">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
function SidebarLink({ active, icon: Icon, onClick, children, activeText = "#28374a" }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-2.5 transition ${active ? "bg-white font-medium" : "hover:bg-white/10"}`}
      style={active ? { color: activeText } : undefined}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">{children}</span>
    </button>
  );
}

/* ---------------- Breadcrumb ---------------- */
function Breadcrumb({ tab, focusMaSP, products }) {
  const nlTab = NL_TABS.find((t) => t.key === tab);
  const focusedProduct = focusMaSP && (products || []).find((p) => p.maSP === focusMaSP);
  const parts = nlTab ? ["Trang chủ", "Quản lý NL", nlTab.label]
    : tab === "cho-xoa" ? ["Trang chủ", "Quản lý NL", "Chờ pha", "Thùng rác"]
    : tab === "pha" ? ["Trang chủ", "Pha chế NCV"]
    : tab === "ke-hoach" ? ["Trang chủ", "Pha chế SX"]
    : tab === "cho-sx" ? ["Trang chủ", "Pha chế", "Chờ SX"]
    : tab === "sp" ? ["Trang chủ", "Sản phẩm", "Danh mục"]
    : tab === "sp-history" ? (focusedProduct
        ? ["Trang chủ", "Sản phẩm", "Lịch sử pha chế", `${focusedProduct.maSP} · ${focusedProduct.tenSP}`]
        : ["Trang chủ", "Sản phẩm", "Lịch sử pha chế"])
    : LENMEN_TABS.some((t) => t.key === tab)
        ? ["Trang chủ", "Cảnh báo lên men", LENMEN_TABS.find((t) => t.key === tab).label]
    : tab === "giong" ? ["Trang chủ", "Bảo quản chủng giống"]
    : tab === "users" ? ["Trang chủ", "Người dùng"]
    : tab === "account" ? ["Trang chủ", "Tài khoản của tôi"]
    : ["Trang chủ", "Sản phẩm"];
  return (
    <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 bg-white border-b border-slate-200 text-xs text-slate-500">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
          <span className={i === parts.length - 1 ? "text-slate-800 font-medium" : ""}>{p}</span>
        </span>
      ))}
    </div>
  );
}

/* ---------------- Thêm lô mới bằng tay ---------------- */
function AddLotForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [strain, setStrain] = useState("subtilis");
  const [lo, setLo] = useState("");
  const [soChai, setSoChai] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!lo.trim() || Number(soChai) < 1) return;
    setSaving(true);
    setError("");
    try {
      await onAdd({ strain, lo, soChai: Number(soChai) });
      setLo(""); setSoChai(1); setOpen(false);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-3 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-md">
        <Plus className="w-4 h-4" /> Thêm lô mới
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mb-3 bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs text-slate-500">Tên (chủng)</label>
        <select value={strain} onChange={(e) => setStrain(e.target.value)}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
          <option value="subtilis">Bacillus subtilis</option>
          <option value="clausii">Bacillus clausii</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-500">Lô</label>
        <input value={lo} onChange={(e) => setLo(e.target.value)} placeholder="vd: 030526SA1" required
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-40" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Số chai</label>
        <input type="number" min="1" value={soChai} onChange={(e) => setSoChai(e.target.value)} required
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-24" />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-md">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Thêm
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700 px-2">Huỷ</button>
      </div>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}

/* ---------------- Bù chai bị quét thiếu (thêm tay vào lô đã có) ---------------- */
function AddBottleInline({ lo, onAdd }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.stopPropagation();
    if (Number(count) < 1) return;
    setSaving(true);
    setError("");
    try {
      await onAdd(lo, Number(count));
      setCount(1);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="Thêm chai bị quét thiếu vào lô này"
        className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-emerald-600 hover:bg-emerald-100">
        <Plus className="w-4 h-4" />
      </button>
    );
  }
  return (
    <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center gap-1.5">
      <input type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)}
        className="w-14 text-xs border border-slate-300 rounded px-1.5 py-1" />
      <button onClick={submit} disabled={saving}
        className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-2 py-1 rounded">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Thêm"}
      </button>
      <button onClick={(e) => { e.stopPropagation(); setOpen(false); }} className="text-xs text-slate-500 hover:text-slate-700 px-1">Huỷ</button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}

/* ---------------- Chuyển trạng thái tay (bù thực tế lệch dữ liệu QC/kho) ---------------- */
const FORCE_STATUS_LABEL = { "da-pha": "Đã pha", "cho-xu-ly": "Chờ xử lý", "da-huy": "Đã huỷ" };
function ForceStatusSelect({ soLo, onDaPha, onChoXuLy, onDaHuy }) {
  const handlers = { "da-pha": onDaPha, "cho-xu-ly": onChoXuLy, "da-huy": onDaHuy };
  return (
    <select
      value=""
      title="Chuyển trạng thái tay — dùng khi thực tế đã pha/cần xử lý/huỷ nhưng dữ liệu QC chưa khớp"
      onChange={(e) => {
        const key = e.target.value;
        e.target.value = "";
        if (!key) return;
        if (window.confirm(`Chuyển tay số lô ${soLo} sang "${FORCE_STATUS_LABEL[key]}"?`)) handlers[key]();
      }}
      className="text-[11px] border border-slate-200 rounded px-1 py-1 text-slate-500 bg-white"
    >
      <option value="">Chuyển…</option>
      <option value="da-pha">→ Đã pha</option>
      <option value="cho-xu-ly">→ Chờ xử lý</option>
      <option value="da-huy">→ Đã huỷ</option>
    </select>
  );
}

/* ---------------- Ô sửa nhanh ---------------- */
function EditText({ v, on, w = "w-24", ph, disabled, err, commitOnBlur, title }) {
  // commitOnBlur: chỉ lưu (và do đó chỉ kích hoạt phân loại lại trạng thái, vd nhảy sang
  // "Chờ xử lý") lúc rời khỏi ô — không lưu theo từng ký tự như mặc định, tránh dòng bị
  // chuyển tab ngay giữa lúc còn đang gõ dở (vd Ghi chú bắt buộc trước khi chuyển Chờ xử lý).
  //
  // Bug "nhảy chữ" (giống bug "nhảy số" đã vá ở EditNum): chế độ mặc định (không
  // commitOnBlur) lưu lên Supabase theo từng ký tự — mỗi lần lưu kích hoạt Realtime
  // (subscribeMaterials) tải lại TOÀN BỘ bảng. Nếu ô input bind thẳng vào v (dữ liệu
  // server) thay vì state riêng, dữ liệu tải lại về trễ/lệch nhịp lúc đang gõ nhanh sẽ
  // ghi đè lùi lại chữ vừa gõ. Luôn hiển thị từ state `text` riêng, chỉ đồng bộ lại từ
  // v khi ô KHÔNG đang được focus (đang gõ dở thì bỏ qua, đợi rời ô/dữ liệu ổn định).
  const [text, setText] = useState(v ?? "");
  const focusedRef = useRef(false);
  useEffect(() => { if (!focusedRef.current) setText(v ?? ""); }, [v]);
  return <input value={text} placeholder={ph} disabled={disabled} title={title}
    onFocus={() => { focusedRef.current = true; }}
    onChange={(e) => { const val = e.target.value; setText(val); if (!commitOnBlur) on(val); }}
    onBlur={() => { focusedRef.current = false; if (commitOnBlur) on(text); }}
    className={`${w} text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:bg-slate-50 disabled:text-slate-400 ${err ? "border-rose-400 bg-rose-50" : "border-slate-200"}`} />;
}
// Số lớn (vd MĐ SH cỡ chục triệu) khó đọc nếu để trần — lúc KHÔNG focus hiện có dấu chấm
// ngăn cách hàng nghìn kiểu vi-VN (vd 10000000 -> "10.000.000"), lúc bấm vào gõ thì trả về
// số thô (không dấu chấm) để không vướng lúc gõ/xoá.
const groupNum = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("vi-VN", { maximumFractionDigits: 6 }));
// Ô nhập số nguyên (vd Số ống) cần chấm ngay LÚC ĐANG GÕ (khác EditNum chỉ chấm lúc blur) —
// state vẫn giữ nguyên chuỗi số thô không dấu chấm (chỗ khác đang parse bằng num() không đổi
// gì), input chỉ hiện bản có chấm; gõ ký tự nào không phải số thì tự bỏ qua luôn.
const digitsOnly = (s) => String(s || "").replace(/\D/g, "");
const groupIntStr = (s) => { const d = digitsOnly(s); return d ? Number(d).toLocaleString("vi-VN") : ""; };
// Ô số nguyên có chấm hàng nghìn nhưng vẫn sửa được đúng kiểu bình thường (xoá 1 chữ số giữa
// chuỗi rồi gõ số khác vào đúng chỗ đó, không bị bật con trỏ về cuối) — value là chuỗi số thô
// (không dấu chấm, giữ nguyên cho chỗ khác dùng num()/parseInt), onChange trả về số thô mới.
// Cách làm: đếm xem trước vị trí con trỏ có bao nhiêu CHỮ SỐ (bỏ qua dấu chấm) ngay sau khi
// trình duyệt đã áp thao tác sửa, format lại toàn chuỗi, rồi đặt lại con trỏ ngay sau đúng số
// chữ số đó trong chuỗi mới — ghi thẳng vào DOM (el.value/setSelectionRange) TRƯỚC khi gọi
// onChange (kích hoạt re-render từ state cha) để khỏi bị nháy/giật lúc React vẽ lại.
function GroupedIntInput({ value, onChange, placeholder, className }) {
  const handleChange = (e) => {
    const el = e.target;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const digitsBeforeCaret = (raw.slice(0, caret).match(/\d/g) || []).length;
    const digits = digitsOnly(raw);
    const formatted = digits ? Number(digits).toLocaleString("vi-VN") : "";
    let pos = formatted.length;
    if (digitsBeforeCaret === 0) {
      pos = 0;
    } else {
      let count = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) count++;
        if (count === digitsBeforeCaret) { pos = i + 1; break; }
      }
    }
    el.value = formatted;
    el.setSelectionRange(pos, pos);
    onChange(digits);
  };
  return <input value={groupIntStr(value)} onChange={handleChange} placeholder={placeholder} inputMode="numeric" className={className} />;
}
function EditNum({ v, on, w = "w-16" }) {
  // Giữ text người dùng đang gõ ở state riêng, không hiển thị lại số đã parse ngay trong lúc
  // gõ — nếu không, gõ dở "8," sẽ bị parse+hiển thị lại thành "8", nuốt mất dấu phẩy vừa gõ,
  // không gõ tiếp được số thập phân.
  const [text, setText] = useState(groupNum(v));
  // Bug "nhảy số": mỗi lần gõ xong 1 ký tự hợp lệ (vd "8,") đã gọi on() lưu tạm lên Supabase,
  // Realtime lập tức phản hồi lại giá trị đã lưu (vd "8", mất phần thập phân đang gõ dở) qua
  // prop v — nếu vẫn đồng bộ lại lúc đang gõ thì mất luôn phần vừa nhập, gõ tiếp bị sai số.
  // Chỉ đồng bộ lại từ v khi ô KHÔNG đang được focus (đang gõ dở thì bỏ qua, đợi blur).
  const focusedRef = useRef(false);
  useEffect(() => { if (!focusedRef.current) setText(groupNum(v)); }, [v]);
  return (
    <input
      value={text}
      inputMode="decimal"
      onFocus={() => { focusedRef.current = true; setText(v ?? ""); }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") { on(null); return; }
        const n = num(raw);
        if (n != null) on(n);
      }}
      onBlur={() => { focusedRef.current = false; setText(groupNum(v)); }}
      className={`${w} text-xs border border-slate-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-emerald-400`}
    />
  );
}

/* ---------------- Bộ lọc bảng NL ---------------- */
/** Thanh lọc dùng chung cho mọi tab NL (Chờ KQKN/Chờ pha/Chờ xử lý/Đã pha/Đã huỷ/Thùng rác) — lọc
 * theo lô/chai (gõ ".C1" để ra đúng 1 chai), tình trạng (loại/cảnh báo), và khoảng thời gian (ngày
 * thu mẫu hoặc đợt SX theo tháng). Đổi "Lọc theo" xoá luôn Từ/Đến vì định dạng ngày (date) và
 * tháng (month) không tương thích nhau, giữ lại giá trị cũ sẽ so sánh sai. */
function NLFilterBar({ loQuery, setLoQuery, statusTagFilter, setStatusTagFilter, dateField, setDateField, dateFrom, setDateFrom, dateTo, setDateTo, hasActiveFilter, onReset, resultCount }) {
  const dateInputType = dateField === "thoiGianThu" ? "date" : "month";
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 mb-3 flex flex-wrap items-end gap-3 text-xs">
      <div className="flex flex-col gap-1">
        <label className="text-slate-500">Tìm theo lô/chai</label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-300 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={loQuery} onChange={(e) => setLoQuery(e.target.value)}
            placeholder="vd: 26G02SA1 hoặc .C1"
            className="pl-7 pr-2 py-1.5 w-44 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-slate-500">Tình trạng</label>
        <select value={statusTagFilter} onChange={(e) => setStatusTagFilter(e.target.value)}
          className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400">
          <option value="all">Tất cả</option>
          <option value="loai1">Loại 1</option>
          <option value="loai2">Loại 2</option>
          <option value="het-han">Hết hạn</option>
          <option value="gan-het-han">Sắp hết hạn</option>
          <option value="qua-han-qc">Quá hạn trả KQ QC</option>
          <option value="thieu-du-lieu">Thiếu dữ liệu QC</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-slate-500">Lọc thời gian theo</label>
        <select value={dateField}
          onChange={(e) => { setDateField(e.target.value); setDateFrom(""); setDateTo(""); }}
          className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400">
          <option value="thoiGianThu">Ngày thu mẫu</option>
          <option value="dotSanXuat">Đợt SX (tháng)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-slate-500">Từ</label>
        {dateInputType === "date" ? (
          <DateInputVN value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-24 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        ) : (
          <input type="month" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-slate-500">Đến</label>
        {dateInputType === "date" ? (
          <DateInputVN value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-24 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        ) : (
          <input type="month" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        )}
      </div>
      {hasActiveFilter && (
        <button onClick={onReset} className="flex items-center gap-1 text-slate-500 hover:text-rose-600 py-1.5">
          <X className="w-3.5 h-3.5" /> Xoá bộ lọc
        </button>
      )}
      <span className="text-slate-400 ml-auto py-1.5">{resultCount} bản ghi khớp</span>
    </div>
  );
}

/* ---------------- Bảng NL ---------------- */

// <td> tham gia chọn vùng kiểu Excel (xem MaterialGroupTable) — tách thành component đứng
// riêng ở module scope để giữ nguyên identity giữa các lần render (định nghĩa component bên
// trong 1 hàm render khác sẽ khiến React unmount/remount lại <td> mỗi lần re-render, làm mất
// focus đang gõ dở trong ô).
function SelectableTd({ selected, showHandle, onCellDown, onCellEnter, onHandleDown, className = "", children }) {
  return (
    <td className={`relative ${className} ${selected ? "ring-1 ring-inset ring-blue-500 bg-blue-50/70" : ""}`}
      onMouseDown={onCellDown} onMouseEnter={onCellEnter}>
      {children}
      {showHandle && (
        <span onMouseDown={onHandleDown} title="Kéo để điền xuống các chai bên dưới"
          className="absolute right-0 bottom-0 w-2 h-2 bg-blue-600 border border-white cursor-crosshair z-10" />
      )}
    </td>
  );
}

// Parse 1 giá trị dán vào theo đúng kiểu cột — trả {ok:false} nếu không hợp lệ (bị bỏ qua,
// không lưu giá trị rác). Ngày nhận cả "YYYY-MM-DD" (dán lại từ chính bảng) lẫn "D/M/YYYY"
// (dán từ Excel kiểu Việt Nam).
function parsePasteValue(col, raw, row) {
  const s = String(raw ?? "").trim();
  if (col.type === "number") {
    if (s === "") return { ok: true, value: null };
    const n = num(s);
    return n == null ? { ok: false } : { ok: true, value: n };
  }
  if (col.type === "date") {
    if (s === "") return { ok: true, value: null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const d = parseInt(m[1], 10), mo = parseInt(m[2], 10); let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
        return { ok: true, value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
    }
    return { ok: false };
  }
  if (col.type === "select") {
    if (s === "") return { ok: true, value: "" };
    const match = col.optionsFor(row).find((o) => o.toLowerCase() === s.toLowerCase());
    return match ? { ok: true, value: match } : { ok: false };
  }
  return { ok: true, value: s }; // text
}

/** 1 bảng con (1 lô) — tách riêng khỏi MaterialTable vì cần state chọn vùng (hook), không gọi
 * được bên trong .map(). Thêm chọn ô/vùng + Ctrl+C/Ctrl+V + kéo điền (fill handle) kiểu Excel
 * cho các cột sửa được — CHỈ trong phạm vi lô này (không kéo/dán xuyên nhiều lô), vì mỗi lô là
 * 1 <table> HTML riêng. Vẫn gọi đúng `onEdit` sẵn có cho từng ô — không viết lại logic lưu. */
function MaterialGroupTable({
  groupKey, list, status, roGeneral, roQcFields, canRowAction, showReason, reasonLabel,
  onEdit, onRemove, onSoftDelete, onRestore, onAddBottle, onForceDaPha, onForceChoXuLy, onForceDaHuy,
  nameOf, setNote,
}) {
  const [open, setOpenSelf] = useState(true);
  const isOpen = open;
  const tenNL = list[0]?.tenNL, chung = list[0]?.chung;

  // Cột tham gia chọn/copy/dán, ĐÚNG thứ tự hiển thị và ĐÚNG điều kiện quyền đang có trong
  // JSX bên dưới — không tạo luật quyền mới.
  const EDITABLE_COLUMNS = useMemo(() => {
    const cols = [];
    // Thời gian thu/Lô chủng KHÔNG nằm trong lưới chọn/copy/dán nữa — đã chuyển lên sửa
    // 1 lần ở thanh tiêu đề nhóm (áp dụng luôn cho cả lô), không còn là cột riêng của bảng.
    if (!roGeneral) cols.push({ key: "vDich", type: "number" });
    if (!roQcFields) cols.push({ key: "camQuan", type: "text" });
    if (!roQcFields) cols.push({ key: "pH", type: "number" });
    if (!roQcFields) cols.push({ key: "mdNhan", type: "number" });
    if (!roQcFields) cols.push({ key: "mdSH", type: "number" });
    if (!roQcFields) cols.push({ key: "tyLeBaoTu", type: "number" });
    if (!roQcFields) cols.push({ key: "nhiemKhuan", type: "select", optionsFor: (row) => ["Đạt", ...(row.strain === "clausii" ? ["Đạt (sub)"] : []), "Không đạt"] });
    if (!roQcFields) cols.push({ key: "nhiemConNao", type: "select", optionsFor: () => ["Gram dương", "Gram dương sinh bào tử", "Gram âm"] });
    if (!roQcFields) cols.push({ key: "ghiChu", type: "text" });
    return cols;
  }, [roGeneral, roQcFields]);
  const colIdx = (key) => EDITABLE_COLUMNS.findIndex((c) => c.key === key);
  const getCellValue = (row, col) => { const v = row[col.key]; return v == null ? "" : v; };

  // sel: {r0,c0,r1,c1} chỉ số trong list/EDITABLE_COLUMNS, KHÔNG cần chuẩn hoá thứ tự khi lưu —
  // chuẩn hoá 1 lần lúc dùng (bounds()).
  const [sel, setSel] = useState(null);
  const dragRef = useRef({ mode: null });
  const bounds = sel && {
    r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1),
    c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1),
  };
  const isSelected = (r, c) => !!bounds && r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1;
  const isHandle = (r, c) => !!bounds && bounds.r0 === bounds.r1 && bounds.c0 === bounds.c1 && r === bounds.r0 && c === bounds.c0;

  useEffect(() => {
    const onUp = () => {
      if (dragRef.current.mode === "fill") {
        const { fillCol, fillSourceRow, fillSourceValue } = dragRef.current;
        const col = EDITABLE_COLUMNS[fillCol];
        const b = bounds;
        if (col && b) {
          for (let r = b.r0; r <= b.r1; r++) {
            if (r === fillSourceRow || !list[r]) continue;
            onEdit(list[r].id, col.key, fillSourceValue);
          }
        }
      }
      if (dragRef.current.mode) document.body.style.userSelect = ""; // xem ghi chú ở startSelect
      dragRef.current = { mode: null };
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, list, EDITABLE_COLUMNS]);

  const startSelect = (r, c) => {
    dragRef.current = { mode: "select", anchor: { r, c } };
    setSel({ r0: r, c0: c, r1: r, c1: c });
    // KHÔNG tự ý .focus() vào div bọc ngoài — ô vừa bấm luôn có sẵn input/select bên trong,
    // trình duyệt đã tự đưa focus vào đúng input đó. Cướp focus sang div sẽ làm gõ chữ (đặc
    // biệt gõ tiếng Việt có dấu) bị rớt/lỗi vì bàn phím gõ vào div thay vì vào input.
    // Tắt bôi đen chữ mặc định của trình duyệt trong lúc kéo — nếu không, kéo chuột bắt đầu từ
    // trong 1 ô input sẽ bị trình duyệt hiểu là "bôi đen chữ trong ô đó" thay vì "quét chọn
    // nhiều ô", nên vùng chọn không quét được sang ô khác. Bật lại ngay khi thả chuột (onUp).
    document.body.style.userSelect = "none";
  };
  const extendSelect = (r, c) => {
    if (dragRef.current.mode === "select") {
      setSel({ r0: dragRef.current.anchor.r, c0: dragRef.current.anchor.c, r1: r, c1: c });
    } else if (dragRef.current.mode === "fill" && c === dragRef.current.fillCol) {
      setSel({
        r0: Math.min(dragRef.current.fillSourceRow, r), c0: c,
        r1: Math.max(dragRef.current.fillSourceRow, r), c1: c,
      });
    }
  };
  const startFill = (e, r, c) => {
    e.stopPropagation();
    const col = EDITABLE_COLUMNS[c];
    dragRef.current = { mode: "fill", fillCol: c, fillSourceRow: r, fillSourceValue: getCellValue(list[r], col) };
    document.body.style.userSelect = "none";
  };

  const doCopy = async () => {
    if (!bounds) return;
    const lines = [];
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      const cells = [];
      for (let c = bounds.c0; c <= bounds.c1; c++) cells.push(String(getCellValue(list[r], EDITABLE_COLUMNS[c])));
      lines.push(cells.join("\t"));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); }
    catch { setNote("Không copy được — trình duyệt chặn quyền truy cập clipboard."); }
  };
  const doPaste = async () => {
    if (!bounds) return;
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch { setNote("Không đọc được clipboard — trình duyệt chặn quyền, thử lại hoặc cấp quyền clipboard cho trang."); return; }
    if (!text) return;
    const grid = text.replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")).map((l) => l.split("\t"));
    const singleCell = grid.length === 1 && grid[0].length === 1;
    const nRows = singleCell ? (bounds.r1 - bounds.r0 + 1) : grid.length;
    const nCols = singleCell ? (bounds.c1 - bounds.c0 + 1) : grid[0].length;
    let ok = 0, fail = 0;
    for (let dr = 0; dr < nRows; dr++) {
      const r = bounds.r0 + dr;
      if (r >= list.length) break;
      for (let dc = 0; dc < nCols; dc++) {
        const c = bounds.c0 + dc;
        if (c >= EDITABLE_COLUMNS.length) break;
        const col = EDITABLE_COLUMNS[c];
        const raw = singleCell ? grid[0][0] : grid[dr]?.[dc];
        const parsed = parsePasteValue(col, raw, list[r]);
        if (parsed.ok) { onEdit(list[r].id, col.key, parsed.value); ok++; } else fail++;
      }
    }
    if (fail > 0) setNote(`Đã dán ${ok} ô, bỏ qua ${fail} ô do giá trị không hợp lệ với cột đó.`);
    setSel({
      r0: bounds.r0, c0: bounds.c0,
      r1: Math.min(bounds.r0 + nRows - 1, list.length - 1),
      c1: Math.min(bounds.c0 + nCols - 1, EDITABLE_COLUMNS.length - 1),
    });
  };
  const doClear = () => {
    if (!bounds) return;
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      if (!list[r]) continue;
      for (let c = bounds.c0; c <= bounds.c1; c++) {
        const col = EDITABLE_COLUMNS[c];
        onEdit(list[r].id, col.key, col.type === "text" ? "" : null);
      }
    }
  };
  // Mọi ô luôn có sẵn input/select đang mở (không có chế độ "chọn nhưng chưa gõ" riêng như
  // Excel thật) — nên Backspace/Delete/phím mũi tên PHẢI để trình duyệt xử lý bình thường
  // (xoá 1 ký tự, di chuyển con trỏ trong ô) khi đang chọn ĐÚNG 1 ô, nếu không sẽ phá luôn
  // thao tác gõ chữ thường. Chỉ bắt các phím này khi đang chọn THẬT SỰ nhiều ô (vùng), lúc đó
  // không ai gõ chữ vào nhiều ô cùng lúc nên không xung đột.
  const isRange = bounds && (bounds.r0 !== bounds.r1 || bounds.c0 !== bounds.c1);
  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); doCopy(); }
    else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); doPaste(); }
    else if (isRange && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); doClear(); }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="w-full flex items-center gap-3 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex-wrap">
        <button onClick={() => setOpenSelf((s) => !s)}
          className="flex items-center gap-2 text-left shrink-0">
          {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <span className="font-mono text-sm font-medium">{groupKey}</span>
          <span className="text-xs text-slate-500">· {tenNL} {chung} · {list.length} chai</span>
        </button>
        {/* Thời gian thu/Lô chủng luôn giống nhau cho cả lô (sửa 1 ô là áp dụng hết các chai,
            xem onChange bên dưới) — chuyển lên đây thay vì lặp lại thành 2 cột riêng trong
            bảng bên dưới cho đỡ tốn chỗ ngang. */}
        <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <span>Thời gian thu:</span>
            {roGeneral ? (
              <span className="text-slate-700">{list[0]?.thoiGianThu ? new Date(list[0].thoiGianThu).toLocaleDateString("vi-VN") : "–"}</span>
            ) : (
              <DateInputVN value={list[0]?.thoiGianThu || ""}
                onChange={(e) => { const v = e.target.value || null; list.forEach((x) => onEdit(x.id, "thoiGianThu", v)); }}
                title="Áp dụng cho cả lô — các chai cùng lô luôn thu cùng ngày"
                className="w-24 text-xs border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span>Lô chủng:</span>
            {roGeneral ? (
              <span className="text-slate-700">{list[0]?.loChung || "–"}</span>
            ) : (
              <EditText v={list[0]?.loChung} commitOnBlur w="w-16"
                title="Áp dụng cho cả lô — các chai cùng lô luôn chung 1 lô chủng"
                on={(x) => { list.forEach((row) => onEdit(row.id, "loChung", x)); }} />
            )}
          </div>
        </div>
        <div className="flex-1" />
        {canRowAction && status === "cho-kqkn" && <AddBottleInline lo={groupKey} onAdd={onAddBottle} />}
      </div>
      {isOpen && (
        <div tabIndex={-1} onKeyDown={onKeyDown} className="overflow-x-auto focus:outline-none">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-white text-slate-400 border-b border-slate-100 text-left">
              <tr>
                {["STT","Số lô","V dịch (L)","Cảm quan","pH","MĐ nhãn","MĐ SH","Bào tử %","Nhiễm khuẩn","Nhiễm con nào","Loại","Ghi chú", showReason ? reasonLabel : "", status === "da-pha" ? "Pha vào" : "", status === "da-pha" ? "Ngày chuyển Đã pha" : "", "Người tạo", "Sửa gần nhất"].map((h,i)=>
                  h ? <th key={i} className="px-3 py-2 font-medium">{h}</th> : null)}
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, rowIdx) => {
                const st = statusOf(r);
                const warnBaoTu = r.tyLeBaoTu != null && r.tyLeBaoTu > 100;
                const warnPh = r.pH != null && (r.pH < 5 || r.pH > 9);
                const qcRed = st.status === "cho-kqkn" && st.qcDays != null && st.qcDays >= QC_RED_DAYS;
                const qcPastDeadline = st.status === "cho-kqkn" && st.qcDays != null && st.qcDays >= QC_DEADLINE_DAYS;
                const hanTraKQ = st.status === "cho-kqkn" && r.thoiGianThu
                  ? new Date(new Date(r.thoiGianThu).setDate(new Date(r.thoiGianThu).getDate() + QC_DEADLINE_DAYS)).toLocaleDateString("vi-VN")
                  : null;
                const cellProps = (key) => ({
                  selected: isSelected(rowIdx, colIdx(key)), showHandle: isHandle(rowIdx, colIdx(key)),
                  onCellDown: () => startSelect(rowIdx, colIdx(key)), onCellEnter: () => extendSelect(rowIdx, colIdx(key)),
                  onHandleDown: (e) => startFill(e, rowIdx, colIdx(key)),
                });
                return (
                  <tr key={r.id} title={qcPastDeadline ? `Đã quá hạn trả KQ QC (${st.qcDays} ngày kể từ thời gian thu)` : undefined}
                    className={`border-b border-slate-50 hover:bg-slate-50/60 ${qcRed ? "bg-red-200 hover:bg-red-200" : ""}`}>
                    <td className="px-3 py-1.5 text-slate-400">{r.stt}</td>
                    <td className="px-3 py-1.5 font-mono">{r.soLo || "–"}</td>
                    {roGeneral ? (
                      <td className="px-2 py-1 text-right">{fmt(r.vDich,1)}</td>
                    ) : (
                      <SelectableTd {...cellProps("vDich")} className="px-2 py-1 text-right">
                        <EditNum v={r.vDich} on={(x)=>onEdit(r.id,"vDich",x)} />
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className="px-2 py-1">{r.camQuan || "–"}</td>
                    ) : (
                      <SelectableTd {...cellProps("camQuan")} className="px-2 py-1">
                        <EditText v={r.camQuan} on={(x)=>onEdit(r.id,"camQuan",x)} w="w-20" />
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className={`px-2 py-1 text-right ${warnPh?"text-rose-600 font-medium":""}`}>
                        {r.phInvalid ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium" title="Dữ liệu pH gốc bị lỗi, đã xoá — khác với chưa đo">⚠ sai</span> : fmt(r.pH,1)}
                      </td>
                    ) : (
                      <SelectableTd {...cellProps("pH")} className={`px-2 py-1 text-right ${warnPh?"text-rose-600 font-medium":""}`}>
                        <div className="flex items-center justify-end gap-1">
                          {r.phInvalid && <span title="Dữ liệu pH gốc bị lỗi, đã xoá — cần nhập lại" className="text-rose-600 text-xs">⚠</span>}
                          <EditNum v={r.pH} on={(x)=>onEdit(r.id,"pH",x)} w="w-14" />
                        </div>
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className="px-2 py-1 text-right">{fmt(r.mdNhan)}</td>
                    ) : (
                      <SelectableTd {...cellProps("mdNhan")} className="px-2 py-1 text-right">
                        <EditNum v={r.mdNhan} on={(x)=>onEdit(r.id,"mdNhan",x)} />
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className="px-2 py-1 text-right">{r.mdSH==null?<span className="text-slate-300">thiếu</span>:fmt(r.mdSH)}</td>
                    ) : (
                      <SelectableTd {...cellProps("mdSH")} className={`px-2 py-1 text-right ${st.needsMdSH?"bg-amber-50":""}`}>
                        <EditNum v={r.mdSH} on={(x)=>onEdit(r.id,"mdSH",x)} />
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className={`px-2 py-1 text-right ${warnBaoTu?"text-rose-600 font-medium":""}`}>{r.tyLeBaoTu==null?"–":fmt(r.tyLeBaoTu,1)}</td>
                    ) : (
                      <SelectableTd {...cellProps("tyLeBaoTu")} className={`px-2 py-1 text-right ${warnBaoTu?"text-rose-600 font-medium":st.needsBaoTu?"bg-amber-50":""}`}>
                        <EditNum v={r.tyLeBaoTu} on={(x)=>onEdit(r.id,"tyLeBaoTu",x)} />
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className="px-2 py-1">{r.nhiemKhuan || "–"}</td>
                    ) : (
                      <SelectableTd {...cellProps("nhiemKhuan")} className="px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <select value={r.nhiemKhuan || ""} onChange={(e)=>onEdit(r.id,"nhiemKhuan",e.target.value)}
                            className={`text-xs border rounded px-1.5 py-1 ${st.needsNhiemConNao ? "border-rose-400 bg-rose-50" : st.chuaQC ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
                            <option value="">– chưa QC –</option>
                            <option value="Đạt">Đạt</option>
                            {r.strain === "clausii" && <option value="Đạt (sub)">Đạt (sub)</option>}
                            <option value="Không đạt">Không đạt</option>
                          </select>
                          {qcPastDeadline && (
                            <span title={`Hạn trả KQ: ${hanTraKQ}`}
                              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${qcRed ? "bg-rose-600 text-white font-semibold" : "bg-amber-100 text-amber-700"}`}>
                              Quá hạn {st.qcDays}d
                            </span>
                          )}
                        </div>
                      </SelectableTd>
                    )}
                    {roQcFields ? (
                      <td className="px-2 py-1">{r.nhiemConNao || "–"}</td>
                    ) : (
                      <SelectableTd {...cellProps("nhiemConNao")} className="px-2 py-1">
                        <div className="flex flex-col gap-0.5">
                          <select value={r.nhiemConNao || ""} onChange={(e)=>onEdit(r.id,"nhiemConNao",e.target.value)}
                            className={`text-xs border rounded px-1.5 py-1 disabled:bg-slate-50 disabled:text-slate-400 ${st.needsNhiemConNao ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}>
                            <option value="">– chọn –</option>
                            <option value="Gram dương">Gram dương</option>
                            <option value="Gram dương sinh bào tử">Gram dương sinh bào tử</option>
                            <option value="Gram âm">Gram âm</option>
                          </select>
                          {r.nhiemConNao && (
                            <span className={`text-[10px] whitespace-nowrap ${st.needsGhiChu ? "text-rose-600 font-semibold" : "text-amber-600"}`}>
                              {st.needsGhiChu ? "⚠ Bắt buộc ghi rõ tên VK vào Ghi chú" : "Ghi rõ tên VK vào Ghi chú"}
                            </span>
                          )}
                          {st.needsNhiemConNao && (
                            <span className="text-[10px] text-rose-600 font-semibold whitespace-nowrap">⚠ Bắt buộc chọn con nhiễm</span>
                          )}
                        </div>
                      </SelectableTd>
                    )}
                    <td className="px-2 py-1.5"><div className="flex items-center gap-1"><LoaiBadge strain={r.strain} loai={st.loai} />{st.expired && <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Quá hạn</span>}{st.nearExpiry && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white font-medium">Sắp hết hạn</span>}</div></td>
                    {roQcFields ? (
                      <td className="px-2 py-1">{r.ghiChu || "–"}</td>
                    ) : (
                      <SelectableTd {...cellProps("ghiChu")} className="px-2 py-1">
                        <EditText v={r.ghiChu} on={(x)=>onEdit(r.id,"ghiChu",x)} w="w-32" err={st.needsGhiChu} commitOnBlur={st.needsGhiChu} />
                      </SelectableTd>
                    )}
                    {showReason && <td className="px-3 py-1.5 text-rose-700 whitespace-normal max-w-xs">{(st.reasons || []).join(" · ") || "–"}</td>}
                    {status === "da-pha" && <td className="px-3 py-1.5"><span className="font-medium text-sky-700">{r.phaProduct || "–"}</span>{r.phaMe && <span className="text-slate-400"> · mẻ {r.phaMe}</span>}</td>}
                    {status === "da-pha" && <td className="px-3 py-1.5 text-slate-500">{r.daPhaAt ? new Date(r.daPhaAt).toLocaleString("vi-VN") : "–"}</td>}
                    <td className="px-3 py-1.5 text-slate-500">{nameOf(r.createdBy)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{nameOf(r.updatedBy)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {!canRowAction ? null : status === "cho-pha" ? (
                        <div className="flex items-center justify-end gap-2">
                          <ForceStatusSelect soLo={r.soLo} onDaPha={()=>onForceDaPha(r.id)} onChoXuLy={()=>onForceChoXuLy(r.id)} onDaHuy={()=>onForceDaHuy(r.id)} />
                          <button onClick={()=>onSoftDelete(r.id)} title="Chuyển vào thùng rác" className="text-slate-300 hover:text-rose-500"><X className="w-4 h-4" /></button>
                        </div>
                      ) : status === "cho-kqkn" ? (
                        <div className="flex items-center justify-end gap-2">
                          <ForceStatusSelect soLo={r.soLo} onDaPha={()=>onForceDaPha(r.id)} onChoXuLy={()=>onForceChoXuLy(r.id)} onDaHuy={()=>onForceDaHuy(r.id)} />
                          <button onClick={()=>{ if (window.confirm(`Xoá vĩnh viễn số lô ${r.soLo}? Dùng khi bị quét nhầm từ mail Thu bào tử. Không thể hoàn tác.`)) onRemove(r.id); }}
                            title="Xoá vĩnh viễn (vd: chai bị quét nhầm)" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : status === "cho-xoa" ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={()=>onRestore(r.id)} title="Khôi phục" className="text-slate-400 hover:text-emerald-600"><RotateCcw className="w-3.5 h-3.5" /></button>
                          <button onClick={()=>{ if (window.confirm(`Xoá vĩnh viễn số lô ${r.soLo}? Không thể hoàn tác.`)) onRemove(r.id); }} title="Xoá vĩnh viễn" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : status === "cho-xu-ly" ? (
                        <div className="flex items-center justify-end gap-2">
                          <ForceStatusSelect soLo={r.soLo} onDaPha={()=>onForceDaPha(r.id)} onChoXuLy={()=>onForceChoXuLy(r.id)} onDaHuy={()=>onForceDaHuy(r.id)} />
                          <button onClick={()=>{ if (window.confirm(`Chuyển số lô ${r.soLo} sang "Đã huỷ" ngay?`)) onEdit(r.id, "huyThuCong", true); }}
                            title="Chuyển sang Đã huỷ" className="text-slate-400 hover:text-rose-600"><Ban className="w-3.5 h-3.5" /></button>
                          <button onClick={()=>onRemove(r.id)} title="Xoá vĩnh viễn" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button onClick={()=>onRemove(r.id)} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STRAIN_SHORT_LABEL = { subtilis: "B. subtilis", clausii: "B. clausii" };
const CHO_XU_LY_REPORT_HEADERS = ["Số lô", "Nguyên liệu", "Chủng", "Thời gian thu", "Lý do", "Ghi chú"];

// Gộp danh sách NL "Chờ xử lý" (dù nhiễm khuẩn không đạt, hết hạn dùng, hay chuyển tay) theo
// THÁNG SẢN XUẤT (productionDate, suy từ số lô — khớp cách "Xu hướng NL" đang tính, luôn có sẵn
// không phụ thuộc NCV đã nhập thời gian thu hay chưa) — để NCV/QC báo cáo nhanh mỗi tháng có bao
// nhiêu chai không đạt mà không phải tự đếm tay trong bảng dài. Copy theo tháng hoặc copy hết 1
// lượt (kèm cột Tháng) để dán thẳng vào mail — copy cả text/html (bảng thật khi dán vào Gmail) lẫn
// text/plain (dán được cả vào nơi không hiện HTML), theo đúng cách copyTable() ở MixPlanPanel.
function ChoXuLyMonthlyReport({ rows, setNote }) {
  const [openMonth, setOpenMonth] = useState(null);

  const byMonth = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const pd = productionDate(r);
      const mk = pd ? `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}` : "?";
      if (!map.has(mk)) map.set(mk, []);
      map.get(mk).push(r);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "?" ? 1 : b === "?" ? -1 : b.localeCompare(a)));
  }, [rows]);

  const monthLabel = (mk) => (mk === "?" ? "Không rõ tháng SX" : monthLabelVN(mk));
  const rowCells = (r) => [
    r.soLo || "", r.tenNL || "", STRAIN_SHORT_LABEL[r.strain] || "",
    r.thoiGianThu ? new Date(r.thoiGianThu).toLocaleDateString("vi-VN") : "",
    (statusOf(r).reasons || []).join(" · "), r.ghiChu || "",
  ];

  const doCopy = async (label, headers, dataRows) => {
    const text = [label, headers.join("\t"), ...dataRows.map((row) => row.join("\t"))].join("\n");
    const html = `<p><b>${label}</b></p><table border="1" cellspacing="0" cellpadding="4">` +
      `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
      `<tbody>${dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      setNote(`Đã copy bảng ${label.toLowerCase()} — dán vào Gmail.`);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setNote(`Đã copy bảng ${label.toLowerCase()} (dạng text) — dán vào Gmail.`);
      } catch (err) {
        setNote(`Không copy được: ${err.message}`);
      }
    }
  };

  const copyMonth = (mk, items) => doCopy(monthLabel(mk), CHO_XU_LY_REPORT_HEADERS, items.map(rowCells));
  const copyAll = () => doCopy(
    "Toàn bộ NL chờ xử lý",
    ["Tháng", ...CHO_XU_LY_REPORT_HEADERS],
    byMonth.flatMap(([mk, items]) => items.map((r) => [monthLabel(mk), ...rowCells(r)])),
  );

  if (!rows.length) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-3">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <span className="font-medium text-sm">Thống kê theo tháng ({rows.length} chai)</span>
        <button onClick={copyAll} className="flex items-center gap-1 text-xs text-sky-700 hover:underline">
          <Copy className="w-3.5 h-3.5" /> Copy toàn bộ (mọi tháng)
        </button>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {byMonth.map(([mk, items]) => (
            <React.Fragment key={mk}>
              <tr className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpenMonth(openMonth === mk ? null : mk)}>
                <td className="px-3 py-2 text-slate-400 w-8">{openMonth === mk ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                <td className="px-3 py-2 font-medium">{monthLabel(mk)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{items.length} chai</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={(e) => { e.stopPropagation(); copyMonth(mk, items); }}
                    className="flex items-center gap-1 text-sky-700 hover:underline ml-auto">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </td>
              </tr>
              {openMonth === mk && (
                <tr>
                  <td colSpan={4} className="px-3 pb-3">
                    <table className="w-full text-xs border border-slate-100 rounded overflow-hidden">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>{CHO_XU_LY_REPORT_HEADERS.map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {items.map((r) => (
                          <tr key={r.id} className="border-t border-slate-100">
                            {rowCells(r).map((c, i) => <td key={i} className="px-2 py-1.5 whitespace-normal">{c || "–"}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaterialTable({ rows, status, onEdit, onRemove, onSoftDelete, onRestore, profilesById, canEditNL, canEditQcResults, onAddBottle, onForceDaPha, onForceChoXuLy, onForceDaHuy, setNote }) {
  const ro = status === "da-pha" || status === "da-huy" || status === "cho-xoa";
  // Thời gian thu/Lô chủng/V dịch: chỉ admin sửa được (dữ liệu nhập liệu/logistics, không phải "kết
  // quả kiểm nghiệm"). Cảm quan/pH/MĐ nhãn/MĐ SH/Bào tử %/Nhiễm khuẩn/Nhiễm con nào/Ghi chú: admin
  // HOẶC QC (đúng ở tab Chờ KQKN) — ngoài Chờ KQKN thì các cột này cũng về admin-only, vì QC chỉ có
  // quyền trong đúng tab này (chốt với NCV 2026-07-30, xem feedback_role_permissions).
  const roGeneral = ro || !canEditNL;
  const roQcFields = ro || (status === "cho-kqkn" ? !(canEditNL || canEditQcResults) : !canEditNL);
  const canRowAction = canEditNL;
  const showReason = status === "cho-xu-ly" || status === "da-huy";
  const reasonLabel = status === "da-huy" ? "Lý do huỷ" : "Lý do chờ xử lý";
  const nameOf = (id) => {
    if (!id) return "–";
    const p = profilesById?.[id];
    return p?.fullName || p?.email || "–";
  };
  const groups = useMemo(() => {
    const g = {};
    for (const r of rows) (g[r.lo] ||= []).push(r);
    // Sắp theo số chai (C1, C2, ... C10, C11) tăng dần đúng số — không phải so sánh chuỗi
    // (so chuỗi sẽ ra "C10" trước "C2", sai thứ tự).
    const chaiNum = (r) => parseInt(String(r.chai || "").replace(/[^0-9]/g, ""), 10) || 0;
    for (const list of Object.values(g)) list.sort((a, b) => chaiNum(a) - chaiNum(b) || a.soLo.localeCompare(b.soLo));
    const entries = Object.entries(g);
    // Ưu tiên thời gian thu (đúng ngày NCV nhập), suy từ số lô (parseSoLoOrderKey — có phân
    // biệt ngày/thứ tự trong tháng, khác productionDate vốn chỉ lấy tới tháng) nếu chưa có
    // thời gian thu — dùng chung cho cả 2 nhánh sắp xếp bên dưới, chỉ khác chiều.
    const refKey = (list) => {
      const r = list[0];
      if (r.thoiGianThu) {
        const n = parseInt(String(r.thoiGianThu).replace(/-/g, ""), 10);
        if (!isNaN(n)) return n;
      }
      return parseSoLoOrderKey(r.soLo) ?? -Infinity;
    };
    if (status === "cho-xu-ly") {
      // Chờ xử lý: lô sản xuất GẦN ĐÂY hơn đẩy lên trên.
      return entries.sort((a, b) => refKey(b[1]) - refKey(a[1]));
    }
    if (status === "cho-pha") {
      // Chờ pha: NL thu CÀNG LÂU càng đẩy lên trên (khớp đúng thứ tự FIFO mà thuật toán tính
      // mẻ pha đang dùng để chọn lô — xem mixPlanner.js fifoCompare/compareThoiGianThu), để
      // NCV nhìn bảng cũng thấy đúng thứ tự chai sẽ được ưu tiên pha trước.
      return entries.sort((a, b) => refKey(a[1]) - refKey(b[1]));
    }
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, status]);

  if (!rows.length)
    return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Chưa có bản ghi nào ở nhóm này.</div>;

  return (
    <div className="space-y-2">
      {groups.map(([key, list]) => (
        <MaterialGroupTable key={key} groupKey={key} list={list} status={status}
          roGeneral={roGeneral} roQcFields={roQcFields} canRowAction={canRowAction}
          showReason={showReason} reasonLabel={reasonLabel} nameOf={nameOf} setNote={setNote}
          onEdit={onEdit} onRemove={onRemove} onSoftDelete={onSoftDelete} onRestore={onRestore}
          onAddBottle={onAddBottle} onForceDaPha={onForceDaPha} onForceChoXuLy={onForceChoXuLy} onForceDaHuy={onForceDaHuy} />
      ))}
    </div>
  );
}
function LoaiBadge({ strain, loai }) {
  if (strain !== "clausii" || !loai) return <span className="text-slate-300">–</span>;
  return loai === 1
    ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">(1)</span>
    : <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">(2)</span>;
}

/* ---------------- Pha chế ---------------- */
/** Theo dõi "ai đang có mặt" trong 1 kênh Supabase Realtime Presence — không lưu DB, chỉ tồn tại
 * khi còn mở tab (tự rời khi đóng tab/đổi sản phẩm). Dùng để cảnh báo 2 NCV tránh cùng lúc chọn NL
 * pha cùng 1 sản phẩm rồi tạo trùng mẻ mất công. */
function usePresence(channelName, selfKey, selfLabel) {
  const [others, setOthers] = useState([]);
  useEffect(() => {
    if (!supabase || !channelName || !selfKey) { setOthers([]); return; }
    const channel = supabase.channel(channelName, { config: { presence: { key: selfKey } } });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const list = Object.entries(state)
        .filter(([key]) => key !== selfKey)
        .map(([, metas]) => metas[metas.length - 1]?.label)
        .filter(Boolean);
      setOthers(list);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") channel.track({ label: selfLabel, at: Date.now() });
    });
    return () => { supabase.removeChannel(channel); };
  }, [channelName, selfKey, selfLabel]);
  return others;
}

function MixPanel({ materials, products, onConfirm, canEdit }) {
  const [maSP, setMaSP] = useState(products[0]?.maSP || "");
  const [sel, setSel] = useState({});
  const sp = products.find((p) => p.maSP === maSP) || products[0];

  const poolMatch = (r) => {
    if (!sp) return false;
    const st = statusOf(r);
    if (st.status !== "cho-pha" || r.mdSH == null) return false;
    if (sp.pool === "subtilis") return r.strain === "subtilis";
    if (sp.pool === "clausii-loai1") return r.strain === "clausii" && st.loai === 1;
    if (sp.pool === "clausii-loai2") return r.strain === "clausii" && st.loai === 2;
    return false;
  };
  const groups = useMemo(() => {
    if (!sp) return [];
    const g = {};
    for (const r of materials.filter(poolMatch)) (g[r.lo] ||= []).push(r);
    const chaiNum = (r) => parseInt(String(r.chai || "").replace(/[^0-9]/g, ""), 10) || 0;
    for (const list of Object.values(g)) list.sort((a, b) => chaiNum(a) - chaiNum(b) || a.soLo.localeCompare(b.soLo));
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials, sp]);

  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const toggleLo = (list) => { const all = list.every((r) => sel[r.id]); setSel((s) => { const n = { ...s }; list.forEach((r) => (n[r.id] = !all)); return n; }); };

  const chosen = materials.filter((r) => sel[r.id] && poolMatch(r));
  const totals = chosen.reduce((a, r) => { const t = tinhPha(r, sp); if (t) { a.vPha += t.vPhaL; a.soOng += t.soOng; } return a; }, { vPha: 0, soOng: 0 });
  const soNhip = sp?.soOngNhip ? totals.soOng / sp.soOngNhip : null;
  const loSet = new Set(chosen.map((r) => r.lo));
  const loaiForPool = sp?.pool === "clausii-loai1" ? 1 : sp?.pool === "clausii-loai2" ? 2 : null;
  const confirm = () => {
    if (!chosen.length) return;
    const me = `${maSP}-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}`;
    onConfirm(chosen.map((r) => r.id), maSP, me, loaiForPool, totals.soOng);
    setSel({});
  };

  if (!sp) return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Chưa có sản phẩm nào — thêm ở tab “Sản phẩm”.</div>;

  return (
    <div className="space-y-3">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <label className="text-xs text-slate-500">Sản phẩm cần pha</label>
          <select value={maSP} onChange={(e) => { setMaSP(e.target.value); setSel({}); }} className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
            {products.map((p) => <option key={p.maSP} value={p.maSP}>{p.maSP} – {p.tenSP}</option>)}
          </select>
          {sp && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>Nguồn NL: <b className="text-slate-700">{POOL_LABEL[sp.pool]}</b></span>
              <span>Hàm lượng: <b className="text-slate-700">{sci(sp.hamLuong)} cfu/ml</b></span>
              <span>Thể tích ống: <b className="text-slate-700">{sp.tubeMl} ml</b></span>
              <span>NCV: <b className="text-slate-700">{sp.ncv || "–"}</b></span>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          Ưu tiên pha hết các chai trong <b>cùng 1 lô</b> rồi mới vệ sinh – tiệt trùng để chuyển sang lô khác.</p>
        {!groups.length && <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Không có NL phù hợp trong “chờ pha” cho nguồn này.</div>}
        {groups.map(([key, list], idx) => {
          const allSel = list.every((r) => sel[r.id]);
          return (
            <div key={key} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${idx === 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{idx === 0 ? "Ưu tiên" : `#${idx + 1}`}</span>
                <span className="font-mono text-sm font-medium">{key}</span>
                {canEdit && <button onClick={() => toggleLo(list)} className="ml-auto text-xs text-emerald-600 hover:underline">{allSel ? "Bỏ chọn lô" : "Chọn cả lô"}</button>}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {list.map((r) => {
                    const t = tinhPha(r, sp);
                    return (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="pl-4 py-1.5 w-8"><input type="checkbox" checked={!!sel[r.id]} disabled={!canEdit} onChange={() => toggle(r.id)} className="accent-emerald-600 disabled:opacity-40" /></td>
                        <td className="px-2 py-1.5 font-mono">{r.soLo}</td>
                        <td className="px-2 py-1.5 text-slate-500">{fmt(r.vDich, 1)} L · SH {fmt(r.mdSH)}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{t ? `${fmt(t.vPhaL, 1)} L` : "–"}</td>
                        <td className="px-4 py-1.5 text-right text-slate-500">{t ? `${fmt(t.soOngNghin, 2)} nghìn ống` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <div className="lg:col-span-1">
        <div className="bg-white rounded-lg border border-slate-200 p-4 lg:sticky lg:top-32">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Beaker className="w-4 h-4 text-emerald-600" /> Mẻ pha chế</h3>
          <Row label="Số chai chọn" value={chosen.length} />
          <Row label="Số lô sử dụng" value={loSet.size} warn={loSet.size > 1} />
          <Row label="Tổng V pha chế" value={`${fmt(totals.vPha, 1)} L`} />
          <Row label="Tổng số ống" value={`${fmt(totals.soOng / 1000, 2)} nghìn`} />
          {soNhip != null && <Row label="Số nhịp sản xuất" value={fmt(soNhip, 2)} />}
          {loSet.size > 1 && <p className="text-[11px] text-amber-600 mt-2 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Đang trộn nhiều lô – cần tiệt trùng hệ thống giữa các lô.</p>}
          <button onClick={confirm} disabled={!canEdit || !chosen.length} title={!canEdit ? "Tài khoản của bạn chỉ xem được, không xác nhận pha được" : undefined}
            className="w-full mt-4 flex items-center justify-center gap-2 bg-emerald-600 text-white text-sm py-2.5 rounded-md hover:bg-emerald-700 disabled:opacity-40">
            <CheckCircle2 className="w-4 h-4" /> Xác nhận pha → Đã pha</button>
          <p className="text-[11px] text-slate-400 mt-2">Các chai đã pha sẽ chuyển sang tab “NL đã pha” và gắn mã mẻ tự động.</p>
        </div>
      </div>
    </div>
    </div>
  );
}

/** Trả 1 mẻ Chờ SX về "Chờ pha" (bỏ ý định pha nữa) — với LÔ ĐÃ BỊ TÁCH lúc Duyệt (so_lo có hậu tố
 * `-P<planId>M<mẻ>`, xem applyPlanApprovalToMaterials), gộp lại TẤT CẢ mảnh cùng lô gốc (bỏ hậu tố
 * `-P<planId>M<mẻ>` để so khớp) đang "Chờ pha" — không chỉ đúng 1 "sibling" mang tên gốc — về ĐÚNG
 * 1 dòng duy nhất, xoá hết phần dư thừa. Sửa 2026-07-30: bản cũ chỉ gộp khi tìm thấy ĐÚNG record
 * mang tên gốc (không hậu tố) VÀ record đó còn "Chờ pha" — nếu record gốc đang bị 1 kế hoạch KHÁC
 * giữ (rất dễ xảy ra khi test duyệt/huỷ nhiều vòng liên tiếp trên cùng lô), thì bỏ cuộc và để mảnh
 * đó đứng riêng thành 1 mã lô lẻ (0.5L, 1L...) — NCV yêu cầu KHÔNG được để lẻ, luôn phải gộp về 1
 * lô đủ lớn. Bản mới: gom mọi mảnh (kể cả các dòng đang bị trả về CÙNG LÚC lẫn mảnh "Chờ pha" có sẵn
 * khác cùng lô gốc), cộng dồn thể tích, giữ lại đúng 1 dòng (ưu tiên dòng mang tên lô gốc nếu có
 * trong nhóm, không thì dòng thể tích lớn nhất), xoá hết các dòng còn lại. */
async function revertChoSXGroup(rows, allMaterials, actorId) {
  const baseOf = (soLo) => soLo.replace(/-P\d+M\d+$/, "");
  const revertingIds = new Set(rows.map((r) => r.id));

  const groupsByBase = new Map();
  for (const row of rows) {
    const base = baseOf(row.soLo);
    if (!groupsByBase.has(base)) groupsByBase.set(base, []);
    groupsByBase.get(base).push(row);
  }
  for (const m of allMaterials) {
    if (revertingIds.has(m.id)) continue;
    const base = baseOf(m.soLo);
    if (!groupsByBase.has(base)) continue; // chỉ quan tâm lô gốc có liên quan tới các dòng đang xử lý
    if (statusOf(m).status === "cho-pha") groupsByBase.get(base).push(m);
  }

  const toDelete = [];
  const toUpdate = new Map();

  for (const [base, members] of groupsByBase) {
    const totalV = members.reduce((s, m) => s + (m.vDich || 0), 0);
    const keeper = members.find((m) => m.soLo === base) || members.slice().sort((a, b) => (b.vDich || 0) - (a.vDich || 0))[0];
    for (const m of members) {
      if (m.id === keeper.id) {
        toUpdate.set(m.id, { ...(toUpdate.get(m.id) || {}), vDich: totalV, choSX: false, choSxAt: null, mixPlanId: null, mixPlanMeSo: null });
      } else {
        toDelete.push(m.id);
      }
    }
  }

  await Promise.all([...toUpdate.entries()].map(([id, patch]) => updateMaterialFields(id, patch, actorId)));
  await Promise.all(toDelete.map((id) => removeMaterial(id)));
}

/** Tab "Chờ SX" — NL đã được 1 kế hoạch mẻ pha DUYỆT (xem applyPlanApprovalToMaterials), nhóm theo
 * đúng mẻ (mixPlanId + mixPlanMeSo) vì mỗi mẻ được xác nhận "Đã pha" RIÊNG (không phải cả kế hoạch
 * cùng lúc — có mẻ pha trước, mẻ pha sau, cách nhau nhiều ngày là bình thường). */
function ChoSXPanel({ choSxMaterials, allMaterials, products, actorId, setNote, onConfirmed, canEdit }) {
  // Nhóm 2 cấp: nhịp sản xuất (mixPlanId) -> từng mẻ (meSo) bên trong. "Xác nhận đã pha"/"Bỏ mẻ"
  // vẫn thao tác theo TỪNG MẺ (mỗi mẻ pha ở 1 thời điểm khác nhau), nhưng "Tạo thông tin gửi mail"
  // gộp TẤT CẢ mẻ còn ở Chờ SX của CÙNG 1 nhịp sản xuất vào 1 bảng duy nhất — đúng như email thực tế
  // của xưởng (nhiều mẻ trong 1 bảng, không tách mỗi mẻ 1 mail).
  const groups = useMemo(() => {
    const byPlan = {};
    choSxMaterials.forEach((r) => {
      const pg = (byPlan[r.mixPlanId] ||= {});
      (pg[r.mixPlanMeSo] ||= []).push(r);
    });
    const planEntries = Object.entries(byPlan).map(([planId, meMap]) => {
      const meEntries = Object.entries(meMap)
        .map(([meSo, rows]) => [Number(meSo), rows])
        .sort((a, b) => a[0] - b[0]);
      const latestAt = Math.max(...meEntries.flatMap(([, rows]) => rows.map((r) => new Date(r.choSxAt || 0).getTime())));
      return [planId, meEntries, latestAt];
    });
    planEntries.sort((a, b) => b[2] - a[2]);
    return planEntries;
  }, [choSxMaterials]);

  // Soi lại đúng ket_qua GỐC của kế hoạch đã Duyệt (không tự suy ra từ materials) — để hiện lại đúng
  // "Bảng mẻ pha" đầy đủ y hệt lúc lập kế hoạch (định lượng CFU/ml, mật độ mục tiêu, V dịch pha, V
  // lấy nước, cỡ ống...), cho NCV đối chiếu lại lần 2 trước khi xác nhận đã pha — không phải chỉ 1
  // bảng rút gọn mã lô/thể tích như trước (NCV phản hồi "không check lại lần 2 được").
  const [plansById, setPlansById] = useState({});
  useEffect(() => {
    const ids = [...new Set(choSxMaterials.map((r) => r.mixPlanId).filter((id) => id != null && !(id in plansById)))];
    if (!ids.length) return;
    fetchMixPlansByIds(ids)
      .then((rows) => setPlansById((prev) => ({ ...prev, ...Object.fromEntries(rows.map((p) => [p.id, p])) })))
      .catch((err) => setNote(`Lỗi tải lại kế hoạch gốc: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choSxMaterials]);

  const [busyKey, setBusyKey] = useState(null); // key của nhóm đang xử lý — disable đúng nút đó trong lúc chờ
  const [exportPlanId, setExportPlanId] = useState(null); // planId đang mở form "Tạo thông tin gửi mail"

  const confirmMe = async (key, rows) => {
    setBusyKey(key);
    try {
      const r0 = rows[0];
      const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const phaMe = `${r0.phaProduct || r0.strain}-P${r0.mixPlanId}M${r0.mixPlanMeSo}-${todayStr}`;
      await confirmMixBatch(rows.map((r) => r.id), { daPha: true, daPhaAt: new Date().toISOString(), phaMe, phaProduct: r0.phaProduct }, actorId);
      // Số lượng dự kiến (cỡ lô ống) lấy từ đúng mẻ trong kế hoạch gốc đã Duyệt — cùng công thức
      // tongTheTich*1000/tubeMl đang dùng để hiện "Cỡ lô (ống)" ở bảng kế hoạch.
      const sp = products.find((p) => p.maSP === r0.phaProduct);
      const originalPlan = plansById[r0.mixPlanId];
      const batch = originalPlan?.ketQua?.batches?.find((b) => b.meSo === r0.mixPlanMeSo);
      const soLuongDuKien = batch && sp?.tubeMl ? (batch.tongTheTich * 1000) / sp.tubeMl : null;
      if (r0.phaProduct) await createFinishedBatch({ tenSP: sp?.tenSP, phaMe, soLuongDuKien, createdBy: actorId });
      setNote(`Đã xác nhận đã pha — mẻ ${r0.mixPlanMeSo} (mã mẻ ${phaMe}).`);
      if (r0.phaProduct) onConfirmed?.(r0.phaProduct);
    } catch (err) { setNote(`Lỗi xác nhận đã pha: ${err.message}`); }
    finally { setBusyKey(null); }
  };

  const cancelMe = async (key, rows) => {
    const r0 = rows[0];
    if (!window.confirm(`Bỏ ý định pha mẻ ${r0.mixPlanMeSo} (${r0.phaProduct || ""})? NL sẽ trả về "Chờ pha" để tính vào kế hoạch khác.`)) return;
    setBusyKey(key);
    try {
      await revertChoSXGroup(rows, allMaterials, actorId);
      setNote(`Đã bỏ mẻ ${r0.mixPlanMeSo} — NL trả về Chờ pha.`);
    } catch (err) { setNote(`Lỗi bỏ mẻ: ${err.message}`); }
    finally { setBusyKey(null); }
  };

  // Bỏ 1 LẦN tất cả các mẻ còn Chờ SX của CÙNG 1 nhịp sản xuất — gộp hết rows của mọi mẻ vào 1 lần
  // gọi revertChoSXGroup (đúng hơn là lặp lại cancelMe từng mẻ: nếu 2 mẻ lỡ cùng tách ra từ 1 lô gốc,
  // gộp chung 1 lần mới ra ĐÚNG 1 dòng duy nhất — lặp riêng từng mẻ có thể bị lệch vì mỗi lần gọi vẫn
  // dùng chung 1 bản chụp `allMaterials` cũ, không thấy được kết quả của lần gọi trước) — đỡ phải bấm
  // "Bỏ mẻ này" thủ công từng mẻ khi cần huỷ nguyên cả nhịp (NCV phản hồi 2026-09).
  const cancelAllMe = async (planId, meEntries, spTen) => {
    const allRows = meEntries.flatMap(([, rows]) => rows);
    if (!window.confirm(`Bỏ ý định pha TẤT CẢ ${meEntries.length} mẻ của nhịp sản xuất ${spTen || ""}? NL sẽ trả về "Chờ pha" để tính vào kế hoạch khác.`)) return;
    const key = `all-${planId}`;
    setBusyKey(key);
    try {
      await revertChoSXGroup(allRows, allMaterials, actorId);
      setNote(`Đã bỏ tất cả ${meEntries.length} mẻ của nhịp sản xuất ${spTen || ""} — NL trả về Chờ pha.`);
    } catch (err) { setNote(`Lỗi bỏ tất cả mẻ: ${err.message}`); }
    finally { setBusyKey(null); }
  };

  if (!groups.length) {
    return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Chưa có NL nào đang chờ SX — NL sẽ tự chuyển sang đây sau khi 1 kế hoạch mẻ pha ở tab "Pha chế SX" được DUYỆT.</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 flex items-center gap-1.5"><Factory className="w-3.5 h-3.5 text-sky-500 shrink-0" />
        NL ở đây đã được lên kế hoạch pha chế và DUYỆT — không còn tính vào kế hoạch nào khác nữa. Bấm "Xác nhận đã pha" đúng lúc mẻ đó thực sự đã pha xong; nếu quên, hệ thống tự chuyển "Đã pha" sau {CHO_SX_RETENTION_DAYS} ngày. Không pha mẻ này nữa thì bấm dấu <X className="w-3 h-3 inline" /> để trả NL về "Chờ pha" — hoặc bấm "Bỏ tất cả mẻ" ở đầu mỗi nhịp sản xuất nếu cần bỏ nguyên cả nhịp cùng lúc.</p>
      {groups.map(([planId, meEntries]) => {
        const allRows = meEntries.flatMap(([, rows]) => rows);
        const r0plan = allRows[0];
        const originalPlan = plansById[planId];
        const sp = products.find((p) => p.maSP === r0plan.phaProduct);
        // planLike: ĐÚNG ket_qua gốc của kế hoạch, gộp TẤT CẢ mẻ của nhịp sản xuất này còn ở Chờ SX
        // (không chỉ 1 mẻ) — dùng để xuất 1 bảng gửi mail duy nhất cho cả nhịp, đúng như email thực tế.
        const meSosHere = meEntries.map(([meSo]) => meSo);
        const planLike = originalPlan ? { ...originalPlan.ketQua, batches: originalPlan.ketQua.batches.filter((b) => meSosHere.includes(b.meSo)) } : null;
        return (
          <div key={planId} className="space-y-3">
            {planLike && sp && (
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-slate-400">Nhịp sản xuất {sp.tenSP} — {meEntries.length} mẻ đang Chờ SX</span>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setExportPlanId(exportPlanId === planId ? null : planId)} title="Tạo bảng dữ liệu cả nhịp sản xuất để gửi mail"
                      className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 border border-sky-200 hover:border-sky-300 rounded-md px-2 py-1.5 bg-white">
                      <Mail className="w-3.5 h-3.5" /> Tạo thông tin gửi mail
                    </button>
                    {meEntries.length > 1 && (
                      <button onClick={() => cancelAllMe(planId, meEntries, sp.tenSP)} disabled={busyKey != null}
                        title="Bỏ ý định pha tất cả mẻ của nhịp sản xuất này, trả hết NL về Chờ pha"
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-md px-2 py-1.5 bg-white disabled:opacity-40">
                        <X className="w-3.5 h-3.5" /> Bỏ tất cả mẻ
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {exportPlanId === planId && planLike && sp && (
              <MeMailExportForm planLike={planLike} sp={sp} isTwo={planLike._kind === "two"} setNote={setNote} />
            )}
            {meEntries.map(([meSo, rows]) => {
              const key = `${planId}-${meSo}`;
              const r0 = rows[0];
              const totalV = rows.reduce((s, r) => s + (r.vDich || 0), 0);
              const daysLeft = r0.choSxAt ? CHO_SX_RETENTION_DAYS - Math.floor((Date.now() - new Date(r0.choSxAt).getTime()) / (24 * 60 * 60 * 1000)) : null;
              const meLike = planLike ? { ...planLike, batches: planLike.batches.filter((b) => b.meSo === meSo) } : null;
              return (
                <div key={key} className="space-y-0">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-slate-50 border border-b-0 border-slate-200 rounded-t-lg">
                    <span className="font-semibold text-sm">{r0.phaProduct || "?"} · Mẻ {r0.mixPlanMeSo}</span>
                    <span className="text-xs text-slate-500">Tổng {fmt(totalV, 2)} L · {rows.length} chai</span>
                    {daysLeft != null && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${daysLeft <= 5 ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-500"}`}>
                        {daysLeft > 0 ? `còn ${daysLeft} ngày trước khi tự chuyển Đã pha` : "sắp tự động chuyển Đã pha"}
                      </span>
                    )}
                    {canEdit && (
                      <>
                        <button onClick={() => confirmMe(key, rows)} disabled={busyKey != null}
                          className="ml-auto flex items-center gap-1.5 bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-40">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Xác nhận đã pha
                        </button>
                        <button onClick={() => cancelMe(key, rows)} disabled={busyKey != null} title="Bỏ mẻ này, trả NL về Chờ pha"
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-md px-2 py-1.5 disabled:opacity-40">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                  {meLike && sp ? (
                    <div className="[&>div]:rounded-t-none [&>div]:border-t-0">
                      <BatchPlanTable plan={meLike} sp={sp} isTwo={meLike._kind === "two"} />
                    </div>
                  ) : (
                    <div className="bg-white border border-t-0 border-slate-200 rounded-b-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className="border-b border-slate-50">
                              <td className="pl-4 py-1.5 font-mono">{r.soLo}</td>
                              <td className="px-2 py-1.5 text-slate-500">{r.strain === "clausii" ? "Clausii" : "Subtilis"}</td>
                              <td className="px-2 py-1.5 text-right font-medium">{fmt(r.vDich, 2)} L</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="px-4 py-1.5 text-[11px] text-slate-400">{sp ? "Đang tải lại bảng mẻ pha gốc…" : `Không tìm thấy sản phẩm "${r0.phaProduct}" — hiện tạm bảng rút gọn.`}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const XU_LY_SAU_DONG_ONG_OPTIONS = ["Hấp 70°C/40 phút", "Không hấp"];
const QUY_TRINH_KHAC_OPTIONS = ["Hấp trong tank 70°C/40 phút", "Không duy trì nhiệt trong tank"];
const CHOT_HUONG_OPTIONS = ["Hoàn thiện luôn", "Chờ KQKN"];
const KHAC_SENTINEL = "__khac__";

function tenNguyenLieuFor(chung, sp) {
  const strain = chung || (sp?.pool?.startsWith("clausii") ? "clausii" : "subtilis");
  return strain === "clausii" ? "Nguyên liệu lỏng Bacillus clausii" : "Nguyên liệu lỏng Bacillus subtilis";
}

/** NCV chỉ gõ PHẦN ĐẦU mã hóa mẻ (vd "CB010526", KHÔNG kèm "C01") — mỗi mẻ tự động nối thêm
 * "C" + số mẻ (đệm 2 số: C01, C02... tới mẻ cuối), đúng quy ước xưởng vẫn dùng. */
function deriveMaHoaMe(base, meSo) {
  if (!base) return "";
  return `${base}C${String(meSo).padStart(2, "0")}`;
}

/** Dropdown 2 lựa chọn hay dùng + luôn cho tự điền khi chọn "Khác". */
function ProcessSelect({ label, options, value, onChange, custom, onCustomChange }) {
  return (
    <div>
      {label && <label className="block text-[11px] text-slate-500 mb-0.5">{label}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs border border-slate-300 rounded px-2 py-1.5">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={KHAC_SENTINEL}>Khác (tự điền)</option>
      </select>
      {value === KHAC_SENTINEL && (
        <input value={custom} onChange={(e) => onCustomChange(e.target.value)} placeholder="Tự nhập..."
          className="mt-1 w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
      )}
    </div>
  );
}

/** Ô chọn nhỏ gọn dùng ngay trong bảng — làm việc trực tiếp trên giá trị ĐÃ CHỐT (resolved string),
 * không tách select-state/custom-state riêng như ProcessSelect (dùng cho form chung phía trên). */
function RowProcessSelect({ options, value, onChange }) {
  const isCustom = value !== "" && !options.includes(value);
  return (
    <div className="min-w-[130px]">
      <select value={isCustom ? KHAC_SENTINEL : (value || options[0])} onChange={(e) => onChange(e.target.value === KHAC_SENTINEL ? "" : e.target.value)}
        className="w-full text-[11px] border border-slate-200 rounded px-1 py-1">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={KHAC_SENTINEL}>Khác (tự điền)</option>
      </select>
      {isCustom && (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tự nhập..."
          className="mt-0.5 w-full text-[11px] border border-slate-200 rounded px-1 py-1" />
      )}
    </div>
  );
}

/** Form nhập các thông tin quy trình xử lý (không tính tự động được, NCV biết rõ quy trình thực tế
 * của SP đó) + xuất bảng dữ liệu mẻ pha đúng định dạng file Excel truyền thống của xưởng để copy dán
 * gửi mail cho các bộ phận. Số liệu (CFU, thể tích, cỡ lô...) lấy lại Y HỆT planBatchRows đang dùng ở
 * "Bảng mẻ pha" — không tính toán/suy diễn gì mới ở đây. */
function MeMailExportForm({ planLike, sp, isTwo, setNote }) {
  const rows = useMemo(() => planBatchRows(planLike, sp, isTwo), [planLike, sp, isTwo]);
  // Gom rows (1 dòng/lô, xem planBatchRows) lại theo TỪNG MẺ để: (a) hiện rowSpan cho các cột dùng
  // chung cả mẻ (Mẻ pha/Tổng V/Mã hóa mẻ/Chốt hướng) — đỡ rối khi 1 mẻ có nhiều lô, và (b) tô màu
  // xen kẽ đậm/nhạt theo TỪNG MẺ (không phải theo từng lô) để dễ phân biệt ranh giới các mẻ.
  const batchGroups = useMemo(() => {
    const gs = [];
    rows.forEach((r) => {
      if (r.meSo != null) gs.push({ meSo: r.meSo, tongTheTich: r.tongTheTich, items: [r] });
      else gs[gs.length - 1].items.push(r);
    });
    return gs;
  }, [rows]);

  const [xuLyDauVao, setXuLyDauVao] = useState("Không");
  const [xuLySauPha, setXuLySauPha] = useState("Không");
  const [sauDongOng, setSauDongOng] = useState(XU_LY_SAU_DONG_ONG_OPTIONS[0]);
  const [sauDongOngCustom, setSauDongOngCustom] = useState("");
  const [quyTrinhKhac, setQuyTrinhKhac] = useState(QUY_TRINH_KHAC_OPTIONS[0]);
  const [quyTrinhKhacCustom, setQuyTrinhKhacCustom] = useState("");
  // NCV chỉ gõ mã hóa mẻ ĐẦU TIÊN — các mẻ sau tự tăng số đuôi (xem deriveSequentialCode). Mẻ nào
  // cần mã khác quy tắc tự tăng thì sửa riêng ngay trong bảng (maHoaMeByMe), giống Chốt hướng.
  const [maHoaMeBase, setMaHoaMeBase] = useState("");
  const [maHoaMeByMe, setMaHoaMeByMe] = useState({});
  // Chốt hướng: có 1 ô mặc định áp dụng cho MỌI mẻ (giống 4 ô xử lý BTP ở trên), sửa riêng ngay
  // trong bảng (cột "Chốt hướng xử lý hoàn thiện", giống cách 4 cột xử lý BTP kia đang làm) — mẻ
  // nào chưa sửa riêng (chotHuongByMe không có key) vẫn tự theo ô mặc định khi ô mặc định đổi.
  const [chotHuongDefault, setChotHuongDefault] = useState(CHOT_HUONG_OPTIONS[0]);
  const [chotHuongDefaultCustom, setChotHuongDefaultCustom] = useState("");
  const [chotHuongByMe, setChotHuongByMe] = useState({});
  // 4 trường xử lý BTP mặc định ĐỒNG BỘ theo giá trị chung ở trên cho MỌI lô — nhưng 1 vài lô có
  // thể được tách ra test ở điều kiện khác, nên vẫn cho sửa riêng từng lô (ghi đè), không phụ thuộc
  // hoàn toàn vào ô chung phía trên. Ô nào CHƯA bị sửa riêng thì vẫn tự theo ô chung khi ô chung đổi.
  const [rowOverrides, setRowOverrides] = useState({});

  const sauDongOngFinal = sauDongOng === KHAC_SENTINEL ? sauDongOngCustom : sauDongOng;
  const quyTrinhKhacFinal = quyTrinhKhac === KHAC_SENTINEL ? quyTrinhKhacCustom : quyTrinhKhac;
  const maHoaMeFor = (meSo) => maHoaMeByMe[meSo] ?? deriveMaHoaMe(maHoaMeBase, meSo);
  const maHoaMeIsOverridden = (meSo) => maHoaMeByMe[meSo] !== undefined;
  const clearMaHoaMeForMe = (meSo) => setMaHoaMeByMe((prev) => { const { [meSo]: _drop, ...rest } = prev; return rest; });
  const chotHuongDefaultFinal = chotHuongDefault === KHAC_SENTINEL ? chotHuongDefaultCustom : chotHuongDefault;
  const chotHuongFinalFor = (meSo) => chotHuongByMe[meSo] ?? chotHuongDefaultFinal;
  const chotHuongIsOverridden = (meSo) => chotHuongByMe[meSo] !== undefined;
  const clearChotHuongForMe = (meSo) => setChotHuongByMe((prev) => { const { [meSo]: _drop, ...rest } = prev; return rest; });
  const rowValue = (rowKey, field, globalValue) => rowOverrides[rowKey]?.[field] ?? globalValue;
  const setRowValue = (rowKey, field, val) => setRowOverrides((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], [field]: val } }));
  const clearRowValue = (rowKey, field) => setRowOverrides((prev) => {
    if (!prev[rowKey]) return prev;
    const { [field]: _drop, ...rest } = prev[rowKey];
    return { ...prev, [rowKey]: rest };
  });
  const isOverridden = (rowKey, field) => rowOverrides[rowKey]?.[field] !== undefined;

  const headers = ["Mẻ pha", "Tổng thể tích mẻ (L)", "Tên nguyên liệu SX", "Số lô NL", "Định lượng (CFU/ml)",
    "Thể tích dịch tồn kho (L)", "Mật độ bào tử thành phẩm (CFU/ml)", "Thể tích 1 ống (ml)",
    "Thể tích dịch pha chế dự kiến (L)", "Thể tích lấy nước (L)", "Cỡ lô (ống)",
    "Xử lý nguyên liệu đầu vào", "Xử lý BTP sau pha", "Xử lý BTP sau đóng ống", "Quy trình xử lý khác nếu có",
    "Mã hóa mẻ in trên thân ống", "Chốt hướng xử lý hoàn thiện"];

  const copyTable = async () => {
    const bodyHtmlRows = [];
    const textLines = [headers.join("\t")];
    batchGroups.forEach((g) => {
      const maHoaMe = maHoaMeFor(g.meSo);
      const chotHuong = chotHuongFinalFor(g.meSo);
      g.items.forEach((r, ri) => {
        const common = [
          tenNguyenLieuFor(r.chung, sp), r.maLo, sci(r.E), fmt(r.vRaw, 2), sci(r.d), String(sp.tubeMl),
          fmt(r.vPha, 2), fmt(r.vNuoc, 2), String(Math.round(r.soOng)),
          rowValue(r.key, "xuLyDauVao", xuLyDauVao), rowValue(r.key, "xuLySauPha", xuLySauPha),
          rowValue(r.key, "sauDongOng", sauDongOngFinal), rowValue(r.key, "quyTrinhKhac", quyTrinhKhacFinal),
        ];
        const htmlCells = [];
        if (ri === 0) {
          htmlCells.push(`<td rowspan="${g.items.length}">${g.meSo}</td>`, `<td rowspan="${g.items.length}">${fmt(g.tongTheTich, 2)}</td>`);
        }
        htmlCells.push(...common.map((c) => `<td>${c}</td>`));
        if (ri === 0) {
          htmlCells.push(`<td rowspan="${g.items.length}">${maHoaMe}</td>`, `<td rowspan="${g.items.length}">${chotHuong}</td>`);
        }
        bodyHtmlRows.push(`<tr>${htmlCells.join("")}</tr>`);
        textLines.push([ri === 0 ? String(g.meSo) : "", ri === 0 ? fmt(g.tongTheTich, 2) : "", ...common, ri === 0 ? maHoaMe : "", ri === 0 ? chotHuong : ""].join("\t"));
      });
    });
    const html = `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${bodyHtmlRows.join("")}</tbody></table>`;
    const text = textLines.join("\n");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      setNote("Đã copy bảng mẻ pha — dán vào Gmail.");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setNote("Đã copy bảng (dạng text) — dán vào Gmail.");
      } catch (err) {
        setNote(`Không copy được: ${err.message}`);
      }
    }
  };

  return (
    <div className="bg-sky-50/60 border border-t-0 border-sky-200 px-4 py-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">Xử lý nguyên liệu đầu vào</label>
          <input value={xuLyDauVao} onChange={(e) => setXuLyDauVao(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">Xử lý BTP sau pha</label>
          <input value={xuLySauPha} onChange={(e) => setXuLySauPha(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <ProcessSelect label="Xử lý BTP sau đóng ống" options={XU_LY_SAU_DONG_ONG_OPTIONS}
          value={sauDongOng} onChange={setSauDongOng} custom={sauDongOngCustom} onCustomChange={setSauDongOngCustom} />
        <ProcessSelect label="Quy trình xử lý khác nếu có" options={QUY_TRINH_KHAC_OPTIONS}
          value={quyTrinhKhac} onChange={setQuyTrinhKhac} custom={quyTrinhKhacCustom} onCustomChange={setQuyTrinhKhacCustom} />
        <ProcessSelect label="Chốt hướng xử lý hoàn thiện" options={CHOT_HUONG_OPTIONS}
          value={chotHuongDefault} onChange={setChotHuongDefault} custom={chotHuongDefaultCustom} onCustomChange={setChotHuongDefaultCustom} />
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">Mã hóa mẻ (phần đầu, không kèm "C01")</label>
          <input value={maHoaMeBase} onChange={(e) => setMaHoaMeBase(e.target.value)} placeholder="vd CB010526"
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">6 ô trên áp dụng mặc định cho mọi lô/mẻ bên dưới (riêng Mã hóa mẻ: mỗi mẻ tự nối thêm C01, C02... tới mẻ cuối) — lô/mẻ nào tách riêng test điều kiện khác thì sửa thẳng trong bảng, không ảnh hưởng các lô/mẻ còn lại.</p>

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-md">
        <table className="w-full text-[11px] whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-400 text-left"><tr>{headers.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {batchGroups.map((g, gi) => {
              const rowBg = gi % 2 === 1 ? "bg-indigo-100/70" : "bg-white";
              const maHoaMe = maHoaMeFor(g.meSo);
              return g.items.map((r, ri) => (
                <tr key={r.key} className={`border-b border-slate-200 ${rowBg} ${ri === 0 && gi > 0 ? "border-t-2 border-t-slate-400" : ""}`}>
                  {ri === 0 && <td rowSpan={g.items.length} className="px-2 py-1 font-medium align-top">{g.meSo}</td>}
                  {ri === 0 && <td rowSpan={g.items.length} className="px-2 py-1 align-top">{fmt(g.tongTheTich, 2)}</td>}
                  <td className="px-2 py-1">{tenNguyenLieuFor(r.chung, sp)}</td>
                  <td className="px-2 py-1 font-mono">{r.maLo}</td>
                  <td className="px-2 py-1">{sci(r.E)}</td>
                  <td className="px-2 py-1">{fmt(r.vRaw, 2)}</td>
                  <td className="px-2 py-1">{sci(r.d)}</td>
                  <td className="px-2 py-1">{sp.tubeMl}</td>
                  <td className="px-2 py-1">{fmt(r.vPha, 2)}</td>
                  <td className="px-2 py-1">{fmt(r.vNuoc, 2)}</td>
                  <td className="px-2 py-1">{Math.round(r.soOng)}</td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <input value={rowValue(r.key, "xuLyDauVao", xuLyDauVao)} onChange={(e) => setRowValue(r.key, "xuLyDauVao", e.target.value)}
                        className={`w-full text-[11px] border rounded px-1 py-1 ${isOverridden(r.key, "xuLyDauVao") ? "border-amber-300 bg-amber-50" : "border-slate-200"}`} />
                      {isOverridden(r.key, "xuLyDauVao") && <button onClick={() => clearRowValue(r.key, "xuLyDauVao")} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <input value={rowValue(r.key, "xuLySauPha", xuLySauPha)} onChange={(e) => setRowValue(r.key, "xuLySauPha", e.target.value)}
                        className={`w-full text-[11px] border rounded px-1 py-1 ${isOverridden(r.key, "xuLySauPha") ? "border-amber-300 bg-amber-50" : "border-slate-200"}`} />
                      {isOverridden(r.key, "xuLySauPha") && <button onClick={() => clearRowValue(r.key, "xuLySauPha")} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-start gap-0.5">
                      <RowProcessSelect options={XU_LY_SAU_DONG_ONG_OPTIONS} value={rowValue(r.key, "sauDongOng", sauDongOngFinal)}
                        onChange={(v) => setRowValue(r.key, "sauDongOng", v)} />
                      {isOverridden(r.key, "sauDongOng") && <button onClick={() => clearRowValue(r.key, "sauDongOng")} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-start gap-0.5">
                      <RowProcessSelect options={QUY_TRINH_KHAC_OPTIONS} value={rowValue(r.key, "quyTrinhKhac", quyTrinhKhacFinal)}
                        onChange={(v) => setRowValue(r.key, "quyTrinhKhac", v)} />
                      {isOverridden(r.key, "quyTrinhKhac") && <button onClick={() => clearRowValue(r.key, "quyTrinhKhac")} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                    </div>
                  </td>
                  {ri === 0 && (
                    <td rowSpan={g.items.length} className="px-1 py-1 align-top">
                      <div className="flex items-start gap-0.5">
                        <input value={maHoaMe} onChange={(e) => setMaHoaMeByMe((p) => ({ ...p, [g.meSo]: e.target.value }))}
                          className={`w-full font-mono text-[11px] border rounded px-1 py-1 ${maHoaMeIsOverridden(g.meSo) ? "border-amber-300 bg-amber-50" : "border-slate-200"}`} />
                        {maHoaMeIsOverridden(g.meSo) && <button onClick={() => clearMaHoaMeForMe(g.meSo)} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                      </div>
                    </td>
                  )}
                  {ri === 0 && (
                    <td rowSpan={g.items.length} className="px-1 py-1 align-top">
                      <div className="flex items-start gap-0.5">
                        <RowProcessSelect options={CHOT_HUONG_OPTIONS} value={chotHuongFinalFor(g.meSo)}
                          onChange={(v) => setChotHuongByMe((p) => ({ ...p, [g.meSo]: v }))} />
                        {chotHuongIsOverridden(g.meSo) && <button onClick={() => clearChotHuongForMe(g.meSo)} title="Theo mặc định" className="text-slate-400 hover:text-slate-600 shrink-0">×</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <button onClick={copyTable} className="flex items-center gap-1.5 bg-sky-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-sky-700">
        <Mail className="w-3.5 h-3.5" /> Copy bảng — dán vào mail
      </button>
    </div>
  );
}

function Row({ label, value, warn }) {
  return <div className="flex justify-between items-center py-1.5 border-b border-slate-50 text-sm"><span className="text-slate-500">{label}</span><span className={`font-medium ${warn ? "text-amber-600" : "text-slate-800"}`}>{value}</span></div>;
}

/* ---------------- Sửa tay 1 kế hoạch "Cần điều chỉnh" (NCV tự nhập lại NL/nước) ----------------
 * Nguyên tắc chốt với NCV: mật độ mẻ pha LUÔN được TÍNH RA từ công thức (CFU/V), NCV không gõ tay
 * mật độ — chỉ gõ tay 2 thứ: (a) thể tích NL (theTichRaw) của 1 lô ở 1 mẻ cụ thể, (b) thể tích lấy
 * nước của cả mẻ (water override, xem recomputeEditBatches). Khi tăng NL 1 lô ở 1 mẻ, VÀ đúng lô đó
 * đang có sẵn ở (các) mẻ khác, hệ thống tự RÚT bớt ở mẻ khác đó để tổng lượng lô này dùng trong cả
 * nhịp không đổi/không vượt quá lượng thật của chai — ưu tiên rút phần "chưa phân bổ" của chai (nếu
 * lô đó chưa dùng hết 100% F gốc) trước, hết mới rút tiếp sang mẻ khác. Muốn CHỦ ĐỘNG tách 1 phần lô
 * sang mẻ chưa hề dùng lô đó bao giờ thì dùng nút "+ Thêm lô vào mẻ" (xem EditablePlanTable) — không
 * tự động đoán mẻ đích, để NCV tự chọn rõ ràng. */

/** Tăng/giảm thể tích NL (theTichRaw) của đúng 1 lô ở đúng 1 mẻ (meSo) — MUTATE thẳng `batches` (đã
 * là bản clone riêng, gọi trong `structuredClone`d state). Nếu mẻ đích chưa có lô này (ca "+ Thêm lô
 * vào mẻ"), tự tạo entry mới với `E` truyền vào. `trueF` = dung lượng thật của cả chai (từ pool gốc)
 * — trần cứng tuyệt đối, không được để tổng vượt qua dù rút từ đâu. */
function applyLotFEdit(batches, key, maLo, meSo, newF, trueF, E) {
  newF = Math.max(0, newF);
  const entries = [];
  batches.forEach((b) => {
    let e = b[key].find((x) => x.maLo === maLo);
    if (!e && b.meSo === meSo) { e = { maLo, E, theTichRaw: 0 }; b[key].push(e); }
    if (e) entries.push({ meSo: b.meSo, entry: e });
  });
  const target = entries.find((x) => x.meSo === meSo);
  if (!target) return;
  const oldF = target.entry.theTichRaw;
  const delta = newF - oldF;
  if (delta > 1e-9) {
    const totalNow = entries.reduce((s, x) => s + x.entry.theTichRaw, 0);
    const unallocated = Math.max(0, trueF - totalNow);
    let remaining = delta - Math.min(delta, unallocated);
    for (const o of entries) {
      if (remaining <= 1e-9) break;
      if (o.meSo === meSo) continue;
      const take = Math.min(remaining, o.entry.theTichRaw);
      o.entry.theTichRaw -= take;
      remaining -= take;
    }
    target.entry.theTichRaw = newF - remaining; // phần thực sự áp dụng được (có thể ít hơn yêu cầu nếu chai không đủ)
  } else {
    target.entry.theTichRaw = newF;
  }
}

/** Tính lại V (thể tích lấy nước + NL = tổng V mẻ) và mật độ từ đúng CFU thực tế sau khi sửa tay —
 * KHÔNG BAO GIỜ để NCV gõ tay mật độ trực tiếp. Mặc định V = mức "vừa khít đích" (mật độ đúng bằng
 * đích cho luồng giới hạn hơn) — nếu mẻ có `_waterOverride` (NCV tự gõ tay nước) thì tôn trọng, kẹp
 * trong [tổng NL thô, mức vừa khít đích] (không cho phép mật độ tụt dưới đích — luật cứng không đổi
 * dù đang ở chế độ sửa tay). Cũng dọn các lô bị kéo về ~0 (NCV đã "cho hết" sang mẻ khác) khỏi mẻ.*/
function recomputeEditBatches(batches, isTwo, gA, gB, tankMaxL) {
  batches.forEach((b) => {
    if (isTwo) {
      b.subtilis = b.subtilis.filter((e) => e.theTichRaw > 1e-6);
      b.clausii = b.clausii.filter((e) => e.theTichRaw > 1e-6);
      const cfuA = b.subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
      const cfuB = b.clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
      const vCapA = cfuA > 1e-6 ? cfuA / (1000 * gA) : Infinity;
      const vCapB = cfuB > 1e-6 ? cfuB / (1000 * gB) : Infinity;
      const natural = cfuA <= 1e-6 && cfuB <= 1e-6 ? 0 : Math.min(vCapA, vCapB, tankMaxL);
      const sumRaw = [...b.subtilis, ...b.clausii].reduce((s, e) => s + e.theTichRaw, 0);
      b.tongTheTich = b._waterOverride != null ? clampNum(b._waterOverride, sumRaw, natural) : natural;
    } else {
      b.lots = b.lots.filter((e) => e.theTichRaw > 1e-6);
      const cfu = b.lots.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
      const natural = cfu > 1e-6 ? Math.min(cfu / (1000 * gA), tankMaxL) : 0;
      const sumRaw = b.lots.reduce((s, e) => s + e.theTichRaw, 0);
      b.tongTheTich = b._waterOverride != null ? clampNum(b._waterOverride, sumRaw, natural) : natural;
    }
  });
}

/* ---------------- Chuyển NL sang "Chờ SX" khi 1 kế hoạch mẻ pha được DUYỆT ----------------
 * Lô ĐÃ dùng ĐÚNG HẾT phần còn lại thật của nó (so với v_dich hiện có trong kho, có thể đã bị mẻ
 * TRƯỚC đó trong CÙNG kế hoạch này gặm bớt — xem `remaining`) -> chuyển THẲNG cả record đó sang Chờ
 * SX, không tách. Lô dùng DỞ (còn dư sau mẻ này) -> TÁCH làm 2: phần dùng cho mẻ này thành 1 record
 * MỚI (so_lo mới, Chờ SX); phần còn lại GIỮ NGUYÊN record gốc (chỉ giảm v_dich), vẫn Chờ pha để các
 * kế hoạch/mẻ SAU tính tiếp — đây chính là cơ chế tránh "đã lên lệnh SX rồi mà người khác không biết
 * lại tính trùng vào kế hoạch khác" NCV yêu cầu: 1 khi đã chuyển Chờ SX, `statusOf` không còn trả về
 * "cho-pha" nữa nên các hàm `poolLots`/`poolMatch` (đều lọc theo status "cho-pha") tự động loại nó ra
 * khỏi mọi tính toán kế hoạch SAU, không cần thêm cờ nào khác. */
async function applyPlanApprovalToMaterials({ batches, isTwo, maSP, planId, materials, actorId }) {
  const byLo = Object.fromEntries(materials.map((r) => [r.soLo, r]));
  const remaining = {}; // so_lo -> số lít CÒN LẠI thật, giảm dần khi các mẻ lần lượt "gặm" trong kế hoạch này
  const updateMap = new Map(); // id -> patch gộp (1 lô có thể bị nhiều mẻ trong CÙNG kế hoạch đụng tới)
  const inserts = [];
  const nowIso = new Date().toISOString();

  const streamsOf = (b) => (isTwo ? [...b.subtilis, ...b.clausii] : b.lots);
  for (const b of batches) {
    for (const entry of streamsOf(b)) {
      const original = byLo[entry.maLo];
      if (!original) continue; // lô lạ (không nên xảy ra) — bỏ qua an toàn, không phá cả kế hoạch.
      if (remaining[entry.maLo] === undefined) remaining[entry.maLo] = original.vDich ?? 0;
      const takeF = entry.theTichRaw;
      const left = remaining[entry.maLo];
      if (takeF >= left - 1e-6) {
        updateMap.set(original.id, {
          ...(updateMap.get(original.id) || {}),
          choSX: true, choSxAt: nowIso, mixPlanId: planId, mixPlanMeSo: b.meSo, phaProduct: maSP,
        });
        remaining[entry.maLo] = 0;
      } else {
        // CHỈ copy đúng field mô tả lô (không spread nguyên `original`) — spread nguyên object sẽ
        // kéo theo CẢ field lifecycle/audit (deletedAt, updatedBy, phaMe cũ...) dưới dạng `undefined`
        // cho MỌI field mà cột thật trên Supabase KHÔNG TỒN TẠI (vd `deleted_at` — có trong schema.sql
        // nhưng chưa từng tạo thật trên DB của NCV, lệch sẵn từ trước) — key vẫn tồn tại trong object
        // JS (giá trị undefined) nên `insertMaterialsBulk` vẫn gửi lên, PostgREST báo "column not
        // found" dù giá trị rỗng. Copy tay đúng field cần thiết để tránh hẳn lớp lỗi này.
        const {
          strain, stt, tenNL, chung, dotSanXuat, thoiGianThu, lo, chai, loChung,
          camQuan, pH, mdNhan, mdSH, tyLeBaoTu, nhiemKhuan, nhiemConNao, tinhTrangSrc, ghiChu, meChe, loai, phInvalid,
        } = original;
        inserts.push({
          strain, stt, tenNL, chung, dotSanXuat, thoiGianThu, lo, chai, loChung,
          camQuan, pH, mdNhan, mdSH, tyLeBaoTu, nhiemKhuan, nhiemConNao, tinhTrangSrc, ghiChu, meChe, loai, phInvalid,
          soLo: `${entry.maLo}-P${planId}M${b.meSo}`, vDich: takeF,
          choSX: true, choSxAt: nowIso, mixPlanId: planId, mixPlanMeSo: b.meSo, phaProduct: maSP, createdBy: actorId,
        });
        remaining[entry.maLo] = left - takeF;
        updateMap.set(original.id, { ...(updateMap.get(original.id) || {}), vDich: remaining[entry.maLo] });
      }
    }
  }

  await Promise.all([...updateMap.entries()].map(([id, patch]) => updateMaterialFields(id, patch, actorId)));
  if (inserts.length) await insertMaterialsBulk(inserts);
}

/** 1 bản nháp "Cần điều chỉnh" ghi lại các mã lô NL + lượng cần dùng tại THỜI ĐIỂM LƯU — nhưng NL đó
 * vẫn đang "Chờ pha" (chưa khoá riêng cho bản nháp này), nên có thể bị 1 kế hoạch KHÁC dùng mất
 * (chuyển Chờ SX/Đã pha, hoặc chỉ dùng bớt) trong lúc bản nháp này nằm chờ chưa ai xử lý tiếp.
 * "cho-sx": lô đã có kế hoạch KHÁC dùng (đã lên lịch pha nhưng chưa pha thật) — không phải lỗi, chỉ
 * là thông tin, nhưng vẫn KHÔNG cho Sửa tiếp (số liệu bản nháp đã cũ, sửa có thể tính nhầm sang đúng
 * phần NL đã bị dùng đó mà không báo lỗi gì). "stale": lô không còn tồn tại, đã "Đã pha", hoặc thể
 * tích còn lại không đủ so với lượng bản nháp cần — bắt buộc xoá.
 * So khớp theo LÔ GỐC (bỏ hậu tố tách `-P<planId>M<mẻ>`), KHÔNG theo đúng tên maLo — vì lô có thể đã
 * được "Bỏ mẻ" gộp lại (xem revertChoSXGroup) từ nhiều mảnh về 1 dòng kể từ lúc bản nháp này lưu,
 * nên tra đúng tên mảnh cũ sẽ không tìm thấy (báo nhầm "stale" dù NL vẫn còn đủ, chỉ khác dòng —
 * bug thật gặp 2026-07-30, NCV chỉ ra "Chờ SX" trống thì sao lại báo NL đã dùng mất). */
function draftLotState(row, materials) {
  const kq = row.ketQua;
  if (!kq?.batches) return "ok";
  const isTwo = kq._kind === "two";
  const streamsOf = (b) => (isTwo ? [...b.subtilis, ...b.clausii] : b.lots);
  const needed = {};
  for (const b of kq.batches) {
    for (const e of streamsOf(b)) needed[e.maLo] = (needed[e.maLo] || 0) + e.theTichRaw;
  }
  const baseOf = (soLo) => soLo.replace(/-P\d+M\d+$/, "");
  const neededByBase = {};
  for (const [maLo, v] of Object.entries(needed)) {
    const base = baseOf(maLo);
    neededByBase[base] = (neededByBase[base] || 0) + v;
  }
  const choPhaByBase = {};
  const choSxByBase = {};
  for (const m of materials) {
    const base = baseOf(m.soLo);
    if (!(base in neededByBase)) continue;
    const st = statusOf(m).status;
    if (st === "cho-pha") choPhaByBase[base] = (choPhaByBase[base] || 0) + (m.vDich || 0);
    else if (st === "cho-sx") choSxByBase[base] = (choSxByBase[base] || 0) + (m.vDich || 0);
  }
  let choSx = false;
  for (const [base, need] of Object.entries(neededByBase)) {
    const availChoPha = choPhaByBase[base] || 0;
    if (availChoPha >= need - 1e-6) continue;
    const availWithChoSx = availChoPha + (choSxByBase[base] || 0);
    if (availWithChoSx >= need - 1e-6) { choSx = true; continue; }
    // Thiếu ngay cả khi tính thêm phần đang Chờ SX -> đã pha thật (hoặc mất hẳn/không đủ vì lý do
    // khác) — báo đỏ "đã pha" để NCV biết chắc phải xoá, phân biệt với "cam" (chỉ đang chờ, chưa
    // pha thật) — chốt với NCV 2026-07-30.
    return "da-pha";
  }
  return choSx ? "cho-sx" : "ok";
}

/* ---------------- Pha chế SX (tự động theo thuật toán, xem trước + duyệt) ---------------- */
function MixPlanPanel({ materials, products, actorId, setNote, reload, canEdit, canPreview, role, userLabel }) {
  const [maSP, setMaSP] = useState(products[0]?.maSP || "");
  const sp = products.find((p) => p.maSP === maSP) || products[0];
  // Cảnh báo va chạm chỉ áp dụng cho RD (người thật sự tạo kế hoạch pha) — admin/kh/qc/qa xem không
  // cần cảnh báo này. Kênh presence riêng theo từng SP để không báo nhầm khi 2 RD đang làm 2 SP khác
  // nhau.
  const presenceLabel = userLabel ? `${userLabel} (${role})` : null;
  const others = usePresence(role === "rd" && sp ? `ke-hoach-rd:${sp.maSP}` : null, actorId, presenceLabel);
  // Số ống cần cho nhịp này KHÔNG tự điền theo mặc định của sản phẩm (khác Hàm lượng đích) —
  // giá trị này đổi theo từng nhịp pha thực tế, tự điền sẵn chỉ khiến NCV phải xoá đi trước
  // khi gõ số thật (chốt với NCV 2026-09).
  const [nInput, setNInput] = useState("");
  const [gInput, setGInput] = useState(sp?.hamLuong ? String(sp.hamLuong) : "");
  const [gInput2, setGInput2] = useState(sp?.hamLuong2 ? String(sp.hamLuong2) : "");
  // "Pha tròn chai NL" — chỉ áp dụng SP 1 thành phần (chốt NCV 2026-08-10): mỗi lô = đúng 1 mẻ
  // riêng, không ghép nhiều lô vào 1 mẻ (xem packWholeBottleBatches trong mixPlanner.js).
  const [wholeBottleOnly, setWholeBottleOnly] = useState(false);
  const [plan, setPlan] = useState(null);
  const [batchOverrides, setBatchOverrides] = useState({}); // { [meSo]: V (L) do NCV tự chọn nới trần mẻ đó }
  // { [meSo]: true|false } — NCV tự ép có/không cần tiệt trùng trước mẻ đó, ghi đè quy tắc tự động
  // 3-lô-sản-xuất (xem computeSterilizeFlags). Không có key = dùng đúng quy tắc tự động.
  const [sterilizeOverrides, setSterilizeOverrides] = useState({});
  const [ghiChu, setGhiChu] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Đang sửa tay 1 dòng lịch sử "Cần điều chỉnh": editingPlan = đúng dòng lịch sử gốc (có id, ketQua
  // cũ...); editBatches = bản nháp batches đang chỉnh (structuredClone riêng, không đụng tới bản gốc
  // cho tới khi bấm lưu); editHistoryStack = ngăn xếp undo (mỗi lần sửa đẩy 1 bản trước đó vào đây).
  const [editingPlan, setEditingPlan] = useState(null);
  const [editBatches, setEditBatches] = useState(null);
  const [editHistoryStack, setEditHistoryStack] = useState([]);
  const [editGhiChu, setEditGhiChu] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  // Tiệt trùng chỉ là cờ hiển thị (không đổi số liệu mẻ) — giữ RIÊNG cho màn Sửa tay, không dùng
  // chung `sterilizeOverrides` của màn tính tự động (2 kế hoạch độc lập, mốc mẻ có thể lệch nhau).
  const [editSterilizeOverrides, setEditSterilizeOverrides] = useState({});
  // "AI rà soát" — chỉ chạy khi NCV chủ động bấm, AI chỉ diễn giải kết quả đã tính sẵn (không tự
  // tính lại) để tránh rủi ro AI tính sai số học rồi tự đưa cảnh báo sai gây hoang mang.
  const [aiReview, setAiReview] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    setNInput("");
    setGInput(sp?.hamLuong ? String(sp.hamLuong) : "");
    setGInput2(sp?.hamLuong2 ? String(sp.hamLuong2) : "");
    setWholeBottleOnly(false);
    setPlan(null);
    setBatchOverrides({});
    setSterilizeOverrides({});
    setAiReview(null);
    setAiError("");
  }, [maSP]);

  // Đảo thứ tự thực hiện 2 mẻ liền kề (dir = -1 lên trước / +1 xuống sau) — nội dung/lượng NL từng
  // mẻ giữ nguyên, chỉ đổi THỨ TỰ pha (không ảnh hưởng tổng số ống/mật độ). Đánh số lại meSo tuần
  // tự 1..N theo đúng thứ tự mới. Reset batchOverrides/sterilizeOverrides vì chúng gắn theo đúng
  // đúng vị trí mẻ số mấy — đổi thứ tự thì các mốc đó không còn ý nghĩa cũ, để NCV chọn lại cho hợp
  // với thứ tự mới, tránh áp nhầm mốc của mẻ cũ sang mẻ mới đứng ở đúng số đó.
  const moveBatch = (meSo, dir) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const idx = meSo - 1;
      const otherIdx = idx + dir;
      if (otherIdx < 0 || otherIdx >= prev.batches.length) return prev;
      const batches = [...prev.batches];
      [batches[idx], batches[otherIdx]] = [batches[otherIdx], batches[idx]];
      batches.forEach((b, i) => { b.meSo = i + 1; });
      return { ...prev, batches };
    });
    setBatchOverrides({});
    setSterilizeOverrides({});
  };

  const toggleSterilize = (meSo, value) => {
    setSterilizeOverrides((prev) => {
      if (value === undefined) { const { [meSo]: _drop, ...rest } = prev; return rest; }
      return { ...prev, [meSo]: value };
    });
  };

  const loadHistory = useCallback(async () => {
    if (!sp) return;
    setLoadingHistory(true);
    try { setHistory(await fetchMixPlans(sp.maSP)); }
    catch (err) { setNote(`Lỗi tải lịch sử kế hoạch: ${err.message}`); }
    finally { setLoadingHistory(false); }
  }, [sp?.maSP]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const poolLotsRaw = (pool) => materials
    .filter((r) => {
      const st = statusOf(r);
      if (st.status !== "cho-pha" || r.mdSH == null || !r.vDich) return false;
      if (pool === "subtilis") return r.strain === "subtilis";
      if (pool === "clausii-loai1") return r.strain === "clausii" && st.loai === 1;
      if (pool === "clausii-loai2") return r.strain === "clausii" && st.loai === 2;
      return false;
    })
    .map((r) => ({ maLo: r.soLo, E: r.mdSH * 1e10, F: r.vDich, loSanXuat: r.lo, thoiGianThu: r.thoiGianThu }));
  const OTHER_LOAI = { "clausii-loai1": "clausii-loai2", "clausii-loai2": "clausii-loai1" };
  // allowOther: gộp thêm loại NL còn lại làm dự phòng (priority=1, chỉ đụng tới khi loại chính
  // priority=0 không đủ) — vd Progermila ưu tiên loại 1 nhưng vẫn dùng được loại 2 khi cần.
  const poolLots = (pool, allowOther) => {
    const primary = poolLotsRaw(pool).map((l) => ({ ...l, priority: 0 }));
    if (!allowOther || !OTHER_LOAI[pool]) return primary;
    const fallback = poolLotsRaw(OTHER_LOAI[pool]).map((l) => ({ ...l, priority: 1 }));
    return [...primary, ...fallback];
  };

  const tinhKeHoach = () => {
    if (!sp) return;
    const N = num(nInput);
    if (!N || N <= 0) { setNote("Nhập số ống cần cho nhịp này trước đã."); return; }
    const G1 = num(gInput);
    if (!G1 || G1 <= 0) { setNote("Nhập hàm lượng đích (thành phần 1) trước đã."); return; }
    let result;
    if (sp.pool2) {
      const G2 = num(gInput2);
      if (!G2 || G2 <= 0) { setNote("Nhập hàm lượng đích (thành phần 2) trước đã."); return; }
      const subFirst = sp.pool === "subtilis";
      const subtilisLots = poolLots(subFirst ? sp.pool : sp.pool2, sp.allowOtherLoai);
      const clausiiLots = poolLots(subFirst ? sp.pool2 : sp.pool, sp.allowOtherLoai);
      const gSubtilis = subFirst ? G1 : G2;
      const gClausii = subFirst ? G2 : G1;
      result = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H: sp.tubeMl, gSubtilis, gClausii } });
      result._kind = "two";
      result._gSubtilis = gSubtilis;
      result._gClausii = gClausii;
      // Giữ lại pool gốc (có F thật của cả chai) để hiển thị bảng "còn tồn" theo từng lô.
      result._subtilisPool = subtilisLots;
      result._clausiiPool = clausiiLots;
    } else {
      const lots = poolLots(sp.pool, sp.allowOtherLoai);
      result = planSingleComponent({ lots, product: { N, G: G1, H: sp.tubeMl }, wholeBottleOnly });
      result._kind = "single";
      result._G = G1;
      result._lotsPool = lots;
    }
    result._N = N;
    setPlan(result);
    setBatchOverrides({});
    setGhiChu("");
    setAiReview(null);
    setAiError("");
  };

  // Gom dữ liệu kế hoạch đã tính sẵn thành 1 JSON gọn để gửi AI diễn giải — không gửi nguyên `plan`
  // (có kèm _lotsPool/_subtilisPool/_clausiiPool là toàn bộ tồn kho, không cần thiết và làm prompt
  // phình to vô ích).
  const buildPlanSummary = () => {
    if (!plan || !plan.feasible) return null;
    const isTwo = plan._kind === "two";
    const summary = {
      maSP: sp.maSP, tenSP: sp.tenSP, tubeMl: sp.tubeMl, N: plan._N, T: plan.T, kind: plan._kind,
    };
    if (isTwo) {
      summary.gSubtilis = plan._gSubtilis;
      summary.gClausii = plan._gClausii;
      summary.dSubtilis = plan.dSubtilis;
      summary.dClausii = plan.dClausii;
      if (plan.subtilisShortfallLot) summary.subtilisShortfallLot = plan.subtilisShortfallLot;
      summary.batches = plan.batches.map((b) => ({
        meSo: b.meSo, tongTheTich: b.tongTheTich,
        subtilis: b.subtilis.map((x) => ({ maLo: x.maLo, E: x.E, theTichRaw: x.theTichRaw })),
        clausii: b.clausii.map((x) => ({ maLo: x.maLo, E: x.E, theTichRaw: x.theTichRaw })),
      }));
    } else {
      summary.G = plan._G;
      summary.d = plan.d;
      summary.batches = plan.batches.map((b) => ({
        meSo: b.meSo, tongTheTich: b.tongTheTich,
        lots: b.lots.map((x) => ({ maLo: x.maLo, E: x.E, theTichRaw: x.theTichRaw, theTichDich: x.theTichDich, soOng: x.soOng })),
      }));
    }
    return summary;
  };

  const runAiReview = async () => {
    const summary = buildPlanSummary();
    if (!summary) return;
    setAiLoading(true);
    setAiError("");
    try {
      setAiReview(await reviewMixPlanWithAi(summary));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  // Áp lượng nới trần NCV tự chọn (nếu có) vào bản kế hoạch trước khi lưu — để hồ sơ lưu đúng
  // với ngưỡng NCV đã thực sự chốt, không phải mốc mặc định 1080L an toàn của thuật toán.
  const applyOverrides = (p) => {
    if (!Object.keys(batchOverrides).length) return p;
    return { ...p, batches: p.batches.map((b) => (b.meSo in batchOverrides ? { ...b, tongTheTich: batchOverrides[b.meSo] } : b)) };
  };

  const decide = async (trangThai) => {
    if (!plan) return;
    setSaving(true);
    try {
      const saved = await saveMixPlanDecision({ maSP: sp.maSP, soOngMucTieu: plan._N, ketQua: applyOverrides(plan), trangThai, ghiChu, actorId });
      if (trangThai === "duyet") {
        await applyPlanApprovalToMaterials({ batches: applyOverrides(plan).batches, isTwo: plan._kind === "two", maSP: sp.maSP, planId: saved.id, materials, actorId });
        await reload(); // không chỉ dựa vào realtime — đảm bảo tab "Chờ SX" thấy ngay NL vừa chuyển.
      }
      setNote(
        trangThai === "duyet" ? "Đã lưu kế hoạch — DUYỆT. NL liên quan đã chuyển sang Chờ SX."
        : trangThai === "khong_duyet" ? "Đã lưu kế hoạch — KHÔNG DUYỆT."
        : "Đã lưu kế hoạch — cần điều chỉnh."
      );
      setGhiChu("");
      loadHistory();
    } catch (err) { setNote(`Lỗi lưu kế hoạch: ${err.message}`); }
    finally { setSaving(false); }
  };

  // ---- Sửa tay 1 dòng lịch sử “Cần điều chỉnh” ----
  const editIsTwo = editingPlan?.ketQua?._kind === "two";
  const startEditPlan = (row) => {
    setEditingPlan(row);
    setEditBatches(structuredClone(row.ketQua.batches));
    setEditHistoryStack([]);
    setEditGhiChu("");
    setEditSterilizeOverrides({});
  };
  const cancelEditPlan = () => {
    setEditingPlan(null);
    setEditBatches(null);
    setEditHistoryStack([]);
    setEditSterilizeOverrides({});
  };
  const pushEditUndo = () => setEditHistoryStack((h) => [...h, structuredClone(editBatches)]);
  const undoEdit = () => {
    if (!editHistoryStack.length) return;
    setEditBatches(editHistoryStack[editHistoryStack.length - 1]);
    setEditHistoryStack((h) => h.slice(0, -1));
  };
  const resetEditToOriginal = () => {
    pushEditUndo();
    setEditBatches(structuredClone(editingPlan.ketQua.batches));
  };
  const editPoolByMaLo = (chung) => {
    const pool = editIsTwo
      ? (chung === "subtilis" ? editingPlan.ketQua._subtilisPool : editingPlan.ketQua._clausiiPool)
      : editingPlan.ketQua._lotsPool;
    return Object.fromEntries((pool || []).map((l) => [l.maLo, l]));
  };
  const gAOf = () => (editIsTwo ? editingPlan.ketQua._gSubtilis : editingPlan.ketQua._G);
  const gBOf = () => (editIsTwo ? editingPlan.ketQua._gClausii : null);
  const editSetLotF = (chung, maLo, meSo, newF) => {
    const key = editIsTwo ? chung : "lots";
    const trueF = editPoolByMaLo(chung)[maLo]?.F ?? Infinity;
    pushEditUndo();
    setEditBatches((prev) => {
      const next = structuredClone(prev);
      applyLotFEdit(next, key, maLo, meSo, newF, trueF);
      recomputeEditBatches(next, editIsTwo, gAOf(), gBOf(), TANK_MAX_L);
      return next;
    });
  };
  const editAddLotToBatch = (chung, maLo, meSo, amount) => {
    const key = editIsTwo ? chung : "lots";
    const poolEntry = editPoolByMaLo(chung)[maLo];
    if (!poolEntry || !(amount > 0)) return;
    pushEditUndo();
    setEditBatches((prev) => {
      const next = structuredClone(prev);
      const b = next.find((x) => x.meSo === meSo);
      const existing = b?.[key]?.find((x) => x.maLo === maLo);
      const currentF = existing?.theTichRaw || 0;
      applyLotFEdit(next, key, maLo, meSo, currentF + amount, poolEntry.F, poolEntry.E);
      recomputeEditBatches(next, editIsTwo, gAOf(), gBOf(), TANK_MAX_L);
      return next;
    });
  };
  const editSetWater = (meSo, v) => {
    pushEditUndo();
    setEditBatches((prev) => {
      const next = structuredClone(prev);
      const b = next.find((x) => x.meSo === meSo);
      if (b) b._waterOverride = v;
      recomputeEditBatches(next, editIsTwo, gAOf(), gBOf(), TANK_MAX_L);
      return next;
    });
  };
  const editRemoveBatch = (meSo) => {
    pushEditUndo();
    setEditBatches((prev) => {
      const next = structuredClone(prev).filter((b) => b.meSo !== meSo);
      next.forEach((b, i) => { b.meSo = i + 1; });
      recomputeEditBatches(next, editIsTwo, gAOf(), gBOf(), TANK_MAX_L);
      return next;
    });
  };
  // Đảo thứ tự pha 2 mẻ liền kề — y hệt `moveBatch` bên màn tính tự động, chỉ khác là thao tác trên
  // `editBatches` (có undo) và reset `editSterilizeOverrides` vì mốc tiệt trùng gắn theo đúng vị trí
  // mẻ số mấy, đổi thứ tự thì mốc cũ không còn ý nghĩa.
  const editMoveBatch = (meSo, dir) => {
    const idx = meSo - 1;
    const otherIdx = idx + dir;
    if (otherIdx < 0 || otherIdx >= editBatches.length) return;
    pushEditUndo();
    setEditBatches((prev) => {
      const next = structuredClone(prev);
      [next[idx], next[otherIdx]] = [next[otherIdx], next[idx]];
      next.forEach((b, i) => { b.meSo = i + 1; });
      return next;
    });
    setEditSterilizeOverrides({});
  };
  const editToggleSterilize = (meSo, value) => {
    setEditSterilizeOverrides((prev) => {
      if (value === undefined) { const { [meSo]: _drop, ...rest } = prev; return rest; }
      return { ...prev, [meSo]: value };
    });
  };
  const saveEditedPlan = async (trangThai) => {
    setEditSaving(true);
    try {
      const totalV = editBatches.reduce((s, b) => s + b.tongTheTich, 0);
      const T = Math.floor((totalV * 1000) / sp.tubeMl);
      let extra = { T, totalV };
      if (editIsTwo) {
        const cfuA = editBatches.reduce((s, b) => s + b.subtilis.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
        const cfuB = editBatches.reduce((s, b) => s + b.clausii.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
        const dSubtilis = totalV > 0 ? cfuA / (1000 * totalV) : editingPlan.ketQua._gSubtilis;
        const dClausii = totalV > 0 ? cfuB / (1000 * totalV) : editingPlan.ketQua._gClausii;
        const mb = (cfuIn, d) => { const totalOut = T * d * sp.tubeMl; const diffPct = cfuIn > 0 ? (Math.abs(cfuIn - totalOut) / cfuIn) * 100 : 0; return { totalIn: cfuIn, totalOut, diffPct, pass: diffPct < 1 }; };
        extra = { ...extra, dSubtilis, dClausii, massBalanceSubtilis: mb(cfuA, dSubtilis), massBalanceClausii: mb(cfuB, dClausii) };
      } else {
        const cfu = editBatches.reduce((s, b) => s + b.lots.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
        const d = totalV > 0 ? cfu / (1000 * totalV) : editingPlan.ketQua._G;
        const totalOut = T * d * sp.tubeMl;
        const diffPct = cfu > 0 ? (Math.abs(cfu - totalOut) / cfu) * 100 : 0;
        extra = { ...extra, d, massBalance: { totalIn: cfu, totalOut, diffPct, pass: diffPct < 1 } };
      }
      const newKetQua = { ...editingPlan.ketQua, batches: editBatches, ...extra };
      const saved = await saveEditedMixPlanDecision({ originalId: editingPlan.id, maSP: sp.maSP, soOngMucTieu: editingPlan.soOngMucTieu, ketQua: newKetQua, trangThai, ghiChu: editGhiChu, actorId });
      if (trangThai === "duyet") {
        await applyPlanApprovalToMaterials({ batches: editBatches, isTwo: editIsTwo, maSP: sp.maSP, planId: saved.id, materials, actorId });
        await reload(); // không chỉ dựa vào realtime — đảm bảo tab "Chờ SX" thấy ngay NL vừa chuyển.
      }
      setNote(
        trangThai === "duyet" ? "Đã lưu bản sửa — DUYỆT. NL liên quan đã chuyển sang Chờ SX."
        : trangThai === "khong_duyet" ? "Đã lưu bản sửa — KHÔNG DUYỆT."
        : "Đã lưu bản sửa — cần điều chỉnh tiếp."
      );
      cancelEditPlan();
      loadHistory();
    } catch (err) { setNote(`Lỗi lưu bản sửa: ${err.message}`); }
    finally { setEditSaving(false); }
  };
  const deleteHistoryRow = async (row) => {
    if (!window.confirm(`Xoá vĩnh viễn dòng lịch sử lúc ${new Date(row.createdAt).toLocaleString("vi-VN")}? Không thể hoàn tác.`)) return;
    try {
      await removeMixPlan(row.id);
      setNote("Đã xoá dòng lịch sử kế hoạch.");
      loadHistory();
    } catch (err) { setNote(`Lỗi xoá: ${err.message}`); }
  };

  if (!sp) return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Chưa có sản phẩm nào — thêm ở tab "Sản phẩm".</div>;

  if (editingPlan) {
    return (
      <EditablePlanPanel
        sp={sp}
        editingPlan={editingPlan}
        batches={editBatches}
        isTwo={editIsTwo}
        canUndo={editHistoryStack.length > 0}
        ghiChu={editGhiChu}
        onGhiChuChange={setEditGhiChu}
        saving={editSaving}
        onSetLotF={editSetLotF}
        onAddLot={editAddLotToBatch}
        onSetWater={editSetWater}
        onRemoveBatch={editRemoveBatch}
        onReorder={editMoveBatch}
        sterilizeOverrides={editSterilizeOverrides}
        onSterilizeToggle={editToggleSterilize}
        onUndo={undoEdit}
        onReset={resetEditToOriginal}
        onCancel={cancelEditPlan}
        onSave={saveEditedPlan}
      />
    );
  }

  return (
    <div className="space-y-4">
      {others.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Đang có người khác cũng tạo kế hoạch pha cho "{sp.tenSP}": <b>{others.join(", ")}</b> — hỏi trước khi Duyệt để tránh trùng nhau.</span>
        </div>
      )}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">Sản phẩm</label>
            <select value={maSP} onChange={(e) => setMaSP(e.target.value)} className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm min-w-[220px]">
              {products.map((p) => <option key={p.maSP} value={p.maSP}>{p.maSP} – {p.tenSP}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Số ống cần cho nhịp này</label>
            <GroupedIntInput value={nInput} onChange={setNInput} placeholder="vd 120.000"
              className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-40" />
          </div>
          <div>
            {/* Ô cho gõ tự do (kể cả dạng khoa học "4e8") nên không chấm hàng nghìn trong ô được —
                thay vào đó chêm dạng đọc-hiểu (4,2×10⁸) ngay vào label, cập nhật live theo giá trị
                đang gõ, đỡ phải thêm hẳn 1 dòng riêng bên dưới. */}
            <label className="text-xs text-slate-500">
              Hàm lượng đích{sp.pool2 ? ` – ${POOL_LABEL[sp.pool]}` : ""} ({sciVN(num(gInput)) ? `${sciVN(num(gInput))} ` : ""}cfu/ml)
            </label>
            <input value={gInput} onChange={(e) => setGInput(e.target.value)} placeholder="vd 4e8"
              className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-36" />
          </div>
          {sp.pool2 && (
            <div>
              <label className="text-xs text-slate-500">
                Hàm lượng đích – {POOL_LABEL[sp.pool2]} ({sciVN(num(gInput2)) ? `${sciVN(num(gInput2))} ` : ""}cfu/ml)
              </label>
              <input value={gInput2} onChange={(e) => setGInput2(e.target.value)} placeholder="vd 4e8"
                className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-36" />
            </div>
          )}
          {!sp.pool2 && (
            <label className="flex items-center gap-2 text-sm text-slate-600 pb-2" title="Mỗi lô NL tự thành 1 mẻ riêng, không ghép nhiều lô vào 1 mẻ">
              <input type="checkbox" checked={wholeBottleOnly} onChange={(e) => setWholeBottleOnly(e.target.checked)}
                className="accent-emerald-600" />
              Pha tròn chai NL (không ghép mẻ)
            </label>
          )}
          <button onClick={tinhKeHoach} disabled={!canPreview} title={!canPreview ? "Tài khoản của bạn không có quyền tính kế hoạch pha chế" : undefined}
            className="flex items-center gap-2 bg-emerald-600 text-white text-sm px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40">
            <Calculator className="w-4 h-4" /> Tính kế hoạch
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          {sp.pool2 ? (
            <span>SP 2 thành phần: <b className="text-slate-700">{POOL_LABEL[sp.pool]}</b> + <b className="text-slate-700">{POOL_LABEL[sp.pool2]}</b></span>
          ) : (
            <span>Nguồn NL: <b className="text-slate-700">{POOL_LABEL[sp.pool]}</b></span>
          )}
          <span>Ống: <b className="text-slate-700">{sp.tubeMl} ml</b></span>
          <span className="text-slate-400">(hàm lượng mặc định theo tab “Sản phẩm”, có thể sửa lại ở trên riêng cho nhịp này)</span>
        </div>
      </div>

      {plan && !plan.feasible && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start gap-2 text-sm text-rose-700">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Không lập được kế hoạch khả thi</div>
            <p className="mt-1">{plan.reason}</p>
          </div>
        </div>
      )}

      {plan && plan.feasible && (
        <MixPlanResult
          plan={plan}
          sp={sp}
          batchOverrides={batchOverrides}
          onOverrideChange={canEdit ? (meSo, v) => setBatchOverrides((prev) => (v == null ? Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) !== meSo)) : { ...prev, [meSo]: v })) : undefined}
          sterilizeOverrides={sterilizeOverrides}
          onSterilizeToggle={canEdit ? toggleSterilize : undefined}
          onReorder={canEdit ? moveBatch : undefined}
        />
      )}

      {plan && plan.feasible && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <button disabled={aiLoading || !canEdit} onClick={runAiReview} title={!canEdit ? "Tài khoản của bạn không có quyền dùng tính năng này" : undefined}
              className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiLoading ? "Đang rà soát..." : "AI rà soát"}
            </button>
            <span className="text-[11px] text-slate-400">AI chỉ diễn giải kết quả đã tính sẵn, không tự tính lại.</span>
          </div>
          {aiError && <p className="mt-2 text-xs text-rose-600">Lỗi: {aiError}</p>}
          {aiReview && (
            <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm text-slate-700 whitespace-pre-wrap">
              {aiReview}
            </div>
          )}
        </div>
      )}

      {plan && plan.feasible && canEdit && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-sm mb-2">Quyết định của NCV</h3>
          <textarea value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Ghi chú (không bắt buộc)"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" rows={2} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={saving} onClick={() => decide("duyet")} className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40">
              <CheckCircle2 className="w-4 h-4" /> Duyệt
            </button>
            <button disabled={saving} onClick={() => decide("dieu_chinh")} className="flex items-center gap-1.5 bg-amber-500 text-white text-sm px-4 py-2 rounded-md hover:bg-amber-600 disabled:opacity-40">
              <HelpCircle className="w-4 h-4" /> Cần điều chỉnh
            </button>
            <button disabled={saving} onClick={() => decide("khong_duyet")} className="flex items-center gap-1.5 bg-rose-600 text-white text-sm px-4 py-2 rounded-md hover:bg-rose-700 disabled:opacity-40">
              <XCircle className="w-4 h-4" /> Không duyệt
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Đây là màn hình xem trước + ghi log duyệt — chưa tự động đánh dấu “Đã pha”. Sau khi duyệt, thao tác pha thật vẫn thực hiện ở tab “Pha chế” như trước, theo đúng gợi ý lô ở bảng trên.</p>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <h3 className="font-semibold text-sm">Lịch sử kế hoạch – {sp.maSP}</h3>
          {loadingHistory && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
        {!history.length ? (
          <div className="p-6 text-center text-slate-400 text-sm">Chưa có kế hoạch nào được lưu cho sản phẩm này.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 text-left">
              <tr>{["Lúc", "Số ống mục tiêu", "Trạng thái", "Ghi chú", "Hành động"].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const superseded = !!h.supersededById;
                const canEditOrDelete = h.trangThai === "dieu_chinh" && !superseded && h.ketQua?.batches;
                // NL trong bản nháp này có thể đã bị 1 kế hoạch KHÁC dùng mất trong lúc bản nháp
                // "Cần điều chỉnh" nằm chờ chưa ai xử lý (vd để lâu, người khác lỡ pha/duyệt mất lô
                // đó) — nếu vậy không cho Sửa tiếp nữa (sẽ cấp phát trùng lô đã dùng), chỉ cho xoá.
                // "cho-sx" (đã có kế hoạch khác dùng, chưa pha thật) báo CAM — chỉ thông tin, chưa
                // chắc mất hẳn; "da-pha" (đã pha thật hoặc không còn đủ dù tính cả phần Chờ SX) báo
                // ĐỎ — chắc chắn phải xoá bản nháp này.
                const lotState = canEditOrDelete ? draftLotState(h, materials) : "ok";
                const stale = lotState === "da-pha";
                const choSxNote = lotState === "cho-sx";
                return (
                  <tr key={h.id} className={`border-b border-slate-50 ${superseded ? "opacity-50" : ""}`}>
                    <td className={`px-3 py-1.5 ${superseded ? "line-through" : ""}`}>{new Date(h.createdAt).toLocaleString("vi-VN")}</td>
                    <td className={`px-3 py-1.5 ${superseded ? "line-through" : ""}`}>{fmt(h.soOngMucTieu, 0)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${superseded ? "line-through" : ""} ${
                        h.trangThai === "duyet" ? "bg-emerald-100 text-emerald-700"
                        : h.trangThai === "khong_duyet" ? "bg-rose-100 text-rose-700"
                        : h.trangThai === "dieu_chinh" ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-500"}`}>
                        {h.trangThai === "duyet" ? "Đã duyệt" : h.trangThai === "khong_duyet" ? "Không duyệt" : h.trangThai === "dieu_chinh" ? "Cần điều chỉnh" : "Chờ duyệt"}
                      </span>
                      {superseded && <span className="ml-1.5 text-[10px] text-sky-600">→ đã sửa, xem dòng mới bên trên</span>}
                    </td>
                    <td className={`px-3 py-1.5 text-slate-500 ${superseded ? "line-through" : ""}`}>{h.ghiChu || "–"}</td>
                    <td className="px-3 py-1.5">
                      {canEditOrDelete && canEdit && (
                        stale ? (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="text-[11px] text-rose-600 font-medium">⚠ NL liên quan đã pha — không sửa được nữa.</span>
                            <button onClick={() => deleteHistoryRow(h)} className="text-[11px] text-rose-600 hover:underline font-medium">Xoá bản nháp</button>
                          </div>
                        ) : choSxNote ? (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="text-[11px] text-amber-600 font-medium">⚠ NL liên quan đang trong Chờ SX — không sửa được nữa.</span>
                            <button onClick={() => deleteHistoryRow(h)} className="text-[11px] text-rose-600 hover:underline">Xoá bản nháp</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button onClick={() => startEditPlan(h)} className="text-[11px] text-sky-600 hover:underline">Sửa</button>
                            <button onClick={() => deleteHistoryRow(h)} className="text-[11px] text-rose-600 hover:underline">Xoá</button>
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Với 1 lô (maLo) của 1 luồng (chung), tính tổng đã phân bổ qua mọi mẻ hiện tại + phần còn dư
 * (chưa phân bổ) so với F gốc cả chai — dùng cho control "+ Thêm lô vào mẻ" (chỉ liệt kê lô còn dư). */
function computeUnallocatedLots(pool, batches, key) {
  const allocated = {};
  batches.forEach((b) => (b[key] || []).forEach((e) => { allocated[e.maLo] = (allocated[e.maLo] || 0) + e.theTichRaw; }));
  return (pool || [])
    .map((l) => ({ maLo: l.maLo, E: l.E, trueF: l.F, allocated: allocated[l.maLo] || 0, unallocated: l.F - (allocated[l.maLo] || 0) }))
    .filter((l) => l.unallocated > 1e-6);
}

/** Bảng "NL sử dụng theo từng lô" — tách riêng để dùng lại y hệt ở cả màn tính tự động (MixPlanResult)
 * lẫn màn Sửa tay (EditablePlanPanel, bảng gốc + bảng sau khi sửa). */
function LotUsageTable({ planLike, isTwo }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-sm">NL sử dụng theo từng lô</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">Dòng tô vàng = lô còn tồn (chưa dùng hết) so với cả chai gốc.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-400 text-left">
            <tr>
              {[...(isTwo ? ["Chủng"] : []), "Mã lô NL", "Dùng qua các mẻ (L)", "Tổng đã dùng (L)", "Cả chai (L)", "Còn tồn (L)"]
                .map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {computeLotUsageSummary(planLike, isTwo).map((r) => (
              <tr key={`${r.chung || ""}-${r.maLo}`} className={`border-b border-slate-50 ${r.remaining > 0.01 ? "bg-amber-50" : ""}`}>
                {isTwo && <td className="px-3 py-1.5">{r.chung}</td>}
                <td className="px-3 py-1.5 font-mono">{r.maLo}</td>
                <td className="px-3 py-1.5 text-slate-500">{r.parts.map((p) => fmt(p, 2)).join(" + ")}</td>
                <td className="px-3 py-1.5 font-medium">{fmt(r.total, 2)}</td>
                <td className="px-3 py-1.5">{fmt(r.trueF, 2)}</td>
                <td className={`px-3 py-1.5 font-medium ${r.remaining > 0.01 ? "text-amber-700" : "text-slate-400"}`}>
                  {fmt(r.remaining, 2)}{r.remaining > 0.01 ? " ⚠" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Bảng mẻ pha CÓ THỂ SỬA TAY — dùng khi NCV bấm "Sửa" trên 1 dòng lịch sử "Cần điều chỉnh". Mật độ
 * luôn TÍNH RA từ CFU/V (không gõ tay được) — NCV chỉ gõ tay thể tích NL từng lô hoặc thể tích lấy
 * nước từng mẻ (xem applyLotFEdit/recomputeEditBatches ở trên). */
function EditablePlanPanel({ sp, editingPlan, batches, isTwo, canUndo, ghiChu, onGhiChuChange, saving, onSetLotF, onAddLot, onSetWater, onRemoveBatch, onReorder, sterilizeOverrides, onSterilizeToggle, onUndo, onReset, onCancel, onSave }) {
  const gSubtilis = isTwo ? editingPlan.ketQua._gSubtilis : null;
  const gClausii = isTwo ? editingPlan.ketQua._gClausii : null;
  const gSingle = isTwo ? null : editingPlan.ketQua._G;

  // NCV muốn so sánh bảng GỐC (trước khi sửa, đứng yên) với bảng SAU KHI SỬA — và bảng sau khi sửa
  // chỉ cập nhật khi bấm nút "Lưu" rõ ràng (không tự động chạy theo từng phím gõ), để không bị rối
  // mắt khi đang gõ dở. `previewBatches` = snapshot bấm Lưu gần nhất; null nghĩa là CHƯA bấm Lưu lần
  // nào trong phiên sửa này.
  const [previewBatches, setPreviewBatches] = useState(null);
  const originalPlanLike = editingPlan.ketQua; // bảng gốc — KHÔNG đổi trong suốt phiên sửa
  const previewPlanLike = previewBatches ? { ...editingPlan.ketQua, batches: previewBatches } : null;

  const totalV = batches.reduce((s, b) => s + b.tongTheTich, 0);
  const T = Math.floor((totalV * 1000) / sp.tubeMl);
  let dSubtilis = null, dClausii = null, dSingle = null;
  if (isTwo) {
    const cfuA = batches.reduce((s, b) => s + b.subtilis.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
    const cfuB = batches.reduce((s, b) => s + b.clausii.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
    dSubtilis = totalV > 0 ? cfuA / (1000 * totalV) : 0;
    dClausii = totalV > 0 ? cfuB / (1000 * totalV) : 0;
  } else {
    const cfu = batches.reduce((s, b) => s + b.lots.reduce((s2, e) => s2 + e.E * e.theTichRaw, 0), 0) * 1000;
    dSingle = totalV > 0 ? cfu / (1000 * totalV) : 0;
  }

  const unallocA = isTwo ? computeUnallocatedLots(editingPlan.ketQua._subtilisPool, batches, "subtilis") : [];
  const unallocB = isTwo ? computeUnallocatedLots(editingPlan.ketQua._clausiiPool, batches, "clausii") : computeUnallocatedLots(editingPlan.ketQua._lotsPool, batches, "lots");

  return (
    <div className="space-y-4">
      <div className="sticky z-10 bg-white rounded-lg border border-slate-200 p-4 shadow-sm" style={{ top: "var(--topbar-h, 76px)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-sm">Sửa tay kế hoạch — {sp.maSP} ({sp.tenSP})</h3>
          <div className="flex items-center gap-2">
            <button onClick={onUndo} disabled={!canUndo} className="text-xs px-3 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">↺ Hoàn tác</button>
            <button onClick={onReset} className="text-xs px-3 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">⟲ Về bản gốc</button>
            <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">Huỷ, thoát sửa</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
          <Stat label="Số mẻ" value={batches.length} />
          <Stat label="Số ống đạt được" value={fmt(T, 0)} />
          {isTwo ? (
            <>
              <Stat label="Mật độ subtilis" value={sci(dSubtilis)} sub={`đích ${sci(gSubtilis)}`} />
              <Stat label="Mật độ clausii" value={sci(dClausii)} sub={`đích ${sci(gClausii)}`} />
            </>
          ) : (
            <Stat label="Mật độ pha" value={sci(dSingle)} sub={`đích ${sci(gSingle)}`} />
          )}
        </div>
      </div>

      {batches.map((b) => (
        <EditableBatchCard
          key={b.meSo}
          b={b}
          isTwo={isTwo}
          sp={sp}
          gSubtilis={gSubtilis}
          gClausii={gClausii}
          gSingle={gSingle}
          unallocA={unallocA}
          unallocB={unallocB}
          onSetLotF={onSetLotF}
          onAddLot={onAddLot}
          onSetWater={onSetWater}
          onRemoveBatch={onRemoveBatch}
        />
      ))}
      {batches.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Đã xoá hết mẻ — bấm "Về bản gốc" nếu muốn khôi phục, hoặc "Huỷ, thoát sửa" để bỏ dở.</div>
      )}

      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 px-1">Bảng gốc (trước khi sửa) — để so sánh, không đổi trong suốt phiên sửa</p>
          <BatchPlanTable plan={originalPlanLike} sp={sp} isTwo={isTwo} />
          <LotUsageTable planLike={originalPlanLike} isTwo={isTwo} />
        </div>
      )}

      {batches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-amber-800 flex-1 min-w-[240px]">Bấm "Lưu" để chốt các thay đổi hiện tại vào bảng so sánh bên dưới (đảo mẻ/chọn mốc tiệt trùng cũng cần bấm lại Lưu để cập nhật).</p>
          <button onClick={() => setPreviewBatches(structuredClone(batches))}
            className="flex items-center gap-1.5 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-amber-700 shrink-0">
            💾 Lưu (cập nhật bảng so sánh)
          </button>
        </div>
      )}

      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 px-1">Bảng sau khi sửa (theo lần bấm Lưu gần nhất)</p>
          {!previewPlanLike ? (
            <div className="bg-white rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-400 text-sm">Chưa bấm "Lưu" lần nào — bấm nút phía trên để xem bảng so sánh.</div>
          ) : (
            <>
              <BatchPlanTable plan={previewPlanLike} sp={sp} isTwo={isTwo} sterilizeOverrides={sterilizeOverrides} onSterilizeToggle={onSterilizeToggle} onReorder={onReorder} />
              <LotUsageTable planLike={previewPlanLike} isTwo={isTwo} />
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-2">Lưu bản đã sửa</h3>
        <p className="text-[11px] text-slate-400 mb-2">Lưu sẽ tạo 1 dòng lịch sử MỚI — dòng "Cần điều chỉnh" gốc vẫn giữ nguyên (đánh dấu gạch ngang, không mất).</p>
        <textarea value={ghiChu} onChange={(e) => onGhiChuChange(e.target.value)} placeholder="Ghi chú (không bắt buộc)"
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" rows={2} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={saving || batches.length === 0} onClick={() => onSave("duyet")} className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40">
            <CheckCircle2 className="w-4 h-4" /> Duyệt
          </button>
          <button disabled={saving || batches.length === 0} onClick={() => onSave("dieu_chinh")} className="flex items-center gap-1.5 bg-amber-500 text-white text-sm px-4 py-2 rounded-md hover:bg-amber-600 disabled:opacity-40">
            <HelpCircle className="w-4 h-4" /> Vẫn cần điều chỉnh tiếp
          </button>
          <button disabled={saving || batches.length === 0} onClick={() => onSave("khong_duyet")} className="flex items-center gap-1.5 bg-rose-600 text-white text-sm px-4 py-2 rounded-md hover:bg-rose-700 disabled:opacity-40">
            <XCircle className="w-4 h-4" /> Không duyệt
          </button>
        </div>
      </div>
    </div>
  );
}

const STREAM_STYLE = {
  subtilis: { chip: "bg-sky-50 text-sky-700 border-sky-200", head: "text-sky-600" },
  clausii: { chip: "bg-violet-50 text-violet-700 border-violet-200", head: "text-violet-600" },
  lots: { chip: "bg-sky-50 text-sky-700 border-sky-200", head: "text-sky-600" },
};

function EditableBatchCard({ b, isTwo, sp, gSubtilis, gClausii, gSingle, unallocA, unallocB, onSetLotF, onAddLot, onSetWater, onRemoveBatch }) {
  const streams = isTwo ? [["subtilis", "Subtilis", gSubtilis, unallocA], ["clausii", "Clausii", gClausii, unallocB]] : [["lots", "Nguyên liệu", gSingle, unallocB]];
  const sumRaw = streams.reduce((s, [key]) => s + (b[key] || []).reduce((s2, e) => s2 + e.theTichRaw, 0), 0);
  let vCapMax = Infinity;
  streams.forEach(([key, , g]) => {
    const cfu = (b[key] || []).reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
    if (cfu > 1e-6) vCapMax = Math.min(vCapMax, cfu / (1000 * g));
  });
  vCapMax = Math.min(vCapMax, TANK_MAX_L);

  // Draft cục bộ — giá trị NCV ĐANG GÕ (chưa commit lên state chung của cả kế hoạch): dùng để hiện
  // MẬT ĐỘ THÀNH PHẨM cập nhật NGAY LẬP TỨC theo từng phím gõ, KHÔNG phải chờ blur hay chạy lại toàn
  // bộ logic cân đối giữa các mẻ (applyLotFEdit, có thể kéo/đẩy NL ở mẻ KHÁC — nếu chạy trên từng
  // phím gõ sẽ rất giật/khó chịu). Commit thật (gọi onSetLotF/onSetWater, lúc đó mới cân đối chéo
  // mẻ) chỉ xảy ra khi rời khỏi ô (blur). Preview mật độ ở đây chỉ mang tính tham khảo tức thời —
  // con số CHÍNH THỨC sau khi commit có thể khác đôi chút (vd nếu chạm trần vật lý của 1 chai khác).
  const [fDraft, setFDraft] = useState({}); // { "key:maLo": chuỗi đang gõ }
  const [waterDraftStr, setWaterDraftStr] = useState(null); // chuỗi đang gõ, null = không đang gõ

  const draftKey = (key, maLo) => `${key}:${maLo}`;
  const cfuLive = {};
  streams.forEach(([key]) => {
    cfuLive[key] = (b[key] || []).reduce((s, e) => {
      const raw = fDraft[draftKey(key, e.maLo)];
      const f = raw !== undefined ? (num(raw) ?? 0) : e.theTichRaw;
      return s + e.E * f;
    }, 0) * 1000;
  });
  const liveV = waterDraftStr != null ? (num(waterDraftStr) ?? b.tongTheTich) : b.tongTheTich;
  const liveD = (key) => (liveV > 0 ? cfuLive[key] / (1000 * liveV) : 0);

  const commitF = (key, maLo, real, rawStr) => {
    setFDraft((d) => { const n = { ...d }; delete n[draftKey(key, maLo)]; return n; });
    const v = num(rawStr);
    if (v != null && Math.abs(v - real) > 1e-9) onSetLotF(key, maLo, b.meSo, v);
  };
  const commitWater = (rawStr) => {
    setWaterDraftStr(null);
    const v = num(rawStr);
    if (v != null) onSetWater(b.meSo, clampNum(v, sumRaw, Number.isFinite(vCapMax) ? vCapMax : v));
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <h4 className="font-semibold text-sm text-slate-800">Mẻ {b.meSo}</h4>
          <span className="text-xs text-slate-500">Tổng V mẻ <b className="text-slate-800 text-sm">{fmt(liveV, 2)} L</b></span>
          {isTwo ? (
            <span className="text-xs text-slate-500">
              Mật độ <b className="text-emerald-700 text-sm">{sci(liveD("subtilis"))}</b> <span className="text-slate-400">/</span> <b className="text-emerald-700 text-sm">{sci(liveD("clausii"))}</b>
              <span className="text-slate-400"> (đích {sci(gSubtilis)} / {sci(gClausii)})</span>
            </span>
          ) : (
            <span className="text-xs text-slate-500">Mật độ <b className="text-emerald-700 text-sm">{sci(liveD("lots"))}</b> <span className="text-slate-400">(đích {sci(gSingle)})</span></span>
          )}
        </div>
        <button onClick={() => { if (window.confirm(`Bỏ hẳn mẻ ${b.meSo} khỏi kế hoạch?`)) onRemoveBatch(b.meSo); }} title="Bỏ mẻ này" className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-md px-2 py-1"><X className="w-3.5 h-3.5" /> Bỏ mẻ</button>
      </div>
      <div className="p-4 space-y-4">
        {streams.map(([key, label, g, unalloc]) => (
          <div key={key} className={`rounded-md border p-3 ${STREAM_STYLE[key].chip.split(" ").filter((c) => c.startsWith("border")).join(" ")} bg-white`}>
            {isTwo && <div className={`text-xs font-semibold mb-2 ${STREAM_STYLE[key].head}`}>{label} <span className="font-normal text-slate-400">— mật độ đích {sci(g)}</span></div>}
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left text-[11px]">
                <tr>
                  <th className="py-1 font-medium">Mã lô</th>
                  <th className="py-1 font-medium">Định lượng (CFU/ml)</th>
                  <th className="py-1 font-medium">V nguyên liệu (L)</th>
                  <th className="py-1 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(b[key] || []).map((e) => (
                  <tr key={e.maLo} className="border-t border-slate-50">
                    <td className="py-1.5 font-mono text-xs">{e.maLo}</td>
                    <td className="py-1.5 text-xs text-slate-500">{sci(e.E)}</td>
                    <td className="py-1.5">
                      {/* key theo đúng giá trị THẬT hiện tại -> input tự "remount" hiện số mới khi bị mẻ
                          khác kéo/đẩy qua lại (xem applyLotFEdit) sau khi commit — không ảnh hưởng lúc
                          đang gõ dở vì draft được set lại về rỗng đúng lúc commit/remount xảy ra. */}
                      <input key={`${e.maLo}-${e.theTichRaw}`} type="number" step="0.5" min="0" defaultValue={e.theTichRaw}
                        onChange={(ev) => setFDraft((d) => ({ ...d, [draftKey(key, e.maLo)]: ev.target.value }))}
                        onBlur={(ev) => commitF(key, e.maLo, e.theTichRaw, ev.target.value)}
                        className="w-24 border border-slate-300 rounded px-2 py-1 font-medium" />
                    </td>
                    <td className="py-1.5">
                      <button onClick={() => onSetLotF(key, e.maLo, b.meSo, 0)} title="Bỏ lô này khỏi mẻ" className="text-slate-300 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unalloc.length > 0 && (
              <AddLotControl unalloc={unalloc} onAdd={(maLo, amount) => onAddLot(key, maLo, b.meSo, amount)} />
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">Thể tích lấy nước (tổng V mẻ):</span>
            <input key={`water-${b.meSo}-${b.tongTheTich}`} type="number" step="0.5" min={sumRaw} max={Number.isFinite(vCapMax) ? vCapMax : undefined}
              defaultValue={b.tongTheTich}
              onChange={(ev) => setWaterDraftStr(ev.target.value)}
              onBlur={(ev) => commitWater(ev.target.value)}
              className="w-24 border border-slate-300 rounded px-2 py-1 font-medium" />
            L
          </label>
          {b._waterOverride != null && <button onClick={() => onSetWater(b.meSo, null)} className="text-slate-400 hover:underline">↺ theo tự động</button>}
          {Number.isFinite(vCapMax) && <span className="text-slate-400">(tối thiểu {fmt(sumRaw, 2)}L — tối đa {fmt(vCapMax, 2)}L để không tụt dưới mật độ đích)</span>}
        </div>
      </div>
    </div>
  );
}

function AddLotControl({ unalloc, onAdd }) {
  const [maLo, setMaLo] = useState(unalloc[0]?.maLo || "");
  const [amount, setAmount] = useState("");
  const chosen = unalloc.find((l) => l.maLo === maLo) || unalloc[0];
  useEffect(() => { if (!unalloc.find((l) => l.maLo === maLo)) setMaLo(unalloc[0]?.maLo || ""); }, [unalloc, maLo]);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 mt-1">
      <span className="text-sky-600">+ Thêm lô vào mẻ này:</span>
      <select value={maLo} onChange={(e) => setMaLo(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5">
        {unalloc.map((l) => <option key={l.maLo} value={l.maLo}>{l.maLo} (còn dư {fmt(l.unallocated, 2)}L)</option>)}
      </select>
      <input type="number" step="0.5" min="0" max={chosen?.unallocated} value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder={chosen ? fmt(chosen.unallocated, 2) : ""} className="w-20 border border-slate-300 rounded px-1.5 py-0.5" />
      <button
        onClick={() => { const v = num(amount) ?? chosen?.unallocated; if (v > 0) { onAdd(maLo, v); setAmount(""); } }}
        className="text-sky-600 hover:underline"
      >Thêm</button>
    </div>
  );
}

/** Bảng "Bảng mẻ pha" đầy đủ (Mẻ, Tổng V, mật độ thực tế/mục tiêu, định lượng CFU/ml, V NL/nước/số
 * ống...) — TÁCH RIÊNG từ MixPlanResult (2026-07-30) để dùng lại Y HỆT ở tab "Chờ SX" (NCV muốn đối
 * chiếu lại đúng bảng đã tính lúc lập kế hoạch trước khi xác nhận đã pha, không phải bảng rút gọn).
 * Các control tương tác (nới trần mẻ, chọn mốc tiệt trùng, đảo mẻ) CHỈ hiện khi truyền đúng handler
 * tương ứng (onOverrideChange/onSterilizeToggle/onReorder) — không truyền gì = chế độ CHỈ XEM. */
function BatchPlanTable({ plan, sp, isTwo, batchOverrides = {}, sterilizeOverrides = {}, onOverrideChange, onSterilizeToggle, onReorder, expandInfo = {} }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100"><h3 className="font-semibold text-sm">Bảng mẻ pha</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-400 text-left">
            <tr>
              {["Mẻ", "Tổng V mẻ (L)", isTwo ? "Mật độ thực tế mẻ (subtilis / clausii)" : "Mật độ thực tế mẻ", ...(isTwo ? ["Chủng"] : []), "Số lô NL", "Định lượng (CFU/ml)", "V nguyên liệu dùng (L)", "Mật độ mục tiêu (CFU/ml)", "Thể tích 1 ống (ml)", "V dịch pha dự kiến (L)", "V lấy nước (L)", "Cỡ lô (ống)"]
                .map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {planBatchRows(plan, sp, isTwo, batchOverrides, sterilizeOverrides).map((r, idx) => (
              <React.Fragment key={r.key}>
                {r.meSo != null && idx > 0 && (onSterilizeToggle || r.needSterilizeBefore) && (
                  <tr className={r.needSterilizeBefore ? "bg-amber-50" : "bg-slate-50"}>
                    <td colSpan={isTwo ? 12 : 11} className="px-3 py-1.5 text-center">
                      {r.needSterilizeBefore ? (
                        <span className="text-amber-700 font-medium">
                          🧼 Vệ sinh — tiệt trùng hệ thống trước khi pha mẻ {r.meSo}
                          {onSterilizeToggle && (
                            <button onClick={() => onSterilizeToggle(r.meSo, false)} className="ml-2 text-[11px] underline text-amber-600 hover:text-amber-800">bỏ đánh dấu</button>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          — không cần tiệt trùng trước mẻ {r.meSo} —
                          <button onClick={() => onSterilizeToggle(r.meSo, true)} className="ml-2 underline text-slate-400 hover:text-slate-600">+ đánh dấu cần tiệt trùng</button>
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                <tr className={`border-b border-slate-50 ${r.meSo != null && idx > 0 ? "border-t-2 border-t-slate-300" : ""}`}>
                <td className="px-3 py-1.5 font-medium">
                  {r.meSo != null ? (
                    <span className="inline-flex items-center gap-1">
                      {r.meSo}
                      {onReorder && (
                        <span className="inline-flex flex-col -my-1">
                          <button title="Đảo lên trước" disabled={r.meSo <= 1} onClick={() => onReorder(r.meSo, -1)} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none"><ChevronUp className="w-3 h-3" /></button>
                          <button title="Đảo xuống sau" disabled={r.meSo >= plan.batches.length} onClick={() => onReorder(r.meSo, 1)} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none"><ChevronDown className="w-3 h-3" /></button>
                        </span>
                      )}
                    </span>
                  ) : ""}
                </td>
                <td className="px-3 py-1.5">{r.tongTheTich != null ? fmt(r.tongTheTich, 2) : ""}</td>
                <td className="px-3 py-1.5 font-medium text-emerald-700">
                  {r.dThucTe == null ? "" : isTwo ? `${sci(r.dThucTe.subtilis)} / ${sci(r.dThucTe.clausii)}` : sci(r.dThucTe.chung)}
                </td>
                {isTwo && <td className="px-3 py-1.5">{r.chung}</td>}
                <td className="px-3 py-1.5 font-mono">{r.maLo}</td>
                <td className="px-3 py-1.5">{sci(r.E)}</td>
                <td className="px-3 py-1.5 font-medium">{fmt(r.vRaw, 2)}</td>
                <td className="px-3 py-1.5">{sci(r.d)}</td>
                <td className="px-3 py-1.5">{sp.tubeMl}</td>
                <td className="px-3 py-1.5">{fmt(r.vPha, 2)}</td>
                <td className="px-3 py-1.5">{fmt(r.vNuoc, 2)}</td>
                <td className="px-3 py-1.5">{fmt(r.soOng, 0)}</td>
                </tr>
                {isTwo && r.meSo != null && onOverrideChange && (
                  <tr className="border-b border-slate-100 bg-sky-50/60">
                    <td colSpan={12} className="px-3 py-1.5">
                      <BatchExpandControl
                        meSo={r.meSo}
                        baseV={plan.batches.find((b) => b.meSo === r.meSo).tongTheTich}
                        currentV={r.tongTheTich}
                        info={expandInfo[r.meSo]}
                        onChange={onOverrideChange}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MixPlanResult({ plan, sp, batchOverrides = {}, onOverrideChange, sterilizeOverrides = {}, onSterilizeToggle, onReorder }) {
  const isTwo = plan._kind === "two";

  // Trần tank 1080L là ngưỡng AN TOÀN mặc định — nhưng nếu cả 2 luồng vẫn còn dư so với trần đó
  // (chưa luồng nào chạm đúng mật độ đích), NGHĨA LÀ chính trần tank (chứ không phải công thức)
  // đang là thứ giữ mẻ lại — trong trường hợp đó có thể nới thêm nước tới khi luồng dư ÍT HƠN vừa
  // chạm đúng đích. Nếu 1 luồng đã tự chạm đúng đích rồi (vCap của nó ≤ V hiện tại) thì KHÔNG còn
  // chỗ để nới — thêm nước sẽ đẩy luồng đó xuống dưới đích, vi phạm quy tắc cứng.
  const expandInfo = {};
  if (isTwo) {
    plan.batches.forEach((b) => {
      const cfuA = b.subtilis.reduce((s, x) => s + x.E * x.theTichRaw, 0) * 1000;
      const cfuB = b.clausii.reduce((s, x) => s + x.E * x.theTichRaw, 0) * 1000;
      const vCapA = cfuA > 0 ? cfuA / (1000 * plan._gSubtilis) : Infinity;
      const vCapB = cfuB > 0 ? cfuB / (1000 * plan._gClausii) : Infinity;
      const vSafeMax = Math.min(vCapA, vCapB);
      const canExpand = Number.isFinite(vSafeMax) && vSafeMax > b.tongTheTich + 0.05;
      const limitedByStream = vCapA <= vCapB ? "subtilis" : "clausii";
      expandInfo[b.meSo] = { vSafeMax, canExpand, limitedByStream };
    });
  }

  const warnings = [];
  if (isTwo) {
    const wasteSub = (plan.dSubtilis / plan._gSubtilis - 1) * 100;
    const wasteClau = (plan.dClausii / plan._gClausii - 1) * 100;
    if (wasteSub > 3) warnings.push(`Mật độ subtilis dư ${fmt(wasteSub, 1)}% so với đích.`);
    if (wasteClau > 3) warnings.push(`Mật độ clausii dư ${fmt(wasteClau, 1)}% so với đích.`);
  } else {
    const waste = (plan.d / plan._G - 1) * 100;
    if (waste > 3) warnings.push(`Mật độ pha dư ${fmt(waste, 1)}% so với đích.`);
  }
  plan.batches.forEach((b) => {
    if (b.tongTheTich >= TANK_MAX_L * 0.95) warnings.push(`Mẻ ${b.meSo} gần chạm trần tank (${fmt(b.tongTheTich, 1)}L).`);
  });
  // Cảnh báo MẬT ĐỘ TỪNG MẺ riêng (khác cảnh báo mật độ TRUNG BÌNH CẢ NHỊP ở trên) — 1 mẻ đơn lẻ có
  // thể dư mật độ rất nặng (vd mẻ đóng cuối bị chặn trần T, phải dồn hết chai đang dở mà không thêm
  // nước — xem MAX_CLOSING_OVERSHOOT) trong khi mật độ TRUNG BÌNH cả nhịp vẫn trông bình thường (bị
  // các mẻ khác pha loãng ra trong số liệu tổng) — cần cảnh báo riêng để NCV không bỏ sót đúng mẻ đó.
  if (isTwo) {
    plan.batches.forEach((b) => {
      const cfuA = b.subtilis.reduce((s, x) => s + x.E * x.theTichRaw, 0) * 1000;
      const cfuB = b.clausii.reduce((s, x) => s + x.E * x.theTichRaw, 0) * 1000;
      const dA = b.tongTheTich > 0 ? cfuA / (1000 * b.tongTheTich) : 0;
      const dB = b.tongTheTich > 0 ? cfuB / (1000 * b.tongTheTich) : 0;
      const wA = dA > 0 ? (dA / plan._gSubtilis - 1) * 100 : 0;
      const wB = dB > 0 ? (dB / plan._gClausii - 1) * 100 : 0;
      const wMax = Math.max(wA, wB);
      if (wMax > 20) {
        warnings.push(`Mẻ ${b.meSo} mật độ dư RẤT NHIỀU so với đích (subtilis +${fmt(wA, 0)}%, clausii +${fmt(wB, 0)}%) — do phải dồn hết 1 chai đang dở vào mà không thêm nước (chạm trần sản lượng). Kiểm tra kỹ trước khi pha, cân nhắc có nên tách riêng phần NL này hay điều chỉnh đơn.`);
      }
    });
  }
  const lotBatchCount = {};
  plan.batches.forEach((b) => {
    const lotIds = isTwo ? [...b.subtilis.map((x) => x.maLo), ...b.clausii.map((x) => x.maLo)] : b.lots.map((x) => x.maLo);
    lotIds.forEach((id) => { lotBatchCount[id] = (lotBatchCount[id] || 0) + 1; });
  });
  const splitLots = Object.entries(lotBatchCount).filter(([, c]) => c > 1).map(([id]) => id);
  if (splitLots.length) warnings.push(`Lô bị tách qua nhiều mẻ (bình thường, không phải lỗi): ${splitLots.join(", ")}.`);
  const sterilizePoints = computeSterilizeFlags(plan.batches, sterilizeOverrides)
    .map((need, i) => (need ? plan.batches[i].meSo : null))
    .filter((v) => v != null);
  if (sterilizePoints.length) warnings.push(`Đã đánh dấu cần VỆ SINH — TIỆT TRÙNG hệ thống trước (các) mẻ ${sterilizePoints.join(", ")}.`);
  // Cảnh báo RIÊNG khi mẻ SAU đổi sang (các) lô sản xuất clausii KHÁC với mẻ TRƯỚC — clausii pha
  // chung 1 tank với subtilis nên đổi lô clausii cũng đồng nghĩa nên tiệt trùng để tránh nhiễm chéo
  // giữa 2 đợt lên men clausii khác nhau (gợi ý thông tin, không tự đánh dấu — NCV vẫn tự quyết
  // định đánh dấu tiệt trùng ở mẻ nào, xem computeSterilizeFlags).
  if (isTwo) {
    for (let i = 1; i < plan.batches.length; i++) {
      const prevClau = new Set(plan.batches[i - 1].clausiiLoSanXuatList || []);
      const curClau = new Set(plan.batches[i].clausiiLoSanXuatList || []);
      const finishedLots = [...prevClau].filter((lo) => !curClau.has(lo));
      if (finishedLots.length && prevClau.size > 0) {
        warnings.push(`Mẻ ${plan.batches[i - 1].meSo} là mẻ CUỐI dùng lô clausii ${finishedLots.join(", ")} — nên tiệt trùng trước khi sang mẻ ${plan.batches[i].meSo} (đổi lô clausii).`);
      }
    }
  }
  if (plan.subtilisShortfallLot) {
    warnings.push(`Kho subtilis KHÔNG đủ để dùng hết lô clausii "${plan.subtilisShortfallLot}" mà không để dở dang — kế hoạch đã CHỦ ĐỘNG dừng sớm hơn mục tiêu ${fmt(plan._N, 0)} ống (chốt cứng: clausii không bao giờ được để dở). Bổ sung subtilis nếu muốn đạt đủ số ống, hoặc pha theo kế hoạch hụt này.`);
  }
  const selfMixedBatches = plan.batches.filter((b) => b.tronLoSanXuat).map((b) => b.meSo);
  if (selfMixedBatches.length) warnings.push(`Mẻ ${selfMixedBatches.join(", ")} tự thân đã trộn NL từ ≥2 lô sản xuất khác nhau trong cùng 1 tank (mẻ trước quá vơi).`);
  if (plan.T > 1.05 * plan._N) {
    warnings.push(`Sản lượng dư ${fmt((plan.T / plan._N - 1) * 100, 0)}% so với mục tiêu (${fmt(plan._N, 0)} ống) — do kho các chủng lệch tỉ lệ nên phải dùng hết sạch NL đã chạm tới (đặc biệt clausii, không để dư), thể tích không vượt quá +${Math.round((MAX_CLOSING_OVERSHOOT - 1) * 100)}%. Xem kỹ bảng "NL sử dụng theo từng lô" bên dưới rồi quyết định có pha theo kế hoạch này hay điều chỉnh lại đơn/kho trước.`);
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-3">Kết quả tính toán</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Số mẻ" value={plan.batches.length} />
          <Stat label="Số ống đạt được" value={fmt(plan.T, 0)} />
          {isTwo ? (
            <>
              <Stat label="Mật độ subtilis thực đạt" value={sci(plan.dSubtilis)} sub={approxEq(plan.dSubtilis, plan._gSubtilis) ? `khớp mật độ đích (${sci(plan._gSubtilis)})` : `đích ${sci(plan._gSubtilis)} — dư ${fmt((plan.dSubtilis / plan._gSubtilis - 1) * 100, 1)}%`} />
              <Stat label="Mật độ clausii thực đạt" value={sci(plan.dClausii)} sub={approxEq(plan.dClausii, plan._gClausii) ? `khớp mật độ đích (${sci(plan._gClausii)})` : `đích ${sci(plan._gClausii)} — dư ${fmt((plan.dClausii / plan._gClausii - 1) * 100, 1)}%`} />
            </>
          ) : (
            <Stat label="Mật độ pha thực đạt" value={sci(plan.d)} sub={approxEq(plan.d, plan._G) ? `khớp mật độ đích (${sci(plan._G)})` : `đích ${sci(plan._G)} — dư ${fmt((plan.d / plan._G - 1) * 100, 1)}%`} />
          )}
        </div>
      </div>

      <BatchPlanTable plan={plan} sp={sp} isTwo={isTwo} batchOverrides={batchOverrides} sterilizeOverrides={sterilizeOverrides}
        onOverrideChange={onOverrideChange} onSterilizeToggle={onSterilizeToggle} onReorder={onReorder} expandInfo={expandInfo} />

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm">NL sử dụng theo từng lô</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Dòng tô vàng = lô còn tồn (chưa dùng hết) — chỉ xảy ra khi thuật toán phải dừng sớm để tránh sản lượng vọt quá xa mục tiêu.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-400 text-left">
              <tr>
                {[...(isTwo ? ["Chủng"] : []), "Mã lô NL", "Dùng qua các mẻ (L)", "Tổng đã dùng (L)", "Cả chai (L)", "Còn tồn (L)"]
                  .map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {computeLotUsageSummary(plan, isTwo).map((r) => (
                <tr key={`${r.chung || ""}-${r.maLo}`} className={`border-b border-slate-50 ${r.remaining > 0.01 ? "bg-amber-50" : ""}`}>
                  {isTwo && <td className="px-3 py-1.5">{r.chung}</td>}
                  <td className="px-3 py-1.5 font-mono">{r.maLo}</td>
                  <td className="px-3 py-1.5 text-slate-500">{r.parts.map((p) => fmt(p, 2)).join(" + ")}</td>
                  <td className="px-3 py-1.5 font-medium">{fmt(r.total, 2)}</td>
                  <td className="px-3 py-1.5">{fmt(r.trueF, 2)}</td>
                  <td className={`px-3 py-1.5 font-medium ${r.remaining > 0.01 ? "text-amber-700" : "text-slate-400"}`}>
                    {fmt(r.remaining, 2)}{r.remaining > 0.01 ? " ⚠" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-2">Đối soát bào tử (AI tự kiểm tra)</h3>
        {isTwo ? (
          <>
            <PassRow label="Subtilis: bảo toàn bào tử" pass={plan.massBalanceSubtilis.pass} detail={`chênh ${fmt(plan.massBalanceSubtilis.diffPct, 3)}%`} />
            <PassRow label="Clausii: bảo toàn bào tử" pass={plan.massBalanceClausii.pass} detail={`chênh ${fmt(plan.massBalanceClausii.diffPct, 3)}%`} />
          </>
        ) : (
          <PassRow label="Bảo toàn bào tử" pass={plan.massBalance.pass} detail={`chênh ${fmt(plan.massBalance.diffPct, 3)}%`} />
        )}
        <PassRow label={`Mỗi mẻ ≤ ${TANK_MAX_L}L`} pass={plan.batches.every((b) => b.tongTheTich <= TANK_MAX_L + 1e-6)} />
        <PassRow label={`Mỗi mẻ ≤ ${MAX_LOTS_PER_BATCH} lô`} pass={plan.batches.every((b) => (isTwo ? b.subtilis.length + b.clausii.length : b.lots.length) <= MAX_LOTS_PER_BATCH)} />
        <PassRow
          label={`Số ống đạt tối thiểu 90% mục tiêu (${fmt(plan._N, 0)})`}
          pass={plan.T >= 0.9 * plan._N}
          detail={plan.T > 1.1 * plan._N ? `dư ${fmt((plan.T / plan._N - 1) * 100, 1)}% so với mục tiêu — NCV xem xét dùng hết hay bớt lô` : undefined}
        />
        {(() => {
          const checks = batchDensityChecks(plan, isTwo);
          const allOk = checks.every((c) => c.ok);
          const failedMe = checks.filter((c) => !c.ok).map((c) => c.meSo);
          return (
            <PassRow
              label="Mật độ thực tế mọi mẻ ≥ mật độ đích (sau khi quy tròn NL)"
              pass={allOk}
              detail={allOk ? undefined : `mẻ ${failedMe.join(", ")} bị tụt dưới mật độ đích do quy tròn — sửa tay lượng NL mẻ đó trước khi pha, đừng dùng số đã làm tròn`}
            />
          );
        })()}
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-amber-700"><AlertTriangle className="w-4 h-4" /> Cảnh báo</h3>
          <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
/** Cho NCV lựa chọn: giữ mẻ ở trần an toàn 1080L (mặc định) hay nới thêm nước tới mức vẫn an
 * toàn (chưa luồng nào tụt dưới đích) — chỉ hiện nút nới khi trần tank thực sự là thứ đang giữ
 * mẻ lại (canExpand); nếu 1 luồng đã tự chạm đúng đích thì giải thích rõ lý do không nới được. */
function BatchExpandControl({ meSo, baseV, currentV, info, onChange }) {
  if (!info) return null;
  const overridden = Math.abs(currentV - baseV) > 0.01;
  if (!info.canExpand) {
    return (
      <span className="text-[11px] text-slate-400">
        Mẻ đang ở ngưỡng an toàn tối đa — mật độ <b>{info.limitedByStream}</b> đã đúng khớp đích, nới thêm nước sẽ đẩy nó xuống dưới đích nên không thể nới thêm.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
      <span>
        Trần tank {fmt(TANK_MAX_L, 0)}L là ngưỡng an toàn — có thể nới tới tối đa <b>{fmt(info.vSafeMax, 2)}L</b> để giảm dư mật độ (tại đó <b>{info.limitedByStream}</b> vừa khớp đúng đích).
      </span>
      <label className="flex items-center gap-1">
        Nới mẻ này tới:
        <input
          type="number"
          step="0.5"
          min={baseV}
          max={info.vSafeMax}
          value={overridden ? currentV : ""}
          placeholder={fmt(baseV, 2)}
          onChange={(e) => {
            const v = e.target.value === "" ? null : clampNum(num(e.target.value), baseV, info.vSafeMax);
            onChange(meSo, v);
          }}
          className="w-24 border border-slate-300 rounded px-1.5 py-0.5"
        />
        L
      </label>
      <button type="button" onClick={() => onChange(meSo, info.vSafeMax)} className="text-sky-600 hover:underline">nới tối đa</button>
      {overridden && <button type="button" onClick={() => onChange(meSo, null)} className="text-slate-400 hover:underline">khôi phục {fmt(baseV, 2)}L</button>}
    </div>
  );
}
const clampNum = (x, lo, hi) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

function Stat({ label, value, sub }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
const approxEq = (a, b) => Math.abs(a / b - 1) < 0.001;

/** Tách bảng mẻ pha thành 1 dòng/chai NL, kèm V nguyên liệu (raw) + V lấy nước tự tính. */
// Mật độ THỰC TẾ gộp cả mẻ (không phải riêng từng lô) — vì tank trộn chung, GMP quan tâm
// mật độ cuối cùng trong tank, không phải mật độ giả định của riêng 1 lô. Đây là lớp kiểm
// tra an toàn cuối: quy tròn NL có thể khiến 1 lô bị thiếu hụt cục bộ (do dùng hết chai),
// nhưng nếu mẻ có lô khác bù vào thì vẫn đạt — chỉ báo FAIL khi cả mẻ thực sự tụt dưới đích.
function batchDensityChecks(plan, isTwo) {
  const cfuOf = (list) => list.reduce((s, x) => s + x.theTichRaw * x.E, 0) * 1000;
  return plan.batches.map((b) => {
    if (isTwo) {
      const dSub = b.tongTheTich > 0 ? cfuOf(b.subtilis) / (b.tongTheTich * 1000) : null;
      const dClau = b.tongTheTich > 0 ? cfuOf(b.clausii) / (b.tongTheTich * 1000) : null;
      const epsSub = plan._gSubtilis * 1e-6;
      const epsClau = plan._gClausii * 1e-6;
      const okSub = dSub == null || dSub >= plan._gSubtilis - epsSub;
      const okClau = dClau == null || dClau >= plan._gClausii - epsClau;
      return { meSo: b.meSo, ok: okSub && okClau, dSub, dClau };
    }
    const d = b.tongTheTich > 0 ? cfuOf(b.lots) / (b.tongTheTich * 1000) : null;
    const eps = plan._G * 1e-6;
    const ok = d == null || d >= plan._G - eps;
    return { meSo: b.meSo, ok, d };
  });
}

/** Đánh dấu vệ sinh — tiệt trùng hệ thống trước 1 mẻ: HOÀN TOÀN TỰ CHỌN, không tự tính theo quy
 * tắc "đổi lô sản xuất" nữa (bản cũ tự gợi ý theo ngưỡng 3 lô sản xuất khác nhau, nhưng chọn "không
 * cần" ở 1 mẻ không tự reset ngưỡng nên mẻ SAU vẫn bị đẩy hỏi lại — phản hồi NCV 2026-09: đứng máy
 * tự biết rõ khi nào thật sự cần hơn hẳn 1 con số đếm đơn thuần, không muốn bị hỏi lặp lại nhiều
 * lần). Mỗi mẻ mặc định KHÔNG cần, NCV tự bấm đánh dấu mẻ nào cần vệ sinh trước khi pha — quyết
 * định ở 1 mẻ không kéo theo/ảnh hưởng mẻ khác. `overrides` (key = b.meSo, value = true) là danh
 * sách mẻ đã tự đánh dấu. Trả về mảng boolean cùng độ dài plan.batches.
 */
function computeSterilizeFlags(batches, overrides = {}) {
  return batches.map((b, bi) => bi > 0 && overrides[b.meSo] === true);
}

/** Gộp NL đã dùng theo TỪNG LÔ (qua mọi mẻ) — cho NCV thấy rõ 1 lô bị tách lẻ dùng ở những mẻ nào,
 * tổng cộng bao nhiêu, và còn tồn lại bao nhiêu so với cả chai gốc (plan._subtilisPool/_clausiiPool/
 * _lotsPool — đính kèm lúc tính kế hoạch, xem tinhKeHoach). "Còn tồn" > 0 là bình thường với subtilis
 * (nguyên tắc 4: được phép dở dang) — với clausii/SP 1 thành phần thì luôn = 0 vì lô đã chạm tới
 * phải dùng hết 100%. */
function computeLotUsageSummary(plan, isTwo) {
  const rows = [];
  const collect = (items, chung, pool) => {
    const byMaLo = {};
    items.forEach((e) => { (byMaLo[e.maLo] ||= { maLo: e.maLo, E: e.E, parts: [] }).parts.push(e.theTichRaw); });
    const poolByMaLo = Object.fromEntries((pool || []).map((l) => [l.maLo, l]));
    Object.values(byMaLo).forEach((entry) => {
      const total = entry.parts.reduce((s, v) => s + v, 0);
      const trueF = poolByMaLo[entry.maLo]?.F ?? total;
      rows.push({ ...entry, chung, total, trueF, remaining: Math.max(0, trueF - total) });
    });
  };
  if (isTwo) {
    collect(plan.batches.flatMap((b) => b.subtilis), "subtilis", plan._subtilisPool);
    collect(plan.batches.flatMap((b) => b.clausii), "clausii", plan._clausiiPool);
  } else {
    collect(plan.batches.flatMap((b) => b.lots), null, plan._lotsPool);
  }
  return rows.sort((a, b) => (a.chung || "").localeCompare(b.chung || "") || a.maLo.localeCompare(b.maLo, undefined, { numeric: true }));
}

function planBatchRows(plan, sp, isTwo, batchOverrides = {}, sterilizeOverrides = {}) {
  const rows = [];
  const sterilizeFlags = computeSterilizeFlags(plan.batches, sterilizeOverrides);
  plan.batches.forEach((b, bi) => {
    const needSterilizeBefore = sterilizeFlags[bi];

    const items = isTwo
      ? [
          ...b.subtilis.map((x) => ({ ...x, chung: "subtilis", d: plan._gSubtilis })),
          ...b.clausii.map((x) => ({ ...x, chung: "clausii", d: plan._gClausii })),
        ]
      : b.lots.map((x) => ({ ...x, d: plan.d }));

    // NCV có thể tự nới trần mẻ này (thêm nước) khi còn an toàn — xem tính toán canExpand ở
    // MixPlanResult; effectiveV phản ánh đúng lựa chọn đó (mặc định = V thuật toán tính).
    const effectiveV = batchOverrides[b.meSo] ?? b.tongTheTich;

    // Mật độ THỰC TẾ của mẻ này — tính từ đúng lượng NL đã quy tròn thực sự cấp vào (không
    // phải mật độ mục tiêu của cả nhịp), để đối chiếu xem công thức pha ra có ổn không.
    const cfuOf = (list) => list.reduce((s, x) => s + x.theTichRaw * x.E, 0) * 1000;
    const dThucTe = isTwo
      ? { subtilis: effectiveV > 0 ? cfuOf(b.subtilis) / (effectiveV * 1000) : null, clausii: effectiveV > 0 ? cfuOf(b.clausii) / (effectiveV * 1000) : null }
      : { chung: effectiveV > 0 ? cfuOf(b.lots) / (effectiveV * 1000) : null };

    items.forEach((it, idx) => {
      const vRaw = it.theTichRaw;
      const vPha = isTwo ? (it.theTichRaw * it.E) / it.d : it.theTichDich;
      rows.push({
        key: `${b.meSo}-${it.chung || ""}-${it.maLo}`,
        meSo: idx === 0 ? b.meSo : null,
        tongTheTich: idx === 0 ? effectiveV : null,
        dThucTe: idx === 0 ? dThucTe : null,
        needSterilizeBefore: idx === 0 ? needSterilizeBefore : false,
        chung: it.chung,
        maLo: it.maLo,
        E: it.E,
        d: it.d,
        vRaw,
        vPha,
        vNuoc: vPha - vRaw,
        soOng: (vPha * 1000) / sp.tubeMl,
      });
    });
  });
  return rows;
}
function PassRow({ label, pass, detail }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      {pass ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
      <span className={pass ? "text-slate-700" : "text-rose-700"}>{label}{detail ? ` — ${detail}` : ""}</span>
    </div>
  );
}

/* ---------------- Thêm sản phẩm mới ---------------- */
function AddProductForm({ onAdd }) {
  const empty = { maSP: "", tenSP: "", pool: "subtilis", thanhPhan: "", hamLuong: "", tubeMl: "", soOngNhip: "", ncv: "", pool2: "", thanhPhan2: "", hamLuong2: "" };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [twoParts, setTwoParts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!draft.maSP.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onAdd(twoParts ? draft : { ...draft, pool2: "", thanhPhan2: "", hamLuong2: "" });
      setDraft(empty);
      setTwoParts(false);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-3 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-md">
        <Plus className="w-4 h-4" /> Thêm sản phẩm mới
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mb-3 bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs text-slate-500">Mã SP</label>
        <input value={draft.maSP} onChange={(e) => setDraft({ ...draft, maSP: e.target.value })} placeholder="vd: SP01" required
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-28" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Tên</label>
        <input value={draft.tenSP} onChange={(e) => setDraft({ ...draft, tenSP: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-40" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Thành phần</label>
        <input value={draft.thanhPhan} onChange={(e) => setDraft({ ...draft, thanhPhan: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-48" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Nguồn NL</label>
        <select value={draft.pool} onChange={(e) => setDraft({ ...draft, pool: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
          <option value="subtilis">subtilis</option>
          <option value="clausii-loai1">clausii (1)</option>
          <option value="clausii-loai2">clausii (2)</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-500">Hàm lượng (cfu/ml)</label>
        <input value={draft.hamLuong} onChange={(e) => setDraft({ ...draft, hamLuong: e.target.value })} placeholder="vd 4e8"
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-28" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Số thành phần</label>
        <select value={twoParts ? "2" : "1"} onChange={(e) => setTwoParts(e.target.value === "2")}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </div>
      {twoParts && (
        <div className="w-full flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div>
            <label className="text-xs text-slate-500">Thành phần 2</label>
            <input value={draft.thanhPhan2} onChange={(e) => setDraft({ ...draft, thanhPhan2: e.target.value })}
              className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-48" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Nguồn NL 2</label>
            <select value={draft.pool2 || ""} onChange={(e) => setDraft({ ...draft, pool2: e.target.value })}
              className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm">
              <option value="">— chọn —</option>
              <option value="subtilis">subtilis</option>
              <option value="clausii-loai1">clausii (1)</option>
              <option value="clausii-loai2">clausii (2)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Hàm lượng 2 (cfu/ml)</label>
            <input value={draft.hamLuong2} onChange={(e) => setDraft({ ...draft, hamLuong2: e.target.value })} placeholder="vd 4e8"
              className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-28" />
          </div>
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500">Ống (ml)</label>
        <input value={draft.tubeMl} onChange={(e) => setDraft({ ...draft, tubeMl: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-20" />
      </div>
      <div>
        <label className="text-xs text-slate-500">Ống/nhịp</label>
        <input value={draft.soOngNhip} onChange={(e) => setDraft({ ...draft, soOngNhip: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-20" />
      </div>
      <div>
        <label className="text-xs text-slate-500">NCV</label>
        <input value={draft.ncv} onChange={(e) => setDraft({ ...draft, ncv: e.target.value })}
          className="block mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm w-24" />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-md">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Thêm
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700 px-2">Huỷ</button>
      </div>
      {error && <p className="text-xs text-rose-600 w-full">{error}</p>}
    </form>
  );
}

/* ---------------- Lịch sử pha chế (theo từng thành phẩm) ---------------- */
function ProductionHistoryPanel({ products, setNote, focusMaSP, focusTs, canEdit }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const cardRefs = useRef({});
  // Bộ lọc: sản phẩm giờ chọn bằng dropdown trong trang này (trước đây là danh sách con ở
  // Sidebar) + lọc thêm theo số lô và khoảng NSX/HSD — cùng kiểu với NLFilterBar ở bảng NL.
  const [productFilter, setProductFilter] = useState(focusMaSP || "all");
  const [loQuery, setLoQuery] = useState("");
  const [dateField, setDateField] = useState("nsx");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchFinishedBatches()
      .then(setBatches)
      .catch((err) => setNote(`Lỗi tải lịch sử pha chế: ${err.message}`))
      .finally(() => setLoading(false));
  }, [setNote]);
  useEffect(() => { load(); }, [load]);

  // Vừa "Xác nhận đã pha" xong -> tải lại (dòng mới chưa chắc đã kịp có trong lần fetch trước đó),
  // tự chọn đúng sản phẩm đó trong bộ lọc rồi cuộn tới.
  useEffect(() => {
    if (!focusMaSP) return;
    setProductFilter(focusMaSP);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTs]);
  useEffect(() => {
    if (!focusMaSP || loading) return;
    cardRefs.current[focusMaSP]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusMaSP, focusTs, loading]);

  const edit = (id, field, value) => {
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
    updateFinishedBatchField(id, field, value).catch((err) => setNote(`Lỗi lưu: ${err.message}`));
  };

  // Khớp theo TÊN sản phẩm (không phải mã SP) — cột ma_sp không còn tồn tại trên bảng finished_batches
  // thật (đã đổi hẳn sang ten_sp), và mã SP trong "Sản phẩm" có thể bị NCV đổi bất cứ lúc nào nên
  // không đáng tin để lưu chết 1 bản copy. So khớp không phân biệt hoa/thường + khoảng trắng vì dữ
  // liệu lịch sử cũ (backfill từ Excel) lưu tên viết HOA, còn "Sản phẩm" lưu tên viết thường/Hoa đầu.
  const norm = (s) => (s || "").trim().toLowerCase();
  const groups = useMemo(() => {
    const g = {};
    for (const b of batches) (g[norm(b.tenSP)] ||= []).push(b);
    return g;
  }, [batches]);

  // nsx/hsd đã là chuỗi ISO "YYYY-MM-DD" (input type=date) nên so trực tiếp bằng chuỗi được, không
  // cần parse ra Date.
  const matchesRow = (b) => {
    const q = loQuery.trim().toLowerCase();
    if (q && !(b.soLo || "").toLowerCase().includes(q)) return false;
    if (dateFrom || dateTo) {
      const key = b[dateField];
      if (!key) return false;
      if (dateFrom && key < dateFrom) return false;
      if (dateTo && key > dateTo) return false;
    }
    return true;
  };
  const hasRowFilter = !!loQuery.trim() || !!dateFrom || !!dateTo;
  const hasActiveFilter = productFilter !== "all" || hasRowFilter;
  const resetFilters = () => { setProductFilter("all"); setLoQuery(""); setDateFrom(""); setDateTo(""); };

  const visibleProducts = productFilter === "all" ? products : products.filter((p) => p.maSP === productFilter);

  if (loading) return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Đang tải…</div>;
  if (!products.length) return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Chưa có sản phẩm nào.</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap items-end gap-3 text-xs">
        <div className="flex flex-col gap-1">
          <label className="text-slate-500">Sản phẩm</label>
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 max-w-[220px]">
            <option value="all">Tất cả sản phẩm</option>
            {products.map((p) => <option key={p.maSP} value={p.maSP}>{p.maSP} · {p.tenSP}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-slate-500">Tìm theo số lô</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-300 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={loQuery} onChange={(e) => setLoQuery(e.target.value)} placeholder="Số lô thành phẩm"
              className="pl-7 pr-2 py-1.5 w-40 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-slate-500">Lọc thời gian theo</label>
          <select value={dateField} onChange={(e) => { setDateField(e.target.value); setDateFrom(""); setDateTo(""); }}
            className="border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400">
            <option value="nsx">NSX</option>
            <option value="hsd">HSD</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-slate-500">Từ</label>
          <DateInputVN value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-24 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-slate-500">Đến</label>
          <DateInputVN value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-24 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        </div>
        {hasActiveFilter && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-slate-500 hover:text-rose-600 py-1.5">
            <X className="w-3.5 h-3.5" /> Xoá bộ lọc
          </button>
        )}
      </div>
      {!visibleProducts.length && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">Không tìm thấy sản phẩm.</div>
      )}
      {visibleProducts.map((p) => {
        const allList = (groups[norm(p.tenSP)] || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const list = allList.filter(matchesRow);
        if (hasRowFilter && !list.length) return null; // đang lọc theo lô/ngày, sản phẩm này không có mẻ khớp -> ẩn cả card
        const totalSoLuong = list.reduce((s, b) => s + (Number(b.soLuongDuKien) || 0), 0);
        const highlighted = focusMaSP === p.maSP;
        return (
          <div key={p.maSP} ref={(el) => { cardRefs.current[p.maSP] = el; }}
            className={`bg-white rounded-lg border overflow-hidden transition ${highlighted ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
              <FlaskConical className="w-4 h-4 text-emerald-600" />
              <h2 className="font-semibold text-sm">{p.maSP} · {p.tenSP}</h2>
              <span className="text-xs text-slate-400">{list.length} mẻ đã pha</span>
              {totalSoLuong > 0 && <span className="text-xs text-slate-400 ml-auto">Tổng dự kiến: <b className="text-slate-600">{fmt(totalSoLuong, 0)}</b> ống</span>}
            </div>
            {!list.length ? (
              <div className="p-5 text-center text-slate-400 text-xs">Chưa có mẻ nào được xác nhận đã pha cho sản phẩm này.</div>
            ) : (
              <div className="overflow-x-auto">
                {/* table-fixed + cột rộng cố định — mọi sản phẩm cùng qua đúng các công đoạn này nên
                    layout phải giống hệt nhau từ trên xuống dưới, không để bề rộng nhảy theo nội dung
                    dài/ngắn từng dòng. Cột "Xử lý..." tự động cắt bớt (…) nếu dài, xem đủ bằng cách
                    di chuột vào (title). */}
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col className="w-20" /><col className="w-24" />
                    <col className="w-36" /><col className="w-36" /><col className="w-36" /><col className="w-36" />
                    <col className="w-32" /><col className="w-24" /><col className="w-24" /><col className="w-24" />
                  </colgroup>
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>{["Mẻ pha", "SL dự kiến (ống)", "Xử lý nguyên liệu đầu vào", "Xử lý BTP sau pha", "Xử lý BTP sau đóng ống", "Quy trình xử lý khác nếu có", "Sản phẩm hoàn thiện", "Số lô", "NSX", "HSD"].map((h, i) => <th key={i} className="px-2 py-2 font-medium text-center align-middle leading-tight">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {list.map((b) => (
                      <tr key={b.id} className="border-b border-slate-50">
                        <td className="px-2 py-1.5 font-mono text-center truncate" title={b.phaMe || ""}>{b.phaMe}</td>
                        <td className="px-2 py-1 text-right">{b.soLuongDuKien != null ? fmt(b.soLuongDuKien, 0) : "–"}</td>
                        <td className="px-2 py-1.5 text-slate-600 truncate" title={b.xuLyNguyenLieuDauVao || ""}>{b.xuLyNguyenLieuDauVao || "–"}</td>
                        <td className="px-2 py-1.5 text-slate-600 truncate" title={b.xuLyBtpSauPha || ""}>{b.xuLyBtpSauPha || "–"}</td>
                        <td className="px-2 py-1.5 text-slate-600 truncate" title={b.xuLySauDongOng || ""}>{b.xuLySauDongOng || "–"}</td>
                        <td className="px-2 py-1.5 text-slate-600 truncate" title={b.quyTrinhKhac || ""}>{b.quyTrinhKhac || "–"}</td>
                        <td className="px-2 py-1 truncate">{canEdit ? <EditText v={b.tenHoanThien} on={(x) => edit(b.id, "tenHoanThien", x)} w="w-full" ph="vd tên/quy cách" title={b.tenHoanThien || ""} /> : (b.tenHoanThien || "–")}</td>
                        <td className="px-2 py-1 text-center truncate">{canEdit ? <EditText v={b.soLo} on={(x) => edit(b.id, "soLo", x)} w="w-full" ph="Số lô" /> : (b.soLo || "–")}</td>
                        <td className="px-2 py-1 text-center">
                          {canEdit ? (
                            <DateInputVN value={b.nsx || ""} onChange={(e) => edit(b.id, "nsx", e.target.value || null)}
                              className="w-full text-xs text-center border border-slate-200 rounded px-1.5 py-1" />
                          ) : (b.nsx ? new Date(b.nsx).toLocaleDateString("vi-VN") : "–")}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {canEdit ? (
                            <DateInputVN value={b.hsd || ""} onChange={(e) => edit(b.id, "hsd", e.target.value || null)}
                              className="w-full text-xs text-center border border-slate-200 rounded px-1.5 py-1" />
                          ) : (b.hsd ? new Date(b.hsd).toLocaleDateString("vi-VN") : "–")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Sản phẩm ---------------- */
function ProductPanel({ products, setProducts, setNote, isAdmin, canEdit }) {
  const addFromForm = async (draft) => {
    const p = {
      ...draft, maSP: draft.maSP.trim().toUpperCase(),
      hamLuong: num(draft.hamLuong) ?? 0, tubeMl: num(draft.tubeMl) ?? 0, soOngNhip: num(draft.soOngNhip) ?? 0,
      pool2: draft.pool2 || null, hamLuong2: draft.pool2 ? num(draft.hamLuong2) ?? null : null,
      thanhPhan2: draft.pool2 ? draft.thanhPhan2 : null, allowOtherLoai: false,
      sortOrder: products.length,
    };
    setProducts((prev) => [...prev, p]);
    try { await addProduct(p); } catch (err) { setNote(`Lỗi thêm sản phẩm: ${err.message}`); throw err; }
  };
  const [dragIndex, setDragIndex] = useState(null);
  const dropAt = (dropIndex) => {
    if (dragIndex === null || dragIndex === dropIndex) { setDragIndex(null); return; }
    const reordered = [...products];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setProducts(reordered);
    setDragIndex(null);
    reorderProducts(reordered.map((x) => x.maSP)).catch((err) => setNote(`Lỗi lưu thứ tự: ${err.message}`));
  };
  const edit = (i, f, v) => {
    let value = ["hamLuong", "tubeMl", "soOngNhip"].includes(f) ? num(v) ?? 0
      : f === "hamLuong2" ? num(v) ?? null
      : f === "pool2" ? (v || null)
      : v;
    setProducts((prev) => prev.map((x, j) => (j === i ? { ...x, [f]: value } : x)));
    updateProductField(products[i].maSP, f, value).catch((err) => setNote(`Lỗi lưu sản phẩm: ${err.message}`));
  };
  const del = (i) => {
    const maSP = products[i].maSP;
    setProducts((prev) => prev.filter((_, j) => j !== i));
    removeProduct(maSP).catch((err) => setNote(`Lỗi xoá sản phẩm: ${err.message}`));
  };
  const PoolSel = ({ v, on }) => (
    <select value={v} disabled={!canEdit} onChange={(e) => on(e.target.value)} className="text-xs border border-slate-200 rounded px-1 py-1 disabled:bg-slate-50 disabled:text-slate-400">
      <option value="subtilis">subtilis</option><option value="clausii-loai1">clausii (1)</option><option value="clausii-loai2">clausii (2)</option>
    </select>
  );
  const PoolSel2 = ({ v, on }) => (
    <select value={v || ""} disabled={!canEdit} onChange={(e) => on(e.target.value)} className="text-xs border border-slate-200 rounded px-1 py-1 disabled:bg-slate-50 disabled:text-slate-400">
      <option value="">— không có —</option>
      <option value="subtilis">subtilis</option><option value="clausii-loai1">clausii (1)</option><option value="clausii-loai2">clausii (2)</option>
    </select>
  );
  const isClausiiLoai = (pool) => pool === "clausii-loai1" || pool === "clausii-loai2";
  return (
    <>
      {canEdit && <AddProductForm onAdd={addFromForm} />}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Droplets className="w-4 h-4 text-emerald-600" /><h2 className="font-semibold text-sm">Danh mục sản phẩm sinh phẩm</h2>
        <span className="text-xs text-slate-400 ml-auto hidden sm:inline">Chọn mã SP khi pha → tự lấy thành phần, hàm lượng, NCV</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-400 text-left">
            <tr>{[...(isAdmin ? [""] : []), "Mã SP","Tên","Thành phần","Nguồn NL","Hàm lượng (cfu/ml)","Dùng loại khác dự phòng","Ống (ml)","Ống/nhịp","NCV",""].map((h,i)=><th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const rows = p.pool2 ? 2 : 1;
              const clausiiPool = isClausiiLoai(p.pool) ? p.pool : isClausiiLoai(p.pool2) ? p.pool2 : null;
              const otherLoaiLabel = clausiiPool === "clausii-loai1" ? "clausii (2)" : clausiiPool === "clausii-loai2" ? "clausii (1)" : null;
              const allowOtherCell = clausiiPool
                ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <input type="checkbox" checked={!!p.allowOtherLoai} disabled={!canEdit} onChange={(e) => edit(i, "allowOtherLoai", e.target.checked)} className="accent-emerald-600 disabled:opacity-40" />
                    {p.allowOtherLoai && <span className="text-[10px] text-slate-500 whitespace-nowrap">NL thay thế: {otherLoaiLabel}</span>}
                  </div>
                )
                : <span className="text-slate-300">–</span>;
              const zebra = i % 2 === 1;
              const rowBg = zebra ? "bg-indigo-100/70" : "bg-white";
              return (
                <React.Fragment key={p.maSP}>
                  <tr
                    className={`${rows === 1 ? "border-b-2 border-slate-400" : "border-b border-slate-300"} ${rowBg} ${isAdmin && dragIndex === i ? "opacity-40" : ""}`}
                    onDragOver={(e) => { if (isAdmin) e.preventDefault(); }}
                    onDrop={(e) => { if (isAdmin) { e.preventDefault(); dropAt(i); } }}
                  >
                    {isAdmin && (
                      <td rowSpan={rows} className="px-1 align-top text-center cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragIndex(i); }}
                        onDragEnd={() => setDragIndex(null)}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-slate-300 mx-auto" />
                      </td>
                    )}
                    <td rowSpan={rows} className="px-3 py-1.5 font-mono font-medium align-top">{p.maSP}</td>
                    <td rowSpan={rows} className="px-2 py-1 align-top"><EditText v={p.tenSP} on={(v) => edit(i, "tenSP", v)} w="w-28" disabled={!canEdit} /></td>
                    <td className="px-2 py-1"><EditText v={p.thanhPhan} on={(v) => edit(i, "thanhPhan", v)} w="w-40" disabled={!canEdit} /></td>
                    <td className="px-2 py-1"><PoolSel v={p.pool} on={(v) => edit(i, "pool", v)} /></td>
                    <td className="px-2 py-1"><EditText v={p.hamLuong} on={(v) => edit(i, "hamLuong", v)} w="w-24" disabled={!canEdit} /></td>
                    <td rowSpan={rows} className="px-2 py-1 text-center align-top">{allowOtherCell}</td>
                    <td rowSpan={rows} className="px-2 py-1 align-top"><EditText v={p.tubeMl} on={(v) => edit(i, "tubeMl", v)} w="w-14" disabled={!canEdit} /></td>
                    <td rowSpan={rows} className="px-2 py-1 align-top"><EditText v={p.soOngNhip} on={(v) => edit(i, "soOngNhip", v)} w="w-20" disabled={!canEdit} /></td>
                    <td rowSpan={rows} className="px-2 py-1 align-top"><EditText v={p.ncv} on={(v) => edit(i, "ncv", v)} w="w-20" disabled={!canEdit} /></td>
                    <td rowSpan={rows} className="px-3 py-1.5 text-right align-top">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-1.5">
                          {!p.pool2 && (
                            <button
                              onClick={() => edit(i, "pool2", p.pool === "subtilis" ? "clausii-loai1" : "subtilis")}
                              title="Thêm thành phần 2" className="text-slate-300 hover:text-emerald-600">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => del(i)} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {p.pool2 && (
                    <tr className={`border-b-2 border-slate-400 ${rowBg}`}>
                      <td className="px-2 py-1"><EditText v={p.thanhPhan2} on={(v) => edit(i, "thanhPhan2", v)} w="w-40" disabled={!canEdit} /></td>
                      <td className="px-2 py-1"><PoolSel2 v={p.pool2} on={(v) => edit(i, "pool2", v)} /></td>
                      <td className="px-2 py-1"><EditText v={p.hamLuong2} on={(v) => edit(i, "hamLuong2", v)} w="w-24" disabled={!canEdit} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 px-4 py-2">Hàm lượng nhập theo cfu/ml (chấp nhận 4e8 hoặc 400000000) – do NCV quyết định cho từng sản phẩm.</p>
      </div>
    </>
  );
}

/* ---------------- Quản lý người dùng (admin) ---------------- */
const USER_STATUS_LABEL = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" };
const USER_STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};
function UsersPanel({ profiles, onUpdate, currentUserId, onCreated }) {
  const [showCreate, setShowCreate] = useState(false);
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-600" /><h2 className="font-semibold text-sm">Quản lý người dùng</h2>
        </div>
        <button onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
          <Plus className="w-3.5 h-3.5" /> {showCreate ? "Đóng" : "Tạo tài khoản"}
        </button>
      </div>
      {showCreate && (
        <CreateUserForm onDone={() => { setShowCreate(false); onCreated?.(); }} onCancel={() => setShowCreate(false)} />
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-400 text-left">
            <tr>{["Họ tên","Số điện thoại","Email","Phòng ban","Mã NV","Vai trò","Trạng thái",""].map((h,i)=><th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="px-3 py-1.5">{p.fullName || "–"}</td>
                <td className="px-3 py-1.5 font-mono">{p.phone || "–"}</td>
                <td className="px-3 py-1.5"><EditableEmailCell profile={p} onUpdate={onUpdate} /></td>
                <td className="px-3 py-1.5">{p.department || "–"}</td>
                <td className="px-3 py-1.5">{p.employeeCode || "–"}</td>
                <td className="px-2 py-1">
                  <select value={p.role} disabled={p.id === currentUserId}
                    onChange={(e) => onUpdate(p.id, { role: e.target.value })}
                    className="text-xs border border-slate-200 rounded px-1.5 py-1 disabled:bg-slate-50 disabled:text-slate-400">
                    <option value="rd">RD</option>
                    <option value="qa">QA</option>
                    <option value="qc">QC</option>
                    <option value="kh">KH</option>
                    <option value="ktv">KTV</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${USER_STATUS_STYLE[p.status]}`}>{USER_STATUS_LABEL[p.status]}</span>
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {p.status === "pending" && (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => onUpdate(p.id, { status: "approved" })} className="text-emerald-600 hover:underline">Duyệt</button>
                      <button onClick={() => onUpdate(p.id, { status: "rejected" })} className="text-rose-500 hover:underline">Từ chối</button>
                    </div>
                  )}
                  {p.status === "approved" && p.id !== currentUserId && (
                    <button onClick={() => onUpdate(p.id, { status: "rejected" })} className="text-rose-500 hover:underline">Thu hồi</button>
                  )}
                  {p.status === "rejected" && (
                    <button onClick={() => onUpdate(p.id, { status: "approved" })} className="text-emerald-600 hover:underline">Duyệt lại</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Form tạo tài khoản mới trong tab "Người dùng" — chỉ admin thấy (UsersPanel đã gate ở
// Sidebar/Connected). Mật khẩu chỉ gửi đúng 1 lần qua HTTPS tới api/admin-create-user.js, Supabase
// băm ngay lập tức — không lưu lại state sau khi submit, không có API nào đọc lại được plaintext.
const DEPT_ROLE_DEFAULT = { RD: "rd", QA: "qa", QC: "qc", KH: "kh" };
function CreateUserForm({ onDone, onCancel }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("QC");
  const [role, setRole] = useState("qc");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      await adminCreateUser({ fullName, phone, password, department, role });
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-slate-500">Họ tên</label>
          <input required autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Tên đăng nhập (SĐT)</label>
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912345678"
            className="w-full mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Mật khẩu</label>
          <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-slate-500">Phòng ban</label>
            <select value={department}
              onChange={(e) => { setDepartment(e.target.value); setRole(DEPT_ROLE_DEFAULT[e.target.value] || "qc"); }}
              className="w-full mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="RD">RD</option>
              <option value="QA">QA</option>
              <option value="QC">QC</option>
              <option value="KH">KH</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-slate-500">Vai trò</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="rd">RD</option>
              <option value="qa">QA</option>
              <option value="qc">QC</option>
              <option value="kh">KH</option>
              <option value="ktv">KTV</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-[#28374a] text-white text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Tạo tài khoản
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:underline">Huỷ</button>
        <span className="text-[11px] text-slate-400">Tài khoản được duyệt sẵn, đăng nhập được ngay bằng SĐT + mật khẩu vừa đặt.</span>
      </div>
    </form>
  );
}

// Ô email trong tab "Người dùng":
// - Nếu người dùng đang có 1 yêu cầu đổi email chờ duyệt (pendingEmail) -> hiện nút Duyệt/Từ
//   chối thay vì cho sửa trực tiếp.
// - Ngược lại -> admin bấm để sửa thẳng (set ngay, auto-confirm qua api/set-user-email.js).
function EditableEmailCell({ profile, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!value.includes("@")) { setError("Sai định dạng email."); return; }
    setSaving(true); setError("");
    try {
      await setUserEmail({ targetUserId: profile.id, newEmail: value });
      onUpdate(profile.id, { email: value, pendingEmail: null });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const approve = async () => {
    setSaving(true); setError("");
    try {
      await setUserEmail({ targetUserId: profile.id, newEmail: profile.pendingEmail });
      onUpdate(profile.id, { email: profile.pendingEmail, pendingEmail: null });
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };
  const reject = () => onUpdate(profile.id, { pendingEmail: null });

  if (profile.pendingEmail) {
    return (
      <div className="space-y-0.5">
        <div>{profile.email || <span className="text-slate-400">–</span>} → <b className="text-amber-600">{profile.pendingEmail}</b></div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={approve} disabled={saving} className="text-emerald-600 hover:underline disabled:opacity-40">Duyệt</button>
          <button type="button" onClick={reject} disabled={saving} className="text-rose-500 hover:underline disabled:opacity-40">Từ chối</button>
        </div>
        {error && <div className="text-rose-600 whitespace-normal">{error}</div>}
      </div>
    );
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setValue(profile.email || ""); setEditing(true); }}
        className="text-left hover:underline decoration-dotted">
        {profile.email || <span className="text-slate-400">– (bấm để thêm)</span>}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <input type="email" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        className="border border-slate-300 rounded px-1.5 py-1 text-xs w-40" />
      <button type="submit" disabled={saving} className="text-emerald-600 hover:underline disabled:opacity-40">Lưu</button>
      <button type="button" onClick={() => { setEditing(false); setError(""); }} className="text-slate-400 hover:underline">Huỷ</button>
      {error && <span className="text-rose-600 whitespace-normal">{error}</span>}
    </form>
  );
}

/* ---------------- Tài khoản của tôi (đổi mật khẩu / thêm-đổi email) ---------------- */
function AccountSettingsPanel({ session, profile }) {
  const isPhoneAccount = !!session.user.phone;
  const hasRealEmail = !!session.user.email && !session.user.email.endsWith(`@${LEGACY_PHONE_EMAIL_DOMAIN}`);
  const isAdmin = profile?.role === "admin";
  const [pendingEmail, setPendingEmailLocal] = useState(profile?.pendingEmail || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwError(""); setPwDone(false);
    if (pw !== pw2) { setPwError("Mật khẩu xác nhận không khớp."); return; }
    if (pw.length < 6) { setPwError("Mật khẩu cần ít nhất 6 ký tự."); return; }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setPwError(error.message); else { setPwDone(true); setPw(""); setPw2(""); }
    setPwSaving(false);
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    setEmailError(""); setEmailSent(false);
    if (!newEmail.includes("@")) { setEmailError("Nhập đúng định dạng email."); return; }
    setEmailSaving(true);
    try {
      if (isAdmin) {
        // Admin tự sửa email của chính mình -> áp dụng ngay, không cần ai duyệt.
        await setUserEmail({ newEmail });
        await supabase.auth.refreshSession(); // để session.user.email cập nhật ngay, khỏi cần tải lại trang
        setPendingEmailLocal("");
      } else {
        // Người dùng thường -> chỉ gửi YÊU CẦU, chờ admin duyệt mới có hiệu lực đăng nhập.
        await requestEmailChange(newEmail);
        setPendingEmailLocal(newEmail);
      }
      setEmailSent(true);
      setNewEmail("");
    } catch (err) {
      setEmailError(err.message);
    }
    setEmailSaving(false);
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Settings className="w-4 h-4" /> Tài khoản của tôi</h3>
        <p className="text-xs text-slate-500">
          Đăng nhập được bằng:{" "}
          {isPhoneAccount && <><b className="text-slate-700">số điện thoại</b> ({identityLabel(session.user)})</>}
          {isPhoneAccount && hasRealEmail && " và "}
          {hasRealEmail && <><b className="text-slate-700">email</b> ({session.user.email})</>}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Đổi mật khẩu</h3>
        <form onSubmit={submitPassword} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">Mật khẩu mới</label>
            <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Xác nhận mật khẩu mới</label>
            <input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
          </div>
          {pwError && <p className="text-xs text-rose-600">{pwError}</p>}
          {pwDone && <p className="text-xs text-emerald-600">Đã đổi mật khẩu thành công.</p>}
          <button type="submit" disabled={pwSaving}
            className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40">
            {pwSaving && <Loader2 className="w-4 h-4 animate-spin" />} Đổi mật khẩu
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Mail className="w-4 h-4" /> {hasRealEmail ? "Đổi email" : "Thêm email"}</h3>
        <p className="text-xs text-slate-500 mb-3">
          {isAdmin
            ? "Đổi email của chính bạn — có hiệu lực ngay, không cần ai duyệt."
            : hasRealEmail
              ? "Muốn đổi sang email khác? Gửi yêu cầu bên dưới — cần admin duyệt thì mới có hiệu lực (email cũ vẫn dùng được cho tới lúc đó)."
              : isPhoneAccount
                ? "Tài khoản đang đăng nhập bằng số điện thoại. Gửi yêu cầu thêm email thật bên dưới — cần admin duyệt thì mới đăng nhập được bằng email (vẫn đăng nhập được bằng SĐT như cũ)."
                : "Chưa có email thật. Gửi yêu cầu bên dưới — cần admin duyệt thì mới có hiệu lực."}
        </p>
        {pendingEmail && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-3">
            Yêu cầu đổi sang <b>{pendingEmail}</b> đang chờ admin duyệt.
          </p>
        )}
        <form onSubmit={submitEmail} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">Email {hasRealEmail ? "mới" : "muốn thêm"}</label>
            <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-md px-3 py-2 text-sm" />
          </div>
          {emailError && <p className="text-xs text-rose-600">{emailError}</p>}
          {emailSent && <p className="text-xs text-emerald-600">{isAdmin ? "Đã lưu email thành công." : "Đã gửi yêu cầu, chờ admin duyệt."}</p>}
          <button type="submit" disabled={emailSaving}
            className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40">
            {emailSaving && <Loader2 className="w-4 h-4 animate-spin" />} {isAdmin ? "Lưu" : "Gửi yêu cầu"}
          </button>
        </form>
      </div>
    </div>
  );
}

// NLTrendPanel (Xu hướng NL) chuyển sang src/NLTrendPanel.jsx, nhúng làm tab con trong
// Cảnh báo lên men > Tổng quan (LenMenOverview.jsx) — xem lý do ở đầu file đó.
