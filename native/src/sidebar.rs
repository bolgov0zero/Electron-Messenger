//! Сайдбар в дизайне Electron-клиента (flat): шапка, поиск, фильтр, список, меню, таббар.
//! Кнопки, вкладки и меню нарисованы визуально; на деле работают поиск, фильтр, смена темы,
//! проверка обновления и выход.
use super::*;
use crate::icons::{self, Icon};
use crate::view::{self, RowOut};
use eframe::egui::{Order, Shadow, StrokeKind};

const TABBAR_H: f32 = 70.0;

fn pop_shadow(pal: &Pal) -> Shadow {
    Shadow {
        offset: [0, 18],
        blur: 44,
        spread: 0,
        color: if pal.dark { Color32::from_black_alpha(140) } else { Color32::from_rgba_unmultiplied(60, 40, 20, 41) },
    }
}

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
        let focused = ui.memory(|m| m.has_focus(sid));
        ui.painter().rect_filled(sr, 12, pal.surf2);
        if focused {
            ui.painter().rect_stroke(sr.expand(1.5), 13, Stroke::new(3.0, pal.accent_soft), StrokeKind::Inside);
            ui.painter().rect_stroke(sr, 12, Stroke::new(1.0, pal.accent), StrokeKind::Inside);
        }
        icons::paint(ui, &icons::SEARCH, Rect::from_center_size(pos2(sr.left() + 14.0 + 7.0, sr.center().y), vec2(14.0, 14.0)), pal.text2, 2.0);
        let has_text = !self.search.is_empty();
        let text_rect = Rect::from_min_max(
            pos2(sr.left() + 14.0 + 14.0 + 8.0, sr.top()),
            pos2(sr.right() - 14.0 - if has_text { 24.0 } else { 0.0 }, sr.bottom()),
        );
        ui.put(
            text_rect,
            TextEdit::singleline(&mut self.search)
                .id(sid)
                .hint_text(RichText::new("Поиск чатов...").color(pal.muted))
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
                self.search.clear();
            }
        }

        // ── Фильтр-сегмент: высота 34, padding 3, gap 2, радиус 14 ──
        let fr = Rect::from_min_size(pos2(card.left() + 14.0, sr.bottom() + 10.0), vec2(card.width() - 28.0, 34.0));
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

        // ── Список: от фильтра (+8) до таббара; padding 0 10 10 ──
        let list_rect = Rect::from_min_max(pos2(card.left() + 10.0, fr.bottom() + 8.0), pos2(card.right() - 10.0, card.bottom() - TABBAR_H));
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
        let (mut clicked, mut menu_for) = (None, None);
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
        if let Some(id) = clicked {
            self.select(id);
            self.ctx_menu = None;
        }
        let opened_now = menu_for.is_some();
        if let Some(m) = menu_for {
            self.ctx_menu = Some(m);
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
            ui.painter().text(pos2(r.center().x, r.top() + 8.0 + 21.0 + 3.0), Align2::CENTER_TOP, *label, FontId::new(11.0, bold()), col);
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

    /// Контекстное меню строки чата (правый клик): пункты только визуальные.
    fn chat_menu_ui(&mut self, ctx: &egui::Context, pal: &Pal, opened_now: bool) {
        let Some((cid, pos)) = self.ctx_menu else { return };
        let Some(chat) = self.chats.iter().find(|c| c.id == cid).cloned() else {
            self.ctx_menu = None;
            return;
        };
        // (значок, подпись, есть подменю); None — разделитель
        let mut items: Vec<Option<(&Icon, &str, bool)>> = vec![
            Some((&icons::PIN, if chat.pinned { "Открепить" } else { "Закрепить" }, false)),
            Some((&icons::FOLDER, "В папку", true)),
            Some((&icons::BELL_OFF, "Уведомления", true)),
            None,
            Some((&icons::TRASH, "Удалить чат", false)),
        ];
        if chat.kind != "direct" {
            items.push(Some((&icons::LOG_OUT, "Выйти из группы", false)));
        }
        let mut picked = false;
        let area = egui::Area::new(Id::new("chat_menu")).order(Order::Foreground).fixed_pos(pos).show(ctx, |ui| {
            egui::Frame::new().fill(pal.side_bg).corner_radius(16).inner_margin(Margin::same(5)).shadow(pop_shadow(pal)).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                ui.set_min_width(182.0);
                for (i, it) in items.iter().enumerate() {
                    match it {
                        None => {
                            let (r, _) = ui.allocate_exact_size(vec2(182.0, 7.0), Sense::hover());
                            ui.painter().line_segment(
                                [pos2(r.left() + 10.0, r.center().y), pos2(r.right() - 10.0, r.center().y)],
                                Stroke::new(1.0, alpha(pal.text, 23)),
                            );
                        }
                        Some((icon, label, sub)) => {
                            let (r, _) = ui.allocate_exact_size(vec2(182.0, 34.0), Sense::hover());
                            let resp = ui.interact(r, Id::new(("cm_item", i)), Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                            if resp.hovered() {
                                ui.painter().rect_filled(r, 12, pal.hover);
                            }
                            icons::paint(ui, icon, Rect::from_center_size(pos2(r.left() + 10.0 + 8.0, r.center().y), vec2(16.0, 16.0)), pal.accent_ink, 2.0);
                            ui.painter().text(pos2(r.left() + 10.0 + 16.0 + 10.0, r.center().y), Align2::LEFT_CENTER, *label, FontId::proportional(13.0), pal.text);
                            if *sub {
                                icons::paint(ui, &icons::CHEVRON_RIGHT, Rect::from_center_size(pos2(r.right() - 10.0 - 7.0, r.center().y), vec2(14.0, 14.0)), pal.muted, 2.4);
                            }
                            if resp.clicked() && !*sub {
                                picked = true;
                            }
                        }
                    }
                }
            });
        });
        let outside = !opened_now && ctx.input(|i| i.pointer.any_click()) && !ctx.input(|i| i.pointer.interact_pos()).map_or(false, |p| area.response.rect.contains(p));
        if outside || picked || ctx.input(|i| i.key_pressed(Key::Escape)) {
            self.ctx_menu = None;
        }
    }
}
