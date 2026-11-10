//! Прототип нативного клиента на egui: вход, список чатов, лента, отправка.
//! Дизайн — «Мягкий» (flat) из client/src/flat*.css.
mod model;
mod net;
mod store;
mod theme;
mod update;
mod view;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use chrono::Local;
use eframe::egui::{
    self, pos2, vec2, Align, Align2, Color32, CornerRadius, FontId, Id, Key, Margin, Modifiers, Rect, RichText, Sense,
    Stroke, TextEdit, Ui,
};
use model::{Chat, Msg, Presence};
use net::{Event, Net};
use store::Session;
use theme::{alpha, bold, Pal};
use view::{chat_row, day_label, day_of, day_pill, draw_avatar, draw_msg, plural, presence_dot, typing_label, MsgCx, Row};

fn main() -> eframe::Result {
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("tokio");
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Chat")
            .with_inner_size([1120.0, 740.0])
            .with_min_inner_size([760.0, 500.0]),
        ..Default::default()
    };
    eframe::run_native("Chat", options, Box::new(move |cc| Ok(Box::new(App::new(cc, rt)))))
}

#[derive(PartialEq)]
enum Screen {
    Login,
    Main,
}

struct Typer {
    user_id: i64,
    name: String,
    voice: bool,
    at: Instant,
}

#[derive(Default, Clone, Copy)]
struct Feed {
    offset: f32,
    content_h: f32,
    view_h: f32,
}

struct App {
    _rt: tokio::runtime::Runtime,
    net: Net,
    rx: mpsc::Receiver<Event>,
    ws_out: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    ws_stop: Option<Arc<AtomicBool>>,
    ws_online: bool,

    screen: Screen,
    server: String,
    username: String,
    password: String,
    login_busy: bool,
    login_err: String,

    session: Option<Session>,
    chats: Vec<Chat>,
    chats_loaded: bool,
    selected: Option<i64>,
    msgs: HashMap<i64, Vec<Msg>>,
    loading: HashSet<i64>,
    has_more: HashMap<i64, bool>,
    loading_more: HashSet<i64>,
    search: String,
    input: String,
    prev_input: String,
    focus_input: bool,
    toast: Option<(String, Instant)>,
    seq: i64,
    applied: HashSet<(i64, String)>,

    presence: HashMap<i64, Presence>,
    presence_ready: bool,
    chat_online: HashMap<i64, (i64, i64)>,
    typing: HashMap<i64, Vec<Typer>>,
    last_typing_sent: Option<Instant>,
    watching: Option<i64>,
    focused: bool,
    unfocused_since: Option<Instant>,
    away: bool,

    feed: Feed,
    feed_chat: Option<i64>,
    anchor: Option<(f32, f32)>,
    force_offset: Option<f32>,

