# Nopilot — VS Code Extension

## Bản 0.4.3 — Trạng thái làm việc và phản hồi dần

Thao tác hội thoại nằm trong header có nhãn Nopilot, tách khỏi các nút bố cục gốc của VS Code. Trạng thái Teams nằm ngay cạnh biểu tượng kết nối. Spinner, công đoạn hiện tại và thời gian chờ nằm ngay phía trên ô nhập.

Khi Teams đang sinh câu trả lời, bridge đọc bản Markdown hiển thị của đúng request/turn và cập nhật phần xem tạm trong chat khoảng mỗi 0,75 giây khi có thay đổi. Đây là cập nhật từ giao diện Teams, không phải API stream token. Markdown có thể được Copilot viết lại trong lúc sinh. Phần tạm không được lưu như câu trả lời chính thức, không có nút Execute SQL và không kích hoạt tool, download hoặc áp dụng source. Chỉ kết quả cuối cùng đã xác nhận mới tạo các thao tác đó. Nếu Teams chưa cung cấp nội dung tạm, Nopilot vẫn hiện trạng thái chờ và thời gian đã trôi qua.


## Bản 0.4.0 — Vòng phát triển theo lượt thay đổi

1. Chọn project context và gửi yêu cầu. `.nopilotignore` luôn được áp dụng. Lượt tiếp theo đóng gói source thực tế trong workspace, không lấy source chưa chấp nhận trong artifacts.
2. File đơn, ZIP hoặc JSON đều tạo **một card thay đổi** ngay tại lượt trả lời. Tick file cần nhận, hoặc chọn tất cả. **Xem thay đổi** là tùy chọn mặc định; bật **Bắt buộc xem diff và xác nhận** nếu muốn review nghiêm ngặt cho hội thoại.
3. **Chấp nhận N file**: backup Git rồi cập nhật đúng file đã chọn. **Chấp nhận và chạy**: thực hiện cập nhật, sau đó chạy đúng lệnh trong mục **Lệnh khi chấp nhận và chạy**. Chọn Chạy, Test hoặc Chạy + test trước khi chấp nhận. Nếu không có contract hợp lệ, vẫn chấp nhận source được nhưng không chạy tự động.
4. Card đã chấp nhận có **Chạy**, **Test**, **Undo**, kết quả, lỗi và console có thể thu gọn. Chạy/Test tạo kế hoạch cần duyệt. Nếu test lỗi, source vẫn đã cập nhật và Undo vẫn còn. File chưa nhận có thể tạo thành đề xuất riêng. **Bỏ qua** giữ nguyên workspace để prompt sửa tiếp.
5. Dùng `/upload` để gửi log và yêu cầu sửa tiếp. Nopilot giữ `.venv`, chỉ cài dependencies khi cần. **Developer/tester xác nhận** là quyết định thủ công; khác với trạng thái lệnh test thành công và không tự tuyên bố đạt UAT.

Artifacts nằm trong **File của lượt này**, mặc định thu gọn. Artifacts cũ chưa có thông tin lượt nằm trong **Artifacts lịch sử** ở đầu hội thoại. Không còn khu vực ZIP gần đây ghim vào cuối chat. Preview ZIP vẫn có thể tạo đề xuất cho từng file hoặc toàn bộ; không ghi workspace ngay.

Các ghi chú phiên bản dưới đây là lịch sử hành vi; luồng 0.4.0 ở trên thay thế yêu cầu review bắt buộc của 0.3.11.


## Bản 0.3.11 — Review và duyệt ngay trên cùng đề xuất

Mỗi card thay đổi có luồng riêng:

1. **Xem thay đổi** để mở diff cạnh chat và giữ focus của card. Nút có trạng thái đang mở; chưa bật cập nhật.
2. Trở lại card và tích **Tôi đã xem thay đổi và đồng ý áp dụng đề xuất này**.
3. **Backup và cập nhật** (ZIP/file) hoặc **Áp dụng thay đổi** (JSON) chỉ bật sau xác nhận.

**Từ chối** là nút bằng chữ cho đề xuất chưa áp dụng; source được giữ nguyên. Sau khi áp dụng thành công mới dùng **Undo**. Lỗi mở diff, xác nhận hoặc cập nhật hiển thị trong chính card; không đẩy thành lỗi chat ở nơi khác. Card giữ vị trí trong transcript khi đổi trạng thái. Backend kiểm tra lại ID, phiên review, hash và khóa chạy, nên click lặp hoặc yêu cầu cũ không bỏ qua được các bước. Xác nhận mất hiệu lực sau khi reload hoặc diff bị sửa.

