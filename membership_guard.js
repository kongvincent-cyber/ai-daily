/* Proposed local-review asset. Trusted manifests are supplied separately from payloads. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AIDailyMembershipGuard=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
  const same=(a,b)=>canonical(a)===canonical(b);
  const historicalVerified=new WeakSet();
  const hash=async(value,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('');
  function iso(day){
    assert(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day),'Membership date is invalid');
    const parsed=new Date(day+'T00:00:00Z');
    assert(Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===day,'Membership date is invalid');
    return day;
  }
  function members(groups){
    assert(plain(groups)&&Object.keys(groups).length>0,'Membership groups missing');
    const all=[];
    for(const [group,ts] of Object.entries(groups)){
      assert(group&&Array.isArray(ts),'Membership group invalid');
      for(const ticker of ts){assert(typeof ticker==='string'&&/^[A-Z][A-Z0-9.-]{0,19}$/.test(ticker),'Membership ticker invalid');all.push(ticker);}
    }
    assert(all.length>0&&new Set(all).size===all.length,'Membership duplicate or empty');
    return all;
  }
  function groupsAt(manifest,day){
    iso(day);
    assert(plain(manifest)&&manifest.schema_version===1&&['production','trial'].includes(manifest.mode)&&typeof manifest.manifest_id==='string'&&manifest.manifest_id,'Trusted membership manifest invalid');
    assert(Array.isArray(manifest.versions)&&manifest.versions.length>0&&manifest.versions[0].effective_from==='0001-01-01','Membership baseline missing');
    let prior=null,selected=null,keys=null;const versions=new Set();
    for(const row of manifest.versions){
      assert(plain(row),'Membership snapshot invalid');iso(row.effective_from);
      assert(prior===null||row.effective_from>prior,'Membership dates unordered');prior=row.effective_from;
      assert(typeof row.version==='string'&&row.version&&!versions.has(row.version),'Membership version duplicate');versions.add(row.version);
      members(row.groups);const current=Object.keys(row.groups).sort();
      assert(keys===null||same(keys,current),'Membership group keys changed');keys=current;
      if(row.effective_from<=day)selected=row;
    }
    assert(selected,'No dated membership snapshot');return selected;
  }
  function normalized(groups){return Object.fromEntries(Object.keys(groups).sort().map(g=>[g,groups[g].slice().sort()]));}
  async function historicalArchive(data,bytes,entry,crypto){
    assert(entry&&entry.before==='2026-11-09'&&data.date===entry.date&&data.date<entry.before&&!data.membership?.is_trial,'Historical archive date or identity differs');
    assert(await hash(bytes,crypto)===entry.ciphertext_sha256,'Historical archive bytes differ');
    const groups=Object.fromEntries(Object.entries(data.members||{}).map(([g,rows])=>[g,rows.map(row=>row.t)]));
    const actual=members(groups);
    assert(actual.length===entry.actual_member_count&&data.usize===entry.reported_count,'Historical archive counts differ');
    assert(await hash(new TextEncoder().encode(canonical(normalized(groups))),crypto)===entry.membership_sha256,'Historical archive members differ');
    historicalVerified.add(data);return {legacy:true,historical:true,expected:actual.length};
  }
  async function verify(groups,day,metadata,manifest,crypto){
    const actual=members(groups),selected=groupsAt(manifest,day);
    assert(plain(metadata),'Membership metadata required');
    const bytes=new TextEncoder().encode(canonical(manifest));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    const expected={manifest_id:manifest.manifest_id,manifest_sha256:hash,version:selected.version,effective_from:selected.effective_from,
      asof:day,member_count:members(selected.groups).length,group_counts:Object.fromEntries(Object.entries(selected.groups).map(([g,ts])=>[g,ts.length])),
      is_trial:manifest.mode==='trial',production_publish_allowed:manifest.mode!=='trial'};
    for(const [key,value] of Object.entries(expected))assert(same(metadata[key],value),'Membership metadata mismatch: '+key);
    assert(same(normalized(groups),normalized(selected.groups)),'Exact dated membership/group mismatch');
    return {members:actual,expected:expected.member_count,metadata:expected,legacy:false};
  }
  async function payload(data,manifest,crypto){
    const groups=Object.fromEntries(Object.entries(data.members||{}).map(([g,rows])=>[g,rows.map(row=>row.t)]));
    if(!data.membership){
      const all=members(groups);
      assert(data.usize===255&&all.length===255&&Object.keys(groups).length===9,'Legacy membership incomplete');
      return {members:all,expected:255,legacy:true,metadata:null};
    }
    const result=await verify(groups,data.date,data.membership,manifest,crypto);
    assert(data.usize===result.expected,'Payload member count mismatch');return result;
  }
  async function baseline(data,manifest,crypto,options={}){
    assert(data&&data.schema===1&&data.asof,'Baseline invalid');
    if(!data.membership){
      assert(Object.keys(data.closes||{}).length===255,'Legacy baseline incomplete');
      return {expected:255,legacy:true,metadata:null};
    }
    const groups=Object.fromEntries(Object.entries(data.layers||{}).map(([g,layer])=>[g,layer.members]));
    assert(Object.values(data.layers).every(layer=>[layer.close,layer.ema21].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)),'Baseline index seed invalid');
    let result;
    if(data.next_membership){
      assert(data.next_session&&data.asof<data.next_session,'Next-session date invalid');
      await verify(data.closing_members,data.asof,data.membership,manifest,crypto);
      result=await verify(groups,data.next_session,data.next_membership,manifest,crypto);
      const previous=new Set(members(data.closing_members));
      for(const ticker of result.members.filter(t=>!previous.has(t))){
        const evidence=data.close_sources?.[ticker];
        assert(evidence&&evidence.date===data.asof&&evidence.source==='Massive'&&evidence.price_basis==='raw_daily_close_at_source_cutoff'&&['daily_history','grouped_daily'].includes(evidence.source_kind)&&/^[a-f0-9]{64}$/.test(evidence.source_sha256)&&typeof evidence.source_url==='string'&&evidence.source_url.startsWith('https://api.massive.com/')&&typeof evidence.retrieved_at==='string'&&Number.isFinite(Date.parse(evidence.retrieved_at)),'Entrant prior-close provenance missing: '+ticker);
      }
    }else result=await verify(groups,data.asof,data.membership,manifest,crypto);
    assert(same(Object.keys(data.closes||{}).sort(),result.members.slice().sort()),'Baseline close identities mismatch');
    assert(Object.values(data.closes).every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0),'Baseline close invalid');
    if(data.next_session){
      // A prior-day universe cannot silently price a changed next-session
      // portfolio. New members need verified preceding closes and group seeds.
      assert(same(normalized(groups),normalized(groupsAt(manifest,data.next_session).groups)),'Membership transition needs a next-session baseline');
    }
    if(result.metadata.is_trial)assert(typeof module==='object'&&!!module.exports&&options.localTrialPreview===true,'Trial baseline is local-test only');
    return result;
  }
  function overlayMembers(packet,verifiedBaseline,day){
    if(verifiedBaseline?.next_session===day)return Object.fromEntries(Object.entries(verifiedBaseline.layers).map(([g,layer])=>[g,layer.members.map(t=>({t}))]));
    return packet?.members||{};
  }
  function formalIndex(packet){
    if(historicalVerified.has(packet))return null;
    const proof=packet?.indexPackaging, manifest=packet?.membership_manifest;
    let changed=packet?.usize!==255;
    if(manifest){
      const original=normalized(manifest.versions[0].groups);
      // Pending transitions already require one coherent2022 package.
      changed=changed||manifest.versions.some(v=>!same(original,normalized(v.groups)));
    }
    if(!proof){assert(!changed,'Changed membership requires audited formal index');return null;}
    const source=proof.source_index;
    assert(source&&source.asof===packet.date&&source.base==='2022-01-03'&&source.series_id==='ai-formal-dated-2022-v1'&&source.method_version==='carry-last-valid-v2','Formal index source identity differs');
    assert(/^[a-f0-9]{64}$/.test(source.publication_sha256)&&source.publication_sha256===packet.indexRevision,'Formal index revision differs');
    assert(source.membership_manifest_sha256===packet.membership?.manifest_sha256,'Formal index membership differs');
    assert(proof.schema===1&&proof.independent_math==='passed'&&proof.timeframes==='passed'&&/^[a-f0-9]{64}$/.test(proof.candidate_sha256)&&/^[a-f0-9]{64}$/.test(proof.component_sha256),'Formal index verification proof missing');
    for(const part of [packet.layerBars,packet.aiUniverseIndex]){
      const meta=part?.meta;
      assert(meta&&['asof','base','series_id','method_version','publication_sha256'].every(k=>meta[k]===source[k])&&meta.membership?.manifest_sha256===source.membership_manifest_sha256,'Formal index components differ');
      assert(part.dates?.at(-1)===packet.date,'Formal index component cutoff differs');
    }
    assert(packet.aiUniverseIndex.member_count===packet.usize,'Formal index member count differs');
    assert(same(Object.keys(packet.layerBars.layers).sort(),Object.keys(packet.members).sort()),'Formal index layers differ');
    for(const [g,rows] of Object.entries(packet.members))assert(packet.layerBars.layers[g].n===rows.length,'Formal index layer count differs');
    return source;
  }
  function liveIndex(packet,live){
    const expected=formalIndex(packet),actual=live?.source_index;
    if(!expected&&!actual)return true;
    assert(expected&&actual&&same(expected,actual),'Live index source does not match displayed formal revision');
    assert(live.asof===packet.date,'Live index closing date differs');
    for(const [g,layer] of Object.entries(packet.layerBars.layers)){
      assert(live.layers?.[g]?.close===layer.c.at(-1)&&live.layers[g].ema21===layer.e21.at(-1),'Live index close or EMA differs');
    }
    return true;
  }
  return {canonical,groupsAt,verify,payload,baseline,overlayMembers,formalIndex,liveIndex,historicalArchive,isHistorical:packet=>historicalVerified.has(packet)};
});
