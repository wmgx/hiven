# 苹果密码插件（0.1.0）

已实现 hiven 命令「查询苹果密码」「查询苹果验证码」。输入网站域名，选择账号后复制密码或当前 TOTP；附加动作可复制用户名。无需 Raycast。

依赖独立安装的 [applepw](https://github.com/alecharmon/applepw)，接入方式参考 [Raycast 插件](https://github.com/raycast/extensions/tree/main/extensions/apple-passwords)。没有复制第三方源码或将其打包进 hiven。

当前真实接入被 applepw 的 Helper 启动失败阻塞，不能按“安装后执行 auth 即可使用”描述。插件仍提供安装、认证命令和重试入口，但重复认证不能解决本机启动限制；详见 [applepw 研究](applepw-research.md)。

插件不持久化凭据，不把秘密交给普通文本输出、编辑器或日志。查询只保留账号元数据，选择后实时获取秘密，严格按域名及用户名匹配，不能匹配时不回退到其他账号。认证 PIN 不经过 hiven。

Host 新增通用敏感剪贴板能力：macOS 写入 concealed/transient 标记，公共读取入口跳过标记内容；Quick Editor 复用同一复制实现。此原生能力需要重新编译运行桌面端，旧原生端不会降级为普通复制。标记不等于剪贴板访问隔离，其他应用是否遵守标记取决于其实现。

## 验证记录（2026-09-20）

| 验证 | 结果 |
|---|---|
| `node scripts/test-apple-passwords.mjs` | 通过：虚构账号的密码／OTP 查询复制、密码空白保留、敏感复制、账号不匹配停止复制 |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline --lib clipboard_privacy::tests -- --test-threads=1` | 通过：独立命名的测试剪贴板验证普通内容可读、敏感内容自动读取为空、目标应用仍可粘贴；未碰用户剪贴板 |
| `npm run test:native-clipboard-read`、`test:plugin-shell-runtime`、`test:plugin-permission-least-privilege`、`test:plugin-text-output-contract`、`test:directory-plugin-convergence` | 通过 |
| `npm run check:architecture`、`git diff --check`、`npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml --offline` | 通过 |
| `git status --short --ignored` | 已检查，保留工作区原有改动，未提交 |
| 发布目录与中英文 | `~/.local/hiven/plugins/builtin/apple-passwords` 与源文件逐项一致；中英文 locale key 一致 |
| 浏览器 DOM、画面与交互 | 实际页面显示两个中文命令；点击进入 Shell 权限页，未替用户授权。开发热更新期间出现 desktop bridge 连接失败，未宣称控制台全程无错误 |
| 全量类型检查 | 仍有 21 个其他位置的错误，本次插件及改动的剪贴板代码无类型错误 |
| 现有 i18n／Quick Editor 测试 | 分别被未修改的 ObservationSettings 内联 locale 分支、GlobalLauncherFrameSwitch 静态结构断言阻塞 |

## 未验证范围

GitHub 网络恢复后，已通过 Homebrew 成功安装 `applepw`（formula 0.1.6，CLI 自报 `applepw-cli 1.0.1`）。用户执行 `applepw auth` 后报 daemon 启动失败；本机日志确认 Helper 被系统 SIGKILL，签名信息显示父进程启动约束，文件本身签名校验通过。认证和真实账号／OTP 查询均未验证成功。不要把 PIN、密码或验证码发到会话中。

系统 helper 接入为第三方方案，macOS 更新后的兼容性须实测。只支持已存入苹果密码的 TOTP，不读取短信验证码，不导出种子，不保证遍历整个密码库。
