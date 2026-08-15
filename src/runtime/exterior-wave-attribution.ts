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
export function exteriorNotShippedSummary(
  cells: readonly ExteriorCellOutcome[],
  declared?: { cellCount: number; notShippedCellCount: number },
): string | null {
  // BOTH TERMS ARE RELEASE FACTS, or neither is — and the LINE ITSELF is a
  // release fact too, so `cells` is not consulted at all when the release can
  // answer.
  //
  // `cells` is what the last reconciliation touched, which under the visibility
  // scheduler is a CAMERA fact in both terms: the same release read "121 of
  // 123" at one pose and "11 of 12" at the next. Anchoring only the
  // denominator would be worse than leaving it alone — "11 of 149" states that
  // 138 declared cells DO ship geometry, which is false for a release that
  // declares 146 of its 149 empty.
  //
  // Deriving only the NUMBERS from the release while still gating the line's
  // EXISTENCE on the reconciliation would keep the same defect in a quieter
  // form: at a camera that happens to reconcile no unshipped cell the line
  // disappears and then reappears on the way back, so a permanent property of
  // the build would blink with the camera. A release fact is stated whenever it
  // is true.
  //
  // T007: WHAT THE SENTENCE SAYS ABOUT THE SCREEN. Before the citywide default
  // flip these cells were the whole story — nothing at all was drawn for them
  // and "no substitute was selected" was the truth. After the flip their
  // buildings DO draw, as sourced base massing streamed from the citywide dense
  // shards, so the old wording was false by omission: it read as "nothing is
  // there" about buildings the reader can see.
  //
  // The sentence therefore has TWO CLAUSES, and they are load-bearing in
  // different ways.
  //
  //   FIRST CLAUSE — "ship no generated exterior geometry". A pure release
  //   fact, true in EVERY arm and at every camera. This is the clause the
  //   journey CLIs assert on, precisely because it cannot become false when a
  //   session is configured differently.
  //
  //   SECOND CLAUSE — "WHERE THE CITYWIDE BASE TIER IS ACTIVE, their buildings
  //   draw as sourced base massing …". Conditional wording, and the condition
  //   is not decoration. Under `?exteriorScheduler=off` the overview residency
  //   is withdrawn (`overviewResidencyActive` false, 5,289 drawn rather than
  //   41,841), so an unconditional "their buildings draw as sourced base
  //   massing" is affirmatively FALSE in the rollback arm — it would claim
  //   ~41k buildings are on screen that are not.
  //
  // The condition is expressed in WORDS rather than plumbed from a session
  // flag, deliberately. Reading the arm here would make the string vary with
  // session state, and `notShippedLines` feeds `dismissalKey`: a line that
  // changes with configuration re-arms a notice the reader already dismissed
  // (the defect PR #64 fixed) and gives the digest two strings to recognize
  // instead of one. One stable sentence, true in both arms, costs a clause.
  //
  // The line stays UNCONDITIONAL in the sense that matters: both counts are
  // release facts, nothing is gated on dense residency or on the camera, and
  // the line is emitted whenever it is true.
  if (declared && declared.cellCount > 0) {
    return declared.notShippedCellCount > 0
      ? `${declared.notShippedCellCount} of ${declared.cellCount} exterior cells declared by this release ship no generated exterior geometry; where the citywide base tier is active, their buildings draw as sourced base massing (footprint extruded to sourced height), which is not a generated exterior.`
      : null;
  }
  const notShipped = cells.filter((cell) => cell.kind === "not-shipped");
  if (notShipped.length === 0) return null;
  if (notShipped.length === 1) return notShipped[0]!.notice;
  return `${notShipped.length} of ${cells.length} exterior cells declared by this release ship no generated exterior geometry; where the citywide base tier is active, their buildings draw as sourced base massing (footprint extruded to sourced height), which is not a generated exterior.`;
}

/**
 * The two camera-scoped populations, kept OUT of the release fact above.
 *
 * A deferred cell is one nobody asked for at this camera; an evicted artifact
 * is one that was resident and was released to stay inside the session's byte
 * budget. Neither is a defect and neither is permanent — both recover by
 * moving the camera — so both state their recovery in their own sentence
 * rather than borrowing the tombstone's register.
 *
 * They are separate functions, and separately pattern-matched, so the notice
 * digest can update them in place without re-arming a dismissed notice: a
 * count that changes with every pan must never resurrect a disclosure the
 * reader already read.
 */
export function exteriorDeferredCellNotice(deferredCellCount: number): string | null {
  if (!Number.isFinite(deferredCellCount) || deferredCellCount <= 0) return null;
  return `${deferredCellCount} exterior cell${deferredCellCount === 1 ? " is" : "s are"} not loaded for this camera; they load when the camera reaches them.`;
}

export function exteriorReleasedArtifactNotice(releasedArtifactCount: number): string | null {
  if (!Number.isFinite(releasedArtifactCount) || releasedArtifactCount <= 0) return null;
  return `${releasedArtifactCount} exterior artifact${releasedArtifactCount === 1 ? " was" : "s were"} released to stay within the session cache budget; ${releasedArtifactCount === 1 ? "it reloads" : "they reload"} on re-entry.`;
}
