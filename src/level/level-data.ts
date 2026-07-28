import * as THREE from "three";

/**
 * "A Perfectly Quiet Morning" — authored level data.
 *
 * Geometry, camera framing, traversal, and interaction anchors live here as
 * typed data rather than being buried in the game class. The rule is simple:
 * if a designer would want to move it, it belongs in this file.
 *
 * Layout (looking down, +x east, +z south):
 *
 *     z=-8  ┌──────── fence ────────┬── kitchen wall ──┬── dining wall ──┐
 *           │                       │  fridge stove    │   window        │
 *           │      GARDEN           │  sink  counter   │   table+chairs  │
 *           │   box  planter        │  shelf  cupboard │   sideboard     │
 *     z=0   │            ▓ back door▓        ▓ arch ▓  │                 │
 *           │                       │   rug   table    │   rug           │
 *           │                       │  UTILITY: washer │                 │
 *     z=+8  └───────────────────────┴──────────────────┴─────────────────┘
 *          x=-15                  x=-3.4             x=7.2            x=15
 */

export type RoomId = "garden" | "kitchen" | "dining";

export const WORLD = {
  minX: -15,
  maxX: 15,
  minZ: -8,
  maxZ: 8,
  /** Interior wall between garden and kitchen. */
  backDoorX: -3.4,
  /** Interior wall between kitchen and dining. */
  archX: 7.2,
  wallHeight: 3.2,
  wallThickness: 0.32,
} as const;

export interface DoorGap {
  readonly from: number;
  readonly to: number;
}

export interface WallSpec {
  /** "x" walls run along z at a fixed x; "z" walls run along x at a fixed z. */
  readonly axis: "x" | "z";
  readonly at: number;
  readonly from: number;
  readonly to: number;
  /** Openings along the wall's run. */
  readonly gaps?: readonly DoorGap[];
  readonly height?: number;
  readonly color?: number;
  /** Fences are shorter, planked, and belong outdoors. */
  readonly kind?: "wall" | "fence";
}

export const WALLS: readonly WallSpec[] = [
  // House shell.
  { axis: "z", at: WORLD.minZ, from: WORLD.backDoorX, to: WORLD.maxX },
  { axis: "z", at: WORLD.maxZ, from: WORLD.backDoorX, to: WORLD.maxX },
  { axis: "x", at: WORLD.maxX, from: WORLD.minZ, to: WORLD.maxZ },
  // Interior partitions, each with a single generous opening.
  { axis: "x", at: WORLD.backDoorX, from: WORLD.minZ, to: WORLD.maxZ, gaps: [{ from: -1.3, to: 1.3 }] },
  { axis: "x", at: WORLD.archX, from: WORLD.minZ, to: WORLD.maxZ, gaps: [{ from: -1.1, to: 1.5 }] },
  // Garden boundary.
  { axis: "x", at: WORLD.minX, from: WORLD.minZ, to: WORLD.maxZ, kind: "fence" },
  { axis: "z", at: WORLD.minZ, from: WORLD.minX, to: WORLD.backDoorX, kind: "fence" },
  { axis: "z", at: WORLD.maxZ, from: WORLD.minX, to: WORLD.backDoorX, kind: "fence" },
];

export interface FloorSpec {
  readonly room: RoomId;
  readonly center: readonly [number, number];
  readonly size: readonly [number, number];
  readonly kind: "wood" | "tile" | "grass" | "flat";
  readonly color: number;
}

export const FLOORS: readonly FloorSpec[] = [
  { room: "garden", center: [-9.2, 0], size: [11.6, 16], kind: "grass", color: 0x7f9a5c },
  { room: "kitchen", center: [1.9, 0], size: [10.6, 16], kind: "tile", color: 0xe4e0d4 },
  { room: "dining", center: [11.1, 0], size: [7.8, 16], kind: "wood", color: 0xb98d5f },
];

