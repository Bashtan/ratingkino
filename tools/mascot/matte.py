# Pull the mascot off the checkerboard painted into the pose sheet: a real
# alpha channel, edges anti-aliased against the checker they were drawn over,
# glows kept as glows, the magnifying glass's lens kept as tinted glass.
#   python3 matte.py <sheet> <out.png> [regions.png]
# regions.png (optional) shows what was decided: red = see-through,
# green = the lens, blue = opaque robot. A sheet that already has real
# transparency is passed through untouched.
import sys
import numpy as np
from PIL import Image
from checker import load, blur1, fit_grid, lightness

def shift(a, dy, dx, fill=0):
    out = np.full_like(a, fill)
    h, w = a.shape[:2]
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[ys, xs] = a[yd, xd]
    return out

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
N4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]

def dilate(m, r):
    for i in range(r):
        nb = N8 if i % 2 == 0 else N4      # alternate square/cross ≈ disk
        m = m | np.logical_or.reduce([shift(m, dy, dx, False) for dy, dx in nb])
    return m

def erode(m, r):
    return ~dilate(~m, r)

def label(mask):
    """4-connected components: min-label propagation with pointer jumping."""
    h, w = mask.shape
    lab = np.where(mask, np.arange(h * w).reshape(h, w), h * w)
    big = h * w
    while True:
        prev = lab
        for dy, dx in N4:
            nb = shift(lab, dy, dx, big)
            lab = np.where(mask, np.minimum(lab, nb), big)
        flat = lab.ravel()
        for _ in range(6):
            ok = flat < big
            flat = np.where(ok, flat[np.minimum(flat, big - 1)], big)
        lab = flat.reshape(h, w)
        if np.array_equal(lab, prev):
            return lab

# The magnifying glass's lens in raw/ff-bot-emotions.jpg (centre x, y, radius in
# sheet pixels): drawn as tinted glass over the checker. A new sheet: measure
# it again, or None if nothing in it is see-through.
LENS = (347.5, 289.5, 28.5)

# >1 fades a decoration's faint outer haze faster (2 ≈ alpha²). Over the site's
# near-black background the full haze reads as smoke round the bulb.
GLOW_FALLOFF = 1.8

