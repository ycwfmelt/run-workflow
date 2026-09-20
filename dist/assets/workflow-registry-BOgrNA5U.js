var e={name:`crm_batch_approval`,description:`NEW-BOSS 预售合同批量自动化审批 (循环批处理工作流)`,matchUrl:`crm.example.com`,phases:[{title:`检索待处理列表`},{title:`详情页审批`},{title:`二次确认`},{title:`返回待办列表`}],whenToUse:`在 NEW-BOSS 工作事项列表中批量审批预售合同时调用`};async function t(e){let{jev:t,getPage:n,phase:r,log:i,wait:a,scroll:o,args:s}=e,c=0,l=s?.maxItems||50;for(i(`🚀 启动 NEW-BOSS 批量自动化审批工作流 (上限: ${l} 笔)...`);c<l;){if(r(`检索待处理列表`),(await n()).elements.filter(e=>e.text.startsWith(`处理`)||e.text===`处理`||e.text.startsWith(`办理`)||e.text===`办理`).length===0){await o(350),await a(1e3);let e=await n();if(e.elements.filter(e=>e.text.startsWith(`处理`)||e.text===`处理`).length===0){if(e.elements.find(e=>e.text.includes(`下一页`)&&e.isClickable&&!e.selector.includes(`disabled`))){i(`当前页待办已处理完，正在翻至下一页...`),await t(`点击【下一页】按钮翻页`),await a(2e3);continue}i(`🎉 待办列表中已无更多待审批项！本次自动化完成。`);break}}i(`正在处理第 ${c+1} 笔合同审批...`),await t(`在待办列表中找到下一条预售合同对应的【处理】按钮并点击`),await a(2e3),r(`详情页审批`),await t(`在详情审批区域找到并点击【通过】或【同意】操作按钮`),await a(1200);let e=await n();e.activeModal?.isOpen&&(r(`二次确认`),i(`检测到确认弹窗 ("${e.activeModal.title}")，正在点击【确认】...`),await t(`在弹窗中点击【确认】按钮完成最终审批`),await a(1500)),r(`返回待办列表`);let s=await n();/DETAIL|APPLY/i.test(s.url)&&s.elements.find(e=>e.text===`返回`||e.ariaLabel===`返回`)&&(i(`点击【返回】回到工作列表，准备下一笔...`),await t(`点击页面左上角的【返回】按钮`),await a(2e3)),c++,i(`✅ 已成功完成第 ${c} 笔合同审批！`)}return{success:!0,processedCount:c,message:`批量审批工作流顺利完成，共计审批 ${c} 笔预售合同。`}}var n=[{id:`crm_batch_approval`,meta:e,fn:t,script:`async function run(ctx) {
  const { jev, getPage, phase, log, wait, scroll, args } = ctx;
  let processedCount = 0;
  const maxItems = args?.maxItems || 50;

  log(\`🚀 启动 NEW-BOSS 批量自动化审批工作流 (上限: \${maxItems} 笔)...\`);

  while (processedCount < maxItems) {
    phase("检索待处理列表");
    const page = await getPage();

    // 筛选当前视口中的所有【处理】/【办理】按钮
    const processButtons = page.elements.filter(
      (e) =>
        e.text.startsWith("处理") ||
        e.text === "处理" ||
        e.text.startsWith("办理") ||
        e.text === "办理"
    );

    if (processButtons.length === 0) {
      // 向下轻微滚动扫描
      await scroll(350);
      await wait(1000);
      const afterScroll = await getPage();
      const retryButtons = afterScroll.elements.filter(
        (e) => e.text.startsWith("处理") || e.text === "处理"
      );

      if (retryButtons.length === 0) {
        // 检测分页【下一页】
        const nextPage = afterScroll.elements.find(
          (e) =>
            e.text.includes("下一页") &&
            e.isClickable &&
            !e.selector.includes("disabled")
        );
        if (nextPage) {
          log("当前页待办已处理完，正在翻至下一页...");
          await jev("点击【下一页】按钮翻页");
          await wait(2000);
          continue;
        }

        log(\`🎉 待办列表中已无更多待审批项！本次自动化完成。\`);
        break;
      }
    }

    log(\`发现待办合同，开始审批流程...\`);
    phase("详情页审批");
    await jev("点击列表第一项的【处理】或【办理】按钮");
    await wait(2500);

    // 详情页内寻找【通过】或【同意】
    phase("二次确认");
    await jev("在审批详情页寻找并点击【同意】或【审批通过】主操作按钮");
    await wait(1200);

    // 弹窗二次确认
    const afterApprove = await getPage();
    if (afterApprove.activeModal?.isOpen) {
      log("检测到确认弹窗，执行最终确认...");
      await jev("在确认对话框中点击【确定】或【提交】按钮");
      await wait(1500);
    }

    processedCount++;
    log(\`第 \${processedCount} 笔审批完成！\`);

    // 返回列表页
    phase("返回待办列表");
    const returnBtn = (await getPage()).elements.find((e) =>
      ["返回", "关闭", "Back"].some((kw) => e.text.includes(kw))
    );
    if (returnBtn) {
      await jev("点击【返回】或【关闭】按钮返回工作项列表");
    } else {
      await scroll(-500);
    }
    await wait(1500);
  }

  log(\`🏁 批量审批工作流完成，累计成功审批: \${processedCount} 笔\`);
  return { processedCount };
}`,isBuiltIn:!0,createdAt:17267e8}],r=`ang_custom_workflows`,i=`jevpilot_custom_workflows`,a=Object.getPrototypeOf(async function(){}).constructor;function o(e){let t=e.trim().replace(/^```(?:javascript|js|typescript|ts)?\s*/i,``).replace(/\s*```$/,``).trim();return/(?:export\s+default\s+)?async\s+function(?:\s+\w+)?\s*\(\s*ctx\s*\)\s*\{/i.test(t)&&(t=`return (${t.replace(/^export\s+default\s+/i,``)})(ctx);`),new a(`ctx`,t)}function s(e,t){if(!t||t.trim()===``||t.trim()===`*`)return!0;let n=t.trim(),r=n.match(/^\/(.+)\/([a-z]*)$/i);if(r)try{return new RegExp(r[1],r[2]).test(e)}catch{}if(n.includes(`*`))try{let t=n.replace(/[.+?^${}()|[\]\\]/g,`\\$&`).replace(/\*/g,`.*`);if(RegExp(`^${t}$`,`i`).test(e)||new RegExp(t,`i`).test(e))return!0}catch{}return e.toLowerCase().includes(n.toLowerCase())}var c=class{static async getAllWorkflows(){try{let e=await chrome.storage.local.get([r,i]),t=(e[r]||e[i]||[]).map(e=>{if(!e.fn&&e.script)try{e.fn=o(e.script)}catch(t){console.warn(`[Ang] Failed to compile workflow script for ${e.id}:`,t)}return e});return[...n,...t]}catch{return[...n]}}static async getMatchingWorkflows(e){let t=await this.getAllWorkflows();return e?t.filter(t=>s(e,t.meta.matchUrl)):[]}static async saveWorkflow(e,t,n){let i=(await chrome.storage.local.get(r))[r]||[],a=i.findIndex(t=>t.id===e),o={id:e,meta:t,script:n,isBuiltIn:!1,createdAt:Date.now()};a>=0?i[a]=o:i.push(o),await chrome.storage.local.set({[r]:i})}static async updateWorkflow(e,t){let n=(await chrome.storage.local.get(r))[r]||[],i=n.findIndex(t=>t.id===e);i>=0&&(n[i]={...n[i],meta:{...n[i].meta,...t.meta||{}},script:t.script===void 0?n[i].script:t.script},await chrome.storage.local.set({[r]:n}))}static async deleteWorkflow(e){let t=(await chrome.storage.local.get(r))[r]||[],n=t.filter(t=>t.id!==e);return n.length!==t.length&&(await chrome.storage.local.set({[r]:n}),!0)}static async getWorkflowById(e){return(await this.getAllWorkflows()).find(t=>t.id===e)}};export{o as n,s as r,c as t};