#!/bin/bash
# Управление дополнительными парами ключей LiveKit. Ставится на сервер LiveKit из админки («Настройки → Звонки → Доступ для других
# серверов») и запускается по SSH только ограниченным ключом: в authorized_keys он записан как restrict,command="/usr/local/sbin/livekit-keys",
# поэтому ни оболочки, ни других команд у этого ключа нет. Команды: ping | list | add <ключ> <секрет> | del <ключ>.
# Пары, созданные админкой, перечислены в /etc/livekit/extra-keys.txt: удалить можно только их, основную пару скрипт не трогает.
# Ответ — одна строка: OK|... или ERR|причина.
set -u
set -f
YAML=/etc/livekit/livekit.yaml
LIST=/etc/livekit/extra-keys.txt
cmd="${SSH_ORIGINAL_COMMAND:-$*}"
set -- $cmd
act="${1:-}"; key="${2:-}"; sec="${3:-}"
fail() { echo "ERR|$1"; exit 1; }
[ -f "$YAML" ] || fail "Не найден $YAML"
[ -f "$LIST" ] || { umask 077; : > "$LIST"; }

restart_lk() {
  systemctl restart livekit || return 1
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 1; systemctl is-active --quiet livekit && return 0; done
  return 1
}
drop_listed() { grep -vx "$1" "$LIST" > "$LIST.new"; cat "$LIST.new" > "$LIST"; rm -f "$LIST.new"; }
valid_key() { [[ "$1" =~ ^API[A-Za-z0-9]{6,40}$ ]]; }

case "$act" in
  ping) echo "OK|pong" ;;
  list) echo "OK|$(tr '\n' ' ' < "$LIST")" ;;
  add)
    valid_key "$key" || fail "Некорректный ключ"
    [[ "$sec" =~ ^[A-Za-z0-9]{24,80}$ ]] || fail "Некорректный секрет"
    grep -q "^  $key:" "$YAML" && fail "Такой ключ уже есть"
    grep -q '^keys:' "$YAML" || fail "В конфиге LiveKit нет раздела keys"
    cp -p "$YAML" "$YAML.bak"
    awk -v k="$key" -v s="$sec" '{print} /^keys:/{print "  " k ": " s}' "$YAML.bak" > "$YAML.new" && cat "$YAML.new" > "$YAML"
    rm -f "$YAML.new"
    echo "$key" >> "$LIST"
    if restart_lk; then echo "OK|added"
    else
      cat "$YAML.bak" > "$YAML"; drop_listed "$key"; restart_lk
      fail "LiveKit не запустился с новой парой, конфиг восстановлен"
    fi ;;
  del)
    valid_key "$key" || fail "Некорректный ключ"
    grep -qx "$key" "$LIST" || fail "Этой пары нет среди созданных админкой"
    cp -p "$YAML" "$YAML.bak"
    grep -v "^  $key:" "$YAML.bak" > "$YAML.new" && cat "$YAML.new" > "$YAML"
    rm -f "$YAML.new"
    drop_listed "$key"
    if restart_lk; then echo "OK|deleted"
    else
      cat "$YAML.bak" > "$YAML"; echo "$key" >> "$LIST"; restart_lk
      fail "LiveKit не запустился без этой пары, конфиг восстановлен"
    fi ;;
  *) fail "Неизвестная команда" ;;
esac
