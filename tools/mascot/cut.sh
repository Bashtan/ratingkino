#!/usr/bin/env bash
# Rebuild the mascot's mood sprite (assets/ff-bot-moods.webp) from the 2×2 pose
# sheet, and bump every ?v= that depends on it:
#   tools/mascot/cut.sh [sheet]          default: raw/ff-bot-emotions.jpg
#
# The sheet: four poses in a 2×2 grid — think (top-left), success (top-right),
# confused (bottom-left), idea (bottom-right). It may be a real transparent PNG,
# or (like the current one) a JPEG with a checkerboard painted in where the
# transparency should be; matte.py removes that. A new sheet's magnifying-glass
# lens needs re-measuring: LENS in matte.py.
#
#   1. matte.py   sheet → RGBA (checker removed)      [checker.py: the checker model]
#   2. slice.py   RGBA  → 4 × 256×320 strip
#   3. cwebp      strip → assets/ff-bot-moods.webp
#   4. ?v=        the sprite's hash into social.css + social.js, then social.*'s
#                 own hashes into index.html + cinematic/index.html
#
# Needs python3 with numpy + Pillow, and cwebp. It leaves the intermediate PNGs
# (and matte.py's region map) in a temp dir it prints, for a look before you
# commit. Then test locally (./deploy.sh --stage-only) as usual.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1    # no __pycache__ in the repo

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
sheet="${1:-$root/raw/ff-bot-emotions.jpg}"
work="$(mktemp -d "${TMPDIR:-/tmp}/ff-bot-moods.XXXXXX")"

python3 "$here/matte.py" "$sheet" "$work/sheet.png" "$work/regions.png"
python3 "$here/slice.py" "$work/sheet.png" "$work/strip.png"
cwebp -quiet -q 84 -alpha_q 95 -alpha_filter best -m 6 -sharp_yuv "$work/strip.png" -o "$root/assets/ff-bot-moods.webp"

hash() { shasum -a 256 "$1" | cut -c1-8; }
cd "$root"
v="$(hash assets/ff-bot-moods.webp)"
sed -i '' -E "s|ff-bot-moods\.webp\?v=[0-9a-f]{8}|ff-bot-moods.webp?v=$v|" assets/social.css assets/social.js
css="$(hash assets/social.css)"; js="$(hash assets/social.js)"
sed -i '' -E "s|/assets/social\.css\?v=[0-9a-f]{8}|/assets/social.css?v=$css|; s|/assets/social\.js\?v=[0-9a-f]{8}|/assets/social.js?v=$js|" index.html cinematic/index.html

echo "sprite  assets/ff-bot-moods.webp  $(wc -c < assets/ff-bot-moods.webp | tr -d ' ') bytes  ?v=$v"
echo "social  css ?v=$css  js ?v=$js  (both pages)"
echo "work    $work"
