// Thuật toán tính mẻ pha & phân bổ lô nguyên liệu (NL) cho 1 nhịp sản xuất.
// Xem đặc tả gốc: DAC_TA_thuat_toan_tinh_me_pha.md (chốt cùng NCV 2026-07-28).
//
// Công thức lõi (bảo toàn tổng bào tử, đã đối chiếu với Công_thức_tính.xlsx):
//   V_i (thể tích dịch pha từ lô i, L)   = F_i * E_i / d
//   n_i (số ống từ lô i)                 = F_i * E_i * 1000 / (d * H)
// với E = định lượng lô (CFU/ml), F = thể tích dịch lô đem dùng (L),
//     d = mật độ pha thực tế (CFU/ml), H = thể tích 1 ống (ml).
//
// Ràng buộc đã chốt với NCV (2026-07-28, nâng trần tank 2026-07-29):
//   - Tank mỗi mẻ: dưới 1080 L (có du di so với mốc lý tưởng 1000L).
//   - Tối đa 3 chai (lô) NL mở trong 1 mẻ — tính gộp cả 2 chủng nếu SP có 2 thành phần
//     (xưởng không có chỗ lưu quá nhiều chai dở cùng lúc).
//   - Số ống thành phẩm T ∈ [0.9N, 1.1N], ưu tiên T cao (sát 1.1N).
//   - Mật độ pha d ∈ [G, 1.05G], không bao giờ dưới mật độ đích G.
//   - Lô đã chọn vào nhịp phải dùng hết 100% (không để dở dang).
//   - SP 2 thành phần — xem 3 nguyên tắc ở đầu mục "SẢN PHẨM 2 THÀNH PHẦN" (chốt lại NCV
//     2026-10-08): chốt cứng chai clausii nguyên vẹn trước, subtilis khớp theo (chỉ 1 chai dở),
//     chia mẻ tối ưu toàn cục, không mẻ nào dưới 700L trừ khi không tránh được.
//   - Chỉ chọn lô đang ở trạng thái "Chờ pha" (đã qua KQKN, đạt).
//   - Không giới hạn cứng số lần 1 lô bị tách qua nhiều mẻ, chỉ tối thiểu hoá.
//   - SP 2 thành phần (subtilis + clausii pha chung 1 tank): 2 mật độ đích riêng
//     (G_subtilis, G_clausii) phải cùng đạt trong CÙNG 1 thể tích mẻ → ưu tiên dùng clausii từ
//     càng ít lô càng tốt (lý tưởng 1 lô/nhịp). Với SP có 2 loại NL clausii (vd Co-biozin: loại 2
//     là chính, loại 1 dự phòng — field `priority` trên lô, 0=chính/1=dự phòng, xem fifoCompare):
//     LUÔN dùng hết sạch loại chính trước, chỉ chạm loại dự phòng khi loại chính không đủ.
//   - Vệ sinh — tiệt trùng hệ thống: chỉ cần khi tank đã lần lượt dùng qua TỐI THIỂU 3 lô sản xuất
//     khác nhau kể từ lần tiệt trùng gần nhất (không phải cứ đổi lô là tiệt trùng ngay) — xem
//     computeSterilizeFlags trong src/App.jsx.

export const TANK_MAX_L = 1080;
// Trần cứng, KHÔNG có ngoại lệ — từng có 1 ngoại lệ "hiếm" cho phép 4 chai/mẻ khi ghép cân đối 2
// chủng (SP 2 thành phần), nhưng NCV đã bỏ hẳn ngoại lệ đó (2026-07-30): thể tích pha giờ luôn phải
// là bội số 0.5L (xem RAW_ROUND_STEP_L) và clausii luôn dùng hết cả chai, nên không cần tới 4 chai
// nữa — luôn giới hạn đúng 3.
export const MAX_LOTS_PER_BATCH = 3;
export const TUBE_TOL_LOW = 0.9;
export const TUBE_TOL_HIGH = 1.1;
export const DENSITY_TOL_HIGH = 1.05;


const EPS = 1e-6;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cfuOfLot = (lot) => lot.E * lot.F * 1000; // tổng bào tử của cả lô (CFU)

// Mã "lô sản xuất" (đợt lên men, không phải từng chai) — dùng để tránh trộn NL của 2 lô sản
// xuất khác nhau trong CÙNG 1 mẻ (nguy cơ nhiễm chéo không kiểm soát được giữa các đợt). Ưu
// tiên field loSanXuat truyền vào; nếu không có thì tự suy ra từ mã chai (bỏ phần ".Cxx" cuối).
const loSanXuatOf = (lot) => lot.loSanXuat ?? String(lot.maLo).replace(/\.[^.]*$/, "");

/** Nhóm các lô đã sort theo lô sản xuất, giữ nguyên thứ tự xuất hiện. */
function groupByLoSanXuat(orderedLots) {
  const groups = [];
  const byKey = {};
  for (const lot of orderedLots) {
    const key = loSanXuatOf(lot);
    if (!byKey[key]) {
      byKey[key] = { loSanXuat: key, lots: [] };
      groups.push(byKey[key]);
    }
    byKey[key].lots.push(lot);
  }
  return groups;
}