## Bản 0.3.10 — Tiếp tục yêu cầu mới khi còn đề xuất cũ

- Bấm gửi khi còn đề xuất chưa áp dụng hiện thẻ cạnh composer: **Xem đề xuất cũ** hoặc **Bỏ qua đề xuất cũ và gửi**. Draft, lựa chọn context và attachments được giữ nguyên. Không gửi request hay ghi source trước khi người dùng chọn.
- Bỏ qua lưu lại đề xuất cũ ở local, không tự áp dụng hay xóa source/ZIP. Bấm gửi lặp lại không tạo lỗi trùng trong chat. Các thông báo chặn cũ liên tiếp được thu gọn, lịch sử gốc vẫn được giữ.
- Nếu Copilot trả về file đơn có tên khớp duy nhất với một file source đã gửi, Nopilot stage file đó để xem diff, backup Git rồi cập nhật sau khi duyệt. File lạ/khớp nhiều đường dẫn chỉ được lưu thành artifact; không đoán nơi ghi.
- Đề xuất JSON hoặc ZIP và file đơn vẫn dùng cùng cơ chế bảo vệ source đã thay đổi và phê duyệt. Không chạy code tự động.

## Bản 0.3.9 — Chọn project context bằng cây thư mục

Trong Develop, **Include project** vẫn bật/tắt việc gửi source. Bấm **Chọn file…** bên cạnh để mở cây thư mục:

- Mặc định chọn mọi file hợp lệ theo `.nopilotignore` và các quy tắc bảo vệ có sẵn.
- Checkbox thư mục có ba trạng thái; tìm theo tên/đường dẫn, chọn mặc định hoặc bỏ chọn tất cả. **Hiện đã loại trừ** cho xem các mục bị chặn cùng lý do, không cho bật gửi chúng. Không quét sâu vào thư mục đã ignore.
- Tổng số file và dung lượng trước nén cập nhật ngay. Bấm **Lưu lựa chọn** để áp dụng theo conversation; **Hủy** không thay đổi context đã lưu. **Làm mới** giữ lựa chọn đang chỉnh và đọc lại cây trên đĩa.
- Ở chế độ tùy chỉnh, chỉ các đường dẫn đã chọn được gửi. File mới sinh từ Copilot cần được chọn thêm; **Chọn mặc định** khôi phục chế độ tự chọn tất cả file hợp lệ ở mỗi lượt.
- Mỗi lần gửi đều đọc source mới nhất, nén thành ZIP đổi đuôi `.txt` và chiếm 1 trong 3 attachment slots. Bỏ chọn tất cả sẽ không gửi source; Nopilot nói rõ với Copilot rằng workspace không nhất thiết rỗng.
- Lựa chọn được giữ khi tắt/bật Include project, cập nhật ZIP, đổi hội thoại hoặc mở lại VS Code. File đã bị xóa hoặc mới bị ignore không được gửi ở lượt tiếp theo.
- Snapshot bảo vệ workspace vẫn được giữ riêng ở local. Manifest gửi Copilot chỉ chứa file đã chọn. ZIP nhận về và các lệnh chạy vẫn phải review/phê duyệt riêng.

Vòng phát triển: chọn source → yêu cầu sửa → review ZIP/diff → duyệt backup và cập nhật → duyệt chạy/check → chọn thêm file mới nếu cần → gửi yêu cầu tiếp theo. Log vẫn có thể đính kèm bằng `/upload`.

## Bản 0.3.8 — Nhật ký đúng vị trí và ZIP dễ tìm

- Card command/tool/backup mới nằm sau tin nhắn tại thời điểm bắt đầu hoạt động, không gom lỗi cũ xuống cuối chat.
- Nhật ký từ bản cũ chưa có liên kết tin nhắn được giữ trong mục “Nhật ký hoạt động trước đây” thu gọn ở đầu hội thoại. Vẫn có thể mở xem lỗi và log đầy đủ.
- Khu vực “ZIP gần đây” hiện tối đa 3 ZIP mới nhất cùng nút **Xem ZIP / chọn file** và **Copy tất cả**, ngay cả khi Artifacts đang thu gọn. Các ZIP cũ vẫn trong Artifacts.
- Preview ZIP tiếp tục hỗ trợ copy từng file, selected hoặc all, sau đó review và duyệt backup trước khi ghi workspace.
- Lỗi tạm ở composer được xóa khi đổi hội thoại hoặc bắt đầu tác vụ mới.

