/* ---------- окна «Гостевая ссылка» и «Ссылка на видеозвонок»: настоящий код клиента (shared/guestlinks.js, shared/calllinks.js), запросы к серверу — заглушка ---------- */
const NOW=()=>Math.floor(Date.now()/1000);
const GL=[{id:1,guest_name:'Иван Петров, подрядчик',state:'active',bound:true,expires_at:NOW()+5400,created_by_name:'Мария Иванова'},
  {id:2,guest_name:null,state:'pending',expires_at:NOW()+43200,created_by_name:'Мария Иванова'},
  {id:3,guest_name:'Консультант по договору',state:'expired',expires_at:NOW()-7200,created_by_name:'Дмитрий Соколов'}];
let glSeq=10;
async function glRequest(method,path,body){
  await sleep(120);
  if(method==='GET')return{ok:true,data:{links:GL.slice(),now:NOW()}};
  if(method==='POST'&&/\/guest\/links$/.test(path)){const l={id:++glSeq,guest_name:null,state:'pending',expires_at:NOW()+body.ttl_sec,created_by_name:'Мария Иванова'};GL.unshift(l);return{ok:true,data:{url:'https://chat.example.com/g/'+Math.random().toString(36).slice(2,12),expires_at:l.expires_at}}}
  const id=+(path.match(/links\/(\d+)/)||[])[1],l=GL.find(x=>x.id===id);
  if(method==='POST'&&/extend/.test(path)&&l){l.expires_at+=body.add_sec;return{ok:true,data:{}}}
  if(method==='POST'&&/reset-device/.test(path)&&l){l.bound=false;return{ok:true,data:{}}}
  if(method==='DELETE'&&l){l.state='revoked';return{ok:true,data:{}}}
  return{ok:true,data:{}};
}
function openGuest(cid){
  if(document.querySelector('.gl-bg'))return;
  const c=CH.find(x=>x.id===cid)||(cur&&cur.c)||CH.find(x=>x.id==='team');
  GuestLinks.open({chatId:c.id,chatName:c.n,request:glRequest});
}
const CL=[{id:1,token:'q7Hk2mZp9XaB',live:true,people:3,waiting:1,expires_at:NOW()+30000},
  {id:2,token:'T4nR8vLc1WdE',live:false,people:0,waiting:0,expires_at:NOW()+250000}];
let clSeq=10;
async function clRequest(method,path,body){
  await sleep(100);
  if(method==='GET')return{ok:true,data:{links:CL.slice(),warnings:['not_public']}};
  if(method==='POST'&&/\/calllinks$/.test(path)){CL.unshift({id:++clSeq,token:Math.random().toString(36).slice(2,14),live:false,people:0,waiting:0,expires_at:NOW()+body.ttl});return{ok:true,data:{}}}
  const id=+(path.match(/calllinks\/(\d+)/)||[])[1],i=CL.findIndex(x=>x.id===id);
  if(method==='POST'&&/end/.test(path)&&i>=0){CL[i].live=false;CL[i].people=0;CL[i].waiting=0}
  if(method==='DELETE'&&i>=0)CL.splice(i,1);
  return{ok:true,data:{}};
}
function openCallLink(){if(document.querySelector('.gl-bg'))return;CallLinks.open({base:'https://chat.example.com',request:clRequest})}

