# Nopilot for VS Code

## Bản 0.2.2

- Đã bỏ hard limit dung lượng source, ZIP, file upload/download và số file do harness đặt. Tối đa **3 attachments/lượt** vẫn áp dụng. Copilot có thể từ chối upload theo giới hạn phía dịch vụ; Nopilot báo lỗi thực tế, không tự resend. `.nopilotignore` vẫn dùng để chọn source phù hợp.
- Truyền file qua Frida theo từng khối 192 KiB, thời gian chờ tính cả upload. 192 KiB là kích thước khối truyền, không phải giới hạn file.
- Artifacts mặc định thu gọn. Mở danh sách có vùng cuộn tối đa 220 px, giữ trạng thái mở khi output cập nhật; nút chạy project nằm riêng.
- `web.read` dùng `truststore` nếu có; nếu thiếu tự dùng SSL context mặc định Python/Windows với xác minh HTTPS bật. Không cần cài truststore chỉ để đọc web. BeautifulSoup/markdownify vẫn là dependencies bắt buộc.
- Trước upload/gửi prompt, bridge chọn và xác minh **GPT-5.6 Sol Think deeper**, kể cả khi Teams đang Auto. Không xác minh được thì dừng trước gửi. Đổi nhãn chính xác tại `nopilot.copilotModel`; để trống nếu muốn tự chọn model trong Teams.
- Kèm manifest WebView2 đã kiểm tra cho 155.0.4283.62 và 156.0.4314.50; chỉ nạp offsets khi hash DLL khớp.

## Bản 0.2.1 — ZIP vào workspace

Hội thoại mới mặc định **Develop** và tự lấy source workspace theo `.nopilotignore`; folder rỗng có thể yêu cầu tạo project ngay. Source hiện tại được tự ZIP thành TXT để upload, tối đa 3 attachments/lượt. Chọn `@file` hoặc `@folder` để thu hẹp context. Với workspace nhiều folder, chọn folder đích khi gửi lượt đầu.

Khi nhận ZIP: tải vào artifacts → giải nén staging → card **Xem thay đổi** → **Backup và cập nhật**. Backup là commit chứa source thật tại `refs/nopilot/backups/<revision>` trong Git repository; không thay HEAD hoặc index người dùng. Workspace chưa có Git sẽ được khởi tạo sau khi duyệt. File text/binary được thêm hoặc ghi đè trực tiếp trong workspace; file vắng trong ZIP vẫn giữ nguyên. `.venv`, dependencies và đường dẫn ignore được bảo vệ. Các hard limit dung lượng/số file này đã được bỏ ở 0.2.2.

Để xóa file, ZIP cần `nopilot-delivery.json` ở root với `schemaVersion: 1`, `baseContextId` đúng lượt yêu cầu, `projectRoot: "."`, `commitMessage` và `deletePaths`. Nopilot tự hướng dẫn Copilot contract này. Folder bọc ZIP chỉ tự bỏ nếu toàn bộ entry cùng folder và có `nopilot.json` hoặc delivery manifest ở đó.

Sau cập nhật, chọn **Chạy dự án** hoặc kiểm tra để xem và duyệt lệnh theo `nopilot.json`. Venv được tái sử dụng. Lượt prompt tiếp theo lấy source mới nhất, kể cả sửa tay đã lưu. Nếu cập nhật gián đoạn, nhật ký và backup được giữ; không tự chạy lại. Dùng **Khôi phục checkpoint**; file đã sửa tiếp sẽ chặn restore tự động.

**Develop** nhận đề xuất sửa source/ZIP/chạy lệnh, luôn cần duyệt. **Chỉ hỏi (Ask)** dùng context VS Code để giải thích/review nhưng không nhận đề xuất áp dụng code hoặc chạy lệnh; vẫn có thể dùng web tools nếu bật. Ask là lựa chọn phụ; hội thoại cũ giữ chế độ đã chọn.

Nếu gặp lỗi thiếu `truststore` hoặc không mở được Playwright, mở menu `…` → **Check Runtime** để xem đúng Python, dependencies và Edge. **Repair Bridge Dependencies** tạo card duyệt cài `bridge/requirements.txt` vào Python đã cấu hình. Sau cài, reload VS Code. Playwright dùng Edge đã cài (`channel=msedge`), không cần tải Chromium riêng. Thiếu `truststore` chỉ chặn HTML reader, không còn chặn module browser tools.

