import { InteractiveElement, PageState } from "../shared/types.js";

// Global map in content script to resolve element IDs back to DOM nodes
export const elementNodeMap = new Map<string, HTMLElement>();

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  // Check if element is within the current viewport (with slight margin)
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  const inViewport =
    rect.bottom >= -50 &&
    rect.top <= windowHeight + 50 &&
    rect.right >= -50 &&
    rect.left <= windowWidth + 50;

  return inViewport;
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();

  // Naturally interactive tags
  if (["button", "select", "textarea"].includes(tag)) return true;
  if (tag === "input" && (el as HTMLInputElement).type !== "hidden") return true;
  if (tag === "a" && (el as HTMLAnchorElement).hasAttribute("href")) return true;
  if (tag === "summary") return true;

  // Roles
  const role = el.getAttribute("role");
  const interactiveRoles = [
    "button",
    "link",
    "checkbox",
    "radio",
    "combobox",
    "menuitem",
    "tab",
    "switch",
    "searchbox",
    "textbox",
  ];
  if (role && interactiveRoles.includes(role)) return true;

  // Custom interaction attributes
  if (el.isContentEditable) return true;
  if (el.hasAttribute("onclick")) return true;

  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;

  // Pointer cursor check
  const style = window.getComputedStyle(el);
  if (style.cursor === "pointer") {
    // If child is also pointer, prefer outermost interactive container
    return true;
  }

  return false;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 100);
}

function extractElementText(el: HTMLElement): string {
  // Priority: aria-label -> placeholder -> value -> innerText -> title -> alt
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return cleanText(ariaLabel);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return cleanText(el.placeholder);
    if (el.value) return cleanText(el.value);
  }

  const title = el.getAttribute("title");
  if (title && title.trim()) return cleanText(title);

  // Check image alt if image is inside
  const img = el.querySelector("img");
  if (img && img.alt) return cleanText(img.alt);

  // Text content
  const text = el.innerText || el.textContent || "";
  return cleanText(text);
}

function getSimpleSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith("jev-"))
    .slice(0, 2)
    .map((c) => `.${CSS.escape(c)}`)
    .join("");
  return `${tag}${classes}`;
}

export function extractInteractiveElements(): PageState {
  elementNodeMap.clear();

  // Collect potential candidates
  const allElements = document.querySelectorAll<HTMLElement>(
    "button, a, input, select, textarea, [role], [onclick], [tabindex], [contenteditable], summary"
  );

  const candidates: HTMLElement[] = [];
  allElements.forEach((el) => {
    if (isVisible(el) && isInteractive(el)) {
      candidates.push(el);
    }
  });

  // Filter out redundant nested interactive elements (e.g. <span> inside <button>)
  const filtered: HTMLElement[] = [];
  for (const el of candidates) {
    // If one of its parent is also in candidates, and the parent is a button/a, keep the parent
    const parentInteractive = candidates.find(
      (p) => p !== el && p.contains(el) && ["button", "a"].includes(p.tagName.toLowerCase())
    );
    if (!parentInteractive) {
      filtered.push(el);
    }
  }

  let counter = 1;
  const interactiveList: InteractiveElement[] = [];

  for (const el of filtered) {
    const id = `el_${counter++}`;
    elementNodeMap.set(id, el);

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const isInputTag =
      ["input", "textarea", "select"].includes(tag) || el.isContentEditable;

    interactiveList.push({
      id,
      tag,
      role: el.getAttribute("role") || tag,
      text: extractElementText(el),
      type: (el as HTMLInputElement).type,
      placeholder: (el as HTMLInputElement).placeholder,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      value: (el as HTMLInputElement).value,
      href: (el as HTMLAnchorElement).href,
      name: el.getAttribute("name") || undefined,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
      center: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      },
      isClickable: !isInputTag,
      isInput: isInputTag,
      selector: getSimpleSelector(el),
    });
  }

  return {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    elements: interactiveList,
  };
}
