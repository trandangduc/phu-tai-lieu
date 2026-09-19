"""Số TRANG của một đoạn trích — tính bằng code, KHÔNG do model sinh ra.

File `.md` do MinerU sinh không có mốc trang, nhưng khi nạp tài liệu ta lưu cạnh nó
`<stem>_content_list.json` = [{page_idx, text}] cho từng khối. Đối chiếu đoạn văn với các
khối đó ra số trang MỞ FILE GỐC LÀ THẤY (không phải số dòng của bản Markdown).

Nguyên tắc: SAI TRANG NGUY HƠN KHÔNG CÓ TRANG. Không chắc thì trả None.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

# Dòng mục lục: "<tên mục> ...... 25" — phải bỏ, nếu không thì tra "Absolute Maximum
# Ratings" ra trang MỤC LỤC (trang 2) thay vì trang thật (trang 25). Đã dính ở repo gốc.
_RX_DONG_MUC_LUC = re.compile(r"[A-Za-z]\s*[.…\s]{4,}\s*\d{1,3}\s*$")


def chuan(s: str) -> str:
    return re.sub(r"\W+", "", (s or "").lower())


@lru_cache(maxsize=64)
def _content_list(md_path: str, mtime: float) -> tuple:
    p = Path(md_path)
    cl = p.with_name(p.stem + "_content_list.json")
    if not cl.is_file():
        return ()
    try:
        d = json.loads(cl.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return ()
    ra = []
    for x in d:
        if not isinstance(x, dict):
            continue
        chu = " ".join(str(x.get(k) or "") for k in
                       ("text", "table_body", "list_items", "content",
                        "table_caption", "image_caption"))
        if not chu.strip():
            continue
        if re.search(r"\.{3,}", chu) or _RX_DONG_MUC_LUC.search(chu):
            continue
        try:
            trang = int(x.get("page_idx", -1))
        except (TypeError, ValueError):
            continue
        if trang >= 0:
            ra.append((trang, chuan(chu)))
    return tuple(ra)


def co_trang(md_path: Path) -> bool:
    return md_path.with_name(md_path.stem + "_content_list.json").is_file()


def trang_cua(md_path: Path, doan: str, muc: str = "", tu_trang: int = 0) -> int | None:
    """Trang (đếm từ 1) chứa `doan`. `muc` = tiêu đề mục, dùng khi đoạn quá ngắn/là bảng.

    `tu_trang`: chỉ nhận chỗ khớp từ trang này trở đi. Cần vì tài liệu hay LẶP đoạn văn
    (datasheet TI chép đoạn mô tả ở trang 1 và ở mục Overview trang 8) — lấy chỗ khớp đầu
    tiên là ra trang 1 cho một đoạn nằm ở trang 8 (đo 2026-09-19 trên TL7705A)."""
    if not md_path.is_file():
        return None
    cl = _content_list(str(md_path), md_path.stat().st_mtime)
    if tu_trang > 1:
        cl = tuple(x for x in cl if x[0] + 1 >= tu_trang)
    if not cl:
        return None
    khoa = chuan(doan)[:48]
    # Đoạn quá ngắn ("Table 15.") thì không khớp chữ — nhưng vẫn còn tiêu đề mục để thử.
    if len(khoa) >= 16:
        for trang, chu in cl:
            if khoa in chu:
                return trang + 1
        for trang, chu in cl:
            if khoa[:24] in chu:
                return trang + 1
    km = chuan(muc)
    if len(km) >= 8:
        for trang, chu in cl:                     # khối CHÍNH LÀ tiêu đề
            if chu.startswith(km) and len(chu) <= len(km) + 12:
                return trang + 1
        for trang, chu in cl:
            if km in chu:
                return trang + 1
    return None


def chu_goc(text: str) -> str:
    """Phần chữ CÓ TRONG FILE GỐC của một đoạn — bỏ cú pháp ảnh và chữ do model thị giác
    chèn thêm (mô tả ảnh, khối `<details>` chép lại biểu đồ): chúng không có trong PDF
    nên không khớp, hoặc tệ hơn là khớp nhầm sang trang khác."""
    t = re.sub(r"<details>.*?</details>", " ", text or "", flags=re.S)
    t = re.sub(r"^>\s*\*\*\[Mô tả hình ảnh\]\*\*.*(?:\n>.*)*", " ", t, flags=re.M)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    return t.strip()


def sach(text: str) -> str:
    """Chữ đọc được của một đoạn Markdown (bỏ thẻ HTML, cú pháp ảnh/liên kết)."""
    t = re.sub(r"<[^>]+>", " ", text or "")
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()


def trang_tieu_de(md_path: Path, muc: str) -> int | None:
    """Trang của khối CHÍNH LÀ tiêu đề mục (không phải câu nhắc tới nó)."""
    km = chuan(muc)
    if len(km) < 6 or not md_path.is_file():
        return None
    for trang, chu in _content_list(str(md_path), md_path.stat().st_mtime):
        if chu.startswith(km) and len(chu) <= len(km) + 12:
            return trang + 1
    return None


def khoang_trang(md_path: Path, text: str, muc: str = "") -> tuple[int | None, int | None]:
    """(trang đầu, trang cuối) của một đoạn. Trang cuối = None khi cùng trang/không rõ."""
    goc = chu_goc(text)
    sg = sach(goc)
    muc = "" if muc == "(đầu tài liệu)" else muc
    tieu_de = trang_tieu_de(md_path, muc) if muc else None
    dau = None
    for d in (goc[:300], sg[:200]):              # bản THÔ trước: bảng trong content_list là HTML
        dau = trang_cua(md_path, d, tu_trang=tieu_de or 0)
        if dau:
            break
    if not dau:
        dau = tieu_de or (trang_cua(md_path, goc[:300], muc=muc) if muc else None)
    cuoi = None
    if dau and len(sg) > 240:
        for d in (goc[-160:], sg[-120:]):
            cuoi = trang_cua(md_path, d, tu_trang=dau)
            if cuoi:
                break
    if not dau or not cuoi or cuoi <= dau:
        cuoi = None
    return dau, cuoi