// So sánh mã lô kiểu "tự nhiên": các đoạn số trong chuỗi so theo giá trị số (để "...C2" đứng
// trước "...C10"), không so kiểu chuỗi thuần (sẽ ra "...C10" trước "...C2", sai thứ tự).
function naturalCompareMaLo(a, b) {
  const re = /(\d+)|(\D+)/g;
  const pa = String(a).match(re) || [];
  const pb = String(b).match(re) || [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Tìm các tổ hợp lô (subset) mà tổng "giá trị" (Σ E_i·F_i, đơn vị L·CFU/ml) rơi
 * vào [vMin, vMax]. Duyệt nhánh-và-cận (branch & bound) trên danh sách đã sắp
 * giảm dần — đủ nhanh cho vài chục lô thực tế; không dùng cho kho >30 lô.
 */
export function enumerateFeasibleSubsets(lots, vMin, vMax, { maxCandidates = 500 } = {}) {
  const sorted = [...lots].sort((a, b) => b.E * b.F - a.E * a.F);
  const n = sorted.length;
  const suffixMax = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixMax[i] = suffixMax[i + 1] + sorted[i].E * sorted[i].F;

  const results = [];
  const chosen = [];
  function dfs(i, sum) {
    if (results.length >= maxCandidates) return;
    if (sum > vMax + EPS) return; // đã vượt trần, mọi lô còn lại đều dương → không lùi lại được
    if (sum + suffixMax[i] < vMin - EPS) return; // dù cộng hết phần còn lại vẫn không tới sàn
    if (i === n) {
      if (chosen.length > 0 && sum >= vMin - EPS && sum <= vMax + EPS) {
        results.push({ subset: [...chosen], sumValue: sum });
      }
      return;
    }
    chosen.push(sorted[i]);
    dfs(i + 1, sum + sorted[i].E * sorted[i].F);
    chosen.pop();
    dfs(i + 1, sum);
  }
  dfs(0, 0);
  return results;
}

// So sánh theo NGÀY THU THẬT (thoiGianThu, dạng ISO "YYYY-MM-DD" — so chuỗi trực tiếp là đủ
// đúng thứ tự). Ưu tiên field này hơn mã lô vì mã lô chỉ mã hoá ngày SẢN XUẤT (đợt lên men) —
// ngày THU THỰC TẾ có thể trễ hơn vài ngày và không phải lúc nào cũng khớp thứ tự mã lô (NCV
// phản ánh 2026-09: có chai thu trước nhưng mã lô "trẻ" hơn vẫn bị xếp pha sau). Trả về 0 (coi
// như bằng nhau, nhường cho tiêu chí kế tiếp) nếu 1 trong 2 lô thiếu ngày thu — dữ liệu cũ/nhập
// tay thiếu sót vẫn phải xếp được, không được lỗi hay rơi ra ngoài kế hoạch.
function compareThoiGianThu(a, b) {
  if (!a.thoiGianThu || !b.thoiGianThu) return 0;
  return a.thoiGianThu < b.thoiGianThu ? -1 : a.thoiGianThu > b.thoiGianThu ? 1 : 0;
}

/**
 * Chọn lô theo FIFO — NL THU CÀNG LÂU càng ưu tiên dùng trước (tránh tồn kho quá hạn), ưu tiên
 * so theo đúng ngày thu thật (compareThoiGianThu); khi thiếu ngày thu mới lùi về so mã lô (đáng
 * tin thứ nhì vì mã lô cũng mã hoá ngày sản xuất, thường sát ngày thu). Vì đi tuần tự theo tuổi
 * lô, tự nhiên cũng gom các chai CÙNG 1 lô sản xuất lại với nhau (ít lô sản xuất bị chạm tới hơn
 * = ít lần tiệt trùng hơn) — không cần tối ưu 2 mục tiêu này tách riêng. Tích luỹ dần tới khi VỪA
 * CHẠM mục tiêu `target` — LUÔN dùng TRỌN lô làm nó vượt qua mốc (không cắt bớt để né vượt), số
 * ống ra có thể nhỉnh hơn mục tiêu một chút do làm tròn theo từng lô — chấp nhận được, NCV xem
 * kết quả rồi quyết định dùng hết hay bớt lại.
 *
 * Nếu lô có field `priority` (0 = loại chính, 1 = loại dự phòng — vd Progermila ưu tiên clausii
 * loại 1, chỉ đụng loại 2 khi loại 1 không đủ), luôn xếp hết loại chính (theo tuổi) trước khi
 * chạm tới loại dự phòng, bất kể tuổi lô loại dự phòng có cũ hơn hay không.
 */
function fifoCompare(a, b) {
  return (a.priority ?? 0) - (b.priority ?? 0)
    || compareThoiGianThu(a, b)
    || naturalCompareMaLo(loSanXuatOf(a), loSanXuatOf(b))
    || naturalCompareMaLo(a.maLo, b.maLo);
}

function selectLotsFifo(lots, target) {
  const sorted = [...lots].sort(fifoCompare);
  const chosen = [];
  let sum = 0;
  for (const lot of sorted) {
    if (sum >= target - EPS) break;
    chosen.push(lot);
    sum += lot.E * lot.F;
  }
  return chosen.length ? { subset: chosen, sumValue: sum } : null;
}

/**
 * Giải mật độ pha d và số ống T cho 1 tổng giá trị lô đã chọn (Pha B). Mật độ mục tiêu LUÔN
 * ĐÚNG BẰNG G (không dò một d cao hơn để ép số ống về khung ±10%) — cần bao nhiêu nước cứ thêm
 * đủ để đạt đúng G, số ống ra bao nhiêu báo đúng bấy nhiêu, kể cả khi vượt quá mục tiêu N; NCV
 * xem kết quả rồi tự quyết định pha hết hay bớt lại lô nào.
 */
export function densityAndTubes(sumValue, { H, G }) {
  const S = sumValue * 1000; // tổng CFU
  const d = G;
  const T = Math.floor(S / (d * H));
  return { d, T, S };
}

/** Đối soát bảo toàn bào tử: tổng CFU vào (lô đã chọn) so với tổng CFU ra (ống thành phẩm). */
export function checkMassBalance(selectedLots, d, T, H) {
  const totalIn = selectedLots.reduce((s, l) => s + cfuOfLot(l), 0);
  const totalOut = T * d * H;
  const diffPct = totalIn > 0 ? (Math.abs(totalIn - totalOut) / totalIn) * 100 : 0;
  return { totalIn, totalOut, diffPct, pass: diffPct < 1 }; // <1% là do làm tròn ống nguyên
}

// ---------------------------------------------------------------------------
// SẢN PHẨM 1 THÀNH PHẦN
// ---------------------------------------------------------------------------

// Bước đong nguyên liệu nhỏ nhất nhân viên xưởng đong được — mọi lần đong được làm tròn về
// bội số của mức này.
const RAW_ROUND_STEP_L = 0.5;

// Mốc "mềm" — mục tiêu chia mẻ, thấp hơn hẳn trần cứng để không mẻ nào kịch trần/vượt trần.
// Các mẻ KHÔNG cần bằng nhau tuyệt đối, chỉ cần không mẻ nào quá đầy (kịch/vượt trần) hay quá
// vơi so với mặt bằng chung.
const SOFT_TARGET_L = 1000;

// Ngưỡng "nhỉnh hơn cho phép" — khi cần dồn nốt 1 chai để tránh để lại mẩu vụn (xem
// MIN_LOT_FRAGMENT_L), mẻ được phép vượt mốc mềm SOFT_TARGET_L tới tối đa mức này, KHÔNG được
// vượt luôn tới sát trần cứng TANK_MAX_L (chốt NCV 2026-08-10: mốc mềm 1000L, cho nhỉnh tới
// 1050L, trần tuyệt đối vẫn là 1080L).
const SOFT_OVERFLOW_L = 1050;

/**
 * Đóng mẻ theo hướng: CHỐT lượng nguyên liệu (F) đẹp (bội số 0.5L) trước, từ đó SUY RA thể
 * tích dịch pha (V = F·E/d) — không làm ngược lại (chốt V trước rồi ép F vừa khít) như trước,
 * vì cách cũ có lúc về mặt toán học không thể vừa làm tròn vừa đảm bảo mật độ. Với cách này,
 * mật độ của MỌI phần luôn ĐÚNG BẰNG d (không hơn không kém) vì V luôn được tính lại từ đúng F
 * thực tế — không bao giờ hụt, và mọi lần đong (trừ lần đổ nốt 1 chai) đều là số đẹp.
 */
// Mẻ mà thể tích dưới mức này (so với mốc mềm) coi là "quá vơi" — thà ghép thêm chút NL của
// lô sản xuất kế tiếp vào (kèm cảnh báo cần tiệt trùng ngay sau) còn hơn để 1 mẻ lẻ tẻ.
const MIN_BATCH_FRACTION = 0.8;

// Sàn CỨNG tuyệt đối — không mẻ nào được dưới mức này (NCV yêu cầu rõ), trừ khi ghép cũng không
// giải quyết được (chỉ còn đúng 1 mẻ duy nhất, hoặc ghép sẽ vượt trần tank / vượt quá 3 lô).
export const MIN_BATCH_L = 700; // nâng từ 500L lên 700L (chốt NCV 2026-10-08)

// Khi 1 lô bị tách ra dùng ở 2 mẻ liền nhau, nếu phần CÒN LẠI (chuyển sang mẻ sau) từ mức này
// (đơn vị lít NL thô) TRỞ XUỐNG thì coi là "mẩu vụn" khó đong thực tế — thà dùng LUÔN TRỌN VẸN
// phần còn lại đó ngay trong mẻ hiện tại (chấp nhận vượt nhẹ mốc mềm hoặc dư mật độ thêm chút,
// miễn vẫn còn trong trần cứng/trần mật độ), còn hơn để lại 1 mẩu ≤1L khó đong ở mẻ kế tiếp (NCV
// chốt 2026-07-29: "0.5L hay 1L thật sự quá nhỏ... từ 1L đổ xuống thì dùng cho hết, đừng làm lẻ
// ra nữa — tăng nước hoặc tăng mật độ thành phẩm cũng không sao hết").
export const MIN_LOT_FRAGMENT_L = 1;

/**
 * Ghép các mẻ dưới sàn cứng MIN_BATCH_L vào mẻ liền kề — thử ghép NGƯỢC vào mẻ liền TRƯỚC trước
 * (ít xáo trộn thứ tự nhất), không được thì thử ghép XUÔI mẻ SAU vào (vd mẻ trước đã kịch/gần
 * kịch trần tank nhưng mẻ sau còn dư chỗ) — chỉ bó tay khi CẢ HAI hướng đều vượt trần tank hoặc
 * vượt quá số lô tối đa/mẻ. Ghép 2 mẻ khác lô sản xuất thì luôn coi là trộn lô sản xuất (cần tiệt
 * trùng ngay sau). Vì mật độ mỗi mẻ nguồn đã đảm bảo ≥ đích, mẻ ghép (trung bình có trọng số theo
 * V) cũng tự động ≥ đích — không cần tính lại V.
 */
function mergeSparseBatches(batches, { tankMaxL, maxLotsPerBatch, mergeBatches, lotCountOf, needsMerge }) {
  const needsMergeFn = needsMerge ?? ((b) => b.tongTheTich < MIN_BATCH_L - EPS);
  let i = 0;
  let guard = 0;
  while (i < batches.length && guard++ < 10000) {
    if (batches.length <= 1 || !needsMergeFn(batches[i])) { i++; continue; }
    const tryDir = (dir) => {
      const otherIdx = i + dir;
      if (otherIdx < 0 || otherIdx >= batches.length) return false;
      const first = dir === -1 ? batches[otherIdx] : batches[i];
      const second = dir === -1 ? batches[i] : batches[otherIdx];
      const merged = mergeBatches(first, second);
      if (merged.tongTheTich > tankMaxL + EPS || lotCountOf(merged) > maxLotsPerBatch) return false;
      const keepIdx = Math.min(i, otherIdx);
      batches[keepIdx] = merged;
      batches.splice(Math.max(i, otherIdx), 1);
      return true;
    };
    if (tryDir(-1) || tryDir(1)) {
      // không tăng i — mẻ vừa ghép có thể vẫn dưới sàn, xét lại từ vị trí này.
    } else {
      i++; // không ghép được hướng nào (vượt trần hoặc quá 3 lô) — đành chấp nhận, xét mẻ tiếp theo.
    }
  }
  batches.forEach((b, idx) => { b.meSo = idx + 1; });
  return batches;
}

function mergeSingleLotBatches(a, b) {
  const lots = a.lots.map((l) => ({ ...l }));
  for (const l of b.lots) {
    const existing = lots.find((x) => x.maLo === l.maLo);
    if (existing) {
      existing.theTichRaw += l.theTichRaw;
      existing.theTichDich += l.theTichDich;
      existing.soOng += l.soOng;
    } else {
      lots.push({ ...l });
    }
  }
  const loSanXuatList = Array.from(new Set([...(a.loSanXuatList || []), ...(b.loSanXuatList || [])]));
  return { meSo: 0, tongTheTich: a.tongTheTich + b.tongTheTich, tronLoSanXuat: loSanXuatList.length > 1, loSanXuatList, lots };
}

/**
 * Chế độ "pha tròn chai NL" — MỖI LÔ (chai) = ĐÚNG 1 mẻ riêng, dùng trọn 100% F của lô, KHÔNG
 * ghép nhiều lô vào 1 mẻ và KHÔNG tách 1 lô ra nhiều mẻ (khác hẳn packSingleStreamBatches vốn
 * chủ động ghép/tách để mẻ nào cũng gần mốc mềm SOFT_TARGET_L). Dùng cho SP mà NCV chốt là
 * không muốn ghép mẻ (chốt 2026-08-10) — thực tế cho thấy nhiều SP 1 thành phần vốn dĩ mỗi chai
 * NL đã tự ra 1 mẻ cỡ 600-1000L, gần khớp trần tank sẵn, ghép thêm chỉ gây rối chứ không cần
 * thiết. Mật độ luôn đúng G (không dò cao hơn, giống packSingleStreamBatches).
 */
function packWholeBottleBatches(selectedLots, G, H, tankMaxL = TANK_MAX_L) {
  // Đóng gói mẻ cũng theo đúng thứ tự FIFO đã dùng để CHỌN lô (ngày thu trước hết trước) — trước
  // đây sort riêng theo mã lô ở bước đóng gói này, có thể xáo lại thứ tự khác với lúc chọn nếu mã
  // lô lệch ngày thu thật, khiến mẻ đầu tiên hiển thị không phải mẻ dùng NL cũ nhất.
  const ordered = [...selectedLots].sort(fifoCompare);
  return ordered.map((lot, i) => {
    const theTichDich = (lot.F * lot.E) / G;
    const soOng = Math.floor((lot.F * lot.E * 1000) / (G * H));
    return {
      meSo: i + 1,
      tongTheTich: theTichDich,
      tronLoSanXuat: false,
      loSanXuatList: [loSanXuatOf(lot)],
      lots: [{ maLo: lot.maLo, E: lot.E, theTichRaw: lot.F, theTichDich, soOng }],
      // Trần tank vẫn là CỨNG (xem TANK_MAX_L) — 1 chai dư thể tích tự nhiên hiếm khi vượt, nhưng
      // báo rõ nếu xảy ra thay vì âm thầm phá trần, để NCV chủ động tách bớt tay hoặc bỏ chế độ này.
      overTankCap: theTichDich > tankMaxL + EPS,
    };
  });
}

export function packSingleStreamBatches(selectedLots, d, H, tankMaxL = TANK_MAX_L, maxLotsPerBatch = MAX_LOTS_PER_BATCH) {
  // Đóng gói mẻ cũng theo đúng thứ tự FIFO đã dùng để CHỌN lô (ngày thu trước hết trước) — trước
  // đây sort riêng theo mã lô ở bước đóng gói này, có thể xáo lại thứ tự khác với lúc chọn nếu mã
  // lô lệch ngày thu thật, khiến mẻ đầu tiên hiển thị không phải mẻ dùng NL cũ nhất.
  const ordered = [...selectedLots].sort(fifoCompare);
  const totalV = ordered.reduce((s, l) => s + (l.F * l.E) / d, 0);
  const nBatchesTarget = Math.max(1, Math.ceil(totalV / SOFT_TARGET_L - EPS));
  const groups = groupByLoSanXuat(ordered);

  const batches = [];
  let current = null;
  let currentV = 0;
  let remainingV = totalV;

  // Mốc mềm ĐỘNG: chia đều phần V CÒN LẠI cho số mẻ CÒN LẠI ước tính (thay vì 1 mốc cố định) —
  // để các mẻ đầu tự "nhường" bớt cho mẻ cuối, tránh cảnh mẻ cuối chỉ còn 1 mẩu lẻ tẻ (đúng cách
  // một người cân đối thủ công trên Excel sẽ làm, không tham lam đổ đầy mẻ trước rồi mặc kệ mẻ sau).
  const softTargetNow = () => clamp(remainingV / Math.max(1, nBatchesTarget - batches.length), MIN_BATCH_L, SOFT_TARGET_L);

  const closeBatch = () => {
    if (current && current.lots.length) batches.push(current);
    current = null;
    currentV = 0;
  };

  let allowMerge = false; // true khi mẻ đang mở được CỐ Ý giữ lại để lô sản xuất sau ghép vào

  groups.forEach((group, gi) => {
    // Sang lô sản xuất mới -> mặc định mở mẻ mới riêng (không nối đuôi mẻ dở của lô sản xuất
    // trước), để không trộn NL 2 lô sản xuất khác nhau trong cùng 1 mẻ — trừ khi mẻ đang dở
    // quá vơi và đã CỐ Ý được giữ mở ở lô sản xuất TRƯỚC (allowMerge) để ghép nốt vào đây.
    if (current && !allowMerge) closeBatch();
    allowMerge = false;

    for (const lot of group.lots) {
      let remainingF = lot.F;
      while (remainingF > EPS) {
        if (!current) { current = { lots: [], loSanXuatSet: new Set(), softTarget: softTargetNow() }; currentV = 0; }
        current.loSanXuatSet.add(group.loSanXuat);
        const existing = current.lots.find((x) => x.maLo === lot.maLo);
        if (!existing && current.lots.length >= maxLotsPerBatch) { closeBatch(); continue; }
        const hardCapLeftV = tankMaxL - currentV;
        if (hardCapLeftV <= EPS) { closeBatch(); continue; }
        const hardCapLeftF = (hardCapLeftV * d) / lot.E;
        const softCapLeftF = Math.max(0, (current.softTarget - currentV) * d) / lot.E;
        // Chỗ trống tính tới SOFT_OVERFLOW_L (1050L) — trần "nhỉnh hơn cho phép" riêng cho nhánh
        // dồn nốt tránh mẩu vụn bên dưới, KHÁC với hardCapLeftF (1080L, trần tuyệt đối).
        const softOverflowLeftF = Math.max(0, (SOFT_OVERFLOW_L - currentV) * d) / lot.E;

        // LUÔN nhắm mốc mềm ĐỘNG trước (kể cả khi lô còn nhiều hơn cả trần cứng) — trần cứng chỉ
        // là giới hạn an toàn tuyệt đối, KHÔNG phải mục tiêu đổ đầy. Nhờ vậy mẻ không bị tham lam
        // múc gần sát trần rồi để mẻ cuối chỉ còn 1 mẩu lẻ tẻ — giống cách cân đối thủ công trên
        // Excel: các mẻ đều đặn quanh mốc mềm, trần cứng chỉ chặn khi thật sự cần.
        let takeF;
        if (remainingF <= softCapLeftF + RAW_ROUND_STEP_L / 2) {
          // Vừa cả mốc mềm luôn -> đổ hết, không cần tách/tròn gì thêm (vẫn không vượt trần cứng).
          takeF = Math.min(remainingF, hardCapLeftF);
        } else if (softCapLeftF >= MIN_LOT_FRAGMENT_L) {
          // Chỉ tách 1 phần tròn 0.5L cho mẻ này khi phần CÒN CHỖ (softCapLeftF) đủ lớn (≥
          // MIN_LOT_FRAGMENT_L) — nếu chỗ còn lại quá ít, tách ra sẽ tạo 1 mẩu ĐẦU quá nhỏ ở
          // CHÍNH mẻ này (vd chỉ 0.5L), để dành phần lớn cho mẻ sau — cũng khó đong không kém gì
          // để mẩu cuối. Trường hợp đó nhường hẳn cho nhánh dưới (đóng mẻ, dồn nguyên lô sang mẻ
          // sau) thay vì tách 1 mẩu vụn ở đây.
          const rounded = Math.round(softCapLeftF / RAW_ROUND_STEP_L) * RAW_ROUND_STEP_L;
          const roundedUp = Math.ceil(softCapLeftF / RAW_ROUND_STEP_L) * RAW_ROUND_STEP_L;
          let chunk = roundedUp <= hardCapLeftF + EPS ? roundedUp : rounded;
          chunk = clamp(chunk, RAW_ROUND_STEP_L, Math.min(hardCapLeftF, remainingF));

          // Nếu phần CÒN LẠI của lô sau khi tách sẽ là 1 mẩu quá nhỏ (≤ MIN_LOT_FRAGMENT_L, khó
          // đong ở mẻ sau) — dùng LUÔN TRỌN VẸN phần còn lại của lô này cho mẻ hiện tại, miễn vẫn
          // vừa mốc "nhỉnh hơn cho phép" 1050L (chấp nhận mẻ này nhỉnh hơn mốc mềm một chút, đổi
          // lại không còn mẩu vụn) — KHÔNG được nhỉnh tới tận trần cứng 1080L, quá xa mốc mềm.
          const leftoverAfterChunk = remainingF - chunk;
          if (leftoverAfterChunk > EPS && leftoverAfterChunk <= MIN_LOT_FRAGMENT_L + EPS && remainingF <= softOverflowLeftF + EPS) {
            chunk = remainingF;
          }
          takeF = chunk;
        } else {
          // Mẻ đã chạm đúng mốc mềm (hoặc chỉ còn 1 mẩu chỗ trống quá nhỏ, < MIN_LOT_FRAGMENT_L)
          // -> đóng mẻ NGAY, KHÔNG tách 1 mẩu đầu nhỏ từ lô này — chuyển nguyên lô sang mẻ tiếp
          // theo (mốc mềm của mẻ sau sẽ tự tính lại theo đúng phần còn lại thực tế).
          closeBatch();
          continue;
        }

        let entry = current.lots.find((x) => x.maLo === lot.maLo);
        if (!entry) {
          entry = { maLo: lot.maLo, E: lot.E, F: 0, V: 0 };
          current.lots.push(entry);
        }
        entry.F += takeF;
        entry.V = (entry.F * entry.E) / d; // luôn tính lại từ F thực tế -> mật độ luôn đúng = d
        const dV = (takeF * lot.E) / d;
        currentV += dV;
        remainingV -= dV;
        remainingF -= takeF;
      }
    }

    // Hết lô sản xuất này. Nếu mẻ đang mở còn quá vơi VÀ còn lô sản xuất khác chờ dùng tiếp,
    // GIỮ MỞ để lô sản xuất sau ghép thêm vào (ngoại lệ có kiểm soát, đánh dấu rõ để biết cần
    // tiệt trùng ngay sau mẻ đó) — nếu không thì đóng mẻ lại như bình thường.
    const isLastGroup = gi === groups.length - 1;
    const tooSparse = current && currentV < current.softTarget * MIN_BATCH_FRACTION;
    if (tooSparse && !isLastGroup) allowMerge = true;
    else closeBatch();
  });
  closeBatch();

  const shaped = batches.map((b, i) => ({
    meSo: i + 1,
    tongTheTich: b.lots.reduce((s, l) => s + l.V, 0),
    tronLoSanXuat: b.loSanXuatSet ? b.loSanXuatSet.size > 1 : false,
    loSanXuatList: b.loSanXuatSet ? Array.from(b.loSanXuatSet) : [],
    lots: b.lots.map((l) => ({ maLo: l.maLo, E: l.E, theTichRaw: l.F, theTichDich: l.V, soOng: (l.V * 1000) / H })),
  }));

  return mergeSparseBatches(shaped, {
    tankMaxL,
    maxLotsPerBatch,
    mergeBatches: mergeSingleLotBatches,
    lotCountOf: (b) => b.lots.length,
  });
}

/**
 * Lập kế hoạch mẻ pha cho sản phẩm 1 thành phần hoạt chất.
 * @param {{maLo:string,E:number,F:number}[]} lots - các lô đang "Chờ pha" (đã qua KQKN, đạt) của đúng chủng.
 * @param {{N:number,G:number,H:number}} product - N: số ống cần, G: mật độ đích (CFU/ml), H: thể tích 1 ống (ml).
 * @param {boolean} [wholeBottleOnly] - true: "pha tròn chai NL" — mỗi lô = đúng 1 mẻ riêng, không
 *   ghép/tách qua nhiều mẻ (xem packWholeBottleBatches). Chỉ đổi cách ĐÓNG mẻ, không đổi cách CHỌN
 *   lô (vẫn FIFO như bình thường tới khi đủ N).
 */
export function planSingleComponent({ lots, product, tankMaxL = TANK_MAX_L, maxLotsPerBatch = MAX_LOTS_PER_BATCH, wholeBottleOnly = false }) {
  const { N, G, H } = product;
  const target = (N * G * H) / 1000; // mốc dừng FIFO — mật độ luôn dùng đúng G, không dò d cao hơn
  const vMin = (TUBE_TOL_LOW * N * G * H) / 1000; // sàn khả thi tối thiểu (90% đơn)

  // FIFO: dùng NL cũ nhất trước, dừng khi vừa chạm mục tiêu N (không cắt bớt nếu lô cuối vượt
  // qua — số ống có thể nhỉnh hơn N, kể cả vượt +10%, NCV xem rồi tự quyết định dùng hết hay bớt).
  const fifo = selectLotsFifo(lots, target);
  const best = fifo ? { ...fifo, ...densityAndTubes(fifo.sumValue, { H, G }) } : null;

  if (!best || best.sumValue < vMin - EPS) {
    // maxOng: số ống tối đa pha được nếu dùng HẾT kho hiện có ở đúng mật độ đích G — để NCV thấy
    // ngay đang thiếu bao nhiêu thay vì chỉ biết "không đủ".
    const totalValue = lots.reduce((s, l) => s + l.E * l.F, 0);
    const maxOng = Math.floor((totalValue * 1000) / (G * H));
    return { feasible: false, maxOng, reason: "Kho hiện có (đã qua KQKN, ở Chờ pha) không đủ nguyên liệu để đạt tối thiểu 90% số ống cần — cần NCV bổ sung nguyên liệu hoặc điều chỉnh đơn." };
  }

  const batches = wholeBottleOnly
    ? packWholeBottleBatches(best.subset, G, H, tankMaxL)
    : packSingleStreamBatches(best.subset, best.d, H, tankMaxL, maxLotsPerBatch);
  const massBalance = checkMassBalance(best.subset, best.d, best.T, H);

  return {
    feasible: true,
    d: best.d,
    T: best.T,
    S: best.S,
    totalV: best.sumValue / best.d,
    wholeBottleOnly,
    selectedLots: best.subset.map((l) => l.maLo),
    batches,
    massBalance,
  };
}

// ---------------------------------------------------------------------------
// SẢN PHẨM 2 THÀNH PHẦN (subtilis + clausii pha chung 1 tank)
// ---------------------------------------------------------------------------
//
// Viết lại 2026-10-08 theo đúng 3 nguyên tắc NCV chốt (thay toàn bộ cách "tham lam từng mẻ" cũ —
// cách cũ tự quyết từng mẻ một rồi mới tính mẻ sau, nên hay để lẻ 1 ít clausii cuối cùng thành 1 mẻ
// tí hon ~100L, hoặc phải "dồn nốt" khiến mẻ cuối dư mật độ gấp nhiều lần đích):
//   1. CHỐT CỨNG các chai clausii dùng tới NGAY TỪ ĐẦU: theo đúng thứ tự FIFO, chọn số chai NGUYÊN
//      VẸN cho tổng thể tích pha GẦN mục tiêu N nhất. Clausii không bao giờ dư/dở — chai nào đã
//      chọn thì dùng hết 100%, chai không chọn thì không đụng tới.
//   2. Tính lượng subtilis khớp ĐÚNG với tổng clausii đó (cùng thể tích pha, đúng mật độ đích) — được
//      phép đảo thứ tự chai subtilis cho hợp lý, nhưng chỉ ĐÚNG 1 chai subtilis được dùng dở.
//   3. Chia toàn bộ thể tích thành các mẻ bằng quy hoạch động (xét MỌI cách cắt cùng lúc, không chốt
//      từng mẻ một): mẻ ≤ trần tank, ≤ 3 chai/mẻ (gộp 2 chủng), KHÔNG mẻ nào dưới 700L — chỉ chấp
//      nhận mẻ 500-700L khi không còn cách cắt nào khác tránh được, tuyệt đối không mẻ dưới 500L.
//      Việc đong tròn NL 0.5L được tính NGAY TRONG bước chia mẻ (không làm sau như bản cũ — làm sau
//      thì kích cỡ mẻ bị xê dịch, mẻ vừa đủ 700L có thể tụt xuống dưới, và sinh mẩu đong 0.5L lẻ).

// Sàn cứng tuyệt đối cho 1 mẻ SP 2 thành phần — mẻ 500-700L chỉ chấp nhận khi không còn cách nào
// khác (xem MIN_BATCH_L), dưới mức này thì không bao giờ (trừ khi cả nhịp chỉ có chừng đó thể tích).
const MIN_BATCH_HARD_L = 500;

// Bước lưới (L thể tích pha) để thử các điểm cắt mẻ ngoài các ranh giới chai — đủ mịn so với khoảng
// 700-1080L của 1 mẻ, vẫn nhẹ để quy hoạch động chạy tức thì trên trình duyệt.
const CUT_GRID_L = 10;

// Trọng số hàm chi phí khi chia mẻ — các bậc cách nhau rất xa để thành ưu tiên tuyệt đối theo thứ tự:
// (1) không mẻ < 500L/vượt tank/thiếu 1 chủng, (2) không mẻ quá 3 chai, (3) mật độ không dư quá 5%,
// (4) không mẻ < 700L, (5) không để mẩu NL vụn < 1L, (6) ít mẻ nhất (mẻ càng to càng tốt), (7) mật
// độ càng sát đích càng tốt, (8) cuối cùng mới tới cân đối kích cỡ giữa các mẻ.
const COST_INVALID = 1e8;
const COST_BELOW_HARD_MIN = 1e7;
const COST_PER_EXTRA_LOT = 1e6;
const COST_DENSITY_OVER_TOL = 1e5;
const COST_BELOW_MIN = 1e4;
const COST_FRAGMENT = 1e3;
const COST_PER_BATCH = 200;
const COST_PER_DENSITY_PCT = 10;
const COST_PER_SPLIT = 3;

const lotVolumeAt = (lot, g) => (lot.E * lot.F) / g; // thể tích pha ra từ CẢ chai, ở đúng mật độ đích g
const roundToStep = (x) => Math.round(x / RAW_ROUND_STEP_L) * RAW_ROUND_STEP_L;
const ceilToStep = (x) => Math.ceil(x / RAW_ROUND_STEP_L - 1e-9) * RAW_ROUND_STEP_L;
const floorToStep = (x) => Math.floor(x / RAW_ROUND_STEP_L + 1e-9) * RAW_ROUND_STEP_L;

/** Trải các chai (đã theo thứ tự dùng) lên trục thể tích pha: chai i chiếm đoạn [start, end) có độ
 * dài = thể tích pha ra từ cả chai ở mật độ đích. vLimit cắt chai cuối (chai dùng dở, nếu có).
 * k = lít NL thô ứng với 1 lít thể tích pha (= g/E). */
function layoutLots(orderedLots, g, vLimit = Infinity) {
  const segs = [];
  let pos = 0;
  for (const lot of orderedLots) {
    if (pos >= vLimit - EPS) break;
    const len = lotVolumeAt(lot, g);
    segs.push({ lot, start: pos, end: Math.min(pos + len, vLimit), k: g / lot.E });
    pos += len;
  }
  return segs;
}

/** Vị trí ĐÃ ĐONG TRÒN của 1 luồng tại điểm cắt x trên trục thể tích: chai thứ i, đã rút r lít NL thô
 * từ chai đó (bội số 0.5L). Điểm cắt bên trong chai làm tròn GẦN NHẤT — mỗi điểm cắt tự làm tròn độc
 * lập theo đúng vị trí của nó nên sai số KHÔNG cộng dồn qua các mẻ. Điểm cuối nhịp (isEnd) làm tròn
 * lên/xuống theo endRound — chọn sẵn bởi chooseEndRounding sao cho tổng sản lượng sát mục tiêu nhất. */
function roundedPosition(segs, x, isEnd, endRound = ceilToStep) {
  let lo = 0, hi = segs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].end <= x + EPS) lo = mid + 1; else hi = mid; }
  if (lo >= segs.length) {
    // Qua hết các chai — nếu chai cuối là chai dùng dở (bị cắt ở cuối nhịp) thì làm tròn LÊN.
    const last = segs[segs.length - 1];
    const isPartial = last && last.end - last.start < last.lot.F / last.k - EPS;
    if (isEnd && isPartial) return { i: segs.length - 1, r: Math.min(last.lot.F, endRound((x - last.start) * last.k)) };
    return { i: segs.length, r: 0 };
  }
  const s = segs[lo];
  const r = Math.min(s.lot.F, Math.max(0, roundToStep((x - s.start) * s.k)));
  return { i: lo, r };
}

