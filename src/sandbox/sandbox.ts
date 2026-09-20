/**
 * RunWorkflow Sandboxed Execution Environment
 * Runs inside a Manifest V3 sandboxed iframe (<iframe src="../sandbox/sandbox.html">)
 * with CSP allowing 'unsafe-eval' for dynamic workflow execution.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

interface PendingCall {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

const pendingCalls = new Map<string, PendingCall>();

function getCallerLine(): number | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;
    const match = stack.match(/workflow\.js:(\d+):(\d+)/);
    if (match) {
      const rawLine = parseInt(match[1], 10);
      return Math.max(1, rawLine - 2);
    }
  } catch {}
  return undefined;
}

function sendCtxCall(
  executionId: string,
  method: string,
  args: any[],
  line?: number,
  isOneWay: boolean = false
): Promise<any> {
  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (isOneWay) {
    window.parent.postMessage(
      {
        type: "CTX_CALL",
        executionId,
        callId,
        method,
        args,
        line,
        isOneWay: true,
      },
      "*"
    );
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    pendingCalls.set(callId, { resolve, reject });
    window.parent.postMessage(
      {
        type: "CTX_CALL",
        executionId,
        callId,
        method,
        args,
        line,
        isOneWay: false,
      },
      "*"
    );
  });
}

function compileCode(script: string): Function {
  let clean = script
    .trim()
    .replace(/^```(?:javascript|js|typescript|ts)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let wrapped = clean;
  if (
    /(?:export\s+default\s+)?async\s+function(?:\s+\w+)?\s*\(\s*ctx\s*\)\s*\{/i.test(
      clean
    )
  ) {
    wrapped = `return (${clean.replace(/^export\s+default\s+/i, "")})(ctx);`;
  }
  const fullCode = `${wrapped}\n//# sourceURL=workflow.js`;
  return new AsyncFunction("ctx", fullCode);
}

// Listen to messages from host (offscreen runner)
window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  // 1. CTX call return result
  if (data.type === "CTX_RESULT") {
    const { callId, result, error } = data;
    const pending = pendingCalls.get(callId);
    if (pending) {
      pendingCalls.delete(callId);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
    return;
  }

  // 2. Validate script syntax
  if (data.type === "VALIDATE_SCRIPT") {
    const { validationId, script } = data;
    try {
      compileCode(script);
      window.parent.postMessage(
        {
          type: "VALIDATION_RESULT",
          validationId,
          valid: true,
        },
        "*"
      );
    } catch (err: any) {
      window.parent.postMessage(
        {
          type: "VALIDATION_RESULT",
          validationId,
          valid: false,
          error: err?.message || String(err),
        },
        "*"
      );
    }
    return;
  }

  // 3. Execute workflow
  if (data.type === "EXECUTE_WORKFLOW") {
    const { executionId, script, args } = data;

    try {
      const fn = compileCode(script);

      const ctx = {
        jev: async (subgoal: string, options?: any) => {
          const line = getCallerLine();
          return await sendCtxCall(executionId, "jev", [subgoal, options], line);
        },
        agent: async (subgoal: string, options?: any) => {
          const line = getCallerLine();
          return await sendCtxCall(executionId, "agent", [subgoal, options], line);
        },
        getPage: async () => {
          const line = getCallerLine();
          return await sendCtxCall(executionId, "getPage", [], line);
        },
        scroll: async (deltaY: number) => {
          const line = getCallerLine();
          return await sendCtxCall(executionId, "scroll", [deltaY], line);
        },
        wait: async (ms: number) => {
          const line = getCallerLine();
          sendCtxCall(executionId, "wait", [ms], line, true);
          return new Promise((resolve) => setTimeout(resolve, ms));
        },
        phase: (title: string) => {
          const line = getCallerLine();
          sendCtxCall(executionId, "phase", [title], line, true);
        },
        log: (message: string) => {
          const line = getCallerLine();
          sendCtxCall(executionId, "log", [message], line, true);
        },
        step: (label?: string) => {
          const line = getCallerLine();
          sendCtxCall(executionId, "step", [label], line, true);
        },
        args: args || {},
      };

      const result = await fn(ctx);

      window.parent.postMessage(
        {
          type: "WORKFLOW_DONE",
          executionId,
          result: result !== undefined ? result : null,
        },
        "*"
      );
    } catch (err: any) {
      window.parent.postMessage(
        {
          type: "WORKFLOW_FAILED",
          executionId,
          error: err?.message || String(err),
        },
        "*"
      );
    }
  }
});

// Notify parent that sandbox is ready
window.parent.postMessage({ type: "SANDBOX_READY" }, "*");
