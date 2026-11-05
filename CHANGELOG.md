# Changelog / 更新日志

## v0.5.1（2026-11-05）

### 新功能

- 新增 Intel 芯片 Mac 安装包，Apple Silicon 和 Intel 机型都能下载安装，App 内更新会自动下载对应芯片的版本。

## Unreleased

### Features
- Intel Macs are supported alongside Apple Silicon. Releases include `*_aarch64.dmg` (Apple Silicon) and `*_x64.dmg` (Intel); the in-app updater downloads the package for that Mac.

### 新功能
- 同时支持 Intel 与 Apple Silicon 的 Mac。Release 提供 `*_aarch64.dmg`（Apple Silicon）和 `*_x64.dmg`（Intel），应用内更新会下载对应芯片的安装包。

## v0.5.0（2026-11-05）

### Features
- Choose your AI agent for commit messages: Asurada detects Pi, Claude Code, Codex, Grok, OpenCode and Kimi on your Mac. Pick one on first launch, and switch or test it anytime in Settings. If none is installed, you'll see install commands you can copy.
- Commit messages now cover only what you commit: Asurada reads the diff itself and sends it to the agent in a short, separate session, so partial commits are described accurately and lock files and generated files don't add noise.
- Add many projects at once: the "+" button now offers "Scan a folder…", which finds every Git repository in a folder so you can tick the ones to add.

### Improvements
- A rewritten five-page introduction. Tap the page dots to jump to any page.
- Tooltips are easier to read in dark mode.

### 新功能
- 自选 AI Agent 生成提交信息：自动检测本机的 Pi、Claude Code、Codex、Grok、OpenCode、Kimi，首次启动时选择，之后可在设置中随时切换和测试；一个都没装时会给出可复制的安装命令
- 提交信息只描述你提交的内容：Asurada 自己读取改动交给 Agent，在独立短会话里生成，部分提交也能写准，lock 文件和生成文件不再干扰
- 批量添加项目：「+」按钮新增「扫描文件夹…」，自动找出文件夹里的所有 Git 仓库，勾选后一次添加

### 改进
- 重写了五页新手引导，点击底部圆点可直接跳转
- 深色模式下的提示框更易读

## v0.4.0（2026-11-05）

### Features
- Commit only the files you pick: tick files or folders in the diff window to commit and push just those; everything else stays in your working tree. Test files hidden from view are still included.
- Discard changes: right-click a file or folder in the diff window and choose "Discard Changes…" to revert it to the last commit (new files are deleted). This can't be undone.
- Zoom the diff: press ⌘+ / ⌘- (or use the controls at the bottom) to resize code and the file list together; click the percentage or press ⌘0 to reset. Your zoom level is remembered.
- The Settings button shows a red dot when a new version is available.

### Improvements
- Cleaner checkboxes in the diff window file list.

### 新功能
- 只提交选中的文件：在差异窗口勾选文件或目录，只提交并推送选中的部分，其余改动留在工作区；隐藏的测试文件照常一起提交
- 丢弃改动：在差异窗口右键文件或目录，选择「丢弃改动…」即可恢复到上次提交的状态，新增的文件会被删除，无法撤销
- 差异缩放：按 ⌘+ / ⌘-（或点底部的缩放按钮）同时放大缩小代码和文件列表，点击百分比或按 ⌘0 恢复，会记住上次的比例
- 有新版本时，设置按钮上会显示红点提示

### 改进
- 差异窗口文件列表的勾选框换了更清爽的样式

## v0.3.0（2026-11-05）

### Features
- New Pull button on project rows and in the diff window: fast-forward pulls remote commits in one click (never creates merge commits).

### Improvements
- Notifications have a new, cleaner look, consistent between the main panel and the diff window.
- Project row actions now use outlined buttons with tooltips.
- The diff window always uses a side-by-side layout; the layout toggle is removed.

### Fixes
- In colorblind mode, highlighted words in the diff have higher text contrast and are easier to read.

