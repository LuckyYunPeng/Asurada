# Changelog / 更新日志

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
