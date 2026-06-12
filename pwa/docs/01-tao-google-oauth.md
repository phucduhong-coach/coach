# Hướng dẫn 1 — Tạo kết nối Google cho ứng dụng "Ghi Buổi Tập"

> Tài liệu này dành cho **huấn luyện viên** (không cần biết lập trình). Bạn chỉ làm
> **một lần duy nhất**. Làm xong, hằng ngày bạn chỉ cần mở app trên điện thoại là
> đã đăng nhập sẵn và ghi set được ngay.
>
> Cứ làm tuần tự từng bước. Ở mỗi bước có ô **[ẢNH: …]** — đó là chỗ sẽ chèn ảnh
> chụp màn hình minh hoạ. (Ảnh sẽ được bổ sung sau; hiện tại bạn đọc theo lời mô tả
> là đủ làm.)

---

## Bạn cần chuẩn bị

- [ ] Một **tài khoản Google** (Gmail) của chính bạn — đây là tài khoản chứa thư
      mục dữ liệu `_coach_data`.
- [ ] Một máy tính có trình duyệt (Chrome/Edge/Safari) để mở Google Cloud Console.
- [ ] Khoảng **15–20 phút** ngồi yên một lượt.
- [ ] Đã biết **đường link (URL) của app** sau khi đăng lên GitHub Pages. Nếu chưa
      có, làm xong Bước 4 quay lại điền cũng được — xem ghi chú ở Bước 4.

> 💡 Bạn **không cần** nhớ thuật ngữ kỹ thuật. Cứ bấm theo từng bước. Khi gặp chữ lạ
> (ví dụ "OAuth", "Client ID"), hiểu đơn giản là: *cái chìa khoá để app của bạn được
> phép mở đúng thư mục Google Drive của bạn*.

---

## Bước 1 — Tạo "dự án" trên Google Cloud

"Dự án" giống như một **ngăn tủ riêng** để chứa cài đặt kết nối của app này.

1. Mở trình duyệt và vào địa chỉ: **https://console.cloud.google.com**
2. Đăng nhập bằng **tài khoản Google của bạn** (tài khoản chứa thư mục `_coach_data`).
3. Ở thanh trên cùng, bấm vào **ô chọn dự án** (chỗ ghi tên dự án, cạnh chữ
   "Google Cloud").
   [ẢNH: thanh trên cùng, mũi tên chỉ vào ô chọn dự án]
4. Trong cửa sổ hiện ra, bấm **NEW PROJECT** (Dự án mới).
   [ẢNH: nút "NEW PROJECT" ở góc phải cửa sổ chọn dự án]
5. Ở ô **Project name**, đặt tên dễ nhớ, ví dụ: **`Ghi Buổi Tập`**.
   (Phần *Location/Organization* để mặc định.)
6. Bấm **CREATE** và đợi vài giây cho dự án được tạo xong.
   [ẢNH: form đặt tên dự án với nút CREATE]
7. Sau khi tạo xong, hãy chắc chắn **ô chọn dự án trên cùng đang hiển thị đúng tên
   dự án bạn vừa tạo** (`Ghi Buổi Tập`). Mọi bước sau đều làm bên trong dự án này.

> ✅ Xong Bước 1 khi: trên cùng màn hình hiện đúng tên dự án `Ghi Buổi Tập`.

---

## Bước 2 — Bật quyền dùng Google Drive (và Picker)

App cần được "bật công tắc" để nói chuyện với Google Drive.

1. Bấm vào **menu ☰** (góc trên bên trái) → chọn **APIs & Services** →
   **Library** (Thư viện).
   [ẢNH: menu trái mở ra mục "APIs & Services > Library"]
2. Trong ô tìm kiếm, gõ: **`Google Drive API`**.
3. Bấm vào kết quả **Google Drive API**, rồi bấm nút **ENABLE** (Bật).
   [ẢNH: trang Google Drive API với nút ENABLE màu xanh]
4. Quay lại **Library**, tìm tiếp: **`Google Picker API`**.
5. Bấm vào **Google Picker API** rồi bấm **ENABLE**.
   [ẢNH: trang Google Picker API với nút ENABLE]

> ℹ️ **Google Picker** là cái cửa sổ cho bạn **bấm chọn đúng thư mục `_coach_data`**
> một lần khi kết nối lần đầu. Nhờ vậy app chỉ thấy đúng thư mục đó, không thấy phần
> còn lại trong Drive của bạn.

> ✅ Xong Bước 2 khi: cả hai mục **Drive API** và **Picker API** đều hiện trạng thái
> đã bật (Enabled / Manage).

---

## Bước 3 — Cấu hình "màn hình đồng ý" (OAuth consent screen)

Đây là màn hình Google hiển thị khi bạn đăng nhập lần đầu, đại loại: *"App Ghi Buổi
Tập muốn truy cập Google Drive của bạn — Cho phép?"*. Ta khai báo nội dung màn hình
này.

1. Vào **menu ☰ → APIs & Services → OAuth consent screen**.
   [ẢNH: mục "OAuth consent screen" trong menu APIs & Services]
