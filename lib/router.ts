import type { ProxyConfig } from "./config.js";
import { findMatchingRule } from "./conditions.js";
import { resolveProxyServer } from "./config.js";
import { stats } from "./stats.js";

export type RouteResult =
  | { action: "direct" }
  | { action: "proxy"; server: string; profileName: string };

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
    (p) => p.name === config.profileName,
  );

  if (config.profileName === "direct") {
    stats.direct += 1;
    return { action: "direct" };
  }

  if (config.profileName === "system") {
    const server = resolveProxyServer(config, "system");
    if (server) {
      stats.proxy += 1;
      return { action: "proxy", server, profileName: "system" };
    }
    stats.direct += 1;
    return { action: "direct" };
  }

  if (activeProfile && activeProfile.type === "proxy_server") {
    const server =
      activeProfile.server ?? resolveProxyServer(config, activeProfile.name);
    if (server) {
      stats.proxy += 1;
      return { action: "proxy", server, profileName: activeProfile.name };
    }
    stats.direct += 1;
    return { action: "direct" };
  }

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
      return { action: "proxy", server, profileName: targetName };
    }

    stats.direct += 1;
    return { action: "direct" };
  }

  stats.direct += 1;
  return { action: "direct" };
}
