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
//   - Lô đã chọn vào nhịp phải dùng hết 100% (không để dở dang) — KHÔNG GIỚI HẠN sản lượng được
//     phép dư ra bao nhiêu (SP 2 thành phần, xem computeFinalTargetV).
//   - SP 2 thành phần — NGUYÊN TẮC BẤT ĐỐI XỨNG giữa 2 luồng (chốt NCV cuối ngày 2026-07-29):
//     CLAUSII TUYỆT ĐỐI không bao giờ được để dở dang trong 1 nhịp — nếu kho subtilis không đủ để
//     đóng nốt 1 lô clausii sắp phải mở, thuật toán DỪNG SỚM HƠN (không mở lô clausii đó), chấp
//     nhận T thấp hơn N, KHÔNG được "dồn mật độ" để né (khác hẳn cách xử lý trần overshoot bên
//     dưới) — báo `subtilisShortfallLot` để NCV chủ động bổ sung subtilis. SUBTILIS ngược lại ĐƯỢC
//     PHÉP để dở dang — đây là luồng "linh hoạt" duy nhất, giới hạn vật lý duy nhất còn lại.
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
// nữa — xem findBestMatchedLots, luôn giới hạn đúng 3.
export const MAX_LOTS_PER_BATCH = 3;
export const TUBE_TOL_LOW = 0.9;
export const TUBE_TOL_HIGH = 1.1;
export const DENSITY_TOL_HIGH = 1.05;

// SP 2 thành phần: trần CỨNG cho tổng thể tích cả nhịp (kể cả phần "dọn nốt chai dở") — không bao
// giờ vượt quá vTarget*MAX_CLOSING_OVERSHOOT. Nếu dùng hết sạch NL đã chạm tới đòi hỏi nhiều nước
// hơn mức này, KHÔNG được phép thêm nước nữa — thay vào đó dồn thẳng phần bào tử còn lại của (các)
// chai đang dở dang vào đúng mẻ cuối cùng MÀ KHÔNG THÊM NƯỚC, chấp nhận mật độ mẻ đó dư cao hơn
// đích (chốt với NCV 2026-07-29: dùng hết NL — đặc biệt clausii — là ưu tiên số 1, nhưng thể tích/
// số ống dư ra không được vượt quá 20%; mật độ được phép dư để "gánh" phần chênh lệch đó thay vì
// thể tích). Xem packTwoStreamBatches.
export const MAX_CLOSING_OVERSHOOT = 1.2;

const EPS = 1e-6;

// EPS=1e-6 hợp lý cho so sánh THỂ TÍCH (đơn vị lít, cỡ 1-1000) nhưng QUÁ NHỎ cho so sánh CFU (cỡ
// 10^13-10^17) — sai số làm tròn dấu phẩy động tự nhiên ở quy mô CFU dễ dàng vượt 1e-6 tuyệt đối,
// khiến code tưởng "còn dư CFU" dù chỉ là nhiễu số học (bug thật đã gặp: nới V để dùng hết đúng 1
// lô, phần dư chỉ còn nhiễu số học cỡ CFU nhưng bị hiểu nhầm là "còn nguyên 1 lô dở dang", vô tình
// tạo ra 1 khoản NL vô nghĩa được làm tròn lên thành 0.5L). Dùng epsilon TƯƠNG ĐỐI theo đúng quy mô
// CFU đang so sánh cho các phép so sánh "đã dùng hết đúng 1 lô hay chưa".
const cfuEps = (referenceCfu) => Math.max(EPS, Math.abs(referenceCfu) * 1e-9);

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

/**
 * Chọn lô theo FIFO — NL sản xuất CÀNG LÂU càng ưu tiên dùng trước (tránh tồn kho quá hạn),
 * và vì đi tuần tự theo tuổi lô, tự nhiên cũng gom các chai CÙNG 1 lô sản xuất lại với nhau
 * (ít lô sản xuất bị chạm tới hơn = ít lần tiệt trùng hơn) — không cần tối ưu 2 mục tiêu này
 * tách riêng. Tích luỹ dần tới khi VỪA CHẠM mục tiêu `target` — LUÔN dùng TRỌN lô làm nó vượt
 * qua mốc (không cắt bớt để né vượt), số ống ra có thể nhỉnh hơn mục tiêu một chút do làm tròn
 * theo từng lô — chấp nhận được, NCV xem kết quả rồi quyết định dùng hết hay bớt lại.
 *
 * Nếu lô có field `priority` (0 = loại chính, 1 = loại dự phòng — vd Progermila ưu tiên clausii
 * loại 1, chỉ đụng loại 2 khi loại 1 không đủ), luôn xếp hết loại chính (theo tuổi) trước khi
 * chạm tới loại dự phòng, bất kể tuổi lô loại dự phòng có cũ hơn hay không.
 */
