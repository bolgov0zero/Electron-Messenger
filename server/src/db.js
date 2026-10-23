const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.pragma('cache_size = -8000'); // 8 MB page cache

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group', 'room')),
    name TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id),
    text TEXT NOT NULL,
    edited_at INTEGER,
    deleted INTEGER DEFAULT 0,
    sent_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, reaction),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_sent    ON messages(chat_id, sent_at);
  -- Лента и счётчики непрочитанного идут по возрастанию id, а не времени отправки.
  -- Без этого индекса выборка последних сообщений сортировала во временной
  -- таблице всю переписку чата, чтобы отдать полсотни строк.
  CREATE INDEX IF NOT EXISTS idx_messages_chat_id      ON messages(chat_id, id);
  -- График сообщений на главной админки считает по времени отправки во всех чатах
  -- сразу; без индекса подсчёт за сутки перебирал бы всю историю.
  CREATE INDEX IF NOT EXISTS idx_messages_sent_at      ON messages(sent_at);

  -- Докуда человек прочитал и докуда получил сообщения чата. Непрочитанное —
  -- хвост новее отметки, а не перебор всей истории; по тем же отметкам рисуются
  -- галочки у отправителя. Подробности в src/unread.js и src/statusmarks.js.
  CREATE TABLE IF NOT EXISTS chat_read_state (
    user_id      INTEGER NOT NULL,
    chat_id      INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    delivered_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chat_id)
  );
  -- Время доставки и прочтения за «окно времени статуса»: одна запись на человека,
  -- чат и вид за минуту (upto_id — до какого сообщения). См. src/statusmarks.js.
  -- Часто используемые смайлы человека: общий список на всех его устройствах (routes/users.js)
  CREATE TABLE IF NOT EXISTS user_emoji_freq (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji   TEXT    NOT NULL,
    cnt     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS status_log (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    kind    TEXT    NOT NULL,
    bucket  INTEGER NOT NULL,
    upto_id INTEGER NOT NULL,
    ts      INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id, kind, bucket)
  );
  CREATE INDEX IF NOT EXISTS idx_status_log_msg ON status_log(chat_id, upto_id);
  CREATE INDEX IF NOT EXISTS idx_status_log_at  ON status_log(ts);
  CREATE INDEX IF NOT EXISTS idx_chat_members_user     ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_members_chat     ON chat_members(chat_id);
  CREATE INDEX IF NOT EXISTS idx_reactions_msg         ON reactions(message_id);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    keys TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    chat_id INTEGER NOT NULL REFERENCES chats(id),
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks(token);

  CREATE TABLE IF NOT EXISTS muted_chats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, chat_id)
  );

  -- Закреплённые сообщения. Закрепление снимается само при удалении сообщения
  -- или чата — за это отвечает ON DELETE CASCADE, отдельной чистки не нужно.
  CREATE TABLE IF NOT EXISTS pinned_messages (
    chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pinned_at  INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pinned_chat ON pinned_messages(chat_id, pinned_at DESC);

  -- Журнал объявлений: и всплывающие, и полосы, и сообщения в чаты. Хранятся в базе,
  -- а не таймером в памяти, иначе перезапуск сервера съедает всё запланированное.
  -- kind: popup | banner | chat. targets — JSON-массив id (пользователей или чатов),
  -- пустой при target = 'all'. sent_at заполняется в момент фактической отправки.
  CREATE TABLE IF NOT EXISTS announcements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL,
    text         TEXT NOT NULL,
    author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    start_at     INTEGER NOT NULL,
    sent_at      INTEGER,
    duration_min INTEGER,
    expires_at   INTEGER,
    target       TEXT NOT NULL DEFAULT 'all',
    targets      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ann_pending ON announcements(sent_at, start_at);

  -- Крестик на полосе: отметка на пользователе, а не на устройстве, — закрыл на
  -- работе, дома полоса уже не появится.
  CREATE TABLE IF NOT EXISTS announcement_dismissed (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dismissed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (announcement_id, user_id)
  );
`);

fs.mkdirSync(path.join(path.dirname(DB_PATH), 'avatar'), { recursive: true });
fs.mkdirSync(path.join(path.dirname(DB_PATH), 'files'), { recursive: true });
// Раньше аватарки людей и групп всегда писались в chat_db рядом с репозиторием, даже если DB_PATH указывал в другую папку.
// Если папки разные, недостающие аватарки переносим на место (уже существующие не трогаем)
try {
  const legacy = path.join(__dirname, '..', '..', 'chat_db', 'avatar'), cur = path.join(path.dirname(DB_PATH), 'avatar');
  if (path.resolve(legacy) !== path.resolve(cur) && fs.existsSync(legacy)) {
    for (const f of fs.readdirSync(legacy)) if (/^(chat_)?\d+\.jpg$/.test(f) && !fs.existsSync(path.join(cur, f))) fs.copyFileSync(path.join(legacy, f), path.join(cur, f));
  }
} catch (e) { console.warn('[DB] перенос аватарок из прежней папки не удался:', e.message); }

// Add columns if upgrading from old schema
const tryAlter = (sql) => { try { db.exec(sql); } catch {} };
tryAlter('ALTER TABLE push_subscriptions ADD COLUMN app_url TEXT');   // адрес приложения (/m/) для декларативных пушей
tryAlter('ALTER TABLE messages ADD COLUMN edited_at INTEGER');
tryAlter('ALTER TABLE messages ADD COLUMN deleted INTEGER DEFAULT 0');
tryAlter('ALTER TABLE chat_members ADD COLUMN hidden_at INTEGER');
tryAlter('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)');
tryAlter('ALTER TABLE messages ADD COLUMN attachment TEXT');
tryAlter('ALTER TABLE users ADD COLUMN tag TEXT DEFAULT NULL');
tryAlter('ALTER TABLE chat_members ADD COLUMN pinned_at INTEGER');
tryAlter('ALTER TABLE users ADD COLUMN last_seen_at INTEGER');
tryAlter('ALTER TABLE messages ADD COLUMN mentions TEXT'); // JSON-массив id упомянутых пользователей
tryAlter('ALTER TABLE users ADD COLUMN is_bot INTEGER DEFAULT 0');
tryAlter('ALTER TABLE chats ADD COLUMN parent_id INTEGER REFERENCES chats(id) ON DELETE CASCADE');
tryAlter('ALTER TABLE chats ADD COLUMN position INTEGER DEFAULT 0');
// Сортировка тем комнаты: 1 — ручная (порядок задаёт администратор), 0 — по последнему сообщению. У уже существующих комнат
// остаётся ручная, чтобы порядок не поменялся сам; у новых по умолчанию автоматическая
if (!db.prepare('PRAGMA table_info(chats)').all().some(c => c.name === 'topics_manual')) {
  tryAlter('ALTER TABLE chats ADD COLUMN topics_manual INTEGER DEFAULT 0');
  db.exec("UPDATE chats SET topics_manual = 1 WHERE type = 'room' AND parent_id IS NULL");
}
tryAlter('ALTER TABLE messages ADD COLUMN forward_data TEXT');
// Превью ссылки в сообщении: JSON {url, title, site, image}; картинка лежит у нас в chat_db/linkprev
tryAlter('ALTER TABLE messages ADD COLUMN link_preview TEXT');
// Папки чатов — личные: у каждого пользователя свои, общие для всех его клиентов
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4ea4ff',
    icon TEXT NOT NULL DEFAULT 'folder',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id);
  CREATE TABLE IF NOT EXISTS chat_folder_items (
    folder_id INTEGER NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, chat_id)
  );
`);
tryAlter('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0');
// Пароль задан администратором (или это дефолтный admin) — при входе потребуем сменить
tryAlter('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0');
// Отметка отзыва сессий: токены, выданные раньше неё, недействительны.
// Нужна, чтобы дистанционный выход срабатывал и для выключенных клиентов —
// сообщение по открытому соединению до них не доходит.
tryAlter('ALTER TABLE users ADD COLUMN sessions_valid_from INTEGER');
// Отличает системное сообщение о составе группы/комнаты от обычного объявления —
// у них разное оформление в клиенте (см. sendSystemMessage в announcements.js)
tryAlter('ALTER TABLE messages ADD COLUMN system_kind TEXT');

