//! Прототип нативного клиента на egui: вход, список чатов, лента, отправка.
//! Дизайн — «Мягкий» (flat) из client/src/flat.css.
mod model;
mod net;
mod store;
mod theme;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use chrono::{Datelike, Local, TimeZone};
use eframe::egui::{
    self, pos2, vec2, Align, Align2, Color32, CornerRadius, FontId, Id, Key, Margin, Modifiers, Rect,
    RichText, Sense, Shape, Stroke, TextEdit, Ui,
};
use model::{Chat, Msg};
use net::{Event, Net};
use store::Session;
use theme::{alpha, av_color, bold, Pal};

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
    search: String,
    input: String,
    focus_input: bool,
    toast: Option<(String, Instant)>,
    seq: i64,
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
            search: String::new(),
            input: String::new(),
            focus_input: false,
            toast: None,
            seq: 0,
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
        self.password.clear();
        self.login_busy = false;
        self.login_err = why.to_string();
        self.screen = Screen::Login;
    }

    fn say(&mut self, text: impl Into<String>) {
        self.toast = Some((text.into(), Instant::now()));
    }

    fn sort_chats(&mut self) {
        self.chats.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.last_ts().cmp(&a.last_ts())));
    }

    fn select(&mut self, id: i64) {
        self.selected = Some(id);
        self.focus_input = true;
        if let Some(c) = self.chats.iter_mut().find(|c| c.id == id) {
            c.unread = 0;
        }
        if !self.msgs.contains_key(&id) && !self.loading.contains(&id) {
            if let Some(s) = &self.session {
                self.loading.insert(id);
                self.net.fetch_history(s, id);
            }
        }
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
                Event::History { chat_id, msgs } => {
                    self.loading.remove(&chat_id);
                    let mut all = msgs;
                    if let Some(old) = self.msgs.get(&chat_id) {
                        all.extend(old.iter().filter(|m| m.pending).cloned());
                    }
                    self.msgs.insert(chat_id, all);
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
                Event::WsState(b) => self.ws_online = b,
                Event::ReloadChats => {
                    if let Some(s) = &self.session {
                        self.net.fetch_chats(s);
                    }
                }
                Event::AuthExpired => self.logout("Сессия истекла — войдите снова"),
                Event::Error(e) => self.say(e),
            }
        }
    }

    fn on_message(&mut self, m: Msg) {
        let me = self.me();
        let cid = m.chat_id;
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
        if let Some(out) = &self.ws_out {
            let _ = out.send(
                serde_json::json!({ "type": "message", "chat_id": cid, "text": text, "client_id": client_id }).to_string(),
            );
        }
        self.input.clear();
        self.focus_input = true;
    }
}

// ───────────────────────── вспомогательные функции ─────────────────────────

fn pal_for(ctx: &egui::Context) -> Pal {
    if ctx.global_style().visuals.dark_mode { Pal::dark() } else { Pal::light() }
}

fn fmt_time(ts: i64) -> String {
    Local.timestamp_opt(ts, 0).single().map(|d| d.format("%H:%M").to_string()).unwrap_or_default()
}

fn day_of(ts: i64) -> Option<chrono::NaiveDate> {
    Local.timestamp_opt(ts, 0).single().map(|d| d.date_naive())
}

