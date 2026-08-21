import React from 'react'
import { createPortal } from 'react-dom'
import { createSnapshotStore, defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, panels } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeSearchPanel, findNext, findPrevious, gotoLine, highlightSelectionMatches, openSearchPanel, search, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { bracketMatching, defaultHighlightStyle, foldable, foldEffect, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting, StreamLanguage, unfoldAll } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { php } from '@codemirror/lang-php'
import { go } from '@codemirror/lang-go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { clike } from '@codemirror/legacy-modes/mode/clike'

const { Fragment, createElement: h, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const PACKAGE_ID = '@deepseek-ai/dsh-client-ui-workspace-explorer-layout'
const API_PREFIX = '/workspace-explorer-layout/api'
const EDITOR_CONTEXT_PROVIDER = 'workspace-editor-context'
const SEND_SESSION_BRIDGE_MARKER = Symbol('workspace-explorer-layout.send-session-bridge')
const PREVIEW_SESSION_STORE_KEY = 'dsh.workspace.explorer.preview-sessions.v1'
const PREVIEW_SESSION_MAX = 25
const SIDEBAR_DEFAULT = 280, SIDEBAR_COLLAPSED = 56, SIDEBAR_MIN = 240, SIDEBAR_MAX_RATIO = 0.8, SIDEBAR_MAX_FALLBACK = 420
const EXPLORER_MAX_RATIO = 0.8
const TREE_DEFAULT = 280, TREE_MIN = 220, TREE_MAX = 520
const PREVIEW_DEFAULT = 420, PREVIEW_MIN = 280, PREVIEW_MAX = 760, RESIZE_STEP = 12
const CONTEXT_MENU_WIDTH = 176, CONTEXT_MENU_HEIGHT = 150
const ROW_HEIGHT_DEFAULT = 28, ROW_HEIGHT_MIN = 20, ROW_HEIGHT_MAX = 48
const CHAT_FONT_SIZE_DEFAULT = 16, CHAT_FONT_SIZE_MIN = 13, CHAT_FONT_SIZE_MAX = 20
/* Whether search results show each file's matched rows expanded by default;
 * the explorer settings page lets the user choose (default: expanded). */
const SEARCH_MATCH_EXPAND_DEFAULT = true
const EXPLORER_SETTINGS_STORE_KEY = 'dsh.workspace.explorer.settings.v1'
const EXPLORER_LAYOUT_STORE_KEY = 'dsh.workspace.explorer.layout.v1'

/* File encodings offered by the right-click encoding actions. The server owns
 * the authoritative list (/api/encodings); this fallback mirrors it so the
 * menu and badge work even before (or without) the fetch succeeding. */
const ENCODING_FALLBACK = Object.freeze([
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-bom', label: 'UTF-8（带 BOM）' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'gbk', label: 'GBK' },
  { id: 'gb18030', label: 'GB18030' },
  { id: 'big5', label: 'Big5' },
  { id: 'shift_jis', label: 'Shift_JIS' },
  { id: 'euc-jp', label: 'EUC-JP' },
  { id: 'euc-kr', label: 'EUC-KR' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（Latin-1）' },
  { id: 'windows-1252', label: 'Windows-1252' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）' },
  { id: 'ascii', label: 'ASCII' },
])
const ENCODING_LABEL_FALLBACK = Object.fromEntries(ENCODING_FALLBACK.map(encoding => [encoding.id, encoding.label]))
let encodingCache = ENCODING_FALLBACK
/* Fetch the server's authoritative encoding list once; keep the fallback if
 * the request fails so the encoding actions never dead-end. */
async function fetchEncodings() {
  try {
    const response = await fetch(`${API_PREFIX}/encodings`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' })
    if (!response.ok) return encodingCache
    const payload = await response.json()
    const list = Array.isArray(payload?.encodings)
      ? payload.encodings.filter(encoding => typeof encoding?.id === 'string' && typeof encoding?.label === 'string')
      : []
    if (list.length > 0) encodingCache = list
  } catch {
    // keep the built-in fallback
  }
  return encodingCache
}
function encodingLabel(id) {
  const found = encodingCache.find(encoding => encoding.id === id)
  if (found !== undefined) return found.label
  return ENCODING_LABEL_FALLBACK[id] ?? String(id ?? '')
}

const styles = `
.dsh-wel-viewport{height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-wel-frame{--dsh-wel-sidebar:280px;--dsh-wel-preview:420px;position:relative;display:grid;grid-template-columns:var(--dsh-wel-sidebar) var(--dsh-wel-preview) minmax(0,1fr);grid-template-rows:100%;width:100%;min-width:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-wel-frame[data-resizing]{transition:none;user-select:none}.dsh-wel-sidebar,.dsh-wel-tree,.dsh-wel-preview,.dsh-wel-chat{min-width:0;height:100%;overflow:hidden}.dsh-wel-sidebar{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}
.dsh-wel-tree,.dsh-wel-preview{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-wel-frame[data-explorer-closed] .dsh-wel-tree,.dsh-wel-frame[data-explorer-closed] .dsh-wel-preview{visibility:hidden;pointer-events:none;border-right:0}.dsh-wel-chat{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
.dsh-wel-panel-header{display:flex;align-items:center;gap:8px;min-height:52px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}.dsh-wel-panel-title{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.dsh-wel-panel-title strong{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-panel-title>span{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
/* Preview page top rows (file tabs + active-file name) share the harness left
   sidebar fill so the file browsing page reads as one band with the sidebar. */
.dsh-wel-preview .dsh-wel-panel-header{background:var(--dsw-specific-sidebar-fill)}
.dsh-wel-panel-actions{display:flex;flex:none;align-items:center;gap:2px}.dsh-wel-icon-button,.dsh-wel-text-button{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsh-wel-icon-button{width:30px;padding:0;font-size:18px}.dsh-wel-icon-button svg{display:block;width:16px;height:16px}.dsh-wel-icon-button:hover,.dsh-wel-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-icon-button:disabled,.dsh-wel-text-button:disabled{cursor:not-allowed;opacity:.55}
.dsh-wel-icon-button:focus-visible,.dsh-wel-text-button:focus-visible,.dsh-wel-tree-row:focus-visible,.dsh-wel-preview-tab-button:focus-visible,.dsh-wel-preview-tab-close:focus-visible,.dsh-wel-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-tree-scroll{flex:1;min-height:0;overflow:auto;padding:8px 6px 16px}.dsh-wel-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-wel-row-height,28px);padding:0 7px 0 calc(7px + var(--dsh-wel-depth,0) * 15px);border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-wel-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-tree-row[data-selected]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-wel-tree-row:disabled{cursor:not-allowed;opacity:.55}
.dsh-wel-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 12px;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-wel-file-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;border-radius:4px;background:color-mix(in srgb,var(--dsh-wel-file-accent,var(--dsw-alias-label-tertiary)) 16%,transparent);color:var(--dsh-wel-file-accent,var(--dsw-alias-label-tertiary));font-size:8px;font-weight:600;text-transform:uppercase}.dsh-wel-file-mark[data-group='directory']{--dsh-wel-file-accent:var(--dsh-wel-file-directory,#3b82f6)}.dsh-wel-file-mark[data-group='typescript']{--dsh-wel-file-accent:var(--dsh-wel-file-typescript,#3178c6)}.dsh-wel-file-mark[data-group='javascript']{--dsh-wel-file-accent:var(--dsh-wel-file-javascript,#e5c158)}.dsh-wel-file-mark[data-group='json']{--dsh-wel-file-accent:var(--dsh-wel-file-json,#e07a3c)}.dsh-wel-file-mark[data-group='markup']{--dsh-wel-file-accent:var(--dsh-wel-file-markup,#e04a3c)}.dsh-wel-file-mark[data-group='style']{--dsh-wel-file-accent:var(--dsh-wel-file-style,#a855f7)}.dsh-wel-file-mark[data-group='markdown']{--dsh-wel-file-accent:var(--dsh-wel-file-markdown,#12a5a0)}.dsh-wel-file-mark[data-group='log']{--dsh-wel-file-accent:var(--dsh-wel-file-log,#d99a2b)}.dsh-wel-file-mark[data-group='python']{--dsh-wel-file-accent:var(--dsh-wel-file-python,#4b8bb8)}.dsh-wel-file-mark[data-group='shell']{--dsh-wel-file-accent:var(--dsh-wel-file-shell,#22a06b)}.dsh-wel-file-mark[data-group='config']{--dsh-wel-file-accent:var(--dsh-wel-file-config,#8a95a5)}.dsh-wel-file-mark[data-group='c-family']{--dsh-wel-file-accent:var(--dsh-wel-file-c-family,#5a7ba6)}.dsh-wel-file-mark[data-group='csharp']{--dsh-wel-file-accent:var(--dsh-wel-file-csharp,#a25fd0)}.dsh-wel-file-mark[data-group='other']{--dsh-wel-file-accent:var(--dsh-wel-file-other,#9aa3ad)}.dsh-wel-file-mark[data-group='blocked']{--dsh-wel-file-accent:var(--dsh-wel-file-blocked,#e5484d)}.dsh-wel-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-symlink{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-wel-tree-status{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-wel-tree-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-wel-empty{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}
.dsh-wel-preview-header-meta{display:flex;align-items:center;gap:6px;min-width:0}.dsh-wel-preview-header-meta>span:not(.dsh-wel-language):not(.dsh-wel-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-language{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-wel-encoding{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-wel-dirty{color:var(--dsw-alias-state-warn-label);font-size:12px}.dsh-wel-preview-tabs{display:flex;align-items:stretch;gap:4px;min-width:0;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.dsh-wel-preview-tab{flex:none;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;height:28px;padding:0 5px 0 9px;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:grab;box-sizing:border-box;white-space:nowrap}.dsh-wel-preview-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-preview-tab[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-wel-preview-tab[data-dragging]{opacity:.7}.dsh-wel-preview-drop-indicator{flex:none;width:3px;height:20px;border-radius:2px;background:var(--dsw-alias-state-business-primary);align-self:center;pointer-events:none}.dsh-wel-preview-tab-button{display:flex;flex:1;align-items:center;gap:5px;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-wel-preview-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-wel-preview-tab-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}.dsh-wel-preview-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.dsh-wel-preview-tab-close:disabled{cursor:not-allowed;opacity:.45}.dsh-wel-preview-body{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block)}.dsh-wel-editor-host{height:100%;min-width:0}.dsh-wel-editor-host .cm-editor{height:100%;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-scroller{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:19px;overflow:auto}.dsh-wel-editor-host .cm-gutters{background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-wel-editor-host .cm-activeLine,.dsh-wel-editor-host .cm-activeLineGutter{background:var(--dsw-alias-interactive-bg-hover)}.dsh-wel-editor-host .cm-selectionBackground,.dsh-wel-editor-host .cm-content ::selection{background:var(--dsw-alias-interactive-bg-active)!important}.dsh-wel-editor-host .cm-cursor{border-left-color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-foldPlaceholder{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.dsh-wel-editor-host .cm-panels{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-panel input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-wel-context-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:min(var(--dsh-composer-card-max-width),max(0px,calc(100% - (var(--dsh-composer-side-clearance) * 2))));margin:0 auto;padding:0}.dsh-wel-context-prefix{display:flex;flex:1;align-items:center;gap:6px;min-width:0;min-height:28px;padding:5px 8px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}.dsh-wel-context-prefix:hover{color:var(--dsw-alias-label-primary)}.dsh-wel-context-prefix:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-wel-context-prefix[data-inactive]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);filter:grayscale(1)}.dsh-wel-context-prefix-mark{flex:none;font-size:12px}.dsh-wel-context-prefix-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-message-context-summary{box-sizing:border-box;display:flex;align-items:center;align-self:flex-end;gap:6px;max-width:100%;min-height:24px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.dsh-wel-message-context-summary-mark{flex:none;font-size:12px}.dsh-wel-message-context-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-message-context-summary-range{flex:none;color:var(--dsw-alias-label-caption)}.dsh-wel-message-context-bubble[data-dsh-wel-empty-prompt]{display:none}
.dsh-wel-banner{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}.dsh-wel-banner-actions{display:flex;gap:6px;margin-top:5px}.dsh-wel-status{padding:5px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-wel-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-wel-error-card{max-width:300px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;text-align:left}.dsh-wel-dialog-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));box-sizing:border-box}.dsh-wel-dialog{width:min(360px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-wel-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-wel-dialog-title{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-dialog-body{display:flex;flex-direction:column;gap:8px;padding:14px}.dsh-wel-dialog-input{width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}.dsh-wel-dialog-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dsh-wel-dialog-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-wel-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 14px 14px}
.dsh-wel-frame [data-slot='sidebar.footer.action']{display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0}.dsh-wel-explorer-toggle{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}.dsh-wel-explorer-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-explorer-toggle[data-open]{color:var(--dsw-alias-brand-primary)}.dsh-wel-explorer-toggle[data-rail]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-wel-explorer-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-explorer-icon{flex:none;width:16px;height:16px}.dsh-wel-explorer-toggle[data-rail] .dsh-wel-explorer-icon{width:18px;height:18px}.dsh-wel-explorer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-splitter{position:absolute;top:0;bottom:0;z-index:8;width:8px;margin-left:-4px;border:0;background:transparent;cursor:col-resize;touch-action:none}.dsh-wel-splitter::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-wel-splitter:hover::after,.dsh-wel-splitter[data-dragging]::after,.dsh-wel-splitter:focus-visible::after{background:var(--dsw-alias-state-business-primary)}.dsh-wel-details{position:absolute;z-index:16;top:0;right:0;bottom:0;width:min(440px,45vw);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px var(--dsw-alias-bg-mask-1));transform:translateX(0);opacity:1;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-wel-details[data-closed]{pointer-events:none;visibility:hidden;transform:translateX(100%);opacity:0}.dsh-wel-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.dsh-wel-overlay>*{pointer-events:auto}.dsh-wel-tree{position:relative}.dsh-wel-context-menu{position:fixed;z-index:40;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-wel-context-item{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:30px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-wel-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-context-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-context-item:disabled{cursor:not-allowed;opacity:.5}.dsh-wel-context-item:disabled:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsh-wel-context-separator{height:1px;margin:4px 0;border:0;background:var(--dsw-alias-border-l2)}.dsh-wel-copy-notice{position:absolute;right:10px;bottom:10px;z-index:12;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}@media(prefers-reduced-motion:reduce){.dsh-wel-frame,.dsh-wel-details,.dsh-wel-splitter::after{transition:none}}
.dsh-wel-search-header{flex-direction:column;align-items:stretch;gap:8px;padding:8px}
.dsh-wel-search-input-row{display:flex;align-items:center;gap:6px}
.dsh-wel-search-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}
.dsh-wel-search-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-search-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-wel-search-case{width:34px;padding:0;font-size:11px;font-weight:600}
.dsh-wel-icon-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-wel-text-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-summary{padding:8px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-wel-search-file{margin:2px 0}
.dsh-wel-search-file-header{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-wel-search-file-header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-file-count{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-wel-search-truncated{flex:none;color:var(--dsw-alias-state-warn-label);font-size:10px}
.dsh-wel-search-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:22px;padding:2px 7px 2px 18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-wel-search-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-line{flex:none;width:32px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;text-align:right}
.dsh-wel-search-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-search-hit{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-radius:2px}
.dsh-wel-settings-row{display:flex;align-items:center;gap:10px}.dsh-wel-settings-label{flex:none;min-width:64px;color:var(--dsw-alias-label-primary);font-size:13px}.dsh-wel-settings-slider{flex:1;min-width:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-wel-settings-value{flex:none;min-width:48px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}.dsh-wel-settings-hint{padding:0 14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-wel-explorer-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px}.dsh-wel-explorer-settings .dsh-wel-settings-label{min-width:88px}.dsh-wel-explorer-settings .dsh-wel-settings-slider{max-width:320px}.dsh-wel-explorer-settings .dsh-wel-settings-hint{padding:0}.dsh-wel-explorer-divider{height:1px;margin:0;border:0;background:var(--dsw-alias-border-l2)}.dsh-wel-file-colors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px}.dsh-wel-file-colors-title{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}.dsh-wel-file-color-row{display:flex;align-items:center;gap:10px;min-height:26px}.dsh-wel-file-color-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsh-wel-file-color-input{flex:none;width:32px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer;box-sizing:border-box}.dsh-wel-file-color-input::-webkit-color-swatch-wrapper{padding:2px}.dsh-wel-file-color-input::-webkit-color-swatch{border:0;border-radius:2px}.dsh-wel-file-color-reset{flex:none;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:24px;cursor:pointer}.dsh-wel-file-color-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-file-color-reset:disabled{cursor:not-allowed;opacity:.55}.dsh-wel-file-colors-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding-top:2px}
.dsh-wel-chat{--dsw-font-markdown-h1:700 calc(24px * var(--dsh-wel-chat-font-scale,1)) / calc(34px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h2:700 calc(22px * var(--dsh-wel-chat-font-scale,1)) / calc(32px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h3:700 calc(20px * var(--dsh-wel-chat-font-scale,1)) / calc(30px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h4:600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base:calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong:600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-italic:italic calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong-italic:italic 600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table:calc(15px * var(--dsh-wel-chat-font-scale,1)) / calc(25px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table-head:500 calc(15px * var(--dsh-wel-chat-font-scale,1)) / calc(25px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-code:calc(14px * var(--dsh-wel-chat-font-scale,1)) / calc(22px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block:calc(13px * var(--dsh-wel-chat-font-scale,1)) / calc(22px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block-small:calc(12px * var(--dsh-wel-chat-font-scale,1)) / calc(18px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code)}
.dsh-wel-chat [data-chat-flow-kind='user'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-wel-chat [data-chat-flow-kind='steering'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-wel-chat [data-pending-steering] > div:first-child > div:last-child{font-size:calc(16px * var(--dsh-wel-chat-font-scale,1));line-height:calc(24px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-tool],.dsh-wel-chat [data-sample='bash'],.dsh-wel-chat [data-variant='think']{font-size:calc(14px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-tool] [data-disclosure-row] :is(span,button),.dsh-wel-chat [data-sample='bash'] span,.dsh-wel-chat [data-variant='think'] span,.dsh-wel-chat [data-variant='think'] > div > div{font-size:1em}
.dsh-wel-chat [data-chat-flow]{gap:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] [data-slot='conversation.chat.node'] > div > div{gap:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] p:not(li p),.dsh-wel-chat [data-chat-flow-kind='assistant-step'] :where(ul,ol,h4,h5,h6,pre){margin-top:calc(12px * var(--dsh-wel-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] :where(h1,h2,h3){margin-top:calc(24px * var(--dsh-wel-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] hr{margin:calc(24px * var(--dsh-wel-chat-font-scale,1)) 0}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] blockquote{margin-top:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] li:not(:first-child){margin-top:calc(4px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] li > p{margin:calc(6px * var(--dsh-wel-chat-font-scale,1)) 0}
.dsh-wel-preview-tab-close[data-pinned]{color:var(--dsw-alias-state-business-primary);width:22px;height:22px}
.dsh-wel-preview-tab-close[data-pinned] svg{display:block;width:18px;height:18px}
.dsh-wel-highlight-preset-select{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}.dsh-wel-highlight-preset-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#0451a5;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#4ec9b0;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#ce9178;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-wel-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#b4452c;--shiki-token-string:#8a5a00;--shiki-token-comment:#a06a4a;--shiki-token-keyword:#c2410c;--shiki-token-parameter:#d97706;--shiki-token-function:#be185d;--shiki-token-string-expression:#9a3412;--shiki-token-punctuation:#6b4a3f;--shiki-token-link:#9a3412}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#ff8a65;--shiki-token-string:#ffd54f;--shiki-token-comment:#c8a48c;--shiki-token-keyword:#ff9e6d;--shiki-token-parameter:#ffb74d;--shiki-token-function:#f472b6;--shiki-token-string-expression:#ffcc80;--shiki-token-punctuation:#e0c8bb;--shiki-token-link:#ffab91}
.dsh-wel-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#1971c2;--shiki-token-string:#0f766e;--shiki-token-comment:#6f7d94;--shiki-token-keyword:#364fc7;--shiki-token-parameter:#0b7285;--shiki-token-function:#7048e8;--shiki-token-string-expression:#099268;--shiki-token-punctuation:#49576b;--shiki-token-link:#1c7ed6}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#4dabf7;--shiki-token-string:#38d9a9;--shiki-token-comment:#8fa3c2;--shiki-token-keyword:#91a7ff;--shiki-token-parameter:#22b8cf;--shiki-token-function:#b197fc;--shiki-token-string-expression:#63e6be;--shiki-token-punctuation:#b6c2d6;--shiki-token-link:#74c0fc}
.dsh-wel-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#3f3f3f;--shiki-token-string:#2e2e2e;--shiki-token-comment:#9d9d9d;--shiki-token-keyword:#e8590c;--shiki-token-parameter:#565656;--shiki-token-function:#7a7a7a;--shiki-token-string-expression:#4a4a4a;--shiki-token-punctuation:#8a8a8a;--shiki-token-link:#a0a0a0}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#d0d0d0;--shiki-token-string:#e2e2e2;--shiki-token-comment:#6e6e6e;--shiki-token-keyword:#ffa94d;--shiki-token-parameter:#a8a8a8;--shiki-token-function:#bfbfbf;--shiki-token-string-expression:#cfcfcf;--shiki-token-punctuation:#8f8f8f;--shiki-token-link:#7d7d7d}
/* VS Code default theme (Light+/Dark+) XML palette: tag names ride the
   function token (tagName -> typeName), attribute names the parameter token
   (attributeName -> propertyName), values/entities the string token, and the
   two extra vars cover angle brackets and entity characters. */
.dsh-wel-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#008000;--shiki-token-function:#800000;--shiki-token-parameter:#e50000;--shiki-token-string:#a31515;--shiki-token-string-expression:#0000ff;--dsh-wel-token-xml-punctuation:#800000;--dsh-wel-token-xml-entity:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#6A9955;--shiki-token-function:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-string:#ce9178;--shiki-token-string-expression:#569cd6;--dsh-wel-token-xml-punctuation:#808080;--dsh-wel-token-xml-entity:#569cd6}
/* VS Code default theme (Light+/Dark+) shared token palette: one rule serves
   every non-XML vscode-* preset, since VS Code colors all languages with the
   same theme. */
.dsh-wel-editor-host[data-highlight-preset='vscode-python'],.dsh-wel-editor-host[data-highlight-preset='vscode-json'],.dsh-wel-editor-host[data-highlight-preset='vscode-typescript'],.dsh-wel-editor-host[data-highlight-preset='vscode-javascript'],.dsh-wel-editor-host[data-highlight-preset='vscode-css'],.dsh-wel-editor-host[data-highlight-preset='vscode-markdown'],.dsh-wel-editor-host[data-highlight-preset='vscode-shell'],.dsh-wel-editor-host[data-highlight-preset='vscode-config'],.dsh-wel-editor-host[data-highlight-preset='vscode-cpp'],.dsh-wel-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#795e26;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-python'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-json'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-typescript'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-javascript'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-css'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-markdown'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-shell'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-config'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-cpp'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#b5cea8;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#dcdcaa;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-wel-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#000000;--shiki-token-function:#2b91af;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#b5cea8;--shiki-token-string:#d69d85;--shiki-token-comment:#57a64a;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#dcdcdc;--shiki-token-function:#4ec9b0;--shiki-token-string-expression:#d69d85;--shiki-token-punctuation:#b4b4b4;--shiki-token-link:#569cd6}
/* Preprocessor directive color (C# #if/#region, ...): purple on both themes,
   lighter in dark for contrast; overridable per preset. */
.dsh-wel-editor-host{--dsh-wel-token-directive:#8e44ad}
body[data-ds-dark-theme] .dsh-wel-editor-host{--dsh-wel-token-directive:#c586c0}
/* Sidebar top actions: the harness New Session button (the root div's only
   direct button) is hidden and the plugin draws its own two-button row —
   New Session / workspace files — in the same flow position. */
.dsh-wel-frame [data-slot="sidebar"] > div > button{display:none}
.dsh-wel-sidebar-top-actions{flex:none;min-width:0;display:flex;align-items:stretch;gap:6px;height:38px;margin:0 2px 8px;box-sizing:border-box}
.dsh-wel-sidebar-top-action{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden;white-space:nowrap}
.dsh-wel-sidebar-top-action:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-wel-sidebar-top-action[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary)}
.dsh-wel-sidebar-top-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-wel-sidebar-top-icon{flex:none;width:14px;height:14px}
.dsh-wel-sidebar-top-icon svg{display:block;width:100%;height:100%}
.dsh-wel-sidebar-top-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed rail: the two controls become icon-only 36px buttons, stacked. */
.dsh-wel-sidebar-top-actions[data-rail]{flex-direction:column;align-items:flex-start;gap:0;height:auto;margin:0 0 12px;position:relative;z-index:10}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-action{flex:none;width:36px;height:36px;padding:0;gap:0;border-color:transparent;background:transparent}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-icon{width:18px;height:18px}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-label{display:none}
/* Collapsed rail: hide the harness workspace browser's rail controls (search
   + add workspace) — the plugin's two nav tabs are the only region icons. */
.dsh-wel-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"] > *{display:none}
/* Sidebar files region: the harness workspace browser is hidden while the
   plugin's file tree fills the region seat (fused into the sidebar). */
.dsh-wel-sidebar-files{display:none}
.dsh-wel-frame[data-sidebar-files] [data-slot="sidebar.workspaces"] > :not(.dsh-wel-sidebar-files){display:none}
/* The sidebar shell hides nested scrollbars until the pointer is over the
   column (quietBars); the file list is scroll-heavy, so its scrollbar stays
   visible. The files panel is inset 12px on both sides (the harness region
   otherwise extends flush to the right edge) so it reads as a symmetric card. */
.dsh-wel-frame[data-sidebar-files] .dsh-wel-sidebar-files{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;margin-right:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-wel-frame[data-sidebar-files] .dsh-wel-sidebar-files .dsh-wel-tree{flex:1;min-height:0;height:auto;border-right:0}
/* CodeMirror search panel (Ctrl+F): rendered by panels({ topContainer }) into
   the .dsh-wel-preview-search strip between the status bar and the preview
   body, so the panel rules are scoped to that container. !important keeps the
   controls legible regardless of the harness's global control styles; the
   alias tokens adapt to the active GUI theme. Match marks live in the editor
   content, so they stay scoped to the editor host. */
.dsh-wel-preview-search{flex:none;min-width:0;background:var(--dsw-alias-bg-layer-1);user-select:none}
.dsh-wel-preview-search .cm-panels.cm-panels-top{background:var(--dsw-alias-bg-layer-1)!important;color:var(--dsw-alias-label-primary)!important;border-bottom:1px solid var(--dsw-alias-border-l2)!important}
.dsh-wel-preview-search .cm-panel.cm-search{padding:5px 36px 5px 6px}
.dsh-wel-preview-search .cm-panel.cm-search .cm-textfield{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:6px;background:var(--dsw-alias-bg-base)!important;color:var(--dsw-alias-label-primary)!important;font:inherit!important;font-size:12px!important;box-sizing:border-box;user-select:text}
.dsh-wel-preview-search .cm-panel.cm-search .cm-textfield:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-preview-search .cm-panel.cm-search .cm-button{height:26px;padding:0 8px;border:0!important;border-radius:6px;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font:inherit!important;font-size:12px!important;cursor:pointer}
.dsh-wel-preview-search .cm-panel.cm-search .cm-button:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
.dsh-wel-preview-search .cm-panel.cm-search label{display:inline-flex;align-items:center;gap:3px;height:28px;transform:translateY(3px);color:var(--dsw-alias-label-secondary)!important}
.dsh-wel-preview-search .cm-panel.cm-search input[type=checkbox]{margin:2px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-state-business-primary)}
.dsh-wel-preview-search .cm-panel.cm-search [name=close]{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:absolute!important;top:50%!important;right:4px!important;transform:translateY(-50%)!important;width:30px!important;height:30px!important;padding:0 0 2px!important;margin:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font-size:18px!important;line-height:1!important;cursor:pointer!important;box-sizing:border-box!important}
.dsh-wel-preview-search .cm-panel.cm-search [name=close]:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
/* The search field is wrapped (see CodeEditor) with a col-resize grip on its
   right edge so the user can drag it wider/narrower. */
.dsh-wel-preview-search .dsh-wel-search-field-wrap{display:inline-flex;align-items:center;vertical-align:middle}
.dsh-wel-preview-search .dsh-wel-search-field-wrap .cm-textfield{flex:none;min-width:60px}
.dsh-wel-preview-search .dsh-wel-search-resize{flex:none;width:6px;height:16px;margin:0 2px 0 4px;border-radius:3px;background:var(--dsw-alias-border-l2);cursor:col-resize;opacity:.65}
.dsh-wel-preview-search .dsh-wel-search-resize:hover{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-wel-preview-search .dsh-wel-search-resize:active{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-wel-editor-host .cm-searchMatch{background-color:var(--dsw-alias-state-business-tertiary)!important}
.dsh-wel-editor-host .cm-searchMatch-selected{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)!important}
.dsh-wel-editor-host .cm-selectionMatch{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)!important}
.dsh-wel-editor-host .cm-searchMatch .cm-selectionMatch{background-color:transparent!important}
.dsh-wel-drop-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);pointer-events:none}
.dsh-wel-drop-hint{display:inline-flex;align-items:center;padding:8px 14px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font-size:12px;box-shadow:var(--dsw-shadow-elevated,0 8px 24px rgba(0,0,0,.18))}
.dsh-wel-preview[data-drop-active] .dsh-wel-preview-tabs,.dsh-wel-preview[data-drop-active] .dsh-wel-panel-header,.dsh-wel-preview[data-drop-active] .dsh-wel-editor-host{pointer-events:none}
/* Hide the harness's full-viewport chat drop mask (ui-attachment DropOverlay,
   the only role="status" element portaled directly to body — verified against
   the harness tree; its Toast uses role="alert" and every other role="status"
   lives inside the app tree); the layout draws its own chat-confined mask
   below so the mask covers the chat pane instead of the whole page. */
body > [role="status"]{display:none!important}
.dsh-wel-chat-drop-mask{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(6px);pointer-events:none}
.dsh-wel-chat-drop-card{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-wel-chat-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-wel-chat-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Close button on the preview drop hint, matching the chat drop mask. */
.dsh-wel-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-wel-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Transient top-center banner matching the harness conversation Toast look
   (contrast fill, inverted label, slide-in, hold-and-fade) so a failed
   external-file open announces like the composer's image-intake rejections. */
.dsh-wel-toast{position:fixed;top:120px;left:50%;z-index:1100;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 48px));padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);animation:dsh-wel-toast-in 160ms ease-out,dsh-wel-toast-fade 1000ms ease 3000ms forwards}
.dsh-wel-toast-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.dsh-wel-toast-text{min-width:0}
@keyframes dsh-wel-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dsh-wel-toast-fade{to{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-wel-toast{animation:dsh-wel-toast-fade 1000ms ease 3000ms forwards}}
`

const tokenHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--shiki-token-comment)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--shiki-token-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--shiki-token-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.typeName, tags.className, tags.namespace], color: 'var(--shiki-token-function)' },
  // Name-definition tokens (class/namespace/type names in declaration
  // position) ride the type color; StreamLanguage emits these as
  // `variableName.definition`, which the bare variableName rule above does not
  // catch — without this they would fall through to the fallback highlighter.
  { tag: [tags.definition(tags.variableName), tags.definition(tags.typeName), tags.definition(tags.propertyName)], color: 'var(--shiki-token-function)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--shiki-token-parameter)' },
  { tag: [tags.heading, tags.link, tags.url], color: 'var(--shiki-token-link)' },
  // Preprocessor directives: purple via the directive variable, with a purple
  // fallback so a directive never silently renders as a string when the
  // variable is unavailable.
  { tag: tags.meta, color: 'var(--dsh-wel-token-directive, #8e44ad)' },
  { tag: [tags.inserted, tags.meta], color: 'var(--shiki-token-string-expression)' },
  { tag: tags.punctuation, color: 'var(--shiki-token-punctuation)' },
  // Markup (XML/HTML) tokens. angleBracket was unstyled and character already
  // rides the string color; the fallbacks preserve that unless a markup preset
  // (e.g. the VS Code XML preset) sets the override variables.
  { tag: tags.angleBracket, color: 'var(--dsh-wel-token-xml-punctuation, inherit)' },
  { tag: tags.character, color: 'var(--dsh-wel-token-xml-entity, var(--shiki-token-string))' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--dsw-alias-state-error-primary)' },
])

