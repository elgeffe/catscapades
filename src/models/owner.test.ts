import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildOwner } from "./owner";
import { OwnerAnimator, type OwnerAnimationInput } from "../anim/owner-animator";
import { buildOwnerLoft, buildOwnerShoeGeometry, skinAlong } from "./owner-geometry";

const REST: OwnerAnimationInput = {
  speed: 0, turnRate: 0, alarm: 0, surprise: 0, reaching: 0, carrying: false, lookAt: null,
};

/**
 * World-space vertex positions of a mesh, with skinning applied. A skinned
 * vertex is nowhere near its authored position until the bones are accounted
 * for, so reading the buffer alone would test the wrong thing.
 */
function worldVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  const position = mesh.geometry.getAttribute("position");
  const out: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position as THREE.BufferAttribute, index);
    if (mesh instanceof THREE.SkinnedMesh) mesh.applyBoneTransform(index, vertex);
    out.push(mesh.localToWorld(vertex.clone()));
  }
  return out;
}

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = root.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new Error(`No mesh named ${name}`);
  return found;
}

function restedOwner() {
  const rig = buildOwner();
  const animator = new OwnerAnimator(rig);
  for (let frame = 0; frame < 60; frame += 1) animator.update(1 / 60, REST);
  rig.root.updateMatrixWorld(true);
  return rig;
}

/**
 * A plain, double-sided copy of a mesh in its current posed world position.
 *
 * Raycasts honour `material.side`, and the clothing is `FrontSide`, so casting
 * outward from *inside* a garment misses every triangle — the front faces are
 * pointing away. Rebuilding the posed surface as a double-sided mesh makes the
 * containment check independent of which way the faces happen to be wound,
 * which matters because a reversed winding is itself a bug this file catches.
 */
function posedShell(mesh: THREE.Mesh): THREE.Mesh {
  const vertices = worldVertices(mesh);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const source = mesh.geometry.getIndex();
  if (source) geometry.setIndex(Array.from(source.array));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/**
 * Is `point` inside `shell`?
 *
 * Cast outward from the point, horizontally away from the body's vertical
 * axis. A point inside the surface hits it from within; a point outside cannot
 * hit it going away from it. This is the check that catches a hip poking
 * through a shirt — the exact failure that makes clothing read as separate
 * lumps stuck onto a torso.
 */
function insideSurface(point: THREE.Vector3, shell: THREE.Mesh): boolean {
  const outward = new THREE.Vector3(point.x, 0, point.z);
  if (outward.lengthSq() < 1e-8) return true;
  outward.normalize();
  const raycaster = new THREE.Raycaster(point, outward, 0, 1);
  return raycaster.intersectObject(shell, false).length > 0;
}

describe("homeowner clothing surfaces", () => {
  it("keeps every trouser and seat vertex inside the shirt where they overlap", () => {
    const rig = restedOwner();
    const shirt = findMesh(rig.root, "shirt");
    const shirtVertices = worldVertices(shirt);
    const shell = posedShell(shirt);
    const hem = Math.min(...shirtVertices.map((vertex) => vertex.y));
    const collar = Math.max(...shirtVertices.map((vertex) => vertex.y));
    expect(hem).toBeLessThan(rig.hipHeight);

    for (const name of ["trouser-left", "trouser-right"]) {
      const mesh = findMesh(rig.root, name);
      const escaped = worldVertices(mesh).filter((vertex) => (
        // Only the overlap matters. Below the hem the trousers are on show,
        // and there is nothing above the collar.
        vertex.y > hem + 0.012 && vertex.y < collar && !insideSurface(vertex, shell)
      ));
      expect(escaped.map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`))
        .toEqual([]);
    }
  });

  it("closes the crotch by overlapping the trouser legs on the centre line", () => {
    const rig = restedOwner();
    const left = worldVertices(findMesh(rig.root, "trouser-left"));
    const right = worldVertices(findMesh(rig.root, "trouser-right"));
    const seatHeight = Math.max(...left.map((vertex) => vertex.y)) - 0.04;

    // Each leg must reach across the centre line near the top, or the pair
    // leave a slot between the thighs that a separate pelvis surface used to
    // have to plug — the surface that creased across the hip.
    expect(left.filter((vertex) => vertex.y > seatHeight && vertex.x > 0).length)
      .toBeGreaterThan(0);
    expect(right.filter((vertex) => vertex.y > seatHeight && vertex.x < 0).length)
      .toBeGreaterThan(0);
    // …and must not cross so far that a leg appears on the wrong side.
    expect(Math.max(...left.map((vertex) => vertex.x))).toBeLessThan(0.03);
    expect(Math.min(...right.map((vertex) => vertex.x))).toBeGreaterThan(-0.03);
  });

  it("keeps each sleeve inside the shirt's shoulder cap", () => {
    const rig = restedOwner();
    const shirt = findMesh(rig.root, "shirt");
    const shell = posedShell(shirt);
    const shoulderTop = Math.max(...worldVertices(shirt).map((vertex) => vertex.y)) - 0.12;

    for (const name of ["sleeve-left", "sleeve-right"]) {
      const sleeve = findMesh(rig.root, name);
      const escaped = worldVertices(sleeve).filter((vertex) => (
        // Only the buried top of the sleeve; the rest of the arm is on show.
        vertex.y > shoulderTop && !insideSurface(vertex, shell)
      ));
      expect(escaped.map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`))
        .toEqual([]);
    }
  });

  it("stands on its own origin with the legs closing the height exactly", () => {
    const rig = restedOwner();
    const geometry = rig.legGeometry;
    expect(
      rig.hipHeight + geometry.hipDrop - geometry.thighLength
      - geometry.shinLength - geometry.ankleHeight,
    ).toBeCloseTo(0, 6);

    for (const name of ["shoe-left", "shoe-right"]) {
      const sole = Math.min(...worldVertices(findMesh(rig.root, name)).map((vertex) => vertex.y));
      expect(sole, name).toBeCloseTo(0, 3);
    }
  });

  it("hangs the hands clear of the hips rather than through them", () => {
    const rig = restedOwner();
    const spacing = rig.legGeometry.hipSpacing;
    for (const [name, side] of [["hand-left", -1], ["hand-right", 1]] as const) {
      const vertices = worldVertices(findMesh(rig.root, name));
      const inner = Math.min(...vertices.map((vertex) => Math.abs(vertex.x)));
      // Clear of the thigh's outer surface, which sits around 0.23 out.
      expect(inner, name).toBeGreaterThan(spacing + 0.08);
      expect(Math.sign(vertices[0]!.x), name).toBe(side);
    }
  });
});

