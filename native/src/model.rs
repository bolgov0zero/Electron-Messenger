//! Модели чатов и сообщений. Разбор JSON терпимый: поля могут быть числами,
//! строками или отсутствовать — прототип не должен падать из-за формы ответа.
use serde_json::Value;

pub fn gi(v: &Value, k: &str) -> i64 {
    match v.get(k) {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

pub fn gs(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

pub fn gb(v: &Value, k: &str) -> bool {
    match v.get(k) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    }
}

#[derive(Clone, Debug, Default)]
pub struct Member {
    pub id: i64,
    pub name: String,
}

/// Вложение сообщения (основное или из `more`).
#[derive(Clone, Debug, Default)]
pub struct Attachment {
    pub url: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub w: i64,
    pub h: i64,
    pub gif: bool,
    pub expired: bool,
    pub voice: bool,
}

impl Attachment {
    pub fn is_image(&self) -> bool {
        self.mime.starts_with("image/") && !self.expired
    }
    /// Имя файла без каталога: /files/abc.jpg → abc.jpg
    pub fn file_name(&self) -> &str {
        self.url.rsplit('/').next().unwrap_or("")
    }
}

/// Присутствие пользователя: online | away | offline.
#[derive(Clone, Debug, Default)]
pub struct Presence {
    pub status: String,
    pub last_seen: i64,
    pub mobile: bool,
}

/// Статус доставки своего сообщения: сколько получателей получили и прочитали.
#[derive(Clone, Copy, Debug, Default)]
pub struct Status {
    pub delivered: i64,
    pub read: i64,
    pub total: i64,
}

#[derive(Clone, Debug, Default)]
pub struct Msg {
    pub id: i64,
    pub chat_id: i64,
    pub text: String,
    pub sent_at: i64,
    pub sender_id: i64,
    pub sender_name: String,
    pub deleted: bool,
    pub edited: bool,
    pub system: bool,
    pub attachments: Vec<Attachment>,
    pub reply_name: String,
    pub reply_text: String,
    pub client_id: String,
    pub pending: bool,
    pub status: Option<Status>,
}

#[derive(Clone, Debug, Default)]
pub struct Chat {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub members: Vec<Member>,
    pub last: Option<Msg>,
    pub unread: i64,
    pub pinned: bool,
    pub muted: bool,
    pub read_only: bool,
}

pub fn parse_attachment(a: &Value) -> Attachment {
    Attachment {
        url: gs(a, "url"),
        name: gs(a, "name"),
        mime: gs(a, "mime"),
        size: gi(a, "size"),
        w: gi(a, "width"),
        h: gi(a, "height"),
        gif: a.get("gif").map_or(false, |x| !x.is_null() && x.as_bool() != Some(false)),
        expired: gb(a, "expired"),
        voice: a.get("voice").map_or(false, |x| x.is_object()),
    }
}

pub fn parse_msg(v: &Value) -> Msg {
    let mut sent = v.get("sent_at").and_then(|x| x.as_f64()).unwrap_or(0.0);
    if sent > 1e11 {
        sent /= 1000.0; // на случай миллисекунд
    }
    let mut attachments = Vec::new();
    if let Some(a) = v.get("attachment").filter(|a| a.is_object()) {
        attachments.push(parse_attachment(a));
        if let Some(more) = a.get("more").and_then(|m| m.as_array()) {
            attachments.extend(more.iter().filter(|m| m.is_object()).map(parse_attachment));
        }
    }
    let mut name = gs(v, "sender_name");
    if name.is_empty() {
        name = gs(v, "sender_username");
    }
    Msg {
        id: gi(v, "id"),
        chat_id: gi(v, "chat_id"),
        text: gs(v, "text"),
        sent_at: sent as i64,
        sender_id: gi(v, "sender_id"),
        sender_name: name,
        deleted: gb(v, "deleted"),
        edited: v.get("edited_at").map_or(false, |x| !x.is_null()),
        system: v.get("system_kind").map_or(false, |x| x.as_str().map_or(false, |s| !s.is_empty())),
        attachments,
        reply_name: gs(v, "reply_sender_name"),
        reply_text: gs(v, "reply_text"),
        client_id: gs(v, "client_id"),
        pending: false,
        status: v.get("status").filter(|s| s.is_object()).map(|s| Status {
            delivered: gi(s, "delivered"),
            read: gi(s, "read"),
            total: gi(s, "total"),
        }),
    }
}

pub fn parse_chat(v: &Value) -> Option<Chat> {
    let id = gi(v, "id");
    if id == 0 || gb(v, "is_secret") {
        return None; // секретные E2E-чаты прототип не показывает
    }
    if v.get("invite").map_or(false, |x| !x.is_null()) {
        return None; // приглашения из федерации
    }
    let members = v
        .get("members")
        .and_then(|m| m.as_array())
        .map(|a| {
            a.iter()
                .map(|m| {
                    let mut n = gs(m, "display_name");
                    if n.is_empty() {
                        n = gs(m, "username");
                    }
                    Member { id: gi(m, "id"), name: n }
                })
                .collect()
        })
        .unwrap_or_default();
    let last = v.get("last_message").filter(|x| x.is_object()).map(parse_msg);
    Some(Chat {
        id,
        kind: gs(v, "type"),
        name: gs(v, "name"),
        members,
        last,
        unread: gi(v, "unread"),
        pinned: v.get("pinned").map_or(false, |x| !x.is_null() && x.as_i64() != Some(0)),
        muted: gb(v, "muted"),
        read_only: gb(v, "read_only"),
    })
}

impl Chat {
    pub fn peer(&self, me: i64) -> Option<&Member> {
        if self.kind == "direct" {
            self.members.iter().find(|m| m.id != me)
        } else {
            None
        }
    }

    pub fn title(&self, me: i64) -> String {
        if let Some(p) = self.peer(me) {
            if !p.name.is_empty() {
                return p.name.clone();
            }
        }
        if self.name.is_empty() { "Чат".to_string() } else { self.name.clone() }
    }

    pub fn last_ts(&self) -> i64 {
        self.last.as_ref().map_or(0, |m| m.sent_at)
    }
}