/** Phần NL thô từng chai trong 1 mẻ giữa 2 vị trí đã đong tròn a -> b của cùng 1 luồng. */
function portionsBetween(segs, a, b) {
  const out = [];
  for (let i = a.i; i <= Math.min(b.i, segs.length - 1); i++) {
    const F = segs[i].lot.F;
    const from = i === a.i ? a.r : 0;
    const to = i === b.i ? b.r : F;
    const raw = to - from;
    if (raw > EPS) out.push({ seg: segs[i], raw, split: raw < F - EPS });
  }
  return out;
}

/** Quy hoạch động chia [0, V] thành các mẻ với tổng chi phí nhỏ nhất (xem trọng số COST_*). Điểm cắt
 * ứng viên: ranh giới mọi chai 2 chủng + từng bước 0.5L NL thô bên trong chai clausii + lưới đều
 * CUT_GRID_L. Mỗi mẻ được đánh giá theo ĐÚNG lượng NL đã đong tròn và thể tích pha thật (giới hạn
 * bởi luồng ít bào tử hơn, nên mật độ không bao giờ dưới đích). Trả về { batches, cost }. */
function segmentBatches(segsA, segsB, V, tankMaxL, maxLotsPerBatch, gSubtilis, gClausii, endRoundA = ceilToStep, endRoundB = ceilToStep) {
  const raw = [0, V];
  segsA.forEach((s) => raw.push(s.end));
  segsB.forEach((s) => {
    raw.push(s.end);
    const step = RAW_ROUND_STEP_L / s.k;
    for (let t = s.start + step; t < s.end - EPS; t += step) raw.push(t);
  });
  for (let t = CUT_GRID_L; t < V; t += CUT_GRID_L) raw.push(t);
  raw.sort((a, b) => a - b);
  const xs = [];
  raw.forEach((x) => { if (x > EPS && x < V - 1e-4 && x - (xs.length ? xs[xs.length - 1] : 0) > 1e-4) xs.push(x); });
  xs.unshift(0);
  xs.push(V);
  const n = xs.length;
  const posA = xs.map((x, idx) => roundedPosition(segsA, x, idx === n - 1, endRoundA));
  const posB = xs.map((x, idx) => roundedPosition(segsB, x, idx === n - 1, endRoundB));

  // Quét 1 luồng giữa 2 vị trí đã đong tròn KHÔNG cấp phát mảng (DP gọi hàng trăm nghìn lần): tổng
  // CFU, số chai góp mặt và phạt chai bị chia (COST_PER_SPLIT, mẩu vụn < 1L thêm COST_FRAGMENT).
  const scan = (segs, a, b) => {
    let cfu = 0, cnt = 0, pen = 0;
    for (let i = a.i, last = Math.min(b.i, segs.length - 1); i <= last; i++) {
      const lot = segs[i].lot;
      const raw = (i === b.i ? b.r : lot.F) - (i === a.i ? a.r : 0);
      if (raw <= EPS) continue;
      cfu += lot.E * raw * 1000;
      cnt++;
      if (raw < lot.F - EPS) pen += raw < MIN_LOT_FRAGMENT_L - EPS ? COST_PER_SPLIT + COST_FRAGMENT : COST_PER_SPLIT;
    }
    return { cfu, cnt, pen };
  };
  const evalCost = (i, j) => {
    const sa = scan(segsA, posA[i], posA[j]);
    if (!sa.cnt) return null; // SP 2 thành phần: mẻ nào cũng phải đủ 2 chủng
    const sb = scan(segsB, posB[i], posB[j]);
    if (!sb.cnt) return null;
    const vA = sa.cfu / (1000 * gSubtilis);
    const vB = sb.cfu / (1000 * gClausii);
    const size = Math.min(vA, vB);
    const over = Math.max(vA, vB) / size - 1; // luồng còn lại dư mật độ bấy nhiêu do đong tròn 0.5L
    let c = COST_PER_BATCH + 0.002 * (size - SOFT_TARGET_L) ** 2 + COST_PER_DENSITY_PCT * over * 100 + sa.pen + sb.pen;
    if (size > tankMaxL + EPS) c += COST_INVALID;
    if (size < MIN_BATCH_HARD_L - EPS) c += COST_BELOW_HARD_MIN;
    else if (size < MIN_BATCH_L - EPS) c += COST_BELOW_MIN;
    if (size > SOFT_OVERFLOW_L) c += (size - SOFT_OVERFLOW_L) * 2;
    if (over > DENSITY_TOL_HIGH - 1 + EPS) c += COST_DENSITY_OVER_TOL;
    const lots = sa.cnt + sb.cnt;
    if (lots > maxLotsPerBatch) c += COST_PER_EXTRA_LOT * (lots - maxLotsPerBatch);
    return { c, size };
  };

  const dp = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  dp[0] = 0;
  const windowL = tankMaxL * DENSITY_TOL_HIGH + 1; // khoảng cắt rộng nhất có thể còn vừa tank sau đong tròn
  // Mẻ hẹp hơn ~450L chắc chắn < 500L kể cả sau đong tròn -> bỏ qua luôn (chỉ khi tổng đủ chia mẻ ≥ 500L).
  const minSpan = V >= 2 * MIN_BATCH_HARD_L ? 0.9 * MIN_BATCH_HARD_L : 0;
  let windowStart = 0;
  for (let j = 1; j < n; j++) {
    while (xs[j] - xs[windowStart] > windowL) windowStart++;
    for (let i = windowStart; i < j && xs[j] - xs[i] >= minSpan; i++) {
      if (dp[i] === Infinity) continue;
      const e = evalCost(i, j);
      if (!e) continue;
      const c = dp[i] + e.c;
      if (c < dp[j]) { dp[j] = c; prev[j] = i; }
    }
  }
  if (dp[n - 1] === Infinity) return { batches: null, cost: Infinity };
  const batches = [];
  for (let j = n - 1; j > 0; j = prev[j]) {
    const i = prev[j];
    const toEntries = (ps) => ps.map((p) => ({ maLo: p.seg.lot.maLo, E: p.seg.lot.E, theTichRaw: p.raw, loSanXuat: p.seg.lot.loSanXuat }));
    batches.push({ tongTheTich: evalCost(i, j).size, subtilis: toEntries(portionsBetween(segsA, posA[i], posA[j])), clausii: toEntries(portionsBetween(segsB, posB[i], posB[j])) });
  }
  batches.reverse();
  return { batches, cost: dp[n - 1] };
}

