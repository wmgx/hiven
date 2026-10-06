# applepw 可行性研究

研究日期：2026-09-20。初始范围为公开源码、版本记录、本机启动失败证据；后续经用户明确授权增加了真实数据库只读测试，见末节。未输出账号、密码、OTP 或密钥材料，未修改系统安全配置。

## 结论

applepw 的密码和 OTP 查询逻辑确实存在，但当前版本在这台 macOS 15.6.1 上无法启动所需的系统 Helper。修正 daemon 的错误处理不能解决这个接入限制。Hiven 可以保留现有交互；后端是否替换为 apw，应先完成独立的启动与认证验证，不能把当前插件视为已完成真实数据接入。

## 实际工作方式

```text
Hiven → applepw CLI → 本机 UDP daemon → 标准输入/输出
      → PasswordManagerBrowserExtensionHelper → 苹果密码
```

applepw 读取浏览器 Native Messaging manifest，直接启动其中指定的 Apple Helper。CLI 实现 SRP PIN 配对以及 AES-GCM 消息加解密；daemon 只负责转发。它没有直接读取或解密密码数据库，也不是 Apple 对第三方提供的稳定密码库 API。

| 能力 | 源码中的实现与限制 |
|---|---|
| 账号查询 | 按网站调用 `GetLoginNamesForUrl`，不是全库枚举接口 |
| 密码读取 | 按网站、用户名调用 `GetPasswordForLoginName` |
| OTP 查询 | `otp list/get` 返回网站、用户名和可选的当前 `code`；没有导出 TOTP 种子的实现 |
| OTP 多账号 | CLI 只接收网站参数，调用方必须检查返回的用户名，不能直接取第一条 |
| 认证 | 系统挑战 PIN 配对，成功后保存会话信息；重启 daemon 会重新进入认证 |
| 状态检查 | Helper 能力查询成功且本地存在 shared key 时报告 ready，没有验证实际认证会话是否仍有效 |

