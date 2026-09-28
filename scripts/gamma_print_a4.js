/*
 * In trang Gamma ra PDF khổ A4 dọc, lề 0, nền trắng, MỖI THẺ MỘT TRANG, căn giữa, phóng to
 * 1.18 lần; ẩn thanh điều hướng/nút. Chữ vẫn là chữ (bôi đen, Ctrl+F được).
 * (Gộp 2 script "fix-print-rag" và "fix-print-scale".)
 *
 * Khác bản gốc:
 *   - Phóng to bằng `zoom` tính riêng cho từng thẻ: tối đa 1.18 nhưng không vượt khổ A4
 *     (bản gốc dùng transform + height:100vh nên thẻ to bị cắt mép).
 *   - Thẻ quá dài (vừa trang thì chữ nhỏ hơn 0.6 lần) được chia sang nhiều trang thay vì
 *     bị cắt.
 *   - Chỉ ngắt trang ở thẻ Gamma ngoài cùng, không ở mọi section/article (tránh trang trắng).
 *   - Tắt filter/blend/mask: đó là thứ làm Chrome in chữ thành ảnh.
 *
 * Cách dùng: mở link Gamma, đợi tải xong -> F12 -> Console -> dán -> Enter ->
 *   Đích "Lưu dưới dạng PDF" (Save as PDF), bật "Background graphics".
 */
(async () => {
  const MAX_SCALE = 1.18;                 // phóng to tối đa
  const MIN_FIT = 0.6;                    // nhỏ hơn mức này thì cho thẻ chảy sang trang sau
  const PAGE_W = 793, PAGE_H = 1121;      // A4 ở 96 dpi (210 x 297 mm), bớt 1px cho an toàn
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Cuộn hết trang (cả khung cuộn bên trong) để Gamma vẽ đủ thẻ và ảnh.
  const scrollers = new Set([document.scrollingElement]);
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 &&
        /(auto|scroll)/.test(getComputedStyle(el).overflowY)) scrollers.add(el);
  }
  for (const el of scrollers) {
    for (let y = 0; y < el.scrollHeight; y += el.clientHeight * 0.8) {
      el.scrollTop = y;
      await sleep(150);
    }
    el.scrollTop = 0;
  }
  await sleep(500);

  // Thẻ Gamma; trang khác thì dùng bộ chọn chung của script "fix-print-rag".
  let sel = '.react-renderer.node-card.block.block-card';
  if (!document.querySelector(sel)) sel = 'div[data-card-id], .card, section, article';
  const cards = [...document.querySelectorAll(sel)]
    .filter(c => !c.parentElement.closest(sel));

  // Chữ tô gradient (background-clip: text) -> chữ một màu (màu đầu của gradient), vì Chrome
  // in kiểu chữ này thành ảnh hoặc ra khung lạ quanh chữ.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') {
      const m = cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i);
      el.style.setProperty('background', 'none', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'currentcolor', 'important');
      el.style.setProperty('color', m ? m[0] : '#1a1a1a', 'important');
    }
  }

  let rules = '';
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const w = Math.ceil(r.width), h = Math.ceil(r.height);
    const fitW = Math.min(MAX_SCALE, PAGE_W / w);
    const fitAll = Math.min(fitW, PAGE_H / h);
    const tall = fitAll < MIN_FIT;
    const z = tall ? fitW : fitAll;
    // zoom nhân cả margin, nên chia lại cho z để khoảng trống thật đúng bằng phần dư của trang.
    const padY = tall ? 0 : Math.max(0, (PAGE_H - h * z) / 2 / z);
    const padX = Math.max(0, (PAGE_W - w * z) / 2 / z);
    c.setAttribute('data-print-card', i);
    rules += `
      [data-print-card="${i}"] {
        zoom: ${z.toFixed(4)};
        width: ${w}px !important;
        min-width: ${w}px !important;
        max-width: none !important;
        margin: ${padY.toFixed(1)}px ${padX.toFixed(1)}px !important;
        ${tall ? 'break-inside: auto !important;' : 'break-inside: avoid !important; height: auto !important;'}
      }`;
  });

  document.getElementById('fix-print-rag')?.remove();
  document.getElementById('fix-print-scale')?.remove();
  const style = document.createElement('style');
  style.id = 'fix-print-rag';
  style.textContent = `
    @page { size: A4 portrait; margin: 0; }
    @media print {
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        overflow: visible !important;
      }
      *, *::before, *::after {
        filter: none !important;
        mix-blend-mode: normal !important;
        mask: none !important;
        -webkit-mask: none !important;
        mask-image: none !important;
        -webkit-mask-image: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        animation: none !important;
        transition: none !important;
      }
      [data-print-card] {
        transform: none !important;
        box-sizing: border-box !important;
        break-before: page !important;
        page-break-before: always !important;
      }
      [data-print-card="0"] { break-before: auto !important; page-break-before: auto !important; }
      ${rules}
      .css-gtj3kh { overflow: visible !important; }
      header, nav, button, [role="navigation"], .print-hide { display: none !important; }
    }
  `;
  document.head.appendChild(style);

  // Khung bọc ngoài các thẻ bỏ padding/nền/giới hạn chiều cao để thẻ nằm gọn trên trang;
  // thanh/nút dính cố định trên màn hình (vd. "Made with Gamma") thì ẩn.
  for (const c of cards) {
    for (let el = c.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.hasAttribute('data-print-wrap')) break;
      el.setAttribute('data-print-wrap', '');
    }
  }
  style.textContent += `
    @media print {
      [data-print-wrap] {
        padding: 0 !important;
        margin: 0 !important;
        gap: 0 !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        background: transparent !important;
        display: block !important;
        width: auto !important;
        max-width: none !important;
      }
    }`;
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if ((pos === 'fixed' || pos === 'sticky') && !el.closest('[data-print-card]') &&
        !el.querySelector('[data-print-card]')) el.classList.add('print-hide');
  }

  console.log(`${cards.length} thẻ -> in A4, mỗi thẻ một trang.`);
  if (!window.__GAMMA_NO_PRINT) window.print();
})();