/** Lần đong CUỐI của chai dùng dở ở cuối nhịp (mỗi chủng nếu có) làm tròn LÊN hay XUỐNG 0.5L — thử cả
 * 4 tổ hợp, chọn tổ hợp cho tổng thể tích pha (giới hạn bởi chủng ít bào tử hơn) sát vTarget nhất:
 * hụt tính gấp đôi dư (ưu tiên pha đủ). Chai dùng hết nguyên vẹn thì không có gì để chọn. */
function chooseEndRounding(segsA, segsB, vTarget, gSubtilis, gClausii) {
  const options = (segs, g) => {
    const last = segs[segs.length - 1];
    const before = segs.slice(0, -1).reduce((sum, x) => sum + lotVolumeAt(x.lot, g), 0);
    const isPartial = last.end - last.start < last.lot.F / last.k - EPS;
    if (!isPartial) return [{ fn: ceilToStep, tot: before + lotVolumeAt(last.lot, g) }];
    const raw = (last.end - last.start) * last.k;
    return [ceilToStep, floorToStep].map((fn) => ({ fn, tot: before + (last.lot.E * Math.min(last.lot.F, fn(raw))) / g }));
  };
  let best = null;
  for (const a of options(segsA, gSubtilis)) {
    for (const b of options(segsB, gClausii)) {
      const v = Math.min(a.tot, b.tot);
      const score = v >= vTarget - EPS ? v - vTarget : 2 * (vTarget - v);
      if (!best || score < best.score - EPS) best = { score, a: a.fn, b: b.fn };
    }
  }
  return best;
}

