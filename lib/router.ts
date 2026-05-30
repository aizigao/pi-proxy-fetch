import type { ProxyConfig } from "./config.js";
import { findMatchingRule } from "./conditions.js";
import { resolveProxyServer } from "./config.js";
import { stats } from "./stats.js";

export type RouteResult =
  | { action: "direct" }
  | { action: "proxy"; server: string };

export function routeRequest(
  config: ProxyConfig,
  url: string,
  hostname: string,
): RouteResult {
  if (!config.enabled) {
    stats.direct += 1;
    return { action: "direct" };
  }

  const activeProfile = config.profileConfig.find(
    (p) => p.name === config.profile_name,
  );

  // Direct reservation
  if (config.profile_name === "direct") {
    stats.direct += 1;
    return { action: "direct" };
  }

  // System proxy
  if (config.profile_name === "system") {
    const server = resolveProxyServer(config, "system");
    if (server) {
      stats.proxy += 1;
      return { action: "proxy", server };
    }
    stats.direct += 1;
    return { action: "direct" };
  }

  // Proxy server: all requests go through this proxy
  if (activeProfile && activeProfile.type === "proxy_server") {
    const server =
      activeProfile.server ?? resolveProxyServer(config, activeProfile.name);
    if (server) {
      stats.proxy += 1;
      return { action: "proxy", server };
    }
    stats.direct += 1;
    return { action: "direct" };
  }

  // Auto switch: match rules
  if (activeProfile && activeProfile.type === "autoSwitch") {
    const rules = activeProfile.switchRules;
    if (!rules || rules.length === 0) {
      stats.direct += 1;
      return { action: "direct" };
    }

    const matched = findMatchingRule(rules, url, hostname);
    if (!matched) {
      stats.direct += 1;
      return { action: "direct" };
    }

    const targetName = matched.profileName;
    if (targetName === "direct") {
      stats.direct += 1;
      return { action: "direct" };
    }

    const server = resolveProxyServer(config, targetName);
    if (server) {
      stats.proxy += 1;
      return { action: "proxy", server };
    }

    stats.direct += 1;
    return { action: "direct" };
  }

  // Fallback: direct
  stats.direct += 1;
  return { action: "direct" };
}
