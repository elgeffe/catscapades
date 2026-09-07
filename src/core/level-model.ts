export type Area = "garden" | "kitchen" | "counter" | "dining" | "utility" | "box";
export type ItemId = "key" | "sock" | "sponge" | "snack" | "toy";
export type PreparationId = "sink" | "flour" | "cupboard";

export const OBJECTIVE_DEFINITIONS = [
  { id: "enter", text: "Get inside" },
  { id: "distract", text: "Create a distraction" },
  { id: "key", text: "Climb the worktop to the shelf and steal the key" },
  { id: "prepare", text: "Prepare two disasters (0/2)" },
  { id: "catastrophe", text: "Trigger the breakfast catastrophe" },
  { id: "innocent", text: "Return to the box and pretend to sleep" },
] as const;

export const OPTIONAL_OBJECTIVE_DEFINITIONS = [
  { id: "sock-sink", text: "Secret: drop the sock in the running sink" },
  { id: "fruit", text: "Secret: sit in the fruit bowl" },
  { id: "key-box", text: "Secret: bring the key out to your box" },
  { id: "uncaught", text: "Secret: finish without being caught" },
] as const;

export type LevelCommand =
  | { type: "move"; to: Area }
  | { type: "meow" }
  | { type: "jump"; to: Area }
  | { type: "take"; item: ItemId }
  | { type: "drop"; into?: "sink" }
  | { type: "prepare"; target: PreparationId }
  | { type: "break"; target: "mug" }
  | { type: "sleep" };

export interface LevelEvent {
  type: "area-changed" | "stimulus" | "item-taken" | "item-dropped" | "prepared" | "prop-broken" | "objective-completed" | "catastrophe" | "level-completed" | "rejected";
  message: string;
}

export interface LevelSnapshot {
  area: Area;
  distracted: boolean;
  carrying: ItemId | null;
  preparations: ReadonlySet<PreparationId>;
  mugBroken: boolean;
  objectives: ReadonlySet<string>;
  complete: boolean;
}

export const ITEM_AREAS: Readonly<Record<ItemId, Area>> = {
  key: "counter", sock: "utility", sponge: "kitchen", snack: "dining", toy: "garden",
};

const CONNECTIONS: Readonly<Record<Area, readonly Area[]>> = {
  garden: ["box", "kitchen"], box: ["garden"], kitchen: ["garden", "counter", "dining", "utility"],
  counter: ["kitchen"], dining: ["kitchen"], utility: ["kitchen"],
};

export class LevelModel {
  private area: Area = "box";
  private distracted = false;
  private carrying: ItemId | null = null;
  private readonly movedItems = new Map<ItemId, Area>();
  private readonly preparations = new Set<PreparationId>();
  private mugBroken = false;
  private readonly objectives = new Set<string>();
  private complete = false;

  snapshot(): LevelSnapshot {
    return { area: this.area, distracted: this.distracted, carrying: this.carrying,
      preparations: new Set(this.preparations), mugBroken: this.mugBroken,
      objectives: new Set(this.objectives), complete: this.complete };
  }

  availableCommands(): LevelCommand[] {
    if (this.complete) return [];
    const commands: LevelCommand[] = [{ type: "meow" }];
    for (const to of CONNECTIONS[this.area]) {
      if (to === "counter") commands.push({ type: "jump", to });
      else commands.push({ type: "move", to });
    }
    if (this.carrying) {
      commands.push({ type: "drop" });
      if (this.carrying === "sock" && this.area === "kitchen" && this.preparations.has("sink")) {
        commands.push({ type: "drop", into: "sink" });
      }
    }
    else for (const item of Object.keys(ITEM_AREAS) as ItemId[]) {
      if ((this.movedItems.get(item) ?? ITEM_AREAS[item]) === this.area) commands.push({ type: "take", item });
    }
    if (this.area === "kitchen") {
      for (const target of ["sink", "flour", "cupboard"] as const) if (!this.preparations.has(target)) commands.push({ type: "prepare", target });
    }
    if (this.area === "dining" && !this.mugBroken) commands.push({ type: "break", target: "mug" });
    if (this.area === "box" && this.objectives.has("catastrophe")) commands.push({ type: "sleep" });
    return commands;
  }