/** Các thứ tự dùng chai subtilis đem thử — FIFO trước tiên, rồi các biến thể "đảo chai" (NCV cho
 * phép): đưa 1 chai xuống làm chai dùng dở cuối cùng, hoặc hoán đổi 2 chai liền nhau — để ranh giới
 * chai subtilis khớp ranh giới chai clausii hơn, bớt số chai/mẻ và bớt mẻ lẻ. Chỉ xét quanh nhóm chai
 * FIFO thật sự cần dùng (thêm 2 chai dự phòng), không xáo trộn cả kho. */
function subtilisOrderCandidates(orderedA, gSubtilis, V) {
  let cum = 0, m = 0;
  while (m < orderedA.length && cum < V - EPS) { cum += lotVolumeAt(orderedA[m], gSubtilis); m++; }
  const pool = Math.min(orderedA.length, m + 2);
  const cands = [orderedA];
  for (let i = 0; i < pool; i++) {
    const rest = orderedA.filter((_, j) => j !== i);
    const at = Math.max(0, m - 1);
    cands.push([...rest.slice(0, at), orderedA[i], ...rest.slice(at)]);
  }
  for (let i = 0; i + 1 < pool; i++) {
    const o = [...orderedA];
    [o[i], o[i + 1]] = [o[i + 1], o[i]];
    cands.push(o);
  }
  return cands;
}

/** Quy hoạch động 0/1 "nhặt tổ hợp chai bất kỳ" trên thể tích pha làm tròn 1L: với mỗi tổng s ≤ maxSum,
 * số chai ít nhất đạt đúng s; pick(s) trả lại đúng tổ hợp đó. Dùng chung cho mọi bước chọn chai. */
function subsetSums(lots, vol, maxSum) {
  const sizes = lots.map((l) => Math.max(1, Math.round(vol(l))));
  const INF = 1e9;
  let cnt = new Int32Array(maxSum + 1).fill(INF);
  cnt[0] = 0;
  const take = lots.map((_, i) => {
    const sz = sizes[i];
    const next = cnt.slice();
    const t = new Uint8Array(maxSum + 1);
    for (let sum = sz; sum <= maxSum; sum++) {
      if (cnt[sum - sz] + 1 < next[sum]) { next[sum] = cnt[sum - sz] + 1; t[sum] = 1; }
    }
    cnt = next;
    return t;
  });
  const pick = (sum) => {
    const out = [];
    for (let i = lots.length - 1; i >= 0 && sum > 0; i--) if (take[i][sum]) { out.push(lots[i]); sum -= sizes[i]; }
    return out;
  };
  return { reachable: (sum) => sum >= 0 && sum <= maxSum && cnt[sum] < INF, count: (sum) => cnt[sum], pick };
}

/** Chai clausii loại chính (priority 0) luôn ưu tiên: chỉ đụng loại dự phòng khi loại chính không đủ
 * (khi đó dùng HẾT loại chính — `fixed` — rồi nhặt thêm từ loại dự phòng cho phần còn thiếu). */
function splitByPriority(orderedB, vol, vTarget) {
  const primary = orderedB.filter((l) => (l.priority ?? 0) === 0);
  const backup = orderedB.filter((l) => (l.priority ?? 0) !== 0);
  const capPrimary = primary.reduce((sum, l) => sum + vol(l), 0);
  if (capPrimary < 0.99 * vTarget && backup.length) return { fixed: primary, pool: backup, target: vTarget - capPrimary };
  return { fixed: [], pool: primary, target: vTarget };
}

/** Chế độ "tròn mẻ pha": chọn TỔ HỢP chai clausii bất kỳ (không cần theo FIFO) có tổng thể tích pha
 * khớp nhất với vTarget — dư (tổng > cần, phần dư nằm lại ở 1 chai dùng dở) tính 1 phần, hụt (tổng <
 * cần, pha thiếu chút ít nhưng không dư chai nào) tính gấp đôi và chỉ chấp nhận hụt tối đa 1%; hoà
 * thì ít chai hơn. Trả về danh sách chai theo FIFO. */
