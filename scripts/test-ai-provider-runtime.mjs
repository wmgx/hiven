import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const types = read('src/workspace/ai/types.ts')
const runtime = read('src/workspace/ai/runtime.ts')
const codex = read('src/workspace/ai/codexProvider.ts')
const xai = read('src/workspace/ai/xaiProvider.ts')
const native = read('src-tauri/src/ai_codex.rs')
const xaiNative = read('src-tauri/src/ai_xai.rs')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const launcherTypes = read('src/workspace/launcher/types.ts')
const systemSettings = read('src/components/SystemSettingsSurface.tsx')
const settingsContent = read('src/surfaces/SettingsContent.tsx')
const css = read('src/index.css')

assert.match(types, /providerId\?: string/, 'provider must be optional so Host defaults can apply')
assert.match(types, /interface AiProviderAdapter/, 'Host must expose a real Provider adapter contract')
assert.match(runtime, /registerAiProvider/, 'Provider registry must accept future adapters')
assert.match(runtime, /aiDefaultProviderId[\s\S]*find\(\(item\) => item\.status === 'ready'\)/, 'default provider must fall back to a ready provider')
assert.match(runtime, /pluginId,[\s\S]*pluginSource,[\s\S]*providerId:/, 'usage must be attributed to plugin and provider')
assert.match(codex, /account\/rateLimits\/read/, 'Codex provider must expose subscription quota')
assert.match(codex, /thread\/tokenUsage\/updated/, 'Codex provider must normalize per-thread token usage')
assert.match(runtime, /xaiGrokProvider/, 'the xAI subscription provider must be registered')
assert.match(xai, /ai_xai_login_start/, 'xAI must use the native OAuth bridge')
assert.match(xaiNative, /oauth2\/device\/code/, 'xAI login must use the official device-code flow')
assert.match(xaiNative, /offline_access grok-cli:access api:access/, 'xAI login must request subscription API access')
assert.match(xaiNative, /cli-chat-proxy\.grok\.com\/v1/, 'xAI subscription traffic must use the subscription proxy')
assert.match(xaiNative, /billing\?format=credits/, 'xAI provider must read the subscription usage window')
assert.match(xaiNative, /Channel<Value>/, 'xAI responses must stream over a native channel')
assert.match(xaiNative, /ai_xai_cancel/, 'xAI streaming must support cancellation')
assert.match(xai, /image\.understand/, 'xAI model capabilities must include discovered image input')
assert.match(xai, /web\.search/, 'xAI responses must expose server-side web search')
assert.match(xai, /quotaFromBilling/, 'xAI billing must map into provider quota windows')
assert.match(types, /contextWindow\?: number/, 'agents must expose model context windows')
assert.match(settingsContent, /formatTokenCount\(item\.contextWindow\)/, 'model selection must show context window information')
assert.match(settingsContent, /providers\.map\(\(provider\)/, 'subscription management must render providers as they resolve')
assert.match(settingsContent, /initialLoading && <AiProviderSkeleton/, 'subscription management must reserve unfinished provider rows during initial loading')
assert.match(runtime, /onProvider\?\.\(description, completed, adapters\.length, index\)/, 'provider discovery must publish incremental results')
assert.match(runtime, /PROVIDER_TIMEOUT_MS[\s\S]*withTimeout/, 'each provider must have an independent timeout')
assert.match(runtime, /providerCache[\s\S]*PROVIDER_CACHE_MS/, 'provider descriptors must be reused briefly across page switches')
assert.match(runtime, /refreshAiProvider[\s\S]*invalidateProvider\(providerId\)/, 'a single provider can be retried without refreshing every subscription')
assert.match(codex, /onUpdate\?\.\(description\)[\s\S]*readQuota/, 'Codex account and models must render before quota finishes')
assert.match(css, /prefers-reduced-motion[\s\S]*ai-provider-skeleton/, 'provider skeleton animation must respect reduced motion')

const xaiCompiled = ts.transpileModule(xai, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const xaiExports = {}
vm.runInNewContext(xaiCompiled, {
  exports: xaiExports,
  module: { exports: xaiExports },
  require: () => ({ Channel: class {}, invoke: async () => {} }),
  Date,
  Number,
  String,
  Set,
})
const agent = xaiExports.mapAgent({ id: 'grok-4.6', input_modalities: ['text', 'image'], context_window: 500_000 })
assert.equal(agent.contextWindow, 500_000)
assert.ok(agent.capabilities.includes('image.understand'))
assert.ok(agent.capabilities.includes('web.search'))
assert.equal(
  JSON.stringify(xaiExports.mapStreamEvent({ type: 'response.output_text.delta', delta: 'hi' }, 'run-1')),
  JSON.stringify([{ type: 'text.delta', runId: 'run-1', delta: 'hi' }]),
)
const quota = xaiExports.quotaFromBilling({
  config: {
    creditUsagePercent: 37,
    currentPeriod: { start: '2026-08-20T00:00:00Z', end: '2026-08-27T00:00:00Z' },
  },
})
assert.equal(quota.buckets[0].primary.usedPercent, 37)
assert.equal(quota.buckets[0].primary.windowDurationMinutes, 7 * 24 * 60)
assert.match(xaiNative, /mode\(0o600\)/, 'xAI OAuth tokens must use private file permissions on Unix')
assert.match(codex, /capabilities:\s*\{\s*experimentalApi: true/, 'named permission profiles require the experimental API capability')
assert.match(codex, /permissions: ':read-only'/, 'general AI turns must use the host read-only permission profile')
assert.doesNotMatch(codex, /sandboxPolicy:/, 'general AI turns must not send the deprecated readOnly.access policy')
assert.match(native, /fn allowed_method/, 'native Codex bridge must use an RPC allowlist')
assert.match(native, /\.current_dir\(&workspace\)/, 'Codex must not inherit the Hiven process working directory')
assert.match(native, /HIVEN_CODEX_INITIALIZATION_REQUIRED/, 'a restarted Codex process must force bridge reinitialization')
assert.match(codex, /bridgePromise = undefined[\s\S]*await ensureBridge\(\)/, 'the provider must reinitialize after a Codex process restart')
assert.doesNotMatch(native.match(/fn allowed_method[\s\S]*?\n\}/)?.[0] ?? '', /command\/exec/, 'plugins must not reach Codex shell execution through the AI bridge')
assert.match(pluginTypes, /PluginSurfaceHostApi[\s\S]*ai: PluginAiApi/, 'plugin surfaces must receive scoped AI')
assert.match(launcherTypes, /LauncherExecutionContext[\s\S]*ai: PluginAiApi/, 'launcher executions must receive scoped AI')
assert.match(systemSettings, /id: 'ai'[\s\S]*AiSubscriptionsContent/, 'AI subscriptions must have a dedicated settings page')
assert.match(settingsContent, /readyProviders = providers\.filter\(\(item\) => item\.status === 'ready'\)/, 'only connected providers may appear in the default provider selector')
assert.match(settingsContent, /aiSubscriptionManagement[\s\S]*aiDefaults/, 'login management and AI defaults must be separate sections')
assert.match(settingsContent, /usedPercent/, 'connected subscriptions must show reported usage')
assert.match(settingsContent, /resetsAt/, 'connected subscriptions must show reported reset time')
assert.match(settingsContent, /role="progressbar"[\s\S]*data-level/, 'quota usage must render as an accessible color-coded progress bar')
assert.match(settingsContent, /quotaBucketPriority[\s\S]*names\.includes\('codex'\)/, 'the common Codex quota bucket must sort first')
assert.match(settingsContent, /aiDefaultAgent[\s\S]*searchable[\s\S]*aiSearchAgents/, 'the agent selector must support model search')
assert.match(settingsContent, /if \(props\.searchable\) \{\s*return \(\s*<Combobox/, 'searchable selects must reuse Combobox with Select chrome')
assert.match(css, /\.hiven-ui-combobox-search/, 'Combobox search lives inside the popup, not on the closed trigger')
assert.match(settingsContent, /id\.trim\(\)\.toLowerCase\(\) === 'gpt-reserve'[\s\S]*aiQuotaOther/, 'internal reserve bucket IDs must use a conservative user-facing label')
assert.match(settingsContent, /title=\{entry\.technicalId\}/, 'unknown quota labels must retain the raw bucket ID for diagnostics')

console.log('AI provider runtime contract OK')
