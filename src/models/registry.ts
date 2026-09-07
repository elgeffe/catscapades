import * as THREE from "three";
import { buildCat } from "./cat";
import { buildOwner } from "./owner";
import {
  buildBin, buildCardboardBox, buildChair, buildDiningTable, buildDoorway, buildFencePanel,
  buildFridge, buildKitchenCounter, buildPlanter, buildPottedPlant, buildRug, buildSideboard,
  buildSinkUnit, buildStove, buildWallCupboard, buildWallShelf, buildWashingMachine, buildWindow,
  type BuiltModel,
} from "./furniture";
import {
  buildBook, buildCatBowl, buildFlourBag, buildFruitBowl, buildKettle, buildKey, buildLaundryBasket,
  buildMouseToy, buildMug, buildMugShards, buildPuddle, buildSausage, buildSock, buildSponge,
} from "./props";
import { CatAnimator, NEUTRAL_CAT_ANIMATION, type CatAnimationInput } from "../anim/cat-animator";
import { OwnerAnimator, type OwnerAnimationInput } from "../anim/owner-animator";

/**
 * Model registry.
 *
 * Every visual asset in the game is registered here with a stable id, so the
 * model-viewer skill can build, measure, animate, and screenshot any of them in
 * isolation — without booting the game, the level, or physics. If a model is
 * not in this registry it cannot be reviewed, so new models belong here.
 */

export type ModelCategory = "character" | "furniture" | "prop" | "scenery";

/**
 * Where a model's origin is expected to sit. The inspector only demands a
 * floor-aligned origin for `floor` models — a wall cupboard or a window is
 * meant to hang around its own centre.
 */
export type ModelMount = "floor" | "wall" | "surface" | "free";

/** Drives named animation clips on a built model, for review in isolation. */
export interface ModelDriver {
  readonly clips: readonly string[];
  setClip(clip: string): void;
  update(dt: number): void;
}

export interface ModelInstance {
  readonly object: THREE.Object3D;
  /** Present only for models with motion worth reviewing. */
  readonly driver?: ModelDriver;
}

export interface ModelEntry {
  readonly id: string;
  readonly label: string;
  readonly category: ModelCategory;
  readonly description: string;
  /** Defaults to "floor". */
  readonly mount?: ModelMount;
  /** Builds a fresh instance with its own driver. Never returns shared state. */
  instantiate(): ModelInstance;
}

function fromBuilt(build: () => BuiltModel): () => ModelInstance {
  return () => ({ object: build().object });
}

// -- cat clips ---------------------------------------------------------------

interface CatClipState {
  readonly input: Partial<CatAnimationInput>;
  /** Optional per-frame override, for clips with a time-varying beat. */
  readonly at?: (time: number, input: CatAnimationInput) => void;
}

const CAT_CLIPS: Readonly<Record<string, CatClipState>> = {
  idle: { input: {} },
  "idle-alert": { input: { alert: 1 } },
  walk: { input: { speed: 1.4 } },
  trot: { input: { speed: 3.1 } },
  gallop: { input: { speed: 6.2 } },
  stalk: { input: { speed: 0.85, stalking: true, alert: 0.6 } },
  turn: {
    input: { speed: 2.4 },
    at: (time, input) => { input.turnRate = Math.sin(time * 1.6) * 3.4; },
  },
  pivot: {
    input: { speed: 0, alert: 0.5 },
    at: (time, input) => { input.turnRate = Math.sin(time * 0.7) * 2.6; },
  },
  brake: {
    input: {},
    at: (time, input) => {
      // Scamper, then throw the anchors out, repeatedly.
      const cycle = (time % 2.4) / 2.4;
      const stopping = cycle > 0.55;
      input.speed = stopping ? Math.max(0, 5.2 - (cycle - 0.55) * 18) : 5.2;
      input.acceleration = stopping ? -14 : 6;
      input.brake = stopping ? 1 : 0;
    },
  },
  jump: {
    input: {},
    at: (time, input) => {
      const cycle = (time % 1.8) / 1.8;
      if (cycle < 0.16) {
        input.speed = 1.2;
        input.airborne = 0;
      } else if (cycle < 0.78) {
        const progress = (cycle - 0.16) / 0.62;
        input.speed = 4.2;
        input.airborne = 1;
        input.jumpProgress = progress;
      } else {
        input.speed = 1.6;
        input.landImpact = 1 - (cycle - 0.78) / 0.22;
      }
    },
  },
  swipe: {
    input: { alert: 0.8 },
    at: (time, input) => { input.swipe = Math.max(0, Math.sin((time % 1.4) / 0.45 * Math.PI)); },
  },
  meow: {
    input: { alert: 1 },
    at: (time, input) => { input.meow = Math.max(0, Math.sin((time % 2) / 0.7 * Math.PI)); },
  },
  carry: { input: { speed: 1.6, carrying: true } },
  sit: { input: { sitting: 1, alert: 0.4 } },
  sleep: { input: { sleeping: 1 } },
};