/** Every placed furniture piece. `model` maps to a builder in the level builder. */
export interface PlacementSpec {
  readonly id: string;
  readonly model:
    | "kitchen-counter" | "sink-unit" | "wall-cupboard" | "fridge" | "stove" | "dining-table"
    | "chair" | "sideboard" | "washing-machine" | "wall-shelf" | "cardboard-box" | "laundry-basket"
    | "bin" | "planter" | "potted-plant" | "fence-panel" | "rug" | "window" | "doorway" | "cat-bowl";
  readonly position: readonly [number, number, number];
  readonly rotationY?: number;
  /** Model-specific size argument (counter length, rug dimensions, …). */
  readonly size?: readonly [number, number];
  readonly scale?: number;
}

export const PLACEMENTS: readonly PlacementSpec[] = [
  // -- garden ---------------------------------------------------------------
  { id: "box", model: "cardboard-box", position: [-11.4, 0, 4.1], rotationY: 0.22 },
  { id: "planter", model: "planter", position: [-12.5, 0, -2.4], rotationY: Math.PI / 2, size: [4.4, 1.1] },
  { id: "garden-plant-a", model: "potted-plant", position: [-5.6, 0, -4.6], scale: 1.15 },
  { id: "garden-plant-b", model: "potted-plant", position: [-7.9, 0, 6.4], scale: 0.85 },
  { id: "garden-plant-c", model: "potted-plant", position: [-4.9, 0, 3.3], scale: 0.7 },
  { id: "cat-bowl", model: "cat-bowl", position: [-4.6, 0, 1.9] },
  { id: "back-door", model: "doorway", position: [WORLD.backDoorX, 0, 0], size: [2.6, 2.9] },

  // -- kitchen: the working run along the north wall -------------------------
  { id: "fridge", model: "fridge", position: [-2.4, 0, -7.1] },
  { id: "stove", model: "stove", position: [-0.4, 0, -7.15] },
  { id: "sink", model: "sink-unit", position: [2.2, 0, -7.1] },
  { id: "counter", model: "kitchen-counter", position: [5.3, 0, -7.1], size: [3.2, 1.32] },
  { id: "cupboard", model: "wall-cupboard", position: [2.2, 2.35, -7.5], size: [1.6, 0] },
  { id: "shelf", model: "wall-shelf", position: [5.3, 2.02, -7.5], size: [2.1, 0] },
  { id: "kitchen-table", model: "dining-table", position: [1.4, 0, -1.9], size: [2.3, 1.5] },
  { id: "kitchen-chair-a", model: "chair", position: [1.4, 0, -0.4], rotationY: Math.PI },
  { id: "kitchen-chair-b", model: "chair", position: [-0.5, 0, -1.9], rotationY: Math.PI / 2 },
  { id: "kitchen-rug", model: "rug", position: [2.2, 0, 2.6], size: [4.2, 3.2] },
  { id: "bin", model: "bin", position: [6.4, 0, -4.6] },
  { id: "kitchen-plant", model: "potted-plant", position: [-2.7, 0, -3.4], scale: 1 },
  { id: "arch", model: "doorway", position: [WORLD.archX, 0, 0.2], size: [2.6, 2.9] },

  // -- utility nook (south-east of the kitchen) ------------------------------
  { id: "washer", model: "washing-machine", position: [5.9, 0, 6.9] },
  { id: "basket", model: "laundry-basket", position: [4.1, 0, 6.6] },

  // -- dining ---------------------------------------------------------------
  { id: "table", model: "dining-table", position: [10.9, 0, -1.6], size: [3.1, 1.9] },
  { id: "chair-a", model: "chair", position: [10.9, 0, 0.5], rotationY: Math.PI },
  { id: "chair-b", model: "chair", position: [10.9, 0, -3.7], rotationY: 0 },
  { id: "sideboard", model: "sideboard", position: [13.9, 0, 3.4], rotationY: -Math.PI / 2, size: [3, 0] },
  { id: "dining-rug", model: "rug", position: [10.9, 0, -1.6], size: [4.6, 3.4] },
  { id: "window", model: "window", position: [WORLD.maxX - 0.1, 1.85, -1.6], size: [2.8, 1.9] },
  { id: "dining-plant", model: "potted-plant", position: [8.4, 0, 6.4], scale: 1.25 },
];

