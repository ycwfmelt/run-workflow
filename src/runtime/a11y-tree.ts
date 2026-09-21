import { CDPClient } from "../background/cdp-client.js";
import { ElementRect } from "../shared/types.js";

export interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  ignoredReasons?: any[];
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string };
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value: { type: string; value: any } }>;
}

export interface A11yNode {
  ref: string; // e.g. "b1" (box) or "e1" (interactive element)
  rawId: string;
  backendNodeId?: number;
  role: string;
  name: string;
  description?: string;
  value?: string;
  isContainer: boolean;
  isInteractive: boolean;
  parentRef?: string;
  childrenRefs: string[];
  properties: Record<string, any>;
}

const CONTAINER_ROLES = new Set([
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "dialog",
  "alertdialog",
  "region",
  "form",
  "table",
  "grid",
  "treegrid",
  "row",
  "tabpanel",
  "menu",
  "menubar",
  "group",
  "rootwebarea",
  "webarea",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "combobox",
  "searchbox",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "treeitem",
  "slider",
  "spinbutton",
]);

export class A11ySnapshot {
  public nodesByRef = new Map<string, A11yNode>();
  public rootBoxes: A11yNode[] = [];
  public activeDialogs: A11yNode[] = [];
  public allInteractiveElements: A11yNode[] = [];

  constructor(
    public rawNodes: RawAXNode[],
    public url: string,
    public title: string
  ) {
    this.buildTree();
  }

  private buildTree() {
    const rawMap = new Map<string, RawAXNode>();
    for (const n of this.rawNodes) {
      rawMap.set(n.nodeId, n);
    }

    let boxCounter = 1;
    let elemCounter = 1;
    const rawIdToRef = new Map<string, string>();

    // 1. First pass: Assign refs to non-ignored, meaningful nodes
    for (const raw of this.rawNodes) {
      if (raw.ignored) continue;
      const role = (raw.role?.value || "").toLowerCase();
      const name = (raw.name?.value || "").trim();

      const isContainer = CONTAINER_ROLES.has(role);
      const isInteractive = INTERACTIVE_ROLES.has(role);

      if (isContainer) {
        const ref = `b${boxCounter++}`;
        rawIdToRef.set(raw.nodeId, ref);
      } else if (isInteractive) {
        const ref = `e${elemCounter++}`;
        rawIdToRef.set(raw.nodeId, ref);
      } else if (name && (role === "cell" || role === "gridcell" || role === "heading")) {
        // Important semantic leaves that give table/heading context
        const ref = `e${elemCounter++}`;
        rawIdToRef.set(raw.nodeId, ref);
      }
    }

    // 2. Second pass: Construct A11yNode tree
    for (const raw of this.rawNodes) {
      const ref = rawIdToRef.get(raw.nodeId);
      if (!ref) continue;

      const role = (raw.role?.value || "").toLowerCase();
      const name = (raw.name?.value || "").trim();
      const desc = (raw.description?.value || "").trim();
      const val = (raw.value?.value || "").trim();

      const props: Record<string, any> = {};
      if (raw.properties) {
        for (const p of raw.properties) {
          props[p.name] = p.value?.value;
        }
      }

      const isContainer = ref.startsWith("b");
      const isInteractive = INTERACTIVE_ROLES.has(role);

      // Resolve valid children refs
      const childrenRefs: string[] = [];
      if (raw.childIds) {
        for (const cid of raw.childIds) {
          const cref = rawIdToRef.get(cid);
          if (cref) childrenRefs.push(cref);
          else {
            // Check direct grandchildren if child was a generic container
            const childRaw = rawMap.get(cid);
            if (childRaw && childRaw.childIds) {
              for (const gcid of childRaw.childIds) {
                const gcref = rawIdToRef.get(gcid);
                if (gcref && !childrenRefs.includes(gcref)) childrenRefs.push(gcref);
              }
            }
          }
        }
      }

      const node: A11yNode = {
        ref,
        rawId: raw.nodeId,
        backendNodeId: raw.backendDOMNodeId,
        role,
        name,
        description: desc || undefined,
        value: val || undefined,
        isContainer,
        isInteractive,
        childrenRefs,
        properties: props,
      };

      this.nodesByRef.set(ref, node);

      if (isInteractive) {
        this.allInteractiveElements.push(node);
      }

      if (role === "dialog" || role === "alertdialog") {
        this.activeDialogs.push(node);
      }
    }

    // Link parent refs
    for (const [ref, node] of this.nodesByRef.entries()) {
      for (const cref of node.childrenRefs) {
        const childNode = this.nodesByRef.get(cref);
        if (childNode) childNode.parentRef = ref;
      }
    }

    // 3. Identify Root Boxes (landmarks without parent container, or children of RootWebArea)
    for (const [ref, node] of this.nodesByRef.entries()) {
      if (node.isContainer) {
        if (!node.parentRef || node.parentRef === "b1" && node.role !== "rootwebarea") {
          this.rootBoxes.push(node);
        }
      }
    }
  }

