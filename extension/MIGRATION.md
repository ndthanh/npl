# Nopilot Migration — thử một báo cáo

1. Mở workspace đã trust. Chạy **Nopilot: Open Migration Workbench** từ Command Palette. Hoặc bấm **Migration** trong tab Data / menu Nopilot.
2. Bấm **Thử demo local**, rồi **Chạy đối chiếu**: hai câu SQL cùng trả tổng doanh thu của SQLite demo → **Đạt**.
3. Sửa SQL đích thành `SUM(revenue) + 1 AS revenue`, giữ các cột còn lại. Chạy lại → ba dòng sai khác, ô doanh thu được đánh dấu.
4. Với báo cáo thật, trong **Nopilot Data** chọn **Oracle** hoặc **Databricks**, chọn DSN đã cấu hình và bấm **Test connection**. Có thể nhập chuỗi ODBC qua ô bảo mật nếu cần. Chọn **Oracle** cho nguồn và **Databricks** cho đích khi tạo báo cáo mới. Bấm **Làm mới kết nối** nếu profile chưa xuất hiện. Chuỗi ODBC được lưu trong SecretStorage.
5. Nhập SQL nguồn và SQL Databricks. Có thể đặt `USE CATALOG ...; USE SCHEMA ...; SELECT ...` trong SQL ODBC. Hai phía chạy độc lập, tuần tự; không kế thừa USE từ tab Data. Ctrl+Enter chạy cả hai câu SQL, không chỉ đoạn đang chọn.
6. Mở **Mapping, khóa và quy tắc đối chiếu**. Mapping mỗi dòng `cot_nguon=cot_dich`; bỏ trống để ghép toàn bộ cột cùng tên, không phụ thuộc thứ tự. Khóa dùng tên cột nguồn, ngăn cách bằng dấu phẩy. Khai báo rõ cột numeric để so bằng Decimal và sai số tuyệt đối nếu cần.
7. Ghi tham số / mốc dữ liệu; xác nhận hai bên dùng cùng điều kiện. Đây là ghi chú, **không phải template tự thay biến SQL**. Muốn lưu một bộ kiểm thử khác, **Nhân bản** báo cáo rồi sửa SQL và tham số.
8. **Nhờ Copilot chuyển / sửa SQL…** đưa SQL, mapping và số đếm sai khác vào bản nháp chat. Bạn xem rồi gửi. Không gửi hàng dữ liệu kết quả, không tự gửi prompt. Chế độ chat chuyển sang Chỉ hỏi, tắt Include project. Context/attachments do bạn đã chọn riêng trong chat vẫn cần được kiểm tra trước khi gửi.
9. SQL trả về từ Copilot có nút **Migration**: đưa vào editor đích của báo cáo đang chọn, chưa thực thi. Kiểm tra và **Chạy đối chiếu**.
10. Xem **Sai khác**, **Kết quả nguồn/đích**, **Hiệu năng**, **Lịch sử**. Grid phân trang 50 dòng; CSV/Excel export toàn bộ snapshot đã lấy. **Save As…** lưu định nghĩa JSON gồm SQL, mapping và lịch sử tóm tắt để quản lý bằng Git; **Mở định nghĩa…** nhập lại (cần kiểm tra kết nối và mốc dữ liệu).

## Cách đọc kết luận

- **Mở cửa sổ riêng** chuyển tab Workbench sang cửa sổ VS Code riêng. Có thể kéo tab trở lại cửa sổ editor.
- **Code Brief** lưu ghi chú nghiệp vụ theo báo cáo. Chọn **Thêm brief vào bản nháp Copilot** khi muốn đưa nội dung này vào bản nháp.
- Tab **Sai khác** đặt giá trị Nguồn và Đích cạnh nhau và đánh dấu từng ô thay đổi. Mở **Bằng chứng** để xem mã lượt chạy, SQL và cấu hình đã dùng.

- **Đạt**: toàn bộ cột được map, hai snapshot đầy đủ bằng nhau theo quy tắc đã chọn, khóa không trùng và người dùng đã xác nhận cùng mốc dữ liệu.
- **Có sai khác**: đối chiếu đầy đủ tìm được dòng thiếu/thừa hoặc khác giá trị.
- **Chưa kết luận**: chạm fetch limit, khóa trùng, thiếu xác nhận mốc dữ liệu hoặc mapping chưa phủ đủ cột. Chia nhỏ theo ngày/kỳ/partition để kiểm tra tiếp.

Không có khóa: so đa tập toàn dòng, giữ số lần xuất hiện của dòng trùng. Có khóa: so từng ô; khóa phải duy nhất. NULL khác chuỗi rỗng, không tự bỏ hoa/thường hoặc đổi timezone. Trim phải bật rõ ràng. Tolerance > 0 cần khóa và chỉ áp dụng cho các cột numeric đã chọn.

Số đếm dùng **toàn bộ snapshot**, không dùng 50 dòng preview. Sai khác hiện tối đa 100 mẫu. Fetch limit mỗi phía tối đa 100.000 dòng ở bản này; chưa có đối chiếu hàng triệu dòng phía server. SQL hoặc tùy chọn đổi sẽ đánh dấu kết quả cũ, phải chạy lại.

Định nghĩa và lịch sử lưu theo workspace trong VS Code. Bằng chứng từng lượt và dữ liệu snapshot lưu local trong storage của extension. Save As không xuất các hàng dữ liệu. Khi xem một lượt lịch sử, SQL hiện tại không bị ghi đè; SQL đã chạy nằm trong **SQL và cấu hình của lượt này**.

Schema: SQLite có bảng/cột/kiểu. ODBC lấy danh sách tối đa 200 bảng/view mà driver cung cấp từ metadata; chưa có tree drill-down cột Databricks hoặc mapping tự động. Metadata không tự gửi Copilot. Thời gian hiển thị gồm execute + fetch, không phải benchmark đồng thời hoặc Databricks query profile.

Bản đầu chưa tự transpile bằng Lakebridge, không sửa Power BI/M/DAX/RLS, chưa chạy batch báo cáo và chưa tự xác nhận UAT. Đạt đối chiếu SQL không thay thế kiểm thử báo cáo thực tế. Dừng sẽ hủy client; với ODBC cần kiểm tra query history của server khi cần. Reload giữa một lượt đang chạy không tự khôi phục/gửi lại lượt đó; các lượt đã hoàn tất và cấu hình vẫn được lưu.
