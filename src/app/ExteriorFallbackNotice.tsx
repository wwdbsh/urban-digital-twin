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
  readonly entryCount: number;
  /** The bounded-availability aggregate (ADR 0029), summed across releases. */
  readonly notShipped: {
    readonly summary: string;
    readonly cellCount: number;
    readonly totalCellCount: number;
    readonly lines: readonly DigestLine[];
  } | null;
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
 */
const NOT_SHIPPED_PATTERN = /^(?:Exterior release (.+?): )?(\d+) of (\d+) exterior cells ship no exterior geometry in this release; no substitute was selected for them\.$/u;

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
  let notShippedCells = 0;
  let notShippedTotal = 0;

  for (const entry of entries) {
    const key = exteriorNoticeEntryKey(entry);
    const tombstone = NOT_SHIPPED_PATTERN.exec(entry.notice);
    if (tombstone) {
      notShippedCells += Number(tombstone[2]);
      notShippedTotal += Number(tombstone[3]);
      notShippedLines.push({ key, text: entry.notice });
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
    entryCount: entries.length,
    notShipped: notShippedLines.length > 0
      ? {
        summary: `${notShippedCells} of ${notShippedTotal} exterior cells ship no exterior geometry in this build (by design; no substitute was selected).`,
        cellCount: notShippedCells,
        totalCellCount: notShippedTotal,
        lines: notShippedLines,
      }
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
  if (digest.entryCount === 0 || digest.key === dismissedKey) return null;
  return <div className="exploration-notice exploration-notice--exterior" role="status" data-exterior-notices={digest.entryCount}>
    <strong>Exterior streaming fallback</strong> <button type="button" onClick={() => setDismissedKey(digest.key)}>Dismiss</button>
    <ul>
      {digest.verbatim.map((line) => <li key={line.key} data-exterior-notice-verbatim>{line.text}</li>)}
      {digest.notShipped && <li data-exterior-notice-not-shipped={digest.notShipped.cellCount}>
        {digest.notShipped.summary}
        <details>
          <summary>Details by release</summary>
          <ul>{digest.notShipped.lines.map((line) => <li key={line.key} data-exterior-notice-release-line>{line.text}</li>)}</ul>
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
