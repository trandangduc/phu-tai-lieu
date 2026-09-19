"""Nạp tài liệu: file gốc -> MinerU 4 -> Markdown + `<stem>_content_list.json` -> index.

`_content_list.json` là thứ duy nhất cho ra SỐ TRANG của trích dẫn. Repo gốc từng chỉ chép
`.md` + `images/` sau khi parse nên mọi tài liệu tải lên đều mất trang — đừng bỏ bước đó.

MinerU chạy trong tiến trình con (`ProcessPool`), nên tiến trình chính phải là một module
thật (`python -m app.server`), không chạy được từ stdin/REPL.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import traceback
import unicodedata
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import config, index

# Model NHỎ của MinerU (khoanh bố cục, OCR) chạy ONNX trên CPU: không tốn VRAM (GPU để dành
# cho model chat) và không đi đường torch/transformers — đường đó vỡ với transformers bản
# mới (`cannot import name 'PPDocLayoutV2Config'`, đo 2026-09-19). Phải đặt TRƯỚC khi
# import mineru. Muốn đổi thì đặt biến môi trường trước khi chạy app.
os.environ.setdefault("MINERU_MODEL_SMALL_BACKEND", "onnx")
os.environ.setdefault("MINERU_DEVICE_MODE", "cpu")

PDF = {".pdf"}
IMAGE = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
OFFICE = {".docx", ".pptx", ".xlsx"}
TEXT = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".html", ".htm", ".xml"}
SUPPORTED = PDF | IMAGE | OFFICE | TEXT


@dataclass
class Job:
    id: str
    filename: str
    stem: str
    status: str = "queued"          # queued | running | done | failed
    stage: str = "đang chờ"
    error: str = ""
    so_doan: int = 0
    co_trang: bool = False
    tier: str = ""
    started: float = field(default_factory=time.time)
    seconds: float = 0.0


JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()            # MinerU nặng: xử lý lần lượt từng file


def safe_stem(filename: str) -> str:
    s = unicodedata.normalize("NFKD", Path(filename).stem)
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("đ", "d").replace("Đ", "D")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("._")
    return s[:100] or f"tai_lieu_{uuid.uuid4().hex[:6]}"


def submit(filename: str, data: bytes) -> Job:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError(f"Không hỗ trợ đuôi {suffix or '(không có)'}")
    config.ensure_dirs()
    job = Job(id=uuid.uuid4().hex, filename=filename, stem=safe_stem(filename))
    goc = config.UPLOAD_DIR / f"{job.stem}{suffix}"
    goc.write_bytes(data)                 # giữ file gốc để có thể xử lý lại
    JOBS[job.id] = job
    threading.Thread(target=_run, args=(job, goc), daemon=True).start()
    return job


def _run(job: Job, goc: Path) -> None:
    with _LOCK:
        job.status, job.stage = "running", "đang đọc tài liệu"
        t0 = time.time()
        work = config.DATA_DIR / "work" / job.id
        try:
            work.mkdir(parents=True, exist_ok=True)
            if goc.suffix.lower() in TEXT:
                md = _parse_text(goc, work, job.stem)
                job.tier = "text"
            else:
                md, job.tier = _parse_mineru(goc, work, job.stem)
            job.stage = "đang lập chỉ mục"
            dich = _publish(md, job.stem)
            job.co_trang = dich.with_name(dich.stem + "_content_list.json").is_file()
            job.so_doan = index.index_doc(dich)
            job.status, job.stage = "done", "xong"
        except Exception as e:
            traceback.print_exc()
            job.status, job.stage, job.error = "failed", "lỗi", f"{type(e).__name__}: {e}"
        finally:
            job.seconds = round(time.time() - t0, 1)
            shutil.rmtree(work, ignore_errors=True)


def reprocess(stem: str) -> Job:
    """Xử lý lại từ file gốc đã lưu (vd sau khi đổi MINERU_TIER)."""
    goc = next((p for p in config.UPLOAD_DIR.glob(f"{stem}.*")), None)
    if goc is None:
        raise FileNotFoundError(stem)
    job = Job(id=uuid.uuid4().hex, filename=goc.name, stem=stem)
    JOBS[job.id] = job
    threading.Thread(target=_run, args=(job, goc), daemon=True).start()
    return job


def _parse_text(src: Path, work: Path, stem: str) -> Path:
    raw = src.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "cp1258", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if src.suffix.lower() in (".html", ".htm", ".xml"):
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    if src.suffix.lower() not in (".md", ".markdown"):
        text = f"# {src.stem}\n\n{text}"
    out = work / stem / f"{stem}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return out


def _tier_va_vlm():
    """(tier, VlmConfig|None). `standard` mà server VLM không trả lời -> rơi về `basic`
    (tài liệu vẫn vào kho, chữ scan tiếng Việt kém hơn) thay vì làm hỏng lần tải lên."""
    tier = config.MINERU_TIER
    if tier not in ("standard", "advanced"):
        return tier, None
    from mineru.config import VlmConfig
    if config.MINERU_VLM_URL:
        import httpx
        try:
            httpx.get(f"{config.MINERU_VLM_URL}/v1/models", timeout=3).raise_for_status()
            return tier, VlmConfig(server_url=config.MINERU_VLM_URL, model=config.MINERU_VLM_MODEL)
        except Exception:
            print(f"[ingest] server VLM {config.MINERU_VLM_URL} không trả lời -> basic", flush=True)
            return "basic", None
    # Không có URL: MinerU tự mở engine cục bộ (llama.cpp/vLLM, tự tải model lần đầu).
    return tier, VlmConfig(engine=config.MINERU_VLM_ENGINE)


def _parse_mineru(src: Path, work: Path, stem: str) -> tuple[Path, str]:
    from mineru.parser import parse
    from mineru.parser.writer import FileBasedDataWriter
    tier, vlm = _tier_va_vlm()
    result = parse(str(src), tier=tier, vlm_config=vlm)
    out_dir = work / stem
    out_dir.mkdir(parents=True, exist_ok=True)
    result.save(FileBasedDataWriter(str(out_dir)))
    produced = out_dir / "markdown.md"
    if not produced.is_file():
        raise RuntimeError("MinerU chạy xong nhưng không sinh markdown.md")
    md = out_dir / f"{stem}.md"
    produced.replace(md)
    ghi_content_list(out_dir / "structured_content.json", md)
    return md, tier


def ghi_content_list(structured: Path, md_path: Path) -> bool:
    """`structured_content.json` ({pages: [{page_idx, blocks}]}) -> `<stem>_content_list.json`
    dạng PHẲNG [{page_idx, text}] mà `pages.trang_cua` đọc."""
    try:
        d = json.loads(structured.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ingest] không đọc được structured_content ({e}) — tài liệu sẽ không có số trang",
              flush=True)
        return False
    ra = []
    for page in d.get("pages") or []:
        for b in page.get("blocks") or []:
            # Chú thích/footnote của bảng, ảnh là object {"bbox", "content"}, không phải chuỗi.
            # Bỏ qua chúng là mất câu mở bảng ("over operating free-air temperature range…")
            # và tài liệu lặp câu đó ở trang khác sẽ bị trỏ nhầm trang (đo trên TL7705A).
            phan = [b.get("content") or ""] + list(b.get("captions") or []) + list(b.get("footnotes") or [])
            chu = " ".join(str(x.get("content") or "") if isinstance(x, dict) else str(x)
                           for x in phan if x and not isinstance(x, list))
            if chu.strip():
                ra.append({"type": b.get("type", ""), "page_idx": page.get("page_idx"), "text": chu})
    if not ra:
        return False
    md_path.with_name(md_path.stem + "_content_list.json").write_text(
        json.dumps(ra, ensure_ascii=False), encoding="utf-8")
    return True


def _publish(md: Path, stem: str) -> Path:
    """Chép kết quả vào DOCS_DIR/<stem>/: .md + images/ + content_list."""
    dest_dir = config.DOCS_DIR / stem
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    dest_dir.mkdir(parents=True)
    dest = dest_dir / f"{stem}.md"
    shutil.copyfile(md, dest)
    if (md.parent / "images").is_dir():
        shutil.copytree(md.parent / "images", dest_dir / "images")
    cl = md.with_name(md.stem + "_content_list.json")
    if cl.is_file():
        shutil.copyfile(cl, dest.with_name(dest.stem + "_content_list.json"))
    return dest


def delete_doc(stem: str) -> None:
    d = config.DOCS_DIR / stem
    conn = index.connect()
    try:
        for md in d.glob("*.md"):
            index.remove_doc(conn, index._rel(md))
        conn.commit()
    finally:
        conn.close()
    shutil.rmtree(d, ignore_errors=True)
    for p in config.UPLOAD_DIR.glob(f"{stem}.*"):
        p.unlink(missing_ok=True)


def job_dict(job: Job) -> dict:
    return asdict(job)
