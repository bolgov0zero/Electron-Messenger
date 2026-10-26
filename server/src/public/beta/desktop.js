
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const root=document.documentElement,win=$('#win'),layer=$('#layer');
/* ---------- значки (Lucide, обводка 2) ---------- */
const IC={
search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
chevDown:'<path d="m6 9 6 6 6-6"/>',chevUp:'<path d="m18 15-6-6-6 6"/>',chevRight:'<path d="m9 18 6-6-6-6"/>',chevLeft:'<path d="m15 18-6-6 6-6"/>',
x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',dots:'<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
clip:'<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
pen:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
smile:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
up:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',down:'<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
check:'<path d="M20 6 9 17l-5-5"/>',checks:'<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
play:'<polygon points="6 3 20 12 6 21 6 3"/>',
users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
userPlus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
userMinus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/>',
ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',unban:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
bellOff:'<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
drop:'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
gear:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
palette:'<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
puzzle:'<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
trash:'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
pin:'<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
reply:'<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',fwd:'<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
copy:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
edit:'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
eye:'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
eyeOff:'<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
bolt:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
upd:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
grip:'<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
bold:'<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
italic:'<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
code:'<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
braces:'<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
key:'<path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
hash:'<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
grid:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
case:'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
send:'<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
star:'<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'
};
const I=(n,c='')=>`<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* подстановка значков в разметку-оболочку */
[['.ws[data-sp="all"] .ic','grid'],
 ['#hmore','chevDown'],['#newbtn','plus'],['#hm-theme','sun'],['#hm-ann','bell'],['#searchwrap .ic','search'],['#backbtn','chevLeft'],
 ['#tabs [data-tab="chats"]','chat'],['#tabs [data-tab="contacts"]','users'],['#tabs [data-tab="settings"]','gear'],
 ['#bsearch','search'],['#bmore','dots'],['#unpin','x'],['#sbar .ic','search'],['#sprev','chevUp'],['#snext','chevDown'],['#sclose','x'],['#jump','down'],
 ['#menu [data-m="file"]','clip'],['#menu [data-m="fmt"]','pen'],['#plus','plus'],['#embtn','smile'],['#send','mic'],['#eico','chat']
].forEach(([s,n])=>{const el=$(s);if(el)el.insertAdjacentHTML('afterbegin',I(n))});
$('#menu [data-m="file"]').insertAdjacentHTML('beforeend','Прикрепить файл');$('#menu [data-m="fmt"]').insertAdjacentHTML('beforeend','Форматирование');
/* ---------- утилиты ---------- */
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove('show'),2200)}
const scale=()=>win.getBoundingClientRect().width/1360;
function winXY(e){const r=win.getBoundingClientRect(),s=r.width/1360;return{x:(e.clientX-r.left)/s,y:(e.clientY-r.top)/s}}
function rectIn(el){const r=win.getBoundingClientRect(),b=el.getBoundingClientRect(),s=r.width/1360;return{l:(b.left-r.left)/s,t:(b.top-r.top)/s,r:(b.right-r.left)/s,b:(b.bottom-r.top)/s}}
function fit(){const f=win.parentElement,s=Math.min(f.clientWidth/1400,f.clientHeight/890,1.2);win.style.transform='scale('+s+')';win.style.left=(f.clientWidth-1360*s)/2+'px';win.style.top=(f.clientHeight-860*s)/2+'px'}
addEventListener('resize',fit);fit();
document.addEventListener('pointermove',e=>{const g=e.target.closest&&e.target.closest('.gi,.who.link');if(!g)return;const r=g.getBoundingClientRect(),k=r.width/g.offsetWidth||1;g.style.setProperty('--mx',(e.clientX-r.left)/k+'px');g.style.setProperty('--my',(e.clientY-r.top)/k+'px')});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* сегментированный переключатель с подвижным стеклом */
function segMove(seg){const b=$('button.on',seg),t=$('.thumb',seg);if(!b||!t)return;t.style.left=b.offsetLeft+'px';t.style.width=b.offsetWidth+'px'}
function segSet(seg,btn){$$('button',seg).forEach(x=>x.classList.toggle('on',x===btn));segMove(seg)}
/* ---------- тема, акцент ---------- */
function setTheme(t){root.classList.toggle('dark',t!=='light');root.classList.toggle('navy',t==='navy');S.theme=t;
  $$('#themeseg button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));segMove($('#themeseg'));
  const m=$('#hm-theme');if(m)m.innerHTML=I(t==='light'?'sun':'moon');applyAccent()}
const ACC={teal:['Бирюзовый',[29,168,140],[41,214,184]],blue:['Синий',[37,118,199],[96,170,245]],indigo:['Индиго',[92,96,205],[143,148,245]],plum:['Сливовый',[146,84,190],[196,146,240]],amber:['Янтарный',[186,120,38],[236,176,92]]};
function applyAccent(){const a=ACC[S.acc],c=root.classList.contains('dark')?a[2]:a[1];root.style.setProperty('--accent','rgb('+c+')');root.style.setProperty('--accent-rgb',c.join(','))}
/* ---------- данные ---------- */
const S={theme:'light',acc:'teal',chat:'team',topic:null,tab:'chats',filter:'all',folder:'all',sec:'profile',pinned:new Set(),muted:new Set(),
  contacts:new Set(['marat','olga','elena','dmitry']),blocked:['olga'],pin:null,reply:null,edit:null,
  set:{sound:true,text:true,quiet:false,auto:false,hide:false,spaces:true,amb:true,tr:50,pattern:'none',bg:'plain',fs:'medium',scale:100,mods:{gif:true,poll:false}}};
const PPL={
 dmitry:{n:'Дмитрий Соколов',bg:'#5a63c8,#2e3590',ini:'ДС',c:'var(--tag-1)',tag:'Dev',login:'dsokolov',on:1,ws:'Основное'},
 elena:{n:'Елена Миронова',bg:'#d0566a,#8a2a3c',ini:'ЕМ',c:'var(--tag-5)',tag:'Дизайн',login:'emironova',on:1,ws:'Основное'},
 akrylov:{n:'Алексей Крылов',bg:'#3b8fb8,#215a80',ini:'АК',c:'var(--tag-4)',tag:'Dev',login:'akrylov',st:'был(а) 12 минут назад',ws:'Основное'},
 anna:{n:'Анна Лебедева',bg:'#ff9a5a,#e8571f',ini:'АЛ',c:'var(--tag-3)',tag:'Лид',login:'alebedeva',on:1,ws:'Основное'},
 admin:{n:'Администратор',bg:'#8a8f9a,#4d525c',ini:'АД',c:'var(--tag-1)',tag:'Админ',login:'admin',on:1,ws:'Основное'},
 marat:{n:'Марат Хасанов',bg:'#34a1a0,#1f6f78',ini:'МХ',c:'var(--tag-4)',login:'mhasanov',on:1,ws:'Проект Север'},
 olga:{n:'Ольга Беляева',bg:'#7bc04a,#3f8a22',ini:'ОБ',c:'var(--tag-2)',login:'obelyaeva',st:'был(а) 12 минут назад',ws:'Основное'},
 petr:{n:'Пётр Сидоров',bg:'#8f6fe0,#5a3cb0',ini:'ПС',c:'var(--tag-1)',tag:'Dev',login:'psidorov',st:'был(а) вчера',ws:'Проект Север'}
};
const CHATS=[
 {id:'room',k:'room',n:'Вся компания',bg:'#ff9a5a,#e8571f',ico:'home',sq:1,p:'Анна: Созвон переносим на 11:30',t:'10:46',sub:'Комната · в сети 4 из 12',lbl:'Комнаты',f:'work'},
 {id:'sever',k:'group',n:'Проект Север: запуск',bg:'#19b394,#0b7e6c',ini:'ПС',p:'Приняли, готовим ячейки под новую',t:'10:31',u:5,sub:'в сети 3 из 12',lbl:'Все чаты',f:'work'},
 {id:'marat',k:'dm',n:'Марат Хасанов',bg:'#34a1a0,#1f6f78',ini:'МХ',on:1,p:'Вы: Марат, привет! Пришлёшь график',t:'10:21',tick:1,sub:'в сети',peer:'marat',f:'people'},
 {id:'dev',k:'group',n:'Разработка',bg:'#4b8df0,#2a55c4',ini:'Р',type:1,p:'Тогда закрываем задачу и берёмся',t:'10:09',u:2,sub:'в сети 5 из 9',f:'work'},
 {id:'rev',k:'group',n:'Дизайн-ревью',bg:'#b06af0,#6d3fc4',ini:'Д',type:1,p:'Вы: Принято, сегодня выкатим',t:'09:51',tick:1,u:1,sub:'в сети 2 из 6',f:'work'},
 {id:'team',k:'group',n:'Команда продукта',bg:'#19b394,#0b7e6c',ini:'КП',type:1,p:'Вы: 👍',t:'09:33',tick:1,sub:'в сети 1 из 4',f:'work'},
 {id:'olga',k:'dm',n:'Ольга Беляева',bg:'#7bc04a,#3f8a22',ini:'ОБ',p:'Мария, подпиши, пожалуйста, график',t:'08:50',u:1,sub:'был(а) 12 минут назад',peer:'olga',f:'people'},
 {id:'elena',k:'dm',n:'Елена Миронова',bg:'#d0566a,#8a2a3c',ini:'ЕМ',on:1,p:'🎉',t:'08:44',u:1,sub:'в сети',peer:'elena',f:'people'},
 {id:'dmitry',k:'dm',n:'Дмитрий Соколов',bg:'#5a63c8,#2e3590',ini:'ДС',on:1,p:'Так выглядит плашка «Подготовка»',t:'08:26',u:1,sub:'в сети',peer:'dmitry',f:'people'}
];
const TOPICS=[
 {id:'t-gen',n:'Общее',bg:'#19b394,#0b7e6c',who:'Анна',p:'Созвон переносим на 11:30',t:'10:46',u:2},
 {id:'t-ann',n:'Объявления',bg:'#ff9a5a,#e8571f',who:'Админ',p:'Завтра в 22:00 обновление сервера',t:'10:12',u:1,at:1},
 {id:'t-rel',n:'Релизы',bg:'#4b8df0,#2a55c4',who:'Дмитрий',p:'Версия 2.4 уже в продакшене',t:'09:40',u:1},
 {id:'t-faq',n:'Вопросы и ответы',bg:'#b06af0,#6d3fc4',who:'Вы',p:'Шаблоны лежат в разделе «Файлы»',t:'09:05'},
 {id:'t-fun',n:'Курилка',bg:'#7bc04a,#3f8a22',who:'Алексей',p:'🍕',t:'вчера'}
];
const FOLDERS=[{id:'work',n:'Работа',c:'#4b8df0',ic:'case'},{id:'people',n:'Люди',c:'#d0566a',ic:'users'}];
const MEMBERS={sever:['anna','petr','dmitry','marat'],dev:['akrylov','dmitry','petr'],rev:['elena','dmitry','anna'],team:['dmitry','elena','akrylov'],room:['anna','admin','dmitry','akrylov','marat','elena']};
/* ---------- переписки ---------- */
const CONVO={
 team:[{a:'dmitry',t:'Макеты профиля готовы, посмотрите вариант B',tm:'09:18'},
  {a:'me',q:['Дмитрий Соколов','Макеты профиля готовы, посмотрите вариант B'],t:'Согласна с вариантом B. Кнопки делаем капсулой, как во всём клиенте',tm:'09:21'},
  {a:'dmitry',t:'Беру в работу, к пятнице будет в релизе',tm:'09:24',re:['❤️ 1']},
  {a:'elena',pic:1,t:'Короткая демонстрация анимации:',tm:'09:27',re:['🔥 1']},
  {a:'akrylov',file:['Roadmap_Q4.pdf','184 КБ'],t:'Дорожная карта на четвёртый квартал',tm:'09:30'},
  {a:'me',big:'👍',tm:'09:33',re:['👍 2|mine','🔥 1']}],
 sever:[{a:'petr',t:'Ячейки под новую партию готовы?',tm:'10:20'},{a:'anna',t:'Приняли, готовим ячейки под новую',tm:'10:31'}],
 marat:[{a:'marat',t:'Привет! Пришлёшь график на неделю?',tm:'10:12'},{a:'me',t:'Марат, привет! Пришлёшь график на неделю?',tm:'10:21'}],
 dev:[{a:'akrylov',t:'Тогда закрываем задачу и берёмся за интеграцию',tm:'10:09',re:['👍 2']}],
 rev:[{a:'elena',t:'Правки по карточкам внесла, посмотрите',tm:'09:40'},{a:'me',t:'Принято, сегодня выкатим',tm:'09:51'}],
 olga:[{a:'olga',t:'Мария, подпиши, пожалуйста, график',tm:'08:50'}],
 elena:[{a:'elena',big:'🎉',tm:'08:44'}],
 dmitry:[{a:'dmitry',t:'Так выглядит плашка «Подготовка»',tm:'08:26'},{a:'dmitry',pic:1,t:'Вариант с акцентом по краю',tm:'08:27'}],
 't-gen':[{a:'anna',t:'Доброе утро, коллеги! Напоминаю: общий созвон сегодня в 11:00',tm:'10:41'},{a:'dmitry',t:'Буду, подключусь с телефона',tm:'10:43'},{a:'me',t:'Я тоже на связи',tm:'10:44'},{a:'anna',t:'Созвон переносим на 11:30',tm:'10:46',re:['👍 3']}],
 't-ann':[{a:'admin',t:'Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.',tm:'10:12'},{a:'admin',t:'<span class="mn">@Мария</span>, закройте открытые вложения заранее',tm:'10:12'}],
 't-rel':[{a:'dmitry',t:'Версия 2.4 уже в продакшене',tm:'09:40',re:['🎉 5']},{a:'dmitry',file:['Release_notes_2.4.pdf','96 КБ'],t:'Что изменилось',tm:'09:41'}],
 't-faq':[{a:'elena',t:'Где найти шаблоны писем?',tm:'09:03'},{a:'me',q:['Елена Миронова','Где найти шаблоны писем?'],t:'Шаблоны лежат в разделе «Файлы»',tm:'09:05'}],
 't-fun':[{a:'akrylov',t:'Кто за пиццу в пятницу?',tm:'вчера'},{a:'akrylov',big:'🍕',tm:'вчера',re:['🍕 4','❤️ 1']}]
};
const MSG={};let mseq=0;
const CHK=I('checks');
function reactHtml(re){return '<div class="react">'+re.map(r=>{const[x,m]=r.split('|');return `<button class="gi${m?' mine':''}">${x}</button>`}).join('')+'</div>'}
function msgHtml(cid,m,prev,dm){
  const id=cid+'-'+(mseq++);MSG[id]={cid,...m,id};let h='';
  const plain=(m.t||m.big||'').replace(/<[^>]+>/g,'');MSG[id].text=plain;
  if(m.a==='me'){
    const body=m.big?`<span class="big">${m.big}</span>`:`<div class="bub">${m.q?`<div class="quote"><b>${m.q[0]}</b><span>${m.q[1]}</span></div>`:''}${m.t}<span class="t">${m.tm}${CHK}</span></div>`;
    h+=`<div class="msg out" data-m="${id}">${body}</div>`;
  }else{
    const p=PPL[m.a];
    if(prev!==m.a&&!dm)h+=`<div class="who-n" style="color:${p.c.startsWith('var')?'rgb('+p.c+')':p.c};margin-top:${prev?10:0}px">${p.n}${p.tag?` <span class="pill-tag">${p.tag}</span>`:''}</div>`;
    const body=m.big?`<span class="big">${m.big}</span>`:`<div class="bub">${m.pic?'<div class="pic"></div>':''}${m.file?`<div class="file"><span class="fi">${I('file')}</span><span><b>${m.file[0]}</b><small>${m.file[1]}</small></span><button class="dl glass gi" aria-label="Скачать">${I('dl')}</button></div>`:''}${m.t}<span class="t">${m.tm}</span></div>`;
    h+=`<div class="msg in" data-m="${id}"><span class="av" style="background:linear-gradient(135deg,${p.bg})">${p.ini}</span>${body}</div>`;
  }
  if(m.re)h+=reactHtml(m.re);
  return h;
}
function convoHtml(cid,dm){let prev=null,h='<div class="day"><span class="glass">Сегодня</span></div>';
  (CONVO[cid]||[]).forEach(m=>{h+=msgHtml(cid,m,prev,dm);prev=m.a==='me'?null:m.a});
  if(cid==='team')h+='<div class="typing"><i></i><i></i><i></i>Елена печатает…</div>';return h}
function ensureConvo(cid,dm){let cv=$('#cv-'+cid);if(!cv){cv=document.createElement('div');cv.className='convo'+(dm?' dm':'');cv.id='cv-'+cid;cv.innerHTML=convoHtml(cid,dm);$('#scroll').append(cv)}return cv}
/* ---------- списки ---------- */
const list=$('#list'),topicsEl=$('#topics'),contactsEl=$('#contacts'),csnav=$('#csnav'),col=$('#col'),chatEl=$('#chat');
const fmtU=u=>u?`<span class="bd">${u}</span>`:'';
const avHtml=(o,cls='')=>`<span class="av ${cls}${o.sq?' sq':''}" style="background:linear-gradient(135deg,${o.bg})">${o.ico?I(o.ico):(o.ini||'')}${o.on?'<i class="dot"></i>':''}${o.type?`<i class="type">${I('case')}</i>`:''}</span>`;
function rowHtml(c){
  const pin=S.pinned.has(c.id)?`<span class="pinic">${I('pin')}</span>`:'',mu=S.muted.has(c.id)?`<span class="pinic">${I('bellOff')}</span>`:'';
  const meta=c.tick?`<span style="display:flex;align-items:center;gap:4px">${CHK}${c.t}</span>`:c.t;
  return `<button class="row${S.chat===c.id&&!S.topic&&S.tab==='chats'?' on':''}" data-id="${c.id}">${avHtml(c)}<span class="rt"><b><span class="nm">${c.n}</span>${pin}${mu}</b><span>${c.p}</span></span><span class="rm">${meta}<span class="badges">${fmtU(c.u)}</span></span></button>`;
}
function topicHtml(t){const tick=t.who==='Вы'?CHK:'';
  return `<button class="row${S.topic===t.id?' on':''}" data-id="${t.id}"><span class="av hash" style="background:linear-gradient(135deg,${t.bg})">#</span><span class="rt"><b><span class="nm">${t.n}</span></b><span><span class="who">${t.who}:</span> ${t.p}</span></span><span class="rm">${tick?`<span style="display:flex;align-items:center;gap:4px">${tick}${t.t}</span>`:t.t}<span class="badges">${t.at?'<span class="bd at">@</span>':''}${fmtU(t.u)}</span></span></button>`}