describe("skinAlong", () => {
  it("follows the nearest bone past either end of the range", () => {
    const sampler = skinAlong([{ at: 0, index: 5 }, { at: 1, index: 7 }]);
    /** How much of the sample at `at` is carried by bone `index`. */
    const weightOf = (at: number, index: number): number => {
      const sample = sampler(at);
      return sample.indices.reduce(
        (total, bone, slot) => (bone === index ? total + sample.weights[slot]! : total), 0,
      );
    };

    // Below the lowest bone and above the highest, weight fully to that bone.
    // Reversing these sends the top of a surface to the bottom bone, which is
    // how the trouser seat ended up chasing the foot.
    expect(weightOf(-2, 5)).toBeCloseTo(1);
    expect(weightOf(0, 5)).toBeCloseTo(1);
    expect(weightOf(1, 7)).toBeCloseTo(1);
    expect(weightOf(3, 7)).toBeCloseTo(1);
    expect(weightOf(3, 5)).toBeCloseTo(0);
  });

  it("blends the pair spanning the sample, eased towards the joint", () => {
    const sampler = skinAlong([{ at: 0, index: 0 }, { at: 1, index: 1 }]);
    const middle = sampler(0.5);
    expect(middle.indices).toEqual([0, 1, 0, 0]);
    expect(middle.weights[0]).toBeCloseTo(0.5);
    expect(middle.weights[1]).toBeCloseTo(0.5);
    // Eased, so the crossover sits at the joint rather than smearing evenly.
    expect(sampler(0.25).weights[1]).toBeLessThan(0.25);
    expect(sampler(0.75).weights[1]).toBeGreaterThan(0.75);
    for (const at of [0.1, 0.4, 0.6, 0.9]) {
      const sample = sampler(at);
      expect(sample.weights.reduce((total, weight) => total + weight, 0)).toBeCloseTo(1);
    }
  });

  it("accepts bones in any order", () => {
    const sampler = skinAlong([{ at: 1, index: 1 }, { at: 0, index: 0 }]);
    expect(sampler(0.5).indices).toEqual([0, 1, 0, 0]);
  });
});

