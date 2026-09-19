"""Hỏi đáp trên tài liệu, trích dẫn kiểu AnythingLLM: mỗi `[n]` -> tài liệu + trang + đoạn.

Bất biến quan trọng nhất: số `n` trong prompt và số `n` gửi cho giao diện là CÙNG MỘT
danh sách (`chon_trich_doan`). Repo gốc từng lọc/xếp lại danh sách hiển thị riêng, nên
`[3]` trong câu trả lời trỏ sang một nguồn khác.

Luồng sự kiện SSE: session -> citations (mọi đoạn đã đưa vào prompt) -> chunk... ->
citations (chỉ đoạn THẬT SỰ được trích) -> done | error.
"""
from __future__ import annotations

import asyncio
import re
from typing import AsyncIterator

from . import config, index, llm, pages, store

_PROMPT = config.ROOT / "prompts" / "system.md"
_RX_TRICH = re.compile(r"\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]")


def so_da_trich(text: str) -> list[int]:
    """Các số `n` đã trích: `[2]`, `[1, 3]`, `[1][4]`, `[2-4]`. Bỏ phần trong `code`."""
    text = re.sub(r"`[^`]*`", " ", text or "")
    ra: list[int] = []
    for m in _RX_TRICH.finditer(text):
        for phan in re.split(r"\s*[,;]\s*", m.group(1)):
            ab = re.split(r"\s*[–-]\s*", phan)
            try:
                a, b = int(ab[0]), int(ab[-1])
            except ValueError:
                continue
            for k in range(a, min(b, a + 20) + 1):
                if k not in ra:
                    ra.append(k)
    return ra


def chon_trich_doan(hits: list[index.Section]) -> list[tuple[int, index.Section, str]]:
    """[(n, đoạn, chữ đưa vào prompt)], n đếm từ 1, dừng khi chạm trần CONTEXT_CHARS."""
    out, tong = [], 0
    for s in hits:
        text = s.text.strip()[: config.SECTION_CHARS]
        dai = len(text) + len(s.doc) + len(s.section) + 20
        if out and tong + dai > config.CONTEXT_CHARS:
            break
        out.append((len(out) + 1, s, text))
        tong += dai
    return out


def trich_dan(chon: list[tuple[int, index.Section, str]]) -> list[dict]:
    ra = []
    for n, s, text in chon:
        md = config.DOCS_DIR / s.source_path
        try:
            dau, cuoi = pages.khoang_trang(md, text, s.section)
        except Exception:
            dau, cuoi = None, None
        sach = pages.sach(text)
        ra.append({
            "n": n,
            "doc": s.doc,
            "section": s.section,
            "source_path": s.source_path,
            "line_start": s.line_start,
            "page": dau,
            "page_end": cuoi,
            "co_trang": pages.co_trang(md),
            "quote": sach[:900] + ("…" if len(sach) > 900 else ""),
            "neo_dau": sach[:120],
            "neo_cuoi": sach[-80:],
        })
    return ra


def _cau_tim(query: str, recent: list[dict]) -> str:
    """Câu hỏi nối tiếp ngắn ("còn học kì 2?") không đủ từ khoá -> ghép câu hỏi trước."""
    if len(query) >= config.FOLLOWUP_CHARS:
        return query
    truoc = [m["content"] for m in recent if m["role"] == "user"]
    return f"{truoc[-1]} {query}" if truoc else query


async def answer(query: str, session_id: str | None) -> AsyncIterator[tuple[str, dict]]:
    if not session_id or not await asyncio.to_thread(store.exists, session_id):
        session_id = await asyncio.to_thread(store.new_session, query)
    recent = await asyncio.to_thread(store.messages, session_id, config.RECENT_TURNS)
    await asyncio.to_thread(store.add_message, session_id, "user", query)
    yield "session", {"session_id": session_id}

    try:
        hits = await asyncio.to_thread(index.search, _cau_tim(query, recent))
    except Exception as e:
        print(f"[chat] tìm lỗi: {type(e).__name__}: {e}", flush=True)
        hits = []
    chon = chon_trich_doan(hits)
    nguon = await asyncio.to_thread(trich_dan, chon)
    yield "citations", {"citations": nguon}

    danh_muc = await asyncio.to_thread(index.list_docs)
    khoi = "\n\n---\n\n".join(f"[{n}] {s.doc} › {s.section}\n{text}" for n, s, text in chon)
    ngu_canh = (
        "WORKSPACE DOCUMENTS:\n"
        + ("\n".join(f"- {d['doc']} ({d['so_doan']} passages)" for d in danh_muc) or "(none uploaded)")
        + "\n\nDOCUMENT EXCERPTS:\n" + (khoi or "(no matching excerpt)")
        + f"\n\nQUESTION:\n{query}")
    system = _PROMPT.read_text(encoding="utf-8") if _PROMPT.is_file() else ""
    messages = ([{"role": "system", "content": system}] if system else []) + [
        {"role": m["role"], "content": m["content"]} for m in recent] + [
        {"role": "user", "content": ngu_canh}]

    buf: list[str] = []
    try:
        async for tok in llm.chat_stream(messages):
            buf.append(tok)
            yield "chunk", {"text": tok}
    except Exception as e:
        yield "error", {"error": f"Không gọi được mô hình: {type(e).__name__}: {e}"}
        return
    full = "".join(buf).strip() or "Không tạo được câu trả lời. Bạn thử hỏi lại cụ thể hơn."
    if not buf:
        yield "chunk", {"text": full}

    # Chỉ giữ nguồn THẬT SỰ được trích (giữ nguyên số n). Không trích số nào mà vẫn có
    # đoạn tìm được -> giữ 3 đoạn đầu làm "tham khảo", đánh dấu cited=False.
    da = [k for k in so_da_trich(full) if 1 <= k <= len(nguon)]
    cits = ([dict(nguon[k - 1], cited=True) for k in sorted(da)] if da
            else [dict(c, cited=False) for c in nguon[:3]])
    yield "citations", {"citations": cits}
    mid = await asyncio.to_thread(store.add_message, session_id, "assistant", full, cits)
    yield "done", {"session_id": session_id, "message_id": mid}
