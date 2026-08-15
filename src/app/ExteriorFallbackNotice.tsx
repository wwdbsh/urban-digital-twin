/**
 * The "Exterior streaming fallback" notice.
 *
 * The truthfulness invariant is unchanged: content this build does not ship
 * stays explicitly disclosed, and no notice text is ever dropped. What changes
 * is the SHAPE of the disclosure. A six-wave default session emits one
 * near-identical tombstone line per promoted release plus one anchor-residency
 * line that named every withheld building inline, and the resulting box covered
 * the map it was describing. A disclosure that hides the city is not a better
 * disclosure.
 *
 * So the recognized shapes are digested: the per-release tombstones collapse
 * into one aggregate line whose numbers are SUMMED FROM THE ENTRIES (never
 * hardcoded), and the withheld-anchor list collapses to its count. Both keep
 * their full original text one click away in a native `<details>`, so the
 * document still contains every word it contained before — which is also why
 * text-scraping journey tools keep reading the same sentences.
 *
 * Anything that matches neither shape is rendered verbatim. Failing open to
 * full disclosure is the only safe direction: an unrecognized notice is far
 * more likely to be a genuine per-cell failure than noise.
 */
import { useState } from "react";

/** One wave-attributed notice, exactly as `App` composes it. */
export type ExteriorNoticeEntry = {
  readonly releaseId: string;
  readonly notice: string;
};

type DigestLine = {
  readonly key: string;
  readonly text: string;
};

export type ExteriorNoticeDigest = {
  /** Identity of THIS notice set, so a dismissal cannot silence a different one. */
  readonly key: string;
  /**
   * The DISMISSAL key, and the reason it is not `key`.
   *
   * `key` moves whenever any line moves, and two of the three populations are
   * camera-scoped: the deferred count changes on every pan and the evicted
   * count changes on every budget release. Keying dismissal on `key` would
   * re-open a notice the reader dismissed, every time they moved — a dismiss
   * button that does not stay dismissed. So dismissal is keyed on the RELEASE
   * facts only (not-shipped, residency, verbatim), which change when the build
   * or the wave set changes and not when the camera does. The camera-scoped
   * counts still update in place inside an undismissed notice.
   */
  readonly dismissalKey: string;
  readonly entryCount: number;
  /** The bounded-availability aggregate (ADR 0029), summed across releases. */
  readonly notShipped: {
    readonly summary: string;
    readonly cellCount: number;
    readonly totalCellCount: number;
    readonly lines: readonly DigestLine[];
  } | null;
  /** Cells nobody asked for at THIS camera. Recoverable by moving the camera. */
  readonly deferred: { readonly key: string; readonly cellCount: number; readonly lines: readonly DigestLine[] } | null;
  /** Artifacts that WERE resident and were released to stay inside the budget. */
  readonly evicted: { readonly key: string; readonly artifactCount: number; readonly lines: readonly DigestLine[] } | null;
  /** Verified geometry withheld for want of a resident base anchor. */
  readonly residency: readonly {
    readonly key: string;
    readonly summary: string;
    readonly buildingIds: readonly string[];
  }[];
  /** Every entry matching neither shape, in its original order and wording. */
  readonly verbatim: readonly DigestLine[];
};

/**
 * `exteriorNotShippedSummary` composes this sentence and
 * `exteriorQualifiedNotice` prefixes the release; both halves are optional here
 * so a future unqualified caller still digests. A single not-shipped cell
 * states itself in its own words and deliberately does NOT match — it falls
 * through to verbatim rather than being restated as an aggregate of one.
 *
 * T007 reworded the composed sentence to say what draws for those cells. This
 * pattern is one of the three sites that had to move with it: a pattern left
 * behind would not have thrown, it would have quietly routed every tombstone
 * into `verbatim`, restoring the six-wave wall of text this digest exists to
 * replace.
 */
const NOT_SHIPPED_PATTERN = /^(?:Exterior release (.+?): )?(\d+) of (\d+) exterior cells declared by this release ship no generated exterior geometry; where the citywide base tier is active, their buildings draw as sourced base massing \(footprint extruded to sourced height\), which is not a generated exterior\.$/u;

