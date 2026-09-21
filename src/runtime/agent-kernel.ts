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
  onLog?: (
    phase: string,
    level: "info" | "success" | "warning" | "error" | "guidance",
    message: string
  ) => void;
  onStepFinish?: (step: number, toolCalls: any[], trace: TraceStep[]) => void;
  onWaitingUser?: (question: string) => void;
  onResumeUser?: () => void;
}

export class AgentKernel {
  private pendingGuidances: string[] = [];
  private userGuidanceResolver: ((guidance: string) => void) | null = null;

  /**
   * Inject real-time human operator guidance into the running exploration.
   * If a step is currently waiting on human input, it resolves immediately.
   * Otherwise, the guidance is queued and fed to the very next model reasoning step.
   */
  injectGuidance(guidance: string) {
    const trimmed = guidance.trim();
    if (!trimmed) return;
    this.pendingGuidances.push(trimmed);
    if (this.userGuidanceResolver) {
      const resolve = this.userGuidanceResolver;
      this.userGuidanceResolver = null;
      resolve(trimmed);
    }
  }

  private consumePendingGuidance(): string | undefined {
    if (this.pendingGuidances.length === 0) return undefined;
    const items = this.pendingGuidances.splice(0);
    return `🚨 【用户实时紧急指示 / HUMAN OPERATOR GUIDANCE】:\n${items.map((g) => `- ${g}`).join("\n")}\n请务必以用户的最新指示为最高优先级调整当前行动与决策！`;
  }

  private enrichWithGuidance<T extends Record<string, any>>(result: T): T {
    const guidance = this.consumePendingGuidance();
    if (guidance) {
      return {
        ...result,
        userGuidance: guidance,
        hint: result.hint ? `${result.hint}\n${guidance}` : guidance,
      };
    }
    return result;
  }