function fifoCompare(a, b) {
  return (a.priority ?? 0) - (b.priority ?? 0)
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
export const MIN_BATCH_L = 500;

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
  const ordered = [...selectedLots].sort((a, b) => naturalCompareMaLo(a.maLo, b.maLo));
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
  const ordered = [...selectedLots].sort((a, b) => naturalCompareMaLo(a.maLo, b.maLo));
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
    return { feasible: false, reason: "Kho hiện có (đã qua KQKN, ở Chờ pha) không đủ nguyên liệu để đạt tối thiểu 90% số ống cần — cần NCV bổ sung nguyên liệu hoặc điều chỉnh đơn." };
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

/**
 * V tối đa lấy LIÊN TỤC được từ 1 luồng bắt đầu đúng vị trí cursor hiện tại, KHÔNG xáo trộn
 * cursor (chỉ xem trước). Dừng khi hết sạch luồng, hoặc (nếu enforceLoSanXuat) khi chạm sang
 * lô sản xuất khác với lô đang dở — để quyết định V an toàn cho 1 mẻ mà không phải "rút thử
 * rồi mới biết thiếu/thừa" như cách cũ (nguyên nhân gây lệch mật độ nặng trước đây).
 * Hết sạch luồng -> trả về 0 (không phải vô hạn): SP 2 thành phần LUÔN cần cả 2 luồng trong
 * mỗi mẻ, nên 1 luồng cạn kho nghĩa là KHÔNG thể tạo thêm mẻ nào nữa, không phải "hết ràng buộc".
 */
function maxAvailableV(orderedLots, cursor, d, enforceLoSanXuat) {
  if (cursor.idx >= orderedLots.length) return 0;
  const boundaryLoSanXuat = loSanXuatOf(orderedLots[cursor.idx]);
  let idx = cursor.idx;
  let cfu = 0;
  while (idx < orderedLots.length) {
    const lot = orderedLots[idx];
    if (enforceLoSanXuat && loSanXuatOf(lot) !== boundaryLoSanXuat) break;
    cfu += cfuOfLot(lot) - (idx === cursor.idx ? cursor.usedCFU : 0);
    idx++;
  }
  return cfu / (1000 * d);
}

/** Thể tích (V) nếu lấy ĐÚNG N lô tiếp theo từ cursor (kể cả phần dở dang của lô đang mở, nếu có,
 * tính là 1 trong N lô đó) — KHÔNG bị chặn bởi ranh giới lô sản xuất (dùng cho việc tìm tổ hợp cân
 * đối bên dưới, nơi CHO PHÉP băng qua lô sản xuất nếu cần, khác với maxAvailableV mặc định). Trả
 * về 0 nếu không đủ N lô còn lại trong kho.
 */
function vForNextNLots(orderedLots, cursor, d, n) {
  let idx = cursor.idx;
  let cfu = 0;
  let count = 0;
  if (cursor.usedCFU > EPS && idx < orderedLots.length) {
    cfu += cfuOfLot(orderedLots[idx]) - cursor.usedCFU;
    idx++;
    count++;
  }
  while (count < n && idx < orderedLots.length) {
    cfu += cfuOfLot(orderedLots[idx]);
    idx++;
    count++;
  }
  if (count < n) return 0; // không đủ N lô còn lại.
  return cfu / (1000 * d);
}

/**
 * NHÌN TRƯỚC nhiều tổ hợp "lấy bao nhiêu lô từ mỗi bên" (subtilis, clausii) bắt đầu từ đúng vị trí
 * cursor hiện tại của cả 2 luồng — thay vì chỉ lấy tới hết ranh giới lô sản xuất hiện tại (cách cũ,
 * kiểu FIFO thuần, dễ ghép ra mẻ lệch mật độ nặng khi kích cỡ/mật độ 2 chủng không khớp nhau — xem
 * feedback-mixplanner-design-choices). CHỌN tổ hợp có tỉ lệ vA/vB GẦN 1 NHẤT (cân đối nhất) trong
 * giới hạn cứng `maxLotsPerBatch` (3 chai, KHÔNG có ngoại lệ — NCV đã bỏ hẳn ngoại lệ 4 chai
 * 2026-07-30). Trả về {vA, vB, nA, nB} của tổ hợp tốt nhất, hoặc null nếu 1 trong 2 bên không còn
 * lô nào.
 */
function findBestMatchedLots(orderedA, curA, gSubtilis, orderedB, curB, gClausii, maxLotsPerBatch) {
  if (curA.idx >= orderedA.length || curB.idx >= orderedB.length) return null;
  let best = null;
  for (let nA = 1; nA <= maxLotsPerBatch - 1; nA++) {
    const vA = vForNextNLots(orderedA, curA, gSubtilis, nA);
    if (vA <= EPS) break; // không đủ nA lô bên subtilis -> nA lớn hơn cũng vô nghĩa.
    for (let nB = 1; nA + nB <= maxLotsPerBatch; nB++) {
      const vB = vForNextNLots(orderedB, curB, gClausii, nB);
      if (vB <= EPS) break; // không đủ nB lô bên clausii.
      const ratio = Math.min(vA, vB) / Math.max(vA, vB);
      const candidate = { vA, vB, nA, nB, ratio, withinNormalLimit: true };
      if (!best || candidate.ratio > best.ratio) best = candidate;
    }
  }
  return best;
}

/** Đếm số lô (không trùng) sẽ bị chạm tới nếu rút đúng cfuBudget từ cursor — chỉ xem trước. */
function peekTouchedLotCount(orderedLots, cursor, cfuBudget) {
  let idx = cursor.idx;
  let used = cursor.usedCFU;
  let remaining = cfuBudget;
  let count = 0;
  const budgetEps = cfuEps(cfuBudget);
  while (remaining > budgetEps && idx < orderedLots.length) {
    const lotCFU = cfuOfLot(orderedLots[idx]);
    const lotEps = cfuEps(lotCFU);
    const take = Math.min(lotCFU - used, remaining);
    if (take > lotEps) count++;
    remaining -= take;
    used += take;
    if (used >= lotCFU - lotEps) { idx++; used = 0; }
  }
  return count;
}

/** Xem trước (không mutate): nếu rút đúng V (đổi ra cfuBudget = d*1000*V) từ cursor, lô CUỐI CÙNG
 * bị chạm tới còn lại (chưa dùng hết) bao nhiêu — dùng để phát hiện "mẩu vụn" sắp bị bỏ lại cho mẻ
 * sau (xem MIN_LOT_FRAGMENT_L). Trả về CẢ 2 đơn vị vì khác mục đích:
 *  - rawF: lít NL THÔ còn dư của đúng lô đó (dùng để SO SÁNH với MIN_LOT_FRAGMENT_L — đây mới là
 *    con số "khó đong" mà NCV quan tâm, KHÔNG PHẢI thể tích pha loãng).
 *  - bumpV: thể tích mẻ (V) cần CỘNG THÊM để rút hết đúng phần rawF đó ở mật độ d — dùng để biết
 *    nới V thêm bao nhiêu (số này có thể LỚN hơn rawF nhiều lần nếu lô rất đậm đặc so với mật độ
 *    đích — ban đầu code nhầm dùng số này để so sánh ngưỡng, khiến ngưỡng gần như không bao giờ
 *    kích hoạt được ở SP 2 thành phần, đã sửa 2026-07-29).
 * Trả về {rawF:0, bumpV:0} nếu vừa khít đúng ranh giới 1 lô, hoặc đã hết sạch kho.
 */
function peekLeftoverInBoundaryLot(orderedLots, cursor, d, V) {
  let idx = cursor.idx;
  let used = cursor.usedCFU;
  let remaining = d * 1000 * V;
  const budgetEps = cfuEps(remaining);
  while (remaining > budgetEps && idx < orderedLots.length) {
    const lotCFU = cfuOfLot(orderedLots[idx]);
    const lotEps = cfuEps(lotCFU);
    const take = Math.min(lotCFU - used, remaining);
    remaining -= take;
    used += take;
    if (used >= lotCFU - lotEps) { idx++; used = 0; } else break;
  }
  if (idx >= orderedLots.length) return { rawF: 0, bumpV: 0 };
  const lot = orderedLots[idx];
  const lotCFU = cfuOfLot(lot);
  if (used <= cfuEps(lotCFU)) return { rawF: 0, bumpV: 0 };
  const leftoverCFU = lotCFU - used;
  return { rawF: leftoverCFU / (1000 * lot.E), bumpV: leftoverCFU / (1000 * d) };
}

/** Xem trước (không mutate): chiều NGƯỢC LẠI với peekLeftoverInBoundaryLot — kể từ khi tìm tổ hợp
 * cân đối (`findBestMatchedLots`) được phép nới V băng qua ranh giới lô sản xuất, V có thể vừa mới
 * "gặm" 1 miếng XÍU (rawF ≤ MIN_LOT_FRAGMENT_L) của 1 lô HOÀN TOÀN MỚI (chưa hề chạm tới trước khi
 * vào mẻ này) rồi bị mốc mềm/trần tank/giới hạn số lô chặn lại giữa chừng — để lại phần LỚN của
 * đúng lô đó cho mẻ SAU (ca thực tế gặp: mẩu 0.5L/9.5L). CHỈ tính là "gặm mới" khi lô biên sau khi
 * mô phỏng V khác hẳn lô mà cursor đang đứng LÚC VÀO mẻ này (idx đã nhích qua) — nếu cursor đã đang
 * dở dang sẵn 1 lô từ trước (không phải mới trong mẻ này), KHÔNG tính là gặm mới. Trả về CẢ 2 đơn
 * vị như hàm trên: rawF để so ngưỡng, shrinkV = đúng lượng cần LÙI V lại để lô đó chưa bị chạm tới.
 */
function peekNewLotNibble(orderedLots, cursor, d, V) {
  const entryIdx = cursor.idx;
  let idx = cursor.idx;
  let used = cursor.usedCFU;
  let remaining = d * 1000 * V;
  const budgetEps = cfuEps(remaining);
  while (remaining > budgetEps && idx < orderedLots.length) {
    const lotCFU = cfuOfLot(orderedLots[idx]);
    const lotEps = cfuEps(lotCFU);
    const take = Math.min(lotCFU - used, remaining);
    remaining -= take;
    used += take;
    if (used >= lotCFU - lotEps) { idx++; used = 0; } else break;
  }
  if (idx >= orderedLots.length || idx === entryIdx || used <= EPS) return { rawF: 0, shrinkV: 0 };
  const lot = orderedLots[idx];
  return { rawF: used / (1000 * lot.E), shrinkV: used / (1000 * d) };
}

/** Thể tích còn cần rút để dùng HẾT đúng chai đang dở dang (đã chạm, usedCFU>0) tại cursor.
 * Cursor đang sạch (usedCFU=0, chưa chạm chai nào, còn chai để mở) -> Infinity: chai hiện tại
 * không ép V nào cả. Cursor đã cạn sạch TOÀN BỘ kho (idx hết) -> null: không còn gì để rút thêm,
 * phân biệt rõ với "Infinity" (không giới hạn nhưng vẫn còn hàng) để computeFinalTargetV biết khi
 * nào phải dừng hẳn vì hết nguyên liệu thật sự, không phải vì luồng đang sạch.
 */
function finishCurrentBottleV(orderedLots, cursor, d) {
  if (cursor.idx >= orderedLots.length) return null;
  const lotCFU = cfuOfLot(orderedLots[cursor.idx]);
  if (cursor.usedCFU <= cfuEps(lotCFU)) return Infinity;
  const remainingCFU = lotCFU - cursor.usedCFU;
  return remainingCFU / (1000 * d);
}

/** Rút ĐÚNG cfuBudget từ cursor (mutating), trả về danh sách lô đã chạm + F thực tế mỗi lô. */
function consumeExactCFU(orderedLots, cursor, cfuBudget) {
  const taken = [];
  let remaining = cfuBudget;
  const budgetEps = cfuEps(cfuBudget);
  while (remaining > budgetEps && cursor.idx < orderedLots.length) {
    const lot = orderedLots[cursor.idx];
    const lotCFU = cfuOfLot(lot);
    const lotEps = cfuEps(lotCFU);
    const take = Math.min(lotCFU - cursor.usedCFU, remaining);
    if (take > lotEps) taken.push({ maLo: lot.maLo, E: lot.E, F: take / (lot.E * 1000) });
    cursor.usedCFU += take;
    remaining -= take;
    if (cursor.usedCFU >= lotCFU - lotEps) { cursor.idx += 1; cursor.usedCFU = 0; }
  }
  return taken;
}

/**
 * Tính TRƯỚC (mô phỏng trên cursor riêng, không đụng tới cursor thật) thể tích vFinal >= vTarget
 * cần pha để CLAUSII quay về sạch (đóng nốt đúng chai đang dở tại vTarget, nếu có) — CHỈ clausii,
 * KHÔNG còn đuổi theo cho subtilis sạch nữa (bản cũ coi CẢ 2 luồng bắt buộc dùng hết nên phải lặp
 * nhiều bước đuổi theo nhau; nay chỉ clausii bị ràng buộc "không bao giờ dở dang" — chốt NCV — nên
 * đúng 1 bước là đủ: đóng nốt chai clausii đang dở, không mở thêm lô clausii nào khác). SUBTILIS
 * được PHÉP để dở dang, nên không cần tính gì thêm cho nó ở đây — nó tự nhận đúng lượng cần thiết
 * để khớp V này khi packTwoStreamBatches rút CFU thật.
 *
 * Hàm này CỐ TÌNH KHÔNG áp trần sản lượng lẫn không kiểm tra kho subtilis có đủ hay không — cả 2
 * việc đó là của NGƯỜI GỌI (packTwoStreamBatches): trần MAX_CLOSING_OVERSHOOT áp như cũ (dồn mật độ
 * khi vướng trần — chốt cũ, giữ nguyên); còn nếu kho subtilis KHÔNG đủ để with tới đúng vFinal này,
 * người gọi phải LÙI vFinal về đúng ranh giới lô clausii sạch gần nhất còn nằm trong khả năng thật
 * của subtilis (xem largestCleanCheckpointAtMost) — tuyệt đối không dồn mật độ để né trường hợp đó.
 * (Nếu kho subtilis không đủ ngay để đi tới đúng vFinal do hàm này trả về, người gọi tự lùi lại.)
 */
function computeFinalTargetV(orderedB, gClausii, vTarget) {
  const curB = { idx: 0, usedCFU: 0 };
  consumeExactCFU(orderedB, curB, gClausii * 1000 * vTarget);
  if (curB.usedCFU <= EPS || curB.idx >= orderedB.length) return vTarget; // đã sạch hoặc đã cạn kho tại vTarget.
  const finishB = finishCurrentBottleV(orderedB, curB, gClausii);
  return Number.isFinite(finishB) ? vTarget + finishB : vTarget;
}

/** V lớn nhất đạt được từ TOÀN BỘ 1 luồng (bắt đầu từ đầu danh sách) mà KHÔNG vượt quá vCeiling,
 * CHỈ tính bằng các lô TRỌN VẸN (không bao giờ cắt dở 1 lô giữa chừng) — dùng để tìm đúng ranh giới
 * SẠCH gần nhất của clausii mà vẫn nằm trong khả năng thật của subtilis, khi kho subtilis không đủ
 * để đóng nốt lô clausii mà vFinal tự nhiên (computeFinalTargetV) cần tới (xem packTwoStreamBatches,
 * nguyên tắc "không bao giờ để dở clausii" — chốt NCV).
 */
function largestCleanCheckpointAtMost(orderedLots, d, vCeiling) {
  let v = 0;
  for (const lot of orderedLots) {
    const lotV = cfuOfLot(lot) / (1000 * d);
    if (v + lotV > vCeiling + EPS) break;
    v += lotV;
  }
  return v;
}

/**
 * Đóng mẻ cho SP 2 thành phần: với MỖI mẻ, xác định thể tích V an toàn cho CẢ HAI luồng TRƯỚC
 * (dựa trên những gì thực sự lấy được liên tục từ vị trí hiện tại của từng luồng), rồi mới rút
 * ĐÚNG lượng bào tử cần cho V đó Ở ĐÚNG MẬT ĐỘ ĐÍCH của từng luồng (gSubtilis/gClausii) — KHÔNG
 * quy về 1 mật độ đã "khớp tỉ lệ" tính sẵn cho cả nhịp (cách cũ: chọn trước 1 tập lô mỗi luồng
 * sao cho tổng bào tử khớp tỉ lệ đích rồi ép dùng hết — hễ tỉ lệ kho thực tế lệch tỉ lệ đích,
 * luồng dư sẽ bị ép pha ở mật độ cao vọt hẳn so với đích, rất phí NL).
 *
 * Đúng theo cách NCV làm tay: CHAI ĐÃ MỞ (đã chạm tới) LUÔN PHẢI DÙNG HẾT, không để dở dang. Thay
 * vì chỉ nhắm vTarget rồi mở thêm 1 nhánh riêng "dọn nốt" (từng khiến mẻ dọn nốt tự do múc tới tận
 * mốc mềm ~1000L, vô tình mở tràn lan chai mới rồi lại phải dọn tiếp, tổng sản lượng vọt lên gấp
 * nhiều lần N), hàm này tính TRƯỚC đúng 1 lần tổng thể tích thật sự cần pha (vFinal >= vTarget, xem
 * computeFinalTargetV) rồi chia mẻ ĐỀU cho cả phần "chính" lẫn phần "dọn nốt" bằng ĐÚNG 1 cơ chế
 * mốc mềm động — không mẻ nào bị ép kịch trần hay teo tóp kịch sàn bất thường chỉ vì đang ở giai
 * đoạn dọn nốt. T có thể nhỉnh hơn N (chai dở buộc phải dọn hết) — chấp nhận được, NCV xem rồi tự
 * quyết. Nhờ rút đúng mật độ đích mỗi mẻ (không quy về 1 mật độ đã khớp tỉ lệ sẵn từ đầu), phần
 * "dọn nốt" cũng không làm mật độ vọt lên vô lý — chỉ có thể nhỉnh nhẹ do quy tròn NL 0.5L.
 */
function packTwoStreamBatches(subtilisLots, gSubtilis, clausiiLots, gClausii, tankMaxL, maxLotsPerBatch, vTarget) {
  const orderedA = [...subtilisLots].sort(fifoCompare);
  const orderedB = [...clausiiLots].sort(fifoCompare);
  const curA = { idx: 0, usedCFU: 0 };
  const curB = { idx: 0, usedCFU: 0 };

  const vFinalClausiiClean = computeFinalTargetV(orderedB, gClausii, vTarget);
  const vCap = vTarget * MAX_CLOSING_OVERSHOOT;
  // Trần vật lý thật sự của subtilis — TOÀN BỘ kho đã chọn, KHÔNG giới hạn theo ranh giới lô sản
  // xuất (subtilis được phép dở dang nên không cần dừng đúng ranh giới lô như clausii).
  const subtilisTotalCapV = maxAvailableV(orderedA, { idx: 0, usedCFU: 0 }, gSubtilis, false);

  let vFinal;
  let cappedByOvershoot = false;
  let subtilisShortfallLot = null; // mã lô clausii KHÔNG mở được do thiếu subtilis (nếu có, xem dưới)
  if (vFinalClausiiClean <= subtilisTotalCapV + EPS) {
    // Đủ subtilis để đóng nốt clausii như bình thường -> áp trần overshoot NHƯ CŨ, không đổi (chốt
    // NCV cũ: dồn mật độ khi vướng trần +20%, xem drainBottle bên dưới).
    vFinal = Math.min(vFinalClausiiClean, vCap);
    cappedByOvershoot = vFinalClausiiClean > vCap + EPS;
  } else {
    // MỚI (chốt NCV): kho subtilis KHÔNG đủ để đóng nốt lô clausii mà vFinalClausiiClean cần tới —
    // TUYỆT ĐỐI không dồn mật độ để né (khác cappedByOvershoot ở trên) — LÙI thẳng về đúng ranh giới
    // lô clausii SẠCH gần nhất còn nằm trong khả năng thật của subtilis (và vẫn không vượt trần
    // overshoot), chấp nhận T thấp hơn N. Báo lại đúng mã lô clausii bị "kẹt" để NCV biết cần bổ
    // sung subtilis nếu muốn đạt đủ N ống.
    const ceiling = Math.min(subtilisTotalCapV, vCap);
    vFinal = largestCleanCheckpointAtMost(orderedB, gClausii, ceiling);
    const probe = { idx: 0, usedCFU: 0 };
    consumeExactCFU(orderedB, probe, gClausii * 1000 * vFinal);
    subtilisShortfallLot = probe.idx < orderedB.length ? orderedB[probe.idx].maLo : null;
  }
  const nBatchesTarget = Math.max(1, Math.ceil(vFinal / SOFT_TARGET_L - EPS));

  const batches = [];
  let remainingV = vFinal;
  let guard = 0;
  let pinnedFinalV = null; // xem chú thích ở nơi gán bên trong vòng lặp.
  while (remainingV > EPS && guard++ < 10000) {
    // Mốc mềm ĐỘNG: chia đều phần V còn lại (kể cả phần "dọn nốt") cho số mẻ còn lại ước tính —
    // mẻ đầu tự nhường bớt cho mẻ cuối, tránh orphan 1 mẩu lẻ tẻ ở cuối (xem giải thích ở
    // packSingleStreamBatches).
    const softTargetNow = clamp(remainingV / Math.max(1, nBatchesTarget - batches.length), MIN_BATCH_L, SOFT_TARGET_L);
    // NHÌN TRƯỚC nhiều tổ hợp "lấy bao nhiêu lô từ mỗi bên" để tìm tổ hợp CÂN ĐỐI NHẤT (tỉ lệ vA/vB
    // gần 1 nhất) — thay vì chỉ lấy tới hết ranh giới lô sản xuất hiện tại như trước (kiểu FIFO
    // thuần, dễ ghép ra mẻ lệch mật độ nặng khi kích cỡ/mật độ 2 chủng không khớp — chốt lại với
    // NCV 2026-07-29 sau khi thấy ca thực tế 1 mẻ dư subtilis 13%, mẻ khác dư clausii, mẻ cuối dư
    // gấp 3 lần đích: "cần rà tất cả các chai NL rồi ghép mẻ pha thật chuẩn, không phải nhặt vài
    // chai xong cố ép vào"). Nếu không tìm được tổ hợp nào (vd 1 luồng đã cạn sạch kho), rơi về
    // đúng cách cũ (maxAvailableV, giới hạn theo ranh giới lô sản xuất) làm phương án dự phòng.
    const matched = findBestMatchedLots(orderedA, curA, gSubtilis, orderedB, curB, gClausii, maxLotsPerBatch);
    const effectiveMaxLots = maxLotsPerBatch;
    const maxA = matched ? matched.vA : maxAvailableV(orderedA, curA, gSubtilis, true);
    const maxB = matched ? matched.vB : maxAvailableV(orderedB, curB, gClausii, true);

    // Đảm bảo tổng số lô (gộp 2 luồng) chạm trong mẻ ≤ giới hạn (effectiveMaxLots) — nếu vượt,
    // nhị phân thu nhỏ V. Áp DÙNG CHUNG cho cả V "theo tổ hợp cân đối" lẫn V "nới qua ranh giới"
    // bên dưới — nếu áp SAU khi đã nới thì phần nới có thể bị cắt trở lại về rất nhỏ do vướng đúng
    // giới hạn số lô, khiến việc nới thành vô nghĩa (mẻ vẫn nhỏ y như chưa nới).
    const touchedAt = (vv) => peekTouchedLotCount(orderedA, curA, gSubtilis * 1000 * vv) + peekTouchedLotCount(orderedB, curB, gClausii * 1000 * vv);
    const capByLotCount = (vv) => {
      if (touchedAt(vv) <= effectiveMaxLots) return vv;
      let lo = 0, hi = vv;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        if (touchedAt(mid) <= effectiveMaxLots) lo = mid; else hi = mid;
      }
      return lo;
    };

    let V = capByLotCount(Math.min(maxA, maxB, softTargetNow, tankMaxL, remainingV));

    // Nếu mẻ sẽ ra QUÁ VƠI (dưới sàn cứng) CHỈ VÌ đang bị chặn bởi ranh giới lô sản xuất (chưa hết
    // kho, chưa kịch trần tank/mốc mềm/vFinal, chưa vướng giới hạn 3 lô) — đúng cách NCV làm tay:
    // "mẻ còn nhỏ thì mở thêm chai (cả 2 phía) cho tới khi mẻ đủ lớn" — nới ranh giới cho mẻ NÀY
    // băng luôn qua lô sản xuất kế tiếp (đánh dấu trộn lô sản xuất, tự tính từ danh sách lô đã chạm
    // bên dưới), VẪN tuân thủ đúng giới hạn 3 lô/mẻ khi nới. Chỉ nới khi CHÍNH ranh giới lô sản xuất
    // là nút thắt — nếu nới ra mà vẫn vướng đúng giới hạn 3 lô (capByLotCount lại cắt về nhỏ), coi
    // như bó tay thật sự, giữ nguyên V co theo ranh giới (giới hạn vật lý không tránh được, đã chốt
    // với NCV: tối đa 3 chai/mẻ).
    if (V < MIN_BATCH_L - EPS && V < Math.min(softTargetNow, tankMaxL, remainingV) - EPS) {
      const maxAFull = maxAvailableV(orderedA, curA, gSubtilis, false);
      const maxBFull = maxAvailableV(orderedB, curB, gClausii, false);
      const vExtended = capByLotCount(Math.min(maxAFull, maxBFull, softTargetNow, tankMaxL, remainingV));
      if (vExtended > V + EPS) V = vExtended;
    }

    // Tránh để lại "mẩu vụn" NL THÔ (rawF ≤ MIN_LOT_FRAGMENT_L lít) của lô đang dở dang cho mẻ SAU
    // — nếu rút đúng V này sẽ chừa lại 1 mẩu quá nhỏ ở lô đang chạm cuối cùng (1 hoặc cả 2 luồng),
    // nới thêm V đúng bằng bumpV (thể tích cần thêm để rút hết đúng phần rawF đó) để dùng NỐT LUÔN
    // lô đó ngay mẻ này — GIỚI HẠN bởi maxA/maxB (không nới quá lượng thực có của luồng KIA) lẫn
    // trần tank/lô sản xuất/3 lô. LÀM TỪNG BƯỚC NHỎ (lặp), KHÔNG bump thẳng bằng max(bumpA,bumpB)
    // trong 1 lần — vì bù hẳn cho luồng cần nhiều hơn có thể "đá" luồng còn lại (vừa xong xuôi) đi
    // quá đà, làm lộ ra 1 mẩu vụn MỚI ngay trong LÔ TIẾP THEO của chính luồng đó (y hệt cơ chế xen
    // kẽ đã gặp ở computeFinalTargetV) — mỗi vòng chỉ giải quyết bên cần ÍT hơn trước, rồi tính lại
    // từ đầu vì trạng thái đã đổi. Đúng chốt NCV: "0.5L hay 1L thật sự quá nhỏ... tăng nước/tăng
    // mật độ thành phẩm cũng không sao hết" — ưu tiên mẻ gọn hơn là né tuyệt đối mọi mẩu vụn. LƯU
    // Ý: so sánh ngưỡng phải dùng rawF (lít NL thô), KHÔNG PHẢI bumpV (thể tích pha loãng — có thể
    // lớn hơn rawF rất nhiều lần với lô đậm đặc) — bug từng gặp khiến ngưỡng không kích hoạt được.
    for (let fragGuard = 0; fragGuard < 6; fragGuard++) {
      const leftoverA = peekLeftoverInBoundaryLot(orderedA, curA, gSubtilis, V);
      const leftoverB = peekLeftoverInBoundaryLot(orderedB, curB, gClausii, V);
      const bumpA = leftoverA.rawF > EPS && leftoverA.rawF <= MIN_LOT_FRAGMENT_L + EPS ? leftoverA.bumpV : 0;
      const bumpB = leftoverB.rawF > EPS && leftoverB.rawF <= MIN_LOT_FRAGMENT_L + EPS ? leftoverB.bumpV : 0;
      if (bumpA <= EPS && bumpB <= EPS) break;
      const bump = bumpA > EPS && bumpB > EPS ? Math.min(bumpA, bumpB) : Math.max(bumpA, bumpB);
      const vBumped = capByLotCount(Math.min(V + bump, maxA, maxB, tankMaxL, remainingV));
      if (vBumped <= V + EPS) break;
      V = vBumped;
    }

    // Chiều NGƯỢC LẠI: từ khi cho phép tìm tổ hợp cân đối băng qua ranh giới lô sản xuất
    // (findBestMatchedLots), V đôi khi vừa "gặm" 1 miếng xíu (≤ MIN_LOT_FRAGMENT_L) của 1 lô HOÀN
    // TOÀN MỚI rồi bị mốc mềm/trần tank/giới hạn số lô chặn lại giữa chừng — để lại phần LỚN lô đó
    // cho mẻ sau (đúng ca thực tế gặp: mẩu 0.5L/9.5L). LÙI V lại đúng bằng phần vừa gặm để lô đó
    // dành NGUYÊN VẸN cho mẻ sau, khôi phục lại đúng điểm dừng sạch ở ranh giới lô sản xuất — cùng
    // kỹ thuật "mỗi vòng chỉ giải quyết bên cần ÍT hơn trước" như khối nới V ở trên, chỉ khác chiều.
    for (let nibbleGuard = 0; nibbleGuard < 6; nibbleGuard++) {
      const nibbleA = peekNewLotNibble(orderedA, curA, gSubtilis, V);
      const nibbleB = peekNewLotNibble(orderedB, curB, gClausii, V);
      const shrinkA = nibbleA.rawF > EPS && nibbleA.rawF <= MIN_LOT_FRAGMENT_L + EPS ? nibbleA.shrinkV : 0;
      const shrinkB = nibbleB.rawF > EPS && nibbleB.rawF <= MIN_LOT_FRAGMENT_L + EPS ? nibbleB.shrinkV : 0;
      if (shrinkA <= EPS && shrinkB <= EPS) break;
      const shrink = shrinkA > EPS && shrinkB > EPS ? Math.min(shrinkA, shrinkB) : Math.max(shrinkA, shrinkB);
      const vShrunk = V - shrink;
      if (vShrunk >= V - EPS || vShrunk <= EPS) break;
      V = vShrunk;
    }
    if (!Number.isFinite(V) || V <= EPS) break; // hết sạch 1 trong 2 luồng (không thể dọn nốt được nữa) -> dừng, phần đã có sẽ được đối chiếu sàn 90%.

    const takenA = consumeExactCFU(orderedA, curA, gSubtilis * 1000 * V);
    const takenB = consumeExactCFU(orderedB, curB, gClausii * 1000 * V);
    const subtilis = takenA.map((t) => ({ maLo: t.maLo, E: t.E, theTichRaw: t.F }));
    const clausii = takenB.map((t) => ({ maLo: t.maLo, E: t.E, theTichRaw: t.F }));
    remainingV -= V;

    // Xem trước (không mutate) phần còn lại của CHAI ĐANG DỞ DANG tại cursor (nếu có) — dùng cho cả
    // 2 cơ chế "dồn nốt không thêm nước" bên dưới.
    const peekBottleLeftoverF = (cur, ordered) => {
      if (cur.usedCFU <= EPS || cur.idx >= ordered.length) return 0;
      const lot = ordered[cur.idx];
      return (cfuOfLot(lot) - cur.usedCFU) / (1000 * lot.E);
    };
    // Dồn THẲNG phần còn lại của chai đang dở dang vào NGAY mẻ này, KHÔNG THÊM NƯỚC (không đổi V) —
    // làm NGAY TẠI ĐÂY (trước bước làm tròn 0.5L) để đi qua đúng luồng roundRawTwoStream như mọi
    // phần khác, tránh để lại số lẻ xấu. Chấp nhận mật độ mẻ này dư cao hơn đích.
    const drainBottle = (cur, ordered, list) => {
      const remainingF = peekBottleLeftoverF(cur, ordered);
      if (remainingF <= EPS) return;
      const lot = ordered[cur.idx];
      const existing = list.find((x) => x.maLo === lot.maLo);
      if (existing) existing.theTichRaw += remainingF;
      else list.push({ maLo: lot.maLo, E: lot.E, theTichRaw: remainingF });
      cur.idx += 1;
      cur.usedCFU = 0;
    };

    // CHỈ dồn nốt (không thêm nước) khi đây là bước đóng CUỐI CÙNG của cả nhịp (remainingV vừa cạn)
    // VÀ đã bị chặn trần overshoot — KHÔNG áp dụng bừa cho MỌI mẻ (đã thử — làm lệch quỹ đạo tiêu
    // thụ thực tế so với vFinalClausiiClean đã tính trước, khiến trần 20% bị PHÁ VỠ, T ra tới 1.4x thay
    // vì ≤1.2x — nghiêm trọng hơn hẳn việc còn sót 1 mẩu <1L ở mẻ giữa chừng. Trần sản lượng là ưu
    // tiên cao nhất theo đúng chốt của NCV, hơn cả việc né tuyệt đối mọi mẩu vụn).
    // CHỈ dồn nốt CLAUSII (không phải cả 2 luồng như bản cũ) — nguyên tắc 4 mới (2026-07-29, cùng
    // ngày): subtilis được PHÉP để dở dang, KHÔNG cần/KHÔNG NÊN ép dồn hết vào đây nữa. Bản cũ dồn
    // cả subtilis từng đúng khi CẢ 2 luồng bắt buộc dùng hết 100% ngang nhau — nay đã đổi, dồn cả
    // subtilis vào đây sẽ gây ĐÚNG bug NCV báo (mẻ cuối dư mật độ subtilis rất nặng dù không cần
    // thiết — chai subtilis đang dở đáng lẽ được để dở, không phải vét sạch cho hết chai).
    let batchCapped = false;
    if (cappedByOvershoot && remainingV <= EPS) {
      drainBottle(curB, orderedB, clausii);
      // GHIM lại đúng V TRƯỚC KHI dồn — recomputeBatchVolumes bên dưới tính V từng mẻ ĐỘC LẬP từ
      // CFU thực tế (không biết gì về việc "không được thêm nước"), nếu không ghim lại thì CFU vừa
      // dồn thêm (có thể gần bằng nguyên 1 lô) sẽ bị hiểu thành "mẻ này thật ra cần nhiều nước hơn"
      // và tự ý bơm nước lên lại — phá vỡ đúng trần vừa chặn. Áp dụng lại giá trị này SAU khi
      // recomputeBatchVolumes chạy xong (xem bên dưới).
      pinnedFinalV = V;
      // Đánh dấu mẻ này đã bị ghim (capped) — nếu SAU đó mergeSparseBatches ghép mẻ tí hon này vào
      // mẻ liền kề (vì < 500L), mergeTwoStreamBatches PHẢI biết để không "hồi sinh" lại đúng phần V
      // vừa bị ghim (xem bug thật gặp 2026-07-29: mẻ tí hon 2.02L chứa CFU clausii dồn thêm được ghép
      // vào mẻ trước, mergeTwoStreamBatches tính lại V ĐỘC LẬP từ tổng CFU mới → V vọt lên 879L, vượt
      // hẳn trần 839,52L vừa chặn — vì phép ghép không biết mẻ tí hon này đã cố tình "không thêm
      // nước").
      batchCapped = true;
    }

    const tronLoSanXuatA = new Set(subtilis.map((t) => loSanXuatOf(t))).size > 1;
    batches.push({
      meSo: batches.length + 1,
      tongTheTich: V,
      capped: batchCapped,
      tronLoSanXuat: tronLoSanXuatA,
      loSanXuatList: Array.from(new Set([...subtilis.map(loSanXuatOf), ...clausii.map(loSanXuatOf)])),
      // Riêng danh sách lô sản xuất CỦA CLAUSII — dùng để cảnh báo tiệt trùng RIÊNG khi vừa dùng hết
      // 1 lô clausii (nguyên tắc 2, tách biệt khỏi cảnh báo chung 3-lô ở App.jsx computeSterilizeFlags).
      clausiiLoSanXuatList: Array.from(new Set(clausii.map(loSanXuatOf))),
      subtilis,
      clausii,
    });
  }

  // Làm tròn thể tích NGUYÊN LIỆU hiển thị/đong thực tế về bội số 0.5L cho từng luồng (làm tròn
  // LÊN cho mọi lần đong — kể cả phần cuối 1 lô, MIỄN vẫn còn nằm trong lượng thật của chai đó;
  // chỉ giữ nguyên số dư chính xác khi lô đã thật sự dùng hết đúng 100%, xem roundRawTwoStream).
  const subtilisByMaLo = Object.fromEntries(subtilisLots.map((l) => [l.maLo, l]));
  const clausiiByMaLo = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l]));
  roundRawTwoStream(batches, "subtilis", subtilisByMaLo);
  roundRawTwoStream(batches, "clausii", clausiiByMaLo);
  // Bỏ các lần đong tròn về đúng 0 (mẻ trước cùng lô đã "vay" hết) + mẻ nào rỗng hẳn cả 2 luồng
  // thì loại bỏ, rồi tính lại danh sách lô sản xuất cho đúng thực tế còn lại.
  const pruned = pruneZeroEntries(batches);
  recomputeLoSanXuatMeta(pruned);
  // Rồi TÍNH LẠI V (nước pha) từng mẻ trực tiếp từ CFU thực tế (sau làm tròn) / mật độ ĐÍCH —
  // giống hệt nguyên tắc "suy V từ F" ở SP 1 thành phần: mẻ có NL dư do làm tròn lên thì được
  // THÊM NƯỚC tương ứng để mật độ không vọt lên vô ích và mẻ không bị co nhỏ giả tạo; mẻ nào bị
  // hụt CFU (do mẻ trước cùng lô đã "vay" phần dư 0.5L) thì rút bớt nước — dù tăng hay giảm,
  // mật độ luôn nằm sát mật độ đích G, không bao giờ tụt dưới.
  recomputeBatchVolumes(pruned, gSubtilis, gClausii, tankMaxL);

  // GHIM LẠI V của mẻ vừa "dồn nốt không thêm nước" (nếu có, xem pinnedFinalV ở vòng lặp trên) —
  // recomputeBatchVolumes ở trên tính V ĐỘC LẬP theo CFU thực tế của TỪNG mẻ (không biết gì về ý
  // định "không thêm nước"), nên CFU dồn thêm sẽ bị hiểu nhầm thành "mẻ này cần nhiều nước hơn" và
  // tự ý bơm V lên lại — phá vỡ đúng trần overshoot vừa chặn. Ép về ĐÚNG giá trị đã ghim (không bao
  // giờ ép cao lên, chỉ có thể ép XUỐNG nếu recompute tính ra cao hơn) để mật độ hấp thụ chênh lệch
  // như đã định, không phải thể tích.
  if (pinnedFinalV != null && pruned.length > 0) {
    pruned[pruned.length - 1].tongTheTich = Math.min(pruned[pruned.length - 1].tongTheTich, pinnedFinalV);
  }

  const merged = mergeSparseBatches(pruned, {
    tankMaxL,
    maxLotsPerBatch,
    mergeBatches: (a, b) => mergeTwoStreamBatches(a, b, gSubtilis, gClausii),
    lotCountOf: (b) => b.subtilis.length + b.clausii.length,
    // SP 2 thành phần pha CHUNG 1 tank — 1 mẻ THIẾU HẲN 1 luồng (0 subtilis hoặc 0 clausii) là mẻ
    // sai công thức, không phải chỉ "hơi vơi", nên phải ép ghép bất kể thể tích đang lớn cỡ nào.
    needsMerge: (b) => b.tongTheTich < MIN_BATCH_L - EPS || b.subtilis.length === 0 || b.clausii.length === 0,
  });

  // KHÔNG cắt bớt NL luồng "dư" về đúng mức cần nữa (khác bản trước) — NCV chốt rõ: chai đã mở
  // phải dùng hết 100%, thà mật độ nhỉnh nhẹ do quy tròn 0.5L còn hơn báo "dùng X lít" mà thực ra
  // chỉ tính có (X trừ phần cắt) lít, để lại 1 chai dở dang không đúng thực tế đong. (Phần dồn CFU
  // "dọn nốt" khi bị chặn trần overshoot đã xử lý NGAY TRONG vòng lặp chính ở trên — trước bước làm
  // tròn — để đi qua đúng luồng roundRawTwoStream như mọi phần khác, không để lại số lẻ xấu.)
  return { batches: merged, subtilisShortfallLot };
}