function chooseClausiiSubset(orderedB, gClausii, vTarget) {
  const vol = (l) => lotVolumeAt(l, gClausii);
  const { fixed, pool, target } = splitByPriority(orderedB, vol, vTarget);
  if (!pool.length || target <= EPS) return [...fixed].sort(fifoCompare);
  const T = Math.round(target);
  const maxSum = T + Math.max(...pool.map((l) => Math.round(vol(l))));
  const dpRes = subsetSums(pool, vol, maxSum);
  let bestSum = -1, bestScore = Infinity;
  for (let sum = Math.ceil(0.99 * T); sum <= maxSum; sum++) {
    if (!dpRes.reachable(sum)) continue;
    const score = (sum >= T ? sum - T : 2 * (T - sum)) + dpRes.count(sum) * 1e-3;
    if (score < bestScore) { bestScore = score; bestSum = sum; }
  }
  if (bestSum < 0) return [...orderedB].sort(fifoCompare); // kho không đủ — dùng hết, để bước sau báo thiếu
  return [...fixed, ...dpRes.pick(bestSum)].sort(fifoCompare);
}

/** Chế độ "tròn chai clausii": các phương án tổ hợp chai clausii NGUYÊN VẸN bất kỳ (chốt NCV
 * 2026-10-08, không cần theo FIFO), xếp theo mức khớp với vTarget — dư tính 1 phần, hụt tính gấp
 * đôi (NCV: "ưu tiên lấy hơn"), hoà thì ít chai hơn — không vượt quá khả năng kho subtilis (vCeiling).
 * Trả về tối đa maxCands phương án { lots (theo FIFO), V, score }, tốt nhất trước. */
function wholeClausiiCandidates(orderedB, gClausii, vTarget, vCeiling, maxCands = 12) {
  const vol = (l) => lotVolumeAt(l, gClausii);
  const { fixed, pool, target } = splitByPriority(orderedB, vol, vTarget);
  const fixedV = fixed.reduce((sum, l) => sum + vol(l), 0);
  if (fixedV > vCeiling + EPS) return [];
  const T = Math.round(target);
  const maxSize = pool.length ? Math.max(...pool.map((l) => Math.round(vol(l)))) : 0;
  const maxSum = Math.max(0, Math.min(Math.floor(vCeiling - fixedV), 2 * T + maxSize));
  const dpRes = subsetSums(pool, vol, maxSum);
  const cands = [];
  for (let sum = fixed.length ? 0 : 1; sum <= maxSum; sum++) {
    if (!dpRes.reachable(sum)) continue;
    cands.push({ sum, score: (sum >= T ? sum - T : 2 * (T - sum)) + dpRes.count(sum) * 1e-3 });
  }
  cands.sort((a, b) => a.score - b.score);
  return cands.slice(0, maxCands).map(({ sum, score }) => {
    const lots = [...fixed, ...dpRes.pick(sum)].sort(fifoCompare);
    return { lots, V: lots.reduce((acc, l) => acc + vol(l), 0), score };
  });
}

// Dung sai để coi 1 tổ hợp chai subtilis NGUYÊN VẸN là "pha vừa hết" với lượng clausii đã chốt — lệch
// trong khoảng này thì chủng dư hơn chỉ pha mật độ nhỉnh lên tương ứng (≤ 3%), không chai nào dở.
const SUBTILIS_MATCH_TOL = 0.03;

/** Tìm tổ hợp chai subtilis NGUYÊN VẸN bất kỳ có tổng thể tích pha khớp V trong ±SUBTILIS_MATCH_TOL
 * (thừa subtilis tính 1 phần, thiếu tính 1.5 phần — thiếu thì sản lượng phải co theo; hoà thì ít chai
 * hơn). Không có tổ hợp nào khớp -> null (nơi gọi dùng subtilis theo FIFO, dở đúng 1 chai). */
function matchSubtilisSubset(orderedA, gSubtilis, V) {
  const vol = (l) => lotVolumeAt(l, gSubtilis);
  const lo = Math.ceil(V * (1 - SUBTILIS_MATCH_TOL));
  const hi = Math.floor(V * (1 + SUBTILIS_MATCH_TOL));
  if (hi < 1 || !orderedA.length) return null;
  const dpRes = subsetSums(orderedA, vol, hi);
  let bestSum = -1, bestScore = Infinity;
  for (let sum = Math.max(1, lo); sum <= hi; sum++) {
    if (!dpRes.reachable(sum)) continue;
    const score = (sum >= V ? sum - V : 1.5 * (V - sum)) + dpRes.count(sum) * 1e-3;
    if (score < bestScore) { bestScore = score; bestSum = sum; }
  }
  return bestSum < 0 ? null : dpRes.pick(bestSum).sort(fifoCompare);
}

/**
 * Lập kế hoạch mẻ pha cho sản phẩm 2 thành phần — xem 3 nguyên tắc ở đầu mục này.
 * Mật độ mọi mẻ luôn ≥ đích cho cả 2 chủng (chỉ có thể nhỉnh vài % do đong tròn NL 0.5L), không còn
 * bất kỳ cơ chế "dồn nốt chai dở không thêm nước" nào. T có thể lệch khỏi N tuỳ cỡ chai clausii (chọn
 * số chai nguyên vẹn gần N nhất) — UI cảnh báo khi T < 90% hoặc > 105% N để NCV tự quyết.
 *
 * mode = "tronChaiClausii" (mặc định): đúng 3 nguyên tắc trên.
 * mode = "tronMePha" (NCV thêm 2026-10-08): pha ĐỦ đúng lượng N, chấp nhận chai clausii cuối dùng dở
 *   (dư lại trong kho) — thay bước 1 bằng "trải clausii theo FIFO tới đúng thể tích cần", mọi bước
 *   còn lại (subtilis chỉ dở 1 chai, chia mẻ, đong tròn 0.5L) giữ nguyên. Dùng khi cần pha đủ số ống.
 *
 * @param {{subtilisLots, clausiiLots, product, mode}} args
 *   product: { N, H, gSubtilis, gClausii }
 */
