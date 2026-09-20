import { AgentConfig } from "../shared/types.js";

export interface PlanStep {
  subgoal: string;
  typeText?: string;
  expectedOutcome?: string;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
}

export const PROVIDER_PRESETS: Record<
  string,
  { name: string; endpoint: string; defaultModel: string }
> = {
  none: {
    name: "无 (仅使用内置规则，零依赖冷启动)",
    endpoint: "",
    defaultModel: "",
  },
  deepseek: {
    name: "DeepSeek (deepseek-chat)",
    endpoint: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  openai: {
    name: "OpenAI (gpt-4o-mini)",
    endpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  gemini: {
    name: "Google Gemini (gemini-2.5-flash via OpenAI API)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
  },
  siliconflow: {
    name: "硅基流动 SiliconFlow (DeepSeek-V3)",
    endpoint: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
  },
  ollama: {
    name: "Ollama 本地大模型",
    endpoint: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
  },
  custom: {
    name: "自定义 OpenAI 兼容 API",
    endpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
};

export class TaskPlanner {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  updateConfig(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Decompose user prompt into structured subgoals and extracted entities (System Two)
   */
  async createPlan(prompt: string): Promise<TaskPlan> {
    // If S2 provider is configured, call generative LLM (OpenAI-compatible API)
    if (
      this.config.systemTwoProvider !== "none" &&
      (this.config.systemTwoApiKey || this.config.systemTwoProvider === "ollama")
    ) {
      try {
        return await this.callLLMPlanner(prompt);
      } catch (err) {
        console.warn(
          "[JevPilot] S2 LLM planner failed, falling back to heuristic parser:",
          err
        );
      }
    }

    // Heuristic Fallback (Zero external S2 LLM required!)
    return this.heuristicPlan(prompt);
  }

  /**
   * Rule-based entity and subgoal extractor for zero-dependency cold start
   */
  private heuristicPlan(prompt: string): TaskPlan {
    const trimmed = prompt.trim();
    let query = "";

    // Extract query from quotes: e.g. 搜索 "xxx" or 搜 'xxx'
    const quoteMatch = trimmed.match(/["'“‘](.+?)["'”’]/);
    if (quoteMatch) {
      query = quoteMatch[1];
    } else {
      // Extract from keywords like 搜索 / search / 查
      const searchMatch = trimmed.match(
        /(?:搜索|search|搜|查|find)\s*([^\s,，。]+)/i
      );
      if (searchMatch) {
        query = searchMatch[1];
      } else {
        query = trimmed;
      }
    }

    const steps: PlanStep[] = [
      {
        subgoal: `Find the search input box or primary form field and type "${query}"`,
        typeText: query,
        expectedOutcome: "Keyword typed into input field",
      },
      {
        subgoal: "Submit search query by pressing Enter or clicking search button",
        expectedOutcome: "Search results page loaded",
      },
      {
        subgoal: `Select and click the first primary result matching "${query}"`,
        expectedOutcome: "Target item/result opened",
      },
    ];

    return {
      goal: prompt,
      steps,
    };
  }

  /**
   * Generative S2 LLM planner using OpenAI-compatible Chat Completion endpoint
   */
  private async callLLMPlanner(prompt: string): Promise<TaskPlan> {
    const preset = PROVIDER_PRESETS[this.config.systemTwoProvider] || PROVIDER_PRESETS.custom;
    const endpoint = this.config.systemTwoEndpoint || preset.endpoint || "https://api.openai.com/v1";
    const model = this.config.systemTwoModel || preset.defaultModel || "gpt-4o-mini";
    const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;

    const systemPrompt = `You are a web automation planner. 
Break down the user's web task into 2 to 5 concrete sequential UI subgoals.
For any text entry steps, explicitly specify the string to type in 'typeText'.
Return strictly valid JSON with this format:
{
  "goal": "summarized goal",
  "steps": [
    {
      "subgoal": "clear instruction for System One element selector",
      "typeText": "optional text to type into input",
      "expectedOutcome": "what the page should look like after"
    }
  ]
}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.systemTwoApiKey) {
      headers["Authorization"] = `Bearer ${this.config.systemTwoApiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`S2 Planner API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    let content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from S2 Planner LLM");
    }

    // Clean markdown code fences if wrapped
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(content) as TaskPlan;
  }
}