Chat với Teams Copilot qua Frida ngay cạnh editor. Windows desktop/local workspace; không dùng CDP, không cần PowerShell. UI lấy màu từ VS Code theme.

## Cài và mở

1. Cài VSIX bằng `Extensions: Install from VSIX…` hoặc CMD: `code --install-extension nopilot-0.2.2.vsix`.
2. Chuẩn bị Python riêng bằng CMD:

   ```cmd
   python -m venv C:\tools\nopilot-bridge
   C:\tools\nopilot-bridge\Scripts\python.exe -m pip install -r bridge\requirements.txt
   ```

   `bridge/requirements.txt` nằm trong source extension. Khi dùng bản VSIX, thư mục extension đã cài cũng chứa `bridge/`. Không dùng venv của project làm runtime bridge nếu định thay đổi/xóa venv đó.
3. Đặt `nopilot.pythonPath` thành đường dẫn tuyệt đối tới Python vừa cài.
4. Mở Teams, đăng nhập và mở Copilot. Trong VS Code mở folder project, trust workspace nếu bạn tin source, chọn biểu tượng Nopilot → Kết nối Teams.
5. Kéo view Nopilot sang Secondary Sidebar nếu muốn bên phải. Nút ↗ mở cùng hội thoại trong editor tab; ↙ quay lại sidebar.

Bridge kiểm tra SHA-256 WebView2 trước native calls. Nếu Teams/Edge WebView cập nhật, cần chạy `refresh_build.py` trong `bridge/` theo cơ chế symbol manifest của bridge; không bỏ kiểm tra hash để chạy offset cũ.

## Context và chat

- **Ask:** đọc/giải thích; không nhận changeset/run plan tự động.
- **Develop:** nhận changeset hoặc ZIP để review. Model không tự sửa file.
- Gõ `@` hoặc `/` mở **cùng một menu** gồm context và slash commands phía trên composer. Gõ tiếp để lọc, dùng ↑/↓ và Enter/Tab để chọn, Esc để đóng. Menu `＋` cũng có mục mở menu này. File dùng editor đang mở hoặc dialog chọn file; Folder dùng dialog chọn thư mục con của workspace. `@selection` hiện kèm base file đầy đủ để bảo vệ review/apply; xem context trước gửi.
- **Xem context** mở nội dung thực sự chuẩn bị gửi. Buffer đang sửa được thu vào snapshot; không tự lưu source chỉ vì gửi context. Apply bị chặn nếu file chưa lưu hoặc đã đổi so với base.
- `.nopilotignore` dùng quy tắc gitignore. Không tự đọc `.gitignore`. `.git`, `.vscode`, venv, dependencies, outputs và secret phổ biến luôn bị loại mặc định; negation trong ignore không mở lại các mặc định bảo vệ này. `.vscode` được bảo vệ để source do model trả về không thay cấu hình bridge/runtime.
- Workspace context là một snapshot. Sau khi bạn tự sửa source, thêm lại context cần thiết trước lượt gửi tiếp. Sau apply của Nopilot, context source được cập nhật.
- Context nhỏ gửi inline. Context dài tự zip snapshot, đổi đuôi `.txt`, đính kèm cùng giải thích đây là ZIP bytes. Không cần tự nén. Không còn hard limit dung lượng/số file do harness đặt; dùng ignore hoặc scope để kiểm soát context gửi đi.

Composer dùng Codicons như VS Code. Nút `＋` mở menu thêm file. Các thao tác phụ nằm trong `…`; các quyết định duyệt code/chạy lệnh vẫn có nhãn rõ ràng. Màu sắc theo theme VS Code.

Enter gửi; Shift+Enter xuống dòng. Gõ `/` để xem/lọc slash commands, Enter/Tab chọn và Esc đóng. `/new` tạo local conversation mới; Teams chat mới chỉ được mở trước lần gửi đầu. Không xóa chat cũ của Teams.

## File và ảnh

