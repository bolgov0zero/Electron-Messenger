/* ═══ Новое в клиенте, часть B: служебные состояния, оверлеи, просмотрщик, пересылка, баннеры, голосовые, скрытый текст ═══
   Разметка и тексты — по настоящему клиенту (server/src/public/chat/index.html, app.js, shared/voice.js, shared/fmt.js).
   Подхватывается build.py сам; всё, что сцена кладёт поверх окна, — класс .xo (чистит resetScene), состояние откатывается через RESETS. */
IC.alert='<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>';
IC.extlink='<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>';
IC.zoomIn='<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>';
IC.zoomOut='<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>';
IC.volume='<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>';
IC.pause='<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>';

const xo=(cls,html,host=win)=>{const e=document.createElement('div');e.className='xo '+cls;e.innerHTML=html;host.appendChild(e);return e};
const xChat=async id=>{if(S.tab!=='chats')setTab('chats');openChat(id);await sleep(220)};
const xScrollTo=(el,off=150)=>{const sc=$('#scroll');sc.scrollTo({top:sc.scrollTop+rectIn(el).t-off,behavior:'smooth'})};

/* ───── значок темы в меню шапки: как в клиенте (в тёмной теме — солнце, в светлой — луна; updateSidebarThemeIcon) ───── */
{const _st=setTheme;setTheme=function(t){_st(t);const m=$('#hm-theme');if(m)m.innerHTML=I(t==='light'?'moon':'sun')}}

/* ───── данные: голосовые и ссылка в «Разработке», скрытый текст в «Команде продукта» ───── */
{
  const dev=CONVO.dev;
  dev.push({a:'dmitry',t:'Ссылка на ТЗ по интеграции: <a class="msg-link" href="#" data-url="https://docs.example.com/spec/integration?v=4&amp;ref=chat">https://docs.example.com/spec/integration</a>',tm:'10:11'},
    {a:'akrylov',voice:{dur:23,seed:3},tm:'10:14',nh:1},
    {a:'me',voice:{dur:12,seed:7},tm:'10:16'},
    {a:'petr',voice:{dur:41,seed:11},tm:'10:19',nh:1});
  const t=CONVO.team,i=t.findIndex(m=>(m.t||'').startsWith('Дорожная карта'));
  t.splice(i+1,0,
    {a:'dmitry',t:'К пятнице заказал для команды <span class="spl">пиццу и мороженое</span>, а ещё сюрприз: <span class="spl">билеты на выставку</span>. Только никому!',tm:'09:31'},
    {a:'me',q:['Дмитрий Соколов','К пятнице заказал для команды ⠶⠖⠲⠦⠴, а ещё сюрприз: ⠒⠔⠐⠠. Только никому!'],t:'Ура, жду!',tm:'09:32'});
  CHATS.find(c=>c.id==='dev').p='Пётр: 🎤 Голосовое сообщение';
  const el=$('#cv-team');if(el)el.remove();const el2=$('#cv-dev');if(el2)el2.remove();
}

/* ───── msgHtml: голосовое сообщение и «Переслано от» (разметка — как у клиента: irc-voice, vm, irc-forward-block) ───── */
const VSP=[1,1.5,2],VS={speed:1,play:new Set(),timer:0};
const vmFmt=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const vmSpeed=()=>(VS.speed===1.5?'1,5':VS.speed)+'×';
function vmBars(seed,n=38){
  let s=seed*9301+49297;const r=()=>{s=(s*9301+49297)%233280;return s/233280};
  const p=[];for(let i=0;i<n;i++)p.push(.14+.86*Math.abs(Math.sin(i*.52+seed))*(.35+.65*r()));
  return p.map((v,i)=>{const sm=(p[i-1]??v)*.25+v*.5+(p[i+1]??v)*.25;return '<i style="width:3px;height:'+(4+Math.pow(Math.min(1,sm),.8)*22).toFixed(0)+'px"></i>'}).join('');
}
function vmHtml(m,own,id,meta){
  const v=m.voice;
  return `<div class="vm ${own?'vm-out':'vm-in'}" data-vdur="${v.dur}" data-vid="${id}"><button class="pl" type="button" aria-label="Воспроизвести">${I('play','p1')}${I('pause','p2')}</button>`
    +`<div class="vb"><div class="wv">${vmBars(v.seed||1)}</div><div class="mt"><span class="du">${vmFmt(v.dur)}</span>${m.nh?'<i class="ud"></i>':''}<button class="spd" type="button">${vmSpeed()}</button><span class="tm">${meta}</span></div></div></div>`;
}
{
  const _mh=msgHtml;
  msgHtml=function(cid,m,prev,dm,next){
    const own=m.a==='me';
    let h=_mh(cid,m.voice?{...m,t:'',voice:undefined,_voice:m.voice}:m,prev,dm,next);
    if(m.voice){
      const mt=/<div class="irc-meta">(.*?)<\/div>/s.exec(h),id=/data-m="([^"]+)"/.exec(h)[1];
      if(mt)h=h.replace(mt[0],'');
      h=h.replace(/<div class="irc-text"><\/div>/,vmHtml(m,own,id,mt?mt[0]:'')).replace('class="irc-msg','class="irc-msg irc-voice');
      if(MSG[id])MSG[id].text='Голосовое сообщение';
    }
    if(m.fwd)h=h.replace('<div class="irc-text">',`<div class="irc-reply irc-forward-block"><div class="irc-reply-body"><div class="irc-reply-name">Переслано от <b>${esc(m.fwd[0])}</b></div>${m.fwd[1]?`<div class="irc-reply-text">${esc(m.fwd[1])}</div>`:''}</div></div><div class="irc-text">`);
    return h;
  };
}

