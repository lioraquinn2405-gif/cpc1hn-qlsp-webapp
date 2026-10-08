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

console.log("\n=== 7. planTwoComponent - kho 2 chủng lệch tỉ lệ nặng (kỳ vọng KHÔNG dư NL, KHÔNG dư mật độ) ===");
{
  // Nhiều lô sản xuất nhỏ xen kẽ, kích cỡ chai/mật độ 2 chủng KHÔNG khớp nhau. Chốt lại với NCV
  // 2026-10-08 (thay chốt 2026-07-29 cũ): KHÔNG còn chấp nhận "dồn mật độ" khi vướng trần nữa — trần
  // sản lượng hạ xuống +10% và khi 1 lô clausii không đóng nốt được trong
  // trần đó, thuật toán LÙI lại (không mở lô đó) thay vì ép dùng rồi chấp nhận mật độ sai lệch nặng.
  const gSubtilis = 4.0e8;
  const gClausii = 2.4e8;
  const H = 5.3;
  const N = 420_000; // hạ từ 500.000 (bản cũ) — ở N đó giờ lô cuối không đóng nốt nổi trong trần +10%, LÙI về dưới sàn 90% -> infeasible (đúng hành vi mới, xem test 14/15 cho ca "thiếu subtilis" tương tự).
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
    // Mật độ KHÔNG còn được phép dư nặng nữa (khác bản cũ) — phải sát đích ở mọi mẻ, không riêng gì
    // trung bình cả nhịp (vd đã từng thấy 1 mẻ dư >400% dù trung bình nhịp vẫn bình thường).
    check("dSubtilis sát đích, không dư quá 10%", plan.dSubtilis <= gSubtilis * 1.1 + EPStest(), plan.dSubtilis.toExponential(3));
    check("dClausii sát đích, không dư quá 10%", plan.dClausii <= gClausii * 1.1 + EPStest(), plan.dClausii.toExponential(3));
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
  // N chọn đủ lớn để đóng tự nhiên (không cần "dọn nốt" xa) KHÔNG chạm trần sản lượng —
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

console.log("\n=== 11. planTwoComponent - lô clausii không đóng nốt nổi trong trần +10% -> LÙI lại, KHÔNG dồn mật độ ===");
{
  // Cùng bộ dữ liệu như test 10 (F gốc, KHÔNG bump subtilis) nhưng N nhỏ hơn nhiều — khiến điểm đóng
  // tự nhiên CHỈ RIÊNG clausii (đóng nốt đúng lô clausii đang dở, xem computeFinalTargetV) vượt xa
  // trần +10% mục tiêu, TRONG KHI kho subtilis vẫn còn dư dả (không phải nguyên nhân). Chốt lại với
  // NCV 2026-10-08 (thay chốt 2026-07-29 cũ "dồn mật độ, trần sản lượng thắng tuyệt đối"): thuật toán
  // giờ LÙI lại, không mở lô clausii không đóng nốt nổi — subtilis được phép dở dang nên luôn đủ "dư
  // địa" khớp đúng mật độ đích ở bất kỳ V nào, không còn lý do kỹ thuật nào phải đánh đổi mật độ lấy
  // sản lượng nữa (bug thật NCV báo: mẻ cuối dư mật độ gấp nhiều lần đích vì bị ép dùng hết 1 lô quá
  // to so với đơn).
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
  const product = { N: 190_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    // CLAUSII đã chạm tới vẫn phải dùng hết 100% (nguyên tắc 4, không đổi) — nhưng lô nào KHÔNG đóng
    // nốt nổi trong trần thì giờ đơn giản là KHÔNG bị chạm tới nữa (thay vì chạm rồi dồn mật độ).
    const checkFullyUsedOrUntouched = (lots, streamKey) => {
      const byMaLo = Object.fromEntries(lots.map((l) => [l.maLo, l]));
      const used = {};
      plan.batches.forEach((b) => b[streamKey].forEach((e) => { used[e.maLo] = (used[e.maLo] || 0) + e.theTichRaw; }));
      return Object.entries(used).every(([maLo, sumUsed]) => sumUsed >= (byMaLo[maLo]?.F ?? sumUsed) - EPStest());
    };
    check("mọi lô clausii đã chạm tới vẫn dùng hết 100%", checkFullyUsedOrUntouched(clausiiLots, "clausii"));
    // Mật độ CẢ HAI luồng giờ luôn sát đích (không còn "dồn CFU không thêm nước" nữa) — khác hẳn bản
    // cũ chỉ assert riêng subtilis (vì bản cũ CHỦ Ý để clausii dư mật độ, đúng cơ chế vừa bỏ).
    check("mật độ subtilis sát đích (không dư quá 10%)", plan.dSubtilis <= 4.0e8 * 1.1 + EPStest(), `dSubtilis=${plan.dSubtilis.toExponential(3)}`);
    check("mật độ clausii sát đích (không dư quá 10%)", plan.dClausii <= 2.4e8 * 1.1 + EPStest(), `dClausii=${plan.dClausii.toExponential(3)}`);
    console.log(`  -> N=${fmt(product.N)}, T=${fmt(plan.T)} (${(plan.T / product.N).toFixed(2)}x N), ${plan.batches.length} mẻ`);
  }
}

console.log("\n=== 12. planTwoComponent - ghép cân đối khi kích cỡ chai 2 chủng lệch nhau ===");
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
  const product = { N: 500_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 }; // hạ từ 600.000 (bản cũ) — ở N đó trần +10% mới (thay +20% cũ) khiến lô cuối không đóng nốt nổi, thuật toán LÙI lại và tụt dưới sàn 90% (đúng hành vi mới, xem test 11/14).
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const orphanBatches = plan.batches.filter((b) => b.subtilis.length === 0 || b.clausii.length === 0);
    check("không có mẻ nào mồ côi (thiếu hẳn 1 luồng)", orphanBatches.length === 0, JSON.stringify(orphanBatches.map((b) => b.meSo)));
    check("đối soát bào tử subtilis pass (<1%)", plan.massBalanceSubtilis.pass, `diff=${plan.massBalanceSubtilis.diffPct.toFixed(4)}%`);
    check("đối soát bào tử clausii pass (<1%)", plan.massBalanceClausii.pass, `diff=${plan.massBalanceClausii.diffPct.toFixed(4)}%`);
  }
}

