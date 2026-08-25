/**
 * The named-place structural evidence record (T014).
 *
 * WHAT IT PROVES: that each entry in `NAMED_PLACES` is a real feature in the
 * approved ground release, carrying the source it claims, framed by a pose that
 * actually contains its geometry, on cells whose orthoimagery status — textured
 * or refused with a reason — is fully accounted for by the zone-imagery index.
 *
 * WHAT IT DOES NOT PROVE: anything visual. No screenshot was captured this
 * cycle, so "recognisable" is asserted structurally here and is scheduled for
 * browser capture in the P3 batch. See `docs/implementation/NAMED_PLACES.md`.
 *
 * The document has no timestamp and no absolute path, so regenerating it over
 * unchanged release bytes rewrites it identically and any diff is a real change.
 * Regenerate with `pnpm named-places:evidence`.
 */

import {
  NAMED_PLACES,
  NAMED_PLACE_GROUND_RELEASE_ID,
  NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID,
  boundsIntersect,
  groundTargetForPose,
  namedPlaceDeepLink,
  poseViewFootprint,
  type GeographicBounds,
  type NamedPlace,
} from "../domain/named-places.ts";
import type { GroundClass } from "../domain/ground.ts";
import type { CameraPose } from "../domain/visitor-navigation.ts";

export const NAMED_PLACES_EVIDENCE_SCHEMA_VERSION = "named-places-evidence-1" as const;

/** Host-agnostic so the record is identical wherever it is generated. */
export const NAMED_PLACE_DEEP_LINK_BASE = "http://localhost/" as const;

export interface NamedPlaceSourceSummary {
  readonly provider: string;
  readonly datasetId: string;
  readonly sourceRecordId: string;
  readonly licenseRefId: string;
  readonly capturedAt: string;
  readonly updatedAt: string;
}

export interface NamedPlaceImageryStatus {
  readonly zoneRef: string;
  readonly cellId: string;
  readonly status: "textured" | "refused" | "unaccounted";
  /** Present only for refusals: the index's own stated reason, verbatim. */
  readonly reason?: string;
}

export interface NamedPlaceEvidence {
  readonly placeKey: string;
  readonly displayName: string;
  readonly sourceDisplayName: string;
  readonly displayNameField: string;
  readonly canonicalFeatureId: string;
  readonly groundClass: GroundClass;
  readonly identityOrigin: "referenced-existing" | "ground-owned";
  readonly deepLink: string;
  readonly pose: CameraPose;
  readonly groundTarget: { readonly longitude: number; readonly latitude: number };
  readonly viewFootprint: GeographicBounds;
  readonly geometryBounds: GeographicBounds;
  readonly geometryInView: boolean;
  readonly ownerCellIds: readonly string[];
  readonly ownerCellIdsInView: readonly string[];
  /** Per owning cell, how many ground parts of each class that cell owns. */
  readonly classCensus: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly imagery: readonly NamedPlaceImageryStatus[];
  readonly imagerySummary: { readonly textured: number; readonly refused: number; readonly unaccounted: number };
  readonly sourceRefs: readonly NamedPlaceSourceSummary[];
  readonly extentNote?: string;
  readonly displayNameNote?: string;
}

export interface NamedPlacesEvidenceDocument {
  readonly schemaVersion: typeof NAMED_PLACES_EVIDENCE_SCHEMA_VERSION;
  readonly groundReleaseId: string;
  readonly zoneImageryReleaseId: string;
  readonly deepLinkBase: string;
  readonly places: readonly NamedPlaceEvidence[];
}

/** The shape this module needs out of the ground release; deliberately narrow. */
export interface NamedPlaceReleaseInput {
  readonly features: ReadonlyArray<{
    canonicalFeatureId: string;
    class: string;
    identityOrigin: { kind: string; existingFeatureId?: string };
    sourceRefs: ReadonlyArray<NamedPlaceSourceSummary & Record<string, unknown>>;
  }>;
  readonly parts: ReadonlyArray<{ canonicalFeatureId: string; ownerCellId: string }>;
  readonly zoneImagery: {
    entries: ReadonlyArray<{ zoneRef: string; cellId: string; class: string }>;
    refusals: ReadonlyArray<{ zoneRef: string; cellId: string; class: string; reason: string }>;
  };
  /** Vertex bounds of each place's own geometry, read from the per-cell artifacts. */
  readonly geometryBounds: ReadonlyMap<string, GeographicBounds>;
}

function roundCoordinate(value: number): number {
  // Six decimals is the app's canonical pose precision, so the record cannot
  // disagree with a shipped deep link by a float-formatting artefact.
  return Number(value.toFixed(6));
}

function roundBounds(bounds: GeographicBounds): GeographicBounds {
  return { west: roundCoordinate(bounds.west), south: roundCoordinate(bounds.south), east: roundCoordinate(bounds.east), north: roundCoordinate(bounds.north) };
}

/** The class of a ground part, derived from its canonical id exactly as the release encodes it. */
export function groundClassOfFeatureId(canonicalFeatureId: string): string {
  const segments = canonicalFeatureId.split(":");
  // `udt:ground:<city>:<class>:<hash>` for ground-owned, `udt:<city>:<kind>:<id>`
  // for a referenced civic identity such as a park.
  return segments[1] === "ground" ? segments[3] ?? "" : segments[2] ?? "";
}

export function relativeDeepLink(place: NamedPlace): string {
  const url = new URL(namedPlaceDeepLink(place, NAMED_PLACE_DEEP_LINK_BASE));
  return `${url.pathname}${url.search}`;
}