  dispatch(command: LevelCommand): LevelEvent[] {
    if (!this.availableCommands().some((candidate) => JSON.stringify(candidate) === JSON.stringify(command))) {
      return [{ type: "rejected", message: `Cannot ${describe(command)} from ${this.area}.` }];
    }
    if (command.type === "meow") {
      this.distracted = true; this.objectives.add("distract");
      return this.completed("distract", "The homeowner investigates the meow.", "stimulus");
    }
    if (command.type === "move" || command.type === "jump") {
      this.area = command.to;
      const events: LevelEvent[] = [{ type: "area-changed", message: `${command.type === "jump" ? "Jumped" : "Moved"} to ${command.to}.` }];
      if (command.to === "kitchen" && !this.objectives.has("enter")) { this.objectives.add("enter"); events.push({ type: "objective-completed", message: "Get inside completed." }); }
      return events;
    }
    if (command.type === "take") {
      this.carrying = command.item;
      const events: LevelEvent[] = [{ type: "item-taken", message: `Picked up ${command.item}.` }];
      if (command.item === "key") { this.objectives.add("key"); events.push({ type: "objective-completed", message: "Steal the key completed." }); }
      return events;
    }
    if (command.type === "drop") {
      const item = this.carrying!; this.movedItems.set(item, this.area); this.carrying = null;
      const events: LevelEvent[] = [{
        type: "item-dropped",
        message: command.into === "sink" ? `Dropped ${item} in the running sink.` : `Dropped ${item} in ${this.area}.`,
      }];
      if (command.into === "sink") {
        this.objectives.add("sock-sink");
        events.push({ type: "objective-completed", message: "Drop the sock in the running sink completed." });
      }
      return events;
    }
    if (command.type === "prepare") {
      this.preparations.add(command.target);
      const events: LevelEvent[] = [{ type: "prepared", message: `Prepared ${command.target} (${this.preparations.size}/2 needed).` }];
      if (this.preparations.size >= 2 && !this.objectives.has("prepare")) { this.objectives.add("prepare"); events.push({ type: "objective-completed", message: "Prepare the disaster completed." }); }
      events.push(...this.resolveCatastrophe());
      return events;
    }
    if (command.type === "break") {
      this.mugBroken = true;
      return [
        { type: "prop-broken", message: "The red mug smashed on the breakfast-room floor." },
        ...this.resolveCatastrophe(),
      ];
    }
    this.complete = true; this.objectives.add("innocent");
    return [{ type: "objective-completed", message: "Act innocent completed." }, { type: "level-completed", message: "Catscapades complete." }];
  }

  private resolveCatastrophe(): LevelEvent[] {
    if (this.objectives.has("catastrophe")
      || !isCatastropheReady(this.mugBroken, this.preparations.size)) return [];
    this.objectives.add("catastrophe");
    return [
      { type: "catastrophe", message: "Water, flour, and crockery combine into a breakfast catastrophe." },
      { type: "objective-completed", message: "Trigger the catastrophe completed." },
    ];
  }

  private completed(id: string, message: string, type: LevelEvent["type"]): LevelEvent[] {
    const first = !this.objectives.has(id); this.objectives.add(id);
    return [{ type, message }, ...(first ? [{ type: "objective-completed" as const, message: `${id} completed.` }] : [])];
  }
}

function describe(command: LevelCommand): string {
  if ("to" in command) return `${command.type} to ${command.to}`;
  if ("item" in command) return `take ${command.item}`;
  if (command.type === "prepare") return `prepare ${command.target}`;
  if (command.type === "break") return `break ${command.target}`;
  if (command.type === "drop" && command.into) return `drop into ${command.into}`;
  return command.type;
}

export function isCatastropheReady(mugBroken: boolean, preparationCount: number): boolean {
  return mugBroken && preparationCount >= 2;
}

export interface PlaytestReport {
  passed: boolean;
  decisions: number;
  meaningfulEventTypes: number;
  maximumChoices: number;
  notes: readonly string[];
}

export function runCriticalPath(): { events: LevelEvent[]; snapshot: LevelSnapshot; decisions: number; report: PlaytestReport } {
  const model = new LevelModel();
  const commands: LevelCommand[] = [
    { type: "move", to: "garden" }, { type: "meow" }, { type: "move", to: "kitchen" },
    { type: "jump", to: "counter" }, { type: "take", item: "key" }, { type: "move", to: "kitchen" },
    { type: "drop" }, { type: "prepare", target: "sink" }, { type: "prepare", target: "flour" },
    { type: "move", to: "dining" }, { type: "break", target: "mug" }, { type: "move", to: "kitchen" },
    { type: "move", to: "garden" }, { type: "move", to: "box" }, { type: "sleep" },
  ];
  const events: LevelEvent[] = [];
  let maximumChoices = 0;
  for (const command of commands) {
    maximumChoices = Math.max(maximumChoices, model.availableCommands().length);
    events.push(...model.dispatch(command));
  }
  const snapshot = model.snapshot();
  const meaningfulEventTypes = new Set(events.map((event) => event.type).filter((type) => type !== "area-changed")).size;
  const passed = snapshot.complete && !events.some((event) => event.type === "rejected");
  return { events, snapshot, decisions: commands.length, report: {
    passed, decisions: commands.length, meaningfulEventTypes, maximumChoices,
    notes: [
      "The key has a readable jump-before-grab setup.",
      "Three preparations allow player-selected ordering; only two are required.",
      "The catastrophe resolves when preparation and the breakfast-room mug break are both complete, in either order.",
      "The route alternates observation, traversal, carrying, preparation, payoff, and escape.",
    ],
  } };
}
