export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface InteractiveElement {
  id: string; // e.g. "el_1"
  tag: string;
  role: string;
  text: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  value?: string;
  href?: string;
  name?: string;
  rect: ElementRect;
  center: { x: number; y: number };
  isClickable: boolean;
  isInput: boolean;
  selector: string;
}

export type ActionType =
  | "click"
  | "type"
  | "press_key"
  | "scroll"
  | "wait"
  | "navigate"
  | "finish";

export interface AgentAction {
  type: ActionType;
  targetId?: string;
  text?: string;
  key?: string;
  scrollDelta?: { x: number; y: number };
  url?: string;
  reasoning?: string;
}

export type TaskStatus =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "waiting_user"
  | "completed"
  | "failed";

export interface StepLog {
  stepNumber: number;
  timestamp: number;
  subgoal: string;
  targetElement?: {
    id: string;
    description: string;
  };
  actionType?: ActionType;
  confidence: number;
  probabilities?: Record<string, number>;
  status: "success" | "warning" | "error";
  message: string;
}

export interface AgentConfig {
  typesafeApiKey: string;
  typesafeModel: string;
  systemTwoProvider:
    | "none"
    | "deepseek"
    | "openai"
    | "gemini"
    | "siliconflow"
    | "ollama"
    | "custom";
  systemTwoApiKey?: string;
  systemTwoEndpoint?: string;
  systemTwoModel?: string;
  antiBotMode: boolean; // Bezier curves, realistic delays
  confidenceThreshold: number; // e.g. 0.70
  maxSteps: number;
}

export interface IframeInfo {
  src: string;
  isSameOrigin: boolean;
  rect: ElementRect;
}

export interface DiagnosticsInfo {
  url: string;
  title: string;
  isTopFrame: boolean;
  iframes: IframeInfo[];
  shadowRootCount: number;
  interactiveElementsCount: number;
  sampleElements: {
    id: string;
    tag: string;
    text: string;
    selector: string;
    inIframe?: boolean;
    inShadow?: boolean;
  }[];
  timestamp: number;
}

export interface ActiveModalInfo {
  isOpen: boolean;
  title: string;
  confirmButtonId?: string;
  cancelButtonId?: string;
}

export interface PageState {
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  elements: InteractiveElement[];
  activeModal?: ActiveModalInfo;
  diagnostics?: DiagnosticsInfo;
}

// Inter-process message protocols
export type MessagePayload =
  | { type: "EXTRACT_DOM" }
  | { type: "EXTRACT_DOM_RESULT"; state: PageState }
  | { type: "DIAGNOSE_PAGE" }
  | { type: "DIAGNOSE_PAGE_RESULT"; diagnostics: DiagnosticsInfo }
  | { type: "HIGHLIGHT_ELEMENT"; elementId: string }
  | { type: "CLEAR_HIGHLIGHTS" }
  | { type: "TOGGLE_OVERLAY"; visible: boolean }
  | { type: "START_TASK"; prompt: string }
  | { type: "PAUSE_TASK" }
  | { type: "RESUME_TASK" }
  | { type: "STOP_TASK" }
  | { type: "SAVE_LAST_WORKFLOW" }
  | { type: "CLOSE_SIDEPANEL" }
  | {
      type: "VIRTUAL_MOUSE_UPDATE";
      x: number;
      y: number;
      action?: "move" | "down" | "up" | "click";
    }
  | { type: "VIRTUAL_MOUSE_HIDE" }
  | { type: "GET_ALL_WORKFLOWS" }
  | { type: "SAVE_WORKFLOW"; workflow: any }
  | { type: "DELETE_WORKFLOW"; id: string }
  | {
      type: "AGENT_STATE_UPDATE";
      status: TaskStatus;
      currentTask?: string;
      currentStep?: number;
      recentLogs: StepLog[];
      currentAction?: AgentAction;
      canSaveWorkflow?: boolean;
      workflowName?: string;
    };

