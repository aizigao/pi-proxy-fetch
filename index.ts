import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  readConfig,
  reloadConfig,
  writeConfig,
  resolveProfile,
} from "./lib/config.js";
import type { ProxyConfig } from "./lib/config.js";
import { routeRequest } from "./lib/router.js";
import { formatStats } from "./lib/stats.js";

// =============================================================================
// State
// =============================================================================

let currentConfig: ProxyConfig | null = null;
let patched = false;
let restoreFetch: (() => void) | null = null;

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

// =============================================================================
// Extension entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  currentConfig = readConfig();

  // ---- Fetch patch ----
  if (!patched) {
    patched = true;

    let underlyingFetch: typeof fetch = globalThis.fetch;
    const agentCache = new Map<string, ProxyAgent>();

    const getAgent = (proxyUrl: string): ProxyAgent => {
      const cached = agentCache.get(proxyUrl);
      if (cached) return cached;
      const agent = new ProxyAgent(proxyUrl);
      agentCache.set(proxyUrl, agent);
      return agent;
    };

    const patchedFetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(getUrlString(input));
      const config = currentConfig;

      if (!config || !isProxyableUrl(url)) {
        return underlyingFetch(input, init);
      }

      const result = routeRequest(
        config,
        url.toString(),
        url.hostname.toLowerCase(),
      );

      if (result.action === "direct") {
        return underlyingFetch(input, init);
      }

      const dispatcher = getAgent(result.server);
      return undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      );
    };

    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      enumerable: true,
      get() {
        return patchedFetch;
      },
      set(newFetch: typeof fetch) {
        if (newFetch === patchedFetch) return;
        prevDesc?.set?.call(globalThis, newFetch);
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

  // ---- Register commands ----
  pi.registerCommand("proxy", {
    description: "Proxy profile switcher and settings",
    handler: async (args, ctx) => {
      const config = currentConfig;
      if (!config) {
        ctx.ui.notify(
          "No proxy config found. Create ~/.pi/proxy.jsonc",
          "warning",
        );
        return;
      }

      const argStr = args.trim();

      // /proxy <profile> — switch profile directly
      if (
        argStr &&
        argStr !== "stats" &&
        argStr !== "rules" &&
        argStr !== "reload"
      ) {
        const targetName = argStr;

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

        config.profile_name = targetName;
        try {
          writeConfig(config);
          currentConfig = readConfig();
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
        currentConfig = reloadConfig();
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

      // /proxy rules
      if (argStr === "rules") {
        const profile = resolveProfile(config);
        if (profile?.type === "autoSwitch" && profile.switchRules) {
          const rulesText = profile.switchRules
            .map((rule, i) => {
              const conds = (rule.conditions ?? [])
                .map((c) =>
                  c.conditionType === "DisabledCondition"
                    ? "Disabled"
                    : `${c.conditionType}: ${c.pattern ?? "*"}`,
                )
                .join(" AND ") || "(always)";
              const note = rule.note ? `  # ${rule.note}` : "";
              return `[${i + 1}] ${conds}  →  ${rule.profileName}${note}`;
            })
            .join("\n");
          ctx.ui.notify(
            `[${profile.name}]\n${rulesText || "(empty)"}`,
            "info",
          );
        } else {
          ctx.ui.notify(
            `Current profile "${config.profile_name}" is not an autoSwitch profile.`,
            "info",
          );
        }
        return;
      }

      // /proxy — interactive menu
      const currentName = config.profile_name;

      interface ProfileItem {
        name: string;
        note: string;
      }
      const profileList: ProfileItem[] = [
        { name: "direct", note: "直连（内置）" },
        { name: "system", note: "系统代理（内置）" },
        ...config.profileConfig.map((p) => ({
          name: p.name,
          note: p.type === "autoSwitch" ? "auto switch" : p.server ?? "",
        })),
      ];

      const choices = profileList.map((p) => {
        const marker = p.name === currentName ? "[*]" : "[ ]";
        return `${marker} ${p.name}  —  ${p.note}`;
      });

      const choice = await ctx.ui.select(
        `proxy [${currentName}]`,
        [...choices, "Show stats", "Show rules", "Reload config"],
      );

      if (!choice) return;

      for (const p of profileList) {
        if (choice.includes(` ${p.name} `)) {
          config.profile_name = p.name;
          try {
            writeConfig(config);
            currentConfig = readConfig();
            ctx.ui.notify(`Switched to "${p.name}"`, "info");
          } catch (err) {
            ctx.ui.notify(
              `Failed to switch: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
          }
          return;
        }
      }

      if (choice === "Show stats") {
        ctx.ui.notify(formatStats(), "info");
        return;
      }

      if (choice === "Show rules") {
        const profile = resolveProfile(config);
        if (profile?.type === "autoSwitch" && profile.switchRules) {
          const rulesText = profile.switchRules
            .map((rule, i) => {
              const conds = (rule.conditions ?? [])
                .map((c) =>
                  c.conditionType === "DisabledCondition"
                    ? "Disabled"
                    : `${c.conditionType}: ${c.pattern ?? "*"}`,
                )
                .join(" AND ") || "(always)";
              const note = rule.note ? `  # ${rule.note}` : "";
              return `[${i + 1}] ${conds}  →  ${rule.profileName}${note}`;
            })
            .join("\n");
          ctx.ui.notify(
            `[${profile.name}]\n${rulesText || "(empty)"}`,
            "info",
          );
        } else {
          ctx.ui.notify(
            `Current profile "${config.profile_name}" is not an autoSwitch profile.`,
            "info",
          );
        }
        return;
      }

      if (choice === "Reload config") {
        currentConfig = reloadConfig();
        if (!currentConfig) {
          ctx.ui.notify("Config not found or invalid.", "warning");
          return;
        }
        ctx.ui.notify("Config reloaded.", "info");
        return;
      }
    },
  });

  // ---- Events ----
  pi.on("session_start", () => {
    currentConfig = readConfig();
  });

  pi.on("session_shutdown", () => {
    restoreFetch?.();
  });
}
