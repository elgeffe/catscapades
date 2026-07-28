import * as THREE from "three";
import type { InputFrame } from "./input";
import { TinyAudio } from "./audio";

type ZoneId = "garden" | "kitchen" | "dining";
type OwnerState = "routine" | "investigating" | "returning";

interface RectCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface SupportSurface {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

interface CameraZone {
  id: ZoneId;
  label: string;
  targetBase: THREE.Vector3;
  cameraBase: THREE.Vector3;
  deadX: number;
  deadZ: number;
  follow: number;
}

interface Objective {
  id: string;
  text: string;
  complete: boolean;
}

interface DynamicProp {
  id: string;
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  radius: number;
  disturbed: boolean;
  settled: boolean;
  crashPlayed: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const FIXED_STEP = 1 / 60;
const CAT_RADIUS = 0.48;

export class CatSchemerGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  private readonly audio = new TinyAudio();
  private readonly cat = new THREE.Group();
  private readonly catVisual = new THREE.Group();
  private readonly catTail = new THREE.Group();
  private readonly owner = new THREE.Group();
  private readonly ownerAlert = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xd6533c }),
  );
  private readonly keyMesh = this.createKey();
  private readonly boxPosition = new THREE.Vector3(-10.8, 0, 4.7);
  private readonly catPosition = new THREE.Vector3(-10.8, 0, 4.7);
  private readonly catVelocity = new THREE.Vector3();
  private readonly moveDirection = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private readonly currentCameraTarget = new THREE.Vector3(-8, 0, 0);
  private readonly ownerTarget = new THREE.Vector3();
  private readonly ownerRoutine = [
    new THREE.Vector3(10.8, 0, 4.1),
    new THREE.Vector3(1.7, 0, -3.55),
    new THREE.Vector3(10.2, 0, -3.85),
  ];
  private readonly colliders: RectCollider[] = [];
  private readonly supports: SupportSurface[] = [];
  private readonly props: DynamicProp[] = [];
  private readonly zones: Record<ZoneId, CameraZone>;
  private readonly objectives: Objective[] = [
    { id: "enter", text: "Slip into the kitchen", complete: false },
    { id: "distract", text: "Distract the owner with a meow", complete: false },
    { id: "mug", text: "Swipe the red mug off the table", complete: false },
    { id: "key", text: "Steal the brass key", complete: false },
    { id: "innocent", text: "Return to the box and act innocent", complete: false },
  ];

  private currentZone: ZoneId = "garden";
  private previousZone: ZoneId = "garden";
  private ownerState: OwnerState = "routine";
  private ownerRoutineIndex = 0;
  private ownerWait = 0;
  private zoneLabelTimer = 0;
  private toastTimer = 0;
  private pounceTimer = 0;
  private pounceCooldown = 0;
  private swipeTimer = 0;
  private meowTimer = 0;
  private elapsed = 0;
  private carryingKey = false;
  private started = false;
  private completed = false;
  private caughtCooldown = 0;
  private accumulator = 0;
  private lastFrameTime = performance.now() / 1000;
  private facingAngle = 0;
  private ownerFacing = Math.PI;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly objectiveElement: HTMLElement,
    private readonly promptElement: HTMLElement,
    private readonly toastElement: HTMLElement,
    private readonly cameraLabelElement: HTMLElement,
    private readonly successElement: HTMLElement,
  ) {
    this.zones = {
      garden: {
        id: "garden",
        label: "THE GARDEN",
        targetBase: new THREE.Vector3(-8.3, 0.6, 0),
        cameraBase: new THREE.Vector3(-17.4, 10.7, 13.2),
        deadX: 2.5,
        deadZ: 2.2,
        follow: 0.55,
      },
      kitchen: {
        id: "kitchen",
        label: "THE KITCHEN",
        targetBase: new THREE.Vector3(2.1, 0.7, -0.1),
        cameraBase: new THREE.Vector3(-2.8, 12.1, 14.9),
        deadX: 2.6,
        deadZ: 2.0,
        follow: 0.48,
      },
      dining: {
        id: "dining",
        label: "THE BREAKFAST ROOM",
        targetBase: new THREE.Vector3(10.4, 0.75, 0.3),
        cameraBase: new THREE.Vector3(18.8, 10.4, 11.4),
        deadX: 2.0,
        deadZ: 2.0,
        follow: 0.42,
      },
    };

    this.scene.background = new THREE.Color(0xd9caaa);
    this.scene.fog = new THREE.Fog(0xd9caaa, 24, 46);
    this.camera.position.copy(this.zones.garden.cameraBase);
    this.camera.lookAt(this.currentCameraTarget);

    this.buildLighting();
    this.buildLevel();
    this.buildCat();
    this.buildOwner();
    this.renderObjectives();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  start(): void {
    this.audio.unlock();
    this.started = true;
    this.lastFrameTime = performance.now() / 1000;
  }

  restart(): void {
    window.location.reload();
  }

  update(input: InputFrame): void {
    const now = performance.now() / 1000;
    const frameDelta = Math.min(0.05, now - this.lastFrameTime);
    this.lastFrameTime = now;

    if (this.started && !this.completed) {
      this.accumulator += frameDelta;
      let firstStep = true;
      while (this.accumulator >= FIXED_STEP) {
        const stepInput = firstStep
          ? input
          : { ...input, actionPressed: false, meowPressed: false, pouncePressed: false };
        this.fixedUpdate(FIXED_STEP, stepInput);
        this.accumulator -= FIXED_STEP;
        firstStep = false;
      }
    }

    this.updateCamera(frameDelta);
    this.updateVisuals(frameDelta);
    this.renderer.render(this.scene, this.camera);
  }

  private fixedUpdate(dt: number, input: InputFrame): void {
    this.elapsed += dt;
    this.pounceCooldown = Math.max(0, this.pounceCooldown - dt);
    this.swipeTimer = Math.max(0, this.swipeTimer - dt);
    this.meowTimer = Math.max(0, this.meowTimer - dt);
    this.caughtCooldown = Math.max(0, this.caughtCooldown - dt);
    this.zoneLabelTimer = Math.max(0, this.zoneLabelTimer - dt);
    this.toastTimer = Math.max(0, this.toastTimer - dt);

    this.handleActions(input);
    this.updateCat(dt, input);
    this.updateProps(dt);
    this.updateOwner(dt);
    this.updateObjectives();
    this.updateZone();
    this.updateUiTimers();
  }

  private handleActions(input: InputFrame): void {
    if (input.meowPressed && this.meowTimer <= 0) {
      this.meowTimer = 0.85;
      this.audio.meow();
      this.alertOwner(this.catPosition, "meow");
      if (!this.objectives[1]?.complete) this.completeObjective("distract", "The human has taken the bait.");
    }

    if (input.pouncePressed && this.pounceCooldown <= 0) {
      this.pounceTimer = 0.46;
      this.pounceCooldown = 0.72;
      const forward = new THREE.Vector3(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
      this.catVelocity.addScaledVector(forward, 4.6);
    }

    if (input.actionPressed && this.swipeTimer <= 0) {
      if (this.tryKeyInteraction()) return;
      if (this.tryActInnocent()) return;
      this.swipeTimer = 0.34;
      this.swipeNearestProp();
    }
  }

  private updateCat(dt: number, input: InputFrame): void {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();

    this.moveDirection.set(0, 0, 0)
      .addScaledVector(right, input.moveX)
      .addScaledVector(forward, input.moveY);
    const inputMagnitude = Math.min(1, this.moveDirection.length());
    if (inputMagnitude > 0.001) this.moveDirection.normalize();

    const baseSpeed = input.run ? 5.5 : 3.5;
    const targetVelocity = this.moveDirection.multiplyScalar(baseSpeed * inputMagnitude);
    const acceleration = inputMagnitude > 0 ? 19 : 25;
    this.catVelocity.x = damp(this.catVelocity.x, targetVelocity.x, acceleration, dt);
    this.catVelocity.z = damp(this.catVelocity.z, targetVelocity.z, acceleration, dt);

    if (this.pounceTimer > 0) {
      this.pounceTimer = Math.max(0, this.pounceTimer - dt);
      const forwardImpulse = new THREE.Vector3(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
      this.catVelocity.addScaledVector(forwardImpulse, dt * 4.2);
    }

    const next = this.catPosition.clone().addScaledVector(this.catVelocity, dt);
    this.resolveWorldCollision(next, CAT_RADIUS);
    this.catPosition.copy(next);
    this.cat.position.set(this.catPosition.x, 0, this.catPosition.z);

    const planarSpeed = Math.hypot(this.catVelocity.x, this.catVelocity.z);
    if (planarSpeed > 0.15) {
      const targetAngle = Math.atan2(this.catVelocity.x, this.catVelocity.z);
      this.facingAngle = dampAngle(this.facingAngle, targetAngle, 13, dt);
    }
    this.cat.rotation.y = this.facingAngle;

    if (this.catPosition.x > -2.6 && !this.objectives[0]?.complete) {
      this.completeObjective("enter", "The kitchen has been infiltrated.");
    }
  }

  private updateProps(dt: number): void {
    for (const prop of this.props) {
      if (!prop.disturbed || prop.settled) continue;

      prop.velocity.y -= 12.5 * dt;
      prop.mesh.position.addScaledVector(prop.velocity, dt);
      prop.mesh.rotation.x += prop.velocity.z * dt * 1.1;
      prop.mesh.rotation.z -= prop.velocity.x * dt * 1.1;

      const support = this.sampleSupport(prop.mesh.position.x, prop.mesh.position.z);
      const floor = support + prop.radius;
      if (prop.mesh.position.y <= floor) {
        prop.mesh.position.y = floor;
        if (Math.abs(prop.velocity.y) > 2.1 && !prop.crashPlayed) {
          prop.crashPlayed = true;
          this.audio.crash();
          this.alertOwner(prop.mesh.position, "crash");
        }
        prop.velocity.y *= -0.23;
        prop.velocity.x *= 0.72;
        prop.velocity.z *= 0.72;
        if (prop.velocity.lengthSq() < 0.09) {
          prop.velocity.set(0, 0, 0);
          prop.settled = true;
        }
      }
    }
  }

  private updateOwner(dt: number): void {
    if (this.ownerState === "routine") {
      this.ownerTarget.copy(this.ownerRoutine[this.ownerRoutineIndex] ?? this.ownerRoutine[0]!);
      if (this.moveOwnerToward(this.ownerTarget, 1.25, dt)) {
        this.ownerWait += dt;
        if (this.ownerWait > 2.2) {
          this.ownerWait = 0;
          this.ownerRoutineIndex = (this.ownerRoutineIndex + 1) % this.ownerRoutine.length;
        }
      }
    } else if (this.ownerState === "investigating") {
      if (this.moveOwnerToward(this.ownerTarget, 2.0, dt)) {
        this.ownerWait += dt;
        if (this.ownerWait > 2.8) {
          this.ownerWait = 0;
          this.ownerState = "returning";
        }
      }
    } else {
      const routineTarget = this.ownerRoutine[this.ownerRoutineIndex] ?? this.ownerRoutine[0]!;
      if (this.moveOwnerToward(routineTarget, 1.5, dt)) this.ownerState = "routine";
    }

    const catDistance = this.owner.position.distanceTo(this.cat.position);
    if (
      catDistance < 1.35
      && this.catPosition.x > -3
      && this.caughtCooldown <= 0
      && this.ownerState !== "routine"
    ) {
      this.catchCat();
    }

    this.ownerAlert.visible = this.ownerState === "investigating";
  }

  private updateObjectives(): void {
    const mug = this.props.find((prop) => prop.id === "red-mug");
    if (mug?.disturbed && mug.mesh.position.y < 1.0 && !this.objectives[2]?.complete) {
      this.completeObjective("mug", "Breakfast has suffered a structural failure.");
    }
  }

  private updateZone(): void {
    let next = this.currentZone;
    if (this.currentZone === "garden" && this.catPosition.x > -2.65) next = "kitchen";
    else if (this.currentZone === "kitchen" && this.catPosition.x < -3.4) next = "garden";
    else if (this.currentZone === "kitchen" && this.catPosition.x > 7.35) next = "dining";
    else if (this.currentZone === "dining" && this.catPosition.x < 6.65) next = "kitchen";

    if (next !== this.currentZone) {
      this.previousZone = this.currentZone;
      this.currentZone = next;
      this.zoneLabelTimer = 1.7;
      this.cameraLabelElement.textContent = this.zones[next].label;
      this.cameraLabelElement.classList.add("visible");
    }
  }

  private updateCamera(dt: number): void {
    const zone = this.zones[this.currentZone];
    const offsetX = deadZoneOffset(this.catPosition.x - zone.targetBase.x, zone.deadX);
    const offsetZ = deadZoneOffset(this.catPosition.z - zone.targetBase.z, zone.deadZ);

    this.desiredCameraTarget.copy(zone.targetBase);
    this.desiredCameraTarget.x += offsetX * zone.follow;
    this.desiredCameraTarget.z += offsetZ * zone.follow;
    this.desiredCameraTarget.y += 0.12;

    this.desiredCameraPosition.copy(zone.cameraBase);
    this.desiredCameraPosition.x += offsetX * zone.follow * 0.65;
    this.desiredCameraPosition.z += offsetZ * zone.follow * 0.42;

    const cameraRate = this.previousZone === this.currentZone ? 4.8 : 2.7;
    this.camera.position.lerp(this.desiredCameraPosition, 1 - Math.exp(-cameraRate * dt));
    this.currentCameraTarget.lerp(this.desiredCameraTarget, 1 - Math.exp(-5.2 * dt));
    this.camera.lookAt(this.currentCameraTarget);

    if (this.camera.position.distanceToSquared(this.desiredCameraPosition) < 0.02) {
      this.previousZone = this.currentZone;
    }
  }

  private updateVisuals(_dt: number): void {
    const speed = Math.hypot(this.catVelocity.x, this.catVelocity.z);
    const walkPhase = this.elapsed * (5.5 + speed * 1.2);
    const pounceProgress = this.pounceTimer > 0 ? 1 - this.pounceTimer / 0.46 : 0;
    const hop = this.pounceTimer > 0 ? Math.sin(pounceProgress * Math.PI) * 0.72 : 0;
    this.catVisual.position.y = 0.54 + hop + Math.sin(walkPhase) * Math.min(0.045, speed * 0.009);
    this.catVisual.rotation.z = Math.sin(walkPhase) * Math.min(0.035, speed * 0.008);
    this.catTail.rotation.z = -0.45 + Math.sin(this.elapsed * 3.6) * 0.22;
    this.catTail.rotation.y = Math.sin(this.elapsed * 2.1) * 0.14;

    const leftPaw = this.cat.getObjectByName("left-paw");
    if (leftPaw) {
      const swipeProgress = this.swipeTimer > 0 ? 1 - this.swipeTimer / 0.34 : 0;
      leftPaw.rotation.x = this.swipeTimer > 0 ? -Math.sin(swipeProgress * Math.PI) * 1.5 : 0;
    }

    const mouth = this.cat.getObjectByName("mouth-anchor");
    if (mouth && this.carryingKey) {
      mouth.getWorldPosition(this.keyMesh.position);
      this.keyMesh.position.y -= 0.05;
      this.keyMesh.rotation.set(Math.PI / 2, this.facingAngle, 0);
    }

    this.promptElement.textContent = this.getPrompt();
    this.promptElement.classList.toggle("visible", this.promptElement.textContent.length > 0 && this.started && !this.completed);
  }

  private updateUiTimers(): void {
    if (this.zoneLabelTimer <= 0) this.cameraLabelElement.classList.remove("visible");
    if (this.toastTimer <= 0) this.toastElement.classList.remove("visible");
  }

  private getPrompt(): string {
    if (!this.started || this.completed) return "";
    if (this.canActInnocent()) return "E / PAW — curl up and look innocent";
    if (this.canTakeKey()) return "E / PAW — steal the brass key";
    const prop = this.findNearestProp(1.65);
    if (prop) return "E / PAW — swipe " + (prop.id === "red-mug" ? "the red mug" : "this object");
    return "";
  }

  private tryKeyInteraction(): boolean {
    if (!this.canTakeKey()) return false;
    this.carryingKey = true;
    this.keyMesh.visible = true;
    this.completeObjective("key", "Evidence acquired. Do not look suspicious.");
    return true;
  }

  private canTakeKey(): boolean {
    if (this.carryingKey || this.objectives[3]?.complete) return false;
    return this.catPosition.distanceTo(new THREE.Vector3(5.3, 0, -5.05)) < 1.35;
  }

  private tryActInnocent(): boolean {
    if (!this.canActInnocent()) return false;
    this.completeObjective("innocent", "No one suspects a thing.");
    this.completed = true;
    this.catVelocity.set(0, 0, 0);
    this.audio.success();
    window.setTimeout(() => this.successElement.classList.add("visible"), 350);
    return true;
  }

  private canActInnocent(): boolean {
    return this.carryingKey
      && this.objectives.slice(0, 4).every((objective) => objective.complete)
      && this.catPosition.distanceTo(this.boxPosition) < 1.6;
  }

  private swipeNearestProp(): void {
    const prop = this.findNearestProp(1.7);
    if (!prop) {
      this.showToast("An indignant little paw swipe.");
      return;
    }
    const away = prop.mesh.position.clone().sub(this.cat.position);
    away.y = 0;
    if (away.lengthSq() < 0.001) away.set(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
    away.normalize();
    prop.disturbed = true;
    prop.settled = false;
    prop.velocity.addScaledVector(away, 4.4);
    prop.velocity.y = Math.max(prop.velocity.y, 2.7);
    this.alertOwner(prop.mesh.position, "swipe");
  }

  private findNearestProp(maxDistance: number): DynamicProp | null {
    let nearest: DynamicProp | null = null;
    let nearestDistance = maxDistance;
    for (const prop of this.props) {
      const dx = prop.mesh.position.x - this.catPosition.x;
      const dz = prop.mesh.position.z - this.catPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = prop;
      }
    }
    return nearest;
  }

  private alertOwner(position: THREE.Vector3, kind: "meow" | "crash" | "swipe"): void {
    this.ownerTarget.copy(this.makeAccessibleTarget(position));
    this.ownerState = "investigating";
    this.ownerWait = 0;
    if (kind === "crash") this.showToast("CRASH! The owner is investigating.");
  }


  private makeAccessibleTarget(position: THREE.Vector3): THREE.Vector3 {
    const target = new THREE.Vector3(position.x, 0, position.z);
    const margin = 0.64;
    for (const collider of this.colliders) {
      const minX = collider.minX - margin;
      const maxX = collider.maxX + margin;
      const minZ = collider.minZ - margin;
      const maxZ = collider.maxZ + margin;
      if (target.x < minX || target.x > maxX || target.z < minZ || target.z > maxZ) continue;

      const exits = [
        { distance: Math.abs(target.x - minX), axis: "x" as const, value: minX },
        { distance: Math.abs(maxX - target.x), axis: "x" as const, value: maxX },
        { distance: Math.abs(target.z - minZ), axis: "z" as const, value: minZ },
        { distance: Math.abs(maxZ - target.z), axis: "z" as const, value: maxZ },
      ].sort((a, b) => a.distance - b.distance);
      const exit = exits[0];
      if (!exit) continue;
      target[exit.axis] = exit.value;
    }
    target.x = THREE.MathUtils.clamp(target.x, -13.4, 13.4);
    target.z = THREE.MathUtils.clamp(target.z, -7.0, 7.0);
    return target;
  }

  private catchCat(): void {
    this.caughtCooldown = 3;
    this.catPosition.copy(this.boxPosition).add(new THREE.Vector3(0, 0, -1.2));
    this.catVelocity.set(0, 0, 0);
    this.cat.position.set(this.catPosition.x, 0, this.catPosition.z);
    this.ownerState = "returning";
    this.ownerWait = 0;
    if (this.carryingKey) {
      this.carryingKey = false;
      this.keyMesh.position.set(5.3, 1.5, -5.05);
      const objective = this.objectives.find((item) => item.id === "key");
      if (objective) objective.complete = false;
      this.renderObjectives();
    }
    this.showToast("Caught! Deposited outside with great dignity.");
  }

  private moveOwnerToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    const direction = target.clone().sub(this.owner.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.18) return true;
    direction.normalize();
    const next = this.owner.position.clone().addScaledVector(direction, Math.min(distance, speed * dt));
    this.resolveWorldCollision(next, 0.48);
    this.owner.position.copy(next);
    const targetAngle = Math.atan2(direction.x, direction.z);
    this.ownerFacing = dampAngle(this.ownerFacing, targetAngle, 8, dt);
    this.owner.rotation.y = this.ownerFacing;
    return false;
  }

  private resolveWorldCollision(position: THREE.Vector3, radius: number): void {
    position.x = THREE.MathUtils.clamp(position.x, -14.15 + radius, 14.15 - radius);
    position.z = THREE.MathUtils.clamp(position.z, -7.7 + radius, 7.7 - radius);

    for (const collider of this.colliders) {
      const closestX = THREE.MathUtils.clamp(position.x, collider.minX, collider.maxX);
      const closestZ = THREE.MathUtils.clamp(position.z, collider.minZ, collider.maxZ);
      let dx = position.x - closestX;
      let dz = position.z - closestZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= radius * radius) continue;

      if (distanceSq < 0.000001) {
        const left = Math.abs(position.x - collider.minX);
        const right = Math.abs(collider.maxX - position.x);
        const top = Math.abs(position.z - collider.minZ);
        const bottom = Math.abs(collider.maxZ - position.z);
        const minimum = Math.min(left, right, top, bottom);
        if (minimum === left) position.x = collider.minX - radius;
        else if (minimum === right) position.x = collider.maxX + radius;
        else if (minimum === top) position.z = collider.minZ - radius;
        else position.z = collider.maxZ + radius;
        continue;
      }

      const distance = Math.sqrt(distanceSq);
      dx /= distance;
      dz /= distance;
      const penetration = radius - distance;
      position.x += dx * penetration;
      position.z += dz * penetration;
    }
  }

  private sampleSupport(x: number, z: number): number {
    let height = 0;
    for (const surface of this.supports) {
      if (x >= surface.minX && x <= surface.maxX && z >= surface.minZ && z <= surface.maxZ) {
        height = Math.max(height, surface.top);
      }
    }
    return height;
  }

  private completeObjective(id: string, toast: string): void {
    const objective = this.objectives.find((item) => item.id === id);
    if (!objective || objective.complete) return;
    objective.complete = true;
    this.renderObjectives();
    this.showToast(toast);
  }

  private renderObjectives(): void {
    const nextIndex = this.objectives.findIndex((objective) => !objective.complete);
    this.objectiveElement.innerHTML = `
      <h2>MORNING AGENDA</h2>
      ${this.objectives.map((objective, index) => `
        <div class="objective ${objective.complete ? "complete" : ""} ${index === nextIndex ? "current" : ""}">
          <span class="box"></span><span>${objective.text}</span>
        </div>
      `).join("")}
    `;
  }

  private showToast(message: string): void {
    this.toastElement.textContent = message;
    this.toastElement.classList.add("visible");
    this.toastTimer = 2.2;
  }

  private buildLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xfff2d2, 0x758b68, 2.1);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff3d2, 3.1);
    sun.position.set(-8, 15, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 45;
    this.scene.add(sun);
  }

  private buildLevel(): void {
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xc6b27e, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(29, 0.24, 16), groundMaterial);
    floor.position.y = -0.13;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const gardenFloor = new THREE.Mesh(
      new THREE.BoxGeometry(10.6, 0.03, 15.4),
      new THREE.MeshStandardMaterial({ color: 0x9fb27a, roughness: 1 }),
    );
    gardenFloor.position.set(-8.45, 0.01, 0);
    gardenFloor.receiveShadow = true;
    this.scene.add(gardenFloor);

    const kitchenFloor = new THREE.Mesh(
      new THREE.BoxGeometry(9.8, 0.035, 15.4),
      new THREE.MeshStandardMaterial({ color: 0xead8ac, roughness: 1 }),
    );
    kitchenFloor.position.set(2, 0.02, 0);
    kitchenFloor.receiveShadow = true;
    this.scene.add(kitchenFloor);

    const diningFloor = new THREE.Mesh(
      new THREE.BoxGeometry(7.1, 0.035, 15.4),
      new THREE.MeshStandardMaterial({ color: 0xcaa98d, roughness: 1 }),
    );
    diningFloor.position.set(10.5, 0.02, 0);
    diningFloor.receiveShadow = true;
    this.scene.add(diningFloor);

    this.addWall(-3, -4.8, 0.35, 6.2);
    this.addWall(-3, 4.8, 0.35, 6.2);
    this.addWall(7, -5.3, 0.35, 5.2);
    this.addWall(7, 4.1, 0.35, 7.4);

    this.addFurniture(new THREE.Vector3(2.2, 0.58, 1.8), new THREE.Vector3(4.1, 1.15, 2.25), 0x8d6d4f, true);
    this.supports.push({ minX: 0.15, maxX: 4.25, minZ: 0.68, maxZ: 2.93, top: 1.16 });
    this.colliders.push({ minX: 0.5, maxX: 3.9, minZ: 0.95, maxZ: 2.65 });

    this.addFurniture(new THREE.Vector3(4.7, 0.67, -5.35), new THREE.Vector3(4.2, 1.34, 1.5), 0x81978a, true);
    this.supports.push({ minX: 2.6, maxX: 6.8, minZ: -6.1, maxZ: -4.6, top: 1.35 });
    this.colliders.push({ minX: 2.8, maxX: 6.65, minZ: -5.95, maxZ: -4.75 });

    this.addFurniture(new THREE.Vector3(10.5, 0.58, 2.1), new THREE.Vector3(4.5, 1.15, 2.4), 0x785d47, true);
    this.supports.push({ minX: 8.25, maxX: 12.75, minZ: 0.9, maxZ: 3.3, top: 1.16 });
    this.colliders.push({ minX: 8.55, maxX: 12.45, minZ: 1.15, maxZ: 3.05 });

    this.addFurniture(new THREE.Vector3(8.4, 0.45, -4.1), new THREE.Vector3(1.5, 0.9, 1.5), 0x9b7b61, true);
    this.colliders.push({ minX: 7.72, maxX: 9.08, minZ: -4.78, maxZ: -3.42 });

    this.addCardboardBox();
    this.addPlants();
    this.addProp("red-mug", new THREE.Vector3(3.25, 1.48, 1.58), 0xd64e3b, 0.24);
    this.addProp("blue-cup", new THREE.Vector3(1.36, 1.45, 2.15), 0x4c7d91, 0.22);
    this.addProp("fruit-bowl", new THREE.Vector3(10.3, 1.45, 2.1), 0xe5b84f, 0.34);

    this.keyMesh.position.set(5.3, 1.51, -5.05);
    this.keyMesh.visible = true;
    this.scene.add(this.keyMesh);

    this.addDoorFrame(-3, 0);
    this.addDoorFrame(7, -1.1);
  }

  private buildCat(): void {
    const fur = new THREE.MeshStandardMaterial({ color: 0x3e3a35, roughness: 0.92 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe7ddc4, roughness: 0.95 });
    const eye = new THREE.MeshStandardMaterial({ color: 0xc9d95f, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 18, 12), fur);
    body.scale.set(1.25, 0.78, 1.55);
    body.castShadow = true;
    this.catVisual.add(body);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 10), cream);
    chest.scale.set(0.85, 0.85, 0.45);
    chest.position.set(0, -0.03, 0.57);
    this.catVisual.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.39, 18, 12), fur);
    head.position.set(0, 0.17, 0.69);
    head.scale.set(1, 0.93, 0.92);
    head.castShadow = true;
    this.catVisual.add(head);

    const earGeometry = new THREE.ConeGeometry(0.18, 0.36, 3);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeometry, fur);
      ear.position.set(side * 0.23, 0.52, 0.7);
      ear.rotation.z = side * -0.16;
      ear.rotation.x = -0.05;
      this.catVisual.add(ear);

      const catEye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), eye);
      catEye.scale.set(1.0, 1.35, 0.45);
      catEye.position.set(side * 0.145, 0.22, 1.03);
      this.catVisual.add(catEye);
    }

    const pawGeometry = new THREE.CapsuleGeometry(0.12, 0.36, 4, 8);
    for (const [name, x, z] of [
      ["left-paw", -0.31, 0.46],
      ["right-paw", 0.31, 0.46],
      ["back-left", -0.32, -0.48],
      ["back-right", 0.32, -0.48],
    ] as const) {
      const paw = new THREE.Mesh(pawGeometry, fur);
      paw.name = name;
      paw.position.set(x, -0.42, z);
      paw.rotation.z = Math.PI;
      paw.castShadow = true;
      this.catVisual.add(paw);
    }

    const tailSegment = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 1.0, 5, 10), fur);
    tailSegment.position.y = 0.56;
    tailSegment.rotation.x = Math.PI / 2;
    this.catTail.position.set(0, 0.04, -0.72);
    this.catTail.add(tailSegment);
    this.catVisual.add(this.catTail);

    const mouthAnchor = new THREE.Object3D();
    mouthAnchor.name = "mouth-anchor";
    mouthAnchor.position.set(0, 0.1, 1.1);
    this.catVisual.add(mouthAnchor);

    this.catVisual.position.y = 0.54;
    this.cat.add(this.catVisual);
    this.cat.position.copy(this.catPosition);
    this.scene.add(this.cat);
  }

  private buildOwner(): void {
    const clothes = new THREE.MeshStandardMaterial({ color: 0x567a78, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc88f6b, roughness: 0.92 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x44362d, roughness: 1 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.05, 6, 12), clothes);
    body.position.y = 1.15;
    body.castShadow = true;
    this.owner.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), skin);
    head.position.y = 2.08;
    head.castShadow = true;
    this.owner.add(head);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    hairCap.position.y = 2.16;
    this.owner.add(hairCap);

    this.ownerAlert.position.set(0, 2.75, 0);
    this.ownerAlert.visible = false;
    this.owner.add(this.ownerAlert);

    this.owner.position.copy(this.ownerRoutine[0]!);
    this.scene.add(this.owner);
  }

  private addWall(x: number, z: number, width: number, depth: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, 3.4, depth),
      new THREE.MeshStandardMaterial({ color: 0xf1e3bd, roughness: 1 }),
    );
    mesh.position.set(x, 1.7, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  }

  private addDoorFrame(x: number, z: number): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x745c48, roughness: 1 });
    for (const dz of [-1.72, 1.72]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.8, 0.3), material);
      side.position.set(x, 1.9, z + dz);
      side.castShadow = true;
      this.scene.add(side);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 3.75), material);
    top.position.set(x, 3.65, z);
    top.castShadow = true;
    this.scene.add(top);
  }

  private addFurniture(position: THREE.Vector3, size: THREE.Vector3, color: number, castShadow: boolean): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
    );
    mesh.position.copy(position);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private addCardboardBox(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0xa97945, roughness: 1 });
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.8), material);
    bottom.position.copy(this.boxPosition).add(new THREE.Vector3(0, 0.09, 0));
    bottom.receiveShadow = true;
    this.scene.add(bottom);
    for (const [x, z, w, d] of [
      [-1.12, 0, 0.16, 1.8], [1.12, 0, 0.16, 1.8], [0, -0.82, 2.4, 0.16], [0, 0.82, 2.4, 0.16],
    ] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.52, d), material);
      wall.position.set(this.boxPosition.x + x, 0.26, this.boxPosition.z + z);
      wall.castShadow = true;
      this.scene.add(wall);
    }
  }

  private addPlants(): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8d6347, roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x54734d, roughness: 1 });
    for (const [x, z, scale] of [[-12.5, -5.4, 1], [-7.4, -6.2, 0.8], [-11.9, 0.3, 0.65]] as const) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.5 * scale, 7), trunkMaterial);
      trunk.position.set(x, 0.75 * scale, z);
      trunk.castShadow = true;
      this.scene.add(trunk);
      const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75 * scale, 0), leafMaterial);
      leaves.position.set(x, 1.65 * scale, z);
      leaves.castShadow = true;
      this.scene.add(leaves);
    }
  }

  private addProp(id: string, position: THREE.Vector3, color: number, radius: number): void {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.83, radius, radius * 1.8, 14), material);
    body.castShadow = true;
    group.add(body);
    if (id.includes("mug") || id.includes("cup")) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.56, radius * 0.15, 7, 12), material);
      handle.rotation.y = Math.PI / 2;
      handle.position.x = radius * 0.9;
      group.add(handle);
    }
    group.position.copy(position);
    this.scene.add(group);
    this.props.push({ id, mesh: group, velocity: new THREE.Vector3(), radius, disturbed: false, settled: false, crashPlayed: false });
  }

  private createKey(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xd7ae48, metalness: 0.45, roughness: 0.38 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 18), material);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.42), material);
    stem.position.z = -0.28;
    group.add(stem);
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.08), material);
    tooth.position.set(0.055, 0, -0.47);
    group.add(tooth);
    group.scale.setScalar(0.8);
    return group;
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, width < 900 ? 1.35 : 1.8);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-rate * dt));
}

function deadZoneOffset(value: number, deadZone: number): number {
  if (Math.abs(value) <= deadZone) return 0;
  return Math.sign(value) * (Math.abs(value) - deadZone);
}
