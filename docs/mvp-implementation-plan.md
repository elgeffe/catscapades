# Cat Schemer MVP Implementation Plan

## Purpose and scope

This document records the implementation plan for turning the existing Cat Schemer prototype into a polished, replayable browser MVP. The first level is **A Perfectly Quiet Morning**, a 10–20 minute third-person stealth-comedy scenario in which a calculating house cat observes a homeowner, engineers a multi-stage domestic catastrophe, and returns to an innocent pose.

The product is **desktop only**. Mobile, touch controls, responsive mobile layouts, and mobile performance are explicitly out of scope. Any mobile requirements in the original brief—including the touch reference in its definition of done—are ignored. Supported play methods are desktop keyboard and standard gamepads in a desktop browser.

The project will evolve incrementally rather than being rewritten. Genre, pacing, and authored-camera principles may be inspirational, but all characters, environments, objectives, dialogue, assets, UI, music, animations, and layouts must be original.

## Product pillars

1. **Authored mischief, not random destruction.** The player observes routines and creates understandable chains of cause and effect.
2. **A scheming cat.** Distraction, theft, placement, timing, hiding, and feigned innocence matter as much as knocking objects over.
3. **Diorama staging.** Semi-fixed camera compositions make rooms readable, showcase reactions, and keep movement predictable.
4. **Recoverable comedy.** Getting caught is a brief, funny setback; it is not a game-over and does not erase most world progress.
5. **Dense systemic level design.** One compact home supports multiple solutions and optional discoveries instead of relying on map size.

## Baseline audit (2026-07-28)

### Verification completed

- `npm ci` completed successfully with no reported vulnerabilities.
- `npm run typecheck` completed successfully.
- The Vite development server started successfully and served the main page.
- `npm run build` completed successfully. Vite reported a warning because the main JavaScript chunk is slightly above 500 kB.

### Existing strengths to preserve

- Strict TypeScript, Three.js, Vite, and a small dependency footprint.
- Camera-relative movement and a 60 Hz fixed gameplay step.
- Three semi-fixed camera zones with dead-zone following and transition hysteresis.
- A procedural cat, a homeowner routine, distraction via meowing, contextual paw actions, pouncing, movable props, collision, catch/reset behavior, and a five-step objective loop.
- Relative Vite base configuration and an existing GitHub Pages deployment workflow.
- A lightweight hand-rolled collision model suited to the current planar, grey-box environment.

### Main technical weaknesses

1. **Oversized game class.** Most rendering, simulation, level construction, camera behavior, interactions, NPC logic, objectives, UI updates, collision, and state live in `CatSchemerGame`. This makes isolated testing and safe feature growth difficult.
2. **Hardcoded level content.** Camera zones, objectives, prop behavior, geometry, thresholds, routes, and progression checks are embedded in source rather than authored as level data.
3. **Hardcoded objective sequence.** Objectives are advanced through direct checks instead of an event-driven, data-defined condition system. Out-of-order and alternative solutions will be brittle without extraction.
4. **Limited interaction model.** Contextual behavior is implemented as object-specific branches and does not yet expose reusable verbs, options, scoring, placement, or state machines.
5. **Shallow NPC model.** The current state set is much smaller than the required perception, evidence, suspicion, pursuit, catching, relocation, restoration, and routine-resumption loop. Props can influence behavior too directly.
6. **Prototype input scope.** Keyboard and touch exist, but gamepad, active-device prompt switching, centralized remappable bindings, stalk, carrying controls, pause, and accessibility preferences are absent. Touch code is legacy for this desktop-only MVP and should be removed after desktop parity is secured.
7. **Incomplete game loop lifecycle.** A fixed accumulator exists, but the loop needs capped catch-up, explicit update phases, visibility pause/recovery, and interpolation boundaries.
8. **Camera system gaps.** Zones lack authored pitch/FOV/focus data, optional rails, foreground fading, controller peek, critical-transition locks, and comprehensive visualization.
9. **No automated logic tests or lint script.** High-risk gameplay rules cannot currently be regression tested independently from Three.js.
10. **Presentation systems are provisional.** Audio is synthesized and narrow; there is no pause/settings/completion flow, persistence, subtitles, quality selection, or full animation-state architecture.
11. **Bundle warning.** The production JavaScript chunk exceeds Vite's 500 kB warning threshold. This is not an MVP blocker, but bundle composition should be measured during presentation work.

