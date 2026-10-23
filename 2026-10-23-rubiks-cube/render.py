"""Render the 7-step Rubik's Cube tutorial video. Use build.py for the full pipeline."""
import subprocess
import sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont
from cube import Cube, invert, parse, rot_matrix, WORDS
from hands import draw_hand, HandPath, lerp_state

W = H = 1080
SS = 2  # supersampling
FPS = 24

# ---------------------------------------------------------------- palette
BG = (246, 244, 239)
INK = (20, 26, 52)
MUTED = (110, 112, 128)
ACCENT = (91, 44, 159)
CHIP = (232, 226, 243)
CHIP_DONE = (238, 236, 232)
STICKER = {
    'Y': (255, 210, 0), 'W': (250, 250, 248), 'G': (0, 158, 76),
    'B': (0, 75, 180), 'O': (255, 112, 0), 'R': (200, 22, 48),
}
BODY = (22, 22, 26)

import os
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, 'fonts') + os.sep          # Inter fonts ship with the repo (SIL OFL)
if not os.path.exists(FONT_DIR + 'Inter-Bold.otf'):
    FONT_DIR = '/usr/share/fonts/opentype/inter/'
def font(weight, size):
    return ImageFont.truetype(FONT_DIR + f'InterDisplay-{weight}.otf', size * SS)
def ifont(weight, size):
    return ImageFont.truetype(FONT_DIR + f'Inter-{weight}.otf', size * SS)

F_LABEL = ifont('Bold', 30)
F_TITLE = font('Bold', 70)
F_SUB = ifont('Medium', 34)
F_MOVE = font('Bold', 60)
F_CHIP = ifont('SemiBold', 25)
F_FOOT = ifont('Medium', 24)
F_BIG = font('Black', 92)
F_MID = font('SemiBold', 44)
F_DOT = ifont('Bold', 20)
F_DOT_BIG = ifont('Bold', 24)
F_ROW = font('SemiBold', 38)
F_ROW_SUB = ifont('Medium', 28)
F_RULE = ifont('Bold', 29)
GREEN = (0, 140, 70)

ARROW = {'R': '↑', "R'": '↓', "L'": '↑', 'L': '↓', 'U': '←', "U'": '→', 'y': '←', "y'": '→',
         'F': '↻', "F'": '↺', 'D': '→', "D'": '←'}

# ---------------------------------------------------------------- camera
D = np.array([1.0, 0.92, 1.12]); D /= np.linalg.norm(D)
RIGHT = np.array([D[2], 0.0, -D[0]]); RIGHT /= np.linalg.norm(RIGHT)
UPV = np.cross(D, RIGHT)
LIGHT = np.array([0.35, 1.0, 0.7]); LIGHT /= np.linalg.norm(LIGHT)
CAM_DIST = 9.0


def project(p, cx, cy, scale):
    depth = p @ D
    k = CAM_DIST / (CAM_DIST - depth)
    return (cx + scale * k * (p @ RIGHT), cy - scale * k * (p @ UPV))


def shade(rgb, n):
    f = 0.70 + 0.30 * max(0.0, float(n @ LIGHT))
    return tuple(int(min(255, c * f)) for c in rgb)


def rounded_square(half, r, steps=5):
    pts = []
    corners = [(half - r, half - r, 0), (-(half - r), half - r, 90),
               (-(half - r), -(half - r), 180), (half - r, -(half - r), 270)]
    for cx, cy, a0 in corners:
        for i in range(steps + 1):
            a = np.radians(a0 + 90 * i / steps)
            pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return pts


STICKER_2D = rounded_square(0.41, 0.09)
BODY_HALF = 0.5


def face_basis(n):
    n = np.asarray(n, float)
    a = np.array([0, 1, 0.0]) if abs(n[1]) < 0.9 else np.array([1, 0, 0.0])
    u = np.cross(n, a); u /= np.linalg.norm(u)
    v = np.cross(n, u)
    return u, v


