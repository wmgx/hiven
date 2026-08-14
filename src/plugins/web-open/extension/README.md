# Chromium extension (shipped with the Browser plugin `web-open`)

Load this folder as an unpacked extension in Chrome / Edge.

Released path after Hiven starts:

```text
~/.local/hiven/plugins/builtin/web-open/extension
```

Use **Plugins → Browser → Browser connection & tabs → Open extension folder** in Hiven settings.

After upgrading, reload the unpacked extension so Chrome grants the new
`history` permission. The host then receives:

- open-tab snapshots (existing)
- recent browsing history
- `tab.opened` / `tab.activated` events
- idle-tab auto-close (off by default; timeout is set in plugin settings)
