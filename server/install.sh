#!/bin/bash
# Установка сервера Electron: один спокойный экран. Сначала вопрос про порт, потом шаги с индикатором.
# Подробный вывод всех команд (apt, npm и т. д.) пишется в журнал, на экране остаются только итоги шагов.
#   sudo PORT=8443 bash install.sh      — порт можно задать заранее, тогда вопроса не будет
#   DB_DIR=/data/electron_db            — папка базы данных (по умолчанию electron_db рядом с папкой server)
#   sudo DB=postgres bash install.sh    — сразу с PostgreSQL (или --postgres); DB=sqlite или --sqlite — с SQLite
#   sudo bash install.sh --postgres-only — на уже работающем сервере только поставить PostgreSQL и вывести данные
#                                          подключения для админки (остальное не трогается)

# ── Проверка root ──
if [ "$EUID" -ne 0 ]; then
  echo "✗ Запустите скрипт от root: sudo bash install.sh"
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="electron"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
LOG="/var/log/electron-install.log"

# ── Параметры ──
# База данных: новые установки кладут её в electron_db/main_base.db рядом с папкой server.
# При переустановке поверх работающей службы путь берётся из неё (так прежние установки с chat_db/chat.db остаются на своём месте);
# явно заданная переменная DB_DIR сильнее: тогда база будет искаться там, под прежним именем файла main_base.db
DB_FILE="main_base.db"
OLD_DB_PATH="$(grep -h '^Environment=DB_PATH=' "$SERVICE_FILE" 2>/dev/null | head -1 | cut -d= -f3-)"
if [ -z "${DB_DIR+x}" ] && [ -n "$OLD_DB_PATH" ]; then
  DB_PATH="$OLD_DB_PATH"
  DB_DIR="$(dirname "$OLD_DB_PATH")"
else
  DB_DIR="${DB_DIR:-$APP_DIR/../electron_db}"
  DB_PATH="$DB_DIR/$DB_FILE"
fi
# Порт: заданный заранее, иначе прежний из службы (чтобы переустановка не сбрасывала его), иначе 3000
OLD_PORT="$(grep -h '^Environment=PORT=' "$SERVICE_FILE" 2>/dev/null | head -1 | cut -d= -f3-)"
PORT_GIVEN="${PORT:-}"
PORT="${PORT:-${OLD_PORT:-3000}}"

# ═════════════ Оформление ═════════════
# UTF-8 нужен для рамки и значков; без него (или без терминала) выводим простые строки
case "${LC_ALL:-${LANG:-}}" in *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) ;; *) export LC_ALL=C.UTF-8 ;; esac
UI_BOX=0
if [ -t 1 ] && [ "$(printf 'я' | wc -m | tr -d ' ')" = "1" ] && [ "$(tput cols 2>/dev/null || echo 80)" -ge 56 ]; then UI_BOX=1; fi
if [ -t 1 ]; then
  C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_C=$'\033[36m'; C_D=$'\033[90m'; C_W=$'\033[1;97m'; C_0=$'\033[0m'
else
  C_G=""; C_Y=""; C_R=""; C_C=""; C_D=""; C_W=""; C_0=""
fi
if [ "$UI_BOX" = 1 ]; then I_OK="✓"; I_ERR="✗"; else I_OK="+"; I_ERR="x"; fi
I_WARN="!"
SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
W=52                      # ширина содержимого рамки между вертикальными линиями
BAR_W=$((W - 14))

# Набор шагов зависит от выбранного движка и режима: см. setup_steps
NAMES=("Система" "Node.js" "Зависимости" "База данных" "Автозапуск" "Команда electron" "ffmpeg и sqlite3" "Запуск сервера")
FUNCS=(step_system step_node step_deps step_db step_service step_cli step_tools step_start)
TOTAL=${#NAMES[@]}
CONF_DIR="${ELECTRON_CONF_DIR:-/etc/electron}"
MODE="install"            # install — установка или обновление, pgonly — только PostgreSQL на готовом сервере
DB_ENGINE=""              # sqlite | postgres
CUR_K=0                   # номер выполняемого шага (шаги пишут по нему свои заметки)
ST=()                     # состояние шагов: pend / run / ok / warn / err
TM=()                     # время шагов
SUF=()                    # подпись после названия (например, версия Node.js)
PASS=0                    # сколько шагов уже выполнено
STATE_DIR=""

now_ms() { local t; t=$(date +%s%3N 2>/dev/null); case "$t" in ''|*[!0-9]*) echo $(( $(date +%s) * 1000 ));; *) echo "$t";; esac; }
fmt_time() {
  local ms=$1 s=$(( $1 / 1000 ))
  if [ "$s" -ge 60 ]; then printf '%d мин %d с' $((s / 60)) $((s % 60)); else printf '%d,%d с' "$s" $(( ms % 1000 / 100 )); fi
}
spaces() { local n=$1; [ "$n" -gt 0 ] && printf '%*s' "$n" ''; }

