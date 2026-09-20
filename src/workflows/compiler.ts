import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { AgentConfig, PageState } from "../shared/types.js";
import { WorkflowDefinition } from "./types.js";
import { compileScriptToFunction } from "./workflow-registry.js";

const DYNAMIC_WORKFLOW_SYSTEM_PROMPT = `You are an expert Automation Workflow Engineer.
Your task is to write an executable JavaScript dynamic workflow function (Claude Code & Pi Dynamic Workflow compatible).

### Runtime Environment & Primitives:
The function receives a single parameter \`ctx\` providing:
- \`await ctx.jev(instruction: string)\`: Calls TypeSafe Jev System One to visually identify the target element matching \`instruction\` and executes a trusted CDP click or input. Always use concise, unambiguous button or action names (e.g. \`await ctx.jev("点击【处理】按钮")\`, \`await ctx.jev("点击【同意】按钮")\`).
- \`await ctx.agent(instruction: string)\`: Alias for \`ctx.jev()\`.
- \`await ctx.getPage()\`: Returns latest page state:
  \`{ url: string, title: string, elements: InteractiveElement[], activeModal?: { isOpen: boolean, title: string } }\`
- \`await ctx.successCheck(goal?: string)\`: Inspects the live DOM and evaluates whether the task goal is fully accomplished. Returns \`{ isGoalReached: boolean, confidence: number }\`. Dynamic workflows MUST use this to verify each step and prevent premature termination!
- \`ctx.phase(title: string)\`: Declares current phase for live UI visualization (e.g. \`ctx.phase("检索待处理列表")\`).
- \`ctx.log(message: string)\`: Writes a log entry into the execution timeline.
- \`await ctx.wait(ms: number)\`: Suspends execution for ms to allow DOM rendering.
- \`await ctx.scroll(deltaY: number)\`: Scrolls the viewport down (positive) or up (negative).

### Workflow Engineering Guidelines:
1. Dynamic Real-Time Termination & Goal Verification (successCheck):
   - Dynamic workflows must ALWAYS inspect the actual live webpage state in real-time to determine completion, NEVER terminate prematurely on a single click!
   - In modern web applications, accomplishing a goal often requires multi-step navigation (for example: clicking "领取今日奖励" on a homepage navigates to the mission page, where the actual "领取 X 铜币" button must subsequently be clicked!).
   - Therefore, workflows must use a verification loop with \`await ctx.successCheck()\` to ensure the ultimate goal is verified before ending!
2. Batch / Iterative Tasks:
   - For batch / iterative tasks (e.g. "批量审批", "处理全部待办", "逐个审核"):
     Use \`while (true)\` or \`while (!isDone)\`. Each loop iteration starts by calling \`const page = await getPage()\` and searching for pending target buttons/items.
     If no pending items are found in the current viewport, try \`await scroll(300)\` or check for pagination \`下一页\`. If neither exists, break and log "页面已无待处理项，任务全部完成！".
3. Modal Dialog Handling:
   - Web applications often show a secondary confirmation modal (e.g. "确认通过该合同吗？").
   - Always check \`if (page.activeModal?.isOpen)\` or after clicking an action, check \`const after = await getPage(); if (after.activeModal?.isOpen) await ctx.jev("在弹窗中点击【确认】按钮");\`
4. Return Navigation:
   - After approving an item in detail view, check if URL contains \`/DETAIL|APPLY/\`, and click the \`返回\` button to return to the list.
5. Output strictly valid, self-contained JavaScript code body for an \`async (ctx) => { ... }\` function.
`;

const WorkflowZodSchema = z.object({
  name: z.string().describe("Short snake_case identifier, e.g. batch_contract_approval"),
  description: z.string().describe("Concise Chinese summary of what the workflow does"),
  phases: z.array(z.string()).describe("Sequential phase titles"),
  script: z.string().describe("Executable JavaScript function code body for async (ctx) => { ... }"),
});

