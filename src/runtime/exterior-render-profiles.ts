import type { AssemblyLod } from "../release/multi-lod-assembly.ts";

/**
 * Runtime LOD policy only. Profiles are a browser-side selection over the LODs
 * an immutable assembly package already declares; they never widen a manifest,
 * never add a schema field, and never change which artifacts are eligible.
 */
export const EXTERIOR_RENDER_PROFILES = ["exploration", "inspection"] as const;
export type ExteriorRenderProfile = (typeof EXTERIOR_RENDER_PROFILES)[number];
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

/**
 * Deterministic per-profile LOD choice.
 *
 * - `inspection` takes the finest eligible LOD whose declared `maxDistanceMeters`
 *   still covers the camera distance.
 * - `exploration` takes the coarsest eligible LOD that covers the same distance;
 *   because thresholds are nondecreasing, every LOD at or after the finest
 *   covering index also covers it, so this is the coarsest legal representation.
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
  return profile === "inspection" ? candidates[0]! : candidates[candidates.length - 1]!;
}
