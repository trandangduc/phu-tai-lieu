/*
 * Chuẩn bị trang Gamma đang mở để xuất PDF (chạy trước fit_pages.js):
 *   - cuộn hết các khung cuộn để Gamma vẽ đủ thẻ và tải ảnh;
 *   - mở khung cuộn cao đúng màn hình (100vh, overflow hidden/auto) để in đủ nội dung;
 *   - khi in: trả bề rộng trang về khổ giấy (CSS in của Gamma ép body 1200px); ẩn thanh công cụ/nút/huy hiệu cố định, tắt filter/blend (Chrome chụp chúng thành
 *     ảnh làm mất chữ), giữ màu nền.
 * Trả về số thẻ, bề rộng khung thẻ và chiều cao cửa sổ đang thấy.
 */
(async () => {
  const CARD = '.react-renderer.node-card.block.block-card';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const scrollers = new Set([document.scrollingElement]);
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 &&
        /(auto|scroll)/.test(getComputedStyle(el).overflowY)) scrollers.add(el);
  }
  for (const el of scrollers) {
    for (let y = 0; y < el.scrollHeight; y += el.clientHeight * 0.8) {
      el.scrollTop = y;
      await sleep(200);
    }
    el.scrollTop = 0;
  }
  await Promise.race([
    Promise.all([...document.images].map(img => img.complete ? null :
      new Promise(r => { img.onload = img.onerror = r; }))),
    sleep(15000),
  ]);

  const cards = [...document.querySelectorAll(CARD)].filter(c => !c.parentElement.closest(CARD));
  if (!cards.length) return { cards: 0 };
  // Bề rộng khung thẻ và chiều cao cửa sổ như người dùng đang thấy: khổ "Như web" dùng để
  // mỗi trang PDF đúng bằng khung thẻ trên màn hình.
  const body0 = cards[0].querySelector('.card-body') || cards[0];
  const cardWidth = Math.round(body0.getBoundingClientRect().width);
  const viewHeight = window.innerHeight;

  document.querySelectorAll('[data-gprep]').forEach(el => el.removeAttribute('data-gprep'));
  for (let el = cards[0].parentElement; el; el = el.parentElement) el.setAttribute('data-gprep', 'open');
  // Phần nằm sau thẻ cuối (chân trang, nút...) sẽ thành một trang trắng: ẩn khi in.
  for (let el = cards[cards.length - 1]; el && el !== document.body; el = el.parentElement) {
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (!sib.hasAttribute('data-gprep')) sib.setAttribute('data-gprep', 'hide');
    }
  }
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if ((pos === 'fixed' || pos === 'sticky') && !el.closest(CARD) &&
        !cards.some(c => el.contains(c))) el.setAttribute('data-gprep', 'hide');
  }

  document.getElementById('gamma-prepare-pdf')?.remove();
  const style = document.createElement('style');
  style.id = 'gamma-prepare-pdf';
  style.textContent = `
    @media print {
      /* CSS in của Gamma ép body rộng 1200px rồi Chrome thu cả trang cho vừa giấy (chữ còn
         ~66%): trả về bề rộng trang giấy. */
      html, html body { height: auto !important; min-height: 0 !important; overflow: visible !important;
        width: auto !important; min-width: 0 !important; max-width: none !important; }
      [data-gprep="open"] {
        height: auto !important; max-height: none !important; min-height: 0 !important;
        overflow: visible !important; width: auto !important; min-width: 0 !important;
        /* .document-content là phần tử flex không co (rộng 858px > giấy 794px): tràn ra hai bên
           và Chrome thu cả trang cho vừa -> chữ nhỏ, trang dư khoảng trắng. Ép co vừa giấy. */
        margin-left: 0 !important; margin-right: 0 !important;
        flex-shrink: 1 !important; max-width: 100% !important;
      }
      /* Thẻ phủ kín trang: bỏ khoảng đệm quanh thẻ, khung thẻ rộng bằng trang. */
      ${CARD} .card-wrapper { padding: 0 !important; }
      ${CARD} .card-body { width: 100% !important; max-width: 100% !important; margin: 0 !important;
        flex: 1 1 auto !important; border-radius: 0 !important; box-shadow: none !important; }
      /* Bảng Gamma cố định % bề rộng cột; ở khổ giấy cột hẹp bị ngắt giữa từ ("Freque ncy").
         Cho bảng tự chia cột theo nội dung, chỉ ngắt ở khoảng trắng. */
      ${CARD} table { table-layout: auto !important; }
      ${CARD} td, ${CARD} th { overflow-wrap: normal !important; word-break: normal !important; }
      [data-gprep="hide"], .card-divider, ${CARD} button { display: none !important; }
      *, *::before, *::after {
        filter: none !important;
        mix-blend-mode: normal !important;
        animation: none !important;
        transition: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
  document.head.appendChild(style);
  return { cards: cards.length, cardWidth, viewHeight };
})();
