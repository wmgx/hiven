/**
 * Self-learning · registry → pure-transform runner adapter (P1c, generic).
 *
 * Bridges the plugin registry to the observer's pairing engine: enumerates
 * tools, keeps only side-effect-free transforms (purity inferred from declared
 * permissions — no plugin change needed), and wraps each tool's `run` in a
 * capturing, no-op dry-run so `verifyTransformPair` can test "B = T(A)?".
 *
 * Stays product-agnostic: it never inspects tool ids or content types; it just
 * runs candidate transforms generically and compares outputs.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.6 / §12.3.
 */

import { pluginRegistry } from '../pluginRegistry'
import { TelemetryEvents, trackPerf } from '../telemetry'
import type { Locale } from '../../i18n'
import type { PluginPermission } from '../pluginTypes'
import type {
  LauncherExecuteResult,
  PluginToolContext,
  PluginToolContribution,
  PluginToolOutput,
} from './../launcher/types'
import { setPureTransformRunners } from './observer'
import type { PureTransformRunner } from './pairing'

/**
 * Any of these declared → the plugin can mutate the world / hit the network →
 * not a pure transform. Note: `clipboard.write` / `.image` / `.files` are
 * intentionally NOT here — they deliver a tool's OUTPUT (which is exactly the
 * transform result we capture), not a world mutation, and the dry-run stubs
 * (STUB_API etc. in runToolPure) neutralize them regardless. Excluding them
 * wrongly dropped legitimately-pure tools like json.prettify.
 */
const SIDE_EFFECT_PERMISSIONS: readonly PluginPermission[] = [
  'network.request',
  'shell.run',
  'accessibility.paste',
  'app.launch',
  'globalShortcut.register',
  'desktop.windows',
  'desktop.processes',
  'context.foreground-app',
]

function hasSideEffectPermission(permissions: readonly PluginPermission[]): boolean {
  return permissions.some((permission) => SIDE_EFFECT_PERMISSIONS.includes(permission))
}

const OK_RESULT = { ok: true } as unknown as LauncherExecuteResult
// Pure transforms read ctx.input and write ctx.output only. Any api/storage/shell
// access on these stubs is harmless (returns nothing / throws → caught below).
const STUB_API = new Proxy({}, { get: () => () => '' })
const STUB_STORAGE = new Proxy({}, { get: () => () => undefined })
const STUB_SHELL = { run: () => Promise.reject(new Error('shell unavailable in dry-run')) }

function toolDefaultParams(tool: PluginToolContribution): Record<string, unknown> {
  const defaults: Record<string, unknown> = { ...(tool.defaultParams ?? {}) }
  for (const param of tool.params ?? []) {
    if (defaults[param.key] === undefined && param.default !== undefined) {
      defaults[param.key] = param.default
    }
  }
  return defaults
}

/** Run a tool's transform on `text` with no side effects; return its text output or null. */
function runToolPure(tool: PluginToolContribution, text: string): string | null {
  let captured: string | null = null
  const output: PluginToolOutput = {
    text: (value: string) => { captured = value; return OK_RESULT },
    replaceActiveText: (value: string) => { captured = value; return OK_RESULT },
    error: () => { captured = null; return OK_RESULT },
    choices: () => OK_RESULT,
  }
  const ctx = {
    input: { kind: 'text' as const, text, mode: tool.inputPolicy?.mode ?? 'auto', source: text ? 'manual' : 'empty' },
    params: toolDefaultParams(tool),
    settings: {},
    locale: 'en',
    api: STUB_API,
    storage: STUB_STORAGE,
    shell: STUB_SHELL,
    t: (key: string) => key,
    output,
  } as unknown as PluginToolContext
  try {
    const result = tool.run(ctx)
    // Pure transforms are synchronous; skip anything async (likely not pure).
    if (result && typeof (result as { then?: unknown }).then === 'function') return null
  } catch {
    return null
  }
  return captured
}

/**
 * Resolve a runner toolId (`${pluginId}:${tool.id}`) to its localized display
 * title from the registry — used to render learned-rule proposals in the user's
 * locale (never a persisted string). Falls back to the tool's tail id.
 */
export function resolveLauncherToolTitle(toolId: string, locale: Locale): string {
  for (const { definition, pluginId } of pluginRegistry.getAllPluginDefinitions()) {
    for (const tool of definition.tools ?? []) {
      if (`${pluginId}:${tool.id}` === toolId) {
        return tool.titleI18n?.[locale] ?? tool.title ?? tool.id
      }
    }
  }
  // Unknown / unloaded tool: show the last id segment rather than a raw path.
  const tail = toolId.split(':').pop() ?? toolId
  return tail.split('.').pop() ?? tail
}

/** Build pure-transform runners from all currently registered plugins. */
export function buildPureTransformRunners(): PureTransformRunner[] {
  const runners: PureTransformRunner[] = []
  for (const { definition, pluginId, permissions } of pluginRegistry.getAllPluginDefinitions()) {
    if (hasSideEffectPermission(permissions)) continue
    for (const tool of definition.tools ?? []) {
      const surfacedInLauncher = tool.surfaces?.launcher !== false
      const contentDriven = Boolean(tool.textMatch || tool.accepts)
      if (!surfacedInLauncher || !contentDriven) continue
      runners.push({
        id: `${pluginId}:${tool.id}`,
        textMatch: tool.textMatch,
        run: (text: string) => runToolPure(tool, text),
      })
    }
  }
  return runners
}

/** Current runners keyed by id — lets the chain-fire path replay a learned chain. */
const runnersById = new Map<string, PureTransformRunner>()

/**
 * Run a learned tool chain over `text` (scenario B fire): each step's output
 * feeds the next. Returns the final text, or null if a tool is missing or any
 * step declines (not applicable to the input).
 */
export function runLearnedChain(toolIds: readonly string[], text: string): string | null {
  if (toolIds.length === 0) return null
  let current = text
  for (const id of toolIds) {
    const runner = runnersById.get(id)
    if (!runner) return null
    if (runner.textMatch && !runner.textMatch(current)) return null
    const next = runner.run(current)
    if (next == null) return null
    current = next
  }
  return current === text ? null : current
}

/**
 * Keep the observer's pure-transform runners in sync with the registry.
 * Idempotent-friendly; returns an unsubscribe.
 */
export function startPureTransformRunnerSync(): () => void {
  const rebuild = () => {
    const runners = buildPureTransformRunners()
    setPureTransformRunners(runners)
    runnersById.clear()
    for (const runner of runners) runnersById.set(runner.id, runner)
    trackPerf(TelemetryEvents.learningRunnersBuilt, {
      runnerCount: runners.length,
      pluginCount: pluginRegistry.getAllPluginDefinitions().length,
    })
  }
  rebuild()
  return pluginRegistry.subscribe(rebuild)
}
