/*
 * Bước 1/2: lưu trang Gamma (https://gamma.app/embed/...?mode=doc) thành MỘT file HTML tự chứa,
 * giữ giao diện như web và đã sửa sẵn để in ra PDF đẹp.
 * Bước 2: mở file HTML đó trong Chrome -> Ctrl+P -> "Lưu dưới dạng PDF" (bật "Background
 * graphics"), hoặc chạy `node scripts/gamma_to_pdf.js "<file>.html"` để có PDF kèm bookmark.
 *
 * Cách dùng: mở link Gamma, đợi tải xong -> F12 -> Console -> dán file này -> Enter.
 * Trình duyệt tải về `<tên trang>.html`.
 *
 * Những gì được sửa trong file lưu:
 *   - CSS: chép toàn bộ luật CSS đang áp dụng (kể cả luật Gamma chèn bằng JS, thứ mà Ctrl+S
 *     bỏ mất) vào file; bỏ hết <script>.
 *   - Bảng: Gamma có một cột ẩn rộng 0% ở đầu <colgroup>; khi không còn JS của Gamma, ô đầu
 *     tiên rơi vào cột đó và chữ bị xếp mỗi ký tự một dòng. Bỏ cột 0%.
 *   - Trang Gamma cuộn trong một khung cao đúng màn hình (100vh, overflow hidden): mở khung ra
 *     để toàn bộ nội dung nằm trên trang, không bị cắt.
 *   - Thẻ bị kéo cao tối thiểu theo màn hình (min-height): bỏ, để in không dư trang/khoảng trống.
 *   - Bỏ nút, thanh công cụ, huy hiệu "Made with Gamma"... và chế độ sửa (contenteditable).
 *   - CSS in: A4 dọc, mỗi thẻ bắt đầu một trang mới, phóng to 1.18 bằng zoom (không cắt chữ),
 *     thẻ dài chảy sang trang sau; không có hiệu ứng filter làm chữ thành ảnh.
 */
