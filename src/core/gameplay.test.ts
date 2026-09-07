import { describe, expect, it } from "vitest";
import {
  evaluateCondition, resolveInteraction, selectCameraZone, stimulusPriority,
  swipeLaunchSpeed, updateSuspicion,
} from "./gameplay";

describe("gameplay rules", () => {
  it("evaluates nested objective conditions", () => {
    const facts = { flags: new Set(["inside"]), counts: { preparations: 2 } };
    expect(evaluateCondition({ kind: "all", conditions: [{ kind: "flag", key: "inside" }, { kind: "count", key: "preparations", minimum: 2 }] }, facts)).toBe(true);
  });
  it("prefers relevant interaction without allowing disabled candidates", () => {
    const result = resolveInteraction([
      { id: "near", verb: "swipe", distance: 0.4, facing: 1, priority: 1, relevant: false, enabled: true },
      { id: "goal", verb: "grab", distance: 1.2, facing: 0.8, priority: 1, relevant: true, enabled: true },
      { id: "disabled", verb: "grab", distance: 0, facing: 1, priority: 99, relevant: true, enabled: false },
    ]);
    expect(result?.id).toBe("goal");
  });
  it("prioritizes persistent urgent stimuli", () => {
    expect(stimulusPriority({ id: "water", intensity: 2, distance: 8, age: 4, persistent: true, witnessedCat: false }))
      .toBeGreaterThan(stimulusPriority({ id: "meow", intensity: 1, distance: 2, age: 1, persistent: false, witnessedCat: false }));
  });
  it("changes and clamps suspicion", () => {
    expect(updateSuspicion(80, "witnessed")).toBe(100);
    expect(updateSuspicion(4, "innocent")).toBe(0);
  });
  it("uses hysteresis at camera thresholds", () => {
    expect(selectCameraZone("garden", -2.8, 0)).toBe("garden");
    expect(selectCameraZone("kitchen", -2.8, 0)).toBe("kitchen");
    expect(selectCameraZone("dining", 7, 0)).toBe("dining");
    expect(selectCameraZone("kitchen", 5, 4.7)).toBe("kitchen");
    expect(selectCameraZone("kitchen", 5, 5)).toBe("utility");
    expect(selectCameraZone("utility", 5, 4.2)).toBe("utility");
    expect(selectCameraZone("utility", 5, 3.7)).toBe("kitchen");
    expect(selectCameraZone("utility", 8, 6)).toBe("dining");
  });
});

describe("swipe launch", () => {
  it("sends light objects flying and heavy ones grudgingly", () => {
    const mouseToy = swipeLaunchSpeed(0.03);
    const book = swipeLaunchSpeed(0.18);
    const kettle = swipeLaunchSpeed(0.5);
    const fruitBowl = swipeLaunchSpeed(0.65);

    expect(mouseToy).toBeGreaterThan(book);
    expect(book).toBeGreaterThan(kettle);
    expect(kettle).toBeGreaterThan(fruitBowl);
    // The spread has to be obvious, or the resistance is not readable.
    expect(mouseToy / fruitBowl).toBeGreaterThan(2.5);
  });

  it("clamps both ends so nothing leaves the level or refuses to move", () => {
    expect(swipeLaunchSpeed(0.0001)).toBeLessThanOrEqual(6.4);
    expect(swipeLaunchSpeed(50)).toBeGreaterThanOrEqual(1.5);
    expect(swipeLaunchSpeed(0)).toBeLessThanOrEqual(6.4);
    expect(Number.isFinite(swipeLaunchSpeed(0))).toBe(true);
  });

  it("gives crockery enough to clear the table edge and break", () => {
    // The mug must leave the dining table on a swipe, which is the whole
    // catastrophe. It is fragile, so it is struck rather than pushed.
    expect(swipeLaunchSpeed(0.32, true)).toBeGreaterThan(swipeLaunchSpeed(0.32));
    expect(swipeLaunchSpeed(0.32, true)).toBeGreaterThan(2.5);
  });
});
