# Catscapades — A Perfectly Quiet Morning

A desktop browser stealth-comedy MVP about an extremely innocent cat. Observe a morning routine, create distractions, steal and carry evidence, prepare a domestic catastrophe, and make it back to the garden box before the homeowner catches you.

## Included

- A fully rigged tabby cat with a curved skinned torso, a short muzzle and recessed almond eyes, cupped ears, tapered digitigrade limbs with buried shoulder/hip joins, padded paws, and a continuous tail; expressive pupils and eyelids, four blended gaits, gaze stabilisation, and authored pose states
- Grounded locomotion: paws take a spot on the floor and hold it while the body travels over them, the stride clock runs on ground actually covered after collision (so pushing into furniture stops the legs), and turning costs pivot steps, braking throws the forepaws out in front, and sharp direction changes are steered through rather than slid through
- A homeowner clothed in continuous skinned surfaces rather than assembled from capsules: one shirt from hem to collar over a real shoulder cap, one sleeve per arm, and trouser legs that close the crotch between themselves, with shaped shoes on real ankles — walking on solved legs with planted feet, heel-to-toe steps, stepped turns, and an idle weight shift
- Rapier 3D physics: a kinematic character controller for the cat and homeowner, dynamic rigid bodies for every swipeable prop, and real vertical traversal
- Boundary containment: walls and fences are never offered as ledges, no landing may exceed the authored traversal height or leave the level, and the cat's resolved position is clamped inside the walls whatever put it there
- Contextual leaps onto authored ledges — chair to table, floor to worktop to wall shelf, planter, box, sideboard, washing machine — plus a forward ledge probe so unauthored geometry is climbable too; each leap runs as a real gather, hind-leg push, airborne extension, forepaw contact and hind-leg recovery, and still lands exactly on its authored target
- Four authored semi-fixed camera compositions, including utility-nook coverage, with dead zones, look-ahead, FOV blending, separated movement-basis blending, and transition hysteresis
- A three-room house built from typed level data: kitchen, breakfast room, utility nook and garden, with procedural wood, tile, grass and plaster surfaces
- Contextual paw actions, five carryable item types, and escalating disaster states (running sink → pooling → overflow, punctured flour, opened cupboard, broken crockery)
- Interactions that visibly connect: the near paw is aimed at the object it is hitting, force lands on the contact frame rather than the button press, pickups animate a reach and a bite before the object attaches, and the launch speed falls off with mass so a felt mouse skitters where a kettle grudgingly shifts
- One homeowner with a morning routine of real actions — wiping a worktop, opening the cupboard and looking inside, lifting the kettle and setting it back down — who notices when the cat has got there first, plus stimulus investigation, suspicion, pursuit, and a catch that picks the cat up and carries it out rather than teleporting it
- Believable homeowner perception: a directional vision cone with peripheral falloff, real line of sight traced against the walls and furniture, and stillness and the cardboard box as genuine cover; losing them sends them to where you *were*, to sweep it and search rather than track you through the cupboards
- Six-stage objective chain, multi-condition finale, and four optional challenges
- A standalone model viewer plus headless model inspection and screenshot tooling
- Desktop keyboard and standard gamepad controls
- Pause/settings menu, graphics mode, independent quiet music/effects controls, local persistence, and developer diagnostics including Rapier collider wireframes
- Surface-specific footsteps synthesised per footfall — tile is loud, a rug is nearly silent, and a loud step is a stimulus the homeowner can hear — plus distinct paw-contact, clatter, shatter and splash sounds
- Wet and floury pawprints: walking through the overflowing sink or the punctured flour carries it, the trail fades (water dries; flour does not), and the homeowner reads it through the same vision cone and line of sight they use to spot the cat
- Procedural primitive art; no external assets
- Relative Vite base path, suitable for GitHub Pages builds

## Run

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Production build

```bash
npm run build
npm run preview
```

The built static site is written to `dist/`.

## Controls

| Desktop | Action |
|---|---|
| WASD / arrows | Move |
| Shift | Scamper |
| Ctrl | Stalk |
| E | Contextual paw / swipe / steal / act innocent |
| Q | Meow and create a sound stimulus |
| Space | Contextual leap — leaps onto the named ledge when one is offered |
| Escape | Pause/settings |
| Backquote | Developer diagnostics |

Gamepads use the left stick to move, A to interact, B to leap, X to meow, LB to stalk, RB to scamper, and Menu to pause. Prompts automatically switch to the active device.

## Programmatic playtesting

The level has a rendering-independent, event-driven model. It exposes valid commands for the current state, rejects impossible actions, and emits events for movement, stimuli, items, preparations, objectives, and completion. Run the canonical playthrough without a browser:

```bash
npm run playtest
```

The same model is exercised by tests for the critical path, the key's counter-jump prerequisite, alternate preparation order, and action availability. This makes objective deadlocks and unclear prerequisites reproducible before tuning the Three.js presentation.

Agentic development instructions live in `.agents/skills/catscapades-playtest`. An agent can invoke the bundled validation workflow directly:

```bash
.agents/skills/catscapades-playtest/scripts/run-playtest.sh
```

## Architecture

`src/main.ts` owns bootstrap and pause/settings wiring. `src/input.ts` centralizes keyboard and gamepad actions. `src/core/gameplay.ts` contains pure interaction, stimulus, suspicion, camera-hysteresis, and objective rules; `src/core/pathfinding.ts` contains the rendering-independent A* floor-grid solver. `src/settings.ts` provides guarded localStorage persistence. `src/game.ts` composes the Three.js world, kinematic collision, authored cameras, cat, homeowner, props, objectives, and presentation while the prototype is incrementally extracted.

