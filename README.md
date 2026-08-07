# Quản lý pha chế sinh phẩm — kiến trúc có backend/database

```
Mail (NCV gửi kết quả)
   │  copy/dán thủ công
   ▼
Google Sheet (nơi QC dán dữ liệu chai/lô mới)
   │  bấm menu "Pha chế > Đẩy dữ liệu lên hệ thống" (Apps Script)
   ▼
Supabase (Postgres + API tự sinh + realtime)
   ▲  đọc/ghi trực tiếp qua supabase-js
   │
Web app React (QC nhập trực tiếp, xem 3 tab: chờ pha / chờ xử lý / đã pha)
```

Supabase đóng vai trò **backend + database**: bạn không cần tự viết server, PostgREST
(có sẵn trong Supabase) tự sinh API REST từ bảng Postgres. Google Sheet chỉ là
**trạm trung chuyển** giữa mail và hệ thống — không phải nơi lưu trữ chính thức.

## 1. Tạo Supabase project

1. Vào https://supabase.com → tạo project mới (free tier là đủ).
2. Vào **SQL Editor** → dán toàn bộ nội dung [`supabase/schema.sql`](supabase/schema.sql) → Run.
   Việc này tạo 2 bảng `materials`, `products`, bật realtime, và seed sẵn 3 sản phẩm.
3. Vào **Project Settings > API**, lấy 2 giá trị:
   - `Project URL` → dùng cho cả web app và Apps Script.
   - `anon public` key → dùng cho web app (an toàn để lộ ra trình duyệt vì đã có RLS).
   - `service_role` key → **chỉ dùng trong Apps Script** (chạy phía server của Google),
     không bao giờ đưa vào code frontend.

`schema.sql` đã yêu cầu đăng nhập (Supabase Auth) mới đọc/ghi được — xem mục 6 để
tạo tài khoản cho từng QC.

## 2. Chạy web app ở máy bạn

