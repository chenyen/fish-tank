#!/usr/bin/env bash
# 鱼缸项目 —— 生产自动更新脚本（轮询式 / 镜像仓库版）
#
# 作用：拉取 GHCR 上的最新镜像，比对当前容器所用镜像，有变化才重建容器。
# 用法：由 1Panel「计划任务」定时调用；也可手动 bash deploy/auto-update.sh
# 说明：
#   - 代码不放在 NAS 也能更新（镜像即产物），NAS 上只需本脚本 + docker-compose.yml + ./data。
#   - 只在镜像变化时才重建，没变化不折腾容器。
#   - 数据在 ./data 卷里，重建不会丢。
#   - 日志写到 logs/auto-update.log，方便在 1Panel 里排查。

set -u

# ---- 目录定位（脚本在 <项目根>/deploy/auto-update.sh）----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

LOG_FILE="$PROJECT_DIR/logs/auto-update.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

# ---- 并发保护：flock 防止上一轮没跑完又被触发 ----
LOCK_FILE="$PROJECT_DIR/logs/.auto-update.lock"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { log "上一轮更新仍在进行，跳过本次"; exit 0; }
fi

IMAGE="ghcr.io/chenyen/fish-tank:latest"
CONTAINER="fish-tank"

log "===== 开始检查镜像更新 ====="

# ---- 前置检查 ----
if ! command -v docker >/dev/null 2>&1; then
  log "错误：未找到 docker"; exit 1
fi
DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
  else
    log "错误：未找到 docker compose"; exit 1
  fi
fi

# ---- 记录当前容器所用镜像 ID（未创建容器时为空）----
OLD_ID="$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null | cut -c1-32)"
if [ -z "$OLD_ID" ]; then
  log "未发现运行中的容器，将执行首次部署"
fi

# ---- 拉取最新镜像 ----
log "正在拉取 $IMAGE ..."
if ! $DC pull >>"$LOG_FILE" 2>&1; then
  log "错误：镜像拉取失败。若是私有镜像，请先 docker login ghcr.io；或检查网络 / 镜像名"
  exit 1
fi

# ---- 取新拉取镜像的 ID ----
NEW_ID="$(docker image inspect "$IMAGE" -f '{{.Id}}' 2>/dev/null | cut -c1-32)"
if [ -z "$NEW_ID" ]; then
  log "错误：本地找不到镜像 $IMAGE，无法比对"; exit 1
fi

# ---- 比对：镜像没变就不重建 ----
if [ -n "$OLD_ID" ] && [ "$OLD_ID" = "$NEW_ID" ]; then
  log "镜像未变化（${NEW_ID}），无需更新"
  exit 0
fi

log "发现新镜像：${OLD_ID:-无} -> ${NEW_ID}，开始重建容器"

# ---- 用新镜像重建容器 ----
if ! $DC up -d --force-recreate --remove-orphans >>"$LOG_FILE" 2>&1; then
  log "错误：docker compose 重建失败，可查看上方输出"; exit 1
fi

# ---- 清理悬空旧镜像，避免占满磁盘 ----
docker image prune -f >>"$LOG_FILE" 2>&1 || true

# ---- 健康检查：等待服务返回 200 ----
OK=0
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8848/ 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then OK=1; break; fi
  sleep 2
done
if [ "$OK" = "1" ]; then
  log "更新完成 ✅ 新镜像 ${NEW_ID}，服务健康检查通过"
else
  log "警告：容器已重建，但健康检查未通过，请手动检查服务状态"
fi