# Строка шага: «│ значок название подпись ........ время │»
row_text() {
  local k=$1 f=${2:-0} icon col nm="${NAMES[$1]}" sf="${SUF[$1]}" tm="" nmcol="$C_0" len gap
  case "${ST[$k]}" in
    ok)   icon="$I_OK";  col="$C_G" ;;
    warn) icon="$I_WARN"; col="$C_Y" ;;
    err)  icon="$I_ERR"; col="$C_R" ;;
    run)  icon="${SPIN[$((f % ${#SPIN[@]}))]}"; col="$C_C"; nmcol="$C_W" ;;
    *)    icon="·"; col="$C_D"; nmcol="$C_D" ;;
  esac
  [ -n "${TM[$k]}" ] && tm="$(fmt_time "${TM[$k]}")"
  len=$(( 2 + ${#nm} + ${#tm} )); [ -n "$sf" ] && len=$(( len + 1 + ${#sf} ))
  gap=$(( W - 2 - len )); [ "$gap" -lt 1 ] && gap=1
  printf '%s│%s %s%s%s %s%s%s' "$C_D" "$C_0" "$col" "$icon" "$C_0" "$nmcol" "$nm" "$C_0"
  [ -n "$sf" ] && printf ' %s%s%s' "$C_D" "$sf" "$C_0"
  printf '%s%s%s%s %s│%s' "$(spaces "$gap")" "$C_D" "$tm" "$C_0" "$C_D" "$C_0"
}
# Полоса прогресса и счётчик «3 / 8»
bar_text() {
  local col="$C_C" n i out="" cnt="$1 / $TOTAL"
  case "$FINAL" in ok) col="$C_G" ;; warn) col="$C_Y" ;; err) col="$C_R" ;; esac
  n=$(( BAR_W * $1 / TOTAL ))
  if [ "$n" -le 0 ]; then for ((i = 0; i < BAR_W; i++)); do out+="─"; done
  elif [ "$n" -ge "$BAR_W" ]; then for ((i = 0; i < BAR_W; i++)); do out+="━"; done
  else for ((i = 0; i < n - 1; i++)); do out+="━"; done; out+="╸"; for ((i = n; i < BAR_W; i++)); do out+="─"; done; fi
  printf '%s│%s %s%s%s  %s%5s%s%s %s│%s' "$C_D" "$C_0" "$col" "$out" "$C_0" "$C_D" "$cnt" "$C_0" "$(spaces $(( W - BAR_W - 9 )))" "$C_D" "$C_0"
}
empty_row() { printf '%s│%s%s%s│%s' "$C_D" "$C_0" "$(spaces "$W")" "$C_D" "$C_0"; }
# Строки рамки сверху вниз: 0 верх, 1 пусто, 2…(TOTAL+1) шаги, TOTAL+2 пусто, TOTAL+3 полоса, TOTAL+4 низ. Курсор стоит под рамкой
BOX_ROWS=$(( TOTAL + 5 ))
draw_box() {
  local k line="" i
  for ((i = 0; i < W - 11; i++)); do line+="─"; done
  printf '%s╭─%s %sElectron%s %s%s╮%s\n' "$C_D" "$C_0" "$C_W" "$C_0" "$C_D" "$line" "$C_0"
  empty_row; echo
  for ((k = 0; k < TOTAL; k++)); do row_text "$k"; echo; done
  empty_row; echo
  bar_text 0; echo
  line=""; for ((i = 0; i < W; i++)); do line+="─"; done
  printf '%s╰%s╯%s\n' "$C_D" "$line" "$C_0"
}
# Перерисовать одну строку рамки (r — номер строки сверху), не трогая остальные
redraw() {
  local r=$1 up=$(( BOX_ROWS - $1 ))
  printf '\033[%dA\r' "$up"; shift
  "$@"
  printf '\033[%dB\r' "$up"
}
cleanup() { [ "$UI_BOX" = 1 ] && printf '\033[?25h'; [ -n "$STATE_DIR" ] && rm -rf "$STATE_DIR"; }
trap cleanup EXIT
trap 'kill $(jobs -p) 2>/dev/null; echo; echo "Установка прервана."; exit 130' INT TERM