    upd_avail: Option<update::Info>,
    upd_modal: bool,
    upd_checking: bool,
    upd_progress: Option<f32>,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>, rt: tokio::runtime::Runtime) -> Self {
        let ctx = cc.egui_ctx.clone();
        egui_extras::install_image_loaders(&ctx);
        theme::install_fonts(&ctx);
        ctx.set_visuals_of(egui::Theme::Light, theme::visuals(&Pal::light()));
        ctx.set_visuals_of(egui::Theme::Dark, theme::visuals(&Pal::dark()));
        ctx.set_theme(egui::ThemePreference::System);
        ctx.global_style_mut(|s| {
            s.spacing.item_spacing = vec2(8.0, 6.0);
            s.spacing.button_padding = vec2(14.0, 8.0);
        });

        let (tx, rx) = mpsc::channel();
        let net = Net { rt: rt.handle().clone(), http: reqwest::Client::new(), tx, ctx };
        let prefs = store::load_prefs();
        let mut app = App {
            _rt: rt,
            net,
            rx,
            ws_out: None,
            ws_stop: None,
            ws_online: false,
            screen: Screen::Login,
            server: prefs.server,
            username: prefs.username,
            password: String::new(),
            login_busy: false,
            login_err: String::new(),
            session: None,
            chats: vec![],
            chats_loaded: false,
            selected: None,
            msgs: HashMap::new(),
            loading: HashSet::new(),
            has_more: HashMap::new(),
            loading_more: HashSet::new(),
            search: String::new(),
            input: String::new(),
            prev_input: String::new(),
            focus_input: false,
            toast: None,
            seq: 0,
            applied: HashSet::new(),
            presence: HashMap::new(),
            presence_ready: false,
            chat_online: HashMap::new(),
            typing: HashMap::new(),
            last_typing_sent: None,
            watching: None,
            focused: true,
            unfocused_since: None,
            away: false,
            feed: Feed::default(),
            feed_chat: None,
            anchor: None,
            force_offset: None,
            upd_avail: None,
            upd_modal: false,
            upd_checking: false,
            upd_progress: None,
        };
        if let Some(s) = store::load_session() {
            app.enter(s);
        }
        app
    }

    fn me(&self) -> i64 {
        self.session.as_ref().map_or(0, |s| s.user_id)
    }

    fn enter(&mut self, s: Session) {
        let (out, stop) = self.net.start_ws(&s);
        self.ws_out = Some(out);
        self.ws_stop = Some(stop);
        self.net.fetch_chats(&s);
        self.net.fetch_presence(&s);
        self.net.check_update(true);
        self.session = Some(s);
        self.screen = Screen::Main;
    }

    fn logout(&mut self, why: &str) {
        if let Some(stop) = self.ws_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        self.ws_out = None;
        self.ws_online = false;
        store::clear_session();
        self.session = None;
        self.chats.clear();
        self.chats_loaded = false;
        self.selected = None;
        self.msgs.clear();
        self.loading.clear();
        self.has_more.clear();
        self.loading_more.clear();
        self.presence.clear();
        self.presence_ready = false;
        self.typing.clear();
        self.watching = None;
        self.password.clear();
        self.login_busy = false;
        self.login_err = why.to_string();
        self.screen = Screen::Login;
    }

    fn say(&mut self, text: impl Into<String>) {
        self.toast = Some((text.into(), Instant::now()));
    }

    fn ws_send(&self, v: serde_json::Value) {
        if let Some(out) = &self.ws_out {
            let _ = out.send(v.to_string());
        }
    }

    fn set_status(&mut self, status: &str) {
        self.away = status == "away";
        self.ws_send(serde_json::json!({ "type": "set_status", "status": status }));
    }

    fn sort_chats(&mut self) {
        self.chats.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.last_ts().cmp(&a.last_ts())));
    }

    fn select(&mut self, id: i64) {
        if self.watching.is_some() && self.watching != Some(id) {
            self.ws_send(serde_json::json!({ "type": "unwatch_chat" }));
        }
        self.ws_send(serde_json::json!({ "type": "watch_chat", "chat_id": id }));
        self.watching = Some(id);
        self.selected = Some(id);
        self.focus_input = true;
        let had_unread = self.chats.iter().find(|c| c.id == id).map_or(false, |c| c.unread > 0);
        if let Some(c) = self.chats.iter_mut().find(|c| c.id == id) {
            c.unread = 0;
        }
        if had_unread {
            self.ws_send(serde_json::json!({ "type": "read", "chat_id": id }));
        }
        if !self.msgs.contains_key(&id) && !self.loading.contains(&id) {
            if let Some(s) = &self.session {
                self.loading.insert(id);
                self.net.fetch_history(s, id, None);
            }
        }
    }

    /// Кто сейчас печатает в чате (без устаревших записей: 5 секунд без обновления).
    fn typers(&self, chat_id: i64) -> Vec<(String, bool)> {
        self.typing
            .get(&chat_id)
            .map(|v| v.iter().filter(|t| t.at.elapsed() < Duration::from_secs(5)).map(|t| (t.name.clone(), t.voice)).collect())
            .unwrap_or_default()
    }

    fn drain_events(&mut self) {
        while let Ok(ev) = self.rx.try_recv() {
            match ev {
                Event::LoggedIn(s) => {
                    store::save_session(&s);
                    store::save_prefs(&store::Prefs { server: self.server.clone(), username: self.username.clone() });
                    self.login_busy = false;
                    self.login_err.clear();
                    self.password.clear();
                    self.enter(s);
                }
                Event::LoginFailed(e) => {
                    self.login_busy = false;
                    self.login_err = e;
                }
                Event::Chats(v) => {
                    self.chats = v;
                    self.chats_loaded = true;
                    self.sort_chats();
                }
                Event::History { chat_id, msgs, has_more } => {
                    self.loading.remove(&chat_id);
                    let mut all = msgs;
                    if let Some(old) = self.msgs.get(&chat_id) {
                        all.extend(old.iter().filter(|m| m.pending).cloned());
                    }
                    self.msgs.insert(chat_id, all);
                    self.has_more.insert(chat_id, has_more);
                }
                Event::Older { chat_id, msgs, has_more } => {
                    self.loading_more.remove(&chat_id);
                    self.has_more.insert(chat_id, has_more);
                    if let Some(list) = self.msgs.get_mut(&chat_id) {
                        let known: HashSet<i64> = list.iter().map(|m| m.id).collect();
                        let fresh: Vec<Msg> = msgs.into_iter().filter(|m| !known.contains(&m.id)).collect();
                        if !fresh.is_empty() {
                            list.splice(0..0, fresh);
                            if self.selected == Some(chat_id) {
                                self.anchor = Some((self.feed.content_h, self.feed.offset));
                            }
                        }
                    }
                }
                Event::Message(m) => self.on_message(m),
                Event::Rejected { chat_id, reason } => {
                    if let Some(list) = self.msgs.get_mut(&chat_id) {
                        list.retain(|m| !m.pending);
                    }
                    let text = match reason.as_str() {
                        "read_only" => "В этот чат нельзя писать",
                        "blocked" | "you_blocked" => "Отправка заблокирована",
                        "limit" => "Достигнут лимит сообщений",
                        "maintenance" => "Сервер на обслуживании",
                        _ => "Сообщение не отправлено",
                    };
                    self.say(text);
                }
                Event::Status { chat_id, id, status } => {
                    if let Some(m) = self.msgs.get_mut(&chat_id).and_then(|l| l.iter_mut().find(|m| m.id == id)) {
                        m.status = Some(status);
                    }
                    if let Some(l) = self.chats.iter_mut().find(|c| c.id == chat_id).and_then(|c| c.last.as_mut()) {
                        if l.id == id {
                            l.status = Some(status);
                        }
                    }
                }
                Event::StatusRange { chat_id, kind, min, max, reader } => {
                    let me = self.me();
                    let key = format!("{kind}:{reader}");
                    let applied = &mut self.applied;
                    let mut bump = |m: &mut Msg| {
                        if m.sender_id != me || m.id < min || m.id > max {
                            return;
                        }
                        let Some(st) = m.status.as_mut() else { return };
                        if !applied.insert((m.id, key.clone())) {
                            return;
                        }
                        if kind == "read" {
                            st.read = (st.read + 1).min(st.total);
                            st.delivered = st.delivered.max(st.read);
                        } else {
                            st.delivered = (st.delivered + 1).min(st.total);
                        }
                    };
                    if let Some(list) = self.msgs.get_mut(&chat_id) {
                        list.iter_mut().for_each(&mut bump);
                    }
                    if let Some(l) = self.chats.iter_mut().find(|c| c.id == chat_id).and_then(|c| c.last.as_mut()) {
                        bump(l);
                    }
                }
                Event::PresenceAll(map) => {
                    self.presence = map;
                    self.presence_ready = true;
                }
                Event::PresenceOne { user_id, p } => {
                    self.presence.insert(user_id, p);
                }
                Event::PresenceRefresh => {
                    if let Some(s) = &self.session {
                        self.net.fetch_presence(s);
                    }
                }
                Event::Typing { chat_id, user_id, name, voice } => {
                    if user_id != self.me() {
                        let list = self.typing.entry(chat_id).or_default();
                        list.retain(|t| t.user_id != user_id && t.at.elapsed() < Duration::from_secs(5));
                        list.push(Typer { user_id, name, voice, at: Instant::now() });
                    }
                }
                Event::ChatOnline { chat_id, online, total } => {
                    self.chat_online.insert(chat_id, (online, total));
                }
                Event::WsState(b) => {
                    self.ws_online = b;
                    if b {
                        let st = if self.focused { "online" } else { "away" };
                        self.set_status(st);
                        if let Some(s) = &self.session {
                            self.net.fetch_presence(s);
                        }
                        if let Some(id) = self.selected {
                            self.ws_send(serde_json::json!({ "type": "watch_chat", "chat_id": id }));
                        }
                    }
                }
                Event::ReloadChats => {
                    if let Some(s) = &self.session {
                        self.net.fetch_chats(s);
                    }
                }
                Event::Update(u) => match u {
                    update::Upd::Checked { silent, info, latest } => {
                        self.upd_checking = false;
                        match info {
                            Some(i) => {
                                self.upd_avail = Some(i);
                                if !silent {
                                    self.upd_modal = true;
                                }
                            }
                            None => {
                                self.upd_avail = None;
                                if !silent {
                                    self.say(format!("Установлена последняя сборка ({})", update::short(&latest)));
                                }
                            }
                        }
                    }
                    update::Upd::Progress(p) => self.upd_progress = Some(p),
                    update::Upd::Restarting => self.net.ctx.send_viewport_cmd(egui::ViewportCommand::Close),
                    update::Upd::Failed(e) => {
                        self.upd_checking = false;
                        self.upd_progress = None;
                        self.say(e);
                    }
                },
                Event::AuthExpired => self.logout("Сессия истекла — войдите снова"),
                Event::Error(e) => self.say(e),
            }
        }
    }

    fn on_message(&mut self, m: Msg) {
        let me = self.me();
        let cid = m.chat_id;
        // Подтверждаем доставку чужого сообщения, а в открытом чате — и прочтение
        if m.sender_id != me && m.id > 0 {
            self.ws_send(serde_json::json!({ "type": "delivered", "message_id": m.id }));
            if self.selected == Some(cid) {
                self.ws_send(serde_json::json!({ "type": "read", "chat_id": cid }));
            }
        }
        if let Some(list) = self.typing.get_mut(&cid) {
            list.retain(|t| t.user_id != m.sender_id);
        }
        if let Some(list) = self.msgs.get_mut(&cid) {
            if !m.client_id.is_empty() {
                if let Some(p) = list.iter_mut().find(|x| x.pending && x.client_id == m.client_id) {
                    *p = m.clone();
                } else if !list.iter().any(|x| x.id == m.id) {
                    list.push(m.clone());
                }
            } else if let Some(x) = list.iter_mut().find(|x| x.id == m.id) {
                *x = m.clone();
            } else {
                list.push(m.clone());
            }
        }
        match self.chats.iter_mut().find(|c| c.id == cid) {
            Some(c) => {
                if c.last.as_ref().map_or(true, |l| m.sent_at >= l.sent_at) {
                    c.last = Some(m.clone());
                }
                if m.sender_id != me && self.selected != Some(cid) {
                    c.unread += 1;
                }
                self.sort_chats();
            }
            None => {
                if let Some(s) = &self.session {
                    self.net.fetch_chats(s);
                }
            }
        }
    }

    fn send(&mut self) {
        let text = self.input.trim().to_string();
        let (Some(cid), false) = (self.selected, text.is_empty()) else { return };
        if !self.ws_online {
            return self.say("Нет соединения с сервером");
        }
        self.seq += 1;
        let client_id = format!("n{}-{}", Local::now().timestamp_millis(), self.seq);
        let me = self.me();
        let name = self.session.as_ref().map(|s| s.name.clone()).unwrap_or_default();
        if let Some(list) = self.msgs.get_mut(&cid) {
            list.push(Msg {
                id: -self.seq,
                chat_id: cid,
                text: text.clone(),
                sent_at: Local::now().timestamp(),
                sender_id: me,
                sender_name: name,
                client_id: client_id.clone(),
                pending: true,
                ..Default::default()
            });
        }
        self.ws_send(serde_json::json!({ "type": "message", "chat_id": cid, "text": text, "client_id": client_id }));
        self.input.clear();
        self.prev_input.clear();
        self.focus_input = true;
        self.force_offset = Some(1.0e9);
    }
}

