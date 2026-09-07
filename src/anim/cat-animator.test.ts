import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CatAnimator, NEUTRAL_CAT_ANIMATION, type CatAnimationInput } from "./cat-animator";
import { buildCat, type CatRig } from "../models/cat";

const STEP = 1 / 60;

interface Walk {
  readonly rig: CatRig;
  readonly animator: CatAnimator;
  /** World-space sole positions, sampled once per simulated frame. */
  readonly samples: THREE.Vector3[][];
}

/**
 * Drives the animator the way the game does — the root is advanced by the same
 * travel the animation is told about — and records where every sole actually
 * ended up in world space each frame. Any slide shows up as a planted paw
 * moving while the cat is on the floor.
 */
function walk(frames: number, input: Partial<CatAnimationInput>, options: {
  /** Fraction of the commanded speed the world actually grants. */
  readonly grip?: number;
} = {}): Walk {
  const rig = buildCat();
  const animator = new CatAnimator(rig);
  const grip = options.grip ?? 1;
  const state: CatAnimationInput = { ...NEUTRAL_CAT_ANIMATION, ...input };
  const samples: THREE.Vector3[][] = [];
  let facing = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const travel = state.speed * STEP * grip;
    facing += state.turnRate * STEP;
    rig.root.rotation.y = facing;
    rig.root.position.x += Math.sin(facing) * travel;
    rig.root.position.z += Math.cos(facing) * travel;
    animator.update(STEP, { ...state, travel });
    rig.root.updateMatrixWorld(true);
    samples.push(rig.legs.map((leg) => leg.paw.getWorldPosition(new THREE.Vector3())));
  }
  return { rig, animator, samples };
}

/**
 * Per-leg worst-case ground speed over the frames where the sole was already
 * standing. Stance is identified from sole height alone, never from the gait
 * clock, so the measurement cannot be fooled by the animator agreeing with
 * itself. A paw is treated as standing only once it has been down for three
 * consecutive samples: at a walking cadence a swing lasts a handful of frames,
 * so its final descent is legitimately fast and still momentarily within a
 * millimetre of the floor.
 */
function plantedSlide(walkResult: Walk, floorTolerance = 0.009): number[] {
  const worst = walkResult.rig.legs.map(() => 0);
  for (let frame = 2; frame < walkResult.samples.length; frame += 1) {
    const [older, previous, current] = [
      walkResult.samples[frame - 2]!, walkResult.samples[frame - 1]!, walkResult.samples[frame]!,
    ];
    for (let leg = 0; leg < current.length; leg += 1) {
      const a = previous[leg]!;
      const b = current[leg]!;
      if (older[leg]!.y > floorTolerance || a.y > floorTolerance || b.y > floorTolerance) continue;
      const slide = Math.hypot(b.x - a.x, b.z - a.z) / STEP;
      worst[leg] = Math.max(worst[leg]!, slide);
    }
  }
  return worst;
}

