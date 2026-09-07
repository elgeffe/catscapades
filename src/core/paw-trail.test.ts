import { describe, expect, it } from "vitest";
import { COATINGS, PawTrail } from "./paw-trail";

describe("paw trail", () => {
  it("leaves nothing when the paws are clean", () => {
    const trail = new PawTrail();
    expect(trail.plant(0, 0, 0, 0)).toBeNull();
    expect(trail.prints()).toHaveLength(0);
    expect(trail.carrying()).toBeNull();
  });

  it("leaves a finite trail that runs out", () => {
    const trail = new PawTrail();
    trail.coat("water");
    let planted = 0;
    for (let step = 0; step < 100; step += 1) {
      if (trail.plant(step * 0.2, 0, 0, 0)) planted += 1;
    }
    // Bounded by the coating, not by the number of steps taken.
    expect(planted).toBeGreaterThan(4);
    expect(planted).toBeLessThan(1 / COATINGS.water.cost + 2);
    expect(trail.carrying()).toBeNull();
  });

  it("does not bank an unbounded trail from standing in a puddle", () => {
    const trail = new PawTrail();
    for (let step = 0; step < 50; step += 1) trail.coat("water");
    expect(trail.carrying()!.amount).toBeLessThanOrEqual(1);
  });

  it("dries a wet trail out but keeps a floury one", () => {
    const water = new PawTrail();
    water.coat("water");
    water.plant(0, 0, 0, 0);
    const flour = new PawTrail();
    flour.coat("flour");
    flour.plant(0, 0, 0, 0);

    water.update(COATINGS.water.lifetime + 0.1);
    flour.update(COATINGS.water.lifetime + 0.1);
    expect(water.prints()).toHaveLength(0);
    // Flour outlasts water by a wide margin, which is what makes puncturing
    // the bag a commitment rather than a temporary inconvenience.
    expect(flour.prints()).toHaveLength(1);
    expect(COATINGS.flour.lifetime).toBeGreaterThan(COATINGS.water.lifetime * 2);
  });

  it("holds full opacity before fading, so a trail reads as a trail", () => {
    const trail = new PawTrail();
    trail.coat("water");
    const print = trail.plant(0, 0, 0, 0)!;
    expect(PawTrail.opacity(print)).toBeCloseTo(print.strength);
    trail.update(COATINGS.water.lifetime * 0.5);
    expect(PawTrail.opacity(print)).toBeCloseTo(print.strength);
    trail.update(COATINGS.water.lifetime * 0.4);
    expect(PawTrail.opacity(print)).toBeLessThan(print.strength * 0.6);
    expect(PawTrail.opacity(print)).toBeGreaterThan(0);
  });

  it("caps the pool so a long walk cannot grow without bound", () => {
    const trail = new PawTrail();
    for (let step = 0; step < 400; step += 1) {
      trail.coat("flour");
      trail.plant(step * 0.1, 0, 0, 0);
    }
    expect(trail.prints().length).toBeLessThanOrEqual(48);
  });

  it("finds the most conspicuous print nearby, not merely the nearest", () => {
    const trail = new PawTrail();
    trail.coat("water");
    const faint = trail.plant(0.2, 0, 0, 0)!;
    // Age the wet print most of the way out, then leave fresh flour further off.
    trail.update(COATINGS.water.lifetime * 0.95);
    trail.coat("flour");
    const obvious = trail.plant(2, 0, 0, 0)!;

    const found = trail.strongestNear(0, 0, 4);
    expect(found).toBe(obvious);
    expect(PawTrail.opacity(faint)).toBeLessThan(PawTrail.opacity(obvious));
    // Nothing in range at all.
    expect(trail.strongestNear(60, 60, 2)).toBeNull();
  });

  it("wipes the paws without erasing the evidence already on the floor", () => {
    const trail = new PawTrail();
    trail.coat("flour");
    trail.plant(0, 0, 0, 0);
    trail.dryPaws();
    expect(trail.carrying()).toBeNull();
    expect(trail.plant(1, 0, 0, 0)).toBeNull();
    expect(trail.prints()).toHaveLength(1);
  });

  it("clears everything on demand", () => {
    const trail = new PawTrail();
    trail.coat("flour");
    trail.plant(0, 0, 0, 0);
    trail.clear();
    expect(trail.prints()).toHaveLength(0);
    expect(trail.carrying()).toBeNull();
  });
});
