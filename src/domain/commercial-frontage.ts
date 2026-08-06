/**
 * Provider-neutral contracts and deterministic decisions for the bounded
 * commercial-frontage overlay.  This module deliberately contains no
 * filesystem, network, or Manhattan-specific runtime code; the snapshot CLI
 * supplies source observations and persists every decision/reason.
 */

export const COMMERCIAL_FRONTAGE_SCHEMA_VERSION = "1.0" as const;
export const COMMERCIAL_APPROVAL_ID = "codex-user-turn:2026-08-05:bounded-overpass-single-query-approval" as const;
export const COMMERCIAL_RELEASE_ID = "manhattan-esb-block-exterior-pilot-20260805" as const;
export const COMMERCIAL_RAW_RELEASE_ID = "manhattan-esb-block-commercial-20260805" as const;
export const OSM_ODBL_LICENSE = "ODbL-1.0" as const;

export const BLOCK_835_DOITT_IDS = [
  "39969", "102705", "131170", "147902", "262867", "460555", "498980",
  "502491", "584049", "778052", "812702", "835659", "925937", "982383",
] as const;

export const OTI_RAW_SHA256 = "52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7" as const;
export const DOHMH_RAW_SHA256 = "cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627" as const;
export const OTI_CAPTURED_AT = "2026-08-04T08:25:05.580Z" as const;
export const DOHMH_CAPTURED_AT = "2026-08-04T07:41:56.726Z" as const;
export const OTI_DATASET_ID = "jh45-qr5r" as const;
export const DOHMH_DATASET_ID = "43nn-pn8j" as const;
export const ADDRESSPOINT_DATASET_ID = "uf93-f8nk" as const;
export const DCWP_DATASET_ID = "w7w3-xahh" as const;
export const OSM_ENDPOINT = "https://overpass-api.de/api/interpreter" as const;

type Coordinate = readonly [number, number];

export interface CommercialBuilding {
  canonicalBuildingId: string;
  doittId: string;
  bin: string | null;
  bbl: string | null;
  name: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  footprint: readonly Coordinate[];
  centroid: Coordinate;
  heightMeters: number | null;
  roofBasis: "oti-height-roof";
}

export interface MatchCandidate {
  canonicalBuildingId: string;
  confidence: number;
  rule: string;
  reasons: string[];
}

export interface BuildingMatchDecision {
  decision: "exact" | "high" | "medium" | "candidate-only" | "ambiguous" | "rejected";
  confidence: number;
  canonicalBuildingId: string | null;
  candidates: MatchCandidate[];
  reasons: string[];
  reversible: true;
}

export interface PointObservation {
  longitude: number;
  latitude: number;
  bin?: string | null;
  bbl?: string | null;
  houseNumber?: string | null;
  street?: string | null;
  sourceId: string;
  source: "addresspoint" | "dohmh" | "dcwp" | "osm";
}

export interface FacadeSegment {
  facadeSegmentId: string;
  canonicalBuildingId: string;
  start: Coordinate;
  end: Coordinate;
  lengthMeters: number;
  headingDegrees: number;
  streetFacing: boolean;
}

export interface PlacementDecision {
  storefrontId: string;
  canonicalTenantId: string | null;
  canonicalBuildingId: string | null;
  facadeSegmentId: string | null;
  anchorWgs84: Coordinate | null;
  headingDegrees: number | null;
  occupancyClass: "ground-floor-storefront" | "building-associated-nonstorefront" | "building-associated-level-unknown" | "unmatched";
  placementDecision: "storefront-exact" | "storefront-high" | "metadata-only" | "ambiguous" | "unknown";
  confidence: number;
  reasons: string[];
  evidenceIds: string[];
  geometryEvidenceLevel: "estimated-procedural";
  signPolicy: "neutral-text-only" | "none";
}

