# DeepSeek Harness 工作区四栏布局插件

[English](README.en.md) | 中文

此 bundle 将 DeepSeek Harness Web 的根布局替换为四栏：Session/工作区选择器、当前工作区文件树、高亮文件视图与受控编辑器、聊天。插件保留现有侧栏、会话、详情与全局浮层的 Slot 合约，内置的新建会话、会话列表、设置、聊天、工具详情、审批等仍由原插件提供；工具详情以右侧抽屉覆盖在四栏布局上，不额外占用常驻栏位。

## 功能

- 会话属于某 Workspace 时自动显示其文件树（会话 `cwd` 与 Workspace 路径一致时同样识别）；目录优先于文件排列，支持逐级展开、折叠与手动刷新。
- CodeMirror 6 按文件名或后缀显示行号与语法高亮，未知类型按纯文本显示。
- 预览编辑器中 `Ctrl+K+J` 展开所有已折叠区域；`Ctrl+K+1..9` 按层级折叠代码（如 `Ctrl+K+2` 折叠所有第二层级的折叠区域）。
- 显式进入编辑模式，提供“保存”“取消”与 `Ctrl/Cmd+S`，不会自动保存；切换文件不会静默丢弃未保存内容。
- 打开的文件进入按 Session 保存的预览标签页：可 `X` 关闭、拖拽重排，选中时在树中定位并恢复垂直滚动位置；标签页跨重载恢复，草稿缓存保留在页面内存、不写入 `localStorage`。
- 保存按读取时的文件修订版本执行；磁盘内容已变化时保留草稿并报告冲突，不自动覆盖。
- 拒绝二进制、非 UTF-8 与工作区外符号链接；截断的大文件、混合换行文件与经符号链接的路径只读。
- 可在选中层级新建文件/文件夹，`F2` 重命名；不提供删除或上传。
- 侧边栏底部、设置按钮上方提供“资源管理器”开关；关闭时收起文件树与编辑栏，重新打开时恢复栏宽、目录展开与文件选择。会话栏、文件树栏与编辑栏均可拖动调宽（打开时左侧最多 80%），布局参数与开关状态以 `localStorage` 全局持久化。
- 每类文件类型组可在资源管理器设置页选择编辑器高亮预设（默认、经典、暖色、冷色、单色、XML (VS Code)），按类型记忆于 `localStorage`。
- 目录条目、文件大小、条目名称与新建/重命名请求正文均设可配置上限（默认每目录 1000 项、文件 1 MiB、名称 255 字节、请求正文 4 KiB）。
- 编辑器上下文经现有输入 dock 显示为输入框外的不可编辑前缀：启用发送时冻结上下文，文件模式渲染 `<opened_file>...</opened_file>`、选中文本模式渲染 `<selection>...</selection>`（无选区时不携带文件字节），灰色发送不附加上下文；Host 校验并把它拼接到直接用户提示前，对话页折叠成气泡上方显示文件名与行列范围的一行摘要。
- 使用 Harness 主题语义变量，支持亮色、暗色与系统主题。

## 语法高亮

内置 JavaScript/JSX、TypeScript/TSX、JSON、HTML、CSS/SCSS/Less、Markdown/MDX、Python、SQL、XML/SVG、YAML、C/C++、Java、Rust、PHP、Go、Shell、PowerShell、Ruby、TOML 与 Dockerfile 高亮；`Makefile`、`.gitignore`、`.env`、`LICENSE` 与未知扩展名以纯文本显示，仍可浏览与编辑。

## 安装

在 Git Bash、Linux 或 WSL 中执行：

```sh
cd C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-explorer-layout
bash ./install.sh          # 默认安装到 web profile
bash ./install.sh web      # 也可显式指定 profile
```

脚本优先使用 PATH 中的 `dsh`；当前目录属于 Harness checkout 且 PATH 无 `dsh` 时自动使用 `pnpm --dir <harness-root> dsh`，也可用 `DSH_BIN` 指定可执行文件。安装完成后停止并重启原有 Web 进程，然后刷新 `http://127.0.0.1:3080`；脚本不会启动第二个服务器。

## 卸载

```sh
bash ./uninstall.sh
```

卸载后同样需要重启 Web 进程；移除 bundle layer 后内置 `ui-layout` 自动恢复。

## 配置

