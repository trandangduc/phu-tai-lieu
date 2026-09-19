"""Cấu hình — đọc từ biến môi trường (file `.env` ở gốc repo được nạp tự động).

Mọi đường dẫn dữ liệu nằm dưới DATA_DIR. Không có giá trị mặc định nào trỏ ra ngoài máy:
LLM và embedding mặc định là llama.cpp chạy cục bộ.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_dotenv(path: Path) -> None:
    """Nạp `.env` đơn giản (KEY=VALUE). Biến đã có trong môi trường thì giữ nguyên."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


_load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    return int(os.getenv(name) or default)


# --- Dữ liệu ---
DATA_DIR = Path(os.getenv("DATA_DIR") or ROOT / "data").resolve()
DOCS_DIR = DATA_DIR / "docs"            # mỗi tài liệu một thư mục: <stem>/<stem>.md (+ ảnh, content_list)
INDEX_DB = DATA_DIR / "index.sqlite"
CHAT_DB = DATA_DIR / "chat.sqlite"
UPLOAD_DIR = DATA_DIR / "uploads"       # file gốc (giữ lại để có thể xử lý lại sau)

# --- Server ---
HOST = os.getenv("HOST") or "127.0.0.1"
PORT = _int("PORT", 7870)

# --- LLM (OpenAI-compatible: llama.cpp `llama-server`, vLLM, ...) ---
LLM_API_BASE = (os.getenv("LLM_API_BASE") or "http://127.0.0.1:8080/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL") or "qwen3.8-27b"
LLM_API_KEY = os.getenv("LLM_API_KEY") or ""
LLM_MAX_TOKENS = _int("LLM_MAX_TOKENS", 2048)
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE") or "0.3")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT") or "600")
# Qwen3.x có chế độ suy nghĩ; hỏi đáp tài liệu không cần và tốn token -> tắt mặc định.
LLM_ENABLE_THINKING = (os.getenv("LLM_ENABLE_THINKING") or "0") == "1"

# --- Embedding (OpenAI-compatible /v1/embeddings) ---
EMBED_API_BASE = (os.getenv("EMBED_API_BASE") or "http://127.0.0.1:8081/v1").rstrip("/")
EMBED_MODEL = os.getenv("EMBED_MODEL") or "qwen3-embedding-0.6b"
EMBED_BATCH = _int("EMBED_BATCH", 16)
EMBED_MAX_CHARS = _int("EMBED_MAX_CHARS", 2000)
# Qwen3-Embedding cần câu dẫn cho TRUY VẤN (không cho tài liệu). Model khác thì để trống.
EMBED_QUERY_PREFIX = os.getenv(
    "EMBED_QUERY_PREFIX",
    "Instruct: Given a question, retrieve passages from documents that answer it\nQuery: ")

# --- Cắt đoạn / truy hồi ---
CHUNK_MAX_CHARS = _int("CHUNK_MAX_CHARS", 1400)
CHUNK_OVERLAP = _int("CHUNK_OVERLAP", 150)
TOP_K = _int("TOP_K", 8)                        # số đoạn đưa vào prompt
PER_DOC_CAP = _int("PER_DOC_CAP", 4)            # tối đa bao nhiêu đoạn từ MỘT tài liệu
CONTEXT_CHARS = _int("CONTEXT_CHARS", 24000)    # trần tổng chữ của các đoạn trích
SECTION_CHARS = _int("SECTION_CHARS", 4000)     # trần chữ mỗi đoạn trích
RRF_K = _int("RRF_K", 60)
RECENT_TURNS = _int("RECENT_TURNS", 4)          # số tin nhắn cũ mang theo
FOLLOWUP_CHARS = _int("FOLLOWUP_CHARS", 40)     # câu hỏi ngắn hơn -> ghép câu trước để tìm

# --- Nạp tài liệu (MinerU 4) ---
# basic: CPU, không cần model thị giác, KHÔNG có OCR tiếng Việt (ổn với PDF có lớp chữ).
# standard: cần model MinerU2.5 — qua server (MINERU_VLM_URL) hoặc engine cục bộ.
MINERU_TIER = (os.getenv("MINERU_TIER") or "basic").strip().lower()
MINERU_VLM_URL = (os.getenv("MINERU_VLM_URL") or "").strip().rstrip("/")
MINERU_VLM_MODEL = (os.getenv("MINERU_VLM_MODEL") or "mineru25").strip()
MINERU_VLM_ENGINE = (os.getenv("MINERU_VLM_ENGINE") or "auto").strip()   # auto|llama-cpp|vllm
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 200)


def ensure_dirs() -> None:
    for d in (DATA_DIR, DOCS_DIR, UPLOAD_DIR):
        d.mkdir(parents=True, exist_ok=True)
