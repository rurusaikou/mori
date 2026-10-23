const views=[...document.querySelectorAll('.view')];
const navButtons=[...document.querySelectorAll('[data-view]')];
function showView(id){views.forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav-item[data-view],.mobile-nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});}
navButtons.forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
document.querySelector('#continueChat').addEventListener('click',()=>showView('chat'));
document.querySelector('#openMemory').addEventListener('click',()=>showView('memories'));
const quiet=document.querySelector('.quiet-toggle');
quiet.addEventListener('click',()=>{quiet.classList.toggle('on');toast(quiet.classList.contains('on')?'安静模式已开启':'安静模式已关闭')});
const modal=document.querySelector('#songModal');
function openModal(){modal.classList.add('open');modal.setAttribute('aria-hidden','false');setTimeout(()=>document.querySelector('#songSearch').focus(),100)}
function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}
document.querySelector('#shareSong').addEventListener('click',openModal);document.querySelector('#attachSong').addEventListener('click',openModal);document.querySelector('.modal-close').addEventListener('click',closeModal);modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
document.querySelector('#songSearch').addEventListener('input',e=>document.querySelector('#suggestion').style.opacity=e.target.value.trim()?1:.42);
document.querySelector('#shareConfirm').addEventListener('click',()=>{closeModal();showView('chat');toast('已把 Ref:rain 分享给 Mori')});
document.querySelector('#quietListen').addEventListener('click',()=>{showView('chat');toast('已进入安静共同聆听')});
let playing=true;
document.querySelectorAll('#playRecent,.inline-play').forEach(btn=>btn.addEventListener('click',()=>{playing=!playing;btn.textContent=playing?'Ⅱ':'▶';toast(playing?'继续播放':'已暂停')}));
const form=document.querySelector('#chatForm'),input=document.querySelector('#chatInput'),conversation=document.querySelector('#conversation');
form.addEventListener('submit',e=>{e.preventDefault();const val=input.value.trim();if(!val)return;const user=document.createElement('div');user.className='message user';user.innerHTML=`<div class="bubble"><p>${escapeHtml(val)}</p></div>`;conversation.append(user);input.value='';user.scrollIntoView({behavior:'smooth'});setTimeout(()=>{const reply=document.createElement('div');reply.className='message mori';reply.innerHTML='<div class="mini-orb"></div><div class="bubble"><p>嗯，我在听。想多说一点也可以，想继续安静听歌也很好。</p></div>';conversation.append(reply);reply.scrollIntoView({behavior:'smooth'})},650)});
function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
let toastTimer;function toast(msg){const el=document.querySelector('#toast');el.querySelector('p').textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300)}
document.querySelectorAll('.edit-memory').forEach(b=>b.addEventListener('click',()=>toast('记忆编辑功能已打开')));document.querySelector('.new-memory').addEventListener('click',openModal);document.querySelector('#memorySettings').addEventListener('click',()=>toast('你可以随时修改或删除记忆'));
