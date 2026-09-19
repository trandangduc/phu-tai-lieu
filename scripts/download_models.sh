#!/usr/bin/env bash
# Kéo model về ~/models. Chọn bản chat bằng QUANT=... (mặc định UD-Q3_K_XL cho 16 GB).
#   QUANT=UD-IQ4_XS  bash scripts/download_models.sh    # 13,27 GiB — sát 16 GB, ctx ~16K
#   QUANT=UD-Q4_K_M  bash scripts/download_models.sh    # 15,33 GiB — cần GPU 24 GB
set -euo pipefail
QUANT="${QUANT:-UD-Q3_K_XL}"
DEST="${DEST:-$HOME/models}"
command -v hf >/dev/null || { echo "Cần 'hf' CLI: pip install -U huggingface_hub" >&2; exit 1; }

hf download unsloth/Qwen3.8-27B-GGUF "Qwen3.8-27B-${QUANT}.gguf" \
  --local-dir "$DEST/qwen3.8-27b"
hf download Qwen/Qwen3-Embedding-0.6B-GGUF Qwen3-Embedding-0.6B-Q8_0.gguf \
  --local-dir "$DEST/qwen3-embedding-0.6b"
echo "Xong. Kiểm dung lượng:"; du -sh "$DEST"/qwen3.8-27b "$DEST"/qwen3-embedding-0.6b
