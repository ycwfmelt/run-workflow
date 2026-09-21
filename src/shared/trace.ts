import { ConditionSpec } from "./conditions.js";
import { PageState } from "./types.js";

export interface TraceStep {
  step: number;
  intent: string;
  action: {
    type: "click" | "type" | "scroll" | "navigate";
    elementId?: string;
    elementDescription?: string;
    text?: string;
  };
  before: {
    url: string;
    title: string;
  };
  after: {
    url: string;
    title: string;
  };
  guard?: ConditionSpec;
  stateDelta?: string;
}

/**
 * Pure function: Derives deterministic guard from page delta without guessing
 */
export function deriveGuard(
  before: PageState,
  after: PageState,
  actionTargetText?: string
): ConditionSpec | undefined {
  // If URL changed, the primary guard is the destination URL pathname
  if (after.url !== before.url) {
    try {
      const parsed = new URL(after.url);
      return { url: parsed.pathname };
    } catch {
      return { url: after.url };
    }
  }

  // If button was clicked and consumed, the guard is its disappearance
  if (actionTargetText && actionTargetText.trim()) {
    const cleanText = actionTargetText.trim();
    const stillPresent = after.elements.some((e) =>
      Boolean((e.text && e.text.includes(cleanText)) || (e.placeholder && e.placeholder.includes(cleanText)))
    );
    if (!stillPresent) {
      return { disappeared: cleanText };
    }
  }

  return undefined;
}
