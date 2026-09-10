#!/usr/bin/env bash
#
# Обновление сервера. Запускается двумя способами:
#   • из консоли:  sudo /путь/к/репозиторию/server/update.sh
#   • из админки:  через systemd-run (см. routes/admin.js)
#
# Два разных пути обновления, потому что файлы ведут себя по-разному:
#
#   .js / .css — Node читает их в память при запуске, файл на диске дальше
#     не нужен. Переписывать под работающим процессом безопасно: достаточно
#     заменить и перезапустить службу. Это обычный случай.
#
#   better_sqlite3.node — нативная библиотека, отображённая в память. Если
#     npm перезапишет её под работающим процессом, тот получит SIGBUS. Раньше
#     сервер от этого падал, systemd убивал всю группу процессов вместе с
#     самим обновлением, на диске оставался недописанный модуль — и служба
#     уходила в бесконечный цикл перезапусков. Поэтому при смене зависимостей
#     службу останавливаем ДО установки.

set -uo pipefail

# --modules — принудительно переустановить зависимости, даже если package-lock
# не менялся. Нужно, когда node_modules повреждён — например, оборванной установкой.
FORCE_MODULES=0
for arg in "$@"; do
  case "$arg" in
    --modules|-m) FORCE_MODULES=1 ;;
    *) echo "[update] неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

SERVICE="${ELECTRON_SERVICE:-electron}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$APP_DIR/server"

log()  { echo "[update] $*"; }
fail() { echo "[update] ОШИБКА: $*" >&2; }

# Шаги для админки: строки «время шаг состояние [пояснение]» в файл, путь к
# которому передаёт admin.js в UPDATE_STATUS_FILE. Админка показывает по ним, что
# сделано на самом деле, в том числе пропущенные шаги. Из консоли переменной нет —
# ничего не пишем.
#   шаги:      fetch · deps · build · restart, итог — result
#   состояния: active · done · skipped · failed; для result — done · uptodate · failed
STATUS_FILE="${UPDATE_STATUS_FILE:-}"
status() {
  [ -n "$STATUS_FILE" ] || return 0
  printf '%s %s %s %s\n' "$(date +%s)" "$1" "$2" "${3:-}" >> "$STATUS_FILE" 2>/dev/null || true
}

cd "$APP_DIR" || { fail "нет каталога $APP_DIR"; status fetch failed "нет каталога приложения"; status result failed; exit 1; }

# ── 1. Смотрим, есть ли что обновлять. Если сеть недоступна — ничего не трогаем.
status fetch active
log "проверяю обновления в origin/main"
if ! GIT_TERMINAL_PROMPT=0 git -c credential.helper='' fetch origin main; then
  fail "не удалось получить изменения из origin (сеть или доступ). Служба не тронута."
  status fetch failed "не удалось получить обновление с GitHub — служба не тронута"
  status result failed
  exit 1
fi

PREV_COMMIT="$(git rev-parse HEAD)"
if [ "$PREV_COMMIT" = "$(git rev-parse origin/main)" ] && [ "$FORCE_MODULES" = "0" ]; then
  log "уже актуальная версия ($(git rev-parse --short HEAD)), обновление не требуется"
  status fetch done
  status result uptodate
  exit 0
fi
log "обновление: $(git rev-parse --short HEAD) → $(git rev-parse --short origin/main)"

# ── 2. Решаем, нужны ли вообще зависимости.
#      Меняется package-lock.json — значит, трогаем node_modules и нужен простой.
DEPS_CHANGED=0
if [ "$FORCE_MODULES" = "1" ]; then
  DEPS_CHANGED=1
  log "запрошена переустановка зависимостей (--modules)"
elif ! git diff --quiet "$PREV_COMMIT" origin/main -- server/package-lock.json server/package.json; then
  DEPS_CHANGED=1
  log "зависимости изменились — потребуется остановка службы"
elif [ ! -d "$SERVER_DIR/node_modules" ]; then
  DEPS_CHANGED=1
  log "node_modules отсутствует — потребуется установка"
else
  log "зависимости не менялись — обновляю только файлы, без остановки"
fi

rollback() {
  fail "откатываюсь на ${PREV_COMMIT:0:7}"
  git reset --hard "$PREV_COMMIT" >/dev/null 2>&1
  [ "$DEPS_CHANGED" = "1" ] && (cd "$SERVER_DIR" && npm install --omit=dev --build-from-source >/dev/null 2>&1)
}

# ── 3. Останавливаем службу только там, где это действительно нужно
if [ "$DEPS_CHANGED" = "1" ]; then
  log "останавливаю $SERVICE"
  systemctl stop "$SERVICE" || fail "не удалось остановить службу (продолжаю)"
fi

# ── 4. Файлы
if ! git reset --hard origin/main; then
  fail "не удалось применить обновление"
  status fetch failed "не удалось применить обновление"
  status result failed
  [ "$DEPS_CHANGED" = "1" ] && systemctl start "$SERVICE"
  exit 1
fi
status fetch done

# ── 5. Зависимости — только если менялись
if [ "$DEPS_CHANGED" = "1" ]; then
  # При --modules ставим начисто: флаг для того и нужен, чтобы починить
  # повреждённый node_modules, а поверх него npm install может не помочь
  if [ "$FORCE_MODULES" = "1" ] && [ -d "$SERVER_DIR/node_modules" ]; then
    log "удаляю node_modules для чистой установки"
    rm -rf "$SERVER_DIR/node_modules"
  fi
  status deps active
  log "устанавливаю зависимости"
  if ! (cd "$SERVER_DIR" && npm install --omit=dev --build-from-source); then
    fail "npm install не отработал"
    status deps failed "npm install не отработал — возвращаю прежнюю версию"
    status result failed
    rollback
    systemctl start "$SERVICE"
    exit 1
  fi
  status deps done
  # Пересобираем нативный модуль только если он не грузится:
  # обычно npm ставит готовую сборку и пересборка не нужна
  if ! (cd "$SERVER_DIR" && node -e "require('better-sqlite3')" >/dev/null 2>&1); then
    status build active
    log "better-sqlite3 не загружается — пересобираю"
    if ! (cd "$SERVER_DIR" && npm rebuild better-sqlite3 --build-from-source); then
      fail "пересборка better-sqlite3 не удалась"
      status build failed "пересборка better-sqlite3 не удалась — возвращаю прежнюю версию"
      status result failed
      rollback
      systemctl start "$SERVICE"
      exit 1
    fi
    status build done
  else
    status build skipped
  fi
else
  status deps skipped
  status build skipped
fi

# ── 6. Пуск (или перезапуск, если службу не останавливали)
status restart active
if [ "$DEPS_CHANGED" = "1" ]; then
  log "запускаю $SERVICE"
  systemctl start "$SERVICE"
else
  log "перезапускаю $SERVICE"
  systemctl restart "$SERVICE"
fi

sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  log "готово, версия $(git rev-parse --short HEAD)"
  status restart done
  status result done
else
  fail "служба не поднялась после обновления"
  status restart failed "служба не поднялась — возвращаю прежнюю версию"
  status result failed
  rollback
  systemctl start "$SERVICE"
  exit 1
fi