  private async waitForUserGuidance(question: string, abortSignal?: AbortSignal): Promise<string> {
    if (this.pendingGuidances.length > 0) {
      return this.pendingGuidances.splice(0).join("; ");
    }
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        this.userGuidanceResolver = null;
        reject(new Error("用户终止了任务"));
      };
      if (abortSignal?.aborted) {
        return reject(new Error("用户终止了任务"));
      }
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      this.userGuidanceResolver = (guidance: string) => {
        abortSignal?.removeEventListener("abort", onAbort);
        resolve(guidance);
      };
    });
  }

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

    let isTaskFinished = false;
    let turn = 0;
    const maxTurns = 4;

    const systemPrompt = `You are an autonomous web automation supervisor operating on a browser Native Accessibility Tree (A11y Tree).
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
   - When you have located the target node (either an interactive element like e10 or a clickable menu container/header like b3), call act({ elementRef: "...", action: "click" | "type", intent: "..." }).
   - Real CDP click / input events will be executed with human-like curves.
4. Human Operator Live Guidance (Highest Priority):
   - If any tool result contains "userGuidance", this is an authoritative instruction from the human operator watching your real-time execution. You MUST prioritize and obey this instruction immediately.
   - If you are ever stuck, encounter ambiguous buttons, cannot locate an element after searching, or need user clarification, call request_guidance({ question: "..." }) to ask the human operator directly instead of guessing or giving up.
5. Conclude:
   - When the overall task is verified complete, call finish({ summary: "..." }).`;

    while (!isTaskFinished && turn < maxTurns && !abortSignal?.aborted) {
      turn++;
      const currentPromptText =
        turn === 1
          ? `${getSystemContext()}\n\n${getCurrentViewText()}`
          : `[Turn ${turn}] Operator provided additional guidance for task "${prompt}". Continue execution.\n${getSystemContext()}\n\n${getCurrentViewText()}`;

      if (turn > 1) {
        hooks.onLog?.("开启新轮次", "info", `🔄 基于最新指引开启第 ${turn} 轮探索...`);
      }

      const result = await generateText({
        model: s2Client.chat(modelName),
        system: systemPrompt,
        prompt: currentPromptText,
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

              return this.enrichWithGuidance({
                url: snapshot.url,
                title: snapshot.title,
                landmarksCount: snapshot.rootBoxes.length,
                interactiveCount: snapshot.allInteractiveElements.length,
                view: getCurrentViewText(),
                hint: "Navigation completed. Check the updated page view and proceed with exploration.",
              });
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
              return this.enrichWithGuidance({
                result: searchResult,
                hint: "You can zoom_in to the parent container of the found node, or directly act on the found element ref.",
              });
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

              return this.enrichWithGuidance({
                currentPath: breadcrumbs.join(" > "),
                view: snapshot.getBoxView(containerRef),
                hint: "Inspect the direct elements or sub-containers. If this path is wrong, call back_to_parent with a reason.",
              });
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

              return this.enrichWithGuidance({
                currentPath: breadcrumbs.join(" > "),
                view: getCurrentViewText(),
                deadEndRecorded: reason,
              });
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

              return this.enrichWithGuidance({
                currentPath: "Root",
                view: snapshot.getRootOverview(),
              });
            },
          }),

          act: tool({
            description: "Execute physical click, type, or scroll via CDP on a verified A11y element ref",
            inputSchema: z.object({
              elementRef: z.string().optional().describe("Target node ref e.g. e10, e42, or container b3 (required for click and type)"),
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

                return this.enrichWithGuidance({
                  url: snapshot.url,
                  title: snapshot.title,
                  view: getCurrentViewText(),
                });
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

              return this.enrichWithGuidance({
                url: snapshot.url,
                title: snapshot.title,
                delta: deltaDesc,
                view: getCurrentViewText(),
                hint: "Action completed. Check the updated view to verify or execute next action.",
              });
            },
          }),

          request_guidance: tool({
            description: "When stuck, uncertain about which element to interact with, facing ambiguous options, or if a step failed, proactively ask the human operator for direction or confirmation.",
            inputSchema: z.object({
              question: z.string().describe("Clear question or issue description for the human operator"),
            }),
            execute: async ({ question }: { question: string }) => {
              hooks.onLog?.("请求人工引导", "warning", `❓ 模型发起询问: "${question}" (等待用户输入...)`);
              hooks.onWaitingUser?.(question);
              const answer = await this.waitForUserGuidance(question, abortSignal);
              hooks.onResumeUser?.();
              hooks.onLog?.("收到用户指引", "guidance", `💡 用户提供指引: "${answer}"`);
              return {
                operatorAnswer: answer,
                view: getCurrentViewText(),
                hint: `The human operator instructed: "${answer}". Immediately adjust your strategy and execute according to this instruction.`,
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
            execute: async (criteria: ConditionSpec) =>
              this.enrichWithGuidance(evaluateCondition(initialPageState, criteria) as any),
          }),

          finish: tool({
            description: "Conclude task when overall goal is verified complete",
            inputSchema: z.object({ summary: z.string() }),
            execute: async ({ summary }: { summary: string }) => {
              isTaskFinished = true;
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

      if (isTaskFinished || abortSignal?.aborted) {
        break;
      }

      // If there is queued guidance from user during the step, immediately loop to next turn
      if (this.pendingGuidances.length > 0) {
        const nextGuidance = this.consumePendingGuidance();
        hooks.onLog?.("消费引导", "guidance", `💡 检测到待处理指引: "${nextGuidance}"`);
        continue;
      }

      // If the model produced output without calling finish and without taking actions in this turn
      if (!isTaskFinished && turn < maxTurns && !abortSignal?.aborted) {
        const pauseMsg = result.text?.trim()
          ? `模型分析: "${result.text.trim()}"`
          : `当前探索轮次未发现明确动作，S2 已暂停`;
        hooks.onLog?.("等待人工指引", "warning", `⏸️ ${pauseMsg}。正在等待您的实时引导...`);
        hooks.onWaitingUser?.(pauseMsg);

        try {
          const userGuidance = await this.waitForUserGuidance(pauseMsg, abortSignal);
          hooks.onResumeUser?.();
          hooks.onLog?.("收到用户指引", "guidance", `💡 收到指引: "${userGuidance}"，正在继续探索...`);
          this.pendingGuidances.push(userGuidance);
        } catch {
          // User aborted or canceled
          break;
        }
      }
    }

    if (!isTaskFinished && trace.length === 0) {
      hooks.onLog?.(
        "S2分析诊断",
        "warning",
        `⚠️ 未检测到有效交互动作。如果页面使用了跨域 Iframe，请点击【🔍 诊断页面】排查。`
      );
    }

    return trace;
  }
}