class CatDriver implements ModelDriver {
  readonly clips = Object.keys(CAT_CLIPS);
  private clip = "idle";
  private time = 0;
  private readonly state: CatAnimationInput = { ...NEUTRAL_CAT_ANIMATION };

  constructor(private readonly animator: CatAnimator) {}

  setClip(clip: string): void {
    if (!(clip in CAT_CLIPS)) throw new Error(`Unknown cat clip: ${clip}`);
    this.clip = clip;
    this.time = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const definition = CAT_CLIPS[this.clip];
    if (!definition) return;
    Object.assign(this.state, NEUTRAL_CAT_ANIMATION, definition.input);
    definition.at?.(this.time, this.state);
    this.animator.update(dt, this.state);
  }
}

const OWNER_CLIPS: Readonly<Record<string, Partial<OwnerAnimationInput>>> = {
  idle: {},
  walk: { speed: 1.25 },
  hurry: { speed: 2.4, alarm: 0.6 },
  alarmed: { speed: 0, alarm: 1, surprise: 0.8 },
  reaching: { reaching: 1 },
  carrying: { speed: 1.1, carrying: true },
};

class OwnerDriver implements ModelDriver {
  readonly clips = Object.keys(OWNER_CLIPS);
  private clip = "idle";

  constructor(private readonly animator: OwnerAnimator) {}

  setClip(clip: string): void {
    if (!(clip in OWNER_CLIPS)) throw new Error(`Unknown homeowner clip: ${clip}`);
    this.clip = clip;
  }

  update(dt: number): void {
    const base: OwnerAnimationInput = {
      speed: 0, turnRate: 0, alarm: 0, surprise: 0, reaching: 0, carrying: false, lookAt: null,
    };
    this.animator.update(dt, { ...base, ...OWNER_CLIPS[this.clip] });
  }
}