const PLAIN_LANGUAGE = Object.freeze({ label: 'text', extension: [] })
const language = (label, extension) => Object.freeze({ label, extension })
const JS_LANGUAGE = language('js', javascript())
const JSX_LANGUAGE = language('jsx', javascript({ jsx: true }))
const TS_LANGUAGE = language('ts', javascript({ typescript: true }))
const TSX_LANGUAGE = language('tsx', javascript({ typescript: true, jsx: true }))
const JSON_LANGUAGE = language('json', json())
const HTML_LANGUAGE = language('html', html())
const CSS_LANGUAGE = language('css', css())
const MARKDOWN_LANGUAGE = language('md', markdown())
const PYTHON_LANGUAGE = language('py', python())
const SQL_LANGUAGE = language('sql', sql())
const XML_LANGUAGE = language('xml', xml())
const YAML_LANGUAGE = language('yaml', yaml())
const C_LANGUAGE = language('c', cpp())
const CPP_LANGUAGE = language('c++', cpp())
const JAVA_LANGUAGE = language('java', java())
const RUST_LANGUAGE = language('rust', rust())
const PHP_LANGUAGE = language('php', php())
const GO_LANGUAGE = language('go', go())
const SHELL_LANGUAGE = language('sh', StreamLanguage.define(shell))
const POWERSHELL_LANGUAGE = language('powershell', StreamLanguage.define(powerShell))
const RUBY_LANGUAGE = language('ruby', StreamLanguage.define(ruby))
const TOML_LANGUAGE = language('toml', StreamLanguage.define(toml))
const DOCKER_LANGUAGE = language('docker', StreamLanguage.define(dockerFile))
const MAKE_LANGUAGE = language('make', [])
const TEXT_LANGUAGE = language('text', [])
const SCSS_LANGUAGE = language('scss', CSS_LANGUAGE.extension)
const LESS_LANGUAGE = language('less', CSS_LANGUAGE.extension)
const MDX_LANGUAGE = language('mdx', MARKDOWN_LANGUAGE.extension)
const INI_LANGUAGE = language('ini', [])
/* C# legacy mode: replicates the clike `csharp` export (keywords, types, and
   the @"..." verbatim-string hook) and adds the C/C++-style preprocessor hook
   so #if/#define/#region lines render as directives instead of plain
   identifiers (the shipped csharp export has no '#' hook). */
const csharpWords = (str) => {
  const obj = {}
  for (const word of str.split(' ')) obj[word] = true
  return obj
}
const csharpDirectiveHook = (stream, state) => {
  if (!state.startOfLine) return false
  let next = null
  for (let ch; (ch = stream.peek());) {
    if (ch === '\\' && stream.match(/^.$/)) { next = csharpDirectiveHook; break }
    if (ch === '/' && stream.match(/^\/[\/\*]/, false)) break
    stream.next()
  }
  state.tokenize = next
  return 'meta'
}
const csharpVerbatimString = (stream, state) => {
  let next
  while ((next = stream.next()) != null) {
    if (next === '"' && !stream.eat('"')) { state.tokenize = null; break }
  }
  return 'string'
}
const CSHARP_MODE = clike({
  name: 'csharp',
  keywords: csharpWords('abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in init interface internal is lock namespace new operator out override params private protected public readonly record ref required return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual void volatile while add alias ascending descending dynamic from get global group into join let orderby partial remove select set value var yield'),
  types: csharpWords('Action Boolean Byte Char DateTime DateTimeOffset Decimal Double Func Guid Int16 Int32 Int64 Object SByte Single String Task TimeSpan UInt16 UInt32 UInt64 bool byte char decimal double short int long object sbyte float string ushort uint ulong'),
  blockKeywords: csharpWords('catch class do else finally for foreach if struct switch try while'),
  defKeywords: csharpWords('class interface namespace record struct var'),
  typeFirstDefinitions: true,
  atoms: csharpWords('true false null'),
  hooks: {
    '@': (stream, state) => {
      if (stream.eat('"')) {
        state.tokenize = csharpVerbatimString
        return csharpVerbatimString(stream, state)
      }
      stream.eatWhile(/[\w$_]/)
      return 'meta'
    },
    '#': csharpDirectiveHook,
  },
})
const CS_LANGUAGE = language('cs', StreamLanguage.define(CSHARP_MODE))

const EXACT_LANGUAGES = Object.freeze({
  dockerfile: DOCKER_LANGUAGE,
  'dockerfile.dev': DOCKER_LANGUAGE,
  'dockerfile.prod': DOCKER_LANGUAGE,
  'dockerfile.test': DOCKER_LANGUAGE,
  makefile: MAKE_LANGUAGE,
  'package.json': JSON_LANGUAGE,
  'tsconfig.json': JSON_LANGUAGE,
  '.gitignore': TEXT_LANGUAGE,
  '.env': INI_LANGUAGE,
  license: TEXT_LANGUAGE,
})
const EXTENSION_LANGUAGES = Object.freeze({
  js: JS_LANGUAGE, mjs: JS_LANGUAGE, cjs: JS_LANGUAGE, jsx: JSX_LANGUAGE,
  ts: TS_LANGUAGE, mts: TS_LANGUAGE, cts: TS_LANGUAGE, tsx: TSX_LANGUAGE,
  json: JSON_LANGUAGE, jsonc: JS_LANGUAGE, html: HTML_LANGUAGE, htm: HTML_LANGUAGE,
  css: CSS_LANGUAGE, scss: SCSS_LANGUAGE, less: LESS_LANGUAGE,
  md: MARKDOWN_LANGUAGE, markdown: MARKDOWN_LANGUAGE, mdx: MDX_LANGUAGE,
  py: PYTHON_LANGUAGE, sql: SQL_LANGUAGE, xml: XML_LANGUAGE, svg: XML_LANGUAGE,
  yaml: YAML_LANGUAGE, yml: YAML_LANGUAGE,
  c: C_LANGUAGE, h: C_LANGUAGE, cc: CPP_LANGUAGE, cpp: CPP_LANGUAGE, cxx: CPP_LANGUAGE, hpp: CPP_LANGUAGE,
  java: JAVA_LANGUAGE, rs: RUST_LANGUAGE, php: PHP_LANGUAGE, go: GO_LANGUAGE,
  cs: CS_LANGUAGE, csx: CS_LANGUAGE,
  sh: SHELL_LANGUAGE, bash: SHELL_LANGUAGE, zsh: SHELL_LANGUAGE,
  ps1: POWERSHELL_LANGUAGE, psm1: POWERSHELL_LANGUAGE,
  rb: RUBY_LANGUAGE, toml: TOML_LANGUAGE, ini: INI_LANGUAGE, cfg: INI_LANGUAGE,
})

function languageFor(name) {
  const lower = name.toLowerCase()
  const exact = EXACT_LANGUAGES[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return EXTENSION_LANGUAGES[extension] ?? PLAIN_LANGUAGE
}

/* File-tree badge color groups. Each group owns one accent color used for the
   leading type badge (text + a translucent tint); users may recolor any group
   from the browser settings page, and an unset group falls back to its
   default. Directory and blocked entries are groups like any file type. */
const FILE_COLOR_GROUPS = Object.freeze([
  { group: 'directory', label: '目录', color: '#3b82f6' },
  { group: 'typescript', label: 'TypeScript', color: '#3178c6' },
  { group: 'javascript', label: 'JavaScript', color: '#e5c158' },
  { group: 'json', label: 'JSON', color: '#e07a3c' },
  { group: 'markup', label: 'HTML/XML', color: '#e04a3c' },
  { group: 'style', label: '样式', color: '#a855f7' },
  { group: 'markdown', label: 'Markdown', color: '#12a5a0' },
  { group: 'log', label: '日志', color: '#d99a2b' },
  { group: 'python', label: 'Python', color: '#4b8bb8' },
  { group: 'shell', label: 'Shell', color: '#22a06b' },
  { group: 'config', label: '配置文件', color: '#8a95a5' },
  { group: 'c-family', label: 'C/C++', color: '#5a7ba6' },
  { group: 'csharp', label: 'C#', color: '#a25fd0' },
  { group: 'other', label: '其他', color: '#9aa3ad' },
  { group: 'blocked', label: '受阻', color: '#e5484d' },
])
const DEFAULT_FILE_COLOR = '#9aa3ad'
const FILE_COLOR_DEFAULTS = Object.fromEntries(FILE_COLOR_GROUPS.map(({ group, color }) => [group, color]))
/** The accent color a group falls back to when the user has not set one. */
function fileColorDefault(group) {
  return FILE_COLOR_DEFAULTS[group] ?? DEFAULT_FILE_COLOR
}
/** Resolve one group's effective color: the user's customization, else the default. */
function fileColorOf(settings, group) {
  return settings?.fileColors?.[group] ?? fileColorDefault(group)
}

/* Extension -> color group. Mirrors EXTENSION_LANGUAGES so a file's badge and
   its editor highlighting stay on the same type; unknown suffixes land in
   'other'. */
const FILE_GROUP_BY_EXTENSION = Object.freeze({
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  css: 'style', scss: 'style', less: 'style',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  log: 'log',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', psm1: 'shell',
  yaml: 'config', yml: 'config', toml: 'config', ini: 'config', cfg: 'config', conf: 'config', env: 'config',
  c: 'c-family', h: 'c-family', cc: 'c-family', cpp: 'c-family', cxx: 'c-family', hpp: 'c-family',
  cs: 'csharp', csx: 'csharp',
})
/* Dot-less or conventionally-uppercase names that extension splitting would miss. */
const FILE_GROUP_BY_EXACT_NAME = Object.freeze({
  'package.json': 'json', 'tsconfig.json': 'json',
  '.gitignore': 'config', '.npmrc': 'config', '.editorconfig': 'config', '.env': 'config',
  'dockerfile': 'config', 'dockerfile.dev': 'config', 'dockerfile.prod': 'config', 'dockerfile.test': 'config',
  'makefile': 'config', 'license': 'config',
})
const DEFAULT_FILE_GROUP = 'other'
/** The color group one tree entry belongs to, from its kind and file name. */
function colorGroupOf(entry) {
  if (entry.kind === 'directory') return 'directory'
  if (entry.kind === 'blocked' || entry.kind === 'other') return 'blocked'
  const lower = String(entry.name).toLowerCase()
  const exact = FILE_GROUP_BY_EXACT_NAME[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return FILE_GROUP_BY_EXTENSION[extension] ?? DEFAULT_FILE_GROUP
}

/* Editor syntax-highlight presets. Each non-default preset overrides the
   --shiki-token-* variables on the editor host (light and dark variants via
   the body attribute), so the CodeMirror HighlightStyle keeps its single
   var() mapping and every palette stays theme-consistent. 'default' leaves
   the app theme's own shiki palette untouched. */
const HIGHLIGHT_PRESETS = Object.freeze([
  { id: 'default', label: '默认' },
  { id: 'classic', label: '经典' },
  { id: 'warm', label: '暖色' },
  { id: 'cool', label: '冷色' },
  { id: 'mono', label: '单色' },
  { id: 'vscode-xml', label: 'XML（VS Code）' },
  { id: 'vscode-python', label: 'Python（VS Code）' },
  { id: 'vscode-json', label: 'JSON（VS Code）' },
  { id: 'vscode-typescript', label: 'TypeScript（VS Code）' },
  { id: 'vscode-javascript', label: 'JavaScript（VS Code）' },
  { id: 'vscode-css', label: 'CSS（VS Code）' },
  { id: 'vscode-markdown', label: 'Markdown（VS Code）' },
  { id: 'vscode-shell', label: 'Shell（VS Code）' },
  { id: 'vscode-config', label: '配置（VS Code）' },
  { id: 'vscode-cpp', label: 'C/C++（VS Code）' },
  { id: 'vscode-csharp', label: 'C#（VS Code）' },
  { id: 'vs2022', label: 'Visual Studio 2022' },
])
const HIGHLIGHT_PRESET_DEFAULT = 'default'
/* Per-group default highlight presets. A group with no entry here and no user
   pick follows the app theme's shiki palette ('default'). */
const HIGHLIGHT_PRESET_DEFAULT_BY_GROUP = Object.freeze({
  markup: 'vscode-xml',
  python: 'vscode-python',
  json: 'vscode-json',
  typescript: 'vscode-typescript',
  javascript: 'vscode-javascript',
  style: 'vscode-css',
  markdown: 'vscode-markdown',
  shell: 'vscode-shell',
  config: 'vscode-config',
  'c-family': 'vscode-cpp',
  csharp: 'vs2022',
})
/** The preset a group falls back to when the user has not picked one. */
function highlightPresetDefaultFor(group) {
  return HIGHLIGHT_PRESET_DEFAULT_BY_GROUP[group] ?? HIGHLIGHT_PRESET_DEFAULT
}
/** The preset one file-type group resolves to: the user's pick, else the group's default. */
function highlightPresetOf(settings, group) {
  return settings?.highlightPresets?.[group] ?? highlightPresetDefaultFor(group)
}

function lineSeparator(value) {
  if (value === 'crlf' || value === '\r\n') return '\r\n'
  if (value === 'cr' || value === '\r') return '\r'
  return '\n'
}

const READ_ONLY_REASONS = Object.freeze({
  binary: '文件不是可编辑的文本文件',
  encoding: '文件编码不支持编辑',
  'unsupported-encoding': '文件编码不支持编辑',
  too_large: '文件过大，不能编辑',
  'too-large': '文件过大，不能编辑',
  'file-too-large': '文件超过可编辑大小限制',
  truncated: '文件内容已截断',
  'preview-truncated': '文件内容已截断',
  mixed_line_endings: '文件包含混合换行符，不能安全编辑',
  'mixed-line-endings': '文件包含混合换行符，不能安全编辑',
  permission: '当前工作区没有写入权限',
  readonly: '此文件为只读',
  'read-only': '此文件为只读',
  'editing-disabled': '当前配置未启用文件编辑',
  'symlink-path': '符号链接路径仅允许浏览',
  'external-file': '外部文件仅支持浏览',
})

function readOnlyReason(preview) {
  if (preview.truncated) return READ_ONLY_REASONS.truncated
  if (preview.lineEnding === 'mixed') return READ_ONLY_REASONS.mixed_line_endings
  if (preview.editable !== false && !preview.readOnlyReason) return null
  return READ_ONLY_REASONS[preview.readOnlyReason] ?? '此文件当前不能编辑'
}

const fileLabel = name => languageFor(name).label
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)))
function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes < 0) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }
// The preview pane only responds to "normal" (non-image) file drags; images
// belong to the chat composer. Empty MIME types are treated as normal files —
// the server decides text-likeness and a failure is silently ignored.
function isImageFile(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  return type.startsWith('image/')
}
// File-drag detection mirroring the harness composer's own check: the
// dataTransfer.types list is authoritative and stable during the whole drag,
// while dataTransfer.files is only guaranteed populated at drop time.
function hasDraggedFiles(event) {
  const dataTransfer = event?.dataTransfer
  if (dataTransfer === null || dataTransfer === undefined) return false
  if ((dataTransfer.files?.length ?? 0) > 0) return true
  try {
    return typeof dataTransfer.types?.includes === 'function' && dataTransfer.types.includes('Files')
  } catch {
    return false
  }
}
// Whether the drag carries at least one non-image file. During dragover the
// File objects may not be inspectable yet; then any file drag counts as
// "normal" (the drop itself still filters images and ignores them silently).
function hasNormalFile(event) {
  if (!hasDraggedFiles(event)) return false
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  for (const file of files) if (!isImageFile(file)) return true
  return false
}
// The persisted sidebar width lives with the explorer pane geometry
// (EXPLORER_LAYOUT_STORE_KEY): the live value rides the root layout store,
// which cannot persist its whole value (it also carries large file drafts), so
// the explorer pane store mirrors it on change and this rehydrates it on load.
// 0 means the sidebar is collapsed; missing or invalid persisted data falls
// back to the default width (render-time clamping still applies the viewport
// ceiling).
function readPersistedSidebarWidth() {
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT
  try {
    const raw = localStorage.getItem(EXPLORER_LAYOUT_STORE_KEY)
    if (raw === null) return SIDEBAR_DEFAULT
    const sidebar = JSON.parse(raw)?.sidebar
    if (sidebar === 0) return 0
    if (typeof sidebar === 'number' && Number.isFinite(sidebar)) return Math.max(SIDEBAR_MIN, Math.round(sidebar))
    return SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}
function createLayoutStore() {
  return defineStore({
    init: () => ({
      sidebar: readPersistedSidebarWidth(),
      detailsOpen: false,
      drafts: {},
      // Sidebar browsing region: 'sessions' shows the harness workspace/session
      // browser; 'files' swaps the same region for the workspace file tree.
      view: 'sessions',
    }),
    actions: {
      setSidebar: (draft, width, max = SIDEBAR_MAX_FALLBACK) => { draft.sidebar = clamp(width, SIDEBAR_MIN, max) },
      toggleSidebar: (draft) => { draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0 },
      openDetails: (draft) => { draft.detailsOpen = true },
      closeDetails: (draft) => { draft.detailsOpen = false },
      rememberDraft: (draft, workspaceId, value) => { draft.drafts[String(workspaceId)] = value },
      clearDraft: (draft, workspaceId) => { delete draft.drafts[String(workspaceId)] },
      setView: (draft, view) => { draft.view = view === 'files' ? 'files' : 'sessions' },
    },
  })
}
/* Explorer pane geometry shared by every session: the workspace file-tree
   width, the file-preview width, the sidebar width (0 = collapsed), and the
   explorer open state (which controls the on-screen presence of both panes).
   Persisted globally in localStorage so session switches and page reloads keep
   one shared set of parameters. */
function createExplorerPaneStore() {
  return defineStore({
    init: () => ({
      tree: TREE_DEFAULT,
      preview: PREVIEW_DEFAULT,
      sidebar: SIDEBAR_DEFAULT,
      explorerOpen: true,
    }),
    persist: EXPLORER_LAYOUT_STORE_KEY,
    actions: {
      setTree: (draft, width, max = TREE_MAX) => { draft.tree = clamp(width, TREE_MIN, max) },
      setPreview: (draft, width, max = PREVIEW_MAX) => { draft.preview = clamp(width, PREVIEW_MIN, max) },
      setSidebar: (draft, width) => { draft.sidebar = width === 0 ? 0 : Math.max(SIDEBAR_MIN, Math.round(width)) },
      toggleExplorer: (draft) => { draft.explorerOpen = !draft.explorerOpen },
    },
  })
}
function createPreviewSessionStore() {
  return defineStore({
    init: () => ({
      previewSessions: {},
    }),
    persist: PREVIEW_SESSION_STORE_KEY,
    actions: {
      rememberPreviewSession: (draft, key, value) => {
        const normalized = normalizePreviewSession(value)
        if (normalized.tabs.length === 0 && (normalized.expanded ?? []).length === 0) delete draft.previewSessions[String(key)]
        else {
          // Timestamp every write so stale sessions can be pruned below; the
          // in-memory editor keeps full content, only the stored copy is slim.
          draft.previewSessions[String(key)] = { ...normalized, updatedAt: Date.now() }
          prunePreviewSessions(draft)
        }
      },
    },
  })
}
function createExplorerSettingsStore() {
  return defineStore({
    init: () => ({
      rowHeight: ROW_HEIGHT_DEFAULT,
      chatFontSize: CHAT_FONT_SIZE_DEFAULT,
      wrap: false,
      expandSearchMatches: SEARCH_MATCH_EXPAND_DEFAULT,
      fileColors: {},
      highlightPresets: {},
    }),
    persist: EXPLORER_SETTINGS_STORE_KEY,
    actions: {
      setRowHeight: (draft, value) => { draft.rowHeight = clamp(value, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX) },
      setChatFontSize: (draft, value) => { draft.chatFontSize = clamp(value, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX) },
      setWrap: (draft, value) => { draft.wrap = Boolean(value) },
      setExpandSearchMatches: (draft, value) => { draft.expandSearchMatches = Boolean(value) },
      setFileColor: (draft, group, value) => {
        if (draft.fileColors === undefined) draft.fileColors = {}
        if (String(value).toLowerCase() === fileColorDefault(group).toLowerCase()) delete draft.fileColors[group]
        else draft.fileColors[group] = String(value)
      },
      resetFileColor: (draft, group) => { if (draft.fileColors !== undefined) delete draft.fileColors[group] },
      resetFileColors: (draft) => { draft.fileColors = {} },
      setHighlightPreset: (draft, group, presetId) => {
        if (draft.highlightPresets === undefined) draft.highlightPresets = {}
        if (presetId === highlightPresetDefaultFor(group)) delete draft.highlightPresets[group]
        else draft.highlightPresets[group] = String(presetId)
      },
      resetHighlightPreset: (draft, group) => { if (draft.highlightPresets !== undefined) delete draft.highlightPresets[group] },
      resetHighlightPresets: (draft) => { draft.highlightPresets = {} },
    },
  })
}
class LayoutController { attach(actions){this.actions=actions} requireActions(){if(!this.actions)throw new Error('workspace-explorer-layout: root store actions are not attached');return this.actions} toggleSidebar(){this.requireActions().toggleSidebar()} openDetails(){this.requireActions().openDetails()} closeDetails(){this.requireActions().closeDetails()} }

const EMPTY_EDITOR_CONTEXT_VIEW = Object.freeze({ present: false, active: false })
class EditorContextController {
  constructor() {
    this.records = new Map()
    this.disabledSessions = new Set()
    this.stores = new Map()
    // Last published context per session id: activation restores a session's
    // own value only, never a foreign session's.
    this.latest = new Map()
  }
  active(sessionId) { return this.records.has(sessionId) && !this.disabledSessions.has(sessionId) }
  storeFor(sessionId) {
    let store = this.stores.get(sessionId)
    if (store !== undefined) return store
    store = createSnapshotStore(this.project(sessionId))
    this.stores.set(sessionId, store)
    return store
  }
  project(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined) return EMPTY_EDITOR_CONTEXT_VIEW
    return Object.freeze({
      present: true,
      active: !this.disabledSessions.has(sessionId),
      path: record.path,
      selection: record.selection === undefined ? undefined : Object.freeze({
        startLine: record.selection.startLine,
        startColumn: record.selection.startColumn,
        endLine: record.selection.endLine,
        endColumn: record.selection.endColumn,
      }),
    })
  }
  update(sessionId, value) {
    if (value === undefined) {
      this.latest.delete(sessionId)
      this.records.delete(sessionId)
    } else {
      this.latest.set(sessionId, value)
      this.records.set(sessionId, Object.freeze({
        ...value,
        ...(value.selection === undefined ? {} : { selection: Object.freeze({ ...value.selection }) }),
      }))
    }
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  toggle(sessionId) {
    if (this.disabledSessions.has(sessionId)) this.disabledSessions.delete(sessionId)
    else this.disabledSessions.add(sessionId)
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  activate(sessionId) {
    // Restore only this session's own last published context; a foreign
    // session's value must never leak into the session being activated.
    const own = this.latest.get(sessionId)
    if (own !== undefined) this.update(sessionId, own)
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  retain(sessionIds) {
    const live = new Set(sessionIds)
    for (const sessionId of this.records.keys()) if (!live.has(sessionId)) this.records.delete(sessionId)
    for (const sessionId of this.disabledSessions) if (!live.has(sessionId)) this.disabledSessions.delete(sessionId)
    for (const sessionId of this.latest.keys()) if (!live.has(sessionId)) this.latest.delete(sessionId)
    for (const [sessionId, store] of this.stores) {
      if (live.has(sessionId)) continue
      store.set(EMPTY_EDITOR_CONTEXT_VIEW)
      this.stores.delete(sessionId)
    }
  }
  snapshot(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined || this.disabledSessions.has(sessionId)) return undefined
    if (record.symlink) throw new Error('符号链接文件不能加入此次对话上下文。')
    const common = {
      kind: 'workspace-editor',
      version: 1,
      workspaceId: record.workspaceId,
      path: record.path,
    }
    if (record.selection === undefined) return { ...common, mode: 'path' }
    const bytes = new TextEncoder().encode(record.selection.text).byteLength
    if (Number.isFinite(record.maxContextBytes) && bytes > record.maxContextBytes) {
      throw new Error(`选中文本为 ${formatBytes(bytes)}，超过 ${formatBytes(record.maxContextBytes)} 的上下文上限。`)
    }
    return {
      ...common,
      mode: 'selection',
      // The decode encoding the editor displayed; the server verifies a clean
      // selection against this same decode.
      encoding: record.encoding,
      dirty: record.dirty,
      ...(record.revision === undefined ? {} : { revision: record.revision }),
      selection: { ...record.selection },
    }
  }
  dispose() {
    this.latest.clear()
    this.records.clear()
    this.disabledSessions.clear()
    for (const store of this.stores.values()) store.set(EMPTY_EDITOR_CONTEXT_VIEW)
    this.stores.clear()
  }
}

function EditorContextPrefix({ useEditorContext, useSessions, toggle, ensureSession, sessionId }) {
  const rowRef = useRef(null)
  const [queueDockGap, setQueueDockGap] = useState(0)
  const context = useEditorContext(value => value)
  const direct = useSessions(state => state.byId[sessionId] !== undefined && state.byId[sessionId].origin !== 'subagent')
  useEffect(() => { ensureSession(String(sessionId)) }, [ensureSession, sessionId])
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    const parent = row.parentElement
    if (parent === null) return
    const updateGap = () => {
      const prev = row.previousElementSibling
      setQueueDockGap(prev instanceof HTMLElement && prev.hasAttribute('data-queue-dock') ? 9 : 0)
    }
    updateGap()
    const observer = new MutationObserver(updateGap)
    observer.observe(parent, { childList: true })
    return () => { observer.disconnect() }
  }, [context.present, direct])
  if (!context.present || !direct) return null
  const range = context.selection === undefined
    ? ''
    : ` · L${context.selection.startLine}:C${context.selection.startColumn}-L${context.selection.endLine}:C${context.selection.endColumn}`
  const label = `${context.path}${range}`
  const title = context.active
    ? `此次发送将包含文件上下文：${label}。点击停用。`
    : `此次发送不包含文件上下文：${label}。点击重新启用。`
  return h('div', { className: 'dsh-wel-context-row', ref: rowRef, style: queueDockGap === 0 ? undefined : { marginTop: `${queueDockGap}px` } },
    h('button', {
      'aria-label': title,
      'aria-pressed': context.active,
      className: 'dsh-wel-context-prefix',
      'data-inactive': !context.active || undefined,
      onClick: toggle,
      title,
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-context-prefix-mark' }, context.active ? '↳' : '○'),
    h('span', { className: 'dsh-wel-context-prefix-label' }, label)))
}

const OPENED_FILE_PREFIX = '<opened_file>The user opened the file '
const OPENED_FILE_SUFFIX = ' in the IDE. This may or may not be related to the current task.</opened_file>'
const SELECTION_PREFIX = '<selection>The user selected the lines '
const SELECTION_TRAILER = 'This may or may not be related to the current task.'
const SELECTION_CLOSE = '</selection>'
const MESSAGE_CONTEXT_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-pending-steering]'
const MESSAGE_CONTEXT_SUMMARY_ATTR = 'data-dsh-wel-message-context-summary'
const pendingEditorContextDisplays = new Map()

