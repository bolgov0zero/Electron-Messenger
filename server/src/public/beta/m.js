
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
const ACC={teal:['Бирюзовый',[29,168,140],[41,214,184]],blue:['Синий',[37,118,199],[96,170,245]],indigo:['Индиго',[92,96,205],[143,148,245]],plum:['Сливовый',[146,84,190],[196,146,240]],amber:['Янтарный',[186,120,38],[236,176,92]]};
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
const CHK=I('checks');
/* ═══════════ приложение макета: стек страниц, вкладки, переписка, меню, шторки ═══════════ */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const root=document.documentElement,phone=$('#phone'),stack=$('#stack'),layer=$('#layer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let sc=1;
const S={theme:'dark',acc:'teal',tab:'chats',filter:'all',folder:'all',q:'',pinned:new Set(['sever']),muted:new Set(['dev']),
  contacts:new Set(['marat','olga','elena','dmitry']),blocked:['olga'],name:'Мария Иванова',
  set:{sound:true,text:true,quiet:false,spaces:false,amb:true,tr:50,pattern:'none',fs:1,mods:{gif:true,poll:false}},space:'Основное'};
const avHtml=(o,cls='')=>`<span class="av ${cls}${o.sq?' sq':''}" style="background:linear-gradient(135deg,${o.bg})">${o.ico?I(o.ico):(o.ini||'')}${o.on?'<i class="dot"></i>':''}${o.type?`<i class="type">${I('users')}</i>`:''}</span>`;
const ink=p=>p.c.startsWith('var')?'rgb('+p.c+')':p.c;
function rel(el){const a=phone.getBoundingClientRect(),r=el.getBoundingClientRect();return{x:(r.left-a.left)/sc,y:(r.top-a.top)/sc,w:r.width/sc,h:r.height/sc}}
const tagColor=p=>`style="color:rgb(${p.c.replace(/var\(--tag-(\d)\)/,(m,n)=>({1:'125,136,191',2:'98,218,98',3:'218,150,98',4:'98,218,210',5:'218,98,150'}[n]))})"`;
/* ---------- тема, акцент, масштаб ---------- */
function applyAccent(){const a=ACC[S.acc],c=root.classList.contains('dark')?a[2]:a[1];root.style.setProperty('--accent','rgb('+c+')');root.style.setProperty('--accent-rgb',c.join(','))}
const TC={light:'#e3f0ef',dark:'#12171d',navy:'#0f1b27'};
function setTheme(t){const m=document.querySelector('meta[name=theme-color]');m&&m.setAttribute('content',TC[t]);root.classList.toggle('dark',t!=='light');root.classList.toggle('navy',t==='navy');S.theme=t;
  $$('#themeseg button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));segMove($('#themeseg'));applyAccent();
  $$('.dot2').forEach(d=>d.style.setProperty('--dot','rgb('+ACC[d.dataset.a][root.classList.contains('dark')?2:1]+')'))}
function segMove(seg){const b=$('button.on',seg),t=$('.thumb',seg);if(!b||!t)return;t.style.left=b.offsetLeft+'px';t.style.width=b.offsetWidth+'px'}
const real=()=>window.innerWidth<=520;   /* на настоящем телефоне: на весь экран и со своей клавиатурой телефона */
function fit(){const f=$('.fit');if(real()){const full=f.clientHeight||innerHeight,vv=window.visualViewport,kb=vv&&vv.height<full-120;/* с клавиатурой окно остаётся на всю высоту (фон виден и за полосой «назад / вперёд / готово» над клавиатурой), поле ввода поднимается на высоту клавиатуры (--kbh) */
    const top=kb?vv.offsetTop:0,H=full-top,kbh=kb?Math.max(0,full-top-vv.height):0;sc=innerWidth/393;phone.style.width='393px';phone.style.height=H/sc+'px';phone.style.transform='scale('+sc+')';phone.style.setProperty('--sc',sc);phone.style.setProperty('--kbh',kbh/sc+'px');phone.style.left='0';phone.style.top=top+'px';return}
  sc=Math.min(f.clientWidth/453,f.clientHeight/(852+40),1.2);phone.style.transform='scale('+sc+')';phone.style.setProperty('--sc',1);phone.style.left=(f.clientWidth-393*sc)/2+'px';phone.style.top=Math.max(14,(f.clientHeight-852*sc)/2)+'px'}
addEventListener('resize',fit);
if(window.visualViewport)visualViewport.addEventListener('scroll',()=>{if(real())fit()});
if(window.visualViewport)visualViewport.addEventListener('resize',()=>{if(!real())return;const sc_=cur&&$('.scroll',cur.el),near=sc_&&sc_.scrollHeight-sc_.scrollTop-sc_.clientHeight<400;fit();scrollTo(0,0);if(near&&phone.classList.contains('kbr'))setTimeout(()=>{sc_.scrollTop=1e6},0)});
/* ---------- тост, шторки, подтверждение ---------- */
let toastT=0;
function toast(m,ic='check'){let t=$('.toast',layer);if(!t){t=document.createElement('div');t.className='toast glass-pop';layer.append(t)}
  t.innerHTML=I(ic)+esc(m);void t.offsetWidth;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),2200)}
function sheet(html,o={}){const sc_=document.createElement('div');sc_.className='scrim';const el=document.createElement('div');el.className='sheet glass-pop';
  el.innerHTML='<div class="gr"></div>'+html;layer.append(sc_,el);void el.offsetWidth;sc_.classList.add('on');el.classList.add('on');
  const close=()=>{el.classList.remove('on');sc_.classList.remove('on');setTimeout(()=>{el.remove();sc_.remove()},420);o.onClose&&o.onClose()};
  sc_.onclick=close;
  /* свайп вниз за ручку */
  let g=null;const gr=$('.gr',el);gr.style.cssText+=';cursor:grab;padding:8px 0;margin-top:-6px;background-clip:content-box;touch-action:none';
  gr.onpointerdown=e=>{g={y:e.clientY,id:e.pointerId};gr.setPointerCapture(e.pointerId);el.style.transition='none'};
  gr.onpointermove=e=>{if(!g)return;const d=Math.max(0,(e.clientY-g.y)/sc);el.style.transform='translateY('+d+'px)'};
  gr.onpointerup=e=>{if(!g)return;const d=(e.clientY-g.y)/sc;g=null;el.style.transition='';el.style.transform='';if(d>80)close()};
  el.addEventListener('click',e=>{if(e.target.closest('[data-close]'))close()});
  return{el,close}}
function confirmSheet(title,sub,label,fn,danger=true){const s=sheet(`<h3>${title}</h3>${sub?`<div class="sub">${sub}</div>`:''}<button class="abtn ${danger?'d':'pri'}" data-ok>${label}</button><button class="abtn" data-close>Отмена</button>`);
  $('[data-ok]',s.el).onclick=()=>{s.close();setTimeout(fn,200)};return s}
/* ---------- стек страниц ---------- */
const NAV=[];
function ambHtml(){return '<div class="amb"><i></i><i></i><i></i><i></i></div><i class="edge t"></i><i class="edge b"></i>'}
/* o: {title, back, right, lg, body, cls, nav (своя шапка), bottom, nobot} */
function page(o){const el=document.createElement('div');el.className='page'+(o.cls?' '+o.cls:'');
  const prev=NAV[NAV.length-1],back=o.back!==undefined?o.back:(prev&&prev.title)||'Назад';
  const nav=o.nav||`<div class="nav${o.lg?' lg':''}"><button class="nb glass gi" data-back aria-label="Назад">${I('chevLeft')}</button><div class="nt"><span class="glass">${o.title||''}</span></div><div class="nr${o.cap?' cap glass':''}">${o.right||''}</div></div>`;
  el.innerHTML=ambHtml()+nav+`<div class="scroll${o.nobot===false?'':' nobot'}">${o.lg?`<h1 class="lt">${o.title}</h1>`:''}${o.body||''}</div>${o.bottom||''}`;
  el._title=o.title||'';scrollWatch(el);return el}
function scrollWatch(el){const s=$('.scroll',el),n=$('.nav',el);if(!s||!n)return;s.addEventListener('scroll',()=>n.classList.toggle('sc',s.scrollTop>(n.classList.contains('lg')?34:6)),{passive:true})}
function push(el,title){const prev=NAV[NAV.length-1];hideKb();el.classList.add('enter');stack.append(el);NAV.push({el,title:title!==undefined?title:el._title});
  void el.offsetWidth;el.classList.remove('enter');if(prev)prev.el.classList.add('under');return el}
function pop(){if(NAV.length<2)return;hideKb();const top=NAV.pop(),under=NAV[NAV.length-1].el;top.el.classList.remove('drag');under.classList.remove('drag');void top.el.offsetWidth;
  top.el.style.transform='translateX(100%)';under.style.transform='';under.classList.remove('under');setTimeout(()=>top.el.remove(),460)}
function popToRoot(){while(NAV.length>1)pop()}
stack.addEventListener('click',e=>{if(e.target.closest('[data-back]'))pop()});
/* свайп назад от левого края */
(function(){let G=null;
  stack.addEventListener('pointerdown',e=>{if(NAV.length<2||e.target.closest('input,textarea'))return;const r=phone.getBoundingClientRect();if((e.clientX-r.left)/sc>24)return;G={x:e.clientX,y:e.clientY,id:e.pointerId,m:0,t:performance.now()}});
  stack.addEventListener('pointermove',e=>{if(!G||e.pointerId!==G.id)return;const dx=(e.clientX-G.x)/sc,dy=(e.clientY-G.y)/sc;
    if(!G.m){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;if(!(dx>0&&Math.abs(dx)>Math.abs(dy))){G=null;return}G.m=1;G.top=NAV[NAV.length-1].el;G.und=NAV[NAV.length-2].el;G.top.classList.add('drag');G.und.classList.add('drag');try{stack.setPointerCapture(e.pointerId)}catch(_){}}
    const x=Math.max(0,dx);G.top.style.transform='translateX('+x+'px)';G.und.style.transform='translateX('+(-28*(1-Math.min(1,x/393)))+'%)'});
  const end=(e,c)=>{if(!G||e.pointerId!==G.id)return;const g=G;G=null;if(!g.m)return;const dx=(e.clientX-g.x)/sc,dt=performance.now()-g.t;
    if(!c&&(dx>130||dx/dt*sc>.6)){pop();return}g.top.classList.remove('drag');g.und.classList.remove('drag');g.top.style.transform='';g.und.style.transform=''};
  stack.addEventListener('pointerup',e=>end(e,0));stack.addEventListener('pointercancel',e=>end(e,1))})();
