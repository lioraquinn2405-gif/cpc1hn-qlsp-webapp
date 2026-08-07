-- Chạy trong SQL Editor. Cho phép "sửa" 1 kế hoạch đã lưu (trạng thái "Cần điều chỉnh"): sửa xong sẽ
-- tạo 1 dòng MỚI trong lịch sử (giữ nguyên dòng gốc làm lưu vết), và đánh dấu dòng gốc là "đã sửa,
-- xem dòng mới" bằng cột superseded_by_id trỏ sang dòng mới. Đồng thời thêm policy DELETE (trước đây
-- chưa có — chỉ có select/insert/update) để nút "Xoá" trên lịch sử kế hoạch hoạt động được.

alter table mix_plans add column if not exists superseded_by_id bigint references mix_plans(id);

drop policy if exists "mix_plans_delete_approved" on mix_plans;
create policy "mix_plans_delete_approved" on mix_plans for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'approved'));