console.log("\n=== 14. planTwoComponent - kho subtilis KHÔNG đủ để dùng thêm chai clausii gần N hơn -> vẫn ra kế hoạch gần nhất có thể, báo đúng chai bị kẹt ===");
{
  // Chốt NCV 2026-10-08: chốt cứng các chai clausii NGUYÊN VẸN cho sản lượng gần N nhất. Kho subtilis
  // (~3.068L) không đủ để dùng thêm chai 26G02SA1.C1 (lẽ ra đưa sản lượng sát N hơn) -> dừng ở 2 chai
  // đầu, KHÔNG mở dở chai thứ 3, KHÔNG dồn mật độ — vẫn trả kế hoạch (T thấp hơn hẳn N) kèm
  // subtilisShortfallLot để UI cảnh báo NCV bổ sung subtilis.
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
  const product = { N: 600_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true (vẫn ra kế hoạch gần nhất có thể)", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("báo đúng lô clausii bị kẹt (26G02SA1.C1)", plan.subtilisShortfallLot === "26G02SA1.C1", plan.subtilisShortfallLot);
    check("T thấp hơn hẳn N (không cố ép đạt đủ)", plan.T < 0.9 * product.N, `T=${plan.T}`);
    check("chai bị kẹt KHÔNG bị đụng tới (0% dùng, không dở dang)", !plan.selectedClausiiLots.includes("26G02SA1.C1"), JSON.stringify(plan.selectedClausiiLots));
    const byMaLo = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l]));
    const used = {};
    plan.batches.forEach((b) => b.clausii.forEach((e) => { used[e.maLo] = (used[e.maLo] || 0) + e.theTichRaw; }));
    check("mọi chai clausii đã dùng đều dùng ĐÚNG HẾT 100%", Object.entries(used).every(([m, f]) => Math.abs(f - byMaLo[m].F) < EPStest()), JSON.stringify(used));
  }
}