// 2FA для входа в админ-панель (не влияет на обычный логин в чат-клиентах —
// там как был, так и остаётся только логин/пароль). totp_secret пустой, пока
// пользователь не подтвердил код при первой настройке; totp_required включает
// другой администратор в карточке пользователя.
tryAlter('ALTER TABLE users ADD COLUMN totp_secret TEXT');
tryAlter('ALTER TABLE users ADD COLUMN totp_pending_secret TEXT');
tryAlter('ALTER TABLE users ADD COLUMN totp_required INTEGER DEFAULT 0');
// Право отправлять объявления из клиента (включает админ в карточке пользователя)
tryAlter('ALTER TABLE users ADD COLUMN can_announce INTEGER DEFAULT 0');

// Секретные чаты (E2E-шифрование). is_secret — отдельная сущность от обычного
// personal-чата с тем же собеседником: они могут существовать одновременно,
// поэтому это флаг на чате, а не новое значение в CHECK(type) (constraint
// пришлось бы пересобирать). iv — вектор инициализации AES-GCM; у обычных
// (не зашифрованных) сообщений всегда NULL. Сервер шифротекст никогда не
// расшифровывает — только хранит и пересылает как обычный text.
tryAlter('ALTER TABLE chats ADD COLUMN is_secret INTEGER DEFAULT 0');
// Комната «только для чтения»: писать может только вебхук; распространяется на темы
tryAlter('ALTER TABLE chats ADD COLUMN read_only INTEGER DEFAULT 0');
tryAlter('ALTER TABLE messages ADD COLUMN iv TEXT');

