#!/usr/bin/env bash
set -Eeuo pipefail

HEXCORE_REPO="${HEXCORE_REPO:-https://github.com/hugocat26-jpg/HEXCORE-2.0.git}"
HEXCORE_BRANCH="${HEXCORE_BRANCH:-codex/multiplayer-realtime}"
HEXCORE_ROOT="${HEXCORE_ROOT:-/www/wwwroot/hexcore}"
HEXCORE_APP_PORT="${HEXCORE_APP_PORT:-4186}"
HEXCORE_API_PORT="${HEXCORE_API_PORT:-4196}"

log() {
  printf '[HEXCORE2] %s\n' "$1"
}

fail() {
  printf '[HEXCORE2] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

compose() {
  docker compose "$@"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

ensure_env_file() {
  cd "$HEXCORE_ROOT"
  if [[ -f .env ]]; then
    log "已存在 .env，沿用服务器当前配置。"
    return
  fi
  [[ -f .env.example ]] || fail "缺少 .env.example。"
  cp .env.example .env
  local password room_code_secret
  password="$(generate_secret)"
  room_code_secret="$(generate_secret)"
  sed -i "s/^HEXCORE_POSTGRES_PASSWORD=.*/HEXCORE_POSTGRES_PASSWORD=${password}/" .env
  if grep -q '^HEXCORE_ROOM_CODE_SECRET=' .env; then
    sed -i "s/^HEXCORE_ROOM_CODE_SECRET=.*/HEXCORE_ROOM_CODE_SECRET=${room_code_secret}/" .env
  else
    printf '\nHEXCORE_ROOM_CODE_SECRET=%s\n' "$room_code_secret" >> .env
  fi
  sed -i "s/^HEXCORE_APP_PORT=.*/HEXCORE_APP_PORT=${HEXCORE_APP_PORT}/" .env
  sed -i "s/^HEXCORE_API_PORT=.*/HEXCORE_API_PORT=${HEXCORE_API_PORT}/" .env
  chmod 600 .env
  log "已生成 .env，本机密钥只写入服务器本机文件。"
}

check_ports() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${HEXCORE_APP_PORT} or sport = :${HEXCORE_API_PORT} )" | grep -q LISTEN && fail "端口 ${HEXCORE_APP_PORT}/${HEXCORE_API_PORT} 已被占用。"
  fi
}

require_cmd git
require_cmd docker
docker compose version >/dev/null 2>&1 || fail "当前 Docker 不支持 compose 子命令，请先在宝塔安装 Docker Compose。"
check_ports

if [[ -d "$HEXCORE_ROOT/.git" ]]; then
  log "更新已有项目目录：$HEXCORE_ROOT"
  git -C "$HEXCORE_ROOT" fetch origin "$HEXCORE_BRANCH"
  git -C "$HEXCORE_ROOT" checkout "$HEXCORE_BRANCH"
  git -C "$HEXCORE_ROOT" pull --ff-only origin "$HEXCORE_BRANCH"
else
  log "克隆项目到：$HEXCORE_ROOT"
  mkdir -p "$(dirname "$HEXCORE_ROOT")"
  git clone -b "$HEXCORE_BRANCH" "$HEXCORE_REPO" "$HEXCORE_ROOT"
fi

ensure_env_file

cd "$HEXCORE_ROOT"
log "校验 Compose 配置。"
compose config >/dev/null

log "启动 Docker PostgreSQL 版本。"
compose up -d --build

log "等待健康检查。"
for index in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HEXCORE_API_PORT}/health" | grep -q '"storage":"postgres"'; then
    log "部署完成：http://127.0.0.1:${HEXCORE_APP_PORT}/"
    log "请在宝塔 Nginx 中合并 deploy/baota/nginx-hexcore.conf，并只对公网开放 80/443。"
    exit 0
  fi
  sleep 2
done

fail "服务已启动，但未确认 PostgreSQL 健康状态。请运行 deploy/baota/status-hexcore.sh 查看。"
