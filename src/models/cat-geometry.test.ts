import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CatAnimator, NEUTRAL_CAT_ANIMATION } from "../anim/cat-animator";
import { buildCat } from "./cat";
import { findModel } from "./registry";

function catSkins(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const skins: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skins.push(object);
  });
  return skins;
}

describe("cat skin geometry", () => {
  it("slides the eyelids down the eye plane to cover the pupils when asleep", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    const eyes = [
      { eye: rig.eyeLeft, pupil: rig.pupilLeft, lid: rig.eyelidLeft },
      { eye: rig.eyeRight, pupil: rig.pupilRight, lid: rig.eyelidRight },
    ];
    const raycaster = new THREE.Raycaster();
    const normal = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();

    const firstVisibleAtPupil = (
      eye: THREE.Mesh,
      pupil: THREE.Mesh,
      lid: THREE.Mesh,
      height: number,
    ): THREE.Object3D | undefined => {
      pupil.geometry.computeBoundingBox();
      const pupilTop = pupil.geometry.boundingBox!.max.y;
      // Look straight into the tilted cornea at the centre and either end of
      // the pupil. Test actual triangle occlusion, not just overlapping boxes.
      origin.set(0, pupilTop * height, 0);
      pupil.localToWorld(origin);
      normal.set(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(rotation));
      origin.addScaledVector(normal, 0.1);
      raycaster.set(origin, direction.copy(normal).negate());
      return raycaster.intersectObjects([pupil, lid], false)[0]?.object;
    };

    animator.update(1 / 60, { ...NEUTRAL_CAT_ANIMATION });
    rig.root.updateMatrixWorld(true);
    const openPositions = eyes.map(({ eye, pupil, lid }) => {
      const position = eye.worldToLocal(lid.getWorldPosition(new THREE.Vector3()));
      expect(position.y, lid.name).toBeGreaterThan(0);
      expect(firstVisibleAtPupil(eye, pupil, lid, 0), lid.name).toBe(pupil);
      return position;
    });

    for (let frame = 0; frame < 180; frame += 1) {
      animator.update(1 / 60, { ...NEUTRAL_CAT_ANIMATION, sleeping: 1 });
    }
    rig.root.updateMatrixWorld(true);
    eyes.forEach(({ eye, pupil, lid }, index) => {
      const position = eye.worldToLocal(lid.getWorldPosition(new THREE.Vector3()));
      const open = openPositions[index]!;
      expect(Math.abs(position.y), lid.name).toBeLessThan(open.y * 0.1);
      expect(position.x, lid.name).toBeCloseTo(open.x, 5);
      expect(position.z, lid.name).toBeCloseTo(open.z, 5);
      for (const height of [-0.65, 0, 0.65]) {
        expect(firstVisibleAtPupil(eye, pupil, lid, height), `${lid.name} at ${height}`).toBe(lid);
      }
    });
  });

  it("winds every closed skin outward, including the tail's reversed loft direction", () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (const skin of catSkins(buildCat().root)) {
      const positions = skin.geometry.getAttribute("position");
      const indices = skin.geometry.getIndex();
      expect(indices, skin.name).not.toBeNull();
      let signedVolume = 0;
      for (let index = 0; index < indices!.count; index += 3) {
        a.fromBufferAttribute(positions, indices!.getX(index));
        b.fromBufferAttribute(positions, indices!.getX(index + 1));
        c.fromBufferAttribute(positions, indices!.getX(index + 2));
        signedVolume += a.dot(cross.crossVectors(b, c)) / 6;
      }

      // A closed surface has positive signed volume when its visible faces
      // point outward. Reversing a loft's axis must also reverse its winding.
      expect(signedVolume, skin.name).toBeGreaterThan(0);
    }
  });

  it("gives every skin vertex finite unit normals and normalized valid bone weights", () => {
    const normal = new THREE.Vector3();

    for (const skin of catSkins(buildCat().root)) {
      const positions = skin.geometry.getAttribute("position");
      const normals = skin.geometry.getAttribute("normal");
      const weights = skin.geometry.getAttribute("skinWeight");
      const bones = skin.geometry.getAttribute("skinIndex");
      expect(normals.count, skin.name).toBe(positions.count);
      expect(weights.count, skin.name).toBe(positions.count);
      expect(bones.count, skin.name).toBe(positions.count);

      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const label = `${skin.name} vertex ${vertex}`;
        normal.fromBufferAttribute(normals, vertex);
        expect(normal.length(), label).toBeCloseTo(1, 5);
        let totalWeight = 0;
        for (let slot = 0; slot < 4; slot += 1) {
          const weight = weights.getComponent(vertex, slot);
          const bone = bones.getComponent(vertex, slot);
          expect(Number.isFinite(weight), label).toBe(true);
          expect(weight, label).toBeGreaterThanOrEqual(0);
          expect(weight, label).toBeLessThanOrEqual(1);
          expect(Number.isInteger(bone), label).toBe(true);
          expect(bone, label).toBeGreaterThanOrEqual(0);
          expect(bone, label).toBeLessThan(skin.skeleton.bones.length);
          totalWeight += weight;
        }
        expect(totalWeight, label).toBeCloseTo(1, 6);
      }
    }
  });

  it.each(["trot", "stalk", "jump", "sit"])(
    "keeps the distal limb caps inside the terminal paw bounds during %s",
    (clip) => {
      const instance = findModel("cat")!.instantiate();
      const legs = catSkins(instance.object).filter((skin) => /^(front|hind)-/.test(skin.name));
      instance.driver!.setClip(clip);

      const attachments = legs.map((skin) => {
        const paw = instance.object.getObjectByName(skin.name.replace(/-skin$/, "-paw"))!;
        const pawMesh = paw.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)!;
        pawMesh.geometry.computeBoundingBox();
        const positions = skin.geometry.getAttribute("position");
        let lowest = Infinity;
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
          lowest = Math.min(lowest, positions.getY(vertex));
        }
        // The distal cap is the lowest cross-section in the straight bind
        // pose. Its centre must remain enclosed by the separately driven paw.
        const capVertices: number[] = [];
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
          if (Math.abs(positions.getY(vertex) - lowest) < 1e-6) capVertices.push(vertex);
        }
        return { skin, pawMesh, capVertices };
      });

      const position = new THREE.Vector3();
      const capCentre = new THREE.Vector3();
      for (let frame = 0; frame < 120; frame += 1) {
        instance.driver!.update(1 / 60);
        if (frame % 6 !== 0) continue;
        instance.object.updateMatrixWorld(true);
        for (const { skin, pawMesh, capVertices } of attachments) {
          capCentre.set(0, 0, 0);
          for (const vertex of capVertices) {
            skin.getVertexPosition(vertex, position);
            capCentre.add(position);
          }
          capCentre.divideScalar(capVertices.length);
          skin.localToWorld(capCentre);
          pawMesh.worldToLocal(capCentre);
          expect(
            pawMesh.geometry.boundingBox!.containsPoint(capCentre),
            `${skin.name} frame ${frame}: ${capCentre.toArray().join(", ")}`,
          ).toBe(true);
        }
      }
    },
  );
});