## Architecture direction

Use composition and focused systems, not a speculative ECS and not a full rewrite. Extract seams from the existing class one at a time while keeping a playable build after every milestone.

### Target module boundaries

- **Bootstrap and loop:** startup error boundary, renderer setup, `requestAnimationFrame`, capped fixed timestep, page-visibility pause, interpolation, and ordered update phases.
- **Input:** centralized action bindings for keyboard and gamepad, active-device detection, remapping-ready definitions, and action-edge buffering.
- **Core:** typed event bus, reusable finite-state machine, time utilities, entity IDs/registry, and shared gameplay types.
- **World and collision:** static colliders, support surfaces, triggers, simple scripted dynamic props, collision queries, and debug visualization.
- **Cat:** kinematic locomotion, action/state coordination, carrying, contextual jump execution, catch/reset, and procedural animation adapter.
- **Camera:** zone selection, hysteresis, dead-zone tracking, blending, movement-basis blending, optional rails/peek, occlusion fade, set-piece shots, and debug rendering.
- **Interaction:** interactable adapters, state-dependent options, candidate scoring, prompt data, reusable verbs, object state machines, and placement zones.
- **NPC:** routine FSM, stimulus perception, evidence, suspicion, prioritization, pursuit/catch/relocation, restoration jobs, navigation route following, and animation adapter.
- **Objectives:** event-driven condition evaluation, prerequisites, all/any groups, hidden/optional goals, reset conditions, completion events, and UI projection.
- **Level:** dedicated typed configuration for geometry, spawn/reset points, camera zones/rails, jump targets, routes, props, interactions, objectives, hiding places, placement zones, audio emitters, and room activation.
- **Presentation:** replaceable audio cues, UI, pause/settings/completion screens, subtitles, persistence, graphics/accessibility options, and debug panel.

Cross-system behavior will flow through typed events and queries. Props emit state changes and stimuli; they do not directly command the homeowner or complete objectives. The player controller asks the interaction resolver for an option rather than containing object-specific branches.

### Physics decision

Retain the hand-rolled collision system initially. The MVP uses a kinematic cat, authored jumps, static room geometry, triggers, and a limited number of scripted props, so Rapier would add integration and tuning cost without a demonstrated benefit. Reconsider Rapier only if testing proves that stable moving furniture, stacking, or shape casts cannot be delivered reliably. If introduced, record the benchmark/problem it solves, retain custom kinematic locomotion, use a fixed timestep and simple colliders, cap active bodies, synchronize transforms in one place, and add collision visualization.

### Data and persistence

Level-specific values must move into a typed `A Perfectly Quiet Morning` configuration rather than being scattered through controllers. Runtime progress and settings use a versioned local-storage schema with guarded reads/writes and in-memory fallback. Persist level completion, optional objectives, audio sliders, quality, control preferences, reduced motion, camera shake, high-contrast prompts, reduced effects, and subtitles—not transient world simulation.

## Level design: A Perfectly Quiet Morning

### Layout

Build a compact loop of readable spaces:

- **Garden/patio:** starting cardboard box, tutorial space, toy or food item, back-door sightline, and catch reset point.
- **Back entrance:** controlled threshold where meowing or another disturbance causes the homeowner to approach/open the door.
- **Kitchen:** sink, key perch, flour bag, cupboards, sponge, food, countertop traversal, and main catastrophe staging.
- **Dining area:** mug, chair/table traversal, fruit bowl innocence gag, hiding under the table, and a distraction opportunity.
- **Utility/storage nook:** sock, movable obstruction, alternate hiding place, and route that supports flanking the homeowner.

At least two elevated traversal networks will connect chairs, tables, countertops, boxes, and/or a windowsill through authored jump targets. Spaces remain dense enough that NPC intent and causal relationships can be read from an authored camera shot.

### Main objective chain

Objectives are defined as event conditions with prerequisites, not imperative steps in a level controller.

