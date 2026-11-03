# Asurada

- 产品需求：[docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)
- 工程交接：[docs/HANDOFF.md](./docs/HANDOFF.md)

[![Build macOS](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml/badge.svg)](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml)

**Asurada** 是 macOS 边缘吸附小标签 + 浮层面板：管理本地 git 仓库，一键用本机 `pi --print` 生成中文 Conventional Commit 并无确认地 `git add -A && git commit && git push`。

- 仓库：<https://github.com/LuckyYunPeng/asurada>
- 协议：**MIT**（见 [LICENSE](./LICENSE)）

## 安装（macOS）

1. 打开 [Actions → Build macOS](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml)，选最近一次成功的 workflow run。
2. 在 **Artifacts** 下载 `asurada-macos-<commit>`（含 `.dmg` 与 `.app`）。
3. 打开 `.dmg` 后，将 **Asurada** 拖到「应用程序」文件夹即可（无单独安装向导，属正常）。
4. 当前 CI **未做 Apple 代码签名与公证**，首次打开可能需：系统设置 → 隐私与安全性 → 仍要打开，或右键 App → 打开。
5. 启动后可在 **Dock** 看到 Asurada 图标；若右缘 tag 不好找，点菜单栏 **Asurada 图标** →「显示面板 / 收起 / 退出」。

打 tag `v*` 并 push 时，会额外上传 `asurada-macos-release-<tag>` 产物（便于发版归档）。

### 后续签名 / 公证（未接入阻断）

正式对外分发前，建议在 GitHub 仓库 **Secrets** 配置 Apple 开发者证书与公证相关变量（如 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 等），并在 workflow 中启用 Tauri 签名步骤。当前 workflow 故意跳过这些 secret，保证缺省时仍能产出**未签名**安装包。

## 产品行为

- **macOS**：Dock 可见 + 菜单栏托盘图标；**NSPanel** 吸附屏幕右缘（失败则回退为置顶无边框窗，不会无 UI 秒退）
- 首次打开默认**展开面板**（引导 / 预检）；收起后右缘为**高对比 tag**（铺满壳窗）
- 收起：再点 tag、**Esc**、窗口失焦（点击其他应用）；也可从菜单栏托盘操作
- 首次打开：**三步引导**（可跳过）→ **本机预检** → 项目列表
- 设置 → **重看引导**
- **工作区干净**：主按钮禁用 +「无变更」，不调用 `pi`
- 提交结果：Toast + 行内状态（已推送 / 失败）

## 本机环境预检

| 检查项 | 含义 |
|---|---|
| `pi_path` | `pi` 在 PATH 中 |
| `pi_print` | `pi --print` 非交互可用（12 秒超时） |
| `git` | 本机可执行 `git` |

```bash
cd src-tauri && cargo test preflight::
```

## 本地开发

前置：Node.js 18+、Rust stable（≥ 1.90，见 `rust-toolchain.toml`）、macOS 上 [Tauri 前置工具](https://tauri.app/start/prerequisites/#macos)、本机 `pi` 与 `git`。

```bash
git clone https://github.com/LuckyYunPeng/asurada.git
cd asurada
pnpm install
pnpm dev
```

仅前端壳（端口 **4721**，无 Tauri 命令）：

```bash
pnpm dev:web
```

本地打 mac 包（与 CI 相同 bundles）：

```bash
pnpm tauri build --bundles app,dmg
# 产物：src-tauri/target/release/bundle/dmg/*.dmg
#       src-tauri/target/release/bundle/macos/*.app
```

## `pi` 调用

在项目目录执行 `pi --print '<提示词>'`；固化提示词为 Rust 常量 `PI_COMMIT_PROMPT`。

## 工程图帧（设计验收）

仓库 `artifacts/` 含各 UI 状态截图；开发态可用 `?capture=` 场景复拍（见 `artifacts/README.md`）。

## 脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev:web` | Vite（4721） |
| `pnpm dev` | 完整 App |
| `pnpm tauri build` | 生产构建 |
| `pnpm capture:artifacts` | 需先 `pnpm dev:web`，生成 `artifacts/*.png` |

## CI/CD

| Workflow | Runner | 作用 |
|---|---|---|
| [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) | `ubuntu-latest` | 前端 `pnpm build`、`cargo check`、预检单元测试 |
| [`.github/workflows/build-macos.yml`](./.github/workflows/build-macos.yml) | `macos-latest` | 产出未签名 `.app` / `.dmg`（整体验收请下载此产物） |

macOS 边缘吸附与 **NSPanel** 行为只能在 macOS 上验证；Linux CI 不跑 UI，但保证 Rust/前端可编译。

- 触发：`push` / PR 到 `main`、`push` tag `v*`、手动 **workflow_dispatch**
- DMG 产物名：`asurada-macos-<sha>`（及 tag 时 `asurada-macos-release-<tag>`）

## 许可证

MIT — [LICENSE](./LICENSE)
