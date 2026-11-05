# Asurada 项目说明（给 AI agent）

## 发版

用户说「发新版本」「发版」「发布 0.x.y」「release」时按以下步骤执行。统一走 `scripts/release.sh`，不要手改版本号或手动打 tag。

1. **检查状态**：在 `main` 分支、工作区干净、与 `origin/main` 同步（`git status --short`、`git fetch --tags`）。有未提交改动时，先问用户是否一并提交。
2. **定版本号**：用户指定了就用指定的。没指定就读 `src-tauri/tauri.conf.json` 的当前版本，按提交类型建议：有 feat 升 minor，只有 fix/style 升 patch；0.x 阶段即使有破坏性改动也只升 minor。用一句话告诉用户采用哪个版本。
3. **收集变更**：`git log $(git describe --tags --abbrev=0)..HEAD --no-merges --pretty='%s%n%b'`。仓库还没有任何 tag 时，用 `git log --no-merges` 取全部提交。
4. **写更新说明**：写到临时文件（如 `/tmp/asurada-notes.md`）。要求：
   - 面向用户的简体中文。
   - 按 `### 新功能`、`### 改进`、`### 修复` 分组，没有内容的组省略。
   - 同一功能的多条提交合并成一条。
   - 去掉 chore/ci/docs/refactor/test 这类用户感知不到的提交，以及「发布 vX」提交。
   - 每条一行，写用户能感知的变化，不写文件名和实现细节。
5. **等用户确认**：把更新说明全文给用户看，等用户确认后再继续。推送后会公开发布，撤不回来。
6. **发布**：`scripts/release.sh <版本号> /tmp/asurada-notes.md`。脚本做这些事：
   - 校验分支和版本号。
   - 修改 `tauri.conf.json`、`package.json`、`Cargo.toml`、`Cargo.lock` 四处版本号。
   - 把说明插到 `CHANGELOG.md` 顶部。
   - 提交「chore: 发布 vX.Y.Z」，打附注 tag。
   - 推送 main 和 tag。

   只想预览不提交时，加 `--dry-run`。
7. **报告**：推送后用 `gh run list -w build-macos.yml -L 1` 拿到运行链接告诉用户。用户要求跟进时，用 `gh run watch`。

注意事项：

- **不要改 CHANGELOG 标题格式**：CI 按 `CHANGELOG.md` 里的 `## vX.Y.Z` 标题截取 Release 正文，同时写进 `latest.json`，应用内更新提示会显示这段内容。
- **CI 失败不要删 tag 重推**：tag 推送后 CI 失败，修好后发下一个 patch 版本。已安装的用户可能已经拿到旧 tag。
- **证书和公证报错先查 Secrets**：签名、公证和更新包签名需要 7 个 GitHub Secrets（`APPLE_*` 与 `TAURI_SIGNING_*`），出错时先检查它们。签名身份固定为 `Developer ID Application: Jinjing Zhou (2WHP7P8PG6)`，不要换成其他证书。
- **排队不是失败**：macOS arm64 runner 可能要排队很久。排队超过 15 分钟会被取消（job 没有 runner、没有任何步骤），这时用 `gh run rerun <run-id>` 原样重跑即可，不用动 tag。
- **成功的标志**：GitHub Releases 出现新版本，附件包括 `.dmg`、`Asurada.app.tar.gz`、`.sig` 和 `latest.json`。

## 部署官网

用户说「部署官网」「发布官网」「更新官网」时按以下步骤执行。官网是 `site/` 目录下的静态页面（`site/index.html` 和 `site/assets/`），托管在 Cloudflare Pages 项目 `asurada`，正式地址 https://asurada-4yq.pages.dev/。和 App 发版无关，不走 `scripts/release.sh`。

1. **确认登录**：`npx -y wrangler@latest whoami`，账号应为 `wypwelldone@gmail.com`。没登录时让用户自己运行 `npx wrangler login`，不要代为处理凭据。
2. **部署**：`npx -y wrangler@latest pages deploy site --project-name asurada --branch main --commit-dirty=true`。
3. **验证**：
   - `curl -s -o /dev/null -w '%{http_code}' https://asurada-4yq.pages.dev/` 返回 200，页面 `<title>` 是预期内容。
   - 用无头浏览器（如 Playwright）打开，确认没有页面报错、没有失败请求、所有图片都加载成功（`naturalWidth > 0`）。
4. **报告**：把部署地址和验证结果告诉用户。

注意事项：

- **不要加 `--force`**：Pages 项目已经存在。`--force` 只在当初 `pages project create` 时用过一次，因为新版 wrangler（4.15x）不加它会把 Pages 命令转给 Workers，报 `Missing entry-point to Worker script`。
- **域名带随机后缀**：正式地址是 `asurada-4yq.pages.dev`，不是 `asurada.pages.dev`。
- **截图有两份**：`docs/screenshots/`（README 用）和 `site/assets/`（官网用），换截图时两处都要更新。
