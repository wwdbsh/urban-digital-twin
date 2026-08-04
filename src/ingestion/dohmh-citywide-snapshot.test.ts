import { describe, expect, it } from "vitest";
import {
  assertApprovedDohmhUrl,
  assertDohmhTruth,
  buildDohmhMultiset,
  buildDohmhQueryUrl,
  canonicalizeDohmhRow,
  compareDohmhMultisets,
  compareSourceTruth,
  deriveDohmhOccurrences,
  DOHMH_CITYWIDE_COLUMN_TYPES,
  DOHMH_CITYWIDE_FIELDS,
  DOHMH_CITYWIDE_RESPONSE_TYPES,
  metadataFingerprint,
  redactTruthMismatch,
  validateDohmhRows,
} from "./dohmh-citywide-snapshot";

const metadata = {
  id: "43nn-pn8j",
  rowsUpdatedAt: 1_785_794_767,
  viewLastModified: 1_785_794_660,
  columns: DOHMH_CITYWIDE_FIELDS.map((fieldName, index) => ({ fieldName, dataTypeName: DOHMH_CITYWIDE_COLUMN_TYPES[index], position: index + 1 })),
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    camis: "40390409", dba: "THE FAMOUS JIMBO'S HAMBURGER PALACE", boro: "Manhattan", building: "1345", street: "AMSTERDAM AVENUE",
    zipcode: "10027", phone: "2128658777", cuisine_description: "Hamburgers", inspection_date: "2026-02-10T00:00:00.000",
    action: "Violations were cited in the following area(s).", violation_code: "06B", violation_description: "Tobacco violation",
    critical_flag: "Critical", score: "23", grade: "A", grade_date: "2026-02-10T00:00:00.000", record_date: "2026-08-03T06:00:15.000",
    inspection_type: "Cycle Inspection / Initial Inspection", latitude: "40.813704645851", longitude: "-73.956012441278",
    community_board: "109", council_district: "07", census_tract: "020901", bin: "1084098", bbl: "1019660033", nta: "MN09",
    location: { type: "Point", coordinates: [-73.956012441278, 40.813704645851] },
    ":@computed_region_f5dn_yrer": "57", ":@computed_region_yeji_bk3q": "4", ":@computed_region_sbqj_enih": "3", ":@computed_region_92fq_4b7q": "10",
    ...overrides,
  };
}

