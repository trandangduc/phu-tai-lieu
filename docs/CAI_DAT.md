# Cài đặt Chat Tài Liệu trên một máy, một GPU 16 GB

Từ lúc kéo model về đến lúc hỏi được tài liệu và bấm vào trích dẫn. Mọi thứ chạy **cục
bộ**: không có dữ liệu nào rời khỏi máy.

Sơ đồ khi chạy xong:

```
trình duyệt ──► app  :7870  (FastAPI: giao diện, index, chat)
                 ├──► llama-server :8080  model chat  Qwen3.8-27B  (GPU)
                 ├──► llama-server :8081  embedding   Qwen3-Embedding-0.6B (CPU)
                 └──► MinerU (trong app, khi tải tài liệu lên)
```

Mỗi mục bên dưới ghi rõ cái nào **đã đo**, cái nào **chưa kiểm**.

---

## 0. Cần gì

| | Tối thiểu | Ghi chú |
|---|---|---|
| GPU | NVIDIA 16 GB VRAM | Card AMD/Apple vẫn chạy được llama.cpp, nhưng lệnh build khác |
| RAM | 32 GB | MinerU + embedding chạy CPU |
| Ổ đĩa | ~25 GB trống | Model chat 12 GB + MinerU (torch) vài GB + dữ liệu |
| Phần mềm | CUDA toolkit 12.x, `cmake`, `git`, Python 3.10–3.14 | |

Kiểm trước khi tải gì (máy thường đã có sẵn một phần):

```bash
nvidia-smi                      # thấy GPU + driver
nvcc --version                  # CUDA toolkit
python3 --version
df -h ~                         # còn đủ chỗ không
which llama-server              # có sẵn llama.cpp chưa
```

---

## 1. Build llama.cpp (có CUDA)

```bash
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j
export PATH="$HOME/llama.cpp/build/bin:$PATH"     # thêm vào ~/.bashrc
llama-server --version
```

Qwen3.8 là kiến trúc lai (Gated DeltaNet + attention), **cần bản llama.cpp mới**. Nếu lúc
nạp model báo `unknown model architecture` thì `git pull` rồi build lại.

---

## 2. Kéo model về

```bash
pip install -U huggingface_hub          # có lệnh `hf`
cd <repo này>
bash scripts/download_models.sh         # mặc định: bản UD-Q3_K_XL (12,24 GiB) + embedding 0,6B
```

Script tải về `~/models/`:

| File | Dung lượng | Nguồn |
|---|---|---|
| `Qwen3.8-27B-UD-Q3_K_XL.gguf` | 12,24 GiB | `unsloth/Qwen3.8-27B-GGUF` |
| `Qwen3-Embedding-0.6B-Q8_0.gguf` | 610 MB | `Qwen/Qwen3-Embedding-0.6B-GGUF` |

(Tên file và dung lượng tra trên HuggingFace ngày 2026-09-19.)

---

## 3. Chọn bản lượng tử cho 16 GB

Qwen3.8-27B là model **dense**: sinh mỗi token phải đọc hết trọng số. Nên 16 GB chỉ vừa
bản 3–4 bit, và phải chừa chỗ cho KV cache + buffer tính toán (~1,5–2,5 GB):

| Bản | Trọng số | Với 16 GB | Khi nào chọn |
|---|---|---|---|
| UD-Q4_K_M | 15,33 GiB | **Không vừa** | Chỉ khi GPU ≥ 24 GB |
| UD-IQ4_XS | 13,27 GiB | Sát, ctx ~16K | Muốn chất lượng cao nhất có thể, chấp nhận ngữ cảnh ngắn |
| **UD-Q3_K_XL** | 12,24 GiB | Dư, ctx 32K | **Mặc định** |
| UD-IQ3_XXS | 10,18 GiB | Dư nhiều | GPU còn phải gánh việc khác (vd MinerU) |

Đổi bản: `QUANT=UD-IQ4_XS bash scripts/download_models.sh`, rồi chạy bước 4 với
`MODEL=~/models/qwen3.8-27b/Qwen3.8-27B-UD-IQ4_XS.gguf CTX=16384`.

Vì sao 32K là đủ: mỗi lượt hỏi, app nạp tối đa `CONTEXT_CHARS=24000` ký tự đoạn trích
(≈ 7–9K token) + prompt + 4 tin nhắn cũ. Qwen3.8 chỉ có một phần các lớp giữ KV cache, nên
ngữ cảnh rẻ hơn model thường cùng cỡ.

**Tốc độ — ước lượng, CHƯA ĐO**: tốc độ sinh chữ ≈ băng thông bộ nhớ GPU ÷ dung lượng trọng
số. Khoảng 20 tok/s trên card 16 GB tầm RTX 4060 Ti (288 GB/s), 40–50 tok/s trên card tầm
RTX 4080/5080 (~700–960 GB/s). llama.cpp chưa có MTP (thứ làm vLLM nhanh gấp đôi với model
này ở máy chủ).