// Аудит действий в админ-панели — кто, когда, что сделал. category — одна из
// moderation/rooms/server/security (см. вкладку «Аудит-лог»).
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id),
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_log(actor_id);
`);

// Секретные чаты: устройства, которым реально выдан ключ (approved), и запросы
// на выдачу ключа новому устройству. Код для подтверждения передаётся собеседнику
// ВНЕ системы (голосом/лично/в другом мессенджере) — специально, чтобы даже
// скомпрометированный сервер не мог сам подделать согласие на новое устройство.
// Отключённые/неодобренные устройства здесь не учитываются вообще — когда
// одобренных устройств не остаётся ни с одной стороны, чат удаляется безвозвратно
// (см. DELETE /api/secret/:chatId/devices/me).
db.exec(`
  CREATE TABLE IF NOT EXISTS secret_chat_devices (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_label TEXT,
    platform TEXT NOT NULL DEFAULT 'electron',
    approved_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id, device_id)
  );
  CREATE INDEX IF NOT EXISTS idx_scd_chat ON secret_chat_devices(chat_id);
  CREATE INDEX IF NOT EXISTS idx_scd_user ON secret_chat_devices(user_id);

  CREATE TABLE IF NOT EXISTS secret_key_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_device_id TEXT NOT NULL,
    requester_device_label TEXT,
    requester_platform TEXT NOT NULL DEFAULT 'electron',
    ephemeral_pubkey TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
    wrapped_secret TEXT,
    approver_ephemeral_pubkey TEXT,
    approver_user_id INTEGER REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_skr_chat ON secret_key_requests(chat_id, status);

  -- Коды доступа, которые показывает расшифрованное устройство. Собеседник вводит
  -- код на своём нерасшифрованном устройстве — тогда появляется запрос в secret_key_requests.
  CREATE TABLE IF NOT EXISTS secret_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    granter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granter_device_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','redeemed')),
    request_id INTEGER,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_sg_chat ON secret_grants(chat_id, status);