/* долгое нажатие */
function longPress(host,sel,fn){let T=0,s=null,fired=false;
  host.addEventListener('pointerdown',e=>{const t=e.target.closest(sel);if(!t||e.button>0)return;fired=false;s={x:e.clientX,y:e.clientY};clearTimeout(T);T=setTimeout(()=>{fired=true;fn(t,e);},430)});
  host.addEventListener('pointermove',e=>{if(s&&Math.hypot(e.clientX-s.x,e.clientY-s.y)>9){clearTimeout(T);s=null}});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>host.addEventListener(ev,()=>{clearTimeout(T);s=null}));
  host.addEventListener('contextmenu',e=>{const t=e.target.closest(sel);if(t){e.preventDefault();clearTimeout(T);fired=true;fn(t,e)}});
  host.addEventListener('click',e=>{if(fired){e.stopPropagation();e.preventDefault();fired=false}},true)}
/* ---------- данные ---------- */
const CH=CHATS.map(c=>({...c}));
/* ---------- длинная история: чтобы было что прокручивать ---------- */
(function seedHistory(){
  const PH=['Доброе утро! Как продвигается задача?','Посмотрю после обеда','Скинул файлы в общую папку','Согласен, так будет проще','Давайте созвонимся в 15:00','Окей, принято','Нужна помощь с макетами?','Готово, проверяйте','Есть вопрос по срокам','Перенесли встречу на завтра','Отличная идея 👍','Подготовлю короткий отчёт','Сделаю до конца дня','Что по бюджету?','Ссылку отправил в личку','Вернусь через 10 минут','Спасибо, очень выручил!','Не получается открыть файл, пришлёшь ещё раз?','Всё работает, проблема была в кэше','Записал, учту в следующем спринте','Кто на связи по релизу?','Проверил на телефоне — выглядит хорошо','Давайте обсудим на планёрке','Внёс правки, посмотрите, пожалуйста','Длинное сообщение для проверки переноса строк: нужно, чтобы текст занимал несколько строк, а пузырёк корректно растягивался по высоте без обрезания и наползания времени','Принял, спасибо!','Согласовано','Жду ответа от заказчика','Это важно, не забудьте отметить в календаре','Пока без изменений'];
  const FILES=[['Отчёт_октябрь.pdf','212 КБ'],['Схема_процесса.png','1,4 МБ'],['Бюджет_Q4.xlsx','86 КБ']];
  const days=['Понедельник','Вторник','Среда','Вчера'];
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  Object.keys(CONVO).forEach(id=>{
    const c=CHATS.find(x=>x.id===id),dm=c&&c.k==='dm';
    const pool=dm?[c.peer,'me']:[...(MEMBERS[id]||MEMBERS.room||['anna','dmitry']),'me','me'];
    const hist=[];let last=null;
    days.forEach(d=>{
      const n=8+Math.floor(rnd()*5);let h=9,mi=3;
      for(let i=0;i<n;i++){
        mi+=2+Math.floor(rnd()*14);if(mi>=60){h++;mi-=60}
        const a=pool[Math.floor(rnd()*pool.length)],tm=('0'+h).slice(-2)+':'+('0'+mi).slice(-2),r=rnd();
        const m={a,t:PH[Math.floor(rnd()*PH.length)],tm};
        if(i===0)m.day=d;
        if(r<.08)m.re=['👍 '+(1+Math.floor(rnd()*3)),'❤️ 1'];
        else if(r<.14&&last&&last.a!==a&&a==='me')m.q=[PPL[last.a]?PPL[last.a].n:S.name.split(' ')[0],last.t.replace(/<[^>]+>/g,'').slice(0,60)];
        else if(r<.18&&a!=='me')m.file=FILES[Math.floor(rnd()*FILES.length)];
        hist.push(m);last=m;
      }
    });
    if(CONVO[id].length)CONVO[id][0].day='Сегодня';
    CONVO[id]=hist.concat(CONVO[id]);
  });
})();

const findChat=id=>CH.find(c=>c.id===id)||TOPICS.find(t=>t.id===id);
const initials=n=>n.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
/* ---------- корневая страница ---------- */
const TABS=[['chats','Чаты','chat'],['contacts','Контакты','users'],['settings','Настройки','gear']];
function buildRoot(){const el=document.createElement('div');el.className='page base';
  el.innerHTML=ambHtml()+TABS.map(([k])=>`<div class="tabview${k==='chats'?' on':''}" data-tab="${k}"></div>`).join('')+
    `<div class="tabbar glass" id="tabbar"><i class="thumb"></i>${TABS.map(([k,l,ic],i)=>`<button class="tb${i?'':' on'}" data-tab="${k}">${I(ic)}<span>${l}</span>${k==='chats'?'<b class="bd" id="chbd"></b>':''}</button>`).join('')}</div>`;
  stack.append(el);NAV.push({el,title:'Чаты'});
  $('#tabbar',el).addEventListener('click',e=>{const b=e.target.closest('.tb');if(b)setTab(b.dataset.tab)});
  renderChats();renderContacts();renderSettings();setTab('chats',true)}
function setTab(t,first){const prev=S.tab;S.tab=t;const root_=NAV[0].el;
  $$('.tb',root_).forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  const th=$('#tabbar .thumb'),b=$('.tb.on',root_);th.style.left=b.offsetLeft+'px';th.style.width=b.offsetWidth+'px';
  $$('.tabview',root_).forEach(v=>{const on=v.dataset.tab===t;v.classList.toggle('on',on);v.classList.toggle('out',!on&&TABS.findIndex(x=>x[0]===v.dataset.tab)<TABS.findIndex(x=>x[0]===t))});
  if(!first&&prev!==t)hideKb()}
function badge(){const n=CH.filter(c=>!S.muted.has(c.id)).reduce((s,c)=>s+(c.u||0),0),b=$('#chbd');if(!b)return;b.textContent=n;b.style.display=n?'':'none'}
/* ---------- вкладка «Чаты» ---------- */
const FILTERS=[['all','Все'],['new','Новые'],['dm','Личные'],['group','Группы']];
const FOLD=[['all','Все чаты','chat'],...FOLDERS.map(f=>[f.id,f.n,f.ic])];
function renderChats(){const v=$('.tabview[data-tab="chats"]');const keep=$('.scroll',v)?.scrollTop||0;
  v.innerHTML=`<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Чаты</span></div><div class="nr"><button class="nb glass gi" data-act="compose" aria-label="Новый чат">${I('edit')}</button></div></div>
  <div class="scroll"><h1 class="lt">Чаты</h1>
   <label class="srch glass">${I('search')}<input id="cq" placeholder="Поиск" autocomplete="off" value="${esc(S.q)}"></label>
   ${S.set.spaces?`<div class="chips"><button class="chip on" data-act="space">${I('grid')}${esc(S.space)}${I('chevDown')}</button></div>`:''}
   <div class="chips">${FOLD.map(([k,l,ic])=>`<button class="chip${S.folder===k?' on':''}" data-fo="${k}">${I(ic)}${l}</button>`).join('')}</div>
   <div id="clist"></div></div>`;
  paintList();$('.scroll',v).scrollTop=keep;scrollWatch(v);badge()}
function chatRow(c){const dm=c.k==='dm',pv=c.k==='group'&&c.p&&!/^Вы:/.test(c.p)&&c.who?`<i>${c.who}: </i>`:'';
  const mute=S.muted.has(c.id),pin=S.pinned.has(c.id);
  return `<button class="row${pin?' pinned':''}" data-id="${c.id}">${avHtml(c,'')}<div class="rt"><div class="r1"><b>${esc(c.n)}</b>${c.tick?`<span class="st" style="color:var(--accent-ink)">${I('checks')}</span>`:''}<span class="tm${c.u&&!mute?' new':''}">${c.t}</span></div>
   <div class="r2"><span class="pv">${pv}${esc(c.p)}</span>${mute?`<span class="st">${I('bellOff')}</span>`:''}${pin&&!c.u?`<span class="st">${I('pin')}</span>`:''}${c.u?`<span class="bd${mute?' mute':''}">${c.u}</span>`:''}</div></div></button>`}
function paintList(){const el=$('#clist');if(!el)return;const q=S.q.trim().toLowerCase();
  let rows=CH.filter(c=>(S.filter==='all'||(S.filter==='new'?c.u>0:S.filter==='dm'?c.k==='dm':c.k!=='dm'))&&(S.folder==='all'||c.f===S.folder)&&(!q||c.n.toLowerCase().includes(q)||c.p.toLowerCase().includes(q)));
  rows.sort((a,b)=>(S.pinned.has(b.id)?1:0)-(S.pinned.has(a.id)?1:0));
  const rooms=rows.filter(c=>c.k==='room'),rest=rows.filter(c=>c.k!=='room');
  el.innerHTML=(rooms.length?`<div class="gl">Комнаты</div><div class="grp glass">${rooms.map(chatRow).join('')}</div>`:'')+(rest.length?`<div class="gl">Все чаты</div><div class="grp glass">${rest.map(chatRow).join('')}</div>`:'')+
    (!rows.length?`<div class="empty"><span class="ei glass">${I('search')}</span><b>Ничего не найдено</b><span>Измените запрос или фильтр</span></div>`:'')}
