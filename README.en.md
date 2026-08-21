# DeepSeek Harness Four-Pane Workspace Layout Plugin

English | [中文](README.md)

This bundle replaces the DeepSeek Harness Web root layout with four panes: the session/workspace selector, the current workspace file tree, the highlighted file view and guarded editor, and chat. It preserves the existing sidebar, conversation, details, and global-overlay Slot contracts, so the built-in plugins keep owning new-session creation, workspace session lists, settings, chat, tool details, and approvals. Tool details open as a right-side drawer over the four-pane layout instead of consuming a permanent pane.

## Features

- Automatically shows the Workspace file tree when the current Session belongs to a Workspace (also recognized when the Session `cwd` equals its path); directories sort before files, with incremental expansion, collapse, and manual refresh.
- Uses CodeMirror 6 to show line numbers and syntax highlighting based on filenames or extensions; unknown types use plain text.
- In the preview editor, `Ctrl+K+J` unfolds every collapsed fold region; `Ctrl+K+1..9` folds code by nesting level (e.g. `Ctrl+K+2` folds every second-level fold region).
- Enters editing only on an explicit action with **Save**, **Cancel**, and `Ctrl/Cmd+S`; it never autosaves, and switching files never silently discards unsaved content.
- Opens files in per-Session preview tabs with `X` close, drag reorder, tree reveal on selection, and per-tab scroll restore; tabs survive reloads while the draft cache stays in page memory, out of `localStorage`.
- Saves against the revision observed at read time; a disk change preserves the draft and reports a conflict instead of overwriting.
- Rejects binary, non-UTF-8, and out-of-Workspace symlink files; truncated large files, mixed-line-ending files, and symlink-traversing paths are read-only.
- Creates files and folders at the selected level and renames with `F2`; delete and upload are not provided.
- Adds an Explorer toggle above Settings in the sidebar footer; closing collapses the tree and editor, and reopening restores widths, expansion, and selection. The session, tree, and editor panes drag-resize (up to 80% of the layout while open), and layout parameters plus toggle state persist globally in `localStorage`.
- Lets each file-type group pick an editor highlight preset (Default, Classic, Warm, Cool, Monochrome, XML (VS Code)) from the Explorer settings page, remembered per type in `localStorage`.
- Applies configurable limits to directory entries, file size, entry names, and mutation bodies (1,000 entries per directory, 1 MiB per file, 255-byte names, 4 KiB per request by default).
- Shows the editor context as a non-editable prefix outside the textarea through the existing input dock: active sends freeze the context and render `<opened_file>...</opened_file>` or, for selected text, `<selection>...</selection>` (no file bytes without a selection); gray sends attach nothing. The Host validates it, prepends it to the direct user prompt, and the conversation view folds it into a one-line summary above the bubble showing the file name and range.
- Uses Harness semantic theme variables and supports light, dark, and system themes.

## Syntax highlighting

The bundle includes JavaScript/JSX, TypeScript/TSX, JSON, HTML, CSS/SCSS/Less, Markdown/MDX, Python, SQL, XML/SVG, YAML, C/C++, Java, Rust, PHP, Go, Shell, PowerShell, Ruby, TOML, and Dockerfile highlighting. `Makefile`, `.gitignore`, `.env`, `LICENSE`, and unknown extensions stay browsable and editable in plain text.

## Installation

Run from Git Bash, Linux, or WSL:

```sh
cd C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-explorer-layout
bash ./install.sh          # default target is the web profile
bash ./install.sh web      # a profile can be supplied explicitly
```

The script first uses `dsh` from PATH; when the current directory belongs to a Harness checkout and PATH has no `dsh`, it uses `pnpm --dir <harness-root> dsh`, and `DSH_BIN` may name an executable. After installation, stop and restart the existing Web process, then refresh `http://127.0.0.1:3080`; the script does not start a second server.

## Uninstallation

```sh
bash ./uninstall.sh
```

Restart the existing Web process after removal; the built-in `ui-layout` returns when the bundle layer is removed.

## Configuration

The plugin row in `cordis.patch.yml` accepts:

| Field | Default | Description |
|---|---:|---|
| `enableEditing` | `false` | Enables the Host write endpoint; this bundle patch sets it to `true`. |
| `maxContextBytes` | `65536` | Explorer preflight maximum for selected-text UTF-8 bytes (1024–1048576); path-only contexts submit no file bytes. |
| `maxPromptContextBytes` | `69632` | Host maximum for the complete rendered context, including the envelope and selected text (4096–2097152). |
| `maxContextSourceBytes` | `10485760` | Maximum raw source bytes read for clean revision verification (1024–104857600). |
| `maxEditableBytes` | `1048576` | Maximum UTF-8 bytes saved for one file (1024–10485760). |
| `maxEntryNameBytes` | `255` | Maximum UTF-8 bytes allowed for one entry name (1–1024). |
| `maxEntriesPerDirectory` | `1000` | Maximum entries returned for one directory (1–10000). |
| `maxMutationBodyBytes` | `4096` | Maximum JSON bytes accepted by create and rename requests (128–65536). |
| `maxPreviewBytes` | `1048576` | Maximum bytes read and returned for one file (1024–10485760). |

Edit the bundle's `cordis.patch.yml` to change these values. To prevent pnpm from reusing an installed local `file:` copy, run `uninstall.sh`, then `install.sh`, and finally restart the Web process.

## Security boundary

Host endpoints accept only registered Workspace IDs and relative paths; every read or write resolves the real path and confirms the target stays under the canonical Workspace root, so `..`, absolute paths, and out-of-Workspace symlinks are inaccessible. The endpoints also enforce Host, Origin, and Fetch-Metadata source checks equivalent to the built-in `/api` routes.

The write endpoint accepts `PUT` only when `enableEditing` is enabled; the body must be bounded UTF-8 text carrying the read-time `If-Match` revision, and a mismatch returns a conflict without overwriting. The target must be an existing regular file reached without any symbolic link. Create and rename reuse the same containment checks, require single-segment names, and refuse existing targets. The Host commits through a same-directory temporary file, file synchronization, and atomic rename, preserving the original permission mode when possible.

Editor context accepts only a relative path in a Workspace that owns the current Session (through its membership projection or the Session's canonical cwd); a path-only context carries no file bytes. The Host rejects symbolic links, validates clean selections against their disk revision, treats previews truncated by `maxPreviewBytes` as browser-authoritative, and prepends the rendered text to the direct prompt, so the ordinary Session log records the exact model-visible context. The conversation view folds that envelope into a one-line summary above the bubble showing the file name and range, and history renders the logged user message without rereading the current editor or disk.

These constraints govern only the explorer's file endpoints and Composer context; they do not change Agent permission policy, sandboxing, or tool capability. The endpoints provide application-level path-containment checks for trusted local UI use and do not replace Harness kernel-level isolation.

## Project structure

```text
.
├── package.json                         # Installable bundle manifest
├── cordis.patch.yml                     # Disables the built-in root layout and mounts this plugin
├── install.sh / uninstall.sh
└── packages/client/ui-workspace-explorer-layout/
    ├── src/client/index.js              # Browser source
    ├── lib/index.js                     # Host: bounded Workspace read, save, create, and rename API
    └── lib/client.js                    # Prebuilt four-pane layout, file tree, and editor
```

CodeMirror and its language modules are bundled into the prebuilt plain-JavaScript Client artifact, so installation runs no builds or tests. To maintain the source, run `pnpm install --ignore-workspace --config.auto-install-peers=false` in the inner package and then `pnpm bundle` to regenerate `lib/client.js`.

## Compatibility

This version targets a Harness `0.1.x` checkout that provides the `conversation.input.dock` Slot, the session input resolver, and the conversation send service. The editor-context behavior is implemented entirely by this bundle and does not require modified Harness source; the send bridge adapts the concrete 0.1.x send, input-submit, and queue-steer seams, so a future release may need only a bundle-internal bridge update. A higher-priority patch that re-enables `ui-layout` competes for the root Slot; retain this bundle's `ui-layout` disable entry.