# ═════════════ Шаги установки (выполняются в фоне, весь вывод идёт в журнал) ═════════════
# Выход 0 — успешно, 10 — выполнено с предупреждением, остальное — ошибка
pm_install() {
  case "$PKG" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    yum)    yum install -y "$@" || dnf install -y "$@" ;;
    pacman) pacman -S --noconfirm --needed "$@" ;;
  esac
}
step_system() {
  case "$PKG" in
    apt)    apt-get update -q; pm_install curl ca-certificates build-essential python3 ;;
    yum)    pm_install curl ca-certificates gcc gcc-c++ make python3 ;;
    pacman) pacman -Sy --noconfirm; pm_install curl base-devel python ;;
  esac
}
step_node() {
  if command -v node >/dev/null 2>&1 && node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null; then
    :
  else
    case "$PKG" in
      apt)    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && pm_install nodejs ;;
      yum)    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && pm_install nodejs ;;
      pacman) pm_install nodejs npm ;;
    esac
  fi
  node --version | tr -d '\n' > "$STATE_DIR/note.$CUR_K"
}
step_deps() {
  cd "$APP_DIR"
  # Устойчивые таймауты для медленных или нестабильных сетей
  npm config set fetch-timeout 300000
  npm config set fetch-retries 5
  # Нативный модуль собираем локально: у части хостингов GitHub Releases заблокирован или медленный
  npm install --omit=dev --build-from-source
  npm rebuild better-sqlite3 --build-from-source
}
# Установка PostgreSQL скриптом pg-setup.sh (тем же, что вызывает админка). Его прогресс показываем процентами у названия шага
run_pg_setup() {
  local line rc
  rm -f "$STATE_DIR/pg.err" "$STATE_DIR/pg.json"
  bash "$APP_DIR/pg-setup.sh" 2>&1 | while IFS= read -r line; do
    echo "$line"
    case "$line" in
      @RESULT\|*) echo "${line#@RESULT|}" > "$STATE_DIR/pg.json" ;;
      @ERROR\|*)  echo "${line#@ERROR|}" > "$STATE_DIR/pg.err" ;;
      @[0-9]*\|*) line="${line#@}"; echo "${line%%|*}%" > "$STATE_DIR/live.$CUR_K" ;;
    esac
  done
  rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] && [ -s "$STATE_DIR/pg.json" ]
}
pg_field() { sed -n "s/^$1=//p" "$CONF_DIR/postgres.txt" 2>/dev/null | head -1; }
# Полная установка: после PostgreSQL записываем подключение, служба подхватит его из файла окружения
step_postgres() {
  run_pg_setup || return 1
  mkdir -p "$CONF_DIR"; chmod 700 "$CONF_DIR"
  ( umask 077; printf 'DATABASE_URL=postgres://%s:%s@%s:%s/%s\n' "$(pg_field user)" "$(pg_field password)" "$(pg_field host)" "$(pg_field port)" "$(pg_field database)" > "$CONF_DIR/database.env" )
  chmod 600 "$CONF_DIR/database.env"
}
# Режим «только PostgreSQL»: ничего в работающем сервере не меняем
step_postgres_only() { run_pg_setup; }
step_db() {
  mkdir -p "$DB_DIR"
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" > "$STATE_DIR/jwt"
}
step_service() {
  local old
  for old in electron corp-chat; do
    if systemctl is-active --quiet "$old" 2>/dev/null; then
      systemctl stop "$old" 2>/dev/null || true
      systemctl disable "$old" 2>/dev/null || true
    fi
    [ -f "/etc/systemd/system/${old}.service" ] && rm -f "/etc/systemd/system/${old}.service"
  done
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Electron Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=JWT_SECRET=$(cat "$STATE_DIR/jwt")
Environment=DB_PATH=$DB_PATH
# Подключение к PostgreSQL (если база перенесена или выбрана при установке); файла нет — работает SQLite
EnvironmentFile=-$CONF_DIR/database.env

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}
step_cli() {
  chmod +x "$APP_DIR/electron"
  ln -sf "$APP_DIR/electron" /usr/local/bin/electron
}
# sqlite3 нужен панели для статистики БД, ffmpeg серверу для голосовых и видео (upload.js)
step_tools() {
  local sq=1; [ "$DB_ENGINE" = postgres ] && sq=0
  case "$PKG" in
    apt)    [ "$sq" = 1 ] && { pm_install sqlite3 || true; }; pm_install ffmpeg || true ;;
    yum)    [ "$sq" = 1 ] && { pm_install sqlite || true; }; pm_install ffmpeg || true ;;
    pacman) [ "$sq" = 1 ] && { pm_install sqlite || true; }; pm_install ffmpeg || true ;;
  esac
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg не установился: голосовые и видео не будут сжиматься" > "$STATE_DIR/warn.$CUR_K"
    return 10
  fi
}
step_start() {
  local i
  systemctl restart "$SERVICE_NAME"
  for i in $(seq 1 40); do
    if systemctl is-active --quiet "$SERVICE_NAME" && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

# ═════════════ Запуск шагов ═════════════
run_step() {
  local k=$1 pid t0 f=0 rc note
  CUR_K=$k
  ST[$k]=run; t0=$(now_ms)
  ( set -e; "${FUNCS[$k]}" ) >> "$LOG" 2>&1 &
  pid=$!
  if [ "$UI_BOX" = 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      [ -s "$STATE_DIR/live.$k" ] && SUF[$k]="$(cat "$STATE_DIR/live.$k")"
      redraw $((k + 2)) row_text "$k" "$f"; f=$((f + 1)); sleep 0.1
    done
  fi
  wait "$pid"; rc=$?
  TM[$k]=$(( $(now_ms) - t0 ))
  case $rc in 0) ST[$k]=ok ;; 10) ST[$k]=warn ;; *) ST[$k]=err ;; esac
  rm -f "$STATE_DIR/live.$k"; SUF[$k]=""
  [ -s "$STATE_DIR/note.$k" ] && SUF[$k]="$(cat "$STATE_DIR/note.$k")"
  [ "${ST[$k]}" != err ] && PASS=$((PASS + 1))
  if [ "$UI_BOX" = 1 ]; then
    redraw $((k + 2)) row_text "$k"
    redraw $((TOTAL + 3)) bar_text "$PASS"
  else
    local mark="$I_ERR"
    [ "${ST[$k]}" = ok ] && mark="$I_OK"
    [ "${ST[$k]}" = warn ] && mark="$I_WARN"
    printf '%s %s (%s)\n' "$mark" "${NAMES[$k]}${SUF[$k]:+ ${SUF[$k]}}" "$(fmt_time "${TM[$k]}")"
  fi
  [ "${ST[$k]}" != err ]
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
# Занят ли порт чужой программой: свою же работающую службу на этом порту не считаем
port_foreign() {
  port_busy "$1" || return 1
  [ "$1" = "$OLD_PORT" ] && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null && return 1
  return 0
}
port_problem() {
  case "$1" in ''|*[!0-9]*) echo "Введите число от 1 до 65535"; return ;; esac
  if [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then echo "Введите число от 1 до 65535"; return; fi
  port_foreign "$1" && echo "Порт $1 уже занят другой программой, укажите другой"
}
ask_port() {
  local v p
  if [ -n "$PORT_GIVEN" ] || [ ! -t 0 ]; then
    p="$(port_problem "$PORT")"
    if [ -n "$p" ]; then echo "$I_ERR $p"; exit 1; fi
    echo "Порт сервера  ${C_G}${PORT}${C_0}"; echo
    return
  fi
  while true; do
    read -r -p "Порт сервера [$PORT]: " v || { echo; v=""; }
    v="${v:-$PORT}"
    p="$(port_problem "$v")"
    if [ -z "$p" ]; then PORT="$v"; break; fi
    printf '\033[1A\033[2K\r%s%s %s%s\n' "$C_Y" "$I_WARN" "$p" "$C_0"
  done
  printf '\033[1A\033[2K\rПорт сервера  %s%s%s\n\n' "$C_G" "$PORT" "$C_0"
}

