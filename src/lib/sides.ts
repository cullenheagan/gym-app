// Single-arm exercises log the left side in `reps` and the right side in `reps_right`.
// Everything else (two-arm exercises) leaves the right side empty.

// Reps used for Est. 1RM, weight suggestions and rep goals: the weaker side, so a lagging arm is not hidden.
export function sideReps(left: number | null | undefined, right: number | null | undefined): number | null {
  const l = left == null ? null : Number(left);
  const r = right == null ? null : Number(right);
  if (r == null) return l;
  if (l == null) return r;
  return Math.min(l, r);
}

// Reps used for total weight lifted: both arms lift the weight, so both sides count.
export function totalReps(left: number | null | undefined, right: number | null | undefined): number {
  return Number(left ?? 0) + Number(right ?? 0);
}

// "10" for a normal set, "10L / 9R" for a single-arm set.
export function repsText(left: number | null | undefined, right: number | null | undefined): string {
  return right == null ? String(left ?? 0) : `${left ?? 0}L / ${right}R`;
}