function bindChats(){const v=$('.tabview[data-tab="chats"]');
  v.addEventListener('input',e=>{if(e.target.id==='cq'){S.q=e.target.value;paintList()}});
  v.addEventListener('click',e=>{
    const fo=e.target.closest('[data-fo]');if(fo){S.folder=fo.dataset.fo;$$('[data-fo]',v).forEach(b=>b.classList.toggle('on',b===fo));paintList();return}
    const a=e.target.closest('[data-act]');if(a){if(a.dataset.act==='compose')newChat();else if(a.dataset.act==='space')spaceSheet();return}
    const r=e.target.closest('.row');if(r)openChat(r.dataset.id)});
  longPress(v,'.row',(r)=>chatMenu(r))}
function spaceSheet(){const sp=['Основное','Проект Север'];const s=sheet(`<h3>Пространство</h3><div class="sub">Останутся люди и чаты из выбранного пространства</div><div class="grp glass">${sp.map(x=>`<button class="cell" data-sp="${x}"><span class="cl">${x}</span>${S.space===x?`<span class="ch" style="color:var(--accent-ink)">${I('check')}</span>`:''}</button>`).join('')}</div>`);
  s.el.onclick=e=>{const b=e.target.closest('[data-sp]');if(b){S.space=b.dataset.sp;s.close();renderChats();toast('Пространство: '+S.space,'grid')}}}
/* меню чата в списке: размытый фон, строка поднята, меню рядом */
function chatMenu(row){const c=findChat(row.dataset.id);if(!c)return;const r=rel(row),pin=S.pinned.has(c.id),mute=S.muted.has(c.id);
  const items=[{l:pin?'Открепить':'Закрепить',i:'pin',f:()=>{pin?S.pinned.delete(c.id):S.pinned.add(c.id);paintList();toast(pin?'Чат откреплён':'Чат закреплён','pin')}},
    {l:mute?'Включить звук':'Без звука',i:mute?'bell':'bellOff',f:()=>{mute?S.muted.delete(c.id):S.muted.add(c.id);paintList();badge();toast(mute?'Звук включён':'Звук выключен',mute?'bell':'bellOff')}},
    {l:'В папку…',i:'folder',f:()=>folderPick(c)},
    {l:c.u?'Прочитано':'Непрочитано',i:'checks',f:()=>{c.u=c.u?0:1;paintList();badge()}},
    {sp:1},{l:'Удалить',i:'trash',d:1,f:()=>confirmSheet('Удалить чат?','Переписка пропадёт у вас. У собеседников она останется.','Удалить',()=>{const i=CH.indexOf(c);if(i>=0)CH.splice(i,1);paintList();badge();toast('Чат удалён','trash')})}];
  overlay(row,r,items,null)}
function folderPick(c){const s=sheet(`<h3>В папку</h3><div class="sub">«${esc(c.n)}»</div><div class="grp glass">${FOLDERS.map(f=>`<button class="cell" data-fo="${f.id}"><span class="ci" style="background:${f.c}">${I(f.ic)}</span><span class="cl">${f.n}</span>${c.f===f.id?`<span class="ch" style="color:var(--accent-ink)">${I('check')}</span>`:''}</button>`).join('')}</div>`);
  s.el.onclick=e=>{const b=e.target.closest('[data-fo]');if(b){c.f=b.dataset.fo;s.close();paintList();toast('Чат в папке','folder')}}}
