import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CatAnimator, NEUTRAL_CAT_ANIMATION } from "../anim/cat-animator";
import { ankleAngleFor } from "../anim/leg-ik";
import { buildCat } from "./cat";
import { buildSinkUnit, SINK_BASIN_GEOMETRY } from "./furniture";
import { inspectAll, inspectClip, inspectModel } from "./inspect";
import { buildOwner } from "./owner";
import { MODEL_REGISTRY } from "./registry";

/**
 * Model-integrity regressions.
 *
 * The model viewer exists so these failures are catchable; this locks the most
 * expensive ones in so they cannot come back silently.
 */
describe("model registry", () => {
  it("has unique ids and a description for every entry", () => {
    const ids = MODEL_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of MODEL_REGISTRY) {
      expect(entry.description.length, entry.id).toBeGreaterThan(10);
    }
  });

  it("builds every model without warnings", () => {
    const offenders = inspectAll()
      .filter((report) => report.warnings.length > 0)
      .map((report) => `${report.id}: ${report.warnings.join("; ")}`);
    expect(offenders).toEqual([]);
  });

  it("returns an independent instance on every build", () => {
    const entry = MODEL_REGISTRY.find((candidate) => candidate.id === "cat");
    expect(entry).toBeDefined();
    const first = entry!.instantiate().object;
    const second = entry!.instantiate().object;
    expect(first).not.toBe(second);
  });
});

describe("sink unit", () => {
  it("leaves a real opening above the basin in both visuals and collision", () => {
    const sink = buildSinkUnit();
    expect(sink.object.getObjectByName("sink-basin")).toBeInstanceOf(THREE.Mesh);
    expect(sink.object.getObjectByName("sink-drain")).toBeInstanceOf(THREE.Mesh);

    const dropPoint = [
      SINK_BASIN_GEOMETRY.centerX,
      SINK_BASIN_GEOMETRY.bottom + 0.21,
      SINK_BASIN_GEOMETRY.centerZ,
    ] as const;
    const blocked = sink.colliders.some((collider) =>
      Math.abs(dropPoint[0] - collider.center[0]) <= collider.half[0]
      && Math.abs(dropPoint[1] - collider.center[1]) <= collider.half[1]
      && Math.abs(dropPoint[2] - collider.center[2]) <= collider.half[2]);
    expect(blocked).toBe(false);
    expect(sink.colliders.some((collider) => collider.label === "sink-basin-bottom")).toBe(true);
  });
});

