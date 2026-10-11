# 剪贴板图片另存与路径复制

复用编解码的图片面板、现有受控 PNG 导出及原生另存对话框。搜索 `save screenshot`、`save clipboard image` 或 `截图存为文件` 可以找到原有图片工具；不创建重复入口。点击「保存剪贴板图片并复制路径…」时才读取一次剪贴板图片，冻结并转换为完整 PNG，然后选择保存位置。成功落盘后复制完整路径，不自动粘贴到外部。

- 沿用图片大小约束：PNG/JPEG/静态 WebP，10 MiB、单边 8192、1600 万像素；超限报错，不截断。
- 新操作使用带时间戳的文件名建议，只创建新文件。目标已存在（包括选择后被其他进程创建）时失败，请换未使用的文件名。原有「另存 PNG」保留原生对话框确认覆盖的既有语义。
- 取消或写文件失败不会执行剪贴板写入；写入失败不覆盖既有文件。路径复制失败单独提示「文件已保存，路径未复制」，不宣称整个保存失败。原有文本/图片面板输入及转换结果不变。
- `storage.blob.savePng` 仅新增 `copyPathToClipboard` 布尔选项，额外要求当前 `clipboard.write` 授权。插件既不传入也不接收目标路径；原生租约仍限定当前 webview、插件、一次提交和有效期。提交前再次核对 owner 和授权；接受提交之后报告真实落盘结果。
- 保留原私有 blob 清理；清理失败不覆盖保存/取消的真实结果。

验证：`node scripts/test-save-clipboard-png.mjs`、`node scripts/test-plugin-blob-export.mjs`、`node scripts/test-image-base64.mjs`；Rust `cargo test --manifest-path src-tauri/Cargo.toml plugin_png_export::tests --lib` 验证不覆盖、写后复制、复制失败部分成功及租约边界。以上为逻辑/模拟验证。真实原生对话框、PNG 文件和系统剪贴板验收由集成流程另行执行，不以逻辑测试代替。

Linux 原生验收：合成 PNG 取消另存后剪贴板字节不变；实际保存后剪贴板为完整绝对路径，文件像素与源图一致。写失败、不覆盖及复制失败边界由模拟事务和 Rust 测试验证；未将其称为原生 UI 成功。
