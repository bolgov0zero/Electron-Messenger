//! Значки Lucide (ISC), контурные 24×24 — те же SVG, что встроены в Electron-клиент (client/src/app.js).
//! Рисуются через SVG-загрузчик egui_extras; цвет и толщина штриха подставляются в разметку.
use std::borrow::Cow;

use eframe::egui::{self, Color32, Rect, Ui};

pub struct Icon {
    pub name: &'static str,
    body: &'static str,
}

/// «send» — кнопка отправки (app.js, .send-btn).
pub const SEND: Icon = Icon {
    name: "send",
    body: r#"<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>"#,
};

/// «chevron-down» — кнопка «к последним сообщениям» (app.js, #scroll-bottom-btn).
pub const CHEVRON_DOWN: Icon = Icon { name: "chevron-down", body: r#"<path d="m6 9 6 6 6-6"/>"# };

/// «refresh-cw» — проверка обновления (app.js, csSvg «upd»).
pub const REFRESH_CW: Icon = Icon {
    name: "refresh-cw",
    body: r#"<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>"#,
};

pub const CHEVRON_UP: Icon = Icon {
    name: "chevron-up",
    body: r#"<path d="m18 15-6-6-6 6"/>"#,
};

pub const CHEVRON_RIGHT: Icon = Icon {
    name: "chevron-right",
    body: r#"<path d="m9 18 6-6-6-6"/>"#,
};

pub const PLUS: Icon = Icon {
    name: "plus",
    body: r#"<path d="M5 12h14"/><path d="M12 5v14"/>"#,
};

pub const SEARCH: Icon = Icon {
    name: "search",
    body: r#"<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>"#,
};

pub const X: Icon = Icon {
    name: "x",
    body: r#"<path d="M18 6 6 18"/><path d="m6 6 12 12"/>"#,
};

pub const PANEL_LEFT: Icon = Icon {
    name: "panel-left",
    body: r#"<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>"#,
};

pub const SUN: Icon = Icon {
    name: "sun",
    body: r#"<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>"#,
};

pub const MOON: Icon = Icon {
    name: "moon",
    body: r#"<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>"#,
};

pub const LOG_OUT: Icon = Icon {
    name: "log-out",
    body: r#"<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>"#,
};

pub const PIN: Icon = Icon {
    name: "pin",
    body: r#"<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>"#,
};

pub const BELL_OFF: Icon = Icon {
    name: "bell-off",
    body: r#"<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>"#,
};

pub const FOLDER: Icon = Icon {
    name: "folder",
    body: r#"<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>"#,
};

pub const TRASH: Icon = Icon {
    name: "trash-2",
    body: r#"<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>"#,
};

pub const MESSAGE_CIRCLE: Icon = Icon {
    name: "message-circle",
    body: r#"<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>"#,
};

pub const USERS: Icon = Icon {
    name: "users",
    body: r#"<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>"#,
};

pub const SETTINGS: Icon = Icon {
    name: "settings",
    body: r#"<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>"#,
};

pub const GLOBE: Icon = Icon {
    name: "globe",
    body: r#"<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>"#,
};

pub const USER: Icon = Icon {
    name: "user",
    body: r#"<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>"#,
};

pub const BELL: Icon = Icon {
    name: "bell",
    body: r#"<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>"#,
};

pub const BAN: Icon = Icon {
    name: "ban",
    body: r#"<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>"#,
};

pub const REPLY: Icon = Icon {
    name: "reply",
    body: r#"<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>"#,
};

pub const FORWARD: Icon = Icon {
    name: "forward",
    body: r#"<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>"#,
};

pub const COPY: Icon = Icon {
    name: "copy",
    body: r#"<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>"#,
};

pub const PENCIL: Icon = Icon {
    name: "square-pen",
    body: r#"<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>"#,
};

pub const CHECK_CHECK: Icon = Icon {
    name: "check-check",
    body: r#"<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>"#,
};

/// SVG-разметка значка с подставленным цветом и толщиной штриха.
fn svg_text(icon: &Icon, color: Color32, stroke: f32) -> String {
    let hex = format!("#{:02x}{:02x}{:02x}", color.r(), color.g(), color.b());
    let opacity = color.a() as f32 / 255.0;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{hex}" stroke-opacity="{opacity:.2}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{}</svg>"#,
        icon.body
    )
}

/// Адрес картинки в кэше egui. Решётки в нём быть не должно: egui считает остаток фрагментом
/// и теряет расширение .svg, после чего загрузчик SVG отказывается работать.
fn uri_for(icon: &Icon, color: Color32, stroke: f32) -> String {
    let hex = format!("{:02x}{:02x}{:02x}", color.r(), color.g(), color.b());
    format!("bytes://icon-{}-{hex}-{}-{stroke}.svg", icon.name, color.a())
}

/// Рисует значок в `rect` цветом `color` с толщиной штриха `stroke` (в единицах viewBox 24).
pub fn paint(ui: &mut Ui, icon: &Icon, rect: Rect, color: Color32, stroke: f32) {
    let svg = svg_text(icon, color, stroke);
    let uri = uri_for(icon, color, stroke);
    // paint_at: рисуем без сдвига курсора раскладки (ui.put сдвигал его и пункты наезжали друг на друга)
    egui::Image::new(egui::ImageSource::Bytes { uri: Cow::Owned(uri), bytes: svg.into_bytes().into() })
        .fit_to_exact_size(rect.size())
        .paint_at(ui, rect);
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: &[&Icon] = &[&BELL, &BAN, &REPLY, &FORWARD, &COPY, &PENCIL, &CHECK_CHECK, &GLOBE, &USER, &SEND, &CHEVRON_DOWN, &REFRESH_CW, &CHEVRON_UP, &CHEVRON_RIGHT, &PLUS, &SEARCH, &X, &PANEL_LEFT, &SUN, &MOON, &LOG_OUT, &PIN, &BELL_OFF, &FOLDER, &TRASH, &MESSAGE_CIRCLE, &USERS, &SETTINGS];

    #[test]
    fn all_icons_render() {
        let color = Color32::from_rgb(29, 27, 25);
        for icon in ALL {
            let svg = svg_text(icon, color, 2.0);
            let img = egui_extras::image::load_svg_bytes(svg.as_bytes(), &Default::default());
            let img = img.unwrap_or_else(|e| panic!("{}: {e}", icon.name));
            assert!(img.pixels.iter().any(|p| p.a() > 0), "{}: пустая картинка", icon.name);
            assert!(egui::load::has_extension(&uri_for(icon, color, 2.5), "svg"), "{}: адрес без .svg", icon.name);
        }
    }
}
