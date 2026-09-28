/*
 * Xuất trang Gamma ra PDF giống giao diện web, CÓ CHỮ (Ctrl+F, copy được) và CÓ MỤC LỤC
 * (bookmark) theo heading, không cần hộp in. Dùng lại `gamma_pdf_text.js` để sửa trang
 * trước khi in, rồi xuất bằng Chrome/Edge có sẵn trên máy.
 *
 * Cài một lần (cần Node.js 18+ và Chrome hoặc Edge):
 *   npm install playwright-core
 *
 * Chạy:
 *   node scripts/gamma_to_pdf.js "https://gamma.app/embed/...?mode=doc" [ten_file.pdf]
 *
 * Nếu Gamma/Cloudflare bắt xác minh "Verify you are human": script mở cửa sổ Chrome, bạn bấm
 * xác minh xong nó tự làm tiếp (hồ sơ trình duyệt lưu ở thư mục tạm, lần sau không hỏi lại).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const CARD = '.react-renderer.node-card.block.block-card';
// UA giống Chrome thường (headless mặc định có chữ "HeadlessChrome", dễ bị Cloudflare chặn).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';
const PROFILE = path.join(os.tmpdir(), 'gamma-to-pdf-profile');
const FIX = fs.readFileSync(path.join(__dirname, 'gamma_pdf_text.js'), 'utf8');

async function open(url, headless) {
  const opts = {
    headless,
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  };
  let ctx;
  for (const channel of process.env.CHROME_PATH ? [undefined] : ['chrome', 'msedge']) {
    try {
      ctx = await chromium.launchPersistentContext(PROFILE, { ...opts, channel });
      break;
    } catch (e) {
      if (channel === 'msedge' || channel === undefined) throw e;
    }
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return { ctx, page };
}

(async () => {
  const [url, outArg] = process.argv.slice(2);
  if (!url) {
    console.error('Cách dùng: node scripts/gamma_to_pdf.js "<link gamma>" [ten_file.pdf]');
    process.exit(1);
  }

  let { ctx, page } = await open(url, true);
  const ready = ms => page.waitForSelector(CARD, { timeout: ms }).then(() => true, () => false);
  if (!await ready(45000)) {
    // Bị chặn/xác minh: mở cửa sổ thật cho người dùng qua bước xác minh, rồi chạy lại ẩn.
    await ctx.close();
    console.log('Gamma đòi xác minh. Hãy hoàn tất trong cửa sổ Chrome vừa mở (tối đa 5 phút)...');
    ({ ctx, page } = await open(url, false));
    if (!await ready(300000)) throw new Error('Không thấy nội dung Gamma sau 5 phút.');
    await ctx.close();
    ({ ctx, page } = await open(url, true));
    if (!await ready(60000)) throw new Error('Vẫn không tải được trang ở chế độ ẩn.');
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  page.on('console', m => console.log('  trang:', m.text()));

  await page.evaluate(`window.__GAMMA_NO_PRINT = true; ${FIX}`);
  const title = (await page.title()).replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';
  const out = outArg || `${title.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;

  await page.pdf({
    path: out,
    printBackground: true,
    preferCSSPageSize: true,   // khổ từng trang = khổ từng thẻ (đặt trong gamma_pdf_text.js)
    outline: true,             // bookmark theo h1..h6
    tagged: true,              // PDF có cấu trúc (heading, đoạn) cho trình đọc/tìm kiếm
  });
  await ctx.close();
  console.log(`Xong: ${path.resolve(out)}`);
})().catch(e => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});
