# Quick Text Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GlobalLauncher quick text processing mode where plugins transform typed text into preview output, and Enter copies the preview to the clipboard.

**Architecture:** Pure text transforms should return host-neutral text output. The host decides whether that output is previewed, copied, used to replace editor text, or stored in a pinned output buffer. GlobalLauncher owns the temporary quick-processing session; plugins only own the transform algorithm and params.

**Tech Stack:** React, Zustand, Tauri clipboard manager, existing hiven plugin registry, `CommandContribution`, `runTextPluginCommand`, focused Node verifier scripts.

---

## Scope

Build only the fast path:

- Select a supported text command in GlobalLauncher.
- Enter a temporary input mode inside the launcher.
- Debounced preview renders under the input.
- Press Enter to copy preview output to the clipboard and close the launcher.
- Press Escape from input mode to return to the launcher command list; Escape from the command list closes the launcher.

Do not build in v1:

- No active editor selection, active pane, or clipboard auto-fill.
- No send-to-Pinned-Runner action.
- No apply-to-editor action.
- No workspace pane creation.
- No Monaco editor inside the launcher.

## Contract

The main contract change is: plugins may return text output without deciding the destination.

Add an optional output field while preserving old `effects` compatibility:

```ts
export type PluginCommandTextOutput = {
  kind: 'text'
  text: string
}

export type PluginCommandErrorOutput = {
  kind: 'error'
  text: string
}

export type PluginCommandOutput = PluginCommandTextOutput | PluginCommandErrorOutput

export type PluginCommandResult = {
  output?: PluginCommandOutput
  effects?: FluxEffect[]
}
```

Add first-party helpers exported through `@hiven/plugin`:

```ts
export function textOutput(text: string): PluginCommandResult {
  return { output: { kind: 'text', text } }
}

export function textError(text: string): PluginCommandResult {
  return { output: { kind: 'error', text } }
}
```

Keep `effects` for commands that actually modify workspace surfaces, such as `pane.create`, `pane.setRenderer`, `panel.openV2`, and `status.message`.

## Capability Recognition

Quick text support should be automatic by default, with explicit declarations only for exceptions.

The host should treat a command as a standard text transform when it has this shape:

```text
input text + params -> output text
```

Automatic recognition rules:

- the command has zero or one required `text` input slot;
- the command has no `pane` or `clipboard` input slots;
- every param has an effective default value, or the command has no params;
- the command returns `output.kind === 'text'` or `output.kind === 'error'`;
- the command does not return workspace effects such as `pane.create`, `pane.setRenderer`, `panel.openV2`, or `text.replace`;
- the command is deterministic for the same input and params, or at least safe to preview repeatedly.

Effective quick-mode params are computed as:

```text
command param defaults + quickText.defaultParams override
```

Every declared command param must have a value after this merge. Quick text mode must not stop and ask for params, because its interaction is "select command -> type input -> preview -> Enter copy". If one param is missing a default, the command is not eligible for quick text until the plugin adds either `param.default` or `quickText.defaultParams[param.key]`.

Legacy compatibility rule:

- commands that still return a single `text.replace` effect may be normalized into text output during migration;
- legacy `text.replace` compatibility should not be the long-term signal for quick text support;
- after first-party migration, third-party commands should opt into automatic quick text by returning `output` or by using `defineTextCommand`.

Explicit declaration rules:

- no declaration is needed for normal `defineTextCommand` transforms;
- use an opt-out only for exceptions, for example a command that is text-to-text but too slow, network-backed, nondeterministic, or unsafe for live preview;
- use full `definePlugin` and effects for commands that intentionally own workspace UI or side effects.

The planned override shape is:

```ts
type TextCommandSurfaces = {
  quickText?: false | {
    enabled?: boolean
    trigger?: 'on-input' | 'manual'
    debounceMs?: number
    defaultParams?: Record<string, unknown>
  }
}
```

`quickText.defaultParams` is only an entry-point default override. It does not change the command's normal default behavior in Command Palette or Pinned Runner. It is useful when a command has several valid modes but the quick surface needs one conservative default, for example `case.run` defaulting to lowercase in quick mode while keeping another default elsewhere.

Self-declaration cannot bypass the all-defaults rule. If `quickText.enabled === true` but any param still lacks an effective default, the host should exclude the command from quick mode and surface this as a plugin authoring warning in development diagnostics.