## Bản 0.3.7 — Khôi phục checkpoint sau khi mở lại VS Code

- Giữ liên kết giữa checkpoint ZIP và thẻ thay đổi khi extension khởi động lại, để nút Undo tiếp tục hoạt động.
- Menu Project → Khôi phục checkpoint nhắm checkpoint mới nhất, không gửi nhầm ID hội thoại.
- Bao gồm bản sửa đường dẫn Git backup dài của 0.3.6.

## Bản 0.3.6 — Sửa backup Git khi đường dẫn artifacts quá dài

- Git dùng index tạm riêng trong thư mục ngắn ở hệ thống, thay vì đặt sâu trong artifacts của conversation. Bật `core.longpaths` riêng cho các lệnh backup, không thay đổi Git config của người dùng.
- Backup vẫn giữ HEAD và index đang stage của người dùng; chỉ cập nhật workspace sau khi tạo checkpoint thành công.
- Với card failed trước khi ghi source: bấm **View changes**, xem diff rồi duyệt **Backup và cập nhật** lại. Không cần gửi lại prompt hoặc tải lại ZIP. Nếu workspace đã đổi, hãy tạo đề xuất mới từ artifact qua ZIP preview.
- Lượt cập nhật bị gián đoạn giữa chừng không được thử lại theo cơ chế này; cần kiểm tra checkpoint và source trước.

## Bản 0.3.5 — Lưu lịch sử bền hơn trên Windows

Sửa lỗi Windows `EPERM` khi reader/antivirus đang giữ file lúc thay thế `history.json`: dùng file tạm riêng, flush trước khi rename, retry sharing violation có giới hạn và dọn file tạm sau lỗi. Một lần lưu thất bại không còn làm hỏng hàng đợi lưu của các lượt tiếp theo. Journal ban đầu cũng được flush trước khi gửi RPC; journal Python retry khi thay thế file bị khóa tạm thời.

Đã kiểm thử trong VS Code Extension Development Host thật, điều khiển DOM qua CDP mà không cần desktop mouse/keyboard; bridge Frida và Teams/Copilot đều thật. Kịch bản gồm restart host khi request chưa nhập kết quả, chuyển chat B rồi khôi phục đúng chat A, web context ngắn/dài và SQL Data (tô màu, số dòng, folding, chọn SQL + Ctrl+Enter). Profile kiểm thử riêng chỉ trust đúng thư mục mẫu theo xác nhận của người dùng; không tắt Workspace Trust toàn cục.

## Bản 0.3.4 — Khôi phục đúng hội thoại và lượt hỏi

Nopilot ghi request journal trước Send, ghi send intent xuống đĩa trước thao tác bấm Send, rồi lưu Copilot conversation ID và turn ID ngay khi đọc được lượt hỏi tương ứng. Mỗi request có UUID riêng và hash prompt; địa chỉ frame/PID chỉ dùng trong phiên chạy hiện tại.

Sau lỗi kết nối hoặc reload, mở hội thoại trong lịch sử Nopilot và bấm **Khôi phục đúng lượt** trên card. Lệnh `/read` cũng dùng luồng này với các request mới có journal. Bridge tìm lại frame, mở đúng UUID trong lịch sử Copilot, kiểm tra route và đối chiếu prompt với lượt gửi. Nó không lấy câu trả lời cuối cùng một cách mặc định. Kết quả được nhập với message ID theo request nên bấm lại không tạo câu trả lời trùng. Artifact được đọc theo đúng turn và route. Đề xuất sửa/chạy vẫn phải review và duyệt; khôi phục không tự thực thi code.

Nếu Teams thay frame sau Send, bridge kết nối lại để đọc request đã gửi, không gọi Send lần hai. Khi Copilot vẫn trả lời, journal chưa rõ đã gửi hay chưa, hoặc nhiều lượt khớp, UI giữ trạng thái cần kiểm tra và không tự gửi lại. Lượt đã Stop không được nhập câu trả lời dở dang. Journal đang chờ không bị một prompt hay tool result mới ghi đè. Bạn vẫn có thể tạo hội thoại local mới.

