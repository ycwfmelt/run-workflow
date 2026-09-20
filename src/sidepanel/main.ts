import { loadConfig, saveConfig } from "../shared/storage.js";
import { MessagePayload, StepLog, TaskStatus } from "../shared/types.js";

// DOM elements
const statusBadge = document.getElementById("statusBadge") as HTMLElement;
const taskPrompt = document.getElementById("taskPrompt") as HTMLTextAreaElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const resumeBtn = document.getElementById("resumeBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

const stepCounter = document.getElementById("stepCounter") as HTMLElement;
const confidenceValue = document.getElementById("confidenceValue") as HTMLElement;
const confidenceFill = document.getElementById("confidenceFill") as HTMLElement;
const currentSubgoal = document.getElementById("currentSubgoal") as HTMLElement;
const logList = document.getElementById("logList") as HTMLElement;
const diagnoseBtn = document.getElementById("diagnoseBtn") as HTMLButtonElement;
const copyDebugBtn = document.getElementById("copyDebugBtn") as HTMLButtonElement;
const diagnoseResult = document.getElementById("diagnoseResult") as HTMLElement;
let currentDiagnosticsText = "";

const workflowsCard = document.getElementById("workflowsCard") as HTMLElement;
const workflowList = document.getElementById("workflowList") as HTMLElement;

const typesafeApiKeyInput = document.getElementById("typesafeApiKey") as HTMLInputElement;
const systemTwoProviderSelect = document.getElementById("systemTwoProvider") as HTMLSelectElement;
const s2DetailsContainer = document.getElementById("s2DetailsContainer") as HTMLElement;
const systemTwoEndpointInput = document.getElementById("systemTwoEndpoint") as HTMLInputElement;
const systemTwoModelInput = document.getElementById("systemTwoModel") as HTMLInputElement;
const systemTwoApiKeyInput = document.getElementById("systemTwoApiKey") as HTMLInputElement;
const s2KeyRow = document.getElementById("s2KeyRow") as HTMLElement;

const antiBotCheckbox = document.getElementById("antiBotCheckbox") as HTMLInputElement;
const saveConfigBtn = document.getElementById("saveConfigBtn") as HTMLButtonElement;

const PROVIDER_PRESETS: Record<string, { endpoint: string; model: string; needKey: boolean }> = {
  none: { endpoint: "", model: "", needKey: false },
  deepseek: { endpoint: "https://api.deepseek.com", model: "deepseek-chat", needKey: true },
  openai: { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini", needKey: true },
  gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.5-flash", needKey: true },
  siliconflow: { endpoint: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3", needKey: true },
  ollama: { endpoint: "http://localhost:11434/v1", model: "llama3.2", needKey: false },
  custom: { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini", needKey: true },
};

function updateS2UI() {
  const provider = systemTwoProviderSelect.value;
  if (provider === "none") {
    s2DetailsContainer.style.display = "none";
  } else {
    s2DetailsContainer.style.display = "flex";
    const preset = PROVIDER_PRESETS[provider];
    if (preset) {
      if (!systemTwoEndpointInput.value) systemTwoEndpointInput.value = preset.endpoint;
      if (!systemTwoModelInput.value) systemTwoModelInput.value = preset.model;
      s2KeyRow.style.display = preset.needKey ? "flex" : "none";
    }
  }
}

systemTwoProviderSelect.addEventListener("change", () => {
  const provider = systemTwoProviderSelect.value;
  const preset = PROVIDER_PRESETS[provider];
  if (preset && provider !== "none") {
    systemTwoEndpointInput.value = preset.endpoint;
    systemTwoModelInput.value = preset.model;
  }
  updateS2UI();
});

// Load config
async function init() {
  const config = await loadConfig();
  typesafeApiKeyInput.value = config.typesafeApiKey || "";
  systemTwoProviderSelect.value = config.systemTwoProvider || "none";
  systemTwoEndpointInput.value = config.systemTwoEndpoint || "";
  systemTwoModelInput.value = config.systemTwoModel || "";
  systemTwoApiKeyInput.value = config.systemTwoApiKey || "";
  antiBotCheckbox.checked = config.antiBotMode;

  updateS2UI();

  // Request current state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (response && response.status) {
      updateUIStatus(response.status);
      if (response.logs) {
        renderLogs(response.logs);
      }
    }
  });

  // Load matching workflows for active tab
  loadMatchingWorkflows();
}

async function loadMatchingWorkflows() {
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: "GET_MATCHING_WORKFLOWS",
    });
    if (res && res.workflows && res.workflows.length > 0) {
      workflowsCard.style.display = "block";
      workflowList.innerHTML = "";
      res.workflows.forEach((wf: any) => {
        const item = document.createElement("div");
        item.style.background = "#0f172a";
        item.style.border = "1px solid #334155";
        item.style.borderRadius = "6px";
        item.style.padding = "8px 10px";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.gap = "8px";

        item.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 12px; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ⚡ ${escapeHtml(wf.meta.name)}
            </div>
            <div style="font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">
              ${escapeHtml(wf.meta.description)}
            </div>
          </div>
          <button class="btn-primary run-wf-btn" data-id="${wf.id}" style="padding: 4px 8px; font-size: 11px; white-space: nowrap;">
            ▶ 运行
          </button>
        `;

        item.querySelector(".run-wf-btn")?.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            type: "START_WORKFLOW",
            workflowId: wf.id,
          });
        });

        workflowList.appendChild(item);
      });
    } else {
      workflowsCard.style.display = "none";
    }
  } catch {}
}

init();

// Save config
saveConfigBtn.addEventListener("click", async () => {
  await saveConfig({
    typesafeApiKey: typesafeApiKeyInput.value.trim(),
    systemTwoProvider: systemTwoProviderSelect.value as any,
    systemTwoEndpoint: systemTwoEndpointInput.value.trim(),
    systemTwoModel: systemTwoModelInput.value.trim(),
    systemTwoApiKey: systemTwoApiKeyInput.value.trim(),
    antiBotMode: antiBotCheckbox.checked,
  });
  saveConfigBtn.textContent = "已保存 ✓";
  setTimeout(() => {
    saveConfigBtn.textContent = "保存配置";
  }, 1500);
});

// Control buttons
startBtn.addEventListener("click", () => {
  const prompt = taskPrompt.value.trim();
  if (!prompt) {
    alert("请输入任务描述");
    return;
  }
  if (!typesafeApiKeyInput.value.trim()) {
    alert("请先在下方输入 TypeSafe API Key！");
    return;
  }
  chrome.runtime.sendMessage({ type: "START_TASK", prompt }, (res) => {
    if (res && res.error) {
      alert(`启动失败: ${res.error}`);
    }
  });
});

pauseBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PAUSE_TASK" });
});

resumeBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESUME_TASK" });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_TASK" });
});

diagnoseBtn.addEventListener("click", () => {
  diagnoseResult.textContent = "正在深度扫描当前标签页 DOM、Iframes 及 Shadow Roots...";
  chrome.runtime.sendMessage({ type: "DIAGNOSE_PAGE" }, (response) => {
    if (chrome.runtime.lastError) {
      diagnoseResult.textContent = `诊断失败: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!response || !response.diagnostics) {
      diagnoseResult.textContent = `诊断失败: ${response?.error || "未返回诊断数据"}`;
      return;
    }
    const d = response.diagnostics;
    let output = `【页面信息】\nURL: ${d.url}\n标题: ${d.title}\n时间: ${new Date(d.timestamp).toLocaleTimeString()}\n\n`;
    output += `【Iframe 探测】\n共发现 ${d.iframes.length} 个 iframe:\n`;
    if (d.iframes.length === 0) {
      output += `  (未检测到 iframe 标签)\n`;
    } else {
      d.iframes.forEach((f: any, idx: number) => {
        output += `  #${idx + 1} [${f.isSameOrigin ? "同源已穿透" : "跨域限制"}] ${f.src || "(无src)"} [宽${f.rect.width}x高${f.rect.height}]\n`;
      });
    }
    output += `\n【Shadow DOM 探测】\n发现 ${d.shadowRootCount} 个 open Shadow Root\n`;
    output += `\n【可交互元素】\n共提取到 ${d.interactiveElementsCount} 个可视交互元素\n`;
    output += `前 15 个元素样本:\n`;
    if (d.sampleElements.length === 0) {
      output += `  (未提取到任何可交互按钮或输入框，可能元素在跨域 iframe 或尚未渲染完成)\n`;
    } else {
      d.sampleElements.forEach((el: any) => {
        output += `  • [${el.id}] <${el.tag}> "${el.text}" (selector: ${el.selector})\n`;
      });
    }

    currentDiagnosticsText = output;
    diagnoseResult.textContent = output;
  });
});

