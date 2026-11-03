#!/usr/bin/env bash
# Установка сервера звонков LiveKit на этом сервере. Админка запускает его по SSH на чистой машине; вручную тоже можно.
# Повторный запуск безопасен: что уже сделано, пропускается, ключи остаются прежними.
#
#   bash livekit-setup.sh lan                       локальная сеть: ws://IP:7880, без сертификата (годится для клиента Electron)
#   bash livekit-setup.sh public example.com        публичный сервер: Caddy выпускает сертификат, адрес wss://example.com
#   bash livekit-setup.sh public example.com internal   то же, но сертификат от внутреннего центра Caddy (самоподписанный)
#   bash livekit-setup.sh proxy calls.example.com        за обратным прокси: сертификат и wss:// ведёт ваш прокси (nginx и т. п.),
#                                                        LiveKit слушает 0.0.0.0:7880 для него; Caddy не ставится
#   bash livekit-setup.sh proxy calls.example.com local  то же, но прокси стоит на этом же сервере: LiveKit слушает только 127.0.0.1
#
# Для публичного режима домен должен уже указывать на этот сервер, а порты 80 и 443 быть открыты снаружи.
# Для режима proxy домен ведёт на ваш прокси, а снаружи на этот сервер нужно пробросить 7881/tcp и 7882/udp (звук и видео идут мимо прокси).
#
# Что делает:
#   1. проверяет систему (root, systemd, apt, архитектура, место на диске);
#   2. ставит нужные пакеты;
#   3. скачивает LiveKit с GitHub и кладёт в /usr/local/bin;
#   4. создаёт ключ и секрет (/etc/livekit/livekit.yaml, копия в /etc/livekit/key.txt, права 600) и службу livekit;
#   5. в публичном режиме ставит Caddy, дожидается сертификата и включает встроенный TURN (5349/tcp по TLS и 3478/udp): он
#      нужен тем, у кого заблокирован прямой UDP; в режиме proxy включается TURN по UDP;
#   6. открывает порты в ufw, если он включён, и проверяет, что LiveKit отвечает.
#
# Вывод для программы (админка читает его построчно):
#   @ПРОЦЕНТ|ЭТАП|текст     ход: ЭТАП — номер от 1 до 7
#   @RESULT|{json}          итог: url, key, secret, public, domain
#   @ERROR|текст            причина остановки
# Всё остальное — подробности для журнала.

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

MODE="${1:-lan}"
DOMAIN="${2:-}"
TLS="${3:-}"
CONF_DIR=/etc/livekit
YAML="$CONF_DIR/livekit.yaml"
KEY_FILE="$CONF_DIR/key.txt"
FALLBACK_VER="1.13.11"
LOG_TMP="$(mktemp)"
trap 'rm -f "$LOG_TMP" /tmp/livekit.tgz' EXIT

step() { echo "@$1|$2|$3"; }
fail() { echo "@ERROR|$1"; [ -s "$LOG_TMP" ] && { echo "  --- последние строки журнала ---"; tail -n 10 "$LOG_TMP" | sed 's/^/  /'; }; exit 1; }
log()  { echo "  $*"; }
run()  { "$@" >>"$LOG_TMP" 2>&1; }

# Одна установка за раз
if command -v flock >/dev/null 2>&1; then
  exec 9>/var/lock/livekit-setup.lock 2>/dev/null && { flock -n 9 || fail "Установка LiveKit уже идёт"; }
fi

# ── 1. Проверка системы ─────────────────────────────────────────────────────
step 3 1 "Проверка системы"
[ "$(id -u)" = 0 ] || fail "Нужны права root: подключайтесь под пользователем root"
command -v systemctl >/dev/null 2>&1 || fail "Не найден systemd: автоматическая установка работает только на системах с systemd"
command -v apt-get   >/dev/null 2>&1 || fail "Не найден apt-get: автоматическая установка поддерживает Debian и Ubuntu"
case "$MODE" in lan|public|proxy) ;; *) fail "Неизвестный режим «$MODE»: нужен lan, public или proxy" ;; esac
if [ "$MODE" = public ] || [ "$MODE" = proxy ]; then
  echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' || fail "Для публичного сервера нужен домен вида calls.example.com"
