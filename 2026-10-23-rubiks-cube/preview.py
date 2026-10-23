import sys
import render as R
from PIL import Image

class Grab:
    def __init__(self, every):
        self.frames, self.events, self.keep, self.every = 0, [], [], every
    def mark(self, k): pass
    def add(self, img, n=1):
        for _ in range(n):
            if self.frames % self.every == 0:
                self.keep.append(img.copy())
            self.frames += 1
        self.last = img

def sheet(imgs, cols, name, w=360):
    rows = (len(imgs) + cols - 1) // cols
    s = Image.new('RGB', (cols * w, rows * w), 'white')
    for i, im in enumerate(imgs):
        s.paste(im.resize((w, w)), ((i % cols) * w, (i // cols) * w))
    s.save(name)

which = sys.argv[1]
g = Grab(int(sys.argv[2]) if len(sys.argv) > 2 else 24)
if which == 'roadmap':
    R.roadmap(g); imgs = [g.keep[-1]]
    g.keep[-1].save('pv_roadmap.png')
elif which == 'lesson':
    R.moves_lesson(g); sheet(g.keep, 6, 'pv_lesson.png')
else:
    k = int(which)
    st = R.STEPS[k - 1]
    cube = R.demo_cube(k, st)
    R.render_scene(g, cube, (k, st['title'], st['sub']), st['segs'], result=st['result'], tip=st['tip'],
                   note=R.NOTE, bottom_view=st.get('bottom', False))
    g.keep[0].save(f'pv_step{k}_start.png')
    g.last.save(f'pv_step{k}_end.png')
    sheet(g.keep, 6, f'pv_step{k}.png')
print(which, 'frames', g.frames, 'seconds', round(g.frames / R.FPS, 1))