export const MODEL_REGISTRY: readonly ModelEntry[] = [
  {
    id: "cat",
    label: "Cat (player)",
    category: "character",
    description: "Skinned tabby cat with a curved torso, buried limb sockets, padded paws, continuous tail, and a short muzzle with recessed almond eyes and cupped ears.",
    instantiate: () => {
      const rig = buildCat();
      return { object: rig.root, driver: new CatDriver(new CatAnimator(rig)) };
    },
  },
  {
    id: "homeowner",
    label: "Homeowner (NPC)",
    category: "character",
    description: "Jointed human figure with walk cycle, look-at head, carry pose, and alert mark.",
    instantiate: () => {
      const rig = buildOwner();
      return { object: rig.root, driver: new OwnerDriver(new OwnerAnimator(rig)) };
    },
  },

  { id: "kitchen-counter", label: "Kitchen counter run", category: "furniture", description: "Base cabinets, worktop, toe kick, doors and handles. Top at 1.35.", instantiate: () => ({ object: buildKitchenCounter(4.2).object }) },
  { id: "sink-unit", label: "Sink unit", category: "furniture", description: "Counter section with recessed basin, mixer tap, draining board, and water states.", instantiate: fromBuilt(buildSinkUnit) },
  { mount: "wall", id: "wall-cupboard", label: "Wall cupboard", category: "furniture", description: "Wall unit with a hinged door pivot named `cupboard-door`.", instantiate: fromBuilt(buildWallCupboard) },
  { id: "fridge", label: "Fridge", category: "furniture", description: "Full-height fridge with handles, magnets, and a shopping list.", instantiate: fromBuilt(buildFridge) },
  { id: "stove", label: "Stove", category: "furniture", description: "Range with hob rings, oven door, and control knobs.", instantiate: fromBuilt(buildStove) },
  { id: "dining-table", label: "Dining table", category: "furniture", description: "Four-legged table with an apron. Top at 1.15.", instantiate: fromBuilt(buildDiningTable) },
  { id: "chair", label: "Chair", category: "furniture", description: "Dining chair. Seat at 0.68 — the first rung to the table.", instantiate: fromBuilt(buildChair) },
  { id: "sideboard", label: "Sideboard", category: "furniture", description: "Low cabinet at 1.12, the mid step of the dining traversal network.", instantiate: fromBuilt(buildSideboard) },
  { id: "washing-machine", label: "Washing machine", category: "furniture", description: "Utility appliance with a glazed door. Top at 1.28.", instantiate: fromBuilt(buildWashingMachine) },
  { mount: "wall", id: "wall-shelf", label: "Wall shelf", category: "furniture", description: "Bracketed floating shelf at 2.02, the highest kitchen perch.", instantiate: fromBuilt(buildWallShelf) },
  { id: "cardboard-box", label: "Sleeping pad", category: "furniture", description: "The cat's low outdoor home base, with an inset blanket and no obstructing sides.", instantiate: fromBuilt(buildCardboardBox) },
  { mount: "surface", id: "laundry-basket", label: "Laundry basket", category: "furniture", description: "Wicker basket with laundry. Hiding place in the utility nook.", instantiate: fromBuilt(buildLaundryBasket) },
  { id: "bin", label: "Kitchen bin", category: "furniture", description: "Pedal bin with a separate lid object.", instantiate: fromBuilt(buildBin) },

  { id: "doorway", label: "Doorway", category: "scenery", description: "Permanent framed opening without a door leaf.", instantiate: fromBuilt(buildDoorway) },
  { mount: "wall", id: "window", label: "Window", category: "scenery", description: "Glazed window with frame, sill, and curtains.", instantiate: fromBuilt(buildWindow) },
  { id: "fence-panel", label: "Fence panel", category: "scenery", description: "Garden boundary fence with varied plank heights.", instantiate: fromBuilt(buildFencePanel) },
  { id: "planter", label: "Raised planter", category: "scenery", description: "Brick planter at 0.82 — the tutorial jump.", instantiate: fromBuilt(buildPlanter) },
  { id: "potted-plant", label: "Potted plant", category: "scenery", description: "Open-rimmed pot with separated soil surface and splayed leaves.", instantiate: () => ({ object: buildPottedPlant().object }) },
  { id: "rug", label: "Rug", category: "scenery", description: "Bordered floor rug.", instantiate: () => ({ object: buildRug(3.4, 2.4).object }) },

  { mount: "surface", id: "mug", label: "Mug", category: "prop", description: "Carryable, breakable ceramic mug with handle and contents.", instantiate: fromBuilt(buildMug) },
  { mount: "surface", id: "mug-shards", label: "Mug (broken)", category: "prop", description: "Post-catastrophe shard scatter and spill decal.", instantiate: fromBuilt(buildMugShards) },
  { mount: "surface", id: "fruit-bowl", label: "Fruit bowl", category: "prop", description: "Bowl with fruit. Optional objective: sit in it.", instantiate: fromBuilt(buildFruitBowl) },
  { mount: "surface", id: "key", label: "Brass key", category: "prop", description: "Primary carryable objective item.", instantiate: fromBuilt(buildKey) },
  { mount: "surface", id: "sock", label: "Sock", category: "prop", description: "Carryable striped sock.", instantiate: fromBuilt(buildSock) },
  { mount: "surface", id: "sponge", label: "Sponge", category: "prop", description: "Carryable two-tone sponge.", instantiate: fromBuilt(buildSponge) },
  { mount: "surface", id: "sausage", label: "Breakfast sausage", category: "prop", description: "Carryable food item.", instantiate: fromBuilt(buildSausage) },
  { mount: "surface", id: "mouse-toy", label: "Mouse toy", category: "prop", description: "Carryable felt mouse with tail and ears.", instantiate: fromBuilt(buildMouseToy) },
  { mount: "surface", id: "flour-bag", label: "Flour bag", category: "prop", description: "Sealed sack with `flour-spill` and `flour-cloud` states.", instantiate: fromBuilt(buildFlourBag) },
  { mount: "surface", id: "puddle", label: "Water puddle", category: "prop", description: "Overflow decal that grows as the sink runs.", instantiate: fromBuilt(buildPuddle) },
  { mount: "surface", id: "cat-bowl", label: "Cat bowl", category: "prop", description: "Food bowl scenery near the garden opening.", instantiate: fromBuilt(buildCatBowl) },
  { mount: "surface", id: "kettle", label: "Kettle", category: "prop", description: "Swipeable worktop appliance.", instantiate: fromBuilt(buildKettle) },
  { mount: "surface", id: "book", label: "Book", category: "prop", description: "Swipeable sideboard clutter.", instantiate: fromBuilt(buildBook) },
];

export function findModel(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((entry) => entry.id === id);
}

export function modelIds(): readonly string[] {
  return MODEL_REGISTRY.map((entry) => entry.id);
}
