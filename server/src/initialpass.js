'use strict';
// ── ПАРОЛЬ ПЕРВОГО АДМИНИСТРАТОРА ──
//
// Раньше на новой базе создавался admin / admin, и пока его не сменят, вход мог открыть кто угодно.
// Теперь пароль случайный: его кладёт установщик в admin.pass (папка настроек, права только у root),
// сервер берёт его при создании администратора и удаляет файл. Если файла нет (ручной запуск,
// разработка), сервер генерирует пароль сам и один раз пишет его в консоль.
// Смена пароля при первом входе требуется в обоих случаях.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Читаемый алфавит: без 0 и o, 1, l и i, которые путаются на глаз
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 8;

function generate() {
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

const filePath = () => path.join(process.env.ELECTRON_CONF_DIR || '/etc/electron', 'admin.pass');

/** Пароль для нового администратора: { password, file, generated }. file — что удалить после создания */
function pick() {
  const file = filePath();
  try {
    const p = fs.readFileSync(file, 'utf8').trim();
    // bcrypt берёт не больше 72 байт; пробелы и управляющие знаки в пароле не нужны
    if (/^[\x21-\x7e]{6,72}$/.test(p)) return { password: p, file, generated: false };
  } catch {}
  return { password: generate(), file: null, generated: true };
}

/** Администратор создан: файл с паролем больше не нужен */
function used(picked) {
  if (picked.file) { try { fs.unlinkSync(picked.file); } catch {} }
  console.log(picked.generated
    ? `Created admin: admin / ${picked.password} (пароль показан один раз, при первом входе потребуется смена)`
    : 'Created admin: admin (пароль задан установщиком, при первом входе потребуется смена)');
}

module.exports = { generate, pick, used, ALPHABET, LENGTH };