def draw_cube(draw, cube, move=None, theta=0.0, yaw=0.0, cx=540, cy=505, scale=94):
    """Draw the cube. Each group (static part, turning layer) is a convex slab, so only its
    outer faces are drawn; slabs are painted far-to-near."""
    cx, cy, scale = cx * SS, cy * SS, scale * SS
    G = rot_matrix((0, 1, 0), yaw) if yaw else np.eye(3)
    moving_ids, Rm, axis = set(), np.eye(3), None
    if move:
        axis, turns = Cube.move_spec(move)
        Rm = rot_matrix(axis, -np.pi / 2 * turns * theta)
        moving_ids = {id(q) for q in cube.layer(move)}

    class Core:  # black centre piece, never moves
        pos = np.zeros(3, dtype=int)
        stickers = []
    pieces = list(cube.cubies) + [Core]
    groups = {True: [], False: []}
    for q in pieces:
        groups[id(q) in moving_ids].append(q)

    cam = D * CAM_DIST

    def paint(group, M):
        occupied = {tuple(q.pos) for q in group}
        faces = []
        for q in group:
            stick = {tuple(s): col for s, col in q.stickers}
            c = M @ q.pos.astype(float)
            for base_n in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]:
                if tuple(np.add(q.pos, base_n)) in occupied:
                    continue
                n_world = M @ np.array(base_n, float)
                fc = c + n_world * BODY_HALF
                if n_world @ (cam - fc) <= 0:
                    continue
                bu, bv = face_basis(base_n)
                faces.append((np.linalg.norm(cam - fc), fc, n_world, stick.get(base_n), M @ bu, M @ bv))
        faces.sort(key=lambda t: -t[0])
        for _, fc, n_world, col, u, v in faces:
            h = BODY_HALF
            body = [fc + u * a + v * b for a, b in [(h, h), (-h, h), (-h, -h), (h, -h)]]
            bc = shade(BODY, n_world)
            draw.polygon([project(p, cx, cy, scale) for p in body], fill=bc, outline=bc, width=SS)
            if col:
                ctr = fc + n_world * 0.003
                pts = [ctr + u * a + v * b for a, b in STICKER_2D]
                draw.polygon([project(p, cx, cy, scale) for p in pts], fill=shade(STICKER[col], n_world))

    if move:
        layer_front = (G @ axis.astype(float)) @ D > 0
        order = [(groups[False], G), (groups[True], G @ Rm)]
        if not layer_front:
            order.reverse()
        for grp, M in order:
            paint(grp, M)
    else:
        paint(pieces, G)


# ---------------------------------------------------------------- text helpers
def text_center(draw, y, s, f, fill):
    w = draw.textlength(s, font=f)
    draw.text(((W * SS - w) / 2, y * SS), s, font=f, fill=fill)


def wrap(draw, s, f, maxw):
    words, lines, cur = s.split(), [], ''
    for wd in words:
        t = (cur + ' ' + wd).strip()
        if draw.textlength(t, font=f) <= maxw * SS:
            cur = t
        else:
            lines.append(cur); cur = wd
    if cur:
        lines.append(cur)
    return lines


def pill(draw, x, y, w, h, fill, r=None):
    r = h / 2 if r is None else r
    draw.rounded_rectangle([x * SS, y * SS, (x + w) * SS, (y + h) * SS], radius=r * SS, fill=fill)


def chips_row(draw, moves, current, y):
    """Draw the recipe as chips; current index highlighted. Returns height used."""
    labels = [WORDS[m] for m in moves]
    pad, gap, h = 18, 10, 46
    widths = [draw.textlength(l, font=F_CHIP) / SS + 2 * pad for l in labels]
    rows, row, rw = [], [], 0
    maxw = W - 100
    for i, w in enumerate(widths):
        if row and rw + gap + w > maxw:
            rows.append(row); row, rw = [], 0
        row.append(i); rw += (gap if rw else 0) + w
    rows.append(row)
    for r_i, row in enumerate(rows):
        total = sum(widths[i] for i in row) + gap * (len(row) - 1)
        x = (W - total) / 2
        yy = y + r_i * (h + gap)
        for i in row:
            if i == current:
                fill, tc = ACCENT, (255, 255, 255)
            elif current is not None and i < current:
                fill, tc = CHIP_DONE, (160, 160, 168)
            else:
                fill, tc = CHIP, (70, 60, 100)
            pill(draw, x, yy, widths[i], h, fill)
            draw.text(((x + pad) * SS, (yy + 9) * SS), labels[i], font=F_CHIP, fill=tc)
            x += widths[i] + gap
    return len(rows) * (h + gap)


