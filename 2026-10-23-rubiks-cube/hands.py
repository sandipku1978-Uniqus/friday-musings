"""Mini robot hands that push each turning layer, drawn in screen space."""
import numpy as np
from PIL import Image, ImageDraw
from cube import Cube, rot_matrix

# colours
METAL = (232, 235, 242, 255)
METAL_MID = (176, 182, 198, 255)
DARK = (52, 56, 76, 255)
ACCENT = (91, 44, 159, 255)
GLOW = (168, 120, 255, 255)
SHADOW = (40, 30, 20, 46)

HAND_SCALE = 0.86
AVOID = []  # extra screen rectangles (unscaled px) the hand should keep clear of


def rr_points(x0, y0, x1, y1, r, steps=4):
    """Rounded rectangle outline as points (local coordinates)."""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    for cx, cy, a0 in [(x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)]:
        for i in range(steps + 1):
            a = np.radians(a0 + 90 * i / steps)
            pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return pts


# Hand design in local px: index finger points along +x, fingertip at (0, 0),
# palm hangs on the +y side.
PARTS = [
    # (kind, geometry, fill, outline)
    ('rr', (-215, 8, -150, 40, 16), METAL_MID, DARK),          # forearm rod
    ('circle', (-150, 24, 21), DARK, None),                     # wrist joint
    ('circle', (-150, 24, 11), METAL_MID, None),
    ('rr', (-146, -4, -124, 52, 7), ACCENT, None),              # wrist cuff
    ('rr', (-128, -10, -58, 56, 18), METAL, DARK),              # palm
    ('circle', (-92, 24, 9), METAL_MID, None),                  # palm bolt
    ('rr', (-108, -26, -82, -6, 8), METAL, DARK),               # thumb
    ('rr', (-72, 10, -48, 24, 7), METAL, DARK),                 # curled fingers
    ('rr', (-74, 25, -50, 39, 7), METAL, DARK),
    ('rr', (-78, 40, -56, 53, 7), METAL, DARK),
    ('rr', (-64, -8, -32, 8, 7), METAL, DARK),                  # index finger, segment 1
    ('circle', (-32, 0, 9), DARK, None),                        # knuckle
    ('rr', (-32, -7, -6, 7, 7), METAL, DARK),                   # index finger, segment 2
    ('circle', (-4, 0, 8), GLOW, ACCENT),                       # fingertip pad
]


def draw_hand(overlay_draw, tip, direction, flip, ss, alpha=1.0, scale=HAND_SCALE):
    """tip: screen px (supersampled). direction: unit screen vector the finger points along."""
    v = np.asarray(direction, float)
    v = v / (np.linalg.norm(v) + 1e-9)
    perp = np.array([-v[1], v[0]]) * (1 if flip else -1)
    k = scale * ss
    tip = np.asarray(tip, float)

    def tf(x, y):
        p = tip + k * (x * v + y * perp)
        return (float(p[0]), float(p[1]))

    def with_alpha(c):
        if c is None:
            return None
        return c[:3] + (int(c[3] * alpha),)

    for pass_ in ('shadow', 'body'):
        off = np.array([6, 10]) * k if pass_ == 'shadow' else np.zeros(2)
        for kind, g, fill, outline in PARTS:
            if kind == 'rr':
                x0, y0, x1, y1, r = g
                pts = [tf(x, y) for x, y in rr_points(x0, y0, x1, y1, r)]
            else:
                cx, cy, r = g
                c = np.array(tf(cx, cy))
            if pass_ == 'shadow':
                if kind == 'rr':
                    overlay_draw.polygon([(x + off[0], y + off[1]) for x, y in pts], fill=with_alpha(SHADOW))
                continue
            if kind == 'rr':
                overlay_draw.polygon(pts, fill=with_alpha(fill), outline=with_alpha(outline),
                                     width=max(1, int(2.2 * k)) if outline else 0)
            else:
                rr = r * k
                overlay_draw.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], fill=with_alpha(fill),
                                     outline=with_alpha(outline), width=max(1, int(2 * k)) if outline else 0)