export function stableCommercialJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCommercialJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCommercialJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeCommercialName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let value = [...raw.normalize("NFKC")].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("").trim();
  value = value.replace(/[’'`]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const suffixes = ["incorporated", "inc", "llc", "l l c", "corp", "corporation", "co", "company", "limited", "ltd"];
  for (const suffix of suffixes) value = value.replace(new RegExp(`(?:^| )${suffix.replace(/ /g, "\\s+")}$`, "u"), "").trim();
  return value;
}

export function displayCommercialName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return [...raw.normalize("NFKC")].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, 64);
}

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const radius = 6_378_137;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointInRing(point: Coordinate, ring: readonly Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses = ((yi > point[1]) !== (yj > point[1])) && point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInBuilding(point: Coordinate, building: CommercialBuilding): boolean {
  return pointInRing(point, building.footprint);
}

export function pointToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): { distanceMeters: number; t: number; anchor: Coordinate } {
  const latScale = 111_320;
  const lonScale = latScale * Math.cos(point[1] * Math.PI / 180);
  const px = point[0] * lonScale;
  const py = point[1] * latScale;
  const sx = start[0] * lonScale;
  const sy = start[1] * latScale;
  const ex = end[0] * lonScale;
  const ey = end[1] * latScale;
  const dx = ex - sx;
  const dy = ey - sy;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / denominator));
  const ax = sx + t * dx;
  const ay = sy + t * dy;
  return { distanceMeters: Math.hypot(px - ax, py - ay), t, anchor: [ax / lonScale, ay / latScale] };
}

export function deriveFacadeSegments(building: CommercialBuilding): FacadeSegment[] {
  const points = building.footprint;
  const segments: FacadeSegment[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const lengthMeters = haversineMeters(start, end);
    if (lengthMeters < 2) continue;
    const heading = (Math.atan2((end[0] - start[0]) * Math.cos(start[1] * Math.PI / 180), end[1] - start[1]) * 180 / Math.PI + 360) % 360;
    segments.push({ facadeSegmentId: `${building.canonicalBuildingId}:facade:${String(index).padStart(2, "0")}`, canonicalBuildingId: building.canonicalBuildingId, start, end, lengthMeters, headingDegrees: heading, streetFacing: true });
  }
  return segments.sort((a, b) => a.facadeSegmentId.localeCompare(b.facadeSegmentId));
}

