"use strict";
// Chat Tài Liệu — giao diện một trang, không build step.
// Trích dẫn kiểu AnythingLLM: [n] trong câu trả lời -> nút; rê chuột thấy đoạn trích +
// số trang; bấm thì mở tài liệu ở khung phải và TÔ SÁNG đúng đoạn đó.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const md = (s) => DOMPurify.sanitize(marked.parse(s ?? "", {breaks: true}));

const state = {sessionId: null, messages: [], busy: false};

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function renderMath(el) {
  if (!window.renderMathInElement) return;
  try {
    renderMathInElement(el, {
      delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}],
      throwOnError: false, ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch (_) { /* công thức hỏng thì để nguyên chữ */ }
}

// ------------------------------------------------------------------ trích dẫn
const chuan = (s) => String(s || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");
const RX_CITE = /\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g;

function trangCite(c, dai = false) {
  if (!c || !c.page) return "";
  const t = c.page_end ? `${c.page}–${c.page_end}` : `${c.page}`;
  return (dai ? "Trang " : "tr. ") + t;
}

function soTrongNgoac(s) {
  const out = [];
  for (const phan of s.split(/\s*[,;]\s*/)) {
    const ab = phan.split(/\s*[–-]\s*/).map(Number);
    const a = ab[0], b = ab[ab.length - 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (let k = a; k <= Math.min(b, a + 20); k++) if (!out.includes(k)) out.push(k);
  }
  return out;
}

// Đổi "[n]" trong chữ đã render thành nút (bỏ qua code/liên kết).
function linkCitations(body, m) {
  const byN = new Map((m.citations || []).map((c) => [c.n, c]));
  if (!byN.size) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest("code,pre,a,button,.katex"))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) if ((walker.currentNode.nodeValue || "").includes("[")) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const s = node.nodeValue;
    let last = 0, doi = false;
    const frag = document.createDocumentFragment();
    for (const mm of s.matchAll(RX_CITE)) {
      const ns = soTrongNgoac(mm[1]).filter((n) => byN.has(n));
      if (!ns.length) continue;
      frag.append(s.slice(last, mm.index));
      for (const n of ns) frag.append(citeBtn(byN.get(n)));
      last = mm.index + mm[0].length;
      doi = true;
    }
    if (!doi) continue;
    frag.append(s.slice(last));
    node.replaceWith(frag);
  }
}

function citeBtn(c) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cite-ref";
  b.textContent = c.n;
  b.setAttribute("aria-label", `Nguồn ${c.n}: ${c.doc} ${trangCite(c)}`);
  hookPop(b, c);
  return b;
}

function hookPop(el, c) {
  el.addEventListener("mouseenter", () => showPop(el, c));
  el.addEventListener("mouseleave", () => hidePop());
  el.addEventListener("focus", () => showPop(el, c));
  el.addEventListener("blur", () => hidePop());
  el.addEventListener("click", (e) => { e.preventDefault(); hidePop(true); openCitation(c); });
}

let pop = null, popTimer = null;
function showPop(anchor, c) {
  clearTimeout(popTimer);
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "cite-pop";
    pop.addEventListener("mouseenter", () => clearTimeout(popTimer));
    pop.addEventListener("mouseleave", () => hidePop());
    document.body.appendChild(pop);
  }
  const trang = trangCite(c);
  const muc = c.section && c.section !== "(đầu tài liệu)" ? c.section : "";
  pop.innerHTML =
    `<div class="pop-head"><span class="n-badge">${esc(c.n)}</span>`
    + `<span class="pop-doc">${esc(c.doc)}</span>`
    + (trang ? `<span class="page-badge">${esc(trang)}</span>` : "") + `</div>`
    + (muc ? `<div class="pop-sec">§ ${esc(muc)}</div>` : "")
    + `<div class="pop-quote">${esc(c.quote || "")}</div>`
    + `<div class="pop-foot">Bấm để mở đoạn này trong tài liệu</div>`;
  pop.onclick = () => { hidePop(true); openCitation(c); };
  pop.style.display = "block";
  const r = anchor.getBoundingClientRect();
  const w = Math.min(420, window.innerWidth - 24);
  pop.style.width = w + "px";
  pop.style.left = Math.max(12, Math.min(r.left - 20, window.innerWidth - w - 12)) + "px";
  const h = pop.offsetHeight;
  pop.style.top = ((r.bottom + 8 + h > window.innerHeight) ? Math.max(8, r.top - h - 8) : r.bottom + 8) + "px";
}
function hidePop(now = false) {
  clearTimeout(popTimer);
  const an = () => { if (pop) pop.style.display = "none"; };
  if (now) an(); else popTimer = setTimeout(an, 180);
}