/**
 * `exteriorDeferredCellNotice` / `exteriorReleasedArtifactNotice`. Kept as two
 * patterns rather than one because the two populations mean different things:
 * a deferred cell was never fetched, an evicted artifact was fetched, drawn,
 * and released. Collapsing them would report a cache decision as a coverage
 * gap — the exact conflation the not-shipped denominator fix removes.
 */
const DEFERRED_PATTERN = /^(?:Exterior release (.+?): )?(\d+) exterior cells? (?:is|are) not loaded for this camera; they load when the camera reaches them\.$/u;
const EVICTED_PATTERN = /^(?:Exterior release (.+?): )?(\d+) exterior artifacts? (?:was|were) released to stay within the session cache budget; (?:it reloads|they reload) on re-entry\.$/u;

/** `exteriorUnanchoredNotice`: count, inline ID list, then the reason. */
const RESIDENCY_PATTERN = /^Exterior geometry for (\d+) verified buildings? \(([^()]*)\) is not drawn: (.+)$/u;

export function exteriorNoticeEntryKey(entry: ExteriorNoticeEntry): string {
  return `${entry.releaseId}|${entry.notice}`;
}

/**
 * Sort the recognized shapes out of a notice set.
 *
 * Order of the rendered result is deliberate: verbatim entries come first
 * because that is where a real per-cell failure lands, and the two aggregates
 * are by-design states that must be visible but must not outrank a failure.
 */
export function digestExteriorNotices(entries: readonly ExteriorNoticeEntry[]): ExteriorNoticeDigest {
  const notShippedLines: DigestLine[] = [];
  const residency: { key: string; summary: string; buildingIds: readonly string[] }[] = [];
  const verbatim: DigestLine[] = [];
  const deferredLines: DigestLine[] = [];
  const evictedLines: DigestLine[] = [];
  let notShippedCells = 0;
  let notShippedTotal = 0;
  let deferredCells = 0;
  let evictedArtifacts = 0;

  for (const entry of entries) {
    const key = exteriorNoticeEntryKey(entry);
    const tombstone = NOT_SHIPPED_PATTERN.exec(entry.notice);
    if (tombstone) {
      notShippedCells += Number(tombstone[2]);
      notShippedTotal += Number(tombstone[3]);
      notShippedLines.push({ key, text: entry.notice });
      continue;
    }
    const deferred = DEFERRED_PATTERN.exec(entry.notice);
    if (deferred) {
      deferredCells += Number(deferred[2]);
      deferredLines.push({ key, text: entry.notice });
      continue;
    }
    const evicted = EVICTED_PATTERN.exec(entry.notice);
    if (evicted) {
      evictedArtifacts += Number(evicted[2]);
      evictedLines.push({ key, text: entry.notice });
      continue;
    }
    const withheld = RESIDENCY_PATTERN.exec(entry.notice);
    if (withheld) {
      const buildingIds = withheld[2]!.split(", ").filter((id) => id.length > 0);
      // The declared count and the list must agree before either is restated.
      // If they disagree the notice is not the shape this branch understands,
      // and the honest response is the original sentence, not a repair.
      if (buildingIds.length === Number(withheld[1])) {
        residency.push({
          key,
          summary: `Exterior geometry for ${buildingIds.length} verified building${buildingIds.length === 1 ? "" : "s"} is not drawn: ${withheld[3]}`,
          buildingIds,
        });
        continue;
      }
    }
    verbatim.push({ key, text: entry.notice });
  }

  return {
    key: entries.map(exteriorNoticeEntryKey).join("\n"),
    // Release facts only. The two camera-scoped populations are deliberately
    // absent so a pan cannot re-arm a dismissed notice (E2).
    dismissalKey: [...notShippedLines, ...verbatim].map((line) => line.key).concat(residency.map((entry) => entry.key)).join("\n"),
    entryCount: entries.length,
    notShipped: notShippedLines.length > 0
      ? {
        summary: `${notShippedCells} of ${notShippedTotal} exterior cells declared by this build ship no generated exterior geometry (by design); where the citywide base tier is active, their buildings draw as sourced base massing (footprint extruded to sourced height), which is not a generated exterior.`,
        cellCount: notShippedCells,
        totalCellCount: notShippedTotal,
        lines: notShippedLines,
      }
      : null,
    deferred: deferredLines.length > 0
      ? { key: deferredLines.map((line) => line.key).join("\n"), cellCount: deferredCells, lines: deferredLines }
      : null,
    evicted: evictedLines.length > 0
      ? { key: evictedLines.map((line) => line.key).join("\n"), artifactCount: evictedArtifacts, lines: evictedLines }
      : null,
    residency,
    verbatim,
  };
}

