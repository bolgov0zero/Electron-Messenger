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
# Рамки, значки и анимация работают в терминале с UTF-8 шириной от 60 колонок. Без цвета (NO_COLOR), без терминала
# (вывод в файл, ssh без tty) и в узком окне скрипт печатает простые строки.
case "${LC_ALL:-${LANG:-}}" in *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) ;; *) export LC_ALL=C.UTF-8 ;; esac
# Размер окна: stty читает его у терминала; tput внутри $(…) может не видеть окно и вернуть 24×80
term_dim() {
  local d; d="$(stty size 2>/dev/null </dev/tty)"
  [ -n "$d" ] || d="$(tput lines 2>/dev/null || echo 24) $(tput cols 2>/dev/null || echo 80)"
  TERM_ROWS=${d% *}; TERM_COLS=${d#* }
}
term_dim
UI_BOX=0
if [ -t 1 ] && [ "$(printf 'я' | wc -m | tr -d ' ')" = "1" ] && [ "$TERM_COLS" -ge 60 ]; then UI_BOX=1; fi
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_C=$'\033[36m'; C_D=$'\033[90m'; C_W=$'\033[1;97m'; C_0=$'\033[0m'; C_REV=$'\033[7m'
else
  C_G=""; C_Y=""; C_R=""; C_C=""; C_D=""; C_W=""; C_0=""; C_REV=""
fi
if [ "$UI_BOX" = 1 ]; then I_OK="✓"; I_ERR="✗"; else I_OK="+"; I_ERR="x"; fi
I_WARN="!"
SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
W=56                      # ширина содержимого рамки между вертикальными линиями
BAR_W=$((W - 22))

# Набор шагов зависит от выбранного движка и режима: см. setup_steps
NAMES=("Система" "Node.js" "Зависимости" "База данных" "Автозапуск" "Команда electron" "ffmpeg и sqlite3" "Запуск сервера")
FUNCS=(step_system step_node step_deps step_db step_service step_cli step_tools step_start)
TOTAL=${#NAMES[@]}
CONF_DIR="${ELECTRON_CONF_DIR:-/etc/electron}"
MODE="install"            # install — установка или обновление, pgonly — только PostgreSQL на готовом сервере
DB_ENGINE=""              # sqlite | postgres
FRESH=0                   # 1 — сервера ещё не было (создаётся первый администратор)
ADMIN_PASS=""             # пароль первого администратора (только при FRESH=1), показывается в конце установки
CUR_K=0                   # номер выполняемого шага (шаги пишут по нему свои заметки)
ST=()                     # состояние шагов: pend / run / ok / warn / err
TM=()                     # время шагов
SUF=()                    # подпись после названия (например, версия Node.js)
PASS=0                    # сколько шагов уже выполнено
STATE_DIR=""
PARAMS=()                 # ответы «название|значение» для рамки «Параметры»
PB_H=0; PB_LIVE=0         # высота нарисованной рамки «Параметры» и рисовать ли её сразу
CARD_H=0                  # высота карточки вопроса на экране
Q_NO=0; Q_TOTAL=0         # номер вопроса и сколько их будет
BOX_H=0                   # высота рамки, которую сейчас обновляем построчно
STEP_UI=0                 # 1 — шаги с анимацией, 0 — простые строки

now_ms() { local t; t=$(date +%s%3N 2>/dev/null); case "$t" in ''|*[!0-9]*) echo $(( $(date +%s) * 1000 ));; *) echo "$t";; esac; }
fmt_time() {
  local ms=$1 s=$(( $1 / 1000 ))
  if [ "$s" -ge 60 ]; then printf '%d мин %d с' $((s / 60)) $((s % 60)); else printf '%d,%d с' "$s" $(( ms % 1000 / 100 )); fi
}
spaces() { local n=$1; [ "$n" -gt 0 ] && printf '%*s' "$n" ''; }
rep() { local n=$1 i out=""; for ((i = 0; i < n; i++)); do out+="$2"; done; printf '%s' "$out"; }

