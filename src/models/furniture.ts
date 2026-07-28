import * as THREE from "three";
import { PALETTE, grassTexture, surface, tileTexture, woodFloorTexture } from "./materials";

/**
 * House furniture.
 *
 * Every builder returns its own collision boxes in local space so the level can
 * place a piece once and get matching visuals and physics. Heights are real:
 * a worktop is 1.35 units (~0.9 m), a dining table 1.15, a chair seat 0.68.
 * Those numbers are what make the vertical traversal network legible — the cat
 * can chain chair to table, or stool to worktop to wall shelf.
 */

export interface BoxShape {
  readonly center: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly rotationY?: number;
  readonly label?: string;
}

export interface BuiltModel {
  readonly object: THREE.Group;
  readonly colliders: readonly BoxShape[];
  /** Named child objects the game animates (doors, taps, drawers). */
  readonly parts?: Readonly<Record<string, THREE.Object3D>>;
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  position: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  position: readonly [number, number, number],
  segments = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const COUNTER_HEIGHT = 1.35;
const TABLE_HEIGHT = 1.15;
const SEAT_HEIGHT = 0.68;

export const SURFACE_HEIGHTS = {
  counter: COUNTER_HEIGHT,
  table: TABLE_HEIGHT,
  seat: SEAT_HEIGHT,
  sideboard: 1.12,
  washer: 1.28,
  shelf: 2.02,
  planter: 0.82,
  box: 0.62,
  stool: 0.92,
} as const;

/** Base cabinet run with a worktop, doors, handles, and a toe kick. */
export function buildKitchenCounter(length: number, depth = 1.32): BuiltModel {
  const group = new THREE.Group();
  group.name = "kitchen-counter";
  const cabinet = surface(PALETTE.cabinet, { roughness: 0.78 });
  const trim = surface(PALETTE.cabinetTrim, { roughness: 0.7 });
  const top = surface(PALETTE.counter, { roughness: 0.42, metalness: 0.04 });
  const steel = surface(PALETTE.steel, { roughness: 0.32, metalness: 0.65 });

  const carcassHeight = COUNTER_HEIGHT - 0.09;
  group.add(box(length, carcassHeight - 0.13, depth - 0.1, cabinet, [0, (carcassHeight - 0.13) / 2 + 0.13, 0]));
  // Toe kick: the recess at floor level that reads as real joinery.
  group.add(box(length - 0.06, 0.13, depth - 0.34, trim, [0, 0.065, -0.04]));
  const worktop = box(length + 0.06, 0.09, depth, top, [0, COUNTER_HEIGHT - 0.045, 0]);
  group.add(worktop);
  group.add(box(length + 0.07, 0.022, depth + 0.02, trim, [0, COUNTER_HEIGHT - 0.098, 0]));

  const doorCount = Math.max(2, Math.round(length / 0.95));
  const doorWidth = (length - 0.08) / doorCount;
  for (let index = 0; index < doorCount; index += 1) {
    const x = -length / 2 + 0.04 + doorWidth * (index + 0.5);
    group.add(box(doorWidth - 0.05, carcassHeight - 0.24, 0.04, trim, [x, (carcassHeight - 0.24) / 2 + 0.19, depth / 2 - 0.06]));
    const handle = cylinder(0.018, 0.018, doorWidth * 0.38, steel, [x, carcassHeight - 0.16, depth / 2 - 0.02], 8);
    handle.rotation.z = Math.PI / 2;
    group.add(handle);
  }

  return {
    object: group,
    colliders: [{ center: [0, COUNTER_HEIGHT / 2, 0], half: [length / 2 + 0.03, COUNTER_HEIGHT / 2, depth / 2] }],
  };
}

/** Counter section with a recessed basin, a mixer tap, and a draining board. */
export function buildSinkUnit(): BuiltModel {
  const group = new THREE.Group();
  group.name = "sink-unit";
  const base = buildKitchenCounter(2.1, 1.32);
  group.add(base.object);

  const steel = surface(PALETTE.steel, { roughness: 0.24, metalness: 0.72 });
  const basinDepth = 0.22;
  const rim = COUNTER_HEIGHT - 0.045;

  // Basin walls, built as four thin plates so the recess reads from above.
  group.add(box(0.9, 0.02, 0.72, steel, [-0.32, rim - basinDepth, 0]));
  for (const [w, d, x, z] of [
    [0.9, 0.03, -0.32, -0.36], [0.9, 0.03, -0.32, 0.36],
    [0.03, 0.72, -0.77, 0], [0.03, 0.72, 0.13, 0],
  ] as const) {
    group.add(box(w, basinDepth, d, steel, [x, rim - basinDepth / 2, z]));
  }
  for (let groove = 0; groove < 5; groove += 1) {
    group.add(box(0.62, 0.012, 0.03, steel, [0.55, rim + 0.006, -0.28 + groove * 0.14]));
  }

  const tapBase = cylinder(0.07, 0.08, 0.06, steel, [-0.32, rim + 0.03, -0.42], 12);
  group.add(tapBase);
  const spout = new THREE.Group();
  spout.name = "tap";
  spout.position.set(-0.32, rim + 0.06, -0.42);
  group.add(spout);
  spout.add(cylinder(0.032, 0.032, 0.34, steel, [0, 0.17, 0], 10));
  const neck = cylinder(0.03, 0.03, 0.3, steel, [0, 0.33, 0.14], 10);
  neck.rotation.x = Math.PI / 2;
  spout.add(neck);
  const lever = cylinder(0.02, 0.02, 0.16, steel, [0.09, 0.24, -0.02], 8);
  lever.name = "tap-lever";
  lever.rotation.z = -0.6;
  spout.add(lever);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.05, 0.42, 10, 1, true),
    surface(PALETTE.water, { roughness: 0.06, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
  );
  water.name = "sink-stream";
  water.position.set(-0.32, rim + 0.16, -0.28);
  water.visible = false;
  group.add(water);

  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.02, 0.66),
    surface(PALETTE.water, { roughness: 0.05, transparent: true, opacity: 0.75, emissive: 0x1d5a70, emissiveIntensity: 0.25 }),
  );
  pool.name = "sink-pool";
  pool.position.set(-0.32, rim - basinDepth + 0.02, 0);
  pool.visible = false;
  group.add(pool);

  const overflow = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.012, 1.1),
    surface(PALETTE.water, { roughness: 0.05, transparent: true, opacity: 0.5 }),
  );
  overflow.name = "sink-overflow";
  overflow.position.set(-0.2, rim + 0.056, 0.2);
  overflow.visible = false;
  group.add(overflow);

  return {
    object: group,
    colliders: base.colliders,
    parts: { tap: spout, lever, stream: water, pool, overflow },
  };
}

