---
name: catscapades-playtest
description: Programmatically play, debug, and tune Catscapades levels through the rendering-independent event model. Use when changing objectives, item placement, prerequisites, routes, interactions, progression, alternate solutions, or level pacing; when reproducing an unreachable or confusing objective; or when validating that browser gameplay and the headless model remain aligned.
---

# Catscapades Playtest

Use the event model as an executable design specification. Do not treat a passing critical path as proof that presentation or feel is good.

## Workflow

1. Run the bundled validation from the repository root or pass the root explicitly:

   ```bash
   .agents/skills/catscapades-playtest/scripts/run-playtest.sh
   ```

2. Read the emitted trace. Treat any rejected command, incomplete snapshot, unavailable prerequisite, or browser/model definition mismatch as a blocker.
3. Reproduce the reported scenario with `LevelModel.dispatch()` and assert both rejected and accepted actions before editing runtime code.
4. Change shared definitions or pure rules first. Keep `OBJECTIVE_DEFINITIONS`, area connections, item areas, prerequisites, and the rendered level synchronized.
5. Add or update a focused test in `src/core/level-model.test.ts`. Cover alternate ordering and failure behavior, not only the happy path.
6. Re-run the bundled validation.
7. Start the browser and verify spatial affordance, prompt timing, collision reachability, camera composition, and feedback. Capture a screenshot for visible changes.
8. Report separately:
   - logical reachability;
   - choice/pacing heuristics;
   - browser smoke result;
   - human-feel checks still outstanding.

## Design rules

- Query `availableCommands()` before dispatching when exploring.
- Require the canonical path to complete with zero `rejected` events.
- Test the invalid action that previously caused the bug; a happy-path test alone is insufficient.
- Keep at least one meaningful choice during preparation and avoid consecutive actions that produce indistinguishable feedback.
- Make prerequisites explicit in objective copy and contextual prompts.
- Use planar reach for elevated authored interactions only when a contextual traversal action has unlocked them.
- Replace abstract markers with recognizable world objects and visible state changes.
- Never claim the game is fun solely from headless metrics. Use event variety and branching only to identify likely pacing problems, then verify the rendered experience.

Read [references/model-contract.md](references/model-contract.md) when adding commands, events, objectives, areas, or browser/model synchronization. Use the bundled script rather than reconstructing the command sequence manually.
