#!/usr/bin/env python3
"""Сборка docs/flat-mockup/mobile.html: интерактивный макет мобильного клиента glass-mockup/mobile.html + вариант B (flat-b-m.css)
+ переписка из клиента /m (chat-real-m.css, chat-m.js, shared/fmt.js, shared/voice.js) + настоящие окна гостевой ссылки и ссылки на видеозвонок.
Запуск из папки docs/flat-mockup/src-mobile:  python3 -I build.py
(перед этим при изменении клиента: python3 -I extract_chat_m.py chat-real-m.css <app.css> <extra.css> <cshape.css> <voice.css>)"""
import re, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PUB = os.path.join(ROOT, 'server/src/public')
rd = lambda p: open(p, encoding='utf-8').read()
src = rd(os.path.join(ROOT, 'docs/glass-mockup/mobile.html'))


def sub(old, new, count=1):
    global src
    n = src.count(old)
    assert n >= 1, 'не найдено: ' + old[:80]
    src = src.replace(old, new) if count == 0 else src.replace(old, new, count)


def rsub(pat, new, flags=re.S):
    global src
    out, n = re.subn(pat, lambda m: new, src, count=1, flags=flags)
    assert n == 1, 'не найдено (regex): ' + pat[:80]
    src = out


# 1. заголовок, шрифты, манифест
sub('<title>Electron β</title>', '<title>Макет /m: вариант B (без стекла)</title>')
sub('<link rel="stylesheet" href="/shared/fonts/inter.css">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">')
sub('<link rel="manifest" href="/beta/manifest.json">', '')

# 2. стили: объявления (из extra.css клиента), переписка из клиента, затем вариант B
extra = rd(os.path.join(PUB, 'm/css/extra.css'))
a = extra.index('/* ── объявления ── */')
b = extra.index('@media (prefers-reduced-motion', a)
ann_css = extra[a:b]
chat_css = rd(os.path.join(HERE, 'chat-real-m.css'))
flat_css = rd(os.path.join(HERE, 'flat-b-m.css'))
chat_b_css = rd(os.path.join(HERE, 'chat-b-m.css'))
sub('\n</style></head>', '\n' + ann_css + '\n' + chat_css + '\n' + flat_css + '\n' + chat_b_css + '\n' + rd(os.path.join(HERE, 'screens-m.css')) + '\n</style></head>')

# 3. верхняя панель: сцены, ссылка на десктоп, плашка про переписку, выбор акцента
rsub(r'<div class="scenes glass" id="scenes">.*?</div><a class="scenes glass" href="desktop\.html"[^>]*>Макет для компьютера</a>',
     '<div class="scenes glass accbar" id="accbar" title="Цвет акцента">' + ''.join(f'<button class="dot2{" on" if k == "teal" else ""}" data-a="{k}" aria-label="{k}"></button>' for k in ['teal', 'blue', 'indigo', 'plum', 'amber']) + '</div>'
     '<div class="scenes glass" id="scenes">'
     '<button data-s="chats">Чаты</button><button data-s="chat">Переписка</button><button data-s="room">Комната</button><button data-s="contacts">Контакты</button><button data-s="settings">Настройки</button>'
     '<button data-s="msgmenu">Меню сообщения</button><button data-s="react">Реакции</button><button data-s="reactall">Все реакции</button><button data-s="emoji">Смайлы</button>'
     '<button data-s="chatmenu">Меню чата</button><button data-s="headmenu">Меню шапки</button><button data-s="plusmenu">Меню «+»</button>'
     '<button data-s="folders">Папки</button><button data-s="spaces">Пространства</button><button data-s="accounts">Записи</button>'
     '<button data-s="profile">Профиль</button><button data-s="group">Группа</button><button data-s="media">Медиа</button>'
     '<button data-s="newchat">Новый чат</button><button data-s="newgroup">Новая группа</button>'
     '<button data-s="ann">Объявление</button><button data-s="annbanner">Полоса</button><button data-s="annpopup">Карточка</button>'
     '<button data-s="guest">Гостевая ссылка</button><button data-s="calllink">Ссылка на звонок</button>'
     '<button data-s="appearance">Внешний вид</button><button data-s="calls">Звонки</button></div>'
     '<a class="scenes glass" href="index.html" style="padding:0 14px;height:34px;align-items:center;font-weight:600;color:var(--text2)">← Десктоп</a>'
     '<a class="scenes glass" href="calls.html" style="padding:0 14px;height:34px;align-items:center;font-weight:600;color:var(--text2)">Звонки →</a>'
     '<span class="chatnote" title="Пузыри, цитаты, файлы, реакции, дата и голосовые взяты из клиента /m как есть"><i></i>Переписка — как в клиенте /m, без изменений</span>')

