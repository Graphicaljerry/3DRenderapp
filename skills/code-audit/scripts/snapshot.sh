#!/usr/bin/env bash
# Cheap, read-only metrics snapshot. Run at the START and END of an audit and diff
# the two outputs — that diff is the audit's honesty check. Every count here is a
# grep-level approximation; it exists to make change visible, not to be exact.
# Usage: snapshot.sh [project-dir]
set -u
DIR="${1:-.}"
cd "$DIR" || exit 1
X="--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=.git --exclude-dir=coverage"

echo "# snapshot: $(basename "$PWD")"
SRC=$(find . -path ./node_modules -prune -o -path ./dist -prune -o -path ./.git -prune -o -path ./build -prune -o \
  -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.py' \) -print)
echo "source files: $(echo "$SRC" | grep -c . )"
echo "source LOC: $(echo "$SRC" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"

if [ -f package.json ]; then
  node -e '
    const p = require("./package.json");
    const d = Object.keys(p.dependencies || {}), dd = Object.keys(p.devDependencies || {});
    console.log("dependencies: " + d.length + (d.length ? " (" + d.join(", ") + ")" : ""));
    console.log("devDependencies: " + dd.length);
  ' 2>/dev/null || echo "package.json: unreadable"
fi

# Slop markers. grep -r exits 1 on zero matches; the || keeps set -u happy.
for pat in "console\.log" "as any" "@ts-ignore" "TODO\|FIXME\|XXX" "debugger"; do
  n=$(grep -r $X -E "$pat" --include='*.js' --include='*.mjs' --include='*.ts' --include='*.tsx' --include='*.jsx' . 2>/dev/null | wc -l)
  echo "marker '$pat': $n"
done
n=$(grep -r $X -E "catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}" --include='*.js' --include='*.mjs' --include='*.ts' . 2>/dev/null | wc -l)
echo "empty catches: $n"

if [ -f tsconfig.json ] && command -v npx >/dev/null; then
  echo "tsc errors: $(npx --no-install tsc --noEmit 2>/dev/null | grep -c 'error TS' || echo 'n/a')"
fi
for out in dist build; do
  [ -d "$out" ] && echo "$out size: $(du -sh "$out" 2>/dev/null | awk '{print $1}')"
done
echo "largest files:"
echo "$SRC" | xargs wc -l 2>/dev/null | sort -rn | head -4 | sed 's/^/  /'
