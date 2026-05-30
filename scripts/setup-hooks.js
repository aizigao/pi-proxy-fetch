#!/usr/bin/env node
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const gitDir = join(process.cwd(), ".git");
if (!existsSync(gitDir)) {
  console.log("[postinstall] Not a git repository. Skipping hook setup.");
  process.exit(0);
}

const hookPath = join(gitDir, "hooks", "pre-commit");

const hookScript = `#!/bin/sh
# Pre-commit hook: regenerate JSON Schema before each commit
set -e

echo "[pre-commit] Generating schema.json..."
node scripts/generate-schema.js
git add schema.json
echo "[pre-commit] Schema updated and staged."
`;

writeFileSync(hookPath, hookScript, { mode: 0o755 });
console.log("[postinstall] Pre-commit hook installed at .git/hooks/pre-commit");
