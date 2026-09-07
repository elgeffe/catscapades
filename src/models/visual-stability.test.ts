import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCardboardBox, buildPlanter, buildPottedPlant, buildRug } from "./furniture";
import { surface } from "./materials";

describe("visual depth stability", () => {
  it("keeps translucent surfaces out of the depth buffer by default", () => {
    const opaque = surface(0x102030);
    const translucent = surface(0x203040, { transparent: true, opacity: 0.5 });
    const explicitDepth = surface(0x304050, {
      transparent: true,
      opacity: 0.5,
      depthWrite: true,
    });

    expect(opaque.depthWrite).toBe(true);
    expect(translucent.depthTest).toBe(true);
    expect(translucent.depthWrite).toBe(false);
    expect(explicitDepth.depthWrite).toBe(true);
  });

  it("separates the rug's nested visible faces instead of overlapping slabs", () => {
    const meshes = buildRug(4.2, 3.2).object.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(meshes).toHaveLength(3);

    const verticalBounds = meshes.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      expect(bounds).not.toBeNull();
      return {
        min: mesh.position.y + bounds!.min.y,
        max: mesh.position.y + bounds!.max.y,
      };
    });

    expect(verticalBounds[0]!.max).toBeLessThan(verticalBounds[1]!.min);
    expect(verticalBounds[1]!.max).toBeLessThan(verticalBounds[2]!.min);
  });

  it("keeps the pot vessel, soil, and rim off coplanar top faces", () => {
    const plant = buildPottedPlant().object;
    plant.updateWorldMatrix(true, true);
    const vessel = plant.getObjectByName("pot-vessel");
    const rim = plant.getObjectByName("pot-rim");
    const soil = plant.getObjectByName("pot-soil");
    expect(vessel).toBeInstanceOf(THREE.Mesh);
    expect(rim).toBeInstanceOf(THREE.Mesh);
    expect(soil).toBeInstanceOf(THREE.Mesh);

    const vesselBounds = new THREE.Box3().setFromObject(vessel!);
    const rimBounds = new THREE.Box3().setFromObject(rim!);
    const soilBounds = new THREE.Box3().setFromObject(soil!);
    expect(soilBounds.min.y).toBeGreaterThan(vesselBounds.max.y);
    expect(Math.abs(soilBounds.max.y - rimBounds.max.y)).toBeGreaterThan(0.02);
  });

  it("builds the large planter from disjoint walls, rim rails, and soil", () => {
    const planter = buildPlanter().object;
    planter.updateWorldMatrix(true, true);
    const soil = planter.getObjectByName("planter-soil");
    const walls = planter.children.filter((child) => child.name.startsWith("planter-wall-"));
    const rims = planter.children.filter((child) => child.name.startsWith("planter-rim-"));
    expect(soil).toBeInstanceOf(THREE.Mesh);
    expect(walls).toHaveLength(4);
    expect(rims).toHaveLength(4);

    const soilBounds = new THREE.Box3().setFromObject(soil!);
    const wallTop = Math.max(...walls.map(
      (wall) => new THREE.Box3().setFromObject(wall).max.y,
    ));
    expect(wallTop).toBeLessThan(soilBounds.min.y);

    const sideRimInnerEdge = Math.min(...rims.slice(2).map(
      (rim) => Math.min(
        Math.abs(new THREE.Box3().setFromObject(rim).min.x),
        Math.abs(new THREE.Box3().setFromObject(rim).max.x),
      ),
    ));
    expect(soilBounds.max.x).toBeLessThan(sideRimInnerEdge);
  });

  it("keeps the outdoor sleeping spot low, open, and depth-separated", () => {
    const built = buildCardboardBox();
    const base = built.object.getObjectByName("sleeping-pad-base");
    const blanket = built.object.getObjectByName("sleeping-pad-blanket");
    expect(base).toBeInstanceOf(THREE.Mesh);
    expect(blanket).toBeInstanceOf(THREE.Mesh);
    expect(built.object.children).toHaveLength(2);
    expect(built.colliders).toHaveLength(1);

    const baseBounds = new THREE.Box3().setFromObject(base!);
    const blanketBounds = new THREE.Box3().setFromObject(blanket!);
    expect(baseBounds.max.y).toBeLessThan(blanketBounds.min.y);
  });
});