fi
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) fail "Архитектура $(uname -m) не поддерживается (нужна x86_64 или arm64)" ;;
esac
FREE_MB=$(df -Pm /usr 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "${FREE_MB:-}" ] && [ "$FREE_MB" -lt 300 ]; then fail "На диске слишком мало места (свободно ${FREE_MB} МБ, нужно хотя бы 300 МБ)"; fi
log "Система: $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-неизвестна}"), $ARCH"

# ── 2. Пакеты ───────────────────────────────────────────────────────────────
step 12 2 "Установка пакетов"
run apt-get update -y || log "apt-get update завершился с ошибкой, продолжаю с тем, что есть"
run apt-get install -y ca-certificates wget tar openssl iproute2 || fail "Не удалось установить пакеты (ca-certificates, wget, tar, openssl)"

# ── 3. LiveKit ──────────────────────────────────────────────────────────────
step 25 3 "Загрузка LiveKit"
VER="$(wget -qO- -T 15 -t 2 https://api.github.com/repos/livekit/livekit/releases/latest 2>>"$LOG_TMP" | grep -m1 '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')"
[ -n "$VER" ] || { VER="$FALLBACK_VER"; log "Последнюю версию узнать не удалось, ставлю $VER"; }
if command -v livekit-server >/dev/null 2>&1 && livekit-server --version 2>/dev/null | grep -q "$VER"; then
  log "LiveKit $VER уже установлен"
else
  URL="https://github.com/livekit/livekit/releases/download/v${VER}/livekit_${VER}_linux_${ARCH}.tar.gz"
  log "Скачиваю $URL"
  run wget -q -T 60 -t 3 -O /tmp/livekit.tgz "$URL" || fail "Не удалось скачать LiveKit: у сервера должен быть выход в интернет (github.com)"
  run tar xzf /tmp/livekit.tgz -C /tmp livekit-server || fail "Скачанный архив LiveKit повреждён"
  install -m 755 /tmp/livekit-server /usr/local/bin/livekit-server && rm -f /tmp/livekit-server || fail "Не удалось установить livekit-server"
  log "LiveKit $VER установлен"
fi

# ── 4. Ключи, настройка и служба ────────────────────────────────────────────
step 40 4 "Настройка и ключи"
mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
KEY=""; SEC=""
if [ -f "$YAML" ]; then
  KEY="$(awk '/^keys:/{f=1;next} f&&NF{sub(":","",$1); print $1; exit}' "$YAML")"
  SEC="$(awk '/^keys:/{f=1;next} f&&NF{print $2; exit}' "$YAML")"
  [ -n "$KEY" ] && [ -n "$SEC" ] && log "Ключи уже есть, оставляю прежние"
fi
if [ -z "$KEY" ] || [ -z "$SEC" ]; then
  GEN="$(livekit-server generate-keys 2>&1)"
  KEY="$(echo "$GEN" | awk '/API Key/{print $3}')"
  SEC="$(echo "$GEN" | awk '/API Secret/{print $3}')"
  [ -n "$KEY" ] && [ -n "$SEC" ] || fail "LiveKit не создал ключи"
fi

IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
[ -n "$IP" ] || IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || fail "Не удалось определить адрес сервера в сети"

# Кто достучится до сигнального порта 7880: в локальной сети и за внешним прокси — все, у Caddy на этом же сервере — только он
if [ "$MODE" = lan ]; then
  BIND='"0.0.0.0"'; RTC_IP="  use_external_ip: false
  node_ip: $IP"
elif [ "$MODE" = proxy ]; then
  if [ "$TLS" = local ]; then BIND='"127.0.0.1"'; else BIND='"0.0.0.0"'; fi
  RTC_IP="  use_external_ip: true"
else
  BIND='"127.0.0.1"'; RTC_IP="  use_external_ip: true"
fi
umask 077
cat > "$YAML" <<EOF
port: 7880
bind_addresses: [$BIND]
rtc:
  tcp_port: 7881
  udp_port: 7882
$RTC_IP
keys:
  $KEY: $SEC
logging:
  level: info
