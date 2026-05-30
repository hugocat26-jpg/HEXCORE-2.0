#!/usr/bin/env bash
set -Eeuo pipefail

HEXCORE_ROOT="${HEXCORE_ROOT:-/www/wwwroot/hexcore}"
HEXCORE_API_PORT="${HEXCORE_API_PORT:-4196}"

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

read_env_value() {
  local key="$1"
  local default_value="$2"
  local line value
  if [[ -f .env ]]; then
    line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
    value="${line#*=}"
    value="${value%$'\r'}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    if [[ -n "$line" && -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
  fi
  printf '%s' "$default_value"
}

HEXCORE_API_PORT="${HEXCORE_API_PORT:-$(read_env_value HEXCORE_API_PORT 4196)}"

log "Git 提交：$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
log "容器状态："
docker compose ps

log "健康检查："
if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${HEXCORE_API_PORT}/health" || true
  printf '\n'
else
  log "缺少 curl，跳过 HTTP 健康检查。"
fi

log "最近日志："
docker compose logs --tail=80 hexcore