/* ───── голосовое: проигрывание (в макете звука нет — ход и скорость идут по таймеру, как у shared/voice.js) ───── */
function vmPaint(el,pos,playing){
  const dur=+el.dataset.vdur||1,bars=el.querySelectorAll('.wv i'),x=Math.min(1,pos/dur)*bars.length,k=Math.floor(x);
  bars.forEach((b,i)=>{const f=i<k?1:i===k?+(x-k).toFixed(3):0;if(b._f!==f){b._f=f;b.style.setProperty('--f',f)}});
  el.classList.toggle('playing',playing);el.classList.toggle('act',playing||pos>0);
  const du=el.querySelector('.du');if(du)du.textContent=playing||pos>0?vmFmt(pos):vmFmt(dur);
  const s=el.querySelector('.spd');if(s)s.textContent=vmSpeed();
}
function vmTick(){
  VS.play.forEach(el=>{
    if(!el.isConnected){VS.play.delete(el);return}
    el._pos+=.1*VS.speed;const dur=+el.dataset.vdur;
    if(el._pos>=dur){el._pos=0;VS.play.delete(el);vmPaint(el,0,false)}else vmPaint(el,el._pos,true)});
  if(!VS.play.size){clearInterval(VS.timer);VS.timer=0}
}
function vmPlay(el,from){
  VS.play.forEach(o=>{if(o!==el){VS.play.delete(o);vmPaint(o,0,false)}});
  if(from!=null)el._pos=from;el._pos=el._pos||0;VS.play.add(el);
  const u=el.querySelector('.ud');if(u){u.classList.add('gone');setTimeout(()=>u.remove(),300)}
  vmPaint(el,el._pos,true);if(!VS.timer)VS.timer=setInterval(vmTick,100);
}
function vmStopAll(){VS.play.forEach(o=>vmPaint(o,0,false));VS.play.clear();clearInterval(VS.timer);VS.timer=0;$$('.vm').forEach(el=>{el._pos=0;vmPaint(el,0,false)})}
document.addEventListener('click',e=>{
  const el=e.target.closest('.vm');if(!el)return;
  const pl=e.target.closest('.pl'),wv=e.target.closest('.wv'),sp=e.target.closest('.spd');if(!pl&&!wv&&!sp)return;
  e.stopPropagation();
  if(sp){VS.speed=VSP[(VSP.indexOf(VS.speed)+1)%VSP.length];$$('.vm .spd').forEach(b=>{b.textContent=vmSpeed()});return}
  if(wv){const r=wv.getBoundingClientRect(),f=Math.max(0,Math.min(.999,(e.clientX-r.left)/r.width));vmPlay(el,f*(+el.dataset.vdur||1));return}
  if(VS.play.has(el)){VS.play.delete(el);vmPaint(el,el._pos,false)}else vmPlay(el,null);
},true);
RESETS.push(()=>{vmStopAll();VS.speed=1});

/* ───── скрытый текст: пыль и нажатие — тот же расчёт, что у Fmt (shared/fmt.js) ───── */
const SPS=new Set(),SPopen=new Set();let spRaf=0,spLast=0;
const spReduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
function spKey(sp){const m=sp.closest('[data-msg-id]');if(!m)return null;return m.dataset.msgId+':'+[...m.querySelectorAll('.spl')].indexOf(sp)}
function spSoft(b,x,y){const hx=b.w/2+1,hy=b.h/2,r=Math.min(hx,hy),qx=Math.abs(x-b.w/2)-(hx-r),qy=Math.abs(y-b.h/2)-(hy-r);
  const d=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;if(d<=0)return 1;const f=1-d/8;return f>0?f*f:0}