/* общий оверлей меню: elem — исходный элемент (копия поднимается над размытием), items — пункты, rx — быстрые реакции */
let ov=null;
function overlay(elem,r,items,rx,mine){closeOverlay();const L=document.createElement('div');L.className='cml';L.innerHTML='<div class="cmb"></div>';
  const clone=document.createElement('div');clone.className='cmc'+(elem.classList.contains('row')?' glass grp':'');clone.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;${elem.classList.contains('row')?'border-radius:26px;overflow:hidden':''}`;
  clone.innerHTML=elem.classList.contains('bub')?'<div class="mrow '+(mine?'out':'in')+'" style="margin:0">'+elem.outerHTML+'</div>':elem.outerHTML;const inner=clone.firstElementChild;if(inner)inner.style.pointerEvents='none';
  const W=393,H=phone.offsetHeight,menuW=250,mh=items.reduce((s,i)=>s+(i.sp?9:46),12),rxh=rx?52:0,gap=10;
  const chH=Math.min(r.h,320);let top=r.y;const minTop=64+rxh+gap,maxB=H-34-12;
  if(top<minTop)top=minTop;if(top+chH+gap+mh>maxB)top=maxB-mh-gap-chH;if(top<minTop)top=minTop;
  clone.style.top=top+'px';
  const mn=document.createElement('div');mn.className='cmm glass-pop';mn.innerHTML=items.map((it,i)=>it.sp?'<div class="sp"></div>':`<button class="${it.d?'d':''}" data-i="${i}"><span>${it.l}</span>${I(it.i)}</button>`).join('');
  const mL=mine?W-12-menuW:Math.min(Math.max(r.x,12),W-12-menuW);mn.style.left=mL+'px';mn.style.top=(top+chH+gap)+'px';mn.style.transformOrigin=(mine?'right':'left')+' top';
  L.append(clone);let rxe=null;
  if(rx){rxe=document.createElement('div');rxe.className='cmr glass-pop';rxe.innerHTML=rx.map(e=>`<button data-e="${e}">${e}</button>`).join('')+`<button class="more" data-more>${I('plus')}</button>`;
    rxe.style.top=(top-rxh-gap+4)+'px';rxe.style[mine?'right':'left']=(mine?12:Math.max(12,r.x))+'px';rxe.style.transformOrigin=(mine?'right':'left')+' bottom';L.append(rxe)}
  L.append(mn);layer.append(L);ov={L,items,mn,rxe,elem};void L.offsetWidth;L.classList.add('on');mn.classList.add('in');rxe&&rxe.classList.add('in');
  elem.style.visibility='hidden';const t0=performance.now();
  if(top!==r.y)clone.animate([{transform:`translateY(${r.y-top}px)`},{transform:'none'}],{duration:380,easing:'cubic-bezier(.32,.72,0,1)'});
  L.addEventListener('click',e=>{if(performance.now()-t0<350)return;const it=e.target.closest('[data-i]'),em=e.target.closest('[data-e]');const o=ov;
    if(it){const f=o.items[+it.dataset.i].f;closeOverlay();setTimeout(f,140)}else if(em){const f=o.onReact;closeOverlay();f&&f(em.dataset.e)}else if(e.target.closest('[data-more]')){closeOverlay();setTimeout(()=>emojiSheet(o.onReact),160)}else closeOverlay()});
  return ov}
function closeOverlay(){if(!ov)return;const o=ov;ov=null;o.L.classList.remove('on');o.mn.classList.remove('in');o.rxe&&o.rxe.classList.remove('in');o.elem.style.visibility='';setTimeout(()=>o.L.remove(),260)}
/* ---------- переписка ---------- */
const MS={};let mseq=0;
const QUICK=['👍','❤️','😂','😮','😢','🙏'];
function rxHtml(re){return `<div class="react">${re.map(r=>{const[x,m]=r.split('|');return `<button class="${m?'mine':''}" data-r="${x.split(' ')[0]}">${x}</button>`}).join('')}</div>`}
function bubHtml(cid,m,prev,dm,id){const plain=(m.t||m.big||'').replace(/<[^>]+>/g,'');MS[id]={cid,...m,id,text:plain};let h='';
  if(m.a==='me'){const body=m.big?`<span class="big">${m.big}</span>`:`<div class="bub">${m.q?`<div class="quote"><b>${m.q[0]}</b><span>${m.q[1]}</span></div>`:''}${m.t}<span class="t">${m.ed?'изм. ':''}${m.tm}${CHK}</span></div>`;h+=`<div class="mrow out" data-m="${id}">${body}</div>`}
  else{const p=PPL[m.a];if(prev!==m.a&&!dm)h+=`<div class="who-n" style="color:${ink(p)}">${p.n}</div>`;
    const body=m.big?`<span class="big">${m.big}</span>`:`<div class="bub">${m.pic?'<div class="pic"></div>':''}${m.file?`<div class="file"><span class="fi">${I('file')}</span><span><b>${m.file[0]}</b><small>${m.file[1]}</small></span><button class="dl glass gi" aria-label="Скачать">${I('dl')}</button></div>`:''}${m.t||''}<span class="t">${m.tm}</span></div>`;
    h+=`<div class="mrow in" data-m="${id}">${body}</div>`}
  if(m.re)h+=rxHtml(m.re);return h}
function convoHtml(cid,dm){let prev=null,h='';
  (CONVO[cid]||[]).forEach(m=>{if(m.day){h+=`<div class="day"><span class="glass">${m.day}</span></div>`;prev=null}h+=bubHtml(cid,m,prev,dm,cid+'-'+(mseq++));prev=m.a==='me'?null:m.a});return h}
let cur=null;
function openChat(id,fromRoom){const c=findChat(id);if(!c)return;if(c.k==='room'){openRoom();return}
  if(c.u){c.u=0;paintList();badge();const t=TOPICS.find(x=>x.id===id);t&&(t.u=0)}
  const dm=c.k==='dm',isTopic=!!c.who||String(c.id).startsWith('t-'),pin=c.id==='team';
  const sub=isTopic?'# тема · в сети 4 из 12':(c.sub||''),onl=/в сети/.test(sub);
  const back=NAV[NAV.length-1].title||'Чаты',n=CH.reduce((s,x)=>s+(x.u||0),0);
  const nav=`<div class="nav cn"><button class="nb glass gi" data-back aria-label="Назад">${I('chevLeft')}${n?`<span class="cnt">${n}</span>`:''}</button>
   <button class="who glass gi" data-info>${avHtml({...c,ini:isTopic?'#':c.ini,on:0,type:0},'')}<span style="min-width:0"><b>${esc(c.n)}</b><small class="${onl?'on':''}">${esc(sub)}</small></span></button>
   <div class="nr cap glass"><button data-s aria-label="Поиск">${I('search')}</button><button data-more aria-label="Ещё">${I('dots')}</button></div></div>`;
  const el=page({cls:'chat'+(pin?' pinned':''),nav,title:c.n,body:convoHtml(id,dm)+(id==='team'?'<div class="typing"><i></i><i></i><i></i>Елена печатает…</div>':''),nobot:false});
  el.dataset.cid=id;el.dataset.dm=dm?1:'';
  el.insertAdjacentHTML('beforeend',(pin?`<button class="pinbar glass gi" data-pin>${'<i class="tk"></i>'}<span class="pt"><b>Закреплённое сообщение</b><span>Макеты профиля готовы, посмотрите вариант B</span></span><span class="ibtn" style="width:32px;height:32px">${I('pin')}</span></button>`:'')+
   `<button class="jump glass gi" data-jump aria-label="Вниз">${I('down')}</button>`+composerHtml(c));
  push(el,c.n);const sc_=$('.scroll',el);requestAnimationFrame(()=>{sc_.scrollTop=1e6});bindChat(el,c);return el}
function composerHtml(c){return `<div class="comp"><button class="cbtn glass gi" data-plus aria-label="Вложение">${I('plus')}</button>
  <div class="cfield glass"><div class="cbar-wrap"></div><div class="cin"><textarea rows="1" placeholder="Сообщение" aria-label="Сообщение" enterkeyhint="send"></textarea><button class="em" data-emoji aria-label="Смайлы">${I('smile')}</button></div></div>
  <button class="sendb glass gi" data-send aria-label="Отправить">${I('mic','m')}${I('send','s')}</button></div>`}
function bindChat(el,c){const sc_=$('.scroll',el),ta=$('textarea',el),send=$('.sendb',el),jump=$('.jump',el);let ctx=null;
  const bar=()=>{const w=$('.cbar-wrap',el);w.innerHTML=ctx?`<div class="cbar"><i class="tk"></i><div class="ct"><b>${ctx.k==='edit'?'Редактирование':'Ответ: '+esc(ctx.who)}</b><span>${esc(ctx.text)}</span></div><button class="ibtn" data-cx aria-label="Отмена">${I('x')}</button></div>`:''};
  const sync=()=>{send.classList.toggle('ready',!!ta.value.trim()||ctx?.k==='edit');ta.style.height='46px';ta.style.height=Math.min(120,ta.scrollHeight)+'px'};
  ta.addEventListener('input',sync);ta.addEventListener('focus',()=>showKb(ta));
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend()}});
  const doSend=()=>{const t=ta.value.trim();if(!t&&ctx?.k!=='edit'){toast('Удерживайте для записи голосового','mic');return}
    const tm=new Date().toTimeString().slice(0,5);
    if(ctx?.k==='edit'){const m=MS[ctx.id];m.t=t;m.text=t;m.ed=1;const b=$(`[data-m="${ctx.id}"] .bub`,el);if(b){b.innerHTML=esc(t)+`<span class="t">изм. ${m.tm}${CHK}</span>`}ctx=null;bar();ta.value='';sync();toast('Сообщение изменено','pen');return}
    const m={a:'me',t:esc(t),tm,q:ctx?[ctx.who,ctx.text]:null};if(!m.q)delete m.q;const id=c.id+'-'+(mseq++);
    const ty=$('.typing',sc_);const h=document.createElement('div');h.innerHTML=bubHtml(c.id,m,null,true,id);[...h.children].forEach(x=>{ty?sc_.insertBefore(x,ty):sc_.append(x)});$(`[data-m="${id}"] .bub`,el)?.classList.add('pop');
    ctx=null;bar();ta.value='';sync();sc_.scrollTo({top:1e6,behavior:'smooth'});
    if(c.k==='dm'||Math.random()>.4)setTimeout(()=>{const who=c.k==='dm'?c.peer:'elena';const ty2=document.createElement('div');ty2.className='typing';ty2.innerHTML='<i></i><i></i><i></i>'+(PPL[who].n.split(' ')[0])+' печатает…';sc_.append(ty2);sc_.scrollTo({top:1e6,behavior:'smooth'});
      setTimeout(()=>{ty2.remove();const id2=c.id+'-'+(mseq++);const hh=document.createElement('div');hh.innerHTML=bubHtml(c.id,{a:who,t:['Принято 👍','Да, посмотрю чуть позже','Спасибо!','Хорошо, договорились'][Math.random()*4|0],tm:new Date().toTimeString().slice(0,5)},null,c.k==='dm',id2);[...hh.children].forEach(x=>sc_.append(x));$(`[data-m="${id2}"] .bub`,el)?.classList.add('pop');sc_.scrollTo({top:1e6,behavior:'smooth'})},1500)},700)};
  el._send=doSend;
  el.addEventListener('click',e=>{const t=e.target;
    if(t.closest('[data-send]')){doSend();return}
    if(t.closest('[data-cx]')){ctx=null;bar();ta.value='';sync();return}
    if(t.closest('[data-plus]')){attachSheet();return}
    if(t.closest('[data-emoji]')){emojiSheet(x=>{ta.value+=x;sync();ta.focus()});return}
    if(t.closest('[data-jump]')){sc_.scrollTo({top:1e6,behavior:'smooth'});return}
    if(t.closest('[data-pin]')){const m=$('.mrow',sc_);m.classList.add('hl');m.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>m.classList.remove('hl'),1500);return}
    if(t.closest('[data-info]')){c.k==='dm'?openProfile(c.peer):(c.who||String(c.id).startsWith('t-'))?toast('Тема комнаты «Вся компания»','hash'):openGroup(c.id);return}
    if(t.closest('[data-s]')){toast('Поиск по переписке','search');return}
    if(t.closest('[data-more]')){chatActions(c,el);return}
    const rb=t.closest('.react button');if(rb){toggleReact(rb);return}
    if(!t.closest('.comp,.kbd'))hideKb()});
  longPress(el,'.mrow',(row,e)=>msgMenu(el,row,c,{reply:m=>{ctx={k:'reply',who:m.a==='me'?S.name.split(' ')[0]:PPL[m.a].n,text:m.text};bar();sync();ta.focus()},
    edit:m=>{ctx={k:'edit',id:m.id,text:m.text};bar();ta.value=m.text;sync();ta.focus()}}));
  sc_.addEventListener('scroll',()=>jump.classList.toggle('on',sc_.scrollHeight-sc_.scrollTop-sc_.clientHeight>260),{passive:true});
  cur={el,c,ta}}
function toggleReact(b){const m=/(\S+)\s*(\d*)/.exec(b.textContent.trim());let n=+(m[2]||1);const mine=b.classList.toggle('mine');n+=mine?1:-1;if(n<=0){const w=b.parentElement;b.remove();if(!w.children.length)w.remove();return}b.textContent=m[1]+' '+n}
function addReact(row,em){let w=row.nextElementSibling;if(!w||!w.classList.contains('react')){w=document.createElement('div');w.className='react';row.after(w)}
  const ex=[...w.children].find(b=>b.dataset.r===em);if(ex){if(!ex.classList.contains('mine'))toggleReact(ex);return}
  const b=document.createElement('button');b.className='mine';b.dataset.r=em;b.textContent=em+' 1';w.append(b)}
function msgMenu(el,row,c,h){const m=MS[row.dataset.m];if(!m)return;const mine=m.a==='me',bub=$('.bub',row)||row,r=rel(bub);hideKb();
  const items=[{l:'Ответить',i:'reply',f:()=>h.reply(m)},{l:'Переслать',i:'fwd',f:()=>forwardSheet(m)},m.text&&{l:'Копировать',i:'copy',f:()=>{navigator.clipboard?.writeText(m.text).catch(()=>{});toast('Скопировано','copy')}},
    mine&&m.text&&{l:'Изменить',i:'pen',f:()=>h.edit(m)},c.id==='team'&&{l:'Закрепить',i:'pin',f:()=>toast('Сообщение закреплено','pin')},mine&&{l:'Информация',i:'eye',f:()=>readSheet(m)},
    {sp:1},mine&&{l:'Удалить',i:'trash',d:1,f:()=>confirmSheet('Удалить сообщение?','','Удалить',()=>{const nx=row.nextElementSibling;nx&&nx.classList.contains('react')&&nx.remove();row.remove();toast('Сообщение удалено','trash')})}].filter(Boolean);
  const o=overlay(bub,r,items,QUICK,mine);o.onReact=e=>addReact(row,e);try{navigator.vibrate&&navigator.vibrate(10)}catch(_){}}
function emojiSheet(fn){const E='😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 😘 😎 🤔 😐 😢 😭 😡 👍 👎 👏 🙏 💪 🔥 ❤️ 💔 🎉 ✨ 🍕 ☕ 🚀 👀 ✅ ❌ ⭐ 🌈 🐱 🐶 🌟 💡'.split(' ');
  const s=sheet(`<h3>Смайлы</h3><div class="sb" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:6px 0;font-size:26px;text-align:center">${E.map(e=>`<button data-e="${e}" style="height:44px;border-radius:12px">${e}</button>`).join('')}</div>`);
  s.el.onclick=e=>{const b=e.target.closest('[data-e]');if(b){fn&&fn(b.dataset.e);s.close()}}}