describe("cat stride grounding", () => {
  it("holds planted paws on the floor while the body travels over them", () => {
    // A trot at 3.1 u/s: a paw riding along with the body would show ~3.1.
    const result = walk(240, { speed: 3.1 });
    for (const [index, slide] of plantedSlide(result).entries()) {
      expect(slide, result.rig.legs[index]!.id).toBeLessThan(0.3);
    }
  });

  it("holds planted paws through a stalking creep", () => {
    // The old motion-scaled sweep slid worst here: at low speed the authored
    // stance excursion shrank while the body kept its full speed.
    const result = walk(300, { speed: 0.9, stalking: true });
    for (const [index, slide] of plantedSlide(result).entries()) {
      expect(slide, result.rig.legs[index]!.id).toBeLessThan(0.25);
    }
  });

  it("stops stepping when the world refuses the commanded movement", () => {
    // Full throttle into a cupboard: speed stays high, travel is zero.
    const pushing = walk(180, { speed: 2.95 }, { grip: 0 });
    expect(pushing.animator.strideRate()).toBe(0);

    const before = pushing.samples.at(-40)!;
    const after = pushing.samples.at(-1)!;
    for (let leg = 0; leg < after.length; leg += 1) {
      expect(Math.hypot(after[leg]!.x - before[leg]!.x, after[leg]!.z - before[leg]!.z))
        .toBeLessThan(0.01);
    }
  });

  it("takes pivot steps rather than spinning the body over still paws", () => {
    const pivot = walk(180, { speed: 0, turnRate: 1.8 });
    expect(pivot.animator.strideRate()).toBeGreaterThan(0.5);
    // Every leg must lift clear of the floor at least once while turning.
    for (let leg = 0; leg < pivot.rig.legs.length; leg += 1) {
      const peak = Math.max(...pivot.samples.map((frame) => frame[leg]!.y));
      expect(peak, pivot.rig.legs[leg]!.id).toBeGreaterThan(0.01);
    }
  });

  it("keeps soles on the support plane while banking through a turn", () => {
    // A banked, pitching torso used to carry planted soles off the floor with
    // it, because contacts were resolved in body space.
    const banked = walk(240, { speed: 3.4, turnRate: 2.2 });
    for (const frame of banked.samples.slice(60)) {
      for (const sole of frame) {
        expect(sole.y).toBeGreaterThan(-0.005);
        expect(sole.y).toBeLessThan(0.2);
      }
    }
    for (const [index, slide] of plantedSlide(banked).entries()) {
      expect(slide, banked.rig.legs[index]!.id).toBeLessThan(0.45);
    }
  });

  it("comes to rest square on all fours", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    for (let frame = 0; frame < 120; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, speed: 3.1, travel: 3.1 * STEP });
    }
    for (let frame = 0; frame < 180; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, travel: 0 });
    }
    rig.root.updateMatrixWorld(true);
    const soles = rig.legs.map((leg) => leg.paw.getWorldPosition(new THREE.Vector3()));
    for (const [index, sole] of soles.entries()) {
      expect(sole.y, rig.legs[index]!.id).toBeLessThan(0.009);
    }
  });

  it("re-seats ground contacts after a teleport", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    for (let frame = 0; frame < 90; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, speed: 3.1, travel: 3.1 * STEP });
    }
    rig.root.position.set(8, 1.35, -4);
    animator.resetSecondaryMotion();
    animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, travel: 0 });
    rig.root.updateMatrixWorld(true);
    for (const leg of rig.legs) {
      const sole = leg.paw.getWorldPosition(new THREE.Vector3());
      expect(Math.hypot(sole.x - 8, sole.z + 4), leg.id).toBeLessThan(0.5);
      expect(sole.y, leg.id).toBeLessThan(1.4);
    }
  });

  it("plants the forepaws out in front to brake, and holds them low", () => {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    const front = rig.legs.filter((leg) => leg.isFront);
    const hind = rig.legs.filter((leg) => !leg.isFront);
    // A contact recedes across its whole stance, so a single frame catches an
    // arbitrary point in the sweep. Sample the extremes over several cycles,
    // and measure the fore-to-hind span rather than one paw: that is the
    // silhouette change a player reads as "throwing the anchors out".
    const sample = (state: CatAnimationInput, frames: number) => {
      let reach = -Infinity;
      let gather = -Infinity;
      let lift = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        animator.update(STEP, state);
        rig.root.updateMatrixWorld(true);
        for (const leg of front) {
          const paw = leg.paw.getWorldPosition(new THREE.Vector3());
          reach = Math.max(reach, paw.z);
          lift = Math.max(lift, paw.y);
        }
        for (const leg of hind) {
          gather = Math.max(gather, leg.paw.getWorldPosition(new THREE.Vector3()).z);
        }
      }
      return { span: reach - gather, lift };
    };
    const running: CatAnimationInput = { ...NEUTRAL_CAT_ANIMATION, speed: 5.2, travel: 5.2 * STEP };
    const braking: CatAnimationInput = { ...running, brake: 1, acceleration: -14 };

    sample(running, 150);
    const cruising = sample(running, 60);
    sample(braking, 60);
    const braced = sample(braking, 60);

    expect(braced.span).toBeGreaterThan(cruising.span + 0.05);
    expect(braced.lift).toBeLessThan(cruising.lift);
    // The forequarters go down over the stopping paws while the hocks gather:
    // a skid, not a glide. Positive body pitch is nose-down.
    expect(rig.body.rotation.x).toBeGreaterThan(0.1);
    expect(rig.body.position.y).toBeLessThan(rig.standHeight);
  });

  it("steps wide on the outside of a hard turn", () => {
    const turning = walk(240, { speed: 3.2, turnRate: 3 });
    const { rig } = turning;
    rig.root.updateMatrixWorld(true);
    // Positive yaw puts the left legs on the outside of the arc, so they should
    // be tracking wider of the spine than their mirror on the inside.
    const track = new Map<string, number>();
    for (const leg of rig.legs) {
      const local = rig.root.worldToLocal(leg.paw.getWorldPosition(new THREE.Vector3()));
      track.set(leg.id, Math.abs(local.x));
    }
    const straight = walk(240, { speed: 3.2 });
    straight.rig.root.updateMatrixWorld(true);
    const neutral = new Map<string, number>();
    for (const leg of straight.rig.legs) {
      const local = straight.rig.root.worldToLocal(leg.paw.getWorldPosition(new THREE.Vector3()));
      neutral.set(leg.id, Math.abs(local.x));
    }
    expect(track.get("front-left")!).toBeGreaterThan(neutral.get("front-left")!);
    expect(track.get("hind-left")!).toBeGreaterThan(neutral.get("hind-left")!);
  });

  it("runs on a treadmill when travel is not measured", () => {
    // Review clips leave `travel` null: the legs must still cycle so the model
    // viewer and the clip inspector have something to look at.
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    let peak = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, speed: 3.1 });
      rig.root.updateMatrixWorld(true);
      for (const leg of rig.legs) {
        peak = Math.max(peak, leg.paw.getWorldPosition(new THREE.Vector3()).y);
      }
    }
    expect(animator.strideRate()).toBeGreaterThan(1);
    expect(peak).toBeGreaterThan(0.03);
  });
});

