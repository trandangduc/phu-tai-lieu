"""Kiểm OFFLINE (không cần LLM, không cần embedding): cắt đoạn, index FTS, số trang, đánh
số trích dẫn. Chạy:  python -m tests.test_offline

Dựng một tài liệu giả có `_content_list.json` 3 trang trong thư mục tạm, nên không đụng
dữ liệu thật.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="tailieu_test_"))
os.environ["DATA_DIR"] = str(TMP)
os.environ["EMBED_API_BASE"] = "http://127.0.0.1:9/v1"     # cổng chết: ép đường chỉ-FTS

from app import chat, config, index, pages  # noqa: E402

LOI: list[str] = []


def kiem(ten: str, dk: bool, chi_tiet: str = "") -> None:
    print(("  OK   " if dk else "  FAIL ") + ten + (f"  ({chi_tiet})" if chi_tiet and not dk else ""))
    if not dk:
        LOI.append(ten)


def dung_tai_lieu() -> Path:
    d = config.DOCS_DIR / "quyet_dinh"
    d.mkdir(parents=True)
    md = d / "quyet_dinh.md"
    md.write_text(
        "# QUYẾT ĐỊNH giao đề tài tốt nghiệp\n\n"
        "Căn cứ Luật Giáo dục đại học số 125/2025/QH15 ngày 10/12/2025 của Quốc hội.\n\n"
        "## Điều 1. Danh sách đề tài\n\n"
        "Giao đề tài tốt nghiệp cho sinh viên khoá 2022 theo danh sách đính kèm.\n\n"
        "<table><tr><td>STT</td><td>Họ tên</td><td>Đề tài</td></tr>"
        "<tr><td>1</td><td>Nguyễn Văn An</td><td>Hệ thống giám sát nhiệt độ bằng IoT</td></tr></table>\n\n"
        "## Điều 2. Thời gian thực hiện\n\n"
        "Table 3.\n\n"
        "## Điều 3. Hiệu lực\n\n"
        "Quyết định có hiệu lực kể từ ngày ký. Các đơn vị liên quan chịu trách nhiệm thi hành.\n\n"
        "## Điều 4. Tóm tắt\n\n"
        "Căn cứ Luật Giáo dục đại học số 125/2025/QH15 ngày 10/12/2025 của Quốc hội.\n",
        encoding="utf-8")
    cl = [
        {"page_idx": 0, "text": "QUYẾT ĐỊNH giao đề tài tốt nghiệp"},
        {"page_idx": 0, "text": "Căn cứ Luật Giáo dục đại học số 125/2025/QH15 ngày 10/12/2025 của Quốc hội."},
        {"page_idx": 0, "text": "Mục lục ........ 2"},
        {"page_idx": 1, "text": "Điều 1. Danh sách đề tài"},
        {"page_idx": 1, "text": "Giao đề tài tốt nghiệp cho sinh viên khoá 2022 theo danh sách đính kèm."},
        {"page_idx": 1, "text": "<table><tr><td>STT</td><td>Họ tên</td><td>Đề tài</td></tr>"
                               "<tr><td>1</td><td>Nguyễn Văn An</td><td>Hệ thống giám sát nhiệt độ bằng IoT</td></tr></table>"},
        {"page_idx": 2, "text": "Điều 2. Thời gian thực hiện"},
        {"page_idx": 2, "text": "Điều 3. Hiệu lực"},
        {"page_idx": 2, "text": "Quyết định có hiệu lực kể từ ngày ký. Các đơn vị liên quan chịu trách nhiệm thi hành."},
        {"page_idx": 3, "text": "Điều 4. Tóm tắt"},
        {"page_idx": 3, "text": "Căn cứ Luật Giáo dục đại học số 125/2025/QH15 ngày 10/12/2025 của Quốc hội."},
    ]
    md.with_name("quyet_dinh_content_list.json").write_text(json.dumps(cl, ensure_ascii=False), encoding="utf-8")
    return md


def main() -> int:
    md = dung_tai_lieu()
    print("== index")
    n = index.index_doc(md, embed=False)
    kiem("index ra đủ 5 mục", n == 5, str(n))
    docs = index.list_docs()
    kiem("list_docs thấy tài liệu", len(docs) == 1 and docs[0]["doc"] == "quyet_dinh", str(docs))

    print("== tìm (chỉ FTS, bỏ dấu)")
    hits = index.search("de tai tot nghiep Nguyen Van An")
    kiem("tìm không dấu vẫn ra đoạn có dấu", any("Nguyễn Văn An" in h.text for h in hits))
    hits = index.search("hiệu lực của quyết định")
    kiem("đoạn 'Hiệu lực' đứng đầu", bool(hits) and hits[0].section.startswith("Điều 3"),
         hits[0].section if hits else "rỗng")

    print("== số trang")
    conn = index.connect()
    by = {r["section"]: r for r in conn.execute("SELECT section, text FROM sections")}
    conn.close()
    def tr(muc):
        k = next(k for k in by if k.startswith(muc))
        return pages.khoang_trang(md, by[k]["text"], k)[0]
    kiem("đoạn đầu -> trang 1", tr("QUYẾT ĐỊNH") == 1, str(tr("QUYẾT ĐỊNH")))
    kiem("đoạn có BẢNG HTML -> trang 2", tr("Điều 1") == 2, str(tr("Điều 1")))
    kiem("đoạn quá ngắn ('Table 3.') -> tra bằng tiêu đề mục -> trang 3", tr("Điều 2") == 3, str(tr("Điều 2")))
    kiem("đoạn LẶP NGUYÊN VĂN ở trang 1 và 4 -> lấy theo trang tiêu đề mục (4, không phải 1)",
         tr("Điều 4") == 4, str(tr("Điều 4")))
    kiem("dòng mục lục bị bỏ (không khớp nhầm)", pages.trang_cua(md, "Mục lục ........ 2") is None)
    kiem("chữ không có trong file gốc -> None (không đoán)",
         pages.trang_cua(md, "đoạn này hoàn toàn không tồn tại trong tài liệu gốc") is None)

    print("== đánh số trích dẫn")
    kiem("so_da_trich đọc [2], [1, 3], [4][5], [6-7], bỏ `[9]`",
         chat.so_da_trich("a [2] b [1, 3] c [4][5] d [6-7] `[9]`") == [2, 1, 3, 4, 5, 6, 7],
         str(chat.so_da_trich("a [2] b [1, 3] c [4][5] d [6-7] `[9]`")))
    hits = index.search("quyết định đề tài hiệu lực", top_k=10)
    chon = chat.chon_trich_doan(hits)
    cits = chat.trich_dan(chon)
    kiem("n của trích dẫn = thứ tự đoạn trong prompt",
         [c["n"] for c in cits] == list(range(1, len(chon) + 1)) and
         all(c["source_path"] == s.source_path and c["section"] == s.section for c, (_, s, _) in zip(cits, chon)))
    kiem("mọi trích dẫn có trang + mốc tô sáng", all(c["page"] and c["neo_dau"] for c in cits),
         str([(c["section"], c["page"]) for c in cits]))

    print("== xoá tài liệu")
    from app import ingest
    ingest.delete_doc("quyet_dinh")
    kiem("xoá sạch khỏi index (cả FTS)", not index.list_docs() and not index.search("hiệu lực"))

    print(f"\n{'[OK] pass hết' if not LOI else f'[FAIL] {len(LOI)} kiểm trượt'}")
    return 1 if LOI else 0


if __name__ == "__main__":
    sys.exit(main())