/* ---------- объявление: лист отправки (по образцу окна «Новое объявление» в десктопном макете) и приём (полоса и карточка, как в /m) ---------- */
function annSheet(){
  const KINDS={chat:['В чаты','Строка от системы в группах и комнатах, остаётся в переписке'],popup:['Всплывающее','Карточка у тех, кто в сети в момент отправки'],banner:['Полоса','Тонкая полоса сверху на заданное время, догоняет тех, кого не было в сети']};
  const WHEN=[['now','Сейчас'],['hour','Через час'],['today','Сегодня 18:00'],['tom','Завтра 09:00']],DURS=[[15,'15 мин'],[60,'1 ч'],[180,'3 ч'],[1440,'Сутки']];
  const A={kind:'banner',text:'',wk:'now',dur:60,mode:'all',who:new Set()},ks=Object.keys(PPL);
  const s=sheet(`<h3>Новое объявление</h3><div class="sub">Текст, тип и время</div><div class="sb">
    <div class="seg f" id="ak" style="margin-top:2px"><i class="thumb"></i>${Object.entries(KINDS).map(([k,v])=>`<button data-k="${k}">${v[0]}</button>`).join('')}</div>
    <div class="ann-hint" id="ah"></div>
    <label class="fld ann-ta"><textarea id="at" rows="3" placeholder="Что сказать людям" aria-label="Текст объявления"></textarea></label>
    <div class="gl" style="padding-top:10px">Когда</div><div class="chips" id="aw" style="margin-bottom:6px">${WHEN.map(([k,l])=>`<button class="chip" data-w="${k}">${l}</button>`).join('')}</div>
    <div id="adf"><div class="gl" style="padding-top:6px">Показывать</div><div class="chips" id="ad" style="margin-bottom:6px">${DURS.map(([d,l])=>`<button class="chip" data-d="${d}">${l}</button>`).join('')}</div></div>
    <div class="gl" style="padding-top:6px">Кому отправить</div>
    <div class="seg f" id="am" style="margin-bottom:8px"><i class="thumb"></i><button data-m="all">Всем</button><button data-m="pick">Выбранным</button></div>
    <div id="arl"></div></div>
    <div class="ann-foot"><span class="ann-note" id="an"></span></div><button class="abtn pri" id="ago" disabled>Отправить</button>`);
  const el=s.el,$e=q=>$(q,el);
  const list=()=>A.mode==='all'?`<div class="gf" style="margin:0;padding:2px 6px 8px">Получат все ${ks.length}. Нажмите «Выбранным», чтобы отметить людей.</div>`:`<div class="grp glass">${ks.map(k=>`<button class="mini${A.who.has(k)?' on':''}" data-k="${k}">${avHtml(PPL[k],'')}<span class="rt"><b>${PPL[k].n}</b><small>${PPL[k].ws}</small></span><span class="ck">${I('check')}</span></button>`).join('')}</div>`;
  const upd=()=>{const miss=[];if(!A.text.trim())miss.push('текст');if(A.mode==='pick'&&!A.who.size)miss.push('получателей');
    $$('#ak button',el).forEach(b=>b.classList.toggle('on',b.dataset.k===A.kind));$$('#aw .chip',el).forEach(b=>b.classList.toggle('on',b.dataset.w===A.wk));$$('#ad .chip',el).forEach(b=>b.classList.toggle('on',+b.dataset.d===A.dur));
    $$('#am button',el).forEach(b=>b.classList.toggle('on',b.dataset.m===A.mode));$e('#adf').style.display=A.kind==='banner'?'':'none';$e('#ah').textContent=KINDS[A.kind][1];
    $e('#an').innerHTML=miss.length?'Осталось: <b>'+miss.join(', ')+'</b>':'<b class="ok">Всё готово</b>';$e('#ago').disabled=!!miss.length;
    $e('#arl').innerHTML=list();segMove($e('#ak'));segMove($e('#am'))};
  upd();setTimeout(()=>{segMove($e('#ak'));segMove($e('#am'))},60);
  el.addEventListener('click',e=>{const t=e.target;let b;
    if(b=t.closest('#ak button'))A.kind=b.dataset.k;else if(b=t.closest('#aw .chip'))A.wk=b.dataset.w;else if(b=t.closest('#ad .chip'))A.dur=+b.dataset.d;
    else if(b=t.closest('#am button'))A.mode=b.dataset.m;else if(b=t.closest('.mini[data-k]')){A.who.has(b.dataset.k)?A.who.delete(b.dataset.k):A.who.add(b.dataset.k)}
    else if(t.closest('#ago')){const txt=A.text.trim(),kind=A.kind;s.close();toast('Объявление отправлено','bell');setTimeout(()=>annReceive(kind,txt),900);return}else return;
    const st=$('.sb',el).scrollTop;upd();$('.sb',el).scrollTop=st});
  $e('#at').addEventListener('input',e=>{A.text=e.target.value;const miss=!A.text.trim();$e('#ago').disabled=miss||(A.mode==='pick'&&!A.who.size);$e('#an').innerHTML=miss?'Осталось: <b>текст</b>':(A.mode==='pick'&&!A.who.size?'Осталось: <b>получателей</b>':'<b class="ok">Всё готово</b>')});
}
const BELLX='<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const XX='<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
function annReceive(kind,text){text=text||'Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.';
  if(kind==='popup'){const el=document.createElement('div');el.className='annp';el.setAttribute('role','alertdialog');el.innerHTML=`<div class="annp-c"><div class="annp-h"><span class="annp-r">${BELLX}</span>Системное объявление</div><div class="annp-t"></div><button type="button" class="annp-ok">OK</button></div>`;
    $('.annp-t',el).textContent=text;layer.append(el);void el.offsetWidth;el.classList.add('on');$('.annp-ok',el).onclick=()=>{el.classList.remove('on');setTimeout(()=>el.remove(),260)};return}
  if(kind==='chat'){const sc_=cur&&$('.scroll',cur.el);if(sc_){const g=$$('.day-group',sc_).pop()||$('.msgs',sc_);g.insertAdjacentHTML('beforeend',`<div class="sys"><span class="glass">${esc(text)} · ${new Date().toTimeString().slice(0,5)}</span></div>`);sc_.scrollTo({top:1e6,behavior:'smooth'})}else toast('Строка появится в группах и комнатах','bell');return}
  let host=$('#ann-banners',layer);if(!host){host=document.createElement('div');host.id='ann-banners';layer.append(host)}
  const el=document.createElement('div');el.className='annb';el.innerHTML=`<span class="annb-i">${BELLX}</span><span class="annb-t"></span><button type="button" class="annb-x" aria-label="Скрыть">${XX}</button>`;
  $('.annb-t',el).textContent=text;const hide=()=>{el.classList.remove('on');setTimeout(()=>el.remove(),380)};$('.annb-x',el).onclick=hide;host.append(el);setTimeout(()=>el.classList.add('on'),10)}

