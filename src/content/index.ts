import { extractInteractiveElements, elementNodeMap } from "./dom-extractor.js";
import { MessagePayload } from "../shared/types.js";

function highlightElement(elementId: string) {
  clearHighlights();
  const node = elementNodeMap.get(elementId);
  if (node) {
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.style.outline = "3px solid #10b981";
    node.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.6)";
    node.classList.add("ang-highlight");
  }
}

function clearHighlights() {
  document.querySelectorAll(".ang-highlight").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.boxShadow = "";
    el.classList.remove("ang-highlight");
  });
}

// Listen to messages from background service worker
chrome.runtime.onMessage.addListener(
  (
    message: MessagePayload,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    switch (message.type) {
      case "EXTRACT_DOM": {
        const pageState = extractInteractiveElements();
        sendResponse({ success: true, state: pageState });
        break;
      }
      case "DIAGNOSE_PAGE": {
        const pageState = extractInteractiveElements();
        sendResponse({ success: true, diagnostics: pageState.diagnostics });
        break;
      }
      case "HIGHLIGHT_ELEMENT": {
        highlightElement(message.elementId);
        sendResponse({ success: true });
        break;
      }
      case "CLEAR_HIGHLIGHTS": {
        clearHighlights();
        sendResponse({ success: true });
        break;
      }
      default:
        break;
    }
    return true;
  }
);

console.log("[Ang] Content script loaded and listening.");
