import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PhysicsWorld } from "../physics/physics-world";
import { AStarPathfinder } from "../core/pathfinding";
import { buildLevel, SUN_SHADOW_TUNING } from "./level-builder";
import { JUMP_TARGETS, OWNER_ROUTINE, SPAWN, WORLD } from "./level-data";
import { MAX_PERCH_HEIGHT } from "../cat/cat-controller";
import { SURFACE_HEIGHTS } from "../models/furniture";

const OWNER_CLEARANCE = 0.4;

function buildOwnerPathfinder(): AStarPathfinder {
  return new AStarPathfinder({
    minX: WORLD.minX + OWNER_CLEARANCE,
    maxX: WORLD.maxX - OWNER_CLEARANCE,
    minZ: WORLD.minZ + OWNER_CLEARANCE,
    maxZ: WORLD.maxZ - OWNER_CLEARANCE,
  }, 0.4, OWNER_CLEARANCE);
}

describe("homeowner line of sight through the real level", () => {
  const EYE = 2.02;

  /**
   * Rapier's query pipeline is populated by `step`, so a world that has never
   * stepped answers every raycast with "nothing there". The game steps once per
   * fixed update; these tests have to do the same before asking about sight.
   */
  async function steppedLevel(): Promise<PhysicsWorld> {
    const physics = await PhysicsWorld.create();
    buildLevel(new THREE.Scene(), physics);
    physics.step();
    return physics;
  }

  it("sees down an open room and not through its walls", async () => {
    const physics = await steppedLevel();

    // Along the kitchen, nothing in between.
    expect(physics.hasLineOfSight(
      { x: 5.3, y: EYE, z: -2.5 }, { x: 5.3, y: 0.3, z: -5.6 },
    )).toBe(true);
    // From the garden into the kitchen, through the outside wall.
    expect(physics.hasLineOfSight(
      { x: -11.4, y: EYE, z: -2.4 }, { x: 5.3, y: 0.3, z: -5.6 },
    )).toBe(false);
  });

  it("is blocked by the worktop for a cat on the floor behind it", async () => {
    const physics = await steppedLevel();
    const eye = { x: 5.3, y: EYE, z: -1.5 };

    // A cat pressed against the far side of the counter run is hidden…
    expect(physics.hasLineOfSight(eye, { x: 5.3, y: 0.12, z: -7.4 })).toBe(false);
    // …and the same cat standing on the worktop is not. This pairing is the
    // whole point of tracing sight rather than measuring distance.
    expect(physics.hasLineOfSight(eye, { x: 5.3, y: 1.72, z: -6.7 })).toBe(true);
  });

  it("ignores swipeable props, which are not cover", async () => {
    const physics = await steppedLevel();
    const sightline = () => physics.hasLineOfSight(
      { x: 5.3, y: EYE, z: -2.5 }, { x: 5.3, y: 1.5, z: -5.2 },
    );
    expect(sightline()).toBe(true);

    // Park a swipeable prop squarely in that sightline. A homeowner is not
    // blinded by a sock, so dynamic bodies are excluded from the sight filter.
    physics.addDynamicBody({
      id: "sight-blocker",
      shape: { kind: "box", halfExtents: [0.4, 0.4, 0.4] },
      position: new THREE.Vector3(5.3, 1.5, -5.2),
      mass: 0.4,
    });
    physics.step();
    expect(sightline()).toBe(true);
  });
});