// lotByMaLo: tra cứu F GỐC THẬT (cả chai, từ đúng kho subtilisLots/clausiiLots truyền vào
// packTwoStreamBatches) — cần để phân biệt 2 tình huống ở phần CUỐI cùng của 1 lô: (a) lô đã dùng
// ĐÚNG HẾT 100% (tổng các phần == F gốc) -> PHẢI giữ nguyên số dư chính xác, làm tròn lên sẽ thành
// "bịa" thêm NL không có thật; (b) lô mới dùng 1 PHẦN rồi dừng (luồng KIA đã cạn sạch toàn bộ kho,
// không còn gì để ghép tiếp) — phần còn lại VẪN CÒN NGUYÊN trong chai, nên làm tròn lên tới 0.5L
// gần nhất là AN TOÀN (còn dư sẵn trong kho để bù), giúp NCV đong số đẹp thay vì số lẻ như 3.93L.
function roundRawTwoStream(batches, streamKey, lotByMaLo) {
  const lotPortions = {};
  batches.forEach((b) => {
    b[streamKey].forEach((entry) => { (lotPortions[entry.maLo] ||= []).push(entry); });
  });
  Object.values(lotPortions).forEach((portions) => {
    // Chụp lại RAW gốc (trước khi làm tròn/mutate) của TỪNG phần — cần để tính "phần cần dành lại
    // cho các phần SAU" bên dưới, tránh bug nghiêm trọng từng gặp: 1 phần KHÔNG PHẢI cuối cùng làm
    // tròn lên "ăn" hết luôn cả phần RAW mà 1 phần SAU nó (thuộc 1 mẻ KHÁC) đang cần — nếu phần sau
    // đó là NGUỒN DUY NHẤT của luồng này trong mẻ đó, mẻ đó sẽ bị làm tròn về 0 và bị prune mất luôn,
    // để lại 1 mẻ MỒ CÔI thiếu hẳn 1 luồng (vd chỉ còn subtilis, mất sạch clausii) — rất nguy hiểm vì
    // trông như 1 mẻ hợp lệ nhưng thực chất sai công thức hoàn toàn. Phát hiện 2026-07-29 khi thêm
    // thuật toán ghép cân đối (matching) tạo ra 1 ca thực tế trúng đúng ranh giới này.
    const rawValues = portions.map((p) => p.theTichRaw);
    const lotTotal = rawValues.reduce((s, v) => s + v, 0);
    const trueF = lotByMaLo?.[portions[0].maLo]?.F ?? lotTotal;
    let already = 0;
    portions.forEach((entry, idx) => {
      const isLast = idx === portions.length - 1;
      let rawUsed;
      if (!isLast) {
        // Chỉ được làm tròn lên trong phạm vi CHỪA LẠI ĐỦ TỐI THIỂU 1 bước 0.5L cho MỖI phần còn lại
        // phía sau — KHÔNG PHẢI chừa nguyên lượng RAW CHƯA làm tròn của chúng (bug đã gặp 2026-07-29:
        // dùng đúng tổng RAW làm reserve khiến ceiling gần như luôn khít đúng bằng rawValues[idx],
        // không còn dư ra dù chỉ 1 bước 0.5L để làm tròn LÊN — kết quả CẢ 2 phần đều bị bỏ ngỏ không
        // tròn, hiện số lẻ xấu như 6.91L/2.09L thay vì 7.0L/2.0L, dù tổng vẫn đúng và không hề mồ côi
        // — vi phạm nguyên tắc "NL đong bội số 0.5L"). Chừa tối thiểu 0.5L/phần vẫn đủ AN TOÀN để né
        // mẻ mồ côi (chứng minh quy nạp: nếu phần còn lại >= (số phần còn lại)×0.5L trước khi xử lý
        // phần này, ceiling >= 0.5L nên phần này luôn được rảnh tối thiểu 1 bước để tròn, và tổng còn
        // lại sau đó vẫn giữ đúng bất biến cho các phần kế tiếp) — miễn lotTotal đủ lớn so với số phần
        // (luôn đúng trong thực tế, vì lô quá vụn đã bị né từ sớm bởi MIN_LOT_FRAGMENT_L).
        const reserveForRest = RAW_ROUND_STEP_L * (portions.length - 1 - idx);
        rawUsed = clamp(Math.ceil(rawValues[idx] / RAW_ROUND_STEP_L) * RAW_ROUND_STEP_L, 0, lotTotal - already - reserveForRest);
      } else {
        const exact = lotTotal - already;
        const roundedUp = Math.ceil(exact / RAW_ROUND_STEP_L) * RAW_ROUND_STEP_L;
        // Chỉ làm tròn lên nếu TỔNG CỘNG đã dùng (already + roundedUp, không phải chỉ riêng phần
        // cuối này) vẫn còn NẰM TRONG lượng thật của chai — nếu lô đã dùng đúng hết 100% (lotTotal
        // == trueF), làm tròn lên sẽ "bịa" thêm NL không có thật, giữ nguyên số dư chính xác. BUG đã
        // gặp: so sánh nhầm CHỈ `roundedUp` (riêng phần cuối) với `trueF` (cả chai) — với lô có ≥2
        // phần (already > 0), phép so sánh sai này gần như luôn đúng (vì 1 phần lẻ luôn nhỏ hơn cả
        // chai), khiến vẫn làm tròn lên dù tổng đã vượt quá trueF thật — chính là nguyên nhân gây mẻ
        // "mồ côi"/mật độ ảo tăng vọt phát hiện 2026-07-29 khi thêm thuật toán ghép cân đối.
        rawUsed = already + roundedUp <= trueF + EPS ? roundedUp : exact;
      }
      already += rawUsed;
      entry.theTichRaw = rawUsed;
    });
  });
}