/** Wall cupboard with a door that swings on a real hinge pivot. */
export function buildWallCupboard(width = 1.5): BuiltModel {
  const group = new THREE.Group();
  group.name = "wall-cupboard";
  const cabinet = surface(PALETTE.cabinet, { roughness: 0.76 });
  const trim = surface(PALETTE.cabinetTrim, { roughness: 0.68 });
  const steel = surface(PALETTE.steel, { roughness: 0.32, metalness: 0.62 });
  const height = 0.86;
  const depth = 0.62;

  group.add(box(width, height, depth, cabinet, [0, 0, 0]));
  group.add(box(width + 0.05, 0.05, depth + 0.04, trim, [0, height / 2 + 0.02, 0]));
  group.add(box(width - 0.12, 0.03, depth - 0.16, trim, [0, -0.08, 0.02]));

  const hinge = new THREE.Group();
  hinge.name = "cupboard-door";
  hinge.position.set(-width / 2 + 0.03, 0, depth / 2);
  group.add(hinge);
  hinge.add(box(width - 0.06, height - 0.06, 0.045, trim, [(width - 0.06) / 2, 0, 0.02]));
  const handle = cylinder(0.016, 0.016, 0.16, steel, [width - 0.16, 0, 0.06], 8);
  hinge.add(handle);

  return {
    object: group,
    colliders: [{ center: [0, 0, 0], half: [width / 2, height / 2, depth / 2] }],
    parts: { door: hinge },
  };
}

