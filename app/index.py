"""Index tài liệu: Markdown -> đoạn -> SQLite (FTS5 + vector) -> truy hồi lai (RRF).

Một bảng `sections` duy nhất; `sections_fts` là FTS5 external-content trỏ vào nó, và
`vectors` giữ embedding float32. Xoá một tài liệu thì phải xoá TAY ở cả ba chỗ: FTS5
external-content không tự xoá theo, và ON DELETE CASCADE chỉ chạy khi bật
`PRAGMA foreign_keys` trong đúng connection đang xoá (bẫy đã dính ở repo gốc).
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config, llm

_H_RX = re.compile(r"^(#{1,2})\s+(.+?)\s*#*\s*$")
PREAMBLE = "(đầu tài liệu)"


@dataclass
class Section:
    id: int
    doc: str            # tên tài liệu (= tên thư mục/stem)
    section: str
    source_path: str    # tương đối với DOCS_DIR
    line_start: int
    text: str
    score: float = 0.0


# ---------------------------------------------------------------------------
# Cắt đoạn
# ---------------------------------------------------------------------------

def _blocks(body: str) -> list[tuple[str, str]]:
    """Tách thân một mục thành khối ('table' | 'prose'). Bảng không bao giờ bị cắt giữa."""
    lines = body.split("\n")
    out: list[tuple[str, str]] = []
    prose: list[str] = []

    def flush():
        text = "\n".join(prose).strip()
        prose.clear()
        for para in re.split(r"\n\s*\n", text):
            if para.strip():
                out.append(("prose", para.strip()))

    i, n = 0, len(lines)
    while i < n:
        ln = lines[i].lstrip()
        if ln.startswith("|"):
            j = i
            while j < n and lines[j].lstrip().startswith("|"):
                j += 1
            if j - i >= 2:
                flush()
                out.append(("table", "\n".join(lines[i:j]).strip()))
                i = j
                continue
        if ln.startswith("<table"):
            j = i
            while j < n and "</table>" not in lines[j]:
                j += 1
            flush()
            out.append(("table", "\n".join(lines[i:j + 1]).strip()))
            i = j + 1
            continue
        prose.append(lines[i])
        i += 1
    flush()
    return out


def _hard_split(text: str, size: int, overlap: int) -> list[str]:
    out, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        out.append(text[start:end])
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return out


def chunk(body: str) -> list[str]:
    body = body.strip()
    size = config.CHUNK_MAX_CHARS
    if len(body) <= size:
        return [body] if body else []
    chunks, buf, blen = [], [], 0

    def flush():
        nonlocal blen
        if buf:
            chunks.append("\n\n".join(buf).strip())
            buf.clear()
            blen = 0

    for kind, text in _blocks(body):
        if kind == "table":
            flush()
            chunks.append(text)
            continue
        if len(text) > size:
            flush()
            chunks.extend(_hard_split(text, size, config.CHUNK_OVERLAP))
            continue
        if blen + len(text) > size:
            flush()
        buf.append(text)
        blen += len(text) + 2
    flush()
    return [c for c in chunks if c.strip()]


def parse_markdown(md_path: Path) -> list[tuple[str, int, str]]:
    """[(tiêu đề mục, dòng bắt đầu, đoạn)] — ranh giới mục là heading # và ##."""
    lines = md_path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: list[tuple[str, int, str]] = []
    heading, start, cur = PREAMBLE, 1, []

    def flush():
        for c in chunk("\n".join(cur)):
            out.append((heading, start, c))

    for i, ln in enumerate(lines, 1):
        m = _H_RX.match(ln)
        if m:
            flush()
            heading, start, cur = m.group(2).strip(), i, []
        else:
            cur.append(ln)
    flush()
    return out


# ---------------------------------------------------------------------------
# Lưu trữ
# ---------------------------------------------------------------------------

