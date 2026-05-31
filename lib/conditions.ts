import type { SwitchCondition, SwitchRule } from "./config.js";

// =============================================================================
// Wildcard → RegExp
// =============================================================================

function escapeRegex(literal: string): string {
  return literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegex(pattern: string): string {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === "*") {
      while (i < pattern.length && pattern[i] === "*") {
        i++;
      }
      // Treat any run of * as .* (greedy)
      result += ".*";
    } else if (pattern[i] === "?") {
      result += ".";
      i++;
    } else {
      result += escapeRegex(pattern[i]);
      i++;
    }
  }

  return result;
}

// =============================================================================
// Host wildcard matching
// =============================================================================

// SwitchyOmega special semantics for *. prefix:
//   *.example.com → matches example.com AND www.example.com (but not sub.www.example.com)
//   **.example.com → matches subdomains only (www.example.com, sub.www.example.com)

function buildHostWildcardRegex(pattern: string): RegExp {
  // Normalize to lowercase
  const normalized = pattern.toLowerCase();

  // Single * matches everything
  if (normalized === "*") {
    return /.*/i;
  }

  // **. prefix → subdomains only
  if (normalized.startsWith("**.")) {
    const rest = wildcardToRegex(normalized.slice(3));
    // At least one level of subdomain: .+ or (the domain itself preceded by a dot)
    return new RegExp(`^(.+\\.)?${rest}$`, "i");
  }

  // *. prefix → domain OR one-level subdomain
  if (normalized.startsWith("*.")) {
    const rest = wildcardToRegex(normalized.slice(2));
    // Zero or one subdomain level
    return new RegExp(`^(.*\\.)?${rest}$`, "i");
  }

  // Exact or wildcard match
  const regex = wildcardToRegex(normalized);
  return new RegExp(`^${regex}$`, "i");
}

const hostRegexCache = new Map<string, RegExp>();

function matchesHostWildcard(hostname: string, pattern: string): boolean {
  const cacheKey = `host:${pattern}`;
  let regex = hostRegexCache.get(cacheKey);
  if (!regex) {
    regex = buildHostWildcardRegex(pattern);
    hostRegexCache.set(cacheKey, regex);
  }
  return regex.test(hostname.toLowerCase());
}

// =============================================================================
// URL wildcard matching
// =============================================================================

function buildUrlWildcardRegex(pattern: string): RegExp {
  if (pattern === "*") {
    return /.*/;
  }
  const regex = wildcardToRegex(pattern.toLowerCase());
  return new RegExp(`^${regex}$`, "i");
}

const urlWildcardCache = new Map<string, RegExp>();

function matchesUrlWildcard(url: string, pattern: string): boolean {
  const cacheKey = `url:${pattern}`;
  let regex = urlWildcardCache.get(cacheKey);
  if (!regex) {
    regex = buildUrlWildcardRegex(pattern);
    urlWildcardCache.set(cacheKey, regex);
  }
  return regex.test(url.toLowerCase());
}

// =============================================================================
// URL regex matching
// =============================================================================

const urlRegexCache = new Map<string, RegExp>();

function matchesUrlRegex(url: string, pattern: string): boolean {
  const cacheKey = `rx:${pattern}`;
  let regex = urlRegexCache.get(cacheKey);
  if (!regex) {
    try {
      regex = new RegExp(pattern, "i");
      urlRegexCache.set(cacheKey, regex);
    } catch {
      return false;
    }
  }
  return regex.test(url);
}

// =============================================================================
// Condition dispatcher
// =============================================================================

function matchCondition(
  condition: SwitchCondition,
  url: string,
  hostname: string,
): boolean {
  switch (condition.type) {
    case "host":
      return matchesHostWildcard(hostname, condition.pattern ?? "*");

    case "url":
      return matchesUrlWildcard(url, condition.pattern ?? "*");

    case "regex":
      return matchesUrlRegex(url, condition.pattern ?? "");

    case "disabled":
      return false;

    default:
      return false;
  }
}

// =============================================================================
// Rule matching (OR logic)
// =============================================================================

export function matchRule(rule: SwitchRule, url: string, hostname: string): boolean {
  const conditions = rule.conditions;
  // Empty or missing conditions → unconditional match (catch-all)
  if (!conditions || conditions.length === 0) {
    return true;
  }

  return conditions.some((c) => matchCondition(c, url, hostname));
}

// Find the first matching rule in the list
export function findMatchingRule(
  rules: SwitchRule[],
  url: string,
  hostname: string,
): SwitchRule | undefined {
  return rules.find((rule) => matchRule(rule, url, hostname));
}