describe("the cat cannot climb out of the level", () => {
  async function steppedLevel(): Promise<PhysicsWorld> {
    const physics = await PhysicsWorld.create();
    buildLevel(new THREE.Scene(), physics);
    physics.step();
    return physics;
  }

  it("never offers a boundary wall as a ledge", async () => {
    const physics = await steppedLevel();
    // Standing on the wall shelf at 2.02, the top of the 3.2 wall behind it is
    // 1.18 up — well inside a cat's jump. Chaining counter → shelf → wall top
    // put the player outside the level entirely.
    const onShelf = new THREE.Vector3(5.3, 2.11, -7.2);
    for (const facing of [Math.PI, Math.PI * 0.9, Math.PI * 1.1]) {
      const probe = physics.probeLedge(onShelf, facing, 1.05, 1.5);
      expect(probe?.height ?? 0, `probe towards ${facing} found a wall top`)
        .toBeLessThan(WORLD.wallHeight - 0.5);
    }
  });

  it("never offers a garden fence as a ledge", async () => {
    const physics = await steppedLevel();
    // From the brick planter at 0.82 the 2.3 fence top is 1.48 up — also
    // inside a jump, and also a way out.
    const onPlanter = new THREE.Vector3(-12.5, 0.86, -2.4);
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const probe = physics.probeLedge(onPlanter, facing, 1.05, 1.5);
      expect(probe?.height ?? 0, `probe towards ${facing} found a fence top`)
        .toBeLessThan(1.9);
    }
  });

  it("reports walls and fences as unclimbable, and furniture as climbable", async () => {
    const physics = await steppedLevel();
    // On top of the north kitchen wall, and on top of the worktop.
    expect(physics.isClimbableAt(1.9, WORLD.wallHeight, -8 + WORLD.wallThickness / 2)).toBe(false);
    expect(physics.isClimbableAt(5.3, SURFACE_HEIGHTS.counter, -7.1)).toBe(true);
  });

  it("keeps every authored landing inside the level and below the perch limit", async () => {
    const physics = await steppedLevel();
    for (const target of JUMP_TARGETS) {
      const [x, y, z] = target.landing;
      expect(y, `${target.id} lands above the authored traversal`)
        .toBeLessThanOrEqual(MAX_PERCH_HEIGHT);
      expect(x, `${target.id} lands outside the level`).toBeGreaterThan(WORLD.minX + 0.45);
      expect(x, `${target.id} lands outside the level`).toBeLessThan(WORLD.maxX - 0.45);
      expect(z, `${target.id} lands outside the level`).toBeGreaterThan(WORLD.minZ + 0.45);
      expect(z, `${target.id} lands outside the level`).toBeLessThan(WORLD.maxZ - 0.45);
      // And it must be something the cat is allowed to stand on.
      expect(physics.isClimbableAt(x, y, z, 0.5), `${target.id} lands on a wall`).toBe(true);
    }
  });
});

describe("rendered level openings and navigation", () => {
  it("builds both room openings without overlapping doorway models", async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const handles = buildLevel(scene, physics);

    expect(handles.parts.has("back-door:door")).toBe(false);
    expect(handles.parts.has("arch:door")).toBe(false);
    expect(scene.getObjectByName("doorway")).toBeUndefined();
  });

  it("keeps every homeowner routine leg reachable through the real furniture colliders", async () => {
    const physics = await PhysicsWorld.create();
    buildLevel(new THREE.Scene(), physics);
    const pathfinder = buildOwnerPathfinder();
    const obstacles = physics.navigationObstacles(0.08, 1.9);
    let from = { x: SPAWN.owner.x, z: SPAWN.owner.z };

    for (const stop of OWNER_ROUTINE) {
      const to = { x: stop.position[0], z: stop.position[1] };
      const path = pathfinder.findPath(from, to, obstacles);
      expect(path, `routine leg to ${to.x},${to.z} has no A* route`).not.toBeNull();
      expect(path?.reachedGoal, `routine stop ${to.x},${to.z} is obstructed`).toBe(true);
      from = to;
    }
  });

  it("lets both the cat collider and A* route through the permanent garden opening", async () => {
    const physics = await PhysicsWorld.create();
    buildLevel(new THREE.Scene(), physics);
    const pathfinder = buildOwnerPathfinder();
    const inside = { x: 1.8, z: 0 };
    const garden = { x: -8, z: 0 };
    const openRoute = pathfinder.findPath(
      inside, garden, physics.navigationObstacles(0.08, 1.9),
    );
    expect(openRoute).not.toBeNull();
    expect(openRoute?.reachedGoal).toBe(true);

    const catBody = physics.createCharacter(
      new THREE.Vector3(-4.4, 0.02, 0), 0.19, 0.1, { autostep: 0.24, snap: 0.22 },
    );
    for (let step = 0; step < 120; step += 1) {
      catBody.move(new THREE.Vector3(0.025, -0.01, 0));
      physics.step();
    }
    const catFeet = catBody.feet(new THREE.Vector3());
    expect(catFeet.x).toBeGreaterThan(-2.8);
  });

  it("uses depth-stable directional-shadow tuning for the full level", async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    buildLevel(scene, physics);
    const sun = scene.children.find(
      (child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight,
    );

    expect(sun).toBeDefined();
    expect(sun?.shadow.camera.near).toBe(SUN_SHADOW_TUNING.near);
    expect(sun?.shadow.camera.far).toBe(SUN_SHADOW_TUNING.far);
    expect(sun?.shadow.bias).toBe(SUN_SHADOW_TUNING.bias);
    expect(sun?.shadow.normalBias).toBe(SUN_SHADOW_TUNING.normalBias);
    expect(SUN_SHADOW_TUNING.far - SUN_SHADOW_TUNING.near).toBeLessThan(40);
  });
});