console.log("\n=== 15. planTwoComponent - chai clausii bị kho subtilis chặn nhưng đằng nào cũng xa N hơn -> KHÔNG báo nhầm thiếu subtilis ===");
{
  // CL1+CL2 = 2.250L sát mục tiêu (~2.438L) hơn hẳn CL1+CL2+CL3 = 3.375L — dù kho subtilis (2.625L)
  // cũng không đủ cho CL3, đó KHÔNG phải lý do dừng (phương án gần N nhất vốn đã là 2 chai), nên không
  // được cảnh báo "thiếu subtilis" gây hiểu nhầm.
  const subtilisLots = [
    { maLo: "SU1", E: 3.0e10, F: 10.0, loSanXuat: "SU1" },
    { maLo: "SU2", E: 3.0e10, F: 10.0, loSanXuat: "SU2" },
    { maLo: "SU3", E: 3.0e10, F: 10.0, loSanXuat: "SU3" },
    { maLo: "SU4", E: 3.0e10, F: 5.0, loSanXuat: "SU4" },
  ];
  const clausiiLots = [
    { maLo: "CL1", E: 3.0e10, F: 9.0, loSanXuat: "CL1" },
    { maLo: "CL2", E: 3.0e10, F: 9.0, loSanXuat: "CL2" },
    { maLo: "CL3", E: 3.0e10, F: 9.0, loSanXuat: "CL3" },
  ];
  const product = { N: 460_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 };
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("không báo nhầm thiếu subtilis", plan.subtilisShortfallLot === null, plan.subtilisShortfallLot);
    check("dùng đúng 2 chai clausii gần N nhất (CL1, CL2)", JSON.stringify(plan.selectedClausiiLots.slice().sort()) === JSON.stringify(["CL1", "CL2"]), JSON.stringify(plan.selectedClausiiLots));
  }
}

console.log("\n=== 16. planTwoComponent - mọi lần đong NL đều tròn 0.5L (dữ liệu thật NCV báo, 2026-07-29) ===");
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

console.log("\n=== 17. planSingleComponent - wholeBottleOnly: mỗi lô đúng 1 mẻ riêng, không ghép ===");
{
  const lots = [
    { maLo: "26G02SA1.C1", E: 3.09e10, F: 10.0, loSanXuat: "26G02SA1" },
    { maLo: "26G02SA1.C2", E: 2.98e10, F: 10.0, loSanXuat: "26G02SA1" },
    { maLo: "26G02SA1.C3", E: 3.05e10, F: 10.0, loSanXuat: "26G02SA1" },
    { maLo: "26G02SA1.C4", E: 3.13e10, F: 10.0, loSanXuat: "26G02SA1" },
  ];
  const G = 4.8e8, H = 5.3, N = 400_000;
  const plan = planSingleComponent({ lots, product: { N, G, H }, wholeBottleOnly: true });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("đúng 4 mẻ (bằng đúng số lô đã chọn, không ghép/tách)", plan.batches.length === lots.length,
      `batches=${plan.batches.length}`);
    check("mỗi mẻ đúng 1 lô", plan.batches.every((b) => b.lots.length === 1),
      JSON.stringify(plan.batches.map((b) => b.lots.length)));
    check("mỗi mẻ dùng TRỌN 100% F của lô (không cắt/làm tròn bớt)",
      plan.batches.every((b) => Math.abs(b.lots[0].theTichRaw - lots.find((l) => l.maLo === b.lots[0].maLo).F) < 1e-9));
    // Đối chiếu với 4 mẻ thật đã xác nhận (2026-08-10): Mẻ 01-644L/02-621L/03-636L/04-653L.
    const expected = { "26G02SA1.C1": 643.75, "26G02SA1.C2": 620.83, "26G02SA1.C3": 635.42, "26G02SA1.C4": 652.08 };
    const mismatches = plan.batches.filter((b) => !approx(b.tongTheTich, expected[b.lots[0].maLo], 0.05));
    check("thể tích mẻ khớp đúng dữ liệu SX thật đã xác nhận (±0.05L)", mismatches.length === 0,
      JSON.stringify(mismatches.map((b) => ({ lo: b.lots[0].maLo, v: b.tongTheTich }))));
    check("không mẻ nào vượt trần tank", plan.batches.every((b) => !b.overTankCap));
    check("đối soát bào tử pass (<1%)", plan.massBalance.pass, `diff=${plan.massBalance.diffPct.toFixed(4)}%`);
  }
}

