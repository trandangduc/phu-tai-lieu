# Gamma Export (extension Chrome / Edge)

Xuất trang Gamma (`https://gamma.app/embed/...?mode=doc` hoặc `https://gamma.app/docs/...`) ra:

- **PDF**: chữ thật (bôi đen, Ctrl+F, copy được), có bookmark theo heading. Mỗi thẻ Gamma là
  một trang **cao vừa đúng thẻ**, nên không có trang trắng, không cắt ngang thẻ. Hai khổ:
  - **Như web** (mặc định): trang đúng bằng khung thẻ bạn thấy trên màn hình, giống HTML.
  - **Rộng bằng A4**: trang rộng 210mm, thẻ dàn lại theo bề rộng đó.
- **Word (.doc)**: sửa được nội dung.
- **HTML**: một file, giữ giao diện.

## Cài đặt (một lần)

1. Giải nén `gamma-export-extension.zip` ra một thư mục (vd. `C:\gamma-export-extension`).
2. Mở `chrome://extensions` (Edge: `edge://extensions`).
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** → chọn thư mục vừa giải nén (thư mục có file `manifest.json`).
5. Bấm biểu tượng mảnh ghép trên thanh công cụ → ghim **Gamma Export** cho dễ bấm.

## Dùng

1. Mở trang Gamma, đợi tải xong.
2. Bấm biểu tượng **Gamma Export** → **Tải PDF** (hoặc Word / HTML).
3. Đợi 20–40 giây (extension tự cuộn hết trang, đo từng thẻ). File tự tải về thư mục Downloads.

Trong lúc xuất PDF, Chrome hiện thanh *"Gamma Export started debugging this browser"*: bình
thường, extension dùng bộ in của Chrome để tạo PDF; thanh tự tắt khi xong. Sau khi xuất, bấm
F5 nếu muốn trang Gamma hiển thị lại như cũ.

## Cách hoạt động (PDF)

- `scripts/prepare_pdf.js`: cuộn hết trang; khi in thì mở khung cuộn 100vh của Gamma, trả bề
  rộng trang về khổ giấy (CSS in của Gamma ép `body` rộng 1200px và `.document-content` là
  phần tử flex không co, làm Chrome thu nhỏ cả trang), ẩn nút/thanh công cụ/phần sau thẻ cuối,
  tắt `filter`/blend (Chrome chụp chúng thành ảnh, mất chữ), cho bảng tự chia cột.
- `scripts/fit_pages.js`: bỏ `min-height` cố định bằng px của thân thẻ, đo từng thẻ ở đúng
  điều kiện in (CSS in, cửa sổ rộng 794px vì cỡ chữ Gamma theo `vw`), rồi gán mỗi thẻ một
  named page `@page gfitN { size: 794px <cao>px }`.
- `background.js`: gọi `Page.printToPDF` (bookmark + PDF có cấu trúc) và tải file về.