export function planTwoComponent({ subtilisLots, clausiiLots, product, tankMaxL = TANK_MAX_L, maxLotsPerBatch = MAX_LOTS_PER_BATCH, mode = "tronChaiClausii" }) {
  const { N, H, gSubtilis, gClausii } = product;
  const vTarget = (N * H) / 1000;
  const orderedA = [...subtilisLots].sort(fifoCompare);
  let orderedB = [...clausiiLots].sort(fifoCompare);
  const subtilisTotalCapV = orderedA.reduce((s, l) => s + lotVolumeAt(l, gSubtilis), 0);

  let V, segsB, shortfallLot = null;
  let layoutG = { a: gSubtilis, b: gClausii }, listA = orderedA, listB = null, permuteA = false;
  if (mode === "tronMePha") {
    // Pha đủ đúng thể tích cần — chỉ bị giới hạn bởi tổng kho thật của từng chủng.
    const clausiiTotalCapV = orderedB.reduce((s, l) => s + lotVolumeAt(l, gClausii), 0);
    // Chế độ này KHÔNG bắt buộc lấy clausii theo FIFO (NCV cho phép 2026-10-08) — nhặt tổ hợp chai bất
    // kỳ khớp nhất với thể tích cần, để chai clausii dư lại ít nhất (lý tưởng là không dư chai nào).
    const pickedB = chooseClausiiSubset(orderedB, gClausii, Math.min(vTarget, subtilisTotalCapV));
    const pickedCapV = pickedB.reduce((s, l) => s + lotVolumeAt(l, gClausii), 0);
    V = Math.min(vTarget, clausiiTotalCapV, subtilisTotalCapV, pickedCapV);
    orderedB = pickedB;
    if (V < TUBE_TOL_LOW * vTarget - EPS) {
      const thieu = [clausiiTotalCapV < vTarget - EPS && "clausii", subtilisTotalCapV < vTarget - EPS && "subtilis"].filter(Boolean).join(" và ");
      return { feasible: false, reason: `Kho ${thieu} không đủ để pha tối thiểu 90% số ống cần — cần bổ sung nguyên liệu hoặc điều chỉnh đơn.`, subtilisShortfallLot: null, maxOng: Math.floor((V * 1000) / H) };
    }
    // Không mở chai MỚI chỉ để lấy < 1L NL (MIN_LOT_FRAGMENT_L) ở cuối nhịp — lùi V về đúng ranh giới
    // chai đó (sản lượng chỉ hụt rất ít so với N), miễn vẫn ≥ 90% mục tiêu.
    for (let guard = 0; guard < 4; guard++) {
      let snapped = false;
      for (const [ordered, g] of [[orderedB, gClausii], [orderedA, gSubtilis]]) {
        const segs = layoutLots(ordered, g, V);
        const last = segs[segs.length - 1];
        const isPartial = last && last.end - last.start < last.lot.F / last.k - EPS;
        if (isPartial && last.start > EPS && (V - last.start) * last.k < MIN_LOT_FRAGMENT_L - EPS && last.start >= TUBE_TOL_LOW * vTarget - EPS) {
          V = last.start;
          snapped = true;
        }
      }
      if (!snapped) break;
    }
    segsB = layoutLots(orderedB, gClausii, V);
  } else {
    // 1. Chốt các chai clausii NGUYÊN VẸN — tổ hợp bất kỳ khớp nhất với N (ưu tiên dư hơn hụt).
    const cands = wholeClausiiCandidates(orderedB, gClausii, vTarget, subtilisTotalCapV);
    if (!cands.length) {
      const reason = orderedB.length
        ? "Kho subtilis không đủ để dùng hết dù chỉ 1 chai clausii — cần bổ sung subtilis."
        : "Kho clausii hiện có (đã qua KQKN, ở Chờ pha) trống — cần NCV bổ sung nguyên liệu.";
      return { feasible: false, reason, subtilisShortfallLot: null, maxOng: 0 };
    }
    // Phương án lẽ ra khớp N hơn nếu kho subtilis đủ -> báo đúng chai clausii bị kẹt vì thiếu subtilis.
    const free = wholeClausiiCandidates(orderedB, gClausii, vTarget, Infinity, 1)[0];
    if (free && free.score < cands[0].score - 1) {
      shortfallLot = free.lots.find((l) => !cands[0].lots.includes(l))?.maLo ?? null;
    }
    // 2. Trong các phương án clausii gần như khớp nhất (lệch thêm ≤ 1% N so với phương án tốt nhất), ưu
    // tiên phương án mà subtilis cũng có tổ hợp chai NGUYÊN VẸN pha vừa hết — không dư chai nào.
    let pickB = cands[0];
    let pickA = null;
    for (const c of cands) {
      if (c.score > cands[0].score + 0.01 * vTarget) break;
      const m = matchSubtilisSubset(orderedA, gSubtilis, c.V);
      if (m) { pickB = c; pickA = m; break; }
    }
    V = pickB.V;
    listB = pickB.lots;
    if (pickA) {
      // Trải CẢ 2 chủng vừa khít đúng vEff (cả 2 cùng dùng hết sạch) — chủng có nhiều bào tử hơn chút
      // sẽ pha mật độ nhỉnh lên tương ứng (≤ SUBTILIS_MATCH_TOL), không chai nào dở.
      const vA = pickA.reduce((sum, l) => sum + lotVolumeAt(l, gSubtilis), 0);
      const vEff = Math.min(V, vA);
      layoutG = { a: (gSubtilis * vA) / vEff, b: (gClausii * V) / vEff };
      listA = pickA;
      permuteA = true;
      V = vEff;
    }
  }

  // 3. Chia mẻ tối ưu (segmentBatches) cho từng cách xếp chai đem thử, lấy phương án chi phí thấp nhất.
  const run = (orderA, segsBUse) => {
    const segsA = layoutLots(orderA, layoutG.a, V);
    const endRounding = chooseEndRounding(segsA, segsBUse, V, gSubtilis, gClausii);
    const r = segmentBatches(segsA, segsBUse, V, tankMaxL, maxLotsPerBatch, gSubtilis, gClausii, endRounding.a, endRounding.b);
    return r.batches ? r : null;
  };
  let chosen = null;
  if (mode === "tronMePha") {
    // Thử thêm các cách đảo chai subtilis (xem subtilisOrderCandidates); hoà thì giữ phương án trước.
    for (const order of subtilisOrderCandidates(orderedA, gSubtilis, V)) {
      const r = run(order, segsB);
      if (r && (!chosen || r.cost < chosen.cost - EPS)) chosen = r;
    }
  } else {
    // Tròn chai clausii: chai nào cũng dùng trọn nên thứ tự dùng giữa các chai là tuỳ ý — xuất phát từ
    // thứ tự cũ -> mới, rồi leo đồi bằng cách chuyển chỗ 1 chai (clausii; subtilis chỉ khi khớp vừa hết
    // — còn không thì subtilis giữ đúng list cũ -> mới, dở chai cuối) để ranh giới chai 2 chủng khớp
    // nhau hơn: bớt mẻ lẻ < 700L, bớt số chai/mẻ.
    // Chỉ chuyển 1 chai đi tối đa MOVE_SPAN vị trí, nhận ngay bước cải thiện đầu tiên, có giới hạn
    // thời gian — đủ để gỡ các mẻ lẻ mà vẫn tính xong trong khoảng 1–2 giây.
    const MOVE_SPAN = 3;
    const deadline = Date.now() + 1500;
    function* moves(list) {
      for (let i = 0; i < list.length; i++) {
        for (let j = Math.max(0, i - MOVE_SPAN); j <= Math.min(list.length - 1, i + MOVE_SPAN); j++) {
          if (i === j || j === i - 1) continue; // (i, i-1) trùng với (i-1, i)
          const o = list.filter((_, k) => k !== i);
          o.splice(j, 0, list[i]);
          yield o;
        }
      }
    }
    let curA = listA, curB = listB;
    chosen = run(curA, layoutLots(curB, layoutG.b));
    let improved = !!chosen;
    while (improved && Date.now() < deadline) {
      improved = false;
      const tries = [
        ...[...moves(curB)].map((o) => [curA, o]),
        ...(permuteA ? [...moves(curA)].map((o) => [o, curB]) : []),
      ];
      for (const [oA, oB] of tries) {
        if (Date.now() >= deadline) break;
        const r = run(oA, layoutLots(oB, layoutG.b));
        if (r && r.cost < chosen.cost - EPS) {
          chosen = r; curA = oA; curB = oB; improved = true;
          break;
        }
      }
    }
  }
  if (!chosen) {
    return { feasible: false, reason: "Không chia được mẻ pha hợp lệ từ kho hiện có (trần tank / số chai mỗi mẻ).", subtilisShortfallLot: null, maxOng: Math.floor((V * 1000) / H) };
  }
  const batches = chosen.batches.map((b, i) => ({ meSo: i + 1, ...b }));
  recomputeLoSanXuatMeta(batches);

  const totalV = batches.reduce((s, b) => s + b.tongTheTich, 0);
  const T = Math.floor((totalV * 1000) / H);

  // Gộp lại lượng NL thực đã dùng theo từng lô (1 lô có thể trải trên nhiều mẻ) để đối soát bào
  // tử và báo danh sách lô đã dùng — mật độ báo cáo tính từ đúng tổng CFU thực/tổng V thực.
  const aggregateUsed = (streamKey) => {
    const byLo = {};
    batches.forEach((b) => b[streamKey].forEach((e) => {
      const cur = byLo[e.maLo] || (byLo[e.maLo] = { maLo: e.maLo, E: e.E, F: 0 });
      cur.F += e.theTichRaw;
    }));
    return Object.values(byLo);
  };
  const usedSubtilis = aggregateUsed("subtilis");
  const usedClausii = aggregateUsed("clausii");
  const cfuSubtilis = usedSubtilis.reduce((s, l) => s + cfuOfLot(l), 0);
  const cfuClausii = usedClausii.reduce((s, l) => s + cfuOfLot(l), 0);
  const dSubtilis = totalV > 0 ? cfuSubtilis / (1000 * totalV) : gSubtilis;
  const dClausii = totalV > 0 ? cfuClausii / (1000 * totalV) : gClausii;

  return {
    feasible: true,
    T,
    totalV,
    dSubtilis,
    dClausii,
    selectedSubtilisLots: usedSubtilis.map((l) => l.maLo),
    selectedClausiiLots: usedClausii.map((l) => l.maLo),
    batches,
    massBalanceSubtilis: checkMassBalance(usedSubtilis, dSubtilis, T, H),
    massBalanceClausii: checkMassBalance(usedClausii, dClausii, T, H),
    // Khác null khi kho subtilis không đủ để dùng thêm đúng chai clausii này -> T lệch xa N hơn
    // (App.jsx hiển thị cảnh báo riêng, đề nghị bổ sung subtilis).
    subtilisShortfallLot: shortfallLot,
  };
}

// Tính lại loSanXuatList/tronLoSanXuat từ đúng các lô thật trong mẻ — dùng cho cảnh báo tiệt trùng/
// trộn lô sản xuất ở App.jsx.
function recomputeLoSanXuatMeta(batches) {
  batches.forEach((b) => {
    const loSanXuatList = Array.from(new Set([...b.subtilis.map(loSanXuatOf), ...b.clausii.map(loSanXuatOf)]));
    b.loSanXuatList = loSanXuatList;
    // "Trộn lô sản xuất" = ≥2 lô sản xuất của CÙNG 1 chủng trong 1 tank — subtilis và clausii vốn
    // dĩ luôn khác lô sản xuất nên không tính gộp 2 chủng (nếu gộp thì mẻ nào cũng bị báo trộn).
    b.tronLoSanXuat = new Set(b.subtilis.map(loSanXuatOf)).size > 1 || new Set(b.clausii.map(loSanXuatOf)).size > 1;
    b.clausiiLoSanXuatList = Array.from(new Set(b.clausii.map(loSanXuatOf)));
  });
}

// ---------------------------------------------------------------------------
// KIỂM TRA ĐỀ XUẤT GHÉP LÔ TỪ NGUỒN NGOÀI (vd AI) — SP 2 THÀNH PHẦN
// ---------------------------------------------------------------------------

/**
 * Kiểm tra 1 đề xuất ghép lô do NGUỒN NGOÀI (vd AI) đưa ra cho SP 2 thành phần — KHÔNG tin bất kỳ
 * con số nào nguồn đó tự báo, TỰ TÍNH LẠI toàn bộ từ đúng công thức lõi (giống hệt planTwoComponent)
 * rồi đối chiếu với mọi ràng buộc đã chốt với NCV. Dùng khi muốn thử 1 cách ghép khác (vd AI đề
 * xuất) nhưng vẫn phải qua đúng "cửa" kiểm định như thuật toán chính — không có ngoại lệ.
 *
 * @param {{batches: {subtilis?: {maLo:string, F:number}[], clausii?: {maLo:string, F:number}[]}[]}} proposal
 *   Đề xuất ghép lô: mỗi mẻ liệt kê (các) lô subtilis/clausii và F (lít NL thô lấy từ lô đó cho mẻ
 *   này) — 1 lô CÓ THỂ xuất hiện ở nhiều mẻ khác nhau (chia dùng dần).
 * @param {{subtilisLots, clausiiLots, product, tankMaxL, maxLotsPerBatch, expectedSubtilisF}} context
 *   Dữ liệu kho + mục tiêu — TRUYỀN Y HỆT context đã đưa cho planTwoComponent để so sánh công bằng.
 *   `expectedSubtilisF` (tuỳ chọn, {maLo: F}): TỔNG F subtilis mà KẾ HOẠCH GỐC (trước khi AI xếp lại)
 *   đã dùng cho đúng lô đó — CẦN truyền khi kế hoạch gốc có lô subtilis bị để dở dang (nguyên tắc 4:
 *   subtilis được PHÉP dở dang, KHÔNG bắt buộc dùng hết như clausii) — nếu không có, mặc định coi
 *   như phải dùng ĐÚNG HẾT cả chai (F gốc), giữ tương thích ngược với các lời gọi không có tham số
 *   này. Clausii KHÔNG có tham số tương ứng vì luôn bắt buộc dùng hết 100% (không đổi).
 */
