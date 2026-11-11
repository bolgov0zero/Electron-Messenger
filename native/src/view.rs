//! Отрисовка: строки списка, пузыри, фото, ссылки, галочки, тексты присутствия.
//! Размеры и цвета — из CSS клиента (flat.css, flat-base.css, flat-chat.css, flat-frame.css).
use std::sync::Arc;

use chrono::{Datelike, Local, TimeZone};
use eframe::egui::{self, pos2, vec2, Align2, Color32, CornerRadius, FontId, Rect, Sense, Stroke, Ui};

use crate::icons;
use crate::model::{Attachment, Chat, Msg, Presence, Status};
use crate::theme::{self, alpha, av_color, bold, Pal};

// ───────────────────────────── время и тексты ─────────────────────────────

pub fn fmt_time(ts: i64) -> String {
    Local.timestamp_opt(ts, 0).single().map(|d| d.format("%H:%M").to_string()).unwrap_or_default()
}

pub fn day_of(ts: i64) -> Option<chrono::NaiveDate> {
    Local.timestamp_opt(ts, 0).single().map(|d| d.date_naive())
}

const MONTHS: [&str; 12] = [
    "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_SHORT: [&str; 12] =
    ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const WEEKDAYS: [&str; 7] = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WEEKDAYS_ACC: [&str; 7] = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];

