# Asurada

**Asurada**（仓库内部 crate 仍名 `commitdock`）是 macOS 边缘吸附小标签 + 浮层面板：管理本地 git 仓库，一键用本机 `pi --print` 生成中文 Conventional Commit 并无确认地 `git add -A && git commit && git push`。

开源协议：**MIT**

## 产品行为

- 首次打开：**三步引导**（可跳过）→ **本机预检** → 项目列表
- 设置 → **重看引导**（`localStorage` 标记，不影响项目数据）
- 无独立主窗口（**macOS 待实现**：NSPanel / 真边缘吸附）
- **工作区干净**：主按钮禁用 +「无变更」，不调用 `pi`
- 提交结果：**Toast** 一次性提示 + 行内状态（已推送 / 失败）
- 品牌视觉：浅色面板、青薄荷主按钮、蜜桃暖风险条、定稿 logo（`public/asurada-logo.png`）

## 本机环境预检

打开面板且完成引导后自动 `preflight` / `check_environment`。**未通过**时仅展示预检页（含重新检查），禁用添加与提交。

| 检查项 | 含义 |
|---|---|
| `pi_path` | `pi` 在 PATH 中 |
| `pi_print` | `pi --print` 非交互可用（12 秒超时探测） |
| `git` | 本机可执行 `git` |

`run_commit_push` 服务端再次预检；未就绪不调 `pi`。

```bash
cd src-tauri && cargo test preflight::
```

## 本地运行

```bash
npm install
npm run tauri dev
```

仅前端壳（无 Tauri 命令）：

```bash
npm run dev
```

构建 `.app`：

```bash
npm run tauri build
```

## `pi` 调用

项目目录下：

```bash
pi --print '<固化提示词>'
```

提示词见 Rust 常量 `PI_COMMIT_PROMPT`（README 不重复全文）。

## 数据

项目列表：`projects.json`（应用数据目录）。

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | Vite（4721） |
| `npm run tauri dev` | 完整 App |
| `npm run tauri build` | 生产构建 |

## 许可证

MIT — [LICENSE](./LICENSE)
