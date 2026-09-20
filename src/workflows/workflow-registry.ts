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

const STORAGE_KEY = "ang_custom_workflows";
const LEGACY_STORAGE_KEY = "jevpilot_custom_workflows";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function compileScriptToFunction(script: string): WorkflowFunction {
  let clean = script.trim().replace(/^```(?:javascript|js|typescript|ts)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (/(?:export\s+default\s+)?async\s+function(?:\s+\w+)?\s*\(\s*ctx\s*\)\s*\{/i.test(clean)) {
    clean = `return (${clean.replace(/^export\s+default\s+/i, "")})(ctx);`;
  }
  return new AsyncFunction("ctx", clean) as WorkflowFunction;
}

export class WorkflowRegistry {
  /**
   * Get all available workflows (built-in + saved custom)
   */
  static async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      const stored: any = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
      const custom: WorkflowDefinition[] = (stored[STORAGE_KEY] || stored[LEGACY_STORAGE_KEY] || []) as WorkflowDefinition[];
      const hydratedCustom = custom.map((wf) => {
        if (!wf.fn && wf.script) {
          try {
            wf.fn = compileScriptToFunction(wf.script);
          } catch (compileErr) {
            console.warn(`[Ang] Failed to compile workflow script for ${wf.id}:`, compileErr);
          }
        }
        return wf;
      });
      return [...BUILTIN_WORKFLOWS, ...hydratedCustom];
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
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
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