from PIL import ImageFilter
_SHADOW = {}
def shadow_layer(y):
    if y not in _SHADOW:
        m = Image.new('L', (W * SS, H * SS), 0)
        ImageDraw.Draw(m).ellipse([350 * SS, (y - 17) * SS, 730 * SS, (y + 17) * SS], fill=70)
        _SHADOW[y] = m.filter(ImageFilter.GaussianBlur(18 * SS))
    return _SHADOW[y]


def base_frame(shadow_y=739):
    img = Image.new('RGB', (W * SS, H * SS), BG)
    if shadow_y:
        img.paste((150, 145, 135), mask=shadow_layer(shadow_y))
    return img, ImageDraw.Draw(img)


def footer(draw):
    text_center(draw, 1028, '#FridayMusings  ·  Sandip Khetan', F_FOOT, MUTED)


def finish(img):
    return img.resize((W, H), Image.LANCZOS)


# ---------------------------------------------------------------- scenes
def ease(t):
    return t * t * (3 - 2 * t)


class Movie:
    def __init__(self, out):
        self.proc = subprocess.Popen(
            ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
             '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow',
             '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
            stdin=subprocess.PIPE)
        self.frames = 0
        self.events = []

    def mark(self, kind):
        self.events.append((self.frames / FPS, kind))

    def add(self, img, n=1):
        b = img.tobytes()
        for _ in range(n):
            self.proc.stdin.write(b)
            self.frames += 1

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


def progress_dots(draw, current, y=52):
    n, gap = 7, 72
    x0 = W / 2 - gap * (n - 1) / 2
    draw.line([(x0 * SS, y * SS), ((x0 + gap * (n - 1)) * SS, y * SS)], fill=(222, 218, 230), width=4 * SS)
    if current > 1:
        draw.line([(x0 * SS, y * SS), ((x0 + gap * (current - 1)) * SS, y * SS)], fill=GREEN, width=4 * SS)
    for i in range(1, n + 1):
        x = x0 + gap * (i - 1)
        if i < current:
            r, fill, outline, txt, tc, f = 17, GREEN, None, '✓', (255, 255, 255), F_DOT
        elif i == current:
            r, fill, outline, txt, tc, f = 23, ACCENT, None, str(i), (255, 255, 255), F_DOT_BIG
        else:
            r, fill, outline, txt, tc, f = 17, BG, (200, 196, 212), str(i), (150, 148, 160), F_DOT
        draw.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS], fill=fill,
                     outline=outline, width=3 * SS if outline else 0)
        bb = draw.textbbox((0, 0), txt, font=f)
        draw.text((x * SS - (bb[0] + bb[2]) / 2, y * SS - (bb[1] + bb[3]) / 2), txt, font=f, fill=tc)


def step_header(draw, label, title, sub):
    if isinstance(label, int):
        progress_dots(draw, label)
    else:
        text_center(draw, 46, label, F_LABEL, ACCENT)
    text_center(draw, 84, title, F_TITLE, INK)
    y = 176
    for line in wrap(draw, sub, F_SUB, 900):
        text_center(draw, y, line, F_SUB, MUTED)
        y += 46


def move_label(draw, m, y=800, counter=None):
    s = f'{ARROW.get(m, "")}  {WORDS[m]}' if not m.endswith('2') else f'{WORDS[m]}'
    text_center(draw, y, s, F_MOVE, INK)


