// Xuất PDF bằng chính bộ in của Chrome (Page.printToPDF qua chrome.debugger): chữ thật,
// bookmark theo heading, khổ trang lấy từ CSS (@page) do fit_pages.js đặt cho từng thẻ.
// Trong lúc xuất, Chrome hiện thanh "... started debugging this browser": bình thường,
// thanh đó tự tắt khi xong.

const A4 = { width: 794, height: 1123 };  // 210 x 297 mm ở 96 dpi
const TRIES = 4;                         // in lại tối đa mấy lần nếu thẻ tràn sang trang sau

const send = (target, method, params = {}) =>
  new Promise((resolve, reject) => chrome.debugger.sendCommand(target, method, params, res => {
    const err = chrome.runtime.lastError;
    err ? reject(new Error(err.message)) : resolve(res);
  }));

const run = async (tabId, file) =>
  (await chrome.scripting.executeScript({ target: { tabId }, files: [file] }))[0]?.result;

const setParams = (tabId, width, extra, keepMinH) => chrome.scripting.executeScript({
  target: { tabId },
  func: (w, e, k) => { window.__gfitWidth = w; window.__gfitExtra = e; window.__gfitKeepMinH = k; },
  args: [width, extra, keepMinH],
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chiều cao (pt) từng trang PDF theo thứ tự, đọc từ /MediaBox của mỗi trang.
const pageHeights = b64 =>
  [...atob(b64).matchAll(/\/MediaBox\s*\[\s*0\s+0\s+[\d.]+\s+([\d.]+)\s*\]/g)].map(m => +m[1]);

// Thẻ nào bị tràn: trang thừa có cùng khổ với trang của thẻ ngay trước nó (cùng named page).
function overflowed(heightsPx, pagesPt) {
  const expect = heightsPx.map(h => h * 0.75);
  const over = {};
  let i = 0;
  for (const h of pagesPt) {
    if (i < expect.length && Math.abs(h - expect[i]) < 1) { i++; continue; }
    over[Math.max(0, i - 1)] = (over[Math.max(0, i - 1)] || 0) + 1;
  }
  return over;
}

async function makePdf(tabId, mode = 'web') {
  const prep = await run(tabId, 'scripts/prepare_pdf.js');
  if (!prep || !prep.cards) throw new Error('Không thấy thẻ Gamma nào trên trang này. Trang đã tải xong chưa?');
  // "Như web": trang rộng đúng bằng khung thẻ trên màn hình, cửa sổ cao như đang thấy (JS của
  // Gamma tính chiều cao tối thiểu của thẻ theo cửa sổ). A4: rộng 210mm.
  const web = mode !== 'a4';
  const width = web ? (prep.cardWidth || 1000) : A4.width;
  const viewHeight = web ? (prep.viewHeight || 900) : A4.height;

  const target = { tabId };
  await new Promise((resolve, reject) => chrome.debugger.attach(target, '1.3', () => {
    const err = chrome.runtime.lastError;
    err ? reject(new Error(err.message)) : resolve();
  }));
  try {
    // Đặt đúng điều kiện lúc in (CSS in + cửa sổ rộng bằng trang) và GIỮ tới khi in xong:
    // JS của Gamma dàn lại chữ khi cửa sổ đổi cỡ, nếu trả cửa sổ về trước khi in thì chữ lúc
    // in to hơn lúc đo -> thẻ tràn sang trang sau.
    await send(target, 'Emulation.setEmulatedMedia', { media: 'print' });
    await send(target, 'Emulation.setDeviceMetricsOverride',
      { width, height: viewHeight, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);

    let data, pages, fit;
    const extra = {};
    for (let t = 0; t < TRIES; t++) {
      await setParams(tabId, width, extra, web);
      fit = await run(tabId, 'scripts/fit_pages.js');
      await sleep(300);
      ({ data } = await send(target, 'Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      }));
      const sizes = pageHeights(data);
      pages = sizes.length;
      if (pages <= fit.cards) break;
      // Chỉ nới đúng những thẻ bị tràn (mỗi trang thừa +5%), các trang khác giữ vừa khít.
      for (const [i, n] of Object.entries(overflowed(fit.heights, sizes))) {
        extra[i] = (extra[i] || 0) + 0.05 * n;
      }
    }
    const tab = await chrome.tabs.get(tabId);
    const title = (tab.title || 'gamma').replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';
    return { data, title, cards: fit.cards, pages };
  } finally {
    await send(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await send(target, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
    chrome.debugger.detach(target, () => void chrome.runtime.lastError);
  }
}

async function exportPdf(tabId, mode) {
  const { data, title, cards, pages } = await makePdf(tabId, mode);
  const filename = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
  await chrome.downloads.download({ url: `data:application/pdf;base64,${data}`, filename });
  return { filename, cards, pages };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.cmd !== 'pdf') return false;
  exportPdf(msg.tabId, msg.mode).then(r => reply({ ok: true, ...r }), e => reply({ ok: false, error: e.message }));
  return true;   // trả lời bất đồng bộ
});
