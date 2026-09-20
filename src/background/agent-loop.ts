import { CDPClient } from "./cdp-client.js";
import { TypeSafeService, JevDecision } from "./typesafe-service.js";
import {
  AgentConfig,
  PageState,
  StepLog,
  TaskStatus,
  MessagePayload,
} from "../shared/types.js";
import { sleep } from "./bezier-mouse.js";
import { WorkflowRegistry, compileScriptToFunction } from "../workflows/workflow-registry.js";
import { WorkflowCompiler, StateTransitionTrace } from "../workflows/compiler.js";
import {
  WorkflowContext,
  WorkflowFunction,
  WorkflowDefinition,
} from "../workflows/types.js";

export class AgentLoop {
  private config: AgentConfig;
  private cdp: CDPClient | null = null;
  private typesafeService: TypeSafeService;

  private tabId: number | null = null;
  private status: TaskStatus = "idle";
  private currentTask: string = "";
  private currentStepIndex: number = 0;
  private logs: StepLog[] = [];
  private isPaused: boolean = false;
  private shouldStop: boolean = false;

  private lastExecutedWorkflow: WorkflowDefinition | null = null;
  private activeWorkflowScript?: string;
  private currentActiveLine?: number;

  constructor(config: AgentConfig) {
    this.config = config;
    this.typesafeService = new TypeSafeService(
      config.typesafeApiKey,
      config.typesafeModel
    );
  }

  updateConfig(config: AgentConfig) {
    this.config = config;
    this.typesafeService.setApiKey(config.typesafeApiKey);
    this.typesafeService.setModel(config.typesafeModel);
  }

  getStatus(): TaskStatus {
    return this.status;
  }

  getLogs(): StepLog[] {
    return this.logs;
  }

  getLastExecutedWorkflow(): WorkflowDefinition | null {
    return this.lastExecutedWorkflow;
  }

  getActiveWorkflowScript(): string | undefined {
    return this.activeWorkflowScript;
  }

  getCurrentActiveLine(): number | undefined {
    return this.currentActiveLine;
  }

  async saveLastExecutedWorkflow(): Promise<{ success: boolean; message: string }> {
    const wf = this.lastExecutedWorkflow;
    if (!wf || !wf.script) {
      return { success: false, message: "当前无可用或可持久化的动态工作流脚本" };
    }
    await WorkflowRegistry.saveWorkflow(wf.id, wf.meta, wf.script);
    this.log(
      "工作流已保存",
      "success",
      1.0,
      `🎉 工作流 [${wf.meta.name}] ("${wf.meta.description}") 已成功持久化保存为本地 Recipe！下次进入该页面可一键秒级执行。`
    );
    return { success: true, message: `工作流 [${wf.meta.name}] 保存成功` };
  }

