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
    snapshot(rows,now) {
      for (const x of rows) {
        if (!this.symbols.has(x.ticker)) continue;
        const r = this.row(x.ticker);
        if (pos(x.prevDay?.c)) r.previousClose = Number(x.prevDay.c);
        // min.c follows aggregate eligibility rules, unlike an arbitrary last trade.
        if (pos(x.min?.c)) this.price(x.ticker,x.min.c,x.min.t,now,'分鐘快照');
        if (x.lastQuote) this.quote(x.ticker,x.lastQuote.p,x.lastQuote.P,x.lastQuote.t,now);
      }
    }
    event(x,now) {
      if (x.ev === 'A') return this.price(x.sym,x.c,x.e,now,'秒級成交');
      if (x.ev === 'Q') return this.quote(x.sym,x.bp,x.ap,x.t,now,x.q);
      return false;
    }
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
  return {Book,day,timestamp,splitFactors,layer,card};
});