fn pal_for(ctx: &egui::Context) -> Pal {
    if ctx.global_style().visuals.dark_mode { Pal::dark() } else { Pal::light() }
}

// ───────────────────────────── интерфейс ─────────────────────────────

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();
        // Присутствие: в фокусе — online, без фокуса 5 секунд — away
        let focused = ctx.input(|i| i.viewport().focused.unwrap_or(true));
        if focused != self.focused {
            self.focused = focused;
            if focused {
                self.unfocused_since = None;
                if self.away && self.ws_online {
                    self.set_status("online");
                }
            } else {
                self.unfocused_since = Some(Instant::now());
            }
        }
        if let Some(t) = self.unfocused_since {
            if !self.away && self.ws_online {
                if t.elapsed() >= Duration::from_secs(5) {
                    self.set_status("away");
                } else {
                    ctx.request_repaint_after(Duration::from_millis(600));
                }
            }
        }
    }

    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        let pal = pal_for(&ctx);
        if self.typing.values().any(|v| !v.is_empty()) {
            ctx.request_repaint_after(Duration::from_millis(400));
        }
        match self.screen {
            Screen::Login => self.login_ui(ui, &pal),
            Screen::Main => self.main_ui(ui, &pal),
        }
        self.update_modal(&ctx, &pal);
        self.toast_ui(&ctx, &pal);
    }
}