function mergeLotArrays(a, b) {
  const merged = a.map((x) => ({ ...x }));
  for (const l of b) {
    const existing = merged.find((x) => x.maLo === l.maLo);
    if (existing) existing.theTichRaw += l.theTichRaw;
    else merged.push({ ...l });
  }
  return merged;
}

// LƯU Ý: không thể chỉ cộng V_a+V_b như bên 1 thành phần — nếu 1 trong 2 mẻ nguồn THIẾU HẲN 1
// luồng (0 subtilis hoặc 0 clausii, mật độ luồng đó = 0), cộng thẳng V sẽ pha loãng luồng còn lại
// của mẻ kia xuống dưới đích. Phải TÍNH LẠI V từ đúng tổng CFU/mật độ đích sau khi gộp raw.
// CỐ Ý KHÔNG chặn ở tankMaxL tại đây (khác packTwoStreamBatches) — nếu chặn ở đây, phần CFU vượt
// trần sẽ bị "biến mất" âm thầm (đã cộng vào NL nhưng mật độ báo cáo lại giả vờ như mẻ chỉ nhiêu
// đó thể tích, đội mật độ báo cáo lên cao vọt) mà không hề được cảnh báo. Để mergeSparseBatches ở
// trên tự KIỂM TRA merged.tongTheTich so với tankMaxL và TỪ CHỐI ghép nếu vượt trần thật sự.
function mergeTwoStreamBatches(a, b, gSubtilis, gClausii) {
  const subtilis = mergeLotArrays(a.subtilis, b.subtilis);
  const clausii = mergeLotArrays(a.clausii, b.clausii);
  const loSanXuatList = Array.from(new Set([...(a.loSanXuatList || []), ...(b.loSanXuatList || [])]));
  const cfuA = subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
  const cfuB = clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
  const vCapA = cfuA > EPS ? cfuA / (1000 * gSubtilis) : Infinity;
  const vCapB = cfuB > EPS ? cfuB / (1000 * gClausii) : Infinity;
  let tongTheTich = cfuA <= EPS && cfuB <= EPS ? 0 : Math.min(vCapA, vCapB);
  // Nếu 1 trong 2 mẻ nguồn đã bị GHIM (capped, xem packTwoStreamBatches — mẻ đóng cuối bị chặn trần
  // overshoot nên "dồn CFU clausii không thêm nước") — TUYỆT ĐỐI không để phép tính lại V ở trên vô
  // tình "hồi sinh" đúng phần nước đã cố tình không thêm (bug thật gặp 2026-07-29: mẻ tí hon 2L chứa
  // CFU dồn thêm bị ghép vào mẻ trước, tính lại V độc lập theo tổng CFU mới → V vọt vượt hẳn trần vừa
  // chặn). Trần AN TOÀN cho trường hợp này là tổng V 2 mẻ nguồn (mỗi mẻ đã đúng V của nó rồi, ghép 2
  // tank lại KHÔNG BAO GIỜ cần nhiều nước hơn tổng 2 tank cộng lại) — lấy giá trị NHỎ HƠN giữa 2 cách
  // tính. KHÔNG áp quy tắc này cho ca "thiếu hẳn 1 luồng" (mục đích chính của việc tính lại V ở trên)
  // vì ca đó CẦN được phép tính ra lớn hơn tổng thô để sửa đúng mật độ.
  const capped = a.capped || b.capped;
  if (capped) tongTheTich = Math.min(tongTheTich, a.tongTheTich + b.tongTheTich);
  const clausiiLoSanXuatList = Array.from(new Set(clausii.map((e) => loSanXuatOf(e))));
  return { meSo: 0, tongTheTich, capped, tronLoSanXuat: loSanXuatList.length > 1, loSanXuatList, clausiiLoSanXuatList, subtilis, clausii };
}

