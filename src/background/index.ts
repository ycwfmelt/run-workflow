import { AgentLoop } from "./agent-loop.js";
import { loadConfig } from "../shared/storage.js";
import { MessagePayload } from "../shared/types.js";
import { WorkflowRegistry } from "../workflows/workflow-registry.js";

let agentLoop: AgentLoop | null = null;

// Initialize agent
async function init() {
  const config = await loadConfig();
  agentLoop = new AgentLoop(config);

  // Watch for configuration changes in chrome.storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.jev_config) {
      loadConfig().then((newConfig) => {
        agentLoop?.updateConfig(newConfig);
      });
    }
  });

  console.log("[Ang] Background Service Worker initialized.");
}

init();

// Open side panel on extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.windowId) {
    // Open side panel in the current window
    if ((chrome as any).sidePanel && (chrome as any).sidePanel.open) {
      await (chrome as any).sidePanel.open({ windowId: tab.windowId });
    }
  }
});

// Message listener from Side Panel / Content script
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (!agentLoop) {
    sendResponse({ error: "Agent not ready" });
    return true;
  }

  const handleAsync = async () => {
    switch (message.type) {
      case "START_TASK": {
        // Query active tab
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || !activeTab.id) {
          throw new Error("No active tab found");
        }
        // Start running task asynchronously
        agentLoop!.startTask(activeTab.id, message.prompt);
        return { success: true };
      }
      case "START_WORKFLOW": {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || !activeTab.id) {
          throw new Error("No active tab found");
        }
        agentLoop!.startWorkflow(activeTab.id, message.workflowId, message.args);
        return { success: true };
      }
      case "GET_MATCHING_WORKFLOWS": {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = activeTab?.url || "";
        const workflows = await WorkflowRegistry.getMatchingWorkflows(url);
        return { success: true, workflows };
      }
      case "PAUSE_TASK": {
        await agentLoop!.pause();
        return { success: true };
      }
      case "RESUME_TASK": {
        await agentLoop!.resume();
        return { success: true };
      }
      case "STOP_TASK": {
        await agentLoop!.stop();
        return { success: true };
      }
      case "GET_STATE": {
        return {
          status: agentLoop!.getStatus(),
          logs: agentLoop!.getLogs(),
        };
      }
      case "DIAGNOSE_PAGE": {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || !activeTab.id) {
          throw new Error("No active tab found");
        }
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            files: ["content.js"],
          });
        } catch (e) {}

        return new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(
            activeTab.id!,
            { type: "DIAGNOSE_PAGE" },
            (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (res && res.diagnostics) {
                resolve({ success: true, diagnostics: res.diagnostics });
              } else {
                reject(new Error("诊断响应为空"));
              }
            }
          );
        });
      }
      default:
        return { success: false, error: "Unknown message type" };
    }
  };

  handleAsync()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // Keep response channel open
});