/* ---------- записи (аккаунты): в /m одна, в макете три — как в баре десктопа ---------- */
const ACCS=[{n:'Мария Иванова',s:'@admin · Электрон',bg:'#f6a35a,#e0507a',ini:'МИ',st:'в сети'},{n:'Рабочая запись',s:'@mivanova · work.example.com',bg:'#5a63c8,#2e3590',ini:'РЗ',st:'отошла',n3:3},{n:'Другой сервер',s:'@maria · lab.example.org',bg:'#34a1a0,#1f6f78',ini:'ДС',st:'не в сети'}];
function accSheet(){let on=0;const pd=a=>a.st==='в сети'?'':a.st==='отошла'?' away':' off';
  const draw=()=>ACCS.map((a,i)=>`<button class="accr${i===on?' on':''}" data-i="${i}"><span class="acct"><span class="av sm" style="background:linear-gradient(135deg,${a.bg})">${a.ini}</span><i class="pd${pd(a)}"></i>${a.n3?`<em>${a.n3}</em>`:''}</span><span class="rt"><b>${a.n}</b><small>${a.s}</small></span></button>`).join('');
  const s=sheet(`<h3>Записи</h3><div class="sub">Выберите запись, под которой работать</div><div class="accl" id="acl">${draw()}</div><button class="abtn" data-add>${I('plus')}Добавить запись</button><button class="abtn" data-close>Закрыть</button>`);
  s.el.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b){on=+b.dataset.i;$('#acl',s.el).innerHTML=draw();setTimeout(()=>{s.close();toast('Запись: '+ACCS[on].n,'user')},250);return}if(e.target.closest('[data-add]')){s.close();toast('Вход в другую запись (в макете не выполняется)','userPlus')}})}

/* ---------- настройки: «Звонки» (как в /m: включение, аудио, видео, устройства) ---------- */
function openCalls(){const d=S.set.calls=S.set.calls||{on:true,audio:true,video:true};
  const row=(k,l,dis)=>`<div class="cell"${dis?' style="opacity:.55"':''}><span class="cl">${l}</span>${tgS('c-'+k,d[k])}</div>`;
  const el=setPage('Звонки',`<div class="grp glass">${row('on','Звонки включены')}${row('audio','Аудиозвонки')}${row('video','Видеозвонки')}</div><div class="gf">Если выключить, входящих звонков не будет, а кнопки вызова в чатах пропадут.</div>
  <div class="gl">Устройства</div><div class="grp glass">${[['Микрофон','Встроенный микрофон'],['Динамик','Динамик iPhone'],['Камера','Фронтальная']].map(([a,b])=>`<div class="cell"><span class="cl">${a}</span><span class="cv">${b}</span><span class="ch">${I('chevDown')}</span></div>`).join('')}</div>
  <div class="gl">Ссылки на видеозвонок</div><div class="grp glass"><button class="cell" data-cl><span class="ci" style="background:var(--accent)">${I('link')}</span><span class="cl">Ссылки для гостей</span><span class="ch">${I('chevRight')}</span></button></div>`);
  el.addEventListener('click',e=>{const t=e.target.closest('[data-tg]');if(t){d[t.dataset.tg.slice(2)]=t.getAttribute('aria-checked')==='true'}if(e.target.closest('[data-cl]'))openCallLink()})}

/* ---------- кнопка звонка в шапке чата ---------- */
function callSheet(c){const s=sheet(`<h3>${esc(c.n)}</h3><div class="sub">Звонок</div><div class="grp glass"><button class="cell" data-k="a"><span class="ci" style="background:#34c759">${I('phone')}</span><span class="cl">Аудиозвонок</span></button><button class="cell" data-k="v"><span class="ci" style="background:var(--accent)">${I('video')}</span><span class="cl">Видеозвонок</span></button><button class="cell" data-k="l"><span class="ci" style="background:#5b8def">${I('link')}</span><span class="cl">Ссылка на видеозвонок</span><span class="ch">${I('chevRight')}</span></button></div><button class="abtn" data-close>Отмена</button>`);
  s.el.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;s.close();if(b.dataset.k==='l')setTimeout(openCallLink,220);else toast(b.dataset.k==='a'?'Вызов…':'Видеовызов…',b.dataset.k==='a'?'phone':'video')})}
