#!/usr/bin/env bash
# Установка и настройка PostgreSQL на этом же сервере для Electron.
# Повторный запуск безопасен: что уже сделано, пропускается, данные подключения выводятся те же.
#
# Что делает:
#   1. проверяет систему и ставит PostgreSQL 14+ (apt / dnf / yum / pacman; при необходимости подключает
#      официальный репозиторий PostgreSQL), запускает службу;
#   2. настраивает доступ только с этой машины, вход по паролю scram-sha-256;
#   3. создаёт роль и пустую базу в UTF-8 с сортировкой C.UTF-8 (так порядок имён в списках не меняется
#      при переходе с SQLite, а русская морфология поиска работает);
#   4. сохраняет данные подключения в /etc/electron/postgres.txt (права 600).
#
# Вывод для программы (админка и установщик читают его построчно):
#   @ПРОЦЕНТ|ЭТАП|текст      ход: ЭТАП — номер от 1 до 7
#   @RESULT|{json}           итог: host, port, database, user, password
#   @ERROR|текст             причина остановки
# Всё остальное — подробности для журнала.
#
# Переменные: ELECTRON_CONF_DIR (по умолчанию /etc/electron), PG_DB и PG_USER (по умолчанию electron).

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

CONF_DIR="${ELECTRON_CONF_DIR:-/etc/electron}"
DB_NAME="${PG_DB:-electron}"
DB_USER="${PG_USER:-electron}"
OUT_FILE="$CONF_DIR/postgres.txt"
MIN_MAJOR=14
PG_PORT=5432
PG_HOST=127.0.0.1
LOG_TMP="$(mktemp)"
trap 'rm -f "$LOG_TMP" "${STATUS_FILE:-}"' EXIT

step() { echo "@$1|$2|$3"; }
fail() { echo "@ERROR|$1"; [ -s "$LOG_TMP" ] && { echo "  --- последние строки журнала ---"; tail -n 12 "$LOG_TMP" | sed 's/^/  /'; }; exit 1; }
log()  { echo "  $*"; }

# Одна установка за раз
if command -v flock >/dev/null 2>&1; then
  exec 9>/var/lock/electron-pg-setup.lock 2>/dev/null && { flock -n 9 || fail "Установка PostgreSQL уже идёт"; }
fi

# ── 1. Проверка системы ─────────────────────────────────────────────────────
step 2 1 "Проверка системы"
[ "$(id -u)" = 0 ] || fail "Нужны права root: сервер Electron должен работать от root, как настраивает установщик"
command -v systemctl >/dev/null 2>&1 || fail "Не найден systemd: автоматическая установка PostgreSQL поддерживается только на системах с systemd"

PM=""
if   command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf     >/dev/null 2>&1; then PM=dnf
elif command -v yum     >/dev/null 2>&1; then PM=yum
elif command -v pacman  >/dev/null 2>&1; then PM=pacman
else fail "Не найден менеджер пакетов (apt, dnf, yum, pacman). Установите PostgreSQL 14+ вручную"; fi
log "Менеджер пакетов: $PM"

FREE_MB=$(df -Pm /var 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "${FREE_MB:-}" ] && [ "$FREE_MB" -lt 600 ]; then fail "На диске слишком мало места (свободно ${FREE_MB} МБ, нужно хотя бы 600 МБ)"; fi

# Запустить команду от имени postgres
as_pg() {
  if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"; else su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; fi
}
psql_admin() { as_pg psql -X -v ON_ERROR_STOP=1 -tA "$@"; }

pg_installed_major() {
  local v
  v=$( (psql --version 2>/dev/null || true) | grep -oE '[0-9]+' | head -1)
  echo "${v:-0}"
}
pg_server_present() {
  command -v psql >/dev/null 2>&1 && { command -v pg_lsclusters >/dev/null 2>&1 || systemctl list-unit-files 2>/dev/null | grep -qE '^postgresql'; }
}

# ── 2. Репозиторий (только если в системе PostgreSQL старше 14) ─────────────
need_install=1
if pg_server_present && [ "$(pg_installed_major)" -ge "$MIN_MAJOR" ]; then
  need_install=0
  step 12 2 "PostgreSQL $(pg_installed_major) уже установлен"
