import * as THREE from "three";
import { PALETTE, surface } from "./materials";

/**
 * The homeowner. A jointed figure rather than a capsule with a ball on top, so
 * the NPC can read at a glance: where they are looking, whether they are
 * carrying something, and whether they have just noticed the cat.
 */
export interface OwnerRig {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly neck: THREE.Group;
  readonly head: THREE.Group;
  readonly armLeft: THREE.Group;
  readonly armRight: THREE.Group;
  readonly forearmLeft: THREE.Group;
  readonly forearmRight: THREE.Group;
  readonly legLeft: THREE.Group;
  readonly legRight: THREE.Group;
  readonly shinLeft: THREE.Group;
  readonly shinRight: THREE.Group;
  readonly alertMark: THREE.Group;
  /** Socket for objects the homeowner is carrying or restoring. */
  readonly handAnchor: THREE.Object3D;
  readonly eyeHeight: number;
}

const HIP_HEIGHT = 1.28;

export function buildOwner(): OwnerRig {
  const shirt = surface(PALETTE.shirt, { roughness: 0.92 });
  const trousers = surface(PALETTE.trousers, { roughness: 0.94 });
  const skin = surface(PALETTE.skin, { roughness: 0.86 });
  const hair = surface(PALETTE.hair, { roughness: 1 });
  const slipper = surface(0x8a5f52, { roughness: 1 });

  const root = new THREE.Group();
  root.name = "homeowner";

  const hips = new THREE.Group();
  hips.name = "hips";
  hips.position.y = HIP_HEIGHT;
  root.add(hips);

  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.14, 6, 12), trousers);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.castShadow = true;
  hips.add(pelvis);

  const torso = new THREE.Group();
  torso.name = "torso";
  torso.position.y = 0.1;
  hips.add(torso);

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.42, 6, 14), shirt);
  chest.position.y = 0.34;
  chest.scale.z = 0.78;
  chest.castShadow = true;
  torso.add(chest);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.09, 12), shirt);
  collar.position.y = 0.63;
  torso.add(collar);

  // Hugs the torso rather than floating in front of it.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.58, 0.14), surface(0xc9b48c, { roughness: 1 }));
  apron.position.set(0, 0.24, 0.16);
  apron.scale.z = 0.9;
  torso.add(apron);
  const apronStrap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.1), surface(0xb9a175, { roughness: 1 }));
  apronStrap.position.set(0, 0.52, 0.17);
  torso.add(apronStrap);

  const neck = new THREE.Group();
  neck.name = "neck";
  neck.position.y = 0.66;
  torso.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 10), skin);
  neckMesh.position.y = 0.05;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 0.14;
  neck.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), skin);
  skull.scale.set(0.94, 1.06, 1);
  skull.position.y = 0.16;
  skull.castShadow = true;
  head.add(skull);

  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.228, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hair,
  );
  hairCap.position.y = 0.17;
  hairCap.scale.set(0.96, 1.08, 1.02);
  head.add(hairCap);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), hair);
  bun.position.set(0, 0.22, -0.2);
  head.add(bun);

  for (const side of [-1, 1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), surface(0x2b2521, { roughness: 0.3 }));
    eye.position.set(side * 0.085, 0.17, 0.195);
    eye.scale.z = 0.5;
    head.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.017, 0.02), hair);
    brow.position.set(side * 0.085, 0.225, 0.2);
    brow.rotation.z = side * 0.14;
    head.add(brow);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), skin);
    ear.scale.set(0.4, 1, 0.7);
    ear.position.set(side * 0.21, 0.15, 0.01);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.075, 6), skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.135, 0.215);
  head.add(nose);

  const arms: THREE.Group[] = [];
  const forearms: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group();
    shoulder.name = side < 0 ? "arm-left" : "arm-right";
    shoulder.position.set(side * 0.31, 0.56, 0);
    torso.add(shoulder);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.083, 0.3, 5, 10), shirt);
    upper.position.y = -0.19;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.name = side < 0 ? "forearm-left" : "forearm-right";
    elbow.position.y = -0.38;
    shoulder.add(elbow);

    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 5, 10), skin);
    lower.position.y = -0.17;
    lower.castShadow = true;
    elbow.add(lower);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), skin);
    hand.scale.set(0.8, 1.1, 0.6);
    hand.position.y = -0.34;
    elbow.add(hand);

    arms.push(shoulder);
    forearms.push(elbow);
  }

  const handAnchor = new THREE.Object3D();
  handAnchor.name = "hand-anchor";
  handAnchor.position.set(0, -0.42, 0.06);
  forearms[1]?.add(handAnchor);

  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.name = side < 0 ? "leg-left" : "leg-right";
    hip.position.set(side * 0.13, -0.06, 0);
    hips.add(hip);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.36, 5, 10), trousers);
    thigh.position.y = -0.24;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.name = side < 0 ? "shin-left" : "shin-right";
    knee.position.y = -0.48;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.44, 5, 10), trousers);
    shin.position.y = -0.315;
    shin.castShadow = true;
    knee.add(shin);

    // Sole sits exactly on y=0 when the rig is at rest: hips 1.28 − hip joint
    // 0.06 − knee 0.48 − 0.685 − half the sole = 0.
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.11, 0.31), slipper);
    foot.position.set(0, -0.685, 0.07);
    foot.castShadow = true;
    knee.add(foot);

    legs.push(hip);
    shins.push(knee);
  }

  const alertMark = new THREE.Group();
  alertMark.name = "alert-mark";
  alertMark.position.set(0, 0.62, 0);
  alertMark.visible = false;
  head.add(alertMark);
  const alertMaterial = surface(0xe0603f, { roughness: 0.4, emissive: 0xe0603f, emissiveIntensity: 0.6 });
  const stroke = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), alertMaterial);
  stroke.position.y = 0.1;
  alertMark.add(stroke);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), alertMaterial);
  dot.position.y = -0.06;
  alertMark.add(dot);

  const armLeft = arms[0];
  const armRight = arms[1];
  const forearmLeft = forearms[0];
  const forearmRight = forearms[1];
  const legLeft = legs[0];
  const legRight = legs[1];
  const shinLeft = shins[0];
  const shinRight = shins[1];
  if (!armLeft || !armRight || !forearmLeft || !forearmRight || !legLeft || !legRight || !shinLeft || !shinRight) {
    throw new Error("Homeowner rig failed to build its limbs.");
  }

  return {
    root, hips, torso, neck, head,
    armLeft, armRight, forearmLeft, forearmRight,
    legLeft, legRight, shinLeft, shinRight,
    alertMark, handAnchor,
    eyeHeight: HIP_HEIGHT + 0.9,
  };
}
