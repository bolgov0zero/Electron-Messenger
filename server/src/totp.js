// TOTP (RFC 6238) поверх HOTP (RFC 4226) на встроенном crypto — без внешних
// зависимостей. Используется только для входа в админ-панель (см. routes/auth.js).
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '', out = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Секрет — 20 байт (160 бит), стандартная длина для TOTP
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, '0');
}

function totpNow(secretBase32, timeStep = 30, digits = 6) {
  return hotp(secretBase32, Math.floor(Date.now() / 1000 / timeStep), digits);
}

// window=1 — принимаем код из соседнего 30-секундного шага в обе стороны
// (расхождение часов на телефоне — обычное дело)
function verifyTotp(secretBase32, code, window = 1, timeStep = 30, digits = 6) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  for (let i = -window; i <= window; i++) {
    if (hotp(secretBase32, counter + i, digits) === clean) return true;
  }
  return false;
}

function otpauthUrl(secretBase32, accountLabel, issuer = 'Electron Admin') {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

module.exports = { generateSecret, verifyTotp, otpauthUrl };