`cordis.patch.yml` 中插件 row 接受：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enableEditing` | `false` | 是否启用 Host 写入接口；本 bundle 显式设为 `true`。 |
| `maxContextBytes` | `65536` | 选中文本 UTF-8 预检上限（1024–1048576）；仅路径上下文不提交文件字节。 |
| `maxPromptContextBytes` | `69632` | Host 对完整渲染上下文（含封装与选中文本）的上限（4096–2097152）。 |
| `maxContextSourceBytes` | `10485760` | clean 修订校验最多读取的原始文件字节（1024–104857600）。 |
| `maxEditableBytes` | `1048576` | 单文件可保存的最大 UTF-8 字节（1024–10485760）。 |
| `maxEntryNameBytes` | `255` | 新建/重命名条目名称最大 UTF-8 字节（1–1024）。 |
| `maxEntriesPerDirectory` | `1000` | 单目录返回的最大条目数（1–10000）。 |
| `maxMutationBodyBytes` | `4096` | create/rename 请求最大 JSON 字节（128–65536）。 |
| `maxPreviewBytes` | `1048576` | 单文件读取并返回的最大字节（1024–10485760）。 |

改配置直接编辑 bundle 的 `cordis.patch.yml`；为避免 pnpm 复用已安装的本地 `file:` 副本，先运行 `uninstall.sh`，再运行 `install.sh`，最后重启 Web 进程。

## 安全边界

Host 接口只接受已登记的 Workspace ID 与相对路径，每次读写都解析真实路径并确认目标仍位于 Workspace 规范根目录内，`..`、绝对路径与跳出 Workspace 的符号链接均不可访问；接口同时执行与内置 `/api` 同目的的 Host、Origin 与 Fetch-Metadata 来源检查。

写入接口仅在 `enableEditing` 开启时接受 `PUT`，正文必须是有上限的 UTF-8 文本，且必须携带读取时的 `If-Match` 修订版本，版本不一致返回冲突而不覆盖；写入目标必须是已存在且不经过任何符号链接的普通文件。create/rename 沿用相同的路径包含校验，要求单段名称、拒绝已存在目标。Host 通过同目录临时文件、文件同步与原子重命名提交，并尽量保留原权限模式。

编辑器上下文只接受拥有当前 Session 的 Workspace 内相对路径（拥有关系来自 membership projection 或会话规范化 cwd）；仅路径上下文不携带文件字节。Host 拒绝符号链接，按磁盘修订校验 clean 选区，`maxPreviewBytes` 截断预览时以浏览器提交文本为权威，并把渲染文本拼接在直接提示前，因此普通 Session 日志记录实际模型可见上下文；对话页把它折叠成气泡上方显示文件名与行列范围的一行摘要，历史只渲染已记录的用户消息，不重新读取当前编辑器或磁盘。

这些限制只约束资源管理器自己的文件接口与 Composer 上下文，不改变 agent 的权限策略、沙箱或工具能力；接口为受信任本地 UI 操作提供应用级路径包含校验，不替代 Harness 的内核级沙箱。

## 项目结构

```text
.
├── package.json                         # Installable bundle manifest
├── cordis.patch.yml                     # 禁用内置根布局并挂载本插件
├── install.sh / uninstall.sh
└── packages/client/ui-workspace-explorer-layout/
    ├── src/client/index.js              # 浏览器源码
    ├── lib/index.js                     # Host：有界的 Workspace 读、保存、新建、重命名 API
    └── lib/client.js                    # 预构建四栏布局、文件树与编辑器
```

CodeMirror 与语言模块已内联到预构建的普通 JavaScript Client bundle，安装时无需在项目内运行构建或测试。维护源码时，在内层包目录执行 `pnpm install --ignore-workspace --config.auto-install-peers=false`，再运行 `pnpm bundle` 重新生成 `lib/client.js`。

## 兼容性说明

针对提供 `conversation.input.dock` Slot、Session 输入 resolver 与发送服务的 Harness `0.1.x` checkout 编写。编辑器上下文功能完全由本 bundle 实现，不要求修改 Harness 源码；发送桥适配 0.1.x 的具体 send/输入提交/队列 steer seam，未来版本可能只需更新 bundle 内桥接代码。其他高优先级 profile/home patch 若重新启用 `ui-layout`，会与本插件同时占用根 Slot；请保留本 bundle 对 `ui-layout` 的禁用设置。
