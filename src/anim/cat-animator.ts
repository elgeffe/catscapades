import * as THREE from "three";
import type { CatRig } from "../models/cat";
import { solveLeg } from "./leg-ik";
import { clamp, damp, lerp, lerpPhase, shortestAngle, smoothstep, wobble } from "../core/math";

/**
 * Procedural cat animation.
 *
 * Nothing here is keyframed. Feet are placed by a gait clock and solved with
 * two-bone IK, the spine flexes from turn rate and gait harmonics, the head is
 * stabilised against body bob before looking at points of interest, and the
 * tail is a verlet chain that lags behind the pelvis. The result reads as a
 * real cat because the same causes drive it: momentum, footfall, and attention.
 */

export type CatGaitName = "creep" | "walk" | "trot" | "gallop";

export interface CatAnimationInput {
  /** Planar speed in world units per second. */
  speed: number;
  /** Signed yaw rate in radians per second. */
  turnRate: number;
  /** Forward acceleration in units per second squared. */
  acceleration: number;
  /** Crouched, deliberate movement. */
  stalking: boolean;
  /** 0 grounded, 1 fully airborne. */
  airborne: number;
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
}

export const NEUTRAL_CAT_ANIMATION: CatAnimationInput = {
  speed: 0,
  turnRate: 0,
  acceleration: 0,
  stalking: false,
  airborne: 0,
  jumpProgress: 0,
  swipe: 0,
  meow: 0,
  carrying: false,
  sleeping: 0,
  sitting: 0,
  alert: 0,
  lookAt: null,
  landImpact: 0,
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

export class CatAnimator {
  private gait: GaitProfile = GAITS.walk;
  private readonly legPhaseOffsets: number[];
  private cycle = 0;
  private cycleFrequency = 0;

  private bodyLift = 0;
  private bodyPitch = 0;
  private bodyRoll = 0;
  private spineYaw = 0;
  private spineFlex = 0;
  private headYaw = 0;
  private headPitch = 0;
  private earAlert = 0;
  private crouchWeight = 0;
  private sitWeight = 0;
  private sleepWeight = 0;
  private carryWeight = 0;
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

  private readonly scratchWorld = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchParentQuaternion = new THREE.Quaternion();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly headWorld = new THREE.Vector3();
  private readonly lookLocal = new THREE.Vector3();

  constructor(private readonly rig: CatRig) {
    this.legPhaseOffsets = rig.legs.map((leg) => leg.phaseOffset);
  }

  /** Current gait name, for the debug overlay. */
  currentGait(): CatGaitName {
    return this.gait.name;
  }

  /** Normalised gait clock, for footfall audio triggers. */
  gaitCycle(): number {
    return this.cycle;
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

  /** Re-seeds the tail simulation after a teleport so it does not whip. */
  resetSecondaryMotion(): void {
    this.tailInitialised = false;
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

    const moving = this.smoothedSpeed > 0.05 && input.airborne < 0.5;
    this.cycleFrequency = moving ? this.smoothedSpeed / this.gait.stride : 0;
    if (moving) {
      this.cycle = (this.cycle + this.cycleFrequency * dt) % 1;
    } else {
      // Settle the clock so the cat always comes to rest square on all fours.
      const settle = 1 - Math.exp(-7 * dt);
      this.cycle = (this.cycle + shortestAngle(this.cycle * Math.PI * 2, 0) / (Math.PI * 2) * settle + 1) % 1;
    }
  }

  private updatePoseWeights(dt: number, input: CatAnimationInput): void {
    const crouchTarget = input.stalking ? 1 : 0;
    this.crouchWeight = damp(this.crouchWeight, crouchTarget, 8, dt);
    this.sitWeight = damp(this.sitWeight, input.sitting, 6, dt);
    this.sleepWeight = damp(this.sleepWeight, input.sleeping, 3.2, dt);
    this.carryWeight = damp(this.carryWeight, input.carrying ? 1 : 0, 7, dt);
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

    const airborneLift = input.airborne * 0.045;
    const landCrouch = -input.landImpact * 0.11;
    const idleBreath = Math.sin(this.breath) * 0.004 * (1 - motion);

    const rideScale = lerp(1, gait.crouch, this.crouchWeight * 0.85 + (gait.name === "creep" ? 0.15 : 0));
    const sitLift = this.sitWeight * 0.055;
    const sleepDrop = -this.sleepWeight * 0.235;

    const height = this.rig.standHeight * rideScale + bob + gallopDrop + airborneLift
      + landCrouch + idleBreath + sitLift + sleepDrop;
    this.bodyLift = damp(this.bodyLift, height, 22, dt);
    this.rig.body.position.y = this.bodyLift;

    // Lean into acceleration, dip on landing, and stretch out mid-flight.
    const accelPitch = clamp(-this.smoothedAccel * 0.012, -0.16, 0.16);
    const flightPitch = input.airborne * lerp(-0.24, 0.2, clamp(input.jumpProgress, 0, 1));
    const landPitch = input.landImpact * 0.22;
    const sitPitch = this.sitWeight * -0.34;
    const targetPitch = accelPitch + flightPitch + landPitch + sitPitch
      + Math.sin(this.cycle * Math.PI * 2) * gait.flex * 0.35 * motion;
    this.bodyPitch = damp(this.bodyPitch, targetPitch, 14, dt);
    this.rig.body.rotation.x = this.bodyPitch;

    // Bank into turns: the whole body rolls before the spine curves.
    const targetRoll = clamp(-this.smoothedTurn * 0.075 * smoothstep(0.3, 2.6, this.smoothedSpeed), -0.24, 0.24)
      + this.sleepWeight * 0.5;
    this.bodyRoll = damp(this.bodyRoll, targetRoll, 9, dt);
    this.rig.body.rotation.z = this.bodyRoll;

    const sway = Math.sin(this.cycle * Math.PI * 2) * 0.012 * motion * (gait.name === "gallop" ? 0.3 : 1);
    this.rig.body.position.x = damp(this.rig.body.position.x, sway, 16, dt);
  }

  private updateSpine(dt: number, input: CatAnimationInput): void {
    const gait = this.gait;
    const motion = smoothstep(0.02, 1.1, this.smoothedSpeed);

    // Lateral curve: a turning cat bends like a comma, it does not pivot rigidly.
    const targetYaw = clamp(this.smoothedTurn * 0.11, -0.3, 0.3) + this.sleepWeight * 0.55;
    this.spineYaw = damp(this.spineYaw, targetYaw, 8, dt);
    this.rig.spineLower.rotation.y = this.spineYaw * 0.45;
    this.rig.spineUpper.rotation.y = this.spineYaw * 0.55;

    // Sagittal flexion: the gallop arch, plus a crouch hunch while stalking.
    const arch = Math.sin(this.cycle * Math.PI * 2 + 0.6) * gait.flex * motion;
    const flightArch = input.airborne * lerp(0.28, -0.18, clamp(input.jumpProgress, 0, 1));
    const target = arch + flightArch + this.crouchWeight * 0.12 + this.sitWeight * 0.26 + this.sleepWeight * 0.42;
    this.spineFlex = damp(this.spineFlex, target, 15, dt);
    this.rig.spineLower.rotation.x = this.spineFlex * 0.55;
    this.rig.spineUpper.rotation.x = this.spineFlex * 0.45;
    this.rig.pelvis.rotation.x = -this.spineFlex * 0.3 + this.sitWeight * 0.5;

    // Shoulder roll from the swipe, plus a breathing ribcage at rest.
    const swipeTwist = Math.sin(input.swipe * Math.PI) * 0.42;
    this.rig.chest.rotation.z = damp(this.rig.chest.rotation.z, swipeTwist, 16, dt);
    this.rig.chest.rotation.y = damp(this.rig.chest.rotation.y, -swipeTwist * 0.5, 16, dt);

    const breathScale = 1 + Math.sin(this.breath) * 0.022 * (1 - motion * 0.7);
    this.rig.ribcage.scale.set(0.98 * breathScale, 1.0 * breathScale, 1.26);
  }

  // -- legs ------------------------------------------------------------------

  private updateLegs(input: CatAnimationInput): void {
    const gait = this.gait;
    const motion = smoothstep(0.02, 0.7, this.smoothedSpeed);
    const sweep = gait.stride * gait.duty * motion;
    const lift = gait.lift * motion;
    const rideHeight = this.rig.body.position.y;

    this.rig.legs.forEach((leg, index) => {
      const phase = (this.cycle + (this.legPhaseOffsets[index] ?? 0)) % 1;
      const stance = phase < gait.duty;
      const t = stance ? phase / gait.duty : (phase - gait.duty) / (1 - gait.duty);

      let z = leg.restTarget.z;
      let y = -rideHeight;
      let x = leg.restTarget.x;

      if (stance) {
        z += sweep * (0.5 - t);
      } else {
        const eased = t * t * (3 - 2 * t);
        z += sweep * (-0.5 + eased * 1.06);
        y += Math.sin(Math.pow(t, 0.85) * Math.PI) * lift;
      }

      // Inside legs shorten and outside legs reach while turning.
      x += this.smoothedTurn * 0.014 * leg.side * (leg.isFront ? 1.2 : 0.8);
      // Front paws reach further at speed, hind legs tuck under the belly.
      if (leg.isFront) z += motion * 0.03;
      else z -= this.crouchWeight * 0.04;

      if (input.airborne > 0.01) {
        const tuck = input.airborne;
        const progress = clamp(input.jumpProgress, 0, 1);
        if (leg.isFront) {
          z = lerp(z, leg.restTarget.z + lerp(0.02, 0.2, progress), tuck);
          y = lerp(y, -rideHeight + lerp(0.2, 0.09, progress), tuck);
        } else {
          z = lerp(z, leg.restTarget.z - lerp(0.16, 0.06, progress), tuck);
          y = lerp(y, -rideHeight + lerp(0.16, 0.13, progress), tuck);
        }
      }

      if (this.sitWeight > 0.01) {
        const seated = this.sitWeight;
        if (leg.isFront) {
          z = lerp(z, leg.restTarget.z + 0.03, seated);
          y = lerp(y, -rideHeight, seated);
        } else {
          z = lerp(z, leg.restTarget.z + 0.09, seated);
          y = lerp(y, -rideHeight + 0.02, seated);
        }
      }

      if (this.sleepWeight > 0.01) {
        const asleep = this.sleepWeight;
        z = lerp(z, leg.restTarget.z * 0.45 + (leg.isFront ? 0.1 : -0.02), asleep);
        x = lerp(x, leg.restTarget.x * 0.35 + 0.06, asleep);
        y = lerp(y, -rideHeight + 0.02, asleep);
      }

      // A paw strike lifts the near-front leg out of the gait entirely.
      if (input.swipe > 0.01 && leg.id === "front-left") {
        const strike = Math.sin(input.swipe * Math.PI);
        z = lerp(z, leg.restTarget.z + 0.24, strike);
        y = lerp(y, -rideHeight + 0.24, strike);
        x = lerp(x, leg.restTarget.x + 0.05, strike);
      }

      const curl = stance ? 0 : Math.sin(t * Math.PI) * 0.5;
      solveLeg(leg, x, y, z, curl);
      leg.root.rotation.z = -leg.side * this.smoothedTurn * 0.012;
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
    targetPitch += this.sleepWeight * 0.55;
    targetYaw += this.sleepWeight * 0.7;

    const rate = input.lookAt ? 7 : 3.4;
    this.headYaw = damp(this.headYaw, targetYaw, rate, dt);
    this.headPitch = damp(this.headPitch, targetPitch, rate, dt);
    this.rig.head.rotation.set(this.headPitch, this.headYaw, -this.bodyRoll * 0.5 + this.sleepWeight * 0.3);
    this.rig.neck.rotation.x = damp(this.rig.neck.rotation.x, this.headPitch * 0.35 + this.carryWeight * 0.18, 8, dt);
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
      ear.rotation.x = damp(ear.rotation.x, -0.12 - forward + twitch, 10, dt);
      ear.rotation.z = damp(ear.rotation.z, side * (-0.2 - flatten * side * side * 0.6) + twitch * side, 10, dt);
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
    this.rig.eyelidLeft.scale.y = lidScale;
    this.rig.eyelidRight.scale.y = lidScale;

    // Pupils widen when alert or stalking.
    const dilation = 1 + this.earAlert * 0.16 + this.crouchWeight * 0.22;
    this.rig.eyeLeft.scale.set(dilation, dilation, 0.66);
    this.rig.eyeRight.scale.set(dilation, dilation, 0.66);
  }

  /**
   * Verlet chain in world space. Simulating the tail outside the body hierarchy
   * is what gives it real lag, overshoot, and counterbalance; the joints are
   * then back-solved so the mesh still lives under the rig.
   */
  private updateTail(dt: number, input: CatAnimationInput): void {
    const joints = this.rig.tailJoints;
    const segment = this.rig.tailSegmentLength;
    this.rig.tailBase.updateWorldMatrix(true, false);
    this.rig.tailBase.getWorldPosition(this.scratchWorld);

    if (!this.tailInitialised || this.tailPoints.length !== joints.length + 1) {
      this.tailPoints.length = 0;
      this.tailPrevious.length = 0;
      this.rig.tailBase.getWorldQuaternion(this.scratchParentQuaternion);
      this.scratchDirection.set(0, 0.25, -1).normalize().applyQuaternion(this.scratchParentQuaternion);
      for (let index = 0; index <= joints.length; index += 1) {
        const point = this.scratchWorld.clone().addScaledVector(this.scratchDirection, segment * index);
        this.tailPoints.push(point);
        this.tailPrevious.push(point.clone());
      }
      this.tailInitialised = true;
    }

    const root = this.tailPoints[0];
    const rootPrevious = this.tailPrevious[0];
    if (!root || !rootPrevious) return;
    rootPrevious.copy(root);
    root.copy(this.scratchWorld);

    // Rest carriage: up-and-back at ease, high when alert, low when stalking.
    this.rig.tailBase.getWorldQuaternion(this.scratchParentQuaternion);
    const carriage = lerp(0.05, 1.35, this.earAlert) - this.crouchWeight * 1.05 - this.sleepWeight * 0.8
      + input.airborne * 0.5;

    const gravity = -1.15 * (1 - this.earAlert * 0.45);
    const stiffness = 0.3 + this.earAlert * 0.2;
    const drag = 0.88;
    const step = clamp(dt, 0, 1 / 30);

    for (let index = 1; index < this.tailPoints.length; index += 1) {
      const point = this.tailPoints[index];
      const previous = this.tailPrevious[index];
      const parent = this.tailPoints[index - 1];
      if (!point || !previous || !parent) continue;

      // The rest direction curves along the chain, so the tail settles into an
      // S rather than a rigid pole. This is the single biggest tell that a
      // procedural tail is a simulation and not a stick.
      const along = index / this.tailPoints.length;
      this.scratchDirection
        .set(0, carriage + along * (0.9 + this.earAlert * 1.1) - along * along * 0.7, -1)
        .normalize()
        .applyQuaternion(this.scratchParentQuaternion);

      const velocityX = (point.x - previous.x) * drag;
      const velocityY = (point.y - previous.y) * drag;
      const velocityZ = (point.z - previous.z) * drag;
      previous.copy(point);
      point.x += velocityX;
      point.y += velocityY + gravity * step * step * 60;
      point.z += velocityZ;

      // Pull towards the rest pose so the tail has muscle, not just cloth.
      const restX = parent.x + this.scratchDirection.x * segment;
      const restY = parent.y + this.scratchDirection.y * segment;
      const restZ = parent.z + this.scratchDirection.z * segment;
      const blend = stiffness * (1 - (index - 1) / this.tailPoints.length * 0.55);
      point.x += (restX - point.x) * blend;
      point.y += (restY - point.y) * blend;
      point.z += (restZ - point.z) * blend;

      // Distance constraint keeps segments rigid.
      const dx = point.x - parent.x;
      const dy = point.y - parent.y;
      const dz = point.z - parent.z;
      const length = Math.hypot(dx, dy, dz) || 1e-5;
      const scale = segment / length;
      point.x = parent.x + dx * scale;
      point.y = parent.y + dy * scale;
      point.z = parent.z + dz * scale;
    }

    // Back-solve joint rotations: each joint's local -Z must follow the chain.
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