- `＋` → Đính kèm file chọn bằng dialog native VS Code, sao vào draft artifacts; chưa upload Teams tới khi gửi.
- `/up` + Tab hoàn thành `/upload`, mở dialog. Chọn xong **chỉ điền đường dẫn**, không tự gửi. Nhấn Enter để đưa file vào draft; sau đó nhập prompt và gửi.
- Hoặc `/upload "C:\absolute\project-log.txt"`.
- Ctrl+V ảnh trong composer tạo preview attachment; PNG/JPEG được giữ nguyên dung lượng, chưa có tự giảm kích thước. Ảnh lớn hiển thị chip thay preview để giữ giao diện nhẹ. Nếu paste từ app nguồn không cung cấp image item, chọn file bằng dialog.
- Tối đa 3 attachments cho một lượt, gồm cả context bundle và ảnh. Context dài cần chừa một slot.
- File Copilot trả về được lưu dưới storage/artifacts theo conversation, có Mở và Folder. Không phụ thuộc animation download của Teams: bridge đọc nội dung qua link của response trong ngữ cảnh WebView rồi chuyển bytes về local.
- ZIP project hỗ trợ source và binary assets; đi qua staging/review/Git backup như phần bản 0.2.1 ở trên. ZIP thiếu file không tự xóa file workspace.

## Vòng phát triển

1. Chọn Develop, thêm context và yêu cầu sửa. Có thể yêu cầu Copilot thêm `nopilot.json` bên dưới.
2. Đọc card các file đề xuất → Xem diff → Áp dụng. File runtime/ignore và path ngoài workspace bị từ chối. Không ghi đè source đã đổi sau lúc gửi.
3. Trước apply, Nopilot lưu checkpoint JSON trong **Git repository riêng** dưới extension storage. Repo project không bị commit/push tự động.
4. Chọn **Chạy dự án** hoặc icon kiểm tra (beaker). Nopilot đọc contract, chuẩn bị run card với executable/args/cwd/timeout. Bấm **Duyệt và chạy** sau khi kiểm tra danh sách lệnh; một card duyệt, không thêm hộp thoại xác nhận lặp lại.
5. Giữ `.venv` tại workspace. Nếu chưa có sẽ tạo một lần. Cài `requirements.txt` khi nội dung/interpreter đổi; requirements tham chiếu local/editable hoặc `-r` được cài lại để tránh cache sai. Dependency install thất bại thì không start.
6. Output hiện trực tiếp trong **card có thể thu gọn/mở rộng** ở chat, cập nhật trong lúc lệnh/tool chạy. Card có trạng thái, exit code, copy output và mở Output channel; bản log lưu trong artifacts. Output hiển thị giới hạn 256 KiB, log lưu tối đa khoảng 1 MiB. Log **không tự gửi lại**. Dùng `/upload` chọn log hoặc đính kèm thủ công như trước.
7. Người dùng test rồi tiếp tục prompt. Menu `…` ở card project có **Git commit…** và **Khôi phục checkpoint…**. Commit thật dùng message Copilot, không push. Nếu file đã có sửa đổi trước apply hoặc index có file staged, dùng Source Control để chọn hunks, Nopilot không gộp chúng vào commit.
8. Khôi phục checkpoint chỉ được thực hiện nếu source chưa đổi tiếp; có kiểm tra trước restore.

Có icon dừng khi chương trình local đang chạy. Nopilot kiểm tra source trước các lệnh tiếp theo trong plan; nếu source đổi trong lúc cài dependencies, cần tạo plan mới trước khi start. `nopilot.json` tương thích contract Python v1:

```json
{
  "schemaVersion": 1,
  "name": "Greeting",
  "runtime": "python",
  "install": null,
  "tasks": {
    "start": {"entrypoint": "main.py", "args": [], "timeoutSeconds": 120},
    "check": {"entrypoint": "check.py", "args": [], "timeoutSeconds": 30}
  }
}
```

Nếu có dependencies, thay `install` bằng `{"requirements":"requirements.txt","timeoutSeconds":600}`. Các task phải trỏ file `.py` nằm trong workspace. Timeout tối đa 600 giây; bản đầu phù hợp script/test hữu hạn, chưa quản lý dev server dài hạn như service. Không sandbox chương trình đã được duyệt: kiểm tra source và command trước khi chạy.

Prompt mẫu: “Sửa chức năng X trong context đã gửi. Trả change_set theo contract của Nopilot; giữ nguyên các phần không liên quan, cập nhật check.py và nopilot.json, đề xuất commitMessage.”

## Giọng nói local

Bấm mic để ghi âm, bấm lại để dừng và nhận dạng. Kết quả **chỉ thêm vào draft**, bạn xem/sửa rồi tự gửi. Nút × hủy phiên ghi. Audio ở RAM, không gửi dịch vụ nhận dạng ngoài và không lưu file audio; giới hạn ghi 120 giây. Chữ chỉ được gửi Copilot khi bạn bấm gửi.

Cài thêm bằng CMD với Python bridge (hoặc đặt `nopilot.voice.pythonPath` thành runtime riêng):

