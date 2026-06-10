import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

function read(path) {
  return readFileSync(path, 'utf8')
}

function has(source, pattern, message) {
  assert.match(source, pattern, message)
}

function notHas(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message)
}

const files = {
  packageJson: read('package.json'),
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  css: read('src/index.css'),
  sidebar: read('src/components/Sidebar.tsx'),
  editor: read('src/views/EditorView.tsx'),
  scripts: read('src/views/ScriptsView.tsx'),
  settings: read('src/views/SettingsView.tsx'),
  pinned: read('src/views/PinnedRunnerView.tsx'),
  pluginEditor: read('src/views/PluginEditorView.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  paneEditor: read('src/components/workspace/PaneEditor.tsx'),
  dualEditor: read('src/kits/ui/DualEditorView.tsx'),
  monacoTheme: read('src/utils/monacoTheme.ts'),
  workspaceShell: read('src/components/workspace/WorkspaceShell.tsx'),
  renderStatusBar: read('src/components/workspace/RenderStatusBar.tsx'),
  tauriConfig: read('src-tauri/tauri.conf.json'),
}

has(files.packageJson, /"test:spatial-ui-contract":\s*"node scripts\/test-spatial-ui-contract\.mjs"/, 'package.json should expose the spatial UI contract test')

has(files.store, /theme:\s*['"]dark['"]\s*\|\s*['"]light['"]/, 'settings should type a persisted dark/light theme')
has(files.store, /theme:\s*['"]dark['"]/, 'default settings should include a dark theme')
has(files.app, /data-theme=\{settings\.theme\}/, 'App should apply persisted theme through data-theme')
notHas(files.app, /<FluxTitlebar\b|function FluxTitlebar|className=["']flux-titlebar/, 'App should not render a custom top titlebar')
has(files.editor, /updateSetting\(['"]theme['"]/, 'Editor toolbar should provide the in-app theme toggle')
has(files.editor, /\{t\(['"]runAction['"]\)\}[\s\S]{0,640}theme === ['"]dark['"] \? <Sun/, 'Theme toggle should sit after the run action in the editor toolbar')
has(files.app, /flux-spatial-shell/, 'App should wrap the main UI in a spatial shell')

has(files.css, /body\[data-theme=['"]dark['"]\]/, 'CSS should define the dark theme token scope')
has(files.css, /body\[data-theme=['"]light['"]\]/, 'CSS should define the light theme token scope')
has(files.css, /--sidebar-w:\s*44px/, 'CSS should expose demo-compatible sidebar width')
notHas(files.css, /\.flux-titlebar\b|\.flux-titlebar-logo\b|\.flux-titlebar-kbd\b|\.flux-titlebar-spacer\b/, 'CSS should not keep custom titlebar styles after the titlebar is removed')
has(files.css, /\.flux-sidebar\b/, 'CSS should style the spatial sidebar')
has(files.css, /\.glass\b/, 'CSS should include the shared glass panel utility')
has(files.css, /\.btn-primary\b/, 'CSS should include spec primary buttons')
has(files.css, /\.toggle(?:\s|\{|,)/, 'CSS should include spec toggle controls')
has(files.css, /\.seg-control\b/, 'CSS should include spec segmented controls')
has(files.css, /\.card\b/, 'CSS should include spec cards')
has(files.css, /\.cmd-item\b/, 'CSS should include spec command items')
has(files.css, /\.status-dot\.ready\b/, 'CSS should include ready status dots')
has(files.css, /\.status-dot\.running\b/, 'CSS should include running status dots')
has(files.css, /\.status-dot\.error-dot\b/, 'CSS should include error status dots')

has(files.sidebar, /className=.*flux-sidebar/s, 'Sidebar should use the spatial sidebar component')
has(files.sidebar, /className=.*sidebar-btn/s, 'Sidebar buttons should use the spec sidebar button class')
has(files.editor, /status-dot ready/, 'Editor topbar should use the ready status dot component')
has(files.editor, /className=.*btn.*btn-ghost.*btn-sm/s, 'Editor toolbar action should use spec button classes')
has(files.scripts, /seg-control sm/, 'Scripts view should use segmented controls for plugin tabs')
has(files.scripts, /className=.*card/s, 'Scripts view plugin rows should use spec card classes')
has(files.settings, /function ThemeSettings|settings\.theme/, 'Settings should expose theme controls')
has(files.settings, /className=.*toggle/s, 'Settings toggles should use the spec toggle component')
has(files.pinned, /pinned-cols|pinned-col/, 'Pinned runner should keep the demo two-column spatial layout classes')
has(files.pluginEditor, /file-tree|tree-node/, 'Plugin editor should use file tree node component classes')
has(files.commandPalette, /cmd-item/, 'Command palette should render spec command items')
has(files.globalLauncher, /cmd-item/, 'Global launcher should render spec command items')
has(files.globalLauncher, /global-launcher-panel/, 'Global launcher should use a bounded panel component')
has(files.globalLauncher, /startDragging\(\)/, 'Standalone global launcher should drag the native window instead of moving inside its own bounds')
has(files.store, /globalLauncherWindowPosition\??:\s*GlobalLauncherPosition/, 'Global launcher should persist its dragged native window position separately from in-app panel position')
has(files.globalLauncher, /onPointerDown=\{beginDrag\}/, 'Global launcher should expose a drag handle')
has(files.css, /\.global-launcher-panel[\s\S]{0,260}max-height:\s*min\(var\(--command-palette-panel-max-height\),\s*calc\(100vh - 24px\)\)/, 'Global launcher panel should be constrained within the viewport')
has(files.css, /\.global-launcher-body[\s\S]{0,120}overflow-y:\s*auto/, 'Global launcher body should scroll instead of clipping the footer')
has(files.workspaceShell, /pane-tab/, 'Workspace split panes should use spec pane tab classes')
has(files.renderStatusBar, /statusbar/, 'Renderer status should use the demo statusbar component')
has(files.paneEditor, /const\s+lineDecorationsWidth\s*=\s*foldingEnabled\s*\?\s*8\s*:\s*24/, 'Primary editor should normalize total gutter width for folding and plaintext panes')
has(files.paneEditor, /lineDecorationsWidth,\s*\n\s*lineNumbersMinChars:\s*3/, 'Primary editor should keep a consistent VS Code-like gap after compact line numbers')
has(files.paneEditor, /lineNumbersMinChars:\s*3/, 'Primary editor should use a fixed line-number width across panes')
has(files.paneEditor, /padding:\s*\{\s*top:\s*12,\s*left:\s*8\s*\}/, 'Primary editor should add breathing room after the gutter')
has(files.paneEditor, /renderLineHighlight:\s*['"]line['"]/, 'Primary editor should use VS Code-like current line highlighting')
has(files.dualEditor, /padding:\s*\{\s*top:\s*12,\s*left:\s*8\s*\}/, 'Dual editor panes should match the primary editor padding')
has(files.monacoTheme, /editorGutter\.background['"]:\s*['"]#0f1012['"]/, 'Dark Monaco gutter should match the editor background')
has(files.monacoTheme, /editorGutter\.background['"]:\s*['"]#ffffff['"]/, 'Light Monaco gutter should match the editor background')
has(files.monacoTheme, /editor\.lineHighlightBackground/, 'Monaco theme should define a VS Code-like current line highlight')
has(files.css, /\.monaco-editor \.margin[\s\S]{0,100}background:\s*var\(--vscode-editor-background\)/, 'Monaco line-number margin should use the editor background')
has(files.css, /\.margin-view-overlays \.current-line[\s\S]{0,100}background:\s*transparent/, 'Monaco current line highlight should not paint a separate gutter block')

{
  const config = JSON.parse(files.tauriConfig)
  const main = config.app?.windows?.find((window) => window.label === 'main')
  const launcher = config.app?.windows?.find((window) => window.label === 'launcher')
  assert.equal(main?.transparent, false, 'main window should be opaque so the native titlebar area follows app color')
  assert.equal(launcher?.transparent, true, 'launcher window should be transparent around the opaque rounded panel')
}

notHas(files.app, /fontFamily:\s*['"]var\(--font-mono\)['"]/s, 'The app shell should rely on global spatial typography instead of forcing mono everywhere')
