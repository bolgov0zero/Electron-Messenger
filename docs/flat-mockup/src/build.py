#!/usr/bin/env python3
"""Сборка docs/flat-mockup/index.html: интерактивный макет glass-mockup + вариант B (flat-b.css)
+ переписка из клиента (chat-real.css, chat.js) + настоящие окна гостевой ссылки и ссылки на видеозвонок.
Запуск из папки docs/flat-mockup/src:  python3 -I build.py"""
import re, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
rd = lambda p: open(p, encoding='utf-8').read()
src = rd(os.path.join(ROOT, 'docs/glass-mockup/index.html'))


def sub(old, new, count=1):
    global src
    n = src.count(old)
    assert n >= 1, 'не найдено: ' + old[:70]
    src = src.replace(old, new) if count == 0 else src.replace(old, new, count)


def rsub(pat, new, flags=re.S):
    global src
    out, n = re.subn(pat, lambda m: new, src, count=1, flags=flags)
    assert n == 1, 'не найдено (regex): ' + pat[:70]
    src = out


# 1. заголовок, шрифт
sub('<title>Макет клиента: Liquid Glass</title>', '<title>Макет клиента: вариант B (без стекла)</title>')
sub('family=Inter:wght@400;500;600;700;800&display=swap', 'family=Inter:wght@400;500;600;700;800&display=swap')

# 2. стили: переписка из клиента, затем вариант B
chat_css = rd(os.path.join(HERE, 'chat-real.css'))
flat_css = rd(os.path.join(HERE, 'flat-b.css'))
sub('</style>\n</head>', chat_css + '\n' + flat_css + '\n</style>\n</head>')

# 3. цветной фон переписки внутри карточки чата
sub('    <div class="amb"><i></i><i></i><i></i><i></i></div>\n    <div class="app">', '    <div class="app">')
sub('<main class="chat" id="chat">', '<main class="chat" id="chat">\n        <div class="amb"><i></i><i></i><i></i><i></i></div>')

# 4. аккаунты в баре (как в rail-accounts.html): круглые аватарки внизу
sub('<button class="me" id="meBtn" title="Профиль">АБ</button>',
    '<div class="accs" id="accs">'
    '<button class="ws acc on" id="meBtn" title="Мария Иванова · в сети" data-acc="0"><span class="ava" style="background:linear-gradient(135deg,#f6a35a,#e0507a)">АБ</span><i class="pd"></i></button>'
    '<button class="ws acc" title="Рабочая запись · отошла" data-acc="1"><span class="ava" style="background:linear-gradient(135deg,#5a63c8,#2e3590)">МП</span><em>3</em><i class="pd away"></i></button>'
    '<button class="ws acc" title="Другой сервер · не в сети" data-acc="2"><span class="ava" style="background:linear-gradient(135deg,#34a1a0,#1f6f78)">ДС</span><i class="pd off"></i></button></div>')
# подписи под значками нижней панели
sub("$('#menu [data-m=\"file\"]').insertAdjacentHTML('beforeend','Прикрепить файл');", "$$('#tabs button').forEach(b=>b.insertAdjacentHTML('beforeend','<span>'+b.getAttribute('aria-label')+'</span>'));\n$('#menu [data-m=\"file\"]').insertAdjacentHTML('beforeend','Прикрепить файл');")

# 5. переписка: функции разметки
chat_js = rd(os.path.join(HERE, 'chat.js'))
rsub(r'function reactHtml\(re\)\{.*?(?=function ensureConvo)', chat_js)

# 6. места JS, зависящие от разметки сообщений
rsub(r'function addMsg\(m\)\{.*?(?=function go\(\)\{)',
     "function addMsg(m){const cv=$('#cv-'+S.cur);if(!cv)return;const box=$('.messages',cv);const last=[...box.querySelectorAll('.irc-msg')].pop();const lm=!!(last&&last.hasAttribute('data-mine'));if(lm)last.classList.remove('irc-tail');"
     "const tmp=document.createElement('div');tmp.innerHTML=msgHtml(S.cur,m,lm?'me':null,cv.classList.contains('dm'));const ty=$('.typing-indicator',cv);"
     "[...tmp.children].forEach(n=>ty?ty.before(n):box.append(n));requestAnimationFrame(()=>$('#scroll').scrollTo({top:1e5,behavior:'smooth'}))}\n")
sub("const el=$(`[data-m=\"${S.edit}\"] .bub`);if(el){const t=el.querySelector('.t');el.firstChild.nodeType===3?el.firstChild.textContent=v:null;MSG",
    "const el=$(`[data-m=\"${S.edit}\"] .irc-text`);if(el){el.textContent=v;MSG")
