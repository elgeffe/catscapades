import * as THREE from "three";
import {
  buildBin, buildCardboardBox, buildChair, buildDiningTable, buildDoorway, buildFencePanel,
  buildFloorSlab, buildFridge, buildKitchenCounter, buildPlanter,
  buildPottedPlant, buildRug, buildSideboard, buildSinkUnit, buildStove, buildWallCupboard,
  buildWallShelf, buildWashingMachine, buildWindow, type BuiltModel,
} from "../models/furniture";
import { buildCatBowl, buildFlourBag, buildLaundryBasket, buildPuddle } from "../models/props";
import { PALETTE, plasterTexture, surface } from "../models/materials";
import {
  CAMERA_ZONES, FLOORS, FLOUR_BAG_POSITION, PLACEMENTS, WALLS, WORLD,
  type PlacementSpec, type WallSpec,
} from "./level-data";
import type { PhysicsWorld } from "../physics/physics-world";

/** Stable directional-shadow settings for the full 30-unit diorama. */
export const SUN_SHADOW_TUNING = {
  near: 8,
  far: 45,
  bias: -0.001,
  normalBias: 0.08,
} as const;

/**
 * Turns authored level data into a scene graph plus Rapier colliders.
 *
 * Visuals and collision come from the same source: every furniture builder
 * reports its own boxes, so a piece can never be visible-but-not-solid or the
 * reverse. That is what makes "jump onto that thing" reliable — the shape the
 * player sees is exactly the shape the character controller lands on.
 */

export interface LevelHandles {
  /** Named sub-objects the game animates: taps, water, and spill states. */
  readonly parts: ReadonlyMap<string, THREE.Object3D>;
  readonly flourBag: BuiltModel;
  readonly puddle: THREE.Object3D;
  readonly sinkStream: THREE.Object3D;
  readonly sinkPool: THREE.Object3D;
  readonly sinkOverflow: THREE.Object3D;
  readonly cupboardDoor: THREE.Object3D;
}

export function buildLevel(scene: THREE.Scene, physics: PhysicsWorld): LevelHandles {
  const parts = new Map<string, THREE.Object3D>();

  buildEnvironment(scene);
  buildFloors(scene, physics);
  for (const wall of WALLS) buildWall(scene, physics, wall);
  for (const placement of PLACEMENTS) buildPlacement(scene, physics, placement, parts);

  // -- interactive dressing that is not plain furniture ----------------------
  const flourBag = buildFlourBag();
  flourBag.object.position.set(FLOUR_BAG_POSITION[0], FLOUR_BAG_POSITION[1], FLOUR_BAG_POSITION[2]);
  flourBag.object.rotation.y = -0.24;
  scene.add(flourBag.object);
  for (const collider of flourBag.colliders) {
    physics.addStaticBox({
      center: [
        FLOUR_BAG_POSITION[0] + collider.center[0],
        FLOUR_BAG_POSITION[1] + collider.center[1],
        FLOUR_BAG_POSITION[2] + collider.center[2],
      ],
      halfExtents: collider.half,
      label: "flour-bag",
    });
  }

  const puddle = buildPuddle().object;
  puddle.position.set(2.2, 0.06, -5.6);
  puddle.visible = false;
  puddle.scale.setScalar(0.001);
  scene.add(puddle);

  const handles: LevelHandles = {
    parts,
    flourBag,
    puddle,
    sinkStream: requirePart(parts, "sink:stream"),
    sinkPool: requirePart(parts, "sink:pool"),
    sinkOverflow: requirePart(parts, "sink:overflow"),
    cupboardDoor: requirePart(parts, "cupboard:door"),
  };
  return handles;
}

function requirePart(parts: ReadonlyMap<string, THREE.Object3D>, key: string): THREE.Object3D {
  const part = parts.get(key);
  if (!part) throw new Error(`Level is missing the "${key}" part.`);
  return part;
}

// -- environment -------------------------------------------------------------