2. Chọn **User Type = External** (Bên ngoài), rồi bấm **CREATE**.
   [ẢNH: hai lựa chọn Internal/External, chọn External]
   > Chọn **External** là bình thường, kể cả khi chỉ mình bạn dùng.
3. Điền thông tin **App information**:
   - **App name** (Tên ứng dụng): **`Ghi Buổi Tập`**
   - **User support email**: chọn **email của bạn** trong danh sách.
   - **Developer contact information** (ở cuối trang): gõ lại **email của bạn**.
   - Các ô khác (logo, trang chủ…) **bỏ trống cũng được**.
   [ẢNH: form App information với tên app và email hỗ trợ]
4. Bấm **SAVE AND CONTINUE**.
5. Sang trang **Scopes** (Phạm vi): bấm **ADD OR REMOVE SCOPES**.
   - Trong ô lọc, gõ: **`drive.file`**.
   - Tích chọn dòng có phạm vi **`.../auth/drive.file`**
     (mô tả đại ý: *xem và quản lý các file do app này tạo hoặc bạn mở bằng app này*).
   - Bấm **UPDATE**, rồi **SAVE AND CONTINUE**.
   [ẢNH: bảng chọn scope, dòng drive.file được tích]
   > ⚠️ Chỉ chọn **đúng `drive.file`**. **Đừng** chọn phạm vi "Drive toàn bộ".
   > App chỉ cần đúng một thư mục là đủ và an toàn hơn nhiều.
6. Sang trang **Test users** (Người dùng thử): bấm **ADD USERS**, nhập **chính
   email của bạn**, rồi bấm **ADD**.
   [ẢNH: ô thêm Test users với email của HLV]
   > 🔑 **Quan trọng — vì sao thêm Test user:** Khi app ở chế độ **Testing** và bạn
   > có tên trong danh sách Test users, bạn **dùng được ngay**, không phải gửi app đi
   > "xét duyệt" (verification) của Google. Vì chỉ có **một người dùng là bạn**, để
   > app ở chế độ **Testing là đủ** — đơn giản và nhanh.
7. Bấm **SAVE AND CONTINUE**, xem lại tóm tắt rồi **BACK TO DASHBOARD**.

> ✅ Xong Bước 3 khi: màn hình đồng ý đã lưu, scope là `drive.file`, và email của
> bạn nằm trong **Test users**.

---

## Bước 4 — Tạo "Client ID" loại Web application

Đây là **chìa khoá** mà ta sẽ dán vào app.

1. Vào **menu ☰ → APIs & Services → Credentials** (Thông tin xác thực).
2. Bấm **+ CREATE CREDENTIALS** (trên cùng) → chọn **OAuth client ID**.
   [ẢNH: menu "CREATE CREDENTIALS" mở ra, chọn OAuth client ID]
3. Ở **Application type**, chọn **Web application**.
4. **Name**: đặt gì cũng được, ví dụ **`Ghi Buổi Tập - Web`**.
5. Ở mục **Authorized JavaScript origins**, bấm **ADD URI** và nhập **địa chỉ gốc
   của GitHub Pages** (chỉ phần tên miền, **không có** đường dẫn phía sau). Ví dụ:

   ```
   https://<tên-tài-khoản>.github.io
   ```

   Thay `<tên-tài-khoản>` bằng tên GitHub của bạn. Ví dụ thật:
   `https://hlv-an.github.io`
   [ẢNH: ô Authorized JavaScript origins đã điền địa chỉ .github.io]

6. Ở mục **Authorized redirect URIs**, bấm **ADD URI** và nhập **địa chỉ trang
   callback của app** — chính là trang `index.html` của PWA. Ví dụ:

   ```
   https://<tên-tài-khoản>.github.io/<tên-repo>/pwa/index.html
   ```

   Ví dụ thật: `https://hlv-an.github.io/coach/pwa/index.html`
   [ẢNH: ô Authorized redirect URIs đã điền địa chỉ tới /pwa/index.html]

   > 📌 **Làm sao biết đúng URL?** Hai địa chỉ trên là **địa chỉ app sau khi đăng
   > lên GitHub Pages**. Nếu bạn **chưa đăng** app lên GitHub Pages, hãy làm phần
   > đó trước (xem Hướng dẫn 2), mở thử app trên điện thoại, **copy đúng đường link
   > trên thanh địa chỉ**, rồi quay lại đây điền cho khớp **từng ký tự** (kể cả chữ
   > hoa/thường và dấu `/`). Sai một ký tự là Google sẽ báo lỗi khi đăng nhập.

7. Bấm **CREATE**.
8. Một cửa sổ hiện ra **Client ID** (và Client secret). **Copy Client ID** —
   chuỗi dạng `…-….apps.googleusercontent.com`. Giữ lại để dán ở Bước 5.
   [ẢNH: cửa sổ hiện Client ID vừa tạo, có nút copy]

   > 🔒 **Không cần Client secret.** App này là **PKCE public client** (chạy trong
   > trình duyệt điện thoại), nên **không dùng** và **không nên** lưu client secret.
   > Cứ bỏ qua phần secret.