function roomUnread(){return TOPICS.reduce((s,t)=>s+(t.u||0),0)}
function keepSel(host,html){$$(':scope>:not(.sel)',host).forEach(n=>n.remove());host.insertAdjacentHTML('beforeend',html)}
function moveSel(host,row){const s=$('.sel',host);if(!s)return;if(!row){s.style.opacity=0;return}s.style.opacity=1;s.style.top=row.offsetTop+'px';s.style.height=row.offsetHeight+'px'}
function reSel(host){requestAnimationFrame(()=>moveSel(host,$('.row.on,.pp-row.on,.cs-sn.on',host)))}
function chatVisible(c){
  const q=$('#q').value.trim().toLowerCase();
  if(S.folder!=='all'&&c.f!==S.folder)return false;
  const active=S.chat===c.id&&S.tab==='chats';
  if(!(S.filter==='all'||active||(S.filter==='unread'&&(c.id==='room'?roomUnread():c.u))||(S.filter==='dm'&&c.k==='dm')||(S.filter==='group'&&c.k==='group')))return false;
  return !q||c.n.toLowerCase().includes(q);
}
function renderList(){
  const vis=CHATS.filter(chatVisible);
  const rooms=vis.filter(c=>c.k==='room'),pinned=vis.filter(c=>c.k!=='room'&&S.pinned.has(c.id)),rest=vis.filter(c=>c.k!=='room'&&!S.pinned.has(c.id));
  CHATS[0].u=roomUnread();
  let h='';
  if(rooms.length)h+=`<div class="lbl">Комнаты</div>`+rooms.map(rowHtml).join('');
  if(pinned.length)h+=`<div class="lbl">Закреплённые</div>`+pinned.map(rowHtml).join('');
  if(rest.length)h+=`<div class="lbl">${S.folder==='all'?'Все чаты':FOLDERS.find(f=>f.id===S.folder).n}</div>`+rest.map(rowHtml).join('');
  if(!vis.length)h+=`<div class="emptylist">${{unread:'Нет новых сообщений',dm:'Нет личных чатов',group:'Нет групп'}[S.filter]||'Ничего не найдено'}</div>`;
  keepSel(list,h);reSel(list);railFolders();
}
function renderTopics(){keepSel(topicsEl,`<div class="lbl"><span>Темы</span><span>${TOPICS.length}</span></div>`+TOPICS.map(topicHtml).join(''));reSel(topicsEl)}
function renderContacts(){
  const q=$('#q').value.trim().toLowerCase();
  const ks=[...S.contacts].filter(k=>!q||PPL[k].n.toLowerCase().includes(q));
  keepSel(contactsEl,`<div class="lbl"><span>Контакты</span><span>${ks.length}</span></div>`+(ks.map(k=>{const p=PPL[k];
    return `<button class="pp-row" data-k="${k}">${avHtml(p,'sm')}<span class="pp-name">${p.n}<span class="pp-sub">${p.on?'в сети':p.st}</span></span>${p.tag?`<span class="pill-tag" style="color:rgb(${p.c})">${p.tag}</span>`:''}</button>`}).join('')||'<div class="emptylist">Контактов нет</div>'));
}
const SECS=[
 ['profile','Профиль','user',()=>'Фото, имя и пароль',()=>'@admin'],
 ['general','Основные','gear',()=>'Звук и поведение приложения',()=>[S.set.sound?'звук включён':'без звука',S.set.auto?'автозапуск':''].filter(Boolean).join(' · ')],
 ['appearance','Внешний вид','palette',()=>'Тема, цвет, фон переписки и размер текста',()=>`${{light:'Светлая',dark:'Тёмная',navy:'Тёмно-синяя'}[S.theme]} · ${ACC[S.acc][0].toLowerCase()}`],
 ['blocks','Блокировки','ban',()=>'Люди, которые не могут вам писать',()=>S.blocked.length?`заблокировано: ${S.blocked.length}`:'никого нет'],
 ['modules','Модули','puzzle',()=>'Дополнительные возможности клиента',()=>{const n=Object.values(S.set.mods).filter(Boolean).length;return n?`включено: ${n}`:'2 модуля доступно'}],
 ['folders','Папки и пространства','folder',()=>'Папки чатов и пространства в баре',()=>`${FOLDERS.length} папки`],
 ['update','Обновление','upd',()=>'Версия приложения и новые релизы',()=>'есть версия 3.18.0']
];
function renderCsNav(){
  keepSel(csnav,SECS.map(([k,l,ic,d,m])=>`<button class="cs-sn${S.sec===k?' on':''}" data-k="${k}"><span class="cs-sn-ic">${I(ic)}</span><span class="cs-sn-tx"><b>${l}</b><small>${m()}</small></span>${k==='update'?'<i class="cs-dot"></i>':''}</button>`).join('')+'<div class="cs-copy">w/ <span style="color:var(--danger)">♥</span> by bolgov0zero</div>');reSel(csnav);
}
/* ---------- шапка, переключение чатов ---------- */
function setHead(o){
  const a=$('#hav');a.style.background=`linear-gradient(135deg,${o.bg})`;a.className='av lg'+(o.sq?' sq':'');a.innerHTML=o.ico?I(o.ico):(o.ini||'');
  $('#cn').textContent=o.n;const s=$('#cs');s.textContent=o.sub;s.classList.toggle('on',/^в сети/.test(o.sub));
  $('#who').classList.toggle('link',!!o.link);
}
function showConvo(id,dm){$$('.convo').forEach(c=>c.classList.remove('on'));ensureConvo(id,dm).classList.add('on');chatEl.classList.remove('empty','settings');
  S.cur=id;pinSync();searchClose(true);slotReset();requestAnimationFrame(()=>{$('#scroll').scrollTop=1e5;jumpSync()})}
function setEmpty(ico,t,s){$('#eico').innerHTML=I(ico);$('#et').textContent=t;$('#es').textContent=s;chatEl.classList.remove('settings');chatEl.classList.add('empty');$$('.convo').forEach(c=>c.classList.remove('on'));S.cur=null}
function openChat(id){
  const c=CHATS.find(x=>x.id===id);if(!c)return;
  if(c.k==='room'){enterRoom();return}
  S.chat=id;S.topic=null;if(c.u){c.u=0}
  setHead({...c,sub:c.sub,link:true});showConvo(id,c.k==='dm');renderList();
}
function enterRoom(){col.classList.add('room');S.chat='room';S.topic=null;$('#rtn').textContent='Вся компания';$('#rts').textContent=TOPICS.length+' тем';
  renderList();renderTopics();setEmpty('hash','Выберите тему','Комната «Вся компания» · '+TOPICS.length+' тем')}
function leaveRoom(){col.classList.remove('room');S.chat=null;S.topic=null;renderList();renderTopics();setEmpty('chat','Electron','Выберите чат или создайте новый')}
function openTopic(id){const t=TOPICS.find(x=>x.id===id);S.topic=id;if(t.u||t.at){t.u=0;t.at=0}
  setHead({n:t.n,bg:t.bg,ini:'#',sub:'# тема · в сети 4 из 12',link:false});showConvo(id,false);renderTopics();renderList()}
