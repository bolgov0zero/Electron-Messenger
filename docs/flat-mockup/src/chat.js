/* ---------- переписка: разметка и классы настоящего клиента (client/src/app.js, renderMsgIRC) ---------- */
const tagN=p=>(p.c.match(/tag-(\d+)/)||[0,1])[1];
const STAT=cls=>`<span class="msg-status ${cls}"><svg width="13" height="9" viewBox="0 0 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline class="tk1" points="1,5.5 3.5,8 9,1"/><polyline points="7,5.5 9.5,8 15,1"/></svg></span>`;
const PIC='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ed3b7"/><stop offset=".55" stop-color="#6a6cf0"/><stop offset="1" stop-color="#f0a020"/></linearGradient></defs><rect width="560" height="320" fill="url(#a)"/><circle cx="410" cy="90" r="46" fill="#fff" opacity=".55"/><path d="M0 250 Q140 170 280 240 T560 220 V320 H0Z" fill="#0b4f96" opacity=".35"/></svg>');
function reactHtml(re){return '<div class="reactions">'+re.map(r=>{const[x,mine]=r.split('|'),[e,c]=x.split(' ');return `<button class="reaction-btn${mine?' mine':''}" data-reaction="${e}"><span class="ra-emoji">${e}</span><span class="ra-count">${c||1}</span></button>`}).join('')+'</div>'}
function msgHtml(cid,m,prev,dm,next){
  const id=cid+'-'+(mseq++);MSG[id]={cid,...m,id};
  const plain=(m.t||m.big||'').replace(/<[^>]+>/g,'');MSG[id].text=plain;
  const mine=m.a==='me',p=mine?null:PPL[m.a];
  const first=prev!==(mine?'me':m.a),tail=next===undefined||next!==(mine?'me':m.a);
  const emoji=!!m.big;
  const status=mine?`<span class="status-wrap">${STAT('status-read')}</span>`:'<span class="status-wrap"></span>';
  const meta=`<div class="irc-meta">${status}<span class="irc-time">${m.tm}</span></div>`;
  const header=mine?'':`<div class="irc-header"><span class="irc-name msg-sender-name tag-${tagN(p)}">${p.n}</span>${p.tag?`<span class="role-pill tag-${tagN(p)}">${p.tag}</span>`:''}</div>`;
  let quote='';
  if(m.q){const qp=Object.values(PPL).find(x=>x.n===m.q[0]);quote=`<div class="irc-reply ${qp?'reply-tag-'+tagN(qp):'reply-mine'}"><div class="irc-reply-body"><div class="irc-reply-name">${m.q[0]}</div><div class="irc-reply-text">${m.q[1]}</div></div></div>`}
  let att='';
  if(m.pic)att=`<div class="bubble-image"><img src="${PIC}" alt=""></div>`;
  if(m.file)att=`<div class="bubble-file"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg><div class="bubble-file-info"><div class="bubble-file-name">${m.file[0]}</div><div class="bubble-file-size">${m.file[1]}</div></div><svg class="dl-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></div>`;
  const text=emoji?`<div class="irc-text emoji-only">${m.big}</div>`:`<div class="irc-text">${m.t}</div>`;
  const re=m.re?reactHtml(m.re):'';
  const avCol=mine?'':`<div class="irc-av av av-round av-tag-${tagN(p)}" style="position:relative;flex-shrink:0">${p.ini}</div>`;
  const cls='irc-msg'+(first?' irc-first':'')+(tail?' irc-tail':'')+(emoji?' emoji-msg':'');
  return `<div class="${cls}"${mine?' data-mine="1"':''}${dm?' data-dm="1"':''} data-m="${id}" data-msg-id="${id}"><div class="irc-content">${emoji?header:''}<div class="bubble-row">${avCol}<div class="msg-bubble${emoji?' bubble-emoji':''}">${emoji?'':header}${quote}${att}${text}${emoji?'':re}${meta}</div></div>${emoji?re:''}</div></div>`;
}
CONVO.team.unshift({sys:'add',t:'Дмитрий Соколов добавил(а) Елену Миронову',tm:'09:10'});
CONVO.team.splice(5,0,{sys:'ann',t:'Объявление: завтра в 22:00 обновление сервера',tm:'09:28'});
CONVO.team.splice(7,0,{unread:1});
{const i=CONVO.team.findIndex(m=>(m.t||'').startsWith('Беру в работу'));CONVO.team.splice(i+1,0,{a:'dmitry',t:'Сборку пришлю до обеда',tm:'09:24'},{a:'dmitry',t:'Если что — пишите',tm:'09:25'})}
{const i=CONVO.team.findIndex(m=>(m.t||'').startsWith('Согласна с вариантом'));CONVO.team.splice(i+1,0,{a:'me',t:'И сделаем то же для мобильного',tm:'09:22'})}
const SYS_IC={add:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',ann:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'};
function convoHtml(cid,dm){
  const L=CONVO[cid]||[],key=m=>m.a==='me'?'me':m.a;
  let h='<div class="chatreal"><div class="messages"><div class="date-divider"><span>Сегодня</span></div>';
  L.forEach((m,i)=>{
    if(m.sys){h+=`<div class="sysnote ${m.sys}"><svg viewBox="0 0 24 24">${SYS_IC[m.sys]}</svg><span>${m.t}</span><time>${m.tm}</time></div>`;return}
    if(m.unread){h+='<div class="date-divider unread-divider"><span>Непрочитанные сообщения</span></div>';return}
    const pv=L[i-1],nx=L[i+1],ok=x=>x&&!x.sys&&!x.unread;
    h+=msgHtml(cid,m,ok(pv)?key(pv):null,dm,ok(nx)?key(nx):(nx?null:undefined))});
  if(cid==='team')h+='<div class="typing-indicator mock-typing show"><span class="typing-pill"><span class="typing-dots"><span></span><span></span><span></span></span><span class="typing-text">Елена печатает…</span></span></div>';
  return h+'</div></div>';
}
