export type S2HealthStatus =
  | "online"
  | "offline"
  | "cors_blocked"
  | "model_missing"
  | "auth_error"
  | "timeout"
  | "error";

export interface S2HealthResult {
  status: S2HealthStatus;
  endpoint: string;
  model: string;
  availableModels?: string[];
  message: string;
  actionHint?: string;
  latencyMs?: number;
}

/**
 * Actively probes the configured S2 (Ollama / OpenAI-compatible) endpoint.
 * Detects whether the daemon is running, whether CORS is blocking requests,
 * whether the model is available, or if authentication failed.
 */
export async function checkS2Health(
  endpoint: string,
  model: string,
  apiKey?: string
): Promise<S2HealthResult> {
  const normalizedEndpoint = (endpoint || "http://localhost:11434/v1").trim().replace(/\/+$/, "");
  const isLocalhost =
    normalizedEndpoint.includes("localhost") ||
    normalizedEndpoint.includes("127.0.0.1") ||
    normalizedEndpoint.includes("0.0.0.0");
  const startTime = Date.now();

  // 1. Probe Localhost Ollama
  if (isLocalhost) {
    const baseOrigin = normalizedEndpoint.replace(/\/v1$/, "");
    const tagsUrl = `${baseOrigin}/api/tags`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(tagsUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      const latencyMs = Date.now() - startTime;

      if (res.status === 403) {
        return {
          status: "cors_blocked",
          endpoint: normalizedEndpoint,
          model,
          message: "Ollama 拒绝跨域访问 (HTTP 403 Forbidden)",
          actionHint: 'Ollama 默认拦截扩展请求。请允许跨域启动：终端运行 OLLAMA_ORIGINS="*" ollama serve',
          latencyMs,
        };
      }

      if (!res.ok) {
        return {
          status: "error",
          endpoint: normalizedEndpoint,
          model,
          message: `Ollama 响应异常 (HTTP ${res.status}: ${res.statusText})`,
          actionHint: "请检查 Ollama 服务状态及本地端口占用情况。",
          latencyMs,
        };
      }

      const data = await res.json().catch(() => ({}));
      const modelsList: string[] = Array.isArray(data.models)
        ? data.models.map((m: any) => m.name || m.model || "")
        : [];

      return {
        status: "online",
        endpoint: normalizedEndpoint,
        model,
        availableModels: modelsList,
        message: `Ollama 服务在线 (已连接 ${baseOrigin})`,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;

      if (err.name === "AbortError") {
        return {
          status: "timeout",
          endpoint: normalizedEndpoint,
          model,
          message: `连接 Ollama 服务超时 (${tagsUrl})`,
          actionHint: "服务未及时响应，请检查系统负载或在终端重启 ollama serve。",
          latencyMs,
        };
      }

      return {
        status: "offline",
        endpoint: normalizedEndpoint,
        model,
        message: `无法连接到本地 Ollama 服务 (${baseOrigin})`,
        actionHint: "本地未启动 Ollama 守护进程。请在系统终端执行：ollama serve",
        latencyMs,
      };
    }
  }

  // 2. Probe Remote / Cloud OpenAI-compatible endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${normalizedEndpoint}/models`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startTime;

    if (res.status === 401 || res.status === 403) {
      return {
        status: "auth_error",
        endpoint: normalizedEndpoint,
        model,
        message: `S2 服务鉴权失败 (HTTP ${res.status})`,
        actionHint: "API Key 无效或未授权。请在扩展设置中检查 S2 API Key 配置。",
        latencyMs,
      };
    }

    if (!res.ok) {
      return {
        status: "error",
        endpoint: normalizedEndpoint,
        model,
        message: `S2 端点返回 HTTP ${res.status}: ${res.statusText}`,
        actionHint: "请确认端点服务是否正常运行，或检查端点路径是否正确。",
        latencyMs,
      };
    }

    return {
      status: "online",
      endpoint: normalizedEndpoint,
      model,
      message: `S2 模型端点在线 (${normalizedEndpoint})`,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    if (err.name === "AbortError") {
      return {
        status: "timeout",
        endpoint: normalizedEndpoint,
        model,
        message: `连接 S2 端点超时 (${normalizedEndpoint})`,
        actionHint: "网络连接超时，请检查网络代理或服务端状态。",
        latencyMs,
      };
    }
    return {
      status: "offline",
      endpoint: normalizedEndpoint,
      model,
      message: `无法连接到 S2 服务端点 (${err.message || "Failed to fetch"})`,
      actionHint: "网络不可达。请确认服务地址正确且网络畅通。",
      latencyMs,
    };
  }
}

/**
 * Analyzes an execution error when interacting with S2,
 * combining real-time health probing to explain the authentic root cause.
 */
export async function diagnoseS2Error(
  err: any,
  endpoint: string,
  model: string,
  apiKey?: string
): Promise<string> {
  const health = await checkS2Health(endpoint, model, apiKey);

  if (health.status === "offline") {
    return (
      `【S2 服务离线】无法连接到 Ollama 服务 (${health.endpoint})\n` +
      `真实原因：本地未检测到运行中的 Ollama 守护进程 (Connection Refused)。\n` +
      `解决建议：请在系统终端执行 'ollama serve' 启动服务后重试。`
    );
  }

  if (health.status === "cors_blocked") {
    return (
      `【S2 跨域拒绝】Ollama 拦截了来自扩展的请求 (HTTP 403 Forbidden)\n` +
      `真实原因：Ollama 默认拦截非 localhost 网页来源，拒绝了扩展通信。\n` +
      `解决建议：请在终端以跨域模式启动 Ollama：\nOLLAMA_ORIGINS="*" ollama serve`
    );
  }

  if (health.status === "auth_error") {
    return (
      `【S2 鉴权失败】服务端返回 HTTP 401/403\n` +
      `真实原因：S2 API Key 无效或权限不足。\n` +
      `解决建议：请前往扩展设置页面检查并更新 S2 API Key。`
    );
  }

  if (health.status === "timeout") {
    return (
      `【S2 连接超时】连接 ${health.endpoint} 超过时限\n` +
      `真实原因：本地或远程服务无响应。\n` +
      `解决建议：请检查终端进程是否卡死，或重启 ollama serve。`
    );
  }

  // Model-level or generation-level error
  const rawMsg = err?.message || String(err);

  if (rawMsg.includes("item_reference")) {
    return (
      `【S2 协议不匹配】${rawMsg}\n` +
      `真实原因：端点服务不识别 OpenAI Responses API 的 item_reference 特性。\n` +
      `解决方式：已强制使用通用 Chat Completions 协议 (/v1/chat/completions) 进行交互。`
    );
  }

  if (rawMsg.toLowerCase().includes("not found")) {
    return (
      `【S2 模型未安装】${rawMsg}\n` +
      `端点: ${endpoint} | 配置模型: ${model}\n` +
      `解决建议：请在终端执行 'ollama pull ${model}' 拉取模型文件。`
    );
  }

  return (
    `【S2 模型调用异常】${rawMsg}\n` +
    `端点: ${endpoint} | 配置模型: ${model}\n` +
    `建议：请确认该模型已在 Ollama 中完整拉取 (终端执行: ollama pull ${model})。`
  );
}