sub("el.classList.add('hl');setTimeout(()=>el.classList.remove('hl'),1900)", "el.classList.add('msg-highlight');setTimeout(()=>el.classList.remove('msg-highlight'),1900)")
sub("$$(`#cv-${S.cur} .msg`)", "$$(`#cv-${S.cur} .irc-msg`)")
sub("const rb=$(`[data-m=\"${id}\"]`)?.nextElementSibling;return rb&&rb.classList.contains('react')?[...rb.querySelectorAll('.mine')].map(b=>b.textContent.trim().split(' ')[0]):[]",
    "return [...$$(`[data-m=\"${id}\"] .reaction-btn.mine`)].map(b=>b.dataset.reaction)")
sub("const el=$(`[data-m=\"${id}\"]`);const r=el?.nextElementSibling;el?.remove();if(r&&r.classList.contains('react'))r.remove();", "$(`[data-m=\"${id}\"]`)?.remove();")
rsub(r'function addReaction\(id,r\)\{.*?(?=function chatMenu)',
     "function addReaction(id,r){const msg=$(`[data-m=\"${id}\"]`);if(!msg)return;const bub=$('.msg-bubble',msg),emo=msg.classList.contains('emoji-msg');let rb=$('.reactions',msg);"
     "if(!rb){rb=document.createElement('div');rb.className='reactions';const meta=$('.irc-meta',bub);if(emo)$('.irc-content',msg).append(rb);else meta?bub.insertBefore(rb,meta):bub.append(rb)}\n"
     "  const ex=[...rb.children].find(b=>b.dataset.reaction===r);\n"
     "  if(ex){const c=$('.ra-count',ex),n=+c.textContent||1;if(ex.classList.contains('mine')){ex.classList.remove('mine');n>1?c.textContent=n-1:ex.remove()}else{ex.classList.add('mine');c.textContent=n+1}}\n"
     "  else rb.insertAdjacentHTML('beforeend',`<button class=\"reaction-btn mine\" data-reaction=\"${r}\"><span class=\"ra-emoji\">${r}</span><span class=\"ra-count\">1</span></button>`);\n"
     "  if(!rb.children.length)rb.remove()}\n")
sub("msg=t.closest('.msg'),ws=", "msg=t.closest('.irc-msg'),ws=")
sub("$$('#cv-team .msg.out')[1]||$('#cv-team .msg')", "$$('#cv-team .irc-msg[data-mine]')[1]||$('#cv-team .irc-msg')")

# 7. верхняя панель: сцены, плашка про переписку
sub('<button data-s="newchat">Новый чат</button>',
    '<button data-s="sidemenu">Меню сайдбара</button><button data-s="newchat">Новый чат</button>')
sub('<button data-s="msgmenu">Меню сообщения</button>',
    '<button data-s="msgmenu">Меню сообщения</button><button data-s="react">Реакции</button><button data-s="emoji">Смайлы</button>')
sub('<button data-s="settings">Настройки</button>',
    '<button data-s="settings">Настройки</button><button data-s="guest">Гостевая ссылка</button><button data-s="calllink">Ссылка на звонок</button>')
sub('<button class="btn glass gi" id="nb"', '<span class="chatnote" title="Пузыри, цитаты, файлы, реакции, дата и индикатор набора взяты из клиента как есть"><i></i>Переписка — как в клиенте c3.35.1, без изменений</span>\n    <button class="btn glass gi" id="nb"')
rsub(r'<div class="notes glass-pop" id="notes">.*?</div>\s*(?=<div class="fit">)',
     '<div class="notes glass-pop" id="notes">'
     '<h3>Как пользоваться макетом</h3>'
     '<ul><li>Всё кликается: правая кнопка на сообщении, на чате в списке, на контакте и на значке папки в баре открывает контекстные меню.</li>'
     '<li>«+» в шапке сайдбара: новый чат (во вкладке контактов — добавить контакт). Имя в шапке чата открывает профиль или группу; в окне группы есть гостевая ссылка. «⋯» — меню чата.</li>'
     '<li>Вкладки внизу: чаты, контакты, настройки (все разделы). Комната «Вся компания» открывает темы. Внизу бара — аккаунты.</li>'
     '<li>Кнопки сверху быстро показывают окна и меню, в том числе реакции, смайлы, гостевую ссылку и ссылку на видеозвонок.</li></ul>'
     '<h3>Вариант B «Мягкий» (для переноса в клиенты)</h3><table>'
     '<tr><td>Окно, панели (сайдбар, чат)</td><td>22</td></tr><tr><td>Шапка, поле ввода, плашки</td><td>16</td></tr>'
     '<tr><td>Карточки, меню, окна-карточки</td><td>16</td></tr><tr><td>Строка списка</td><td>16</td></tr>'
     '<tr><td>Кнопки, пункты меню, поля</td><td>12–14</td></tr><tr><td>Фильтры, значки-счётчики</td><td>капсула</td></tr>'
     '<tr><td>Аватарка</td><td>круг</td></tr><tr><td>Шрифт</td><td>Inter</td></tr></table>'
     '<ul><li>Линий нет: структуру держат мягкие тени и отступы 10/12/16.</li>'
     '<li>Никакого размытия и бликов; поверхности непрозрачные, один акцентный цвет (заливка темнее акцента текста).</li>'
     '<li>Переписка не менялась: её разметка и стили взяты из клиента.</li></ul></div>\n  ')