Nếu chưa có UUID hoặc chat cần tìm không nằm trong phần lịch sử đã tải, hãy mở đúng chat gốc trong Teams rồi bấm khôi phục lại. Không tìm bằng tiêu đề gần giống, không bỏ draft/attachment/response đang có trong một chat khác để chuyển phiên. Conversation ID/DOM selector là nội bộ giao diện Copilot, không phải API ổn định được Microsoft cam kết; lỗi đối chiếu sẽ dừng thay vì đoán.

**Web context:** `/url https://example.com/ nội dung cần hỏi` tạo card duyệt đọc URL. Reader dùng Python urllib + BeautifulSoup + markdownify, xác minh TLS, lưu source URL/thời gian/receipt/hash trong context. Kết quả ngắn được đưa vào prompt `tool_result`; trên 12.000 ký tự JSON được lưu file Markdown và upload một attachment. Sau đó Copilot trả lời dựa vào context local. Nội dung web là dữ liệu không tin cậy, không phải chỉ dẫn của harness; trang cần JavaScript/login/bot verification báo lỗi để người dùng chọn cách khác.

## Bản 0.3.3 — Sửa màu SQL, xác minh folding

SQL editor dùng bảng màu token riêng theo light/dark theme thay vì màu icon của VS Code (một số theme đặt màu icon giống hệt chữ thường). Keyword, chuỗi, số, comment và kiểu dữ liệu được tô riêng. Bổ sung danh sách kiểu dữ liệu bị mất khi override dialect keywords.

Folding hỗ trợ query nhiều dòng và block comment `/* ... */`: bấm mũi tên cạnh số dòng để thu gọn/mở rộng, hoặc bấm dấu `…` để mở lại. Query một dòng không có vùng fold. Folding chỉ đổi cách hiển thị, không bỏ nội dung khỏi SQL khi Run hoặc Save As.

## Bản 0.3.2 — Chủ động kết nối Teams

Mở Nopilot hoặc tạo hội thoại mới khi panel đang mở sẽ tự tìm và kết nối Copilot. Nút Teams ở header và màn hình chào hiện spinner trong lúc tìm frame, số lần thử và thời gian chờ retry. Bạn vẫn soạn nháp được; lỗi kết nối không chèn thêm message vào chat. Nút kết nối tay vẫn có để kiểm tra/thử lại. Kết nối tốt được tái sử dụng; mở panel không tạo/xóa/đổi phiên chat Teams. Phiên Teams cho hội thoại local mới chỉ được tạo lúc gửi yêu cầu đầu tiên.

Discovery thử tối đa 3 lần, ngân sách chờ frame 20 giây/lần, nghỉ 2 rồi 5 giây, tổng ngân sách mềm 70 giây. Native attach/scan/RPC có thể kéo dài hơn ngân sách mềm; watchdog transport kết thúc chờ UI sau 105 giây và không cho attach chồng khi RPC cũ chưa trả về. Sai WebView2 build, thiếu module, lỗi quyền, nhiều frame hoặc native callback pending không được tự retry. Retry chỉ dò/attach, không gửi lại prompt, upload hoặc bấm New/Try again. Không tự khởi động lại Teams. Kết nối tự động vẫn yêu cầu workspace trusted và runtime đã cài.

## Bản 0.3.1 — SQL editor và kết quả ngay dưới query

