import { sha256HexSync, stableSerialize } from "../release/catalog-release.ts";

export const OTI_DATASET_ID = "jh45-qr5r" as const;
export const OTI_EXPECTED_MANHATTAN_COUNT = 45_194 as const;
export const OTI_EXPECTED_MANHATTAN_SET_SHA256 = "8fb429da8b5387905bf54207af77638ed304e08df077b43f196c12f678e64f3c" as const;
export const OTI_EXPECTED_EDIT_DATE = 1_785_637_047_174 as const;
export const OTI_DIAGNOSTIC_ENVELOPE = { west: -74.03, south: 40.68, east: -73.91, north: 40.88 } as const;

export type OtiIssue = { path: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value: unknown): string {
  return stableSerialize(stableValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  if (typeof value !== "string") return sha256HexSync(new TextDecoder().decode(value));
  return sha256HexSync(value);
}

export function hashObjectIds(ids: readonly number[]): string {
  return sha256Hex(`${ids.join("\n")}\n`);
}

export function normalizeObjectIds(value: unknown): { ids: number[]; issues: OtiIssue[] } {
  const issues: OtiIssue[] = [];
  if (!isRecord(value) || !Array.isArray(value.objectIds)) return { ids: [], issues: [{ path: "objectIds", message: "IDs-only response must contain an objectIds array." }] };
  const raw = value.objectIds;
  const ids: number[] = [];
  raw.forEach((candidate, index) => {
    const id = typeof candidate === "number" ? candidate : typeof candidate === "string" && /^\d+$/.test(candidate) ? Number(candidate) : Number.NaN;
    if (!Number.isSafeInteger(id) || id < 0) issues.push({ path: `objectIds[${index}]`, message: "OBJECTID must be a non-negative safe integer." });
    else ids.push(id);
  });
  const sorted = [...ids].sort((left, right) => left - right);
  if (new Set(ids).size !== ids.length) issues.push({ path: "objectIds", message: "OBJECTID response contains duplicates." });
  return { ids: sorted, issues };
}

export function validateOtiIdsOnlyResponse(value: unknown): { ids: number[]; issues: OtiIssue[]; objectIdField: string | null; exceededTransferLimit: boolean } {
  const issues: OtiIssue[] = [];
  const record = isRecord(value) ? value : null;
  const objectIdField = record && typeof record.objectIdFieldName === "string"
    ? record.objectIdFieldName
    : record && typeof record.objectIdField === "string"
      ? record.objectIdField
      : null;
  if (objectIdField !== "OBJECTID") issues.push({ path: "objectIdFieldName", message: "IDs-only response must declare OBJECTID as its object ID field." });
  const exceededTransferLimit = record?.exceededTransferLimit === true || record?.exceededTransferLimit === "true";
  if (exceededTransferLimit) issues.push({ path: "exceededTransferLimit", message: "IDs-only response declares an exceeded transfer limit." });
  const normalized = normalizeObjectIds(value);
  issues.push(...normalized.issues);
  return { ids: normalized.ids, issues, objectIdField, exceededTransferLimit };
}

export function compareObjectIdSets(left: readonly number[], right: readonly number[]): { equal: boolean; onlyLeft: number[]; onlyRight: number[] } {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  const rightSet = new Set(b);
  const leftSet = new Set(a);
  const onlyLeft = a.filter((id) => !rightSet.has(id));
  const onlyRight = b.filter((id) => !leftSet.has(id));
  return { equal: onlyLeft.length === 0 && onlyRight.length === 0 && a.length === b.length, onlyLeft, onlyRight };
}

export interface OtiMetadataFingerprint {
  fingerprint: string;
  objectIdField: string;
  globalIdField: string;
  maxRecordCount: number;
  capabilities: string;
  lastEditDate: number | null;
  spatialReference: Record<string, unknown> | null;
  fieldNames: string[];
}

export function metadataFingerprint(metadata: unknown): OtiMetadataFingerprint {
  if (!isRecord(metadata)) throw new Error("OTI layer metadata must be an object.");
  const fields = Array.isArray(metadata.fields) ? metadata.fields.filter(isRecord).map((field) => ({ name: field.name, type: field.type, alias: field.alias ?? null })) : [];
  const fingerprintInput = {
    objectIdField: metadata.objectIdField ?? null,
    globalIdField: metadata.globalIdField ?? null,
    maxRecordCount: metadata.maxRecordCount ?? null,
    capabilities: metadata.capabilities ?? null,
    spatialReference: metadata.spatialReference ?? null,
    editingInfo: isRecord(metadata.editingInfo) ? {
      lastEditDate: metadata.editingInfo.lastEditDate ?? null,
      schemaLastEditDate: metadata.editingInfo.schemaLastEditDate ?? null,
      dataLastEditDate: metadata.editingInfo.dataLastEditDate ?? null,
    } : null,
    fields,
  };
  return {
    fingerprint: sha256Hex(stableJson(fingerprintInput)),
    objectIdField: typeof metadata.objectIdField === "string" ? metadata.objectIdField : "",
    globalIdField: typeof metadata.globalIdField === "string" ? metadata.globalIdField : "",
    maxRecordCount: typeof metadata.maxRecordCount === "number" ? metadata.maxRecordCount : -1,
    capabilities: typeof metadata.capabilities === "string" ? metadata.capabilities : "",
    lastEditDate: isRecord(metadata.editingInfo) && typeof metadata.editingInfo.lastEditDate === "number" ? metadata.editingInfo.lastEditDate : null,
    spatialReference: isRecord(metadata.spatialReference) ? metadata.spatialReference : null,
    fieldNames: fields.map((field) => String(field.name ?? "")),
  };
}

export function validateMetadataFingerprint(metadata: unknown, baseline?: OtiMetadataFingerprint): { value: OtiMetadataFingerprint; issues: OtiIssue[] } {
  const issues: OtiIssue[] = [];
  let value: OtiMetadataFingerprint;
  try { value = metadataFingerprint(metadata); } catch (error) { return { value: metadataFingerprint({}), issues: [{ path: "$", message: error instanceof Error ? error.message : String(error) }] }; }
  if (value.objectIdField !== "OBJECTID") issues.push({ path: "objectIdField", message: "OTI object ID field must remain OBJECTID." });
  if (value.maxRecordCount !== 2000) issues.push({ path: "maxRecordCount", message: "Unexpected OTI maxRecordCount." });
  if (!value.capabilities.split(",").map((part) => part.trim()).includes("Query")) issues.push({ path: "capabilities", message: "OTI layer must support Query." });
  if (value.spatialReference?.wkid !== 102100 && value.spatialReference?.latestWkid !== 3857 && value.spatialReference?.wkid !== 4326) issues.push({ path: "spatialReference", message: "Unexpected OTI spatial reference." });
  if (baseline && value.fingerprint !== baseline.fingerprint) issues.push({ path: "fingerprint", message: "OTI layer metadata fingerprint changed." });
  if (baseline && value.lastEditDate !== baseline.lastEditDate) issues.push({ path: "editingInfo.lastEditDate", message: "OTI layer edit truth changed." });
  return { value, issues };
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : null;
}

export function validateOtiAttributes(attributes: unknown, expectedObjectId?: number): OtiIssue[] {
  const issues: OtiIssue[] = [];
  if (!isRecord(attributes)) return [{ path: "attributes", message: "Feature attributes are required." }];
  const objectId = typeof attributes.OBJECTID === "number" ? attributes.OBJECTID : Number(attributes.OBJECTID);
  if (!Number.isSafeInteger(objectId) || (expectedObjectId !== undefined && objectId !== expectedObjectId)) issues.push({ path: "attributes.OBJECTID", message: "OBJECTID is missing or does not match the requested batch." });
  const doitt = typeof attributes.DOITT_ID === "number" ? attributes.DOITT_ID : Number(attributes.DOITT_ID);
  if (!Number.isSafeInteger(doitt) || doitt <= 0) issues.push({ path: "attributes.DOITT_ID", message: "DOITT_ID must be a positive integer-shaped source identity." });
  for (const key of ["BASE_BBL", "MAPPLUTO_BBL"]) {
    const value = text(attributes[key]);
    if (!value || !/^\d{10}$/.test(value) || value[0] !== "1") issues.push({ path: `attributes.${key}`, message: `${key} must be a 10-digit Manhattan BBL beginning with 1.` });
  }
  const bin = text(attributes.BIN);
  if (bin !== null && !/^\d{7}$/.test(bin)) issues.push({ path: "attributes.BIN", message: "BIN must be a seven-digit source value when supplied." });
  return issues;
}

function isFinitePosition(value: unknown): value is number[] {
  return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every((part) => typeof part === "number" && Number.isFinite(part)) && Number(value[0]) >= -180 && Number(value[0]) <= 180 && Number(value[1]) >= -90 && Number(value[1]) <= 90;
}

function validateRing(value: unknown, path: string, issues: OtiIssue[]): number {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isFinitePosition)) { issues.push({ path, message: "Polygon rings must contain four or more finite WGS84 positions." }); return 0; }
  const first = value[0] as number[];
  const last = value[value.length - 1] as number[];
  if (first[0] !== last[0] || first[1] !== last[1]) issues.push({ path, message: "Polygon rings must be closed." });
  return value.length;
}

