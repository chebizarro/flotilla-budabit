#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_config="${BUDABIT_MAIN_DEPLOY_CONFIG:-$repo_root/.deploy.local.env}"

if [[ ! -f "$deploy_config" ]]; then
  printf 'deploy-main: missing deployment config: %s\n' "$deploy_config" >&2
  exit 1
fi

cd "$repo_root"

if [[ "${BUDABIT_SKIP_BUILD:-0}" == '1' ]]; then
  node scripts/check-built-service-worker.mjs
else
  VITE_PLATFORM_URL='https://budabit.club' \
  VITE_APP_URL='https://budabit.club' \
  VITE_PERFORMANCE_DIAGNOSTICS=0 \
  pnpm run build-in-production
fi

grep -Fq '<meta property="og:url" content="https://budabit.club" />' build/index.html || {
  printf 'deploy-main: build output does not target https://budabit.club\n' >&2
  exit 1
}

BUDABIT_DEPLOY_CONFIG="$deploy_config" \
  "$repo_root/scripts/deploy-static-lftp.sh" "$@"