def bottom_grid(draw, cube, x=62, y=330, cell=42):
    """Flat view of the bottom face, so children can see the white side being built."""
    lab = 'Bottom view'
    w = draw.textlength(lab, font=F_CHIP) / SS
    draw.text(((x + 1.5 * cell - w / 2) * SS, (y - 40) * SS), lab, font=F_CHIP, fill=MUTED)
    draw.rounded_rectangle([(x - 6) * SS, (y - 6) * SS, (x + 3 * cell + 4) * SS, (y + 3 * cell + 4) * SS],
                           radius=10 * SS, fill=BODY)
    for (pos, n), col in cube.facelets().items():
        if n != (0, -1, 0):
            continue
        cx = x + (pos[0] + 1) * cell
        cy = y + (1 - pos[2]) * cell
        draw.rounded_rectangle([(cx + 2) * SS, (cy + 2) * SS, (cx + cell - 4) * SS, (cy + cell - 4) * SS],
                               radius=6 * SS, fill=STICKER[col])


CUBE_CX, CUBE_CY, CUBE_SCALE = 540, 505, 94


def cube_project(p):
    return project(np.asarray(p, float), CUBE_CX * SS, CUBE_CY * SS, CUBE_SCALE * SS)


CUBE_CENTER = cube_project((0, 0, 0))
REST = (np.array([1260.0 * SS, 640.0 * SS]), np.array([-1.0, 0.0]), True)   # off-screen right
NOTE = 'Example cube. Yours may look different.'
_MASK = []


def hand_stage_mask():
    """Hands fade out before they reach the instruction text (top) and the move label (bottom)."""
    if not _MASK:
        col = np.zeros(H * SS, dtype=np.float32)
        y = np.arange(H * SS) / SS
        col = np.clip((y - 262) / 36, 0, 1) * np.clip((782 - y) / 36, 0, 1)
        m = np.repeat((col * 255).astype(np.uint8)[:, None], W * SS, axis=1)
        _MASK.append(Image.fromarray(m, 'L'))
    return _MASK[0]


def seg_caption(seg, idx, rep):
    moves = parse(seg['moves'])
    if 'captions' in seg:
        cap = seg['captions'][idx] if idx is not None and idx < len(moves) else ''
    else:
        cap = seg.get('caption', '')
    if seg.get('reps', 1) > 1 and rep is not None:
        cap = (cap + '   ' if cap else '') + f'Repeat  {rep + 1} of {seg["reps"]}'
    return cap


