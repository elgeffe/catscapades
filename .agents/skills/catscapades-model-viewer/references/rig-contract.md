# Cat rig contract

`buildCat()` in `src/models/cat.ts` returns a `CatRig`. Everything below is a
contract that other systems rely on. Breaking any of it fails silently — the
model still renders, it just stops being animated correctly.

## Joint hierarchy

```
cat                       root; owns world position and facing (y rotation only)
└─ cat-body               ride height, squash, lean, landing absorb
   ├─ ribcage             one skinned torso surface, bound to the spine bones
   └─ pelvis              hind-leg attachment, rear spine anchor
      ├─ hind-left-root   ─┐ each leg skin starts on a stationary socket,
      ├─ hind-right-root  ─┤ then spans its upper, lower, and foot bones
      ├─ tail-base         │
      │  ├─ tail-skin         one tapered surface, skinned from socket through tail joints
      │  └─ tail-0 … tail-11  verlet chain, root first
      └─ spine-lower       │
         └─ spine-upper    │
            └─ chest      ─┘ front-leg attachment
               ├─ front-left-root
               ├─ front-right-root
               ├─ scapula-left / scapula-right   invisible stride-timing anchors
               ├─ head-skin       one seam-free surface bound to neck + head
               └─ neck
                  └─ head
                     ├─ ear-left / ear-right
                     ├─ eye-left / eye-right
                     ├─ pupil-left / pupil-right
                     ├─ eyelid-left / eyelid-right   scale.y drives blinking
                     └─ jaw
                        └─ mouth-anchor              carry socket
```

Each leg root owns a stationary `<id>-socket` plus the animated
`<id>-upper → <id>-lower → <id>-foot → <id>-paw` chain, with every animated
pivot placed at the end of the parent segment. `foot` is the sloping
metapodial; `paw` is the terminal sole. The root also owns one `<id>-skin`
`SkinnedMesh`, bound in order to its `socket`, `upper`, `lower`, and `foot`
bones. Socket weighting keeps the buried shoulder or hip flare anchored while
the upper limb rotates beneath it. The paw remains a separate rigid mesh so its
planted sole stays compact and level.

`head-skin` is a sibling of `neck` under `chest`, but is bound to the
`neck → head` bone chain. One lofted surface therefore spans the throat, nape,
crown, cheeks, and muzzle without an intersecting neck/skull seam; facial
features remain children of `head`.

## Who drives what

| Joint | Driven by | Channel |
| --- | --- | --- |
| `cat` | `CatController` | position, `rotation.y` |
| `cat-body` | `CatAnimator.updateBody` | `position.y`, `position.x`, pitch, roll |
| `pelvis`, `spine-lower`, `spine-upper` | `updateSpine` | `rotation.x` (flex), `rotation.y` (lateral curve) |
| `chest` | `updateSpine` | `rotation.z/y` for the swipe twist |
| `ribcage` | spine skinning / `updateSpine` | vertex deformation, subtle breathing scale |
| leg `upper`/`lower`/`foot`/`paw` | `solveLegLocal` in `src/anim/leg-ik.ts` | sagittal rotation, `upper.rotation.z` splay; terminal sole counter-rotation |
| each `<id>-skin` | socket/upper/lower/foot skinning | socket-anchored continuous limb deformation; the rigid terminal paw is separate |
| `scapula-left`, `scapula-right` | `updateLegs` | invisible stride-timing anchors; visible shoulder form comes from the torso and buried front-limb flare |
| `neck`, `head` | `updateHead` | full rotation, gaze-stabilised |
| `head-skin` | neck/head skinning | seam-free deformation from throat and nape through crown, cheeks, and muzzle |
| ears, eyelids, pupils, `jaw` | `updateFace` | rotation / scale |
| `tail-*` | `updateTail` | quaternion, back-solved from a world-space chain |
| `tail-skin` | tail-joint skinning | vertex deformation |
| `mouth-anchor` | `CatscapadesGame` | read-only; carried props copy its world transform |

Two systems must never drive the same channel. If you need a new motion, add it
to the animator method that already owns that joint.

## Leg geometry

`CatLegRig` carries the numbers the IK solves against:

- `upperLength`, `lowerLength`, `footLength` — segment lengths. The meshes are
  built from these; changing one without the other desynchronises solver and
  silhouette.
