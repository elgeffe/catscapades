import type { CatLegRig } from "../models/cat";
import { clamp } from "../core/math";

/**
 * Two-bone IK for a digitigrade limb.
 *
 * The solver targets the *ankle*, not the toes, and then orients the metapodial
 * separately. That single choice is what gives the cat a hock and a pastern
 * instead of a human ankle, and it is shared between the rig's rest pose and
 * the runtime animator so the two can never drift apart.
 */

/** Metapodial angle from vertical: hind hocks sit high and far back. */
export const HIND_ANKLE_ANGLE = 0.78;
export const FRONT_ANKLE_ANGLE = 0.16;

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
  const ankleAngle = ankleAngleFor(leg);
  const localZ = contactZ - leg.bodyOffset.z;
  const localY = contactY - leg.bodyOffset.y;

  const ankleY = localY + leg.footLength * Math.cos(ankleAngle);
  const ankleZ = localZ - leg.footLength * Math.sin(ankleAngle);

  const l1 = leg.upperLength;
  const l2 = leg.lowerLength;
  const reach = Math.hypot(ankleY, ankleZ);
  const distance = clamp(reach, Math.abs(l1 - l2) + 0.012, l1 + l2 - 0.006);

  const toTarget = Math.atan2(-ankleZ, -ankleY);
  const cosUpper = clamp((distance * distance + l1 * l1 - l2 * l2) / (2 * distance * l1), -1, 1);
  const cosJoint = clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2), -1, 1);
  const upperAngle = toTarget + leg.bend * Math.acos(cosUpper);
  const jointAngle = -leg.bend * (Math.PI - Math.acos(cosJoint));

  leg.upper.rotation.x = upperAngle;
  leg.lower.rotation.x = jointAngle;
  leg.foot.rotation.x = -ankleAngle - (upperAngle + jointAngle) + curl;

  // Lateral splay is small on a cat; a little keeps the silhouette from reading
  // as a flat cardboard cut-out from the semi-fixed camera angles.
  const splay = (contactX - leg.bodyOffset.x) * 1.6;
  leg.upper.rotation.z = clamp(splay, -0.3, 0.3);
}