# 4. значки
sub("const I=(n,c='')=>",
    "IC.video='<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\"/><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\"/>';"
    "IC.phone='<path d=\"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z\"/>';"
    "IC.mega='<path d=\"m3 11 18-5v12L3 14v-3z\"/><path d=\"M11.6 16.8a3 3 0 1 1-5.8-1.6\"/>';\n"
    "const I=(n,c='')=>")

# 5. данные: дополнения к переписке (голосовое, код, ссылка, пересылка, GIF, системная строка)
sub("<span class=\"mn\">@Мария</span>, закройте открытые вложения заранее", "@Мария, закройте открытые вложения заранее")
sub("const CHK=I('checks');",
    "const CHK=I('checks');\n"
    "CONVO.team.splice(5,0,{a:'anna',voice:23,tm:'09:31'},{a:'me',voice:8,tm:'09:32'});\n"
    "CONVO.dev.push({a:'akrylov',t:'Команда для сборки:\\n```\\nnpm run build\\n```',tm:'10:10'},{a:'dmitry',fwd:['Анна Лебедева','Релиз переносим на пятницу'],tm:'10:11'},"
    "{a:'dmitry',t:'Дорожная карта: https://example.com/roadmap',lp:{url:'https://example.com/roadmap',title:'Дорожная карта Q4',site:'example.com'},tm:'10:12'},{a:'me',gif:40,tm:'10:13'});\n"
    "CONVO.sever.splice(1,0,{a:'anna',sys:'Анна добавила Петра Сидорова',tm:'10:25'});\n"
    "CONVO.marat[1].st='sent';")

# 6. переписка: функции разметки (настоящая разметка /m)
chat_js = rd(os.path.join(HERE, 'chat-m.js'))
rsub(r'function rxHtml\(re\)\{.*?(?=let cur=null;)', chat_js)

# 7. места JS, зависящие от разметки сообщений
sub("clone.className='cmc'+(elem.classList.contains('row')?' glass grp':'');", "clone.className='cmc'+(elem.classList.contains('row')?' glass grp':'')+(elem.closest('.mrow')?' chatreal':'');")
sub("""clone.innerHTML=elem.classList.contains('bub')?'<div class="mrow '+(mine?'out':'in')+'" style="margin:0">'+elem.outerHTML+'</div>':elem.outerHTML;""",
    """clone.innerHTML=elem.classList.contains('bub')?'<div class="'+elem.closest('.mrow').className+'" style="margin:0">'+elem.outerHTML+'</div>':elem.outerHTML;""")
