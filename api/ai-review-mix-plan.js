// Vercel serverless function — nhận kết quả 1 kế hoạch pha (đã tính xong bởi thuật toán quyết định
// trong src/lib/mixPlanner.js) và nhờ AI (DeepSeek) GIẢI THÍCH bằng lời cho NCV hiểu tại sao ra đúng
// những con số đó — KHÔNG tự tính lại độc lập (AI dễ sai số học nhiều bước, tính lại độc lập rủi ro
// tự đưa ra cảnh báo sai/false positive gây hoang mang hơn là giúp ích). Cần DEEPSEEK_API_KEY trong
// Environment Variables của Vercel project (khác với Script Properties của Google Apps Script — 2
// nơi lưu biến môi trường tách biệt nhau, phải thêm riêng ở đây nếu muốn dùng tính năng này).
import { requireApprovedUser } from "./_lib/adminAuth.js";

const GLOSSARY = `Chú giải ký hiệu dùng trong dữ liệu (đối chiếu đúng công thức đã dùng, không tự đặt công thức khác):
- E = định lượng lô NL (CFU/ml)
- F = thể tích dịch lô NL đem dùng (L)
- d / mật độ thực tế = mật độ pha thực tế đạt được (CFU/ml)
- G / hàm lượng đích = mật độ đích sản phẩm (CFU/ml) — d luôn phải ĐẠT hoặc NHỈNH HƠN G (0-5%), không bao giờ dưới G
- H = thể tích 1 ống (ml)
- N = số ống cần cho nhịp sản xuất
- T = tổng số ống thực đạt được (mục tiêu T trong khoảng 0.9N-1.1N, ưu tiên sát 1.1N)
- V_i (thể tích dịch pha từ lô i) = F_i * E_i / d
- n_i (số ống từ lô i) = F_i * E_i * 1000 / (d * H)
- meSo = số thứ tự mẻ pha trong nhịp; mỗi mẻ dưới 1080L, tối đa 3 lô NL mở/mẻ`;

export default async function handler(req, res) {
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

  const { planSummary } = req.body || {};
  if (!planSummary || typeof planSummary !== "object") {
    res.status(400).json({ error: "Thiếu dữ liệu kế hoạch (planSummary)." });
    return;
  }

  const messages = [
    {
      role: "system",
      content:
        "Bạn là trợ lý rà soát kỹ thuật cho 1 nhà máy sản xuất chế phẩm sinh học (men vi sinh Bacillus). " +
        "Nhiệm vụ: nhận dữ liệu JSON là kết quả ĐÃ ĐƯỢC TÍNH SẴN bởi 1 thuật toán xác định (deterministic) " +
        "cho 1 kế hoạch pha chế, và giải thích lại bằng tiếng Việt, ngắn gọn, dễ hiểu cho nhân viên kỹ thuật " +
        "(NCV) không rành lập trình. YÊU CẦU BẮT BUỘC: KHÔNG tự tính lại độc lập từ đầu, KHÔNG bịa ra số khác " +
        "với dữ liệu đã cho — chỉ diễn giải và xác nhận tính hợp lý của các số liệu ĐÃ CÓ SẴN trong dữ liệu " +
        "dựa theo đúng công thức trong phần chú giải. Nếu thấy số liệu có gì bất thường/đáng chú ý (dựa trên " +
        "chính các trường warnings/reason đã có trong dữ liệu, hoặc logic hiển nhiên như d < G), nêu rõ để NCV " +
        "để ý — nhưng đừng suy diễn thêm ngoài dữ liệu được cung cấp. Trả lời dạng đoạn văn/gạch đầu dòng ngắn, " +
        "không dùng markdown phức tạp (không bảng biểu).\n\n" + GLOSSARY,
    },
    {
      role: "user",
      content: "Dữ liệu kế hoạch pha chế (JSON):\n" + JSON.stringify(planSummary, null, 2) +
        "\n\nHãy giải thích/rà soát kết quả trên cho NCV.",
    },
  ];

  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.3 }),
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
