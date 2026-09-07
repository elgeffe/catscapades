/**
 * Wet and floury pawprints.
 *
 * A cat that walks through the puddle under the overflowing sink, or through
 * the flour it has just punctured, carries it. The trail is the point: it is
 * evidence the player leaves behind by accident, it fades, and the homeowner
 * can see it — so the cheapest route across a room stops being the safest one
 * as soon as the room is wet.
 *
 * This is deliberately rendering-independent. The trail is a gameplay object
 * with a lifetime and a visibility, and the decals that draw it are downstream
 * of that rather than the other way round.
 */

export type PawCoating = "water" | "flour";

export interface PawPrint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly kind: PawCoating;
  /** Facing of the paw that made it, for orienting the decal. */
  readonly facing: number;
  /** Seconds since it was left. */
  age: number;
  /** How much of the coating went into this print, 0..1. */
  readonly strength: number;
}

export interface CoatingProfile {
  /** How long a print stays visible. Water dries; flour does not. */
  readonly lifetime: number;
  /** How much coating a single print uses up. */
  readonly cost: number;
  /** How suspicious a fresh print is to the homeowner, 0..1. */
  readonly conspicuousness: number;
}

export const COATINGS: Readonly<Record<PawCoating, CoatingProfile>> = {
  // Water evaporates, so a wet trail is a problem the player can wait out.
  water: { lifetime: 14, cost: 0.11, conspicuousness: 0.55 },
  // Flour does not, which is what makes puncturing the bag a commitment.
  flour: { lifetime: 46, cost: 0.075, conspicuousness: 1 },
};

/** Beyond this the oldest prints are recycled, so the pool never grows. */
const MAX_PRINTS = 48;

export class PawTrail {
  private readonly items: PawPrint[] = [];
  private coating: PawCoating | null = null;
  private amount = 0;

  /** Prints currently on the floor, oldest first. */
  prints(): readonly PawPrint[] {
    return this.items;
  }

  /** What the paws are currently carrying, if anything. */
  carrying(): { readonly kind: PawCoating; readonly amount: number } | null {
    return this.coating && this.amount > 0.001
      ? { kind: this.coating, amount: this.amount }
      : null;
  }

  /**
   * Steps into something. Topping up resets the amount rather than adding to
   * it, so standing in a puddle does not bank an unbounded trail.
   */
  coat(kind: PawCoating, amount = 1): void {
    this.coating = kind;
    this.amount = Math.max(this.amount, Math.min(1, amount));
  }

  /**
   * Wipes the paws without clearing the prints already on the floor. Used when
   * the cat is carried out: the evidence stays, the cat stops adding to it.
   */
  dryPaws(): void {
    this.coating = null;
    this.amount = 0;
  }

  /**
   * Leaves a print, if there is anything left to leave. Returns the print so
   * the caller can spawn its decal, or null if the paw was clean.
   */
  plant(x: number, y: number, z: number, facing: number): PawPrint | null {
    const kind = this.coating;
    if (!kind || this.amount <= 0.001) return null;
    const profile = COATINGS[kind];
    const print: PawPrint = {
      x, y, z, kind, facing, age: 0, strength: Math.min(1, this.amount),
    };
    this.amount = Math.max(0, this.amount - profile.cost);
    if (this.amount <= 0.001) this.coating = null;
    if (this.items.length >= MAX_PRINTS) this.items.shift();
    this.items.push(print);
    return print;
  }

  /** Ages every print and drops the ones that have faded out. */
  update(dt: number): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const print = this.items[index]!;
      print.age += dt;
      if (print.age >= COATINGS[print.kind].lifetime) this.items.splice(index, 1);
    }
  }

  /** How visible a print is now, 0..1. */
  static opacity(print: PawPrint): number {
    const { lifetime } = COATINGS[print.kind];
    const remaining = 1 - print.age / lifetime;
    // Holds, then fades over the last third: a trail that starts fading
    // immediately never reads as a trail.
    const fade = remaining > 0.34 ? 1 : Math.max(0, remaining / 0.34);
    return print.strength * fade;
  }

  /**
   * The most conspicuous print within `radius` of a point, or null.
   *
   * The homeowner uses this to notice a trail rather than an individual print:
   * one faint wet mark is nothing, a fresh line of flour is not.
   */
  strongestNear(x: number, z: number, radius: number): PawPrint | null {
    let best: PawPrint | null = null;
    let bestScore = 0;
    const radiusSquared = radius * radius;
    for (const print of this.items) {
      const dx = print.x - x;
      const dz = print.z - z;
      if (dx * dx + dz * dz > radiusSquared) continue;
      const score = PawTrail.opacity(print) * COATINGS[print.kind].conspicuousness;
      if (score > bestScore) {
        bestScore = score;
        best = print;
      }
    }
    return best;
  }

  clear(): void {
    this.items.length = 0;
    this.coating = null;
    this.amount = 0;
  }
}
