# Catscapades Agent Guide

## Scope

These instructions apply to the entire repository.

Catscapades is a desktop browser stealth-comedy game built with strict TypeScript, Three.js, and Vite. Preserve the existing playable path and prefer incremental, testable changes over large rewrites.

## Required workflow

1. Inspect the affected runtime code, shared level definitions, and existing tests before editing.
2. For objectives, interactions, item placement, routes, prerequisites, alternate solutions, or pacing work, use the repository skill at `.agents/skills/catscapades-playtest/SKILL.md`.
3. For any model, rig, animation, proportion, silhouette, or level-appearance work, use `.agents/skills/catscapades-model-viewer/SKILL.md`. Register new models in `src/models/registry.ts`; an unregistered model cannot be inspected or reviewed.
4. Keep the rendering-independent model and rendered level aligned:
   - shared objective definitions and logical rules belong in `src/core/level-model.ts`;
   - authored geometry, camera zones, jump targets, interaction stations, props, and the homeowner routine belong in `src/level/level-data.ts`;
   - orchestration belongs in `src/game.ts`, locomotion in `src/cat/`, animation in `src/anim/`, collision in `src/physics/`, and camera framing in `src/camera/`;
   - every logical action exposed by the model must be physically reachable and clearly prompted in the browser.
5. Add regression coverage for both the valid path and the invalid action that could cause a deadlock or sequence break.
6. For perceptible changes, run the browser, check the console, and capture a screenshot. Headless playtest metrics do not replace visual or feel validation.
7. Keep documentation, controls, objective copy, and agentic playtest traces synchronized with behavior.

## Validation

Run before committing:

```bash
.agents/skills/catscapades-playtest/scripts/run-playtest.sh
npm run models -- --all
npm test
npm run build
npm audit
git diff --check
```

For model, rig, or level-appearance changes, additionally capture and read
screenshots:

```bash
npm run models:capture -- <model-id> --clips
node scripts/capture-game.mjs --at <x>,<z> --drive "w:0.6,jump:0.3,idle:0.5"
```

The bundled skill runners cover the canonical event trace, model integrity across the whole registry, focused regression tests, and strict TypeScript checks. Treat rejected commands, an incomplete snapshot, model/runtime drift, model warnings, test failures, and type errors as blockers.

The current Vite chunk-size warning is known and non-blocking unless the change materially worsens load size or performance.

## Code and design conventions

- Use strict types and avoid `any`.
- Keep input mapping centralized in `src/input.ts`.
- Keep persistence guarded against unavailable storage in `src/settings.ts`.
- Keep the cat and homeowner kinematic. Rapier owns collision resolution; it must not own locomotion feel.
- Only props are dynamic rigid bodies. Cap their number and let them sleep.
- Furniture builders must return their own collision boxes so visuals and collision cannot drift apart.
- Drive animation from gameplay causes (speed, turn rate, footfall, attention), not from a clip index. Never let animation mutate gameplay rules.
- Contextual leaps commit to an authored arc with a known landing. Do not replace them with ballistics.
- Prefer reusable interactions and explicit object states over object-specific branches.
- Make prerequisites legible through world placement, contextual prompts, and visible state changes; do not rely on abstract floor markers.
- Preserve camera-relative movement and doorway hysteresis during camera changes.
- Never claim that automated metrics prove the game is fun, or that a passing model inspection proves a model looks good. Report logical reachability, model-integrity results, pacing heuristics, browser validation, and outstanding human-feel checks separately.
- Keep the game and package name as **Catscapades**.
- Support keyboard and standard gamepads in desktop browsers.

## Commit and delivery

- Keep commits focused and descriptive.
- Do not commit generated `dist/` output or dependency directories.
- Update the README when setup, controls, architecture, playtesting, deployment, or known limitations change.
- Include exact validation commands and their results in the final summary.
