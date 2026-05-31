import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFetchMiddleware } from "@aizigao/pi-fetch-pipeline";
import {
  readConfig,
  reloadConfig,
  writeConfig,
  syncRuleList,
  needsRuleListDownload,
} from "./lib/config.js";
import type { Profile, ProxyConfig } from "./lib/config.js";
import { routeRequest } from "./lib/router.js";
import { formatStats } from "./lib/stats.js";

// =============================================================================
// State
// =============================================================================

let currentConfig: ProxyConfig | null = null;

const agentCache = new Map<string, ProxyAgent>();
const certCache = new Map<string, string>();

// =============================================================================
// Helpers
// =============================================================================

function isProxyableUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function getUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function expandHome(input: string): string {
  return input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
}

function findProxyProfile(
  config: ProxyConfig,
  profileName: string,
): Profile | undefined {
  return config.profileConfig.find(
    (p) => p.name === profileName && p.type === "proxy_server",
  );
}

function preloadCaCerts(config: ProxyConfig | null): void {
  certCache.clear();
  if (!config) return;

  for (const profile of config.profileConfig) {
    if (profile.type !== "proxy_server" || !profile.caCertPath) continue;

    const resolved = expandHome(profile.caCertPath);
    try {
      if (!existsSync(resolved)) {
        console.error(`[proxy] CA cert not found: ${resolved}`);
        continue;
      }
      certCache.set(resolved, readFileSync(resolved, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[proxy] Failed to read CA cert ${resolved}: ${message}`);
    }
  }
}

function closeCachedAgents(): void {
  for (const agent of agentCache.values()) {
    agent.close().catch((err: unknown) => {
      console.error("[proxy] Failed to close ProxyAgent:", err);
    });
  }
  agentCache.clear();
}

function resetProxyRuntimeState(config: ProxyConfig | null): void {
  closeCachedAgents();
  preloadCaCerts(config);
}

function getAgent(proxyUrl: string, caCertPath?: string): ProxyAgent {
  const key = `${proxyUrl}::${caCertPath ?? ""}`;
  const cached = agentCache.get(key);
  if (cached) return cached;

  const ca = caCertPath ? certCache.get(expandHome(caCertPath)) : undefined;
  const proxyIsHttps = proxyUrl.startsWith("https://");
  const agent = ca
    ? new ProxyAgent({
        uri: proxyUrl,
        requestTls: { ca },
        ...(proxyIsHttps ? { proxyTls: { ca } } : {}),
      })
    : new ProxyAgent(proxyUrl);

  agentCache.set(key, agent);
  return agent;
}

function stripOptionalQuotes(input: string): string {
  const first = input[0];
  const last = input[input.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return input.slice(1, -1);
  }
  return input;
}

function setConfig(config: ProxyConfig | null): void {
  currentConfig = config;
  resetProxyRuntimeState(config);
}

// =============================================================================
// Extension entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  setConfig(readConfig());

  registerFetchMiddleware({
    name: "pi-proxy-fetch",
    priority: 50,
    middleware: async ({ input, init, next }) => {
      const url = new URL(getUrlString(input));
      const config = currentConfig;

      if (!config || !config.enabled || !isProxyableUrl(url)) {
        return next(input, init);
      }

      const result = routeRequest(
        config,
        url.toString(),
        url.hostname.toLowerCase(),
      );

      if (result.action === "direct") {
        return next(input, init);
      }

      const profile = findProxyProfile(config, result.profileName);
      const dispatcher = getAgent(result.server, profile?.caCertPath);
      return undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      ) as unknown as Promise<Response>;
    },
  });

  // ---- Register commands ----
  pi.registerCommand("proxy", {
    description: "Proxy profile switcher and settings",
    handler: async (args, ctx) => {
      const config = currentConfig;
      if (!config) {
        ctx.ui.notify(
          "No proxy config found. Create ./.pi/proxy.json or ~/.pi/agent/proxy.json",
          "warning",
        );
        return;
      }

      const argStr = args.trim();

      // /proxy <profile> — switch profile directly
      if (argStr && argStr !== "stats" && argStr !== "reload") {
        const targetName = stripOptionalQuotes(argStr);

        const isReserved = targetName === "direct" || targetName === "system";
        const inConfig = config.profileConfig.some(
          (p) => p.name === targetName,
        );

        if (!isReserved && !inConfig) {
          ctx.ui.notify(
            `Unknown profile: "${targetName}". Use /proxy to list available profiles.`,
            "warning",
          );
          return;
        }

        config.profileName = targetName;
        try {
          writeConfig(config);
          setConfig(readConfig());
          ctx.ui.notify(`Switched to "${targetName}"`, "info");
        } catch (err) {
          ctx.ui.notify(
            `Failed to switch profile: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        return;
      }

      // /proxy stats
      if (argStr === "stats") {
        ctx.ui.notify(formatStats(), "info");
        return;
      }

      // /proxy reload
      if (argStr === "reload") {
        setConfig(reloadConfig());
        if (!currentConfig) {
          ctx.ui.notify("Config not found or invalid.", "warning");
          return;
        }
        ctx.ui.notify(
          `Config reloaded (${currentConfig.profileConfig.length} profiles)`,
          "info",
        );
        return;
      }

      // /proxy — interactive menu
      const currentName = config.profileName;

      interface ProfileItem {
        name: string;
        note: string;
        label: string;
      }
      const profileList: ProfileItem[] = [
        { name: "direct", note: "direct", label: "" },
        { name: "system", note: "env http_proxy", label: "" },
        ...config.profileConfig.map((p) => ({
          name: p.name,
          note: p.type === "autoSwitch" ? "auto switch" : p.server ?? "",
          label: "",
        })),
      ].map((p) => {
        const marker = p.name === currentName ? "[*]" : "[ ]";
        return {
          ...p,
          label: `${marker} ${p.name}  —  ${p.note}`,
        };
      });

      const toggleEnabledLabel = config.enabled ? "Disable proxy" : "Enable proxy";

      const choice = await ctx.ui.select(
        `proxy [${currentName}]`,
        [
          ...profileList.map((p) => p.label),
          toggleEnabledLabel,
          "Show stats",
          "Refresh rule list files",
          "Reload config",
        ],
      );

      if (!choice) return;

      const selectedProfile = profileList.find((p) => p.label === choice);
      if (selectedProfile) {
        config.profileName = selectedProfile.name;
        try {
          writeConfig(config);
          setConfig(readConfig());
          ctx.ui.notify(`Switched to "${selectedProfile.name}"`, "info");
        } catch (err) {
          ctx.ui.notify(
            `Failed to switch: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        return;
      }

      if (choice === toggleEnabledLabel) {
        config.enabled = !config.enabled;
        try {
          writeConfig(config);
          setConfig(readConfig());
          ctx.ui.notify(
            `Proxy ${config.enabled ? "enabled" : "disabled"}.`,
            "info",
          );
        } catch (err) {
          ctx.ui.notify(
            `Failed to update enabled: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        return;
      }

      if (choice === "Show stats") {
        ctx.ui.notify(formatStats(), "info");
        return;
      }

      if (choice === "Refresh rule list files") {
        ctx.ui.notify("Refreshing rule lists...", "info");
        try {
          await syncRuleList(config, { force: true });
          setConfig(readConfig());
          ctx.ui.notify("Rule lists refreshed.", "info");
        } catch (err) {
          ctx.ui.notify(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        return;
      }

      if (choice === "Reload config") {
        setConfig(reloadConfig());
        if (!currentConfig) {
          ctx.ui.notify("Config not found or invalid.", "warning");
          return;
        }
        ctx.ui.notify("Config reloaded.", "info");
      }
    },
  });

  // ---- Events ----
  pi.on("session_start", async () => {
    setConfig(readConfig());
    if (currentConfig && needsRuleListDownload(currentConfig)) {
      try {
        await syncRuleList(currentConfig);
        setConfig(readConfig());
      } catch (err) {
        console.error("[proxy] syncRuleList error:", err);
      }
    }
  });

  pi.on("session_shutdown", () => {
    closeCachedAgents();
  });
}
