# 原生 debug smoke 的判据与证据

`npm run test:tauri-debug-smoke` 必须观测到本次启动树里的原生可执行进程，并确认同一 PID、启动身份和可执行路径连续存活。Vite ready、Running DevCommand、编译日志和旧的 hiven 进程都不算成功证据。默认启动截止时间为 25 秒，确认原生进程后另观察 1.5 秒；启动超时、进程提前退出、crash 日志和多候选歧义都失败。

Linux 从 `/proc` 获取实际可执行路径及进程启动身份；macOS 从 libproc 的 `proc_pidpath` 获取实际路径，使用 `/usr/bin/python3` 调用该只读 API。macOS 的 Python/libproc 不可用时检查失败并保留日志，不退回命令行名称匹配。Windows 暂无可靠探针，入口明确输出 unsupported skip，不报告通过。

默认目标是 `src-tauri/target/debug/hiven`。外置 `CARGO_TARGET_DIR` 和 `CARGO_BUILD_TARGET` 会参与路径解析；相对 target 目录以 `src-tauri` 为基准。使用 Cargo 配置文件指定其他目录时，可通过 `HIVEN_TAURI_SMOKE_BINARY` 明确给出可执行文件路径（相对仓库根目录或绝对路径）。路径配置只改变匹配对象，不绕过进程树、身份或存活检查。

- `HIVEN_TAURI_SMOKE_TIMEOUT_MS`：原生启动截止时间
- `HIVEN_TAURI_SMOKE_SETTLE_MS`：原生进程连续存活观察时长
- `HIVEN_TAURI_SMOKE_SHUTDOWN_MS`：进程组 TERM 后等待时长，超时后 KILL
- `HIVEN_KEEP_TAURI_SMOKE_LOG=1`：成功也保留日志；失败始终保留
- `HIVEN_TAURI_SMOKE_FORCE=1`：只跳过端口占用的预检，不跳过原生证据检查

`npm run test:tauri-debug-runtime-state` 使用相同 runner。仅 macOS 会执行额外的 System Events 检查，查询已确认原生 PID 的窗口数为 0，随后重新核验同一进程身份。非 macOS 明确 skip，不能当作窗口验收通过。它使用 `HIVEN_TAURI_RUNTIME_STATE_TIMEOUT_MS`、`HIVEN_TAURI_RUNTIME_STATE_SETTLE_MS`、`HIVEN_TAURI_RUNTIME_STATE_SHUTDOWN_MS` 和 `HIVEN_KEEP_TAURI_RUNTIME_STATE_LOG` 对应配置，另有 `HIVEN_TAURI_RUNTIME_STATE_VERIFY_TIMEOUT_MS` 限制 osascript 和额外验证时间（默认 5 秒）。

两入口在成功、失败和可处理的中断后都会清理启动的进程组；即使 npm 父进程先退出，也继续检查组内存活进程并按需发送 KILL。失败输出给出 `temp/` 下的日志路径，记录原始输出、选中 PID/身份/路径、失败原因和清理信号。

`npm run test:tauri-debug-runner` 是接入 quality gate 的无 GUI 生命周期回归，使用 fake npm 和复制的系统 sleep 可执行文件。它验证 runner 的证据、超时、退出和清理行为，不会启动 Tauri，也不能代替真实原生应用或 GUI 验收。
