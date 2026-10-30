#!/usr/bin/env python3
# Rebuild every site icon and the social preview from ONE transparent PNG of the
# mascot, then bump every ?v= that points at them:
#   python3 tools/icons/make.py [source] [--head X,Y,SIZE] [--out DIR] [--bump]
#     source       default raw/ff-bot-clapper.png (raw/ is never published)
#     --head       the square used for the small icons, in source pixels; by
#                  default the top of the mascot (its helmet) is found by itself
#     --out DIR    write everything into DIR instead (a dry run: the pages,
#                  the manifest and sw.js are left alone)
#     --bump       generate nothing: just re-hash the current files and bump
#                  ?v= (after replacing one of them by hand)
#
# The source must have real transparency (if it has a checkerboard painted in,
# matte it first: tools/mascot/matte.py). At least 1024px on its long side;
# nothing cut off at its edges.
#
# Outputs (sizes are fixed by the browsers and platforms that ask for them):
#   favicon.ico                        16 + 32 + 48, PNG frames   head on a tile
#   assets/favicon-16x16.png  · -32x32 · favicon.png (64)        head on a tile
#   assets/apple-touch-icon.png        180, opaque square (iOS rounds it)
#   assets/icon-192.png · icon-512.png rounded tile, "any" in the manifest
#   assets/icon-maskable-192.png · -512 full-bleed, the mascot inside Android's
#                                      safe circle (radius 40% of the icon)
#   assets/og-image.jpg                1200×630: og.html drawn by headless Chrome
#                                      (Montserrat 900, like the header wordmark)
# Small icons show the head only: a whole mascot at 16px is a smudge. The tile
# is the manifest's background, #0d0020, with a violet glow, so every icon reads
# on light and dark tab strips alike.
#
# The manifest's "icons" list is rewritten to match (MANIFEST_ICONS below).
# ?v=: each file's first 8 hex of sha256, in the four pages (index.html,
# cinematic/, pitch/, tv/), the manifest and sw.js; then the manifest's own.
# Social sites cache previews by URL, so og:image changes URL with its content.
# A contact sheet of everything lands next to a temp copy of the work: look at
# it before you commit, then test locally (./deploy.sh --stage-only) as usual.
# Needs python3 with numpy + Pillow, and Google Chrome (for the OG image).
import argparse, hashlib, io, json, os, re, shutil, struct, subprocess, sys, tempfile
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

BG = (13, 0, 32)               # #0d0020, the manifest's background_color
GLOW = (124, 58, 237)          # #7C3AED, the theme colour
SMALL = [16, 32, 48, 64]       # head-only sizes
PAGES = ['index.html', 'cinematic/index.html', 'pitch/index.html', 'tv/index.html']
REFS = PAGES + ['assets/site.webmanifest', 'sw.js']
OUT = {   # output → its URL on the site
    'favicon.ico': '/favicon.ico',
    'assets/favicon-16x16.png': '/assets/favicon-16x16.png',
    'assets/favicon-32x32.png': '/assets/favicon-32x32.png',
    'assets/favicon.png': '/assets/favicon.png',
    'assets/apple-touch-icon.png': '/assets/apple-touch-icon.png',
    'assets/icon-192.png': '/assets/icon-192.png',
    'assets/icon-512.png': '/assets/icon-512.png',
    'assets/icon-maskable-192.png': '/assets/icon-maskable-192.png',
    'assets/icon-maskable-512.png': '/assets/icon-maskable-512.png',
    'assets/og-image.jpg': '/assets/og-image.jpg',
}
MANIFEST_ICONS = [   # (file, sizes, purpose)
    ('assets/favicon-16x16.png', '16x16', None), ('assets/favicon-32x32.png', '32x32', None),
    ('assets/favicon.png', '64x64', None), ('assets/apple-touch-icon.png', '180x180', None),
    ('assets/icon-192.png', '192x192', 'any'), ('assets/icon-512.png', '512x512', 'any'),
    ('assets/icon-maskable-192.png', '192x192', 'maskable'), ('assets/icon-maskable-512.png', '512x512', 'maskable'),
]


