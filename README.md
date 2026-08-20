# DeepSeek Harness Four-Pane Workspace Layout Plugin

English | [中文](README.zh.md)

This bundle replaces the DeepSeek Harness Web root layout with:

```text
Session/workspace selector | Current workspace file tree | Highlighted file view and guarded editor | Chat
```

The plugin preserves the existing sidebar, conversation, details, and global-overlay Slot contracts. Built-in plugins therefore continue to own new-session creation, workspace session lists, settings, chat, tool details, approvals, and related behavior. Tool details open as a right-side drawer over the four-pane layout instead of consuming a permanent pane.

## Features

- Automatically shows the Workspace file tree when the current Session belongs to a Workspace.
- Also recognizes a Workspace when the current Session `cwd` equals its path, including supported child-session cases.
- Sorts directories before files and supports incremental expansion, collapse, and manual refresh.
- Uses CodeMirror 6 to show line numbers and syntax highlighting based on special filenames or extensions; unknown types use plain text.
- Shows the open file as a non-editable Composer prefix outside the textarea through the existing session-scoped input dock. Keyboard editing, cut, undo, and selection cannot remove it; clicking toggles it between active and persistently gray for the current Session.
- On each active send, the plugin freezes the editor context at the send boundary and renders one of two prompt envelopes: `<opened_file>...</opened_file>` for file-only sends, or `<selection>...</selection>` for selected text. With no selection, it sends only the opened-file envelope and never includes file bytes. Gray sends attach nothing. An explicit “发送上下文” action handles context-only sends without adding text to the editable draft.
- The Host validates the request, renders the envelope text, and prepends it to that direct user prompt. In the conversation view, the plugin folds that envelope into a compact row above the bubble that shows the file name and the line/column range; hovering that row reveals the full injected XML. The raw envelope still lives in the ordinary user message history, and each active turn is submitted independently without hash deduplication.
- Enters editing only on an explicit action and provides **Save**, **Cancel**, and `Ctrl/Cmd+S`; it never autosaves.
- Never discards unsaved content silently during file changes: the user must save, discard, or continue editing. Closing the explorer preserves the current editor state.
- Opens files in per-Session preview tabs, lets the user close them with `X` or reorder them by drag, reveals the matching file in the tree when a tab is selected, and restores each tab's vertical scroll position.
- Retains the workspace draft cache in page memory across Session or Workspace switches and persists open preview tabs plus each tab's vertical scroll position across reloads and Session or Workspace returns. The draft cache stays out of `localStorage`; preview tabs use browser persistence.
- Saves against the revision observed during the read. A disk change preserves the draft and reports a conflict instead of overwriting automatically.
- Rejects binary files, non-UTF-8 files, and symbolic links outside the Workspace. Truncated large files, mixed-line-ending files, and paths traversing symbolic links are read-only.
- Creates files and folders in the selected level, renames the selected file or folder with `F2`, and still provides no delete or upload operation.
- Adds an Explorer toggle at the bottom of the left sidebar immediately above Settings. Its sizing, spacing, hover behavior, and active theme color match the Settings entry in both wide and collapsed modes.
- Places `sidebar.footer.action` extension buttons in separate vertical rows, preventing Mobile Preview, Explorer, and Settings from crowding one row.
- Closing Explorer collapses both the file tree and editor so chat sits beside the sidebar; reopening restores widths, expanded directories, and file selection.
- Supports drag resizing for the Session, file-tree, and file-editor panes; when Explorer is open, the left pane group can keep expanding up to 80% of the visible layout and the chat column can keep shrinking, while preserving the existing sidebar expand/collapse control.
- Applies configurable directory, file, entry-name, and mutation-body limits: 1,000 entries per directory, 1 MiB per browsed or edited file, 255 UTF-8 bytes per entry name, and 4 KiB per create or rename request by default.
- Uses Harness semantic theme variables and supports light, dark, and system themes.

## Syntax highlighting

The initial bundle includes JavaScript/JSX, TypeScript/TSX, JSON, HTML, CSS/SCSS/Less, Markdown/MDX, Python, SQL, XML/SVG, YAML, C/C++, Java, Rust, PHP, Go, Shell, PowerShell, Ruby, TOML, and Dockerfile highlighting. `Makefile`, `.gitignore`, `.env`, `LICENSE`, and unknown extensions remain browsable and editable in plain-text mode.

## Installation

Run from Git Bash, Linux, or WSL:

```sh
cd C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-explorer-layout
bash ./install.sh
```

The default target is the `web` profile. A profile can also be supplied explicitly:

```sh
bash ./install.sh web
```

The script first uses `dsh` from PATH. When the current directory belongs to a DeepSeek Harness source checkout and PATH has no `dsh`, it uses `pnpm --dir <harness-root> dsh`. `DSH_BIN` may name an executable without additional arguments:

```sh
DSH_BIN=/path/to/dsh bash ./install.sh web
```

After installation, stop and restart the existing Web process, then refresh `http://127.0.0.1:3080`. The installation script does not start a second server.

## Uninstallation

```sh
bash ./uninstall.sh
```

Restart the existing Web process after removal. The built-in `ui-layout` returns when the bundle layer is removed.

## Configuration

The plugin row in `cordis.patch.yml` accepts:

| Field | Default | Description |
|---|---:|---|
| `enableEditing` | `false` | Enables the Host write endpoint; this bundle patch explicitly sets it to `true`. |
| `maxContextBytes` | `65536` | Explorer preflight maximum for selected-text UTF-8 bytes, range 1024–1048576; path-only contexts submit no file bytes. |
| `maxPromptContextBytes` | `69632` | Host maximum for the complete rendered context, including the `<opened_file>...</opened_file>` or `<selection>...</selection>` envelope and any selected text, range 4096–2097152. |
| `maxContextSourceBytes` | `10485760` | Maximum raw source bytes read for clean revision verification, range 1024–104857600. Dirty or truncated selections use the submitted browser text instead. |
| `maxEditableBytes` | `1048576` | Maximum UTF-8 bytes saved for one file, range 1024–10485760. |
| `maxEntryNameBytes` | `255` | Maximum UTF-8 bytes allowed for one new or renamed entry name, range 1–1024. |
| `maxEntriesPerDirectory` | `1000` | Maximum entries returned for one directory, range 1–10000. |
| `maxMutationBodyBytes` | `4096` | Maximum JSON bytes accepted by create and rename requests, range 128–65536. |
| `maxPreviewBytes` | `1048576` | Maximum bytes read and returned for one file, range 1024–10485760. |

Edit the bundle's `cordis.patch.yml` to change these values. To prevent pnpm from reusing an installed local `file:` copy, run `uninstall.sh`, then `install.sh`, and finally restart the Web process.

## Security boundary

Host endpoints accept only registered Workspace IDs and relative paths. Every read or write resolves the real path and confirms that the target remains under the canonical Workspace root, preventing access through `..`, absolute paths, or symbolic links that leave the Workspace. The endpoints also enforce Host, Origin, and Fetch-Metadata source checks equivalent in purpose to the built-in `/api` routes.

The write endpoint accepts `PUT` only when `enableEditing` is enabled, and the body must be bounded UTF-8 text. The Host enforces the complete byte bound while receiving the stream and validates a supplied `Content-Length`. Requests must carry the read-time revision in `If-Match`; a mismatch returns a conflict without overwriting disk. The target must be an existing regular file reached without any symbolic link. The create and rename entry endpoints follow the same containment checks, require single-segment names, refuse existing targets, and avoid overwriting unrelated paths. The Host commits file writes through a same-directory temporary file, file synchronization, and atomic rename while preserving the original permission mode when possible.

Editor context accepts only a relative path in a Workspace that owns the current Session either through its membership projection or through the Session's canonical cwd. A selection context carries the exact primary editor selection and its range; a path-only context carries no file bytes and renders as the fixed `<opened_file>...</opened_file>` envelope. The Host rejects symbolic links, validates clean selections against their disk revision, renders selected text as the fixed `<selection>...</selection>` envelope, and returns the rendered text to the plugin's send bridge. The bridge prepends that text to the direct prompt, so the ordinary Session log records the exact model-visible context. The browser conversation view folds that same envelope into a compact row above the bubble, showing only the file name and line/column range; path mode still remains file-content-free. Clean-selection disk verification reads at most 10 MiB; a preview truncated by `maxPreviewBytes` submits visible selection text with browser authority instead. History renders the logged user message and does not reread the current editor or disk.

These constraints govern only the explorer's file endpoints and Composer context. They do not change Agent permission policy, sandboxing, or tool capability. The endpoints provide application-level path-containment checks for trusted local UI use; they do not replace Harness kernel-level isolation against malicious concurrent local code.

## Project structure

```text
.
├── package.json                         # Installable bundle manifest
├── cordis.patch.yml                     # Disables the built-in root layout and mounts this plugin
├── install.sh
├── uninstall.sh
└── packages/client/ui-workspace-explorer-layout/
    ├── package.json
    ├── THIRD_PARTY_NOTICES.md           # Licenses for bundled editor dependencies
    ├── pnpm-lock.yaml                   # Independent browser-build dependency lock
    ├── tsdown.config.mjs                # Bundles CodeMirror into one Client artifact
    ├── src/client/index.js              # Browser source
    └── lib/
        ├── index.js                     # Host: bounded Workspace read, save, create, and rename API
        ├── invariant.js
        └── client.js                    # Prebuilt four-pane layout, file tree, multi-tab preview, and editor
```

CodeMirror and its language modules are bundled into the prebuilt plain-JavaScript Client artifact, so installation does not run project builds or tests. To maintain the source, run `pnpm install --ignore-workspace --config.auto-install-peers=false` in the inner package and then run `pnpm bundle` to regenerate `lib/client.js`.

## Compatibility

This version targets a DeepSeek Harness `0.1.x` checkout that provides the existing `conversation.input.dock` Slot, the session input resolver, and the conversation send service. The editor-context behavior is implemented entirely by this bundle; it does not require modified Harness source or a structured Composer-context core extension. The send bridge intentionally adapts the concrete 0.1.x `sendSession`, input-submit, and queue-steer seams because those operations are not public cross-package contracts; a future Harness release may require a bundle-only bridge update. A higher-priority profile or home patch that re-enables `ui-layout` competes for the root Slot; retain this bundle layer's `ui-layout` disable entry.
