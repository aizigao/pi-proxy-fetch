import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";

// =============================================================================
// Types
// =============================================================================

export type ProfileType = "proxy_server" | "autoSwitch";

export type ConditionType =
  | "HostWildcardCondition"
  | "UrlWildcardCondition"
  | "UrlRegexCondition"
  | "DisabledCondition";

// Short aliases used in proxy.jsonc
const CONDITION_MAP: Record<string, ConditionType> = {
  host: "HostWildcardCondition",
  url: "UrlWildcardCondition",
  regex: "UrlRegexCondition",
  disabled: "DisabledCondition",
};

function normalizeConditionType(type: string): ConditionType | null {
  return CONDITION_MAP[type] ?? null;
}

export interface SwitchCondition {
  type: string;
  pattern?: string;
}

export interface SwitchRule {
  note?: string;
  conditions?: SwitchCondition[];
  profileName: string;
}

export interface Profile {
  name: string;
  type: ProfileType;
  server?: string;
  ruleListURL?: string;
  switchRules?: SwitchRule[];
}

export interface ProxyConfig {
  enabled: boolean;
  profileName: string;
  profileConfig: Profile[];
}

// Old format types (for migration)
type LegacyAction = "direct" | "proxy" | "fallback";

interface LegacyRule {
  match?: string;
  action?: LegacyAction;
  comment?: string;
}

interface LegacyConfig {
  enabled?: boolean;
  proxy?: string;
  mode?: LegacyAction;
  rules?: LegacyRule[];
}

// =============================================================================
// Path helpers
// =============================================================================

function getAgentDir(): string {
  return (
    (process.env.PI_CODING_AGENT_DIR as string | undefined) ??
    join(homedir(), ".pi", "agent")
  );
}

function getProjectConfigPaths(): { jsonc: string; json: string } | null {
  try {
    const projectDir = join(process.cwd(), ".pi");
    return {
      jsonc: join(projectDir, "proxy.jsonc"),
      json: join(projectDir, "proxy.json"),
    };
  } catch {
    return null;
  }
}

function getGlobalConfigPaths(): { jsonc: string; json: string } {
  const homeDir = join(homedir(), ".pi");
  return {
    jsonc: join(homeDir, "proxy.jsonc"),
    json: join(homeDir, "proxy.json"),
  };
}

function getLegacyConfigPath(): string {
  return join(getAgentDir(), "proxy.json");
}

// =============================================================================
// JSONC parsing
// =============================================================================

function processContent(raw: string): unknown {
  return jsonc.parse(raw);
}

// =============================================================================
// Legacy migration
// =============================================================================

function migrateLegacyAction(action: LegacyAction | undefined): string {
  switch (action) {
    case "direct":
      return "direct";
    case "proxy":
    case "fallback":
      return "default proxy";
    default:
      return "default proxy";
  }
}

function migrateLegacyConfig(legacy: LegacyConfig): ProxyConfig {
  const proxyServerName = "default proxy";

  const profileConfig: Profile[] = [];

  if (legacy.proxy) {
    profileConfig.push({
      name: proxyServerName,
      type: "proxy_server",
      server: legacy.proxy,
    });
  }

  const switchRules: SwitchRule[] = (legacy.rules ?? []).map((rule) => {
    const patterns = (rule.match ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      note: rule.comment,
      conditions: patterns.map((pattern) => ({
        type: (pattern.includes("*://") || pattern.includes("http"))
          ? ("url" as ConditionType)
          : ("host" as ConditionType),
        pattern,
      })),
      profileName: migrateLegacyAction(rule.action),
    };
  });

  let profileName: string;
  if (legacy.mode === "direct") {
    profileName = "direct";
  } else if (legacy.mode === "proxy") {
    profileName = proxyServerName;
  } else {
    profileName = "auto switch";
  }

  if (switchRules.length > 0) {
    profileConfig.push({
      name: "auto switch",
      type: "autoSwitch",
      switchRules,
    });
  }

  if (
    profileName === "auto switch" &&
    !profileConfig.find((p) => p.name === "auto switch")
  ) {
    profileConfig.push({
      name: "auto switch",
      type: "autoSwitch",
      switchRules,
    });
  }

  return {
    enabled: legacy.enabled ?? true,
    profileName: profileName,
    profileConfig,
  };
}

// =============================================================================
// Schema validation
// =============================================================================

