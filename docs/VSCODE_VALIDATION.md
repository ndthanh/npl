# Nopilot extension — kiểm chứng triển khai

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
