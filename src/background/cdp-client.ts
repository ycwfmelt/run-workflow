import {
  Point,
  generateMouseTrajectory,
  getHumanizedClickPoint,
  getHumanKeystrokeDelay,
  sleep,
} from "./bezier-mouse.js";
import { ElementRect } from "../shared/types.js";

export class CDPClient {
  private tabId: number;
  private attached: boolean = false;
  private currentMousePos: Point = { x: 100, y: 100 };

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  async attach(): Promise<void> {
    if (this.attached) return;
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId: this.tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          this.attached = true;
          // Enable page/DOM and Accessibility domains
          chrome.debugger.sendCommand({ tabId: this.tabId }, "DOM.enable", {}, () => {});
          chrome.debugger.sendCommand({ tabId: this.tabId }, "Accessibility.enable", {}, () => {});
          resolve();
        }
      });
    });
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.hideVirtualMouse();
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId: this.tabId }, () => {
        this.attached = false;
        resolve();
      });
    });
  }

  private  sendVirtualMouse(x: number, y: number, action: "move" | "down" | "up") {
    chrome.tabs.sendMessage(this.tabId, {
      type: "VIRTUAL_MOUSE_UPDATE",
      x,
      y,
      action,
    }, { frameId: 0 }).catch(() => {
      // Ignore if tab is navigating or script not yet attached
    });
  }

  hideVirtualMouse() {
    chrome.tabs.sendMessage(this.tabId, {
      type: "VIRTUAL_MOUSE_HIDE",
    }, { frameId: 0 }).catch(() => {});
  }

  public async sendCommand<T = any>(
    method: string,
    params: Record<string, any> = {},
    timeoutMs: number = 15000
  ): Promise<T> {
    if (!this.attached) {
      await this.attach();
    }
    return new Promise((resolve, reject) => {
      let timer: any = setTimeout(() => {
        timer = null;
        reject(new Error(`CDP 命令 [${method}] 执行超时 (${timeoutMs}ms)，目标页面可能处于后台休眠或被切走`));
      }, timeoutMs);

      chrome.debugger.sendCommand(
        { tabId: this.tabId },
        method,
        params,
        (result: any) => {
          if (!timer) return;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result as T);
          }
        }
      );
    });
  }

  /**
   * Resolves physical viewport bounding rect for a CDP backendNodeId
   */
  async getBoxModel(backendNodeId: number): Promise<ElementRect | null> {
    try {
      await this.sendCommand("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
      const res = await this.sendCommand("DOM.getBoxModel", { backendNodeId });
      if (!res || !res.model || !res.model.border) return null;
      const b: number[] = res.model.border;
      const left = Math.round(Math.min(b[0], b[2], b[4], b[6]));
      const right = Math.round(Math.max(b[0], b[2], b[4], b[6]));
      const top = Math.round(Math.min(b[1], b[3], b[5], b[7]));
      const bottom = Math.round(Math.max(b[1], b[3], b[5], b[7]));
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      return {
        x: left,
        y: top,
        left,
        top,
        right,
        bottom,
        width,
        height,
      };
    } catch {
      return null;
    }
  }

  /**
   * Move mouse smoothly using Bezier curve to target coordinates
   */
  async moveMouse(target: Point, antiBot: boolean = true): Promise<void> {
    if (!antiBot) {
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x,
        y: target.y,
      });
      this.currentMousePos = target;
      this.sendVirtualMouse(target.x, target.y, "move");
      return;
    }

    const { points, delayPerStep } = generateMouseTrajectory(
      this.currentMousePos,
      target
    );

    for (const pt of points) {
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
      });
      this.sendVirtualMouse(pt.x, pt.y, "move");
      await sleep(delayPerStep);
    }

    this.currentMousePos = target;
  }

  /**
   * Click an element with human-like mouse curve and realistic dwell time
   */
  async clickElement(rect: ElementRect, antiBot: boolean = true): Promise<void> {
    const targetPoint = antiBot
      ? getHumanizedClickPoint(rect)
      : { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };

    // Move to element
    await this.moveMouse(targetPoint, antiBot);

    // Human hesitation before pressing down (30ms - 90ms)
    if (antiBot) {
      await sleep(35 + Math.random() * 55);
    }

    // Visual feedback for mouse press
    this.sendVirtualMouse(targetPoint.x, targetPoint.y, "down");

    // Mouse down
    await this.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: targetPoint.x,
      y: targetPoint.y,
      button: "left",
      clickCount: 1,
    });

    // Button hold duration (60ms - 120ms)
    const holdDuration = antiBot ? 65 + Math.random() * 55 : 50;
    await sleep(holdDuration);

    // Visual feedback for mouse release
    this.sendVirtualMouse(targetPoint.x, targetPoint.y, "up");

    // Mouse up
    await this.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: targetPoint.x,
      y: targetPoint.y,
      button: "left",
      clickCount: 1,
    });

    // Small pause after click
    if (antiBot) {
      await sleep(80 + Math.random() * 80);
    }
  }

  /**
   * Type text with humanized cadence
   */
  async typeText(text: string, antiBot: boolean = true): Promise<void> {
    for (const char of text) {
      // Send rawKeyDown and keyUp or insertText
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        unmodifiedText: char,
      });

      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
      });

      const delay = antiBot ? getHumanKeystrokeDelay() : 20;
      await sleep(delay);
    }
  }

  /**
   * Send single key press (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown')
   */
  async pressKey(keyName: string): Promise<void> {
    await this.sendCommand("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: keyName,
      windowsVirtualKeyCode: keyName === "Enter" ? 13 : keyName === "Tab" ? 9 : 0,
    });

    await sleep(40 + Math.random() * 30);

    await this.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyName,
    });
  }

  /**
   * Scroll page using mouse wheel
   */
  async scroll(deltaY: number): Promise<void> {
    await this.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: this.currentMousePos.x,
      y: this.currentMousePos.y,
      deltaX: 0,
      deltaY: deltaY,
    });
    await sleep(200);
  }

  /**
   * Navigate tab to URL
   */
  async navigate(url: string): Promise<void> {
    await this.sendCommand("Page.navigate", { url });
  }
}
