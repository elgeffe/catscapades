import * as THREE from "three";
import type { OwnerRig } from "../models/owner";
import { solveTwoBone } from "./leg-ik";
import { clamp, damp, lerp, smoothstep, wobble } from "../core/math";

/**
 * Homeowner animation.
 *
 * The legs used to be two bones swung by a sine wave, which means the feet
 * were never anywhere in particular — they skated along the floor at whatever
 * rate the commanded speed dictated, and the ankles did nothing at all. A
 * mannequin walks like that. A person plants a heel, rolls over it, and pushes
 * off a toe, and does not slide.
 *
 * So the homeowner now borrows the same two rules as the cat:
 *
 *   1. The stride clock is an **odometer**, advancing on ground actually
 *      covered (plus an allowance for yaw, so turning costs steps). Walking
 *      into a doorframe stops the legs rather than running them on the spot.
 *   2. A planted foot is a **ground contact**, receded each frame by the body's
 *      own travel and yaw, so it holds its spot while the body passes over it.
 *
 * On top of that the ankle is real, so a step can go heel-strike → flat →
 * toe-off, and the vertical rise at toe-off is what reads as pushing rather
 * than being dragged.
 */

export interface OwnerAnimationInput {
  readonly speed: number;
  readonly turnRate: number;
  /**
   * Planar ground distance actually covered this frame, or `null` to derive it
   * from `speed`. Review clips leave it null and walk on a treadmill.
   */
  readonly travel: number | null;
  /** 0 calm, 1 alarmed. Drives posture, arm tension, and the alert mark. */
  readonly alarm: number;
  /** 0..1 weight for a surprised recoil. */
  readonly surprise: number;
  /** 0..1 weight for crouching to pick something (or someone) up. */
  readonly reaching: number;
  readonly carrying: boolean;
  readonly lookAt: THREE.Vector3 | null;
}

export const NEUTRAL_OWNER_ANIMATION: OwnerAnimationInput = {
  speed: 0, turnRate: 0, travel: null, alarm: 0, surprise: 0, reaching: 0,
  carrying: false, lookAt: null,
};

/** Ground covered per full stride cycle, both legs. */
const STRIDE = 1.42;
/** Fraction of the cycle a foot is planted. Above 0.5 both feet overlap. */
const DUTY = 0.62;
/** Fraction of the swing spent travelling; the foot lands a little early. */
const SWING_LAND = 0.88;
/** Effective radius a foot swings through when the body yaws. */
const PIVOT_STEP_RADIUS = 0.42;
/** Ignore a single frame's travel beyond this — a teleport is not a stride. */
const MAX_FRAME_TRAVEL = 1;
/**
 * How far the hips sit below the rig's bind height while standing.
 *
 * The bind pose has to close exactly — hips minus thigh minus shin minus ankle
 * puts the sole on the origin — which leaves the leg fully extended. A solver
 * cannot reach a fully extended target (it clamps just short, lifting the
 * sole), and a locked-straight leg reads as stilts anyway. A standing person
 * has a soft knee, so give them one.
 */
const STANDING_FLEX = 0.016;

/** A foot's ground contact, in hips space, receded every frame. */
interface Contact {
  x: number;
  z: number;
  down: boolean;
}

/** Cycle-driven walk with planted feet, heel-to-toe ankles, and turn steps. */
export class OwnerAnimator {
  private cycle = 0;
  private strideRateValue = 0;
  private strideActivity = 0;
  private smoothedSpeed = 0;
  private smoothedTurn = 0;
  private alarm = 0;
  private surprise = 0;
  private reach = 0;
  private carry = 0;
  private time = 0;
  private readonly contacts: Contact[];
  private readonly lookLocal = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();

  constructor(private readonly rig: OwnerRig) {
    const { hipSpacing } = rig.legGeometry;
    this.contacts = [-1, 1].map((side) => ({ x: side * hipSpacing, z: 0, down: true }));
  }

  /** Stride cycles per second on the odometer clock, for the debug overlay. */
  strideRate(): number {
    return this.strideRateValue;
  }

  /** Re-seats the ground contacts after a teleport. */
  resetContacts(): void {
    const { hipSpacing } = this.rig.legGeometry;
    this.contacts.forEach((contact, index) => {
      contact.x = (index === 0 ? -1 : 1) * hipSpacing;
      contact.z = 0;
      contact.down = true;
    });
  }

