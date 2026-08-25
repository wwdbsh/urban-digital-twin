/* global console, process */

/**
 * Regenerate the committed named-place evidence record (Task T014).
 *
 * `pnpm named-places:evidence`. Reads the local ground and zone-imagery
 * releases, re-derives every claim in `NAMED_PLACES` from them, and writes
 * `artifacts/named-places-20260826/named-places-evidence.json`.
 *
 * The record carries no timestamp and no absolute path, so a rerun over
 * unchanged release bytes rewrites it byte-identically. `named-places-evidence
 * .test.ts` re-applies the same derivation and requires that identity, which is
 * what makes the committed numbers evidence rather than assertion.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { buildNamedPlacesEvidence } from "../src/release/named-places-evidence.ts";
import { NAMED_PLACES_EVIDENCE_PATH, namedPlaceReleasesPresent, readNamedPlaceReleaseInput } from "../src/release/named-places-evidence-io.ts";
import { NAMED_PLACES } from "../src/domain/named-places.ts";

if (!namedPlaceReleasesPresent()) {
  console.error("named-places:evidence needs the local ground and zone-imagery releases under public/data/. Nothing was written.");
  process.exit(1);
}

const document = buildNamedPlacesEvidence(readNamedPlaceReleaseInput());

// A place whose orthoimagery status the index does not account for is exactly
// the silent gap the zone-imagery validator exists to prevent, so it fails the
// generator rather than being written down as a zero.
const unaccounted = document.places.filter((place) => place.imagerySummary.unaccounted > 0);
if (unaccounted.length > 0) {
  console.error(`Zone-imagery index does not account for every cell of: ${unaccounted.map((place) => place.placeKey).join(", ")}. Nothing was written.`);
  process.exit(1);
}
const unframed = document.places.filter((place) => !place.geometryInView);
if (unframed.length > 0) {
  console.error(`Pose does not frame its own geometry for: ${unframed.map((place) => place.placeKey).join(", ")}. Nothing was written.`);
  process.exit(1);
}

mkdirSync(NAMED_PLACES_EVIDENCE_PATH.slice(0, NAMED_PLACES_EVIDENCE_PATH.lastIndexOf("/")), { recursive: true });
writeFileSync(NAMED_PLACES_EVIDENCE_PATH, `${JSON.stringify(document, null, 2)}\n`);

console.log(`Wrote ${NAMED_PLACES_EVIDENCE_PATH} for ${document.places.length} named places (registry size ${NAMED_PLACES.length}).`);
for (const place of document.places) {
  console.log(`  ${place.placeKey.padEnd(24)} ${place.canonicalFeatureId.padEnd(48)} cells ${String(place.ownerCellIds.length).padStart(2)} · textured ${place.imagerySummary.textured} · refused ${place.imagerySummary.refused}`);
}
