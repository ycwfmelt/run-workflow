import { CDPClient } from "../background/cdp-client.js";
import { TypeSafeService } from "../background/typesafe-service.js";
import { AgentConfig, PageState } from "../shared/types.js";
import { ConditionSpec, evaluateCondition } from "../shared/conditions.js";
import {
  WorkflowContext,
  WorkflowFunction,
  SuccessCheckResult,
  PhaseCheckpoint,
} from "../workflows/types.js";
import { sleep } from "../background/bezier-mouse.js";

export interface WorkflowRunnerHooks {
  onLog?: (phase: string, level: "info" | "success" | "warning" | "error", message: string) => void;
  onPhase?: (title: string) => void;
  onLineUpdate?: (line: number) => void;
}

export class WorkflowRunner {
  /**
   * Executes a native Dynamic Workflow JavaScript Recipe within the trusted runtime context.
   * Features resilient Phase Checkpoints, Autonomous Rollback, and Jev Self-Healing.
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
    const checkpoints: PhaseCheckpoint[] = [];
    let activePhaseTitle = "";

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
      currentPhase: activePhaseTitle,

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
        let autoHeal = true;
        let spec: ConditionSpec | string = criteria;

        if (typeof criteria === "number") {
          timeoutMs = criteria;
          spec = "";
        } else if (typeof options === "number") {
          timeoutMs = options;
        } else if (typeof options === "object" && options !== null) {
          if (options.timeout) timeoutMs = options.timeout;
          if (options.pollInterval) pollInterval = options.pollInterval;
          if (options.autoHeal !== undefined) autoHeal = options.autoHeal;
        }

        // 1. Normal fast-exit adaptive polling
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

        // 2. Self-Healing Intervention: If guard fails, let Jev attempt recovery / rollback
        if (autoHeal) {
          const phaseName = activePhaseTitle || "当前步骤";
          hooks.onLog?.(
            "Jev自愈",
            "warning",
            `⚠️ [Guard 未达成] Phase [${phaseName}] 未在 ${timeoutMs}ms 内检测到达成状态，Jev 介入自愈 (Self-Healing)...`
          );

          // A. Rollback check: Did URL drift away from phase checkpoint?
          const cp = checkpoints[checkpoints.length - 1];
          const curPage = await fetchPage().catch(() => null);
          if (cp && curPage && cp.url && curPage.url !== cp.url) {
            hooks.onLog?.(
              "状态回滚",
              "warning",
              `检测到页面路由偏离预期，正在执行回滚至 Checkpoint: ${cp.url}`
            );
            await ctx.rollback(cp);
          }

          // B. Jev adaptive corrective action
          const healGoal = activePhaseTitle ? `完成阶段目标: ${activePhaseTitle}` : "完成当前步骤";
          await ctx.jev(healGoal);

          // C. Re-verify guard
          await sleep(800);
          const healStartTime = Date.now();
          while (Date.now() - healStartTime <= 2000) {
            try {
              const healedPage = await fetchPage();
              const healedResult = evaluateCondition(healedPage, spec);
              if (healedResult.matched) {
                const totalElapsed = Date.now() - startTime;
                hooks.onLog?.(
                  "自愈成功",
                  "success",
                  `🎉 Jev 已成功自愈当前 Phase [${phaseName}]，恢复后续工作流执行！`
                );
                return {
                  isGoalReached: true,
                  confidence: 1.0,
                  isHealed: true,
                  elapsedMs: totalElapsed,
                  reason: `Self-healed by Jev: ${healedResult.reason}`,
                };
              }
            } catch {}
            await sleep(pollInterval);
          }
        }

        const elapsed = Date.now() - startTime;
        hooks.onLog?.("状态校验", "warning", `[SuccessCheck 超时] 未在 ${timeoutMs}ms 内检测到达成状态`);
        return { isGoalReached: false, confidence: 0.0, elapsedMs: elapsed, reason: "Timeout" };
      },

      phase: (title: string) => {
        activePhaseTitle = title;
        ctx.currentPhase = title;
        hooks.onPhase?.(title);

        // Record phase checkpoint
        fetchPage()
          .then((page) => {
            const cp: PhaseCheckpoint = {
              phase: title,
              phaseIndex: checkpoints.length + 1,
              url: page.url,
              title: page.title,
              timestamp: Date.now(),
            };
            checkpoints.push(cp);
            hooks.onLog?.(title, "info", `📍 进入 Phase [${title}] (状态机检查点: ${page.url})`);
          })
          .catch(() => {
            hooks.onLog?.(title, "info", `📍 进入 Phase [${title}]`);
          });
      },

      getCheckpoint: async () => {
        return checkpoints[checkpoints.length - 1] || null;
      },

      rollback: async (targetCheckpoint?: PhaseCheckpoint) => {
        const target = targetCheckpoint || checkpoints[checkpoints.length - 1];
        if (!target) return false;

        const current = await fetchPage().catch(() => null);
        if (current && target.url && current.url !== target.url) {
          hooks.onLog?.(
            "状态回滚",
            "warning",
            `⏪ 检测到路径偏离，正在回滚至 Phase [${target.phase}] 检查点 (${target.url})...`
          );
          await new Promise<void>((resolve) => {
            chrome.tabs.update(tabId, { url: target.url }, () => {
              setTimeout(resolve, 1500);
            });
          });
          return true;
        }

        // If URL already matches, attempt gentle state restoration (scroll to top)
        await cdp.scroll(-400);
        await sleep(400);
        return true;
      },

      heal: async (subgoal?: string, options?: any) => {
        const goal = subgoal || activePhaseTitle || "恢复并推进当前步骤";
        hooks.onLog?.("Jev自愈", "info", `Jev 正在自愈执行: "${goal}"...`);
        await ctx.jev(goal, options);
        return true;
      },

      verify: async (criteria?: any, options?: any) => ctx.successCheck(criteria, options),
      agent: async (prompt: string, options?: any) => ctx.jev(prompt, options),
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
