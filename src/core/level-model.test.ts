import { describe, expect, it } from "vitest";
import { LevelModel, runCriticalPath, type LevelCommand } from "./level-model";

describe("programmatic Catscapades playthrough", () => {
  it("completes the authored critical path without rejected actions", () => {
    const result = runCriticalPath();
    expect(result.events.some((event) => event.type === "rejected")).toBe(false);
    expect(result.snapshot.complete).toBe(true);
    expect(result.snapshot.objectives).toEqual(expect.objectContaining(new Set(["enter", "distract", "key", "prepare", "catastrophe", "innocent"])));
    expect(result.decisions).toBeGreaterThanOrEqual(12);
  });

  it("makes the counter jump an explicit prerequisite for taking the key", () => {
    const model = new LevelModel();
    model.dispatch({ type: "move", to: "garden" }); model.dispatch({ type: "meow" }); model.dispatch({ type: "move", to: "kitchen" });
    expect(model.dispatch({ type: "take", item: "key" })[0]?.type).toBe("rejected");
    expect(model.availableCommands()).toContainEqual({ type: "jump", to: "counter" });
  });

  it("supports preparation in any order and exposes only valid actions", () => {
    const model = new LevelModel();
    const route: LevelCommand[] = [{ type: "move", to: "garden" }, { type: "meow" }, { type: "move", to: "kitchen" },
      { type: "prepare", target: "cupboard" }, { type: "prepare", target: "sink" }];
    route.forEach((command) => model.dispatch(command));
    expect(model.snapshot().objectives.has("prepare")).toBe(true);
    expect(model.availableCommands()).toContainEqual({ type: "trigger" });
  });
});
