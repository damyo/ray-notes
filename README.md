# Ray Notes

[English](README.md) | [한국어](README.ko.md)

[![GitHub release](https://img.shields.io/github/v/release/damyo/ray-notes)](https://github.com/damyo/ray-notes/releases)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/damyo)

Ray Notes opens notes from a dedicated Obsidian folder in compact, always-on-top windows inspired by Raycast Notes. It uses Obsidian's native Markdown editor, so your notes remain ordinary Markdown files in your vault.

> Ray Notes is an independent project and is not affiliated with Raycast.

## Features

- Compact popout windows without Obsidian's ribbon, tab bar, view header, or status bar
- Native editing and reading modes with Raycast-inspired typography and Markdown styling
- Always on Top, Minimal Mode, multiple note windows, and optional macOS Show on All Spaces
- Configurable global shortcut for showing or hiding the primary window from any app
- Browse Notes searches both titles and note contents, with pinned and recently opened notes
- Floating formatting controls, action panel, in-note search, and file properties support
- Optional translucent window and screen-sharing privacy controls
- Automatic title and filename generation from the first meaningful line
- Restored note, window position, size, and recent-note state between sessions
- `obsidian://ray-notes` protocol support for external launchers

## Requirements

- Obsidian 1.7.2 or later
- Desktop only

## Installation

### Community plugins

After Ray Notes is accepted into the Obsidian Community directory:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Ray Notes**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/damyo/ray-notes/releases).
2. Place the files in `<vault>/.obsidian/plugins/ray-notes/`.
3. Reload Obsidian and enable **Ray Notes** under **Settings → Community plugins**.

## Usage

Run **Ray Notes: Open notes window** from the Command Palette or use the ribbon icon. By default, Ray Notes stores files in the `Ray Notes` folder and registers `Option+N` as its global shortcut.

Common macOS shortcuts:

| Action | Shortcut |
| --- | --- |
| Create Note | `Command+N` |
| Browse Notes | `Command+P` |
| Previous / Next Note | `Command+[` / `Command+]` |
| Find in Note | `Command+F` |
| File Properties | `Command+;` |
| Bold / Italic / Underline | `Command+B` / `Command+I` / `Command+U` |
| Strikethrough | `Shift+Command+S` |
| Inline Code | `Option+Command+E` |
| Heading 1–3 | `Option+Command+1–3` |

Use `Ctrl` in place of `Command` for Mod shortcuts on Windows. The global shortcut can be changed or disabled in the plugin settings.

## Settings

- Notes folder
- Default Always on Top state
- Show on All Spaces on macOS
- Global shortcut and shortcut recording
- Raycast appearance and translucent window
- Where notes from the Ray Notes folder open
- Whether the main Obsidian window is minimized when Ray Notes opens

## Support

Report bugs and request features in [GitHub Issues](https://github.com/damyo/ray-notes/issues). If Ray Notes helps your workflow, you can [support its development on Ko-fi](https://ko-fi.com/damyo).

## Limitations

Ray Notes runs inside Obsidian, so Obsidian and the vault must remain open. Quitting Obsidian also closes Ray Notes windows.

Window translucency uses Electron's macOS vibrancy. Themes or plugins that add opaque backgrounds can reduce or hide the effect.