export function validateOtiGeoJsonGeometry(geometry: unknown): { issues: OtiIssue[]; vertexCount: number; outsideDiagnosticEnvelope: boolean } {
  const issues: OtiIssue[] = [];
  if (!isRecord(geometry) || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return { issues: [{ path: "geometry.type", message: "Geometry must be Polygon or MultiPolygon." }], vertexCount: 0, outsideDiagnosticEnvelope: false };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return { issues: [{ path: "geometry.coordinates", message: "Geometry must contain at least one polygon." }], vertexCount: 0, outsideDiagnosticEnvelope: false };
  let vertexCount = 0;
  let outsideDiagnosticEnvelope = false;
  polygons.forEach((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || polygon.length === 0) { issues.push({ path: `geometry.coordinates[${polygonIndex}]`, message: "Polygon must contain rings." }); return; }
    polygon.forEach((ring, ringIndex) => {
      vertexCount += validateRing(ring, `geometry.coordinates[${polygonIndex}][${ringIndex}]`, issues);
      if (Array.isArray(ring)) for (const point of ring) if (isFinitePosition(point)) outsideDiagnosticEnvelope ||= Number(point[0]) < OTI_DIAGNOSTIC_ENVELOPE.west || Number(point[0]) > OTI_DIAGNOSTIC_ENVELOPE.east || Number(point[1]) < OTI_DIAGNOSTIC_ENVELOPE.south || Number(point[1]) > OTI_DIAGNOSTIC_ENVELOPE.north;
    });
  });
  return { issues, vertexCount, outsideDiagnosticEnvelope };
}