`);
tryAlter('ALTER TABLE secret_key_requests ADD COLUMN requester_ip TEXT');

// ── Полнотекстовый поиск (FTS5, external content) ──
// Целостность обеспечивается JOIN с messages при выборке: осиротевшие FTS-записи
// (например, после каскадного удаления чата) просто не дадут результатов.
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF text ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
      INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `);
  // Разовое заполнение существующей истории
  const ftsCount = db.prepare('SELECT COUNT(*) as c FROM messages_fts').get().c;
  if (ftsCount === 0) {
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
    if (msgCount > 0) {
      db.exec('INSERT INTO messages_fts(rowid, text) SELECT id, text FROM messages');
      console.log(`[FTS] Проиндексировано сообщений: ${msgCount}`);
    }
  }
} catch (e) {
  console.warn('[FTS] Полнотекстовый поиск недоступен:', e.message);
}

// Шифротексты секретных чатов в полнотекстовый индекс не попадают: поиск по ним
// бессмыслен, а индекс сохранил бы их следы. Миграция одноразовая.
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'fts_secret_v2'").get()) {
    db.exec(`
      DROP TRIGGER IF EXISTS messages_fts_ai;
      DROP TRIGGER IF EXISTS messages_fts_ad;
      DROP TRIGGER IF EXISTS messages_fts_au;
      CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages WHEN new.iv IS NULL BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages WHEN old.iv IS NULL BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER messages_fts_au_del AFTER UPDATE OF text ON messages WHEN old.iv IS NULL BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER messages_fts_au_ins AFTER UPDATE OF text ON messages WHEN new.iv IS NULL BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
    const del = db.prepare("INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', ?, ?)");
    db.prepare('SELECT id, text FROM messages WHERE iv IS NOT NULL').all().forEach(r => { try { del.run(r.id, r.text); } catch {} });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_secret_v2', '1')").run();
  }
} catch (e) { console.warn('[FTS] миграция секретных чатов не выполнена:', e.message); }

// Разовое заполнение отметок «докуда прочитано» для уже работающих установок.
// Берём id прямо перед первым непрочитанным — тогда счётчики после перехода
// совпадают с прежними до единицы. Если непрочитанного нет, отметка встаёт на
// последнее сообщение чата.
const hasMessageStatus = () => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'message_status'").get();
try {
  const filled = db.prepare('SELECT COUNT(*) AS c FROM chat_read_state').get().c;
  const members = db.prepare('SELECT COUNT(*) AS c FROM chat_members').get().c;
  if (filled === 0 && members > 0 && hasMessageStatus()) {
    db.exec(`
      INSERT OR REPLACE INTO chat_read_state (user_id, chat_id, last_read_id)
      SELECT cm.user_id, cm.chat_id, COALESCE(
        (SELECT MIN(m.id) - 1 FROM messages m
           LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = cm.user_id
          WHERE m.chat_id = cm.chat_id AND m.sender_id IS NOT cm.user_id
            AND m.deleted = 0 AND ms.read_at IS NULL),
        (SELECT COALESCE(MAX(id), 0) FROM messages WHERE chat_id = cm.chat_id))
      FROM chat_members cm
    `);
    console.log('[DB] Отметки прочтения заполнены:',
      db.prepare('SELECT COUNT(*) AS c FROM chat_read_state').get().c);
  }
} catch (e) { console.error('[DB] Не удалось заполнить отметки прочтения:', e.message); }

// Статусы доставки и прочтения: строка на сообщение и получателя (message_status) заменена
// отметками «доставлено до N» / «прочитано до N» на человека и чат и журналом времени за
// окно status_window_days (src/statusmarks.js). Миграция одноразовая: таблица удаляется.
// Эта же миграция для PostgreSQL — migrations/pg/007_status_marks.sql.
tryAlter('ALTER TABLE chat_read_state ADD COLUMN delivered_id INTEGER NOT NULL DEFAULT 0');
try {
  if (hasMessageStatus()) {
    db.transaction(() => {
      const win = Number(db.prepare("SELECT value FROM settings WHERE key = 'status_window_days'").get()?.value);
      const days = Number.isFinite(win) && win >= 0 ? win : 7;
      const now = Math.floor(Date.now() / 1000), since = now - days * 86400;
      db.exec(`
        INSERT INTO chat_read_state (user_id, chat_id, last_read_id, delivered_id)
        SELECT ms.user_id, m.chat_id,
               COALESCE(MAX(CASE WHEN ms.read_at IS NOT NULL THEN m.id END), 0),
               COALESCE(MAX(CASE WHEN ms.delivered_at IS NOT NULL OR ms.read_at IS NOT NULL THEN m.id END), 0)
        FROM message_status ms JOIN messages m ON m.id = ms.message_id
        GROUP BY ms.user_id, m.chat_id
        ON CONFLICT(user_id, chat_id) DO UPDATE SET
          last_read_id = MAX(chat_read_state.last_read_id, excluded.last_read_id),
          delivered_id = MAX(chat_read_state.delivered_id, excluded.delivered_id)`);
      if (days > 0) {
        for (const [kind, col] of [['r', 'read_at'], ['d', 'delivered_at']]) {
          db.prepare(`
            INSERT OR REPLACE INTO status_log (chat_id, user_id, kind, bucket, upto_id, ts)
            SELECT m.chat_id, ms.user_id, ?, ms.${col} / 60, MAX(m.id), MAX(ms.${col})
            FROM message_status ms JOIN messages m ON m.id = ms.message_id
            WHERE ms.${col} >= ? AND m.chat_id IN (SELECT chat_id FROM chat_members GROUP BY chat_id HAVING COUNT(*) <= 100)
            GROUP BY m.chat_id, ms.user_id, ms.${col} / 60`).run(kind, since);
        }
      }
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('status_log_from', ?)").run(String(days > 0 ? since : now));
      db.exec('DROP TABLE message_status');
    })();
    console.log('[DB] Статусы сообщений переведены на отметки, таблица message_status удалена');
  }
} catch (e) { console.error('[DB] Не удалось перевести статусы сообщений на отметки:', e.message); }

// Default admin
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password) VALUES (?, ?, ?, 1, 1)')
    .run('admin', hash, 'Administrator');
  console.log('Created default admin: admin / admin (потребуется смена пароля при первом входе)');
}

// Уже работающие установки: если у admin до сих пор дефолтный пароль — требуем смену.
// Проверяется на каждом старте, пока пароль не сменят.
try {
  const adm = db.prepare("SELECT id, password_hash, must_change_password FROM users WHERE username = 'admin'").get();
  if (adm && !adm.must_change_password && bcrypt.compareSync('admin', adm.password_hash)) {
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(adm.id);
    console.warn('[Auth] У пользователя admin дефолтный пароль — при входе будет запрошена смена.');
  }
} catch {}

// Модули — необязательные возможности (сейчас список пуст). modules хранит только
// переключатель на сервере: пока админ его не включил, у пользователей модуля нет вовсе.
// module_devices — «включено у меня» по каждому устройству (клиент сам хранит свой выбор,
// сюда он только сообщает, нужно для статистики). module_events — журнал: кто и когда включил,
// выключил, начал загрузку или получил ошибку; хранится год (см. routes/modules.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS modules (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS module_devices (
    module TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    client TEXT,
    version TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (module, user_id, device_id)
  );
  CREATE TABLE IF NOT EXISTS module_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    device_id TEXT,
    client TEXT,
    version TEXT,
    event TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_module_events_created ON module_events(module, created_at);
`);

