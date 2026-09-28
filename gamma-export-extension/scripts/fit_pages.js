/*
 * Mỗi thẻ Gamma = một trang PDF: rộng PAGE_W, cao VỪA ĐÚNG thẻ (không bó vào chiều cao A4)
 * -> không có trang trắng, không cắt ngang thẻ, không có trang chỉ có vài dòng cuối.
 *
 * background.js chạy file này khi trang đang ở đúng điều kiện in, và GIỮ nguyên điều kiện đó
 * tới lúc in xong:
 *   - Emulation.setEmulatedMedia print: đo với CSS in;
 *   - Emulation.setDeviceMetricsOverride width = PAGE_W: cỡ chữ Gamma tính theo bề rộng cửa
 *     sổ (vw) và JS của Gamma dàn lại chữ khi cửa sổ đổi cỡ, nên phải đo ở đúng bề rộng in.
 * Tham số (đặt trước khi chạy, cùng "isolated world" của extension):
 *   window.__gfitWidth  bề rộng trang, px (mặc định 794 = A4);
 *   window.__gfitExtra  { chỉ số thẻ: tỉ lệ } bù chiều cao cho thẻ bị tràn ở lần in trước;
 *   window.__gfitKeepMinH  true (khổ "Như web"): giữ chiều cao tối thiểu của thẻ như trên web.
 *                          false (A4): bỏ, vì nó tính theo màn hình và làm thẻ ngắn cao vống.
 * Mỗi thẻ một "named page" (`@page gfitN { size: W H }`); Chrome tự ngắt trang khi đổi tên.
 * Chạy lại nhiều lần được. Trả về số thẻ và chiều cao các trang.
 */
(() => {
  const CARD = '.react-renderer.node-card.block.block-card';
  const PAGE_W = window.__gfitWidth || 794;
  const EXTRA = window.__gfitExtra || {};       // { chỉ số thẻ: tỉ lệ bù } cho thẻ bị tràn lần trước
  const KEEP_MINH = !!window.__gfitKeepMinH;    // "Như web": giữ chiều cao tối thiểu của thẻ
  const SLACK = 2;             // chừa 2px cho làm tròn
  const MAX_H = 19000;         // PDF giới hạn trang ~200 inch

  document.getElementById('gamma-fit-pages')?.remove();
  document.querySelectorAll('[data-gfit]').forEach(el => el.removeAttribute('data-gfit'));

  let cards = [...document.querySelectorAll('[data-gsave~="card"]')];
  if (!cards.length) cards = [...document.querySelectorAll(CARD)].filter(c => !c.parentElement.closest(CARD));

  const base = document.createElement('style');
  base.id = 'gamma-fit-pages';
  // Thanh cuộn chiếm ~15px bề ngang lúc đo (lúc in thì không) -> chữ xuống dòng khác: ẩn đi.
  // Thân thẻ có min-height cố định bằng px tính theo màn hình (vd. 1269px): bỏ.
  base.textContent = `html { scrollbar-width: none !important; } html::-webkit-scrollbar { display: none !important; }
    @media print {
      ${KEEP_MINH ? '' : `${CARD} .card-body { min-height: 0 !important; }`}
      ${CARD}[data-gfit], [data-gfit] { zoom: 1 !important; width: auto !important; margin: 0 !important;
        break-before: auto !important; page-break-before: auto !important; break-inside: auto !important; }
    }`;
  document.head.appendChild(base);
  cards.forEach((c, i) => c.setAttribute('data-gfit', i));

  const heights = cards.map((c, i) => {
    const h = c.getBoundingClientRect().height;
    const e = EXTRA[i] || 0;
    return Math.min(MAX_H, Math.ceil(h * (1 + e)) + SLACK + (e ? 16 : 0));
  });

  const SEL = i => `${CARD}[data-gfit="${i}"]`;
  let pages = `@page { size: ${PAGE_W}px ${heights[0] || 1123}px; margin: 0; }\n`;
  let named = '';
  cards.forEach((c, i) => {
    if (!i) return;
    pages += `@page gfit${i} { size: ${PAGE_W}px ${heights[i]}px; margin: 0; }\n`;
    named += `  ${SEL(i)} { page: gfit${i}; }\n`;
  });
  base.textContent += `\n${pages}@media print {\n${named}}\n`;
  return { cards: cards.length, heights, width: PAGE_W };
})();
