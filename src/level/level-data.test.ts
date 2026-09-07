import { describe, expect, it } from "vitest";
import {
  CAMERA_ZONES, JUMP_TARGETS, OWNER_ROUTINE, PLACEMENTS, PROPS, SINK_BASIN, STATIONS, WALLS, WORLD,
} from "./level-data";
import { SINK_BASIN_GEOMETRY, SURFACE_HEIGHTS } from "../models/furniture";
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

  it("aligns the sock-drop target with the visible sink bowl", () => {
    const sink = PLACEMENTS.find((placement) => placement.id === "sink");
    expect(sink?.model).toBe("sink-unit");
    expect(SINK_BASIN.position[0]).toBeCloseTo(
      sink!.position[0] + SINK_BASIN_GEOMETRY.centerX,
    );
    expect(SINK_BASIN.position[2]).toBeCloseTo(
      sink!.position[2] + SINK_BASIN_GEOMETRY.centerZ,
    );
    expect(SINK_BASIN.position[1]).toBeGreaterThan(SINK_BASIN_GEOMETRY.bottom);
    expect(SINK_BASIN.position[1]).toBeLessThan(SINK_BASIN_GEOMETRY.rim);
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

  it("covers every room and gives the utility edge its own composition", () => {
    expect(CAMERA_ZONES).toHaveLength(4);
    expect(selectCameraZone("garden", 0, 0)).toBe("kitchen");
    expect(selectCameraZone("kitchen", 10, 0)).toBe("dining");
    expect(selectCameraZone("dining", 0, 0)).toBe("kitchen");
    expect(selectCameraZone("kitchen", -10, 0)).toBe("garden");
    expect(selectCameraZone("kitchen", 5, 5.1)).toBe("utility");
    expect(CAMERA_ZONES.find((zone) => zone.id === "utility")?.target[2]).toBeGreaterThan(5);
  });

  it("opens both interior partitions so the rooms actually connect", () => {
    for (const wall of WALLS.filter((candidate) => candidate.at === WORLD.backDoorX || candidate.at === WORLD.archX)) {
      expect(wall.gaps?.length, `wall at ${wall.at} has no opening`).toBeGreaterThan(0);
      for (const gap of wall.gaps ?? []) {
        expect(gap.to - gap.from, `opening at ${wall.at} is too narrow`).toBeGreaterThan(1.4);
      }
    }
  });

  it("keeps both room partitions free of temporary door models", () => {
    expect(PLACEMENTS.some((placement) => placement.model === "doorway")).toBe(false);
  });

  it("faces the washing-machine door into the utility room", () => {
    const washer = PLACEMENTS.find((placement) => placement.id === "washer");
    expect(washer?.model).toBe("washing-machine");
    expect(washer?.rotationY).toBeCloseTo(Math.PI);
  });

  it("keeps the homeowner's routine inside the house", () => {
    expect(OWNER_ROUTINE.length).toBeGreaterThanOrEqual(3);
    for (const stop of OWNER_ROUTINE) {
      expect(stop.position[0], "routine stop leaves the house").toBeGreaterThan(WORLD.backDoorX);
      expect(stop.dwell).toBeGreaterThan(0);
    }
  });

  it("stands the homeowner where the thing they are handling actually is", () => {
    // Each purposeful action reaches for something real. A kettle stop metres
    // from the kettle plays the whole animation into thin air, which reads as
    // the routine being decorative — the specific failure the actions exist to
    // remove.
    const near = (
      stop: (typeof OWNER_ROUTINE)[number],
      at: readonly [number, number, number],
      within: number,
    ) => {
      expect(
        Math.hypot(stop.position[0] - at[0], stop.position[1] - at[2]),
        `${stop.action} stop is not within reach of its target`,
      ).toBeLessThan(within);
    };

    const kettle = PROPS.find((prop) => prop.id === "kettle");
    expect(kettle).toBeDefined();
    const kettleStop = OWNER_ROUTINE.find((stop) => stop.action === "kettle");
    expect(kettleStop, "no kettle stop in the routine").toBeDefined();
    near(kettleStop!, kettle!.position, 1.9);

    const cupboard = STATIONS.find((station) => station.id === "cupboard");
    expect(cupboard).toBeDefined();
    const cupboardStop = OWNER_ROUTINE.find((stop) => stop.action === "cupboard");
    expect(cupboardStop, "no cupboard stop in the routine").toBeDefined();
    near(cupboardStop!, cupboard!.position, 1.9);
  });

  it("gives every action something to face", () => {
    for (const stop of OWNER_ROUTINE) {
      if (stop.action === "idle") continue;
      // The vision cone follows the body and the body turns to `lookAt`, so an
      // action without one leaves the homeowner facing whichever way they
      // happened to arrive.
      expect(stop.lookAt, `${stop.action} stop has nothing to face`).toBeDefined();
      const distance = Math.hypot(
        stop.lookAt![0] - stop.position[0], stop.lookAt![2] - stop.position[1],
      );
      expect(distance, `${stop.action} stop faces its own feet`).toBeGreaterThan(0.25);
      expect(distance, `${stop.action} stop faces across the room`).toBeLessThan(4);
    }
  });
});