def render_scene(movie, cube, header, segments, hold_start=2.0, result=None, tip=None, note=None, bottom_view=False):
    """segments: list of dict(moves=str, reps=int, speed=sec per move, caption=str or captions=[...], pause=sec)."""
    import hands
    hands.AVOID = [(40, 280, 205, 485)] if bottom_view else []

    def frame(move=None, theta=0.0, seg=None, idx=None, rep=None, done=False, hand=None, show_note=False):
        img, d = base_frame()
        step_header(d, *header)
        draw_cube(d, cube, move, theta)
        if bottom_view:
            bottom_grid(d, cube)
        if hand is not None and hand[0][0] < (W + 200) * SS:
            ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
            draw_hand(ImageDraw.Draw(ov), hand[0], hand[1], hand[2], SS)
            ov.putalpha(ImageChops.multiply(ov.getchannel('A'), hand_stage_mask()))
            img.paste(ov, (0, 0), ov)
        if seg is not None:
            cap = seg_caption(seg, idx, rep)
            if cap:
                text_center(d, 772, cap, F_CHIP, ACCENT)
            if move:
                move_label(d, move, 800)
            elif show_note and note:
                text_center(d, 812, note, F_SUB, MUTED)
            chips_row(d, parse(seg['moves']), idx, 892)
        elif done:
            if result:
                text_center(d, 786, result, F_MID, GREEN)
            if tip:
                yy = 858
                for line in wrap(d, tip, F_SUB, 940):
                    text_center(d, yy, line, F_SUB, INK)
                    yy += 46
        footer(d)
        return finish(img)

    flat = []
    for si, seg in enumerate(segments):
        for rep in range(seg.get('reps', 1)):
            for i, m in enumerate(parse(seg['moves'])):
                flat.append((si, seg, rep, i, m))

    def path_for(m):
        return HandPath(cube, m, cube_project, CUBE_CENTER)

    def start_state(p):
        pos, v = p.at(0.0)
        return pos, v, p.flip()

    def glide(s0, s1, n, render_fn):
        for f in range(n):
            render_fn(lerp_state(s0, s1, (f + 1) / n))

    def seg_end_frame(seg, h):
        return frame(seg=seg, idx=len(parse(seg['moves'])), rep=seg.get('reps', 1) - 1, hand=h)

    first = segments[0]
    p_next = path_for(flat[0][4])
    n_hold = int(hold_start * FPS)
    n_glide = min(n_hold, 12)
    for f in range(n_hold - n_glide):
        movie.add(frame(seg=first, idx=None, rep=0, show_note=True))
    glide(REST, start_state(p_next), n_glide,
          lambda h: movie.add(frame(seg=first, idx=None, rep=0, hand=h, show_note=True)))

    for k, (si, seg, rep, i, m) in enumerate(flat):
        path = p_next
        flip = path.flip()
        dur = seg['speed'] * (1.45 if m.endswith('2') else 1.0)
        n = max(4, int(round(dur * FPS)))
        movie.mark('click')
        for f in range(n):
            th = ease((f + 1) / n)
            pos, v = path.at(th)
            movie.add(frame(m, th, seg, i, rep, hand=(pos, v, flip)))
        cube.apply(m)
        end_pos, end_v = path.at(1.0)
        s_end = (end_pos, end_v, flip)
        n_pause = max(1, int(seg.get('pause', 0.12) * FPS))
        last_in_seg = (k + 1 == len(flat)) or flat[k + 1][0] != si
        if k + 1 < len(flat):
            p_next = path_for(flat[k + 1][4])
            s_next = start_state(p_next)
            if np.linalg.norm(s_next[0] - s_end[0]) > 30 * SS:
                n_pause = max(n_pause, 3)
            if last_in_seg:
                movie.add(frame(None, 0, seg, i, rep, hand=s_end), n_pause)
                glide(s_end, s_next, int(0.3 * FPS), lambda h: movie.add(seg_end_frame(seg, h)))
            else:
                glide(s_end, s_next, n_pause, lambda h: movie.add(frame(None, 0, seg, i, rep, hand=h)))
        else:
            movie.add(frame(None, 0, seg, i, rep, hand=s_end), n_pause)
            glide(s_end, REST, int(0.3 * FPS), lambda h: movie.add(seg_end_frame(seg, h)))
    if result or tip:
        movie.mark('chime')
        movie.add(frame(done=True), int((3.4 if tip else 1.2) * FPS))


# ---------------------------------------------------------------- the tutorial
from stages import (TRICK, MID_RIGHT, MID_LEFT, YCROSS, MATCH, CORNERS_HOME, TWIST, STAGE, centers,
                    corner_home, scrambled_after)


def solution_of(segments):
    seq = []
    for s in segments:
        seq += parse(s['moves']) * s.get('reps', 1)
    return ' '.join(seq)


def setup_for(segments):
    return Cube().apply_seq(invert(solution_of(segments)))