export function buildFridge(): BuiltModel {
  const group = new THREE.Group();
  group.name = "fridge";
  const shell = surface(PALETTE.fridge, { roughness: 0.4, metalness: 0.22 });
  const steel = surface(PALETTE.steel, { roughness: 0.28, metalness: 0.7 });
  const width = 1.15;
  const depth = 1.1;
  const height = 2.55;

  group.add(box(width, height, depth, shell, [0, height / 2, 0]));
  group.add(box(width - 0.06, 0.035, 0.06, steel, [0, height * 0.62, depth / 2 + 0.01]));
  for (const y of [height * 0.34, height * 0.78]) {
    const handle = box(0.045, height * 0.26, 0.05, steel, [width / 2 - 0.14, y, depth / 2 + 0.05]);
    group.add(handle);
  }
  // Magnets and a shopping list: small props sell scale on a big flat panel.
  for (const [x, y, color] of [
    [-0.3, 1.85, 0xd0603f], [-0.16, 1.72, 0x4f7f95], [-0.36, 1.6, 0xe0b93f],
  ] as const) {
    group.add(box(0.07, 0.07, 0.02, surface(color, { roughness: 0.5 }), [x, y, depth / 2 + 0.012]));
  }
  group.add(box(0.34, 0.44, 0.006, surface(0xf6f1e2, { roughness: 0.95 }), [0.14, 1.72, depth / 2 + 0.008]));

  return {
    object: group,
    colliders: [{ center: [0, height / 2, 0], half: [width / 2, height / 2, depth / 2] }],
  };
}

export function buildStove(): BuiltModel {
  const group = new THREE.Group();
  group.name = "stove";
  const shell = surface(0xd6d2c6, { roughness: 0.5, metalness: 0.15 });
  const dark = surface(0x2f2b28, { roughness: 0.35 });
  const steel = surface(PALETTE.steel, { roughness: 0.3, metalness: 0.68 });
  const width = 1.35;
  const depth = 1.24;

  group.add(box(width, COUNTER_HEIGHT - 0.06, depth, shell, [0, (COUNTER_HEIGHT - 0.06) / 2, 0]));
  group.add(box(width, 0.06, depth, dark, [0, COUNTER_HEIGHT - 0.03, 0]));
  for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]] as const) {
    group.add(cylinder(0.19, 0.19, 0.02, steel, [x, COUNTER_HEIGHT + 0.005, z], 16));
  }
  group.add(box(width - 0.14, 0.62, 0.05, dark, [0, 0.62, depth / 2 - 0.01]));
  group.add(box(width - 0.2, 0.05, 0.07, steel, [0, 0.96, depth / 2 + 0.03]));
  for (let knob = 0; knob < 4; knob += 1) {
    group.add(cylinder(0.045, 0.045, 0.05, steel, [-0.42 + knob * 0.28, 1.14, depth / 2 + 0.02], 10));
  }

  return {
    object: group,
    colliders: [{ center: [0, COUNTER_HEIGHT / 2, 0], half: [width / 2, COUNTER_HEIGHT / 2, depth / 2] }],
  };
}

/** Four-legged dining table with an apron under the top. */
export function buildDiningTable(width = 3.1, depth = 1.9): BuiltModel {
  const group = new THREE.Group();
  group.name = "dining-table";
  const wood = surface(PALETTE.counterWood, { roughness: 0.62 });
  const woodDark = surface(0x77563c, { roughness: 0.68 });

  group.add(box(width, 0.1, depth, wood, [0, TABLE_HEIGHT - 0.05, 0]));
  group.add(box(width - 0.34, 0.12, depth - 0.34, woodDark, [0, TABLE_HEIGHT - 0.16, 0]));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    group.add(box(0.14, TABLE_HEIGHT - 0.1, 0.14, woodDark, [
      sx * (width / 2 - 0.2), (TABLE_HEIGHT - 0.1) / 2, sz * (depth / 2 - 0.2),
    ]));
  }

  return {
    object: group,
    colliders: [
      { center: [0, TABLE_HEIGHT - 0.08, 0], half: [width / 2, 0.08, depth / 2] },
      { center: [-(width / 2 - 0.2), (TABLE_HEIGHT - 0.1) / 2, 0], half: [0.07, (TABLE_HEIGHT - 0.1) / 2, depth / 2 - 0.13] },
      { center: [width / 2 - 0.2, (TABLE_HEIGHT - 0.1) / 2, 0], half: [0.07, (TABLE_HEIGHT - 0.1) / 2, depth / 2 - 0.13] },
    ],
  };
}

