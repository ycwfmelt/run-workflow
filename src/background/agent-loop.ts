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
import { WorkflowRegistry } from "../workflows/workflow-registry.js";
import { WorkflowCompiler } from "../workflows/compiler.js";
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
        canSaveWorkflow: !!(this.status === "completed" && this.lastExecutedWorkflow && !this.lastExecutedWorkflow.isBuiltIn && this.lastExecutedWorkflow.script),
        workflowName: this.lastExecutedWorkflow?.meta?.description || this.lastExecutedWorkflow?.meta?.name,
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
            } else if (!res || !res.state) {
              reject(new Error("Content script returned empty DOM state"));
            } else {
              resolve(res);
            }
          });
        });

        if (response && response.state) {
          return response.state as PageState;
        }
      } catch (err: any) {
        lastError = err;
        await this.ensureContentScript(tabId);
        await sleep(500);
      }
    }

    throw new Error(
      `无法与标签页 DOM 建立通信 (${lastError?.message || "未知错误"})。请刷新页面后重试。`
    );
  }

  /**
   * Main Task Entrypoint
   * Uses Vercel AI SDK + Ollama (deepseek-v4.1-flash:cloud) to compile prompt
   * into an executable JavaScript Dynamic Workflow, then runs it natively.
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
      // 1. Ensure DOM content script is active
      await this.ensureContentScript(tabId);

      // 2. Attach CDP for trusted hardware events
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();

      // 3. Inspect live page state
      const pageState = await this.requestPageState(tabId);

      // 4. Check for pre-existing matching workflow recipe
      const matchingWorkflows = await WorkflowRegistry.getMatchingWorkflows(pageState.url);
      const exactMatch = matchingWorkflows.find(
        (w) =>
          w.meta.name === prompt ||
          w.meta.description === prompt ||
          (prompt.includes("审批") && w.id === "crm_batch_approval" && /crm-batch\.example\.com/.test(pageState.url))
      );

      let workflowToRun: WorkflowDefinition;

      if (exactMatch && exactMatch.fn) {
        this.log(
          "工作流命中",
          "success",
          1.0,
          `✨ 命中已保存的工作流 Recipe [${exactMatch.meta.name}] ("${exactMatch.meta.description}")，直接启动原生 JS 执行器！`
        );
        workflowToRun = exactMatch;
      } else {
        this.log(
          "S2 代码生成",
          "success",
          1.0,
          `正在由 S2 (${this.config.systemTwoModel || "deepseek-v4.1-flash:cloud"}) 根据页面上下文实时编写动态工作流 JavaScript 脚本...`
        );
        workflowToRun = await WorkflowCompiler.compile(prompt, pageState, this.config);
        this.log(
          "工作流就绪",
          "success",
          1.0,
          `🚀 动态工作流编写完成 [${workflowToRun.meta.name}]: "${workflowToRun.meta.description}"`
        );
      }

      this.lastExecutedWorkflow = workflowToRun;
      this.status = "running";
      this.broadcastState();

      // 5. Execute compiled dynamic workflow function
      if (workflowToRun.fn) {
        await this.executeWorkflowFunction(tabId, workflowToRun.fn);
      } else {
        throw new Error("工作流脚本编译失败，未生成有效执行函数");
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
        chrome.tabs.sendMessage(this.tabId, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
      }
      this.broadcastState();
    }
  }

  /**
   * Universal Dynamic Workflow Runtime Executor
   * Injects Claude Code & Pi Dynamic Workflow primitives:
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
          }
        }
        return decision;
      },
      agent: async (prompt, options) => {
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