// MO TA ANH do AI viet (buoc caption luc nap tai lieu) -> khoi thu gon, TACH khoi chu cua
// tai lieu goc. Ban cu cua buoc caption DON ca mo ta thanh MOT dong (`*   a *   b`), nen
// hien thanh mot buc tuong chu tho voi dau `*` tran — khoi phuc lai danh sach truoc khi render.
function khoiPhucDong(s) {
  return s
    .replace(/(\s+)(\*|\d{1,2}\.)(\s{2,})(?=\S)/g,
             (m, sp, mk) => "\n" + " ".repeat(Math.max(0, sp.replace(/\n/g, "").length - 1)) + mk + " ")
    .replace(/[ \t]{2,}(?=\*\*)/g, "\n\n")
    .trim();
}
function lamDepMoTaAnh(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^>\s*\*\*\[Mô tả hình ảnh\]\*\*\s?(.*)$/);
    if (!m) { out.push(lines[i]); continue; }
    const body = [m[1]];
    while (i + 1 < lines.length && /^>/.test(lines[i + 1])) body.push(lines[++i].replace(/^>\s?/, ""));
    out.push("", '<details class="ai-caption"><summary>Mô tả ảnh do AI tạo — không phải chữ của tài liệu</summary>',
             "", khoiPhucDong(body.join("\n")), "", "</details>", "");
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ khung tài liệu
const docCache = new Map();

async function openDoc(path, c = null) {
  const pane = $("#doc-pane");
  pane.hidden = false;
  const head = $("#doc-header"), cont = $("#doc-content");
  try {
    let text = docCache.get(path);
    if (text === undefined) {
      const r = await fetch(`/api/docs/file?path=${encodeURIComponent(path)}`);
      if (!r.ok) throw new Error(r.status === 404 ? "tài liệu đã bị xoá" : `lỗi ${r.status}`);
      text = await r.text();
      docCache.set(path, text);
    }
    const ten = c ? c.doc : path.split("/")[0];
    let trang = "";
    if (c) trang = c.page ? `<span class="page-badge">${esc(trangCite(c, true))}</span>`
      : `<span class="page-badge none" title="${c.co_trang ? "Không định vị được trang của đoạn này" : "Tài liệu không có dữ liệu trang"}">không rõ trang</span>`;
    head.innerHTML = `<div class="doc-head-row">${c ? `<span class="n-badge">${esc(c.n)}</span>` : ""}`
      + `<strong>${esc(ten)}</strong>${trang}</div>`
      + (c && c.section && c.section !== "(đầu tài liệu)" ? `<div class="doc-sec">§ ${esc(c.section)}</div>` : "");
    const baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    cont.innerHTML = md(lamDepMoTaAnh(text));
    renderMath(cont);
    cont.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (src && !/^(https?:|data:|\/)/i.test(src)) {
        img.src = `/api/docs/image?path=${encodeURIComponent((baseDir ? baseDir + "/" : "") + src)}`;
      }
      img.loading = "lazy";
    });
    if (c) requestAnimationFrame(() => highlight(cont, c));
    else cont.scrollTop = 0;
  } catch (e) {
    head.innerHTML = `<strong class="err">Không mở được: ${esc(e.message)}</strong>`;
    cont.innerHTML = "";
  }
}

function openCitation(c) { return openDoc(c.source_path, c); }

