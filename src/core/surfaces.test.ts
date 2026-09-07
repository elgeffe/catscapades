import { describe, expect, it } from "vitest";
import { SURFACE_VOICES, surfaceAt, type SurfaceRegion } from "./surfaces";
import { FLOORS, PLACEMENTS } from "../level/level-data";

const REGIONS: SurfaceRegion[] = [
  ...FLOORS.map((floor) => ({
    kind: (floor.kind === "flat" ? "tile" : floor.kind) as SurfaceRegion["kind"],
    center: floor.center,
    size: floor.size,
    priority: 0,
  })),
  ...PLACEMENTS.filter((placement) => placement.model === "rug").map((rug) => ({
    kind: "rug" as const,
    center: [rug.position[0], rug.position[2]] as const,
    size: (rug.size ?? [2, 2]) as readonly [number, number],
    priority: 1,
  })),
];

describe("surface classification", () => {
  it("names the real floor of each room", () => {
    expect(surfaceAt(REGIONS, -9.2, 0)).toBe("grass");
    expect(surfaceAt(REGIONS, 5.3, -5)).toBe("tile");
    expect(surfaceAt(REGIONS, 13, 5)).toBe("wood");
  });

  it("lets a rug win over the floor it sits on", () => {
    const rug = PLACEMENTS.find((placement) => placement.id === "kitchen-rug");
    expect(rug).toBeDefined();
    // On the rug, and a step to the side of it.
    expect(surfaceAt(REGIONS, rug!.position[0], rug!.position[2])).toBe("rug");
    expect(surfaceAt(REGIONS, rug!.position[0], rug!.position[2] + 4)).toBe("tile");
  });

  it("only applies a height-gated surface above its height", () => {
    const regions: SurfaceRegion[] = [
      { kind: "tile", center: [0, 0], size: [10, 10], priority: 0 },
      { kind: "worktop", center: [0, 0], size: [10, 10], priority: 2, minHeight: 0.6 },
    ];
    expect(surfaceAt(regions, 0, 0, 0)).toBe("tile");
    expect(surfaceAt(regions, 0, 0, 1.4)).toBe("worktop");
  });

  it("falls back rather than returning nothing outside every region", () => {
    expect(surfaceAt(REGIONS, 900, 900, 0, "grass")).toBe("grass");
  });

  it("makes tile loud and a rug quiet, which is the whole tactic", () => {
    expect(SURFACE_VOICES.tile.loudness).toBeGreaterThan(SURFACE_VOICES.wood.loudness);
    expect(SURFACE_VOICES.wood.loudness).toBeGreaterThan(SURFACE_VOICES.grass.loudness);
    expect(SURFACE_VOICES.grass.loudness).toBeGreaterThan(SURFACE_VOICES.rug.loudness);
    // A big enough gap to be worth routing around, not a rounding difference.
    expect(SURFACE_VOICES.tile.loudness / SURFACE_VOICES.rug.loudness).toBeGreaterThan(4);
    for (const voice of Object.values(SURFACE_VOICES)) {
      expect(voice.loudness).toBeGreaterThan(0);
      expect(voice.loudness).toBeLessThanOrEqual(1);
      expect(voice.softness).toBeGreaterThanOrEqual(0);
      expect(voice.softness).toBeLessThanOrEqual(1);
      expect(voice.tone).toBeGreaterThan(100);
    }
  });
});
