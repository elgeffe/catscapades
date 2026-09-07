import * as THREE from "three";
import type { CharacterBody, PhysicsWorld } from "../physics/physics-world";
import { WORLD_GRAVITY } from "../physics/physics-world";
import { JUMP_TARGETS, type JumpTargetSpec } from "../level/level-data";
import { clamp, damp, dampAngle, shortestAngle, smoothstep } from "../core/math";

/**
 * Kinematic cat locomotion.
 *
 * Movement feel stays authored — acceleration curves, turn rates, and jump arcs
 * are tuned numbers, not simulation output. Rapier only answers "where does
 * this shape end up", which is exactly the part that needs to be correct for
 * the cat to reliably land on a worktop instead of clipping through it.
 *
 * Jumping resolves in three tiers:
 *   1. An authored jump target, if the cat is stood in its approach zone.
 *   2. Otherwise a ledge probe forward from the chest, so unauthored geometry
 *      with a top face is still climbable.
 *   3. Otherwise a plain ballistic hop, and gravity does the rest.
 *
 * Tiers 1 and 2 do NOT use ballistics. A ballistic arc has to clear the lip of
 * the surface using horizontal speed the cat usually does not have — it takes
 * off pressed against the cupboard face, spends the ascent sliding along it,
 * and drops back where it started. Instead the jump commits to an authored arc
 * that ends exactly on the landing point. Locomotion is owned by the arc for
 * its duration, which is what makes "leap onto the worktop" mean it.
 */

export const CAT_SPEEDS = {
  stalk: 1.05,
  walk: 2.95,
  scamper: 6.1,
  /** Multiplier applied while carrying something in the mouth. */
  carryFactor: 0.82,
} as const;

const CAT_RADIUS = 0.19;
const CAT_HALF_HEIGHT = 0.1;
/** A cat clears roughly five times its own shoulder height. Ours is generous. */
const MAX_LEDGE_HEIGHT = 1.5;
const LEDGE_REACH = 1.05;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.16;

export interface CatMoveInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly run: boolean;
  readonly stalk: boolean;
  readonly jumpPressed: boolean;
  readonly carrying: boolean;
}

export interface CatFrameState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly planarSpeed: number;
  /**
   * Planar ground distance actually covered this frame, after Rapier resolved
   * collisions. Animation times its strides from this rather than from
   * `planarSpeed`, so a cat pressed against a cupboard stops stepping instead
   * of running on the spot.
   */
  readonly travel: number;
  readonly facing: number;
  readonly turnRate: number;
  readonly acceleration: number;
  /**
   * How hard the cat is arresting its own momentum, 0..1. Rises when the stick
   * opposes travel or is released at speed. Animation braces on this; it does
   * not change how quickly the controller actually stops, because a stealth
   * game needs the stop to stay crisp.
   */
  readonly brake: number;
  readonly grounded: boolean;
  readonly airborne: number;
  readonly jumpProgress: number;
  /** Set for one frame on touchdown, scaled by impact speed. */
  readonly landImpact: number;
  readonly activeJumpTarget: JumpTargetSpec | null;
}

export class CatController {
  private readonly body: CharacterBody;
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly moveDirection = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();

  private facing = 0;
  /** Where the stick is pointing. The cat turns to it; travel follows the body. */
  private desiredFacing = 0;
  private turnRate = 0;
  private brake = 0;
  private readonly travelDirection = new THREE.Vector3();
  private acceleration = 0;
  private previousSpeed = 0;
  private grounded = true;
  private airborneBlend = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private landImpact = 0;
  private jumpStartY = 0;
  private jumpPeakY = 0;
  private jumping = false;

  /** Authored arc state. While `arcDuration > 0` the arc owns the transform. */
  private readonly arcStart = new THREE.Vector3();
  private readonly arcEnd = new THREE.Vector3();
  private arcElapsed = 0;
  private arcDuration = 0;
  private arcHeight = 0;

  /** Target the current jump is committed to, for camera and prompt copy. */
  private committedTarget: JumpTargetSpec | null = null;
  private offeredTarget: JumpTargetSpec | null = null;

  constructor(private readonly physics: PhysicsWorld, spawn: THREE.Vector3) {
    this.position.copy(spawn);
    this.previousPosition.copy(spawn);
    this.body = physics.createCharacter(spawn, CAT_RADIUS, CAT_HALF_HEIGHT, {
      autostep: 0.24,
      snap: 0.22,
    });
  }

  /** The jump target currently on offer, for the contextual prompt. */
  availableJumpTarget(): JumpTargetSpec | null {
    return this.offeredTarget;
  }

