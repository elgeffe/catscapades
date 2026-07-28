# Catscapades Agent Guide

## Scope

These instructions apply to the entire repository.

Catscapades is a desktop browser stealth-comedy game built with strict TypeScript, Three.js, and Vite. Preserve the existing playable path and prefer incremental, testable changes over large rewrites.

## Required workflow

1. Inspect the affected runtime code, shared level definitions, and existing tests before editing.
2. For objectives, interactions, item placement, routes, prerequisites, alternate solutions, or pacing work, use the repository skill at `.agents/skills/catscapades-playtest/SKILL.md`.
3. Keep the rendering-independent model and rendered level aligned:
   - shared objective definitions and logical rules belong in `src/core/level-model.ts`;
   - spatial transforms, collision, camera framing, prompts, animation, and visible state belong in `src/game.ts`;
   - every logical action exposed by the model must be physically reachable and clearly prompted in the browser.
4. Add regression coverage for both the valid path and the invalid action that could cause a deadlock or sequence break.
5. For perceptible changes, run the browser, check the console, and capture a screenshot. Headless playtest metrics do not replace visual or feel validation.
6. Keep documentation, controls, objective copy, and agentic playtest traces synchronized with behavior.

## Validation

Run before committing:

```bash
.agents/skills/catscapades-playtest/scripts/run-playtest.sh
npm test
npm run build
npm audit
git diff --check
```

The bundled skill runner covers the canonical event trace, focused level-model regression tests, and strict TypeScript checks. Treat rejected commands, an incomplete snapshot, model/runtime drift, test failures, and type errors as blockers.

The current Vite chunk-size warning is known and non-blocking unless the change materially worsens load size or performance.

## Code and design conventions

- Use strict types and avoid `any`.
- Keep input mapping centralized in `src/input.ts`.
- Keep persistence guarded against unavailable storage in `src/settings.ts`.
- Keep the cat kinematic and retain the authored collision layer unless a measured limitation justifies replacing it.
- Prefer reusable interactions and explicit object states over object-specific branches.
- Make prerequisites legible through world placement, contextual prompts, and visible state changes; do not rely on abstract floor markers.
- Preserve camera-relative movement and doorway hysteresis during camera changes.
- Never claim that automated metrics prove the game is fun. Report logical reachability, pacing heuristics, browser validation, and outstanding human-feel checks separately.
- Keep the game and package name as **Catscapades**.
- Support keyboard and standard gamepads in desktop browsers.

## Commit and delivery

- Keep commits focused and descriptive.
- Do not commit generated `dist/` output or dependency directories.
- Update the README when setup, controls, architecture, playtesting, deployment, or known limitations change.
- Include exact validation commands and their results in the final summary.