- `paw` — terminal sole child. The IK counter-rotates it against the
  metapodial angle so planted feet do not inherit the hock's slope.
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

`ankleAngle` is `HIND_ANKLE_ANGLE` (0.64) or `FRONT_ANKLE_ANGLE` (0.14) from
`src/anim/leg-ik.ts`. A ratio near 1.0 gives a stiff, stilted stance; around
0.85–0.9 gives a relaxed cat.

## Gaits

`GAITS` in `src/anim/cat-animator.ts` defines creep, walk, trot, and gallop.
Selection is by smoothed speed with hysteresis; the leg phase offsets are
*interpolated* toward the new gait rather than switched, so transitions re-time
the same clock instead of popping.

- `stride` is distance per full cycle, and the cycle clock is an **odometer**:
  it advances by the ground the cat actually covered (`CatAnimationInput.travel`,
  measured after collision) plus `|turnRate| × PIVOT_STEP_RADIUS` for yaw. Speed
  never drives it directly, so pushing into a wall stops the legs and a pivot on
  the spot still costs steps.
- `duty` is the fraction of the cycle a foot is planted. Above 0.5 the gait has
  no suspension phase; the gallop's 0.34 does.
- `crouch` scales ride height; the creep's 0.66 is the stalk pose.

If feet skate, suspect the contact frame rather than the rate — see below.

## Ground contacts

A planted paw is not a body-space offset. `CatAnimator` keeps one `FootContact`
per leg holding the spot on the floor that sole is standing on, and recedes and
counter-rotates every contact each frame by the body's own travel and yaw. The
stance excursion is therefore **emergent**: it cannot disagree with the gait rate
because both come from the same odometer. Consequences:

- Contacts resolve through `rig.root` (position and facing only), never through
  `cat-body`. Routing them through the body would let ride height, bob, bank, and
  the weight-shift sway drag a planted sole around with the torso.
- Planted soles are pinned to `root.worldY + SOLE_CLEARANCE`; a swing paw is
  pinned to that plane plus its arc height. Airborne, sitting, sleeping, and
  swiping poses reduce `groundWeight`/raise `restWeight` and are placed in body
  space instead, because none of them is a claim on the floor.
- A paw plants when it *arrives* (`SWING_LAND`, at 86% of the swing) rather than
  at the phase boundary, so a swing only a few frames long does not touch down
  with a frame of residual skid.
- Foot authority comes from `strideActivity` — smoothed stride cycles per second
  — not from linear speed, or a pivot that covers no ground would have no
  authority to lift a paw. At zero activity the legs collapse onto `restTarget`
  so the cat squares up on all fours.
- After a teleport, `resetSecondaryMotion()` re-seats the contacts along with the
  tail. Skipping it leaves paws trying to stand on a floor the cat has left.

`footPlanted(index)` is true on the frame a leg takes the ground, for footfall
audio; `strideRate()` reports the odometer clock for the debug overlay.

## Braking and turning

`CatController` decides the two, and `CatAnimator` shows them:

- `CatFrameState.brake` is intent, not deceleration. It rises when the stick
  opposes travel or is released at speed; the controller's stop stays crisp
  because a stealth game needs precise placement. The animator braces on it —
  fore prints forward, hocks gathered, front track widened, swing lift cut so
  the paws scrub, body dropped and pitched over the stopping forepaws.
- Facing turns towards the **stick**, not towards current travel, and travel
  commits to the spine as speed builds (`commit`, 1.1→3.4 u/s). Speed is cut by
  up to 74% while the body is still swinging round. Without that the stick can
  reverse the velocity while the body lags, and the cat slides backwards facing
  forwards — sliding that ground contacts alone cannot fix.
- `turnStep` places the outside paws wide and forward and gathers the inside
  ones, and raises the outside swing arc, so the cat steps round its own axis.
  Outside is `leg.side * sign(smoothedTurn)`.

## Tail

`updateTail` simulates the chain in **world space** using fixed 120 Hz verlet
substeps and curvature relaxation, then back-solves each joint's local
quaternion. One tapered `tail-skin` surface is bound first to `tail-base` and
then across all 12 joints. The socket-weighted root ring stays buried in the
rump while the remaining surface follows the simulated curve continuously,
instead of exposing capsule seams. Consequences:

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
