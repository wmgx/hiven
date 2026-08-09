#!/usr/bin/env node
/**
 * Agent-facing launcher perf report.
 *
 * Reads the always-on NDJSON log and groups samples into open sessions.
 *
 * Usage:
 *   npm run perf:launcher
 *   npm run perf:launcher -- --last 5
 *   npm run perf:launcher -- --json
 *   npm run perf:launcher -- --file /path/to/launcher-perf.ndjson
 *   npm run perf:launcher -- --tail 2000   # only parse last N lines
 *
 * Default log: ~/.local/hiven/logs/launcher-perf.ndjson
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { analyzeLauncherPerfLog, parseLauncherPerfNdjson } from './lib/launcher-perf-analyze.mjs'

const DEFAULT_LOG = join(homedir(), '.local', 'hiven', 'logs', 'launcher-perf.ndjson')

function parseArgs(argv) {
  const opts = {
    last: 8,
    json: false,
    file: DEFAULT_LOG,
    tail: 0,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a === '--last' && argv[i + 1]) opts.last = Math.max(1, Number(argv[++i]) || 8)
    else if (a === '--file' && argv[i + 1]) opts.file = argv[++i]
    else if (a === '--tail' && argv[i + 1]) opts.tail = Math.max(0, Number(argv[++i]) || 0)
  }
  return opts
}

function readLogText(path, tailLines) {
  if (!existsSync(path)) {
    return { ok: false, error: `log not found: ${path}` }
  }
  let text = readFileSync(path, 'utf8')
  if (tailLines > 0) {
    const lines = text.split('\n')
    text = lines.slice(-tailLines).join('\n')
  }
  const size = statSync(path).size
  return { ok: true, text, size, path }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(`launcher-perf-report

Usage:
  node scripts/launcher-perf-report.mjs [options]

Options:
  --last N     Last N open sessions (default 8)
  --json       Machine-readable JSON on stdout
  --file PATH  Log path (default ${DEFAULT_LOG})
  --tail N     Only parse last N lines (faster on huge logs)
  -h, --help   This help

Agent workflow:
  1. User reproduces lag (open/close launcher a few times)
  2. Agent runs: npm run perf:launcher -- --last 5
  3. Read first-paint / event-gap / rank-items× / jank labels
`)
    process.exit(0)
  }

  const loaded = readLogText(opts.file, opts.tail)
  if (!loaded.ok) {
    console.error(loaded.error)
    console.error('Hint: run the desktop app once so the always-on log is created.')
    process.exit(2)
  }

  const rows = parseLauncherPerfNdjson(loaded.text)
  const result = analyzeLauncherPerfLog(rows, { last: opts.last })

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...result.json,
          logPath: loaded.path,
          logBytes: loaded.size,
          parsedRows: rows.length,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`log: ${loaded.path} (${loaded.size} bytes, ${rows.length} rows parsed)`)
  console.log(result.text)
}

main()
