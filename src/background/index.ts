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

  // Enable automatic side panel toggle on toolbar icon click
  if ((chrome as any).sidePanel?.setPanelBehavior) {
    (chrome as any).sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err: any) => console.warn("[Ang] setPanelBehavior warning:", err));
  }

  console.log("[Ang] Background Service Worker initialized.");
}

init();

// Open side panel on extension icon click (fallback if setPanelBehavior not supported)
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.windowId) {
    if ((chrome as any).sidePanel && (chrome as any).sidePanel.open) {
      await (chrome as any).sidePanel.open({ windowId: tab.windowId }).catch(() => {});
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
      case "GET_ALL_WORKFLOWS": {
        const workflows = await WorkflowRegistry.getAllWorkflows();
        return { success: true, workflows };
      }
      case "SAVE_WORKFLOW": {
        await WorkflowRegistry.saveWorkflow(message.id, message.meta, message.script);
        return { success: true };
      }
      case "DELETE_WORKFLOW": {
        const success = await WorkflowRegistry.deleteWorkflow(message.id);
        return { success };
      }
      case "CLOSE_SIDEPANEL": {
        return { success: true };
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
      case "SAVE_LAST_WORKFLOW": {
        const result = await agentLoop!.saveLastExecutedWorkflow();
        return result;
      }
      case "GET_STATE": {
        return {
          status: agentLoop!.getStatus(),
          logs: agentLoop!.getLogs(),
          activeWorkflowScript: agentLoop!.getActiveWorkflowScript(),
          activeLine: agentLoop!.getCurrentActiveLine(),
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