  private broadcastState() {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATE_UPDATE",
        status: this.status,
        currentTask: this.currentTask,
        currentStep: this.currentStepIndex + 1,
        recentLogs: this.logs.slice(-25),
        canSaveWorkflow: !!(this.status === "completed" && this.lastExecutedWorkflow && this.lastExecutedWorkflow.script),
        workflowName: this.lastExecutedWorkflow?.meta?.description || this.lastExecutedWorkflow?.meta?.name,
        activeWorkflowScript: this.activeWorkflowScript,
        activeLine: this.currentActiveLine,
      } as MessagePayload)
      .catch(() => {});
  }

  private log(
    subgoal: string,
    status: "success" | "warning" | "error",
    confidence: number,
    message: string,
    targetElement?: { id: string; description: string },
    actionType?: any
  ) {
    console.log(`[Ang] [${status.toUpperCase()}] ${subgoal} -> ${message}`);
    const entry: StepLog = {
      stepNumber: this.logs.length + 1,
      timestamp: Date.now(),
      subgoal,
      targetElement,
      actionType,
      confidence,
      status,
      message,
    };
    this.logs.push(entry);
    this.broadcastState();
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";
    this.broadcastState();
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";
    this.broadcastState();
  }

  async stop() {
    this.shouldStop = true;
    this.status = "idle";
    this.cdp?.hideVirtualMouse();
    this.currentActiveLine = undefined;
    this.broadcastState();
  }

  private async ensureContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
      await sleep(200);
    } catch (err: any) {
      console.warn("[Ang] Auto-injection warning:", err);
    }
  }

  private async requestPageState(tabId: number): Promise<PageState> {
    const maxRetries = 3;
    let lastError: any = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await new Promise<any>((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res && res.state) {
              resolve(res.state);
            } else {
              reject(new Error("提取页面状态失败"));
            }
          });
        });
        return response as PageState;
      } catch (err: any) {
        lastError = err;
        await this.ensureContentScript(tabId);
        await sleep(500);
      }
    }

    throw new Error(`无法获取页面状态 (已重试 ${maxRetries} 次): ${lastError?.message || ""}`);
  }

  /**
   * Start executing a task by natural language prompt
   */
  async startTask(tabId: number, prompt: string): Promise<void> {
    this.tabId = tabId;
    this.currentTask = prompt;
    this.logs = [];
    this.currentStepIndex = 0;
    this.isPaused = false;
    this.shouldStop = false;
    this.lastExecutedWorkflow = null;
    this.activeWorkflowScript = undefined;
    this.currentActiveLine = undefined;

    try {
      // 1. Ensure CDP is attached
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();

      // 2. Ensure content script is injected
      await this.ensureContentScript(tabId);

      // 3. Extract DOM & PageState
      this.status = "planning";
      this.broadcastState();
      this.log("页面理解", "success", 1.0, "正在提取页面 DOM 与可视可交互元素...");

      const pageState = await this.requestPageState(tabId);

      // 4. Check if there is an existing Recipe matching this URL & intent
      const matchingWorkflows = await WorkflowRegistry.getMatchingWorkflows(pageState.url);
      const existingRecipe = matchingWorkflows.find(
        (w) => w.meta.description === prompt || prompt.includes(w.meta.name)
      );

      let workflowToRun: WorkflowDefinition;

      if (existingRecipe && existingRecipe.fn) {
        this.log(
          "工作流复用",
          "success",
          1.0,
          `⚡ 命中了已保存的动态工作流 Recipe [${existingRecipe.meta.name}]，直接复用原生执行！`
        );
        this.lastExecutedWorkflow = existingRecipe;
        this.activeWorkflowScript = existingRecipe.script;
        this.currentActiveLine = 1;
        this.status = "running";
        this.broadcastState();
        await this.executeWorkflowFunction(tabId, existingRecipe.fn);
      } else {
        // Unknown task -> Run S2 Supervisor State Machine Exploration!
        await this.runSupervisorStateLoop(tabId, prompt, pageState);
      }
    } catch (err: any) {
      this.status = "failed";
      this.log("Execution Error", "error", 0.0, err.message || String(err));
    } finally {
      this.currentActiveLine = undefined;
      if (this.cdp) {
        await this.cdp.detach();
        this.cdp = null;
      }
      if (this.tabId) {
        chrome.tabs.sendMessage(this.tabId, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
      }
      this.broadcastState();
    }
  }

  /**
   * Phase 1: S2 Supervisor State Machine Exploration
   * Advances the browser through state transitions (S_0 -> S_1 -> S_2 ...) driven by S1,
   * with S2 Supervisor verifying overall task progress and goal attainment.
   */
  async runSupervisorStateLoop(
    tabId: number,
    prompt: string,
    initialPageState: PageState
  ): Promise<void> {
    this.status = "running";
    this.broadcastState();
    this.log(
      "Supervisor 启动",
      "success",
      1.0,
      `🤖 S2 Supervisor 状态机推进模式启动，任务目标: "${prompt}"`
    );

    const stateTransitions: StateTransitionTrace[] = [];

    let step = 0;
    const maxSteps = 8;
    let isTaskCompleted = false;
    let currentPageState = initialPageState;

    while (step < maxSteps && !isTaskCompleted && !this.shouldStop) {
      step++;
      while (this.isPaused && !this.shouldStop) await sleep(500);
      if (this.shouldStop) break;

      this.log(`步骤 ${step}`, "info", 1.0, `[状态 S_${step - 1}] 当前页面: ${currentPageState.url} (${currentPageState.title})`);

      // 1. Supervisor checks if task is accomplished (only after taking at least 1 action)
      if (step > 1) {
        const checkDecision = await this.typesafeService.decideNextAction(
          prompt,
          `检查任务是否已全部完成: "${prompt}"`,
          currentPageState,
          currentPageState.elements
        );

        if (checkDecision.isGoalReached || checkDecision.actionType === "finish") {
          this.log(
            "目标达成",
            "success",
            1.0,
            `🎉 S2 Supervisor 判定：总目标 "${prompt}" 已圆满完成！`
          );
          isTaskCompleted = true;
          break;
        }
      }

      // 2. Supervisor decides next transition action
      this.log("感知决策", "info", 1.0, `Supervisor 正在分析状态 S_${step - 1} 下的最优动作...`);
      const decision = await this.typesafeService.decideNextAction(
        prompt,
        prompt,
        currentPageState,
        currentPageState.elements
      );

      if (!decision.targetElementId || decision.targetElementId === "none_of_above") {
        this.log("探索结束", "warn", 1.0, "当前页面未发现进一步相关操作项，状态机探索结束。");
        break;
      }

      const targetEl = currentPageState.elements.find((e) => e.id === decision.targetElementId);
      if (!targetEl || decision.actionType === "finish") {
        this.log("探索结束", "info", 1.0, "Supervisor 判定无需进一步操作或未发现进一步相关操作项。");
        break;
      }

      const desc = `[${targetEl.id}] <${targetEl.tag}> "${targetEl.text || targetEl.placeholder || ""}"`;
      const fromUrl = currentPageState.url;
      const cleanClickedText = (targetEl.text || targetEl.placeholder || targetEl.value || "").trim();

      // 3. Actuator (S1) dispatches hardware-level CDP action
      if (decision.actionType === "type") {
        this.log(
          "执行动作",
          "success",
          decision.confidence,
          `S1 聚焦并输入 -> ${desc}`,
          { id: targetEl.id, description: desc },
          "type"
        );
        await this.cdp!.clickElement(targetEl.rect, this.config.antiBotMode);
        await sleep(150);
        await this.cdp!.typeText(prompt, this.config.antiBotMode);
      } else {
        this.log(
          "执行动作",
          "success",
          decision.confidence,
          `S1 贝塞尔轨迹点击 -> ${desc}`,
          { id: targetEl.id, description: desc },
          "click"
        );
        await this.cdp!.clickElement(targetEl.rect, this.config.antiBotMode);
      }

      // Wait for browser state transition
      await sleep(1800);

      // 4. Secondary confirmation modal handling
      const postActionState = await this.requestPageState(tabId);
      if (postActionState.activeModal?.isOpen) {
        this.log("二次确认", "info", 1.0, `检测到确认弹窗 "${postActionState.activeModal.title}"，执行确认...`);
        const modalDecision = await this.typesafeService.decideNextAction(
          "在弹窗中点击确定或确认",
          "确认弹窗",
          postActionState,
          postActionState.elements
        );
        if (modalDecision.targetElementId && modalDecision.targetElementId !== "none_of_above") {
          const mEl = postActionState.elements.find((e) => e.id === modalDecision.targetElementId);
          if (mEl) {
            await this.cdp!.clickElement(mEl.rect, this.config.antiBotMode);
            await sleep(1500);
          }
        }
      }

      // 5. Update state for next step
      const previousUrl = currentPageState.url;
      const previousTitle = currentPageState.title;
      currentPageState = await this.requestPageState(tabId);
      const toUrl = currentPageState.url;
      const toTitle = currentPageState.title;

      const actionLabel = cleanClickedText ? `点击【${cleanClickedText}】` : `操作 ${desc}`;
      const stateChangesSummary =
        toUrl !== previousUrl
          ? `URL 从 ${previousUrl} 跳转至 ${toUrl}`
          : cleanClickedText
            ? `点击【${cleanClickedText}】后触发页面状态更新`
            : `执行 ${desc} 操作`;

      stateTransitions.push({
        step,
        subgoal: actionLabel,
        fromUrl: previousUrl,
        fromTitle: previousTitle,
        actionType: decision.actionType,
        elementDescription: desc,
        clickedText: cleanClickedText || undefined,
        toUrl,
        toTitle,
        stateChangesSummary,
      });

      if (toUrl !== previousUrl) {
        this.log("状态跃迁", "success", 1.0, `🔗 浏览器状态转移: ${previousUrl} ➔ ${toUrl}`);
      }
    }

    // Phase 2: S2 Dynamic Workflow Synthesis
    if (stateTransitions.length > 0) {
      this.log("S2代码合成", "info", 1.0, `正在由 S2 认知大模型根据真实实机探索轨迹动态编写 Dynamic Workflow 脚本...`);

      const workflowDef = await WorkflowCompiler.synthesizeFromTrace(
        prompt,
        stateTransitions,
        this.config
      );

      this.lastExecutedWorkflow = workflowDef;
      this.activeWorkflowScript = workflowDef.script;
      this.currentActiveLine = 1;
      this.status = "completed";
      this.log(
        "工作流合成",
        "success",
        1.0,
        `✨ S2 已根据实机状态机轨迹成功动态生成原生 Dynamic Workflow [${workflowDef.meta.name}]！可一键保存供下次秒级直接复用。`
      );
      this.broadcastState();
    } else {
      this.status = "completed";
      this.log("探索结束", "info", 1.0, "未检测到可执行的状态转移操作。");
      this.broadcastState();
    }
  }

  /**
   * Start executing a registered dynamic workflow by ID
   */
  async startWorkflow(
    tabId: number,
    workflowId: string,
    args?: any
  ): Promise<void> {
    const wf = await WorkflowRegistry.getWorkflowById(workflowId);
    if (!wf || !wf.fn) {
      throw new Error(`找不到 ID 为 "${workflowId}" 的工作流函数`);
    }

    this.tabId = tabId;
    this.currentTask = wf.meta.description || wf.meta.name;
    this.lastExecutedWorkflow = wf;
    this.activeWorkflowScript = wf.script;
    this.currentActiveLine = 1;
    this.logs = [];
    this.isPaused = false;
    this.shouldStop = false;
    this.status = "running";
    this.broadcastState();

    try {
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();
      this.log(
        "工作流启动",
        "success",
        1.0,
        `🚀 开始执行工作流 [${wf.meta.name}]: "${wf.meta.description}"`
      );
      await this.executeWorkflowFunction(tabId, wf.fn, args);
    } catch (err: any) {
      this.status = "failed";
      this.log("Execution Error", "error", 0.0, err.message || String(err));
    } finally {
      this.currentActiveLine = undefined;
      if (this.cdp) {
        await this.cdp.detach();
        this.cdp = null;
      }
      if (this.tabId) {
        chrome.tabs.sendMessage(this.tabId, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
      }
      this.broadcastState();
    }
  }

  /**
   * Universal Dynamic Workflow Runtime Executor
   * Injects Claude Code & Pi Dynamic Workflow primitives:
   * jev(), agent(), phase(), log(), getPage(), wait(), scroll(), step()
   */
  async executeWorkflowFunction(
    tabId: number,
    fn: WorkflowFunction,
    args?: Record<string, any>
  ): Promise<any> {
    const updateLine = (lineNum?: number) => {
      if (!lineNum) return;
      if (this.currentActiveLine !== lineNum) {
        this.currentActiveLine = lineNum;
        chrome.runtime
          .sendMessage({
            type: "WORKFLOW_LINE_UPDATE",
            line: lineNum,
            script: this.activeWorkflowScript,
          } as MessagePayload)
          .catch(() => {});
      }
    };

    const traceLine = () => {
      try {
        const stack = new Error().stack;
        if (!stack) return;
        const match = stack.match(/workflow\.js:(\d+):(\d+)/);
        if (match) {
          const rawLine = parseInt(match[1], 10);
          updateLine(Math.max(1, rawLine - 2));
        }
      } catch {}
    };

    const ctx: WorkflowContext = {
      ...({ __onLineUpdate: updateLine } as any),
      jev: async (subgoal, options) => {
        traceLine();
        if (this.shouldStop) throw new Error("Workflow stopped by user");
        while (this.isPaused && !this.shouldStop) await sleep(500);

        const pageState = await this.requestPageState(tabId);
        this.log(subgoal, "success", 1.0, `Jev 正在感知决策: "${subgoal}"...`);

        // Check if there is an active modal dialog that requires confirmation
        const isModalConfirmation = /(?:确认|确定|弹窗|modal)/i.test(subgoal) || pageState.activeModal?.isOpen;

        const decision = await this.typesafeService.decideNextAction(
          this.currentTask || subgoal,
          subgoal,
          pageState,
          pageState.elements
        );

        if (
          decision.targetElementId &&
          decision.targetElementId !== "none_of_above"
        ) {
          const el = pageState.elements.find(
            (e) => e.id === decision.targetElementId
          );
          if (el) {
            const desc = `[${el.id}] <${el.tag}> "${el.text || el.placeholder || ""}"`;
            
            // Handle input typing
            const textToType = options?.text || (decision.actionType === "type" ? options?.text : undefined);
            if (textToType !== undefined || el.isInput) {
              this.log(
                subgoal,
                "success",
                decision.confidence,
                `Jev 选定输入框: 聚焦并输入 -> ${desc}`,
                { id: el.id, description: desc },
                "type"
              );
              await this.cdp!.clickElement(el.rect, this.config.antiBotMode);
              if (textToType) {
                await sleep(150);
                await this.cdp!.typeText(textToType, this.config.antiBotMode);
                if (el.role === "searchbox" || el.tag === "input") {
                  await this.cdp!.pressKey("Enter");
                }
              }
            } else {
              // Click action
              this.log(
                subgoal,
                "success",
                decision.confidence,
                `Jev 选定目标: 贝塞尔轨迹点击 -> ${desc}`,
                { id: el.id, description: desc },
                "click"
              );
              await this.cdp!.clickElement(el.rect, this.config.antiBotMode);
            }
            await sleep(1500);

            // Detect page navigation change
            const afterActionState = await this.requestPageState(tabId);
            if (afterActionState.url !== pageState.url) {
              this.log(
                "页面导航",
                "success",
                1.0,
                `🔗 动作触发页面跳转: ${pageState.url} ➔ ${afterActionState.url}`
              );
            }
          }
        }
        return decision;
      },
      successCheck: async (criteria?: any, options?: any) => {
        traceLine();
        if (this.shouldStop) throw new Error("Workflow stopped by user");
        while (this.isPaused && !this.shouldStop) await sleep(500);

        let timeoutMs = 3000;
        let pollInterval = 150;
        let effectiveCriteria: any = criteria;

        if (typeof criteria === "number") {
          timeoutMs = criteria;
          effectiveCriteria = undefined;
        } else if (typeof options === "number") {
          timeoutMs = options;
        } else if (typeof options === "object" && options !== null) {
          if (typeof options.timeout === "number") timeoutMs = options.timeout;
          if (typeof options.pollInterval === "number") pollInterval = options.pollInterval;
        }

        const goalToCheck =
          (typeof effectiveCriteria === "string"
            ? effectiveCriteria
            : effectiveCriteria?.text || effectiveCriteria?.url || effectiveCriteria?.disappeared) ||
          this.currentTask ||
          "当前任务达成状态";

        const startTime = Date.now();
        let finalPageState: PageState | null = null;
        let matchedFast = false;
        let fastMatchReason = "";

        // Check if explicit deterministic criteria was provided
        const hasExplicitFastCriteria =
          typeof effectiveCriteria === "object" &&
          effectiveCriteria !== null &&
          Boolean(
            effectiveCriteria.url ||
              effectiveCriteria.text ||
              effectiveCriteria.selector ||
              effectiveCriteria.disappeared
          );

        // Active polling loop: checks condition every pollInterval until timeout
        while (Date.now() - startTime <= timeoutMs) {
          if (this.shouldStop) throw new Error("Workflow stopped by user");

          finalPageState = await this.requestPageState(tabId);
          const pageText = finalPageState.elements.map((e) => e.text || "").join(" ");

          // 1. URL condition match (e.g. { url: "/mission/daily" })
          if (typeof effectiveCriteria === "object" && effectiveCriteria !== null && effectiveCriteria.url) {
            if (finalPageState.url.includes(effectiveCriteria.url)) {
              matchedFast = true;
              fastMatchReason = `URL已包含目标路径 "${effectiveCriteria.url}"`;
              break;
            }
          }

          // 2. Disappeared condition (e.g. { disappeared: "领取今日的登录奖励" })
          if (
            typeof effectiveCriteria === "object" &&
            effectiveCriteria !== null &&
            effectiveCriteria.disappeared
          ) {
            const disappearedTarget = effectiveCriteria.disappeared;
            const exists = finalPageState.elements.some((e) =>
              Boolean(
                (e.text && e.text.includes(disappearedTarget)) ||
                  (e.placeholder && e.placeholder.includes(disappearedTarget)) ||
                  (e.selector && e.selector.includes(disappearedTarget))
              )
            );
            if (!exists) {
              matchedFast = true;
              fastMatchReason = `目标元素/文本 "${disappearedTarget}" 已从页面消除 (操作已生效)`;
              break;
            }
          }

          // 3. Exact Text condition (e.g. { text: "每日登录奖励已顺利领取" })
          if (typeof effectiveCriteria === "object" && effectiveCriteria !== null && effectiveCriteria.text) {
            if (pageText.includes(effectiveCriteria.text)) {
              matchedFast = true;
              fastMatchReason = `页面已呈现目标文本 "${effectiveCriteria.text}"`;
              break;
            }
          }

          // 4. Selector condition (e.g. { selector: ".success-toast" })
          if (
            typeof effectiveCriteria === "object" &&
            effectiveCriteria !== null &&
            effectiveCriteria.selector
          ) {
            const hasSelector = finalPageState.elements.some((e) =>
              e.selector.includes(effectiveCriteria.selector)
            );
            if (hasSelector) {
              matchedFast = true;
              fastMatchReason = `页面已检测到目标选择器 "${effectiveCriteria.selector}"`;
              break;
            }
          }

          // 5. String criteria starting with "/" or "http" (treat as URL condition)
          if (
            typeof effectiveCriteria === "string" &&
            (effectiveCriteria.startsWith("/") || effectiveCriteria.startsWith("http"))
          ) {
            if (finalPageState.url.includes(effectiveCriteria)) {
              matchedFast = true;
              fastMatchReason = `页面URL已跳转至 "${effectiveCriteria}"`;
              break;
            }
          }

          // If timeout is small or elapsed, exit polling
          if (Date.now() - startTime + pollInterval > timeoutMs) {
            break;
          }
          await sleep(pollInterval);
        }

        const elapsed = Date.now() - startTime;

        if (matchedFast) {
          this.log(
            "状态校验",
            "success",
            1.0,
            `⚡ [SuccessCheck 极速就绪] ${fastMatchReason} (耗时仅 ${elapsed}ms，无需盲等)`
          );
          return {
            isGoalReached: true,
            confidence: 1.0,
            reason: fastMatchReason,
            elapsedMs: elapsed,
          };
        }

        // If explicit structural condition was requested but not met within timeout:
        if (hasExplicitFastCriteria) {
          this.log(
            "状态校验",
            "warn",
            0.0,
            `[SuccessCheck 超时] 未在 ${timeoutMs}ms 内检测到目标状态转移: ${JSON.stringify(effectiveCriteria)}`
          );
          return {
            isGoalReached: false,
            confidence: 0.0,
            reason: `Timeout waiting for condition: ${JSON.stringify(effectiveCriteria)}`,
            elapsedMs: elapsed,
          };
        }

        // If no explicit structural condition (or semantic string prompt), evaluate with S1
        const pageState = finalPageState || (await this.requestPageState(tabId));
        try {
          const decision = await this.typesafeService.decideNextAction(
            goalToCheck,
            `验证目标是否已达成: "${goalToCheck}"`,
            pageState,
            pageState.elements
          );

          const isReached = Boolean(decision.isGoalReached || decision.actionType === "finish");
          const conf = Math.max(decision.confidence, decision.goalProbability || 0.8);

          this.log(
            "状态校验",
            isReached ? "success" : "info",
            conf,
            `[SuccessCheck] 目标 "${goalToCheck}" -> ${isReached ? "✅ 语义校验达成" : "⏳ 尚未达成"} (耗时 ${elapsed}ms)`
          );

          return {
            isGoalReached: isReached,
            confidence: conf,
            reason: decision.reasoningNote,
            elapsedMs: elapsed,
          };
        } catch {
          return {
            isGoalReached: false,
            confidence: 0.5,
            reason: "Timeout reached without match",
            elapsedMs: elapsed,
          };
        }
      },
      verify: async (customGoal?: string) => {
        return ctx.successCheck(customGoal);
      },
      agent: async (prompt, options) => {
        traceLine();
        return ctx.jev(prompt, options);
      },
      phase: (title) => {
        traceLine();
        this.log(title, "success", 1.0, `[Phase 阶段] -> ${title}`);
      },
      log: (message) => {
        traceLine();
        this.log("Trace", "success", 1.0, message);
      },
      getPage: async () => {
        traceLine();
        return this.requestPageState(tabId);
      },
      scroll: async (deltaY) => {
        traceLine();
        if (this.cdp) await this.cdp.scroll(deltaY);
      },
      wait: async (ms) => {
        traceLine();
        await sleep(ms);
      },
      step: (_label) => {
        traceLine();
      },
      args,
    };

    const result = await fn(ctx);

    if (!this.shouldStop) {
      this.status = "completed";
      this.log("Task Finished", "success", 1.0, "动态工作流函数执行完毕！");
    }

    return result;
  }
}
