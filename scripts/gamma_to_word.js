/*
 * Tải nội dung trang Gamma (https://gamma.app/embed/...?mode=doc) về thành file Word (.doc)
 * SỬA ĐƯỢC: chữ, tiêu đề, danh sách, bảng, ảnh giữ nguyên thứ tự các thẻ.
 *
 * PDF (kể cả PDF có chữ) không phải để sửa; muốn sửa nội dung thì dùng file này.
 *
 * Cách dùng:
 *   1. Mở link Gamma trong Chrome/Edge, đợi tải xong.
 *   2. F12 -> Console -> dán toàn bộ file này -> Enter.
 *   3. Trình duyệt tải về `<tên trang>.doc`. Mở bằng Word; Word có thể hỏi về định dạng,
 *      bấm Yes. Muốn file .docx thật: File -> Save As -> Word Document (*.docx).
 *      Muốn PDF có chữ: File -> Save As -> PDF.
 */
(async () => {
  const CARD = '.react-renderer.node-card.block.block-card';

  // Cuộn hết trang (cả khung cuộn bên trong) để Gamma vẽ đủ các thẻ.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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

  // Chỉ giữ thẻ ngoài cùng (thẻ lồng trong thẻ sẽ nằm sẵn trong thẻ cha).
  const cards = [...document.querySelectorAll(CARD)]
    .filter(c => !c.parentElement.closest(CARD));
  if (!cards.length) {
    console.error('Không thấy thẻ Gamma nào. Trang đã tải xong chưa?');
    return;
  }

  const KEEP = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'TABLE',
    'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'BR',
    'IMG', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'SUB', 'SUP']);

  // Word mở .doc dạng HTML thường theo mã Windows-1252, làm chữ ngoài ASCII (’ – • tiếng Việt)
  // thành "â€™", "Ã¡". Đổi hết sang mã số HTML (&#8217;) thì bảng mã nào cũng ra đúng chữ.
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[^\x00-\x7f]/gu, c => `&#${c.codePointAt(0)};`);

  // Chép cây DOM thành HTML sạch: bỏ class/style/div bọc ngoài, giữ cấu trúc văn bản.
  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      return esc(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return '';
    if (['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName.toUpperCase())) return '';
    if (node.getAttribute('contenteditable') === 'false' && !node.textContent.trim() &&
        !node.querySelector('img')) return '';

    const tag = node.tagName.toUpperCase();
    if (tag === 'IMG') {
      const src = node.currentSrc || node.src;
      if (!src || src.startsWith('data:image/svg')) return '';
      const w = Math.min(node.getBoundingClientRect().width || 400, 600);
      return `<img src="${src}" width="${Math.round(w)}" alt="${esc(node.alt || '')}">`;
    }
    const inner = [...node.childNodes].map(clean).join('');
    if (!KEEP.has(tag)) {
      // Div bọc ngoài: bỏ thẻ, nhưng giữ ngắt dòng nếu nó là khối.
      return cs.display.startsWith('inline') || !inner.trim() ? inner : `<div>${inner}</div>`;
    }
    if (tag === 'A') return `<a href="${node.href}">${inner}</a>`;
    if (tag === 'TD' || tag === 'TH') {
      const span = ['colspan', 'rowspan'].map(a => node.getAttribute(a) ? ` ${a}="${node.getAttribute(a)}"` : '').join('');
      return `<${tag}${span}>${inner}</${tag}>`;
    }
    if (['BR', 'HR'].includes(tag)) return `<${tag}>`;
    return `<${tag}>${inner}</${tag}>`;
  };

  const body = cards.map(c => `<section>${clean(c)}</section>`)
    .join('<br clear="all" style="page-break-before:always">');
  const title = document.title.replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${esc(title)}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
    img { max-width: 100%; }
  </style></head>
  <body>${body}</body></html>`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Đã xuất ${cards.length} thẻ ra ${a.download}`);
})();
