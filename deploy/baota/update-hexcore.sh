#!/usr/bin/env bash
set -Eeuo pipefail

HEXCORE_BRANCH="${HEXCORE_BRANCH:-codex/multiplayer-realtime}"
HEXCORE_ROOT="${HEXCORE_ROOT:-/www/wwwroot/hexcore}"

log() {
  printf '[HEXCORE2] %s\n' "$1"
}

fail() {
  printf '[HEXCORE2] ERROR: %s\n' "$1" >&2
  exit 1
}

[[ -d "$HEXCORE_ROOT/.git" ]] || fail "项目目录不存在或不是 Git 仓库：$HEXCORE_ROOT"
command -v docker >/dev/null 2>&1 || fail "缺少 docker 命令"
docker compose version >/dev/null 2>&1 || fail "缺少 docker compose"

cd "$HEXCORE_ROOT"

log "更新前建议先执行 deploy/baota/backup-postgres.sh。"
log "拉取分支：$HEXCORE_BRANCH"
git fetch origin "$HEXCORE_BRANCH"
git checkout "$HEXCORE_BRANCH"
git pull --ff-only origin "$HEXCORE_BRANCH"

log "重建应用容器，保留 PostgreSQL volume。"
docker compose up -d --build

log "更新完成。"
docker compose ps
