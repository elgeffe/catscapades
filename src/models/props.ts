import * as THREE from "three";
import { PALETTE, surface } from "./materials";
import type { BuiltModel } from "./furniture";
import type { DynamicShape } from "../physics/physics-world";

/**
 * Small props: everything the cat can swipe, carry, knock over, or sit in.
 *
 * Each builder reports the collision shape Rapier should simulate it with, so
 * a mug tumbles like a mug and a sock flops like a sock without per-object
 * special cases in the game loop.
 */

export interface BuiltProp extends BuiltModel {
  /** Physics proxy for this prop. */
  readonly shape: DynamicShape;
  readonly mass: number;
  /** Distance from the model origin to its resting contact point. */
  readonly restOffset: number;
}

export function buildMug(color = PALETTE.ceramicRed): BuiltProp {
  const group = new THREE.Group();
  group.name = "mug";
  const ceramic = surface(color, { roughness: 0.36 });
  const inside = surface(PALETTE.ceramicCream, { roughness: 0.42 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.135, 0.32, 18, 1, true), ceramic);
  body.castShadow = true;
  group.add(body);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 18), ceramic);
  base.position.y = -0.145;
  group.add(base);
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 18), surface(0x6b452c, { roughness: 0.2 }));
  liquid.position.y = 0.08;
  group.add(liquid);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 6, 18), inside);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.16;
  group.add(lip);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.026, 7, 14, Math.PI * 1.35), ceramic);
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = -Math.PI * 0.32;
  handle.position.set(0.15, 0.01, 0);
  handle.castShadow = true;
  group.add(handle);

  return {
    object: group,
    colliders: [],
    shape: { kind: "cylinder", radius: 0.155, halfHeight: 0.17 },
    mass: 0.32,
    restOffset: 0.17,
  };
}

/** Broken-mug replacement: shards laid out where the mug landed. */
export function buildMugShards(color = PALETTE.ceramicRed): BuiltModel {
  const group = new THREE.Group();
  group.name = "mug-shards";
  const ceramic = surface(color, { roughness: 0.4 });
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2 + 0.4;
    const radius = 0.14 + (index % 3) * 0.09;
    const shard = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.06 + (index % 4) * 0.017, 0),
      ceramic,
    );
    shard.position.set(Math.cos(angle) * radius, 0.03, Math.sin(angle) * radius);
    shard.rotation.set(index * 0.7, index * 1.3, index * 0.5);
    shard.castShadow = true;
    group.add(shard);
  }
  const spill = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 18),
    surface(0x6b452c, { roughness: 0.24, transparent: true, opacity: 0.72 }),
  );
  spill.rotation.x = -Math.PI / 2;
  spill.position.y = 0.008;
  group.add(spill);
  return { object: group, colliders: [] };
}

export function buildFruitBowl(): BuiltProp {
  const group = new THREE.Group();
  group.name = "fruit-bowl";
  const ceramic = surface(PALETTE.ceramicCream, { roughness: 0.34 });

  const bowl = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
    surface(PALETTE.ceramicCream, { roughness: 0.34, side: THREE.DoubleSide }),
  );
  bowl.position.y = 0.16;
  bowl.castShadow = true;
  group.add(bowl);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.06, 14), ceramic);
  foot.position.y = -0.02;
  group.add(foot);

  for (const [x, z, color, radius] of [
    [-0.13, -0.05, 0xc3452f, 0.11], [0.12, -0.09, 0xd9a13c, 0.1],
    [0.02, 0.13, 0x8fa63f, 0.105], [-0.02, -0.02, 0xd0762f, 0.1],
  ] as const) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), surface(color, { roughness: 0.62 }));
    fruit.position.set(x, 0.22, z);
    fruit.castShadow = true;
    group.add(fruit);
  }

  return {
    object: group,
    colliders: [],
    shape: { kind: "cylinder", radius: 0.4, halfHeight: 0.16 },
    mass: 0.65,
    restOffset: 0.08,
  };
}

