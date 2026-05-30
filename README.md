# @aizigao/pi-proxy-fetch

中文文档：[`README-CN.md`](./README-CN.md)

A Pi extension package that routes `globalThis.fetch` through configurable proxy profiles with SwitchyOmega-style `switchRules`.

## What it does

`@aizigao/pi-proxy-fetch` monkey-patches `globalThis.fetch` inside a Pi session. It supports:

- **Multi-profile**: define multiple proxy servers (Clash, Whistle, etc.) and switch between them
- **Auto switch**: rule-based routing with Host wildcard / URL wildcard / URL regex conditions
- **Built-in profiles**: `direct` (no proxy) and `system` (reads `HTTP_PROXY` / `HTTPS_PROXY`)
- Per-session fetch patching with shutdown restore
- `/proxy` command for profile switching, stats, and rules

## Requirements

- Node.js 20+
- Pi coding agent installed

## Installation

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## Configuration

Create `~/.pi/proxy.jsonc` (JSON with comments, or standard `~/.pi/proxy.json`):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  "enabled": true,
  "profile_name": "auto switch",
  "profileConfig": [
    {
      "name": "my clash",
      "type": "proxy_server",
      "server": "socks5://127.0.0.1:7890"
    },
    {
      "name": "auto switch",
      "type": "autoSwitch",
      "switchRules": [
        {
          "note": "Local network — direct",
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "*.local" }
          ],
          "profileName": "direct"
        },
        {
          "note": "AI APIs — direct",
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "api.openai.com" }
          ],
          "profileName": "direct"
        },
        {
          "note": "Google — proxy",
          "conditions": [
            { "conditionType": "UrlWildcardCondition", "pattern": "*://*.google.com/*" }
          ],
          "profileName": "my clash"
        },
        {
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "*" }
          ],
          "profileName": "my clash"
        }
      ]
    }
  ]
}
```

### Config file path priority

1. `~/.pi/proxy.jsonc` (JSONC with comments)
2. `~/.pi/proxy.json` (standard JSON)
3. Legacy `~/.pi/agent/proxy.json` → auto-migrated to `proxy.jsonc` on first run

### Schema reference

Add `"$schema": "..."` to get autocomplete and validation in VS Code:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  // ...
}
```

Or generate locally: `npm run schema` → `schema.json`.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Global ON/OFF switch |
| `profile_name` | `string` | Active profile. Reserved: `direct`, `system`. Other values must match a name in `profileConfig` |
| `profileConfig` | `Profile[]` | Profile list |

### Profile fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique profile identifier |
| `type` | `"proxy_server"` / `"autoSwitch"` | Profile type |
| `server` | `string?` | Proxy URL (`proxy_server` only) |
| `ruleListURL` | `string?` | Remote rule list URL (`autoSwitch` only, reserved) |
| `switchRules` | `SwitchRule[]?` | Rule list (`autoSwitch` only) |

### SwitchRule fields

| Field | Type | Description |
|---|---|---|
| `note` | `string?` | Optional comment |
| `conditions` | `Condition[]?` | Condition list (AND logic). Empty = always match |
| `profileName` | `string` | Target profile. Reserved: `direct`, `system` |

### Condition types

| conditionType | Matches | Notes |
|---|---|---|
| `HostWildcardCondition` | Request hostname | `*` / `?` wildcards. `*.example.com` matches `example.com` and subdomains. `**.example.com` matches subdomains only |
| `UrlWildcardCondition` | Full request URL | `*` / `?` wildcards. No `*.` special semantics |
| `UrlRegexCondition` | Full request URL | JavaScript regex |
| `DisabledCondition` | — | Always false (temporarily disable a rule) |

## Command

Inside Pi, run:

```text
/proxy                 # interactive menu
/proxy "my clash"      # switch to a profile
/proxy stats           # show request counters
/proxy rules           # show autoSwitch rules
/proxy reload          # reload config
```

## Development

```bash
npm install
npm run check          # TypeScript
npm run lint           # ESLint
npm run lint:fix       # ESLint auto-fix
npm run schema         # Generate JSON Schema
```

## Project structure

```text
.
├── index.ts              # Pi extension entrypoint
├── lib/
│   ├── config.ts         # Config read, JSONC parse, legacy migration, schema validation
│   ├── conditions.ts     # Condition matching engine
│   ├── router.ts         # Profile resolution and request routing
│   └── stats.ts          # Request counters
├── scripts/
│   └── generate-schema.js  # JSON Schema generator
├── schema.json           # Generated JSON Schema
├── spec/
│   └── SPEC.md           # Specification document
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
└── README-CN.md
```

## License

MIT
