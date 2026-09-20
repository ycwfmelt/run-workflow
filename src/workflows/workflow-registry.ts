import {
  WorkflowDefinition,
  WorkflowFunction,
  WorkflowContext,
} from "./types.js";
import {
  meta as newBossMeta,
  run as newBossRun,
} from "./builtin/crm-batch-batch-approval.js";

const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "crm_batch_approval",
    meta: newBossMeta,
    fn: newBossRun,
    isBuiltIn: true,
    createdAt: Date.now(),
  },
];

const STORAGE_KEY = "jevpilot_custom_workflows";

export class WorkflowRegistry {
  /**
   * Get all available workflows (built-in + saved custom)
   */
  static async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const custom: WorkflowDefinition[] = stored[STORAGE_KEY] || [];
      return [...BUILTIN_WORKFLOWS, ...custom];
    } catch {
      return [...BUILTIN_WORKFLOWS];
    }
  }

  /**
   * Find workflows matching a specific URL (e.g. crm.example.com)
   */
  static async getMatchingWorkflows(url: string): Promise<WorkflowDefinition[]> {
    const all = await this.getAllWorkflows();
    if (!url) return [];
    return all.filter((wf) => {
      if (!wf.meta.matchUrl) return true;
      return url.includes(wf.meta.matchUrl);
    });
  }

  /**
   * Save or update a custom workflow script (as JS function)
   */
  static async saveWorkflow(
    id: string,
    meta: WorkflowDefinition["meta"],
    script: string
  ): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = stored[STORAGE_KEY] || [];
    const index = list.findIndex((w) => w.id === id);

    const entry: WorkflowDefinition = {
      id,
      meta,
      script,
      isBuiltIn: false,
      createdAt: Date.now(),
    };

    if (index >= 0) {
      list[index] = entry;
    } else {
      list.push(entry);
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  /**
   * Get workflow by ID
   */
  static async getWorkflowById(
    id: string
  ): Promise<WorkflowDefinition | undefined> {
    const all = await this.getAllWorkflows();
    return all.find((w) => w.id === id);
  }
}
