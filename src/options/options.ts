import { loadConfig, saveConfig } from "../shared/storage.js";
import {
  WorkflowRegistry,
  matchUrlRule,
  compileScriptToFunction,
} from "../workflows/workflow-registry.js";
import { WorkflowDefinition } from "../workflows/types.js";

// DOM Elements - Settings
const typesafeApiKey = document.getElementById("typesafeApiKey") as HTMLInputElement;
const toggleApiKeyBtn = document.getElementById("toggleApiKeyBtn") as HTMLButtonElement;
const typesafeModel = document.getElementById("typesafeModel") as HTMLSelectElement;
const confidenceThreshold = document.getElementById("confidenceThreshold") as HTMLInputElement;

const systemTwoEndpoint = document.getElementById("systemTwoEndpoint") as HTMLInputElement;
const systemTwoModel = document.getElementById("systemTwoModel") as HTMLInputElement;
const testOllamaBtn = document.getElementById("testOllamaBtn") as HTMLButtonElement;
const ollamaFeedback = document.getElementById("ollamaFeedback") as HTMLElement;

const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;

// DOM Elements - Workflow Manager
const workflowCountTitle = document.getElementById("workflowCountTitle") as HTMLElement;
const addNewWorkflowBtn = document.getElementById("addNewWorkflowBtn") as HTMLButtonElement;
const workflowsContainer = document.getElementById("workflowsContainer") as HTMLElement;
const testUrlInput = document.getElementById("testUrlInput") as HTMLInputElement;
const testUrlBtn = document.getElementById("testUrlBtn") as HTMLButtonElement;
const testUrlResult = document.getElementById("testUrlResult") as HTMLElement;

let isPasswordVisible = false;
let currentWorkflows: WorkflowDefinition[] = [];

toggleApiKeyBtn.addEventListener("click", () => {
  isPasswordVisible = !isPasswordVisible;
  typesafeApiKey.type = isPasswordVisible ? "text" : "password";
  toggleApiKeyBtn.textContent = isPasswordVisible ? "🙈" : "👁️";
});

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function init() {
  // Load configuration
  const config = await loadConfig();
  typesafeApiKey.value = config.typesafeApiKey || "";
  typesafeModel.value = config.typesafeModel || "jev-latest";
  confidenceThreshold.value = String(config.confidenceThreshold || 0.7);

  systemTwoEndpoint.value = config.systemTwoEndpoint || "http://localhost:11434/v1";
  systemTwoModel.value = "deepseek-v4.1-flash:cloud";

  // Load Workflows
  await loadWorkflows();
}

init();

// ==================== WORKFLOW MANAGER ====================

async function loadWorkflows() {
  try {
    const res: any = await chrome.runtime.sendMessage({ type: "GET_ALL_WORKFLOWS" });
    if (res && res.workflows) {
      currentWorkflows = res.workflows;
    } else {
      currentWorkflows = await WorkflowRegistry.getAllWorkflows();
    }
  } catch {
    currentWorkflows = await WorkflowRegistry.getAllWorkflows();
  }

  renderWorkflowList();
}

