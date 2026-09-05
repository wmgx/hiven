#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  vite: read('vite.config.ts'),
  tsconfig: read('tsconfig.app.json'),
  pluginUi: read('src/plugin-ui.tsx'),
  pluginUiIcons: read('src/plugin-ui-icons.ts'),
  css: read('src/index.css'),
  clipboardStyle: read('src/plugins/clipboard-history/style.css'),
  clipboardSurface: read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx'),
  jsonSurface: read('src/plugins/json-tools/JsonSurface.tsx'),
  regexSurface: read('src/plugins/regex-tester/RegexTesterViews.tsx'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  pluginSurfaceRenderer: read('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  pluginSettingsDialog: read('src/components/PluginSettingsDialog.tsx'),
  pluginSettingsSchema: read('src/components/PluginSettingsSchemaRenderer.tsx'),
  launcherFrames: read('src/components/launcher/GlobalLauncherFrames.tsx'),
  systemSettingsSurface: read('src/components/SystemSettingsSurface.tsx'),
  pluginsContent: read('src/surfaces/PluginsContent.tsx'),
  textDiffSurface: read('src/plugins/textDiff/TextDiffSurface.tsx'),
  textExplodeIndex: read('src/plugins/text-explode/index.tsx'),
  textExplodeSurface: read('src/plugins/text-explode/surfaces/TextExplodeSurface.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:plugin-ui-primitives'],
  'node scripts/test-plugin-ui-primitives.mjs',
  'package.json must expose test:plugin-ui-primitives',
)

for (const source of [files.vite, files.tsconfig]) {
  assert.match(source, /@hiven\/plugin-ui/, 'Vite and TS config must expose @hiven/plugin-ui')
  assert.match(source, /@hiven\/plugin-ui\/icons/, 'Vite and TS config must expose @hiven/plugin-ui/icons')
}

for (const exported of [
  'Button',
  'IconButton',
  'TextInput',
  'SearchField',
  'TextArea',
  'Select',
  'Combobox',
  'Checkbox',
  'Toggle',
  'SegmentedControl',
  'NumberField',
  'Slider',
  'ToolbarButton',
  'SurfaceList',
  'SurfaceListItem',
  'SurfacePreview',
  'SurfaceEmptyState',
  'SurfaceToolbar',
  'SurfaceFooterHints',
  'ConfirmDialog',
]) {
  assert.match(files.pluginUi, new RegExp(`export (?:const|function) ${exported}\\b`), `plugin-ui must export ${exported}`)
}

assert.doesNotMatch(files.pluginUi, /useAppStore|pluginRegistry|@tauri-apps|workspaceStore|Monaco/, 'plugin-ui primitives must not expose host internals')
assert.match(files.pluginUiIcons, /ClipboardIcon/, 'plugin-ui icons must expose stable clipboard icon names')
assert.match(files.pluginTypes, /appearance:\s*PluginSurfaceAppearance/, 'plugin surfaces should receive host appearance separately from plugin settings')
assert.match(files.pluginSurfaceRenderer, /appearance=\{appearance\}/, 'plugin surface renderer should inject host appearance')
assert.match(files.textDiffSurface, /monacoTheme=\{appearance\.theme === ['"]dark['"]/, 'text diff should follow host theme through the public appearance context')
assert.match(files.textDiffSurface, /td-pane-labels[\s\S]{0,180}surface\.original[\s\S]{0,180}surface\.modified/, 'text diff should label both sides in the normal desktop workspace')
assert.match(files.textDiffSurface, /leftAriaLabel=\{t\(['"]surface\.original['"]\)\}[\s\S]{0,100}rightAriaLabel=\{t\(['"]surface\.modified['"]\)\}/, 'text diff editors should expose distinct localized labels')
assert.doesNotMatch(files.textDiffSurface, /hostSettings|settings as \{[^}]*theme/, 'text diff must not mistake plugin settings for host appearance')
assert.match(files.textExplodeIndex, /closeOnBlur:\s*false/, 'text explode should remain open when focus moves away')
assert.match(files.textExplodeSurface, /role="button"[\s\S]{0,120}aria-pressed=\{committed\}/, 'text explode fragments should expose their committed keyboard selection state')
assert.match(files.textExplodeSurface, /event\.key !== 'Enter' && event\.key !== ' '/, 'text explode fragments should support Enter and Space')
assert.match(files.systemSettingsSurface, /<button[\s\S]{0,220}onClick=/, 'settings tabs must remain native keyboard-activatable buttons')
assert.match(files.pluginSettingsDialog, /setTimeout\([\s\S]{0,140}90\)/, 'plugin settings should keep content mounted for its short exit')
assert.match(files.pluginSettingsDialog, /<Dialog\.Root open onOpenChange=/, 'plugin settings should keep the Base UI popup mounted while its exit runs')
assert.match(files.pluginSettingsDialog, /plugin-settings-dialog-panel\$\{isClosing \? ' is-closing'/, 'plugin settings should expose a stable closing state')
assert.doesNotMatch(files.pluginSettingsDialog, /plugin-settings-dialog-panel anim-dropdown/, 'centered plugin settings must not reuse transform-based dropdown motion')
assert.match(files.pluginSettingsDialog, /plugin-settings-modal-panel[\s\S]{0,220}isSettingsModalClosing/, 'nested plugin settings should expose the same stable closing state')
assert.doesNotMatch(files.pluginSettingsDialog, /rounded-lg anim-dropdown/, 'centered nested settings must not reuse transform-based dropdown motion')
assert.match(files.css, /\.plugin-settings-dialog-panel,[\s\S]{0,160}plugin-settings-dialog-in 140ms/, 'plugin settings entry should animate without changing its centered transform')
assert.match(files.pluginSettingsSchema, /rawValue \/ scale\)\.toFixed\(6\)/, 'scaled settings numbers should not leak floating-point noise into the UI')
assert.match(files.pluginSettingsSchema, /step=\{field\.step\}/, 'number settings should preserve each plugin field step')
assert.match(files.launcherFrames, /LauncherFlowFrame[\s\S]*param:[\s\S]*collect:[\s\S]*result:/, 'shared launcher parameter, input, and result frames should use one transition shell')
assert.match(files.css, /\.global-launcher-flow-frame\s*\{[\s\S]{0,180}animation:\s*launcher-flow-frame-in 120ms/, 'launcher flow transitions should animate opacity without resizing')
assert.match(files.pluginsContent, /className="plugins-search-input"[\s\S]{0,100}type="text"/, 'plugin search must remain a native tabbable input')
assert.match(files.pluginsContent, /className="plugins-row"[\s\S]{0,120}role="button"[\s\S]{0,80}tabIndex=\{0\}/, 'plugin rows must remain in the keyboard tab order')
assert.match(files.pluginsContent, /event\.key === 'Enter' \|\| event\.key === ' '/, 'plugin rows must support Enter and Space')
assert.doesNotMatch(
  files.css,
  /\.plugins-row\s*\{[^}]*transition:\s*background/,
  'plugin row hover backgrounds must respond immediately without trailing the pointer',
)
assert.match(files.pluginUi, /<BaseMenu\.Trigger render=\{trigger\} \/>/, 'shared menus must keep Base UI keyboard trigger semantics')

for (const token of [
  '--hiven-color-bg-primary',
  '--hiven-color-text-primary',
  '--hiven-color-border',
  '--hiven-color-accent',
  '--hiven-radius-md',
  '--hiven-font-ui',
]) {
  assert.match(files.css, new RegExp(token), `CSS must expose public token ${token}`)
}

assert.match(files.css, /\.hiven-ui-button/, 'CSS must style plugin-ui buttons')
assert.match(files.css, /\.hiven-ui-select/, 'CSS must style plugin-ui select wrappers')
assert.match(files.css, /\.hiven-ui-select-trigger/, 'plugin-ui select must use custom trigger (not native OS menu)')
assert.match(files.css, /\.hiven-ui-select-menu/, 'plugin-ui select must style in-app dropdown menu')
assert.match(files.pluginUi, /BaseCombobox\.Popup className="hiven-ui-combobox-menu"/, 'Combobox must not reuse the wide Select popup shell')
assert.match(files.pluginUi, /ScrollArea as BaseScrollArea/, 'Select primitives should delegate scrolling to Base UI ScrollArea')
assert.match(files.pluginUi, /BaseScrollArea\.Scrollbar className="hiven-ui-menu-scrollbar">/, 'Menus should delegate overflow-only scrollbar rendering to Base UI')
assert.doesNotMatch(files.pluginUi, /BaseScrollArea\.Scrollbar[^>]*keepMounted/, 'Menus must not show a fake scrollbar without overflow')
assert.match(
  files.pluginUi,
  /BaseSelect\.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable/,
  'Portaled Select menus must opt into launcher wheel scrolling',
)
assert.match(
  files.pluginUi,
  /BaseCombobox\.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable/,
  'Portaled Combobox menus must opt into launcher wheel scrolling',
)
assert.match(
  files.css,
  /\.hiven-ui-menu-scroll-viewport\s*\{[\s\S]{0,180}max-height:\s*min\(216px,\s*var\(--available-height,\s*100vh\)\)/,
  'Menu viewport height must stay valid before Positioner writes --available-height',
)
assert.match(
  files.css,
  /\.hiven-ui-menu-scroll-viewport\s*\{[\s\S]{0,220}touch-action:\s*pan-y/,
  'Menu viewport must override launcher document touch-action:none so trackpad panning can scroll',
)
assert.doesNotMatch(files.css, /\.hiven-ui-combobox-menu\s*\{[\s\S]{0,240}overflow-y:/, 'Combobox popup must not own custom scrolling logic')
assert.match(files.css, /\.hiven-ui-combobox-empty:not\(:empty\)\s*\{[\s\S]{0,80}padding:/, 'Mounted empty live region must not leave blank space when options exist')
assert.match(files.pluginUi, /BaseCombobox\.Item[\s\S]{0,300}hiven-ui-select-option-label[\s\S]{0,300}BaseCombobox\.ItemIndicator className="hiven-ui-select-option-indicator"/, 'Combobox label must precede its trailing selection indicator')
assert.match(files.css, /\.hiven-ui-select-option\s*\{[\s\S]{0,180}grid-template-columns:\s*minmax\(0,\s*1fr\) 16px;/, 'Select and Combobox items must keep labels and indicators in stable columns')
assert.match(files.pluginUi, /hiven-ui-select-menu|role=['"]listbox['"]/, 'plugin-ui Select must render custom listbox menu')
assert.doesNotMatch(files.pluginUi, /return\s*\([\s\S]{0,80}<select[\s>]/, 'plugin-ui Select must not render native select element')
assert.match(files.css, /\.hiven-ui-surface-toolbar/, 'CSS must style plugin-ui surface toolbar')
assert.match(files.css, /\.hiven-ui-surface-empty/, 'CSS must style plugin-ui empty state')
assert.match(
  files.css,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\*[\s\S]*transition-duration:\s*0\.01ms !important;[\s\S]*animation-duration:\s*0\.01ms !important;[\s\S]*animation-iteration-count:\s*1 !important;/,
  'all host and plugin motion should respect the operating-system reduced-motion preference',
)

assert.match(files.clipboardSurface, /from ['"]@hiven\/plugin-ui['"]/, 'clipboard-history surface should use plugin-ui primitives')
assert.match(files.pluginUiIcons, /BackIcon/, 'plugin-ui icons must expose a stable back icon name')
assert.match(files.clipboardSurface, /<SearchField|<SegmentedControl|<SurfaceList|<SurfacePreview|<SurfaceEmptyState/, 'clipboard-history should render plugin-ui primitives')
assert.match(files.clipboardSurface, /clipboard-history-list-toolbar[\s\S]{0,600}<SegmentedControl/, 'clipboard-history type filter should sit above the left list')
assert.match(files.clipboardSurface, /<SegmentedControl[\s\S]{0,600}filter\.all[\s\S]{0,600}filter\.files/, 'clipboard-history type filter should use a styled segmented control instead of a native select menu')
assert.match(files.clipboardSurface, /filter\.files/, 'clipboard-history should expose the files filter from the UX design')
assert.doesNotMatch(files.clipboardSurface, /clipboard-history-copy-count|meta\.timesCopied/, 'clipboard-history should not display copy-count UI')
assert.match(files.clipboardSurface, /ClipboardImageThumbnail/, 'clipboard-history should render image thumbnails in the list')
assert.match(files.clipboardSurface, /clipboard-history-item-delete/, 'clipboard-history should render per-item delete controls')
for (const surface of [files.jsonSurface, files.regexSurface]) {
  assert.match(surface, /from ['"]@hiven\/plugin-ui['"]/, 'simple plugin surfaces should reuse plugin-ui header controls')
  assert.match(surface, /<BackIcon/, 'simple plugin surfaces should expose consistent back navigation')
  assert.match(surface, /<CloseIcon/, 'simple plugin surfaces should expose a consistent close action')
}
assert.match(files.jsonSurface, /await host\.clipboard\.writeText\(outputText\)[\s\S]{0,180}host\.showMessage\(t\(['"]toast\.copied['"]\), ['"]success['"]\)/, 'JSON copy must confirm success through the host')
assert.match(files.jsonSurface, /role=\{result\.ok \? undefined : ['"]alert['"]\}/, 'JSON parse errors should be announced to assistive technology')
assert.equal(files.regexSurface.match(/role="alert"/g)?.length, 2, 'Regex errors should be announced in both panel and surface views')
assert.match(files.clipboardStyle, /\.clipboard-history-item\s*\{[\s\S]{0,180}padding:\s*0\s+36px\s+0\s+9px/, 'clipboard-history rows should reserve room for the delete control')
assert.match(files.clipboardStyle, /\.clipboard-history-main::after[\s\S]{0,260}left:\s*var\(--clipboard-history-list-width\)[\s\S]{0,180}width:\s*1px/, 'clipboard-history left and right panes should match the UX divider position')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row:hover[\s\S]{0,220}background/, 'clipboard-history items should keep a visible hover highlight')
assert.doesNotMatch(files.clipboardStyle, /\.clipboard-history-item-row\s*\{[^}]*transition:/, 'clipboard-history hover feedback must not trail the pointer')
assert.doesNotMatch(files.clipboardSurface, /onMouseEnter=\{\(\) => onHover/, 'clipboard-history hover must not trigger selection and preview loading')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row\.is-selected[\s\S]{0,260}background-color:\s*var\(--color-accent-bg\)/, 'clipboard-history selected item should keep a visible theme-aware fill')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row\.is-selected \.clipboard-history-item[\s\S]{0,180}background:\s*transparent !important/, 'clipboard-history selected item should override generic plugin-ui selected backgrounds')
assert.match(files.clipboardStyle, /\.clipboard-history-item-thumb/, 'clipboard-history should style image thumbnails')
assert.match(files.clipboardStyle, /\.clipboard-history-filter \.hiven-ui-segmented-item\.is-active[\s\S]{0,180}!important/, 'clipboard-history type filter should override generic plugin-ui active styles')

console.log('plugin-ui primitive checks passed')
