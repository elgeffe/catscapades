/**
 * Homeowner sight.
 *
 * Detection used to be a distance check, which made hiding meaningless: the
 * homeowner noticed a cat standing behind them through a wall, and never
 * noticed one three metres away in plain view. This module answers the same
 * question the player is actually asking — "can they see me from there?" —
 * from the three things that decide it:
 *
 *   1. **Where they are looking.** A cone, with range falling off towards its
 *      edge, plus a small radius in which anything is noticed regardless of
 *      facing, because nobody misses a cat by their own ankles.
 *   2. **What is in the way.** Sight is sampled at several points on the cat
 *      and each is traced back to the eye. Standing *on* the worktop is
 *      exposed; standing on the floor *behind* the counter is not.
 *   3. **How hard the cat is trying not to be seen.** Stillness, a crouch, and
 *      a cardboard box all reduce clarity, so sneaking is a real tactic
 *      rather than a slower way to walk.
 *
 * The occlusion test is injected, so the rules are geometry rather than
 * physics and can be reasoned about — and tested — without a collision world.
 */

import { clamp, lerp, shortestAngle, smoothstep } from "./math";

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SightConfig {
  /** Half-angle of the cone in radians. */
  readonly halfAngle: number;
  /** Sight range along the centre line. */
  readonly range: number;
  /** Sight range at the very edge of the cone; peripheral vision is shorter. */
  readonly edgeRange: number
  /** Radius within which the cat is noticed whichever way the owner faces. */
  readonly awarenessRadius: number;
  /** Eye height above the owner's feet. */
  readonly eyeHeight: number;
  /** Distance at which a target is seen at full clarity. */
  readonly clearDistance: number;
}

export const OWNER_SIGHT: SightConfig = {
  // Generous but directional: a little over a 60-degree half-cone, so turning
  // your back is real cover and standing behind someone is a live tactic.
  halfAngle: 1.12,
  range: 11,
  edgeRange: 4.4,
  awarenessRadius: 1.5,
  eyeHeight: 2.02,
  clearDistance: 3.4,
};

export interface SightQuery {
  /** Owner's feet; the eye is derived from `SightConfig.eyeHeight`. */
  readonly from: Point3;
  /** Owner's facing in radians, matching the rig convention (+z forward). */
  readonly facing: number;
  /**
   * Points on the cat to test, most telling first — usually the head, then
   * the shoulder, then the paws. Any one of them being visible is enough.
   */
  readonly targets: readonly Point3[];
  /** How still the cat is holding, 0 moving fast to 1 stopped. */
  readonly stillness: number;
  /** Deliberate concealment: crouching, or curled up in the box. */
  readonly concealment: number;
}

export type SightReason = "seen" | "out-of-range" | "out-of-cone" | "blocked" | "concealed";

export interface SightResult {
  readonly visible: boolean;
  /**
   * 0..1 how plainly the cat is seen. Suspicion climbs with this rather than
   * with a boolean, so being half-glimpsed across a dim room is not the same
   * event as being stared at from a metre away.
   */
  readonly clarity: number;
  /** The sample point that was actually visible, for the owner to look at. */
  readonly at: Point3 | null;
  readonly reason: SightReason;
}

const MISSED = (reason: SightReason): SightResult => (
  { visible: false, clarity: 0, at: null, reason }
);

/** Sight range at a given angle off the centre line. */
export function rangeAtAngle(config: SightConfig, offAxis: number): number {
  const edge = clamp(Math.abs(offAxis) / config.halfAngle, 0, 1);
  // Squared falloff: the useful part of the cone is the middle of it.
  return lerp(config.range, config.edgeRange, edge * edge);
}

/**
 * Decides whether the owner can see the cat, and how plainly.
 *
 * @param clear must return true when nothing blocks the segment between two
 *   world points. It is called at most once per target sample, and only for
 *   samples that already passed the cone and range tests.
 */
export function evaluateSight(
  config: SightConfig,
  query: SightQuery,
  clear: (from: Point3, to: Point3) => boolean,
): SightResult {
  const eye: Point3 = { x: query.from.x, y: query.from.y + config.eyeHeight, z: query.from.z };
  // Concealment is a cap on clarity, not a coin flip: a cat in the box can
  // still be spotted from close range, it just takes a much longer look.
  const hiding = clamp(query.concealment, 0, 1);
  if (hiding >= 0.995) return MISSED("concealed");

  let best: SightResult = MISSED("out-of-range");
  let bestRank = -1;

  for (const target of query.targets) {
    const dx = target.x - query.from.x;
    const dz = target.z - query.from.z;
    const groundDistance = Math.hypot(dx, dz);
    const near = groundDistance <= config.awarenessRadius;

    const offAxis = groundDistance > 1e-4
      ? Math.abs(shortestAngle(query.facing, Math.atan2(dx, dz)))
      : 0;
    if (!near && offAxis > config.halfAngle) {
      if (bestRank < 0) { best = MISSED("out-of-cone"); bestRank = 0; }
      continue;
    }
    if (!near && groundDistance > rangeAtAngle(config, offAxis)) {
      if (bestRank < 1) { best = MISSED("out-of-range"); bestRank = 1; }
      continue;
    }
    if (!clear(eye, target)) {
      if (bestRank < 2) { best = MISSED("blocked"); bestRank = 2; }
      continue;
    }

    // Seen. Clarity falls off with distance and with how far off the centre of
    // vision it is, and is then capped by how hard the cat is hiding.
    const reach = rangeAtAngle(config, offAxis);
    const proximity = 1 - smoothstep(config.clearDistance, reach, groundDistance);
    const centred = 1 - smoothstep(0, config.halfAngle, offAxis) * 0.45;
    const stillness = 1 - clamp(query.stillness, 0, 1) * 0.4;
    const clarity = clamp(proximity * centred * stillness * (1 - hiding), 0, 1);
    if (bestRank < 3 || clarity > best.clarity) {
      best = { visible: true, clarity, at: target, reason: "seen" };
      bestRank = 3;
    }
  }
  return best;
}

export interface SearchPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * Places where the owner will look for a cat that has just vanished, ordered
 * outward from where it was last seen.
 *
 * The point of the ring is that a cat which breaks line of sight and holds
 * still is not safe where it stopped — but a cat that keeps moving away is.
 * Pursuing the last known position is what makes breaking sight worth doing at
 * all, and searching around it is what stops it being a free escape.
 */
export function searchPattern(
  lastSeen: SearchPoint,
  heading: number,
  radius: number,
): readonly SearchPoint[] {
  const points: SearchPoint[] = [{ x: lastSeen.x, z: lastSeen.z }];
  // Look on ahead first — the direction the cat was already going — then
  // sweep to either side, then double back.
  for (const [offset, scale] of [[0, 1], [1.05, 0.85], [-1.05, 0.85], [Math.PI, 0.7]] as const) {
    const angle = heading + offset;
    points.push({
      x: lastSeen.x + Math.sin(angle) * radius * scale,
      z: lastSeen.z + Math.cos(angle) * radius * scale,
    });
  }
  return points;
}