function renderWorkflowList() {
  workflowCountTitle.textContent = `已配置工作流列表 (共 ${currentWorkflows.length} 个)`;
  workflowsContainer.innerHTML = "";

  if (currentWorkflows.length === 0) {
    workflowsContainer.innerHTML = `
      <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 24px; background: #0b1120; border-radius: 8px; border: 1px dashed #1e293b;">
        暂无任何工作流 Recipe，点击上方【➕ 新建自定义工作流】即可快速创建。
      </div>
    `;
    return;
  }

  currentWorkflows.forEach((wf) => {
    const card = document.createElement("div");
    card.className = "wf-card";
    card.id = `card_${wf.id}`;
    const matchRule = wf.meta.matchUrl || "*";

    card.innerHTML = `
      <div class="wf-card-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; font-size: 13px; color: #f8fafc;">${escapeHtml(wf.meta.name)}</span>
          <span class="tag-custom">动态 Recipe</span>
        </div>
        <div style="font-size: 11px; color: #64748b; font-family: monospace;">ID: ${escapeHtml(wf.id)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>工作流名称 (Name):</label>
          <input type="text" class="wf-name-input" value="${escapeHtml(wf.meta.name)}" />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>适用页面规则 (Match Rule): <span class="label-hint">(* 全部, /正则/, 域名)</span></label>
          <input type="text" class="wf-match-input" value="${escapeHtml(matchRule)}" placeholder="*" />
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <label>功能描述 (Description):</label>
        <input type="text" class="wf-desc-input" value="${escapeHtml(wf.meta.description || "")}" placeholder="工作流用途简述..." />
      </div>

      <div class="form-group" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="margin-bottom: 0;">JavaScript 异步执行函数 (Workflow Function):</label>
          <button type="button" class="btn-secondary toggle-code-btn" style="padding: 2px 8px; font-size: 11px;">收起/展开代码 ⏷</button>
        </div>
        <textarea class="code-textarea wf-script-input" spellcheck="false">${escapeHtml(wf.script || "")}</textarea>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div class="wf-save-status" style="font-size: 11px; color: var(--success); font-weight: 500;"></div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-secondary copy-code-btn" style="font-size: 11px; padding: 5px 10px;">📋 复制代码</button>
          <button type="button" class="btn-secondary delete-wf-btn" style="font-size: 11px; padding: 5px 10px; color: #fca5a5; border-color: #7f1d1d;">🗑️ 删除</button>
          <button type="button" class="btn-save save-wf-btn" style="font-size: 11px; padding: 5px 12px;">💾 保存修改</button>
        </div>
      </div>
    `;

    // Code toggle
    const toggleCodeBtn = card.querySelector(".toggle-code-btn") as HTMLButtonElement;
    const scriptInput = card.querySelector(".wf-script-input") as HTMLTextAreaElement;
    toggleCodeBtn.addEventListener("click", () => {
      if (scriptInput.style.display === "none") {
        scriptInput.style.display = "block";
        toggleCodeBtn.textContent = "收起代码 ⏶";
      } else {
        scriptInput.style.display = "none";
        toggleCodeBtn.textContent = "展开代码 ⏷";
      }
    });

    // Copy script
    const copyCodeBtn = card.querySelector(".copy-code-btn") as HTMLButtonElement;
    copyCodeBtn.addEventListener("click", () => {
      const code = scriptInput.value;
      navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.textContent = "已复制 ✓";
        setTimeout(() => {
          copyCodeBtn.textContent = "📋 复制代码";
        }, 1500);
      });
    });

    // Save custom workflow
    const saveWfBtn = card.querySelector(".save-wf-btn") as HTMLButtonElement;
    const deleteWfBtn = card.querySelector(".delete-wf-btn") as HTMLButtonElement;
    const nameInput = card.querySelector(".wf-name-input") as HTMLInputElement;
    const matchInput = card.querySelector(".wf-match-input") as HTMLInputElement;
    const descInput = card.querySelector(".wf-desc-input") as HTMLInputElement;
    const statusEl = card.querySelector(".wf-save-status") as HTMLElement;

    saveWfBtn?.addEventListener("click", async () => {
      const newScript = scriptInput.value.trim();
      const newName = nameInput.value.trim() || wf.meta.name;
      const newMatch = matchInput.value.trim() || "*";
      const newDesc = descInput.value.trim() || wf.meta.description;

      // Validate JS function syntax
      try {
        compileScriptToFunction(newScript);
      } catch (syntaxErr: any) {
        alert(`JavaScript 语法错误，无法编译:\n${syntaxErr.message}`);
        return;
      }

      saveWfBtn.textContent = "正在保存...";
      const updatedMeta = {
        ...wf.meta,
        name: newName,
        matchUrl: newMatch,
        description: newDesc,
      };

      const res = await saveWorkflowToBackend(wf.id, updatedMeta, newScript);
      if (res && res.success) {
        saveWfBtn.textContent = "💾 保存修改";
        statusEl.textContent = "✅ 工作流修改已成功保存！";
        setTimeout(() => {
          statusEl.textContent = "";
        }, 2500);
      } else {
        saveWfBtn.textContent = "💾 保存修改";
        alert(`保存失败: ${res?.error || "未知错误"}`);
      }
    });

    // Delete custom workflow
    deleteWfBtn?.addEventListener("click", async () => {
      if (!confirm(`确定要永久删除工作流 [${wf.meta.name}] 吗？`)) {
        return;
      }
      await deleteWorkflowFromBackend(wf.id);
      await loadWorkflows();
    });

    workflowsContainer.appendChild(card);
  });
}

// Add new custom workflow
addNewWorkflowBtn.addEventListener("click", async () => {
  const newId = `custom_${Date.now()}`;
  const defaultScript = `async function run(ctx) {
  const { jev, getPage, phase, log, wait, scroll, args } = ctx;
  log("🚀 启动动态工作流...");

  // 实时条件循环模式 (动态检查页面元素，处理完自然退出，不依赖死板计数)
  while (true) {
    phase("实时检测页面项");
    const page = await getPage();

    // 1. 实时检测当前页是否还有待处理的目标按钮
    const target = page.elements.find(e => e.text.includes("处理") && e.isClickable);

    if (!target) {
      // 检查是否有下一页翻页
      const nextPage = page.elements.find(e => e.text.includes("下一页") && e.isClickable && !e.selector.includes("disabled"));
      if (nextPage) {
        log("当前页已无待办，翻至下一页...");
        await jev("点击【下一页】");
        await wait(1800);
        continue;
      }
      log("🎉 实时检测完成：当前已无更多待办项，任务顺利完成！");
      break;
    }

    // 2. 调用 TypeSafe Jev 执行高精度微操作
    log(\`发现待办项 "\${target.text}"，正在处理...\`);
    await jev("点击【处理】按钮");
    await wait(1500);

    // 3. 弹窗二次确认守卫
    const after = await getPage();
    if (after.activeModal?.isOpen) {
      await jev("在确认弹窗中点击【确定】按钮");
      await wait(1000);
    }
  }

  return { success: true };
}`;

  const newMeta = {
    name: "新自定义工作流",
    description: "实时检测页面状态的动态工作流 Recipe",
    matchUrl: "*",
  };

  await saveWorkflowToBackend(newId, newMeta, defaultScript);
  await loadWorkflows();

  const newCard = document.getElementById(`card_${newId}`);
  if (newCard) {
    newCard.scrollIntoView({ behavior: "smooth", block: "center" });
    const nameInput = newCard.querySelector(".wf-name-input") as HTMLInputElement;
    nameInput?.focus();
    nameInput?.select();
  }
});

