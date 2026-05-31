import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// Types
// =============================================================================

export type ProfileType = "proxy_server" | "autoSwitch";

export type ConditionType = "host" | "url" | "regex" | "disabled";

function normalizeConditionType(type: string): ConditionType | null {
  return type === "host" ||
    type === "url" ||
    type === "regex" ||
    type === "disabled"
    ? type
    : null;
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
  caCertPath?: string;
  ruleListURL?: string;
  switchRules?: SwitchRule[];
}

export interface ProxyConfig {
  $schema: string;
  version: number;
  enabled: boolean;
  profileName: string;
  profileConfig: Profile[];
}

const PROFILE_NAME_PATTERN = /^[A-Za-z_-]+$/;

function isReservedProfileName(name: string): boolean {
  return name === "direct" || name === "system";
}

function validateProfileName(name: string, field: string): string | null {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    return `${field}: must match ${PROFILE_NAME_PATTERN}`;
  }
  return null;
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

function getProjectConfigPath(): string | null {
  try {
    return join(process.cwd(), ".pi", "proxy.json");
  } catch {
    return null;
  }
}

function getGlobalConfigPath(): string {
  return join(getAgentDir(), "proxy.json");
}

function getGlobalRuleListDir(): string {
  return getAgentDir();
}

function processContent(raw: string): unknown {
  return JSON.parse(raw);
}

function createDefaultConfig(): ProxyConfig {
  return {
    $schema:
      "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
    version: 1,
    enabled: false,
    profileName: "direct",
    profileConfig: [
      {
        name: "my_clash",
        type: "proxy_server",
        server: "http://127.0.0.1:7890",
      },
      {
        name: "auto-switch",
        type: "autoSwitch",
        switchRules: [
          {
            note: "Force direct",
            conditions: [],
            profileName: "direct",
          },
          {
            note: "Force proxy",
            conditions: [],
            profileName: "my_clash",
          },
        ],
      },
    ],
  };
}

