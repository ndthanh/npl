# Nopilot for VS Code — đề xuất thiết kế

Ngày khảo sát: 28/10/2026. Đây là bản thiết kế ban đầu được lưu lại. Trạng thái triển khai và kiểm chứng hiện hành nằm trong [VSCODE_VALIDATION.md](VSCODE_VALIDATION.md); hướng dẫn sử dụng tại [extension/README.md](../extension/README.md).

Repository hiện ở `main`, commit `16777ba`, working tree sạch khi bắt đầu khảo sát. Nhánh đề xuất sau khi chốt: `feat/vscode-extension`. Chưa tạo nhánh, sửa production code hoặc push thay đổi trong bước thiết kế này.

## 1. Hướng sản phẩm

Nopilot trở thành extension chat làm việc ngay trong workspace VS Code. Giữ transport Frida tới Teams Copilot; chuyển quản lý workspace, context, review file, chạy lệnh và lịch sử thao tác sang Extension Host.

Thay đổi quan trọng so với bản Web: **workspace đang mở là source thật**. Không nhập một bản sao project để phát triển ở chỗ khác. Sau khi người dùng duyệt, edit áp dụng vào workspace đang mở và hiện trong Source Control của VS Code. Nội dung chưa lưu, file đang sửa và thay đổi Git sẵn có đều được bảo vệ bằng kiểm tra version/hash và diff.

Không fork toàn bộ Cline/Continue: tham khảo mô hình tương tác, xây UI gọn cho workflow Teams. Không đem Dev panel cũ vào một iframe trong VS Code.

## 2. Tham khảo giao diện

