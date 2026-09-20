import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { CDPClient } from "../background/cdp-client.js";
import { TypeSafeService } from "../background/typesafe-service.js";
import { AgentConfig, PageState } from "../shared/types.js";
import { ConditionSpec, evaluateCondition } from "../shared/conditions.js";
import { TraceStep, deriveGuard } from "../shared/trace.js";
import { sleep } from "../background/bezier-mouse.js";

export interface AgentKernelHooks {
  onLog?: (phase: string, level: "info" | "success" | "warning" | "error", message: string) => void;
  onStepFinish?: (step: number, toolCalls: any[], trace: TraceStep[]) => void;
}

export class AgentKernel {
  /**
   * Autonomous exploration loop.
   * Prioritizes Vercel AI SDK Tool Calling ReAct loop when S2 is reachable;
   * seamlessly falls back to TypeSafe System One State Machine when S2 is offline.
   */
  async runExploration(
    tabId: number,
    prompt: string,
    initialPageState: PageState,
    cdp: CDPClient,
    typesafeService: TypeSafeService,
    config: AgentConfig,
    hooks: AgentKernelHooks,
    abortSignal?: AbortSignal
  ): Promise<TraceStep[]> {
    // 1. If S2 provider is configured, try Vercel AI SDK Tool Calling loop
    if (config.systemTwoEndpoint && config.systemTwoProvider !== "none") {
      try {
        hooks.onLog?.("Supervisor", "info", `🤖 S2 模型原生自主循环启动: "${prompt}"`);
        return await this.runVercelAiSdkLoop(tabId, prompt, initialPageState, cdp, config, hooks, abortSignal);
      } catch (err: any) {
        hooks.onLog?.("Supervisor", "info", `S2 模型外部服务未就绪 (${err.message})，平滑切换至 TypeSafe 状态机引擎...`);
      }
    }

    // 2. Smooth, zero-crash fallback: TypeSafe S1 State Machine exploration
    return await this.runTypeSafeStateLoop(tabId, prompt, initialPageState, cdp, typesafeService, config, hooks, abortSignal);
  }

  /**
   * Mode A: Vercel AI SDK Multi-step Tool Calling ReAct loop
   */
  private async runVercelAiSdkLoop(
    tabId: number,
    prompt: string,
    initialPageState: PageState,
    cdp: CDPClient,
    config: AgentConfig,
    hooks: AgentKernelHooks,
    abortSignal?: AbortSignal
  ): Promise<TraceStep[]> {
    const trace: TraceStep[] = [];
    let stepCount = 0;
    let currentPage = initialPageState;

    const endpoint = (config.systemTwoEndpoint || "http://localhost:11434/v1").replace(/\/+$/, "");
    const modelName = config.systemTwoModel || "deepseek-v4.1-flash:cloud";
    const apiKey = config.systemTwoApiKey || config.typesafeApiKey || "ollama";
    const s2Client = createOpenAI({ baseURL: endpoint, apiKey });

    const fetchLatestPage = async (): Promise<PageState> => {
      return new Promise<PageState>((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, (res) => {
          if (res?.state) resolve(res.state);
          else resolve(currentPage);
        });
      });
    };

    const simplifyElements = (elements: PageState["elements"]) =>
      elements.slice(0, 40).map((e) => ({
        id: e.id,
        tag: e.tag,
        text: e.text || e.placeholder || "",
        role: e.role,
        isClickable: e.isClickable,
        isInput: e.isInput,
      }));

    await generateText({
      model: s2Client(modelName),
      system: `You are an autonomous web automation supervisor. Your task: "${prompt}".
Observe the interactive elements, call tools to progress state until the overall goal is fully achieved.
When the goal is confirmed complete, call the finish tool.`,
      prompt: `Current URL: ${currentPage.url}\nTitle: ${currentPage.title}\nInteractive Elements:\n${JSON.stringify(simplifyElements(currentPage.elements), null, 2)}`,
      maxSteps: config.maxSteps || 8,
      abortSignal,
      tools: {
        act: tool({
          description: "Execute visual click, type, or scroll via S1 CDP",
          parameters: z.object({
            elementId: z.string().describe("Target element id e.g. el_1"),
            action: z.enum(["click", "type", "scroll"]),
            text: z.string().optional().describe("Text to type if action is type"),
            intent: z.string().describe("Short action description, e.g. 点击领取今日奖励"),
          }),
          execute: async ({ elementId, action, text, intent }) => {
            stepCount++;
            const before = currentPage;
            const targetEl = before.elements.find((e) => e.id === elementId);
            if (!targetEl) return { error: `Element ${elementId} not found` };

            hooks.onLog?.(`步骤 ${stepCount}`, "info", `S1 执行动作: ${intent} [${targetEl.id}] <${targetEl.tag}>`);

            if (action === "type" && text) {
              await cdp.clickElement(targetEl.rect, config.antiBotMode);
              await sleep(150);
              await cdp.typeText(text, config.antiBotMode);
            } else {
              await cdp.clickElement(targetEl.rect, config.antiBotMode);
            }

            await sleep(1600);
            currentPage = await fetchLatestPage();
            const after = currentPage;

            const guard = deriveGuard(before, after, targetEl.text || targetEl.placeholder || targetEl.value);
            const deltaDesc = after.url !== before.url ? `URL跳转: ${before.url} ➔ ${after.url}` : `页面状态更新`;

            trace.push({
              step: stepCount,
              intent,
              action: { type: action, elementId: targetEl.id, elementDescription: `<${targetEl.tag}> "${targetEl.text}"`, text },
              before: { url: before.url, title: before.title },
              after: { url: after.url, title: after.title },
              guard,
              stateDelta: deltaDesc,
            });

            return { url: after.url, title: after.title, delta: deltaDesc, elements: simplifyElements(after.elements) };
          },
        }),

        verify: tool({
          description: "Verify if a condition is satisfied on the current page",
          parameters: z.object({
            url: z.string().optional(),
            text: z.string().optional(),
            selector: z.string().optional(),
            disappeared: z.string().optional(),
          }),
          execute: async (criteria: ConditionSpec) => evaluateCondition(currentPage, criteria),
        }),

        finish: tool({
          description: "Conclude task when overall goal is verified complete",
          parameters: z.object({ summary: z.string() }),
          execute: async ({ summary }) => {
            hooks.onLog?.("目标达成", "success", `🎉 ${summary}`);
            return { completed: true, summary };
          },
        }),
      },
      onStepFinish: async ({ toolCalls }) => {
        hooks.onStepFinish?.(stepCount, toolCalls, trace);
      },
    });