def matte(I, debug=None):
    h, w, _ = I.shape
    grid = fit_grid(I)
    print('  checker: cell %.4f × %.4f px, first edges at x %.2f, y %.2f' % (grid[0], grid[2], grid[1], grid[3]))
    Lf = lightness(h, w, grid)
    band = I[:30]; lf = Lf[:30]
    L = band[lf > 0.98].mean(0); K = band[lf < 0.02].mean(0)
    B = K + Lf[..., None] * (L - K)
    D = np.abs(I - B).max(2)
    T_BG, T_SOLID, T_CORE = 28, 60, 110
    solid = D >= T_SOLID

    # 1. The four robots (+ what they hold): the four big solid components…
    lab = label(solid)
    ls, cnt = np.unique(lab[solid], return_counts=True)
    bodies = ls[np.argsort(cnt)[-4:]]
    body0 = np.isin(lab, bodies)
    # Grow into what barely differs from the checker: grey fingers over a light cell
    # are only ~10-30 levels off it. Cell interiors are flat (noise < 10), so a low
    # threshold works there; cell edges carry more noise. Neutral pixels only (the
    # robots' greys and whites), and only near the robot, so glows stay out. Grey
    # fingertips split off by a dark joint line are their own small solid
    # components: neutral ones that the growing hand reaches belong to it too.
    sat = I.max(2) - I.min(2)
    edgy = (Lf > 0.04) & (Lf < 0.96)
    fg_low = D >= np.where(edgy, 26, 12)
    neutral = sat < 20
    body = body0.copy()
    for _ in range(4):
        reach = dilate(body, 6)
        for l in np.unique(lab[solid & reach & ~body]):
            comp = lab == l
            if comp.sum() >= 15 and sat[comp].mean() < 16:
                body |= comp
        for _ in range(12):
            body |= dilate(body, 1) & fg_low & neutral & dilate(body0, 24)
    body0 = body0 | (body & solid)
    near = dilate(body0, 12)
    body |= erode(dilate(body, 2), 2) & near
    # Faint glow around a decoration is light, not robot, even where it touches one.
    # Peeled from the outside in, so nothing enclosed (a visor) is touched.
    deco = (D >= T_CORE) & ~dilate(body0, 10)       # free-floating bright things only, not a fingertip's glint
    cand = dilate(deco, 25) & body & ~body0 & (D < 30)
    gl = label(~body)
    bd = np.zeros((h, w), bool); bd[0, :] = bd[-1, :] = bd[:, 0] = bd[:, -1] = True
    ext = np.isin(gl, np.unique(gl[bd & ~body]))
    for _ in range(12):
        rm = cand & dilate(ext, 1)
        if not rm.any(): break
        body &= ~rm; ext |= rm; cand &= ~rm
    # Nothing of a robot is above its antenna ball (the idea bulb floats there).
    for l in bodies:
        ys_, xs_ = np.where(lab == l)
        top = ys_.min()
        body[max(0, top - 80):top, xs_.min():xs_.max() + 1] = False
    # 2. Holes inside a robot: background seen through a gap goes, anything else is the robot.
    ys, xs = np.mgrid[0:h, 0:w]
    cx, cy, r = LENS or (0, 0, -1)
    lens = (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r if LENS else np.zeros((h, w), bool)
    holes = ~body
    hl = label(holes)
    border = np.zeros((h, w), bool); border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    outside = np.isin(hl, np.unique(hl[border & holes]))
    Ig, Bg = I.mean(2), B.mean(2)
    see = outside.copy()
    val = I.mean(2)
    for l in np.unique(hl[holes & ~outside]):
        comp = (hl == l) & ~lens
        if not comp.any(): continue
        ring = dilate(comp, 2) & ~comp
        if (val[ring] < 30).mean() > 0.3: continue   # bordered by the black visor: it IS the visor
        if (np.abs(val[ring] - val[comp].mean()) < 12).mean() > 0.4: continue   # same shade as much of its border: one surface (the visor's grey sheen)
        if (D[comp] < 12).mean() < 0.75: continue      # not mostly an exact checker match: it's the robot
        if D[comp].mean() < 8: see |= comp; continue   # plain checker showing through (a grey fingertip is ~15 off)
        x, y = Bg[comp], Ig[comp]
        if comp.sum() < 12 or x.std() < 5: continue
        sl, _ = np.polyfit(x, y, 1)
        if np.corrcoef(x, y)[0, 1] > 0.8 and sl > 0.8: see |= comp
    opaque = ~see & ~lens

    # 3. The lens: one glass colour F at constant alpha fits it (I = a·F + (1-a)·B).
    if LENS:
        inner = lens & ((xs - cx) ** 2 + (ys - cy) ** 2 <= (r - 3) ** 2)
        sl, _ = np.polyfit(Bg[inner], Ig[inner], 1)
        ga = 1 - sl
        glassF = ((I[inner] - (1 - ga) * B[inner]) / ga).mean(0)
        print('  lens: alpha %.2f, colour %s' % (ga, glassF.round()))

    # 4. Foreground colour for everything partial: bleed solid interiors outwards.
    core = erode(opaque, 1) | (see & (D >= T_CORE))
    F = np.where(core[..., None], I, 0.0); known = core.copy()
    for _ in range(80):
        acc = np.zeros_like(F); n = np.zeros((h, w))
        for dy, dx in N8:
            k = shift(known, dy, dx, False)
            acc += shift(F, dy, dx, 0.0) * k[..., None]; n += k
        new = ~known & (n > 0)
        if not new.any(): break
        F[new] = acc[new] / n[new][:, None]; known |= new
    if LENS:
        F[lens] = glassF

    # 5. Alpha: project (I - B) onto (F - B). Opaque interiors stay 1.
    dFB = F - B
    n2 = (dFB ** 2).sum(2)
    a_proj = np.clip(((I - B) * dFB).sum(2) / np.maximum(n2, 1), 0, 1)
    weak = n2 < 3 * 40 ** 2               # foreground ≈ checker colour: can't tell, trust the mask
    alpha = np.ones((h, w))
    edge = opaque & ~erode(opaque, 3)
    alpha[edge] = np.where(weak | (D >= 40), 1.0, a_proj)[edge]
    # Decorations (sparkles, ?, the bulb) are light, not paint: their glow ADDS to
    # the checker (I ≈ B + g). Take g = I - B (smoothed where faint, so the checker's
    # edges don't print through), then alpha = how much of F that is.
    G = I - B
    Gs = np.stack([blur1(blur1(G[..., c], 1.0, 0), 1.0, 1) for c in range(3)], 2)
    G = np.where((D >= T_SOLID)[..., None], G, Gs)
    Ds = blur1(blur1(D, 1.0, 0), 1.0, 1)
    nF = np.maximum((F ** 2).sum(2), 1)
    a_add = np.clip((G * F).sum(2) / nF, 0, 1) * np.clip((Ds - 10) / 20, 0, 1)
    a_add = a_add ** GLOW_FALLOFF       # halos: keep the glow near its source, let the far haze go
    # …but their bright solid parts (the bulb's glass, sparkle centres, the ?s) are opaque.
    a_add = np.maximum(a_add, np.clip((D - 90) / 40, 0, 1))
    alpha[see] = a_add[see]
    alpha[lens] = np.maximum(a_proj[lens], 0.25)

    # 6. Colour: the bled colour where faint; where solid, the decontaminated one
    #    (over-model for robot edges, additive for decorations).
    dec = np.clip(B + (I - B) / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    dec_add = np.clip(G / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    dec = np.where((see & (D < 90))[..., None], dec_add, dec)
    C = I.copy()
    part = alpha < 1
    mix = np.clip((alpha - 0.35) / 0.4, 0, 1)[..., None]
    C[part] = (mix * dec + (1 - mix) * F)[part]
    if debug:
        Image.fromarray((np.stack([see, lens, opaque], 2) * 255).astype(np.uint8)).save(debug)
    return np.dstack([C, alpha * 255]).round().clip(0, 255).astype(np.uint8)

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'PA') and im.getextrema()[-1][0] < 255:
        im.convert('RGBA').save(out)
        print('  already transparent: passed through')
    else:
        Image.fromarray(matte(load(src), debug=sys.argv[3] if len(sys.argv) > 3 else None)).save(out)
    print('wrote', out)