sub("const m=MS[row.dataset.m];if(!m)return;", "const m=MS[row.dataset.mid];if(!m)return;")
sub("const nx=row.nextElementSibling;nx&&nx.classList.contains('react')&&nx.remove();row.remove();toast('Сообщение удалено','trash')", "row.closest('.mg').remove();toast('Сообщение удалено','trash')")
rsub(r'function toggleReact\(b\)\{.*?(?=function msgMenu)',
     "function toggleReact(b){const id=b.closest('.mg').dataset.mid,m=MS[id],e=b.dataset.e,i=m.re.findIndex(r=>r.split(' ')[0]===e);if(i<0)return;const[x,mine]=m.re[i].split('|');let[em,c]=x.split(' ');c=+(c||1);c+=mine?-1:1;"
     "m.re[i]=c>0?em+' '+c+(mine?'':'|mine'):null;m.re=m.re.filter(Boolean);redraw(id)}\n"
     "function addReact(row,em){const id=row.dataset.mid,m=MS[id];if(!m)return;m.re=m.re||[];const i=m.re.findIndex(r=>r.split(' ')[0]===em);"
     "if(i>=0){if(m.re[i].includes('|mine'))return;const[x]=m.re[i].split('|'),[e,c]=x.split(' ');m.re[i]=e+' '+((+c||1)+1)+'|mine'}else m.re.push(em+' 1|mine');redraw(id)}\n")
rsub(r'const doSend=\(\)=>\{.*?(?=  el\._send=doSend;)',
     "const doSend=()=>{const t=ta.value.trim();if(!t&&!att&&ctx?.k!=='edit')return;const tm=new Date().toTimeString().slice(0,5);\n"
     "    if(ctx?.k==='edit'){const m=MS[ctx.id];m.t=t;m.text=t;m.ed=1;redraw(ctx.id);ctx=null;bar();ta.value='';sync();toast('Сообщение изменено','pen');return}\n"
     "    const m={a:'me',t,tm,st:'sent'};if(ctx)m.q=[ctx.who,ctx.text];if(att){m.file=[att.name,att.size];att=null}\n"
     "    const mg=appendMsg(sc_,c,m);$('.bub',mg)?.classList.add('pop');ctx=null;att=null;bar();ta.value='';sync();sc_.scrollTo({top:1e6,behavior:'smooth'});\n"
     "    if(c.k==='dm'||Math.random()>.4)setTimeout(()=>{const who=c.k==='dm'?c.peer:'elena',sm=$('.who small',el);sm&&(sm.textContent=PPL[who].n.split(' ')[0]+' печатает…',sm.classList.add('on'));\n"
     "      setTimeout(()=>{sm&&(sm.textContent=c.sub||'',sm.classList.toggle('on',/в сети/.test(c.sub||'')));const mg2=appendMsg(sc_,c,{a:who,t:['Принято 👍','Да, посмотрю чуть позже','Спасибо!','Хорошо, договорились'][Math.random()*4|0],tm:new Date().toTimeString().slice(0,5)});$('.bub',mg2)?.classList.add('pop');sc_.scrollTo({top:1e6,behavior:'smooth'})},1500)},700)};\n")
rsub(r"el\._gif=deg=>\{.*?(?=  el\.addEventListener\('click',e=>\{const t=e\.target;)",
     "el._gif=deg=>{const mg=appendMsg(sc_,c,{a:'me',gif:deg,tm:new Date().toTimeString().slice(0,5)});$('.bub',mg)?.classList.add('pop');sc_.scrollTo({top:1e6,behavior:'smooth'})};\n")
sub("if(t.closest('[data-s]')){toast('Поиск по переписке','search');return}\n    if(t.closest('[data-more]')){chatActions(c,el);return}",
    "if(t.closest('[data-call]')){callSheet(c);return}\n    if(t.closest('[data-s]')){toast('Поиск по переписке','search');return}\n    if(t.closest('[data-more]')){chatActions(c,el);return}")
