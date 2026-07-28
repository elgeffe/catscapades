import * as THREE from "three";
import { PALETTE, surface } from "./materials";
import { solveLeg } from "../anim/leg-ik";

/**
 * Anatomically-ordered cat rig.
 *
 * The mesh hierarchy is deliberately a real skeleton rather than a bag of
 * spheres: `CatAnimator` drives joints, not meshes, so gait, spine flex, tail
 * physics, and head stabilisation compose instead of fighting each other.
 *
 * Units: 1 world unit is ~0.67 m, matching the authored house. The cat is
 * ~0.38 units at the shoulder and ~1.15 units nose to tail tip.
 */

/** A single limb solved with two-bone IK plus a metapodial (paw) segment. */
export interface CatLegRig {
  readonly id: CatLegId;
  /** Attachment joint, positioned in body space. */
  readonly root: THREE.Object3D;
  /** Femur / humerus. Rotates about X at the root. */
  readonly upper: THREE.Object3D;
  /** Tibia / radius. Child pivot at the end of `upper`. */
  readonly lower: THREE.Object3D;
  /** Metatarsus / pastern. Child pivot at the end of `lower`. */
  readonly foot: THREE.Object3D;
  readonly upperLength: number;
  readonly lowerLength: number;
  readonly footLength: number;
  /** +1 bends the middle joint backwards (elbow), -1 forwards (stifle). */
  readonly bend: 1 | -1;
  /** Neutral ground contact point in body space. */
  readonly restTarget: THREE.Vector3;
  /** The leg root's position in body space, independent of spine parenting. */
  readonly bodyOffset: THREE.Vector3;
  /** Gait phase offset in [0,1). */
  readonly phaseOffset: number;
  readonly isFront: boolean;
  readonly side: -1 | 1;
}

export type CatLegId = "front-left" | "front-right" | "hind-left" | "hind-right";

export interface CatRig {
  /** Added to the scene. Owns world position and facing. */
  readonly root: THREE.Group;
  /** Whole-body offset: ride height, squash, lean, landing absorb. */
  readonly body: THREE.Group;
  readonly pelvis: THREE.Group;
  readonly spineLower: THREE.Group;
  readonly spineUpper: THREE.Group;
  readonly chest: THREE.Group;
  readonly neck: THREE.Group;
  readonly head: THREE.Group;
  readonly jaw: THREE.Group;
  readonly earLeft: THREE.Group;
  readonly earRight: THREE.Group;
  readonly eyeLeft: THREE.Mesh;
  readonly eyeRight: THREE.Mesh;
  readonly eyelidLeft: THREE.Mesh;
  readonly eyelidRight: THREE.Mesh;
  readonly ribcage: THREE.Mesh;
  readonly tailBase: THREE.Group;
  /** Tail joints, root first. Driven by a verlet chain. */
  readonly tailJoints: readonly THREE.Group[];
  readonly tailSegmentLength: number;
  readonly legs: readonly CatLegRig[];
  /** Carry socket, in front of the jaw. */
  readonly mouthAnchor: THREE.Object3D;
  /** Neutral height of `body` above the ground, in world units. */
  readonly standHeight: number;
  readonly collisionRadius: number;
}

const FUR_ROUGHNESS = 0.95;

interface LegSpec {
  id: CatLegId;
  root: readonly [number, number, number];
  upperLength: number;
  lowerLength: number;
  footLength: number;
  bend: 1 | -1;
  phaseOffset: number;
  isFront: boolean;
  side: -1 | 1;
  restZ: number;
}

/**
 * Lateral-sequence walk offsets (hind-left, front-left, hind-right,
 * front-right). `CatAnimator` re-times these per gait; these are the defaults.
 */
const LEG_SPECS: readonly LegSpec[] = [
  {
    id: "hind-left", root: [-0.108, 0.035, -0.25], upperLength: 0.152, lowerLength: 0.152, footLength: 0.115,
    bend: -1, phaseOffset: 0, isFront: false, side: -1, restZ: -0.32,
  },
  {
    id: "front-left", root: [-0.1, 0.02, 0.245], upperLength: 0.14, lowerLength: 0.135, footLength: 0.09,
    bend: 1, phaseOffset: 0.25, isFront: true, side: -1, restZ: 0.25,
  },
  {
    id: "hind-right", root: [0.108, 0.035, -0.25], upperLength: 0.152, lowerLength: 0.152, footLength: 0.115,
    bend: -1, phaseOffset: 0.5, isFront: false, side: 1, restZ: -0.32,
  },
  {
    id: "front-right", root: [0.1, 0.02, 0.245], upperLength: 0.14, lowerLength: 0.135, footLength: 0.09,
    bend: 1, phaseOffset: 0.75, isFront: true, side: 1, restZ: 0.25,
  },
];

