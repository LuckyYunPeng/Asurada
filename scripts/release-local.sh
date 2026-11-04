#!/usr/bin/env bash
# 本地打一个与 CI 发版相同的包：个人 Developer ID 签名 + 公证 + 更新包签名。
# 会先清掉 shell 里其他账号（如公司账号）的 APPLE_* 变量，保证只用个人证书。
# 用法：APPLE_API_KEY=<Key ID> APPLE_API_ISSUER=<Issuer ID> APPLE_API_KEY_PATH=<AuthKey.p8 路径> scripts/release-local.sh
set -euo pipefail

: "${APPLE_API_KEY:?需要 APPLE_API_KEY（App Store Connect API Key ID）}"
: "${APPLE_API_ISSUER:?需要 APPLE_API_ISSUER（Issuer ID）}"
: "${APPLE_API_KEY_PATH:?需要 APPLE_API_KEY_PATH（.p8 文件路径）}"

unset APPLE_ID APPLE_PASSWORD APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
export APPLE_SIGNING_IDENTITY="Developer ID Application: Jinjing Zhou (2WHP7P8PG6)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/asurada-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/asurada-updater.password)"

cd "$(dirname "$0")/.."
pnpm tauri build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":true}}'
