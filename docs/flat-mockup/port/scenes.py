#!/usr/bin/env python3
"""Генерация config.json для shot-live.js и shot-ref.js (сцены шагов 1.0–1.2).
python3 scenes.py <live|ref> <outdir> <темы через запятую> [акцент] [сцены через запятую] [-> путь config]
"""
import json, sys, os, urllib.parse
SCRATCH = '/private/tmp/claude-501/-Users-bolgov-Documents-My-Projects-Chat/1b100143-140b-4b9d-bfad-21021ebb6c08/scratchpad'
HERE = os.path.dirname(os.path.abspath(__file__))
kind, outdir, themes = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
accent = sys.argv[4] if len(sys.argv) > 4 else 'teal'
want = sys.argv[5].split(',') if len(sys.argv) > 5 else ['chats', 'chat', 'settings', 'profile']
cfgpath = sys.argv[6] if len(sys.argv) > 6 else os.path.join(SCRATCH, 'cfg-%s.json' % kind)

LIVE = {
 'chats': "B.nav.popToRoot();B.setTab('chats');(()=>{const q=document.getElementById('cq');if(q&&q.value){q.value='';q.dispatchEvent(new Event('input'))}})()",
 'chatsscroll': "B.nav.popToRoot();B.setTab('chats');document.querySelector('.tabview[data-tab=\"chats\"] .scroll').scrollTop=150",
 'chat': "B.nav.popToRoot();B.setTab('chats');B.openChat(B.S.chats.find(c=>c.name==='Команда продукта').id)",
 'room': "B.nav.popToRoot();B.setTab('chats');B.openChat(B.S.chats.find(c=>c.name==='Вся компания').id)",
 'settings': "B.nav.popToRoot();B.setTab('settings')",
 'contacts': "B.nav.popToRoot();B.setTab('contacts')",
 'profile': "B.nav.popToRoot();B.setTab('contacts');B.openProfile(B.S.chats.find(c=>c.type==='direct'&&c.members.some(m=>m.username==='dsokolov')).members.find(m=>m.username==='dsokolov').id)",
}
W = "await new Promise(r=>setTimeout(r,%d));"
CLR = "try{B.sheet.closeNow();B.menu.close();var ph=document.getElementById('app');ph.classList.remove('ep','kb','kbr','kbo');ph.style.removeProperty('--kbh');document.querySelectorAll('.upw').forEach(function(e){e.remove()})}catch(e){}{const q=document.getElementById('cq');if(q&&q.value){q.value='';q.dispatchEvent(new Event('input'))}}"
OPEN_TEAM = CLR + "B.nav.popToRoot();B.setTab('chats');B.openChat(B.S.chats.find(c=>c.name==='Команда продукта').id);" + (W % 1700)
PAGE = "const el=document.querySelector('.page.chat');"
ROW_OUT = PAGE + "const row=[...el.querySelectorAll('.mrow.out')].find(r=>r.querySelector('.quote'))||el.querySelector('.mrow.out');row.scrollIntoView({block:'center'});" + (W % 300)
ROW_IN = PAGE + "const row=[...el.querySelectorAll('.mrow.in')].filter(r=>r.querySelector('.txt')).slice(-1)[0];row.scrollIntoView({block:'center'});" + (W % 300)
MENU = "B.ui.msgmenu.open(el,row,row.querySelector('.bub'));"
LIVE.update({
 'chats-q': "(async()=>{B.nav.popToRoot();B.setTab('chats');const i=document.getElementById('cq');i.value='Дм';i.dispatchEvent(new Event('input'));" + (W % 1200) + "})()",
 'room': "(async()=>{B.nav.popToRoot();B.setTab('chats');B.openChat(B.S.chats.find(c=>c.name==='Вся компания').id);" + (W % 1200) + "})()",
 'msgmenu': "(async()=>{" + OPEN_TEAM + ROW_OUT + MENU + "})()",
 'react': "(async()=>{" + OPEN_TEAM + ROW_IN + MENU + "})()",
 'reactall': "(async()=>{" + OPEN_TEAM + ROW_IN + MENU + (W % 500) + "document.querySelector('.cmr .more').click();})()",
 'emoji': "(async()=>{" + OPEN_TEAM + "document.querySelector('.page.chat [data-k=emo]').click();})()",
 'plusmenu': "(async()=>{" + OPEN_TEAM + "document.querySelector('.page.chat [data-k=up]').click();})()",
 'chatmenu': "(async()=>{" + CLR + "B.nav.popToRoot();B.setTab('chats');" + (W % 600) + "const r=document.querySelector('.row[data-id=\"'+B.S.chats.find(c=>c.name==='Проект Север: запуск').id+'\"]');r.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:100,clientY:300}));" + (W % 700) + "})()",
 'fwd': "(async()=>{" + OPEN_TEAM + ROW_IN + MENU + (W % 500) + "[...document.querySelectorAll('.cmm button')].find(b=>/Переслать/.test(b.textContent)).click();})()",
})
LIVE.update({
 'reply': "(async()=>{" + OPEN_TEAM + ROW_IN + "B.ui.composer.reply(el,B.msgs.find(+row.dataset.mid));" + (W % 400) + "})()",
 'fmt': "(async()=>{" + OPEN_TEAM + "document.querySelector('.page.chat [data-k=up]').click();" + (W % 500) + "[...document.querySelectorAll('.upm button')].find(b=>/Форматирование/.test(b.textContent)).click();" + (W % 400) + "})()",
})
LIVE.update({
 'kb': "(async()=>{" + OPEN_TEAM + "const pp=document.getElementById('app');pp.style.setProperty('--kbh','336px');pp.classList.add('kbo','kbr');" + (W % 500) + "})()",
 'kbep': "(async()=>{" + OPEN_TEAM + "const pp=document.getElementById('app');pp.style.setProperty('--kbh','336px');pp.classList.add('kbo');pp.classList.remove('kbr');document.querySelector('.page.chat [data-k=emo]').click();" + (W % 600) + "})()",
})
LIVE.update({
 'dev': "(async()=>{" + CLR + "B.nav.popToRoot();B.setTab('chats');B.openChat(B.S.chats.find(c=>c.name==='Разработка').id);" + (W % 1800) + "})()",
})

