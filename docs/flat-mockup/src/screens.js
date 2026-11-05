/* ---------- вход, окна обновления, недоступность сервера (по настоящему клиенту: login-*, update-modal, force-update-modal, server-toast) ---------- */
IC.refresh='<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>';
IC.wifioff='<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>';
win.insertAdjacentHTML('beforeend',`
<div class="loginscr" id="loginscr" aria-hidden="true">
  <div class="lights"><b></b><b></b><b></b></div>
  <button class="lg-ha" type="button" data-lg="ha">${I('shield')}Высокая доступность</button>
  <div class="lg-card" id="lgcard"></div>
</div>
<div class="srvtoast" id="srvtoast" role="status"><i class="spin sm"></i><span>Нет соединения с сервером. Переподключение…</span></div>`);
const lgForm=(err='')=>`
  <div class="lg-logo">${I('chat')}</div>
  <h1 class="lg-word"><span>ELECTRON</span> <span>MESSENGER</span></h1>
  <p class="lg-sub">Корпоративный мессенджер</p>
  <div class="lg-f"><label>Адрес сервера</label><input id="lg-s" placeholder="192.168.1.10:3000" autocomplete="off" spellcheck="false"></div>
  <div class="lg-f"><label>Логин</label><input id="lg-u" placeholder="username" autocomplete="off"></div>
  <div class="lg-f"><label>Пароль</label><input id="lg-p" type="password" placeholder="••••••••"></div>
  <button class="lg-btn" type="button" data-lg="go">Войти</button>
  <div class="lg-err" id="lg-err">${err}</div>
  <div class="lg-copy">w/ <span style="color:var(--danger)">❤</span> by bolgov0zero · v3.35.1</div>`;
const lgBoot=(t='Подключаюсь к серверу…')=>`
  <div class="lg-logo">${I('chat')}</div>
  <h1 class="lg-word"><span>ELECTRON</span> <span>MESSENGER</span></h1>
  <div class="lg-boot"><i class="spin"></i><div class="lg-bt">${t}</div><button class="btn" type="button" data-lg="manual">Войти вручную</button></div>`;
let lgTimer=0;
function loginShow(mode){
  const s=$('#loginscr');closeMenus();$$('.modal-bg.open').forEach(b=>closeModal(b));
  clearTimeout(lgTimer);$('#lgcard').innerHTML=mode==='boot'?lgBoot():lgForm(mode==='err'?'Неверный логин или пароль':'');
  s.classList.add('on');s.setAttribute('aria-hidden','false');
  if(mode==='boot')lgTimer=setTimeout(()=>loginShow('form'),2600);
}
function loginHide(){const s=$('#loginscr');s.classList.remove('on');s.setAttribute('aria-hidden','true')}
$('#loginscr').addEventListener('click',e=>{
  const b=e.target.closest('[data-lg]');if(!b)return;const k=b.dataset.lg;
  if(k==='manual')loginShow('form');
  else if(k==='ha')toast('Высокая доступность: выбор диска и режима — отдельное окно');
  else if(k==='go'){
    const v=['lg-s','lg-u','lg-p'].map(i=>$('#'+i).value.trim());
    if(v.some(x=>!x)){$('#lg-err').textContent='Заполните адрес сервера, логин и пароль';return}
    if(v[2]==='error'){loginShow('err');return}
    $('#lgcard').innerHTML=lgBoot('Вхожу…');lgTimer=setTimeout(loginHide,1300);
  }
});
$('#loginscr').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT')$('[data-lg="go"]').click()});
/* окно обновления */
function modalUpdate(){
  const bg=openModal('w440',`<div class="modal-hdr"><span class="up-ic">${I('refresh')}</span><div class="grow"><div class="up-t">Доступно обновление</div><div class="up-v">Версия 3.18.0 · сейчас 3.17.2</div></div><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
  <div class="up-body"><div class="up-l">Что нового</div><ul class="up-notes"><li>Новый вид клиента: плоские карточки, единые радиусы и переключатели.</li><li>Гостевые ссылки на видеозвонок.</li><li>Исправлена отправка нескольких вложений подряд.</li></ul>
  <div class="up-prog" id="upp" hidden><div class="up-bar"><i id="upf"></i></div><div class="up-pt" id="upt">Загрузка…</div></div></div>
  <div class="modal-footer" id="upfoot"><button class="btn" data-a="close">Пропустить</button><button class="btn pri" id="upgo">${I('refresh')}Обновить и перезапустить</button></div>`);
  $('#upgo',bg).onclick=()=>{
    $('#upfoot',bg).innerHTML='<button class="btn" disabled>Загрузка…</button>';$('#upp',bg).hidden=false;let p=0;
    const t=setInterval(()=>{p=Math.min(100,p+7+Math.random()*9);$('#upf',bg).style.width=p+'%';$('#upt',bg).textContent=p<100?'Загрузка… '+Math.round(p)+'%':'Перезапуск…';
      if(p>=100){clearInterval(t);setTimeout(()=>{closeModal(bg);toast('Клиент перезапустится и применит обновление')},900)}},260);
  };
}
/* принудительное (дистанционное) обновление: закрыть нельзя */
function modalForceUpdate(){
  const bg=openModal('w360 up-force',`<div class="up-fi">${I('refresh')}</div><div class="up-ft">Дистанционное обновление</div><div class="up-fs" id="ufs">Загрузка обновления…</div>
  <div class="up-fbar"><div class="up-bar"><i id="uff"></i></div><div class="up-pct" id="ufp">0%</div></div>`);
  let p=0;const t=setInterval(()=>{p=Math.min(100,p+6+Math.random()*8);$('#uff',bg).style.width=p+'%';$('#ufp',bg).textContent=Math.round(p)+'%';if(p>=100){clearInterval(t);$('#ufs',bg).textContent='Перезапуск…';setTimeout(()=>closeModal(bg),1100)}},240);
}
/* уведомление о недоступности сервера */
function toggleOffline(){const el=$('#srvtoast'),on=!el.classList.contains('on');el.classList.toggle('on',on);if(on)closeMenus()}
