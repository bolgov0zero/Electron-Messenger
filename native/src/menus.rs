//! Контекстные меню в дизайне Electron-клиента (flat-base.css, flat-menus.css):
//! min-width 192, padding 5, gap 1, радиус 16; пункт 34 px, padding 0 10, gap 10, 13 px; значок 16 px accent-ink.
//! Меню строки чата и меню сообщения собраны из одних и тех же элементов. Работает только «Скопировать»,
//! остальные пункты визуальные.
use super::*;
use crate::icons::{self, Icon};
use crate::theme::{medium, mix};
use eframe::egui::{Order, Shadow};

pub(crate) fn pop_shadow(pal: &Pal) -> Shadow {
    Shadow {
        offset: [0, 18],
        blur: 44,
        spread: 0,
        color: if pal.dark { Color32::from_black_alpha(140) } else { Color32::from_rgba_unmultiplied(60, 40, 20, 41) },
    }
}

/// Пункт подменю: значок и подпись.
pub(crate) type SubItem = (&'static Icon, &'static str);

pub(crate) enum Entry {
    Item {
        icon: &'static Icon,
        label: String,
        /// Подпись красным (опасный пункт)
        danger_text: bool,
        /// Значок красным (у «Удалить чат» значок остаётся акцентным, как в клиенте)
        danger_icon: bool,
        sub: Vec<SubItem>,
        /// Шеврон справа без подменю («Прочитано»)
        chevron: bool,
    },
    Sep,
    /// Ряд быстрых реакций сверху меню сообщения
    Reactions,
    Caption(String),
}

impl Entry {
    fn item(icon: &'static Icon, label: impl Into<String>) -> Entry {
        Entry::Item { icon, label: label.into(), danger_text: false, danger_icon: false, sub: vec![], chevron: false }
    }
    fn with_sub(icon: &'static Icon, label: impl Into<String>, sub: Vec<SubItem>) -> Entry {
        Entry::Item { icon, label: label.into(), danger_text: false, danger_icon: false, sub, chevron: false }
    }
}

pub(crate) enum MenuResult {
    Open,
    Close,
    Picked(usize),
}

const REACTIONS: [&str; 7] = ["👍", "❤️", "😂", "🔥", "😎", "🎉", "😭"];

