# Shell Effect Runtime Design

## 背景

hiven 的插件能力正在从纯文本命令扩展到本机工具。进程管理、Git、Docker、网络诊断、包管理、系统信息等常用插件都需要执行本机命令。如果每个插件都要求 host 新增专用 API，framework 会被迫承载大量产品语义，偏离 plugin host 的边界。

本设计引入第一版 Shell Effect Runtime。它不是安全沙箱，而是面向可信本地自动化的开放能力：插件经用户授权后可以执行本机 shell 命令；host 负责授权、执行控制、输出限制、错误返回和最小审计。

## 目标

- 支持 `builtin`、`dev`、`installed` 插件申请执行本机 shell 命令。
- 用户必须显式授权 `shell.run` 后，插件才能调用 shell runtime。
- 插件可以直接传 command string，支持自然 shell 组合，例如 pipe、grep、sort、awk。
- 插件可声明默认 shell；未声明时使用 host default shell。
- 插件运行时可传 `cwd`、附加 `env`、`timeoutMs`、`maxOutputBytes`。
- 默认继承 host 进程环境变量。
- host 强制 timeout、输出大小限制和并发控制。
- host 返回 stdout、stderr、exitCode、timedOut、durationMs 等原始执行结果。
- 审计日志只保存元数据，不保存命令原文、输出内容或 env values。
- 保持 framework 边界：host 提供通用 shell runtime，插件负责产品语义。

## 非目标

- 第一版不做 command allowlist。
- 第一版不做 action spec hash。
- 第一版不做声明式 pipeline stage 校验。
- 第一版不做 shell template 参数 schema。
- 第一版不禁止 `sh`、`zsh`、`bash`、`python`、`node`、`osascript` 等解释器。
- 第一版不做 env allowlist 或 secret store 注入。
- 第一版不做 cwd 授权目录模型。
- 第一版不做 destructive command 静态识别或二次确认。
- 第一版不做 `shell.spawn`、streaming output、detached task 或任务管理。
- 第一版不把 stdout/stderr 自动解析成 JSON、lines 或 table。
- 第一版不承诺 marketplace 级强安全模型。

## 核心原则

### Trusted Local Automation

`shell.run` 是高风险本地自动化能力。用户授权后，插件可以执行任意本机 shell 命令。命令可以读取文件、访问继承环境变量、启动或终止进程、联网传输数据，风险由插件来源信任、授权提示和执行限制共同承担。

因此授权页必须同时展示：

- 插件 manifest 中声明的用途说明。
- 高风险提示：此插件可执行任意本机 shell 命令。

### Host 不理解产品语义

host 不知道 `ps`、`grep`、`docker`、`git` 或 `kill` 的业务含义。host 只负责：

- 权限检查。
- shell 选择。
- 进程执行。
- timeout 和输出限制。
- 错误归一化。
- 最小审计元数据。

插件负责：

- 组合 command string。
- 解析 stdout/stderr。
- 判断业务成功或失败。
- 展示危险操作确认，例如 Kill Process 的确认弹窗。
- 根据插件场景决定重试、过滤、排序、缓存和 UI。

## Manifest

插件通过 manifest 请求 `shell.run`，并可声明默认 shell。

```json
{
  "pluginId": "process-monitor",
  "displayName": "Process Monitor",
  "capabilities": ["ui"],
  "permissions": ["shell.run"],
  "shell": {
    "description": "读取进程列表、筛选进程并执行用户确认后的结束进程操作。",
    "program": "/bin/zsh",
    "args": ["-lc"]
  }
}
```

字段语义：

- `permissions`: 包含 `shell.run` 时，插件可申请一次性 shell 命令执行能力。
- `shell.description`: 面向用户的用途说明。授权页展示该说明。
- `shell.program`: 插件偏好的 shell 程序。建议使用绝对路径。
- `shell.args`: shell 固定参数，例如 `["-lc"]` 或 `["-c"]`。

未声明 `shell.program` 时，host 使用默认 shell：

```text
优先 $SHELL
其次 /bin/zsh
最后 /bin/sh
```

host 可以在设置中允许用户覆盖默认 shell 或禁用某些 shell，但第一版不要求提供完整 shell 管理 UI。

## Host API

插件 SDK 暴露：

```ts
type ShellRunOptions = {
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  maxOutputBytes?: number
}

type ShellRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal?: string
  timedOut: boolean
  durationMs: number
  stdoutBytes: number
  stderrBytes: number
}

type PluginShellApi = {
  run(options: ShellRunOptions): Promise<ShellRunResult>
}
```

调用示例：

```ts
const result = await host.shell.run({
  command: "ps aux | grep Raycast | sort -nr -k3",
  timeoutMs: 3000,
  maxOutputBytes: 512_000,
})
```

Git 场景：

```ts
const result = await host.shell.run({
  command: "git status --short",
  cwd: repoPath,
  env: {
    NO_COLOR: "1",
    GIT_OPTIONAL_LOCKS: "0"
  }
})
```

