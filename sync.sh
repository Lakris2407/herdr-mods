#!/usr/bin/env bash
# Copy the mods of this repo into Herdr and check each one: ./sync.sh (every folder) or ./sync.sh runners stats.
# Herdr reloads a mod when its files change. Your layout and keys.json are left alone.
set -euo pipefail

APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

folders=("$@")
if [ ${#folders[@]} -eq 0 ]; then
  for dir in "$REPO_DIR"/*/; do [ -d "$dir/mods" ] && folders+=("$(basename "$dir")"); done
fi

for folder in "${folders[@]}"; do
  [ -d "$REPO_DIR/$folder/mods" ] || { echo "no mods in $folder" >&2; exit 1; }
  for mod in "$REPO_DIR/$folder"/mods/*/; do
    name="$(basename "$mod")"
    # Every mod with a colors.js gets the one in shared/, so a color means the same in each.
    [ -f "$mod/colors.js" ] && cp "$REPO_DIR/shared/colors.js" "$mod/colors.js"
    mkdir -p "$APP_HOME/mods/$name"
    # Herdr writes jsconfig.json and gpui-kit.d.ts into each mod folder; keep them.
    rsync -a --delete --exclude jsconfig.json --exclude gpui-kit.d.ts "$mod" "$APP_HOME/mods/$name/"
    herdr-app check "$APP_HOME/mods/$name"
  done
done