pub fn day_label(ts: i64) -> String {
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

pub fn list_time(ts: i64) -> String {
    if ts == 0 {
        return String::new();
    }
    let Some(d) = day_of(ts) else { return String::new() };
    let age = (Local::now().date_naive() - d).num_days();
    if age == 0 {
        fmt_time(ts)
    } else if (1..7).contains(&age) {
        WEEKDAYS[d.weekday().num_days_from_monday() as usize].to_string()
    } else {
        format!("{:02}.{:02}.{:02}", d.day(), d.month(), d.year() % 100)
    }
}

pub fn plural(n: usize, one: &str, few: &str, many: &str) -> String {
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

/// «Был в сети …» — как formatLastSeen в клиенте.
pub fn last_seen_text(ts: i64) -> String {
    if ts <= 0 {
        return "Был в сети".into();
    }
    let now = Local::now().timestamp();
    let diff = (now - ts).max(0);
    if diff < 60 {
        return "Был в сети только что".into();
    }
    if diff < 3600 {
        return format!("Был в сети {} мин. назад", diff / 60);
    }
    if diff < 86400 {
        return format!("Был в сети {} ч. назад", diff / 3600);
    }
    let Some(d) = Local.timestamp_opt(ts, 0).single() else { return "Был в сети".into() };
    let (today, day) = (Local::now().date_naive(), d.date_naive());
    let t = d.format("%H:%M");
    if day == today {
        format!("Был в сети сегодня в {t}")
    } else if Some(day) == today.pred_opt() {
        format!("Был в сети вчера в {t}")
    } else if (today - day).num_days() < 7 {
        format!("Был в сети в {} в {t}", WEEKDAYS_ACC[day.weekday().num_days_from_monday() as usize])
    } else {
        format!("Был в сети {} {} {}", day.day(), MONTHS_SHORT[day.month0() as usize], day.year())
    }
}

/// Подпись «Имя печатает…» (typingLabel). `names` — (имя, голос?).
pub fn typing_label(names: &[(String, bool)], with_names: bool) -> String {
    let voice = names.iter().all(|n| n.1);
    if !with_names || names.is_empty() {
        return if voice { "записывает голосовое…".into() } else { "печатает…".into() };
    }
    let first = if names[0].0.is_empty() { "Кто-то" } else { names[0].0.as_str() };
    match (names.len(), voice) {
        (1, false) => format!("{first} печатает…"),
        (1, true) => format!("{first} записывает голосовое…"),
        (2, false) => format!("{first} и {} печатают…", names[1].0),
        (2, true) => format!("{first} и {} записывают голосовые…", names[1].0),
        (n, false) => format!("{first} и ещё {} печатают…", n - 1),
        (n, true) => format!("{first} и ещё {} записывают голосовые…", n - 1),
    }
}

pub fn preview(c: &Chat, me: i64) -> String {
    let Some(m) = &c.last else { return "Нет сообщений".into() };
    let body = if m.deleted {
        "Сообщение удалено".to_string()
    } else if !m.text.trim().is_empty() {
        m.text.replace('\n', " ")
    } else if m.attachments.iter().any(|a| a.voice) {
        "Голосовое сообщение".to_string()
    } else if m.attachments.len() > 1 {
        format!("Вложений: {}", m.attachments.len())
    } else if let Some(a) = m.attachments.first() {
        if a.is_image() { "Фото".to_string() } else if a.name.is_empty() { "Вложение".to_string() } else { a.name.clone() }
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

// ───────────────────────────── текст со ссылками ─────────────────────────────

struct Span {
    t: String,
    bold: bool,
    italic: bool,
    code: bool,
    link: Option<String>,
}

fn plain(t: &str) -> Span {
    Span { t: t.to_string(), bold: false, italic: false, code: false, link: None }
}

/// Отделяет от ссылки хвостовую пунктуацию (splitUrl из fmt.js).
fn trim_url(u: &str) -> &str {
    let mut end = u.len();
    while let Some(c) = u[..end].chars().next_back() {
        let head = &u[..end];
        let drop = match c {
            '.' | ',' | ';' | ':' | '!' | '?' | '»' | '”' | '\'' | '*' | '|' => true,
            ')' => head.matches('(').count() < head.matches(')').count(),
            ']' => head.matches('[').count() < head.matches(']').count(),
            _ => false,
        };
        if !drop {
            break;
        }
        end -= c.len_utf8();
    }
    &u[..end]
}

/// **жирный**, __курсив__, `код`.
fn push_marked(out: &mut Vec<Span>, s: &str) {
    let mut buf = String::new();
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        let (m, b, it, code) = if rest.starts_with("**") {
            ("**", true, false, false)
        } else if rest.starts_with("__") {
            ("__", false, true, false)
        } else if rest.starts_with('`') {
            ("`", false, false, true)
        } else {
            let ch = rest.chars().next().unwrap();
            buf.push(ch);
            i += ch.len_utf8();
            continue;
        };
        if let Some(j) = rest[m.len()..].find(m) {
            if j > 0 {
                if !buf.is_empty() {
                    out.push(plain(&buf));
                    buf.clear();
                }
                out.push(Span { t: rest[m.len()..m.len() + j].to_string(), bold: b, italic: it, code, link: None });
                i += m.len() * 2 + j;
                continue;
            }
        }
        buf.push_str(m);
        i += m.len();
    }
    if !buf.is_empty() {
        out.push(plain(&buf));
    }
}

fn parse_rich(text: &str) -> Vec<Span> {
    let mut out = vec![];
    let mut rest = text;
    loop {
        let pos = [rest.find("https://"), rest.find("http://")].into_iter().flatten().min();
        let Some(i) = pos else {
            push_marked(&mut out, rest);
            break;
        };
        push_marked(&mut out, &rest[..i]);
        let after = &rest[i..];
        let end = after.find(|c: char| c.is_whitespace() || c == '<' || c == '>' || c == '"').unwrap_or(after.len());
        let url = trim_url(&after[..end]);
        let url = if url.len() < 8 { &after[..end] } else { url };
        out.push(Span { t: url.to_string(), bold: false, italic: false, code: false, link: Some(url.to_string()) });
        rest = &after[url.len()..];
    }
    out
}

/// Текст сообщения → LayoutJob и диапазоны ссылок (в символах).
fn rich_job(text: &str, size: f32, color: Color32, link_c: Color32, code_bg: Color32, wrap: f32) -> (egui::text::LayoutJob, Vec<(usize, usize, String)>) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = wrap;
    let mut links = vec![];
    let mut pos = 0usize;
    for s in parse_rich(text) {
        let n = s.t.chars().count();
        let font = if s.bold { FontId::new(size, bold()) } else { FontId::proportional(size) };
        let is_link = s.link.is_some();
        let fmt = egui::TextFormat {
            font_id: font,
            color: if is_link { link_c } else { color },
            italics: s.italic,
            underline: if is_link { Stroke::new(1.0, link_c) } else { Stroke::NONE },
            background: if s.code { code_bg } else { Color32::TRANSPARENT },
            line_height: Some(size * 1.42),
            ..Default::default()
        };
        job.append(&s.t, 0.0, fmt);
        if let Some(u) = s.link {
            links.push((pos, pos + n, u));
        }
        pos += n;
    }
    (job, links)
}

/// Однострочный текст с «…» вместо переноса.
pub fn elided(p: &egui::Painter, text: &str, font: FontId, color: Color32, width: f32) -> Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple(text.to_string(), font, color, width.max(8.0));
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    p.layout_job(job)
}

// ───────────────────────────── аватары и точки ─────────────────────────────

fn cover_uv(tex: egui::Vec2, rect: Rect) -> Rect {
    let (ra, ia) = (rect.width() / rect.height(), tex.x / tex.y);
    if ia > ra {
        let w = ra / ia;
        Rect::from_min_max(pos2((1.0 - w) / 2.0, 0.0), pos2((1.0 + w) / 2.0, 1.0))
    } else {
        let h = ia / ra;
        Rect::from_min_max(pos2(0.0, (1.0 - h) / 2.0), pos2(1.0, (1.0 + h) / 2.0))
    }
}

pub fn draw_avatar(ui: &mut Ui, rect: Rect, server: &str, user_id: Option<i64>, name: &str, key: i64) {
    if let Some(id) = user_id {
        let uri = format!("{server}/api/users/{id}/avatar");
        if let Ok(egui::load::TexturePoll::Ready { texture }) =
            ui.ctx().try_load_texture(&uri, egui::TextureOptions::LINEAR, egui::load::SizeHint::default())
        {
            let uv = cover_uv(texture.size, rect);
            ui.put(
                rect,
                egui::Image::from_texture(texture)
                    .uv(uv)
                    .maintain_aspect_ratio(false)
                    .fit_to_exact_size(rect.size())
                    .corner_radius(CornerRadius::same((rect.size().x / 2.0) as u8)),
            );
            return;
        }
    }
    let p = ui.painter();
    p.circle_filled(rect.center(), rect.size().x / 2.0, av_color(key));
    let letter = name.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_uppercase().to_string()).unwrap_or("?".into());
    p.text(rect.center(), Align2::CENTER_CENTER, letter, FontId::new(rect.size().x * 0.34, bold()), Color32::WHITE);
}

