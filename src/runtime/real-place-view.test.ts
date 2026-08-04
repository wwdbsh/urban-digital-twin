import { describe, expect, it } from "vitest";
import restaurants from "../../public/data/real-wave-20260804/restaurants.json";
import type { Feature } from "../domain/schema";
import {
  compareInspectionSummaries,
  isRealPlaceFeature,
  parseRealPlaceFeature,
  selectLatestInspectionSummary,
  type RealPlaceInspectionSummary,
} from "./real-place-view";

const features = restaurants as unknown as Feature[];
const donut = features.find((feature) => feature.name === "DONUT PUB")!;
const groceries = features.find((feature) => feature.name === "O & G GROCERIES")!;

describe("real browser place projection", () => {
  it("parses the approved inspection summary and source identity without full history", () => {
    const view = parseRealPlaceFeature(donut);
    expect(view.fixtureOnly).toBe(false);
    expect(view.categories).toEqual(["restaurant"]);
    expect(view.address.formatted).toBe("203 WEST 14 STREET, New York, NY 10011");
    expect(view.address.postalCode).toBe("10011");
    expect(view.cuisine).toBe("Donuts");
    expect(view.sourceRecordIds).toEqual(["dohmh:40365525:0e6096543c6e29e12747eaf6"]);
    expect(view.latestInspection).toMatchObject({ camis: "40365525", inspectionDate: "2025-08-11", inspectionDateStatus: "usable", grade: "A", score: "7" });
    expect(view.inspectionObservationCount).toBe(24);
    expect(view.sourceLicenses[0]?.termsUrl).toBe("https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw");
    expect(view.diagnostics).toEqual([]);
  });

  it("renders DOHMH's 1900-01-01 sentinel as not yet inspected", () => {
    const view = parseRealPlaceFeature(groceries);
    expect(view.contact.phone).toBeNull();
    expect(view.cuisine).toBeNull();
    expect(view.latestInspection).toMatchObject({ camis: "40357297", inspectionDate: null, inspectionDateStatus: "not-yet-inspected", recordDate: "2026-08-03T06:00:20.000" });
    expect(view.latestInspection?.grade).toBeNull();
    expect(view.latestInspection?.score).toBeNull();
  });

  it("keeps malformed optional JSON explicit and does not assert a value", () => {
    const malformed = { ...donut, attributes: { ...donut.attributes, placeLicenses: "{bad", placeLatestInspection: "[]", placeSourceRecordIds: "not-json" } };
    const view = parseRealPlaceFeature(malformed);
    expect(view.sourceLicenses).toEqual([]);
    expect(view.sourceRecordIds).toEqual(["dohmh:40365525:0e6096543c6e29e12747eaf6"]);
    expect(view.latestInspection).toBeNull();
    expect(view.diagnostics.join(" ")).toMatch(/placeLicenses|placeLatestInspection|placeSourceRecordIds/);
  });

  it("orders latest summaries by inspection date, then record date, then stable source ID", () => {
    const summary = (sourceRecordId: string, inspectionDate: string | null, recordDate: string | null): RealPlaceInspectionSummary => ({ camis: "40365525", sourceRecordId, inspectionDate, inspectionDateStatus: inspectionDate ? "usable" : "unknown", recordDate, grade: null, score: null, action: null, inspectionType: null });
    const olderInspectionWithNewerRecord = summary("b", "2025-01-01", "2026-09-01");
    const newerInspection = summary("a", "2025-08-11", "2026-01-01");
    const tie = summary("z", "2025-08-11", "2026-01-01");
    expect(compareInspectionSummaries(newerInspection, olderInspectionWithNewerRecord)).toBeGreaterThan(0);
    expect(selectLatestInspectionSummary([olderInspectionWithNewerRecord, newerInspection, tie])).toBe(tie);
  });

  it("derives CAMIS from a DOHMH source record when a summary omits it", () => {
    const omitted = { ...donut, attributes: { ...donut.attributes, placeLatestInspection: JSON.stringify({ inspectionDate: "2025-08-11", recordDate: null }) } };
    expect(parseRealPlaceFeature(omitted).latestInspection?.camis).toBe("40365525");
  });

  it.each(["2025-02-29T00:00:00.000", "2025-02-30T00:00:00.000"])("rejects impossible inspection calendar date %s without normalization", (inspectionDate) => {
    const invalid = {
      ...donut,
      attributes: {
        ...donut.attributes,
        placeLatestInspection: JSON.stringify({ camis: "40365525", inspectionDate, recordDate: "2026-08-03T06:00:15.000", grade: "A" }),
      },
    };
    const view = parseRealPlaceFeature(invalid);
    expect(view.latestInspection?.inspectionDate).toBeNull();
    expect(view.latestInspection?.inspectionDateStatus).toBe("unknown");
    expect(view.latestInspection?.recordDate).toBe("2026-08-03T06:00:15.000");
    expect(view.diagnostics.join(" ")).toMatch(/inspectionDate is malformed/);
  });

  it("rejects an impossible record calendar date without normalizing it", () => {
    const invalid = {
      ...donut,
      attributes: {
        ...donut.attributes,
        placeLatestInspection: JSON.stringify({ camis: "40365525", inspectionDate: "2025-08-11T00:00:00.000", recordDate: "2025-02-30T06:00:15.000", grade: "A" }),
      },
    };
    const view = parseRealPlaceFeature(invalid);
    expect(view.latestInspection?.inspectionDate).toBe("2025-08-11");
    expect(view.latestInspection?.recordDate).toBeNull();
    expect(view.diagnostics.join(" ")).toMatch(/recordDate is malformed/);
  });

  it("refuses a POI whose source registry is not the pinned DOHMH release", () => {
    const nonDohmh = {
      ...donut,
      sourceRefs: donut.sourceRefs.map((source) => ({ ...source, registryEntryId: "nyc.building-footprints" })),
    };
    expect(isRealPlaceFeature(nonDohmh)).toBe(false);
    expect(() => parseRealPlaceFeature(nonDohmh)).toThrow(/fixture-only/);
  });

  it("refuses fixture-role source references even when the registry is DOHMH", () => {
    const fixtureSource = {
      ...donut,
      sourceRefs: donut.sourceRefs.map((source) => ({ ...source, role: "fixture" as const })),
    };
    expect(isRealPlaceFeature(fixtureSource)).toBe(false);
    expect(() => parseRealPlaceFeature(fixtureSource)).toThrow(/fixture-only/);
  });

  it("filters license entries whose source ref is not present from trusted links", () => {
    const licenses = JSON.parse(String(donut.attributes.placeLicenses)) as Array<Record<string, string>>;
    const mismatched = {
      ...donut,
      attributes: {
        ...donut.attributes,
        placeLicenses: JSON.stringify([
          licenses[0],
          { ...licenses[0], sourceRefId: "source-ref:other-provider:unverified" },
        ]),
      },
    };
    const view = parseRealPlaceFeature(mismatched);
    expect(view.sourceLicenses).toEqual([licenses[0]]);
    expect(view.diagnostics.join(" ")).toMatch(/placeLicenses references a source ref not present/);
  });
});
