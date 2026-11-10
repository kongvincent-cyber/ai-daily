/* layer_bars_glue.js — 將 layer_bars_tab.js 接駁落現有 app（2026-09-01 批次；v1.1 2026-09-08 修 6M/12M 冒泡收起）。
 * 硬規則：additive。現有成員表／選股／裁決邏輯一律唔動；全部包 try/catch，
 * 任何 exception 只 console.warn；window.LB_ENABLED=false 即整個關掉，頁面同改動前一模一樣。
 * 掛接點：renderRows() 完成之後 call LBGlue.afterGroupTable() 同 LBGlue.afterLevelDetail()。
 */
(function (global) {
  'use strict';
  if (global.LB_ENABLED === undefined) global.LB_ENABLED = true;
  var mounted = [];
  var CSS = '.lb-tabs{display:inline-flex;border:1px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden;margin:2px 0 8px}'
    + '.lb-tabs button{background:transparent;color:#c9d1e1;border:0;padding:4px 12px;font-size:12px;cursor:pointer}'
    + '.lb-tabs button.on{background:#e6e8ee;color:#10151f;font-weight:650}'
    + '.lb-idx-msg{font-size:11.5px;color:#8b93a7;padding:6px 2px}'
    + '.lb-chipline{margin-top:2px;max-width:100%;overflow:hidden}'
    + '.lb-chipline .lb-regime{font-size:10px;padding:0 5px;display:inline-block;max-width:100%}';
  function css() {
    if (!document.getElementById('lb-glue-css')) {
      var s = document.createElement('style'); s.id = 'lb-glue-css'; s.textContent = CSS; document.head.appendChild(s);
    }
  }
  function payload() { return (typeof D !== 'undefined' && D && D.layerBars) ? D.layerBars : null; }
  function median(L) {
    try { var g = (typeof D !== 'undefined' && D.groups || []).find(function (x) { return x.g === L; }); return g ? g.med : null; }
    catch (e) { return null; }
  }
  function sweep() {                                    // renderRows 換咗 innerHTML → 舊 container 已 detach，收返 ResizeObserver
    mounted = mounted.filter(function (el) {
      if (document.body.contains(el)) return true;
      try { global.LayerBars && LayerBars.destroy(el); } catch (e) { }
      return false;
    });
  }
  function universeIndex() {
    var host = document.getElementById('grows');
    if (!host) return;
    var data = typeof D !== 'undefined' && D && D.aiUniverseIndex;
    var old = document.getElementById('ai-universe-index');
    if (!data || !data.meta || data.meta.status !== 'verified' || data.meta.asof !== D.date) {
      if (old) { if(old._indexChart) old._indexChart.destroy(); old.remove(); }
      return;
    }
    var key = D.date + ':' + (D.indexRevision || '');
    if (old && old.getAttribute('data-revision') === key) return;
    if (old) { if(old._indexChart) old._indexChart.destroy(); old.remove(); }
    var c = data.c, last = c[c.length - 1], prev = c[c.length - 2];
    if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return;
    var card = document.createElement('details'); card.id = 'ai-universe-index';
    card.setAttribute('data-revision', key); card.style.cssText = 'margin:10px 0;padding:12px;border:1px solid rgba(128,128,128,.3);border-radius:10px';
    var title = document.createElement('summary');
    title.textContent = '全 AI 等權綜合指數  ' + last.toFixed(2) + '  ' + ((last / prev - 1) * 100).toFixed(2) + '%';
    title.title = 'AI Equal-Weight Composite Index';
    title.style.cursor = 'pointer'; card.appendChild(title);
    var description = document.createElement('p');
    description.textContent = D.date + ' 收市 · ' + data.member_count + ' 隻成員 · 每股等權日鏈 · ' + data.meta.base + '=100';
    description.style.fontSize = '12px'; card.appendChild(description);
    if(data.timeframes && global.LayerBars && global.LayerBars.mountTimeframes){
      var panel=document.createElement('div');card.appendChild(panel);
      card._indexChart=global.LayerBars.mountTimeframes(panel,data.timeframes,'全 AI 等權綜合指數');
    } else {
    var values = c.slice(-126), low = Math.min.apply(null, values), high = Math.max.apply(null, values);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 600 160'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','全 AI 等權綜合指數最近六個月走勢');
    svg.style.cssText = 'width:100%;height:auto;display:block';
    var line = document.createElementNS(svg.namespaceURI,'polyline');
    line.setAttribute('points', values.map(function(v,i){ return (10 + i * 580 / Math.max(1,values.length-1)) + ',' + (150 - (v-low) * 140 / (high-low || 1)); }).join(' '));
    line.setAttribute('fill','none'); line.setAttribute('stroke','#3987e5'); line.setAttribute('stroke-width','2.5'); svg.appendChild(line); card.appendChild(svg);
    var ma = document.createElement('p');
    ma.textContent = [['21EMA','e21'],['50SMA','s50'],['150SMA','s150'],['200SMA','s200']].map(function(x){var v=data[x[1]][c.length-1];return x[0]+': '+(v==null?'歷史不足':v.toFixed(2));}).join(' · ');
    ma.style.cssText='font-size:12px;line-height:1.7'; card.appendChild(ma);
    }
    var note = document.createElement('p'); note.style.fontSize='11px';
    note.textContent='直接由全體合資格股票計算，唔係各 layer 等權平均。拆股已調整；不含股息再投資。'+(data.meta.series_id==='ai-formal-dated-2022-v1'?'正式日期鏈：成員按生效日；最初255基線為回溯，並非2022當時點名單。':'歷史採現有成員回溯。');card.appendChild(note);
    var quality = document.createElement('p'); quality.style.cssText='font-size:12px;line-height:1.7';
    var coverage = data.meta.coverage || [], today = coverage[coverage.length-1];
    var audit = data.meta.independent_source;
    quality.textContent = '缺價採最後有效價估值；恢復報價時計入累積變動。' +
      (today ? ' 今日實際報價 '+today.observed+'；沿用估值 '+today.carried+'。' : '') +
      (audit ? ' 第二來源收市價核對：'+audit.matched+'/'+audit.expected+' 一致。'+(audit.status==='price_agreement_all'?'':'其餘未核實或有差異。') : ' 第二來源核對未完成。');
    card.appendChild(quality);
    if (today && today.layers) {
      var layerQuality=document.createElement('p');layerQuality.style.fontSize='11px';
      layerQuality.textContent=Object.keys(today.layers).map(function(g){var x=today.layers[g];return g+' 報價 '+x.observed+'／估值 '+x.valued+'（沿用 '+x.carried+'）';}).join(' · ');
      card.appendChild(layerQuality);
    }
    var exceptions=audit && audit.exceptions || [];
    var flags=data.meta.valuation_flags || [];
    if (exceptions.length || flags.length) {
      var details=document.createElement('details'), heading=document.createElement('summary');
      heading.textContent='核對差異及歷史缺價紀錄';details.appendChild(heading);
      var list=document.createElement('ul');list.style.cssText='font-size:11px;max-height:220px;overflow:auto';
      exceptions.forEach(function(x){var li=document.createElement('li');li.textContent=x.ticker+' '+x.date+'：'+x.status+'；主來源 '+x.primary_close+'／第二來源 '+x.secondary_close;list.appendChild(li);});
      flags.forEach(function(x){var li=document.createElement('li');li.textContent=x.ticker+' '+x.date+'：沿用 '+x.last_observed+' 估值（'+x.stale_sessions+' 個交易日）；'+x.reason;list.appendChild(li);});
      details.appendChild(list);card.appendChild(details);
    }
    host.parentNode.insertBefore(card,host);
  }
  function decorate() {
    if (!global.LB_ENABLED) return;
    css(); sweep(); universeIndex();
    var LB = payload();
    document.querySelectorAll('#grows .grow').forEach(function (grow) {
      var L = grow.getAttribute('data-g'); if (!L) return;
      // chip 放入 .gname（固定 104px、可換行）而唔係 append 落 .row：
      // .row 係固定欄寬 flex，尾部加嘢會令 390px 手機出現橫向 body 捲動（實測 scrollWidth 402）。
      var nameCell = grow.querySelector('.gname');
      if (nameCell && LB && global.LayerBars && !nameCell.querySelector('.lb-regime')) {
        var h = LayerBars.regimeChip(LB, L);
        if (h) { var w = document.createElement('div'); w.className = 'lb-chipline'; w.innerHTML = h; nameCell.appendChild(w); }
      }
      var mem = grow.querySelector('.mem');
      if (!mem || !mem.classList.contains('open') || mem.getAttribute('data-lb')) return;
      mem.setAttribute('data-lb', '1');
      var memWrap = document.createElement('div');
      while (mem.firstChild) memWrap.appendChild(mem.firstChild);
      var tabs = document.createElement('div'); tabs.className = 'lb-tabs';
      tabs.innerHTML = '<button data-t="mem" class="on">成員</button><button data-t="idx">指數</button>';
      var idx = document.createElement('div'); idx.style.display = 'none';
      idx.addEventListener('click', function (ev) { ev.stopPropagation(); });   // v1.1 2026-09-08：指數 tab 內任何 click（3M/6M/12M、圖面 tooltip）唔可以冒泡到 .grow onclick=tgG()，否則整行收起、component 被 renderRows() 銷毀
      mem.appendChild(tabs); mem.appendChild(memWrap); mem.appendChild(idx);
      tabs.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var b = ev.target.closest('button'); if (!b) return;
        var want = b.getAttribute('data-t');
        tabs.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        memWrap.style.display = want === 'mem' ? '' : 'none';
        idx.style.display = want === 'idx' ? '' : 'none';
        if (want === 'idx' && !idx.getAttribute('data-m')) {
          idx.setAttribute('data-m', '1');
          try {
            var d = payload();
            if (d && d.layers && d.layers[L] && global.LayerBars) { LayerBars.mount(idx, d, L, { median: median(L) }); mounted.push(idx); }
            else { idx.innerHTML = '<div class="lb-idx-msg">指數數據未生成（今晚 pipeline 未跑成功）</div>'; }
          } catch (e) { idx.innerHTML = '<div class="lb-idx-msg">指數載入失敗</div>'; console.warn('LayerBars mount', e); }
        }
      });
    });
  }
  function safe() { try { decorate(); } catch (e) { console.warn('LB glue', e); } }
  global.LBGlue = { afterGroupTable: safe, afterLevelDetail: safe };
})(window);