  teleport(to: THREE.Vector3): void {
    this.position.copy(to);
    this.previousPosition.copy(to);
    this.velocity.set(0, 0, 0);
    this.jumping = false;
    this.arcDuration = 0;
    this.committedTarget = null;
    this.airborneBlend = 0;
    this.brake = 0;
    this.desiredFacing = this.facing;
    this.body.setFeetPosition(to);
  }

  update(dt: number, input: CatMoveInput, forward: THREE.Vector3, right: THREE.Vector3): CatFrameState {
    this.previousPosition.copy(this.position);
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.landImpact = Math.max(0, this.landImpact - dt * 4.5);
    if (input.jumpPressed) this.jumpBuffer = JUMP_BUFFER;

    if (this.arcDuration > 0) return this.advanceArc(dt);

    this.applyHorizontal(dt, input, forward, right);
    this.offeredTarget = this.resolveJumpTarget();
    this.applyVertical(dt);

    this.body.setSnapEnabled(!this.jumping && this.velocity.y <= 0.02);
    this.desired.set(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    const result = this.body.move(this.desired);
    // Use the predicted position, not the body's translation: a kinematic body
    // does not move until the world steps, one call later.
    this.position.copy(result.position);

    this.reconcile(dt, result.grounded, result.translation.y);
    this.updateFacing(dt, input.moveX !== 0 || input.moveY !== 0);

    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.acceleration = (planarSpeed - this.previousSpeed) / Math.max(dt, 1e-4);
    this.previousSpeed = planarSpeed;

    return {
      position: this.position,
      velocity: this.velocity,
      planarSpeed,
      travel: this.measureTravel(),
      facing: this.facing,
      turnRate: this.turnRate,
      acceleration: this.acceleration,
      brake: this.brake,
      grounded: this.grounded,
      airborne: this.airborneBlend,
      jumpProgress: this.jumpProgress(),
      landImpact: this.landImpact,
      activeJumpTarget: this.committedTarget,
    };
  }

  private applyHorizontal(dt: number, input: CatMoveInput, forward: THREE.Vector3, right: THREE.Vector3): void {
    this.moveDirection.set(0, 0, 0)
      .addScaledVector(right, input.moveX)
      .addScaledVector(forward, input.moveY);
    const magnitude = Math.min(1, this.moveDirection.length());
    if (magnitude > 0.001) this.moveDirection.normalize();

    const base = input.stalk ? CAT_SPEEDS.stalk : input.run ? CAT_SPEEDS.scamper : CAT_SPEEDS.walk;
    let speed = base * (input.carrying ? CAT_SPEEDS.carryFactor : 1) * magnitude;

    if (this.grounded) {
      const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (magnitude > 0.001) this.desiredFacing = Math.atan2(this.moveDirection.x, this.moveDirection.z);

      // A cat does not carry speed through a sharp turn: it plants, pivots, and
      // then goes. Without this the stick can reverse the velocity while the
      // body is still swinging round, and the cat slides backwards facing
      // forwards — the "separate body rotation" that reads as sliding even once
      // the paws themselves are planted correctly.
      const misalignment = magnitude > 0.001
        ? Math.abs(shortestAngle(this.facing, this.desiredFacing))
        : 0;
      speed *= 1 - smoothstep(0.55, 2.3, misalignment) * 0.74;

      // Travel commits to the spine as speed builds. Slow enough to place a paw
      // deliberately, the cat may still sidestep; at a scamper it must arc.
      const commit = smoothstep(1.1, 3.4, planarSpeed);
      this.travelDirection
        .set(Math.sin(this.facing), 0, Math.cos(this.facing))
        .multiplyScalar(commit)
        .addScaledVector(this.moveDirection, 1 - commit);
      if (this.travelDirection.lengthSq() > 1e-6) this.travelDirection.normalize();
      else this.travelDirection.copy(this.moveDirection);

      // Braking is an intent signal for animation, not a slower stop: opposing
      // the stick, or letting go at speed, braces the cat.
      const heading = planarSpeed > 0.05
        ? (this.velocity.x * this.travelDirection.x + this.velocity.z * this.travelDirection.z) / planarSpeed
        : 1;
      const opposition = magnitude > 0.001 ? clamp(-heading, 0, 1) : 1;
      const arresting = Math.max(opposition, smoothstep(0.8, 2.6, misalignment));
      this.brake = damp(this.brake, arresting * smoothstep(0.7, 3, planarSpeed), 13, dt);

      const alpha = 1 - Math.exp(-(magnitude > 0 ? 18 : 24) * dt);
      this.velocity.x += (this.travelDirection.x * speed - this.velocity.x) * alpha;
      this.velocity.z += (this.travelDirection.z * speed - this.velocity.z) * alpha;
      return;
    }

    this.brake = damp(this.brake, 0, 8, dt);

    // Airborne: a leap keeps its launch momentum. Steering nudges the arc but
    // must never damp it, or a solved jump loses the speed it needs to reach
    // the ledge and the cat drops straight back down where it took off.
    if (magnitude > 0.01) {
      const airAcceleration = 5.4 * dt;
      const launchSpeed = Math.max(Math.hypot(this.velocity.x, this.velocity.z), speed);
      this.velocity.x += this.moveDirection.x * airAcceleration;
      this.velocity.z += this.moveDirection.z * airAcceleration;
      const current = Math.hypot(this.velocity.x, this.velocity.z);
      if (current > launchSpeed) {
        this.velocity.x *= launchSpeed / current;
        this.velocity.z *= launchSpeed / current;
      }
    }
  }

  /**
   * Solves the vertical launch velocity for a target height and horizontal
   * distance, so the cat arrives at the ledge slightly above its lip.
   */
  private applyVertical(dt: number): void {
    if (this.grounded && this.velocity.y <= 0.01) this.velocity.y = -1.2;

    const canJump = this.grounded || this.coyote > 0;
    if (this.jumpBuffer > 0 && canJump) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.jumpStartY = this.position.y;

      const target = this.offeredTarget;
      const ledge = target
        ? { height: target.landing[1], distance: Math.hypot(target.landing[0] - this.position.x, target.landing[2] - this.position.z) }
        : this.probeLedge();

      if (target) {
        this.beginArc(target.landing[0], target.landing[1], target.landing[2]);
        this.committedTarget = target;
        return;
      }
      if (ledge && ledge.height > this.position.y + 0.06) {
        // Land just past the lip of whatever was probed.
        const reach = ledge.distance + CAT_RADIUS + 0.3;
        this.beginArc(
          this.position.x + Math.sin(this.facing) * reach,
          ledge.height,
          this.position.z + Math.cos(this.facing) * reach,
        );
        return;
      }
      {
        this.committedTarget = null;
        this.velocity.y = 5.4;
        const boost = Math.max(1.4, Math.hypot(this.velocity.x, this.velocity.z) * 1.12);
        this.velocity.x = Math.sin(this.facing) * boost;
        this.velocity.z = Math.cos(this.facing) * boost;
        this.jumpPeakY = this.position.y + 1.0;
      }
    }

    if (!this.grounded || this.velocity.y > 0) {
      this.velocity.y += WORLD_GRAVITY * dt;
      // Falling faster than rising gives the arc weight without a floaty apex.
      if (this.velocity.y < 0) this.velocity.y += WORLD_GRAVITY * 0.45 * dt;
      this.velocity.y = Math.max(this.velocity.y, -18);
    }
  }