/// Рисует меню у курсора (с прижатием к краям окна на 6 px) и подменю справа или слева.
pub(crate) fn menu_popup(
    ctx: &egui::Context,
    pal: &Pal,
    id: &'static str,
    pos: egui::Pos2,
    entries: &[Entry],
    opened_now: bool,
    menu_sub: &mut Option<(usize, Rect)>,
    menu_fly: &mut Option<Rect>,
) -> MenuResult {
    let has_reactions = entries.iter().any(|e| matches!(e, Entry::Reactions));
    let inner_w = if has_reactions { 260.0 } else { 182.0 };
    let danger_bg = mix(pal.side_bg, pal.danger, 0.11);
    let sep_col = alpha(pal.text, if pal.dark { 26 } else { 23 });
    let screen = ctx.content_rect().shrink(6.0);
    let (mut picked, mut hovered_sub): (Option<usize>, Option<(usize, Rect)>) = (None, None);

    let area = egui::Area::new(Id::new(id)).order(Order::Foreground).fixed_pos(pos).constrain_to(screen).show(ctx, |ui| {
        egui::Frame::new().fill(pal.side_bg).corner_radius(16).inner_margin(Margin::same(5)).shadow(pop_shadow(pal)).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 1.0;
            ui.set_min_width(inner_w);
            for (i, e) in entries.iter().enumerate() {
                match e {
                    Entry::Sep => {
                        let (r, _) = ui.allocate_exact_size(vec2(inner_w, 7.0), Sense::hover());
                        ui.painter().line_segment([pos2(r.left() + 10.0, r.center().y), pos2(r.right() - 10.0, r.center().y)], Stroke::new(1.0, sep_col));
                    }
                    Entry::Caption(t) => {
                        let (r, _) = ui.allocate_exact_size(vec2(inner_w, 22.0), Sense::hover());
                        ui.painter().text(pos2(r.left() + 10.0, r.top() + 6.0), Align2::LEFT_TOP, t, FontId::proportional(11.0), pal.muted);
                    }
                    Entry::Reactions => {
                        let (r, _) = ui.allocate_exact_size(vec2(inner_w, 36.0), Sense::hover());
                        ui.painter().rect_filled(r, 14, pal.surf2);
                        for k in 0..8 {
                            let b = Rect::from_min_size(pos2(r.left() + 3.0 + k as f32 * 32.0, r.top() + 3.0), vec2(30.0, 30.0));
                            let resp = ui.interact(b, Id::new((id, "react", k)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                            if resp.hovered() {
                                ui.painter().rect_filled(b, 12, pal.hover2);
                            }
                            if k < 7 {
                                ui.painter().text(b.center(), Align2::CENTER_CENTER, REACTIONS[k], FontId::proportional(16.0), pal.text);
                            } else {
                                ui.painter().text(b.center(), Align2::CENTER_CENTER, "→", FontId::new(15.0, bold()), pal.text2);
                            }
                            if resp.clicked() {
                                picked = Some(i);
                            }
                        }
                        ui.add_space(2.0);
                    }
                    Entry::Item { icon, label, danger_text, danger_icon, sub, chevron } => {
                        let (r, _) = ui.allocate_exact_size(vec2(inner_w, 34.0), Sense::hover());
                        let resp = ui.interact(r, Id::new((id, "item", i)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                        if resp.hovered() {
                            ui.painter().rect_filled(r, 12, if *danger_text { danger_bg } else { pal.hover });
                            if !sub.is_empty() {
                                hovered_sub = Some((i, r));
                            }
                        }
                        let icon_col = if *danger_icon { pal.danger } else { pal.accent_ink };
                        icons::paint(ui, icon, Rect::from_center_size(pos2(r.left() + 10.0 + 8.0, r.center().y), vec2(16.0, 16.0)), icon_col, 2.0);
                        let text_col = if *danger_text { pal.danger } else { pal.text };
                        ui.painter().text(pos2(r.left() + 36.0, r.center().y), Align2::LEFT_CENTER, label, FontId::new(13.0, medium()), text_col);
                        if !sub.is_empty() || *chevron {
                            icons::paint(ui, &icons::CHEVRON_RIGHT, Rect::from_center_size(pos2(r.right() - 10.0 - 7.0, r.center().y), vec2(14.0, 14.0)), pal.muted, 2.4);
                        }
                        if resp.clicked() && sub.is_empty() {
                            picked = Some(i);
                        }
                    }
                }
            }
        });
    });
    let menu_rect = area.response.rect;
    let ptr = ctx.input(|i| i.pointer.hover_pos());

    // Подменю: открывается при наведении на пункт, не закрывается, пока курсор над ним
    if opened_now {
        *menu_sub = None;
    }
    if let Some(h) = hovered_sub {
        *menu_sub = Some(h);
    } else if !ptr.map_or(false, |p| (*menu_fly).map_or(false, |f| f.expand(4.0).contains(p))) && ptr.map_or(false, |p| menu_rect.contains(p)) {
        *menu_sub = None;
    }
    let mut fly_rect = None;
    if let Some((idx, row)) = *menu_sub {
        if let Some(Entry::Item { sub, .. }) = entries.get(idx) {
            let fw = 184.0;
            let right_fits = menu_rect.right() + 6.0 + fw + 4.0 < ctx.content_rect().right();
            let x = if right_fits { menu_rect.right() + 6.0 } else { menu_rect.left() - 6.0 - fw };
            let fly = egui::Area::new(Id::new((id, "fly"))).order(Order::Foreground).fixed_pos(pos2(x, row.top() - 7.0)).show(ctx, |ui| {
                egui::Frame::new().fill(pal.side_bg).corner_radius(16).inner_margin(Margin::same(5)).shadow(pop_shadow(pal)).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 1.0;
                    ui.set_min_width(fw - 10.0);
                    for (k, (ic, label)) in sub.iter().enumerate() {
                        let (r, _) = ui.allocate_exact_size(vec2(fw - 10.0, 32.0), Sense::hover());
                        let resp = ui.interact(r, Id::new((id, "fly_item", k)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                        if resp.hovered() {
                            ui.painter().rect_filled(r, 12, pal.hover);
                        }
                        icons::paint(ui, ic, Rect::from_center_size(pos2(r.left() + 10.0 + 8.0, r.center().y), vec2(16.0, 16.0)), pal.accent_ink, 2.0);
                        ui.painter().text(pos2(r.left() + 36.0, r.center().y), Align2::LEFT_CENTER, label, FontId::new(12.5, medium()), pal.text);
                        if resp.clicked() {
                            picked = Some(usize::MAX);
                        }
                    }
                });
            });
            fly_rect = Some(fly.response.rect);
        }
    }
    *menu_fly = fly_rect;

    let inside = |p: egui::Pos2| menu_rect.contains(p) || fly_rect.map_or(false, |f| f.contains(p));
    let outside = !opened_now && ctx.input(|i| i.pointer.any_click()) && !ctx.input(|i| i.pointer.interact_pos()).map_or(false, inside);
    if outside || ctx.input(|i| i.key_pressed(Key::Escape)) {
        return MenuResult::Close;
    }
    match picked {
        Some(i) => MenuResult::Picked(i),
        None => MenuResult::Open,
    }
}

impl App {
    fn popup_menu(&mut self, ctx: &egui::Context, pal: &Pal, id: &'static str, pos: egui::Pos2, entries: &[Entry], opened_now: bool) -> MenuResult {
        menu_popup(ctx, pal, id, pos, entries, opened_now, &mut self.menu_sub, &mut self.menu_fly)
    }

    /// Контекстное меню строки чата (правый клик). Условия показа пунктов — как в клиенте.
    pub(crate) fn chat_menu_ui(&mut self, ctx: &egui::Context, pal: &Pal, opened_now: bool) {
        let Some((cid, pos)) = self.ctx_menu else { return };
        let Some(chat) = self.chats.iter().find(|c| c.id == cid).cloned() else {
            self.ctx_menu = None;
            return;
        };
        let me = self.me();
        let (room, group, direct) = (chat.kind == "room", chat.kind == "group", chat.kind == "direct");
        let can_delete = direct || (group && !chat.fed_mirror && chat.created_by == me);
        let mut e: Vec<Entry> = vec![];
        if !room {
            e.push(Entry::item(&icons::PIN, if chat.pinned { "Открепить" } else { "Закрепить" }));
        }
        e.push(Entry::with_sub(&icons::FOLDER, "В папку", vec![(&icons::PLUS, "Новая папка…")]));
        if chat.muted {
            e.push(Entry::item(&icons::BELL, "Включить уведомления"));
        } else {
            e.push(Entry::with_sub(
                &icons::BELL_OFF,
                "Уведомления",
                vec![(&icons::BELL_OFF, "На 1 час"), (&icons::BELL_OFF, "На 8 часов"), (&icons::BELL_OFF, "На сутки"), (&icons::BELL_OFF, "Навсегда")],
            ));
        }
        if direct {
            e.push(Entry::item(&icons::BAN, "Заблокировать"));
        }
        let tail = (!room && can_delete) || (group && !can_delete);
        if tail {
            e.push(Entry::Sep);
        }
        if !room && can_delete {
            e.push(Entry::Item { icon: &icons::TRASH, label: "Удалить чат".into(), danger_text: true, danger_icon: false, sub: vec![], chevron: false });
        }
        if group && !can_delete {
            e.push(Entry::item(&icons::LOG_OUT, "Выйти из группы"));
        }
        match self.popup_menu(ctx, pal, "chat_menu", pos, &e, opened_now) {
            MenuResult::Open => {}
            MenuResult::Close | MenuResult::Picked(_) => {
                self.ctx_menu = None;
                self.menu_sub = None;
                self.menu_fly = None;
            }
        }
    }

    /// Контекстное меню сообщения (правый клик по пузырю).
    pub(crate) fn msg_menu_ui(&mut self, ctx: &egui::Context, pal: &Pal, opened_now: bool) {
        let Some((cid, mid, pos)) = self.msg_menu else { return };
        let Some(m) = self.msgs.get(&cid).and_then(|l| l.iter().find(|m| m.id == mid)).cloned() else {
            self.msg_menu = None;
            return;
        };
        let direct = self.chats.iter().find(|c| c.id == cid).map_or(true, |c| c.kind == "direct");
        let mine = m.sender_id == self.me();
        let now = Local::now().timestamp();
        let mut e: Vec<Entry> = vec![Entry::Reactions, Entry::item(&icons::REPLY, "Ответить"), Entry::item(&icons::FORWARD, "Переслать")];
        let copy_idx = e.len();
        e.push(Entry::item(&icons::COPY, "Скопировать"));
        e.push(Entry::Sep);
        e.push(Entry::item(&icons::PIN, "Закрепить"));
        if mine && now - m.sent_at < 120 {
            e.push(Entry::item(&icons::PENCIL, "Изменить"));
        }
        if mine {
            if let Some(st) = m.status.filter(|s| s.total > 0) {
                let label = if st.delivered == 0 && st.read == 0 {
                    "Не доставлено".to_string()
                } else if direct {
                    if st.read > 0 { "Прочитано".to_string() } else { "Не прочитано".to_string() }
                } else if st.read >= st.total {
                    "Прочитали все".to_string()
                } else if st.read > 0 {
                    format!("Прочитано {}/{}", st.read, st.total)
                } else {
                    "Не прочитано".to_string()
                };
                e.push(Entry::Item { icon: &icons::CHECK_CHECK, label, danger_text: false, danger_icon: false, sub: vec![], chevron: true });
            }
            e.push(Entry::Sep);
            e.push(Entry::Item { icon: &icons::TRASH, label: "Удалить".into(), danger_text: true, danger_icon: true, sub: vec![], chevron: false });
        }
        let day = view::day_label(m.sent_at);
        let edited = if m.edited { " · изменено" } else { "" };
        e.push(Entry::Caption(format!("{day}, {}{edited}", view::fmt_time(m.sent_at))));
        match self.popup_menu(ctx, pal, "msg_menu", pos, &e, opened_now) {
            MenuResult::Open => {}
            MenuResult::Picked(i) => {
                if i == copy_idx {
                    ctx.copy_text(m.text.clone());
                }
                self.msg_menu = None;
                self.menu_sub = None;
                self.menu_fly = None;
            }
            MenuResult::Close => {
                self.msg_menu = None;
                self.menu_sub = None;
                self.menu_fly = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Меню строки чата: ширина 192, пункт 34 — как в Electron.
    #[test]
    fn menu_geometry() {
        let ctx = egui::Context::default();
        let pal = Pal::dark();
        let entries = vec![
            Entry::item(&icons::PIN, "Закрепить"),
            Entry::with_sub(&icons::FOLDER, "В папку", vec![(&icons::PLUS, "Новая папка…")]),
            Entry::with_sub(&icons::BELL_OFF, "Уведомления", vec![(&icons::BELL_OFF, "На 1 час")]),
            Entry::item(&icons::BAN, "Заблокировать"),
            Entry::Sep,
            Entry::Item { icon: &icons::TRASH, label: "Удалить чат".into(), danger_text: true, danger_icon: false, sub: vec![], chevron: false },
        ];
        let (mut sub, mut fly) = (None, None);
        for _ in 0..4 {
            let input = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1000.0, 700.0))),
                ..Default::default()
            };
            let mut out = ctx.run_ui(input, |ui| {
                let _ = menu_popup(ui.ctx(), &pal, "chat_menu", pos2(100.0, 100.0), &entries, false, &mut sub, &mut fly);
            });
            out.textures_delta.clear();
        }
        let r = ctx.memory(|m| m.area_rect(Id::new("chat_menu"))).expect("area");
        eprintln!("MENU rect = {r:?} size = {:?}", r.size());
        assert!((r.width() - 192.0).abs() < 1.0, "ширина меню {}", r.width());
        let expect_h = 10.0 + 4.0 * 34.0 + 7.0 + 34.0 + 5.0 * 1.0;
        assert!((r.height() - expect_h).abs() < 1.5, "высота меню {} ожидалось {}", r.height(), expect_h);
    }
}
