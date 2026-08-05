#!/bin/bash
set -e

echo "╔══════════════════════════════════════════╗"
echo "║        Electron — установка              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Проверка root ──
if [ "$EUID" -ne 0 ]; then
  echo "✗ Запусти скрипт от root: sudo bash install.sh"
  exit 1
fi

# ── Параметры ──
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"
SERVICE_NAME="electron"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DB_DIR="${DB_DIR:-$APP_DIR/../chat_db}"

# ── Определение дистрибутива ──
if [ -f /etc/debian_version ]; then
  PKG="apt"
elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
  PKG="yum"
elif [ -f /etc/arch-release ]; then
  PKG="pacman"
else
  echo "✗ Неизвестный дистрибутив. Установи Node.js 20+ вручную."
  exit 1
fi

echo "→ Дистрибутив: $PKG | Архитектура: $(uname -m)"

# ── Проверка и установка sudo ──
if ! command -v sudo &>/dev/null; then
  echo "→ sudo не найден, устанавливаю..."
  case "$PKG" in
    apt)    apt-get update -q && apt-get install -y sudo ;;
    yum)    yum install -y sudo ;;
    pacman) pacman -Sy --noconfirm sudo ;;
  esac
  echo "→ sudo установлен"
fi

# ── Установка Node.js ──
install_node_apt() {
  echo "→ Установка Node.js 20..."
  apt-get update -q
  apt-get install -y curl ca-certificates build-essential python3
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_node_yum() {
  echo "→ Установка Node.js 20..."
  yum install -y curl ca-certificates gcc gcc-c++ make python3 2>/dev/null || \
    dnf install -y curl ca-certificates gcc gcc-c++ make python3
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  yum install -y nodejs 2>/dev/null || dnf install -y nodejs
}

install_node_pacman() {
  echo "→ Установка Node.js..."
  pacman -Sy --noconfirm nodejs npm base-devel python
}

if command -v node &>/dev/null; then
  NODE_OK=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
  if [ "$NODE_OK" = "ok" ]; then
    echo "→ Node.js уже установлен: $(node --version)"
  else
    echo "→ Node.js устарел ($(node --version)), обновляем..."
    [ "$PKG" = "apt" ]    && install_node_apt
    [ "$PKG" = "yum" ]    && install_node_yum
    [ "$PKG" = "pacman" ] && install_node_pacman
  fi
else
  [ "$PKG" = "apt" ]    && install_node_apt
  [ "$PKG" = "yum" ]    && install_node_yum
  [ "$PKG" = "pacman" ] && install_node_pacman
fi

echo "→ Node.js: $(node --version) | npm: $(npm --version)"

# ── Инструменты сборки (нужны, чтобы собирать better-sqlite3 из исходников,
#     когда GitHub Releases недоступен и prebuild-install падает по таймауту) ──
if [ "$PKG" = "apt" ]; then
  apt-get install -y build-essential python3 >/dev/null 2>&1 || true
elif [ "$PKG" = "yum" ]; then
  (yum install -y gcc gcc-c++ make python3 >/dev/null 2>&1 || dnf install -y gcc gcc-c++ make python3 >/dev/null 2>&1) || true
fi

# ── Зависимости ──
echo "→ Установка зависимостей..."
cd "$APP_DIR"
# Устойчивые таймауты для медленных/нестабильных сетей
npm config set fetch-timeout 300000
npm config set fetch-retries 5
# --build-from-source: не тянем прекомпилированный бинарник с GitHub Releases
# (у части хостингов GitHub блокирован/медленный — prebuild-install падает по ETIMEDOUT).
# Собираем better-sqlite3 локально через node-gyp.
npm install --omit=dev --build-from-source

# ── Пересборка нативных модулей под текущую архитектуру ──
echo "→ Пересборка нативных модулей (better-sqlite3)..."
npm rebuild better-sqlite3 --build-from-source

# ── Создание папки для БД ──
mkdir -p "$DB_DIR"
echo "→ Папка базы данных: $DB_DIR"

# ── Генерация JWT_SECRET и TURN_SECRET ──
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
echo "→ JWT_SECRET сгенерирован"
TURN_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "→ TURN_SECRET сгенерирован"

# ── Остановка старых служб если есть ──
for OLD in electron corp-chat; do
  if systemctl is-active --quiet "$OLD" 2>/dev/null; then
    echo "→ Остановка старой службы $OLD..."
    systemctl stop "$OLD" 2>/dev/null || true
    systemctl disable "$OLD" 2>/dev/null || true
  fi
  [ -f "/etc/systemd/system/${OLD}.service" ] && rm -f "/etc/systemd/system/${OLD}.service"
done

# ── Systemd сервис ──
echo "→ Настройка автозапуска..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Electron Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(which node) $APP_DIR/src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=JWT_SECRET=$JWT_SECRET
Environment=TURN_SECRET=$TURN_SECRET
Environment=DB_PATH=$DB_DIR/chat.db

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── Установка CLI-команды electron ──
echo "→ Установка команды 'electron'..."
chmod +x "$APP_DIR/electron"
ln -sf "$APP_DIR/electron" /usr/local/bin/electron

# Установка sqlite3 для статистики БД в панели
if [ "$PKG" = "apt" ]; then
  apt-get install -y sqlite3 -q 2>/dev/null || true
elif [ "$PKG" = "yum" ]; then
  yum install -y sqlite 2>/dev/null || dnf install -y sqlite 2>/dev/null || true
elif [ "$PKG" = "pacman" ]; then
  pacman -Sy --noconfirm sqlite 2>/dev/null || true
fi

# ── Установка и настройка coturn (TURN-сервер для WebRTC-звонков) ──
setup_coturn() {
  echo "→ Установка TURN-сервера (coturn)..."
  local OK=true
  if [ "$PKG" = "apt" ]; then
    apt-get install -y coturn -q >/dev/null 2>&1 || OK=false
  elif [ "$PKG" = "yum" ]; then
    (yum install -y coturn >/dev/null 2>&1 || dnf install -y coturn >/dev/null 2>&1) || OK=false
  elif [ "$PKG" = "pacman" ]; then
    pacman -Sy --noconfirm coturn >/dev/null 2>&1 || OK=false
  fi
  if ! $OK || ! command -v turnserver &>/dev/null; then
    echo "  Предупреждение: coturn недоступен в репозитории, звонки будут недоступны"
    return
  fi

  local PRIVATE_IP PUBLIC_IP
  PRIVATE_IP=$(hostname -I | awk '{print $1}')
  PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || \
              curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null || \
              echo "$PRIVATE_IP")
  PUBLIC_IP=$(echo "$PUBLIC_IP" | tr -d '[:space:]')
  [ -z "$PUBLIC_IP" ] && PUBLIC_IP="$PRIVATE_IP"

  mkdir -p /var/log/coturn
  cat > /etc/turnserver.conf <<TURNEOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$PUBLIC_IP
total-quota=100
no-loopback-peers
no-multicast-peers
min-port=49152
max-port=65535
log-file=/var/log/coturn/turnserver.log
TURNEOF

  # Если сервер за NAT — указываем внешний IP явно
  if [ "$PUBLIC_IP" != "$PRIVATE_IP" ]; then
    echo "external-ip=$PUBLIC_IP/$PRIVATE_IP" >> /etc/turnserver.conf
    echo "→ Обнаружен NAT: external-ip=$PUBLIC_IP/$PRIVATE_IP"
  fi

  # Разрешить запуск демона (Debian/Ubuntu)
  [ -f /etc/default/coturn ] && sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

  systemctl enable coturn >/dev/null 2>&1 || true
  systemctl restart coturn >/dev/null 2>&1 || true

  # Открыть порты
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 3478/udp >/dev/null 2>&1 || true
    ufw allow 3478/tcp >/dev/null 2>&1 || true
    ufw allow 49152:65535/udp >/dev/null 2>&1 || true
    echo "→ Порты открыты (ufw)"
  elif command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=3478/udp >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port=3478/tcp >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port=49152-65535/udp >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    echo "→ Порты открыты (firewalld)"
  fi

  # Прописываем публичный IP в systemd-сервис чтобы call.js знал TURN-хост
  sed -i "/Environment=TURN_SECRET/a Environment=TURN_HOST=$PUBLIC_IP" "$SERVICE_FILE"
  systemctl daemon-reload >/dev/null 2>&1 || true

  echo "→ TURN-сервер настроен (${PUBLIC_IP}:3478)"
  echo ""
  echo "┌─────────────────────────────────────────────────────────┐"
  echo "│  ⚠  Для голосовых звонков откройте порты в панели VPS   │"
  echo "│     (Security Groups / Cloud Firewall / Network Rules):  │"
  echo "│                                                          │"
  echo "│     3478  TCP + UDP   — TURN signaling                   │"
  echo "│     49152–65535  UDP  — TURN relay (медиатрафик)         │"
  echo "└─────────────────────────────────────────────────────────┘"
}
setup_coturn

# ── Проверка ──
echo ""
echo "→ Ожидание запуска сервера..."
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║           ✓ Сервер запущен!              ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""
  echo "  Адрес:     http://$(hostname -I | awk '{print $1}'):$PORT"
  echo "  База:      $DB_DIR/chat.db"
  echo "  Сервис:    $SERVICE_NAME"
  echo ""
  echo "  Управление:"
  echo "    electron          — панель управления"
  echo "    systemctl status $SERVICE_NAME"
  echo "    journalctl -u $SERVICE_NAME -f"
  echo ""
else
  echo ""
  echo "✗ Сервер не запустился. Смотри логи:"
  echo "  journalctl -u $SERVICE_NAME -n 30 --no-pager"
  exit 1
fi
