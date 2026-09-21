import { AgentLoop } from "./agent-loop.js";
import { loadConfig } from "../shared/storage.js";
import { MessagePayload } from "../shared/types.js";
import { WorkflowRegistry } from "../workflows/workflow-registry.js";
import { OffscreenRunner } from "./offscreen-runner.js";
import { checkS2Health } from "../shared/s2-health.js";

let agentLoop: AgentLoop | null = null;

async function setupOllamaCorsRules() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    const rules: chrome.declarativeNetRequest.Rule[] = [
      {
        id: 11434,
        priority: 1,
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            {
              header: "origin",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "http://localhost:11434",
            },
          ],
          responseHeaders: [
            {
              header: "access-control-allow-origin",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "*",
            },
            {
              header: "access-control-allow-methods",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "GET, POST, OPTIONS",
            },
            {
              header: "access-control-allow-headers",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "*",
            },
          ],
        },
        condition: {
          urlFilter: "||localhost:11434/",
          resourceTypes: [
            "xmlhttprequest" as chrome.declarativeNetRequest.ResourceType,
            "other" as chrome.declarativeNetRequest.ResourceType,
          ],
        },
      },
      {
        id: 11435,
        priority: 1,
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            {
              header: "origin",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "http://127.0.0.1:11434",
            },
          ],
          responseHeaders: [
            {
              header: "access-control-allow-origin",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "*",
            },
            {
              header: "access-control-allow-methods",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "GET, POST, OPTIONS",
            },
            {
              header: "access-control-allow-headers",
              operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
              value: "*",
            },
          ],
        },
        condition: {
          urlFilter: "||127.0.0.1:11434/",
          resourceTypes: [
            "xmlhttprequest" as chrome.declarativeNetRequest.ResourceType,
            "other" as chrome.declarativeNetRequest.ResourceType,
          ],
        },
      },
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [11434, 11435],
      addRules: rules,
    });
  } catch (err) {
    console.warn("[Ang] Failed to update declarativeNetRequest rules for Ollama CORS:", err);
  }
}

// Initialize agent
async function init() {
  const config = await loadConfig();
  agentLoop = new AgentLoop(config);

  await setupOllamaCorsRules();

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

async function resolveTargetTab(targetTab?: "current" | "new" | number, allowNew = false): Promise<number> {
  if (allowNew && targetTab === "new") {
    const newTab = await chrome.tabs.create({ url: "about:blank", active: true });
    await new Promise((r) => setTimeout(r, 600));
    if (newTab.id) return newTab.id;
  }
  if (typeof targetTab === "number") {
    return targetTab;
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab?.id) {
    throw new Error("No target tab found");
  }
  return activeTab.id;
}

// Message listener from Side Panel / Content script / Offscreen document
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message.type && message.type.startsWith("OFFSCREEN_")) {
    OffscreenRunner.handleMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }

  if (!agentLoop) {
    sendResponse({ error: "Agent not ready" });
    return true;
  }

  const handleAsync = async () => {
    switch (message.type) {
      case "VALIDATE_WORKFLOW_SCRIPT": {
        const result = await OffscreenRunner.validateScript(message.script);
        return result;
      }
      case "START_TASK": {
        const tabId = await resolveTargetTab(message.targetTab, true);
        agentLoop!.startTask(tabId, message.prompt);
        return { success: true, tabId };
      }
      case "START_WORKFLOW": {
        const tabId = await resolveTargetTab(message.targetTab, true);
        agentLoop!.startWorkflow(tabId, message.workflowId, message.args);
        return { success: true, tabId };
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
      case "INJECT_GUIDANCE": {
        agentLoop!.injectGuidance(message.guidance);
        return { success: true };
      }
      case "SAVE_LAST_WORKFLOW": {
        const result = await agentLoop!.saveLastExecutedWorkflow();
        return result;
      }
      case "CHECK_S2_STATUS": {
        const config = await loadConfig();
        const health = await checkS2Health(
          config.systemTwoEndpoint || "http://localhost:11434/v1",
          config.systemTwoModel || "deepseek-v4.1-flash:cloud",
          config.systemTwoApiKey || config.typesafeApiKey
        );
        return { success: true, health };
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
        const tabId = await resolveTargetTab(message.targetTab, false);
        try {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["content.js"],
          });
        } catch (e) {}

        return new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(
            tabId,
            { type: "DIAGNOSE_PAGE" },
            { frameId: 0 },
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
