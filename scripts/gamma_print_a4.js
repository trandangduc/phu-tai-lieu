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

  window.print();
})();
