// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExteriorSelectedFeatureDetail, type ExteriorSelectionSource } from "./App";
import type { ExteriorRefusedBuilding } from "../runtime/exterior-cell-runtime";

afterEach(cleanup);

/** A real shipped reason, copied verbatim from the committed wave census. */
const REAL_REASON = "Refused by the footprint-faithful V3 exterior grammar [ring-area-below-floor]: geometry.footprint.outer: V3 ring area is below the footprint area floor.. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.";

const REFUSAL: ExteriorRefusedBuilding = {
  buildingId: "doitt:1290701",
  reason: REAL_REASON,
  tombstoneId: "tombstone:manhattan-midtown-core-cells-20260811-v3-s1:doitt:1290701",
  cellId: "manhattan-exterior-cell-w01-000125-16-19300-17927",
  cellReleaseId: "cell-release:manhattan-midtown-core-cells-20260811-v3-s1:manhattan-exterior-cell-w01-000125-16-19300-17927:v1",
  releaseId: "manhattan-midtown-core-cells-20260811-v3-s1",
};

function source(options: { refused?: ExteriorRefusedBuilding | null; promoted?: readonly string[] } = {}): ExteriorSelectionSource {
  return {
    refusedBuilding: (buildingId) => (options.refused && options.refused.buildingId === buildingId ? options.refused : null),
    // Sorted, because the real accessor returns a sorted array and the
    // membership check is a binary search over it.
    promotedBuildingIds: () => [...(options.promoted ?? [])].sort(),
  };
}

const renderRow = (selectedId: string | null, runtimes: readonly ExteriorSelectionSource[]) =>
  render(<dl><ExteriorSelectedFeatureDetail selectedId={selectedId} runtimes={runtimes} /></dl>);

/**
 * The three cases the row used to collapse into one sentence.
 *
 * Each asserts its own marker AND the absence of the other two, because the
 * failure that matters is not "the wording is wrong" — it is a refused building
 * being described as still loading, or a loadable one being described as
 * permanently absent.
 */
describe("ExteriorSelectedFeatureDetail", () => {
  it("(a) REFUSED: names the release, the tombstone, the stop code and the reason", () => {
    const { container } = renderRow("doitt:1290701", [source({ refused: REFUSAL })]);

    const row = container.querySelector("[data-exterior-refusal]");
    expect(row).not.toBeNull();
    expect(container.querySelector("[data-exterior-not-resident]")).toBeNull();
    expect(container.querySelector("[data-exterior-not-owned]")).toBeNull();

    expect(row!.getAttribute("data-exterior-stop-code")).toBe("ring-area-below-floor");
    expect(container.querySelector("[data-exterior-tombstone-id]")!.textContent).toBe(REFUSAL.tombstoneId);
    // The release is named in the app's own leading sentence, not only inside
    // the identifiers. Queried on that paragraph specifically: the id also
    // appears in the tombstone and cell-release rows, so a document-wide text
    // query would match three nodes and prove nothing about the sentence.
    const intro = row!.querySelector("p.section-label")!;
    expect(intro.textContent).toContain("manhattan-midtown-core-cells-20260811-v3-s1");
    expect(intro.textContent).toContain("refused");
    expect(container.querySelector("[data-exterior-refusal] dd [data-exterior-tombstone-id]")).not.toBeNull();
    // Permanence stated, because that is the actionable half.
    expect(row!.textContent).toContain("approaching it will not produce any");
    // The measured gate value survives into the panel.
    expect(container.querySelector("[data-exterior-refusal-statement]")!.textContent).toContain("V3 ring area is below the footprint area floor");
  });

  it("(b) NOT RESIDENT: says the asset ships and is recoverable by approaching", () => {
    const { container } = renderRow("doitt:999001", [source({ promoted: ["doitt:111", "doitt:999001", "doitt:zzz"] })]);

    const row = container.querySelector("[data-exterior-not-resident]");
    expect(row).not.toBeNull();
    expect(container.querySelector("[data-exterior-refusal]")).toBeNull();
    expect(container.querySelector("[data-exterior-not-owned]")).toBeNull();
    expect(row!.textContent).toContain("Move closer to load it");
    // The old sentence asserted permanent absence and was WRONG here. It must
    // not be what this case renders.
    expect(row!.textContent).not.toContain("No verified exterior representation is active");
  });

  it("(c) NOT OWNED: keeps the existing wording", () => {
    const { container } = renderRow("doitt:404404", [source({ promoted: ["doitt:111"] })]);

    const row = container.querySelector("[data-exterior-not-owned]");
    expect(row).not.toBeNull();
    expect(container.querySelector("[data-exterior-refusal]")).toBeNull();
    expect(container.querySelector("[data-exterior-not-resident]")).toBeNull();
    expect(row!.textContent).toBe("Selected featureNo verified exterior representation is active for this record.");
  });

  it("finds a refusal in ANY active wave, not just the first", () => {
    // The six-wave case. Attribution returns null here, which is exactly why
    // the lookup walks the runtimes directly.
    const { container } = renderRow("doitt:1290701", [
      source({ promoted: ["doitt:111"] }),
      source({ promoted: ["doitt:222"] }),
      source({ refused: REFUSAL }),
    ]);
    expect(container.querySelector("[data-exterior-refusal]")).not.toBeNull();
  });

  it("falls back to not-owned when nothing is selected", () => {
    const { container } = renderRow(null, [source({ refused: REFUSAL })]);
    expect(container.querySelector("[data-exterior-not-owned]")).not.toBeNull();
  });

  it("marks a stop code outside the closed vocabulary as unrecognized instead of echoing it", () => {
    const { container } = renderRow("doitt:1290701", [source({
      refused: { ...REFUSAL, reason: "Refused by some future grammar [brand-new-category]: something happened." },
    })]);
    const row = container.querySelector("[data-exterior-refusal]")!;
    expect(row.getAttribute("data-exterior-stop-code")).toBe("unrecognized");
    expect(row.textContent).toContain("not a refusal category this build recognizes");
  });
});

/**
 * H1 IN THE RENDERED DOM.
 *
 * The clause "base massing from the pinned citywide release is what remains on
 * screen" is false under `?exteriorScheduler=off`. The panel may QUOTE it as the
 * release's words; it may not ASSERT it. These two tests are the difference.
 */
describe("ExteriorSelectedFeatureDetail H1 (arm-dependent clause)", () => {
  it("never asserts the arm-dependent clause as the app's own claim", () => {
    const { container } = renderRow("doitt:1290701", [source({ refused: REFUSAL })]);
    const asserted = container.querySelector("[data-exterior-refusal-statement]")!;
    expect(asserted.textContent).not.toContain("base massing");
    expect(asserted.textContent).not.toContain("what remains on screen");
    // Everything true in BOTH arms is kept.
    expect(asserted.textContent).toContain("No geometry was invented for this building");
  });

  it("still shows the full sentence, explicitly attributed to the release", () => {
    // Truncating without disclosing would hide what the release actually says.
    const { container } = renderRow("doitt:1290701", [source({ refused: REFUSAL })]);
    const quotation = container.querySelector("[data-exterior-refusal-quotation]")!;
    expect(quotation.textContent).toContain("Recorded by the release, verbatim");
    expect(quotation.textContent).toContain("base massing from the pinned citywide release is what remains on screen");
  });
});
