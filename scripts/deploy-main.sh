#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_config="${BUDABIT_MAIN_DEPLOY_CONFIG:-$repo_root/.deploy.local.env}"

if [[ ! -f "$deploy_config" ]]; then
  printf 'deploy-main: missing deployment config: %s\n' "$deploy_config" >&2
  exit 1
fi

cd "$repo_root"

VITE_PLATFORM_URL='https://budabit.club' \
VITE_APP_URL='https://budabit.club' \
VITE_PERFORMANCE_DIAGNOSTICS=0 \
pnpm run build-in-production

BUDABIT_DEPLOY_CONFIG="$deploy_config" \
  "$repo_root/scripts/deploy-static-lftp.sh" "$@"
