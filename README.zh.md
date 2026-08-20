# DeepSeek Harness 工作区四栏布局插件

[English](README.md) | 中文

此 bundle 将 DeepSeek Harness Web 的根布局替换为：

```text
Session/workspace selector | Current workspace file tree | Highlighted file view and guarded editor | Chat
```

插件保留现有侧栏、会话、详情和全局浮层的 Slot 合约，因此内置的新建会话、工作区会话列表、设置、聊天、工具详情、审批等功能仍由原插件提供。工具详情打开时以右侧抽屉覆盖在四栏布局上，不额外占用常驻栏位。

## 功能

- 当前会话归属某个 Workspace 时，自动显示该 Workspace 的文件树。
- 当前会话的 `cwd` 与 Workspace 路径一致时，也能识别该 Workspace（适用于部分子会话）。
- 目录按“目录优先、文件其次”排列，支持逐级展开、折叠和手动刷新。
- 单击文件后，CodeMirror 6 根据特殊文件名或后缀显示行号和语法高亮；未知类型按纯文本显示。
- 通过现有的 Session 级输入 dock，把打开文件显示为输入框外的不可编辑 Composer 前缀；键盘编辑、剪切、撤销和选区都无法删除它。点击可按当前 Session 在启用与持续灰色之间切换。
- 每次启用发送都会在发送边界冻结编辑器上下文，并渲染成两种提示封装之一：文件模式使用 `<opened_file>...</opened_file>`，选中文本模式使用 `<selection>...</selection>`。没有选区时只发送打开文件的封装，不包含文件字节。灰色发送不附加上下文；“发送上下文”按钮支持不添加草稿文字的上下文-only 发送。
- Host 校验请求，渲染封装文本，并把它拼接到直接用户提示前面。在对话页面里，插件会把这段封装折叠成气泡上方的一行摘要，只显示文件名和行列范围；鼠标悬浮在这行上会显示完整的注入 XML。原始封装仍保留在普通用户消息历史中，每个启用回合独立发送，不按 hash 去重。
- 允许显式进入编辑模式，并提供“保存”“取消”及 `Ctrl/Cmd+S`；插件不会自动保存。
- 切换文件时不会静默丢弃未保存内容，必须先保存、放弃或继续编辑；关闭资源管理器仍会保留当前编辑状态。
- 打开的文件会进入按 Session 保存的预览标签页，可用 `X` 关闭、通过拖拽重排；选中标签页时会在左侧树中定位到对应文件，并恢复该标签页的垂直滚动位置。
- 切换会话或 Workspace 时，Workspace 草稿缓存仍留在页面内存里；已打开的预览标签页及其垂直滚动位置会在重载后、以及返回原 Session 或 Workspace 时恢复。草稿缓存不写入 `localStorage`，预览标签页使用浏览器持久化。
- 保存使用读取时的文件修订版本。磁盘内容已变化时保留草稿并报告冲突，不会自动覆盖。
- 二进制文件、非 UTF-8 文件和工作区外部符号链接会被拒绝；被截断的大文件、混合换行文件和经过符号链接的路径只读。
- 可在选中层级新建文件和文件夹，并用 `F2` 重命名选中的文件或文件夹；仍不提供删除或上传接口。
- 左侧侧边栏底部、设置按钮正上方提供“资源管理器”开关；按钮在宽侧栏和折叠栏中的尺寸、间距及悬停效果与设置入口保持一致，并用主题主色表示已开启。
- `sidebar.footer.action` 中的扩展按钮按纵向独立行排列，因此 Mobile Preview、资源管理器和设置入口不会挤在同一行。
- 关闭资源管理器会同时收起文件树和文件编辑栏，让聊天框紧邻侧边栏；再次打开时恢复原有栏宽、目录展开和文件选择状态。
- 会话栏、文件树栏和文件编辑栏均可拖动调整宽度；资源管理器打开时，左侧栏位组可以继续扩展到可见布局的 80%，右侧对话栏可以继续被压缩，现有侧栏展开/收起按钮继续有效。
- 大目录、大文件、条目名称和新建/重命名请求正文都使用可配置上限，默认每个目录最多显示 1000 项、文件最多浏览和编辑 1 MiB、条目名称最多 255 UTF-8 字节、新建/重命名请求正文最多 4 KiB。
- 使用 Harness 的主题语义变量，支持亮色、暗色与系统主题。

## 语法高亮

首版内置 JavaScript/JSX、TypeScript/TSX、JSON、HTML、CSS/SCSS/Less、Markdown/MDX、Python、SQL、XML/SVG、YAML、C/C++、Java、Rust、PHP、Go、Shell、PowerShell、Ruby、TOML 和 Dockerfile 高亮。`Makefile`、`.gitignore`、`.env`、`LICENSE` 及未知扩展名仍可浏览和编辑，并以纯文本模式显示。

## 安装

在 Git Bash、Linux 或 WSL 中执行：

```sh
cd C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-explorer-layout
bash ./install.sh
```

默认安装到 `web` profile。也可显式指定 profile：

```sh
bash ./install.sh web
```

脚本优先使用 PATH 中的 `dsh`；若当前目录属于 DeepSeek Harness 源码 checkout 且 PATH 中没有 `dsh`，脚本会自动使用 `pnpm --dir <harness-root> dsh`。也可通过 `DSH_BIN` 指定一个不带附加参数的可执行文件：

```sh
DSH_BIN=/path/to/dsh bash ./install.sh web
```

