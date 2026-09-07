import * as THREE from "three";
import type { CatRig } from "../models/cat";
import { solveLegLocal } from "./leg-ik";
import { clamp, damp, lerp, lerpPhase, shortestAngle, smoothstep, wobble } from "../core/math";

/**
 * Procedural cat animation.
 *
 * Nothing here is keyframed. Feet are placed by a gait clock and solved with
 * two-bone IK, the spine flexes from turn rate and gait harmonics, the head is
 * stabilised against body bob before looking at points of interest, and the
 * tail is a verlet chain that lags behind the pelvis. The result reads as a
 * real cat because the same causes drive it: momentum, footfall, and attention.
 *
 * Two rules keep the cat on the floor rather than skating over it:
 *
 *   1. The stride clock is an **odometer**, not a timer. It advances by the
 *      ground the cat actually covered — after Rapier resolved collisions —
 *      plus an allowance for yaw, so pushing into a wall stops the legs and
 *      turning on the spot produces pivot steps.
 *   2. A planted paw is stored as a **ground contact**, not as a body-space
 *      offset. Every frame each stored contact is receded and counter-rotated
 *      by the body's own motion, so a stance paw holds its spot on the floor
 *      while the torso travels over it. The stance excursion is therefore
 *      emergent rather than authored, and cannot disagree with the gait rate.
 */

export type CatGaitName = "creep" | "walk" | "trot" | "gallop";

export interface CatAnimationInput {
  /** Planar speed in world units per second. */
  speed: number;
  /** Signed yaw rate in radians per second. */
  turnRate: number;
  /** Forward acceleration in units per second squared. */
  acceleration: number;
  /**
   * Planar ground distance actually covered this frame, or `null` to derive it
   * from `speed`. The stride clock runs on this, so a cat walking into a
   * cupboard stops stepping while its commanded speed stays high. Isolated
   * review clips leave it `null` and run on a treadmill.
   */
  travel: number | null;
  /**
   * How hard the cat is arresting its momentum, 0..1. Drives the brace: fore
   * paws planted out in front, hocks gathered under, weight back, feet held
   * low and scrubbing rather than lifting.
   */
  brake: number;
  /** Crouched, deliberate movement. */
  stalking: boolean;
  /** 0 grounded, 1 fully airborne. */
  airborne: number;
  /**
   * Coil before a leap, 0..1. The cat is still on the floor: haunches down,
   * spine loaded, hind paws drawn under the hips, gaze locked on the landing.
   */
  gather: number;
  /** 0 at take-off, 1 at touchdown. Only meaningful while `airborne > 0`. */
  jumpProgress: number;
  /** 0 idle, 1 at the peak of a paw strike. */
  swipe: number;
  /** 0 closed, 1 mid-meow. */
  meow: number;
  /** Something is held in the mouth. */
  carrying: boolean;
  /** Curled-up "definitely asleep, definitely innocent" weight. */
  sleeping: number;
  /** Upright sit weight. */
  sitting: number;
  /** Ears-forward, tail-up interest, 0..1. */
  alert: number;
  /** World point to look at, or null for gaze-along-travel. */
  lookAt: THREE.Vector3 | null;
  /** 0..1 spike applied on touchdown, decayed by the caller. */
  landImpact: number;
  /**
   * 1 at front-paw contact falling to 0 once recovered. Carries the *timing* of
   * a landing where `landImpact` carries its force, which is what lets the
   * forepaws take the floor before the hind legs swing under.
   */
  landRecover: number;
}

export const NEUTRAL_CAT_ANIMATION: CatAnimationInput = {
  speed: 0,
  turnRate: 0,
  acceleration: 0,
  travel: null,
  brake: 0,
  stalking: false,
  airborne: 0,
  gather: 0,
  jumpProgress: 0,
  swipe: 0,
  meow: 0,
  carrying: false,
  sleeping: 0,
  sitting: 0,
  alert: 0,
  lookAt: null,
  landImpact: 0,
  landRecover: 0,
};

interface GaitProfile {
  readonly name: CatGaitName;
  /** Phase offsets per leg, in `CatRig.legs` order. */
  readonly offsets: readonly [number, number, number, number];
  /** Fraction of the cycle a foot spends planted. */
  readonly duty: number;
  /** Distance covered per full cycle, in world units. */
  readonly stride: number;
  /** Peak swing height. */
  readonly lift: number;
  /** Vertical body bob amplitude. */
  readonly bob: number;
  /** Bobs per cycle. */
  readonly bobHarmonic: number;
  /** Sagittal spine flexion amplitude (the gallop arch). */
  readonly flex: number;
  /** Ride-height multiplier. */
  readonly crouch: number;
}

const GAITS: Readonly<Record<CatGaitName, GaitProfile>> = {
  creep: {
    name: "creep",
    offsets: [0, 0.3, 0.5, 0.8],
    duty: 0.8,
    stride: 0.3,
    lift: 0.028,
    bob: 0.006,
    bobHarmonic: 2,
    flex: 0.02,
    crouch: 0.66,
  },
  walk: {
    name: "walk",
    offsets: [0, 0.25, 0.5, 0.75],
    duty: 0.66,
    stride: 0.42,
    lift: 0.05,
    bob: 0.012,
    bobHarmonic: 2,
    flex: 0.035,
    crouch: 1,
  },
  trot: {
    name: "trot",
    offsets: [0, 0.5, 0.5, 0],
    duty: 0.5,
    stride: 0.6,
    lift: 0.082,
    bob: 0.028,
    bobHarmonic: 2,
    flex: 0.06,
    crouch: 1.02,
  },
  gallop: {
    name: "gallop",
    offsets: [0, 0.44, 0.11, 0.56],
    duty: 0.34,
    stride: 1.05,
    lift: 0.13,
    bob: 0.055,
    bobHarmonic: 1,
    flex: 0.22,
    crouch: 0.94,
  },
};

const WALK_TO_TROT = 2.05;
const TROT_TO_GALLOP = 4.3;
const GAIT_HYSTERESIS = 0.45;

/**
 * Effective radius a paw swings through when the cat yaws. Turning contributes
 * this much arc length per radian to the stride odometer, which is what turns a
 * standing pivot into visible steps instead of a silent body spin. It is set
 * well above the geometric paw radius (~0.24) deliberately: on a pivot all four
 * feet have to be repositioned rather than one pair passing the other, so the
 * geometric value leaves each paw holding through ~50 degrees of yaw and the
 * cat ends up doing the splits.
 */
