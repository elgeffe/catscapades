import { describe, expect, it } from "vitest";
import {
  CAMERA_ZONES, JUMP_TARGETS, OWNER_ROUTINE, PLACEMENTS, PROPS, STATIONS, WALLS, WORLD,
} from "./level-data";
import { SURFACE_HEIGHTS } from "../models/furniture";
import { selectCameraZone } from "../core/gameplay";

/**
 * Level-data integrity.
 *
 * These are the mistakes that produce a level which loads, renders, and is
 * quietly unfinishable: a jump target you can never be offered, a landing that
 * does not match the furniture under it, a station floating above its counter.
 * None of them throw at runtime, so they are asserted here instead.
 */
describe("level data", () => {
  const MAX_LEDGE_HEIGHT = 1.5;

  it("keeps every placement inside the world bounds", () => {
    for (const placement of PLACEMENTS) {
      const [x, , z] = placement.position;
      expect(x, placement.id).toBeGreaterThanOrEqual(WORLD.minX - 0.2);
      expect(x, placement.id).toBeLessThanOrEqual(WORLD.maxX + 0.2);
      expect(z, placement.id).toBeGreaterThanOrEqual(WORLD.minZ - 0.2);
      expect(z, placement.id).toBeLessThanOrEqual(WORLD.maxZ + 0.2);
    }
  });

  it("gives every jump target a reachable rise from its approach", () => {
    for (const target of JUMP_TARGETS) {
      const rise = target.landing[1];
      expect(rise, target.id).toBeGreaterThan(0.12);
      // A jump from the floor must be within one leap; anything higher has to
      // be reached in stages, which means it needs a lower target beneath it.
      if (rise > MAX_LEDGE_HEIGHT) {
        const staging = JUMP_TARGETS.filter(
          (candidate) => candidate !== target
            && candidate.landing[1] < rise
            && rise - candidate.landing[1] <= MAX_LEDGE_HEIGHT
            && Math.hypot(candidate.landing[0] - target.approach[0], candidate.landing[2] - target.approach[1])
              <= target.approachRadius,
        );
        expect(staging.length, `${target.id} has no staging surface beneath it`).toBeGreaterThan(0);
      }
      const span = Math.hypot(
        target.landing[0] - target.approach[0],
        target.landing[2] - target.approach[1],
      );
      expect(span, `${target.id} approach is too far from its landing`).toBeLessThanOrEqual(
        target.approachRadius + 0.6,
      );
    }
  });

  it("lands jump targets on the height of the furniture they name", () => {
    const expected: Record<string, number> = {
      "kitchen-chair": SURFACE_HEIGHTS.seat,
      "dining-chair": SURFACE_HEIGHTS.seat,
      "kitchen-table": SURFACE_HEIGHTS.table,
      "dining-table": SURFACE_HEIGHTS.table,
      counter: SURFACE_HEIGHTS.counter,
      "sink-top": SURFACE_HEIGHTS.counter,
      shelf: SURFACE_HEIGHTS.shelf,
      sideboard: SURFACE_HEIGHTS.sideboard,
      washer: SURFACE_HEIGHTS.washer,
      planter: SURFACE_HEIGHTS.planter,
    };
    for (const target of JUMP_TARGETS) {
      const surface = expected[target.id];
      if (surface === undefined) continue;
      // Landings sit a whisker above the surface so the character controller
      // settles onto it rather than starting inside it.
      expect(target.landing[1] - surface, target.id).toBeGreaterThanOrEqual(0);
      expect(target.landing[1] - surface, target.id).toBeLessThanOrEqual(0.12);
    }
  });

  it("puts elevated stations within reach of a surface the cat can stand on", () => {
    for (const station of STATIONS) {
      if (station.minHeight === undefined) continue;
      const reachable = JUMP_TARGETS.some(
        (target) => target.landing[1] >= station.minHeight!
          && Math.hypot(target.landing[0] - station.position[0], target.landing[2] - station.position[2])
            <= station.radius + 1.6,
      );
      expect(reachable, `${station.id} cannot be reached from any jump target`).toBe(true);
    }
  });

  it("places every carryable prop where the cat can get to it", () => {
    for (const prop of PROPS.filter((candidate) => candidate.carryable)) {
      if (prop.position[1] < 0.4) continue;
      const reachable = JUMP_TARGETS.some(
        (target) => Math.abs(target.landing[1] - prop.position[1]) < 0.75
          && Math.hypot(target.landing[0] - prop.position[0], target.landing[2] - prop.position[2]) < 2.2,
      );
      expect(reachable, `${prop.id} sits on nothing the cat can climb`).toBe(true);
    }
  });

  it("defines one camera zone per room and reaches all of them", () => {
    expect(CAMERA_ZONES).toHaveLength(3);
    expect(selectCameraZone("garden", 0)).toBe("kitchen");
    expect(selectCameraZone("kitchen", 10)).toBe("dining");
    expect(selectCameraZone("dining", 0)).toBe("kitchen");
    expect(selectCameraZone("kitchen", -10)).toBe("garden");
  });

  it("opens both interior partitions so the rooms actually connect", () => {
    for (const wall of WALLS.filter((candidate) => candidate.at === WORLD.backDoorX || candidate.at === WORLD.archX)) {
      expect(wall.gaps?.length, `wall at ${wall.at} has no opening`).toBeGreaterThan(0);
      for (const gap of wall.gaps ?? []) {
        expect(gap.to - gap.from, `opening at ${wall.at} is too narrow`).toBeGreaterThan(1.4);
      }
    }
  });

  it("keeps the homeowner's routine inside the house", () => {
    expect(OWNER_ROUTINE.length).toBeGreaterThanOrEqual(3);
    for (const stop of OWNER_ROUTINE) {
      expect(stop.position[0], "routine stop leaves the house").toBeGreaterThan(WORLD.backDoorX);
      expect(stop.dwell).toBeGreaterThan(0);
    }
  });
});
