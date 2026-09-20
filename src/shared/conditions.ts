import { PageState } from "./types.js";

export interface ConditionSpec {
  url?: string;
  text?: string;
  selector?: string;
  disappeared?: string;
}

export interface ConditionEvalResult {
  matched: boolean;
  reason?: string;
}

/**
 * Pure function: Evaluates deterministic conditions against current page state.
 * Zero domain-specific heuristics, zero keyword guesswork.
 */
export function evaluateCondition(
  pageState: PageState,
  criteria?: ConditionSpec | string
): ConditionEvalResult {
  if (!criteria) {
    return { matched: false, reason: "No criteria specified" };
  }

  // String criteria: check URL or page text
  if (typeof criteria === "string") {
    if (criteria.startsWith("/") || criteria.startsWith("http")) {
      const matched = pageState.url.includes(criteria);
      return {
        matched,
        reason: matched ? `URL contains "${criteria}"` : `URL does not contain "${criteria}"`,
      };
    }
    const pageText = pageState.elements.map((e) => e.text || "").join(" ");
    const matched = pageText.includes(criteria);
    return {
      matched,
      reason: matched ? `Page text contains "${criteria}"` : `Page text does not contain "${criteria}"`,
    };
  }

  // Object criteria: inspect explicit structural fields
  if (criteria.url) {
    if (pageState.url.includes(criteria.url)) {
      return { matched: true, reason: `URL matched "${criteria.url}"` };
    }
  }

  if (criteria.disappeared) {
    const target = criteria.disappeared;
    const exists = pageState.elements.some((e) =>
      Boolean(
        (e.text && e.text.includes(target)) ||
          (e.placeholder && e.placeholder.includes(target)) ||
          (e.selector && e.selector.includes(target))
      )
    );
    if (!exists) {
      return { matched: true, reason: `Element/text "${target}" is no longer in DOM` };
    }
  }

  if (criteria.text) {
    const pageText = pageState.elements.map((e) => e.text || "").join(" ");
    if (pageText.includes(criteria.text)) {
      return { matched: true, reason: `Page text contains "${criteria.text}"` };
    }
  }

  if (criteria.selector) {
    const exists = pageState.elements.some((e) => e.selector.includes(criteria.selector!));
    if (exists) {
      return { matched: true, reason: `Selector "${criteria.selector}" matched on page` };
    }
  }

  return { matched: false, reason: "Condition criteria not satisfied" };
}
