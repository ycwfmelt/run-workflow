import { AgentConfig } from "./types.js";

const DEFAULT_CONFIG: AgentConfig = {
  typesafeApiKey: "",
  typesafeModel: "jev-latest",
  systemTwoProvider: "ollama",
  systemTwoApiKey: "",
  systemTwoEndpoint: "http://localhost:11434/v1",
  systemTwoModel: "deepseek-v4.1-flash:cloud",
  antiBotMode: true,
  confidenceThreshold: 0.7,
  maxSteps: 25,
};

export async function loadConfig(): Promise<AgentConfig> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage) {
      resolve(DEFAULT_CONFIG);
      return;
    }
    chrome.storage.local.get(["jev_config"], (result) => {
      const stored = (result.jev_config || {}) as Partial<AgentConfig>;
      resolve({
        ...DEFAULT_CONFIG,
        ...stored,
        // Anti-bot mode is permanently enabled (CDP hardware emulation)
        antiBotMode: true,
        // Default S2 is fixed to Ollama + deepseek-v4.1-flash:cloud
        systemTwoProvider: stored.systemTwoProvider || "ollama",
        systemTwoEndpoint: stored.systemTwoEndpoint || "http://localhost:11434/v1",
        systemTwoModel: stored.systemTwoModel || "deepseek-v4.1-flash:cloud",
      });
    });
  });
}

export async function saveConfig(config: Partial<AgentConfig>): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage) {
      resolve();
      return;
    }
    loadConfig().then((current) => {
      const updated = { ...current, ...config, antiBotMode: true };
      chrome.storage.local.set({ jev_config: updated }, () => {
        resolve();
      });
    });
  });
}
