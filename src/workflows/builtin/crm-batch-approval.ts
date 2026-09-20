import { WorkflowContext, WorkflowMeta } from "../types.js";

export const meta: WorkflowMeta = {
  name: "crm_batch_approval",
  description: "NEW-BOSS 预售合同批量自动化审批 (循环批处理工作流)",
  matchUrl: "crm.example.com",
  phases: [
    { title: "检索待处理列表" },
    { title: "详情页审批" },
    { title: "二次确认" },
    { title: "返回待办列表" },
  ],
  whenToUse: "在 NEW-BOSS 工作事项列表中批量审批预售合同时调用",
};

export async function run(ctx: WorkflowContext) {
  const { jev, getPage, phase, log, wait, scroll, args } = ctx;
  let processedCount = 0;
  const maxItems = args?.maxItems || 50;

  log(`🚀 启动 NEW-BOSS 批量自动化审批工作流 (上限: ${maxItems} 笔)...`);

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

        log(`🎉 待办列表中已无更多待审批项！本次自动化完成。`);
        break;
      }
    }

    // 第 1 步：点击第一条合同的【处理】按钮
    log(`正在处理第 ${processedCount + 1} 笔合同审批...`);
    await jev("在待办列表中找到下一条预售合同对应的【处理】按钮并点击");
    await wait(2000);

    // 第 2 步：在详情页点击【通过】或【同意】
    phase("详情页审批");
    await jev("在详情审批区域找到并点击【通过】或【同意】操作按钮");
    await wait(1200);

    // 第 3 步：检测二次确认弹窗
    const afterApproveState = await getPage();
    if (afterApproveState.activeModal?.isOpen) {
      phase("二次确认");
      log(
        `检测到确认弹窗 ("${afterApproveState.activeModal.title}")，正在点击【确认】...`
      );
      await jev("在弹窗中点击【确认】按钮完成最终审批");
      await wait(1500);
    }

    // 第 4 步：返回列表
    phase("返回待办列表");
    const returnCheckState = await getPage();
    if (/DETAIL|APPLY/i.test(returnCheckState.url)) {
      const returnBtn = returnCheckState.elements.find(
        (e) => e.text === "返回" || e.ariaLabel === "返回"
      );
      if (returnBtn) {
        log(`点击【返回】回到工作列表，准备下一笔...`);
        await jev("点击页面左上角的【返回】按钮");
        await wait(2000);
      }
    }

    processedCount++;
    log(`✅ 已成功完成第 ${processedCount} 笔合同审批！`);
  }

  return {
    success: true,
    processedCount,
    message: `批量审批工作流顺利完成，共计审批 ${processedCount} 笔预售合同。`,
  };
}
