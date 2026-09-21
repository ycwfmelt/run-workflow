import { loadConfig } from "../shared/storage.js";
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

const openOptionsBtn = document.getElementById("openOptionsBtn") as HTMLButtonElement;
const bannerSettingsBtn = document.getElementById("bannerSettingsBtn") as HTMLButtonElement;
const apiKeyBanner = document.getElementById("apiKeyBanner") as HTMLElement;

// S2 / Ollama Status DOM elements
const s2StatusBadge = document.getElementById("s2StatusBadge") as HTMLElement;
const s2StatusText = document.getElementById("s2StatusText") as HTMLElement;
const s2Banner = document.getElementById("s2Banner") as HTMLElement;
const s2BannerTitle = document.getElementById("s2BannerTitle") as HTMLElement;
const s2BannerDesc = document.getElementById("s2BannerDesc") as HTMLElement;
const s2RetryBtn = document.getElementById("s2RetryBtn") as HTMLButtonElement;
const s2SettingsBtn = document.getElementById("s2SettingsBtn") as HTMLButtonElement;
let lastS2HealthStatus: string = "unknown";

const saveWorkflowBanner = document.getElementById("saveWorkflowBanner") as HTMLElement;
const saveWorkflowDesc = document.getElementById("saveWorkflowDesc") as HTMLElement;
const saveWorkflowBtn = document.getElementById("saveWorkflowBtn") as HTMLButtonElement;

let cachedApiKey = "";

async function checkS2Status() {
  if (s2StatusBadge) {
    s2StatusBadge.className = "s2-badge s2-unknown";
    s2StatusText.textContent = "S2: 检测中...";
  }

  try {
    const res: any = await chrome.runtime.sendMessage({ type: "CHECK_S2_STATUS" });
    if (!res || !res.health) {
      updateS2UI({
        status: "offline",
        message: "无法连接到后台诊断服务",
        actionHint: "请刷新插件或重新打开侧边栏。",
        endpoint: "",
        model: "",
      });
      return;
    }
    updateS2UI(res.health);
  } catch (err: any) {
    updateS2UI({
      status: "error",
      message: err?.message || "检测失败",
      actionHint: "请检查系统网络与服务运行状态。",
      endpoint: "",
      model: "",
    });
  }
}

function updateS2UI(health: any) {
  lastS2HealthStatus = health.status;

  if (health.status === "online") {
    s2StatusBadge.className = "s2-badge s2-online";
    s2StatusBadge.title = `S2 服务在线\n端点: ${health.endpoint}\n模型: ${health.model}\n延迟: ${health.latencyMs || "--"}ms\n(点击重新检测)`;
    s2StatusText.textContent = `S2: 在线 (${health.latencyMs ? health.latencyMs + "ms" : "OK"})`;
    s2Banner.style.display = "none";
  } else if (health.status === "offline") {
    s2StatusBadge.className = "s2-badge s2-offline";
    s2StatusBadge.title = `S2 服务离线 (未启动)\n端点: ${health.endpoint}\n${health.message}\n(点击重新检测)`;
    s2StatusText.textContent = "S2: 离线 🔴";
    s2Banner.style.display = "flex";
    s2BannerTitle.textContent = "🔴 S2 (Ollama) 服务未运行";
    s2BannerDesc.textContent = `${health.message}。\n💡 解决建议：${health.actionHint || "请在终端执行 'ollama serve'。"}`;
  } else if (health.status === "cors_blocked") {
    s2StatusBadge.className = "s2-badge s2-warn";
    s2StatusBadge.title = `S2 跨域受阻 (403 Forbidden)\n端点: ${health.endpoint}\n${health.message}\n(点击重新检测)`;
    s2StatusText.textContent = "S2: 跨域受阻 ⚠️";
    s2Banner.style.display = "flex";
    s2BannerTitle.textContent = "⚠️ S2 (Ollama) 跨域受阻 (403 Forbidden)";
    s2BannerDesc.textContent = `${health.message}。\n💡 解决建议：${health.actionHint || '终端执行 OLLAMA_ORIGINS="*" ollama serve'}`;
  } else if (health.status === "auth_error") {
    s2StatusBadge.className = "s2-badge s2-warn";
    s2StatusBadge.title = `S2 鉴权失败 (401)\n${health.message}\n(点击重新检测)`;
    s2StatusText.textContent = "S2: 鉴权失败 ⚠️";
    s2Banner.style.display = "flex";
    s2BannerTitle.textContent = "⚠️ S2 鉴权失败 (401 Unauthorized)";
    s2BannerDesc.textContent = `${health.message}。\n💡 解决建议：${health.actionHint || "请前往设置检查 API Key。"}`;
  } else {
    s2StatusBadge.className = "s2-badge s2-offline";
    s2StatusBadge.title = `S2 服务异常: ${health.message}\n(点击重新检测)`;
    s2StatusText.textContent = "S2: 异常 ⚠️";
    s2Banner.style.display = "flex";
    s2BannerTitle.textContent = "⚠️ S2 服务异常";
    s2BannerDesc.textContent = `${health.message}。\n💡 解决建议：${health.actionHint || "请检查模型设置。"}`;
  }
}

