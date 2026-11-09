# UI-кит веб клиента /chat (дизайн B «Мягкий»)

Правило: одна функция — один вид везде. Код — раздел «UI-КИТ» в конце `server/src/public/chat/flat.css`; значения — переменные `--kit-*` в его первом блоке.
Эталон — `docs/flat-mockup/src/flat-b.css`, `extra-a/b.css`, `PLAN.md` п. 2.2. `flat.css` грузит только /chat (в /m свой `m/css/flat.css`, админка его не подключает).

## Инвентарь и что сделано

| Функция | Где (селекторы) | Был вид (style.css / glass.css / CSS в JS) | Что сделано |
|---|---|---|---|
| **Закрытие окна** | `.modal-hdr .icon-btn` (index.html: подтверждение синхронизации, папка, добавить контакт, новый чат, пересылка; app.js: профиль, группа, медиа, добавить участника; announce.js: объявление ×2), `.ha-close`, `.diag-head .icon-btn`, `.gm-top .icon-btn`, `.pf-x`, `.gl-x` (shared/guestlinks.js и calllinks.js: текст «✕») | круг 30/32/36, фон `--gl-card`, `.pf-x` тёмная плашка 30, `.gl-x` текст ✕ 15px | 36×36, радиус 12, `--surf2`, значок 18, `--text2`; hover `--gl-card2`/`--text`. `✕` скрыт, X Lucide рисуется маской |
| Закрытие панели и плашки | `.chat-search > .icon-btn:last-child`, `.pin-bar .pin-unpin`, `.input-reply-bar > .icon-btn`, `.input-edit-bar > .icon-btn` (в т.ч. панель вложения и пересылки), `.fmt-bar button[data-f="close"]`, `.ann-banner-close`, `.sc-b-x` (текст ×) | 24–40, круги, у правки значок акцентом, inline `style` | тот же вид 36×36; inline-размеры и цвет перебиты `!important` (единственное место) |
| Закрытие на тёмном/цветном | `#lightbox-close`, `.notif-banner-close` (текст ✕) + «Разрешить» на плашке | круг 40 / текст | полупрозрачный белый, радиус 12 (просмотрщик 40, плашка 34), X Lucide; плашка залита `--accent-fill` |
| **Тумблер** | `.cs-tg` (`csTg()` в app.js — 11 мест в настройках, модулях, папках, звуке, тихих часах), общий `.tg`, `[role="switch"]`; `.toggle` в style.css — мёртвый (нигде не используется) | 38×22 капсула, круглый ползунок с тенью, градиент во включённом | 40×24, радиус 8, ползунок 18×18 радиус 6, без тени, вкл `--accent-fill`, выкл `--kit-tg-off`, ход 0,2 с |
| **Кнопки действий** | основная: `.modal-btn-primary`, `.ha-btn-apply`, `.anx-solid` (`.anx-btn.anx-solid`), `.cs-btn.solid`, `.am-btn.pri`, `.sc-btn`, `.btn-login`, `.gl-btn` (окна гостевой ссылки и звонка); вторичная: `.modal-btn-ghost`, `.ha-btn-cancel`, `.anx-btn`, `.cs-btn.ghost`, `.diag-foot .cs-btn`, `.am-btn`, `.gi-btn`, `.gi-btn-leave`, `.sc-btn.ghost`, `.gl-btn.cll-no/.cll-act`; «мягкая»: `.cs-btn`, `.gi-btn-add`, `.addc-btn`, `.gi-addc`, `.fp-new`, `.msg-act.ok`; опасная (тон): `.cs-btn.danger`, `.gi-btn-delete`, `.pf-danger`, `.msg-act`; опасная-заливка: `.modal-btn-danger`, `.ha-btn-danger`, `.gl-btn.cll-yes` | капсулы 999px/9px, градиенты, блики, тени, разный рост 30–44, тёмный текст на акценте | высота 36 (sm 30, вход 46), радиус 12, 13/600, отступ 0 18, без градиентов и теней; hover/active(.95)/disabled(.45)/focus-visible одинаковые |
| **Иконочные** | `.icon-btn` (шапки, панели), `.composer-icon-btn`, `.btn-new-chat`, `.fp-acts button`, `.composer-attach`/`.send-btn`/`.scroll-bottom-btn` (только радиус), `.gl-ic`, `.gl-ib` (окна ссылок); мелкие в строках: `.gm-x`, `.pp-x`, `.rm-btn`, `.cs-eye`, `.att-x` | круги 50% | радиус 12 (мелкие 8); `.gl-ic/.gl-ib` тональные 36×36; размер в шапках/композере — раскладка (flat-frame/chat) |
| **Сегменты** | `.seg` (фильтр чатов), `.cs-seg` (тема, настройки), `.pa-seg` (вкладки профиля и группы), `.ep-sw` (Смайлы|GIF), `.anx-sg`, `.anx-types`, `.anx-tabsbar` (объявление) | капсулы, градиент/стекло, плашка с блеском | контейнер r14 `--surf2` pad 3 h34; кнопка r11; выбранная `--side-bg` (в тёмной `--gl-card2`) с тонкой тенью |
| **Чипы-фильтры** | `.gm-chips button`, `.cm-tabs button`, `.gp-chip`, `.anx-ch` | капсулы с рамкой | h30, r10, `--surf2`, выбран `--accent-soft`/`--accent-ink`, без рамки |
| **Метки** (не кнопки) | `.cs-chip`, `.ws-chip`, `.gm-chip`, `.anx-pill`, `.gl-chip` (+ok/warn), `.accent-dot` | капсулы 99px, `.gl-chip` с рамкой | радиус 8; `.gl-chip` — тон без рамки |
| **Флажки** | `.pp-chk` (выбор людей), `.gm-chk` (добавить участника), нативный `input[type=checkbox]` (`.anx-only`) | круг 22 / 20 r6 | 22, r8, линия 1,5, отмечен `--accent-fill` с белой галочкой (нативный — 20, r8) |
| **Слайдер** | `.rng` (прозрачность, один в настройках) | дорожка капсула, круглый ползунок с тенью | дорожка 6 r3, ползунок 18×18 r6 белый с обводкой акцента, без тени |
| **Поля** | сами: `.field input/textarea` (вход, h46), `.nc-name-input`, `#group-name`, `.gi-name-input`, `.profile-name-input`, `.anx-ta`, `.anx-time input`, `.cs-time`, `.sc-b-inp`, `.gm-nm1 input`, `.gl input`, `.cll select`; обёртки: `.cs-inp`, `.ac-fld`, `.nc-search`, `.anx-search`, `.gm-search`, `.gp-search`, `.ep-search`, `.pl-f`; выпадающий список окон ссылок: `.gl-sel-b`, `.gl-pop`, `.gl-opt` | капсулы, вдавленная тень, рамки | h40 (малые 34), r12, `--surf2`, фокус — рамка `--accent` + кольцо 3px `--accent-soft`; список `.gl-pop` r16 без рамки, пункты r12 |