function validateProfile(profile: unknown, index: number): string | null {
  if (!profile || typeof profile !== "object") {
    return `profileConfig[${index}]: must be an object`;
  }
  const p = profile as Record<string, unknown>;

  if (typeof p.name !== "string" || !p.name.trim()) {
    return `profileConfig[${index}]: missing or invalid "name"`;
  }

  if (p.type !== "proxy_server" && p.type !== "autoSwitch") {
    return `profileConfig[${index}] "${p.name}": "type" must be "proxy_server" or "autoSwitch"`;
  }

  if (
    p.type === "proxy_server" &&
    p.server !== undefined &&
    typeof p.server !== "string"
  ) {
    return `profileConfig[${index}] "${p.name}": "server" must be a string`;
  }

  if (p.type === "autoSwitch") {
    if (p.switchRules !== undefined) {
      if (!Array.isArray(p.switchRules)) {
        return `profileConfig[${index}] "${p.name}": "switchRules" must be an array`;
      }
      for (let j = 0; j < (p.switchRules as unknown[]).length; j++) {
        const rule = (p.switchRules as unknown[])[j] as
          | Record<string, unknown>
          | undefined;
        if (!rule || typeof rule !== "object") {
          return `profileConfig[${index}] "${p.name}" switchRules[${j}]: must be an object`;
        }
        if (typeof rule.profileName !== "string" || !rule.profileName.trim()) {
          return `profileConfig[${index}] "${p.name}" switchRules[${j}]: missing or invalid "profileName"`;
        }
        if (
          rule.conditions !== undefined &&
          !Array.isArray(rule.conditions)
        ) {
          return `profileConfig[${index}] "${p.name}" switchRules[${j}]: "conditions" must be an array`;
        }
      }
    }
  }

  return null;
}

function validateConfig(raw: unknown): ProxyConfig | string {
  if (!raw || typeof raw !== "object") {
    return "config must be a JSON object";
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.enabled !== "boolean") {
    return '"enabled" must be a boolean';
  }

  if (typeof obj.profileName !== "string" || !obj.profileName.trim()) {
    return '"profileName" is required and must be a non-empty string';
  }

  if (!Array.isArray(obj.profileConfig)) {
    return '"profileConfig" must be an array';
  }

  const profileName = obj.profileName.trim();
  if (profileName !== "direct" && profileName !== "system") {
    const found = (obj.profileConfig as unknown[]).find(
      (p) =>
        p && typeof p === "object" && (p as Record<string, unknown>).name === profileName,
    );
    if (!found) {
      return `profileName "${profileName}" not found in profileConfig (or not a reserved name: "direct", "system")`;
    }
  }

  for (let i = 0; i < (obj.profileConfig as unknown[]).length; i++) {
    const error = validateProfile((obj.profileConfig as unknown[])[i], i);
    if (error) return error;
  }

  for (let i = 0; i < (obj.profileConfig as unknown[]).length; i++) {
    const p = (obj.profileConfig as unknown[])[i] as Record<string, unknown>;
    if (p.type !== "autoSwitch" || !Array.isArray(p.switchRules)) continue;

    for (let j = 0; j < (p.switchRules as unknown[]).length; j++) {
      const rule = (p.switchRules as unknown[])[j] as Record<string, unknown>;
      const targetName = (rule.profileName as string)?.trim();
      if (!targetName) continue;
      if (targetName === "direct" || targetName === "system") continue;

      const found = (obj.profileConfig as unknown[]).find(
        (pp) =>
          pp &&
          typeof pp === "object" &&
          (pp as Record<string, unknown>).name === targetName,
      );
      if (!found) {
        return (
          `profileConfig[${i}] "${p.name}" switchRules[${j}]: ` +
          `profileName "${targetName}" not found in profileConfig`
        );
      }
    }
  }

  return obj as unknown as ProxyConfig;
}

// =============================================================================
// Config loading
// =============================================================================

let _cached: ProxyConfig | null = null;

function tryLoadFile(
  filePath: string,
  label: string,
): ProxyConfig | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    const result = validateConfig(processContent(raw));
    if (typeof result === "string") {
      console.error(`[proxy] Invalid ${label}: ${result}`);
      return null;
    }
    _cached = result;
    return result;
  } catch (err) {
    console.error(`[proxy] Failed to parse ${label}:`, err);
    return null;
  }
}