def die(msg):
    sys.exit('make.py: ' + msg)


def resize(im, w, h):
    """Premultiplied Lanczos, so transparent pixels' colour never bleeds into the edges."""
    return im.convert('RGBa').resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS).convert('RGBA')


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return resize(im, im.width * s, im.height * s)


def background(w, h, glow=0.55, at=(0.5, 0.46)):
    """The brand tile: #0d0020 with a soft violet glow behind the mascot."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((x + 0.5) / w - at[0], (y + 0.5) / h - at[1]) / 0.62
    a = glow * np.clip(1 - d, 0, 1) ** 1.6
    px = np.array(BG, np.float32) * (1 - a[..., None]) + np.array(GLOW, np.float32) * a[..., None]
    out = np.dstack([px, np.full((h, w), 255, np.float32)]).round().astype(np.uint8)
    return Image.fromarray(out)   # (h, w, 4) uint8 → RGBA


def rounded(size, radius):
    """An anti-aliased rounded-square mask (drawn at 4× and scaled down)."""
    k = 4
    m = Image.new('L', (size * k, size * k), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * k - 1, size * k - 1), radius=radius * k, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def place(tile, art, box, shadow=True):
    """Centre art (already sized) on tile; a soft shadow under it reads as depth."""
    x, y = (tile.width - art.width) // 2, (tile.height - art.height) // 2
    if shadow and tile.width >= 96:
        a = art.getchannel('A').filter(ImageFilter.GaussianBlur(tile.width / 40))
        sh = Image.new('RGBA', art.size, (0, 0, 0, 0))
        sh.putalpha(a.point(lambda v: v * 0.45))
        tile.alpha_composite(sh, (x, y + max(1, tile.width // 60)))
    tile.alpha_composite(art, (x, y))
    return tile


def head_tile(head, s):
    t = place(background(s, s, glow=0.7), fit(head, s * 0.9, s * 0.9), None, shadow=False)
    if s <= 32:   # keep the visor and the glasses' hearts crisp
        t = t.filter(ImageFilter.UnsharpMask(radius=0.6, percent=70, threshold=0))
    t.putalpha(rounded(s, round(s * 0.22)))
    return t


def find_head(bot):
    """The helmet: the top 42% of the mascot below its antenna, squared up."""
    a = np.asarray(bot.getchannel('A')) > 96
    widths = a.sum(1)
    top = int(np.argmax(widths >= 0.3 * widths.max()))          # first row past the antenna
    band = a[top:top + int(0.42 * a.shape[0])]
    cols = np.where(band.any(0))[0]
    x0, x1 = int(cols.min()), int(cols.max()) + 1
    side = max(x1 - x0, band.shape[0])
    cx = (x0 + x1) / 2
    left = int(round(cx - side / 2))
    top = max(0, top - int(0.04 * side))
    return left, top, side


def crop_square(im, left, top, side):
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im.crop((max(0, left), max(0, top), min(im.width, left + side), min(im.height, top + side))),
                       (max(0, -left), max(0, -top)))
    return sq


def ico(frames):
    """A .ico with PNG frames (every browser since 2010 reads them)."""
    pngs = []
    for f in frames:
        b = io.BytesIO(); f.save(b, 'PNG', optimize=True); pngs.append(b.getvalue())
    out = struct.pack('<HHH', 0, 1, len(frames))
    off = 6 + 16 * len(frames)
    for f, p in zip(frames, pngs):
        out += struct.pack('<BBBBHHII', f.width % 256, f.height % 256, 0, 0, 1, 32, len(p), off)
        off += len(p)
    return out + b''.join(pngs)


def og_image(bot, work):
    shutil.copy(os.path.join(HERE, 'og.html'), os.path.join(work, 'og.html'))
    fit(bot, 1000, 1000).save(os.path.join(work, 'bot.png'))
    shot = os.path.join(work, 'og.png')
    if not os.path.exists(CHROME):
        die(f'no Chrome at {CHROME} (set CHROME=…); the OG image needs it')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
                    f'--user-data-dir={work}/chrome', '--force-device-scale-factor=1', '--window-size=1200,630',
                    '--virtual-time-budget=8000', f'--screenshot={shot}', 'file://' + os.path.join(work, 'og.html')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    im = Image.open(shot).convert('RGB')
    if im.size != (1200, 630):
        die(f'Chrome drew the OG image at {im.size}, not 1200×630')
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=88, optimize=True, progressive=True, subsampling='4:4:4')
    return b.getvalue()


def generate(src, head_box, dest):
    im = Image.open(src)
    if 'A' not in im.getbands() and 'transparency' not in im.info:
        die(f'{src} has no transparency; matte it first (tools/mascot/matte.py)')
    im = im.convert('RGBA')
    alpha = np.asarray(im.getchannel('A'))
    if (alpha < 16).mean() < 0.05:
        die(f'{src} is (almost) fully opaque: a painted checkerboard? Matte it first (tools/mascot/matte.py)')
    box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if box[0] == 0 or box[1] == 0 or box[2] == im.width or box[3] == im.height:
        print('make.py: warning: the mascot touches the edge of the source; is something cut off?')
    if max(box[2] - box[0], box[3] - box[1]) < 1024:
        print(f'make.py: warning: the mascot is only {box[2] - box[0]}×{box[3] - box[1]}px; the 512 icon and the OG image want ≥1024')
    bot = im.crop(box)
    if head_box:
        x, y, s = head_box
        head = crop_square(im, x, y, s)
    else:
        x, y, s = find_head(bot)
        head = crop_square(bot, x, y, s)
        x, y = x + box[0], y + box[1]
    print(f'head    {x},{y},{s} in source pixels (override: --head X,Y,SIZE)')

    out = {}
    small = {s: head_tile(head, s) for s in SMALL}
    out['favicon.ico'] = ico([small[16], small[32], small[48]])
    for name, s in [('assets/favicon-16x16.png', 16), ('assets/favicon-32x32.png', 32), ('assets/favicon.png', 64)]:
        out[name] = small[s]
    out['assets/apple-touch-icon.png'] = place(background(180, 180), fit(bot, 180 * 0.78, 180 * 0.8), None).convert('RGB')
    for s in (192, 512):
        t = place(background(s, s), fit(bot, s * 0.76, s * 0.8), None)
        t.putalpha(rounded(s, round(s * 0.22)))
        out[f'assets/icon-{s}.png'] = t
        r = 0.38 * s                                  # inside the 40% safe circle, with a margin
        k = r / (0.5 * (bot.width ** 2 + bot.height ** 2) ** 0.5)
        out[f'assets/icon-maskable-{s}.png'] = place(background(s, s), resize(bot, bot.width * k, bot.height * k), None).convert('RGB')
    work = tempfile.mkdtemp(prefix='ff-icons.')
    out['assets/og-image.jpg'] = og_image(bot, work)

    for name, data in out.items():
        path = os.path.join(dest, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if isinstance(data, bytes):
            open(path, 'wb').write(data)
        else:
            data.save(path, 'PNG', optimize=True)
    sheet(dest, os.path.join(work, 'sheet.png'))
    print(f'sheet   {work}/sheet.png')


def sheet(dest, path):
    """Every output on a light and a dark strip, the small ones also at 4×."""
    c = Image.new('RGB', (1500, 1060), (40, 40, 48))
    d = ImageDraw.Draw(c)
    og = Image.open(os.path.join(dest, 'assets/og-image.jpg')).convert('RGB')
    c.paste(og.resize((900, 473), Image.LANCZOS), (20, 20))
    d.rectangle((20 + 450 - 236, 20, 20 + 450 + 236, 493), outline=(255, 200, 0))   # a square crop's view
    x = 940
    for name, s in [('assets/icon-512.png', 256), ('assets/icon-maskable-512.png', 256), ('assets/apple-touch-icon.png', 180)]:
        im = Image.open(os.path.join(dest, name)).convert('RGBA').resize((s, s), Image.LANCZOS)
        if 'maskable' in name:   # what Android's circle mask keeps
            m = Image.new('L', (s, s), 0); ImageDraw.Draw(m).ellipse((0, 0, s - 1, s - 1), fill=255); im.putalpha(m)
        c.paste(im, (x, 20), im) if x + s < 1500 else None
        x += s + 20
    for row, strip in enumerate([(245, 245, 247), (32, 33, 36)]):
        y = 540 + row * 260
        d.rectangle((20, y, 1480, y + 240), fill=strip)
        x = 40
        for s in SMALL:
            im = Image.open(os.path.join(dest, 'assets/favicon.png' if s == 64 else f'assets/favicon-{s}x{s}.png') if s != 48 else
                            os.path.join(dest, 'favicon.ico')).convert('RGBA')
            if im.size != (s, s):
                im = im.resize((s, s), Image.LANCZOS)
            c.paste(im, (x, y + 20), im)
            big = im.resize((s * 4, s * 4) if s <= 32 else (min(s * 2, 128), min(s * 2, 128)), Image.NEAREST)
            c.paste(big, (x, y + 20 + s + 10), big)
            x += max(s * 4, 128) + 40
    c.save(path)


def manifest():
    """Its icons: one list for "any" and one for "maskable" (a single icon can't be both well)."""
    p = os.path.join(ROOT, 'assets', 'site.webmanifest')
    m = json.load(open(p, encoding='utf-8'))
    m['icons'] = [dict(src='/' + f, sizes=s, type='image/png', **({'purpose': u} if u else {})) for f, s, u in MANIFEST_ICONS]
    open(p, 'w', encoding='utf-8').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')


def bump():
    def h8(p):
        return hashlib.sha256(open(os.path.join(ROOT, p), 'rb').read()).hexdigest()[:8]

    def patch(url, v):
        # only real references: right after a quote or the site's origin, up to the closing quote
        pat = re.compile(r'(?:(?<=["\'])|(?<=https://findfilm\.ai))' + re.escape(url) + r'(\?v=[0-9a-f]{8})?(?=["\'])')
        for f in REFS:
            p = os.path.join(ROOT, f)
            txt = open(p, encoding='utf-8').read()
            new = pat.sub(f'{url}?v={v}', txt)
            if new != txt:
                open(p, 'w', encoding='utf-8').write(new)

    for name, url in OUT.items():
        if os.path.exists(os.path.join(ROOT, name)):
            v = h8(name)
            patch(url, v)
            print(f'?v={v}  {name}  {os.path.getsize(os.path.join(ROOT, name))} B')
    v = h8('assets/site.webmanifest')    # its icon URLs just changed
    patch('/assets/site.webmanifest', v)
    print(f'?v={v}  assets/site.webmanifest')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Rebuild the site icons + OG image from one transparent PNG of the mascot.')
    ap.add_argument('source', nargs='?', default=os.path.join(ROOT, 'raw', 'ff-bot-clapper.png'))
    ap.add_argument('--head', help='X,Y,SIZE: the small icons\' square, in source pixels')
    ap.add_argument('--out', help='write into this directory instead (a dry run)')
    ap.add_argument('--bump', action='store_true', help='only re-hash the current files and bump ?v=')
    args = ap.parse_args()
    if args.bump:
        bump(); sys.exit(0)
    if not os.path.exists(args.source):
        die(f'no source at {args.source}')
    head = tuple(int(v) for v in args.head.split(',')) if args.head else None
    generate(args.source, head, os.path.abspath(args.out) if args.out else ROOT)
    if not args.out:
        manifest()
        bump()
