# Changelog

All notable changes to this project will be documented in this file.

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
