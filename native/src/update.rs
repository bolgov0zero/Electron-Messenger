//! Обновление из скользящего пререлиза `native-beta` (GitHub Releases, доступен без токена).
//! Workflow beta-macos.yml после каждой сборки пересоздаёт этот релиз: Chat-native-beta.zip и version.json.
//! Установка: скачать zip → распаковать → вспомогательный скрипт ждёт выхода приложения,
//! подменяет .app и запускает новое.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::Value;

use crate::model::{gi, gs};
use crate::net::{Event, Net};

const BASE: &str = "https://github.com/bolgov0zero/Electron-Messenger/releases/download/native-beta";
const AGENT: &str = "chat-native-updater";

/// Коммит, из которого собрано это приложение (задаётся в CI); у локальной сборки — «dev».
pub fn current_sha() -> &'static str {
    option_env!("GIT_SHA").unwrap_or("dev")
}

pub fn current_build() -> &'static str {
    option_env!("BUILD_NUM").unwrap_or("—")
}

pub fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

#[derive(Clone, Debug)]
pub struct Info {
    pub sha: String,
    pub build: i64,
    pub size: i64,
}

pub enum Upd {
    /// Результат проверки: Some — есть более новая сборка.
    Checked { silent: bool, info: Option<Info>, latest: String },
    Progress(f32),
    Restarting,
    Failed(String),
}

/// Скрипт замены: ждёт выхода приложения, меняет .app и запускает новое; при сбое возвращает старое.
const SCRIPT: &str = r#"#!/bin/bash
PID="$1"; NEW="$2"; OLD="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
rm -rf "$OLD.bak"
if mv "$OLD" "$OLD.bak"; then
  if mv "$NEW" "$OLD"; then
    rm -rf "$OLD.bak"
  else
    mv "$OLD.bak" "$OLD"
  fi
fi
xattr -dr com.apple.quarantine "$OLD" 2>/dev/null
open "$OLD"
"#;

/// Путь к .app, из которого запущено приложение (…/Chat.app/Contents/MacOS/chat-native).
fn app_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Не удалось определить путь приложения: {e}"))?;
    let app = exe.ancestors().nth(3).map(Path::to_path_buf).unwrap_or_default();
    if app.extension().map_or(false, |e| e == "app") {
        Ok(app)
    } else {
        Err("Обновление работает только из установленного приложения (.app)".into())
    }
}

impl Net {
    fn upd(&self, u: Upd) {
        self.emit(Event::Update(u));
    }

    /// Проверка версии. `silent` — без сообщения «обновлений нет».
    pub fn check_update(&self, silent: bool) {
        let n = self.clone();
        self.rt.spawn(async move {
            let res = n.http.get(format!("{BASE}/version.json")).header("User-Agent", AGENT).send().await;
            let resp = match res {
                Ok(r) => r,
                Err(e) => return if !silent { n.upd(Upd::Failed(format!("Нет связи с GitHub: {e}"))) },
            };
            if !resp.status().is_success() {
                return if !silent {
                    n.upd(Upd::Failed("Сборка beta ещё не опубликована".into()))
                };
            }
            let v: Value = resp.json().await.unwrap_or(Value::Null);
            let sha = gs(&v, "sha");
            if sha.is_empty() {
                return if !silent { n.upd(Upd::Failed("Не удалось прочитать версию".into())) };
            }
            let newer = sha != current_sha();
            let info = newer.then(|| Info { sha: sha.clone(), build: gi(&v, "build"), size: gi(&v, "size") });
            n.upd(Upd::Checked { silent, info, latest: sha });
        });
    }

    /// Скачивает и устанавливает сборку, затем просит приложение закрыться.
    pub fn install_update(&self, info: Info) {
        let n = self.clone();
        self.rt.spawn(async move {
            if let Err(e) = n.do_install(info).await {
                n.upd(Upd::Failed(e));
            }
        });
    }

    async fn do_install(&self, info: Info) -> Result<(), String> {
        let app = app_bundle()?;
        let parent = app.parent().ok_or("Не найден каталог приложения")?;
        // Каталог должен быть доступен на запись (не образ диска и не «карантинная» копия)
        let probe = parent.join(".chat-update-probe");
        std::fs::write(&probe, b"").map_err(|_| format!("Нет прав на запись в «{}». Переместите приложение в «Программы»", parent.display()))?;
        let _ = std::fs::remove_file(&probe);

        let dir = std::env::temp_dir().join("chat-native-update");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать временную папку: {e}"))?;

        // Скачивание с прогрессом
        let mut resp = self
            .http
            .get(format!("{BASE}/Chat-native-beta.zip"))
            .header("User-Agent", AGENT)
            .send()
            .await
            .map_err(|e| format!("Не удалось скачать обновление: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Сервер вернул {} при скачивании", resp.status()));
        }
        let total = resp.content_length().map(|l| l as f32).unwrap_or(info.size.max(1) as f32);
        let mut data: Vec<u8> = Vec::with_capacity(total as usize);
        let mut last_sent = 0.0f32;
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Обрыв загрузки: {e}"))? {
            data.extend_from_slice(&chunk);
            let p = (data.len() as f32 / total).min(0.99);
            if p - last_sent >= 0.02 {
                last_sent = p;
                self.upd(Upd::Progress(p));
            }
        }
        let zip = dir.join("update.zip");
        std::fs::write(&zip, &data).map_err(|e| format!("Не удалось сохранить файл: {e}"))?;

        // Распаковка (ditto сохраняет подписи и права)
        let out = dir.join("out");
        let st = Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(&zip).arg(&out).status().map_err(|e| format!("ditto: {e}"))?;
        let new_app = out.join("Chat.app");
        if !st.success() || !new_app.exists() {
            return Err("Не удалось распаковать обновление".into());
        }

        // Подмена после выхода приложения
        let script = dir.join("update.sh");
        std::fs::write(&script, SCRIPT).map_err(|e| format!("Не удалось подготовить установку: {e}"))?;
        Command::new("/bin/bash")
            .arg(&script)
            .arg(std::process::id().to_string())
            .arg(&new_app)
            .arg(&app)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Не удалось запустить установку: {e}"))?;
        self.upd(Upd::Progress(1.0));
        self.upd(Upd::Restarting);
        Ok(())
    }
}
