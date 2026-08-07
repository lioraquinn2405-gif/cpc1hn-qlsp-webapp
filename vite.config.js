import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Vercel CLI liên tục ghi lại VERCEL_OIDC_TOKEN vào .env.local khi chạy `vercel dev` — Vite
    // theo dõi file này để hot-reload env vars, nhưng trên Windows việc ghi đè liên tục đó thỉnh
    // thoảng làm watcher dính lỗi EBUSY (file đang bị khoá) và làm sập cả dev server. File .env.local
    // chỉ cần đọc 1 lần lúc khởi động (không cần hot-reload theo từng thay đổi), nên loại hẳn khỏi
    // watch list để tránh sập.
    watch: { ignored: ["**/.env.local"] },
  },
});
