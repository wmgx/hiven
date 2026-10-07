import { spawn, execFile } from 'node:child_process'
import { mkdir, readdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import net from 'node:net'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const suspiciousPattern = /Unhandled rejection|ReferenceError|TypeError|panic|panicked|compilation failed|error:/i
const supportedPlatforms = new Set(['linux', 'darwin'])

export function duration(value, fallback, name) {
  const result = Number(value ?? fallback)
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${name} must be a positive finite duration`)
  return result
}

export async function isPortBusy(port) {
  const tryHost = (host) => new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const finish = (busy) => { socket.destroy(); resolve(busy) }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
  return (await tryHost('127.0.0.1')) || (await tryHost('::1'))
}

export function tauriCommand(env = process.env) {
  const packageManager = env.npm_execpath
  const pnpm = /pnpm/i.test(packageManager ?? '') || /pnpm\//i.test(env.npm_config_user_agent ?? '')
  const args = pnpm ? ['run', 'tauri', 'dev'] : ['run', 'tauri', '--', 'dev']
  return {
    command: packageManager ? process.execPath : pnpm ? 'pnpm' : 'npm',
    args: packageManager ? [packageManager, ...args] : args,
    env: {
      ...env,
      NO_COLOR: env.NO_COLOR ?? '1',
      PATH: [env.npm_node_execpath ? dirname(env.npm_node_execpath) : '', '/opt/homebrew/bin', env.PATH ?? ''].filter(Boolean).join(delimiter),
    },
  }
}

export function nativeExecutable(root, env = process.env) {
  // Explicit override also covers Cargo config files and cross-target debug directories.
  if (env.HIVEN_TAURI_SMOKE_BINARY) return resolve(root, env.HIVEN_TAURI_SMOKE_BINARY)
  const target = resolve(root, 'src-tauri', env.CARGO_TARGET_DIR ?? 'target')
  return join(target, ...(env.CARGO_BUILD_TARGET ? [env.CARGO_BUILD_TARGET] : []), 'debug', 'hiven')
}

export async function processSnapshot() {
  if (process.platform === 'linux') {
    const entries = await readdir('/proc')
    const rows = await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(async (entry) => {
      try {
        const stat = await readFile(`/proc/${entry}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        const executable = await readlink(`/proc/${entry}/exe`).catch(() => null)
        return { pid: Number(entry), ppid: Number(fields[1]), pgid: Number(fields[2]), state: fields[0], started: fields[19], executable }
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
        throw error
      }
    }))
    return rows.filter(Boolean)
  }
  if (process.platform === 'darwin') {
    const { stdout } = await exec('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,stat=,lstart='], { timeout: 1_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })
    return stdout.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s*$/)
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), state: match[4], started: match[5] }] : []
    })
  }
  throw new Error(`native process probing is unsupported on ${process.platform}`)
}

const live = (row) => !/^[ZX]/.test(row.state)
const identity = (row) => `${row.pid}:${row.started}`

