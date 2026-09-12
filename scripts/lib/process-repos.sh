#!/usr/bin/env bash
# Clone (shallow), extract candidate plugin packages, append to a batch-specific
# output file (records separated by ###SPLIT### markers, each a JSON array).
# Usage: process-repos.sh <start_idx> <end_idx_exclusive> <clones_dir> <out_file>
set -uo pipefail

START="$1"
END="$2"
CLONES_DIR="$3"
OUT_FILE="$4"
REPOS_JSON="/home/user/backstage-plugins/scripts/lib/repos.json"
EXTRACT="/home/user/backstage-plugins/scripts/lib/extract.mjs"

mkdir -p "$CLONES_DIR"
: > "$OUT_FILE"

mapfile -t REPOS < <(node -e "const r=require('$REPOS_JSON'); console.log(r.slice($START,$END).join('\n'))")

for slug in "${REPOS[@]}"; do
  [ -z "$slug" ] && continue
  name="$(echo "$slug" | tr '/' '__')"
  dest="$CLONES_DIR/$name"
  echo "=== $slug ==="
  rm -rf "$dest"
  if GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --quiet "https://github.com/$slug.git" "$dest" 2>/tmp/clone_err.log; then
    if node "$EXTRACT" "$dest" "$slug" >> "$OUT_FILE" 2>/tmp/extract_err.log; then
      :
    else
      echo "EXTRACT FAILED for $slug:" >&2
      cat /tmp/extract_err.log >&2
      echo "[]" >> "$OUT_FILE"
    fi
  else
    echo "CLONE FAILED for $slug:" >&2
    cat /tmp/clone_err.log >&2
    echo "[]" >> "$OUT_FILE"
  fi
  echo "###SPLIT###" >> "$OUT_FILE"
  rm -rf "$dest"
done
echo "DONE batch $START-$END"
