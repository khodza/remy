#!/usr/bin/env bash
# The whole stack in one terminal: MongoDB (docker compose), this backend in
# watch mode and, when the sibling frontend exists, the Mini App dev server.
#
#   npm run dev:all               # mongo + api (:3000) + webapp (:5173)
#   npm run dev:all -- --tunnel   # webapp through cloudflared (pnpm dev:tunnel)
#                                 # for a real phone; the printed URL goes to
#                                 # @BotFather as the Mini App URL
#   npm run dev:all -- --no-web   # backend only
#
# REMY_WEBAPP_DIR overrides where the frontend is looked for (../remy-webapp).
# Ctrl-C stops the watchers; Mongo keeps running (like `npm run dev`).
set -euo pipefail
cd "$(dirname "$0")/.."

WEBAPP_DIR="${REMY_WEBAPP_DIR:-../remy-webapp}"
TUNNEL=0
WEB=1
for arg in "$@"; do
  case "$arg" in
    --tunnel) TUNNEL=1 ;;
    --no-web) WEB=0 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "dev-all: unknown option '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -f .env ]; then
  echo "dev-all: no .env here. Start with: cp .env.example .env" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  docker compose up -d mongo
else
  echo "dev-all: docker not found, expecting MongoDB at MONGODB_URI already" >&2
fi

names="api"
colors="cyan"
commands=("npm run dev:api")

if [ "$WEB" = 1 ]; then
  if [ -f "$WEBAPP_DIR/package.json" ]; then
    if ! command -v pnpm >/dev/null 2>&1; then
      echo "dev-all: pnpm not found; the frontend needs it (corepack enable)" >&2
      exit 1
    fi
    if [ "$TUNNEL" = 1 ]; then
      web_script="dev:tunnel"
    else
      web_script="dev"
    fi
    names="$names,web"
    colors="$colors,magenta"
    commands+=("pnpm --dir '$WEBAPP_DIR' $web_script")
  else
    echo "dev-all: no frontend at $WEBAPP_DIR, starting the backend only" >&2
  fi
fi

# -k: when one process exits, stop the others too (so Ctrl-C is clean).
exec npx concurrently -k --names "$names" -c "$colors" "${commands[@]}"
