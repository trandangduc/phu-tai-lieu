/*
 * Bước 1/2 của Gamma -> PowerPoint: lấy nội dung + bố cục các thẻ Gamma ra file JSON.
 * Bước 2: `python scripts/gamma_json_to_pptx.py <file>.json` -> <file>.pptx (sửa được).
 *
 * Cách dùng:
 *   1. Mở link Gamma (https://gamma.app/embed/...?mode=doc) trong Chrome/Edge, đợi tải xong.
 *   2. F12 -> Console -> dán toàn bộ file này -> Enter.
 *   3. Trình duyệt tải về `<tên trang>.gamma.json` (ảnh nằm sẵn trong đó).
 */
(async () => {
  const CARD = '.react-renderer.node-card.block.block-card';
  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,img';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Cuộn hết trang (cả khung cuộn bên trong) để Gamma vẽ đủ các thẻ và ảnh.
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
  await sleep(800);

  const visible = el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  const color = c => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && +m[4] === 0)) return null;
    return [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  };
  const style = el => {
    const cs = getComputedStyle(el);
    return {
      size: parseFloat(cs.fontSize),
      bold: +cs.fontWeight >= 600,
      italic: cs.fontStyle === 'italic',
      underline: cs.textDecorationLine.includes('underline'),
      color: color(cs.webkitTextFillColor) || color(cs.color) || '000000',
      font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
    };
  };

  // Chữ của một khối -> các đoạn (run) cùng kiểu; <br> thành xuống dòng.
  const runs = root => {
    const out = [];
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, ' ');
        if (text.trim() || (text && out.length)) {
          const a = node.parentElement.closest('a');
          out.push({ text, ...style(node.parentElement), link: a ? a.href : null });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
      if (node.tagName === 'BR') { out.push({ text: '\n', ...style(node.parentElement) }); return; }
      if (['BUTTON', 'SCRIPT', 'STYLE', 'svg'].includes(node.tagName)) return;
      // Danh sách con nằm trong <li> sẽ được lấy thành khối riêng.
      if (node !== root && /^(UL|OL|TABLE)$/.test(node.tagName)) return;
      node.childNodes.forEach(walk);
    };
    walk(root);
    if (out.length) out[0].text = out[0].text.trimStart();
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.trimEnd();
    return out.filter(r => r.text);
  };

  const imageData = async img => {
    const src = img.currentSrc || img.src;
    if (!src) return null;
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    } catch {
      return src;                     // bị CORS chặn: để Python tự tải theo URL
    }
  };

  const cards = [...document.querySelectorAll(CARD)]
    .filter(c => !c.parentElement.closest(CARD) && visible(c));
  const out = [];
  for (const card of cards) {
    const cr = card.getBoundingClientRect();
    const bg = color(getComputedStyle(card).backgroundColor);
    const blocks = [];
    for (const el of card.querySelectorAll(BLOCK)) {
      if (!visible(el)) continue;
      // Khối nằm trong khối khác (p trong li, p trong ô bảng...) đã được khối ngoài lấy.
      const outer = el.parentElement.closest(BLOCK);
      if (outer && card.contains(outer) && !(el.tagName === 'LI' && outer.tagName === 'LI')) continue;

      const r = el.getBoundingClientRect();
      const box = { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
      const tag = el.tagName.toLowerCase();

      if (tag === 'img') {
        if (r.width < 16 || r.height < 16) continue;
        const data = await imageData(el);
        if (data) blocks.push({ type: 'img', ...box, src: data });
      } else if (tag === 'table') {
        const rows = [...el.rows].map(tr => [...tr.cells].map(td => ({
          runs: runs(td), colspan: td.colSpan || 1, rowspan: td.rowSpan || 1,
          fill: color(getComputedStyle(td).backgroundColor),
        })));
        blocks.push({ type: 'table', ...box, rows });
      } else {
        const rs = runs(el);
        if (!rs.length) continue;
        const cs = getComputedStyle(el);
        const block = { type: tag, ...box, runs: rs, align: cs.textAlign, lineHeight: parseFloat(cs.lineHeight) || null };
        if (tag === 'li') {
          const list = el.parentElement;
          block.ordered = list.tagName === 'OL';
          block.index = [...list.children].indexOf(el) + (+list.getAttribute('start') || 1);
          block.level = el.parentElement.closest('li') ? 1 : 0;
          // Chữ bắt đầu sau dấu đầu dòng: dùng vị trí thực của chữ thay vì của <li>.
          block.textX = el.getBoundingClientRect().left - cr.left;
        }
        blocks.push(block);
      }
    }
    out.push({ width: cr.width, height: cr.height, background: bg, blocks });
  }

  if (!out.length) {
    console.error('Không thấy thẻ Gamma nào. Trang đã tải xong chưa?');
    return;
  }
  const title = document.title.replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ title, cards: out })], { type: 'application/json' }));
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.gamma.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Đã lấy ${out.length} thẻ -> ${a.download}. Bước 2: python scripts/gamma_json_to_pptx.py "${a.download}"`);
})();
