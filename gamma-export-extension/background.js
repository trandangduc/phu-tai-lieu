// Xuất PDF bằng chính bộ in của Chrome (Page.printToPDF qua chrome.debugger): chữ thật,
// bookmark theo heading, khổ trang lấy từ CSS (@page) do fit_pages.js đặt cho từng thẻ.
// Trong lúc xuất, Chrome hiện thanh "... started debugging this browser": bình thường,
// thanh đó tự tắt khi xong.

const WIDTHS = { web: 1200, a4: 794 };   // "Như web" = bề rộng Gamma tự dùng khi in; A4 = 210mm
const TRIES = 4;                         // in lại tối đa mấy lần nếu thẻ tràn sang trang sau

const send = (target, method, params = {}) =>
  new Promise((resolve, reject) => chrome.debugger.sendCommand(target, method, params, res => {
    const err = chrome.runtime.lastError;
    err ? reject(new Error(err.message)) : resolve(res);
  }));

const run = async (tabId, file) =>
  (await chrome.scripting.executeScript({ target: { tabId }, files: [file] }))[0]?.result;

const setParams = (tabId, width, extra) => chrome.scripting.executeScript({
  target: { tabId },
  func: (w, e) => { window.__gfitWidth = w; window.__gfitExtra = e; },
  args: [width, extra],
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Số trang trong PDF (Skia ghi mỗi trang một đối tượng "/Type /Page").
const countPages = b64 => (atob(b64).match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

async function makePdf(tabId, mode = 'web') {
  const width = WIDTHS[mode] || WIDTHS.web;
  const cards = await run(tabId, 'scripts/prepare_pdf.js');
  if (!cards) throw new Error('Không thấy thẻ Gamma nào trên trang này. Trang đã tải xong chưa?');

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
      { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);

    let data, pages, fit, extra = 0;
    for (let t = 0; t < TRIES; t++) {
      await setParams(tabId, width, extra);
      fit = await run(tabId, 'scripts/fit_pages.js');
      await sleep(300);
      ({ data } = await send(target, 'Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      }));
      pages = countPages(data);
      if (pages <= fit.cards) break;
      extra += 0.04;                     // có thẻ tràn: cho mọi trang cao thêm rồi in lại
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