function attachSheet(){const s=sheet(`<h3>Вложение</h3><div class="atiles">${[['image','Фото','#5b8def'],['file','Файл','#34c759'],['bold','Формат','#af52de'],['mic','Голос','#ff9500']].map(([ic,l,bg])=>`<button class="atile" data-a="${l}"><span class="ic" style="background:${bg}">${I(ic)}</span>${l}</button>`).join('')}</div><button class="abtn" data-close>Отмена</button>`);
  s.el.addEventListener('click',e=>{const a=e.target.closest('[data-a]');if(a){s.close();toast(a.dataset.a==='Формат'?'Панель форматирования':'Выберите: '+a.dataset.a.toLowerCase(),'clip')}})}
function forwardSheet(m){const sel=new Set();const s=sheet(`<h3>Переслать</h3><div class="sb"><div class="grp glass">${CH.filter(x=>x.k!=='room').map(x=>`<button class="mini" data-id="${x.id}">${avHtml(x,'')}<span class="rt"><b>${esc(x.n)}</b></span><span class="ck">${I('check')}</span></button>`).join('')}</div></div><button class="abtn pri" data-go disabled>Переслать</button>`);
  s.el.addEventListener('click',e=>{const r=e.target.closest('.mini');if(r){const id=r.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);r.classList.toggle('on');const g=$('[data-go]',s.el);g.disabled=!sel.size;g.textContent=sel.size?'Переслать ('+sel.size+')':'Переслать';return}
    if(e.target.closest('[data-go]')){s.close();toast('Переслано: '+sel.size,'fwd')}})}
function readSheet(m){sheet(`<h3>Информация</h3><div class="sub">Сообщение отправлено в ${m.tm}</div><div class="grp glass"><div class="mini">${avHtml(PPL.dmitry,'')}<span class="rt"><b>Дмитрий Соколов</b><small>Прочитано в ${m.tm.replace(/:(\d\d)/,(x,mm)=>':'+('0'+((+mm+3)%60)).slice(-2))}</small></span></div><div class="mini">${avHtml(PPL.elena,'')}<span class="rt"><b>Елена Миронова</b><small>Доставлено</small></span></div></div><button class="abtn" data-close>Закрыть</button>`)}
function chatActions(c,el){const items=[['search','Поиск по переписке',()=>toast('Поиск по переписке','search')],['image','Медиа, файлы и ссылки',()=>openMedia(c)],[S.muted.has(c.id)?'bell':'bellOff',S.muted.has(c.id)?'Включить звук':'Без звука',()=>{S.muted.has(c.id)?S.muted.delete(c.id):S.muted.add(c.id);paintList();toast('Готово','check')}],['trash','Очистить историю',()=>confirmSheet('Очистить историю?','Сообщения исчезнут только у вас.','Очистить',()=>{$$('.mrow,.react,.who-n',$('.scroll',el)).forEach(x=>x.remove());toast('История очищена','trash')})]];
  const s=sheet(`<h3>${esc(c.n)}</h3><div class="grp glass" style="margin-top:10px">${items.map((x,i)=>`<button class="cell" data-i="${i}"><span class="ci" style="background:var(--accent)">${I(x[0])}</span><span class="cl">${x[1]}</span></button>`).join('')}</div><button class="abtn" data-close>Отмена</button>`);
  s.el.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b){s.close();setTimeout(items[+b.dataset.i][2],200)}})}
/* ---------- клавиатура (имитация) ---------- */
const KR=['йцукенгшщзхъ','фывапролджэ','ячсмитьбю'];
function showKb(ta){if(real()){const sc_=$('.scroll',cur.el),near=sc_.scrollHeight-sc_.scrollTop-sc_.clientHeight<400;phone.classList.add('kbr');if(near){sc_.scrollTop=1e6;setTimeout(()=>{sc_.scrollTop=1e6},350)}return}
  if(!$('.kbd',phone)){const k=document.createElement('div');k.className='kbd';
    k.innerHTML=KR.map((r,i)=>`<div class="kr">${i===2?'<button class="w" data-k="shift">⇧</button>':''}${[...r].map(ch=>`<button data-k="${ch}">${ch}</button>`).join('')}${i===2?'<button class="w" data-k="del">⌫</button>':''}</div>`).join('')+'<div class="kr last"><button class="n" data-k="num">123</button><button class="sp" data-k=" ">пробел</button><button class="go" data-k="go">Отправить</button></div>';
    k.addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault()});
    k.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!cur)return;const t=cur.ta,v=b.dataset.k;if(v==='go'){cur.el._send();return}if(v==='del'){t.value=t.value.slice(0,-1)}else if(v==='shift'||v==='num'){return}else t.value+=v;t.dispatchEvent(new Event('input'))});
    phone.append(k)}
  {const s=$('.scroll',cur.el),near=s.scrollHeight-s.scrollTop-s.clientHeight<400;phone.classList.add('kb');if(near){s.scrollTop=1e6;setTimeout(()=>{s.scrollTop=1e6},360)}}}
function hideKb(){phone.classList.remove('kb','kbr');document.activeElement&&document.activeElement.blur&&document.activeElement.blur()}
/* ---------- комната с темами ---------- */
function openRoom(){const rows=TOPICS.map(t=>`<button class="row" data-id="${t.id}">${avHtml({...t,ini:'#'},'sq')}<div class="rt"><div class="r1"><b>${t.n}</b><span class="tm${t.u?' new':''}">${t.t}</span></div><div class="r2"><span class="pv"><i>${t.who}: </i>${esc(t.p)}</span>${t.at?`<span class="st" style="color:#ff9500">${I('bell')}</span>`:''}${t.u?`<span class="bd">${t.u}</span>`:''}</div></div></button>`).join('');
  const el=page({title:'Вся компания',back:'Чаты',cap:1,right:`<button data-i aria-label="О комнате">${I('info')}</button>`,body:`<div class="hero" style="padding-bottom:10px"><div style="margin-bottom:6px">${avHtml(CH[0],'')}</div><p>Комната · ${TOPICS.length} тем · в сети 4 из 12</p></div><div class="gl">Темы</div><div class="grp glass">${rows}</div>`});
  el.addEventListener('click',e=>{const r=e.target.closest('.row');if(r){openChat(r.dataset.id);return}if(e.target.closest('[data-i]'))openGroup('room')});
  longPress(el,'.row',r=>toast('Тема: '+findChat(r.dataset.id).n,'hash'));push(el,'Вся компания');$$('.hero .av',el).forEach(a=>{a.style.cssText='width:84px;height:84px;font-size:30px'})}
/* ---------- вкладка «Контакты» ---------- */
function renderContacts(){const v=$('.tabview[data-tab="contacts"]');const q=(S.cq||'').toLowerCase();
  const ks=Object.keys(PPL).filter(k=>!q||PPL[k].n.toLowerCase().includes(q)||PPL[k].login.includes(q)).sort((a,b)=>PPL[a].n.localeCompare(PPL[b].n,'ru'));let last='',h='';
  ks.forEach(k=>{const p=PPL[k],l=p.n[0];if(l!==last){h+=(last?'</div>':'')+`<div class="gl">${l}</div><div class="grp glass">`;last=l}
    h+=`<button class="row" data-k="${k}">${avHtml({...p,ini:p.ini},'')}<div class="rt"><div class="r1"><b>${p.n}</b>${p.tag?`<span class="pill-tag" ${tagColor(p)}>${p.tag}</span>`:''}</div><div class="r2"><span class="pv" style="${p.on?'color:var(--accent-ink)':''}">${p.on?'в сети':p.st||'был(а) недавно'}</span></div></div></button>`});
  v.innerHTML=`<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Контакты</span></div><div class="nr"><button class="nb glass gi" data-act="add" aria-label="Добавить контакт">${I('userPlus')}</button></div></div>
   <div class="scroll"><h1 class="lt">Контакты</h1><label class="srch glass">${I('search')}<input id="kq" placeholder="Поиск контактов" autocomplete="off" value="${esc(S.cq||'')}"></label>${h?h+'</div>':'<div class="empty"><span class="ei glass">'+I('users')+'</span><b>Никого не найдено</b></div>'}</div>`;
  scrollWatch(v);const inp=$('#kq',v);if(inp&&S.cqFocus){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length)}}
function bindContacts(){const v=$('.tabview[data-tab="contacts"]');
  v.addEventListener('input',e=>{if(e.target.id==='kq'){S.cq=e.target.value;S.cqFocus=1;renderContacts();S.cqFocus=0}});
  v.addEventListener('click',e=>{if(e.target.closest('[data-act="add"]')){addContact();return}const r=e.target.closest('.row');if(r)openProfile(r.dataset.k)})}
function addContact(){const s=sheet(`<h3>Добавить контакт</h3><div class="sub">Логин человека на вашем сервере или адрес с другого: @сервер:логин</div><label class="fld m glass-inset">${I('user')}<input id="ac" placeholder="Логин" autocomplete="off"></label><button class="abtn pri" data-go disabled>Найти</button>`);
  const i=$('#ac',s.el),g=$('[data-go]',s.el);i.oninput=()=>g.disabled=!i.value.trim();g.onclick=()=>{s.close();toast('Запрос отправлен: '+i.value.trim(),'userPlus')};setTimeout(()=>i.focus(),500)}
