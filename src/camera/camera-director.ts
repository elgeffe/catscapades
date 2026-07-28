import * as THREE from "three";
import { CAMERA_ZONES, type CameraZoneSpec, type RoomId } from "../level/level-data";
import { selectCameraZone } from "../core/gameplay";
import { clamp, damp, deadZoneOffset } from "../core/math";

/**
 * Semi-fixed diorama cameras.
 *
 * Each room has one authored composition. The camera tracks only once the cat
 * leaves a dead zone, leads slightly in the direction of travel, and blends
 * between rooms with hysteresis so a doorway never causes zone flicker.
 *
 * It also exposes the movement basis it is currently using. Blending that basis
 * separately from the view is what stops held input from reversing direction
 * halfway through a room transition.
 */
export class CameraDirector {
  private zone: CameraZoneSpec;
  private previousZone: CameraZoneSpec;
  private blend = 1;

  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector3();

  /** Camera-relative forward on the ground plane, blended across transitions. */
  private readonly basisForward = new THREE.Vector3(0, 0, -1);
  private readonly basisRight = new THREE.Vector3(1, 0, 0);
  private readonly scratch = new THREE.Vector3();

  private zoneChanged = false;

  constructor(private readonly camera: THREE.PerspectiveCamera, startZone: RoomId = "garden") {
    const found = CAMERA_ZONES.find((candidate) => candidate.id === startZone);
    if (!found) throw new Error(`No camera zone for room "${startZone}".`);
    this.zone = found;
    this.previousZone = found;
    this.currentTarget.set(found.target[0], found.target[1], found.target[2]);
    this.camera.fov = found.fov;
    this.camera.position.set(
      found.target[0] + found.offset[0],
      found.target[1] + found.offset[1],
      found.target[2] + found.offset[2],
    );
    this.camera.lookAt(this.currentTarget);
    this.camera.updateProjectionMatrix();
    this.refreshBasis(1);
  }

  currentZoneId(): RoomId {
    return this.zone.id;
  }

  currentLabel(): string {
    return this.zone.label;
  }

  /** True on the frame the active composition changed. */
  consumeZoneChange(): boolean {
    const changed = this.zoneChanged;
    this.zoneChanged = false;
    return changed;
  }

  forward(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.basisForward);
  }

  right(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.basisRight);
  }

  /** Re-evaluates which room owns the camera, applying threshold hysteresis. */
  updateZone(catX: number): void {
    const next = selectCameraZone(this.zone.id, catX) as RoomId;
    if (next === this.zone.id) return;
    const found = CAMERA_ZONES.find((candidate) => candidate.id === next);
    if (!found) return;
    this.previousZone = this.zone;
    this.zone = found;
    this.blend = 0;
    this.zoneChanged = true;
  }

  update(dt: number, focus: THREE.Vector3, velocity: THREE.Vector3, reducedMotion: boolean): void {
    const zone = this.zone;
    // Blend duration is the one place motion sensitivity matters most, so the
    // reduced-motion setting shortens the move rather than removing tracking.
    const blendRate = reducedMotion ? 4.2 : 1.9;
    this.blend = Math.min(1, this.blend + dt * blendRate);
    const eased = this.blend * this.blend * (3 - 2 * this.blend);

    const offsetX = deadZoneOffset(focus.x - zone.target[0], zone.deadZone[0]);
    const offsetZ = deadZoneOffset(focus.z - zone.target[2], zone.deadZone[1]);

    this.lookAhead.set(velocity.x, 0, velocity.z).multiplyScalar(zone.lookAhead * 0.16);
    if (this.lookAhead.lengthSq() > 4) this.lookAhead.setLength(2);

    this.desiredTarget.set(
      zone.target[0] + offsetX * zone.follow + this.lookAhead.x,
      zone.target[1] + clamp((focus.y - zone.target[1]) * 0.55, -0.3, 1.9),
      zone.target[2] + offsetZ * zone.follow + this.lookAhead.z,
    );
    this.desiredPosition.set(
      zone.target[0] + zone.offset[0] + offsetX * zone.follow * 0.6,
      zone.target[1] + zone.offset[1] + clamp((focus.y - zone.target[1]) * 0.35, -0.2, 1.4),
      zone.target[2] + zone.offset[2] + offsetZ * zone.follow * 0.42,
    );

    // While blending, interpolate from the previous composition so the move
    // reads as a deliberate cut-in rather than a spring from nowhere.
    if (eased < 1) {
      const previous = this.previousZone;
      this.scratch.set(
        previous.target[0] + previous.offset[0],
        previous.target[1] + previous.offset[1],
        previous.target[2] + previous.offset[2],
      );
      this.desiredPosition.lerpVectors(this.scratch, this.desiredPosition, eased);
      this.scratch.set(previous.target[0], previous.target[1], previous.target[2]);
      this.desiredTarget.lerpVectors(this.scratch, this.desiredTarget, eased);
      this.camera.fov = damp(this.camera.fov, previous.fov + (zone.fov - previous.fov) * eased, 8, dt);
      this.camera.updateProjectionMatrix();
    } else if (Math.abs(this.camera.fov - zone.fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, zone.fov, 8, dt);
      this.camera.updateProjectionMatrix();
    }

    const rate = reducedMotion ? 8 : eased < 1 ? 3.4 : 5.4;
    this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-rate * dt));
    this.currentTarget.lerp(this.desiredTarget, 1 - Math.exp(-(rate + 1.2) * dt));
    this.camera.lookAt(this.currentTarget);

    this.refreshBasis(1 - Math.exp(-6 * dt));
  }

  /**
   * Movement basis follows the camera on its own slower curve. During a room
   * change the view can snap ahead while "forward" rotates smoothly under the
   * player's thumb.
   */
  private refreshBasis(alpha: number): void {
    this.camera.getWorldDirection(this.scratch);
    this.scratch.y = 0;
    if (this.scratch.lengthSq() < 1e-5) this.scratch.set(0, 0, -1);
    this.scratch.normalize();
    this.basisForward.lerp(this.scratch, alpha).normalize();
    this.basisRight.crossVectors(this.basisForward, UP).normalize();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