/// Точка присутствия 13×13 в правом нижнем углу аватарки; offline скрыта.
pub fn presence_dot(p: &egui::Painter, av: Rect, pr: Option<&Presence>, pal: &Pal, halo: Color32) {
    let Some(pr) = pr else { return };
    let color = match pr.status.as_str() {
        "online" => pal.online,
        "away" => pal.away,
        _ => return,
    };
    let c = pos2(av.right() - 6.5, av.bottom() - 6.5);
    p.circle_filled(c, 9.0, halo);
    p.circle_filled(c, 6.5, color);
}

/// Галочки статуса: одна — отправлено, две — доставлено, первая цветная — прочитал кто-то, обе — все.
pub fn draw_ticks(p: &egui::Painter, x_right: f32, y_center: f32, st: &Status, normal: Color32) {
    const SC: f32 = 0.85;
    let blue = theme::rgb(0x3ea6ff);
    let (read_all, read_some, double) = (st.read >= st.total, st.read > 0, st.delivered > 0 || st.read > 0);
    let (x0, y0) = (x_right - 15.0 * SC, y_center - 4.0 * SC);
    let pt = |x: f32, y: f32| pos2(x0 + x * SC, y0 + y * SC);
    let line = |pts: [egui::Pos2; 3], c: Color32| {
        let s = Stroke::new(1.6, c);
        p.line_segment([pts[0], pts[1]], s);
        p.line_segment([pts[1], pts[2]], s);
    };
    if double {
        line([pt(1.0, 5.5), pt(3.5, 8.0), pt(9.0, 1.0)], if read_some { blue } else { normal });
    }
    line([pt(7.0, 5.5), pt(9.5, 8.0), pt(15.0, 1.0)], if read_all { blue } else { normal });
}

// ───────────────────────────── строка списка чатов ─────────────────────────────

pub struct Row<'a> {
    pub c: &'a Chat,
    pub me: i64,
    pub server: &'a str,
    pub active: bool,
    pub typing: Option<String>,
    pub presence: Option<&'a Presence>,
}

pub struct RowOut {
    pub clicked: bool,
    /// Правый клик: где открыть контекстное меню.
    pub menu_at: Option<egui::Pos2>,
}

