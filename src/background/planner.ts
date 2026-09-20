import { AgentConfig } from "../shared/types.js";

export interface PlanStep {
  subgoal: string;
  typeText?: string;
  expectedOutcome?: string;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  warning?: string;
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
   * Decompose user prompt into structured subgoals and extracted entities
   */
  async createPlan(prompt: string): Promise<TaskPlan> {
    let warning: string | undefined;

    // If S2 provider is configured, call generative LLM (OpenAI-compatible API)
    if (
      this.config.systemTwoProvider !== "none" &&
      (this.config.systemTwoApiKey || this.config.systemTwoProvider === "ollama")
    ) {
      try {
        const plan = await this.callLLMPlanner(prompt);
        if (plan && plan.steps && plan.steps.length > 0) {
          return plan;
        }
      } catch (err: any) {
        warning = `S2 规划模型 (${this.config.systemTwoProvider}: ${this.config.systemTwoModel || "default"}) 调用失败: ${err.message}。已自动启用内置智能意图解析器。`;
        console.warn("[JevPilot]", warning);
      }
    }

    // Smart semantic workflow intent parser
    return this.heuristicPlan(prompt, warning);
  }

  /**
   * Rule-based entity and workflow subgoal extractor supporting enterprise approvals, forms, and actions
   */
  private heuristicPlan(prompt: string, warning?: string): TaskPlan {
    const trimmed = prompt.trim();
    const steps: PlanStep[] = [];

    // Check if prompt is a pure search task
    const isPureSearch = /^(?:搜索|search|查一下|查找|在.+搜索)\s*([^,，]+)$/i.test(trimmed);

    if (isPureSearch) {
      let query = trimmed.replace(/^(?:搜索|search|查一下|查找)\s*/i, "").trim();
      const quoteMatch = query.match(/["'“‘](.+?)["'”’]/);
      if (quoteMatch) query = quoteMatch[1];

      steps.push(
        {
          subgoal: `找到搜索框或主输入框，输入关键词 "${query}"`,
          typeText: query,
          expectedOutcome: "关键词已填入输入框",
        },
        {
          subgoal: "点击【查询】或【搜索】按钮提交",
          expectedOutcome: "搜索结果已加载",
        },
        {
          subgoal: `在搜索结果中找到并点击最相关的一项`,
          expectedOutcome: "打开详情页",
        }
      );
    } else {
      // Split clauses by punctuation or connectors: e.g. "对预售合同进行处理操作，审批同意"
      const clauses = trimmed
        .split(/[,，;；\n]|并且|并|然后|接着/)
        .map((c) => c.trim())
        .filter(Boolean);

      for (const clause of clauses) {
        if (/(?:处理|办理)/.test(clause)) {
          const objMatch = clause.match(/对?(.+?)进行?处理/);
          const targetObj = objMatch ? objMatch[1].trim() : "";
          const targetDesc = targetObj ? `对应"${targetObj}"的` : "";
          steps.push({
            subgoal: `找到列表中${targetDesc}【处理】操作按钮或链接并点击`,
            expectedOutcome: "打开处理或审批窗口",
          });
        } else if (/(?:同意|通过|审批通过|核准)/.test(clause)) {
          steps.push({
            subgoal: "在弹出的处理窗口或审批表单中找到并点击【同意】或【通过】确认按钮",
            expectedOutcome: "审批同意操作完成",
          });
        } else if (/(?:驳回|拒绝|不通过)/.test(clause)) {
          steps.push({
            subgoal: "在弹窗或详情页中找到并点击【驳回】或【拒绝】按钮",
            expectedOutcome: "审批驳回操作完成",
          });
        } else if (/(?:查询|搜索|检索)/.test(clause)) {
          steps.push({
            subgoal: "找到并点击【查询】或【搜索】按钮",
            expectedOutcome: "列表已更新",
          });
        } else if (/(?:重置|清空)/.test(clause)) {
          steps.push({
            subgoal: "找到并点击【重置】按钮",
            expectedOutcome: "筛选项已重置",
          });
        } else if (/(?:新建|创建|新增)/.test(clause)) {
          steps.push({
            subgoal: "找到并点击【新建】或【新增】按钮",
            expectedOutcome: "进入新建页面或弹窗",
          });
        } else if (/(?:保存|提交|确定|确认)/.test(clause)) {
          steps.push({
            subgoal: "找到并点击【保存】或【提交】按钮",
            expectedOutcome: "表单已保存提交",
          });
        } else if (/点击\s*["'“‘【\[](.+?)["'”’】\]]/.test(clause)) {
          const btnName = clause.match(/点击\s*["'“‘【\[](.+?)["'”’】\]]/)![1];
          steps.push({
            subgoal: `找到并点击【${btnName}】按钮或链接`,
            expectedOutcome: `成功点击${btnName}`,
          });
        } else {
          // General semantic fallback step
          steps.push({
            subgoal: `根据指令"${clause}"，找到页面上最相关的操作按钮或目标元素并执行`,
            expectedOutcome: "执行对应操作",
          });
        }
      }
    }

    if (steps.length === 0) {
      steps.push({
        subgoal: `根据用户任务"${trimmed}"，在当前页面找到最匹配的操作按钮或交互项并执行`,
        expectedOutcome: "完成当前操作",
      });
    }

    return {
      goal: prompt,
      steps,
      warning,
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

    const systemPrompt = `You are an expert web automation planner. 
Break down the user's web task into 1 to 4 concrete sequential UI subgoals.
For each subgoal:
- If clicking an action button (e.g. "处理", "审批", "同意", "查询"), describe the exact button name to find and click.
- If entering text, explicitly set 'typeText'.
Return strictly valid JSON with this format:
{
  "goal": "summarized goal",
  "steps": [
    {
      "subgoal": "clear instruction for System One element selector (e.g. 找到列表中预售合同对应的【处理】按钮并点击)",
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
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    let content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from S2 Planner LLM");
    }

    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(content) as TaskPlan;
  }
}
