import{n as e,t}from"./storage-9lXoiOOs.js";import{a as n,r,t as i}from"./s2-health-BH-8SKyF.js";var a=document.getElementById(`typesafeApiKey`),o=document.getElementById(`toggleApiKeyBtn`),s=document.getElementById(`typesafeModel`),c=document.getElementById(`confidenceThreshold`),l=document.getElementById(`systemTwoEndpoint`),u=document.getElementById(`systemTwoModel`),d=document.getElementById(`testOllamaBtn`),f=document.getElementById(`ollamaFeedback`),p=document.getElementById(`saveBtn`),m=document.getElementById(`resetBtn`),h=document.getElementById(`status`),g=document.getElementById(`workflowCountTitle`),_=document.getElementById(`addNewWorkflowBtn`),v=document.getElementById(`workflowsContainer`),y=document.getElementById(`testUrlInput`),b=document.getElementById(`testUrlBtn`),x=document.getElementById(`testUrlResult`),S=!1,C=[];o.addEventListener(`click`,()=>{S=!S,a.type=S?`text`:`password`,o.textContent=S?`🙈`:`👁️`});function w(e){return e?e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`):``}async function T(){let e=await t();a.value=e.typesafeApiKey||``,s.value=e.typesafeModel||`jev-latest`,c.value=String(e.confidenceThreshold||.7),l.value=e.systemTwoEndpoint||`http://localhost:11434/v1`,u.value=`deepseek-v4.1-flash:cloud`,await E()}T();async function E(){try{let e=await chrome.runtime.sendMessage({type:`GET_ALL_WORKFLOWS`});C=e&&e.workflows?e.workflows:await r.getAllWorkflows()}catch{C=await r.getAllWorkflows()}D()}function D(){if(g.textContent=`已配置工作流列表 (共 ${C.length} 个)`,v.innerHTML=``,C.length===0){v.innerHTML=`
      <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 24px; background: #0b1120; border-radius: 8px; border: 1px dashed #1e293b;">
        暂无任何工作流 Recipe，点击上方【➕ 新建自定义工作流】即可快速创建。
      </div>
    `;return}C.forEach(e=>{let t=document.createElement(`div`);t.className=`wf-card`,t.id=`card_${e.id}`;let n=e.meta.matchUrl||`*`;t.innerHTML=`
      <div class="wf-card-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; font-size: 13px; color: #f8fafc;">${w(e.meta.name)}</span>
          <span class="tag-custom">动态 Recipe</span>
        </div>
        <div style="font-size: 11px; color: #64748b; font-family: monospace;">ID: ${w(e.id)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>工作流名称 (Name):</label>
          <input type="text" class="wf-name-input" value="${w(e.meta.name)}" />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>适用页面规则 (Match Rule): <span class="label-hint">(* 全部, /正则/, 域名)</span></label>
          <input type="text" class="wf-match-input" value="${w(n)}" placeholder="*" />
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <label>功能描述 (Description):</label>
        <input type="text" class="wf-desc-input" value="${w(e.meta.description||``)}" placeholder="工作流用途简述..." />
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="margin-bottom: 0;">JavaScript 异步执行函数 (Workflow Function):</label>
          <button type="button" class="btn-secondary toggle-code-btn" style="padding: 2px 8px; font-size: 11px;">收起/展开代码 ⏷</button>
        </div>
        <textarea class="code-textarea wf-script-input" spellcheck="false">${w(e.script||``)}</textarea>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div class="wf-save-status" style="font-size: 11px; color: var(--success); font-weight: 500;"></div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-secondary copy-code-btn" style="font-size: 11px; padding: 5px 10px;">📋 复制代码</button>
          <button type="button" class="btn-secondary delete-wf-btn" style="font-size: 11px; padding: 5px 10px; color: #fca5a5; border-color: #7f1d1d;">🗑️ 删除</button>
          <button type="button" class="btn-save save-wf-btn" style="font-size: 11px; padding: 5px 12px;">💾 保存修改</button>
        </div>
      </div>
    `;let r=t.querySelector(`.toggle-code-btn`),i=t.querySelector(`.wf-script-input`);r.addEventListener(`click`,()=>{i.style.display===`none`?(i.style.display=`block`,r.textContent=`收起代码 ⏶`):(i.style.display=`none`,r.textContent=`展开代码 ⏷`)});let a=t.querySelector(`.copy-code-btn`);a.addEventListener(`click`,()=>{let e=i.value;navigator.clipboard.writeText(e).then(()=>{a.textContent=`已复制 ✓`,setTimeout(()=>{a.textContent=`📋 复制代码`},1500)})});let o=t.querySelector(`.save-wf-btn`),s=t.querySelector(`.delete-wf-btn`),c=t.querySelector(`.wf-name-input`),l=t.querySelector(`.wf-match-input`),u=t.querySelector(`.wf-desc-input`),d=t.querySelector(`.wf-save-status`);o?.addEventListener(`click`,async()=>{let t=i.value.trim(),n=c.value.trim()||e.meta.name,r=l.value.trim()||`*`,a=u.value.trim()||e.meta.description;o.textContent=`正在校验...`;try{let e=await chrome.runtime.sendMessage({type:`VALIDATE_WORKFLOW_SCRIPT`,script:t});if(e&&e.valid===!1){o.textContent=`💾 保存修改`,alert(`JavaScript 语法错误，无法编译:\n${e.error}`);return}}catch(e){console.warn(`Validation service notice:`,e)}o.textContent=`正在保存...`;let s={...e.meta,name:n,matchUrl:r,description:a},f=await k(e.id,s,t);f&&f.success?(o.textContent=`💾 保存修改`,d.textContent=`✅ 工作流修改已成功保存！`,setTimeout(()=>{d.textContent=``},2500)):(o.textContent=`💾 保存修改`,alert(`保存失败: ${f?.error||`未知错误`}`))}),s?.addEventListener(`click`,async()=>{confirm(`确定要永久删除工作流 [${e.meta.name}] 吗？`)&&(await A(e.id),await E())}),v.appendChild(t)})}_.addEventListener(`click`,async()=>{let e=`custom_${Date.now()}`;await k(e,{name:`新自定义工作流`,description:`动态工作流 Recipe`,matchUrl:`*`},`async function run(ctx) {
  const { jev, successCheck, phase, log, wait } = ctx;
  log("🚀 启动动态工作流...");

  phase("第一阶段");
  await jev("执行目标操作");
  await successCheck({ url: "/target-path" }, { timeout: 3000 });

  log("🎉 工作流执行完成！");
  return { success: true };
}`),await E();let t=document.getElementById(`card_${e}`);if(t){t.scrollIntoView({behavior:`smooth`,block:`center`});let e=t.querySelector(`.wf-name-input`);e?.focus(),e?.select()}});function O(){let e=y.value.trim();if(!e){x.style.display=`none`;return}let t=C.filter(t=>n(e,t.meta.matchUrl));x.style.display=`block`,x.innerHTML=t.length>0?`
      🟢 <strong>匹配成功！</strong> 网址 <code>${w(e)}</code> 共命中 <strong>${t.length}</strong> 个工作流：<br>
      <span style="color: #cbd5e1; margin-top: 4px; display: inline-block;">
        ${t.map(e=>`• <strong>${w(e.meta.name)}</strong> (规则: <code>${w(e.meta.matchUrl||`*`)}</code>)`).join(`<br>`)}
      </span>
    `:`
      🟡 <strong>未命中任何工作流。</strong> 网址 <code>${w(e)}</code> 当前没有匹配的 Recipe。<br>
      <span style="color: #94a3b8;">提示：可将目标工作流的匹配规则配置为 <code>*</code>（全局），或者包含该网址的域名路径。</span>
    `}b.addEventListener(`click`,O),y.addEventListener(`keydown`,e=>{e.key===`Enter`&&O()});async function k(e,t,n){try{return await chrome.runtime.sendMessage({type:`SAVE_WORKFLOW`,id:e,meta:t,script:n})}catch{return await r.saveWorkflow(e,t,n),{success:!0}}}async function A(e){try{return await chrome.runtime.sendMessage({type:`DELETE_WORKFLOW`,id:e})}catch{return await r.deleteWorkflow(e)}}d.addEventListener(`click`,async()=>{f.style.display=`block`,f.className=`test-feedback`,f.textContent=`正在测试连接到 S2 / Ollama 服务...`;let e=l.value.trim()||`http://localhost:11434/v1`,t=u.value.trim()||`deepseek-v4.1-flash:cloud`,n=await i(e,t);n.status===`online`?(f.className=`test-feedback feedback-ok`,f.textContent=`🟢 ${n.message}！(延迟 ${n.latencyMs}ms，检测到 ${n.availableModels?.length||0} 个本地模型)`):n.status===`offline`?(f.className=`test-feedback feedback-warn`,f.textContent=`🔴 ${n.message}。\n解决建议：${n.actionHint}`):n.status===`cors_blocked`?(f.className=`test-feedback feedback-warn`,f.textContent=`⚠️ ${n.message}。\n解决建议：${n.actionHint}`):(f.className=`test-feedback feedback-warn`,f.textContent=`⚠️ ${n.message}。\n解决建议：${n.actionHint||`请检查配置。`}`)}),p.addEventListener(`click`,async()=>{let t=parseFloat(c.value)||.7;await e({typesafeApiKey:a.value.trim(),typesafeModel:s.value,confidenceThreshold:Math.max(.1,Math.min(1,t)),systemTwoProvider:`ollama`,systemTwoEndpoint:l.value.trim()||`http://localhost:11434/v1`,systemTwoModel:`deepseek-v4.1-flash:cloud`,antiBotMode:!0}),h.textContent=`✅ 配置已成功保存！`,setTimeout(()=>{h.textContent=``},2500)}),m.addEventListener(`click`,()=>{s.value=`jev-latest`,c.value=`0.70`,l.value=`http://localhost:11434/v1`,u.value=`deepseek-v4.1-flash:cloud`,f.style.display=`none`});