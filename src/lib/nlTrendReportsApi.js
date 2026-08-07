import { supabase } from "./supabaseClient.js";

// "Tổng quan" gộp toàn bộ tháng nên không có 1 tháng thật để làm khoá — dùng ngày mốc cố định
// này làm report_month "giả" riêng cho đúng 1 dòng Tổng quan, tận dụng lại constraint
// unique(report_month) sẵn có thay vì phải sửa schema cho phép report_month rỗng.
export const OVERVIEW_REPORT_MONTH = "0001-01-01";

const FIELDS = [
  ["id", "id"], ["reportMonth", "report_month"], ["stats", "stats"],
  ["aiAssessment", "ai_assessment"], ["createdBy", "created_by"], ["createdAt", "created_at"],
];
const toCamel = (row) => Object.fromEntries(FIELDS.map(([camel, snake]) => [camel, row[snake]]));

export async function fetchNLTrendReports() {
  const { data, error } = await supabase.from("nl_trend_reports").select("*").order("report_month", { ascending: false });
  if (error) throw error;
  return data.map(toCamel);
}

/** Lưu/ghi đè đúng 1 dòng cho tháng đó (bấm "Tạo lại" sẽ ghi đè đánh giá cũ). */
export async function saveNLTrendReport({ reportMonth, stats, aiAssessment, createdBy }) {
  const { error } = await supabase
    .from("nl_trend_reports")
    .upsert(
      { report_month: reportMonth, stats, ai_assessment: aiAssessment, created_by: createdBy },
      { onConflict: "report_month" }
    );
  if (error) throw error;
}

export async function requestNLTrendAI(stats, label) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Chưa đăng nhập.");
  const res = await fetch("/api/ai-nl-trend", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ stats, label }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Không tạo được đánh giá.");
  return body.explanation;
}