  update(dt: number, input: OwnerAnimationInput): void {
    if (dt <= 0) return;
    this.time += dt;
    this.smoothedSpeed = damp(this.smoothedSpeed, input.speed, 9, dt);
    this.smoothedTurn = damp(this.smoothedTurn, clamp(input.turnRate, -5, 5), 7, dt);
    this.alarm = damp(this.alarm, input.alarm, 6, dt);
    this.surprise = damp(this.surprise, input.surprise, 10, dt);
    this.reach = damp(this.reach, input.reaching, 7, dt);
    this.carry = damp(this.carry, input.carrying ? 1 : 0, 6, dt);

    this.advanceCycle(dt, input);
    const moving = smoothstep(0.05, 0.9, this.strideActivity);
    const angle = this.cycle * Math.PI * 2;

    this.updateBody(dt, angle, moving);
    this.updateLegs(moving);
    this.updateArms(angle, moving);
    this.updateHead(dt, input, moving);

    this.rig.alertMark.visible = this.alarm > 0.25;
    const pop = 0.7 + Math.min(1, this.alarm * 1.4) * 0.5 + Math.sin(this.time * 9) * 0.05 * this.alarm;
    this.rig.alertMark.scale.setScalar(pop);
  }

  private advanceCycle(dt: number, input: OwnerAnimationInput): void {
    const measured = input.travel ?? Math.max(0, input.speed) * dt;
    const forward = clamp(measured, 0, MAX_FRAME_TRAVEL);
    const yawArc = Math.abs(input.turnRate) * dt * PIVOT_STEP_RADIUS;
    const advance = forward + yawArc;

    if (advance > 1e-6) {
      this.strideRateValue = advance / STRIDE / dt;
      this.cycle = (this.cycle + advance / STRIDE) % 1;
    } else {
      this.strideRateValue = 0;
      // Settle towards a square stance so a homeowner who stops mid-step
      // finishes it rather than freezing with a foot in the air.
      this.cycle = this.cycle > 0.5
        ? Math.min(1, this.cycle + dt * 0.9) % 1
        : Math.max(0, this.cycle - dt * 0.9);
    }
    // Ramp the amplitude in over about a fifth of a second. Snapping it means
    // the legs jump from a square stance into a full stride on the frame the
    // homeowner starts walking, which the clip inspector correctly calls a pop.
    const rising = this.strideRateValue > this.strideActivity;
    this.strideActivity = damp(this.strideActivity, this.strideRateValue, rising ? 9 : 6, dt);

    // Recede every contact by the body's own motion, so a planted foot holds
    // its spot on the floor while the hips travel over it.
    const yaw = input.turnRate * dt;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const contact of this.contacts) {
      const { x, z } = contact;
      contact.x = cos * x - sin * z;
      contact.z = sin * x + cos * z - forward;
    }
  }

  private updateBody(dt: number, angle: number, moving: number): void {
    // Hips bob twice per stride and sway over the supporting leg. Leaning into
    // a turn is what makes a change of direction look decided rather than
    // like a figure being rotated on a turntable.
    const lean = clamp(-this.smoothedTurn * 0.055, -0.16, 0.16) * smoothstep(0.2, 1.4, this.smoothedSpeed);
    // Nobody stands still. A slow weight shift onto one hip costs nothing and
    // is visible precisely because the feet are planted: the pelvis moves over
    // them instead of the whole figure sliding.
    const standing = 1 - moving;
    const shift = wobble(this.time * 0.21, 3.4) * standing;
    this.rig.hips.position.y = this.rig.hipHeight - STANDING_FLEX
      - Math.abs(Math.sin(angle)) * 0.03 * moving
      - Math.abs(shift) * 0.008 - this.reach * 0.42;
    this.rig.hips.rotation.z = damp(
      this.rig.hips.rotation.z, Math.sin(angle) * 0.045 * moving + lean + shift * 0.035, 9, dt,
    );
    this.rig.hips.rotation.y = damp(
      this.rig.hips.rotation.y,
      -Math.sin(angle) * 0.1 * moving + shift * 0.05,
      9, dt,
    );

    const breath = Math.sin(this.time * 1.9) * 0.012 * standing;
    this.rig.torso.rotation.x = damp(
      this.rig.torso.rotation.x,
      this.smoothedSpeed * 0.035 + this.reach * 0.85 - this.surprise * 0.28 - breath,
      8, dt,
    );
    // The shoulders counter-rotate against the hips, and lead into a turn.
    this.rig.torso.rotation.y = damp(
      this.rig.torso.rotation.y,
      Math.sin(angle) * 0.1 * moving + this.smoothedTurn * 0.1 - shift * 0.06,
      8, dt,
    );
    this.rig.torso.rotation.z = damp(
      this.rig.torso.rotation.z,
      -Math.sin(angle) * 0.028 * moving - lean * 0.5 - shift * 0.02,
      9, dt,
    );
  }

  private updateLegs(moving: number): void {
    const geometry = this.rig.legGeometry;
    /** Ground the body covers while one foot is planted, early landing included. */
    const stanceSpan = STRIDE * (DUTY + (1 - DUTY) * (1 - SWING_LAND));
    const swingSpan = STRIDE * (1 - DUTY) * SWING_LAND;
    const stepLift = 0.075 * moving;
    const turnStep = smoothstep(0.6, 3, Math.abs(this.smoothedTurn)) * moving;
    const turnSign = Math.sign(this.smoothedTurn);

    this.rig.root.updateWorldMatrix(true, false);
    this.rig.hips.updateWorldMatrix(true, false);

    const legs = [
      { hip: this.rig.legLeft, knee: this.rig.shinLeft, ankle: this.rig.footLeft, side: -1, phase: 0 },
      { hip: this.rig.legRight, knee: this.rig.shinRight, ankle: this.rig.footRight, side: 1, phase: 0.5 },
    ] as const;

    legs.forEach((leg, index) => {
      const contact = this.contacts[index]!;
      const phase = (this.cycle + leg.phase) % 1;
      const stance = phase < DUTY;
      const t = stance ? phase / DUTY : (phase - DUTY) / (1 - DUTY);
      const swingT = stance ? 1 : t / SWING_LAND;
      const down = stance || swingT >= 1;

      // Where this foot wants to land, in hips space: half a stance span ahead
      // so the body passes over the print, and stepped outward on the outside
      // of a turn so the homeowner walks round the corner rather than pivoting.
      const outside = leg.side * turnSign;
      const printX = leg.side * geometry.hipSpacing
        + turnStep * 0.05 * outside
        - this.smoothedTurn * 0.012 * leg.side;
      const printZ = stanceSpan * 0.5 * moving + turnStep * 0.07 * outside;

      if (down && !contact.down) {
        contact.x = printX;
        contact.z = printZ;
      } else if (down) {
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

      // Heel-to-toe. The foot arrives toes-up onto its heel, flattens through
      // mid-stance, then drives the heel up and pushes off the toe. The rise
      // at toe-off is the push; without it a walk is a drag.
      let roll: number;
      let lift = 0;
      let x: number;
      let z: number;
      if (down) {
        // A foot that landed early is at the *start* of its plant, not the end
        // of it: reading the roll off the swing's own progress here would have
        // it push off the instant it touched down.
        const rolled = stance ? t : 0;
        roll = lerp(-0.3, 0, smoothstep(0, 0.22, rolled))
          + smoothstep(0.62, 1, rolled) * 0.52;
        x = contact.x;
        z = contact.z;
      } else {
        const remaining = (1 - swingT) * swingSpan * moving;
        const eased = swingT * swingT * (3 - 2 * swingT);
        x = lerp(contact.x, printX, eased);
        z = lerp(contact.z, printZ + remaining, eased);
        lift = Math.sin(Math.pow(swingT, 0.8) * Math.PI) * stepLift;
        // Toes up through the swing so the foot clears the floor, easing back
        // towards level for the heel strike.
        roll = lerp(0.52, -0.3, smoothstep(0.08, 0.86, swingT));
      }
      roll *= moving;

      // A step pivots on the heel while the foot rolls down, and on the toe
      // while the heel lifts — never on the ankle. Anchoring the ankle and
      // rotating the foot around it drags the sole across the floor: the heel
      // stays put and the toe sweeps, or the other way round. Solve instead
      // for the ankle position that holds the *current pivot* still.
      const pivotZ = roll >= 0 ? geometry.toeOffset : geometry.heelOffset;
      const height = geometry.ankleHeight;
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      const ankleY = height + height * (cos - 1) + pivotZ * sin + lift;
      const ankleZ = z + height * sin + pivotZ * (1 - cos);

      // Contacts live in the ground frame — `root` carries only the
      // homeowner's position and facing — so route the target through root
      // and then into the hips, which is where the bob, sway and lean live.
      // Subtracting the hip joint's rest offset lands it in the hip's *rest*
      // frame, which is the frame the solve is expressed in. Converting into
      // the hip's current, already-rotated frame instead makes the solver its
      // own input: it converges on a pose where the thigh never rotates and
      // the whole foot ends up behind the leg.
      const target = this.scratchTarget.set(x, ankleY, ankleZ);
      this.rig.root.localToWorld(target);
      this.rig.hips.worldToLocal(target);
      target.sub(leg.hip.position);

      // Splay first, swing second. Three's default Euler order applies Z
      // before X, so tilting the leg laterally and then solving the swing in
      // the resulting plane is the order the rig already evaluates.
      const splay = clamp(Math.atan2(target.x, Math.max(0.05, -target.y)), -0.24, 0.24);
      leg.hip.rotation.z = splay - this.smoothedTurn * 0.01 * leg.side;
      const solution = solveTwoBone(
        geometry.thighLength, geometry.shinLength,
        -Math.hypot(target.x, target.y), target.z, -1,
      );
      leg.hip.rotation.x = solution.upper;
      leg.knee.rotation.x = solution.lower;
      // Keep the sole level with the floor whatever the leg is doing, then add
      // the roll on top. Without the counter-rotation the shoe inherits the
      // shin's angle and the toe digs into the ground.
      leg.ankle.rotation.x = -(solution.upper + solution.lower) + roll;
    });
  }

  private updateArms(angle: number, moving: number): void {
    const swing = Math.sin(angle) * (0.42 + this.smoothedSpeed * 0.08) * moving;
    // Arms counter-swing against the legs unless they are busy.
    const armFree = (1 - this.carry * 0.85) * (1 - this.reach * 0.9);
    this.rig.armLeft.rotation.x = -swing * 0.8 * armFree + this.carry * -1.1 + this.reach * -1.35;
    this.rig.armRight.rotation.x = swing * 0.8 * armFree + this.carry * -1.1 + this.reach * -1.35;
    // Arms hang and swing slightly outward, clear of the hips.
    this.rig.armLeft.rotation.z = -0.11 - this.carry * 0.22 - this.surprise * 0.55;
    this.rig.armRight.rotation.z = 0.11 + this.carry * 0.22 + this.surprise * 0.55;
    this.rig.forearmLeft.rotation.x = -0.22 - this.carry * 1.15 - this.reach * 0.5 - this.alarm * 0.2
      - Math.max(0, swing) * 0.28;
    this.rig.forearmRight.rotation.x = -0.22 - this.carry * 1.15 - this.reach * 0.5 - this.alarm * 0.2
      - Math.max(0, -swing) * 0.28;
  }

  private updateHead(dt: number, input: OwnerAnimationInput, moving: number): void {
    let headYaw = wobble(this.time * 0.4, 2.2) * 0.18 * (1 - moving * 0.6);
    let headPitch = wobble(this.time * 0.33, 5.8) * 0.08 + this.reach * 0.5;
    if (input.lookAt) {
      this.rig.neck.updateWorldMatrix(true, false);
      this.inverse.copy(this.rig.neck.matrixWorld).invert();
      this.lookLocal.copy(input.lookAt).applyMatrix4(this.inverse);
      headYaw = clamp(Math.atan2(this.lookLocal.x, this.lookLocal.z), -1.1, 1.1);
      headPitch = clamp(-Math.atan2(this.lookLocal.y, Math.hypot(this.lookLocal.x, this.lookLocal.z)), -0.6, 0.8);
    }
    this.rig.head.rotation.y = damp(this.rig.head.rotation.y, headYaw, 8, dt);
    this.rig.head.rotation.x = damp(this.rig.head.rotation.x, headPitch - this.surprise * 0.3, 8, dt);
  }
}