class HandPath:
    """Where the fingertip sits on the turning layer, for any turn fraction theta."""

    def __init__(self, cube, move, project, center, ss=2):
        self.project = project
        self.axis, turns = Cube.move_spec(move)
        self.total = -np.pi / 2 * turns
        c0 = np.array(center, float)
        self.center = c0
        hull = convex_hull([project(np.array(p, float)) for p in
                            [(x, y, z) for x in (-1.5, 1.5) for y in (-1.5, 1.5) for z in (-1.5, 1.5)]])
        k = HAND_SCALE * ss
        best, best_key = None, None
        for q in cube.layer(move):
            for s, _ in q.stickers:
                n = np.asarray(s, float)
                if not (n[0] > 0 or n[1] > 0 or n[2] > 0):   # only faces the camera can see
                    continue
                p = q.pos.astype(float) + n * 0.5
                a = np.array(project(p))
                b = np.array(project(rot_matrix(self.axis, self.total * 0.02) @ p))
                vel = b - a
                if np.linalg.norm(vel) < 1e-3:
                    continue
                v = vel / np.linalg.norm(vel)
                perp = np.array([-v[1], v[0]])
                if np.dot(perp, a - c0) < 0:
                    perp = -perp
                # sample the hand's footprint; we want it off the cube
                samples = [a + k * (x * v + y * perp) for x in (-45, -90, -140, -190) for y in (0, 30)]
                overlap = sum(inside(hull, pt) for pt in samples)
                # keep clear of the title (top) and the move label (bottom)
                overlap += 2 * sum((pt[1] > 752 * ss) or (pt[1] < 262 * ss) or pt[0] < 30 * ss or pt[0] > 1050 * ss
                                   for pt in samples)
                for (x0, y0, x1, y1) in AVOID:
                    overlap += 2 * sum(x0 * ss <= pt[0] <= x1 * ss and y0 * ss <= pt[1] <= y1 * ss for pt in samples)
                trailing = float(np.dot(a - c0, -v))
                key = (overlap, -(1 if abs(n[2]) > 0.5 else 0), -trailing)
                if best_key is None or key < best_key:
                    best, best_key = p, key
        self.p0 = best

    def at(self, theta):
        th = min(max(theta, 0.0), 1.0)
        a = np.array(self.project(rot_matrix(self.axis, self.total * th) @ self.p0))
        d = 0.03
        t0, t1 = (th, th + d) if th + d <= 1 else (th - d, th)
        p0 = np.array(self.project(rot_matrix(self.axis, self.total * t0) @ self.p0))
        p1 = np.array(self.project(rot_matrix(self.axis, self.total * t1) @ self.p0))
        v = p1 - p0
        v = v / (np.linalg.norm(v) + 1e-9)
        return a, v

    def flip(self):
        a, v = self.at(0)
        perp = np.array([-v[1], v[0]])
        # palm on the side away from the cube centre (draw_hand uses -perp when flip is False)
        return bool(np.dot(perp, a - self.center) > 0)


def lerp_state(s0, s1, t):
    t = t * t * (3 - 2 * t)
    pos = s0[0] * (1 - t) + s1[0] * t
    v = s0[1] * (1 - t) + s1[1] * t
    if np.linalg.norm(v) < 1e-6:
        v = s1[1]
    v = v / np.linalg.norm(v)
    flip = s1[2] if t > 0.5 else s0[2]
    return pos, v, flip


def convex_hull(points):
    pts = sorted(set((float(x), float(y)) for x, y in points))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def inside(hull, p):
    n = len(hull)
    sign = None
    for i in range(n):
        a, b = hull[i], hull[(i + 1) % n]
        c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if abs(c) < 1e-9:
            continue
        sgn = c > 0
        if sign is None:
            sign = sgn
        elif sgn != sign:
            return False
    return True
