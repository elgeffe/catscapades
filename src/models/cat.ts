import * as THREE from "three";
import { PALETTE, surface } from "./materials";
import { solveLeg } from "../anim/leg-ik";
import {
  buildCatEarGeometry,
  buildCatEarInnerGeometry,
  buildCatJawGeometry,
  buildCatLegGeometry,
  buildCatNeckHeadGeometry,
  buildCatNoseGeometry,
  buildCatPawGeometry,
  buildCatTailGeometry,
  buildCatTorsoGeometry,
  type CatCoatColors,
} from "./cat-geometry";

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
  /** Terminal paw. Kept level in stance instead of inheriting the hock angle. */
  readonly paw: THREE.Object3D;
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
  readonly pelvis: THREE.Bone;
  readonly spineLower: THREE.Bone;
  readonly spineUpper: THREE.Bone;
  readonly chest: THREE.Bone;
  readonly neck: THREE.Bone;
  readonly head: THREE.Bone;
  readonly jaw: THREE.Group;
  readonly earLeft: THREE.Group;
  readonly earRight: THREE.Group;
  readonly eyeLeft: THREE.Mesh;
  readonly eyeRight: THREE.Mesh;
  readonly pupilLeft: THREE.Mesh;
  readonly pupilRight: THREE.Mesh;
  readonly eyelidLeft: THREE.Mesh;
  readonly eyelidRight: THREE.Mesh;
  /** The continuous skinned torso; retained as `ribcage` for rig compatibility. */
  readonly ribcage: THREE.SkinnedMesh;
  readonly scapulaLeft: THREE.Group;
  readonly scapulaRight: THREE.Group;
  readonly tailBase: THREE.Bone;
  /** Tail joints, root first. Driven by a verlet chain. */
  readonly tailJoints: readonly THREE.Bone[];
  readonly tailMesh: THREE.SkinnedMesh;
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
    id: "hind-left", root: [-0.103, 0.068, -0.245], upperLength: 0.19, lowerLength: 0.17, footLength: 0.108,
    bend: -1, phaseOffset: 0, isFront: false, side: -1, restZ: -0.215,
  },
  {
    id: "front-left", root: [-0.096, 0.052, 0.24], upperLength: 0.16, lowerLength: 0.155, footLength: 0.085,
    bend: 1, phaseOffset: 0.25, isFront: true, side: -1, restZ: 0.25,
  },
  {
    id: "hind-right", root: [0.103, 0.068, -0.245], upperLength: 0.19, lowerLength: 0.17, footLength: 0.108,
    bend: -1, phaseOffset: 0.5, isFront: false, side: 1, restZ: -0.215,
  },
  {
    id: "front-right", root: [0.096, 0.052, 0.24], upperLength: 0.16, lowerLength: 0.155, footLength: 0.085,
    bend: 1, phaseOffset: 0.75, isFront: true, side: 1, restZ: 0.25,
  },
];

