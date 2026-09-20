# Ang - Intelligent Browser Automation Agent

A modern Chrome Extension leveraging **TypeSafe AI (Jev System One)**, **Claude Code dynamic workflows (JavaScript recipes)**, and hardware-level **Chrome DevTools Protocol (CDP)** with human-like behavioral emulation (三次贝塞尔曲线鼠标轨迹 + 拟人击键节律).

---

## 🌟 核心特性 (Key Features)

1. **Jev System One 极速决策 (~100ms)**
   - 告别传统 browser-use 步步调用庞大视觉模型（每次等 3~6 秒）的卡顿。
   - 使用 Jev 的 `Choice` 原语精确定位可视交互元素。
   - 使用 `Noul` 原语毫秒级断言任务达成状态及 CAPTCHA / 阻断检测。
2. **Claude Code 兼容动态工作流 (JavaScript Function Recipes)**
   - 工作流本质即为原生 JavaScript 脚本函数，变量天生保存在 JS 运行时内存中。
   - 原生支持 `while (!isDone)` 等循环与分支控制，一次执行即一次 JS 异步函数调用。
3. **硬件级操作真实性 (`event.isTrusted = true`)**
   - 基于 `chrome.debugger` (CDP) 派发真实输入事件，彻底解决普通插件合成事件被反爬风控（Cloudflare / 极验等）秒封的问题。
4. **拟人人机轨迹引擎 (Anti-Bot Emulation)**
   - **三次贝塞尔曲线 (Cubic Bezier)** 鼠标轨迹仿真，带 Fitts 加速/减速与微小手部抖动。
   - 高斯正态分布击键延迟（60ms ~ 160ms 随机微停顿），全量固定锁定开启。
5. **双层混合架构**
   - **System Two 规划层 (Compiler)**：预置 Ollama + `deepseek-v4.1-flash:cloud`，自动平滑降级至内置规则。
   - **System One 执行层 (Runtime)**：由 Jev 驱动高频页面内微操作。
6. **侧边栏纯净执行交互**
   - 侧边栏专注执行与轨迹监测；API Key 与全局参数移至独立配置页，保障安全与整洁。

---

## 📁 目录结构

```
automation-plugins/
├── manifest.json            # Chrome Manifest V3 配置文件
├── vite.config.ts           # 极速多入口打包配置
├── public/icons/            # 极简矢量与栅格图标 (icon.svg, icon16/48/128.png)
├── src/
│   ├── background/
│   │   ├── index.ts         # Service Worker 入口，负责扩展生命周期与侧边栏通讯
│   │   ├── agent-loop.ts    # 任务主控协调器 (AgentLoop)
│   │   ├── cdp-client.ts    # CDP 硬件输入客户端 (Input.dispatchMouseEvent 等)
│   │   ├── bezier-mouse.ts  # 人机鼠标轨迹与物理防风控引擎
│   │   ├── planner.ts       # System Two 任务分解器与意图解析器
│   │   └── typesafe-service.ts # TypeSafe Jev API (Choice / Noul 评估服务)
│   ├── workflows/           # Claude Code 兼容动态工作流引擎
│   │   ├── types.ts         # 工作流上下文 (WorkflowContext) 与原语定义
│   │   ├── workflow-registry.ts # 工作流发现与持久化存储注册表
│   │   └── builtin/         # 内置自动化脚本 (如 NEW-BOSS 批量审批)
│   ├── content/
│   │   ├── index.ts         # Content Script 监听器
│   │   └── dom-extractor.ts # 可视可交互 DOM 节点高效提取与去重
│   ├── sidepanel/
│   │   ├── index.html       # 纯净执行侧边栏界面 (任务目标、动态工作流卡片、Trace)
│   │   └── main.ts          # 侧边栏前端控制器
│   ├── options/
│   │   ├── index.html       # 专属独立全局配置中心 (TypeSafe Key / Ollama 测试)
│   │   └── options.ts
│   └── shared/
│       ├── types.ts         # 全局强类型定义 (DOM 节点、Action、消息流)
│       └── storage.ts       # chrome.storage 本地配置封装
└── dist/                    # 打包产物 (直接载入 Chrome)
```

---

## 🚀 快速使用指南 (Quick Start)

### 1. 编译构建
```bash
# 安装依赖
pnpm install

# 编译输出到 dist 目录
pnpm run build

# 或者开发模式监听代码变更
pnpm run dev
```

### 2. 在 Chrome 中加载扩展
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
2. 打开右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选择当前项目的 `dist` 目录：`/Users/leyan/Project/automation-plugins/dist`。

### 3. 开始自动化
1. 在浏览器右上角扩展栏中点击 **JevPilot** 图标，打开右侧的 **Side Panel**。
2. 在侧边栏底部的“API 配置”中输入你的 **TypeSafe API Key** 并点击“保存配置”。
3. 在上方输入任意任务，例如：
   - `在 Google 搜索 typesafe ai 并点击进入第一条结果`
   - `在 GitHub 搜索 browser-use`
4. 点击 **🚀 启动自动化**，观察页面上的数字打标、鼠标移动以及仪表盘上的置信度变化！