export function matchTenantToBuilding(observation: PointObservation, buildings: readonly CommercialBuilding[], addressPoints: readonly PointObservation[] = []): BuildingMatchDecision {
  const reasons: string[] = [];
  const explicitBin = observation.bin ? String(observation.bin).trim() : "";
  const explicitBbl = observation.bbl ? String(observation.bbl).trim() : "";
  const binMatches = explicitBin ? buildings.filter((building) => building.bin === explicitBin) : [];
  const bblMatches = explicitBbl ? buildings.filter((building) => building.bbl === explicitBbl) : [];
  if (explicitBin && binMatches.length === 1) {
    const building = binMatches[0]!;
    if (explicitBbl && building.bbl !== explicitBbl) return { decision: "rejected", confidence: 0, canonicalBuildingId: null, candidates: [], reasons: ["Explicit BIN and BBL disagree with the OTI crosswalk."], reversible: true };
    if (Number.isFinite(observation.longitude) && Number.isFinite(observation.latitude) && pointInBuilding([observation.longitude, observation.latitude], building)) reasons.push("Explicit BIN maps to exactly one OTI parent and source point is inside its footprint.");
    else reasons.push("Explicit BIN maps to exactly one OTI parent; source point is outside/unknown footprint and is retained as a conflict.");
    return { decision: "exact", confidence: 1, canonicalBuildingId: building.canonicalBuildingId, candidates: [{ canonicalBuildingId: building.canonicalBuildingId, confidence: 1, rule: "explicit-bin", reasons }], reasons, reversible: true };
  }
  if (explicitBin && binMatches.length > 1) return { decision: "ambiguous", confidence: 0, canonicalBuildingId: null, candidates: binMatches.map((building) => ({ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.75, rule: "duplicate-bin", reasons: ["Explicit BIN maps to multiple OTI parents."] })), reasons: ["Explicit BIN is not unique in the candidate set."], reversible: true };
  if (explicitBbl && bblMatches.length === 1) {
    const building = bblMatches[0]!;
    reasons.push("Unique explicit BBL maps to one OTI parent.");
    return { decision: "medium", confidence: 0.75, canonicalBuildingId: building.canonicalBuildingId, candidates: [{ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.75, rule: "unique-bbl", reasons }], reasons, reversible: true };
  }
  if (explicitBbl && bblMatches.length > 1) {
    const resolved = addressPoints.filter((point) => point.bin && bblMatches.some((building) => building.bin === point.bin));
    if (resolved.length === 1) {
      const building = bblMatches.find((candidate) => candidate.bin === resolved[0]!.bin);
      if (building) return { decision: "high", confidence: 0.9, canonicalBuildingId: building.canonicalBuildingId, candidates: [{ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.9, rule: "addresspoint-resolved-duplicate-bbl", reasons: ["AddressPoint resolves a duplicate BBL to one BIN/OTI parent."] }], reasons: ["AddressPoint resolves a duplicate BBL to one BIN/OTI parent."], reversible: true };
    }
    return { decision: "ambiguous", confidence: 0, canonicalBuildingId: null, candidates: bblMatches.map((building) => ({ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.75, rule: "duplicate-bbl", reasons: ["Duplicate BBL requires a unique AddressPoint BIN."] })), reasons: ["Duplicate BBL cannot select a building without a unique AddressPoint BIN."], reversible: true };
  }
  const hasPoint = Number.isFinite(observation.longitude) && Number.isFinite(observation.latitude);
  if (hasPoint) {
    const point: Coordinate = [observation.longitude, observation.latitude];
    const containing = buildings.filter((building) => pointInBuilding(point, building));
    if (containing.length === 1) {
      const building = containing[0]!;
      const reason = "Source point is inside exactly one retained OTI footprint; no name/proximity-only attachment is used.";
      return { decision: "high", confidence: 0.9, canonicalBuildingId: building.canonicalBuildingId, candidates: [{ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.9, rule: "unique-point-inside-footprint", reasons: [reason] }], reasons: [reason], reversible: true };
    }
    if (containing.length > 1) return { decision: "ambiguous", confidence: 0, canonicalBuildingId: null, candidates: containing.map((building) => ({ canonicalBuildingId: building.canonicalBuildingId, confidence: 0.75, rule: "point-in-multiple-footprints", reasons: ["Source point falls inside multiple retained OTI footprints."] })), reasons: ["Source point cannot select a unique OTI footprint."], reversible: true };
    const facadeCandidates = buildings.map((building) => {
      const nearest = deriveFacadeSegments(building).map((segment) => pointToSegmentMeters(point, segment.start, segment.end)).sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
      return { building, distance: nearest?.distanceMeters ?? Number.POSITIVE_INFINITY };
    }).sort((a, b) => a.distance - b.distance || a.building.canonicalBuildingId.localeCompare(b.building.canonicalBuildingId));
    const nearestFacade = facadeCandidates[0];
    const nextFacade = facadeCandidates[1];
    if (nearestFacade && nearestFacade.distance <= 3 && (!nextFacade || nextFacade.distance - nearestFacade.distance >= 2)) {
      const reason = `Source point is ${nearestFacade.distance.toFixed(2)}m from one unique retained OTI facade; placement remains subject to the separate frontage gate.`;
      return { decision: "high", confidence: 0.9, canonicalBuildingId: nearestFacade.building.canonicalBuildingId, candidates: [{ canonicalBuildingId: nearestFacade.building.canonicalBuildingId, confidence: 0.9, rule: "unique-point-near-facade", reasons: [reason] }], reasons: [reason], reversible: true };
    }
  }
  const nearby = buildings.map((building) => ({ building, distance: haversineMeters([observation.longitude, observation.latitude], building.centroid) })).sort((a, b) => a.distance - b.distance || a.building.canonicalBuildingId.localeCompare(b.building.canonicalBuildingId));
  if (nearby.length === 1 && nearby[0]!.distance <= 30) return { decision: "candidate-only", confidence: 0.5, canonicalBuildingId: null, candidates: [{ canonicalBuildingId: nearby[0]!.building.canonicalBuildingId, confidence: 0.5, rule: "proximity-only", reasons: [`Nearest candidate is ${nearby[0]!.distance.toFixed(2)}m away; proximity alone cannot attach.`] }], reasons: ["Name/proximity-only association is metadata-only."], reversible: true };
  return { decision: "rejected", confidence: 0, canonicalBuildingId: null, candidates: [], reasons: ["No deterministic BIN/BBL/AddressPoint building match."], reversible: true };
}

export function classifyStatus(rawStatus: unknown, source: "dohmh" | "dcwp" | "osm", observedAt: string | null, expiry: string | null = null, captureDate: string | null = null): { normalizedStatus: string; statusDimension: string; wording: string } {
  const value = String(rawStatus ?? "").trim();
  const date = observedAt ?? captureDate ?? "unknown date";
  if (source === "dcwp" && value.toLocaleLowerCase() === "active" && !(expiry && captureDate && expiry < captureDate)) return { normalizedStatus: "source-listed-active", statusDimension: "licence", wording: `licence listed active by DCWP as of ${date}; not live confirmation` };
  if (source === "dcwp" && expiry && captureDate && expiry < captureDate) return { normalizedStatus: "licence-expired", statusDimension: "licence", wording: `licence expired ${expiry}; business closure not inferred` };
  if (source === "dohmh" && /closed|closure/i.test(value)) return { normalizedStatus: "regulatory-closure-observation", statusDimension: "regulatory-inspection", wording: `DOHMH closure action on ${date}; later/current operation not inferred` };
  if (source === "osm" && /^(disused|abandoned|closed|historical)$/i.test(value)) return { normalizedStatus: "source-listed-historical", statusDimension: "mapping-observation", wording: `Historical/disused in OSM as of ${date}` };
  return { normalizedStatus: value ? "source-observed-no-status" : "unknown", statusDimension: source === "osm" ? "mapping-observation" : source === "dohmh" ? "regulatory-inspection" : "licence", wording: value ? `Observed in ${source.toUpperCase()} snapshot; current status unknown` : "Unknown" };
}