/** Placed interactive props, each backed by a Rapier dynamic body. */
export interface PropSpec {
  readonly id: string;
  readonly model: "mug" | "fruit-bowl" | "key" | "sock" | "sponge" | "sausage" | "mouse-toy" | "kettle" | "book";
  readonly position: readonly [number, number, number];
  readonly label: string;
  /** Carryable props can be picked up in the mouth. */
  readonly carryable: boolean;
  /** Breaks into shards when it lands hard. */
  readonly fragile?: boolean;
}

export const PROPS: readonly PropSpec[] = [
  { id: "mug", model: "mug", position: [10.4, 1.32, -1.6], label: "the red mug", carryable: false, fragile: true },
  { id: "fruit-bowl", model: "fruit-bowl", position: [11.6, 1.2, -1.5], label: "the fruit bowl", carryable: false },
  { id: "kettle", model: "kettle", position: [4.4, 1.36, -7.1], label: "the kettle", carryable: false },
  { id: "book", model: "book", position: [13.9, 1.15, 2.6], label: "a paperback", carryable: false },
  // The key sits on the wall shelf: floor → counter → shelf is a real climb.
  { id: "key", model: "key", position: [5.3, 2.1, -7.45], label: "the brass key", carryable: true },
  { id: "sock", model: "sock", position: [4.1, 0.78, 6.6], label: "a striped sock", carryable: true },
  { id: "sponge", model: "sponge", position: [2.9, 1.37, -6.7], label: "the sponge", carryable: true },
  { id: "sausage", model: "sausage", position: [11.4, 1.22, -2.3], label: "a breakfast sausage", carryable: true },
  { id: "mouse-toy", model: "mouse-toy", position: [-9.4, 0.12, -2.1], label: "your mouse toy", carryable: true },
];

/**
 * Contextual jump targets.
 *
 * The cat can hop onto anything short with a plain jump; these entries are the
 * authored ledges that the jump resolver offers by name, with the approach
 * constraints that make each landing reliable.
 */
export interface JumpTargetSpec {
  readonly id: string;
  readonly label: string;
  /** Where the cat lands. */
  readonly landing: readonly [number, number, number];
  /** Cat must be within this planar radius of `approach` to be offered. */
  readonly approach: readonly [number, number];
  readonly approachRadius: number;
  /** Prefer this target over others when several are in range. */
  readonly priority: number;
}

export const JUMP_TARGETS: readonly JumpTargetSpec[] = [
  { id: "planter", label: "the planter", landing: [-12.5, 0.86, -2.4], approach: [-11.2, -2.4], approachRadius: 1.9, priority: 1 },
  { id: "box", label: "your box", landing: [-11.4, 0.16, 4.1], approach: [-11.4, 2.6], approachRadius: 2.1, priority: 1 },
  { id: "kitchen-chair", label: "the chair", landing: [1.4, 0.72, -0.4], approach: [1.4, 0.9], approachRadius: 1.7, priority: 1 },
  { id: "kitchen-table", label: "the kitchen table", landing: [1.4, 1.19, -1.9], approach: [1.4, -0.4], approachRadius: 1.6, priority: 2 },
  { id: "counter", label: "the worktop", landing: [5.3, 1.39, -6.7], approach: [5.3, -5.4], approachRadius: 2.2, priority: 2 },
  { id: "sink-top", label: "the draining board", landing: [3.0, 1.39, -6.7], approach: [3.0, -5.4], approachRadius: 2.0, priority: 2 },
  { id: "shelf", label: "the wall shelf", landing: [5.3, 2.11, -7.45], approach: [5.3, -6.7], approachRadius: 1.5, priority: 3 },
  { id: "washer", label: "the washing machine", landing: [5.9, 1.32, 6.9], approach: [5.9, 5.5], approachRadius: 1.8, priority: 1 },
  { id: "dining-chair", label: "the dining chair", landing: [10.9, 0.72, 0.5], approach: [10.9, 1.8], approachRadius: 1.8, priority: 1 },
  { id: "dining-table", label: "the dining table", landing: [10.9, 1.19, -1.6], approach: [10.9, 0.5], approachRadius: 1.7, priority: 2 },
  { id: "sideboard", label: "the sideboard", landing: [13.9, 1.16, 3.4], approach: [12.4, 3.4], approachRadius: 1.9, priority: 1 },
];