function rememberEditorContextDisplay(text, display) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined) pendingEditorContextDisplays.set(text, [display])
  else queue.push(display)
}

function consumeEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return null
  const display = queue.shift()
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
  return display ?? null
}

function discardLastEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return
  queue.pop()
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
}

function clearEditorContextDisplays() {
  pendingEditorContextDisplays.clear()
}

function promptRemainder(text, end) {
  const rest = text.slice(end)
  if (rest.startsWith('\r\n\r\n')) return rest.slice(4)
  if (rest.startsWith('\n\n')) return rest.slice(2)
  return rest
}

function displayFileName(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function displayLineRange(startLine, endLine) {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
}

function displaySelectionRange(selection) {
  return `L${selection.startLine}:C${selection.startColumn}-L${selection.endLine}:C${selection.endColumn}`
}

function describeEditorContext(context, raw) {
  const fileName = displayFileName(context.path)
  if (context.selection === undefined) {
    return { path: context.path, fileName, range: null, title: context.path, raw }
  }
  const range = displaySelectionRange(context.selection)
  return { path: context.path, fileName, range, title: `${context.path} · ${range}`, raw }
}

function parseOpenedFileContext(text) {
  if (!text.startsWith(OPENED_FILE_PREFIX)) return null
  const suffixAt = text.indexOf(OPENED_FILE_SUFFIX, OPENED_FILE_PREFIX.length)
  if (suffixAt < 0) return null
  const path = text.slice(OPENED_FILE_PREFIX.length, suffixAt)
  const end = suffixAt + OPENED_FILE_SUFFIX.length
  return {
    path,
    fileName: displayFileName(path),
    range: null,
    title: path,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseSelectionContext(text) {
  if (!text.startsWith(SELECTION_PREFIX)) return null
  const headerEnd = text.indexOf('\n')
  if (headerEnd < 0) return null
  const header = text.slice(0, headerEnd).replace(/\r$/, '')
  const headerMatch = /^<selection>The user selected the lines (\d+) to (\d+) from (.*):$/.exec(header)
  if (headerMatch === null) return null
  const closeAt = text.indexOf(SELECTION_CLOSE, headerEnd + 1)
  if (closeAt < 0) return null
  const body = text.slice(headerEnd + 1, closeAt)
  if (!body.endsWith(`\n${SELECTION_TRAILER}`) && !body.endsWith(`\r\n${SELECTION_TRAILER}`)) return null
  const startLine = Number(headerMatch[1])
  const endLine = Number(headerMatch[2])
  const path = headerMatch[3]
  const end = closeAt + SELECTION_CLOSE.length
  return {
    path,
    fileName: displayFileName(path),
    range: displayLineRange(startLine, endLine),
    title: `${path} · ${displayLineRange(startLine, endLine)}`,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseEditorContextEnvelope(text) {
  return parseOpenedFileContext(text) ?? parseSelectionContext(text)
}

function findEditorContextBubble(candidate) {
  for (let current = candidate; current instanceof HTMLElement; current = current.parentElement) {
    if (current.parentElement?.parentElement?.hasAttribute('data-time-hover-root')) return current
  }
  return candidate instanceof HTMLElement ? candidate : null
}

function findEditorContextCandidate(container) {
  let candidate = null
  const elements = [container, ...container.querySelectorAll('div,span,p,pre')]
  for (const element of elements) {
    const text = element.textContent ?? ''
    if (text.startsWith(OPENED_FILE_PREFIX) || text.startsWith(SELECTION_PREFIX)) candidate = element
  }
  return candidate
}

function renderEditorContextSummary(bubble, context) {
  const parent = bubble.parentElement
  if (parent === null) return
  let row = bubble.previousElementSibling
  if (!(row instanceof HTMLElement) || !row.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) {
    row = document.createElement('div')
    row.setAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR, '')
    row.className = 'dsh-wel-message-context-summary'
    parent.insertBefore(row, bubble)
  }
  row.setAttribute('title', context.raw ?? context.title)
  row.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-mark',
      textContent: '↳',
    }),
    Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-label',
      textContent: context.fileName,
    }),
    ...(context.range === null ? [] : [Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-range',
      textContent: context.range,
    })]),
  )
}

function installEditorContextMessageCompactor() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  const originals = new Map()
  const compactBubble = (bubble) => {
    const text = bubble.textContent ?? ''
    const context = parseEditorContextEnvelope(text)
    if (context === null) return
    originals.set(bubble, text)
    renderEditorContextSummary(bubble, consumeEditorContextDisplay(text) ?? context)
    bubble.classList.add('dsh-wel-message-context-bubble')
    if (context.visibleText === '') bubble.setAttribute('data-dsh-wel-empty-prompt', '')
    else bubble.removeAttribute('data-dsh-wel-empty-prompt')
    bubble.textContent = context.visibleText
  }
  const compactContainer = (container) => {
    // Fast path: most containers never carry an editor-context envelope; the
    // prefix check skips the element scan for them on every mutation batch
    // (streaming chat mutates character data continuously).
    const text = container.textContent ?? ''
    if (!text.startsWith(OPENED_FILE_PREFIX) && !text.startsWith(SELECTION_PREFIX)) return
    const candidate = findEditorContextCandidate(container)
    const bubble = candidate === null ? null : findEditorContextBubble(candidate)
    if (bubble !== null) compactBubble(bubble)
  }
  const compactAll = () => {
    for (const container of document.querySelectorAll(MESSAGE_CONTEXT_SELECTOR)) compactContainer(container)
  }
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      compactAll()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  compactAll()
  return () => {
    observer.disconnect()
    clearEditorContextDisplays()
    for (const [bubble, text] of originals) {
      if (!bubble.isConnected) continue
      const summary = bubble.previousElementSibling
      if (summary instanceof HTMLElement && summary.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) summary.remove()
      bubble.classList.remove('dsh-wel-message-context-bubble')
      bubble.removeAttribute('data-dsh-wel-empty-prompt')
      bubble.textContent = text
    }
    originals.clear()
  }
}