def connect() -> sqlite3.Connection:
    config.ensure_dirs()
    conn = sqlite3.connect(config.INDEX_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc TEXT NOT NULL,
        section TEXT,
        source_path TEXT NOT NULL,
        line_start INTEGER,
        text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sec_path ON sections(source_path);
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
        text, section, doc,
        content='sections', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS vectors (
        section_id INTEGER PRIMARY KEY,
        vec BLOB NOT NULL
    );
    """)
    return conn


def _rel(md_path: Path) -> str:
    return md_path.resolve().relative_to(config.DOCS_DIR.resolve()).as_posix()


def remove_doc(conn: sqlite3.Connection, source_path: str) -> int:
    ids = [r[0] for r in conn.execute(
        "SELECT id FROM sections WHERE source_path=?", (source_path,))]
    for sid in ids:
        row = conn.execute("SELECT text, section, doc FROM sections WHERE id=?", (sid,)).fetchone()
        conn.execute("INSERT INTO sections_fts(sections_fts, rowid, text, section, doc) "
                     "VALUES('delete', ?, ?, ?, ?)", (sid, row[0], row[1], row[2]))
        conn.execute("DELETE FROM vectors WHERE section_id=?", (sid,))
    conn.execute("DELETE FROM sections WHERE source_path=?", (source_path,))
    return len(ids)


def index_doc(md_path: Path, *, embed: bool = True) -> int:
    """(Re)index một file .md. Trả về số đoạn. Embedding lỗi -> vẫn index FTS, in cảnh báo
    (chạy `scripts/reindex.py --bu-vector` sau khi server embedding lên lại)."""
    rel = _rel(md_path)
    doc = md_path.parent.name if md_path.parent != config.DOCS_DIR else md_path.stem
    parts = parse_markdown(md_path)
    conn = connect()
    try:
        remove_doc(conn, rel)
        ids = []
        for heading, start, text in parts:
            cur = conn.execute(
                "INSERT INTO sections(doc, section, source_path, line_start, text) "
                "VALUES (?,?,?,?,?)", (doc, heading, rel, start, text))
            sid = cur.lastrowid
            conn.execute("INSERT INTO sections_fts(rowid, text, section, doc) VALUES (?,?,?,?)",
                         (sid, text, heading, doc))
            ids.append((sid, f"{doc} — {heading}\n{text}"))
        conn.commit()
        if embed and ids:
            try:
                _luu_vector(conn, ids)
            except Exception as e:
                print(f"[index] không nhúng được {rel} ({type(e).__name__}: {e}) — chỉ có FTS", flush=True)
        return len(ids)
    finally:
        conn.close()


def _luu_vector(conn: sqlite3.Connection, ids: list[tuple[int, str]]) -> None:
    vecs = llm.embed([t for _, t in ids])
    for (sid, _), v in zip(ids, vecs):
        a = np.asarray(v, dtype=np.float32)
        n = np.linalg.norm(a)
        conn.execute("INSERT OR REPLACE INTO vectors(section_id, vec) VALUES (?,?)",
                     (sid, (a / n if n else a).tobytes()))
    conn.commit()


def bu_vector() -> int:
    """Nhúng các đoạn CHƯA có vector (không xoá vector đang tốt)."""
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT s.id, s.doc, s.section, s.text FROM sections s "
            "LEFT JOIN vectors v ON v.section_id = s.id WHERE v.section_id IS NULL").fetchall()
        _luu_vector(conn, [(r["id"], f"{r['doc']} — {r['section']}\n{r['text']}") for r in rows])
        return len(rows)
    finally:
        conn.close()


def list_docs() -> list[dict]:
    if not config.INDEX_DB.exists():
        return []
    conn = connect()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT doc, source_path, COUNT(*) AS so_doan FROM sections "
            "GROUP BY source_path ORDER BY doc")]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Truy hồi
# ---------------------------------------------------------------------------

_STOP = {
    # tiếng Việt (có dấu và không dấu — FTS bỏ dấu nên hai dạng như nhau)
    "là", "la", "của", "cua", "và", "va", "các", "cac", "những", "nhung", "có", "co",
    "không", "khong", "cho", "với", "voi", "được", "duoc", "trong", "này", "nay",
    "đó", "do", "gì", "gi", "nào", "nao", "thì", "thi", "về", "ve", "một", "mot",
    "tôi", "toi", "bạn", "ban", "hãy", "hay", "như", "nhu", "thế", "the", "sao",
    "ra", "đi", "di", "nói", "noi", "cái", "cai", "ở", "o",
    # tiếng Anh
    "the", "and", "for", "what", "which", "how", "are", "is", "of", "to", "in", "on",
    "a", "an", "does", "do", "with", "about", "tell", "me",
}


def _fts_query(q: str) -> str:
    toks = [t.lower() for t in re.findall(r"\w{2,}", q, flags=re.UNICODE)]
    toks = [t for t in dict.fromkeys(toks) if t not in _STOP]
    return " OR ".join(f'"{t}"' for t in toks[:40])


def _vec_ids(conn: sqlite3.Connection, query: str, limit: int) -> list[int]:
    rows = conn.execute("SELECT section_id, vec FROM vectors").fetchall()
    if not rows:
        return []
    try:
        q = np.asarray(llm.embed([query], query=True)[0], dtype=np.float32)
    except Exception as e:
        print(f"[search] embedding lỗi ({type(e).__name__}) — chỉ dùng FTS", flush=True)
        return []
    mat = np.stack([np.frombuffer(r["vec"], dtype=np.float32) for r in rows])
    if mat.shape[1] != q.shape[0]:
        print("[search] số chiều vector lệch (đã đổi model embedding?) — chạy "
              "`scripts/reindex.py --tat-ca`", flush=True)
        return []
    q /= (np.linalg.norm(q) or 1.0)
    order = np.argsort(-(mat @ q))[:limit]
    return [int(rows[i]["section_id"]) for i in order]


def search(query: str, *, top_k: int | None = None) -> list[Section]:
    top_k = top_k or config.TOP_K
    if not config.INDEX_DB.exists():
        return []
    conn = connect()
    try:
        pool = max(top_k * 5, 40)
        fts_ids: list[int] = []
        fq = _fts_query(query)
        if fq:
            try:
                fts_ids = [r[0] for r in conn.execute(
                    "SELECT rowid FROM sections_fts WHERE sections_fts MATCH ? "
                    "ORDER BY bm25(sections_fts, 1.0, 2.0, 1.0) LIMIT ?", (fq, pool))]
            except sqlite3.OperationalError:
                fts_ids = []
        vec_ids = _vec_ids(conn, query, pool)
        rrf: dict[int, float] = {}
        for ids in (fts_ids, vec_ids):
            for rank, sid in enumerate(ids):
                rrf[sid] = rrf.get(sid, 0.0) + 1.0 / (config.RRF_K + rank + 1)
        if not rrf:
            return []
        ph = ",".join("?" * len(rrf))
        rows = {r["id"]: r for r in conn.execute(f"SELECT * FROM sections WHERE id IN ({ph})",
                                                 list(rrf))}
        out: list[Section] = []
        per_doc: dict[str, int] = {}
        for sid in sorted(rrf, key=rrf.get, reverse=True):
            r = rows.get(sid)
            if r is None or per_doc.get(r["source_path"], 0) >= config.PER_DOC_CAP:
                continue
            per_doc[r["source_path"]] = per_doc.get(r["source_path"], 0) + 1
            out.append(Section(id=sid, doc=r["doc"], section=r["section"],
                               source_path=r["source_path"], line_start=r["line_start"],
                               text=r["text"], score=rrf[sid]))
            if len(out) >= top_k:
                break
        return out
    finally:
        conn.close()