# ── Выбор режима и базы данных ──
# Меню рисуется под вопросом и после ответа сворачивается в одну строку
ask_choice() {   # ask_choice «заголовок» «пункт 1» «пункт 2»… → номер в REPLY_N (по умолчанию 1)
  local title=$1 i n v bad=0; shift; n=$#
  echo "$title"
  i=1; for v in "$@"; do if [ "$i" = 1 ]; then echo "  ${C_W}$i${C_0}  $v ${C_D}(по умолчанию)${C_0}"; else echo "  ${C_W}$i${C_0}  $v"; fi; i=$((i + 1)); done
  while true; do
    read -r -p "Выбор [1]: " v || { echo; v=""; }
    v="${v:-1}"
    case "$v" in *[!0-9]*|'') v=0 ;; esac
    if [ "$v" -ge 1 ] && [ "$v" -le "$n" ]; then REPLY_N=$v; break; fi
    printf '\033[1A\033[2K\r%s%s Введите число от 1 до %s%s\n' "$C_Y" "$I_WARN" "$n" "$C_0"; bad=$((bad + 1))
  done
  printf '\033[%dA\033[J' $(( n + 2 + bad ))
}

server_installed() { [ -f "$SERVICE_FILE" ]; }
pg_connected()     { [ -f "$CONF_DIR/database.env" ]; }

