import { CDPClient } from "./cdp-client.js";
import { TypeSafeService, JevDecision } from "./typesafe-service.js";
import { TaskPlanner, TaskPlan } from "./planner.js";
import {
  AgentConfig,
  PageState,
  StepLog,
  TaskStatus,
  MessagePayload,
} from "../shared/types.js";
import { sleep } from "./bezier-mouse.js";
import { WorkflowRegistry } from "../workflows/workflow-registry.js";
import {
  WorkflowContext,
  WorkflowFunction,
} from "../workflows/types.js";

export class AgentLoop {
  private config: AgentConfig;
  private cdp: CDPClient | null = null;
  private typesafeService: TypeSafeService;
  private planner: TaskPlanner;

  private tabId: number | null = null;
  private status: TaskStatus = "idle";
  private currentTask: string = "";
  private currentStepIndex: number = 0;
  private logs: StepLog[] = [];
  private isPaused: boolean = false;
  private shouldStop: boolean = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.typesafeService = new TypeSafeService(
      config.typesafeApiKey,
      config.typesafeModel
    );
    this.planner = new TaskPlanner(config);
  }

  updateConfig(config: AgentConfig) {
    this.config = config;
    this.typesafeService.setApiKey(config.typesafeApiKey);
    this.typesafeService.setModel(config.typesafeModel);
    this.planner.updateConfig(config);
  }

  getStatus(): TaskStatus {
    return this.status;
  }

  getLogs(): StepLog[] {
    return this.logs;
  }

  private broadcastState() {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATE_UPDATE",
        status: this.status,
        currentTask: this.currentTask,
        currentStep: this.currentStepIndex + 1,
        recentLogs: this.logs.slice(-25),
      } as MessagePayload)
      .catch(() => {
        // Sidepanel might not be open
      });
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
    if (this.cdp) {
      await this.cdp.detach();
      this.cdp = null;
    }
    if (this.tabId) {
      chrome.tabs.sendMessage(this.tabId, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
    }
    this.broadcastState();
  }

  /**
   * Self-healing content script injection if page was open prior to extension reload
   */
  private async ensureContentScriptInjected(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await sleep(200);
    } catch (err: any) {
      console.warn("[Ang] Auto-injection warning:", err);
    }
  }

  /**
   * Request content script to extract DOM elements with self-healing retry
   */
  private async requestPageState(tabId: number): Promise<PageState> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, async (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "";
          if (
            errMsg.includes("Receiving end does not exist") ||
            errMsg.includes("Could not establish connection")
          ) {
            try {
              await this.ensureContentScriptInjected(tabId);
              chrome.tabs.sendMessage(
                tabId,
                { type: "EXTRACT_DOM" },
                (retryRes) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else if (retryRes && retryRes.state) {
                    resolve(retryRes.state);
                  } else {
                    reject(new Error("注入 Content Script 后仍无法获取 DOM 状态"));
                  }
                }
              );
              return;
            } catch (injectErr: any) {
              reject(new Error(`无法注入内容脚本: ${injectErr.message}`));
              return;
            }
          }
          reject(new Error(errMsg));
        } else if (response && response.state) {
          resolve(response.state);
        } else {
          reject(new Error("获取到的 DOM 状态为空"));
        }
      });
    });
  }

  /**
   * Start executing an automated task
   */
  async startTask(tabId: number, prompt: string): Promise<void> {
    this.tabId = tabId;
    this.currentTask = prompt;
    this.logs = [];
    this.isPaused = false;
    this.shouldStop = false;
    this.status = "planning";
    this.broadcastState();

    try {
      // 0. Validate target tab URL
      const targetTab = await chrome.tabs.get(tabId);
      const url = targetTab.url || "";
      if (
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")
      ) {
        throw new Error(
          `无法在浏览器内部页面 (${url || "about:blank"}) 上执行自动化。请切换或打开目标业务网页（如您的管理后台、Google、GitHub等）后再试。`
        );
      }

      // 0.5. Check if prompt matches a registered dynamic workflow function
      const matchingWorkflows = await WorkflowRegistry.getMatchingWorkflows(url);
      const directMatch = matchingWorkflows.find(
        (w) =>
          prompt.includes(w.meta.name) ||
          (w.id === "crm_batch_approval" &&
            /(?:预售合同|待审批).*(?:批量|全部|所有)/.test(prompt)) ||
          (w.id === "crm_batch_approval" &&
            /处理列表里全部的待审批/.test(prompt))
      );

      if (directMatch && directMatch.fn) {
        this.log(
          "工作流直达",
          "success",
          1.0,
          `✨ 命中预置动态工作流函数 [${directMatch.meta.name}] ("${directMatch.meta.description}")，直接启动原生 JS 状态机函数！`
        );
        this.cdp = new CDPClient(tabId);
        await this.cdp.attach();
        this.status = "running";
        this.broadcastState();
        await this.executeWorkflowFunction(tabId, directMatch.fn, {});
        return;
      }

      // 1. System Two: Plan and extract entities
      const plan: TaskPlan = await this.planner.createPlan(prompt);
      if (plan.warning) {
        this.log(
          "S2 规划警告",
          "warning",
          0.5,
          plan.warning
        );
      }
      this.log(
        "Task Decomposition",
        "success",
        1.0,
        `任务拆解为 ${plan.steps.length} 个阶段目标: ${plan.steps.map((s, idx) => `[${idx + 1}] ${s.subgoal}`).join("; ")}`
      );

      // 2. Attach CDP via chrome.debugger
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();

      this.status = "running";
      this.broadcastState();

      // 3. Execute Workflow: Check for registered matching dynamic workflow or sequential plan
      const pageState = await this.requestPageState(tabId);
      const pageWorkflows = await WorkflowRegistry.getMatchingWorkflows(pageState.url);

      if (plan.isBatch && pageWorkflows.length > 0 && pageWorkflows[0].fn) {
        const wf = pageWorkflows[0];
        this.log(
          "动态工作流匹配",
          "success",
          1.0,
          `已匹配到专属动态工作流 [${wf.meta.name}]: "${wf.meta.description}"，启动执行...`
        );
        await this.executeWorkflowFunction(tabId, wf.fn);
      } else {
        await this.runSequentialWorkflow(tabId, plan);
      }
    } catch (err: any) {
      this.status = "failed";
      this.log("Execution Error", "error", 0.0, err.message || String(err));
    } finally {
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
   * Sequential workflow for single-pass tasks
   */
  private async runSequentialWorkflow(
    tabId: number,
    plan: TaskPlan
  ): Promise<void> {
    for (let i = 0; i < plan.steps.length; i++) {
      if (this.shouldStop) break;
      this.currentStepIndex = i;
      const currentStep = plan.steps[i];

      this.log(
        `目标 [${i + 1}/${plan.steps.length}]`,
        "success",
        1.0,
        `开始执行: "${currentStep.subgoal}"`
      );

      let stepCompleted = false;
      let attempts = 0;
      const maxAttemptsPerStep = 4;

      while (!stepCompleted && attempts < maxAttemptsPerStep && !this.shouldStop) {
        attempts++;

        // Handle pause
        while (this.isPaused && !this.shouldStop) {
          await sleep(500);
        }
        if (this.shouldStop) break;

        // Extract current DOM state
        let pageState: PageState;
        try {
          pageState = await this.requestPageState(tabId);
        } catch (e: any) {
          this.log(
            currentStep.subgoal,
            "warning",
            0,
            `无法读取页面元素 (${e.message})，重试 (${attempts}/${maxAttemptsPerStep})...`
          );
          await sleep(1200);
          continue;
        }

        if (!pageState.elements || pageState.elements.length === 0) {
          this.log(
            currentStep.subgoal,
            "warning",
            0,
            `页面当前视口未扫描到可视交互元素，正在滚动重试 (${attempts}/${maxAttemptsPerStep})...`
          );
          await this.cdp!.scroll(300);
          await sleep(1200);
          continue;
        }

        const isConditionalConfirmation = /若(?:弹出|出现|有)二次确认/.test(
          currentStep.subgoal
        );
        if (isConditionalConfirmation && !pageState.activeModal?.isOpen) {
          // Give 800ms for modal to animate in if needed
          await sleep(800);
          try {
            const recheckState = await this.requestPageState(tabId);
            if (!recheckState.activeModal?.isOpen) {
              this.log(
                currentStep.subgoal,
                "success",
                1.0,
                "未检测到二次确认弹窗（操作已直接生效），无需二次确认。"
              );
              stepCompleted = true;
              break;
            }
            pageState = recheckState;
          } catch {
            // Ignore recheck error
          }
        }

        this.log(
          currentStep.subgoal,
          "success",
          1.0,
          `已捕获 ${pageState.elements.length} 个可视元素，调用 Jev System One 进行决策...`
        );

        // Consult Jev System One
        let decision: JevDecision;
        try {
          decision = await this.typesafeService.decideNextAction(
            plan.goal,
            currentStep.subgoal,
            pageState,
            pageState.elements
          );
        } catch (apiErr: any) {
          this.log(
            currentStep.subgoal,
            "error",
            0,
            `Jev API 请求失败: ${apiErr.message}`
          );
          throw apiErr;
        }

        // Check if blocked by CAPTCHA
        if (decision.isBlockedByCaptcha) {
          this.status = "waiting_user";
          this.log(
            currentStep.subgoal,
            "warning",
            decision.captchaProbability,
            "检测到滑块/验证码/安全阻断。自动化已自动暂停，请手动完成后在侧边栏点击【▶ 继续】"
          );
          this.isPaused = true;
          this.broadcastState();
          continue;
        }

        // Confidence-gated routing
        if (
          decision.targetElementId === "none_of_above" ||
          decision.confidence < this.config.confidenceThreshold
        ) {
          if (isConditionalConfirmation) {
            this.log(
              currentStep.subgoal,
              "success",
              1.0,
              "无需二次确认，直接进入下一环节。"
            );
            stepCompleted = true;
            break;
          }
          this.log(
            currentStep.subgoal,
            "warning",
            decision.confidence,
            `Jev 置信度偏低 (${(decision.confidence * 100).toFixed(0)}%) 或目标不在当前屏，正在平滑向下滚动查找...`
          );
          await this.cdp!.scroll(350);
          await sleep(1200);
          continue;
        }

        // Found target element with high confidence!
        const targetElement = pageState.elements.find(
          (el) => el.id === decision.targetElementId
        );

        if (!targetElement) {
          this.log(
            currentStep.subgoal,
            "warning",
            decision.confidence,
            `找不到元素 ID ${decision.targetElementId}，滚动重试...`
          );
          await this.cdp!.scroll(250);
          await sleep(800);
          continue;
        }

        // Visual highlight on page
        chrome.tabs
          .sendMessage(tabId, {
            type: "HIGHLIGHT_ELEMENT",
            elementId: targetElement.id,
          })
          .catch(() => {});

        const elemDesc = `[${targetElement.id}] <${targetElement.tag}> "${targetElement.text || targetElement.placeholder || targetElement.ariaLabel || ""}"`;

        // Execute action via CDP
        if (
          decision.actionType === "type" ||
          (targetElement.isInput && currentStep.typeText)
        ) {
          const textToType = currentStep.typeText || "";
          this.log(
            currentStep.subgoal,
            "success",
            decision.confidence,
            `Jev 选定输入框: 聚焦并输入 "${textToType}" -> ${elemDesc}`,
            { id: targetElement.id, description: elemDesc },
            "type"
          );

          await this.cdp!.clickElement(targetElement.rect, this.config.antiBotMode);
          if (textToType) {
            await sleep(150);
            await this.cdp!.typeText(textToType, this.config.antiBotMode);
            await sleep(200);

            if (targetElement.role === "searchbox" || targetElement.tag === "input") {
              await this.cdp!.pressKey("Enter");
            }
          }
          stepCompleted = true;
        } else if (decision.actionType === "click" || !targetElement.isInput) {
          this.log(
            currentStep.subgoal,
            "success",
            decision.confidence,
            `Jev 选定目标: 贝塞尔轨迹点击 -> ${elemDesc}`,
            { id: targetElement.id, description: elemDesc },
            "click"
          );

          await this.cdp!.clickElement(targetElement.rect, this.config.antiBotMode);
          stepCompleted = true;
        } else if (decision.actionType === "finish") {
          this.log(
            currentStep.subgoal,
            "success",
            decision.confidence,
            `Jev 判断当前目标已达成，进入下一阶段。`
          );
          stepCompleted = true;
          break;
        }

        // Settle delay after interaction
        await sleep(1500);
      }

      // Check if step succeeded
      if (!stepCompleted && !this.shouldStop) {
        throw new Error(
          `阶段目标 [${i + 1}] "${currentStep.subgoal}" 尝试 ${maxAttemptsPerStep} 次仍未找到匹配元素，任务终止。`
        );
      }
    }

    if (!this.shouldStop) {
      // Safety guard: check if the final action triggered an unconfirmed modal dialog
      try {
        await sleep(1000);
        const finalState = await this.requestPageState(tabId);
        if (finalState.activeModal?.isOpen) {
          this.log(
            "二次确认安全守卫",
            "warning",
            0.95,
            `检测到页面存在未关闭的确认弹窗 ("${finalState.activeModal.title || "确认提示"}")，正在自动执行确认...`
          );
          const confirmDecision = await this.typesafeService.decideNextAction(
            plan.goal,
            "点击弹窗中的【确认】或【确定】按钮完成最终生效",
            finalState,
            finalState.elements
          );
          if (
            confirmDecision.targetElementId &&
            confirmDecision.targetElementId !== "none_of_above"
          ) {
            const confirmEl = finalState.elements.find(
              (el) => el.id === confirmDecision.targetElementId
            );
            if (confirmEl) {
              const desc = `[${confirmEl.id}] <${confirmEl.tag}> "${confirmEl.text}"`;
              this.log(
                "二次确认",
                "success",
                confirmDecision.confidence,
                `Jev 选定确认按钮: 贝塞尔轨迹点击 -> ${desc}`,
                { id: confirmEl.id, description: desc },
                "click"
              );
              await this.cdp!.clickElement(confirmEl.rect, this.config.antiBotMode);
              await sleep(1500);
            }
          }
        }
      } catch (guardErr: any) {
        console.warn("[Ang] Modal confirmation safety guard error:", guardErr);
      }

      this.status = "completed";
      this.log("Task Finished", "success", 1.0, "全部阶段自动化任务已顺利完成！");
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
      if (this.cdp) {
        await this.cdp.detach();
        this.cdp = null;
      }
      if (this.tabId) {
        chrome.tabs
          .sendMessage(this.tabId, { type: "CLEAR_HIGHLIGHTS" })
          .catch(() => {});
      }
      this.broadcastState();
    }
  }

  /**
   * Execute a native TypeScript / JavaScript dynamic workflow function
   * providing Claude Code dynamic workflow primitives:
   * jev(), agent(), phase(), log(), getPage(), wait(), scroll()
   */
  async executeWorkflowFunction(
    tabId: number,
    fn: WorkflowFunction,
    args?: Record<string, any>
  ): Promise<any> {
    const ctx: WorkflowContext = {
      jev: async (subgoal, options) => {
        if (this.shouldStop) throw new Error("Workflow stopped by user");
        while (this.isPaused && !this.shouldStop) await sleep(500);

        const pageState = await this.requestPageState(tabId);
        this.log(subgoal, "success", 1.0, `Jev 正在决策: "${subgoal}"...`);

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
            this.log(
              subgoal,
              "success",
              decision.confidence,
              `Jev 选定目标: 贝塞尔轨迹点击 -> ${desc}`,
              { id: el.id, description: desc },
              "click"
            );
            await this.cdp!.clickElement(el.rect, this.config.antiBotMode);
            await sleep(1500);
          }
        }
        return decision;
      },
      agent: async (prompt, options) => {
        // Claude Code dynamic workflow alias for jev()
        return ctx.jev(prompt, options);
      },
      phase: (title) => {
        this.log(title, "success", 1.0, `[Phase 阶段] -> ${title}`);
      },
      log: (message) => {
        this.log("Trace", "success", 1.0, message);
      },
      getPage: async () => {
        return this.requestPageState(tabId);
      },
      scroll: async (deltaY) => {
        if (this.cdp) await this.cdp.scroll(deltaY);
      },
      wait: async (ms) => {
        await sleep(ms);
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