The host should not require every plugin to list every supported entry point. Entry points are host policy. Plugins expose transform capability; the host maps that capability to replace, preview, copy, pinned output, or future batch application.

## Plugin Authoring Model

Add a higher-level SDK helper so plugin authors do not need to understand `inputs`, `inputResolution`, `live`, `run`, `textOutput`, or destination behavior for simple tools.

Target helper:

```ts
defineTextCommand({
  id: 'base64.run',
  title: 'command.run.title',
  description: 'command.run.description',
  icon: 'Binary',
  aliases: ['encode', 'decode'],
  params: [
    {
      key: 'mode',
      label: 'param.mode.label',
      type: 'single-select',
      options: [
        { label: 'param.mode.option.encode.label', value: 'encode' },
        { label: 'param.mode.option.decode.label', value: 'decode' },
      ],
      default: 'encode',
    },
  ],
  transform(input, params) {
    return params.mode === 'encode'
      ? btoa(unescape(encodeURIComponent(input)))
      : decodeURIComponent(escape(atob(input.trim())))
  },
})
```

`defineTextCommand` should expand to a normal `CommandContribution`:

```ts
{
  inputs: [{ key: 'input', label: 'input.text.label', kind: 'text', required: true }],
  inputResolution: { strategy: 'use-active', fallback: 'fail' },
  live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
  run(ctx) {
    const input = ctx.inputs.input as TextInput
    try {
      return textOutput(transform(input?.kind === 'text' ? input.text : '', ctx.params))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return textError(`Error: ${message}`)
    }
  },
}
```

This keeps simple plugins small: they only provide metadata, params, and `transform(input, params)`. More complex plugins keep using the lower-level `definePlugin` API.

## Supported Plugins

V1 should support commands that meet all of these rules:

- exactly zero or one required `text` input slot;
- no `pane` or `clipboard` input slots;
- all params have effective quick-mode defaults, or the command has no params;
- command returns `output`, or a legacy single `text.replace` effect that can be normalized into output;
- command has no workspace surface effects.

Initial supported command set:

- `base64.run`
- `url.run`
- `hash.run`
- `count.run`
- `json.run`
- `timestamp.run`
- `calculator.run`
- `calculator.sum`
- `calculator.base`
- `case.run`
- `line-tools.sort`
- `line-tools.dedup`
- `line-tools.reverse`
- `line-tools.remove-blank-lines`
- `line-tools.trim-whitespace`
- `line-tools.join`
- `line-affix.prepend`
- `line-affix.append`
- `line-affix.wrap`
- `sql.run`
- `sqlin.run`
- `query-string.run`
- `html.run`
- `css.run`
- `xml.run`
- `yaml.run`
- `csv.run`
- `sort-json.run`
- `jwt.run`
- `slashes.run`
- `mdquote.run`
- `extract.run`

Explicitly unsupported in v1:

- `text-diff.compare`: multi-input renderer workflow.
- `js-filter.toggle`: panel workflow.
- `core-pane.*`: workspace pane actions.
- instant suggestions: they already have copy/insert/effects semantics and are not command sessions.

## File Map

- Modify `src/workspace/pluginTypes.ts`: add `PluginCommandOutput` and make `effects` optional.
- Modify `src/pluginHostCore.ts`: define typed `textOutput`, `textError`, and `defineTextCommand` helpers through the core SDK surface.
- Modify `src/pluginHostSdk.ts`: expose the new core helpers in the browser/runtime SDK type and factory.
- Modify `src/plugin-sdk.ts`: re-export `textOutput`, `textError`, `defineTextCommand`, and the new output/surface types for `@hiven/plugin` imports.
- Modify `src/workspace/pluginCommandRunner.ts`: normalize `result.output` first, then fall back to legacy `text.replace` / `pane.create` / `status.message`.
- Create `src/workspace/quickTextCommand.ts`: command eligibility, default params, and quick-run adapter.
- Modify `src/components/GlobalLauncher.tsx`: add quick command items and input/preview session state.
- Modify `src/i18n/locales/palette.ts`: add quick processor labels.
- Modify selected `src/plugins/*/index.ts`: migrate first-party pure text commands from `text.replace` helpers to `textOutput` / `textError`.
- Create `scripts/test-plugin-text-output-contract.mjs`: verifies the new result contract and legacy compatibility.
- Create `scripts/test-global-launcher-quick-text.mjs`: verifies GlobalLauncher quick session behavior by static contract checks.
- Update `package.json`: add both new test scripts.