export class WorkflowCompiler {
  /**
   * Compiles user prompt and current DOM context into an executable Dynamic Workflow
   * using Vercel AI SDK + Ollama (deepseek-v4.1-flash:cloud).
   */
  static async compile(
    prompt: string,
    pageState: PageState,
    config: AgentConfig
  ): Promise<WorkflowDefinition> {
    const cleanPrompt = prompt.trim();
    const endpoint = (config.systemTwoEndpoint || "http://localhost:11434/v1").replace(/\/+$/, "");
    const modelName = config.systemTwoModel || "deepseek-v4.1-flash:cloud";

    // Summarize page elements for LLM context
    const visibleSample = pageState.elements.slice(0, 30).map((el) => ({
      tag: el.tag,
      text: el.text || el.placeholder || "",
      role: el.role,
      isClickable: el.isClickable,
    }));

    const contextPrompt = `
【用户任务目标】: ${cleanPrompt}

【当前网页状态】:
- URL: ${pageState.url}
- 标题: ${pageState.title}
- 活跃弹窗: ${pageState.activeModal?.isOpen ? `是 ("${pageState.activeModal.title}")` : "否"}
- 页面关键可见元素样本:
${visibleSample.map((e) => `  • <${e.tag}> "${e.text}" (${e.role})`).join("\n")}
`;

    // Attempt AI SDK structured generation with Ollama
    try {
      const ollama = createOpenAI({
        baseURL: endpoint,
        apiKey: config.systemTwoApiKey || "ollama",
      });

      const { object } = await generateObject({
        model: ollama(modelName),
        schema: WorkflowZodSchema,
        system: DYNAMIC_WORKFLOW_SYSTEM_PROMPT,
        prompt: contextPrompt,
        temperature: 0.1,
      });

      if (object && object.script) {
        const fn = compileScriptToFunction(object.script);
        return {
          id: `workflow_${Date.now()}`,
          meta: {
            name: object.name || "dynamic_workflow",
            description: object.description || cleanPrompt,
            matchUrl: new URL(pageState.url || "http://localhost").hostname,
            phases: object.phases || ["执行操作"],
          },
          script: object.script,
          fn,
          isBuiltIn: false,
          createdAt: Date.now(),
        };
      }
    } catch (llmErr: any) {
      console.warn("[Ang] S2 LLM Workflow Compiler notice:", llmErr.message);

      // Attempt generateText fallback if generateObject mode is unsupported by local ollama version
      try {
        const ollama = createOpenAI({
          baseURL: endpoint,
          apiKey: config.systemTwoApiKey || "ollama",
        });

        const { text } = await generateText({
          model: ollama(modelName),
          system: `${DYNAMIC_WORKFLOW_SYSTEM_PROMPT}\nReturn ONLY the pure JavaScript code body inside \`\`\`javascript ... \`\`\` code fence.`,
          prompt: contextPrompt,
          temperature: 0.1,
        });

        const match = text.match(/```(?:javascript|js)?\s*([\s\S]+?)```/i);
        const scriptCode = match ? match[1].trim() : text.trim();

        if (scriptCode && (scriptCode.includes("ctx.jev") || scriptCode.includes("ctx.agent"))) {
          const fn = compileScriptToFunction(scriptCode);
          return {
            id: `workflow_${Date.now()}`,
            meta: {
              name: "dynamic_custom_workflow",
              description: cleanPrompt,
              matchUrl: new URL(pageState.url || "http://localhost").hostname,
              phases: ["动态工作流执行"],
            },
            script: scriptCode,
            fn,
            isBuiltIn: false,
            createdAt: Date.now(),
          };
        }
      } catch (textErr: any) {
        console.warn("[Ang] S2 LLM generateText fallback notice:", textErr.message);
      }
    }

    // Universal Fallback Dynamic Workflow (Safe, robust, zero-crash)
    return this.createUniversalFallbackWorkflow(cleanPrompt, pageState);
  }