/** Chair with a seat the cat can land on and a back it can slip behind. */
export function buildChair(): BuiltModel {
  const group = new THREE.Group();
  group.name = "chair";
  const wood = surface(0x8a6746, { roughness: 0.66 });
  const cushion = surface(0xb08a6a, { roughness: 0.95 });
  const size = 0.86;

  group.add(box(size, 0.08, size, wood, [0, SEAT_HEIGHT - 0.04, 0]));
  group.add(box(size - 0.1, 0.05, size - 0.1, cushion, [0, SEAT_HEIGHT + 0.02, 0]));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    group.add(box(0.08, SEAT_HEIGHT - 0.08, 0.08, wood, [
      sx * (size / 2 - 0.08), (SEAT_HEIGHT - 0.08) / 2, sz * (size / 2 - 0.08),
    ]));
  }
  group.add(box(size, 0.72, 0.08, wood, [0, SEAT_HEIGHT + 0.36, -size / 2 + 0.04]));
  for (const y of [SEAT_HEIGHT + 0.22, SEAT_HEIGHT + 0.46]) {
    group.add(box(size - 0.16, 0.05, 0.05, wood, [0, y, -size / 2 + 0.1]));
  }

  return {
    object: group,
    colliders: [
      { center: [0, SEAT_HEIGHT - 0.03, 0], half: [size / 2, 0.07, size / 2] },
      { center: [0, SEAT_HEIGHT + 0.36, -size / 2 + 0.04], half: [size / 2, 0.36, 0.05] },
    ],
  };
}

/** Low sideboard: the mid-height step between floor and dining table. */
export function buildSideboard(width = 2.4): BuiltModel {
  const group = new THREE.Group();
  group.name = "sideboard";
  const wood = surface(0x8b6a4d, { roughness: 0.66 });
  const trim = surface(0xa5825f, { roughness: 0.6 });
  const steel = surface(PALETTE.brass, { roughness: 0.36, metalness: 0.7 });
  const height = SURFACE_HEIGHTS.sideboard;
  const depth = 0.86;

  group.add(box(width, height - 0.18, depth, wood, [0, (height - 0.18) / 2 + 0.16, 0]));
  group.add(box(width + 0.08, 0.07, depth + 0.06, trim, [0, height - 0.035, 0]));
  for (const sx of [-1, 1] as const) {
    group.add(box(0.09, 0.18, 0.09, wood, [sx * (width / 2 - 0.12), 0.09, depth / 2 - 0.12]));
    group.add(box(0.09, 0.18, 0.09, wood, [sx * (width / 2 - 0.12), 0.09, -depth / 2 + 0.12]));
  }
  for (const sx of [-1, 1] as const) {
    group.add(box(width / 2 - 0.14, height - 0.42, 0.04, trim, [sx * width / 4, height / 2 + 0.06, depth / 2 - 0.01]));
    group.add(cylinder(0.02, 0.02, 0.05, steel, [sx * width / 4 + sx * 0.2, height / 2 + 0.06, depth / 2 + 0.03], 8));
  }

  return {
    object: group,
    colliders: [{ center: [0, height / 2, 0], half: [width / 2, height / 2, depth / 2] }],
  };
}

export function buildWashingMachine(): BuiltModel {
  const group = new THREE.Group();
  group.name = "washing-machine";
  const shell = surface(0xe6e6e0, { roughness: 0.44, metalness: 0.12 });
  const dark = surface(0x3c4247, { roughness: 0.3, metalness: 0.35 });
  const glass = surface(0x8fb4c4, { roughness: 0.08, transparent: true, opacity: 0.55 });
  const size = 1.15;
  const height = SURFACE_HEIGHTS.washer;

  group.add(box(size, height, size, shell, [0, height / 2, 0]));
  const door = cylinder(0.34, 0.34, 0.06, dark, [0, height * 0.52, size / 2 + 0.01], 20);
  door.rotation.x = Math.PI / 2;
  group.add(door);
  const window = cylinder(0.26, 0.26, 0.05, glass, [0, height * 0.52, size / 2 + 0.04], 20);
  window.rotation.x = Math.PI / 2;
  group.add(window);
  group.add(box(size - 0.1, 0.16, 0.04, dark, [0, height - 0.14, size / 2 - 0.01]));

  return {
    object: group,
    colliders: [{ center: [0, height / 2, 0], half: [size / 2, height / 2, size / 2] }],
  };
}