/// .chat-item: padding 7×12, аватар 48, gap 12, радиус 16, высота 62.
pub fn chat_row(ui: &mut Ui, pal: &Pal, r: &Row) -> RowOut {
    let c = r.c;
    let w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 62.0), Sense::click());
    let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
    let hl = rect.shrink2(vec2(0.0, 1.0));
    if r.active {
        ui.painter().rect_filled(hl, 16, pal.sel);
    } else if resp.hovered() {
        ui.painter().rect_filled(hl, 16, pal.hover);
    }
    let title = c.title(r.me);
    let peer = c.peer(r.me).map(|m| m.id);
    let av = Rect::from_min_size(rect.min + vec2(12.0, 7.0), vec2(48.0, 48.0));
    draw_avatar(ui, av, r.server, peer, &title, peer.unwrap_or(c.id));
    if peer.is_some() {
        presence_dot(ui.painter(), av, r.presence, pal, alpha(pal.side_bg, 217));
    }

    let x = av.right() + 12.0;
    let right = rect.right() - 12.0;
    let p = ui.painter().clone();
    let unread = c.unread > 0 && !c.muted;
    let tg = p.layout_no_wrap(list_time(c.last_ts()), FontId::proportional(11.6), if unread { pal.accent } else { pal.muted });
    let tw = tg.size().x;
    let ty = rect.top() + 14.0;
    p.galley(pos2(right - tw, ty), tg.clone(), pal.muted);
    // справа налево: время, галочки, «без звука», булавка (по 12 px)
    let mut cur = right - tw - 6.0;
    let mut cluster = 0.0;
    let own = c.last.as_ref().filter(|m| m.sender_id == r.me && !m.deleted).and_then(|m| m.status).filter(|s| s.total > 0);
    if let Some(s) = own {
        draw_ticks(&p, cur, ty + tg.size().y / 2.0, &s, pal.muted);
        cur -= 20.0;
        cluster += 20.0;
    }
    let faint = alpha(pal.muted, 178);
    for icon in [c.muted.then_some(&icons::BELL_OFF), c.pinned.then_some(&icons::PIN)].into_iter().flatten() {
        let ir = Rect::from_center_size(pos2(cur - 6.0, ty + tg.size().y / 2.0), vec2(12.0, 12.0));
        icons::paint(ui, icon, ir, faint, 2.0);
        cur -= 16.0;
        cluster += 16.0;
    }
    let ng = elided(&p, &title, FontId::new(14.5, bold()), pal.text, right - x - tw - cluster - 14.0);
    p.galley(pos2(x, rect.top() + 12.0), ng, pal.text);

    let mut badge_w = 0.0;
    if c.unread > 0 {
        let label = c.unread.to_string();
        let bg = p.layout_no_wrap(label, FontId::new(12.0, bold()), Color32::WHITE);
        let bw = (bg.size().x + 14.0).max(22.0);
        let br = Rect::from_min_size(pos2(right - bw, rect.top() + 30.0), vec2(bw, 22.0));
        p.rect_filled(br, 11, if c.muted { pal.muted } else { pal.accent_fill });
        p.galley(br.center() - bg.size() / 2.0, bg, Color32::WHITE);
        badge_w = bw + 8.0;
    }
    let (text, color, italic) = match &r.typing {
        Some(t) => (t.clone(), pal.muted, true),
        None => (preview(c, r.me), pal.text2, false),
    };
    let mut job = egui::text::LayoutJob::simple(text, FontId::proportional(13.0), color, (right - x - badge_w).max(8.0));
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    if italic {
        for s in &mut job.sections {
            s.format.italics = true;
        }
    }
    let pg = p.layout_job(job);
    p.galley(pos2(x, rect.top() + 33.0), pg, color);
    RowOut { clicked: resp.clicked(), menu_at: resp.secondary_clicked().then(|| resp.interact_pointer_pos()).flatten() }
}

pub struct ContactRow<'a> {
    pub u: &'a crate::model::Contact,
    pub server: &'a str,
    pub presence: Option<&'a Presence>,
    /// Показывать названия общих пространств (у человека их больше одного).
    pub show_ws: bool,
}

fn fnv(s: &str) -> i64 {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    (h % 14) as i64
}

