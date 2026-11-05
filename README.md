# Note IINA

**Timestamped lecture notes, right inside IINA.**

Ghi lại điều mình hiểu khi xem bài giảng, rồi mở lại ghi chú theo video hoặc đọc cả cuốn sổ course. Không cần chuyển sang app khác, không cần mở sổ giấy trên bàn.

[Download latest release](https://github.com/Chudien-2923/note-iina/releases/latest) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/Chudien-2923/note-iina/issues)

## Plugin làm gì?

- Bấm **N** trong player để mở panel và bắt đầu viết.
- Tự gắn timestamp khi bắt đầu nháp; **⌘ Enter** để lưu điều mình hiểu bằng lời của mình.
- Xem ghi chú của bài đang mở, sửa hoặc xóa khi cần.
- Mở **Cuốn sổ course** để đọc theo bài và tìm lại một topic xuyên các video.
- Bấm timestamp để quay lại đoạn video liên quan.
- Lưu cùng folder course, dùng đường dẫn tương đối để có thể chuyển nguyên course sang nơi khác.

Đây là **plugin cho IINA trên macOS**, không phải trình phát video hay ứng dụng ghi chú độc lập. Plugin không tạo tóm tắt AI, không có tài khoản, telemetry, cloud sync hay kết nối mạng; không có production dependencies.

## Cài đặt

Đã kiểm tra với **IINA 1.5.0, build 180**. Các phiên bản khác chưa được chứng nhận.

1. Cài [IINA](https://iina.io/) và bật hỗ trợ plugin trong **Settings → Plugins** nếu đang tắt.
2. Tải `note-iina-1.0.1.iinaplgz` từ [GitHub Releases](https://github.com/Chudien-2923/note-iina/releases/latest).
3. Trong IINA, chọn **Settings → Plugins → Install Local Package…**, rồi chọn file vừa tải.
4. Kiểm tra tên **Note IINA** và quyền truy cập filesystem/hiện thông báo; bật plugin.
5. Mở một video local, bấm **N**, rồi chọn **Dùng folder chứa video** hoặc **Chọn folder khác…** nếu course gồm nhiều folder con.

Không cần Node, npm hay server để dùng bản đóng gói. Muốn nâng cấp: tải archive của release mới và cài thay thế trong IINA. Sao lưu dữ liệu trước khi nâng cấp; không xóa folder course hoặc dữ liệu plugin chỉ để cập nhật.

## Cách dùng

| Thao tác | Kết quả |
| --- | --- |
| **N** khi focus ở player | Mở panel/focus ô ghi chú; không tự pause hoặc resume |
| **⌘ Enter** hoặc **Lưu** | Lưu note với timestamp lúc bắt đầu nháp |
| **Enter** trong editor | Xuống dòng; chữ n và Space nhập bình thường |
| **Escape** trong sidebar | Đóng panel |
| **Cuốn sổ course** | Đọc và tìm ghi chú của cả course |
| Bấm timestamp | Mở đúng video, pause và seek tới đoạn đã ghi |

Menu **Plugin → Mở ghi chú** là cách mở thay thế. Nếu N đã được gán trong keymap riêng, plugin báo xung đột thay vì tự sửa keymap.

Chọn folder course chứa video, có thể là folder cha của nhiều chương. Hủy chọn không làm mất chữ đang viết. Tìm kiếm không phân biệt hoa/thường, vẫn giữ dấu tiếng Việt. Ghi lỗi giữ nội dung để xử lý, không báo đã lưu.

Sidebar do IINA quản lý; trên máy đã thử, nó nằm **bên trái và phủ lên video**. Cuốn sổ là cửa sổ thuộc IINA, không phải app riêng.

## Dữ liệu và sao lưu

Note đã lưu nằm trong file UTF-8:

```text
<folder course>/.iina-notes.json
```

File chứa version schema, ID course và các note gồm đường dẫn video tương đối, timestamp, văn bản và ngày tạo/sửa. Các video trùng tên trong folder con không dùng chung note.

- Chuyển/copy **nguyên folder course**, bao gồm `.iina-notes.json`, để giữ liên kết.
- Đổi tên hoặc chuyển riêng video không được tự đoán ghép lại; note vẫn đọc được và file thiếu được báo rõ.
- Finder có thể ẩn file bắt đầu bằng dấu chấm. Bấm **⌘ Shift .** để hiện file ẩn.
- **Sidecar không phải backup.** Sao lưu cả folder course; xóa folder có thể làm mất note.
- Nháp nằm trong dữ liệu riêng của IINA, dưới `plugins/.data/local.note-iina`; không thay thế note đã lưu trong course. Nếu có nhiều nháp cùng bài, chọn bản cần phục hồi.
- Folder chỉ đọc hoặc JSON hỏng: dừng ghi, báo lỗi và giữ nháp; không tự reset course rỗng hay đổi nơi lưu.
- Chỉ hỗ trợ video local; stream/URL không thuộc phạm vi hiện tại.

Không commit hoặc đính kèm file note cá nhân vào issue công khai. Nếu báo lỗi, chỉ gửi dữ liệu mẫu đã ẩn nội dung riêng tư.

## Trạng thái kiểm chứng

**v1.0.1: người dùng đã xác nhận plugin chạy ổn trong IINA sau khi cập nhật.** Điều này không đồng nghĩa mọi tổ hợp thiết bị và thao tác đều đã được kiểm tra.

- 60 behavioral tests trên Node, bao gồm regression JavaScriptCore thật trên macOS: tạo course, lưu note, nhận xác nhận và giữ nháp khi đóng.
- Đã thử trên IINA thật: cài/thay thế archive, N mở sidebar và focus editor, nhập tiếng Việt nhiều dòng, nhập chữ n bình thường, phục hồi nháp sau reload.
- Regression cho đường dẫn macOS NFC/NFD, phục hồi nháp cũ, quyền sở hữu nháp và điều hướng stale.
- **Chưa chứng nhận riêng đầy đủ:** reader/search/seek xuyên bài, nhiều player cùng course, chuyển course, toàn bộ light/dark/fullscreen và chuỗi composition IME tiếng Việt. Hãy sao lưu note quan trọng và báo lỗi nếu gặp vấn đề.

## Clone và phát triển

```sh
git clone https://github.com/Chudien-2923/note-iina.git
cd note-iina
npm test
npm run pack
unzip -t note-iina-1.0.1.iinaplgz
```

Cần **Node 20+**; không cần `npm install` vì project không có dependencies. Đóng gói dùng `/usr/bin/zip`. Test JavaScriptCore trên macOS cần Swift command-line tools; test này tự bỏ qua trên hệ điều hành khác. Muốn chạy plugin vẫn cần macOS và IINA.

```text
note-iina.iinaplugin/  Runtime plugin, manifest, UI và các module
scripts/pack.cjs       Tạo archive cài đặt
tests/                 Behavioral tests và native-engine regression
PRODUCT.md             Phạm vi và nguyên tắc sản phẩm
DESIGN.md              Quyết định giao diện
CHANGELOG.md           Lịch sử thay đổi
RELEASING.md           Quy trình phát hành và quản lý phiên bản
```

Runtime là JavaScript/CommonJS và HTML/CSS, không dùng framework. Global entry là writer duy nhất; ghi file tạm cùng folder rồi atomic rename trước khi xác nhận lưu. RPC chạy ở native main-loop turn mới để tránh Promise bị kẹt khi gọi lồng hai JSContext. Nháp cuối được chuyển cho global writer trước khi player unregister.

Có thể dùng `iina-plugin link note-iina.iinaplugin` khi phát triển nếu đã cài CLI của IINA. Không đồng thời giữ DEV link và archive có cùng identifier. Cấu hình máy, lịch sử làm việc và công cụ thiết kế cài cục bộ không nằm trong repository và không cần để build.

## Phiên bản và đóng góp

Dùng **Semantic Versioning**: `MAJOR.MINOR.PATCH`, tag Git `vX.Y.Z`, release notes trong [CHANGELOG.md](CHANGELOG.md), archive cài đặt tại [Releases](https://github.com/Chudien-2923/note-iina/releases). Quy trình cho maintainer: [RELEASING.md](RELEASING.md).

Issue/PR được chào đón. Khi báo lỗi, ghi phiên bản macOS, IINA và plugin, các bước tái hiện, kết quả mong đợi/thực tế; không gửi video hoặc note riêng tư. Khi sửa code, chạy `npm test` và mô tả kiểm tra thực tế đã thực hiện.

## License

[MIT](LICENSE). Note IINA là dự án độc lập, không phải sản phẩm chính thức của IINA.
