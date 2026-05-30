#!/usr/bin/env bash
set -Eeuo pipefail

HEXCORE_ROOT="${HEXCORE_ROOT:-/www/wwwroot/hexcore}"
HEXCORE_BACKUP_DIR="${HEXCORE_BACKUP_DIR:-/www/backup/hexcore}"
HEXCORE_BACKUP_KEEP="${HEXCORE_BACKUP_KEEP:-10}"

log() {
  printf '[HEXCORE2] %s\n' "$1"
}

fail() {
  printf '[HEXCORE2] ERROR: %s\n' "$1" >&2
  exit 1
}

[[ -d "$HEXCORE_ROOT" ]] || fail "项目目录不存在：$HEXCORE_ROOT"
command -v docker >/dev/null 2>&1 || fail "缺少 docker 命令"

cd "$HEXCORE_ROOT"

mkdir -p "$HEXCORE_BACKUP_DIR"
chmod 700 "$HEXCORE_BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="${HEXCORE_BACKUP_DIR}/hexcore-postgres-${stamp}.dump"

log "开始导出 PostgreSQL 备份。"
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$target"

chmod 600 "$target"
log "备份完成：$target"

find "$HEXCORE_BACKUP_DIR" -maxdepth 1 -name 'hexcore-postgres-*.dump' -type f \
  | sort -r \
  | tail -n +"$((HEXCORE_BACKUP_KEEP + 1))" \
  | xargs -r rm -f
