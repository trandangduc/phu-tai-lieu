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

  // --- Thêm cho thẻ DÀI hơn một trang A4 (vd. Module 3: bảng + mục dài) ---
  // scale(1.18) + height:100vh chỉ hợp với thẻ ngắn; thẻ dài bị phóng to đè qua mép trang và
  // cắt ngang tiêu đề. Thẻ dài: bỏ scale/100vh/avoid để nội dung chảy sang trang sau.
  // Thẻ ngắn giữ nguyên như trên.
  const PAGE_W = 794, PAGE_H = 1123;      // A4 ở 96 dpi
  const WRAP = 'div[data-card-id], .card, section, article';
  document.querySelectorAll('.print-long, .print-long-wrap')
    .forEach(el => el.classList.remove('print-long', 'print-long-wrap'));
  document.querySelectorAll('.react-renderer.node-card.block.block-card').forEach(card => {
    if (card.parentElement.closest('.react-renderer.node-card.block.block-card')) return;
    const r = card.getBoundingClientRect();
    // Khi in, thẻ hẹp lại còn khổ A4 nên chữ xuống dòng nhiều hơn -> cao hơn trên màn hình.
    const printH = r.height * Math.max(1, r.width / PAGE_W);
    if (printH * 1.18 <= PAGE_H) return;
    card.classList.add('print-long');
    for (let el = card; el && el !== document.body; el = el.parentElement) {
      if (el.matches(WRAP)) el.classList.add('print-long-wrap');
    }
  });

  const style3 = document.createElement('style');
  style3.id = 'fix-print-long';
  style3.textContent = `
    @media print {
      .print-long, .print-long-wrap {
        transform: none !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
      }
      .print-long-wrap { display: block !important; }
      .print-long h1, .print-long h2, .print-long h3, .print-long h4 {
        break-after: avoid !important;
        break-inside: avoid !important;
      }
      .print-long tr, .print-long img { break-inside: avoid !important; }
    }
  `;
  document.getElementById('fix-print-long')?.remove();
  document.head.appendChild(style3);

  window.print();
})();
