# @aizigao/pi-proxy-fetch

中文文档：[`README-CN.md`](./README-CN.md)

A Pi extension package that routes `globalThis.fetch` through direct, proxy, or direct-with-proxy-fallback behavior based on hostname rules.

Forked from [`haokanjiang/pi-proxy`](https://github.com/haokanjiang/pi-proxy) and adapted to preserve this package's current local routing behavior and packaging structure.

This package keeps the current local routing model intact:
- config file lives at `~/.pi/agent/proxy.json`
- rules are re-read on every request
- wildcard hostname matching is supported
- proxy requests use `undici` with `ProxyAgent`
- fallback mode retries failed direct requests through the proxy
- `/proxy` command provides ON/OFF, stats, reload, and rule display

## What it does

`@aizigao/pi-proxy-fetch` monkey-patches `globalThis.fetch` inside a Pi session.

For each request it:
1. reads `~/.pi/agent/proxy.json`
2. matches the request hostname against your rules
3. chooses one of three actions:
   - `direct`: use the original fetch
   - `proxy`: send via `ProxyAgent`
   - `fallback`: try direct first, then retry through proxy on network failure

This is intentionally a network-layer fetch router. It is not a search tool and it does not change non-fetch HTTP clients.

## Features

- Pi extension package layout
- Rule-based host matching
- `direct`, `proxy`, `fallback` actions
- per-session fetch patching with shutdown restore
- `/proxy` interactive command
- request counters for direct, proxy, and fallback traffic
- config-driven enable/disable switch persisted to disk

## Requirements

- Node.js 20+
- Pi coding agent installed
- A Pi agent config directory at `~/.pi/agent`

## Repository

- GitHub: https://github.com/aizigao/pi-proxy-fetch
- Issues: https://github.com/aizigao/pi-proxy-fetch/issues
- npm package: `@aizigao/pi-proxy-fetch`

## Installation

### Local development

```bash
cd /Users/aizigao/MyWorkSpace/github_mine/pi-proxy-fetch
npm install
```

### Install from npm

```bash
npm install @aizigao/pi-proxy-fetch
```

### Use as a Pi package

This repository is structured as a Pi package:

- package name: `@aizigao/pi-proxy-fetch`
- extension entry: `./index.ts`
- package metadata: `package.json#pi.extensions`

How you load it depends on how you manage local Pi packages in your environment.

## Publishing

Before publishing, verify:

```bash
npm run check
npm run lint
```

Then publish:

```bash
npm publish
```

This package is configured as a public scoped package.

## Configuration

Create `~/.pi/agent/proxy.json`:

```json
{
  "enabled": true,
  "proxy": "http://127.0.0.1:7890",
  "mode": "direct",
  "rules": [
    {
      "match": "api.openai.com,api.anthropic.com",
      "action": "direct",
      "comment": "keep AI API traffic direct"
    },
    {
      "match": "*.google.com,*.github.com",
      "action": "proxy",
      "comment": "always proxy selected domains"
    },
    {
      "match": "*",
      "action": "fallback",
      "comment": "default: direct first, proxy on network failure"
    }
  ]
}
```

### Config fields

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Global ON/OFF switch. `/proxy` can toggle and persist it. |
| `proxy` | `string` | Proxy URL passed to `undici` `ProxyAgent`. |
| `mode` | `direct \| proxy \| fallback` | Default action when no rule matches. |
| `rules` | `ProxyRule[]` | Top-down rule list. First match wins. |

### Rule format

```json
{
  "match": "*.example.com,api.example.com",
  "action": "proxy",
  "comment": "optional note"
}
```

- `match` supports comma-separated patterns
- `*` matches everything
- patterns without `*` require exact hostname match
- patterns with `*` are treated as wildcards

Examples:
- `api.openai.com`
- `*.google.com`
- `github.*`
- `*`

## Command

Inside Pi, run:

```text
/proxy
```

Menu actions:
- `Turn ON` / `Turn OFF`
- `Show stats`
- `Reload config`
- `Show rules`

## Behavior notes

### Direct vs proxy vs fallback

- `direct`: uses the original unpatched fetch
- `proxy`: uses `undiciFetch(..., { dispatcher: new ProxyAgent(...) })`
- `fallback`: tries direct first, then retries through proxy unless the failure is an abort/timeout-style error

### What this package does not intercept

The patch only affects code that calls the patched `globalThis.fetch` after the extension has loaded.

It does **not** automatically intercept:
- code that cached the old `fetch` before patching
- code that imports `undici.fetch` directly
- other HTTP clients

## Development

```bash
npm install
npm run check
npm run lint
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run check` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fixes |

## Project structure

```text
.
├── index.ts         # Pi extension entrypoint
├── eslint.config.js # ESLint flat config
├── tsconfig.json    # TypeScript config
└── package.json     # npm + Pi package metadata
```

## Design choices

This package intentionally preserves the existing local behavior instead of fully copying upstream `pi-proxy`:

- config path stays `~/.pi/agent/proxy.json`
- config is re-read per request instead of cached in memory
- wildcard matching uses regex conversion
- fallback retries a broader set of non-abort failures
- proxy requests explicitly use `undici.fetch`

That makes this package closer to the original local implementation while still being structured as a normal npm/Pi package.

## License

MIT
