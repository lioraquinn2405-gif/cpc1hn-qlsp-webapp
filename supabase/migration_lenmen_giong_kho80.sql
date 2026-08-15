-- Bổ sung kho thứ ba: tủ −80°C. Chạy sau migration_lenmen_giong_mucdich.sql.
--
-- Khác 2 kho kia ở chỗ đây là chỗ GỬI NGOÀI, không phải tủ của xưởng — nên vẫn là một
-- giá trị của dieu_kien_luu (lô nằm ở đúng một nơi tại một thời điểm), nhưng nhãn phải
-- ghi rõ "gửi ngoài" để người tra cứu biết không xuống lấy ngay được.
alter table lenmen_seed_lots
  drop constraint if exists lenmen_seed_lots_dieu_kien_luu_check;

alter table lenmen_seed_lots
  add constraint lenmen_seed_lots_dieu_kien_luu_check
  check (dieu_kien_luu in ('am_20', 'nito_long', 'gui_80'));
