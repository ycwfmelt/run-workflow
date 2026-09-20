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

function isContainerTag(tag: string): boolean {
  return [
    "ul",
    "ol",
    "table",
    "tbody",
    "thead",
    "tfoot",
    "tr",
    "form",
    "section",
    "article",
    "nav",
    "body",
    "html",
  ].includes(tag);
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (isContainerTag(tag)) return false;

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
  if (el.classList.contains("ant-menu-item") || el.classList.contains("el-menu-item")) return true;

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
  return text
    .replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2") // double pass for 3-char sequences
    .trim()
    .slice(0, 100);
}

function extractElementText(el: HTMLElement): string {
  let mainText = "";
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    mainText = cleanText(ariaLabel);
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    mainText = cleanText(el.value || el.placeholder || "");
  } else {
    const title = el.getAttribute("title");
    if (title && title.trim()) {
      mainText = cleanText(title);
    } else {
      const img = el.querySelector("img");
      if (img && img.alt) {
        mainText = cleanText(img.alt);
      } else {
        mainText = cleanText(el.innerText || el.textContent || "");
      }
    }
  }

  // Contextualize table rows: e.g. "处理 (行数据: YS3839000006 | 翰思 | 综合平台RPA)"
  const tr = el.closest("tr");
  if (tr) {
    const cells = Array.from(tr.querySelectorAll("td, th"))
      .filter((td) => !td.contains(el))
      .map((td) => cleanText(td.textContent || ""))
      .filter((t) => t && t.length > 0 && t.length < 35);
    if (cells.length > 0) {
      const rowInfo = cells.slice(0, 3).join(" | ");
      return mainText ? `${mainText} (行数据: ${rowInfo})` : `(行数据: ${rowInfo})`;
    }
  }

  // Contextualize form items: e.g. "[合同编号] 支持模糊匹配"
  const formItem = el.closest(".ant-form-item, .el-form-item, .form-group, .form-item");
  if (formItem) {
    const labelEl = formItem.querySelector("label, .ant-form-item-label, .el-form-item__label");
    if (labelEl && !labelEl.contains(el)) {
      const labelText = cleanText(labelEl.textContent || "");
      if (labelText) {
        return mainText ? `[${labelText}] ${mainText}` : `[${labelText}]`;
      }
    }
  }

  // Contextualize modal dialog items: e.g. "确认 (弹窗提示: 确认通过吗？)"
  const dialog = el.closest(
    ".ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role='dialog'], .modal"
  );
  if (dialog) {
    const titleEl = dialog.querySelector(
      ".ant-modal-confirm-title, .ant-modal-title, .el-dialog__title, .el-message-box__title, .modal-title, [class*='title'], h1, h2, h3, h4"
    );
    let titleText = titleEl ? cleanText(titleEl.textContent || "") : "";
    if (!titleText) {
      const contentEl = dialog.querySelector(
        ".ant-modal-confirm-content, .el-message-box__message, .ant-modal-body, .modal-body"
      );
      if (contentEl) titleText = cleanText(contentEl.textContent || "");
    }
    if (titleText && (!titleEl || !titleEl.contains(el))) {
      return mainText ? `${mainText} (弹窗提示: ${titleText})` : `(弹窗提示: ${titleText})`;
    }
  }

  return mainText;
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

  function isPrimaryUnit(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "input", "select", "textarea"].includes(tag)) return true;
    const role = el.getAttribute("role");
    if (
      role &&
      [
        "button",
        "link",
        "menuitem",
        "tab",
        "option",
        "checkbox",
        "radio",
        "switch",
      ].includes(role)
    ) {
      return true;
    }
    if (el.classList.contains("ant-menu-item") || el.classList.contains("el-menu-item")) {
      return true;
    }
    return false;
  }

  // Filter out redundant nested interactive elements:
  // 1. Drop inner children of primary units (e.g. <span> inside <button> or <span> inside ant-menu-item)
  // 2. Drop outer loose wrappers (e.g. <div> around <a>)
  const filtered: RawCandidate[] = [];
  for (const item of candidates) {
    const el = item.el;
    const parentPrimary = candidates.find(
      (p) => p.el !== el && p.el.contains(el) && isPrimaryUnit(p.el)
    );
    if (parentPrimary) {
      continue;
    }

    if (!isPrimaryUnit(el)) {
      const hasInteractiveChild = candidates.some(
        (c) => c.el !== el && el.contains(c.el)
      );
      if (hasInteractiveChild) {
        continue;
      }
    }

    filtered.push(item);
  }

  // Detect active modal / confirmation dialog
  let activeModalInfo: { isOpen: boolean; title: string } | undefined = undefined;
  const modalEl = document.querySelector<HTMLElement>(
    ".ant-modal-confirm, .ant-modal-content, .el-dialog__wrapper, .el-message-box__wrapper, [role='dialog'], dialog[open]"
  );

  if (modalEl && isVisible(modalEl, { x: 0, y: 0 })) {
    const titleEl = modalEl.querySelector(
      ".ant-modal-confirm-title, .ant-modal-title, .el-dialog__title, .el-message-box__title, [class*='title'], h1, h2, h3, h4"
    );
    let modalTitle = titleEl ? cleanText(titleEl.textContent || "") : "";
    if (!modalTitle) {
      const contentEl = modalEl.querySelector(
        ".ant-modal-confirm-content, .el-message-box__message, .ant-modal-body, .modal-body"
      );
      if (contentEl) modalTitle = cleanText(contentEl.textContent || "");
    }
    activeModalInfo = {
      isOpen: true,
      title: modalTitle || "确认弹窗",
    };

    // If modal is open, prioritize modal elements at the beginning
    filtered.sort((a, b) => {
      const aInModal = modalEl.contains(a.el);
      const bInModal = modalEl.contains(b.el);
      if (aInModal && !bInModal) return -1;
      if (!aInModal && bInModal) return 1;
      return 0;
    });
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
    sampleElements: interactiveList.slice(0, 35).map((el) => ({
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
    activeModal: activeModalInfo,
    diagnostics,
  };
}