The simulation runs at a fixed 60 Hz with capped frame accumulation. The cat stays kinematic and the project retains its small authored collision layer rather than adding a rigid-body dependency.

## Tests

```bash
npm run typecheck
npm test
npm run build
npm audit
```

## GitHub Pages

The Vite configuration uses a relative base path and `.github/workflows/deploy.yml` builds and uploads `dist/`. Enable GitHub Pages with **GitHub Actions** as the source, then push to `main`. No backend, secret, or root-relative runtime asset path is required.

## Known limitations

- The cat uses a purpose-built procedural character mesh and rig; most scenery, prop art, animation, and sound remain stylised procedural assets rather than an external production asset pipeline.
- Navigation and prop motion are authored for this single compact level rather than general-purpose physics or navmesh systems.
- The developer panel reports runtime state but visual collider/route overlays remain an authoring follow-up.

## Prototype notes

This deliberately uses a tiny hand-rolled collision layer rather than Rapier. It is appropriate for this controlled grey-box: static axis-aligned walls and furniture, planar cat movement, and a few scripted dynamic props. A production level with arbitrary meshes, stairs, moving platforms, and many interacting rigid bodies is where a dedicated physics/query layer becomes more attractive.

The camera is authored by zone. Each zone provides a fixed composition, a target dead zone, soft follow factors and transition thresholds. Movement is calculated from the camera's current projected forward/right basis, so it remains continuous during camera blends.

## Architecture

| Area | Module |
|---|---|
| Bootstrap, loop, settings | `src/main.ts`, `src/settings.ts`, `src/input.ts` |
| Orchestration | `src/game.ts` |
| Physics | `src/physics/physics-world.ts` (Rapier world, character controller, dynamic bodies, ledge probe) |
| Cat locomotion | `src/cat/cat-controller.ts` |
| Homeowner perception | `src/core/perception.ts` |
| Footstep surfaces | `src/core/surfaces.ts` |
| Pawprint trail | `src/core/paw-trail.ts` |
| Animation | `src/anim/cat-animator.ts`, `src/anim/leg-ik.ts`, `src/anim/owner-animator.ts` |
| Camera | `src/camera/camera-director.ts` |
| Models | `src/models/` — `cat.ts`, `cat-geometry.ts`, `owner.ts`, `furniture.ts`, `props.ts`, `materials.ts`, `registry.ts`, `inspect.ts` |
| Level | `src/level/level-data.ts` (authored data), `src/level/level-builder.ts` (scene + colliders) |
| Rendering-independent rules | `src/core/` — `gameplay.ts`, `level-model.ts`, `math.ts`, `pathfinding.ts` |
| Model viewer | `viewer.html`, `src/viewer/` |

Visuals and collision come from one source: each furniture builder returns its own
collision boxes, so a piece can never be visible-but-not-solid. Level geometry,
camera framing, jump targets, interaction stations, and the homeowner's routine are
typed data in `src/level/level-data.ts` rather than being embedded in controllers.

### Physics

Rapier replaced the original hand-rolled circle-vs-AABB collision layer. The MVP
needs the cat to climb onto counters, chairs, boxes and tables; the previous solver
was a set of 2D rectangles with no notion of "on top of", so vertical traversal
could only ever be faked with proximity flags. Rapier supplies grounded checks,
auto-step, ground snapping and slide-along-wall, and makes swiped crockery behave
without per-object code.

Locomotion feel stays authored. The cat and homeowner are kinematic; only props are
dynamic, capped in number, and allowed to sleep. Contextual leaps follow an authored
arc to a known landing point rather than a ballistic trajectory, because a ballistic
arc has to clear the lip of a surface using horizontal speed the cat usually does not
have when taking off pressed against a cupboard face.

## Model viewer and inspection

Every visual asset is registered in `src/models/registry.ts` and can be built,
measured, animated and screenshotted in isolation.

```bash
npm run models                  # list every registered model
npm run models -- cat --clips   # bounds, geometry, joint tree, per-clip motion
npm run models -- --all         # audit everything; exits non-zero on warnings
npm run models:capture -- cat   # screenshots from hero/front/side/top
npm run dev                     # then open /viewer.html for interactive review
```

`scripts/capture-game.mjs` photographs the running game, and can drop the cat
anywhere in the level and drive the simulation deterministically:

```bash
node scripts/capture-game.mjs --at 5.3,-5.0 --drive "w:0.6,jump:0.3,idle:0.5"
```

See `.agents/skills/catscapades-model-viewer/SKILL.md` for the full workflow.

## Known limitations

- Music and effects are synthesized rather than recorded assets, and there are no subtitles yet.
- The homeowner uses an obstacle-aware A* floor grid sourced from the same
  collider boxes as the rendered furniture. Moving props are intentionally not
  baked into the route grid; the kinematic controller pushes or slides around
  those lightweight pieces at runtime.
- The production JavaScript chunk exceeds Vite's 500 kB warning threshold now that
  Rapier is bundled. Load performance is within the desktop target; splitting the
  viewer and debug modules is the next step if it grows.
- Headless Chromium renders through SwiftShader at single-digit frame rates, so the
  capture tooling should use `--drive` rather than real key presses for anything
  timing-sensitive.
