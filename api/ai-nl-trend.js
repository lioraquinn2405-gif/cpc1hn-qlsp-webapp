// Vercel serverless function — nhận số liệu THỐNG KÊ ĐÃ TÍNH SẴN (client tự tính từ bảng materials,
// xem computeNLTrendStats trong App.jsx) về tình trạng nhiễm khuẩn NL trong 1 tháng (hoặc tổng quan
// nhiều tháng), nhờ AI (DeepSeek) viết ĐÁNH GIÁ nhận xét bằng lời cho NCV — khác với ai-review-mix-plan
// (chỉ diễn giải số có sẵn), ở đây AI ĐƯỢC PHÉP đưa nhận định/khuyến nghị dựa trên số liệu, vì đây là
// việc phân tích xu hướng mang tính tư vấn, không phải xác nhận 1 phép tính đơn định đã chốt.
// Cần DEEPSEEK_API_KEY trong Environment Variables của Vercel (khác Script Properties Apps Script).
import { requireApprovedUser } from "./_lib/adminAuth.js";

export default async function handler(req, res) {
  // Bọc TOÀN BỘ handler trong try/catch (xem lý do y hệt trong ai-review-mix-plan.js, phát hiện
  // 2026-08-10) — lỗi ngoài phần try/catch riêng của DeepSeek trước đây bị Vercel trả về trang lỗi
  // không phải JSON, client chỉ hiện thông báo chung chung, không biết lỗi thật là gì.
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const auth = await requireApprovedUser(req, res);
    if (!auth) return;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Chưa cấu hình DEEPSEEK_API_KEY trên Vercel (Project Settings > Environment Variables)." });
      return;
    }

    const { stats, label } = req.body || {};
    if (!stats || typeof stats !== "object") {
      res.status(400).json({ error: "Thiếu dữ liệu thống kê (stats)." });
      return;
    }
    await handleTrend(res, apiKey, stats, label);
  } catch (err) {
    res.status(500).json({ error: err.message || "Lỗi không xác định (ngoài dự kiến) khi phân tích xu hướng." });
  }
}

async function handleTrend(res, apiKey, stats, label) {
  const messages = [
    {
      role: "system",
      content:
        "Bạn là chuyên gia phân tích chất lượng cho 1 nhà máy sản xuất chế phẩm sinh học (men vi sinh " +
        "Bacillus subtilis/clausii). Nhiệm vụ: nhận số liệu JSON THỐNG KÊ đã tính sẵn (không phải dữ liệu " +
        "thô) về tỉ lệ lô nguyên liệu (NL) không đạt kiểm nghiệm nhiễm khuẩn trong 1 khoảng thời gian, và " +
        "viết một ĐÁNH GIÁ TỔNG QUAN bằng tiếng Việt cho nhân viên kỹ thuật (NCV). Yêu cầu: " +
        "(1) Nhận xét mức độ nghiêm trọng của tỉ lệ nhiễm hiện tại (dựa trên số liệu được cung cấp, không " +
        "bịa số khác). (2) Nếu có dữ liệu nhiều tháng, chỉ ra xu hướng tăng/giảm/ổn định. (3) Chỉ ra loại " +
        "nhiễm (nhiễm con nào) hoặc chủng (subtilis/clausii) nào đang là vấn đề chính, nếu số liệu cho thấy " +
        "rõ. (4) Đưa 1-2 khuyến nghị hành động ngắn gọn, thực tế cho xưởng (vd kiểm tra lại khâu nào, chủng " +
        "nào cần chú ý) — chỉ dựa trên các con số đã cho, không suy diễn nguyên nhân kỹ thuật vi sinh sâu xa " +
        "ngoài khả năng (bạn không có dữ liệu về quy trình vệ sinh/môi trường thực tế). Trả lời ngắn gọn, " +
        "dạng đoạn văn/gạch đầu dòng, không dùng bảng biểu phức tạp.",
    },
    {
      role: "user",
      content: `Số liệu thống kê (${label || "không rõ khoảng thời gian"}):\n` + JSON.stringify(stats, null, 2) +
        "\n\nHãy viết đánh giá xu hướng nhiễm khuẩn NL dựa trên số liệu trên.",
    },
  ];

  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.4 }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(502).json({ error: data?.error?.message || `Lỗi gọi DeepSeek (mã ${resp.status})` });
      return;
    }
    const explanation = data?.choices?.[0]?.message?.content?.trim();
    if (!explanation) {
      res.status(502).json({ error: "DeepSeek không trả về nội dung." });
      return;
    }
    res.status(200).json({ explanation });
  } catch (err) {
    res.status(500).json({ error: err.message || "Lỗi không xác định khi gọi AI." });
  }
}
