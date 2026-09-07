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
  box: 0.14,
  stool: 0.92,
} as const;

/** Local-space dimensions shared by the sink model and its authored level target. */
export const SINK_BASIN_GEOMETRY = {
  centerX: -0.32,
  centerZ: 0,
  openingWidth: 0.96,
  openingDepth: 0.8,
  innerWidth: 0.84,
  innerDepth: 0.68,
  bottom: 1.08,
  rim: COUNTER_HEIGHT,
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
  const width = 2.1;
  const depth = 1.32;
  const cabinet = surface(PALETTE.cabinet, { roughness: 0.78 });
  const trim = surface(PALETTE.cabinetTrim, { roughness: 0.7 });
  const top = surface(PALETTE.counter, { roughness: 0.42, metalness: 0.04 });
  const steel = surface(PALETTE.steel, { roughness: 0.24, metalness: 0.72 });
  const darkSteel = surface(0x657176, { roughness: 0.3, metalness: 0.78 });
  const basin = SINK_BASIN_GEOMETRY;
  const worktopHeight = 0.09;
  const worktopCenterY = COUNTER_HEIGHT - worktopHeight / 2;
  const openingMinX = basin.centerX - basin.openingWidth / 2;
  const openingMaxX = basin.centerX + basin.openingWidth / 2;
  const openingMinZ = basin.centerZ - basin.openingDepth / 2;
  const openingMaxZ = basin.centerZ + basin.openingDepth / 2;

  const carcass = box(
    width, basin.bottom, depth - 0.1, cabinet,
    [0, basin.bottom / 2, 0],
  );
  carcass.name = "sink-carcass";
  group.add(carcass);
  const toeKick = box(width - 0.06, 0.13, depth - 0.34, trim, [0, 0.065, -0.04]);
  toeKick.name = "sink-toe-kick";
  group.add(toeKick);

  // The cabinet front continues up around the bowl without filling its cavity.
  const frontRail = box(width, COUNTER_HEIGHT - basin.bottom - worktopHeight, 0.12, cabinet, [
    0,
    basin.bottom + (COUNTER_HEIGHT - basin.bottom - worktopHeight) / 2,
    depth / 2 - 0.11,
  ]);
  frontRail.name = "sink-front-rail";
  group.add(frontRail);
  const doorWidth = (width - 0.13) / 2;
  for (let index = 0; index < 2; index += 1) {
    const x = -width / 2 + 0.055 + doorWidth * (index + 0.5);
    const door = box(
      doorWidth - 0.05, basin.bottom - 0.24, 0.04, trim,
      [x, (basin.bottom - 0.24) / 2 + 0.19, depth / 2 - 0.06],
    );
    door.name = `sink-door-${index + 1}`;
    group.add(door);
    const handle = cylinder(
      0.018, 0.018, doorWidth * 0.38, steel,
      [x, basin.bottom - 0.08, depth / 2 - 0.02], 8,
    );
    handle.rotation.z = Math.PI / 2;
    group.add(handle);
  }

  // Four slabs leave a real opening in the worktop instead of hiding the bowl
  // beneath one solid box. Their collision boxes use these exact dimensions.
  const worktopSpecs = [
    {
      name: "sink-worktop-back",
      width: width + 0.06,
      depth: openingMinZ + depth / 2,
      x: 0,
      z: (-depth / 2 + openingMinZ) / 2,
    },
    {
      name: "sink-worktop-front",
      width: width + 0.06,
      depth: depth / 2 - openingMaxZ,
      x: 0,
      z: (openingMaxZ + depth / 2) / 2,
    },
    {
      name: "sink-worktop-left",
      width: openingMinX + width / 2,
      depth: basin.openingDepth,
      x: (-width / 2 + openingMinX) / 2,
      z: basin.centerZ,
    },
    {
      name: "sink-worktop-right",
      width: width / 2 - openingMaxX,
      depth: basin.openingDepth,
      x: (openingMaxX + width / 2) / 2,
      z: basin.centerZ,
    },
  ] as const;
  for (const spec of worktopSpecs) {
    const slab = box(spec.width, worktopHeight, spec.depth, top, [
      spec.x, worktopCenterY, spec.z,
    ]);
    slab.name = spec.name;
    group.add(slab);
  }

  const basinDepth = basin.rim - basin.bottom;
  const basinBottom = box(
    basin.innerWidth, 0.025, basin.innerDepth, steel,
    [basin.centerX, basin.bottom, basin.centerZ],
  );
  basinBottom.name = "sink-basin";
  group.add(basinBottom);
  const basinWallSpecs = [
    ["sink-basin-back", basin.innerWidth, 0.035, basin.centerX, basin.centerZ - basin.innerDepth / 2],
    ["sink-basin-front", basin.innerWidth, 0.035, basin.centerX, basin.centerZ + basin.innerDepth / 2],
    ["sink-basin-left", 0.035, basin.innerDepth, basin.centerX - basin.innerWidth / 2, basin.centerZ],
    ["sink-basin-right", 0.035, basin.innerDepth, basin.centerX + basin.innerWidth / 2, basin.centerZ],
  ] as const;
  for (const [name, w, d, x, z] of basinWallSpecs) {
    const wall = box(w, basinDepth, d, steel, [
      x, basin.bottom + basinDepth / 2, z,
    ]);
    wall.name = name;
    group.add(wall);
  }
  const drain = cylinder(
    0.075, 0.075, 0.012, darkSteel,
    [basin.centerX, basin.bottom + 0.019, basin.centerZ], 18,
  );
  drain.name = "sink-drain";
  group.add(drain);
  for (let slot = -1; slot <= 1; slot += 1) {
    const drainSlot = box(0.09, 0.014, 0.012, steel, [
      basin.centerX, basin.bottom + 0.026, basin.centerZ + slot * 0.027,
    ]);
    drainSlot.name = `sink-drain-slot-${slot + 2}`;
    group.add(drainSlot);
  }

  for (let groove = 0; groove < 5; groove += 1) {
    const drainingGroove = box(
      0.62, 0.012, 0.025, steel,
      [0.55, COUNTER_HEIGHT + 0.006, -0.28 + groove * 0.14],
    );
    drainingGroove.name = `draining-board-groove-${groove + 1}`;
    group.add(drainingGroove);
  }

  const tapBase = cylinder(
    0.07, 0.08, 0.06, steel,
    [basin.centerX, COUNTER_HEIGHT + 0.03, openingMinZ - 0.02], 12,
  );
  group.add(tapBase);
  const spout = new THREE.Group();
  spout.name = "tap";
  spout.position.set(basin.centerX, COUNTER_HEIGHT + 0.06, openingMinZ - 0.02);
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
  water.position.set(basin.centerX, COUNTER_HEIGHT + 0.16, basin.centerZ - 0.28);
  water.visible = false;
  group.add(water);

  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(basin.innerWidth - 0.04, 0.02, basin.innerDepth - 0.04),
    surface(PALETTE.water, { roughness: 0.05, transparent: true, opacity: 0.75, emissive: 0x1d5a70, emissiveIntensity: 0.25 }),
  );
  pool.name = "sink-pool";
  pool.position.set(basin.centerX, basin.bottom + 0.025, basin.centerZ);
  pool.visible = false;
  group.add(pool);

  const overflow = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.012, 1.1),
    surface(PALETTE.water, { roughness: 0.05, transparent: true, opacity: 0.5 }),
  );
  overflow.name = "sink-overflow";
  overflow.position.set(-0.2, COUNTER_HEIGHT + 0.056, 0.2);
  overflow.visible = false;
  group.add(overflow);

  const colliders: BoxShape[] = [
    {
      center: [0, basin.bottom / 2, 0],
      half: [width / 2, basin.bottom / 2, depth / 2 - 0.04],
      label: "sink-carcass",
    },
    {
      center: [0, frontRail.position.y, frontRail.position.z],
      half: [width / 2, (COUNTER_HEIGHT - basin.bottom - worktopHeight) / 2, 0.06],
      label: "sink-front-rail",
    },
    {
      center: [basin.centerX, basin.bottom, basin.centerZ],
      half: [basin.innerWidth / 2, 0.0125, basin.innerDepth / 2],
      label: "sink-basin-bottom",
    },
  ];
  for (const spec of worktopSpecs) {
    colliders.push({
      center: [spec.x, worktopCenterY, spec.z],
      half: [spec.width / 2, worktopHeight / 2, spec.depth / 2],
      label: spec.name,
    });
  }
  for (const [name, w, d, x, z] of basinWallSpecs) {
    colliders.push({
      center: [x, basin.bottom + basinDepth / 2, z],
      half: [w / 2, basinDepth / 2, d / 2],
      label: name,
    });
  }

  return {
    object: group,
    colliders,
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

/** Low cardboard sleeping pad — the cat's outdoor home base and innocence spot. */
export function buildCardboardBox(): BuiltModel {
  const group = new THREE.Group();
  group.name = "cardboard-box";
  const shade = surface(PALETTE.cardboardDark, { roughness: 1 });
  const width = 1.85;
  const depth = 1.45;

  // Keep this as two vertically separated surfaces. The former four walls and
  // folded flaps made the sleeping spot harder to enter and produced several
  // near-overlapping cardboard edges when viewed from the garden camera.
  const base = box(width, 0.07, depth, shade, [0, 0.035, 0]);
  base.name = "sleeping-pad-base";
  group.add(base);
  const blanket = box(
    width - 0.22,
    0.065,
    depth - 0.22,
    surface(0xb2606f, { roughness: 1 }),
    [0, 0.1075, 0],
  );
  blanket.name = "sleeping-pad-blanket";
  group.add(blanket);

  return {
    object: group,
    colliders: [{ center: [0, 0.035, 0], half: [width / 2, 0.035, depth / 2] }],
  };
}

export function buildPottedPlant(scale = 1): BuiltModel {
  const group = new THREE.Group();
  group.name = "potted-plant";
  const pot = surface(PALETTE.plantPot, { roughness: 0.85 });
  const soil = surface(PALETTE.soil, { roughness: 1 });
  const leaf = surface(PALETTE.leaf, { roughness: 0.92, flatShading: true });

  // An open-ended vessel plus a torus lip reads as a real pot from above. The
  // previous solid rim cylinder and soil cylinder shared the exact same top
  // plane, causing the striped z-fighting visible on Apple/WebGL GPUs.
  const vessel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32 * scale, 0.24 * scale, 0.44 * scale, 16, 1, true),
    pot,
  );
  vessel.name = "pot-vessel";
  vessel.position.y = 0.22 * scale;
  vessel.castShadow = true;
  vessel.receiveShadow = true;
  group.add(vessel);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.31 * scale, 0.045 * scale, 8, 20),
    pot,
  );
  rim.name = "pot-rim";
  rim.position.y = 0.46 * scale;
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);

  const soilSurface = cylinder(
    0.285 * scale, 0.285 * scale, 0.022 * scale,
    soil, [0, 0.455 * scale, 0], 16,
  );
  soilSurface.name = "pot-soil";
  group.add(soilSurface);
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
  const rim = surface(0xbd8360, { roughness: 0.9 });
  const soil = surface(PALETTE.soil, { roughness: 1 });
  const leaf = surface(0x5d7a4c, { roughness: 0.95, flatShading: true });
  const height = SURFACE_HEIGHTS.planter;

  // Build an actual open planter instead of stacking capped boxes. The old
  // full brick block, rim block, and soil block occupied the same top region,
  // which produced z-fighting across the large outdoor planter.
  const wallThickness = 0.12;
  const wallHeight = height - 0.1;
  const walls = [
    box(width, wallHeight, wallThickness, brick, [0, wallHeight / 2, -depth / 2 + wallThickness / 2]),
    box(width, wallHeight, wallThickness, brick, [0, wallHeight / 2, depth / 2 - wallThickness / 2]),
    box(wallThickness, wallHeight, depth - wallThickness * 2, brick, [-width / 2 + wallThickness / 2, wallHeight / 2, 0]),
    box(wallThickness, wallHeight, depth - wallThickness * 2, brick, [width / 2 - wallThickness / 2, wallHeight / 2, 0]),
  ];
  walls.forEach((wall, index) => {
    wall.name = `planter-wall-${index}`;
    group.add(wall);
  });

  const rimHeight = 0.1;
  const rimRails = [
    box(width + 0.08, rimHeight, wallThickness, rim, [0, height - rimHeight / 2, -depth / 2 + wallThickness / 2]),
    box(width + 0.08, rimHeight, wallThickness, rim, [0, height - rimHeight / 2, depth / 2 - wallThickness / 2]),
    box(wallThickness, rimHeight, depth - wallThickness * 2, rim, [-width / 2 + wallThickness / 2, height - rimHeight / 2, 0]),
    box(wallThickness, rimHeight, depth - wallThickness * 2, rim, [width / 2 - wallThickness / 2, height - rimHeight / 2, 0]),
  ];
  rimRails.forEach((rail, index) => {
    rail.name = `planter-rim-${index}`;
    group.add(rail);
  });

  const soilBed = box(
    width - 0.3, 0.06, depth - 0.3, soil,
    [0, height - 0.03, 0],
  );
  soilBed.name = "planter-soil";
  group.add(soilBed);
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