/** Floating shelf: the highest rung of the kitchen traversal network. */
export function buildWallShelf(width = 1.9): BuiltModel {
  const group = new THREE.Group();
  group.name = "wall-shelf";
  const wood = surface(0x9a7550, { roughness: 0.7 });
  const bracket = surface(0x574a3f, { roughness: 0.6 });
  group.add(box(width, 0.09, 0.62, wood, [0, 0, 0]));
  for (const sx of [-1, 1] as const) {
    group.add(box(0.06, 0.2, 0.42, bracket, [sx * (width / 2 - 0.24), -0.14, -0.06]));
  }
  return {
    object: group,
    colliders: [{ center: [0, -0.01, 0], half: [width / 2, 0.07, 0.31] }],
  };
}

/** Cardboard box with open flaps — the cat's home base and innocence spot. */
export function buildCardboardBox(): BuiltModel {
  const group = new THREE.Group();
  group.name = "cardboard-box";
  const card = surface(PALETTE.cardboard, { roughness: 1 });
  const shade = surface(PALETTE.cardboardDark, { roughness: 1 });
  const width = 1.85;
  const depth = 1.45;
  const height = SURFACE_HEIGHTS.box;

  group.add(box(width, 0.08, depth, shade, [0, 0.04, 0]));
  const blanket = box(width - 0.22, 0.07, depth - 0.22, surface(0xb2606f, { roughness: 1 }), [0, 0.1, 0]);
  group.add(blanket);
  for (const [x, z, w, d] of [
    [-width / 2 + 0.04, 0, 0.07, depth], [width / 2 - 0.04, 0, 0.07, depth],
    [0, -depth / 2 + 0.04, width, 0.07], [0, depth / 2 - 0.04, width, 0.07],
  ] as const) {
    group.add(box(w, height, d, card, [x, height / 2, z]));
  }
  // Two flaps folded outward, catching light differently from the walls.
  for (const [z, tilt] of [[-depth / 2 + 0.04, -0.85], [depth / 2 - 0.04, 0.85]] as const) {
    const flap = box(width, 0.05, depth * 0.52, shade, [0, height + depth * 0.11, z + Math.sign(z) * depth * 0.2]);
    flap.rotation.x = tilt;
    group.add(flap);
  }

  return {
    object: group,
    colliders: [
      { center: [-width / 2 + 0.04, height / 2, 0], half: [0.045, height / 2, depth / 2] },
      { center: [width / 2 - 0.04, height / 2, 0], half: [0.045, height / 2, depth / 2] },
      { center: [0, height / 2, -depth / 2 + 0.04], half: [width / 2, height / 2, 0.045] },
      { center: [0, height / 2, depth / 2 - 0.04], half: [width / 2, height / 2, 0.045] },
      { center: [0, 0.07, 0], half: [width / 2, 0.07, depth / 2] },
    ],
  };
}

export function buildPottedPlant(scale = 1): BuiltModel {
  const group = new THREE.Group();
  group.name = "potted-plant";
  const pot = surface(PALETTE.plantPot, { roughness: 0.85 });
  const soil = surface(PALETTE.soil, { roughness: 1 });
  const leaf = surface(PALETTE.leaf, { roughness: 0.92, flatShading: true });

  group.add(cylinder(0.32 * scale, 0.24 * scale, 0.44 * scale, pot, [0, 0.22 * scale, 0], 14));
  group.add(cylinder(0.35 * scale, 0.33 * scale, 0.08 * scale, pot, [0, 0.44 * scale, 0], 14));
  group.add(cylinder(0.3 * scale, 0.3 * scale, 0.04 * scale, soil, [0, 0.46 * scale, 0], 12));
  for (let blade = 0; blade < 7; blade += 1) {
    const angle = (blade / 7) * Math.PI * 2;
    const lean = 0.34 + (blade % 3) * 0.12;
    const height = (0.62 + (blade % 4) * 0.16) * scale;
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.07 * scale, height, 4), leaf);
    stem.position.set(Math.cos(angle) * 0.13 * scale, 0.48 * scale + height / 2, Math.sin(angle) * 0.13 * scale);
    stem.rotation.z = Math.cos(angle) * -lean;
    stem.rotation.x = Math.sin(angle) * lean;
    stem.castShadow = true;
    group.add(stem);
  }
  return {
    object: group,
    colliders: [{ center: [0, 0.24 * scale, 0], half: [0.3 * scale, 0.24 * scale, 0.3 * scale] }],
  };
}

