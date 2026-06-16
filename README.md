# @aizigao/pi-proxy-fetch

[![npm version](https://img.shields.io/npm/v/%40aizigao%2Fpi-proxy-fetch)](https://www.npmjs.com/package/@aizigao/pi-proxy-fetch)

Chinese: [`README-CN.md`](https://github.com/aizigao/pi-proxy-fetch/blob/master/README-CN.md)

A Pi extension package that patches `globalThis.fetch` inside a Pi session and routes requests through SwitchyOmega-style `switchRules` and proxy profiles.

## Features

- **Multiple profiles**: define multiple proxy servers such as Clash or Whistle
- **autoSwitch**: match requests by rules and route them to a target profile
- **Built-in targets**: `direct` and `system` (`http_proxy` / `HTTP_PROXY` env)
- **Remote rule lists**: `ruleListURL` downloads a local cached rule file and participates in matching
- **Custom CA cert**: `proxy_server` supports optional `caCertPath` for tools like Whistle
- **Interactive menu**: switch profiles, toggle enable/disable, inspect stats, refresh rule lists, reload config

## Requirements

- Node.js 20+
- Pi coding agent installed

## Installation

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## npm package

- Package: `@aizigao/pi-proxy-fetch`
- npm: https://www.npmjs.com/package/@aizigao/pi-proxy-fetch

## Configuration

Recommended project-local config: `./.pi/proxy.json`

Global config is also supported: `~/.pi/agent/proxy.json`

If neither config exists, a default global config is created at `~/.pi/agent/proxy.json`.

```json
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  "version": 1,
  "enabled": true,
  "profileName": "auto-switch",
  "profileConfig": [
    {
      "name": "my-clash",
      "type": "proxy_server",
      "server": "socks5://127.0.0.1:7890"
    },
    {
      "name": "whistle",
      "type": "proxy_server",
      "server": "http://127.0.0.1:8899",
      "caCertPath": "~/.WhistleAppData/.whistle/certs/root.crt"
    },
    {
      "name": "auto-switch",
      "type": "autoSwitch",
      "ruleListURL": "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
      "switchRules": [
        {
          "note": "OpenAI direct",
          "conditions": [
            { "type": "host", "pattern": "api.openai.com" }
          ],
          "profileName": "direct"
        },
        {
          "note": "Anthropic direct",
          "conditions": [
            { "type": "host", "pattern": "api.anthropic.com" }
          ],
          "profileName": "direct"
        },
        {
          "note": "GitHub via Clash",
          "conditions": [
            { "type": "host", "pattern": "*.github.com" }
          ],
          "profileName": "my-clash"
        },
        {
          "note": "Google via Clash",
          "conditions": [
            { "type": "url", "pattern": "*://*.google.com/*" }
          ],
          "profileName": "my-clash"
        }
      ]
    }
  ]
}
```

## Config path priority

1. `./.pi/proxy.json` (project-local, preferred)
2. `~/.pi/agent/proxy.json` (global)

> Only configs with `version: 1` are treated as the current format. If the file is not the current format, the current file is backed up as `proxy.bak.json` and a default config is generated.

## Top-level fields

| Field | Type | Description |
|---|---|---|
| `version` | `1` | Current config schema version |
| `enabled` | `boolean` | Master on/off switch. `false` bypasses all proxy logic |
| `profileName` | `string` | Active profile name. Reserved values: `direct`, `system`; custom names must match `^[A-Za-z_-]+$` |
| `profileConfig` | `Profile[]` | Profile list |

## `proxy_server` fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Profile name; must match `^[A-Za-z_-]+$` |
| `type` | `"proxy_server"` | Fixed value |
| `server` | `string` | Required proxy URL, e.g. `socks5://127.0.0.1:7890` |
| `caCertPath` | `string?` | Optional CA certificate path, useful for Whistle-style self-signed proxies |

## `autoSwitch` fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Profile name; must match `^[A-Za-z_-]+$` |
| `type` | `"autoSwitch"` | Fixed value |
| `ruleListURL` | `string?` | Remote rule list URL |
| `switchRules` | `SwitchRule[]` | Local rules |

## `SwitchRule` fields

| Field | Type | Description |
|---|---|---|
| `note` | `string?` | Note |
| `conditions` | `Condition[]?` | Condition list with **OR** logic; empty means always match |
| `profileName` | `string` | Target profile. Reserved: `direct`, `system`; custom names must match `^[A-Za-z_-]+$` |

## `Condition` fields

| Field | Type | Description |
|---|---|---|
| `type` | `host` / `url` / `regex` / `disabled` | Condition type |
| `pattern` | `string?` | Match pattern |

## Condition types

| `type` | Matches | Notes |
|---|---|---|
| `host` | request hostname | Supports `*` / `?`; `*.example.com` matches both `example.com` and subdomains; `**.example.com` matches subdomains only |
| `url` | full request URL | Supports `*` / `?`; no special `*.` behavior |
| `regex` | full request URL | JavaScript regular expression |
| `disabled` | - | Never matches |

> If no rule matches, the request goes direct by default. No explicit catch-all rule is required.

## `ruleListURL` behavior

- `ruleListURL` is useful when you want to reuse a remote ruleset such as gfwlist / AutoProxy
- Project configs save downloaded content next to the project config file
- Global configs save downloaded content under `~/.pi/agent`
- Filename format:

```text
proxy-rulelist-file--{profile_name_safe}.txt
```

Example:

```text
./.pi/proxy-rulelist-file--auto_switch.txt
~/.pi/agent/proxy-rulelist-file--auto_switch.txt
```

Behavior:

- On `session_start`, if the local file already exists, it is loaded directly
- If the local file is missing, it is downloaded once automatically
- You can also refresh it manually from the `/proxy` menu via **Refresh rule list files**
- Downloaded remote rules are merged into memory at runtime only and are not written back into your original `switchRules`
- Profile switching, reload, and menu actions never directly rewrite your original rules

## Commands

Run inside Pi:

```text
/proxy            # open interactive menu
/proxy stats      # show stats
/proxy reload     # reload config
/proxy name       # switch directly to a profile
```

The `/proxy` menu includes:

- Select profile
- Enable/Disable proxy
- Show stats
- Refresh rule list files
- Reload config

## Development

```bash
npm install
npm run check
npm run lint
npm run schema
```

## License

MIT