// Bỏ các lần đong bị làm tròn RA ĐÚNG 0 (do mẻ trước cùng lô đã "vay" hết phần dư 0.5L — xem
// roundRawTwoStream) — hiển thị "0.00 L" cho 1 lô là vô nghĩa/gây hiểu nhầm. Mẻ nào rỗng CẢ HAI
// luồng sau khi bỏ (không còn đóng góp gì thật) thì loại bỏ hẳn mẻ đó, không chỉ riêng lô.
function pruneZeroEntries(batches) {
  return batches
    .map((b) => ({
      ...b,
      subtilis: b.subtilis.filter((e) => e.theTichRaw > EPS),
      clausii: b.clausii.filter((e) => e.theTichRaw > EPS),
    }))
    .filter((b) => b.subtilis.length > 0 || b.clausii.length > 0);
}

// Tính lại loSanXuatList/tronLoSanXuat từ đúng các lô CÒN THẬT trong mẻ sau khi đã bỏ lô rỗng —
// nếu không, 1 lô sản xuất đã bị loại bỏ hoàn toàn (rơi vào trường hợp trên) vẫn còn sót lại
// trong danh sách, làm sai lệch cảnh báo tiệt trùng/trộn lô.
function recomputeLoSanXuatMeta(batches) {
  batches.forEach((b) => {
    const loSanXuatList = Array.from(new Set([...b.subtilis.map(loSanXuatOf), ...b.clausii.map(loSanXuatOf)]));
    b.loSanXuatList = loSanXuatList;
    b.tronLoSanXuat = loSanXuatList.length > 1;
    b.clausiiLoSanXuatList = Array.from(new Set(b.clausii.map(loSanXuatOf)));
  });
}

