import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NEUTRAL_OWNER_ANIMATION, OwnerAnimator, type OwnerAnimationInput } from "./owner-animator";
import { buildOwner, type OwnerRig } from "../models/owner";

const STEP = 1 / 60;

/** Heel and toe of one shoe, in world space. */
interface Sole {
  readonly heel: THREE.Vector3;
  readonly toe: THREE.Vector3;
}

interface Walk {
  readonly rig: OwnerRig;
  readonly animator: OwnerAnimator;
  /** Both soles per simulated frame, left then right. */
  readonly samples: Sole[][];
}

/** Authored heel and toe positions in the shoe's own space. */
const HEEL = new THREE.Vector3(0, 0, -0.085);
const TOE = new THREE.Vector3(0, 0, 0.182);

/**
 * Drives the animator the way the game does — the root advances by the same
 * travel the animation is told about — and records where each sole actually
 * ended up. A foot riding along with the hips shows up immediately.
 */
function walk(frames: number, input: Partial<OwnerAnimationInput>, options: {
  readonly grip?: number;
} = {}): Walk {
  const rig = buildOwner();
  const animator = new OwnerAnimator(rig);
  const grip = options.grip ?? 1;
  const state: OwnerAnimationInput = { ...NEUTRAL_OWNER_ANIMATION, ...input };
  const samples: Sole[][] = [];
  let facing = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const travel = state.speed * STEP * grip;
    facing += state.turnRate * STEP;
    rig.root.rotation.y = facing;
    rig.root.position.x += Math.sin(facing) * travel;
    rig.root.position.z += Math.cos(facing) * travel;
    animator.update(STEP, { ...state, travel });
    rig.root.updateMatrixWorld(true);
    samples.push(["shoe-left", "shoe-right"].map((name) => {
      const shoe = rig.root.getObjectByName(name)!;
      return {
        heel: shoe.localToWorld(HEEL.clone()),
        toe: shoe.localToWorld(TOE.clone()),
      };
    }));
  }
  return { rig, animator, samples };
}

/**
 * Worst ground speed of a named point on each sole, over the frames where that
 * point was already resting on the floor.
 *
 * Heel and toe have to be measured separately: a foot rolling heel-to-toe
 * moves its own centre by design, so measuring the shoe as a whole reports a
 * quarter of the body speed as "slide" for a foot that is perfectly planted.
 * What actually matters is that whichever part is bearing weight stays put.
 */
function plantedSlide(result: Walk, part: keyof Sole, floorTolerance = 0.012): number[] {
  const worst = [0, 0];
  for (let frame = 2; frame < result.samples.length; frame += 1) {
    const [older, previous, current] = [
      result.samples[frame - 2]!, result.samples[frame - 1]!, result.samples[frame]!,
    ];
    for (let foot = 0; foot < 2; foot += 1) {
      const a = previous[foot]![part];
      const b = current[foot]![part];
      if (older[foot]![part].y > floorTolerance || a.y > floorTolerance
        || b.y > floorTolerance) continue;
      worst[foot] = Math.max(worst[foot]!, Math.hypot(b.x - a.x, b.z - a.z) / STEP);
    }
  }
  return worst;
}

describe("homeowner locomotion", () => {
  it("holds planted feet on the floor while the hips travel over them", () => {
    // A foot riding along with the body would show the full 1.35 u/s.
    const result = walk(300, { speed: 1.35 });
    for (const part of ["heel", "toe"] as const) {
      for (const [foot, slide] of plantedSlide(result, part).entries()) {
        expect(slide, `${part} ${foot === 0 ? "left" : "right"}`).toBeLessThan(0.3);
      }
    }
  });

  it("holds planted feet at a hurried pace too", () => {
    const result = walk(300, { speed: 2.7 });
    for (const part of ["heel", "toe"] as const) {
      for (const [foot, slide] of plantedSlide(result, part).entries()) {
        expect(slide, `${part} ${foot === 0 ? "left" : "right"}`).toBeLessThan(0.45);
      }
    }
  });

  it("stops stepping when the world refuses the commanded movement", () => {
    const pushing = walk(180, { speed: 1.8 }, { grip: 0 });
    expect(pushing.animator.strideRate()).toBe(0);
    const before = pushing.samples.at(-40)!;
    const after = pushing.samples.at(-1)!;
    for (let foot = 0; foot < 2; foot += 1) {
      const a = before[foot]!.heel;
      const b = after[foot]!.heel;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.02);
    }
  });

  it("rolls each step heel to toe rather than keeping the sole flat", () => {
    const rig = buildOwner();
    const animator = new OwnerAnimator(rig);
    const state: OwnerAnimationInput = {
      ...NEUTRAL_OWNER_ANIMATION, speed: 1.35, travel: 1.35 * STEP,
    };
    for (let frame = 0; frame < 120; frame += 1) animator.update(STEP, state);

    let heelDown = 0;
    let toeDown = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      animator.update(STEP, state);
      rig.root.updateMatrixWorld(true);
      const shoe = rig.root.getObjectByName("shoe-left")!;
      // A rolling foot spends part of its stance heel-low and part toe-low.
      // A flat foot never does either.
      const heel = shoe.localToWorld(HEEL.clone()).y;
      const toe = shoe.localToWorld(TOE.clone()).y;
      if (Math.min(heel, toe) < 0.02) {
        if (heel < toe - 0.015) heelDown += 1;
        if (toe < heel - 0.015) toeDown += 1;
      }
    }
    expect(heelDown).toBeGreaterThan(3);
    expect(toeDown).toBeGreaterThan(3);
  });

  it("takes pivot steps rather than spinning over still feet", () => {
    const pivot = walk(200, { speed: 0, turnRate: 1.5 });
    expect(pivot.animator.strideRate()).toBeGreaterThan(0.2);
    for (let foot = 0; foot < 2; foot += 1) {
      const peak = Math.max(...pivot.samples.map(
        (frame) => Math.min(frame[foot]!.heel.y, frame[foot]!.toe.y),
      ));
      expect(peak, foot === 0 ? "left" : "right").toBeGreaterThan(0.01);
    }
  });

  it("keeps both soles on the support plane throughout a walk", () => {
    const result = walk(240, { speed: 1.35 });
    for (const frame of result.samples.slice(60)) {
      for (const sole of frame) {
        expect(Math.min(sole.heel.y, sole.toe.y)).toBeGreaterThan(-0.006);
        expect(Math.min(sole.heel.y, sole.toe.y)).toBeLessThan(0.16);
      }
    }
  });

  it("runs on a treadmill when travel is not measured", () => {
    const rig = buildOwner();
    const animator = new OwnerAnimator(rig);
    for (let frame = 0; frame < 180; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_OWNER_ANIMATION, speed: 1.35 });
    }
    expect(animator.strideRate()).toBeGreaterThan(0.5);
  });
});
