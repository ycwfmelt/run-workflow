/**
 * RunWorkflow Offscreen Host
 * Manages the sandboxed iframe and bridges messages between background service worker and sandbox.
 */

const iframe = document.getElementById("sandboxFrame") as HTMLIFrameElement;
let isSandboxReady = false;
const pendingSandboxReadyCallbacks: (() => void)[] = [];

function whenSandboxReady(): Promise<void> {
  if (isSandboxReady) return Promise.resolve();
  return new Promise((resolve) => {
    pendingSandboxReadyCallbacks.push(resolve);
  });
}

// Listen to messages from sandboxed iframe
window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SANDBOX_READY") {
    isSandboxReady = true;
    while (pendingSandboxReadyCallbacks.length > 0) {
      const cb = pendingSandboxReadyCallbacks.shift();
      if (cb) cb();
    }
    return;
  }

  // 1. CTX call from sandbox (e.g. ctx.jev, ctx.getPage)
  if (data.type === "CTX_CALL") {
    const { executionId, callId, method, args, line, isOneWay } = data;

    if (isOneWay) {
      chrome.runtime.sendMessage({
        type: "OFFSCREEN_CTX_DISPATCH",
        executionId,
        callId,
        method,
        args,
        line,
        isOneWay: true,
      }).catch(() => {});
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CTX_DISPATCH",
        executionId,
        callId,
        method,
        args,
        line,
        isOneWay: false,
      });

      if (response && response.success) {
        iframe.contentWindow?.postMessage(
          {
            type: "CTX_RESULT",
            executionId,
            callId,
            result: response.result,
          },
          "*"
        );
      } else {
        iframe.contentWindow?.postMessage(
          {
            type: "CTX_RESULT",
            executionId,
            callId,
            error: response?.error || "Unknown execution error in background",
          },
          "*"
        );
      }
    } catch (err: any) {
      iframe.contentWindow?.postMessage(
        {
          type: "CTX_RESULT",
          executionId,
          callId,
          error: err?.message || String(err),
        },
        "*"
      );
    }
    return;
  }

  // 2. Workflow completed
  if (data.type === "WORKFLOW_DONE") {
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_WORKFLOW_COMPLETED",
      executionId: data.executionId,
      result: data.result,
    }).catch(() => {});
    return;
  }

  // 3. Workflow failed
  if (data.type === "WORKFLOW_FAILED") {
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_WORKFLOW_FAILED",
      executionId: data.executionId,
      error: data.error,
    }).catch(() => {});
    return;
  }

  // 4. Validation completed
  if (data.type === "VALIDATION_RESULT") {
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_VALIDATION_COMPLETED",
      validationId: data.validationId,
      valid: data.valid,
      error: data.error,
    }).catch(() => {});
    return;
  }
});

// Listen to commands from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_EXECUTE_SCRIPT") {
    whenSandboxReady().then(() => {
      iframe.contentWindow?.postMessage(
        {
          type: "EXECUTE_WORKFLOW",
          executionId: message.executionId,
          script: message.script,
          args: message.args,
        },
        "*"
      );
    });
    sendResponse({ received: true });
    return true;
  }

  if (message.type === "OFFSCREEN_VALIDATE_SCRIPT") {
    whenSandboxReady().then(() => {
      iframe.contentWindow?.postMessage(
        {
          type: "VALIDATE_SCRIPT",
          validationId: message.validationId,
          script: message.script,
        },
        "*"
      );
    });
    sendResponse({ received: true });
    return true;
  }

  return false;
});
