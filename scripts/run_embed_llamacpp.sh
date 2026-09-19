#!/usr/bin/env bash
# Chạy model EMBEDDING bằng llama.cpp. Qwen3-Embedding-0.6B (~0,6 GB Q8) — mặc định chạy
# CPU để nhường toàn bộ VRAM cho model chat. Qwen3-Embedding BẮT BUỘC `--pooling last`.
set -euo pipefail
MODEL="${MODEL:-$HOME/models/qwen3-embedding-0.6b/Qwen3-Embedding-0.6B-Q8_0.gguf}"
PORT="${PORT:-8081}"
NGL="${NGL:-0}"                   # 0 = CPU; đặt 999 nếu GPU còn chỗ (nhanh hơn khi nạp tài liệu)
LLAMA_SERVER="${LLAMA_SERVER:-llama-server}"

[[ -f "$MODEL" ]] || { echo "Không thấy $MODEL — xem docs/CAI_DAT.md bước 2" >&2; exit 1; }
exec "$LLAMA_SERVER" \
  -m "$MODEL" \
  --alias qwen3-embedding-0.6b \
  --host 127.0.0.1 --port "$PORT" \
  --embedding --pooling last \
  -c 8192 -b 8192 -ub 8192 -ngl "$NGL" \
  "$@"
