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

  CREATE TABLE IF NOT EXISTS message_status (
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    delivered_at INTEGER,
    read_at INTEGER,
    PRIMARY KEY (message_id, user_id)
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

  -- Докуда человек прочитал чат. Непрочитанное — хвост новее этой отметки, а не
  -- перебор всей истории с проверкой message_status по каждому сообщению.
  -- Подробности в src/unread.js.
  CREATE TABLE IF NOT EXISTS chat_read_state (
    user_id      INTEGER NOT NULL,
    chat_id      INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_members_user     ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_members_chat     ON chat_members(chat_id);
  CREATE INDEX IF NOT EXISTS idx_message_status_msg    ON message_status(message_id);
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

// Add columns if upgrading from old schema
const tryAlter = (sql) => { try { db.exec(sql); } catch {} };
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
tryAlter('ALTER TABLE messages ADD COLUMN forward_data TEXT');
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
try {
  const filled = db.prepare('SELECT COUNT(*) AS c FROM chat_read_state').get().c;
  const members = db.prepare('SELECT COUNT(*) AS c FROM chat_members').get().c;
  if (filled === 0 && members > 0) {
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
