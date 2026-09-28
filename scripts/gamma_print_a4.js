(() => {
  document.getElementById('fix-print-rag')?.remove();
  document.getElementById('fix-print-scale')?.remove();

  const style = document.createElement('style');
  style.id = 'fix-print-rag';
  style.innerHTML = `
    @media print {
      @page {
        size: A4 portrait;
        margin: 0 !important;
      }
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        overflow: visible !important;
      }
      div[data-card-id], .card, section, article {
        page-break-before: always !important;
        page-break-after: always !important;
        break-before: page !important;
        break-after: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        height: 100vh !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: center !important;
      }
      header, nav, button, [role="navigation"] {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  const style2 = document.createElement('style');
  style2.id = 'fix-print-scale';
  style2.textContent = `
    @media print {
      .react-renderer.node-card.block.block-card {
        transform: scale(1.18) !important;
        transform-origin: center center !important;
      }

      .css-gtj3kh {
        overflow: visible !important;
      }
    }
  `;
  document.head.appendChild(style2);

  // --- Thêm: áp dụng cho mọi loại thẻ Gamma (ngắn, dài, có bảng, nhiều cột) ---
  // 1) Bộ chọn chung ở trên chỉ trúng một số thẻ, nên có thẻ không được ngắt trang mà bắt đầu
  //    ngay cuối trang trước. Ở đây ngắt trang trực tiếp ở từng thẻ Gamma ngoài cùng.
  // 2) transform: scale() không được tính khi ngắt trang -> chữ vắt qua mép trang bị cắt đôi.
  //    Dùng zoom (có tính vào bố cục) để phóng to 1.18: ngắt trang đúng, không cắt chữ.
  // 3) Khung bọc ngoài thẻ (section/article/data-card-id...) mà bị quy tắc chung ở trên đặt
  //    100vh + flex + ngắt trang: thẻ dài tràn khỏi khung đè lên thẻ sau, hai lệnh ngắt trang
  //    cộng lại ra trang trắng. Gỡ các thứ đó ở khung, để chỉ thẻ Gamma ngắt trang.
  // 4) Thẻ dài hơn một trang: cho nội dung chảy sang trang sau.
  // 5) Khoảng trống lớn ở đầu trang: Chrome dời chỗ ngắt trang lên khung bọc mà thẻ là con đầu
  //    tiên, nên padding/margin trên của khung đó bị đẩy xuống đầu trang mới. Bỏ các khoảng đó
  //    khi in.
  // 6) Thẻ Gamma (hoặc khung trong thẻ) cao tối thiểu theo màn hình (vh). Khi in vh = cả trang
  //    A4, nên thẻ ngắn cũng cao hơn 1 trang: chân thẻ (logo + số trang) tràn sang trang mới,
  //    nội dung căn giữa để lại khoảng trống lớn trên tiêu đề. Bỏ các chiều cao đó khi in.
  // 7) Quy tắc section/article 100vh + ngắt trang ở trên còn trúng cả khung không chứa thẻ ->
  //    trang trắng. Trang Gamma thì gỡ quy tắc đó cho MỌI section/article/...
  const CARD = '.react-renderer.node-card.block.block-card';
  const SCALE = 1.18;
  const PAGE_W = 794, PAGE_H = 1123;      // A4 ở 96 dpi
  const WRAP = 'div[data-card-id], .card, section, article';
  const MARKS = ['print-card', 'print-first', 'print-long', 'print-wrap', 'print-lead', 'print-nominh'];
  document.querySelectorAll(MARKS.map(m => '.' + m).join(','))
    .forEach(el => el.classList.remove(...MARKS));
  const cards = [...document.querySelectorAll(CARD)].filter(c => !c.parentElement.closest(CARD));
  if (cards.length) document.querySelectorAll(WRAP).forEach(el => el.classList.add('print-wrap'));
  // Chiều cao theo màn hình (min-height, hoặc height đặt cứng) từ nửa màn hình trở lên, trong
  // thẻ và các khung bọc ngoài thẻ.
  const tall = window.innerHeight * 0.5;
  const stretched = el => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.minHeight) >= tall ||
      (/px$/.test(el.style.height || '') && parseFloat(el.style.height) >= tall);
  };
  for (const card of cards) {
    for (const el of [card, ...card.querySelectorAll('*')]) {
      if (stretched(el)) el.classList.add('print-nominh');
    }
    for (let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
      if (stretched(el)) el.classList.add('print-nominh');
    }
  }
  cards.forEach((card, i) => {
    card.classList.add('print-card');
    if (i === 0) card.classList.add('print-first');
    for (let el = card; el.parentElement && el.parentElement !== document.body &&
         el.parentElement.firstElementChild === el; el = el.parentElement) {
      el.parentElement.classList.add('print-lead');
    }
    const r = card.getBoundingClientRect();
    // Khi in, thẻ co lại còn (khổ A4 / zoom) nên chữ xuống dòng nhiều hơn -> cao hơn.
    const printH = r.height * Math.max(1, r.width / (PAGE_W / SCALE)) * SCALE;
    if (printH <= PAGE_H - 20) return;
    card.classList.add('print-long');
  });

  const style3 = document.createElement('style');
  style3.id = 'fix-print-long';
  style3.textContent = `
    @media print {
      ${CARD}.print-card {
        transform: none !important;
        zoom: ${SCALE};
        break-before: page !important;
        page-break-before: always !important;
        max-width: 100% !important;
        margin-top: 0 !important;
        min-height: 0 !important;
      }
      .print-nominh {
        min-height: 0 !important;
        height: auto !important;
      }
      .print-lead {
        padding-top: 0 !important;
        margin-top: 0 !important;
      }
      ${CARD}.print-card.print-first {
        break-before: auto !important;
        page-break-before: auto !important;
      }
      ${CARD}.print-card.print-long {
        height: auto !important;
        min-height: 0 !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
      }
      .print-wrap {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        break-before: auto !important;
        break-after: auto !important;
        break-inside: auto !important;
        page-break-before: auto !important;
        page-break-after: auto !important;
        page-break-inside: auto !important;
        display: block !important;
      }
      .print-card h1, .print-card h2, .print-card h3, .print-card h4 {
        break-after: avoid !important;
        break-inside: avoid !important;
      }
      .print-card tr, .print-card img { break-inside: avoid !important; }
    }
  `;
  document.getElementById('fix-print-long')?.remove();
  document.head.appendChild(style3);

  window.print();
})();