安装完成后，停止并重新启动原有 Web 进程，然后刷新 `http://127.0.0.1:3080`。安装脚本不会启动第二个服务器。

## 卸载

```sh
bash ./uninstall.sh
```

卸载后同样需要重启原有 Web 进程。移除 bundle layer 后，内置 `ui-layout` 会自动恢复。

## 配置

`cordis.patch.yml` 中的插件 row 接受：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enableEditing` | `false` | 是否启用 Host 写入接口；本 bundle 的 patch 显式设为 `true`。 |
| `maxContextBytes` | `65536` | 资源管理器对选中文本执行的 UTF-8 字节预检上限，范围 1024–1048576；仅路径上下文不提交文件字节。 |
| `maxPromptContextBytes` | `69632` | Host 对完整渲染上下文的上限，包括 `<opened_file>...</opened_file>` 或 `<selection>...</selection>` 封装以及选中文本，范围 4096–2097152。 |
| `maxContextSourceBytes` | `10485760` | clean revision 校验时最多读取的原始文件字节数，范围 1024–104857600；dirty 或截断选区使用浏览器提交的文本。 |
| `maxEditableBytes` | `1048576` | 单个文件允许保存的最大 UTF-8 字节数，范围 1024–10485760。 |
| `maxEntryNameBytes` | `255` | 单个新建或重命名条目的名称允许的最大 UTF-8 字节数，范围 1–1024。 |
| `maxEntriesPerDirectory` | `1000` | 单个目录返回的最大条目数，范围 1–10000。 |
| `maxMutationBodyBytes` | `4096` | create 和 rename 请求允许的最大 JSON 字节数，范围 128–65536。 |
| `maxPreviewBytes` | `1048576` | 单个文件读取并返回的最大字节数，范围 1024–10485760。 |

需要修改时直接编辑 bundle 的 `cordis.patch.yml`。为避免 pnpm 复用已安装的本地 `file:` 副本，请先运行 `uninstall.sh`，再运行 `install.sh`，最后重启 Web 进程。

## 安全边界

Host 端接口只接受已登记的 Workspace ID 和相对路径。每次读取或写入都会解析真实路径，并确认目标仍位于 Workspace 的规范根目录内，因此 `..`、绝对路径以及跳出 Workspace 的符号链接无法访问。接口还执行与内置 `/api` 相同目的的 Host、Origin 与 Fetch-Metadata 来源检查。

写入接口仅在 `enableEditing` 开启时接受 `PUT`，正文必须是有上限的 UTF-8 文本；Host 在接收流上执行完整字节上限，并在请求提供 `Content-Length` 时校验声明长度。请求必须携带读取时取得的 `If-Match` 修订版本；版本不一致会返回冲突而不覆盖磁盘内容。写入目标必须是已存在且不经过任何符号链接的普通文件。create 和 rename 条目接口沿用相同的路径包含校验，要求单段名称，拒绝已存在目标，并不会覆盖无关路径。Host 通过同目录临时文件、文件同步和原子重命名提交内容，并尽量保留原文件权限模式。

编辑器上下文只接受拥有当前 Session 的 Workspace 内相对路径；拥有关系来自 Workspace membership projection，或来自 Session 的规范化 cwd。选区上下文携带主选区的精确文本和范围；仅路径上下文不携带文件字节，并渲染为固定的 `<opened_file>...</opened_file>` 封装。Host 拒绝符号链接，按磁盘修订版本校验 clean 选区，把选中文本渲染为固定的 `<selection>...</selection>` 封装，并返回给插件的发送桥；发送桥再把它拼接到直接提示前面，因此普通 Session 日志会记录实际模型可见上下文。对话页面会把这段封装折叠成气泡上方的一行摘要，只显示文件名和行列范围，而仅路径模式仍然不携带文件内容。干净选区的磁盘验证最多读取 10 MiB；`maxPreviewBytes` 导致预览截断时，发送可见选区文本并以浏览器为权威。历史只显示已记录的用户消息，不会重新读取当前编辑器或磁盘。

这些限制只约束资源管理器自己的文件接口与 Composer 上下文，不改变 agent 的权限策略、沙箱或工具能力。该接口为受信任本地 UI 操作提供应用级路径包含校验，不替代 Harness 针对恶意并发本机代码的内核级沙箱。

## 项目结构

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
        └── client.js                    # Prebuilt four-pane layout, file tree, and editor
```

CodeMirror 和语言模块已内联到预构建的普通 JavaScript Client bundle，安装时不需要在项目内运行构建或测试。维护源码时，可在内层包目录执行 `pnpm install --ignore-workspace --config.auto-install-peers=false`，然后执行 `pnpm bundle` 重新生成 `lib/client.js`。

## 兼容性说明

此版本针对提供现有 `conversation.input.dock` Slot、Session 输入 resolver 和 conversation send service 的 DeepSeek Harness `0.1.x` checkout 编写。编辑器上下文功能完全由本 bundle 实现，不要求修改 Harness 源码，也不要求结构化 Composer Context 核心扩展。发送桥有意适配 0.1.x 的具体 `sendSession`、输入提交和队列 steer seam，因为这些操作不是跨包公开 contract；未来 Harness 版本可能只需要更新 bundle 内的桥接代码。其他高优先级 profile/home patch 如果重新启用 `ui-layout`，会与本插件同时占用根 Slot；请保留本 bundle layer 对 `ui-layout` 的禁用设置。
