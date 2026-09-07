import { describe, expect, it } from "vitest";
import {
  AStarPathfinder,
  type NavigationObstacle,
  type NavigationPoint,
} from "./pathfinding";

const pathfinder = new AStarPathfinder({
  minX: 0,
  maxX: 10,
  minZ: 0,
  maxZ: 10,
}, 0.5, 0.25);

describe("A* pathfinding", () => {
  it("returns a direct, exact route through open floor", () => {
    const result = pathfinder.findPath({ x: 1, z: 1 }, { x: 9, z: 9 }, []);

    expect(result).not.toBeNull();
    expect(result?.reachedGoal).toBe(true);
    expect(result?.waypoints).toHaveLength(1);
    expect(result?.waypoints.at(-1)).toEqual({ x: 9, z: 9 });
  });

  it("routes around a solid obstacle instead of steering into it", () => {
    const obstacle: NavigationObstacle = {
      center: { x: 5, z: 5 },
      halfExtents: { x: 1.2, z: 2.2 },
    };
    const result = pathfinder.findPath({ x: 1, z: 5 }, { x: 9, z: 5 }, [obstacle]);

    expect(result).not.toBeNull();
    expect(result?.reachedGoal).toBe(true);
    expect(result?.waypoints.length).toBeGreaterThan(1);
    expect(result?.waypoints.some((point) => Math.abs(point.z - 5) > 2.2)).toBe(true);
    expect(result?.waypoints.at(-1)).toEqual({ x: 9, z: 5 });
  });

  it("rejects an unreachable destination behind a sealed barrier", () => {
    const barrier: NavigationObstacle = {
      center: { x: 5, z: 5 },
      halfExtents: { x: 0.3, z: 5 },
    };

    expect(pathfinder.findPath({ x: 2, z: 5 }, { x: 8, z: 5 }, [barrier])).toBeNull();
  });

  it("stops at a reachable neighbour when the requested point is occupied", () => {
    const occupied: NavigationObstacle = {
      center: { x: 8, z: 5 },
      halfExtents: { x: 0.6, z: 0.6 },
    };
    const goal: NavigationPoint = { x: 8, z: 5 };
    const result = pathfinder.findPath({ x: 2, z: 5 }, goal, [occupied]);

    expect(result).not.toBeNull();
    expect(result?.reachedGoal).toBe(false);
    expect(result?.resolvedGoal).not.toEqual(goal);
    expect(Math.hypot(
      (result?.resolvedGoal.x ?? 0) - goal.x,
      (result?.resolvedGoal.z ?? 0) - goal.z,
    )).toBeLessThanOrEqual(1.5);
  });
});