1. **Get inside.** Prompt movement and meow naturally. The player can lure the homeowner to the back door or create a nearby object disturbance that causes the door interaction.
2. **Create a distraction.** Cause a sound or visible incident that draws the homeowner away from the guarded kitchen area.
3. **Steal the key.** Use an authored jump route to reach the key, grab it, and move it away from its guarded location.
4. **Prepare the disaster.** Complete any two preparation conditions in any order: run the sink, puncture flour, move the mug, misplace a sock/sponge, open a cupboard, or block a route.
5. **Trigger the catastrophe.** Once enough compatible preparations exist, trigger a clearly framed causal sequence: persistent water, flour/mess, a mug or secondary object fall, and the homeowner's exaggerated reaction.
6. **Act innocent.** Escape to the cardboard box or a designated innocence location and pretend to sleep before the homeowner catches the cat.

The catastrophe uses authored object states and prepared debris rather than runtime mesh fracturing. A short critical camera composition may temporarily disable controller peek, but it must not remove control longer than needed to communicate the payoff.

### Optional and hidden objectives

Ship at least three; target five so replay has meaningful variation:

- Place the sock in the running sink.
- Sit in the fruit bowl.
- Make the homeowner open the back door three times.
- Return the key to the starting box.
- Finish without being caught.
- Preserve the mug may be included only if completion remains compatible with the catastrophe's alternate state chain.

### Interaction coverage

At least 12 props use the reusable interaction architecture. At least five item types are carryable: key, sock, sponge, small food item, and toy. Other props deliberately expose only appropriate actions. Representative authored state machines:

- Mug: `Stable → Wobbling → Falling → Broken` (with a non-broken displaced route).
- Sink: `Off → Running → Overflowing`.
- Flour bag: `Sealed → Punctured → Spilling → Empty`.
- Cupboard: `Closed → PartiallyOpen → Open`, optionally `Blocked`.

## Player experience requirements

### Movement and input

- Responsive camera-relative walk, scamper, and stalk with smooth acceleration/deceleration, stable turning, ground support, furniture/wall collision, and reduced speed while carrying.
- Preserve a stable, blended movement basis during major camera transitions.
- Keyboard: WASD/arrows move, Shift scamper, E primary/contextual action, Q meow, Space contextual jump, Escape pause, and backquote debug in development.
- Gamepad: left stick move, face buttons for action/meow/jump, shoulder or stick control for stalk/scamper and limited peek, and Start/Menu pause. Exact bindings live in centralized configuration and prompts reflect the last active device.
- There is no touch-control acceptance work. Remove prototype touch UI/input once desktop and gamepad paths are verified.

### Contextual jump

Each target defines origin constraints, destination transform, approach/facing tolerance, priority, arc height, anticipation/flight/landing timing, and allowed cat states. The resolver offers `JumpTo` without pixel-perfect aiming. Execution temporarily owns locomotion, follows a controlled arc, lands at a reliable authored point, and coordinates camera framing.

### Paw actions and carrying

The primary action resolver scores available options by distance, facing, height, state compatibility, explicit priority, and objective relevance. Supported verbs include `Swipe`, `Push`, `Grab`, `Drop`, `Place`, `Scratch`, `Activate`, `Open`, `Enter`, `Exit`, `JumpTo`, `Hide`, and `PretendInnocent`.

Carried objects attach to a mouth socket, reduce top speed, alter/disable meow, can be dropped or placed in authored zones, and drop automatically on catch. Carryability is explicit object data.

### Hiding, innocence, and catching

The box, under-table area, a chair, grooming, and pretend sleep provide hiding/innocence possibilities with different perception effects. Innocence reduces ambiguous suspicion gradually but cannot erase strong witnessed evidence.

On catch, the homeowner approaches, plays a brief pickup sequence, the cat struggles and drops its item, then is relocated to the garden or nearest reset point. Prepared world state mostly remains. Control returns quickly and the total penalty stays under roughly 30 seconds.

## Camera plan

Each typed camera zone contains bounds, priority, hysteresis, yaw, pitch, distance, FOV, focus offset, dead-zone dimensions, soft-follow rates, movement look-ahead, blend duration, optional rail, and occlusion settings.

- Track only after the cat approaches the composition boundary.
- Place transitions at doors/corners and prevent adjacent-zone thrashing.
- Blend both view and movement basis so held input never unexpectedly reverses direction.
- Fade tagged foreground blockers using ray/query results and restore materials safely.
- Permit a small spring-return gamepad peek outside critical transitions; do not add unrestricted orbit control.
- Allow authored set-piece framing for the catastrophe without undermining player orientation.
- Debug rendering shows active zone, bounds, target, dead zone, desired camera position, rail, and occlusion ray.

