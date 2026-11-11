//! Токены дизайна клиента (client/src/flat.css): светлая тема и тёмно-синяя.
use eframe::egui::{self, Color32, FontData, FontDefinitions, FontFamily};
use std::sync::Arc;

#[derive(Clone, Copy)]
pub struct Pal {
    pub app_bg: Color32,
    pub side_bg: Color32,
    pub chat_bg: Color32,
    pub bubble_bg: Color32,
    pub text: Color32,
    pub text2: Color32,
    pub muted: Color32,
    pub surf2: Color32,
    pub sel: Color32,
    pub accent: Color32,
    pub accent_fill: Color32,
    pub accent_soft: Color32,
    pub accent_ink: Color32,
    pub danger: Color32,
    pub hover: Color32,
    pub daypill: Color32,
    pub online: Color32,
    pub away: Color32,
    pub chip: Color32,
    pub hover2: Color32,
    pub dark: bool,
}

pub fn rgb(h: u32) -> Color32 {
    Color32::from_rgb((h >> 16) as u8, (h >> 8) as u8, h as u8)
}

/// Смесь двух цветов: t — доля `b`.
pub fn mix(a: Color32, b: Color32, t: f32) -> Color32 {
    let f = |x: u8, y: u8| (x as f32 * (1.0 - t) + y as f32 * t).round() as u8;
    Color32::from_rgb(f(a.r(), b.r()), f(a.g(), b.g()), f(a.b(), b.b()))
}

pub fn alpha(c: Color32, a: u8) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), a)
}

/// Палитра цветов аватарок и имён отправителей.
pub fn av_color(key: i64) -> Color32 {
    const C: [u32; 8] = [0xe17076, 0xe8a33d, 0xa695e7, 0x59b34a, 0x4cb8bd, 0x5a9fd6, 0xe0709f, 0xc98a4b];
    rgb(C[(key.unsigned_abs() % 8) as usize])
}

impl Pal {
    pub fn light() -> Self {
        let (text, side, chat) = (rgb(0x1d1b19), rgb(0xfdfcfa), rgb(0xf7f5f1));
        let accent = rgb(0x1fa88c);
        Pal {
            app_bg: rgb(0xece9e4),
            side_bg: side,
            chat_bg: chat,
            bubble_bg: Color32::WHITE,
            text,
            text2: rgb(0x5b554e),
            muted: rgb(0x766e65),
            surf2: rgb(0xf3f0eb),
            sel: rgb(0xefebe5),
            accent,
            accent_fill: mix(accent, Color32::BLACK, 0.20),
            accent_soft: mix(side, accent, 0.13),
            accent_ink: mix(accent, Color32::BLACK, 0.28),
            danger: rgb(0xd23a3a),
            hover: alpha(text, 13),
            daypill: mix(chat, text, 0.09),
            online: rgb(0x34c759),
            away: rgb(0xff9f0a),
            chip: rgb(0xe3e1de),
            hover2: rgb(0xebeae8),
            dark: false,
        }
    }

    pub fn dark() -> Self {
        let (text, side, chat) = (rgb(0xeef2f6), rgb(0x18202a), rgb(0x0f1b27));
        let accent = rgb(0x29d6b8);
        Pal {
            app_bg: rgb(0x10161d),
            side_bg: side,
            chat_bg: chat,
            bubble_bg: rgb(0x213040),
            text,
            text2: mix(side, text, 0.74),
            muted: mix(side, text, 0.56),
            surf2: rgb(0x222d3a),
            sel: rgb(0x243242),
            accent,
            accent_fill: mix(accent, Color32::BLACK, 0.30),
            accent_soft: mix(side, accent, 0.13),
            accent_ink: mix(accent, Color32::WHITE, 0.30),
            danger: rgb(0xef6f6f),
            hover: alpha(text, 18),
            daypill: mix(chat, text, 0.09),
            online: rgb(0x30d158),
            away: rgb(0xff9f0a),
            chip: rgb(0x232e3a),
            hover2: rgb(0x2d353e),
            dark: true,
        }
    }
}

