import {
  InteractiveElement,
  PageState,
  DiagnosticsInfo,
  IframeInfo,
  ElementRect,
} from "../shared/types.js";

// Global map in content script to resolve element IDs back to DOM nodes
export const elementNodeMap = new Map<string, HTMLElement>();

interface FrameOffset {
  x: number;
  y: number;
}

interface RawCandidate {
  el: HTMLElement;
  offset: FrameOffset;
  inIframe: boolean;
  inShadow: boolean;
}

function isVisible(el: HTMLElement, frameOffset: FrameOffset): boolean {
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

  // Calculate absolute position on main screen
  const screenTop = rect.top + frameOffset.y;
  const screenBottom = rect.bottom + frameOffset.y;
  const screenLeft = rect.left + frameOffset.x;
  const screenRight = rect.right + frameOffset.x;

  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    screenBottom >= -50 &&
    screenTop <= windowHeight + 50 &&
    screenRight >= -50 &&
    screenLeft <= windowWidth + 50
  );
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
    "option",
    "treeitem",
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
    return true;
  }

  return false;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 100);
}

function extractElementText(el: HTMLElement): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return cleanText(ariaLabel);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return cleanText(el.placeholder);
    if (el.value) return cleanText(el.value);
  }

  const title = el.getAttribute("title");
  if (title && title.trim()) return cleanText(title);

  const img = el.querySelector("img");
  if (img && img.alt) return cleanText(img.alt);

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

/**
 * Deeply traverses a node: penetrates Shadow DOM and same-origin IFrames
 */
function traverseDomDeep(
  root: Document | ShadowRoot | HTMLElement,
  currentOffset: FrameOffset,
  candidates: RawCandidate[],
  diagnostics: {
    iframes: IframeInfo[];
    shadowRootCount: number;
  },
  depth: number = 0
) {
  if (depth > 12) return; // Prevent runaway recursion

  const children: Element[] = [];
  if (root instanceof Document) {
    children.push(...Array.from(root.children));
  } else if (root instanceof ShadowRoot) {
    diagnostics.shadowRootCount++;
    children.push(...Array.from(root.children));
  } else if (root instanceof HTMLElement) {
    children.push(...Array.from(root.children));
  }

  for (const child of children) {
    if (!(child instanceof HTMLElement)) continue;

    // Check if child is an interactive element
    if (isVisible(child, currentOffset) && isInteractive(child)) {
      candidates.push({
        el: child,
        offset: currentOffset,
        inIframe: currentOffset.x !== 0 || currentOffset.y !== 0,
        inShadow: depth > 0 && root instanceof ShadowRoot,
      });
    }

    // Check for Shadow Root
    if (child.shadowRoot) {
      traverseDomDeep(
        child.shadowRoot,
        currentOffset,
        candidates,
        diagnostics,
        depth + 1
      );
    }

    // Check for Iframe
    if (child instanceof HTMLIFrameElement) {
      const iframeRect = child.getBoundingClientRect();
      let isSameOrigin = false;
      let iframeSrc = child.src || child.getAttribute("src") || "about:blank";

      try {
        const iframeDoc =
          child.contentDocument || child.contentWindow?.document;
        if (iframeDoc) {
          isSameOrigin = true;
          diagnostics.iframes.push({
            src: iframeSrc,
            isSameOrigin: true,
            rect: {
              x: Math.round(iframeRect.x + currentOffset.x),
              y: Math.round(iframeRect.y + currentOffset.y),
              width: Math.round(iframeRect.width),
              height: Math.round(iframeRect.height),
              top: Math.round(iframeRect.top + currentOffset.y),
              left: Math.round(iframeRect.left + currentOffset.x),
              bottom: Math.round(iframeRect.bottom + currentOffset.y),
              right: Math.round(iframeRect.right + currentOffset.x),
            },
          });

          // Recurse into same-origin iframe with updated frame offset
          const nextOffset: FrameOffset = {
            x: currentOffset.x + iframeRect.left,
            y: currentOffset.y + iframeRect.top,
          };
          traverseDomDeep(
            iframeDoc,
            nextOffset,
            candidates,
            diagnostics,
            depth + 1
          );
        }
      } catch (err) {
        // Cross-origin iframe
        diagnostics.iframes.push({
          src: iframeSrc,
          isSameOrigin: false,
          rect: {
            x: Math.round(iframeRect.x + currentOffset.x),
            y: Math.round(iframeRect.y + currentOffset.y),
            width: Math.round(iframeRect.width),
            height: Math.round(iframeRect.height),
            top: Math.round(iframeRect.top + currentOffset.y),
            left: Math.round(iframeRect.left + currentOffset.x),
            bottom: Math.round(iframeRect.bottom + currentOffset.y),
            right: Math.round(iframeRect.right + currentOffset.x),
          },
        });
      }
    } else {
      // Recurse normal HTMLElement children
      traverseDomDeep(child, currentOffset, candidates, diagnostics, depth);
    }
  }
}

export function extractInteractiveElements(): PageState {
  elementNodeMap.clear();

  const candidates: RawCandidate[] = [];
  const diagnosticsData = {
    iframes: [] as IframeInfo[],
    shadowRootCount: 0,
  };

  // Traverse starting from top-level document
  traverseDomDeep(
    document,
    { x: 0, y: 0 },
    candidates,
    diagnosticsData,
    0
  );

  // Filter out redundant nested interactive elements (e.g. <span> inside <button>)
  const filtered: RawCandidate[] = [];
  for (const item of candidates) {
    const parentInteractive = candidates.find(
      (p) =>
        p.el !== item.el &&
        p.el.contains(item.el) &&
        ["button", "a"].includes(p.el.tagName.toLowerCase())
    );
    if (!parentInteractive) {
      filtered.push(item);
    }
  }

  let counter = 1;
  const interactiveList: InteractiveElement[] = [];

  for (const { el, offset } of filtered) {
    const id = `el_${counter++}`;
    elementNodeMap.set(id, el);

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const isInputTag =
      ["input", "textarea", "select"].includes(tag) || el.isContentEditable;

    // Apply frame offset to bounding rect for top-level CDP coordinates
    const absoluteRect: ElementRect = {
      x: Math.round(rect.x + offset.x),
      y: Math.round(rect.y + offset.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top + offset.y),
      left: Math.round(rect.left + offset.x),
      bottom: Math.round(rect.bottom + offset.y),
      right: Math.round(rect.right + offset.x),
    };

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
      rect: absoluteRect,
      center: {
        x: Math.round(absoluteRect.left + absoluteRect.width / 2),
        y: Math.round(absoluteRect.top + absoluteRect.height / 2),
      },
      isClickable: !isInputTag,
      isInput: isInputTag,
      selector: getSimpleSelector(el),
    });
  }

  const diagnostics: DiagnosticsInfo = {
    url: window.location.href,
    title: document.title,
    isTopFrame: window === window.top,
    iframes: diagnosticsData.iframes,
    shadowRootCount: diagnosticsData.shadowRootCount,
    interactiveElementsCount: interactiveList.length,
    sampleElements: interactiveList.slice(0, 15).map((el) => ({
      id: el.id,
      tag: el.tag,
      text: el.text || el.placeholder || "",
      selector: el.selector,
    })),
    timestamp: Date.now(),
  };

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
    diagnostics,
  };
}
