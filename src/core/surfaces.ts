/**
 * What the cat is standing on.
 *
 * A footstep that sounds the same on grass, tile and a rug tells the player
 * nothing, and in a game whose whole rule is "do not be heard" that is a
 * wasted channel: tile is loud, a rug is nearly silent, and knowing which is
 * which is a tactic. The classification is derived from the same authored
 * floor and rug rectangles the level is built from, so what the player hears
 * and what they can see agree by construction.
 */

export type SurfaceKind = "grass" | "tile" | "wood" | "rug" | "worktop";

export interface SurfaceRegion {
  readonly kind: SurfaceKind;
  readonly center: readonly [number, number];
  readonly size: readonly [number, number];
  /** Later regions win, so a rug beats the floor under it. */
  readonly priority: number;
  /** Only applies above this height, for surfaces the cat climbs onto. */
  readonly minHeight?: number;
}

/** How loud a footfall is on each surface, and how far it carries. */
export interface SurfaceVoice {
  /** Relative loudness, 0..1. Drives both the sound and the stimulus radius. */
  readonly loudness: number;
  /** Centre frequency of the step's click, in Hz. */
  readonly tone: number;
  /** How much of the step is a soft brush rather than a click, 0..1. */
  readonly softness: number;
}

export const SURFACE_VOICES: Readonly<Record<SurfaceKind, SurfaceVoice>> = {
  // Bare claws on hard tile: the loudest thing a cat can do by accident.
  tile: { loudness: 1, tone: 2600, softness: 0.12 },
  worktop: { loudness: 0.92, tone: 2300, softness: 0.18 },
  wood: { loudness: 0.72, tone: 1500, softness: 0.3 },
  grass: { loudness: 0.34, tone: 700, softness: 0.78 },
  // A rug is the quiet route across a room, and worth knowing about.
  rug: { loudness: 0.16, tone: 480, softness: 0.94 },
};

/**
 * Classifies a point against a set of regions, highest priority first.
 *
 * Returns `fallback` when nothing contains the point — the level's outer
 * surround, which the cat should not be able to reach anyway.
 */
export function surfaceAt(
  regions: readonly SurfaceRegion[],
  x: number,
  z: number,
  y = 0,
  fallback: SurfaceKind = "tile",
): SurfaceKind {
  let best: SurfaceRegion | null = null;
  for (const region of regions) {
    if (region.minHeight !== undefined && y < region.minHeight) continue;
    if (Math.abs(x - region.center[0]) > region.size[0] / 2) continue;
    if (Math.abs(z - region.center[1]) > region.size[1] / 2) continue;
    if (!best || region.priority > best.priority) best = region;
  }
  return best?.kind ?? fallback;
}