function spSpawn(b,p,fresh){
  let g=0;do{p.x=-9+Math.random()*(b.w+18);p.y=-6+Math.random()*(b.h+12)}while(spSoft(b,p.x,p.y)<.3&&g++<40);
  if(p.slow===undefined)p.slow=Math.random()<.34;
  const s=p.slow?Math.random()*.05:1.5+Math.random()*3,a=Math.random()*6.283;
  p.vx=Math.cos(a)*s;p.vy=Math.sin(a)*s;p.life=p.slow?20+Math.random()*30:.2+Math.random()*.6;p.age=fresh?Math.random()*p.life:0;p.al=.55+Math.random()*.45;
}
function spInit(sp){
  sp.setAttribute('data-sp','1');
  const host=sp.closest('.irc-text')||sp.parentElement;if(!host)return;host.classList.add('spl-host');
  const cv=document.createElement('canvas');cv.className='spl-cv';host.appendChild(cv);
  const o={sp,host,cv,g:cv.getContext('2d'),boxes:[],W:0,H:0,k:1,col:'#888',n:0,key:spKey(sp)};
  o.place=()=>{
    const hr=host.getBoundingClientRect(),k=host.offsetWidth?hr.width/host.offsetWidth:1;o.k=k||1;o.W=host.offsetWidth;o.H=host.offsetHeight;
    const dpr=Math.min(2,window.devicePixelRatio||1);cv.width=o.W*dpr;cv.height=o.H*dpr;cv.style.width=o.W+'px';cv.style.height=o.H+'px';o.dpr=dpr;o.dirty=true;
    o.boxes=[...sp.getClientRects()].filter(r=>r.width>2).map(r=>{const b={x:(r.left-hr.left)/o.k,y:(r.top-hr.top)/o.k,w:r.width/o.k,h:r.height/o.k};
      b.p=Array.from({length:Math.max(24,Math.round(b.w*b.h/5.2))},()=>{const p={};spSpawn(b,p,true);return p});return b});
  };
  try{new ResizeObserver(o.place).observe(host)}catch(e){}
  o.place();
  if(o.key&&SPopen.has(o.key)){sp.classList.add('open');cv.style.opacity='0'}
  sp.addEventListener('click',()=>{const on=sp.classList.toggle('open');cv.style.opacity=on?'0':'';o.dirty=true;if(o.key){on?SPopen.add(o.key):SPopen.delete(o.key)}});
  SPS.add(o);if(!spRaf)spRaf=requestAnimationFrame(spLoop);
}
function spLoop(t){
  const dt=spLast?Math.max(0,Math.min(.05,(t-spLast)/1000)):0;spLast=t;
  for(const o of SPS){
    if(!o.sp.isConnected){SPS.delete(o);continue}
    if(o.sp.classList.contains('open')||document.hidden||!o.W)continue;
    if(spReduce&&!o.dirty)continue;o.dirty=false;
    if(!(++o.n%90))o.col=getComputedStyle(o.host).color;
    if(o.n===1)o.col=getComputedStyle(o.host).color;
    const g=o.g,d=o.dpr;g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,o.W,o.H);g.fillStyle=o.col;
    for(const b of o.boxes)for(const p of b.p){
      if(!spReduce){p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt}
      let f=spSoft(b,p.x,p.y);if(p.age>=p.life||f<.03){spSpawn(b,p,false);f=1}
      const ft=Math.min(.2,p.life*.2),e=Math.min(1,p.age/ft,(p.life-p.age)/ft);
      g.globalAlpha=p.al*f*(e>0?e:0);g.fillRect(Math.round((b.x+p.x)*d)/d,Math.round((b.y+p.y)*d)/d,1,1)}
    g.globalAlpha=1;
  }
  spRaf=SPS.size?requestAnimationFrame(spLoop):0;
}
{let q=0;const scan=()=>{q=0;$$('.spl:not([data-sp])').forEach(spInit)};
 new MutationObserver(()=>{if(!q)q=requestAnimationFrame(scan)}).observe(document.body,{childList:true,subtree:true});scan()}
RESETS.push(()=>{$$('.spl.open').forEach(s=>{s.classList.remove('open');const c=s.closest('.spl-host')?.querySelector('.spl-cv');if(c)c.style.opacity=''});SPopen.clear();SPS.forEach(o=>{o.dirty=true})});

