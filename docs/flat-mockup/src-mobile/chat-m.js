/* ---------- переписка: разметка и классы настоящего клиента /m (server/src/public/m/js/ui/chat.js, функция bubble) ---------- */
const nameColor=(key,tag)=>{const t=(tag||'').trim().toLowerCase();let n;if(!t)n=Math.max(0,Object.keys(PPL).indexOf(key))%5;else{let h=2166136261;for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619)>>>0}n=h%5}return 'rgb(var(--tag-'+(n+1)+'))'};
const PIC='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ed3b7"/><stop offset=".55" stop-color="#6a6cf0"/><stop offset="1" stop-color="#f0a020"/></linearGradient></defs><rect width="560" height="320" fill="url(#a)"/><circle cx="410" cy="90" r="46" fill="#fff" opacity=".55"/><path d="M0 250 Q140 170 280 240 T560 220 V320 H0Z" fill="#0b4f96" opacity=".35"/></svg>');
const WAVE=Array.from({length:48},(_,i)=>Math.round(6+16*Math.abs(Math.sin(i*.55))*(.55+.45*Math.sin(i*.17+1))));
const mentionFn=e=>e.replace(/@(Мария)(?![\wа-яёА-ЯЁ])/g,'<span class="mn">@$1</span>');
const fmtText=t=>Fmt.rich(t,{mentions:mentionFn,link:u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(u)+'</a>'});
function reactions(m,meta){if(!m.re||!m.re.length)return '';return '<div class="react">'+m.re.map(r=>{const[x,mine]=r.split('|'),[e,c]=x.split(' ');return `<button class="${mine?'mine':''}" data-c="react" data-e="${e}">${e} ${c||1}</button>`}).join('')+(meta||'')+'</div>'}
const fileCard=(ic,name,sub)=>`<div class="file" data-c="file"><span class="fi">${ic}</span><span><b>${esc(name)}</b>${sub?'<small>'+sub+'</small>':''}</span></div>`;
function compParts(ps,meta){if(!ps.length)return '<div class="txt ct">'+(meta||'')+'</div>';return ps.map((p,i)=>{const last=i===ps.length-1;return p.k==='c'?Fmt.codeBlock(p.v,last?(meta||true):false):'<div class="txt ct">'+fmtText(p.v)+(last?(meta||''):'')+'</div>'}).join('')}
/* m: {a,t,tm,q,re,big,pic,file,voice,gif,fwd,lp,ed,st}; pos: {first,last}; разметка — как в bubble() клиента */
function bubHtml(cid,m,pos,dm,id){MS[id]={...m,cid,id,text:m.t||m.big||'',pos,dm};
  const mine=m.a==='me',p=mine?null:PPL[m.a],groupish=!dm;
  if(m.sys)return `<div class="sys" data-mid="${id}"><span class="glass">${m.sys} · ${m.tm}</span></div>`;
  let who=(groupish&&!mine&&pos.first)?`<div class="who-n" style="color:${nameColor(m.a,p.tag)}" data-c="who">${esc(p.n)}</div>`:'';
  const eo=!!m.big;let h=`<div class="mg" data-mid="${id}">`;
  if(eo){h+=who;who=''}
  h+=`<div class="mrow ${mine?'out':'in'}${pos.first?' first':''}${pos.last?' last':''}" data-mid="${id}">`;
  if(eo)return h+`<span class="big" data-big>${m.big}</span><span class="swi">${I('reply')}</span></div>`+reactions(m)+'</div>';
  const bare=!m.t&&!m.q&&!m.fwd&&(m.gif!=null||m.pic);
  const tk=mine?(m.st==='sent'?'<span class="dv">'+I('check')+'</span>':I('checks')):'';
  const meta='<span class="t meta">'+(m.ed?'изм. ':'')+m.tm+tk+'</span>';
  const ps=m.t?Fmt.parts(m.t):[],code=ps.some(p=>p.k==='c'),comp=(m.lp||code)?{lp:m.lp,ps,code}:null;
  const inRx=!!(m.re&&m.re.length)&&!bare,metaT=inRx?'':meta;
  h+=`<div class="bub${bare?' media':''}${bare&&m.gif!=null?' gifm':''}${comp?' bcomp'+(!comp.lp&&comp.ps.length===1?' conly':''):''}">`+who;
  const qStart=h.length;
  if(m.q)h+=`<div class="quote" data-c="jump"><b>${esc(m.q[0])}</b><span>${esc(Fmt.noCode(m.q[1]||''))}</span></div>`;
  if(m.fwd)h+=`<div class="quote fwq"><b>Переслано от <em>${esc(m.fwd[0])}</em></b><span>${esc(m.fwd[1])}</span></div>`;
  if(comp){const qs=h.slice(qStart);h=h.slice(0,qStart)+(comp.lp?Fmt.previewCard(comp.lp,''):'')+(qs?'<div class="cpad">'+qs+'</div>':'')}
  if(m.pic)h+=`<img class="att-img" src="${PIC}" style="width:min(280px,calc(80vw - 24px));aspect-ratio:560/320;min-width:0;" alt="" data-c="lb" data-type="image">`;
  if(m.gif!=null)h+=`<div class="gif-msg" style="aspect-ratio:4 / 3;width:226px;background:conic-gradient(from ${m.gif}deg at 30% 110%,#2ed3b7,#6a6cf0,#f0a020,#2ed3b7)"><span class="gif-badge">GIF<span class="gp-kl"><i></i>KLIPY</span></span></div>`;
  if(m.file)h+=fileCard(I('file'),m.file[0],m.file[1]);
  if(m.voice&&!comp)h+=Voice.html({voice:{dur:m.voice,wave:WAVE}},'voice://'+id,{own:mine,small:true,bars:30,id:'',unread:false,meta:metaT});
  if(comp)h+=compParts(comp.ps,metaT);
  else if(m.t)h+='<div class="txt">'+fmtText(m.t)+(bare?'':metaT)+'</div>';
  else if(!bare&&!m.voice)h+='<div class="txt" style="min-height:4px">'+metaT+'</div>';
  if(inRx)h+=reactions(m,meta);
  if(bare)h+=meta;
  return h+'</div><span class="swi">'+I('reply')+'</span></div>'+(inRx?'':reactions(m))+'</div>'}