impl App {
    fn login_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        egui::CentralPanel::default().frame(egui::Frame::new().fill(pal.app_bg)).show(ui, |ui| {
            let h = ui.available_height();
            ui.vertical_centered(|ui| {
                ui.add_space(((h - 430.0) / 2.0).max(16.0));
                egui::Frame::new().fill(pal.side_bg).corner_radius(22).inner_margin(Margin::same(28)).show(ui, |ui| {
                    ui.set_width(344.0);
                    ui.vertical(|ui| {
                        ui.label(RichText::new("Вход").font(FontId::new(26.0, bold())).color(pal.text));
                        ui.label(RichText::new("Войдите в свой аккаунт").size(14.0).color(pal.text2));
                        ui.add_space(14.0);
                        let mut submit = false;
                        let field = |ui: &mut Ui, text: &mut String, hint: &str, pw: bool| {
                            ui.add(
                                TextEdit::singleline(text)
                                    .hint_text(hint)
                                    .password(pw)
                                    .desired_width(f32::INFINITY)
                                    .margin(vec2(14.0, 11.0))
                                    .font(FontId::proportional(15.0)),
                            )
                        };
                        field(ui, &mut self.server, "Сервер, например chat.example.com", false);
                        field(ui, &mut self.username, "Логин", false);
                        let r = field(ui, &mut self.password, "Пароль", true);
                        if r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
                            submit = true;
                        }
                        if !self.login_err.is_empty() {
                            ui.label(RichText::new(&self.login_err).size(13.5).color(pal.danger));
                        }
                        ui.add_space(6.0);
                        let ready = !self.login_busy
                            && !self.server.trim().is_empty()
                            && !self.username.trim().is_empty()
                            && !self.password.is_empty();
                        let label = if self.login_busy { "Входим…" } else { "Войти" };
                        let btn = egui::Button::new(RichText::new(label).font(FontId::new(15.0, bold())).color(Color32::WHITE))
                            .fill(if ready { pal.accent_fill } else { alpha(pal.accent_fill, 110) })
                            .corner_radius(12)
                            .min_size(vec2(ui.available_width(), 44.0));
                        if ui.add_enabled(ready, btn).clicked() {
                            submit = true;
                        }
                        if submit && ready {
                            self.login_busy = true;
                            self.login_err.clear();
                            self.net.login(self.server.clone(), self.username.trim().to_string(), self.password.clone());
                        }
                    });
                });
            });
        });
    }

    fn main_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        egui::Panel::left("side")
            .exact_size(388.0)
            .resizable(false)
            .frame(egui::Frame::new().fill(pal.app_bg).inner_margin(Margin { left: 12, right: 0, top: 12, bottom: 12 }))
            .show(ui, |ui| self.sidebar_ui(ui, pal));
        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(pal.app_bg).inner_margin(Margin { left: 10, right: 12, top: 12, bottom: 12 }))
            .show(ui, |ui| self.chat_ui(ui, pal));
    }

    fn sidebar_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        let outer_h = ui.available_height();
        let outer_w = ui.available_width();
        egui::Frame::new().fill(pal.side_bg).corner_radius(22).inner_margin(Margin::same(10)).show(ui, |ui| {
            ui.set_min_size(vec2(outer_w - 20.0, outer_h - 20.0));
            ui.set_max_width(outer_w - 20.0);
            // Шапка сайдбара: высота 56 (с отступом карточки), название клиента слева с отступом 16
            let (hr, _) = ui.allocate_exact_size(vec2(ui.available_width(), 46.0), Sense::hover());
            let wm = view::wordmark(ui.painter(), pal);
            ui.painter().galley(pos2(hr.left() + 6.0, hr.center().y - wm.size().y / 2.0), wm, pal.text);
            ui.add(
                TextEdit::singleline(&mut self.search)
                    .hint_text("Поиск")
                    .desired_width(f32::INFINITY)
                    .margin(vec2(14.0, 9.0)),
            );
            ui.add_space(6.0);

            let me = self.me();
            let server = self.session.as_ref().map(|s| s.server.clone()).unwrap_or_default();
            let q = self.search.trim().to_lowercase();
            let list_h = ui.available_height() - 60.0;
            let mut clicked = None;
            egui::ScrollArea::vertical().auto_shrink([false, false]).max_height(list_h).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                if !self.chats_loaded {
                    ui.add_space(16.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
                }
                for c in &self.chats {
                    if !q.is_empty() && !c.title(me).to_lowercase().contains(&q) {
                        continue;
                    }
                    let typers = self.typers(c.id);
                    let typing = (!typers.is_empty()).then(|| typing_label(&typers, c.kind != "direct"));
                    let presence = c.peer(me).and_then(|m| self.presence.get(&m.id));
                    let row = Row { c, me, server: &server, active: self.selected == Some(c.id), typing, presence };
                    if chat_row(ui, pal, &row) {
                        clicked = Some(c.id);
                    }
                }
                if self.chats_loaded && self.chats.is_empty() {
                    ui.add_space(16.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("Чатов пока нет").color(pal.muted)));
                }
            });
            if let Some(id) = clicked {
                self.select(id);
            }

            // Нижняя строка: пользователь и выход
            ui.add_space(4.0);
            let name = self.session.as_ref().map(|s| s.name.clone()).unwrap_or_default();
            let mut out = false;
            let mut upd_click = false;
            let (upd_avail, upd_busy) = (self.upd_avail.is_some(), self.upd_checking || self.upd_progress.is_some());
            ui.horizontal(|ui| {
                let (r, _) = ui.allocate_exact_size(vec2(40.0, 40.0), Sense::hover());
                draw_avatar(ui, r, &server, Some(me), &name, me);
                ui.vertical(|ui| {
                    ui.add_space(2.0);
                    ui.label(RichText::new(&name).font(FontId::new(14.5, bold())).color(pal.text));
                    let (dot, txt) = if self.ws_online { (pal.accent, "в сети") } else { (pal.muted, "подключение…") };
                    ui.label(RichText::new(txt).size(12.0).color(dot));
                });
                ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
                    let b = egui::Button::new(RichText::new("Выйти").size(13.5).color(pal.text2))
                        .fill(pal.surf2)
                        .corner_radius(12);
                    out = ui.add(b).clicked();
                    // Кнопка «проверить обновление»: круговая стрелка, точка — если есть новая сборка
                    let (r, resp) = ui.allocate_exact_size(vec2(34.0, 34.0), Sense::click());
                    let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text(if upd_avail {
                        "Доступно обновление"
                    } else {
                        "Проверить обновления"
                    });
                    let p = ui.painter();
                    p.rect_filled(r, 12, if resp.hovered() { pal.hover2 } else { pal.surf2 });
                    let col = if upd_busy { pal.muted } else { pal.text2 };
                    let c = r.center();
                    let pts: Vec<egui::Pos2> = (0..=22)
                        .map(|i| {
                            let a = (50.0 + i as f32 / 22.0 * 270.0).to_radians();
                            pos2(c.x + 6.5 * a.cos(), c.y - 6.5 * a.sin())
                        })
                        .collect();
                    let end = pts[pts.len() - 1];
                    p.add(egui::Shape::line(pts, Stroke::new(1.8, col)));
                    p.line_segment([end, pos2(end.x + 4.5, end.y - 0.5)], Stroke::new(1.8, col));
                    p.line_segment([end, pos2(end.x + 0.5, end.y + 4.5)], Stroke::new(1.8, col));
                    if upd_avail {
                        p.circle_filled(pos2(r.right() - 4.0, r.top() + 4.0), 4.5, pal.accent);
                        p.circle_stroke(pos2(r.right() - 4.0, r.top() + 4.0), 4.5, Stroke::new(1.5, pal.side_bg));
                    }
                    upd_click = resp.clicked();
                });
            });
            if out {
                self.logout("");
            }
            if upd_click {
                if self.upd_avail.is_some() {
                    self.upd_modal = true;
                } else if !self.upd_checking {
                    self.upd_checking = true;
                    self.net.check_update(false);
                }
            }
        });
    }

    fn chat_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        let full = ui.available_rect_before_wrap();
        ui.painter().rect_filled(full, 22, pal.chat_bg);
        let Some(cid) = self.selected else {
            ui.painter().text(
                full.center(),
                Align2::CENTER_CENTER,
                "Выберите чат, чтобы начать общение",
                FontId::proportional(16.0),
                pal.muted,
            );
            return;
        };
        let Some(chat) = self.chats.iter().find(|c| c.id == cid).cloned() else { return };
        let me = self.me();
        let server = self.session.as_ref().map(|s| s.server.clone()).unwrap_or_default();
        if self.feed_chat != Some(cid) {
            self.feed = Feed::default();
            self.feed_chat = Some(cid);
            self.anchor = None;
            self.force_offset = None;
        }

        // ── Шапка: .chat-header, высота 68, padding 0 14 0 10, радиус 22 22 0 0 ──
        let head = Rect::from_min_size(full.min, vec2(full.width(), 68.0));
        ui.painter().rect_filled(head, CornerRadius { nw: 22, ne: 22, sw: 0, se: 0 }, pal.side_bg);
        let title = chat.title(me);
        let peer = chat.peer(me).map(|m| m.id);
        let pr = peer.and_then(|id| self.presence.get(&id)).cloned();
        let av = Rect::from_min_size(pos2(head.left() + 16.0, head.center().y - 22.0), vec2(44.0, 44.0));
        draw_avatar(ui, av, &server, peer, &title, peer.unwrap_or(chat.id));
        if peer.is_some() {
            presence_dot(ui.painter(), av, pr.as_ref(), pal, pal.chat_bg);
        }
        let tx = av.right() + 12.0;
        let typers = self.typers(cid);
        let name_g = view::elided(ui.painter(), &title, FontId::new(16.0, bold()), pal.text, head.right() - tx - 20.0);
        ui.painter().galley(pos2(tx, head.center().y - 19.0), name_g, pal.text);
        let sub_y = head.center().y + 2.0;
        if !typers.is_empty() {
            let t = typing_label(&typers, chat.kind != "direct");
            ui.painter().text(pos2(tx, sub_y), Align2::LEFT_TOP, t, FontId::proportional(11.0), pal.accent);
        } else if chat.kind == "direct" {
            let (text, online) = match &pr {
                Some(p) if p.status == "online" => ("Онлайн".to_string(), true),
                Some(p) if p.status == "away" => ("Отошёл".to_string(), false),
                Some(p) => (view::last_seen_text(p.last_seen), false),
                None if self.presence_ready => ("Был давно".to_string(), false),
                None => (String::new(), false),
            };
            let mut sx = tx;
            if online {
                ui.painter().circle_filled(pos2(tx + 3.5, sub_y + 8.0), 3.5, pal.online);
                sx += 13.0;
            }
            ui.painter().text(pos2(sx, sub_y), Align2::LEFT_TOP, text, FontId::proportional(12.5), pal.text2);
        } else {
            let t = match self.chat_online.get(&cid) {
                Some((o, total)) => format!("в сети {o} из {total}"),
                None => plural(chat.members.len(), "участник", "участника", "участников"),
            };
            ui.painter().text(pos2(tx, sub_y), Align2::LEFT_TOP, t, FontId::proportional(12.5), pal.text2);
        }

        // ── Полоса ввода: padding 10 14 14, радиус 0 0 22 22; поле min-height 48, радиус 12, кнопка 48×48 ──
        // Все прямоугольники заданы явно: раскладка «снизу вверх» обрезала поле по нижнему краю.
        let body = Rect::from_min_max(pos2(full.min.x, head.max.y), full.max);
        let bottom_r = CornerRadius { nw: 0, ne: 0, sw: 22, se: 22 };
        let (gap, btn) = (8.0f32, 48.0f32);
        let mut do_send = false;
        let id = Id::new("composer");
        let band_top: f32;
        if !chat.read_only {
            // высота поля — по числу строк текста (до 120 px), минимум 48
            let font = FontId::proportional(15.0);
            let text_w = (body.width() - 28.0 - btn - gap - 26.0).max(60.0);
            let sample = if self.input.is_empty() || self.input.ends_with('\n') { format!("{} ", self.input) } else { self.input.clone() };
            let text_h = ui.painter().layout(sample, font.clone(), pal.text, text_w).size().y.clamp(18.0, 120.0);
            let field_h = (text_h + 28.0).max(48.0);
            let band = Rect::from_min_max(pos2(body.left(), body.bottom() - (10.0 + field_h + 14.0)), body.max);
            band_top = band.top();
            ui.painter().rect_filled(band, bottom_r, pal.side_bg);
            let field = Rect::from_min_size(pos2(band.left() + 14.0, band.top() + 10.0), vec2(body.width() - 28.0 - btn - gap, field_h));
            ui.painter().rect_filled(field, 12, pal.surf2);

            let enter = ui.memory(|m| m.has_focus(id)) && ui.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter));
            if enter {
                do_send = true;
            }
            let text_rect = Rect::from_min_max(pos2(field.left() + 20.0, field.top()), pos2(field.right() - 6.0, field.bottom()));
            let mut fui = ui.new_child(egui::UiBuilder::new().max_rect(text_rect).layout(egui::Layout::top_down(Align::Min)));
            fui.set_clip_rect(field);
            egui::ScrollArea::vertical().id_salt("composer_scroll").auto_shrink([false, false]).show(&mut fui, |ui| {
                ui.add(
                    TextEdit::multiline(&mut self.input)
                        .id(id)
                        .hint_text(RichText::new("Сообщение").color(pal.muted))
                        .desired_rows(1)
                        .desired_width(f32::INFINITY)
                        .frame(egui::Frame::NONE.inner_margin(Margin::symmetric(0, 14)))
                        .font(font),
                );
            });

            // Кнопка отправки: у нижнего края поля
            let r = Rect::from_min_size(pos2(band.right() - 14.0 - btn, band.bottom() - 14.0 - btn), vec2(btn, btn));
            let resp = ui.interact(r, Id::new("send_btn"), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
            let ready = !self.input.trim().is_empty();
            let p = ui.painter();
            p.rect_filled(r, 12, if ready { pal.accent_fill } else if resp.hovered() { pal.hover2 } else { pal.surf2 });
            let c = r.center();
            let st = Stroke::new(2.2, if ready { Color32::WHITE } else { pal.text2 });
            p.line_segment([pos2(c.x, c.y + 7.0), pos2(c.x, c.y - 7.0)], st);
            p.line_segment([pos2(c.x, c.y - 7.0), pos2(c.x - 6.0, c.y - 1.0)], st);
            p.line_segment([pos2(c.x, c.y - 7.0), pos2(c.x + 6.0, c.y - 1.0)], st);
            if resp.clicked() {
                do_send = true;
            }
            if self.focus_input {
                ui.memory_mut(|m| m.request_focus(id));
                self.focus_input = false;
            }
            // Событие набора текста: при вводе, не чаще раза в 2 секунды
            if self.input != self.prev_input {
                if !self.input.is_empty() && self.last_typing_sent.map_or(true, |t| t.elapsed() >= Duration::from_secs(2)) {
                    self.ws_send(serde_json::json!({ "type": "typing", "chat_id": cid }));
                    self.last_typing_sent = Some(Instant::now());
                }
                self.prev_input = self.input.clone();
            }
        } else {
            let band = Rect::from_min_max(pos2(body.left(), body.bottom() - 72.0), body.max);
            band_top = band.top();
            ui.painter().rect_filled(band, bottom_r, pal.side_bg);
            let field = Rect::from_min_size(pos2(band.left() + 14.0, band.top() + 10.0), vec2(body.width() - 28.0, 48.0));
            ui.painter().rect_filled(field, 12, pal.surf2);
            ui.painter().text(field.center(), Align2::CENTER_CENTER, "В этот чат нельзя писать", FontId::proportional(13.5), pal.text2);
        }

        // ── Лента: область между шапкой и полосой ввода ──
        let feed_rect = Rect::from_min_max(body.min, pos2(body.right(), band_top));
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(feed_rect).layout(egui::Layout::top_down(Align::Min)));
        child.set_clip_rect(feed_rect);

        let loading = self.loading.contains(&cid);
        let force = self.force_offset.take();
        let group = chat.kind != "direct";
        let cx = MsgCx { server: &server, me, group };
        let list: &[Msg] = self.msgs.get(&cid).map(|v| v.as_slice()).unwrap_or(&[]);
        let out = child
            .with_layout(egui::Layout::top_down(Align::Min), |ui| {
                let mut sa = egui::ScrollArea::vertical().id_salt(("feed", cid)).auto_shrink([false, false]).stick_to_bottom(true);
                if let Some(f) = force {
                    sa = sa.vertical_scroll_offset(f);
                }
                sa.show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 0.0;
                    ui.add_space(20.0);
                    if loading {
                        ui.add_space(24.0);
                        ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
                    } else if list.is_empty() {
                        ui.add_space(24.0);
                        ui.vertical_centered(|ui| ui.label(RichText::new("Сообщений пока нет").color(pal.muted)));
                    }
                    for (i, m) in list.iter().enumerate() {
                        let prev = if i > 0 { list.get(i - 1) } else { None };
                        let next = list.get(i + 1);
                        if prev.map_or(true, |p| day_of(p.sent_at) != day_of(m.sent_at)) {
                            day_pill(ui, pal, &day_label(m.sent_at));
                        }
                        let same = |a: &Msg, b: &Msg| {
                            a.sender_id == b.sender_id && !a.system && !b.system && (b.sent_at - a.sent_at).abs() < 300
                                && day_of(a.sent_at) == day_of(b.sent_at)
                        };
                        let first = prev.map_or(true, |p| !same(p, m));
                        let last = next.map_or(true, |n| !same(m, n));
                        draw_msg(ui, pal, m, first, last, group && first, &cx);
                    }
                    ui.add_space(20.0);
                })
            })
            .inner;
        let (off, ch, vh) = (out.state.offset().y, out.content_size.y, out.inner_rect.height());
        if let Some((ph, po)) = self.anchor {
            if ch > ph + 1.0 {
                // После подгрузки сверху сохраняем положение прокрутки
                self.force_offset = Some(po + (ch - ph));
                self.anchor = None;
                ui.ctx().request_repaint();
            }
        }
        self.feed = Feed { offset: off, content_h: ch, view_h: vh };

        // Подгрузка ранних сообщений при приближении к верху (порог max(1400, 2 высоты окна))
        if !loading
            && ch > 0.0
            && self.anchor.is_none()
            && self.has_more.get(&cid).copied().unwrap_or(false)
            && !self.loading_more.contains(&cid)
            && off < 1400.0f32.max(vh * 2.0)
        {
            let before = self.msgs.get(&cid).and_then(|l| l.iter().filter(|m| m.id > 0).map(|m| m.id).min());
            if let (Some(b), Some(s)) = (before, &self.session) {
                self.loading_more.insert(cid);
                self.net.fetch_history(s, cid, Some(b));
            }
        }

        // «печатает…» над полосой ввода: .typing-pill 28 px, радиус 10
        if !typers.is_empty() {
            let t = typing_label(&typers, true);
            let p = ui.painter().clone();
            let g = p.layout_no_wrap(t, FontId::proportional(12.0), pal.muted);
            let w = g.size().x + 24.0 + 20.0;
            let r = Rect::from_min_size(pos2(body.left() + 18.0, band_top - 6.0 - 28.0), vec2(w, 28.0));
            p.rect_filled(r, 10, pal.chip);
            p.galley(pos2(r.left() + 12.0, r.center().y - g.size().y / 2.0), g.clone(), pal.muted);
            let time = ui.input(|i| i.time) as f32;
            for k in 0..3 {
                let phase = ((time * 5.0 - k as f32 * 0.8).sin() * 0.5 + 0.5).powi(2);
                let cx = r.left() + 12.0 + g.size().x + 8.0 + k as f32 * 6.0;
                p.circle_filled(pos2(cx, r.center().y + 2.0 - phase * 3.0), 1.5, pal.muted);
            }
        }

        // Кнопка «к последнему сообщению»: 44×44, радиус 12, right 20, bottom 14 над полосой ввода
        let dist = ch - vh - off;
        if ch > 0.0 && dist > 200.0 {
            let r = Rect::from_min_size(pos2(full.right() - 20.0 - 44.0, band_top - 14.0 - 44.0), vec2(44.0, 44.0));
            let resp = ui.interact(r, Id::new("scroll_bottom"), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
            let p = ui.painter().clone();
            p.rect_filled(r.translate(vec2(0.0, 2.0)).expand(1.0), 13, Color32::from_black_alpha(if pal.dark { 80 } else { 22 }));
            p.rect_filled(r, 12, if resp.hovered() { pal.hover2 } else { pal.side_bg });
            let c = r.center();
            let st = Stroke::new(2.5, if resp.hovered() { pal.text } else { pal.text2 });
            p.line_segment([pos2(c.x - 6.0, c.y - 3.0), pos2(c.x, c.y + 3.0)], st);
            p.line_segment([pos2(c.x, c.y + 3.0), pos2(c.x + 6.0, c.y - 3.0)], st);
            if chat.unread > 0 {
                let label = if chat.unread > 99 { "99+".to_string() } else { chat.unread.to_string() };
                let g = p.layout_no_wrap(label, FontId::new(11.0, bold()), Color32::WHITE);
                let bw = (g.size().x + 12.0).max(20.0);
                let br = Rect::from_min_size(pos2(r.right() + 4.0 - bw, r.top() - 7.0), vec2(bw, 20.0));
                p.rect_filled(br, 10, pal.accent_fill);
                p.galley(br.center() - g.size() / 2.0, g, Color32::WHITE);
            }
            if resp.clicked() {
                self.force_offset = Some(1.0e9);
                ui.ctx().request_repaint();
            }
        }

        if do_send {
            self.send();
        }
        let _ = alpha;
    }

    /// Окно «Доступно обновление»: установка и ход загрузки.
    fn update_modal(&mut self, ctx: &egui::Context, pal: &Pal) {
        if !self.upd_modal {
            return;
        }
        let Some(info) = self.upd_avail.clone() else {
            self.upd_modal = false;
            return;
        };
        let (mut install, mut close) = (false, false);
        let progress = self.upd_progress;
        let resp = egui::Modal::new(Id::new("upd_modal")).show(ctx, |ui| {
            ui.set_width(360.0);
            ui.label(RichText::new("Доступно обновление").font(FontId::new(18.0, bold())).color(pal.text));
            ui.add_space(6.0);
            let mb = info.size as f64 / (1u64 << 20) as f64;
            ui.label(
                RichText::new(format!("Сборка {} ({}), {:.1} МБ. После установки приложение перезапустится.", info.build, update::short(&info.sha), mb))
                    .size(14.0)
                    .color(pal.text2),
            );
            ui.label(
                RichText::new(format!("Сейчас установлена: {} ({})", update::current_build(), update::short(update::current_sha())))
                    .size(13.0)
                    .color(pal.muted),
            );
            ui.add_space(14.0);
            if let Some(p) = progress {
                ui.add(egui::ProgressBar::new(p).fill(pal.accent_fill).show_percentage());
            } else {
                ui.horizontal(|ui| {
                    let b = egui::Button::new(RichText::new("Установить").font(FontId::new(14.5, bold())).color(Color32::WHITE))
                        .fill(pal.accent_fill)
                        .corner_radius(12)
                        .min_size(vec2(140.0, 40.0));
                    install = ui.add(b).clicked();
                    let b = egui::Button::new(RichText::new("Позже").size(14.5).color(pal.text2))
                        .fill(pal.surf2)
                        .corner_radius(12)
                        .min_size(vec2(100.0, 40.0));
                    close = ui.add(b).clicked();
                });
            }
        });
        if progress.is_none() && (close || resp.should_close()) {
            self.upd_modal = false;
        }
        if install {
            self.upd_progress = Some(0.0);
            self.net.install_update(info);
        }
    }

    fn toast_ui(&mut self, ctx: &egui::Context, pal: &Pal) {
        let Some((text, at)) = self.toast.clone() else { return };
        if at.elapsed() > Duration::from_secs(4) {
            self.toast = None;
            return;
        }
        ctx.request_repaint_after(Duration::from_millis(500));
        egui::Area::new(Id::new("toast")).anchor(Align2::CENTER_BOTTOM, vec2(0.0, -24.0)).show(ctx, |ui| {
            egui::Frame::new().fill(pal.text).corner_radius(14).inner_margin(Margin::symmetric(16, 10)).show(ui, |ui| {
                ui.label(RichText::new(text).size(14.0).color(pal.side_bg));
            });
        });
    }
}
