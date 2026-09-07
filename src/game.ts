import * as THREE from "three";
import type { InputFrame } from "./input";
import { TinyAudio } from "./audio";
import type { GameSettings } from "./settings";
import { resolveInteraction, type InteractionCandidate } from "./core/gameplay";
import {
  isCatastropheReady, OBJECTIVE_DEFINITIONS, OPTIONAL_OBJECTIVE_DEFINITIONS,
} from "./core/level-model";
import { clamp, damp, dampAngle, smoothstep } from "./core/math";
import {
  OWNER_SIGHT, evaluateSight, rangeAtAngle, searchPattern,
  type SearchPoint, type SightResult,
} from "./core/perception";
import { AStarPathfinder, type NavigationPoint } from "./core/pathfinding";
import { buildCat, type CatRig } from "./models/cat";
import { buildOwner, type OwnerRig } from "./models/owner";
import { buildMugShards, buildBook, buildFruitBowl, buildKettle, buildKey, buildMouseToy, buildMug, buildSausage, buildSock, buildSponge, type BuiltProp } from "./models/props";
import { CatAnimator, NEUTRAL_CAT_ANIMATION, type CatAnimationInput } from "./anim/cat-animator";
import { OwnerAnimator } from "./anim/owner-animator";
import { PhysicsWorld, type CharacterBody, type DynamicBody } from "./physics/physics-world";
import { buildLevel, type LevelHandles } from "./level/level-builder";
import {
  OWNER_ROUTINE, POINTS_OF_INTEREST, PROPS, SINK_BASIN, SPAWN, STATIONS, WORLD,
  type PropSpec, type StationSpec,
} from "./level/level-data";
import { CameraDirector } from "./camera/camera-director";
import { CatController, type CatFrameState } from "./cat/cat-controller";

type OwnerState = "routine" | "investigating" | "pursuing" | "searching" | "returning";

interface Objective {
  id: string;
  text: string;
  complete: boolean;
  optional?: boolean;
}

interface LiveProp {
  readonly spec: PropSpec;
  readonly object: THREE.Object3D;
  readonly body: DynamicBody;
  readonly restOffset: number;
  readonly mass: number;
  broken: boolean;
  settledHeight: number;
}

const FIXED_STEP = 1 / 60;
/**
 * Catch-up ceiling. Eight steps lets a machine running at 10 FPS still advance
 * the simulation at real speed; beyond that the loop deliberately slows down
 * rather than spiralling into ever-longer frames.
 */
const MAX_FRAME_DELTA = FIXED_STEP * 8;
const CATCH_DISTANCE = 1.15;
const SWIPE_REACH = 0.95;
const CARRY_REACH = 0.75;
const OWNER_RADIUS = 0.34;
const OWNER_NAV_CELL = 0.4;
const OWNER_NAV_CLEARANCE = OWNER_RADIUS + 0.06;