- **Show inline** đặt bảng ngay dưới đúng code block SQL, giữ vị trí cuộn khi mở/phân trang và có nút thu gọn/mở rộng tại chỗ. Nếu đã Execute, bảng dùng lại snapshot. **Show in chat** cũng gắn vào snippet tương ứng khi xác định được duy nhất; query nhập riêng trong Data vẫn có card riêng.
- **SQL editor:** tô màu, số dòng, gợi ý từ khóa bằng **Ctrl+Space** (và tên cột của kết quả gần nhất). **Ctrl+Enter** hoặc **Run query** chạy phần đang chọn; nếu không chọn, chạy toàn bộ editor. **Save As…** lưu toàn bộ nội dung thành file `.sql` qua hộp thoại VS Code.
- **SHOW / USE:** cho phép SHOW metadata như `SHOW TABLES`, `SHOW SCHEMAS`, `SHOW CATALOGS`; cho phép `USE CATALOG ...`, `USE SCHEMA ...`, `USE catalog.schema`. Context được nhớ theo workspace và connection profile, rồi áp dụng lại khi mở kết nối ODBC cho query sau. Chọn **Reset context** để bỏ context đã lưu. Một lần chạy có thể gồm các lệnh USE ở đầu, sau đó tối đa một SELECT/WITH hoặc SHOW; USE riêng cũng được. Không hỗ trợ batch nhiều query trả bảng hoặc DDL/DML. SQLite demo dùng SELECT; SHOW/USE dành cho driver hỗ trợ các lệnh đó.
- Mỗi câu hỏi/câu trả lời có **icon copy**, sao chép nguyên nội dung Markdown.
- Mở chat bằng biểu tượng **Nopilot** ở **Activity Bar** bên trái hoặc nút **Nopilot** ở **Status Bar** phía dưới. Nếu VS Code đã lưu vị trí khác, dùng **Reset Location** từ menu chuột phải trên tiêu đề view Nopilot để đưa view về vị trí mặc định.
- Khi mở chat trong workspace tin cậy, Nopilot kiểm tra Python và khả năng import Frida/pefile. Nếu thiếu, dùng thẻ **Thiết lập Nopilot** để chọn Python, tạo runtime hoặc chọn thư mục wheel offline. Đường cài offline cần đủ wheel cho Python/Windows hiện tại và các phụ thuộc gián tiếp; pip chỉ tìm trong thư mục đã chọn. Cài đặt bắt đầu sau khi duyệt card.
- Model Copilot Teams nằm cạnh nút mic và được lưu theo hội thoại. **Include project** gửi tất cả file hợp lệ theo quy tắc mặc định và `.nopilotignore`, hoặc chỉ danh sách đã chọn trong cây project. Tệp đính kèm thủ công vẫn theo lựa chọn của bạn.

## Bản 0.3.0 — Sidebar, SQL inline và project context

