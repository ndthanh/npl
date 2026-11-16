# Local GGUF trong Nopilot

Mở **Nopilot: Configure Local GGUF Model** từ Command Palette, hoặc gõ `/local` trong chat. Chọn Python, đường dẫn tuyệt đối tới GGUF, rồi **Load model** → **Test JSON**. Model chỉ load khi bạn bấm Load; không tự tải model hoặc gửi request cloud. Đóng tab cấu hình vẫn giữ model trong RAM; **Unload**, **Dừng** hoặc đóng extension sẽ giải phóng worker.

Gợi ý cấu hình khởi đầu: Qwen3-4B-Instruct-2507 GGUF Q4_K_M, context 8192, threads 4, GPU layers 0, tối đa 10 bước. Intel Graphics cần một runtime GPU tương thích để dùng GPU layers khác 0; bản CPU từ requirements dùng CPU. Chưa tự cài driver, benchmark GPU hay dùng NPU.

## Chuẩn bị runtime

Trong **Local Model**, chọn Python đã có trên máy, bấm **Cài runtime GGUF…** rồi duyệt card trong chat. Nopilot tạo hoặc tái sử dụng venv ở `%LOCALAPPDATA%\Nopilot\llm`, dùng thư mục tạm ngắn cho pip và kiểm tra import trước khi chọn runtime này. Sau đó mở lại **Local Model**, chọn GGUF và bấm **Load model**. Cần Python có wheel CPU tương thích.

Thẻ **Thiết lập runtime GGUF** tự kiểm tra Python khi mở tab. Nếu mạng chặn tải, giải nén bộ wheel đúng phiên bản Python và kiến trúc Windows, bấm **Dùng wheel offline…**, chọn thư mục chứa các file `.whl` rồi duyệt card trong chat. Khi lỗi, card chỉ rõ bước thất bại. Mở log của bước đó để xem lỗi pip hoặc Python.

Nếu máy công ty chặn cài qua mạng, dùng CMD và bộ wheel đã được phép sử dụng:

Dùng venv riêng, tránh thay đổi Python của bridge Teams. Ví dụ trên Windows với Python đã cài:

```cmd
python -m venv "%LOCALAPPDATA%\Nopilot\llm-env"
"%LOCALAPPDATA%\Nopilot\llm-env\Scripts\python.exe" -m pip install --only-binary=:all: --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu llama-cpp-python==0.3.36
```

Hoặc cài bằng file `bridge/requirements-local-model.txt` trong thư mục extension. Không dùng PowerShell và không yêu cầu compiler với wheel CPU tương thích. Máy bị chặn mạng có thể chuẩn bị wheel cùng dependencies trên máy được phép rồi cài offline bằng pip `--no-index --find-links`.

Tải GGUF từ nguồn bạn chọn, đặt ngoài project, sau đó điền đường dẫn. Nopilot không có chức năng tải model tự động. File `.gguf` cũng được loại khỏi project context theo mặc định để tránh gửi trọng số model lên Copilot.

Nếu lỗi **long path** xuất hiện khi load, Nopilot thử mở qua đường dẫn ngắn bằng hard link tạm trên cùng ổ đĩa. Nếu file nằm khác ổ, là placeholder OneDrive hoặc thư mục bị chặn, hãy đặt file đã tải đầy đủ vào một thư mục local ngắn được phép như `C:\Models` rồi chọn lại. Luồng này dùng quyền người dùng Windows hiện tại.

## Dùng trong vòng phát triển

Chọn **Develop**, sau đó thử:

```text
/local Liệt kê source, đọc check.py rồi đề xuất lệnh CMD để chạy kiểm thử. Chưa chạy ngay.
```

Hoặc yêu cầu Copilot hướng dẫn bước tiếp theo, rồi bấm biểu tượng **Local** cạnh câu trả lời / gõ `/local last`. Lời giải thích của Copilot được coi là dữ liệu tham khảo; model local không có quyền tự phê duyệt thao tác.

Model có thể:

- Liệt kê tối đa 400 đường dẫn file hợp lệ (quét tối đa 10.000 file), áp dụng `.nopilotignore` và mặc định loại secrets/runtime/model.
- Đọc tối đa 32 KiB đầu của một file trong workspace; báo rõ nếu đã cắt. Không đọc binary, đường dẫn ra ngoài workspace hoặc symlink.
- Đề xuất **một** lệnh CMD hoặc một `web.read`; Nopilot validate rồi tạo card duyệt hiện có. Chưa thực thi tới khi bạn bấm duyệt. Web cần bật web tools.
- Trả giải thích hoặc hỏi thêm nếu thiếu thông tin.

Trong chat, mỗi bước inference/đọc file có card thu gọn với trạng thái và output. Nút Dừng hủy worker và unload model; muốn thử lại phải Load lại. Không tự retry inference, lệnh hoặc lượt Teams.

Khi đã có contract Nopilot hợp lệ, luồng xử lý contract hiện có vẫn được giữ; không cần model diễn giải lại. Đề xuất đang chờ phải được giải quyết trước khi tạo đề xuất local mới.

`/assist` ưu tiên GGUF nếu đã thiết lập modelPath; nếu chưa cấu hình GGUF thì vẫn dùng endpoint smallModel cũ. Không có fallback cloud tự động khi GGUF lỗi.

## Gửi kết quả trở lại Copilot

Sau khi duyệt và chạy một đề xuất local, mở card output và bấm **Đưa kết quả vào bản nháp**. Bản nháp giữ phần đang viết và thêm mã lần chạy, trạng thái, exit code nếu có và trích đoạn output. Kiểm tra output, lựa chọn Include project và attachments trước khi bấm gửi. Kết quả được gửi qua luồng chat hiện tại, dùng lại hội thoại Copilot đã liên kết. Có thể dùng thao tác này với kết quả thành công hoặc thất bại.

Mỗi yêu cầu tối đa 10 bước, không tự tiếp tục khi hết lượt. Có thể gửi task mới cụ thể hơn. Context có giới hạn, nên ưu tiên file/log liên quan. Chưa tự sửa file bằng model nhỏ, chưa gọi SQL/Playwright, chưa tự tiếp tục sau HITL và chưa khôi phục inference sau reload. Chức năng sửa file/backup Git và tool SQL/Playwright hiện có của Nopilot vẫn dùng riêng như trước.

Thiết lập được lưu trong User Settings của VS Code; file GGUF và dependencies không được đóng gói vào VSIX. Chỉ hoạt động trong workspace đã trust.
