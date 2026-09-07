import { describe, expect, it } from "vitest";
import { renderMischiefTrack } from "./audio";

describe("mischievous background track", () => {
  it("renders a bounded, audible stereo loop", () => {
    const track = renderMischiefTrack(8_000);
    let peak = 0;
    let audibleSamples = 0;
    let stereoDifferences = 0;

    for (let index = 0; index < track.left.length; index += 1) {
      const left = track.left[index] ?? 0;
      const right = track.right[index] ?? 0;
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
      if (Math.abs(left) + Math.abs(right) > 0.001) audibleSamples += 1;
      if (Math.abs(left - right) > 0.001) stereoDifferences += 1;
    }

    expect(track.duration).toBeCloseTo(32 * 60 / 112);
    expect(track.left).toHaveLength(track.right.length);
    expect(audibleSamples).toBeGreaterThan(20_000);
    expect(stereoDifferences).toBeGreaterThan(10_000);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(0.821);
    expect(track.left[0]).toBe(0);
    expect(track.right.at(-1)).toBe(0);
  });

  it("rejects unusable sample rates", () => {
    expect(() => renderMischiefTrack(4_000)).toThrow(RangeError);
  });
});
