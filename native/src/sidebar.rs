//! Сайдбар в дизайне Electron-клиента (flat): шапка, поиск, фильтр, список, меню, таббар.
//! Кнопки, вкладки и меню нарисованы визуально; на деле работают поиск, фильтр, смена темы,
//! проверка обновления и выход.
use super::*;
use crate::icons::{self, Icon};
use crate::view::{self, ContactRow, RowOut};
use crate::menus::pop_shadow;
use eframe::egui::{Order, Shadow, StrokeKind};

const TABBAR_H: f32 = 70.0;

/// Тёмная подсказка справа от пункта меню (.hm-i::after).
fn tip_right(ctx: &egui::Context, pal: &Pal, r: Rect, text: &str) {
    egui::Area::new(Id::new("hm_tip")).order(Order::Tooltip).fixed_pos(pos2(r.right() + 10.0, r.center().y - 12.0)).interactable(false).show(ctx, |ui| {
        egui::Frame::new().fill(pal.text).corner_radius(8).inner_margin(Margin::symmetric(9, 5)).show(ui, |ui| {
            ui.label(RichText::new(text).font(FontId::new(12.0, bold())).color(pal.app_bg));
        });
    });
}

/// Кнопка шапки: 36×36, радиус 12, без фона; при наведении — gl-card2, при открытом меню — accent-soft.
fn head_btn(ui: &mut Ui, pal: &Pal, id: &str, r: Rect, icon: &Icon, stroke: f32, active: bool) -> egui::Response {
    let resp = ui.interact(r, Id::new(id), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
    if active {
        ui.painter().rect_filled(r, 12, pal.accent_soft);
    } else if resp.hovered() {
        ui.painter().rect_filled(r, 12, pal.hover2);
    }
    let col = if active { pal.accent_ink } else { pal.text };
    icons::paint(ui, icon, Rect::from_center_size(r.center(), vec2(16.0, 16.0)), col, stroke);
    resp
}

fn section_label(ui: &mut Ui, pal: &Pal, text: &str, first: bool) {
    let top = if first { 0.0 } else { 12.0 };
    let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), top + 4.0 + 15.0), Sense::hover());
    let mut job = egui::text::LayoutJob::default();
    job.append(
        text,
        0.0,
        egui::TextFormat { font_id: FontId::new(11.5, bold()), color: pal.muted, extra_letter_spacing: 0.4, ..Default::default() },
    );
    let g = ui.painter().layout_job(job);
    ui.painter().galley(pos2(r.left() + 12.0, r.top() + top), g, pal.muted);
}

