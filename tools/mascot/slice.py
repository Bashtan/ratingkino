# Cut the matted 2×2 sheet (think · success / confused · idea) into the mood
# strip social.css expects: think · idea · success · confused, each 256×320.
#   python3 slice.py <matted-sheet.png> <strip.png>
# Every robot stands on its frame's bottom edge, centred on its helmet, all
# scaled by one factor so helmet-to-feet averages 238 of 320. That matches the
# standing mascot (ff-bot.webp: helmet-to-feet ≈ 0.89 of its height, shown in a
# box 1/0.85 that height ≈ 242 of 320); 238 lets the success pose's sparkles fit
# the frame's width. It prints how far each frame's content reaches: keep it
# inside 0..255 × 0..319.
import sys
import numpy as np
from PIL import Image
from matte import label

FW, FH = 256, 320
HELMET_TO_FEET = 238
QUAD = {'think': (0, 0), 'success': (1, 0), 'confused': (0, 1), 'idea': (1, 1)}
ORDER = ['think', 'idea', 'success', 'confused']

sheet = Image.open(sys.argv[1]).convert('RGBA')
W, H = sheet.size
qw, qh = W // 2, H // 2
# A glow can reach over the grid line (the idea bulb's halo pokes into the success
# cell), so each visible blob goes to the cell that holds its centre.
arr = np.asarray(sheet).copy()
arr[arr[..., 3] <= 12] = 0          # the matte's noise floor (≤ 5% alpha): nothing anyone can see
vis = arr[..., 3] > 0
blobs = label(vis)
owner = np.zeros((H, W), np.int8) - 1
for l in np.unique(blobs[vis]):
    ys, xs = np.nonzero(blobs == l)
    owner[ys, xs] = int(ys.mean() >= qh) * 2 + int(xs.mean() >= qw)
info = {}
for name, (cx, cy) in QUAD.items():
    mine = np.where((owner == cy * 2 + cx)[..., None], arr, 0).astype(np.uint8)
    full = Image.fromarray(mine)
    # the cell, with room around it for anything that strays over the line
    pad = 40
    x0, y0 = cx * qw - pad, cy * qh - pad
    q = Image.new('RGBA', (qw + 2 * pad, qh + 2 * pad), (0, 0, 0, 0))
    q.paste(full.crop((max(0, x0), max(0, y0), min(W, x0 + qw + 2 * pad), min(H, y0 + qh + 2 * pad))), (max(0, -x0), max(0, -y0)))
    a = np.asarray(q)[..., 3] > 128
    lab = label(a)
    ls, cnt = np.unique(lab[a], return_counts=True)
    robot = lab == ls[cnt.argmax()]
    rows = robot.sum(1)
    helmet_top = int(np.argmax(rows > 80))
    bottom = int(np.where(rows > 0)[0].max())
    band = range(helmet_top + 10, helmet_top + 60)
    axis = np.mean([(np.where(robot[y])[0].min() + np.where(robot[y])[0].max()) / 2 for y in band])
    info[name] = dict(img=q, top=helmet_top, bottom=bottom, axis=axis)
    print(f'{name:9s} helmet {helmet_top}→{bottom} = {bottom - helmet_top}px  axis x {axis:.1f}')

s = HELMET_TO_FEET / np.mean([v['bottom'] - v['top'] for v in info.values()])
print(f'scale {s:.4f}')
strip = Image.new('RGBA', (FW * 4, FH), (0, 0, 0, 0))
for i, name in enumerate(ORDER):
    v = info[name]
    q = v['img']
    # resample premultiplied, so edges don't pick up the colour of transparent pixels
    small = q.convert('RGBa').resize((round(q.width * s), round(q.height * s)), Image.LANCZOS).convert('RGBA')
    ox = round(FW / 2 - v['axis'] * s)
    oy = round(FH - (v['bottom'] + 1) * s)
    frame = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    frame.paste(small, (ox, oy))      # a plain copy (clipped): the frame is empty, and a mask would square alpha
    # what falls outside the frame?
    al = np.asarray(small)[..., 3].astype(float)
    ys, xs = np.nonzero(al > 8)
    print(f'{name:9s} content x {xs.min() + ox}..{xs.max() + ox}  y {ys.min() + oy}..{ys.max() + oy}  (frame 0..{FW - 1}, 0..{FH - 1})')
    strip.paste(frame, (i * FW, 0))
strip.save(sys.argv[2])
print('wrote', sys.argv[2])