STEPS = [
    dict(title='White cross',
         sub='Make a white flower around yellow. Turn the top until a petal matches the middle square below.',
         segs=[dict(moves="U'", speed=0.5, caption='Turn the top until the petals match'),
               dict(moves="F2 y F2 y F2 y F2", speed=0.42, caption='Front twice, then spin to the next petal')],
         result='✓  White plus on the bottom',
         tip='Tip: do one petal at a time. The flower takes a few tries, and that’s OK!',
         bottom=True),
    dict(title='White corners',
         sub='Put a white corner at the top front right, above the sides that match its colors.',
         segs=[dict(moves=TRICK, reps=3, speed=0.26, pause=0.04, caption='Magic trick until it drops in')],
         result='✓  Whole white side done',
         tip='Tip: do all 4 corners. Corner stuck at the bottom? One magic trick brings it up.',
         bottom=True),
    dict(title='Middle row',
         sub='Find a top edge with no yellow. Turn the top until its front color matches the middle square.',
         segs=[dict(moves=MID_RIGHT, speed=0.34, caption='Top color matches the RIGHT side? Do this'),
               dict(moves=MID_LEFT, speed=0.34, caption='Top color matches the LEFT side? Do this instead')],
         result='✓  Two rows done',
         tip='Tip: do all 4 edges. Edge stuck in the middle row? Do this once to pop it out.'),
    dict(title='Yellow cross',
         sub='Dot? Just do it. L shape? Point its arms back and left. Line? Make it go left to right.',
         segs=[dict(moves=YCROSS, speed=0.36, caption='Front right + magic trick + front left')],
         result='✓  Yellow plus on top',
         tip='Tip: no plus yet? Look again and repeat until you see one.'),
    dict(title='Match the cross',
         sub='Turn the top until 2 edges match the sides below. Hold those 2 at the back and right.',
         segs=[dict(moves=MATCH, speed=0.34, caption='Matching edges at the back and right')],
         result='✓  Plus matches the sides',
         tip='Tip: the 2 matching edges are opposite? Do it once, then look again.'),
    dict(title='Corners home',
         sub='A corner is home when its colors match the sides around it. Twisted is OK!',
         segs=[dict(moves=CORNERS_HOME, speed=0.34, caption='Hold a home corner at the top front right')],
         result='✓  All 4 corners home',
         tip='Tip: repeat until all 4 are home. None home? Do it once, then look again.'),
    dict(title='Twist the corners',
         sub='Hold a corner with yellow on its side at the top front right. Repeat until yellow is on top.',
         segs=[dict(moves=TWIST, reps=2, speed=0.2, pause=0.03, caption='Corner 1'),
               dict(moves='U', speed=0.34, caption='Turn ONLY the top to bring in the next corner'),
               dict(moves=TWIST, reps=4, speed=0.18, pause=0.02, caption='Corner 2'),
               dict(moves="U'", speed=0.34, caption='Turn the top to finish')],
         result='✓  Solved!',
         tip='Tip: halfway, the bottom looks broken. Keep going, it fixes itself!'),
]

LESSON = [('R', 'The right side turns. Front squares go UP.'),
          ("R'", 'Same side, other way. Front squares go DOWN.'),
          ('U', 'The top row slides. Front squares go LEFT.'),
          ("U'", 'Top row, other way. Front squares go RIGHT.'),
          ('F', 'Turn the front like a steering wheel.'),
          ("F'", 'Steering wheel, the other way.'),
          ('y', 'Spin the whole cube. Yellow stays on top.')]
LESSON_HEADER = ('BEFORE YOU START', 'Learn the moves',
                 'The words say where the FRONT squares go. Left and Bottom work the same way.')
TRICK_HEADER = ('BEFORE YOU START', 'The magic trick', 'Right up, top left, right down, top right. Say it out loud!')

ROADMAP = [('White cross', 'white plus on the bottom'), ('White corners', 'whole white side done'),
           ('Middle row', 'two rows done'), ('Yellow cross', 'yellow plus on top'),
           ('Match the cross', 'plus matches the sides'), ('Corners home', 'corners in the right spots'),
           ('Twist the corners', 'solved!')]
ROADMAP_SUB = 'Same cube the whole way. Each step keeps what you already fixed.'
GOLDEN = 'Golden rule: keep yellow on top the whole time'


def demo_cube(k, step):
    """Start cube for step k: earlier steps done, this step to do, later steps still messy."""
    return scrambled_after(k, seed=100 + k).apply_seq(invert(solution_of(step['segs'])))


