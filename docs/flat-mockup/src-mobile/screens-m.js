/* ---------- вход (как в /m: логотип, «Electron», логин и пароль, строка ошибки, кнопка «Войти») ---------- */
function openLogin(){if($('.login',layer))return;const el=document.createElement('div');el.className='login';
  el.innerHTML=`<div class="lcard"><div class="lgo">${I('chat')}</div><h1>Electron</h1><p class="lsub">Корпоративный мессенджер</p>
   <label class="fld m">${I('user')}<input id="l-user" type="text" placeholder="Логин" autocomplete="off" spellcheck="false"></label>
   <label class="fld m">${I('lock')}<input id="l-pass" type="password" placeholder="Пароль" autocomplete="off"></label>
   <div class="lerr" id="l-err" role="alert"></div><button class="lbtn" id="l-btn" type="button">Войти</button><div class="lver">Версия 2.23.2</div></div>`;
  layer.append(el);const u=$('#l-user',el),p=$('#l-pass',el),b=$('#l-btn',el),er=$('#l-err',el);
  const go=async()=>{er.textContent='';if(!u.value.trim()||!p.value){er.textContent='Введите логин и пароль';return}
    b.disabled=true;b.innerHTML='<i class="cspin"></i>Подключение…';await sleep(1000);
    if(p.value==='wrong'){er.textContent='Неверный логин или пароль';b.disabled=false;b.textContent='Войти';return}
    el.style.opacity=0;el.style.transition='opacity .25s';setTimeout(()=>{el.remove();toast('Вы вошли как '+u.value.trim(),'user')},260)};
  b.onclick=go;u.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();p.focus()}});p.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}})}

/* ---------- обновление: баннер «Вышла новая версия» (как в /m) и лист с описанием и прогрессом ---------- */
function updateSheet(){const ban=document.createElement('div');ban.className='upb';ban.innerHTML=`<span class="ui">${I('upd')}</span><div><b>Вышла новая версия</b><span>Нажмите, чтобы обновить</span></div>`;layer.append(ban);
  const s=sheet(`<h3>Доступно обновление</h3><div class="sub">Версия 2.24.0 · 12 МБ · сейчас у вас 2.23.2</div>
   <div class="upl"><b>Что нового</b><ul><li>Ссылки на видеозвонок для гостей</li><li>Голосовые сообщения: скорость 1,5× и 2×</li><li>Новый вид: плоские карточки вместо стекла</li><li>Исправления в списке чатов и поиске</li></ul></div>
   <div class="upp" hidden><i></i></div><div class="upn"></div><button class="abtn pri" data-up>Обновить</button><button class="abtn" data-sk>Пропустить</button>`,{onClose:()=>{ban.remove()}});
  const bar=$('.upp',s.el),fill=$('i',bar),note=$('.upn',s.el),btn=$('[data-up]',s.el);
  s.el.addEventListener('click',e=>{if(e.target.closest('[data-sk]')){s.close();return}
    if(e.target.closest('[data-up]')&&!btn.disabled){btn.disabled=true;bar.hidden=false;let n=0;btn.innerHTML='<i class="cspin"></i>Загрузка…';
      const iv=setInterval(()=>{n=Math.min(100,n+4+Math.random()*7);fill.style.width=n+'%';note.textContent='Загружено '+Math.round(n)+'%';
        if(n>=100){clearInterval(iv);note.textContent='Готово. Приложение перезапустится…';btn.textContent='Перезапуск…';setTimeout(()=>{s.close();toast('Обновлено до 2.24.0 (в макете без перезагрузки)','upd')},1200)}},180)}});
  ban.onclick=()=>toast('Лист обновления уже открыт','upd')}

/* ---------- нет связи с сервером: плашка .cnbar (в чате — под шапкой, в списке — над нижней панелью) ---------- */
function setOffline(on){$$('.cnbar').forEach(x=>x.remove());S.offline=on;if(!on){toast('Соединение восстановлено','check');return}
  const bar=cls=>{const d=document.createElement('div');d.className='cnbar offline '+cls;d.setAttribute('role','status');d.innerHTML='<i class="cspin"></i>Нет связи с сервером · Переподключение…';return d};
  const top=NAV[NAV.length-1].el;top.append(bar(top.classList.contains('chat')?'':'bt'));
  const root_=NAV[0].el;if(root_!==top)root_.append(bar('bt'))}