## NPC, stimuli, and evidence

The homeowner follows a loop such as prepare breakfast, place mug, use sink, retrieve cupboard item, sit, notice/restore disturbances, and resume. A finite-state machine supports `Routine`, `Curious`, `Investigating`, `Suspicious`, `Pursuing`, `Catching`, `RelocatingCat`, `RestoringOrder`, and `ReturningToRoutine`.

Stimuli are reusable records containing type, position, intensity, source entity, suspected culprit, created/expiry times, persistence, and optional evidence metadata. Types include sound, visual event, missing item, damage, water, cat seen, door opened, and object displaced. The NPC queries valid stimuli and scores urgency, distance, persistence, recency, current task, and suspicion.

Evidence tracks witnessed culprit, unknown culprit, recent cat presence, missing items, broken objects, persistent hazards, and suspicion. The homeowner attributes blame only after witnessing the act, seeing the cat with relevant evidence, finding it lingering at a recent incident, or combining ambiguity with already-high suspicion. Innocent behavior helps chiefly when evidence is ambiguous.

## Objectives and event model

The typed event bus supports at least object-state changes, item movement/pickup/drop/placement, NPC zone/state changes, player caught/hidden, stimulus emission, and objective completion. Objective definitions support:

- prerequisites and visibility rules;
- hidden and optional classification;
- multiple conditions with `all`/`any` composition;
- counters and state predicates;
- optional reset conditions;
- player-facing descriptions; and
- completion events/rewards.

Condition evaluators are pure where practical and receive a compact objective context. This makes out-of-order preparation, alternative solutions, restart, and unit tests straightforward.

## Animation and audio

### Animation

Use named logical states with transition timing and an adapter that can drive current procedural poses now and GLB clips later.

- Cat: idle, grooming idle, walk, scamper, stalk, turn, jump anticipation, jump, land, swipe, grab, carry idle, carry movement, drop, meow, scratch, hide, struggle, and pretend sleep.
- NPC: idle, walk, routine action, look around, investigate, surprise, pursue, pick up cat, carry cat, restore object, and react to catastrophe.

Transitions must blend smoothly, and gameplay ownership of action timing must be explicit so animation does not independently mutate rules.

### Audio

Create a replaceable cue registry and lightweight positional playback for meow variations, paws/footsteps, impacts, mug break, water, flour spill, NPC reactions, suspicion, objectives, catastrophe, and household ambience. Unlock audio after a user gesture and provide independent master/effects/music sliders. Important NPC reactions also receive subtitle text.

## UI, settings, and accessibility

Ship minimal desktop UI for current main objective, optional objectives, device-aware interaction prompt, subtitles, pause, restart, audio, graphics quality, accessibility, completion, and reset-data confirmation. Avoid persistent icon clutter.

Accessibility/settings requirements:

- centralized and remapping-ready bindings;
- pause at any time outside unavoidable atomic transitions;
- reduced camera motion;
- camera shake toggle;
- master/effects/music volume;
- subtitles/text equivalents;
- high-contrast prompts;
- reduced visual effects; and
- no objective state communicated by color alone.

## Game loop and diagnostics

Use `requestAnimationFrame` with a capped accumulated delta and a fixed simulation step. Order each frame explicitly:

1. Poll devices and produce an input snapshot.
2. Run zero or more fixed gameplay updates.
3. Update collision/physics queries.
4. Run post-physics events and state reconciliation.
5. Update animation.
6. Update camera and occlusion.
7. Interpolate render transforms.
8. Render and update low-frequency diagnostics/UI.

Pause simulation while the document is hidden, clear stale input, and reset timing on resume to avoid catch-up spikes.

A development-only backquote panel reports FPS, frame time, draw calls, triangles, active dynamic bodies, active stimuli, player/NPC state, suspicion, camera zone, objective, interaction candidate, and player coordinates. Visual toggles cover colliders, interactions, stimuli, perception, NPC routes, camera zones, and jump targets. Production builds must default these tools off and may tree-shake editor-only helpers where practical.

## Delivery milestones

Every milestone ends with a runnable project, typecheck, production build, test summary, known issues, and an explicit next milestone. Keep commits focused and preserve the playable path throughout extraction.

### Milestone 1 — Architecture and stability

