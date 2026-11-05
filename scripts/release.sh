#!/usr/bin/env bash
# 发布新版本：改三处版本号 → 把更新说明写进 CHANGELOG.md → 提交、打 tag → 推送，远端 CI 构建并发布 Release。
# 用法：scripts/release.sh <版本号，如 0.2.0> <更新说明 markdown 文件> [--dry-run]
#   --dry-run 只改文件并显示 diff，然后还原，不提交、不推送
set -euo pipefail

die() { echo "✗ $*" >&2; exit 1; }

VERSION="${1:-}"; NOTES="${2:-}"; MODE="${3:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本号要是 x.y.z 格式，收到：'$VERSION'"
[[ -s "$NOTES" ]] || die "更新说明文件不存在或为空：'$NOTES'"
TAG="v$VERSION"

cd "$(dirname "$0")/.."

[[ "$(git branch --show-current)" == "main" ]] || die "请在 main 分支发版"
[[ -z "$(git status --porcelain)" ]] || die "工作区有未提交的改动，先提交或暂存"
git fetch --quiet --tags origin
[[ -z "$(git rev-list HEAD..origin/main)" ]] || die "本地落后于 origin/main，先 pull"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG 已存在"

CURRENT=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' src-tauri/tauri.conf.json | head -1)
for f in package.json src-tauri/Cargo.toml; do
  grep -q "\"$CURRENT\"" "$f" || die "$f 的版本号和 tauri.conf.json（${CURRENT}）不一致"
done
[[ "$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)" == "$VERSION" && "$CURRENT" != "$VERSION" ]] \
  || die "新版本 $VERSION 必须大于当前版本 $CURRENT"

# 只替换各文件里本项目自己的那一处版本号
perl -0pi -e "s/\"version\": \"\Q$CURRENT\E\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json package.json
perl -0pi -e "s/^version = \"\Q$CURRENT\E\"/version = \"$VERSION\"/m" src-tauri/Cargo.toml
perl -0pi -e "s/(name = \"asurada\"\nversion = )\"\Q$CURRENT\E\"/\$1\"$VERSION\"/" src-tauri/Cargo.lock

# 新版本说明放在最前面；CI 按「## vX.Y.Z」标题截取这一段作为 Release 正文和应用内更新说明
# 以后的更新说明必须英中双语、先英后中，结构和 CHANGELOG.md 一致（### Features/Improvements/Fixes，然后 ### 新功能/改进/修复）。
[[ -f CHANGELOG.md ]] || printf '# 更新日志\n' > CHANGELOG.md
{
  sed -n '1p' CHANGELOG.md
  printf '\n## %s（%s）\n\n' "$TAG" "$(date +%Y-%m-%d)"
  cat "$NOTES"
  sed -n '2,$p' CHANGELOG.md
} > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

FILES=(src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md)

if [[ "$MODE" == "--dry-run" ]]; then
  git add -N CHANGELOG.md
  git --no-pager diff --stat
  git --no-pager diff -- CHANGELOG.md | head -40
  if git cat-file -e HEAD:CHANGELOG.md 2>/dev/null; then
    git checkout -- "${FILES[@]}"
  else
    git rm -q --cached CHANGELOG.md && rm CHANGELOG.md
    git checkout -- "${FILES[@]:0:4}"
  fi
  echo "（dry-run，已还原）$CURRENT → $VERSION"
  exit 0
fi

git add "${FILES[@]}"
git commit -q -m "chore: 发布 $TAG"
git tag -a "$TAG" -F "$NOTES"
git push -q origin main
git push -q origin "$TAG"
# 推送后运行要几秒才注册，按 tag 过滤，避免拿到上一次的运行
sleep 10
echo "✓ 已推送 ${TAG}，CI 构建中：$(gh run list -w build-macos.yml -b "$TAG" -L 1 --json url -q '.[0].url' 2>/dev/null || echo 'GitHub Actions → Build macOS')"