describe("cat rig", () => {
  const report = inspectModel("cat");

  it("stands on its own origin", () => {
    expect(Math.abs(report.groundOffset)).toBeLessThanOrEqual(0.006);
  });

  it("is sized for the authored house", () => {
    const [width, height, depth] = report.bounds.size;
    expect(width).toBeGreaterThan(0.25);
    expect(width).toBeLessThan(0.55);
    // Ears set the top of the box; shoulder height is well under this.
    expect(height).toBeGreaterThan(0.45);
    expect(height).toBeLessThan(0.8);
    expect(depth).toBeGreaterThan(0.9);
    expect(depth).toBeLessThan(1.6);
  });

  it("exposes the joints other systems drive by name", () => {
    const names = new Set(report.namedNodes.map((node) => node.name));
    for (const required of [
      "cat-body", "pelvis", "spine-lower", "spine-upper", "chest", "neck", "head", "head-skin", "jaw",
      "mouth-anchor", "tail-base", "tail-skin",
      "ear-left", "ear-right", "eye-left", "eye-right", "pupil-left", "pupil-right",
      "eyelid-left", "eyelid-right", "scapula-left", "scapula-right",
      "hind-left-skin", "hind-right-skin", "front-left-skin", "front-right-skin",
      "hind-left-socket", "hind-right-socket", "front-left-socket", "front-right-socket",
      "hind-left-upper", "hind-left-lower", "hind-left-foot", "hind-left-paw",
      "hind-right-upper", "hind-right-lower", "hind-right-foot", "hind-right-paw",
      "front-left-upper", "front-left-lower", "front-left-foot", "front-left-paw",
      "front-right-upper", "front-right-lower", "front-right-foot", "front-right-paw",
    ]) {
      expect(names.has(required), `missing joint "${required}"`).toBe(true);
    }
  });

  it("skins one continuous torso and tail to their anatomical bone chains", () => {
    const rig = buildCat();

    expect(rig.ribcage).toBeInstanceOf(THREE.SkinnedMesh);
    expect(rig.ribcage.geometry.hasAttribute("skinIndex")).toBe(true);
    expect(rig.ribcage.geometry.hasAttribute("skinWeight")).toBe(true);
    expect(rig.ribcage.skeleton.bones.map((bone) => bone.name)).toEqual([
      "pelvis", "spine-lower", "spine-upper", "chest",
    ]);

    expect(rig.tailMesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(rig.tailMesh.geometry.hasAttribute("skinIndex")).toBe(true);
    expect(rig.tailMesh.geometry.hasAttribute("skinWeight")).toBe(true);
    expect(rig.tailMesh.parent).toBe(rig.tailBase);
    expect(rig.tailBase.parent).toBe(rig.pelvis);
    expect(rig.tailMesh.skeleton.bones.map((bone) => bone.name)).toEqual(
      [rig.tailBase, ...rig.tailJoints].map((joint) => joint.name),
    );
  });

  it("skins the neck and head as one seam-free surface over its two-bone chain", () => {
    const rig = buildCat();
    const headSkin = rig.root.getObjectByName("head-skin");

    expect(headSkin).toBeInstanceOf(THREE.SkinnedMesh);
    if (!(headSkin instanceof THREE.SkinnedMesh)) {
      throw new Error("Missing continuous head skin");
    }

    expect(headSkin.parent).toBe(rig.chest);
    expect(headSkin.geometry.hasAttribute("skinIndex")).toBe(true);
    expect(headSkin.geometry.hasAttribute("skinWeight")).toBe(true);
    expect(headSkin.skeleton.bones.map((bone) => bone.name)).toEqual([
      "neck",
      "head",
    ]);
  });

  it("skins each limb continuously from its stationary socket through the foot", () => {
    const rig = buildCat();

    for (const leg of rig.legs) {
      const skin = rig.root.getObjectByName(`${leg.id}-skin`);
      expect(skin, leg.id).toBeInstanceOf(THREE.SkinnedMesh);
      if (!(skin instanceof THREE.SkinnedMesh)) {
        throw new Error(`Missing continuous skin for ${leg.id}`);
      }

      expect(skin.parent, leg.id).toBe(leg.root);
      expect(skin.geometry.hasAttribute("skinIndex"), leg.id).toBe(true);
      expect(skin.geometry.hasAttribute("skinWeight"), leg.id).toBe(true);
      expect(skin.skeleton.bones.map((bone) => bone.name), leg.id).toEqual([
        `${leg.id}-socket`,
        `${leg.id}-upper`,
        `${leg.id}-lower`,
        `${leg.id}-foot`,
      ]);
    }
  });

  it("keeps terminal paws parented to the hocks with level neutral soles", () => {
    const rig = buildCat();

    for (const leg of rig.legs) {
      expect(leg.paw.parent, leg.id).toBe(leg.foot);
      expect(leg.paw.position.y, leg.id).toBeCloseTo(-leg.footLength, 6);
      const sagittalRotation = leg.upper.rotation.x + leg.lower.rotation.x
        + leg.foot.rotation.x + leg.paw.rotation.x;
      expect(sagittalRotation, leg.id).toBeCloseTo(0, 6);
    }
  });

  it("keeps the neutral ankle targets inside a relaxed IK reach budget", () => {
    const rig = buildCat();

    for (const leg of rig.legs) {
      const ankleAngle = ankleAngleFor(leg);
      const localY = leg.restTarget.y - leg.bodyOffset.y
        + leg.footLength * Math.cos(ankleAngle);
      const localZ = leg.restTarget.z - leg.bodyOffset.z
        - leg.footLength * Math.sin(ankleAngle);
      const reachRatio = Math.hypot(localY, localZ) / (leg.upperLength + leg.lowerLength);
      expect(reachRatio, leg.id).toBeLessThan(0.9);
    }
  });

  it("preserves the authored standing height on the first animation tick", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    const initialHeight = rig.body.position.y;

    animator.update(1 / 60, { ...NEUTRAL_CAT_ANIMATION });

    expect(initialHeight).toBe(rig.standHeight);
    expect(Math.abs(rig.body.position.y - initialHeight)).toBeLessThan(0.01);
    expect(rig.body.position.y).toBeGreaterThan(rig.standHeight * 0.95);
  });

  it("dilates the named pupils without scaling the eyeballs", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    const leftEyeScale = rig.eyeLeft.scale.clone();
    const rightEyeScale = rig.eyeRight.scale.clone();
    const initialPupilScale = rig.pupilLeft.scale.x;
    const initialEarPitch = rig.earLeft.rotation.x;

    for (let frame = 0; frame < 60; frame += 1) {
      animator.update(1 / 60, { ...NEUTRAL_CAT_ANIMATION, alert: 1 });
    }

    expect(rig.pupilLeft.scale.x).toBeGreaterThan(initialPupilScale * 1.5);
    expect(rig.pupilRight.scale.x).toBeCloseTo(rig.pupilLeft.scale.x, 6);
    expect(rig.eyeLeft.scale.toArray()).toEqual(leftEyeScale.toArray());
    expect(rig.eyeRight.scale.toArray()).toEqual(rightEyeScale.toArray());
    expect(Math.abs(rig.earLeft.rotation.x - initialEarPitch)).toBeGreaterThan(0.05);
  });

  it("drives joints in every clip without popping", () => {
    for (const clip of report.clips) {
      const analysis = inspectClip("cat", clip, 1.5);
      expect(analysis.movingJoints, `clip "${clip}" animated nothing`).toBeGreaterThan(0);
      expect(analysis.warnings, `clip "${clip}"`).toEqual([]);
    }
  });

  it("moves the legs during locomotion but not while asleep", () => {
    const trot = inspectClip("cat", "trot", 1.5);
    expect(trot.staticJoints).not.toContain("hind-left-lower");
    expect(trot.staticJoints).not.toContain("front-right-lower");
  });
});