  /**
   * Generates a high-level PinchTab-style overview showing top-level Landmark Boxes.
   */
  getRootOverview(): string {
    const lines: string[] = [];
    lines.push(`【无障碍地标结构概览 (Root Overview) - 共 ${this.rootBoxes.length} 个顶级结构容器】`);
    lines.push(`页面: ${this.title || "无标题"} (${this.url || "无URL"})`);
    lines.push(`总交互元素数: ${this.allInteractiveElements.length}\n`);

    if (this.activeDialogs.length > 0) {
      lines.push(`\n🚨 检测到活动模态弹窗 (Active Modal Dialogs):`);
      for (const d of this.activeDialogs) {
        lines.push(`  * [${d.ref}] <${d.role}> "${d.name || d.description || "未命名弹窗"}"`);
      }
    }

    if (this.rootBoxes.length === 0) {
      lines.push(`  (当前页面为空白或未加载内容，若需要访问目标网站，请调用 navigate({ url: "..." }) 导航到目标地址)\n`);
    } else {
      lines.push(`顶级容器列表:`);
      for (const b of this.rootBoxes) {
        const summary = this.summarizeBox(b);
        lines.push(`  * [${b.ref}] <${b.role}> "${b.name || b.description || "无名称"}" ${summary}`);
      }
    }

    lines.push(`\n💡 寻路提示:`);
    lines.push(`- 使用 zoom_in({ containerRef: "bX", intent: "..." }) 深入探索具体工作区或表格。`);
    lines.push(`- 使用 find_in_tree({ keyword: "..." }) 可全局快速检索特定名称（如应用名或命名空间）。`);
    return lines.join("\n");
  }

  /**
   * Generates a detailed view inside a specific container box.
   */
  getBoxView(boxRef: string): string {
    const box = this.nodesByRef.get(boxRef);
    if (!box) return `Container [${boxRef}] not found.`;

    const lines: string[] = [];
    lines.push(`【容器探索视图: [${box.ref}] <${box.role}> "${box.name || box.description || ""}"】`);
    if (box.parentRef) {
      lines.push(`上级容器: [${box.parentRef}] (可用 back_to_parent 回退)`);
    }

    // Direct elements
    const directElements: A11yNode[] = [];
    const directSubBoxes: A11yNode[] = [];

    for (const cref of box.childrenRefs) {
      const child = this.nodesByRef.get(cref);
      if (!child) continue;
      if (child.isContainer) directSubBoxes.push(child);
      else directElements.push(child);
    }

    if (directElements.length > 0) {
      lines.push(`\n🎯 当前容器内可交互元素:`);
      for (const el of directElements) {
        const valStr = el.value ? ` value: "${el.value}"` : "";
        const descStr = el.description ? ` (${el.description})` : "";
        lines.push(`  • [${el.ref}] <${el.role}> "${el.name}"${valStr}${descStr}`);
      }
    }

    if (directSubBoxes.length > 0) {
      lines.push(`\n📂 下级子容器 (可下钻 zoom_in):`);
      for (const sb of directSubBoxes) {
        const summary = this.summarizeBox(sb);
        lines.push(`  • [${sb.ref}] <${sb.role}> "${sb.name || sb.description || ""}" ${summary}`);
      }
    }

    if (directElements.length === 0 && directSubBoxes.length === 0) {
      lines.push(`\n(当前容器内部无直接交互节点，请调用 back_to_parent 回退上级)`);
    }

    return lines.join("\n");
  }