# 8. окна гостевой ссылки и звонка: настоящий код клиента + заглушка запросов
gl_js = rd(os.path.join(ROOT, 'client/src/guestlinks.js'))
cl_js = rd(os.path.join(ROOT, 'client/src/calllinks.js'))
# крестик окон: в настоящем коде текстовый «✕», в макете — тот же значок Lucide, что и в остальных окнах
XSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
for _n in ('gl_js', 'cl_js'):
    assert '>✕</button>' in globals()[_n], _n
# окна — внутри масштабируемого окна макета (#win), иначе они крупнее остальных
INTO_WIN = ('document.body.appendChild(bg)', "(document.getElementById('win')||document.body).appendChild(bg)")
for _n in ('gl_js', 'cl_js'):
    assert INTO_WIN[0] in globals()[_n], _n
gl_js = gl_js.replace(*INTO_WIN)
cl_js = cl_js.replace(*INTO_WIN)
gl_js = gl_js.replace('>✕</button>', '>' + XSVG + '</button>')
cl_js = cl_js.replace('>✕</button>', '>' + XSVG + '</button>')
mock_js = rd(os.path.join(HERE, 'windows.js'))
sub('<script>\n', '<script>\n' + gl_js + '\n</script>\n<script>\n' + cl_js + '\n</script>\n<script>\n', 1)
# заглушка и сцены — в конец основного скрипта
sub('/* ---------- сцены, запуск ---------- */', mock_js + '\n/* ---------- сцены, запуск ---------- */')
sub("else if(s==='settings'){setTab('settings');openSection('appearance')}",
    "else if(s==='settings'){setTab('settings');openSection('appearance')}\n"
    "  else if(s==='guest')openGuest();else if(s==='calllink')openCallLink();else if(s==='sidemenu')hmSet(true);\n"
    "  else if(s==='emoji'){if(S.tab!=='chats')setTab('chats');openChat('team');await sleep(120);epSet(true)}\n"
    "  else if(s==='react'){if(S.tab!=='chats')setTab('chats');openChat('team');await sleep(200);const m=$$('#cv-team .irc-msg:not([data-mine])')[2]||$('#cv-team .irc-msg');const r=rectIn(m);reactPicker(r.l+120,r.t+40,x=>addReaction(m.dataset.m,x))}")


# 9. дополнения: меню шапки, группа, настройки, значки
sub("<button data-tip=\"Сменить тему\" id=\"hm-theme\" role=\"menuitem\"></button>", "<button data-tip=\"Скрыть панель\" id=\"hm-hide\" role=\"menuitem\"></button>\n            <button data-tip=\"Сменить тему\" id=\"hm-theme\" role=\"menuitem\"></button>")
sub("<button data-tip=\"Отправить объявление\" id=\"hm-ann\" role=\"menuitem\"></button>", "<button data-tip=\"Отправить объявление\" id=\"hm-ann\" role=\"menuitem\"></button>\n            <button data-tip=\"Ссылка на видеозвонок\" id=\"hm-call\" role=\"menuitem\"></button>")
sub("['#hm-theme','sun'],['#hm-ann','bell'],", "['#hm-hide','panel'],['#hm-theme','sun'],['#hm-ann','bell'],['#hm-call','video'],")
sub("const I=(n,c='')=>", "IC.video='<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\"/><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\"/>';IC.panel='<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/>';\nconst I=(n,c='')=>")
sub("$('#hm-ann').onclick=", "$('#hm-hide').onclick=()=>{hmSet(false);toast('Панель скрыта (в клиенте — кнопка в шапке чата)')};\n$('#hm-call').onclick=()=>{hmSet(false);openCallLink()};\n$('#hm-ann').onclick=")
sub('<label class="fld nc-search" style="height:36px">${I(\'search\')}<input placeholder="Найти участника"',
    '<div class="gm-box" style="margin-bottom:12px"><button class="gm-row" data-k="me" data-a="guest">${I(\'link\')}<span class="gm-nm"><b>Гостевая ссылка</b><span>Вход без учётной записи на время</span></span>${I(\'chevLeft\',\'gm-go\')}</button></div>\n   <label class="fld nc-search" style="height:36px">${I(\'search\')}<input placeholder="Найти участника"')
