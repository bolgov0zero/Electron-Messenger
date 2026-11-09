/* ---------- окна «Гостевая ссылка» и «Ссылка на видеозвонок»: настоящий код клиента, запросы к серверу — заглушка ---------- */
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
  const c=CHATS.find(x=>x.id===cid)||CHATS.find(x=>x.id===S.chat)||CHATS.find(x=>x.id==='team');
  GuestLinks.open({chatId:c.id,chatName:c.n,request:glRequest});
}
const CL=[{id:1,token:'q7Hk2mZp9XaB',title:'Планёрка по релизу',live:true,people:3,waiting:1,expires_at:NOW()+30000},
  {id:2,token:'T4nR8vLc1WdE',title:'',live:false,people:0,waiting:0,expires_at:NOW()+250000}];
let clSeq=10;
async function clRequest(method,path,body){
  await sleep(100);
  if(method==='GET')return{ok:true,data:{links:CL.slice(),warnings:['not_public']}};
  if(method==='POST'&&/\/calllinks$/.test(path)){CL.unshift({id:++clSeq,token:Math.random().toString(36).slice(2,14),title:(body.title||'').slice(0,80),live:false,people:0,waiting:0,expires_at:NOW()+body.ttl});return{ok:true,data:{}}}
  const id=+(path.match(/calllinks\/(\d+)/)||[])[1],i=CL.findIndex(x=>x.id===id);
  if(method==='POST'&&/end/.test(path)&&i>=0){CL[i].live=false;CL[i].people=0;CL[i].waiting=0}
  if(method==='DELETE'&&i>=0)CL.splice(i,1);
  return{ok:true,data:{}};
}
function openCallLink(){if(document.querySelector('.gl-bg'))return;CallLinks.open({base:'https://chat.example.com',request:clRequest,join:()=>toast('Вход в звонок по ссылке')})}
/* окно группы: гостевая ссылка — из плитки/строки, как в клиенте */
document.addEventListener('click',e=>{const b=e.target.closest('[data-act="guestlink"]');if(b){e.preventDefault();openGuest()}});
/* аккаунты в баре: выбор записи */
$('#accs').addEventListener('click',e=>{const b=e.target.closest('.ws');if(!b)return;$$('#accs .ws').forEach(x=>x.classList.toggle('on',x===b));if(b.dataset.acc!=='0')toast('Переключение записи: '+b.title.split(' · ')[0])});