// URL Match Rule Tester
function runUrlTest() {
  const url = testUrlInput.value.trim();
  if (!url) {
    testUrlResult.style.display = "none";
    return;
  }

  const matched = currentWorkflows.filter((wf) =>
    matchUrlRule(url, wf.meta.matchUrl)
  );

  testUrlResult.style.display = "block";
  if (matched.length > 0) {
    testUrlResult.innerHTML = `
      🟢 <strong>匹配成功！</strong> 网址 <code>${escapeHtml(url)}</code> 共命中 <strong>${matched.length}</strong> 个工作流：<br>
      <span style="color: #cbd5e1; margin-top: 4px; display: inline-block;">
        ${matched.map((m) => `• <strong>${escapeHtml(m.meta.name)}</strong> (规则: <code>${escapeHtml(m.meta.matchUrl || "*")}</code>)`).join("<br>")}
      </span>
    `;
  } else {
    testUrlResult.innerHTML = `
      🟡 <strong>未命中任何工作流。</strong> 网址 <code>${escapeHtml(url)}</code> 当前没有匹配的 Recipe。<br>
      <span style="color: #94a3b8;">提示：可将目标工作流的匹配规则配置为 <code>*</code>（全局），或者包含该网址的域名路径。</span>
    `;
  }
}

testUrlBtn.addEventListener("click", runUrlTest);
testUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runUrlTest();
  }
});

async function saveWorkflowToBackend(id: string, meta: any, script: string) {
  try {
    return await chrome.runtime.sendMessage({
      type: "SAVE_WORKFLOW",
      id,
      meta,
      script,
    });
  } catch {
    await WorkflowRegistry.saveWorkflow(id, meta, script);
    return { success: true };
  }
}

async function deleteWorkflowFromBackend(id: string) {
  try {
    return await chrome.runtime.sendMessage({
      type: "DELETE_WORKFLOW",
      id,
    });
  } catch {
    return await WorkflowRegistry.deleteWorkflow(id);
  }
}

// ==================== SETTINGS (OLLAMA & CREDENTIALS) ====================

// Test Ollama connection
testOllamaBtn.addEventListener("click", async () => {
  ollamaFeedback.style.display = "block";
  ollamaFeedback.className = "test-feedback";
  ollamaFeedback.textContent = "正在测试连接到 Ollama 服务...";

  const endpoint = (systemTwoEndpoint.value || "http://localhost:11434/v1").replace(/\/+$/, "");
  const testUrl = `${endpoint}/models`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(testUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = Array.isArray(data.data) ? data.data.map((m: any) => m.id) : [];
      const hasDeepseek = models.some((m: string) => m.includes("deepseek"));
      ollamaFeedback.className = "test-feedback feedback-ok";
      ollamaFeedback.textContent = hasDeepseek
        ? `🟢 Ollama 运行正常，已检测到 DeepSeek 模型！(总计 ${models.length} 个模型)`
        : `🟢 Ollama 运行正常，响应成功。(服务在线，模型列表已读取)`;
    } else {
      ollamaFeedback.className = "test-feedback feedback-warn";
      ollamaFeedback.textContent = `🟡 Ollama 响应 HTTP ${res.status}。若离线将自动平滑降级至内置智能规则规划器。`;
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    ollamaFeedback.className = "test-feedback feedback-warn";
    ollamaFeedback.textContent = `🟡 无法连接到 ${endpoint} (${err.message})。若未开启 Ollama 服务，系统将自动使用内置智能规则规划器，零依赖正常运行。`;
  }
});

// Save configuration
saveBtn.addEventListener("click", async () => {
  const thresh = parseFloat(confidenceThreshold.value) || 0.7;

  await saveConfig({
    typesafeApiKey: typesafeApiKey.value.trim(),
    typesafeModel: typesafeModel.value,
    confidenceThreshold: Math.max(0.1, Math.min(1.0, thresh)),
    systemTwoProvider: "ollama",
    systemTwoEndpoint: systemTwoEndpoint.value.trim() || "http://localhost:11434/v1",
    systemTwoModel: "deepseek-v4.1-flash:cloud",
    antiBotMode: true,
  });

  status.textContent = "✅ 配置已成功保存！";
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
});

// Reset defaults
resetBtn.addEventListener("click", () => {
  typesafeModel.value = "jev-latest";
  confidenceThreshold.value = "0.70";
  systemTwoEndpoint.value = "http://localhost:11434/v1";
  systemTwoModel.value = "deepseek-v4.1-flash:cloud";
  ollamaFeedback.style.display = "none";
});
