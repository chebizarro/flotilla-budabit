#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_config="${BUDABIT_TEST_DEPLOY_CONFIG:-$HOME/.config/budabit/deploy-test.env}"

if [[ ! -f "$deploy_config" ]]; then
  printf 'deploy-test: missing deployment config: %s\n' "$deploy_config" >&2
  exit 1
fi

cd "$repo_root"

if [[ "${BUDABIT_SKIP_BUILD:-0}" == '1' ]]; then
  node scripts/check-built-service-worker.mjs
else
  VITE_PLATFORM_URL='https://test.budabit.club' \
  VITE_APP_URL='https://test.budabit.club' \
  VITE_DIAGNOSTICS=1 \
  VITE_PERFORMANCE_DIAGNOSTICS=1 \
  pnpm run build-in-production
fi

grep -Fq '<meta property="og:url" content="https://test.budabit.club" />' build/index.html || {
  printf 'deploy-test: build output does not target https://test.budabit.club\n' >&2
  exit 1
}

BUDABIT_DEPLOY_CONFIG="$deploy_config" \
  "$repo_root/scripts/deploy-static-lftp.sh" "$@"
