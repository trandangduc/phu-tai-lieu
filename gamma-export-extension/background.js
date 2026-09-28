// Xuất PDF bằng chính bộ in của Chrome (Page.printToPDF qua chrome.debugger): chữ thật,
// bookmark theo heading, khổ trang lấy từ CSS (@page) do fit_pages.js đặt cho từng thẻ.
// Trong lúc xuất, Chrome hiện thanh "... started debugging this browser": bình thường,
// thanh đó tự tắt khi xong.

const send = (target, method, params = {}) =>
  new Promise((resolve, reject) => chrome.debugger.sendCommand(target, method, params, res => {
    const err = chrome.runtime.lastError;
    err ? reject(new Error(err.message)) : resolve(res);
  }));

const run = async (tabId, file) =>
  (await chrome.scripting.executeScript({ target: { tabId }, files: [file] }))[0]?.result;

async function makePdf(tabId) {
  const cards = await run(tabId, 'scripts/prepare_pdf.js');
  if (!cards) throw new Error('Không thấy thẻ Gamma nào trên trang này. Trang đã tải xong chưa?');

  const target = { tabId };
  await new Promise((resolve, reject) => chrome.debugger.attach(target, '1.3', () => {
    const err = chrome.runtime.lastError;
    err ? reject(new Error(err.message)) : resolve();
  }));
  try {
    // Đo với đúng điều kiện lúc in: CSS in + cửa sổ rộng bằng A4 (Gamma dùng đơn vị vw).
    await send(target, 'Emulation.setEmulatedMedia', { media: 'print' });
    await send(target, 'Emulation.setDeviceMetricsOverride',
      { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 500));
    const fit = await run(tabId, 'scripts/fit_pages.js');
    await send(target, 'Emulation.clearDeviceMetricsOverride');
    await send(target, 'Emulation.setEmulatedMedia', { media: '' });
    const { data } = await send(target, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: true,
      generateTaggedPDF: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    });
    const tab = await chrome.tabs.get(tabId);
    const title = (tab.title || 'gamma').replace(/\s*[|–-]\s*Gamma.*$/i, '').trim() || 'gamma';
    return { data, title, cards: fit.cards };
  } finally {
    chrome.debugger.detach(target, () => void chrome.runtime.lastError);
  }
}

async function exportPdf(tabId) {
  const { data, title, cards } = await makePdf(tabId);
  const filename = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
  await chrome.downloads.download({ url: `data:application/pdf;base64,${data}`, filename });
  return { filename, cards };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.cmd !== 'pdf') return false;
  exportPdf(msg.tabId).then(r => reply({ ok: true, ...r }), e => reply({ ok: false, error: e.message }));
  return true;   // trả lời bất đồng bộ
});