// Tô sáng ĐÚNG đoạn đã trích: ghép chữ chuẩn hoá của các khối cấp cao nhất, tìm mốc đầu
// (và mốc cuối) trong chuỗi ghép rồi đổi ngược ra khối. Ghép thay vì xét từng khối vì
// đoạn trích hay mở đầu bằng một dòng ngắn rồi mới tới bảng — mốc đầu vắt qua hai khối.
function highlight(cont, c) {
  cont.querySelectorAll(".cite-hl").forEach((e) => e.classList.remove("cite-hl"));
  const blocks = Array.from(cont.children);
  const texts = blocks.map((b) => chuan(b.textContent));
  const starts = [];
  let acc = "";
  for (const t of texts) { starts.push(acc.length); acc += t; }
  const khoiTai = (pos) => {
    let k = 0;
    for (let i = 0; i < starts.length; i++) { if (starts[i] > pos) break; if (texts[i]) k = i; }
    return k;
  };
  let tu = 0;
  const want = chuan(c.section);
  if (want) {
    const i = blocks.findIndex((b, j) => /^H[1-6]$/.test(b.tagName) && texts[j] === want);
    if (i >= 0) tu = starts[i];
  }
  const dau = chuan(c.neo_dau);
  let p = -1, key = "";
  for (const k of [dau.slice(0, 60), dau.slice(0, 30), dau.slice(0, 14)]) {
    if (k.length < 6) continue;
    p = acc.indexOf(k, tu);
    if (p < 0 && tu) p = acc.indexOf(k);
    if (p >= 0) { key = k; break; }
  }
  if (p < 0) { cont.scrollTop = 0; return false; }
  const s = khoiTai(p);
  let e = khoiTai(p + key.length - 1);
  const cuoi = chuan(c.neo_cuoi).slice(-30);
  if (cuoi.length >= 6) {
    const q = acc.indexOf(cuoi, p);
    if (q >= 0) { const j = khoiTai(q + cuoi.length - 1); if (j >= e && j - s < 80) e = j; }
  }
  for (let i = s; i <= e; i++) {
    blocks[i].classList.add("cite-hl");
    if (blocks[i].tagName === "DETAILS") blocks[i].open = true;
  }
  const top = blocks[s].getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop - 16;
  cont.scrollTo({top: Math.max(0, top), behavior: "smooth"});
  return true;
}

// ------------------------------------------------------------------ chat
function renderMsg(m) {
  const div = document.createElement("div");
  div.className = "msg " + m.role;
  const body = document.createElement("div");
  body.className = "msg-body";
  if (m.role === "assistant") {
    if (!m.content && m.streaming) {
      body.innerHTML = `<span class="typing">Đang tìm trong tài liệu…</span>`;
    } else {
      body.innerHTML = md(m.content);
      if (!m.streaming) renderMath(body);
      linkCitations(body, m);
    }
  } else {
    body.textContent = m.content;
  }
  div.appendChild(body);
  if (m.role === "assistant" && !m.streaming && (m.citations || []).length) {
    const f = document.createElement("div");
    f.className = "sources";
    const lab = document.createElement("span");
    lab.className = "src-label";
    lab.textContent = m.citations.some((c) => c.cited !== false) ? "Nguồn:" : "Tham khảo:";
    f.appendChild(lab);
    for (const c of m.citations) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "src-chip";
      const trang = trangCite(c);
      chip.innerHTML = `<span class="n-badge">${esc(c.n)}</span><span class="src-doc">${esc(c.doc)}</span>`
        + (trang ? `<span class="page-badge">${esc(trang)}</span>` : "");
      hookPop(chip, c);
      f.appendChild(chip);
    }
    div.appendChild(f);
  }
  if (m.error) {
    const e = document.createElement("div");
    e.className = "err";
    e.textContent = m.error;
    div.appendChild(e);
  }
  return div;
}

function render() {
  const log = $("#chat-log");
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  log.innerHTML = "";
  if (!state.messages.length) {
    log.innerHTML = `<div class="empty"><h2>Hỏi bất cứ điều gì về tài liệu của bạn</h2>`
      + `<p>Mỗi ý trong câu trả lời có số <span class="cite-ref demo">1</span> — rê chuột để xem đoạn gốc và số trang, bấm để mở đúng chỗ đó trong tài liệu.</p></div>`;
    return;
  }
  for (const m of state.messages) log.appendChild(renderMsg(m));
  if (stick) log.scrollTop = log.scrollHeight;
}