  /**
   * Starts an authored arc to `(x, y, z)`. The cat is moved along it directly,
   * so the landing is guaranteed; the arc peak clears the destination by enough
   * that the cat visibly goes *over* the lip rather than through it.
   */
  private beginArc(x: number, y: number, z: number): void {
    this.arcStart.copy(this.position);
    this.arcEnd.set(x, y, z);
    const rise = Math.max(0, y - this.position.y);
    const span = Math.hypot(x - this.position.x, z - this.position.z);
    this.arcDuration = clamp(0.34 + rise * 0.2 + span * 0.07, 0.34, 0.82);
    this.arcHeight = 0.16 + rise * 0.2 + span * 0.05;
    this.arcElapsed = 0;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.jumpStartY = this.arcStart.y;
    this.jumpPeakY = Math.max(this.arcStart.y, y) + this.arcHeight;
    this.facing = Math.atan2(x - this.arcStart.x, z - this.arcStart.z);
    this.desiredFacing = this.facing;
    this.brake = 0;
  }

  /** Drives the committed arc. Returns the frame state directly. */
  private advanceArc(dt: number): CatFrameState {
    this.arcElapsed += dt;
    const u = clamp(this.arcElapsed / this.arcDuration, 0, 1);
    // Ease the horizontal so the cat gathers itself, then extends into the land.
    const horizontal = u * u * (3 - 2 * u);
    this.position.set(
      this.arcStart.x + (this.arcEnd.x - this.arcStart.x) * horizontal,
      this.arcStart.y + (this.arcEnd.y - this.arcStart.y) * u + Math.sin(u * Math.PI) * this.arcHeight,
      this.arcStart.z + (this.arcEnd.z - this.arcStart.z) * horizontal,
    );
    this.body.setFeetPosition(this.position);

    const finished = u >= 1;
    if (finished) {
      this.arcDuration = 0;
      this.jumping = false;
      this.committedTarget = null;
      this.grounded = true;
      this.coyote = COYOTE_TIME;
      this.landImpact = clamp((this.jumpPeakY - this.arcEnd.y) * 0.7, 0.2, 1);
      this.velocity.set(0, 0, 0);
      this.airborneBlend = 0;
    } else {
      this.airborneBlend = 1;
    }

    this.turnRate = 0;
    this.previousSpeed = 0;
    this.acceleration = 0;
    return {
      position: this.position,
      velocity: this.velocity,
      planarSpeed: 0,
      travel: this.measureTravel(),
      facing: this.facing,
      turnRate: 0,
      acceleration: 0,
      brake: 0,
      grounded: this.grounded,
      airborne: this.airborneBlend,
      jumpProgress: u,
      landImpact: this.landImpact,
      activeJumpTarget: this.committedTarget,
    };
  }

