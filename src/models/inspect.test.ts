import { describe, expect, it } from "vitest";
import { inspectAll, inspectClip, inspectModel } from "./inspect";
import { MODEL_REGISTRY } from "./registry";

/**
 * Model-integrity regressions.
 *
 * The model viewer exists so these failures are catchable; this locks the most
 * expensive ones in so they cannot come back silently.
 */
describe("model registry", () => {
  it("has unique ids and a description for every entry", () => {
    const ids = MODEL_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of MODEL_REGISTRY) {
      expect(entry.description.length, entry.id).toBeGreaterThan(10);
    }
  });

  it("builds every model without warnings", () => {
    const offenders = inspectAll()
      .filter((report) => report.warnings.length > 0)
      .map((report) => `${report.id}: ${report.warnings.join("; ")}`);
    expect(offenders).toEqual([]);
  });

  it("returns an independent instance on every build", () => {
    const entry = MODEL_REGISTRY.find((candidate) => candidate.id === "cat");
    expect(entry).toBeDefined();
    const first = entry!.instantiate().object;
    const second = entry!.instantiate().object;
    expect(first).not.toBe(second);
  });
});

describe("cat rig", () => {
  const report = inspectModel("cat");

  it("stands on its own origin", () => {
    expect(Math.abs(report.groundOffset)).toBeLessThanOrEqual(0.03);
  });

  it("is sized for the authored house", () => {
    const [width, height, depth] = report.bounds.size;
    expect(width).toBeGreaterThan(0.25);
    expect(width).toBeLessThan(0.55);
    // Ears set the top of the box; shoulder height is well under this.
    expect(height).toBeGreaterThan(0.45);
    expect(height).toBeLessThan(0.8);
    expect(depth).toBeGreaterThan(0.9);
    expect(depth).toBeLessThan(1.6);
  });

  it("exposes the joints other systems drive by name", () => {
    const names = new Set(report.namedNodes.map((node) => node.name));
    for (const required of [
      "cat-body", "pelvis", "spine-lower", "spine-upper", "chest", "neck", "head", "jaw",
      "mouth-anchor", "tail-base", "ear-left", "ear-right", "eyelid-left", "eyelid-right",
      "hind-left-upper", "hind-left-lower", "hind-left-foot",
      "front-right-upper", "front-right-lower", "front-right-foot",
    ]) {
      expect(names.has(required), `missing joint "${required}"`).toBe(true);
    }
  });

  it("drives joints in every clip without popping", () => {
    for (const clip of report.clips) {
      const analysis = inspectClip("cat", clip, 1.5);
      expect(analysis.movingJoints, `clip "${clip}" animated nothing`).toBeGreaterThan(0);
      expect(analysis.warnings, `clip "${clip}"`).toEqual([]);
    }
  });

  it("moves the legs during locomotion but not while asleep", () => {
    const trot = inspectClip("cat", "trot", 1.5);
    expect(trot.staticJoints).not.toContain("hind-left-lower");
    expect(trot.staticJoints).not.toContain("front-right-lower");
  });
});

describe("homeowner rig", () => {
  it("stands on the floor with its feet, not its shins", () => {
    const report = inspectModel("homeowner");
    expect(Math.abs(report.groundOffset)).toBeLessThanOrEqual(0.03);
    expect(report.bounds.size[1]).toBeGreaterThan(2.2);
  });
});
