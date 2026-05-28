import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ProxyAction = "direct" | "proxy" | "fallback";

type ProxyRule = {
  match?: string;
  action?: ProxyAction;
  comment?: string;
};

type ProxyConfig = {
  enabled?: boolean;
  proxy?: string;
  mode?: ProxyAction;
  rules?: ProxyRule[];
};

type ProxyStats = {
  direct: number;
  proxy: number;
  fallback: number;
  fallbackHit: number;
};

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const stats: ProxyStats = {
  direct: 0,
  proxy: 0,
  fallback: 0,
  fallbackHit: 0,
};

let patched = false;
let restoreFetch: (() => void) | null = null;

function getAgentDir(): string {
  return process?.env?.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function getProxyConfigPath(): string {
  return join(getAgentDir(), "proxy.json");
}

function readProxyConfig(): ProxyConfig | null {
  const configPath = getProxyConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as ProxyConfig;
  } catch {
    return null;
  }
}

function matchesPattern(hostname: string, pattern: string): boolean {
  if (!pattern || pattern === "*") {
    return true;
  }

  if (!pattern.includes("*")) {
    return hostname === pattern;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}

function getActionForHost(hostname: string, config: ProxyConfig): ProxyAction {
  for (const rule of config.rules ?? []) {
    if (!rule.match || !rule.action) {
      continue;
    }

    const patterns = rule.match
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    if (patterns.some((pattern) => matchesPattern(hostname, pattern))) {
      return rule.action;
    }
  }

  return config.mode ?? "direct";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isProxyableUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function getUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function formatStats(): string {
  return `direct: ${stats.direct} | proxy: ${stats.proxy} | fallback: ${stats.fallback} (hit: ${stats.fallbackHit})`;
}

function writeProxyConfig(config: ProxyConfig): void {
  writeFileSync(getProxyConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function formatRules(config: ProxyConfig | null): string {
  if (!config) {
    return `config missing: ${getProxyConfigPath()}`;
  }

  const status = config.enabled ? "ON" : "OFF";
  const proxy = config.proxy ?? "(unset)";
  const mode = config.mode ?? "direct";
  const rules = (config.rules ?? []).map((rule) => {
    const action = (rule.action ?? mode).padEnd(8);
    const match = rule.match ?? "(empty)";
    const comment = rule.comment ? `  # ${rule.comment}` : "";
    return `${action} ${match}${comment}`;
  });

  return [`[${status}] ${proxy} mode=${mode}`, ...rules].join("\n");
}

export default function (pi: ExtensionAPI) {
  let currentConfig = readProxyConfig();

  if (!patched) {
    patched = true;

    let underlyingFetch: typeof fetch = globalThis.fetch;
    const agentCache = new Map<string, ProxyAgent>();

    const getAgent = (proxyUrl: string): ProxyAgent => {
      const cached = agentCache.get(proxyUrl);
      if (cached) {
        return cached;
      }

      const agent = new ProxyAgent(proxyUrl);
      agentCache.set(proxyUrl, agent);
      return agent;
    };

    const patchedFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(getUrlString(input));
      const config = readProxyConfig();

      if (!config?.enabled || !config.proxy || !isProxyableUrl(url)) {
        return underlyingFetch(input, init);
      }

      const action = getActionForHost(url.hostname.toLowerCase(), config);
      const dispatcher = getAgent(config.proxy);

      if (action === "direct") {
        stats.direct += 1;
        return underlyingFetch(input, init);
      }

      if (action === "proxy") {
        stats.proxy += 1;
        return undiciFetch(input, { ...init, dispatcher } as RequestInit);
      }

      stats.fallback += 1;

      try {
        return await underlyingFetch(input, init);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        stats.fallbackHit += 1;
        return undiciFetch(input, { ...init, dispatcher } as RequestInit);
      }
    }) as typeof fetch;

    // Install via Object.defineProperty getter/setter to survive
    // configureHttpDispatcher() -> undici.install() and coexist with
    // other extensions that also patch globalThis.fetch.
    const _prevDesc = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      enumerable: true,
      get() {
        return patchedFetch;
      },
      set(newFetch: typeof fetch) {
        if (newFetch === patchedFetch) return;
        _prevDesc?.set?.call(globalThis, newFetch);
        underlyingFetch = newFetch;
      },
    });

    restoreFetch = () => {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: underlyingFetch,
      });
      patched = false;
      restoreFetch = null;
    };
  }

  pi.registerCommand("proxy", {
    description: "Proxy settings",
    handler: async (_args, ctx) => {
      currentConfig = readProxyConfig();
      const status = currentConfig?.enabled ? "ON" : "OFF";
      const proxy = currentConfig?.proxy ?? "(unset)";
      const toggleLabel = currentConfig?.enabled ? "Turn OFF" : "Turn ON";

      const choice = await ctx.ui.select(`proxy [${status}] ${proxy}`, [
        toggleLabel,
        "Show stats",
        "Reload config",
        "Show rules",
      ]);

      if (!choice) {
        return;
      }

      if (choice === toggleLabel) {
        if (!currentConfig) {
          ctx.ui.notify(`Config missing: ${getProxyConfigPath()}`, "warning");
          return;
        }

        const nextEnabled = !currentConfig.enabled;
        const nextConfig = {
          ...currentConfig,
          enabled: nextEnabled,
        };

        try {
          writeProxyConfig(nextConfig);
          currentConfig = nextConfig;
          ctx.ui.notify(`proxy: ${nextEnabled ? "ON" : "OFF"}`, "success");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? `Failed to write config: ${error.message}` : "Failed to write config", "error");
        }
        return;
      }

      if (choice === "Show stats") {
        ctx.ui.notify(formatStats(), "info");
        return;
      }

      if (choice === "Reload config") {
        currentConfig = readProxyConfig();
        if (!currentConfig) {
          ctx.ui.notify(`Config missing: ${getProxyConfigPath()}`, "warning");
          return;
        }

        ctx.ui.notify(`Config reloaded (${currentConfig.rules?.length ?? 0} rules)`, "success");
        return;
      }

      ctx.ui.notify(formatRules(currentConfig), "info");
    },
  });

  pi.on("session_shutdown", async () => {
    restoreFetch?.();
  });
}
