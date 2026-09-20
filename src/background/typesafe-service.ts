import { InteractiveElement, PageState } from "../shared/types.js";

export interface JevDecision {
  targetElementId: string;
  actionType: "click" | "type" | "scroll" | "finish" | "none";
  confidence: number;
  probabilities: Record<string, number>;
  isGoalReached: boolean;
  goalProbability: number;
  isBlockedByCaptcha: boolean;
  captchaProbability: number;
  reasoningNote?: string;
}

export class TypeSafeService {
  private apiKey: string;
  private model: string;
  private endpoint: string = "https://api.typesafe.ai/v1/systemone";

  constructor(apiKey: string, model: string = "jev-latest") {
    this.apiKey = apiKey;
    this.model = model;
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  setModel(model: string) {
    this.model = model;
  }

  /**
   * Evaluate page state and candidate elements using Jev System One
   */
  async decideNextAction(
    taskGoal: string,
    currentSubgoal: string,
    pageState: PageState,
    candidateElements: InteractiveElement[]
  ): Promise<JevDecision> {
    if (!this.apiKey) {
      throw new Error("TypeSafe API Key is not configured. Please set it in Settings.");
    }

    // Build structured state
    const simplifiedElements = candidateElements.map((el) => ({
      id: el.id,
      tag: el.tag,
      role: el.role,
      text: el.text || undefined,
      placeholder: el.placeholder || undefined,
      aria_label: el.ariaLabel || undefined,
      type: el.type || undefined,
      is_input: el.isInput,
    }));

    const state = {
      task: {
        overall_goal: taskGoal,
        current_subgoal: currentSubgoal,
      },
      page: {
        title: pageState.title,
        url: pageState.url,
      },
      interactive_elements: simplifiedElements,
    };

    // Construct criteria for candidate elements
    const elementCriteria: Record<string, { what: string }> = {};
    simplifiedElements.forEach((el) => {
      const desc = [
        el.tag,
        el.role !== el.tag ? `role: ${el.role}` : null,
        el.text ? `text: "${el.text}"` : null,
        el.placeholder ? `placeholder: "${el.placeholder}"` : null,
        el.aria_label ? `aria: "${el.aria_label}"` : null,
      ]
        .filter(Boolean)
        .join(", ");
      elementCriteria[el.id] = { what: desc };
    });

    // Always include a fallback option per TypeSafe best practices
    elementCriteria["none_of_above"] = {
      what: "No suitable element found on current screen for the current subgoal; need to scroll or wait.",
    };

    // Build TypeSafe questions (Choice + Noul primitives in parallel)
    const questions = {
      target_element: {
        type: "choice",
        instructions:
          "Which interactive element in `interactive_elements` best accomplishes `task.current_subgoal`?",
        criteria: elementCriteria,
      },
      action_type: {
        type: "choice",
        instructions:
          "What action should be performed on the chosen element to progress towards `task.current_subgoal`?",
        options: {
          click: "Click or tap the target button, link, or tab",
          type: "Focus and enter text into the target input or search box",
          scroll: "Scroll down the page because the target element is likely further down",
          finish: "The overall goal is already fulfilled, conclude the automation",
        },
      },
      is_goal_reached: {
        type: "noul",
        instructions:
          "Does the current page state indicate that `task.overall_goal` has already been fully accomplished?",
      },
      is_blocked_by_captcha: {
        type: "noul",
        instructions:
          "Is there an active CAPTCHA, bot challenge, slider verification, or blocking security modal on the page?",
      },
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        state,
        questions,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`TypeSafe API request failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const answers = data.answers;

    const targetAnswer = answers.target_element;
    const actionAnswer = answers.action_type;
    const goalAnswer = answers.is_goal_reached;
    const captchaAnswer = answers.is_blocked_by_captcha;

    const targetId = targetAnswer.choice;
    const actionType = targetId === "none_of_above" ? "scroll" : actionAnswer.choice;

    // Minimum confidence between target choice and action choice
    const overallConfidence = Math.min(
      targetAnswer.confidence ?? 0.8,
      actionAnswer.confidence ?? 0.8
    );

    return {
      targetElementId: targetId,
      actionType: actionType as any,
      confidence: overallConfidence,
      probabilities: targetAnswer.probabilities || {},
      isGoalReached: (goalAnswer?.noul ?? 0) > 0.85,
      goalProbability: goalAnswer?.noul ?? 0,
      isBlockedByCaptcha: (captchaAnswer?.noul ?? 0) > 0.75,
      captchaProbability: captchaAnswer?.noul ?? 0,
    };
  }
}