---

## 4. Chạy model chat

```bash
bash scripts/run_llm_llamacpp.sh
# đợi dòng "server is listening", rồi ở terminal khác:
curl http://127.0.0.1:8080/v1/models
```

Tham số quan trọng trong script:
- `-ngl 999` đẩy mọi lớp lên GPU. Báo **out of memory** thì theo thứ tự: giảm `CTX`
  (`CTX=16384`), rồi đổi sang bản lượng tử nhỏ hơn. Đừng hạ `-ngl` trước: để lớp nằm ở CPU
  thì tốc độ tụt nhiều lần.
- `--cache-type-k/v q8_0` nén KV cache còn một nửa (cần `-fa on`).
- `--jinja` để dùng chat template của model. App gửi `enable_thinking=false` để Qwen trả lời
  thẳng, không sinh phần suy nghĩ (hỏi đáp tài liệu không cần và tốn thời gian).
- `-np 1`: một người dùng, một luồng. Toàn bộ KV dành cho một cuộc hỏi.

---

## 5. Chạy model embedding

```bash
bash scripts/run_embed_llamacpp.sh          # CPU mặc định
curl http://127.0.0.1:8081/v1/models
```

- `--pooling last` là **bắt buộc** với Qwen3-Embedding. Thiếu nó thì vector vẫn ra, không
  báo lỗi, nhưng truy hồi tệ hẳn.
- Chạy CPU để nhường VRAM cho model chat. Hỏi đáp chỉ nhúng một câu mỗi lượt (nhanh). Nạp
  tài liệu lớn thì chậm hơn. GPU còn chỗ thì chạy `NGL=999 bash scripts/run_embed_llamacpp.sh`.
- **Đổi model embedding = phải index lại** (`python -m scripts.reindex --tat-ca`). Vector
  của hai model khác số chiều, trộn lẫn thì phần tìm theo nghĩa bị tắt (app in cảnh báo và
  chỉ còn tìm theo từ khoá).

---

## 6. Cài app

```bash
cd <repo này>
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ingest.txt       # MinerU (nặng, có torch) — xem mục 7
cp .env.example .env                         # mặc định đã trỏ đúng :8080 / :8081
python -m tests.test_offline                 # 14 kiểm, không cần model — phải "pass hết"
```

---

## 7. Nạp tài liệu (MinerU) trên 16 GB

MinerU đổi PDF/Word/PowerPoint/ảnh thành Markdown **kèm dữ liệu số trang**. Có hai mức, và
lựa chọn phụ thuộc vào loại tài liệu:

| `MINERU_TIER` | Chạy ở | Hợp với | Đo được (ở máy chủ, PDF scan tiếng Việt) |
|---|---|---|---|
| `basic` | CPU | PDF **có lớp chữ** (xuất từ Word, datasheet) | Scan tiếng Việt: đúng tên **2/20**, lỗi ký tự 8,75% |
| `standard` | cần thêm model MinerU2.5 (~1,2B) | PDF **scan**, ảnh chụp, tiếng Việt | Đúng tên **19/20**, lỗi ký tự 0,23%, ~11 s/trang |

Model MinerU2.5 chiếm thêm ~2–5 GB VRAM. Trên 16 GB **không chạy song song được** với bản
Qwen3.8 Q3/Q4. Ba cách:

1. **Chỉ dùng `basic`** (mặc định). Đủ cho tài liệu số. Đơn giản nhất.
2. **`standard` với engine cục bộ của MinerU**: để trống `MINERU_VLM_URL`, đặt
   `MINERU_VLM_ENGINE=llama-cpp`. MinerU tự tải và chạy MinerU2.5 lần đầu. **CHƯA KIỂM** trên
   máy 16 GB: chưa biết nó chạy GPU hay CPU, và có đụng VRAM của model chat không. Thử với một
   file nhỏ trước.
3. **Tắt model chat lúc nạp scan hàng loạt**: dừng `run_llm_llamacpp.sh`, chạy server
   MinerU2.5 riêng (vLLM, cần `--hf-overrides '{"tie_word_embeddings": true}'`, thiếu nó
   thì model sinh toàn `!!!!`), đặt `MINERU_TIER=standard` +
   `MINERU_VLM_URL=http://127.0.0.1:8010`, nạp xong thì bật lại chat.

Server MinerU2.5 không trả lời thì app **tự rơi về `basic`**: tải lên vẫn thành công, và
trạng thái ghi rõ mức đã dùng.

App **giữ file gốc** trong `data/uploads/`. Sau khi đổi mức thì xử lý lại được:
`curl -X POST http://127.0.0.1:7870/api/docs/<tên>/reprocess`.

---

## 8. Chạy và kiểm

```bash
python -m app.server            # mở http://127.0.0.1:7870
```

