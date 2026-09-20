import { extractInteractiveElements } from "./dom-extractor.js";
import {
  renderElementBadges,
  highlightTargetElement,
  clearOverlays,
  setOverlayVisibility,
} from "./overlay.js";
import { MessagePayload } from "../shared/types.js";

// Listen to messages from background service worker
chrome.runtime.onMessage.addListener(
  (
    message: MessagePayload,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    switch (message.type) {
      case "EXTRACT_DOM": {
        const pageState = extractInteractiveElements();
        renderElementBadges(pageState.elements);
        sendResponse({ success: true, state: pageState });
        break;
      }
      case "HIGHLIGHT_ELEMENT": {
        highlightTargetElement(message.elementId);
        sendResponse({ success: true });
        break;
      }
      case "CLEAR_HIGHLIGHTS": {
        clearOverlays();
        sendResponse({ success: true });
        break;
      }
      case "TOGGLE_OVERLAY": {
        setOverlayVisibility(message.visible);
        sendResponse({ success: true });
        break;
      }
      default:
        break;
    }
    return true; // Keep message channel open for async response if needed
  }
);

console.log("[JevPilot] Content script loaded and listening.");
