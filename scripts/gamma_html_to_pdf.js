/*
 * Bước 2/2: chuyển file HTML lưu bằng `gamma_save_html.js` sang PDF (A4, chữ thật, bookmark
 * theo heading), không cần hộp in.
 *
 * Cài một lần (cần Node.js 18+ và Chrome hoặc Edge):
 *   npm install playwright-core
 * Chạy (PowerShell / Command Prompt, không phải Console trình duyệt):
 *   node scripts/gamma_html_to_pdf.js "CID+ Study Guide - Module 3.html" [ten_file.pdf]
 *
 * Trước khi in, script đo từng thẻ ở đúng khổ A4: thẻ vừa trang giữ zoom 1.18; thẻ chỉ dư
 * một chút thì thu nhỏ cho vừa khít một trang (khỏi ra trang trắng hay trang chỉ có vài dòng
 * cuối); thẻ dài hẳn thì chảy sang trang sau.
 */
if (typeof require === 'undefined') {
  throw new Error('File này chạy bằng Node trong terminal, không dán vào Console.');
}
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const SCALE = 1.18;          // zoom khi in (như gamma_save_html.js)
const FIT_MAX = 1.35;        // thẻ dài tới 1.35 trang thì thu cho vừa 1 trang

async function launch() {
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
  for (const channel of process.env.CHROME_PATH ? [undefined] : ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ ...opts, channel });
    } catch (e) {
      if (channel !== 'chrome') throw e;
    }
  }
}

(async () => {
  const [input, outArg] = process.argv.slice(2);
  if (!input || !fs.existsSync(input)) {
    console.error('Cách dùng: node scripts/gamma_html_to_pdf.js "<file>.html" [ten_file.pdf]');
    process.exit(1);
  }
  const out = outArg || input.replace(/\.html?$/i, '') + '.pdf';

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pathToFileURL(path.resolve(input)).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });   // đo với đúng CSS in

  const info = await page.evaluate(({ SCALE, FIT_MAX }) => {
    const PAGE_W = 794, PAGE_H = 1123 - 24;      // A4 ở 96 dpi, chừa 24px cho làm tròn
    // Gamma đặt cho thân thẻ một min-height cố định bằng px, tính theo màn hình lúc mở trang
    // (vd. 1269px). Ở khổ A4 nó cao hơn cả trang -> thẻ ngắn cũng bị kéo dài, ra trang trắng.
    const base = document.createElement('style');
    base.textContent = '.card-body { min-height: 0 !important; }';
    document.head.appendChild(base);
    let cards = [...document.querySelectorAll('[data-gsave~="card"]')];
    if (!cards.length) {
      const CARD = '.react-renderer.node-card.block.block-card';
      cards = [...document.querySelectorAll(CARD)].filter(c => !c.parentElement.closest(CARD));
    }
    const heightAt = (c, z) => {
      const old = c.style.cssText;
      c.style.cssText += `;zoom:1 !important;width:${PAGE_W / z}px !important;max-width:none !important;min-height:0 !important`;
      const h = c.getBoundingClientRect().height;
      c.style.cssText = old;
      return h;
    };
    let fitted = 0;
    const css = cards.map((c, i) => {
      const h = heightAt(c, SCALE) * SCALE;
      let z = SCALE;
      if (h > PAGE_H && h <= PAGE_H * FIT_MAX) {
        z = SCALE * PAGE_H / h;
        for (let k = 0; k < 4 && heightAt(c, z) * z > PAGE_H; k++) z *= 0.97;
        fitted++;
      }
      c.setAttribute('data-pdf-card', i);
      return `[data-pdf-card="${i}"] { zoom: ${z.toFixed(4)} !important; }`;
    }).join('\n');
    const style = document.createElement('style');
    style.textContent = `@media print {\n${css}\n}`;
    document.head.appendChild(style);
    return { cards: cards.length, fitted };
  }, { SCALE, FIT_MAX });

  await page.pdf({
    path: out,
    printBackground: true,
    preferCSSPageSize: true,   // A4, lề 0 (đặt trong file HTML)
    outline: true,             // bookmark theo h1..h6
    tagged: true,
  });
  await browser.close();
  console.log(`Xong: ${path.resolve(out)} (${info.cards} thẻ, ${info.fitted} thẻ được thu vừa 1 trang)`);
})().catch(e => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});