else
  step 6 2 "Подготовка пакетов"
  case "$PM" in
    apt)
      apt-get -o DPkg::Lock::Timeout=120 update -y >>"$LOG_TMP" 2>&1 || log "apt-get update завершился с предупреждением"
      step 10 2 "Проверка версии в репозитории"
      CAND=$(apt-cache policy postgresql 2>/dev/null | awk '/Candidate:/ {print $2}' | grep -oE '^[0-9]+' | head -1)
      if [ -z "${CAND:-}" ] || [ "$CAND" -lt "$MIN_MAJOR" ]; then
        log "В репозитории системы PostgreSQL ${CAND:-нет} — подключаю официальный репозиторий PostgreSQL"
        apt-get -o DPkg::Lock::Timeout=120 install -y curl ca-certificates gnupg >>"$LOG_TMP" 2>&1 || fail "Не удалось поставить curl и gnupg для подключения репозитория"
        # shellcheck disable=SC1091
        . /etc/os-release
        [ -n "${VERSION_CODENAME:-}" ] || fail "Не удалось определить название выпуска системы для репозитория PostgreSQL"
        install -d /usr/share/postgresql-common/pgdg
        curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc >>"$LOG_TMP" 2>&1 \
          || fail "Не удалось скачать ключ репозитория PostgreSQL: проверьте доступ сервера в интернет"
        echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
        apt-get -o DPkg::Lock::Timeout=120 update -y >>"$LOG_TMP" 2>&1 || fail "Не удалось обновить список пакетов с репозиторием PostgreSQL"
      fi ;;
    dnf)
      dnf -y module enable postgresql:16 >>"$LOG_TMP" 2>&1 || dnf -y module enable postgresql:15 >>"$LOG_TMP" 2>&1 || dnf -y module enable postgresql:14 >>"$LOG_TMP" 2>&1 || true ;;
  esac
fi

# ── 3. Установка пакета ─────────────────────────────────────────────────────
if [ "$need_install" = 1 ]; then
  step 14 3 "Установка PostgreSQL"
  case "$PM" in
    apt)
      # Status-Fd отдаёт процент скачивания и установки: переводим в диапазон 14–70
      STATUS_FILE="$(mktemp)"
      apt-get -o DPkg::Lock::Timeout=300 install -y -o APT::Status-Fd=3 postgresql postgresql-contrib 3>"$STATUS_FILE" >>"$LOG_TMP" 2>&1 &
      APT_PID=$!
      lastp=0
      while kill -0 "$APT_PID" 2>/dev/null; do
        line=$(grep -E '^(dlstatus|pmstatus)' "$STATUS_FILE" 2>/dev/null | tail -n 1)
        if [ -n "$line" ]; then
          kind="${line%%:*}"; pct=$(echo "$line" | cut -d: -f3 | cut -d. -f1)
          pct="${pct:-0}"
          if [ "$kind" = dlstatus ]; then p=$((14 + pct * 30 / 100)); txt="Скачивание пакетов"; else p=$((44 + pct * 26 / 100)); txt="Установка пакетов"; fi
          [ "$p" -gt "$lastp" ] && { step "$p" 3 "$txt"; lastp=$p; }
        fi
        sleep 1
      done
      wait "$APT_PID" || fail "Не удалось установить PostgreSQL (apt-get завершился с ошибкой)" ;;
    dnf|yum)
      step 30 3 "Скачивание и установка пакетов"
      "$PM" -y install postgresql-server postgresql >>"$LOG_TMP" 2>&1 || fail "Не удалось установить PostgreSQL"
      if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
        postgresql-setup --initdb >>"$LOG_TMP" 2>&1 || fail "Не удалось создать кластер PostgreSQL" ; fi ;;
    pacman)
      step 30 3 "Скачивание и установка пакетов"
      pacman -S --noconfirm --needed postgresql >>"$LOG_TMP" 2>&1 || fail "Не удалось установить PostgreSQL"
      if [ ! -f /var/lib/postgres/data/PG_VERSION ]; then
        as_pg initdb --locale=C.UTF-8 -E UTF8 -D /var/lib/postgres/data >>"$LOG_TMP" 2>&1 || fail "Не удалось создать кластер PostgreSQL"; fi ;;
  esac
fi

# ── 4. Запуск службы ────────────────────────────────────────────────────────
step 72 4 "Запуск службы PostgreSQL"
systemctl enable --now postgresql >>"$LOG_TMP" 2>&1 || fail "Не удалось запустить службу postgresql"
ready=0
for _ in $(seq 1 40); do
  if psql_admin -c 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || fail "PostgreSQL не отвечает после запуска"
VERNUM=$(psql_admin -c 'show server_version_num' 2>/dev/null)
[ "${VERNUM:-0}" -ge 140000 ] || fail "Установлен PostgreSQL старше 14 (${VERNUM:-?}): нужна версия 14 или новее"
PG_PORT=$(psql_admin -c 'show port' 2>/dev/null || echo 5432)
log "PostgreSQL $VERNUM, порт $PG_PORT"