console.log("\n=== 18. planSingleComponent - wholeBottleOnly=false (mặc định) vẫn ghép mẻ như cũ (không đổi hành vi gốc) ===");
{
  // Dùng lại đúng bộ BO2_LOTS + N của test 3 (đã biết trước sẽ ra mẻ ghép nhiều lô) để chứng minh
  // KHÔNG truyền wholeBottleOnly thì hành vi gốc (có ghép mẻ) vẫn y nguyên, không bị đổi ngầm.
  const sumValueAll = BO2_LOTS.reduce((s, l) => s + l.E * l.F, 0);
  const T_at_G = (sumValueAll * 1000) / (G2 * H2);
  const N = Math.floor(T_at_G / 1.08);
  const plan = planSingleComponent({ lots: BO2_LOTS, product: { N, G: G2, H: H2 } });
  check("không truyền wholeBottleOnly vẫn ra hành vi ghép mẻ như trước (có mẻ >1 lô)",
    plan.feasible && plan.batches.some((b) => b.lots.length > 1),
    JSON.stringify(plan.batches?.map((b) => b.lots.length)));
}

console.log("\n=== 19. planTwoComponent - 3 nguyên tắc NCV chốt 2026-10-08 (1 triệu ống, kho nhiều chai cỡ thật) ===");
{
  // 1. Chốt cứng chai clausii nguyên vẹn (tổ hợp bất kỳ) cho sản lượng GẦN N nhất, không chai nào dở.
  // 2. Subtilis khớp đúng lượng đó — kho này có tổ hợp chai subtilis pha vừa hết nên không dở chai nào.
  // 3. Không mẻ nào dưới 700L khi còn cách tránh được (kho này tránh được), ≤1080L, ≤3 chai/mẻ, mật
  //    độ cả 2 chủng trong [đích, +5%], mọi lần đong tròn 0.5L.
  const mk = (prefix, specs) => specs.map(([F, E], i) => ({ maLo: `${prefix}.C${i + 1}`, E, F, loSanXuat: `${prefix}${Math.floor(i / 4)}` }));
  const subtilisLots = mk("010426SF", [[10, 3.35e10], [10, 3.33e10], [9, 3.27e10], [10, 2.65e10], [10, 3.1e10], [9, 3.2e10], [8, 2.9e10], [10, 3.0e10], [10, 3.2e10], [9, 2.8e10], [10, 3.3e10], [8, 3.1e10]]);
  const clausiiLots = mk("26G01SA", [[9, 2.91e10], [9, 3.02e10], [9, 2.60e10], [8, 2.7e10], [9, 3.1e10], [7, 2.4e10], [9, 3.0e10], [8, 2.7e10], [9, 2.9e10], [9, 2.8e10]]);
  const gSubtilis = 4.0e8, gClausii = 2.4e8, H = 5.3, N = 1_000_000;
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii } });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const used = (key) => { const u = {}; plan.batches.forEach((b) => b[key].forEach((e) => { u[e.maLo] = (u[e.maLo] || 0) + e.theTichRaw; })); return u; };
    const usedC = used("clausii"), usedS = used("subtilis");
    const byC = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l])), byS = Object.fromEntries(subtilisLots.map((l) => [l.maLo, l]));
    check("mọi chai clausii đã dùng đều hết 100%", Object.entries(usedC).every(([m, f]) => Math.abs(f - byC[m].F) < EPStest()), JSON.stringify(usedC));
    // Sản lượng clausii (thể tích pha ở mật độ đích) khớp N ít nhất bằng tiền tố FIFO tốt nhất, lệch ≤ 1%.
    const vTarget = (N * H) / 1000;
    let cum = 0, bestDist = Infinity;
    clausiiLots.forEach((l) => { cum += (l.E * l.F) / gClausii; bestDist = Math.min(bestDist, Math.abs(cum - vTarget)); });
    const vChosen = Object.keys(usedC).reduce((s, m) => s + (byC[m].E * byC[m].F) / gClausii, 0);
    check("tổ hợp clausii khớp N tốt hơn/bằng FIFO, lệch ≤ 1%", Math.abs(vChosen - vTarget) <= bestDist + 1e-6 && Math.abs(vChosen - vTarget) <= 0.01 * vTarget, `vChosen=${vChosen} bestFifo=${bestDist}`);
    const partialS = Object.entries(usedS).filter(([m, f]) => f < byS[m].F - EPStest());
    check("subtilis pha vừa hết — không dở chai nào", partialS.length === 0, JSON.stringify(partialS));
    check("T trong [0.99N, 1.01N]", plan.T >= 0.99 * N && plan.T <= 1.01 * N, `T=${plan.T}`);
    check("không mẻ nào dưới 700L", plan.batches.every((b) => b.tongTheTich >= 700 - EPStest()), JSON.stringify(plan.batches.map((b) => b.tongTheTich)));
    check("mọi mẻ ≤ TANK_MAX_L", plan.batches.every((b) => b.tongTheTich <= TANK_MAX_L + 1e-6));
    check(`mọi mẻ ≤ ${MAX_LOTS_PER_BATCH} chai`, plan.batches.every((b) => b.subtilis.length + b.clausii.length <= MAX_LOTS_PER_BATCH));
    let densOk = true;
    plan.batches.forEach((b) => {
      const dA = b.subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) / b.tongTheTich;
      const dB = b.clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) / b.tongTheTich;
      if (dA < gSubtilis * (1 - 1e-9) || dA > gSubtilis * 1.05 || dB < gClausii * (1 - 1e-9) || dB > gClausii * 1.05) densOk = false;
    });
    check("mật độ cả 2 chủng mọi mẻ trong [đích, +5%]", densOk);
    check("mọi lần đong NL tròn 0.5L", plan.batches.every((b) => [...b.subtilis, ...b.clausii].every((e) => Math.abs(e.theTichRaw / 0.5 - Math.round(e.theTichRaw / 0.5)) < 1e-9)));
    console.log(`  -> T=${fmt(plan.T)} (${(plan.T / N).toFixed(3)}x N), ${plan.batches.length} mẻ: ${plan.batches.map((b) => fmt(b.tongTheTich)).join(" | ")}`);
  }
}