/**
 * `role="status"` rather than `role="alert"`.
 *
 * On a promoted six-wave session this notice is present from the first paint of
 * every visit and its content does not change; an assertive live region there
 * interrupts a screen-reader user to announce a permanent, by-design condition,
 * which is the definition of alert noise. Polite status keeps it announced
 * without seizing the reader, and the dismiss control gives it an exit. The
 * `data-exterior-notices` hook is unchanged for tests and journey tooling.
 */
export function ExteriorFallbackNotice({ entries }: { entries: readonly ExteriorNoticeEntry[] }) {
  // Dismissal is session-local UI state keyed by the notice set itself, so a
  // dismissal silences exactly what the reader read. A wave that later adds or
  // changes a notice produces a different key and shows again.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const digest = digestExteriorNotices(entries);
  if (digest.entryCount === 0 || digest.dismissalKey === dismissedKey) return null;
  return <div className="exploration-notice exploration-notice--exterior" role="status" data-exterior-notices={digest.entryCount}>
    <strong>Exterior streaming fallback</strong> <button type="button" onClick={() => setDismissedKey(digest.dismissalKey)}>Dismiss</button>
    <ul>
      {digest.verbatim.map((line) => <li key={line.key} data-exterior-notice-verbatim>{line.text}</li>)}
      {digest.notShipped && <li data-exterior-notice-not-shipped={digest.notShipped.cellCount}>
        {digest.notShipped.summary}
        <details>
          <summary>Details by release</summary>
          <ul>{digest.notShipped.lines.map((line) => <li key={line.key} data-exterior-notice-release-line>{line.text}</li>)}</ul>
        </details>
      </li>}
      {digest.deferred && <li data-exterior-notice-deferred={digest.deferred.cellCount}>
        {`${digest.deferred.cellCount} exterior cell${digest.deferred.cellCount === 1 ? " is" : "s are"} not loaded for this camera; they load when the camera reaches them.`}
        <details>
          <summary>Details by release</summary>
          <ul>{digest.deferred.lines.map((line) => <li key={line.key} data-exterior-notice-release-line>{line.text}</li>)}</ul>
        </details>
      </li>}
      {digest.evicted && <li data-exterior-notice-evicted={digest.evicted.artifactCount}>
        {`${digest.evicted.artifactCount} exterior artifact${digest.evicted.artifactCount === 1 ? " was" : "s were"} released to stay within the session cache budget; ${digest.evicted.artifactCount === 1 ? "it reloads" : "they reload"} on re-entry.`}
        <details>
          <summary>Details by release</summary>
          <ul>{digest.evicted.lines.map((line) => <li key={line.key} data-exterior-notice-release-line>{line.text}</li>)}</ul>
        </details>
      </li>}
      {digest.residency.map((withheld) => <li key={withheld.key} data-exterior-notice-residency={withheld.buildingIds.length}>
        {withheld.summary}
        <details>
          <summary>Show the {withheld.buildingIds.length} building ID{withheld.buildingIds.length === 1 ? "" : "s"}</summary>
          <p className="exterior-notice-ids">{withheld.buildingIds.join(", ")}</p>
        </details>
      </li>)}
    </ul>
  </div>;
}
