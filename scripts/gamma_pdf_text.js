/*
 * In trang Gamma (https://gamma.app/embed/...?mode=doc) ra PDF GIỐNG GIAO DIỆN WEB mà vẫn
 * CÓ CHỮ (bôi đen, Ctrl+F, copy được): mỗi thẻ Gamma là một trang PDF đúng khổ của thẻ,
 * không bị cắt ngang giữa thẻ.
 *
 * Vì sao in thường ra toàn ảnh: Chrome chụp thành ẢNH cả khối có `filter` (đổ bóng
 * drop-shadow, làm mờ...), `mix-blend-mode`, `mask`, chữ tô gradient. Thẻ Gamma có mấy thứ
 * đó nên chữ bên trong mất. Script tắt đúng các hiệu ứng đó khi in (giữ nền kính mờ
 * `backdrop-filter`, vì cái này không làm chữ thành ảnh), phần còn lại giữ nguyên.
 *
 * Cách dùng (hộp in):
 *   1. Mở link Gamma trong Chrome/Edge, đợi tải xong.
 *   2. F12 -> Console -> dán toàn bộ file này -> Enter.
 *   3. Hộp in: Đích = "Lưu dưới dạng PDF" (Save as PDF); More settings: BẬT
 *      "Background graphics", Margins = None/Default đều được. Không chọn
 *      "Microsoft Print to PDF" (cái đó in ra ảnh).
 *   4. Mở PDF, Ctrl+F thử một từ.
 *
 * Muốn PDF có MỤC LỤC (bookmark) theo heading thì dùng `scripts/gamma_to_pdf.js` (chạy bằng
 * Node, nó dùng lại file này và bật outline khi xuất).
 */
(async () => {
  const CARD = '.react-renderer.node-card.block.block-card';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1) Cuộn hết trang (cả khung cuộn bên trong) để thẻ và ảnh nào lười tải cũng được vẽ.
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
  await Promise.race([
    Promise.all([...document.images].map(img => img.complete ? null :
      new Promise(r => { img.onload = img.onerror = r; }))),
    sleep(15000),
  ]);

  // 2) Chữ tô gradient (background-clip: text) -> chữ một màu, để không bị in thành ảnh.
  for (const el of document.querySelectorAll(`${CARD} *`)) {
    const cs = getComputedStyle(el);
    if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') {
      const m = cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i);
      el.style.setProperty('background', 'none', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'currentcolor', 'important');
      el.style.setProperty('color', m ? m[0] : '#1a1a1a', 'important');
    }
  }

  // 3) Mỗi thẻ ngoài cùng một trang, khổ trang = bề rộng trang web x (thẻ + khoảng cách tới
  //    thẻ sau). Trang đầu gồm cả phần phía trên thẻ đầu; trang cuối gồm cả phần cuối trang.
  //    Mỗi thẻ một "named page" (`page: gcardN`): Chrome tự ngắt trang khi đổi tên trang.
  const cards = [...document.querySelectorAll(CARD)]
    .filter(c => !c.parentElement.closest(CARD));
  if (!cards.length) {
    console.error('Không thấy thẻ Gamma nào. Trang đã tải xong chưa?');
    return;
  }
  const docEl = document.documentElement;
  const width = Math.ceil(docEl.scrollWidth);
  const top = el => el.getBoundingClientRect().top + window.scrollY;
  // Chrome ngắt trang ở khung bọc ngoài cùng mà thẻ là con đầu tiên của nó, nên đo từ đó
  // (khoảng đệm trên thẻ thuộc trang của thẻ, không phải trang trước).
  const breakAt = c => {
    let el = c;
    while (el.parentElement && el.parentElement !== document.body &&
           el.parentElement.firstElementChild === el) el = el.parentElement;
    return top(el);
  };
  const tops = cards.map(breakAt);
  const end = Math.max(docEl.scrollHeight, document.body.scrollHeight);
  const heights = tops.map((t, i) => Math.ceil((i + 1 < tops.length ? tops[i + 1] : end) - (i ? t : 0)) + 2);

  let pages = `@page { size: ${width}px ${heights[0]}px; margin: 0; }\n`;
  cards.forEach((c, i) => {
    if (i) {
      c.style.setProperty('page', `gcard${i}`);
      pages += `@page gcard${i} { size: ${width}px ${heights[i]}px; margin: 0; }\n`;
    }
  });

  // Nền trang web (màu/ảnh nền theme) để in ra giống trên màn hình.
  const bg = [document.body, docEl].map(e => getComputedStyle(e))
    .find(cs => cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none');

  document.getElementById('fix-print-scale')?.remove();
  const style = document.createElement('style');
  style.id = 'fix-print-scale';
  style.textContent = `
    ${pages}
    @media print {
      html, body {
        width: ${width}px !important;
        ${bg ? `background: ${bg.background} !important;` : ''}
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
      .css-gtj3kh { overflow: visible !important; }
      .gamma-print-hide { display: none !important; }
    }
  `;
  document.head.appendChild(style);

  // Thanh công cụ, nút "Made with Gamma"... dính cố định trên màn hình sẽ lặp ở mọi trang: ẩn.
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if ((pos === 'fixed' || pos === 'sticky') && !el.closest(CARD) &&
        !cards.some(c => el.contains(c))) el.classList.add('gamma-print-hide');
  }

  const canvases = [...document.querySelectorAll(`${CARD} canvas`)]
    .filter(c => c.width * c.height > 40000);
  if (canvases.length) console.warn(`Có ${canvases.length} canvas lớn trong thẻ: phần này sẽ vẫn là ảnh.`);
  console.log(`Số thẻ: ${cards.length} -> ${cards.length} trang, rộng ${width}px.`);

  if (!window.__GAMMA_NO_PRINT) window.print();
})();