def sanity():
    probe = Image.new('RGB', (W * SS, 100))
    pd = ImageDraw.Draw(probe)
    for k, st in enumerate(STEPS, start=1):
        c = demo_cube(k, st)
        assert STAGE[k - 1](c) and not STAGE[k](c), f'step {k} start state'
        end = c.copy().apply_seq(solution_of(st['segs']))
        assert STAGE[k](end), f'step {k} end state'
        cen = centers(c)
        if k == 2:
            want = {cen[(0, -1, 0)], cen[(0, 0, 1)], cen[(1, 0, 0)]}
            q = [x for x in c.cubies if {col for _, col in x.stickers} == want][0]
            assert tuple(q.pos) == (1, 1, 1), 'corner not at top front right'
        if k == 3:
            for alg, side in ((None, (1, 0, 0)), (MID_RIGHT, (-1, 0, 0))):
                if alg:
                    c2 = c.copy().apply_seq(alg)
                else:
                    c2 = c
                cc = centers(c2)
                st_ = {tuple(s): col for s, col in c2.piece_at((0, 1, 1)).stickers}
                assert st_[(0, 0, 1)] == cc[(0, 0, 1)] and st_[(0, 1, 0)] == cc[side], 'middle edge'
        if k == 4:
            f = c.facelets()
            up = {p for p in [(0, 1, 1), (0, 1, -1), (1, 1, 0), (-1, 1, 0)] if f[(p, (0, 1, 0))] == cen[(0, 1, 0)]}
            assert up in ({(-1, 1, 0), (1, 1, 0)}, {(0, 1, -1), (-1, 1, 0)}, set()), up
        if k == 5:
            f = c.facelets()
            m = {face for face, n in [('F', (0, 0, 1)), ('R', (1, 0, 0)), ('B', (0, 0, -1)), ('L', (-1, 0, 0))]
                 if f[((n[0], 1, n[2]), n)] == cen[n]}
            assert m == {'B', 'R'}, m
        if k == 6:
            assert corner_home(c, (1, 1, 1))
        if k == 7:
            assert c.facelets()[((1, 1, 1), (0, 1, 0))] != cen[(0, 1, 0)]
        # text must fit
        assert len(wrap(pd, st['sub'], F_SUB, 900)) <= 2, ('sub too long', st['title'])
        assert len(wrap(pd, st['tip'], F_SUB, 940)) <= 2, ('tip too long', st['title'])
        for sg in st['segs']:
            cap = seg_caption(sg, 0, 0)
            assert pd.textlength(cap, font=F_CHIP) / SS < 1000, ('caption too long', cap)
    for hdr in (LESSON_HEADER, TRICK_HEADER, ('', '', ROADMAP_SUB)):
        assert len(wrap(pd, hdr[2], F_SUB, 900)) <= 2, ('header sub too long', hdr)
    print('demo sanity: ok')


def intro(movie):
    scr = Cube().apply_seq("R U F' L2 D B' R2 U' F D2 L B2 U R' F2 D'")
    n = int(3.4 * FPS)
    movie.mark('intro')
    for f in range(n):
        img, d = base_frame(800)
        text_center(d, 70, 'FRIDAY MUSING', F_LABEL, ACCENT)
        text_center(d, 112, 'Solve a Rubik’s Cube', F_TITLE, INK)
        text_center(d, 204, 'There are many ways to solve a cube.', F_SUB, MUTED)
        text_center(d, 250, 'This is the simplest one.', F_SUB, INK)
        draw_cube(d, scr, yaw=2 * np.pi * f / n * 0.4, cy=560, scale=96)
        text_center(d, 868, '7 steps  ·  1 magic trick  ·  age 8 and up', F_SUB, ACCENT)
        footer(d)
        movie.add(finish(img))


def blend(c, a):
    return tuple(int(BG[i] + (c[i] - BG[i]) * a) for i in range(3))