> ✅ Xong Bước 4 khi: bạn đã có **Client ID** và đã điền đúng **origins** +
> **redirect URI** khớp với link app trên GitHub Pages.

---

## Bước 5 — Dán "chìa khoá" vào app

Bây giờ ta đưa Client ID vào đúng chỗ trong mã của app.

Mở file: **`pwa/drive-client.js`**
(đường dẫn đầy đủ: `d:\ANATOMY_LIBRARY\pwa\drive-client.js`)

Ở **gần đầu file** có một khối tên **`DRIVE_CONFIG`** trông như sau:

```js
const DRIVE_CONFIG = {
  clientId: '',     // FILL_IN_AFTER_TASK_15_1
  redirectUri: '',  // FILL_IN_AFTER_TASK_15_1
  apiKey: '',       // FILL_IN_AFTER_TASK_15_1 (Picker developer key — tuỳ chọn)
  appId: '',        // FILL_IN_AFTER_TASK_15_1 (Picker app/project id — tuỳ chọn)
};
```

Điền giá trị vào giữa hai dấu nháy `'…'`:

- **`clientId`**: dán **Client ID** đã copy ở Bước 4
  (chuỗi `…apps.googleusercontent.com`).
- **`redirectUri`**: dán **đúng** địa chỉ **Authorized redirect URI** bạn nhập ở
  Bước 4 (ví dụ `https://hlv-an.github.io/coach/pwa/index.html`).
- **`apiKey`** *(tuỳ chọn — cho Picker)*: nếu muốn cửa sổ chọn thư mục chạy ổn
  định, tạo thêm một **API key** ở **Credentials → CREATE CREDENTIALS → API key**,
  rồi dán vào đây.
- **`appId`** *(tuỳ chọn — cho Picker)*: là **Project number** của dự án (xem ở
  trang chủ Google Cloud, mục *Project info*). Dán nếu có.

Ví dụ sau khi điền:

```js
const DRIVE_CONFIG = {
  clientId: '123456789-abcdefg.apps.googleusercontent.com',
  redirectUri: 'https://hlv-an.github.io/coach/pwa/index.html',
  apiKey: 'AIzaSy...your-key...',   // có thể để '' nếu chưa tạo
  appId: '123456789',               // có thể để '' nếu chưa có
};
```

> ⚙️ **Cách khác (không sửa trực tiếp khối trên):** Bạn có thể gọi hàm
> **`configureDrive({...})`** lúc app khởi động và truyền đúng các giá trị đó:
>
> ```js
> configureDrive({
>   clientId: '123456789-abcdefg.apps.googleusercontent.com',
>   redirectUri: 'https://hlv-an.github.io/coach/pwa/index.html',
>   apiKey: 'AIzaSy...',   // tuỳ chọn
>   appId: '123456789',    // tuỳ chọn
> });
> ```
>
> Dùng cách nào cũng được — kết quả như nhau. Quan trọng là **`clientId`** và
> **`redirectUri`** phải đúng.

> 🔒 Nhắc lại: **không có ô client secret** ở đây, và bạn **không cần** nó. Đây là
> điều bình thường với PKCE public client.

> ✅ Xong Bước 5 khi: `clientId` và `redirectUri` trong `DRIVE_CONFIG` (hoặc trong
> lời gọi `configureDrive(...)`) đã có giá trị thật, lưu file lại.

---

## Lưu ý bảo mật (ngắn gọn)

- **Phạm vi hẹp:** app chỉ xin quyền **`drive.file`** — tức chỉ đụng tới **đúng
  thư mục `_coach_data`** bạn chọn và các file app tạo trong đó. App **không** thấy
  phần còn lại trong Google Drive của bạn.
- **Chỉ mình bạn dùng:** để app ở chế độ **Testing** và chỉ thêm **email của bạn**
  vào Test users. Không cần công bố app cho người khác.
- **Không có client secret** trong app (PKCE public client) — đúng chuẩn cho app
  chạy trên điện thoại.

---

## Khi nào coi là XONG hết?

- [ ] Đã tạo dự án `Ghi Buổi Tập` trên Google Cloud.
- [ ] Đã **bật** Google Drive API **và** Google Picker API.
- [ ] Đã cấu hình **OAuth consent screen**: External, tên app, email hỗ trợ,
      scope `drive.file`, và **email của bạn** trong **Test users**.
- [ ] Đã tạo **OAuth client ID** loại **Web application** với **origins** +
      **redirect URI** khớp link GitHub Pages.
- [ ] Đã **dán Client ID (+ redirectUri)** vào `DRIVE_CONFIG` trong
      `pwa/drive-client.js` (hoặc qua `configureDrive({...})`).

Làm xong tất cả ô trên là bạn đã sẵn sàng. Bước tiếp theo — **kết nối Google trong
app và cài app ra màn hình chính** — xem **Hướng dẫn 2** (`02-...`).

---

> 🖼️ *Ghi chú cho người biên soạn: các ô **[ẢNH: …]** ở trên là chỗ cần chèn ảnh
> chụp màn hình thật. Ảnh chưa được tạo trong tài liệu này và sẽ được bổ sung sau.*
