import * as THREE from "three";
import type { Point3 } from "../core/perception";
import RAPIER from "@dimforge/rapier3d-compat";
import type { NavigationObstacle } from "../core/pathfinding";

/**
 * Rapier integration.
 *
 * Why Rapier replaced the hand-rolled collision layer: the MVP needs the cat to
 * climb onto counters, chairs, boxes, and tables. The previous solver was a set
 * of 2D rectangles with no notion of "on top of", so vertical traversal could
 * only ever be faked with proximity flags. A real character controller gives
 * grounded checks, auto-step, ground snapping, and slide-along-wall for free,
 * and dynamic rigid bodies make swiped crockery behave without bespoke code.
 *
 * The cat and the homeowner stay kinematic — locomotion feel is authored, not
 * simulated. Only props are dynamic, and they are capped and allowed to sleep.
 */

/** 1 world unit is ~0.67 m, so gravity is scaled to match the authored house. */
export const WORLD_GRAVITY = -14.6;

/**
 * Colliders the cat must never be able to perch on, whatever their height.
 *
 * A ledge probe that takes any top face it finds will happily offer the top of
 * a boundary wall or a garden fence, and from a wall shelf or a planter those
 * tops are within a cat's jump. One legitimate climb then chains into leaving
 * the level entirely. Height alone cannot express this, because the shelf the
 * cat is *meant* to reach is nearly as high.
 */
const UNCLIMBABLE_LABELS: ReadonlySet<string> = new Set(["wall", "fence"]);

export interface StaticBoxOptions {
  /** Box centre in world space. */
  readonly center: THREE.Vector3 | readonly [number, number, number];
  /** Half extents on each axis. */
  readonly halfExtents: THREE.Vector3 | readonly [number, number, number];
  readonly rotationY?: number;
  readonly friction?: number;
  /** Excluded from character collision. Used for trigger-like scenery. */
  readonly sensor?: boolean;
  readonly label?: string;
}

/** Runtime handle for authored scenery whose collision state can change. */
export class StaticColliderHandle {
  constructor(private readonly collider: RAPIER.Collider) {}

  setEnabled(enabled: boolean): void {
    this.collider.setEnabled(enabled);
  }

  isEnabled(): boolean {
    return this.collider.isEnabled();
  }
}

export type DynamicShape =
  | { readonly kind: "box"; readonly halfExtents: readonly [number, number, number] }
  | { readonly kind: "ball"; readonly radius: number }
  | { readonly kind: "capsule"; readonly radius: number; readonly halfHeight: number }
  | { readonly kind: "cylinder"; readonly radius: number; readonly halfHeight: number };

export interface DynamicBodyOptions {
  readonly id: string;
  readonly shape: DynamicShape;
  readonly position: THREE.Vector3;
  readonly mass?: number;
  readonly restitution?: number;
  readonly friction?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
}

export class DynamicBody {
  private readonly translation = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();

  constructor(
    readonly id: string,
    private readonly body: RAPIER.RigidBody,
    private readonly collider: RAPIER.Collider,
    readonly spawn: THREE.Vector3,
  ) {}

  /** Copies the simulated transform onto a rendered object. */
  syncTo(object: THREE.Object3D): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.translation.set(t.x, t.y, t.z);
    this.rotation.set(r.x, r.y, r.z, r.w);
    object.position.copy(this.translation);
    object.quaternion.copy(this.rotation);
  }

  position(target: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  isAsleep(): boolean {
    return this.body.isSleeping();
  }

  applyImpulse(impulse: THREE.Vector3, torque = 0): void {
    this.body.wakeUp();
    this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    if (torque !== 0) {
      this.body.applyTorqueImpulse({ x: torque * 0.4, y: torque, z: torque * 0.25 }, true);
    }
  }

  teleport(position: THREE.Vector3): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Disables the body while it is carried in the cat's mouth. */
  setCarried(carried: boolean): void {
    this.collider.setSensor(carried);
    this.body.setEnabled(!carried);
  }
}

export interface CharacterMoveResult {
  /**
   * Movement Rapier actually allowed this step, after sliding and blocking.
   * Callers must reconcile velocity against this rather than against a position
   * delta: a kinematic body's translation does not change until `world.step()`
   * runs, so position deltas lag a frame and would cancel every jump on the
   * frame it starts.
   */
  readonly translation: THREE.Vector3;
  readonly grounded: boolean;
  /** Predicted feet position after this step. */
  readonly position: THREE.Vector3;
}

export class CharacterBody {
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly result = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly feetPrediction = new THREE.Vector3();
  private snapDistance = 0;
  private snapEnabled = true;

  constructor(
    private readonly world: RAPIER.World,
    private readonly body: RAPIER.RigidBody,
    private readonly collider: RAPIER.Collider,
    private readonly radius: number,
    private readonly halfHeight: number,
    options: { autostep: number; snap: number },
  ) {
    this.controller = world.createCharacterController(0.015);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((32 * Math.PI) / 180);
    this.controller.enableAutostep(options.autostep, radius * 0.5, true);
    this.controller.enableSnapToGround(options.snap);
    this.snapDistance = options.snap;
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(4.5);
  }

