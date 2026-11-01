# Cut the FF Bot out of a pose sheet whose "transparency" is a checkerboard
# painted into an opaque image, when the robot's white is as bright as the
# checker's white cells, which matte.py (tuned for raw/ff-bot-emotions.jpg)
# cuts holes into:
#   python3 checker_matte.py <sheet> <out.png>
# A sheet that already has real transparency is passed through untouched.
# Used by cut.sh for raw/ff-bot-reactions.png, and by the TikTok bot's
# tools/build-moods.py (findfilm-tiktok-bot) for its extra sheets.
#
# The checker model (cell size, phase, the two shades) comes from checker.py:
# every pixel is compared with the checker it was painted over (D). Then:
#   1. Background spreads from the image border through checker CELLS that
#      match it throughout and share a side, never a corner. A white cell
#      inside a bright helmet can match, but its four grey neighbours over the
#      helmet don't, so it's never reached.
#   2. An enclosed matching cell (a gap between an arm and the body) is
#      background when its noise is no worse than the reached background's.
#   3. Inside the cells the outline crosses, pixels that match are background
#      if they connect to it.
#   4. Larger enclosed gaps with partly covered cells: matching pixels showing
#      both shades. A grey body panel can match the grey cells, never the white
#      ones as well.
#   5. The outline is smoothed (the per-pixel decisions are noisy against white
#      cells), alpha is softened by a pixel, and edge colours are bled from the
#      inside so no checker grey or white rides along.
import sys
import numpy as np
from PIL import Image
from checker import load, fit_grid, lightness, blur1
from matte import label, dilate, erode, shift, N8

T_IN, T_EDGE = 7, 14         # match thresholds: cell interiors, cell edges


def checker_matte(I):
    h, w, _ = I.shape
    tx, px, ty, py = fit_grid(I)
    print('  checker: cell %.4f × %.4f px, first edges at x %.2f, y %.2f' % (tx, ty, px, py))
    Lf = lightness(h, w, (tx, px, ty, py))
    band, lf = I[:30], Lf[:30]
    A = band[lf > 0.98].mean(0)
    Z = band[lf < 0.02].mean(0)
    B = Z + Lf[..., None] * (A - Z)
    D = np.abs(I - B).max(2)
    edgy = (Lf > 0.04) & (Lf < 0.96)
    inner = ~edgy
    like = D < np.where(edgy, T_EDGE, T_IN)

    # 1. cells
    ys, xs = np.mgrid[0:h, 0:w]
    cx = np.floor((xs - px) / tx).astype(int) + 1
    cy = np.floor((ys - py) / ty).astype(int) + 1
    nx, ny = cx.max() + 1, cy.max() + 1
    cid = cy * nx + cx
    tot = np.bincount(cid[inner], minlength=nx * ny)
    hit = np.bincount(cid[inner & like], minlength=nx * ny)
    frac = (hit / np.maximum(tot, 1)).reshape(ny, nx)
    full = frac >= 0.97
    part = (frac > 0.02) & ~full
    seed = np.zeros((ny, nx), bool)
    seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    lab = label(full)
    bgc = np.isin(lab, np.unique(lab[seed & full]))

    # 2. enclosed matching cells
    order = np.argsort(cid[inner], kind='stable')
    dsorted = D[inner][order]
    starts = np.searchsorted(cid[inner][order], np.arange(nx * ny))
    ends = np.searchsorted(cid[inner][order], np.arange(nx * ny), side='right')
    med = np.array([np.median(dsorted[s:e]) if e > s else 99.0 for s, e in zip(starts, ends)]).reshape(ny, nx)
    noise = np.percentile(med[bgc], 95)
    bgc |= full & ~bgc & (med <= noise)
    bg = bgc.reshape(-1)[cid]

    # 3. the outline's cells
    grow = like & part.reshape(-1)[cid]
    for _ in range(int(max(tx, ty)) * 2):
        nb = dilate(bg, 1) & grow & ~bg
        if not nb.any():
            break
        bg |= nb

    # 4. larger enclosed gaps
    pl = label(like & ~bg)
    for l in np.unique(pl[like & ~bg]):
        comp = pl == l
        n = comp.sum()
        if n >= 150 and (comp & (Lf > 0.98)).sum() / n > 0.15 and (comp & (Lf < 0.02)).sum() / n > 0.15:
            bg |= comp

    # 5. outline, alpha, colour
    fg = blur1(blur1((~bg).astype(float), 1.5, 0), 1.5, 1) > 0.5
    fl = label(fg)
    ls, cnt = np.unique(fl[fg], return_counts=True)
    big = np.isin(fl, ls[cnt >= 2000])
    fg = big | (np.isin(fl, ls[cnt >= 25]) & dilate(big, 40))   # popcorn in flight stays, specks go
    a = blur1(blur1(fg.astype(float), 0.8, 0), 0.8, 1)
    a = np.where(erode(fg, 2), 1.0, np.where(~dilate(fg, 2), 0.0, a))
    core = erode(fg, 2)
    F = np.where(core[..., None], I, 0.0)
    known = core.copy()
    for _ in range(6):
        acc = np.zeros_like(F)
        n = np.zeros((h, w))
        for dy, dx in N8:
            k = shift(known, dy, dx, False)
            acc += shift(F, dy, dx, 0.0) * k[..., None]
            n += k
        new = ~known & (n > 0)
        F[new] = acc[new] / n[new][:, None]
        known |= new
    C = np.where((fg & ~core)[..., None], F, I)
    return np.dstack([C, a * 255]).round().clip(0, 255).astype(np.uint8)


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'PA') and im.getextrema()[-1][0] < 255:
        im.convert('RGBA').save(out)
        print('  already transparent: passed through')
    else:
        Image.fromarray(checker_matte(load(src))).save(out)
    print('wrote', out)