console.log("\n=== 19b. Tròn chai clausii - subtilis KHÔNG có tổ hợp vừa hết -> lấy theo list cũ -> mới, dở 1 chai ===");
{
  // Mỗi chai subtilis pha ~1500L, clausii ~1000L/chai -> V ≈ 2000L không tổ hợp subtilis nào khớp ±3%.
  const subtilisLots = [1, 2, 3].map((i) => ({ maLo: `S${i}`, E: 6e10, F: 10, loSanXuat: "LS" }));
  const clausiiLots = [1, 2, 3].map((i) => ({ maLo: `C${i}`, E: 2.4e10, F: 10, loSanXuat: "LC" }));
  const gSubtilis = 4e8, gClausii = 2.4e8, H = 5;
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N: 400_000, H, gSubtilis, gClausii } });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    const u = {}; plan.batches.forEach((b) => b.subtilis.forEach((e) => { u[e.maLo] = (u[e.maLo] || 0) + e.theTichRaw; }));
    check("subtilis dùng S1 hết, S2 dở (đúng list cũ -> mới), không đụng S3", u.S1 === 10 && u.S2 > 0 && u.S2 < 10 && !u.S3, JSON.stringify(u));
    const uc = {}; plan.batches.forEach((b) => b.clausii.forEach((e) => { uc[e.maLo] = (uc[e.maLo] || 0) + e.theTichRaw; }));
    check("clausii đúng 2 chai, dùng trọn", Object.keys(uc).length === 2 && Object.values(uc).every((f) => f === 10), JSON.stringify(uc));
  }
}

