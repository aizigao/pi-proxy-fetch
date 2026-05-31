# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-31

### Added
- Remote rule list (`ruleListURL`) auto-download and parsing
- Auto-generated `schema.json`
- `/proxy <name>` subcommand for quick profile switching
- `project.json` support for `--invert proxy_mode` and `--user-agent`

### Refactored
- Simple hostname matching engine replaced with SwitchyOmega-style multi-profile + switchRules model
- Flat config (`enabled/proxy/mode/rules`) migrated to structured `profileName + profileConfig`
- Two profile types introduced: `proxy_server` (fixed proxy) and `autoSwitch` (rule-based routing)
- Inline hostname matching replaced by four condition types: HostWildcard / UrlWildcard / UrlRegex / Disabled
- Config file location migrated from `~/.pi/agent/proxy.json` to `~/.pi/proxy.jsonc` (JSONC with // comments); old format auto-migrated
- Monolithic `index.ts` split into `lib/config.ts` / `lib/conditions.ts` / `lib/router.ts` / `lib/stats.ts`
- `/proxy` command redesigned from ON/OFF toggle to profile switcher (interactive menu listing all profiles, `/proxy <name>` subcommand)
- Fetch patch refactored from static `originalFetch` reference to dynamic `underlyingFetch` reference, coexisting with `undici.install()`

## [0.1.3] - 2026-05-28

### Fixed
- Replace `setTimeout` + `globalThis.fetch = patchedFetch` with `Object.defineProperty`
  getter/setter to survive `undici.install()` from `configureHttpDispatcher()` and coexist
  with other extensions that also patch `globalThis.fetch`.
- `originalFetch` replaced with dynamic `underlyingFetch` reference so that
  `undici.install()` updates propagate to proxied requests.

## [0.1.2] - 2026-05-22

### Fixed
- Delay global fetch patch via `setTimeout(0)` to survive pi `configureHttpDispatcher()`
  which calls `undici.install()` after extension load (main.js:488), overwriting
  `globalThis.fetch` and destroying the proxy routing patch.

## [0.1.0] - 2026-05-20

### Added
- Initial standalone npm/Pi package structure for `@aizigao/pi-proxy-fetch`
- Pi extension entrypoint in `index.ts`
- README with configuration, command, behavior, and development notes
- ESLint flat config and lint scripts
- TypeScript typecheck config
- MIT license
- Open-source package metadata for GitHub and npm publishing