list.addEventListener('click',e=>{const r=e.target.closest('.row');if(r)openChat(r.dataset.id)});
topicsEl.addEventListener('click',e=>{const r=e.target.closest('.row');if(r)openTopic(r.dataset.id)});
contactsEl.addEventListener('click',e=>{const r=e.target.closest('.pp-row');if(r)openProfile(r.dataset.k)});
$('#backbtn').onclick=leaveRoom;
$('#who').onclick=()=>{const c=CHATS.find(x=>x.id===S.chat);if(!c||S.topic)return;if(c.k==='dm')openProfile(c.peer);else openGroup(c.id)};
/* ---------- вкладки, фильтр, поиск, бар ---------- */
function setTab(t){
  S.tab=t;$$('#tabs button').forEach(b=>{const on=b.dataset.tab===t;b.classList.toggle('on',on);b.classList.toggle('gi',on)});
  segMove($('#tabs'));   /* плашка трогается сразу, до перерисовки списков */
  list.classList.toggle('on',t==='chats');contactsEl.classList.toggle('on',t==='contacts');csnav.classList.toggle('on',t==='settings');
  $('#searchwrap').classList.toggle('hide',t==='settings');$('#filter').classList.toggle('hide',t!=='chats');
  $('#q').placeholder=t==='contacts'?'Поиск контактов...':'Поиск';$('#q').value='';
  const nb=$('#newbtn');nb.setAttribute('aria-label',t==='contacts'?'Добавить контакт':'Новый чат');nb.innerHTML=I(t==='contacts'?'userPlus':'plus');
  if(t!=='chats'&&col.classList.contains('room'))leaveRoom();
  if(t==='settings'){renderCsNav();openSection(S.sec)}
  else{chatEl.classList.remove('settings');if(S.cur)chatEl.classList.remove('empty');else if(!chatEl.classList.contains('empty'))setEmpty('chat','Electron','Выберите чат или создайте новый');
    t==='chats'?(renderList()):renderContacts()}
  requestAnimationFrame(()=>{segMove($('#filter'));segMove($('#tabs'))});
}
$$('#tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$$('#filter button').forEach(b=>b.onclick=()=>{S.filter=b.dataset.f;segSet($('#filter'),b);renderList()});
$('#q').addEventListener('input',()=>S.tab==='contacts'?renderContacts():renderList());
$$('#rail .ws[data-sp]').forEach(b=>b.onclick=()=>{$$('#rail .ws[data-sp]').forEach(x=>x.classList.toggle('on',x===b));toast('Пространство: '+b.title)});
/* папки в баре: значок перекрашен в цвет папки, цвет берётся из настройки папки */
let railSig='';
function railFolders(){
  const cnt=f=>CHATS.filter(c=>(f==='all'||c.f===f)&&(c.id==='room'?roomUnread():c.u)).length;
  const sig=JSON.stringify([FOLDERS,S.folder,cnt('all'),FOLDERS.map(f=>cnt(f.id))]);if(sig===railSig)return;railSig=sig;
  const b=(id,title,ic,c)=>{const n=cnt(id);return `<button class="ws${S.folder===id?' on':''}" data-fo="${id}" title="${esc(title)}" aria-label="${esc(title)}"${c?` style="--fc:${c}"`:''}><span class="ic">${I(ic)}</span>${n?`<em>${n}</em>`:''}</button>`};
  $('#railfo').innerHTML=b('all','Все чаты','chat')+FOLDERS.map(f=>b(f.id,f.n,f.ic,f.c)).join('');
}
$('#rail').addEventListener('click',e=>{const b=e.target.closest('.ws[data-fo]');if(!b)return;S.folder=b.dataset.fo;if(S.tab!=='chats')setTab('chats');railSig='';railFolders();renderList()});
$('#meBtn').onclick=()=>{setTab('settings');openSection('profile')};
$('#newbtn').onclick=()=>S.tab==='contacts'?modalAddContact():modalNewChat();
/* ---------- композер ---------- */
const inp=$('#inp'),send=$('#send');
function upd(){const r=!!inp.value.trim();send.classList.toggle('ready',r);send.innerHTML=I(r?'up':'mic');mentionSync()}
inp.addEventListener('input',upd);
function addMsg(m){const cv=$('#cv-'+S.cur);if(!cv)return;const prev=null;const tmp=document.createElement('div');tmp.innerHTML=msgHtml(S.cur,m,prev,cv.classList.contains('dm'));
  const ty=$('.typing',cv);[...tmp.children].forEach(n=>ty?ty.before(n):cv.append(n));requestAnimationFrame(()=>$('#scroll').scrollTo({top:1e5,behavior:'smooth'}))}
function go(){
  const v=inp.value.trim();if(!v||!S.cur)return;
  if(S.edit){const el=$(`[data-m="${S.edit}"] .bub`);if(el){const t=el.querySelector('.t');el.firstChild.nodeType===3?el.firstChild.textContent=v:null;MSG[S.edit].text=v;toast('Сообщение изменено')}S.edit=null;slotReset();inp.value='';upd();return}
  const m={a:'me',t:esc(v),tm:'сейчас'};if(S.reply){const r=MSG[S.reply];m.q=[r.a==='me'?'Вы':PPL[r.a].n,r.text.slice(0,80)]}
  addMsg(m);S.reply=null;slotReset();inp.value='';upd();
}
send.onclick=go;inp.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
const menu=$('#menu'),plus=$('#plus');
function menuSet(o){menu.classList.toggle('show',o);plus.setAttribute('aria-expanded',o)}
plus.onclick=e=>{e.stopPropagation();epSet(false);menuSet(!menu.classList.contains('show'))};
menu.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;menuSet(false);if(b.dataset.m==='file')toast('Выберите файл на компьютере');else{S.fmt=!S.fmt;slotSync()}});
document.addEventListener('click',e=>{if(!e.target.closest('#menu,#plus'))menuSet(false);if(!e.target.closest('#ep,#embtn'))epSet(false);if(!e.target.closest('#headmenu,#hmore'))hmSet(false);if(!e.target.closest('.ctx-menu,.fly,.rpick'))closeMenus()});
/* выдвижная часть: ответ, правка, панель форматирования */
function slotSync(){
  const box=$('#slotin');let h='';
  if(S.reply){const r=MSG[S.reply];h+=`<div class="replybar">${I('reply')}<div class="tx"><b>${r.a==='me'?'Вы':PPL[r.a].n}</b><span>${esc(r.text)}</span></div><button class="ibtn" data-x="reply" aria-label="Отменить ответ">${I('x')}</button></div>`}
  if(S.edit){h+=`<div class="replybar">${I('edit')}<div class="tx"><b>Редактирование</b><span>${esc(MSG[S.edit].text)}</span></div><button class="ibtn" data-x="edit" aria-label="Отменить правку">${I('x')}</button></div>`}
  if(S.fmt)h+=`<div class="fmtbar">${[['bold','Жирный'],['italic','Курсив'],['code','Код'],['braces','Блок кода'],['key','Скрытый текст'],['eye','Предпросмотр']].map(([n,t])=>`<button data-f="${n}" title="${t}" aria-label="${t}">${I(n)}</button>`).join('')}<span class="vs"></span><button data-x="fmt" aria-label="Закрыть">${I('x')}</button></div>`;
  box.innerHTML=h;$('#slot').classList.toggle('open',!!h);chatEl.classList.toggle('hasbar',!!h);
}
$('#slotin').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.x==='reply')S.reply=null;else if(b.dataset.x==='edit'){S.edit=null;inp.value='';upd()}else if(b.dataset.x==='fmt')S.fmt=false;else if(b.dataset.f)return b.classList.toggle('on');slotSync()});
function slotReset(){S.reply=null;S.edit=null;S.fmt=false;slotSync()}
/* панель смайлов */
const EMO=['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','😜','🤪','🤗','🤔','😐','😴','😎','🥳','😢','😭','😡','👍','👎','👏','🙏','💪','🔥','🎉','❤️','✨'];
$('#ep').innerHTML=`<label class="fld">${I('search')}<input placeholder="Поиск смайла" aria-label="Поиск смайла"></label>
 <div class="ep-tabs">${['🕘','😀','👍','🐶','🍕','✈️','⚽','💡','❤️','🏁'].map((e,i)=>`<button class="${i?'':'on'}">${e}</button>`).join('')}</div>
 <div class="ep-head">Часто используемые</div><div class="ep-grid">${EMO.slice(0,8).map(e=>`<button>${e}</button>`).join('')}</div>
 <div class="ep-head">Смайлы</div><div class="ep-grid">${EMO.map(e=>`<button>${e}</button>`).join('')}</div>
 <div class="sw"><div class="seg" id="epseg" style="height:30px"><span class="thumb"></span><button class="on" style="padding:0 12px">Эмодзи</button><button style="padding:0 12px">GIF</button></div><small>Powered by KLIPY</small></div>`;
function epSet(o){$('#ep').classList.toggle('show',o);$('#embtn').classList.toggle('on',o);if(o)requestAnimationFrame(()=>segMove($('#epseg')))}
$('#embtn').onclick=e=>{e.stopPropagation();menuSet(false);epSet(!$('#ep').classList.contains('show'))};
$('#ep').addEventListener('click',e=>{const b=e.target.closest('.ep-grid button');if(b){inp.value+=b.textContent;upd();inp.focus()}const t=e.target.closest('.ep-tabs button');if(t)$$('.ep-tabs button').forEach(x=>x.classList.toggle('on',x===t));
  const s=e.target.closest('#epseg button');if(s){segSet($('#epseg'),s);if(s.textContent==='GIF')toast('GIF — модуль Klipy')}});
/* упоминания */
function mentionSync(){
  const m=/@([\wа-яё]*)$/i.exec(inp.value),el=$('#mention');
  if(!m||!S.cur){el.classList.remove('show');return}
  const ids=(MEMBERS[S.cur]||Object.keys(PPL)).filter(k=>PPL[k].n.toLowerCase().includes(m[1].toLowerCase())||PPL[k].login.includes(m[1].toLowerCase()));
  if(!ids.length){el.classList.remove('show');return}
  el.innerHTML=ids.map((k,i)=>`<button data-k="${k}" class="${i?'':'mn-active'}">${avHtml(PPL[k],'xs')}<span>${PPL[k].n}<small>@${PPL[k].login}</small></span></button>`).join('');el.classList.add('show');
}
$('#mention').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;inp.value=inp.value.replace(/@([\wа-яё]*)$/i,'@'+PPL[b.dataset.k].login+' ');$('#mention').classList.remove('show');upd();inp.focus()});
/* закреп, поиск по чату, «вниз» */
function pinSync(){const p=S.pin&&S.pin[S.cur];$('#pintxt').textContent=p?MSG[p].text:'';$('#pinbar').classList.toggle('on',!!p&&!$('#sbar').classList.contains('on'));chatEl.classList.toggle('haspin',!!p)}
$('#unpin').onclick=e=>{e.stopPropagation();S.pin[S.cur]=null;pinSync();toast('Сообщение откреплено')};
$('#pinbar').onclick=()=>{const p=S.pin&&S.pin[S.cur];if(p)jumpTo(p)};
function jumpTo(id){const el=$(`[data-m="${id}"]`);if(!el)return;el.scrollIntoView({block:'center',behavior:'smooth'});el.classList.add('hl');setTimeout(()=>el.classList.remove('hl'),1900)}
let sres=[],sidx=-1;
function searchOpen(){$('#sbar').classList.add('on');chatEl.classList.add('hassearch');$('#pinbar').classList.remove('on');$('#bsearch').classList.add('on');$('#sq').focus()}
function searchClose(quiet){$('#sbar').classList.remove('on');chatEl.classList.remove('hassearch');$('#bsearch').classList.remove('on');$('#sq').value='';sres=[];sidx=-1;$('#scount').textContent='';if(!quiet)pinSync()}
function searchRun(){const q=$('#sq').value.trim().toLowerCase();sres=q?$$(`#cv-${S.cur} .msg`).filter(m=>(MSG[m.dataset.m]?.text||'').toLowerCase().includes(q)):[];sidx=sres.length?sres.length-1:-1;
  $('#scount').textContent=q?(sres.length?`${sidx+1} из ${sres.length}`:'Нет совпадений'):'';if(sidx>=0)jumpTo(sres[sidx].dataset.m)}
function searchStep(d){if(!sres.length)return;sidx=(sidx+d+sres.length)%sres.length;$('#scount').textContent=`${sidx+1} из ${sres.length}`;jumpTo(sres[sidx].dataset.m)}
$('#bsearch').onclick=()=>$('#sbar').classList.contains('on')?searchClose():searchOpen();
$('#sq').addEventListener('input',searchRun);$('#sprev').onclick=()=>searchStep(1);$('#snext').onclick=()=>searchStep(-1);$('#sclose').onclick=()=>searchClose();
function jumpSync(){const s=$('#scroll'),far=s.scrollHeight-s.scrollTop-s.clientHeight>240;chatEl.classList.toggle('nojump',!far)}
$('#scroll').addEventListener('scroll',jumpSync);$('#jump').onclick=()=>$('#scroll').scrollTo({top:1e5,behavior:'smooth'});
/* меню шапки сайдбара */
function hmPlace(){const m=$('#headmenu'),b=$('#hmore').getBoundingClientRect(),c=col.getBoundingClientRect(),k=scale();
  m.style.right='auto';m.style.left=((b.left-c.left)/k+b.width/k/2-m.offsetWidth/2)+'px';m.style.top=((b.bottom-c.top)/k+6)+'px';m.style.transformOrigin='top center'}