## 执行语义

host 执行 shell 命令时：

```text
program = manifest shell.program 或 host default shell
args = manifest shell.args 或 default shell args
final argv = [program, ...args, command]
env = host process env + run.env
cwd = run.cwd 或 host 默认工作目录
```

默认工作目录建议使用插件私有数据目录，避免把命令默认跑在仓库根目录或应用启动目录。

`run.env` 只对单次子进程生效，不写回系统环境，也不写回 host 进程环境。审计记录 env keys，不记录 env values。

`timeoutMs` 规则：

- 未传、`<= 0` 或非法值时使用默认值。
- 默认值为 `10s`。
- 插件可以传任意正数覆盖。
- host 不设置全局硬上限。
- 第一版不支持无限超时；如果需要长时间任务，后续单独设计 `shell.spawn`。

`maxOutputBytes` 规则：

- host 必须有默认输出上限，避免 stdout/stderr 造成内存压力。
- 插件可传 `maxOutputBytes` 覆盖。
- 超出限制时 host 截断输出，并在结果中保留实际 bytes 计数。

## 权限与授权

`shell.run` 是独立插件权限，加入现有 plugin permission store。

授权页展示：

```text
插件说明：
<manifest shell.description>

高风险权限：
此插件可执行任意本机 shell 命令。命令可能读取文件、访问环境变量、启动或终止进程，或通过网络传输数据。仅在信任插件来源时启用。
```

授权规则：

- `builtin`、`dev`、`installed` 插件都可以请求 `shell.run`。
- 未授权时调用 `host.shell.run` 必须失败，并返回可展示权限错误。
- 插件新增 `shell.run` 权限时必须重新授权。
- 插件代码更新但权限集合不变时，不要求重新授权。
- 用户撤销 `shell.run` 后，禁止新的 shell 调用。
- 第一版不处理已运行任务撤销，因为 `shell.run` 是一次性调用并受 timeout 控制。

## 审计日志

第一版审计只保存元数据，不保存敏感内容。

保存：

- `pluginId`
- `source`
- `shellProgram`
- `shellArgs`
- 是否传入 `cwd`
- `envKeys`
- `startedAt`
- `finishedAt`
- `durationMs`
- `exitCode`
- `signal`
- `timedOut`
- `stdoutBytes`
- `stderrBytes`

不保存：

- command 原文。
- stdout 内容。
- stderr 内容。
- env values。
- 文件内容。

审计日志只保存在本地，并应提供清理能力。第一版可以先保留最近 N 条元数据。

## 错误语义

host 需要区分以下错误：

- 未授权 `shell.run`。
- shell program 不存在或不可执行。
- cwd 不存在或不可访问。
- 子进程启动失败。
- timeout。
- 输出超过限制。
- 进程正常结束但 exit code 非 0。

非 0 exit code 不等于 host runtime failure。host 应返回 `ShellRunResult`，由插件判断业务语义。

host runtime failure 才抛出异常或返回 rejected promise，例如未授权、shell 不存在、无法启动子进程。

## 与 Framework 边界

framework 不增加以下概念：

```text
process monitor
kill process
git status
docker ps
network diagnostics
package manager
pipeline parser
command allowlist
destructive command classifier
```

framework 只增加通用能力：

```text
permission: shell.run
sdk: host.shell.run(...)
runtime: execute shell command with timeout/output limits
audit: local metadata
```

如果后续某类插件反复遇到 shell 不适合表达的问题，再评估是否下沉为 host capability。判断标准是：该能力是否是系统原语，而不是某个插件的产品语义。

## 后续扩展

后续可独立设计：

- `shell.spawn`: 长任务、流式输出、cancel、surface 生命周期绑定。
- `shell.spawnDetached`: detached 后台任务和任务管理 UI。
- restricted shell mode: command allowlist、template schema、cwd/env allowlist。
- secret store: 用户显式保存 token，并由 host 注入子进程 env。
- command output helpers: 仅在多个插件确实重复实现时考虑。

这些能力不进入第一版，避免把 shell runtime 变成策略引擎。

## 验收标准

- 插件 manifest 可以声明 `shell.run` 权限和 shell program/args。
- 未授权插件调用 `host.shell.run` 会得到权限错误。
- 已授权插件可以执行 command string，并获得 stdout/stderr/exitCode/timedOut/durationMs。
- command 支持 shell 原生组合，例如 pipe 和 grep。
- `cwd` 和附加 `env` 能影响单次执行。
- 默认继承 host 环境变量。
- 默认 timeout 为 `10s`，插件可传任意正数覆盖，不支持无限超时。
- stdout/stderr 受最大字节数限制。
- 审计日志只记录元数据，不记录 command 原文、输出内容或 env values。
- installed 插件申请 `shell.run` 时必须展示用途说明和高风险提示。
- `npm run check:architecture` 通过。
- `git diff --check` 通过。
- `npm run build` 通过。
