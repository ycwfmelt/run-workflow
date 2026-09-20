import { InteractiveElement } from "../shared/types.js";
import { elementNodeMap } from "./dom-extractor.js";

const OVERLAY_CONTAINER_ID = "jev-overlay-container";
let isVisible = true;

export function ensureOverlayContainer(): HTMLElement {
  let container = document.getElementById(OVERLAY_CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = OVERLAY_CONTAINER_ID;
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `;
    document.body.appendChild(container);
  }
  return container;
}

export function clearOverlays() {
  const container = document.getElementById(OVERLAY_CONTAINER_ID);
  if (container) {
    container.innerHTML = "";
  }
  document.querySelectorAll(".jev-active-highlight").forEach((el) => {
    el.classList.remove("jev-active-highlight");
  });
}

export function renderElementBadges(elements: InteractiveElement[]) {
  clearOverlays();
  if (!isVisible) return;

  const container = ensureOverlayContainer();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  elements.forEach((item) => {
    const badge = document.createElement("div");
    badge.className = "jev-element-badge";
    badge.textContent = item.id.replace("el_", "");
    badge.style.cssText = `
      position: absolute;
      left: ${item.rect.left + scrollX}px;
      top: ${item.rect.top + scrollY - 14}px;
      background: #7c3aed;
      color: #ffffff;
      font-size: 11px;
      font-weight: bold;
      font-family: monospace, sans-serif;
      padding: 1px 4px;
      border-radius: 4px;
      border: 1px solid #c4b5fd;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      line-height: 1.1;
      pointer-events: none;
      user-select: none;
    `;
    container.appendChild(badge);
  });
}

export function highlightTargetElement(elementId: string) {
  // Remove previous highlights
  document.querySelectorAll(".jev-active-highlight").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.boxShadow = "";
  });

  const node = elementNodeMap.get(elementId);
  if (node) {
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.style.outline = "3px solid #10b981";
    node.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.6)";
  }
}

export function setOverlayVisibility(visible: boolean) {
  isVisible = visible;
  const container = document.getElementById(OVERLAY_CONTAINER_ID);
  if (container) {
    container.style.display = visible ? "block" : "none";
  }
}
