import { loadConfig, saveConfig } from "../shared/storage.js";

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

let isPasswordVisible = false;

toggleApiKeyBtn.addEventListener("click", () => {
  isPasswordVisible = !isPasswordVisible;
  typesafeApiKey.type = isPasswordVisible ? "text" : "password";
  toggleApiKeyBtn.textContent = isPasswordVisible ? "🙈" : "👁️";
});

async function init() {
  const config = await loadConfig();
  typesafeApiKey.value = config.typesafeApiKey || "";
  typesafeModel.value = config.typesafeModel || "jev-latest";
  confidenceThreshold.value = String(config.confidenceThreshold || 0.7);

  systemTwoEndpoint.value = config.systemTwoEndpoint || "http://localhost:11434/v1";
  systemTwoModel.value = "deepseek-v4.1-flash:cloud";
}

init();

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
