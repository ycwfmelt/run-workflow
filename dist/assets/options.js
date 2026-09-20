import{n as e,t}from"./storage-9lXoiOOs.js";import{n,r,t as i}from"./workflow-registry-BOgrNA5U.js";var a=document.getElementById(`typesafeApiKey`),o=document.getElementById(`toggleApiKeyBtn`),s=document.getElementById(`typesafeModel`),c=document.getElementById(`confidenceThreshold`),l=document.getElementById(`systemTwoEndpoint`),u=document.getElementById(`systemTwoModel`),d=document.getElementById(`testOllamaBtn`),f=document.getElementById(`ollamaFeedback`),p=document.getElementById(`saveBtn`),m=document.getElementById(`resetBtn`),h=document.getElementById(`status`),g=document.getElementById(`workflowCountTitle`),_=document.getElementById(`addNewWorkflowBtn`),v=document.getElementById(`workflowsContainer`),y=document.getElementById(`testUrlInput`),b=document.getElementById(`testUrlBtn`),x=document.getElementById(`testUrlResult`),S=!1,C=[];o.addEventListener(`click`,()=>{S=!S,a.type=S?`text`:`password`,o.textContent=S?`🙈`:`👁️`});function w(e){return e?e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`):``}async function T(){let e=await t();a.value=e.typesafeApiKey||``,s.value=e.typesafeModel||`jev-latest`,c.value=String(e.confidenceThreshold||.7),l.value=e.systemTwoEndpoint||`http://localhost:11434/v1`,u.value=`deepseek-v4.1-flash:cloud`,await E()}T();async function E(){try{let e=await chrome.runtime.sendMessage({type:`GET_ALL_WORKFLOWS`});C=e&&e.workflows?e.workflows:await i.getAllWorkflows()}catch{C=await i.getAllWorkflows()}D()}function D(){if(g.textContent=`已配置工作流列表 (共 ${C.length} 个)`,v.innerHTML=``,C.length===0){v.innerHTML=`
      <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 24px; background: #0b1120; border-radius: 8px; border: 1px dashed #1e293b;">
        暂无任何工作流 Recipe，点击上方【➕ 新建自定义工作流】即可快速创建。
      </div>
    `;return}C.forEach(e=>{let t=document.createElement(`div`);t.className=`wf-card`,t.id=`card_${e.id}`;let r=!!e.isBuiltIn,i=e.meta.matchUrl||`*`;t.innerHTML=`
      <div class="wf-card-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; font-size: 13px; color: #f8fafc;">${w(e.meta.name)}</span>
          <span class="${r?`tag-builtin`:`tag-custom`}">${r?`系统内置 (Built-in)`:`自定义 (Custom)`}</span>
        </div>
        <div style="font-size: 11px; color: #64748b; font-family: monospace;">ID: ${w(e.id)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>工作流名称 (Name):</label>
          <input type="text" class="wf-name-input" value="${w(e.meta.name)}" ${r?`readonly style="background: #172033; color: #94a3b8;"`:``} />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>适用页面规则 (Match Rule): <span class="label-hint">(* 全部, /正则/, 域名)</span></label>
          <input type="text" class="wf-match-input" value="${w(i)}" placeholder="*" ${r?`readonly style="background: #172033; color: #94a3b8;"`:``} />
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <label>功能描述 (Description):</label>
        <input type="text" class="wf-desc-input" value="${w(e.meta.description||``)}" placeholder="工作流用途简述..." ${r?`readonly style="background: #172033; color: #94a3b8;"`:``} />
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="margin-bottom: 0;">JavaScript 异步执行函数 (Workflow Function):</label>
          <button type="button" class="btn-secondary toggle-code-btn" style="padding: 2px 8px; font-size: 11px;">收起/展开代码 ⏷</button>
        </div>
        <textarea class="code-textarea wf-script-input" spellcheck="false" ${r?`readonly style="background: #020617; color: #7dd3fc;"`:``}>${w(e.script||``)}</textarea>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div class="wf-save-status" style="font-size: 11px; color: var(--success); font-weight: 500;"></div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-secondary copy-code-btn" style="font-size: 11px; padding: 5px 10px;">📋 复制代码</button>
          ${r?`
            <button type="button" class="btn-secondary clone-wf-btn" style="font-size: 11px; padding: 5px 10px; background: #1e1b4b; color: #c7d2fe; border-color: #4338ca;">📑 基于此模板克隆</button>
          `:`
            <button type="button" class="btn-secondary delete-wf-btn" style="font-size: 11px; padding: 5px 10px; color: #fca5a5; border-color: #7f1d1d;">🗑️ 删除</button>
            <button type="button" class="btn-save save-wf-btn" style="font-size: 11px; padding: 5px 12px;">💾 保存修改</button>
          `}
        </div>
      </div>
    `;let a=t.querySelector(`.toggle-code-btn`),o=t.querySelector(`.wf-script-input`);a.addEventListener(`click`,()=>{o.style.display===`none`?(o.style.display=`block`,a.textContent=`收起代码 ⏶`):(o.style.display=`none`,a.textContent=`展开代码 ⏷`)});let s=t.querySelector(`.copy-code-btn`);if(s.addEventListener(`click`,()=>{let e=o.value;navigator.clipboard.writeText(e).then(()=>{s.textContent=`已复制 ✓`,setTimeout(()=>{s.textContent=`📋 复制代码`},1500)})}),r)t.querySelector(`.clone-wf-btn`)?.addEventListener(`click`,async()=>{let t=`custom_clone_${Date.now()}`;await k(t,{...e.meta,name:`${e.meta.name}_副本`,description:`${e.meta.description} (自定义修改版)`},e.script||``),await E(),document.getElementById(`card_${t}`)?.scrollIntoView({behavior:`smooth`,block:`center`})});else{let r=t.querySelector(`.save-wf-btn`),i=t.querySelector(`.delete-wf-btn`),a=t.querySelector(`.wf-name-input`),s=t.querySelector(`.wf-match-input`),c=t.querySelector(`.wf-desc-input`),l=t.querySelector(`.wf-save-status`);r?.addEventListener(`click`,async()=>{let t=o.value.trim(),i=a.value.trim()||e.meta.name,u=s.value.trim()||`*`,d=c.value.trim()||e.meta.description;try{n(t)}catch(e){alert(`JavaScript 语法错误，无法编译:\n${e.message}`);return}r.textContent=`正在保存...`;let f={...e.meta,name:i,matchUrl:u,description:d},p=await k(e.id,f,t);p&&p.success?(r.textContent=`💾 保存修改`,l.textContent=`✅ 工作流修改已成功保存！`,setTimeout(()=>{l.textContent=``},2500)):(r.textContent=`💾 保存修改`,alert(`保存失败: ${p?.error||`未知错误`}`))}),i?.addEventListener(`click`,async()=>{confirm(`确定要永久删除工作流 [${e.meta.name}] 吗？`)&&(await A(e.id),await E())})}v.appendChild(t)})}_.addEventListener(`click`,async()=>{let e=`custom_${Date.now()}`;await k(e,{name:`新自定义工作流`,description:`点击右侧保存前可在此输入工作流详细描述与逻辑`,matchUrl:`*`},`async function run(ctx) {
  const { jev, getPage, phase, log, wait, scroll, args } = ctx;
  log("🚀 启动自定义动态工作流...");

  phase("步骤 1: 探查页面状态");
  const page = await getPage();
  log(\`当前页面含有 \${page.elements.length} 个可视元素\`);

  // 使用 TypeSafe Jev 高精度微操作
  // await jev("点击页面主操作按钮");
  // await wait(1000);

  log("🎉 自定义工作流执行完成！");
  return { success: true };
}`),await E();let t=document.getElementById(`card_${e}`);if(t){t.scrollIntoView({behavior:`smooth`,block:`center`});let e=t.querySelector(`.wf-name-input`);e?.focus(),e?.select()}});function O(){let e=y.value.trim();if(!e){x.style.display=`none`;return}let t=C.filter(t=>r(e,t.meta.matchUrl));x.style.display=`block`,x.innerHTML=t.length>0?`
      🟢 <strong>匹配成功！</strong> 网址 <code>${w(e)}</code> 共命中 <strong>${t.length}</strong> 个工作流：<br>
      <span style="color: #cbd5e1; margin-top: 4px; display: inline-block;">
        ${t.map(e=>`• <strong>${w(e.meta.name)}</strong> (规则: <code>${w(e.meta.matchUrl||`*`)}</code>)`).join(`<br>`)}
      </span>
    `:`
      🟡 <strong>未命中任何工作流。</strong> 网址 <code>${w(e)}</code> 当前没有匹配的 Recipe。<br>
      <span style="color: #94a3b8;">提示：可将目标工作流的匹配规则配置为 <code>*</code>（全局），或者包含该网址的域名路径。</span>
    `}b.addEventListener(`click`,O),y.addEventListener(`keydown`,e=>{e.key===`Enter`&&O()});async function k(e,t,n){try{return await chrome.runtime.sendMessage({type:`SAVE_WORKFLOW`,id:e,meta:t,script:n})}catch{return await i.saveWorkflow(e,t,n),{success:!0}}}async function A(e){try{return await chrome.runtime.sendMessage({type:`DELETE_WORKFLOW`,id:e})}catch{return await i.deleteWorkflow(e)}}d.addEventListener(`click`,async()=>{f.style.display=`block`,f.className=`test-feedback`,f.textContent=`正在测试连接到 Ollama 服务...`;let e=(l.value||`http://localhost:11434/v1`).replace(/\/+$/,``),t=`${e}/models`,n=new AbortController,r=setTimeout(()=>n.abort(),3e3);try{let e=await fetch(t,{method:`GET`,signal:n.signal});if(clearTimeout(r),e.ok){let t=await e.json().catch(()=>({})),n=Array.isArray(t.data)?t.data.map(e=>e.id):[],r=n.some(e=>e.includes(`deepseek`));f.className=`test-feedback feedback-ok`,f.textContent=r?`🟢 Ollama 运行正常，已检测到 DeepSeek 模型！(总计 ${n.length} 个模型)`:`🟢 Ollama 运行正常，响应成功。(服务在线，模型列表已读取)`}else f.className=`test-feedback feedback-warn`,f.textContent=`🟡 Ollama 响应 HTTP ${e.status}。若离线将自动平滑降级至内置智能规则规划器。`}catch(t){clearTimeout(r),f.className=`test-feedback feedback-warn`,f.textContent=`🟡 无法连接到 ${e} (${t.message})。若未开启 Ollama 服务，系统将自动使用内置智能规则规划器，零依赖正常运行。`}}),p.addEventListener(`click`,async()=>{let t=parseFloat(c.value)||.7;await e({typesafeApiKey:a.value.trim(),typesafeModel:s.value,confidenceThreshold:Math.max(.1,Math.min(1,t)),systemTwoProvider:`ollama`,systemTwoEndpoint:l.value.trim()||`http://localhost:11434/v1`,systemTwoModel:`deepseek-v4.1-flash:cloud`,antiBotMode:!0}),h.textContent=`✅ 配置已成功保存！`,setTimeout(()=>{h.textContent=``},2500)}),m.addEventListener(`click`,()=>{s.value=`jev-latest`,c.value=`0.70`,l.value=`http://localhost:11434/v1`,u.value=`deepseek-v4.1-flash:cloud`,f.style.display=`none`});