const MONTHS: [&str; 12] = [
    "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS: [&str; 7] = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

fn day_label(ts: i64) -> String {
    let Some(d) = day_of(ts) else { return String::new() };
    let today = Local::now().date_naive();
    if d == today {
        "Сегодня".into()
    } else if Some(d) == today.pred_opt() {
        "Вчера".into()
    } else if d.year() == today.year() {
        format!("{} {}", d.day(), MONTHS[d.month0() as usize])
    } else {
        format!("{} {} {}", d.day(), MONTHS[d.month0() as usize], d.year())
    }
}

fn list_time(ts: i64) -> String {
    if ts == 0 {
        return String::new();
    }
    let Some(d) = day_of(ts) else { return String::new() };
    let today = Local::now().date_naive();
    let age = (today - d).num_days();
    if age == 0 {
        fmt_time(ts)
    } else if (1..7).contains(&age) {
        WEEKDAYS[d.weekday().num_days_from_monday() as usize].to_string()
    } else {
        format!("{:02}.{:02}.{:02}", d.day(), d.month(), d.year() % 100)
    }
}

fn plural(n: usize, one: &str, few: &str, many: &str) -> String {
    let w = if n % 100 >= 11 && n % 100 <= 14 {
        many
    } else {
        match n % 10 {
            1 => one,
            2..=4 => few,
            _ => many,
        }
    };
    format!("{n} {w}")
}

fn preview(c: &Chat, me: i64) -> String {
    let Some(m) = &c.last else { return "Нет сообщений".into() };
    let body = if m.deleted {
        "Сообщение удалено".to_string()
    } else if !m.text.trim().is_empty() {
        m.text.replace('\n', " ")
    } else if m.attach.is_some() {
        "Вложение".to_string()
    } else {
        String::new()
    };
    if m.sender_id == me {
        format!("Вы: {body}")
    } else if c.kind != "direct" && !m.sender_name.is_empty() {
        format!("{}: {}", m.sender_name, body)
    } else {
        body
    }
}

/// Однострочный текст с «…» вместо переноса.
fn elided(p: &egui::Painter, text: &str, font: FontId, color: Color32, width: f32) -> Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple(text.to_string(), font, color, width.max(8.0));
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    p.layout_job(job)
}

fn draw_avatar(ui: &mut Ui, rect: Rect, pal: &Pal, server: &str, user_id: Option<i64>, name: &str, key: i64) {
    if let Some(id) = user_id {
        let uri = format!("{server}/api/users/{id}/avatar");
        if let Ok(egui::load::TexturePoll::Ready { texture }) =
            ui.ctx().try_load_texture(&uri, egui::TextureOptions::LINEAR, egui::load::SizeHint::default())
        {
            let r = rect.size().x / 2.0;
            ui.put(
                rect,
                egui::Image::from_texture(texture)
                    .fit_to_exact_size(rect.size())
                    .corner_radius(CornerRadius::same(r as u8)),
            );
            return;
        }
    }
    let p = ui.painter();
    p.circle_filled(rect.center(), rect.size().x / 2.0, av_color(key));
    let letter = name.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_uppercase().to_string()).unwrap_or("?".into());
    p.text(
        rect.center(),
        Align2::CENTER_CENTER,
        letter,
        FontId::new(rect.size().x * 0.42, bold()),
        Color32::WHITE,
    );
    let _ = pal;
}

// ───────────────────────────── интерфейс ─────────────────────────────