console.log("\n=== 20. planTwoComponent mode \"tronMePha\" - pha đủ lượng, chấp nhận dư 1 chai clausii ===");
{
  const mk = (prefix, specs) => specs.map(([F, E], i) => ({ maLo: `${prefix}.C${i + 1}`, E, F, loSanXuat: `${prefix}${Math.floor(i / 4)}` }));
  const subtilisLots = mk("010426SF", [[10, 3.35e10], [10, 3.33e10], [9, 3.27e10], [10, 2.65e10], [10, 3.1e10], [9, 3.2e10], [8, 2.9e10], [10, 3.0e10]]);
  const clausiiLots = mk("26G01SA", [[9, 2.91e10], [9, 3.02e10], [9, 2.60e10], [8, 2.7e10], [9, 3.1e10]]);
  const gSubtilis = 4.0e8, gClausii = 2.4e8, H = 5.3;
  for (const N of [150_000, 300_000, 600_000]) {
    const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N, H, gSubtilis, gClausii }, mode: "tronMePha" });
    check(`N=${fmt(N)}: feasible`, plan.feasible === true, plan.reason || "");
    if (!plan.feasible) continue;
    check(`N=${fmt(N)}: T sát N (±3%)`, Math.abs(plan.T / N - 1) <= 0.03, `T=${plan.T}`);
    const used = (key, lots) => { const u = {}; plan.batches.forEach((b) => b[key].forEach((e) => { u[e.maLo] = (u[e.maLo] || 0) + e.theTichRaw; })); const by = Object.fromEntries(lots.map((l) => [l.maLo, l])); return Object.entries(u).filter(([m, f]) => f < by[m].F - EPStest()); };
    check(`N=${fmt(N)}: tối đa 1 chai clausii dở`, used("clausii", clausiiLots).length <= 1);
    check(`N=${fmt(N)}: tối đa 1 chai subtilis dở`, used("subtilis", subtilisLots).length <= 1);
    check(`N=${fmt(N)}: mọi lần đong tròn 0.5L`, plan.batches.every((b) => [...b.subtilis, ...b.clausii].every((e) => Math.abs(e.theTichRaw / 0.5 - Math.round(e.theTichRaw / 0.5)) < 1e-9)));
    check(`N=${fmt(N)}: không đong mẩu < 1L từ chai mới ở cuối`, !plan.batches[plan.batches.length - 1].clausii.some((e) => e.theTichRaw < 1 - EPStest() && plan.batches.filter((b) => b.clausii.some((x) => x.maLo === e.maLo)).length === 1));
    let densOk = true;
    plan.batches.forEach((b) => {
      const dA = b.subtilis.reduce((s, e) => s + e.E * e.theTichRaw, 0) / b.tongTheTich;
      const dB = b.clausii.reduce((s, e) => s + e.E * e.theTichRaw, 0) / b.tongTheTich;
      if (dA < gSubtilis * (1 - 1e-9) || dA > gSubtilis * 1.05 || dB < gClausii * (1 - 1e-9) || dB > gClausii * 1.05) densOk = false;
    });
    check(`N=${fmt(N)}: mật độ mọi mẻ trong [đích, +5%]`, densOk);
  }
}

console.log("\n=== 21. planTwoComponent \"tronMePha\" - nhặt tổ hợp chai clausii bất kỳ (không theo FIFO) khớp nhất, không dư clausii ===");
{
  // Cần ~1.590L: theo FIFO phải lấy CL1 (1.091L) + dở CL2 (dư ~4,9L NL); nhặt CL1 + CL3 (700L) thì
  // vừa đủ ~1.791L... còn tốt hơn: CL3 + CL4 = 700 + 900 = 1.600L — gần như khớp, không dư chai nào.
  const subtilisLots = [
    { maLo: "SU1", E: 3.35e10, F: 10.0, loSanXuat: "SU1" },
    { maLo: "SU2", E: 3.33e10, F: 10.0, loSanXuat: "SU2" },
    { maLo: "SU3", E: 3.27e10, F: 9.0, loSanXuat: "SU3" },
  ];
  const clausiiLots = [
    { maLo: "CL1", E: 2.91e10, F: 9.0, loSanXuat: "CL1" }, // 1.091,25L
    { maLo: "CL2", E: 3.02e10, F: 9.0, loSanXuat: "CL2" }, // 1.132,5L
    { maLo: "CL3", E: 2.4e10, F: 7.0, loSanXuat: "CL3" },  // 700L
    { maLo: "CL4", E: 2.7e10, F: 8.0, loSanXuat: "CL4" },  // 900L
  ];
  const plan = planTwoComponent({ subtilisLots, clausiiLots, product: { N: 300_000, H: 5.3, gSubtilis: 4.0e8, gClausii: 2.4e8 }, mode: "tronMePha" });
  check("feasible = true", plan.feasible === true, plan.reason || "");
  if (plan.feasible) {
    check("chọn đúng tổ hợp CL3 + CL4 (không theo FIFO)", JSON.stringify(plan.selectedClausiiLots.slice().sort()) === JSON.stringify(["CL3", "CL4"]), JSON.stringify(plan.selectedClausiiLots));
    const u = {}; plan.batches.forEach((b) => b.clausii.forEach((e) => { u[e.maLo] = (u[e.maLo] || 0) + e.theTichRaw; }));
    const by = Object.fromEntries(clausiiLots.map((l) => [l.maLo, l]));
    check("không chai clausii nào dư", Object.entries(u).every(([m, f]) => Math.abs(f - by[m].F) < EPStest()), JSON.stringify(u));
    check("T sát N (99-101%)", plan.T >= 0.99 * 300_000 && plan.T <= 1.01 * 300_000, `T=${plan.T}`);
  }
}

function EPStest() {
  return 1e-3; // dung sai số học khi so sánh dấu chấm động trong test
}

console.log(`\n=== KẾT QUẢ: ${passCount} PASS / ${failCount} FAIL ===`);
if (failCount > 0) process.exit(1);
