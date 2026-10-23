"""Rubik's cube model: sticker-level simulator used for verification and rendering."""
import numpy as np

# Faces: outward normal for each face letter
NORMALS = {
    'R': (1, 0, 0), 'L': (-1, 0, 0),
    'U': (0, 1, 0), 'D': (0, -1, 0),
    'F': (0, 0, 1), 'B': (0, 0, -1),
}
# Colour scheme: yellow top, white bottom, green front
FACE_COLOR = {'U': 'Y', 'D': 'W', 'F': 'G', 'B': 'B', 'R': 'O', 'L': 'R'}
NORMAL_TO_FACE = {v: k for k, v in NORMALS.items()}


def rot_matrix(axis, angle):
    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)
    x, y, z = axis
    c, s = np.cos(angle), np.sin(angle)
    C = 1 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


class Cubie:
    def __init__(self, pos, stickers):
        self.pos = np.array(pos, dtype=int)
        self.home = tuple(pos)
        # stickers: list of (normal np.array int, colour)
        self.stickers = [(np.array(n, dtype=int), c) for n, c in stickers]


class Cube:
    def __init__(self):
        self.cubies = []
        for x in (-1, 0, 1):
            for y in (-1, 0, 1):
                for z in (-1, 0, 1):
                    if (x, y, z) == (0, 0, 0):
                        continue
                    st = []
                    for f, n in NORMALS.items():
                        if np.dot(n, (x, y, z)) == 1:
                            st.append((n, FACE_COLOR[f]))
                    self.cubies.append(Cubie((x, y, z), st))

    def copy(self):
        c = Cube.__new__(Cube)
        c.cubies = []
        for q in self.cubies:
            n = Cubie.__new__(Cubie)
            n.pos = q.pos.copy()
            n.home = q.home
            n.stickers = [(s.copy(), col) for s, col in q.stickers]
            c.cubies.append(n)
        return c

    @staticmethod
    def move_spec(move):
        """Return (axis normal, layer selector value, quarter turns clockwise)."""
        face = move[0]
        turns = 1
        if move.endswith("'"):
            turns = -1
        elif move.endswith('2'):
            turns = 2
        if face == 'y':  # whole-cube spin, same direction as U
            return np.array((0, 1, 0)), turns
        return np.array(NORMALS[face]), turns

    def layer(self, move):
        if move[0] == 'y':
            return list(self.cubies)
        n, _ = self.move_spec(move)
        return [q for q in self.cubies if np.dot(q.pos, n) == 1]

    def apply(self, move):
        n, turns = self.move_spec(move)
        R = np.rint(rot_matrix(n, -np.pi / 2 * turns)).astype(int)
        for q in self.layer(move):
            q.pos = R @ q.pos
            q.stickers = [(R @ s, c) for s, c in q.stickers]
        return self

    def apply_seq(self, seq):
        for m in parse(seq):
            self.apply(m)
        return self

    def rotate_whole(self, axis, quarter):
        R = np.rint(rot_matrix(axis, -np.pi / 2 * quarter)).astype(int)
        for q in self.cubies:
            q.pos = R @ q.pos
            q.stickers = [(R @ s, c) for s, c in q.stickers]
        return self

    # --- state queries -------------------------------------------------
    def facelets(self):
        """dict (pos tuple, normal tuple) -> colour"""
        d = {}
        for q in self.cubies:
            for s, c in q.stickers:
                d[(tuple(q.pos), tuple(s))] = c
        return d

    def is_solved(self):
        f = self.facelets()
        centers = {n: f[(n, n)] for n in NORMALS.values()}
        for (p, s), c in f.items():
            if centers[s] != c:
                return False
        return True

    def face_colors(self, face):
        n = NORMALS[face]
        return [c for (p, s), c in self.facelets().items() if s == n]

    def piece_at(self, pos):
        for q in self.cubies:
            if tuple(q.pos) == tuple(pos):
                return q
        return None


def parse(seq):
    return seq.split() if isinstance(seq, str) else list(seq)


def invert(seq):
    out = []
    for m in reversed(parse(seq)):
        if m.endswith("'"):
            out.append(m[0])
        elif m.endswith('2'):
            out.append(m)
        else:
            out.append(m + "'")
    return ' '.join(out)


WORDS = {
    'R': 'Right UP', "R'": 'Right DOWN', 'R2': 'Right twice',
    "L'": 'Left UP', 'L': 'Left DOWN', 'L2': 'Left twice',
    'U': 'Top LEFT', "U'": 'Top RIGHT', 'U2': 'Top twice',
    'F': 'Front RIGHT', "F'": 'Front LEFT', 'F2': 'Front twice',
    'D': 'Bottom RIGHT', "D'": 'Bottom LEFT', 'D2': 'Bottom twice',
    'B2': 'Back twice',
    'y': 'Spin cube LEFT', "y'": 'Spin cube RIGHT',
}
