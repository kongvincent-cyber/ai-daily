/* One-time owner setup. Nothing reads or transmits a key until the owner's tap. */
(()=>{
  'use strict';
  const app=document.getElementById('app');
  if(!app)return;
  const panel=document.createElement('details');
  panel.id='automatic-setup';
  panel.style.cssText='margin:16px 0;padding:14px;border:1px solid #344159;border-radius:10px;font-size:14px;line-height:1.6';
  panel.innerHTML=`<summary style="cursor:pointer;font-weight:600">每日自動更新設定（只做一次）</summary>
    <p id="automatic-state">設定後由伺服器每日收市後更新，你只需重新開 App。毋須每日下載或傳送 ZIP。</p>
    <p>先將現有 App 金鑰存入你自己的私人 GitHub 項目。唔需要記得舊密碼。</p>
    <label style="display:block"><input type="checkbox" id="automatic-consent"> 我同意將現有 App 金鑰存入自己的私人 GitHub Actions Secret，供每日加密更新使用。</label>
    <button type="button" id="automatic-copy" style="margin:12px 0;padding:10px;font-size:14px">複製現有 App 金鑰</button>
    <p id="automatic-copy-status" role="status"></p>
    <p><a href="https://github.com/kongvincent-cyber/ai-daily-system/settings/secrets/actions/new" target="_blank" rel="noopener noreferrer">開啟私人 GitHub 設定</a>：Name 填 <code>APP_KEY_B64</code>，Secret 貼上，按 Add secret。</p>
    <p>此金鑰等同解鎖權限；只貼入上述私人項目的 Secret，唔好傳入對話或公開檔案。</p>
    <p>另需一次性設定發布權限 <code>APP_PUBLISH_TOKEN</code>。兩項完成後，從 GitHub Actions 驗證並啟用；未驗證前唔代表自動更新已生效。</p>`;
  const subtitle=document.getElementById('sub');
  if(subtitle)subtitle.insertAdjacentElement('afterend',panel);
  else app.appendChild(panel);
  document.getElementById('automatic-copy').addEventListener('click',()=>{
    const msg=document.getElementById('automatic-copy-status');
    if(!document.getElementById('automatic-consent').checked){msg.textContent='請先確認上面的一次性授權。';return;}
    if(typeof KEY==='undefined'||!KEY||typeof D==='undefined'||!D){msg.textContent='請先等 App 成功自動解鎖。';return;}
    try{
      const saved=localStorage.getItem('k');
      if(!saved||atob(saved).length!==32)throw new Error();
      // Synchronous lookup + immediate clipboard call keeps the iOS user gesture.
      navigator.clipboard.writeText(saved).then(()=>{
        msg.textContent='已複製。請開啟私人 GitHub 設定，貼入 APP_KEY_B64 的 Secret。';
      }).catch(()=>{msg.textContent='瀏覽器未允許複製，請用你平時已解鎖的 App 再試。金鑰並未傳出。';});
    }catch(_){msg.textContent='現有金鑰暫時無法複製。請勿清除 App 或網站資料。';}
  });
  window.AIAutomationStatus=()=>{
    const state=document.getElementById('automatic-state');
    const top=document.getElementById('auto-update-status');
    if(typeof D==='undefined'||!D)return;
    if(D.automation){
      panel.hidden=true;
      panel.open=false;
      state.textContent='伺服器自動更新資料日期：'+D.date+'。日常使用毋須再做此設定。';
      if(top)top.textContent='自動更新 · '+D.date+(D.automation.research_missing?.length?' · 部分財報關注點待研究':'');
    }else if(top){top.textContent='資料日期 '+D.date+' · 每日自動發布尚待一次性設定';}
  };
  window.AIAutomationStatus();
})();
