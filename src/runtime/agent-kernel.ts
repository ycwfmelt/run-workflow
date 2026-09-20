import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { CDPClient } from "../background/cdp-client.js";
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
   * Autonomous exploration loop powered natively by Vercel AI SDK Tool Calling.
   * Model-driven ReAct cycle with hooks for UI telemetry and trace collection (< 100 lines).
   */
  async runExploration(
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

    hooks.onLog?.("Supervisor", "info", `🤖 S2 模型原生自主循环启动: "${prompt}"`);

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
}
