/* layer_bars_glue.js — 將 layer_bars_tab.js 接駁落現有 app（2026-09-01 批次）。
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
  function decorate() {
    if (!global.LB_ENABLED) return;
    css(); sweep();
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