function recomputeBatchVolumes(batches, gSubtilis, gClausii, tankMaxL) {
  batches.forEach((b) => {
    const cfuA = b.subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
    const cfuB = b.clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
    if (cfuA <= EPS && cfuB <= EPS) { b.tongTheTich = 0; return; } // mẻ rỗng thật sự — không "tự vẽ" ra nước.
    const vCapA = cfuA > EPS ? cfuA / (1000 * gSubtilis) : Infinity;
    const vCapB = cfuB > EPS ? cfuB / (1000 * gClausii) : Infinity;
    b.tongTheTich = Math.min(vCapA, vCapB, tankMaxL);
  });
}

/**
 * Lập kế hoạch mẻ pha cho sản phẩm 2 thành phần (subtilis + clausii pha chung 1 tank).
 * Mỗi mẻ rút CẢ HAI luồng ĐÚNG theo mật độ đích riêng của từng luồng (gSubtilis, gClausii) —
 * KHÔNG quy về 1 mật độ đã "khớp tỉ lệ" tính sẵn cho cả nhịp (cách cũ: chọn trước 1 tập lô mỗi
 * luồng sao cho tổng bào tử khớp tỉ lệ đích rồi ép dùng hết — hễ tỉ lệ kho thực tế lệch tỉ lệ
 * đích, luồng dư sẽ bị ép pha ở mật độ vượt hẳn đích, rất phí NL).
 *
 * Chai đã mở (đã chạm tới) LUÔN phải dùng hết — kể cả khi đã đủ N ống, nếu còn 1 luồng đang dở 1
 * chai thì thuật toán tự pha thêm mẻ "dọn nốt" cho tới khi dùng hết sạch. THỂ TÍCH (và do đó số ống
 * T) không bao giờ vượt quá vTarget*MAX_CLOSING_OVERSHOOT (trần cứng +20%) — nếu dùng hết sạch NL
 * đòi hỏi nhiều nước hơn mức đó, KHÔNG thêm nước nữa mà dồn thẳng CFU còn thiếu vào mẻ cuối, chấp
 * nhận mật độ mẻ đó dư cao hơn đích để "gánh" thay (chốt NCV 2026-07-29: ưu tiên số 1 là không để
 * dư NL — nhất là clausii — nhưng KHÔNG được để tổng thể tích/số ống dư quá 20%; mật độ được phép
 * dư để hấp thụ chênh lệch, UI có cảnh báo khi mật độ dư >3% hoặc T dư >20% để NCV tự xem xét).
 * Chỉ để lại 1 chai dở dang THẬT khi 1 luồng cạn sạch TOÀN BỘ kho đã chọn (không còn chai nào để
 * dọn nốt) — giới hạn vật lý duy nhất không tránh được, ngoài trần overshoot ở trên.
 *
 * @param {{subtilisLots, clausiiLots, product}} args
 *   product: { N, H, gSubtilis, gClausii }
 */
