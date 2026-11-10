//! Сеть: REST через reqwest и WebSocket (/ws?token=…) через tokio-tungstenite.
//! Результаты уходят в интерфейс через канал `Event`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc::Sender, Arc};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

use crate::model::{gb, gi, gs, parse_chat, parse_msg, Chat, Msg, Status};
use crate::store::Session;

pub enum Event {
    LoggedIn(Session),
    LoginFailed(String),
    Chats(Vec<Chat>),
    History { chat_id: i64, msgs: Vec<Msg> },
    Message(Msg),
    Rejected { chat_id: i64, reason: String },
    Status { chat_id: i64, id: i64, status: Status },
    StatusRange { chat_id: i64, kind: String, min: i64, max: i64, reader: i64 },
    WsState(bool),
    ReloadChats,
    AuthExpired,
    Error(String),
}

#[derive(Clone)]
pub struct Net {
    pub rt: tokio::runtime::Handle,
    pub http: reqwest::Client,
    pub tx: Sender<Event>,
    pub ctx: eframe::egui::Context,
}

/// Приводит ввод пользователя к виду https://host[:port] без хвостового слэша.
pub fn normalize_server(s: &str) -> String {
    let s = s.trim().trim_end_matches('/');
    if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("https://{s}")
    }
}

fn ws_url(s: &Session) -> String {
    let base = if let Some(rest) = s.server.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = s.server.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("wss://{}", s.server)
    };
    format!("{base}/ws?token={}", s.token)
}

fn api_error(v: &Value, status: reqwest::StatusCode) -> String {
    match v.get("error").and_then(|e| e.as_str()) {
        Some(e) if !e.is_empty() => e.to_string(),
        _ => format!("Ошибка сервера ({status})"),
    }
}

impl Net {
    fn emit(&self, e: Event) {
        let _ = self.tx.send(e);
        self.ctx.request_repaint();
    }

