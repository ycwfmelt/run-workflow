import{n as e,t}from"./storage-9lXoiOOs.js";import{r as n,t as r}from"./workflow-registry-CQluDWJ-.js";var i=document.getElementById(`typesafeApiKey`),a=document.getElementById(`toggleApiKeyBtn`),o=document.getElementById(`typesafeModel`),s=document.getElementById(`confidenceThreshold`),c=document.getElementById(`systemTwoEndpoint`),l=document.getElementById(`systemTwoModel`),u=document.getElementById(`testOllamaBtn`),d=document.getElementById(`ollamaFeedback`),f=document.getElementById(`saveBtn`),p=document.getElementById(`resetBtn`),m=document.getElementById(`status`),h=document.getElementById(`workflowCountTitle`),g=document.getElementById(`addNewWorkflowBtn`),_=document.getElementById(`workflowsContainer`),v=document.getElementById(`testUrlInput`),y=document.getElementById(`testUrlBtn`),b=document.getElementById(`testUrlResult`),x=!1,S=[];a.addEventListener(`click`,()=>{x=!x,i.type=x?`text`:`password`,a.textContent=x?`🙈`:`👁️`});function C(e){return e?e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`):``}async function w(){let e=await t();i.value=e.typesafeApiKey||``,o.value=e.typesafeModel||`jev-latest`,s.value=String(e.confidenceThreshold||.7),c.value=e.systemTwoEndpoint||`http://localhost:11434/v1`,l.value=`deepseek-v4.1-flash:cloud`,await T()}w();async function T(){try{let e=await chrome.runtime.sendMessage({type:`GET_ALL_WORKFLOWS`});S=e&&e.workflows?e.workflows:await r.getAllWorkflows()}catch{S=await r.getAllWorkflows()}E()}function E(){if(h.textContent=`已配置工作流列表 (共 ${S.length} 个)`,_.innerHTML=``,S.length===0){_.innerHTML=`
      <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 24px; background: #0b1120; border-radius: 8px; border: 1px dashed #1e293b;">
        暂无任何工作流 Recipe，点击上方【➕ 新建自定义工作流】即可快速创建。
      </div>
    `;return}S.forEach(e=>{let t=document.createElement(`div`);t.className=`wf-card`,t.id=`card_${e.id}`;let n=e.meta.matchUrl||`*`;t.innerHTML=`
      <div class="wf-card-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; font-size: 13px; color: #f8fafc;">${C(e.meta.name)}</span>
          <span class="tag-custom">动态 Recipe</span>
        </div>
        <div style="font-size: 11px; color: #64748b; font-family: monospace;">ID: ${C(e.id)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>工作流名称 (Name):</label>
          <input type="text" class="wf-name-input" value="${C(e.meta.name)}" />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>适用页面规则 (Match Rule): <span class="label-hint">(* 全部, /正则/, 域名)</span></label>
          <input type="text" class="wf-match-input" value="${C(n)}" placeholder="*" />
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <label>功能描述 (Description):</label>
        <input type="text" class="wf-desc-input" value="${C(e.meta.description||``)}" placeholder="工作流用途简述..." />
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="margin-bottom: 0;">JavaScript 异步执行函数 (Workflow Function):</label>
          <button type="button" class="btn-secondary toggle-code-btn" style="padding: 2px 8px; font-size: 11px;">收起/展开代码 ⏷</button>
        </div>
        <textarea class="code-textarea wf-script-input" spellcheck="false">${C(e.script||``)}</textarea>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div class="wf-save-status" style="font-size: 11px; color: var(--success); font-weight: 500;"></div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-secondary copy-code-btn" style="font-size: 11px; padding: 5px 10px;">📋 复制代码</button>
          <button type="button" class="btn-secondary delete-wf-btn" style="font-size: 11px; padding: 5px 10px; color: #fca5a5; border-color: #7f1d1d;">🗑️ 删除</button>
          <button type="button" class="btn-save save-wf-btn" style="font-size: 11px; padding: 5px 12px;">💾 保存修改</button>
        </div>
      </div>
    `;let r=t.querySelector(`.toggle-code-btn`),i=t.querySelector(`.wf-script-input`);r.addEventListener(`click`,()=>{i.style.display===`none`?(i.style.display=`block`,r.textContent=`收起代码 ⏶`):(i.style.display=`none`,r.textContent=`展开代码 ⏷`)});let a=t.querySelector(`.copy-code-btn`);a.addEventListener(`click`,()=>{let e=i.value;navigator.clipboard.writeText(e).then(()=>{a.textContent=`已复制 ✓`,setTimeout(()=>{a.textContent=`📋 复制代码`},1500)})});let o=t.querySelector(`.save-wf-btn`),s=t.querySelector(`.delete-wf-btn`),c=t.querySelector(`.wf-name-input`),l=t.querySelector(`.wf-match-input`),u=t.querySelector(`.wf-desc-input`),d=t.querySelector(`.wf-save-status`);o?.addEventListener(`click`,async()=>{let t=i.value.trim(),n=c.value.trim()||e.meta.name,r=l.value.trim()||`*`,a=u.value.trim()||e.meta.description;o.textContent=`正在校验...`;try{let e=await chrome.runtime.sendMessage({type:`VALIDATE_WORKFLOW_SCRIPT`,script:t});if(e&&e.valid===!1){o.textContent=`💾 保存修改`,alert(`JavaScript 语法错误，无法编译:\n${e.error}`);return}}catch(e){console.warn(`Validation service notice:`,e)}o.textContent=`正在保存...`;let s={...e.meta,name:n,matchUrl:r,description:a},f=await O(e.id,s,t);f&&f.success?(o.textContent=`💾 保存修改`,d.textContent=`✅ 工作流修改已成功保存！`,setTimeout(()=>{d.textContent=``},2500)):(o.textContent=`💾 保存修改`,alert(`保存失败: ${f?.error||`未知错误`}`))}),s?.addEventListener(`click`,async()=>{confirm(`确定要永久删除工作流 [${e.meta.name}] 吗？`)&&(await k(e.id),await T())}),_.appendChild(t)})}g.addEventListener(`click`,async()=>{let e=`custom_${Date.now()}`;await O(e,{name:`新自定义工作流`,description:`实时检测页面状态的动态工作流 Recipe`,matchUrl:`*`},`async function run(ctx) {
  const { jev, getPage, phase, log, wait, scroll, args } = ctx;
  log("🚀 启动动态工作流...");

  // 实时条件循环模式 (动态检查页面元素，处理完自然退出，不依赖死板计数)
  while (true) {
    phase("实时检测页面项");
    const page = await getPage();

    // 1. 实时检测当前页是否还有待处理的目标按钮
    const target = page.elements.find(e => e.text.includes("处理") && e.isClickable);

    if (!target) {
      // 检查是否有下一页翻页
      const nextPage = page.elements.find(e => e.text.includes("下一页") && e.isClickable && !e.selector.includes("disabled"));
      if (nextPage) {
        log("当前页已无待办，翻至下一页...");
        await jev("点击【下一页】");
        await wait(1800);
        continue;
      }
      log("🎉 实时检测完成：当前已无更多待办项，任务顺利完成！");
      break;
    }

    // 2. 调用 TypeSafe Jev 执行高精度微操作
    log(\`发现待办项 "\${target.text}"，正在处理...\`);
    await jev("点击【处理】按钮");
    await wait(1500);

    // 3. 弹窗二次确认守卫
    const after = await getPage();
    if (after.activeModal?.isOpen) {
      await jev("在确认弹窗中点击【确定】按钮");
      await wait(1000);
    }
  }

  return { success: true };
}`),await T();let t=document.getElementById(`card_${e}`);if(t){t.scrollIntoView({behavior:`smooth`,block:`center`});let e=t.querySelector(`.wf-name-input`);e?.focus(),e?.select()}});function D(){let e=v.value.trim();if(!e){b.style.display=`none`;return}let t=S.filter(t=>n(e,t.meta.matchUrl));b.style.display=`block`,b.innerHTML=t.length>0?`
      🟢 <strong>匹配成功！</strong> 网址 <code>${C(e)}</code> 共命中 <strong>${t.length}</strong> 个工作流：<br>
      <span style="color: #cbd5e1; margin-top: 4px; display: inline-block;">
        ${t.map(e=>`• <strong>${C(e.meta.name)}</strong> (规则: <code>${C(e.meta.matchUrl||`*`)}</code>)`).join(`<br>`)}
      </span>
    `:`
      🟡 <strong>未命中任何工作流。</strong> 网址 <code>${C(e)}</code> 当前没有匹配的 Recipe。<br>
      <span style="color: #94a3b8;">提示：可将目标工作流的匹配规则配置为 <code>*</code>（全局），或者包含该网址的域名路径。</span>
    `}y.addEventListener(`click`,D),v.addEventListener(`keydown`,e=>{e.key===`Enter`&&D()});async function O(e,t,n){try{return await chrome.runtime.sendMessage({type:`SAVE_WORKFLOW`,id:e,meta:t,script:n})}catch{return await r.saveWorkflow(e,t,n),{success:!0}}}async function k(e){try{return await chrome.runtime.sendMessage({type:`DELETE_WORKFLOW`,id:e})}catch{return await r.deleteWorkflow(e)}}u.addEventListener(`click`,async()=>{d.style.display=`block`,d.className=`test-feedback`,d.textContent=`正在测试连接到 Ollama 服务...`;let e=(c.value||`http://localhost:11434/v1`).replace(/\/+$/,``),t=`${e}/models`,n=new AbortController,r=setTimeout(()=>n.abort(),3e3);try{let e=await fetch(t,{method:`GET`,signal:n.signal});if(clearTimeout(r),e.ok){let t=await e.json().catch(()=>({})),n=Array.isArray(t.data)?t.data.map(e=>e.id):[],r=n.some(e=>e.includes(`deepseek`));d.className=`test-feedback feedback-ok`,d.textContent=r?`🟢 Ollama 运行正常，已检测到 DeepSeek 模型！(总计 ${n.length} 个模型)`:`🟢 Ollama 运行正常，响应成功。(服务在线，模型列表已读取)`}else d.className=`test-feedback feedback-warn`,d.textContent=`🟡 Ollama 响应 HTTP ${e.status}。若离线将自动平滑降级至内置智能规则规划器。`}catch(t){clearTimeout(r),d.className=`test-feedback feedback-warn`,d.textContent=`🟡 无法连接到 ${e} (${t.message})。若未开启 Ollama 服务，系统将自动使用内置智能规则规划器，零依赖正常运行。`}}),f.addEventListener(`click`,async()=>{let t=parseFloat(s.value)||.7;await e({typesafeApiKey:i.value.trim(),typesafeModel:o.value,confidenceThreshold:Math.max(.1,Math.min(1,t)),systemTwoProvider:`ollama`,systemTwoEndpoint:c.value.trim()||`http://localhost:11434/v1`,systemTwoModel:`deepseek-v4.1-flash:cloud`,antiBotMode:!0}),m.textContent=`✅ 配置已成功保存！`,setTimeout(()=>{m.textContent=``},2500)}),p.addEventListener(`click`,()=>{o.value=`jev-latest`,s.value=`0.70`,c.value=`http://localhost:11434/v1`,l.value=`deepseek-v4.1-flash:cloud`,d.style.display=`none`});