    return trace;
  }

  /**
   * Mode B: TypeSafe S1 State Machine exploration loop (Cloud TypeSafe API)
   */
  private async runTypeSafeStateLoop(
    tabId: number,
    prompt: string,
    initialPageState: PageState,
    cdp: CDPClient,
    typesafeService: TypeSafeService,
    config: AgentConfig,
    hooks: AgentKernelHooks,
    abortSignal?: AbortSignal
  ): Promise<TraceStep[]> {
    const trace: TraceStep[] = [];
    let currentPage = initialPageState;
    const maxSteps = config.maxSteps || 8;
    let step = 0;

    const fetchLatestPage = async (): Promise<PageState> => {
      return new Promise<PageState>((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, (res) => {
          if (res?.state) resolve(res.state);
          else resolve(currentPage);
        });
      });
    };

    hooks.onLog?.("Supervisor", "info", `🤖 S2 Supervisor 状态机推进模式启动: "${prompt}"`);

    while (step < maxSteps && !abortSignal?.aborted) {
      step++;
      hooks.onLog?.(`步骤 ${step}`, "info", `[状态 S_${step - 1}] 分析页面: ${currentPage.url} (${currentPage.title})`);

      // 1. Check completion (only after at least 1 action has been taken)
      if (step > 1) {
        const check = await typesafeService.decideNextAction(
          prompt,
          `检查任务是否已全部完成: "${prompt}"`,
          currentPage,
          currentPage.elements
        );
        if (check.isGoalReached || check.actionType === "finish") {
          hooks.onLog?.("目标达成", "success", `🎉 S2 Supervisor 判定：总目标 "${prompt}" 已顺利完成！`);
          break;
        }
      }

      // 2. Decide next state transition action
      const decision = await typesafeService.decideNextAction(prompt, prompt, currentPage, currentPage.elements);
      if (!decision.targetElementId || decision.targetElementId === "none_of_above" || decision.actionType === "finish") {
        hooks.onLog?.("探索结束", "info", "未发现进一步可操作项，状态机探索完成");
        break;
      }

      const targetEl = currentPage.elements.find((e) => e.id === decision.targetElementId);
      if (!targetEl) break;

      const desc = `[${targetEl.id}] <${targetEl.tag}> "${targetEl.text || targetEl.placeholder || ""}"`;
      const intent = targetEl.text ? `点击【${targetEl.text}】` : `操作 ${desc}`;
      hooks.onLog?.(`步骤 ${step}`, "info", `S1 执行动作 -> ${desc}`);

      const before = currentPage;
      if (decision.actionType === "type" && targetEl.isInput) {
        await cdp.clickElement(targetEl.rect, config.antiBotMode);
        await sleep(150);
        await cdp.typeText(prompt, config.antiBotMode);
      } else {
        await cdp.clickElement(targetEl.rect, config.antiBotMode);
      }

      await sleep(1600);
      currentPage = await fetchLatestPage();
      const after = currentPage;

      const guard = deriveGuard(before, after, targetEl.text || targetEl.placeholder || targetEl.value);
      const deltaDesc = after.url !== before.url ? `URL 从 ${before.url} 跳转至 ${after.url}` : `页面状态就地更新`;

      trace.push({
        step,
        intent,
        action: { type: decision.actionType as any, elementId: targetEl.id, elementDescription: desc },
        before: { url: before.url, title: before.title },
        after: { url: after.url, title: after.title },
        guard,
        stateDelta: deltaDesc,
      });

      hooks.onStepFinish?.(step, [{ name: "act", args: { elementId: targetEl.id, intent } }], trace);

      if (after.url !== before.url) {
        hooks.onLog?.("状态跃迁", "success", `🔗 浏览器状态转移: ${before.url} ➔ ${after.url}`);
      }
    }

    return trace;
  }
}
