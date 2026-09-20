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

const typesafeApiKeyInput = document.getElementById("typesafeApiKey") as HTMLInputElement;
const systemTwoApiKeyInput = document.getElementById("systemTwoApiKey") as HTMLInputElement;
const antiBotCheckbox = document.getElementById("antiBotCheckbox") as HTMLInputElement;
const saveConfigBtn = document.getElementById("saveConfigBtn") as HTMLButtonElement;

// Load config
async function init() {
  const config = await loadConfig();
  typesafeApiKeyInput.value = config.typesafeApiKey || "";
  systemTwoApiKeyInput.value = config.systemTwoApiKey || "";
  antiBotCheckbox.checked = config.antiBotMode;

  // Request current state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (response && response.status) {
      updateUIStatus(response.status);
      if (response.logs) {
        renderLogs(response.logs);
      }
    }
  });
}

init();

// Save config
saveConfigBtn.addEventListener("click", async () => {
  await saveConfig({
    typesafeApiKey: typesafeApiKeyInput.value.trim(),
    systemTwoApiKey: systemTwoApiKeyInput.value.trim(),
    systemTwoProvider: systemTwoApiKeyInput.value.trim() ? "openai" : "none",
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
