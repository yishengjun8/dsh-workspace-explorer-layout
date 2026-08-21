# @deepseek-ai/dsh-client-ui-workspace-explorer-layout

[English](README.md) | 中文

`@deepseek-ai/dsh-workspace-explorer-layout` bundle 的双面实现包。

- Node/Host 入口 `lib/index.js` 注册 `/workspace-explorer-layout/api`，按 Workspace ID 列目录、读取有上限的 UTF-8 文件，按 membership 或规范化 cwd 授权当前 Session，并在显式启用时通过修订版本校验、单段名称校验和原子替换保存已有普通文件，同时支持新建文件和文件夹以及重命名已有文件和文件夹。
- Browser 入口 `lib/client.js` 提供 `ctx.layout` 兼容服务，占用根 Slot，继续声明 `sidebar`、`conversation`、`details` 和 `shell.overlay`，在根布局内加入文件树及 CodeMirror 6 文件浏览器/编辑器，让打开后的资源管理器最多扩展到可见布局的 80% 并使右侧对话栏继续收缩，在树中提供新建文件/文件夹和 `F2` 重命名操作，并向 `sidebar.footer.action` 注册位于设置入口正上方的资源管理器开关。
- Browser 入口还通过现有 `conversation.input.dock` Slot 注册不可编辑的编辑器上下文行。前缀显示已打开文件路径和 CodeMirror 主选区，位于草稿之外，在列变窄时会跟随下方聊天框的宽度收缩，条本身略微加高，图标和文字也会稍微向右偏移，并可按 Session 在启用与持续灰色之间切换；草稿为空时还提供只发送上下文的操作。
- 文件树开头的类型徽标按文件类型颜色分组着色（目录、TypeScript、JavaScript、JSON、标记、样式、Markdown、日志、Python、C#、Shell、配置、C 系、其他、受阻）。浏览器设置页新增「资源管理器设置」标签页，把资源管理器的全部偏好集中在一起：文件树行高与对话文字大小滑块、按分组自定义的图标颜色方案（即时预览），以及按文件类型选择的代码高亮预设（默认、经典、暖色、冷色、单色，外加每种代码语言对应的 VS Code 配色与 Visual Studio 2022 配色）。每个语言分组默认采用各自的 VS Code 预设——XML、Python、JSON、TypeScript、JavaScript、CSS、Markdown、Shell、配置与 C/C++——而 C# 默认采用 Visual Studio 2022 预设——并支持一键恢复大小、全部颜色或全部预设。
- `lib/invariant.js` 声明包级 invariant companion；路径包含和写入资格校验在每次 Host 请求中执行。

layout 提供方有意不硬注入 `conversation`：conversation 插件本身消费 `layout`，因此 bundle 在激活后通过子注入 patch 现有 `sendSession` seam，并向 `conversation.input.dock` 注册编辑器上下文行，避免形成激活依赖环。

该包由外层 bundle 安装，不建议单独加入 profile。预构建 Client bundle 中第三方代码的许可证见 `THIRD_PARTY_NOTICES.md`。

## Known Limitations and Deferred Work

编辑器上下文发送桥适配 Harness 0.1.x 的具体 `sendSession`、输入提交和队列 steer 实现，因为跨包公开 face 不承载任意 Composer 上下文。这些 seam 都封装在本包内，并在卸载时恢复；未来 Harness 版本可能只需更新本 bundle。布局状态、展开目录、编辑器选区和 Workspace 草稿缓存都属于页面内存状态；预览标签页及其各自的垂直滚动位置会在重载后和返回原 Session 或 Workspace 时恢复。

## Model Experience

当前缀启用且 CodeMirror 主选区非空时，每次发送都会捕获该选区的精确文本、规范化工作区路径和范围，并渲染为 `<selection>...</selection>` 封装。选区为空时，每次发送只捕获打开文件路径，并渲染固定的 `<opened_file>...</opened_file>` 封装；不会提交完整文件。Browser 发送桥把渲染后的文本拼接到直接用户提示前面，因此普通 `user/message` 记录包含实际模型可见上下文。对话页面会把这段封装折叠成气泡上方的一行摘要，只显示文件名和行列范围，鼠标悬浮在这行上会显示完整的注入 XML。灰色前缀不贡献上下文；后续每个启用回合都会再次记录相同上下文。

#### Token and KV cache effect

选区上下文会增加 `<selection>...</selection>` 封装以及选中文本的输入 Token。资源管理器先按默认 65,536 UTF-8 字节限制预检选中文本，Host 默认将完整渲染限制为 69,632 字节，并且 clean revision 验证最多读取 10 MiB。截断预览使用浏览器权威的选区文本。仅路径上下文只增加 `<opened_file>...</opened_file>` 封装，不增加文件正文。每个启用回合都有自己的日志提示文本，因此在 compaction 前重复选区可能增加提示 Token。
