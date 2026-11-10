/* Authenticated closing-only research. Never writes D, formal layers or live state. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.AIResearchIndexes=api;api.install(root);}
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const IDS={research318:'ai-research318-current-members-2022-v1',matched255:'ai-research255-comparator-2022-v1'};
  const GROUPS=['ALL_AI','L1','L2','L3','L4','L5','L6','SP','M','Q'];
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
  const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function validateCatalog(c){
    assert(c&&c.schema===1&&c.kind==='ai-research-index-catalog'&&c.base==='2022-01-03'&&hash(c.revision)&&hash(c.ciphertext_sha256),'研究目錄身份不符');
    assert(c.path==='research/indexes/'+c.revision+'.enc','研究路徑不符');
    for(const k of Object.keys(IDS))assert(c.series_ids?.[k]===IDS[k],'研究系列不符');
    return c;
  }
  function validatePacket(p,c){
    validateCatalog(c);
    assert(p&&p.schema===1&&p.kind==='ai-research-indexes'&&p.base==='2022-01-03'&&p.base_value===100&&p.live_overlay===false&&p.method_version==='carry-last-valid-v2','研究口徑不符');
    assert(p.revision===c.revision&&p.asof===c.asof&&hash(p.source_packet_sha256),'研究版本或日期不符');
    assert(same(Object.keys(p.series||{}).sort(),Object.keys(IDS).sort()),'研究比較系列缺漏');
    for(const [key,id] of Object.entries(IDS)){
      const s=p.series[key], n=key==='research318'?318:255;
      assert(s.series_id===id&&s.member_count===n&&hash(s.revision)&&hash(s.manifest_sha256)&&hash(s.policy_sha256)&&hash(s.input_sha256),'研究名單或來源版本不符');
      assert(Array.isArray(s.dates)&&s.dates.length>1&&s.dates[0]===p.base&&s.dates.at(-1)===p.asof&&same(s.dates,[...new Set(s.dates)].sort()),'研究日期序列不符');
      assert(same(Object.keys(s.frames||{}).sort(),GROUPS.slice().sort()),'研究九層或綜合指數缺漏');
      assert(s.quality?.sessions===s.dates.length,'研究交易日數不符');
      for(const g of GROUPS){
        const frames=s.frames[g];
        for(const unit of ['day','week','month']){
          const f=frames[unit];
          assert(f&&f.unit===unit&&f.count===f.c?.length&&f.c.length===f.dates?.length&&f.c.every(finite)&&f.dates.at(-1)===p.asof,'研究時框資料不符');
          for(const k of ['e9','e21','s50','s150','s200','complete'])assert(Array.isArray(f[k])&&f[k].length===f.c.length,'研究均線／期末狀態缺漏');
          assert(f.c.at(-1)===frames.day.c.at(-1),'研究時框最後收位不一致');
        }
        assert(same(frames.day.dates,s.dates)&&frames.day.c[0]===100,'研究共同基準不符');
      }
    }
    assert(same(p.series.research318.dates,p.series.matched255.dates),'研究比較日期不一致');
    return p;
  }
  async function fetchPacket(fetcher,decrypt,crypto){
    const response=await fetcher('research/indexes/catalog.enc?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('研究資料尚未發布');
    const catalog=validateCatalog(await decrypt(await response.arrayBuffer()));
    const result=await fetcher(catalog.path,{cache:'no-store'});
    if(!result.ok)throw Error('研究資料暫未取得');
    const bytes=await result.arrayBuffer();
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    assert(actual===catalog.ciphertext_sha256,'研究資料版本驗證失敗');
    return validatePacket(await decrypt(bytes),catalog);
  }
  function install(window){
    const document=window.document;
    let packet=null,box=null,content=null,status=null,inFlight=null,view='research318',group='ALL_AI',mounted=null;
    const node=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;};
    const value=x=>Number.isFinite(x)?x.toFixed(2):'—';
    const pct=x=>(x>0?'+':'')+value(x)+'%';
    function init(){
      if(box)return;
      const host=document.getElementById('research-indexes-slot');if(!host)return;
      box=node('details');box.className='card';box.id='research-indexes';box.style.cssText='margin:12px 0;min-width:0;overflow-wrap:anywhere';
      const heading=node('summary','研究指數 · 318回溯與同源255比較');heading.style.cssText='font-weight:650;cursor:pointer;padding:6px 0';box.append(heading);
      const refresh=node('button','重新檢查研究資料');refresh.type='button';refresh.onclick=()=>load();box.append(refresh);
      status=node('p');status.className='lab';status.setAttribute('role','status');box.append(status);
      content=node('div');box.append(content);host.append(box);
    }
    function render(){
      if(!packet||!content)return;
      if(mounted)mounted.destroy();mounted=null;content.replaceChildren();
      const s=packet.series[view], count=s.member_count;
      status.textContent='資料截至 '+packet.asof+' 收市 · 全部以 '+packet.base+' = 100 · '+s.quality.sessions+' 個交易日';
      const description=node('p','現有成員回溯，有選擇及存續偏差；不代表當時實際持倉。255比較使用相同原始行情及拆股資料重新計算。此區只顯示收市研究資料。');description.style.cssText='font-size:12px;line-height:1.6';content.append(description);
      const controls=node('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:10px 0';
      const choices=node('select');choices.setAttribute('aria-label','研究名單');choices.id='research-universe';
      for(const [key,label] of [['research318','318研究名單'],['matched255','同源255比較']]){const option=node('option',label);option.value=key;choices.append(option);}choices.value=view;choices.onchange=()=>{view=choices.value;render();};controls.append(choices);
      const groups=node('select');groups.setAttribute('aria-label','研究層級');groups.id='research-layer';
      for(const g of GROUPS){const option=node('option',g==='ALL_AI'?'全 AI 綜合指數':g);option.value=g;groups.append(option);}groups.value=group;groups.onchange=()=>{group=groups.value;render();};controls.append(groups);content.append(controls);
      const chart=node('div');chart.id='research-index-chart';chart.dataset.series=s.series_id;chart.dataset.revision=packet.revision;content.append(chart);
      if(window.LayerBars?.mountTimeframes)mounted=window.LayerBars.mountTimeframes(chart,s.frames[group],count+'研究 · '+group);
      else chart.textContent='圖表元件暫未載入，以下收市比較仍可查閱。';
      const quality=node('p');quality.className='lab';
      const current=s.coverage.at(-1), base=s.quality.base_participants[group], participants=s.quality.last_return_participants[group];
      quality.textContent='基準日參與 '+base+' 隻 · 最新回報分母 '+participants+' 隻'+(current?' · 全體最新實際報價 '+current.observed+'／估值 '+current.valued+'（沿用 '+current.carried+'）':'')+' · 全期未解缺價 '+s.quality.unresolved_gap_securities+' 隻／'+s.quality.unresolved_gap_sessions+' 股日 · 全期沿用估值 '+s.quality.carried_security_sessions+' 股日。';content.append(quality);
      const wrap=node('div');wrap.style.overflowX='auto';const table=node('table');table.style.cssText='width:100%;font-size:12px;border-collapse:collapse';table.setAttribute('aria-label','九層及綜合指數同源比較');
      const row=(values,header=false)=>{const tr=node('tr');for(const v of values){const cell=node(header?'th':'td',v);cell.style.cssText='text-align:right;padding:7px 5px;border-bottom:1px solid #334155;white-space:nowrap';tr.append(cell);}table.append(tr);};
      row(['指數','318收位','255收位','318基準累升','255基準累升'],true);
      for(const g of GROUPS){const a=packet.series.research318.frames[g].day.c.at(-1),b=packet.series.matched255.frames[g].day.c.at(-1);row([g,value(a),value(b),pct(a-100),pct(b-100)]);}wrap.append(table);content.append(wrap);
      const method=node('p','每股等權日鏈；ALL_AI直接由股票計算，並非九層等權平均。價格回報不含股息再投資。缺價沿用最後有效估值，恢復報價時計入累積變動；不補上市前價格。合成OHLC不能用作ATR。');method.className='lab';content.append(method);
      const detail=node('details'),title=node('summary','研究版本及資料限制');detail.append(title);
      const provenance=node('p',s.series_id+' · 名單 '+s.membership_version+' · 研究版本 '+packet.revision.slice(0,12)+' · 原始資料 '+packet.source_packet_sha256.slice(0,12));provenance.className='lab';detail.append(provenance);
      detail.append(node('p','獨立算術核對使用同一行情來源，並非全歷史雙供應商驗證。舊B21暖機規則保留；早期讀數不屬嚴格當時點回測。已封存正式歷史不會被此研究比較覆寫。'));content.append(detail);
    }
    function load(){
      if(inFlight)return inFlight;
      if(typeof KEY==='undefined'||!KEY)return Promise.resolve();
      init();if(!box)return Promise.resolve();status.textContent='核對加密研究資料…';
      inFlight=(async()=>{
        try{const candidate=await fetchPacket(window.fetch.bind(window),buf=>dec(buf),window.crypto);packet=candidate;render();}
        catch(error){status.textContent=(packet?'保留 '+packet.asof+' 已核實研究資料；':'')+error.message+'。可按重新檢查。';}
      })().finally(()=>{inFlight=null;});
      return inFlight;
    }
    window.AIResearchRefresh=load;
    window.addEventListener('online',load);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    load();
  }
  return {validateCatalog,validatePacket,fetchPacket,install};
});