export function validateProposedTwoComponentPlan(proposal, { subtilisLots, clausiiLots, product, tankMaxL = TANK_MAX_L, maxLotsPerBatch = MAX_LOTS_PER_BATCH, expectedSubtilisF = null }) {
  const violations = [];
  const { N, H, gSubtilis, gClausii } = product;
  const subtilisByMaLo = Object.fromEntries(subtilisLots.map((l) => [l.maLo, l]));
  const clausiiByMaLo = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l]));

  if (!proposal || !Array.isArray(proposal.batches) || proposal.batches.length === 0) {
    return { valid: false, violations: ["Đề xuất rỗng hoặc sai định dạng (thiếu mảng batches)."], result: null };
  }

  // 1. Chỉ được dùng lô CÓ THẬT trong kho, F > 0 — gộp dồn tổng F đã dùng của mỗi lô qua mọi mẻ.
  const usedF = { subtilis: {}, clausii: {} };
  proposal.batches.forEach((b, bi) => {
    (b.subtilis || []).forEach((e) => {
      if (!subtilisByMaLo[e.maLo]) violations.push(`Mẻ ${bi + 1}: lô subtilis "${e.maLo}" không có trong kho.`);
      else if (!(e.F > 0)) violations.push(`Mẻ ${bi + 1}: lô subtilis "${e.maLo}" có F <= 0 (${e.F}).`);
      else usedF.subtilis[e.maLo] = (usedF.subtilis[e.maLo] || 0) + e.F;
    });
    (b.clausii || []).forEach((e) => {
      if (!clausiiByMaLo[e.maLo]) violations.push(`Mẻ ${bi + 1}: lô clausii "${e.maLo}" không có trong kho.`);
      else if (!(e.F > 0)) violations.push(`Mẻ ${bi + 1}: lô clausii "${e.maLo}" có F <= 0 (${e.F}).`);
      else usedF.clausii[e.maLo] = (usedF.clausii[e.maLo] || 0) + e.F;
    });
  });

  // 2. Lô CLAUSII đã chạm tới phải dùng ĐÚNG HẾT 100% (không hơn không kém) — bắt buộc, không đổi.
  // Lô SUBTILIS thì so với ĐÚNG lượng kế hoạch gốc đã dùng (expectedSubtilisF nếu có — vì nguyên tắc
  // 4 cho phép subtilis dở dang, nên "đủ" ở đây nghĩa là "khớp đúng kế hoạch gốc", không phải "hết cả
  // chai"); nếu không truyền expectedSubtilisF (vd lời gọi cũ), coi như phải dùng hết cả chai — giữ
  // đúng hành vi cũ.
  const checkFullyUsed = (usedMap, byMaLo, ten, getExpected, mustUseWholeBottle) => {
    for (const [maLo, sumF] of Object.entries(usedMap)) {
      const lot = byMaLo[maLo];
      if (!lot) continue; // đã báo "không có trong kho" ở bước 1.
      const expected = getExpected(maLo, lot);
      if (sumF > expected + 1e-3) {
        violations.push(mustUseWholeBottle
          ? `Lô ${ten} "${maLo}": dùng ${sumF.toFixed(2)}L nhưng cả chai chỉ có ${expected.toFixed(2)}L (dùng vượt quá lượng thực có).`
          : `Lô ${ten} "${maLo}": dùng ${sumF.toFixed(2)}L nhưng kế hoạch gốc chỉ dùng ${expected.toFixed(2)}L (dùng vượt quá lượng kế hoạch gốc).`);
      } else if (sumF < expected - 1e-3) {
        violations.push(mustUseWholeBottle
          ? `Lô ${ten} "${maLo}": mới dùng ${sumF.toFixed(2)}L/${expected.toFixed(2)}L — chai đã mở phải dùng hết 100%, không được để dở dang.`
          : `Lô ${ten} "${maLo}": mới dùng ${sumF.toFixed(2)}L/${expected.toFixed(2)}L — thiếu so với đúng lượng kế hoạch gốc đã dùng.`);
      }
    }
  };
  checkFullyUsed(usedF.subtilis, subtilisByMaLo, "subtilis", (maLo, lot) => expectedSubtilisF?.[maLo] ?? lot.F, expectedSubtilisF == null);
  checkFullyUsed(usedF.clausii, clausiiByMaLo, "clausii", (_maLo, lot) => lot.F, true);

  // 3. TỰ TÍNH LẠI từng mẻ từ đúng công thức lõi (cfu = F*E*1000, V = min(cfuA/gA, cfuB/gB)) —
  // không tin bất kỳ V/mật độ nào nguồn đề xuất tự báo.
  const batches = proposal.batches.map((b, bi) => {
    const subtilis = (b.subtilis || []).filter((e) => subtilisByMaLo[e.maLo] && e.F > 0)
      .map((e) => ({ maLo: e.maLo, E: subtilisByMaLo[e.maLo].E, theTichRaw: e.F }));
    const clausii = (b.clausii || []).filter((e) => clausiiByMaLo[e.maLo] && e.F > 0)
      .map((e) => ({ maLo: e.maLo, E: clausiiByMaLo[e.maLo].E, theTichRaw: e.F }));
    const cfuA = subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
    const cfuB = clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
    if (cfuA <= EPS || cfuB <= EPS) {
      violations.push(`Mẻ ${bi + 1}: thiếu hẳn 1 luồng (subtilis hoặc clausii = 0) — SP 2 thành phần bắt buộc mỗi mẻ phải có cả 2 chủng.`);
    }
    const vCapA = cfuA > EPS ? cfuA / (1000 * gSubtilis) : 0;
    const vCapB = cfuB > EPS ? cfuB / (1000 * gClausii) : 0;
    const tongTheTich = Math.min(vCapA, vCapB);
    const dA = tongTheTich > EPS ? cfuA / (1000 * tongTheTich) : 0;
    const dB = tongTheTich > EPS ? cfuB / (1000 * tongTheTich) : 0;
    const lotCount = subtilis.length + clausii.length;
    if (tongTheTich > tankMaxL + EPS) violations.push(`Mẻ ${bi + 1}: thể tích ${tongTheTich.toFixed(1)}L vượt trần tank ${tankMaxL}L.`);
    if (lotCount > maxLotsPerBatch) violations.push(`Mẻ ${bi + 1}: dùng ${lotCount} lô (subtilis+clausii), vượt giới hạn ${maxLotsPerBatch} lô/mẻ.`);
    // Mật độ không bao giờ được THẤP hơn đích (luật cứng, không đổi) — nhưng cũng không được VƯỢT
    // quá xa đích (trần DENSITY_TOL_HIGH=1.05, đúng ngưỡng đã áp cho thuật toán chính) — nếu không
    // chặn trần này, việc chỉ ép V=min(vCapA,vCapB) có thể để 1 luồng dư mật độ rất nhiều khi 2
    // chủng bị ghép lệch tỉ lệ nặng (chốt với NCV: chấp nhận dư mật độ nhưng chỉ dư vừa phải, đổi
    // lại mẻ ghép được "vừa khít" gọn hơn — không chấp nhận mẻ nào dư mật độ quá đà).
    if (dA > EPS && dA < gSubtilis - EPS) violations.push(`Mẻ ${bi + 1}: mật độ subtilis thực tế ${dA.toExponential(3)} thấp hơn đích ${gSubtilis.toExponential(3)}.`);
    if (dB > EPS && dB < gClausii - EPS) violations.push(`Mẻ ${bi + 1}: mật độ clausii thực tế ${dB.toExponential(3)} thấp hơn đích ${gClausii.toExponential(3)}.`);
    if (dA > EPS && dA > gSubtilis * DENSITY_TOL_HIGH + EPS) violations.push(`Mẻ ${bi + 1}: mật độ subtilis thực tế ${dA.toExponential(3)} dư quá nhiều so với đích (trần cho phép ${(gSubtilis * DENSITY_TOL_HIGH).toExponential(3)}, tối đa +${Math.round((DENSITY_TOL_HIGH - 1) * 100)}%).`);
    if (dB > EPS && dB > gClausii * DENSITY_TOL_HIGH + EPS) violations.push(`Mẻ ${bi + 1}: mật độ clausii thực tế ${dB.toExponential(3)} dư quá nhiều so với đích (trần cho phép ${(gClausii * DENSITY_TOL_HIGH).toExponential(3)}, tối đa +${Math.round((DENSITY_TOL_HIGH - 1) * 100)}%).`);
    const loSanXuatList = Array.from(new Set([...subtilis.map((e) => loSanXuatOf(e)), ...clausii.map((e) => loSanXuatOf(e))]));
    return { meSo: bi + 1, tongTheTich, tronLoSanXuat: loSanXuatList.length > 1, loSanXuatList, subtilis, clausii };
  });

  const totalV = batches.reduce((s, b) => s + b.tongTheTich, 0);
  const T = Math.floor((totalV * 1000) / H);
  const vMin = (TUBE_TOL_LOW * N * H) / 1000;
  if (totalV < vMin - EPS) {
    violations.push(`Tổng thể tích ${totalV.toFixed(1)}L chưa đạt tối thiểu 90% mục tiêu (cần ≥ ${vMin.toFixed(1)}L).`);
  }

  const usedSubtilis = Object.entries(usedF.subtilis).filter(([maLo]) => subtilisByMaLo[maLo]).map(([maLo, F]) => ({ maLo, E: subtilisByMaLo[maLo].E, F }));
  const usedClausii = Object.entries(usedF.clausii).filter(([maLo]) => clausiiByMaLo[maLo]).map(([maLo, F]) => ({ maLo, E: clausiiByMaLo[maLo].E, F }));
  const cfuSubtilis = usedSubtilis.reduce((s, l) => s + cfuOfLot(l), 0);
  const cfuClausii = usedClausii.reduce((s, l) => s + cfuOfLot(l), 0);
  const dSubtilis = totalV > 0 ? cfuSubtilis / (1000 * totalV) : gSubtilis;
  const dClausii = totalV > 0 ? cfuClausii / (1000 * totalV) : gClausii;
  const massBalanceSubtilis = checkMassBalance(usedSubtilis, dSubtilis, T, H);
  const massBalanceClausii = checkMassBalance(usedClausii, dClausii, T, H);
  if (!massBalanceSubtilis.pass) violations.push(`Đối soát bào tử subtilis lệch ${massBalanceSubtilis.diffPct.toFixed(3)}% (>1%).`);
  if (!massBalanceClausii.pass) violations.push(`Đối soát bào tử clausii lệch ${massBalanceClausii.diffPct.toFixed(3)}% (>1%).`);

  const result = {
    feasible: true,
    T,
    totalV,
    dSubtilis,
    dClausii,
    selectedSubtilisLots: usedSubtilis.map((l) => l.maLo),
    selectedClausiiLots: usedClausii.map((l) => l.maLo),
    batches,
    massBalanceSubtilis,
    massBalanceClausii,
  };

  return { valid: violations.length === 0, violations, result };
}
