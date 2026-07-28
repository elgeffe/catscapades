export type InteractionVerb = "swipe" | "grab" | "drop" | "activate" | "open" | "hide" | "innocent" | "jump";

export interface InteractionCandidate {
  id: string;
  verb: InteractionVerb;
  distance: number;
  facing: number;
  priority: number;
  relevant: boolean;
  enabled: boolean;
}

export function scoreInteraction(candidate: InteractionCandidate): number {
  if (!candidate.enabled) return Number.NEGATIVE_INFINITY;
  return candidate.priority * 10 + (candidate.relevant ? 18 : 0) + candidate.facing * 8 - candidate.distance * 5;
}

export function resolveInteraction(candidates: readonly InteractionCandidate[]): InteractionCandidate | null {
  return candidates.reduce<InteractionCandidate | null>((best, candidate) => {
    if (!best) return candidate.enabled ? candidate : null;
    return scoreInteraction(candidate) > scoreInteraction(best) ? candidate : best;
  }, null);
}

export interface Stimulus {
  id: string;
  intensity: number;
  distance: number;
  age: number;
  persistent: boolean;
  witnessedCat: boolean;
}

export function stimulusPriority(stimulus: Stimulus): number {
  const freshness = Math.max(0, 1 - stimulus.age / 12);
  return stimulus.intensity * 12 + freshness * 6 + (stimulus.persistent ? 8 : 0)
    + (stimulus.witnessedCat ? 10 : 0) - stimulus.distance * 0.4;
}

export function updateSuspicion(current: number, evidence: "unknown" | "present" | "witnessed" | "innocent", dt = 1): number {
  const delta = evidence === "witnessed" ? 32 : evidence === "present" ? 12 : evidence === "unknown" ? 3 : -9;
  return Math.max(0, Math.min(100, current + delta * dt));
}

export type Condition =
  | { kind: "flag"; key: string }
  | { kind: "count"; key: string; minimum: number }
  | { kind: "all"; conditions: readonly Condition[] }
  | { kind: "any"; conditions: readonly Condition[] };

export interface ObjectiveFacts {
  flags: ReadonlySet<string>;
  counts: Readonly<Record<string, number>>;
}

export function evaluateCondition(condition: Condition, facts: ObjectiveFacts): boolean {
  if (condition.kind === "flag") return facts.flags.has(condition.key);
  if (condition.kind === "count") return (facts.counts[condition.key] ?? 0) >= condition.minimum;
  if (condition.kind === "all") return condition.conditions.every((item) => evaluateCondition(item, facts));
  return condition.conditions.some((item) => evaluateCondition(item, facts));
}

export function selectCameraZone(current: string, x: number): string {
  if (current === "garden") return x > -2.65 ? "kitchen" : current;
  if (current === "kitchen") return x < -3.4 ? "garden" : x > 7.35 ? "dining" : current;
  return x < 6.65 ? "kitchen" : current;
}
