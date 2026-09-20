import { CDPClient } from "./cdp-client.js";
import { TypeSafeService } from "./typesafe-service.js";
import { TaskPlanner, TaskPlan } from "./planner.js";
import {
  AgentConfig,
  PageState,
  StepLog,
  TaskStatus,
  MessagePayload,
} from "../shared/types.js";
import { sleep } from "./bezier-mouse.js";

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
    chrome.runtime.sendMessage({
      type: "AGENT_STATE_UPDATE",
      status: this.status,
      currentTask: this.currentTask,
      currentStep: this.currentStepIndex + 1,
      recentLogs: this.logs.slice(-15),
    } as MessagePayload).catch(() => {
      // Ignore if sidepanel is not currently open
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
   * Request content script to extract DOM elements
   */
  private async requestPageState(tabId: number): Promise<PageState> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: "EXTRACT_DOM" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.state) {
            resolve(response.state);
          } else {
            reject(new Error("Failed to extract DOM state"));
          }
        }
      );
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
      // 1. System Two: Plan and extract entities
      const plan: TaskPlan = await this.planner.createPlan(prompt);
      this.log(
        "Task Decomposition",
        "success",
        1.0,
        `Task plan created with ${plan.steps.length} subgoals.`
      );

      // 2. Attach CDP via chrome.debugger
      this.cdp = new CDPClient(tabId);
      await this.cdp.attach();

      this.status = "running";
      this.broadcastState();

      // 3. Execute Subgoals loop
      for (let i = 0; i < plan.steps.length; i++) {
        if (this.shouldStop) break;
        this.currentStepIndex = i;
        const currentStep = plan.steps[i];

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
          } catch (e) {
            await sleep(1000);
            continue;
          }

          if (pageState.elements.length === 0) {
            await sleep(1000);
            continue;
          }

          // Consult Jev System One
          const decision = await this.typesafeService.decideNextAction(
            plan.goal,
            currentStep.subgoal,
            pageState,
            pageState.elements
          );

          // Check if blocked by CAPTCHA
          if (decision.isBlockedByCaptcha) {
            this.status = "waiting_user";
            this.log(
              currentStep.subgoal,
              "warning",
              decision.captchaProbability,
              "Detected CAPTCHA / Slider / Login verification. Pausing for manual intervention."
            );
            this.isPaused = true;
            this.broadcastState();
            continue;
          }

          // Confidence-gated routing
          if (decision.targetElementId === "none_of_above" || decision.confidence < this.config.confidenceThreshold) {
            this.log(
              currentStep.subgoal,
              "warning",
              decision.confidence,
              `Low confidence (${decision.confidence.toFixed(2)}) or element not in view. Scrolling page down.`
            );
            await this.cdp.scroll(350);
            await sleep(1200);
            continue;
          }

          // Found target element with high confidence!
          const targetElement = pageState.elements.find(
            (el) => el.id === decision.targetElementId
          );

          if (!targetElement) {
            await this.cdp.scroll(200);
            await sleep(800);
            continue;
          }

          // Visual highlight on page
          chrome.tabs.sendMessage(tabId, {
            type: "HIGHLIGHT_ELEMENT",
            elementId: targetElement.id,
          }).catch(() => {});

          const elemDesc = `[${targetElement.id}] <${targetElement.tag}> ${targetElement.text || targetElement.placeholder || ""}`;

          // Execute action via CDP
          if (decision.actionType === "type" || targetElement.isInput) {
            const textToType = currentStep.typeText || prompt;
            this.log(
              currentStep.subgoal,
              "success",
              decision.confidence,
              `Typing "${textToType}" into ${elemDesc}`,
              { id: targetElement.id, description: elemDesc },
              "type"
            );

            await this.cdp.clickElement(targetElement.rect, this.config.antiBotMode);
            await sleep(150);
            await this.cdp.typeText(textToType, this.config.antiBotMode);
            await sleep(200);

            // Press Enter if it's a search input
            if (targetElement.role === "searchbox" || targetElement.tag === "input") {
              await this.cdp.pressKey("Enter");
            }
            stepCompleted = true;
          } else if (decision.actionType === "click") {
            this.log(
              currentStep.subgoal,
              "success",
              decision.confidence,
              `Clicking ${elemDesc}`,
              { id: targetElement.id, description: elemDesc },
              "click"
            );

            await this.cdp.clickElement(targetElement.rect, this.config.antiBotMode);
            stepCompleted = true;
          } else if (decision.actionType === "finish") {
            stepCompleted = true;
            break;
          }

          // Settle delay after interaction
          await sleep(1500);
        }
      }

      this.status = "completed";
      this.log("Task Finished", "success", 1.0, "All subgoals completed successfully!");
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
}
