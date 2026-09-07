import * as THREE from "three";
import { PALETTE, surface } from "./materials";
import {
  buildOwnerHandGeometry, buildOwnerHeadGeometry, buildOwnerLoft, buildOwnerShoeGeometry,
  skinAlong,
} from "./owner-geometry";

/**
 * The homeowner.
 *
 * Clothing is authored as continuous skinned surfaces rather than a pile of
 * capsules: one shirt from hem to collar over a real shoulder yoke, one sleeve
 * per arm from that yoke to the wrist, one trouser leg per side from the seat
 * to the ankle. Nothing is a limb stuck onto a torso, because every join is
 * spanned by the surface that crosses it. That is what separates a person from
 * a shop mannequin far more than any amount of detail does.
 *
 * The rig still has to read at a glance — where they are looking, whether they
 * are carrying something, whether they have just noticed the cat — so the joint
 * names and hierarchy are a contract `OwnerAnimator` and the carry socket
 * depend on. Feet are now real joints so a step can roll heel to toe.
 *
 * One rule the skinning depends on: **every skinned mesh hangs off `root`, not
 * off a bone.** Three.js still applies a skinned mesh's own world matrix on top
 * of the skinning, so a mesh parented under a bone it is also weighted to has
 * that bone's rotation applied twice. With small joint angles this merely looks
 * soft; with a leg swinging half a radian it throws the trouser seat out behind
 * the hip as a spike. Each skin therefore sits on `root` at the rest position
 * of the joint its geometry was authored around.
 */
export interface OwnerRig {
  readonly root: THREE.Group;
  readonly hips: THREE.Bone;
  readonly torso: THREE.Bone;
  readonly neck: THREE.Bone;
  readonly head: THREE.Bone;
  readonly armLeft: THREE.Bone;
  readonly armRight: THREE.Bone;
  readonly forearmLeft: THREE.Bone;
  readonly forearmRight: THREE.Bone;
  readonly legLeft: THREE.Bone;
  readonly legRight: THREE.Bone;
  readonly shinLeft: THREE.Bone;
  readonly shinRight: THREE.Bone;
  /** Ankles. Rolling these is what makes a step land on a heel. */
  readonly footLeft: THREE.Bone;
  readonly footRight: THREE.Bone;
  readonly alertMark: THREE.Group;
  /** Socket for objects the homeowner is carrying or restoring. */
  readonly handAnchor: THREE.Object3D;
  readonly eyeHeight: number;
  /**
   * Rest height of the hips. `OwnerAnimator` must drive `hips.position.y` from
   * this rather than from a literal: the shirt is skinned across the hips and
   * the torso, so a mismatch shears the waist open at the one seam the
   * continuous surfaces exist to hide.
   */
  readonly hipHeight: number;
  /** Segment lengths the leg solver works against. */
  readonly legGeometry: OwnerLegGeometry;
}

export interface OwnerLegGeometry {
  /** Hip joint height above the hips group origin (negative). */
  readonly hipDrop: number;
  readonly thighLength: number;
  readonly shinLength: number;
  /** Ankle height above the sole. */
  readonly ankleHeight: number;
  /** Lateral offset of each hip from the spine. */
  readonly hipSpacing: number;
  /**
   * Heel and toe positions along Z, measured from the ankle. A step pivots on
   * one or the other, never on the ankle itself, so the animator needs them.
   */
  readonly heelOffset: number;
  readonly toeOffset: number;
}

/**
 * Proportions. These have to close exactly: the sole sits on y=0 when
 *
 *   HIP_HEIGHT + HIP_DROP − THIGH_LENGTH − SHIN_LENGTH − ANKLE_HEIGHT = 0
 *
 * and the model inspector fails the build if it does not, because a
 * floor-mounted model that misses its own origin hovers or sinks in the level.
 * Thigh slightly longer than shin is what a human leg does; the previous rig
 * had it the other way round, which is part of why it read as a mannequin.
 */
const HIP_HEIGHT = 1.25;
const HIP_DROP = -0.05;
const THIGH_LENGTH = 0.56;
const SHIN_LENGTH = 0.52;
const ANKLE_HEIGHT = 0.12;
const HIP_SPACING = 0.125;
/** Shoe extents along Z, relative to the ankle. Must match the shoe geometry. */
const HEEL_OFFSET = -0.085;
const TOE_OFFSET = 0.182;

