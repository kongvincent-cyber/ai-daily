/* Desktop conveniences use the original nodes, price store and single stream. */
(function(){
 'use strict';
 const wide=()=>matchMedia('(min-width:1100px)').matches;
 const query=document.getElementById('q'),results=document.getElementById('workspace-search-results'),recent=document.getElementById('workspace-recent'),empty=document.getElementById('inspector-empty'),inspector=document.getElementById('inspector');
 if(!query||!inspector)return;
 let viewed=[];
 function candidates(){
  if(typeof D==='undefined'||!D?.members)return [];
  const q=query.value.trim().toUpperCase();if(!q)return [];
  return [...new Set(Object.values(D.members).flat().map(x=>x.t))]
   .filter(t=>t.includes(q)||(D.names?.[t]||'').toUpperCase().includes(q))
   .sort((a,b)=>(a===q?-1:b===q?1:a.startsWith(q)&&!b.startsWith(q)?-1:b.startsWith(q)&&!a.startsWith(q)?1:a.localeCompare(b))).slice(0,8);
 }
 function clearResults(){results.replaceChildren();}
 function paintResults(){
  clearResults();if(!wide())return;
  for(const t of candidates()){
   const b=document.createElement('button');b.type='button';b.className='workspace-search-result';
   const symbol=document.createElement('b');symbol.textContent=t;
   const name=document.createElement('span');name.textContent=D.names?.[t]||'';
   b.append(symbol,name);b.addEventListener('click',()=>{query.value=t;showT(t);clearResults();});results.append(b);
  }
 }
 function paintRecent(){
  recent.replaceChildren();const members=new Set(Object.values(D?.members||{}).flat().map(x=>x.t));
  viewed=viewed.filter(t=>members.has(t));if(!viewed.length)return;
  const label=document.createElement('span');label.className='lab';label.textContent='最近查看';recent.append(label);
  for(const t of viewed){const b=document.createElement('button');b.type='button';b.textContent=t;b.addEventListener('click',()=>{query.value=t;showT(t);clearResults();});recent.append(b);}
 }
 window.AppWorkspace={
  onInspect(t){
   empty.hidden=true;
   if(t){viewed=[t,...viewed.filter(x=>x!==t)].slice(0,6);paintRecent();}
   if(wide())inspector.scrollTop=0;
  },
  onClose(){empty.hidden=false;},
  onDayChange(){clearResults();paintRecent();},
 };
 query.addEventListener('input',paintResults);
 query.addEventListener('keydown',e=>{
  if(!wide())return;
  if(e.key==='Enter'){const t=candidates()[0];if(t){e.preventDefault();query.value=t;showT(t);clearResults();}}
  if(e.key==='ArrowDown'){const button=results.querySelector('button');if(button){e.preventDefault();button.focus();}}
 });
 document.addEventListener('keydown',e=>{
  if(!wide()||e.ctrlKey||e.metaKey||e.altKey)return;
  const typing=e.target.matches('input,textarea,select,[contenteditable=true]');
  if(e.key==='/'&&!typing){e.preventDefault();query.focus();query.select();inspector.scrollTop=0;}
  if(e.key==='Escape'&&!e.target.closest('input[type=password]')){clearResults();closeDetail();query.blur();}
 });
 document.getElementById('workspace-focus').addEventListener('click',function(){
  const active=document.body.classList.toggle('workspace-chart-focus');this.setAttribute('aria-pressed',String(active));this.textContent=active?'還原雙欄':'放大圖表';
 });
 matchMedia('(min-width:1100px)').addEventListener('change',()=>{clearResults();if(!wide())document.body.classList.remove('workspace-chart-focus');const b=document.getElementById('workspace-focus');b.setAttribute('aria-pressed',String(document.body.classList.contains('workspace-chart-focus')));b.textContent=document.body.classList.contains('workspace-chart-focus')?'還原雙欄':'放大圖表';});
})();