/// Строка контакта (.pp-row): padding 9×12, аватар 36, gap 10, радиус 16; имя 13.5, чип пространства под ним.
pub fn contact_row(ui: &mut Ui, pal: &Pal, r: &ContactRow) -> bool {
    let u = r.u;
    let ws_text: Option<String> = if !u.federated && r.show_ws && u.rel == "ws" && !u.shared.is_empty() {
        let joined = u.shared.join(" · ");
        Some(if joined.chars().count() > 22 { format!("{} +{}", u.shared[0], u.shared.len() - 1) } else { joined })
    } else {
        None
    };
    let has_chip = u.federated || ws_text.is_some();
    let h = if has_chip { 57.0 } else { 54.0 };
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), h), Sense::click());
    let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
    if resp.hovered() {
        ui.painter().rect_filled(rect.shrink2(vec2(0.0, 1.0)), 16, pal.hover);
    }
    let av = Rect::from_min_size(rect.min + vec2(12.0, (h - 36.0) / 2.0), vec2(36.0, 36.0));
    draw_avatar(ui, av, r.server, Some(u.id), &u.name, u.id);
    presence_dot(ui.painter(), av, r.presence, pal, alpha(pal.side_bg, 217));

    let x = av.right() + 10.0;
    let right = rect.right() - 12.0;
    let p = ui.painter().clone();
    let tag_g = (!u.tag.is_empty()).then(|| p.layout_no_wrap(u.tag.clone(), FontId::new(11.0, bold()), av_color(fnv(&u.tag))));
    let tag_w = tag_g.as_ref().map_or(0.0, |g| g.size().x + 14.0 + 8.0);
    let ng = elided(&p, &u.name, FontId::proportional(13.5), pal.text, right - x - tag_w);
    let line_h = ng.size().y;
    let block_h = line_h + if has_chip { 3.0 + 19.0 } else { 0.0 };
    let y = rect.top() + (h - block_h) / 2.0;
    let name_w = ng.size().x;
    p.galley(pos2(x, y), ng, pal.text);
    if let Some(g) = tag_g {
        let cr = Rect::from_min_size(pos2(x + name_w + 8.0, y + (line_h - (g.size().y + 4.0)) / 2.0), vec2(g.size().x + 14.0, g.size().y + 4.0));
        p.rect_filled(cr, 7, alpha(av_color(fnv(&u.tag)), 36));
        p.galley(pos2(cr.left() + 7.0, cr.top() + 2.0), g, pal.text);
    }
    let cy = y + line_h + 3.0;
    if u.federated {
        let cr = Rect::from_min_size(pos2(x, cy), vec2(26.0, 19.0));
        p.rect_filled(cr, 8, pal.accent_soft);
        icons::paint(ui, &icons::GLOBE, Rect::from_center_size(cr.center(), vec2(12.0, 12.0)), pal.accent_ink, 2.0);
    } else if let Some(t) = ws_text {
        let g = p.layout_no_wrap(t, FontId::new(11.0, bold()), pal.accent_ink);
        let cr = Rect::from_min_size(pos2(x, cy), vec2((g.size().x + 16.0).min(right - x), 19.0));
        p.rect_filled(cr, 8, pal.accent_soft);
        p.galley(pos2(cr.left() + 8.0, cr.center().y - g.size().y / 2.0), g, pal.accent_ink);
    }
    resp.clicked()
}

// ───────────────────────────── сообщения ─────────────────────────────

pub fn day_pill(ui: &mut Ui, pal: &Pal, text: &str) {
    let p = ui.painter().clone();
    let g = p.layout_no_wrap(text.to_string(), FontId::new(12.0, bold()), pal.text2);
    let w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(w, 44.0), Sense::hover());
    let pill = Rect::from_center_size(rect.center(), g.size() + vec2(24.0, 8.0));
    p.rect_filled(pill, 10, pal.chip);
    p.galley(pill.center() - g.size() / 2.0, g, pal.text2);
}

pub struct MsgCx<'a> {
    pub server: &'a str,
    pub me: i64,
    pub group: bool,
}

fn image_uri(server: &str, a: &Attachment) -> String {
    let preview = !a.gif && matches!(a.mime.as_str(), "image/jpeg" | "image/png" | "image/webp");
    if preview && !a.file_name().is_empty() {
        format!("{server}/fp/{}", a.file_name())
    } else {
        format!("{server}{}", a.url)
    }
}

fn image_view(ui: &mut Ui, pal: &Pal, rect: Rect, uri: &str, cr: CornerRadius) {
    if let Ok(egui::load::TexturePoll::Ready { texture }) =
        ui.ctx().try_load_texture(uri, egui::TextureOptions::LINEAR, egui::load::SizeHint::default())
    {
        let uv = cover_uv(texture.size, rect);
        ui.put(
            rect,
            egui::Image::from_texture(texture).uv(uv).maintain_aspect_ratio(false).fit_to_exact_size(rect.size()).corner_radius(cr),
        );
    } else {
        ui.painter().rect_filled(rect, cr, pal.surf2);
    }
}

fn fmt_size(n: i64) -> String {
    if n >= 1 << 20 {
        format!("{:.1} МБ", n as f64 / (1 << 20) as f64)
    } else {
        format!("{} КБ", (n as f64 / 1024.0).ceil().max(1.0))
    }
}