/** Fixed-position interactions that are not props (taps, doors, bags). */
export interface StationSpec {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly position: readonly [number, number, number];
  readonly radius: number;
  /** Requires the cat to be standing at least this high (i.e. on a surface). */
  readonly minHeight?: number;
}

export const STATIONS: readonly StationSpec[] = [
  { id: "sink", label: "the tap", prompt: "paw the tap", position: [1.9, 1.4, -7.5], radius: 1.25, minHeight: 1.0 },
  { id: "flour", label: "the flour bag", prompt: "shred the flour bag", position: [6.4, 1.4, -7.0], radius: 1.2, minHeight: 1.0 },
  { id: "cupboard", label: "the cupboard", prompt: "hook the cupboard open", position: [2.2, 1.4, -6.9], radius: 1.35, minHeight: 1.0 },
  { id: "box", label: "your box", prompt: "curl up and look innocent", position: [-11.4, 0.2, 4.1], radius: 1.3 },
];

export const FLOUR_BAG_POSITION: readonly [number, number, number] = [6.4, 1.35, -7.05];

/** Semi-fixed camera compositions, one per room. */
export interface CameraZoneSpec {
  readonly id: RoomId;
  readonly label: string;
  readonly target: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly fov: number;
  readonly deadZone: readonly [number, number];
  readonly follow: number;
  readonly lookAhead: number;
}

/**
 * Distances are tuned for a cat roughly 0.7 units long: close enough that the
 * gait and tail read, far enough that the room's causal layout stays legible.
 * The high `follow` values keep the cat near frame centre once it leaves the
 * dead zone, so a fixed composition never loses the player.
 */
export const CAMERA_ZONES: readonly CameraZoneSpec[] = [
  {
    id: "garden", label: "THE GARDEN",
    target: [-9.6, 0.45, 1.0], offset: [-3.0, 5.0, 6.0],
    fov: 38, deadZone: [1.3, 1.0], follow: 0.88, lookAhead: 0.5,
  },
  {
    id: "kitchen", label: "THE KITCHEN",
    target: [2.0, 0.5, -1.0], offset: [-1.6, 5.6, 6.6],
    fov: 37, deadZone: [1.5, 1.1], follow: 0.86, lookAhead: 0.55,
  },
  {
    id: "dining", label: "THE BREAKFAST ROOM",
    target: [11.0, 0.5, -0.6], offset: [2.4, 5.2, 6.2],
    fov: 36, deadZone: [1.2, 1.0], follow: 0.88, lookAhead: 0.45,
  },
];

export const SPAWN = {
  cat: new THREE.Vector3(-11.4, 0.9, 5.9),
  owner: new THREE.Vector3(1.8, 0, 1.6),
} as const;

/** The homeowner's morning circuit. Each stop has a dwell time and an action. */
export interface RoutineStop {
  readonly position: readonly [number, number];
  readonly dwell: number;
  readonly action: "idle" | "reach" | "carry";
  readonly lookAt?: readonly [number, number, number];
}

export const OWNER_ROUTINE: readonly RoutineStop[] = [
  { position: [2.4, -5.6], dwell: 3.2, action: "reach", lookAt: [2.2, 1.4, -7.1] },
  { position: [-0.4, -5.6], dwell: 2.6, action: "reach", lookAt: [-0.4, 1.4, -7.1] },
  { position: [10.9, 1.4], dwell: 3.8, action: "idle", lookAt: [10.9, 1.2, -1.6] },
  { position: [5.6, -5.4], dwell: 2.4, action: "carry", lookAt: [5.3, 1.4, -7.1] },
  { position: [1.6, 2.2], dwell: 2.0, action: "idle" },
];

/** Points the cat's head is drawn to when nearby — makes attention readable. */
export const POINTS_OF_INTEREST: readonly (readonly [number, number, number])[] = [
  [2.2, 1.5, -7.1],
  [5.3, 2.1, -7.45],
  [10.9, 1.25, -1.6],
  [-11.4, 0.4, 4.1],
  [6.4, 1.45, -7.0],
];
