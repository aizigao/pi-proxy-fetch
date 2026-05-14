/**
 * pi-proxy — 智能代理路由
 *
 * 根据 ~/.pi/proxy.json 规则决定每个请求：
 *   - direct:   永远直连
 *   - proxy:    永远走代理
 *   - fallback: 先直连，网络错误时走代理重试（默认）
 *
 * AI API 调用、本地服务等可配置为 direct，不受影响。
 */
import { ProxyAgent } from "undici";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Types ──────────────────────────────────────────────
type Action = "direct" | "proxy" | "fallback";

interface Rule {
	match: string;
	action: Action;
	comment?: string;
}

interface ProxyConfig {
	proxy: string;
	enabled: boolean;
	mode: Action; // global default
	rules: Rule[];
}

// ─── Config ─────────────────────────────────────────────
const CONFIG_PATH = join(homedir(), ".pi", "proxy.json");

const DEFAULT_CONFIG: ProxyConfig = {
	proxy: "http://127.0.0.1:7890",
	enabled: true,
	mode: "fallback",
	rules: [
		{ match: "localhost,127.0.0.1,*.local,10.*,192.168.*", action: "direct" },
		{ match: "*", action: "fallback" },
	],
};

function loadConfig(): ProxyConfig {
	try {
		if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		return { ...DEFAULT_CONFIG, ...parsed };
	} catch {
		return DEFAULT_CONFIG;
	}
}

// ─── Pattern Matching ───────────────────────────────────
function parsePatterns(match: string): string[] {
	return match.split(",").map((s) => s.trim()).filter(Boolean);
}

function matchPattern(hostname: string, pattern: string): boolean {
	if (pattern === "*") return true;

	// IP prefix match: "10.*", "192.168.*"
	if (pattern.endsWith(".*")) {
		const prefix = pattern.slice(0, -1); // "10."
		return hostname.startsWith(prefix);
	}

	// Wildcard subdomain: "*.example.com"
	if (pattern.startsWith("*.")) {
		const suffix = pattern.slice(1); // ".example.com"
		return hostname === pattern.slice(2) || hostname.endsWith(suffix);
	}

	// Exact match
	return hostname === pattern;
}

function resolveAction(url: string, config: ProxyConfig): Action {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return "direct"; // 无法解析的 URL 直连
	}

	for (const rule of config.rules) {
		const patterns = parsePatterns(rule.match);
		if (patterns.some((p) => matchPattern(hostname, p))) {
			return rule.action;
		}
	}

	return config.mode; // 无匹配规则 → 用全局默认
}

// ─── Network Error Detection ────────────────────────────
const NETWORK_ERRORS = [
	"ECONNREFUSED",
	"ETIMEDOUT",
	"ENOTFOUND",
	"ENETUNREACH",
	"ECONNRESET",
	"EHOSTUNREACH",
	"EAI_AGAIN",
	"UND_ERR_CONNECT_TIMEOUT",
	"fetch failed",
];

function isNetworkError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return NETWORK_ERRORS.some((code) => msg.includes(code));
}

// ─── Proxy Agent ────────────────────────────────────────
let proxyAgent: ProxyAgent | null = null;
let currentProxyUrl = "";

function getProxyAgent(proxyUrl: string): ProxyAgent {
	if (!proxyAgent || currentProxyUrl !== proxyUrl) {
		proxyAgent = new ProxyAgent(proxyUrl);
		currentProxyUrl = proxyUrl;
	}
	return proxyAgent;
}

// ─── Stats ──────────────────────────────────────────────
let stats = { direct: 0, proxy: 0, fallback: 0, fallbackHit: 0 };

// ─── Extension ──────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	let config = loadConfig();
	const originalFetch = globalThis.fetch;

	const patchedFetch: typeof fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: (input as Request).url;

		// 插件关闭 → 全部直连
		if (!config.enabled) {
			return originalFetch(input, init);
		}

		const action = resolveAction(url, config);

		if (action === "direct") {
			stats.direct++;
			return originalFetch(input, init);
		}

		if (action === "proxy") {
			stats.proxy++;
			return originalFetch(input, {
				...init,
				// @ts-ignore undici dispatcher
				dispatcher: getProxyAgent(config.proxy),
			});
		}

		// fallback: 先直连，失败走代理
		stats.fallback++;
		try {
			return await originalFetch(input, init);
		} catch (err) {
			if (!isNetworkError(err)) throw err;
			stats.fallbackHit++;
			return originalFetch(input, {
				...init,
				// @ts-ignore undici dispatcher
				dispatcher: getProxyAgent(config.proxy),
			});
		}
	};

	globalThis.fetch = patchedFetch;

	// ─── Commands ─────────────────────────────────────────
	pi.registerCommand("proxy", {
		description: "Proxy settings",
		handler: async (_args, ctx) => {
			const status = config.enabled ? "ON" : "OFF";
			const toggleLabel = config.enabled ? "Turn OFF" : "Turn ON";
			const choice = await ctx.ui.select(`pi-proxy [${status}] ${config.proxy}`, [
				toggleLabel,
				"Show stats",
				"Reload config",
				"Show rules",
			]);

			if (!choice) return;

			switch (choice) {
				case toggleLabel:
					config.enabled = !config.enabled;
					ctx.ui.notify(`pi-proxy: ${config.enabled ? "ON" : "OFF"}`, config.enabled ? "success" : "info");
					break;
				case "Show stats":
					ctx.ui.notify(
						`direct: ${stats.direct} | proxy: ${stats.proxy} | fallback: ${stats.fallback} (hit: ${stats.fallbackHit})`,
						"info",
					);
					break;
				case "Reload config":
					config = loadConfig();
					ctx.ui.notify(`Config reloaded (${config.rules.length} rules)`, "success");
					break;
				case "Show rules": {
					const status = config.enabled ? "ON" : "OFF";
					const lines = config.rules.map(
						(r) => `${r.action.padEnd(8)} ${r.match}${r.comment ? "  # " + r.comment : ""}`,
					);
					ctx.ui.notify(`[${status}] ${config.proxy}\n${lines.join("\n")}`, "info");
					break;
				}
			}
		},
	});

	pi.on("session_shutdown", async () => {
		globalThis.fetch = originalFetch;
	});
}
