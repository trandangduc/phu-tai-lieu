"""Server FastAPI: giao diện tĩnh + API tài liệu + chat SSE.

Chạy:  python -m app.server        (mặc định 127.0.0.1:7870 — chỉ máy này truy cập được)

Không có đăng nhập: thiết kế cho MỘT người dùng trên máy của họ. Muốn mở ra mạng LAN
(HOST=0.0.0.0) thì phải tự đặt reverse proxy có xác thực phía trước.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import chat, config, index, ingest, store

app = FastAPI(title="Phu Tài Liệu", docs_url=None, redoc_url=None)
WEB = config.ROOT / "web"


def _duoi_docs(path: str) -> Path:
    """Giải đường dẫn tương đối DƯỚI DOCS_DIR, chặn thoát thư mục (../)."""
    root = config.DOCS_DIR.resolve()
    p = (root / path).resolve()
    try:
        p.relative_to(root)
    except ValueError:
        raise HTTPException(400, "đường dẫn không hợp lệ")
    if not p.is_file():
        raise HTTPException(404)
    return p


@app.get("/api/health")
def health():
    def ok(url: str) -> bool:
        try:
            return httpx.get(url, timeout=2).status_code < 500
        except Exception:
            return False
    return {"llm": ok(f"{config.LLM_API_BASE}/models"),
            "embed": ok(f"{config.EMBED_API_BASE}/models"),
            "llm_model": config.LLM_MODEL, "mineru_tier": config.MINERU_TIER,
            "so_tai_lieu": len(index.list_docs())}


@app.get("/api/docs")
def docs():
    out = []
    for d in index.list_docs():
        md = config.DOCS_DIR / d["source_path"]
        d["co_trang"] = md.with_name(md.stem + "_content_list.json").is_file()
        out.append(d)
    return {"docs": out}


@app.get("/api/docs/file")
def docs_file(path: str):
    p = _duoi_docs(path)
    if p.suffix.lower() != ".md":
        raise HTTPException(415)
    return PlainTextResponse(p.read_text(encoding="utf-8", errors="replace"))


@app.get("/api/docs/image")
def docs_image(path: str):
    p = _duoi_docs(path)
    if p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        raise HTTPException(415)
    return FileResponse(p)


@app.delete("/api/docs/{stem}")
def docs_delete(stem: str):
    if stem != ingest.safe_stem(stem):
        raise HTTPException(400)
    ingest.delete_doc(stem)
    return {"ok": True}


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    jobs = []
    for f in files:
        data = await f.read()
        if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"{f.filename}: quá {config.MAX_UPLOAD_MB} MB")
        try:
            jobs.append(ingest.job_dict(ingest.submit(f.filename or "tai_lieu", data)))
        except ValueError as e:
            raise HTTPException(415, str(e))
    return {"jobs": jobs}


@app.get("/api/upload/{job_id}")
def upload_status(job_id: str):
    job = ingest.JOBS.get(job_id)
    if not job:
        raise HTTPException(404)
    return ingest.job_dict(job)


@app.post("/api/docs/{stem}/reprocess")
def reprocess(stem: str):
    try:
        return ingest.job_dict(ingest.reprocess(stem))
    except FileNotFoundError:
        raise HTTPException(404, "không còn file gốc")


class ChatReq(BaseModel):
    message: str
    session_id: str | None = None


@app.post("/api/chat")
async def api_chat(req: ChatReq):
    if not req.message.strip():
        raise HTTPException(400, "câu hỏi rỗng")

    async def gen():
        async for ev, payload in chat.answer(req.message.strip(), req.session_id):
            yield f"event: {ev}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/sessions")
def sessions():
    return {"sessions": store.sessions()}


@app.get("/api/sessions/{sid}")
def session(sid: str):
    if not store.exists(sid):
        raise HTTPException(404)
    return {"messages": store.messages(sid)}


@app.delete("/api/sessions/{sid}")
def session_delete(sid: str):
    store.delete_session(sid)
    return {"ok": True}


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def main() -> None:
    import uvicorn
    config.ensure_dirs()
    print(f"Mở http://{config.HOST}:{config.PORT}", flush=True)
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()