function buildEnvironment(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0xcddbe2);
  scene.fog = new THREE.Fog(0xcfdae0, 34, 62);

  // Ground slab under everything, so the world never shows a void edge.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(48, 0.6, 34),
    surface(0x6f8a52, { roughness: 1 }),
  );
  ground.position.y = -0.32;
  ground.receiveShadow = true;
  scene.add(ground);

  // Distant hedges to close the garden without walling the camera in.
  const hedge = surface(PALETTE.hedge, { roughness: 1, flatShading: true });
  for (const [x, z, w, d] of [
    [-9.4, -9.6, 13, 1.6], [-9.4, 9.6, 13, 1.6], [-16.4, 0, 1.6, 20],
  ] as const) {
    const bush = new THREE.Mesh(new THREE.BoxGeometry(w, 1.9, d), hedge);
    bush.position.set(x, 0.95, z);
    bush.castShadow = true;
    bush.receiveShadow = true;
    scene.add(bush);
  }

  buildLighting(scene);
}

function buildLighting(scene: THREE.Scene): void {
  // High, slightly south-west sun. A low morning sun looks better in isolation
  // but throws the 3.2-unit house walls right across the garden, which is where
  // the tutorial happens — so the angle is steep enough to keep shadows short.
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.1);
  sun.position.set(-9, 21, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  // Tight depth bounds preserve substantially more precision than the old
  // 1–55 range. The larger normal offset and small negative depth bias prevent
  // static meshes from self-shadowing in stripes ("shadow acne"), which was
  // especially visible on horizontal surfaces on Apple/WebGL GPUs.
  sun.shadow.camera.near = SUN_SHADOW_TUNING.near;
  sun.shadow.camera.far = SUN_SHADOW_TUNING.far;
  sun.shadow.bias = SUN_SHADOW_TUNING.bias;
  sun.shadow.normalBias = SUN_SHADOW_TUNING.normalBias;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(3, 0, -0.5);

  scene.add(new THREE.HemisphereLight(0xe6eff6, 0x7f8763, 2.3));

  // Interior bounce: the house would otherwise read as a cave beside the garden.
  const bounce = new THREE.PointLight(0xffe2b8, 26, 17, 2);
  bounce.position.set(2.2, 2.6, -2.0);
  scene.add(bounce);

  const diningBounce = new THREE.PointLight(0xfff0d0, 16, 13, 2);
  diningBounce.position.set(11.2, 2.5, -1.0);
  scene.add(diningBounce);

  // A soft shaft from the dining window, sold as geometry rather than volumetrics.
  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 7.4),
    surface(0xfff3d6, { roughness: 1, transparent: true, opacity: 0.13, emissive: 0xfff0cf, emissiveIntensity: 0.5, side: THREE.DoubleSide }),
  );
  shaft.rotation.x = -Math.PI / 2;
  shaft.position.set(12.1, 0.05, -1.6);
  shaft.rotation.z = 0.2;
  scene.add(shaft);
}

function buildFloors(scene: THREE.Scene, physics: PhysicsWorld): void {
  for (const floor of FLOORS) {
    const slab = buildFloorSlab(floor.size[0], floor.size[1], floor.kind, floor.color);
    slab.position.set(floor.center[0], -0.04, floor.center[1]);
    scene.add(slab);
  }
  // One physics floor for the whole world keeps the collider count low.
  physics.addStaticBox({
    center: [0, -0.5, 0],
    halfExtents: [26, 0.5, 18],
    friction: 0.95,
    label: "floor",
  });

  // Skirting boards along the interior walls: cheap, and they sell "house".
  const skirting = surface(PALETTE.skirting, { roughness: 0.7 });
  for (const [x, z, w, d] of [
    [5.75, -7.86, 18.9, 0.14], [5.75, 7.86, 18.9, 0.14], [14.86, 0, 0.14, 15.9],
  ] as const) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, d), skirting);
    board.position.set(x, 0.13, z);
    board.receiveShadow = true;
    scene.add(board);
  }
}

// -- walls -------------------------------------------------------------------