copyDebugBtn.addEventListener("click", () => {
  const text = currentDiagnosticsText || diagnoseResult.textContent || "";
  navigator.clipboard.writeText(text).then(() => {
    copyDebugBtn.textContent = "已复制 ✓";
    setTimeout(() => {
      copyDebugBtn.textContent = "📋 复制日志";
    }, 1500);
  });
});

// Update UI based on status
function updateUIStatus(status: TaskStatus) {
  statusBadge.className = `status-badge status-${status}`;
  statusBadge.textContent = status.toUpperCase();

  const isBusy = ["planning", "running", "waiting_user"].includes(status);
  const isPaused = status === "paused";

  startBtn.style.display = isBusy || isPaused ? "none" : "inline-flex";
  pauseBtn.style.display = isBusy && !isPaused ? "inline-flex" : "none";
  resumeBtn.style.display = isPaused ? "inline-flex" : "none";
  stopBtn.style.display = isBusy || isPaused ? "inline-flex" : "none";
}

// Render logs
function renderLogs(logs: StepLog[]) {
  if (logs.length === 0) {
    logList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 20px;">暂无日志</div>';
    return;
  }

  logList.innerHTML = "";
  logs.forEach((log) => {
    const item = document.createElement("div");
    item.className = `log-item ${log.status}`;

    const time = new Date(log.timestamp).toLocaleTimeString();
    const confPercent = Math.round(log.confidence * 100);

    item.innerHTML = `
      <div class="log-header">
        <span>#${log.stepNumber} [${time}]</span>
        <span class="log-confidence" style="color: ${log.confidence > 0.85 ? '#10b981' : log.confidence > 0.65 ? '#f59e0b' : '#ef4444'}">
          Conf: ${confPercent}%
        </span>
      </div>
      <div style="font-weight: 500; margin-bottom: 2px;">${escapeHtml(log.subgoal)}</div>
      <div style="color: #cbd5e1;">${escapeHtml(log.message)}</div>
    `;
    logList.appendChild(item);
  });

  // Auto scroll to bottom
  logList.scrollTop = logList.scrollHeight;

  // Update latest telemetry
  const latest = logs[logs.length - 1];
  if (latest) {
    currentSubgoal.textContent = latest.subgoal;
    const conf = latest.confidence;
    confidenceValue.textContent = `${Math.round(conf * 100)}%`;
    confidenceFill.style.width = `${Math.round(conf * 100)}%`;

    if (conf > 0.85) {
      confidenceFill.style.background = "#10b981";
    } else if (conf > 0.65) {
      confidenceFill.style.background = "#f59e0b";
    } else {
      confidenceFill.style.background = "#ef4444";
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Listen for broadcast from background
chrome.runtime.onMessage.addListener((message: MessagePayload) => {
  if (message.type === "AGENT_STATE_UPDATE") {
    updateUIStatus(message.status);
    if (message.currentStep !== undefined) {
      stepCounter.textContent = `Step: ${message.currentStep}`;
    }
    if (message.recentLogs) {
      renderLogs(message.recentLogs);
    }
  }
});
