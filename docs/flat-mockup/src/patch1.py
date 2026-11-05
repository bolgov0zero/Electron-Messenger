#!/usr/bin/env python3
# Разовая правка исходников сборки (аккаунты как папки, подписи вкладок, служебные сообщения в переписке)
s = open('build.py', encoding='utf-8').read()
a = s.index("sub('<button class=\"me\" id=\"meBtn\"")
b = s.index("# 5. переписка")
new = '''sub('<button class="me" id="meBtn" title="Профиль">АБ</button>',
    '<div class="accs" id="accs">'
    '<button class="ws acc on" id="meBtn" title="Мария Иванова · в сети" data-acc="0"><span class="ava" style="background:linear-gradient(135deg,#f6a35a,#e0507a)">АБ</span><i class="pd"></i></button>'
    '<button class="ws acc" title="Рабочая запись · отошла" data-acc="1"><span class="ava" style="background:linear-gradient(135deg,#5a63c8,#2e3590)">МП</span><em>3</em><i class="pd away"></i></button>'
    '<button class="ws acc" title="Другой сервер · не в сети" data-acc="2"><span class="ava" style="background:linear-gradient(135deg,#34a1a0,#1f6f78)">ДС</span><i class="pd off"></i></button></div>')
# подписи под значками нижней панели
sub("$('#menu [data-m=\\"file\\"]').insertAdjacentHTML('beforeend','Прикрепить файл');", "$$('#tabs button').forEach(b=>b.insertAdjacentHTML('beforeend','<span>'+b.getAttribute('aria-label')+'</span>'));\\n$('#menu [data-m=\\"file\\"]').insertAdjacentHTML('beforeend','Прикрепить файл');")

'''
s = s[:a] + new + s[b:]
old = "sub('Размытые цветные пятна за стеклом.', 'Размытые цветные пятна за перепиской.')"
assert old in s
s = s.replace(old, "sub('<div class=\"cs-r\"><div class=\"cs-l\"><b>Цветная картинка</b>', '<div class=\"cs-r\" hidden><div class=\"cs-l\"><b>Цветная картинка</b>')")
open('build.py', 'w', encoding='utf-8').write(s)

w = open('windows.js', encoding='utf-8').read()
w = w.replace("#accs .me", "#accs .ws").replace("e.target.closest('.me')", "e.target.closest('.ws')")
open('windows.js', 'w', encoding='utf-8').write(w)

c = open('chat.js', encoding='utf-8').read()
c = c.replace("function convoHtml(cid,dm){", """CONVO.team.unshift({sys:'add',t:'Дмитрий Соколов добавил(а) Елену Миронову',tm:'09:10'});
CONVO.team.splice(5,0,{sys:'ann',t:'Объявление: завтра в 22:00 обновление сервера',tm:'09:28'});
CONVO.team.splice(7,0,{unread:1});
const SYS_IC={add:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',ann:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'};
function convoHtml(cid,dm){""", 1)
old = "L.forEach((m,i)=>{h+=msgHtml(cid,m,i?key(L[i-1]):null,dm,i<L.length-1?key(L[i+1]):undefined)});"
assert old in c
c = c.replace(old, """L.forEach((m,i)=>{
    if(m.sys){h+=`<div class="sysnote ${m.sys}"><svg viewBox="0 0 24 24">${SYS_IC[m.sys]}</svg><span>${m.t}</span><time>${m.tm}</time></div>`;return}
    if(m.unread){h+='<div class="date-divider unread-divider"><span>Непрочитанные сообщения</span></div>';return}
    const pv=L[i-1],nx=L[i+1],ok=x=>x&&!x.sys&&!x.unread;
    h+=msgHtml(cid,m,ok(pv)?key(pv):null,dm,ok(nx)?key(nx):(nx?null:undefined))});""", 1)
open('chat.js', 'w', encoding='utf-8').write(c)
print('patch1 ok')
