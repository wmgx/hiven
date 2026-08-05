#!/usr/bin/env node
/**
 * test-launcher-session-intent-context.mjs
 *
 * Contract: useLauncherSession injects detections + foregroundApp into rankLauncherItems;
 * GlobalLauncherHost fetches foreground app on open and passes it into the session.
 *
 * Static source assertions (hook unit tests are heavy without a React harness).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SESSION = 'src/workspace/launcher/useLauncherSession.ts'
const GLOBAL_HOST = 'src/launcher/hosts/GlobalLauncherHost.tsx'

const sessionSrc = readFileSync(SESSION, 'utf8')
const hostSrc = readFileSync(GLOBAL_HOST, 'utf8')

// ─── useLauncherSession: detectContent + detections ───────────────────────────

assert.ok(
  /import\s*\{[^}]*\bdetectContent\b[^}]*\}\s*from\s*['"][^'"]*kits\/content(?:\/[^'"]*)?['"]/.test(sessionSrc) ||
    /import\s*\{[^}]*\bdetectContent\b[^}]*\}\s*from\s*['"][^'"]*content[^'"]*['"]/.test(sessionSrc),
  'useLauncherSession.ts must import detectContent from content-kit',
)

assert.ok(
  /\bdetectContent\s*\(/.test(sessionSrc),
  'useLauncherSession.ts must call detectContent(...)',
)

assert.ok(
  /\bdetections\b/.test(sessionSrc),
  'useLauncherSession.ts must pass detections into ranking context',
)

assert.ok(
  /rankLauncherItems\s*\(\s*\{[\s\S]*?\bdetections\b[\s\S]*?\}/.test(sessionSrc) ||
    /detections\s*[,}][\s\S]{0,200}rankLauncherItems|rankLauncherItems[\s\S]{0,400}\bdetections\b/.test(sessionSrc),
  'useLauncherSession.ts must include detections in the rankLauncherItems context object',
)

// Empty content → [] (or equivalent safe empty handling)
assert.ok(
  /detectContent\s*\([^)]+\)\s*:\s*\[\]|detections\s*=\s*[^;]*\?\s*detectContent|detections\s*=\s*contentText\s*\?\s*detectContent/.test(sessionSrc) ||
    /const\s+detections\s*=/.test(sessionSrc),
  'useLauncherSession.ts must compute detections (empty → [] when no content)',
)

// ─── useLauncherSession: foregroundApp option + rank context ──────────────────

assert.ok(
  /foregroundApp\s*\?:\s*string/.test(sessionSrc),
  'UseLauncherSessionOptions must declare foregroundApp?: string',
)

assert.ok(
  /rankLauncherItems\s*\(\s*\{[\s\S]*?\bforegroundApp\b[\s\S]*?\}/.test(sessionSrc) ||
    /foregroundApp:\s*options\.foregroundApp|foregroundApp(?::\s*foregroundApp)?\s*[,}][\s\S]{0,80}/.test(sessionSrc),
  'useLauncherSession.ts must pass foregroundApp into rankLauncherItems context',
)

// Destructuring or options.foregroundApp in the hook body
assert.ok(
  /foregroundApp/.test(sessionSrc.match(/export function useLauncherSession\s*\(\{[\s\S]*?\}\)/)?.[0] ?? sessionSrc) ||
    /options\.foregroundApp/.test(sessionSrc),
  'useLauncherSession must accept foregroundApp from options',
)

// ─── GlobalLauncherHost: fetch + pass foregroundApp ───────────────────────────

assert.ok(
  /\bforegroundApp\b/.test(hostSrc),
  'GlobalLauncherHost.tsx must mention foregroundApp',
)

assert.ok(
  /useLauncherSession\(\{[\s\S]*\bforegroundApp\b[\s\S]*\}/.test(hostSrc),
  'GlobalLauncherHost must pass foregroundApp into useLauncherSession({ ... })',
)

// Must actually obtain foreground (invoke / app context / app name) — not a hard-coded constant only
assert.ok(
  /current_foreground_app_context|current_foreground_app_name|readForegroundAppContext|foregroundAppContext/.test(hostSrc),
  'GlobalLauncherHost must fetch foreground app via tauri command or shared reader on open',
)

// State + open-gated effect pattern (string state, not just a constant)
assert.ok(
  /useState\s*(?:<\s*string\s*(?:\||\s)*undefined\s*>)?\s*\(/.test(hostSrc) &&
    /setForegroundApp|foregroundApp/.test(hostSrc),
  'GlobalLauncherHost should hold foregroundApp in React state (string | undefined)',
)

assert.ok(
  /useEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?(!open|open)[\s\S]*?(current_foreground_app|setForegroundApp)/.test(hostSrc) ||
    /if\s*\(\s*!open\s*\)[\s\S]{0,200}(current_foreground_app|setForegroundApp)/.test(hostSrc),
  'GlobalLauncherHost must load foreground when open (failure → undefined, non-blocking)',
)

console.log('launcher session intent-context contract checks passed')
