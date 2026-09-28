/*
 * Mỗi thẻ Gamma = một trang PDF: rộng bằng A4 (794px), cao VỪA ĐÚNG thẻ (không bó vào chiều
 * cao A4) -> không còn trang trắng, không cắt ngang thẻ, không có trang chỉ có vài dòng cuối.
 *
 * Chạy trong trang SAU khi đã bật chế độ in (Emulation.setEmulatedMedia print) và đặt bề rộng
 * cửa sổ bằng A4 (Emulation.setDeviceMetricsOverride width 794): cỡ chữ Gamma tính theo bề
 * rộng cửa sổ (vw), nên phải đo đúng như lúc in. Thẻ được đặt zoom in cuối cùng rồi mới đo;
 * mỗi thẻ một "named page" (`@page gfitN { size: 794px <cao>px }`), Chrome tự ngắt trang khi
 * đổi tên trang.
 * Chạy lại nhiều lần được. Trả về số thẻ và chiều cao các trang.
 */
(() => {
  const CARD = '.react-renderer.node-card.block.block-card';
  // Không phóng to thêm: trang đã dàn đúng khổ A4 (prepare_pdf.js bỏ body 1200px của Gamma),
  // chữ đã to hơn ~1.5 lần so với in mặc định. zoom > 1 làm thẻ rộng hơn trang, bị cắt mép.
  const SCALE = 1;
  const PAGE_W = 794;          // A4 rộng 210mm ở 96 dpi
  const SLACK = 4;             // chừa vài px cho làm tròn, khỏi tràn ra trang trắng
  const MAX_H = 19000;         // PDF giới hạn trang ~200 inch; thẻ dài hơn thì chia trang

  document.getElementById('gamma-fit-pages')?.remove();
  document.querySelectorAll('[data-gfit]').forEach(el => el.removeAttribute('data-gfit'));

  let cards = [...document.querySelectorAll('[data-gsave~="card"]')];
  if (!cards.length) cards = [...document.querySelectorAll(CARD)].filter(c => !c.parentElement.closest(CARD));

  // Gamma đặt cho thân thẻ một min-height cố định bằng px, tính theo màn hình lúc mở trang
  // (vd. 1269px): phải bỏ trước khi đo, nếu không thẻ ngắn cũng cao như màn hình.
  const base = document.createElement('style');
  base.id = 'gamma-fit-pages';
  // Ẩn thanh cuộn khi đo: nó chiếm ~15px bề ngang, chữ xuống dòng nhiều hơn lúc in -> đo dư.
  base.textContent = `html { scrollbar-width: none !important; } html::-webkit-scrollbar { display: none !important; }
    @media print { ${CARD} .card-body { min-height: 0 !important; } }`;
  const SEL = i => `${CARD}[data-gfit="${i}"]`;
  document.head.appendChild(base);

  cards.forEach((c, i) => c.setAttribute('data-gfit', i));
  // Bộ chọn đủ mạnh để thắng CSS in cũ còn sót (vd. `.react-renderer.node-card... { zoom: 1.08 !important }`).
  const zoomCss = `${CARD}[data-gfit], [data-gfit] { zoom: ${SCALE} !important; width: auto !important; margin: 0 !important;` +
    ' break-before: auto !important; page-break-before: auto !important; break-inside: auto !important; }';
  base.textContent += `\n@media print { ${zoomCss} }`;
  // getBoundingClientRect đã tính cả zoom -> chiều cao thật trên trang in.
  const heights = cards.map(c => Math.min(MAX_H, Math.ceil(c.getBoundingClientRect().height) + SLACK));

  let css = `@page { size: ${PAGE_W}px ${heights[0] || 1123}px; margin: 0; }\n@media print {\n`;
  cards.forEach((c, i) => {
    if (!i) return;
    css = `@page gfit${i} { size: ${PAGE_W}px ${heights[i]}px; margin: 0; }\n` + css;
    css += `  ${SEL(i)} { page: gfit${i}; }\n`;
  });
  css += '}\n';
  base.textContent += '\n' + css;
  return { cards: cards.length, heights };
})();