// Версия набора модуля, скачанная на устройство (для статистики «на старой версии»)
tryAlter('ALTER TABLE module_devices ADD COLUMN pack_version TEXT');

// Рабочие пространства. Пространство только объединяет людей (комнаты к нему не привязаны):
// внутри пространства люди друг друга видят, в разных не видят. «Основное» (id 1) есть всегда,
// в него попадают все существующие пользователи и новые, если не выбрано другое.
// contacts — контакты, добавленные вручную: односторонние (видит только тот, кто добавил),
// без подтверждения. user_blocks — блокировки: заблокированный не пишет в личные сообщения.
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS contacts (
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (owner_id, contact_id)
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);
  CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
`);
// Счётчик «сообщений без ответа» между людьми из разных пространств: сколько подряд сообщений
// sender отправил recipient, пока тот не ответил (см. spaces.js, DM_LIMIT). Хранится отдельно от чата,
// чтобы удаление переписки его не обнуляло.
db.exec(`
  CREATE TABLE IF NOT EXISTS dm_limits (
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sender_id, recipient_id)
  );
`);
db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (1, 'Основное')").run();
tryAlter('ALTER TABLE users ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1');
tryAlter('CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id)');
// Человек может состоять в нескольких пространствах: user_workspaces — его членства. users.workspace_id остаётся
// «основным» (наименьший номер из членств): его читают старые клиенты и код, которому достаточно одного пространства.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_workspaces (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_workspaces_ws ON user_workspaces(workspace_id);
`);
// Перенос: пока таблица пуста (первый запуск после обновления или восстановление старой копии), каждому
// человеку кладём его прежнее единственное пространство
if (!db.prepare('SELECT 1 FROM user_workspaces LIMIT 1').get()) {
  db.prepare(`INSERT OR IGNORE INTO user_workspaces (user_id, workspace_id)
    SELECT id, workspace_id FROM users WHERE COALESCE(is_bot, 0) != 2 AND workspace_id IN (SELECT id FROM workspaces)`).run();
}