  private probeLedge(): { height: number; distance: number } | null {
    const probe = this.physics.probeLedge(this.position, this.facing, LEDGE_REACH, MAX_LEDGE_HEIGHT);
    return probe ? { height: probe.height, distance: probe.distance } : null;
  }

  /** Picks the authored jump target whose approach zone the cat is standing in. */
  private resolveJumpTarget(): JumpTargetSpec | null {
    if (!this.grounded) return null;
    let best: JumpTargetSpec | null = null;
    let bestScore = -Infinity;
    for (const target of JUMP_TARGETS) {
      const dx = target.approach[0] - this.position.x;
      const dz = target.approach[1] - this.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > target.approachRadius) continue;
      // Must be below the landing and roughly facing it.
      const rise = target.landing[1] - this.position.y;
      if (rise < 0.12 || rise > MAX_LEDGE_HEIGHT) continue;
      const toLanding = Math.atan2(target.landing[0] - this.position.x, target.landing[2] - this.position.z);
      const facingDot = Math.cos(shortestAngle(this.facing, toLanding));
      // A cat sizing up a jump does not have to already be pointing at it, so a
      // standing cat is offered anything nearby; a moving one must be heading
      // roughly the right way or the offer fights the player's intent.
      const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.6;
      if (facingDot < (moving ? 0.15 : -0.45)) continue;

      const score = target.priority * 6 + facingDot * 5 - distance * 1.4;
      if (score > bestScore) {
        bestScore = score;
        best = target;
      }
    }
    return best;
  }

  private reconcile(dt: number, grounded: boolean, movedY: number): void {
    const requestedY = this.velocity.y * dt;
    // Trust the controller: if it refused most of the vertical move, we hit
    // something. Rising into a ceiling kills upward speed; landing zeroes it.
    // Only a genuine ceiling stops an ascent: require the controller to have
    // refused essentially all of it, so a grazed corner does not kill the jump.
    if (this.velocity.y > 0 && requestedY > 0.002 && movedY < requestedY * 0.08) this.velocity.y = 0;
    if (this.velocity.y < 0 && grounded && movedY > requestedY * 0.4) this.velocity.y = 0;

    const wasGrounded = this.grounded;
    this.grounded = grounded;
    if (grounded) {
      this.coyote = COYOTE_TIME;
      if (!wasGrounded) {
        const drop = Math.max(0, this.jumpPeakY - this.position.y);
        this.landImpact = clamp(drop * 0.7, 0.15, 1);
        this.jumping = false;
        this.committedTarget = null;
        this.velocity.y = 0;
      }
    }

    const target = grounded ? 0 : 1;
    this.airborneBlend += (target - this.airborneBlend) * (1 - Math.exp(-14 * dt));
  }

  private updateFacing(dt: number, steering: boolean): void {
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // Turn towards where the stick points, not towards where the cat is already
    // travelling: a cat aims its body first and the feet follow. Held still,
    // that becomes a pivot on the spot, which the stride odometer pays for in
    // steps rather than spinning the body over planted paws.
    if (steering || planarSpeed > 0.2) {
      const targetAngle = steering ? this.desiredFacing : Math.atan2(this.velocity.x, this.velocity.z);
      const previous = this.facing;
      // Cats turn faster at low speed and lean through fast direction changes.
      const agility = this.grounded ? 15 - Math.min(8, planarSpeed) : 5;
      this.facing = dampAngle(this.facing, targetAngle, agility, dt);
      this.turnRate = shortestAngle(previous, this.facing) / Math.max(dt, 1e-4);
    } else {
      this.turnRate += (0 - this.turnRate) * (1 - Math.exp(-8 * dt));
    }
  }

  /** Planar distance between the previous and current resolved positions. */
  private measureTravel(): number {
    return Math.hypot(
      this.position.x - this.previousPosition.x,
      this.position.z - this.previousPosition.z,
    );
  }

  private jumpProgress(): number {
    if (!this.jumping) return 0;
    const rise = Math.max(0.2, this.jumpPeakY - this.jumpStartY);
    return clamp((this.position.y - this.jumpStartY) / rise, 0, 1);
  }
}