/* ---------- профиль человека и группы ---------- */
function openProfile(k){const p=PPL[k];if(!p)return;const groups=CH.filter(c=>c.k!=='dm'&&(MEMBERS[c.id]||[]).includes(k)),dm=CH.find(c=>c.peer===k),inC=S.contacts.has(k),bl=S.blocked.includes(k);
  const body=`<div class="hero">${avHtml({...p,on:p.on},'')}<h2>${p.n}</h2><p class="${p.on?'on':''}">${p.on?'в сети':p.st||'был(а) недавно'}</p>${p.tag?`<span class="pill-tag" style="margin-top:6px;${'color:'+ink(p).replace('rgb(var(--tag','rgb(var(--tag')}">${p.tag}</span>`:''}</div>
   <div class="tiles"><button class="tile glass gi" data-w>${I('chat')}Написать</button><button class="tile glass gi" data-m>${I(dm&&S.muted.has(dm.id)?'bellOff':'bell')}Звук</button><button class="tile glass gi" data-s>${I('search')}Поиск</button></div>
   <div class="grp glass"><button class="cell" data-cp="@${p.login}"><span class="cl">Логин</span><span class="cv">@${p.login}</span><span class="ch">${I('copy')}</span></button><div class="cell"><span class="cl">Пространство</span><span class="cv">${p.ws}</span></div><div class="cell"><span class="cl">В ваших контактах</span><span class="cv">${inC?'Да':'Нет'}</span></div></div>
   ${dm?`<button class="cell glass" style="border-radius:var(--r-card);margin-bottom:16px" data-media><span class="ci" style="background:#5b8def">${I('image')}</span><span class="cl">Медиа, файлы и ссылки</span><span class="ch">${I('chevRight')}</span></button>`:''}
   ${groups.length?`<div class="gl">Общие группы · ${groups.length}</div><div class="grp glass">${groups.map(g=>`<button class="mini" data-g="${g.id}">${avHtml({...g,type:0},'')}<span class="rt"><b>${esc(g.n)}</b><small>${g.k==='room'?'Комната':'Группа'} · ${(MEMBERS[g.id]||[]).length+1} уч.</small></span><span class="ch">${I('chevRight')}</span></button>`).join('')}</div>`:''}
   <div class="grp glass"><button class="cell" data-bl><span class="cl red">${bl?'Разблокировать':'Заблокировать'}</span></button></div>`;
  const el=page({title:p.n,body,back:NAV[NAV.length-1].title});
  el.addEventListener('click',e=>{const t=e.target;
    if(t.closest('[data-w]')){const c=dm||{id:'dm-'+k,k:'dm',n:p.n,bg:p.bg,ini:p.ini,on:p.on,sub:p.on?'в сети':p.st||'',peer:k,p:'',t:'',f:'people'};if(!dm){CH.unshift(c);CONVO[c.id]=[];paintList()}openChat(c.id);return}
    if(t.closest('[data-m]')){if(dm){S.muted.has(dm.id)?S.muted.delete(dm.id):S.muted.add(dm.id);paintList();toast(S.muted.has(dm.id)?'Звук выключен':'Звук включён','bell');$('[data-m]',el).innerHTML=I(S.muted.has(dm.id)?'bellOff':'bell')+'Звук'}else toast('Нет личного чата','bell');return}
    if(t.closest('[data-s]')){toast('Поиск по переписке','search');return}
    const cp=t.closest('[data-cp]');if(cp){navigator.clipboard?.writeText(cp.dataset.cp).catch(()=>{});toast('Скопировано: '+cp.dataset.cp,'copy');return}
    if(t.closest('[data-media]')){openMedia(dm);return}
    const g=t.closest('[data-g]');if(g){openChat(g.dataset.g);return}
    if(t.closest('[data-bl]')){bl?(S.blocked=S.blocked.filter(x=>x!==k),toast('Разблокирован','unban')):confirmSheet('Заблокировать '+p.n.split(' ')[0]+'?','Человек не сможет писать вам в личные сообщения. Общие группы остаются.','Заблокировать',()=>{S.blocked.push(k);toast('Заблокирован','ban');renderSettings()})}});
  push(el,p.n)}
function openGroup(id){const c=findChat(id);if(!c)return;const mem=MEMBERS[id]||[];
  const body=`<div class="hero">${avHtml({...c,type:0},'')}<h2>${esc(c.n)}</h2><p>${c.k==='room'?'Комната':'Группа'} · ${mem.length+1} участников · ${c.sub?c.sub.replace(/^.*?в сети/,'в сети'):''}</p></div>
   <div class="tiles"><button class="tile glass gi" data-m>${I('bell')}Звук</button><button class="tile glass gi" data-s>${I('search')}Поиск</button><button class="tile glass gi" data-media>${I('image')}Медиа</button></div>
   <div class="gl">Участники · ${mem.length+1}</div><div class="grp glass"><div class="mini">${avHtml({bg:'#f6a35a,#e0507a',ini:'МИ'},'')}<span class="rt"><b>${S.name} (вы)</b><small>в сети</small></span><span class="pill-tag" style="color:var(--accent-ink)">админ</span></div>
   ${mem.map(k=>{const p=PPL[k];return `<button class="mini" data-k="${k}">${avHtml(p,'')}<span class="rt"><b>${p.n}</b><small>${p.on?'в сети':p.st||'был(а) недавно'}</small></span>${p.tag?`<span class="pill-tag" ${tagColor(p)}>${p.tag}</span>`:''}</button>`}).join('')}
   <button class="mini" data-add><span class="ci" style="background:var(--accent)">${I('userPlus')}</span><span class="rt"><b style="color:var(--accent-ink)">Добавить участников</b></span></button></div>
   <div class="grp glass"><button class="cell" data-leave><span class="cl red">Покинуть ${c.k==='room'?'комнату':'группу'}</span></button></div>`;
  const el=page({title:c.n,body,back:NAV[NAV.length-1].title,cap:1,right:`<button data-ed aria-label="Изменить">${I('pen')}</button>`});
  el.addEventListener('click',e=>{const t=e.target,k=t.closest('[data-k]');if(k){openProfile(k.dataset.k);return}
    if(t.closest('[data-media]')){openMedia(c);return}if(t.closest('[data-m]')||t.closest('[data-s]')||t.closest('[data-add]')||t.closest('[data-ed]')){toast(t.closest('[data-add]')?'Выберите людей':'Готово','check');return}
    if(t.closest('[data-leave]'))confirmSheet('Покинуть группу?','Вы перестанете получать сообщения из этого чата.','Покинуть',()=>{toast('Вы вышли из группы','logout')})});
  push(el,c.n)}
function openMedia(c){let tab='ph';const draw=()=>{const g=$('#mc',el);
    g.innerHTML=tab==='ph'?`<div class="mgrid glass">${Array.from({length:18},(_,i)=>`<i style="--a:${i*37}deg" data-ph></i>`).join('')}</div>`:
     tab==='fl'?`<div class="grp glass">${[['Roadmap_Q4.pdf','184 КБ · 12 окт'],['Release_notes_2.4.pdf','96 КБ · 9 окт'],['Макет_v3.fig','4,2 МБ · 4 окт'],['Бюджет.xlsx','58 КБ · 28 сен']].map(f=>`<button class="mini"><span class="fi ci" style="background:var(--accent);width:40px;height:40px;border-radius:12px;font-size:20px">${I('file')}</span><span class="rt"><b>${f[0]}</b><small>${f[1]}</small></span><span class="ch">${I('dl')}</span></button>`).join('')}</div>`:
     `<div class="grp glass">${[['Дорожная карта — Notion','notion.so/roadmap-q4'],['Демо анимации','example.com/demo'],['Гайд по стилю','style.example.com']].map(f=>`<button class="mini"><span class="ci" style="background:#5b8def;width:40px;height:40px;border-radius:12px">${I('link')}</span><span class="rt"><b>${f[0]}</b><small>${f[1]}</small></span></button>`).join('')}</div>`};
  const el=page({title:'Медиа',back:NAV[NAV.length-1].title,body:`<div class="seg f" id="mseg" style="margin-top:4px"><i class="thumb"></i><button class="on" data-t="ph">Фото</button><button data-t="fl">Файлы</button><button data-t="ln">Ссылки</button></div><div id="mc"></div>`});
  push(el,'Медиа');draw();setTimeout(()=>segMove($('#mseg',el)),450);
  el.addEventListener('click',e=>{const b=e.target.closest('#mseg button');if(b){tab=b.dataset.t;$$('#mseg button',el).forEach(x=>x.classList.toggle('on',x===b));segMove($('#mseg',el));draw();return}
    if(e.target.closest('[data-ph]')){const lb=document.createElement('div');lb.className='lb';lb.innerHTML='<i></i>';lb.onclick=()=>{lb.classList.remove('on');setTimeout(()=>lb.remove(),250)};layer.append(lb);void lb.offsetWidth;lb.classList.add('on')}})}
/* ---------- новый чат ---------- */
function newChat(){const rows=Object.keys(PPL).map(k=>`<button class="mini" data-k="${k}">${avHtml(PPL[k],'')}<span class="rt"><b>${PPL[k].n}</b><small>${PPL[k].on?'в сети':PPL[k].st||''}</small></span></button>`).join('');
  const el=page({title:'Новый чат',back:'Чаты',body:`<div class="grp glass"><button class="cell" data-group><span class="ci" style="background:var(--accent)">${I('users')}</span><span class="cl">Новая группа</span><span class="ch">${I('chevRight')}</span></button><button class="cell" data-addc><span class="ci" style="background:#5b8def">${I('userPlus')}</span><span class="cl">Добавить контакт</span><span class="ch">${I('chevRight')}</span></button></div><div class="gl">Люди</div><div class="grp glass">${rows}</div>`});
  el.addEventListener('click',e=>{const k=e.target.closest('[data-k]');if(k){const p=PPL[k.dataset.k];let c=CH.find(x=>x.peer===k.dataset.k);if(!c){c={id:'dm-'+k.dataset.k,k:'dm',n:p.n,bg:p.bg,ini:p.ini,on:p.on,sub:p.on?'в сети':p.st||'',peer:k.dataset.k,p:'',t:'',f:'people'};CH.unshift(c);CONVO[c.id]=[];paintList()}
      popToRoot();setTimeout(()=>openChat(c.id),30);return}
    if(e.target.closest('[data-group]'))newGroup();else if(e.target.closest('[data-addc]'))addContact()});push(el,'Новый чат')}