/** Raised garden planter — the first jumpable ledge the player meets. */
export function buildPlanter(width = 2.6, depth = 1.1): BuiltModel {
  const group = new THREE.Group();
  group.name = "planter";
  const brick = surface(0xa9714f, { roughness: 0.95 });
  const soil = surface(PALETTE.soil, { roughness: 1 });
  const leaf = surface(0x5d7a4c, { roughness: 0.95, flatShading: true });
  const height = SURFACE_HEIGHTS.planter;

  group.add(box(width, height, depth, brick, [0, height / 2, 0]));
  group.add(box(width + 0.08, 0.09, depth + 0.08, surface(0xbd8360, { roughness: 0.9 }), [0, height - 0.045, 0]));
  group.add(box(width - 0.24, 0.08, depth - 0.24, soil, [0, height - 0.05, 0]));
  for (let bush = 0; bush < 5; bush += 1) {
    const clump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + (bush % 3) * 0.06, 0), leaf);
    clump.position.set(-width / 2 + 0.4 + bush * ((width - 0.8) / 4), height + 0.12, (bush % 2) * 0.16 - 0.08);
    clump.castShadow = true;
    group.add(clump);
  }

  return {
    object: group,
    colliders: [{ center: [0, height / 2, 0], half: [width / 2, height / 2, depth / 2] }],
  };
}

export function buildFencePanel(width = 3.2, height = 2.3): BuiltModel {
  const group = new THREE.Group();
  group.name = "fence-panel";
  const plank = surface(0x9c7c58, { roughness: 1 });
  const post = surface(0x7d6144, { roughness: 1 });
  const count = Math.max(4, Math.round(width / 0.32));
  for (let index = 0; index < count; index += 1) {
    const x = -width / 2 + 0.16 + index * ((width - 0.32) / (count - 1));
    const variance = ((index * 37) % 7) / 100;
    group.add(box(0.26, height - variance, 0.07, plank, [x, (height - variance) / 2, 0]));
  }
  for (const y of [height * 0.28, height * 0.74]) {
    group.add(box(width, 0.1, 0.05, post, [0, y, -0.05]));
  }
  for (const sx of [-1, 1] as const) {
    group.add(box(0.16, height + 0.16, 0.16, post, [sx * width / 2, (height + 0.16) / 2, 0]));
  }
  return {
    object: group,
    colliders: [{ center: [0, height / 2, 0], half: [width / 2 + 0.08, height / 2, 0.09] }],
  };
}

/** Wall opening with a frame and a door that can swing open. */
export function buildDoorway(width = 2.4, height = 2.9): BuiltModel {
  const group = new THREE.Group();
  group.name = "doorway";
  const frame = surface(0x6f5947, { roughness: 0.82 });
  const panel = surface(0xcbb794, { roughness: 0.78 });
  const brass = surface(PALETTE.brass, { roughness: 0.34, metalness: 0.75 });

  for (const sz of [-1, 1] as const) {
    group.add(box(0.34, height, 0.22, frame, [0, height / 2, sz * (width / 2 + 0.11)]));
  }
  group.add(box(0.34, 0.26, width + 0.44, frame, [0, height - 0.13, 0]));

  const hinge = new THREE.Group();
  hinge.name = "door";
  hinge.position.set(0, 0, -width / 2);
  group.add(hinge);
  const leaf = box(0.09, height - 0.3, width - 0.08, panel, [0, (height - 0.3) / 2, (width - 0.08) / 2]);
  hinge.add(leaf);
  for (const [y, z] of [[0.85, 0.55], [1.85, 0.55]] as const) {
    hinge.add(box(0.06, 0.6, width * 0.32, surface(0xb9a483, { roughness: 0.8 }), [0.05, y, z * width * 0.5]));
  }
  hinge.add(cylinder(0.05, 0.05, 0.16, brass, [0.1, 1.32, width - 0.32], 10));

  return {
    object: group,
    colliders: [
      { center: [0, height / 2, width / 2 + 0.11], half: [0.17, height / 2, 0.11] },
      { center: [0, height / 2, -(width / 2 + 0.11)], half: [0.17, height / 2, 0.11] },
    ],
    parts: { door: hinge },
  };
}

