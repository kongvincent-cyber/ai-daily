/* Massive real-time overlay for the original encrypted GitHub Pages App. */
(function () {
  'use strict';
  const C=window.MassiveLiveCore, savedName='ai-daily.massive.key.v1';
  if (!C) return;
  const state={key:'',book:null,baseline:null,market:null,factors:null,ws:null,generation:0,failures:0,
    phase:'未連接',detail:'',latest:null,quotes:[],controllers:new Set(),owner:crypto.randomUUID(),enabled:false};
  let cardEl,feedEl,tableEl,layerEl,statusEl,keyEl,rememberEl,leaseRelease,leaseTimer,leaseFallback=false;
  let reconnectTimer,handshakeTimer,stableTimer,refreshTimer,paintTimer,started=false,lastPacketDate='';
  const money=x=>Number.isFinite(x)?'$'+x.toFixed(x<1?4:2):'—';
  const pct=x=>(x>0?'+':'')+x.toFixed(2)+'%';
  const clock=t=>new Date(t).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' 香港';
  function node(tag,value,className) {const e=document.createElement(tag);if(value!=null)e.textContent=value;if(className)e.className=className;return e;}
  function message(phase,detail='') {state.phase=phase;state.detail=detail;paint();}
  function symbols() {return [...new Set(Object.values(state.latest?.members||{}).flat().map(m=>m.t).concat(['SPY','QQQ','IWM','RSP','SMH','SOXX']))].filter(t=>/^[A-Z][A-Z0-9.\-]{0,14}$/.test(t));}
  async function deviceKey() {
    if (typeof KEY==='undefined'||!KEY) throw Error('Unlock');
    return crypto.subtle.importKey('raw',await crypto.subtle.exportKey('raw',KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  async function rememberKey(key) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await deviceKey(),new TextEncoder().encode(key)));
    localStorage.setItem(savedName,JSON.stringify({iv:Array.from(iv),data:Array.from(bytes)}));
  }
  async function restoreKey() {
    try {const s=JSON.parse(localStorage.getItem(savedName)||'null');if(!s)return '';
      return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(s.iv)},await deviceKey(),new Uint8Array(s.data)));
    } catch (_) {return '';}
  }
  async function api(path,generation) {
    const url=new URL(path,'https://api.massive.com');
    if(url.origin!=='https://api.massive.com'||url.searchParams.has('apiKey'))throw Error('Origin');
    const ac=new AbortController();state.controllers.add(ac);const timer=setTimeout(()=>ac.abort(),10000);
    try {
      const r=await fetch(url,{headers:{Authorization:'Bearer '+state.key},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:ac.signal});
      if(generation!==state.generation)throw Error('Cancelled');
      if(!r.ok)throw Error(r.status===401||r.status===403?'Authorization':r.status===429?'Rate limit':'Network');
      const j=await r.json();if(j.status==='ERROR'||j.status==='NOT_AUTHORIZED')throw Error('Authorization');return j;
    } finally {clearTimeout(timer);state.controllers.delete(ac);}
  }
  async function loadBaseline() {
    try {const b=await fetchEnc('live_baseline.enc');
      if(b.schema!==1||!b.asof||Object.keys(b.closes||{}).length!==255)throw Error('Baseline');
      state.baseline=b;
    } catch (_) {state.baseline=null;}
  }
  async function refresh(g) {
    if(!state.key||g!==state.generation)return;
    const ts=symbols();let warnings=[];
    const calls=await Promise.allSettled([
      api('/v1/marketstatus/now',g),
      api('/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false&tickers='+encodeURIComponent(ts.join(',')),g),
      loadBaseline()
    ]);
    if(g!==state.generation)return;
    for(const r of calls)if(r.status==='rejected'&&r.reason.message==='Authorization') {
      state.enabled=false;stop('驗證未通過','請核對 Massive API key、Stocks Advanced 權限及交易所協議。');return;
    }
    if(calls[0].status==='fulfilled')state.market=calls[0].value;else {state.market=null;warnings.push('市場狀態未核實');}
    if(calls[1].status==='fulfilled'&&Array.isArray(calls[1].value.tickers)) {
      state.book.snapshot(calls[1].value.tickers,Date.now());state.snapshotCount=calls[1].value.tickers.filter(x=>ts.includes(x.ticker)).length;
      if(state.snapshotCount!==ts.length)warnings.push('行情快照 '+state.snapshotCount+'/'+ts.length);
    } else warnings.push('快照暫未取得；保留已收到嘅報價時間');
    state.factors=null;
    if(state.baseline)try {
      const today=C.day(Date.now());
      if(state.baseline.asof===today)state.factors=Object.fromEntries(ts.map(t=>[t,1]));
      else if(state.baseline.asof<today&&Date.parse(today)-Date.parse(state.baseline.asof)<=7*86400000) {
        const sp=await api('/stocks/v1/splits?execution_date.gt='+state.baseline.asof+'&execution_date.lte='+today+'&limit=5000',g);
        if(sp.next_url||!Array.isArray(sp.results))throw Error('Splits');
        state.factors=C.splitFactors(sp.results,state.baseline.asof,today,ts);
      }
    } catch(_) {warnings.push('拆股基準未核實；盤中指數暫停');}
    if(g!==state.generation)return;
    state.detail=warnings.join(' · ');paint();
  }
  function clearTransport() {
    clearTimeout(reconnectTimer);clearTimeout(handshakeTimer);clearTimeout(stableTimer);clearInterval(refreshTimer);
    for(const ac of state.controllers)ac.abort();state.controllers.clear();
    const old=state.ws;state.ws=null;if(old){old.onclose=null;old.onmessage=null;old.onerror=null;old.close();}
  }
  function releaseLease() {
    if(leaseRelease){leaseRelease();leaseRelease=null;}
    clearInterval(leaseTimer);
    if(leaseFallback)try {const x=JSON.parse(localStorage.getItem('ai-daily.massive.lease')||'null');if(x?.owner===state.owner)localStorage.removeItem('ai-daily.massive.lease');}catch(_){}
    leaseFallback=false;
  }
  function stop(phase='已暫停',detail='') {state.generation++;clearTransport();releaseLease();message(phase,detail);}
  async function acquireLease(g) {
    if(navigator.locks) {
      return new Promise(resolve=>{
        navigator.locks.request('ai-daily-massive-stocks',{ifAvailable:true},async lock=>{
          if(!lock||g!==state.generation){resolve(false);return;}
          await new Promise(release=>{leaseRelease=release;resolve(true);});
        }).catch(()=>resolve(false));
      });
    }
    try {
      const name='ai-daily.massive.lease';let x=JSON.parse(localStorage.getItem(name)||'null');
      if(x&&x.owner!==state.owner&&x.until>Date.now())return false;
      const write=()=>localStorage.setItem(name,JSON.stringify({owner:state.owner,until:Date.now()+30000}));write();
      await new Promise(r=>setTimeout(r,150));x=JSON.parse(localStorage.getItem(name)||'null');
      if(x?.owner!==state.owner)return false;
      leaseFallback=true;leaseTimer=setInterval(()=>{
        const other=JSON.parse(localStorage.getItem(name)||'null');
        if(other?.owner!==state.owner)stop('另一分頁使用實時連線');else write();
      },10000);return true;
    }catch(_) {return false;}
  }
  function selectedQuotes() {
    const picks=[...(state.latest?.picks?.picks||[]),...(state.latest?.picks?.alt?.picks||[])].map(x=>x.t);
    const open=document.querySelector('#det [data-live-symbol]')?.dataset.liveSymbol;
    return [...new Set(picks.concat(open?[open]:[]))].slice(0,10);
  }
  function updateQuotes() {
    if(state.ws?.readyState!==WebSocket.OPEN||!state.authenticated)return;
    const next=selectedQuotes(),old=state.quotes;
    const removed=old.filter(t=>!next.includes(t)),added=next.filter(t=>!old.includes(t));
    if(removed.length)state.ws.send(JSON.stringify({action:'unsubscribe',params:removed.map(t=>'Q.'+t).join(',')}));
    if(added.length)state.ws.send(JSON.stringify({action:'subscribe',params:added.map(t=>'Q.'+t).join(',')}));
    state.quotes=next;
  }
  function connectSocket(g) {
    if(g!==state.generation||!state.key||document.hidden)return;
    state.authenticated=false;state.quotes=[];
    let ws;
    try {ws=new WebSocket('wss://socket.massive.com/stocks');}catch(_){state.enabled=false;stop('實時連線未能建立','按重新連線再試。');return;}
    state.ws=ws;
    message('連線中');
    handshakeTimer=setTimeout(()=>{if(state.ws===ws){state.detail='連線驗證逾時';ws.close();}},20000);
    ws.onopen=()=>{if(g===state.generation)ws.send(JSON.stringify({action:'auth',params:state.key}));};
    ws.onmessage=ev=>{
      if(g!==state.generation||state.ws!==ws)return;
      let xs;try{xs=JSON.parse(ev.data);}catch(_){return;}if(!Array.isArray(xs))return;
      for(const x of xs) {
        if(x.ev==='status') {
          if(x.status==='auth_failed'||x.status==='not_authorized'||x.status==='error') {state.enabled=false;stop('驗證或行情訂閱未通過','請核對 Massive key 及實時行情權限。');return;}
          if(x.status==='auth_success') {
            clearTimeout(handshakeTimer);state.authenticated=true;
            ws.send(JSON.stringify({action:'subscribe',params:symbols().map(t=>'A.'+t).join(',')}));
            updateQuotes();message('已連線 · 等候行情');
            stableTimer=setTimeout(()=>{if(state.ws===ws)state.failures=0;},60000);
          }
        }else if(state.authenticated&&state.book.event(x,Date.now()))state.lastReceivedAt=Date.now();
      }
    };
    ws.onerror=()=>{state.detail='網絡連線中斷';};
    ws.onclose=()=>{
      if(g!==state.generation||state.ws!==ws)return;
      clearTimeout(handshakeTimer);clearTimeout(stableTimer);state.ws=null;state.authenticated=false;
      if(++state.failures>5){state.enabled=false;stop('重連已暫停','已試 5 次；保留最後報價，按「重新連線」再試。');return;}
      const delay=Math.min(30000,1000*2**(state.failures-1))+Math.floor(Math.random()*500);
      message('斷線 · 自動重連 '+state.failures+'/5');
      reconnectTimer=setTimeout(()=>{connectSocket(g);refresh(g);},delay);
    };
  }
  async function start() {
    if(!state.key||document.hidden)return;
    state.enabled=true;
    stop('準備實時連線');const g=state.generation;
    if(!await acquireLease(g)){if(g===state.generation)message('另一分頁使用實時連線','每個 Stocks 帳戶預設只容許一條 WebSocket。');return;}
    if(g!==state.generation){releaseLease();return;}
    state.failures=0;connectSocket(g);refresh(g);
    refreshTimer=setInterval(()=>refresh(g),60000);
  }
  function priceLine(t,now) {
    const r=state.book?.rows.get(t);
    if(!r?.price)return 'Massive：等候報價';
    const base=state.baseline?.closes?.[t],factor=state.factors?.[t];
    const change=base&&factor?` · ${pct((r.price/(base*factor)-1)*100)} vs ${state.baseline.asof} 收市`:'';
    const age=now-r.priceAt;
    return `${money(r.price)}${change} · ${clock(r.priceAt)}${age>120000?' · 最後可用價':''}`;
  }
  function paint() {
    if(!started||!state.latest)return;
    const now=Date.now(),market=state.market;
    const marketFresh=market&&Math.abs(now-Date.parse(market.serverTime))<180000;
    const active=marketFresh&&(market.market==='open'||market.earlyHours||market.afterHours);
    const session=marketFresh?(market.earlyHours?'盤前':market.afterHours?'盤後':market.market==='open'?'正常交易時段':'休市'):'市場狀態未核實';
    statusEl.textContent=`${session} · ${state.phase}${state.detail?' · '+state.detail:''}`;
    const rows=[...state.book.rows.values()],fresh=rows.filter(r=>r.priceAt&&now-r.priceAt<120000&&C.day(r.priceAt)===C.day(now)).length;
    feedEl.textContent=`${rows.filter(r=>r.price).length}/${state.book.symbols.size} 價格 · ${active?fresh+' 個近兩分鐘有成交':'顯示最後可用行情'} · 每秒刷新畫面`;
    const historical=typeof D!=='undefined'&&D&&D.date!==state.latest.date;
    document.querySelectorAll('[data-live-symbol]').forEach(el=>{
      el.hidden=historical;
      if(!historical) {
        const r=state.book.rows.get(el.dataset.liveSymbol);el.title=priceLine(el.dataset.liveSymbol,now);
        el.textContent=el.closest('.mchip')?(r?.price?'行情 '+money(r.price)+' · '+clock(r.priceAt)+(now-r.priceAt>120000?' · 最後價':''):'行情 等候報價'):'行情 '+priceLine(el.dataset.liveSymbol,now);
      }
    });
    const warning=cardEl.querySelector('[data-history-warning]');warning.textContent=historical?'你正查閱歷史日；下方實時區獨立顯示今日行情。':'';
    const pickBox=cardEl.querySelector('[data-live-picks]');pickBox.replaceChildren();
    for(const p of [...(state.latest.picks?.picks||[]),...(state.latest.picks?.alt?.picks||[])]) {
      const r=state.book.rows.get(p.t),comparison=state.factors?C.card(p,r?.price,state.factors[p.t]):'拆股基準待核實；只顯示價格';
      const el=node('div',`${p.t} ${money(r?.price)} · ${comparison}`,'lab');
      if(r?.priceAt&&now-r.priceAt>120000)el.append(node('span',' · 最後可用價，時間 '+clock(r.priceAt)));
      if(C.day(r?.priceAt||0)!==C.day(now))el.append(node('span',' · 未有今日成交確認'));
      pickBox.append(el);
    }
    if(cardEl.querySelector('[data-layer-details]').open) {
      layerEl.replaceChildren();
      for(const [g,spec] of Object.entries(state.baseline?.layers||{})) {
        const v=C.layer(state.baseline,g,state.book,active?market:null,state.factors,now);
        const text=v.ready?`${g} ${v.index.toFixed(2)} · ${pct(v.change)} · 21EMA 試算 ${v.ema21.toFixed(2)} · 上漲 ${v.adv.toFixed(1)}%${v.carried?' · '+v.carried+' 隻沿用前收':''}${v.old?' · '+v.old+' 隻成交超過兩分鐘':''}`:
          `${g} 收市 ${spec.close.toFixed(2)}（${state.baseline.asof}） · ${v.reason}${v.total?' '+v.covered+'/'+v.total:''}`;
        layerEl.append(node('div',text,'lab'));
      }
      if(!state.baseline)layerEl.append(node('div','收市基準未載入；實時價仍可使用。','lab'));
    }
    if(cardEl.querySelector('[data-price-details]').open) {
      tableEl.replaceChildren();const search=cardEl.querySelector('[data-live-search]').value.trim().toUpperCase();
      for(const t of symbols().filter(t=>!search||t.includes(search)||(state.latest.names?.[t]||'').toUpperCase().includes(search)).sort()) {
        const r=state.book.rows.get(t),row=node('div',null,'massive-price-row');row.dataset.ticker=t;
        const title=node('button',t);title.type='button';title.addEventListener('click',()=>{if(typeof showT==='function'&&state.latest.members&&Object.values(state.latest.members).flat().some(m=>m.t===t))showT(t);});
        row.append(title,node('span',priceLine(t,now)));
        if(r?.bid&&r?.ask)row.append(node('small',`買 ${money(r.bid)} / 賣 ${money(r.ask)} · ${clock(r.quoteAt)}${now-r.quoteAt>120000?' · 最後買賣盤':''}`));
        tableEl.append(row);
      }
    }
    updateQuotes();
  }
  async function packetChanged(packet) {
    if(!packet||packet.date<lastPacketDate)return;
    if(lastPacketDate===packet.date){paint();return;}
    lastPacketDate=packet.date;state.latest=packet;
    state.book=new C.Book(symbols());
    if(started&&state.key&&state.enabled)await start();
  }
  async function mount() {
    if(started||typeof D==='undefined'||!D||typeof KEY==='undefined'||!KEY)return;
    started=true;state.latest=D;lastPacketDate=D.date;state.book=new C.Book(symbols());
    const css=node('style','.massive-price-row{display:grid;grid-template-columns:70px minmax(0,1fr);gap:3px 8px;padding:7px 0;border-bottom:1px solid #2a3448;font-size:12px}.massive-price-row small{grid-column:2;overflow-wrap:anywhere;color:#8a93a6}.massive-price-row button{align-self:start}.massive-live .lab{overflow-wrap:anywhere}.massive-live summary{cursor:pointer;padding:7px 0}.massive-live input{max-width:100%;box-sizing:border-box}.live-quote{display:block;color:#83bae9;font-size:10px;margin-top:3px}.massive-live-controls{display:flex;flex-wrap:wrap;gap:7px;margin:7px 0}');document.head.append(css);
    cardEl=node('section',null,'card massive-live');cardEl.id='massive-live';
    cardEl.append(node('b','Massive · 實時行情'));
    statusEl=node('div','未連接','lab');statusEl.setAttribute('role','status');cardEl.append(statusEl);
    feedEl=node('div',null,'lab');cardEl.append(feedEl);
    const controls=node('div',null,'massive-live-controls');
    const retry=node('button','重新連線');retry.type='button';retry.onclick=()=>state.key?start():setup.open=true;
    const pause=node('button','暫停');pause.type='button';pause.onclick=()=>{state.enabled=false;stop('已暫停');};
    const forget=node('button','清除本機 key');forget.type='button';forget.onclick=()=>{state.enabled=false;stop('未連接');state.key='';localStorage.removeItem(savedName);setup.open=true;};
    controls.append(retry,pause,forget);cardEl.append(controls);
    const setup=node('details');const summary=node('summary','連接／更換 Massive key');setup.append(summary);
    const form=node('form');const label=node('label','Massive API key ');keyEl=node('input');keyEl.type='password';keyEl.autocomplete='off';keyEl.spellcheck=false;keyEl.setAttribute('aria-label','Massive API key');label.append(keyEl);
    rememberEl=node('input');rememberEl.type='checkbox';rememberEl.checked=true;
    const rememberLabel=node('label',' 儲存喺呢部裝置 ');rememberLabel.prepend(rememberEl);
    const submit=node('button','連接實時行情');submit.type='submit';form.append(label,rememberLabel,submit);
    form.onsubmit=async e=>{
      e.preventDefault();const key=keyEl.value.trim();keyEl.value='';if(!key){message('請輸入 Massive API key');return;}
      state.key=key;
      try {if(rememberEl.checked)await rememberKey(key);else localStorage.removeItem(savedName);}catch(_){message('本機未能儲存；今次連線仍可使用。');}
      setup.open=false;await start();
    };
    setup.append(form,node('div','Key 只供呢部裝置向 Massive 連線，唔會上傳到 GitHub。唔好喺對話貼 key。','lab'));
    const dashboard=node('a','前往 Massive Dashboard 取得 API key');dashboard.href='https://massive.com/dashboard';dashboard.target='_blank';dashboard.rel='noopener noreferrer';setup.append(dashboard);cardEl.append(setup);
    cardEl.append(node('div','收市選股卡維持原價位；盤中價位比較只作監察，突破仍需成交量、承接仍需收市確認。','lab'));
    const historical=node('div',null,'lab');historical.dataset.historyWarning='';cardEl.append(historical);
    const picks=node('div');picks.dataset.livePicks='';cardEl.append(picks);
    const ld=node('details');ld.dataset.layerDetails='';ld.append(node('summary','九層盤中指數 · 試算'));
    layerEl=node('div');ld.append(layerEl,node('div','沿用原來成員及等權日鏈。試算未寫入收市歷史，未觸發接棒、FTD 或派貨裁決。','lab'));ld.ontoggle=paint;cardEl.append(ld);
    const pd=node('details');pd.dataset.priceDetails='';pd.append(node('summary','全部股票／基準 · 價格及買賣盤'));
    const search=node('input');search.type='search';search.placeholder='Search ticker or name';search.dataset.liveSearch='';search.setAttribute('aria-label','搜尋實時股票');search.oninput=paint;tableEl=node('div');pd.append(search,tableEl);pd.ontoggle=paint;cardEl.append(pd);
    document.getElementById('sub').after(cardEl);
    paintTimer=setInterval(paint,1000);state.key=await restoreKey();setup.open=!state.key;
    if(state.key)await start();else {await loadBaseline();paint();}
  }
  window.MassiveLive={packetChanged:packet=>{mount().then(()=>packetChanged(packet));},paint,stop};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.enabled)stop('背景暫停','返回 App 後自動重新連線。');else if(!document.hidden&&state.key&&state.enabled)start();});
  window.addEventListener('pagehide',()=>stop('已暫停'));
  window.addEventListener('pageshow',e=>{if(e.persisted&&state.key&&state.enabled)start();});
  window.addEventListener('offline',()=>stop('離線','保留最後報價及時間。'));
  window.addEventListener('online',()=>{if(state.key&&state.enabled)start();});
  const probe=setInterval(()=>{if(typeof D!=='undefined'&&D&&typeof KEY!=='undefined'&&KEY){clearInterval(probe);mount();}},500);
})();
