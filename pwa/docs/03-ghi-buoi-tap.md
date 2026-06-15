# Hướng dẫn 3 — Dùng tính năng "Ghi buổi tập"

> Dành cho huấn luyện viên — không cần biết kỹ thuật. Hướng dẫn cách **ghi số liệu thực tế**
> của khách trong buổi tập. Thử trước trên **Chrome máy tính** cho quen, rồi dùng trên điện thoại.

---

## Chuẩn bị: phải có "lịch tuần" trên app

App chỉ hiện buổi tập khi đã có **lịch tuần** (week-pack) đẩy ra từ máy tính.

- **Cách đẩy lịch (trên máy tính):** chạy lệnh
  `node _mwl_pushweek.js --write`
  (trong thư mục `D:\DMM-Automation\exercise_library_automation_v22_mouse_park_batch20`).
  Đẩy tuần khác: thêm `--week=2026-06-21`.
- Sau đó **đợi Google Drive đồng bộ** (icon Drive báo "đã cập nhật", ~1 phút).

> Tương lai, khi viewer chạy ổn lại, bạn có thể bấm nút **"📱 Đưa lịch tuần ra điện thoại"** trong viewer thay cho lệnh trên.

---

## Bước 1 — Mở app

1. Mở **Chrome**, dán link: `https://phucduhong-coach.github.io/coach/pwa/index.html`
2. Nhấn **Ctrl + F5** để tải mới.
3. App đã nhớ đăng nhập Google + thư mục `_coach_data` (đã thiết lập một lần) nên vào thẳng.

---

## Bước 2 — Xem danh sách buổi tập

- App hiện **các buổi tập theo ngày** (mỗi dòng: ngày · tên khách · tên buổi).
- **Bấm vào một buổi** để mở danh sách bài tập bên trong.

---

## Bước 3 — Ghi số liệu thực tế cho từng set

Mỗi bài tập có các dòng "set". Trên mỗi set:

| Thành phần | Ý nghĩa |
|---|---|
| **Số mờ (gợi ý)** | Kê đơn HLV đặt sẵn (reps, kg, nghỉ…) để đối chiếu |
| **Ô nhập** (đang hiện `—`) | Gõ số **thực tế** khách làm được |
| **Nút `−` / `+`** | Tăng/giảm nhanh reps hoặc kg (đỡ phải gõ) |
| **Nút `○`** | Bấm để đánh dấu set **đã xong** → đổi thành `✓` |

- Các ô số (reps, kg, thời gian, quãng đường) khi chạm trên điện thoại sẽ hiện **bàn phím số**.

---

## Bước 4 — Thêm set nếu cần

- Khách tập nhiều hơn số set kê đơn? Bấm **"+ Thêm set"** ở cuối bài để thêm dòng mới rồi ghi tiếp.

---

## Bước 5 — Lưu & đồng bộ (tự động)

- Mọi số bạn gõ **tự lưu ngay trong máy** — KHÔNG cần bấm Lưu.
- Khi có mạng, app **tự đẩy lên Google Drive**; góc trên hiện **"Đã đồng bộ"**.
- Lần sau mở máy tính, hệ thống nhập nhật ký để xem **"thực tế so với kê đơn"** và tiến bộ qua các buổi.

---

## Bước 6 — Thử chế độ mất mạng (giống ở phòng gym)

1. Tắt Wi-Fi một lát → vẫn **ghi số liệu bình thường** (badge đổi sang "đang offline", hiện số mục "đang chờ").
2. Bật Wi-Fi lại → app **tự đồng bộ**, badge về "Đã đồng bộ". **Không mất dữ liệu.**

---

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| App báo **"Chưa có lịch tuần"** (dù đã đẩy + đợi đồng bộ) | Giới hạn quyền `drive.file` — báo người hỗ trợ để chỉnh phần đọc lịch. |
| Không thấy buổi của tuần mong muốn | Đẩy lại đúng tuần: `node _mwl_pushweek.js --write --week=YYYY-MM-DD` rồi đợi đồng bộ, tải lại app. |
| Badge "… đang chờ" lâu | Kiểm tra có mạng; muốn đẩy ngay thì bấm **đồng bộ thủ công** trong app. |
| Số liệu ghi nhầm | Sửa trực tiếp trong ô (ghi đè), hoặc bấm `✓`/`○` để bật/tắt "đã xong". |

---

> Xem thêm: **[Hướng dẫn trực quan (có hình)](huong-dan-truc-quan.html)** cho phần cài đặt & kết nối Google.
