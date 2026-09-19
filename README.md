# Chat Tài Liệu

Hỏi đáp trên tài liệu của bạn (PDF, Word, PowerPoint, Excel, ảnh, văn bản) bằng model
chạy **trên máy của bạn**. Mọi ý trong câu trả lời đều có trích dẫn kiểu bài báo khoa học:

- Mỗi ý kèm số tròn **[1] [2]**.
- Rê chuột lên số: hiện **tên tài liệu, số trang, mục** và **nguyên văn đoạn** đã dùng.
- Bấm vào số: tài liệu mở ở khung bên phải, cuộn tới đúng đoạn đó và tô vàng.
- Dưới câu trả lời có dòng **Nguồn:** kèm số trang của từng nguồn.

Tách ra từ chế độ "Tài liệu" của Fab9 Chat (repo `Phu-main`), bỏ hết phần chẩn đoán board.

## Số trang lấy từ đâu

Số trang **không do model sinh ra**. Khi nạp tài liệu, MinerU ghi cho mỗi khối chữ một số
trang (`<tài liệu>_content_list.json`). Code đối chiếu đoạn trích với các khối đó. Không chắc
thì hiện "không rõ trang" chứ không đoán, vì sai trang nguy hơn không có trang. Model chỉ
quyết định đặt số [n] vào đoạn nào.

## Cài đặt

Xem **[docs/CAI_DAT.md](docs/CAI_DAT.md)**: từ build llama.cpp, kéo model Qwen3.8-27B (bản
cho GPU 16 GB), chạy embedding, đến lúc dùng được và chạy nền bằng systemd.

Tóm tắt:

```bash
bash scripts/download_models.sh              # ~13 GB
bash scripts/run_llm_llamacpp.sh             # model chat  :8080
bash scripts/run_embed_llamacpp.sh           # embedding   :8081
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-ingest.txt
cp .env.example .env
python -m tests.test_offline                 # 14 kiểm, không cần model
python -m app.server                         # http://127.0.0.1:7870
```

App nói giao thức OpenAI `/v1`, nên cũng chạy được với vLLM hay server tương thích khác:
chỉ cần đổi `LLM_API_BASE` / `EMBED_API_BASE` trong `.env`.

## Cấu trúc

```
app/
  server.py   FastAPI: giao diện tĩnh, /api/docs, /api/upload, /api/chat (SSE), /api/sessions
  chat.py     truy hồi -> đánh số [n] -> gọi LLM -> giữ nguồn đã trích
  index.py    Markdown -> đoạn -> SQLite FTS5 (bỏ dấu tiếng Việt) + vector, trộn bằng RRF
  pages.py    tra số trang từ _content_list.json
  ingest.py   MinerU 4 -> Markdown + _content_list.json -> index
  llm.py      client OpenAI-compatible (chat stream + embedding)
  store.py    lịch sử chat (SQLite)
  config.py   cấu hình từ .env
prompts/system.md   lời dặn cho model (tiếng Anh; là đầu vào cho model)
web/                giao diện: index.html + app.js + style.css, không build step, chạy offline
scripts/            tải model, chạy llama.cpp, index lại
tests/              kiểm offline
```

Dữ liệu nằm trong `data/` (gitignore): `docs/` (Markdown + ảnh + số trang), `uploads/`
(file gốc, để xử lý lại được), `index.sqlite`, `chat.sqlite`.

## Giới hạn hiện tại

- **Một người dùng, không đăng nhập.** Server mặc định chỉ nghe `127.0.0.1`. Mở ra mạng thì
  phải tự đặt proxy có xác thực phía trước.
- Chưa đọc được **ảnh đính kèm trong câu hỏi** (bản gốc có; cần model có `mmproj`).
- Mức độ model 3–4 bit **gắn đúng số [n]** chưa đo. Xem mục 9 của `docs/CAI_DAT.md`.
- Tài liệu văn bản thuần (`.txt`, `.md`) không có khái niệm trang.