### 新功能
- 项目行和差异窗口新增「拉取」按钮：一键快进拉取远端新提交，不会产生合并提交

### 改进
- 提示消息换了更简洁的新样式，主面板和差异窗口保持一致
- 项目行的操作按钮改为描边样式，并带悬停提示
- 差异窗口固定为左右对比，去掉了对比方式切换

### 修复
- 色弱模式下，差异中高亮的词文字对比度更高，更容易看清

## v0.2.0 (2026-11-05)

### Features
- UI supports Chinese and English (follows the system language by default; switchable in Settings). Generated commit messages follow the selected language.
- Click the logo or brand name in the top-left to return to the project list.
- New-user tip: on first use, a banner at the top of the panel says to click a project with changes to review the diff; it hides after you have used it.

### Improvements
- Default shortcut is now ⌃E (Control + E). Custom shortcuts already set are unchanged.
- The “one click stages all changes, commits, and pushes” hint stops staying after the first successful commit.
- More spacing in the diff window toolbar so English UI is less cramped.
- Downloaded `.dmg` installers are Apple-notarized, so Gatekeeper no longer blocks opening them.

### Fixes
- Opening the diff window in dark mode no longer flashes white first.

### 新功能
- 界面支持中文和英文，默认跟随系统语言，可在设置中切换；生成的提交信息也跟随所选语言
- 点击左上角的 logo 或品牌名即可回到项目列表
- 新用户引导：首次使用时在面板顶部提示「点击有改动的项目，可查看本次改动」，学会后自动隐藏

### 改进
- 默认快捷键改为 ⌃E（Control + E），已自定义过快捷键的不受影响
- 「一键会暂存全部变更、提交并推送」提示在第一次成功提交后不再常驻
- 差异窗口顶栏控件间距加大，英文界面下不再拥挤
- 下载的 dmg 安装包也经过苹果公证，打开时不再被系统拦截

### 修复
- 暗色模式下打开差异窗口时会先闪一下白色

## v0.1.1 (2026-11-05)

First public release.

### Features
- Edge-docked panel: expand/collapse, drag to reposition; global shortcut (default Option+Command+G, changeable in Settings).
- One-click commit and push: `pi` writes the commit message; rejected pushes auto rebase and retry; conflicts are aborted safely.
- Collapsed result bubble for commit outcomes, with running and pending-change status.
- Diff window: directory tree of changed files, syntax highlighting and whole-word comparison; hide test files; color-vision-friendly mode.
- Diff file context menu: Open, Open With, Reveal in Finder, copy path/name.
- Settings: light / dark / system appearance, launch at login, confirm before commit.
- In-app update check with one-click download, install, and restart.
- Startup environment check for `pi`, `git`, and related tools.

### Improvements
- Apps launched from Finder can still find `pi` installed via nvm and similar tools.
- Diff window stays pre-warmed for faster opens.
- Neutral color palette and Geist typeface.

### 新功能
- 屏幕边缘停靠面板：点击展开、收起，可拖动调整停靠位置；支持全局快捷键（默认 Option+Command+G，可在设置中修改）
- 一键提交并推送：由 pi 生成提交信息，推送被拒时自动 rebase 重试，冲突时自动撤回
- 收起时用气泡提示提交结果，并显示运行中与待提交状态
- 差异窗口：目录树浏览变更文件，语法高亮与整词对比；可隐藏测试文件，提供色弱模式
- 差异窗口文件右键菜单：打开、打开方式、在访达中显示、复制路径和名称
- 设置：浅色/深色/跟随系统外观、开机自启动、提交前确认
- 应用内检查更新，一键下载安装并重启
- 启动时自动检查 pi、git 等运行环境

### 改进
- 从访达启动时也能找到通过 nvm 等方式安装的 pi
- 差异窗口常驻预热，打开更快
- 界面采用中性配色和 Geist 字体
