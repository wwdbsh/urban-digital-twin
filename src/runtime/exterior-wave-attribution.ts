/**
 * Per-wave attribution rules for a build that promotes more than one exterior
 * wave.
 *
 * These live outside `App.tsx` so they can be tested without importing the
 * application module graph. That is not only tidiness: a second test file that
 * imports `App` pulls the whole Cesium-bearing graph into another worker and
 * intermittently destabilises the timing-sensitive focus tests already in
 * `App.test.tsx`.
 */
import type { ExteriorCellOutcome } from "./exterior-cell-runtime";

/**
 * Which promoted wave a details panel may attribute a selection to.
 *
 * The SELECTED feature's own wave answers whenever one of them rendered it. A
 * selection with no exterior representation falls back to the session's single
 * wave, and answers nothing when several are streaming — picking one of them
 * would be a guess presented as provenance.
 */
export function exteriorWaveForSelection<T extends { outcomes: readonly ExteriorCellOutcome[] }>(
  activeWaves: readonly T[],
  selectedFeatureId: string | null,
): T | null {
  const owning = selectedFeatureId === null ? undefined : activeWaves.find((entry) => entry.outcomes.some(
    (cell) => cell.kind === "rendered" && cell.assets.some((asset) => asset.canonicalFeatureId === selectedFeatureId),
  ));
  return owning ?? (activeWaves.length === 1 ? activeWaves[0]! : null);
}

/**
 * Every wave-produced notice names the release that produced it. Two waves emit
 * otherwise identical lines, and a reader cannot act on a fallback notice
 * without knowing which release it is about, so the release is named
 * unconditionally rather than only once a second wave happens to be streaming.
 */
export function exteriorQualifiedNotice(releaseId: string, notice: string): string {
  return `Exterior release ${releaseId}: ${notice}`;
}

/**
 * The bounded-availability aggregate (ADR 0029). A release may deliberately
 * ship a large number of cells with no exterior geometry; those are not
 * failures, and one alarming bullet each would drown the genuine failures that
 * keep their own per-cell lines. One cell states itself.
 */
export function exteriorNotShippedSummary(cells: readonly ExteriorCellOutcome[]): string | null {
  const notShipped = cells.filter((cell) => cell.kind === "not-shipped");
  if (notShipped.length === 0) return null;
  return notShipped.length === 1
    ? notShipped[0]!.notice
    : `${notShipped.length} of ${cells.length} exterior cells ship no exterior geometry in this release; no substitute was selected for them.`;
}
