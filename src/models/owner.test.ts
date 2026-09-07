import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildOwner } from "./owner";
import { OwnerAnimator, type OwnerAnimationInput } from "../anim/owner-animator";

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
 * Is `point` inside `surface`?
 *
 * Cast outward from the point, horizontally away from the body's vertical
 * axis. A point inside the surface hits it from within; a point outside cannot
 * hit it going away from it. This is the check that catches a hip poking
 * through a shirt — the exact failure that makes clothing read as separate
 * lumps stuck onto a torso.
 */
function insideSurface(point: THREE.Vector3, surface: THREE.Mesh): boolean {
  const outward = new THREE.Vector3(point.x, 0, point.z);
  if (outward.lengthSq() < 1e-8) return true;
  outward.normalize();
  const raycaster = new THREE.Raycaster(point, outward, 0, 1);
  raycaster.firstHitOnly = false;
  return raycaster.intersectObject(surface, false).length > 0;
}

describe("homeowner clothing surfaces", () => {
  it("keeps every trouser and seat vertex inside the shirt where they overlap", () => {
    const rig = restedOwner();
    const shirt = findMesh(rig.root, "shirt");
    const shirtVertices = worldVertices(shirt);
    const hem = Math.min(...shirtVertices.map((vertex) => vertex.y));
    const collar = Math.max(...shirtVertices.map((vertex) => vertex.y));
    expect(hem).toBeLessThan(rig.hipHeight);

    for (const name of ["trouser-left", "trouser-right"]) {
      const mesh = findMesh(rig.root, name);
      const escaped = worldVertices(mesh).filter((vertex) => (
        // Only the overlap matters. Below the hem the trousers are on show,
        // and there is nothing above the collar.
        vertex.y > hem + 0.012 && vertex.y < collar && !insideSurface(vertex, shirt)
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
    const shoulderTop = Math.max(...worldVertices(shirt).map((vertex) => vertex.y)) - 0.12;

    for (const name of ["sleeve-left", "sleeve-right"]) {
      const sleeve = findMesh(rig.root, name);
      const escaped = worldVertices(sleeve).filter((vertex) => (
        // Only the buried top of the sleeve; the rest of the arm is on show.
        vertex.y > shoulderTop && !insideSurface(vertex, shirt)
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
