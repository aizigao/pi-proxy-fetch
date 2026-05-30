import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

export interface SwitchCondition {
  conditionType: ConditionType;
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
  profile_name: string;
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
        conditionType: (pattern.includes("*://") || pattern.includes("http"))
          ? ("UrlWildcardCondition" as ConditionType)
          : ("HostWildcardCondition" as ConditionType),
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
    profile_name: profileName,
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

  if (typeof obj.profile_name !== "string" || !obj.profile_name.trim()) {
    return '"profile_name" is required and must be a non-empty string';
  }

  if (!Array.isArray(obj.profileConfig)) {
    return '"profileConfig" must be an array';
  }

  const profileName = obj.profile_name.trim();
  if (profileName !== "direct" && profileName !== "system") {
    const found = (obj.profileConfig as unknown[]).find(
      (p) =>
        p && typeof p === "object" && (p as Record<string, unknown>).name === profileName,
    );
    if (!found) {
      return `profile_name "${profileName}" not found in profileConfig (or not a reserved name: "direct", "system")`;
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
    if (fromProject) return fromProject;
  }

  // 2. Project-local proxy.json
  if (projectPaths) {
    const fromProject = tryLoadFile(
      projectPaths.json,
      ".pi/proxy.json",
    );
    if (fromProject) return fromProject;
  }

  const globalPaths = getGlobalConfigPaths();

  // 3. Global proxy.jsonc
  const fromGlobal = tryLoadFile(
    globalPaths.jsonc,
    "~/.pi/proxy.jsonc",
  );
  if (fromGlobal) return fromGlobal;

  // 4. Global proxy.json
  const fromGlobalJson = tryLoadFile(
    globalPaths.json,
    "~/.pi/proxy.json",
  );
  if (fromGlobalJson) return fromGlobalJson;

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
  if (config.profile_name === "direct") {
    return { name: "direct", type: "proxy_server" };
  }
  if (config.profile_name === "system") {
    return { name: "system", type: "proxy_server" };
  }
  return config.profileConfig.find((p) => p.name === config.profile_name);
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