## Расхождения макета и задания (верен макет)
- Вторичная кнопка: в задании `--surf2`, в макете `.btn` — `--gl-card2` (hover в макете не меняет цвет). Взято `--gl-card2`, hover — на ступень темнее (`--kit-sec-bg-h`). Крестик — `--surf2`, как в обоих.
- Выключенный тумблер: в задании `--surf2` с линией, в макете `color-mix(text 18%, side-bg)` без линии. Взят макет.
- Чипы-фильтры: в PLAN 12, в макете (`.anx-ch`) 10. Взято 10.
- Сегмент: PLAN 14/11, макет `.seg` 14/11 (`.anx-*` в макете 10 у кнопок — унифицировано до 11).
- Основная кнопка в окнах гостевых ссылок: в старом коде «мягкая», в макете заливка. Взята заливка.

## Что кит не покрывает (намеренно)
- Звонки: `.cl-*`, `.call-hd-btn`, `.cl-hbtn`, `.cl-chip`, `select.cl-sel` в `shared/calls.js` — отдельные кнопки (круглые крупные кнопки звонка 54/60/72), их оформляет агент звонков; `select.cl-sel` уже в списке полей.
- Плитки-действия окон профиля/группы `.pa-btn` (строка с шевроном и значком), `.nc-kind`, `.ha-pick-btn`, `.ha-path-row` — карточки-строки, не кнопки действий (агент меню/окон).
- Кнопки композера (`.vr-btn`, отправка, вложение) — только радиус; размеры и состояния за агентом переписки.
- Пункты меню (`.ctx-menu button`, `.hm-i`, `.fly button`), вкладки нижней панели сайдбара `.sb-tab`, плитки папок `.fld-btn/.acc-btn`, реакции `.reaction-btn`, `.ep-tab` — меню/каркас/переписка.
- Окно обновления (Electron-клиент) в веб-версии не рисуется; `.force-update-modal` берёт `.modal-btn-*`.

## Как дописывать
См. комментарий «КАК ДОБАВИТЬ СЕЛЕКТОР В КИТ» в конце `flat.css`. Коротко: свой селектор — в нужные списки раздела (правило + hover + состояния), цвета/размеры только через `--kit-*`, вес селектора — как у старого правила кнопки. Тумблер с классом `.cs-tg`/`.tg`/`role="switch"` подхватывается сам.
Проверка: `docs/flat-mockup/port/web` (`lib.js`), сцены открываются через `openSettingsInline`, `openGroupInfo`, `GuestLinks.open`, `openAnnounce`.
