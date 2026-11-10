// Образец кита: в открытую админку вставляется панель с элементами всех видов (проверка flat.css). node admin-kit-gallery.js [папка]
const { L, getSession, open } = require('./admin-snap.js');
const path = require('path'), fs = require('fs');
const HTML = `
<div id="kitg" style="position:fixed;inset:0;z-index:9999;background:var(--app-bg);overflow:auto;padding:20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-content:start">
<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px"><b>Кнопки</b>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary">Основная</button><button class="btn btn-ghost">Вторичная</button><button class="btn btn-success">Мягкая</button><button class="btn btn-danger">Опасная</button><button class="btn" disabled>Disabled</button></div>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm">Основная sm</button><button class="btn btn-ghost btn-sm">Вторичная sm</button><button class="btn btn-danger btn-sm">Опасная sm</button><button class="btn btn-ghost btn-xs">xs</button><button class="btn ux-solid">ux-solid</button><button class="dc-btn">dc-btn</button><button class="dc-btn dc-pri">dc-pri</button><button class="xh-btn pri">xh pri</button><button class="xh-btn">xh</button><button class="sv-btn">sv-btn</button></div>
 <div style="display:flex;gap:8px;align-items:center"><button class="ux-ibtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/></svg></button><button class="btn-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/></svg></button><button class="modal-close">✕</button><button class="xp-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button><span style="background:#222;padding:6px"><button class="fl-close">✕</button></span></div></div>
<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px"><b>Переключатели, флажки, радио</b>
 <div style="display:flex;gap:14px;align-items:center"><label class="toggle-switch"><input type="checkbox" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label><label class="toggle-switch"><input type="checkbox"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>
 <button class="rs-tg" role="switch" aria-checked="true"></button><button class="rs-tg" role="switch" aria-checked="false"></button><button class="lkq-sw" role="switch" aria-checked="true"></button><button class="lkq-sw" role="switch" aria-checked="false"></button><button class="mm-tg" role="switch" aria-checked="true"></button></div>
 <div style="display:flex;gap:14px;align-items:center"><input type="checkbox" checked><input type="checkbox"><input type="checkbox" disabled><input type="radio" checked name=r1><input type="radio" name=r1></div></div>
<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px"><b>Сегменты и вкладки</b>
 <div class="st-seg"><button aria-pressed="true">День</button><button aria-pressed="false">Неделя</button><button aria-pressed="false">Месяц</button></div>
 <div class="dc-seg dc-sm"><button aria-pressed="true">24 ч</button><button aria-pressed="false">7 д</button></div>
 <div class="hm-seg" style="position:relative"><button aria-pressed="false">Сообщения</button><button aria-pressed="true">Звонки</button><i class="hm-seg-hl" style="left:80px;width:70px"></i></div>
 <div class="fm-tabs"><button aria-pressed="true">Общее</button><button>Доступ</button></div>
 <div class="rm-tabs"><button aria-selected="true">Участники <small>9</small></button><button aria-selected="false">Темы <small>3</small></button></div></div>
<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px"><b>Чипы и бейджи</b>
 <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="ux-chip" aria-pressed="true">Все <b>9</b></button><button class="ux-chip" aria-pressed="false">В сети <b>5</b></button><button class="al-chip active">al <b>3</b></button><button class="an-ch" aria-pressed="false">an-ch</button><button class="pill active">pill</button><button class="pill">pill</button><button class="xp-tab" aria-selected="true">xp <b>12</b></button><button class="xp-tg" aria-pressed="true">серия</button></div>
 <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="badge badge-green">green</span><span class="badge badge-orange">orange</span><span class="badge badge-red">red</span><span class="badge badge-blue">blue</span><span class="badge badge-gray">gray</span><span class="hm-pill ok">ok</span><span class="hm-pill warn">warn</span><span class="hm-pill crit">crit</span><span class="hm-pill muted">muted</span><span class="st-chip ok">st ok</span><span class="lkk-chip info">info</span><span class="dc-chip">dc</span><span class="xs-badge">xs</span><span class="sb-pill ok">sb</span></div></div>
<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px"><b>Поля</b>
 <div class="fg"><label>Имя</label><input placeholder="Анна"></div><div class="fg"><label>Роль</label><select><option>Пользователь</option></select></div>
 <div class="ua-inp"><input placeholder="ua-inp"></div><div class="ux-search"><input placeholder="Поиск"></div><div class="search-box"><input placeholder="search-box"></div><button class="ux-sel-b" style="width:100%"><span class="t">ux-sel-b</span></button>
 </div>
<div class="card" style="padding:0;overflow:hidden"><div class="ux-tbl"><table><thead><tr><th>Имя</th><th>Роль</th></tr></thead><tbody><tr><td>Анна</td><td>Пользователь</td></tr><tr class="sel"><td>Пётр</td><td>Админ</td></tr></tbody></table></div><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg><p>Ничего нет</p><small>Подсказка</small></div></div>
</div>`;
(async () => {
  const dir = process.argv[2] || path.join(__dirname, 'admin-shots'); fs.mkdirSync(dir, { recursive: true });
  const s = await getSession();
  for (const th of ['light', 'dark']) {
    const { browser, page } = await L.launch({ width: 1440, height: 900 });
    await open(page, s, th, 'teal', 'dashboard', false);
    await page.evaluate(h => { document.body.insertAdjacentHTML('beforeend', h); }, HTML);
    await page.waitForTimeout(400);
    await L.shot(page, path.join(dir, `kit-${th}.png`));
    const r = await page.evaluate(() => { const g = (sel) => { const e = document.querySelector('#kitg ' + sel); if (!e) return sel + ': нет'; const c = getComputedStyle(e); return `${sel}: ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} r=${c.borderTopLeftRadius} bg=${c.backgroundColor} border=${c.borderTopWidth}`; };
      return ['.btn-primary', '.btn-ghost', '.btn-sm', '.ux-ibtn', '.modal-close', '.rs-tg', '.lkq-sw', 'button.mm-tg', '.toggle-track', '.st-seg', '.st-seg button[aria-pressed=true]', '.ux-chip', '.badge-green', '.hm-pill.ok', '.fg input', '.ua-inp', '.ux-search', 'input[type=checkbox]'].map(g); });
    console.log(th + '\n' + r.join('\n'));
    await browser.close();
  }
})();