Cần cài [Node.js](https://nodejs.org) (bản LTS) trước — máy hiện chưa có.

```powershell
npm install
copy .env.example .env
# mở .env, dán VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY từ bước 1
npm run dev
```

Mở địa chỉ mà `npm run dev` in ra (thường là http://localhost:5173). App sẽ đọc/ghi
thẳng vào Supabase — QC nhiều người mở cùng lúc sẽ thấy dữ liệu đồng bộ realtime.

Muốn cả xưởng truy cập qua mạng nội bộ/internet (không chỉ máy bạn): build
(`npm run build`) rồi deploy thư mục `dist/` lên Vercel/Netlify/Cloudflare Pages
(đều có gói miễn phí), nhớ khai báo 2 biến môi trường ở bước 1 trong cấu hình hosting.

## 3. Tạo Google Sheet trung chuyển

1. Tạo Google Sheet mới, hàng đầu tiên là tiêu đề cột — dùng đúng các tên cột đã quen
   dùng trong file Excel QC hiện tại (STT, Tên NL, Chủng, Đợt SX, Số lô, Lô chủng,
   Thể tích dịch, Cảm quan, pH, MĐ nhãn, MĐ SH, Bào tử %, Tình trạng, Ghi chú, Mẻ pha,
   Nhiễm khuẩn, Nhiễm con nào — không cần đúng thứ tự, script tự dò theo tên cột).
2. Extensions > Apps Script → xoá code mẫu → dán toàn bộ [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. Trong Apps Script editor: **Project Settings** (icon bánh răng bên trái) >
   **Script Properties** > Add property, thêm 3 dòng:
   - `SUPABASE_URL` = Project URL ở bước 1
   - `SUPABASE_SERVICE_KEY` = service_role key ở bước 1
   - `ALERT_EMAIL` = địa chỉ mail nhận cảnh báo hạn dùng NL (mục 5 bên dưới)
4. Quay lại Sheet, tải lại trang → menu **"Pha chế"** sẽ xuất hiện trên thanh menu.
5. Dán/nhập vài dòng dữ liệu mới (đúng như bạn nhận từ mail) → bấm
   **Pha chế > Đẩy dữ liệu lên hệ thống**. Lần đầu chạy, Google sẽ hỏi cấp quyền
   (Authorize access) — chọn tài khoản Google của bạn và đồng ý.
6. Mở web app ở bước 2 → dữ liệu vừa đẩy sẽ xuất hiện ngay trong tab tương ứng.

Script dùng `on_conflict=so_lo` (upsert) nên bấm nút nhiều lần không tạo trùng —
chai/lô đã tồn tại (theo "Số lô") sẽ được cập nhật đè, không nhân bản.

## 4. Quy trình hằng ngày

1. Nhận mail kết quả lô/chai mới từ NCV.
2. Dán dữ liệu vào Google Sheet (thêm dòng mới bên dưới).
3. Bấm **Pha chế > Đẩy dữ liệu lên hệ thống** trong Sheet.
4. QC mở web app, vào tab "NL chờ pha" / "NL chờ xử lý" để kiểm nhiễm khuẩn, nhập
   trực tiếp trên web (mọi chỉnh sửa tự lưu vào Supabase ngay lập tức).
5. Khi pha chế, dùng tab "Pha chế" để chọn chai theo lô và xác nhận — bản ghi tự
   chuyển sang "NL đã pha".

Muốn nạp thẳng 1 file Excel có sẵn (không qua Google Sheet): nhờ chạy
`node scripts/import-xlsx.mjs <đường-dẫn-file.xlsx>` (cần `SUPABASE_SERVICE_KEY`
trong `.env`, xem `.env.example`).

## 5. Cảnh báo hạn dùng nguyên liệu qua mail

Nguyên liệu chưa pha được tính "tuổi" theo tháng kể từ **Đợt SX**. Ở mốc 3, 6, 9, 12
tháng, hệ thống gửi mail nhắc nhở; ở mốc 13 tháng, nguyên liệu bị coi là hết hạn dùng
và web app tự chuyển nó sang tab "NL chờ xử lý" (kèm nhãn đỏ "Quá hạn"; riêng mốc 12
tháng web app hiện nhãn "Sắp hết hạn" ngay trong tab "NL chờ pha" để cảnh báo trước).

Thiết lập (làm 1 lần, trên cùng Google Sheet đã gắn Apps Script ở mục 3):

1. Vào Supabase **SQL Editor**, chạy nội dung [`supabase/migration_alert_tracking.sql`](supabase/migration_alert_tracking.sql)
   (thêm cột theo dõi đã gửi cảnh báo, tránh gửi trùng mail mỗi ngày).
2. Dán lại toàn bộ [`google-apps-script/Code.gs`](google-apps-script/Code.gs) mới nhất
   vào Apps Script (đã có thêm phần cảnh báo hạn dùng).
3. Đảm bảo đã thêm Script Property `ALERT_EMAIL` như mục 3 bước 3 ở trên.
4. Trong Sheet, bấm **Pha chế > Kiểm tra cảnh báo hạn dùng (chạy thử)** để thử ngay —
   Google sẽ hỏi thêm quyền gửi mail (`Send email as you`), đồng ý là xong.
5. Bấm **Pha chế > Bật gửi cảnh báo hạn dùng tự động hàng ngày** — script sẽ tự chạy
   mỗi ngày lúc 8h sáng, không cần mở Sheet hay bấm gì thêm.

Mail chỉ gửi cho nguyên liệu **vừa chạm mốc mới** trong ngày (không lặp lại mỗi ngày
cho cùng 1 mốc), và liệt kê đầy đủ mọi lô/chai chạm mốc trong cùng 1 mail.

## 6. Đăng nhập, đăng ký và duyệt tài khoản (Supabase Auth + bảng `profiles`)

Web app cho phép **tự đăng ký** (họ tên, phòng ban, mã nhân viên, email, mật khẩu)
ngay ở màn đăng nhập, nhưng tài khoản mới ở trạng thái **"Chờ duyệt"** và không đọc/ghi
được dữ liệu cho tới khi admin duyệt trong tab **"Người dùng"**.

Thiết lập (làm 1 lần):

1. Vào Supabase **SQL Editor**, chạy nội dung [`supabase/migration_profiles.sql`](supabase/migration_profiles.sql)
   — tạo bảng `profiles` (họ tên, phòng ban, mã NV, vai trò admin/rd/qa/qc/kh, trạng thái
   pending/approved/rejected), trigger tự tạo profile khi có tài khoản mới, cột
   `created_by`/`updated_by` trên `materials`, và đổi RLS `materials`/`products` sang
   yêu cầu `profiles.status = 'approved'` thay vì chỉ cần đăng nhập. Không ảnh hưởng
   Google Apps Script / `scripts/import-xlsx.mjs` vì cả hai dùng `service_role` key,
   luôn bỏ qua RLS.
2. Chạy tiếp [`supabase/migration_profiles_departments.sql`](supabase/migration_profiles_departments.sql)
   — mở rộng vai trò thành `admin/rd/qa/qc/kh` và tự gán vai trò theo phòng ban
   (RD/QA/QC/KH) người dùng chọn lúc đăng ký.
3. Vào **Authentication > Providers**, đảm bảo **Email** đang bật (mặc định đã bật).
4. Chạy lệnh SQL ghi trong cuối file migration (đổi email cho đúng tài khoản của bạn)
   để tự phong **admin đầu tiên** — bắt buộc vì chưa có admin nào thì không ai duyệt
   được ai qua giao diện:
   ```sql
   update profiles set role = 'admin', status = 'approved' where email = 'ban@vidu.com';
   ```

Từ đó về sau, người dùng mới chỉ cần bấm "Đăng ký ngay" ở trang đăng nhập, admin vào
tab **"Người dùng"** (chỉ admin thấy) để **Duyệt**/**Từ chối**/đổi vai trò. Vai trò
(admin/rd/qa/qc/kh) hiện chỉ để hiển thị và không khoá tính năng nào — mọi tài khoản đã duyệt
đều có toàn quyền đọc/ghi như nhau. Mỗi lô nguyên liệu ghi lại **người tạo** và
**người sửa gần nhất** (hiển thị 2 cột cuối bảng NL). Muốn đăng xuất: nút ở cuối sidebar.

### 6b. Admin tự tạo tài khoản mới bằng số điện thoại (không qua đăng ký)

Supabase Dashboard > Authentication > Users > "Add user" **chỉ nhận email, không có ô
số điện thoại** — không dùng được để tạo tài khoản đăng nhập bằng SĐT. Thay vào đó dùng
Edge Function [`supabase/functions/create-user-by-phone/index.ts`](supabase/functions/create-user-by-phone/index.ts)
(đã deploy sẵn, dùng chung cơ chế với `scripts/import-users.mjs`).

Mỗi lần cần tạo tài khoản mới:

1. Vào Supabase Dashboard > **Edge Functions** > `create-user-by-phone` > tab **Test**.
2. HTTP Method: **POST**.
3. Ở **Headers**, thêm đúng tên `x-admin-secret` (không phải `ADMIN_CREATE_SECRET` —
   đó là tên secret lưu ở "Manage secrets", còn đây là tên **header** gửi lên, hai cái
   khác nhau, dễ nhầm), giá trị là secret đã lưu trong **Edge Functions > Secrets**.
4. Ở **Request Body**, dán JSON kiểu:
   ```json
   {
     "fullName": "Nguyễn Văn A",
     "phone": "0912345678",
     "password": "mật khẩu ban đầu",
     "department": "QC",
     "role": "qc"
   }
   ```
   (`department`/`role`: rd/qa/qc/kh, hoặc `role` có thể là `admin`/`ktv`. Quy ước đang
   dùng: mật khẩu ban đầu = chính số điện thoại, người dùng tự đổi sau ở "Tài khoản của tôi".)
5. Bấm **Send Request** — `{"ok": true, ...}` là thành công (tài khoản đăng nhập được
   ngay bằng SĐT + mật khẩu vừa đặt, không cần xác nhận OTP); nếu SĐT đã tồn tại sẽ báo
   lỗi 409 rõ ràng.

Vì gõ trực tiếp trong trình duyệt (không qua PowerShell) nên tên có dấu tiếng Việt
không bị lỗi font.

## 7. Thùng rác (xoá an toàn ở "NL chờ pha")

Ở tab "NL chờ pha", bấm ✕ cuối mỗi dòng sẽ **không xoá thật ngay** mà chuyển vào
nhánh "Thùng rác" (nằm dưới Bacillus subtilis/clausii trong sidebar). Từ đó có thể
**Khôi phục** hoặc **Xoá vĩnh viễn**. Mục nào nằm trong Thùng rác quá **30 ngày** sẽ
tự động bị xoá vĩnh viễn — tự chạy mỗi khi có người mở web app, và chạy nền hàng
ngày qua Apps Script (không cần ai mở web).

Thiết lập (làm 1 lần):

1. Vào Supabase **SQL Editor**, chạy nội dung [`supabase/migration_pending_delete.sql`](supabase/migration_pending_delete.sql)
   và [`supabase/migration_trash_retention.sql`](supabase/migration_trash_retention.sql).
2. Dán lại toàn bộ [`google-apps-script/Code.gs`](google-apps-script/Code.gs) mới nhất vào Apps Script
   (nếu đã bật trigger hàng ngày ở mục 5 thì việc dọn Thùng rác tự chạy kèm, không cần bật gì thêm).
3. Muốn thử ngay: **Pha chế > Dọn Thùng rác quá 30 ngày (chạy thử)** trong menu Sheet.

## 8. Deploy lên Vercel (đã làm — trang public hiện tại)

Web app đang chạy công khai tại: `https://quanlysinhpham.vercel.app`

Mỗi khi sửa code xong, nhờ chạy để cập nhật bản public:

```powershell
npm run build
npx vercel --prod --yes
```

Biến môi trường (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) đã cấu hình sẵn trên
Vercel (Project Settings > Environment Variables) cho cả Production/Preview/Development
— không cần làm lại trừ khi đổi project Supabase.

## 9. Bước nâng cấp tiếp theo (chưa làm trong bản này)

- Tự động hoá bước "dán mail vào Sheet": dùng Gmail add-on hoặc dịch vụ như
  Zapier/Make để tự trích dữ liệu từ mail (đặc biệt nếu NCV luôn gửi cùng 1 định
  dạng file đính kèm) — hiện tại vẫn cần dán tay.
- ~~Phân quyền theo vai trò và ghi nhận ai sửa dòng nào~~ — đã làm: xem mục 6
  (đăng ký + duyệt tài khoản, vai trò theo phòng ban RD/QA/QC/KH, cột người
  tạo/sửa trên bảng NL). Vai trò hiện chỉ để hiển thị, chưa khoá tính năng nào
  theo vai trò cụ thể — có thể làm tiếp nếu cần.
