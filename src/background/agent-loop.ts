import { CDPClient } from "./cdp-client.js";
import { TypeSafeService } from "./typesafe-service.js";
import { AgentConfig, PageState, StepLog, TaskStatus, MessagePayload } from "../shared/types.js";
import { WorkflowRegistry } from "../workflows/workflow-registry.js";
import { WorkflowCompiler } from "../workflows/compiler.js";
import { WorkflowDefinition } from "../workflows/types.js";
import { AgentKernel } from "../runtime/agent-kernel.js";
import { WorkflowRunner } from "../runtime/workflow-runner.js";
import { checkS2Health, diagnoseS2Error } from "../shared/s2-health.js";
import { sleep } from "./bezier-mouse.js";

export class AgentLoop {
  private config: AgentConfig;
  private cdp: CDPClient | null = null;
  private typesafeService: TypeSafeService;
  private kernel: AgentKernel;

  private tabId: number | null = null;
  private status: TaskStatus = "idle";
  private currentTask: string = "";
  private currentStepIndex: number = 0;
  private logs: StepLog[] = [];
  private abortController: AbortController | null = null;

  private lastExecutedWorkflow: WorkflowDefinition | null = null;
  private activeWorkflowScript?: string;
  private currentActiveLine?: number;

  constructor(config: AgentConfig) {
    this.config = config;
    this.typesafeService = new TypeSafeService(config.typesafeApiKey, config.typesafeModel);
    this.kernel = new AgentKernel();
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
    this.log("工作流已保存", "success", 1.0, `🎉 工作流 [${wf.meta.name}] 已成功保存为本地 Recipe！`);
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
        canSaveWorkflow: !!(this.status === "completed" && this.lastExecutedWorkflow?.script),
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
    message: string
  ) {
    console.log(`[Ang] [${status.toUpperCase()}] ${subgoal} -> ${message}`);
    this.logs.push({
      stepNumber: this.logs.length + 1,
      timestamp: Date.now(),
      subgoal,
      confidence,
      status,
      message,
    });
    this.broadcastState();
  }

  async pause() {
    this.status = "paused";
    this.broadcastState();
  }

  async resume() {
    this.status = "running";
    this.broadcastState();
  }