impl eframe::App for App {
    fn logic(&mut self, _ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();
    }

    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        let pal = pal_for(&ctx);
        match self.screen {
            Screen::Login => self.login_ui(ui, &pal),
            Screen::Main => self.main_ui(ui, &pal),
        }
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
            .exact_size(344.0)
            .resizable(false)
            .frame(egui::Frame::new().fill(pal.app_bg).inner_margin(Margin { left: 12, right: 0, top: 12, bottom: 12 }))
            .show(ui, |ui| self.sidebar_ui(ui, pal));
        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(pal.app_bg).inner_margin(Margin::same(12)))
            .show(ui, |ui| self.chat_ui(ui, pal));
    }

    fn sidebar_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        let outer_h = ui.available_height();
        let outer_w = ui.available_width();
        egui::Frame::new().fill(pal.side_bg).corner_radius(22).inner_margin(Margin::same(10)).show(ui, |ui| {
            ui.set_min_size(vec2(outer_w - 20.0, outer_h - 20.0));
            ui.set_max_width(outer_w - 20.0);
            ui.add_space(2.0);
            ui.label(RichText::new("Чаты").font(FontId::new(22.0, bold())).color(pal.text));
            ui.add_space(4.0);
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
                ui.spacing_mut().item_spacing.y = 2.0;
                if !self.chats_loaded {
                    ui.add_space(16.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
                }
                for c in &self.chats {
                    if !q.is_empty() && !c.title(me).to_lowercase().contains(&q) {
                        continue;
                    }
                    if chat_row(ui, pal, c, me, &server, self.selected == Some(c.id)) {
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
            ui.horizontal(|ui| {
                let (r, _) = ui.allocate_exact_size(vec2(40.0, 40.0), Sense::hover());
                draw_avatar(ui, r, pal, &server, Some(me), &name, me);
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
                });
            });
            if out {
                self.logout("");
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
        let inner = full.shrink(12.0);

        // Шапка
        let head = Rect::from_min_size(inner.min, vec2(inner.width(), 64.0));
        ui.painter().rect_filled(head, 22, pal.side_bg);
        let title = chat.title(me);
        let peer = chat.peer(me).map(|m| m.id);
        let av = Rect::from_center_size(pos2(head.left() + 14.0 + 20.0, head.center().y), vec2(40.0, 40.0));
        draw_avatar(ui, av, pal, &server, peer, &title, peer.unwrap_or(chat.id));
        let tx = av.right() + 12.0;
        let sub = if chat.kind == "direct" {
            "личный чат".to_string()
        } else {
            plural(chat.members.len(), "участник", "участника", "участников")
        };
        let g = elided(ui.painter(), &title, FontId::new(16.0, bold()), pal.text, head.right() - tx - 20.0);
        ui.painter().galley(pos2(tx, head.center().y - 19.0), g, pal.text);
        ui.painter().text(pos2(tx, head.center().y + 9.0), Align2::LEFT_CENTER, sub, FontId::proportional(12.5), pal.text2);

        // Остальное — снизу вверх: поле ввода, затем лента
        let body = Rect::from_min_max(pos2(inner.min.x, head.max.y + 8.0), inner.max);
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body).layout(egui::Layout::bottom_up(Align::Min)));
        child.set_clip_rect(body);

        // Поле ввода
        let mut do_send = false;
        let id = Id::new("composer");
        let can_write = !chat.read_only;
        if can_write {
            let enter = child.memory(|m| m.has_focus(id))
                && child.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter));
            if enter {
                do_send = true;
            }
            egui::Frame::new().fill(pal.side_bg).corner_radius(22).inner_margin(Margin::symmetric(16, 10)).show(&mut child, |ui| {
                ui.set_width(body.width() - 32.0);
                ui.with_layout(egui::Layout::left_to_right(Align::BOTTOM), |ui| {
                    let w = ui.available_width() - 52.0;
                    egui::ScrollArea::vertical().max_height(120.0).auto_shrink([true, true]).show(ui, |ui| {
                        ui.add(
                            TextEdit::multiline(&mut self.input)
                                .id(id)
                                .hint_text("Сообщение")
                                .desired_rows(1)
                                .desired_width(w)
                                .frame(egui::Frame::NONE)
                                .margin(vec2(0.0, 10.0))
                                .font(FontId::proportional(15.5)),
                        );
                    });
                    let ready = !self.input.trim().is_empty();
                    let (r, resp) = ui.allocate_exact_size(vec2(42.0, 42.0), Sense::click());
                    let p = ui.painter();
                    p.circle_filled(r.center(), 21.0, if ready { pal.accent_fill } else { pal.surf2 });
                    let c = r.center();
                    let st = Stroke::new(2.2, if ready { Color32::WHITE } else { pal.muted });
                    p.line_segment([pos2(c.x, c.y + 7.0), pos2(c.x, c.y - 7.0)], st);
                    p.line_segment([pos2(c.x, c.y - 7.0), pos2(c.x - 6.0, c.y - 1.0)], st);
                    p.line_segment([pos2(c.x, c.y - 7.0), pos2(c.x + 6.0, c.y - 1.0)], st);
                    if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                        do_send = true;
                    }
                });
            });
            if self.focus_input {
                child.memory_mut(|m| m.request_focus(id));
                self.focus_input = false;
            }
            child.add_space(8.0);
        } else {
            child.label(RichText::new("В этот чат нельзя писать").color(pal.muted));
            child.add_space(8.0);
        }

        // Лента
        let loading = self.loading.contains(&cid);
        let list: &[Msg] = self.msgs.get(&cid).map(|v| v.as_slice()).unwrap_or(&[]);
        child.with_layout(egui::Layout::top_down(Align::Min), |ui| {
            egui::ScrollArea::vertical()
                .id_salt(("feed", cid))
                .auto_shrink([false, false])
                .stick_to_bottom(true)
                .show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 0.0;
                    if loading {
                        ui.add_space(24.0);
                        ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
                    } else if list.is_empty() {
                        ui.add_space(24.0);
                        ui.vertical_centered(|ui| ui.label(RichText::new("Сообщений пока нет").color(pal.muted)));
                    }
                    let group = chat.kind != "direct";
                    ui.add_space(6.0);
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
                        draw_msg(ui, pal, m, first, last, group && first, me);
                    }
                    ui.add_space(6.0);
                });
        });

        if do_send {
            self.send();
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

// ─────────────────────────── строки и пузыри ───────────────────────────

fn chat_row(ui: &mut Ui, pal: &Pal, c: &Chat, me: i64, server: &str, active: bool) -> bool {
    let w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 66.0), Sense::click());
    let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
    if active {
        ui.painter().rect_filled(rect, 16, pal.sel);
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, 16, pal.hover);
    }
    let title = c.title(me);
    let av = Rect::from_min_size(rect.min + vec2(10.0, 9.0), vec2(48.0, 48.0));
    let peer = c.peer(me).map(|m| m.id);
    draw_avatar(ui, av, pal, server, peer, &title, peer.unwrap_or(c.id));

    let x = av.right() + 12.0;
    let right = rect.right() - 12.0;
    let p = ui.painter().clone();
    let time = list_time(c.last_ts());
    let tg = p.layout_no_wrap(time, FontId::proportional(12.0), if c.unread > 0 && !c.muted { pal.accent } else { pal.muted });
    let tw = tg.size().x;
    p.galley(pos2(right - tw, rect.top() + 14.0), tg, pal.muted);
    let ng = elided(&p, &title, FontId::new(15.0, bold()), pal.text, right - x - tw - 10.0);
    p.galley(pos2(x, rect.top() + 12.0), ng, pal.text);

    let mut badge_w = 0.0;
    if c.unread > 0 {
        let label = if c.unread > 99 { "99+".to_string() } else { c.unread.to_string() };
        let bg = p.layout_no_wrap(label, FontId::new(12.0, bold()), Color32::WHITE);
        let bw = (bg.size().x + 14.0).max(22.0);
        let br = Rect::from_min_size(pos2(right - bw, rect.bottom() - 12.0 - 22.0), vec2(bw, 22.0));
        p.rect_filled(br, 11, if c.muted { pal.muted } else { pal.accent_fill });
        p.galley(br.center() - bg.size() / 2.0, bg, Color32::WHITE);
        badge_w = bw + 8.0;
    }
    let pg = elided(&p, &preview(c, me), FontId::proportional(13.5), pal.text2, right - x - badge_w);
    p.galley(pos2(x, rect.bottom() - 12.0 - 18.0), pg, pal.text2);
    resp.clicked()
}