export function buildOwner(): OwnerRig {
  const shirt = surface(PALETTE.shirt, { roughness: 0.92 });
  const trousers = surface(PALETTE.trousers, { roughness: 0.94 });
  const skin = surface(PALETTE.skin, { roughness: 0.86 });
  const hair = surface(PALETTE.hair, { roughness: 1 });
  const shoeLeather = surface(0x50413a, { roughness: 0.78 });

  const root = new THREE.Group();
  root.name = "homeowner";

  const hips = new THREE.Bone();
  hips.name = "hips";
  hips.position.y = HIP_HEIGHT;
  root.add(hips);

  const torso = new THREE.Bone();
  torso.name = "torso";
  torso.position.y = 0.09;
  hips.add(torso);

  const neck = new THREE.Bone();
  neck.name = "neck";
  neck.position.y = 0.585;
  torso.add(neck);

  const head = new THREE.Bone();
  head.name = "head";
  head.position.y = 0.105;
  neck.add(head);

  // -- shirt ----------------------------------------------------------------
  // One surface from hem to collar. The shoulder is a widening of the torso
  // rather than a socket the arms are pushed into, so there is no seam at the
  // one place a mannequin always shows one.
  const shirtSkin = new THREE.SkinnedMesh(
    buildOwnerLoft([
      // A shirt hangs over the hips, so the hem is the *widest* part of the
      // garment below the shoulders. It has to be: everything trouser above
      // this line has to fit inside it, or the hip pokes through the shirt as
      // a flap. `owner.test.ts` asserts that containment.
      { at: -0.16, halfWidth: 0.229, halfDepth: 0.148, flatBack: 0.06 },
      { at: -0.1, halfWidth: 0.219, halfDepth: 0.138, flatBack: 0.09 },
      { at: -0.02, halfWidth: 0.2, halfDepth: 0.126, flatBack: 0.13 },
      // Waist: the narrowest point, and the reason a torso reads as a torso.
      { at: 0.1, halfWidth: 0.174, halfDepth: 0.114, flatBack: 0.16 },
      { at: 0.24, halfWidth: 0.196, halfDepth: 0.126, offsetZ: 0.006, flatBack: 0.18 },
      // Chest, then the shoulder cap. The cap is *shirt*, not sleeve: on a
      // clothed person the deltoid is under the garment, so the sleeve is
      // buried in this section rather than bulging out through it.
      { at: 0.34, halfWidth: 0.229, halfDepth: 0.138, offsetZ: 0.008, flatBack: 0.18 },
      { at: 0.4, halfWidth: 0.251, halfDepth: 0.139, offsetZ: 0.005, flatBack: 0.16 },
      // Acromion: the widest point sits at the joint, not above it. Putting it
      // above turns the shoulder into a horizontal shelf with a corner.
      { at: 0.45, halfWidth: 0.264, halfDepth: 0.136, offsetZ: 0.002, flatBack: 0.14 },
      { at: 0.5, halfWidth: 0.236, halfDepth: 0.127, offsetZ: -0.002, flatBack: 0.14 },
      // Trapezius, sloping into the collar over enough height that the
      // transition is a slope rather than a shelf.
      { at: 0.545, halfWidth: 0.198, halfDepth: 0.114, offsetZ: -0.004, flatBack: 0.16 },
      { at: 0.58, halfWidth: 0.15, halfDepth: 0.101, offsetZ: -0.004, flatBack: 0.16 },
      // Collar: the shirt closes around the neck rather than stopping short.
      { at: 0.607, halfWidth: 0.108, halfDepth: 0.09, offsetZ: -0.002, flatBack: 0.14 },
    ], {
      radialSegments: 16,
      skinAt: skinAlong([{ at: -0.16, index: 0 }, { at: 0.24, index: 1 }, { at: 0.6, index: 2 }]),
    }),
    shirt,
  );
  shirtSkin.name = "shirt";
  shirtSkin.frustumCulled = false;
  shirtSkin.castShadow = true;
  shirtSkin.receiveShadow = true;
  shirtSkin.position.y = HIP_HEIGHT + torso.position.y;
  root.add(shirtSkin);

  const neckMesh = new THREE.Mesh(
    buildOwnerLoft([
      { at: -0.05, halfWidth: 0.089, halfDepth: 0.082 },
      { at: 0.03, halfWidth: 0.081, halfDepth: 0.076, offsetZ: 0.004 },
      { at: 0.1, halfWidth: 0.076, halfDepth: 0.073, offsetZ: 0.009 },
    ], { radialSegments: 12, capEnd: false }),
    skin,
  );
  neckMesh.name = "neck-column";
  neck.add(neckMesh);

  // -- head -----------------------------------------------------------------
  const skull = new THREE.Mesh(buildOwnerHeadGeometry(), skin);
  skull.name = "skull";
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);

  // Hair as a fitted shell over the cranium, following the same profile as the
  // skull so it sits on the head instead of hovering over it.
  const hairShell = new THREE.Mesh(
    buildOwnerLoft([
      { at: 0.152, halfWidth: 0.134, halfDepth: 0.138, offsetZ: 0.001 },
      { at: 0.19, halfWidth: 0.133, halfDepth: 0.133, offsetZ: -0.005 },
      { at: 0.24, halfWidth: 0.128, halfDepth: 0.126, offsetZ: -0.015 },
      { at: 0.29, halfWidth: 0.106, halfDepth: 0.103, offsetZ: -0.021 },
      { at: 0.33, halfWidth: 0.056, halfDepth: 0.055, offsetZ: -0.023 },
    ], { radialSegments: 16, capStart: false }),
    hair,
  );
  hairShell.name = "hair-crown";
  hairShell.position.y = 0.06;
  head.add(hairShell);

  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), hair);
  bun.name = "hair-bun";
  bun.scale.set(1.05, 0.78, 0.7);
  bun.position.set(0, 0.126, -0.128);
  head.add(bun);

  for (const side of [-1, 1] as const) {
    // Recessed into the brow's shadow rather than sitting on the surface.
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skin);
    socket.name = side < 0 ? "eye-socket-left" : "eye-socket-right";
    socket.scale.set(1.05, 0.72, 0.5);
    socket.position.set(side * 0.052, 0.176, 0.104);
    head.add(socket);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), surface(0x2b2521, { roughness: 0.3 }));
    eye.name = side < 0 ? "eye-left" : "eye-right";
    eye.scale.set(1, 0.78, 0.42);
    eye.position.set(side * 0.052, 0.173, 0.121);
    head.add(eye);

    const eyebrow = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.014, 0.016), hair);
    eyebrow.name = side < 0 ? "eyebrow-left" : "eyebrow-right";
    eyebrow.position.set(side * 0.054, 0.212, 0.113);
    eyebrow.rotation.z = side * 0.12;
    head.add(eyebrow);

    const ear = new THREE.Mesh(
      buildOwnerLoft([
        { at: -0.04, halfWidth: 0.006, halfDepth: 0.021 },
        { at: 0, halfWidth: 0.008, halfDepth: 0.032 },
        { at: 0.036, halfWidth: 0.006, halfDepth: 0.025 },
      ], { radialSegments: 8 }),
      skin,
    );
    ear.name = side < 0 ? "ear-left" : "ear-right";
    // Laid flat against the skull. Standing off it reads as a bead stuck on
    // the side of the head rather than an ear.
    ear.position.set(side * 0.118, 0.148, -0.016);
    ear.rotation.z = side * -0.16;
    head.add(ear);
  }

  // A nose lofted out of the face, not a cone pushed through it.
  const nose = new THREE.Mesh(
    buildOwnerLoft([
      { at: -0.032, halfWidth: 0.023, halfDepth: 0.021, offsetZ: 0.006 },
      { at: -0.008, halfWidth: 0.019, halfDepth: 0.026, offsetZ: 0.012 },
      { at: 0.022, halfWidth: 0.012, halfDepth: 0.018, offsetZ: 0.004 },
      { at: 0.04, halfWidth: 0.009, halfDepth: 0.011, offsetZ: -0.004 },
    ], { radialSegments: 10 }),
    skin,
  );
  nose.name = "nose";
  nose.position.set(0, 0.152, 0.108);
  head.add(nose);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.007, 0.01), surface(0x9a6357, { roughness: 0.8 }));
  mouth.name = "mouth";
  mouth.position.set(0, 0.084, 0.126);
  head.add(mouth);

  // -- arms -----------------------------------------------------------------
  const arms: THREE.Bone[] = [];
  const forearms: THREE.Bone[] = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Bone();
    shoulder.name = side < 0 ? "arm-left" : "arm-right";
    shoulder.position.set(side * 0.185, 0.45, 0);
    torso.add(shoulder);

    const elbow = new THREE.Bone();
    elbow.name = side < 0 ? "forearm-left" : "forearm-right";
    elbow.position.y = -0.32;
    shoulder.add(elbow);

    // One sleeve from the shoulder yoke to the wrist. It starts buried in the
    // shirt, so the deltoid is part of the same garment rather than a capsule
    // hanging beside it.
    const sleeve = new THREE.SkinnedMesh(
      buildOwnerLoft([
        { at: -0.63, halfWidth: 0.034, halfDepth: 0.033 },
        { at: -0.56, halfWidth: 0.042, halfDepth: 0.041 },
        { at: -0.44, halfWidth: 0.048, halfDepth: 0.047 },
        // Elbow.
        { at: -0.32, halfWidth: 0.053, halfDepth: 0.052 },
        { at: -0.2, halfWidth: 0.06, halfDepth: 0.059 },
        { at: -0.08, halfWidth: 0.062, halfDepth: 0.061 },
        // The top of the sleeve stops inside the shirt's shoulder cap, so the
        // arm emerges from the garment instead of hanging beside it. Keep it
        // clear of the cap's own surface: a sleeve that grazes the shirt from
        // the inside shows up as a flap of cloth off the shoulder, and the
        // corner that escapes first is the outer-back one.
        { at: -0.02, halfWidth: 0.056, halfDepth: 0.055 },
      ], {
        radialSegments: 12,
        // The shoulder of the sleeve belongs to the torso: weighting it to the
        // shoulder joint swings the whole cap with the arm.
        skinAt: skinAlong([
          { at: -0.63, index: 3 }, { at: -0.32, index: 2 },
          { at: -0.06, index: 1 }, { at: 0.02, index: 0 },
        ]),
      }),
      shirt,
    );
    sleeve.name = side < 0 ? "sleeve-left" : "sleeve-right";
    sleeve.frustumCulled = false;
    sleeve.castShadow = true;
    sleeve.position.set(
      shoulder.position.x, HIP_HEIGHT + torso.position.y + shoulder.position.y, 0,
    );
    root.add(sleeve);

    const hand = new THREE.Mesh(buildOwnerHandGeometry(), skin);
    hand.name = side < 0 ? "hand-left" : "hand-right";
    hand.position.y = -0.3;
    hand.castShadow = true;
    elbow.add(hand);

    arms.push(shoulder);
    forearms.push(elbow);
  }

  // The sleeve spans shoulder → elbow → forearm, so it needs the shoulder as a
  // bone as well as its own two joints. Bind after the hierarchy is in place.
  root.updateMatrixWorld(true);
  for (const [index, side] of [-1, 1].entries()) {
    const shoulder = arms[index]!;
    const elbow = forearms[index]!;
    const sleeve = root.getObjectByName(side < 0 ? "sleeve-left" : "sleeve-right");
    if (sleeve instanceof THREE.SkinnedMesh) {
      // A forearm bone is not modelled separately, so the wrist end simply
      // follows the elbow: bones are [torso, shoulder, elbow, elbow].
      sleeve.bind(
        new THREE.Skeleton([torso, shoulder, elbow, elbow]), sleeve.matrixWorld.clone(),
      );
    }
  }

  const handAnchor = new THREE.Object3D();
  handAnchor.name = "hand-anchor";
  handAnchor.position.set(0, -0.37, 0.05);
  forearms[1]?.add(handAnchor);

  // -- legs -----------------------------------------------------------------
  const legs: THREE.Bone[] = [];
  const shins: THREE.Bone[] = [];
  const feet: THREE.Bone[] = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Bone();
    hip.name = side < 0 ? "leg-left" : "leg-right";
    hip.position.set(side * HIP_SPACING, HIP_DROP, 0);
    hips.add(hip);

    const knee = new THREE.Bone();
    knee.name = side < 0 ? "shin-left" : "shin-right";
    knee.position.y = -THIGH_LENGTH;
    hip.add(knee);

    const ankle = new THREE.Bone();
    ankle.name = side < 0 ? "foot-left" : "foot-right";
    ankle.position.y = -SHIN_LENGTH;
    knee.add(ankle);

    // One trouser leg per side, from the shirt hem to the ankle. The pair
    // carry the seat between them, so the hip is a fold in the cloth rather
    // than a ball joint pushed into a pelvis.
    const trouserLeg = new THREE.SkinnedMesh(
      buildOwnerLoft([
        { at: -(THIGH_LENGTH + SHIN_LENGTH), halfWidth: 0.062, halfDepth: 0.066 },
        { at: -(THIGH_LENGTH + SHIN_LENGTH) + 0.09, halfWidth: 0.07, halfDepth: 0.076 },
        // Calf.
        { at: -(THIGH_LENGTH + 0.16), halfWidth: 0.086, halfDepth: 0.093 },
        // Knee.
        { at: -THIGH_LENGTH, halfWidth: 0.085, halfDepth: 0.09 },
        { at: -THIGH_LENGTH + 0.16, halfWidth: 0.099, halfDepth: 0.104 },
        // Thigh, then the seat of the trousers. Each leg is drawn inwards as
        // it rises until the two overlap on the centre line, so the pair close
        // the crotch between them. A separate pelvis surface crossing both was
        // what put a hard crease across the front of each hip.
        { at: -0.15, halfWidth: 0.112, halfDepth: 0.118, offsetX: side * -0.018 },
        { at: 0, halfWidth: 0.104, halfDepth: 0.11, offsetX: side * -0.035 },
        // Buried under the shirt hem from here up.
        { at: 0.05, halfWidth: 0.094, halfDepth: 0.1, offsetX: side * -0.046 },
        { at: 0.1, halfWidth: 0.078, halfDepth: 0.086, offsetX: side * -0.056 },
      ], {
        radialSegments: 12,
        // Four bones, not three: the seat of the trousers belongs to the
        // pelvis. Weighting it to the hip made the whole seat swing with the
        // leg, which is not something trousers do.
        skinAt: skinAlong([
          { at: -(THIGH_LENGTH + SHIN_LENGTH), index: 3 },
          { at: -THIGH_LENGTH, index: 2 },
          { at: -0.14, index: 1 },
          { at: 0.02, index: 0 },
        ]),
      }),
      trousers,
    );
    trouserLeg.name = side < 0 ? "trouser-left" : "trouser-right";
    trouserLeg.frustumCulled = false;
    trouserLeg.castShadow = true;
    trouserLeg.position.set(hip.position.x, HIP_HEIGHT + hip.position.y, 0);
    root.add(trouserLeg);

    const shoe = new THREE.Mesh(buildOwnerShoeGeometry(), shoeLeather);
    shoe.name = side < 0 ? "shoe-left" : "shoe-right";
    shoe.position.y = -ANKLE_HEIGHT;
    shoe.castShadow = true;
    ankle.add(shoe);

    legs.push(hip);
    shins.push(knee);
    feet.push(ankle);
  }

  root.updateMatrixWorld(true);
  for (const [index, side] of [-1, 1].entries()) {
    const hip = legs[index]!;
    const knee = shins[index]!;
    const ankle = feet[index]!;
    const leg = root.getObjectByName(side < 0 ? "trouser-left" : "trouser-right");
    if (leg instanceof THREE.SkinnedMesh) {
      leg.bind(new THREE.Skeleton([hips, hip, knee, ankle]), leg.matrixWorld.clone());
    }
  }

  // Bind the shirt last: its bones are hips, torso, and neck, and every one of
  // them has to be in the tree with a current world matrix first.
  root.updateMatrixWorld(true);
  shirtSkin.bind(new THREE.Skeleton([hips, torso, neck]), shirtSkin.matrixWorld.clone());

  const alertMark = new THREE.Group();
  alertMark.name = "alert-mark";
  alertMark.position.set(0, 0.42, 0);
  alertMark.visible = false;
  head.add(alertMark);
  const alertMaterial = surface(0xe0603f, { roughness: 0.4, emissive: 0xe0603f, emissiveIntensity: 0.6 });
  const stroke = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.14, 4, 8), alertMaterial);
  stroke.position.y = 0.1;
  alertMark.add(stroke);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), alertMaterial);
  dot.position.y = -0.05;
  alertMark.add(dot);

  const [armLeft, armRight] = arms;
  const [forearmLeft, forearmRight] = forearms;
  const [legLeft, legRight] = legs;
  const [shinLeft, shinRight] = shins;
  const [footLeft, footRight] = feet;
  if (!armLeft || !armRight || !forearmLeft || !forearmRight
    || !legLeft || !legRight || !shinLeft || !shinRight || !footLeft || !footRight) {
    throw new Error("Homeowner rig failed to build its limbs.");
  }

  return {
    root, hips, torso, neck, head,
    armLeft, armRight, forearmLeft, forearmRight,
    legLeft, legRight, shinLeft, shinRight, footLeft, footRight,
    alertMark, handAnchor,
    eyeHeight: HIP_HEIGHT + 0.77,
    hipHeight: HIP_HEIGHT,
    legGeometry: {
      hipDrop: HIP_DROP,
      thighLength: THIGH_LENGTH,
      shinLength: SHIN_LENGTH,
      ankleHeight: ANKLE_HEIGHT,
      hipSpacing: HIP_SPACING,
      heelOffset: HEEL_OFFSET,
      toeOffset: TOE_OFFSET,
    },
  };
}
