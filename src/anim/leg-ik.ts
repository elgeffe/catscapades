import type { CatLegRig } from "../models/cat";
import { clamp } from "../core/math";

/**
 * Two-bone IK.
 *
 * `solveTwoBone` is the shared trigonometry: given two segment lengths and a
 * target in the sagittal plane, it returns the rotations that reach it. The cat
 * and the homeowner both use it and then part company, because the joint below
 * the two bones is what makes a limb read as one species or another.
 *
 * For the cat, the solver targets the *ankle*, not the toes, and then orients
 * the metapodial separately. That single choice is what gives the cat a hock
 * and a pastern instead of a human ankle, and it is shared between the rig's
 * rest pose and the runtime animator so the two can never drift apart.
 */

export interface TwoBoneSolution {
  /** Rotation of the upper segment about X, from straight down. */
  readonly upper: number;
  /** Rotation of the lower segment about X, relative to the upper. */
  readonly lower: number;
}

/**
 * Reaches `(targetY, targetZ)` — measured from the limb root, in the limb
 * root's own space — with two segments of length `l1` and `l2`.
 *
 * `bend` is `+1` to bend the middle joint backwards (a front-leg elbow) and
 * `-1` forwards (a stifle, or a human knee). The reach is clamped rather than
 * throwing: an over-long target quietly straightens the limb, which is a
 * stiff-looking pose but never a broken one.
 */
export function solveTwoBone(
  l1: number,
  l2: number,
  targetY: number,
  targetZ: number,
  bend: number,
): TwoBoneSolution {
  const reach = Math.hypot(targetY, targetZ);
  const distance = clamp(reach, Math.abs(l1 - l2) + 0.012, l1 + l2 - 0.006);
  const toTarget = Math.atan2(-targetZ, -targetY);
  const cosUpper = clamp((distance * distance + l1 * l1 - l2 * l2) / (2 * distance * l1), -1, 1);
  const cosJoint = clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2), -1, 1);
  return {
    upper: toTarget + bend * Math.acos(cosUpper),
    lower: -bend * (Math.PI - Math.acos(cosJoint)),
  };
}

/** Metapodial angle from vertical: hind hocks sit high and far back. */
export const HIND_ANKLE_ANGLE = 0.64;
export const FRONT_ANKLE_ANGLE = 0.14;

export function ankleAngleFor(leg: CatLegRig): number {
  return leg.isFront ? FRONT_ANKLE_ANGLE : HIND_ANKLE_ANGLE;
}

/**
 * Places `leg`'s paw at `contact`, expressed in body space.
 *
 * @param curl extra paw pitch, used to tuck the toes through a swing phase.
 */
export function solveLeg(
  leg: CatLegRig,
  contactX: number,
  contactY: number,
  contactZ: number,
  curl = 0,
): void {
  const localZ = contactZ - leg.bodyOffset.z;
  const localY = contactY - leg.bodyOffset.y;
  const localX = contactX - leg.bodyOffset.x;
  solveLegLocal(leg, localX, localY, localZ, curl);
}

/**
 * Solves a contact already expressed in the leg-root's local space.
 *
 * Runtime animation uses this path after accounting for the articulated
 * pelvis/chest transforms. The build-time neutral pose can keep using the
 * simpler body-space wrapper above.
 */
export function solveLegLocal(
  leg: CatLegRig,
  localX: number,
  localY: number,
  localZ: number,
  curl = 0,
): void {
  const ankleAngle = ankleAngleFor(leg);

  const ankleY = localY + leg.footLength * Math.cos(ankleAngle);
  const ankleZ = localZ - leg.footLength * Math.sin(ankleAngle);

  const { upper: upperAngle, lower: jointAngle } = solveTwoBone(
    leg.upperLength, leg.lowerLength, ankleY, ankleZ, leg.bend,
  );

  leg.upper.rotation.x = upperAngle;
  leg.lower.rotation.x = jointAngle;
  leg.foot.rotation.x = -ankleAngle - (upperAngle + jointAngle) + curl;
  // `foot` is the sloping metapodial, not the terminal paw. Counter-rotate
  // its child so the sole is genuinely planted during stance and curls only
  // while the limb is in swing.
  leg.paw.rotation.x = ankleAngle - curl;

  // Lateral splay is small on a cat; a little keeps the silhouette from reading
  // as a flat cardboard cut-out from the semi-fixed camera angles.
  const splay = localX * 1.6;
  leg.upper.rotation.z = clamp(splay, -0.3, 0.3);
}
