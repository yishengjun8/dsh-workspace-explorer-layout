# @deepseek-ai/dsh-client-ui-workspace-explorer-layout

English | [中文](README.zh.md)

Dual-platform implementation package for the `@deepseek-ai/dsh-workspace-explorer-layout` bundle.

- The Node/Host entry `lib/index.js` registers `/workspace-explorer-layout/api`, lists directories by Workspace ID, reads bounded UTF-8 files, authorizes the current Session by membership or canonical cwd, and, when explicitly enabled, saves existing regular files, creates files and folders, and renames existing files and folders through revision validation, single-segment name checks, and atomic replacement.
- The Browser entry `lib/client.js` provides the compatible `ctx.layout` service, occupies the root Slot, continues to declare `sidebar`, `conversation`, `details`, and `shell.overlay`, adds the file tree and CodeMirror 6 browser/editor to the root layout, opens files in per-Session preview tabs with drag reorder, close `X`, tree reveal, and per-tab scroll restore, lets the opened Explorer keep expanding up to 80% of the visible layout while the chat column keeps shrinking, adds file and folder create actions plus `F2` rename in the tree, and registers an Explorer toggle immediately above Settings in `sidebar.footer.action`.
- The Browser entry also registers a non-editable editor-context row in the existing `conversation.input.dock` Slot. Its prefix shows the open path and primary CodeMirror range, stays outside the draft, tracks the composer card width when the column narrows, sits slightly taller, nudges the icon and label a little to the right, and can be toggled between active and persistently gray per Session. The row also provides a context-only send action when the editable draft is empty.
- The file tree's leading type badge is tinted by file-type color group (directory, TypeScript, JavaScript, JSON, markup, styles, Markdown, log, Python, shell, config, C-family, other, blocked). The browser Settings page gains a dedicated 资源管理器设置 section grouping every explorer preference in one place: the file-tree row height and chat font size sliders, and the per-group color scheme with instant preview; groups left unset fall back to their defaults, and single resets restore the sizes or all colors.
- `lib/invariant.js` declares the package invariant companion; every Host request enforces path containment and write eligibility.

The layout provider intentionally does not hard-inject `conversation`: the conversation plugin consumes `layout`, so the bundle uses a child injection after activation to patch the existing `sendSession` seam and to register the editor row in `conversation.input.dock`, without creating an activation cycle.

Install this package through its outer bundle rather than adding it to a profile directly. See `THIRD_PARTY_NOTICES.md` for licenses covering third-party code in the prebuilt Client bundle.

## Known Limitations and Deferred Work

The editor-context bridge adapts the concrete Harness 0.1.x `sendSession`, input-submit, and queue-steer implementations because the public cross-package faces do not carry arbitrary Composer context. These seams are kept behind this package and are restored on unload; a future Harness release may require updating only this bundle. Layout state, expanded directories, editor selection, and the workspace draft cache remain page-memory state; preview tabs and per-tab scroll positions are persisted and restored across reloads.

## Model Experience

When the prefix is active and the primary CodeMirror selection is non-empty, each send captures that exact selected text, its normalized workspace path, and its range, then renders it as a `<selection>...</selection>` envelope. When the selection is empty, each send captures only the open file path and renders the fixed `<opened_file>...</opened_file>` envelope; it never submits the full file. The Browser bridge prepends the rendered text to the direct user prompt so the ordinary `user/message` record contains the exact model-visible context. The conversation view folds that same envelope into a compact row above the bubble, showing the file name and the line/column range, and hovering that row reveals the full injected XML. Gray prefixes contribute no context. The same context is intentionally recorded again on each later active turn.

#### Token and KV cache effect

Selection contexts add the selected text plus the `<selection>...</selection>` envelope to input tokens. The Explorer preflights selected text against its default 65,536-byte UTF-8 limit; the Host independently bounds the complete rendering at 69,632 bytes by default and reads at most 10 MiB for clean revision verification. Truncated previews use browser-authoritative selection text. Path-only contexts add only the `<opened_file>...</opened_file>` envelope and no file bytes. Every active turn has its own logged prompt text, so repeated selections may increase prompt tokens until compaction.