function buildWall(scene: THREE.Scene, physics: PhysicsWorld, spec: WallSpec): void {
  const segments = splitByGaps(spec.from, spec.to, spec.gaps ?? []);
  const height = spec.height ?? (spec.kind === "fence" ? 2.3 : WORLD.wallHeight);

  for (const [start, end] of segments) {
    const length = end - start;
    if (length <= 0.02) continue;
    const middle = (start + end) / 2;

    if (spec.kind === "fence") {
      const panel = buildFencePanel(length, height);
      panel.object.position.set(
        spec.axis === "x" ? spec.at : middle,
        0,
        spec.axis === "x" ? middle : spec.at,
      );
      panel.object.rotation.y = spec.axis === "x" ? Math.PI / 2 : 0;
      scene.add(panel.object);
      physics.addStaticBox({
        center: [
          spec.axis === "x" ? spec.at : middle,
          height / 2,
          spec.axis === "x" ? middle : spec.at,
        ],
        halfExtents: spec.axis === "x" ? [0.12, height / 2, length / 2] : [length / 2, height / 2, 0.12],
        label: "fence",
      });
      continue;
    }

    const thickness = WORLD.wallThickness;
    const width = spec.axis === "x" ? thickness : length;
    const depth = spec.axis === "x" ? length : thickness;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      surface(spec.color ?? PALETTE.wall, { roughness: 0.94, map: plasterTexture([width / 3, height / 3]) }),
    );
    mesh.position.set(
      spec.axis === "x" ? spec.at : middle,
      height / 2,
      spec.axis === "x" ? middle : spec.at,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Picture rail along the top edge, so walls do not end on a raw extrusion.
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.06, 0.12, depth + 0.06),
      surface(PALETTE.skirting, { roughness: 0.68 }),
    );
    rail.position.set(mesh.position.x, height - 0.16, mesh.position.z);
    scene.add(rail);

    physics.addStaticBox({
      center: [mesh.position.x, height / 2, mesh.position.z],
      halfExtents: [width / 2, height / 2, depth / 2],
      label: "wall",
    });
  }
}

/** Splits a wall run into solid segments around its openings. */
function splitByGaps(from: number, to: number, gaps: readonly { from: number; to: number }[]): [number, number][] {
  const ordered = [...gaps].sort((a, b) => a.from - b.from);
  const segments: [number, number][] = [];
  let cursor = from;
  for (const gap of ordered) {
    if (gap.from > cursor) segments.push([cursor, Math.min(gap.from, to)]);
    cursor = Math.max(cursor, gap.to);
  }
  if (cursor < to) segments.push([cursor, to]);
  return segments;
}

// -- placements --------------------------------------------------------------

function buildPlacement(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  spec: PlacementSpec,
  parts: Map<string, THREE.Object3D>,
): void {
  const built = instantiate(spec);
  const [x, y, z] = spec.position;
  const rotationY = spec.rotationY ?? 0;
  built.object.position.set(x, y, z);
  built.object.rotation.y = rotationY;
  built.object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(built.object);

  for (const [name, part] of Object.entries(built.parts ?? {})) {
    parts.set(`${spec.id}:${name}`, part);
  }

  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  for (const collider of built.colliders) {
    const [cx, cy, cz] = collider.center;
    physics.addStaticBox({
      center: [x + cx * cos + cz * sin, y + cy, z - cx * sin + cz * cos],
      halfExtents: collider.half,
      rotationY,
      label: spec.id,
    });
  }
}

function instantiate(spec: PlacementSpec): BuiltModel {
  switch (spec.model) {
    case "kitchen-counter": return buildKitchenCounter(spec.size?.[0] ?? 3.2, spec.size?.[1] ?? 1.32);
    case "sink-unit": return buildSinkUnit();
    case "wall-cupboard": return buildWallCupboard(spec.size?.[0] ?? 1.5);
    case "fridge": return buildFridge();
    case "stove": return buildStove();
    case "dining-table": return buildDiningTable(spec.size?.[0] ?? 3.1, spec.size?.[1] ?? 1.9);
    case "chair": return buildChair();
    case "sideboard": return buildSideboard(spec.size?.[0] ?? 2.4);
    case "washing-machine": return buildWashingMachine();
    case "wall-shelf": return buildWallShelf(spec.size?.[0] ?? 1.9);
    case "cardboard-box": return buildCardboardBox();
    case "laundry-basket": return buildLaundryBasket();
    case "bin": return buildBin();
    case "planter": return buildPlanter(spec.size?.[0] ?? 2.6, spec.size?.[1] ?? 1.1);
    case "potted-plant": return buildPottedPlant(spec.scale ?? 1);
    case "fence-panel": return buildFencePanel(spec.size?.[0] ?? 3.2);
    case "rug": return buildRug(spec.size?.[0] ?? 3, spec.size?.[1] ?? 2);
    case "window": return buildWindow(spec.size?.[0] ?? 2.6, spec.size?.[1] ?? 1.9);
    case "doorway": return buildDoorway(spec.size?.[0] ?? 2.4, spec.size?.[1] ?? 2.9);
    case "cat-bowl": return buildCatBowl();
  }
}

export { CAMERA_ZONES };
