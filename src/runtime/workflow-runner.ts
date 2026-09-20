import { CDPClient } from "../background/cdp-client.js";
import { TypeSafeService } from "../background/typesafe-service.js";
import { AgentConfig, PageState } from "../shared/types.js";
import { ConditionSpec, evaluateCondition } from "../shared/conditions.js";
import { WorkflowContext, WorkflowFunction, SuccessCheckResult } from "../workflows/types.js";
import { sleep } from "../background/bezier-mouse.js";

export interface WorkflowRunnerHooks {
  onLog?: (phase: string, level: "info" | "success" | "warning" | "error", message: string) => void;
  onPhase?: (title: string) => void;
  onLineUpdate?: (line: number) => void;
}

export class WorkflowRunner {
  /**
   * Executes a native Dynamic Workflow JavaScript Recipe within the trusted runtime context.
   */
  static async execute(
    tabId: number,
    fn: WorkflowFunction,
    cdp: CDPClient,
    typesafeService: TypeSafeService,
    config: AgentConfig,
    hooks: WorkflowRunnerHooks,
    args?: any
  ): Promise<any> {
    const fetchPage = async (): Promise<PageState> => {
      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (res?.state) resolve(res.state);
          else reject(new Error("提取页面状态失败"));
        });
      });
    };

    const ctx: WorkflowContext = {
      jev: async (subgoal: string, options?: any) => {
        hooks.onLog?.(subgoal, "info", `Jev 正在执行决策: "${subgoal}"...`);
        const page = await fetchPage();
        const decision = await typesafeService.decideNextAction(subgoal, subgoal, page, page.elements);

        if (decision.targetElementId && decision.targetElementId !== "none_of_above") {
          const el = page.elements.find((e) => e.id === decision.targetElementId);
          if (el) {
            const desc = `[${el.id}] <${el.tag}> "${el.text || el.placeholder || ""}"`;
            hooks.onLog?.(subgoal, "success", `S1 执行动作 -> ${desc}`);
            if (options?.text || decision.actionType === "type") {
              await cdp.clickElement(el.rect, config.antiBotMode);
              await sleep(150);
              await cdp.typeText(options?.text || subgoal, config.antiBotMode);
            } else {
              await cdp.clickElement(el.rect, config.antiBotMode);
            }
            await sleep(1200);
          }
        }
        return decision;
      },

      successCheck: async (criteria?: any, options?: any): Promise<SuccessCheckResult> => {
        let timeoutMs = 3000;
        let pollInterval = 150;
        let spec: ConditionSpec | string = criteria;

        if (typeof criteria === "number") {
          timeoutMs = criteria;
          spec = "";
        } else if (typeof options === "number") {
          timeoutMs = options;
        } else if (typeof options === "object" && options !== null) {
          if (options.timeout) timeoutMs = options.timeout;
          if (options.pollInterval) pollInterval = options.pollInterval;
        }

        const startTime = Date.now();
        while (Date.now() - startTime <= timeoutMs) {
          try {
            const page = await fetchPage();
            const result = evaluateCondition(page, spec);
            if (result.matched) {
              const elapsed = Date.now() - startTime;
              hooks.onLog?.("状态校验", "success", `⚡ [SuccessCheck] ${result.reason} (耗时 ${elapsed}ms)`);
              return { isGoalReached: true, confidence: 1.0, elapsedMs: elapsed, reason: result.reason };
            }
          } catch {}
          await sleep(pollInterval);
        }

        const elapsed = Date.now() - startTime;
        hooks.onLog?.("状态校验", "warning", `[SuccessCheck 超时] 未在 ${timeoutMs}ms 内检测到达成状态`);
        return { isGoalReached: false, confidence: 0.0, elapsedMs: elapsed, reason: "Timeout" };
      },

      verify: async (criteria?: any, options?: any) => ctx.successCheck(criteria, options),
      agent: async (prompt: string, options?: any) => ctx.jev(prompt, options),
      phase: (title: string) => hooks.onPhase?.(title),
      log: (message: string) => hooks.onLog?.("Workflow", "info", message),
      getPage: async () => fetchPage(),
      wait: async (ms: number) => sleep(ms),
      scroll: async (dy: number) => cdp.scroll(dy),
      step: (_label?: string) => {},
      args,
    };

    (ctx as any).__onLineUpdate = (line: number) => hooks.onLineUpdate?.(line);

    return await fn(ctx);
  }
}
