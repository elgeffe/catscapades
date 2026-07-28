/** Shared framerate-independent smoothing and easing helpers. */

export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + shortestAngle(current, target) * (1 - Math.exp(-rate * dt));
}

/** Signed shortest rotation from `current` to `target`, in radians. */
export function shortestAngle(current: number, target: number): number {
  let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation across the shortest arc of a normalised [0,1) phase. */
export function lerpPhase(a: number, b: number, t: number): number {
  let delta = (b - a + 1.5) % 1 - 0.5;
  if (delta < -0.5) delta += 1;
  return (a + delta * t + 1) % 1;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function deadZoneOffset(value: number, deadZone: number): number {
  if (Math.abs(value) <= deadZone) return 0;
  return Math.sign(value) * (Math.abs(value) - deadZone);
}

/**
 * Cheap deterministic value noise. Used for idle micro-motion (ear flicks, tail
 * drift, weight shifts) so animation never repeats on an obvious beat.
 */
export function wobble(time: number, seed: number): number {
  return (
    Math.sin(time * 1.13 + seed * 12.9898) * 0.5
    + Math.sin(time * 0.47 + seed * 78.233) * 0.32
    + Math.sin(time * 2.71 + seed * 37.719) * 0.18
  );
}

/** Critically-damped spring step towards a target. Returns the new value. */
export function spring(
  current: number,
  velocity: { value: number },
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): number {
  const acceleration = (target - current) * stiffness - velocity.value * damping;
  velocity.value += acceleration * dt;
  return current + velocity.value * dt;
}