export function readConfig(): ProxyConfig | null {
  const projectPaths = getProjectConfigPaths();

  // 1. Project-local proxy.jsonc
  if (projectPaths) {
    const fromProject = tryLoadFile(
      projectPaths.jsonc,
      ".pi/proxy.jsonc",
    );
    if (fromProject) {
      loadRuleListsForConfig(fromProject, join(process.cwd(), ".pi"));
      return fromProject;
    }
  }

  // 2. Project-local proxy.json
  if (projectPaths) {
    const fromProject = tryLoadFile(
      projectPaths.json,
      ".pi/proxy.json",
    );
    if (fromProject) {
      loadRuleListsForConfig(fromProject, join(process.cwd(), ".pi"));
      return fromProject;
    }
  }

  const globalPaths = getGlobalConfigPaths();

  // 3. Global proxy.jsonc
  const fromGlobal = tryLoadFile(
    globalPaths.jsonc,
    "~/.pi/proxy.jsonc",
  );
  if (fromGlobal) {
    loadRuleListsForConfig(fromGlobal, join(homedir(), ".pi"));
    return fromGlobal;
  }

  // 4. Global proxy.json
  const fromGlobalJson = tryLoadFile(
    globalPaths.json,
    "~/.pi/proxy.json",
  );
  if (fromGlobalJson) {
    loadRuleListsForConfig(fromGlobalJson, join(homedir(), ".pi"));
    return fromGlobalJson;
  }

  // 5. Legacy migration
  const legacyPath = getLegacyConfigPath();
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, "utf8");
      const legacy = JSON.parse(raw) as LegacyConfig;
      const migrated = migrateLegacyConfig(legacy);

      const outPath = getGlobalConfigPaths().jsonc;
      writeFileSync(outPath, JSON.stringify(migrated, null, 2) + "\n", "utf8");
      console.error(
        `[proxy] Migrated ~/.pi/agent/proxy.json → ~/.pi/proxy.jsonc`,
      );

      _cached = migrated;
      return migrated;
    } catch (err) {
      console.error("[proxy] Failed to migrate legacy config:", err);
      return _cached;
    }
  }

  return _cached;
}

function loadRuleListsForConfig(
  config: ProxyConfig,
  configDir: string,
): void {
  let defaultProfile = "my clash";
  const proxyProfile = config.profileConfig.find(
    (p) => p.type === "proxy_server" && p.server,
  );
  if (proxyProfile) defaultProfile = proxyProfile.name;

  for (const profile of config.profileConfig) {
    if (profile.type === "autoSwitch" && profile.ruleListURL) {
      tryLoadRuleListFile(config, profile.name, defaultProfile, configDir);
    }
  }
}

export function reloadConfig(): ProxyConfig | null {
  _cached = null;
  return readConfig();
}