describe("citywide DOHMH snapshot proof", () => {
  it("pins the exact 31-field metadata fingerprint and rejects schema drift", () => {
    const result = metadataFingerprint(metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.columns).toHaveLength(31);
      expect(result.value.rowsUpdatedAt).toBe("2026-08-03T22:06:07.000Z");
      expect(result.value.viewLastModified).toBe("2026-08-03T22:04:20.000Z");
      expect(result.value.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(DOHMH_CITYWIDE_RESPONSE_TYPES[8]).toBe("floating_timestamp");
    expect(DOHMH_CITYWIDE_RESPONSE_TYPES[15]).toBe("floating_timestamp");
    const changed = { ...metadata, columns: metadata.columns.map((column, index) => index === 0 ? { ...column, fieldName: "other" } : column) };
    expect(metadataFingerprint(changed).ok).toBe(false);
  });

  it("canonicalizes all fields while preserving null, empty, numbers, and nested key order", () => {
    const canonical = canonicalizeDohmhRow(row({ dba: "", grade: null, location: { coordinates: [-73.9, 40.7], type: "Point" } }));
    expect(canonical.row.dba).toBe("");
    expect(canonical.row.grade).toBeNull();
    expect(canonical.row.location).toEqual({ coordinates: [-73.9, 40.7], type: "Point" });
    expect(canonical.json).toMatch(/^\[/);
    expect(canonical.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => canonicalizeDohmhRow({ ...row(), unexpected: true })).toThrow(/unknown fields/);
    expect(() => canonicalizeDohmhRow(row({ location: { type: "LineString", coordinates: [] } }))).toThrow(/invalid value type/);
  });

  it("keeps exact duplicate multiplicity and derives order-independent occurrence identities", () => {
    const first = validateDohmhRows([row(), row(), row({ camis: "50100000", dba: "UNLOCATED", latitude: null, longitude: null, location: null })], 3);
    const second = validateDohmhRows([row({ camis: "50100000", dba: "UNLOCATED", latitude: null, longitude: null, location: null }), row(), row()], 3);
    const left = buildDohmhMultiset(first, 3);
    const right = buildDohmhMultiset(second, 3);
    expect(compareDohmhMultisets(left, right)).toBeNull();
    expect(left.metrics.rowCount).toBe(3);
    expect(left.metrics.uniqueCanonicalRowCount).toBe(2);
    expect(left.metrics.duplicateGroupCount).toBe(1);
    expect(left.metrics.duplicateExcessCount).toBe(1);
    expect(left.metrics.maximumMultiplicity).toBe(2);
    expect(left.metrics.camisCount).toBe(2);
    const occurrences = deriveDohmhOccurrences(left);
    expect(occurrences).toHaveLength(3);
    expect(new Set(occurrences.map((item) => item.observationOccurrenceId)).size).toBe(3);
    expect(occurrences.every((item) => item.providerRowId === null && item.identityClass === "derived-transport-occurrence")).toBe(true);
    expect(occurrences.filter((item) => item.duplicateGroupMultiplicity === 2).map((item) => item.ordinalWithinDigestGroup)).toEqual([1, 2]);
    const changed = buildDohmhMultiset(validateDohmhRows([row(), row({ score: "24" }), row({ camis: "50100000", latitude: null, longitude: null, location: null })], 3), 3);
    expect(compareDohmhMultisets(left, changed)?.field).toMatch(/rowDigest|multisetDigest/);
  });

  it("rejects incomplete, non-Manhattan, malformed, and wrong-count responses", () => {
    expect(() => validateDohmhRows([row()], 2)).toThrow(/row count/);
    expect(() => validateDohmhRows([row({ boro: "Brooklyn" })], 1)).toThrow(/outside/);
    expect(() => validateDohmhRows([row({ camis: null })], 1)).toThrow(/CAMIS/);
    expect(() => validateDohmhRows([row({ score: "not-a-number" })], 1)).toThrow(/invalid value type/);
    expect(() => validateDohmhRows({ rows: [row()] }, 1)).toThrow(/array/);
  });

  it("compares source truth with redacted deterministic diagnostics", () => {
    const truth = { datasetId: "43nn-pn8j", schemaFingerprint: "schema", rowsUpdatedAt: "a", viewLastModified: "b", lastModified: "c", secondaryLastModified: "d", outOfDate: "false", rowCount: 109386, camisCount: 12439 } as const;
    expect(compareSourceTruth(truth, truth)).toBeNull();
    const mismatch = compareSourceTruth(truth, { ...truth, rowCount: 109387 });
    expect(redactTruthMismatch(mismatch)).toEqual({ field: "rowCount", expected: 109386, actual: 109387 });
  });

  it("pins the official filtered URL and rejects forbidden transport mechanisms", () => {
    const url = buildDohmhQueryUrl(109387);
    expect(new URL(url).hostname).toBe("data.cityofnewyork.us");
    expect(url).toContain("%24where=boro%3D%27Manhattan%27");
    expect(url).toContain("%24limit=109387");
    expect(url).not.toContain("%24offset");
    expect(() => assertApprovedDohmhUrl(url)).not.toThrow();
    expect(() => assertApprovedDohmhUrl(url + "&%24offset=1")).toThrow(/forbidden/);
    expect(() => assertApprovedDohmhUrl(url.replace("https://", "http://"))).toThrow(/exact official HTTPS/);
    expect(() => assertApprovedDohmhUrl(url.replace("data.cityofnewyork.us", "example.invalid"))).toThrow(/exact official HTTPS/);
  });

  it("handles a 120000-row worst-case memory fixture without weakening the gate", () => {
    const readHeap = () => (globalThis as unknown as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage().heapUsed ?? 0;
    const before = readHeap();
    const sample = row({ camis: "50000000", dba: "SYNTHETIC MEMORY ROW" });
    const rows = Array.from({ length: 120_000 }, () => sample);
    const canonical = validateDohmhRows(rows, 120_000);
    const snapshot = buildDohmhMultiset(canonical, 120_000);
    expect(snapshot.metrics.rowCount).toBe(120_000);
    expect(snapshot.metrics.uniqueCanonicalRowCount).toBe(1);
    expect(snapshot.metrics.duplicateExcessCount).toBe(119_999);
    expect(() => assertDohmhTruth(snapshot.metrics, 120_000, 1)).not.toThrow();
    const delta = readHeap() - before;
    expect(delta).toBeLessThan(1_000_000_000);
  });
});