function newGroup(){const sel=new Set();const rows=Object.keys(PPL).map(k=>`<button class="mini" data-k="${k}">${avHtml(PPL[k],'')}<span class="rt"><b>${PPL[k].n}</b><small>${PPL[k].ws}</small></span><span class="ck">${I('check')}</span></button>`).join('');
  const el=page({title:'Новая группа',back:'Назад',right:`<button class="nb glass gi t" data-mk disabled style="opacity:.5">Создать</button>`,body:`<label class="fld m glass-inset">${I('users')}<input id="gn" placeholder="Название группы" autocomplete="off"></label><div class="gl" style="margin-top:10px">Участники</div><div class="grp glass">${rows}</div>`});
  const chk=()=>{const b=$('[data-mk]',el),ok=$('#gn',el).value.trim()&&sel.size;b.disabled=!ok;b.style.opacity=ok?1:.5};
  el.addEventListener('input',chk);el.addEventListener('click',e=>{const r=e.target.closest('.mini');if(r){const k=r.dataset.k;sel.has(k)?sel.delete(k):sel.add(k);r.classList.toggle('on');chk();return}
    const m=e.target.closest('[data-mk]');if(m&&!m.disabled){const n=$('#gn',el).value.trim(),id='g'+Date.now();CH.unshift({id,k:'group',n,bg:'#19b394,#0b7e6c',ini:initials(n),type:1,p:'Группа создана',t:'сейчас',sub:'в сети 1 из '+(sel.size+1),f:'work'});CONVO[id]=[];MEMBERS[id]=[...sel];paintList();popToRoot();toast('Группа создана','users');setTimeout(()=>openChat(id),60)}});push(el,'Новая группа')}
/* ---------- вкладка «Настройки» ---------- */
const cellS=(act,ic,bg,l,val,red)=>`<button class="cell" data-s="${act}"><span class="ci" style="background:${bg}">${I(ic)}</span><span class="cl${red?' red':''}">${l}</span>${val?`<span class="cv">${val}</span>`:''}${red?'':`<span class="ch">${I('chevRight')}</span>`}</button>`;
const tgS=(k,on)=>`<button class="tg" data-tg="${k}" role="switch" aria-checked="${!!on}"></button>`;
function renderSettings(){const v=$('.tabview[data-tab="settings"]');const mods=Object.values(S.set.mods).filter(Boolean).length;
  v.innerHTML=`<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Настройки</span></div><div class="nr"></div></div>
  <div class="scroll"><h1 class="lt">Настройки</h1>
   <div class="grp glass"><button class="prow" data-s="me">${avHtml({bg:'#f6a35a,#e0507a',ini:initials(S.name)},'')}<div style="flex:1;min-width:0"><b>${esc(S.name)}</b><span>@admin</span></div><span class="ch" style="color:var(--muted)">${I('chevRight')}</span></button></div>
   <div class="grp glass">${cellS('appearance','palette','#af52de','Внешний вид',{light:'Светлая',dark:'Тёмная',navy:'Тёмно-синяя'}[S.theme])}${cellS('notif','bell','#ff3b30','Уведомления',S.set.sound?'Включены':'Выключены')}${cellS('modules','puzzle','#34c759','Модули',mods||'')}${cellS('folders','folder','#ff9500','Папки',FOLDERS.length)}</div>
   <div class="grp glass"><div class="cell"><span class="cl">Отображать пространства</span>${tgS('spaces',S.set.spaces)}</div></div><div class="gf">Включите, чтобы выбирать пространство над списком чатов: останутся люди и чаты из него.</div>
   <div class="grp glass">${cellS('blocks','ban','#8e8e93','Блокировки',S.blocked.length||'')}${cellS('diag','gear','#5e6ad2','Диагностика')}</div>
   <div class="grp glass">${cellS('logout','logout','#ff3b30','Выйти','',1)}</div><div class="gf" style="text-align:center;margin-top:-8px">Версия 2.23.2</div><div class="mcopy">w/ <span style="color:var(--danger)">♥</span> by bolgov0zero</div></div>`;scrollWatch(v)}
function bindSettings(){const v=$('.tabview[data-tab="settings"]');
  v.addEventListener('click',e=>{const t=e.target.closest('[data-tg]');if(t){const on=t.getAttribute('aria-checked')!=='true';t.setAttribute('aria-checked',on);S.set[t.dataset.tg]=on;if(t.dataset.tg==='spaces')renderChats();return}
    const b=e.target.closest('[data-s]');if(!b)return;const a=b.dataset.s;({me:openMe,appearance:openAppearance,notif:openNotif,modules:openModules,folders:openFolders,blocks:openBlocks,diag:openDiag,logout:()=>confirmSheet('Выйти из аккаунта?','','Выйти',()=>toast('Выход (в макете не выполняется)','logout'))})[a]()})}
const setPage=(title,body,cap)=>{const el=page({title,body,back:'Настройки'});push(el,title);el.addEventListener('click',e=>{const t=e.target.closest('[data-tg]');if(t){const on=t.getAttribute('aria-checked')!=='true';t.setAttribute('aria-checked',on);const k=t.dataset.tg;
      if(k.startsWith('mod-'))S.set.mods[k.slice(4)]=on;else if(k==='amb'){S.set.amb=on;phone.classList.toggle('noamb',!on)}else if(k==='quiet'){S.set.quiet=on;const q=$('#qh',el);q&&(q.style.display=on?'':'none')}else S.set[k]=on;renderSettings()}});return el};
function openMe(){const el=setPage('Профиль',`<div class="hero">${avHtml({bg:'#f6a35a,#e0507a',ini:initials(S.name)},'')}<h2>${esc(S.name)}</h2><p>@admin</p><span class="pill-tag" style="color:var(--accent-ink);margin-top:6px">Админ</span></div>
  <div class="gl">Ссылка на профиль</div>${[['Внутренняя','@admin'],['Внешняя','@electron:admin']].map(([k,v])=>`<button class="pl" data-cp="${v}"><span class="k">${k}</span><span class="v">${v}</span><span class="ic">${I('copy')}</span></button>`).join('')}
  <div class="gl" style="margin-top:12px">Имя</div><label class="fld m glass-inset"><input id="nm" value="${esc(S.name)}" maxlength="40" aria-label="Имя"><span class="cnt">${S.name.length}/40</span></label><button class="abtn pri" id="nsv" disabled style="margin-bottom:16px">Сохранить</button>
  <div class="grp glass"><button class="cell" data-pw><span class="ci" style="background:#5e6ad2">${I('lock')}</span><span class="cl">Сменить пароль</span><span class="ch">${I('chevRight')}</span></button></div>`);
  const i=$('#nm',el),b=$('#nsv',el);i.oninput=()=>{b.disabled=!i.value.trim()||i.value.trim()===S.name;$('.cnt',el).textContent=i.value.length+'/40'};
  b.onclick=()=>{S.name=i.value.trim();b.disabled=true;renderSettings();toast('Имя сохранено','check')};
  el.addEventListener('click',e=>{const c=e.target.closest('[data-cp]');if(c){toast('Скопировано: '+c.dataset.cp,'copy');return}if(e.target.closest('[data-pw]')){const s=sheet(`<h3>Смена пароля</h3><label class="fld m glass-inset">${I('lock')}<input type="password" placeholder="Текущий пароль"></label><label class="fld m glass-inset">${I('lock')}<input type="password" placeholder="Новый пароль"></label><label class="fld m glass-inset">${I('lock')}<input type="password" placeholder="Повторите пароль"></label><button class="abtn pri" data-ok>Сохранить пароль</button>`);$('[data-ok]',s.el).onclick=()=>{s.close();toast('Пароль изменён','lock')}}})}
function openAppearance(){const el=setPage('Внешний вид',`<div class="pvw"><div class="m a">Созвон переносим на 15:30</div><div class="m b">Отлично, успеваю</div></div>
  <div class="gl">Тема и цвет</div><div class="grp glass"><div class="cell" style="flex-direction:column;align-items:stretch"><div class="seg f" id="tseg" style="margin:0"><i class="thumb"></i>${[['light','Светлая'],['dark','Тёмная'],['navy','Синяя']].map(([k,l])=>`<button class="${S.theme===k?'on':''}" data-t="${k}">${l}</button>`).join('')}</div></div>
   <div class="cell"><span class="cl">Цвет акцента</span><div class="dots">${Object.entries(ACC).map(([k,a])=>`<button class="dot2${S.acc===k?' on':''}" data-a="${k}" aria-label="${a[0]}" style="--dot:rgb(${root.classList.contains('dark')?a[2]:a[1]})"></button>`).join('')}</div></div>
   <div class="cell"><span class="cl">Прозрачность</span><input class="rng" type="range" min="0" max="100" value="${S.set.tr}" style="--v:${S.set.tr}%" aria-label="Прозрачность стекла"></div></div>
  <div class="gl">Фон</div><div class="grp glass"><div class="cell"><span class="cl">Цветная картинка</span>${tgS('amb',S.set.amb)}</div><div class="pcards">${[['none','Без узора'],['dots','Точки']].map(([k,l])=>`<button class="pcard${S.set.pattern===k?' on':''}" data-p="${k}"><i></i><span>${l}</span></button>`).join('')}</div></div><div class="gf">Узор рисуется поверх фона переписки и с цветной картинкой не связан.</div>
  <div class="gl">Текст</div><div class="grp glass"><div class="cell" style="flex-direction:column;align-items:stretch"><div class="seg f" id="fsg" style="margin:0"><i class="thumb"></i>${[[.9,'Мелкий'],[1,'Обычный'],[1.12,'Крупный']].map(([k,l])=>`<button class="${S.set.fs===k?'on':''}" data-fs="${k}">${l}</button>`).join('')}</div></div></div>`);
  setTimeout(()=>{segMove($('#tseg',el));segMove($('#fsg',el))},460);
  el.addEventListener('click',e=>{const t=e.target.closest('[data-t]');if(t){$$('#tseg button',el).forEach(b=>b.classList.toggle('on',b===t));segMove($('#tseg',el));setTheme(t.dataset.t);renderSettings();return}
    const a=e.target.closest('[data-a]');if(a){S.acc=a.dataset.a;applyAccent();$$('.dot2',el).forEach(d=>d.classList.toggle('on',d===a));return}
    const p=e.target.closest('[data-p]');if(p){S.set.pattern=p.dataset.p;phone.classList.toggle('pat',p.dataset.p==='dots');$$('.pcard',el).forEach(c=>c.classList.toggle('on',c===p));return}
    const f=e.target.closest('[data-fs]');if(f){S.set.fs=+f.dataset.fs;phone.style.setProperty('--fs',S.set.fs);$$('#fsg button',el).forEach(b=>b.classList.toggle('on',b===f));segMove($('#fsg',el))}});
  $('.rng',el).oninput=e=>{const v=+e.target.value;S.set.tr=v;e.target.style.setProperty('--v',v+'%');root.style.setProperty('--gl-k',Math.max(.15,1.9-.018*v).toFixed(3))}}
