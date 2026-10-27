# The pose sheet's "transparency" is a checkerboard painted into a JPEG
# (raw/ff-bot-emotions.jpg). Rebuild that checkerboard exactly — period and
# phase fitted from the sheet's own empty border — so every pixel can be
# compared with the background it was painted over.
import numpy as np
from PIL import Image


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float64)


def blur1(a, sigma, axis):
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    ap = np.pad(a, pad, mode='edge')
    out = np.zeros_like(a)
    for i, w in enumerate(k):
        sl = [slice(None)] * a.ndim; sl[axis] = slice(i, i + a.shape[axis])
        out += w * ap[tuple(sl)]
    return out


def _fit_axis(profiles):
    """Cell size and first boundary along one axis, from 1-D brightness
    profiles across the empty border (boundary = where light meets dark)."""
    fits = []
    for p in profiles:
        mid = (p.min() + p.max()) / 2
        s = p > mid
        idx = np.where(s[1:] != s[:-1])[0]
        t = idx + (mid - p[idx]) / (p[idx + 1] - p[idx])     # sub-pixel crossings
        n = np.arange(len(t))
        fits.append(np.polyfit(n, t, 1))                     # t = n·cell + first
    return np.mean(fits, 0)


def fit_grid(I, band=5):
    """(cell_x, first_x, cell_y, first_y), from the outermost rows and columns."""
    g = I.mean(2)
    tx, px = _fit_axis([g[2:2 + band].mean(0), g[-2 - band:-2].mean(0)])
    ty, py = _fit_axis([g[:, 2:2 + band].mean(1), g[:, -2 - band:-2].mean(1)])
    return tx, px, ty, py


def lightness(h, w, grid, sigma=0.55):
    """Fraction of each pixel covered by a light cell (anti-aliased, and
    slightly blurred like the resample the sheet went through)."""
    tx, px, ty, py = grid
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    acc = np.zeros((h, w))
    offs = (-0.375, -0.125, 0.125, 0.375)
    for dy in offs:
        cy = np.floor((ys + dy - py) / ty)
        for dx in offs:
            cx = np.floor((xs + dx - px) / tx)
            acc += ((cx + cy) % 2 == 0)
    acc /= 16
    return blur1(blur1(acc, sigma, 0), sigma, 1)