export function placementForPoint(options: {
  storefrontId: string;
  tenantId: string | null;
  building: CommercialBuilding | null;
  point: Coordinate | null;
  groundFloorEvidence: boolean;
  evidenceIds: string[];
  otherPlacements: PlacementDecision[];
  sourceKind: "osm" | "addresspoint" | "nyc";
}): PlacementDecision {
  const { storefrontId, tenantId, building, point, groundFloorEvidence, evidenceIds, otherPlacements, sourceKind } = options;
  if (!building || !point) return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building?.canonicalBuildingId ?? null, facadeSegmentId: null, anchorWgs84: point, headingDegrees: null, occupancyClass: "unmatched", placementDecision: "unknown", confidence: 0, reasons: ["No unique tenant/building or frontage point."], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "none" };
  const segments = deriveFacadeSegments(building).map((segment) => ({ segment, projection: pointToSegmentMeters(point, segment.start, segment.end) })).sort((a, b) => a.projection.distanceMeters - b.projection.distanceMeters || a.segment.facadeSegmentId.localeCompare(b.segment.facadeSegmentId));
  const nearest = segments[0];
  const next = segments[1];
  if (!nearest || nearest.projection.distanceMeters > 3) return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building.canonicalBuildingId, facadeSegmentId: null, anchorWgs84: point, headingDegrees: null, occupancyClass: groundFloorEvidence ? "ground-floor-storefront" : "building-associated-level-unknown", placementDecision: "metadata-only", confidence: 0, reasons: [`${sourceKind} point is ${nearest?.projection.distanceMeters.toFixed(2) ?? "unknown"}m from every footprint segment; placement requires <=3m.`], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "none" };
  if (!groundFloorEvidence) return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building.canonicalBuildingId, facadeSegmentId: nearest.segment.facadeSegmentId, anchorWgs84: nearest.projection.anchor, headingDegrees: nearest.segment.headingDegrees, occupancyClass: "building-associated-level-unknown", placementDecision: "metadata-only", confidence: 0, reasons: ["No defensible ground-floor evidence; upper-floor/level unknown records are never rendered on a facade."], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "none" };
  if (next && nearest.projection.distanceMeters <= 3 && next.projection.distanceMeters - nearest.projection.distanceMeters < 2) return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building.canonicalBuildingId, facadeSegmentId: null, anchorWgs84: nearest.projection.anchor, headingDegrees: nearest.segment.headingDegrees, occupancyClass: "ground-floor-storefront", placementDecision: "ambiguous", confidence: 0, reasons: ["Another eligible facade segment is less than 2m farther away."], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "none" };
  if (otherPlacements.some((placement) => placement.canonicalBuildingId === building.canonicalBuildingId && placement.facadeSegmentId === nearest.segment.facadeSegmentId)) return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building.canonicalBuildingId, facadeSegmentId: nearest.segment.facadeSegmentId, anchorWgs84: nearest.projection.anchor, headingDegrees: nearest.segment.headingDegrees, occupancyClass: "ground-floor-storefront", placementDecision: "ambiguous", confidence: 0, reasons: ["Another tenant already claims this frontage segment without distinct colocated-unit evidence."], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "none" };
  const exact = sourceKind === "osm" && nearest.projection.distanceMeters <= 1.5;
  return { storefrontId, canonicalTenantId: tenantId, canonicalBuildingId: building.canonicalBuildingId, facadeSegmentId: nearest.segment.facadeSegmentId, anchorWgs84: nearest.projection.anchor, headingDegrees: nearest.segment.headingDegrees, occupancyClass: "ground-floor-storefront", placementDecision: exact ? "storefront-exact" : "storefront-high", confidence: exact ? 1 : 0.9, reasons: [exact ? "OSM shop/entrance point is within 1.5m of a unique facade segment." : "Unique ground-floor point is within 3m of a facade segment with a 2m separation margin."], evidenceIds, geometryEvidenceLevel: "estimated-procedural", signPolicy: "neutral-text-only" };
}
