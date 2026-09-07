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

  it("keeps the permanent garden opening usable without skipping room adjacency", () => {
    const model = new LevelModel();
    expect(model.dispatch({ type: "move", to: "kitchen" })[0]?.type).toBe("rejected");

    model.dispatch({ type: "move", to: "garden" });
    const entered = model.dispatch({ type: "move", to: "kitchen" });
    expect(entered.some((event) => event.type === "rejected")).toBe(false);
    expect(model.snapshot().objectives.has("enter")).toBe(true);

    const distracted = model.dispatch({ type: "meow" });
    expect(distracted.some((event) => event.type === "rejected")).toBe(false);
    expect(model.snapshot().distracted).toBe(true);
  });

  it("supports preparation in any order and exposes the mug finale in the breakfast room", () => {
    const model = new LevelModel();
    const route: LevelCommand[] = [{ type: "move", to: "garden" }, { type: "meow" }, { type: "move", to: "kitchen" },
      { type: "prepare", target: "cupboard" }, { type: "prepare", target: "sink" }];
    route.forEach((command) => model.dispatch(command));
    expect(model.snapshot().objectives.has("prepare")).toBe(true);
    expect(model.snapshot().objectives.has("catastrophe")).toBe(false);

    model.dispatch({ type: "move", to: "dining" });
    expect(model.availableCommands()).toContainEqual({ type: "break", target: "mug" });
    const broken = model.dispatch({ type: "break", target: "mug" });
    expect(broken.some((event) => event.type === "catastrophe")).toBe(true);
    expect(model.snapshot().objectives.has("catastrophe")).toBe(true);
  });

  it("remembers an early broken mug and resolves the catastrophe after the second preparation", () => {
    const model = new LevelModel();
    const reachBreakfastRoom: LevelCommand[] = [
      { type: "move", to: "garden" },
      { type: "move", to: "kitchen" },
      { type: "move", to: "dining" },
    ];
    reachBreakfastRoom.forEach((command) => model.dispatch(command));

    const broken = model.dispatch({ type: "break", target: "mug" });
    expect(broken.some((event) => event.type === "rejected")).toBe(false);
    expect(model.snapshot().mugBroken).toBe(true);
    expect(model.snapshot().objectives.has("catastrophe")).toBe(false);
    expect(model.dispatch({ type: "break", target: "mug" })[0]?.type).toBe("rejected");

    model.dispatch({ type: "move", to: "kitchen" });
    model.dispatch({ type: "prepare", target: "sink" });
    expect(model.snapshot().objectives.has("catastrophe")).toBe(false);

    const completed = model.dispatch({ type: "prepare", target: "flour" });
    expect(completed.some((event) => event.type === "catastrophe")).toBe(true);
    expect(model.snapshot().objectives.has("catastrophe")).toBe(true);
  });

  it("only accepts the sock-in-sink drop after the tap is running", () => {
    const model = new LevelModel();
    const collectSock: LevelCommand[] = [
      { type: "move", to: "garden" },
      { type: "move", to: "kitchen" },
      { type: "move", to: "utility" },
      { type: "take", item: "sock" },
      { type: "move", to: "kitchen" },
    ];
    collectSock.forEach((command) => model.dispatch(command));

    expect(model.dispatch({ type: "drop", into: "sink" })[0]?.type).toBe("rejected");
    expect(model.snapshot().carrying).toBe("sock");

    model.dispatch({ type: "prepare", target: "sink" });
    expect(model.availableCommands()).toContainEqual({ type: "drop", into: "sink" });
    const dropped = model.dispatch({ type: "drop", into: "sink" });
    expect(dropped.some((event) => event.type === "rejected")).toBe(false);
    expect(model.snapshot().objectives.has("sock-sink")).toBe(true);
    expect(model.snapshot().carrying).toBeNull();
  });
});