/* ───── меню сообщения и чата: «Прочитано», «Разблокировать» (тексты и состав — как в клиенте) ───── */
const XB={cid:null};
{
  const _om=openMenu;
  openMenu=function(items,x,y,o){
    items=items.map(it=>{
      if(it&&it.fly&&/^Прочитано/.test(it.t||'')){
        const rows=[['dmitry','09:40'],['elena','09:47']];
        return {...it,t:'Прочитано <span class="cnt"><b>2</b>/3</span>',rd:1,fly:()=>`<div class="rdh">Прочитали 2 из 3</div>`+rows.map(([k,t])=>`<div class="rdr">${avHtml({...PPL[k],on:0},'xs')}<span>${PPL[k].n}</span><time>${t}</time></div>`).join('')};
      }
      if(it&&it.i==='ban'&&XB.cid){
        const c=CHATS.find(z=>z.id===XB.cid);
        if(c&&S.blocked.includes(c.peer))return {i:'unban',t:'Разблокировать',fn:()=>{S.blocked=S.blocked.filter(k=>k!==c.peer);renderCsNav();toast(c.n+' разблокирован')}};
      }
      return it});
    const m=_om(items,x,y,o);
    items.forEach((it,i)=>{if(it&&it.rd){const b=m.querySelector('button[data-k="'+i+'"]');if(b)b.classList.add('rd-part')}});
    return m;
  };
  const _cm=chatMenu;chatMenu=function(cid,x,y){XB.cid=cid;try{_cm(cid,x,y)}finally{XB.cid=null}};
}
const blk0=[...S.blocked];RESETS.push(()=>{S.blocked=[...blk0];renderCsNav()});

/* ───── пересылка: выбор чата → панель «Переслано от» над полем ввода (forward-bar) ───── */
let FWsrc=null;
document.addEventListener('contextmenu',e=>{const m=e.target.closest('.irc-msg');if(m)FWsrc=m.dataset.m},true);
{
  const _ss=slotSync;slotSync=function(){_ss();
    if(S.fwd){$('#slotin').insertAdjacentHTML('afterbegin',`<div class="replybar fwdbar">${I('fwd')}<div class="tx"><b>Переслано от ${esc(S.fwd.name)}</b><span>${esc(S.fwd.text)}</span></div><button class="ibtn" data-x="fwd" aria-label="Отменить пересылку">${I('x')}</button></div>`);
      $('#slot').classList.add('open');chatEl.classList.add('hasbar')}};
  const _sr=slotReset;slotReset=function(){S.fwd=null;_sr()};
}
$('#slotin').addEventListener('click',e=>{const b=e.target.closest('[data-x="fwd"]');if(b){S.fwd=null;slotSync()}});
function fwdSend(){
  if(!S.fwd)return false;
  const v=inp.value.trim(),f=S.fwd;S.fwd=null;addMsg({a:'me',t:esc(v),fwd:[f.name,f.text],tm:'сейчас'});inp.value='';upd();slotReset();return true;
}
send.addEventListener('click',e=>{if(fwdSend())e.stopImmediatePropagation()},true);
inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&fwdSend())e.stopImmediatePropagation()},true);
function fwdInfo(sid){
  const m=sid&&MSG[sid];
  if(!m)return{name:'Дмитрий Соколов',text:'Макеты профиля готовы, посмотрите вариант B'};
  return{name:m.a==='me'?'Мария Иванова':PPL[m.a].n,text:(m.text||'').slice(0,80)||(m.pic||m.file?'Вложение':'')};
}
async function fwdTo(cid,sid){
  await xChat(cid);S.fwd=fwdInfo(sid);slotSync();inp.focus();
}
modalForward=function(src){
  const sid=src||FWsrc||($$('#cv-team .irc-msg:not([data-mine])')[0]||{dataset:{}}).dataset.m;
  const bg=openModal('w380',`<div class="modal-hdr"><span class="grow">Переслать в...</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div><label class="fld nc-search" style="height:36px;margin-top:2px">${I('search')}<input id="fq" placeholder="Поиск..." aria-label="Поиск"></label><div class="nc-list" id="fl" style="max-height:340px;padding-bottom:14px"></div>`);
  const paint=()=>{const q=$('#fq',bg).value.toLowerCase(),ls=CHATS.filter(c=>c.k!=='room'&&c.n.toLowerCase().includes(q));
    $('#fl',bg).innerHTML=ls.length?'<div class="xlbl">Чаты</div>'+ls.map(c=>`<button class="pp-row" data-c="${c.id}">${avHtml(c,'sm')}<span class="pp-name">${c.n}</span></button>`).join(''):'<div class="emptylist">Нет результатов</div>'};
  paint();$('#fq',bg).oninput=paint;
  bg.addEventListener('click',e=>{const r=e.target.closest('[data-c]');if(r){closeModal(bg);fwdTo(r.dataset.c,sid)}});
};