# Что делаем и на какой базе. Явные флаги и переменные сильнее вопросов; без терминала вопросов нет
choose_mode() {
  local a want_db="${DB:-}" pgonly=0 interactive=0
  [ -t 0 ] && interactive=1
  for a in "$@"; do
    case "$a" in
      --postgres-only) pgonly=1 ;;
      --postgres)      want_db=postgres ;;
      --sqlite)        want_db=sqlite ;;
    esac
  done
  case "$want_db" in ''|sqlite|postgres) ;; postgres*|pg) want_db=postgres ;; *) echo "$I_ERR DB: допустимо sqlite или postgres"; exit 1 ;; esac

  if [ "$pgonly" = 1 ]; then
    server_installed || { echo "$I_ERR Сервер не установлен: запустите обычную установку (без --postgres-only)"; exit 1; }
    pg_connected && { echo "$I_OK Сервер уже работает на PostgreSQL"; exit 0; }
    MODE=pgonly; return
  fi

  # Сервер уже стоит: предлагаем только PostgreSQL (если он ещё не подключён)
  if server_installed && ! pg_connected && [ -z "$want_db" ] && [ "$interactive" = 1 ]; then
    ask_choice "Сервер уже установлен. Что сделать?" "Обновить установку" "Только установить PostgreSQL"
    if [ "$REPLY_N" = 2 ]; then MODE=pgonly; echo "Режим  ${C_G}только PostgreSQL${C_0}"; echo; return; fi
    echo "Режим  ${C_G}обновить установку${C_0}"
  fi

  # Движок: уже подключённый PostgreSQL сохраняется; для готовой установки на SQLite он остаётся прежним
  if pg_connected; then DB_ENGINE=postgres
  elif [ -n "$want_db" ]; then DB_ENGINE="$want_db"
  elif server_installed; then DB_ENGINE=sqlite
  elif [ "$interactive" = 1 ]; then
    ask_choice "База данных" "SQLite: проще всего, ничего не нужно настраивать" "PostgreSQL: для больших серверов, ставится на этот же сервер"
    [ "$REPLY_N" = 2 ] && DB_ENGINE=postgres || DB_ENGINE=sqlite
  else DB_ENGINE=sqlite; fi
  echo "База данных  ${C_G}$([ "$DB_ENGINE" = postgres ] && echo PostgreSQL || echo SQLite)${C_0}"
}

