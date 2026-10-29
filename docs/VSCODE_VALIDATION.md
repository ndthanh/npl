# Nopilot extension — kiểm chứng triển khai

## Bản 0.2.3 — sửa model selector khi Copilot ở nền

- Tái hiện Teams đang chọn tab Chat: frame Copilot tồn tại, nút model có **0 layout rectangles**. Bộ lọc geometry ở 0.2.2 gây lỗi chọn model.
- Kiểm chứng Frida thật sau sửa: chọn/xác minh GPT-5.6 Sol Think deeper, gửi prompt mẫu, nhận **NOPILOT_BACKGROUND_OK**, Teams vẫn có Chat `aria-pressed=true` và Copilot `false`; không dùng chuột/bàn phím. Evidence: `outputs/nopilot-extension-validation/background-chat.json` ngoài repo.
- Sửa rediscovery dùng manifest đã khớp runtime đang attach, xử lý cả frame destroy.
- TypeScript qua; **59/59 Node**, **12/12 Python** qua.

## Bản 0.2.2 — 29/10/2026

- TypeScript check qua; **57/57 Node**, **11/11 Python** qua.
- Bỏ các hard limit dung lượng source/ZIP/attachment/download và số file của harness. Giữ tối đa 3 attachments/lượt. Truyền file Frida theo khối 192 KiB.
- Kiểm chứng Frida thật: Auto → GPT-5.6 Sol Think deeper → xác minh model; không gửi prompt. Manifest WebView2 156.0.4314.50 được lấy từ public PDB khớp hash; vẫn kèm manifest 155.0.4283.62.
- Frida attach_file → File input giả local → Blob → read_download: **3.145.728 bytes**, SHA-256 khớp. Đây là kiểm thử transfer thật với dữ liệu tổng hợp, không phải upload server Copilot hoặc model tạo file.
- `web.read` gọi HTTPS example.com khi import truststore được cố ý chặn: thành công bằng SSL context mặc định, vẫn xác minh certificate/hostname.
- Render bundle thật với 100 artifacts: mặc định thu gọn dưới 70 px, danh sách mở có vùng cuộn 220 px, không lỗi JS/tràn ngang ở 320 px. Đã xem ảnh render; không phải ảnh Extension Host.
- VSIX `nopilot-0.2.2.vsix` đóng gói thành công. Evidence ngoài repo: `large-transfer-model.json`, `upload-chunk-roundtrip.json`, `web-no-truststore.json`, `artifacts-collapsed-420.png`, `artifacts-expanded-420.png`.

Phần dưới lưu kết quả của đợt triển khai 0.2.0; giới hạn ZIP UTF-8/dung lượng được mô tả ở đó đã thay đổi trong 0.2.1/0.2.2.

Cập nhật 29/10/2026, nhánh `feat/vscode-extension`. Hướng dẫn sử dụng hiện hành: [extension/README.md](../extension/README.md). `VSCODE_DESIGN.md` lưu đề xuất thiết kế ban đầu; các khả năng dự kiến trong đó không mặc nhiên là đã hoàn thành.

## Đã triển khai

Chat sidebar/editor tab dùng chung state; history local theo workspace, rename/pin/trash/restore; Markdown/code; paste ảnh; context và `.nopilotignore`; tự bundle ZIP bytes thành TXT; review changeset, private Git checkpoint, explicit project Git commit; Python project contract/venv/dependency cache; web reader và browser tools; optional small model và gateway loopback; schema AG-UI events.

Bổ sung giao diện: icon/Codicons; menu chung khi gõ `@` hoặc `/`, Tab completion và native path chooser; output command/tool trong card thu gọn có cập nhật live; queue tối đa 10 tin, xóa/ưu tiên/pause/resume; dừng queue khi approval/context đổi/lỗi/reload; giọng nói local thêm transcript vào draft, chưa tự gửi. Shell contract chỉ nhận CMD; executable + argv vẫn được dùng cho tác vụ Python.

## Kiểm thử tự động hiện tại

- TypeScript `tsc --noEmit`: qua.
- Node: **47/47**. Gồm DOM menu/voice/queue/card output; path/ignore/source race/diff gate; CMD UTF-8; queue control/FIFO/pause/no retry uncertain; Python worker lifecycle với worker giả; AG-UI schemas; gateway auth/idempotency/SSE; Git checkpoint và dependency cache với disk/process thật, mock VS Code APIs.
- Python bridge: **7/7**.
- `npm audit --omit=dev`: **0 vulnerabilities** tại lần kiểm tra này.
- VSIX đóng gói thành công; không kèm node_modules, tests, source maps, model hoặc audio mẫu.
- Render **bundle webview thật**, mock VS Code transport, qua Edge headless ở 320/420/700 px: không JS error hoặc horizontal overflow. Đã xem ảnh menu và activity/queue.
- Nhận dạng local `faster-whisper-tiny` CPU/int8 trên file JFK công khai từ test của OpenAI Whisper: trả đúng câu tiếng Anh mẫu. Không ghi microphone người dùng. Cần `av>=16,<17` do API decoder thay đổi ở bản mới; `CT2_PACKED_GEMM=0` xử lý lỗi MKL allocation quan sát trên máy thử.

## Các luồng thật đã kiểm tra trong phiên phát triển

- VS Code UI → Teams qua Frida → nhận `NOPILOT_OK` và code block.
- Develop → nhận changeset greeting/main/check/contract → native diff → apply 3 files và checkpoint.
- Sau người dùng duyệt: tạo venv, chạy main greeting và check `PASS`, exit 0; plan tiếp theo tái sử dụng venv.
- Paste ảnh vào draft, preview và restore sau reload; ảnh thử không upload.
- Card `/url https://example.com` → đọc URL local → Markdown artifact → gửi context → nhận trả lời Copilot có nguồn.
- Bridge mutex thử hai sidecar: sidecar thứ hai bị chặn; tiếp quản được sau release. Không gửi prompt trong test mutex.
- HTTP reader và Playwright Edge open/snapshot/screenshot example.com thành công.

Các luồng thật trên được hoàn thành trước đợt bổ sung voice/queue/card mới. Sau đó desktop automation báo AccessDenied/ảnh đen; đợt UI mới kiểm chứng bằng DOM và render bundle, **chưa được xác minh lại toàn bộ trong Extension Development Host**.

## Giới hạn còn lại

- Chưa thử microphone thật, tiếng Việt hoặc model phụ/endpoint của người dùng.
- “Steer” ưu tiên **lượt kế tiếp**, chưa thay đổi được lượt Copilot đang generate.
- Teams bridge nhận response cuối, chưa có token streaming. AG-UI không tự bổ sung khả năng đó.
- ZIP fallback chỉ nhận source UTF-8 theo giới hạn README; binary assets chưa được áp dụng vào workspace.
- Không quản lý dev server dài hạn, không sandbox code đã duyệt, chưa có durable replay events qua restart.
- Bridge native phụ thuộc bản WebView2/hash manifest; Teams thay renderer có thể cần reconnect/read, không tự resend prompt.

Ảnh kiểm chứng lưu ngoài repo tại `outputs/nopilot-extension-validation/`: `live-project-check.png`, `context-dropup-*.png`, `activity-queue-*.png`; ba ảnh activity/queue dùng nội dung fixture minh họa, không phải kết quả chạy project mới.