sub("if(a.dataset.a==='media'){openMedia(cid)}", "if(a.dataset.a==='guest'){openGuest(cid)}else if(a.dataset.a==='media'){openMedia(cid)}")
sub('<div class="cs-r"><div class="cs-l"><b>Прозрачность</b>', '<div class="cs-r" hidden><div class="cs-l"><b>Прозрачность</b>')
sub('<div class="cs-r"><div class="cs-l"><b>Цветная картинка</b>', '<div class="cs-r" hidden><div class="cs-l"><b>Цветная картинка</b>')
sub("else if(s==='sidemenu')hmSet(true);", "else if(s==='sidemenu'){await sleep(80);hmSet(true)}")

# 10. вход, обновление, недоступность сервера
scr = rd(os.path.join(HERE, 'screens.js'))
sub('/* ---------- сцены, запуск ---------- */', scr + '\n/* ---------- сцены, запуск ---------- */')
sub('<button data-s="settings">Настройки</button>', '<button data-s="settings">Настройки</button><button data-s="login">Вход</button><button data-s="update">Обновление</button><button data-s="forceupd">Принудит. обновление</button><button data-s="offline">Сервер недоступен</button>')
sub("else if(s==='guest')openGuest();", "else if(s==='login')loginShow('form');else if(s==='update')modalUpdate();else if(s==='forceupd')modalForceUpdate();else if(s==='offline')toggleOffline();else if(s==='guest')openGuest();")

sub('<span class="chatnote"', '<a class="btn glass gi" href="mobile.html" style="height:36px">Мобильный клиент →</a>\n    <a class="btn glass gi" href="calls.html" style="height:36px">Звонки →</a>\n    <span class="chatnote"')
# 11. новые сцены: файлы src/extra-*.js и src/extra-*.css подключаются сами; вторая панель кнопок «Новое в клиенте»
import glob
extra_js = ''.join(rd(f) + '\n' for f in sorted(glob.glob(os.path.join(HERE, 'extra-*.js'))))
extra_css = ''.join(rd(f) + '\n' for f in sorted(glob.glob(os.path.join(HERE, 'extra-*.css'))))
sub('\n</style>\n</head>', '\n' + extra_css + '</style>\n</head>')
sub('<a class="btn glass gi" href="mobile.html"', '<div class="scenes glass" id="scenes2" role="group" aria-label="Новое в клиенте"></div>\n    <a class="btn glass gi" href="mobile.html"')
HOOK = r"""/* ---------- новые сцены (extra-*.js): addScene(id, подпись, async ()=>{...}); RESETS.push(()=>{...}) — убрать за собой ---------- */
const NEWSC={},RESETS=[];
function addScene(id,label,fn){NEWSC[id]=fn;$('#scenes2').insertAdjacentHTML('beforeend','<button data-s="'+id+'">'+label+'</button>')}
async function resetScene(){$$('.modal-bg.open').forEach(closeModal);$$('.gl-bg,.xo').forEach(n=>n.remove());closeMenus();try{hmSet(false)}catch(e){}RESETS.forEach(f=>{try{f()}catch(e){console.error(e)}});if(S.tab!=='chats')setTab('chats')}
$('#scenes2').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;await resetScene();await sleep(60);await NEWSC[b.dataset.s]()});
"""
sub('/* ---------- сцены, запуск ---------- */', HOOK + extra_js + '\n/* ---------- сцены, запуск ---------- */')

# 12. блок «Фон переписки» (Как обычно / С разделением) убран из настроек во всех клиентах
rsub(r"\n <div class=\"cs-gt\">Фон переписки</div><div class=\"bg-cards\">.*?\.join\(''\)\}</div>", "")

out = os.path.join(ROOT, 'docs/flat-mockup/index.html')
open(out, 'w', encoding='utf-8').write(src)
print('готово:', out, len(src), 'байт')