setup_steps() {
  if [ "$MODE" = pgonly ]; then
    NAMES=("PostgreSQL"); FUNCS=(step_postgres_only)
  elif [ "$DB_ENGINE" = postgres ]; then
    NAMES=("Система" "Node.js" "Зависимости" "PostgreSQL" "База данных" "Автозапуск" "Команда electron" "ffmpeg" "Запуск сервера")
    FUNCS=(step_system step_node step_deps step_postgres step_db step_service step_cli step_tools step_start)
  fi
  TOTAL=${#NAMES[@]}; BOX_ROWS=$(( TOTAL + 5 ))
}

# Строка «название   значение»: выравниваем по числу символов, а не байтов
kv() { printf '    %s%s %s\n' "$1" "$(spaces $(( 13 - ${#1} )))" "$2"; }
# Данные подключения для формы в админке
print_pg_summary() {
  echo
  echo "${C_G}${I_OK} PostgreSQL установлен и настроен${C_0}"
  echo "  Данные для подключения ${C_D}(админка → Настройки → База данных)${C_0}"
  kv "Адрес" "$(pg_field host)"; kv "Порт" "$(pg_field port)"; kv "База" "$(pg_field database)"; kv "Пользователь" "$(pg_field user)"
  kv "Пароль" "${C_W}$(pg_field password)${C_0}"
  echo
  echo "  ${C_D}Они же сохранены в $CONF_DIR/postgres.txt (доступ только у root).${C_0}"
  echo "  ${C_D}Дальше: «Проверить соединение» и «Перенести» в админке. Сервер продолжает работать на SQLite.${C_0}"
}

main() {
  : > "$LOG" 2>/dev/null || LOG=/dev/null
  echo "Electron: установка $(date '+%F %T')" >> "$LOG"
  STATE_DIR="$(mktemp -d)"

  # ── Определение дистрибутива ──
  if [ -f /etc/debian_version ]; then PKG="apt"
  elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then PKG="yum"
  elif [ -f /etc/arch-release ]; then PKG="pacman"
  else echo "✗ Неизвестный дистрибутив. Установите Node.js 20+ вручную."; exit 1; fi

  echo "${C_W}Electron${C_0} ${C_D}установка${C_0}"; echo
  choose_mode "$@"
  [ "$MODE" = pgonly ] || ask_port
  setup_steps

  local k
  for ((k = 0; k < TOTAL; k++)); do ST[$k]=pend; TM[$k]=""; SUF[$k]=""; done
  FINAL=run
  [ "$UI_BOX" = 1 ] && { printf '\033[?25l'; draw_box; }

  local failed=-1
  for ((k = 0; k < TOTAL; k++)); do
    run_step "$k" || { failed=$k; break; }
  done

  local warn=0 w
  for ((k = 0; k < TOTAL; k++)); do [ "${ST[$k]}" = warn ] && warn=1; done
  if [ "$failed" -ge 0 ]; then FINAL=err; elif [ "$warn" = 1 ]; then FINAL=warn; else FINAL=ok; fi
  if [ "$UI_BOX" = 1 ]; then redraw $((TOTAL + 3)) bar_text "$PASS"; printf '\033[?25h'; fi

  for ((k = 0; k < TOTAL; k++)); do
    [ -s "$STATE_DIR/warn.$k" ] && { [ "$warn" = 1 ] && [ "${shown:-0}" = 0 ] && { echo; shown=1; }; echo "${C_Y}${I_WARN} $(cat "$STATE_DIR/warn.$k")${C_0}"; }
  done
  if [ "$failed" -ge 0 ]; then
    echo
    echo "${C_R}${I_ERR} Не удалось выполнить шаг «${NAMES[$failed]}»${C_0}"
    [ -s "$STATE_DIR/pg.err" ] && echo "  ${C_R}$(cat "$STATE_DIR/pg.err")${C_0}"
    tail -n 6 "$LOG" 2>/dev/null | sed "s/^/  ${C_D}/; s/\$/${C_0}/"
    echo "  ${C_D}Полный журнал: $LOG${C_0}"
    exit 1
  fi
  if [ "$MODE" = pgonly ]; then print_pg_summary; return; fi
  local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; ip="${ip:-localhost}"
  echo
  if [ "$FINAL" = warn ]; then echo "${C_Y}${I_WARN} Сервер запущен, но не всё получилось${C_0}"
  else echo "${C_G}${I_OK} Сервер запущен${C_0} ${C_D}за $(fmt_time $((SECONDS * 1000)))${C_0}"; fi
  echo "  ${C_W}http://$ip:$PORT${C_0}"
  echo "  ${C_D}electron — панель управления${C_0}"
}

# При подключении файла (source) только определяем функции; запуск — когда скрипт вызван напрямую
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
