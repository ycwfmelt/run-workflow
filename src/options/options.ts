import { loadConfig, saveConfig } from "../shared/storage.js";

const typesafeApiKey = document.getElementById("typesafeApiKey") as HTMLInputElement;
const typesafeModel = document.getElementById("typesafeModel") as HTMLSelectElement;
const confidenceThreshold = document.getElementById("confidenceThreshold") as HTMLInputElement;

const systemTwoProvider = document.getElementById("systemTwoProvider") as HTMLSelectElement;
const systemTwoEndpoint = document.getElementById("systemTwoEndpoint") as HTMLInputElement;
const systemTwoApiKey = document.getElementById("systemTwoApiKey") as HTMLInputElement;
const systemTwoModel = document.getElementById("systemTwoModel") as HTMLInputElement;

const antiBotMode = document.getElementById("antiBotMode") as HTMLInputElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;

async function init() {
  const config = await loadConfig();
  typesafeApiKey.value = config.typesafeApiKey || "";
  typesafeModel.value = config.typesafeModel || "jev-latest";
  confidenceThreshold.value = String(config.confidenceThreshold || 0.7);

  systemTwoProvider.value = config.systemTwoProvider || "none";
  systemTwoEndpoint.value = config.systemTwoEndpoint || "https://api.openai.com/v1";
  systemTwoApiKey.value = config.systemTwoApiKey || "";
  systemTwoModel.value = config.systemTwoModel || "gpt-4o-mini";

  antiBotMode.checked = config.antiBotMode !== false;
}

init();

saveBtn.addEventListener("click", async () => {
  const thresh = parseFloat(confidenceThreshold.value) || 0.7;

  await saveConfig({
    typesafeApiKey: typesafeApiKey.value.trim(),
    typesafeModel: typesafeModel.value,
    confidenceThreshold: Math.max(0.1, Math.min(1.0, thresh)),
    systemTwoProvider: systemTwoProvider.value as any,
    systemTwoEndpoint: systemTwoEndpoint.value.trim(),
    systemTwoApiKey: systemTwoApiKey.value.trim(),
    systemTwoModel: systemTwoModel.value.trim(),
    antiBotMode: antiBotMode.checked,
  });

  status.textContent = "设置已成功保存！";
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
});
