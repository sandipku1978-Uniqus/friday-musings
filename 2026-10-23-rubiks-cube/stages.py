"""Stage checks and realistic demo cubes: for step k the cube shows steps 1..k-1 done and
everything later still messy, so each step ends on exactly that step's goal."""
import random
from cube import Cube, invert, NORMALS

TRICK = "R U R' U'"
MID_RIGHT = "U R U' R' U' F' U F"
MID_LEFT = "U' L' U L U F U' F'"
YCROSS = "F R U R' U' F'"
MATCH = "R U R' U R U2 R' U"
CORNERS_HOME = "U R U' L' U R' U' L"
TWIST = "R' D' R D"
TWO_CORNER_TWIST = ' '.join([TWIST] * 2 + ['U'] + [TWIST] * 4 + ["U'"])

D_EDGES = [(0, -1, 1), (1, -1, 0), (0, -1, -1), (-1, -1, 0)]
D_CORNERS = [(x, -1, z) for x in (-1, 1) for z in (-1, 1)]
MID_EDGES = [(x, 0, z) for x in (-1, 1) for z in (-1, 1)]
U_EDGES = [(0, 1, 1), (1, 1, 0), (0, 1, -1), (-1, 1, 0)]
U_CORNERS = [(x, 1, z) for x in (-1, 1) for z in (-1, 1)]


def centers(c):
    f = c.facelets()
    return {n: f[(n, n)] for n in NORMALS.values()}


def piece_solved(c, pos, cen=None):
    cen = cen or centers(c)
    q = c.piece_at(pos)
    return all(cen[tuple(s)] == col for s, col in q.stickers)


def all_solved(c, positions):
    cen = centers(c)
    return all(piece_solved(c, p, cen) for p in positions)


def yellow_edges_up(c):
    f = c.facelets()
    top = centers(c)[(0, 1, 0)]
    return all(f[(p, (0, 1, 0))] == top for p in U_EDGES)


def corner_home(c, pos):
    cen = centers(c)
    need = {cen[(pos[0], 0, 0)], cen[(0, 0, pos[2])], cen[(0, 1, 0)]}
    return {col for _, col in c.piece_at(pos).stickers} == need


STAGE = {
    0: lambda c: True,
    1: lambda c: all_solved(c, D_EDGES),
    2: lambda c: all_solved(c, D_EDGES + D_CORNERS),
    3: lambda c: all_solved(c, D_EDGES + D_CORNERS + MID_EDGES),
    4: lambda c: STAGE[3](c) and yellow_edges_up(c),
    5: lambda c: STAGE[3](c) and all_solved(c, U_EDGES),
    6: lambda c: STAGE[5](c) and all(corner_home(c, p) for p in U_CORNERS),
    7: lambda c: c.is_solved(),
}
# pieces that belong to later steps, used to make sure the demo cube looks messy enough
LATER = {1: D_CORNERS + MID_EDGES, 2: MID_EDGES + U_EDGES, 3: U_EDGES + U_CORNERS,
         4: U_EDGES + U_CORNERS, 5: U_CORNERS, 6: U_CORNERS}

POOL = [TRICK, invert(TRICK), MID_RIGHT, MID_LEFT, invert(MID_RIGHT), invert(MID_LEFT),
        YCROSS, invert(YCROSS), MATCH, invert(MATCH), CORNERS_HOME, invert(CORNERS_HOME),
        TWO_CORNER_TWIST, "R U R'", "L' U' L", "F' U' F", "R U2 R'", "U", "U'", "U2", "F2", "R2"]


def scrambled_after(k, seed):
    """A cube where steps 1..k are done and later steps are still to do."""
    if k >= 7:
        return Cube()
    rnd = random.Random(seed)
    best = None
    for attempt in range(40):
        c = Cube()
        accepted = 0
        for _ in range(3000):
            alg = rnd.choice(POOL)
            spin = rnd.randrange(4)
            cand = ' '.join(['y'] * spin + [alg] + ["y'"] * spin)
            c2 = c.copy().apply_seq(cand)
            if STAGE[k](c2):
                c = c2
                accepted += 1
                if accepted >= 45:
                    break
        if STAGE[k + 1](c):
            continue
        cen = centers(c)
        score = sum(piece_solved(c, p, cen) for p in LATER[k])
        if k == 1:
            # after the white cross, the bottom view must show a plus, not white corners
            f = c.facelets()
            score += 3 * sum(f[(p, (0, -1, 0))] == cen[(0, -1, 0)] for p in D_CORNERS)
        if best is None or score < best[0]:
            best = (score, c)
        if score == 0:
            break
    return best[1]