fn day_pill(ui: &mut Ui, pal: &Pal, text: &str) {
    let p = ui.painter().clone();
    let g = p.layout_no_wrap(text.to_string(), FontId::proportional(12.5), pal.text2);
    let w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(w, 40.0), Sense::hover());
    let pill = Rect::from_center_size(rect.center(), g.size() + vec2(24.0, 10.0));
    p.rect_filled(pill, 12, pal.daypill);
    p.galley(pill.center() - g.size() / 2.0, g, pal.text2);
}

fn draw_msg(ui: &mut Ui, pal: &Pal, m: &Msg, first: bool, last: bool, show_name: bool, me: i64) {
    let p = ui.painter().clone();
    let avail = ui.available_width();

    // служебные сообщения — по центру
    if m.system {
        let g = p.layout(m.text.clone(), FontId::proportional(13.0), pal.text2, (avail - 80.0).max(100.0));
        let (rect, _) = ui.allocate_exact_size(vec2(avail, g.size().y + 14.0), Sense::hover());
        p.galley(pos2(rect.center().x - g.size().x / 2.0, rect.top() + 7.0), g, pal.text2);
        return;
    }

    let mine = m.sender_id == me;
    let (px, py) = (12.0, 8.0);
    let max_w = (avail * 0.74).min(580.0).max(140.0);
    let tw = max_w - 2.0 * px;
    let (fg, fg2) = if mine { (Color32::WHITE, alpha(Color32::WHITE, 200)) } else { (pal.text, pal.muted) };

    let body = if m.deleted {
        "Сообщение удалено".to_string()
    } else if !m.text.is_empty() {
        m.text.clone()
    } else if let Some(a) = &m.attach {
        format!("Вложение: {a}")
    } else {
        String::new()
    };
    let g = p.layout(body, FontId::proportional(15.0), if m.deleted { fg2 } else { fg }, tw);

    let mut time = fmt_time(m.sent_at);
    if m.pending {
        time = "отправка…".into();
    } else if m.edited {
        time = format!("изм. {time}");
    }
    let tg = p.layout_no_wrap(time, FontId::proportional(11.5), fg2);

    let name_g = show_name.then(|| {
        let n = if m.sender_name.is_empty() { "Пользователь".to_string() } else { m.sender_name.clone() };
        elided(&p, &n, FontId::new(13.5, bold()), av_color(m.sender_id), tw)
    });
    let reply_g = (!m.reply_text.is_empty()).then(|| {
        let rn = elided(&p, &m.reply_name, FontId::new(12.5, bold()), if mine { Color32::WHITE } else { pal.accent }, tw - 10.0);
        let rt = elided(&p, &m.reply_text.replace('\n', " "), FontId::proportional(12.5), fg2, tw - 10.0);
        (rn, rt)
    });

    let last_w = g.rows.last().map_or(0.0, |r| r.rect().max.x);
    let inline = last_w + 10.0 + tg.size().x <= tw;
    let mut cw = g.size().x.max(if inline { last_w + 10.0 + tg.size().x } else { tg.size().x });
    if let Some(n) = &name_g {
        cw = cw.max(n.size().x);
    }
    if let Some((a, b)) = &reply_g {
        cw = cw.max(a.size().x.max(b.size().x) + 10.0);
    }
    let name_h = name_g.as_ref().map_or(0.0, |n| n.size().y + 2.0);
    let reply_h = reply_g.as_ref().map_or(0.0, |(a, b)| a.size().y + b.size().y + 8.0);
    let time_h = if inline { 0.0 } else { tg.size().y + 1.0 };
    let bw = cw + 2.0 * px;
    let bh = py + name_h + reply_h + g.size().y + time_h + py;

    let gap = if last { 8.0 } else { 2.0 };
    let (row, _) = ui.allocate_exact_size(vec2(avail, bh + gap), Sense::hover());
    let x0 = if mine { row.right() - bw - 12.0 } else { row.left() + 12.0 };
    let b = Rect::from_min_size(pos2(x0, row.top()), vec2(bw, bh));

    let fill = if mine { pal.accent_fill } else { pal.bubble_bg };
    let (big, small) = (18u8, 5u8);
    let tail = last;
    let cr = CornerRadius {
        nw: big,
        ne: big,
        sw: if !mine && tail { small } else { big },
        se: if mine && tail { small } else { big },
    };
    if !pal.dark && !mine {
        p.rect_filled(b.translate(vec2(0.0, 1.0)), cr, Color32::from_rgba_unmultiplied(60, 40, 20, 22));
    }
    p.rect_filled(b, cr, fill);
    if tail {
        let pts = if mine {
            vec![pos2(b.right() - 2.0, b.bottom() - 13.0), pos2(b.right() + 6.0, b.bottom()), pos2(b.right() - 10.0, b.bottom())]
        } else {
            vec![pos2(b.left() + 2.0, b.bottom() - 13.0), pos2(b.left() - 6.0, b.bottom()), pos2(b.left() + 10.0, b.bottom())]
        };
        p.add(Shape::convex_polygon(pts, fill, Stroke::NONE));
    }

    let mut y = b.top() + py;
    let x = b.left() + px;
    if let Some(n) = name_g {
        let h = n.size().y + 2.0;
        p.galley(pos2(x, y), n, pal.text);
        y += h;
    }
    if let Some((rn, rt)) = reply_g {
        let (rn_h, rt_h) = (rn.size().y, rt.size().y);
        let h = rn_h + rt_h + 4.0;
        let bar = if mine { alpha(Color32::WHITE, 220) } else { pal.accent };
        p.rect_filled(Rect::from_min_size(pos2(x, y), vec2(2.5, h)), 1, bar);
        p.galley(pos2(x + 8.0, y), rn, fg);
        p.galley(pos2(x + 8.0, y + rn_h + 2.0), rt, fg2);
        y += h + 4.0;
    }
    let text_h = g.size().y;
    p.galley(pos2(x, y), g, fg);
    let tgs = tg.size();
    let tpos = if inline {
        pos2(b.right() - px - tgs.x, y + text_h - tgs.y - 1.0)
    } else {
        pos2(b.right() - px - tgs.x, y + text_h + 1.0)
    };
    p.galley(tpos, tg, fg2);
    let _ = first;
}
