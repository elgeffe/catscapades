import * as THREE from "three";
import type { OwnerRig } from "../models/owner";
import { clamp, damp, smoothstep, wobble } from "../core/math";

export interface OwnerAnimationInput {
  readonly speed: number;
  readonly turnRate: number;
  /** 0 calm, 1 alarmed. Drives posture, arm tension, and the alert mark. */
  readonly alarm: number;
  /** 0..1 weight for a surprised recoil. */
  readonly surprise: number;
  /** 0..1 weight for crouching to pick something (or someone) up. */
  readonly reaching: number;
  readonly carrying: boolean;
  readonly lookAt: THREE.Vector3 | null;
}

/** Cycle-driven walk with weight shift, arm swing, and a look-at head. */
export class OwnerAnimator {
  private cycle = 0;
  private smoothedSpeed = 0;
  private smoothedTurn = 0;
  private alarm = 0;
  private surprise = 0;
  private reach = 0;
  private carry = 0;
  private time = 0;
  private readonly lookLocal = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();

  constructor(private readonly rig: OwnerRig) {}

  update(dt: number, input: OwnerAnimationInput): void {
    if (dt <= 0) return;
    this.time += dt;
    this.smoothedSpeed = damp(this.smoothedSpeed, input.speed, 9, dt);
    this.smoothedTurn = damp(this.smoothedTurn, clamp(input.turnRate, -5, 5), 7, dt);
    this.alarm = damp(this.alarm, input.alarm, 6, dt);
    this.surprise = damp(this.surprise, input.surprise, 10, dt);
    this.reach = damp(this.reach, input.reaching, 7, dt);
    this.carry = damp(this.carry, input.carrying ? 1 : 0, 6, dt);

    const stride = 1.25;
    const moving = smoothstep(0.05, 0.6, this.smoothedSpeed);
    this.cycle = (this.cycle + (this.smoothedSpeed / stride) * dt) % 1;
    const angle = this.cycle * Math.PI * 2;

    const swing = Math.sin(angle) * (0.55 + this.smoothedSpeed * 0.09) * moving;
    this.rig.legLeft.rotation.x = swing;
    this.rig.legRight.rotation.x = -swing;
    this.rig.shinLeft.rotation.x = Math.max(0, -Math.sin(angle - 0.7)) * 0.85 * moving;
    this.rig.shinRight.rotation.x = Math.max(0, -Math.sin(angle + Math.PI - 0.7)) * 0.85 * moving;

    // Arms counter-swing unless they are busy holding or reaching.
    const armFree = (1 - this.carry * 0.85) * (1 - this.reach * 0.9);
    this.rig.armLeft.rotation.x = -swing * 0.75 * armFree + this.carry * -1.1 + this.reach * -1.35;
    this.rig.armRight.rotation.x = swing * 0.75 * armFree + this.carry * -1.1 + this.reach * -1.35;
    // Arms hang and swing slightly *outward*, clear of the hips. The signs
    // used to be inverted, which tucked both hands into the trouser tops.
    this.rig.armLeft.rotation.z = -0.11 - this.carry * 0.22 - this.surprise * 0.55;
    this.rig.armRight.rotation.z = 0.11 + this.carry * 0.22 + this.surprise * 0.55;
    this.rig.forearmLeft.rotation.x = -0.22 - this.carry * 1.15 - this.reach * 0.5 - this.alarm * 0.2;
    this.rig.forearmRight.rotation.x = -0.22 - this.carry * 1.15 - this.reach * 0.5 - this.alarm * 0.2;

    // Hips bob twice per stride and sway with the supporting leg.
    this.rig.hips.position.y = this.rig.hipHeight
      - Math.abs(Math.sin(angle)) * 0.045 * moving - this.reach * 0.42;
    this.rig.hips.rotation.z = Math.sin(angle) * 0.05 * moving - this.smoothedTurn * 0.05;
    this.rig.hips.rotation.y = -Math.sin(angle) * 0.12 * moving;

    this.rig.torso.rotation.x = this.smoothedSpeed * 0.035 + this.reach * 0.85 - this.surprise * 0.28;
    this.rig.torso.rotation.y = Math.sin(angle) * 0.1 * moving + this.smoothedTurn * 0.08;
    this.rig.torso.rotation.z = -Math.sin(angle) * 0.03 * moving;

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

    this.rig.alertMark.visible = this.alarm > 0.25;
    const pop = 0.7 + Math.min(1, this.alarm * 1.4) * 0.5 + Math.sin(this.time * 9) * 0.05 * this.alarm;
    this.rig.alertMark.scale.setScalar(pop);
  }
}