s2StatusBadge?.addEventListener("click", checkS2Status);
s2RetryBtn?.addEventListener("click", checkS2Status);
s2SettingsBtn?.addEventListener("click", openOptions);

saveWorkflowBtn?.addEventListener("click", () => {
  saveWorkflowBtn.textContent = "正在保存...";
  chrome.runtime.sendMessage({ type: "SAVE_LAST_WORKFLOW" }, (res) => {
    if (res && res.success) {
      saveWorkflowBtn.textContent = "已保存 ✓";
      loadMatchingWorkflows();
      setTimeout(() => {
        saveWorkflowBanner.style.display = "none";
        saveWorkflowBtn.textContent = "💾 保存为本地 Recipe";
      }, 2000);
    } else {
      alert(`保存失败: ${res?.message || "未知错误"}`);
      saveWorkflowBtn.textContent = "💾 保存为本地 Recipe";
    }
  });
});

const closeSidePanelBtn = document.getElementById("closeSidePanelBtn") as HTMLButtonElement;
const manageWorkflowsBtn = document.getElementById("manageWorkflowsBtn") as HTMLButtonElement;

closeSidePanelBtn?.addEventListener("click", () => {
  window.close();
});

manageWorkflowsBtn?.addEventListener("click", openOptions);

// Live Code Stepper elements
const codeStepperCard = document.getElementById("codeStepperCard") as HTMLElement;
const activeLineBadge = document.getElementById("activeLineBadge") as HTMLElement;
const toggleStepperCodeBtn = document.getElementById("toggleStepperCodeBtn") as HTMLButtonElement;
const codeStepperContent = document.getElementById("codeStepperContent") as HTMLElement;
const codeLinesContainer = document.getElementById("codeLinesContainer") as HTMLElement;

let currentStepperScript: string | null = null;
let currentHighlightedLine: number | null = null;

function renderStepperScript(script: string) {
  if (!script) return;
  if (currentStepperScript === script) return;
  currentStepperScript = script;
  codeLinesContainer.innerHTML = "";

  const lines = script.split("\n");
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const row = document.createElement("div");
    row.className = "code-line-row";
    row.id = `stepper-line-${lineNum}`;

    const numEl = document.createElement("span");
    numEl.className = "code-line-num";
    numEl.textContent = String(lineNum);

    const textEl = document.createElement("span");
    textEl.className = "code-line-text";
    textEl.textContent = line || " ";

    row.appendChild(numEl);
    row.appendChild(textEl);
    codeLinesContainer.appendChild(row);
  });

  codeStepperCard.style.display = "block";
}

function highlightStepperLine(lineNum: number) {
  if (!lineNum || lineNum < 1) return;
  if (currentHighlightedLine === lineNum) return;

  if (currentHighlightedLine) {
    const prev = document.getElementById(`stepper-line-${currentHighlightedLine}`);
    prev?.classList.remove("active-line");
  }

  currentHighlightedLine = lineNum;
  if (activeLineBadge) {
    activeLineBadge.textContent = `Line ${lineNum}`;
  }

  const curr = document.getElementById(`stepper-line-${lineNum}`);
  if (curr) {
    curr.classList.add("active-line");
    curr.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

toggleStepperCodeBtn?.addEventListener("click", () => {
  if (codeStepperContent.style.display === "none") {
    codeStepperContent.style.display = "block";
    toggleStepperCodeBtn.textContent = "收起 ⏶";
  } else {
    codeStepperContent.style.display = "none";
    toggleStepperCodeBtn.textContent = "展开 ⏷";
  }
});

function openOptions() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("src/options/index.html"));
  }
}

openOptionsBtn?.addEventListener("click", openOptions);
bannerSettingsBtn?.addEventListener("click", openOptions);

// Reactively listen for configuration changes saved from the Options page
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.jev_config) {
    const newConfig = changes.jev_config.newValue as any;
    if (newConfig) {
      cachedApiKey = (newConfig.typesafeApiKey || "").trim();
      apiKeyBanner.style.display = cachedApiKey ? "none" : "flex";
      checkS2Status();
    }
  }
});