- **Cline:** chat trong sidebar, mở được trong editor tab, Plan/Act, duyệt edit/command trong hội thoại và mở diff bằng editor. Checkpoint dùng shadow Git riêng. [IDE workflow](https://docs.cline.bot/usage/ide), [Checkpoints](https://docs.cline.bot/core-workflows/checkpoints).
- **Continue:** context chọn qua file, selection, Git diff, terminal; context là một phần rõ ràng của composer. [Context selection](https://docs.continue.dev/ide-extensions/chat/context-selection).
- **VS Code:** giữ Explorer, native diff, Terminal/Tasks, Problems và Source Control; webview chỉ dành cho hội thoại cùng card hành động. [Webviews](https://code.visualstudio.com/api/ux-guidelines/webviews), [Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars).

API Chat Participant hiện bị đánh dấu deprecated trong tài liệu Microsoft, không chọn làm nền cho tích hợp mới. Language Model Chat Provider là hướng khác nhưng yêu cầu semantics model API (messages, capabilities, token counting...) không khớp tự nhiên với Teams UI transport. Chọn WebviewView cho chat riêng, dùng API native cho phần còn lại. [Chat Participants](https://code.visualstudio.com/api/extension-guides/ai/chat), [Language Model Chat Provider](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider).

## 3. Hai bố cục

### Đã chốt: chat cạnh editor

- Explorer bên trái, code/diff ở giữa, Nopilot ở sidebar bên cạnh.
- Thanh đầu: tên conversation, tạo mới, lịch sử, trạng thái Teams; cài đặt là lệnh/menu, không có dashboard.
- Hội thoại: Markdown, trạng thái các bước, card context/đề xuất sửa/chạy lệnh, link tới file và output.
- Composer: Ask / Develop, context chips, ô nhập, gửi/dừng tác vụ đang hỗ trợ.
- Giao diện dùng VS Code theme tokens, font editor, Codicons, phím và focus native.

VS Code mặc định đóng góp view vào Primary Sidebar; người dùng có thể kéo sang Secondary Sidebar. Không tự chiếm chỗ GitHub Copilot hoặc đổi bố cục toàn editor. Hướng dẫn lần đầu chỉ cách chuyển sang bên phải.

### Mở rộng: chat trong editor tab

Một editor tab Nopilot dùng cùng conversation/state với sidebar. Phù hợp màn hình nhỏ hoặc chat dài. Khi cần review, mở native diff bên cạnh. Không tạo hai conversation độc lập chỉ vì mở hai bề mặt.

Chỉ có một nhóm thao tác cần thiết ở mỗi card:

1. Context: “Xem nội dung gửi” / “Bỏ file”.
2. Đề xuất sửa: “Xem diff” → “Áp dụng N file” / “Từ chối”.
3. Chạy lệnh: hiện command, interpreter, cwd, timeout → “Duyệt và chạy”.
4. Hoàn tất: “Xem log”, “Khôi phục checkpoint”, “Yêu cầu sửa tiếp”.

Lịch sử hội thoại mở qua menu/Quick Pick, không tạo thêm một sidebar danh sách conversation thường trực. Pin/xóa chỉ áp dụng lịch sử local Nopilot, không xóa Teams chat.

## 4. Context: VS Code biết gì, Copilot nhận gì?

Extension đọc được workspace, document đang mở, selection, diagnostics và Git diff. **Copilot trong Teams chỉ biết nội dung thực sự được gửi qua bridge**, không tự truy cập file local chỉ vì chúng mở trong VS Code.

### Context đầu tiên

- Metadata workspace: tên folder, ngôn ngữ và cấu trúc liên quan có giới hạn.
- Nội dung file/selection chỉ gửi khi người dùng chọn hoặc chấp nhận phạm vi context của lượt gửi.
- `@selection`, `@file`, `@folder`, `@workspace`, `@problems`, `@gitdiff`; Tab gợi ý tên/path từ workspace.
- Preview liệt kê file/range, trạng thái chưa lưu, dữ liệu bị loại, phương thức inline/file/bundle.
- File chưa lưu lấy từ document buffer; không âm thầm lưu đĩa. Phiên bản buffer gửi đi được gắn vào base context để kiểm tra trước khi apply.
- Multi-root: mỗi conversation chọn một root; không tự trộn source ở các root khác nhau.
- `.nopilotignore` áp dụng mọi đường thu thập, kể cả @ mention. Mặc định thêm bộ loại metadata Git, runtime và secret; không âm thầm gửi file bị loại. Nếu muốn override, phải chọn lại có hiển thị rõ, không để model tự override.

### Tự chọn hình thức gửi

1. Selection/vài file nhỏ: inline text có path, range, base version/hash.
2. Context dài hơn: file Markdown có cấu trúc, tự upload.
3. Bootstrap nhiều file/toàn project cần thiết: ZIP bytes mang đuôi TXT, tự tạo và upload, vẫn theo ignore.

Giới hạn bridge đang có phải được hiển thị và kiểm tra: tối đa 3 attachment, 1 MiB/file bridge; project pack hiện có 16 MiB source/2.000 file. Không hứa gửi project bất kỳ kích thước. Nếu quá lớn, yêu cầu chọn scope hẹp hơn; không âm thầm cắt source.

Có context manifest và content hash; lượt sau chỉ gửi phần đã đổi khi model còn nhận diện được context trước đó. Đây là tối ưu transport, không phải bảo đảm model còn nhớ toàn bộ project. Khi mất context/đổi Teams conversation, tự chuẩn bị lại context sau khi người dùng xem phạm vi.

## 5. Đường trả code: ưu tiên changeset, giữ ZIP làm fallback

Với sửa nhỏ, prompt contract yêu cầu model trả changeset có cấu trúc: context ID, file path tương đối, base hash, nội dung mới hoặc patch và commit message. Extension phân tích, xác thực, stage đề xuất, mở diff native; không thực thi câu chữ trong chat.

Ví dụ phác thảo protocol, chưa là schema chốt:

```json
{
  "type": "change_set",
  "baseContextId": "context-17",
  "edits": [
    {"path": "main.py", "baseSha256": "hash-tu-manifest-da-gui", "content": "noi-dung-moi"}
  ],
  "deletes": [],
  "commitMessage": "fix: update screenshot target"
}
```

Model có thể yêu cầu context bổ sung trong root đã chọn. Các path ngoài scope/ignore không được đọc theo chỉ dẫn của model; yêu cầu mở rộng phạm vi phải hiện card. Giới hạn lượt rõ ràng, không repair JSON vô hạn. Một câu trả lời prose bình thường vẫn được hiển thị; không suy ra edit từ mọi code block.

ZIP vẫn hỗ trợ cho tạo project nhiều file hoặc khi structured output không ổn: download → giải nén vào staging → tạo cùng loại changeset → review. **Thiếu file trong ZIP không mặc nhiên xóa file workspace.** Xóa cần mục deletes rõ ràng và duyệt riêng trong diff. Không ghi đè `.git`, `.venv`, dependencies, outputs hoặc file ngoài workspace.

## 6. Vòng phát triển đề xuất

1. Mở folder bằng VS Code, mở Nopilot, kết nối Teams.
2. Chọn Ask (chỉ phân tích) hoặc Develop (đề xuất sửa); thêm context bằng @ hoặc selection.
3. Gõ yêu cầu, ví dụ: “Đổi trang chụp ảnh sang facebook.com, giữ cấu hình Edge, cập nhật test”.
4. Extension thu context phù hợp; người dùng xem những file sẽ gửi. ZIP/TXT là chi tiết tự động bên trong khi cần.
5. Copilot trả changeset/ZIP; Nopilot stage và hiện card “2 file thay đổi”.
6. Người dùng mở diff trong editor, chọn áp dụng/từ chối từng file hoặc cả batch. Trước apply tạo checkpoint. Version/hash khác base thì dừng để lấy diff mới; không ghi đè buffer chưa lưu.
7. File thay đổi xuất hiện trong Explorer/Source Control. Tạo run plan độc lập nếu cần install/test/start.
8. Người dùng duyệt command thực tế; chạy bằng VS Code Task/Terminal (CMD/ProcessExecution), log trong Output/Terminal. Python interpreter/venv được dùng lại nếu phù hợp.
9. Test xong, đính kèm phần log đã chọn hoặc Problems, gửi yêu cầu tiếp. Không tự gửi toàn terminal history.

Ask không sửa file, cài package hoặc chạy command. Develop vẫn phải duyệt file và lệnh. Không có auto-approve mặc định. Đề xuất lệnh là dữ liệu có program/args/cwd, không phải văn bản tự chuyển thành shell. Không dùng PowerShell mặc định.

## 7. Git và checkpoint

- Checkpoint riêng của Nopilot trước mỗi batch apply, dùng để backup; không trộn vào lịch sử repo người dùng.
- Native Source Control cho xem thay đổi và commit thật vào repo.
- Có thể đề xuất commit message qua Copilot. Commit thật chỉ khi người dùng chọn, chỉ gồm file/hunk đã duyệt; không tự `git add .`, không gộp các sửa đổi khác của người dùng, không tự push.
- Restore phải kiểm tra sửa đổi mới phát sinh sau checkpoint và mở diff nếu có xung đột.
- `.venv` ở workspace giữ nguyên qua edit code. Cài dependencies là card riêng chỉ xuất hiện khi cần; không xoá/tạo lại venv mỗi lượt.

## 8. Kiến trúc và phần được giữ

```text
Nopilot WebviewView / Editor tab
             ↕ typed messages
VS Code Extension Host (TypeScript)
  context · changesets · approvals · checkpoint · tasks · persistence
             ↕ request IDs / events qua stdio
Python bridge sidecar
  Frida attach/discovery · Teams navigation/chat · uploads/downloads
             ↕
Teams Copilot
```

Giữ và đóng gói lại bridge: `agent.js`, `bridge.py`, `memory_scan.py`, `refresh_build.py`, manifest build và DOM→Markdown của response. Các thao tác chat/navigation/upload/download cần được tách ra adapter tối thiểu từ CLI cũ; không port cả CLI/web orchestrator. Kiểm tra module hash và refresh symbols vẫn giữ nguyên.

Không đem sang sản phẩm mới: HTTP web server, web app shell/Dev panel, managed-copy workspace, Python run/apply/Git orchestrator và UI state của bản Web. `main` giữ bản Web để đối chiếu; nhánh mới chỉ mang phần bridge cần thiết và mã extension mới.

Sidecar dùng Python/Frida vì bridge đã kiểm thử trên Windows. Một hàng đợi tuần tự cho Teams; request IDs, timeouts và response events rõ ràng. Không parse stdout log như RPC: stdout chỉ protocol, stderr cho diagnostics. Reconnect/restart không tự gửi lại prompt/upload/command. Nếu chưa xác định được request cuối đã gửi hay chưa, hiển thị trạng thái cần kiểm tra.

Chưa cam kết token streaming: bridge hiện xác nhận response hoàn tất. MVP hiển thị trạng thái đang chờ; incremental snapshots chỉ bổ sung sau khi kiểm chứng, không mô phỏng thành token stream.

Lưu conversation/artifacts/checkpoint vào extension storage theo workspace URI; không chép transcript vào repository. Settings dùng VS Code Settings, tài liệu mở Markdown preview/Walkthrough. Không tạo dashboard cấu hình riêng.

## 9. Phạm vi MVP

- VS Code desktop trên Windows, workspace local và Teams chạy cùng máy. WSL/SSH/container/VS Code Web để giai đoạn sau vì bridge phải attach process Windows local; không tự coi đường dẫn remote là đường dẫn local.
- Workspace Trust: đọc/preview hạn chế ở Restricted Mode; apply/run/bridge-sensitive setup chỉ khi workspace trusted. Trust không thay thế duyệt file/lệnh. [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust).
- Tôn trọng nội dung chưa lưu, symlink, path traversal, multi-root boundary và thay đổi đồng thời.
- Không giữ song song một agent Web và extension điều khiển cùng Teams composer.
- Không hứa model nhận full history/tool-native API; đây vẫn là transport UI và structured prompt contract.

## 10. Các mốc sau khi chốt

| Mốc | Nội dung | Điều kiện đạt |
|---|---|---|
| Nhánh và bridge | Tạo `feat/vscode-extension`, tách bridge sidecar + RPC | Chat/upload/download/reconnect chạy, không phụ thuộc HTTP server, không resend sau timeout |
| Chat và context | Sidebar/tab, Markdown, history theo workspace, @selection/@file, ignore, context preview | Selection/dirty buffer đúng; không gửi file bị loại; đóng/mở VS Code không mất draft |
| Edit và review | Changeset contract, native diff, WorkspaceEdit, checkpoint, ZIP fallback | Không đổi file trước duyệt; stale version bị từ chối; restore không đè edit mới; ZIP thiếu file không tự xóa |
| Dev loop và VSIX | Tasks/Terminal, install/test/start approvals, logs, Git message, guide và packaging | Code-only change dùng lại venv; lỗi install không start; log chỉ gửi khi chọn; test thật từ Extension Development Host rồi phát VSIX |

Chỉ bắt đầu mốc đầu tiên sau khi người dùng thống nhất UI/phạm vi.

## 11. Quyết định hiện tại

1. Người dùng đã chốt **chat cạnh editor**, cần mở rộng được và có lịch sử/đổi tên/xóa local.
2. Thiết kế tiếp tục dùng workspace thật sau duyệt, checkpoint riêng, Source Control native; chưa triển khai extension.
3. Bổ sung thiết kế model phụ, dán ảnh, công cụ web và AG-UI dưới đây. Tool web triển khai theo từng mức; không coi việc hỏi kiến trúc là đã có tool hoạt động.

## 12. Pane mở rộng và lịch sử local

- Sidebar có thể kéo rộng theo bố cục VS Code. Nút “Mở rộng” mở cùng conversation trong editor tab; người dùng có thể maximize editor group. “Về sidebar” quay lại cùng draft, attachments, vị trí đọc và pending approvals. Không tạo bản sao run hoặc bridge session.
- Header tối giản: tên hội thoại, tạo mới, lịch sử, mở rộng, menu phụ. Trạng thái Teams nằm dưới tên hoặc trong status indicator.
- Lịch sử mở bằng nút đồng hồ: danh sách tìm kiếm theo tên/nội dung, conversation được pin đứng đầu, sau đó theo thời điểm cập nhật; mặc định theo workspace, có bộ lọc tất cả workspace.
- Menu mỗi conversation: đổi tên, pin/bỏ pin, xóa khỏi Nopilot. Tên đầu tự sinh từ prompt đầu, người dùng luôn sửa được.
- Xóa local đưa metadata/transcript vào thùng rác có thể khôi phục; không gửi lệnh xóa hoặc đổi tên tới Teams. Không xóa workspace, checkpoint hay artifacts như tác dụng phụ. Dọn artifacts là thao tác riêng có hiển thị phạm vi.
- Nếu đang chạy, yêu cầu dừng hoặc chờ kết quả trước khi xóa; xóa history không được hiểu là hủy command đang chạy. Xóa local không thu hồi dữ liệu đã gửi Copilot.
- Persistence gồm localConversationId, workspace URI, title, pin, timestamps, draft, messages, artifact references, run/action state và Teams conversation reference khi bridge xác định được.
- Mở lịch sử hiển thị transcript local ngay. Tiếp tục gửi phải khôi phục và xác minh đúng Teams conversation. Nếu bridge chưa hỗ trợ khôi phục, báo rõ và cho chọn mở Teams conversation tương ứng hoặc tạo phiên mới kèm context đã chọn; không gửi nhầm vào conversation đang foreground.

## 13. Model phụ và Agent Gateway tùy chọn

Extension Host giữ một bộ điều phối xác định cho chat, context, approval và executor. Model nhỏ là adapter tùy chọn: hiểu yêu cầu, chọn context, đề xuất tool calls, chuyển câu trả lời Copilot thành changeset có schema và tóm tắt log. Không cần model để zip, upload, apply hoặc chạy một contract đã xác thực.

```text
Chat Webview ↔ event adapter ↔ Orchestrator
                                ├─ Copilot adapter → Python/Frida → Teams
                                ├─ Optional small-model adapter
                                └─ Tool registry → approval policy → local executors
External local agent ↔ optional authenticated loopback gateway ↗
```

- Nội bộ extension dùng typed messages/stdio; không bắt buộc mở HTTP port.
- Khi bật tích hợp ngoài: gateway bind 127.0.0.1 trên port cấu hình hoặc port trống được chọn, bearer token lưu trong VS Code SecretStorage, HTTP cho request và SSE cho events. Không nhúng token vào webview hay transcript, không bind 0.0.0.0 mặc định.
- Contract có version, conversationId, runId, requestId; khám phá capabilities và schema trước khi gọi. Nhóm API: tạo/tiếp tục run, đọc events/state, đề xuất tool action, trả tool result. Chỉ UI tin cậy của VS Code quyết định approval; external agent không tự gửi approval thay người dùng.
- Copilot send/read/upload là một adapter có hàng đợi duy nhất. Tránh hai client cùng nhập Teams composer. Một timeout không tự resend.
- Action đề xuất dùng tool name + JSON args, không eval code hoặc suy diễn shell từ prose. Validate schema, workspace scope, ignore, base version và quyền của run trước khi thực hiện.
- Model phụ không có quyền cao hơn Copilot. Sửa file, install/run và thao tác web có tác dụng phụ đều qua cùng policy/approval. Model có thể đề xuất, không tự cấp quyền.
- MVP có thể dùng adapter model hỗ trợ structured output; endpoint/model/API key cấu hình trong Settings/SecretStorage. Không bắt buộc framework agent hoặc một nhà cung cấp model cụ thể.

## 14. Dán ảnh vào composer

Luồng dự kiến: Ctrl+V trong webview → image clipboard item → thumbnail trong draft → extension xác thực bytes/MIME/kích thước → lưu artifact local → upload bằng bridge lúc gửi prompt. Người dùng có thể xem, bỏ ảnh, thấy số attachment và dung lượng trước gửi.

VS Code Clipboard API hiện chỉ cung cấp readText/writeText; không dùng nó để giả định đọc được ảnh. Cần thử nghiệm paste event/clipboardData trong Webview thực tế trên VS Code Windows. Nếu không nhận được image item, fallback nút chọn ảnh qua vscode.window.showOpenDialog, không dùng HTML file upload input. [VS Code API](https://code.visualstudio.com/api/references/vscode-api).

- Ảnh là attachment thật, không thay bằng OCR hoặc Markdown path giả. Phải kiểm thử khả năng nhận ảnh hiện có của Teams bridge.
- Giới hạn hiện tại: tối đa 3 attachments, 1 MiB/file bridge. Context bundle và ảnh dùng chung ngân sách này; tính tổng trước khi gửi.
- Có thể giảm kích thước/re-encode ảnh với preview và thông báo; không cắt nội dung hoặc giảm chất lượng khó đọc âm thầm. Giữ bản gốc local theo retention của conversation.
- Không tự đọc clipboard nền. Draft ảnh còn sau khi chuyển sidebar/tab hoặc reload. Không ghi ảnh vào Git repo nếu chưa được người dùng chọn lưu vào workspace.

## 15. Công cụ web local

Hai đường thu thập dùng chung output contract:

1. web.read: HTTP client tải trang tĩnh theo URL, BeautifulSoup chọn nội dung, HTML-to-Markdown làm sạch và giới hạn độ dài. BeautifulSoup là parser, không tự điều khiển browser hay chạy JavaScript. [BeautifulSoup](https://www.crummy.com/software/BeautifulSoup/bs4/doc/).
2. browser.open/snapshot/click/fill/screenshot: Python Playwright cho trang cần JavaScript, đăng nhập hoặc tương tác. Dùng browser context/profile riêng của Nopilot và cho mở cửa sổ để người dùng đăng nhập khi cần; không tự lấy cookie/profile browser cá nhân. [Browser contexts](https://playwright.dev/python/docs/browser-contexts).

Browser truy cập được không bảo đảm HTTP client hoặc browser profile mới dùng đúng proxy/SSO. Cần test thực tế; lỗi HTTP có thể chuyển sang browser với trạng thái rõ ràng. Không hứa mọi công cụ search hoạt động chỉ vì một trang mở được.

Không có API search thì dùng adapter trang tìm kiếm/website người dùng chọn bằng Playwright, lấy các kết quả thực tế rồi đọc nguồn. CAPTCHA hoặc yêu cầu đăng nhập chuyển cho người dùng; không có bypass. Ưu tiên URL người dùng cung cấp trong MVP.

Tool result gồm source URL cuối, title, fetchedAt, text/Markdown, link references, truncation, error và artifact IDs. Nội dung website được đánh dấu dữ liệu nguồn, không được biến chỉ dẫn trong trang thành tool calls hoặc tăng quyền.

Copilot được bootstrap bằng manifest tools và JSON schema: tool_request chứa id/name/args. Nopilot validate → chạy/đợi duyệt → gửi tool_result cùng request id về Teams. Nếu không có JSON hợp lệ, hiển thị câu trả lời và một lần hướng dẫn sửa format; không tự chạy code block bất kỳ. Tool loop mặc định 20 lượt gọi Copilot; hiển thị cả số vòng và số tool calls. Hết ngân sách xin thêm lượt; không tự mở run mới để vượt giới hạn.

Context ngắn gửi inline có nguồn. Context dài lưu Markdown artifact và upload trong ngân sách 3 file/1 MiB. Vượt giới hạn thì chia scope/lấy phần liên quan với thông báo, không âm thầm cắt rồi coi là đầy đủ. UI có thể mở nguồn, đọc nội dung sắp gửi, xem screenshot và tải kết quả.

Tool registry ban đầu cung cấp hành động browser có schema để explore. Chạy script Playwright tùy ý do Copilot trả về đi qua workflow project/code review + duyệt chạy hiện có; không coi một script Python là tool call đọc web vô hại.

## 16. AG-UI: chuẩn sự kiện cho giao diện

Đề xuất dùng AG-UI làm contract events giữa orchestrator và UI. Các event lõi gồm RUN_STARTED/RUN_FINISHED/RUN_ERROR, TEXT_MESSAGE_START/CONTENT/END, TOOL_CALL_START/ARGS/END/RESULT, STATE_SNAPSHOT/STATE_DELTA. Dùng CUSTOM cho sự kiện domain approval/context/artifact có schema và version riêng. Không sửa shape event chuẩn hoặc tuyên bố custom schema là một phần chuẩn AG-UI. [Overview](https://docs.ag-ui.com/introduction), [Events](https://docs.ag-ui.com/concepts/events).

- Webview nhận cùng event objects qua postMessage; gateway ngoài có thể dùng SSE. Transport nội bộ không bắt buộc HTTP chỉ để đạt UI giống nhau.
- UI render timeline: đang gom context → gửi Teams → chờ Copilot → tải artifact → chờ duyệt → chạy test → kết quả. Card cập nhật theo action ID, không thêm bản sao mỗi lần reconnect.
- TOOL_CALL_END chỉ đóng phần yêu cầu tool; không được hiển thị tool thành công trước TOOL_CALL_RESULT. Approval custom/state phải phân biệt pending/approved/rejected/expired.
- App tự quản persistence, event sequence, dedupe/idempotency và restore snapshot. AG-UI không tự cung cấp durable execution, bảo đảm exactly-once hay quyền chạy tool.
- Khi reconnect, khôi phục snapshot và nhận events mới; không replay lại side effect. Sau reload/đổi file, approval hết hiệu lực nếu nội dung action hoặc base đã đổi.
- Bridge Teams hiện chỉ có response cuối: phát progress thật và render câu trả lời khi nhận được. AG-UI không tạo token stream mà bridge không có; incremental content phải được kiểm chứng trước.
- AG-UI không thay Frida, tool registry hay changeset contract. MVP có thể dùng core types/validation và adapter nhỏ; không cần đưa toàn bộ CopilotKit UI vào VS Code.

## 17. Điều kiện kiểm thử bổ sung

- Sidebar/tab dùng cùng run; đổi bề mặt không gửi prompt hai lần, draft/ảnh/approval vẫn đúng.
- Đổi tên/pin/xóa/khôi phục local không sinh request rename/delete Teams; mở lại history không gửi nhầm Teams conversation.
- Paste screenshot thực tế trên Windows, ảnh vượt giới hạn, 3 attachment slots, reload draft và fallback OpenDialog trong môi trường chặn HTML input.
- Model phụ tắt vẫn chat/dev được; model trả action sai hoặc cố approve không vượt executor policy. Gateway sai token/ngoài loopback bị từ chối.
- Trang tĩnh, JS, đăng nhập, proxy lỗi, quá dài và nội dung chứa chỉ dẫn giả đều có kết quả/giới hạn rõ ràng; tool result khớp request ID.
- Reload/reconnect giữa upload, apply, command hoặc tool call không tự lặp tác dụng phụ. Hết 20 lượt dừng và hỏi user.

Đây là bổ sung thiết kế, chưa là báo cáo chức năng đã được triển khai hoặc kiểm thử trong extension.