export function validateOtiFeature(feature: unknown, expectedObjectId?: number): { issues: OtiIssue[]; objectId: number | null; doittId: string | null; vertexCount: number; outsideDiagnosticEnvelope: boolean } {
  const issues: OtiIssue[] = [];
  if (!isRecord(feature) || feature.type !== "Feature") return { issues: [{ path: "feature", message: "Expected a GeoJSON Feature." }], objectId: null, doittId: null, vertexCount: 0, outsideDiagnosticEnvelope: false };
  const properties = isRecord(feature.properties) ? feature.properties : null;
  if (!properties) issues.push({ path: "properties", message: "Feature properties are required." });
  issues.push(...validateOtiAttributes(properties, expectedObjectId));
  const geometry = validateOtiGeoJsonGeometry(feature.geometry);
  issues.push(...geometry.issues);
  const objectId = properties ? Number(properties.OBJECTID) : null;
  const doittId = properties ? text(properties.DOITT_ID) : null;
  return { issues, objectId: Number.isSafeInteger(objectId) ? objectId : null, doittId, vertexCount: geometry.vertexCount, outsideDiagnosticEnvelope: geometry.outsideDiagnosticEnvelope };
}

export function validateOtiBatch(features: readonly unknown[], requestedIds: readonly number[], seenIds: ReadonlySet<number>): { issues: OtiIssue[]; ids: number[]; doittIds: string[]; vertexCounts: number[]; outsideDiagnosticFeatureFlags: boolean[]; vertices: number; outsideDiagnosticFeatureCount: number } {
  const issues: OtiIssue[] = [];
  const batchSet = new Set(requestedIds);
  const ids: number[] = [];
  const doittIds: string[] = [];
  const vertexCounts: number[] = [];
  const outsideDiagnosticFeatureFlags: boolean[] = [];
  let vertices = 0;
  let outsideDiagnosticFeatureCount = 0;
  for (const feature of features) {
    const result = validateOtiFeature(feature);
    issues.push(...result.issues);
    if (result.objectId !== null) {
      if (!batchSet.has(result.objectId)) issues.push({ path: "feature.properties.OBJECTID", message: "Returned OBJECTID was not requested in this batch." });
      if (seenIds.has(result.objectId) || ids.includes(result.objectId)) issues.push({ path: "feature.properties.OBJECTID", message: "Returned OBJECTID is duplicated." });
      ids.push(result.objectId);
    }
    if (result.doittId !== null) doittIds.push(result.doittId);
    vertices += result.vertexCount;
    vertexCounts.push(result.vertexCount);
    outsideDiagnosticFeatureFlags.push(result.outsideDiagnosticEnvelope);
    if (result.outsideDiagnosticEnvelope) outsideDiagnosticFeatureCount += 1;
  }
  if (features.length !== requestedIds.length) issues.push({ path: "features", message: "Geometry response count must equal requested batch count." });
  if (ids.length !== requestedIds.length || requestedIds.some((id) => !ids.includes(id))) issues.push({ path: "features", message: "Geometry response must return each requested OBJECTID exactly once." });
  return { issues, ids, doittIds, vertexCounts, outsideDiagnosticFeatureFlags, vertices, outsideDiagnosticFeatureCount };
}

export function redactedSetDifference(left: readonly number[], right: readonly number[]): { onlyLeftCount: number; onlyRightCount: number; onlyLeftSha256: string; onlyRightSha256: string } {
  const difference = compareObjectIdSets(left, right);
  return { onlyLeftCount: difference.onlyLeft.length, onlyRightCount: difference.onlyRight.length, onlyLeftSha256: hashObjectIds(difference.onlyLeft), onlyRightSha256: hashObjectIds(difference.onlyRight) };
}
