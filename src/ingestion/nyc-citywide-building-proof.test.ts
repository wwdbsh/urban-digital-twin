import { describe, expect, it } from "vitest";
import {
  OTI_DIAGNOSTIC_ENVELOPE,
  OTI_EXPECTED_MANHATTAN_SET_SHA256,
  compareObjectIdSets,
  hashObjectIds,
  metadataFingerprint,
  normalizeObjectIds,
  redactedSetDifference,
  validateOtiBatch,
  validateOtiFeature,
  validateOtiGeoJsonGeometry,
  validateOtiIdsOnlyResponse,
  validateMetadataFingerprint,
} from "./nyc-citywide-building-proof";

const polygon = [[[-73.9, 40.9], [-73.89, 40.9], [-73.89, 40.91], [-73.9, 40.9]]];
const feature = (objectId: number, doitt = 1000 + objectId, geometry = polygon) => ({ type: "Feature", properties: { OBJECTID: objectId, DOITT_ID: doitt, BIN: 1000001, BASE_BBL: "1000010001", MAPPLUTO_BBL: "1000010001" }, geometry: { type: "Polygon", coordinates: geometry } });

describe("OTI citywide direct membership proof", () => {
  it("requires sorted unique integer IDs and hashes the LF set deterministically", () => {
    expect(normalizeObjectIds({ objectIds: [3, 1, 2] }).issues).toEqual([]);
    expect(normalizeObjectIds({ objectIds: [3, 1, 2] }).ids).toEqual([1, 2, 3]);
    expect(normalizeObjectIds({ objectIds: [1, 1] }).issues[0]?.message).toMatch(/duplicates/);
    const ids = [1, 2, 3];
    expect(hashObjectIds(ids)).toMatch(/^[a-f0-9]{64}$/);
    expect(compareObjectIdSets([3, 1, 2], [1, 2, 3]).equal).toBe(true);
    expect(redactedSetDifference([1, 2], [2, 3]).onlyLeftCount).toBe(1);
  });

  it("fails closed for an IDs-only field mismatch or exceeded transfer limit", () => {
    expect(validateOtiIdsOnlyResponse({ objectIdFieldName: "OBJECTID", objectIds: [2, 1], exceededTransferLimit: true }).issues.map((issue) => issue.path)).toContain("exceededTransferLimit");
    expect(validateOtiIdsOnlyResponse({ objectIdFieldName: "WRONG", objectIds: [1] }).issues.map((issue) => issue.path)).toContain("objectIdFieldName");
    expect(validateOtiIdsOnlyResponse({ objectIdFieldName: "OBJECTID", objectIds: [2, 1] }).ids).toEqual([1, 2]);
  });

  it("validates metadata identity and detects edit/schema drift", () => {
    const metadata = { objectIdField: "OBJECTID", globalIdField: "", maxRecordCount: 2000, capabilities: "Query,Extract", spatialReference: { wkid: 102100, latestWkid: 3857 }, editingInfo: { lastEditDate: 1785637047174 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] };
    const baseline = metadataFingerprint(metadata);
    expect(validateMetadataFingerprint(metadata, baseline).issues).toEqual([]);
    expect(validateMetadataFingerprint({ ...metadata, editingInfo: { lastEditDate: 1 } }, baseline).issues.map((issue) => issue.path)).toContain("editingInfo.lastEditDate");
    expect(validateMetadataFingerprint({ ...metadata, fields: [{ name: "NEW", type: "string" }] }, baseline).issues.map((issue) => issue.path)).toContain("fingerprint");
  });

  it("accepts a valid feature even when it crosses or lies outside the historical diagnostic envelope", () => {
    const crossing = feature(1, 1001, [[[-73.911, 40.8], [-73.89, 40.8], [-73.89, 40.81], [-73.911, 40.8]]]);
    const result = validateOtiFeature(crossing);
    expect(result.issues).toEqual([]);
    expect(result.outsideDiagnosticEnvelope).toBe(true);
    expect(OTI_DIAGNOSTIC_ENVELOPE.east).toBe(-73.91);
  });

  it("rejects malformed identity, invalid geometry, and duplicate/missing batches", () => {
    const bad = feature(2);
    bad.properties.BASE_BBL = "2000010001";
    expect(validateOtiFeature(bad).issues.map((issue) => issue.path)).toContain("attributes.BASE_BBL");
    expect(validateOtiGeoJsonGeometry({ type: "Polygon", coordinates: [[[-73, 40], [-72, 40], [-72, 41]]] }).issues.length).toBeGreaterThan(0);
    const batch = validateOtiBatch([feature(1), feature(1)], [1, 2], new Set());
    expect(batch.issues.some((issue) => /duplicated|exactly once/.test(issue.message))).toBe(true);
  });

  it("accounts vertices and historical-envelope diagnostics per feature, not per batch", () => {
    const inside = feature(10, 1010, [[[-74, 40.7], [-73.99, 40.7], [-73.99, 40.71], [-74, 40.7]]]);
    const outside = feature(11, 1011, [[[-73.9, 40.9], [-73.89, 40.9], [-73.89, 40.91], [-73.9, 40.9]]]);
    const batch = validateOtiBatch([inside, outside], [10, 11], new Set());
    expect(batch.vertexCounts).toEqual([4, 4]);
    expect(batch.vertices).toBe(8);
    expect(batch.outsideDiagnosticFeatureFlags).toEqual([false, true]);
    expect(batch.outsideDiagnosticFeatureCount).toBe(1);
  });

  it("keeps the pinned set contract explicit", () => {
    expect(OTI_EXPECTED_MANHATTAN_SET_SHA256).toBe("8fb429da8b5387905bf54207af77638ed304e08df077b43f196c12f678e64f3c");
  });
});
