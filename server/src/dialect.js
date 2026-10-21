'use strict';
// ── ПЕРЕВОД SQL ИЗ ДИАЛЕКТА SQLITE В POSTGRESQL ──
//
// Запросы в коде написаны на общем подмножестве, близком к SQLite. Всё, что
// у PostgreSQL выглядит иначе, переводится здесь механически, один раз на
// каждую строку запроса (результат кэшируется). Конструкции, которые не
// переводятся механически (поиск, даты, upsert с функцией), в коде пишутся
// отдельно для каждого движка — по dal.pg.
//
// Что переводится:
//   ?                              → $1, $2, …
//   unixepoch()                    → число секунд от эпохи
//   INSERT OR IGNORE               → ON CONFLICT DO NOTHING
//   INSERT OR REPLACE              → ON CONFLICT (ключ) DO UPDATE …
//   a IS NOT b                     → a IS DISTINCT FROM b
//   LIKE                           → ILIKE (в SQLite LIKE не различает регистр)
//   group_concat(x[, sep])         → string_agg(x::text, sep)
//   CAST(… AS INTEGER)             → CAST(… AS BIGINT)
//   rowid                          → ctid (порядок вставки)
//   EXISTS (… json_each(x) …)      → x::jsonb @> to_jsonb(?)
//   ? || …                         → ?::text || … (тип параметра в склейке)
//   INSERT … (без RETURNING)       → RETURNING id, если у таблицы есть id

// Строки в одинарных кавычках прячем, чтобы не трогать их содержимое
function hideLiterals(sql) {
  const lits = [];
  const out = sql.replace(/'(?:[^']|'')*'/g, m => { lits.push(m); return `\u0001${lits.length - 1}\u0001`; });
  return { out, lits };
}
const restore = (s, lits) => s.replace(/\u0001(\d+)\u0001/g, (_, i) => lits[i]);

// Содержимое скобок, открывающихся на позиции i (s[i] === '(') → индекс закрывающей
function closeParen(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (!d) return k; } }
  return -1;
}
// Делит аргументы функции по запятым верхнего уровня
function splitArgs(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out.map(x => x.trim());
}

function groupConcat(s) {
  let k;
  while ((k = s.search(/\bgroup_concat\s*\(/i)) >= 0) {
    const open = s.indexOf('(', k), close = closeParen(s, open);
    const args = splitArgs(s.slice(open + 1, close));
    s = s.slice(0, k) + `string_agg((${args[0]})::text, ${args[1] || "','"})` + s.slice(close + 1);
  }
  return s;
}

// Сведения о таблицах, нужные для upsert и возврата id: { pk: {таблица: [колонки]}, id: Set(таблиц с колонкой id) }
// strftime(формат, секунды, 'unixepoch') → to_char по UTC. Формат подставляется в запрос
// текстом, поэтому разбираем его до того, как строки спрятаны.
const STRF = { '%Y': 'YYYY', '%m': 'MM', '%d': 'DD', '%H': 'HH24', '%M': 'MI', '%S': 'SS' };
function strftime(sql) {
  return sql.replace(/strftime\(\s*'([^']*)'\s*,\s*([^,]+?)\s*,\s*'unixepoch'\s*\)/gi, (m, fmt, expr) => {
    const ts = `(to_timestamp(${expr}) AT TIME ZONE 'UTC')`;
    if (fmt === '%w') return `EXTRACT(DOW FROM ${ts})::bigint`;
    if (fmt === '%H') return `EXTRACT(HOUR FROM ${ts})::bigint`;
    return `to_char(${ts}, '${fmt.replace(/%[YmdHMS]/g, x => STRF[x])}')`;
  });
}

// Два аргумента у MAX/MIN — это наибольшее/наименьшее из значений (в SQLite то же имя, что у агрегата)
function scalarMaxMin(s) {
  const re = /\b(MAX|MIN)\s*\(/gi; let m;
  while ((m = re.exec(s))) {
    const open = s.indexOf('(', m.index), close = closeParen(s, open);
    if (close < 0) break;
    const args = splitArgs(s.slice(open + 1, close));
    if (args.length === 2) {
      const fn = m[1].toUpperCase() === 'MAX' ? 'GREATEST' : 'LEAST';
      s = s.slice(0, m.index) + fn + s.slice(m.index + m[1].length);
      re.lastIndex = m.index + fn.length;
    }
  }
  return s;
}

function translate(sql, meta, forRun) {
  let { out: s, lits } = hideLiterals(strftime(sql));
  s = scalarMaxMin(s);
  s = s.replace(/\bchar\((\d+)\)/gi, 'chr($1)');

  s = s.replace(/\bunixepoch\(\)/gi, '(extract(epoch from now())::bigint)');
  s = s.replace(/\bIS NOT\s+(?!NULL\b|DISTINCT\b)/gi, 'IS DISTINCT FROM ');
  s = s.replace(/\bLIKE\b/g, 'ILIKE');
  s = s.replace(/\bAS INTEGER\)/gi, 'AS BIGINT)');
  s = s.replace(/\b(\w+\.)?rowid\b/gi, (m, p) => (p || '') + 'ctid');
  s = groupConcat(s);

  // Список упомянутых: EXISTS (SELECT 1 FROM json_each(X) WHERE value = ?)
  s = s.replace(/EXISTS\s*\(\s*SELECT 1 FROM json_each\(([\w.]+)\)\s*WHERE value = \?\s*\)/gi, '(($1)::jsonb @> to_jsonb(CAST(? AS bigint)))');

  // Склейка с параметром: у PostgreSQL тип такого параметра неизвестен
  s = s.replace(/\?(\s*\|\|)/g, '?::text$1').replace(/(\|\|\s*)\?/g, '$1?::text');

  // INSERT OR IGNORE / REPLACE
  let m = /^\s*INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO\s+(\w+)\s*\(([^)]*)\)/i.exec(s);
  let tail = '';
  if (m) {
    const mode = m[1].toUpperCase(), table = m[2], cols = m[3].split(',').map(c => c.trim());
    s = s.replace(/INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO/i, 'INSERT INTO');
    if (mode === 'IGNORE') tail = ' ON CONFLICT DO NOTHING';
    else {
      const pk = (meta.pk[table] || []);
      if (!pk.length) throw new Error('INSERT OR REPLACE: у таблицы ' + table + ' нет первичного ключа');
      const upd = cols.filter(c => !pk.includes(c));
      tail = upd.length ? ` ON CONFLICT (${pk.join(', ')}) DO UPDATE SET ${upd.map(c => `${c} = EXCLUDED.${c}`).join(', ')}` : ' ON CONFLICT DO NOTHING';
    }
  } else if (/^\s*INSERT\s+OR\s+/i.test(s)) throw new Error('Неподдерживаемый вариант INSERT OR …');

  // id вставленной строки
  const ins = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(s);
  let ret = '';
  if (forRun && ins && meta.id.has(ins[1]) && !/\bRETURNING\b/i.test(s)) ret = ' RETURNING id';

  s = s.replace(/;\s*$/, '') + tail + ret;

  // ? → $n
  let n = 0;
  s = s.replace(/\?/g, () => '$' + (++n));
  return restore(s, lits);
}

module.exports = { translate };
