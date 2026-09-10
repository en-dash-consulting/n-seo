#!/usr/bin/env bash
#
# Pack the tarball, install it into an empty project, and drive the result.
#
# A git checkout hides packaging bugs. It has devDependencies installed, its
# own node_modules, and every file in the tree regardless of the `files` list.
# Two real breaks shipped exactly that way and were only caught here:
#
#   1. `tsx` sat in devDependencies, so `npm ci --omit=dev` — and therefore any
#      `npm i n-seo` — produced an install whose dashboard could not start.
#   2. `tsconfig.json` was missing from the published `files`. It carries `jsx`
#      and `jsxImportSource`, so tsx fell back to the React JSX transform and
#      every server-rendered route answered 500 with "React is not defined".
#
# Neither is visible from `npm test`. That is why this runs on every push and
# not only at release time.
#
# Usage: .github/scripts/pack-smoke.sh
#   SMOKE_PORT   port for the dashboard under test (default 4699)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${SMOKE_PORT:-4699}"
WORK="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '::error::%s\n' "$1" >&2; exit 1; }

say "pack $REPO"
tarball="$(cd "$REPO" && npm pack --pack-destination "$WORK" --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].filename))')"
[ -f "$WORK/$tarball" ] || fail "npm pack produced no tarball"
echo "  $tarball ($(du -h "$WORK/$tarball" | cut -f1))"

say "install into an empty project"
proj="$WORK/consumer"
mkdir -p "$proj"
cd "$proj"
npm init -y >/dev/null
npm i "$WORK/$tarball" >/dev/null
pkg="$proj/node_modules/n-seo"
[ -d "$pkg" ] || fail "the package did not install"

# The two files that went missing before. Checking the installed tree rather
# than the tarball listing is deliberate: this is what a consumer actually has.
say "shipped files"
for f in tsconfig.json .env.example package.json bin/n-seo.mjs src/server.tsx public/styles.css; do
  if [ -e "$pkg/$f" ]; then
    echo "  ok   $f"
  else
    fail "$f is missing from the published package (check the \"files\" list in package.json)"
  fi
done

say "the CLI runs from an npm install"
npx n-seo version
npx n-seo init ./inst >/dev/null
for f in n-seo.config.json .mcp.json config/backlog.json; do
  [ -f "./inst/$f" ] || fail "init did not create $f"
done
npx n-seo demo --instance ./inst >/dev/null
[ -d "./inst/data/gsc" ] || fail "demo data did not land in the instance"

say "the dashboard serves on :$PORT"
SEO_PORT="$PORT" npx n-seo start --instance ./inst > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/api/actions"; then break; fi
  sleep 1
done

fails=0
for route in / /actions /trends /site/example.com /settings /api/actions; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$route")"
  printf '  %s %s\n' "$code" "$route"
  [ "$code" = "200" ] || fails=1
done
if [ "$fails" = "1" ]; then
  echo "--- server log ---"
  cat "$WORK/server.log"
  fail "the packaged dashboard did not serve every route"
fi

kill "$SERVER_PID" 2>/dev/null || true
# reap it here, or bash prints "Terminated" over the next section's output
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

say "the MCP server answers over stdio"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"pack-smoke","version":"1"}}}' \
  > "$WORK/mcp-in.jsonl"
( cat "$WORK/mcp-in.jsonl"; sleep 3 ) \
  | N_SEO_INSTANCE="$proj/inst" npx n-seo mcp > "$WORK/mcp-out.jsonl" 2>"$WORK/mcp-err.log" || true
if grep -q '"serverInfo"' "$WORK/mcp-out.jsonl"; then
  echo "  ok   initialize answered"
else
  echo "--- mcp stdout ---"; cat "$WORK/mcp-out.jsonl"
  echo "--- mcp stderr ---"; cat "$WORK/mcp-err.log"
  fail "the packaged MCP server did not answer initialize"
fi

say "packaged install is good"
