---
name: catscapades-model-viewer
description: Inspect, measure, animate, and screenshot Catscapades models in isolation, and photograph the running level. Use when changing the cat rig or its animation, adding or editing any furniture/prop/scenery model, debugging proportions, pivots, scale, silhouettes, materials, or triangle budgets, checking that an animation clip actually drives its joints, or verifying that a traversal, camera composition, or lighting change reads correctly in the real game.
---

# Catscapades Model Viewer

Two questions need different tools, and answering only one of them is the usual
mistake:

- **"Is this model built correctly?"** — size, pivot, hierarchy, joint names,
  triangle count, whether a clip moves anything. Answer it with the headless
  inspector. It needs no GPU and gives you numbers you can assert on.
- **"Does it look right?"** — silhouette, proportion, readability, material
  response, whether the cat reads as a cat. Answer it with screenshots. Numbers
  cannot tell you a tail looks like a rope.

Never claim a model is good from the inspector alone, and never debug a pivot
from a screenshot.

## Registry first

Every reviewable model lives in `src/models/registry.ts`. A model that is not
registered cannot be inspected, viewed, or screenshotted, so **register new
models as part of adding them**, with an honest `category` and `mount`:

- `category`: `character` | `furniture` | `prop` | `scenery` — sets the triangle
  budget (6500 for characters, 1600 otherwise).
- `mount`: `floor` (default) | `wall` | `surface` | `free` — only `floor`
  models are required to sit on their own origin.

Models with motion expose a `driver` with named clips. Add a clip whenever you
add a distinct animation state; an unclipped state cannot be reviewed.

## Headless inspection

```bash
npm run models                      # list every registered model
npm run models -- cat               # full report for one model
npm run models -- cat --clips       # report plus per-clip motion analysis
npm run models -- --all             # audit everything; exits 1 on warnings
npm run models -- cat --json        # machine-readable
```

The report gives bounds and size, ground offset, mesh/triangle/vertex counts,
unique materials, the full named-node tree, and warnings. `--clips` additionally
steps each clip at a fixed rate and reports which named joints moved, the motion
envelope, and the largest single-frame jump.

Treat these as blockers:

- a floor-mounted model whose lowest point is not 0 (it will hover or sink);
- a triangle count over budget;
- a clip that moved **no** named joint — it is wired to nothing;
- a peak per-frame delta above ~0.35 — a pop or an unstable IK solve;
- a named joint that should move in a clip and did not.

`--all` is the audit gate. Run it before finishing any model work.

## Visual review

```bash
npm run models:capture                          # hero shot of every model
npm run models:capture -- cat                   # hero, front, side, top
npm run models:capture -- cat --clips           # every clip, sampled
npm run models:capture -- cat --views side --time 0.4
npm run models:capture -- --out .model-captures --clean
```

Screenshots land in `.model-captures/` (gitignored). Then **read the images** —
capturing without looking is not review.

Animation is stepped by fixed increments, never wall time, so the same model,
clip, and `--time` produce the same frame on every run. That makes before/after
comparison meaningful.

For interactive review, run `npm run dev` and open `/viewer.html`. Drag to
orbit, scroll to zoom, and toggle grid, bounds box, joint axes, wireframe, dark
background, and pause. The grid is 0.25 units minor and 1 unit major, so scale
errors are visible immediately. URL parameters mirror every option
(`?model=cat&clip=trot&view=side&ui=0`), and the same deterministic API the
capture script drives is on `window.catscapadesViewer`.

## In-game verification

A model can be perfect in the studio and wrong in the level — too small for its
camera, the wrong value against its floor, unreadable in the room's lighting.

```bash
node scripts/capture-game.mjs --name kitchen
node scripts/capture-game.mjs --at 5.3,-5.0 --drive "w:0.6,jump:0.3,idle:0.5"
node scripts/capture-game.mjs --walk "w+d:4,w:2" --debug
```

- `--at x,z` drops the cat anywhere in the level (development builds only), so
  you can photograph a room or a ledge without scripting the walk to reach it.
- `--drive` advances the simulation in fixed steps and prints position, grounded
  state, and the offered jump target after each step. **Prefer it to `--walk`.**
  Headless Chromium renders through SwiftShader at single-digit frame rates, so
  real key presses run the game in slow motion and timings mean nothing.
- `--walk` uses real key events. Use it only to check that input plumbing works.
- Step syntax for both: `key:seconds`, comma separated, chorded with `+`.
  Keys: `w a s d shift ctrl jump act meow idle`.
- `--debug` opens the diagnostics overlay and Rapier's collider wireframes.

## Scale reference

1 world unit is ~0.67 m. Getting this wrong is the most common and most
expensive model error, so check new models against these:

| Thing | Height |
| --- | --- |
| Cat, at the shoulder | 0.32 |
| Cat, nose to tail tip | ~1.2 |
| Cardboard box rim | 0.62 |
| Chair seat | 0.68 |
| Garden planter | 0.82 |
| Dining table top | 1.15 |
| Sideboard / washing machine | 1.12 / 1.28 |
| Kitchen worktop | 1.35 |
| Wall shelf | 2.02 |
| Homeowner, standing | ~2.4 |
| Wall | 3.2 |

Surface heights are exported from `src/models/furniture.ts` as
`SURFACE_HEIGHTS`. Use it rather than retyping a number; jump targets in
`src/level/level-data.ts` depend on them agreeing.

## Working on the cat

The cat rig is the one model where structure matters more than geometry. Read
[references/rig-contract.md](references/rig-contract.md) before changing it —
`CatAnimator`, `solveLeg`, and the level's carry socket all depend on the joint
names and the leg segment lengths.

Rules of thumb that have already cost time:

- Change proportions in `LEG_SPECS` and `STAND_HEIGHT`, not by scaling meshes.
  The IK solves against segment lengths; a scaled mesh desynchronises them.
- Legs are solved to the **ankle**, then the metapodial is oriented separately.
  That is what makes the cat digitigrade. Do not "fix" it into a human ankle.
- After any proportion change, re-run `npm run models -- cat --clips` and
  capture `side` — a leg that no longer reaches its target silently clamps and
  the cat stands stiff-legged rather than visibly breaking.
- The tail is a verlet chain in world space. If it whips after a teleport, call
  `CatAnimator.resetSecondaryMotion()`; do not stiffen the chain.

## Reporting

Report these separately and do not blur them:

1. inspector results (numbers, warnings, pass/fail);
2. what the screenshots actually show;
3. in-game verification, including the room and camera used;
4. what still needs a human eye.

Automated checks prove a model is *built* correctly. They never prove it looks
good.