sub('<div class="nr cap glass"><button data-s aria-label="Поиск">', '<div class="nr cap glass"><button data-call aria-label="Позвонить">${I(\'video\')}</button><button data-s aria-label="Поиск">')
sub("const sub=isTopic?'# тема · в сети 4 из 12':(c.sub||''),onl=/в сети/.test(sub);", "const typ=id==='team',sub=typ?'Елена печатает…':(isTopic?'# тема · в сети 4 из 12':(c.sub||'')),onl=typ||/в сети/.test(sub);")
sub("body:convoHtml(id,dm,id==='team'?'<div class=\"typing\"><i></i><i></i><i></i>Елена печатает…</div>':'')", "body:convoHtml(id,dm)")
sub("$$('.mrow,.react,.who-n',$('.scroll',el)).forEach(x=>x.remove())", "$$('.day-group',$('.scroll',el)).forEach(x=>x.remove())")
sub("['image','Медиа, файлы и ссылки',()=>openMedia(c)],",
    "['image','Медиа, файлы и ссылки',()=>openMedia(c)],...(c.k==='group'||c.k==='room'?[['link','Гостевая ссылка',()=>openGuest(c.id)]]:[]),['video','Ссылка на видеозвонок',()=>openCallLink()],")

# 8. группа: гостевая ссылка и ссылка на звонок
sub('<div class="grp glass"><button class="cell" data-leave>',
    '<div class="grp glass"><button class="cell" data-guest><span class="ci" style="background:var(--accent)">${I(\'link\')}</span><span class="cl">Гостевая ссылка</span><span class="ch">${I(\'chevRight\')}</span></button>'
    '<button class="cell" data-lnk><span class="ci" style="background:#5b8def">${I(\'video\')}</span><span class="cl">Ссылка на видеозвонок</span><span class="ch">${I(\'chevRight\')}</span></button></div>\n   <div class="grp glass"><button class="cell" data-leave>')
sub("if(t.closest('[data-leave]'))confirmSheet('Покинуть группу?'", "if(t.closest('[data-guest]')){openGuest(c.id);return}if(t.closest('[data-lnk]')){openCallLink();return}if(t.closest('[data-leave]'))confirmSheet('Покинуть группу?'")

# 9. настройки: звонки, записи, объявление; без «Прозрачности»
sub("${cellS('folders','folder','#ff9500','Папки',FOLDERS.length)}</div>", "${cellS('folders','folder','#ff9500','Папки',FOLDERS.length)}${cellS('calls','video','#5b8def','Звонки','аудио, видео')}</div>")
sub("${cellS('blocks','ban','#8e8e93','Блокировки',S.blocked.length||'')}", "${cellS('accounts','users','#5b8def','Записи','3')}${cellS('ann','mega','#ff9500','Отправить объявление')}${cellS('blocks','ban','#8e8e93','Блокировки',S.blocked.length||'')}")
sub("diag:openDiag,logout:", "diag:openDiag,calls:openCalls,accounts:accSheet,ann:annSheet,logout:")
sub('<div class="cell"><span class="cl">Прозрачность</span>', '<div class="cell" hidden><span class="cl">Прозрачность</span>')

sub('<div class="cell"><span class="cl">Цветная картинка</span>', '<div class="cell" hidden><span class="cl">Цветная картинка</span>')

