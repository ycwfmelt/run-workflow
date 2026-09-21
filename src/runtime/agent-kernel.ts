import { generateText, tool, isStepCount } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { CDPClient } from "../background/cdp-client.js";
import { AgentConfig, PageState, InteractiveElement } from "../shared/types.js";
import { ConditionSpec, evaluateCondition } from "../shared/conditions.js";
import { TraceStep, deriveGuard } from "../shared/trace.js";
import { sleep } from "../background/bezier-mouse.js";

export interface AgentKernelHooks {
  onLog?: (phase: string, level: "info" | "success" | "warning" | "error", message: string) => void;
  onStepFinish?: (step: number, toolCalls: any[], trace: TraceStep[]) => void;
}

/**
 * Ranks and prioritizes interactive elements based on prompt intent.
 * Guarantees that elements matching target keywords (e.g. angelina-dev, config-manifest, 重启)
 * as well as essential inputs/selects are placed at the top of the model prompt.
 */
function rankElements(
  elements: PageState["elements"],
  prompt: string,
  limit: number = 120
) {
  // Extract keywords (both English tokens and Chinese words)
  const tokens = prompt
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored = elements.map((el, idx) => {
    let score = 0;
    const fullText = `${el.id} ${el.tag} ${el.text || ""} ${el.role || ""} ${el.selector || ""}`.toLowerCase();

    // 1. Keyword match in element text or row context
    for (const token of tokens) {
      if (fullText.includes(token)) {
        score += 80;
        if ((el.text || "").toLowerCase().includes(token)) {
          score += 60;
        }
      }
    }

    // 2. High-value interactive controls
    if (el.isInput || el.tag === "select" || el.role === "combobox") {
      score += 40; // inputs / dropdowns are critical for navigation & search
    }
    if (el.text && (el.text.includes("重启") || el.text.includes("restart") || el.text.includes("manifest"))) {
      score += 100;
    }

    // 3. Preserve natural visual order slightly
    score += Math.max(0, 30 - idx * 0.15);

    return {
      score,
      element: {
        id: el.id,
        tag: el.tag,
        text: el.text || el.placeholder || "",
        role: el.role,
        isClickable: el.isClickable,
        isInput: el.isInput,
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.element);
}

export class AgentKernel {
  /**
   * Autonomous exploration loop powered purely by Vercel AI SDK Tool Calling.
   * Direct model-driven ReAct cycle with hooks for UI telemetry and trace collection.
   * Zero silent fallback — executes configured S2 directly and fails loudly if unreachable.
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

    hooks.onLog?.("Supervisor", "info", `🤖 S2 模型原生自主循环启动: "${prompt}"`);

    const initialVisibleElements = rankElements(currentPage.elements, prompt, 120);

    const result = await generateText({
      model: s2Client.chat(modelName),
      system: `You are an autonomous web automation supervisor. Your task: "${prompt}".
Observe the interactive elements, call tools to progress state until the overall goal is fully achieved.
When looking for a specific item (e.g. application, namespace, or action button):
- Inspect the elements carefully. Elements inside tables have contextual row data attached, e.g. "重启 (行数据: config-manifest | angelina-dev)".
- If the item is not immediately visible, use search/filter inputs or call act with action: "scroll" to scroll down.
- When the goal is confirmed complete, call the finish tool.`,
      prompt: `Current URL: ${currentPage.url}\nTitle: ${currentPage.title}\nTotal Interactive Elements: ${currentPage.elements.length}\nTop Interactive Elements:\n${JSON.stringify(initialVisibleElements, null, 2)}`,
      stopWhen: isStepCount(config.maxSteps || 15),
      abortSignal,
      tools: {
        act: tool({
          description: "Execute visual click, type, or scroll via S1 CDP",
          inputSchema: z.object({
            elementId: z.string().optional().describe("Target element id e.g. el_1 (required for click and type)"),
            action: z.enum(["click", "type", "scroll"]).describe("Action to perform"),
            text: z.string().optional().describe("Text to type if action is type"),
            scrollDeltaY: z.number().optional().describe("Pixels to scroll if action is scroll (positive = down, negative = up, e.g. 450)"),
            intent: z.string().describe("Short action description, e.g. 点击命名空间下拉菜单 或 向下滚动页面寻找应用"),
          }),
          execute: async ({
            elementId,
            action,
            text,
            scrollDeltaY,
            intent,
          }: {
            elementId?: string;
            action: "click" | "type" | "scroll";
            text?: string;
            scrollDeltaY?: number;
            intent: string;
          }) => {
            stepCount++;
            const before = currentPage;

            // 1. Scroll action
            if (action === "scroll") {
              const delta = scrollDeltaY ?? 450;
              hooks.onLog?.(
                `步骤 ${stepCount}`,
                "info",
                `📜 执行滚动: ${intent} (${delta > 0 ? "向下" : "向上"} ${Math.abs(delta)}px)`
              );
              await cdp.scroll(delta);
              await sleep(1200);
              currentPage = await fetchLatestPage();
              const after = currentPage;
              const deltaDesc = `页面已滚动 ${delta > 0 ? "向下" : "向上"} ${Math.abs(delta)}px`;

              trace.push({
                step: stepCount,
                intent,
                action: { type: "scroll", elementDescription: `Scroll ${delta}px` },
                before: { url: before.url, title: before.title },
                after: { url: after.url, title: after.title },
                stateDelta: deltaDesc,
              });

              return {
                url: after.url,
                title: after.title,
                delta: deltaDesc,
                elements: rankElements(after.elements, prompt, 120),
              };
            }

            // 2. Click or Type action
            if (!elementId) {
              hooks.onLog?.(`步骤 ${stepCount}`, "warning", `⚠️ 未指定 elementId`);
              return { error: "elementId is required for click and type actions" };
            }

            const targetEl = before.elements.find((e) => e.id === elementId);
            if (!targetEl) {
              hooks.onLog?.(
                `步骤 ${stepCount}`,
                "warning",
                `⚠️ 目标元素 [${elementId}] 未在当前可见 DOM 中找到，正在提示模型通过搜索框筛选或滚动页面...`
              );
              return {
                error: `Element ${elementId} not found in current page view.`,
                availableElements: rankElements(before.elements, prompt, 25).map(
                  (e) => `[${e.id}] <${e.tag}> "${e.text}"`
                ),
                hint: `If the target application or element is below the fold, call act with action: "scroll" and scrollDeltaY: 450 to reveal it. Or type the application name into a search/filter input first.`,
              };
            }

            hooks.onLog?.(
              `步骤 ${stepCount}`,
              "info",
              `S1 执行动作: ${intent} [${targetEl.id}] <${targetEl.tag}> "${targetEl.text || ""}"`
            );

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

            return {
              url: after.url,
              title: after.title,
              delta: deltaDesc,
              elements: rankElements(after.elements, prompt, 120),
            };
          },
        }),

        verify: tool({
          description: "Verify if a condition is satisfied on the current page",
          inputSchema: z.object({
            url: z.string().optional(),
            text: z.string().optional(),
            selector: z.string().optional(),
            disappeared: z.string().optional(),
          }),
          execute: async (criteria: ConditionSpec) => evaluateCondition(currentPage, criteria),
        }),

        finish: tool({
          description: "Conclude task when overall goal is verified complete",
          inputSchema: z.object({ summary: z.string() }),
          execute: async ({ summary }: { summary: string }) => {
            hooks.onLog?.("目标达成", "success", `🎉 ${summary}`);
            return { completed: true, summary };
          },
        }),
      },
      onStepFinish: async ({ toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          hooks.onStepFinish?.(stepCount, toolCalls, trace);
        }
      },
    });

    if (trace.length === 0) {
      if (result.text && result.text.trim()) {
        hooks.onLog?.("S2分析诊断", "warning", `🤖 模型未触发动作，输出说明: ${result.text.trim()}`);
      } else {
        hooks.onLog?.(
          "S2分析诊断",
          "warning",
          `⚠️ 未检测到有效交互动作（共提取到 ${currentPage.elements.length} 个可视元素）。如果页面包含跨域 Iframe 或 Shadow DOM，请点击【🔍 诊断页面】排查。`
        );
      }
    }

    return trace;
  }
}
