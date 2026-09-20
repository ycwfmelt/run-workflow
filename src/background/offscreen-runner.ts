/**
 * Offscreen Runner Bridge
 * Safely executes dynamic user & AI-generated scripts in an MV3-compliant sandbox
 * without violating Content Security Policy ('unsafe-eval').
 */

interface ActiveExecution {
  executionId: string;
  onCtxCall: (method: string, args: any[], line?: number) => Promise<any>;
  resolve: (result: any) => void;
  reject: (err: any) => void;
}

interface ActiveValidation {
  validationId: string;
  resolve: (result: { valid: boolean; error?: string }) => void;
}

export class OffscreenRunner {
  private static isCreatingDocument = false;
  private static activeExecutions = new Map<string, ActiveExecution>();
  private static activeValidations = new Map<string, ActiveValidation>();

  /**
   * Routes messages received from the offscreen document
   */
  static async handleMessage(message: any): Promise<any> {
    if (message.type === "OFFSCREEN_CTX_DISPATCH") {
      const { executionId, method, args, line, isOneWay } = message;
      const exec = this.activeExecutions.get(executionId);

      if (!exec) {
        return { success: false, error: "Execution context expired" };
      }

      if (isOneWay) {
        exec.onCtxCall(method, args, line).catch(() => {});
        return { success: true };
      }

      try {
        const result = await exec.onCtxCall(method, args, line);
        return { success: true, result };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }

    if (message.type === "OFFSCREEN_WORKFLOW_COMPLETED") {
      const { executionId, result } = message;
      const exec = this.activeExecutions.get(executionId);
      if (exec) {
        this.activeExecutions.delete(executionId);
        exec.resolve(result);
      }
      return { success: true };
    }

    if (message.type === "OFFSCREEN_WORKFLOW_FAILED") {
      const { executionId, error } = message;
      const exec = this.activeExecutions.get(executionId);
      if (exec) {
        this.activeExecutions.delete(executionId);
        exec.reject(new Error(error || "Workflow execution failed"));
      }
      return { success: true };
    }

    if (message.type === "OFFSCREEN_VALIDATION_COMPLETED") {
      const { validationId, valid, error } = message;
      const val = this.activeValidations.get(validationId);
      if (val) {
        this.activeValidations.delete(validationId);
        val.resolve({ valid, error });
      }
      return { success: true };
    }

    return { success: false, error: `Unknown offscreen message: ${message.type}` };
  }

  static async ensureDocument(): Promise<void> {
    if ("hasDocument" in (chrome as any).offscreen) {
      if (await (chrome as any).offscreen.hasDocument()) {
        return;
      }
    }

    if (this.isCreatingDocument) {
      await new Promise((r) => setTimeout(r, 150));
      return this.ensureDocument();
    }

    this.isCreatingDocument = true;
    try {
      await chrome.offscreen.createDocument({
        url: "src/offscreen/index.html",
        reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING],
        justification: "Run dynamic automation workflow scripts in a secure sandboxed iframe",
      });
      // Brief pause to allow iframe inside offscreen page to initialize
      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      if (!err?.message?.includes("Only a single offscreen document may be created")) {
        throw err;
      }
    } finally {
      this.isCreatingDocument = false;
    }
  }

  /**
   * Safely execute workflow code inside the offscreen sandbox
   */
  static async runScript(
    script: string,
    args: any,
    onCtxCall: (method: string, args: any[], line?: number) => Promise<any>
  ): Promise<any> {
    await this.ensureDocument();

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.activeExecutions.set(executionId, {
        executionId,
        onCtxCall,
        resolve,
        reject,
      });

      chrome.runtime
        .sendMessage({
          type: "OFFSCREEN_EXECUTE_SCRIPT",
          executionId,
          script,
          args,
        })
        .catch((err) => {
          this.activeExecutions.delete(executionId);
          reject(new Error(`Failed to dispatch script to offscreen runner: ${err.message}`));
        });
    });
  }

  /**
   * Validate JavaScript syntax in sandbox without triggering CSP unsafe-eval
   */
  static async validateScript(script: string): Promise<{ valid: boolean; error?: string }> {
    await this.ensureDocument();

    const validationId = `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve) => {
      this.activeValidations.set(validationId, {
        validationId,
        resolve,
      });

      chrome.runtime
        .sendMessage({
          type: "OFFSCREEN_VALIDATE_SCRIPT",
          validationId,
          script,
        })
        .catch((err) => {
          this.activeValidations.delete(validationId);
          resolve({ valid: false, error: err.message });
        });
    });
  }
}
