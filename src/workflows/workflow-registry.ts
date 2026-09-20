import {
  WorkflowDefinition,
  WorkflowFunction,
  WorkflowMeta,
} from "./types.js";

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

/**
 * Robust URL matching supporting:
 * 1. "*" or empty: matches everything (global)
 * 2. Regular expressions: /pattern/flags
 * 3. Wildcards: *.example.com/* or https://*
 * 4. Substring: crm.example.com
 */
export function matchUrlRule(url: string, rule?: string): boolean {
  if (!rule || rule.trim() === "" || rule.trim() === "*") {
    return true;
  }
  const trimmed = rule.trim();

  // 1. Regular expression: /pattern/flags
  const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    try {
      const rx = new RegExp(regexMatch[1], regexMatch[2]);
      return rx.test(url);
    } catch {
      // Ignore invalid regex and fallback
    }
  }

  // 2. Wildcard glob: *.example.com/* or https://*
  if (trimmed.includes("*")) {
    try {
      const regexPattern = trimmed
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const fullRegex = new RegExp(`^${regexPattern}$`, "i");
      if (fullRegex.test(url)) return true;

      const subRegex = new RegExp(regexPattern, "i");
      if (subRegex.test(url)) return true;
    } catch {
      // Fallback
    }
  }

  // 3. Substring match (case-insensitive)
  return url.toLowerCase().includes(trimmed.toLowerCase());
}

export class WorkflowRegistry {
  /**
   * Get all registered dynamic workflows
   */
  static async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      const stored: any = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
      const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || stored[LEGACY_STORAGE_KEY] || []) as WorkflowDefinition[];
      return list.map((wf) => {
        if (!wf.fn && wf.script) {
          try {
            wf.fn = compileScriptToFunction(wf.script);
          } catch (compileErr) {
            console.warn(`[Ang] Failed to compile workflow script for ${wf.id}:`, compileErr);
          }
        }
        return wf;
      });
    } catch {
      return [];
    }
  }

  /**
   * Find workflows matching a specific URL
   */
  static async getMatchingWorkflows(url: string): Promise<WorkflowDefinition[]> {
    const all = await this.getAllWorkflows();
    if (!url) return [];
    return all.filter((wf) => matchUrlRule(url, wf.meta.matchUrl));
  }

  /**
   * Save or update a dynamic workflow script (as JS function)
   */
  static async saveWorkflow(
    id: string,
    meta: WorkflowMeta,
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
   * Update existing workflow metadata or script
   */
  static async updateWorkflow(
    id: string,
    updates: { meta?: Partial<WorkflowMeta>; script?: string }
  ): Promise<void> {
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
    const index = list.findIndex((w) => w.id === id);

    if (index >= 0) {
      list[index] = {
        ...list[index],
        meta: {
          ...list[index].meta,
          ...(updates.meta || {}),
        },
        script: updates.script !== undefined ? updates.script : list[index].script,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: list });
    }
  }

  /**
   * Delete custom workflow by ID
   */
  static async deleteWorkflow(id: string): Promise<boolean> {
    const stored: any = await chrome.storage.local.get(STORAGE_KEY);
    const list: WorkflowDefinition[] = (stored[STORAGE_KEY] || []) as WorkflowDefinition[];
    const filtered = list.filter((w) => w.id !== id);
    if (filtered.length === list.length) {
      return false;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    return true;
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