export function buildKey(): BuiltProp {
  const group = new THREE.Group();
  group.name = "key";
  const brass = surface(PALETTE.brass, { roughness: 0.3, metalness: 0.72 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 18), brass);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  group.add(ring);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.19), brass);
  stem.position.z = -0.13;
  group.add(stem);
  for (const [x, z, w] of [[0.03, -0.2, 0.05], [0.026, -0.16, 0.04]] as const) {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.028), brass).translateX(x).translateZ(z));
  }
  const fob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.12), surface(0xc4553f, { roughness: 0.62 }));
  fob.position.z = 0.13;
  group.add(fob);

  return {
    object: group,
    colliders: [],
    shape: { kind: "box", halfExtents: [0.07, 0.028, 0.17] },
    mass: 0.06,
    restOffset: 0.028,
  };
}

export function buildSock(): BuiltProp {
  const group = new THREE.Group();
  group.name = "sock";
  const wool = surface(0x8c5f87, { roughness: 1 });
  const stripe = surface(0xe0d4b8, { roughness: 1 });
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.22, 5, 10), wool);
  leg.rotation.z = Math.PI / 2;
  leg.castShadow = true;
  group.add(leg);
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.12, 5, 10), wool);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(-0.17, -0.02, 0.07);
  foot.castShadow = true;
  group.add(foot);
  for (const x of [0.05, 0.11] as const) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.03, 12), stripe);
    band.rotation.z = Math.PI / 2;
    band.position.x = x;
    group.add(band);
  }
  return {
    object: group,
    colliders: [],
    shape: { kind: "capsule", radius: 0.075, halfHeight: 0.13 },
    mass: 0.05,
    restOffset: 0.075,
  };
}

export function buildSponge(): BuiltProp {
  const group = new THREE.Group();
  group.name = "sponge";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.09, 0.17),
    surface(0xe5c449, { roughness: 1 }),
  );
  body.castShadow = true;
  group.add(body);
  const scour = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.035, 0.17),
    surface(0x3f6b58, { roughness: 1 }),
  );
  scour.position.y = 0.062;
  group.add(scour);
  return {
    object: group,
    colliders: [],
    shape: { kind: "box", halfExtents: [0.13, 0.06, 0.085] },
    mass: 0.04,
    restOffset: 0.06,
  };
}

export function buildSausage(): BuiltProp {
  const group = new THREE.Group();
  group.name = "sausage";
  const meat = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.19, 6, 12), surface(0x9e5038, { roughness: 0.62 }));
  meat.rotation.z = Math.PI / 2;
  meat.castShadow = true;
  group.add(meat);
  return {
    object: group,
    colliders: [],
    shape: { kind: "capsule", radius: 0.06, halfHeight: 0.095 },
    mass: 0.07,
    restOffset: 0.06,
  };
}

export function buildMouseToy(): BuiltProp {
  const group = new THREE.Group();
  group.name = "mouse-toy";
  const felt = surface(0x8b9aa1, { roughness: 1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), felt);
  body.scale.set(1, 0.86, 1.5);
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 8), felt);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.16;
  group.add(nose);
  for (const side of [-1, 1] as const) {
    const ear = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), surface(PALETTE.nose, { roughness: 0.9, side: THREE.DoubleSide }));
    ear.position.set(side * 0.055, 0.06, 0.03);
    ear.rotation.y = side * 0.6;
    group.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.24, 5), surface(0xc9b79a, { roughness: 1 }));
  tail.rotation.x = Math.PI / 2.3;
  tail.position.set(0, 0.03, -0.2);
  group.add(tail);
  return {
    object: group,
    colliders: [],
    shape: { kind: "ball", radius: 0.09 },
    mass: 0.03,
    restOffset: 0.09,
  };
}

/** Flour bag with a punctured variant driven by a named child. */
export function buildFlourBag(): BuiltModel {
  const group = new THREE.Group();
  group.name = "flour-bag";
  const paper = surface(PALETTE.flour, { roughness: 1 });
  const printed = surface(0xb8c3d2, { roughness: 1 });

  const sack = new THREE.Group();
  sack.name = "sack";
  group.add(sack);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.66, 0.3), paper);
  body.position.y = 0.33;
  body.castShadow = true;
  sack.add(body);
  const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.14), paper);
  gusset.position.y = 0.68;
  gusset.rotation.z = 0.1;
  sack.add(gusset);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.01), printed);
  label.position.set(0, 0.36, 0.156);
  sack.add(label);

  const spill = new THREE.Group();
  spill.name = "flour-spill";
  spill.visible = false;
  group.add(spill);
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    const radius = 0.28 + (index % 4) * 0.16;
    const pile = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 + (index % 3) * 0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      paper,
    );
    pile.scale.y = 0.22 + (index % 3) * 0.06;
    pile.position.set(Math.cos(angle) * radius, 0.005, Math.sin(angle) * radius);
    spill.add(pile);
  }
  const cloud = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 10),
    surface(PALETTE.flour, { roughness: 1, transparent: true, opacity: 0.3 }),
  );
  cloud.name = "flour-cloud";
  cloud.position.y = 0.4;
  cloud.visible = false;
  group.add(cloud);

  return {
    object: group,
    colliders: [{ center: [0, 0.33, 0], half: [0.22, 0.33, 0.15] }],
    parts: { sack, spill, cloud },
  };
}

