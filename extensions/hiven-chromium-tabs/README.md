# Hiven Browser Tabs (Chromium) — legacy path

The **canonical** extension package now lives inside the first-party plugin:

```text
src/plugins/browser-tabs/extension/
```

Released / install path:

```text
~/.local/hiven/plugins/builtin/browser-tabs/extension
```

## Install (recommended)

1. Start Hiven.
2. **Plugins → Browser Tabs** settings → **Open extension folder**.
3. Chrome / Edge → Extensions → Developer mode → **Load unpacked** → that folder.
4. Refresh status in plugin settings until Connected.

This directory (`extensions/hiven-chromium-tabs`) is kept as a thin compatibility pointer for older docs; prefer the plugin package path above.