pub fn bold() -> FontFamily {
    FontFamily::Name("bold".into())
}

/// Средняя жирность (500): подписи пунктов меню, названия вкладок, имена контактов.
pub fn medium() -> FontFamily {
    FontFamily::Name("medium".into())
}

/// Medeo Sans (обычный и жирный, латиница + кириллица + символы) поверх шрифтов egui.
pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let files: [(&str, &[u8]); 9] = [
        ("m-lat-4", include_bytes!("../assets/fonts/medeo-latin-400.ttf")),
        ("m-cyr-4", include_bytes!("../assets/fonts/medeo-cyrillic-400.ttf")),
        ("m-sym-4", include_bytes!("../assets/fonts/medeo-symbols-400.ttf")),
        ("m-lat-7", include_bytes!("../assets/fonts/medeo-latin-700.ttf")),
        ("m-cyr-7", include_bytes!("../assets/fonts/medeo-cyrillic-700.ttf")),
        ("m-sym-7", include_bytes!("../assets/fonts/medeo-symbols-700.ttf")),
        ("m-lat-5", include_bytes!("../assets/fonts/medeo-latin-500.ttf")),
        ("m-cyr-5", include_bytes!("../assets/fonts/medeo-cyrillic-500.ttf")),
        ("m-sym-5", include_bytes!("../assets/fonts/medeo-symbols-500.ttf")),
    ];
    for (name, bytes) in files {
        fonts.font_data.insert(name.to_owned(), Arc::new(FontData::from_static(bytes)));
    }
    let fallback = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let mut regular: Vec<String> = ["m-lat-4", "m-cyr-4", "m-sym-4"].iter().map(|s| s.to_string()).collect();
    regular.extend(fallback.clone());
    let mut heavy: Vec<String> = ["m-lat-7", "m-cyr-7", "m-sym-7"].iter().map(|s| s.to_string()).collect();
    heavy.extend(fallback.clone());
    let mut mid: Vec<String> = ["m-lat-5", "m-cyr-5", "m-sym-5"].iter().map(|s| s.to_string()).collect();
    mid.extend(fallback);
    fonts.families.insert(medium(), mid);
    fonts.families.insert(FontFamily::Proportional, regular);
    fonts.families.insert(bold(), heavy);
    ctx.set_fonts(fonts);
}

/// Визуальные настройки egui под палитру: плоские поверхности, без обводок.
pub fn visuals(p: &Pal) -> egui::Visuals {
    let mut v = if p.dark { egui::Visuals::dark() } else { egui::Visuals::light() };
    v.panel_fill = p.app_bg;
    v.window_fill = p.side_bg;
    v.extreme_bg_color = p.surf2;
    v.faint_bg_color = p.surf2;
    v.override_text_color = Some(p.text);
    v.hyperlink_color = p.accent;
    v.selection.bg_fill = mix(p.side_bg, p.accent, 0.35);
    v.selection.stroke = egui::Stroke::new(1.0, p.accent);
    v.window_stroke = egui::Stroke::NONE;
    let none = egui::Stroke::NONE;
    for w in [
        &mut v.widgets.noninteractive,
        &mut v.widgets.inactive,
        &mut v.widgets.hovered,
        &mut v.widgets.active,
        &mut v.widgets.open,
    ] {
        w.bg_stroke = none;
        w.corner_radius = egui::CornerRadius::same(12);
    }
    v.widgets.inactive.bg_fill = p.surf2;
    v.widgets.inactive.weak_bg_fill = p.surf2;
    v.widgets.hovered.bg_fill = p.sel;
    v.widgets.hovered.weak_bg_fill = p.sel;
    v.widgets.active.bg_fill = p.sel;
    v.widgets.active.weak_bg_fill = p.sel;
    v
}
