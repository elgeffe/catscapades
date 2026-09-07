/**
 * Rendering-independent A* pathfinding on the house floor.
 *
 * The pathfinder deliberately consumes simple X/Z obstacle boxes rather than
 * Three.js or Rapier objects. Runtime code can therefore feed it the same
 * collider dimensions used by physics, while tests can exercise routing
 * without starting WebGL or WASM.
 */

export interface NavigationPoint {
  readonly x: number;
  readonly z: number;
}

export interface NavigationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface NavigationObstacle {
  readonly center: NavigationPoint;
  readonly halfExtents: NavigationPoint;
  readonly rotationY?: number;
}

export interface NavigationPath {
  readonly waypoints: readonly NavigationPoint[];
  /** False when an obstructed goal was resolved to its nearest free neighbour. */
  readonly reachedGoal: boolean;
  readonly resolvedGoal: NavigationPoint;
}

interface GridPoint {
  readonly column: number;
  readonly row: number;
}

interface HeapEntry {
  readonly index: number;
  readonly score: number;
}

const CARDINAL_COST = 1;
const DIAGONAL_COST = Math.SQRT2;
const DIRECTIONS: readonly (readonly [number, number, number])[] = [
  [1, 0, CARDINAL_COST],
  [-1, 0, CARDINAL_COST],
  [0, 1, CARDINAL_COST],
  [0, -1, CARDINAL_COST],
  [1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

export class AStarPathfinder {
  private readonly columns: number;
  private readonly rows: number;

  constructor(
    private readonly bounds: NavigationBounds,
    private readonly cellSize: number,
    private readonly clearance: number,
  ) {
    if (cellSize <= 0) throw new Error("A* cell size must be positive.");
    if (clearance < 0) throw new Error("A* clearance cannot be negative.");
    this.columns = Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1;
    this.rows = Math.floor((bounds.maxZ - bounds.minZ) / cellSize) + 1;
  }

  findPath(
    start: NavigationPoint,
    goal: NavigationPoint,
    obstacles: readonly NavigationObstacle[],
  ): NavigationPath | null {
    const blocked = this.buildBlockedGrid(obstacles);
    const startCell = this.nearestWalkable(this.worldToGrid(start), blocked);
    if (!startCell) return null;

    const requestedGoal = this.worldToGrid(goal);
    const requestedGoalIndex = this.index(requestedGoal.column, requestedGoal.row);
    const goalInsideBounds = goal.x >= this.bounds.minX && goal.x <= this.bounds.maxX
      && goal.z >= this.bounds.minZ && goal.z <= this.bounds.maxZ;
    const goalPointClear = !obstacles.some(
      (obstacle) => pointIntersectsObstacle(goal, obstacle, this.clearance),
    );
    const exactGoalWalkable = goalInsideBounds && goalPointClear && !blocked[requestedGoalIndex];
    if (!exactGoalWalkable) blocked[requestedGoalIndex] = 1;
    const goalCells = exactGoalWalkable
      ? [requestedGoal]
      : this.nearestWalkableRing(requestedGoal, blocked);
    if (goalCells.length === 0) return null;

    const found = this.search(startCell, goalCells, blocked);
    if (found === null) return null;

    const rawCells = this.reconstruct(found.end, found.cameFrom);
    const rawPoints = rawCells.map((cell) => this.gridToWorld(cell));
    const resolvedCell = rawPoints[rawPoints.length - 1];
    if (!resolvedCell) return null;

    const reachedGoal = exactGoalWalkable;
    const resolvedGoal = reachedGoal ? { x: goal.x, z: goal.z } : resolvedCell;
    if (reachedGoal) rawPoints[rawPoints.length - 1] = resolvedGoal;

    const waypoints = this.simplify(start, rawPoints.slice(1), blocked);
    if (waypoints.length === 0) waypoints.push(resolvedGoal);
    return { waypoints, reachedGoal, resolvedGoal };
  }

  private buildBlockedGrid(obstacles: readonly NavigationObstacle[]): Uint8Array {
    const blocked = new Uint8Array(this.columns * this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const point = this.gridToWorld({ column, row });
        if (obstacles.some((obstacle) => pointIntersectsObstacle(point, obstacle, this.clearance))) {
          blocked[this.index(column, row)] = 1;
        }
      }
    }
    return blocked;
  }

  private search(
    start: GridPoint,
    goalCells: readonly GridPoint[],
    blocked: Uint8Array,
  ): { readonly end: number; readonly cameFrom: Int32Array } | null {
    const total = this.columns * this.rows;
    const startIndex = this.index(start.column, start.row);
    const cameFrom = new Int32Array(total);
    cameFrom.fill(-1);
    const gScore = new Float64Array(total);
    gScore.fill(Number.POSITIVE_INFINITY);
    gScore[startIndex] = 0;
    const closed = new Uint8Array(total);
    const open = new MinHeap();
    const goals = new Set(goalCells.map((cell) => this.index(cell.column, cell.row)));
    open.push({ index: startIndex, score: this.heuristic(start, goalCells) });

    while (open.size > 0) {
      const currentEntry = open.pop();
      if (!currentEntry) break;
      const currentIndex = currentEntry.index;
      if (closed[currentIndex]) continue;
      if (goals.has(currentIndex)) return { end: currentIndex, cameFrom };
      closed[currentIndex] = 1;

      const current = this.fromIndex(currentIndex);
      for (const [dx, dz, cost] of DIRECTIONS) {
        const column = current.column + dx;
        const row = current.row + dz;
        if (!this.inside(column, row)) continue;
        const neighbourIndex = this.index(column, row);
        if (blocked[neighbourIndex] || closed[neighbourIndex]) continue;
        // A person cannot squeeze diagonally through the touching corners of
        // two solid cells.
        if (dx !== 0 && dz !== 0
          && (blocked[this.index(current.column + dx, current.row)]
            || blocked[this.index(current.column, current.row + dz)])) {
          continue;
        }

        const currentScore = gScore[currentIndex];
        const neighbourScore = gScore[neighbourIndex];
        if (currentScore === undefined || neighbourScore === undefined) continue;
        const tentative = currentScore + cost;
        if (tentative >= neighbourScore) continue;
        cameFrom[neighbourIndex] = currentIndex;
        gScore[neighbourIndex] = tentative;
        const neighbour = { column, row };
        open.push({
          index: neighbourIndex,
          score: tentative + this.heuristic(neighbour, goalCells),
        });
      }
    }
    return null;
  }

  private reconstruct(end: number, cameFrom: Int32Array): GridPoint[] {
    const cells: GridPoint[] = [];
    let cursor = end;
    while (cursor >= 0) {
      cells.push(this.fromIndex(cursor));
      cursor = cameFrom[cursor] ?? -1;
    }
    cells.reverse();
    return cells;
  }

  /** Removes grid-grid zigzags while retaining collision-safe corner clearance. */
  private simplify(
    start: NavigationPoint,
    points: readonly NavigationPoint[],
    blocked: Uint8Array,
  ): NavigationPoint[] {
    const result: NavigationPoint[] = [];
    let anchor = start;
    let cursor = 0;
    while (cursor < points.length) {
      let furthest = cursor;
      for (let candidate = cursor; candidate < points.length; candidate += 1) {
        const point = points[candidate];
        if (!point || !this.segmentIsWalkable(anchor, point, blocked)) break;
        furthest = candidate;
      }
      const chosen = points[furthest];
      if (!chosen) break;
      result.push(chosen);
      anchor = chosen;
      cursor = furthest + 1;
    }
    return result;
  }

  private segmentIsWalkable(
    from: NavigationPoint,
    to: NavigationPoint,
    blocked: Uint8Array,
  ): boolean {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance / (this.cellSize * 0.25)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cell = this.worldToGrid({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      });
      if (blocked[this.index(cell.column, cell.row)]) return false;
    }
    return true;
  }

  private nearestWalkable(origin: GridPoint, blocked: Uint8Array): GridPoint | null {
    const candidates = this.nearestWalkableRing(origin, blocked);
    return candidates[0] ?? null;
  }

  private nearestWalkableRing(origin: GridPoint, blocked: Uint8Array): GridPoint[] {
    const maxRadius = Math.max(this.columns, this.rows);
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      const candidates: GridPoint[] = [];
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const column = origin.column + dx;
          const row = origin.row + dz;
          if (!this.inside(column, row) || blocked[this.index(column, row)]) continue;
          candidates.push({ column, row });
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const distanceA = (a.column - origin.column) ** 2 + (a.row - origin.row) ** 2;
          const distanceB = (b.column - origin.column) ** 2 + (b.row - origin.row) ** 2;
          return distanceA - distanceB || a.row - b.row || a.column - b.column;
        });
        return candidates;
      }
    }
    return [];
  }

  private heuristic(cell: GridPoint, goals: readonly GridPoint[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (const goal of goals) {
      const dx = Math.abs(cell.column - goal.column);
      const dz = Math.abs(cell.row - goal.row);
      best = Math.min(best, Math.max(dx, dz) + (DIAGONAL_COST - 1) * Math.min(dx, dz));
    }
    return best;
  }

  private worldToGrid(point: NavigationPoint): GridPoint {
    return {
      column: clampInteger(Math.round((point.x - this.bounds.minX) / this.cellSize), 0, this.columns - 1),
      row: clampInteger(Math.round((point.z - this.bounds.minZ) / this.cellSize), 0, this.rows - 1),
    };
  }

  private gridToWorld(point: GridPoint): NavigationPoint {
    return {
      x: this.bounds.minX + point.column * this.cellSize,
      z: this.bounds.minZ + point.row * this.cellSize,
    };
  }

  private inside(column: number, row: number): boolean {
    return column >= 0 && column < this.columns && row >= 0 && row < this.rows;
  }

  private index(column: number, row: number): number {
    return row * this.columns + column;
  }

  private fromIndex(index: number): GridPoint {
    return {
      column: index % this.columns,
      row: Math.floor(index / this.columns),
    };
  }
}

function pointIntersectsObstacle(
  point: NavigationPoint,
  obstacle: NavigationObstacle,
  clearance: number,
): boolean {
  const angle = -(obstacle.rotationY ?? 0);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const dx = point.x - obstacle.center.x;
  const dz = point.z - obstacle.center.z;
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const outsideX = Math.max(Math.abs(localX) - obstacle.halfExtents.x, 0);
  const outsideZ = Math.max(Math.abs(localZ) - obstacle.halfExtents.z, 0);
  return Math.hypot(outsideX, outsideZ) <= clearance;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = this.entries[parent];
      if (!parentEntry || parentEntry.score <= entry.score) break;
      this.entries[index] = parentEntry;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const root = this.entries[0];
    const tail = this.entries.pop();
    if (!root || !tail || this.entries.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const leftEntry = this.entries[left];
      const rightEntry = this.entries[right];
      if (!leftEntry) break;
      const child = rightEntry && rightEntry.score < leftEntry.score ? right : left;
      const childEntry = this.entries[child];
      if (!childEntry || childEntry.score >= tail.score) break;
      this.entries[index] = childEntry;
      index = child;
    }
    this.entries[index] = tail;
    return root;
  }
}
