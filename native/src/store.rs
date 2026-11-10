//! Хранение: токен — в связке ключей macOS, адрес сервера и логин — в prefs.json.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SERVICE: &str = "chat-native";

#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub server: String,
    pub token: String,
    pub user_id: i64,
    pub name: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Prefs {
    pub server: String,
    pub username: String,
}

fn prefs_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join("Library/Application Support/ChatNative/prefs.json"))
}

pub fn load_prefs() -> Prefs {
    prefs_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_prefs(p: &Prefs) {
    if let Some(path) = prefs_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string(p) {
            let _ = std::fs::write(path, s);
        }
    }
}

pub fn load_session() -> Option<Session> {
    let e = keyring::Entry::new(SERVICE, "session").ok()?;
    let s = e.get_password().ok()?;
    serde_json::from_str(&s).ok()
}

pub fn save_session(s: &Session) {
    if let (Ok(e), Ok(json)) = (keyring::Entry::new(SERVICE, "session"), serde_json::to_string(s)) {
        let _ = e.set_password(&json);
    }
}

pub fn clear_session() {
    if let Ok(e) = keyring::Entry::new(SERVICE, "session") {
        let _ = e.delete_credential();
    }
}