# ── 5. Доступ только с этой машины ──────────────────────────────────────────
step 80 5 "Настройка доступа"
need_restart=0
LA=$(psql_admin -c 'show listen_addresses')
case "$LA" in localhost|127.0.0.1|"localhost,127.0.0.1"|"127.0.0.1,localhost") ;; *)
  psql_admin -c "ALTER SYSTEM SET listen_addresses = 'localhost'" >/dev/null && need_restart=1 ;;
esac
PE=$(psql_admin -c 'show password_encryption')
[ "$PE" = "scram-sha-256" ] || psql_admin -c "ALTER SYSTEM SET password_encryption = 'scram-sha-256'" >/dev/null
HBA=$(psql_admin -c 'show hba_file')
if [ -f "$HBA" ] && ! grep -q '^# electron:' "$HBA"; then
  tmp="$(mktemp)"
  awk -v db="$DB_NAME" -v us="$DB_USER" '
    !done && $0 !~ /^[[:space:]]*#/ && $0 !~ /^[[:space:]]*$/ {
      print "# electron: доступ приложения только с этого сервера"
      printf "host    %s    %s    127.0.0.1/32    scram-sha-256\n", db, us
      printf "host    %s    %s    ::1/128         scram-sha-256\n", db, us
      done = 1
    }
    { print }' "$HBA" > "$tmp" && cat "$tmp" > "$HBA"
  rm -f "$tmp"
fi
if [ "$need_restart" = 1 ]; then systemctl restart postgresql >>"$LOG_TMP" 2>&1 || fail "Не удалось перезапустить PostgreSQL"
  for _ in $(seq 1 40); do psql_admin -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
else psql_admin -c 'select pg_reload_conf()' >/dev/null 2>&1 || true; fi

# ── 6. Роль и база ──────────────────────────────────────────────────────────
step 88 6 "Создание роли и базы"
# Пароль: прежний, если установка уже делалась и данные сохранены, иначе новый случайный
PW=""
if [ -f "$OUT_FILE" ] && grep -q "^database=$DB_NAME\$" "$OUT_FILE" && grep -q "^user=$DB_USER\$" "$OUT_FILE"; then
  PW=$(grep '^password=' "$OUT_FILE" | head -1 | cut -d= -f2-)
fi
if [ -z "$PW" ]; then
  PW=$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  [ "${#PW}" -ge 16 ] || PW=$(openssl rand -hex 16 2>/dev/null)
  [ "${#PW}" -ge 16 ] || fail "Не удалось получить случайный пароль"
fi
psql_admin >>"$LOG_TMP" 2>&1 <<SQL || fail "Не удалось создать роль $DB_USER"
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$PW';
  ELSE
    ALTER ROLE $DB_USER LOGIN PASSWORD '$PW';
  END IF;
END \$\$;
SQL
if [ "$(psql_admin -c "select 1 from pg_database where datname = '$DB_NAME'")" != "1" ]; then
  created=0
  for loc in C.UTF-8 en_US.UTF-8 ru_RU.UTF-8; do
    if psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE '$loc' LC_CTYPE '$loc'" >>"$LOG_TMP" 2>&1; then created=1; log "База $DB_NAME создана (локаль $loc)"; break; fi
  done
  [ "$created" = 1 ] || fail "Не удалось создать базу: в системе нет UTF-8 локали (C.UTF-8, en_US.UTF-8, ru_RU.UTF-8)"
else
  log "База $DB_NAME уже есть"
fi

# ── 7. Проверка входа по паролю и сохранение данных ─────────────────────────
step 95 7 "Проверка подключения"
CHK=$(PGPASSWORD="$PW" psql -X -h "$PG_HOST" -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "select to_tsvector('russian', 'Привет') <> ''::tsvector" 2>>"$LOG_TMP")
[ "$CHK" = "t" ] || fail "Вход по паролю не прошёл или локаль базы не знает русские буквы (ответ: ${CHK:-нет})"

umask 077
mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
cat > "$OUT_FILE" <<EOF
host=$PG_HOST
port=$PG_PORT
database=$DB_NAME
user=$DB_USER
password=$PW
EOF
chmod 600 "$OUT_FILE"

step 100 7 "Готово"
printf '@RESULT|{"host":"%s","port":%s,"database":"%s","user":"%s","password":"%s"}\n' "$PG_HOST" "$PG_PORT" "$DB_NAME" "$DB_USER" "$PW"
