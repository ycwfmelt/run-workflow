import { generateText, tool, isStepCount } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { CDPClient } from "../background/cdp-client.js";
import { AgentConfig, PageState } from "../shared/types.js";
import { ConditionSpec, evaluateCondition } from "../shared/conditions.js";
import { TraceStep } from "../shared/trace.js";
import { sleep } from "../background/bezier-mouse.js";
import { A11yTreeService, A11ySnapshot } from "./a11y-tree.js";

export interface AgentKernelHooks {
  onLog?: (phase: string, level: "info" | "success" | "warning" | "error", message: string) => void;
  onStepFinish?: (step: number, toolCalls: any[], trace: TraceStep[]) => void;
}

export class AgentKernel {
  /**
   * Autonomous exploration loop powered by Native A11y Tree (PinchTab-style)
   * and continuous DFS Hierarchical Box Exploration with explicit Exit Nodes.
   * Zero handcrafted heuristics — relies on browser's native accessibility engine.
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

    const endpoint = (config.systemTwoEndpoint || "http://localhost:11434/v1").replace(/\/+$/, "");
    const modelName = config.systemTwoModel || "deepseek-v4.1-flash:cloud";
    const apiKey = config.systemTwoApiKey || config.typesafeApiKey || "ollama";
    const s2Client = createOpenAI({ baseURL: endpoint, apiKey });

    hooks.onLog?.("Supervisor", "info", `🤖 S2 模型原生 A11y 树自主循环启动: "${prompt}"`);
    hooks.onLog?.("A11y扫描", "info", "正在抓取目标页面原生无障碍语义树 (AXTree)...");

    // Capture initial native A11y Snapshot
    let snapshot = await A11yTreeService.captureSnapshot(cdp, tabId);
    let currentFocusRef: string = "root";
    const breadcrumbs: string[] = ["Root"];
    const deadEnds: Array<{ ref: string; reason: string }> = [];

    hooks.onLog?.(
      "A11y就绪",
      "success",
      `✨ 无障碍地标索引构建完成（共 ${snapshot.rootBoxes.length} 个结构地标区域，${snapshot.allInteractiveElements.length} 个交互节点），交由 S2 规划中...`
    );

    const getCurrentViewText = (): string => {
      if (currentFocusRef === "root") {
        return snapshot.getRootOverview();
      }
      return snapshot.getBoxView(currentFocusRef);
    };

    const getSystemContext = (): string => {
      const parts: string[] = [];
      parts.push(`当前焦点层级 (Breadcrumbs): ${breadcrumbs.join(" > ")}`);
      if (deadEnds.length > 0) {
        parts.push(
          `已探查死路记录 (Dead-End History): ${deadEnds.map((d) => `[${d.ref}] (${d.reason})`).join("; ")}`
        );
      }
      return parts.join("\n");
    };

    const result = await generateText({
      model: s2Client.chat(modelName),
      system: `You are an autonomous web automation supervisor operating on a browser Native Accessibility Tree (A11y Tree).
Your task: "${prompt}".

### Operational Architecture (Continuous DFS Hierarchical Exploration):
1. Autonomous Navigation:
   - If the current page is empty (e.g. about:blank) or the user's task asks to open/visit a specific website or URL (e.g. "打开 github.com/trending", "前往百度"), call navigate({ url: "...", intent: "..." }). S2 autonomously determines destination URLs without brittle regex.
2. Cognitive Search (No DOM Mutations):
   - You start at the Root Landmark overview.
   - Use find_in_tree({ keyword: "..." }) to immediately locate target keywords (like application names, namespaces, or action verbs) anywhere in the page.
   - Use zoom_in({ containerRef: "bX", intent: "..." }) to drill down into a landmark container (e.g. main workspace, table, modal dialog).
   - If a container does NOT have what you need, use back_to_parent({ reason: "..." }) or exit_to_root({ reason: "..." }) (Exit Node). The system records your dead-end history so you never repeat mistakes.
3. Physical Action Execution (DOM Mutations):
   - When you have located the target interactive element (e.g. e10), call act({ elementRef: "e10", action: "click" | "type", intent: "..." }).
   - Real CDP click / input events will be executed with human-like curves.
4. Conclude:
   - When the overall task is verified complete, call finish({ summary: "..." }).`,
      prompt: `${getSystemContext()}\n\n${getCurrentViewText()}`,
      stopWhen: isStepCount(config.maxSteps || 15),
      abortSignal,
      onStepStart: ({ stepNumber }) => {
        hooks.onLog?.("S2思考", "info", `🧠 S2 正在推理决策第 ${stepNumber} 步动作...`);
      },
      tools: {
        navigate: tool({
          description: "Navigate current tab to a specified URL. Use when current page is blank, or the task requires visiting an external site or link.",
          inputSchema: z.object({
            url: z.string().describe("Target URL, e.g. https://www.google.com or https://github.com/trending"),
            intent: z.string().describe("Reason for navigation, e.g. 打开目标网址"),
          }),
          execute: async ({ url, intent }: { url: string; intent: string }) => {
            stepCount++;
            const beforeUrl = snapshot.url;
            const beforeTitle = snapshot.title;

            let targetUrl = url.trim();
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://") && !targetUrl.startsWith("about:")) {
              targetUrl = `https://${targetUrl}`;
            }

            hooks.onLog?.(`步骤 ${stepCount}`, "info", `🌐 页面导航: ${intent} ➔ ${targetUrl}`);

            await cdp.navigate(targetUrl);
            await sleep(2500);

            try {
              await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                files: ["content.js"],
              });
              await sleep(300);
            } catch {}

            snapshot = await A11yTreeService.captureSnapshot(cdp, tabId);
            currentFocusRef = "root";
            breadcrumbs.length = 1;

            const deltaDesc = `页面导航至: ${snapshot.url} (${snapshot.title || "无标题"})`;

            trace.push({
              step: stepCount,
              intent,
              action: {
                type: "navigate",
                elementDescription: `Navigate to ${targetUrl}`,
                text: targetUrl,
              },
              before: { url: beforeUrl, title: beforeTitle },
              after: { url: snapshot.url, title: snapshot.title },
              stateDelta: deltaDesc,
            });

            return {
              url: snapshot.url,
              title: snapshot.title,
              landmarksCount: snapshot.rootBoxes.length,
              interactiveCount: snapshot.allInteractiveElements.length,
              view: getCurrentViewText(),
              hint: "Navigation completed. Check the updated page view and proceed with exploration.",
            };
          },
        }),

        find_in_tree: tool({
          description: "Instantly search all nodes in the A11y Tree by keyword (e.g. application name, namespace, or verb)",
          inputSchema: z.object({
            keyword: z.string().describe("Keyword to search, e.g. config-manifest, angelina-dev, 重启"),
          }),
          execute: async ({ keyword }: { keyword: string }) => {
            hooks.onLog?.("A11y全局检索", "info", `🔎 检索无障碍树: "${keyword}"`);
            const searchResult = snapshot.search(keyword, 8);
            return {
              result: searchResult,
              hint: "You can zoom_in to the parent container of the found node, or directly act on the found element ref.",
            };
          },
        }),

        zoom_in: tool({
          description: "DFS Step: Drill down into a specific container/box to inspect its internal structure and elements",
          inputSchema: z.object({
            containerRef: z.string().describe("Target container ref e.g. b1, b3, b3_1"),
            intent: z.string().describe("Reason for exploring this container"),
          }),
          execute: async ({ containerRef, intent }: { containerRef: string; intent: string }) => {
            const targetBox = snapshot.nodesByRef.get(containerRef);
            if (!targetBox) {
              return { error: `Container [${containerRef}] not found in A11y tree.` };
            }

            currentFocusRef = containerRef;
            breadcrumbs.push(`[${containerRef}] ${targetBox.name || targetBox.role}`);
            hooks.onLog?.(
              "DFS深入",
              "info",
              `🔍 深入聚焦容器 [${containerRef}] <${targetBox.role}> "${targetBox.name || ""}" -> ${intent}`
            );

            return {
              currentPath: breadcrumbs.join(" > "),
              view: snapshot.getBoxView(containerRef),
              hint: "Inspect the direct elements or sub-containers. If this path is wrong, call back_to_parent with a reason.",
            };
          },
        }),

        back_to_parent: tool({
          description: "Exit Node: Backtrack to the parent container when current container has no valid path (DFS Backtrack)",
          inputSchema: z.object({
            reason: z.string().describe("Why this container was a dead end or did not have target items"),
          }),
          execute: async ({ reason }: { reason: string }) => {
            const currentBox = snapshot.nodesByRef.get(currentFocusRef);
            deadEnds.push({ ref: currentFocusRef, reason });

            if (breadcrumbs.length > 1) {
              breadcrumbs.pop();
            }

            if (currentBox?.parentRef && currentBox.parentRef !== "b1") {
              currentFocusRef = currentBox.parentRef;
            } else {
              currentFocusRef = "root";
            }

            hooks.onLog?.("DFS回退", "warning", `↩️ Exit Node 触发回退: ${reason}`);

            return {
              currentPath: breadcrumbs.join(" > "),
              view: getCurrentViewText(),
              deadEndRecorded: reason,
            };
          },
        }),

        exit_to_root: tool({
          description: "Exit Node: Reset focus back to the top-level root landmark overview",
          inputSchema: z.object({
            reason: z.string().describe("Reason for resetting back to the root"),
          }),
          execute: async ({ reason }: { reason: string }) => {
            deadEnds.push({ ref: currentFocusRef, reason });
            currentFocusRef = "root";
            breadcrumbs.length = 1;

            hooks.onLog?.("DFS重置", "warning", `🔄 重置回最外层概览: ${reason}`);

            return {
              currentPath: "Root",
              view: snapshot.getRootOverview(),
            };
          },
        }),

        act: tool({
          description: "Execute physical click, type, or scroll via CDP on a verified A11y element ref",
          inputSchema: z.object({
            elementRef: z.string().optional().describe("Target element ref e.g. e10, e42 (required for click and type)"),
            action: z.enum(["click", "type", "scroll"]).describe("Action to perform"),
            text: z.string().optional().describe("Text to type if action is type"),
            scrollDeltaY: z.number().optional().describe("Pixels to scroll (positive = down, negative = up)"),
            intent: z.string().describe("Action intent e.g. 点击确认重启, 输入应用名称"),
          }),
          execute: async ({
            elementRef,
            action,
            text,
            scrollDeltaY,
            intent,
          }: {
            elementRef?: string;
            action: "click" | "type" | "scroll";
            text?: string;
            scrollDeltaY?: number;
            intent: string;
          }) => {
            stepCount++;
            const beforeUrl = snapshot.url;
            const beforeTitle = snapshot.title;

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

              snapshot = await A11yTreeService.captureSnapshot(cdp, tabId);
              const deltaDesc = `页面已滚动 ${delta > 0 ? "向下" : "向上"} ${Math.abs(delta)}px`;

              trace.push({
                step: stepCount,
                intent,
                action: { type: "scroll", elementDescription: `Scroll ${delta}px` },
                before: { url: beforeUrl, title: beforeTitle },
                after: { url: snapshot.url, title: snapshot.title },
                stateDelta: deltaDesc,
              });

              return {
                url: snapshot.url,
                title: snapshot.title,
                view: getCurrentViewText(),
              };
            }

            // 2. Click or Type action
            if (!elementRef) {
              hooks.onLog?.(`步骤 ${stepCount}`, "warning", `⚠️ 未指定 elementRef`);
              return { error: "elementRef is required for click and type actions" };
            }

            const targetNode = snapshot.nodesByRef.get(elementRef);
            if (!targetNode || !targetNode.backendNodeId) {
              hooks.onLog?.(
                `步骤 ${stepCount}`,
                "warning",
                `⚠️ A11y 节点 [${elementRef}] 未找到有效 DOM 映射，提示模型检查`
              );
              return {
                error: `Element [${elementRef}] not found in current A11y snapshot. Call find_in_tree to search.`,
              };
            }

            // Resolve physical bounding box using CDP DOM.getBoxModel
            const rect = await cdp.getBoxModel(targetNode.backendNodeId);
            if (!rect) {
              hooks.onLog?.(
                `步骤 ${stepCount}`,
                "warning",
                `⚠️ 节点 [${elementRef}] <${targetNode.role}> 在当前页面不可视或无物理排版盒模型`
              );
              return {
                error: `Element [${elementRef}] has no physical layout box. Try scrolling into view or checking its container.`,
              };
            }

            const desc = `[${targetNode.ref}] <${targetNode.role}> "${targetNode.name || ""}"`;
            hooks.onLog?.(`步骤 ${stepCount}`, "info", `⚡ S1 执行物理动作: ${intent} -> ${desc}`);

            if (action === "type" && text) {
              await cdp.clickElement(rect, config.antiBotMode);
              await sleep(150);
              await cdp.typeText(text, config.antiBotMode);
            } else {
              await cdp.clickElement(rect, config.antiBotMode);
            }

            await sleep(1600);
            snapshot = await A11yTreeService.captureSnapshot(cdp, tabId);

            const deltaDesc = snapshot.url !== beforeUrl ? `URL跳转: ${beforeUrl} ➔ ${snapshot.url}` : `页面状态更新`;

            trace.push({
              step: stepCount,
              intent,
              action: {
                type: action,
                elementId: targetNode.ref,
                elementDescription: desc,
                text,
              },
              before: { url: beforeUrl, title: beforeTitle },
              after: { url: snapshot.url, title: snapshot.title },
              stateDelta: deltaDesc,
            });

            return {
              url: snapshot.url,
              title: snapshot.title,
              delta: deltaDesc,
              view: getCurrentViewText(),
              hint: "Action completed. Check the updated view to verify or execute next action.",
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
          execute: async (criteria: ConditionSpec) => evaluateCondition(initialPageState, criteria),
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
          `⚠️ 未检测到有效交互动作。如果页面使用了跨域 Iframe，请点击【🔍 诊断页面】排查。`
        );
      }
    }

    return trace;
  }
}
