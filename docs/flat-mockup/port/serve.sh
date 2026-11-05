#!/bin/bash
# Стенд для переноса дизайна B в /m: настоящий сервер на свежей SQLite-базе ВНЕ репозитория.
#   ./serve.sh start   — создаёт пустую базу, запускает сервер на :3999, заполняет тестовыми данными (seed.js)
#   ./serve.sh stop    — останавливает сервер
#   ./serve.sh restart — stop + start (база создаётся заново)
#   ./serve.sh status  — показывает, запущен ли сервер
# Репозиторная chat_db/ не используется.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
STAND="${STAND_DIR:-/private/tmp/claude-501/-Users-bolgov-Documents-My-Projects-Chat/1b100143-140b-4b9d-bfad-21021ebb6c08/scratchpad/stand}"
PORT="${PORT:-3999}"
PIDF="$STAND/server.pid"

stop() {
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
    kill "$(cat "$PIDF")"; sleep 1; kill -9 "$(cat "$PIDF")" 2>/dev/null || true
    echo "сервер остановлен"
  else
    echo "сервер не запущен"
  fi
  rm -f "$PIDF"
  if [ -f "$STAND/hold.pid" ]; then kill "$(cat "$STAND/hold.pid")" 2>/dev/null || true; rm -f "$STAND/hold.pid"; fi
}

start() {
  stop >/dev/null
  rm -rf "$STAND/data"; mkdir -p "$STAND/data"
  cd "$ROOT/server"
  DB_PATH="$STAND/data/chat.db" PORT="$PORT" ELECTRON_CONF_DIR="$STAND/conf" \
    nohup node src/index.js > "$STAND/server.log" 2>&1 &
  echo $! > "$PIDF"
  for i in $(seq 1 40); do
    curl -s -o /dev/null "http://localhost:$PORT/m/" && break; sleep 0.5
  done
  node "$HERE/seed.js" "$PORT" "$STAND/data/chat.db"
  nohup node "$HERE/seed.js" hold "$PORT" "$STAND/data/chat.db" > "$STAND/hold.log" 2>&1 &
  echo $! > "$STAND/hold.pid"
  echo "стенд готов: http://localhost:$PORT/m/  (pid $(cat "$PIDF"), лог $STAND/server.log)"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  status) if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "запущен, pid $(cat "$PIDF")"; else echo "не запущен"; fi ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 1 ;;
esac
