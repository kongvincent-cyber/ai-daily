/* Price overlay only. Never writes the daily packet, index history or signals. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MassiveLiveCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const pos = x => Number.isFinite(Number(x)) && Number(x) > 0;
  const etFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  function day(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const p = Object.fromEntries(etFormat.formatToParts(new Date(ms)).map(x => [x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function timestamp(v, now) {
    let t = Number(v);
    if (t > 1e16) t /= 1e6; // REST nanoseconds; WS milliseconds.
    if (!Number.isFinite(t) || t < 946684800000 || t > now + 60000) return null;
    return Math.floor(t);
  }
  // Provider status packets must not conflate valid-key limits with bad credentials.
  function classifyStatus(event,key='') {
    if(!event||event.ev!=='status')return {kind:'info',code:'',reason:''};
    const rawCode=typeof event.status==='string'?event.status.trim().toLowerCase():'';
    const rawReason=[event.message,event.reason,event.error].find(x=>typeof x==='string')||'';
    function safe(value,limit) {
      let text=value;
      if(typeof key==='string'&&key) {
        text=text.split(key).join('[redacted]');
        try {const encoded=encodeURIComponent(key);if(encoded!==key)text=text.split(encoded).join('[redacted]');}catch(_){}
      }
      return text.replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
    }
    const code=safe(rawCode,64).replace(/[\s-]+/g,'_'),reason=safe(rawReason,240);
    const text=(rawCode+' '+rawReason.toLowerCase()).replace(/[_-]+/g,' ');
    let kind='info';
    if(['connected','auth_success','success','subscribed','subscription_success'].includes(code))return {kind:'ok',code,reason};
    // The service can report its account-wide connection limit as auth_failed.
    if(/\b(?:max(?:imum)?[\s_-]+(?:[a-z]+[\s_-]+){0,4}connections?|connection[\s_-]+limit|too[\s_-]+many[\s_-]+(?:concurrent[\s_-]+)?connections?|connections?[\s_-]+(?:limit|exceeded))\b/i.test(text))kind='connection_limit';
    else if(code==='auth_failed'||code==='authentication_failed')kind='auth';
    else if(code==='not_authorized'||/\bnot[\s_-]+authori[sz]ed\b|\b(?:subscription|entitlement)[\s_-]+(?:required|denied|missing)\b/i.test(text))kind='entitlement';
    else if(code==='error'||code==='protocol_error')kind='protocol';
    return {kind,code,reason};
  }
  class Book {
    constructor(symbols) { this.symbols = new Set(symbols); this.rows = new Map(); }
    row(t) { if (!this.rows.has(t)) this.rows.set(t,{ticker:t}); return this.rows.get(t); }
    price(t,p,ts,now,source) {
      ts = timestamp(ts,now);
      if (!this.symbols.has(t) || !pos(p) || ts === null) return false;
      const r = this.row(t);
      if (r.priceAt != null && ts < r.priceAt) return false;
      Object.assign(r,{price:Number(p),priceAt:ts,source}); return true;
    }
    quote(t,bid,ask,ts,now,sequence) {
      ts = timestamp(ts,now);
      if (!this.symbols.has(t) || !pos(bid) || !pos(ask) || Number(ask)<Number(bid) || ts === null) return false;
      const r = this.row(t);
      if (r.quoteAt != null && ts < r.quoteAt) return false;
      const ordered=Number.isSafeInteger(sequence)&&sequence>=0;
      if (r.quoteAt != null && day(ts)===day(r.quoteAt)) {
        if(ordered&&r.quoteSequence!=null&&sequence<r.quoteSequence)return false;
        if(!ordered&&ts===r.quoteAt&&r.quoteSequence!=null)return false;
      }
      Object.assign(r,{bid:Number(bid),ask:Number(ask),quoteAt:ts,quoteSequence:ordered?sequence:null}); return true;
    }
    trade(t,p,ts,now,sequence,conditions=[]) {
      ts=timestamp(ts,now);
      if(!this.symbols.has(t)||!pos(p)||ts===null)return false;
      const r=this.row(t),ordered=Number.isSafeInteger(sequence)&&sequence>=0;
      if(r.tradeAt!=null&&(ts<r.tradeAt||(day(ts)===day(r.tradeAt)&&ordered&&r.tradeSequence!=null&&sequence<=r.tradeSequence)))return false;
      Object.assign(r,{tradePrice:Number(p),tradeAt:ts,tradeSequence:ordered?sequence:null,
        conditions:Array.isArray(conditions)?conditions.filter(Number.isInteger):[]});return true;
    }
    snapshot(rows,now) {
      for (const x of rows) {
        if (!this.symbols.has(x.ticker)) continue;
        const r = this.row(x.ticker);
        if (pos(x.prevDay?.c)) r.previousClose = Number(x.prevDay.c);
        // min.c follows aggregate eligibility rules, unlike an arbitrary last trade.
        if (pos(x.min?.c)) this.price(x.ticker,x.min.c,x.min.t,now,'分鐘快照');
        if(x.lastTrade)this.trade(x.ticker,x.lastTrade.p,x.lastTrade.t,now,x.lastTrade.q,x.lastTrade.c);
        if (x.lastQuote) this.quote(x.ticker,x.lastQuote.p,x.lastQuote.P,x.lastQuote.t,now);
      }
    }
    event(x,now) {
      if (x.ev === 'A') return this.price(x.sym,x.c,x.e,now,'秒級成交');
      if (x.ev === 'Q') return this.quote(x.sym,x.bp,x.ap,x.t,now,x.q);
      if (x.ev === 'T') return this.trade(x.sym,x.p,x.t,now,x.q,x.c);
      return false;
    }
  }
  // Raw last prints are displayed separately; they never rewrite eligible index prices.
  function displayed(r) {
    if(!r)return null;
    return r.tradeAt!=null&&(!r.priceAt||r.tradeAt>=r.priceAt)?
      {price:r.tradePrice,priceAt:r.tradeAt,source:'逐筆成交',conditions:r.conditions}:r;
  }
  const etClock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function minuteET(t) {const [h,m]=etClock.format(new Date(t)).split(':').map(Number);return h*60+m;}
  class Minutes {
    constructor(session){this.session=session;this.rows=new Map();}
    add(t,c,at,now,complete=false) {
      t=timestamp(t,now);at=timestamp(at,now);
      if(t===null||at===null||!pos(c)||day(t)!==this.session||minuteET(t)<240||minuteET(t)>=1200)return false;
      const k=Math.floor(t/60000)*60000,old=this.rows.get(k);
      if(old&&(old.at>at||(old.at===at&&old.complete&&!complete)))return false;
      this.rows.set(k,{t:k,c:Number(c),at,complete});return true;
    }
    seed(rows,now) {for(const r of rows||[])if(Number(r.t)+59999<=now)this.add(r.t,r.c,Number(r.t)+59999,now,true);}
    event(x,now) {return ['A','AM'].includes(x.ev)&&this.add(x.s??x.e,x.c,x.e,now,x.ev==='AM');}
    values(){return [...this.rows.values()].sort((a,b)=>a.t-b.t);}
  }
  function transport({enabled,authenticated,lastReceivedAt,socketFailure},now) {
    if(!enabled)return '已暫停';
    if(socketFailure||!authenticated)return '快照模式 · 每分鐘查詢快照';
    if(!lastReceivedAt)return '串流已驗證 · 等候第一筆行情';
    if(now-lastReceivedAt>120000)return '串流超過兩分鐘未收新行情 · 快照備援';
    return '串流中';
  }
  function splitFactors(events,asof,today,symbols) {
    const f = Object.fromEntries(symbols.map(t=>[t,1]));
    for (const x of events) {
      if (!(x.ticker in f) || x.execution_date <= asof || x.execution_date > today) continue;
      if (!pos(x.split_from) || !pos(x.split_to)) throw Error('Invalid split ratio');
      f[x.ticker] *= Number(x.split_from)/Number(x.split_to);
    }
    return f;
  }
  function layer(baseline,g,book,market,factors,now) {
    const spec = baseline?.layers?.[g];
    const today = day(now);
    const active = market && (market.market === 'open' || market.earlyHours || market.afterHours);
    if (!spec || !active || !factors || baseline.asof > today ||
        Date.parse(today)-Date.parse(baseline.asof) > 7*86400000) return {ready:false,reason:'休市或基準未核實'};
    if(baseline.asof<today&&baseline.next_session!==today)return {ready:false,reason:'收市基準日期未跟上'};
    let sum=0,up=0,covered=0,carried=0,old=0;
    for (const t of spec.members) {
      const b = Number(baseline.closes[t])*factors[t], r=book.rows.get(t);
      if (!pos(b) || !r || !pos(r.price)) continue;
      // When the bundle is the prior close, independently check the snapshot's prior close.
      if (baseline.asof < today && (!pos(r.previousClose) ||
          Math.min(Math.abs(r.previousClose-b),Math.abs(r.previousClose*factors[t]-b)) > Math.max(.015,b*.0005))) continue;
      const priceDay=day(r.priceAt);
      if (priceDay > today || (priceDay < today && priceDay > baseline.asof)) continue;
      let p=r.price;
      if (priceDay <= baseline.asof && baseline.asof < today) {p=b;carried++;}
      else if (now-r.priceAt > 120000) old++;
      const ret=p/b-1;sum+=ret;if(ret>0)up++;covered++;
    }
    if (covered!==spec.members.length || !pos(spec.close) || !pos(spec.ema21))
      return {ready:false,covered,total:spec.members.length,reason:'成員或前收基準未齊'};
    const change=100*sum/covered,index=spec.close*(1+change/100);
    // One provisional daily observation, never EMA per tick.
    const ema21=baseline.asof<today ? spec.ema21+(index-spec.ema21)/11 : spec.ema21+(index-spec.close)/11;
    return {ready:true,index,change,ema21,above21:index/ema21*100-100,adv:100*up/covered,covered,total:covered,carried,old};
  }
  function card(p,price,split) {
    if (!pos(price)) return '等候成交';
    if (split && split!==1) return '拆股後需核對原卡價位';
    if (price<=p.stop) return '低於原卡止蝕位';
    if (price>=p.tgt) return '已達原卡目標價';
    if (price>=p.bo) return '高於突破價；仍需核對成交量';
    if (price>=p.zone?.[0] && price<=p.zone?.[1]) return '在承接區；仍需收市確認';
    return `距突破 ${((p.bo/price-1)*100).toFixed(2)}%`;
  }
  return {Book,Minutes,day,minuteET,timestamp,displayed,transport,classifyStatus,splitFactors,layer,card};
});