# ── шаги 1.7–1.10: контакты, профили, настройки, окна и состояния ──
RESET = ("try{B.sheet.closeNow();B.menu.close();document.querySelectorAll('.gl-bg,.annp,.upw,#ann-banners,.lbx.on').forEach(function(e){e.classList.contains('lbx')?e.classList.remove('on'):e.remove()});"
         "B.conn.state='ok';B.bus.emit('conn:changed',{state:'ok'});B.app.newVersion=null;B.ui.login.hide();document.querySelectorAll('#cl-incoming,#cl-bar,.cl-win,.cl-full').forEach(function(e){e.remove()});if(window.Calls)Calls.state.incoming=null;"
         "var pp=document.getElementById('app');pp.classList.remove('ep','kb','kbr','kbo');pp.style.removeProperty('--kbh')}catch(e){}"
         "{const q=document.getElementById('cq');if(q&&q.value){q.value='';q.dispatchEvent(new Event('input'))}}B.nav.popToRoot();")
def A(body, wait=800):
    return "(async()=>{" + RESET + body + (W % wait) + "})()"
TEAM = "B.S.chats.find(c=>c.name==='Команда продукта').id"
SET = lambda k: A("B.setTab('settings');" + (W % 400) + "document.querySelector('.tabview[data-tab=settings] [data-s=\"%s\"]').click();" % k, 900)
LIVE.update({
 'updcall': A("B.nav.popToRoot();B.setTab('chats');window.__mk=1;window.APP_VERSION='?v=0';Calls.state.call={id:1,peer:{id:1,name:'x'}};B.app.checkForUpdate();setTimeout(function(){B.toast.show('страница не перезагружена, marker='+window.__mk)},2500);", 3500),
 'updnocall': A("B.nav.popToRoot();B.setTab('chats');window.__mk=1;window.APP_VERSION='?v=0';Calls.state.call=null;B.app.checkForUpdate();setTimeout(function(){B.toast.show('страница не перезагружена, marker='+window.__mk)},2500);", 3500),
 'contacts': A("B.setTab('contacts');", 900),
 'addcontact': A("B.setTab('contacts');" + (W % 300) + "document.querySelector('.tabview[data-tab=contacts] [data-act=add]').click();", 900),
 'group': A("B.setTab('chats');B.openGroupProfile(%s);" % TEAM, 1300),
 'groupguest': A("B.setTab('chats');B.openGroupProfile(%s);" % TEAM + (W % 900) + "document.querySelector('.page [data-r=guest]').click();", 1300),
 'media': A("B.setTab('chats');B.media.openChatMedia(%s);" % TEAM, 1500),
 'newchat': A("B.ui.groups.newChat();", 1100),
 'newgroup': A("B.ui.groups.newChat();" + (W % 700) + "[...document.querySelectorAll('.page button,.page .cell')].find(b=>/Новая группа/.test(b.textContent)).click();", 1000),
 's-me': SET('me'), 's-appearance': SET('appearance'), 's-notif': SET('notif'), 's-modules': SET('modules'),
 's-folders': SET('folders'), 's-blocks': SET('blocks'), 's-diag': SET('diag'),
 's-foldedit': A("B.setTab('settings');B.ui.folders.openPage();" + (W % 800) + "document.querySelector('.page [data-f]').click();", 1000),
 'spaces': A("B.setTab('chats');" + (W % 300) + "document.querySelector('[data-act=space]').click();", 900),
 'annbanner': A("B.setTab('chats');B.ui.announce.show({id:901,text:'Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.',expires_at:Math.floor(Date.now()/1000)+600});", 800),
 'annpopup': A("B.setTab('chats');B.ui.announce.popup('Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.');", 800),
 'login': A("B.ui.login.show();", 600),
 'update': A("B.app.newVersion='9.9.9';B.bus.emit('app:update');B.setTab('settings');B.ui.settings.render&&B.ui.settings.render();B.toast.banner('<div class=\"tt\"><b>Вышла новая версия</b><span>Нажмите, чтобы обновить</span></div>',function(){});", 900),
 'offline': A("B.setTab('chats');B.openChat(%s);" % TEAM + (W % 1500) + "B.conn.state='offline';B.bus.emit('conn:changed',{state:'offline'});", 900),
 'toast': A("B.setTab('chats');B.toast.show('Скопировано','copy');", 600),
 'empty': A("B.setTab('chats');const q=document.getElementById('cq');q.value='яяя';q.dispatchEvent(new Event('input'));", 900),
 'readinfo': A("B.setTab('chats');B.openChat(%s);" % TEAM + (W % 1700) + "const el=document.querySelector('.page.chat');const row=[...el.querySelectorAll('.mrow.out')].find(r=>r.querySelector('.quote'));B.ui.msgmenu.open(el,row,row.querySelector('.bub'));" + (W % 500) + "[...document.querySelectorAll('.cmm button')].find(b=>/Информация/.test(b.textContent)).click();", 1800),
 'swipe': A("B.setTab('chats');B.openChat(%s);" % TEAM + (W % 1700) + "const el=document.querySelector('.page.chat');const row=[...el.querySelectorAll('.mrow.in')].filter(r=>r.querySelector('.txt')).slice(-1)[0];row.scrollIntoView({block:'center'});const sw=row.querySelector('.swi');row.style.transform='translateX(-56px)';if(sw){sw.style.opacity=1;sw.classList.add('arm')}", 900),
 'viewer': A("B.setTab('chats');B.openChat(%s);" % TEAM + (W % 1700) + "document.querySelector('.page.chat .att-img').click();", 1200),
})
INC = lambda video, group: A("B.setTab('chats');var u=B.S.chats.find(c=>c.type==='direct'&&c.members.some(m=>m.username==='dsokolov')).members.find(m=>m.username==='dsokolov');Calls.onWs({type:'call_incoming',call_id:77,chat_id:%s,from:{id:u.id,name:u.display_name},video:%s,group:%s,name:'Команда продукта',participants:%s,timeout:60});" % (TEAM, 'true' if video else 'false', 'true' if group else 'false', '[1,2]' if group else '0'), 900)
LIVE.update({
 'call-in-audio': INC(False, False), 'call-in-video': INC(True, False), 'call-in-group': INC(True, True),
})
CALL_AUDIO = r"""B.setTab('chats');var d=document.createElement('div');d.className='cl-full';d.innerHTML=`<div class="lbl">Аудиозвонок</div><div class="cl-mid"><div class="cl-ring big">${B.avatar.user(0,'Дмитрий Соколов',140,true)}</div><div class="nm">Дмитрий Соколов</div><div class="sub">04:12</div></div><div class="cl-acts"><button class="cl-mb"><span class="rnd sq clg">${I('mic')}</span>Микрофон</button><button class="cl-mb"><span class="rnd sq clg">${I('video')}</span>Камера</button><button class="cl-mb"><span class="rnd no">${I('phone','hang')}</span>Завершить</button></div>`;document.body.appendChild(d);B.avatar.apply(d);"""
CALL_VIDEO = r"""B.setTab('chats');var d=document.createElement('div');d.className='cl-win mob v';d.innerHTML=`<div class="cl-hd"><button class="cl-hbtn l">${I('chevDown')}</button><div class="c"><b>Дмитрий Соколов</b><small>04:12</small></div><span></span></div><div class="cl-stage"><div class="cl-remote"><div class="cl-ph" style="--h:210">${B.avatar.user(0,'Дмитрий Соколов',120,true)}</div></div><div class="cl-pip"></div></div><div class="cl-ctrls cl-vg"><button class="cl-rb">${I('mic')}</button><button class="cl-rb off">${I('video')}</button><button class="cl-rb ac">${I('users')}</button><button class="cl-rb end">${I('phone')}</button></div>`;document.body.appendChild(d);"""
CALL_BAR = r"""B.setTab('chats');var d=document.createElement('div');d.id='cl-bar';d.innerHTML=`${I('phone')}Звонок · Дмитрий Соколов<span class="tm">04:12</span><span class="x">${I('chevRight')}</span>`;document.body.appendChild(d);"""
LIVE.update({'call-audio': A(CALL_AUDIO, 800), 'call-video': A(CALL_VIDEO, 800), 'call-bar': A(CALL_BAR, 600)})
MOCK = {  # сцены макета (data-s) для тех же экранов
 'contacts':'contacts','group':'group','media':'media','newchat':'newchat','newgroup':'newgroup','s-appearance':'appearance','s-folders':'folders','spaces':'spaces',
 'annbanner':'annbanner','annpopup':'annpopup','groupguest':'guest','login':'login','update':'update','offline':'offline'}
