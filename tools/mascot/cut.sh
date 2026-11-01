#!/usr/bin/env bash
# Rebuild the mascot's two sprites from their 2×2 pose sheets, and bump every
# ?v= that depends on them:
#   tools/mascot/cut.sh [moods-sheet] [reactions-sheet]
#       defaults: raw/ff-bot-emotions.jpg, raw/ff-bot-reactions.png
#
# assets/ff-bot-moods.webp: the search moods (FFBot.set), also worn by the
# trailer bot's calm reactions. Its sheet: think (top-left), success
# (top-right), confused (bottom-left), idea (bottom-right).
# assets/ff-bot-reactions.webp: the trailer reactions' own poses (FFBot.watch).
# Its sheet: shocked (top-left), laughing (top-right), teary (bottom-left),
# hyped (bottom-right). A sprite of its own, so it's only fetched once a
# trailer plays, and the moods sprite's frames (which the hero and peek
# mascots use too) stay where they are.
#
# A sheet may be a real transparent PNG, or (like both current ones) an image
# with a checkerboard painted in where the transparency should be:
#   1. matte       the moods sheet: matte.py, tuned for it (a new one's
#                  magnifying-glass lens needs re-measuring: LENS). The
#                  reactions sheet: checker_matte.py, for a robot as white as
#                  the checker's white cells.   [checker.py: the checker model]
#   2. slice.py    RGBA → 4 × 256×320 strip, every robot at one size and place
#   3. cwebp       strip → the sprite
#   4. ?v=         the sprites' hashes into social.css + social.js, then social.*'s
#                  own hashes into index.html + cinematic/index.html
#
# Needs python3 with numpy + Pillow, and cwebp. It leaves the intermediate PNGs
# (and matte.py's region map) in a temp dir it prints, for a look before you
# commit. Then test locally (./deploy.sh --stage-only) as usual.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1    # no __pycache__ in the repo

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
moods="${1:-$root/raw/ff-bot-emotions.jpg}"
reactions="${2:-$root/raw/ff-bot-reactions.png}"
work="$(mktemp -d "${TMPDIR:-/tmp}/ff-bot-moods.XXXXXX")"
webp() { cwebp -quiet -q 84 -alpha_q 95 -alpha_filter best -m 6 -sharp_yuv "$1" -o "$2"; }

python3 "$here/matte.py" "$moods" "$work/sheet.png" "$work/regions.png"
python3 "$here/slice.py" "$work/sheet.png" "$work/strip.png"
webp "$work/strip.png" "$root/assets/ff-bot-moods.webp"

python3 "$here/checker_matte.py" "$reactions" "$work/rx-sheet.png"
python3 "$here/slice.py" "$work/rx-sheet.png" "$work/rx-strip.png" shocked,laughing,teary,hyped
webp "$work/rx-strip.png" "$root/assets/ff-bot-reactions.webp"

hash() { shasum -a 256 "$1" | cut -c1-8; }
cd "$root"
v="$(hash assets/ff-bot-moods.webp)"; rv="$(hash assets/ff-bot-reactions.webp)"
sed -i '' -E "s|ff-bot-moods\.webp\?v=[0-9a-f]{8}|ff-bot-moods.webp?v=$v|; s|ff-bot-reactions\.webp\?v=[0-9a-f]{8}|ff-bot-reactions.webp?v=$rv|" assets/social.css assets/social.js
css="$(hash assets/social.css)"; js="$(hash assets/social.js)"
sed -i '' -E "s|/assets/social\.css\?v=[0-9a-f]{8}|/assets/social.css?v=$css|; s|/assets/social\.js\?v=[0-9a-f]{8}|/assets/social.js?v=$js|" index.html cinematic/index.html

echo "sprite  assets/ff-bot-moods.webp      $(wc -c < assets/ff-bot-moods.webp | tr -d ' ') bytes  ?v=$v"
echo "sprite  assets/ff-bot-reactions.webp  $(wc -c < assets/ff-bot-reactions.webp | tr -d ' ') bytes  ?v=$rv"
echo "social  css ?v=$css  js ?v=$js  (both pages)"
echo "work    $work"
