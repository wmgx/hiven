# Hiven Editor Bridge (VS Code / Cursor)

D4 adapter: pushes open file documents to Hiven’s desktop bridge (`editor.vscode`).

## Install (dev)

```bash
# From this folder, package or symlink into extensions dir:
code --install-extension .   # or open as unpacked via "Install from VSIX" after vsce package
```

Or **Developer: Install Extension from Location…** and select this directory.

1. Start Hiven desktop app (bridge on `127.0.0.1:19246`).
2. Reload VS Code / Cursor window.
3. In Global Launcher, type part of a file name (empty search shows **0** editor docs by design).

## Source id

`editor.vscode` — works for VS Code, Cursor, and other VS Code-compatible shells that load this extension.
