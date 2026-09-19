"""Client OpenAI-compatible cho chat (stream) và embedding.

Chạy được với llama.cpp `llama-server`, vLLM, hoặc bất kỳ server nào nói /v1.
"""
from __future__ import annotations

import json
import re
from typing import AsyncIterator

import httpx

from . import config


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if config.LLM_API_KEY:
        h["Authorization"] = f"Bearer {config.LLM_API_KEY}"
    return h


async def chat_stream(messages: list[dict], *, max_tokens: int | None = None) -> AsyncIterator[str]:
    """Stream từng mảnh chữ của câu trả lời. Phần suy nghĩ (`<think>…</think>` hoặc
    `reasoning_content`) bị bỏ — người dùng chỉ thấy câu trả lời."""
    body = {
        "model": config.LLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens or config.LLM_MAX_TOKENS,
        "temperature": config.LLM_TEMPERATURE,
        # llama.cpp và vLLM đều nhận khoá này để bật/tắt thinking của Qwen3.x.
        "chat_template_kwargs": {"enable_thinking": config.LLM_ENABLE_THINKING},
    }
    trong_think = False
    async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT) as client:
        async with client.stream("POST", f"{config.LLM_API_BASE}/chat/completions",
                                 headers=_headers(), json=body) as r:
            if r.status_code >= 400:
                raise RuntimeError(f"LLM {r.status_code}: {(await r.aread())[:500]!r}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta") or {}
                except (ValueError, KeyError, IndexError):
                    continue
                tok = delta.get("content") or ""
                if not tok:
                    continue
                # Một số template vẫn nhả thẻ <think> vào content: lọc tại chỗ.
                if "<think>" in tok:
                    trong_think = True
                    tok = tok.split("<think>", 1)[0]
                if trong_think:
                    if "</think>" not in tok:
                        continue
                    trong_think = False
                    tok = tok.split("</think>", 1)[1]
                if tok:
                    yield tok


def embed(texts: list[str], *, query: bool = False) -> list[list[float]]:
    """Nhúng danh sách chuỗi. `query=True` thêm câu dẫn truy vấn (Qwen3-Embedding)."""
    out: list[list[float]] = []
    pre = config.EMBED_QUERY_PREFIX if query else ""
    with httpx.Client(timeout=300) as client:
        for i in range(0, len(texts), config.EMBED_BATCH):
            batch = [pre + re.sub(r"\s+", " ", t)[: config.EMBED_MAX_CHARS]
                     for t in texts[i:i + config.EMBED_BATCH]]
            r = client.post(f"{config.EMBED_API_BASE}/embeddings",
                            json={"model": config.EMBED_MODEL, "input": batch})
            r.raise_for_status()
            data = sorted(r.json()["data"], key=lambda d: d["index"])
            out.extend(d["embedding"] for d in data)
    return out
