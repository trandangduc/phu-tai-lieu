"""Index lại tài liệu. Chạy từ gốc repo:

  python -m scripts.reindex --bu-vector   # chỉ nhúng các đoạn CHƯA có vector (an toàn, nhanh)
  python -m scripts.reindex --tat-ca      # index lại mọi .md trong data/docs (sau khi ĐỔI
                                          #   model embedding — trộn số chiều là search hỏng)
"""
from __future__ import annotations

import argparse

from app import config, index


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--bu-vector", action="store_true")
    g.add_argument("--tat-ca", action="store_true")
    a = ap.parse_args()
    if a.bu_vector:
        print(f"Đã nhúng {index.bu_vector()} đoạn còn thiếu vector.")
        return
    tong = 0
    for md in sorted(config.DOCS_DIR.glob("*/*.md")):
        n = index.index_doc(md)
        tong += n
        print(f"  {md.parent.name}: {n} đoạn")
    print(f"Xong: {tong} đoạn.")


if __name__ == "__main__":
    main()