EOF
printf '%s\n%s\n' "$KEY" "$SEC" > "$KEY_FILE"
umask 022
cat > /etc/systemd/system/livekit.service <<EOF
[Unit]
Description=LiveKit server
After=network.target

[Service]
ExecStart=/usr/local/bin/livekit-server --config $YAML
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# ── 5. Служба ───────────────────────────────────────────────────────────────
step 55 5 "Запуск службы"
run systemctl daemon-reload
run systemctl enable livekit || fail "Не удалось включить службу livekit"
run systemctl restart livekit || fail "Не удалось запустить службу livekit"
for _ in $(seq 1 20); do wget -qO- -T 2 -t 1 http://127.0.0.1:7880/ >/dev/null 2>&1 && break; sleep 1; done
wget -qO- -T 2 -t 1 http://127.0.0.1:7880/ >/dev/null 2>&1 || { journalctl -u livekit -n 8 --no-pager >>"$LOG_TMP" 2>&1; fail "LiveKit запущен, но не отвечает на порту 7880"; }

# ── 6. Сертификат (Caddy) ───────────────────────────────────────────────────
if [ "$MODE" = public ]; then
  step 68 6 "Сертификат (Caddy)"
  # Если 80 и 443 уже заняты чужой программой (обычно это обратный прокси), Caddy им не пользоваться
  BUSY="$(ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $4 " " $6}' | grep -v caddy | head -1)"
  [ -z "$BUSY" ] || fail "Порты 80 и 443 уже заняты ($BUSY): на этом сервере работает обратный прокси. Выберите тип «За обратным прокси»: сертификат останется на нём"
  if ! command -v caddy >/dev/null 2>&1; then
    run apt-get install -y caddy || {
      # В репозиториях системы Caddy нет: подключаем официальный
      run apt-get install -y gnupg apt-transport-https debian-archive-keyring
      wget -qO- -T 30 https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>>"$LOG_TMP"
      wget -qO- -T 30 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt 2>>"$LOG_TMP" | sed 's#^deb #deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] #' > /etc/apt/sources.list.d/caddy-stable.list
      run apt-get update -y
      run apt-get install -y caddy || fail "Не удалось установить Caddy"
    }
  fi
  {
    echo "$DOMAIN {"
    [ "$TLS" = internal ] && echo "	tls internal"
    echo "	reverse_proxy 127.0.0.1:7880"
    echo "}"
  } > /etc/caddy/Caddyfile
  run systemctl enable caddy
  run systemctl restart caddy || fail "Не удалось запустить Caddy"
  log "Жду сертификат для $DOMAIN (до двух минут)"
  OK=0
  for _ in $(seq 1 60); do
    ISS="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null)"
    if [ -n "$ISS" ]; then
      if [ "$TLS" = internal ]; then echo "$ISS" | grep -qi "caddy" && OK=1
      else echo "$ISS" | grep -qi "caddy" || OK=1; fi
    fi
    [ "$OK" = 1 ] && break
    sleep 2
  done
  if [ "$OK" != 1 ]; then
    journalctl -u caddy -n 8 --no-pager >>"$LOG_TMP" 2>&1
    fail "Сертификат для $DOMAIN не выпущен. Проверьте, что домен указывает на этот сервер, а порты 80 и 443 открыты снаружи"
  fi
  # TURN по TLS на сертификате Caddy: клиентам за жёстким файрволом остаётся TCP-порт 5349
  CRT="$(find /var/lib/caddy -name "$DOMAIN.crt" 2>/dev/null | head -1)"; KEYF="$(find /var/lib/caddy -name "$DOMAIN.key" 2>/dev/null | head -1)"
  if [ -n "$CRT" ] && [ -n "$KEYF" ]; then
    cat >> "$YAML" <<EOF
turn:
  enabled: true
  domain: $DOMAIN
  tls_port: 5349
  udp_port: 3478
  cert_file: $CRT
  key_file: $KEYF
EOF
    # Сертификат Caddy обновляется сам, а LiveKit читает его только при запуске: раз в сутки сверяем отпечаток файла
    # и перезапускаем службу, только если сертификат поменялся (примерно раз в два месяца), чтобы не обрывать звонки зря
    cat > /usr/local/bin/livekit-cert-check <<'EOS'