function hmSet(o){if(o)hmPlace();$('#headmenu').classList.toggle('open',o);$('#hmore').setAttribute('aria-expanded',o);$('#hmore').classList.toggle('on',o)}
$('#hmore').onclick=e=>{e.stopPropagation();hmSet(!$('#headmenu').classList.contains('open'))};
$('#hm-theme').onclick=()=>{setTheme(S.theme==='light'?'dark':S.theme==='dark'?'navy':'light');hmSet(false)};
$('#hm-ann').onclick=()=>{hmSet(false);toast('Окно «Объявление» — отдельный макет')};
/* ---------- контекстные меню ---------- */
function closeMenus(){$$('.ctx-menu,.fly,.rpick',layer).forEach(m=>{m.classList.remove('open');setTimeout(()=>m.remove(),320)})}
const REACTS=['👍','❤️','😂','🤔','🔥','🎉','😢'];
function itemHtml(it,k){
  if(it.sep)return '<hr class="sep">';
  if(it.cap)return `<div class="cap2">${it.cap}</div>`;
  if(it.react)return `<div class="ctx-react">${REACTS.map(r=>`<button data-r="${r}" class="${it.mine&&it.mine.includes(r)?'mine':''}" aria-label="Реакция ${r}">${r}</button>`).join('')}<button class="more" data-r="more" aria-label="Все реакции">→</button></div>`;
  return `<button data-k="${k}" class="${it.danger?'danger':''}">${I(it.i)}<span>${it.t}</span>${it.sub||it.fly?I('chevRight','chev'):''}${it.ck?I('check','ck'):''}</button>`;
}
function placeAt(el,x,y){const w=el.offsetWidth,h=el.offsetHeight;let px=Math.max(12,Math.min(x,1360-w-12)),py=y;if(py+h>860-12)py=Math.max(12,y-h);
  el.style.left=px+'px';el.style.top=py+'px';el.style.setProperty('--ox',(py<y?'bottom ':'top ')+(px<x?'right':'left'))}
function openMenu(items,x,y,opts={}){
  closeMenus();
  const m=document.createElement('div');m.className='ctx-menu glass-pop';m.setAttribute('role','menu');
  m.innerHTML=items.map(itemHtml).join('');layer.append(m);placeAt(m,x,y);
  requestAnimationFrame(()=>m.classList.add('open'));
  let fly=null,ft=0;
  const killFly=()=>{if(fly){const f=fly;f.classList.remove('open');setTimeout(()=>f.remove(),300);fly=null}$$('button.open',m).forEach(b=>b.classList.remove('open'))};
  const showFly=(b,it)=>{killFly();b.classList.add('open');const f=document.createElement('div');f.className='fly glass-pop';
    f.innerHTML=it.fly?it.fly():it.sub.map((s,j)=>`<button data-j="${j}">${s.c?`<span class="fm" style="--c:${s.c}">${I(s.ic)}</span>`:(s.ic?I(s.ic):'')}<span>${s.t}</span>${s.ck?I('check','ck'):''}</button>`).join('');
    layer.append(f);const br=rectIn(b),mr=rectIn(m);let fx=mr.r+4;if(fx+f.offsetWidth>1348)fx=mr.l-f.offsetWidth-4;f.style.left=fx+'px';f.style.top=Math.min(br.t-6,860-f.offsetHeight-12)+'px';
    requestAnimationFrame(()=>f.classList.add('open'));fly=f;
    f.addEventListener('click',e=>{const sb=e.target.closest('button[data-j]');if(!sb||!it.sub)return;closeMenus();it.sub[+sb.dataset.j].fn?.()});};
  m.addEventListener('click',e=>{
    const r=e.target.closest('[data-r]');if(r){if(r.dataset.r==='more'){const rr=rectIn(r);closeMenus();return reactPicker(rr.l,rr.b+6,opts.onReact)}closeMenus();opts.onReact?.(r.dataset.r);return}
    const b=e.target.closest('button[data-k]');if(!b)return;const it=items[+b.dataset.k];
    if(it.sub||it.fly){showFly(b,it);return}closeMenus();it.fn?.()});
  m.addEventListener('mouseover',e=>{const b=e.target.closest('button[data-k]');if(!b)return;const it=items[+b.dataset.k];clearTimeout(ft);
    if(it.sub||it.fly)ft=setTimeout(()=>showFly(b,it),140);else ft=setTimeout(killFly,160)});
  return m;
}
function reactPicker(x,y,onReact){
  closeMenus();const p=document.createElement('div');p.className='rpick ctx-menu glass-pop';p.style.minWidth='0';p.style.width='260px';
  const E=['👍','👎','❤️','😂','😮','😢','🙏','🔥','🎉','👏','🤔','😍','😎','🥳','💯','✅','🚀','👀','💡','🙌','😅','🤝'];
  p.innerHTML=`<div class="fld" style="height:30px;padding:0 12px;font-size:12px;margin:2px 2px 6px">${I('search')}<input placeholder="Поиск реакции" aria-label="Поиск реакции"></div><div class="ep-grid" style="grid-template-columns:repeat(7,1fr)">${E.map(e=>`<button>${e}</button>`).join('')}</div>`;
  layer.append(p);placeAt(p,x,y);requestAnimationFrame(()=>p.classList.add('open'));
  p.addEventListener('click',e=>{const b=e.target.closest('.ep-grid button');if(b){closeMenus();onReact?.(b.textContent)}});
}
function msgMenu(id,x,y){
  const m=MSG[id],mine=m.a==='me',pinned=S.pin&&S.pin[S.cur]===id,mem=(MEMBERS[S.cur]||[]).length;
  const reactMine=(()=>{const rb=$(`[data-m="${id}"]`)?.nextElementSibling;return rb&&rb.classList.contains('react')?[...rb.querySelectorAll('.mine')].map(b=>b.textContent.trim().split(' ')[0]):[]})();
  const items=[{react:true,mine:reactMine},
   {i:'reply',t:'Ответить',fn:()=>{S.reply=id;S.edit=null;slotSync();inp.focus()}},
   {i:'fwd',t:'Переслать',fn:()=>modalForward()},
   {i:'copy',t:'Скопировать',fn:()=>{navigator.clipboard?.writeText(m.text).catch(()=>{});toast('Скопировано')}},{sep:1},
   {i:'pin',t:pinned?'Открепить':'Закрепить',fn:()=>{S.pin=S.pin||{};S.pin[S.cur]=pinned?null:id;pinSync();toast(pinned?'Сообщение откреплено':'Сообщение закреплено')}}];
  if(mine&&!m.big)items.push({i:'edit',t:'Изменить',fn:()=>{S.edit=id;S.reply=null;slotSync();inp.value=m.text;upd();inp.focus()}});
  if(mine&&mem>1)items.push({i:'checks',t:'Прочитано 2/3',fly:()=>`<div class="rdh">Прочитали</div>`+['dmitry','elena'].map((k,i)=>`<div class="rdr">${avHtml(PPL[k],'xs')}<span>${PPL[k].n}</span><time>${i?'09:47':'09:40'}</time></div>`).join('')});
  items.push({sep:1},{i:'trash',t:'Удалить',danger:1,fn:async()=>{if(await confirmBox('Удалить сообщение? Это действие нельзя отменить.','Удалить')){const el=$(`[data-m="${id}"]`);const r=el?.nextElementSibling;el?.remove();if(r&&r.classList.contains('react'))r.remove();toast('Сообщение удалено')}}},
   {cap:(m.tm==='сейчас'?'Сегодня':'Вчера')+', '+(m.tm==='сейчас'?'12:04':'23:30')});
  openMenu(items,x,y,{onReact:r=>addReaction(id,r)});
}
function addReaction(id,r){const msg=$(`[data-m="${id}"]`);if(!msg)return;let rb=msg.nextElementSibling;if(!rb||!rb.classList.contains('react')){rb=document.createElement('div');rb.className='react';msg.after(rb)}
  const ex=[...rb.children].find(b=>b.textContent.trim().startsWith(r));if(ex){const n=+ex.textContent.trim().split(' ')[1]||1;ex.classList.contains('mine')?(n>1?ex.textContent=r+' '+(n-1):ex.remove(),ex.classList.remove('mine')):(ex.textContent=r+' '+(n+1),ex.classList.add('mine'))}
  else rb.insertAdjacentHTML('beforeend',`<button class="gi mine">${r} 1</button>`);if(!rb.children.length)rb.remove()}
