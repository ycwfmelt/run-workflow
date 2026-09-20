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
          // Enable page/DOM domains if needed
          chrome.debugger.sendCommand({ tabId: this.tabId }, "DOM.enable", {}, () => {});
          resolve();
        }
      });
    });
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId: this.tabId }, () => {
        this.attached = false;
        resolve();
      });
    });
  }

  private async sendCommand<T = any>(method: string, params: object = {}): Promise<T> {
    if (!this.attached) {
      await this.attach();
    }
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        { tabId: this.tabId },
        method,
        params,
        (result: any) => {
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