/* сообщения лежат в группах по дням: бейдж дня липнет к верху ленты (как в /m) */
function convoHtml(cid,dm){const L=CONVO[cid]||[];let h='<div class="chatreal"><div class="msgs">',open=false;
  L.forEach((m,i)=>{if(m.day){if(open)h+='</div>';h+=`<div class="day-group"><div class="day"><span class="glass">${m.day}</span></div>`;open=true}
    const pv=L[i-1],nx=L[i+1],first=!(pv&&pv.a===m.a&&!m.day&&!pv.sys&&!m.sys),last=!(nx&&nx.a===m.a&&!nx.day&&!nx.sys&&!m.sys);
    h+=bubHtml(cid,m,{first,last},dm,cid+'-'+(mseq++))});
  return h+(open?'</div>':'')+'</div></div>'}
const redraw=id=>{const mg=$(`.mg[data-mid="${id}"]`);if(!mg)return;const m=MS[id],t=document.createElement('div');t.innerHTML=bubHtml(m.cid,m,m.pos,m.dm,id);mg.replaceWith(t.firstElementChild)};
/* новое сообщение в конец ленты: предыдущее той же группы теряет хвостик */
function appendMsg(sc_,c,m){const grp=$$('.day-group',sc_).pop()||$('.msgs',sc_),last=[...grp.querySelectorAll('.mg')].pop(),lm=last&&MS[last.dataset.mid],same=!!lm&&lm.a===m.a;
  if(same){const r=$('.mrow',last);r&&r.classList.remove('last');lm.pos={...lm.pos,last:false}}
  const id=c.id+'-'+(mseq++),h=document.createElement('div');h.innerHTML=bubHtml(c.id,m,{first:!same,last:true},c.k==='dm',id);const mg=h.firstElementChild;grp.append(mg);return mg}
