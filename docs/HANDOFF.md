# Asurada 工程交接

面向后续 **工程 / 设计 / 本人** 接手。产品范围以 [`REQUIREMENTS.md`](./REQUIREMENTS.md) 为准。

## 仓库与路径约定

| 项 | 值 |
|----|-----|
| 远程 | <https://github.com/LuckyYunPeng/asurada> |
| 建议本地目录名 | `asurada`（与 README 一致） |
| 示例路径 | `~/code/asurada` 或任意 clone 位置 |
| 应用数据（项目列表） | Tauri `app_data_dir` 下持久化（见 `src-tauri/src/store.rs`） |
| npm 包名 | `asurada` |
| Rust crate | `asurada` / `asurada_lib` |
| Bundle ID | `com.asurada.app` |

## 本地开发

**前置**：Node.js **18+**、Rust **stable ≥ 1.90**（`rust-toolchain.toml`）、macOS [Tauri 前置工具](https://tauri.app/start/prerequisites/#macos)、本机 **`pi`** 与 **`git`**。

```bash
git clone https://github.com/LuckyYunPeng/asurada.git
cd asurada
pnpm install
pnpm dev
```

| 命令 | 说明 |
|------|------|
| `pnpm dev:web` | 仅 Vite 前端，端口 **4721**（无 Tauri 命令） |
| `pnpm dev` | 完整桌面 App |
| `pnpm tauri build --bundles app,dmg` | 本地 mac 包，产物在 `src-tauri/target/release/bundle/` |
| `pnpm capture:artifacts` | 需先 `pnpm dev:web`；复拍 `artifacts/*.png`（见 `artifacts/README.md`） |

预检单测（Rust）：

```bash
cd src-tauri && cargo test preflight::
```

## 技术栈

| 层 | 选型 |
|----|------|
| 壳 | **Tauri 2** |
| 前端 | **React 19 + Vite 8 + TypeScript**（`src/`） |
| 后端命令 | Rust（`src-tauri/src/`：`commands`、`git`、`preflight`、`store`、**`macos_panel`**） |
| macOS 壳 | **`tauri-nspanel`**（git `ahkohd/tauri-nspanel` branch `v2.1`）+ `macos_panel.rs` |
| 插件 | `@tauri-apps/plugin-dialog`（选目录）、`tauri-plugin-opener`（capability 已开，UI 尚未用 Finder） |

### macOS 壳层（NSPanel / 托盘 / 启动策略）— **现状**

主窗口 `main` 为 **无装饰、透明、置顶** 的贴边壳（见 `tauri.conf.json`：`macOSPrivateApi`、初始逻辑尺寸约 **52×148** 收起态）。Rust 模块 **`macos_panel`**（`src-tauri/src/lib.rs` 注册）负责 native 行为；前端 React 仍渲染 **tag + 浮层面板**，通过 **`sync_dock_geometry`** 与 Rust 同步展开/收起。

| 能力 | 实现要点（代码为准） |
|------|----------------------|
| **`tauri-nspanel`** | `lib.rs` → `tauri_nspanel::init()`；`init_panel` 将 `main` 转为 `AsuradaPanel`（Floating level、nonactivating、全 Space / 全屏辅助 collection behavior） |
| **贴边几何** | `place_dock_window`：收起 **52×148** / 展开 **452×620**（Logical），锚定 **当前显示器右缘**、纵向约 **36%** 屏高；`sync_dock_geometry(expanded)` → `apply_panel_open` |
| **启动** | `setup`：`ActivationPolicy::Regular`（**Dock 可见**，见 commit `845b3a3`）；NSPanel 成功则 **默认展开** 并 `show_and_make_key`；失败 → `fallback_regular_window`（Regular + 置顶普通窗） |
| **setup 失败** | `setup` 整体 Err 时 `last_resort_show`：尽量 Regular + 置顶 + 展开尺寸 + `show`/`focus`，避免无 UI 退出 |
| **菜单栏托盘** | `setup_tray`：`显示面板` / `收起` / `退出`（左键出菜单）；调用 `apply_panel_open` 并 `emit("set-panel-open")` |
| **前后端同步** | `App.tsx`：`panelOpen` 变化时 `invoke("sync_dock_geometry")`；监听 `set-panel-open`；失焦 `tauri://blur` 与 **`dock-blur`**（NSPanel resign key）时 **自动收起** |
| **Accessory vs Regular** | **当前 Regular**（非 `LSUIElement` / Accessory）；若以后要「仅菜单栏、无 Dock」，需单独产品决策后再改 activation policy |

接手优先读：`src-tauri/src/macos_panel.rs` ↔ `src/App.tsx`（几何 + 收起逻辑）↔ `src/App.css`（tag/面板视觉）。

## 关键代码路径

```
asurada/
├── docs/REQUIREMENTS.md      # 产品范围
├── docs/HANDOFF.md           # 本文件
├── src/                      # React UI：引导、预检、列表、Toast、capture 场景
│   ├── App.tsx               # 主流程；sync_dock_geometry、set-panel-open、dock-blur
│   ├── introContent.ts       # 引导文案与预检 meta
│   ├── rowPresentation.ts    # 行状态 / 按钮禁用逻辑
│   └── captureMode.ts        # ?capture= 设计复拍（浏览器无 macos_panel）
├── src-tauri/
│   ├── src/lib.rs            # nspanel 插件、setup/setup_tray/last_resort_show、command 注册
│   ├── src/macos_panel.rs    # NSPanel、贴边尺寸、托盘、sync_dock_geometry
│   ├── src/commands.rs       # list/add/remove/commit/preflight
│   ├── src/git.rs            # pi --print、PI_COMMIT_PROMPT、add/commit/push
│   ├── src/preflight.rs      # pi_path / pi_print / git
│   ├── src/store.rs          # 项目 JSON 持久化
│   └── tauri.conf.json       # 透明贴边主窗、macOSPrivateApi、bundle
├── artifacts/                # 设计验收截图
├── .github/workflows/
│   └── build-macos.yml       # macOS CI：Apple Silicon 与 Intel 的 .app/.dmg
└── README.md                 # 安装、CI、脚本总览
```

**Tauri invoke 命令**：`list_projects`、`add_project`、`remove_project`、`refresh_project_status`、`check_environment`、`preflight`、`run_commit_push`；macOS 另增 **`sync_dock_geometry`**（`expanded: bool`）。

**Tauri 事件（macOS 壳 ↔ UI）**：`set-panel-open`（托盘驱动 UI 状态）、`dock-blur`（Panel 失焦收起）。

## 已知问题与验收注意

| 问题 | 说明 |
|------|------|
| **未签名 / 未公证** | CI 故意跳过 Apple secrets；首次打开需系统「仍要打开」或右键打开（见 README） |
| **贴边 / 多屏** | `place_dock_window` 按 **`current_monitor()`** 右缘定位；外接屏、排列变更、Spaces 切换需实机回归；NSPanel 失败时走 **置顶普通窗** 回退，行为与 Panel 路径略有差异 |
| **失焦自动收起** | 展开态下 `tauri://blur` 与 NSPanel **`dock-blur`** 会收起；系统文件对话框、切 App 等会触发——属当前产品设计，但「添加项目」时易误触，需验收 |
| **壳层 setup 部分失败** | NSPanel 失败有 `fallback_regular_window`；`setup` 仍 Err 则 `last_resort_show`；托盘创建失败仅 `eprintln`，App 仍可运行 |
| **pi 提示词仍含 CommitDock 字样** | `git.rs` 内 `PI_COMMIT_PROMPT` 字符串待品牌统一（低优先级） |
| **⋯ 菜单** | 当前仅 **移除**；设计稿中的 Finder Reveal **未做** |

验收时对照 `artifacts/` 与 `pnpm dev:web` + `?capture=` 场景；真机提交需本机 `pi` 与可 push 的远端权限。

## 协作与术语

| 角色 | 称呼 / 渠道 |
|------|-------------|
| 设计 | **Asurada设计** |
| 工程 | **Asurada工程** |
| 总控 | **呆瓜** |

**「提交」≠「推远程」**（沟通时）：产品按钮 **「提交并推送」** = `git add -A` + `commit` + **`push`**；若讨论「只 commit」，必须 explicitly 说 **不 push**，避免与需求冲突。

设计基础摘录：`uploads/design-v0.1-brief_55e5.md`（IA、风险条、行状态；部分文案已与 Asurada 实现对齐，品牌名以需求文档为准）。

## 当前 main 能力清单（对照需求）

以下对应 [`REQUIREMENTS.md`](./REQUIREMENTS.md)，基于仓库 **main** 源码状态（接 handoff 时请以最新 main 为准自行 diff）。

### 核心流程

- [x] 三步引导，可跳过；设置 → 重看引导
- [x] 引导后本机预检（`pi_path` / `pi_print` / `git`），失败可重新检查
- [x] 预检通过后项目列表；空态 CTA 添加项目
- [x] 添加 / 移除本地项目路径（持久化）
- [x] 有变更：`pi --print` + `git add -A && commit && push`
- [x] 工作区干净：主按钮禁用 +「无变更」/ 干净态文案，不调 `pi`
- [x] 风险条常驻（列表非空）
- [x] Toast + 行内成功 / 失败 / 进行中
- [x] tag 收起时失败未读小红点（`hasUnreadFailure`）
- [x] **NSPanel 贴边壳**（`tauri-nspanel` + `macos_panel`：`place_dock_window` / `sync_dock_geometry`）
- [x] **菜单栏托盘**（显示面板 / 收起 / 退出）
- [x] 启动 **Dock 可见（Regular）**、默认 **展开面板**；壳层失败 **last_resort_show**（`845b3a3` 一带行为）
- [ ] 行内 Finder / opener 入口
- [ ] Accessory（隐藏 Dock）策略 — 当前 intentionally **Regular**

### 非目标（保持不做）

- [x] 未接入签名公证（文档化，非阻断 CI）
- [x] 无 PR/MR、冲突向导、全功能 git GUI
- [x] 无 Windows / Linux 产品

### 视觉与品牌

- [x] 展示名 Asurada；深底 logo 资源就位
- [x] 薄荷 / 蜜桃 CSS token（`App.css`）
- [x] `artifacts/` 验收帧 + capture 脚本

### 工程与分发

- [x] Tauri 2 + React/Vite 可 dev / build
- [x] GitHub Actions macOS 构建与 artifact 命名（`asurada-macos-<arch>-<sha>`，aarch64 与 x64）
- [x] MIT + 仓库 URL 文档一致

---

**文档维护**：范围变更只改 `REQUIREMENTS.md`；实现进度更新本节勾选与「已知问题」表。