  /** Feet position: the collider centre is `radius + halfHeight` above it. */
  feet(target: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y - this.halfHeight - this.radius, t.z);
  }

  setFeetPosition(position: THREE.Vector3): void {
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y + this.halfHeight + this.radius,
      z: position.z,
    });
    this.body.setTranslation({
      x: position.x,
      y: position.y + this.halfHeight + this.radius,
      z: position.z,
    }, true);
  }

  /**
   * Ground snapping keeps a walking character glued to steps and slopes, but it
   * also cancels the first frames of a jump. The caller turns it off for the
   * ascent and back on once the character is falling again.
   */
  setSnapEnabled(enabled: boolean): void {
    if (enabled === this.snapEnabled) return;
    this.snapEnabled = enabled;
    if (enabled) this.controller.enableSnapToGround(this.snapDistance);
    else this.controller.disableSnapToGround();
  }

  /** Resolves a desired translation against the world and applies the result. */
  move(desired: THREE.Vector3): CharacterMoveResult {
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z });
    const movement = this.controller.computedMovement();
    const t = this.body.translation();
    this.position.set(t.x + movement.x, t.y + movement.y, t.z + movement.z);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
    this.result.set(movement.x, movement.y, movement.z);

    const grounded = this.controller.computedGrounded();
    this.feetPrediction.set(this.position.x, this.position.y - this.halfHeight - this.radius, this.position.z);
    return { translation: this.result, grounded, position: this.feetPrediction };
  }

  /**
   * Downward ray from just above the feet. Used to preview a landing surface so
   * the cat can decide whether a ledge is worth leaping onto.
   */
  groundBelow(from: THREE.Vector3, maxDistance: number): number {
    const ray = new RAPIER.Ray({ x: from.x, y: from.y + 0.05, z: from.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDistance + 0.05, true, undefined, undefined, this.collider);
    if (!hit) return Number.NEGATIVE_INFINITY;
    return from.y + 0.05 - hit.timeOfImpact;
  }
}