export class CatscapadesGame {
  readonly scene = new THREE.Scene();
  // Keep the depth range proportional to the compact diorama. The former
  // 0.05–120 span discarded precision and amplified near-coplanar flicker on
  // Apple/WebGL depth buffers; fog already hides everything beyond 62 units.
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.18, 80);

  private readonly audio = new TinyAudio();
  private readonly cat: CatRig;
  private readonly catAnimator: CatAnimator;
  private readonly controller: CatController;
  private readonly owner: OwnerRig;
  private readonly ownerAnimator: OwnerAnimator;
  private readonly ownerBody: CharacterBody;
  private readonly ownerPathfinder = new AStarPathfinder({
    minX: WORLD.minX + OWNER_NAV_CLEARANCE,
    maxX: WORLD.maxX - OWNER_NAV_CLEARANCE,
    minZ: WORLD.minZ + OWNER_NAV_CLEARANCE,
    maxZ: WORLD.maxZ - OWNER_NAV_CLEARANCE,
  }, OWNER_NAV_CELL, OWNER_NAV_CLEARANCE);
  private readonly director: CameraDirector;
  private readonly level: LevelHandles;

  private readonly props: LiveProp[] = [];
  private readonly objectives: Objective[] = [
    ...OBJECTIVE_DEFINITIONS.map((objective) => ({ ...objective, complete: false })),
    ...OPTIONAL_OBJECTIVE_DEFINITIONS.map((objective) => ({ ...objective, complete: false, optional: true })),
  ];
  private readonly preparations = new Set<string>();

  private readonly catAnimation: CatAnimationInput = { ...NEUTRAL_CAT_ANIMATION };
  /** Ground covered since the last rendered frame, for the stride odometer. */
  private catTravel = 0;
  private catState: CatFrameState | null = null;
  private readonly ownerPosition = new THREE.Vector3();
  private readonly ownerTarget = new THREE.Vector3();
  private readonly ownerDesired = new THREE.Vector3();
  private readonly ownerLookAt = new THREE.Vector3();
  private readonly ownerPathGoal = new THREE.Vector3(
    Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY,
  );
  private readonly scratchVector = new THREE.Vector3();
  private readonly scratchVectorB = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly catFocus = new THREE.Vector3();

  private ownerState: OwnerState = "routine";
  /** Live sight evaluation, refreshed every fixed step. */
  private ownerSight: SightResult = { visible: false, clarity: 0, at: null, reason: "out-of-range" };
  /** Where the cat was last actually seen, and how long ago. */
  private readonly ownerLastSeen = new THREE.Vector3();
  private ownerLastSeenAge = Infinity;
  private ownerLastSeenHeading = 0;
  private ownerHasLastSeen = false;
  /** Search sweep around the last known position. */
  private ownerSearchPoints: readonly SearchPoint[] = [];
  private ownerSearchIndex = 0;
  private ownerSearchTime = 0;
  private ownerSearchHeading = 0;
  /** Sight sample points on the cat, reused every frame. */
  private readonly sightSamples = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ];
  private ownerStop = 0;
  private ownerDwell = 0;
  private ownerFacing = Math.PI;
  private ownerSpeed = 0;
  private ownerAlarm = 0;
  private ownerSurprise = 0;
  private ownerReach = 0;
  private ownerCarrying = false;
  private ownerPath: readonly NavigationPoint[] = [];
  private ownerWaypoint = 0;
  private ownerPathAge = Number.POSITIVE_INFINITY;
  private ownerPathValid = false;
  private ownerPathComplete = false;
  private ownerPathReachedGoal = false;
  private ownerStuckTime = 0;
  private suspicion = 0;

  private carrying: LiveProp | null = null;
  private sinkRunning = false;
  private sinkTimer = 0;
  private cupboardOpen = false;
  private flourSpilled = false;
  private mugBroken = false;
  private catastrophe = false;
  private caughtCount = 0;

  private swipeTimer = 0;
  private meowTimer = 0;
  private caughtCooldown = 0;
  private innocenceWeight = 0;
  private catchSequence = 0;
  private toastTimer = 0;
  private zoneLabelTimer = 0;
  private elapsed = 0;

  private started = false;
  private completed = false;
  private paused = false;
  private debugVisible = false;
  private debugLines: THREE.LineSegments | null = null;
  private sightCone: THREE.Mesh | null = null;
  private debugLinesAge = 0;
  private accumulator = 0;
  private lastFrameTime = performance.now() / 1000;
  private smoothedFrameRate = 60;
  private inputMethod: InputFrame["method"] = "keyboard";
  private currentPrompt = "";
  private stalkRequested = false;
  private settings: GameSettings = {
    masterVolume: 0.8, effectsVolume: 0.8, musicVolume: 0.35,
    graphics: "high", reducedMotion: false, highContrast: false,
  };

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly physics: PhysicsWorld,
    private readonly objectiveElement: HTMLElement,
    private readonly promptElement: HTMLElement,
    private readonly toastElement: HTMLElement,
    private readonly cameraLabelElement: HTMLElement,
    private readonly successElement: HTMLElement,
  ) {
    this.level = buildLevel(this.scene, physics);
    // Rapier's query pipeline is populated by `step`, so a world that has not
    // stepped answers every raycast with "nothing there" — which would let the
    // homeowner see through walls on the first frame. Step once up front.
    physics.step();

    this.cat = buildCat();
    this.cat.root.position.copy(SPAWN.cat);
    this.scene.add(this.cat.root);
    this.catAnimator = new CatAnimator(this.cat);
    this.controller = new CatController(physics, SPAWN.cat.clone());

    this.owner = buildOwner();
    this.owner.root.position.copy(SPAWN.owner);
    this.scene.add(this.owner.root);
    this.ownerAnimator = new OwnerAnimator(this.owner);
    this.ownerPosition.copy(SPAWN.owner);
    this.ownerBody = physics.createCharacter(
      SPAWN.owner.clone(), OWNER_RADIUS, 0.62, { autostep: 0.3, snap: 0.35 },
    );

    this.buildProps();

    this.director = new CameraDirector(this.camera, "garden");
    this.renderObjectives();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Rapier ships as WASM, so construction is asynchronous. */
  static async create(
    renderer: THREE.WebGLRenderer,
    objectiveElement: HTMLElement,
    promptElement: HTMLElement,
    toastElement: HTMLElement,
    cameraLabelElement: HTMLElement,
    successElement: HTMLElement,
  ): Promise<CatscapadesGame> {
    const physics = await PhysicsWorld.create();
    return new CatscapadesGame(
      renderer, physics, objectiveElement, promptElement, toastElement, cameraLabelElement, successElement,
    );
  }

  start(): void {
    this.audio.startMusic();
    this.started = true;
    this.lastFrameTime = performance.now() / 1000;
  }

  hasStarted(): boolean {
    return this.started;
  }

  setPaused(value: boolean): void {
    this.paused = value;
    this.audio.setPaused(value);
    this.lastFrameTime = performance.now() / 1000;
    this.accumulator = 0;
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    document.querySelector("#debug-panel")?.classList.toggle("visible", this.debugVisible);
    if (this.debugLines) this.debugLines.visible = this.debugVisible;
    if (this.sightCone) this.sightCone.visible = this.debugVisible;
  }

  applySettings(settings: GameSettings): void {
    this.settings = settings;
    this.audio.setVolume(settings.masterVolume, settings.effectsVolume, settings.musicVolume);
    this.renderer.shadowMap.enabled = settings.graphics === "high";
    this.renderer.shadowMap.needsUpdate = true;
    document.body.classList.toggle("high-contrast", settings.highContrast);
    this.resize();
  }

  restart(): void {
    window.location.reload();
  }

  /**
   * Development-only: drop the cat at a world position. The capture tooling
   * uses this to photograph a specific room or traversal without scripting a
   * two-minute walk to get there. Never called from gameplay code.
   */
  debugTeleport(x: number, z: number, y = 1.2): void {
    this.controller.teleport(this.scratchVector.set(x, y, z));
    this.catAnimator.resetSecondaryMotion();
    this.catTravel = 0;
    this.director.updateZone(x, z);
  }

  /**
   * Development-only: advances the simulation by wall-clock-independent fixed
   * steps with a synthetic input frame. Headless capture renders through
   * SwiftShader at a few frames per second, which would otherwise put the
   * fixed-step loop into slow motion and make scripted routes meaningless.
   */
  debugStep(seconds: number, input: Partial<InputFrame> = {}): void {
    const frame: InputFrame = {
      moveX: 0, moveY: 0, run: false, stalk: false,
      actionPressed: false, meowPressed: false, pouncePressed: false,
      pausePressed: false, debugPressed: false, method: this.inputMethod,
      ...input,
    };
    const steps = Math.max(1, Math.round(seconds / FIXED_STEP));
    for (let index = 0; index < steps; index += 1) {
      this.fixedUpdate(FIXED_STEP, index === 0 ? frame : consumeEdges(frame));
    }
    // Presentation is driven from the same deltas so animation state matches.
    this.updateCamera(seconds);
    this.updateAnimation(seconds);
    this.updatePresentation(seconds);
    this.lastFrameTime = performance.now() / 1000;
    this.accumulator = 0;
  }

  /** Development-only snapshot of simulation state, for automated checks. */
  debugSnapshot(): Record<string, unknown> {
    const state = this.catState;
    return {
      position: state ? [state.position.x, state.position.y, state.position.z] : null,
      grounded: state?.grounded ?? null,
      speed: state?.planarSpeed ?? 0,
      gait: this.catAnimator.currentGait(),
      jumpTarget: this.controller.availableJumpTarget()?.id ?? null,
      prompt: this.currentPrompt,
      cameraZone: this.director.currentZoneId(),
      carrying: this.carrying?.spec.id ?? null,
      preparations: [...this.preparations],
      mugBroken: this.mugBroken,
      ownerState: this.ownerState,
      ownerSight: {
        reason: this.ownerSight.reason,
        clarity: Number(this.ownerSight.clarity.toFixed(3)),
        lastSeenAge: this.ownerHasLastSeen ? Number(this.ownerLastSeenAge.toFixed(2)) : null,
      },
      ownerRoute: {
        algorithm: "A*",
        remainingWaypoints: Math.max(0, this.ownerPath.length - this.ownerWaypoint),
        reachesRequestedGoal: this.ownerPathReachedGoal,
      },
      suspicion: Math.round(this.suspicion),
      objectives: this.objectives.filter((objective) => objective.complete).map((objective) => objective.id),
      frameRate: Math.round(this.smoothedFrameRate),
    };
  }

  update(input: InputFrame): void {
    const now = performance.now() / 1000;
    const rawDelta = Math.max(1e-4, now - this.lastFrameTime);
    // The simulation delta is clamped to stop a slow frame spiralling, but the
    // reported rate must be the real one or the overlay hides the stall.
    const frameDelta = Math.min(MAX_FRAME_DELTA, rawDelta);
    this.smoothedFrameRate = damp(this.smoothedFrameRate, 1 / rawDelta, 4, frameDelta);
    this.lastFrameTime = now;
    this.inputMethod = input.method;

    if (this.started && !this.completed && !this.paused) {
      this.accumulator = Math.min(this.accumulator + frameDelta, MAX_FRAME_DELTA);
      let firstStep = true;
      while (this.accumulator >= FIXED_STEP) {
        this.fixedUpdate(FIXED_STEP, firstStep ? input : consumeEdges(input));
        this.accumulator -= FIXED_STEP;
        firstStep = false;
      }
    }

    this.updateCamera(frameDelta);
    this.updateAnimation(frameDelta);
    this.updatePresentation(frameDelta);
    this.updateDebug(frameDelta);
    this.renderer.render(this.scene, this.camera);
  }

  // -- simulation ------------------------------------------------------------

  private fixedUpdate(dt: number, input: InputFrame): void {
    this.elapsed += dt;
    this.swipeTimer = Math.max(0, this.swipeTimer - dt);
    this.meowTimer = Math.max(0, this.meowTimer - dt);
    this.caughtCooldown = Math.max(0, this.caughtCooldown - dt);
    this.toastTimer = Math.max(0, this.toastTimer - dt);
    this.zoneLabelTimer = Math.max(0, this.zoneLabelTimer - dt);
    this.catchSequence = Math.max(0, this.catchSequence - dt);

    const controllable = this.catchSequence <= 0;
    this.stalkRequested = input.stalk && controllable;
    this.catState = this.controller.update(
      dt,
      {
        moveX: controllable ? input.moveX : 0,
        moveY: controllable ? input.moveY : 0,
        run: input.run,
        stalk: input.stalk,
        jumpPressed: controllable && input.pouncePressed,
        carrying: this.carrying !== null,
      },
      this.director.forward(this.scratchVector),
      this.director.right(this.scratchVectorB),
    );

    this.catTravel += this.catState.travel;

    this.updateOwner(dt);
    this.physics.step();

    this.cat.root.position.copy(this.catState.position);
    this.cat.root.rotation.y = this.catState.facing;
    this.ownerBody.feet(this.ownerPosition);
    this.owner.root.position.copy(this.ownerPosition);
    this.owner.root.rotation.y = this.ownerFacing;

    if (controllable) this.handleActions(input);
    this.updateWorldState(dt);
    this.updateObjectives();
    this.director.updateZone(this.catState.position.x, this.catState.position.z);
    if (this.director.consumeZoneChange()) {
      this.zoneLabelTimer = 1.8;
      this.cameraLabelElement.textContent = this.director.currentLabel();
      this.cameraLabelElement.classList.add("visible");
    }
  }

  private handleActions(input: InputFrame): void {
    if (input.meowPressed && this.meowTimer <= 0) {
      this.meowTimer = 0.9;
      this.audio.meow();
      if (this.carrying) {
        this.showToast("A muffled, entirely undignified mrrp.");
      } else {
        this.alertOwner(this.controller ? this.catPosition() : SPAWN.cat, "meow");
        this.completeObjective("distract", "The homeowner turns towards the noise.");
      }
    }

    if (!input.actionPressed || this.swipeTimer > 0) return;
    const choice = resolveInteraction(this.buildInteractionCandidates());
    if (!choice) {
      this.swipeTimer = 0.3;
      this.showToast("An indignant little paw swipe at nothing in particular.");
      return;
    }
    this.performInteraction(choice.id);
  }

  /**
   * Builds every legal interaction this frame and lets the shared resolver pick.
   * Objects never special-case themselves; they only describe what they offer.
   */
  private buildInteractionCandidates(): InteractionCandidate[] {
    const candidates: InteractionCandidate[] = [];
    const position = this.catPosition();
    const facing = this.catState?.facing ?? 0;

    if (this.carrying) {
      candidates.push({
        id: "drop", verb: "drop", distance: 0, facing: 1, priority: 3, relevant: true, enabled: true,
      });
      const sinkDistance = Math.hypot(
        position.x - SINK_BASIN.position[0],
        position.z - SINK_BASIN.position[2],
      );
      if (this.carrying.spec.id === "sock" && this.sinkRunning
        && position.y >= SINK_BASIN.minCatHeight
        && sinkDistance <= SINK_BASIN.interactionRadius) {
        this.scratchVector.set(
          SINK_BASIN.position[0], SINK_BASIN.position[1], SINK_BASIN.position[2],
        );
        candidates.push({
          id: "drop:sink", verb: "drop", distance: sinkDistance,
          facing: facingScore(position, facing, this.scratchVector),
          priority: 6, relevant: true, enabled: true,
        });
      }
    }

    for (const prop of this.props) {
      if (prop.broken || prop === this.carrying) continue;
      prop.body.position(this.scratchVector);
      const distance = this.scratchVector.distanceTo(position);
      const alignment = facingScore(position, facing, this.scratchVector);

      if (prop.spec.carryable && !this.carrying && distance < CARRY_REACH) {
        candidates.push({
          id: `carry:${prop.spec.id}`, verb: "grab", distance, facing: alignment,
          priority: prop.spec.id === "key" ? 4 : 2,
          relevant: prop.spec.id === "key" && !this.isComplete("key"),
          enabled: true,
        });
      }
      if (distance < SWIPE_REACH) {
        candidates.push({
          id: `swipe:${prop.spec.id}`, verb: "swipe", distance, facing: alignment,
          priority: prop.spec.fragile ? 2 : 1,
          relevant: Boolean(prop.spec.fragile) && this.preparations.size >= 2,
          enabled: true,
        });
      }
    }

    for (const station of STATIONS) {
      if (!this.isStationAvailable(station)) continue;
      this.scratchVector.set(station.position[0], station.position[1], station.position[2]);
      const distance = Math.hypot(this.scratchVector.x - position.x, this.scratchVector.z - position.z);
      if (distance > station.radius) continue;
      if (station.minHeight !== undefined && position.y < station.minHeight) continue;
      candidates.push({
        id: `station:${station.id}`, verb: station.id === "box" ? "innocent" : "activate",
        distance, facing: facingScore(position, facing, this.scratchVector),
        priority: station.id === "box" ? 5 : 3,
        relevant: station.id === "box" ? this.canActInnocent() : true,
        enabled: station.id !== "box" || this.canActInnocent(),
      });
    }

    return candidates;
  }

  private isStationAvailable(station: StationSpec): boolean {
    if (station.id === "sink") return !this.sinkRunning;
    if (station.id === "flour") return !this.flourSpilled;
    if (station.id === "cupboard") return !this.cupboardOpen;
    return true;
  }

  private performInteraction(id: string): void {
    const [kind, key = ""] = id.split(":");

    if (kind === "drop") {
      this.dropCarried(key === "sink" ? "sink" : undefined);
      return;
    }
    if (kind === "carry") {
      const prop = this.props.find((candidate) => candidate.spec.id === key);
      if (!prop) return;
      this.carrying = prop;
      prop.body.setCarried(true);
      this.audio.meow();
      if (key === "key") this.completeObjective("key", "The key is yours. The counter was no obstacle.");
      this.showToast(`Carrying ${prop.spec.label}.`);
      return;
    }
    if (kind === "swipe") {
      this.swipeTimer = 0.42;
      const prop = this.props.find((candidate) => candidate.spec.id === key);
      if (prop) this.swipeProp(prop);
      return;
    }
    if (kind === "station") {
      this.swipeTimer = 0.42;
      this.activateStation(key);
    }
  }

  private activateStation(id: string): void {
    if (id === "sink" && !this.sinkRunning) {
      this.sinkRunning = true;
      this.level.sinkStream.visible = true;
      this.level.sinkPool.visible = true;
      this.markPreparation("sink", "The tap gurgles into life. Nobody will notice for ages.");
      return;
    }
    if (id === "flour" && !this.flourSpilled) {
      this.flourSpilled = true;
      const sack = this.level.flourBag.parts?.sack;
      const spill = this.level.flourBag.parts?.spill;
      const cloud = this.level.flourBag.parts?.cloud;
      if (sack) {
        sack.rotation.z = 1.15;
        sack.position.y = -0.02;
        sack.scale.y = 0.62;
      }
      if (spill) spill.visible = true;
      if (cloud) cloud.visible = true;
      this.markPreparation("flour", "A white cloud settles over everything within reach.");
      return;
    }
    if (id === "cupboard" && !this.cupboardOpen) {
      this.cupboardOpen = true;
      this.markPreparation("cupboard", "The cupboard hangs open, deeply suspicious.");
      return;
    }
    if (id === "box") this.actInnocent();
  }

  private swipeProp(prop: LiveProp): void {
    prop.body.position(this.scratchVector);
    const away = this.scratchVector.clone().sub(this.catPosition());
    away.y = 0;
    if (away.lengthSq() < 1e-4) {
      const facing = this.catState?.facing ?? 0;
      away.set(Math.sin(facing), 0, Math.cos(facing));
    }
    // Impulse is scaled by mass so every prop leaves the paw at a similar
    // speed: a swipe is a flick of the wrist, not a fixed quantity of force.
    const launch = prop.spec.fragile ? 2.9 : 2.3;
    away.normalize().multiplyScalar(prop.mass * launch);
    away.y = prop.mass * 1.6;
    prop.body.applyImpulse(away, prop.mass * 0.5);
    this.audio.crash();
    this.emitStimulus(this.scratchVector, 1.1, "swipe");
  }

  private dropCarried(target?: "sink"): void {
    const prop = this.carrying;
    if (!prop) return;
    this.carrying = null;
    prop.body.setCarried(false);
    if (target === "sink") {
      this.scratchVector.set(
        SINK_BASIN.position[0], SINK_BASIN.position[1], SINK_BASIN.position[2],
      );
    } else {
      this.cat.mouthAnchor.getWorldPosition(this.scratchVector);
      this.scratchVector.y = Math.max(this.scratchVector.y, this.catPosition().y + prop.restOffset);
    }
    prop.body.teleport(this.scratchVector);

    if (prop.spec.id === "sock" && target === "sink") {
      this.completeObjective("sock-sink", "Sock soup. An ambitious new recipe.");
      return;
    }
    if (prop.spec.id === "key" && this.scratchVector.distanceTo(this.scratchVectorB.set(-11.4, 0.3, 4.1)) < 1.9) {
      this.completeObjective("key-box", "The key has joined your outdoor collection.");
    }
    this.showToast(`Dropped ${prop.spec.label}.`);
  }

  private actInnocent(): void {
    if (!this.canActInnocent()) return;
    this.completeObjective("innocent", "Fast asleep. Has been all morning, obviously.");
    this.completed = true;
    if (this.caughtCount === 0) this.completeObjective("uncaught", "Never once caught. Unbearably smug.");
    this.audio.stopMusic();
    this.audio.success();
    window.setTimeout(() => this.successElement.classList.add("visible"), 600);
  }

  private canActInnocent(): boolean {
    return this.catastrophe
      && this.objectives
        .filter((objective) => !objective.optional && objective.id !== "innocent")
        .every((objective) => objective.complete);
  }

  private markPreparation(id: string, message: string): void {
    if (this.preparations.has(id)) return;
    this.preparations.add(id);
    this.showToast(message);
    this.emitStimulus(this.catPosition(), 0.9, "swipe");
    this.renderObjectives();
  }

  // -- world state -----------------------------------------------------------

  private updateWorldState(dt: number): void {
    // Sink escalation: running → pooling → overflowing across the floor.
    if (this.sinkRunning) {
      this.sinkTimer += dt;
      const overflow = smoothstep(6, 14, this.sinkTimer);
      this.level.sinkOverflow.visible = overflow > 0.02;
      this.level.sinkOverflow.scale.set(0.4 + overflow, 1, 0.4 + overflow);
      this.level.puddle.visible = overflow > 0.15;
      this.level.puddle.scale.setScalar(Math.max(0.001, overflow * 1.5));
      if (overflow > 0.6 && !this.preparations.has("overflow")) {
        this.preparations.add("overflow");
        this.showToast("Water is now exploring the kitchen floor.");
      }
    }

    this.level.cupboardDoor.rotation.y = damp(
      this.level.cupboardDoor.rotation.y, this.cupboardOpen ? -1.32 : 0, 6, dt,
    );

    for (const prop of this.props) {
      prop.body.syncTo(prop.object);
      if (prop.broken) continue;
      prop.body.position(this.scratchVector);
      // A fragile prop that has fallen well below its rest height has broken.
      if (prop.spec.fragile && this.scratchVector.y < prop.settledHeight - 0.55 && prop.body.speed() < 0.6) {
        this.breakProp(prop);
      }
      if (!prop.spec.fragile && prop.body.speed() > 2.4) {
        this.emitStimulus(this.scratchVector, 0.8, "crash");
      }
    }
  }

  private breakProp(prop: LiveProp): void {
    prop.broken = true;
    prop.object.visible = false;
    prop.body.position(this.scratchVector);
    const shards = buildMugShards().object;
    shards.position.set(this.scratchVector.x, Math.max(0.02, this.scratchVector.y - 0.1), this.scratchVector.z);
    this.scene.add(shards);
    this.audio.crash();
    this.emitStimulus(this.scratchVector, 2.2, "crash");
    this.showToast("CRASH. That mug had been in the family for weeks.");

    if (prop.spec.id === "mug") this.mugBroken = true;
    if (!this.tryCompleteCatastrophe() && !this.catastrophe) {
      this.showToast("Satisfying — but the kitchen is not nearly ruined enough yet.");
    }
  }

  private tryCompleteCatastrophe(): boolean {
    if (this.catastrophe || !isCatastropheReady(this.mugBroken, this.preparations.size)) return false;
    this.catastrophe = true;
    this.completeObjective("catastrophe", "Flour. Water. Crockery. A perfectly ruined morning.");
    this.audio.success();
    this.suspicion = 100;
    return true;
  }

  // -- homeowner -------------------------------------------------------------

  /**
   * Evaluates what the homeowner can actually see, and remembers it.
   *
   * Pursuit and searching both work from `ownerLastSeen` rather than from the
   * cat's live position: that is what makes breaking line of sight worth
   * doing, and it is the whole reason the vision cone matters.
   */
  private updateOwnerSight(dt: number): void {
    const cat = this.catPosition();
    // Head, shoulder, and paws. Any one of them clearing the furniture is
    // enough, which is what makes a cat on the worktop exposed and the same
    // cat on the floor behind the counter hidden.
    this.sightSamples[0]!.set(cat.x, cat.y + 0.34, cat.z);
    this.sightSamples[1]!.set(cat.x, cat.y + 0.22, cat.z);
    this.sightSamples[2]!.set(cat.x, cat.y + 0.06, cat.z);

    const speed = this.catState?.planarSpeed ?? 0;
    this.ownerSight = evaluateSight(
      OWNER_SIGHT,
      {
        from: this.ownerPosition,
        facing: this.ownerFacing,
        targets: this.sightSamples,
        stillness: 1 - smoothstep(0.15, 2.4, speed),
        // Curled up in the box is real cover; a stalking crouch behind the
        // furniture line only helps a little, but it helps.
        concealment: clamp(
          this.innocenceWeight * 0.96 + (this.stalkRequested ? 0.22 : 0),
          0, 1,
        ),
      },
      (from, to) => this.physics.hasLineOfSight(from, to),
    );

    if (this.ownerSight.visible) {
      const seen = this.ownerSight.at ?? cat;
      if (this.ownerHasLastSeen) {
        // Remember which way it was heading, so a search looks on ahead first.
        const dx = seen.x - this.ownerLastSeen.x;
        const dz = seen.z - this.ownerLastSeen.z;
        if (Math.hypot(dx, dz) > 0.25) this.ownerLastSeenHeading = Math.atan2(dx, dz);
      }
      this.ownerLastSeen.set(seen.x, 0, seen.z);
      this.ownerLastSeenAge = 0;
      this.ownerHasLastSeen = true;
    } else {
      this.ownerLastSeenAge += dt;
    }
  }

  private updateOwner(dt: number): void {
    const catPosition = this.catPosition();
    const toCat = this.ownerPosition.distanceTo(catPosition);
    this.updateOwnerSight(dt);
    const sight = this.ownerSight;

    if (this.ownerState === "routine") {
      const stop = OWNER_ROUTINE[this.ownerStop] ?? OWNER_ROUTINE[0];
      if (stop) {
        this.ownerTarget.set(stop.position[0], 0, stop.position[1]);
        this.ownerReach = stop.action === "reach" ? 1 : 0;
        this.ownerCarrying = stop.action === "carry";
        if (stop.lookAt) this.ownerLookAt.set(stop.lookAt[0], stop.lookAt[1], stop.lookAt[2]);
        if (this.moveOwnerToward(this.ownerTarget, 1.35, dt)) {
          // Stood at the stop: face the thing being attended to.
          if (stop.lookAt) this.turnOwnerToward(stop.lookAt[0], stop.lookAt[2], dt);
          this.ownerDwell += dt;
          if (this.ownerDwell > stop.dwell) {
            this.ownerDwell = 0;
            this.ownerStop = (this.ownerStop + 1) % OWNER_ROUTINE.length;
          }
        }
      }
      // Suspicion now climbs with how plainly the cat is seen rather than with
      // raw proximity, so a clear look across the room escalates faster than a
      // glimpse at the edge of vision, and no look at all escalates nothing.
      if (sight.visible) {
        this.suspicion = Math.min(100, this.suspicion + dt * (8 + sight.clarity * 30));
        if (this.suspicion > 55) this.beginPursuit();
      } else {
        this.suspicion = Math.max(0, this.suspicion - dt * 6);
      }
    } else if (this.ownerState === "investigating") {
      this.ownerReach = 0;
      this.ownerCarrying = false;
      if (this.moveOwnerToward(this.ownerTarget, 2.1, dt)) {
        this.turnOwnerToward(this.ownerLookAt.x, this.ownerLookAt.z, dt);
        this.ownerDwell += dt;
        this.ownerReach = smoothstep(0.6, 1.4, this.ownerDwell);
        if (this.ownerDwell > 3.0) {
          this.ownerDwell = 0;
          this.ownerState = "returning";
        }
      }
      // An investigating homeowner is already looking hard, so a glimpse is
      // enough to escalate where the routine would need a proper look.
      if (sight.visible && sight.clarity > 0.12 && this.suspicion > 45) this.beginPursuit();
    } else if (this.ownerState === "pursuing") {
      // Chase the last *known* position. While the cat is in sight that is
      // effectively its live position; once it breaks away, the homeowner
      // commits to where it went rather than tracking it through the cupboards.
      const chase = this.ownerHasLastSeen ? this.ownerLastSeen : catPosition;
      this.ownerReach = sight.visible ? smoothstep(2.2, 1.2, toCat) : 0;
      this.ownerTarget.set(chase.x, 0, chase.z);
      this.moveOwnerToward(this.ownerTarget, 2.75, dt);
      if (sight.visible && sight.at) {
        this.ownerLookAt.set(sight.at.x, sight.at.y + 0.1, sight.at.z);
        this.turnOwnerToward(sight.at.x, sight.at.z, dt, 7);
      } else {
        this.ownerLookAt.set(chase.x, 0.5, chase.z);
        this.turnOwnerToward(chase.x, chase.z, dt, 6);
      }
      if (sight.visible && toCat < CATCH_DISTANCE && this.caughtCooldown <= 0
        && (this.catState?.grounded ?? true)) {
        this.catchCat();
      }
      this.suspicion = Math.max(0, this.suspicion - dt * 4);
      if (this.suspicion < 20 || this.innocenceWeight > 0.6) {
        this.ownerState = "returning";
        this.ownerDwell = 0;
      } else if (this.ownerLastSeenAge > 1.1) {
        this.beginSearch();
      }
    } else if (this.ownerState === "searching") {
      this.ownerReach = 0;
      this.ownerCarrying = false;
      this.ownerSearchTime += dt;
      const point = this.ownerSearchPoints[this.ownerSearchIndex];
      if (point) {
        this.ownerTarget.set(point.x, 0, point.z);
        this.ownerLookAt.set(point.x, 0.6, point.z);
        if (this.moveOwnerToward(this.ownerTarget, 2.1, dt)) {
          this.ownerDwell += dt;
          // Standing on the spot and staring straight ahead is not searching.
          // Sweep the body, which sweeps the vision cone with it, so a cat that
          // froze just off the search line can still be swept up.
          const sweep = this.ownerSearchHeading + Math.sin(this.ownerDwell * 2.4) * 1.15;
          this.ownerFacing = dampAngle(this.ownerFacing, sweep, 5, dt);
          this.ownerLookAt.set(
            this.ownerPosition.x + Math.sin(sweep) * 3,
            0.7,
            this.ownerPosition.z + Math.cos(sweep) * 3,
          );
          if (this.ownerDwell > 1.5) {
            this.ownerDwell = 0;
            this.ownerSearchIndex += 1;
            this.ownerSearchHeading = this.ownerFacing;
          }
        } else {
          this.ownerSearchHeading = this.ownerFacing;
        }
      }
      this.suspicion = Math.max(0, this.suspicion - dt * 2.5);
      if (sight.visible && sight.clarity > 0.1) this.beginPursuit();
      else if (this.ownerSearchIndex >= this.ownerSearchPoints.length || this.ownerSearchTime > 11) {
        this.ownerState = "returning";
        this.ownerDwell = 0;
        this.ownerHasLastSeen = false;
        this.showToast("They give up looking, and go back to the morning.");
      }
    } else {
      this.ownerReach = 0;
      this.ownerCarrying = false;
      const stop = OWNER_ROUTINE[this.ownerStop] ?? OWNER_ROUTINE[0];
      if (stop) {
        this.ownerTarget.set(stop.position[0], 0, stop.position[1]);
        if (this.moveOwnerToward(this.ownerTarget, 1.7, dt)) {
          this.ownerState = "routine";
          this.ownerDwell = 0;
        }
      }
    }

    this.ownerAlarm = damp(
      this.ownerAlarm,
      this.ownerState === "pursuing" ? 1
        : this.ownerState === "searching" ? 0.8
          : this.ownerState === "investigating" ? 0.7
            : this.suspicion / 140,
      4, dt,
    );
    this.ownerSurprise = Math.max(0, this.ownerSurprise - dt * 1.6);
  }

  private beginPursuit(): void {
    const resumed = this.ownerState === "searching";
    if (this.ownerState === "pursuing") return;
    this.ownerState = "pursuing";
    this.ownerSurprise = 1;
    this.ownerDwell = 0;
    this.showToast(resumed
      ? "Found. That hiding place is now a former hiding place."
      : "You have been spotted. Act natural. Or run.");
  }

  /**
   * Sight has been lost mid-chase. Sweep the last known position instead of
   * either giving up instantly or tracking the cat through the furniture —
   * breaking line of sight should buy time, not safety.
   */
  private beginSearch(): void {
    if (!this.ownerHasLastSeen) {
      this.ownerState = "returning";
      this.ownerDwell = 0;
      return;
    }
    this.ownerState = "searching";
    this.ownerSearchPoints = searchPattern(
      { x: this.ownerLastSeen.x, z: this.ownerLastSeen.z },
      this.ownerLastSeenHeading,
      2.3,
    );
    this.ownerSearchIndex = 0;
    this.ownerSearchTime = 0;
    this.ownerDwell = 0;
    this.showToast("They lost you, and start looking.");
  }

  private moveOwnerToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    this.ownerPathAge += dt;
    const goalMoved = Math.hypot(
      target.x - this.ownerPathGoal.x,
      target.z - this.ownerPathGoal.z,
    ) > OWNER_NAV_CELL * 0.75;
    const refreshInterval = this.ownerState === "pursuing" ? 0.28 : 1.1;
    const retryMissingPath = !this.ownerPathValid && this.ownerPathAge >= 0.35;
    const refreshActivePath = this.ownerPathValid
      && !this.ownerPathComplete
      && this.ownerPathAge >= refreshInterval;
    if (goalMoved || retryMissingPath || refreshActivePath) {
      this.planOwnerPath(target);
    }

    while (this.ownerWaypoint < this.ownerPath.length) {
      const waypoint = this.ownerPath[this.ownerWaypoint];
      if (!waypoint) break;
      const distance = Math.hypot(
        waypoint.x - this.ownerPosition.x,
        waypoint.z - this.ownerPosition.z,
      );
      if (distance >= 0.2) break;
      this.ownerWaypoint += 1;
    }

    if (!this.ownerPathValid || this.ownerWaypoint >= this.ownerPath.length) {
      this.ownerPathComplete = this.ownerPathValid;
      this.ownerSpeed = damp(this.ownerSpeed, 0, 8, dt);
      this.ownerBody.move(this.scratchVector.set(0, -0.2 * dt, 0));
      return this.ownerPathComplete;
    }

    const waypoint = this.ownerPath[this.ownerWaypoint];
    if (!waypoint) return false;
    this.ownerDesired.set(
      waypoint.x - this.ownerPosition.x,
      0,
      waypoint.z - this.ownerPosition.z,
    );
    const distance = this.ownerDesired.length();
    this.ownerDesired.normalize();
    const step = Math.min(distance, speed * dt);
    this.ownerSpeed = damp(this.ownerSpeed, speed, 6, dt);
    const movement = this.ownerBody.move(this.scratchVector.set(
      this.ownerDesired.x * step, -0.2 * dt, this.ownerDesired.z * step,
    ));
    const planarMovement = Math.hypot(movement.translation.x, movement.translation.z);
    if (step > 0.002 && planarMovement < step * 0.15) this.ownerStuckTime += dt;
    else this.ownerStuckTime = Math.max(0, this.ownerStuckTime - dt * 2);
    if (this.ownerStuckTime > 0.3) {
      // The obstacle grid handles authored scenery. This retry covers a dynamic
      // prop temporarily wedged under the kinematic controller.
      this.ownerPathValid = false;
      this.ownerPathAge = 0.35;
      this.ownerStuckTime = 0;
    }
    this.ownerFacing = dampAngle(
      this.ownerFacing, Math.atan2(this.ownerDesired.x, this.ownerDesired.z), 7, dt,
    );
    return false;
  }

  /**
   * Turns the homeowner's body towards a point.
   *
   * `moveOwnerToward` only steers while there is a waypoint left, so a
   * stationary homeowner used to keep whatever heading they arrived on while
   * their head looked somewhere else entirely. That was invisible until sight
   * became directional: the vision cone follows the body, so a homeowner
   * reaching for the kettle has to actually be facing the kettle.
   */
  private turnOwnerToward(x: number, z: number, dt: number, rate = 5): void {
    const dx = x - this.ownerPosition.x;
    const dz = z - this.ownerPosition.z;
    if (Math.hypot(dx, dz) < 0.08) return;
    this.ownerFacing = dampAngle(this.ownerFacing, Math.atan2(dx, dz), rate, dt);
  }

  private planOwnerPath(target: THREE.Vector3): void {
    const result = this.ownerPathfinder.findPath(
      { x: this.ownerPosition.x, z: this.ownerPosition.z },
      { x: target.x, z: target.z },
      this.physics.navigationObstacles(0.08, 1.9),
    );
    this.ownerPathGoal.copy(target);
    this.ownerPathAge = 0;
    this.ownerWaypoint = 0;
    this.ownerPathComplete = false;
    this.ownerPathValid = result !== null;
    this.ownerPathReachedGoal = result?.reachedGoal ?? false;
    this.ownerPath = result?.waypoints ?? [];
  }

  /** A stimulus the homeowner may choose to walk over and inspect. */
  private emitStimulus(position: THREE.Vector3, intensity: number, kind: "meow" | "crash" | "swipe"): void {
    this.suspicion = Math.min(100, this.suspicion + intensity * 7);
    if (this.ownerState === "pursuing") return;
    const distance = this.ownerPosition.distanceTo(position);
    if (distance > 14) return;
    if (intensity < 0.9 && this.ownerState === "investigating") return;
    this.ownerTarget.set(position.x, 0, position.z);
    this.ownerLookAt.copy(position);
    this.ownerState = "investigating";
    this.ownerDwell = 0;
    this.ownerSurprise = Math.min(1, intensity * 0.6);
    if (kind === "crash") this.showToast("CRASH. Footsteps are approaching.");
  }

  private alertOwner(position: THREE.Vector3, kind: "meow" | "crash" | "swipe"): void {
    this.emitStimulus(position, 1.2, kind);
  }

  private catchCat(): void {
    this.caughtCooldown = 4;
    this.caughtCount += 1;
    this.catchSequence = 1.4;
    if (this.carrying) {
      const prop = this.carrying;
      this.carrying = null;
      prop.body.setCarried(false);
      prop.body.teleport(prop.body.spawn);
    }
    this.controller.teleport(this.scratchVector.set(SPAWN.cat.x, SPAWN.cat.y, SPAWN.cat.z));
    this.catAnimator.resetSecondaryMotion();
    this.catTravel = 0;
    this.ownerState = "returning";
    this.ownerDwell = 0;
    // The cat is back in the garden; nothing the homeowner remembers seeing is
    // worth searching any more.
    this.ownerHasLastSeen = false;
    this.ownerLastSeenAge = Infinity;
    this.suspicion = 30;
    this.showToast("Caught, carried outside, and deposited with great ceremony.");
  }

  // -- presentation ----------------------------------------------------------

  private updateCamera(dt: number): void {
    const state = this.catState;
    if (!state) return;
    this.catFocus.copy(state.position);
    this.catFocus.y += 0.35;
    this.director.update(dt, this.catFocus, state.velocity, this.settings.reducedMotion);
  }

  private updateAnimation(dt: number): void {
    const state = this.catState;
    if (!state) return;

    // Curling up in the box is a real hiding state, not only the ending: it
    // reduces the homeowner's ability to spot the cat while it is held.
    const inBox = Math.hypot(state.position.x + 11.4, state.position.z - 4.1) < 1.2
      && state.planarSpeed < 0.4 && state.grounded;
    const innocenceTarget = this.completed ? 1 : inBox ? 0.85 : 0;
    this.innocenceWeight = damp(this.innocenceWeight, innocenceTarget, this.completed ? 2.2 : 3.4, dt);

    const animation = this.catAnimation;
    Object.assign(animation, NEUTRAL_CAT_ANIMATION);
    animation.speed = state.planarSpeed;
    animation.turnRate = state.turnRate;
    animation.acceleration = state.acceleration;
    // Strides are timed from ground actually covered, so a cat held against a
    // cupboard stops stepping instead of skating on the spot. The controller
    // runs on a fixed step and animation once per rendered frame, so hand over
    // every step's travel since the last frame rather than only the last one's.
    animation.travel = this.catTravel;
    this.catTravel = 0;
    animation.brake = state.brake;
    animation.stalking = !this.completed && this.stalkRequested;
    animation.airborne = state.airborne;
    animation.gather = state.gather;
    animation.jumpProgress = state.jumpProgress;
    animation.landImpact = state.landImpact;
    animation.landRecover = state.landRecover;
    animation.swipe = this.swipeTimer > 0 ? 1 - this.swipeTimer / 0.42 : 0;
    animation.meow = this.meowTimer > 0 ? Math.sin((1 - this.meowTimer / 0.9) * Math.PI) : 0;
    animation.carrying = this.carrying !== null;
    animation.sleeping = this.innocenceWeight;
    animation.alert = clamp(
      (this.ownerState === "pursuing" ? 1 : 0)
      + (this.controller.availableJumpTarget() ? 0.55 : 0)
      + (this.meowTimer > 0 ? 0.4 : 0),
      0, 1,
    );
    animation.lookAt = this.resolveLookTarget(state.position);
    this.catAnimator.update(dt, animation);

    this.ownerAnimator.update(dt, {
      speed: this.ownerSpeed,
      turnRate: 0,
      alarm: this.ownerAlarm,
      surprise: this.ownerSurprise,
      reaching: this.ownerReach,
      carrying: this.ownerCarrying,
      lookAt: this.ownerLookAt,
    });

    // Carried props ride the mouth socket rather than being re-simulated.
    if (this.carrying) {
      this.cat.mouthAnchor.updateWorldMatrix(true, false);
      this.cat.mouthAnchor.getWorldPosition(this.carrying.object.position);
      this.cat.mouthAnchor.getWorldQuaternion(this.carrying.object.quaternion);
    }
  }

  /**
   * What the cat is looking at: the homeowner when they matter, otherwise the
   * nearest point of interest, otherwise nothing and the head drifts idly.
   */
  private resolveLookTarget(position: THREE.Vector3): THREE.Vector3 | null {
    if (this.ownerState === "pursuing" || this.ownerState === "investigating") {
      const distance = this.ownerPosition.distanceTo(position);
      if (distance < 9) {
        return this.lookTarget.copy(this.ownerPosition).setY(this.owner.eyeHeight);
      }
    }
    let best: readonly [number, number, number] | null = null;
    let bestDistance = 3.6;
    for (const point of POINTS_OF_INTEREST) {
      const distance = Math.hypot(point[0] - position.x, point[2] - position.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best ? this.lookTarget.set(best[0], best[1], best[2]) : null;
  }

  private updatePresentation(_dt: number): void {
    if (this.zoneLabelTimer <= 0) this.cameraLabelElement.classList.remove("visible");
    if (this.toastTimer <= 0) this.toastElement.classList.remove("visible");

    const prompt = this.buildPrompt();
    if (prompt !== this.currentPrompt) {
      this.currentPrompt = prompt;
      this.promptElement.textContent = prompt;
      this.promptElement.classList.toggle("visible", prompt.length > 0 && this.started && !this.completed);
    }
  }

  private buildPrompt(): string {
    if (!this.started || this.completed) return "";
    const action = this.inputMethod === "gamepad" ? "A" : "E";
    const jump = this.inputMethod === "gamepad" ? "B" : "SPACE";

    const jumpTarget = this.controller.availableJumpTarget();
    const choice = resolveInteraction(this.buildInteractionCandidates());
    if (choice) {
      const [kind, key = ""] = choice.id.split(":");
      if (kind === "drop") {
        return key === "sink"
          ? `${action} — drop ${this.carrying?.spec.label ?? "it"} into the sink`
          : `${action} — drop ${this.carrying?.spec.label ?? "it"}`;
      }
      if (kind === "carry") {
        return `${action} — pick up ${this.props.find((prop) => prop.spec.id === key)?.spec.label ?? "it"}`;
      }
      if (kind === "swipe") {
        if (key === "mug" && this.preparations.size >= 2) {
          return `${action} — knock the red mug off the breakfast table`;
        }
        return `${action} — swipe ${this.props.find((prop) => prop.spec.id === key)?.spec.label ?? "it"}`;
      }
      if (kind === "station") {
        const station = STATIONS.find((candidate) => candidate.id === key);
        if (station) return `${action} — ${station.prompt}`;
      }
    }
    if (jumpTarget) return `${jump} — leap onto ${jumpTarget.label}`;
    return "";
  }

  private updateDebug(frameDelta: number): void {
    if (!this.debugVisible) return;
    this.debugLinesAge += frameDelta;
    if (this.debugLinesAge > 0.25) {
      this.debugLinesAge = 0;
      this.refreshDebugLines();
    }
    this.refreshSightCone();
    const panel = document.querySelector<HTMLElement>("#debug-panel");
    if (!panel) return;
    const state = this.catState;
    panel.textContent = [
      `FPS          ${Math.round(this.smoothedFrameRate)}`,
      `Draw calls   ${this.renderer.info.render.calls}`,
      `Triangles    ${this.renderer.info.render.triangles}`,
      `Cat          ${state ? `${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}, ${state.position.z.toFixed(2)}` : "—"}`,
      `Grounded     ${state?.grounded ?? false}  air ${(state?.airborne ?? 0).toFixed(2)}`,
      `Gait         ${this.catAnimator.currentGait()}  speed ${(state?.planarSpeed ?? 0).toFixed(2)}`
      + `  stride/s ${this.catAnimator.strideRate().toFixed(2)}`,
      `Jump target  ${this.controller.availableJumpTarget()?.id ?? "—"}`,
      `Carrying     ${this.carrying?.spec.id ?? "—"}`,
      `Owner        ${this.ownerState}  suspicion ${Math.round(this.suspicion)}`,
      `Sight        ${this.ownerSight.reason}  clarity ${this.ownerSight.clarity.toFixed(2)}`
      + `  last seen ${this.ownerHasLastSeen ? `${this.ownerLastSeenAge.toFixed(1)}s ago` : "never"}`,
      `Camera       ${this.director.currentZoneId()}`,
      `Preparations ${this.preparations.size}`,
      `Awake bodies ${this.physics.activeBodyCount()}/${this.physics.bodies().length}`,
      `Catastrophe  ${this.catastrophe ? "triggered" : "pending"}`,
    ].join("\n");
  }

  /**
   * The homeowner's vision cone, drawn on the floor.
   *
   * Sight is now the rule the whole stealth layer rests on, so it has to be
   * inspectable: without seeing the cone you cannot tell a fair detection from
   * a bug. It turns green the moment the cat is actually seen.
   */
  private refreshSightCone(): void {
    if (!this.sightCone) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      const segments = 24;
      for (let index = 0; index <= segments; index += 1) {
        const angle = -OWNER_SIGHT.halfAngle + (index / segments) * OWNER_SIGHT.halfAngle * 2;
        const reach = rangeAtAngle(OWNER_SIGHT, angle);
        shape.lineTo(Math.sin(angle) * reach, Math.cos(angle) * reach);
      }
      shape.lineTo(0, 0);
      const geometry = new THREE.ShapeGeometry(shape);
      // The shape is authored in XY with +y forward, and the rig's forward is
      // +z. A negative quarter turn here would lay the cone out behind the
      // homeowner, which looks plausible until you notice it never lights up.
      geometry.rotateX(Math.PI / 2);
      this.sightCone = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xffb703, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide,
      }));
      this.sightCone.renderOrder = 19;
      this.scene.add(this.sightCone);
    }
    this.sightCone.visible = this.debugVisible;
    this.sightCone.position.set(this.ownerPosition.x, 0.03, this.ownerPosition.z);
    this.sightCone.rotation.y = this.ownerFacing;
    const material = this.sightCone.material as THREE.MeshBasicMaterial;
    material.color.setHex(this.ownerSight.visible ? 0x35c463 : 0xffb703);
    material.opacity = 0.2 + this.ownerSight.clarity * 0.3;
  }

  /** Rapier's own collider wireframes, so collision bugs are visible. */
  private refreshDebugLines(): void {
    const buffers = this.physics.debugLines();
    if (!this.debugLines) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
      this.debugLines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.55 }),
      );
      this.debugLines.renderOrder = 20;
      this.scene.add(this.debugLines);
      return;
    }
    this.debugLines.geometry.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
    this.debugLines.geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
  }

  // -- objectives ------------------------------------------------------------

  private updateObjectives(): void {
    const position = this.catPosition();
    if (position.x > -2.8 && !this.isComplete("enter")) {
      this.completeObjective("enter", "You are inside. The morning is now negotiable.");
    }

    const prepare = this.objectives.find((objective) => objective.id === "prepare");
    if (prepare && !prepare.complete) {
      const count = Math.min(2, this.preparations.size);
      const text = `Prepare two disasters (${count}/2)`;
      if (prepare.text !== text) {
        prepare.text = text;
        this.renderObjectives();
      }
    }
    if (this.preparations.size >= 2) {
      this.completeObjective(
        "prepare",
        "The trap is set. Climb onto the breakfast table and knock the red mug to the floor.",
      );
      this.tryCompleteCatastrophe();
    }

    const catastrophe = this.objectives.find((objective) => objective.id === "catastrophe");
    if (catastrophe && !catastrophe.complete && this.preparations.size >= 2 && !this.mugBroken) {
      const text = "Trigger the breakfast catastrophe: knock the red mug off the breakfast table";
      if (catastrophe.text !== text) {
        catastrophe.text = text;
        this.renderObjectives();
      }
    }

    // Optional: sit in the fruit bowl.
    const bowl = this.props.find((prop) => prop.spec.id === "fruit-bowl");
    if (bowl && !this.isComplete("fruit")) {
      bowl.body.position(this.scratchVector);
      if (Math.hypot(this.scratchVector.x - position.x, this.scratchVector.z - position.z) < 0.55
        && Math.abs(position.y - this.scratchVector.y) < 0.5) {
        this.completeObjective("fruit", "The fruit bowl has been improved immeasurably.");
      }
    }
  }

  private isComplete(id: string): boolean {
    return this.objectives.find((objective) => objective.id === id)?.complete ?? false;
  }

  private completeObjective(id: string, toast: string): void {
    const objective = this.objectives.find((item) => item.id === id);
    if (!objective || objective.complete) return;
    objective.complete = true;
    this.renderObjectives();
    this.showToast(toast);
  }

  private renderObjectives(): void {
    const main = this.objectives.filter((objective) => !objective.optional);
    const optional = this.objectives.filter((objective) => objective.optional);
    const nextIndex = main.findIndex((objective) => !objective.complete);
    this.objectiveElement.innerHTML = `
      <h2>MORNING AGENDA</h2>
      ${main.map((objective, index) => `
        <div class="objective ${objective.complete ? "complete" : ""} ${index === nextIndex ? "current" : ""}">
          <span class="box"></span><span>${objective.text}</span>
        </div>
      `).join("")}
      <details><summary>OPTIONAL MISCHIEF</summary>${optional.map((objective) => `<div class="objective ${objective.complete ? "complete" : ""}"><span class="box"></span><span>${objective.text}</span></div>`).join("")}</details>
    `;
  }

  private showToast(message: string): void {
    this.toastElement.textContent = message;
    this.toastElement.classList.add("visible");
    this.toastTimer = 2.6;
  }

  // -- setup -----------------------------------------------------------------

  private buildProps(): void {
    for (const spec of PROPS) {
      const built = instantiateProp(spec.model);
      built.object.position.set(spec.position[0], spec.position[1], spec.position[2]);
      built.object.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = true;
      });
      this.scene.add(built.object);

      const body = this.physics.addDynamicBody({
        id: spec.id,
        shape: built.shape,
        position: new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]),
        mass: built.mass,
        restitution: spec.fragile ? 0.1 : 0.22,
      });
      this.props.push({
        spec,
        object: built.object,
        body,
        restOffset: built.restOffset,
        mass: built.mass,
        broken: false,
        settledHeight: spec.position[1],
      });
    }
  }

  private catPosition(): THREE.Vector3 {
    return this.catState?.position ?? SPAWN.cat;
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = this.settings.graphics === "low" ? 1 : Math.min(window.devicePixelRatio, 1.8);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }
}

function instantiateProp(model: PropSpec["model"]): BuiltProp {
  switch (model) {
    case "mug": return buildMug();
    case "fruit-bowl": return buildFruitBowl();
    case "key": return buildKey();
    case "sock": return buildSock();
    case "sponge": return buildSponge();
    case "sausage": return buildSausage();
    case "mouse-toy": return buildMouseToy();
    case "kettle": return buildKettle();
    case "book": return buildBook();
  }
}

/** How aligned the cat's facing is with a target, in [0,1]. */
function facingScore(from: THREE.Vector3, facing: number, to: THREE.Vector3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) return 1;
  return clamp((Math.sin(facing) * dx + Math.cos(facing) * dz) / length, 0, 1);
}

/** Later sub-steps in the same frame must not replay one-shot button presses. */
function consumeEdges(input: InputFrame): InputFrame {
  return { ...input, actionPressed: false, meowPressed: false, pouncePressed: false };
}