- Record baseline behavior and a short regression play route.
- Add core typed event bus/state-machine/time primitives and a focused test runner.
- Extract loop lifecycle, level data, and debug diagnostics behind existing behavior.
- Add capped fixed-step updates and visibility pause/recovery.
- Document system ownership and retain the existing collision implementation.

**Exit:** current prototype remains playable; extracted pure logic has initial tests; debug panel exposes baseline state.  
**Known risk:** extraction from the large game class can subtly change sequencing. Mitigate with small commits and play checks.  
**Next:** player controller and reusable interactions.

### Milestone 2 — Player controller and interactions

- Add centralized keyboard/gamepad bindings and active-device prompts.
- Polish movement; add stalk and carrying speed rules.
- Implement interaction types, option scoring, prompts, and object state adapters.
- Implement authored contextual jumps, carry/drop/place, hiding, and innocence actions.
- Remove legacy touch controls after desktop parity verification.
- Add tests for input mapping, scoring, carried state, and catch/drop/reset.

**Exit:** the cat can traverse, manipulate, carry/place five item types, hide, and recover from a catch with both desktop input methods.  
**Next:** complete authored camera behavior.

### Milestone 3 — Camera

- Move all zone values into level configuration.
- Add FOV/focus/dead-zone/look-ahead tuning, rails, priorities, and robust hysteresis.
- Blend movement basis, implement occluder fading and small gamepad peek.
- Add critical-transition locks and full visual debugging.
- Add tests for selection and hysteresis.

**Exit:** every room and threshold has stable composition with no movement reversal or zone flicker.  
**Next:** homeowner perception and reactions.

### Milestone 4 — NPC, stimuli, and catching

- Implement typed stimuli, expiry/persistence, prioritization, and debug radii.
- Build the homeowner routine and full reaction FSM.
- Add evidence, suspicion, perception, investigation, pursuit, catch/relocation, restoration, and routine resumption.
- Add procedural animation reactions and subtitles.
- Add tests for prioritization, suspicion, transitions, and relocation behavior.

**Exit:** the homeowner behaves believably, does not cheat attribution, restores order selectively, and imposes only a short catch penalty.  
**Next:** complete objective chain and catastrophe.

### Milestone 5 — Objectives and complete level

- Finish the compact five-area level, collision, routes, 12+ interactable props, jump targets, hiding and placement zones.
- Implement event-driven main and optional objective definitions.
- Support multiple entry/distraction solutions and out-of-order preparation.
- Stage the multi-condition catastrophe and innocence finale.
- Add completion/restart behavior and objective tests.

**Exit:** a first-time desktop player can complete a full beginning, escalation, climax, and ending; at least three optional objectives support replay.  
**Next:** presentation, accessibility, deployment, and optimization.

### Milestone 6 — Presentation and optimization

- Complete animation-state coverage, audio cue registry, ambience, and reactions.
- Finish pause/settings/completion UI, persistence, accessibility, and graphics modes.
- Improve low-poly art consistency, lighting, silhouettes, affordances, and set-piece feedback.
- Profile CPU/GPU/bundle size and limit active simulated props.
- Validate static paths and GitHub Pages deployment documentation/workflow.
- Run the full automated and manual QA matrix.

**Exit:** the desktop-only MVP meets the definition of done below and is ready for a public static deployment.

## Testing and QA strategy

Add focused automated tests for non-rendering logic:

- objective condition composition and prerequisites;
- camera selection and transition hysteresis;
- interaction scoring and state filtering;
- stimulus prioritization and expiry;
- suspicion/evidence changes;
- legal state-machine transitions;
- keyboard/gamepad mappings and active-device switching;
- carried-item pickup/drop/place/catch behavior; and
- catch relocation while preserving appropriate world progress.

Do not unit-test Three.js rendering without a specific benefit. Before each milestone closes, run dependency installation as needed, type checking, automated tests, linting once configured, production build, and `npm audit`.

### Manual desktop QA checklist

