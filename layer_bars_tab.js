/* layer_bars_tab.js — 層指數「指數」tab component(vanilla,零依賴,~9KB)
 * 用法:
 *   LayerBars.mount(containerEl, layerBarsJson, "L5", {median: -1.89, range: 126, colors: {...}})
 *   LayerBars.regimeChip(layerBarsJson, "L5")  → HTML string(▲多頭 / ▼空頭 / ●糾纏 + 連21E),放入 group strength 主表每行
 *   LayerBars.destroy(containerEl)
 * 數據:layer_bars_build.py 輸出(dates + layers[L].{o,h,l,c,e9,e21,s50,s200,adv,stats,label,n})。
 * 主線 21EMA(墨色粗)+ 9EMA;次線 50SMA(灰實)+ 200SMA(灰虛);底欄 adv%(闊度,取代成交量),<20% 標紅。
 * 誠實聲明固定印喺圖底:C=真・O≈真・H/L 膨脹(收位只作日比,ATR 禁)。
 * 主題:CSS 變數 --lb-* 可由 app 覆寫(預設係 dataviz 驗證過嘅深色調色板)。
 */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const CSS = `
.lb-root{--lb-surface:#1a1a19;--lb-ink:#ffffff;--lb-ink2:#c3c2b7;--lb-muted:#898781;--lb-grid:#2c2c2a;--lb-axis:#383835;--lb-border:rgba(255,255,255,.10);
  --lb-up:#3987e5;--lb-down:#e66767;--lb-e9:#199e70;--lb-e21:#ffffff;--lb-sma:#898781;--lb-good:#0ca30c;--lb-crit:#d03b3b;--lb-warn:#e66767;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--lb-ink);background:var(--lb-surface);border-radius:10px;padding:10px 12px 8px;position:relative}
.lb-head{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;font-size:12px;color:var(--lb-ink2);margin:0 0 6px}
.lb-head .nm{font-size:14.5px;font-weight:650;color:var(--lb-ink)} .lb-head .num{font-variant-numeric:tabular-nums}
.lb-chip{font-size:11px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid var(--lb-border)}
.lb-chip.bull{color:var(--lb-good)} .lb-chip.bear{color:var(--lb-crit)} .lb-chip.mix{color:var(--lb-muted)}
.lb-pos{color:var(--lb-good)} .lb-neg{color:var(--lb-crit)}
.lb-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 6px;font-size:11.5px;color:var(--lb-ink2)}
.lb-seg{display:inline-flex;border:1px solid var(--lb-border);border-radius:8px;overflow:hidden}
.lb-seg button{background:transparent;color:var(--lb-ink);border:0;padding:4px 10px;font-size:11.5px;cursor:pointer}
.lb-seg button.on{background:var(--lb-ink);color:var(--lb-surface);font-weight:650}
.lb-legend span{margin-right:10px} .lb-legend i{display:inline-block;width:14px;border-top:2.5px solid;vertical-align:3px;margin-right:4px}
.lb-legend i.thin{border-top-width:1.5px} .lb-legend i.dash{border-top-style:dashed}
.lb-scroll{overflow-x:auto;overflow-y:hidden} .lb-root svg{display:block}
.lb-foot{font-size:10.5px;color:var(--lb-muted);margin:6px 0 0;line-height:1.5}
.lb-tip{position:fixed;z-index:99;pointer-events:none;background:var(--lb-surface);color:var(--lb-ink2);border:1px solid var(--lb-border);box-shadow:0 2px 10px rgba(0,0,0,.35);
  border-radius:8px;padding:7px 10px;font-size:11.5px;font-variant-numeric:tabular-nums;display:none;line-height:1.55;white-space:nowrap} .lb-tip b{color:var(--lb-ink)}
.lb-regime{font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid rgba(128,128,128,.35);white-space:nowrap}
.lb-regime.bull{color:#0ca30c} .lb-regime.bear{color:#e66767} .lb-regime.mix{color:#898781}`;

  const fmt = (v, d = 2) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgn = v => (v == null ? '—' : (v > 0 ? '+' : '') + fmt(v, 1) + '%');
  const el = (tag, at, parent) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (parent) parent.appendChild(e); return e; };
  function ticks(lo, hi, n) { const s0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(s0))); let st = mag; for (const m of [1, 2, 2.5, 5, 10]) { if (s0 <= m * mag) { st = m * mag; break; } } const t = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) t.push(v); return t; }
  function ensureCss() { if (!document.getElementById('lb-css')) { const s = document.createElement('style'); s.id = 'lb-css'; s.textContent = CSS; document.head.appendChild(s); } }
  function tipEl() { let t = document.getElementById('lb-tip'); if (!t) { t = document.createElement('div'); t.id = 'lb-tip'; t.className = 'lb-tip'; document.body.appendChild(t); } return t; }

  function regimeChip(data, L) {
    const s = data && data.layers && data.layers[L] && data.layers[L].stats; if (!s) return '';
    const cls = s.stack === '多頭' ? 'bull' : (s.stack === '空頭' ? 'bear' : 'mix'), icon = s.stack === '多頭' ? '▲' : (s.stack === '空頭' ? '▼' : '●');
    return `<span class="lb-regime ${cls}" title="距21E ${sgn(s.dist['21E'])} · 距50S ${sgn(s.dist['50S'])}">${icon}${s.stack} ${s.streak > 0 ? '+' : ''}${s.streak}d</span>`;
  }

  function mount(container, data, L, opts) {
    opts = opts || {}; ensureCss();
    const D = data.layers[L]; if (!D) { container.textContent = '層數據攞唔到'; return; }
    container.classList.add('lb-root'); container.innerHTML = '';
    if (opts.colors) for (const k in opts.colors) container.style.setProperty('--lb-' + k, opts.colors[k]);
    const s = D.stats, ALL = data.dates, NALL = ALL.length;
    let NSHOW = opts.range || (container.clientWidth < 600 ? 63 : (container.clientWidth < 1000 ? 126 : 251));
    NSHOW = Math.min(NSHOW, NALL);
    const cls = s.stack === '多頭' ? 'bull' : (s.stack === '空頭' ? 'bear' : 'mix'), icon = s.stack === '多頭' ? '▲' : (s.stack === '空頭' ? '▼' : '●');
    const pn = v => `<b class="${v >= 0 ? 'lb-pos' : 'lb-neg'}">${sgn(v)}</b>`;
    const head = document.createElement('div'); head.className = 'lb-head';
    head.innerHTML = `<span class="nm">${L}・${D.label}</span><span>${D.n}隻</span>
      <span class="lb-chip ${cls}">${icon} ${s.stack}排列</span>
      <span class="num">連21EMA ${s.streak > 0 ? '+' : ''}${s.streak}日</span>
      <span class="num">距21E ${pn(s.dist['21E'])}</span><span class="num">距50S ${pn(s.dist['50S'])}</span>
      <span class="num">指數日 ${pn(s.day)}</span>${opts.median != null ? `<span class="num">median ${pn(opts.median)}</span>` : ''}
      <span class="num">闊度 ${s.adv_today == null ? '—' : s.adv_today + '%'}${s.adv_lt20_streak >= 2 ? ' <b class="lb-neg">連' + s.adv_lt20_streak + '日<20%</b>' : ''}</span>`;
    container.appendChild(head);
    const bar = document.createElement('div'); bar.className = 'lb-bar';
    bar.innerHTML = `<div class="lb-seg"><button data-n="63">3M</button><button data-n="126">6M</button><button data-n="251">12M</button></div>
      <span class="lb-legend"><span><i style="border-color:var(--lb-e21)"></i>21E</span><span><i style="border-color:var(--lb-e9)"></i>9E</span>
      <span><i class="thin" style="border-color:var(--lb-sma)"></i>50S</span><span><i class="thin dash" style="border-color:var(--lb-sma)"></i>200S</span><span>底欄=闊度 adv%</span></span>`;
    container.appendChild(bar);
    const scroll = document.createElement('div'); scroll.className = 'lb-scroll'; container.appendChild(scroll);
    const foot = document.createElement('div'); foot.className = 'lb-foot';
    foot.innerHTML = `等權日鏈指數(append-only)・數據至 ${data.meta && data.meta.asof || ALL[NALL - 1]}${data.meta && data.meta.backfill_until ? '・' + data.meta.backfill_until + ' 前為現行成員回溯' : ''}<br>` +
      `合成 OHLC:收=真(MA 只用收)・開≈真(裂口可用)・高/低系統性膨脹——收位只作日對日比較,ATR/波幅禁用。`;
    container.appendChild(foot);
    const tip = tipEl();

    function draw() {
      scroll.innerHTML = '';
      const st = NALL - NSHOW, dates = ALL.slice(st), N = dates.length;
      const sl = a => a.slice(st);
      const d = { o: sl(D.o), h: sl(D.h), l: sl(D.l), c: sl(D.c), e9: sl(D.e9), e21: sl(D.e21), s50: sl(D.s50), s200: sl(D.s200), adv: sl(D.adv) };
      const narrow = container.clientWidth < 600;
      const PADL = 6, PADR = narrow ? 62 : 78, PADT = 6, PH = narrow ? 140 : 180, GAP = 8, BH = narrow ? 30 : 40, PADB = 20;
      const avail = Math.max(240, container.clientWidth - 24 - PADL - PADR);
      const SLOT = Math.max(3, Math.min(6, Math.floor(avail / N))), BW = SLOT >= 5 ? 3 : (SLOT >= 4 ? 2.5 : 2);
      const W = PADL + N * SLOT + PADR, HGT = PADT + PH + GAP + BH + PADB;
      const svg = el('svg', { width: W, height: HGT, viewBox: `0 0 ${W} ${HGT}` }); scroll.appendChild(svg);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < N; i++) { lo = Math.min(lo, d.l[i], d.s200[i], d.s50[i]); hi = Math.max(hi, d.h[i], d.s200[i], d.s50[i]); }
      const pad = (hi - lo) * .04; lo -= pad; hi += pad;
      const Y = v => PADT + PH - (v - lo) / (hi - lo) * PH, X = i => PADL + i * SLOT + SLOT / 2, XR = PADL + N * SLOT;
      const BY0 = PADT + PH + GAP, BY = v => BY0 + BH - (v / 100) * BH;
      for (const tv of ticks(lo, hi, 4)) {
        el('line', { x1: PADL, x2: XR, y1: Y(tv), y2: Y(tv), stroke: 'var(--lb-grid)', 'stroke-width': 1 }, svg);
        el('text', { x: XR + (narrow ? 38 : 50), y: Y(tv) + 3.5, 'font-size': 10, fill: 'var(--lb-muted)' }, svg).textContent = fmt(tv, 0);
      }
      for (let i = 1; i < N; i++) if (dates[i].slice(5, 7) !== dates[i - 1].slice(5, 7)) {
        el('line', { x1: X(i) - SLOT / 2, x2: X(i) - SLOT / 2, y1: PADT, y2: BY0 + BH, stroke: 'var(--lb-grid)', 'stroke-width': 1, 'stroke-dasharray': '1 3' }, svg);
        const mm = +dates[i].slice(5, 7);
        el('text', { x: X(i), y: BY0 + BH + 13, 'font-size': 10, fill: 'var(--lb-muted)', 'text-anchor': 'middle' }, svg).textContent = mm === 1 ? dates[i].slice(2, 4) + '年1月' : mm + '月';
      }
      el('line', { x1: PADL, x2: XR, y1: PADT + PH, y2: PADT + PH, stroke: 'var(--lb-axis)', 'stroke-width': 1 }, svg);
      for (let i = 0; i < N; i++) {
        const up = d.c[i] >= d.o[i], col = up ? 'var(--lb-up)' : 'var(--lb-down)';
        el('line', { x1: X(i), x2: X(i), y1: Y(d.h[i]), y2: Y(d.l[i]), stroke: col, 'stroke-width': 1 }, svg);
        const y1 = Y(Math.max(d.o[i], d.c[i])), y2 = Y(Math.min(d.o[i], d.c[i]));
        el('rect', { x: X(i) - BW / 2, y: y1, width: BW, height: Math.max(1, y2 - y1), fill: col }, svg);
      }
      const path = (arr, color, w, dash) => { let p = ''; for (let i = 0; i < N; i++) p += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(arr[i]).toFixed(1);
        el('path', { d: p, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round', ...(dash ? { 'stroke-dasharray': '4 3' } : {}) }, svg); };
      path(d.s200, 'var(--lb-sma)', 1.2, true); path(d.s50, 'var(--lb-sma)', 1.2, false); path(d.e9, 'var(--lb-e9)', 1.9, false); path(d.e21, 'var(--lb-e21)', 2.2, false);
      const labs = [[d.e21, '21E', 'var(--lb-e21)', 2.5], [d.e9, '9E', 'var(--lb-e9)', 2.5], [d.s50, '50S', 'var(--lb-sma)', 1.5], [d.s200, '200S', 'var(--lb-sma)', 1.5]]
        .map(([a, t, c, w]) => ({ y: Y(a[N - 1]), t, c, w })).sort((a, b) => a.y - b.y);
      for (let j = 1; j < labs.length; j++) if (labs[j].y - labs[j - 1].y < 11) labs[j].y = labs[j - 1].y + 11;
      for (const lb of labs) {
        el('line', { x1: XR + 3, x2: XR + 12, y1: lb.y - 3.5, y2: lb.y - 3.5, stroke: lb.c, 'stroke-width': lb.w, ...(lb.t === '200S' ? { 'stroke-dasharray': '3 2' } : {}) }, svg);
        el('text', { x: XR + 14, y: lb.y, 'font-size': 9.5, fill: 'var(--lb-ink2)' }, svg).textContent = lb.t;
      }
      // breadth pane
      el('line', { x1: PADL, x2: XR, y1: BY(50), y2: BY(50), stroke: 'var(--lb-grid)', 'stroke-width': 1, 'stroke-dasharray': '2 2' }, svg);
      el('line', { x1: PADL, x2: XR, y1: BY(20), y2: BY(20), stroke: 'var(--lb-axis)', 'stroke-width': 1 }, svg);
      el('text', { x: XR + 4, y: BY(50) + 3, 'font-size': 9, fill: 'var(--lb-muted)' }, svg).textContent = 'adv 50%';
      el('text', { x: XR + 4, y: BY(20) + 3, 'font-size': 9, fill: 'var(--lb-muted)' }, svg).textContent = '20%';
      for (let i = 0; i < N; i++) {
        const v = d.adv[i]; if (v == null) continue;
        const weak = v < 20 && i > 0 && d.adv[i - 1] != null && d.adv[i - 1] < 20;   // 連續兩日 <20% = 派發訊號
        el('rect', { x: X(i) - BW / 2, y: BY(v), width: BW, height: Math.max(1, BY0 + BH - BY(v)), fill: weak ? 'var(--lb-warn)' : (v < 20 ? 'var(--lb-down)' : 'var(--lb-muted)'), opacity: weak ? 1 : .75 }, svg);
      }
      // hover / touch
      const cross = el('line', { x1: -9, x2: -9, y1: PADT, y2: BY0 + BH, stroke: 'var(--lb-axis)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }, svg);
      const hit = el('rect', { x: PADL, y: 0, width: N * SLOT, height: HGT, fill: 'transparent' }, svg);
      const show = (cx, cy) => {
        const r = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(N - 1, Math.floor((cx - r.left - PADL) / SLOT)));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
        const gap = i ? (d.o[i] / d.c[i - 1] - 1) * 100 : 0, oc = (d.c[i] / d.o[i] - 1) * 100, day = i ? (d.c[i] / d.c[i - 1] - 1) * 100 : 0;
        const rp = d.h[i] - d.l[i] > 0 ? (d.c[i] - d.l[i]) / (d.h[i] - d.l[i]) : .5;
        tip.innerHTML = `<b>${L} ${dates[i]}</b><br>O ${fmt(d.o[i])} H ${fmt(d.h[i])} L ${fmt(d.l[i])} C <b>${fmt(d.c[i])}</b><br>日 <b>${sgn(day)}</b> 裂口 ${sgn(gap)} 開→收 ${sgn(oc)} 收位 ${fmt(rp, 2)} 闊度 ${d.adv[i] == null ? '—' : d.adv[i] + '%'}<br>9E ${fmt(d.e9[i])} · 21E ${fmt(d.e21[i])} · 50S ${fmt(d.s50[i])} · 200S ${fmt(d.s200[i])}`;
        tip.style.display = 'block'; const tw = tip.offsetWidth, th = tip.offsetHeight; let tx = cx + 14, ty = cy - th - 10;
        if (tx + tw > innerWidth - 8) tx = Math.max(4, cx - tw - 14); if (ty < 8) ty = cy + 16; tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
      };
      hit.addEventListener('mousemove', e => show(e.clientX, e.clientY));
      hit.addEventListener('touchstart', e => { const t = e.touches[0]; show(t.clientX, t.clientY); }, { passive: true });
      hit.addEventListener('touchmove', e => { const t = e.touches[0]; show(t.clientX, t.clientY); }, { passive: true });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('x1', -9); cross.setAttribute('x2', -9); });
      scroll.scrollLeft = scroll.scrollWidth;
      bar.querySelectorAll('.lb-seg button').forEach(b => b.classList.toggle('on', +b.dataset.n === NSHOW));
    }
    bar.querySelector('.lb-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; NSHOW = Math.min(+b.dataset.n, NALL); draw(); });
    document.addEventListener('touchend', () => { tip.style.display = 'none'; }, { passive: true });
    draw();
    let lastW = container.clientWidth, rt = null;
    const ro = ('ResizeObserver' in global) ? new ResizeObserver(() => { if (container.clientWidth === lastW) return; lastW = container.clientWidth; clearTimeout(rt); rt = setTimeout(draw, 120); }) : null;
    if (ro) ro.observe(container);
    container._lb = { ro };
    return { redraw: draw };
  }
  function destroy(container) { if (container._lb && container._lb.ro) container._lb.ro.disconnect(); container.innerHTML = ''; container.classList.remove('lb-root'); }
  global.LayerBars = { mount, destroy, regimeChip };
})(window);