- **Chat bên phải:** bấm icon sidebar ở title Nopilot hoặc menu `…` → **Đặt chat bên phải…**. Trong picker của VS Code, chọn **New Secondary Side Bar Entry** (hoặc container ở Secondary Side Bar đang có). VS Code nhớ vị trí view. Cũng có thể click phải Nopilot ở Activity Bar → **Move To → Secondary Side Bar**. Không đổi vị trí toàn bộ Explorer/sidebar khác; editor tab vẫn là lựa chọn riêng. [VS Code Custom Layout](https://code.visualstudio.com/docs/configure/custom-layout).
- **Webview lifecycle:** đóng editor chat rồi mở lại từ Activity Bar/editor không còn giữ panel hoặc đọc getter của webview đã dispose. Callback dispose cũ không xóa panel mới; các postMessage tới view đã đóng được dọn khỏi danh sách.
- **Teams ở tray:** UI thread discovery xét cả cửa sổ Teams ẩn, ưu tiên main window và không chọn notification thread thay thế. Nếu Teams đã hủy cửa sổ/WebView hoặc có nhiều thread không xác định được duy nhất, cần mở lại Teams từ tray rồi Connect. Không đoán thread, không tự restart Teams hoặc gửi prompt trong trạng thái đó. Kiểm thử selector không thay thế kiểm thử trực tiếp từng bản Teams/Windows.
- **SQL inline:** snippet SQL có **Show inline**. Nếu Execute trước đó đã có kết quả, dùng lại snapshot; nếu chưa, chạy qua kết nối workspace rồi hiện ngay trong chat. Data tab cũng có **Show in chat** để đưa snapshot hiện tại vào hội thoại Nopilot đang chọn. Không gửi bảng cho Copilot. Bảng inline có phân trang, ẩn/hiện, mở snapshot trong Data và export CSV/Excel. Export toàn bộ các dòng đã fetch, không chỉ trang hiện tại; thông báo truncated giữ nguyên. Show inline/Show in chat không tự chạy lại query đã có snapshot. Query chỉnh tay sau lúc chạy không bị gán nhầm cho snapshot cũ.
- **Include project:** checkbox dưới composer trong Develop. Bỏ chọn để không tự upload hoặc chèn source project ở các lượt tiếp theo của hội thoại này; Develop và các card duyệt vẫn hoạt động. File/selection chọn rõ bằng `@` hoặc attachments thủ công vẫn được gửi. Bật lại sẽ lấy toàn workspace theo `.nopilotignore`; chọn `@file/@folder` chuyển sang context được chọn. Local hashes vẫn dùng cho kiểm tra cập nhật an toàn. Tắt không xóa context đã gửi trước đó khỏi lịch sử Copilot.

## Bản 0.2.9 — Lỗi Copilot, Stop và steer

Bridge nhận diện thẻ lỗi **Oops! Something happened. Can you try again? / Try again** trong turn hoặc alert của Copilot, kể cả khi chưa có nút Copy. Lỗi được đưa về chat, ghi nhận Teams conversation và kết thúc lượt chờ; không tự bấm Try again hoặc gửi lại prompt. Bạn có thể gửi chỉ dẫn khác, kiểm tra trạng thái hoặc mở hội thoại local mới. Hàng đợi đang có sẽ tạm dừng để không tự chạy tiếp sau lỗi; bỏ tin thất bại/chưa rõ kết quả trước khi tiếp tục hàng đợi.

Khi đang chờ Copilot, composer có **Dừng Copilot**. Nhập chỉ dẫn mới rồi bấm **Steer ↑** để yêu cầu Stop → xác nhận Copilot không còn generating → kết thúc lượt cũ → gửi đúng một prompt mới trong cùng conversation. Nội dung dở dang không được dùng để áp dụng code. **Hội thoại mới** trong lúc đang chờ cũng yêu cầu Stop và chờ xác nhận trước khi chuyển hội thoại local. Nếu lượt cũ vừa hoàn tất bình thường, có thể tiếp tục sau khi lượt đó kết thúc.

Stop dùng DOM của đúng turn qua Frida, không dùng chuột/bàn phím, không kill Teams và không gọi Frida từ nhiều thread đồng thời. Tín hiệu hủy được gắn ID RPC riêng; Stop cũ không hủy lượt mới. Nếu không tìm được duy nhất nút Stop, câu hỏi/turn đã đổi, hoặc chưa xác nhận dừng, Nopilot giữ draft steer và không gửi mới. Nếu hủy trước bước submit (ví dụ đang upload), kiểm tra draft/attachments trong Teams; không tự xóa chúng hoặc gửi steer. Với lệnh/tool local, nút ↑ vẫn chỉ xếp ưu tiên lượt kế tiếp; nút dừng lệnh local vẫn riêng biệt.

Card phục hồi có **Kiểm tra trạng thái** và **Hội thoại mới**. Kiểm tra trạng thái chỉ đọc, không retry hoặc nhập đề xuất code dở dang. Lỗi native bridge/timeout chưa rõ kết quả vẫn cần kiểm tra Teams; không thể bảo đảm Stop khi callback native không đáp ứng.

## Bản 0.2.8 — Chẩn đoán Databricks ODBC

ODBC dùng `autocommit=True` theo [ví dụ Databricks chính thức](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/pyodbc); không ép `readonly`/transaction attributes khi mở kết nối. Quyền chỉ đọc được bảo đảm bằng tài khoản database và bộ lọc SELECT của Nopilot. Không tự retry query. Driver không hỗ trợ thiết lập query timeout sẽ vẫn dùng kết nối đã mở nếu trả SQLSTATE chỉ rõ thuộc tính/tính năng không hỗ trợ; thời hạn worker local vẫn áp dụng.

Connection string có thể là `DSN={ExampleWarehouse};` hoặc chỉ tên DSN `ExampleWarehouse`. Thông tin đăng nhập tiếp tục lấy từ cấu hình DSN/SecretStorage. Nút **i** chỉ liệt kê Python bitness, drivers và DSN; icon thông tin không còn thể hiện là kết nối thành công. **Test connection** cần mở phiên và chạy `SELECT 1` thành công mới có tick xanh.

Lỗi ODBC hiện SQLSTATE, bước lỗi (mở kết nối, thiết lập timeout, SELECT 1 hoặc thực thi/lấy kết quả) và hướng kiểm tra phù hợp; không hiển thị raw driver error, token, host hoặc SQL. Với `ExampleWarehouse`, chọn đúng profile dùng DSN đó rồi Test connection. Nếu vẫn lỗi, SQLSTATE/bước lỗi mới giúp phân biệt driver/DSN, auth, network hoặc quyền database. Danh sách DSN xuất hiện không đồng nghĩa driver tải được hoặc tài khoản đã xác thực.

## Bản 0.2.7 — Kết nối mặc định theo workspace

Thiết lập ODBC một lần trong `/db`; profile ODBC đầu tiên được đặt mặc định cho workspace hiện tại. Hoặc chọn profile đã có rồi bấm **Đặt mặc định workspace**. Khi Execute snippet lần đầu chưa có mặc định, chọn kết nối một lần; Nopilot ghi nhớ lựa chọn cho workspace này. Các lần Execute sau dùng lại kết nối đó, kể cả sau khi reload VS Code, và không hỏi chọn lại.

Trong tab Data, tên mặc định hiện ở header. Chọn profile khác rồi **Đặt mặc định workspace** để đổi; **Bỏ mặc định** để lần Execute tiếp theo hỏi lại. Workspace khác có lựa chọn riêng. Dropdown chỉ đổi kết nối dùng trong tab Data; không âm thầm thay mặc định dành cho snippet. Nopilot chỉ lưu ID profile trong workspace state; connection string/token vẫn nằm trong SecretStorage, không ghi vào source/config của project. Query lỗi không tự chuyển sang database khác hoặc tự gửi lại query.

## Bản 0.2.6 — Execute SQL từ chat

Code block có nhãn `sql` (hoặc `tsql`, `sparksql`, `databricks`, `postgresql`, `mysql`, `sqlite`, `plsql`, `pgsql`) trong câu trả lời Copilot có card **Execute**. Bấm Execute → chọn kết nối ODBC/SQLite trong danh sách VS Code → query chạy và hiện ở tab **Nopilot · Data**. Mỗi snippet có nút riêng. Nếu chưa có profile, tab Data giữ câu SQL để bạn thêm kết nối rồi bấm Run query. Hủy chọn kết nối sẽ không chạy query.

Grid hỗ trợ preview, phân trang 50 dòng và export toàn bộ snapshot đã fetch thành CSV/Excel. Fetch limit hiển thị trong Data tab vẫn áp dụng. Query không tự gửi kết quả cho Copilot. Nút Execute chỉ chạy khi người dùng bấm và chọn kết nối; render câu trả lời không chạy query. Backend lấy SQL từ đúng message/snippet lưu trong hội thoại. Bản này giữ chế độ chỉ đọc, một `SELECT` hoặc `WITH … SELECT`; không chạy DDL/DML từ chat.

## Bản 0.2.5 — Copy nhanh từ ZIP

Trong Artifacts, icon **Copy toàn bộ ZIP vào workspace** nằm ngay cạnh ZIP bundle. Trong preview, mỗi file có icon **Copy … vào workspace** riêng, không cần tick checkbox. File ignore bị khóa. Các nút này tạo đề xuất qua luồng review, duyệt và backup Git hiện có; không tự ghi đè hoặc chạy chương trình. Checkbox và Copy selected vẫn dùng khi muốn chọn nhiều file.

## Bản 0.2.4 — Setup, ZIP preview và Data Explorer

- Khi lấy context project, Nopilot tự tạo `.nopilotignore` nếu chưa có; giữ nguyên file người dùng đã chỉnh. Gõ `/ignore` để mở/chỉnh file này.
- Gõ `/setup` để xem và duyệt plan tạo venv riêng trong storage của extension rồi cài các thư viện bridge, web reader, Playwright và Data Explorer. Python phải có sẵn. Chạy lại sẽ tái sử dụng runtime; không cài vào venv của project. `/setup voice` cài thêm thư viện nhập giọng nói; vẫn cần chọn model local. Setup không cài ODBC driver hệ điều hành.
- Artifacts → icon danh sách cạnh ZIP: xem tên/kích thước file; chọn checkbox rồi **Copy selected…**, hoặc **Copy all…**. Tiếp theo **Xem thay đổi** và duyệt **Backup và cập nhật**. File ignore được bỏ qua, file ngoài lựa chọn được giữ nguyên; chỉ thị `deletePaths` trong ZIP không được thực thi qua copy thủ công. Đường dẫn là tương đối với workspace; folder bọc có contract được chuẩn hóa như luồng project ZIP. Đề xuất ZIP đang chờ được thay bằng lựa chọn mới, không tự áp dụng. Copy không chạy chương trình.
- Card thay đổi có tổng số file/dòng thêm/xóa, ba file đầu và danh sách mở rộng; sau áp dụng có **Undo** và **View changes**. Tin nhắn không còn nhãn người nói; nền tin nhắn user có màu riêng. Nút kết nối Teams dùng màu accent.

### SQL local và Databricks ODBC

Gõ `/db` hoặc chạy **Nopilot: Open Data Explorer**. Tab dữ liệu hoạt động độc lập với Teams.

1. Để thử ngay, bấm **Demo** → **Test connection** → **Run query**. SQLite thật được tạo trong storage Nopilot với 150 dòng mẫu, mở ở chế độ chỉ đọc.
2. Với Databricks, cài Databricks ODBC driver phù hợp kiến trúc Python và cấu hình DSN theo [hướng dẫn Microsoft](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/pyodbc). Bấm **ODBC**, đặt tên rồi nhập `DSN={DatabricksDSN};` hoặc connection string của driver trong hộp nhập ẩn. Connection string lưu VS Code SecretStorage; metadata profile không chứa token. Nút thông tin liệt kê driver/DSN đang có.
3. Bấm **Test connection** trước khi chạy SQL. Bản đầu hỗ trợ một câu `SELECT` hoặc `WITH … SELECT`; dùng tài khoản database chỉ đọc. Cờ ODBC readonly/timeout phụ thuộc driver, bộ kiểm tra SQL không thay thế quyền phía database.
4. Chọn fetch limit 1.000/10.000/100.000 dòng, Ctrl+Enter để chạy. Bảng phân trang 50 dòng; nếu còn dữ liệu sẽ báo truncated. CSV/Excel export toàn bộ snapshot đã fetch, không chỉ trang hiện tại và không chạy lại query. Dữ liệu không tự gửi cho Copilot.
5. CSV dùng UTF-8 BOM và vô hiệu hóa chuỗi có thể thành công thức; Excel giữ kiểu số/NULL và chuỗi dưới dạng text. Cell quá giới hạn Excel được báo lỗi để dùng CSV. Stop dừng worker local; nếu driver/server vẫn chạy query, kiểm tra query history phía server.

SQLite/query/export đã được kiểm thử local. Kết nối Databricks thật cần driver, DSN và quyền của môi trường triển khai; chưa được xác minh bằng tài khoản Databricks trong phiên này.

## Bản 0.2.3 — Copilot ở nền

Sửa bộ chọn model 0.2.2 đã dùng kích thước hiển thị để lọc nút: khi Teams ở tab Chat, frame Copilot còn tồn tại nhưng không có layout rectangles nên model bị báo không tìm thấy. Bộ chọn mới dùng trạng thái DOM/menu, không yêu cầu chuyển tab Copilot hay dùng chuột/bàn phím. Nếu chọn model lỗi, thông báo phân biệt rõ đã tìm thấy ô chat nhưng chưa xác minh được model.

Sửa thêm rediscovery: giữ manifest khớp runtime đã attach, không đọc nhầm manifest mặc định khi Teams thay frame; xử lý cả frame đã bị destroy. Cài VSIX mới rồi reload VS Code để thay worker Python.

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

1. Cài VSIX bằng `Extensions: Install from VSIX…` hoặc CMD: `code --install-extension nopilot-0.2.3.vsix`.
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

Khi đang chờ Copilot hoặc lệnh local, Enter/nút ＋ gửi sẽ **xếp hàng** prompt thường (tối đa 10 tin). Draft và attachments tại thời điểm đó được giữ cùng tin. Tray trên composer cho xem, bỏ tin chưa gửi, tạm dừng/tiếp tục và đưa tin lên đầu. Từ 0.2.9, nút ↑ khi đang chờ Copilot dùng Stop rồi gửi steer; khi đang chạy lệnh/tool local vẫn ưu tiên lượt kế tiếp.

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

Nếu Teams vừa cập nhật và Nopilot báo thiếu manifest, mở Teams và chạy **Nopilot: Tạo manifest cho bản Teams này** từ Command Palette hoặc menu **…** của Nopilot. Lệnh đọc DLL WebView2 mà Teams đang dùng, thử PDB công khai của Microsoft rồi phân tích DLL tại máy nếu PDB không dùng được. Manifest được lưu theo SHA-256 trong `%LOCALAPPDATA%\nopilot\builds`. Sau khi tạo xong, bấm kết nối Teams để kiểm tra. Nếu thiếu `pefile`, dùng **Nopilot: Repair Bridge Dependencies** trước.

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
# Migration báo cáo

Model GGUF local: chạy **Nopilot: Configure Local GGUF Model**, hoặc `/local`. Xem [hướng dẫn local model](LOCAL_MODEL.md).

Mở **Nopilot: Open Migration Workbench** để chạy SQL nguồn/đích, đối chiếu dữ liệu và lặp lại với Copilot. Bấm **Thử demo local** để thử ngay bằng SQLite. Xem [hướng dẫn Migration](MIGRATION.md).

## Goal development

Use `/goal` to define an objective, explicit Definition of Done and a Python unittest verification command. Source and test execution keep separate approval cards; failing results can feed the next Copilot repair turn. See [Goal workflow](GOAL.md) for scope, evidence, protected tests and the 20-turn budget.
