/*
 * Tải nội dung trang Gamma (https://gamma.app/embed/...?mode=doc) về thành file Word (.doc)
 * SỬA ĐƯỢC, và mở hộp in để lưu cùng nội dung đó ra PDF CÓ CHỮ (bôi đen, tìm, copy được).
 * Chữ, tiêu đề, danh sách, bảng, ảnh giữ nguyên thứ tự các thẻ; mỗi thẻ một trang.
 *
 * Cách dùng:
 *   1. Mở link Gamma trong Chrome/Edge, đợi tải xong.
 *   2. F12 -> Console -> dán toàn bộ file này -> Enter.
 *   3. Trình duyệt tải về `<tên trang>.doc`. Mở bằng Word; Word có thể hỏi về định dạng,
 *      bấm Yes. Muốn file .docx thật: File -> Save As -> Word Document (*.docx).
 *   4. Sau đó hộp in tự mở: Đích = "Lưu dưới dạng PDF" (Save as PDF) -> Lưu.
 *      Không chọn "Microsoft Print to PDF". Hộp in không mở (bị chặn) thì trong Word:
 *      File -> Save As -> PDF cũng ra PDF có chữ.
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

  // Chân thẻ (logo + số trang) lặp lại ở mọi thẻ: bỏ đi. Nhận ra bằng ảnh có mặt ở từ nửa
  // số thẻ trở lên, rồi leo lên khung bọc lớn nhất quanh ảnh mà chỉ chứa ảnh/số trang.
  const skip = new Set();
  const seen = new Map();
  for (const c of cards) {
    for (const src of new Set([...c.querySelectorAll('img')].map(i => i.currentSrc || i.src))) {
      seen.set(src, (seen.get(src) || 0) + 1);
    }
  }
  const repeated = src => cards.length > 2 && seen.get(src) >= cards.length / 2;
  for (const c of cards) {
    for (const img of c.querySelectorAll('img')) {
      if (!repeated(img.currentSrc || img.src)) continue;
      let el = img;
      while (el.parentElement && el.parentElement !== c &&
             /^\s*\d*\s*$/.test(el.parentElement.textContent) &&
             !el.parentElement.querySelector('h1,h2,h3,h4,h5,h6,table,ul,ol')) {
        el = el.parentElement;
      }
      skip.add(el);
    }
  }

  // Word mở .doc dạng HTML thường theo mã Windows-1252, làm chữ ngoài ASCII (’ – • tiếng Việt)
  // thành "â€™", "Ã¡". Đổi hết sang mã số HTML (&#8217;) thì bảng mã nào cũng ra đúng chữ.
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[^\x00-\x7f]/gu, c => `&#${c.codePointAt(0)};`);

  // Chép cây DOM thành HTML sạch: bỏ class/style/div bọc ngoài, giữ cấu trúc văn bản.
  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      return esc(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE || skip.has(node)) return '';
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
    if (tag === 'OL' || tag === 'UL') {
      // Gamma vẽ mỗi mục đánh số thành một <ol> riêng, số "1." "2." là một <div> ngay sau <li>.
      // Word sẽ đánh lại 1. cho từng <ol> rồi in thêm cái <div> số đó -> số sai, thừa.
      // Chỉ giữ <li>; lấy số trong <div> làm start để Word đánh đúng số.
      const items = [...node.children].filter(ch => ch.tagName === 'LI').map(clean).join('');
      const mark = [...node.children].filter(ch => ch.tagName !== 'LI')
        .map(ch => ch.textContent.trim().match(/^(\d+)[.)]?$/)).find(Boolean);
      const start = tag === 'OL' && (mark ? +mark[1] : node.start);
      return items ? `<${tag}${start && start !== 1 ? ` start="${start}"` : ''}>${items}</${tag}>` : '';
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
  const PDF = true;                        // false: chỉ tải file Word, không mở hộp in
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
  if (!PDF) return;

  // PDF: in cùng nội dung sạch trong một iframe riêng. Không còn hiệu ứng kính mờ/filter của
  // Gamma nên Chrome in ra chữ thật, không chụp thành ảnh.
  const printHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { margin: 16mm 18mm; }
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
    section + section { break-before: page; }
    h1, h2, h3, h4 { break-after: avoid; }
    table { border-collapse: collapse; width: 100%; }
    tr, img, li { break-inside: avoid; }
    td, th { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
    img { max-width: 100%; height: auto; }
    a { color: inherit; }
  </style></head>
  <body>${cards.map(c => `<section>${clean(c)}</section>`).join('')}</body></html>`;

  document.getElementById('gamma-pdf-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'gamma-pdf-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = printHtml;
  await new Promise(r => { frame.onload = r; });
  // Đợi ảnh tải xong (tối đa 15 giây) để PDF không bị ô ảnh trống.
  await Promise.race([
    Promise.all([...frame.contentDocument.images].map(img => img.complete ? null :
      new Promise(r => { img.onload = img.onerror = r; }))),
    sleep(15000),
  ]);
  document.title = title;                  // tên gợi ý của file PDF
  frame.contentWindow.focus();
  frame.contentWindow.print();
})();