/* ───── ссылка в сообщении: окно подтверждения (modal-link) ───── */
function openLinkUrl(url){
  const bg=openModal('w380 xlink',`<div class="xi">${I('alert')}</div><div class="xt">Внешняя ссылка</div><div class="xd">Эта страница может быть потенциально опасной. Вы уверены, что хотите её открыть?</div><div class="xu" id="link-modal-url">${esc(url)}</div>
    <div class="xf"><button class="btn" data-a="close">Отмена</button><button class="btn pri" data-a="open">${I('extlink')}Открыть</button></div>`);
  bg.addEventListener('click',e=>{if(e.target.closest('[data-a="open"]')){closeModal(bg);toast('Ссылка откроется в браузере')}});
  setTimeout(()=>{try{document.activeElement.blur()}catch(e){}},120);
  return bg;
}
document.addEventListener('click',e=>{const a=e.target.closest('.msg-link[data-url]');if(a){e.preventDefault();openLinkUrl(a.dataset.url.replace(/&amp;/g,'&'))}});

/* ───── просмотрщик фото и видео (lightbox) ───── */
const mkPic=(a,b,c,sun,seed)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="640" viewBox="0 0 1120 640"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".62" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="1120" height="640" fill="url(#g)"/><circle cx="${300+seed*140}" cy="${190+seed*20}" r="${70+seed*10}" fill="${sun}" opacity=".9"/><path d="M0 470 190 330 380 450 600 270 840 440 1010 340 1120 410V640H0Z" fill="#000" opacity=".22"/><path d="M0 540 250 430 470 530 720 400 1000 520 1120 470V640H0Z" fill="#000" opacity=".34"/></svg>`);
const LBP=[mkPic('#2ed3b7','#6a6cf0','#f0a020','#fff3c4',0),mkPic('#f6a35a','#d0566a','#5a2a6a','#ffe9d0',1),mkPic('#4b8df0','#2a55c4','#1b2a6a','#e8f0ff',2)];
const LBI=[
  {pic:0,type:'image',sender:'Елена Миронова',at:'сегодня, 09:27',caption:'Короткая демонстрация анимации:',mine:0},
  {pic:1,type:'image',sender:'Мария Иванова',at:'сегодня, 09:35',caption:'',mine:1},
  {pic:2,type:'video',sender:'Дмитрий Соколов',at:'вчера, 18:12',caption:'Запись экрана: как работает новое меню',mine:0,dur:34}];
function openLb(items,idx=0){
  $('.xlb')?.remove();
  const lb=document.createElement('div');lb.className='xo xlb';layer.appendChild(lb);
  let i=idx,sc=1,it;
  const paint=()=>{
    it=items[i];const n=items.length,vid=it.type==='video';
    lb.classList.toggle('lb-gallery',n>1);lb.classList.toggle('lb-video',vid);lb.classList.toggle('lb-meta',!!(it.sender||it.caption||n>1));
    lb.innerHTML=`<button class="lb-nav lb-prev" type="button" aria-label="Назад" style="visibility:${i>0?'visible':'hidden'}">${I('chevLeft')}</button><button class="lb-nav lb-next" type="button" aria-label="Дальше" style="visibility:${i<n-1?'visible':'hidden'}">${I('chevRight')}</button>
      <div class="lb-count">${i+1} из ${n}</div>
      <div class="lb-info"><b>${esc(it.sender||'')}</b><span>${esc(it.at||'')}</span></div>
      <div class="lb-stage"><img class="lb-img" alt="" src="${LBP[it.pic]}" style="transform:scale(${sc})">${vid?`<div class="lb-vid"><button class="lb-vp" type="button" aria-label="Воспроизвести">${I('play')}</button><div class="lb-vc"><button type="button" aria-label="Воспроизвести">${I('play')}</button><span>0:12</span><div class="lb-vt"><i style="width:36%"></i></div><span>${vmFmt(it.dur||34)}</span><button type="button" aria-label="Звук">${I('volume')}</button></div></div>`:''}</div>
      <div class="lb-zoom"><button type="button" data-z="-" title="Уменьшить" aria-label="Уменьшить">${I('zoomOut')}</button><button type="button" data-z="0" title="Сбросить масштаб" aria-label="Сбросить масштаб">${I('search')}</button><button type="button" data-z="+" title="Увеличить" aria-label="Увеличить">${I('zoomIn')}</button></div>
      <button class="lb-act" id="lb-close" type="button" title="Закрыть (Esc)" aria-label="Закрыть" style="right:24px">${I('x')}</button>
      <button class="lb-act" data-k="dl" type="button" title="Скачать" aria-label="Скачать" style="right:72px">${I('dl')}</button>
      <button class="lb-act" data-k="fwd" type="button" title="Переслать" aria-label="Переслать" style="right:120px">${I('fwd')}</button>
      ${it.mine?`<button class="lb-act" data-k="del" type="button" title="Удалить" aria-label="Удалить" style="right:168px">${I('trash')}</button>`:''}
      <div class="lb-bottom">${it.caption?`<div class="lb-cap">${esc(it.caption)}</div>`:''}${n>1?`<div class="lb-thumbs">${items.map((x,k)=>`<i class="${k===i?'on':''}" data-k="${k}" style="background-image:url('${LBP[x.pic]}')"></i>`).join('')}</div>`:''}</div>`;
  };
  const go=d=>{const k=i+d;if(k<0||k>=items.length)return;i=k;sc=1;paint()};
  const close=()=>{document.removeEventListener('keydown',key,true);lb.classList.add('out');setTimeout(()=>lb.remove(),160)};
  const key=e=>{if(!lb.isConnected)return document.removeEventListener('keydown',key,true);
    if(e.key==='ArrowLeft')go(-1);else if(e.key==='ArrowRight')go(1);else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}};
  document.addEventListener('keydown',key,true);
  lb.addEventListener('click',async e=>{
    const b=e.target.closest('button,i[data-k]');
    if(!b){if(e.target===lb||e.target.classList.contains('lb-stage'))close();return}
    if(b.classList.contains('lb-prev'))go(-1);else if(b.classList.contains('lb-next'))go(1);
    else if(b.id==='lb-close')close();
    else if(b.dataset.z){sc=b.dataset.z==='0'?1:Math.max(1,Math.min(4,sc+(b.dataset.z==='+'?.5:-.5)));$('.lb-img',lb).style.transform='scale('+sc+')'}
    else if(b.tagName==='I'){i=+b.dataset.k;sc=1;paint()}
    else if(b.dataset.k==='dl')toast('Скачивание: '+(it.type==='video'?'video.mp4':'image.jpg'));
    else if(b.dataset.k==='fwd'){close();modalForward(null)}
    else if(b.dataset.k==='del'){const ok=await confirmBox('Удалить сообщение? Оно исчезнет у всех участников.','Удалить');if(ok){items.splice(i,1);if(!items.length){close();return}i=Math.min(i,items.length-1);sc=1;paint();toast('Сообщение удалено')}}
  });
  paint();return lb;
}
/* нажатие на фото в переписке открывает просмотр (один кадр: у него есть автор, время и подпись) */
document.addEventListener('click',e=>{
  const im=e.target.closest('.bubble-image');if(!im)return;
  const msg=im.closest('.irc-msg'),m=msg&&MSG[msg.dataset.m];if(!m)return;
  openLb([{pic:0,type:'image',sender:PPL[m.a]?.n||'Мария Иванова',at:'сегодня, '+m.tm,caption:(m.text||'').trim(),mine:m.a==='me'}],0);
});

/* ═══ СЦЕНЫ ═══ */
addScene('xb-phone','Экран для телефона',async()=>{
  const o=xo('xph-bg',`<div class="xph"><i class="xph-isl"></i><div class="xph-card"><div class="lg-logo">${I('chat')}</div><h1 class="lg-word"><span>ELECTRON</span> <span>MESSENGER</span></h1>
    <p class="lg-sub" style="margin:6px 0 22px;line-height:1.5">Эта версия сделана для компьютера — на телефоне пользуйтесь мобильной версией.</p>
    <button class="lg-btn" type="button" style="width:100%">Перейти на мобильную версию</button></div></div><div class="xph-cap">Так /chat выглядит на экране телефона</div>`);
  o.addEventListener('click',e=>{if(e.target.closest('.lg-btn'))toast('Открывается мобильная версия /m/');else if(!e.target.closest('.xph'))o.remove()});
});

addScene('xb-boot','Загрузка',async()=>{
  loginShow('form');
  const o=xo('xboot',`<div class="bx"><i class="spin"></i><div class="bt" id="boot-text">Подключаюсь к серверу…</div><button class="bm" type="button">Войти вручную</button></div>`,$('#loginscr'));
  const t=setTimeout(()=>{const b=$('#boot-text');if(b)b.textContent='Сервер отвечает медленно, пробую ещё раз…'},3200);
  RESETS.push(function f(){clearTimeout(t);loginHide();const i=RESETS.indexOf(f);if(i>=0)RESETS.splice(i,1)});
  o.querySelector('.bm').onclick=()=>o.remove();
});

addScene('xb-notif','Уведомления',async()=>{
  const o=xo('xnotif',`${I('bell')}<span>Разрешите уведомления, чтобы получать сообщения в фоне</span><button class="xb" type="button" data-k="ok">Разрешить</button><button class="xb x" type="button" data-k="x" aria-label="Скрыть">${I('x')}</button>`);
  o.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;o.remove();if(b.dataset.k==='ok')toast('Уведомления разрешены')});
});

addScene('xb-drag','Перетаскивание файла',async()=>{
  await xChat('team');
  xo('xdrag',`<div class="xdc">${I('image')}<span>Отпустите для отправки</span></div>`);
});

addScene('xb-link','Внешняя ссылка',async()=>{
  await xChat('dev');
  const a=$('#cv-dev .msg-link');if(a)xScrollTo(a.closest('.irc-msg'),260);
  await sleep(250);openLinkUrl('https://docs.example.com/spec/integration?v=4&ref=chat');
});

addScene('xb-lightbox','Просмотрщик',async()=>{openLb(LBI.map(x=>({...x})),0)});

addScene('xb-forward','Пересылка',async()=>{
  await xChat('team');
  const m=$$('#cv-team .irc-msg:not([data-mine])')[0];FWsrc=m&&m.dataset.m;
  modalForward(FWsrc);
});
addScene('xb-fwdbar','Панель пересылки',async()=>{
  await xChat('team');const m=$$('#cv-team .irc-msg:not([data-mine])')[0];
  await fwdTo('marat',m&&m.dataset.m);
});

addScene('xb-banners','Баннеры',async()=>{
  const o=xo('xanns',['Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.','Сегодня до 18:00 принимаем заявки на отпуск: пишите Анне Лебедевой.'].map(t=>
    `<div class="xann">${I('bell')}<span class="xt">${t}</span><button class="xc" type="button" title="Скрыть" aria-label="Скрыть">${I('x')}</button></div>`).join(''));
  o.addEventListener('click',e=>{const b=e.target.closest('.xc');if(b)b.closest('.xann').remove()});
  const st=$('#tabs [data-tab="settings"]');
  if(st&&!$('#xupd')){st.insertAdjacentHTML('beforeend','<i class="upd xo" id="xupd" title="Доступно обновление"></i>')}
  RESETS.push(function f(){$('#xupd')?.remove();const i=RESETS.indexOf(f);if(i>=0)RESETS.splice(i,1)});
  await sleep(200);hmSet(true);
});

/* запись голосового: строка записи внутри поля, замок над кнопкой (shared/voice.js, voice.css) */
const VR={st:null,timer:0,t0:0,smp:[]};
function vrStop(){
  clearInterval(VR.timer);VR.timer=0;VR.st=null;
  const comp=$('#comp');['vr-rec','vr-hold','vr-lockd','vr-will'].forEach(c=>comp.classList.remove(c));
  comp.style.removeProperty('--vlvl');comp.style.removeProperty('--vlk');
  $$('.vr-bar,.vr-fx,.vr-lock,.vr-toast',comp).forEach(n=>n.remove());
  $('#send').classList.remove('vr-btn','ready');$('.field',comp)?.classList.remove('vr-field');$('.row1',comp)?.classList.remove('vr-row');$('#plus').classList.remove('vr-side');
  upd();
}
function vrDraw(){
  const cv=$('.vr-wave',$('#comp'));if(!cv||!cv.clientWidth)return;
  const w=cv.clientWidth,h=cv.clientHeight,dpr=2;if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr}
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  const bw=3,gap=3,n=Math.floor((w+gap)/(bw+gap)),vals=VR.smp.slice(-n);while(vals.length<n)vals.unshift(null);
  x.fillStyle=getComputedStyle(cv).color;const off=w-(n*(bw+gap)-gap);
  for(let i=0;i<n;i++){const v=vals[i];let bh,al;if(v==null){bh=3;al=.25}else{bh=Math.max(4,Math.min(1,v*1.15)*h*.95);al=1}
    x.globalAlpha=al;x.beginPath();x.roundRect(off+i*(bw+gap),(h-bh)/2,bw,bh,1.5);x.fill()}
  x.globalAlpha=1;
}
function vrStart(){
  vrStop();
  const comp=$('#comp'),field=$('.field',comp),btn=$('#send');
  field.classList.add('vr-field');$('.row1',field).classList.add('vr-row');$('#plus').classList.add('vr-side');btn.classList.add('vr-btn');
  field.insertAdjacentHTML('beforeend',`<div class="vr-bar"><button type="button" class="vr-trash" aria-label="Удалить запись">${I('trash')}</button><i class="vr-dot"></i><span class="vr-time">0:07</span><canvas class="vr-wave"></canvas><div class="vr-hint">${I('chevLeft')}<span>Влево — отмена</span></div></div><div class="vr-fx">${I('trash')}</div>`);
  comp.insertAdjacentHTML('beforeend',`<div class="vr-lock">${I('lock')}${I('chevUp','u')}</div><div class="vr-toast"></div>`);
  const lock=$('.vr-lock',comp),hr=rectIn(comp),br=rectIn(btn);
  lock.style.right=(hr.r-br.r+(br.r-br.l-44)/2)+'px';lock.style.bottom=(hr.b-br.t+20)+'px';
  const toast2=$('.vr-toast',comp);toast2.style.bottom=(hr.b-br.t+16)+'px';
  comp.classList.add('vr-rec','vr-hold');comp.style.setProperty('--vlk','.55');
  VR.st='hold';VR.t0=Date.now()-7000;VR.smp=Array.from({length:40},(_,i)=>.25+.6*Math.abs(Math.sin(i*.7))*Math.random());
  const time=$('.vr-time',comp);
  VR.timer=setInterval(()=>{
    const l=.25+Math.random()*.6;comp.style.setProperty('--vlvl',l.toFixed(2));VR.smp.push(l);if(VR.smp.length>200)VR.smp.shift();
    time.textContent=vmFmt((Date.now()-VR.t0)/1000);if(VR.st==='lock')vrDraw()},90);
}
function vrLock(){
  const comp=$('#comp');if(VR.st!=='hold')return;VR.st='lock';
  comp.classList.add('vr-lockd');comp.classList.remove('vr-hold');
  $('#send').classList.add('ready');$('#send').innerHTML=I('up');
  const t=$('.vr-toast',comp);t.textContent='Запись зафиксирована — можно отпустить';t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2300);
}
$('#comp').addEventListener('click',e=>{
  if(!VR.st)return;
  if(e.target.closest('.vr-lock')){vrLock();return}
  if(e.target.closest('.vr-trash')){const fx=$('.vr-fx');fx.classList.remove('go');void fx.offsetWidth;fx.classList.add('go');setTimeout(vrStop,550);return}
  if(e.target.closest('#send')&&VR.st==='lock'){e.stopImmediatePropagation();const d=Math.round((Date.now()-VR.t0)/1000);vrStop();addMsg({a:'me',voice:{dur:d,seed:Date.now()%17},tm:'сейчас'})}
},true);
addScene('xb-vrec','Запись голосового',async()=>{await xChat('dev');vrStart()});
RESETS.push(vrStop);

addScene('xb-voice','Голосовые в чате',async()=>{
  await xChat('dev');
  const v=$$('#cv-dev .vm');if(!v.length)return;
  xScrollTo(v[0].closest('.irc-msg'),300);
  await sleep(500);vmPlay(v[0],9.4);
});

addScene('xb-spoiler','Скрытый текст',async()=>{
  await xChat('team');
  const s=$('#cv-team .spl');if(!s)return;
  xScrollTo(s.closest('.irc-msg'),300);
  await sleep(1300);s.click();
});

addScene('xb-readby','Кто прочитал',async()=>{
  await xChat('team');
  const ms=$$('#cv-team .irc-msg[data-mine]:not(.emoji-msg)'),m=ms[ms.length-1]||$('#cv-team .irc-msg');
  const r=rectIn(m);msgMenu(m.dataset.m,r.l+(r.r-r.l)*.5,r.t+10);
  await sleep(350);
  const b=[...$$('.ctx-menu button')].find(x=>/Прочитано/.test(x.textContent));
  if(b)b.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
});

addScene('xb-blocked','Заблокированный',async()=>{
  await xChat('olga');
  const row=$('#list [data-id="olga"]');row.scrollIntoView({block:'center'});await sleep(120);
  const r=rectIn(row);chatMenu('olga',r.l+110,r.t+30);
});