## Task 1: Add Host-Neutral Text Output Contract

**Files:**

- Modify: `src/workspace/pluginTypes.ts`
- Modify: `src/pluginHostCore.ts`
- Modify: `src/pluginHostSdk.ts`
- Modify: `src/plugin-sdk.ts`
- Modify: `src/workspace/pluginCommandRunner.ts`
- Create: `scripts/test-plugin-text-output-contract.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract verifier**

Create `scripts/test-plugin-text-output-contract.mjs`:

```js
#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginHostCore = read('src/pluginHostCore.ts')
const pluginHostSdk = read('src/pluginHostSdk.ts')
const pluginSdk = read('src/plugin-sdk.ts')
const pluginCommandRunner = read('src/workspace/pluginCommandRunner.ts')
const packageJson = read('package.json')

assert.match(packageJson, /test:plugin-text-output-contract/, 'package.json should expose the text output contract verifier')
assert.match(pluginTypes, /type\s+PluginCommandOutput\b|export\s+type\s+PluginCommandOutput\b/, 'pluginTypes should define PluginCommandOutput')
assert.match(pluginTypes, /output\??:\s*PluginCommandOutput/, 'PluginCommandResult should support host-neutral output')
assert.match(pluginTypes, /effects\??:\s*FluxEffect\[\]/, 'PluginCommandResult should keep optional effects compatibility')
assert.match(pluginTypes, /type\s+TextCommandSurfaces\b|export\s+type\s+TextCommandSurfaces\b/, 'pluginTypes should define text command surface overrides')
assert.match(pluginTypes, /surfaces\??:\s*TextCommandSurfaces/, 'CommandContribution should support optional text command surface overrides')
assert.match(pluginHostCore, /textOutput\s*[:=]/, 'plugin host SDK should expose textOutput')
assert.match(pluginHostCore, /textError\s*[:=]/, 'plugin host SDK should expose textError')
assert.match(pluginHostCore, /defineTextCommand\s*[:=]|function\s+defineTextCommand/, 'plugin host SDK should expose defineTextCommand for simple text transforms')
assert.match(pluginHostCore, /PluginHostCoreSdk[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, 'PluginHostCoreSdk type should include the new helpers')
assert.match(pluginHostSdk, /PluginHostSdk[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, 'runtime PluginHostSdk type should include the new helpers')
assert.match(pluginSdk, /export\s+\{[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, '@hiven/plugin barrel should re-export the new helpers')
assert.match(pluginSdk, /PluginCommandOutput|TextCommandSurfaces/, '@hiven/plugin barrel should re-export new contract types')
assert.match(pluginCommandRunner, /result\.output/, 'runner should prefer explicit output over legacy effects')
assert.match(pluginCommandRunner, /textOutputFromPluginResult/, 'runner should normalize complete plugin results')
assert.match(pluginCommandRunner, /text\.replace/, 'runner should keep legacy text.replace output compatibility during migration')

console.log('plugin text output contract checks passed')
```

- [ ] **Step 2: Run the verifier and confirm it fails**

Run:

```bash
npm run test:plugin-text-output-contract
```

Expected: fail because the script is not yet in `package.json`, or because `PluginCommandOutput` is missing.

- [ ] **Step 3: Add result types**

In `src/workspace/pluginTypes.ts`, add host-neutral output and quick surface override types:

```ts
export type PluginCommandTextOutput = {
  kind: 'text'
  text: string
}

export type PluginCommandErrorOutput = {
  kind: 'error'
  text: string
}

export type PluginCommandOutput = PluginCommandTextOutput | PluginCommandErrorOutput

/** Result returned by command.run */
export type PluginCommandResult = {
  output?: PluginCommandOutput
  effects?: FluxEffect[]
}

export type TextCommandSurfaces = {
  quickText?: false | {
    enabled?: boolean
    trigger?: 'on-input' | 'manual'
    debounceMs?: number
    defaultParams?: Record<string, unknown>
  }
}
```

Then add the optional override field to `CommandContribution`:

```ts
surfaces?: TextCommandSurfaces
```

- [ ] **Step 4: Export typed core SDK helpers**

In `src/pluginHostCore.ts`, add helper types and functions:

```ts
export type TextCommandDefinition = Omit<CommandContribution, 'run' | 'inputs' | 'inputResolution' | 'live'> & {
  inputs?: CommandContribution['inputs']
  inputResolution?: CommandContribution['inputResolution']
  live?: CommandContribution['live']
  transform: (input: string, params: Record<string, unknown>) => string | Promise<string>
}

export function textOutput(text: string): PluginCommandResult {
  return { output: { kind: 'text', text } }
}

export function textError(text: string): PluginCommandResult {
  return { output: { kind: 'error', text } }
}

export function defineTextCommand(command: TextCommandDefinition): CommandContribution {
  return {
  ...command,
  inputs: command.inputs ?? [{ key: 'input', label: 'Input', kind: 'text' as const, required: true }],
  inputResolution: command.inputResolution ?? { strategy: 'use-active' as const, fallback: 'fail' as const },
  live: command.live ?? { live: { enabled: true, trigger: 'on-input' as const, sideEffects: 'none' as const, debounceMs: 250 } },
  async run(ctx) {
    const input = ctx.inputs.input
    const text = input?.kind === 'text' ? input.text : ''
    try {
      return textOutput(await command.transform(text, ctx.params))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return textError(`Error: ${message}`)
    }
  },
  }
}
```

Then add these fields to `PluginHostCoreSdk` and `createPluginHostCoreSdk()`:

```ts
textOutput: typeof textOutput
textError: typeof textError
defineTextCommand: typeof defineTextCommand
```

Keep the existing `definePlugin` and `effects.replaceActiveText` helpers for compatibility.

- [ ] **Step 5: Re-export helpers through runtime and barrel SDKs**

In `src/pluginHostSdk.ts`, update `PluginHostSdk` and `createPluginHostSdk()` so browser/runtime plugins can access:

```ts
textOutput: core.textOutput,
textError: core.textError,
defineTextCommand: core.defineTextCommand,
```

In `src/plugin-sdk.ts`, re-export the helpers for bundled and external `@hiven/plugin` imports:

```ts
export {
  defineTextCommand,
  textError,
  textOutput,
} from './pluginHostCore'
```

Also re-export the new public types:

```ts
export type {
  PluginCommandErrorOutput,
  PluginCommandOutput,
  PluginCommandTextOutput,
  TextCommandSurfaces,
} from './workspace/pluginTypes'
export type { TextCommandDefinition } from './pluginHostCore'
```

- [ ] **Step 6: Normalize output in the runner**

In `src/workspace/pluginCommandRunner.ts`, rename `textOutputFromPluginEffects` to `textOutputFromPluginResult` and implement:

```ts
export function textOutputFromPluginResult(result: PluginCommandResult): TextPluginCommandOutput {
  if (result.output) {
    return { text: result.output.text, kind: result.output.kind }
  }

  const effects = result.effects ?? []
  const textReplace = effects.find((effect): effect is Extract<FluxEffect, { type: 'text.replace' }> => effect.type === 'text.replace')
  if (textReplace) return { text: textReplace.text, kind: 'text' }

  const createPane = effects.find((effect): effect is Extract<FluxEffect, { type: 'pane.create' }> => effect.type === 'pane.create')
  if (createPane) return { text: String(createPane.pane.text ?? ''), kind: 'text' }

  const status = effects.find((effect): effect is Extract<FluxEffect, { type: 'status.message' }> => effect.type === 'status.message')
  if (status) return { text: status.message, kind: status.level === 'error' ? 'error' : 'text' }

  return { text: '', kind: 'text' }
}
```

Update `runTextPluginCommand` to call `textOutputFromPluginResult`.

- [ ] **Step 7: Add package script**

In `package.json` scripts, add:

```json
"test:plugin-text-output-contract": "node scripts/test-plugin-text-output-contract.mjs"
```

- [ ] **Step 8: Verify**

Run:

```bash
npm run test:plugin-text-output-contract
npm run test:pinned-plugin-command
```

Expected: both pass. `test:pinned-plugin-command` proves legacy `text.replace` normalization still works for pinned runner.

## Task 2: Add Quick Text Command Eligibility and Runner

**Files:**

- Create: `src/workspace/quickTextCommand.ts`
- Create: `scripts/test-global-launcher-quick-text.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing quick command verifier**

Create `scripts/test-global-launcher-quick-text.mjs`:

```js
#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const quickTextCommand = read('src/workspace/quickTextCommand.ts')
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const packageJson = read('package.json')

assert.match(packageJson, /test:global-launcher-quick-text/, 'package.json should expose the quick text verifier')
assert.match(quickTextCommand, /isQuickTextCommand/, 'quickTextCommand should expose an eligibility predicate')
assert.match(quickTextCommand, /runQuickTextCommand/, 'quickTextCommand should expose a runner')
assert.match(quickTextCommand, /slot\.kind\s*!==\s*['"]text['"]/, 'eligibility should reject non-text input slots')
assert.match(quickTextCommand, /command\.surfaces\?\.quickText\s*===\s*false/, 'eligibility should honor explicit quickText opt-out')
assert.match(quickTextCommand, /effectiveQuickTextParams/, 'eligibility should be based on merged command defaults and quick defaults')
assert.match(quickTextCommand, /param\.default\s*===\s*undefined[\s\S]{0,220}quickTextDefaults/, 'eligibility should reject params without effective quick defaults')
assert.match(quickTextCommand, /runTextPluginCommand/, 'quick runner should reuse runTextPluginCommand')
assert.match(globalLauncher, /quickTextSession/, 'GlobalLauncher should model a quick text session')
assert.match(globalLauncher, /copyQuickTextOutput/, 'GlobalLauncher should centralize quick output clipboard writes')
assert.match(globalLauncher, /writeText\(session\.outputText/, 'quick output copy helper should write preview text to clipboard')
assert.match(globalLauncher, /setQuickTextSession\(null\)/, 'Escape should leave quick text mode before closing the launcher')
assert.match(globalLauncher, /quickTextSession\?\.outputText\.length|quickTextSession\?\.running|quickTextSession\?\.inputText\.length/, 'standalone launcher resize should react to quick session content')
assert.match(globalLauncher, /global-launcher-quick-preview[\s\S]{0,500}max-h|global-launcher-quick-preview[\s\S]{0,500}overflow-auto/, 'quick preview should have bounded height and scroll')
assert.match(globalLauncher, /shouldIgnoreImeKeyDown/, 'quick input should reuse the IME Enter guard')
assert.doesNotMatch(globalLauncher, /quickTextSession[\s\S]{0,800}applyEffects\(\[\{[\s\S]{0,120}text\.replace/, 'quick text mode must not apply output to the editor')

console.log('global launcher quick text checks passed')
```

- [ ] **Step 2: Run the verifier and confirm it fails**

Run:

```bash
npm run test:global-launcher-quick-text
```

Expected: fail because `quickTextCommand.ts` does not exist.

- [ ] **Step 3: Implement quick command helpers**

Create `src/workspace/quickTextCommand.ts`:

```ts
import type { CommandContribution } from './pluginTypes'
import { defaultPluginCommandParams, runTextPluginCommand, type TextPluginCommandOutput } from './pluginCommandRunner'

export type QuickTextCommandRunOptions = {
  inputText: string
  params?: Record<string, unknown>
  isDev?: boolean
  ownerPluginId?: string
}

type QuickTextOptions = {
  defaultParams?: Record<string, unknown>
}

function quickTextOptions(command: CommandContribution): QuickTextOptions {
  const quickText = command.surfaces?.quickText
  if (!quickText || quickText === false) return {}
  return {
    defaultParams: quickText.defaultParams,
  }
}

export function effectiveQuickTextParams(command: CommandContribution): Record<string, unknown> | null {
  const quickTextDefaults = quickTextOptions(command).defaultParams ?? {}
  const params: Record<string, unknown> = {}
  for (const param of command.params ?? []) {
    const value = quickTextDefaults[param.key] ?? param.default
    if (value === undefined) return null
    params[param.key] = value
  }
  return params
}

export function isQuickTextCommand(command: CommandContribution): boolean {
  if (command.surfaces?.quickText === false) return false
  const slots = command.inputs ?? [{ key: 'input', label: 'Input', kind: 'text' as const, required: true }]
  if (slots.length > 1) return false
  if (slots.some((slot) => slot.kind !== 'text')) return false
  if (effectiveQuickTextParams(command) === null) return false
  const live = command.live?.live
  if (live && live.sideEffects !== 'none' && live.sideEffects !== 'read-only') return false
  if (command.live?.pinnable === false && !live) return false
  return true
}

export function quickTextDefaultParams(command: CommandContribution): Record<string, unknown> {
  return effectiveQuickTextParams(command) ?? defaultPluginCommandParams(command.params)
}

export async function runQuickTextCommand(
  command: CommandContribution,
  options: QuickTextCommandRunOptions,
): Promise<TextPluginCommandOutput> {
  return runTextPluginCommand(command, {
    inputText: options.inputText,
    params: {
      ...quickTextDefaultParams(command),
      ...(options.params ?? {}),
    },
    isDev: options.isDev,
    ownerPluginId: options.ownerPluginId,
  })
}
```

- [ ] **Step 4: Add package script**

In `package.json` scripts, add:

```json
"test:global-launcher-quick-text": "node scripts/test-global-launcher-quick-text.mjs"
```

- [ ] **Step 5: Verify helper only**

Run:

```bash
npm run test:global-launcher-quick-text
```

Expected: still fail because `GlobalLauncher.tsx` is not wired yet.

## Task 3: Add GlobalLauncher Quick Text Session

**Files:**

- Modify: `src/components/GlobalLauncher.tsx`
- Modify: `src/i18n/locales/palette.ts`

- [ ] **Step 1: Add session state**

In `GlobalLauncher.tsx`, add a new launcher item kind:

```ts
type LauncherItem =
  | { kind: 'quick-command'; id: string; title: string; subtitle: string; icon?: string; commandId: string; isDev: boolean }
  | { kind: 'instant'; id: string; title: string; subtitle: string; icon?: string; suggestion: InstantSuggestion }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string }
  | { kind: 'recent'; id: string; title: string; subtitle: string; icon?: string }
  | { kind: 'view'; id: ViewId; title: string; subtitle: string; icon: ReactNode }
```

Add state:

```ts
const [quickTextSession, setQuickTextSession] = useState<{
  commandId: string
  isDev: boolean
  title: string
  icon?: string
  inputText: string
  outputText: string
  outputKind: 'text' | 'error'
  running: boolean
  error?: string
} | null>(null)
```

- [ ] **Step 2: Add quick command items**

In the `items` memo, when `mode === 'full'`, add quick commands from `pluginRegistry.getAllCommands()` filtered by `isQuickTextCommand`.

Use localized command titles and subtitle `t(locale, 'palette.quickText')`.

- [ ] **Step 3: Start quick mode on selection**

In `selectItem`, handle `quick-command` before the `standaloneLauncher` branch. Quick text mode is local to the currently open launcher window; it should not emit to the main window like pinned action selection does.

```ts
if (item.kind === 'quick-command') {
  setQuickTextSession({
    commandId: item.commandId,
    isDev: item.isDev,
    title: item.title,
    icon: item.icon,
    inputText: '',
    outputText: '',
    outputKind: 'text',
    running: false,
  })
  setQuery('')
  setSelectedIndex(0)
  requestAnimationFrame(() => inputRef.current?.focus())
  return
}
```

- [ ] **Step 4: Debounce preview execution**

Add an effect that runs only when `quickTextSession` exists and `inputText` is non-empty:

```ts
useEffect(() => {
  if (!quickTextSession) return
  const entry = pluginRegistry.resolveCommand(quickTextSession.commandId, quickTextSession.isDev ? 'dev' : 'production')
  if (!entry) return
  if (!quickTextSession.inputText) {
    setQuickTextSession((session) => session ? { ...session, outputText: '', outputKind: 'text', running: false, error: undefined } : session)
    return
  }

  let cancelled = false
  setQuickTextSession((session) => session ? { ...session, running: true, error: undefined } : session)
  const timer = window.setTimeout(() => {
    void runQuickTextCommand(entry.contribution, {
      inputText: quickTextSession.inputText,
      isDev: quickTextSession.isDev,
      ownerPluginId: entry.meta.pluginId,
    }).then((output) => {
      if (cancelled) return
      setQuickTextSession((session) => session ? {
        ...session,
        outputText: output.text,
        outputKind: output.kind,
        running: false,
        error: undefined,
      } : session)
    }).catch((error) => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : String(error)
      setQuickTextSession((session) => session ? {
        ...session,
        outputText: message,
        outputKind: 'error',
        running: false,
        error: message,
      } : session)
    })
  }, 200)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}, [quickTextSession?.commandId, quickTextSession?.isDev, quickTextSession?.inputText])
```

Do not include `pluginRegistryVersion` in this preview effect dependency list. The selected command id/source is enough for an active quick session; registry churn elsewhere should not rerun the preview.

For the standalone launcher window, update the existing `useLayoutEffect` that measures the panel height so it also reacts to quick session content:

```ts
}, [
  filtered.length,
  mode,
  open,
  quickTextSession?.inputText.length,
  quickTextSession?.outputText.length,
  quickTextSession?.running,
  standaloneLauncher,
])
```

If the implementation still uses `measureStandaloneLauncherPanelHeight(panel)`, no separate height algorithm is needed. The important requirement is that the layout effect runs when the quick session preview appears, changes size, or clears.

- [ ] **Step 5: Handle quick mode keyboard actions**

Add an async helper in `GlobalLauncher.tsx`:

```ts
async function copyQuickTextOutput(session: NonNullable<typeof quickTextSession>) {
  if (!session.outputText || session.outputKind === 'error') return
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(session.outputText)
    showToast(t(locale, 'palette.copied'), 'success')
    closeLauncher()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(message, 'error')
  }
}
```

In the panel keydown handler, before normal list Enter handling:

```ts
if (quickTextSession && event.key === 'Escape') {
  event.preventDefault()
  event.stopPropagation()
  setQuickTextSession(null)
  setQuery('')
  setSelectedIndex(0)
  requestAnimationFrame(() => inputRef.current?.focus())
  return
}

if (quickTextSession && event.key === 'Enter') {
  event.preventDefault()
  void copyQuickTextOutput(quickTextSession)
  return
}
```

Keep `shouldIgnoreImeKeyDown(event, isImeComposingRef)` before this branch.

- [ ] **Step 6: Render quick mode**

When `quickTextSession` is set, render:

```tsx
<div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5">
  {resolveIcon(quickTextSession.icon, 16, quickTextSession.title)}
  <input
    ref={inputRef}
    value={quickTextSession.inputText}
    onChange={(event) => setQuickTextSession((session) => session ? { ...session, inputText: event.target.value } : session)}
    placeholder={t(locale, 'palette.quickTextPlaceholder', { title: quickTextSession.title })}
    className="flex-1 outline-none border-none bg-transparent text-[14px]"
  />
</div>
<div className="global-launcher-quick-preview">
  <div className="global-launcher-quick-preview-label">{quickTextSession.running ? t(locale, 'palette.running') : t(locale, 'palette.preview')}</div>
  <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words">{quickTextSession.outputText}</pre>
</div>
```

Keep it light: no Monaco, no editor selection, no apply button.

- [ ] **Step 7: Add i18n**

In `src/i18n/locales/palette.ts`, add English and Chinese labels:

```ts
'quickText': 'Quick Text',
'quickTextPlaceholder': 'Text for {title}',
'preview': 'Preview',
'running': 'Running...',
```

```ts
'quickText': '快速处理',
'quickTextPlaceholder': '输入要用 {title} 处理的文本',
'preview': '预览',
'running': '处理中...',
```

Do not add another `copied` key; `palette.copied` already exists and should be reused after clipboard writes. The current `t(locale, dottedKey, vars)` path delegates to `translate(..., vars)`, and `src/i18n/registry.ts` supports `{name}` replacement via `replaceAll`, so `t(locale, 'palette.quickTextPlaceholder', { title })` is valid.

- [ ] **Step 8: Verify quick launcher contract**

Run:

```bash
npm run test:global-launcher-quick-text
npm run test:ime-enter-confirmation
npm run test:global-pinned-launcher
```

Expected: all pass. The IME and launcher tests guard against Enter and standalone launcher regressions.

## Task 4: Migrate First-Party Pure Text Plugins

**Files:**

- Modify pure text plugin files listed in "Supported Plugins"
- Modify: `scripts/test-plugin-merge-groups.mjs`
- Modify: `scripts/test-calculator-command-mode.mjs`
- Modify: `scripts/test-date-time-assistant.mjs`
- Modify: `scripts/test-pinned-plugin-command.mjs`

- [ ] **Step 1: Update plugin tests to accept output**

Where tests currently search for `text.replace`, add a shared extractor:

```js
function textFromResult(result) {
  if (result.output) return result.output.text
  const replace = result.effects?.find((effect) => effect.type === 'text.replace')
  assert.ok(replace, 'command should return text output or legacy text.replace')
  return replace.text
}
```

Use it in `test-plugin-merge-groups.mjs`, `test-calculator-command-mode.mjs`, and `test-date-time-assistant.mjs`.

- [ ] **Step 2: Migrate simple one-command plugins**

For each of these files, import `textOutput` and `textError` from `@hiven/plugin`, remove the local `reply` helper, and return host-neutral output:

- `src/plugins/base64/index.ts`
- `src/plugins/url/index.ts`
- `src/plugins/hash/index.ts`
- `src/plugins/count/index.ts`
- `src/plugins/json/index.ts`
- `src/plugins/case/index.ts`
- `src/plugins/sql/index.ts`
- `src/plugins/sqlin/index.ts`
- `src/plugins/queryString/index.ts`
- `src/plugins/html/index.ts`
- `src/plugins/css/index.ts`
- `src/plugins/xml/index.ts`
- `src/plugins/yaml/index.ts`
- `src/plugins/csv/index.ts`
- `src/plugins/sortJson/index.ts`
- `src/plugins/jwt/index.ts`
- `src/plugins/slashes/index.ts`
- `src/plugins/mdquote/index.ts`
- `src/plugins/extract/index.ts`

Example target shape:

```ts
import { definePlugin, textError, textOutput, type TextInput } from '@hiven/plugin'

run(ctx) {
  const input = ctx.inputs.input as TextInput
  const text = input?.kind === 'text' ? input.text : ''
  try {
    return textOutput(transform(text, ctx.params))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return textError(`Error: ${message}`)
  }
}
```

- [ ] **Step 3: Migrate grouped text plugins**

For these files, replace helper functions that construct `text.replace` with helpers returning `textOutput`:

- `src/plugins/lineTools/index.ts`
- `src/plugins/lineAffix/index.ts`
- `src/plugins/calculator/index.ts`
- `src/plugins/date-time-assistant/index.ts`

For `date-time-assistant`, keep instant suggestions unchanged. Only command output should move to `textOutput`.

- [ ] **Step 4: Keep workspace plugins as effects**

Do not migrate:

- `src/plugins/textDiff/index.ts`
- `src/plugins/jsFilter/index.tsx`
- `src/plugins/core-pane/index.ts`

They should continue returning effects because their behavior is workspace UI, not text output.

- [ ] **Step 5: Verify migration**

Run:

```bash
npm run test:plugin-text-output-contract
npm run test:plugin-merge-groups
npm run test:calculator-command-mode
npm run test:date-time-assistant
npm run test:pinned-plugin-command
```

Expected: all pass. The old pinned runner remains green through `runTextPluginCommand`, but pure text plugins no longer need to know about `text.replace`.

## Task 5: Integration Gates

**Files:**

- No new files unless tests reveal required follow-up.

- [ ] **Step 1: Run focused gates**

Run:

```bash
npm run test:global-launcher-quick-text
npm run test:ime-enter-confirmation
npm run test:global-pinned-launcher
npm run test:pinned-action-live-runner
npm run test:pinned-runner-policy
```

Expected: all pass.

- [ ] **Step 2: Run project-required gates**

Run:

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

Expected:

- no unexpected untracked runtime artifacts in `git status --short --ignored`;
- architecture check passes;
- no whitespace errors;
- build passes.

- [ ] **Step 3: Manual UX verification**

Start the app:

```bash
npm run dev
```

Then open the Tauri app in the normal project workflow and verify:

- GlobalLauncher opens.
- Search shows quick text commands.
- Select `Base64`.
- Type `abc`.
- Preview shows `YWJj`.
- Press Enter.
- Clipboard contains `YWJj`.
- Reopen launcher, start quick mode, use Chinese IME composition, and verify composition Enter does not copy prematurely.
- Escape from quick mode returns to list or closes according to the implemented session state.

## Risks

- `CommandContribution.run` currently returns `PluginCommandResult`; making `effects` optional may reveal assumptions in code that directly reads `result.effects`. Fix by using `result.effects ?? []`.
- Quick command eligibility based only on params/defaults may include commands whose default behavior is surprising. Keep the predicate conservative; users can opt commands in later with an explicit `quickText` capability if needed.
- Tauri clipboard write may fail in non-Tauri browser preview. Use existing `@tauri-apps/plugin-clipboard-manager` path and report failure through toast.
- GlobalLauncher standalone window auto-resizes based on body height. The preview block must have bounded height and scroll internally.

## Success Criteria

- Pure text plugins can return `textOutput(...)` without knowing whether the host will copy, preview, replace, or pin the result.
- Existing command palette and pinned runner behavior still work.
- GlobalLauncher quick text mode copies preview output on Enter.
- No active editor selection or pane text is read or modified by quick text mode.
- Required project gates pass.