```cmd
C:\tools\nopilot-bridge\Scripts\python.exe -m pip install -r bridge\requirements-voice.txt
```

Chuẩn bị một model **faster-whisper/CTranslate2 local** (ví dụ `Systran/faster-whisper-tiny` hoặc `small`). Folder cần `model.bin`, `config.json`, `tokenizer.json`, `vocabulary.txt`; dùng model đa ngôn ngữ cho tiếng Việt. Nopilot không tự tải model. Chạy **Nopilot: Configure Local Voice Model** để chọn folder, hoặc bấm mic khi chưa cấu hình rồi chọn folder trong thông báo.

`nopilot.voice.language` mặc định `vi`, có thể đổi `en`/`auto`; `nopilot.voice.device` mặc định -1 là microphone mặc định. Windows cần cho phép app desktop dùng microphone. Thiếu thư viện, model hoặc microphone sẽ hiện lỗi; draft hiện có được giữ. Nhận dạng CPU có thể chậm, chất lượng tùy model/microphone. Đã kiểm thử nhận dạng file audio mẫu local; chưa xác minh microphone và độ chính xác tiếng Việt trên máy của bạn.

## Hàng đợi và ưu tiên lượt kế tiếp

Khi đang chờ Copilot hoặc lệnh local, Enter/nút ＋ gửi sẽ **xếp hàng** prompt thường (tối đa 10 tin). Draft và attachments tại thời điểm đó được giữ cùng tin. Tray trên composer cho xem, bỏ tin chưa gửi, tạm dừng/tiếp tục và đưa tin lên đầu. Nút ↑ cạnh nút gửi xếp draft thành ưu tiên cho **lượt kế tiếp**; không can thiệp lượt Teams đang trả lời.

Hàng đợi chạy lần lượt, dừng khi có card cần duyệt, lỗi hoặc context/mode/tools đã đổi. Với context đổi, bấm cập nhật ở tin đang chờ để dùng context hiện tại. Sau reload, hàng đợi luôn tạm dừng; tin đã gửi mà chưa biết kết quả thành `unconfirmed`, không tự thử lại. Kiểm tra Teams bằng `/read` rồi bỏ tin chưa rõ kết quả trước khi tiếp tục. Xóa hàng đợi không hủy một prompt đã gửi. Slash commands cần thực hiện khi tác vụ hiện tại kết thúc.

## Lệnh CMD

Run plan mặc định dùng executable + argv trực tiếp. Nếu cần `&&`, pipe hoặc cú pháp shell, Copilot có thể đề xuất contract dưới đây; vẫn phải duyệt card trước khi chạy. Chỉ hỗ trợ CMD, không PowerShell.

```json
{"type":"run_plan","commands":[{"shell":"cmd","command":"echo Ready && python main.py","cwd":".","timeout":120}]}
```

CMD được đặt code page UTF-8; chương trình con có encoding riêng vẫn có thể cần cấu hình riêng. Đây là chạy code local đã duyệt, không phải sandbox.

## Lịch sử

Nút lịch sử ở thanh tiêu đề hoặc menu `…` mở danh sách tìm theo tên, pin, đổi tên, xóa local và khôi phục từ thùng rác. Các thao tác trong danh sách dùng icon có tooltip/nhãn hỗ trợ accessibility. Dữ liệu lưu ở workspace storage riêng, tránh hai workspace ghi đè lịch sử của nhau. Không đổi tên/xóa Teams chat, project hoặc artifacts. Xóa local không thu hồi nội dung đã gửi Copilot.

Mở history không phát sinh Teams request. Lần gửi kế tiếp khôi phục và kiểm tra Teams conversation ID. Nếu không khôi phục được, dừng để người dùng mở đúng chat, không gửi vào chat foreground khác.

Nếu bridge lỗi sau khi gửi: **không bấm Gửi lại**. Kết nối lại bằng `/reconnect` hoặc lệnh `Nopilot: Connect to Teams`, rồi `/read` / Đọc kết quả. Response phải khớp conversation/prompt trước khi nhập vào lịch sử local.

## Web tools