// Федерация инстансов (см. federation.js). fed_peers — подключённые серверы; fed_invites — одноразовые ключи
// активации (token_hash — открытый номер ключа, secret — секрет, по сети не передаётся); fed_outbox — очередь событий, которые ещё не подтверждены получателем.
// Человек с другого сервера хранится как «теневой» пользователь (users.is_bot = 2, workspace_id = 0,
// fed_instance/fed_login — его адрес): без пароля и входа, участвует только в личных чатах и контактах.
// messages.fed_uid — сквозной идентификатор сообщения «сервер:id», по нему правятся и удаляются копии.
db.exec(`
  CREATE TABLE IF NOT EXISTS fed_peers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    url TEXT,
    pub TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('in','out')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
    last_in_seq INTEGER NOT NULL DEFAULT 0,
    last_contact_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS fed_invites (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS fed_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peer_id INTEGER NOT NULL REFERENCES fed_peers(id) ON DELETE CASCADE,
    ev TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_fed_outbox_peer ON fed_outbox(peer_id, id);
`);
tryAlter('ALTER TABLE fed_invites ADD COLUMN secret TEXT');
// Счётчики федерации по часам и соединениям: объём прошедшего по соединению и то, что мы отклонили.
// Число сообщений и файлов берётся прямо из messages (fed_uid), поэтому история для графика есть сразу.
db.exec(`
  CREATE TABLE IF NOT EXISTS fed_stats (
    bucket INTEGER NOT NULL,
    peer_id INTEGER NOT NULL,
    bytes_out INTEGER NOT NULL DEFAULT 0,
    bytes_in INTEGER NOT NULL DEFAULT 0,
    rej_limit INTEGER NOT NULL DEFAULT 0,
    rej_rate INTEGER NOT NULL DEFAULT 0,
    rej_blocked INTEGER NOT NULL DEFAULT 0,
    rej_other INTEGER NOT NULL DEFAULT 0,
    reconnects INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, peer_id)
  );
`);
tryAlter('ALTER TABLE users ADD COLUMN fed_instance TEXT');
tryAlter('ALTER TABLE users ADD COLUMN fed_login TEXT');
tryAlter('ALTER TABLE users ADD COLUMN fed_avatar_v TEXT');
tryAlter('ALTER TABLE messages ADD COLUMN fed_uid TEXT');
// Адрес человека с другого сервера теперь «сервер:логин» (раньше «сервер@логин»): переименовываем уже созданных теневых пользователей
try { db.prepare("UPDATE users SET username = fed_instance || ':' || fed_login WHERE is_bot = 2 AND username != fed_instance || ':' || fed_login").run(); } catch (e) { console.warn('[Fed] не удалось переименовать теневых пользователей:', e.message); }
tryAlter('CREATE INDEX IF NOT EXISTS idx_messages_fed_uid ON messages(fed_uid)');
// Группы в федерации (см. fedgroups.js). Группа хранится на сервере, где создана (хозяин); у остальных серверов её зеркало:
// chats.fed_instance — идентификатор сервера-хозяина, fed_chat_id — номер группы у него (у самого хозяина оба пусты).
// chat_invites — приглашения, ждущие согласия: приглашённый в chat_members не состоит, поэтому не виден участникам и не получает сообщений.
// fed_peers.proto — версия протокола, о которой сообщил другой сервер (группы с версии 2).
tryAlter('ALTER TABLE chats ADD COLUMN fed_instance TEXT');
tryAlter('ALTER TABLE chats ADD COLUMN fed_chat_id INTEGER');
tryAlter('CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_fed ON chats(fed_instance, fed_chat_id) WHERE fed_instance IS NOT NULL');
tryAlter('ALTER TABLE fed_peers ADD COLUMN proto INTEGER NOT NULL DEFAULT 0');
// fed_peers.ver — версия сервера, о которой сообщил партнёр; обновляется при каждом новом соединении (после обновления сервера он перезапускается)
tryAlter('ALTER TABLE fed_peers ADD COLUMN ver TEXT');
// fed_seq — номер сообщения у хозяина группы (по нему гость запрашивает пропущенное после обрыва); fed_avatar_v — версия аватарки группы у хозяина
tryAlter('ALTER TABLE messages ADD COLUMN fed_seq INTEGER');
// «Без звука» на время: until — момент (unixepoch), когда звук возвращается; NULL — навсегда
tryAlter('ALTER TABLE muted_chats ADD COLUMN until INTEGER');
// Настройки уведомлений человека: показывать ли текст, тихие часы (минуты от полуночи в часовом поясе tz)
db.exec(`CREATE TABLE IF NOT EXISTS push_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_text INTEGER NOT NULL DEFAULT 1,
  quiet_from INTEGER,
  quiet_to INTEGER,
  tz TEXT
)`);
tryAlter('ALTER TABLE chats ADD COLUMN fed_avatar_v TEXT');
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_invites (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_invites_user ON chat_invites(user_id);
`);

// Общие пространства между серверами (см. fedspaces.js). Пространство принадлежит серверу-хозяину; у остальных серверов его зеркало:
// workspaces.fed_uid — «хозяин:номер», fed_host — идентификатор хозяина (у самого хозяина fed_host = его идентификатор).
// fed_space_servers — копия дерева серверов пространства (parent — сосед по дереву ближе к хозяину); state: active | offered (ждёт ответа).
// fed_space_offers — приглашения, пришедшие нам и ждущие решения админа; fed_space_asks — просьбы участников расширить пространство (у хозяина).
// fed_peers.virt = 1 — «сквозной» сервер без прямого соединения: связь с ним идёт через соседей по дереву (свой шифрованный туннель поверх).
// fed_peers.sp — сервер сообщил, что умеет общие пространства. fed_key_checks — серверы, чей ключ админ сверил вручную.
tryAlter('ALTER TABLE workspaces ADD COLUMN fed_uid TEXT');
tryAlter('ALTER TABLE workspaces ADD COLUMN fed_host TEXT');
tryAlter('CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_fed_uid ON workspaces(fed_uid) WHERE fed_uid IS NOT NULL');
tryAlter('ALTER TABLE fed_peers ADD COLUMN virt INTEGER NOT NULL DEFAULT 0');
tryAlter('ALTER TABLE fed_peers ADD COLUMN sp INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE TABLE IF NOT EXISTS fed_space_servers (
    space_uid TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pub TEXT NOT NULL,
    parent TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (space_uid, instance_id)
  );
  CREATE TABLE IF NOT EXISTS fed_space_offers (
    space_uid TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    name TEXT NOT NULL,
    from_inst TEXT NOT NULL,
    tree TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS fed_space_asks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_uid TEXT NOT NULL,
    proposer TEXT NOT NULL,
    target TEXT NOT NULL,
    target_name TEXT NOT NULL,
    target_pub TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS fed_key_checks (
    instance_id TEXT PRIMARY KEY,
    pub TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Индексы по внешним ключам. Без них каждое удаление сообщения, чата или человека
// перебирало дочернюю таблицу целиком: на 1,5 млн сообщений удаление одного
// сообщения занимало 100 мс (проверка ответов на него), а удаление чата на
// 30 тысяч сообщений тянулось десятки минут. Счёт сообщений по автору и
// по чату без удалённых (админка) выходил на секунды.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender         ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_messages_chat_deleted   ON messages(chat_id, deleted);
  CREATE INDEX IF NOT EXISTS idx_messages_reply          ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_reactions_user          ON reactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_pinned_message          ON pinned_messages(message_id);
  CREATE INDEX IF NOT EXISTS idx_muted_chat              ON muted_chats(chat_id);
  CREATE INDEX IF NOT EXISTS idx_folder_items_chat       ON chat_folder_items(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chats_parent            ON chats(parent_id);
`);

