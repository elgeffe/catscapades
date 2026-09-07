import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PhysicsWorld } from "../physics/physics-world";
import { AStarPathfinder } from "../core/pathfinding";
import { buildLevel, SUN_SHADOW_TUNING } from "./level-builder";
import { OWNER_ROUTINE, SPAWN, WORLD } from "./level-data";

const OWNER_CLEARANCE = 0.4;

function buildOwnerPathfinder(): AStarPathfinder {
  return new AStarPathfinder({
    minX: WORLD.minX + OWNER_CLEARANCE,
    maxX: WORLD.maxX - OWNER_CLEARANCE,
    minZ: WORLD.minZ + OWNER_CLEARANCE,
    maxZ: WORLD.maxZ - OWNER_CLEARANCE,
  }, 0.4, OWNER_CLEARANCE);
}

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
