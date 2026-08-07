// Test thuật toán src/lib/mixPlanner.js bằng bộ dữ liệu mẫu đã đối chiếu với
// file Excel gốc Công_thức_tính.xlsx (Bộ 2 - "SF", 12 lô, dòng 36-47).
// Chạy: node scripts/test-mix-planner.mjs

import {
  densityAndTubes,
  enumerateFeasibleSubsets,
  packSingleStreamBatches,
  planSingleComponent,
  planTwoComponent,
  checkMassBalance,
  validateProposedTwoComponentPlan,
  TANK_MAX_L,
  MAX_LOTS_PER_BATCH,
  MIN_LOT_FRAGMENT_L,
  MAX_CLOSING_OVERSHOOT,
} from "../src/lib/mixPlanner.js";

let passCount = 0;
let failCount = 0;
function check(label, cond, detail = "") {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}  ${detail}`);
  }
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : n);

// Mật độ thực tế GỘP CẢ MẺ (sau khi NL đã quy tròn) — mô phỏng đúng check trong App.jsx.
function batchDensityOk(batches, G) {
  return batches.map((b) => {
    const cfu = b.lots.reduce((s, x) => s + x.theTichRaw * x.E, 0) * 1000;
    const d = cfu / (b.tongTheTich * 1000);
    return { meSo: b.meSo, d, ok: d >= G - G * 1e-6 };
  });
}

// ---------------------------------------------------------------------------
// BỘ 2 (SF) - 12 lô sạch, dùng làm bộ test chính. G=4.0e8 CFU/ml, H=5.3 ml.
// Cột I,J kỳ vọng lấy nguyên từ file gốc (dòng 36-47).
// ---------------------------------------------------------------------------
const BO2_LOTS = [
  { maLo: "060326SF1.C4", E: 3.32e10, F: 10.0, expI: 830.0, expJ: 156604 },
  { maLo: "060326SF1.C5", E: 3.17e10, F: 10.0, expI: 792.5, expJ: 149528 },
  { maLo: "060326SF1.C7", E: 3.23e10, F: 9.0, expI: 726.75, expJ: 137123 },
  { maLo: "060326SF1.C8", E: 3.19e10, F: 5.0, expI: 398.75, expJ: 75236 },
  { maLo: "010426SF1.C1", E: 3.39e10, F: 10.0, expI: 847.5, expJ: 159906 },
  { maLo: "010426SF1.C2", E: 3.43e10, F: 10.0, expI: 857.5, expJ: 161792 },
  { maLo: "010426SF1.C3", E: 3.4e10, F: 10.0, expI: 850.0, expJ: 160377 },
  { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, expI: 837.5, expJ: 158019 },
  { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, expI: 832.5, expJ: 157075 },
  { maLo: "010426SF1.C6", E: 3.35e10, F: 9.0, expI: 753.75, expJ: 142217 },
  { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, expI: 735.75, expJ: 138821 },
  { maLo: "010426SF1.C8", E: 3.31e10, F: 8.0, expI: 662.0, expJ: 124906 },
];
const G2 = 4.0e8;
const H2 = 5.3;

console.log("=== 1. Công thức lõi: so chéo I=F*E/G, J=F*E*1000/(G*H) với file gốc ===");
for (const lot of BO2_LOTS) {
  const I = (lot.F * lot.E) / G2;
  const J = (lot.F * lot.E * 1000) / (G2 * H2);
  check(`${lot.maLo}: I=${fmt(I)}L (kỳ vọng ${fmt(lot.expI)})`, approx(I, lot.expI, 0.05));
  check(`${lot.maLo}: J=${fmt(J)} ống (kỳ vọng ${fmt(lot.expJ)})`, approx(J, lot.expJ, 1));
}

console.log("\n=== 2. planSingleComponent - N vừa phải (1.500.000 ống), chọn subset ===");
{
  const product = { N: 1_500_000, G: G2, H: H2 };
  const plan = planSingleComponent({ lots: BO2_LOTS, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check(`T=${fmt(plan.T)} trong [${fmt(0.9 * product.N)}, ${fmt(1.1 * product.N)}]`, plan.T >= 0.9 * product.N && plan.T <= 1.1 * product.N);
    check(`d=${plan.d.toExponential(3)} trong [G, 1.05G]`, plan.d >= G2 - EPStest() && plan.d <= 1.05 * G2 + EPStest());
    check("mọi mẻ ≤ TANK_MAX_L", plan.batches.every((b) => b.tongTheTich <= TANK_MAX_L + 1e-6), JSON.stringify(plan.batches.map((b) => b.tongTheTich)));
    check(`mọi mẻ ≤ ${MAX_LOTS_PER_BATCH} lô`, plan.batches.every((b) => b.lots.length <= MAX_LOTS_PER_BATCH));
    check("đối soát bào tử pass (<1%)", plan.massBalance.pass, `diff=${plan.massBalance.diffPct.toFixed(4)}%`);
    // mỗi lô đã chọn phải dùng hết 100% qua các mẻ
    for (const maLo of plan.selectedLots) {
      const lot = BO2_LOTS.find((l) => l.maLo === maLo);
      const total = plan.batches.reduce((s, b) => s + (b.lots.find((x) => x.maLo === maLo)?.theTichDich || 0), 0);
      const expected = (lot.F * lot.E) / plan.d;
      check(`lô ${maLo} dùng hết (Σ=${fmt(total)}L, kỳ vọng ${fmt(expected)}L)`, approx(total, expected, 0.01));
    }
    const dChecks = batchDensityOk(plan.batches, G2);
    check("mật độ thực tế mọi mẻ >= G (sau quy tròn NL)", dChecks.every((c) => c.ok), JSON.stringify(dChecks.filter((c) => !c.ok)));
    console.log(`  -> chọn ${plan.selectedLots.length}/12 lô: ${plan.selectedLots.join(", ")}`);
    console.log(`  -> ${plan.batches.length} mẻ, T=${fmt(plan.T)} ống, d=${plan.d.toExponential(3)} CFU/ml`);
    console.log(`  -> thể tích từng mẻ: ${plan.batches.map((b) => fmt(b.tongTheTich)).join(" | ")}`);
  }
}

console.log("\n=== 3. planSingleComponent - N lớn, ép dùng gần hết 12 lô (kiểm packing nhiều mẻ) ===");
{
  const sumValueAll = BO2_LOTS.reduce((s, l) => s + l.E * l.F, 0);
  const S_all = sumValueAll * 1000;
  const T_at_G = S_all / (G2 * H2);
  // Đặt N sao cho vùng khả thi ép phải dùng (gần) toàn bộ 12 lô: T mục tiêu ~ sát T_at_G.
  const N = Math.floor(T_at_G / 1.08);
  const product = { N, G: G2, H: H2 };
  const plan = planSingleComponent({ lots: BO2_LOTS, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const minBatchesExpected = Math.ceil(plan.totalV / TANK_MAX_L);
    check(`số mẻ (${plan.batches.length}) >= cận dưới lý thuyết ceil(V/${TANK_MAX_L})=${minBatchesExpected}`, plan.batches.length >= minBatchesExpected);
    check("mọi mẻ ≤ TANK_MAX_L", plan.batches.every((b) => b.tongTheTich <= TANK_MAX_L + 1e-6));
    check(`mọi mẻ ≤ ${MAX_LOTS_PER_BATCH} lô`, plan.batches.every((b) => b.lots.length <= MAX_LOTS_PER_BATCH));
    check("đối soát bào tử pass (<1%)", plan.massBalance.pass, `diff=${plan.massBalance.diffPct.toFixed(4)}%`);
    const dChecks3 = batchDensityOk(plan.batches, G2);
    check("mật độ thực tế mọi mẻ >= G (sau quy tròn NL)", dChecks3.every((c) => c.ok), JSON.stringify(dChecks3.filter((c) => !c.ok)));
    console.log(`  -> N=${fmt(N)}, chọn ${plan.selectedLots.length}/12 lô, totalV=${fmt(plan.totalV)}L, ${plan.batches.length} mẻ, T=${fmt(plan.T)} ống`);
    console.log(`  -> thể tích từng mẻ: ${plan.batches.map((b) => fmt(b.tongTheTich)).join(" | ")}`);
    console.log(`  -> (đối chiếu spec: dùng cả 12 lô ~8979L thì cần tối thiểu 9 mẻ ở trần 1000L)`);
  }
}

console.log("\n=== 4. planSingleComponent - kho không đủ NL (phải báo infeasible, không tự bịa) ===");
{
  const product = { N: 50_000_000, G: G2, H: H2 }; // đơn quá lớn so với kho 12 lô
  const plan = planSingleComponent({ lots: BO2_LOTS, product });
  check("feasible = false khi kho không đủ", plan.feasible === false, JSON.stringify(plan));
}

console.log("\n=== 5. planTwoComponent - synthetic, tỉ lệ 2 chủng khớp nhau (kỳ vọng feasible) ===");
{
  // Dữ liệu tổng hợp hợp lý (không có trong file gốc): mật độ subtilis/clausii khác nhau,
  // F được chọn sao cho tỉ lệ tổng bào tử khớp tỉ lệ mật độ đích trong dung sai.
  const gSubtilis = 2.0e8;
  const gClausii = 4.0e8;
  const H = 5.3;
  const N = 500_000;
  // Cần S_sub/S_clau ~ gSubtilis/gClausii = 0.5 (ở vùng d=G cho cả 2, trường hợp lý tưởng)
  const subtilisLots = [
    { maLo: "010626SB1.C1", E: 3.3e10, F: 8.0 },
    { maLo: "020626SB1.C2", E: 3.3e10, F: 8.0 },
  ];
  const clausiiLots = [
    { maLo: "010626SC1.C1", E: 3.4e10, F: 16.0 },
    { maLo: "020626SC1.C2", E: 3.4e10, F: 15.0 },
  ];
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii } });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check(`T=${fmt(plan.T)} trong [${fmt(0.9 * N)}, ${fmt(1.1 * N)}]`, plan.T >= 0.9 * N && plan.T <= 1.1 * N);
    check("dSubtilis >= gSubtilis", plan.dSubtilis >= gSubtilis - EPStest());
    check("dSubtilis <= 1.05*gSubtilis", plan.dSubtilis <= 1.05 * gSubtilis + EPStest());
    check("dClausii >= gClausii", plan.dClausii >= gClausii - EPStest());
    check("dClausii <= 1.05*gClausii", plan.dClausii <= 1.05 * gClausii + EPStest());
    check("mọi mẻ <= TANK_MAX_L", plan.batches.every((b) => b.tongTheTich <= TANK_MAX_L + 1e-6));
    check(
      `mọi mẻ <= ${MAX_LOTS_PER_BATCH} lô (gộp 2 chủng)`,
      plan.batches.every((b) => b.subtilis.length + b.clausii.length <= MAX_LOTS_PER_BATCH)
    );
    // Lưu ý: massBalance (tổng nhịp) tính trên lô gốc (chưa quy tròn) nên vẫn phải khớp tuyệt đối —
    // quy tròn 0.5L chỉ áp dụng cho V nguyên liệu HIỂN THỊ từng mẻ, không đụng vào V mẻ/số ống.
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
    // V nguyên liệu hiển thị đã bị quy tròn 0.5L nên mật độ từng mẻ có thể LỆCH LÊN so với mật độ
    // nhịp (mẻ càng nhỏ, sai số tương đối do quy tròn càng lớn) — nhưng planTwoComponent phải tự
    // co V (nước pha) của mẻ bị hụt để đảm bảo KHÔNG BAO GIỜ tụt dưới mật độ đích, nên assert thẳng.
    let allBatchDensityOk = true;
    for (const b of plan.batches) {
      const cfuA = b.subtilis.reduce((s, x) => s + x.theTichRaw * x.E, 0) * 1000;
      const cfuB = b.clausii.reduce((s, x) => s + x.theTichRaw * x.E, 0) * 1000;
      const dA_batch = b.tongTheTich > 0 ? cfuA / (1000 * b.tongTheTich) : gSubtilis;
      const dB_batch = b.tongTheTich > 0 ? cfuB / (1000 * b.tongTheTich) : gClausii;
      if (dA_batch < gSubtilis - EPStest() || dB_batch < gClausii - EPStest()) allBatchDensityOk = false;
      console.log(`  (tham khảo) mẻ ${b.meSo}: dSubtilis=${dA_batch.toExponential(3)} (nhịp ${plan.dSubtilis.toExponential(3)}), dClausii=${dB_batch.toExponential(3)} (nhịp ${plan.dClausii.toExponential(3)})`);
    }
    check("mật độ thực tế mọi mẻ (cả 2 luồng) >= mật độ đích (sau quy tròn NL)", allBatchDensityOk);
    console.log(`  -> ${plan.batches.length} mẻ, T=${fmt(plan.T)} ống, dSubtilis=${plan.dSubtilis.toExponential(3)}, dClausii=${plan.dClausii.toExponential(3)}`);
    console.log(`  -> lô subtilis dùng: ${plan.selectedSubtilisLots.join(", ")} | lô clausii dùng: ${plan.selectedClausiiLots.join(", ")}`);
  }
}

console.log("\n=== 6. planTwoComponent - kho subtilis quá ít (kỳ vọng infeasible, không tự bịa) ===");
{
  // Từ khi đổi sang FIFO không ép khớp tỉ lệ (chỉ chốt V = min hai bên), lệch tỉ lệ không còn
  // tự động infeasible nữa (chấp nhận dư mật độ 1 bên) — case infeasible thực sự giờ là khi 1
  // luồng thiếu NL, không đạt nổi sàn 90% của chính luồng đó.
  const gSubtilis = 2.0e8;
  const gClausii = 4.0e8;
  const H = 5.3;
  const N = 500_000;
  const subtilisLots = [{ maLo: "SUB-TINY", E: 3.3e10, F: 1.0 }]; // quá ít so với N cần
  const clausiiLots = [{ maLo: "CLAU-OK", E: 3.4e10, F: 28.24 }];
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii } });
  check("feasible = false khi kho subtilis quá ít", plan.feasible === false, JSON.stringify(plan));
}

console.log("\n=== 7. planTwoComponent - kho 2 chủng lệch tỉ lệ nặng (kỳ vọng KHÔNG còn NL dư, chấp nhận sản lượng dư) ===");
{
  // Nhiều lô sản xuất nhỏ xen kẽ, kích cỡ chai/mật độ 2 chủng KHÔNG khớp nhau. NCV chốt lại
  // 2026-07-29: tuyệt đối không được để dư NL (nhất là clausii) dù T dư ra bao nhiêu — bỏ hẳn
  // trần MAX_CLOSING_OVERSHOOT đã thêm trước đó (chỉ 1 ngày trước), UI hiển thị cảnh báo dư sản
  // lượng cho NCV tự quyết định thay vì thuật toán tự ý dừng sớm bỏ dở NL.
  const gSubtilis = 4.0e8;
  const gClausii = 2.4e8;
  const H = 5.3;
  const N = 500_000;
  const makeLots = (prefix, nLoSanXuat, chaiPerLo, F, E) => {
    const lots = [];
    for (let lo = 1; lo <= nLoSanXuat; lo++) {
      for (let c = 1; c <= chaiPerLo; c++) {
        lots.push({ maLo: `${prefix}${lo}.C${c}`, E: E + (c % 3) * 1e8, F });
      }
    }
    return lots;
  };
  const subtilisLots = makeLots("010426SF", 6, 5, 10.0, 3.3e10);
  const clausiiLots = makeLots("26G0SA", 6, 4, 9.0, 2.9e10);
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii } });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("dSubtilis >= gSubtilis", plan.dSubtilis >= gSubtilis - EPStest());
    check("dClausii >= gClausii", plan.dClausii >= gClausii - EPStest());
    console.log(`  -> N=${fmt(N)}, T=${fmt(plan.T)} (${(plan.T / N).toFixed(2)}x N), ${plan.batches.length} mẻ, totalV=${fmt(plan.totalV, 1)}L`);

    // Nguyên tắc 4 (2026-07-29, bất đối xứng): CLAUSII đã chạm tới phải dùng ĐÚNG HẾT 100% — LUÔN
    // LUÔN, không còn ngoại lệ nào (kể cả khi subtilis cạn sạch kho — lúc đó thuật toán phải LÙI lại,
    // không mở lô clausii đó, xem subtilisShortfallLot). SUBTILIS thì ngược lại — được PHÉP dở dang
    // bất kỳ lúc nào (không cần điều kiện "luồng kia cạn kho" như bản test cũ trước khi có nguyên tắc
    // 4), nên không cần kiểm tra gì cho subtilis ở đây nữa.
    const checkFullyUsed = (lots, streamKey) => {
      const byMaLo = Object.fromEntries(lots.map((l) => [l.maLo, l]));
      const used = {};
      plan.batches.forEach((b) => b[streamKey].forEach((e) => { used[e.maLo] = (used[e.maLo] || 0) + e.theTichRaw; }));
      const partial = Object.entries(used).filter(([maLo, sumUsed]) => sumUsed < (byMaLo[maLo]?.F ?? sumUsed) - EPStest());
      return { ok: partial.length === 0, partial };
    };
    const clausiiCheck = checkFullyUsed(clausiiLots, "clausii");
    check("mọi lô clausii đã chạm tới dùng hết 100% (nguyên tắc 4, không ngoại lệ)", clausiiCheck.ok, JSON.stringify(clausiiCheck.partial));
  }
}

console.log("\n=== 8. validateProposedTwoComponentPlan - đối chiếu đề xuất ghép lô từ nguồn ngoài (vd AI) ===");
{
  const gSubtilis = 4.0e8;
  const gClausii = 2.4e8;
  const H = 5.3;
  const N = 300_000;
  const subtilisLots = [
    { maLo: "SUB1", E: 3.3e10, F: 10.0 },
    { maLo: "SUB2", E: 3.3e10, F: 10.0 },
  ];
  // E của CLA1/CLA2 CỐ Ý chọn để tỉ lệ F·E khớp đúng tỉ lệ gSubtilis/gClausii (1650L cả 2 phía khi
  // gộp SUB1+SUB2+CLA1+CLA2) — để "đề xuất hợp lệ" bên dưới đạt mật độ CẢ 2 chủng sát đích, không bị
  // chặn bởi trần DENSITY_TOL_HIGH mới thêm (dư mật độ >5% giờ tính là vi phạm, xem test riêng).
  const clausiiLots = [
    { maLo: "CLA1", E: 2.2e10, F: 9.0 },
    { maLo: "CLA2", E: 2.2e10, F: 9.0 },
  ];
  const context = { subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii } };

  {
    const proposal = { batches: [
      { subtilis: [{ maLo: "SUB1", F: 10.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] },
      { subtilis: [{ maLo: "SUB2", F: 10.0 }], clausii: [{ maLo: "CLA2", F: 9.0 }] },
    ] };
    const { valid, violations, result } = validateProposedTwoComponentPlan(proposal, context);
    check("đề xuất hợp lệ -> valid = true", valid === true, JSON.stringify(violations));
    check("đề xuất hợp lệ -> có result với batches", result && result.batches.length === 2);
    if (result) check("đề xuất hợp lệ -> dSubtilis >= gSubtilis", result.dSubtilis >= gSubtilis - EPStest());
  }
  {
    // SUB1 (F10,E3.3e10) ghép với 1 lô clausii mật độ THẤP hơn nhiều (E nhỏ) -> vCapA giới hạn,
    // dClausii thực tế bị đẩy dư rất nhiều so với đích -> phải vượt trần DENSITY_TOL_HIGH.
    const skewedContext = { subtilisLots, clausiiLots: [{ maLo: "CLA-SKEW", E: 2.9e10, F: 9.0 }], product: { N, H, gSubtilis, gClausii } };
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 10.0 }], clausii: [{ maLo: "CLA-SKEW", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, skewedContext);
    check("mẻ dư mật độ clausii quá nhiều (lệch tỉ lệ 2 chủng) -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"dư quá nhiều so với đích\"", violations.some((v) => v.includes("dư quá nhiều so với đích")), JSON.stringify(violations));
  }
  {
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB-GHOST", F: 10.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, context);
    check("dùng lô không có trong kho -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"không có trong kho\"", violations.some((v) => v.includes("không có trong kho")), JSON.stringify(violations));
  }
  {
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 5.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, context);
    check("dùng dở dang 1 lô (5/10L) -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"dùng hết 100%\"", violations.some((v) => v.includes("dùng hết 100%")), JSON.stringify(violations));
  }
  {
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 15.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, context);
    check("dùng vượt quá F thực có (15/10L) -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"vượt quá lượng thực có\"", violations.some((v) => v.includes("vượt quá lượng thực có")), JSON.stringify(violations));
  }
  {
    // NCV đã bỏ hẳn ngoại lệ "4 chai/mẻ hiếm" (2026-07-30) — trần giờ LUÔN cứng ở 3, kể cả 4 chai
    // cũng phải bị bác.
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 10.0 }, { maLo: "SUB2", F: 10.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }, { maLo: "CLA2", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, context);
    check("1 mẻ dùng 4 lô -> valid = false (không còn ngoại lệ hiếm)", valid === false);
    check("  -> báo đúng lỗi \"vượt giới hạn\"", violations.some((v) => v.includes("vượt giới hạn")), JSON.stringify(violations));
  }
  {
    // 5 lô càng phải bác rõ ràng hơn.
    const bigLotsContext = {
      subtilisLots: [...subtilisLots, { maLo: "SUB3", E: 3.3e10, F: 10.0 }],
      clausiiLots,
      product: { N, H, gSubtilis, gClausii },
    };
    const proposal = { batches: [{
      subtilis: [{ maLo: "SUB1", F: 10.0 }, { maLo: "SUB2", F: 10.0 }, { maLo: "SUB3", F: 10.0 }],
      clausii: [{ maLo: "CLA1", F: 9.0 }, { maLo: "CLA2", F: 9.0 }],
    }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, bigLotsContext);
    check("1 mẻ dùng 5 lô > giới hạn 3 lô -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"vượt giới hạn\"", violations.some((v) => v.includes("vượt giới hạn")), JSON.stringify(violations));
  }
  {
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 10.0 }, { maLo: "SUB2", F: 10.0 }], clausii: [] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, context);
    check("1 mẻ thiếu hẳn luồng clausii -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"bắt buộc mỗi mẻ phải có cả 2\"", violations.some((v) => v.includes("bắt buộc mỗi mẻ phải có cả 2")), JSON.stringify(violations));
  }
  {
    const tinyContext = { ...context, product: { N: 100_000_000, H, gSubtilis, gClausii } }; // N cực lớn -> tổng V đề xuất chắc chắn dưới 90%
    const proposal = { batches: [
      { subtilis: [{ maLo: "SUB1", F: 10.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] },
      { subtilis: [{ maLo: "SUB2", F: 10.0 }], clausii: [{ maLo: "CLA2", F: 9.0 }] },
    ] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, tinyContext);
    check("tổng V đề xuất chưa đạt 90% N -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"chưa đạt tối thiểu 90%\"", violations.some((v) => v.includes("chưa đạt tối thiểu 90%")), JSON.stringify(violations));
  }
  {
    const tightTankContext = { ...context, tankMaxL: 500 }; // trần tank giả lập thấp hơn V mẻ hợp lệ (825L) để test vi phạm trần tank
    const proposal = { batches: [{ subtilis: [{ maLo: "SUB1", F: 10.0 }], clausii: [{ maLo: "CLA1", F: 9.0 }] }] };
    const { valid, violations } = validateProposedTwoComponentPlan(proposal, tightTankContext);
    check("mẻ vượt trần tank -> valid = false", valid === false);
    check("  -> báo đúng lỗi \"vượt trần tank\"", violations.some((v) => v.includes("vượt trần tank")), JSON.stringify(violations));
  }
}

console.log("\n=== 9. packSingleStreamBatches - tránh để lại mẩu NL vụn (< MIN_LOT_FRAGMENT_L) khi tách lô ===");
{
  // Lô "B" chỉ còn vừa đủ chỗ trống rất nhỏ (< MIN_LOT_FRAGMENT_L) ở mẻ 1 sau khi lô "A" đã gần
  // lấp đầy mốc mềm — trước khi có MIN_LOT_FRAGMENT_L, code sẽ tách 0.5L đầu của B vào mẻ 1 rồi
  // dồn 9.8L còn lại sang mẻ 2 (mẩu vụn khó đong). Giờ phải NHƯỜNG hẳn lô B sang mẻ 2 nguyên vẹn.
  const d = 1e8, H = 1;
  const lots = [
    { maLo: "A", E: 1e9, F: 60, loSanXuat: "LOSX1" },
    { maLo: "B", E: 1e9, F: 10.3, loSanXuat: "LOSX1" },
    { maLo: "C", E: 1e9, F: 50, loSanXuat: "LOSX1" },
  ];
  const batches = packSingleStreamBatches(lots, d, H);
  const allEntries = batches.flatMap((b) => b.lots);
  const noFragments = allEntries.every((l) => l.theTichRaw >= MIN_LOT_FRAGMENT_L - EPStest());
  check("không lô nào bị tách để lại mẩu < MIN_LOT_FRAGMENT_L", noFragments, JSON.stringify(allEntries.map((l) => `${l.maLo}=${l.theTichRaw}`)));
  const lotBSplitCount = allEntries.filter((l) => l.maLo === "B").length;
  check("lô B không bị tách đôi (chỉ xuất hiện nguyên vẹn ở đúng 1 mẻ)", lotBSplitCount === 1, `B xuất hiện ${lotBSplitCount} lần`);
}

console.log("\n=== 10. planTwoComponent - tránh mẩu NL vụn khi tách lô (SP 2 thành phần, dữ liệu thật) ===");
{
  // Tái hiện ca thực tế NCV báo: lô subtilis 010426SF1.C4 bị tách 9.5L/0.5L giữa 2 mẻ liền nhau —
  // nguyên nhân gốc là EPS=1e-6 (thiết kế cho so sánh thể tích) bị dùng nhầm để so sánh CFU (quy mô
  // 10^13-10^17), khiến nhiễu số học bị hiểu nhầm là "còn nguyên 1 lô dở dang" (đã sửa bằng cfuEps
  // tương đối). Giờ mỗi lô subtilis phải được dùng TRỌN VẸN trong đúng 1 mẻ, không còn mẩu vụn.
  // N chọn đủ lớn để đóng tự nhiên (không cần "dọn nốt" xa) KHÔNG chạm trần MAX_CLOSING_OVERSHOOT —
  // xem test 11 riêng cho đúng ca N nhỏ hơn, khi trần và né-mẩu-vụn xung đột (trần thắng).
  // Lô 010526SF1.C1 cố ý để F=20L (thay vì 10L) — đủ để TOÀN BỘ kho subtilis (3.728,25L) vượt hẳn
  // tổng kho clausii (3.198,75L nếu dùng hết cả 3 lô), tránh đụng nhánh "thiếu subtilis" MỚI (nguyên
  // tắc 4: clausii không bao giờ được để dở dang — xem test 14/15 riêng cho đúng ca đó).
  const subtilisLots = [
    { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, loSanXuat: "010426SF1" },
    { maLo: "010526SF1.C1", E: 2.65e10, F: 20.0, loSanXuat: "010526SF1" },
  ];
  const clausiiLots = [
    { maLo: "26G01SA1.C3", E: 2.91e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G01SA1.C4", E: 3.02e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G02SA1.C1", E: 2.60e10, F: 9.0, loSanXuat: "26G02SA1" },
  ];
  const product = { N: 600_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const lotPortions = {};
    plan.batches.forEach((b) => {
      [...b.subtilis, ...b.clausii].forEach((e) => { (lotPortions[e.maLo] ||= []).push(e.theTichRaw); });
    });
    const fragments = Object.entries(lotPortions).filter(([, portions]) => portions.length > 1 && Math.min(...portions) < MIN_LOT_FRAGMENT_L - EPStest());
    check("không lô nào bị tách để lại mẩu < MIN_LOT_FRAGMENT_L", fragments.length === 0, JSON.stringify(lotPortions));
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
  }
}

console.log("\n=== 11. planTwoComponent - trần overshoot LUÔN thắng khi xung đột với né-mẩu-vụn ===");
{
  // Cùng bộ dữ liệu như test 10 (F gốc, KHÔNG bump subtilis) nhưng N NHỎ hơn nhiều — khiến điểm
  // đóng tự nhiên CHỈ RIÊNG clausii (đóng nốt đúng lô clausii đang dở, xem computeFinalTargetV mới)
  // đã vượt xa 20% mục tiêu, TRONG KHI kho subtilis vẫn còn dư dả (không phải nguyên nhân) — cô lập
  // đúng nhánh trần overshoot, tách biệt khỏi nhánh "thiếu subtilis" mới (xem test 14/15). NCV chốt
  // rõ 2026-07-29: trần sản lượng (+20%) là ưu tiên CAO HƠN việc né tuyệt đối mọi mẩu vụn — nếu 2
  // điều đó xung đột, chấp nhận còn 1 mẩu <1L còn hơn phá vỡ trần (dồn mật độ CẢ 2 luồng, không đổi).
  const subtilisLots = [
    { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, loSanXuat: "010426SF1" },
    { maLo: "010526SF1.C1", E: 2.65e10, F: 10.0, loSanXuat: "010526SF1" },
  ];
  const clausiiLots = [
    { maLo: "26G01SA1.C3", E: 2.91e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G01SA1.C4", E: 3.02e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G02SA1.C1", E: 2.60e10, F: 9.0, loSanXuat: "26G02SA1" },
  ];
  const product = { N: 132_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check(`T (${fmt(plan.T)}) không vượt quá ~20% N (${fmt(product.N)})`, plan.T <= product.N * MAX_CLOSING_OVERSHOOT * 1.01);
    // CLAUSII đã chạm tới vẫn phải dùng hết 100% (trần chỉ chặn THỂ TÍCH/nước, không cho phép bỏ dở
    // clausii) — bắt buộc, không đổi. SUBTILIS thì KHÔNG còn bắt buộc nữa (nguyên tắc 4, 2026-07-29):
    // trước đây bản cũ "dồn nốt không thêm nước" ép luôn CẢ subtilis cho hết chai đang dở — nay CHỈ
    // dồn clausii, subtilis được PHÉP dở dang (chính là bug thật NCV báo khi test trên UI: mẻ cuối dư
    // mật độ subtilis rất nặng dù không cần thiết, vì bị ép vét sạch 1 chai không liên quan tới trần).
    const checkFullyUsed = (lots, streamKey) => {
      const byMaLo = Object.fromEntries(lots.map((l) => [l.maLo, l]));
      const used = {};
      plan.batches.forEach((b) => b[streamKey].forEach((e) => { used[e.maLo] = (used[e.maLo] || 0) + e.theTichRaw; }));
      return Object.entries(used).every(([maLo, sumUsed]) => sumUsed >= (byMaLo[maLo]?.F ?? sumUsed) - EPStest());
    };
    check("mọi lô clausii đã chạm tới vẫn dùng hết 100%", checkFullyUsed(clausiiLots, "clausii"));
    // Mật độ subtilis TRUNG BÌNH cả nhịp không được dư quá đà chỉ vì trần overshoot chặn clausii —
    // nếu subtilis vẫn còn bị "vét sạch" không cần thiết, mật độ sẽ vọt cao bất thường (bug vừa sửa
    // ra đúng d~5.95e8, +49% so với đích 4e8, trước khi sửa) — sau sửa phải sát đích hơn hẳn.
    check("mật độ subtilis KHÔNG dư quá đà (< +10%) dù bị trần overshoot chặn clausii", plan.dSubtilis <= 4.0e8 * 1.1, `dSubtilis=${plan.dSubtilis.toExponential(3)}`);
    console.log(`  -> N=${fmt(product.N)}, T=${fmt(plan.T)} (${(plan.T / product.N).toFixed(2)}x N), ${plan.batches.length} mẻ`);
  }
}

console.log("\n=== 12. planTwoComponent - ghép cân đối (findBestMatchedLots) khi kích cỡ chai 2 chủng lệch nhau ===");
{
  // Chai subtilis to (10L, V=1000L/chai) trong khi chai clausii nhỏ hơn (5L, V=500L/chai, cần đúng
  // 2 chai clausii mới khớp 1 chai subtilis) — mô phỏng đúng ca NCV phàn nàn 2026-07-29: "mẻ thì
  // thừa quá nhiều clausii, mẻ lại thừa quá nhiều subtilis... thuật toán cần tìm chai NL phù hợp
  // hơn". Trước khi có findBestMatchedLots (ghép theo ranh giới lô sản xuất thuần FIFO), kiểu kho
  // này dễ ra nhiều mẻ nhỏ lắt nhắt và lệch mật độ. Giờ PHẢI ra đúng 4 mẻ tròn 1000L, mật độ CẢ HAI
  // chủng CHÍNH XÁC bằng đích (không dư/thiếu) ở mọi mẻ.
  const mkSub = (i, F) => ({ maLo: `SA${i}`, E: 1e10, F, loSanXuat: `LSX-A${i}` });
  const mkCla = (i, F) => ({ maLo: `CB${i}`, E: 1e10, F, loSanXuat: `LSX-B${i}` });
  const subtilisLots = [mkSub(1, 10), mkSub(2, 10), mkSub(3, 10), mkSub(4, 10)];
  const clausiiLots = [mkCla(1, 5), mkCla(2, 5), mkCla(3, 5), mkCla(4, 5), mkCla(5, 5), mkCla(6, 5), mkCla(7, 5), mkCla(8, 5)];
  const product = { N: 750_000, H: 5.333333333333333, gSubtilis: 1e8, gClausii: 1e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("đúng 4 mẻ (không bị vụn ra nhiều mẻ nhỏ)", plan.batches.length === 4, `thực tế ${plan.batches.length} mẻ`);
    let maxExcess = 1;
    plan.batches.forEach((b) => {
      const cfuA = b.subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
      const cfuB = b.clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) * 1000;
      const dA = cfuA / (b.tongTheTich * 1000);
      const dB = cfuB / (b.tongTheTich * 1000);
      maxExcess = Math.max(maxExcess, dA / product.gSubtilis, dB / product.gClausii);
    });
    check(`mật độ mọi mẻ khớp đích, không lệch quá 0.1% (maxExcess=${maxExcess.toFixed(5)}x)`, maxExcess <= 1.001);
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
  }
}

console.log("\n=== 13. planTwoComponent - làm tròn 1 mẻ KHÔNG được 'ăn' mất phần NL mà mẻ SAU đang cần (né mẻ mồ côi thiếu 1 luồng) ===");
{
  // Bug thật đã gặp 2026-07-29 khi thêm findBestMatchedLots: 1 mẻ bị chặn đúng trần tank giữa
  // chừng 1 lô clausii (8.64L raw) -> làm tròn lên 0.5L gần nhất TÌNH CỜ ăn hết đúng phần lô còn
  // lại (0.36L) mà mẻ SAU cần -> mẻ sau bị làm tròn về 0 cho clausii -> pruneZeroEntries xoá mất,
  // để lại 1 mẻ "mồ côi" chỉ còn subtilis, không còn clausii -> SP 2 thành phần sai công thức hoàn
  // toàn (không phải chỉ dư mật độ). Tái hiện bằng đúng bộ kho lệch tỉ lệ nặng (chai to/chai nhỏ)
  // ép batch cuối chạm trần tank 1080L giữa chừng đúng 1 lô clausii.
  const subtilisLots = [
    { maLo: "SA1", E: 3.3e10, F: 9.0, loSanXuat: "LSX-A1" },
    { maLo: "SA2", E: 2.7e10, F: 10.0, loSanXuat: "LSX-A2" },
    { maLo: "SA3", E: 3.5e10, F: 8.0, loSanXuat: "LSX-A3" },
    { maLo: "SA4", E: 2.9e10, F: 10.0, loSanXuat: "LSX-A4" },
    { maLo: "SA5", E: 3.2e10, F: 9.0, loSanXuat: "LSX-A5" },
    { maLo: "SA6", E: 2.6e10, F: 8.0, loSanXuat: "LSX-A6" },
  ];
  const clausiiLots = [
    { maLo: "CB1", E: 2.6e10, F: 8.0, loSanXuat: "LSX-B1" },
    { maLo: "CB2", E: 3.1e10, F: 9.0, loSanXuat: "LSX-B2" },
    { maLo: "CB3", E: 2.4e10, F: 7.0, loSanXuat: "LSX-B3" },
    { maLo: "CB4", E: 3.0e10, F: 9.0, loSanXuat: "LSX-B4" },
    { maLo: "CB5", E: 2.7e10, F: 8.0, loSanXuat: "LSX-B5" },
  ];
  const product = { N: 600_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const orphanBatches = plan.batches.filter((b) => b.subtilis.length === 0 || b.clausii.length === 0);
    check("không có mẻ nào mồ côi (thiếu hẳn 1 luồng)", orphanBatches.length === 0, JSON.stringify(orphanBatches.map((b) => b.meSo)));
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
  }
}

console.log("\n=== 14. planTwoComponent - kho subtilis KHÔNG đủ để đóng nốt lô clausii -> infeasible, KHÔNG dồn mật độ để né (nguyên tắc 4) ===");
{
  // Kho gốc chưa bump (giống hệt test 11): subtilisTotalCap ~3.065,75L < tổng 3 lô clausii nếu dùng
  // hết cả 3 (~3.198,75L). Chọn N để vTarget rơi đúng vào GIỮA lô clausii thứ 3 (26G02SA1.C1) — lô
  // này sẽ bị "kẹt": không đủ subtilis để đóng nốt trọn vẹn. Chốt NCV (không phải "dồn mật độ" như
  // trần overshoot): LÙI hẳn về ranh giới lô clausii SẠCH gần nhất (2 lô đầu, ~2.223,75L) — ở N này
  // mức đó rơi DƯỚI sàn 90% -> phải báo infeasible, không được tự ý dồn mật độ để cố đạt N.
  const subtilisLots = [
    { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, loSanXuat: "010426SF1" },
    { maLo: "010526SF1.C1", E: 2.65e10, F: 10.0, loSanXuat: "010526SF1" },
  ];
  const clausiiLots = [
    { maLo: "26G01SA1.C3", E: 2.91e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G01SA1.C4", E: 3.02e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G02SA1.C1", E: 2.60e10, F: 9.0, loSanXuat: "26G02SA1" },
  ];
  const product = { N: 490_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = false (kho subtilis không đủ để đóng nốt lô clausii cần tới)", plan.feasible === false, JSON.stringify(plan));
  if (plan.feasible === false) {
    check("báo đúng lô clausii bị kẹt (26G02SA1.C1)", plan.subtilisShortfallLot === "26G02SA1.C1", plan.subtilisShortfallLot);
    check("lý do nêu rõ từ khoá 'thiếu subtilis'/'dở dang'", /subtilis|dở dang/i.test(plan.reason || ""), plan.reason);
  }
}

console.log("\n=== 15. planTwoComponent - thiếu subtilis: vẫn feasible nhưng T thấp hơn N, clausii vẫn KHÔNG bị dở dang (nguyên tắc 4) ===");
{
  // Cùng bộ kho như test 14 nhưng N nhỏ hơn 1 chút — mức "lùi về ranh giới sạch" (~2.223,75L, dùng
  // đúng 2/3 lô clausii) giờ vẫn NẰM TRÊN sàn 90% -> feasible, nhưng T thấp hơn hẳn N (không cố đạt
  // đủ N bằng cách mở dở lô clausii thứ 3) — đúng chốt NCV: dừng sớm hơn, báo rõ, không tự quyết.
  const subtilisLots = [
    { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, loSanXuat: "010426SF1" },
    { maLo: "010526SF1.C1", E: 2.65e10, F: 10.0, loSanXuat: "010526SF1" },
  ];
  const clausiiLots = [
    { maLo: "26G01SA1.C3", E: 2.91e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G01SA1.C4", E: 3.02e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G02SA1.C1", E: 2.60e10, F: 9.0, loSanXuat: "26G02SA1" },
  ];
  const product = { N: 452_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("T thấp hơn hẳn N (dừng sớm, không cố ép đạt đủ)", plan.T < product.N, `T=${plan.T}, N=${product.N}`);
    check("báo đúng lô clausii bị kẹt (26G02SA1.C1)", plan.subtilisShortfallLot === "26G02SA1.C1", plan.subtilisShortfallLot);
    check("lô clausii bị kẹt KHÔNG xuất hiện trong danh sách đã dùng (0% dùng, không dở dang)",
      !plan.selectedClausiiLots.includes("26G02SA1.C1"), JSON.stringify(plan.selectedClausiiLots));
    // Mọi lô clausii ĐÃ dùng phải dùng ĐÚNG HẾT 100% (không có lô nào dùng 1 phần) — cốt lõi nguyên tắc 4.
    const clausiiByMaLo = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l]));
    const usedClauF = {};
    plan.batches.forEach((b) => b.clausii.forEach((e) => { usedClauF[e.maLo] = (usedClauF[e.maLo] || 0) + e.theTichRaw; }));
    const clausiiFullyUsed = Object.entries(usedClauF).every(([maLo, f]) => Math.abs(f - clausiiByMaLo[maLo].F) < EPStest());
    check("mọi lô clausii đã chạm tới đều dùng ĐÚNG HẾT 100% (không dở dang)", clausiiFullyUsed, JSON.stringify(usedClauF));
  }
}

console.log("\n=== 16. planTwoComponent - roundRawTwoStream KHÔNG được bỏ ngỏ cả 2 phần khi tách lô làm tròn khít nhau (dữ liệu thật NCV báo, 2026-07-29) ===");
{
  // Bug thật: reserveForRest cũ dùng ĐÚNG lượng RAW chưa làm tròn của phần sau làm ngưỡng trần cho
  // phần trước -> ceiling khít đúng bằng raw hiện tại, không còn dư 1 bước 0.5L nào để làm tròn LÊN
  // -> CẢ 2 phần bị bỏ ngỏ (vd 6.91L/2.09L thay vì 7.0L/2.0L) dù tổng vẫn đúng — vi phạm "NL đong bội
  // số 0.5L". Đã sửa: reserveForRest = 0.5L × (số phần còn lại), không phải tổng raw của chúng.
  const subtilisLots = [
    { maLo: "010426SF1.C4", E: 3.35e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C5", E: 3.33e10, F: 10.0, loSanXuat: "010426SF1" },
    { maLo: "010426SF1.C7", E: 3.27e10, F: 9.0, loSanXuat: "010426SF1" },
    { maLo: "010526SF1.C1", E: 2.65e10, F: 10.0, loSanXuat: "010526SF1" },
    { maLo: "010526SF1.C2", E: 2.71e10, F: 10.0, loSanXuat: "010526SF1" },
  ];
  const clausiiLots = [
    { maLo: "26G01SA1.C3", E: 2.91e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G01SA1.C4", E: 3.02e10, F: 9.0, loSanXuat: "26G01SA1" },
    { maLo: "26G02SA1.C1", E: 2.60e10, F: 9.0, loSanXuat: "26G02SA1" },
  ];
  const product = { N: 623_977, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const notRounded = [];
    plan.batches.forEach((b) => {
      [...b.subtilis, ...b.clausii].forEach((e) => {
        const steps = e.theTichRaw / 0.5;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) notRounded.push(`mẻ${b.meSo}/${e.maLo}=${e.theTichRaw}`);
      });
    });
    check("mọi lần đong NL đều là bội số của 0.5L (không bỏ ngỏ số lẻ)", notRounded.length === 0, JSON.stringify(notRounded));
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
  }
}

function EPStest() {
  return 1e-3; // dung sai số học khi so sánh dấu chấm động trong test
}

console.log(`\n=== KẾT QUẢ: ${passCount} PASS / ${failCount} FAIL ===`);
if (failCount > 0) process.exit(1);
