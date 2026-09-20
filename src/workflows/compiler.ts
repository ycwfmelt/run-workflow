import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { AgentConfig, PageState } from "../shared/types.js";
import { TraceStep } from "../shared/trace.js";
import { WorkflowDefinition } from "./types.js";
import { compileScriptToFunction } from "./workflow-registry.js";

const S2_TRACE_SYNTHESIS_SYSTEM_PROMPT = `You are System Two (S2), the cognitive AI reasoning engine and Dynamic Workflow Synthesizer.
You are given a user automation task and the ACTUAL SEQUENCE of browser state transitions (S_0 -> S_1 -> S_2 ...) verified and recorded by S2 Supervisor during live browser exploration.

Each phase in the compiled Dynamic Workflow corresponds to one discrete state machine transition (S_{k-1} -> S_k).
The runtime automatically snapshots a Phase Checkpoint at the entry of each ctx.phase("..."). If runtime errors, unexpected popups, or path divergences occur, Jev will autonomously intervene, rollback to the phase checkpoint if needed, perform self-healing, and resume subsequent phases!

### Runtime Environment Primitives (available on ctx):
- ctx.phase(title: string): Declares the current state machine phase, updates the Sidepanel live timeline, and captures a state checkpoint for automated rollback/resume.
- await ctx.jev(subgoal: string): Drives S1 to visually locate the target element and execute CDP click/input. Use clear, concise instructions (e.g. await ctx.jev("点击【领取今日的登录奖励】")).
- await ctx.successCheck(criteria: string | { url?: string; text?: string; selector?: string; disappeared?: string }, options?: { timeout?: number; pollInterval?: number; autoHeal?: boolean }):
  First-class state verification guard with fast-exit adaptive polling.
  Dynamic workflows MUST use successCheck after actions to verify state transitions (S_{k-1} -> S_k)!
  If the condition is not met, the runtime automatically invokes Jev self-healing (evaluates divergence, rolls back to checkpoint if URL drifted, and executes corrective action) before resuming!
  Choose the most deterministic criteria observed in the trace:
  * If the step caused a page navigation or route change: use { url: "/target/path" }
  * If the step caused a success message/status to appear: use { text: "success text" }
  * If the step consumed or closed a button/modal: use { disappeared: "button text or selector" }
  * If verifying overall semantic completion: use await ctx.successCheck("goal description")
- await ctx.rollback(targetCheckpoint?): Explicitly rolls back browser navigation to the phase checkpoint.
- await ctx.heal(subgoal?): Explicitly invokes Jev autonomous self-healing on current DOM state.
- ctx.log(message: string): Emits a user-facing log message.
- await ctx.wait(ms: number): Pause if necessary.
- await ctx.getPage(): Retrieves current page state.

### Synthesis Requirements:
1. Synthesize a clean, idiomatic JavaScript async function body.
2. For each verified transition in the trace:
   - Emit a meaningful ctx.phase("...") representing the state transition
   - Call await ctx.jev("...") to perform the action
   - Immediately follow with an appropriate await ctx.successCheck(...) guard tailored to the observed state transition!
3. Output strictly valid JSON conforming to the schema (name, description, phases, script).
`;

const WorkflowZodSchema = z.object({
  name: z.string().describe("Short snake_case identifier, e.g. v2ex_daily_reward"),
  description: z.string().describe("Concise Chinese summary of what the workflow does"),
  phases: z.array(z.string()).describe("Sequential phase titles"),
  script: z.string().describe("Executable JavaScript function code body for async (ctx) => { ... }"),
});