  /**
   * Fast keyword search across all A11y nodes for instant target locating
   */
  search(keyword: string, limit: number = 8): string {
    const kw = keyword.toLowerCase().trim();
    if (!kw) return "Keyword is empty.";

    const matches: Array<{ node: A11yNode; score: number }> = [];

    for (const node of this.nodesByRef.values()) {
      const full = `${node.name} ${node.description || ""} ${node.value || ""} ${node.role}`.toLowerCase();
      if (full.includes(kw)) {
        let score = 10;
        if (node.isInteractive) score += 20;
        if (node.name.toLowerCase().includes(kw)) score += 30;
        matches.push({ node, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, limit);

    if (top.length === 0) {
      return `未在 A11y 树中找到包含 "${keyword}" 的节点。建议检查关键词拼写或滚动页面后重试。`;
    }

    const lines: string[] = [];
    lines.push(`🔍 检索关键词 "${keyword}" 找到以下 ${top.length} 个相关节点:`);
    for (const m of top) {
      const n = m.node;
      const typeStr = n.isContainer ? "容器 Box (支持 zoom_in)" : "交互元素 (支持 act)";
      const parentStr = n.parentRef ? `所在父容器: [${n.parentRef}]` : "";
      lines.push(`  • [${n.ref}] <${n.role}> "${n.name || n.value || ""}" [${typeStr}] ${parentStr}`);
    }
    return lines.join("\n");
  }

  private summarizeBox(box: A11yNode): string {
    let interactiveCount = 0;
    let subBoxCount = 0;
    const sampleNames: string[] = [];

    const walk = (n: A11yNode, depth: number) => {
      if (depth > 4) return;
      for (const cref of n.childrenRefs) {
        const c = this.nodesByRef.get(cref);
        if (!c) continue;
        if (c.isInteractive) {
          interactiveCount++;
          if (c.name && sampleNames.length < 3) sampleNames.push(c.name);
        }
        if (c.isContainer) {
          subBoxCount++;
          walk(c, depth + 1);
        }
      }
    };

    walk(box, 0);

    const parts: string[] = [];
    if (interactiveCount > 0) parts.push(`${interactiveCount} 个交互元素`);
    if (subBoxCount > 0) parts.push(`${subBoxCount} 个子区域`);
    if (sampleNames.length > 0) parts.push(`包含: ${sampleNames.map((s) => `"${s}"`).join(", ")}`);

    return parts.length > 0 ? `(${parts.join(" | ")})` : "";
  }

  /**
   * Helper: Resolves CDP backendNodeId for a ref e.g. "e10" or "b3"
   */
  getBackendNodeId(ref: string): number | undefined {
    return this.nodesByRef.get(ref)?.backendNodeId;
  }
}

export class A11yTreeService {
  /**
   * Captures the full accessibility tree from Chrome via CDP and builds A11ySnapshot
   */
  static async captureSnapshot(cdp: CDPClient, tabId: number): Promise<A11ySnapshot> {
    const rawRes = await cdp.sendCommand("Accessibility.getFullAXTree", {});
    const rawNodes: RawAXNode[] = rawRes?.nodes || [];

    const tabInfo = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      chrome.tabs.get(tabId, (t) => resolve(t));
    });

    const url = tabInfo?.url || "unknown";
    const title = tabInfo?.title || "unknown";

    return new A11ySnapshot(rawNodes, url, title);
  }
}