  /**
   * Universal Fallback Dynamic Workflow Function
   * Generates a clean JavaScript workflow without brittle regex parsing
   */
  private static createUniversalFallbackWorkflow(
    prompt: string,
    pageState: PageState
  ): WorkflowDefinition {
    const isLoopIntent = /(?:全部|所有|批量|逐个|每一个|每个|all|batch|every)/i.test(prompt);

    let script: string;

    if (isLoopIntent) {
      script = `
const { jev, getPage, wait, scroll, phase, log } = ctx;
let processedCount = 0;
const safetyLimit = 100;

phase("扫描待办项");
log("🚀 启动批量自动化工作流，实时检测页面待处理项...");

while (processedCount < safetyLimit) {
  const page = await getPage();

  // 1. 实时寻找当前视口中的可操作项（处理/审批/办理）
  let processBtn = page.elements.find(e => 
    (e.text.startsWith("处理") || e.text.startsWith("审批") || e.text.startsWith("办理")) && e.isClickable
  );

  // 2. 若当前视口未找到，轻微向下滚动扫描
  if (!processBtn) {
    await scroll(300);
    await wait(800);
    const scrolledPage = await getPage();
    processBtn = scrolledPage.elements.find(e => 
      (e.text.startsWith("处理") || e.text.startsWith("审批") || e.text.startsWith("办理")) && e.isClickable
    );
  }

  // 3. 实时判断：如果依然没有，检查是否有【下一页】翻页
  if (!processBtn) {
    const nextPage = page.elements.find(e => 
      e.text.includes("下一页") && e.isClickable && !e.selector.includes("disabled")
    );
    if (nextPage) {
      log("当前页待办已处理完，正在翻至下一页...");
      await jev("点击【下一页】翻页");
      await wait(2000);
      continue;
    }

    // 实时检测无更多待办，自然完成
    log("🎉 页面实时检测完成：已无更多待处理事项，工作流顺利结束！");
    break;
  }

  // 4. 实时处理该项
  processedCount++;
  log("正在处理第 " + processedCount + " 笔事项...");
  phase("处理详情");
  await jev("在列表中点击下一条【处理】或【办理】按钮");
  await wait(1800);

  // 检查详情页审批操作
  const detailState = await getPage();
  const approveBtn = detailState.elements.find(e => 
    ["通过", "同意", "审批通过", "核准"].includes(e.text)
  );
  if (approveBtn) {
    await jev("点击【" + approveBtn.text + "】操作按钮");
    await wait(1200);
  }

  // 检查二次确认弹窗
  const modalCheck = await getPage();
  if (modalCheck.activeModal?.isOpen) {
    phase("二次确认");
    log("检测到确认弹窗，正在确认...");
    await jev("在弹窗中点击【确认】或【确定】按钮");
    await wait(1500);
  }

  // 返回列表继续下一次实时检测
  const returnCheck = await getPage();
  if (/DETAIL|APPLY/i.test(returnCheck.url)) {
    const returnBtn = returnCheck.elements.find(e => e.text === "返回" || e.ariaLabel === "返回");
    if (returnBtn) {
      await jev("点击【返回】按钮回到列表");
      await wait(1800);
    }
  }
}

log("🏁 自动化流程结束，累计实时处理完成: " + processedCount + " 项");
return { processedCount };
`;
    } else {
      script = `
const { jev, getPage, wait, phase, log, successCheck } = ctx;
const taskGoal = "${prompt.replace(/"/g, '\\"')}";

phase("任务目标感知");
log("🎯 启动闭环动态工作流，目标: " + taskGoal);

let step = 0;
const maxSteps = 8;
let isFinished = false;

while (step < maxSteps && !isFinished) {
  step++;

  // 执行感知决策动作向目标迈进
  phase("执行步骤 " + step);
  log("正在执行第 " + step + " 步感知决策: " + taskGoal);
  const decision = await jev(taskGoal);
  await wait(1800);

  // 3. 弹窗二次确认守卫
  const afterPage = await getPage();
  if (afterPage.activeModal?.isOpen) {
    phase("二次确认");
    log("检测到前台确认弹窗，执行确认...");
    await jev("在弹窗中点击【确认】或【确定】按钮");
    await wait(1500);
  }

  // 4. 每步后置达成校验 (successCheck)
  const postCheck = await successCheck(taskGoal);
  if (postCheck.isGoalReached || decision.actionType === "finish") {
    phase("目标达成");
    log("🎉 步骤后置校验确认：目标已顺利完成！");
    isFinished = true;
    break;
  }

  // 5. 若找不到目标元素且无状态变化，终止避免无谓死循环
  if (decision.targetElementId === "none_of_above") {
    log("⚠️ 当前页面未匹配到进一步可操作项，工作流结束");
    break;
  }
}

if (!isFinished) {
  log("🏁 已完成 " + step + " 步操作探查，工作流顺利结束");
}
`;
    }

    const fn = compileScriptToFunction(script);

    return {
      id: `workflow_${Date.now()}`,
      meta: {
        name: isLoopIntent ? "batch_loop_workflow" : "dynamic_action_workflow",
        description: prompt,
        matchUrl: new URL(pageState.url || "http://localhost").hostname,
        phases: isLoopIntent ? ["检索列表项", "处理详情", "二次确认"] : ["执行目标操作", "二次确认"],
      },
      script: script.trim(),
      fn,
      isBuiltIn: false,
      createdAt: Date.now(),
    };
  }
}
