# Asurada 工程交接

面向后续 **工程 / 设计 / 本人** 接手。产品范围以 [`REQUIREMENTS.md`](./REQUIREMENTS.md) 为准。

## 仓库与路径约定

| 项 | 值 |
|----|-----|
| 远程 | <https://github.com/LuckyYunPeng/asurada> |
| 建议本地目录名 | `asurada`（与 README 一致） |
| 示例路径 | `~/code/asurada` 或任意 clone 位置 |
| 应用数据（项目列表） | Tauri `app_data_dir` 下持久化（见 `src-tauri/src/store.rs`） |
| npm 包名 | `commitdock`（历史名，未改） |
| Rust crate | `commitdock` / `commitdock_lib`（**安装包展示名仍为 Asurada**，见 `tauri.conf.json` → `productName`） |
| Bundle ID | `com.asurada.app` |

## 本地开发

**前置**：Node.js **18+**、Rust **stable ≥ 1.90**（`rust-toolchain.toml`）、macOS [Tauri 前置工具](https://tauri.app/start/prerequisites/#macos)、本机 **`pi`** 与 **`git`**。

```bash
git clone https://github.com/LuckyYunPeng/asurada.git
cd asurada
npm install
npm run tauri dev
```

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅 Vite 前端，端口 **4721**（无 Tauri 命令） |
| `npm run tauri dev` | 完整桌面 App |
| `npm run tauri build -- --bundles app,dmg` | 本地 mac 包，产物在 `src-tauri/target/release/bundle/` |
| `npm run capture:artifacts` | 需先 `npm run dev`；复拍 `artifacts/*.png`（见 `artifacts/README.md`） |

预检单测（Rust）：

```bash
cd src-tauri && cargo test preflight::
```

## 技术栈

| 层 | 选型 |
|----|------|
| 壳 | **Tauri 2** |
| 前端 | **React 19 + Vite 8 + TypeScript**（`src/`） |
| 后端命令 | Rust（`src-tauri/src/`：`commands`、`git`、`preflight`、`store`） |
| 插件 | `@tauri-apps/plugin-dialog`（选目录）、`tauri-plugin-opener`（已接入 capability，UI 尚未用 Finder） |

### macOS 壳层（NSPanel / 托盘 / Accessory）— **现状**

产品目标为 **无传统主窗口、边缘 tag + 浮层**（见设计摘录 `uploads/design-v0.1-brief_55e5.md`）。**当前 main 尚未接入** 下列 native 能力，UI 在 **单窗口 Tauri 窗口**（`tauri.conf.json` 360×520、带 decorations）内用 CSS 模拟 tag + panel：

| 能力 | 现状 | 预期方向 |
|------|------|----------|
| **NSPanel**（如 `tauri-nspanel`） | 未集成；无 `macos_panel` 模块 | tag / 面板拆为 native 贴边浮层 |
| **菜单栏托盘** | 未实现 | 可选：显式退出、重开面板 |
| **Accessory vs Regular** | 未设置 `LSUIElement`；常规 App 行为 | 定稿后：偏 Accessory（少 Dock 干扰）或 Regular（便于调试）需产品拍板 |

接手后优先读：`src/App.tsx`（tag/panel 状态）、`src/App.css`（布局），再规划 `src-tauri` macOS 专用代码路径。

## 关键代码路径

```
asurada/
├── docs/REQUIREMENTS.md      # 产品范围
├── docs/HANDOFF.md           # 本文件
├── src/                      # React UI：引导、预检、列表、Toast、capture 场景
│   ├── App.tsx               # 主流程与 invoke
│   ├── introContent.ts       # 引导文案与预检 meta
│   ├── rowPresentation.ts    # 行状态 / 按钮禁用逻辑
│   └── captureMode.ts        # ?capture= 设计复拍
├── src-tauri/
│   ├── src/lib.rs            # 插件与 command 注册
│   ├── src/commands.rs       # list/add/remove/commit/preflight
│   ├── src/git.rs            # pi --print、PI_COMMIT_PROMPT、add/commit/push
│   ├── src/preflight.rs      # pi_path / pi_print / git
│   ├── src/store.rs          # 项目 JSON 持久化
│   └── tauri.conf.json       # productName、窗口、bundle
├── artifacts/                # 设计验收截图
├── .github/workflows/
│   └── build-macos.yml       # macOS CI：未签名 .app/.dmg
└── README.md                 # 安装、CI、脚本总览
```

**Tauri invoke 命令**：`list_projects`、`add_project`、`remove_project`、`refresh_project_status`、`check_environment`、`preflight`、`run_commit_push`。

## 已知问题与验收注意

| 问题 | 说明 |
|------|------|
| **未签名 / 未公证** | CI 故意跳过 Apple secrets；首次打开需系统「仍要打开」或右键打开（见 README） |
| **贴边 / 多屏** | 当前为普通窗口 + CSS tag，**非**系统级边缘吸附；多屏与 Spaces 行为未专门测试 |
| **打开文件夹可能收起面板** | 系统文件对话框可能导致窗口失焦；收起行为以实机为准，回归时必测 |
| **crate 仍名 commitdock** | 仅内部标识；对外品牌 Asurada，勿与 npm/Cargo 名混淆 |
| **pi 提示词仍含 CommitDock 字样** | `git.rs` 内 `PI_COMMIT_PROMPT` 字符串待品牌统一（低优先级） |
| **⋯ 菜单** | 当前仅 **移除**；设计稿中的 Finder Reveal **未做** |

验收时对照 `artifacts/` 与 `npm run dev` + `?capture=` 场景；真机提交需本机 `pi` 与可 push 的远端权限。

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
- [ ] **Native 边缘 tag / NSPanel 贴边浮层**（当前为单窗口内 CSS 模拟）
- [ ] 菜单栏托盘
- [ ] 行内 Finder / opener 入口

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
- [x] GitHub Actions macOS 构建与 artifact 命名（`asurada-macos-<sha>`）
- [x] MIT + 仓库 URL 文档一致

---

**文档维护**：范围变更只改 `REQUIREMENTS.md`；实现进度更新本节勾选与「已知问题」表。