// Load config & state
async function init() {
  const config = await loadConfig();
  cachedApiKey = (config.typesafeApiKey || "").trim();
  apiKeyBanner.style.display = cachedApiKey ? "none" : "flex";

  // Request current state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (response && response.status) {
      updateUIStatus(response.status);
      if (response.logs) {
        renderLogs(response.logs);
      }
      if (response.activeWorkflowScript) {
        renderStepperScript(response.activeWorkflowScript);
      }
      if (response.activeLine) {
        highlightStepperLine(response.activeLine);
      }
    }
  });

  // Load matching workflows for active tab
  loadMatchingWorkflows();

  // Actively check S2 / Ollama health status
  checkS2Status();
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
        item.style.background = "#f8fafc";
        item.style.border = "1px solid #e2e8f0";
        item.style.borderRadius = "8px";
        item.style.padding = "9px 12px";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.gap = "8px";
        item.style.boxShadow = "var(--shadow-xs)";

        item.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 12px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px;">
              <span>⚡ ${escapeHtml(wf.meta.name)}</span>
              <span style="font-size: 10px; color: #4338ca; background: #e0e7ff; padding: 1px 6px; border-radius: 9999px; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 500; border: 1px solid #c7d2fe;" title="匹配规则: ${escapeHtml(wf.meta.matchUrl || '*')}">${escapeHtml(wf.meta.matchUrl || "*")}</span>
            </div>
            <div style="font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">
              ${escapeHtml(wf.meta.description)}
            </div>
          </div>
          <button class="btn-primary run-wf-btn" data-id="${wf.id}" style="padding: 5px 10px; font-size: 11px; white-space: nowrap;">
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

// Control buttons
startBtn.addEventListener("click", () => {
  const prompt = taskPrompt.value.trim();
  if (!prompt) {
    alert("请输入任务描述");
    return;
  }
  if (!cachedApiKey) {
    alert("请先配置 TypeSafe API Key！已为您打开设置页面。");
    openOptions();
    return;
  }
  if (lastS2HealthStatus === "offline") {
    alert("无法启动自动化：本地 Ollama 服务处于离线状态！\n请先在系统终端执行 'ollama serve' 启动服务。");
    return;
  }
  if (lastS2HealthStatus === "cors_blocked") {
    alert("无法启动自动化：Ollama 拒绝跨域通信 (403 Forbidden)！\n请在终端执行 'OLLAMA_ORIGINS=\"*\" ollama serve' 启动。");
    return;
  }
  saveWorkflowBanner.style.display = "none";
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

const copyTraceBtn = document.getElementById("copyTraceBtn") as HTMLButtonElement;
copyTraceBtn?.addEventListener("click", () => {
  const items = document.querySelectorAll(".log-item");
  if (items.length === 0) {
    copyTraceBtn.textContent = "暂无日志";
    setTimeout(() => {
      copyTraceBtn.textContent = "📋 复制轨迹";
    }, 1200);
    return;
  }
  const chunks: string[] = [];
  items.forEach((item) => {
    const header = item.querySelector(".log-header")?.textContent?.trim() || "";
    const body = item.querySelector("div:last-child")?.textContent?.trim() || "";
    chunks.push(`${header}\n${body}`);
  });
  navigator.clipboard.writeText(chunks.join("\n\n")).then(() => {
    copyTraceBtn.textContent = "已复制 ✓";
    setTimeout(() => {
      copyTraceBtn.textContent = "📋 复制轨迹";
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
        <span class="log-confidence" style="color: ${log.confidence > 0.85 ? '#059669' : log.confidence > 0.65 ? '#d97706' : '#dc2626'}">
          Conf: ${confPercent}%
        </span>
      </div>
      <div style="font-weight: 600; color: #0f172a; margin-bottom: 2px;">${escapeHtml(log.subgoal)}</div>
      <div style="color: #475569;">${escapeHtml(log.message)}</div>
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
  if (message.type === "WORKFLOW_LINE_UPDATE") {
    if (message.script) {
      renderStepperScript(message.script);
    }
    if (message.line) {
      highlightStepperLine(message.line);
    }
  } else if (message.type === "AGENT_STATE_UPDATE") {
    updateUIStatus(message.status);
    if (message.currentStep !== undefined) {
      stepCounter.textContent = `Step: ${message.currentStep}`;
    }
    if (message.recentLogs) {
      renderLogs(message.recentLogs);
    }
    if (message.activeWorkflowScript) {
      renderStepperScript(message.activeWorkflowScript);
    }
    if (message.activeLine) {
      highlightStepperLine(message.activeLine);
    }
    if (message.status === "idle") {
      if (currentHighlightedLine) {
        const prev = document.getElementById(`stepper-line-${currentHighlightedLine}`);
        prev?.classList.remove("active-line");
        currentHighlightedLine = null;
      }
      if (activeLineBadge) activeLineBadge.textContent = "Line --";
    }
    if (message.canSaveWorkflow) {
      saveWorkflowBanner.style.display = "block";
      if (message.workflowName) {
        saveWorkflowDesc.textContent = `可保存为快捷 Recipe: "${message.workflowName}"`;
      }
    } else if (message.status === "running" || message.status === "planning") {
      saveWorkflowBanner.style.display = "none";
    }
  }
});