const PIVOT_STEP_RADIUS = 0.55;
/**
 * Ignore a single frame's travel beyond this. A stalled frame can legitimately
 * carry eight fixed steps of a scampering cat; a teleport carries metres.
 */
const MAX_FRAME_TRAVEL = 1;
/** Clearance held between a planted sole and the floor plane. */
const SOLE_CLEARANCE = 0.004;
/**
 * Fraction of the swing phase spent travelling. The paw reaches its print a
 * little early and takes the ground there, rather than still converging when
 * the phase boundary arrives — which is what stops a short swing from planting
 * with a frame of residual skid.
 */
const SWING_LAND = 0.86;

/**
 * A paw's ground contact, carried in body space and receded every frame by the
 * body's own motion. While the leg is in stance this is the fixed spot on the
 * floor the sole is standing on; through swing it is the spot the paw left,
 * which keeps receding so the swing reads as leaving ground behind.
 */
interface FootContact {
  x: number;
  z: number;
  /** Whether the paw was carrying weight last frame, for plant/lift edges. */
  down: boolean;
  /** Set on the frame the paw plants, for footfall audio. */
  planted: boolean;
}

export class CatAnimator {
  private gait: GaitProfile = GAITS.walk;
  private readonly legPhaseOffsets: number[];
  private cycle = 0;
  private strideRateValue = 0;
  private strideActivity = 0;
  private readonly contacts: FootContact[];

  private bodyLift: number;
  private bodyPitch = 0;
  private bodyRoll = 0;
  private pelvisRoll = 0;
  private chestRoll = 0;
  private spineYaw = 0;
  private spineFlex = 0;
  private headYaw = 0;
  private headPitch = 0;
  private earAlert = 0;
  private crouchWeight = 0;
  private sitWeight = 0;
  private sleepWeight = 0;
  private carryWeight = 0;
  private braceWeight = 0;
  private coilWeight = 0;
  private breath = 0;
  private blinkTimer = 1.6;
  private blink = 0;
  private time = 0;
  private smoothedSpeed = 0;
  private smoothedTurn = 0;
  private smoothedAccel = 0;

  private readonly tailPoints: THREE.Vector3[] = [];
  private readonly tailPrevious: THREE.Vector3[] = [];
  private tailInitialised = false;
  private tailAccumulator = 0;

  private readonly scratchWorld = new THREE.Vector3();
  private readonly scratchRootWorld = new THREE.Vector3();
  private readonly scratchGround = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchDesired = new THREE.Vector3();
  private readonly scratchMidpoint = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchParentQuaternion = new THREE.Quaternion();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly headWorld = new THREE.Vector3();
  private readonly lookLocal = new THREE.Vector3();

  constructor(private readonly rig: CatRig) {
    // Start from the authored bind pose. Initialising at zero caused the first
    // animation frame to collapse the torso onto the floor before recovering.
    this.bodyLift = rig.standHeight;
    this.legPhaseOffsets = rig.legs.map((leg) => leg.phaseOffset);
    this.contacts = rig.legs.map((leg) => ({
      x: leg.restTarget.x,
      z: leg.restTarget.z,
      down: true,
      planted: false,
    }));
  }

  /** Current gait name, for the debug overlay. */
  currentGait(): CatGaitName {
    return this.gait.name;
  }

  /** Normalised gait clock, for footfall audio triggers. */
  gaitCycle(): number {
    return this.cycle;
  }

  /**
   * Stride cycles per second on the odometer clock. Zero whenever the cat is
   * not covering ground, however hard it is pushing — the readout the debug
   * overlay uses to show that the legs are driven by travel, not by throttle.
   */
  strideRate(): number {
    return this.strideRateValue;
  }

  /** True on the frame a given leg plants. Used for step sounds. */
  update(dt: number, input: CatAnimationInput): void {
    if (dt <= 0) return;
    this.time += dt;

    this.smoothedSpeed = damp(this.smoothedSpeed, input.speed, 12, dt);
    this.smoothedTurn = damp(this.smoothedTurn, clamp(input.turnRate, -6, 6), 9, dt);
    this.smoothedAccel = damp(this.smoothedAccel, clamp(input.acceleration, -18, 18), 7, dt);

    this.selectGait(input);
    this.advanceCycle(dt, input);
    this.updatePoseWeights(dt, input);
    this.updateBody(dt, input);
    this.updateSpine(dt, input);
    this.updateLegs(input);
    this.updateHead(dt, input);
    this.updateFace(dt, input);
    this.updateTail(dt, input);
  }

  /** True on the frame the given leg planted. Used for step sounds. */
  footPlanted(index: number): boolean {
    return this.contacts[index]?.planted ?? false;
  }

  /**
   * Re-seeds the tail simulation and the ground contacts after a teleport, so
   * neither the tail whips across the level nor a paw tries to stay planted on
   * a floor the cat is no longer standing on.
   */
  resetSecondaryMotion(): void {
    this.tailInitialised = false;
    this.tailAccumulator = 0;
    this.rig.legs.forEach((leg, index) => {
      const contact = this.contacts[index];
      if (!contact) return;
      contact.x = leg.restTarget.x;
      contact.z = leg.restTarget.z;
      contact.down = true;
      contact.planted = false;
    });
  }

  // -- gait ------------------------------------------------------------------

  private selectGait(input: CatAnimationInput): void {
    const speed = this.smoothedSpeed;
    let next: GaitProfile;
    if (input.stalking) {
      next = GAITS.creep;
    } else if (this.gait.name === "gallop") {
      next = speed > TROT_TO_GALLOP - GAIT_HYSTERESIS ? GAITS.gallop : GAITS.trot;
    } else if (this.gait.name === "trot") {
      if (speed > TROT_TO_GALLOP) next = GAITS.gallop;
      else if (speed < WALK_TO_TROT - GAIT_HYSTERESIS) next = GAITS.walk;
      else next = GAITS.trot;
    } else {
      if (speed > TROT_TO_GALLOP) next = GAITS.gallop;
      else if (speed > WALK_TO_TROT) next = GAITS.trot;
      else next = GAITS.walk;
    }
    this.gait = next;
  }