依据：[client.rs](https://github.com/alecharmon/applepw/blob/eff6d1f56eeb9525953e8549be3ddeac81e4a351/src/client.rs)、[main.rs](https://github.com/alecharmon/applepw/blob/eff6d1f56eeb9525953e8549be3ddeac81e4a351/src/main.rs)、[types.rs](https://github.com/alecharmon/applepw/blob/eff6d1f56eeb9525953e8549be3ddeac81e4a351/src/types.rs)。这些是静态实现证据，不是本机查询成功的证据。

## 本机失败证据

- 系统版本：macOS 15.6.1，build 24G90；Homebrew formula：applepw 0.1.6。
- `~/.applepw/daemon.err`：`Failed to write length to stdin: Broken pipe (os error 32)`。
- 01:16:44 的 Helper 崩溃记录：父进程为 applepw，退出信号为 `SIGKILL (Code Signature Invalid)`，停在 `_dyld_start`。
- `codesign -d -vvvv` 显示 Helper 带有 `Has Parent Launch Constraints`。
- `codesign --verify --verbose=2` 显示 Helper `valid on disk` 且满足自身 Designated Requirement，因此没有发现文件签名损坏。

这些证据与父进程不满足启动约束的解释高度一致。[上游 issue 的复现分析](https://github.com/alecharmon/applepw/issues/1#issuecomment-5390743220)也指出该限制，但其测试系统是 macOS 26.5.2，不能直接当成本机测试结果。本次没有解码本机约束的完整允许名单；统一日志查询也没有获得额外的、直接指明失败条件的系统记录。

[Apple 官方说明](https://developer.apple.com/documentation/security/defining-launch-environment-and-library-constraints)：系统会检查被启动程序对父进程的约束，不满足时不运行程序。因此改等待时间、重试 auth、清理 PID、把浏览器名称参数改成 Arc，都不能赋予 CLI 合格的父进程身份。

## 值得修的小问题，但不足以恢复功能

| 问题 | 最小修复方向 | 能否解决当前阻塞 |
|---|---|---|
| 后台化以后才启动 Helper，错误隐藏在日志 | 启动预检、保留子进程退出原因 | 只能改善诊断 |
| Helper 退出后 daemon 留下 PID 文件 | 退出时清理，只处理已确认的本工具进程 | 不能 |
| `stop` 把 ESRCH 当作普通失败 | 正确识别进程已经不存在 | 不能 |
| stdout `read_exact` 没有真正的读取超时 | 对 Helper 响应增加超时和退出检测 | 不能 |
| `status.authenticated` 只检查本地密钥 | 检测会话有效性，或明确区分“有缓存密钥”和“认证有效” | 不能 |

依据：[daemon.rs](https://github.com/alecharmon/applepw/blob/eff6d1f56eeb9525953e8549be3ddeac81e4a351/src/daemon.rs)。

此外，`utils.rs` 把 shared key 以 Base64 写入 `~/.applepw/config.toml`，不是存进系统 Keychain；源码未显式强制仅本人读写的文件权限。它保存的是会话密钥，不能误称保存了整个密码库。daemon 的本机 UDP 入口也没有请求方身份校验；加密消息本身并不因此失效，但不能将本机 IPC 描述成已完成访问控制审计。以上为接入审查发现，未证明存在可利用漏洞。依据：[utils.rs](https://github.com/alecharmon/applepw/blob/eff6d1f56eeb9525953e8549be3ddeac81e4a351/src/utils.rs)。

## 是否继续投入

截至研究时，仓库 main 为 `eff6d1f56eeb9525953e8549be3ddeac81e4a351`，最后提交及最新 release v0.1.6 均在 2026-04-08。启动失败 issue 仍然开放；当前 main 仍直接启动 Helper，未见修复该接入方式的更新。[提交记录](https://github.com/alecharmon/applepw/commits/main/)、[版本记录](https://github.com/alecharmon/applepw/releases)。

保留 applepw 的 CLI 接口、把内部通信换成浏览器桥接在工程上可行，但这已经是重做接入层，不是修几行启动代码。仅为了 Hiven 查询密码和 OTP，维护这个 fork 的收益有限。

[apw 当前源码](https://github.com/bendews/apw/blob/main/src/browser.ts)使用独立 profile 启动后台 Chromium 系浏览器，把已安装的苹果密码扩展复制到工具目录并追加桥接脚本，随后使用扩展已经建立的 Native Messaging 连接。它不是简单调用一个公开密码 API，也不是原封不动使用扩展：桥接依赖 `g_nativeAppPort`、`g_secretSession` 等内部变量，扩展更新可能破坏兼容性。[桥接源码](https://github.com/bendews/apw/blob/main/ext/bridge.js)。

建议下一步只验证 apw 的 Helper 启动和用户自行完成的认证，再用用户指定的测试账号验证密码、OTP 及多账号匹配。通过后才替换 Hiven 后端。两者 CLI 的 JSON 结果类似，但 apw 的启动与状态协议不同，不能只替换可执行文件名。当前未安装或启动 apw，不能宣称它已在本机可用。

## 补充：直接读取数据库路线

结论：本机数据库可读，但尚无证据表明普通 Hiven 插件能从数据库直接得到苹果密码或 OTP。已核对的现成工具不能证明适配当前 M3 Pro、macOS 15.6.1。不能把“密码 App 能解锁”当作“本地存在插件可取出的数据库主密钥”，也不能据此断言所有年代、硬件上的钥匙串都绝对无法直接解密。

### 本机只读检查

使用 SQLite 的 `mode=ro` 打开 `~/Library/Keychains/<container>/keychain-2.db`，只读取 `sqlite_master` 和 `PRAGMA table_info`，没有查询任何条目记录或复制数据库。

- 文件权限为 `0600`；当前执行环境能够读取表结构。
- 存在 `genp`、`inet`、`keys`、`cert` 表，密码类表包含 `data`、`agrp`、`pdmn`、`sync` 等列。
- 同时存在传统 `login.keychain-db`，两者不能混为一谈。
- 硬件确认为 Apple M3 Pro，系统为 macOS 15.6.1。

这里证明的是“文件和结构可访问”。没有读取账号、网站、密文数据、密钥袋或 OTP，因此没有确认某个具体密码条目的位置、加密格式和保护类别。读取系统应用 entitlements 的命令返回解析警告，未得到可用结果，不能据此声称已验证密码 App 的具体访问组。

### 为什么 SQLite 查询不等于解密

[Apple TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)区分传统文件钥匙串与 Data Protection 钥匙串；iCloud Keychain 使用后者。后者按签名 entitlements 决定访问组，生物认证条件是附加检查，不能替代访问组授权。`security` CLI 主要面向传统文件钥匙串。

Apple 开源 Security，研究提交 `db15acbe6a7f257a859ad9a3bb86097bfe0679d9`：

- [SecDbKeychainItemV7.m](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/keychain/securityd/SecDbKeychainItemV7.m#L458)：读取秘密数据前先调用 `unwrapFromAKS` 解封条目密钥，再解密内容。普通封装走 Keybag/AKS；RefKey 分支还传递访问组和认证上下文。不能把文件中的 wrapped key 当成明文密钥。
- [SecDbKeychainMetadataKeyStore.m](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/keychain/securityd/SecDbKeychainMetadataKeyStore.m#L152)：持久化的元数据密钥同样需要解封；能定位元数据密钥记录不等于能解密秘密字段。
- [SecItemServer.c](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/keychain/securityd/SecItemServer.c#L2542)：正常查询先检查调用者的访问组，无组或不允许的组会拒绝。用户登录、Touch ID 或文件读取权限不会自动把第三方程序加入 Apple 的访问组。

这些是公开实现的机制证据，不保证与本机闭源系统组件逐行一致。后续补充了下文的私有 AKS 接口探针，但没有验证真实条目解密或硬件密钥导出能力，因此不宣称已经证明所有直接解密路径均不可能。

### 现有工具的适用范围

| 工具或研究 | 实际范围 | 对本机目标的意义 |
|---|---|---|
| [keychainbreaker](https://github.com/moond4rk/keychainbreaker#compatibility) | 支持传统 `.keychain` / `.keychain-db`，兼容表明确排除 `keychain-2.db` 与 Secure Enclave 保护的密钥 | 即使标注支持新 macOS，也不能拿来读取当前 iCloud 密码库 |
| [iChainbreaker](https://github.com/n0fate/iChainbreaker) | 确实研究过 Local Items 数据库；Python 2 PoC，版本解析只接受 `10.x`，依赖旧 `user.kb` 解密实现 | 证明历史上存在直接解密路线，没有提供 M3 / macOS 15 的兼容证据 |
| [Passware 的研究](https://blog.passware.com/a-deep-dive-into-apple-keychain-decryption/) | 描述数据库、Keybag 和用户密码组合，并明确讨论无 T2 设备等条件 | 说明硬件代际会改变前提，不能推广为任意现代 Mac 都能凭登录密码离线解密 |

以上工具未安装、未运行；没有导出主密钥、注入系统进程或改变 SIP。

### 对 Hiven 的取舍

在“正常系统安全配置、普通应用权限、用户明确认证、持续读取最新密码和 OTP”的范围内，直接读库目前不是已证实可行的实现方案。继续推进它，需要针对现代 Data Protection Keychain 的密钥获取和私有接口做单独逆向研究，成本与不确定性高于浏览器桥接。

普通应用可经授权访问部分传统钥匙串条目，但这不等于获得密码 App 的全库权限；Apple DTS 对不同开发团队共享 Data Protection Keychain 条目的说明也没有提供通用用户授权开关。[官方回复](https://developer.apple.com/forums/thread/836816)。建议保留直接读库的研究结论，暂不据此编写或发布插件后端。

## 补充：AppleKeyStore 本机探针（2026-09-20）

用户提出的理论路径值得区分成两种：从本地文件提取明文主密钥，以及读取数据库后请求本机受保护服务执行解封。后一条路径不必导出硬件根密钥；真正待证的是调用者权限、正确的用户 Keybag 和条目认证条件。

在 Apple M3 Pro / macOS 15.6.1 上编译最小 C 探针，仅对程序自造的 32 字节测试数据尝试封装。没有读取数据库记录、Keybag 文件、账号、密码或 OTP，没有 sudo、注入、签名权限伪造或更改 SIP。

| 检查 | 本机实测结果 | 可以得出的结论 |
|---|---|---|
| Codex 沙箱内连接 AppleKeyStore | `IOServiceOpen = 0xe00002e2` | 沙箱会影响实验，不能归因于普通用户身份 |
| 同一探针在沙箱外以普通用户运行 | `IOServiceOpen = 0` | 普通用户进程能够连接底层服务 |
| 加载 AppleKeyStore 私有框架 | 成功；`aks_wrap_key`、`aks_unwrap_key` 均存在 | 接口可定位，不等于调用获准 |
| `aks_get_system(0, …)`、`aks_get_lock_state(0, …)` | `0xe00002f0` | 本探针未取得可用的 device bag 状态；不据此解释具体权限原因 |
| device bag 上封装自造数据 | `0xe00002e2`，`not permitted` | 这组调用参数下封装被拒绝；未执行后续解封 |

**首轮限制（后续已补齐，见下节）：当时没有测试到已确认正确的 user-only Keybag。** Apple 当前公开的 [SecKeybagSupport.c](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/keychain/securityd/SecKeybagSupport.c#L54) 使用 `user_only_keybag_handle` 作为默认钥匙串 Keybag。首轮只使用同一文件明确提及的 device handle `0`，没有猜测或遍历句柄。调用 ABI 对照 Apple 的 [mockaks.m](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/tests/secdmockaks/mockaks.m) 核对；测试替身的返回值不能当作真实系统行为。

因此，首轮既没有证明直接读库可用，也没有证明它不可能。已经排除“普通程序完全无法连接 AppleKeyStore”这一过强判断；后续针对 user-only Keybag 做了以下补充验证。即使自造数据往返通过，仍需单独验证条目访问控制及 OTP 数据格式，不能直接宣布密码或 OTP 已可读取。

可复用探针保留在 `temp/keychain-aks-research/probe.c`。编译检查通过（`-Wall -Wextra -Werror`），运行结果如表。复现命令如下，运行环境必须注明是否受沙箱限制：

```sh
xcrun clang -Wall -Wextra -Werror -framework IOKit -framework CoreFoundation temp/keychain-aks-research/probe.c -o temp/keychain-aks-research/probe
./temp/keychain-aks-research/probe
```

这只是独立研究探针，未接入 Hiven 插件，也未改变现有插件后端。

### 第二轮：已确认 user-only Keybag，操作仍未通过

本轮补齐了句柄定义，不再把它列为未知项：

1. [Apple 的 SecAKSWrappers.h](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/utilities/SecAKSWrappers.h#L81) 明确定义：macOS 且启用 KeyStore 时，`user_only_keybag_handle = session_keybag_handle`。
2. 读取本进程加载的 AppleKeyStore 代码，确认 `AKSHandle.session` 的初始化值是 `-3`、`device` 是 `0`。没有调用不确定 ABI 的 Swift getter。可用 `python3 temp/keychain-aks-research/inspect-handles.py` 复核；脚本遇到不同指令布局会中止，不会继续猜测。
3. 对照 [LocalKeychainAnalytics.m](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/Analytics/Clients/LocalKeychainAnalytics.m#L87)，本机对应的 `canPersistMetrics` 代码在查询 Keybag 状态前传入 `-3`，与上述定义一致。只检查自身进程中的框架代码，没有附加或读取其他进程。

在 Codex 沙箱外以普通用户运行最终探针，实测如下：

| 输入句柄 | 解析句柄 | 状态查询 | 封装 32 字节自造数据 |
|---|---|---|---|
| `0`，device | `0xe00002f0` | `0xe00002f0` | `0xe00002e2`，not permitted |
| `-3`，user-only / session | 成功 | 成功 | `0xe00002e2`，not permitted |
| 系统解析出的 session 句柄 | 再次解析返回 invalid argument | 成功，与 `-3` 状态一致 | `0xe00002c2`，invalid argument |

封装缓冲区从首轮的 512 字节改为 Apple 当前源码定义上限对应的 128 字节后，结果不变。所有封装均失败，因此没有调用解封；**不能据此声称已直接验证 `aks_unwrap_key` 的权限或证明所有解密路径都不可行。** 解析成功也不意味着解析出的实际句柄适用于每一个 AKS 接口，参数错误不能描述为权限拒绝。

当前可确认的是：正确的用户 Keybag 可被普通进程解析、查询，但现有调用无法完成自造数据的封装／解封往返。`not permitted` 的具体来源尚未定位，不能直接归因于某一 entitlement、SIP 或 Touch ID 状态。Apple 的 `ks_crypt` 对部分权限错误也有“钥匙串锁定”的映射，单凭错误文本无法区分原因。

尝试用 Security 签名信息 API 读取 `secd` 和 Passwords 的 entitlements，API 返回成功，但未提供可解码的 entitlement 字典；仍不能宣称已核实这些系统程序的具体授权项。

验证记录：C 探针使用 `-Wall -Wextra -Werror` 编译通过；句柄检查脚本通过。探针退出码约定为 `0`＝至少一次往返匹配、`1`＝封装成功后往返失败、`2`＝没有完成任何往返；本机最终返回 `2`。没有接入插件、访问真实凭据或修改系统安全设置。

若继续这条路线，下一个具体研究问题是 `aks_wrap_key(-3)` 的权限错误来自客户端检查、系统服务还是 Keybag 状态，以及合法用户认证能否满足其条件。此时无需再扩展数据库解析器；读库尚不是阻塞点。

## 用户授权后的真实数据库测试

用户明确授权使用真实数据库，并接受由苹果原生认证界面完成认证后搜索。测试沿用只读连接，不修改或复制数据库，不将密钥材料、账号、密码或 OTP 写入文件或会话。

数据库包含 `metadatakeys(keyclass, actualKeyclass, data)`；抽样的一条互联网密码记录，其格式版本头为 `08 00 00 00`。这只是格式检查，未解析或输出账号和密码内容。

根据 [Apple 的元数据密钥读取和校验实现](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/keychain/securityd/SecDbKeychainMetadataKeyStore.m#L248)，只读读取 `keyclass = 6` 对应的一条封装记录，使用数据库中保存的 `actualKeyclass` 和 user-only Keybag 调用 `aks_unwrap_key`。本机实际类别为 `6`，封装长度为 40 字节。输出缓冲区在调用后清零；没有打印或保存密钥材料。

首次执行（尚未主动要求用户解锁 Passwords）返回 `0xe00002e2`，未取得 AES 元数据密钥。这次直接测试了真实记录的解封，而不再仅从自造数据封装失败推断。

打开系统 Passwords App 后，用户明确回复“已解锁，可以重试”。随后在相同普通用户、Codex 沙箱外环境重跑同一查询及解封调用，仍返回 `0xe00002e2`，未取得 AES 元数据密钥。

| 条件 | 真实元数据密钥解封 | 是否进入搜索 |
|---|---|---|
| 主动打开 Passwords 并请求认证之前（原先锁定状态未独立确认） | `0xe00002e2`，失败 | 否 |
| 用户确认 Passwords 已认证并保持解锁之后 | `0xe00002e2`，失败 | 否 |

本次对照验证了：**在这台机器上，解锁 Passwords App 并没有让当前普通进程获得直接解封这条真实元数据密钥的能力。** 不能把这个实验扩大为“所有用户认证形式都无效”或“所有直接解密方案均不可能”；本次没有取得 Passwords 的认证上下文，也没有测试条目 RefKey 的认证参数。阻塞点仍是直接 AKS 调用的访问条件，而不是 SQLite 读取或是否使用真实数据。

没有取得搜索所需的元数据密钥，因此未继续批量读取条目或尝试密码、OTP 解密；当前仍不能把该路径作为可用插件后端。

可复现探针：`python3 temp/keychain-aks-research/real-db-probe.py`。仅尝试一条元数据密钥；不会遍历条目、自动切换保护类别或读取密码明文。退出 `0` 表示获得合法长度的 AES 密钥，退出 `2` 表示未成功；本次返回 `2`。

## 替代路线研究

本轮为文档与源码审查，未安装或运行新第三方密码工具，未更改插件。只读检查确认本机已有 Chrome、Edge 和 Arc。

### 优先候选：apwlib / apwcli 的后台浏览器桥接

新找到的项目是 [michel-tricot/apwcli](https://github.com/michel-tricot/apwcli)，核对版本 `0.1.2`，提交 `fecfda7005dd49f1856526a80235d38a11a24c15`（2026-08-02）。它和直接启动 Helper 的 applepw 不同：

```text
Hiven → 本机 apwlib 适配程序 → 独立 profile 的后台浏览器
      → 苹果密码扩展的副本及桥接脚本 → Apple Helper → iCloud Keychain
```

[Apple 自己的说明](https://github.com/apple/password-manager-resources#how-apple-uses-web-browser-extension-distribution-information)确认 macOS 15.5 起按已知浏览器名单约束 Helper，新增浏览器需要系统更新。因此让已有受支持浏览器启动 Helper，在机制上对应本机 applepw 的启动阻塞点；这仍不是本机运行成功的证据。无需 Raycast，也不要求用户改变日常浏览器习惯，但后台浏览器进程需要持续运行。

已逐项核对源码：

- [daemon/server.py](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/packages/apwlib/src/apwlib/daemon/server.py)：独立 profile、`headless=True`，Unix socket 权限设为 `0600`。
- [daemon/extension.py](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/packages/apwlib/src/apwlib/daemon/extension.py)：下载苹果扩展副本并追加桥接脚本；不是公开稳定 SDK。桥接使用扩展内部 `g_nativeAppPort` 和 `g_secretSession`，扩展更新有兼容风险。
- [_client.py](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/packages/apwlib/src/apwlib/_client.py)：提供按 URL 的密码查询、OTP 条目列表和当前 OTP 查询；没有全库枚举接口。
- [pinwindow](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/packages/apwlib/src/apwlib/pinwindow/__init__.py)：支持无终端调用。Apple Helper 显示系统配对 PIN，工具另开图形窗口接收用户输入；工具窗口本身不是苹果系统认证框。不能承诺只按一次 Touch ID 即可。会话重启通常需要重新配对。
- [OTP CLI](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/src/apwcli/cli/otp.py)：按用户名筛选结果，避免多个账号时直接取第一条。获取的是当前验证码，未发现导出 TOTP 种子的接口。

一个必须修正的预期：该项目的 [_protocol.py](https://github.com/michel-tricot/apwcli/blob/fecfda7005dd49f1856526a80235d38a11a24c15/packages/apwlib/src/apwlib/_protocol.py) 特意省略了 command 4，并说明 Helper 不支持它作为登录名查询请求。这与 applepw 声明的账号查询能力存在差异，仍需本机协议验证；不能仅凭早先读到的 applepw 源码认定“无密码的账号搜索”可用。apwlib 的 `get_password(url)` 会取回密码，终端表格默认遮盖不代表没有读取；JSON/text 输出包含真实值。Hiven 接入时不能把它当作每次键入都会触发的普通搜索。

最小候选体验是“输入站点 → 原生 PIN 配对 → 返回该站点条目 → 选择账号复制密码或 OTP”。不能据此承诺“输入任意用户名片段，跨整个密码库模糊搜索”。可优先使用 apwlib 的小适配程序，没必要为 Hiven 引入 apwcli 的 MCP 功能。

### 其余路线对比

| 路线 | 适用范围 | 本次判断 |
|---|---|---|
| Apple Passwords 界面自动化 | 用户解锁后，操作原生搜索、选择和复制；具备实现跨库搜索的界面基础 | 可以继续做小原型；需要辅助功能权限，涉及前台窗口，受版本、语言和控件结构影响 |
| `ASAuthorizationPasswordProvider` | App 与网站建立关联且用户同意的登录凭据 | 不是任意第三方网站的全库查询 API，无法直接满足 Hiven 通用密码搜索 |
| 系统导出后建立本地索引 | 查询导出快照 | 无法实时反映 Apple Passwords 更新，需要管理额外敏感副本；当前系统版本的 OTP 导出范围未核实，不作为完整替代 |
| 其他直接启动 Helper 的 CLI（如 apwh） | 与 applepw 相近的 Native Messaging 协议 | apwh 作者明确记录父进程启动限制，换 CLI 名称没有改变机制 |
| 离线解密旧工具 | 传统钥匙串或旧版 Local Items | 仍没有找到可证明适配本机 M3 / macOS 15 密码库的新增证据 |

界面自动化参考 [leolabs/alfred-icloud-passwords](https://github.com/leolabs/alfred-icloud-passwords)。它确有搜索、复制密码和 OTP 脚本，但读到的 [find-password.applescript](https://github.com/leolabs/alfred-icloud-passwords/blob/master/find-password.applescript) 操作的是旧 `System Preferences` 密码面板，不是 macOS 15 的 Passwords App；只能作为思路参考，不能说下载即用。Apple 文档也说明用户可在 Passwords 中选择账号并复制当前验证码。[官方操作说明](https://support.apple.com/en-ca/guide/passwords/mchl873a6e72/mac)。

公开授权 API 的边界依据 [Apple Platform Security](https://support.apple.com/guide/security-pdf/app-access-to-saved-passwords-sec8762eb992/1/web/1)。apwh 的限制依据[作者 README](https://github.com/bryanmatteson/keychain-tools/blob/main/apwh/README.md)。

建议下一次实测优先验证 `apwlib + 后台 Edge/Chrome` 的启动、配对及单站点 OTP 查询。若“任意关键词全库搜索”是不可退让的需求，则优先做 Passwords App 辅助功能原型。两条路线当前均未在本机完成端到端验收。