/** Permanent framed wall opening. Door leaves are intentionally omitted. */
export function buildDoorway(width = 2.4, height = 2.9): BuiltModel {
  const group = new THREE.Group();
  group.name = "doorway";
  const frame = surface(0x6f5947, { roughness: 0.82 });

  for (const sz of [-1, 1] as const) {
    group.add(box(0.34, height, 0.22, frame, [0, height / 2, sz * (width / 2 + 0.11)]));
  }
  group.add(box(0.34, 0.26, width + 0.44, frame, [0, height - 0.13, 0]));

  return {
    object: group,
    colliders: [
      { center: [0, height / 2, width / 2 + 0.11], half: [0.17, height / 2, 0.11] },
      { center: [0, height / 2, -(width / 2 + 0.11)], half: [0.17, height / 2, 0.11] },
    ],
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
  // Each visible layer starts just above the previous one. The old slabs
  // overlapped almost completely and left their top faces only 0.003 units
  // apart, which can z-fight on lower-precision mobile/Apple depth buffers.
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, depth), surface(color, { roughness: 1 }));
  base.position.y = 0.01;
  base.receiveShadow = true;
  group.add(base);
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.34, 0.008, depth - 0.34),
    surface(PALETTE.rugTrim, { roughness: 1 }),
  );
  trim.position.y = 0.0245;
  trim.receiveShadow = true;
  group.add(trim);
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.56, 0.008, depth - 0.56),
    surface(color, { roughness: 1 }),
  );
  inner.position.y = 0.033;
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