/// Название клиента в шапке сайдбара: «ELECTRON» + «MESSENGER» акцентным цветом, 13 px, жирный, разрядка 0,9.
pub fn wordmark(p: &egui::Painter, pal: &Pal) -> Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::default();
    let fmt = |color| egui::TextFormat {
        font_id: FontId::new(13.0, bold()),
        color,
        extra_letter_spacing: 0.9,
        ..Default::default()
    };
    job.append("ELECTRON", 0.0, fmt(pal.text));
    job.append("MESSENGER", 6.0, fmt(pal.accent_ink));
    p.layout_job(job)
}

/// Пузырь сообщения: радиус 18 (в серии 5, у хвоста 0), padding 7×12, текст 14.5/1.42, время 11.5.
pub fn draw_msg(ui: &mut Ui, pal: &Pal, m: &Msg, first: bool, last: bool, show_name: bool, cx: &MsgCx) {
    let p = ui.painter().clone();
    let avail = ui.available_width();

    if m.system {
        let g = p.layout(m.text.clone(), FontId::proportional(13.0), pal.text2, (avail - 80.0).max(100.0));
        let (rect, _) = ui.allocate_exact_size(vec2(avail, g.size().y + 14.0), Sense::hover());
        p.galley(pos2(rect.center().x - g.size().x / 2.0, rect.top() + 7.0), g, pal.text2);
        return;
    }

    let mine = m.sender_id == cx.me;
    let inset = 40.0;
    let av_w = if cx.group && !mine { 44.0 } else { 0.0 };
    let max_w = (avail - 2.0 * inset - av_w).min(560.0).min(avail * 0.82).max(140.0);
    let (px, top, bot) = (12.0f32, 7.0f32, 5.5f32);
    let fg = if mine { alpha(Color32::WHITE, 235) } else { pal.text };
    let tcol = if mine { alpha(Color32::WHITE, 205) } else { pal.text2 };
    let name_c = if mine { pal.accent } else { pal.muted };
    let link_c = if mine { Color32::WHITE } else { pal.accent };
    let code_bg = if mine { alpha(Color32::WHITE, 50) } else { alpha(pal.text, 20) };

    // фото
    let images: Vec<&Attachment> = m.attachments.iter().filter(|a| a.is_image()).collect();
    let files: Vec<&Attachment> = m.attachments.iter().filter(|a| !a.is_image() && !a.voice).collect();
    let mut tiles: Vec<(Rect, &Attachment)> = vec![];
    let (mut img_w, mut img_h) = (0.0f32, 0.0f32);
    if images.len() == 1 {
        let a = images[0];
        let (w, h) = if a.w > 0 && a.h > 0 { (a.w as f32, a.h as f32) } else { (280.0, 210.0) };
        let dw = w.clamp(96.0, 280.0);
        let dh = (dw * h / w).clamp(60.0, 300.0);
        tiles.push((Rect::from_min_size(pos2(0.0, 0.0), vec2(dw, dh)), a));
        (img_w, img_h) = (dw, dh);
    } else if images.len() > 1 {
        let t = 139.0;
        let n = images.len();
        for (i, a) in images.iter().enumerate() {
            let (row, col) = (i / 2, i % 2);
            let odd_last = i == n - 1 && n % 2 == 1;
            let x = if odd_last { 0.0 } else { col as f32 * (t + 2.0) };
            let w = if odd_last { 280.0 } else { t };
            tiles.push((Rect::from_min_size(pos2(x, row as f32 * (t + 2.0)), vec2(w, t)), *a));
        }
        img_w = 280.0;
        img_h = ((n + 1) / 2) as f32 * (t + 2.0) - 2.0;
    }
    let has_images = !images.is_empty();

    // текст
    let voice = m.attachments.iter().any(|a| a.voice);
    let body: String = if m.deleted {
        "Сообщение удалено".into()
    } else if m.text.is_empty() && voice {
        "Голосовое сообщение".into()
    } else {
        m.text.clone()
    };
    let photo_only = has_images && body.is_empty() && files.is_empty() && m.reply_text.is_empty() && !show_name;
    let wrap = if has_images { (img_w - 2.0 * px).max(140.0) } else { max_w - 2.0 * px };
    let (g, links) = if body.is_empty() {
        (None, vec![])
    } else {
        let (job, links) = rich_job(&body, 14.5, if m.deleted { tcol } else { fg }, link_c, code_bg, wrap);
        (Some(p.layout_job(job)), links)
    };

    let mut time = fmt_time(m.sent_at);
    if m.pending {
        time = "отправка…".into();
    } else if m.edited {
        time = format!("изм. {time}");
    }
    let time_col = if photo_only { Color32::WHITE } else { tcol };
    let tg = p.layout_no_wrap(time, FontId::proportional(11.5), time_col);
    let st = if mine && !m.pending && !m.deleted { m.status.filter(|s| s.total > 0) } else { None };
    let tick_w = if st.is_some() { 18.0 } else { 0.0 };
    let tgw = tg.size().x + tick_w;

    let name_g = show_name.then(|| {
        let n = if m.sender_name.is_empty() { "Пользователь".to_string() } else { m.sender_name.clone() };
        elided(&p, &n, FontId::new(13.0, bold()), name_c, wrap)
    });
    let reply_g = (!m.reply_text.is_empty()).then(|| {
        let rn = elided(&p, &m.reply_name, FontId::new(12.0, bold()), if mine { Color32::WHITE } else { pal.accent }, wrap - 10.0);
        let rt = elided(&p, &m.reply_text.replace('\n', " "), FontId::proportional(12.0), tcol, wrap - 10.0);
        (rn, rt)
    });
    let file_g: Vec<(Arc<egui::Galley>, String)> = files
        .iter()
        .map(|a| {
            let name = if a.name.is_empty() { "Файл".to_string() } else { a.name.clone() };
            let label = if a.size > 0 { format!("{name} · {}", fmt_size(a.size)) } else { name };
            (elided(&p, &label, FontId::proportional(14.0), link_c, wrap), format!("{}{}", cx.server, a.url))
        })
        .collect();

    // размеры
    let last_w = g.as_ref().and_then(|g| g.rows.last()).map_or(0.0, |r| r.rect().max.x);
    let inline = g.is_some() && last_w + 10.0 + tgw <= wrap;
    let mut cw = g.as_ref().map_or(0.0, |g| g.size().x);
    cw = cw.max(if inline { last_w + 10.0 + tgw } else { tgw });
    for n in &name_g {
        cw = cw.max(n.size().x);
    }
    if let Some((a, b)) = &reply_g {
        cw = cw.max(a.size().x.max(b.size().x) + 10.0);
    }
    for (f, _) in &file_g {
        cw = cw.max(f.size().x);
    }
    let name_h = name_g.as_ref().map_or(0.0, |n| n.size().y + 2.0);
    let reply_h = reply_g.as_ref().map_or(0.0, |(a, b)| a.size().y + b.size().y + 12.0);
    let files_h = file_g.len() as f32 * 22.0;
    let text_h = g.as_ref().map_or(0.0, |g| g.size().y);
    let time_h = if photo_only || inline { 0.0 } else { tg.size().y + 1.0 };
    let text_part = if photo_only { 0.0 } else { top + name_h + reply_h + files_h + text_h + time_h + bot };
    let bw = (cw + 2.0 * px).max(if has_images { img_w } else { 0.0 });
    let bh = img_h + text_part;

    let gap = if last { 8.0 } else { 2.0 };
    let (row, resp) = ui.allocate_exact_size(vec2(avail, bh + gap), Sense::click());
    if resp.secondary_clicked() && !m.deleted && !m.pending && m.id > 0 {
        if let Some(pos) = resp.interact_pointer_pos() {
            ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new("msg_menu_req"), (m.id, pos)));
        }
    }
    let bx = if mine { row.right() - inset - bw } else { row.left() + inset + av_w };
    let b = Rect::from_min_size(pos2(bx, row.top()), vec2(bw, bh));

    let (big, small) = (18u8, 5u8);
    let cr = if mine {
        CornerRadius { nw: big, sw: big, ne: if first { big } else { small }, se: if last { big } else { small } }
    } else {
        CornerRadius { ne: big, se: big, nw: if first { big } else { small }, sw: if last { big } else { small } }
    };
    let fill = if mine { pal.accent_fill } else { pal.bubble_bg };
    if !pal.dark && !mine {
        p.rect_filled(b.translate(vec2(0.0, 1.0)), cr, Color32::from_rgba_unmultiplied(60, 40, 20, 23));
    }
    p.rect_filled(b, cr, fill);
    if cx.group && !mine && last {
        let ar = Rect::from_min_size(pos2(row.left() + inset, b.bottom() - 36.0), vec2(36.0, 36.0));
        draw_avatar(ui, ar, cx.server, Some(m.sender_id), &m.sender_name, m.sender_id);
    }

    // фото
    let mut hits: Vec<(Rect, String)> = vec![];
    for (rel, a) in &tiles {
        let r = Rect::from_min_size(b.min + rel.min.to_vec2(), rel.size());
        let crad = if images.len() == 1 {
            CornerRadius { nw: cr.nw, ne: cr.ne, sw: if text_part > 0.0 { 0 } else { cr.sw }, se: if text_part > 0.0 { 0 } else { cr.se } }
        } else {
            CornerRadius::same(6)
        };
        image_view(ui, pal, r, &image_uri(cx.server, a), crad);
        hits.push((r, format!("{}{}", cx.server, a.url)));
    }

    // содержимое под фото
    let x = b.left() + px;
    let mut y = b.top() + img_h + top;
    if !photo_only {
        if let Some(n) = name_g {
            let h = n.size().y + 2.0;
            p.galley(pos2(x, y), n, name_c);
            y += h;
        }
        if let Some((rn, rt)) = reply_g {
            let (rn_h, rt_h) = (rn.size().y, rt.size().y);
            let h = rn_h + rt_h + 4.0;
            let bar = if mine { alpha(Color32::WHITE, 220) } else { pal.accent };
            p.rect_filled(Rect::from_min_size(pos2(x, y), vec2(2.5, h)), 1, bar);
            p.galley(pos2(x + 8.0, y), rn, fg);
            p.galley(pos2(x + 8.0, y + rn_h + 2.0), rt, tcol);
            y += h + 8.0;
        }
        for (f, url) in file_g {
            let r = Rect::from_min_size(pos2(x, y), vec2(f.size().x, 22.0));
            p.galley(pos2(x, y + 2.0), f, link_c);
            hits.push((r, url));
            y += 22.0;
        }
    }
    let text_pos = pos2(x, y);
    if let Some(g) = g {
        p.galley(text_pos, g.clone(), fg);
        // время
        let tgs = tg.size();
        let tx = b.right() - px - tick_w - tgs.x;
        let tpos = if inline { pos2(tx, y + g.size().y - tgs.y - 1.0) } else { pos2(tx, y + g.size().y + 1.0) };
        if let Some(s) = st {
            draw_ticks(&p, b.right() - px, tpos.y + tgs.y / 2.0, &s, tcol);
        }
        p.galley(tpos, tg, tcol);
        // ссылки: курсор и клик
        if let Some(pos) = resp.hover_pos() {
            let rel = pos - text_pos;
            let idx = g.cursor_from_pos(rel).index.0;
            let over = Rect::from_min_size(egui::Pos2::ZERO, g.size()).contains(rel.to_pos2());
            let link = over.then(|| links.iter().find(|(a, e, _)| idx >= *a && idx < *e).map(|(_, _, u)| u.clone())).flatten();
            if link.is_some() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            if resp.clicked() {
                if let Some(u) = link {
                    ui.ctx().open_url(egui::OpenUrl::new_tab(u));
                    return;
                }
            }
        }
    } else if !photo_only {
        let tgs = tg.size();
        let tpos = pos2(b.right() - px - tick_w - tgs.x, y + 1.0);
        if let Some(s) = st {
            draw_ticks(&p, b.right() - px, tpos.y + tgs.y / 2.0, &s, tcol);
        }
        p.galley(tpos, tg, tcol);
    } else {
        // время поверх фото: фон rgba(0,0,0,.5), радиус 9, padding 2×7
        let tgs = tg.size();
        let pill = Rect::from_min_size(
            pos2(b.right() - 9.0 - (tgs.x + tick_w + 14.0), b.bottom() - 9.0 - (tgs.y + 4.0)),
            vec2(tgs.x + tick_w + 14.0, tgs.y + 4.0),
        );
        p.rect_filled(pill, 9, Color32::from_black_alpha(128));
        p.galley(pos2(pill.left() + 7.0, pill.top() + 2.0), tg, Color32::WHITE);
        if let Some(s) = st {
            draw_ticks(&p, pill.right() - 7.0, pill.center().y, &s, Color32::WHITE);
        }
    }

    // клик по фото и файлам
    if let Some(pos) = resp.hover_pos() {
        if let Some((_, url)) = hits.iter().find(|(r, _)| r.contains(pos)) {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            if resp.clicked() {
                ui.ctx().open_url(egui::OpenUrl::new_tab(url.clone()));
            }
        }
    }
}
