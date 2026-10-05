/* Massive real-time overlay for the original encrypted GitHub Pages App. */
(function () {
  'use strict';
  const C=window.MassiveLiveCore, savedName='ai-daily.massive.key.v1';
  if (!C) return;
  const state={key:'',book:null,baseline:null,market:null,factors:null,ws:null,generation:0,failures:0,
    phase:'未連接',detail:'',dataDetail:'',socketFailure:null,latest:null,quotes:[],charts:new Map(),controllers:new Set(),owner:crypto.randomUUID(),enabled:false};
  let cardEl,feedEl,tableEl,layerEl,statusEl,keyEl,rememberEl,leaseRelease,leaseTimer,leaseFallback=false;
  let reconnectTimer,handshakeTimer,stableTimer,refreshTimer,paintTimer,started=false,lastPacketDate='';
  let rankingView='live';
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
    state.dataDetail=warnings.join(' · ');paint();
  }
  function closeSocket() {
    clearTimeout(reconnectTimer);clearTimeout(handshakeTimer);clearTimeout(stableTimer);
    const old=state.ws;state.ws=null;state.authenticated=false;
    if(old){old.onclose=null;old.onmessage=null;old.onerror=null;old.close();}
  }
  function clearTransport() {
    closeSocket();clearInterval(refreshTimer);
    for(const ac of state.controllers)ac.abort();state.controllers.clear();
  }
  function socketFallback(phase,detail) {
    // A stream refusal must not abort an independently working REST snapshot.
    state.socketFailure={phase,detail};closeSocket();releaseLease();message(phase,detail);
  }
  function releaseLease() {
    if(leaseRelease){leaseRelease();leaseRelease=null;}
    clearInterval(leaseTimer);
    if(leaseFallback)try {const x=JSON.parse(localStorage.getItem('ai-daily.massive.lease')||'null');if(x?.owner===state.owner)localStorage.removeItem('ai-daily.massive.lease');}catch(_){}
    leaseFallback=false;
  }
  function stop(phase='已暫停',detail='') {state.generation++;clearTransport();releaseLease();state.dataDetail='';message(phase,detail);}
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
    const det=document.querySelector('#det');
    const open=det&&det.style.display!=='none'?det.querySelector('[data-live-symbol]')?.dataset.liveSymbol:null;
    return [...new Set((open?[open]:[]).concat(picks))].slice(0,10);
  }
  function updateQuotes() {
    if(state.ws?.readyState!==WebSocket.OPEN||!state.authenticated)return;
    const next=selectedQuotes(),old=state.quotes;
    const removed=old.filter(t=>!next.includes(t)),added=next.filter(t=>!old.includes(t));
    const channels=ts=>ts.flatMap(t=>['T.','Q.','AM.'].map(c=>c+t)).join(',');
    if(removed.length)state.ws.send(JSON.stringify({action:'unsubscribe',params:channels(removed)}));
    if(added.length)state.ws.send(JSON.stringify({action:'subscribe',params:channels(added)}));
    state.quotes=next;
  }
  function connectSocket(g) {
    if(g!==state.generation||!state.key||document.hidden)return;
    state.authenticated=false;state.lastReceivedAt=0;state.quotes=[];
    let ws;
    try {ws=new WebSocket('wss://socket.massive.com/stocks');}catch(_){socketFallback('串流連線未能建立','價格快照繼續每分鐘更新；按重新連線再試。');return;}
    state.ws=ws;
    message('連線中');
    handshakeTimer=setTimeout(()=>{if(state.ws===ws){state.detail='連線驗證逾時';ws.close();}},20000);
    ws.onopen=()=>{if(g===state.generation)ws.send(JSON.stringify({action:'auth',params:state.key}));};
    ws.onmessage=ev=>{
      if(g!==state.generation||state.ws!==ws)return;
      let xs;try{xs=JSON.parse(ev.data);}catch(_){return;}if(!Array.isArray(xs))return;
      for(const x of xs) {
        if(x.ev==='status') {
          const failure=C.classifyStatus(x,state.key);
          if(['connection_limit','auth','entitlement','protocol'].includes(failure.kind)) {
            const phases={connection_limit:'串流連線數已滿',auth:'串流驗證未通過',entitlement:'串流行情權限未通過',protocol:'串流請求未通過'};
            const hints={connection_limit:'關閉其他使用同一帳戶嘅實時連線，等 30 秒後按重新連線。',auth:'Massive 拒絕串流驗證；快照權限另行核實。',entitlement:'Massive 拒絕呢個串流頻道；請核對 Stocks 實時權限及已簽協議。',protocol:'Massive 拒絕串流請求；價格快照繼續更新。'};
            socketFallback(phases[failure.kind],`Massive [${failure.code}]${failure.reason?' '+failure.reason:''} · ${hints[failure.kind]}`);return;
          }
          if(x.status==='auth_success') {
            clearTimeout(handshakeTimer);state.authenticated=true;state.socketFailure=null;
            ws.send(JSON.stringify({action:'subscribe',params:symbols().map(t=>'A.'+t).join(',')}));
            updateQuotes();message('已連線 · 等候行情');
            stableTimer=setTimeout(()=>{if(state.ws===ws)state.failures=0;},60000);
          }
        }else if(state.authenticated) {
          const now=Date.now(),priceAccepted=state.book.event(x,now);
          const chartAccepted=state.charts.get(x.sym)?.minutes.event(x,now);
          if(priceAccepted||chartAccepted){state.lastReceivedAt=now;state.phase='已連線 · 串流收到';}
        }
      }
    };
    ws.onerror=()=>{state.detail='網絡連線中斷';};
    ws.onclose=()=>{
      if(g!==state.generation||state.ws!==ws)return;
      clearTimeout(handshakeTimer);clearTimeout(stableTimer);state.ws=null;state.authenticated=false;
      if(++state.failures>5){socketFallback('串流重連已暫停','已試 5 次；價格快照繼續每分鐘更新，按「重新連線」再試。');return;}
      // Massive may take 10–30 seconds to release a dropped account slot.
      const delay=30000+Math.floor(Math.random()*500);
      message('斷線 · 自動重連 '+state.failures+'/5');
      reconnectTimer=setTimeout(()=>{connectSocket(g);refresh(g);},delay);
    };
  }
  async function start(resetSocket=false) {
    if(!state.key||document.hidden)return;
    state.enabled=true;
    if(resetSocket)state.socketFailure=null;
    stop('準備實時連線');const g=state.generation;
    refresh(g);refreshTimer=setInterval(()=>refresh(g),60000);
    if(state.socketFailure){message(state.socketFailure.phase,state.socketFailure.detail);return;}
    if(!await acquireLease(g)){if(g===state.generation)message('另一分頁使用實時連線','呢個分頁每分鐘查詢價格快照。');return;}
    if(g!==state.generation){releaseLease();return;}
    state.failures=0;connectSocket(g);
  }
  function priceLine(t,now) {
    const r=C.displayed(state.book?.rows.get(t));
    if(!r?.price)return '等候報價';
    const base=state.baseline?.closes?.[t],factor=state.factors?.[t];
    const change=base&&factor?` · ${pct((r.price/(base*factor)-1)*100)} vs ${state.baseline.asof} 收市`:'';
    const age=now-r.priceAt;
    return `${money(r.price)}${change} · ${clock(r.priceAt)} · ${r.source}${age>120000?' · 資料過時／最後可用價':''}`;
  }
  async function chartData(t) {
    if(!state.key||!state.enabled||document.hidden)return;
    const now=Date.now(),session=C.day(now),g=state.generation;
    let entry=state.charts.get(t);
    if(!entry||entry.minutes.session!==session) {
      entry={minutes:new C.Minutes(session),attempt:0,pending:false};state.charts.set(t,entry);
      if(state.charts.size>10)state.charts.delete(state.charts.keys().next().value);
    }
    if(entry.pending||now-entry.attempt<60000)return;
    entry.pending=true;entry.attempt=now;
    try {
      const j=await api('/v2/aggs/ticker/'+encodeURIComponent(t)+'/range/1/minute/'+session+'/'+session+'?adjusted=false&sort=asc&limit=2000',g);
      if(g!==state.generation)return;
      if(j.next_url||!Array.isArray(j.results))throw Error('Incomplete chart');
      entry.minutes.seed(j.results,Date.now());entry.error='';
    }catch(_){if(g===state.generation)entry.error='分鐘歷史未取得；保留已收到行情';}
    finally{entry.pending=false;}
  }
  function paintDetail(now,historical) {
    const det=document.querySelector('#det'),t=det?.querySelector('[data-live-symbol]')?.dataset.liveSymbol;
    if(!t||det.style.display==='none')return;
    let box=det.querySelector('[data-intraday]');
    if(!box){box=node('section');box.dataset.intraday='';det.querySelector('[data-live-symbol]').after(box);}
    box.hidden=historical;if(historical)return;
    chartData(t);
    const r=state.book.rows.get(t),p=C.displayed(r),entry=state.charts.get(t),bars=entry?.minutes.values()||[];
    const signature=JSON.stringify([p,r?.bid,r?.ask,r?.quoteAt,bars,entry?.error,Math.floor(now/1000),state.enabled]);
    if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();
    const base=state.baseline?.closes?.[t],factor=state.factors?.[t];
    const validBase=base&&factor&&state.baseline?.next_session===C.day(now);
    box.append(node('b','今日 '+C.day(now)+' · '+(p&&validBase?pct((p.price/(base*factor)-1)*100):'基準待核實')));
    box.append(node('div',r?.bid&&r?.ask?`買 ${money(r.bid)} / 賣 ${money(r.ask)} · ${clock(r.quoteAt)}${now-r.quoteAt>120000?' · 買賣盤過時':''}`:'等候即時買賣盤','lab'));
    if(bars.length) {
      const W=536,H=160,pad=12,lo=Math.min(...bars.map(b=>b.c)),hi=Math.max(...bars.map(b=>b.c));
      const x=t=>pad+(t-bars[0].t)/Math.max(60000,bars.at(-1).t-bars[0].t)*(W-2*pad);
      const y=c=>pad+(hi-c)/Math.max(.01,hi-lo)*(H-2*pad);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('aria-label','今日分鐘價格圖');svg.setAttribute('role','img');svg.style.cssText='width:100%;background:#10151f;border-radius:8px;margin-top:8px';
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',bars.map((b,i)=>`${!i||b.t-bars[i-1].t>120000?'M':'L'}${x(b.t).toFixed(2)},${y(b.c).toFixed(2)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#83bae9');path.setAttribute('stroke-width','2');svg.append(path);
      const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',x(bars.at(-1).t));dot.setAttribute('cy',y(bars.at(-1).c));dot.setAttribute('r','3');dot.setAttribute('fill','#83bae9');svg.append(dot);box.append(svg);
      box.append(node('div',`今日分鐘收價 ${money(bars.at(-1).c)} · ${clock(bars[0].t)} → ${clock(bars.at(-1).at)}${bars.at(-1).complete?'':' · 本分鐘形成中'}${now-bars.at(-1).at>120000?' · 最後可用圖表資料':''}`,'lab'));
    }else box.append(node('div','今日分鐘圖：等候合資格成交／載入歷史','lab'));
    if(entry?.error)box.append(node('div',entry.error,'lab'));
    box.append(node('div','逐筆成交可含特殊成交條件；分鐘圖及盤中指數沿用合資格彙總價，兩者可能不同。','lab'));
  }
  function paintRankings() {
    if(!started||!state.latest||typeof D==='undefined'||!D)return;
    const now=Date.now(),historical=D.date!==state.latest.date,live=!historical&&rankingView==='live';
    const title=document.getElementById('group-title'),topTitle=document.getElementById('top-title'),container=document.getElementById('grows'),tb=document.getElementById('tb');
    if(!title||!container||!tb)return;
    const result=C.rankings(state.baseline,state.book,state.factors,now),byTicker=new Map(result.rows.map(x=>[x.t,x]));
    const market=state.market,marketFresh=market&&Math.abs(now-Date.parse(market.serverTime))<180000;
    const session=marketFresh?(market.earlyHours?'盤前':market.afterHours?'盤後':market.market==='open'?'盤中':'休市最後行情'):'市場狀態待核實';
    const phase=state.enabled?C.transport(state,now):'已暫停／未連接';
    title.textContent='Group strength · '+(live?'今日 '+session:'收市 '+D.date);
    topTitle.textContent='Top 5 ↑ / Bottom 5 ↓ · '+(live?'今日 '+session:'收市 '+D.date);
    const toggle=document.getElementById('ranking-view');toggle.hidden=historical;toggle.textContent=live?'顯示收市分析':'顯示今日排行';
    document.getElementById('group-status').textContent=live?
      '成員升跌幅中位數 · 對比上個交易日收市 · '+phase+' · 每秒更新排序；指數頁籤保留收市歷史。':
      '收市數字、五日走勢及排序 · '+D.date;
    const ordered=[...D.groups].sort((a,b)=>{
      const x=live?result.groups[a.g]:a,y=live?result.groups[b.g]:b,k=mode==='med'?'med':'sig';
      if(live&&!!x?.ready!==!!y?.ready)return x?.ready?-1:1;
      return (Number.isFinite(y?.[k])?y[k]:-Infinity)-(Number.isFinite(x?.[k])?x[k]:-Infinity)||a.g.localeCompare(b.g);
    });
    for(const g of ordered) {
      const el=container.querySelector('[data-g="'+g.g+'"]');if(!el)continue;
      const x=live?result.groups[g.g]:g,ready=live?x?.ready:true,med=el.querySelector('.gmed'),sub=el.querySelector('.gsub');
      med.textContent=ready?pct(x.med):'—';med.className='gmed '+(ready?cls(x.med):'neu');
      sub.textContent=ready?(live?'上漲 '+x.up.toFixed(1)+'% · σ '+x.sig.toFixed(1):'adv '+g.up+'% · pos '+g.rp.toFixed(2)+' · σ '+g.sig.toFixed(1)):'今日 '+(x?.covered||0)+'/'+(x?.total||D.members[g.g].length);
      const spark=el.querySelector('.spark');if(spark)spark.style.display=live?'none':'';
      el.querySelector('.gname').style.flex=live?'1':'';
      const caption=el.querySelector('[data-group-caption]');
      caption.textContent=live?(ready?'今日 '+C.day(now)+' · '+x.covered+'/'+x.total+' · 最新成交 '+clock(x.at)+(x.old?' · '+x.old+' 隻超過兩分鐘未成交':''):(result.reason||'等候全部成員今日成交及前收驗證')):'收市分析 · '+D.date+' · 五日走勢';
      el.querySelectorAll('[data-member-return]').forEach(b=>{
        const t=b.dataset.memberReturn,m=live?byTicker.get(t):D.members[g.g].find(m=>m.t===t);
        b.textContent=m?pct(m.c):'等候今日成交';b.className=m?cls(m.c):'neu';
        b.title=live&&m?'合資格成交 '+clock(m.at)+(m.old?' · 超過兩分鐘':''):live?'今日行情／前收基準未齊':'收市 '+D.date;
      });
    }
    // Move existing rows only when order changes: expanded members / index charts survive ticks.
    ordered.forEach((g,i)=>{const el=container.querySelector('[data-g="'+g.g+'"]');if(el&&container.children[i]!==el)container.insertBefore(el,container.children[i]||null);});
    const status=document.getElementById('top-status');
    status.textContent=live?(result.ready?'今日有效成交 '+result.rows.length+'/'+result.total+' · 升／跌各最多五隻 · '+phase+' · 超過兩分鐘嘅最後成交會標示':result.reason):'收市升跌幅 · '+D.date;
    const signature=JSON.stringify([live,D.date,live?result.top:D.top,live?result.bottom:D.bot,result.reason]);
    if(tb.dataset.rankSignature!==signature) {
      tb.dataset.rankSignature=signature;tb.replaceChildren();
      if(live) {
        for(const [label,list] of [['升幅',result.top||[]],['跌幅',result.bottom||[]]]) {
          const heading=node('div',label,'lab');heading.style.width='100%';tb.append(heading);
          for(const x of list) {
            const chip=node('button',null,'tag');chip.type='button';chip.dataset.rankTicker=x.t;
            chip.append(node('b',pct(x.c),cls(x.c)),document.createTextNode(' '+x.t),node('small',short(nm(x.t),14)+' · '+x.g),node('small',clock(x.at)+(x.old?' · 最後成交／超過兩分鐘':'')));
            chip.onclick=()=>showT(x.t);tb.append(chip);
          }
          if(!list.length)tb.append(node('span',result.ready?'暫無合資格'+label+'股票':'等候今日行情','lab'));
        }
      } else tb.innerHTML=D.top.map(x=>tagHtml(x,'pos')).join('')+D.bot.map(x=>tagHtml(x,'neg')).join('');
    }
  }
  function paint() {
    if(!started||!state.latest)return;
    const now=Date.now(),market=state.market;
    const marketFresh=market&&Math.abs(now-Date.parse(market.serverTime))<180000;
    const active=marketFresh&&(market.market==='open'||market.earlyHours||market.afterHours);
    const session=marketFresh?(market.earlyHours?'盤前':market.afterHours?'盤後':market.market==='open'?'正常交易時段':'休市'):'市場狀態未核實';
    const detail=[state.detail,state.dataDetail].filter(Boolean).join(' · ');
    const status=`${session} · ${state.phase}${detail?' · '+detail:''}`;
    if(statusEl.textContent!==status)statusEl.textContent=status;
    const rows=[...state.book.rows.values()],fresh=rows.filter(r=>r.priceAt&&now-r.priceAt<120000&&C.day(r.priceAt)===C.day(now)).length;
    feedEl.textContent=`${rows.filter(r=>C.displayed(r)?.price).length}/${state.book.symbols.size} 價格 · ${C.transport(state,now)}${state.lastReceivedAt?' · 最後收數 '+clock(state.lastReceivedAt):''} · ${active?fresh+' 個近兩分鐘有合資格成交':'顯示最後可用行情'} · 每秒自動更新畫面，毋須手動刷新`;
    const historical=typeof D!=='undefined'&&D&&D.date!==state.latest.date;
    const benchmarks=cardEl.querySelector('[data-live-benchmarks]');
    benchmarks.textContent=['SPY','QQQ','SOXX'].map(t=>{const row=state.book.rows.get(t),p=C.displayed(row);return t+' '+(p?.price?money(p.price)+(row.previousClose&&C.day(p.priceAt)===C.day(now)?' '+pct((p.price/row.previousClose-1)*100):'')+' · '+clock(p.priceAt)+(now-p.priceAt>120000?' · 最後價':''):'等候報價');}).join(' ｜ ');
    document.querySelectorAll('[data-live-symbol]').forEach(el=>{
      el.hidden=historical;
      if(!historical) {
        const r=C.displayed(state.book.rows.get(el.dataset.liveSymbol));el.title=priceLine(el.dataset.liveSymbol,now);
        if(r?.price&&el.dataset.price&&Number(el.dataset.price)!==r.price){el.classList.remove('tick-up','tick-down');void el.offsetWidth;el.classList.add(r.price>Number(el.dataset.price)?'tick-up':'tick-down');}
        if(r?.price)el.dataset.price=String(r.price);
        el.textContent=el.closest('.mchip')?(r?.price?'最新價 '+money(r.price)+' · '+clock(r.priceAt)+(now-r.priceAt>120000?' · 最後價':''):'最新價 等候報價'):'最新價 '+priceLine(el.dataset.liveSymbol,now);
      }
    });
    const warning=cardEl.querySelector('[data-history-warning]');warning.textContent=historical?'你正查閱歷史日；下方實時區獨立顯示今日行情。':'';
    const pickBox=cardEl.querySelector('[data-live-picks]');pickBox.replaceChildren();
    for(const p of [...(state.latest.picks?.picks||[]),...(state.latest.picks?.alt?.picks||[])]) {
      const r=C.displayed(state.book.rows.get(p.t)),comparison=state.factors?C.card(p,r?.price,state.factors[p.t]):'拆股基準待核實；只顯示價格';
      const el=node('div',`${p.t} ${money(r?.price)} · ${comparison}`,'lab');
      if(r?.priceAt&&now-r.priceAt>120000)el.append(node('span',' · 最後可用價，時間 '+clock(r.priceAt)));
      if(C.day(r?.priceAt||0)!==C.day(now))el.append(node('span',' · 未有今日成交確認'));
      pickBox.append(el);
    }
    {
      layerEl.replaceChildren();
      for(const [g,spec] of Object.entries(state.baseline?.layers||{})) {
        const v=C.layer(state.baseline,g,state.book,active?market:null,state.factors,now);
        const text=v.ready?`${g} ${v.index.toFixed(2)} · ${pct(v.change)} · 21EMA 試算 ${v.ema21.toFixed(2)} · 上漲 ${v.adv.toFixed(1)}%${v.carried?' · '+v.carried+' 隻沿用前收':''}${v.old?' · '+v.old+' 隻成交超過兩分鐘':''}`:
          `${g} 收市 ${spec.close.toFixed(2)}（${state.baseline.asof}） · ${v.reason}${v.total?' '+v.covered+'/'+v.total:''}`;
        layerEl.append(node('div',text,'lab'));
        const inline=document.querySelector('[data-live-layer="'+g+'"]');if(inline){inline.hidden=historical;inline.textContent='盤中試算 · '+text;}
      }
      if(!state.baseline)layerEl.append(node('div','收市基準未載入；實時價仍可使用。','lab'));
    }
    paintRankings();paintDetail(now,historical);
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
    const css=node('style','.massive-price-row{display:grid;grid-template-columns:70px minmax(0,1fr);gap:3px 8px;padding:7px 0;border-bottom:1px solid #2a3448;font-size:12px}.massive-price-row small{grid-column:2;overflow-wrap:anywhere;color:#8a93a6}.massive-price-row button{align-self:start}.massive-live{min-width:0;max-width:100%;overflow-wrap:anywhere}.massive-live .lab{overflow-wrap:anywhere;min-width:0}.massive-live summary{cursor:pointer;padding:7px 0}.massive-live input{max-width:100%;box-sizing:border-box;font-size:16px}.live-quote,.mchip .live-quote{display:block;color:#83bae9;font-size:13px;font-weight:600;margin-top:3px}.massive-live-controls{display:flex;flex-wrap:wrap;gap:7px;margin:7px 0}');document.head.append(css);
    cardEl=node('section',null,'card massive-live');cardEl.id='massive-live';
    document.head.append(node('style','@keyframes tickUp{from{background:#19653e}to{background:transparent}}@keyframes tickDown{from{background:#7d2828}to{background:transparent}}.tick-up{animation:tickUp .8s}.tick-down{animation:tickDown .8s}[data-intraday]{border:1px solid #32415a;border-radius:8px;padding:10px;margin:10px 0;overflow-wrap:anywhere}[data-live-layer]{padding:4px 12px;font-size:12px}'));
    cardEl.append(node('b','Massive · 實時行情'));
    statusEl=node('div','未連接','lab');statusEl.setAttribute('role','status');cardEl.append(statusEl);
    feedEl=node('div',null,'lab');cardEl.append(feedEl);
    const benchmarks=node('div',null,'lab');benchmarks.dataset.liveBenchmarks='';cardEl.append(benchmarks);
    const controls=node('div',null,'massive-live-controls');
    const retry=node('button','重新連線');retry.type='button';retry.onclick=()=>state.key?start(true):setup.open=true;
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
      setup.open=false;await start(true);
    };
    setup.append(form,node('div','Key 只供呢部裝置向 Massive 連線，唔會上傳到 GitHub。唔好喺對話貼 key。','lab'));
    const dashboard=node('a','前往 Massive Dashboard 取得 API key');dashboard.href='https://massive.com/dashboard';dashboard.target='_blank';dashboard.rel='noopener noreferrer';setup.append(dashboard);cardEl.append(setup);
    cardEl.append(node('div','收市選股卡維持原價位；盤中價位比較只作監察，突破仍需成交量、承接仍需收市確認。','lab'));
    const historical=node('div',null,'lab');historical.dataset.historyWarning='';cardEl.append(historical);
    const picks=node('div');picks.dataset.livePicks='';cardEl.append(picks);
    const ld=node('details');ld.dataset.layerDetails='';ld.append(node('summary','九層盤中指數 · 試算'));
    layerEl=node('div');ld.append(layerEl,node('div','沿用原來成員及等權日鏈，使用合資格彙總價。試算未寫入收市歷史，未觸發接棒、FTD 或派貨裁決。','lab'));ld.ontoggle=paint;cardEl.append(ld);
    const pd=node('details');pd.dataset.priceDetails='';pd.append(node('summary','全部股票／基準 · 價格及買賣盤'));
    const search=node('input');search.type='search';search.placeholder='Search ticker or name';search.dataset.liveSearch='';search.setAttribute('aria-label','搜尋實時股票');search.oninput=paint;tableEl=node('div');pd.append(search,tableEl);pd.ontoggle=paint;cardEl.append(pd);
    document.getElementById('sub').after(cardEl);
    paintTimer=setInterval(paint,1000);state.key=await restoreKey();setup.open=!state.key;
    if(state.key)await start();else {await loadBaseline();paint();}
  }
  window.MassiveLive={packetChanged:packet=>{mount().then(()=>packetChanged(packet));},paint,stop,paintRankings,
    toggleRankings:()=>{rankingView=rankingView==='live'?'close':'live';paintRankings();}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.enabled)stop('背景暫停','返回 App 後自動重新連線。');else if(!document.hidden&&state.key&&state.enabled)start();});
  window.addEventListener('pagehide',()=>stop('已暫停'));
  window.addEventListener('pageshow',e=>{if(e.persisted&&state.key&&state.enabled)start();});
  window.addEventListener('offline',()=>stop('離線','保留最後報價及時間。'));
  window.addEventListener('online',()=>{if(state.key&&state.enabled)start();});
  const probe=setInterval(()=>{if(typeof D!=='undefined'&&D&&typeof KEY!=='undefined'&&KEY){clearInterval(probe);mount();}},500);
})();
