import { describe, expect, it } from "vitest";
import {
  OWNER_SIGHT, evaluateSight, rangeAtAngle, searchPattern, type Point3, type SightQuery,
} from "./perception";

const ALWAYS_CLEAR = (): boolean => true;
const NEVER_CLEAR = (): boolean => false;

function query(overrides: Partial<SightQuery> & { readonly at: Point3 }): SightQuery {
  const { at, ...rest } = overrides;
  return {
    from: { x: 0, y: 0, z: 0 },
    facing: 0,
    targets: [{ x: at.x, y: at.y, z: at.z }],
    stillness: 0,
    concealment: 0,
    ...rest,
  };
}

describe("homeowner sight", () => {
  it("sees straight ahead and not behind", () => {
    const ahead = evaluateSight(OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: 5 } }), ALWAYS_CLEAR);
    expect(ahead.visible).toBe(true);
    expect(ahead.reason).toBe("seen");

    const behind = evaluateSight(OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: -5 } }), ALWAYS_CLEAR);
    expect(behind.visible).toBe(false);
    expect(behind.reason).toBe("out-of-cone");
    expect(behind.clarity).toBe(0);
  });

  it("notices a cat at its ankles whichever way it is facing", () => {
    const underfoot = evaluateSight(
      OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: -1.1 } }), ALWAYS_CLEAR,
    );
    expect(underfoot.visible).toBe(true);
  });

  it("has shorter vision at the edge of the cone than down the middle", () => {
    expect(rangeAtAngle(OWNER_SIGHT, 0)).toBe(OWNER_SIGHT.range);
    expect(rangeAtAngle(OWNER_SIGHT, OWNER_SIGHT.halfAngle)).toBeCloseTo(OWNER_SIGHT.edgeRange);

    const distance = (OWNER_SIGHT.range + OWNER_SIGHT.edgeRange) / 2;
    const centre = evaluateSight(
      OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: distance } }), ALWAYS_CLEAR,
    );
    const peripheral = evaluateSight(
      OWNER_SIGHT,
      query({
        at: {
          x: Math.sin(OWNER_SIGHT.halfAngle * 0.95) * distance,
          y: 0.3,
          z: Math.cos(OWNER_SIGHT.halfAngle * 0.95) * distance,
        },
      }),
      ALWAYS_CLEAR,
    );
    expect(centre.visible).toBe(true);
    expect(peripheral.visible).toBe(false);
    expect(peripheral.reason).toBe("out-of-range");
  });

  it("is blocked by anything in the way", () => {
    const blocked = evaluateSight(OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: 5 } }), NEVER_CLEAR);
    expect(blocked.visible).toBe(false);
    expect(blocked.reason).toBe("blocked");
  });

  it("takes the clearest of several sample points on the cat", () => {
    // The counter hides the paws but not the head on the worktop above it.
    const overCounter = evaluateSight(
      OWNER_SIGHT,
      {
        from: { x: 0, y: 0, z: 0 },
        facing: 0,
        targets: [
          { x: 0, y: 1.7, z: 4 },
          { x: 0, y: 0.2, z: 4 },
        ],
        stillness: 0,
        concealment: 0,
      },
      (_from, to) => to.y > 1,
    );
    expect(overCounter.visible).toBe(true);
    expect(overCounter.at?.y).toBe(1.7);
  });

  it("sees a close cat more plainly than a distant one", () => {
    const near = evaluateSight(OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: 2 } }), ALWAYS_CLEAR);
    const far = evaluateSight(OWNER_SIGHT, query({ at: { x: 0, y: 0.3, z: 9 } }), ALWAYS_CLEAR);
    expect(near.clarity).toBeGreaterThan(far.clarity);
    expect(near.clarity).toBeCloseTo(1);
    expect(far.clarity).toBeGreaterThan(0);
  });

  it("rewards holding still and rewards hiding more", () => {
    const at = { x: 0, y: 0.3, z: 6 };
    const running = evaluateSight(OWNER_SIGHT, query({ at, stillness: 0 }), ALWAYS_CLEAR);
    const frozen = evaluateSight(OWNER_SIGHT, query({ at, stillness: 1 }), ALWAYS_CLEAR);
    const boxed = evaluateSight(OWNER_SIGHT, query({ at, concealment: 0.9 }), ALWAYS_CLEAR);

    expect(frozen.clarity).toBeLessThan(running.clarity);
    expect(frozen.visible).toBe(true);
    expect(boxed.clarity).toBeLessThan(frozen.clarity);
    // Fully concealed is not a coin flip: it short-circuits to unseen.
    const hidden = evaluateSight(OWNER_SIGHT, query({ at, concealment: 1 }), ALWAYS_CLEAR);
    expect(hidden.visible).toBe(false);
    expect(hidden.reason).toBe("concealed");
  });

  it("reports the strongest reason it failed, not the first", () => {
    // The head is behind them, the body is merely too far: "out of range" is
    // the more useful diagnosis, and blocked beats both.
    const mixed = evaluateSight(
      OWNER_SIGHT,
      {
        from: { x: 0, y: 0, z: 0 },
        facing: 0,
        targets: [{ x: 0, y: 0.3, z: -8 }, { x: 0, y: 0.3, z: 30 }, { x: 0, y: 0.3, z: 3 }],
        stillness: 0,
        concealment: 0,
      },
      (_from, to) => to.z !== 3,
    );
    expect(mixed.reason).toBe("blocked");
  });
});

describe("search pattern", () => {
  it("starts where the cat was last seen and sweeps outward", () => {
    const points = searchPattern({ x: 4, z: -2 }, 0, 2);
    expect(points[0]).toEqual({ x: 4, z: -2 });
    expect(points.length).toBeGreaterThan(3);
    for (const point of points.slice(1)) {
      const distance = Math.hypot(point.x - 4, point.z + 2);
      expect(distance).toBeGreaterThan(0.5);
      expect(distance).toBeLessThanOrEqual(2.001);
    }
  });

  it("looks on ahead of the cat's heading before doubling back", () => {
    // Heading +x: the second point should be further along +x than the last.
    const points = searchPattern({ x: 0, z: 0 }, Math.PI / 2, 2);
    expect(points[1]!.x).toBeGreaterThan(1.5);
    expect(points.at(-1)!.x).toBeLessThan(0);
  });
});