# 10. сцены
rsub(r"\$\('#scenes'\)\.addEventListener\('click',async e=>\{.*?else if\(s==='newchat'\)newChat\(\)\}\);",
     """$('#scenes').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const s=b.dataset.s;await reset();
  const chatOpen=async(id='team')=>{setTab('chats');const el=openChat(id);await sleep(650);fin();return el};
  const msgRow=async(el,sel)=>{const row=sel(el)||$('.mrow',el);row.scrollIntoView({block:'center'});await sleep(250);fin();return row};
  if(s==='chats')setTab('chats');else if(s==='chat'){setTab('chats');openChat('team')}else if(s==='room'){setTab('chats');openRoom()}
  else if(s==='contacts')setTab('contacts');else if(s==='settings')setTab('settings');
  else if(s==='msgmenu'){const el=await chatOpen();const row=await msgRow(el,e=>$('.mrow.out .quote',e)?.closest('.mrow'));msgMenu(el,row,findChat('team'),{reply(){},edit(){}})}
  else if(s==='react'){const el=await chatOpen();const row=await msgRow(el,e=>$$('.mrow.in:not(.big)',e).filter(r=>!$('.big',r)&&!$('.vm',r)&&$('.txt',r)).slice(-1)[0]);msgMenu(el,row,findChat('team'),{reply(){},edit(){}})}
  else if(s==='reactall'){await chatOpen();emojiSheet(()=>{})}
  else if(s==='emoji'){await chatOpen();openEp()}
  else if(s==='chatmenu'){setTab('chats');await sleep(100);chatMenu($('.row[data-id="sever"]'))}
  else if(s==='headmenu'){const el=await chatOpen();chatActions(findChat('team'),el)}
  else if(s==='plusmenu'){const el=await chatOpen();upMenu($('[data-plus]',el),{attach(){},fmt(){}})}
  else if(s==='folders'){setTab('settings');openFolders();await sleep(520);$('.page:last-child [data-f]')?.click()}
  else if(s==='spaces'){S.set.spaces=true;renderChats();renderSettings();setTab('chats');await sleep(100);spaceSheet()}
  else if(s==='accounts'){setTab('settings');accSheet()}
  else if(s==='profile'){setTab('contacts');openProfile('dmitry')}else if(s==='group'){setTab('chats');openGroup('team')}else if(s==='media'){setTab('chats');openGroup('team');await sleep(500);openMedia(findChat('team'))}
  else if(s==='appearance'){setTab('settings');openAppearance()}else if(s==='calls'){setTab('settings');openCalls()}
  else if(s==='newchat')newChat();else if(s==='newgroup'){newChat();await sleep(480);newGroup()}
  else if(s==='ann'){setTab('settings');annSheet()}else if(s==='annbanner'){setTab('chats');annReceive('banner')}else if(s==='annpopup'){setTab('chats');annReceive('popup')}
  else if(s==='guest'){setTab('chats');openGroup('team');await sleep(520);openGuest('team')}
  else if(s==='calllink'){setTab('chats');openChat('team');await sleep(520);openCallLink()}});""")
sub("async function reset(){closeOverlay();$$('.sheet,.scrim,.lb',layer)", "async function reset(){closeOverlay();$$('.sheet,.scrim,.lb,.gl-bg,.annp,#ann-banners,.upw',layer)")
sub("buildRoot();bindChats();bindContacts();bindSettings();",
    "$('#accbar').addEventListener('click',e=>{const a=e.target.closest('[data-a]');if(a){S.acc=a.dataset.a;applyAccent()}});\nbuildRoot();bindChats();bindContacts();bindSettings();")
sub("root.style.setProperty('--accent-rgb',c.join(','))}", "root.style.setProperty('--accent-rgb',c.join(','));$$('#accbar .dot2').forEach(d=>d.classList.toggle('on',d.dataset.a===S.acc))}")

# 10b. аватарка комнаты: cssText затирал фон
sub("a.style.cssText='width:84px;height:84px;font-size:30px'", "a.style.cssText+=';width:84px;height:84px;font-size:30px'")

# 10c. закрытие листов: единая кнопка-крестик
sub("el.innerHTML='<div class=\"gr\"></div>'+html;", "el.innerHTML='<div class=\"gr\"></div><button class=\"sx\" data-close aria-label=\"Закрыть\">'+I('x')+'</button>'+html;")