# ── Рамки ──
# Ширина строки всегда W символов между линиями: считаем по числу символов, а не байтов
ui_line() { printf '%s│%s%s%s%s│%s' "$1" "$C_0" "$3" "$(spaces $((W - $2)))" "$1" "$C_0"; }   # цвет рамки, видимая длина, содержимое
ui_top()  { local t=" $2 "; printf '%s╭─%s%s%s%s%s%s╮%s' "$1" "${3:-$C_W}" "$t" "$C_0" "$1" "$(rep $((W - 1 - ${#t})) ─)" "$1" "$C_0"; }
ui_bot()  { printf '%s╰%s╯%s' "$1" "$(rep "$W" ─)" "$C_0"; }
ui_blank() { ui_line "$1" 0 ""; }
ui_plain() { local t="$3"; [ ${#t} -gt "$W" ] && t="${t:0:$((W - 1))}…"; ui_line "$1" "${#t}" "$2$t$C_0"; }   # цвет рамки, цвет текста, текст (с пробелом в начале)
ui_label() { local v="$3"; v="${v:0:$((W - 17))}"; ui_line "$1" "$((16 + ${#v}))" "   ${C_D}$2$(spaces $((13 - ${#2})))${C_0}$4${v}${C_0}"; }   # цвет рамки, подпись, значение, цвет значения
# Строка списка: значок, название, подпись после названия и значение справа
ui_kv() {   # рамка, значок, цвет значка, название, цвет названия, подпись, значение, цвет значения
  local bc=$1 ic=$2 icol=$3 nm=$4 ncol=$5 suf=$6 rt=$7 rcol=$8 room gap sm
  room=$((W - 4 - ${#nm}))
  [ ${#rt} -gt $((room - 2)) ] && rt="${rt:0:$((room - 3))}…"
  if [ -n "$suf" ]; then
    sm=$((room - ${#rt} - 3)); [ "$sm" -lt 2 ] && sm=2
    [ ${#suf} -gt "$sm" ] && suf="${suf:0:$((sm - 1))}…"
    suf=" $suf"
  fi
  gap=$((W - 4 - ${#nm} - ${#suf} - ${#rt})); [ "$gap" -lt 1 ] && gap=1
  ui_line "$bc" "$((4 + ${#nm} + ${#suf} + gap + ${#rt}))" " ${icol}${ic}${C_0} ${ncol}${nm}${C_0}${C_D}${suf}${C_0}$(spaces "$gap")${rcol}${rt}${C_0} "
}
# Полоса прогресса и подпись справа
ui_progress() {   # рамка, цвет полосы, сделано, всего, подпись
  local bc=$1 col=$2 done=$3 total=$4 tail=$5 n i out="" pct tl=0
  n=$(( BAR_W * done / total ))
  if [ "$n" -le 0 ]; then out="$(rep "$BAR_W" ─)"
  elif [ "$n" -ge "$BAR_W" ]; then out="$(rep "$BAR_W" ━)"
  else out="$(rep $((n - 1)) ━)╸$(rep $((BAR_W - n)) ─)"; fi
  pct="$(printf '%3d%%' $(( 100 * done / total )))"
  [ -n "$tail" ] && tl=$(( 2 + ${#tail} ))
  ui_line "$bc" "$((1 + BAR_W + 2 + 4 + tl))" " ${col}${out}${C_0}  ${C_W}${pct}${C_0}$([ -n "$tail" ] && printf '%s  %s%s' "$C_D" "$tail" "$C_0")"
}
# Перерисовать одну строку рамки (r — номер строки сверху), не трогая остальные
redraw() {
  local up=$(( BOX_H - $1 ))
  printf '\033[%dA\r' "$up"; shift
  "$@"
  printf '\033[%dB\r' "$up"
}
cleanup() { [ "$UI_BOX" = 1 ] && printf '\033[?25h'; [ -n "$STATE_DIR" ] && rm -rf "$STATE_DIR"; }
trap cleanup EXIT
trap 'kill $(jobs -p) 2>/dev/null; printf "\033[?25h\n"; echo "Установка прервана."; exit 130' INT TERM

# ── Шапка и экраны ──
ui_banner() {
  local ver word="ELECTRON" i r g b logo=""
  ver="$(sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' "$APP_DIR/version.json" 2>/dev/null | head -1)"
  case "${COLORTERM:-}" in
    *truecolor*|*24bit*)
      for ((i = 0; i < 8; i++)); do
        r=$(( 92 + (182 - 92) * i / 7 )); g=$(( 208 + (156 - 208) * i / 7 )); b=$(( 232 + (255 - 232) * i / 7 ))
        logo+="$(printf '\033[1;38;2;%d;%d;%dm%s' "$r" "$g" "$b" "${word:i:1}")${C_0} "
      done ;;
    *) for ((i = 0; i < 8; i++)); do logo+="${C_C}${word:i:1}${C_0} "; done ;;
  esac
  echo
  echo "  ${C_C}◆${C_0} ${logo} ${C_D}сервер корпоративного мессенджера${C_0}"
  echo "  ${C_D}установка${ver:+ · версия s$ver}${C_0}"
  echo "  ${C_D}$(rep "$W" ─)${C_0}"
  echo
}
# Очистить экран и нарисовать шапку
ui_screen() {
  [ -t 1 ] && printf '\033[2J\033[H'
  if [ "$UI_BOX" = 1 ]; then ui_banner; else echo "Electron: установка"; echo; fi
}

# ── Проверка сервера: быстрые проверки до вопросов ──
cores_word() { case $(( $1 % 100 )) in 11|12|13|14) echo "ядер"; return ;; esac; case $(( $1 % 10 )) in 1) echo "ядро" ;; 2|3|4) echo "ядра" ;; *) echo "ядер" ;; esac; }
chk_system() { . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-Linux} · root"; }
chk_resources() {
  local c m
  c=$(nproc 2>/dev/null || echo 1); m=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null); m=${m:-0}
  echo "$c $(cores_word "$c") · $(( (m + 524288) / 1048576 )) ГБ памяти"
  [ "$m" -ge 900000 ] || return 10
}
chk_disk() {
  local kb; kb=$(df -Pk "$APP_DIR" 2>/dev/null | awk 'NR == 2 {print $4}'); kb=${kb:-0}
  if [ "$kb" -lt 1048576 ]; then echo "свободно $((kb / 1024)) МБ, нужно не меньше 1 ГБ"; return 1; fi
  echo "свободно $((kb / 1048576)) ГБ"
  [ "$kb" -ge 2097152 ] || return 10
}
chk_net() {
  local t=""; command -v timeout >/dev/null 2>&1 && t="timeout 5"
  if $t bash -c 'exec 3<>/dev/tcp/registry.npmjs.org/443' 2>/dev/null; then echo "пакеты и npm доступны"
  else echo "нет связи с registry.npmjs.org"; return 10; fi
}
chk_port() { if port_foreign "$PORT"; then echo "занят, выберите другой"; return 10; fi; echo "свободен"; }
CS=(); CV=()
check_row() {
  local i=$1 f=${2:-0}
  case "${CS[$i]}" in
    ok)   ui_kv "$C_D" "$I_OK" "$C_G" "${CHK_NAMES[$i]}" "$C_0" "" "${CV[$i]}" "$C_D" ;;
    warn) ui_kv "$C_D" "$I_WARN" "$C_Y" "${CHK_NAMES[$i]}" "$C_0" "" "${CV[$i]}" "$C_Y" ;;
    err)  ui_kv "$C_D" "$I_ERR" "$C_R" "${CHK_NAMES[$i]}" "$C_W" "" "${CV[$i]}" "$C_R" ;;
    run)  ui_kv "$C_D" "${SPIN[$((f % ${#SPIN[@]}))]}" "$C_C" "${CHK_NAMES[$i]}" "$C_W" "" "" "$C_D" ;;
    *)    ui_kv "$C_D" "·" "$C_D" "${CHK_NAMES[$i]}" "$C_D" "" "" "$C_D" ;;
  esac
}
run_checks() {
  local n=${#CHK_NAMES[@]} i f pid rc fatal=0
  for ((i = 0; i < n; i++)); do CS[$i]=pend; CV[$i]=""; done
  if [ "$UI_BOX" = 1 ]; then
    printf '\033[?25l'; BOX_H=$((n + 4))
    ui_top "$C_D" "Проверка сервера"; echo; ui_blank "$C_D"; echo
    for ((i = 0; i < n; i++)); do check_row "$i"; echo; done
    ui_blank "$C_D"; echo; ui_bot "$C_D"; echo
  fi
  for ((i = 0; i < n; i++)); do
    CS[$i]=run
    ( "${CHK_FUNCS[$i]}" ) > "$STATE_DIR/chk.$i" 2>/dev/null &
    pid=$!; f=0
    if [ "$UI_BOX" = 1 ]; then
      while true; do
        redraw $((i + 2)) check_row "$i" "$f"; f=$((f + 1)); sleep 0.07
        [ "$f" -ge 4 ] && ! kill -0 "$pid" 2>/dev/null && break
      done
    fi
    wait "$pid"; rc=$?
    CV[$i]="$(head -n 1 "$STATE_DIR/chk.$i")"
    case $rc in 0) CS[$i]=ok ;; 10) CS[$i]=warn ;; *) CS[$i]=err; fatal=1 ;; esac
    if [ "$UI_BOX" = 1 ]; then redraw $((i + 2)) check_row "$i"
    else printf '%s %s  %s\n' "$([ "${CS[$i]}" = ok ] && echo "$I_OK" || { [ "${CS[$i]}" = warn ] && echo "$I_WARN" || echo "$I_ERR"; })" "${CHK_NAMES[$i]}" "${CV[$i]}"; fi
  done
  [ "$UI_BOX" = 1 ] && printf '\033[?25h'
  if [ "$fatal" = 1 ]; then
    echo; echo "${C_R}${I_ERR} Установка невозможна: исправьте отмеченное красным и запустите скрипт снова${C_0}"; exit 1
  fi
}

# ── Параметры: ответы собираются в рамку ──
params_draw() {
  local p n=${#PARAMS[@]}
  ui_top "$C_D" "Параметры"; echo; ui_blank "$C_D"; echo
  for p in "${PARAMS[@]}"; do ui_kv "$C_D" "$I_OK" "$C_G" "${p%%|*}" "$C_0" "" "${p#*|}" "$C_W"; echo; done
  ui_blank "$C_D"; echo; ui_bot "$C_D"; echo; echo
  PB_H=$((n + 5))
}
# Убрать с экрана карточку вопроса и рамку «Параметры» (они идут друг под другом)
ui_erase() { local up=$(( PB_H + CARD_H )); [ "$up" -gt 0 ] && printf '\033[%dA\r\033[J' "$up"; PB_H=0; CARD_H=0; }
params_add() {
  if [ "$UI_BOX" = 1 ] && [ "$PB_LIVE" = 1 ]; then ui_erase; fi
  PARAMS+=("$1|$2")
  if [ "$UI_BOX" = 1 ]; then [ "$PB_LIVE" = 1 ] && params_draw
  else printf '%s  %s%s%s\n' "$1" "$C_G" "$2" "$C_0"; fi
}

# ── Вопросы карточками ──
read_key() {   # → KEY: up, down, enter, back или сам символ
  local k rest
  IFS= read -rsn1 k || { KEY=enter; return; }
  if [ "$k" = $'\033' ]; then
    read -rsn2 -t 0.1 rest
    case "$rest" in '[A') KEY=up ;; '[B') KEY=down ;; *) KEY=other ;; esac
  elif [ -z "$k" ]; then KEY=enter
  elif [ "$k" = $'\177' ] || [ "$k" = $'\b' ]; then KEY=back
  else KEY="$k"; fi
}
card_title() { if [ "$Q_TOTAL" -gt 1 ]; then echo "$Q_NO из $Q_TOTAL · $1"; else echo "$1"; fi; }
CARD_NAMES=(); CARD_DESC=()
card_choice() {   # выбранный пункт; рисует карточку целиком
  local sel=$1 i nm ds hint=" ↑↓ выбрать · Enter подтвердить"
  ui_top "$C_C" "$CARD_TITLE"; echo; ui_blank "$C_C"; echo
  for i in "${!CARD_NAMES[@]}"; do
    nm="${CARD_NAMES[$i]}"; ds="${CARD_DESC[$i]}"
    if [ "$i" = "$sel" ]; then ui_line "$C_C" "$((3 + ${#nm} + 3))" " ${C_C}❯${C_0} ${C_W}${nm}${C_0}  ${C_C}●${C_0}"
    else ui_line "$C_C" "$((3 + ${#nm} + 3))" "   ${nm}  ${C_D}○${C_0}"; fi
    echo
    ds="${ds:0:$((W - 6))}"; ui_line "$C_C" "$((5 + ${#ds}))" "     ${C_D}${ds}${C_0}"; echo
  done
  ui_blank "$C_C"; echo; ui_plain "$C_C" "$C_D" "$hint"; echo; ui_bot "$C_C"; echo
}
# ask_choice «заголовок» «название|описание»… → номер выбранного в REPLY_N (по умолчанию 1)
ask_choice() {
  local title=$1 i n v sel=0 h o bad=0; shift
  n=$#; CARD_NAMES=(); CARD_DESC=()
  for o in "$@"; do CARD_NAMES+=("${o%%|*}"); CARD_DESC+=("${o#*|}"); done
  Q_NO=$((Q_NO + 1))
  if [ "$UI_BOX" != 1 ]; then
    echo "$title"
    for i in "${!CARD_NAMES[@]}"; do echo "  ${C_W}$((i + 1))${C_0}  ${CARD_NAMES[$i]}$([ "$i" = 0 ] && echo " ${C_D}(по умолчанию)${C_0}")"; done
    while true; do
      read -r -p "Выбор [1]: " v || { echo; v=""; }
      v="${v:-1}"; case "$v" in *[!0-9]*|'') v=0 ;; esac
      if [ "$v" -ge 1 ] && [ "$v" -le "$n" ]; then REPLY_N=$v; break; fi
      echo "${C_Y}${I_WARN} Введите число от 1 до $n${C_0}"
    done
    return
  fi
  CARD_TITLE="$(card_title "$title")"; h=$((2 * n + 5))
  printf '\033[?25l'; card_choice "$sel"; CARD_H=$h
  while true; do
    read_key
    case "$KEY" in
      up|k) sel=$(( (sel + n - 1) % n )) ;;
      down|j) sel=$(( (sel + 1) % n )) ;;
      [1-9]) [ "$KEY" -le "$n" ] && sel=$((KEY - 1)) ;;
      enter) break ;;
    esac
    printf '\033[%dA\r' "$h"; card_choice "$sel"
  done
  printf '\033[?25h'; REPLY_N=$((sel + 1))
}

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
  live "обновление пакетов"
  case "$PKG" in
    apt)    apt-get update -q; pm_install curl ca-certificates build-essential python3 ;;
    yum)    pm_install curl ca-certificates gcc gcc-c++ make python3 ;;
    pacman) pacman -Sy --noconfirm; pm_install curl base-devel python ;;
  esac
}
step_node() {
  live "проверка версии"
  if command -v node >/dev/null 2>&1 && node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null; then
    :
  else
    live "установка 20.x"
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
  live "npm install"
  # Нативный модуль собираем локально: у части хостингов GitHub Releases заблокирован или медленный
  npm install --omit=dev --build-from-source
  live "сборка модулей"
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
# Случайный пароль из 8 читаемых знаков (без 0 o 1 l i). Байты от 248 отбрасываем, чтобы буквы выпадали поровну
gen_pass() {
  local a=abcdefghjkmnpqrstuvwxyz23456789 s="" b
  while [ ${#s} -lt 8 ]; do
    for b in $(od -An -N16 -tu1 /dev/urandom); do
      [ "$b" -lt 248 ] && s+="${a:$((b % 31)):1}"
      [ ${#s} -ge 8 ] && break
    done
  done
  printf '%s' "$s"
}
step_start() {
  local i
  live "ожидание порта $PORT"
  # Пароль первого администратора: сервер возьмёт его при создании учётной записи и удалит файл
  if [ "$FRESH" = 1 ] && [ -n "$ADMIN_PASS" ]; then
    mkdir -p "$CONF_DIR"; chmod 700 "$CONF_DIR"
    ( umask 077; printf '%s\n' "$ADMIN_PASS" > "$CONF_DIR/admin.pass" )
  fi
  systemctl restart "$SERVICE_NAME"
  for i in $(seq 1 40); do
    if systemctl is-active --quiet "$SERVICE_NAME" && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      # Порт открыт, а файл на месте: администратор не создавался (в базе уже были пользователи), пароль не действует
      if [ -f "$CONF_DIR/admin.pass" ]; then rm -f "$CONF_DIR/admin.pass"; : > "$STATE_DIR/adminpass.skipped"; fi
      return 0
    fi
    sleep 0.5
  done
  return 1
}
# Строка «Вход» для итогового экрана
login_text() {
  if [ -e "$STATE_DIR/adminpass.skipped" ]; then echo "admin  (пароль не создавался, база не новая)"
  else echo "admin / $ADMIN_PASS  (сменить при входе)"; fi
}

# ═════════════ Запуск шагов ═════════════
step_row() {
  local k=$1 f=${2:-0} tm=""
  [ -n "${TM[$k]}" ] && tm="$(fmt_time "${TM[$k]}")"
  case "${ST[$k]}" in
    ok)   ui_kv "$C_D" "$I_OK" "$C_G" "${NAMES[$k]}" "$C_0" "${SUF[$k]}" "$tm" "$C_D" ;;
    warn) ui_kv "$C_D" "$I_WARN" "$C_Y" "${NAMES[$k]}" "$C_0" "${SUF[$k]}" "$tm" "$C_D" ;;
    err)  ui_kv "$C_D" "$I_ERR" "$C_R" "${NAMES[$k]}" "$C_W" "" "$tm" "$C_R" ;;
    run)  ui_kv "$C_D" "${SPIN[$((f % ${#SPIN[@]}))]}" "$C_C" "${NAMES[$k]}" "$C_W" "${SUF[$k]}" "$tm" "$C_C" ;;
    *)    ui_kv "$C_D" "·" "$C_D" "${NAMES[$k]}" "$C_D" "" "" "$C_D" ;;
  esac
}
# Сколько прошло с начала шагов: м:сс
elapsed_text() { local s=$(( SECONDS - T_STEPS )); printf '%d:%02d' $((s / 60)) $((s % 60)); }
progress_row() { ui_progress "$C_D" "${PCOL:-$C_C}" "$PASS" "$TOTAL" "$(elapsed_text)"; }
steps_draw() {
  local k
  BOX_H=$((TOTAL + 5))
  ui_top "$C_D" "Установка"; echo; ui_blank "$C_D"; echo
  for ((k = 0; k < TOTAL; k++)); do step_row "$k"; echo; done
  ui_blank "$C_D"; echo; progress_row; echo; ui_bot "$C_D"; echo
}
# Подпись текущего шага («npm: …», «установка пакетов»): шаги вызывают live
live() { printf '%s' "$1" > "$STATE_DIR/live.$CUR_K"; }