async function send(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  $("#btn-send").disabled = true;
  state.messages.push({role: "user", content: text});
  const asst = {role: "assistant", content: "", citations: [], streaming: true};
  state.messages.push(asst);
  render();
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({message: text, session_id: state.sessionId}),
    });
    if (!r.ok || !r.body) throw new Error(`${r.status} ${await r.text()}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", pending = false;
    const flush = () => { pending = false; render(); };
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (raw.match(/^event: (.*)$/m) || [])[1];
        const data = (raw.match(/^data: (.*)$/m) || [])[1];
        if (!ev || data === undefined) continue;
        const p = JSON.parse(data);
        if (ev === "session") state.sessionId = p.session_id;
        else if (ev === "citations") asst.citations = p.citations || [];
        else if (ev === "chunk") asst.content += p.text;
        else if (ev === "error") asst.error = p.error;
        else if (ev === "done") asst.id = p.message_id;
        if (!pending) { pending = true; requestAnimationFrame(flush); }
      }
    }
  } catch (e) {
    asst.error = "Lỗi: " + e.message;
  } finally {
    asst.streaming = false;
    state.busy = false;
    $("#btn-send").disabled = false;
    render();
    loadSessions();
  }
}

// ------------------------------------------------------------------ thanh bên
async function loadSessions() {
  const {sessions} = await api("/api/sessions").catch(() => ({sessions: []}));
  const ul = $("#sess-list");
  ul.innerHTML = "";
  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = s.id === state.sessionId ? "active" : "";
    li.innerHTML = `<span class="li-main">${esc(s.title || "(không tên)")}</span>`
      + `<button class="li-del" title="Xoá cuộc hội thoại" aria-label="Xoá">✕</button>`;
    li.querySelector(".li-main").onclick = () => openSession(s.id);
    li.querySelector(".li-del").onclick = async () => {
      await fetch(`/api/sessions/${s.id}`, {method: "DELETE"});
      if (state.sessionId === s.id) newChat();
      loadSessions();
    };
    ul.appendChild(li);
  }
}

async function openSession(sid) {
  const {messages} = await api(`/api/sessions/${sid}`);
  state.sessionId = sid;
  state.messages = messages;
  render();
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  loadSessions();
}

function newChat() {
  state.sessionId = null;
  state.messages = [];
  render();
  loadSessions();
  $("#input").focus();
}

async function loadDocs() {
  const {docs} = await api("/api/docs").catch(() => ({docs: []}));
  $("#doc-count").textContent = docs.length ? `(${docs.length})` : "";
  const ul = $("#doc-list");
  ul.innerHTML = "";
  for (const d of docs) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="li-main" title="${esc(d.source_path)}">${esc(d.doc)}`
      + (d.co_trang ? "" : ` <span class="tag" title="Tài liệu không có dữ liệu trang">không trang</span>`)
      + `</span><button class="li-del" title="Xoá tài liệu" aria-label="Xoá">✕</button>`;
    li.querySelector(".li-main").onclick = () => openDoc(d.source_path);
    li.querySelector(".li-del").onclick = async () => {
      if (!confirm(`Xoá tài liệu "${d.doc}" khỏi kho?`)) return;
      await fetch(`/api/docs/${encodeURIComponent(d.doc)}`, {method: "DELETE"});
      docCache.delete(d.source_path);
      loadDocs();
    };
    ul.appendChild(li);
  }
}

async function upload(files) {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  let jobs;
  try { ({jobs} = await api("/api/upload", {method: "POST", body: fd})); }
  catch (e) { alert("Tải lên lỗi: " + e.message); return; }
  const box = $("#jobs");
  for (const j of jobs) {
    const el = document.createElement("div");
    el.className = "job";
    box.appendChild(el);
    const poll = async () => {
      let s;
      try { s = await api(`/api/upload/${j.id}`); } catch (_) { el.remove(); return; }
      el.innerHTML = `<span class="job-name">${esc(s.filename)}</span>`
        + `<span class="job-st ${s.status}">${esc(s.status === "failed" ? s.error : s.stage)}</span>`;
      if (s.status === "done") {
        el.querySelector(".job-st").textContent = `xong · ${s.so_doan} đoạn · ${s.seconds}s`
          + (s.co_trang ? "" : " · không có số trang");
        loadDocs();
        setTimeout(() => el.remove(), 6000);
      } else if (s.status !== "failed") setTimeout(poll, 1500);
    };
    poll();
  }
}

async function loadHealth() {
  const h = await api("/api/health").catch(() => null);
  const el = $("#health");
  if (!h) { el.innerHTML = `<span class="dot bad"></span>Server không phản hồi`; return; }
  el.innerHTML = `<span class="dot ${h.llm ? "ok" : "bad"}"></span>LLM ${esc(h.llm_model)}`
    + ` · <span class="dot ${h.embed ? "ok" : "bad"}"></span>Embedding`
    + ` · MinerU ${esc(h.mineru_tier)}`;
}

// ------------------------------------------------------------------ khởi động
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#input").value;
  $("#input").value = "";
  send(t);
});
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
});
$("#btn-new").onclick = newChat;
$("#btn-close-doc").onclick = () => { $("#doc-pane").hidden = true; };
$("#file-input").addEventListener("change", (e) => { upload([...e.target.files]); e.target.value = ""; });
const drop = $("#drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload([...e.dataTransfer.files]); });

render();
loadSessions();
loadDocs();
loadHealth();
setInterval(loadHealth, 30000);
