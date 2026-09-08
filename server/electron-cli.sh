#!/usr/bin/env bash
#
# Управление сервером Electron из консоли.
# Ставится один раз:  ln -s /путь/к/репозиторию/server/electron-cli.sh /usr/local/bin/electron
#
# Обновление намеренно двух видов:
#   update           — штатное: подменяются файлы и перезапускается служба.
#                      Зависимости трогаются, только если изменился package-lock.
#                      Тот же вариант вызывает админка.
#   update --modules — вдобавок переустанавливает node_modules начисто.
#                      Нужно, когда нативный модуль повреждён (служба падает
#                      с SIGBUS) или после смены версии Node.

set -uo pipefail

SERVICE="${ELECTRON_SERVICE:-electron}"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
UPDATE_SH="$SCRIPT_DIR/update.sh"

usage() {
  cat <<EOF
Управление сервером Electron

  electron update             обновить: файлы + перезапуск службы
  electron update --modules   то же + чистая переустановка зависимостей
  electron status             состояние службы и текущая версия
  electron restart            перезапустить службу
  electron logs [N]           последние N строк журнала (по умолчанию 50)
  electron logs -f            следить за журналом

Обновление требует прав root: sudo electron update
EOF
}

need_root() {
  if [ "$(id -u)" != "0" ]; then
    echo "Нужны права root: sudo electron $*" >&2
    exit 1
  fi
}

case "${1:-}" in
  update)
    shift
    need_root update "$@"
    [ -x "$UPDATE_SH" ] || { echo "Не найден $UPDATE_SH" >&2; exit 1; }
    exec "$UPDATE_SH" "$@"
    ;;

  status)
    systemctl status "$SERVICE" --no-pager -n 0 || true
    echo
    if [ -f "$SCRIPT_DIR/version.json" ]; then
      echo "Версия сервера: $(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/version.json")"
    fi
    ( cd "$SCRIPT_DIR/.." && echo "Коммит:         $(git rev-parse --short HEAD 2>/dev/null || echo '—')" )
    ;;

  restart)
    need_root restart
    systemctl restart "$SERVICE" && echo "Служба перезапущена"
    ;;

  logs)
    if [ "${2:-}" = "-f" ]; then
      journalctl -u "$SERVICE" -f
    else
      journalctl -u "$SERVICE" -n "${2:-50}" --no-pager
    fi
    ;;

  ''|-h|--help|help) usage ;;
  *) echo "Неизвестная команда: $1" >&2; echo; usage; exit 2 ;;
esac
