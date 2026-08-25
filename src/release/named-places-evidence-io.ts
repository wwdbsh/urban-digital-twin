/**
 * Disk reader for the named-place evidence record (T014).
 *
 * Split out from `named-places-evidence.ts` so the derivation stays a pure
 * function that the always-run half of the test can re-apply without touching
 * the 52 MB release tree, which `public/data/` keeps out of the repository.
 */

import { existsSync, readFileSync } from "node:fs";

import { NAMED_PLACES, NAMED_PLACE_GROUND_RELEASE_ID, NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID, type GeographicBounds } from "../domain/named-places.ts";
import type { NamedPlaceReleaseInput } from "./named-places-evidence.ts";

export const GROUND_RELEASE_DIRECTORY = `public/data/${NAMED_PLACE_GROUND_RELEASE_ID}`;
export const ZONE_IMAGERY_RELEASE_DIRECTORY = `public/data/${NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID}`;
export const NAMED_PLACES_EVIDENCE_PATH = "artifacts/named-places-20260826/named-places-evidence.json";

function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder().decode(readFileSync(path))) as unknown;
}

/** True when the local release tree this record is measured from is present. */
export function namedPlaceReleasesPresent(root = "."): boolean {
  return existsSync(`${root}/${GROUND_RELEASE_DIRECTORY}/parts.json`)
    && existsSync(`${root}/${GROUND_RELEASE_DIRECTORY}/features.json`)
    && existsSync(`${root}/${ZONE_IMAGERY_RELEASE_DIRECTORY}/zone-imagery.json`);
}

interface GroundCellArtifact {
  parts: Array<{ canonicalFeatureId: string; geometry: { coordinates: unknown }; sourceProperties: Record<string, unknown> }>;
}

function extendBounds(bounds: GeographicBounds, node: unknown): void {
  if (Array.isArray(node) && typeof node[0] === "number" && typeof node[1] === "number") {
    const longitude = node[0];
    const latitude = node[1];
    bounds.west = Math.min(bounds.west, longitude);
    bounds.east = Math.max(bounds.east, longitude);
    bounds.south = Math.min(bounds.south, latitude);
    bounds.north = Math.max(bounds.north, latitude);
    return;
  }
  if (Array.isArray(node)) for (const child of node) extendBounds(bounds, child);
}

export interface NamedPlaceGeometryReading {
  readonly bounds: ReadonlyMap<string, GeographicBounds>;
  /** The `sourceProperties` name strings observed per place, for the naming check. */
  readonly observedNames: ReadonlyMap<string, readonly string[]>;
}

/**
 * Read each place's own vertex bounds and its source-record name back out of the
 * per-cell artifacts. The names are read rather than assumed because the
 * registry's whole claim is that these ids carry these names.
 */
export function readNamedPlaceGeometry(root: string, cellsByFeature: ReadonlyMap<string, readonly string[]>): NamedPlaceGeometryReading {
  const bounds = new Map<string, GeographicBounds>();
  const observedNames = new Map<string, readonly string[]>();
  for (const place of NAMED_PLACES) {
    const box: GeographicBounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
    const names = new Set<string>();
    for (const cellId of cellsByFeature.get(place.canonicalFeatureId) ?? []) {
      const path = `${root}/${GROUND_RELEASE_DIRECTORY}/artifacts/${cellId}/${place.groundClass}.json`;
      if (!existsSync(path)) throw new Error(`Missing ground artifact for ${place.placeKey}: ${path}`);
      const artifact = readJson(path) as GroundCellArtifact;
      for (const part of artifact.parts) {
        if (part.canonicalFeatureId !== place.canonicalFeatureId) continue;
        extendBounds(box, part.geometry.coordinates);
        const name = part.sourceProperties.name ?? part.sourceProperties.plazaname;
        if (typeof name === "string") names.add(name);
      }
    }
    if (!Number.isFinite(box.west)) throw new Error(`No geometry found for ${place.placeKey} (${place.canonicalFeatureId}).`);
    bounds.set(place.canonicalFeatureId, box);
    observedNames.set(place.canonicalFeatureId, [...names].sort());
  }
  return { bounds, observedNames };
}

export interface NamedPlaceDiskInput extends NamedPlaceReleaseInput {
  readonly observedNames: ReadonlyMap<string, readonly string[]>;
}

export function readNamedPlaceReleaseInput(root = "."): NamedPlaceDiskInput {
  const features = readJson(`${root}/${GROUND_RELEASE_DIRECTORY}/features.json`) as NamedPlaceReleaseInput["features"];
  const parts = readJson(`${root}/${GROUND_RELEASE_DIRECTORY}/parts.json`) as NamedPlaceReleaseInput["parts"];
  const zoneImagery = readJson(`${root}/${ZONE_IMAGERY_RELEASE_DIRECTORY}/zone-imagery.json`) as NamedPlaceReleaseInput["zoneImagery"];
  const wanted = new Set(NAMED_PLACES.map((place) => place.canonicalFeatureId));
  const cellsByFeature = new Map<string, string[]>();
  for (const part of parts) {
    if (!wanted.has(part.canonicalFeatureId)) continue;
    const cells = cellsByFeature.get(part.canonicalFeatureId);
    if (cells) cells.push(part.ownerCellId); else cellsByFeature.set(part.canonicalFeatureId, [part.ownerCellId]);
  }
  for (const [featureId, cells] of cellsByFeature) cellsByFeature.set(featureId, [...new Set(cells)].sort());
  const geometry = readNamedPlaceGeometry(root, cellsByFeature);
  // The census counts every part in a place's cells, not just the place's own,
  // so the full `parts` array is passed through rather than the filtered subset.
  return { features, parts, zoneImagery, geometryBounds: geometry.bounds, observedNames: geometry.observedNames };
}
