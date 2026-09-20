import { JevDecision } from "../background/typesafe-service.js";
import { PageState } from "../shared/types.js";

export interface WorkflowMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  matchUrl?: string;
  phases?: (WorkflowMetaPhase | string)[];
  whenToUse?: string;
}

export type SuccessCheckCriteria =
  | string
  | { url?: string; text?: string; selector?: string; disappeared?: string };

export interface SuccessCheckOptions {
  timeout?: number;
  pollInterval?: number;
  strict?: boolean;
}

export interface SuccessCheckResult {
  isGoalReached: boolean;
  confidence: number;
  reason?: string;
  elapsedMs?: number;
  hasChanged?: boolean;
}

export interface WorkflowContext {
  /**
   * First-class runtime primitive: Adaptive state guard with fast-exit polling & timeout
   */
  successCheck: (
    criteria?: SuccessCheckCriteria | number,
    options?: number | SuccessCheckOptions
  ) => Promise<SuccessCheckResult>;

  /**
   * Alias for successCheck()
   */
  verify: (
    criteria?: SuccessCheckCriteria | number,
    options?: number | SuccessCheckOptions
  ) => Promise<SuccessCheckResult>;
  /**
   * Primary executor: TypeSafe Jev System One
   * Evaluates current DOM, chooses target element, dispatches Bezier mouse/keyboard CDP event
   */
  jev: (
    subgoal: string,
    options?: { expectedAction?: "click" | "type" | "scroll"; text?: string }
  ) => Promise<JevDecision>;

  /**
   * Claude Code dynamic workflow alias for jev()
   * Allows raw Claude Code generated dynamic workflow scripts to execute seamlessly
   */
  agent: (prompt: string, options?: any) => Promise<any>;

  /**
   * Declare current workflow phase (updates Sidepanel live timeline view)
   */
  phase: (title: string) => void;

  /**
   * Log messages to Sidepanel trace timeline
   */
  log: (message: string) => void;

  /**
   * Fetch current live page state (URL, activeModal, interactive elements)
   */
  getPage: () => Promise<PageState>;

  /**
   * Smooth mouse wheel scroll
   */
  scroll: (deltaY: number) => Promise<void>;

  /**
   * Sleep / wait for DOM to settle
   */
  wait: (ms: number) => Promise<void>;

  /**
   * Explicitly highlight a step/line in live code stepper
   */
  step?: (label?: string) => void;

  /**
   * Optional runtime arguments passed to workflow
   */
  args?: Record<string, any>;

  /**
   * Cancellation signal
   */
  signal?: AbortSignal;
}

export type WorkflowFunction<T = any> = (
  ctx: WorkflowContext
) => Promise<T>;

export interface WorkflowDefinition {
  id: string;
  meta: WorkflowMeta;
  script?: string;
  fn?: WorkflowFunction;
  isBuiltIn?: boolean;
  createdAt: number;
}
