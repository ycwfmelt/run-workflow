import {
  WorkflowDefinition,
  WorkflowFunction,
  WorkflowMeta,
} from "./types.js";
import {
  meta as newBossMeta,
  run as newBossRun,
} from "./builtin/crm-batch-batch-approval.js";

const NEW_BOSS_SCRIPT = `async function run(ctx) {
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
}`;

const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "crm_batch_approval",
    meta: newBossMeta,
    fn: newBossRun,
    script: NEW_BOSS_SCRIPT,
    isBuiltIn: true,
    createdAt: 1726700000000,
  },
];

const STORAGE_KEY = "ang_custom_workflows";
const LEGACY_STORAGE_KEY = "jevpilot_custom_workflows";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function compileScriptToFunction(script: string): WorkflowFunction {
  let clean = script.trim().replace(/^```(?:javascript|js|typescript|ts)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (/(?:export\s+default\s+)?async\s+function(?:\s+\w+)?\s*\(\s*ctx\s*\)\s*\{/i.test(clean)) {
    clean = `return (${clean.replace(/^export\s+default\s+/i, "")})(ctx);`;
  }
  return new AsyncFunction("ctx", clean) as WorkflowFunction;
}

/**
 * Robust URL matching supporting:
 * 1. "*" or empty: matches everything (global)
 * 2. Regular expressions: /pattern/flags
 * 3. Wildcards: *.example.com/* or https://*
 * 4. Substring: crm.example.com
 */
export function matchUrlRule(url: string, rule?: string): boolean {
  if (!rule || rule.trim() === "" || rule.trim() === "*") {
    return true;
  }
  const trimmed = rule.trim();

  // 1. Regular expression: /pattern/flags
  const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    try {
      const rx = new RegExp(regexMatch[1], regexMatch[2]);
      return rx.test(url);
    } catch {
      // Ignore invalid regex and fallback
    }
  }

  // 2. Wildcard glob: *.example.com/* or https://*
  if (trimmed.includes("*")) {
    try {
      const regexPattern = trimmed
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const fullRegex = new RegExp(`^${regexPattern}$`, "i");
      if (fullRegex.test(url)) return true;

      const subRegex = new RegExp(regexPattern, "i");
      if (subRegex.test(url)) return true;
    } catch {
      // Fallback
    }
  }

  // 3. Substring match (case-insensitive)
  return url.toLowerCase().includes(trimmed.toLowerCase());
}

export class WorkflowRegistry {
  /**
   * Get all available workflows (built-in + saved custom)
   */
  static async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      const stored: any = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
      const custom: WorkflowDefinition[] = (stored[STORAGE_KEY] || stored[LEGACY_STORAGE_KEY] || []) as WorkflowDefinition[];
      const hydratedCustom = custom.map((wf) => {
        if (!wf.fn && wf.script) {
          try {
            wf.fn = compileScriptToFunction(wf.script);
          } catch (compileErr) {
            console.warn(`[Ang] Failed to compile workflow script for ${wf.id}:`, compileErr);
          }
        }
        return wf;
      });
      return [...BUILTIN_WORKFLOWS, ...hydratedCustom];
    } catch {
      return [...BUILTIN_WORKFLOWS];
    }
  }

  /**
   * Find workflows matching a specific URL
   */
  static async getMatchingWorkflows(url: string): Promise<WorkflowDefinition[]> {
    const all = await this.getAllWorkflows();
    if (!url) return [];
    return all.filter((wf) => matchUrlRule(url, wf.meta.matchUrl));
  }

  /**
   * Save or update a custom workflow script (as JS function)
   */
  static async saveWorkflow(
    id: string,
    meta: WorkflowMeta,
    script: string
  ): Promise<void> {
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
    const index = list.findIndex((w) => w.id === id);

    const entry: WorkflowDefinition = {
      id,
      meta,
      script,
      isBuiltIn: false,
      createdAt: Date.now(),
    };

    if (index >= 0) {
      list[index] = entry;
    } else {
      list.push(entry);
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  /**
   * Update existing workflow metadata or script
   */
  static async updateWorkflow(
    id: string,
    updates: { meta?: Partial<WorkflowMeta>; script?: string }
  ): Promise<void> {
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
    const index = list.findIndex((w) => w.id === id);

    if (index >= 0) {
      list[index] = {
        ...list[index],
        meta: {
          ...list[index].meta,
          ...(updates.meta || {}),
        },
        script: updates.script !== undefined ? updates.script : list[index].script,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: list });
    }
  }

  /**
   * Delete custom workflow by ID
   */
  static async deleteWorkflow(id: string): Promise<boolean> {
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
    const filtered = list.filter((w) => w.id !== id);
    if (filtered.length === list.length) {
      return false; // Not found or is built-in
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    return true;
  }

  /**
   * Get workflow by ID
   */
  static async getWorkflowById(
    id: string
  ): Promise<WorkflowDefinition | undefined> {
    const all = await this.getAllWorkflows();
    return all.find((w) => w.id === id);
  }
}