  async stop() {
    this.abortController?.abort();
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
    } catch {}
  }

  private async requestPageState(tabId: number): Promise<PageState> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOM" }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (res?.state) resolve(res.state);
        else reject(new Error("提取页面状态失败"));
      });
    });
  }

  /**
   * Start executing a task by natural language prompt
   */
  async startTask(tabId: number, prompt: string): Promise<void> {
    this.tabId = tabId;
    this.currentTask = prompt;
    this.logs = [];
    this.currentStepIndex = 0;
    this.abortController = new AbortController();
    this.lastExecutedWorkflow = null;
    this.activeWorkflowScript = undefined;
    this.currentActiveLine = undefined;

    try {
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();
      await this.ensureContentScript(tabId);

      this.status = "planning";
      this.broadcastState();
      this.log("页面理解", "success", 1.0, "正在初始化 Chrome 原生 A11y 树并建立无障碍地标索引...");

      const pageState = await this.requestPageState(tabId);
      const matchingWorkflows = await WorkflowRegistry.getMatchingWorkflows(pageState.url);
      const existingRecipe = matchingWorkflows.find(
        (w) => w.meta.description === prompt || w.meta.name === prompt
      );

      if (existingRecipe?.fn) {
        this.log("工作流复用", "success", 1.0, `⚡ 命中了已保存的动态工作流 Recipe [${existingRecipe.meta.name}]，直接复用执行！`);
        this.lastExecutedWorkflow = existingRecipe;
        this.activeWorkflowScript = existingRecipe.script;
        this.status = "running";
        this.broadcastState();

        await WorkflowRunner.execute(
          tabId,
          existingRecipe.fn,
          this.cdp,
          this.typesafeService,
          this.config,
          {
            onLog: (phase, level, msg) => this.log(phase, level === "info" ? "success" : level, 1.0, msg),
            onPhase: (phase) => {
              this.currentStepIndex++;
              this.broadcastState();
            },
            onLineUpdate: (line) => {
              this.currentActiveLine = line;
              this.broadcastState();
            },
          }
        );
      } else {
        // Unknown task -> Run S2 Vercel AI SDK Autonomous Kernel Loop!
        const s2Endpoint = this.config.systemTwoEndpoint || "http://localhost:11434/v1";
        const s2Model = this.config.systemTwoModel || "deepseek-v4.1-flash:cloud";
        const s2ApiKey = this.config.systemTwoApiKey || this.config.typesafeApiKey;

        // Proactive health pre-check: Fail loudly if S2 / Ollama is offline or unavailable
        const health = await checkS2Health(s2Endpoint, s2Model, s2ApiKey);
        if (health.status !== "online") {
          this.status = "failed";
          this.log(
            "S2 服务不可达",
            "error",
            0.0,
            `无法连接到 S2 (Ollama) 服务 (${s2Endpoint})\n` +
            `真实原因：${health.message}\n` +
            `解决建议：${health.actionHint || "请检查 S2 服务与网络连接。"}`
          );
          this.broadcastState();
          return;
        }

        this.status = "running";
        this.broadcastState();

        const trace = await this.kernel.runExploration(
          tabId,
          prompt,
          pageState,
          this.cdp,
          this.config,
          {
            onLog: (phase: string, level: "info" | "success" | "warning" | "error", msg: string) =>
              this.log(phase, level === "info" ? "success" : level, 1.0, msg),
            onStepFinish: (step: number) => {
              this.currentStepIndex = step;
              this.broadcastState();
            },
          },
          this.abortController.signal
        );

        if (trace.length > 0) {
          this.log("S2代码合成", "success", 1.0, "正在由 S2 根据实机探索轨迹动态生成 Dynamic Workflow Recipe...");
          const recipe = await WorkflowCompiler.synthesizeFromTrace(prompt, trace, this.config);
          this.lastExecutedWorkflow = recipe;
          this.activeWorkflowScript = recipe.script;
          this.status = "completed";
          this.log("工作流合成", "success", 1.0, `✨ S2 已将真实执行轨迹合成可复用 Recipe！`);
          this.broadcastState();
        } else {
          this.status = "failed";
          this.log(
            "任务未完成",
            "warning",
            0.0,
            "未在当前页面上找到可推进目标的状态转移路径（0 个执行步骤）。请确认页面是否已完全加载，或点击【🔍 诊断页面】排查。"
          );
          this.broadcastState();
        }
      }
    } catch (err: any) {
      this.status = "failed";
      const s2Endpoint = this.config.systemTwoEndpoint || "http://localhost:11434/v1";
      const s2Model = this.config.systemTwoModel || "deepseek-v4.1-flash:cloud";
      const s2ApiKey = this.config.systemTwoApiKey || this.config.typesafeApiKey;
      const diag = await diagnoseS2Error(err, s2Endpoint, s2Model, s2ApiKey);
      this.log("S2 执行失败", "error", 0.0, diag);
    } finally {
      this.currentActiveLine = undefined;
      if (this.cdp) {
        await this.cdp.detach();
        this.cdp = null;
      }
      this.broadcastState();
    }
  }

  /**
   * Start executing a registered dynamic workflow by ID
   */
  async startWorkflow(tabId: number, workflowId: string, args?: any): Promise<void> {
    const wf = await WorkflowRegistry.getWorkflowById(workflowId);
    if (!wf || !wf.fn) throw new Error(`Workflow ${workflowId} not found or uncompiled`);

    this.tabId = tabId;
    this.currentTask = wf.meta.description || wf.meta.name;
    this.lastExecutedWorkflow = wf;
    this.activeWorkflowScript = wf.script;
    this.status = "running";
    this.broadcastState();

    try {
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();
      await this.ensureContentScript(tabId);

      await WorkflowRunner.execute(
        tabId,
        wf.fn,
        this.cdp,
        this.typesafeService,
        this.config,
        {
          onLog: (phase, level, msg) => this.log(phase, level === "info" ? "success" : level, 1.0, msg),
          onPhase: (phase) => {
            this.currentStepIndex++;
            this.broadcastState();
          },
          onLineUpdate: (line) => {
            this.currentActiveLine = line;
            this.broadcastState();
          },
        },
        args
      );
      this.status = "completed";
      this.log("任务完成", "success", 1.0, `动态工作流 [${wf.meta.name}] 执行完毕！`);
    } catch (err: any) {
      this.status = "failed";
      this.log("Execution Error", "error", 0.0, err.message || String(err));
    } finally {
      this.currentActiveLine = undefined;
      if (this.cdp) {
        await this.cdp.detach();
        this.cdp = null;
      }
      this.broadcastState();
    }
  }
}
