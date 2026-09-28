/*
 * In trang Gamma (https://gamma.app/embed/...?mode=doc) ra PDF CÓ CHỮ (bôi đen, tìm, copy được).
 *
 * Vì sao bản cũ ra toàn ảnh: Chrome in PDF sẽ biến cả khối thành ẢNH khi khối đó (hoặc
 * khối cha) có `filter`, `backdrop-filter` (kính mờ của thẻ Gamma), `mix-blend-mode`,
 * `mask` hay chữ tô gradient (`background-clip: text`). Thẻ Gamma có mấy thứ đó, nên
 * mọi chữ trong thẻ bị chụp thành hình. `transform: scale()` còn làm nặng thêm.
 *
 * Script này tắt các hiệu ứng đó KHI IN, phóng to bằng `zoom` thay cho `transform`,
 * cuộn hết trang để Gamma vẽ đủ các thẻ, rồi mới mở hộp in.
 *
 * Cách dùng:
 *   1. Mở link Gamma trong Chrome/Edge, đợi tải xong.
 *   2. F12 -> Console -> dán toàn bộ file này -> Enter.
 *   3. Hộp in: Đích = "Lưu dưới dạng PDF" (Save as PDF), KHÔNG chọn "Microsoft Print to PDF".
 *      More settings: bật "Background graphics" nếu muốn giữ màu nền.
 *   4. Mở PDF, Ctrl+F thử một từ: tìm được là có chữ.
 */
(async () => {
  const SCALE = 1.18;                      // như bản cũ; đổi nếu chữ tràn/nhỏ quá
  const CARD = '.react-renderer.node-card.block.block-card';

  // 1) Cuộn hết trang (cả khung cuộn bên trong) để thẻ nào lười tải cũng được vẽ.
  const scrollers = new Set([document.scrollingElement]);
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 &&
        /(auto|scroll)/.test(getComputedStyle(el).overflowY)) scrollers.add(el);
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const el of scrollers) {
    for (let y = 0; y < el.scrollHeight; y += el.clientHeight * 0.8) {
      el.scrollTop = y;
      await sleep(150);
    }
    el.scrollTop = 0;
  }
  await sleep(500);

  // 2) Chữ tô gradient (background-clip: text) -> chữ màu thường, để không bị in thành ảnh.
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') {
      el.style.setProperty('background', 'none', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'currentcolor', 'important');
      if (cs.color === 'rgba(0, 0, 0, 0)' || cs.color === 'transparent') {
        el.style.setProperty('color', '#1a1a1a', 'important');
      }
    }
  }

  // 3) CSS chỉ áp dụng lúc in.
  document.getElementById('fix-print-scale')?.remove();
  const style = document.createElement('style');
  style.id = 'fix-print-scale';
  style.textContent = `
    @media print {
      *, *::before, *::after {
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        mix-blend-mode: normal !important;
        mask: none !important;
        -webkit-mask: none !important;
        mask-image: none !important;
        -webkit-mask-image: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      ${CARD} {
        transform: none !important;       /* bỏ scale cũ: dùng zoom bên dưới */
        zoom: ${SCALE};
        break-inside: avoid;
      }

      .css-gtj3kh {
        overflow: visible !important;
      }
    }
  `;
  document.head.appendChild(style);

  // 4) Cảnh báo nếu nội dung là <canvas>: phần đó vốn là hình, không script nào in ra chữ được.
  const canvases = [...document.querySelectorAll(`${CARD} canvas`)]
    .filter(c => c.width * c.height > 40000);
  if (canvases.length) {
    console.warn(`Có ${canvases.length} canvas lớn trong thẻ: phần này sẽ vẫn là ảnh.`);
  }
  console.log(`Số thẻ: ${document.querySelectorAll(CARD).length}. Đang mở hộp in...`);

  window.print();
})();