# 10d. шапка списка чатов: заголовок, поиск и папки — одна сплошная панель
rsub(r"v\.innerHTML=`<div class=\"nav lg\"><div class=\"nb\" style=\"visibility:hidden\"></div><div class=\"nt\"><span class=\"glass\">Чаты</span></div>.*?<div id=\"clist\"></div></div>`;",
     "v.innerHTML=`<div class=\"chdr\"><div class=\"chtop\"><h1 class=\"lt\">Чаты</h1><button class=\"nb gi\" data-act=\"compose\" aria-label=\"Новый чат\">${I('edit')}</button></div>"
     "<label class=\"srch\">${I('search')}<input id=\"cq\" placeholder=\"Поиск\" autocomplete=\"off\" value=\"${esc(S.q)}\"></label>"
     "${S.set.spaces?`<div class=\"chips\"><button class=\"chip on\" data-act=\"space\">${I('grid')}${esc(S.space)}${I('chevDown')}</button></div>`:''}"
     "<div class=\"fbar\"><div class=\"chips fo\"><div class=\"fgrp\">${FOLD.map(([k,l,ic])=>`<button class=\"chip${S.folder===k?' on':''}\" data-fo=\"${k}\">${I(ic)}${l}</button>`).join('')}</div></div></div></div>"
     "<div class=\"scroll\"><div id=\"clist\"></div></div>`;")

sub('<button data-s="guest">Гостевая ссылка</button>', '<button data-s="login">Вход</button><button data-s="update">Обновление</button><button data-s="offline">Сервер недоступен</button><button data-s="guest">Гостевая ссылка</button>')
sub("else if(s==='guest'){setTab('chats');openGroup('team')",
    "else if(s==='login')openLogin();else if(s==='update'){setTab('chats');updateSheet()}else if(s==='offline'){setTab('chats');openChat('dev');await sleep(650);fin();setOffline(true)}\n  else if(s==='guest'){setTab('chats');openGroup('team')")
sub("const s=b.dataset.s;await reset();", "const s=b.dataset.s;if(s==='offline'&&S.offline){setOffline(false);return}await reset();")
sub("async function reset(){closeOverlay();$$('.sheet,.scrim,.lb,.gl-bg,.annp,#ann-banners,.upw',layer)",
    "async function reset(){closeOverlay();$$('.cnbar').forEach(x=>x.remove());S.offline=false;$$('.sheet,.scrim,.lb,.gl-bg,.annp,#ann-banners,.upw,.login,.upb',layer)")

# 11. без сервис-воркера (макет открывается как файл)
rsub(r"if\('serviceWorker' in navigator&&location\.protocol!=='file:'\)\{.*?\n\}\n", '')

# 12. заглушка запросов и окна — в конец основного скрипта (до сцен)
mock_js = rd(os.path.join(HERE, 'windows-m.js')) + '\n' + rd(os.path.join(HERE, 'screens-m.js'))
sub('/* ---------- сцены и запуск ---------- */', mock_js + '\n/* ---------- сцены и запуск ---------- */')

# 13. настоящие модули клиента (общий код) перед основным скриптом
def shared(name, patches=()):
    t = rd(os.path.join(PUB, 'shared', name))
    assert '</script' not in t, name
    for old, new in patches:
        assert t.count(old) >= 1, name + ': не найдено ' + old[:60]
        t = t.replace(old, new)
    return '<script>\n' + t + '\n</script>\n'


MCHK = ("/^\\/m(\\/|$)/.test(location.pathname)", "true")        # в макете окна всегда мобильного вида (gl-m)
INTO_PHONE = ("document.body.appendChild(bg)", "(document.getElementById('layer')||document.body).appendChild(bg)")  # окна — внутри экрана телефона
# в самом клиенте /m общий класс .gl (подпись группы) пересекается с корнем окна гостевой ссылки: в макете правило окна сужено до .gl-bg>.gl
GL_ROOT = ("'.gl{background:var(--gl-bg);", "'.gl-bg>.gl{background:var(--gl-bg);")
mods = (shared('fmt.js') + shared('voice.js') + shared('guestlinks.js', [MCHK, INTO_PHONE, GL_ROOT]) + shared('calllinks.js', [MCHK, INTO_PHONE]))
sub('<script>\nconst IC={', mods + '<script>\nconst IC={')

out = os.path.join(ROOT, 'docs/flat-mockup/mobile.html')
open(out, 'w', encoding='utf-8').write(src)
print('готово:', out, len(src), 'байт')
