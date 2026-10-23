"""Verify every recipe and every 'rule of thumb' in the tutorial on simulated cubes."""
import random
import numpy as np
from cube import Cube, invert, NORMALS, FACE_COLOR, NORMAL_TO_FACE

TRICK = "R U R' U'"
MID_RIGHT = "U R U' R' U' F' U F"
MID_LEFT = "U' L' U L U F U' F'"
YCROSS = "F R U R' U' F'"
MATCH = "R U R' U R U2 R' U"
CORNERS_HOME = "U R U' L' U R' U' L"
TWIST = "R' D' R D"

ok = True
def check(cond, msg):
    global ok
    print(('PASS ' if cond else 'FAIL ') + msg)
    ok &= bool(cond)

# --- 1. Direction words -------------------------------------------------
def sticker_move(move, pos, normal):
    c = Cube()
    q = c.piece_at(pos)
    idx = [tuple(s) for s, _ in q.stickers].index(normal)
    c.apply(move)
    return tuple(q.pos), tuple(q.stickers[idx][0])

check(sticker_move('R', (1, 0, 1), (0, 0, 1)) == ((1, 1, 0), (0, 1, 0)), 'R = Right UP (front sticker goes to top)')
check(sticker_move('U', (0, 1, 1), (0, 0, 1)) == ((-1, 1, 0), (-1, 0, 0)), 'U = Top LEFT (front sticker goes left)')
check(sticker_move('F', (0, 1, 1), (0, 0, 1))[0] == (1, 0, 1), 'F = Front RIGHT (clockwise steering wheel)')
check(sticker_move('D', (0, -1, 1), (0, 0, 1)) == ((1, -1, 0), (1, 0, 0)), 'D = Bottom RIGHT')
check(sticker_move("L'", (-1, 0, 1), (0, 0, 1)) == ((-1, 1, 0), (0, 1, 0)), "L' = Left UP")

# --- helpers ------------------------------------------------------------
def center_color(c, face):
    return c.facelets()[(NORMALS[face], NORMALS[face])]

def bottom_two_layers_solved(c):
    for q in c.cubies:
        if q.pos[1] == 1:
            continue
        for s, col in q.stickers:
            if FACE_COLOR[NORMAL_TO_FACE[tuple(s)]] != col:
                return False
    return True

def yellow_edges_up(c):
    f = c.facelets()
    return {p for p in [(0, 1, 1), (0, 1, -1), (1, 1, 0), (-1, 1, 0)] if f[(p, (0, 1, 0))] == 'Y'}

# --- 2. White corners: repeat trick -------------------------------------
for k in range(1, 6):
    c = Cube().apply_seq(invert(TRICK * 1 if False else ' '.join([TRICK] * k)))
    q = [x for x in c.cubies if x.home == (1, -1, 1)][0]
    reps = 0
    while not c.is_solved() and reps < 6:
        c.apply_seq(TRICK); reps += 1
    check(c.is_solved() and reps == k, f'White corner setup x{k}: corner at {tuple(q.pos)} solved in {reps} tricks')

# --- 3. Middle row ------------------------------------------------------
c = Cube().apply_seq(invert(MID_RIGHT))
q = c.piece_at((0, 1, 1))
cols = {tuple(s): col for s, col in q.stickers}
check(q.home == (1, 0, 1) and cols[(0, 0, 1)] == 'G' and cols[(0, 1, 0)] == 'O'
      and all(x.pos[1] != -1 or True for x in c.cubies), 'Middle-right: edge on top, front matches green, top = right colour')
c = Cube().apply_seq(invert(MID_LEFT))
q = c.piece_at((0, 1, 1))
cols = {tuple(s): col for s, col in q.stickers}
check(q.home == (-1, 0, 1) and cols[(0, 0, 1)] == 'G' and cols[(0, 1, 0)] == 'R', 'Middle-left: edge on top, front matches, top = left colour')
for alg in (MID_RIGHT, MID_LEFT):
    c = Cube().apply_seq(invert(alg))
    d_ok = all(col == 'W' for (p, s), col in c.facelets().items() if s == (0, -1, 0))
    check(d_ok, 'Middle-row setup leaves white face intact')

