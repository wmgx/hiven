# 图片与 Base64

入口在编解码工作台的「图片 ⇄ Base64」标签，也可搜索「图片 Base64 / image base64」。沿用现有 custom-view，不新增原生窗口类型。

- 显式读取剪贴板图片或选择本地图片文件；不自动读取、抓取 URL、上传或调用 AI。
- 接受 PNG、JPEG、静态 WebP 的 Base64/data URI。先验证实际文件签名、声明 MIME 和头部尺寸，再以浏览器图片解码验证；拒绝 SVG、HTML、动画 WebP 及其他格式。图片读取和转换有 5 秒解码截止时间。
- 输入上限 10 MiB，单边最多 8192 像素、总计最多 16 × 1024 × 1024 像素；不截断。粘贴原始 Base64 必须是标准规范编码，允许空白，不接受 URL-safe 字母表。
- data URI 保存原始图片字节。预览、复制图片、原生另存以 PNG 为准，因此会去除 JPEG/其他元数据，JPEG EXIF 方向由解码器处理。
- 输出、复制、另存都需明确点击。复制图片/另存复用 SDK 的短暂 PNG blob，完成或失败后删除；无图片历史、无内容日志。取消、换输入及 owner 失效会阻止晚回替换当前结果。
- 声明必要插件权限 clipboard.read、clipboard.image、storage.blob，复用已有 clipboard.write，不新增系统权限。剪贴板图片读取仅原生桌面提供；其他环境可选择文件或粘贴 Base64。

定向逻辑检查：`node scripts/test-image-base64.mjs`（二进制往返、类型伪装、主动内容拒绝、尺寸上限、JPEG/WebP 头部、动画拒绝）。隔离 Linux X11 原生 UI 已验证：合成 64×32 PNG → 显式读取剪贴板图片 → 复制完整 data URI → 粘贴并恢复预览 → 复制 PNG → 原生 Save File 对话框保存。data URI、系统图片剪贴板与保存 PNG 均解码后逐像素等于原图；SVG data URI 在界面明确拒绝。未运行真实 API，也未读取真实用户图片。
