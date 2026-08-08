#!/usr/bin/env bash
#
# FindFilm.ai — Cloudflare Pages deploy.
#
# WHY THIS EXISTS
# ---------------
# wrangler.toml used to set `pages_build_output_dir = "."`, which means "publish
# the entire repository". Cloudflare Pages has no exclusion mechanism — .gitignore
# does not apply to uploads, and .assetsignore is a Workers-static-assets feature
# that `wrangler pages deploy` ignores outright (verified: every path it listed was
# still served afterwards). So "." published sync-worker.js, wrangler.toml,
# schema.sql, CLAUDE.md, HANDOFF.md, spotify-worker/, and — for a long time —
# https://findfilm.ai/.dev.vars, serving the live TMDB_KEY and OMDB_KEY byte for
# byte to anyone who asked.
#
# The fix is to stop deploying from the repo root. This script stages an explicit
# ALLOWLIST into dist/ and deploys that. A file that nobody deliberately added to
# PUBLIC below cannot leak, no matter what lands in the repo later. That inverts
# the old default, where every new file was public until someone noticed.
#
# USAGE
#   ./deploy.sh                 stage dist/ and deploy to production
#   ./deploy.sh --stage-only    stage dist/ and stop (inspect before shipping)
#   ./deploy.sh --branch foo    any extra args are forwarded to wrangler
#
set -euo pipefail
cd "$(dirname "$0")"

DIST=dist
STAGE_ONLY=0
if [[ "${1:-}" == "--stage-only" ]]; then
  STAGE_ONLY=1
  shift
fi

# ── The allowlist ──────────────────────────────────────────────────────────
# Every path served to browsers, plus functions/ (Pages compiles that into
# Functions rather than serving it as assets, but it must be inside the output
# directory to be picked up at all).
#
# Deliberately NOT here: raw/ (design sources, referenced by nothing), and every
# .toml / .sql / .md / worker source in the repo root.
PUBLIC=(
  index.html
  sw.js
  favicon.ico
  robots.txt
  sitemap.xml
  llms.txt
  _redirects
  assets
  functions
  pitch
  tv
)

# ── Stage ──────────────────────────────────────────────────────────────────
rm -rf "$DIST"
mkdir -p "$DIST"

missing=()
for p in "${PUBLIC[@]}"; do
  if [[ -e "$p" ]]; then
    cp -R "$p" "$DIST/"
  else
    missing+=("$p")
  fi
done

# A typo in PUBLIC would silently drop index.html and deploy an empty site, so
# treat a missing allowlist entry as fatal rather than as "nothing to copy".
if (( ${#missing[@]} )); then
  printf 'deploy: allowlisted path does not exist: %s\n' "${missing[@]}" >&2
  exit 1
fi

find "$DIST" -name '.DS_Store' -delete

# ── Guard ──────────────────────────────────────────────────────────────────
# The allowlist is the real protection; this is the tripwire for the case where
# someone adds a directory to PUBLIC that happens to contain a secret or a
# server-side config. Fail closed — never deploy past a hit.
suspects=$(find "$DIST" -type f \( \
  -name '.dev.vars*' -o -name '*.toml' -o -name '*.sql' -o \
  -name '*.md'       -o -name '.env*'  -o -name '.git*' \) )
if [[ -n "$suspects" ]]; then
  echo 'deploy: refusing — sensitive file types staged for publication:' >&2
  printf '  %s\n' $suspects >&2
  exit 1
fi

# Catches a secret pasted into an otherwise-public file, which the filename
# check above cannot see. These are the exact names that leaked before.
if secrets=$(grep -rlE '(TMDB_KEY|OMDB_KEY|SPOTIFY_CLIENT_SECRET|SPOTIFY_CLIENT_ID)[[:space:]]*=' "$DIST" 2>/dev/null); then
  echo 'deploy: refusing — secret assignment found in staged files:' >&2
  printf '  %s\n' $secrets >&2
  exit 1
fi

echo "deploy: staged $(find "$DIST" -type f | wc -l | tr -d ' ') files into $DIST/"

if (( STAGE_ONLY )); then
  echo 'deploy: --stage-only, not deploying.'
  exit 0
fi

# ── Ship ───────────────────────────────────────────────────────────────────
log=$(mktemp)
trap 'rm -f "$log"' EXIT
npx wrangler pages deploy "$DIST" --project-name=ratingkino "$@" | tee "$log"

url=$(grep -oE 'https://[a-z0-9-]+\.ratingkino\.pages\.dev' "$log" | tail -1)
if [[ -z "$url" ]]; then
  echo 'deploy: could not read the deployment URL from wrangler output; verify by hand.' >&2
  exit 1
fi

# ── Verify against the deployment that actually shipped ────────────────────
# Not optional. The previous attempt at this fix (.assetsignore) looked correct,
# was committed with a confident message, and protected nothing — the only reason
# anyone found out was probing the live URL afterwards. Believing a config is
# right is not evidence. Ask the deployment.
#
# Pages' SPA not_found_handling answers a genuinely-absent path with 200 text/html,
# so status alone proves nothing here — a leak and a miss are both "200". The
# signal is Content-Type: text/html means "fell through to index.html", anything
# else means the real file is being served.
echo
echo "deploy: verifying $url"
sleep 3

MUST_NOT_PUBLISH=(
  .dev.vars  spotify-worker/.dev.vars  .env  .gitignore  .assetsignore
  wrangler.toml  sync-worker.js  sync-worker.toml  schema.sql
  CLAUDE.md  HANDOFF.md  deploy.sh
  spotify-worker/index.js  spotify-worker/wrangler.toml
  redirect-worker/worker.js  redirect-worker/wrangler.toml
)

leaked=()
for p in "${MUST_NOT_PUBLISH[@]}"; do
  ct=$(curl -sS -m 15 -o /dev/null -w '%{content_type}' "$url/$p" || echo 'curl-failed')
  case "$ct" in
    text/html*) ;;                       # absent, served the SPA fallback
    *)          leaked+=("$p -> $ct") ;; # a real file came back
  esac
done

# Positive control: if the site itself is broken, "nothing is served" would read
# as a clean pass above, so confirm the shell actually loads before trusting it.
home_ct=$(curl -sS -m 15 -o /dev/null -w '%{content_type}' "$url/" || echo 'curl-failed')
icon_ct=$(curl -sS -m 15 -o /dev/null -w '%{content_type}' "$url/assets/icon-192.png" || echo 'curl-failed')

echo "  /                      $home_ct"
echo "  /assets/icon-192.png   $icon_ct"

if [[ "$home_ct" != text/html* || "$icon_ct" != image/* ]]; then
  echo 'deploy: FAILED — the deployment does not serve the site correctly.' >&2
  exit 1
fi

if (( ${#leaked[@]} )); then
  echo 'deploy: FAILED — these paths are publicly readable on the new deployment:' >&2
  printf '  %s\n' "${leaked[@]}" >&2
  exit 1
fi

echo "  ${#MUST_NOT_PUBLISH[@]}/${#MUST_NOT_PUBLISH[@]} sensitive paths confirmed unpublished."
echo "deploy: OK — $url"