class ThemePresenter { constructor(){this.appliedTokens=[];this.themeColorMeta=document.createElement('meta');this.themeColorMeta.name='theme-color'} apply(snapshot){const scheme=snapshot.active.colorScheme;document.documentElement.style.colorScheme=scheme;const body=document.body;scheme==='dark'?body.setAttribute('data-ds-dark-theme',''):body.removeAttribute('data-ds-dark-theme');for(const token of this.appliedTokens)body.style.removeProperty(token);this.appliedTokens=[];for(const [token,value] of Object.entries(snapshot.active.tokens)){body.style.setProperty(token,value);this.appliedTokens.push(token)}this.themeColorMeta.content=getComputedStyle(body).backgroundColor;if(!this.themeColorMeta.isConnected)document.head.append(this.themeColorMeta)} dispose(){document.documentElement.style.removeProperty('color-scheme');const body=document.body;body.removeAttribute('data-ds-dark-theme');for(const token of this.appliedTokens)body.style.removeProperty(token);this.appliedTokens=[];this.themeColorMeta.remove()} }
class PromptContextBridge {
  constructor(ctx, editorContexts) {
    this.ctx = ctx
    this.editorContexts = editorContexts
    this.inputPatches = new Map()
    this.contextOnlyInFlight = new Set()
    this.sendTails = new Map()
    this.pendingControllers = new Set()
    this.notifiedErrors = new WeakSet()
    this.conversation = undefined
    this.originalSendSession = undefined
    this.wrappedSendSession = undefined
  }
  install() {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) return () => {}
    this.conversation = conversation
    this.originalSendSession = conversation.sendSession
    if (typeof this.originalSendSession !== 'function') {
      this.conversation = undefined
      this.originalSendSession = undefined
      throw new Error('workspace-explorer-layout requires the Harness 0.1.x conversation.sendSession seam')
    }
    const bridge = this
    const wrappedSendSession = async function sendSessionWithEditorContext(session, text, imageIds, mode) {
      return bridge.sendSessionWithEditorContext(session, text, imageIds, mode)
    }
    Object.defineProperty(wrappedSendSession, SEND_SESSION_BRIDGE_MARKER, { value: true })
    this.wrappedSendSession = wrappedSendSession
    conversation.sendSession = wrappedSendSession
    const reconcile = () => bridge.reconcile()
    const off = this.ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      off()
      for (const [id, patch] of bridge.inputPatches) bridge.restoreInput(id, patch)
      bridge.inputPatches.clear()
      bridge.contextOnlyInFlight.clear()
      for (const controller of bridge.pendingControllers) controller.abort()
      bridge.pendingControllers.clear()
      bridge.sendTails.clear()
      clearEditorContextDisplays()
      // Cordis returns a fresh trace proxy for each service-method read, so
      // comparing `conversation.sendSession` by identity cannot detect our wrapper.
      const currentSendSession = conversation.sendSession
      if (currentSendSession?.[SEND_SESSION_BRIDGE_MARKER] === true) {
        conversation.sendSession = bridge.originalSendSession
      }
      bridge.conversation = undefined
      bridge.originalSendSession = undefined
      bridge.wrappedSendSession = undefined
    }
  }
  async sendSessionWithEditorContext(session, text, imageIds, mode) {
    const sessionId = String(session.sessionId)
    if (!this.directSession(sessionId)) {
      if (text === '' && imageIds.length === 0) return
      if (this.conversation === undefined || this.originalSendSession === undefined) return
      return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
    }
    let context
    try {
      context = this.editorContexts.snapshot(sessionId)
    } catch (error) {
      this.notify(sessionId, error)
      throw error
    }
    return this.enqueue(sessionId, async (signal) => {
      if (signal.aborted || this.conversation === undefined || this.originalSendSession === undefined) throw new Error('编辑器上下文发送已取消')
      if (context === undefined) {
        if (text === '' && imageIds.length === 0) return
        return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
      }
      let rendered
      try {
        rendered = await renderContext(session.sessionId, context, signal)
      } catch (error) {
        if (error?.name !== 'AbortError') this.notify(sessionId, error)
        throw error
      }
      const combined = text === '' ? rendered : `${rendered}\n\n${text}`
      const display = describeEditorContext(context, rendered)
      rememberEditorContextDisplay(combined, display)
      try {
        return await this.originalSendSession.call(this.conversation, session, combined, imageIds, mode)
      } catch (error) {
        discardLastEditorContextDisplay(combined)
        throw error
      }
    })
  }
  enqueue(id, operation) {
    const controller = new AbortController()
    this.pendingControllers.add(controller)
    const previous = this.sendTails.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(() => operation(controller.signal))
    this.sendTails.set(id, pending)
    return pending.finally(() => {
      controller.abort()
      this.pendingControllers.delete(controller)
      if (this.sendTails.get(id) === pending) this.sendTails.delete(id)
    })
  }
  directSession(id) {
    const row = this.ctx.sessions.list.getSnapshot().byId[id]
    return row !== undefined && row.origin !== 'subagent'
  }
  reconcile() {
    const list = this.ctx.sessions.list.getSnapshot()
    for (const id of list.ids) if (this.directSession(String(id))) this.ensure(String(id))
    for (const [id, patch] of this.inputPatches) {
      if (!list.ids.some(candidate => String(candidate) === id) || !this.directSession(id)) this.restoreInput(id, patch)
    }
  }
  ensure(id) {
    if (this.inputPatches.has(id)) return
    // Missing seams must never escape into the sessions-list subscription
    // dispatch (a throw there could break later subscribers); the session
    // simply keeps its original input behavior.
    try {
      const binding = this.ctx.sessions.binding(id)
      if (binding === undefined || this.conversation === undefined) return
      const input = this.conversation.input.for(binding.ctx)
      const original = input.submit
      const originalSteerQueue = input.steerQueue
      if (typeof original !== 'function' || typeof originalSteerQueue !== 'function') {
        console.error(`workspace-explorer-layout: session ${id} input submit/steer seams unavailable; editor context will not attach`)
        return
      }
      const bridge = this
      const wrapper = function submitWithEditorContext(mode = 'queue') {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, mode)
          return
        }
        return original.call(input, mode)
      }
      const steerWrapper = function steerQueueWithEditorContext() {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, 'steer')
          return
        }
        return originalSteerQueue.call(input)
      }
      input.submit = wrapper
      input.steerQueue = steerWrapper
      this.inputPatches.set(id, { input, original, wrapper, originalSteerQueue, steerWrapper })
    } catch (error) {
      console.error(`workspace-explorer-layout: failed to patch input seams for session ${id}:`, error)
    }
  }
  restoreInput(id, patch) {
    if (patch.input.submit === patch.wrapper) patch.input.submit = patch.original
    if (patch.input.steerQueue === patch.steerWrapper) patch.input.steerQueue = patch.originalSteerQueue
    this.inputPatches.delete(id)
  }
  async sendContextOnly(id, mode) {
    if (!this.directSession(id) || this.contextOnlyInFlight.has(id)) return
    const binding = this.ctx.sessions.binding(id)
    if (binding === undefined) return
    this.contextOnlyInFlight.add(id)
    try {
      await this.sendSessionWithEditorContext(binding.session, '', [], mode)
    } catch (error) {
      if (error?.name !== 'AbortError') this.notify(id, error)
    } finally {
      this.contextOnlyInFlight.delete(id)
    }
  }
  notify(id, error) {
    if (error !== null && typeof error === 'object') {
      if (this.notifiedErrors.has(error)) return
      this.notifiedErrors.add(error)
    }
    const patch = this.inputPatches.get(id)
    const message = error instanceof Error ? error.message : String(error)
    patch?.input.notify('error', message)
  }
}
class WorkspaceApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = status
  }
}
async function requestJson(endpoint, workspaceId, path, signal, encoding) { const query=new URLSearchParams({workspaceId,path});if(encoding!==undefined&&encoding!==null)query.set('encoding',String(encoding));const response=await fetch(`${API_PREFIX}/${endpoint}?${query}`,{method:'GET',headers:{accept:'application/json'},credentials:'same-origin',signal});let payload;try{payload=await response.json()}catch(error){if(error?.name==='AbortError')throw error;throw new WorkspaceApiError('invalid-response',`工作区接口返回了无效响应（HTTP ${response.status}）`,response.status)}if(!response.ok){const failure=payload?.error;throw new WorkspaceApiError(typeof failure?.code==='string'?failure.code:'request-failed',typeof failure?.message==='string'?failure.message:`读取工作区失败（HTTP ${response.status}）`,response.status)}return payload }
async function putFile(workspaceId,path,content,revision,signal,encoding){const query=new URLSearchParams({workspaceId:String(workspaceId),path});if(encoding!==undefined&&encoding!==null)query.set('encoding',String(encoding));const headers={'content-type':'text/plain; charset=utf-8',accept:'application/json'};if(revision!==undefined&&revision!==null)headers['if-match']=String(revision);const response=await fetch(`${API_PREFIX}/file?${query}`,{method:'PUT',headers,credentials:'same-origin',body:content,signal});let payload;try{payload=await response.json()}catch(error){if(error?.name==='AbortError')throw error;throw new WorkspaceApiError('invalid-response',`保存接口返回了无效响应（HTTP ${response.status}）`,response.status)}if(!response.ok){const failure=payload?.error;throw new WorkspaceApiError(typeof failure?.code==='string'?failure.code:'save-failed',typeof failure?.message==='string'?failure.message:`保存文件失败（HTTP ${response.status}）`,response.status)}return payload}
// Upload a non-workspace file dropped into the preview pane. Browsers hide the
// absolute path of dropped files, so the raw bytes go to the plugin's own
// endpoint, which decodes them and returns a read-only preview payload.
async function uploadExternalFile(bytes, name, signal, encoding) {
  const query = new URLSearchParams()
  if (typeof name === 'string' && name !== '') query.set('name', name)
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/external-file?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: bytes, signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', `外部文件接口返回了无效响应（HTTP ${response.status}）`, response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    throw new WorkspaceApiError(typeof failure?.code === 'string' ? failure.code : 'external-file-failed', typeof failure?.message === 'string' ? failure.message : `打开外部文件失败（HTTP ${response.status}）`, response.status)
  }
  return payload
}
async function renderContext(sessionId,context,signal){const response=await fetch(`${API_PREFIX}/context`,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({...context,sessionId:String(sessionId)}),signal});let payload;try{payload=await response.json()}catch(error){if(error?.name==='AbortError')throw error;throw new WorkspaceApiError('invalid-response',`编辑器上下文接口返回了无效响应（HTTP ${response.status}）`,response.status)}if(!response.ok){const failure=payload?.error;throw new WorkspaceApiError(typeof failure?.code==='string'?failure.code:'context-failed',typeof failure?.message==='string'?failure.message:`无法提交编辑器上下文（HTTP ${response.status}）`,response.status)}if(typeof payload?.text!=='string')throw new WorkspaceApiError('invalid-response','编辑器上下文接口缺少文本结果',response.status);return payload.text}
async function mutateEntry(method,workspaceId,path,payload,signal){const query=new URLSearchParams({workspaceId:String(workspaceId),path});const response=await fetch(`${API_PREFIX}/entry?${query}`,{method,headers:{accept:'application/json','content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload),signal});let result;try{result=await response.json()}catch(error){if(error?.name==='AbortError')throw error;throw new WorkspaceApiError('invalid-response',`工作区修改接口返回了无效响应（HTTP ${response.status}）`,response.status)}if(!response.ok){const failure=result?.error;throw new WorkspaceApiError(typeof failure?.code==='string'?failure.code:'entry-failed',typeof failure?.message==='string'?failure.message:`工作区修改失败（HTTP ${response.status}）`,response.status)}return result}
async function requestSearch(workspaceId,query,caseSensitive,signal){const params=new URLSearchParams({workspaceId:String(workspaceId),q:query,caseSensitive:caseSensitive?'true':'false'});const response=await fetch(`${API_PREFIX}/search?${params}`,{method:'GET',headers:{accept:'application/json'},credentials:'same-origin',signal});let payload;try{payload=await response.json()}catch(error){if(error?.name==='AbortError')throw error;throw new WorkspaceApiError('invalid-response',`搜索接口返回了无效响应（HTTP ${response.status}）`,response.status)}if(!response.ok){const failure=payload?.error;throw new WorkspaceApiError(typeof failure?.code==='string'?failure.code:'search-failed',typeof failure?.message==='string'?failure.message:`搜索失败（HTTP ${response.status}）`,response.status)}return payload}
async function revealInExplorer(workspaceId, path, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/reveal?${query}`, { method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', `在资源管理器中打开接口返回了无效响应（HTTP ${response.status}）`, response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    throw new WorkspaceApiError(typeof failure?.code === 'string' ? failure.code : 'reveal-failed', typeof failure?.message === 'string' ? failure.message : `在资源管理器中打开失败（HTTP ${response.status}）`, response.status)
  }
  return payload
}
const createWorkspaceEntry=(workspaceId,path,kind,name,signal)=>mutateEntry('POST',workspaceId,path,{kind,name},signal)
const renameWorkspaceEntry=(workspaceId,path,name,signal)=>mutateEntry('PATCH',workspaceId,path,{name},signal)
function parentPath(path){const index=path.lastIndexOf('/');return index<0?'':path.slice(0,index)}
function joinAbsolutePath(root,relative){if(typeof root!=='string'||root==='')return relative;if(relative==='')return root;const separator=/^[A-Za-z]:[\\/]/.test(root)?'\\':'/';return `${root.replace(/[\\/]+$/,'')}${separator}${relative.split('/').join(separator)}`}
async function copyText(value){if(typeof navigator!=='undefined'&&typeof navigator.clipboard?.writeText==='function'){try{await navigator.clipboard.writeText(value);return true}catch{/* clipboard API rejects without user gesture or outside secure contexts; fall back to execCommand */}}const textarea=document.createElement('textarea');textarea.value=value;textarea.style.position='fixed';textarea.style.opacity='0';document.body.append(textarea);textarea.select();let ok=false;try{ok=document.execCommand('copy')}catch{/* execCommand throws in unusual embedders; report failure */}textarea.remove();return ok}
function selectedLevelPath(entry){return entry?.kind==='directory'?entry.path:entry?parentPath(entry.path):''}
function defaultEntryName(kind){return kind==='directory'?'新建文件夹':'新建文件.txt'}
function entryNameError(value){const name=value.trim();if(name==='')return '请输入名称';if(name==='.'||name==='..'||name.includes('/')||name.includes('\\')||/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name))return '名称只能是当前层级内的单个文件名';return undefined}
function entryDialogTitle(dialog){if(dialog?.mode==='rename')return '重命名';return dialog?.kind==='directory'?'新建文件夹':'新建文件'}
function entryDialogAction(dialog){return dialog?.mode==='rename'?'重命名':'创建'}
function rewriteRelativePath(path,from,to){if(path===from)return to;if(from!==''&&path.startsWith(`${from}/`))return `${to}${path.slice(from.length)}`;return path}
function rewriteEntry(entry,from,to,replacement){if(!entry)return entry;if(entry.path===from)return {...replacement};const path=rewriteRelativePath(entry.path,from,to);return path===entry.path?entry:{...entry,path}}
function rewriteDirectoryMap(current,from,to,replacement){const next=new Map();for(const [path,state]of current){const nextPath=rewriteRelativePath(path,from,to);const entries=Array.isArray(state?.entries)?state.entries.map(entry=>rewriteEntry(entry,from,to,replacement)):state?.entries;next.set(nextPath,{...state,entries})}return next}
function rewritePathSet(current,from,to){const next=new Set();for(const path of current)next.add(rewriteRelativePath(path,from,to));return next}
function entryFromPreviewTab(tab) { return { kind: 'file', name: tab.name, path: tab.path, symlink: Boolean(tab.symlink) } }
function clonePreviewTab(tab) {
  if (tab === undefined || tab === null || typeof tab.path !== 'string') return null
  return {
    baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
    bom: Boolean(tab.bom),
    dirty: Boolean(tab.dirty),
    draft: typeof tab.draft === 'string' ? tab.draft : '',
    editing: Boolean(tab.editing),
    encoding: typeof tab.encoding === 'string' && tab.encoding !== '' ? tab.encoding : 'utf-8',
    external: Boolean(tab.external),
    lineEnding: typeof tab.lineEnding === 'string' ? tab.lineEnding : 'none',
    name: typeof tab.name === 'string' && tab.name !== '' ? tab.name : tab.path.slice(tab.path.lastIndexOf('/') + 1),
    path: tab.path,
    pinned: Boolean(tab.pinned),
    revision: tab.revision === undefined ? null : tab.revision,
    // The in-flight flag must never be persisted or restored: a refresh
    // mid-save would otherwise bring back a tab stuck in "saving" with every
    // action (close/save/cancel) disabled and no recovery path.
    saving: false,
    scrollTop: Number.isFinite(tab.scrollTop) ? tab.scrollTop : 0,
    size: Number.isFinite(tab.size) ? tab.size : null,
    status: tab.status === undefined || tab.status === null
      ? undefined
      : { error: Boolean(tab.status.error), text: String(tab.status.text ?? '') },
    symlink: Boolean(tab.symlink),
  }
}
/* Persisted copy of a tab: identical to the live clone except clean tabs
 * carry no file text. Persisting every tab's full draft ballooned the store
 * into the localStorage quota, making setItem throw and silently disabling
 * persistence (stale tabs on reload). Clean content equals disk and is
 * re-read on restore; only dirty tabs need their draft to survive. */
function serializePreviewTab(tab) {
  const clone = clonePreviewTab(tab)
  if (clone === null) return null
  // The "正在保存…" status only exists while a save is in flight; a persisted
  // copy must not resurrect it as a stale banner after refresh.
  if (tab.saving) clone.status = undefined
  // Dropped non-workspace files are session-only previews: their content lives
  // only in memory (persisting it would re-introduce the localStorage quota
  // blow-up the slim serialization was written to prevent), so refresh drops
  // them and they are excluded from every persisted snapshot.
  if (clone.external) return null
  if (!clone.dirty) {
    clone.baseText = ''
    clone.draft = ''
  }
  return clone
}
/* Cap the stored session count so the value stays bounded forever. The key
 * being written is freshest and always survives; others keep the most
 * recently updated PREVIEW_SESSION_MAX entries. */
function prunePreviewSessions(draft) {
  const entries = Object.entries(draft.previewSessions ?? {})
  if (entries.length <= PREVIEW_SESSION_MAX) return
  entries.sort((a, b) => (b[1]?.updatedAt ?? -Infinity) - (a[1]?.updatedAt ?? -Infinity))
  for (const [key] of entries.slice(PREVIEW_SESSION_MAX)) delete draft.previewSessions[key]
}
/* Stable partition keeping every pinned tab ahead of all unpinned ones. */
function orderPinnedFirst(tabs) {
  const pinned = []
  const unpinned = []
  for (const tab of tabs) (tab.pinned ? pinned : unpinned).push(tab)
  return [...pinned, ...unpinned]
}
function normalizePreviewSession(value) {
  const seen = new Set()
  const tabs = Array.isArray(value?.tabs)
    ? value.tabs.map(clonePreviewTab).filter((tab) => {
        if (tab === null || seen.has(tab.path)) return false
        seen.add(tab.path)
        return true
      })
    : []
  const activePath = typeof value?.activePath === 'string' && tabs.some(tab => tab.path === value.activePath)
    ? value.activePath
    : (tabs[0]?.path ?? null)
  const expanded = Array.isArray(value?.expanded)
    ? [...new Set(value.expanded.filter(path => typeof path === 'string' && path !== ''))]
    : []
  return { activePath, tabs, expanded }
}
function previewSessionWithDraft(value, storedDraft) {
  const session = normalizePreviewSession(value)
  if (storedDraft === undefined || storedDraft === null || typeof storedDraft.path !== 'string') return session
  if (!session.tabs.some(tab => tab.path === storedDraft.path)) {
    session.tabs.push({
      baseText: typeof storedDraft.baseContent === 'string' ? storedDraft.baseContent : '',
      bom: Boolean(storedDraft.bom),
      dirty: true,
      draft: typeof storedDraft.content === 'string' ? storedDraft.content : '',
      editing: true,
      encoding: typeof storedDraft.encoding === 'string' && storedDraft.encoding !== '' ? storedDraft.encoding : 'utf-8',
      lineEnding: typeof storedDraft.lineEnding === 'string' ? storedDraft.lineEnding : 'none',
      name: typeof storedDraft.name === 'string' && storedDraft.name !== ''
        ? storedDraft.name
        : storedDraft.path.slice(storedDraft.path.lastIndexOf('/') + 1),
      path: storedDraft.path,
      pinned: false,
      revision: storedDraft.revision ?? null,
      saving: false,
      scrollTop: 0,
      size: Number.isFinite(storedDraft.size) ? storedDraft.size : null,
      status: storedDraft.revision === null || storedDraft.revision === undefined
        ? { error: true, text: '已恢复此工作区中未保存的草稿。' }
        : undefined,
      symlink: false,
    })
  }
  session.activePath = storedDraft.path
  return session
}
function selectStoredPreviewSession(previewSessions, workspace, currentSession, workspaceId) {
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    const currentValue = previewSessions[currentKey]
    if (currentValue !== undefined) return { key: currentKey, value: currentValue }
    if (workspaceId !== undefined) {
      const workspaceKey = String(workspaceId)
      const workspaceValue = previewSessions[workspaceKey]
      if (workspaceValue !== undefined) return { key: workspaceKey, value: workspaceValue }
    }
    return { key: currentKey, value: undefined }
  }
  if (workspace !== undefined) {
    for (const sessionId of workspace.sessionIds) {
      const key = String(sessionId)
      const value = previewSessions[key]
      if (value !== undefined) return { key, value }
    }
  }
  if (workspaceId !== undefined) {
    const workspaceKey = String(workspaceId)
    const workspaceValue = previewSessions[workspaceKey]
    if (workspaceValue !== undefined) return { key: workspaceKey, value: workspaceValue }
    return { key: workspaceKey, value: undefined }
  }
  return { key: undefined, value: undefined }
}
function serializePreviewSession(activePath, tabs, expanded) {
  const seen = new Set()
  const normalized = []
  for (const tab of tabs) {
    if (tab === undefined || tab === null || seen.has(tab.path)) continue
    seen.add(tab.path)
    const serialized = serializePreviewTab(tab)
    if (serialized === null) continue
    normalized.push(serialized)
  }
  // Root ('') is always expanded by default and never stored; only real
  // folders participate in the persisted set.
  const expandedList = expanded === undefined || expanded === null
    ? []
    : [...expanded].filter(path => typeof path === 'string' && path !== '').sort()
  return {
    activePath: activePath !== null && normalized.some(tab => tab.path === activePath) ? activePath : (normalized[0]?.path ?? null),
    tabs: normalized,
    expanded: expandedList,
  }
}
function dropIndexFromEvent(event) {
  const tabNodes = event.currentTarget.querySelectorAll('.dsh-wel-preview-tab')
  for (let i = 0; i < tabNodes.length; i += 1) {
    const rect = tabNodes[i].getBoundingClientRect()
    if (event.clientX < rect.left + rect.width / 2) return i
  }
  return tabNodes.length
}
function rewritePreviewTab(tab, from, to, replacement) {
  const path = rewriteRelativePath(tab.path, from, to)
  if (path === tab.path) return tab
  const renamed = tab.path === from
  return {
    ...tab,
    name: renamed ? replacement.name : tab.name,
    path,
    symlink: renamed ? Boolean(replacement.symlink) : tab.symlink,
  }
}
function rewritePreviewTabs(tabs, from, to, replacement) {
  return tabs.map(tab => rewritePreviewTab(tab, from, to, replacement))
}
function ancestorDirectoryPaths(path) {
  const ancestors = ['']
  const parts = path.split('/').slice(0, -1)
  let cursor = ''
  for (const part of parts) {
    cursor = cursor === '' ? part : `${cursor}/${part}`
    ancestors.push(cursor)
  }
  return ancestors
}
function IconRefresh(){return h('svg',{'aria-hidden':true,fill:'none',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:2,viewBox:'0 0 24 24'},h('polyline',{points:'23 4 23 10 17 10'}),h('path',{d:'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'}))}
function IconNewFile(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M4 1.8h5.4L13 5.4v8.8H4z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}),h('path',{d:'M9.2 1.8v3.8H13M8.5 7.4v4.2M6.4 9.5h4.2',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:1.3}))}
function IconNewFolder(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M1.8 4.3h4l1.2 1.4h7.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}),h('path',{d:'M8 7.5v3.8M6.1 9.4h3.8',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
function IconSearch(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('circle',{cx:6.9,cy:6.9,r:4.4,stroke:'currentColor',strokeWidth:1.3}),h('path',{d:'M10.3 10.3 14 14',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
function IconPin(){return h('svg',{'aria-hidden':true,fill:'none',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:1.8,viewBox:'5 2 14 19'},h('line',{x1:12,x2:12,y1:17,y2:21}),h('path',{d:'M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z'}))}
function IconFolder(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M1.8 4.3h4l1.2 1.4h7.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}))}
function IconSessionList(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M2.5 3.2h11M2.5 8h11M2.5 12.8h7',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
/* The sidebar's two-button segment replacing the harness New Session button:
   two exclusive navigation tabs — Session List / Workspace Files — that only
   switch the browsing region (no session creation, no toggle-off on repeat).
   Each button is flex:1 (50%) so the pair tracks the sidebar width while it
   is dragged; the collapsed rail stacks icon-only controls. */
function SidebarTopActions({ collapsed, view, width, onSelectSessions, onSelectFiles }) {
  // The row is hosted inside the harness sidebar shell, which does not stretch
  // foreign nodes reliably, so its width is bound to the sidebar width
  // explicitly (root padding 12px x2 plus the row's 2px x2 margins) instead of
  // relying on the parent flex stretch; AppFrame re-renders on every drag tick.
  const rowStyle = collapsed ? undefined : { width: `${Math.max(0, width - 28)}px` }
  return h('div', { className: 'dsh-wel-sidebar-top-actions', 'data-rail': collapsed || undefined, style: rowStyle },
    h('button', {
      'aria-label': '会话列表',
      className: 'dsh-wel-sidebar-top-action',
      'data-active': view !== 'files' || undefined,
      onClick: onSelectSessions,
      title: '会话列表',
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-sidebar-top-icon' }, h(IconSessionList)), h('span', { className: 'dsh-wel-sidebar-top-label' }, '会话列表')),
    h('button', {
      'aria-label': '文件浏览',
      className: 'dsh-wel-sidebar-top-action',
      'data-active': view === 'files' || undefined,
      onClick: onSelectFiles,
      title: '文件浏览',
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-sidebar-top-icon' }, h(IconFolder)), h('span', { className: 'dsh-wel-sidebar-top-label' }, '文件浏览')),
  )
}

function ResizeHandle({label,left,value,min,max,onResize,onDragging}){const[dragging,setDragging]=useState(false),origin=useRef(0),base=useRef(0);const start=useCallback(e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);origin.current=e.clientX;base.current=value;setDragging(true);onDragging(true)},[onDragging,value]);const move=useCallback(e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))onResize(clamp(base.current+e.clientX-origin.current,min,max))},[max,min,onResize]);const end=useCallback(e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);onResize(clamp(base.current+e.clientX-origin.current,min,max));setDragging(false);onDragging(false)},[max,min,onDragging,onResize]);return h('div',{'aria-label':label,'aria-orientation':'vertical','aria-valuemax':max,'aria-valuemin':min,'aria-valuenow':value,className:'dsh-wel-splitter','data-dragging':dragging||undefined,onKeyDown:e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onResize(clamp(value+(e.key==='ArrowLeft'?-RESIZE_STEP:RESIZE_STEP),min,max))}},onLostPointerCapture:()=>{setDragging(false);onDragging(false)},onPointerCancel:end,onPointerDown:start,onPointerMove:move,onPointerUp:end,role:'separator',style:{left},tabIndex:0})}
function HeaderAction({action}){return h('button',{'aria-label':action.label,className:'dsh-wel-icon-button','data-active':action.active||undefined,disabled:action.disabled||undefined,onClick:action.onClick,title:action.title??action.label,type:'button'},action.icon)}
function PanelHeader({title,subtitle,action,actionLabel,actions=[],onContextMenu}){const items=[...actions];if(action)items.push({label:actionLabel,onClick:action,icon:h(IconRefresh)});return h('header',{className:'dsh-wel-panel-header'},h('div',{className:'dsh-wel-panel-title',onContextMenu},h('strong',{title},title),subtitle?h('span',{title:subtitle},subtitle):null),items.length?h('div',{className:'dsh-wel-panel-actions'},items.map(item=>h(HeaderAction,{action:item,key:item.label}))):null)}
/* Memoized: the tree re-renders when tabs change (typing, tab drags), but a
   row's own props only change on selection/expansion/directory data, so
   scrolling and typing skip most row reconciliation entirely. */
const TreeRow = memo(function TreeRow({entry,depth,expanded,selected,onContextMenu,onDirectory,onFile,onRename}){const directory=entry.kind==='directory',blocked=entry.kind==='blocked'||entry.kind==='other',label=directory?'dir':fileLabel(entry.name);return h('button',{'aria-expanded':directory?expanded:undefined,className:'dsh-wel-tree-row','data-selected':selected||undefined,disabled:blocked,onClick:directory?()=>onDirectory(entry):()=>onFile(entry),onContextMenu:e=>onContextMenu(e,entry),onKeyDown:e=>{if(e.key==='F2'){e.preventDefault();onRename(entry)}},style:{'--dsh-wel-depth':depth},title:`${entry.path}${entry.symlink?'（符号链接）':''}`,type:'button'},h('span',{className:'dsh-wel-chevron'},directory?(expanded?'▼':'▶'):''),h('span',{className:'dsh-wel-file-mark','data-kind':entry.kind,'data-group':colorGroupOf(entry)},label.slice(0,3)),h('span',{className:'dsh-wel-row-name'},entry.name),entry.symlink?h('span',{className:'dsh-wel-symlink'},'↗'):null)})
const TreeStatus=({children,error})=>h('div',{className:'dsh-wel-tree-status','data-error':error||undefined},children)
function TreeContextMenu({entry,menuRef,onCopyName,onCopyPath,onReveal,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{'aria-label':entry.path,className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyName(entry),role:'menuitem',title:'复制此文件或文件夹的完整名称（含扩展名）',type:'button'},'复制名称'),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyPath(entry,false),role:'menuitem',title:'复制文件的完整绝对路径',type:'button'},'复制路径'),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyPath(entry,true),role:'menuitem',title:'复制相对工作区根目录的路径',type:'button'},'复制相对路径'),h('div',{className:'dsh-wel-context-separator',role:'separator'}),h('button',{className:'dsh-wel-context-item',onClick:()=>onReveal(entry),role:'menuitem',title:'在操作系统的文件管理器中打开此文件或文件夹',type:'button'},'在资源管理器中打开'))}
function TabContextMenu({menuRef,onCloseOthers,onTogglePin,pinned,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',onClick:onTogglePin,role:'menuitem',title:pinned?'取消固定此标签页':'固定此标签页并移动到标签开头',type:'button'},pinned?'取消固定':'固定标签'),h('button',{className:'dsh-wel-context-item',onClick:onCloseOthers,role:'menuitem',title:'关闭除当前标签外的所有未固定标签页',type:'button'},'关闭其他标签页'))}
function EntryDialog({dialog,draft,error,busy,blocked,composingRef,onCancel,onConfirm,onDraft}){if(!dialog)return null;const title=entryDialogTitle(dialog),action=entryDialogAction(dialog);return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},title),h('button',{'aria-label':'关闭',className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:'关闭',type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('input',{'aria-label':'名称',autoFocus:true,className:'dsh-wel-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-wel-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},'取消'),h('button',{className:'dsh-wel-text-button',disabled:blocked,onClick:onConfirm,type:'button'},busy?'处理中…':action))))}
function EncodingMenu({menuRef,onOpen,onSave,canOpen,canSave,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',disabled:!canOpen,onClick:onOpen,role:'menuitem',title:canOpen?'用所选编码重新解码并展示此文件':'有未保存的更改，请先保存或取消后再切换编码打开',type:'button'},'以编码打开…'),h('button',{className:'dsh-wel-context-item',disabled:!canSave,onClick:onSave,role:'menuitem',title:canSave?'将当前文件内容用所选编码写回磁盘':'该文件当前不能编辑，无法另存为编码',type:'button'},'另存为编码…'))}
/* Transient top-center banner mirroring the harness conversation Toast: same
   fixed placement, contrast fill, hold-then-fade timing and body portal, so a
   failed external-file open reads exactly like the composer's image-intake
   rejection. The owner remounts it per show (keyed by seq) to restart the
   animation for repeated identical messages. */
const WEL_TOAST_HOLD_MS = 3000
const WEL_TOAST_FADE_MS = 1000
const welToastIcon = h('svg',{fill:'none',height:16,viewBox:'0 0 16 16',width:16},h('circle',{cx:8,cy:8,r:6.5,stroke:'currentColor',strokeWidth:1.5}),h('path',{d:'M8 4.75v3.5',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.5}),h('circle',{cx:8,cy:11.25,fill:'currentColor',r:0.9}))
function PreviewToast({text,onDone}){useEffect(()=>{const timer=setTimeout(onDone,WEL_TOAST_HOLD_MS+WEL_TOAST_FADE_MS);return()=>clearTimeout(timer)},[onDone]);return createPortal(h('div',{className:'dsh-wel-toast',role:'alert'},h('span',{'aria-hidden':true,className:'dsh-wel-toast-icon'},welToastIcon),h('span',{className:'dsh-wel-toast-text'},text)),document.body)}
function EncodingDialog({dialog,options,value,busy,onCancel,onPick,onConfirm}){if(dialog===undefined)return null;const title=dialog.mode==='open'?'以编码打开':'另存为编码',action=dialog.mode==='open'?'打开':'保存';return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},title),h('button',{'aria-label':'关闭',className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:'关闭',type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('label',{className:'dsh-wel-settings-label',htmlFor:'dsh-wel-encoding-select'},'文件编码'),h('select',{'aria-label':'文件编码',className:'dsh-wel-highlight-preset-select',disabled:busy,id:'dsh-wel-encoding-select',onChange:e=>onPick(e.target.value),value},options.map(enc=>h('option',{key:enc.id,value:enc.id},enc.label)))),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},'取消'),h('button',{className:'dsh-wel-text-button',disabled:busy||options.length===0,onClick:onConfirm,type:'button'},busy?'处理中…':action))))}
function SessionRenameDialog({draft,busy,error,onCancel,onConfirm,onDraft}){return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},'重命名当前会话'),h('button',{'aria-label':'关闭',className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:'关闭',type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('input',{'aria-label':'会话名称',autoFocus:true,className:'dsh-wel-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();onCancel()}else if(e.key==='Enter'){e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-wel-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},'取消'),h('button',{className:'dsh-wel-text-button',disabled:busy||draft.trim()==='',onClick:onConfirm,type:'button'},busy?'处理中…':'重命名'))))}

function revealPosition(view, reveal) {
  const lineNumber = Math.min(Math.max(1, reveal.line), view.state.doc.lines)
  const line = view.state.doc.line(lineNumber)
  const startColumn = Math.min(Math.max(1, reveal.column ?? 1), line.length + 1)
  const endColumn = Math.min(Math.max(startColumn, reveal.endColumn ?? startColumn), line.length + 1)
  const from = line.from + startColumn - 1
  const to = line.from + endColumn - 1
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
}

/* Code-folding helpers backing the Ctrl+K+J / Ctrl+K+<n> shortcuts. Nesting
   depth is 1-based: a top-level fold region is level 1, one directly inside
   another fold region is level 2, and so on. */
function collectFoldableRanges(view) {
  const state = view.state
  const seen = new Set()
  const ranges = []
  for (let pos = 0; pos < state.doc.length;) {
    const line = view.lineBlockAt(pos)
    const range = foldable(state, line.from, line.to)
    if (range) {
      const key = `${range.from}:${range.to}`
      if (!seen.has(key)) {
        seen.add(key)
        ranges.push(range)
      }
    }
    pos = line.to + 1
  }
  return ranges
}
/* Nesting depth per foldable range: 1 for a top-level region, +1 per
   enclosing region. CodeMirror fold regions are disjoint-or-nested and
   collected in document order, so one stack sweep computes every depth in
   linear time (the previous per-range scan was quadratic on large files). */
function foldLevelsOf(ranges) {
  const ordered = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to)
  const levels = new Array(ordered.length)
  const stack = []
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index]
    while (stack.length > 0 && stack[stack.length - 1].to <= range.from) stack.pop()
    levels[index] = stack.length + 1
    stack.push(range)
  }
  return { ordered, levels }
}
/* Fold every foldable region whose nesting depth is exactly `level`. */
function foldLevel(view, level) {
  const ranges = collectFoldableRanges(view)
  const { ordered, levels } = foldLevelsOf(ranges)
  const effects = []
  for (let index = 0; index < ordered.length; index += 1) {
    if (levels[index] === level) effects.push(foldEffect.of(ordered[index]))
  }
  if (effects.length) {
    view.dispatch({ effects })
    return true
  }
  return false
}

function CodeEditor({ file, editing, wrap, onContext, onDirty, onSaveShortcut, onScroll, reveal, scrollTop, editorRef, highlightPreset, searchPanelContainer, readEpoch, onRevealApplied }) {
  const host = useRef(null)
  const editableCompartment = useRef(new Compartment())
  const wrapCompartment = useRef(new Compartment())
  const contextRef = useRef(onContext)
  const dirtyRef = useRef(onDirty)
  const saveRef = useRef(onSaveShortcut)
  const scrollRef = useRef(onScroll)
  const revealRef = useRef(null)
  const onRevealAppliedRef = useRef(onRevealApplied)
  const revealAppliedRef = useRef(null)
  contextRef.current = onContext
  dirtyRef.current = onDirty
  saveRef.current = onSaveShortcut
  scrollRef.current = onScroll
  revealRef.current = reveal
  onRevealAppliedRef.current = onRevealApplied
  // A reveal request is consumed the first time it is actually applied, so
  // returning to the tab later restores the persisted scroll instead of
  // re-jumping to a stale search match.
  const markRevealApplied = (target) => {
    if (target === null || revealAppliedRef.current === target) return
    revealAppliedRef.current = target
    onRevealAppliedRef.current?.()
  }

  useEffect(() => {
    const descriptor = languageFor(file.name)
    const separator = lineSeparator(file.lineEnding)
    const separatorExtension = file.lineEnding === 'mixed'
      ? []
      : EditorState.lineSeparator.of(separator)
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), history(), foldGutter(), drawSelection(), dropCursor(),
          EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(),
          highlightSelectionMatches(), highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          /* The search panel is rendered into a container div between the
             status bar and the preview body: top:true puts it in the top panel
             group (the @codemirror/search default is bottom), and
             panels({ topContainer }) places that group in the plugin-owned
             container instead of inside the editor. */
          search({ top: true }),
          panels(searchPanelContainer?.current ? { topContainer: searchPanelContainer.current } : undefined),
          /* CodeMirror's search/goto-line panels render their labels through
             EditorState.phrase(); without this map they show English. The keys
             mirror @codemirror/search's phrases; keep the $ placeholders. */
          EditorState.phrases.of({
            'Find': '查找',
            'Replace': '替换为',
            'next': '下一个',
            'previous': '上一个',
            'all': '全部',
            'match case': '区分大小写',
            'regexp': '正则',
            'by word': '全字匹配',
            'replace': '替换',
            'replace all': '全部替换',
            'close': '关闭',
            'Go to line': '跳转到行',
            'go': '跳转',
            'current match': '当前匹配',
            'on line': '行',
            'replaced match on line $': '已在第 $ 行替换匹配',
            'replaced $ matches': '已替换 $ 个匹配项',
          }),
          syntaxHighlighting(tokenHighlight),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true } },
            indentWithTab, ...closeBracketsKeymap, ...defaultKeymap,
            /* Search keys that only make sense inside the editor stay in the
               keymap: Escape closes the panel; Ctrl+D / Ctrl+Shift+L /
               Ctrl+Alt+G select occurrences, select matches, or jump to a line.
               The find workflow (Ctrl/Cmd+F, Ctrl/Cmd+G, F3) is deliberately
               NOT bound here — the window capture handler below owns it so it
               works from every focus state (single path, same as Ctrl+K). */
            { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
            { key: 'Mod-Shift-l', run: selectSelectionMatches },
            { key: 'Mod-Alt-g', run: gotoLine },
            { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
            ...historyKeymap, ...foldKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) dirtyRef.current(update.state.sliceDoc())
            if (update.docChanged || update.selectionSet) contextRef.current(update.state)
          }),
          editableCompartment.current.of([
            EditorView.editable.of(editing),
            EditorState.readOnly.of(!editing),
          ]),
          wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
          descriptor.extension,
          separatorExtension,
          EditorView.theme({
            '&': { backgroundColor: 'var(--dsw-alias-markdown-code-block)', color: 'var(--dsw-alias-label-primary)' },
            '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)' },
            '&.cm-focused': { outline: 'none' },
          }, { dark: false }),
        ],
      }),
    })
    const reportScroll = () => {
      scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
    }
    view.scrollDOM.addEventListener('scroll', reportScroll)
    editorRef.current = view
    // A reveal consumes itself (the parent clears the request), so the second
    // pass must not fall through to the persisted scrollTop and undo the
    // reveal; the closure flag scopes that to this mount pass.
    let revealHandled = false
    const restoreScroll = () => {
      const target = revealRef.current
      if (target !== null && target.path === file.path) {
        revealPosition(view, target)
        markRevealApplied(target)
        revealHandled = true
        return
      }
      if (revealHandled) return
      if (Number.isFinite(scrollTop) && scrollTop > 0) view.scrollDOM.scrollTop = scrollTop
    }
    restoreScroll()
    const animation = requestAnimationFrame(restoreScroll)
    contextRef.current(view.state)
    return () => {
      cancelAnimationFrame(animation)
      scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
      view.scrollDOM.removeEventListener('scroll', reportScroll)
      if (editorRef.current === view) editorRef.current = undefined
      view.destroy()
    }
    // Rebuild only when the document was actually re-read (path/encoding/read
    // epoch), never on save: a save only advances the revision, and rebuilding
    // would wipe the undo history and caret position.
  }, [file.path, file.encoding, readEpoch])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorView.editable.of(editing),
        EditorState.readOnly.of(!editing),
      ]),
    })
  }, [editing])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  useEffect(() => {
    const view = editorRef.current
    if (view === undefined || reveal === null) return
    revealPosition(view, reveal)
    markRevealApplied(reveal)
  }, [reveal])

  // The Ctrl+K+J / Ctrl+K+<n> fold shortcuts are handled here at the window
  // level (capture phase) so they work in every focus state: browsing keeps
  // focus on the tree, toolbar, or fold gutter, and even when the editor
  // content is focused the keymap path proved unreliable. The editor keymap
  // deliberately does not bind these keys — one handling path avoids folding
  // twice. Keys are consumed (preventDefault + stopPropagation) only for the
  // captured Ctrl+K prefix and its completion J / 1..9.
  useEffect(() => {
    let armed = false
    let timer
    const cancel = () => { armed = false; clearTimeout(timer) }
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      const target = event.target
      // Let text fields outside the editor (chat, rename, search, dialogs) keep
      // their keys; the editor's own contenteditable is inside host.
      const insideEditor = host.current !== null && target instanceof Node && host.current.contains(target)
      if (!insideEditor && target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        cancel()
        return
      }
      const key = String(event.key).toLowerCase()
      const isCtrlK = key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      if (isCtrlK) {
        // (Re-)arm the prefix; a repeated Ctrl+K keeps the sequence alive.
        event.preventDefault()
        event.stopPropagation()
        armed = true
        clearTimeout(timer)
        timer = setTimeout(cancel, 1000)
        return
      }
      if (!armed) return
      cancel()
      if (key === 'j') {
        event.preventDefault()
        event.stopPropagation()
        unfoldAll(view)
        return
      }
      if (key.length === 1 && key >= '1' && key <= '9') {
        event.preventDefault()
        event.stopPropagation()
        foldLevel(view, Number(key))
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      cancel()
    }
  }, [])

  // The find shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+G, Ctrl/Cmd+Shift+G, F3,
  // Shift+F3) are handled here at the window level (capture phase) so they
  // work in every focus state, exactly like Ctrl+K above: browsing keeps focus
  // on the tree, toolbar, or tab bar. The editor keymap deliberately does not
  // bind these keys — one handling path. With no editor mounted the keys are
  // left untouched so the browser's own find still works.
  useEffect(() => {
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      const target = event.target
      // Let text fields outside the editor (chat, rename, dialogs) keep their
      // keys; the editor's own contenteditable and the search panel input
      // (rendered into the search container) are treated as editor-internal,
      // so they still reach this handler.
      const panelContainer = searchPanelContainer?.current
      const insideEditor = (host.current !== null && target instanceof Node && host.current.contains(target))
        || (panelContainer !== null && target instanceof Node && panelContainer.contains(target))
      if (!insideEditor && target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey
      const key = String(event.key).toLowerCase()
      const plainF3 = event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey
      let handled = false
      if (key === 'f' && mod && !event.shiftKey) {
        openSearchPanel(view)
        handled = true
      } else if (key === 'g' && mod && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (key === 'g' && mod && event.shiftKey) {
        findPrevious(view)
        handled = true
      } else if (plainF3 && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (plainF3 && event.shiftKey) {
        findPrevious(view)
        handled = true
      }
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // The search field gets a drag-to-resize grip on its right edge. CodeMirror
  // builds the panel DOM itself and SearchPanel is not exported, so watch the
  // panel container for the .cm-panel.cm-search element and wrap its
  // [main-field] input in an inline-flex wrapper next to a col-resize handle
  // (once per input; a fresh input is created each time the panel opens).
  useEffect(() => {
    const container = searchPanelContainer?.current
    if (container === null || container === undefined) return undefined
    const enhance = () => {
      const input = container.querySelector('.cm-panel.cm-search [main-field]')
      if (input === null || input.dataset.dshWelResize === '1') return
      input.dataset.dshWelResize = '1'
      const wrap = document.createElement('span')
      wrap.className = 'dsh-wel-search-field-wrap'
      const handle = document.createElement('span')
      handle.className = 'dsh-wel-search-resize'
      handle.title = '拖拽调整搜索框宽度'
      input.before(wrap)
      wrap.append(input, handle)
      let startX = 0
      let startWidth = 0
      const onPointerDown = (event) => {
        event.preventDefault()
        startX = event.clientX
        startWidth = input.getBoundingClientRect().width
        const onPointerMove = (moveEvent) => {
          input.style.width = `${Math.max(60, Math.min(480, startWidth + (moveEvent.clientX - startX)))}px`
        }
        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }
      handle.addEventListener('pointerdown', onPointerDown)
    }
    enhance()
    const observer = new MutationObserver(enhance)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [searchPanelContainer])

  return h('div', { className: 'dsh-wel-editor-host', 'data-highlight-preset': highlightPreset ?? HIGHLIGHT_PRESET_DEFAULT, ref: host })
}

function WorkspaceExplorer({
  workspace, treePortalTarget, sessionTitle, sessionId, renameSession, publishEditorContext, listDirectory, readFile, saveFile, createEntry, renameEntry, storedDraft, storedPreviewSession, persistDraft, persistPreviewSession, clearDraft, settingsStore,
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const initialPreviewSession = previewSessionWithDraft(storedPreviewSession, storedDraft)
  const [directories, setDirectories] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  const [tabs, setTabs] = useState(() => initialPreviewSession.tabs)
  const [activePath, setActivePath] = useState(() => initialPreviewSession.activePath)
  const [selected, setSelected] = useState(() => {
    if (initialPreviewSession.activePath === null) return storedDraft ? { path: storedDraft.path, name: storedDraft.name, kind: 'file' } : undefined
    const activeTab = initialPreviewSession.tabs.find(tab => tab.path === initialPreviewSession.activePath)
    return activeTab ? entryFromPreviewTab(activeTab) : { path: initialPreviewSession.activePath, name: initialPreviewSession.activePath.slice(initialPreviewSession.activePath.lastIndexOf('/') + 1), kind: 'file' }
  })
  const [preview, setPreview] = useState({ state: 'idle' })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState()
  const [reloadToken, setReloadToken] = useState(0)
  // Bumped once per successful file re-read; the editor rebuilds on this
  // instead of on the revision, so saving (which only advances the revision)
  // keeps the undo history and caret position.
  const [readEpoch, setReadEpoch] = useState(0)
  const [encodingMenu, setEncodingMenu] = useState()
  const [encodingDialog, setEncodingDialog] = useState()
  const [encodingPick, setEncodingPick] = useState('utf-8')
  const [encodingOptions, setEncodingOptions] = useState(ENCODING_FALLBACK)
  const [draggingPath, setDraggingPath] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const [previewToast, setPreviewToast] = useState()
  const [entryDialog, setEntryDialog] = useState()
  const [entryDraft, setEntryDraft] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryError, setEntryError] = useState()
  const [contextMenu, setContextMenu] = useState()
  const [tabContextMenu, setTabContextMenu] = useState()
  const [titleContextMenu, setTitleContextMenu] = useState()
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState()
  const [pinScrollToken, setPinScrollToken] = useState(0)
  const tabScrollPathRef = useRef(null)
  const [copyNotice, setCopyNotice] = useState()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchState, setSearchState] = useState({ state: 'idle' })
  const [searchExpanded, setSearchExpanded] = useState(() => new Set())
  const [searchReveal, setSearchReveal] = useState()
  const searchController = useRef()
  const searchRevealToken = useRef(0)
  const menuRef = useRef(null)
  const tabMenuRef = useRef(null)
  const titleMenuRef = useRef(null)
  const encodingMenuRef = useRef(null)
  const requestedEncodingRef = useRef()
  const previewTabsRef = useRef(null)
  const previewSectionRef = useRef(null)
  const dropSuppressedRef = useRef(false)
  const toastSeqRef = useRef(0)
  const copyNoticeTimer = useRef()
  const requests = useRef(new Map())
  const readController = useRef()
  const saveController = useRef()
  const mutationController = useRef()
  const editorRef = useRef()
  const searchPanelContainerRef = useRef(null)
  const composingRef = useRef(false)
  const baseText = useRef('')
  const diskBaseRef = useRef('')
  const mounted = useRef(true)
  const latestDraft = useRef(undefined)
  const tabsRef = useRef(initialPreviewSession.tabs)
  const activePathRef = useRef(initialPreviewSession.activePath)
  const expandedRef = useRef(new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  // Live editor scroll positions: written on every scroll event without
  // touching React state or the persistence path, merged into the snapshot
  // only when it is actually serialized.
  const scrollTopRef = useRef(new Map())
  const sessionEstablishedRef = useRef(false)
  const previewTabsBootstrapped = useRef(Boolean(initialPreviewSession.tabs.length > 0 || initialPreviewSession.activePath !== null))
  const selectedDirectoryPath = selectedLevelPath(selected)
  const activatePath = useCallback((path) => {
    activePathRef.current = path
    setActivePath(path)
  }, [])
  useLayoutEffect(() => { tabsRef.current = tabs }, [tabs])
  useLayoutEffect(() => { activePathRef.current = activePath }, [activePath])
  useLayoutEffect(() => { expandedRef.current = expanded }, [expanded])
  const activeTab = useMemo(() => activePath === null ? undefined : tabs.find(tab => tab.path === activePath), [activePath, tabs])
  const hasDirtyTabs = useMemo(() => tabs.some(tab => tab.dirty || tab.saving), [tabs])
  const updateActiveTab = useCallback((patch) => {
    const path = activePathRef.current
    if (path === null) return
    setTabs(current => current.map(tab => {
      if (tab.path !== path) return tab
      const nextPatch = typeof patch === 'function' ? patch(tab) : patch
      return { ...tab, ...nextPatch }
    }))
  }, [])
  const updateTab = useCallback((path, patch) => {
    setTabs(current => current.map(tab => {
      if (tab.path !== path) return tab
      const nextPatch = typeof patch === 'function' ? patch(tab) : patch
      return { ...tab, ...nextPatch }
    }))
  }, [])
  const persistSessionTabs = useCallback(() => {
    if (persistPreviewSession === undefined) return
    const hasTreeExpansion = Array.from(expandedRef.current).some(path => path !== '')
    const meaningful = previewTabsBootstrapped.current || tabsRef.current.length !== 0 || activePathRef.current !== null || hasTreeExpansion
    // Skip until this session has established any state: a bare empty mount
    // must not clobber the workspace-key snapshot of another session. Once
    // established, keep writing (an empty snapshot deletes the stale entry in
    // the store action), so collapsing everything back to root also persists.
    if (!meaningful && !sessionEstablishedRef.current) return
    if (meaningful) sessionEstablishedRef.current = true
    // Merge the live scroll positions (kept out of React state so scrolling
    // never re-renders or triggers a write) into the serialized copy only.
    const snapshotTabs = tabsRef.current.map(tab => {
      const live = scrollTopRef.current.get(tab.path)
      return live === undefined ? tab : { ...tab, scrollTop: live }
    })
    persistPreviewSession(serializePreviewSession(activePathRef.current, snapshotTabs, expandedRef.current))
  }, [persistPreviewSession])
  // Persist on a microtask after commit (still before paint) so a pin and an
  // immediate refresh cannot race the localStorage write; the microtask
  // coalesces burst updates (typing, tab drags) into one write per event-loop
  // tick instead of one full 3-key store serialization per keystroke. Critical
  // moments (unmount, pagehide/beforeunload) still flush synchronously below.
  // Declared after the tabsRef sync effect so it always serializes the
  // freshest tabs.
  const persistPendingRef = useRef(false)
  const schedulePersist = useCallback(() => {
    if (persistPendingRef.current) return
    persistPendingRef.current = true
    queueMicrotask(() => {
      persistPendingRef.current = false
      persistSessionTabs()
    })
  }, [persistSessionTabs])
  useLayoutEffect(() => { schedulePersist() }, [activePath, schedulePersist, tabs, expanded])

  const publishContextState = useCallback((state) => {
    if (activeTab === undefined || preview.state !== 'ready') return
    // Dropped external files are read-only and not workspace-confined; never
    // leak their synthetic path into the model's editor context.
    if (activeTab.external) return
    const main = state.selection.main
    const text = state.sliceDoc()
    const selection = main.empty
      ? undefined
      : (() => {
          const start = state.doc.lineAt(main.from)
          const end = state.doc.lineAt(main.to)
          return {
            from: main.from,
            to: main.to,
            startLine: start.number,
            startColumn: main.from - start.from + 1,
            endLine: end.number,
            endColumn: main.to - end.from + 1,
            text: state.sliceDoc(main.from, main.to),
          }
        })()
    publishEditorContext({
      workspaceId: String(workspace.workspaceId),
      path: activeTab.path,
      // The editor decodes the file with preview.encoding; carrying it lets the
      // server verify a clean selection against the same decode (not a hard
      // UTF-8 assumption).
      encoding: preview.encoding,
      dirty: text !== baseText.current || preview.revision === undefined,
      revision: preview.revision ?? undefined,
      selection,
      symlink: Boolean(activeTab.symlink),
      maxContextBytes: preview.maxContextBytes,
    })
  }, [activeTab, preview, publishEditorContext, workspace.workspaceId])

  // A successful save changes the disk revision after CodeMirror keeps the
  // same view; republish so the next clean selection carries the new revision.
  useEffect(() => {
    if (preview.state !== 'ready') return
    const view = editorRef.current
    if (view !== undefined) publishContextState(view.state)
  }, [preview, publishContextState])

  latestDraft.current = dirty && preview.state === 'ready' && activeTab !== undefined
    ? {
        path: activeTab.path,
        name: activeTab.name,
        content: draft,
        baseContent: baseText.current,
        revision: preview.revision ?? null,
        bom: Boolean(preview.bom),
        lineEnding: preview.lineEnding ?? 'none',
        size: Number.isFinite(preview.size) ? preview.size : null,
      }
    : undefined

  const abortDirectoryRequests = useCallback(() => {
    for (const controller of requests.current.values()) controller.abort()
    requests.current.clear()
  }, [])
  const abortRequests = useCallback(() => {
    abortDirectoryRequests()
    readController.current?.abort()
    saveController.current?.abort()
    mutationController.current?.abort()
  }, [abortDirectoryRequests])

  useEffect(() => {
    mounted.current = true
    return () => {
      persistSessionTabs()
      const value = latestDraft.current
      if (value !== undefined) persistDraft(value)
      mounted.current = false
      clearTimeout(copyNoticeTimer.current)
      searchController.current?.abort()
      publishEditorContext(undefined)
      abortRequests()
    }
  }, [abortRequests, persistDraft, persistSessionTabs, publishEditorContext])

  // Navigation never unmounts React, so the unmount cleanup above cannot cover
  // a refresh or tab close. Persist the final tab session synchronously on
  // page hide/unload (localStorage writes are synchronous and safe here).
  useEffect(() => {
    const flush = () => { persistSessionTabs() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [persistSessionTabs])

  useEffect(() => {
    if (!hasDirtyTabs) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDirtyTabs])
  const loadDirectory = useCallback(async (path) => {
    requests.current.get(path)?.abort()
    const controller = new AbortController()
    requests.current.set(path, controller)
    setDirectories(cur => {
      const next = new Map(cur)
      const prior = next.get(path)
      next.set(path, { state: 'loading', entries: prior?.entries ?? [], truncated: false })
      return next
    })
    try {
      const result = await listDirectory(workspace.workspaceId, path, controller.signal)
      setDirectories(cur => {
        const next = new Map(cur)
        next.set(path, { state: 'ready', entries: result.entries, truncated: result.truncated })
        return next
      })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setDirectories(cur => {
          const next = new Map(cur)
          next.set(path, {
            state: 'error',
            entries: [],
            truncated: false,
            message: error instanceof Error ? error.message : String(error),
          })
          return next
        })
      }
    } finally {
      if (requests.current.get(path) === controller) requests.current.delete(path)
    }
  }, [listDirectory, workspace.workspaceId])
  useEffect(() => { void loadDirectory('') }, [loadDirectory])
  // Restore the persisted expansion: fetch the listing of every restored
  // directory so the tree can render its children. Mount-only; the persisted
  // set already includes every ancestor, so nested folders appear in place.
  useEffect(() => {
    for (const path of initialPreviewSession.expanded ?? []) {
      if (path !== '' && path !== undefined) void loadDirectory(path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const revealPath = useCallback((entry) => {
    const paths = entry.kind === 'directory'
      ? [...ancestorDirectoryPaths(entry.path), entry.path]
      : ancestorDirectoryPaths(entry.path)
    for (const path of paths) {
      setExpanded(cur => {
        if (cur.has(path)) return cur
        const next = new Set(cur)
        next.add(path)
        return next
      })
      if (path !== entry.path && directories.get(path)?.state !== 'ready') void loadDirectory(path)
    }
  }, [directories, loadDirectory])
  useLayoutEffect(() => {
    if (previewTabsBootstrapped.current) return
    if (tabsRef.current.length !== 0) return
    const next = previewSessionWithDraft(storedPreviewSession, storedDraft)
    if (next.tabs.length === 0) return
    previewTabsBootstrapped.current = true
    setTabs(next.tabs)
    activatePath(next.activePath)
    const nextTab = next.tabs.find(tab => tab.path === next.activePath)
    if (nextTab !== undefined) {
      const entry = entryFromPreviewTab(nextTab)
      setSelected(entry)
      revealPath(entry)
    }
  }, [activatePath, revealPath, storedDraft, storedPreviewSession])
  // Late-arriving restore for tree expansion: if storedPreviewSession becomes
  // available only after mount, merge its expanded paths and load them. The
  // hasAll guard keeps this idempotent across store updates.
  useLayoutEffect(() => {
    const stored = previewSessionWithDraft(storedPreviewSession, storedDraft)
    const paths = stored.expanded ?? []
    if (paths.length === 0) return
    if (paths.every(path => expandedRef.current.has(path))) return
    setExpanded(cur => {
      const merged = new Set(cur)
      for (const path of paths) merged.add(path)
      return merged
    })
    for (const path of paths) {
      if (path !== '' && path !== undefined) void loadDirectory(path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedDraft, storedPreviewSession])
  const chooseFile = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    setSelected(entry)
    activatePath(entry.path)
    setTabs(current => current.some(tab => tab.path === entry.path)
      ? current
      : [...current, {
          baseText: '',
          dirty: false,
          draft: '',
          editing: false,
          name: entry.name,
          path: entry.path,
          pinned: false,
          saving: false,
          revision: null,
          scrollTop: 0,
          size: null,
          status: undefined,
          symlink: Boolean(entry.symlink),
          bom: false,
          lineEnding: 'none',
        }])
    revealPath(entry)
  }, [revealPath])
  const chooseDirectory = useCallback((entry) => {
    setSelected(entry)
    revealPath(entry)
  }, [revealPath])
  // Open a non-workspace file dropped into the preview pane: upload its raw
  // bytes to the plugin endpoint, which decodes them into a read-only preview
  // payload, then add a session-only external tab with that content. Resolves
  // true on success and the failure message (to toast) when the file cannot be
  // loaded as text.
  const openExternalFile = useCallback(async (file, encoding) => {
    try {
      const bytes = await file.arrayBuffer()
      const result = await uploadExternalFile(bytes, file.name, undefined, encoding)
      if (!mounted.current) return true
      const path = `external:${(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
      const tab = {
        baseText: result.content,
        bom: Boolean(result.bom),
        dirty: false,
        draft: result.content,
        editing: false,
        encoding: result.encoding ?? 'utf-8',
        external: true,
        lineEnding: result.lineEnding ?? 'none',
        name: typeof result.name === 'string' && result.name !== '' ? result.name : file.name,
        path,
        pinned: false,
        revision: null,
        saving: false,
        scrollTop: 0,
        size: Number.isFinite(result.size) ? result.size : file.size,
        status: undefined,
        symlink: false,
      }
      previewTabsBootstrapped.current = true
      setTabs(current => current.some(item => item.path === path) ? current : [...current, tab])
      activatePath(path)
      setStatus({ text: `已打开外部文件 ${tab.name}。` })
      return true
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return true
      // The preview pane only responds to normal (text) files; a file that
      // cannot be loaded as text (binary, image, empty, oversized) reports the
      // server's message through the same toast surface the composer uses.
      return error instanceof Error ? error.message : String(error)
    }
  }, [activatePath])
  const showPreviewToast = useCallback((text) => {
    toastSeqRef.current += 1
    setPreviewToast({ seq: toastSeqRef.current, text })
  }, [])
  const handlePreviewDrop = useCallback(async (event) => {
    setDropActive(false)
    const files = Array.from(event.dataTransfer?.files ?? []).filter(file => !isImageFile(file))
    if (files.length === 0) return
    event.preventDefault()
    const results = await Promise.allSettled(files.map(file => openExternalFile(file)))
    if (!mounted.current) return
    const ok = results.filter(result => result.status === 'fulfilled' && result.value === true).length
    if (files.length > 1 && ok > 0) {
      setStatus({ text: `已打开 ${ok} 个外部文件。` })
    }
    const failures = results
      .filter(result => result.status === 'fulfilled' && typeof result.value === 'string' && result.value !== '')
      .map(result => result.value)
    if (failures.length > 0) {
      showPreviewToast(files.length === 1
        ? failures[0]
        : `${failures.length} 个文件无法作为文本预览。`)
    }
  }, [openExternalFile, showPreviewToast])
  // File drags are intercepted in the capture phase on the whole preview
  // section: CodeMirror's own drop handler reads dataTransfer.files and would
  // otherwise insert the file's text into the editor before this handler runs.
  // Internal tab reorders carry no files, so they pass through untouched. The
  // highlight only appears for normal (non-image) file drags — images are the
  // chat composer's domain and are silently ignored here. Enter/leave use a
  // depth counter because dragleave's relatedTarget is null in Chrome. Closing
  // the hint suppresses it for the current drag until the drop or drag end.
  useEffect(() => {
    const section = previewSectionRef.current
    if (section === null) return undefined
    let depth = 0
    const resetDrop = () => {
      depth = 0
      dropSuppressedRef.current = false
      setDropActive(false)
    }
    const onDragEnter = (event) => {
      if (!hasDraggedFiles(event)) return
      // Suppress the harness chat drop mask over the preview regardless of file
      // kind, so each area keeps its own response.
      event.preventDefault()
      event.stopPropagation()
      if (dropSuppressedRef.current) return
      if (hasNormalFile(event)) {
        depth += 1
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      } else if (event.dataTransfer) {
        // Image-only drag: the preview does not accept it, so signal "no drop"
        // (the browser then refuses the drop and nothing happens at all).
        event.dataTransfer.dropEffect = 'none'
      }
    }
    const onDragOver = (event) => {
      if (!hasDraggedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (dropSuppressedRef.current) return
      if (hasNormalFile(event)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        if (depth === 0) depth = 1
        setDropActive(true)
      } else if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
    }
    const onDragLeave = (event) => {
      if (!hasDraggedFiles(event)) return
      if (dropSuppressedRef.current) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }
    const onDrop = (event) => {
      if (!hasDraggedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      resetDrop()
      void handlePreviewDrop(event)
    }
    const onDragEnd = () => { resetDrop() }
    section.addEventListener('dragenter', onDragEnter, true)
    section.addEventListener('dragover', onDragOver, true)
    section.addEventListener('drop', onDrop, true)
    section.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      section.removeEventListener('dragenter', onDragEnter, true)
      section.removeEventListener('dragover', onDragOver, true)
      section.removeEventListener('drop', onDrop, true)
      section.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [handlePreviewDrop])
  const openEntryDialog = useCallback(kind => { setEntryDialog({ mode: 'create', kind, parentPath: selectedDirectoryPath }); setEntryDraft(defaultEntryName(kind)); setEntryError(undefined); composingRef.current=false }, [selectedDirectoryPath])
  const beginRename = useCallback(entry => { if(entry.kind==='blocked'||entry.kind==='other')return;if(dirty&&activePath===entry.path){setStatus({error:true,text:'当前文件有未保存的更改，请先保存或取消编辑。'});return}setEntryDialog({mode:'rename',entry});setEntryDraft(entry.name);setEntryError(undefined);composingRef.current=false }, [activePath, dirty])
  const closeEntryDialog=useCallback(()=>{if(entryBusy)return;setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false},[entryBusy])
  const submitEntryDialog=useCallback(()=>{if(entryBusy||entryDialog===undefined)return;const trimmed=entryDraft.trim();const message=entryNameError(entryDraft);if(message!==undefined){setEntryError(message);return}const parentPathValue=entryDialog.mode==='create'?entryDialog.parentPath:parentPath(entryDialog.entry.path);const siblings=directories.get(parentPathValue)?.entries??[];if(entryDialog.mode==='create'){if(siblings.some(entry=>entry.name===trimmed)){setEntryError('同级目录中已存在同名条目');return}}else if(trimmed===entryDialog.entry.name||siblings.some(entry=>entry.name===trimmed&&entry.path!==entryDialog.entry.path)){setEntryError(trimmed===entryDialog.entry.name?'名称没有变化':'同级目录中已存在同名条目');return}const controller=new AbortController();mutationController.current?.abort();mutationController.current=controller;setEntryBusy(true);setEntryError(undefined);const request=entryDialog.mode==='create'?createEntry(workspace.workspaceId,entryDialog.parentPath,entryDialog.kind,trimmed,controller.signal):renameEntry(workspace.workspaceId,entryDialog.entry.path,trimmed,controller.signal);request.then(result=>{if(!mounted.current)return;const mode=entryDialog.mode;const sourcePath=mode==='create'?entryDialog.parentPath:entryDialog.entry.path;const nextStatus=mode==='create'?result.kind==='directory'?'已新建文件夹。':'已新建文件。':result.kind==='directory'?'已重命名文件夹。':'已重命名文件。';composingRef.current=false;setEntryBusy(false);setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);setStatus({text:nextStatus});if(mode==='create'){setExpanded(cur=>{const next=new Set(cur);next.add(sourcePath);if(result.kind==='directory')next.add(result.path);return next});if(result.kind==='file'){previewTabsBootstrapped.current = true;setTabs(cur=>cur.some(tab=>tab.path===result.path)?cur:[...cur,{baseText:'',dirty:false,draft:'',editing:false,name:result.name,path:result.path,pinned:false,saving:false,scrollTop:0,size:null,status:undefined,symlink:Boolean(result.symlink),bom:false,lineEnding:'none',revision:null}]);activatePath(result.path)}setSelected(result);void loadDirectory(sourcePath);if(result.kind==='directory')void loadDirectory(result.path)}else{setDirectories(cur=>rewriteDirectoryMap(cur,sourcePath,result.path,result));setExpanded(cur=>rewritePathSet(cur,sourcePath,result.path));setTabs(cur=>rewritePreviewTabs(cur,sourcePath,result.path,result));{const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,sourcePath,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath)}setSelected(result);void loadDirectory(parentPath(sourcePath))}}).catch(error=>{if(error?.name==='AbortError'||!mounted.current){return}setEntryBusy(false);setEntryError(error instanceof Error?error.message:String(error))}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined;if(mounted.current)setEntryBusy(false)})},[createEntry,directories,entryBusy,entryDialog,entryDraft,loadDirectory,renameEntry,workspace.workspaceId])
  useLayoutEffect(() => {
    if (activePath === null) {
      publishEditorContext(undefined)
      setPreview({ state: 'idle' })
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setDraft('')
      setStatus(undefined)
      baseText.current = ''
      return undefined
    }
    // External (dropped) files carry their decoded content in the tab already:
    // there is no workspace path to re-read and no encoding re-open, so build
    // the read-only preview synchronously and never hit the workspace API.
    const externalTab = tabsRef.current.find(item => item.path === activePath && item.external)
    if (externalTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      const selection = { kind: 'file', name: externalTab.name, path: activePath, symlink: false, external: true }
      setSelected(selection)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      const ready = {
        state: 'ready',
        content: externalTab.baseText,
        path: activePath,
        name: externalTab.name,
        symlink: false,
        truncated: false,
        encoding: externalTab.encoding ?? 'utf-8',
        lineEnding: externalTab.lineEnding ?? 'none',
        bom: Boolean(externalTab.bom),
        size: Number.isFinite(externalTab.size) ? externalTab.size : null,
        editable: false,
        readOnlyReason: 'external-file',
      }
      diskBaseRef.current = externalTab.baseText
      baseText.current = externalTab.baseText
      setDraft(externalTab.baseText)
      setPreview(ready)
      return undefined
    }
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    publishEditorContext(undefined)
    const tab = tabsRef.current.find(item => item.path === activePath)
      ?? (storedDraft?.path === activePath
        ? {
            baseText: typeof storedDraft.baseContent === 'string' ? storedDraft.baseContent : '',
            bom: Boolean(storedDraft.bom),
            dirty: true,
            draft: typeof storedDraft.content === 'string' ? storedDraft.content : '',
            editing: true,
            lineEnding: typeof storedDraft.lineEnding === 'string' ? storedDraft.lineEnding : 'none',
            name: typeof storedDraft.name === 'string' && storedDraft.name !== ''
              ? storedDraft.name
              : activePath.slice(activePath.lastIndexOf('/') + 1),
            path: activePath,
            revision: storedDraft.revision ?? null,
            saving: false,
            scrollTop: 0,
            size: Number.isFinite(storedDraft.size) ? storedDraft.size : null,
            status: storedDraft.revision === null || storedDraft.revision === undefined
              ? { error: true, text: '已恢复此工作区中未保存的草稿。' }
              : undefined,
            symlink: false,
          }
        : undefined)
    const effectiveEncoding = requestedEncodingRef.current ?? tab?.encoding ?? 'utf-8'
    // Consume a pending encoding-open request immediately: clearing here keeps
    // an aborted re-read (file switch / tab close mid-flight) from leaking the
    // stale encoding into the next file read.
    requestedEncodingRef.current = undefined
    const selection = tab === undefined ? { kind: 'file', name: activePath.slice(activePath.lastIndexOf('/') + 1), path: activePath } : entryFromPreviewTab(tab)
    setSelected(selection)
    setEditing(Boolean(tab?.editing))
    setDirty(Boolean(tab?.dirty))
    setSaving(Boolean(tab?.saving))
    setStatus(tab?.status)
    setPreview({ state: 'loading', path: activePath })
    readFile(workspace.workspaceId, activePath, controller.signal, effectiveEncoding).then((result) => {
      // The tab may have been switched since the read started (abort covers
      // most cases; a fetch that already resolved is caught here). Applying a
      // stale result would flash the wrong file and bump the read epoch.
      if (!mounted.current || activePathRef.current !== activePath) return
      requestedEncodingRef.current = undefined
      const stored = tab?.dirty ? tab : undefined
      const canRestore = stored !== undefined
        && result.editable !== false
        && !result.readOnlyReason
        && !result.truncated
        && result.lineEnding !== 'mixed'
      // A draft that cannot be restored (file became read-only, oversized,
      // truncated, mixed line endings) is still shown: it is the user's only
      // copy of their unsaved work. It is marked clean so the tab stays
      // closable — the draft cannot be saved anyway — and the status says so.
      const content = stored !== undefined ? stored.draft : result.content
      const ready = {
        state: 'ready',
        ...result,
        name: selection.name,
        path: activePath,
        symlink: Boolean(selection.symlink),
        content,
        revision: canRestore ? stored.revision : result.revision,
        encoding: result.encoding ?? effectiveEncoding,
        lineEnding: result.lineEnding ?? 'none',
        bom: Boolean(result.bom),
        size: result.size,
      }
      const restoredStatus = canRestore && stored.revision !== null && stored.revision !== undefined && result.revision !== stored.revision
        ? { error: true, text: '磁盘文件已在草稿保存后更改。草稿已恢复，保存时将检查冲突。' }
        : { text: '已恢复此工作区中未保存的草稿。' }
      const notRestorableStatus = stored !== undefined
        ? { error: true, text: '检测到未保存草稿，但文件当前不可编辑。草稿内容已展示；关闭标签或刷新后将丢弃，无法保存。' }
        : undefined
      // The disk content (as last read) stays separate from the editing
      // baseline: cancel restores the disk truth even when a draft restore
      // happened with a stale base.
      diskBaseRef.current = result.content
      baseText.current = canRestore ? stored.baseText : result.content
      setDraft(content)
      setPreview(ready)
      setEditing(canRestore ? true : (stored !== undefined ? false : Boolean(tab?.editing)))
      setDirty(canRestore ? true : (stored !== undefined ? false : Boolean(tab?.dirty)))
      if (canRestore) {
        setStatus(restoredStatus)
        if (storedDraft?.path === activePath) clearDraft()
      } else if (stored !== undefined) {
        setStatus(notRestorableStatus)
        if (storedDraft?.path === activePath) clearDraft()
      }
      setReadEpoch(epoch => epoch + 1)
      updateTab(activePath, {
        baseText: canRestore ? stored.baseText : result.content,
        bom: Boolean(result.bom),
        dirty: canRestore ? true : (stored !== undefined ? false : Boolean(tab?.dirty)),
        draft: content,
        editing: canRestore ? true : (stored !== undefined ? false : Boolean(tab?.editing)),
        encoding: result.encoding ?? effectiveEncoding,
        lineEnding: result.lineEnding ?? 'none',
        name: selection.name,
        revision: (canRestore ? stored.revision : result.revision) ?? null,
        saving: false,
        scrollTop: tab?.scrollTop ?? 0,
        size: Number.isFinite(result.size) ? result.size : null,
        status: canRestore ? restoredStatus : (stored !== undefined ? notRestorableStatus : tab?.status),
        symlink: Boolean(selection.symlink),
      })
    }, (error) => {
      if (error?.name !== 'AbortError' && activePathRef.current === activePath) {
        const message = error instanceof Error ? error.message : String(error)
        setPreview({ state: 'error', path: activePath, message })
        updateTab(activePath, { saving: false, status: { error: true, text: message } })
      }
    })
    return () => controller.abort()
    // The workspace draft arrives with the first render (the layout store is
    // synchronous), never late, so it must not be a dependency: the restore
    // path clears the draft, and that change must not re-read the file.
  }, [activePath, clearDraft, publishEditorContext, readFile, reloadToken, updateTab, workspace.workspaceId])

  const save = useCallback(async (encodingOverride) => {
    if (preview.state !== 'ready' || saving || activeTab === undefined) return false
    const forceSaveAs = encodingOverride !== undefined && encodingOverride !== null
    if (!forceSaveAs && !dirty) return false
    if (forceSaveAs && (preview.editable === false || preview.readOnlyReason)) {
      setStatus({ error: true, text: `无法另存为编码：${readOnlyReason(preview)}` })
      return false
    }
    const path = activeTab.path
    const encoding = forceSaveAs ? String(encodingOverride) : (preview.encoding ?? 'utf-8')
    const controller = new AbortController()
    saveController.current = controller
    const text = editorRef.current?.state.sliceDoc() ?? draft
    const savingStatus = { text: forceSaveAs ? `正在保存（${encodingLabel(encoding)}）…` : '正在保存…' }
    setSaving(true)
    setStatus(savingStatus)
    updateTab(path, { draft: text, dirty: true, saving: true, status: savingStatus })
    try {
      const result = await saveFile(workspace.workspaceId, path, text, preview.revision, controller.signal, encoding)
      if (!mounted.current) return false
      const savedEncoding = result.encoding ?? encoding
      const savedBom = Boolean(result.bom)
      const size = Number.isFinite(result.size) ? result.size : new TextEncoder().encode(text).byteLength
      const savedStatus = { text: forceSaveAs ? `已保存为 ${encodingLabel(savedEncoding)}。` : '保存成功。' }
      updateTab(path, { baseText: text, bom: savedBom, dirty: false, draft: text, editing: false, encoding: savedEncoding, lineEnding: preview.lineEnding ?? 'none', revision: result.revision ?? preview.revision ?? null, saving: false, size, status: savedStatus })
      if (activePathRef.current === path) {
        baseText.current = text
        diskBaseRef.current = text
        setDraft(text)
        setDirty(false)
        setEditing(false)
        latestDraft.current = undefined
        clearDraft()
        setPreview(current => current.state === 'ready' && current.path === path
          ? { ...current, content: text, encoding: savedEncoding, bom: savedBom, revision: result.revision ?? current.revision, size }
          : current)
        setStatus(savedStatus)
      }
      return true
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return false
      const failure = error?.status === 409 || error?.status === 412
        ? '保存冲突：文件已在其他位置更改。草稿已保留，请重新读取并手动合并。'
        : `保存失败：${error instanceof Error ? error.message : String(error)}。草稿已保留。`
      updateTab(path, { dirty: true, draft: text, editing: true, saving: false, status: { error: true, text: failure } })
      if (activePathRef.current === path) setStatus({ error: true, text: failure })
      return false
    } finally {
      if (saveController.current === controller) saveController.current = undefined
      if (mounted.current) {
        updateTab(path, { saving: false })
        if (activePathRef.current === path) setSaving(false)
      }
    }
  }, [activeTab, clearDraft, dirty, draft, preview, saveFile, saving, updateTab, workspace.workspaceId])

  const cancel = useCallback(() => {
    if (preview.state !== 'ready' || saving || activeTab === undefined) return
    // Restore the last-read disk content, not the (possibly stale) editing
    // baseline: a draft restored after the disk changed must cancel back to
    // the current on-disk truth.
    const state = editorRef.current?.state
    const restoredText = diskBaseRef.current
    editorRef.current?.dispatch({
      changes: { from: 0, to: state?.doc.length ?? 0, insert: restoredText },
    })
    baseText.current = restoredText
    setDraft(restoredText)
    setDirty(false)
    setEditing(false)
    latestDraft.current = undefined
    clearDraft()
    const nextStatus = { text: '已取消编辑，内容已恢复。' }
    setStatus(nextStatus)
    updateTab(activeTab.path, { dirty: false, draft: restoredText, editing: false, status: nextStatus })
  }, [activeTab, clearDraft, preview.state, saving, updateTab])
  const refresh=useCallback(()=>{if(hasDirtyTabs){setStatus({error:true,text:'存在未保存的更改，已阻止刷新文件树。请先保存或取消编辑。'});return}abortDirectoryRequests();setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false;setDirectories(new Map());setExpanded(new Set(['']));setStatus(undefined);void loadDirectory('')},[abortDirectoryRequests,hasDirtyTabs,loadDirectory])
  const toggleDirectory=useCallback(entry=>{const path=entry.path;const opening=!expanded.has(path);setExpanded(cur=>{const next=new Set(cur);opening?next.add(path):next.delete(path);return next});if(opening){if(directories.get(path)?.state!=='ready')void loadDirectory(path);chooseDirectory(entry)}else setSelected(entry)},[chooseDirectory,directories,expanded,loadDirectory])
  const openContextMenu=useCallback((event,entry)=>{event.preventDefault();setSelected(entry);setContextMenu({entry,x:event.clientX,y:event.clientY})},[])
  const copyEntryPath=useCallback((entry,relative)=>{const value=relative?entry.path:joinAbsolutePath(workspace.path,entry.path);void copyText(value).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?(relative?'已复制相对路径。':'已复制完整路径。'):'复制失败。');clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[workspace.path])
  const copyEntryName=useCallback((entry)=>{void copyText(entry.name).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?'已复制名称。':'复制失败。');clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[])
  const openInExplorer=useCallback((entry)=>{setContextMenu(undefined);const controller=new AbortController();revealInExplorer(workspace.workspaceId,entry.path,controller.signal).then(()=>{if(!mounted.current)return;setCopyNotice('已在资源管理器中打开。');clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)}).catch(error=>{if(!mounted.current||error?.name==='AbortError')return;setCopyNotice(`打开失败：${error instanceof Error?error.message:String(error)}`);clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)})},[workspace.workspaceId])
  const openSessionRename=useCallback(()=>{setTitleContextMenu(undefined);setSessionRenameDraft(sessionTitle ?? '');setSessionRenameError(undefined);setSessionRenameOpen(true)},[sessionTitle])
  const closeSessionRename=useCallback(()=>{if(sessionRenameBusy)return;setSessionRenameOpen(false);setSessionRenameDraft('');setSessionRenameError(undefined)},[sessionRenameBusy])
  const confirmSessionRename=useCallback(()=>{if(sessionRenameBusy||sessionId===undefined)return;const trimmed=sessionRenameDraft.trim();if(trimmed==='')return;setSessionRenameBusy(true);setSessionRenameError(undefined);renameSession(String(sessionId),trimmed).then(()=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameOpen(false);setSessionRenameDraft('')}).catch(error=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameError(error instanceof Error?error.message:String(error))})},[renameSession,sessionId,sessionRenameBusy,sessionRenameDraft])
  const runSearch=useCallback(async(query)=>{searchController.current?.abort();if(query.trim()===''){setSearchState({state:'idle'});setSearchExpanded(new Set());return}const controller=new AbortController();searchController.current=controller;setSearchState({state:'searching'});try{const result=await requestSearch(workspace.workspaceId,query,searchCaseSensitive,controller.signal);if(searchController.current===controller){setSearchState({state:'done',result});setSearchExpanded(new Set((settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT)?result.files.map(file=>file.path):[]))}}catch(error){if(error?.name==='AbortError')return;if(searchController.current===controller)setSearchState({state:'error',message:error instanceof Error?error.message:String(error)})}},[searchCaseSensitive,settings.expandSearchMatches,workspace.workspaceId])
  const closeSearch=useCallback(()=>{searchController.current?.abort();searchController.current=undefined;setSearchExpanded(new Set());setSearchOpen(false)},[])
  const openSearchMatch=useCallback((file,match)=>{const entry={kind:'file',name:file.name,path:file.path,symlink:false};chooseFile(entry);searchRevealToken.current+=1;setSearchReveal({endColumn:match.endColumn,column:match.startColumn,line:match.line,path:file.path,token:searchRevealToken.current})},[chooseFile])
  const toggleSearchFile=useCallback((path)=>{setSearchExpanded(prev=>{const next=new Set(prev);if(next.has(path))next.delete(path);else next.add(path);return next})},[])
  useEffect(()=>{if(!searchOpen)return undefined;const timer=setTimeout(()=>{void runSearch(searchQuery)},300);return()=>clearTimeout(timer)},[runSearch,searchOpen,searchQuery])
  useEffect(()=>{if(contextMenu===undefined)return undefined;const inside=event=>{const node=menuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[contextMenu])
  useEffect(()=>{if(tabContextMenu===undefined)return undefined;const inside=event=>{const node=tabMenuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setTabContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[tabContextMenu])
  useEffect(()=>{if(titleContextMenu===undefined)return undefined;const inside=event=>{const node=titleMenuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setTitleContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[titleContextMenu])
  const openWithEncoding = useCallback((encodingId) => {
    if (dirty) {
      setStatus({ error: true, text: '有未保存的更改，请先保存或取消后再切换编码打开。' })
      return
    }
    requestedEncodingRef.current = encodingId
    setReloadToken(token => token + 1)
  }, [dirty])
  const openEncodingDialog = useCallback((mode) => {
    setEncodingMenu(undefined)
    setEncodingPick(preview.encoding ?? 'utf-8')
    void fetchEncodings().then(list => {
      if (mounted.current) setEncodingOptions(list.length > 0 ? list : ENCODING_FALLBACK)
    })
    setEncodingDialog({ mode })
  }, [preview.encoding])
  const closeEncodingDialog = useCallback(() => {
    if (saving) return
    setEncodingDialog(undefined)
  }, [saving])
  const confirmEncodingDialog = useCallback(() => {
    if (encodingDialog === undefined || encodingPick === '') return
    const selected = encodingPick
    if (encodingDialog.mode === 'open') {
      setEncodingDialog(undefined)
      openWithEncoding(selected)
    } else {
      void save(selected).then(ok => {
        if (mounted.current && ok) setEncodingDialog(undefined)
      })
    }
  }, [encodingDialog, encodingPick, openWithEncoding, save])
  useEffect(() => {
    if (encodingMenu === undefined) return undefined
    const inside = event => { const node = encodingMenuRef.current; return node !== null && event.target instanceof Node && node.contains(event.target) }
    const close = () => setEncodingMenu(undefined)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onContextMenu = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('contextmenu', onContextMenu, true); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [encodingMenu])
  const renderDirectory=(path,depth)=>{const dir=directories.get(path);if(!dir||dir.state==='loading')return h(TreeStatus,{key:`${path}:loading`},'正在读取…');if(dir.state==='error')return h(TreeStatus,{error:true,key:`${path}:error`},dir.message);const rows=dir.entries.map(entry=>{const open=expanded.has(entry.path);return h(Fragment,{key:entry.path},h(TreeRow,{depth,entry,expanded:open,onContextMenu:openContextMenu,onDirectory:toggleDirectory,onFile:chooseFile,onRename:beginRename,selected:selected?.path===entry.path}),entry.kind==='directory'&&open?renderDirectory(entry.path,depth+1):null)});if(dir.truncated)rows.push(h(TreeStatus,{key:`${path}:truncated`},'此目录条目过多，仅显示前一部分。'));if(!rows.length)rows.push(h(TreeStatus,{key:`${path}:empty`},'空目录'));return rows}
  const closeTab = useCallback((path) => {
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.path === path)
    if (index < 0) return
    const closing = current[index]
    if (closing.dirty || closing.saving) {
      const nextStatus = { error: true, text: '此标签有未保存内容，请先保存或取消编辑。' }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
    }
    const nextTabs = current.filter(tab => tab.path !== path)
    const nextActivePath = activePathRef.current === path
      ? (nextTabs[index]?.path ?? nextTabs[index - 1]?.path ?? null)
      : activePathRef.current
    setTabs(nextTabs)
    activatePath(nextActivePath)
    if (nextActivePath === null) {
      setSelected(undefined)
      setPreview({ state: 'idle' })
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setDraft('')
      setStatus(undefined)
      publishEditorContext(undefined)
      return
    }
    const nextTab = nextTabs.find(tab => tab.path === nextActivePath)
    if (nextTab !== undefined) {
      const entry = entryFromPreviewTab(nextTab)
      setSelected(entry)
      revealPath(entry)
    }
  }, [publishEditorContext, revealPath, updateTab])
  const closeOtherTabs = useCallback((keepPath) => {
    const current = tabsRef.current
    const keep = current.find(tab => tab.path === keepPath)
    if (keep === undefined) return
    const closing = current.filter(tab => tab.path !== keepPath && !tab.pinned)
    if (closing.length === 0) return
    if (closing.some(tab => tab.dirty || tab.saving)) {
      const nextStatus = { error: true, text: '存在有未保存内容的标签，请先保存或取消编辑。' }
      if (activePathRef.current === keepPath) setStatus(nextStatus)
      else updateTab(keepPath, { status: nextStatus })
      return
    }
    setTabs(current.filter(tab => tab.pinned || tab.path === keepPath))
    activatePath(keep.path)
    const entry = entryFromPreviewTab(keep)
    setSelected(entry)
    revealPath(entry)
  }, [activatePath, revealPath, updateTab])
  const scrollTabIntoView = useCallback((path) => {
    tabScrollPathRef.current = path
    setPinScrollToken(value => value + 1)
  }, [])
  const pinTab = useCallback((path) => {
    setTabs(current => {
      const tab = current.find(item => item.path === path)
      if (tab === undefined || tab.pinned) return current
      const pinned = { ...tab, pinned: true }
      return orderPinnedFirst([pinned, ...current.filter(item => item.path !== path)])
    })
    if (activePathRef.current === path) scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const unpinTab = useCallback((path) => {
    setTabs(current => {
      const tab = current.find(item => item.path === path)
      if (tab === undefined || !tab.pinned) return current
      const unpinned = { ...tab, pinned: false }
      // Move the unpinned tab right after the last pinned one so the pinned
      // block stays grouped at the front.
      const rest = current.filter(item => item.path !== path)
      let lastPinnedIndex = -1
      for (let i = 0; i < rest.length; i += 1) if (rest[i].pinned) lastPinnedIndex = i
      const insertAt = lastPinnedIndex < 0 ? 0 : lastPinnedIndex + 1
      return [...rest.slice(0, insertAt), unpinned, ...rest.slice(insertAt)]
    })
    scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const dropTabAt = useCallback((insertAt) => {
    if (draggingPath === null || insertAt === null) return
    setTabs(current => {
      const from = current.findIndex(tab => tab.path === draggingPath)
      if (from < 0 || insertAt === from || insertAt === from + 1) return current
      const moved = current[from]
      const next = current.filter(tab => tab.path !== draggingPath)
      next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, moved)
      return orderPinnedFirst(next)
    })
  }, [draggingPath])
  const updateDropIndex = useCallback((event) => {
    if (draggingPath === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const next = dropIndexFromEvent(event)
    setDropIndex(current => current === next ? current : next)
  }, [draggingPath])
  const handleTabsDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropIndex(null)
  }, [])
  const handleTabsDrop = useCallback((event) => {
    event.preventDefault()
    dropTabAt(dropIndexFromEvent(event))
    setDraggingPath(null)
    setDropIndex(null)
  }, [dropTabAt])
  // Scroll the tab strip so a target tab is fully visible. The target is the
  // tab requested by pin/unpin or a preview-body click; otherwise (a file
  // opened from the tree) it is the newly activated tab. One-shot: the
  // requested path is consumed after the check so later active-path changes
  // fall back to the active tab again.
  useLayoutEffect(() => {
    const strip = previewTabsRef.current
    const target = tabScrollPathRef.current ?? activePath
    if (strip === null || target === null) return
    let tabNode = null
    for (const child of strip.children) {
      if (child instanceof HTMLElement && child.classList.contains('dsh-wel-preview-tab') && child.dataset.path === target) {
        tabNode = child
        break
      }
    }
    if (tabNode === null) return
    const stripRect = strip.getBoundingClientRect()
    const nodeRect = tabNode.getBoundingClientRect()
    if (nodeRect.left >= stripRect.left - 1 && nodeRect.right <= stripRect.right + 1) {
      tabScrollPathRef.current = null
      return
    }
    const delta = nodeRect.left < stripRect.left
      ? nodeRect.left - stripRect.left
      : nodeRect.right - stripRect.right
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'smooth' })
    tabScrollPathRef.current = null
  }, [activePath, pinScrollToken])
  // Hovering the tab strip and rolling the wheel scrolls it horizontally when
  // it overflows; a native non-passive listener is required so the default
  // (page) scroll can be prevented.
  useEffect(() => {
    const strip = previewTabsRef.current
    if (strip === null) return undefined
    const onWheel = (event) => {
      const max = strip.scrollWidth - strip.clientWidth
      if (max <= 0) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      strip.scrollLeft = Math.min(Math.max(0, strip.scrollLeft + delta), max)
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [tabs.length > 0])
  let body
  if (preview.state === 'idle') {
    body = h('div', { className: 'dsh-wel-empty' }, '在文件树中选择文件以预览内容')
  } else if (preview.state === 'loading') {
    body = h('div', { className: 'dsh-wel-empty' }, '正在读取文件…')
  } else if (preview.state === 'error') {
    body = h('div', { className: 'dsh-wel-empty' },
      h('div', { className: 'dsh-wel-error-card' }, preview.message))
  } else {
    const highlightPreset = highlightPresetOf(settings, colorGroupOf({ kind: 'file', name: preview.name }))
    body = h(Fragment, null,
      preview.truncated ? h('div', { className: 'dsh-wel-banner' }, '文件较大，当前仅显示开头部分，不能编辑。') : null,
      status ? h('div', { className: 'dsh-wel-status', 'data-error': status.error || undefined }, status.text) : null,
      h('div', { className: 'dsh-wel-preview-search', ref: searchPanelContainerRef, onContextMenu: (event) => { if (event.button !== 2) event.preventDefault() } }),
      h('div', { className: 'dsh-wel-preview-body', onClick: () => { if (activePathRef.current !== null) scrollTabIntoView(activePathRef.current) } },
        h(CodeEditor, {
          key: `${preview.path}:${preview.encoding}:${readEpoch}`,
          editorRef,
          editing,
          file: preview,
          highlightPreset,
          onRevealApplied: () => setSearchReveal(undefined),
          readEpoch,
          searchPanelContainer: searchPanelContainerRef,
          wrap: settings.wrap === true,
          onContext: publishContextState,
          onDirty: (text) => {
            const nextDirty = text !== baseText.current
            setDraft(text)
            setDirty(nextDirty)
            updateActiveTab({ dirty: nextDirty, draft: text })
          },
          onSaveShortcut: () => { if (editing && !saving) void save() },
          onScroll: (path, scrollTop) => { scrollTopRef.current.set(path, scrollTop) },
          reveal: searchReveal !== undefined && preview.state === 'ready' && activeTab !== undefined && searchReveal.path === activeTab.path
            ? searchReveal
            : null,
          scrollTop: scrollTopRef.current.get(activePath) ?? activeTab?.scrollTop ?? 0,
        })))
  }
  let searchBody
  if (searchState.state === 'idle') {
    searchBody = h('div', { className: 'dsh-wel-empty' }, '输入搜索内容，在当前工作区中查找')
  } else if (searchState.state === 'searching') {
    searchBody = h(TreeStatus, null, '正在搜索…')
  } else if (searchState.state === 'error') {
    searchBody = h('div', { className: 'dsh-wel-empty' },
      h('div', { className: 'dsh-wel-error-card' }, searchState.message))
  } else if (searchState.result.files.length === 0) {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-wel-search-summary' }, '未找到匹配项'),
      h('div', { className: 'dsh-wel-empty' }, `没有找到与“${searchState.result.query}”匹配的内容`),
    )
  } else {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-wel-search-summary' },
        `${searchState.result.matchCount} 个匹配项 · ${searchState.result.fileCount} 个文件${searchState.result.truncated ? '（结果过多，仅显示部分）' : ''}`),
      searchState.result.files.map(file => {
        const expanded = searchExpanded.has(file.path)
        return h('div', { className: 'dsh-wel-search-file', key: file.path },
          h('button', {
            'aria-expanded': expanded,
            className: 'dsh-wel-search-file-header',
            onClick: () => toggleSearchFile(file.path),
            title: file.path,
            type: 'button',
          },
            h('span', { className: 'dsh-wel-chevron' }, expanded ? '▼' : '▶'),
            h('span', { className: 'dsh-wel-row-name' }, file.path),
            file.truncated ? h('span', { className: 'dsh-wel-search-truncated', title: '文件较大，仅搜索了开头部分' }, '部分') : null,
            h('span', { className: 'dsh-wel-search-file-count' }, `${file.matches.length}`),
          ),
          expanded ? file.matches.map(match => h('button', {
            className: 'dsh-wel-search-row',
            key: `${match.line}:${match.startColumn}`,
            onClick: () => openSearchMatch(file, match),
            title: `${file.path} · 第 ${match.line} 行`,
            type: 'button',
          },
            h('span', { className: 'dsh-wel-search-line' }, String(match.line)),
            h('span', { className: 'dsh-wel-search-text' },
              match.text.slice(0, match.startColumn - 1),
              h('span', { className: 'dsh-wel-search-hit' }, match.text.slice(match.startColumn - 1, match.endColumn - 1)),
              match.text.slice(match.endColumn - 1),
            ),
          )) : null,
        )
      }),
    )
  }
  const entryDialogTrimmed = entryDraft.trim()
  const entryDialogParentPath = entryDialog?.mode === 'create'
    ? entryDialog.parentPath
    : entryDialog === undefined
      ? ''
      : parentPath(entryDialog.entry.path)
  const entryDialogSiblings = entryDialog === undefined ? [] : directories.get(entryDialogParentPath)?.entries ?? []
  const entryDialogDuplicate = entryDialog !== undefined
    && entryDialogTrimmed !== ''
    && entryDialogSiblings.some(entry => entry.name === entryDialogTrimmed
      && (entryDialog.mode !== 'rename' || entry.path !== entryDialog.entry.path))
  const entryDialogValidation = entryDialog === undefined ? undefined : entryNameError(entryDraft)
  const entryDialogError = entryError ?? (entryDialogValidation !== undefined
    ? entryDialogValidation
    : entryDialogDuplicate
      ? '同级目录中已存在同名条目'
      : entryDialog?.mode === 'rename' && entryDialogTrimmed === entryDialog.entry.name
        ? '名称没有变化'
        : undefined)
  const entryDialogBlocked = entryBusy || entryDialog === undefined || entryDialogError !== undefined
  const reason = preview.state === 'ready' ? readOnlyReason(preview) : '文件尚未加载'
  const size = preview.state === 'ready' ? formatBytes(preview.size) : ''
  const previewTabNodes = []
  for (const [index, tab] of tabs.entries()) {
    if (draggingPath !== null && dropIndex === index) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-wel-preview-drop-indicator', key: `drop:${index}` }))
    previewTabNodes.push(h('div', {
      className: 'dsh-wel-preview-tab',
      'data-active': tab.path === activePath || undefined,
      'data-dragging': draggingPath === tab.path || undefined,
      'data-path': tab.path,
      draggable: true,
      key: tab.path,
      onContextMenu: event => { event.preventDefault(); setTabContextMenu({ path: tab.path, x: event.clientX, y: event.clientY }) },
      onDragEnd: () => { setDraggingPath(null); setDropIndex(null) },
      onDragStart: event => { setDraggingPath(tab.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.path) },
      title: tab.path,
    },
      h('button', {
        className: 'dsh-wel-preview-tab-button',
        onClick: () => chooseFile(entryFromPreviewTab(tab)),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tab.path,
        type: 'button',
      }, h('span', { className: 'dsh-wel-preview-tab-name' }, tab.name), tab.dirty ? h('span', { className: 'dsh-wel-dirty', title: '未保存的更改' }, '●') : null),
      tab.pinned
        ? h('button', {
          'aria-label': `取消固定 ${tab.name}`,
          className: 'dsh-wel-preview-tab-close',
          'data-pinned': true,
          onClick: event => { event.stopPropagation(); unpinTab(tab.path) },
          title: '取消固定',
          type: 'button',
        }, h(IconPin))
        : h('button', {
          'aria-label': `关闭 ${tab.name}`,
          className: 'dsh-wel-preview-tab-close',
          disabled: tab.dirty || tab.saving || undefined,
          onClick: event => { event.stopPropagation(); closeTab(tab.path) },
          title: tab.dirty || tab.saving ? '保存或取消编辑后关闭' : '关闭标签',
          type: 'button',
        }, '×'),
    ))
  }
  if (draggingPath !== null && dropIndex === tabs.length) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-wel-preview-drop-indicator', key: 'drop:end' }))
  const tabMenuTarget = tabContextMenu === undefined ? undefined : tabs.find(tab => tab.path === tabContextMenu.path)
  const treeSection = h('section', { className: 'dsh-wel-tree' },
      searchOpen
        ? h(Fragment, null,
          h('header', { className: 'dsh-wel-panel-header dsh-wel-search-header' },
            h('div', { className: 'dsh-wel-search-input-row' },
              h('input', {
                'aria-label': '搜索工作区内容',
                autoFocus: true,
                className: 'dsh-wel-search-input',
                onChange: e => setSearchQuery(e.target.value),
                onKeyDown: e => {
                  if (e.key === 'Enter') { e.preventDefault(); void runSearch(searchQuery) }
                  else if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
                },
                placeholder: '搜索工作区内容',
                spellCheck: false,
                value: searchQuery,
              }),
              h('button', {
                'aria-pressed': searchCaseSensitive,
                className: 'dsh-wel-icon-button dsh-wel-search-case',
                'data-active': searchCaseSensitive || undefined,
                onClick: () => setSearchCaseSensitive(value => !value),
                title: searchCaseSensitive ? '当前区分大小写；点击切换为不区分' : '当前不区分大小写；点击切换为区分',
                type: 'button',
              }, 'Aa'),
              h('button', {
                'aria-label': '关闭搜索',
                className: 'dsh-wel-icon-button',
                onClick: closeSearch,
                title: '关闭搜索，返回文件树',
                type: 'button',
              }, '×'),
            ),
          ),
          h('div', { className: 'dsh-wel-tree-scroll' }, searchBody),
        )
        : h(Fragment, null,
          h(PanelHeader, {
            actions: [
              { label: '搜索', title: '在工作区中搜索内容', onClick: () => setSearchOpen(true), icon: h(IconSearch) },
              { label: '新建文件夹', title: '在选中层级新建文件夹', onClick: () => openEntryDialog('directory'), disabled: entryBusy, icon: h(IconNewFolder) },
              { label: '新建文件', title: '在选中层级新建文件', onClick: () => openEntryDialog('file'), disabled: entryBusy, icon: h(IconNewFile) },
            ],
            action: refresh,
            actionLabel: '刷新文件树',
            onContextMenu: event => { event.preventDefault(); setTitleContextMenu({ x: event.clientX, y: event.clientY }) },
            subtitle: workspace.path,
            title: sessionTitle ?? '工作区文件',
          }),
          h('div', { className: 'dsh-wel-tree-scroll' }, renderDirectory('', 0)),
          contextMenu ? h(TreeContextMenu, { entry: contextMenu.entry, menuRef, onCopyName: copyEntryName, onCopyPath: copyEntryPath, onReveal: openInExplorer, x: contextMenu.x, y: contextMenu.y }) : null,
          titleContextMenu ? h('div', { className: 'dsh-wel-context-menu', ref: titleMenuRef, role: 'menu', style: { left: Math.max(4, Math.min(titleContextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)), top: Math.max(4, Math.min(titleContextMenu.y, window.innerHeight - 52)) } }, h('button', { className: 'dsh-wel-context-item', onClick: openSessionRename, role: 'menuitem', title: '重命名当前会话', type: 'button' }, '重命名当前会话')) : null,
          copyNotice ? h('div', { className: 'dsh-wel-copy-notice', role: 'status' }, copyNotice) : null,
        ),
  )
  return h(Fragment, null,
    entryDialog ? h(EntryDialog, {
      blocked: entryDialogBlocked,
      busy: entryBusy,
      composingRef,
      dialog: entryDialog,
      draft: entryDraft,
      error: entryDialogError,
      onCancel: closeEntryDialog,
      onConfirm: submitEntryDialog,
      onDraft: value => { setEntryDraft(value); setEntryError(undefined) },
    }) : null,
    encodingMenu ? h(EncodingMenu, { canOpen: !dirty, canSave: preview.state === 'ready' && preview.editable !== false && !preview.readOnlyReason, menuRef: encodingMenuRef, onOpen: () => openEncodingDialog('open'), onSave: () => openEncodingDialog('save'), x: encodingMenu.x, y: encodingMenu.y }) : null,
    encodingDialog ? h(EncodingDialog, { busy: encodingDialog.mode === 'save' && saving, dialog: encodingDialog, onCancel: closeEncodingDialog, onConfirm: confirmEncodingDialog, onPick: setEncodingPick, options: encodingOptions, value: encodingPick }) : null,
    sessionRenameOpen ? h(SessionRenameDialog, {
      busy: sessionRenameBusy,
      draft: sessionRenameDraft,
      error: sessionRenameError,
      onCancel: closeSessionRename,
      onConfirm: confirmSessionRename,
      onDraft: value => { setSessionRenameDraft(value); setSessionRenameError(undefined) },
    }) : null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { 'data-drop-active': dropActive || undefined, className: 'dsh-wel-preview', ref: previewSectionRef },
      tabs.length ? h('div', { ref: previewTabsRef, className: 'dsh-wel-preview-tabs', role: 'tablist', 'aria-label': '文件预览标签', onDragLeave: handleTabsDragLeave, onDragOver: updateDropIndex, onDrop: handleTabsDrop }, previewTabNodes) : null,
      tabContextMenu ? h(TabContextMenu, { menuRef: tabMenuRef, onCloseOthers: () => { setTabContextMenu(undefined); closeOtherTabs(tabContextMenu.path) }, onTogglePin: () => { setTabContextMenu(undefined); if (tabMenuTarget?.pinned) unpinTab(tabContextMenu.path); else pinTab(tabContextMenu.path) }, pinned: Boolean(tabMenuTarget?.pinned), x: tabContextMenu.x, y: tabContextMenu.y }) : null,
      h('header', { className: 'dsh-wel-panel-header', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) } },
        h('div', { className: 'dsh-wel-panel-title' },
          h('strong', { title: activeTab?.external ? activeTab.name : (activeTab?.path ?? '文件预览') }, activeTab?.name ?? '文件预览'),
          h('div', { className: 'dsh-wel-preview-header-meta' },
            activeTab
              ? (activeTab.external
                  ? h('span', { title: '外部文件（拖入）' }, `外部文件 · ${activeTab.name}`)
                  : h('span', { title: activeTab.path }, activeTab.path))
              : h('span', null, workspace.title),
            activeTab ? h('span', { className: 'dsh-wel-language' }, fileLabel(activeTab.name)) : null,
            size ? h('span', null, size) : null,
            preview.state === 'ready' && preview.encoding ? h('span', { className: 'dsh-wel-encoding', title: '文件编码' }, encodingLabel(preview.encoding)) : null,
            dirty ? h('span', { className: 'dsh-wel-dirty', title: '未保存的更改' }, '●') : null,
          ),
        ),
        preview.state === 'ready'
          ? h(Fragment, null,
            h('button', {
              'aria-pressed': settings.wrap === true,
              className: 'dsh-wel-text-button',
              'data-active': settings.wrap === true || undefined,
              onClick: () => settingsStore.actions.setWrap(settings.wrap !== true),
              title: settings.wrap === true ? '关闭自动换行' : '开启自动换行',
              type: 'button',
            }, '自动换行'),
            editing
              ? h(Fragment, null,
                h('button', { className: 'dsh-wel-text-button', disabled: saving, onClick: cancel, type: 'button' }, '取消'),
                h('button', { className: 'dsh-wel-text-button', disabled: !dirty || saving, onClick: () => void save(), type: 'button' }, saving ? '保存中…' : '保存'),
              )
              : h('button', { className: 'dsh-wel-text-button', disabled: Boolean(reason), onClick: () => { if (reason) { setStatus({ error: true, text: `无法编辑：${reason}` }); return } setEditing(true); setStatus({ text: '已进入编辑模式；按 Ctrl/Cmd+S 保存。' }); updateActiveTab({ editing: true, status: { text: '已进入编辑模式；按 Ctrl/Cmd+S 保存。' } }); editorRef.current?.focus() }, title: reason ? `无法编辑：${reason}` : '编辑文件', type: 'button' }, '编辑'),
          )
          : null,
      ),
      body,
      dropActive ? h('div', { className: 'dsh-wel-drop-overlay', role: 'presentation' },
        h('button', { 'aria-label': '关闭拖放提示', className: 'dsh-wel-drop-close', onClick: () => { dropSuppressedRef.current = true; setDropActive(false) }, title: '关闭', type: 'button' }, '×'),
        h('div', { className: 'dsh-wel-drop-hint' }, '松开以打开外部文件')) : null,
      previewToast ? h(PreviewToast, { key: previewToast.seq, onDone: () => setPreviewToast(undefined), text: previewToast.text }) : null,
    ),
  )
}

function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-wel-tree' }, h(PanelHeader, { title: sessionTitle ?? '工作区文件', subtitle: '未选择工作区' }), h('div', { className: 'dsh-wel-empty' }, '请选择一个工作区中的会话'))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-wel-preview' }, h(PanelHeader, { title: '文件预览', subtitle: '未选择工作区' }), h('div', { className: 'dsh-wel-empty' }, '选择工作区后可浏览文件')))
}function ExplorerSettingsSection({ settingsStore }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const rowHeight = settings.rowHeight ?? ROW_HEIGHT_DEFAULT
  const chatFontSize = settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT
  const atSizeDefaults = rowHeight === ROW_HEIGHT_DEFAULT && chatFontSize === CHAT_FONT_SIZE_DEFAULT
  const customizedCount = Object.keys(settings.fileColors ?? {}).length
  const customizedPresetCount = Object.keys(settings.highlightPresets ?? {}).length
  return h('div', { className: 'dsh-wel-explorer-settings' },
    h('div', { className: 'dsh-wel-settings-row' },
      h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-row-height' }, '每行高度'),
      h('input', {
        'aria-label': '每行高度',
        className: 'dsh-wel-settings-slider',
        id: 'dsh-wel-row-height',
        max: ROW_HEIGHT_MAX,
        min: ROW_HEIGHT_MIN,
        onChange: e => settingsStore.actions.setRowHeight(Number(e.target.value)),
        step: 2,
        type: 'range',
        value: rowHeight,
      }),
      h('span', { className: 'dsh-wel-settings-value' }, `${rowHeight}px`)),
    h('div', { className: 'dsh-wel-settings-row' },
      h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-chat-font-size' }, '对话文字大小'),
      h('input', {
        'aria-label': '对话文字大小',
        className: 'dsh-wel-settings-slider',
        id: 'dsh-wel-chat-font-size',
        max: CHAT_FONT_SIZE_MAX,
        min: CHAT_FONT_SIZE_MIN,
        onChange: e => settingsStore.actions.setChatFontSize(Number(e.target.value)),
        step: 1,
        type: 'range',
        value: chatFontSize,
      }),
      h('span', { className: 'dsh-wel-settings-value' }, `${chatFontSize}px`)),
    h('div', { className: 'dsh-wel-file-colors-actions' },
      h('button', {
        className: 'dsh-wel-text-button',
        disabled: atSizeDefaults || undefined,
        onClick: () => { settingsStore.actions.setRowHeight(ROW_HEIGHT_DEFAULT); settingsStore.actions.setChatFontSize(CHAT_FONT_SIZE_DEFAULT) },
        title: '恢复为默认值',
        type: 'button',
      }, '恢复大小默认')),
    h('div', { className: 'dsh-wel-explorer-divider' }),
    h('div', { className: 'dsh-wel-settings-row' },
      h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-search-expand-default' }, '搜索结果显示'),
      h('select', {
        'aria-label': '搜索结果显示',
        className: 'dsh-wel-highlight-preset-select',
        id: 'dsh-wel-search-expand-default',
        onChange: e => settingsStore.actions.setExpandSearchMatches(e.target.value === 'expanded'),
        value: (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) ? 'expanded' : 'collapsed',
      },
        h('option', { value: 'expanded' }, '默认展开'),
        h('option', { value: 'collapsed' }, '默认折叠'))),
    h('div', { className: 'dsh-wel-file-colors-title' }, '文件图标颜色'),
    h('div', { className: 'dsh-wel-file-colors' },
      FILE_COLOR_GROUPS.map(({ group, label }) => h('div', { className: 'dsh-wel-file-color-row', key: group },
        h('span', { className: 'dsh-wel-file-color-name', title: label }, label),
        h('input', {
          'aria-label': `${label} 颜色`,
          className: 'dsh-wel-file-color-input',
          onChange: e => settingsStore.actions.setFileColor(group, e.target.value),
          type: 'color',
          value: fileColorOf(settings, group),
        }),
        h('button', {
          className: 'dsh-wel-file-color-reset',
          disabled: settings.fileColors?.[group] === undefined || undefined,
          onClick: () => settingsStore.actions.resetFileColor(group),
          title: `恢复 ${label} 的默认颜色`,
          type: 'button',
        }, '重置'),
      ))),
    h('div', { className: 'dsh-wel-file-colors-actions' },
      h('button', {
        className: 'dsh-wel-text-button',
        disabled: customizedCount === 0 || undefined,
        onClick: () => settingsStore.actions.resetFileColors(),
        type: 'button',
      }, '恢复全部默认颜色')),
    h('div', { className: 'dsh-wel-explorer-divider' }),
    h('div', { className: 'dsh-wel-file-colors-title' }, '代码高亮预设'),
    h('div', { className: 'dsh-wel-file-colors' },
      FILE_COLOR_GROUPS.map(({ group, label }) => h('div', { className: 'dsh-wel-file-color-row', key: `preset-${group}` },
        h('span', { className: 'dsh-wel-file-color-name', title: label }, label),
        h('select', {
          'aria-label': `${label} 高亮预设`,
          className: 'dsh-wel-highlight-preset-select',
          onChange: e => settingsStore.actions.setHighlightPreset(group, e.target.value),
          value: highlightPresetOf(settings, group),
        },
          HIGHLIGHT_PRESETS.map(preset => h('option', { key: preset.id, value: preset.id }, preset.label))),
        h('button', {
          className: 'dsh-wel-file-color-reset',
          disabled: settings.highlightPresets?.[group] === undefined || undefined,
          onClick: () => settingsStore.actions.resetHighlightPreset(group),
          title: `恢复 ${label} 的默认高亮预设`,
          type: 'button',
        }, '重置'),
      ))),
    h('div', { className: 'dsh-wel-file-colors-actions' },
      h('button', {
        className: 'dsh-wel-text-button',
        disabled: customizedPresetCount === 0 || undefined,
        onClick: () => settingsStore.actions.resetHighlightPresets(),
        type: 'button',
      }, '恢复全部默认预设')),
    h('div', { className: 'dsh-wel-settings-hint' }, '调整左侧文件树的行高、对话文字大小与搜索结果显示方式；图标徽标按文件类型配色，并为每种文件类型选择编辑器代码高亮预设，未修改的项使用默认值。'),
  )
}
function ExplorerToggle(props) {
  // The explorer pane store is a shared engine instance passed through the
  // inject face (like AppFrame's), not a store-seat handle: the store seat
  // resolves instances by calling handle.create(), which an already-created
  // instance does not provide. Reading the instance directly keeps one shared
  // geometry store between this toggle and the AppFrame.
  const open = useSyncExternalStore(props.explorerPaneStore.subscribe, props.explorerPaneStore.getSnapshot)
  const label = open ? '关闭资源管理器' : '打开资源管理器'
  return h('button', {
    'aria-expanded': open,
    'aria-label': label,
    'aria-pressed': open,
    className: 'dsh-wel-explorer-toggle',
    'data-open': open || undefined,
    'data-rail': !props.wide || undefined,
    onClick: () => props.explorerPaneStore.actions.toggleExplorer(),
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-wel-explorer-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M9 5v14M12.5 9h4.5M12.5 12h4.5M12.5 15h3', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.6 })),
    props.wide ? h('span', { className: 'dsh-wel-explorer-label' }, '资源管理器') : null,
  )
}
function AppFrame(props) {
  const panels = props.useStore(state => state)
  const previewPanels = useSyncExternalStore(props.previewSessionsStore.subscribe, props.previewSessionsStore.getSnapshot)
  const settings = useSyncExternalStore(props.settingsStore.subscribe, props.settingsStore.getSnapshot)
  const panes = useSyncExternalStore(props.explorerPaneStore.subscribe, props.explorerPaneStore.getSnapshot)
  // Mirror the runtime sidebar width into the persisted explorer pane store:
  // the layout store owns the live value but cannot persist wholesale (it also
  // carries large file drafts), so the pane store's small layout value is the
  // durable copy, rehydrated into the layout store's init on the next load.
  const sidebarMirrorRef = useRef(null)
  useLayoutEffect(() => {
    if (sidebarMirrorRef.current !== panels.sidebar) {
      sidebarMirrorRef.current = panels.sidebar
      props.explorerPaneStore.actions.setSidebar(panels.sidebar)
    }
  }, [panels.sidebar, props.explorerPaneStore])
  const chatFontScale = (settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT) / CHAT_FONT_SIZE_DEFAULT
  // One accent custom property per color group; unset groups resolve to their
  // default inside the CSS rule's var() fallback (the value here is the
  // effective color either way, so the fallback is only a safety net).
  const fileColorVars = {}
  for (const { group } of FILE_COLOR_GROUPS) fileColorVars[`--dsh-wel-file-${group}`] = fileColorOf(settings, group)
  const currentSession = props.useSessions(state => state.current)
  const sessionIds = props.useSessions(state => state.ids)
  // The session rename dialog targets the current session id.
  const sessionId = currentSession
  // The workspace-files panel header names the current session (its durable
  // title) instead of a fixed label, so the browsing panel reads as belonging
  // to the session being worked on; fall back when no session is selected.
  const sessionTitle = props.useSessions(state => state.current === undefined
    ? undefined
    : state.byId[state.current]?.title)
  const currentCwd = props.useSessions(state => state.current === undefined
    ? undefined
    : state.byId[state.current]?.cwd)
  const detailsCapable = props.useSessions(state => state.current !== undefined
    && state.byId[state.current]?.blank === false)
  const workspaces = props.useWorkspaces(state => state.items)
  const recent = props.useWorkspaces(state => state.recentWorkspaceId)
  const [resizing, setResizing] = useState(false)
  const [chatDropActive, setChatDropActive] = useState(false)
  // Migration: entries persisted before clean-tab drafts were slimmed carry
  // full file text on every tab; re-serializing them on every write keeps the
  // whole value over the localStorage quota. Re-write them once through the
  // slimming path (dirty drafts are preserved, clean text dropped). Idempotent:
  // after migration no entry has fat clean tabs, so the guard skips.
  useEffect(() => {
    const sessions = previewPanels?.previewSessions
    if (sessions === undefined || typeof sessions !== 'object') return
    const hasFat = Object.values(sessions).some(value =>
      (value?.tabs ?? []).some(tab => tab?.dirty === false && typeof tab?.draft === 'string' && tab.draft !== ''))
    if (!hasFat) return
    for (const key of Object.keys(sessions)) {
      const value = sessions[key]
      if (value === undefined) continue
      const fat = (value?.tabs ?? []).some(tab => tab?.dirty === false && typeof tab?.draft === 'string' && tab.draft !== '')
      if (!fat) continue
      props.previewSessionsStore.actions.rememberPreviewSession(key, serializePreviewSession(value.activePath, value.tabs, value.expanded ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const workspace = useMemo(() => currentSession !== undefined
    ? workspaces.find(item => item.sessionIds.includes(currentSession) || item.path === currentCwd)
    : workspaces.find(item => item.workspaceId === recent),
  [currentCwd, currentSession, recent, workspaces])
  const workspaceId = workspace?.workspaceId
  const publishEditorContext = useCallback((value) => {
    if (currentSession !== undefined) props.publishEditorContext(String(currentSession), value)
  }, [currentSession, props.publishEditorContext])
  useEffect(() => {
    if (currentSession !== undefined) props.activateEditorSession(String(currentSession))
  }, [currentSession, props.activateEditorSession])
  const persistWorkspaceDraft = useCallback((value) => {
    if (workspaceId !== undefined) props.actions.rememberDraft(String(workspaceId), value)
  }, [props.actions, workspaceId])
  const clearWorkspaceDraft = useCallback(() => {
    if (workspaceId !== undefined) props.actions.clearDraft(String(workspaceId))
  }, [props.actions, workspaceId])
  const previewSessionSelection = selectStoredPreviewSession(previewPanels.previewSessions, workspace, currentSession, workspaceId)
  const previewSessionKey = previewSessionSelection.key
  const storedPreviewSession = previewSessionSelection.value
  // Skip a redundant 3-key rewrite when this exact key-set already holds the
  // same snapshot: each write serializes and stores the whole previewSessions
  // value, so repeated identical writes (e.g. a persisted layout effect firing
  // with unchanged state) are pure cost. Keyed per key-set, because switching
  // sessions legitimately writes the same snapshot to a different key-set.
  const lastPersistedSnapshotRef = useRef(new Map())
  const persistPreviewSession = useCallback((value) => {
    // Write the latest snapshot to every key the restore may pick: the current
    // session key (highest restore priority), the selected key (which falls
    // back to the workspace key when the session has no own snapshot yet), and
    // the workspace anchor. Writing only the selected key left the session key
    // stale once the workspace fallback took over, and the restore then
    // preferred that stale session snapshot ("tabs reverted to old state").
    const keys = new Set()
    if (previewSessionKey !== undefined) keys.add(previewSessionKey)
    if (currentSession !== undefined) keys.add(String(currentSession))
    if (workspaceId !== undefined) keys.add(String(workspaceId))
    if (keys.size === 0) return
    const keySet = [...keys].sort().join('|')
    const serialized = JSON.stringify(value)
    if (lastPersistedSnapshotRef.current.get(keySet) === serialized) return
    lastPersistedSnapshotRef.current.set(keySet, serialized)
    if (lastPersistedSnapshotRef.current.size > 128) lastPersistedSnapshotRef.current.clear()
    for (const key of keys) props.previewSessionsStore.actions.rememberPreviewSession(key, value)
  }, [currentSession, previewSessionKey, props.previewSessionsStore, workspaceId])
  const last = useRef(currentSession)
  const viewportRef = useRef(null)
  const chatSectionRef = useRef(null)
  const chatDropSuppressed = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  useEffect(() => {
    const liveSessionIds = sessionIds.map(String)
    props.retainEditorSessions(liveSessionIds)
  }, [props.retainEditorSessions, sessionIds])
  useLayoutEffect(() => {
    if (!detailsCapable) props.actions.closeDetails()
    else if (last.current !== undefined && last.current !== currentSession) props.actions.closeDetails()
    last.current = currentSession
  }, [detailsCapable, currentSession, props.actions])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return undefined
    const measure = () => { setViewportWidth(viewport.getBoundingClientRect().width) }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(viewport)
    return () => { observer.disconnect() }
  }, [])
  // Chat drop mask: track file drags over the chat pane (capture phase, but
  // without stopping propagation so the harness composer still receives the
  // drop and attaches images per its original behavior). The mask is drawn by
  // this layout and covers only the chat pane; the harness's full-viewport
  // mask is hidden by CSS. Enter/leave use a depth counter (dragleave's
  // relatedTarget is null in Chrome, so a contains() check would hide the mask
  // on the first child transition). Closing the mask suppresses it for the
  // current drag until the drag ends or is dropped.
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    let depth = 0
    const hide = () => {
      depth = 0
      chatDropSuppressed.current = false
      setChatDropActive(false)
    }
    const onDragEnter = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth += 1
      setChatDropActive(true)
    }
    const onDragOver = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      setChatDropActive(true)
    }
    const onDragLeave = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) hide()
    }
    const onDrop = () => { hide() }
    const onDragEnd = () => { hide() }
    section.addEventListener('dragenter', onDragEnter, true)
    section.addEventListener('dragover', onDragOver, true)
    section.addEventListener('dragleave', onDragLeave, true)
    section.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      section.removeEventListener('dragenter', onDragEnter, true)
      section.removeEventListener('dragover', onDragOver, true)
      section.removeEventListener('dragleave', onDragLeave, true)
      section.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])
  const asideRef = useRef(null)
  // The sidebar shell (harness ui-sidebar SidebarRoot) owns the New Session
  // button and the browsing region, and its slots cannot be redeclared by this
  // plugin. Instead two DOM containers are maintained inside the shell — the
  // top actions row (replacing the hidden New Session button) and the files
  // region seat — and this plugin renders its own React content into them via
  // portals. The observer re-asserts the containers on structural rebuilds;
  // in-place React updates leave foreign nodes alone, so nothing flickers.
  const [sidebarChrome, setSidebarChrome] = useState(null)
  useLayoutEffect(() => {
    const aside = asideRef.current
    if (aside === null) return undefined
    const ensure = () => {
      const rootDiv = aside.querySelector('[data-slot="sidebar"] > div')
      if (rootDiv === null) return null
      let top = rootDiv.querySelector(':scope > .dsh-wel-sidebar-top-actions')
      if (top === null) {
        top = document.createElement('div')
        top.className = 'dsh-wel-sidebar-top-actions'
        rootDiv.insertBefore(top, rootDiv.querySelector(':scope > button'))
      }
      const workspacesOutlet = rootDiv.querySelector(':scope [data-slot="sidebar.workspaces"]')
      let files = null
      if (workspacesOutlet !== null) {
        const regionArea = workspacesOutlet.parentElement
        if (regionArea !== null) {
          files = regionArea.querySelector(':scope > .dsh-wel-sidebar-files')
          if (files === null) {
            files = document.createElement('div')
            files.className = 'dsh-wel-sidebar-files'
            regionArea.append(files)
          }
        }
      }
      return { top, files }
    }
    let current = ensure()
    if (current !== null) setSidebarChrome(current)
    const observer = new MutationObserver(() => {
      const next = ensure()
      if (next === null) return
      setSidebarChrome(prev => (prev !== null && prev.top === next.top && prev.files === next.files ? prev : next))
    })
    observer.observe(aside, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      setSidebarChrome(null)
      aside.querySelectorAll('.dsh-wel-sidebar-top-actions, .dsh-wel-sidebar-files').forEach(node => node.remove())
    }
  }, [])
  const collapsed = panels.sidebar === 0
  const view = panels.view === 'files' ? 'files' : 'sessions'
  const filesMode = view === 'files'
  const filesActive = filesMode && !collapsed
  const sidebarMax = viewportWidth > 0
    ? Math.max(SIDEBAR_MIN, Math.floor(viewportWidth * SIDEBAR_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK
  const sidebar = collapsed ? SIDEBAR_COLLAPSED : clamp(panels.sidebar, SIDEBAR_MIN, sidebarMax)
  // Measure the viewport, not the grid frame: the conversation column can now shrink without a fixed floor.
  const leftStackMax = viewportWidth > 0
    ? Math.max(sidebar + TREE_MIN + PREVIEW_MIN, Math.floor(viewportWidth * EXPLORER_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK + TREE_MAX + PREVIEW_MAX
  const explorerMax = Math.max(TREE_MIN + PREVIEW_MIN, leftStackMax - sidebar)
  // The workspace file tree lives exclusively in the sidebar files region and
  // is revealed there only in the files view; the main frame's tree track
  // stays at zero, so opening the explorer shows only the file preview next to
  // the chat. The tree always portals into the sidebar seat (hidden while in
  // the sessions view) and the preview is never displaced by it.
  const tree = 0
  const previewMax = Math.max(PREVIEW_MIN, explorerMax - tree)
  const preview = filesActive || panes.explorerOpen ? clamp(panes.preview ?? PREVIEW_DEFAULT, PREVIEW_MIN, previewMax) : 0
  const previewBoundary = sidebar + preview
  const treePortalTarget = sidebarChrome?.files ?? null
  return h('div',{ref:viewportRef,className:'dsh-wel-viewport'},h('main',{className:'dsh-wel-frame','data-explorer-closed':!panes.explorerOpen&&!filesActive||undefined,'data-sidebar-collapsed':collapsed||undefined,'data-sidebar-files':filesActive||undefined,'data-resizing':resizing||undefined,style:{'--dsh-wel-preview':`${preview}px`,'--dsh-wel-sidebar':`${sidebar}px`,'--dsh-wel-row-height':`${settings.rowHeight ?? ROW_HEIGHT_DEFAULT}px`,'--dsh-wel-chat-font-scale':String(chatFontScale),...fileColorVars}},h('aside',{className:'dsh-wel-sidebar',ref:asideRef},props.renderSlot('sidebar',{collapsed,width:sidebar}),sidebarChrome?.top?createPortal(h(SidebarTopActions,{collapsed,view,width:sidebar,onSelectSessions:()=>{props.actions.setView('sessions')},onSelectFiles:()=>{if(collapsed)props.toggleSidebar();props.actions.setView('files')}}),sidebarChrome.top):null),workspace?h(WorkspaceExplorer,{key:previewSessionKey ?? workspace.workspaceId,clearDraft:clearWorkspaceDraft,createEntry:props.createEntry,listDirectory:props.listDirectory,persistDraft:persistWorkspaceDraft,persistPreviewSession,publishEditorContext,readFile:props.readFile,renameEntry:props.renameEntry,saveFile:props.saveFile,settingsStore:props.settingsStore,storedDraft:panels.drafts[String(workspace.workspaceId)],storedPreviewSession,sessionTitle,sessionId,renameSession:props.renameSession,treePortalTarget,workspace}):h(EmptyWorkspaceExplorer,{sessionTitle,treePortalTarget}),h('section',{className:'dsh-wel-chat',ref:chatSectionRef},props.renderSlot('conversation',{}),chatDropActive?h('div',{className:'dsh-wel-chat-drop-mask',role:'presentation'},h('button',{'aria-label':'关闭拖放提示',className:'dsh-wel-chat-drop-close',onClick:()=>{chatDropSuppressed.current=true;setChatDropActive(false)},title:'关闭',type:'button'},'×'),h('div',{className:'dsh-wel-chat-drop-card'},'松开以添加图片')):null),!collapsed?h(ResizeHandle,{label:'调整会话面板宽度',left:sidebar,max:sidebarMax,min:SIDEBAR_MIN,onDragging:setResizing,onResize:width=>props.actions.setSidebar(width,sidebarMax),value:sidebar}):null,(panes.explorerOpen||filesActive)?h(ResizeHandle,{label:'调整文件预览宽度',left:previewBoundary,max:previewMax,min:PREVIEW_MIN,onDragging:setResizing,onResize:width=>props.explorerPaneStore.actions.setPreview(width,previewMax),value:preview}):null,h('aside',{className:'dsh-wel-details','data-closed':!panels.detailsOpen||!detailsCapable||undefined},props.renderSlot('details',{})),h('div',{className:'dsh-wel-overlay','data-shell-overlay':true},props.renderSlot('shell.overlay',{}))))}

export const inject = ['slots', 'theme', 'sessions']
export function apply(ctx) {
  const layout = new LayoutController()
  const layoutStore = createLayoutStore()
  const previewSessionsStore = createPreviewSessionStore().create()
  const settingsStore = createExplorerSettingsStore().create()
  const explorerPaneStore = createExplorerPaneStore().create()
  const editorContexts = new EditorContextController()
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    for (const stale of document.querySelectorAll(`style[data-plugin-css="${PACKAGE_ID}/layout"]`)) stale.remove()
    const tag = document.createElement('style')
    tag.dataset.plugin = PACKAGE_ID
    tag.dataset.pluginCss = `${PACKAGE_ID}/layout`
    tag.textContent = styles
    document.head.append(tag)
    return () => tag.remove()
  }, 'workspace-explorer-layout: styles')
  ctx.effect(() => installEditorContextMessageCompactor(), 'workspace-explorer-layout: compact logged editor context')
  const listDirectory = (workspaceId, path, signal) => requestJson('tree', String(workspaceId), path, signal)
  const readFile = (workspaceId, path, signal, encoding) => requestJson('file', String(workspaceId), path, signal, encoding)
  const saveFile = (workspaceId, path, content, revision, signal, encoding) => putFile(workspaceId, path, content, revision, signal, encoding)

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: layoutStore,
      inject: (actions) => {
        layout.attach(actions)
        return {
          createEntry: (workspaceId, path, kind, name, signal) => createWorkspaceEntry(workspaceId, path, kind, name, signal),
          listDirectory,
          publishEditorContext: (sessionId, value) => { editorContexts.update(sessionId, value) },
          activateEditorSession: sessionId => { editorContexts.activate(sessionId) },
          renameEntry: (workspaceId, path, name, signal) => renameWorkspaceEntry(workspaceId, path, name, signal),
          retainEditorSessions: sessionIds => { editorContexts.retain(sessionIds) },
          readFile,
          explorerPaneStore,
          previewSessionsStore,
          saveFile,
          settingsStore,
          toggleSidebar: () => { layout.toggleSidebar() },
          renameSession: async (sessionId, title) => {
            const session = ctx.sessions.binding(String(sessionId))?.session
            if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
            const result = await session.rename(title)
            if (!result.ok) throw new Error(result.error.message)
          },
        }
      },
    }, AppFrame)
    return () => {
      disposeRegistration()
      void disposeService()
    }
  }, 'workspace-explorer-layout: service and root registration')
  const promptContextBridge = new PromptContextBridge(ctx, editorContexts)
  ctx.inject(['conversation'], scope => {
    scope.effect(
      () => promptContextBridge.install(),
      'workspace-explorer-layout: prompt context bridge',
    )
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: EDITOR_CONTEXT_PROVIDER,
    order: 30,
    inject: sessionId => ({
      hooks: { editorContext: editorContexts.storeFor(String(sessionId)) },
      toggle: () => { editorContexts.toggle(String(sessionId)) },
      ensureSession: id => { promptContextBridge.ensure(id) },
    }),
  }, EditorContextPrefix))
  ctx.effect(() => () => { editorContexts.dispose() }, 'workspace-explorer-layout: editor context state')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'workspace-explorer-toggle', order: 100,
    inject: () => ({ explorerPaneStore }),
  }, ExplorerToggle))
  // The browser Settings page owns every explorer preference in one section:
  // file-tree row height, chat font size, and the per-group icon color scheme
  // (unset groups resolve to their defaults).
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'workspace-explorer', order: 5, label: '资源管理器设置',
    inject: () => ({ settingsStore }),
  }, ExplorerSettingsSection))
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => presenter.apply(snapshot))
    return () => {
      off()
      presenter.dispose()
    }
  }, 'workspace-explorer-layout: theme presenter')
}