export function planTwoComponent({ subtilisLots, clausiiLots, product, tankMaxL = TANK_MAX_L, maxLotsPerBatch = MAX_LOTS_PER_BATCH }) {
  const { N, H, gSubtilis, gClausii } = product;
  const vTarget = (N * H) / 1000; // thể tích cần để ra đúng N ống, vì mật độ mỗi luồng luôn = đích
  const vMin = (TUBE_TOL_LOW * N * H) / 1000; // sàn khả thi tối thiểu (90% đơn)

  const { batches, subtilisShortfallLot } = packTwoStreamBatches(subtilisLots, gSubtilis, clausiiLots, gClausii, tankMaxL, maxLotsPerBatch, vTarget);
  const totalV = batches.reduce((s, b) => s + b.tongTheTich, 0);

  if (totalV < vMin - EPS) {
    // Phân biệt rõ 2 nguyên nhân khác nhau: (a) kho nói chung quá ít (thông báo cũ), (b) kho ĐỦ về
    // tổng khối lượng nhưng thuật toán CHỦ ĐỘNG dừng sớm hơn vì subtilis không đủ để đóng nốt 1 lô
    // clausii mà KHÔNG được để dở dang (nguyên tắc bắt buộc, chốt NCV) — NCV cần biết chính xác đây
    // là do thiếu subtilis (không phải thiếu clausii) để bổ sung đúng thứ cần bổ sung.
    const reason = subtilisShortfallLot
      ? `Kho subtilis không đủ để dùng hết lô clausii "${subtilisShortfallLot}" mà không để dở dang (nguyên tắc bắt buộc — clausii không bao giờ được để dở) — kế hoạch chỉ đạt ${totalV.toFixed(1)}L, dưới 90% mục tiêu. Cần bổ sung subtilis hoặc điều chỉnh đơn.`
      : "Kho subtilis và/hoặc clausii hiện có (đã qua KQKN, ở Chờ pha) không đủ để đạt tối thiểu 90% số ống cần — cần NCV bổ sung nguyên liệu hoặc điều chỉnh đơn.";
    return { feasible: false, reason, subtilisShortfallLot };
  }

  const T = Math.floor((totalV * 1000) / H);

  // Gộp lại lượng NL thực đã dùng theo từng lô (1 lô có thể trải trên nhiều mẻ) để đối soát bào
  // tử và báo danh sách lô đã dùng — mật độ báo cáo tính từ đúng tổng CFU thực/tổng V thực (luôn
  // sát đích, có thể nhỉnh lên chút do quy tròn NL 0.5L, không bao giờ tụt dưới).
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

  const massBalanceSubtilis = checkMassBalance(usedSubtilis, dSubtilis, T, H);
  const massBalanceClausii = checkMassBalance(usedClausii, dClausii, T, H);

  return {
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
    // Khác null khi kho subtilis không đủ để đóng nốt đúng lô clausii này -> T đã bị dừng sớm hơn N
    // để KHÔNG để dở clausii (chốt NCV) — App.jsx hiển thị cảnh báo riêng, đề nghị bổ sung subtilis.
    subtilisShortfallLot,
  };
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