- Bật Web tools rồi yêu cầu Copilot dùng `web.read`, `browser.open`, `browser.snapshot`, `browser.click`, `browser.fill` hoặc `browser.screenshot`.
- `/url https://example.com câu hỏi` tạo card đọc URL trực tiếp. Sau duyệt, kết quả có nguồn/timestamp được gửi lại Copilot; dài thì thành Markdown attachment.
- HTTP reader dùng urllib + BeautifulSoup + markdownify + OS certificate store; không chạy JavaScript. Playwright dùng Edge profile riêng, có cửa sổ; không lấy cookies của profile cá nhân. Có thể tự đăng nhập trong cửa sổ đó nếu cần.
- Mỗi tool request cần duyệt trong card, gồm cả việc gửi kết quả cho Copilot. Chưa có auto-approve đọc web theo conversation. Hết 20 vòng model, card dừng trước khi chạy tool và có nút cấp thêm 20 vòng; tiếp tục cùng request, không chạy lại tool đã xử lý. Không có API search trả phí hoặc đảm bảo search engine không chặn bot.
- Không gửi script Python bất kỳ vào tool executor. Script Playwright do Copilot sinh phải review như source project và duyệt chạy.
- Restricted Mode không chạy bridge/tools. Không vượt CAPTCHA, đăng nhập hoặc lỗi chứng chỉ. Tool lỗi không tự chuyển nguồn hoặc tự gửi lại prompt.

## Model phụ và gateway

Model phụ là tùy chọn. Cấu hình `nopilot.smallModel.endpoint` là URL chat completions đầy đủ, `nopilot.smallModel.model`; dùng `Nopilot: Set Small Model API Key` để lưu key trong SecretStorage. `/assist yêu cầu` gọi model phụ với yêu cầu đó và contract hiện tại, **không tự gửi toàn transcript/source**. Kết quả có schema hợp lệ đi qua cùng card review/approval. Không có quyền tự duyệt tool hoặc lệnh.

Bật `nopilot.gateway.enabled`, chọn `nopilot.gateway.port` (0 chọn port trống), reload. Lệnh **Nopilot: Copy Local Agent Gateway Connection** copy JSON endpoint/token để đưa cho agent local bạn chọn. Không đưa token vào prompt Copilot.

- `GET /v1/capabilities`: API version và tools.
- `GET /v1/state`: trạng thái conversation đang chọn.
- `GET /v1/events`: SSE snapshot rồi event envelopes `{seq,conversationId,runId,event}`.
- `POST /v1/propose`: `{"conversationId":"...","proposal":{...change_set/tool_request/run_plan...}}`. Chỉ stage; duyệt trong VS Code.
- `POST /v1/messages`: `{"requestId":"unique-id","conversationId":"...","text":"prompt"}`. Gửi prompt thường tới Copilot qua cùng hàng đợi; trả 202 và receipt. Retry cùng requestId không gửi lại. Dùng `GET /v1/requests/ID` để đọc trạng thái; các request chưa rõ kết quả sau restart thành `unconfirmed` và không tự resend.
- Mọi request cần header `Authorization: Bearer TOKEN`. Token theo workspace, chỉ bind 127.0.0.1, không CORS và từ chối browser Origin. Không có endpoint approve/exec/evaluate. Chỉ một sidecar Nopilot được giữ quyền điều khiển Teams tại một thời điểm giữa các cửa sổ.

Events lõi được kiểm tra bằng schema thật của `@ag-ui/core`. Domain events dùng `CUSTOM`. Webview nhận postMessage, agent ngoài nhận SSE. Snapshot phục hồi trạng thái hiện tại; chưa có durable event replay qua mọi lần restart. Approval hết hiệu lực sau extension reload. Không tự lặp side effect.

Teams bridge hiện nhận response cuối; UI hiện progress thật rồi Markdown hoàn tất, chưa có token streaming. AG-UI không thay bridge hoặc biến Teams thành native model API.

## Build và test từ CMD

```cmd
npm ci
npm run check
npm run build
npm test
python -B test\test_bridge.py
npm run package
```

Mở Extension Development Host:

```cmd
code --new-window --extensionDevelopmentPath=C:\path\nopilot\extension C:\path\test-project
```

Node tests bao gồm filesystem/Git orchestration với mock VS Code API, không thay thế kiểm thử giao diện và Teams thật. Dùng workspace mẫu riêng, không chạy trên source quan trọng cho lần thử đầu.

## Thành phần giao diện

Codicons của Microsoft được dùng nguyên dạng: [vscode-codicons](https://github.com/microsoft/vscode-codicons). Artwork theo CC BY 4.0, code theo MIT; bản phân phối kèm license/attribution trong `dist/licenses` và `dist/THIRD_PARTY_NOTICES.txt`. Các thư viện runtime khác cũng có notice đi kèm.
