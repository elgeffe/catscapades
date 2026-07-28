# Cat rig contract

`buildCat()` in `src/models/cat.ts` returns a `CatRig`. Everything below is a
contract that other systems rely on. Breaking any of it fails silently — the
model still renders, it just stops being animated correctly.

## Joint hierarchy

```
cat                       root; owns world position and facing (y rotation only)
└─ cat-body               ride height, squash, lean, landing absorb
   └─ pelvis              hind-leg attachment, rear spine anchor
      ├─ hind-left-root   ─┐
      ├─ hind-right-root  ─┤ leg chains (see below)
      ├─ tail-base         │
      │  └─ tail-0 … tail-8   verlet chain, root first
      └─ spine-lower       │
         └─ spine-upper    │
            └─ chest      ─┘ front-leg attachment
               ├─ front-left-root
               ├─ front-right-root
               ├─ ribcage       scaled for breathing
               └─ neck
                  └─ head
                     ├─ ear-left / ear-right
                     ├─ eye-left / eye-right
                     ├─ eyelid-left / eyelid-right   scale.y drives blinking
                     └─ jaw
                        └─ mouth-anchor              carry socket
```

Each leg chain is `<id>-root → <id>-upper → <id>-lower → <id>-foot`, with the
pivots placed at the end of the parent segment.

## Who drives what

| Joint | Driven by | Channel |
| --- | --- | --- |
| `cat` | `CatController` | position, `rotation.y` |
| `cat-body` | `CatAnimator.updateBody` | `position.y`, `position.x`, pitch, roll |
| `pelvis`, `spine-lower`, `spine-upper` | `updateSpine` | `rotation.x` (flex), `rotation.y` (lateral curve) |
| `chest` | `updateSpine` | `rotation.z/y` for the swipe twist |
| leg `upper`/`lower`/`foot` | `solveLeg` in `src/anim/leg-ik.ts` | `rotation.x`, `upper.rotation.z` splay |
| `neck`, `head` | `updateHead` | full rotation, gaze-stabilised |
| ears, eyelids, eyes, `jaw` | `updateFace` | rotation / scale |
| `tail-*` | `updateTail` | quaternion, back-solved from a world-space chain |
| `mouth-anchor` | `CatscapadesGame` | read-only; carried props copy its world transform |

Two systems must never drive the same channel. If you need a new motion, add it
to the animator method that already owns that joint.

## Leg geometry

`CatLegRig` carries the numbers the IK solves against:

- `upperLength`, `lowerLength`, `footLength` — segment lengths. The meshes are
  built from these; changing one without the other desynchronises solver and
  silhouette.
- `bend` — `+1` bends the middle joint backwards (front leg elbow), `-1`
  forwards (hind leg stifle). This is what makes front and hind legs read as
  different limbs.
- `bodyOffset` — the leg root's position in **body space**. Leg roots are
  authored in body space but parented to `chest` or `pelvis`, so the builder
  subtracts the accumulated spine offset. The solver converts contact points
  back using `bodyOffset`; it is not decoration.
- `restTarget` — neutral ground contact, used for the build-time rest pose and
  as the base for every gait's foot placement.
- `phaseOffset` — default gait phase. `CatAnimator` re-times these per gait.

Leg order in `CatRig.legs` is `hind-left, front-left, hind-right, front-right`,
and `GaitProfile.offsets` is indexed in that order. Reordering one without the
other silently produces a broken gait rather than an error.

## Reach budget

The IK clamps its target distance, so an over-long reach does not throw — it
quietly straightens the leg. After changing `STAND_HEIGHT` or any segment
length, verify:

```
hip-to-ankle vertical  =  STAND_HEIGHT + bodyOffset.y − footLength·cos(ankleAngle)
must stay below        =  upperLength + lowerLength    (ideally under ~0.9 of it)
```

`ankleAngle` is `HIND_ANKLE_ANGLE` (0.78) or `FRONT_ANKLE_ANGLE` (0.16) from
`src/anim/leg-ik.ts`. A ratio near 1.0 gives a stiff, stilted stance; around
0.85–0.9 gives a relaxed cat.

## Gaits

`GAITS` in `src/anim/cat-animator.ts` defines creep, walk, trot, and gallop.
Selection is by smoothed speed with hysteresis; the leg phase offsets are
*interpolated* toward the new gait rather than switched, so transitions re-time
the same clock instead of popping.

- `stride` is distance per full cycle. Cycle frequency is `speed / stride`, and
  stance sweep is `stride × duty`, which is what keeps feet from sliding.
- `duty` is the fraction of the cycle a foot is planted. Above 0.5 the gait has
  no suspension phase; the gallop's 0.34 does.
- `crouch` scales ride height; the creep's 0.66 is the stalk pose.

If feet skate, the stance sweep and the frequency disagree — check `stride`, not
the animation rate.

## Tail

`updateTail` simulates the chain in **world space** (verlet, with a per-segment
rest direction that curves along the chain), then back-solves each joint's local
quaternion so the meshes stay under the rig. Consequences:

- The chain needs the rig's world matrix to be current. It calls
  `tailBase.updateWorldMatrix` itself; do not reorder it before the spine
  update.
- After a teleport, call `CatAnimator.resetSecondaryMotion()` or the tail whips
  across the level.
- Carriage is driven by `alert`, `stalking`, `sleeping`, and `airborne`. Raising
  stiffness to "fix" a floppy tail removes the lag that makes it read as real
  weight — change `carriage` instead.

## Adding a clip

Clips live in `CAT_CLIPS` in `src/models/registry.ts`. A clip is a partial
`CatAnimationInput` plus an optional per-frame `at(time, input)` hook. Adding
one there makes it available to the viewer, the capture script, and
`inspectClip` at once. Then verify with:

```bash
npm run models -- cat --clips
npm run models:capture -- cat --clips
```
