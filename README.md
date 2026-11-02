# CommitDock

macOS 边缘吸附小标签 + 浮层面板：管理本地 git 仓库路径，一键用本机 `pi --print` 生成中文 Conventional Commit 并无确认地 `git add -A && git commit && git push`。

开源协议：**MIT**

## 产品行为（v0.1 骨架）

- 无独立主窗口（**macOS 待实现**：NSPanel / 边缘吸附；当前 Linux/macOS 开发态为普通 Tauri 窗口 + 左侧 Tag 壳）
- 面板宽约 360pt：项目列表、常驻风险条、行内结果区
- **工作区干净**：主按钮**禁用**，行内显示「无变更」；**不会**调用 `pi`
- **有未提交变更**：主按钮「提交并推送」可用
- 进行中：「提交中…」+ 转圈；该行不可重复点击（**默认**：其他行仍可操作 — 见代码内 TODO）

## 本机环境预检

打开面板时会自动执行预检（Tauri 命令 `preflight` / `check_environment`，二者等价）。**未通过时**会禁用「添加项目」与所有「提交并推送」，并在面板顶栏显示一行说明与「重新检查」按钮。

| 检查项 | 含义 |
|---|---|
| `pi_path` | `pi` 在 PATH 中（`command -v pi` / `where pi`） |
| `pi_print` | `pi --print` 能以非交互方式启动（短探测提示，12 秒超时） |
| `git` | 本机可执行 `git` |

固化提交提示词（`PI_COMMIT_PROMPT`）为应用内置常量，**不参与**预检列表；仅在开发构建中以 `debug_assert`/单测保证非空。

`run_commit_push` 在服务端会再次预检；未就绪直接返回错误，**不会**调用 `pi`。工作区干净时仍禁用主按钮且不调用 `pi`（与预检无关）。

手动验证（开发态）：

```bash
cd src-tauri && cargo test preflight::
```

## 前置依赖

- [Rust](https://www.rust-lang.org/)（Tauri 2）
- [Node.js](https://nodejs.org/) 18+
- 本机已安装 **`pi`** CLI，且在 `PATH` 中（与 pi-git-shortcuts 类似，App 侧仅非交互调用）
- macOS 上另需 [Tauri 前置工具](https://tauri.app/start/prerequisites/#macos)

## 在 macOS 上运行

```bash
npm install
npm run tauri dev
```

构建 `.app`：

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/macos/`。

## `pi` 调用方式

在**项目目录**下执行（Rust 常量 `PI_COMMIT_PROMPT`，后续可改为配置项）：

```bash
pi --print '<固化提示词>'
```

当前固化提示词（摘要）：

> 你是 CommitDock 提交助手。根据 git status / diff 生成一条 Conventional Commits 标题（type 英文，冒号后中文简述）。只输出一行提交信息。

成功拿到一行提交标题后，App 在同一目录执行：

```bash
git add -A && git commit -m '<消息>' && git push
```

## 在 Linux（CI / Cloud Agent）上构建

可编译前端 + Rust；完整 GUI 需 `webkit2gtk` 等（见 [Tauri Linux 依赖](https://tauri.app/guides/prerequisites/#linux)）。**边缘吸附、透明浮层、Finder 集成**等为 macOS 后续工作，已在代码中标注 TODO。

```bash
npm install
npm run build
cd src-tauri && cargo build
```

## 数据持久化

项目列表保存在应用数据目录下的 `projects.json`（路径 + 显示名）。

## 设计待定（README 默认）

| 项 | 本脚手架默认 |
|---|---|
| Tag 图标 vs「CD」文字 | 暂用「CD」 |
| 失败结果区默认展开 | 默认折叠 |
| 多项目并行提交 | 允许其他行在一条 running 时仍可点（TODO 注释） |
| 一键清理干净工作区 | 底部占位按钮，disabled |

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 仅 Vite 前端（端口 4721） |
| `npm run tauri dev` | Tauri 开发 |
| `npm run tauri build` | 生产构建 |

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