Kiểm theo thứ tự:

1. Góc trái dưới có hai chấm **xanh**: LLM và Embedding. Đỏ thì xem lại bước 4/5.
2. Kéo một PDF vào ô "Tải lên". Trạng thái chạy tới `xong · N đoạn · …s`. Nếu có chữ
   **"không có số trang"** thì MinerU không sinh `_content_list.json` (thường do file là
   `.txt`/`.md`: văn bản thuần không có khái niệm trang).
3. Hỏi một câu mà câu trả lời nằm ở trang giữa tài liệu. Câu trả lời phải có số tròn
   **[1] [2]…**
4. Rê chuột lên một số: hiện tên tài liệu, **tr. N**, mục, và nguyên văn đoạn trích.
5. Bấm vào số đó: khung phải mở tài liệu, cuộn tới đoạn đó và **tô vàng**, đầu khung ghi
   **Trang N**. Mở file gốc tới trang N để đối chiếu.

---

## 9. Số trang có đúng không, và phụ thuộc vào đâu

**Số trang không do model sinh ra.** Code tính nó bằng cách đối chiếu đoạn trích với
`<tài liệu>_content_list.json` mà MinerU ghi (mỗi khối chữ kèm số trang). Đổi model chat hay
bản lượng tử thì số trang **y hệt**. Các quy tắc đã khoá bằng test:
- Dòng mục lục (`Absolute Maximum Ratings ..... 25`) bị bỏ, để không trả về trang mục lục.
- Đoạn quá ngắn (`Table 15.`) thì tra bằng tiêu đề mục.
- Chữ do model thị giác chèn thêm (mô tả ảnh) không có trong file gốc, nên không được dùng để
  tra trang.
- **Không chắc thì không hiện trang** (`không rõ trang`). Sai trang nguy hơn không có trang.

Cái **phụ thuộc model** là đặt số [n] vào **đúng** đoạn trích. Bản lượng tử 3–4 bit dễ gắn
nhầm số hơn bản 8 bit, nhưng mức độ **chưa đo**. Cách đo: chuẩn bị 20 câu hỏi có đáp án biết
trước trang, hỏi từng câu, đếm số [n] mà đoạn được trỏ tới thật sự chứa dữ kiện đó. Làm với
hai bản lượng tử (vd Q3_K_XL và IQ4_XS) để thấy đánh đổi.

---

## 10. Chạy nền khi khởi động máy (systemd --user)

`~/.config/systemd/user/tailieu-llm.service`:

```ini
[Unit]
Description=Chat Tai Lieu - model chat (llama.cpp)

[Service]
WorkingDirectory=%h/phu-tai-lieu
Environment=PATH=%h/llama.cpp/build/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/phu-tai-lieu/scripts/run_llm_llamacpp.sh
Restart=on-failure

[Install]
WantedBy=default.target
```

Làm tương tự cho `tailieu-embed.service` (`run_embed_llamacpp.sh`) và `tailieu-app.service`
(`ExecStart=%h/phu-tai-lieu/.venv/bin/python -m app.server`). Rồi:

```bash
systemctl --user daemon-reload
systemctl --user enable --now tailieu-llm tailieu-embed tailieu-app
loginctl enable-linger $USER          # để service chạy cả khi chưa đăng nhập
```

`Restart=always` nghĩa là kill process vô ích, muốn dừng phải `systemctl --user stop`.

---

## 11. Gặp lỗi

| Hiện tượng | Nguyên nhân | Sửa |
|---|---|---|
| llama-server: `out of memory` / `failed to allocate` | Trọng số + KV vượt VRAM | Giảm `CTX`, rồi đổi bản lượng tử nhỏ hơn (mục 3) |
| `unknown model architecture` | llama.cpp quá cũ | `git pull` + build lại (mục 1) |
| Câu trả lời mở đầu bằng một đoạn "suy nghĩ" dài | Template không nhận `enable_thinking` | Kiểm `--jinja` có trong lệnh chạy |
| Tìm kiếm kém, câu trả lời lạc đề | Embedding thiếu `--pooling last`, hoặc vừa đổi model embedding | Sửa lệnh chạy / `python -m scripts.reindex --tat-ca` |
| Log app: `số chiều vector lệch` | Index cũ nhúng bằng model embedding khác | `python -m scripts.reindex --tat-ca` |
| Tải lên báo `BrokenProcessPool` | MinerU chạy tiến trình con, cần app chạy bằng `python -m app.server` | Đừng chạy app từ REPL/stdin |
| Tài liệu "không có số trang" dù là PDF | Nạp bằng bản app cũ, hoặc MinerU lỗi lúc ghi | Bấm xử lý lại (mục 7) |
| PDF scan tiếng Việt ra chữ vô nghĩa | Đang ở `basic` (không có OCR tiếng Việt) | Dùng `standard` (mục 7) |
