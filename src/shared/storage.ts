import { AgentConfig } from "./types.js";

const DEFAULT_CONFIG: AgentConfig = {
  typesafeApiKey: "",
  typesafeModel: "jev-latest",
  systemTwoProvider: "none",
  systemTwoApiKey: "",
  systemTwoEndpoint: "https://api.openai.com/v1",
  systemTwoModel: "gpt-4o-mini",
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
      if (result.jev_config) {
        resolve({ ...DEFAULT_CONFIG, ...result.jev_config });
      } else {
        resolve(DEFAULT_CONFIG);
      }
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
      const updated = { ...current, ...config };
      chrome.storage.local.set({ jev_config: updated }, () => {
        resolve();
      });
    });
  });
}