impl App {
    pub(crate) fn sidebar_ui(&mut self, ui: &mut Ui, pal: &Pal) {
        let ctx = ui.ctx().clone();
        let card = ui.available_rect_before_wrap();
        let shadow = Shadow {
            offset: [0, 10],
            blur: 30,
            spread: 0,
            color: if pal.dark { Color32::from_black_alpha(90) } else { Color32::from_rgba_unmultiplied(60, 40, 20, 18) },
        };
        ui.painter().add(shadow.as_shape(card, 22));
        ui.painter().rect_filled(card, 22, pal.side_bg);

        // ── Шапка: высота 56, padding 0 14 0 16 ──
        let head = Rect::from_min_size(card.min, vec2(card.width(), 56.0));
        let wm = view::wordmark(ui.painter(), pal);
        ui.painter().galley(pos2(head.left() + 16.0, head.center().y - wm.size().y / 2.0), wm, pal.text);
        let plus = Rect::from_center_size(pos2(head.right() - 14.0 - 18.0, head.center().y), vec2(36.0, 36.0));
        let more = Rect::from_center_size(pos2(plus.left() - 2.0 - 18.0, head.center().y), vec2(36.0, 36.0));
        let more_icon = if self.head_menu { &icons::CHEVRON_UP } else { &icons::CHEVRON_DOWN };
        let more_resp = head_btn(ui, pal, "head_more", more, more_icon, 2.0, self.head_menu);
        head_btn(ui, pal, "head_new", plus, &icons::PLUS, 2.5, false);
        if more_resp.clicked() {
            self.head_menu = !self.head_menu;
        }

        // ── Поиск: высота 40, радиус 12, фон surf2, лупа 14 ──
        let sr = Rect::from_min_size(pos2(card.left() + 14.0, head.bottom() + 4.0), vec2(card.width() - 28.0, 40.0));
        let sid = Id::new("chat_search");
        let tab = self.tab;
        let focused = ui.memory(|m| m.has_focus(sid));
        ui.painter().rect_filled(sr, 12, pal.surf2);
        if focused {
            ui.painter().rect_stroke(sr.expand(1.5), 13, Stroke::new(3.0, pal.accent_soft), StrokeKind::Inside);
            ui.painter().rect_stroke(sr, 12, Stroke::new(1.0, pal.accent), StrokeKind::Inside);
        }
        icons::paint(ui, &icons::SEARCH, Rect::from_center_size(pos2(sr.left() + 14.0 + 7.0, sr.center().y), vec2(14.0, 14.0)), pal.text2, 2.0);
        let hint = if tab == 1 { "Поиск контактов..." } else { "Поиск чатов..." };
        let buf: &mut String = if tab == 1 { &mut self.contacts_search } else { &mut self.search };
        let has_text = !buf.is_empty();
        let text_rect = Rect::from_min_max(
            pos2(sr.left() + 14.0 + 14.0 + 8.0, sr.top()),
            pos2(sr.right() - 14.0 - if has_text { 24.0 } else { 0.0 }, sr.bottom()),
        );
        ui.put(
            text_rect,
            TextEdit::singleline(&mut *buf)
                .id(sid)
                .hint_text(RichText::new(hint).color(pal.muted))
                .desired_width(f32::INFINITY)
                .frame(egui::Frame::NONE)
                .vertical_align(Align::Center)
                .font(FontId::proportional(13.0)),
        );
        if has_text {
            let cr = Rect::from_center_size(pos2(sr.right() - 14.0 - 8.0, sr.center().y), vec2(16.0, 16.0));
            let resp = ui.interact(cr, Id::new("search_clear"), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
            icons::paint(ui, &icons::X, Rect::from_center_size(cr.center(), vec2(12.0, 12.0)), if resp.hovered() { pal.text } else { pal.muted }, 2.5);
            if resp.clicked() {
                buf.clear();
            }
        }

        // ── Фильтр-сегмент: высота 34, padding 3, gap 2, радиус 14 ──
        let fr = Rect::from_min_size(pos2(card.left() + 14.0, sr.bottom() + 10.0), vec2(card.width() - 28.0, 34.0));
        if tab == 0 {
        ui.painter().rect_filled(fr, 14, pal.surf2);
        let inner = fr.shrink(3.0);
        let bw = (inner.width() - 3.0 * 2.0) / 4.0;
        for (i, label) in ["Все", "Новые", "Личные", "Группы"].iter().enumerate() {
            let r = Rect::from_min_size(pos2(inner.left() + i as f32 * (bw + 2.0), inner.top()), vec2(bw, inner.height()));
            let resp = ui.interact(r, Id::new(("flt", i)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
            let on = self.filter == i;
            if on {
                if !pal.dark {
                    ui.painter().rect_filled(r.translate(vec2(0.0, 1.0)), 11, Color32::from_rgba_unmultiplied(60, 40, 20, 30));
                }
                ui.painter().rect_filled(r, 11, if pal.dark { pal.hover2 } else { pal.side_bg });
            }
            let col = if on || resp.hovered() { pal.text } else { pal.text2 };
            ui.painter().text(r.center(), Align2::CENTER_CENTER, *label, FontId::new(12.5, bold()), col);
            if resp.clicked() {
                self.filter = i;
            }
        }
        }

        // ── Список: от фильтра (+8) до таббара; padding 0 10 10 ──
        let list_top = if tab == 0 { fr.bottom() + 8.0 } else { sr.bottom() + 10.0 };
        let list_rect = Rect::from_min_max(pos2(card.left() + 10.0, list_top), pos2(card.right() - 10.0, card.bottom() - TABBAR_H));
        let (mut clicked, mut menu_for): (Option<i64>, Option<(i64, egui::Pos2)>) = (None, None);
        if tab == 1 {
            self.contacts_list(ui, pal, list_rect);
        }
        if tab == 0 {
        let me = self.me();
        let server = self.session.as_ref().map(|s| s.server.clone()).unwrap_or_default();
        let q = self.search.trim().to_lowercase();
        let filt = self.filter;
        let visible: Vec<&Chat> = self
            .chats
            .iter()
            .filter(|c| q.is_empty() || c.title(me).to_lowercase().contains(&q))
            .filter(|c| match filt {
                1 => c.unread > 0,
                2 => c.kind == "direct",
                3 => c.kind != "direct",
                _ => true,
            })
            .collect();
        let (pinned, rest): (Vec<&Chat>, Vec<&Chat>) = visible.into_iter().partition(|c| c.pinned);
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(list_rect).layout(egui::Layout::top_down(Align::Min)));
        child.set_clip_rect(list_rect);
        egui::ScrollArea::vertical().id_salt("chat_list").auto_shrink([false, false]).show(&mut child, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            let mut row = |ui: &mut Ui, c: &Chat| {
                let typers = self.typers(c.id);
                let typing = (!typers.is_empty()).then(|| typing_label(&typers, c.kind != "direct"));
                let presence = c.peer(me).and_then(|m| self.presence.get(&m.id));
                let r = Row { c, me, server: &server, active: self.selected == Some(c.id), typing, presence };
                let out: RowOut = view::chat_row(ui, pal, &r);
                if out.clicked {
                    clicked = Some(c.id);
                }
                if let Some(pos) = out.menu_at {
                    menu_for = Some((c.id, pos));
                }
                ui.add_space(2.0);
            };
            if !pinned.is_empty() {
                section_label(ui, pal, "ЗАКРЕПЛЁННЫЕ", true);
                for c in &pinned {
                    row(ui, c);
                }
                section_label(ui, pal, "ВСЕ ЧАТЫ", false);
            }
            for c in &rest {
                row(ui, c);
            }
            let empty = pinned.is_empty() && rest.is_empty();
            if !self.chats_loaded {
                ui.add_space(16.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
            } else if empty {
                ui.add_space(16.0);
                let t = if self.chats.is_empty() { "Нет чатов" } else { "Ничего не найдено" };
                ui.vertical_centered(|ui| ui.label(RichText::new(t).color(pal.muted)));
            }
        });
        }
        if let Some(id) = clicked {
            self.select(id);
            self.ctx_menu = None;
        }
        let opened_now = menu_for.is_some();
        if let Some(m) = menu_for {
            self.ctx_menu = Some(m);
            self.msg_menu = None;
            self.head_menu = false;
        }

        // ── Таббар: padding 8 10 10, вкладка 52, значок 21, подпись 11 ──
        let tb = Rect::from_min_max(pos2(card.left(), card.bottom() - TABBAR_H), card.max);
        ui.painter().rect_filled(tb, CornerRadius { nw: 0, ne: 0, sw: 22, se: 22 }, pal.side_bg);
        // тень над таббаром (bar-sh-up)
        let mut mesh = egui::Mesh::default();
        let (top_c, bot_c) = if pal.dark { (Color32::from_black_alpha(0), Color32::from_black_alpha(38)) } else { (Color32::from_rgba_unmultiplied(60, 40, 20, 0), Color32::from_rgba_unmultiplied(60, 40, 20, 14)) };
        let sh = Rect::from_min_max(pos2(card.left() + 10.0, tb.top() - 12.0), pos2(card.right() - 10.0, tb.top()));
        mesh.colored_vertex(sh.left_top(), top_c);
        mesh.colored_vertex(sh.right_top(), top_c);
        mesh.colored_vertex(sh.right_bottom(), bot_c);
        mesh.colored_vertex(sh.left_bottom(), bot_c);
        mesh.add_triangle(0, 1, 2);
        mesh.add_triangle(0, 2, 3);
        ui.painter().add(egui::Shape::mesh(mesh));
        let tw = (tb.width() - 20.0) / 3.0;
        let tabs: [(&Icon, &str); 3] = [(&icons::MESSAGE_CIRCLE, "Чаты"), (&icons::USERS, "Контакты"), (&icons::SETTINGS, "Настройки")];
        for (i, (icon, label)) in tabs.iter().enumerate() {
            let r = Rect::from_min_size(pos2(tb.left() + 10.0 + i as f32 * tw, tb.top() + 8.0), vec2(tw, 52.0));
            let resp = ui.interact(r, Id::new(("tab", i)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
            let on = self.tab == i;
            if !on && resp.hovered() {
                ui.painter().rect_filled(r, 12, pal.hover);
            }
            let col = if on { pal.accent_ink } else if resp.hovered() { pal.text } else { pal.muted };
            icons::paint(ui, icon, Rect::from_center_size(pos2(r.center().x, r.top() + 8.0 + 10.5), vec2(21.0, 21.0)), col, 2.0);
            ui.painter().text(pos2(r.center().x, r.top() + 8.0 + 21.0 + 3.0), Align2::CENTER_TOP, *label, FontId::new(11.0, crate::theme::medium()), col);
            if i == 2 && self.upd_avail.is_some() {
                let c = pos2(r.center().x + 12.0, r.top() + 10.0);
                ui.painter().circle_filled(c, 4.0, pal.danger);
            }
            if resp.clicked() {
                self.tab = i;
            }
        }

        self.head_menu_ui(&ctx, pal, more, more_resp.clicked());
        self.chat_menu_ui(&ctx, pal, opened_now);
    }

    /// Вкладка «Контакты»: люди из каталога, секции «Онлайн / Отошёл / Не в сети», клик — личный чат.
    fn contacts_list(&mut self, ui: &mut Ui, pal: &Pal, rect: Rect) {
        let me = self.me();
        let server = self.session.as_ref().map(|s| s.server.clone()).unwrap_or_default();
        let show_ws = self.session.as_ref().map_or(false, |s| s.ws_count > 1);
        let q = self.contacts_search.trim().to_lowercase();
        let rank = |id: i64| match self.presence.get(&id).map(|p| p.status.as_str()) {
            Some("online") => 0usize,
            Some("away") => 1,
            _ => 2,
        };
        let mut list: Vec<&model::Contact> = self
            .contacts
            .iter()
            .filter(|u| u.id != me && u.rel != "chat")
            .filter(|u| q.is_empty() || u.name.to_lowercase().contains(&q) || u.username.to_lowercase().contains(&q))
            .collect();
        list.sort_by(|a, b| rank(a.id).cmp(&rank(b.id)).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        let mut open: Option<i64> = None;
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(rect).layout(egui::Layout::top_down(Align::Min)));
        child.set_clip_rect(rect);
        egui::ScrollArea::vertical().id_salt("contacts_list").auto_shrink([false, false]).show(&mut child, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            if !self.contacts_loaded {
                ui.add_space(16.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Загрузка…").color(pal.muted)));
                return;
            }
            if list.is_empty() {
                contacts_stub(ui, pal, !q.is_empty());
                return;
            }
            let titles = ["ОНЛАЙН", "ОТОШЁЛ", "НЕ В СЕТИ"];
            let mut last: Option<usize> = None;
            for u in &list {
                let r = rank(u.id);
                if last != Some(r) {
                    section_label(ui, pal, titles[r], last.is_none());
                    last = Some(r);
                }
                let row = ContactRow { u, server: &server, presence: self.presence.get(&u.id), show_ws };
                if view::contact_row(ui, pal, &row) {
                    open = Some(u.id);
                }
                ui.add_space(2.0);
            }
        });
        if let Some(id) = open {
            if let Some(s) = &self.session {
                self.net.open_direct(s, id);
            }
        }
    }

    /// Меню «Ещё»: узкая колонка значков 30×30 с подсказками справа.
    fn head_menu_ui(&mut self, ctx: &egui::Context, pal: &Pal, more: Rect, more_clicked: bool) {
        if !self.head_menu {
            return;
        }
        let theme_icon = if pal.dark { &icons::MOON } else { &icons::SUN };
        let items: [(&Icon, &str); 4] = [
            (&icons::PANEL_LEFT, "Скрыть панель"),
            (theme_icon, "Сменить тему"),
            (&icons::REFRESH_CW, "Проверить обновления"),
            (&icons::LOG_OUT, "Выйти"),
        ];
        let (mut picked, mut tip): (Option<usize>, Option<(Rect, &str)>) = (None, None);
        let area = egui::Area::new(Id::new("head_menu"))
            .order(Order::Foreground)
            .fixed_pos(pos2(more.center().x - 21.0, more.bottom() + 4.0))
            .show(ctx, |ui| {
                egui::Frame::new().fill(pal.side_bg).corner_radius(16).inner_margin(Margin::same(6)).shadow(pop_shadow(pal)).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 2.0;
                    for (i, (icon, label)) in items.iter().enumerate() {
                        let (r, _) = ui.allocate_exact_size(vec2(30.0, 30.0), Sense::hover());
                        let resp = ui.interact(r, Id::new(("hm_item", i)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                        if resp.hovered() {
                            ui.painter().rect_filled(r, 12, pal.hover);
                            tip = Some((r, label));
                        }
                        icons::paint(ui, icon, Rect::from_center_size(r.center(), vec2(16.0, 16.0)), if resp.hovered() { pal.text } else { pal.text2 }, 2.0);
                        if resp.clicked() {
                            picked = Some(i);
                        }
                    }
                });
            });
        if let Some((r, t)) = tip {
            tip_right(ctx, pal, r, t);
        }
        let outside = ctx.input(|i| i.pointer.any_click()) && !more_clicked && !ctx.input(|i| i.pointer.interact_pos()).map_or(false, |p| area.response.rect.contains(p));
        if outside || ctx.input(|i| i.key_pressed(Key::Escape)) {
            self.head_menu = false;
        }
        match picked {
            Some(1) => {
                ctx.set_theme(if pal.dark { egui::ThemePreference::Light } else { egui::ThemePreference::Dark });
                self.head_menu = false;
            }
            Some(2) => {
                self.head_menu = false;
                if self.upd_avail.is_some() {
                    self.upd_modal = true;
                } else if !self.upd_checking {
                    self.upd_checking = true;
                    self.net.check_update(false);
                }
            }
            Some(3) => {
                self.head_menu = false;
                self.logout("");
            }
            Some(_) => self.head_menu = false,
            None => {}
        }
    }
}

/// Заглушка пустого списка (.cs-stub): круг 64 с акцентным значком, заголовок, пояснение, кнопка.
fn contacts_stub(ui: &mut Ui, pal: &Pal, searching: bool) {
    let (icon, title, text) = if searching {
        (&icons::SEARCH, "Никого не нашлось", "Проверьте написание имени или логина.")
    } else {
        (&icons::USER, "Контактов пока нет", "В вашем пространстве больше никого нет. Человека из другого пространства можно добавить по логину.")
    };
    ui.add_space(40.0);
    let w = ui.available_width();
    let (r, _) = ui.allocate_exact_size(vec2(w, 64.0), Sense::hover());
    let circle = Rect::from_center_size(r.center(), vec2(64.0, 64.0));
    ui.painter().circle_filled(circle.center(), 32.0, pal.accent_soft);
    icons::paint(ui, icon, Rect::from_center_size(circle.center(), vec2(28.0, 28.0)), pal.accent_ink, 2.0);
    ui.add_space(14.0);
    ui.vertical_centered(|ui| {
        ui.label(RichText::new(title).font(FontId::new(16.0, bold())).color(pal.text));
        ui.add_space(4.0);
        ui.scope(|ui| {
            ui.set_max_width(280.0);
            ui.label(RichText::new(text).size(13.0).color(pal.text2));
        });
        if !searching {
            ui.add_space(12.0);
            let b = egui::Button::new(RichText::new("Добавить контакт").font(FontId::new(14.0, bold())).color(Color32::WHITE))
                .fill(pal.accent_fill)
                .corner_radius(12)
                .min_size(vec2(180.0, 40.0));
            ui.add(b);
        }
    });
}