/** Puddle that grows as the sink overflows. Scale X/Z to spread it. */
export function buildPuddle(): BuiltModel {
  const group = new THREE.Group();
  group.name = "puddle";
  const water = surface(PALETTE.water, {
    roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.55, emissive: 0x1b5568, emissiveIntensity: 0.2,
  });
  for (const [x, z, radius] of [[0, 0, 1], [0.62, 0.3, 0.66], [-0.5, 0.42, 0.58], [0.2, -0.55, 0.5]] as const) {
    const blob = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), water);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(x, 0.012, z);
    group.add(blob);
  }
  return { object: group, colliders: [] };
}

export function buildCatBowl(): BuiltModel {
  const group = new THREE.Group();
  group.name = "cat-bowl";
  const ceramic = surface(0x6f97a8, { roughness: 0.4 });
  const bowl = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45),
    surface(0x6f97a8, { roughness: 0.4, side: THREE.DoubleSide }),
  );
  bowl.position.y = 0.1;
  bowl.castShadow = true;
  group.add(bowl);
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.04, 14), ceramic).translateY(0.02));
  const kibble = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.04, 14), surface(0x8a6440, { roughness: 1 }));
  kibble.position.y = 0.08;
  group.add(kibble);
  return { object: group, colliders: [] };
}

export function buildBook(color = 0x6b7f5a): BuiltProp {
  const group = new THREE.Group();
  group.name = "book";
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.4), surface(color, { roughness: 0.86 }));
  cover.castShadow = true;
  group.add(cover);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.045, 0.375), surface(0xefe6d0, { roughness: 1 }));
  pages.position.y = 0.004;
  group.add(pages);
  return {
    object: group,
    colliders: [],
    shape: { kind: "box", halfExtents: [0.15, 0.03, 0.2] },
    mass: 0.18,
    restOffset: 0.03,
  };
}

export function buildKettle(): BuiltProp {
  const group = new THREE.Group();
  group.name = "kettle";
  const steel = surface(0xb9bfc2, { roughness: 0.28, metalness: 0.6 });
  const dark = surface(0x33383b, { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.42, 16), steel);
  body.position.y = 0.21;
  body.castShadow = true;
  group.add(body);
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), dark).translateY(0.44));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 6, 12, Math.PI), dark);
  handle.position.set(-0.16, 0.3, 0);
  handle.rotation.y = Math.PI / 2;
  group.add(handle);
  const spout = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), steel);
  spout.position.set(0.19, 0.32, 0);
  spout.rotation.z = -0.9;
  group.add(spout);
  return {
    object: group,
    colliders: [],
    shape: { kind: "cylinder", radius: 0.2, halfHeight: 0.23 },
    mass: 0.5,
    restOffset: 0.23,
  };
}

export function buildLaundryBasket(): BuiltModel {
  const group = new THREE.Group();
  group.name = "laundry-basket";
  const wicker = surface(0xc2a271, { roughness: 1 });
  for (let index = 0; index < 5; index += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44 + index * 0.014, 0.03, 6, 18), wicker);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08 + index * 0.14;
    ring.castShadow = true;
    group.add(ring);
  }
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.42, 0.62, 18, 1, true), wicker).translateY(0.36));
  const laundry = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), surface(0x9aa8bd, { roughness: 1 }));
  laundry.scale.y = 0.5;
  laundry.position.y = 0.62;
  group.add(laundry);
  return {
    object: group,
    colliders: [{ center: [0, 0.34, 0], half: [0.42, 0.34, 0.42] }],
  };
}
