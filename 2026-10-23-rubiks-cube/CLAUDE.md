# Rubik's Cube tutorial video (Friday Musing)

A square, animated tutorial that teaches an 8-year-old to solve a Rubik's Cube with the
beginner layer-by-layer method, built for Sandip Khetan's "Friday Musings" LinkedIn series
(audience: CFOs and finance leaders, who may share it with their kids).

Latest render: `output/rubiks_cube_7_steps.mp4` (1080x1080, 24 fps, 1 min 42 s, with music).
`output/rubiks_cube_7_steps.gif` is the same video at 480 px with no sound.

## Commands

```bash
pip install -r requirements.txt        # plus ffmpeg on the PATH (macOS: brew install ffmpeg)
python verify.py                       # must end with "ALL PASS" (exit code 0)
python build.py --only 4               # quick end-to-end check: one step, about 20 s
python build.py                        # full video + GIF into output/, about 7 min of CPU
python preview.py 3                    # stills of step 3: pv_step3_start.png, pv_step3_end.png, pv_step3.png
python preview.py roadmap              # the plan card;  python preview.py lesson  for the moves lesson
python -c "import render; render.sanity()"   # fast check after any copy change
```

## How it is built

| File | Role |
|---|---|
| `cube.py` | Sticker-level cube simulator. x right, y up, z towards the viewer. Colors: top yellow, bottom white, front green, right orange, left red, back blue. Standard moves plus `y` (spin the whole cube, same way as U). `WORDS` holds the kid labels. `is_solved()` compares against the centers, so whole-cube spins are fine. |
| `stages.py` | The recipes (`TRICK`, `MID_RIGHT`, `MID_LEFT`, `YCROSS`, `MATCH`, `CORNERS_HOME`, `TWIST`), stage checks `STAGE[0..7]`, and `scrambled_after(k, seed)`, which builds a cube with steps 1..k done and everything later still messy. |
| `render.py` | Renderer and scenes: intro, plan card, "Learn the moves", "The magic trick", steps 1-7, outro. All on-screen copy lives in `STEPS`, `LESSON`, `ROADMAP` and the headers. Draws at 2x supersampling and pipes frames to ffmpeg; writes `<out>.events.json` so the soundtrack can click on every turn. |
| `hands.py` | Robot hands. `HandPath` pins the fingertip to a sticker on the turning layer, picking one whose hand footprint stays outside the cube and clear of text. `draw_hand` is pure vector drawing. |
| `music.py` | Original soundtrack synthesized from scratch (104 BPM, C-G-Am-F, plucks, bass, light drums, bell melody), a click per turn and a chime per finished step. No samples or third-party audio, so it is licence-clean. |
| `verify.py` | Proves every recipe and every "turn the top until..." rule on 400 random cubes. |
| `build.py` | verify, render, soundtrack, mux, GIF. |
| `preview.py` | Renders stills of one scene without encoding a video. |
| `fonts/` | Inter and Inter Display (SIL OFL 1.1, see `LICENSE-Inter.txt`), bundled so renders match on any machine. |
| `content/linkedin_post.md` | The post text that goes with the video and links to the page. |
| `index.html` | The interactive musing, served by Vercel at `/2026-10-23-rubiks-cube/`. Static, no build step. |
| `js/cube.js` | Browser twin of `cube.py` (same axes, colors, move words) plus a solver that runs the video's 7 steps on any scramble. Recipes must equal `stages.py`. |
| `js/view.js` | Canvas renderer (no libraries): 26 cubies, painter's order, animated layer turns, drag to turn. |
| `js/steps.js` | Page copy per step: kid view (the video's words) and CFO view, plus the close self-check lines. |
| `js/app.js` | Page wiring: workbench, the close tracker (one workstream per step, 4 tasks that tick as the step plays, signed-off workstreams that flip to re-testing while a recipe disturbs their pieces) with the "finished work intact" count, the intermission, "Your turn" (the reader taps the magic trick at the first corner of step 2), the close certificate, the self-check. |
| `js/poll.js`, `js/peer.js` | "Peer review": the three questions (`POLL`, shared with `/api/poll`, so the server only counts answers that exist), whole-number shares that add up to 100 (`shares`), and the page UI (one question at a time, the room's bars grow out of the same rows, a you-and-the-room summary). |
| `js/cert.js` | The close certificate: `certFacts` (the wording, pure and unit-tested) and `drawCert` (a 1080x1350 canvas in the working-paper style, sized for a LinkedIn feed image). `PAGE_URL` must equal the page's `og:url`. |
| `js/sound.js` | The page soundtrack: the video's theme (`music.py` chords, arpeggio, bell tune) rearranged at 124 BPM (four-on-the-floor kick with a click transient, off-beat sawtooth bass and open hats, chord stabs, fills, a crash every 8 bars), synthesized live with Web Audio. Calibrated to -16 LUFS (`LEVEL`), peaks at -3.5 dBFS. Cube turns land on its eighth-note grid (`gridSlot`), turn clicks are scheduled on the audio clock, and a low-pass filter (`tensionCutoff`) muffles the mix while finished work is out of place. The intermission switches to a breakdown section. Starts only after a tap; sets `navigator.audioSession.type = "playback"` so the iPhone silent switch does not mute it. |
| `poster.jpg`, `og.png` | Video poster (frame at 2 s) and the 1200x630 LinkedIn preview card. |

How each step's demo cube is made: `demo_cube(k)` takes `scrambled_after(k, seed=100 + k)` (the step's goal state)
and applies the inverse of that step's moves. So the step starts with only the earlier steps done and ends exactly
on its own goal. Changing a step's moves changes its demo cube automatically.

## The interactive page

- Run it: from the repo root, `npm run dev`, then open `http://localhost:3000/2026-10-23-rubiks-cube/`.
- Test it: `npm test` (root) runs `tests/rubiks.test.js`: recipes match `stages.py`, direction words match
  `verify.py`, the solver solves 400 random cubes with every step ending on its own goal and handing finished work
  back, the example cube needs all 7 steps, the 3,502 fact (breadth-first search), and the house-style copy rules
  (no "~", "about", "nearly", "today", "cheap", British spellings; LinkedIn post under 3,000 characters).
- Layout is a working paper (columnar pad, W/P ref, sign-off boxes, red-pencil tickmarks), deliberately unlike
  who-picks-up. Mobile first: one column under 900 px.
- The solver never uses back-face moves and only spins with `y`, like the video. The intermission ("Are you
  watching closely?") sits between steps 3 and 4.
- The video loads only when tapped (`preload="none"`); it is 12.6 MB.
- Autoplay is the default (step by step is one tap away, and the default under prefers-reduced-motion): it starts
  when the cube is well in view, runs every step and the intermission with reading pauses, and waits while the cube
  is fully off screen. On phones the cube is pinned (sticky) at the top of the workbench so it stays visible while
  the tracker and buttons scroll. Sound starts on the first tap anywhere (browsers block audio before a gesture).
- "Your turn": at the first drop-in corner of step 2 (solver segment kind `trick`; stuck-corner lifts are `lift`), a
  pad of four buttons asks the reader to run the magic trick. Order is enforced, taps land on the beat, and repeating
  it until the corner is home takes exactly the solver's tricks, so the step carries on from the same state.
  Autoplay waits 8 s for a first tap (then plays the corner itself) and 12 s between taps (then finishes the trick).
  Offered once per page load.
- The close certificate appears when the cube is solved: an image drawn on a canvas (`js/cert.js`), with the reader's
  initials (letters only, 3 max, kept in localStorage), Share (Web Share, with the image where the browser allows
  files), Post on LinkedIn (share-offsite URL) and Download.
- "Peer review" (after the review notes): three questions, one tap each, results per question open at 20 answers.
  It needs the shared store (Vercel KV / Upstash: `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*`
  pair). Without it `/api/poll` answers `{enabled: false}` and the section stays hidden. Only counts are stored (one
  Redis hash per question, `fm:poll:rc1:<question>`); answers are validated against `js/poll.js`, and each network
  gets `POLL_VOTES_PER_HOUR` (default 30). The browser remembers its own answers so a reader is asked once.
  `tests/poll.test.js` runs the API against an in-memory stand-in for Upstash.

## Rules the video follows (keep these)

- **One method, seven steps, in order.** The plan card says "7 steps, in order. Same cube the whole way". Every step
  has 1-7 progress dots and the note "Example cube. Yours may look different." This answers the early feedback that
  the video looked like several different ways to solve the cube.
- **Golden rule: yellow stays on top the whole solve.** The method never needs the cube flipped; only `y` spins.
- **Direction words say where the FRONT squares go:** R = Right UP, R' = Right DOWN, L' = Left UP, L = Left DOWN,
  U = Top LEFT, U' = Top RIGHT, D = Bottom RIGHT, D' = Bottom LEFT, F = Front RIGHT ("like a steering wheel"),
  y = Spin cube LEFT.
- **No moves on the back face** (a child cannot see it). Step 1 uses "Front twice, then spin to the next petal".
- **Language an 8-year-old can follow:** "middle square" (not center), edge = 2 colors, corner = 3 colors,
  "home" = its colors match the sides around it, "twisted" = yellow facing sideways.
- **Every step ends on its goal** with a green result line and a plain-words tip. Steps 1 to 3 must say to do it
  for all 4 pieces. Steps 4 to 6 cover the cases children actually hit: dot, L or line; opposite matches; no corner home.
- **Steps 1 and 2 show a "Bottom view"** because the white side is underneath.
- **Text must fit:** subtitles and tips at most 2 lines (`render.sanity()` asserts this). Hands fade out near the
  header and the move label so they never cover text.
- **Style:** US spelling ("color"); state figures exactly, never with "~" or "about"; no dated hooks such as
  "today" or "this morning" in post copy. Footer reads "#FridayMusings · Sandip Khetan".

## Verified facts (safe to quote)

- A cube has 43,252,003,274,489,856,000 positions.
- 3,502 positions can be solved in 3 moves or fewer (checked by breadth-first search with this simulator,
  half-turn metric: 1 + 18 + 243 + 3,240). TV "three-move solves" are cubes scrambled with three turns.
- Every position can be solved in 20 moves or fewer ("God's number").

## Status and open items

1. Video v4 is rendered. The soundtrack mix has not been listened to by a person yet, so check levels and that the
   per-turn click is not too loud (`sfx()` in `music.py`, `click() * 0.30`).
   The page soundtrack (`js/sound.js`) was measured from offline renders (BS.1770 loudness, a 300 Hz phone-speaker
   high-pass, spectral flux): the first page version played at -21.9 LUFS and lost 8.1 dB on a phone; the 124 BPM
   rearrangement plays at -15.9 LUFS, loses 4.3 dB on a phone, and has twice the beat density (8.2 vs 4.1 onsets/s).
   A person still needs to listen on a phone.
2. `content/linkedin_post.md` is rewritten for the interactive page (corporate hook first, the video as the gift).
3. Possible next piece: a shorter cut for adults. The staged-demo idea now lives in the page's intermission.
4. Known limitation: building the white flower (step 1) is learned by trying; the video shows the flower already
   made and says that it takes a few tries.

## Gotchas

- A full render takes several minutes; use `--only N` and `preview.py` while iterating.
- `scrambled_after` uses fixed seeds, so renders are reproducible. For step 1 it also rejects cubes with white
  corners facing down, so the bottom view shows a clean white plus.
- If you add a scene with text near the cube, add its rectangle to `hands.AVOID` (unscaled px) so the hand keeps clear.
