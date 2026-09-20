/**
 * Codex-style Virtual Mouse Cursor for live visual feedback during automation
 * Injected exclusively in the top-level frame.
 */

export class VirtualCursor {
  private static instance: VirtualCursor | null = null;
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private cursorEl: HTMLDivElement | null = null;
  private badgeEl: HTMLDivElement | null = null;
  private hideTimer: any = null;
  private isVisible: boolean = false;
  private currentX: number = 0;
  private currentY: number = 0;

  private constructor() {
    // Only initialize in top window
    if (window !== window.top) return;
    this.initDOM();
  }

  public static getInstance(): VirtualCursor {
    if (!VirtualCursor.instance) {
      VirtualCursor.instance = new VirtualCursor();
    }
    return VirtualCursor.instance;
  }

  private initDOM() {
    if (this.container || window !== window.top) return;

    this.container = document.createElement("div");
    this.container.id = "ang-virtual-cursor-host";
    this.container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      overflow: visible !important;
    `;

    this.shadow = this.container.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        pointer-events: none !important;
      }
      .cursor-wrapper {
        position: fixed;
        left: 0;
        top: 0;
        will-change: transform;
        pointer-events: none;
        transition: opacity 0.25s ease;
        opacity: 0;
        z-index: 2147483647;
      }
      .cursor-wrapper.visible {
        opacity: 1;
      }
      .cursor-body {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        filter: drop-shadow(0 2px 8px rgba(99, 102, 241, 0.45));
        transition: transform 0.08s ease;
      }
      .cursor-body.clicking {
        transform: scale(0.85);
      }
      .cursor-svg {
        width: 22px;
        height: 22px;
        transform: translate(-1px, -1px);
      }
      .cursor-badge {
        background: rgba(15, 23, 42, 0.85);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(139, 92, 246, 0.5);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        gap: 4px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        letter-spacing: 0.3px;
        user-select: none;
      }
      .cursor-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 6px #38bdf8;
      }
      .click-ripple {
        position: fixed;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        margin-top: -6px;
        border-radius: 50%;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.25);
        pointer-events: none;
        animation: ang-ripple 0.42s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }
      @keyframes ang-ripple {
        0% {
          transform: scale(1);
          opacity: 1;
        }
        100% {
          transform: scale(4.5);
          opacity: 0;
        }
      }
    `;

    const wrapper = document.createElement("div");
    wrapper.className = "cursor-wrapper";
    this.cursorEl = wrapper;

    wrapper.innerHTML = `
      <div class="cursor-body" id="ang-cursor-body">
        <svg class="cursor-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ang-cursor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#8b5cf6" />
              <stop offset="100%" stop-color="#3b82f6" />
            </linearGradient>
          </defs>
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z" 
                fill="url(#ang-cursor-grad)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="cursor-badge">
          <span class="cursor-dot"></span>
          <span>Ang</span>
        </div>
      </div>
    `;

    this.shadow.appendChild(style);
    this.shadow.appendChild(wrapper);

    const mount = () => {
      const root = document.body || document.documentElement;
      if (root && !root.contains(this.container!)) {
        root.appendChild(this.container!);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  }

  public update(x: number, y: number, action?: "move" | "down" | "up" | "click") {
    if (window !== window.top) return;
    if (!this.container || !this.cursorEl) {
      this.initDOM();
    }
    if (!this.cursorEl) return;

    this.currentX = x;
    this.currentY = y;

    // Position cursor with hardware transform
    this.cursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    // Make visible
    if (!this.isVisible) {
      this.isVisible = true;
      this.cursorEl.classList.add("visible");
    }

    // Reset inactivity fade timer
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, 4000);

    const bodyEl = this.shadow?.getElementById("ang-cursor-body");

    if (action === "down") {
      bodyEl?.classList.add("clicking");
      this.createRipple(x, y);
    } else if (action === "up") {
      bodyEl?.classList.remove("clicking");
    } else if (action === "click") {
      bodyEl?.classList.add("clicking");
      this.createRipple(x, y);
      setTimeout(() => {
        bodyEl?.classList.remove("clicking");
      }, 120);
    }
  }

  private createRipple(x: number, y: number) {
    if (!this.shadow) return;
    const ripple = document.createElement("div");
    ripple.className = "click-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    this.shadow.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 450);
  }

  public hide() {
    if (!this.cursorEl) return;
    this.isVisible = false;
    this.cursorEl.classList.remove("visible");
    const bodyEl = this.shadow?.getElementById("ang-cursor-body");
    bodyEl?.classList.remove("clicking");
  }
}