describe("cat jump sequence", () => {
  /** Runs the animator through a scripted leap, sampling every frame. */
  function leap(options: { readonly gatherFrames?: number; readonly flightFrames?: number } = {}) {
    const rig = buildCat();
    const animator = new CatAnimator(rig);
    const gatherFrames = options.gatherFrames ?? 8;
    const flightFrames = options.flightFrames ?? 30;
    const paws = (): Map<string, THREE.Vector3> => {
      rig.root.updateMatrixWorld(true);
      return new Map(rig.legs.map((leg) => [leg.id, leg.paw.getWorldPosition(new THREE.Vector3())]));
    };

    const approach: CatAnimationInput = { ...NEUTRAL_CAT_ANIMATION, speed: 2.4, travel: 2.4 * STEP };
    for (let frame = 0; frame < 90; frame += 1) animator.update(STEP, approach);
    const standing = { paws: paws(), rideHeight: rig.body.position.y };

    for (let frame = 0; frame < gatherFrames; frame += 1) {
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, gather: (frame + 1) / gatherFrames });
    }
    const coiled = { paws: paws(), rideHeight: rig.body.position.y, spine: rig.spineLower.rotation.x };

    const flight: { progress: number; paws: Map<string, THREE.Vector3> }[] = [];
    for (let frame = 0; frame < flightFrames; frame += 1) {
      const progress = (frame + 1) / flightFrames;
      animator.update(STEP, { ...NEUTRAL_CAT_ANIMATION, airborne: 1, jumpProgress: progress });
      flight.push({ progress, paws: paws() });
    }

    const recovery: { settling: number; paws: Map<string, THREE.Vector3> }[] = [];
    for (let frame = 0; frame < 16; frame += 1) {
      const settling = 1 - (frame + 1) / 16;
      animator.update(STEP, {
        ...NEUTRAL_CAT_ANIMATION, landImpact: settling, landRecover: settling, speed: 1.6 * (1 - settling),
        travel: 1.6 * (1 - settling) * STEP,
      });
      recovery.push({ settling, paws: paws() });
    }
    return { rig, standing, coiled, flight, recovery };
  }

  it("coils onto its hocks before launching, with the paws still on the floor", () => {
    const { rig, standing, coiled } = leap();
    expect(coiled.rideHeight).toBeLessThan(standing.rideHeight - 0.04);
    // Loaded spine, not merely a lower cat.
    expect(coiled.spine).toBeGreaterThan(0.05);
    // The coil happens on the ground: every sole is still down.
    for (const leg of rig.legs) {
      expect(coiled.paws.get(leg.id)!.y, leg.id).toBeLessThan(0.02);
    }
    // Hind paws are drawn forward, under the hips, to push from.
    for (const leg of rig.legs.filter((entry) => !entry.isFront)) {
      expect(coiled.paws.get(leg.id)!.z, leg.id)
        .toBeGreaterThan(standing.paws.get(leg.id)!.z + 0.02);
    }
  });

  it("pushes off extended, folds up, and reaches out with the forepaws", () => {
    const { flight } = leap();
    const at = (progress: number) => flight.reduce(
      (best, frame) => (Math.abs(frame.progress - progress) < Math.abs(best.progress - progress) ? frame : best),
    );
    const hindZ = (frame: typeof flight[number]) => frame.paws.get("hind-left")!.z;
    const hindY = (frame: typeof flight[number]) => frame.paws.get("hind-left")!.y;
    const frontZ = (frame: typeof flight[number]) => frame.paws.get("front-left")!.z;

    // Take-off: hind legs driven out behind, and lower than when folded.
    expect(hindZ(at(0.05))).toBeLessThan(hindZ(at(0.5)) - 0.1);
    expect(hindY(at(0.05))).toBeLessThan(hindY(at(0.5)));
    // Forepaws unfold forward across the flight and keep reaching.
    expect(frontZ(at(0.5))).toBeGreaterThan(frontZ(at(0.05)) + 0.05);
    expect(frontZ(at(0.95))).toBeGreaterThan(frontZ(at(0.5)));
    // Nothing pops: the whole sequence is continuous.
    for (let index = 1; index < flight.length; index += 1) {
      for (const leg of ["hind-left", "front-left"]) {
        const step = flight[index]!.paws.get(leg)!.distanceTo(flight[index - 1]!.paws.get(leg)!);
        expect(step, `${leg} at ${flight[index]!.progress}`).toBeLessThan(0.06);
      }
    }
  });

  it("lands on the forepaws before the hind legs swing under", () => {
    const { recovery } = leap();
    /** First recovery frame on which this sole is carrying weight. */
    const contactFrame = (id: string): number => {
      const index = recovery.findIndex((frame) => frame.paws.get(id)!.y < 0.02);
      expect(index, id).toBeGreaterThanOrEqual(0);
      return index;
    };

    // At front contact the forepaws are already down and the hind legs are not.
    const first = recovery[0]!;
    expect(first.paws.get("front-left")!.y).toBeLessThan(0.02);
    expect(first.paws.get("hind-left")!.y)
      .toBeGreaterThan(first.paws.get("front-left")!.y + 0.02);

    // Both hind legs then swing under and take the floor, later than the front
    // pair but well before the recovery is over.
    for (const leg of ["hind-left", "hind-right"]) {
      expect(contactFrame(leg), leg).toBeGreaterThan(contactFrame("front-left"));
      expect(contactFrame(leg), leg).toBeLessThan(recovery.length - 3);
    }
  });
});