- [ ] WASD and arrow movement, Shift scamper, stalk binding, E, Q, Space, Escape, and backquote behavior.
- [ ] Standard gamepad movement, actions, pause, limited peek, disconnect/reconnect, and prompt switching.
- [ ] Smooth camera transitions at every boundary with held movement in all directions.
- [ ] Occluder fading and reduced-camera-motion setting.
- [ ] Every contextual jump lands reliably from valid approaches.
- [ ] Pickup, carry slowdown, changed meow, drop, placement, and catch-drop for all five item types.
- [ ] NPC routine, distraction priorities, ambiguous versus witnessed blame, pursuit, catch, relocation, restoration, and resumption.
- [ ] Main preparation conditions completed in different orders and via alternative solutions.
- [ ] Catastrophe framing and the final innocence deadline.
- [ ] Optional objectives, including persistence across reload where intended.
- [ ] Pause/restart from each major phase; page hide/resume; full reload; and reset-data fallback.
- [ ] Audio unlock, independent sliders, subtitles, and muted play.
- [ ] Low graphics, reduced effects, high-contrast prompt, camera shake, and reduced motion options.
- [ ] Direct GitHub Pages load, asset paths, reload, and deployment artifact.
- [ ] 10–20 minute first-play target and under-30-second catch penalty.

## GitHub Pages delivery

- Keep Vite's static build and repository-safe base-path handling; use no backend, secrets, or hardcoded root-relative assets.
- Verify `npm run build` produces a self-contained `dist/` artifact.
- Maintain the GitHub Actions Pages workflow using the production artifact.
- Document local development, preview, controls, architecture, deployment, and limitations in the README during implementation.
- Smoke-test the published main URL and browser reload at that URL. The MVP has one entry route, so it does not require an SPA fallback unless routing is introduced later.

## Desktop MVP definition of done

- A new player can finish **A Perfectly Quiet Morning** without developer guidance in approximately 10–20 minutes.
- Movement is responsive and predictable on keyboard and gamepad; no touch/mobile acceptance criterion applies.
- Semi-fixed cameras clearly frame all playable areas and transitions do not unexpectedly alter movement.
- At least 12 props use reusable interaction logic, with at least five carryable item types.
- The homeowner completes a routine and can perceive, investigate, become suspicious, pursue, catch, relocate, restore, and resume without omniscient blame.
- The final catastrophe requires multiple prepared conditions; at least one main goal has multiple solutions; at least three optional objectives exist.
- Catching preserves most progress and returns control in under roughly 30 seconds.
- The level has a clear beginning, escalation, climax, innocence finale, completion screen, and replay incentives.
- Pause, settings, audio controls, subtitles, graphics/accessibility options, restart, and guarded persistence work in desktop browsers.
- Strict TypeScript, automated tests, configured linting, production build, audit, and manual desktop QA pass or have explicitly documented environment warnings.
- GitHub Pages deployment succeeds without backend services or secrets.
- The README documents setup, controls, architecture, deployment, and known limitations.

## Known risks and fallback decisions

- **Large-class extraction risk:** behavior regressions. Preferred solution: extract one seam at a time behind existing method contracts. Fallback: leave rendering/world construction in a facade longer while extracting pure gameplay rules first.
- **Hand-rolled collision limits:** authored jumps or moving props may expose query gaps. Preferred solution: add narrow swept/query support. Fallback: constrain those interactions to authored arcs and scripted prop transitions; adopt Rapier only with measured need.
- **NPC navigation complexity:** dense furniture may cause route snagging. Preferred solution: authored route graph with local avoidance. Fallback: use explicit recovery nodes/short warps outside the camera rather than a full navmesh stack.
- **Catastrophe combinatorics:** many preparation combinations can multiply staging work. Preferred solution: define a supported compatibility matrix and normalize it into a few polished payoff variants. Fallback: require any two preparations but funnel them into one clearly motivated master trigger.
- **Asset scope:** polished bespoke animation/audio may exceed MVP capacity. Preferred solution: consistent procedural low-poly presentation behind replaceable adapters. Fallback: reduce the number of unique clips/cues without reducing required gameplay-state readability.
- **Bundle size:** Three.js plus monolithic code currently triggers a chunk warning. Preferred solution: measure first, extract/debug-gate code, and selectively split noncritical UI/debug modules. Fallback: accept the warning if load performance remains within the agreed desktop target.

## Recommended post-MVP work

1. Observe first-time desktop playtests and revise affordances, objective wording, and suspicion readability before adding content.
2. Replace the highest-impact procedural animations and temporary sounds through the existing adapters.
3. Add performance budgets and browser/device coverage based on deployment analytics.
4. Improve authoring tools for camera zones, routes, jumps, and interaction placement if a second level is approved.
5. Consider broader platform support, including mobile/touch, only as a separately scoped project after the desktop MVP is stable.