/** Window with a frame, glazing bars, a sill, and curtains. */
export function buildWindow(width = 2.6, height = 1.9): BuiltModel {
  const group = new THREE.Group();
  group.name = "window";
  const frame = surface(0xf1eadb, { roughness: 0.62 });
  const glass = surface(0xbcd6de, {
    roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.34, emissive: 0x9fc4d2, emissiveIntensity: 0.35,
  });
  const curtain = surface(0xd7c5a6, { roughness: 1 });

  group.add(box(0.12, height + 0.22, width + 0.22, frame, [0, 0, 0]));
  group.add(box(0.06, height, width, glass, [0.02, 0, 0]));
  group.add(box(0.09, 0.07, width, frame, [0.01, 0, 0]));
  group.add(box(0.09, height, 0.07, frame, [0.01, 0, 0]));
  group.add(box(0.32, 0.1, width + 0.36, frame, [0.06, -height / 2 - 0.1, 0]));
  for (const sz of [-1, 1] as const) {
    const drape = box(0.1, height + 0.5, width * 0.24, curtain, [-0.06, 0.06, sz * (width / 2 - width * 0.1)]);
    group.add(drape);
  }

  return { object: group, colliders: [] };
}

export function buildRug(width: number, depth: number, color = PALETTE.rug): BuiltModel {
  const group = new THREE.Group();
  group.name = "rug";
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.024, depth), surface(color, { roughness: 1 }));
  base.position.y = 0.012;
  base.receiveShadow = true;
  group.add(base);
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.34, 0.026, depth - 0.34),
    surface(PALETTE.rugTrim, { roughness: 1 }),
  );
  trim.position.y = 0.014;
  trim.receiveShadow = true;
  group.add(trim);
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.56, 0.028, depth - 0.56),
    surface(color, { roughness: 1 }),
  );
  inner.position.y = 0.016;
  inner.receiveShadow = true;
  group.add(inner);
  return { object: group, colliders: [] };
}

/** Kitchen bin with a swing lid the cat can knock. */
export function buildBin(): BuiltModel {
  const group = new THREE.Group();
  group.name = "bin";
  const metal = surface(0x9aa1a4, { roughness: 0.42, metalness: 0.55 });
  group.add(cylinder(0.34, 0.3, 0.92, metal, [0, 0.46, 0], 16));
  const lid = cylinder(0.36, 0.35, 0.08, metal, [0, 0.95, 0], 16);
  lid.name = "bin-lid";
  group.add(lid);
  group.add(cylinder(0.05, 0.05, 0.05, metal, [0, 1.01, 0], 8));
  return {
    object: group,
    colliders: [{ center: [0, 0.48, 0], half: [0.32, 0.48, 0.32] }],
    parts: { lid },
  };
}

/** Floor slab with a procedural surface. Falls back to flat colour in Node. */
export function buildFloorSlab(
  width: number,
  depth: number,
  kind: "wood" | "tile" | "grass" | "flat",
  color: number,
): THREE.Mesh {
  const map = kind === "wood"
    ? woodFloorTexture([width / 2.4, depth / 2.4])
    : kind === "tile"
      ? tileTexture([width / 1.5, depth / 1.5])
      : kind === "grass"
        ? grassTexture([width / 1.4, depth / 1.4])
        : null;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.08, depth),
    surface(color, { roughness: 0.94, map }),
  );
  mesh.receiveShadow = true;
  return mesh;
}
