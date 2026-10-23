"""One command to rebuild the video.

    python build.py            # verify, render, soundtrack, MP4 with sound, GIF  (full video, about 7 min)
    python build.py --only 4   # quick check: just step 4, no GIF (about 20 s)

Outputs go to output/. Needs Python 3.10+, numpy, pillow, scipy and ffmpeg on the PATH.
"""
import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=HERE)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', type=int, choices=range(1, 8), help='render a single step (1-7) for a quick check')
    ap.add_argument('--no-gif', action='store_true', help='skip the GIF')
    args = ap.parse_args()

    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required (macOS: brew install ffmpeg)')
    os.makedirs(os.path.join(HERE, 'output'), exist_ok=True)

    # 1. every recipe and rule must still solve the cube
    run([sys.executable, 'verify.py'])

    # 2. render frames (render.sanity() runs first and checks demo cubes and text fit)
    sys.path.insert(0, HERE)
    import render
    name = 'rubiks_cube_7_steps' if args.only is None else f'step{args.only}_only'
    silent = os.path.join('output', f'{name}_silent.mp4')
    wav = os.path.join('output', f'{name}.wav')
    final = os.path.join('output', f'{name}.mp4')
    os.chdir(HERE)
    render.main(silent, only=args.only)

    # 3. original soundtrack, timed to the turns, then mux
    run([sys.executable, 'music.py', silent + '.events.json', wav])
    run(['ffmpeg', '-loglevel', 'error', '-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac',
         '-b:a', '192k', '-shortest', '-movflags', '+faststart', final])

    # 4. GIF (no sound) for places that do not play video
    if args.only is None and not args.no_gif:
        gif = os.path.join('output', f'{name}.gif')
        run(['ffmpeg', '-loglevel', 'error', '-y', '-i', final, '-vf',
             'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];'
             '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', gif])

    for f in (silent, wav, silent + '.events.json'):
        if os.path.exists(f):
            os.remove(f)
    print('done:', final)


if __name__ == '__main__':
    main()
