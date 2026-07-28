# Catscapades — A Perfectly Quiet Morning

A desktop browser stealth-comedy MVP about an extremely innocent cat. Observe a morning routine, create distractions, steal and carry evidence, prepare a domestic catastrophe, and make it back to the garden box before the homeowner catches you.

## Included

- Camera-relative cat movement
- Three authored semi-fixed camera zones with dead zones, soft follow, blending and doorway hysteresis
- Custom TypeScript circle-vs-AABB collision (no physics dependency)
- Contextual paw actions, five carryable item types, and three disaster preparations
- Contextual leap, stalking, scampering, and synthesized meow stimuli
- One homeowner with routine, investigation, pursuit and forgiving catch/reset behavior
- Six-stage objective chain, multi-condition finale, and four optional challenges
- Desktop keyboard and standard gamepad controls
- Pause/settings menu, graphics mode, volume controls, local persistence, and developer diagnostics
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
| Space | Contextual leap |
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

`src/main.ts` owns bootstrap and pause/settings wiring. `src/input.ts` centralizes keyboard and gamepad actions. `src/core/gameplay.ts` contains pure interaction, stimulus, suspicion, camera-hysteresis, and objective rules. `src/settings.ts` provides guarded localStorage persistence. `src/game.ts` composes the Three.js world, kinematic collision, authored cameras, cat, homeowner, props, objectives, and presentation while the prototype is incrementally extracted.

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

- Art, animation, and sound remain procedural low-poly placeholders.
- Navigation and prop motion are authored for this single compact level rather than general-purpose physics or navmesh systems.
- The developer panel reports runtime state but visual collider/route overlays remain an authoring follow-up.

## Prototype notes

This deliberately uses a tiny hand-rolled collision layer rather than Rapier. It is appropriate for this controlled grey-box: static axis-aligned walls and furniture, planar cat movement, and a few scripted dynamic props. A production level with arbitrary meshes, stairs, moving platforms, and many interacting rigid bodies is where a dedicated physics/query layer becomes more attractive.

The camera is authored by zone. Each zone provides a fixed composition, a target dead zone, soft follow factors and transition thresholds. Movement is calculated from the camera's current projected forward/right basis, so it remains continuous during camera blends.