describe("owner loft winding", () => {
  it("points every side face outwards, away from the loft axis", () => {
    // Reversing the winding does not throw: back-face culling then shows the
    // far side's interior through the near surface, so the figure reads as
    // faintly transparent and its lighting is inverted. Assert the direction.
    const geometry = buildOwnerLoft([
      { at: 0, halfWidth: 0.3, halfDepth: 0.2 },
      { at: 0.5, halfWidth: 0.35, halfDepth: 0.25 },
      { at: 1, halfWidth: 0.2, halfDepth: 0.15 },
    ], { radialSegments: 12, capStart: false, capEnd: false });

    const position = geometry.getAttribute("position");
    const index = geometry.getIndex()!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const outward = new THREE.Vector3();

    let checked = 0;
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      a.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle));
      b.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle + 1));
      c.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle + 2));
      normal.copy(edge1.subVectors(b, a)).cross(edge2.subVectors(c, a));
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      // Away from the Y axis, which the loft is built around.
      outward.set(centroid.x, 0, centroid.z);
      if (outward.lengthSq() < 1e-8) continue;
      expect(normal.dot(outward), `triangle ${triangle / 3} faces inwards`)
        .toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("gives the built homeowner outward normals on its clothing", () => {
    const rig = buildOwner();
    for (const name of ["shirt", "sleeve-left", "trouser-right"]) {
      const mesh = findMesh(rig.root, name);
      const normals = mesh.geometry.getAttribute("normal");
      const position = mesh.geometry.getAttribute("position");
      expect(normals, name).toBeDefined();

      let outwardCount = 0;
      let sampled = 0;
      const point = new THREE.Vector3();
      const normal = new THREE.Vector3();
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        point.fromBufferAttribute(position as THREE.BufferAttribute, vertex);
        normal.fromBufferAttribute(normals as THREE.BufferAttribute, vertex);
        // Skip the axis itself: cap centres have no meaningful outward.
        if (Math.hypot(point.x, point.z) < 0.02) continue;
        sampled += 1;
        if (normal.x * point.x + normal.z * point.z > 0) outwardCount += 1;
      }
      expect(sampled, name).toBeGreaterThan(20);
      // Overwhelmingly outward: a few vertices near a waist or a cap seam can
      // legitimately tip the other way once normals are smoothed.
      expect(outwardCount / sampled, `${name} is lit inside out`).toBeGreaterThan(0.9);
    }
  });
});

describe("homeowner face", () => {
  it("puts every feature proud of the head rather than inside it", () => {
    const rig = buildOwner();
    rig.root.updateMatrixWorld(true);
    const skull = findMesh(rig.head, "skull");
    const raycaster = new THREE.Raycaster();

    /** What you actually see looking straight at a point on the face. */
    const firstHit = (x: number, y: number, feature: THREE.Mesh): THREE.Object3D | undefined => {
      const from = rig.head.localToWorld(new THREE.Vector3(x, y, 1));
      const to = rig.head.localToWorld(new THREE.Vector3(x, y, 0));
      raycaster.set(from, to.sub(from).normalize());
      return raycaster.intersectObjects([feature, skull], false)[0]?.object;
    };

    // The features were only ever visible because the head's own faces were
    // wound inside out, so you could see through them. With the winding fixed
    // they have to actually stand out from the surface.
    for (const [name, x, y] of [
      ["eye-left", -0.052, 0.173],
      ["eye-right", 0.052, 0.173],
      ["eyebrow-left", -0.054, 0.212],
      ["eyebrow-right", 0.054, 0.212],
      ["nose", 0, 0.152],
      ["mouth", 0, 0.084],
    ] as const) {
      const feature = findMesh(rig.head, name);
      expect(firstHit(x, y, feature)?.name, `${name} is buried inside the head`)
        .toBe(name);
    }
  });

  it("keeps the hairline above the eyebrows", () => {
    const rig = buildOwner();
    const hair = new THREE.Box3().setFromObject(findMesh(rig.head, "hair-crown"));
    const brow = new THREE.Box3().setFromObject(findMesh(rig.head, "eyebrow-left"));
    expect(hair.min.y).toBeGreaterThan(brow.max.y);
  });

  it("leaves no invisible face geometry behind", () => {
    const rig = buildOwner();
    // The recessed eye sockets cost 280 triangles and could never be seen.
    expect(rig.head.getObjectByName("eye-socket-left")).toBeUndefined();
    expect(rig.head.getObjectByName("eye-socket-right")).toBeUndefined();
  });
});

describe("shoe winding", () => {
  it("points its sides and both caps outwards", () => {
    // The shoe has its own hand-wound profile rather than going through
    // `buildOwnerLoft`, so it needs its own check: it was inside out too.
    const geometry = buildOwnerShoeGeometry();
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex()!;
    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
    const middle = box.getCenter(new THREE.Vector3());

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    let outward = 0;
    let total = 0;

    for (let triangle = 0; triangle < index.count; triangle += 3) {
      a.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle));
      b.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle + 1));
      c.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(triangle + 2));
      normal.copy(b).sub(a).cross(c.clone().sub(a));
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(middle);
      if (centroid.lengthSq() < 1e-8) continue;
      total += 1;
      if (normal.dot(centroid) > 0) outward += 1;
    }
    expect(total).toBeGreaterThan(40);
    // A convex-ish shell: essentially every face should point away from the
    // interior. The sole's own flat underside is the only ambiguous case.
    expect(outward / total).toBeGreaterThan(0.9);
  });

  it("still sits exactly on its own origin after the rewind", () => {
    const geometry = buildOwnerShoeGeometry();
    const box = new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute("position") as THREE.BufferAttribute,
    );
    expect(box.min.y).toBeCloseTo(0, 5);
  });
});
