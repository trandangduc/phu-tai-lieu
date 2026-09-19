#!/usr/bin/env bash
# Chạy model CHAT bằng llama.cpp `llama-server` (OpenAI-compatible /v1).
# Mặc định cho GPU 16 GB: Qwen3.8-27B UD-Q3_K_XL (12,24 GiB) + ngữ cảnh 32K, KV cache q8.
# Xem docs/CAI_DAT.md mục 3 để chọn bản lượng tử khác.
set -euo pipefail
MODEL="${MODEL:-$HOME/models/qwen3.8-27b/Qwen3.8-27B-UD-Q3_K_XL.gguf}"
CTX="${CTX:-32768}"
PORT="${PORT:-8080}"
NGL="${NGL:-999}"                 # số lớp đẩy lên GPU; 999 = tất cả
LLAMA_SERVER="${LLAMA_SERVER:-llama-server}"

[[ -f "$MODEL" ]] || { echo "Không thấy $MODEL — xem docs/CAI_DAT.md bước 2" >&2; exit 1; }
exec "$LLAMA_SERVER" \
  -m "$MODEL" \
  --alias qwen3.8-27b \
  --host 127.0.0.1 --port "$PORT" \
  -c "$CTX" -ngl "$NGL" \
  -fa on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --jinja \
  -np 1 \
  --temp 0.3 --top-p 0.8 --top-k 20 \
  "$@"