# --- random last-layer states ------------------------------------------
LL_GENS = [YCROSS, MATCH, CORNERS_HOME, 'U', "U'", "R U2 R' U' R U' R'", "F U R U' R' F'"]
def random_ll_state(seed):
    random.seed(seed)
    c = Cube()
    for _ in range(25):
        c.apply_seq(random.choice(LL_GENS))
    assert bottom_two_layers_solved(c)
    return c

def solve_last_layer(c, log):
    # Step 4: yellow cross
    for it in range(4):
        up = yellow_edges_up(c)
        if len(up) == 4:
            break
        if len(up) == 2:
            for _ in range(4):
                up = yellow_edges_up(c)
                if up == {(-1, 1, 0), (1, 1, 0)} or up == {(0, 1, -1), (-1, 1, 0)}:
                    break
                c.apply('U')
            else:
                return False
        c.apply_seq(YCROSS)
    else:
        return False
    log['cross_iters'] = max(log.get('cross_iters', 0), it)
    # Step 5: match the cross edges (turn top, then hold matched at back + right)
    def matched():
        f = c.facelets()
        res = []
        for face in 'FRBL':
            n = NORMALS[face]
            pos = (n[0], 1, n[2])
            if f[(pos, n)] == center_color(c, face):
                res.append(face)
        return res
    for it in range(4):
        best = None
        for u in range(4):
            if len(matched()) == 4:
                best = 'done'; break
            if len(matched()) >= 2:
                best = matched(); break
            c.apply('U')
        if best == 'done':
            break
        if best is None:
            return False
        if set(best) in ({'F', 'B'}, {'L', 'R'}):
            c.apply_seq(MATCH)  # opposite: do once, look again
            continue
        # rotate whole cube until matched pair are at back and right
        for y in range(4):
            if set(matched()) == {'B', 'R'}:
                break
            c.rotate_whole((0, 1, 0), 1)
        c.apply_seq(MATCH)
    else:
        return False
    if len(matched()) != 4:
        # final top alignment
        for _ in range(4):
            if len(matched()) == 4:
                break
            c.apply('U')
    if len(matched()) != 4 or len(yellow_edges_up(c)) != 4:
        return False
    # Step 6: corners home
    def corner_home(pos):
        q = c.piece_at(pos)
        need = {center_color(c, NORMAL_TO_FACE[(pos[0], 0, 0)]), center_color(c, NORMAL_TO_FACE[(0, 0, pos[2])]), 'Y'}
        return {col for _, col in q.stickers} == need
    corners = [(1, 1, 1), (-1, 1, 1), (-1, 1, -1), (1, 1, -1)]
    for it in range(4):
        homes = [p for p in corners if corner_home(p)]
        if len(homes) == 4:
            break
        if homes:
            for y in range(4):
                if corner_home((1, 1, 1)):
                    break
                c.rotate_whole((0, 1, 0), 1)
        c.apply_seq(CORNERS_HOME)
    else:
        return False
    log['corner_iters'] = max(log.get('corner_iters', 0), it)
    # Step 7: twist corners, yellow on top, corner at front-right top
    for corner in range(4):
        reps = 0
        while c.facelets()[((1, 1, 1), (0, 1, 0))] != 'Y':
            c.apply_seq(TWIST); reps += 1
            if reps > 6:
                return False
        c.apply('U')
    for _ in range(4):
        if c.is_solved():
            break
        c.apply('U')
    return c.is_solved()

log = {}
results = [solve_last_layer(random_ll_state(s), log) for s in range(400)]
check(all(results), f'Steps 4 to 7 solve 400 random last-layer states ({sum(results)}/400); max extra loops {log}')

# Step 5 does not disturb the yellow cross or the bottom two layers
c = Cube().apply_seq(MATCH)
check(bottom_two_layers_solved(c) and len(yellow_edges_up(c)) == 4, 'Match-the-cross keeps the bottom two layers and yellow cross')
# Step 6 keeps front-right-top corner fixed
c = Cube().apply_seq(CORNERS_HOME)
q = c.piece_at((1, 1, 1))
check(q.home == (1, 1, 1) and bottom_two_layers_solved(c), 'Corners-home keeps the front-right-top corner and bottom layers')
# Step 7: six tricks restore everything
check(Cube().apply_seq(' '.join([TWIST] * 6)).is_solved(), 'Twist recipe x6 = back to start')
print('\nALL PASS' if ok else '\nSOME FAILED')
import sys
sys.exit(0 if ok else 1)