const TAIL_SEGMENTS = 9;
const TAIL_SEGMENT_LENGTH = 0.066;
const STAND_HEIGHT = 0.315;

export interface CatAppearance {
  fur?: number;
  furShade?: number;
  belly?: number;
  eye?: number;
}

export function buildCat(appearance: CatAppearance = {}): CatRig {
  const furColor = appearance.fur ?? PALETTE.furWarm;
  const shadeColor = appearance.furShade ?? PALETTE.furDark;
  const bellyColor = appearance.belly ?? PALETTE.furCream;
  const eyeColor = appearance.eye ?? PALETTE.eye;

  const fur = surface(furColor, { roughness: FUR_ROUGHNESS });
  const furShade = surface(shadeColor, { roughness: FUR_ROUGHNESS });
  const belly = surface(bellyColor, { roughness: FUR_ROUGHNESS });
  const nose = surface(PALETTE.nose, { roughness: 0.6 });
  const iris = surface(eyeColor, { roughness: 0.22, emissive: eyeColor, emissiveIntensity: 0.16 });
  const pupil = surface(0x14120f, { roughness: 0.2 });
  const whisker = surface(0xe9e2d2, { roughness: 0.5 });

  const root = new THREE.Group();
  root.name = "cat";

  const body = new THREE.Group();
  body.name = "cat-body";
  body.position.y = STAND_HEIGHT;
  root.add(body);

  // ---- Spine chain: pelvis at the rear, chest at the front ------------------
  const pelvis = new THREE.Group();
  pelvis.name = "pelvis";
  pelvis.position.set(0, 0, -0.235);
  body.add(pelvis);

  const hip = new THREE.Mesh(new THREE.SphereGeometry(0.142, 12, 8), fur);
  hip.scale.set(1.0, 0.98, 1.02);
  hip.castShadow = true;
  pelvis.add(hip);

  const spineLower = new THREE.Group();
  spineLower.name = "spine-lower";
  spineLower.position.set(0, 0.006, 0.155);
  pelvis.add(spineLower);

  const waist = new THREE.Mesh(new THREE.CapsuleGeometry(0.128, 0.17, 4, 12), fur);
  waist.rotation.x = Math.PI / 2;
  waist.position.set(0, 0.004, 0.055);
  waist.castShadow = true;
  spineLower.add(waist);

  const loin = new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 10), fur);
  loin.scale.set(1.0, 0.98, 1.18);
  loin.position.set(0, 0.004, 0.11);
  spineLower.add(loin);

  const spineUpper = new THREE.Group();
  spineUpper.name = "spine-upper";
  spineUpper.position.set(0, 0.004, 0.155);
  spineLower.add(spineUpper);

  const chest = new THREE.Group();
  chest.name = "chest";
  chest.position.set(0, 0.01, 0.135);
  spineUpper.add(chest);

  const ribcage = new THREE.Mesh(new THREE.SphereGeometry(0.148, 14, 10), fur);
  ribcage.name = "ribcage";
  ribcage.scale.set(0.99, 1.0, 1.34);
  ribcage.position.z = -0.01;
  ribcage.castShadow = true;
  chest.add(ribcage);

  const shoulderBlade = new THREE.Mesh(new THREE.SphereGeometry(0.098, 10, 8), fur);
  shoulderBlade.scale.set(0.62, 0.92, 1.05);
  for (const side of [-1, 1] as const) {
    const blade = shoulderBlade.clone();
    blade.position.set(side * 0.072, 0.028, 0.055);
    chest.add(blade);
  }

  // Scruff: bridges chest to neck so the silhouette has no seam at the shoulders.
  const scruff = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 10), fur);
  scruff.scale.set(0.94, 0.86, 0.9);
  scruff.position.set(0, 0.052, 0.108);
  chest.add(scruff);

  const bib = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), belly);
  bib.scale.set(0.82, 0.86, 0.62);
  bib.position.set(0, -0.05, 0.11);
  chest.add(bib);

  const underbelly = new THREE.Mesh(new THREE.CapsuleGeometry(0.086, 0.3, 4, 10), belly);
  underbelly.rotation.x = Math.PI / 2;
  underbelly.position.set(0, -0.072, -0.06);
  chest.add(underbelly);

  // ---- Neck and head -------------------------------------------------------
  const neck = new THREE.Group();
  neck.name = "neck";
  neck.position.set(0, 0.072, 0.108);
  chest.add(neck);

  const neckMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.07, 4, 10), fur);
  neckMesh.rotation.x = Math.PI / 2.6;
  neckMesh.position.set(0, 0.03, 0.052);
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.082, 0.104);
  neck.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.104, 16, 12), fur);
  skull.scale.set(1.04, 0.96, 1.0);
  skull.castShadow = true;
  head.add(skull);

  const cheeks = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), fur);
  cheeks.scale.set(1.16, 0.72, 0.78);
  cheeks.position.set(0, -0.032, 0.05);
  head.add(cheeks);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), belly);
  muzzle.scale.set(1.16, 0.8, 0.92);
  muzzle.position.set(0, -0.036, 0.086);
  head.add(muzzle);

  const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), nose);
  noseMesh.scale.set(1.25, 0.85, 0.8);
  noseMesh.position.set(0, -0.014, 0.128);
  head.add(noseMesh);

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.044, 0.032);
  head.add(jaw);

  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 6), belly);
  jawMesh.scale.set(1.05, 0.5, 1.15);
  jawMesh.position.set(0, -0.008, 0.046);
  jaw.add(jawMesh);

  const ears: THREE.Group[] = [];
  const eyes: THREE.Mesh[] = [];
  const eyelids: THREE.Mesh[] = [];
  const earShell = new THREE.ConeGeometry(0.052, 0.098, 5);
  const earInner = new THREE.ConeGeometry(0.032, 0.066, 5);

  for (const side of [-1, 1] as const) {
    const ear = new THREE.Group();
    ear.name = side < 0 ? "ear-left" : "ear-right";
    ear.position.set(side * 0.064, 0.072, 0.012);
    ear.rotation.z = side * -0.2;
    ear.rotation.x = -0.12;
    head.add(ear);

    const shell = new THREE.Mesh(earShell, fur);
    shell.position.y = 0.049;
    shell.scale.set(1, 1, 0.62);
    shell.castShadow = true;
    ear.add(shell);

    const inner = new THREE.Mesh(earInner, nose);
    inner.position.set(0, 0.043, 0.016);
    inner.scale.set(1, 1, 0.5);
    ear.add(inner);

    ears.push(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), iris);
    eye.name = side < 0 ? "eye-left" : "eye-right";
    eye.scale.set(1, 1, 0.66);
    eye.position.set(side * 0.048, 0.006, 0.086);
    head.add(eye);
    eyes.push(eye);

    const slit = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 6, 5), pupil);
    slit.scale.set(0.4, 1.24, 0.5);
    slit.position.set(side * 0.048, 0.006, 0.104);
    head.add(slit);

    // Eyelid: a fur-coloured cap scaled down to zero except while blinking.
    const eyelid = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), furShade);
    eyelid.name = side < 0 ? "eyelid-left" : "eyelid-right";
    eyelid.position.set(side * 0.048, 0.008, 0.085);
    eyelid.scale.set(1, 0.02, 0.7);
    head.add(eyelid);
    eyelids.push(eyelid);

    for (let index = 0; index < 3; index += 1) {
      const hairMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0009, 0.115, 3), whisker);
      hairMesh.position.set(side * 0.042, -0.018 + index * 0.011, 0.104);
      hairMesh.rotation.z = side * (Math.PI / 2 - 0.28 - index * 0.12);
      hairMesh.rotation.x = -0.22 + index * 0.14;
      head.add(hairMesh);
    }
  }

  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.name = "mouth-anchor";
  mouthAnchor.position.set(0, -0.02, 0.15);
  jaw.add(mouthAnchor);

  // ---- Tail ----------------------------------------------------------------
  const tailBase = new THREE.Group();
  tailBase.name = "tail-base";
  tailBase.position.set(0, 0.108, -0.145);
  pelvis.add(tailBase);

  const tailJoints: THREE.Group[] = [];
  let tailParent: THREE.Group = tailBase;
  for (let index = 0; index < TAIL_SEGMENTS; index += 1) {
    const joint = new THREE.Group();
    joint.name = `tail-${index}`;
    joint.position.set(0, 0, index === 0 ? 0 : -TAIL_SEGMENT_LENGTH);
    tailParent.add(joint);

    const taper = 1 - index / (TAIL_SEGMENTS + 2.5);
    const segment = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.026 * taper, TAIL_SEGMENT_LENGTH * 0.95, 3, 6),
      index >= TAIL_SEGMENTS - 3 ? furShade : fur,
    );
    segment.rotation.x = Math.PI / 2;
    segment.position.z = -TAIL_SEGMENT_LENGTH / 2;
    segment.castShadow = true;
    joint.add(segment);

    tailJoints.push(joint);
    tailParent = joint;
  }

  // ---- Legs ----------------------------------------------------------------
  // Leg roots are authored in body space, but shoulders parent to `chest` and
  // hips to `pelvis` so the spine carries them. Subtract the accumulated joint
  // offset so the authored body-space position is preserved.
  const chestOffset = new THREE.Vector3()
    .add(pelvis.position).add(spineLower.position).add(spineUpper.position).add(chest.position);
  const pelvisOffset = pelvis.position.clone();

  const legs: CatLegRig[] = LEG_SPECS.map((spec) => {
    const legRoot = new THREE.Group();
    legRoot.name = `${spec.id}-root`;
    const parentOffset = spec.isFront ? chestOffset : pelvisOffset;
    legRoot.position.set(
      spec.root[0] - parentOffset.x,
      spec.root[1] - parentOffset.y,
      spec.root[2] - parentOffset.z,
    );
    (spec.isFront ? chest : pelvis).add(legRoot);

    const upper = new THREE.Group();
    upper.name = `${spec.id}-upper`;
    legRoot.add(upper);
    upper.add(limbMesh(spec.upperLength, spec.isFront ? 0.068 : 0.078, spec.isFront ? 0.05 : 0.052, fur));
    upper.add(jointCap(spec.isFront ? 0.066 : 0.076, fur, 0));

    const lower = new THREE.Group();
    lower.name = `${spec.id}-lower`;
    lower.position.y = -spec.upperLength;
    upper.add(lower);
    lower.add(limbMesh(spec.lowerLength, spec.isFront ? 0.046 : 0.05, 0.032, fur));
    lower.add(jointCap(spec.isFront ? 0.048 : 0.052, fur, 0));

    const foot = new THREE.Group();
    foot.name = `${spec.id}-foot`;
    foot.position.y = -spec.lowerLength;
    lower.add(foot);
    foot.add(limbMesh(spec.footLength, 0.032, 0.03, fur));
    foot.add(jointCap(0.034, fur, 0));

    const toes = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), furShade);
    toes.scale.set(0.92, 0.58, 1.2);
    toes.position.set(0, -spec.footLength + 0.014, 0.019);
    toes.castShadow = true;
    foot.add(toes);

    return {
      id: spec.id,
      root: legRoot,
      upper,
      lower,
      foot,
      upperLength: spec.upperLength,
      lowerLength: spec.lowerLength,
      footLength: spec.footLength,
      bend: spec.bend,
      restTarget: new THREE.Vector3(spec.root[0] * 1.02, -STAND_HEIGHT, spec.restZ),
      bodyOffset: new THREE.Vector3(spec.root[0], spec.root[1], spec.root[2]),
      phaseOffset: spec.phaseOffset,
      isFront: spec.isFront,
      side: spec.side,
    };
  });

  // Solve the neutral stance immediately so an un-animated instance (the model
  // viewer, the inspector, a paused first frame) stands on the ground rather
  // than dangling its legs at full extension.
  for (const leg of legs) {
    solveLeg(leg, leg.restTarget.x, leg.restTarget.y, leg.restTarget.z);
  }

  const eyeLeft = eyes[0];
  const eyeRight = eyes[1];
  const eyelidLeft = eyelids[0];
  const eyelidRight = eyelids[1];
  const earLeft = ears[0];
  const earRight = ears[1];
  if (!eyeLeft || !eyeRight || !eyelidLeft || !eyelidRight || !earLeft || !earRight) {
    throw new Error("Cat rig failed to build its paired features.");
  }

  return {
    root,
    body,
    pelvis,
    spineLower,
    spineUpper,
    chest,
    neck,
    head,
    jaw,
    earLeft,
    earRight,
    eyeLeft,
    eyeRight,
    eyelidLeft,
    eyelidRight,
    ribcage,
    tailBase,
    tailJoints,
    tailSegmentLength: TAIL_SEGMENT_LENGTH,
    legs,
    mouthAnchor,
    standHeight: STAND_HEIGHT,
    collisionRadius: 0.3,
  };
}

/** A sphere at a joint pivot, hiding the flat end caps of adjacent segments. */
function jointCap(radius: number, material: THREE.Material, offsetY: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material);
  mesh.position.y = offsetY;
  mesh.castShadow = true;
  return mesh;
}

/** A tapered capsule hanging downwards from its pivot. */
function limbMesh(length: number, topRadius: number, bottomRadius: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, length, 6, 1, false);
  geometry.translate(0, -length / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}