async function executablePaths(rows) {
  if (process.platform !== 'darwin' || rows.length === 0) return rows
  // macOS ps comm is argv[0], not trustworthy executable evidence. Ask libproc.
  // Xcode's Python is a probe prerequisite; a missing/broken probe fails closed.
  const script = `import ctypes, json, sys
lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
lib.proc_pidpath.restype = ctypes.c_int
paths = {}
for value in sys.argv[1:]:
    buf = ctypes.create_string_buffer(4096)
    if lib.proc_pidpath(int(value), buf, len(buf)) > 0:
        paths[value] = buf.value.decode('utf-8')
print(json.dumps(paths))`
  const { stdout } = await exec('/usr/bin/python3', ['-c', script, ...rows.map((row) => String(row.pid))], { timeout: 1_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
  const paths = JSON.parse(stdout)
  return rows.map((row) => ({ ...row, executable: paths[row.pid] ?? null }))
}

function descendedFrom(row, ancestor, rows) {
  const byPid = new Map(rows.map((item) => [item.pid, item]))
  const seen = new Set()
  while (row && !seen.has(row.pid)) {
    if (row.ppid === ancestor) return true
    seen.add(row.pid)
    row = byPid.get(row.ppid)
  }
  return false
}

async function stopGroup(pgid, shutdownMs, record) {
  if (!pgid) return
  const signal = (name) => {
    try { process.kill(-pgid, name); record(`cleanup ${name} process group ${pgid}`) }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const remaining = async () => (await processSnapshot()).filter((row) => row.pgid === pgid && live(row))
  const waitUntilEmpty = async (ms) => {
    const deadline = Date.now() + ms
    do {
      if (!(await remaining()).length) return true
      await sleep(Math.min(50, Math.max(1, deadline - Date.now())))
    } while (Date.now() < deadline)
    return !(await remaining()).length
  }
  signal('SIGTERM')
  if (await waitUntilEmpty(shutdownMs)) return
  signal('SIGKILL')
  if (!(await waitUntilEmpty(1_000))) throw new Error(`process group ${pgid} still has live processes after SIGKILL`)
}

// Proves launch/survival of one executable from this invocation, not GUI correctness.
export async function runNativeSmoke({
  root = process.cwd(), name = 'tauri-debug-smoke', command, args = [], env = process.env,
  executable, timeoutMs = 25_000, settleMs = 1_500, shutdownMs = 2_000,
  verifyTimeoutMs = 5_000, verify, keepLog = false, pollMs = 100,
}) {
  if (!supportedPlatforms.has(process.platform)) return { skipped: `native process probing is unsupported on ${process.platform}` }
  for (const [key, value] of Object.entries({ timeoutMs, settleMs, shutdownMs, verifyTimeoutMs, pollMs })) duration(value, undefined, key)
  const tempDir = join(root, 'temp')
  await mkdir(tempDir, { recursive: true })
  const logPath = join(tempDir, `${name}-${Date.now()}-${process.pid}.log`)
  let output = ''
  const record = (message) => { output += `\n[smoke] ${message}\n` }
  let runtimeOutput = ''
  let child
  let failure
  let selected
  let exited
  let spawnError
  let interrupted
  const onInterrupt = (signal) => { interrupted = signal }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)
  const abort = new AbortController()
  try {
    const before = new Set((await processSnapshot()).map(identity))
    record(`expected executable: ${executable}`)
    child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const collect = (chunk) => { output += chunk.toString(); runtimeOutput += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('exit', (code, signal) => { exited = { code, signal }; record(`launcher exited: code=${code} signal=${signal}`) })
    child.once('error', (error) => { spawnError = error })
    const checkLauncher = () => {
      if (interrupted) throw new Error(`native smoke interrupted by ${interrupted}`)
      if (spawnError) throw spawnError
      if (exited) throw new Error(`tauri dev exited: code=${exited.code} signal=${exited.signal}`)
      if (suspiciousPattern.test(runtimeOutput)) throw new Error('startup/runtime failure signature in log')
    }
    const check = async () => {
      checkLauncher()
      const rows = await processSnapshot()
      const expected = await realpath(executable).catch((error) => {
        if (error.code === 'ENOENT') return null // Build may still be producing the executable.
        throw error
      })
      const owned = rows.filter((row) => live(row) && row.pgid === child.pid && !before.has(identity(row)) && descendedFrom(row, child.pid, rows))
      const candidates = (await executablePaths(owned)).filter((row) => expected && row.executable === expected)
      if (candidates.length > 1) throw new Error('ambiguous native launch: multiple matching processes in this invocation')
      if (selected) {
        const same = candidates.find((row) => identity(row) === identity(selected) && row.executable === selected.executable)
        if (!same) throw new Error(`native process ${selected.pid} exited or changed identity`)
      }
      checkLauncher()
      return candidates[0]
    }
    const deadline = Date.now() + timeoutMs
    while (!selected) {
      const candidate = await check()
      if (Date.now() >= deadline) throw new Error(`native startup timed out after ${timeoutMs}ms; no confirmed launch before deadline`)
      selected = candidate
      if (!selected) await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())))
    }
    record(`observed native pid=${selected.pid} start=${selected.started} executable=${selected.executable} group=${child.pid}`)
    const settledAt = Date.now() + settleMs
    while (Date.now() < settledAt) {
      await check()
      await sleep(Math.min(pollMs, Math.max(1, settledAt - Date.now())))
    }
    await check()
    if (verify) {
      let verification
      // The callback must honor signal for any subprocess/resource it starts.
      Promise.resolve().then(() => verify({ pid: selected.pid, signal: abort.signal, timeoutMs: verifyTimeoutMs, record })).then(
        () => { verification = { ok: true } },
        (error) => { verification = { error } },
      )
      const verificationDeadline = Date.now() + verifyTimeoutMs
      while (!verification) {
        await check()
        if (Date.now() >= verificationDeadline) throw new Error(`native verification timed out after ${verifyTimeoutMs}ms`)
        await sleep(Math.min(pollMs, Math.max(1, verificationDeadline - Date.now())))
      }
      if (verification.error) throw verification.error
      if (Date.now() >= verificationDeadline) throw new Error(`native verification timed out after ${verifyTimeoutMs}ms`)
      await check() // Reject a process which died/restarted during verification.
    }
    record(`native pid=${selected.pid} survived ${settleMs}ms and final identity check`)
  } catch (error) {
    failure = error
    record(`FAILED: ${error.stack ?? error}`)
  } finally {
    abort.abort()
    try { await stopGroup(child?.pid, shutdownMs, record) }
    catch (error) { failure ??= error; record(`cleanup FAILED: ${error.stack ?? error}`) }
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onInterrupt)
    child?.stdout.destroy()
    child?.stderr.destroy()
    await writeFile(logPath, output)
  }
  if (failure) {
    // The original stack was already read for the log. Build a new Error so
    // Node's uncaught-exception output also includes the retained evidence path.
    throw new Error(`${failure.message ?? failure}\nFailure log retained at ${logPath}`, { cause: failure })
  }
  if (!keepLog) await rm(logPath, { force: true })
  return { pid: selected.pid, logPath: keepLog ? logPath : undefined }
}
