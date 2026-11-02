# Asurada

[![Build macOS](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml/badge.svg)](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml)

**Asurada** 是 macOS 边缘吸附小标签 + 浮层面板：管理本地 git 仓库，一键用本机 `pi --print` 生成中文 Conventional Commit 并无确认地 `git add -A && git commit && git push`。

- 仓库：<https://github.com/LuckyYunPeng/asurada>
- 协议：**MIT**（见 [LICENSE](./LICENSE)）
- 内部 Rust crate 名仍为 `commitdock`（渐进改名，不影响安装包展示名 **Asurada**）

## 安装（macOS）

1. 打开 [Actions → Build macOS](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml)，选最近一次成功的 workflow run。
2. 在 **Artifacts** 下载 `asurada-macos-<commit>`（含 `.dmg` 与 `.app`）。
3. 当前 CI **未做 Apple 代码签名与公证**，首次打开可能需：系统设置 → 隐私与安全性 → 仍要打开，或右键 App → 打开。

打 tag `v*` 并 push 时，会额外上传 `asurada-macos-release-<tag>` 产物（便于发版归档）。

### 后续签名 / 公证（未接入阻断）

正式对外分发前，建议在 GitHub 仓库 **Secrets** 配置 Apple 开发者证书与公证相关变量（如 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 等），并在 workflow 中启用 Tauri 签名步骤。当前 workflow 故意跳过这些 secret，保证缺省时仍能产出**未签名**安装包。

## 产品行为

- **macOS 壳层**：启动后无传统标题栏主窗口，仅在屏幕右缘显示边缘 **tag**（`NSPanel` 浮层，尽量置顶且不抢占其它 App 焦点）。点击 tag 展开浮层面板；点 tag、面板内「收起」、窗口内空白或 **Esc** 可收起。点击其它 App 时面板也会收起（`resign key`）。
- 非 macOS 本地调试时仍为贴边小窗 + 置顶，无 NSPanel 转换。
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
npm install
npm run tauri dev
```

**验证贴边 tag / 展开收起（macOS + Tauri 壳）**

1. `npm run tauri dev` 启动后应只见屏幕右侧小 tag，无系统标题栏大窗。
2. 点击 tag → 浮层面板展开；再点 tag、点「收起」、按 Esc，或点击面板外缘透明区域 → 应收起为 tag。
3. 切换到其它 App 焦点 → 面板应收起（tag 仍可见）。

无需额外「辅助功能」权限即可使用；未签名包仍按上文 Gatekeeper 说明处理。

仅前端壳（端口 **4721**，无 Tauri 命令）：

```bash
npm run dev
```

本地打 mac 包（与 CI 相同 bundles）：

```bash
npm run tauri build -- --bundles app,dmg
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
| `npm run dev` | Vite（4721） |
| `npm run tauri dev` | 完整 App |
| `npm run tauri build` | 生产构建 |
| `npm run capture:artifacts` | 需先 `npm run dev`，生成 `artifacts/*.png` |

## CI/CD

- Workflow： [`.github/workflows/build-macos.yml`](./.github/workflows/build-macos.yml)
- 触发：`push` 到 `main`、`push` tag `v*`、手动 **workflow_dispatch**
- Runner：`macos-latest`
- 产物名：`asurada-macos-<sha>`（及 tag 时 `asurada-macos-release-<tag>`）

## 许可证

MIT — [LICENSE](./LICENSE)