function openNotif(){setPage('Уведомления',`<div class="grp glass"><div class="cell"><span class="cl">Звук сообщений</span>${tgS('sound',S.set.sound)}</div><div class="cell"><span class="cl">Показывать текст сообщения</span>${tgS('text',S.set.text)}</div></div><div class="gf">Выключите показ текста, если телефон лежит на виду: в уведомлении будет только «Новое сообщение».</div>
  <div class="grp glass"><div class="cell"><span class="cl">Тихие часы</span>${tgS('quiet',S.set.quiet)}</div><div class="cell" id="qh" style="${S.set.quiet?'':'display:none'}"><span class="cl">С 22:00 до 08:00</span><span class="cv">изменить</span></div></div><div class="gf">В выбранные часы уведомлений и звука нет, сообщения никуда не пропадают.</div>`)}
function openModules(){setPage('Модули',`<div class="grp glass"><div class="cell"><span class="ci" style="background:#ff9500">${I('smile')}</span><span class="cl">GIF-поиск</span>${tgS('mod-gif',S.set.mods.gif)}</div><div class="cell"><span class="ci" style="background:#5b8def">${I('chat')}</span><span class="cl">Опросы</span>${tgS('mod-poll',S.set.mods.poll)}</div></div><div class="gf">Модули подгружаются при первом включении.</div>`)}
function openFolders(){const draw=()=>FOLDERS.map(f=>`<button class="cell" data-f="${f.id}"><span class="fic" style="--fc:${f.c};width:36px;height:36px;border-radius:12px;font-size:19px">${I(f.ic)}</span><span class="cl">${f.n}</span><span class="cv">${CH.filter(c=>c.f===f.id).length}</span><span class="ch">${I('chevRight')}</span></button>`).join('');
  const el=setPage('Папки',`<div class="grp glass" id="fl">${draw()}</div><button class="abtn pri" data-new>${I('plus')}Новая папка</button><div class="gf" style="margin-top:12px">Папки показываются чипами над списком чатов.</div>`);
  el.addEventListener('click',e=>{const f=e.target.closest('[data-f]'),n=e.target.closest('[data-new]');if(!f&&!n)return;const fo=f?FOLDERS.find(x=>x.id===f.dataset.f):null;
    const COL=['#4b8df0','#19b394','#d0566a','#e8571f','#7bc04a','#b06af0'];let col=fo?fo.c:COL[0];
    const s=sheet(`<h3>${fo?'Изменить папку':'Новая папка'}</h3><div class="fedit"><span class="fic" id="fp" style="--fc:${col}">${I(fo?fo.ic:'folder')}</span><label class="fld glass-inset" style="flex:1"><input id="fn" placeholder="Название папки" value="${fo?esc(fo.n):''}" maxlength="30"></label></div><div class="fcols">${COL.map(c=>`<button style="--fc:${c}" class="${c===col?'on':''}" data-c="${c}" aria-label="Цвет"></button>`).join('')}</div><button class="abtn pri" data-ok>${fo?'Сохранить':'Создать'}</button>${fo?'<button class="abtn d" data-del>Удалить папку</button>':''}`);
    s.el.addEventListener('click',ev=>{const c=ev.target.closest('[data-c]');if(c){col=c.dataset.c;$$('.fcols button',s.el).forEach(b=>b.classList.toggle('on',b===c));$('#fp',s.el).style.setProperty('--fc',col);return}
      if(ev.target.closest('[data-ok]')){const name=$('#fn',s.el).value.trim();if(!name)return;if(fo){fo.n=name;fo.c=col}else FOLDERS.push({id:'f'+Date.now(),n:name,c:col,ic:'folder'});s.close();FOLD.length=0;FOLD.push(['all','Все чаты','chat'],...FOLDERS.map(x=>[x.id,x.n,x.ic]));$('#fl',el).innerHTML=draw();renderChats();renderSettings();toast('Готово','folder')}
      if(ev.target.closest('[data-del]')){s.close();FOLDERS.splice(FOLDERS.indexOf(fo),1);FOLD.length=0;FOLD.push(['all','Все чаты','chat'],...FOLDERS.map(x=>[x.id,x.n,x.ic]));$('#fl',el).innerHTML=draw();S.folder='all';renderChats();renderSettings();toast('Папка удалена','trash')}})})}
function openBlocks(){const draw=()=>S.blocked.length?`<div class="grp glass">${S.blocked.map(k=>`<div class="mini">${avHtml(PPL[k],'')}<span class="rt"><b>${PPL[k].n}</b><small>@${PPL[k].login}</small></span><button class="btn" data-u="${k}" style="height:34px;padding:0 14px">Разблокировать</button></div>`).join('')}</div><div class="gf">Заблокированный не может писать вам в личные сообщения. Общие группы и комнаты остаются.</div>`:`<div class="empty"><span class="ei glass">${I('ban')}</span><b>Заблокированных нет</b><span>Если кто-то пишет вам лишнее, заблокируйте его в профиле.</span></div>`;
  const el=setPage('Блокировки',`<div id="bl">${draw()}</div>`);el.addEventListener('click',e=>{const u=e.target.closest('[data-u]');if(u){S.blocked=S.blocked.filter(x=>x!==u.dataset.u);$('#bl',el).innerHTML=draw();renderSettings();toast('Разблокирован','unban')}})}
function openDiag(){setPage('Диагностика',`<div class="grp glass">${[['Версия','2.23.2'],['Режим','standalone (PWA)'],['Сервис-воркер','активен'],['Отступ сверху','54 px'],['Отступ снизу','34 px'],['Соединение','WebSocket · 38 мс']].map(([a,b])=>`<div class="cell"><span class="cl">${a}</span><span class="cv">${b}</span></div>`).join('')}</div><button class="abtn" data-r>${I('upd')}Перезагрузить приложение</button>`).addEventListener('click',e=>{if(e.target.closest('[data-r]'))toast('Перезагрузка…','upd')})}
/* ---------- сцены и запуск ---------- */
const fin=()=>document.getAnimations().forEach(a=>{try{a.finish()}catch(_){}});
async function reset(){closeOverlay();$$('.sheet,.scrim,.lb',layer).forEach(x=>x.remove());popToRoot();hideKb();await sleep(480)}
$('#scenes').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const s=b.dataset.s;await reset();
  if(s==='chats')setTab('chats');else if(s==='chat'){setTab('chats');openChat('team')}else if(s==='room'){setTab('chats');openRoom()}
  else if(s==='contacts')setTab('contacts');else if(s==='settings')setTab('settings');
  else if(s==='msgmenu'){setTab('chats');const el=openChat('team');await sleep(650);fin();const row=$('.mrow.out .bub',el)?.parentElement||$('.mrow',el);row.scrollIntoView({block:'center'});await sleep(250);fin();msgMenu(el,row,findChat('team'),{reply(){},edit(){}})}
  else if(s==='chatmenu'){setTab('chats');await sleep(100);chatMenu($('.row[data-id="sever"]'))}
  else if(s==='profile'){setTab('contacts');openProfile('dmitry')}else if(s==='group'){setTab('chats');openGroup('team')}else if(s==='media'){setTab('chats');openGroup('team');await sleep(500);openMedia(findChat('team'))}
  else if(s==='appearance'){setTab('settings');openAppearance()}else if(s==='newchat')newChat()});
$('#themeseg').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setTheme(b.dataset.t)});
document.addEventListener('pointerdown',e=>{const g=e.target.closest('.gi');if(g){const r=g.getBoundingClientRect();g.style.setProperty('--mx',(e.clientX-r.left)/sc+'px');g.style.setProperty('--my',(e.clientY-r.top)/sc+'px')}});
document.addEventListener('click',e=>{if(e.detail>0){const b=e.target.closest('button');if(b&&!b.matches('textarea,input'))setTimeout(()=>{if(document.activeElement===b)b.blur()},0)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(ov)closeOverlay();else if(layer.querySelector('.sheet.on'))layer.querySelector('.scrim.on')?.click();else pop()}});
buildRoot();bindChats();bindContacts();bindSettings();
setTheme('dark');fit();
requestAnimationFrame(()=>{fit();setTab('chats',true)});setTimeout(fit,300);

/* ---------- PWA: сервис-воркер, обрыв сети, обновление ---------- */
if('serviceWorker' in navigator&&location.protocol!=='file:'){
  const had=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/beta/sw.js',{scope:'/beta/'}).catch(()=>{});
  let first=!had;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(first){first=false;return}toast('Макет обновлён: перезапустите приложение','upd')});
}
addEventListener('offline',()=>toast('Нет сети: макет работает из кэша','bellOff'));
addEventListener('online',()=>toast('Сеть появилась','check'));