    pub fn login(&self, server: String, username: String, password: String) {
        let n = self.clone();
        self.rt.spawn(async move {
            let base = normalize_server(&server);
            let res = n
                .http
                .post(format!("{base}/api/auth/login"))
                .json(&json!({ "username": username, "password": password }))
                .send()
                .await;
            let resp = match res {
                Ok(r) => r,
                Err(e) => return n.emit(Event::LoginFailed(format!("Нет связи с сервером: {e}"))),
            };
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return n.emit(Event::LoginFailed(api_error(&body, status)));
            }
            let token = gs(&body, "token");
            let user = body.get("user").cloned().unwrap_or(Value::Null);
            if token.is_empty() {
                return n.emit(Event::LoginFailed("Сервер не вернул токен".into()));
            }
            if gb(&user, "must_change_password") {
                return n.emit(Event::LoginFailed(
                    "Нужно сменить пароль — сделайте это в обычном клиенте".into(),
                ));
            }
            let mut name = gs(&user, "display_name");
            if name.is_empty() {
                name = gs(&user, "username");
            }
            n.emit(Event::LoggedIn(Session { server: base, token, user_id: gi(&user, "id"), name }));
        });
    }

    pub fn fetch_chats(&self, s: &Session) {
        let (n, s) = (self.clone(), s.clone());
        self.rt.spawn(async move {
            let res = n.http.get(format!("{}/api/chats", s.server)).bearer_auth(&s.token).send().await;
            let resp = match res {
                Ok(r) => r,
                Err(e) => return n.emit(Event::Error(format!("Не удалось загрузить чаты: {e}"))),
            };
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                return n.emit(Event::AuthExpired);
            }
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return n.emit(Event::Error(api_error(&body, status)));
            }
            let chats = body.as_array().map(|a| a.iter().filter_map(parse_chat).collect()).unwrap_or_default();
            n.emit(Event::Chats(chats));
        });
    }

    pub fn fetch_history(&self, s: &Session, chat_id: i64) {
        let (n, s) = (self.clone(), s.clone());
        self.rt.spawn(async move {
            let url = format!("{}/api/messages/chat/{chat_id}?limit=80", s.server);
            let res = n.http.get(url).bearer_auth(&s.token).send().await;
            let resp = match res {
                Ok(r) => r,
                Err(e) => return n.emit(Event::Error(format!("Не удалось загрузить сообщения: {e}"))),
            };
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                n.emit(Event::History { chat_id, msgs: vec![] });
                return n.emit(Event::Error(api_error(&body, status)));
            }
            let msgs = body
                .get("messages")
                .and_then(|m| m.as_array())
                .map(|a| a.iter().map(parse_msg).collect())
                .unwrap_or_default();
            n.emit(Event::History { chat_id, msgs });
        });
    }

    /// Запускает WebSocket с переподключением. Возвращает канал отправки и флаг остановки.
    pub fn start_ws(&self, s: &Session) -> (UnboundedSender<String>, Arc<AtomicBool>) {
        let (out_tx, mut out_rx) = unbounded_channel::<String>();
        let stop = Arc::new(AtomicBool::new(false));
        let (n, s, stop2) = (self.clone(), s.clone(), stop.clone());
        self.rt.spawn(async move {
            while !stop2.load(Ordering::Relaxed) {
                match tokio_tungstenite::connect_async(ws_url(&s)).await {
                    Ok((stream, _)) => {
                        n.emit(Event::WsState(true));
                        let (mut w, mut r) = stream.split();
                        let mut ping = tokio::time::interval(Duration::from_secs(25));
                        let mut fatal = false;
                        loop {
                            tokio::select! {
                                m = r.next() => match m {
                                    Some(Ok(Message::Text(t))) => n.handle_ws(&t.to_string()),
                                    Some(Ok(Message::Close(f))) => {
                                        fatal = f.map_or(false, |f| u16::from(f.code) == 1008);
                                        break;
                                    }
                                    Some(Ok(_)) => {}
                                    _ => break,
                                },
                                o = out_rx.recv() => match o {
                                    Some(txt) => if w.send(Message::Text(txt.into())).await.is_err() { break },
                                    None => return,
                                },
                                _ = ping.tick() => {
                                    if w.send(Message::Text(r#"{"type":"ping"}"#.to_string().into())).await.is_err() { break }
                                }
                            }
                        }
                        n.emit(Event::WsState(false));
                        if fatal {
                            return n.emit(Event::AuthExpired);
                        }
                    }
                    Err(tokio_tungstenite::tungstenite::Error::Http(r))
                        if r.status().as_u16() == 401 || r.status().as_u16() == 403 =>
                    {
                        return n.emit(Event::AuthExpired);
                    }
                    Err(_) => {}
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        });
        (out_tx, stop)
    }

    fn handle_ws(&self, text: &str) {
        let Ok(v) = serde_json::from_str::<Value>(text) else { return };
        match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "message" => {
                if let Some(m) = v.get("message") {
                    let mut msg = parse_msg(m);
                    if msg.client_id.is_empty() {
                        msg.client_id = gs(&v, "client_id");
                    }
                    self.emit(Event::Message(msg));
                }
            }
            "send_rejected" => self.emit(Event::Rejected { chat_id: gi(&v, "chat_id"), reason: gs(&v, "reason") }),
            "reload_chats" => self.emit(Event::ReloadChats),
            "status_update" => {
                if let Some(m) = v.get("message") {
                    let msg = parse_msg(m);
                    if let Some(status) = msg.status {
                        self.emit(Event::Status { chat_id: msg.chat_id, id: msg.id, status });
                    }
                }
            }
            "status_range" => self.emit(Event::StatusRange {
                chat_id: gi(&v, "chat_id"),
                kind: gs(&v, "kind"),
                min: gi(&v, "min_id"),
                max: gi(&v, "max_id"),
                reader: gi(&v, "reader_id"),
            }),
            _ => {}
        }
    }
}