// Нагрузка сервера по пятиминуткам для графиков на главной админки (см. monitor.js)
db.exec(`CREATE TABLE IF NOT EXISTS metrics_5m (
  t        INTEGER PRIMARY KEY,   -- начало пятиминутки, секунды
  n        INTEGER NOT NULL,      -- сколько замеров вошло
  cpu_sum  REAL NOT NULL,
  lag_max  REAL NOT NULL,
  on_sum   REAL NOT NULL,
  on_n     INTEGER NOT NULL
)`);

// Какое сообщение переслано: номер исходного (при пересылке пересланного — самого первого). По нему считается отметка «переслали N раз»
tryAlter('ALTER TABLE messages ADD COLUMN fwd_src INTEGER');
tryAlter('CREATE INDEX IF NOT EXISTS idx_messages_fwd_src ON messages(fwd_src) WHERE fwd_src IS NOT NULL');
// Имя и метка гостя при удалении его учётной записи остаются у сообщений (sender_id обнуляется, см. guest.js)
tryAlter('ALTER TABLE messages ADD COLUMN guest_name TEXT');
tryAlter('ALTER TABLE messages ADD COLUMN guest_tag TEXT');

// Гостевые ссылки: вход в группу или комнату без учётной записи на ограниченное время (см. guest.js).
// В базе только хеш токена; одна ссылка — один гость, привязанный к устройству первого входа.
// Гость — пользователь с is_bot = 3: он не попадает в списки людей, а к чату доступ только через эту ссылку
db.exec(`
  CREATE TABLE IF NOT EXISTS guest_links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id       INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    created_by    INTEGER,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at    INTEGER NOT NULL,
    revoked_at    INTEGER,
    ended_at      INTEGER,
    guest_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    guest_name    TEXT,
    device_hash   TEXT,
    base_msg_id   INTEGER NOT NULL DEFAULT 0,
    first_used_at INTEGER,
    last_used_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_guest_links_chat ON guest_links(chat_id);
  CREATE INDEX IF NOT EXISTS idx_guest_links_user ON guest_links(guest_user_id);
`);

// Системный пользователь для объявлений (is_bot=1, скрыт из обычных списков)
const sysExists = db.prepare("SELECT id FROM users WHERE username = '__system__'").get();
if (!sysExists) {
  const r = db.prepare("INSERT INTO users (username, password_hash, display_name, is_bot) VALUES ('__system__', '', 'Система', 1)").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('system_user_id', ?)").run(String(r.lastInsertRowid));
}

// Periodically let SQLite tune its own query planner stats (safe, read-only analysis)
db.pragma('optimize');
setInterval(() => db.pragma('optimize'), 3_600_000); // every hour

module.exports = db;