REF_JS = {
 'chats-q': "(()=>{const i=document.getElementById('cq');document.querySelector('#scenes [data-s=chats]').click();setTimeout(()=>{i.value='Дм';i.dispatchEvent(new Event('input'))},500)})()",
}
WAITS = {'dev': 2400, 'kb': 2400, 'kbep': 2800, 'reply': 2400, 'fmt': 2800, 'chat': 1800, 'profile': 1800, 'room': 1500, 'msgmenu': 2400, 'react': 2400, 'reactall': 3000, 'emoji': 2600, 'plusmenu': 2400, 'chatmenu': 1800, 'fwd': 3000, 'chats-q': 1800}
shots = []
for s in want:
    w = WAITS.get(s, 900)
    if kind == 'live':
        shots.append({'name': s, 'js': LIVE[s], 'wait': w})
    elif s in REF_JS:
        shots.append({'name': s, 'js': REF_JS[s], 'wait': w})
    else:
        shots.append({'name': s, 'scene': MOCK.get(s, s), 'wait': max(w, 1500)})
runs = [{'theme': t, 'accent': accent, 'shots': shots} for t in themes]
cfg = {'outdir': outdir, 'runs': runs}
if kind == 'live':
    cfg.update({'base': 'http://localhost:3999', 'user': 'mivanova', 'pass': 'stand-Flat-2026'})
else:
    cfg.update({'url': 'file://' + urllib.parse.quote(os.path.abspath(os.path.join(HERE, '..', 'mobile.html')))})
json.dump(cfg, open(cfgpath, 'w'), ensure_ascii=False, indent=1)
print(cfgpath)