function getBackupPath(filePath: string): string {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  return `${dir}/proxy.bak.json`;
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
  const nameError = validateProfileName(p.name, `profileConfig[${index}].name`);
  if (nameError) return nameError;

  if (p.type !== "proxy_server" && p.type !== "autoSwitch") {
    return `profileConfig[${index}] "${p.name}": "type" must be "proxy_server" or "autoSwitch"`;
  }

  if (p.type === "proxy_server") {
    if (typeof p.server !== "string" || !p.server.trim()) {
      return `profileConfig[${index}] "${p.name}": "server" is required and must be a non-empty string`;
    }
  }

  if (
    p.type === "proxy_server" &&
    p.caCertPath !== undefined &&
    typeof p.caCertPath !== "string"
  ) {
    return `profileConfig[${index}] "${p.name}": "caCertPath" must be a string`;
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
        const targetName = rule.profileName.trim();
        if (!isReservedProfileName(targetName)) {
          const targetNameError = validateProfileName(
            targetName,
            `profileConfig[${index}] "${p.name}" switchRules[${j}].profileName`,
          );
          if (targetNameError) return targetNameError;
        }
        if (rule.conditions !== undefined && !Array.isArray(rule.conditions)) {
          return `profileConfig[${index}] "${p.name}" switchRules[${j}]: "conditions" must be an array`;
        }
        if (Array.isArray(rule.conditions)) {
          for (let k = 0; k < rule.conditions.length; k++) {
            const cond = rule.conditions[k] as Record<string, unknown>;
            if (!cond || typeof cond !== "object") {
              return `profileConfig[${index}] "${p.name}" switchRules[${j}] conditions[${k}]: must be an object`;
            }
            if (
              typeof cond.type !== "string" ||
              !normalizeConditionType(cond.type)
            ) {
              return `profileConfig[${index}] "${p.name}" switchRules[${j}] conditions[${k}]: invalid "type"`;
            }
          }
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

  if (obj.version !== 1) {
    return '"version" must be 1';
  }

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
  if (!isReservedProfileName(profileName)) {
    const profileNameError = validateProfileName(profileName, "profileName");
    if (profileNameError) return profileNameError;
  }
  if (profileName !== "direct" && profileName !== "system") {
    const found = (obj.profileConfig as unknown[]).find(
      (p) =>
        p &&
        typeof p === "object" &&
        (p as Record<string, unknown>).name === profileName,
    );
    if (!found) {
      return `profileName "${profileName}" not found in profileConfig (or not a reserved name: "direct", "system")`;
    }
  }

  for (let i = 0; i < (obj.profileConfig as unknown[]).length; i++) {
    const error = validateProfile((obj.profileConfig as unknown[])[i], i);
    if (error) return error;
  }

  const profileNames = new Set(
    (obj.profileConfig as Array<Record<string, unknown>>).map((p) => p.name),
  );
  for (let i = 0; i < (obj.profileConfig as unknown[]).length; i++) {
    const profile = (obj.profileConfig as unknown[])[i] as Record<
      string,
      unknown
    >;
    if (profile.type !== "autoSwitch" || !Array.isArray(profile.switchRules))
      continue;

    for (let j = 0; j < profile.switchRules.length; j++) {
      const rule = profile.switchRules[j] as Record<string, unknown>;
      const targetName = rule.profileName as string;
      if (!isReservedProfileName(targetName) && !profileNames.has(targetName)) {
        return `profileConfig[${i}] "${profile.name}" switchRules[${j}]: profileName "${targetName}" not found in profileConfig`;
      }
    }
  }

  return obj as unknown as ProxyConfig;
}

// =============================================================================
// Config loading
// =============================================================================

let _cached: ProxyConfig | null = null;

function normalizeConfig(config: ProxyConfig): ProxyConfig {
  return {
    ...config,
    profileConfig: config.profileConfig.map((profile) => {
      if (profile.type !== "autoSwitch" || !profile.switchRules) {
        return { ...profile };
      }

      return {
        ...profile,
        switchRules: profile.switchRules.map((rule) => ({
          ...rule,
          conditions: rule.conditions?.map((condition) => ({
            ...condition,
            type: normalizeConditionType(condition.type) ?? condition.type,
          })),
        })),
      };
    }),
  };
}

function writeDefaultGlobalConfig(): ProxyConfig {
  const globalPath = getGlobalConfigPath();
  mkdirSync(getAgentDir(), { recursive: true });

  const defaultConfig = createDefaultConfig();
  writeFileSync(globalPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf8");
  _cached = normalizeConfig(defaultConfig);
  console.error(`[proxy] No config found. Created default config at ${globalPath}`);
  return _cached;
}

function tryLoadFile(filePath: string, label: string): ProxyConfig | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = processContent(raw);
    const result = validateConfig(parsed);
    if (typeof result === "string") {
      if (result === '"version" must be 1') {
        const backupPath = getBackupPath(filePath);
        writeFileSync(backupPath, raw, "utf8");
        const defaultConfig = createDefaultConfig();
        writeFileSync(
          filePath,
          JSON.stringify(defaultConfig, null, 2) + "\n",
          "utf8",
        );
        _cached = defaultConfig;
        console.error(
          `[proxy] Unsupported config version in ${label}. Backed up to ${backupPath} and created a default config.`,
        );
        console.error(
          `[proxy] Please update your config to the current format. See: https://github.com/aizigao/pi-proxy-fetch/blob/master/README.md`,
        );
        return _cached;
      }

      console.error(`[proxy] Invalid ${label}: ${result}`);
      return null;
    }
    _cached = normalizeConfig(result);
    return _cached;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] Failed to parse ${label}: ${message}`);
    return null;
  }
}

export function readConfig(): ProxyConfig | null {
  const projectPath = getProjectConfigPath();
  const projectConfigExists = projectPath ? existsSync(projectPath) : false;

  // 1. Project-local proxy.json
  if (projectPath) {
    const fromProject = tryLoadFile(projectPath, ".pi/proxy.json");
    if (fromProject) {
      loadRuleListsForConfig(fromProject, join(process.cwd(), ".pi"));
      return fromProject;
    }
  }

  // 2. Global proxy.json
  const globalPath = getGlobalConfigPath();
  const globalConfigExists = existsSync(globalPath);
  const fromGlobal = tryLoadFile(globalPath, "~/.pi/agent/proxy.json");
  if (fromGlobal) {
    loadRuleListsForConfig(fromGlobal, getGlobalRuleListDir());
    return fromGlobal;
  }

  if (!projectConfigExists && !globalConfigExists) {
    return writeDefaultGlobalConfig();
  }

  return _cached;
}

function loadRuleListsForConfig(config: ProxyConfig, configDir: string): void {
  let defaultProfile = "my-clash";
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
  const projectPath = getProjectConfigPath();
  const outPath =
    projectPath && existsSync(projectPath)
      ? projectPath
      : getGlobalConfigPath();

  if (outPath === getGlobalConfigPath()) {
    mkdirSync(getAgentDir(), { recursive: true });
  }

  const persistedConfig = stripRuntimeRuleLists(config);
  writeFileSync(
    outPath,
    JSON.stringify(persistedConfig, null, 2) + "\n",
    "utf8",
  );
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
      (process.env.http_proxy as string | undefined) ??
      (process.env.HTTP_PROXY as string | undefined) ??
      (process.env.https_proxy as string | undefined) ??
      (process.env.HTTPS_PROXY as string | undefined);
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

function parseRuleList(text: string, defaultProfileName: string): SwitchRule[] {
  const rules: SwitchRule[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    let rawType = "";
    let pattern = "";
    let profileName = defaultProfileName;

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
    } else if (line.startsWith("||")) {
      const domain = line.slice(2);
      if (domain.includes("/")) {
        rawType = "url";
        pattern = `*://${domain}*`;
      } else {
        rawType = "host";
        pattern = domain;
      }
    } else if (line.startsWith("|")) {
      rawType = "url";
      pattern = line.slice(1);
    } else if (line.startsWith("/") && line.endsWith("/")) {
      rawType = "regex";
      pattern = line.slice(1, -1);
    } else {
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

const BASE_SWITCH_RULES_LENGTH = "__baseSwitchRulesLength";

type RuntimeProfileMeta = Profile & {
  [BASE_SWITCH_RULES_LENGTH]?: number;
};

function mergeRuleList(
  config: ProxyConfig,
  profileName: string,
  ruleEntries: SwitchRule[],
): void {
  for (const profile of config.profileConfig) {
    if (profile.name !== profileName || profile.type !== "autoSwitch") continue;

    const p = profile as RuntimeProfileMeta;
    const currentRules = p.switchRules ?? [];
    const baseLength = p[BASE_SWITCH_RULES_LENGTH] ?? currentRules.length;
    if (p[BASE_SWITCH_RULES_LENGTH] === undefined) {
      Object.defineProperty(p, BASE_SWITCH_RULES_LENGTH, {
        value: baseLength,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }

    const baseRules = currentRules.slice(0, baseLength);
    p.switchRules = [...baseRules, ...ruleEntries];
  }
}

function isGeneratedDefaultRule(rule: SwitchRule): boolean {
  const note = rule.note ?? "";

  if (note === "Try direct, proxy on failure") {
    return (
      rule.profileName === "default proxy" &&
      rule.conditions?.length === 1 &&
      rule.conditions[0]?.type === "host" &&
      rule.conditions[0]?.pattern === "*"
    );
  }

  if (note === "Local/intranet") {
    const patterns = (rule.conditions ?? []).map((c) => c.pattern ?? "");
    return (
      rule.profileName === "direct" &&
      patterns.length === 5 &&
      patterns.includes("localhost") &&
      patterns.includes("127.0.0.1") &&
      patterns.includes("*.local") &&
      patterns.includes("10.*") &&
      patterns.includes("192.168.*")
    );
  }

  return false;
}

function stripRuntimeRuleLists(config: ProxyConfig): ProxyConfig {
  return {
    ...config,
    profileConfig: config.profileConfig.map((profile) => {
      if (profile.type !== "autoSwitch") {
        return { ...profile };
      }

      const runtimeProfile = profile as RuntimeProfileMeta;
      const baseLength = runtimeProfile[BASE_SWITCH_RULES_LENGTH];
      const baseRules =
        baseLength === undefined
          ? (profile.switchRules ?? [])
          : (profile.switchRules ?? []).slice(0, baseLength);

      const { [BASE_SWITCH_RULES_LENGTH]: _ignored, ...cleanProfile } = runtimeProfile;
      return {
        ...cleanProfile,
        switchRules: baseRules.filter((rule) => !isGeneratedDefaultRule(rule)),
      };
    }),
  };
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
  let configDir = getGlobalRuleListDir();
  const projectPath = getProjectConfigPath();
  if (projectPath && existsSync(projectPath)) {
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

export async function syncRuleList(
  config: ProxyConfig,
  options?: { force?: boolean },
): Promise<void> {
  let configDir = getGlobalRuleListDir();

  const projectPath = getProjectConfigPath();
  if (projectPath && existsSync(projectPath)) {
    configDir = join(process.cwd(), ".pi");
  }

  for (const profile of config.profileConfig) {
    if (profile.type !== "autoSwitch" || !profile.ruleListURL) continue;

    const url = profile.ruleListURL;
    const name = profile.name;
    const ruleListFile = getRuleListPath(configDir, name);

    if (options?.force || !existsSync(ruleListFile)) {
      mkdirSync(configDir, { recursive: true });
      try {
        console.error(`[proxy] Downloading rule list from ${url}...`);
        const raw = await rawFetch(url);
        const cleaned = raw.replace(/\s/g, "");
        const decoded = /^[A-Za-z0-9+/=]+$/.test(cleaned)
          ? Buffer.from(cleaned, "base64").toString("utf8")
          : raw;
        writeFileSync(ruleListFile, decoded, "utf8");
        console.error(`[proxy] Rule list saved to ${ruleListFile}`);
      } catch (err) {
        console.error(`[proxy] Rule list download failed:`, err);
        continue;
      }
    }

    let defaultProfile = "my-clash";
    const proxyProfile = config.profileConfig.find(
      (p) => p.type === "proxy_server" && p.server,
    );
    if (proxyProfile) defaultProfile = proxyProfile.name;

    tryLoadRuleListFile(config, name, defaultProfile, configDir);
  }
}
