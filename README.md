# JevPilot - Intelligent Browser Automation Agent

A next-generation Chrome Extension leveraging **TypeSafe AI (Jev System One)** and hardware-level **Chrome DevTools Protocol (CDP)** with human-like behavioral emulation (三次贝塞尔曲线鼠标轨迹 + 拟人击键节律).

---

## 🌟 核心特性 (Key Features)

1. **Jev System One 极速决策 (~100ms)**
   - 告别传统 browser-use 步步调用庞大视觉模型（每次等 3~6 秒）的卡顿。
   - 使用 Jev 的 `Choice` 原语精确定位可视交互元素。
   - 使用 `Noul` 原语毫秒级断言任务达成状态及 CAPTCHA / 阻断检测。
2. **硬件级操作真实性 (`event.isTrusted = true`)**
   - 基于 `chrome.debugger` (CDP) 派发真实输入事件，彻底解决普通插件合成事件被反爬风控（Cloudflare / 极验等）秒封的问题。
3. **拟人人机轨迹引擎 (Anti-Bot Emulation)**
   - **三次贝塞尔曲线 (Cubic Bezier)** 鼠标轨迹仿真，带惯性加速/减速与微小手部抖动。
   - 目标元素随机偏离落点（避免每次机械点击正中心）。
   - 高斯正态分布击键延迟（60ms ~ 160ms 随机微停顿）。
4. **双层混合架构 (Mode B 冷启动飞轮)**
   - **System Two 规划层 (Compiler)**：自动提取实体参数与阶段目标（支持 OpenAI 兼容模型或内置规则解析器）。
   - **System One 执行层 (Runtime)**：由 Jev 驱动高频页面内微操作。
5. **实时透明的 Side Panel 交互**
   - 包含实时置信度仪表盘（Confidence Meter）、执行轨迹流（Trace）、高亮标记与手动接管熔断机制。

---

## 📁 目录结构

```
automation-plugins/
├── manifest.json            # Chrome Manifest V3 配置文件
├── vite.config.ts           # 极速多入口打包配置
├── src/
│   ├── background/
│   │   ├── index.ts         # Service Worker 入口，负责扩展生命周期与侧边栏通讯
│   │   ├── agent-loop.ts    # 任务主控协调器 (AgentLoop)
│   │   ├── cdp-client.ts    # CDP 硬件输入客户端 (Input.dispatchMouseEvent 等)
│   │   ├── bezier-mouse.ts  # 人机鼠标轨迹与物理防风控引擎
│   │   ├── planner.ts       # System Two 任务分解器与实体提取器
│   │   └── typesafe-service.ts # TypeSafe Jev API (Choice / Noul 评估服务)
│   ├── content/
│   │   ├── index.ts         # Content Script 监听器
│   │   ├── dom-extractor.ts # 可视可交互 DOM 节点高效提取与去重
│   │   └── overlay.ts       # 类似于 browser-use 的数字标号浮层与绿色高亮框
│   ├── sidepanel/
│   │   ├── index.html       # 侧边栏界面 (任务输入、置信度仪表盘、Trace)
│   │   └── main.ts          # 侧边栏前端控制器
│   ├── options/
│   │   ├── index.html       # 全局配置页面 (TypeSafe Key / 阈值 / 防风控)
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