#!/bin/sh
CRT="$1"; H="$(sha256sum "$CRT" | cut -d' ' -f1)"; F=/var/lib/livekit-cert.sha256
[ "$H" = "$(cat "$F" 2>/dev/null)" ] && exit 0
echo "$H" > "$F"; systemctl restart livekit
EOS
    chmod 755 /usr/local/bin/livekit-cert-check
    sha256sum "$CRT" | cut -d' ' -f1 > /var/lib/livekit-cert.sha256
    cat > /etc/systemd/system/livekit-renew.service <<EOF
[Unit]
Description=Restart LiveKit when its certificate was renewed
[Service]
Type=oneshot
ExecStart=/usr/local/bin/livekit-cert-check $CRT
EOF
    cat > /etc/systemd/system/livekit-renew.timer <<EOF
[Unit]
Description=Daily LiveKit certificate check
[Timer]
OnCalendar=*-*-* 04:00
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
EOF
    run systemctl daemon-reload; run systemctl enable --now livekit-renew.timer
    run systemctl restart livekit || fail "LiveKit не запустился с TURN"
    for _ in $(seq 1 20); do wget -qO- -T 2 -t 1 http://127.0.0.1:7880/ >/dev/null 2>&1 && break; sleep 1; done
    log "TURN включён: 5349/tcp (TLS) и 3478/udp"
  else
    log "Файлы сертификата Caddy не найдены: TURN по TLS не включён"
  fi
elif [ "$MODE" = proxy ]; then
  step 68 6 "Сертификат ведёт ваш прокси"
  # За прокси сертификата на этой машине нет: TURN только по UDP
  printf 'turn:\n  enabled: true\n  udp_port: 3478\n' >> "$YAML"
  run systemctl restart livekit || fail "LiveKit не запустился с TURN"
  for _ in $(seq 1 20); do wget -qO- -T 2 -t 1 http://127.0.0.1:7880/ >/dev/null 2>&1 && break; sleep 1; done
  log "Настройте у прокси домен $DOMAIN: проксирование на http://$([ "$TLS" = local ] && echo 127.0.0.1 || echo "$IP"):7880 с поддержкой WebSocket"
else
  step 68 6 "Сертификат не нужен (локальная сеть)"
fi

# ── 7. Порты и проверка ─────────────────────────────────────────────────────
step 85 7 "Порты и проверка"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  if [ "$MODE" = public ]; then PORTS="80/tcp 443/tcp 5349/tcp 3478/udp 7881/tcp 7882/udp"; elif [ "$MODE" = proxy ]; then PORTS="$([ "$TLS" = local ] || echo '7880/tcp ')3478/udp 7881/tcp 7882/udp"; else PORTS="7880/tcp 7881/tcp 7882/udp"; fi
  for p in $PORTS; do run ufw allow "$p"; done
  log "В ufw открыты порты: $PORTS"
else
  log "ufw не включён: порты не менялись. Нужны снаружи: $( [ "$MODE" = public ] && echo '80/tcp, 443/tcp, 5349/tcp, 3478/udp, 7881/tcp, 7882/udp' || { [ "$MODE" = proxy ] && echo '3478/udp, 7881/tcp, 7882/udp (и 7880/tcp для прокси, если он на другой машине)' || echo '7880/tcp, 7881/tcp, 7882/udp'; } )"
fi
wget -qO- -T 3 -t 1 http://127.0.0.1:7880/ >/dev/null 2>&1 || fail "LiveKit перестал отвечать после настройки"

PROXY=false; LOCAL=false
if [ "$MODE" = public ]; then URL="wss://$DOMAIN"; PUB=true
elif [ "$MODE" = proxy ]; then URL="wss://$DOMAIN"; PUB=true; PROXY=true; [ "$TLS" = local ] && LOCAL=true
else URL="ws://$IP:7880"; PUB=false; DOMAIN=""; fi
echo "@RESULT|{\"url\":\"$URL\",\"key\":\"$KEY\",\"secret\":\"$SEC\",\"public\":$PUB,\"proxy\":$PROXY,\"local\":$LOCAL,\"domain\":\"$DOMAIN\",\"ip\":\"$IP\"}"
step 100 7 "Готово"