(async () => {
  const CARD = '.react-renderer.node-card.block.block-card';
  const SCALE = 1.18;                     // phóng to khi in (như script cũ)
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1) Cuộn hết mọi khung cuộn để Gamma vẽ đủ các thẻ và tải ảnh.
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
  if (!cards.length) {
    console.error('Không thấy thẻ Gamma nào. Trang đã tải xong chưa?');
    return;
  }

  // 2) Đánh dấu trên trang gốc (để nhận ra lại trong bản sao): khung bọc ngoài thẻ, phần tử
  //    cố định trên màn hình, phần tử bị kéo cao theo màn hình.
  const MARK = 'data-gsave';
  document.querySelectorAll(`[${MARK}]`).forEach(el => el.removeAttribute(MARK));
  const mark = (el, v) => el.setAttribute(MARK, (el.getAttribute(MARK) || '') + ' ' + v);
  for (let el = cards[0].parentElement; el; el = el.parentElement) mark(el, 'open');
  const tall = window.innerHeight * 0.5;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && !el.closest(CARD) &&
        !cards.some(c => el.contains(c))) mark(el, 'hide');
    if (parseFloat(cs.minHeight) >= tall && (el.closest(CARD) || cards.some(c => el.contains(c)))) {
      mark(el, 'nominh');
    }
  }
  cards.forEach((c, i) => mark(c, i ? 'card' : 'card first'));

  // Đo trước chiều cao mỗi thẻ ở khổ in (A4 rộng 794px, zoom z -> bố cục rộng 794/z px).
  // Thẻ vừa trang: zoom SCALE. Chỉ dư một chút (<= FIT_MAX): thu zoom cho vừa khít một trang,
  // khỏi ra trang trắng hay trang chỉ có vài dòng cuối. Dài hẳn: giữ SCALE, chảy sang trang sau.
  const PAGE_W = 794, PAGE_H = 1123 - 6, FIT_MAX = 1.35;
  const heightAt = (c, z) => {
    const old = c.style.cssText;
    c.style.cssText += `;width:${PAGE_W / z}px !important;max-width:none !important;min-height:0 !important`;
    const body = c.querySelector('.card-body');
    const oldBody = body && body.style.minHeight;
    if (body) body.style.setProperty('min-height', '0', 'important');
    const h = c.getBoundingClientRect().height;
    c.style.cssText = old;
    if (body) { body.style.removeProperty('min-height'); if (oldBody) body.style.minHeight = oldBody; }
    return h;
  };
  const zooms = cards.map(c => {
    const h = heightAt(c, SCALE) * SCALE;
    if (h <= PAGE_H || h > PAGE_H * FIT_MAX) return SCALE;
    let z = SCALE * PAGE_H / h;
    for (let k = 0; k < 4 && heightAt(c, z) * z > PAGE_H; k++) z *= 0.97;
    return +z.toFixed(4);
  });
  cards.forEach((c, i) => c.setAttribute('data-gzoom', zooms[i]));

  // 3) Toàn bộ CSS đang áp dụng. Stylesheet khác nguồn (font Google...) không đọc được luật
  //    thì giữ nguyên thẻ <link>.
  let css = '';
  const links = [];
  for (const sheet of document.styleSheets) {
    try {
      css += [...sheet.cssRules].map(r => r.cssText).join('\n') + '\n';
    } catch {
      if (sheet.href) links.push(`<link rel="stylesheet" href="${sheet.href}">`);
    }
  }

  // 4) Bản sao DOM đã làm sạch.
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('script, noscript, link[rel="stylesheet"], style, link[rel="preload"], link[rel="modulepreload"], iframe')
    .forEach(el => el.remove());
  root.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
  root.querySelectorAll('colgroup col').forEach(col => {
    if (/^\s*width:\s*0(%|px)?;?\s*$/.test(col.getAttribute('style') || '')) col.remove();
  });
  root.querySelectorAll('.card-divider, button').forEach(el => el.remove());
  // Đường dẫn ảnh/link tuyệt đối, để file mở ở đâu cũng thấy ảnh.
  root.querySelectorAll('img').forEach(img => {
    const live = img.getAttribute('src');
    if (live) img.setAttribute('src', new URL(live, location.href).href);
    img.removeAttribute('srcset');
    img.removeAttribute('loading');
  });
  root.querySelectorAll('a[href]').forEach(a => a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href));

  const fix = `
    /* --- gamma_save_html.js --- */
    html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
    [${MARK}~="open"] {
      height: auto !important; max-height: none !important; min-height: 0 !important;
      overflow: visible !important;
    }
    [${MARK}~="nominh"] { min-height: 0 !important; }
    /* Thân thẻ có min-height cố định bằng px tính theo màn hình (vd. 1269px): ở khổ A4 cao hơn
       cả trang -> thẻ ngắn cũng bị kéo dài, ra trang trắng. */
    [${MARK}~="card"] .card-body { min-height: 0 !important; }
    [${MARK}~="hide"] { display: none !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { background: #fff !important; }
      *, *::before, *::after {
        filter: none !important;
        mix-blend-mode: normal !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      [${MARK}~="card"] {
        zoom: ${SCALE};
        transform: none !important;
        break-before: page;
        margin: 0 !important;
      }
      [${MARK}~="first"] { break-before: auto; }
      ${[...new Set(zooms)].filter(z => z !== SCALE)
        .map(z => `[data-gzoom="${z}"] { zoom: ${z}; }`).join('\n      ')}
      [${MARK}~="card"] h1, [${MARK}~="card"] h2, [${MARK}~="card"] h3, [${MARK}~="card"] h4 {
        break-after: avoid; break-inside: avoid;
      }
      [${MARK}~="card"] tr, [${MARK}~="card"] img { break-inside: avoid; }
    }
  `;

  const title = document.title.replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';
  const head = root.querySelector('head');
  head.insertAdjacentHTML('afterbegin', `<meta charset="utf-8"><base href="${location.href}">`);
  head.insertAdjacentHTML('beforeend', `${links.join('\n')}\n<style>${css}</style>\n<style>${fix}</style>`);
  const html = '<!DOCTYPE html>\n' + root.outerHTML;
  document.querySelectorAll(`[${MARK}]`).forEach(el => el.removeAttribute(MARK));

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Đã lưu ${cards.length} thẻ -> ${a.download} (${Math.round(html.length / 1024)} KB). ` +
    'Mở file đó trong Chrome -> Ctrl+P -> Lưu dưới dạng PDF.');
})();