function chatMenu(cid,x,y){
  const c=CHATS.find(z=>z.id===cid),pinned=S.pinned.has(cid),muted=S.muted.has(cid);
  const items=[{i:'pin',t:pinned?'Открепить':'Закрепить',fn:()=>{pinned?S.pinned.delete(cid):S.pinned.add(cid);renderList()}},
   {i:'folder',t:'В папку',sub:[...FOLDERS.map(f=>({t:f.n,c:f.c,ic:f.ic,ck:c.f===f.id,fn:()=>{c.f=f.id;renderList();toast('Чат перенесён в папку «'+f.n+'»')}})),{t:'Новая папка…',ic:'plus',fn:()=>modalFolder()}]}];
  items.push(muted?{i:'bell',t:'Включить уведомления',fn:()=>{S.muted.delete(cid);renderList();toast('Уведомления включены')}}
    :{i:'bellOff',t:'Уведомления',sub:[['На 1 час'],['На 8 часов'],['На сутки'],['Навсегда']].map(([t])=>({t,ic:'bellOff',fn:()=>{S.muted.add(cid);renderList();toast('Уведомления отключены: '+t.toLowerCase())}}))});
  if(c.k==='dm')items.push({i:'ban',t:'Заблокировать',fn:async()=>{if(await confirmBox('Заблокировать '+c.n+'? Он не сможет писать вам в личные сообщения.','Заблокировать')){S.blocked.push(c.peer);toast('Заблокировано: '+c.n)}}});
  items.push({sep:1},c.k==='dm'?{i:'trash',t:'Удалить чат',danger:1,fn:()=>delChat(cid,'Удалить чат с '+c.n+'? Переписка исчезнет только у вас.','Удалить')}
    :{i:'logout',t:'Выйти из группы',danger:1,fn:()=>delChat(cid,'Выйти из группы «'+c.n+'»?','Выйти')});
  openMenu(items,x,y);
}
async function delChat(cid,text,ok){if(!await confirmBox(text,ok))return;const i=CHATS.findIndex(c=>c.id===cid);if(i<0)return;CHATS.splice(i,1);if(S.chat===cid){S.chat=null;setEmpty('chat','Electron','Выберите чат или создайте новый')}renderList();toast('Готово')}
function contactMenu(k,x,y){openMenu([{i:'user',t:'Профиль',fn:()=>openProfile(k)},{i:'userMinus',t:'Удалить из контактов',danger:1,fn:async()=>{if(await confirmBox('Удалить '+PPL[k].n+' из контактов?','Удалить')){S.contacts.delete(k);renderContacts();toast('Удалено из контактов')}}}],x,y)}
function folderMenu(fid,x,y){const f=FOLDERS.find(z=>z.id===fid);openMenu([{i:'pen',t:'Изменить папку',fn:()=>modalFolder(f)},{i:'edit',t:'Переименовать',fn:()=>modalFolder(f,true)},{sep:1},{i:'trash',t:'Удалить папку',danger:1,fn:()=>delFolder(fid)}],x,y)}
async function delFolder(fid){const f=FOLDERS.find(z=>z.id===fid);if(!await confirmBox(`Удалить папку «${f.n}»? Чаты из неё не удаляются, они останутся в списке.`,'Удалить'))return;FOLDERS.splice(FOLDERS.indexOf(f),1);if(S.folder===fid){S.folder='all';renderList()}railFolders();if(S.sec==='folders')openSection('folders');toast('Папка удалена')}
function chatActions(x,y){const c=CHATS.find(z=>z.id===S.chat);if(c)chatMenu(c.id,x,y)}
document.addEventListener('contextmenu',e=>{
  const t=e.target,row=t.closest('#list .row'),pp=t.closest('#contacts .pp-row'),msg=t.closest('.msg'),ws=t.closest('#rail .ws[data-fo]:not([data-fo="all"])');
  if(!(row||pp||msg||ws))return;e.preventDefault();const {x,y}=winXY(e);
  if(msg)msgMenu(msg.dataset.m,x,y);else if(row&&row.dataset.id!=='room')chatMenu(row.dataset.id,x,y);else if(pp)contactMenu(pp.dataset.k,x,y);else if(ws)folderMenu(ws.dataset.fo,x,y);
});
$('#bmore').onclick=e=>{e.stopPropagation();const r=rectIn($('#bmore'));chatActions(r.r-230,r.b+8)};
/* ---------- окна ---------- */
const mstack=[];
function openModal(cls,html){
  const bg=document.createElement('div');bg.className='modal-bg';bg.innerHTML=`<div class="modal glass-pop ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  layer.append(bg);bg._prev=document.activeElement;mstack.push(bg);closeMenus();requestAnimationFrame(()=>bg.classList.add('open'));
  bg.addEventListener('mousedown',e=>{if(e.target===bg)closeModal(bg)});
  bg.addEventListener('click',e=>{if(e.target.closest('[data-a="close"]'))closeModal(bg)});
  setTimeout(()=>{(bg.querySelector('input:not([type=hidden])')||bg.querySelector('button'))?.focus()},60);return bg;
}
function closeModal(bg){if(!bg||!bg.isConnected)return;bg.classList.remove('open');const i=mstack.indexOf(bg);if(i>=0)mstack.splice(i,1);setTimeout(()=>{bg.remove();try{bg._prev?.focus()}catch{}},320)}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(mstack.length){closeModal(mstack[mstack.length-1]);return}closeMenus();menuSet(false);epSet(false);hmSet(false);if($('#sbar').classList.contains('on'))searchClose()}
  if(e.key==='Tab'&&mstack.length){const m=mstack[mstack.length-1],f=$$('button:not(:disabled),input,[tabindex="0"]',m).filter(x=>x.offsetParent);if(!f.length)return;const a=document.activeElement,i=f.indexOf(a);
    if(e.shiftKey&&(i<=0)){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&(i===f.length-1||i<0)){e.preventDefault();f[0].focus()}}
});
function confirmBox(text,ok='Удалить'){return new Promise(res=>{
  const bg=openModal('w360',`<div class="modal-hdr"><span class="grow">Подтверждение</span></div><div class="confirm-body">${esc(text)}</div><div class="modal-footer"><button class="btn" data-a="no">Отмена</button><button class="btn danger fill" data-a="yes">${ok}</button></div>`);
  let done=false;const fin=v=>{if(done)return;done=true;closeModal(bg);res(v)};
  bg.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b)fin(b.dataset.a==='yes')});bg.addEventListener('mousedown',e=>{if(e.target===bg)fin(false)});
  new MutationObserver(()=>{if(!bg.isConnected)fin(false)}).observe(layer,{childList:true});
})}
const personRow=(k,multi,on)=>`<button class="pp-row${on?' on':''}" data-k="${k}">${avHtml(PPL[k],'sm')}<span class="pp-name">${PPL[k].n}<span class="pp-sub">${PPL[k].ws}</span></span>${PPL[k].tag?`<span class="pill-tag" style="color:rgb(${PPL[k].c})">${PPL[k].tag}</span>`:''}${multi?`<span class="pp-chk">${I('check')}</span>`:''}</button>`;
/* новый чат: мастер в два шага */
function modalNewChat(){
  const bg=openModal('w440',`<div class="modal-hdr"><button class="ibtn hide" data-a="back" aria-label="Назад">${I('chevLeft')}</button><span class="grow" id="nct">Новый чат</span><span class="step" id="ncs"></span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div><div id="ncb"></div>`);
  const body=$('#ncb',bg),sel=new Set(),swap=h=>{body.style.opacity=0;setTimeout(()=>{body.innerHTML=h;body.style.opacity=1},120)};body.style.transition='opacity .15s';
  const head=(t,s,back)=>{$('#nct',bg).textContent=t;$('#ncs',bg).textContent=s;$('[data-a="back"]',bg).classList.toggle('hide',!back)};
  const step1=()=>{head('Новый чат','',false);sel.clear();swap(`<div class="nc-kinds"><button class="nc-kind" data-kind="direct"><span class="nc-kind-ic">${I('user')}</span><span class="nc-kind-txt"><b>Личный чат</b><span>Личная переписка с пользователем</span></span><span class="nc-kind-go">›</span></button><button class="nc-kind" data-kind="group"><span class="nc-kind-ic">${I('users')}</span><span class="nc-kind-txt"><b>Группа</b><span>Общая переписка с названием и участниками</span></span><span class="nc-kind-go">›</span></button></div>`)};
  const people=(q,multi)=>Object.keys(PPL).filter(k=>!q||PPL[k].n.toLowerCase().includes(q)||PPL[k].login.includes(q)).map(k=>personRow(k,multi,sel.has(k))).join('')||'<div class="emptylist">Нет пользователей</div>';
  const step2=kind=>{const g=kind==='group';head(g?'Новая группа':'Личный чат','Шаг 2 из 2',true);
    swap(`${g?`<div class="nc-group-bar"><button class="av lg" id="gav" style="background:linear-gradient(135deg,#059669,#047857)" aria-label="Фото группы">Г</button><label class="fld"><input id="gname" placeholder="Название группы" autocomplete="off" aria-label="Название группы"></label></div>`:''}
     <label class="fld nc-search">${I('search')}<input id="nq" placeholder="Поиск по имени или логину" autocomplete="off" aria-label="Поиск"></label>
     <div class="nc-list" id="nl">${people('',g)}</div>
     <div class="modal-footer">${g?`<span class="hint" id="nh">Отметьте участников</span><button class="btn" data-a="back2">Назад</button><button class="btn pri" id="mk" disabled>Создать группу</button>`:`<span class="hint">Нажмите на человека — откроется переписка</span>`}</div>`);
    setTimeout(()=>{const q=$('#nq',bg),nl=$('#nl',bg);q.oninput=()=>nl.innerHTML=people(q.value.trim().toLowerCase(),g);(g?$('#gname',bg):q).focus();
      if(g){$('#gname',bg).oninput=e=>{$('#mk',bg).disabled=!e.target.value.trim()};$('#gav',bg).onclick=()=>toast('Выберите картинку для группы')}},160)};
  step1();
  bg.addEventListener('click',e=>{
    const k=e.target.closest('[data-kind]');if(k){S.nk=k.dataset.kind;return step2(S.nk)}
    if(e.target.closest('[data-a="back"],[data-a="back2"]'))return step1();
    const r=e.target.closest('.pp-row');
    if(r){if(S.nk==='group'){sel.has(r.dataset.k)?sel.delete(r.dataset.k):sel.add(r.dataset.k);r.classList.toggle('on');$('#nh',bg).textContent=sel.size?'Выбрано: '+sel.size:'Отметьте участников'}else{closeModal(bg);startDirect(r.dataset.k)}return}
    if(e.target.closest('#mk')){const n=$('#gname',bg).value.trim();if(!n)return;closeModal(bg);CHATS.splice(1,0,{id:'g'+Date.now(),k:'group',n,bg:'#059669,#047857',ini:n[0].toUpperCase(),p:'Группа создана',t:'сейчас',sub:(sel.size+1)+' участника',f:'work',type:1});CONVO[CHATS[1].id]=[];
      renderList();setTab('chats');openChat(CHATS[1].id);toast('Группа создана')}
  });
}
function startDirect(k){let c=CHATS.find(x=>x.peer===k);if(!c){const p=PPL[k];c={id:'d-'+k,k:'dm',n:p.n,bg:p.bg,ini:p.ini,on:p.on,p:'Нет сообщений',t:'',sub:p.on?'в сети':p.st,peer:k,f:'people'};CHATS.push(c);CONVO[c.id]=[]}
  setTab('chats');renderList();openChat(c.id)}
/* профиль */
function openProfile(k){
  const p=PPL[k];if(!p)return;const blocked=S.blocked.includes(k),contact=S.contacts.has(k),other=p.ws!=='Основное';
  const groups=CHATS.filter(c=>(c.k==='group'||c.k==='room')&&(MEMBERS[c.id]||[]).includes(k));
  const bg=openModal('pf-modal',`<div class="mscroll"><div class="pf-cover" style="--cv:${p.bg.split(',')[1]}"><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
   <div class="pf-head"><span class="av xl" style="background:linear-gradient(135deg,${p.bg})">${p.ini}${p.on?'<i class="dot" style="width:16px;height:16px"></i>':''}</span><div class="pf-tx"><div class="pf-name">${p.n}${p.tag?`<span class="pill-tag" style="color:rgb(${p.c})">${p.tag}</span>`:''}</div><div class="pf-st${p.on?' on':''}">${p.on?'в сети':p.st}</div></div></div>
   <div class="pf-body">${blocked?'<div class="pf-note">Вы заблокировали этого человека: он не может писать вам в личные сообщения. Общие группы и комнаты остаются.</div>':''}
    <div class="pf-g"><button class="pf-r" data-a="copy"><b>Логин</b><span>@${p.login}<i class="ci">${I('copy')}</i></span></button>${other?`<div class="pf-r"><b>Пространство</b><span>${p.ws}</span></div><div class="pf-r"><b>В ваших контактах</b><span>${contact?'Да':'Нет'}</span></div>`:''}</div>
    <button class="pf-g pf-link" data-a="media">${I('image')}<b>Медиа, файлы и ссылки</b><span class="ch">${I('chevRight')}</span></button>
    <div class="pf-gt">Общие группы · ${groups.length}</div>
    <div class="pf-g">${groups.length?groups.map(c=>`<div class="pf-gr" data-g="${c.id}">${avHtml(c,'sm')}<div class="pf-gi"><b>${c.n}</b><span>${c.k==='room'?'Комната':'Группа'} · ${(MEMBERS[c.id]||[]).length} участника</span></div></div>`).join(''):'<div class="pf-r" style="justify-content:center;color:var(--muted)">Общих групп и комнат нет</div>'}</div></div></div>
   <div class="pf-foot"><button class="btn ${blocked?'':'danger'}" data-a="block">${I(blocked?'unban':'ban')}${blocked?'Разблокировать':'Заблокировать'}</button><span class="sp"></span>${other?`<button class="btn" data-a="contact">${I(contact?'userMinus':'userPlus')}${contact?'Из контактов':'В контакты'}</button>`:''}<button class="btn pri" data-a="write">${I('chat')}Написать</button></div>`);
  bg.addEventListener('click',async e=>{const a=e.target.closest('[data-a]'),g=e.target.closest('[data-g]');
    if(g){closeModal(bg);setTab('chats');openChat(g.dataset.g);return}if(!a)return;
    if(a.dataset.a==='copy'){navigator.clipboard?.writeText('@'+p.login).catch(()=>{});toast('Скопировано: @'+p.login);a.classList.add('done');$('.ci',a).innerHTML=I('check');setTimeout(()=>{a.classList.remove('done');$('.ci',a).innerHTML=I('copy')},1600)}
    else if(a.dataset.a==='media')openMedia(k);
    else if(a.dataset.a==='write'){closeModal(bg);startDirect(k)}
    else if(a.dataset.a==='contact'){S.contacts.has(k)?S.contacts.delete(k):S.contacts.add(k);closeModal(bg);if(S.tab==='contacts')renderContacts();openProfile(k)}
    else if(a.dataset.a==='block'){if(blocked){S.blocked=S.blocked.filter(x=>x!==k);closeModal(bg);openProfile(k);toast('Разблокирован')}else if(await confirmBox('Заблокировать '+p.n+'? Он не сможет писать вам в личные сообщения.','Заблокировать')){S.blocked.push(k);closeModal(bg);openProfile(k);toast('Заблокировано')}}});
}
/* медиа, файлы и ссылки */
function openMedia(k){
  const nm=PPL[k]?PPL[k].n:CHATS.find(c=>c.id===k)?.n||'';
  const tile=(i,v)=>`<button class="cm-tile" style="--bg:linear-gradient(135deg,hsl(${(i*47)%360} 70% 62%),hsl(${(i*47+50)%360} 65% 42%));background:var(--bg)" aria-label="Открыть">${v?`<span class="cm-play">${I('play')}</span>`:''}</button>`;
  const months=[['Октябрь 2026',9],['Сентябрь 2026',6],['Август 2026',4]];
  const tabs={media:()=>months.map(([m,n],j)=>`<div class="cm-month">${m}</div><div class="cm-grid">${Array.from({length:n},(_,i)=>tile(i+j*5,i%4===1)).join('')}</div>`).join(''),
   files:()=>[['Октябрь 2026',[['Roadmap_Q4.pdf','184 КБ · Алексей · 24 окт.'],['Отчёт_сентябрь.xlsx','72 КБ · Вы · 18 окт.'],['Макет_профиля.fig','5,4 МБ · Елена · 12 окт.']]],['Сентябрь 2026',[['Договор_поставки.docx','41 КБ · Дмитрий · 29 сент.'],['Презентация.pptx','12 МБ · Вы · 3 сент.']]]].map(([m,l])=>`<div class="cm-month">${m}</div><div class="cm-list">${l.map(([n,s])=>`<button class="cm-row"><span class="cm-ic">${I('file')}</span><span class="cm-tx"><b>${n}</b><span>${s}</span></span></button>`).join('')}</div>`).join(''),
   links:()=>`<div class="cm-month">Октябрь 2026</div><div class="cm-list">${[['Дизайн-система: токены и формы','figma.com/file/design-system · Елена · 22 окт.'],['Релиз 2.4: заметки','github.com/team/releases · Дмитрий · 20 окт.'],['Дорожная карта Q4','notion.so/roadmap-q4 · Вы · 4 окт.']].map(([n,s])=>`<a class="cm-row" href="#" onclick="return false"><span class="cm-ic">${I('link')}</span><span class="cm-tx"><b>${n}</b><span>${s}</span></span></a>`).join('')}</div>`};
  const bg=openModal('cm-modal',`<div class="modal-hdr"><span class="grow">Медиа · ${nm}</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
   <div class="seg cm-tabs" id="cmseg" role="tablist"><span class="thumb"></span><button class="on" data-t="media" role="tab">Медиа</button><button data-t="files" role="tab">Файлы</button><button data-t="links" role="tab">Ссылки</button></div><div class="cm-scroll" id="cms"></div>`);
  const paint=t=>{const s=$('#cms',bg);s.style.opacity=0;setTimeout(()=>{s.innerHTML=tabs[t]();s.scrollTop=0;s.style.opacity=1},110)};$('#cms',bg).style.transition='opacity .12s';paint('media');
  requestAnimationFrame(()=>requestAnimationFrame(()=>segMove($('#cmseg',bg))));
  bg.addEventListener('click',e=>{const b=e.target.closest('#cmseg button');if(b){segSet($('#cmseg',bg),b);paint(b.dataset.t)}if(e.target.closest('.cm-tile'))toast('Просмотр медиа откроется в лайтбоксе')});
}
/* группа / комната */
function openGroup(cid){
  const c=CHATS.find(x=>x.id===cid),ids=MEMBERS[cid]||[],room=c.k==='room';
  const bg=openModal('gm-modal',`<div class="modal-hdr"><span class="grow">${room?'Комната':'Группа'}</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
   <div class="mscroll"><div class="gm-hero"><span class="av xl ${room?'sq':''}" style="background:linear-gradient(135deg,${c.bg})">${c.ico?I(c.ico):c.ini}</span><div class="name">${c.n}</div><div class="sub">${ids.length+1} участников · в сети 3</div></div>
   <div class="gm-tiles" style="grid-template-columns:repeat(${room?3:5},1fr)"><button class="gm-tile" data-a="add">${I('userPlus')}Добавить</button><button class="gm-tile" data-a="search">${I('search')}Поиск</button><button class="gm-tile" data-a="media">${I('image')}Медиа</button>${room?'':`<button class="gm-tile" data-a="mute">${I(S.muted.has(cid)?'bell':'bellOff')}${S.muted.has(cid)?'Включить':'Без звука'}</button><button class="gm-tile d" data-a="leave">${I('logout')}Выйти</button>`}</div>
   <label class="fld nc-search" style="height:36px">${I('search')}<input placeholder="Найти участника" aria-label="Найти участника"></label>
   <div class="gm-sec"><span>На этом сервере</span><span>${ids.length+1}</span></div>
   <div class="gm-box">${['me',...ids].map((k,i)=>{const p=k==='me'?{n:'Мария Иванова (вы)',bg:'#f6a35a,#e0507a',ini:'АБ',on:1,login:'admin'}:PPL[k];return `<button class="gm-row" data-k="${k}">${avHtml(p,'sm')}<span class="gm-nm"><b>${p.n}</b><span>@${p.login}</span></span>${i===0?'<span class="gm-chip">создатель</span>':`<span style="font-size:12px;color:var(--text2)">${p.on?'в сети':p.st||'давно'}</span>`}</button>`}).join('')}</div></div>`);
  bg.addEventListener('click',async e=>{const r=e.target.closest('.gm-row'),a=e.target.closest('[data-a]');
    if(r&&r.dataset.k!=='me'){closeModal(bg);openProfile(r.dataset.k);return}if(!a)return;
    if(a.dataset.a==='media'){openMedia(cid)}else if(a.dataset.a==='add')toast('Выберите людей для добавления');else if(a.dataset.a==='search'){closeModal(bg);searchOpen()}
    else if(a.dataset.a==='mute'){S.muted.has(cid)?S.muted.delete(cid):S.muted.add(cid);closeModal(bg);renderList();toast('Готово')}
    else if(a.dataset.a==='leave'){closeModal(bg);delChat(cid,'Выйти из группы «'+c.n+'»?','Выйти')}});
}
function modalAddContact(){
  const bg=openModal('w440',`<div class="modal-hdr"><span class="grow">Добавить контакт</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div><div class="ac-body"><p class="ac-lead">Введите логин человека из другого пространства или с другого сервера, например @petrov или @server:petrov.</p><label class="fld" style="height:44px">${I('user')}<input id="acq" placeholder="@логин" autocomplete="off" aria-label="Логин"></label><div class="ac-hint" id="ach"></div></div><div class="modal-footer"><button class="btn" data-a="close">Отмена</button><button class="btn pri" id="acgo" disabled>Найти</button></div>`);
  const q=$('#acq',bg),h=$('#ach',bg),go=$('#acgo',bg);q.oninput=()=>{go.disabled=!q.value.trim();h.className='ac-hint';h.textContent=''};
  go.onclick=()=>{const v=q.value.trim().replace('@','').toLowerCase(),k=Object.keys(PPL).find(x=>PPL[x].login===v);if(k&&!S.contacts.has(k)){S.contacts.add(k);closeModal(bg);renderContacts();toast('Контакт добавлен')}else{h.className='ac-hint err';h.textContent=k?'Этот человек уже в контактах':'Пользователь не найден'}}};
function modalForward(){
  const bg=openModal('w380',`<div class="modal-hdr"><span class="grow">Переслать в…</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div><label class="fld nc-search" style="height:36px;margin-top:2px">${I('search')}<input id="fq" placeholder="Поиск…" aria-label="Поиск"></label><div class="nc-list" id="fl" style="max-height:300px;padding-bottom:14px"></div>`);
  const paint=()=>{const q=$('#fq',bg).value.toLowerCase();$('#fl',bg).innerHTML=CHATS.filter(c=>c.k!=='room'&&c.n.toLowerCase().includes(q)).map(c=>`<button class="pp-row" data-c="${c.id}">${avHtml(c,'sm')}<span class="pp-name">${c.n}</span></button>`).join('')};paint();$('#fq',bg).oninput=paint;
  bg.addEventListener('click',e=>{const r=e.target.closest('[data-c]');if(r){closeModal(bg);toast('Переслано: '+CHATS.find(c=>c.id===r.dataset.c).n)}});
}
const FCOL=['#4b8df0','#19b394','#d0566a','#e8571f','#7bc04a','#b06af0','#d9a21a','#6d7a8c'],FICO=['folder','case','users','star','home','bell','chat','shield','user','hash','globe','key'];
function modalFolder(f,nameOnly){
  const st=f?{n:f.n,c:f.c,ic:f.ic}:{n:'',c:FCOL[0],ic:'folder'};
  const bg=openModal('w440',`<div class="modal-hdr"><span class="grow">${f?(nameOnly?'Переименовать папку':'Изменить папку'):'Новая папка'}</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div><div class="ac-body" id="feb"></div><div class="modal-footer"><button class="btn" data-a="close">Отмена</button><button class="btn pri" id="fego">Сохранить</button></div>`);
  const paint=()=>{$('#feb',bg).innerHTML=`<div class="fe-top"><span class="fe-big" style="--fc:${st.c}">${I(st.ic)}</span><label class="fld"><input id="fen" maxlength="30" placeholder="Название папки" value="${esc(st.n)}" autocomplete="off" aria-label="Название папки"></label></div>${nameOnly?'':`<div class="fe-l">Цвет</div><div class="fe-cols">${FCOL.map(c=>`<button style="--fc:${c}" class="${c===st.c?'on':''}" data-c="${c}" aria-label="Цвет ${c}"></button>`).join('')}</div><div class="fe-l">Значок</div><div class="fe-icons">${FICO.map(n=>`<button style="--fc:${st.c}" class="${n===st.ic?'on':''}" data-i="${n}" aria-label="${n}">${I(n)}</button>`).join('')}</div>`}`;
    const i=$('#fen',bg);i.oninput=()=>{st.n=i.value;$('#fego',bg).disabled=!i.value.trim()};$('#fego',bg).disabled=!st.n.trim()};
  paint();bg.addEventListener('click',e=>{const c=e.target.closest('[data-c]'),i=e.target.closest('[data-i]');
    if(c){st.n=$('#fen',bg).value;st.c=c.dataset.c;paint()}if(i){st.n=$('#fen',bg).value;st.ic=i.dataset.i;paint()}
    if(e.target.closest('#fego')){st.n=$('#fen',bg).value.trim();if(!st.n)return;closeModal(bg);
      if(f)Object.assign(f,{n:st.n,c:st.c,ic:st.ic});else FOLDERS.push({id:'f'+Date.now(),n:st.n,c:st.c,ic:st.ic});railFolders();if(S.sec==='folders'&&S.tab==='settings')openSection('folders');toast(f?'Папка сохранена':'Папка создана')}});
}
/* ---------- настройки ---------- */
const tgH=(on,k,l)=>`<button class="tg" role="switch" aria-checked="${on}" aria-label="${l}" data-tg="${k}"></button>`;
const segH=(key,items,cur,full)=>`<div class="seg${full?' full':''}" role="group" data-seg="${key}"><span class="thumb"></span>${items.map(([v,t])=>`<button class="${String(cur)===String(v)?'on':''}" data-v="${v}">${t}</button>`).join('')}</div>`;
const CSX={
profile:()=>`<div class="cs-hero"><button class="cs-av-edit" data-act="avatar" aria-label="Сменить фото"><span class="av xl" style="background:linear-gradient(135deg,#f6a35a,#e0507a);width:72px;height:72px">АБ</span><span class="cs-badge">${I('pen')}</span></button><div class="cs-hero-t"><b id="hname">${esc(S.name||'Мария Иванова')}</b><span>@admin</span><div class="cs-chips"><span class="cs-chip">Админ</span></div></div></div>
 <div class="cs-gt">Ссылка на профиль</div><div class="cs-g"><div class="cs-r stack"><div class="pl-b">${[['Внутренняя','@admin'],['Внешняя','@electron:admin']].map(([k,v])=>`<button class="pl-f" data-act="plink" data-v="${v}" aria-label="Скопировать: ${v}"><span class="pl-k">${k}</span><span class="pl-v">${v}</span><span class="pl-i">${I('copy')}</span></button>`).join('')}</div><p class="pl-n">Внутреннюю называйте коллегам на вашем сервере, внешнюю людям с других серверов.</p></div></div>
 <div class="cs-gt">Имя</div><div class="cs-g"><div class="cs-r stack"><div class="cs-l"><b>Как вас видят в чатах</b><span>Логин @admin не меняется — его задаёт администратор.</span></div>
  <div class="cs-ctl"><label class="fld" style="flex:1;min-width:200px" id="namebox"><input id="csname" value="${esc(S.name||'Мария Иванова')}" maxlength="40" aria-label="Имя" autocomplete="off"><span class="cnt" id="namecnt">${(S.name||'Мария Иванова').length}/40</span></label><button class="btn pri" id="namesave" disabled>Сохранить</button></div><div id="namemsg"></div></div></div>
 <div class="cs-gt">Безопасность</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Пароль</b><span id="pwsub">${S.pwdone?'Пароль изменён':'Меняется здесь же, без администратора'}</span></div><button class="btn" data-act="pwopen" id="pwbtn">${I('lock')}Сменить пароль</button></div>
  <div class="cs-r stack hide" id="pwform"><label class="fld"><input id="pw0" type="password" placeholder="Текущий пароль" aria-label="Текущий пароль"><button class="ibtn" data-act="pweye" aria-label="Показать пароли" style="width:30px;height:30px">${I('eye')}</button></label>
   <label class="fld"><input id="pw1" type="password" placeholder="Новый пароль" aria-label="Новый пароль"></label><div class="cs-pwbar" id="pwbar"><i></i><i></i><i></i><i></i><span>Надёжность</span></div>
   <label class="fld" id="pw2box"><input id="pw2" type="password" placeholder="Повторите новый пароль" aria-label="Повторите пароль"></label><div id="pwmsg" style="min-height:16px"></div>
   <div class="cs-ctl"><span style="flex:1"></span><button class="btn" data-act="pwopen">Отмена</button><button class="btn pri" id="pwsave" disabled>Сохранить пароль</button></div></div></div>
 <div class="cs-logout"><div class="cs-l"><b>Выйти из аккаунта</b><span>На этом компьютере понадобится снова ввести логин и пароль</span></div><button class="btn danger" data-act="logout">${I('logout')}Выйти</button></div>`,
general:()=>`<div class="cs-gt">Уведомления</div><div class="cs-g">
  <div class="cs-r"><div class="cs-l"><b>Звук сообщений</b><span>Короткий сигнал, когда приходит новое сообщение</span></div><div class="cs-ctl"><button class="btn sm" data-act="beep" ${S.set.sound?'':'disabled'} id="beepbtn">${I('play')}Прослушать</button>${tgH(S.set.sound,'sound','Звук сообщений')}</div></div>
  <div class="cs-r"><div class="cs-l"><b>Показывать текст сообщения</b><span>Выключите, если экран виден посторонним: в уведомлении будет только «Новое сообщение»</span></div>${tgH(S.set.text,'text','Показывать текст')}</div>
  <div class="cs-r"><div class="cs-l"><b>Тихие часы</b><span>${S.set.quiet?'В это время уведомлений и звука нет, сообщения никуда не пропадают':'В выбранные часы уведомлений и звука нет'}</span></div><div class="cs-ctl">${S.set.quiet?`<label class="fld" style="height:34px;width:96px;padding:0 10px"><input type="time" value="22:00" aria-label="С"></label><span style="color:var(--muted)">–</span><label class="fld" style="height:34px;width:96px;padding:0 10px"><input type="time" value="08:00" aria-label="До"></label>`:''}${tgH(S.set.quiet,'quiet','Тихие часы')}</div></div></div>
 <div class="cs-gt">Приложение</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Автозапуск при старте</b><span>Приложение откроется само после входа в систему</span></div>${tgH(S.set.auto,'auto','Автозапуск')}</div>
  <div class="cs-r"><div class="cs-l"><b>Скрыть сайдбар</b><span>Список чатов прячется и выезжает при наведении на левый край окна</span></div>${tgH(S.set.hide,'hide','Скрыть сайдбар')}</div></div>`,
appearance:()=>`<div class="cs-pv" aria-hidden="true"><div class="cs-pv-side"><i></i><i class="on"></i><i></i><i></i><i></i></div><div class="cs-pv-chat"><div class="cs-pv-msg in"><b>Мария</b>Созвон переносим на 15:30<small>14:18</small></div><div class="cs-pv-msg out">Отлично, успеваю<small>14:19</small></div></div></div>
 <div class="cs-gt">Тема и цвет</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Тема</b></div>${segH('theme',[['light',I('sun')+'Светлая'],['dark',I('moon')+'Тёмная'],['navy',I('drop')+'Тёмно-синяя']],S.theme)}</div>
  <div class="cs-r"><div class="cs-l"><b>Цвет акцента</b><span>Кнопки, свои сообщения, выделение</span></div><div class="cs-ctl"><span class="cs-aname" id="accname">${ACC[S.acc][0]}</span><div class="accent-seg">${Object.entries(ACC).map(([k,a])=>`<button class="accent-dot${k===S.acc?' on':''}" style="--dot:rgb(${root.classList.contains('dark')?a[2]:a[1]})" data-acc="${k}" aria-label="${a[0]}" title="${a[0]}"></button>`).join('')}</div></div></div>
  <div class="cs-r"><div class="cs-l"><b>Прозрачность</b><span>Стекло панелей, меню и окон: правее — прозрачнее, левее — плотнее</span></div><div class="cs-ctl"><input class="rng" type="range" min="0" max="100" step="1" value="${S.set.tr}" style="--v:${S.set.tr}%" data-rng="tr" aria-label="Прозрачность стекла"><span class="rng-val" id="trval">${S.set.tr}%</span></div></div></div>
 <div class="cs-gt">Фон переписки</div><div class="bg-cards">${[['plain','Как обычно','Сайдбар и переписка одного цвета'],['split','С разделением','Переписка отделена оттенком']].map(([v,t,s])=>`<button class="bg-card${S.set.bg===v?' on':''}" data-bg="${v}"><span class="bg-skel"><span class="bs-side"><i></i><i></i><i></i></span><span class="bs-chat${v==='split'?' split':''}"><i style="width:60%"></i><i style="width:78%"></i><i class="c"></i></span></span><span class="bg-cap"><b>${t}</b>${s}</span></button>`).join('')}</div>
 <div class="cs-gt">Фон</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Цветная картинка</b><span>Размытые цветные пятна за стеклом. Выключите — фон станет ровным. С узором не связана.</span></div>${tgH(S.set.amb,'amb','Цветная картинка')}</div>
  <div class="cs-r stack"><div class="cs-l"><b>Узор</b><span>Рисунок поверх фона переписки</span></div><div class="pat-cards">${[['none','Без узора'],['pets','Питомцы'],['doodle','Каракули']].map(([v,t])=>`<button class="pat-card${S.set.pattern===v?' on':''}" data-pat="${v}"><span class="pat-swatch"></span><span class="pat-cap">${t}</span></button>`).join('')}</div>
  ${S.set.pattern!=='none'?`<div class="cs-ctl between"><div class="cs-l"><b>Заметность узора</b></div>${segH('plevel',[[1,'Слабая'],[2,'Средняя'],[3,'Сильная']],2)}</div>`:''}</div></div>
 <div class="cs-gt">Текст</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Размер текста</b><span>Сообщения и список чатов</span></div>${segH('fs',[['small','<span class="cs-aa" style="font-size:11px">Aa</span>'],['medium','<span class="cs-aa" style="font-size:13px">Aa</span>'],['large','<span class="cs-aa" style="font-size:16px">Aa</span>']],S.set.fs)}</div>
  <div class="cs-r"><div class="cs-l"><b>Масштаб интерфейса</b><span>Всё окно целиком</span></div>${segH('scale',[[80,'80%'],[90,'90%'],[100,'100%']],S.set.scale)}</div></div>`,
blocks:()=>S.blocked.length?`<div class="cs-gt">Заблокированные</div><div class="cs-g">${S.blocked.map(k=>`<div class="cs-r"><div class="cs-l"><b>${PPL[k].n}</b><span>@${PPL[k].login} · ${PPL[k].ws}</span></div><button class="btn sm" data-act="unblock" data-k="${k}">Разблокировать</button></div>`).join('')}</div><p class="cs-hint">Заблокированный не может писать вам в личные сообщения. Общие группы и комнаты остаются.</p>`
  :`<div class="cs-stub"><div class="cs-stub-i glass">${I('ban')}</div><b>Заблокированных нет</b><span>Если кто-то пишет вам лишнее, заблокируйте его в меню «⋯» в чате с ним.</span></div>`,
modules:()=>`<div class="cs-gt">Доступные модули</div><div class="cs-g">
  <div class="cs-r"><div class="cs-l"><b>GIF <span class="cs-pill">Klipy</span></b><span>Поиск и отправка GIF из панели смайлов. При включении загружается около 12 МБ.</span></div><div class="cs-ctl">${S.set.mods.gif?'<button class="btn sm" data-act="redo">Перекачать</button>':''}${tgH(S.set.mods.gif,'mod-gif','GIF')}</div></div>
  <div class="cs-r"><div class="cs-l"><b>Опросы</b><span>Голосования в группах и комнатах</span></div>${tgH(S.set.mods.poll,'mod-poll','Опросы')}</div></div><p class="cs-hint">GIF ищутся через сервис Klipy: поисковый запрос уходит на их сервер.</p>`,
folders:()=>`<div class="cs-gt">Пространства</div><div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Отображать пространства</b><span>Бар покажет «Общий вид» и все ваши пространства: выбор отфильтрует чаты и контакты</span></div>${tgH(S.set.spaces,'spaces','Пространства')}</div></div>
 <div class="cs-gt">Папки</div><p class="fp-lead">Папки помогают разбирать чаты по темам. Чат добавляется в папку из его контекстного меню.</p>
 <div class="fp-list">${FOLDERS.map((f,i)=>`<div class="fp-row" draggable="true" data-f="${f.id}"><span class="fp-grip" title="Перетащите, чтобы изменить порядок">${I('grip')}</span><span class="fp-ic" style="--fc:${f.c}">${I(f.ic)}</span><span class="fp-tx"><b>${f.n}</b><small>${CHATS.filter(c=>c.f===f.id).length} чатов</small></span><span class="fp-acts"><button data-a="up" title="Выше" aria-label="Выше" ${i===0?'disabled':''}>${I('chevUp')}</button><button data-a="down" title="Ниже" aria-label="Ниже" ${i===FOLDERS.length-1?'disabled':''}>${I('chevDown')}</button><button data-a="edit" title="Изменить" aria-label="Изменить">${I('pen')}</button><button class="danger" data-a="del" title="Удалить" aria-label="Удалить">${I('trash')}</button></span></div>`).join('')||'<div class="emptylist">Папок пока нет</div>'}</div>
 <button class="btn soft fp-add" data-act="newfolder">${I('plus')}Новая папка</button>`,
update:()=>`<div class="cs-g"><div class="cs-ver"><span class="cs-logo">${I('bolt')}</span><div class="cs-ver-t"><span>Доступна новая версия · 27 октября</span><b>3.18.0</b><span>Сейчас стоит 3.17.0</span></div><button class="btn pri" data-act="install" id="instbtn">${I('dl')}Установить</button></div>
  <div class="cs-notes"><b>Что нового</b><br>Новый вид клиента в стиле Liquid Glass: стеклянные панели, меню и окна поверх цветного фона.<br>Фильтр списка чатов: все, новые, личные, группы.<br>Комнаты с темами в новом оформлении.</div></div>
  <div class="am-prog hide" id="prog"><i style="width:0"></i></div>`
};
const CSD={profile:['Профиль','Фото, имя, ссылка и пароль'],general:['Основные','Уведомления и поведение приложения'],appearance:['Внешний вид','Тема, цвет, фон переписки и размер текста'],blocks:['Блокировки','Люди, которые не могут вам писать'],modules:['Модули','Дополнительные возможности клиента'],folders:['Папки и пространства','Папки чатов и пространства в баре'],update:['Обновление','Версия приложения и новые релизы']};
function openSection(k){
  S.sec=k;chatEl.classList.remove('empty');chatEl.classList.add('settings');$$('.cs-sn',csnav).forEach(b=>b.classList.toggle('on',b.dataset.k===k));reSel(csnav);
  $('#cst').textContent=CSD[k][0];$('#csd').textContent=CSD[k][1];const b=$('#csb');b.innerHTML=CSX[k]();b.scrollTop=0;
  $$('.seg[data-seg]',b).forEach(segMove);requestAnimationFrame(()=>$$('.seg[data-seg]',b).forEach(segMove));
  if(k==='profile')wireProfile();
}
/* после щелчка мышью фокус снимается у любой кнопки (рамка остаётся только при управлении с клавиатуры) */
document.addEventListener('click',e=>{if(e.detail>0){const b=e.target.closest('button,[role=button],[role=tab],[role=radio],[role=switch],.chat-item,.cs-sn');if(b)setTimeout(()=>{if(document.activeElement===b)b.blur()},0)}});
csnav.addEventListener('click',e=>{const b=e.target.closest('.cs-sn');if(!b)return;openSection(b.dataset.k);if(e.detail>0)b.blur()});   /* после щелчка мышью фокус снимается, как у строк чатов (их перерисовка его теряет); с клавиатуры кольцо остаётся */
function pwStrength(p){if(!p)return null;if(p.length<6)return{n:1,t:'коротковат',c:'var(--danger)'};let s=1;if(p.length>=10)s++;if(/[A-ZА-ЯЁ]/.test(p)&&/[a-zа-яё]/.test(p))s++;if(/\d/.test(p)&&/[^\wА-Яа-яЁё]/.test(p))s++;return[null,{n:1,t:'слабый',c:'var(--danger)'},{n:2,t:'средний',c:'#d98a0b'},{n:3,t:'хороший',c:'var(--accent)'},{n:4,t:'надёжный',c:'var(--accent)'}][s]}
function wireProfile(){
  const n=$('#csname'),sv=$('#namesave'),cur=S.name||'Мария Иванова';
  n.oninput=()=>{const v=n.value,ok=v.trim().length>0;$('#namecnt').textContent=v.length+'/40';sv.disabled=!ok||v.trim()===cur;$('#namebox').classList.toggle('bad',!ok);$('#namemsg').innerHTML=ok?'':'<span class="cs-err">Имя не может быть пустым</span>'};
  sv.onclick=()=>{S.name=n.value.trim();$('#hname').textContent=S.name;sv.disabled=true;$('#namemsg').innerHTML='<span class="cs-okt">Имя сохранено — его увидят все собеседники</span>'};
  const p0=$('#pw0'),p1=$('#pw1'),p2=$('#pw2'),ps=$('#pwsave');
  const chk=()=>{const st=pwStrength(p1.value);$$('#pwbar i').forEach((i,j)=>{i.classList.toggle('on',st&&j<st.n);i.style.setProperty('--c',st?st.c:'transparent')});$('#pwbar span').textContent=st?'Пароль '+st.t:'Надёжность';
    let m='';if(p1.value&&p1.value.length<6)m=`<span class="cs-hint" style="padding:0">Ещё ${6-p1.value.length} симв. до минимума</span>`;else if(p1.value&&p0.value&&p1.value===p0.value)m='<span class="cs-err">Новый пароль совпадает с текущим</span>';else if(p2.value&&p1.value!==p2.value)m='<span class="cs-err">Пароли не совпадают</span>';else if(p2.value&&p1.value===p2.value)m='<span class="cs-okt">Пароли совпадают</span>';
    $('#pwmsg').innerHTML=m;$('#pw2box').classList.toggle('bad',!!p2.value&&p1.value!==p2.value);ps.disabled=!(p0.value&&p1.value.length>=6&&p1.value===p2.value&&p1.value!==p0.value)};
  [p0,p1,p2].forEach(i=>i.oninput=chk);
  ps.onclick=()=>{S.pwdone=true;openSection('profile');toast('Пароль изменён')};
}
$('#csb').addEventListener('click',async e=>{
  const t=e.target,g=t.closest('[data-tg]'),a=t.closest('[data-act]'),sg=t.closest('.seg[data-seg] button'),ac=t.closest('[data-acc]'),bgc=t.closest('[data-bg]'),pt=t.closest('[data-pat]'),fr=t.closest('.fp-row [data-a]');
  if(g){const on=g.getAttribute('aria-checked')!=='true',k=g.dataset.tg;g.setAttribute('aria-checked',on);
    if(k.startsWith('mod-')){S.set.mods[k.slice(4)]=on;if(S.sec==='modules')setTimeout(()=>openSection('modules'),260)}else{S.set[k]=on;if(k==='amb')win.classList.toggle('noamb',!on);if(k==='sound'){$('#beepbtn').disabled=!on}if(k==='quiet')setTimeout(()=>openSection('general'),260);if(k==='spaces')toast(on?'Бар показывает пространства':'Пространства скрыты')}
    renderCsNav();return}
  if(sg){const sgEl=sg.closest('.seg'),k=sgEl.dataset.seg,v=sg.dataset.v;segSet(sgEl,sg);if(k==='theme'){setTheme(v);$$('.accent-dot',$('#csb')).forEach(d=>d.style.setProperty('--dot','rgb('+(root.classList.contains('dark')?ACC[d.dataset.acc][2]:ACC[d.dataset.acc][1])+')'))}else if(k==='fs')S.set.fs=v;else if(k==='scale'){S.set.scale=+v;toast('Масштаб: '+v+'%')}renderCsNav();return}
  if(ac){S.acc=ac.dataset.acc;applyAccent();$$('.accent-dot',$('#csb')).forEach(d=>d.classList.toggle('on',d===ac));$('#accname').textContent=ACC[S.acc][0];renderCsNav();return}
  if(bgc){S.set.bg=bgc.dataset.bg;$$('.bg-card').forEach(c=>c.classList.toggle('on',c===bgc));return}
  if(pt){S.set.pattern=pt.dataset.pat;openSection('appearance');return}
  if(fr){const row=fr.closest('.fp-row'),id=row.dataset.f,i=FOLDERS.findIndex(f=>f.id===id),k=fr.dataset.a;
    if(k==='up'||k==='down'){const j=i+(k==='up'?-1:1);if(j<0||j>=FOLDERS.length)return;[FOLDERS[i],FOLDERS[j]]=[FOLDERS[j],FOLDERS[i]];railFolders();openSection('folders')}else if(k==='edit')modalFolder(FOLDERS[i]);else delFolder(id);return}
  if(!a)return;const k=a.dataset.act;
  if(k==='avatar')toast('Выберите фото профиля');
  else if(k==='plink'){navigator.clipboard?.writeText(a.dataset.v).catch(()=>{});toast('Скопировано: '+a.dataset.v);a.classList.add('done');$('.pl-i',a).innerHTML=I('check');setTimeout(()=>{a.classList.remove('done');$('.pl-i',a).innerHTML=I('copy')},1600)}
  else if(k==='pwopen'){const f=$('#pwform'),open=f.classList.contains('hide');f.classList.toggle('hide',!open);$('#pwbtn').classList.toggle('hide',open);if(open)$('#pw0').focus()}
  else if(k==='pweye'){const on=$('#pw0').type==='password';['pw0','pw1','pw2'].forEach(i=>$('#'+i).type=on?'text':'password');a.innerHTML=I(on?'eyeOff':'eye')}
  else if(k==='logout'){if(await confirmBox('Выйти из аккаунта? На этом компьютере понадобится снова ввести логин и пароль.','Выйти'))toast('Выход выполнен (макет)')}
  else if(k==='beep')toast('Звук сообщения');
  else if(k==='unblock'){S.blocked=S.blocked.filter(x=>x!==a.dataset.k);openSection('blocks');renderCsNav();toast('Разблокирован')}
  else if(k==='redo')toast('Кэш модуля очищен, файлы загрузятся заново');
  else if(k==='newfolder')modalFolder();
  else if(k==='install'){a.disabled=true;const p=$('#prog');p.classList.remove('hide');let w=0;const iv=setInterval(()=>{w+=7;$('i',p).style.width=Math.min(w,100)+'%';if(w>=100){clearInterval(iv);toast('Установлено. Перезапуск…');a.disabled=false}},120)}
});
$('#csb').addEventListener('input',e=>{const r=e.target.closest('[data-rng]');if(!r)return;const t=+r.value;S.set.tr=t;r.style.setProperty('--v',t+'%');$('#trval').textContent=t+'%';applyTr()});
/* прозрачность: 50% — стандартная плотность стекла, 0% — плотнее, 100% — почти прозрачное */
function applyTr(){root.style.setProperty('--gl-k',Math.max(.15,1.9-.018*S.set.tr).toFixed(3))}
/* ---------- модалка «Новое объявление» ---------- */
function modalAnnounce(){
  const KINDS={chat:['В чаты','Строка от системы в группах и комнатах, остаётся в переписке'],popup:['Всплывающее','Карточка у тех, кто в сети в момент отправки'],banner:['Полоса','Тонкая полоса сверху на заданное время, догоняет тех, кого не было в сети']};
  const WHEN=[['now','Сейчас'],['hour','Через час'],['today','Сегодня 18:00'],['tom','Завтра 09:00'],['custom','Другое…']],DURS=[[15,'15 мин'],[60,'1 ч'],[180,'3 ч'],[1440,'Сутки']];
  const A={kind:'banner',text:'',wk:'now',dur:60,mode:'all',q:'',who:new Set()};
  const bell='<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const bg=openModal('anx-modal',`<div class="anx-half l"><div class="modal-hdr anx-hdr"><div><div class="anx-title">Новое объявление</div><div class="anx-sub">Текст, тип и время</div></div></div>
    <div class="anx-pvw" id="ap"></div>
    <div class="anx-lbd"><div class="anx-types" id="atp" role="radiogroup" aria-label="Тип объявления">${Object.entries(KINDS).map(([k,v])=>`<button type="button" role="radio" data-k="${k}">${v[0]}</button>`).join('')}</div>
      <textarea id="at" class="anx-ta" placeholder="Что сказать людям" aria-label="Текст объявления"></textarea>
      <div class="anx-f"><label>Когда</label><div class="anx-chs" id="aw">${WHEN.map(([k,l])=>`<button type="button" class="anx-ch" data-w="${k}">${l}</button>`).join('')}</div></div>
      <div class="anx-f" id="adf"><label>Показывать</label><div class="anx-chs" id="ad">${DURS.map(([d,l])=>`<button type="button" class="anx-ch" data-d="${d}">${l}</button>`).join('')}</div></div></div>
    <div class="anx-foot"><span class="anx-note" id="an"></span><button type="button" class="btn anx-btn" data-a="close">Отмена</button><button type="button" class="btn anx-btn pri" id="ago" disabled>Отправить</button></div></div>
    <div class="anx-half r"><div class="modal-hdr anx-hdr"><div class="anx-title">Кому отправить</div><span class="grow"></span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
      <div class="anx-rbar"><div class="anx-rhead"><span class="anx-t2" id="at2">Получат все</span><div class="anx-sg" id="am">${[['all','Всем'],['pick','Выбранным']].map(([k,l])=>`<button type="button" data-m="${k}">${l}</button>`).join('')}</div></div>
        <label class="anx-search">${I('search')}<input id="aq" placeholder="Имя, логин или тег" autocomplete="off" aria-label="Поиск получателей"></label>
        <div class="anx-bulk" id="ab"><button type="button" class="btn anx-btn sm" id="abs">Выбрать всех</button><button type="button" class="btn anx-btn sm" id="abu">Снять</button></div></div>
      <div class="anx-rlist" id="arl"></div>
      <div class="anx-rfoot"><span id="arc"></span><button type="button" class="btn anx-btn sm" id="acl" style="margin-left:auto">Очистить</button></div></div>`);
  const ks=Object.keys(PPL),ppl=k=>PPL[k];
  const pv=()=>{const t=A.text.trim()?A.text.trim().replace(/</g,'&lt;'):'<span class="anx-ph">Текст появится здесь</span>',h=`<span class="anx-hint">${KINDS[A.kind][1]}</span>`;
    if(A.kind==='banner')return `<div class="anx-pv"><div class="anx-app"><i style="top:56px;width:46%"></i><i style="top:74px;width:62%"></i><i style="top:92px;width:38%"></i><div class="anx-banner">${bell}<span>${t}</span><b aria-hidden="true">×</b></div></div>${h}</div>`;
    if(A.kind==='popup')return `<div class="anx-pv"><div class="anx-app anx-dim"><i style="top:14px;width:40%"></i><i style="top:32px;width:58%"></i><div class="anx-card"><div class="anx-ct"><span class="anx-ring">${bell}</span>Системное объявление</div><div class="anx-cx">${t}</div><span class="anx-ok">OK</span></div></div>${h}</div>`;
    return `<div class="anx-pv"><div class="anx-feed"><i style="width:44%"></i><div class="anx-sys">${bell}<span>${t}</span><small>сейчас</small></div><i style="width:30%;margin-left:auto"></i></div>${h}</div>`};
  const list=()=>{const q=A.q.trim().toLowerCase(),f=ks.filter(k=>!q||ppl(k).n.toLowerCase().includes(q)||ppl(k).login.includes(q)||(ppl(k).tag||'').toLowerCase().includes(q));let last='';
    return f.sort((a,b)=>ppl(a).n.localeCompare(ppl(b).n,'ru')).map(k=>{const p=ppl(k),l=p.n[0],h=l!==last?`<div class="anx-letter">${l}</div>`:'';last=l;return h+`<button type="button" class="anx-li" data-k="${k}" aria-pressed="${A.who.has(k)}">${avHtml(p,'sm')}<span class="anx-lt"><b>${p.n}</b><span>${p.ws}</span></span>${p.tag?`<span class="pill-tag" style="color:rgb(${p.c})">${p.tag}</span>`:''}</button>`}).join('')||'<div class="anx-empty">Ничего не найдено. Измените запрос</div>'};
  const upd=()=>{const all=A.mode==='all',miss=[];if(!A.text.trim())miss.push('текст');if(!all&&!A.who.size)miss.push('получателей');
    $('#ap',bg).innerHTML=pv();$$('#atp button',bg).forEach(b=>b.setAttribute('aria-checked',b.dataset.k===A.kind));$$('#aw button',bg).forEach(b=>b.setAttribute('aria-pressed',b.dataset.w===A.wk));$$('#ad button',bg).forEach(b=>b.setAttribute('aria-pressed',+b.dataset.d===A.dur));
    $('#adf',bg).style.display=A.kind==='banner'?'':'none';
    $('#an',bg).innerHTML=miss.length?`Осталось: <b>${miss.join(', ')}</b>`:'<b>Всё готово</b>';$('#an',bg).classList.toggle('ok',!miss.length);$('#ago',bg).disabled=!!miss.length;
    $$('#am button',bg).forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===A.mode));$('#at2',bg).textContent=all?'Получат все':'Получатели';
    $('#aq',bg).disabled=all;$('#ab',bg).style.display=all?'none':'';$('#acl',bg).style.display=!all&&A.who.size?'':'none';
    $('#arl',bg).innerHTML=all?`<div class="anx-lock"><b>Получат все ${ks.length}</b>Объявление уйдёт каждому. Нажмите «Выбранным», чтобы отметить людей.</div>`:list();
    $('#arc',bg).innerHTML=`Выбрано <b>${all?ks.length:A.who.size}</b> из ${ks.length}`};
  upd();
  bg.addEventListener('click',e=>{const t=e.target;let b;
    if(b=t.closest('#atp button'))A.kind=b.dataset.k;else if(b=t.closest('#aw button'))A.wk=b.dataset.w;else if(b=t.closest('#ad button'))A.dur=+b.dataset.d;
    else if(b=t.closest('#am button'))A.mode=b.dataset.m;else if(b=t.closest('.anx-li')){const k=b.dataset.k;A.who.has(k)?A.who.delete(k):A.who.add(k)}
    else if(t.closest('#abs'))ks.forEach(k=>A.who.add(k));else if(t.closest('#abu')||t.closest('#acl'))A.who.clear();
    else if(t.closest('#ago')){closeModal(bg);toast('Объявление отправлено');return}else return;
    const st=$('#arl',bg).scrollTop;upd();$('#arl',bg).scrollTop=st});
  $('#at',bg).oninput=e=>{A.text=e.target.value;const miss=!A.text.trim();$('#ap',bg).innerHTML=pv();$('#ago',bg).disabled=miss||(A.mode==='pick'&&!A.who.size);$('#an',bg).innerHTML=miss?'Осталось: <b>текст</b>':(A.mode==='pick'&&!A.who.size?'Осталось: <b>получателей</b>':'<b>Всё готово</b>');$('#an',bg).classList.toggle('ok',!miss&&!(A.mode==='pick'&&!A.who.size))};
  $('#aq',bg).oninput=e=>{A.q=e.target.value;$('#arl',bg).innerHTML=list()};
}
/* ---------- сцены, запуск ---------- */
$('#scenes').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const s=b.dataset.s;
  if(s==='newchat')modalNewChat();else if(s==='announce')modalAnnounce();else if(s==='profile')openProfile('dmitry');else if(s==='media')openMedia('dmitry');else if(s==='group')openGroup('team');
  else if(s==='settings'){setTab('settings');openSection('appearance')}
  else if(s==='msgmenu'){if(S.tab!=='chats')setTab('chats');openChat('team');await sleep(200);const m=$$('#cv-team .msg.out')[1]||$('#cv-team .msg');const r=rectIn(m);msgMenu(m.dataset.m,r.l+(r.r-r.l)*.55,r.t+10)}
  else if(s==='chatmenu'){if(S.tab!=='chats')setTab('chats');await sleep(40);const r=rectIn($('#list [data-id="team"]'));chatMenu('team',r.l+110,r.t+30)}});
$('#themeseg').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setTheme(b.dataset.t)});
$('#blur').oninput=e=>root.style.setProperty('--gl-blur',e.target.value+'px');
$('#nb').onclick=()=>{const o=$('#notes').classList.toggle('show');$('#nbl').textContent=o?'Скрыть':'Принципы'};
setTheme(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
S.chat='team';renderList();renderTopics();renderContacts();renderCsNav();openChat('team');
requestAnimationFrame(()=>{segMove($('#filter'));segMove($('#themeseg'));segMove($('#tabs'))});
setTimeout(()=>{reSel(list);segMove($('#filter'));segMove($('#themeseg'));segMove($('#tabs'))},400);