def roadmap(movie):
    n = int(8.0 * FPS)
    top, gap, x_num = 322, 72, 150
    movie.mark('chime')
    for f in range(n):
        t = f / FPS
        img, d = base_frame(None)
        text_center(d, 46, 'THE PLAN', F_LABEL, ACCENT)
        text_center(d, 84, '7 steps, in order', F_TITLE, INK)
        yy = 176
        for line in wrap(d, ROADMAP_SUB, F_SUB, 900):
            text_center(d, yy, line, F_SUB, MUTED)
            yy += 46
        a_rail = min(1.0, max(0.0, (t - 0.2) / 0.4))
        d.line([(x_num * SS, top * SS), (x_num * SS, (top + gap * 6) * SS)], fill=blend((222, 218, 230), a_rail),
               width=4 * SS)
        for i, (name, goal) in enumerate(ROADMAP):
            a = min(1.0, max(0.0, (t - 0.35 - 0.3 * i) / 0.3))
            if a <= 0:
                continue
            y = top + gap * i
            r = 26
            d.ellipse([(x_num - r) * SS, (y - r) * SS, (x_num + r) * SS, (y + r) * SS], fill=blend(ACCENT, a))
            num = str(i + 1)
            bb = d.textbbox((0, 0), num, font=F_DOT_BIG)
            d.text((x_num * SS - (bb[0] + bb[2]) / 2, y * SS - (bb[1] + bb[3]) / 2), num, font=F_DOT_BIG,
                   fill=blend((255, 255, 255), a) if a > 0 else BG)
            bb = d.textbbox((0, 0), name, font=F_ROW)
            d.text(((x_num + 48) * SS, y * SS - (bb[1] + bb[3]) / 2), name, font=F_ROW, fill=blend(INK, a))
            gw = d.textlength(goal, font=F_ROW_SUB)
            bb = d.textbbox((0, 0), goal, font=F_ROW_SUB)
            d.text((944 * SS - gw, y * SS - (bb[1] + bb[3]) / 2), goal, font=F_ROW_SUB, fill=blend(MUTED, a))
        a_g = min(1.0, max(0.0, (t - 0.35 - 0.3 * 7) / 0.4))
        if a_g > 0:
            tw = d.textlength(GOLDEN, font=F_RULE) / SS
            pw, ph = tw + 64, 62
            px, py = (W - pw) / 2, 838
            pill(d, px, py, pw, ph, blend(CHIP, a_g))
            bb = d.textbbox((0, 0), GOLDEN, font=F_RULE)
            d.text(((px + 32) * SS, (py + ph / 2) * SS - (bb[1] + bb[3]) / 2), GOLDEN, font=F_RULE,
                   fill=blend(ACCENT, a_g))
        footer(d)
        movie.add(finish(img))


def moves_lesson(movie):
    c = Cube()
    render_scene(movie, c, LESSON_HEADER,
                 [dict(moves=' '.join(m for m, _ in LESSON), speed=0.55, pause=0.25,
                       captions=[cap for _, cap in LESSON])], hold_start=1.4)
    render_scene(movie, c, TRICK_HEADER, [dict(moves=TRICK, speed=0.5, caption='You will use this a lot')],
                 hold_start=1.4)


def outro(movie):
    c = Cube()
    n = int(3.0 * FPS)
    movie.mark('outro')
    for f in range(n):
        img, d = base_frame(800)
        text_center(d, 70, 'THAT’S IT', F_LABEL, ACCENT)
        text_center(d, 112, 'Solved.', F_TITLE, INK)
        text_center(d, 204, 'One method, layer by layer. It works every time.', F_SUB, MUTED)
        draw_cube(d, c, yaw=2 * np.pi * f / n * 0.4, cy=550, scale=100)
        text_center(d, 880, 'Which step stopped you last time?', F_MID, INK)
        footer(d)
        movie.add(finish(img))


def main(out='rubiks_7_steps.mp4', only=None):
    sanity()
    movie = Movie(out)
    if only is None:
        intro(movie)
        roadmap(movie)
        moves_lesson(movie)
    for k, st in enumerate(STEPS, start=1):
        if only is not None and k != only:
            continue
        cube = demo_cube(k, st)
        render_scene(movie, cube, (k, st['title'], st['sub']), st['segs'], result=st['result'], tip=st['tip'],
                     note=NOTE, bottom_view=st.get('bottom', False))
    if only is None:
        outro(movie)
    movie.close()
    import json
    json.dump({'events': movie.events, 'duration': movie.frames / FPS}, open(out + '.events.json', 'w'))
    print('frames', movie.frames, 'seconds', movie.frames / FPS)


if __name__ == '__main__':
    main()
