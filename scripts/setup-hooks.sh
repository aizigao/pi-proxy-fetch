#!/bin/sh
# Install git pre-commit hook to regenerate schema.json before each commit.

HOOK_DIR="$(git rev-parse --git-dir)/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

cat > "$HOOK_FILE" << 'EOF'
#!/bin/sh
set -e

echo "[pre-commit] Generating schema.json..."
node scripts/generate-schema.js
git add schema.json
echo "[pre-commit] Schema updated and staged."
EOF

chmod +x "$HOOK_FILE"
echo "Pre-commit hook installed at $HOOK_FILE"