  private advanceCycle(dt: number, input: CatAnimationInput): void {
    // Blend each leg towards the active gait's offsets so gait changes are a
    // re-timing of the same clock rather than a visible pop.
    const blend = 1 - Math.exp(-6 * dt);
    for (let index = 0; index < this.legPhaseOffsets.length; index += 1) {
      const current = this.legPhaseOffsets[index] ?? 0;
      const target = this.gait.offsets[index] ?? 0;
      this.legPhaseOffsets[index] = lerpPhase(current, target, blend);
    }

    // The clock is an odometer. `travel` is the distance Rapier actually let the
    // cat cover, so walking into a cupboard advances nothing and the legs stop
    // rather than running on the spot. Yaw contributes arc length, which is
    // what makes a turn cost steps instead of spinning the body over still paws.
    const grounded = 1 - clamp(input.airborne, 0, 1);
    const measured = input.travel ?? Math.max(0, input.speed) * dt;
    const forward = clamp(measured, 0, MAX_FRAME_TRAVEL);
    const yawArc = Math.abs(input.turnRate) * dt * PIVOT_STEP_RADIUS;
    const advance = (forward + yawArc) * grounded;

    if (advance > 1e-6) {
      this.strideRateValue = advance / this.gait.stride / dt;
      this.cycle = (this.cycle + advance / this.gait.stride) % 1;
    } else {
      // Settle the clock so the cat always comes to rest square on all fours.
      this.strideRateValue = 0;
      const settle = 1 - Math.exp(-7 * dt);
      this.cycle = (this.cycle + shortestAngle(this.cycle * Math.PI * 2, 0) / (Math.PI * 2) * settle + 1) % 1;
    }

    // Foot placement follows how briskly the cat is *stepping*, not how fast it
    // is translating — otherwise a pivot on the spot has no authority to lift a
    // paw. It rises promptly so the first step is not late, and falls gently so
    // the legs settle onto their rest targets instead of freezing mid-stride.
    const rising = this.strideRateValue > this.strideActivity;
    this.strideActivity = damp(this.strideActivity, this.strideRateValue, rising ? 20 : 8, dt);

    // Recede every stored contact by the body's own motion. A point fixed to
    // the floor rotates by the negative of the body's yaw and slides backwards
    // by the distance travelled, so replaying that here is what keeps a planted
    // sole on its spot while the torso passes over it.
    const yaw = input.turnRate * dt * grounded;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const contact of this.contacts) {
      const { x, z } = contact;
      contact.x = cos * x - sin * z;
      contact.z = sin * x + cos * z - forward * grounded;
    }
  }

  private updatePoseWeights(dt: number, input: CatAnimationInput): void {
    const crouchTarget = input.stalking ? 1 : 0;
    this.crouchWeight = damp(this.crouchWeight, crouchTarget, 8, dt);
    this.sitWeight = damp(this.sitWeight, input.sitting, 6, dt);
    this.sleepWeight = damp(this.sleepWeight, input.sleeping, 3.2, dt);
    this.carryWeight = damp(this.carryWeight, input.carrying ? 1 : 0, 7, dt);
    this.braceWeight = damp(this.braceWeight, clamp(input.brake, 0, 1), 11, dt);
    // The coil is owned by the controller's gather window, which is short and
    // fixed. Damping the rise would simply mean the cat never finishes loading
    // before it launches, so track the ramp directly and damp only the release.
    const coil = clamp(input.gather, 0, 1);
    this.coilWeight = coil >= this.coilWeight ? coil : damp(this.coilWeight, coil, 34, dt);
    this.earAlert = damp(this.earAlert, input.alert, 7, dt);
    this.breath += dt * (this.sleepWeight > 0.5 ? 1.5 : 2.4 + this.smoothedSpeed * 0.35);
  }

  // -- body ------------------------------------------------------------------

  private updateBody(dt: number, input: CatAnimationInput): void {
    const gait = this.gait;
    const motion = smoothstep(0.02, 0.9, this.smoothedSpeed);

    const bob = Math.sin(this.cycle * Math.PI * 2 * gait.bobHarmonic) * gait.bob * motion;
    const gallopDrop = gait.name === "gallop"
      ? -Math.max(0, Math.sin(this.cycle * Math.PI * 2 - 0.9)) * 0.03 * motion
      : 0;

    const airborneLift = input.airborne * 0.025;
    const landCrouch = -input.landImpact * 0.11;
    const idleBreath = Math.sin(this.breath) * 0.004 * (1 - motion);

    // A braking cat drops its hindquarters and gets its weight behind the
    // stopping forepaws, rather than gliding to a halt at ride height.
    const braceDrop = -this.braceWeight * 0.026;
    // The coil sinks the whole cat onto its hocks; the launch releases it.
    const coilDrop = -this.coilWeight * 0.08;
    const rideScale = lerp(1, gait.crouch, this.crouchWeight * 0.85 + (gait.name === "creep" ? 0.15 : 0));
    // A sit lowers the haunches while the pitched body and flexed spine keep
    // the chest upright. A loaf settles the sternum almost onto the floor;
    // its folded limbs are then hidden by the continuous chest/haunch skins.
    const sitLift = -this.sitWeight * 0.09;
    const sleepDrop = -this.sleepWeight * 0.17;

    const height = this.rig.standHeight * rideScale + bob + gallopDrop + airborneLift
      + landCrouch + idleBreath + sitLift + sleepDrop + braceDrop + coilDrop;
    this.bodyLift = damp(this.bodyLift, height, 22, dt);
    this.rig.body.position.y = this.bodyLift;

    // Lean into acceleration, dip on landing, and stretch out mid-flight.
    const accelPitch = clamp(-this.smoothedAccel * 0.012, -0.16, 0.16);
    const flightPitch = input.airborne * lerp(-0.18, 0.16, clamp(input.jumpProgress, 0, 1));
    const landPitch = input.landImpact * 0.22;
    const restPitch = -this.sitWeight * 0.24 + this.sleepWeight * 0.018;
    const targetPitch = accelPitch + flightPitch + landPitch + restPitch
      + this.braceWeight * 0.06 - this.coilWeight * 0.07
      + Math.sin(this.cycle * Math.PI * 2) * gait.flex * 0.35 * motion;
    this.bodyPitch = damp(this.bodyPitch, targetPitch, 14, dt);
    this.rig.body.rotation.x = this.bodyPitch;

    // Bank into turns: the whole body rolls before the spine curves.
    const targetRoll = clamp(-this.smoothedTurn * 0.075 * smoothstep(0.3, 2.6, this.smoothedSpeed), -0.24, 0.24)
      + this.sleepWeight * 0.02;
    this.bodyRoll = damp(this.bodyRoll, targetRoll, 9, dt);
    this.rig.body.rotation.z = this.bodyRoll;

    const sway = Math.sin(this.cycle * Math.PI * 2) * 0.012 * motion * (gait.name === "gallop" ? 0.3 : 1);
    this.rig.body.position.x = damp(this.rig.body.position.x, sway, 16, dt);
  }

  private updateSpine(dt: number, input: CatAnimationInput): void {
    const gait = this.gait;
    const motion = smoothstep(0.02, 1.1, this.smoothedSpeed);

    // Lateral curve: head/chest lead and the pelvis follows, producing the
    // liquid comma silhouette that is characteristic of a turning cat.
    const gaitYaw = Math.sin(this.cycle * Math.PI * 2) * 0.022 * motion
      * (gait.name === "gallop" ? 0.25 : 1);
    const targetYaw = clamp(this.smoothedTurn * 0.115, -0.32, 0.32)
      + gaitYaw + this.sleepWeight * 0.12;
    this.spineYaw = damp(this.spineYaw, targetYaw, 8, dt);
    this.rig.spineLower.rotation.y = this.spineYaw * 0.45;
    this.rig.spineUpper.rotation.y = this.spineYaw * 0.55;

    // Sagittal flexion alternates compression and extension. Because the coat
    // is skinned to these bones, this now changes the silhouette instead of
    // merely rotating hidden joints inside a rigid barrel.
    const arch = Math.cos(this.cycle * Math.PI * 2 + 0.35) * gait.flex * motion;
    const jump = clamp(input.jumpProgress, 0, 1);
    const flightArch = input.airborne * (
      lerp(0.16, -0.16, smoothstep(0.08, 0.58, jump))
      + smoothstep(0.72, 1, jump) * 0.15
    );
    const target = arch + flightArch + this.crouchWeight * 0.1
      - this.sitWeight * 0.34 + this.sleepWeight * 0.08 - this.braceWeight * 0.13
      // Loading the spine is what makes the launch look like stored energy
      // rather than a sudden change of altitude.
      + this.coilWeight * 0.26
      // …and the forequarters absorb through it on the way back down.
      + input.landRecover * input.landImpact * 0.2;
    this.spineFlex = damp(this.spineFlex, target, 15, dt);
    this.rig.spineLower.rotation.x = this.spineFlex * 0.55;
    this.rig.spineUpper.rotation.x = this.spineFlex * 0.45;
    this.rig.pelvis.rotation.x = -this.spineFlex * 0.16 - this.sitWeight * 0.18;

    const gaitRoll = Math.sin(this.cycle * Math.PI * 2) * (gait.name === "walk" ? 0.055 : 0.035) * motion;
    const targetPelvisRoll = gaitRoll - this.smoothedTurn * 0.018;
    this.pelvisRoll = damp(this.pelvisRoll, targetPelvisRoll, 12, dt);
    this.chestRoll = damp(this.chestRoll, -targetPelvisRoll * 0.72, 12, dt);
    this.rig.pelvis.rotation.z = this.pelvisRoll;

    // Shoulder counter-roll plus the action-specific swipe twist.
    const swipeTwist = Math.sin(input.swipe * Math.PI) * 0.42;
    this.rig.chest.rotation.z = damp(this.rig.chest.rotation.z, this.chestRoll + swipeTwist, 16, dt);
    this.rig.chest.rotation.y = damp(this.rig.chest.rotation.y, -swipeTwist * 0.5, 16, dt);

    const breathScale = 1 + Math.sin(this.breath) * 0.012 * (1 - motion * 0.75);
    this.rig.ribcage.scale.set(1 + (breathScale - 1) * 0.55, breathScale, 1);
  }

  // -- legs ------------------------------------------------------------------

  private updateLegs(input: CatAnimationInput): void {
    const gait = this.gait;
    // How much authority the gait has over foot placement. At a standstill the
    // legs collapse onto their rest targets so the cat squares up on all fours
    // instead of freezing mid-step; any real stepping rate is fully gaited,
    // including a pivot that covers no ground at all.
    const gaitWeight = smoothstep(0.04, 0.35, this.strideActivity);
    // Braking scrubs: the paws stay low and hold the floor instead of lifting
    // clear. Stepping round a hard turn does the opposite on the outside legs.
    const brace = this.braceWeight * gaitWeight;
    const turnStep = smoothstep(1, 4, Math.abs(this.smoothedTurn)) * gaitWeight;
    const turnSign = Math.sign(this.smoothedTurn);
    const lift = gait.lift * gaitWeight * (1 - brace * 0.45);
    /** Ground the body covers while one paw is planted, early landing included. */
    const stanceSpan = gait.stride * (gait.duty + (1 - gait.duty) * (1 - SWING_LAND));
    /** Ground covered while a paw is travelling to its next print. */
    const swingSpan = gait.stride * (1 - gait.duty) * SWING_LAND;
    const airborne = clamp(input.airborne, 0, 1);
    const rideHeight = this.rig.body.position.y;
    const restWeight = Math.max(this.sitWeight, this.sleepWeight);

    // Parent bones were just flexed by `updateSpine`; refresh them before
    // converting body-space paw contacts into each articulated leg root.
    this.rig.body.updateWorldMatrix(true, true);
    this.rig.root.getWorldPosition(this.scratchRootWorld);

    this.rig.legs.forEach((leg, index) => {
      const phase = (this.cycle + (this.legPhaseOffsets[index] ?? 0)) % 1;
      const stance = phase < gait.duty;
      const t = stance ? phase / gait.duty : (phase - gait.duty) / (1 - gait.duty);
      // Normalised progress through the swing's travelling portion. Past 1 the
      // paw has already taken the ground and is waiting out the phase.
      const swingT = stance ? 1 : t / SWING_LAND;
      const down = stance || swingT >= 1;
      const contact = this.contacts[index] ?? {
        x: leg.restTarget.x, z: leg.restTarget.z, down: true, planted: false,
      };

      // Where this paw wants to land: half a stance span ahead of its rest
      // target, so the body passes over the print rather than dragging it back.
      // Which side of the turn this leg is on: +1 outside, -1 inside.
      const outside = leg.side * turnSign;
      const printX = leg.restTarget.x
        + this.coilWeight * leg.side * 0.012
        // Inside legs shorten and outside legs reach while turning.
        + this.smoothedTurn * 0.014 * leg.side * (leg.isFront ? 1.2 : 0.8)
        // A deliberate turning step: the outside paws are placed wide and the
        // inside paws gather, so the cat steps round its own axis instead of
        // being rotated on the spot.
        + turnStep * 0.03 * outside * (leg.isFront ? 1 : 0.7)
        // Braking widens the front track for a stable stop.
        + (leg.isFront ? brace * 0.022 * leg.side : 0);
      const printZ = leg.restTarget.z + stanceSpan * 0.5 * gaitWeight
        // Front paws reach further at speed, hind legs tuck under the belly.
        + (leg.isFront ? gaitWeight * 0.03 : -this.crouchWeight * 0.04)
        // The outside foreleg reaches around the corner; the inside one is
        // pulled back out of the way of the pivot.
        + turnStep * 0.045 * outside * (leg.isFront ? 1 : -0.4)
        // The brace: forepaws stop the cat out in front, hocks gather under it.
        + (leg.isFront ? brace * 0.07 : -brace * 0.05)
        // The coil draws the hind paws in under the hips to push from, and
        // eases the forepaws back out of the way.
        + this.coilWeight * (leg.isFront ? -0.035 : 0.085);

      contact.planted = false;
      if (airborne > 0.5) {
        // Nothing is standing on anything. Hold the prints so touchdown starts
        // from a clean stance instead of a contact left behind at take-off.
        contact.x = printX;
        contact.z = printZ;
        contact.down = false;
      } else if (down && !contact.down) {
        contact.x = printX;
        contact.z = printZ;
        contact.planted = true;
      } else if (down && this.coilWeight > 0.01) {
        // Gathering repositions the feet: a cat drawing itself together does
        // shuffle its hind paws under its hips rather than launching from
        // wherever they happened to be standing. Drag the contact rather than
        // re-planting it, so the sole scrabbles into place instead of jumping.
        const drag = this.coilWeight * 0.32;
        contact.x = lerp(contact.x, printX, drag);
        contact.z = lerp(contact.z, printZ, drag);
      } else if (down) {
        // A gait re-timing mid-stance (a walk becoming a gallop changes both
        // the stride and the duty) can recede a contact past what the limb can
        // hold. Drag it along the limit rather than snapping it to a new print:
        // a bounded slide in a rare case is far cheaper than a visible pop.
        const strayX = contact.x - printX;
        const strayZ = contact.z - printZ;
        const stray = Math.hypot(strayX, strayZ);
        const limit = stanceSpan * 1.1 + 0.05;
        if (stray > limit) {
          contact.x = printX + strayX * (limit / stray);
          contact.z = printZ + strayZ * (limit / stray);
        }
      }
      contact.down = down;

      let x: number;
      let z: number;
      let liftArc = 0;
      let curl = 0;

      if (down) {
        // The stance excursion is not authored: the paw simply holds its spot
        // and the receding contact carries it back under the moving body.
        x = contact.x;
        z = contact.z;
      } else {
        // Swing runs between the receding spot the paw left and the print it is
        // heading for, offset forward by the ground still to be covered before
        // touchdown. Both ends recede at the same rate, so the sole arrives with
        // no ground-relative speed left and plants instead of skidding.
        const remaining = (1 - swingT) * swingSpan * gaitWeight;
        const eased = swingT * swingT * (3 - 2 * swingT);
        x = lerp(contact.x, printX, eased);
        z = lerp(contact.z, printZ + remaining, eased);
        liftArc = Math.sin(Math.pow(swingT, 0.85) * Math.PI) * lift
          * (1 + turnStep * 0.55 * Math.max(0, outside));
        curl = Math.sin(swingT * Math.PI) * 0.36;
      }

      // Collapse onto the rest target as the cat comes to a halt — but a
      // coiling cat has come to a halt on purpose, and its stance is the point.
      const settled = Math.max(gaitWeight, this.coilWeight);
      x = lerp(leg.restTarget.x, x, settled);
      z = lerp(leg.restTarget.z, z, settled);

      // The locomotion contact, kept aside before the pose overrides below
      // reshape `x`/`z` for a sit, a loaf, a tuck, or a paw strike.
      const groundX = x;
      const groundZ = z;
      /** How much of this paw's placement is a claim on the floor. */
      let groundWeight = 1;

      let y = -rideHeight + liftArc;

      if (input.airborne > 0.01) {
        const flight = input.airborne;
        const progress = clamp(input.jumpProgress, 0, 1);
        if (leg.isFront) {
          // Tucked under the chest off the floor, then unfolding forward and
          // reaching down so the forepaws arrive first.
          const folded = 1 - smoothstep(0, 0.3, progress);
          const extend = smoothstep(0.16, 0.78, progress);
          z = lerp(z, leg.restTarget.z - folded * 0.055 + extend * 0.235, flight);
          y = lerp(y, -rideHeight + 0.155 * (1 - smoothstep(0.34, 0.96, progress)), flight);
          curl = lerp(curl, folded * 0.42, flight);
        } else {
          // Driven straight out behind at take-off — that extension *is* the
          // push — then folded up under the belly and swung forward to land.
          const push = 1 - smoothstep(0, 0.26, progress);
          const fold = smoothstep(0.18, 0.62, progress);
          const swing = smoothstep(0.68, 1, progress);
          z = lerp(z, leg.restTarget.z - push * 0.135 + fold * 0.185 - swing * 0.045, flight);
          y = lerp(y, -rideHeight + fold * 0.15 - swing * 0.115, flight);
          curl = lerp(curl, (1 - push) * fold * 0.3, flight);
        }
        groundWeight *= 1 - flight;
      }

      // Landing, in order: the forepaws are already down and taking the impact
      // while the hind legs are still folded, and only then swing under and
      // plant. Landing on all fours at once is the tell of a canned jump.
      if (input.landRecover > 0.01) {
        const settling = input.landRecover;
        if (leg.isFront) {
          // Splayed and pressed: the forelimbs are the shock absorber.
          x = lerp(x, x + leg.side * 0.024, settling);
        } else {
          const trailing = smoothstep(0.52, 1, settling);
          z = lerp(z, leg.restTarget.z + 0.1, trailing);
          y = lerp(y, -rideHeight + 0.062, trailing);
          curl = lerp(curl, 0.2, trailing);
          groundWeight *= 1 - trailing;
        }
      }

      if (this.sitWeight > 0.01) {
        const seated = this.sitWeight;
        if (leg.isFront) {
          z = lerp(z, 0.255, seated);
          x = lerp(x, leg.side * 0.074, seated);
          y = lerp(y, -rideHeight, seated);
        } else {
          z = lerp(z, -0.085, seated);
          x = lerp(x, leg.side * 0.105, seated);
          y = lerp(y, -rideHeight + 0.002, seated);
        }
        curl = lerp(curl, leg.isFront ? 0 : 0.11, seated);
      }

      if (this.sleepWeight > 0.01) {
        const asleep = this.sleepWeight;
        // In a loaf the forepaws fold just behind the wrist line and the hind
        // feet disappear beneath the flank. Targets stay far enough from the
        // roots that the upper segments never solve upwards through the coat.
        z = lerp(z, leg.isFront ? 0.265 : -0.205, asleep);
        x = lerp(x, leg.side * (leg.isFront ? 0.02 : 0.028), asleep);
        y = lerp(y, -rideHeight + 0.004, asleep);
        curl = lerp(curl, leg.isFront ? 0.14 : 0.18, asleep);
      }

      // A paw strike lifts the near-front leg out of the gait entirely.
      if (input.swipe > 0.01 && leg.id === "front-left") {
        const strike = Math.sin(input.swipe * Math.PI);
        z = lerp(z, leg.restTarget.z + 0.24, strike);
        y = lerp(y, -rideHeight + 0.24, strike);
        x = lerp(x, leg.restTarget.x + 0.05, strike);
        curl = lerp(curl, 0.34, strike);
        groundWeight *= 1 - strike;
      }

      leg.root.rotation.z = -leg.side * this.smoothedTurn * 0.012;
      leg.root.updateWorldMatrix(true, false);
      this.scratchTarget.set(x, y, z);
      this.rig.body.localToWorld(this.scratchTarget);
      const floorY = this.scratchRootWorld.y + SOLE_CLEARANCE;
      // Resting poses pitch the torso around its centre. Pin their contacts to
      // the actual support plane so that raising the seated chest does not lift
      // the forepaws (or drive the tucked hind paws below the floor).
      if (restWeight > 0.001) {
        this.scratchTarget.y = lerp(this.scratchTarget.y, floorY, restWeight);
      }
      // A locomotion contact is a fact about the floor, so resolve it in the
      // root frame — which carries only position and facing. Routing it through
      // the body instead would let the torso's ride height, bob, bank, and
      // weight-shift sway drag a planted sole around with them, which is most
      // of the residual skate a body-space stance cannot avoid.
      const ground = clamp(groundWeight * (1 - restWeight) * (1 - airborne), 0, 1);
      if (ground > 0.001) {
        this.scratchGround.set(groundX, 0, groundZ);
        this.rig.root.localToWorld(this.scratchGround);
        this.scratchGround.y = floorY + liftArc;
        this.scratchTarget.lerp(this.scratchGround, ground);
      }
      leg.root.worldToLocal(this.scratchTarget);
      solveLegLocal(leg, this.scratchTarget.x, this.scratchTarget.y, this.scratchTarget.z, curl);
      // `solveLegLocal` plants the sole relative to the leg root. Seated roots
      // inherit the steep chest/pelvis pitch, so counter it at the terminal
      // paw to keep the toes resting on their pads rather than pointing up.
      const rootPitch = leg.isFront
        ? this.bodyPitch + this.spineFlex
        : this.bodyPitch + this.rig.pelvis.rotation.x;
      leg.paw.rotation.x -= rootPitch * restWeight;
      leg.paw.rotation.z = -leg.upper.rotation.z * restWeight;

      if (leg.isFront) {
        const scapula = leg.side < 0 ? this.rig.scapulaLeft : this.rig.scapulaRight;
        const swing = stance ? 0 : Math.sin(t * Math.PI);
        const strideTravel = stance ? 0.5 - t : t - 0.5;
        scapula.position.set(
          leg.side * 0.113,
          0.108 + swing * 0.012 + this.crouchWeight * 0.008,
          0.005 - strideTravel * 0.035,
        );
        scapula.rotation.x = -0.12 + strideTravel * 0.38;
        scapula.rotation.z = leg.side * (-0.08 + swing * 0.035);
      }
    });
  }

  // -- head, face, tail ------------------------------------------------------

  private updateHead(dt: number, input: CatAnimationInput): void {
    let targetYaw = 0;
    let targetPitch = 0;

    if (input.lookAt) {
      this.rig.head.getWorldPosition(this.headWorld);
      this.scratchMatrix.copy(this.rig.neck.matrixWorld).invert();
      this.lookLocal.copy(input.lookAt).applyMatrix4(this.scratchMatrix);
      targetYaw = clamp(Math.atan2(this.lookLocal.x, this.lookLocal.z), -0.75, 0.75);
      targetPitch = clamp(-Math.atan2(this.lookLocal.y, Math.hypot(this.lookLocal.x, this.lookLocal.z)), -0.5, 0.55);
    } else {
      // Idle attention drift: a cat is rarely looking at nothing.
      targetYaw = wobble(this.time * 0.35, 3.1) * 0.16 * (1 - smoothstep(0.4, 2, this.smoothedSpeed));
      targetPitch = wobble(this.time * 0.29, 7.7) * 0.08;
    }

    // Counter the body's bob and pitch so the head stays level — cats stabilise
    // their gaze far more than their body.
    targetPitch -= this.bodyPitch * 0.72 + this.spineFlex * 0.4;
    targetYaw -= this.spineYaw * 0.45;
    targetYaw += this.smoothedTurn * 0.06;

    targetPitch += this.crouchWeight * 0.2 + this.carryWeight * 0.24 - input.meow * 0.45;
    // A coiling cat holds its head level and locked on: counter the sinking
    // haunches rather than following them down.
    targetPitch -= this.coilWeight * 0.16;
    targetPitch += this.sleepWeight * 0.4;
    targetYaw += this.sleepWeight * 0.28;

    const rate = input.lookAt ? 7 : 3.4;
    this.headYaw = damp(this.headYaw, targetYaw, rate, dt);
    this.headPitch = damp(this.headPitch, targetPitch, rate, dt);
    this.rig.head.rotation.set(this.headPitch, this.headYaw, -this.bodyRoll * 0.5 + this.sleepWeight * 0.07);
    this.rig.neck.rotation.x = damp(this.rig.neck.rotation.x, this.headPitch * 0.35 + this.carryWeight * 0.18, 8, dt);
    this.rig.neck.rotation.y = damp(this.rig.neck.rotation.y, this.sleepWeight * 0.08, 6, dt);
  }

  private updateFace(dt: number, input: CatAnimationInput): void {
    // Ears: forward when alert, swivelling idly, flattened while stalking.
    const forward = this.earAlert * 0.26 - this.crouchWeight * 0.42;
    const flatten = this.crouchWeight * 0.5 + this.sleepWeight * 0.35;
    for (const [ear, side, seed] of [
      [this.rig.earLeft, -1, 1.7],
      [this.rig.earRight, 1, 4.3],
    ] as const) {
      const twitch = wobble(this.time * 1.4, seed) * 0.06;
      ear.rotation.x = damp(ear.rotation.x, -0.08 - forward + twitch, 10, dt);
      ear.rotation.z = damp(ear.rotation.z, side * (-0.16 - flatten * 0.46) + twitch * side, 10, dt);
      ear.rotation.y = damp(ear.rotation.y, side * (this.earAlert * 0.1) + twitch * 0.5, 8, dt);
    }

    // Jaw: opens for a meow, stays shut with something in it.
    const jawOpen = input.meow * 0.42 - this.carryWeight * 0.04;
    this.rig.jaw.rotation.x = damp(this.rig.jaw.rotation.x, jawOpen, 18, dt);

    // Blinking, and a slow-blink while asleep.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = 1.8 + Math.abs(wobble(this.time, 9.4)) * 3.4;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const closed = Math.max(this.sleepWeight, Math.sin(clamp(this.blink, 0, 1) * Math.PI));
    const lidScale = lerp(0.02, 1.05, closed);
    for (const [eye, eyelid] of [
      [this.rig.eyeLeft, this.rig.eyelidLeft],
      [this.rig.eyeRight, this.rig.eyelidRight],
    ] as const) {
      eyelid.scale.y = lidScale;
      // Slide down from the upper rim along the cheek's tangent plane. A lid
      // scaled around the eye centre leaves a fur stripe across an open pupil.
      eyelid.position.set(0, 0.013 * (1 - closed), 0.0045)
        .applyQuaternion(eye.quaternion).add(eye.position);
    }

    // The iris stays seated in its socket; only the vertical pupil widens.
    // Scaling the lime eyeballs was the source of the old alert-state bulge.
    const dilation = 1 + this.earAlert * 0.9 + this.crouchWeight * 0.65;
    this.rig.pupilLeft.scale.x = 0.34 * dilation;
    this.rig.pupilRight.scale.x = 0.34 * dilation;
  }

  /**
   * Verlet chain in world space. Simulating the tail outside the body hierarchy
   * is what gives it real lag, overshoot, and counterbalance; the joints are
   * then back-solved so the mesh still lives under the rig.
   */
  private updateTail(dt: number, input: CatAnimationInput): void {
    const joints = this.rig.tailJoints;
    this.rig.tailBase.updateWorldMatrix(true, false);
    this.rig.tailBase.getWorldPosition(this.scratchWorld);
    this.rig.tailBase.getWorldQuaternion(this.scratchParentQuaternion);

    if (!this.tailInitialised || this.tailPoints.length !== joints.length + 1) {
      this.tailPoints.length = 0;
      this.tailPrevious.length = 0;
      for (let index = 0; index <= joints.length; index += 1) {
        const point = this.tailRestPoint(index, input, new THREE.Vector3());
        this.tailPoints.push(point);
        this.tailPrevious.push(point.clone());
      }
      this.tailInitialised = true;
      this.tailAccumulator = 0;
    }

    const root = this.tailPoints[0];
    const rootPrevious = this.tailPrevious[0];
    if (!root || !rootPrevious) return;

    // Fixed substeps make the same tail behave consistently in a 30, 60, or
    // 120 fps browser. Multiple relaxation passes remove the old right-angle
    // elbows while preserving delayed weight and overshoot.
    this.tailAccumulator = Math.min(1 / 12, this.tailAccumulator + Math.min(dt, 1 / 15));
    const fixedStep = 1 / 120;
    while (this.tailAccumulator >= fixedStep) {
      this.simulateTailStep(fixedStep, input);
      this.tailAccumulator -= fixedStep;
    }
    rootPrevious.copy(root);
    root.copy(this.scratchWorld);

    this.solveTailJoints(joints);
  }

  private simulateTailStep(step: number, input: CatAnimationInput): void {
    const root = this.tailPoints[0];
    const rootPrevious = this.tailPrevious[0];
    if (!root || !rootPrevious) return;
    rootPrevious.copy(root);
    root.copy(this.scratchWorld);

    const drag = Math.pow(0.82, step * 60);
    const gravity = 2.25 * (1 - this.earAlert * 0.42);
    for (let index = 1; index < this.tailPoints.length; index += 1) {
      const point = this.tailPoints[index];
      const previous = this.tailPrevious[index];
      if (!point || !previous) continue;
      const velocityX = (point.x - previous.x) * drag;
      const velocityY = (point.y - previous.y) * drag;
      const velocityZ = (point.z - previous.z) * drag;
      previous.copy(point);
      point.set(
        point.x + velocityX,
        point.y + velocityY - gravity * step * step,
        point.z + velocityZ,
      );

      const along = index / (this.tailPoints.length - 1);
      const poseMuscle = Math.max(this.sleepWeight, this.sitWeight) * 0.15;
      const muscle = 0.045 + this.earAlert * 0.028 + (1 - along) * 0.025 + poseMuscle;
      point.lerp(this.tailRestPoint(index, input, this.scratchDesired), muscle);
    }

    this.rig.root.getWorldPosition(this.scratchRootWorld);
    const floorY = this.scratchRootWorld.y + 0.014;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      root.copy(this.scratchWorld);
      for (let index = 1; index < this.tailPoints.length; index += 1) {
        const point = this.tailPoints[index];
        const parent = this.tailPoints[index - 1];
        if (!point || !parent) continue;
        this.constrainTailPoint(point, parent, floorY);
      }

      // Curvature relaxation behaves like muscle/fascia and prevents a single
      // bone from absorbing the whole bend as a sharp elbow.
      for (let index = 1; index < this.tailPoints.length - 1; index += 1) {
        const point = this.tailPoints[index];
        const before = this.tailPoints[index - 1];
        const after = this.tailPoints[index + 1];
        if (!point || !before || !after) continue;
        this.scratchMidpoint.addVectors(before, after).multiplyScalar(0.5);
        point.lerp(this.scratchMidpoint, 0.1);
      }
    }

    // The curvature pass above moves points off their exact segment radius.
    // Finish with one forward distance projection so no frame can leave a
    // stretched segment or a visible pinch in the skinned tail.
    root.copy(this.scratchWorld);
    for (let index = 1; index < this.tailPoints.length; index += 1) {
      const point = this.tailPoints[index];
      const parent = this.tailPoints[index - 1];
      if (!point || !parent) continue;
      this.constrainTailPoint(point, parent, floorY);
    }
  }

  /**
   * Projects one tail point to its exact bone length without invalidating that
   * length when it touches the floor. The previous post-projection y clamp
   * shortened grounded segments and let several joints bunch into one kink.
   */
  private constrainTailPoint(point: THREE.Vector3, parent: THREE.Vector3, floorY: number): void {
    const segment = this.rig.tailSegmentLength;
    this.scratchDirection.subVectors(point, parent);
    const distance = this.scratchDirection.length() || 1e-5;
    this.scratchDirection.multiplyScalar(segment / distance);

    if (parent.y + this.scratchDirection.y >= floorY) {
      point.copy(parent).add(this.scratchDirection);
      return;
    }

    const vertical = clamp(floorY - parent.y, -segment, segment);
    const horizontal = Math.sqrt(Math.max(0, segment * segment - vertical * vertical));
    const horizontalLength = Math.hypot(this.scratchDirection.x, this.scratchDirection.z);
    if (horizontalLength > 1e-5) {
      const scale = horizontal / horizontalLength;
      point.set(
        parent.x + this.scratchDirection.x * scale,
        parent.y + vertical,
        parent.z + this.scratchDirection.z * scale,
      );
    } else {
      point.set(parent.x + horizontal, parent.y + vertical, parent.z);
    }
  }

  /** Desired muscular carriage in tail-base local space, transformed to world. */
  private tailRestPoint(index: number, input: CatAnimationInput, target: THREE.Vector3): THREE.Vector3 {
    const count = Math.max(1, this.rig.tailJoints.length);
    const t = clamp(index / count, 0, 1);
    const length = this.rig.tailSegmentLength * count;
    const alert = this.earAlert;
    const low = this.crouchWeight;
    const pose = Math.max(this.sleepWeight, this.sitWeight);
    const tipLife = wobble(this.time * 0.85, 6.2) * (0.018 + alert * 0.025) * t * t;

    const neutral = new THREE.Vector3(
      -this.smoothedTurn * 0.012 * length * t * t + tipLife,
      length * (-0.9 * t + 0.2 * t * t + 0.25 * t * t * t)
        - low * length * 0.08 * t,
      -length * (0.965 * t - 0.055 * t * t),
    );
    const upright = new THREE.Vector3(
      length * 0.18 * Math.sin(t * Math.PI * 0.72) + tipLife * 0.6,
      length * (1.04 * t - 0.42 * t * t * t),
      -length * (0.46 * t + 0.08 * t * t),
    );
    neutral.lerp(upright, alert);
    neutral.y += input.airborne * length * Math.sin(t * Math.PI) * 0.18;
    // Coiling drops the tail low and straight behind, as a counterweight.
    neutral.y -= this.coilWeight * length * 0.22 * t;
    neutral.z -= this.coilWeight * length * 0.06 * t;

    if (pose > 0.001) {
      // Resting tails settle behind the haunch with a small lateral bow. This
      // arc is parameterised by length and never doubles back across the paws,
      // so the tapered skin keeps one clean silhouette from every camera.
      const restBlend = this.sitWeight / Math.max(pose, 1e-5);
      const arc = lerp(0.35, 0.5, restBlend);
      const angle = arc * t;
      const radius = length / arc;
      const along = Math.sin(angle);
      const across = 1 - Math.cos(angle);
      const wrapped = this.scratchTarget.set(
        radius * across,
        -radius * along * 0.46,
        -radius * along * 0.888,
      );
      neutral.lerp(wrapped, pose);
    }

    return target.copy(neutral).applyQuaternion(this.scratchParentQuaternion).add(this.scratchWorld);
  }

  /** Back-solves local bone rotations from the relaxed world-space curve. */
  private solveTailJoints(joints: readonly THREE.Object3D[]): void {
    this.rig.tailBase.getWorldQuaternion(this.scratchParentQuaternion);
    for (let index = 0; index < joints.length; index += 1) {
      const joint = joints[index];
      const from = this.tailPoints[index];
      const to = this.tailPoints[index + 1];
      if (!joint || !from || !to) continue;
      this.scratchDirection.subVectors(to, from);
      if (this.scratchDirection.lengthSq() < 1e-8) continue;
      this.scratchDirection.normalize();
      this.scratchQuaternion.setFromUnitVectors(FORWARD_NEGATIVE_Z, this.scratchDirection);
      joint.quaternion.copy(this.scratchParentQuaternion).invert().multiply(this.scratchQuaternion);
      this.scratchParentQuaternion.copy(this.scratchQuaternion);
    }
  }
}

const FORWARD_NEGATIVE_Z = new THREE.Vector3(0, 0, -1);