const TAIL_SEGMENTS = 12;
const TAIL_SEGMENT_LENGTH = 0.052;
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
  const coat = surface(0xffffff, { roughness: FUR_ROUGHNESS, vertexColors: true });
  const nose = surface(PALETTE.nose, { roughness: 0.6 });
  const muzzleFur = surface(
    new THREE.Color(furColor).lerp(new THREE.Color(bellyColor), 0.1).getHex(),
    { roughness: FUR_ROUGHNESS },
  );
  const earSkin = surface(
    new THREE.Color(PALETTE.nose).lerp(new THREE.Color(furColor), 0.24).getHex(),
    { roughness: 0.84, vertexColors: true },
  );
  const iris = surface(eyeColor, { roughness: 0.28 });
  const pupil = surface(0x14120f, { roughness: 0.2 });
  const catchlight = surface(0xfff8df, { roughness: 0.18, emissive: 0xfff8df, emissiveIntensity: 0.14 });
  const mouthInterior = surface(0x321c1d, { roughness: 0.92 });
  const coatColors: CatCoatColors = { fur: furColor, shade: shadeColor, belly: bellyColor };

  const root = new THREE.Group();
  root.name = "cat";

  const body = new THREE.Group();
  body.name = "cat-body";
  body.position.y = STAND_HEIGHT;
  root.add(body);

  // ---- Spine and one continuous deforming hide -----------------------------
  const pelvis = new THREE.Bone();
  pelvis.name = "pelvis";
  pelvis.position.set(0, 0, -0.235);
  body.add(pelvis);

  const spineLower = new THREE.Bone();
  spineLower.name = "spine-lower";
  spineLower.position.set(0, 0.006, 0.155);
  pelvis.add(spineLower);

  const spineUpper = new THREE.Bone();
  spineUpper.name = "spine-upper";
  spineUpper.position.set(0, 0.004, 0.155);
  spineLower.add(spineUpper);

  const chest = new THREE.Bone();
  chest.name = "chest";
  chest.position.set(0, 0.01, 0.135);
  spineUpper.add(chest);

  const ribcage = new THREE.SkinnedMesh(buildCatTorsoGeometry(coatColors), coat);
  ribcage.name = "ribcage";
  ribcage.frustumCulled = false;
  ribcage.castShadow = true;
  ribcage.receiveShadow = true;
  body.add(ribcage);

  root.updateMatrixWorld(true);
  ribcage.bind(
    new THREE.Skeleton([pelvis, spineLower, spineUpper, chest]),
    ribcage.matrixWorld.clone(),
  );

  // Named scapular anchors keep stride-driven shoulder timing explicit. The
  // actual surface landmark comes from the raised withers and the buried flare
  // of each continuous front-leg skin, avoiding stuck-on shoulder patches.
  const scapulae: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const scapula = new THREE.Group();
    scapula.name = side < 0 ? "scapula-left" : "scapula-right";
    scapula.position.set(side * 0.113, 0.108, 0.005);
    chest.add(scapula);
    scapulae.push(scapula);
  }

  // ---- Neck and head -------------------------------------------------------
  const neck = new THREE.Bone();
  neck.name = "neck";
  neck.position.set(0, 0.055, 0.11);
  chest.add(neck);

  const head = new THREE.Bone();
  head.name = "head";
  head.position.set(0, 0.06, 0.115);
  neck.add(head);

  // A single two-bone skin spans the nape, throat, crown, cheeks, and muzzle.
  // It is a sibling of the neck bone, so neck rotation deforms the surface
  // exactly once while the facial features continue to follow `head`.
  const headSkin = new THREE.SkinnedMesh(buildCatNeckHeadGeometry(coatColors), coat);
  headSkin.name = "head-skin";
  headSkin.position.copy(neck.position);
  headSkin.frustumCulled = false;
  headSkin.castShadow = true;
  headSkin.receiveShadow = true;
  chest.add(headSkin);
  root.updateMatrixWorld(true);
  headSkin.bind(new THREE.Skeleton([neck, head]), headSkin.matrixWorld.clone());

  // Cats have a short, restrained muzzle whose whisker pads swell out of the
  // cheeks. Their shallow depth keeps the face soft and broad, not fox-like.
  for (const side of [-1, 1] as const) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.027, 10, 6), muzzleFur);
    pad.name = side < 0 ? "whisker-pad-left" : "whisker-pad-right";
    pad.scale.set(1.12, 0.59, 0.49);
    pad.position.set(side * 0.019, -0.03, 0.091);
    pad.castShadow = true;
    head.add(pad);
  }

  const noseMesh = new THREE.Mesh(buildCatNoseGeometry(), nose);
  noseMesh.scale.setScalar(0.7);
  noseMesh.position.set(0, -0.017, 0.111);
  noseMesh.castShadow = true;
  head.add(noseMesh);

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.051, 0.06);

  // A recessed pocket is revealed by the articulated jaw during a meow; in a
  // closed mouth it stays behind the lips instead of outlining the chin.
  const mouthCavity = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 5), mouthInterior);
  mouthCavity.name = "mouth-cavity";
  mouthCavity.scale.set(0.66, 0.22, 0.16);
  mouthCavity.position.set(0, -0.041, 0.094);
  head.add(mouthCavity);

  head.add(jaw);

  const jawMesh = new THREE.Mesh(buildCatJawGeometry(), muzzleFur);
  jawMesh.scale.set(0.56, 0.44, 0.52);
  jawMesh.position.set(0, 0.004, 0.012);
  jawMesh.castShadow = true;
  jaw.add(jawMesh);

  const ears: THREE.Group[] = [];
  const eyes: THREE.Mesh[] = [];
  const pupils: THREE.Mesh[] = [];
  const eyelids: THREE.Mesh[] = [];
  const earShell = buildCatEarGeometry();
  const earInner = buildCatEarInnerGeometry();
  // Only the visible corneal surface needs triangles. Two radial bands give
  // it a slight dome, while the pointed outline follows the opening between
  // feline eyelids instead of displaying an entire flattened eyeball.
  const eyeSurface = new THREE.BufferGeometry();
  const eyePositions: number[] = [0, 0, 0.0028];
  const eyeIndices: number[] = [];
  const eyeSegments = 20;
  for (const radius of [0.55, 1]) {
    for (let index = 0; index < eyeSegments; index += 1) {
      const angle = index / eyeSegments * Math.PI * 2;
      const sine = Math.sin(angle);
      eyePositions.push(
        Math.cos(angle) * radius * 0.025,
        sine * (0.48 + 0.52 * Math.abs(sine)) * radius * 0.0128,
        0.0028 * (1 - radius * radius),
      );
    }
  }
  for (let index = 0; index < eyeSegments; index += 1) {
    const next = (index + 1) % eyeSegments;
    eyeIndices.push(0, index + 1, next + 1);
    eyeIndices.push(index + 1, index + eyeSegments + 1, next + eyeSegments + 1);
    eyeIndices.push(index + 1, next + eyeSegments + 1, next + 1);
  }
  eyeSurface.setAttribute("position", new THREE.Float32BufferAttribute(eyePositions, 3));
  eyeSurface.setIndex(eyeIndices);
  eyeSurface.computeVertexNormals();
  const whiskerLine = new THREE.LineBasicMaterial({ color: 0xeee5d4, transparent: true, opacity: 0.58 });

  for (const side of [-1, 1] as const) {
    const ear = new THREE.Group();
    ear.name = side < 0 ? "ear-left" : "ear-right";
    // The broad base is buried through the side of the crown. The larger
    // pinnae then read as part of the skull silhouette, not cones balanced on
    // top of it.
    ear.position.set(side * 0.063, 0.041, -0.024);
    ear.scale.set(1.06, 1.12, 1.4);
    ear.rotation.z = side * -0.19;
    ear.rotation.x = -0.08;
    head.add(ear);

    const shell = new THREE.Mesh(earShell, fur);
    shell.rotation.y = side * 0.18;
    shell.castShadow = true;
    ear.add(shell);

    const inner = new THREE.Mesh(earInner, earSkin);
    inner.rotation.copy(shell.rotation);
    ear.add(inner);

    ears.push(ear);

    // The eyes follow the sloping cheek plane. Their outer corners turn into
    // the skull, leaving a thin dark lid edge rather than a protruding rim.
    const eyeTilt = side * 0.13;
    const eyePosition = new THREE.Vector3(side * 0.047, 0.024, 0.083);
    const eyeRotation = new THREE.Euler(-0.32, side * 0.38, eyeTilt);
    const eyeNormal = new THREE.Vector3(0, 0, 1).applyEuler(eyeRotation);
    const socket = new THREE.Mesh(eyeSurface, pupil);
    socket.name = side < 0 ? "eye-socket-left" : "eye-socket-right";
    socket.scale.set(1.07, 1.16, 1);
    socket.position.copy(eyePosition);
    socket.rotation.copy(eyeRotation);
    head.add(socket);

    const eye = new THREE.Mesh(eyeSurface, iris);
    eye.name = side < 0 ? "eye-left" : "eye-right";
    eye.position.copy(eyePosition).addScaledVector(eyeNormal, 0.0005);
    eye.rotation.copy(eyeRotation);
    head.add(eye);
    eyes.push(eye);

    const slit = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), pupil);
    slit.name = side < 0 ? "pupil-left" : "pupil-right";
    slit.scale.set(0.34, 1.04, 0.06);
    slit.position.copy(eyePosition).addScaledVector(eyeNormal, 0.0037);
    slit.rotation.copy(eyeRotation);
    head.add(slit);
    pupils.push(slit);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 5, 4), catchlight);
    glint.name = side < 0 ? "catchlight-left" : "catchlight-right";
    // Both highlights share one screen-space light direction. Mirroring them
    // towards the nose made the old gaze read as cross-eyed.
    glint.position.copy(eyePosition).add(new THREE.Vector3(-0.003, 0.006, 0.0037).applyEuler(eyeRotation));
    glint.scale.z = 0.35;
    glint.rotation.copy(eyeRotation);
    head.add(glint);

    // The fur-coloured lid rests at the upper rim and closes down over the
    // cornea. The animator keeps its translation on this same facial plane.
    const eyelid = new THREE.Mesh(eyeSurface, fur);
    eyelid.name = side < 0 ? "eyelid-left" : "eyelid-right";
    eyelid.position.copy(eyePosition)
      .add(new THREE.Vector3(0, 0.013, 0.005).applyEuler(eyeRotation));
    eyelid.scale.set(1.09, 0.02, 1);
    eyelid.rotation.copy(eyeRotation);
    head.add(eyelid);
    eyelids.push(eyelid);

    for (let index = 0; index < 3; index += 1) {
      const y = -0.031 + index * 0.01;
      const start = new THREE.Vector3(side * 0.038, y, 0.102);
      const control = new THREE.Vector3(
        side * (0.086 + index * 0.007),
        y + (index - 1) * 0.004,
        0.109,
      );
      const end = new THREE.Vector3(
        side * (0.138 + index * 0.012),
        y + (index - 1) * 0.011,
        0.108 - index * 0.004,
      );
      const geometry = new THREE.BufferGeometry().setFromPoints(
        new THREE.QuadraticBezierCurve3(start, control, end).getPoints(6),
      );
      head.add(new THREE.Line(geometry, whiskerLine));
    }
  }

  const mouthLine = new THREE.LineBasicMaterial({ color: 0x3a2722, transparent: true, opacity: 0.78 });
  const mouth = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.026, 0.116),
      new THREE.Vector3(0, -0.038, 0.112),
      new THREE.Vector3(0, -0.038, 0.112),
      new THREE.Vector3(-0.015, -0.036, 0.108),
      new THREE.Vector3(0, -0.038, 0.112),
      new THREE.Vector3(0.015, -0.036, 0.108),
    ]),
    mouthLine,
  );
  head.add(mouth);

  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.name = "mouth-anchor";
  mouthAnchor.position.set(0, -0.018, 0.084);
  jaw.add(mouthAnchor);

  // ---- Tail ----------------------------------------------------------------
  const tailBase = new THREE.Bone();
  tailBase.name = "tail-base";
  // The root is buried slightly inside the lofted rump. The visible tail skin
  // begins wider than the chain and makes this a continuous sacrum-to-tip line.
  tailBase.position.set(0, 0.09, -0.105);
  pelvis.add(tailBase);

  const tailJoints: THREE.Bone[] = [];
  let tailParent: THREE.Bone = tailBase;
  for (let index = 0; index < TAIL_SEGMENTS; index += 1) {
    const joint = new THREE.Bone();
    joint.name = `tail-${index}`;
    joint.position.set(0, 0, index === 0 ? 0 : -TAIL_SEGMENT_LENGTH);
    tailParent.add(joint);
    tailJoints.push(joint);
    tailParent = joint;
  }

  const tailMesh = new THREE.SkinnedMesh(buildCatTailGeometry(TAIL_SEGMENTS, TAIL_SEGMENT_LENGTH, coatColors), coat);
  tailMesh.name = "tail-skin";
  tailMesh.frustumCulled = false;
  tailMesh.castShadow = true;
  tailBase.add(tailMesh);
  root.updateMatrixWorld(true);
  // The sacral socket is the first skin bone. Its root-weighted ring stays
  // seated in the rump while the tail-0 blend begins the simulated curve.
  tailMesh.bind(new THREE.Skeleton([tailBase, ...tailJoints]), tailMesh.matrixWorld.clone());

  // ---- Legs ----------------------------------------------------------------
  // Leg roots are authored in body space, but shoulders parent to `chest` and
  // hips to `pelvis` so the spine carries them. Subtract the accumulated joint
  // offset so the authored body-space position is preserved.
  const chestOffset = new THREE.Vector3()
    .add(pelvis.position).add(spineLower.position).add(spineUpper.position).add(chest.position);
  const pelvisOffset = pelvis.position.clone();
  const pawGeometries = new Map<boolean, THREE.BufferGeometry>();

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

    // This stationary socket keeps the buried shoulder/hip rings attached to
    // the torso while the upper limb rotates beneath them.
    const socket = new THREE.Bone();
    socket.name = `${spec.id}-socket`;
    legRoot.add(socket);

    const upper = new THREE.Bone();
    upper.name = `${spec.id}-upper`;
    legRoot.add(upper);

    const lower = new THREE.Bone();
    lower.name = `${spec.id}-lower`;
    lower.position.y = -spec.upperLength;
    upper.add(lower);

    const foot = new THREE.Bone();
    foot.name = `${spec.id}-foot`;
    foot.position.y = -spec.lowerLength;
    lower.add(foot);

    const paw = new THREE.Bone();
    paw.name = `${spec.id}-paw`;
    paw.position.y = -spec.footLength;
    foot.add(paw);

    const legGeometry = buildCatLegGeometry({
      side: spec.side,
      socketBlend: spec.isFront ? 0.096 : 0.085,
      upper: {
        length: spec.upperLength,
        root: spec.isFront ? [0.038, 0.051] : [0.052, 0.071],
        muscle: spec.isFront ? [0.037, 0.045] : [0.056, 0.066],
        muscleAt: spec.isFront ? 0.24 : 0.3,
        joint: spec.isFront ? [0.026, 0.03] : [0.034, 0.04],
        stripes: spec.isFront ? [0.22, 0.43] : [0.24, 0.46],
      },
      lower: {
        length: spec.lowerLength,
        root: spec.isFront ? [0.027, 0.031] : [0.035, 0.041],
        muscle: spec.isFront ? [0.026, 0.03] : [0.033, 0.039],
        muscleAt: 0.2,
        joint: spec.isFront ? [0.021, 0.024] : [0.024, 0.029],
        stripes: [0.2, 0.42],
      },
      foot: {
        length: spec.footLength,
        root: spec.isFront ? [0.022, 0.025] : [0.023, 0.028],
        muscle: [0.021, 0.024],
        muscleAt: 0.3,
        joint: [0.022, 0.023],
        stripes: [0.38],
      },
      footEndInset: 0.025,
    }, coatColors);
    const legSkin = new THREE.SkinnedMesh(legGeometry, coat);
    legSkin.name = `${spec.id}-skin`;
    legSkin.frustumCulled = false;
    legSkin.castShadow = true;
    legRoot.add(legSkin);
    root.updateMatrixWorld(true);
    legSkin.bind(new THREE.Skeleton([socket, upper, lower, foot]), legSkin.matrixWorld.clone());

    let pawGeometry = pawGeometries.get(spec.isFront);
    if (!pawGeometry) {
      pawGeometry = buildCatPawGeometry(coatColors, spec.isFront);
      pawGeometries.set(spec.isFront, pawGeometry);
    }
    const pawMesh = new THREE.Mesh(pawGeometry, coat);
    pawMesh.castShadow = true;
    paw.add(pawMesh);

    return {
      id: spec.id,
      root: legRoot,
      upper,
      lower,
      foot,
      paw,
      upperLength: spec.upperLength,
      lowerLength: spec.lowerLength,
      footLength: spec.footLength,
      bend: spec.bend,
      restTarget: new THREE.Vector3(spec.side * (spec.isFront ? 0.082 : 0.088), -STAND_HEIGHT, spec.restZ),
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
  const pupilLeft = pupils[0];
  const pupilRight = pupils[1];
  const eyelidLeft = eyelids[0];
  const eyelidRight = eyelids[1];
  const earLeft = ears[0];
  const earRight = ears[1];
  const scapulaLeft = scapulae[0];
  const scapulaRight = scapulae[1];
  if (
    !eyeLeft || !eyeRight || !pupilLeft || !pupilRight
    || !eyelidLeft || !eyelidRight || !earLeft || !earRight
    || !scapulaLeft || !scapulaRight
  ) {
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
    pupilLeft,
    pupilRight,
    eyelidLeft,
    eyelidRight,
    ribcage,
    scapulaLeft,
    scapulaRight,
    tailBase,
    tailJoints,
    tailMesh,
    tailSegmentLength: TAIL_SEGMENT_LENGTH,
    legs,
    mouthAnchor,
    standHeight: STAND_HEIGHT,
    collisionRadius: 0.19,
  };
}
