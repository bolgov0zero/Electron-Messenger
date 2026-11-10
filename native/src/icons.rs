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

/// Рисует значок в `rect` цветом `color` с толщиной штриха `stroke` (в единицах viewBox 24).
pub fn paint(ui: &mut Ui, icon: &Icon, rect: Rect, color: Color32, stroke: f32) {
    let hex = format!("#{:02x}{:02x}{:02x}", color.r(), color.g(), color.b());
    let opacity = color.a() as f32 / 255.0;
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{hex}" stroke-opacity="{opacity:.2}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{}</svg>"#,
        icon.body
    );
    let uri = format!("bytes://icon-{}-{hex}-{:.0}-{stroke}.svg", icon.name, opacity * 100.0);
    ui.put(
        rect,
        egui::Image::new(egui::ImageSource::Bytes { uri: Cow::Owned(uri), bytes: svg.into_bytes().into() })
            .fit_to_exact_size(rect.size()),
    );
}
