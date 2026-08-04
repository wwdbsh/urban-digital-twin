import { describe, expect, it } from "vitest";
import { placeTruthFixtures } from "./place-truth-fixtures";
import {
  evaluatePlaceHours,
  validatePlaceTruthRecord,
  type PlaceTruthHours,
} from "./place-truth";

const coffee = placeTruthFixtures[0]!;
const market = placeTruthFixtures[1]!;
const gallery = placeTruthFixtures[2]!;

describe("provider-neutral place truth", () => {
  it("validates all fixture records and keeps localization, categories, and field lineage", () => {
    expect(placeTruthFixtures.every((place) => validatePlaceTruthRecord(place).ok)).toBe(true);
    expect(coffee.localizedNames.find((name) => name.language === "ko")?.value).toBe("카페 픽스처");
    expect(coffee.categories).toEqual(["cafe", "restaurant"]);
    expect(coffee.lineage.find((field) => field.field === "address")?.sourceRefIds).toHaveLength(1);
  });

  it("rejects unsourced asserted values and inline imagery blobs", () => {
    const invalid = {
      ...coffee,
      commercial: {
        ...coffee.commercial,
        rating: { ...coffee.commercial.rating, status: "known", value: 4.8, sourceRefIds: [], observationIds: [] },
      },
      imagery: {
        ...coffee.imagery,
        status: "known",
        value: [{ kind: "photo", uri: "data:image/png;base64,not-stored", attribution: "none", author: null, observedAt: null, sourceRefIds: [] }],
      },
    };
    const result = validatePlaceTruthRecord(invalid);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((item) => item.path)).toEqual(expect.arrayContaining(["commercial.rating.sourceRefIds", "imagery"]));
  });

  it("rejects malformed localization lineage and unsupported business states", () => {
    const invalid = {
      ...coffee,
      localizedNames: [{ ...coffee.localizedNames[0]!, value: 42, sourceRefIds: [] }],
      commercial: {
        ...coffee.commercial,
        businessStatus: { ...coffee.commercial.businessStatus, status: "known", value: "operating", sourceRefIds: ["fixture"] },
      },
    };
    const result = validatePlaceTruthRecord(invalid);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((item) => item.path)).toEqual(expect.arrayContaining(["localizedNames", "commercial.businessStatus.value"]));
  });

  it("evaluates overnight periods using the previous local day", () => {
    const hours: PlaceTruthHours = {
      status: "known",
      timezone: "America/New_York",
      raw: "Mon 22:00-02:00",
      periods: { status: "known", value: [{ day: 0, opens: "22:00", closes: "02:00" }], sourceRefIds: ["fixture"], observationIds: ["observation"], observedAt: null, publishedAt: null, validFrom: null, validTo: null, confidence: 1, uncertainty: "fixture" },
      specialDates: { status: "known", value: [], sourceRefIds: ["fixture"], observationIds: ["observation"], observedAt: null, publishedAt: null, validFrom: null, validTo: null, confidence: 1, uncertainty: "fixture" },
    };
    expect(evaluatePlaceHours(hours, "2026-08-03T23:00:00-04:00").status).toBe("open");
    expect(evaluatePlaceHours(hours, "2026-08-04T01:00:00-04:00").status).toBe("open");
    expect(evaluatePlaceHours(hours, "2026-08-04T03:00:00-04:00").status).toBe("closed");
  });

  it("handles special closures, DST-local evaluation, unknown and stale states", () => {
    expect(evaluatePlaceHours(coffee.hours, "2026-08-08T15:00:00-04:00").status).toBe("closed");
    expect(evaluatePlaceHours(coffee.hours, "2026-08-04T14:00:00-04:00").status).toBe("open");
    expect(evaluatePlaceHours(gallery.hours, "2026-08-07T15:00:00-04:00").explanation).toContain("exhibit");
    expect(evaluatePlaceHours(market.hours, "2026-08-04T15:00:00-04:00").status).toBe("stale");
    expect(evaluatePlaceHours({ ...coffee.hours, status: "unknown" }, "2026-08-04T15:00:00-04:00").status).toBe("unknown");

    const dstHours = { ...coffee.hours, specialDates: { ...coffee.hours.specialDates, value: [] } };
    const before = evaluatePlaceHours(dstHours, "2026-03-08T06:45:00Z");
    const after = evaluatePlaceHours(dstHours, "2026-03-08T07:45:00Z");
    expect(before.localDate).toBe("2026-03-08");
    expect(after.localDate).toBe("2026-03-08");
    expect(before.localTime).not.toBe(after.localTime);
  });

  it("keeps missing address/contact/commercial facts truthful", () => {
    expect(market.address.status).toBe("known");
    expect(market.contact.status).toBe("absent");
    expect(market.commercial.rating.status).toBe("absent");
    expect(gallery.address.status).toBe("absent");
    expect(gallery.imagery.status).toBe("absent");
  });
});