describe("homeowner rig", () => {
  it("stands on the floor with its feet, not its shins", () => {
    const report = inspectModel("homeowner");
    expect(Math.abs(report.groundOffset)).toBeLessThanOrEqual(0.03);
    expect(report.bounds.size[1]).toBeGreaterThan(2.2);
  });

  it("clothes the torso in one skinned surface rather than stacked primitives", () => {
    const rig = buildOwner();
    // The shirt spans hem to collar as a single skinned loft. A separate chest
    // shell plus a collar ring is what used to leave a seam at the neck and a
    // hard edge at the waist.
    const shirt = rig.torso.getObjectByName("shirt");
    expect(shirt).toBeInstanceOf(THREE.SkinnedMesh);
    expect((shirt as THREE.SkinnedMesh).skeleton.bones)
      .toEqual([rig.hips, rig.torso, rig.neck]);
    expect(rig.torso.getObjectByName("torso-shell")).toBeUndefined();
    expect(rig.torso.getObjectByName("shirt-collar")).toBeUndefined();

    const torsoMeshes = rig.torso.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(torsoMeshes.some((mesh) => mesh.geometry instanceof THREE.BoxGeometry)).toBe(false);
    expect(torsoMeshes.some((mesh) => mesh.geometry instanceof THREE.CapsuleGeometry)).toBe(false);
  });

  it("keeps the hair crown above the homeowner's eyes", () => {
    const rig = buildOwner();
    const hairCrown = rig.head.getObjectByName("hair-crown");
    expect(hairCrown).toBeInstanceOf(THREE.Mesh);

    const crownBounds = new THREE.Box3().setFromObject(hairCrown!);
    const eyes = ["eye-left", "eye-right"].map((name) => rig.head.getObjectByName(name));
    for (const eye of eyes) {
      expect(eye, "missing named homeowner eye").toBeInstanceOf(THREE.Mesh);
      const eyeBounds = new THREE.Box3().setFromObject(eye!);
      expect(crownBounds.min.y).toBeGreaterThan(eyeBounds.max.y);
    }
  });
});
