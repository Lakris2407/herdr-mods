#!/usr/bin/env bash
# Copy this repo's own mods and shared files into the Fleet layout (layout/mods), so the layout
# folder stays whole for herdr.dev. Run it after changing a mod; test/layout.test.mjs fails until you do.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"
for mod in [a-z]*/mods/*/; do
  case "$mod" in layout/*) continue ;; esac
  name="$(basename "$mod")"
  [ -d "layout/mods/$name" ] || continue
  rsync -a --delete --exclude jsconfig.json --exclude gpui-kit.d.ts "$mod" "layout/mods/$name/"
done
for file in layout/mods/*/colors.js; do cp shared/colors.js "$file"; done
for file in layout/mods/*/names.js; do cp shared/names.js "$file"; done