export function buildNamedPlacesEvidence(input: NamedPlaceReleaseInput): NamedPlacesEvidenceDocument {
  const featureById = new Map(input.features.map((feature) => [feature.canonicalFeatureId, feature]));
  const cellsByFeature = new Map<string, string[]>();
  const censusByCell = new Map<string, Map<string, number>>();
  for (const part of input.parts) {
    const cells = cellsByFeature.get(part.canonicalFeatureId);
    if (cells) cells.push(part.ownerCellId); else cellsByFeature.set(part.canonicalFeatureId, [part.ownerCellId]);
    const census = censusByCell.get(part.ownerCellId) ?? new Map<string, number>();
    const partClass = groundClassOfFeatureId(part.canonicalFeatureId);
    census.set(partClass, (census.get(partClass) ?? 0) + 1);
    censusByCell.set(part.ownerCellId, census);
  }
  const texturedZoneRefs = new Set(input.zoneImagery.entries.map((entry) => entry.zoneRef));
  const refusalByZoneRef = new Map(input.zoneImagery.refusals.map((refusal) => [refusal.zoneRef, refusal.reason]));

  const places = NAMED_PLACES.map((place): NamedPlaceEvidence => {
    const feature = featureById.get(place.canonicalFeatureId);
    if (!feature) throw new Error(`Named place ${place.placeKey} is not in ${NAMED_PLACE_GROUND_RELEASE_ID}: ${place.canonicalFeatureId}`);
    const geometryBounds = input.geometryBounds.get(place.canonicalFeatureId);
    if (!geometryBounds) throw new Error(`Named place ${place.placeKey} has no geometry in ${NAMED_PLACE_GROUND_RELEASE_ID}.`);
    const ownerCellIds = [...new Set(cellsByFeature.get(place.canonicalFeatureId) ?? [])].sort();
    const footprint = poseViewFootprint(place.pose);
    const target = groundTargetForPose(place.pose);
    const imagery = ownerCellIds.map((cellId): NamedPlaceImageryStatus => {
      const zoneRef = `${cellId}/${place.groundClass}`;
      if (texturedZoneRefs.has(zoneRef)) return { zoneRef, cellId, status: "textured" };
      const reason = refusalByZoneRef.get(zoneRef);
      if (reason !== undefined) return { zoneRef, cellId, status: "refused", reason };
      return { zoneRef, cellId, status: "unaccounted" };
    });
    return {
      placeKey: place.placeKey,
      displayName: place.displayName,
      sourceDisplayName: place.sourceDisplayName,
      displayNameField: place.displayNameField,
      canonicalFeatureId: place.canonicalFeatureId,
      groundClass: place.groundClass,
      identityOrigin: place.identityOrigin,
      deepLink: relativeDeepLink(place),
      pose: place.pose,
      groundTarget: { longitude: roundCoordinate(target.longitude), latitude: roundCoordinate(target.latitude) },
      viewFootprint: roundBounds(footprint),
      geometryBounds: roundBounds(geometryBounds),
      geometryInView: boundsIntersect(footprint, geometryBounds),
      ownerCellIds,
      // Cell extents are the z14 tile the id names, so "in view" is the same
      // bounds test the render planner would apply.
      ownerCellIdsInView: ownerCellIds.filter((cellId) => boundsIntersect(footprint, groundCellBounds(cellId))),
      classCensus: Object.fromEntries(ownerCellIds.map((cellId) => [cellId, Object.fromEntries([...(censusByCell.get(cellId) ?? new Map())].sort(([left], [right]) => left.localeCompare(right)))])),
      imagery,
      imagerySummary: {
        textured: imagery.filter((entry) => entry.status === "textured").length,
        refused: imagery.filter((entry) => entry.status === "refused").length,
        unaccounted: imagery.filter((entry) => entry.status === "unaccounted").length,
      },
      sourceRefs: feature.sourceRefs.map((source) => ({
        provider: source.provider,
        datasetId: source.datasetId,
        sourceRecordId: source.sourceRecordId,
        licenseRefId: source.licenseRefId,
        capturedAt: source.capturedAt,
        updatedAt: source.updatedAt,
      })),
      ...(place.extentNote ? { extentNote: place.extentNote } : {}),
      ...(place.displayNameNote ? { displayNameNote: place.displayNameNote } : {}),
    };
  });

  return {
    schemaVersion: NAMED_PLACES_EVIDENCE_SCHEMA_VERSION,
    groundReleaseId: NAMED_PLACE_GROUND_RELEASE_ID,
    zoneImageryReleaseId: NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID,
    deepLinkBase: NAMED_PLACE_DEEP_LINK_BASE,
    places,
  };
}

const GROUND_CELL_ID_PATTERN = /^ground-cell-\d+-(\d+)-(\d+)-(\d+)$/u;

/**
 * The geographic extent a ground cell id names.
 *
 * Cell ids end `-<level>-<x>-<y>`, and the partition is PLATE CARREE, not Web
 * Mercator: at level 14 the grid is 2^14 equal steps of 360/2^14 in longitude
 * and 180/2^14 in latitude, with y counting south from the pole. A Mercator
 * reading of the same three numbers lands 20 degrees north of Manhattan, so
 * `named-places-evidence.test.ts` checks this derivation against the
 * `cellBounds` written into every per-cell artifact rather than trusting it.
 */
export function groundCellBounds(cellId: string): GeographicBounds {
  const match = GROUND_CELL_ID_PATTERN.exec(cellId);
  if (!match) throw new Error(`Not a ground cell id: ${cellId}`);
  const divisions = 2 ** Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const longitudeStep = 360 / divisions;
  const latitudeStep = 180 / divisions;
  const west = -180 + x * longitudeStep;
  const north = 90 - y * latitudeStep;
  return { west, east: west + longitudeStep, north, south: north - latitudeStep };
}
