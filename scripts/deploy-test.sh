#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_config="${BUDABIT_TEST_DEPLOY_CONFIG:-$HOME/.config/budabit/deploy-test.env}"

if [[ ! -f "$deploy_config" ]]; then
  printf 'deploy-test: missing deployment config: %s\n' "$deploy_config" >&2
  exit 1
fi

cd "$repo_root"

VITE_PLATFORM_URL='https://test.budabit.club' \
VITE_APP_URL='https://test.budabit.club' \
VITE_PERFORMANCE_DIAGNOSTICS=1 \
pnpm run build-in-production

BUDABIT_DEPLOY_CONFIG="$deploy_config" \
  "$repo_root/scripts/deploy-static-lftp.sh" "$@"
