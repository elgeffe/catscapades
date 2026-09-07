# Level model contract

## Source ownership

- `src/core/level-model.ts`: commands, events, areas, item locations, shared objective definitions, snapshots, legal-action queries, and canonical playthrough.
- `src/core/level-model.test.ts`: reachability, prerequisites, alternate order, rejection, and regression coverage.
- `scripts/playtest.ts`: human-readable trace and engagement heuristic output.
- `src/game.ts`: rendered spatial implementation. It consumes shared objective definitions but still owns transforms, collision, prompts, animation, and visual state.

## Command-to-runtime correspondence

| Model command | Rendered behavior |
|---|---|
| `move` | Camera-relative locomotion across an authored threshold |
| `meow` | Sound stimulus and homeowner investigation |
| `jump` | Contextual traversal prerequisite, such as counter access |
| `take` | Carry item from its authored area |
| `drop` | Detach carried item at the cat position |
| `prepare` | Change sink, flour, or cupboard state |
| `break` | Smash the red mug in the breakfast room; the break is remembered if preparation is incomplete |
| `sleep` | Finish from the innocence box |

## Extension checklist

When adding or changing a gameplay step:

1. Add the smallest typed command/event needed; reuse existing types when semantics match.
2. Expose the command only from `availableCommands()` when all prerequisites hold.
3. Make `dispatch()` reject the same action everywhere else without mutating state.
4. Emit an event for every player-visible consequence.
5. Update the snapshot only with state relevant to future decisions.
6. Add tests for valid use, invalid use, and at least one alternate order when applicable.
7. Update the canonical route only if the intended first-play path changed.
8. Mirror the rule in the rendered level and verify coordinates/collision do not invalidate logical reachability.

## Pacing interpretation

The playtest report measures decisions, meaningful event types, and maximum legal choices. Use these as warnings:

- Very few event types suggests repetitive feedback.
- One legal command for long stretches suggests excessive linearity.
- Many commands without state-changing events suggests busywork.
- A valid headless command with no reachable browser prompt indicates model/runtime drift.

These metrics cannot assess movement feel, visual readability, comedic timing, camera framing, or delight. Verify those in the browser.
