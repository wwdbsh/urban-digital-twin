import type { AssemblyLod } from "../release/multi-lod-assembly.ts";

/**
 * Runtime LOD policy only. Profiles are a browser-side selection over the LODs
 * an immutable assembly package already declares; they never widen a manifest,
 * never add a schema field, and never change which artifacts are eligible.
 */
export const EXTERIOR_RENDER_PROFILES = ["exploration", "inspection"] as const;
export type ExteriorRenderProfile = (typeof EXTERIOR_RENDER_PROFILES)[number];
/**
 * The DEFAULT selection semantics.
 *
 * T001 HOLDS A FLIP OF THIS CONSTANT to `inspection` (finest-that-covers), and
 * it is developed but deliberately NOT applied here: ADR 0057 Part 0 requires it
 * to ship in the SAME commit as the `-s2` activation records and the rollback
 * entries, so that one revert restores the composition and the semantics
 * together. Until that commit it would be a third, unmeasured configuration.
 *
 * The reason it has to move is worth stating rather than absorbing. `maxDistanceMeters` is an UPPER bound only, and `AssemblyLod` has
 * no near bound, so under a coarsest-preferring profile a two-LOD asset has
 * exactly two reachable behaviours: thresholds distinguished, so the coarse
 * level covers everywhere and wins everywhere; or thresholds tied, so the tie
 * rule sends every distance to the fine level. NEITHER IS A RING. Shipping the
 * `-s2` thresholds under the old default would have put the protrusion-shed
 * level in front of the camera at street level.
 *
 * `exploration` is unchanged and stays reachable through `?exteriorProfile=`,
 * where it is the documented coarsest / degraded-performance arm.
 *
 * The flip is a NO-OP for every release the promoted city serves today, and
 * that is proven rather than asserted: `exterior-two-lod-selection.test.ts`
 * pins all three frozen shapes — single-LOD `-s1`, null-at-both `-c1`/`-c2`, and
 * the 424 ADR 0050 fallback parents — at thirteen distances under BOTH profiles,
 * and pins the ANTECEDENT that makes them agree, so a future shape that
 * distinguished its levels fails there instead of silently changing what a
 * promoted session renders.
 */
export const DEFAULT_EXTERIOR_RENDER_PROFILE: ExteriorRenderProfile = "exploration";

export function parseExteriorRenderProfile(value: unknown): ExteriorRenderProfile | null {
  return typeof value === "string" && (EXTERIOR_RENDER_PROFILES as readonly string[]).includes(value)
    ? value as ExteriorRenderProfile
    : null;
}

export function exteriorRenderProfileLabel(profile: ExteriorRenderProfile): string {
  return profile === "inspection" ? "Inspection (finest verified LOD)" : "Exploration (coarsest verified LOD)";
}

/**
 * Assembly LODs are declared near-to-far: index 0 is the finest (geometric
 * error 0) and both `geometricErrorMeters` and `maxDistanceMeters` are
 * nondecreasing, with a trailing `null` meaning unbounded. The release
 * validator already enforces this, so a list that violates it is treated as
 * unusable rather than silently reordered.
 */
export function isMonotoneAssemblyLodOrder(lods: readonly AssemblyLod[]): boolean {
  if (lods.length === 0) return false;
  let previousError = Number.NEGATIVE_INFINITY;
  let previousDistance = Number.NEGATIVE_INFINITY;
  for (const lod of lods) {
    if (!Number.isFinite(lod.geometricErrorMeters) || lod.geometricErrorMeters < 0) return false;
    if (lod.geometricErrorMeters < previousError) return false;
    previousError = lod.geometricErrorMeters;
    const distance = lod.maxDistanceMeters === null ? Number.POSITIVE_INFINITY : lod.maxDistanceMeters;
    if (!(distance >= 0)) return false;
    if (distance < previousDistance) return false;
    previousDistance = distance;
  }
  return true;
}

function covers(lod: AssemblyLod, distanceMeters: number): boolean {
  return lod.maxDistanceMeters === null || distanceMeters <= lod.maxDistanceMeters;
}

function threshold(lod: AssemblyLod): number {
  return lod.maxDistanceMeters === null ? Number.POSITIVE_INFINITY : lod.maxDistanceMeters;
}

/**
 * Deterministic per-profile LOD choice.
 *
 * - `inspection` takes the finest eligible LOD whose declared `maxDistanceMeters`
 *   still covers the camera distance.
 * - `exploration` takes the coarsest eligible LOD that covers the same distance —
 *   EXCEPT that candidates tied on the same declared threshold collapse to the
 *   finest of the tie.
 *
 * ## Why the tie rule exists (T005, the F2-shaped LOD defect)
 *
 * `maxDistanceMeters` is the release's statement of the distance beyond which a
 * representation stops being appropriate. Exploration preferring the coarser
 * representation is DELIBERATE and unchanged: that is what the profile is for,
 * and Block 835 — the one promoted two-LOD wave, declaring 250 m on `lod_0` and
 * unbounded on `lod_1` — keeps resolving exactly what it resolved before, at
 * every distance.
 *
 * A TIE is different, and the retained full-city packages are full of it: both
 * LODs of all 44,989 generated buildings declare `maxDistanceMeters: null`,
 * because ADR 0050's measured-fallback rule gives the fine level an unbounded
 * threshold whenever the coarse level is a full-geometry fallback. Under the old
 * rule exploration therefore selected the COARSE, untextured level at every
 * distance including street level — not because the release said coarse was
 * appropriate there, but because it said nothing at all and "last one wins" chose
 * for it. Preferring the coarser of two representations a release never
 * distinguished is a choice the release did not authorise, so the tie resolves
 * to the finest member instead.
 *
 * This is provably a no-op for every currently frozen release: five of the six
 * promoted waves are single-LOD (no tie possible), and the sixth declares
 * distinct thresholds. `exterior-render-profiles.test.ts` pins that, and the
 * serving releases this goal emits are single-LOD by construction, so the rule
 * is a guard on the retained two-LOD population rather than a change to what
 * anything ships today.
 *
 * Returns `null` when no eligible LOD covers the distance; callers must fail
 * closed rather than substitute a different asset.
 */
export function selectExteriorLod(
  lods: readonly AssemblyLod[],
  profile: ExteriorRenderProfile,
  distanceMeters: number,
): AssemblyLod | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (!isMonotoneAssemblyLodOrder(lods)) return null;
  const candidates = lods.filter((lod) => lod.eligible && covers(lod, distanceMeters));
  if (candidates.length === 0) return null;
  if (profile === "inspection") return candidates[0]!;
  // Thresholds are nondecreasing, so the coarsest candidate is the last one and
  // the tied group it may belong to is a contiguous suffix. Walking back over
  // that suffix lands on the finest member of the coarsest DISTINGUISHED group.
  const coarsest = candidates[candidates.length - 1]!;
  let index = candidates.length - 1;
  while (index > 0 && threshold(candidates[index - 1]!) === threshold(coarsest)) index -= 1;
  return candidates[index]!;
}