export interface LedgeProbe {
  /** Top surface height of the obstacle in front of the character. */
  readonly height: number;
  /** Horizontal distance to the obstacle face. */
  readonly distance: number;
}

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly dynamicBodies: DynamicBody[] = [];
  private readonly staticLabels = new Map<number, string>();
  private readonly sightDirection = new THREE.Vector3();
  private readonly staticObstacles: {
    readonly center: THREE.Vector3;
    readonly halfExtents: THREE.Vector3;
    readonly rotationY: number;
    readonly sensor: boolean;
    readonly label?: string;
    readonly collider: RAPIER.Collider;
  }[] = [];

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: WORLD_GRAVITY, z: 0 });
    this.world.integrationParameters.dt = 1 / 60;
  }

  /** Rapier ships as WASM and must be initialised before any world is created. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  addStaticBox(options: StaticBoxOptions): StaticColliderHandle {
    const center = toVector(options.center);
    const half = toVector(options.halfExtents);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
        .setRotation(quaternionFromYaw(options.rotationY ?? 0)),
    );
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(options.friction ?? 0.85);
    if (options.sensor) desc.setSensor(true);
    const collider = this.world.createCollider(desc, body);
    if (options.label) this.staticLabels.set(collider.handle, options.label);
    this.staticObstacles.push({
      center: center.clone(),
      halfExtents: half.clone(),
      rotationY: options.rotationY ?? 0,
      sensor: options.sensor ?? false,
      label: options.label,
      collider,
    });
    return new StaticColliderHandle(collider);
  }

  addDynamicBody(options: DynamicBodyOptions): DynamicBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(options.position.x, options.position.y, options.position.z)
        .setLinearDamping(options.linearDamping ?? 0.22)
        .setAngularDamping(options.angularDamping ?? 0.5)
        .setCanSleep(true),
    );
    const desc = shapeDescriptor(options.shape)
      .setRestitution(options.restitution ?? 0.18)
      .setFriction(options.friction ?? 0.7)
      .setMass(options.mass ?? 0.4);
    const collider = this.world.createCollider(desc, body);
    const handle = new DynamicBody(options.id, body, collider, options.position.clone());
    this.dynamicBodies.push(handle);
    return handle;
  }

  createCharacter(
    position: THREE.Vector3,
    radius: number,
    halfHeight: number,
    options: { autostep?: number; snap?: number } = {},
  ): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y + halfHeight + radius, position.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0.4),
      body,
    );
    return new CharacterBody(this.world, body, collider, radius, halfHeight, {
      autostep: options.autostep ?? radius * 1.1,
      snap: options.snap ?? radius * 0.9,
    });
  }

  /**
   * Casts forward at knee height, then straight down from just past the hit, to
   * find the top of whatever is directly ahead. This is what turns "jump" into
   * "jump *onto* that", instead of a hopeful forward hop.
   */
  probeLedge(origin: THREE.Vector3, facing: number, reach: number, maxHeight: number): LedgeProbe | null {
    const dx = Math.sin(facing);
    const dz = Math.cos(facing);
    let best: LedgeProbe | null = null;
    for (const lateral of [0, -0.22, 0.22]) {
      const ox = origin.x - dz * lateral;
      const oz = origin.z + dx * lateral;
      for (let step = 0.28; step <= reach; step += 0.22) {
        const probeX = ox + dx * step;
        const probeZ = oz + dz * step;
        const ray = new RAPIER.Ray(
          { x: probeX, y: origin.y + maxHeight + 0.4, z: probeZ },
          { x: 0, y: -1, z: 0 },
        );
        const hit = this.world.castRay(ray, maxHeight + 0.5, true);
        if (!hit) continue;
        // A wall or a fence is not a ledge, however flat its top is.
        if (UNCLIMBABLE_LABELS.has(this.staticLabels.get(hit.collider.handle) ?? "")) continue;
        const top = origin.y + maxHeight + 0.4 - hit.timeOfImpact;
        if (top <= origin.y + 0.12 || top > origin.y + maxHeight) continue;
        if (!best || top > best.height) best = { height: top, distance: step };
      }
      if (best) break;
    }
    return best;
  }

  /**
   * True when nothing solid blocks the segment between two world points.
   *
   * Only the authored static world — walls, doors, and furniture — occludes
   * sight, which keeps what the player can reason about the same as what the
   * code checks. Everything else is filtered out for a reason:
   *
   * - sensors are trigger volumes, not walls;
   * - dynamic props are swipeable clutter, and a homeowner is not blinded by
   *   a sock that happens to be in the way;
   * - kinematic bodies are the cat and the homeowner themselves. Without this
   *   the homeowner's own capsule blocks every downward sightline out of their
   *   own eyes, and the cat's capsule blocks the ray that is looking for it.
   */
  hasLineOfSight(from: Readonly<Point3>, to: Readonly<Point3>): boolean {
    this.sightDirection.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = this.sightDirection.length();
    if (distance < 1e-4) return true;
    this.sightDirection.multiplyScalar(1 / distance);
    const ray = new RAPIER.Ray(
      { x: from.x, y: from.y, z: from.z },
      { x: this.sightDirection.x, y: this.sightDirection.y, z: this.sightDirection.z },
    );
    const hit = this.world.castRay(
      ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
        | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC
        | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
    );
    return hit === null;
  }

  step(): void {
    this.world.step();
  }

  bodies(): readonly DynamicBody[] {
    return this.dynamicBodies;
  }

  /**
   * Walk-blocking X/Z footprints sourced from the exact boxes Rapier uses.
   * Elevated shelves are ignored because they do not intersect the homeowner;
   * disabled door leaves disappear from this list as soon as their collider
   * opens.
   */
  navigationObstacles(minY: number, maxY: number): NavigationObstacle[] {
    return this.staticObstacles
      .filter((obstacle) => obstacle.collider.isEnabled()
        && !obstacle.sensor
        && obstacle.label !== "floor"
        && obstacle.center.y + obstacle.halfExtents.y >= minY
        && obstacle.center.y - obstacle.halfExtents.y <= maxY)
      .map((obstacle) => ({
        center: { x: obstacle.center.x, z: obstacle.center.z },
        halfExtents: { x: obstacle.halfExtents.x, z: obstacle.halfExtents.z },
        rotationY: obstacle.rotationY,
      }));
  }

  /** True when the collider at a point is one the cat may never perch on. */
  isClimbableAt(x: number, y: number, z: number, probeHeight = 0.4): boolean {
    const ray = new RAPIER.Ray({ x, y: y + probeHeight, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, probeHeight * 2, true);
    if (!hit) return false;
    return !UNCLIMBABLE_LABELS.has(this.staticLabels.get(hit.collider.handle) ?? "");
  }

  /** Number of dynamic bodies currently awake, for the debug overlay. */
  activeBodyCount(): number {
    return this.dynamicBodies.reduce((total, body) => total + (body.isAsleep() ? 0 : 1), 0);
  }

  /** Debug wireframes for every collider in the world. */
  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    const buffers = this.world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  dispose(): void {
    this.world.free();
  }
}

function shapeDescriptor(shape: DynamicShape): RAPIER.ColliderDesc {
  switch (shape.kind) {
    case "box":
      return RAPIER.ColliderDesc.cuboid(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]);
    case "ball":
      return RAPIER.ColliderDesc.ball(shape.radius);
    case "capsule":
      return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    case "cylinder":
      return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
  }
}

function toVector(value: THREE.Vector3 | readonly [number, number, number]): THREE.Vector3 {
  return Array.isArray(value) ? new THREE.Vector3(value[0], value[1], value[2]) : (value as THREE.Vector3);
}

function quaternionFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
