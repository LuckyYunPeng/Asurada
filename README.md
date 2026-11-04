# Asurada

[![Build macOS](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml/badge.svg)](https://github.com/LuckyYunPeng/asurada/actions/workflows/build-macos.yml)

**让 AI 写完代码后的「提交、推送」只剩一次点击。**

Asurada 是一个停靠在 macOS 屏幕边缘的小工具。它帮你看住手头所有本地项目：哪个有改动、改了什么，一键就能生成规范的中文提交信息并推送到远端。

<p align="center">
  <img src="./docs/screenshots/panel.png" alt="项目面板：所有项目一览，有改动的项目可一键提交并推送" width="360">
</p>

## 它解决什么问题

用 AI Agent 写代码时，节奏通常是：让 Agent 改代码 → 自己验收 → 提交推送 → 下一轮。最后这一步看起来简单，却很打断人：

- **占用对话上下文**：让主 Agent 顺手提交，会把 diff 和 git 输出塞进对话，挤占真正干活的上下文。
- **写提交信息费神**：每次都要想一句准确的描述，草草写个 `update` 又不利于日后回溯。
- **多项目来回切换**：同时维护几个仓库时，要逐个打开终端，查状态、看改动、提交、处理推送冲突。

Asurada 把这些事收拢到屏幕边上的一个小面板里，不打扰你正在用的 Agent 和编辑器。

## 能做什么

- **一键提交并推送**：根据本次改动自动生成一行中文提交信息（如 `feat: 新增深色模式`），提交后直接推送。远端有新提交时自动同步后重试；有冲突就撤回并提示，不会弄乱你的仓库。
- **多项目一览**：所有项目集中在一个列表，有改动的排在前面；没有改动的项目不能误点提交。
- **提交前看改动**：在差异窗口里按目录浏览变更文件，看清增删内容；可以隐藏测试文件，也提供色弱友好配色。
- **不打扰的停靠方式**：平时只是屏幕边缘的一个小标签，点击或快捷键（默认 `Option + Command + G`）展开。标签可以拖到合适的位置，收起后用小气泡告诉你提交结果。
- **按你的习惯来**：可以开启「提交前确认」，也可以设置浅色/深色外观和开机自启动。
- **自动更新**：有新版本时在应用内提示，一键安装。

平时只在屏幕右缘露出一个小标签，有待提交的改动时会亮起提示：

![收起时停靠在屏幕边缘的小标签](./docs/screenshots/desktop.jpg)

提交前可以打开差异窗口，逐个文件确认改动：

![差异窗口：按目录浏览变更文件并对比改动](./docs/screenshots/diff.jpg)

## 适合谁

- 在 macOS 上用 AI Agent 写代码、需要频繁验收和提交的开发者。
- 同时维护多个本地 git 仓库，希望提交推送越省事越好的人。

## 安装

1. 从 [Releases](https://github.com/LuckyYunPeng/asurada/releases) 下载最新的 `.dmg`。
2. 打开后把 **Asurada** 拖进「应用程序」。
3. 首次打开会有简短引导，并自动检查运行环境。

使用前需要本机已安装 `git` 和 `pi`（用来生成提交信息）。目前仅支持 Apple Silicon 的 Mac。

## 参与开发

- 产品需求：[docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)
- 工程交接：[docs/HANDOFF.md](./docs/HANDOFF.md)
- 更新日志：[CHANGELOG.md](./CHANGELOG.md)

```bash
pnpm install
pnpm dev
```

发版统一使用 `scripts/release.sh`，详见 [AGENTS.md](./AGENTS.md)。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