run_step() {
  local k=$1 pid t0 f=0 rc
  CUR_K=$k
  ST[$k]=run; t0=$(now_ms)
  ( set -e; "${FUNCS[$k]}" ) >> "$LOG" 2>&1 &
  pid=$!
  if [ "$STEP_UI" = 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      [ -s "$STATE_DIR/live.$k" ] && SUF[$k]="$(cat "$STATE_DIR/live.$k")"
      TM[$k]=$(( $(now_ms) - t0 ))
      redraw $((k + 2)) step_row "$k" "$f"
      [ $((f % 10)) = 0 ] && redraw $((TOTAL + 3)) progress_row
      f=$((f + 1)); sleep 0.1
    done
  fi
  wait "$pid"; rc=$?
  TM[$k]=$(( $(now_ms) - t0 ))
  case $rc in 0) ST[$k]=ok ;; 10) ST[$k]=warn ;; *) ST[$k]=err ;; esac
  rm -f "$STATE_DIR/live.$k"; SUF[$k]=""
  [ -s "$STATE_DIR/note.$k" ] && SUF[$k]="$(cat "$STATE_DIR/note.$k")"
  [ "${ST[$k]}" != err ] && PASS=$((PASS + 1))
  if [ "$STEP_UI" = 1 ]; then
    redraw $((k + 2)) step_row "$k"
    redraw $((TOTAL + 3)) progress_row
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
card_port() {   # рисует карточку ввода порта; buf — введённые цифры (задаёт ask_port)
  local val="${buf:-$PORT}" p hint hcol caret in n
  p="$(port_problem "$val")"
  if [ -n "$p" ]; then hint=" $p"; hcol="$C_Y"
  elif [ -z "$buf" ]; then hint=" по умолчанию $PORT · порт свободен"; hcol="$C_D"
  else hint=" порт свободен"; hcol="$C_D"; fi
  if [ -n "$C_REV" ]; then caret="${C_REV} ${C_0}"; else caret="_"; fi
  in=" ${C_D}http://сервер:${C_0}${C_W}${buf}${C_0}${caret}"; n=$((1 + 14 + ${#buf} + 1))
  [ -z "$buf" ] && { in+="${C_D}${PORT}${C_0}"; n=$((n + ${#PORT})); }
  ui_top "$C_C" "$CARD_TITLE"; echo; ui_blank "$C_C"; echo
  ui_line "$C_C" "$n" "$in"; echo
  ui_plain "$C_C" "$hcol" "$hint"; echo
  ui_blank "$C_C"; echo; ui_plain "$C_C" "$C_D" " Enter подтвердить"; echo; ui_bot "$C_C"; echo
}
ask_port() {
  local v p buf="" val h=7
  if [ -n "$PORT_GIVEN" ] || [ ! -t 0 ]; then
    p="$(port_problem "$PORT")"
    if [ -n "$p" ]; then echo "${C_R}$I_ERR $p${C_0}"; exit 1; fi
    params_add "Порт" "$PORT"; return
  fi
  Q_NO=$((Q_NO + 1))
  if [ "$UI_BOX" != 1 ]; then
    while true; do
      read -r -p "Порт сервера [$PORT]: " v || { echo; v=""; }
      v="${v:-$PORT}"; p="$(port_problem "$v")"
      if [ -z "$p" ]; then PORT="$v"; break; fi
      echo "${C_Y}${I_WARN} $p${C_0}"
    done
    params_add "Порт" "$PORT"; return
  fi
  CARD_TITLE="$(card_title "Порт сервера")"
  printf '\033[?25l'; card_port; CARD_H=$h
  while true; do
    read_key
    case "$KEY" in
      enter) val="${buf:-$PORT}"; if [ -z "$(port_problem "$val")" ]; then PORT="$val"; break; fi ;;
      back)  buf="${buf%?}" ;;
      [0-9]) [ ${#buf} -lt 5 ] && buf+="$KEY" ;;
    esac
    printf '\033[%dA\r' "$h"; card_port
  done
  printf '\033[?25h'; params_add "Порт" "$PORT"
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
    MODE=pgonly; params_add "Режим" "только PostgreSQL"; return
  fi

  # Сервер уже стоит: предлагаем только PostgreSQL (если он ещё не подключён)
  if server_installed && ! pg_connected && [ -z "$want_db" ] && [ "$interactive" = 1 ]; then
    ask_choice "Что сделать" "Обновить установку|заново пройти шаги, данные и настройки сохранятся" "Только установить PostgreSQL|остальное на сервере не трогается"
    if [ "$REPLY_N" = 2 ]; then MODE=pgonly; params_add "Режим" "только PostgreSQL"; return; fi
    params_add "Режим" "обновить установку"
  fi

  # Движок: уже подключённый PostgreSQL сохраняется; для готовой установки на SQLite он остаётся прежним
  if pg_connected; then DB_ENGINE=postgres
  elif [ -n "$want_db" ]; then DB_ENGINE="$want_db"
  elif server_installed; then DB_ENGINE=sqlite
  elif [ "$interactive" = 1 ]; then
    ask_choice "База данных" "SQLite|файл рядом с сервером, без настройки" "PostgreSQL|быстрее на больших базах, копии из админки"
    [ "$REPLY_N" = 2 ] && DB_ENGINE=postgres || DB_ENGINE=sqlite
  else DB_ENGINE=sqlite; fi
  params_add "База данных" "$([ "$DB_ENGINE" = postgres ] && echo PostgreSQL || echo SQLite)"
}

setup_steps() {
  if [ "$MODE" = pgonly ]; then
    NAMES=("PostgreSQL"); FUNCS=(step_postgres_only)
  elif [ "$DB_ENGINE" = postgres ]; then
    NAMES=("Система" "Node.js" "Зависимости" "PostgreSQL" "База данных" "Автозапуск" "Команда electron" "ffmpeg" "Запуск сервера")
    FUNCS=(step_system step_node step_deps step_postgres step_db step_service step_cli step_tools step_start)
  fi
  TOTAL=${#NAMES[@]}
}

# Сколько вопросов будет задано: показываем «1 из 2» в карточке
plan_questions() {
  local a want_db="${DB:-}" pgonly=0
  Q_TOTAL=0
  [ -t 0 ] || return 0
  for a in "$@"; do case "$a" in --postgres-only) pgonly=1 ;; --postgres|--sqlite) want_db=x ;; esac; done
  [ "$pgonly" = 1 ] && return 0
  pg_connected || { [ -z "$want_db" ] && Q_TOTAL=1; }
  [ -z "$PORT_GIVEN" ] && Q_TOTAL=$((Q_TOTAL + 1))
  return 0
}

ip_addr() { local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; echo "${ip:-localhost}"; }

ui_cmd() { ui_line "$1" "$((23 + ${#3}))" "   $2$(spaces $((20 - ${#2})))${C_D}$3${C_0}"; }   # цвет рамки, команда, пояснение

# Итог в зелёной (или жёлтой, если были замечания) рамке
done_box() {
  local bc=$C_G icon="$I_OK" title="Готово" head t ip k w warns=()
  for ((k = 0; k < TOTAL; k++)); do [ -s "$STATE_DIR/warn.$k" ] && warns+=("$(cat "$STATE_DIR/warn.$k")"); done
  head="Сервер запущен"; t="за $(fmt_time $(( (SECONDS - T_STEPS) * 1000 )))"
  if [ "$FINAL" = warn ]; then bc=$C_Y; icon="$I_WARN"; title="Готово с замечаниями"; head="Сервер запущен, но не всё получилось"; t=""; fi
  ip="$(ip_addr)"
  ui_top "$bc" "$title" "$bc"; echo; ui_blank "$bc"; echo
  ui_line "$bc" "$((3 + ${#head} + $([ -n "$t" ] && echo $((3 + ${#t})) || echo 0)))" " ${bc}${icon}${C_0} ${C_W}${head}${C_0}$([ -n "$t" ] && printf '   %s%s%s' "$C_D" "$t" "$C_0")"; echo
  for w in "${warns[@]}"; do ui_plain "$bc" "$C_Y" "   $w"; echo; done
  ui_blank "$bc"; echo
  ui_label "$bc" "Адрес" "http://$ip:$PORT" "$C_C"; echo
  [ "$FRESH" = 1 ] && { ui_label "$bc" "Вход" "$(login_text)" "$C_W"; echo; }
  ui_label "$bc" "Админка" "http://$ip:$PORT/admin" "$C_0"; echo
  ui_blank "$bc"; echo
  ui_plain "$bc" "$C_D" " Дальше"; echo
  ui_cmd "$bc" "electron" "панель управления сервером"; echo
  ui_cmd "$bc" "electron db status" "состояние базы данных"; echo
  if [ "$DB_ENGINE" = postgres ]; then ui_blank "$bc"; echo; ui_plain "$bc" "$C_D" " Данные PostgreSQL: $CONF_DIR/postgres.txt"; echo; fi
  ui_bot "$bc"; echo
}

# Красная рамка с последними строками журнала и подсказкой
fail_box() {
  local k=$1 bc=$C_R l esc; esc="$(printf '\033')"
  echo
  ui_top "$bc" "Шаг «${NAMES[$k]}» не выполнен" "$C_R"; echo; ui_blank "$bc"; echo
  [ -s "$STATE_DIR/pg.err" ] && { ui_plain "$bc" "$C_R" " $(head -n 1 "$STATE_DIR/pg.err")"; echo; }
  while IFS= read -r l; do
    l="${l//$'\r'/}"; l="${l//$'\t'/ }"; l="$(printf '%s' "$l" | sed "s/${esc}\[[0-9;?]*[A-Za-z]//g")"
    [ -n "$l" ] && { ui_plain "$bc" "$C_D" " $l"; echo; }
  done < <(tail -n 4 "$LOG" 2>/dev/null)
  ui_blank "$bc"; echo
  ui_plain "$bc" "$C_Y" " Что сделать"; echo
  ui_plain "$bc" "$C_0" " · проверьте интернет и свободное место на диске"; echo
  ui_plain "$bc" "$C_0" " · запустите установку ещё раз, шаги можно повторять"; echo
  ui_plain "$bc" "$C_D" " Полный журнал: $LOG"; echo
  ui_bot "$bc"; echo
}

# Данные подключения для формы в админке
print_pg_summary() {
  if [ "$UI_BOX" != 1 ]; then
    echo
    echo "${C_G}${I_OK} PostgreSQL установлен и настроен${C_0}"
    echo "  Данные для подключения (админка → Настройки → База данных)"
    printf '    %-13s %s\n' "Адрес" "$(pg_field host)" "Порт" "$(pg_field port)" "База" "$(pg_field database)" "Пользователь" "$(pg_field user)" "Пароль" "$(pg_field password)"
    echo "  Они же сохранены в $CONF_DIR/postgres.txt (доступ только у root)."
    echo "  Дальше: «Проверить соединение» и «Перенести» в админке. Сервер продолжает работать на SQLite."
    return
  fi
  local bc=$C_G
  echo
  ui_top "$bc" "PostgreSQL установлен" "$C_G"; echo; ui_blank "$bc"; echo
  ui_plain "$bc" "$C_0" " Данные для подключения"; echo
  ui_plain "$bc" "$C_D" " админка → Настройки → База данных"; echo
  ui_blank "$bc"; echo
  ui_label "$bc" "Адрес" "$(pg_field host)" "$C_0"; echo
  ui_label "$bc" "Порт" "$(pg_field port)" "$C_0"; echo
  ui_label "$bc" "База" "$(pg_field database)" "$C_0"; echo
  ui_label "$bc" "Пользователь" "$(pg_field user)" "$C_0"; echo
  ui_label "$bc" "Пароль" "$(pg_field password)" "$C_W"; echo
  ui_blank "$bc"; echo
  ui_plain "$bc" "$C_D" " Сохранены в $CONF_DIR/postgres.txt (только root)"; echo
  ui_plain "$bc" "$C_D" " Дальше: «Проверить» и «Перенести» в админке."; echo
  ui_plain "$bc" "$C_D" " Сервер пока работает на SQLite."; echo
  ui_bot "$bc"; echo
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

  server_installed || FRESH=1
  [ "$FRESH" = 1 ] && ADMIN_PASS="$(gen_pass)"

  # ── Экран 1: проверка сервера ──
  ui_screen
  CHK_NAMES=("Система" "Ресурсы" "Диск" "Интернет" "Порт $PORT")
  CHK_FUNCS=(chk_system chk_resources chk_disk chk_net chk_port)
  run_checks
  [ "$UI_BOX" = 1 ] && sleep 0.9

  # ── Экран 2: вопросы ──
  plan_questions "$@"
  if [ "$UI_BOX" = 1 ] && [ "$Q_TOTAL" -gt 0 ]; then ui_screen; PB_LIVE=1; else echo; fi
  choose_mode "$@"
  [ "$MODE" = pgonly ] || ask_port
  setup_steps

  # ── Экран 3: установка ──
  local k p lines need failed=-1
  for ((k = 0; k < TOTAL; k++)); do ST[$k]=pend; TM[$k]=""; SUF[$k]=""; done
  FINAL=run; PCOL="$C_C"
  STEP_UI=0
  if [ "$UI_BOX" = 1 ]; then
    term_dim; lines=$TERM_ROWS
    need=$(( 5 + ${#PARAMS[@]} + 5 + TOTAL + 5 + 1 ))
    if [ "$lines" -ge "$need" ]; then ui_screen; params_draw; STEP_UI=1
    elif [ "$lines" -ge $(( TOTAL + 7 )) ]; then printf '\033[2J\033[H'; STEP_UI=1
    else for p in "${PARAMS[@]}"; do printf '%s  %s\n' "${p%%|*}" "${p#*|}"; done; echo; fi
  else echo; fi
  T_STEPS=$SECONDS
  [ "$STEP_UI" = 1 ] && { printf '\033[?25l'; steps_draw; }

  for ((k = 0; k < TOTAL; k++)); do
    run_step "$k" || { failed=$k; break; }
  done

  local warn=0
  for ((k = 0; k < TOTAL; k++)); do [ "${ST[$k]}" = warn ] && warn=1; done
  if [ "$failed" -ge 0 ]; then FINAL=err; PCOL="$C_R"; elif [ "$warn" = 1 ]; then FINAL=warn; PCOL="$C_Y"; else FINAL=ok; PCOL="$C_G"; fi
  if [ "$STEP_UI" = 1 ]; then redraw $((TOTAL + 3)) progress_row; printf '\033[?25h'; fi

  if [ "$failed" -ge 0 ]; then
    if [ "$UI_BOX" = 1 ]; then fail_box "$failed"
    else
      echo; echo "${C_R}${I_ERR} Не удалось выполнить шаг «${NAMES[$failed]}»${C_0}"
      [ -s "$STATE_DIR/pg.err" ] && echo "  ${C_R}$(cat "$STATE_DIR/pg.err")${C_0}"
      tail -n 6 "$LOG" 2>/dev/null | sed "s/^/  ${C_D}/; s/\$/${C_0}/"
      echo "  ${C_D}Полный журнал: $LOG${C_0}"
    fi
    exit 1
  fi
  if [ "$MODE" = pgonly ]; then print_pg_summary; return; fi

  if [ "$UI_BOX" = 1 ]; then ui_screen; done_box; return; fi
  local ip; ip="$(ip_addr)"
  for ((k = 0; k < TOTAL; k++)); do [ -s "$STATE_DIR/warn.$k" ] && echo "${C_Y}${I_WARN} $(cat "$STATE_DIR/warn.$k")${C_0}"; done
  echo
  if [ "$FINAL" = warn ]; then echo "${C_Y}${I_WARN} Сервер запущен, но не всё получилось${C_0}"
  else echo "${C_G}${I_OK} Сервер запущен${C_0} ${C_D}за $(fmt_time $(( (SECONDS - T_STEPS) * 1000 )))${C_0}"; fi
  echo "  http://$ip:$PORT"
  [ "$FRESH" = 1 ] && echo "  Вход: $(login_text)"
  echo "  electron — панель управления"
}

# При подключении файла (source) только определяем функции; запуск — когда скрипт вызван напрямую
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