export class WorkflowCompiler {
  /**
   * S2 Workflow Synthesis:
   * Compiles verified execution transitions into a reproducible Dynamic Workflow Recipe.
   */
  static async synthesizeFromTrace(
    prompt: string,
    transitions: TraceStep[],
    config: AgentConfig
  ): Promise<WorkflowDefinition> {
    const cleanPrompt = prompt.trim();
    const endpoint = (config.systemTwoEndpoint || "http://localhost:11434/v1").replace(/\/+$/, "");
    const modelName = config.systemTwoModel || "deepseek-v4.1-flash:cloud";
    const apiKey = config.systemTwoApiKey || config.typesafeApiKey || "ollama";

    const tracePrompt = `
【用户任务目标】: ${cleanPrompt}

【S2 Supervisor 实机探索记录的真实状态转移轨迹】:
${transitions
  .map(
    (t, idx) => `
步骤 ${t.step || idx + 1}:
- 动作意图: ${t.intent}
- 起始状态: URL "${t.before.url}" (${t.before.title})
- 执行动作: ${t.action.type} ${t.action.elementDescription || ""} ${t.action.text ? `输入文本: "${t.action.text}"` : ""}
- 转移后状态: URL "${t.after.url}" (${t.after.title})
- 推荐守卫条件: ${t.guard ? JSON.stringify(t.guard) : "由模型根据前后状态差异自行选配"}
- 观测到的状态差异: ${t.stateDelta || "页面状态就地更新"}
`
  )
  .join("\n")}
`;

    // 1. Attempt AI SDK structured generation with S2 LLM
    try {
      const s2Client = createOpenAI({ baseURL: endpoint, apiKey });

      const { object } = await generateObject({
        model: s2Client.chat(modelName),
        schema: WorkflowZodSchema,
        system: S2_TRACE_SYNTHESIS_SYSTEM_PROMPT,
        prompt: tracePrompt,
        temperature: 0.1,
      });

      if (object && object.script) {
        return {
          id: `workflow_${Date.now()}`,
          meta: {
            name: object.name || `recipe_${Date.now()}`,
            description: object.description || cleanPrompt,
            matchUrl: new URL(transitions[0]?.before.url || "http://localhost").hostname,
            phases: object.phases || transitions.map((t) => t.intent),
          },
          script: object.script,
          fn: compileScriptToFunction(object.script),
          isBuiltIn: false,
          createdAt: Date.now(),
        };
      }
    } catch (llmErr: any) {
      console.warn("[Ang] S2 LLM generateObject notice, trying generateText:", llmErr.message);

      try {
        const s2Client = createOpenAI({ baseURL: endpoint, apiKey });
        const { text } = await generateText({
          model: s2Client.chat(modelName),
          system: `${S2_TRACE_SYNTHESIS_SYSTEM_PROMPT}\nReturn ONLY the pure JavaScript code body inside \`\`\`javascript ... \`\`\` code fence.`,
          prompt: tracePrompt,
          temperature: 0.1,
        });

        const match = text.match(/```(?:javascript|js)?\s*([\s\S]+?)```/i);
        const scriptCode = match ? match[1].trim() : text.trim();

        if (scriptCode && scriptCode.includes("ctx.jev")) {
          return {
            id: `workflow_${Date.now()}`,
            meta: {
              name: `recipe_${Date.now()}`,
              description: cleanPrompt,
              matchUrl: new URL(transitions[0]?.before.url || "http://localhost").hostname,
              phases: transitions.map((t) => t.intent),
            },
            script: scriptCode,
            fn: compileScriptToFunction(scriptCode),
            isBuiltIn: false,
            createdAt: Date.now(),
          };
        }
      } catch (textErr: any) {
        console.warn("[Ang] S2 LLM generateText fallback notice:", textErr.message);
      }
    }

    // 2. Deterministic Trace-to-Code mapping (Zero guesswork, zero fake business templates)
    return this.printTraceToWorkflow(cleanPrompt, transitions);
  }

  /**
   * Deterministic printer: Transcribes real Trace directly into JavaScript code body.
   * Pure, unopinionated projection of observed steps without guessing.
   */
  private static printTraceToWorkflow(
    prompt: string,
    transitions: TraceStep[]
  ): WorkflowDefinition {
    const lines: string[] = [
      `const { jev, successCheck, phase, log } = ctx;`,
      ``,
      `log(${JSON.stringify(`🚀 启动自动化工作流: ${prompt}`)});`,
      ``,
    ];

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      lines.push(`phase(${JSON.stringify(t.intent)});`);
      lines.push(`log(${JSON.stringify(`正在执行: ${t.intent}...`)});`);
      lines.push(`await jev(${JSON.stringify(t.intent)});`);

      if (t.guard) {
        lines.push(`await successCheck(${JSON.stringify(t.guard)}, { timeout: 3500 });`);
      } else if (t.after.url !== t.before.url) {
        try {
          const parsed = new URL(t.after.url);
          lines.push(`await successCheck({ url: ${JSON.stringify(parsed.pathname)} }, { timeout: 3500 });`);
        } catch {
          lines.push(`await successCheck({ url: ${JSON.stringify(t.after.url)} }, { timeout: 3500 });`);
        }
      } else {
        lines.push(`await successCheck(${JSON.stringify(prompt)}, { timeout: 2500 });`);
      }
      lines.push(``);
    }

    lines.push(`log(${JSON.stringify("🎉 工作流全部步骤执行完毕，目标已圆满达成！")});`);
    const script = lines.join("\n");

    return {
      id: `workflow_${Date.now()}`,
      meta: {
        name: `recipe_${Date.now()}`,
        description: prompt,
        matchUrl: new URL(transitions[0]?.before.url || "http://localhost").hostname,
        phases: transitions.map((t) => t.intent),
      },
      script,
      fn: compileScriptToFunction(script),
      isBuiltIn: false,
      createdAt: Date.now(),
    };
  }
}