export function writeConfig(config: ProxyConfig): void {
  // Write to project-local if it exists, otherwise global
  const projectPaths = getProjectConfigPaths();
  let outPath: string;

  if (projectPaths && existsSync(projectPaths.jsonc)) {
    outPath = projectPaths.jsonc;
  } else if (projectPaths && existsSync(projectPaths.json)) {
    outPath = projectPaths.jsonc; // migrate to jsonc
  } else {
    outPath = getGlobalConfigPaths().jsonc;
  }

  writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function resolveProfile(config: ProxyConfig): Profile | undefined {
  if (config.profileName === "direct") {
    return { name: "direct", type: "proxy_server" };
  }
  if (config.profileName === "system") {
    return { name: "system", type: "proxy_server" };
  }
  return config.profileConfig.find((p) => p.name === config.profileName);
}

export function resolveProxyServer(
  config: ProxyConfig,
  profileName: string,
): string | undefined {
  if (profileName === "direct") return undefined;
  if (profileName === "system") {
    const envProxy =
      (process.env.HTTPS_PROXY as string | undefined) ??
      (process.env.HTTP_PROXY as string | undefined);
    return envProxy ?? undefined;
  }

  const profile = config.profileConfig.find(
    (p) => p.name === profileName && p.type === "proxy_server",
  );
  return profile?.server;
}

// =============================================================================
// Rule list download
// =============================================================================

function getRuleListPath(configDir: string, profileName: string): string {
  const safeName = profileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(configDir, `proxy-rulelist-file--${safeName}.txt`);
}

function parseRuleList(
  text: string,
  defaultProfileName: string,
): SwitchRule[] {
  const rules: SwitchRule[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    let rawType = "";
    let pattern = "";
    let profileName = defaultProfileName;

    // Exception (whitelist)
    if (line.startsWith("@@")) {
      profileName = "direct";
      const rest = line.slice(2);
      if (rest.startsWith("||")) {
        const domain = rest.slice(2);
        if (domain.includes("/")) {
          rawType = "url";
          pattern = `*://${domain}*`;
        } else {
          rawType = "host";
          pattern = domain;
        }
      } else if (rest.startsWith("|")) {
        rawType = "url";
        pattern = rest.slice(1);
      } else if (rest.startsWith("/") && rest.endsWith("/")) {
        rawType = "regex";
        pattern = rest.slice(1, -1);
      } else {
        rawType = "url";
        pattern = `*${rest}*`;
      }
    }
    // Domain rule
    else if (line.startsWith("||")) {
      const domain = line.slice(2);
      if (domain.includes("/")) {
        rawType = "url";
        pattern = `*://${domain}*`;
      } else {
        rawType = "host";
        pattern = domain;
      }
    }
    // URL rule
    else if (line.startsWith("|")) {
      rawType = "url";
      pattern = line.slice(1);
    }
    // Regex rule
    else if (line.startsWith("/") && line.endsWith("/")) {
      rawType = "regex";
      pattern = line.slice(1, -1);
    }
    // Wildcard URL
    else {
      rawType = "url";
      pattern = `*://*${line}*`;
    }

    const conditionType = normalizeConditionType(rawType);
    if (!conditionType) continue;

    rules.push({
      conditions: [{ type: conditionType, pattern }],
      profileName,
    });
  }

  return rules;
}

function mergeRuleList(
  config: ProxyConfig,
  profileName: string,
  ruleEntries: SwitchRule[],
): void {
  for (const p of config.profileConfig) {
    if (p.name !== profileName || p.type !== "autoSwitch") continue;
    // Push entries to the end (after local rules)
    p.switchRules = [...(p.switchRules ?? []), ...ruleEntries];
  }
}

function tryLoadRuleListFile(
  config: ProxyConfig,
  profileName: string,
  defaultProfileName: string,
  configDir: string,
): void {
  const path = getRuleListPath(configDir, profileName);
  if (!existsSync(path)) return;

  try {
    const text = readFileSync(path, "utf8");
    const entries = parseRuleList(text, defaultProfileName);
    mergeRuleList(config, profileName, entries);
  } catch (err) {
    console.error(`[proxy] Failed to parse rule list ${path}:`, err);
  }
}

export function needsRuleListDownload(config: ProxyConfig): boolean {
  let configDir = join(homedir(), ".pi");
  const projectPaths = getProjectConfigPaths();
  if (projectPaths && (existsSync(projectPaths.jsonc) || existsSync(projectPaths.json))) {
    configDir = join(process.cwd(), ".pi");
  }

  for (const profile of config.profileConfig) {
    if (profile.type !== "autoSwitch" || !profile.ruleListURL) continue;
    if (!existsSync(getRuleListPath(configDir, profile.name))) {
      return true;
    }
  }
  return false;
}

function rawFetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get(url, (res: IncomingMessage) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

export async function syncRuleList(config: ProxyConfig): Promise<void> {
  const globalPaths = getGlobalConfigPaths();
  const globalDir = join(homedir(), ".pi");
  let configDir = globalDir;

  // If project-local config exists, use its dir
  const projectPaths = getProjectConfigPaths();
  if (projectPaths && (existsSync(projectPaths.jsonc) || existsSync(projectPaths.json))) {
    configDir = join(process.cwd(), ".pi");
  }

  // Scan for autoSwitch profiles with ruleListURL
  for (const profile of config.profileConfig) {
    if (profile.type !== "autoSwitch" || !profile.ruleListURL) continue;

    const url = profile.ruleListURL;
    const name = profile.name;
    const ruleListFile = getRuleListPath(configDir, name);

    // Download rule list
    if (!existsSync(ruleListFile)) {
      try {
        console.error(`[proxy] Downloading rule list from ${url}...`);
        const raw = await rawFetch(url);
        // gfwlist is base64-encoded
        const cleaned = raw.replace(/\s/g, "");
        let decoded: string;
        if (/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
          decoded = Buffer.from(cleaned, "base64").toString("utf8");
        } else {
          decoded = raw;
        }
        writeFileSync(ruleListFile, decoded, "utf8");
        console.error(
          `[proxy] Rule list saved to ${ruleListFile}`,
        );
      } catch (err) {
        console.error(`[proxy] Rule list download failed:`, err);
        continue;
      }
    }

    // Determine which proxy profile to use as default for rule entries
    // Look for the catch-all rule's profileName, or use the first proxy_server
    let defaultProfile = "my clash";
    const proxyProfile = config.profileConfig.find(
      (p) => p.type === "proxy_server" && p.server,
    );
    if (proxyProfile) defaultProfile = proxyProfile.name;

    tryLoadRuleListFile(config, name, defaultProfile, configDir);
  }
}
