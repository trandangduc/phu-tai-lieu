const status = document.getElementById('status');
const buttons = [...document.querySelectorAll('button')];
const mode = document.getElementById('mode');
try { mode.value = localStorage.getItem('gammaExportMode') || 'web'; } catch {}
mode.onchange = () => { try { localStorage.setItem('gammaExportMode', mode.value); } catch {} };

const say = (text, err = false) => {
  status.textContent = text;
  status.className = err ? 'err' : '';
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function busy(label, job) {
  buttons.forEach(b => { b.disabled = true; });
  say(label);
  try {
    say(await job());
  } catch (e) {
    say(e.message, true);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

document.getElementById('pdf').onclick = () => busy('Đang xuất PDF (cuộn trang, đo từng thẻ)...', async () => {
  const tab = await activeTab();
  const r = await chrome.runtime.sendMessage({ cmd: 'pdf', tabId: tab.id, mode: mode.value });
  if (!r.ok) throw new Error(r.error);
  const warn = r.pages > r.cards ? `\nLưu ý: ${r.pages} trang cho ${r.cards} thẻ (có thẻ vẫn tràn trang).` : '';
  return `Xong: ${r.filename} (${r.cards} thẻ, ${r.pages} trang).${warn}\nMuốn xem lại trang như cũ thì tải lại (F5).`;
});

for (const [id, file, label] of [['word', 'scripts/word.js', 'Word'], ['html', 'scripts/save_html.js', 'HTML']]) {
  document.getElementById(id).onclick = () => busy(`Đang xuất ${label}...`, async () => {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    return `Xong: file ${label} đang được tải về.`;
  });
}
