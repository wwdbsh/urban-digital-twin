import type {
  DerivativePolicy,
  LicenseRef,
  RetentionPolicy,
  SourceApprovalEvidence,
  SourceRegistryEntry,
} from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";

const evidenceDate = "2026-08-03T00:00:00Z";
const realWaveApprovalDate = "2026-08-04T00:00:00Z";
/** The user turn that granted the T003 citywide vector-acquisition envelope. */
const citywideVectorApprovalDate = "2026-08-24T00:00:00Z";
const commercialApprovalEvidence: SourceApprovalEvidence = {
  evidenceId: "codex-user-turn:2026-08-05:bounded-overpass-single-query-approval",
  fingerprintSha256: "b4fc25a430fabacaba0250bc223e99e071b1aaa04f563607e5c8c97b05b20949",
  scope: "local-only Stage 3 block-835 commercial frontage snapshot; exactly one bounded Overpass query plus approved NYC official snapshots; ODbL partition retained with attribution and database-offer metadata",
  exclusions: ["Google products/data/imagery", "OSM main API", "OSM tiles", "Nominatim", "Overpass Turbo", "Geofabrik", "third-party extracts", "credentials", "cookies", "runtime provider requests", "public deployment", "commit", "push"],
};

/** Durable approval for the additive, local-only Block 835 public-realm unit. */
export const BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE: SourceApprovalEvidence = {
  evidenceId: "approval:block835-public-realm:20260806:user-approved",
  fingerprintSha256: "378fec5e7306c224c133de78cc18323b9ca8410039af76974dfabdf7de4cb5d5",
  scope: "Local-only immutable NYC OTI Planimetrics snapshots for Sidewalk vfx9-tbb6, Roadbed xgwd-7vhd, and Pavement Edge x9uq-u3qs, deterministically clipped to the Block 835 building-union envelope plus only four adjacent intersection approaches; roadbed/sidewalk geometry is source-backed, curb vertical profile is estimated/source-constrained, and crosswalk placement/striping is deterministic estimated output.",
  exclusions: ["Google products/data/imagery", "OSM/Overpass/third-party extracts", "paid or credentialed services", "runtime external network", "public deployment or conveyance", "Manhattan-wide generation", "current-paint or survey-grade crosswalk/curb claims", "street furniture/landscaping/traffic/lighting/signs/facades"],
};

/**
 * Draft approval-evidence record for the T002 citywide public-realm
 * registration (goal `manhattan-citywide-public-realm`). This is NOT an
 * approved envelope: acquisition of any dataset that still cites this constant
 * remains gated on the pending T004 user approval. The `:pending-user-
 * approval` suffix on `evidenceId` is the deliberate marker distinguishing
 * this draft from `BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE`'s `:user-approved`
 * form; every source entry that cites this constant is registered with
 * `pendingEntry(...)` (approval.state === "pending") so no downstream code
 * can treat it as ingestion- or runtime-ready.
 *
 * On 2026-08-24 the five VECTOR datasets named in `scope` below graduated to
 * `CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE`, and on 2026-08-25 the
 * orthoimagery named in `scope` graduated to
 * `CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE` at the T004 gate. Both are
 * real user-granted envelopes. This draft therefore now has NO citing source
 * entry and is retained only as the historical T002 record that those two
 * envelopes descend from.
 *
 * `scope` and `fingerprintSha256` are deliberately left byte-identical to their
 * T002 form: the fingerprint attests to the recorded T002 draft text, so
 * rewriting the scope here would silently repoint an already-recorded
 * fingerprint at different words. Read `scope` as the T002 draft it hashes, and
 * this comment as the authority on what has since superseded it.
 */
export const CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE: SourceApprovalEvidence = {
  evidenceId: "approval:citywide-public-realm:20260824:pending-user-approval",
  fingerprintSha256: "754bde755f352e8dd86777550cd6717932b83d58d746e2f2e03d7996e5a56bff",
  scope: "Draft scope pending T003/T004 approval: local-only immutable Manhattan-clipped snapshots for citywide Roadbed xgwd-7vhd, Sidewalk vfx9-tbb6, and Pavement Edge x9uq-u3qs, plus the NYC Planimetric Database: Hydrography pjs3-c3z5 and NYC DOT Pedestrian Plazas (Polygon) k5k6-6jex, plus 2024 Manhattan orthoimagery clipped to park/water/plaza zones.",
  exclusions: ["Google products/data/imagery", "OSM/Overpass/third-party extracts", "paid or credentialed services", "runtime external network", "public deployment or conveyance", "current-paint or survey-grade crosswalk/curb claims", "street furniture/landscaping/traffic/lighting/signs/facades"],
};

/**
 * The exact user turn that granted the T003 vector-acquisition envelope,
 * recorded verbatim as a single line with no trailing newline.
 *
 * `CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.fingerprintSha256` is the
 * SHA-256 of this string, so the fingerprint is reproducible from the constant
 * itself rather than resting on a number nobody can recompute.
 * `src/data/source-registry.test.ts` recomputes it, and
 * `scripts/citywide-public-realm-cli.mjs` duplicates the statement and refuses
 * to open a socket unless its own recomputation matches.
 */
export const CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT =
  "User turn 2026-08-24: authorized T005-then-T003 sequential execution with the same full-auto-through-merge envelope; T003 vector acquisition envelope approved as presented: citywide->Manhattan clip of Roadbed xgwd-7vhd, Sidewalk vfx9-tbb6, Pavement Edge x9uq-u3qs, plus Hydrography pjs3-c3z5 and DOT Pedestrian Plazas k5k6-6jex; local-only immutable snapshots, no redistribution, no public deployment";

/**
 * User-granted approval for the T003 citywide->Manhattan VECTOR acquisition.
 *
 * This is a real envelope, not a draft: the five datasets it names are
 * registered with `approvedEntry(...)` (or, for the three Block 835
 * planimetrics entries, keep their own Block 835 approval and cite this
 * constant additionally for the wider Manhattan clip). Imagery is deliberately
 * absent from THIS envelope and always was; `nyc.orthoimagery-2024-manhattan`
 * was granted its own separate envelope at the T004 gate on 2026-08-25, namely
 * `CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE`. The two envelopes stay
 * distinct so that neither one's fingerprint covers the other's datasets.
 *
 * `exclusions` mirrors the T002 draft's exactly, so graduating from draft to
 * approved widened only the acquisition permission, never the use permission:
 * runtime external network, public deployment, and conveyance stay excluded.
 */
export const CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE = Object.freeze({
  evidenceId: "approval:citywide-public-realm-vector:20260824:user-approved",
  fingerprintSha256: "b4977f62687c29d0d4dfc43fbbe2237f579da7622bc5725fd9d3df7511cfcff7",
  approvalStatement: CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT,
  scope: "Local-only immutable Manhattan-clipped snapshots of five NYC Open Data vector datasets: citywide Roadbed xgwd-7vhd, Sidewalk vfx9-tbb6, and Pavement Edge x9uq-u3qs, plus NYC Planimetric Database: Hydrography pjs3-c3z5 and NYC DOT Pedestrian Plazas (Polygon) k5k6-6jex. Clipped server-side with within_box to the snapped Manhattan ground coverage (west -74.0478515625, south 40.67138671875, east -73.89404296875, north 40.89111328125) derived from MANHATTAN_GROUND_EXTENT in src/release/ground-release.ts. The bbox is a rectangular envelope, not a borough boundary: adjacent-borough and New Jersey features inside it are retained honestly rather than filtered. Imagery is NOT in this envelope.",
  exclusions: ["Google products/data/imagery", "OSM/Overpass/third-party extracts", "paid or credentialed services", "runtime external network", "public deployment or conveyance", "current-paint or survey-grade crosswalk/curb claims", "street furniture/landscaping/traffic/lighting/signs/facades"],
} satisfies SourceApprovalEvidence & { approvalStatement: string });

/**
 * The user turn that granted the T004 orthoimagery envelope, recorded verbatim
 * as a single line with no trailing newline.
 *
 * `CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.fingerprintSha256` is the
 * SHA-256 of this string, so the fingerprint is reproducible from the constant
 * itself. `src/data/source-registry.test.ts` recomputes it, and the acquisition
 * manifest at `data/raw/nyc-ortho-2024-manhattan/manifest.json` records the
 * same statement and the same fingerprint.
 */
export const CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT =
  "User turn 2026-08-25: standing envelope authorizing autonomous execution through T015; T004 orthoimagery acquisition approved under that envelope: NYC/NYS 2024 6-inch Manhattan borough orthoimagery archive boro_manhattan_sp24.zip from gisdata.ny.gov, license basis CC BY 4.0 per NYC OTI aerial-imagery metadata and confirmed by the T004 embedded-metadata inspection finding no access or use constraint in the shipped FGDC metadata; local-only immutable retention, no redistribution, no public deployment";

/**
 * User-granted approval for the T004 orthoimagery acquisition.
 *
 * This graduates `nyc.orthoimagery-2024-manhattan` off the T002 draft
 * `CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE`. The T004 stop-rule was executed
 * before any imagery ingestion: the archive's embedded FGDC metadata
 * (`24_b_manhattan_l06_4bd.shp.xml`) leaves both `<accconst>` and `<useconst>`
 * as unpopulated ESRI template placeholders, and the archive carries no license
 * file, copyright notice, or distribution-liability element. Nothing in it
 * contradicts or narrows the CC BY 4.0 basis published in NYC OTI's own
 * aerial-imagery metadata, so the NAIP fallback was not triggered. The verbatim
 * text and the honest limit on what that absence proves are recorded in
 * `docs/research/PUBLIC_REALM_LICENSING.md` section 4a.
 *
 * `exclusions` mirrors the T002 draft's exactly: this envelope widened only the
 * acquisition permission, never the use permission. Runtime external network,
 * public deployment, and conveyance stay excluded, and CC BY 4.0 attribution
 * must travel with every derived tile or clip.
 */
export const CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE = Object.freeze({
  evidenceId: "approval:citywide-public-realm-ortho:20260825:standing-envelope",
  fingerprintSha256: "f0bbb1c8bf279e4ce6bf02138ae6d0d9891425c70684e58b7a02a754bb239ffe",
  approvalStatement: CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT,
  scope: "Local-only immutable retention of the NYC/NYS Statewide Digital Orthoimagery Program 2024 annual-lot 6-inch Manhattan borough archive (boro_manhattan_sp24.zip, 258 JPEG 2000 tiles in EPSG:2263), acquired once from gisdata.ny.gov and pinned by SHA-256, for texturing the park, water, and plaza ground zones. License basis is CC BY 4.0 per NYC OTI aerial-imagery metadata, corroborated as un-narrowed by the T004 inspection of the archive's embedded metadata. Attribution to NYC OTI / NYS Statewide Digital Orthoimagery Program must travel with every derived tile or clip. No redistribution, no public deployment or conveyance, no runtime provider request.",
  exclusions: ["Google products/data/imagery", "OSM/Overpass/third-party extracts", "paid or credentialed services", "runtime external network", "public deployment or conveyance", "current-paint or survey-grade crosswalk/curb claims", "street furniture/landscaping/traffic/lighting/signs/facades"],
} satisfies SourceApprovalEvidence & { approvalStatement: string });

const orthoApprovalDate = "2026-08-25T00:00:00Z";

/**
 * Access posture for the T004-approved orthoimagery. Download is now permitted;
 * runtime integration is not, because the granted envelope is a local-only
 * immutable archive with no runtime external network.
 */
const citywideOrthoAccess = {
  keyOrAgreementRequired: false,
  kind: "none" as const,
  constraints: "No credential or fee. Download is authorized under approval:citywide-public-realm-ortho:20260825:standing-envelope for a local-only immutable pinned archive; CC BY 4.0 attribution travels with every derived tile, and runtime provider requests, redistribution, and public deployment remain excluded.",
};

const cityTerms = "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw";
const overtureTerms = "https://overturemaps.org/about/faq/";
export const MANHATTAN_CIVIC_APPROVAL_EVIDENCE = Object.freeze({
  evidenceId: "codex-user-turn:2026-08-04:manhattan-civic-context-local-v1",
  fingerprintSha256: "7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58",
  canonicalScopeJson: '{"approvalDate":"2026-08-04","approvalSource":"current Codex user turn","captureScope":"dated Manhattan-filtered local snapshots","datasets":[{"agency":"DCP","baseId":"9nt8-h7nd","mappedViewId":"4hft-v355","name":"2020 NTAs"},{"agency":"NYC Parks","datasetId":"enfh-gkve","name":"Parks Properties"},{"agency":"LPC","datasetId":"ncre-qhxs","name":"Designated and Calendared Buildings and Sites"}],"derivedUse":["local WGS84 geometry","search","detail","source relationships","browser UI"],"licenseAcceptance":"portal metadata license unspecified","localRawRetention":true,"metadataRetention":true,"obligations":["DCP/Parks/LPC attribution","NYC Open Data terms","City modified-data disclaimer","capture/update dates","uncertainty"],"publicDeployment":false,"redistribution":false,"expectedFee":false,"credentials":false}',
  scope: "Dated Manhattan-filtered local snapshots; local raw/metadata retention; local WGS84 geometry, search, detail, source relationships, and browser UI only; DCP/Parks/LPC attribution, NYC Open Data terms, City modified-data disclaimer, capture/update dates, and uncertainty retained; portal metadata license unspecified; local-only with no public deployment, redistribution, fee, or credentials.",
  exclusions: ["public deployment", "redistribution", "new providers", "credentials", "fees", "imagery/facades/textures", "Google/OSM/Overture/MTA/Facilities"],
} satisfies SourceApprovalEvidence & { canonicalScopeJson: string });

const civicLocalAccess = {
  keyOrAgreementRequired: false,
  kind: "none" as const,
  constraints: "No credential or provider fee expected; local-only retention and derivatives are limited to the recorded user-turn approval scope.",
};
const cityRetention: RetentionPolicy = {
  rawSnapshots: "conditional",
  maximumDays: null,
  caching: "allowed",
  constraints: "Preserve the City disclaimer, source version and provenance; verify dataset-specific terms before redistribution.",
};

const openDerivative: DerivativePolicy = {
  allowed: "conditional",
  constraints: "Derived indexes/tiles require source attribution, licence review and the source's stated disclaimer/obligations.",
};

/**
 * Applies to NYC OTI Building Footprints (jh45-qr5r) only.  The 2026-08-11
 * user decision broadened that dataset's envelope to public display,
 * derivative conveyance, and redistribution of exterior geometry *generated*
 * from the footprints.  It is deliberately a separate constant from
 * `openDerivative` so no other source's approval envelope moves with it.
 */
const generatedGeometryConveyanceDerivative: DerivativePolicy = {
  allowed: "conditional",
  constraints: "Derived indexes/tiles require source attribution, licence review and the source's stated disclaimer/obligations. Additionally, under the 2026-08-11 user authorization, exterior geometry generated from these footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. Redistribution covers that generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded.",
};

const pendingAccess = {
  keyOrAgreementRequired: false,
  kind: "legal-review" as const,
  constraints: "Approval is required before download or runtime integration.",
};

/**
 * Access posture for the T003-approved vector datasets. Download is now
 * permitted; runtime integration is not, because the granted envelope is
 * local-only immutable snapshots with no runtime external network.
 */
const citywideVectorAccess = {
  keyOrAgreementRequired: false,
  kind: "none" as const,
  constraints: "No credential or fee. Download is authorized under approval:citywide-public-realm-vector:20260824:user-approved for a local-only immutable Manhattan-clipped snapshot; runtime provider requests, redistribution, and public deployment remain excluded.",
};

function pendingEntry(
  entry: Omit<SourceRegistryEntry, "schemaVersion" | "approval"> & { approvalNote: string },
): SourceRegistryEntry {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    ...entry,
    approval: {
      state: "pending",
      scope: "ingestion",
      reviewedAt: evidenceDate,
      note: entry.approvalNote,
    },
  };
}

/**
 * `reviewedAt` defaults to the 2026-08-04 real-wave approval date that every
 * pre-existing approved entry was granted under. An entry approved by a later
 * user turn must pass its own date rather than inherit a review that did not
 * happen on that day.
 */
function approvedEntry(
  entry: Omit<SourceRegistryEntry, "schemaVersion" | "approval"> & { approvalNote: string; reviewedAt?: string },
): SourceRegistryEntry {
  const { reviewedAt, ...rest } = entry;
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    ...rest,
    approval: {
      state: "approved",
      scope: "ingestion",
      reviewedAt: reviewedAt ?? realWaveApprovalDate,
      note: entry.approvalNote,
    },
  };
}

function approvedAssetReferenceEntry(
  entry: Omit<SourceRegistryEntry, "schemaVersion" | "approval"> & { approvalNote: string },
): SourceRegistryEntry {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    ...entry,
    approval: {
      state: "approved",
      scope: "runtime",
      reviewedAt: realWaveApprovalDate,
      note: entry.approvalNote,
    },
  };
}

export const sourceRegistry = [
  approvedEntry({
    id: "nyc.oti-planimetrics-sidewalk-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    datasetId: "vfx9-tbb6",
    mappedViewId: "52n9-sdep",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Sidewalk/vfx9-tbb6",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Sidewalk; accessed through NYC Open Data (vfx9-tbb6).",
    releaseTimestamp: null,
    captureTimestamp: "2026-08-06T00:00:00Z",
    updateTimestamp: "2024-04-24T20:20:22.000Z",
    cadence: "As needed; portal rows updated 2024-04-24 for the approved snapshot.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "Two approved envelopes, recorded separately rather than merged. (1) Block 835 perimeter and four adjacent intersection approaches, under approval:block835-public-realm:20260806:user-approved. (2) The snapped Manhattan ground coverage rectangle (west -74.0478515625, south 40.67138671875, east -73.89404296875, north 40.89111328125), under approval:citywide-public-realm-vector:20260824:user-approved. Envelope (2) is a rectangle, not a borough boundary: adjacent-borough and New Jersey features inside it are retained honestly, and the rendered scope is governed by the ground ledger downstream.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "NAVD88 where source-native Z is present; Socrata GeoJSON snapshot is CRS84 2D and retains that absence explicitly. Source capture rules document State Plane NAD83 US feet / NAVD88.",
    approvalEvidence: BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE,
    approvalNote: "Approved under approval:block835-public-realm:20260806:user-approved. Immutable local snapshot only; retain portal metadata, exact bounded query, raw bytes/hash, source IDs, CRS/vertical-datum notes, and NYC Open Data disclaimer. Additionally approved on 2026-08-24 under approval:citywide-public-realm-vector:20260824:user-approved for a WIDER local-only immutable snapshot clipped to the snapped Manhattan ground coverage rectangle (T003). That later approval adds an acquisition envelope only; it does not alter, widen, or reinterpret the Block 835 evidence recorded in approvalEvidence, whose fingerprint stays byte-identical.",
  }),
  approvedEntry({
    id: "nyc.oti-planimetrics-roadbed-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    datasetId: "xgwd-7vhd",
    mappedViewId: "i36f-5ih7",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Roadbed/xgwd-7vhd",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Roadbed; accessed through NYC Open Data (xgwd-7vhd).",
    releaseTimestamp: null,
    captureTimestamp: "2026-08-06T00:00:00Z",
    updateTimestamp: "2024-04-24T20:25:27.000Z",
    cadence: "As needed; portal rows updated 2024-04-24 for the approved snapshot.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "Two approved envelopes, recorded separately rather than merged. (1) Block 835 perimeter and four adjacent intersection approaches, under approval:block835-public-realm:20260806:user-approved. (2) The snapped Manhattan ground coverage rectangle (west -74.0478515625, south 40.67138671875, east -73.89404296875, north 40.89111328125), under approval:citywide-public-realm-vector:20260824:user-approved. Envelope (2) is a rectangle, not a borough boundary: adjacent-borough and New Jersey features inside it are retained honestly, and the rendered scope is governed by the ground ledger downstream.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "NAVD88 where source-native Z is present; Socrata GeoJSON snapshot is CRS84 2D and retains that absence explicitly. Source capture rules document State Plane NAD83 US feet / NAVD88.",
    approvalEvidence: BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE,
    approvalNote: "Approved under approval:block835-public-realm:20260806:user-approved. Immutable local snapshot only; retain portal metadata, exact bounded query, raw bytes/hash, source IDs, CRS/vertical-datum notes, and NYC Open Data disclaimer. Additionally approved on 2026-08-24 under approval:citywide-public-realm-vector:20260824:user-approved for a WIDER local-only immutable snapshot clipped to the snapped Manhattan ground coverage rectangle (T003). That later approval adds an acquisition envelope only; it does not alter, widen, or reinterpret the Block 835 evidence recorded in approvalEvidence, whose fingerprint stays byte-identical.",
  }),
  approvedEntry({
    id: "nyc.oti-planimetrics-pavement-edge-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    datasetId: "x9uq-u3qs",
    mappedViewId: "vs44-rznx",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Pavement-Edge/x9uq-u3qs",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Pavement Edge; accessed through NYC Open Data (x9uq-u3qs).",
    releaseTimestamp: null,
    captureTimestamp: "2026-08-06T00:00:00Z",
    updateTimestamp: "2024-04-26T20:48:18.000Z",
    cadence: "As needed; portal rows updated 2024-04-26 for the approved snapshot.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "Two approved envelopes, recorded separately rather than merged. (1) Block 835 perimeter and four adjacent intersection approaches, under approval:block835-public-realm:20260806:user-approved. (2) The snapped Manhattan ground coverage rectangle (west -74.0478515625, south 40.67138671875, east -73.89404296875, north 40.89111328125), under approval:citywide-public-realm-vector:20260824:user-approved. Envelope (2) is a rectangle, not a borough boundary: adjacent-borough and New Jersey features inside it are retained honestly, and the rendered scope is governed by the ground ledger downstream.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "NAVD88 where source-native Z is present; Socrata GeoJSON snapshot is CRS84 2D and retains that absence explicitly. Source capture rules document State Plane NAD83 US feet / NAVD88.",
    approvalEvidence: BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE,
    approvalNote: "Approved under approval:block835-public-realm:20260806:user-approved. Pavement edges constrain estimated curb alignment only; no survey-grade curb elevation is asserted. Additionally approved on 2026-08-24 under approval:citywide-public-realm-vector:20260824:user-approved for a WIDER local-only immutable snapshot clipped to the snapped Manhattan ground coverage rectangle (T003). That later approval adds an acquisition envelope only; it does not alter, widen, or reinterpret the Block 835 evidence recorded in approvalEvidence, whose fingerprint stays byte-identical.",
  }),
  approvedEntry({
    id: "nyc.hydrography",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    datasetId: "pjs3-c3z5",
    canonicalUrl: "https://data.cityofnewyork.us/Environment/NYC-Planimetric-Database-Hydrography/pjs3-c3z5",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Hydrography; accessed through NYC Open Data (pjs3-c3z5).",
    releaseTimestamp: null,
    captureTimestamp: "2026-08-24T00:00:00Z",
    updateTimestamp: "2025-12-11T00:00:00Z",
    cadence: "As needed; portal catalog reports last updated 2025-12-11 for this layer. An older 2024-04-26 vintage and a separate Hydrography Structures layer exist and are not this registration target.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: citywideVectorAccess,
    geographicScope: "New York City hydrography polygons, clipped to the snapped Manhattan ground coverage envelope. The envelope is a rectangle, so Hudson/East/Harlem River water bodies extending into adjacent boroughs and New Jersey are inside it; that is expected, and the rendered scope is governed by the ground ledger downstream, not by this clip.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to 2D water-body polygon semantics. Capture rules: https://github.com/CityOfNewYork/nyc-planimetrics/blob/master/Capture_Rules.md.",
    approvalEvidence: CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE,
    reviewedAt: citywideVectorApprovalDate,
    approvalNote: "Approved under approval:citywide-public-realm-vector:20260824:user-approved for a local-only immutable Manhattan-clipped snapshot (T003). Selected in T001 (docs/research/PUBLIC_REALM_LICENSING.md) as the rendered water ground-class source over the older 2024-04-26 vintage and the separate Hydrography Structures layer. Retain portal metadata, the exact bounded query, raw bytes/hash, source IDs, CRS notes, and the NYC Open Data disclaimer. No runtime provider request, no redistribution, and no public deployment.",
  }),
  approvedEntry({
    id: "nyc.dot-pedestrian-plazas",
    provider: "NYC Department of Transportation (DOT)",
    datasetId: "k5k6-6jex",
    canonicalUrl: "https://data.cityofnewyork.us/Transportation/NYC-DOT-Pedestrian-Plazas-Polygon/k5k6-6jex",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of Transportation (DOT), NYC DOT Pedestrian Plazas (Polygon); accessed through NYC Open Data (k5k6-6jex).",
    releaseTimestamp: null,
    captureTimestamp: "2026-08-24T00:00:00Z",
    updateTimestamp: "2025-01-09T00:00:00Z",
    cadence: "Monthly; portal catalog reports last updated 2025-01-09.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: citywideVectorAccess,
    geographicScope: "New York City DOT-operated pedestrian plaza multipolygons, including the 6 DOT plazas comprising Times Square (Broadway 41st-47th), clipped to the snapped Manhattan ground coverage envelope. The envelope is a rectangle, so adjacent-borough plazas inside it are retained; the rendered scope is governed by the ground ledger downstream, not by this clip.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to 2D plaza polygon semantics.",
    approvalEvidence: CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE,
    reviewedAt: citywideVectorApprovalDate,
    approvalNote: "Approved under approval:citywide-public-realm-vector:20260824:user-approved for a local-only immutable Manhattan-clipped snapshot (T003). Selected in T001 (docs/research/PUBLIC_REALM_LICENSING.md) over DCP POPS (qeta-4kqg) because only this dataset carries polygon geometry and direct Times Square coverage; POPS is point-based and out of scope. Plaza presence is a DOT-operated designation only, not an assertion of current paving, furniture, or public-access hours. No runtime provider request, no redistribution, and no public deployment.",
  }),
  approvedEntry({
    id: "nyc.orthoimagery-2024-manhattan",
    provider: "NYS Statewide Digital Orthoimagery Program (distributing NYC OTI aerial imagery)",
    datasetId: "boro_manhattan_sp24.zip",
    canonicalUrl: "https://gisdata.ny.gov/ortho/nysdop12/new_york_city/spcs/zips/boro_manhattan_sp24.zip",
    termsUrl: "https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_AerialImagery.md",
    // The domain LicenseClass enum has no plain "cc-by-4.0" value (only
    // "cc-by-sa-4.0", which wrongly adds a share-alike obligation this
    // source does not impose per its own metadata). Recorded as "unknown"
    // here rather than misstating the license class; the true CC BY 4.0
    // basis is stated explicitly in attribution/derivativePolicy/approvalNote.
    licenseClass: "unknown",
    attribution: "Source: NYC Office of Technology and Innovation (OTI) / NYS Statewide Digital Orthoimagery Program, 2024 6-inch true orthoimagery, Manhattan borough; CC BY 4.0 (not CC BY-SA) per NYC OTI aerial-imagery metadata.",
    releaseTimestamp: null,
    captureTimestamp: "2024-03-14T00:00:00Z",
    updateTimestamp: "2025-06-05T00:00:00Z",
    cadence: "Static per-vintage borough zip; HEAD-verified 2026-08-24 as HTTP 200, approximately 2.4 GB, Last-Modified 2025-06-05. Capture window 2024-03-14 through 2024-03-24 per NYC OTI metadata.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "CC BY 4.0 attribution to NYC OTI / NYS Statewide Digital Orthoimagery Program must travel with any derived tile or clip; local-only retention consistent with the project posture; the ~2.4 GB full-borough zip must inform the T004 download/clip envelope." },
    derivativePolicy: { allowed: "conditional", constraints: "CC BY 4.0 permits derivative use with attribution. The T004 gate inspected the FGDC metadata embedded in the 2024 zip before any ingestion and found both <accconst> and <useconst> to be unpopulated ESRI template placeholders, with no license file, copyright notice, or distribution-liability element anywhere in the archive; the classified/withheld-tile language of the 2001-2010 vintages does not appear. Nothing narrows CC BY 4.0, so the NAIP fallback (docs/research/PUBLIC_REALM_LICENSING.md section 5) was not triggered. Attribution to NYC OTI / NYS Statewide Digital Orthoimagery Program must travel with every derived tile or clip; redistribution and public conveyance remain excluded. Verbatim text in docs/research/PUBLIC_REALM_LICENSING.md section 4a." },
    access: citywideOrthoAccess,
    geographicScope: "Manhattan borough; the retained archive is the full 258-tile borough coverage (WGS84 envelope approximately west -74.0875, south 40.6813, east -73.8978, north 40.8803), of which 215 tiles intersect a park, water, or plaza zone per data/raw/nyc-ortho-2024-manhattan/zone-tile-mapping.json.",
    // `expectedCrs` describes runtime-delivered geometry, and the domain enum
    // is deliberately limited to the runtime CRSs (EPSG:4326 / EPSG:3857).
    // This source delivers no runtime geometry at all: it is an acquisition-time
    // raster archive whose native CRS is EPSG:2263 (NAD83 / New York Long
    // Island, US survey feet). That native CRS IS known and is recorded as
    // `nativeCrs` in data/raw/nyc-ortho-2024-manhattan/manifest.json; it is
    // "unknown" here only because the runtime enum cannot express it, and
    // reprojection into the runtime CRS happens in T012's texture pipeline.
    expectedCrs: "unknown",
    expectedVerticalDatum: "Not applicable to 2D orthoimagery texture; no elevation claim.",
    approvalEvidence: CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE,
    reviewedAt: orthoApprovalDate,
    approvalNote: "Approved under approval:citywide-public-realm-ortho:20260825:standing-envelope for a local-only immutable pinned archive (T004). License basis is NYC OTI's own aerial-imagery metadata declaring CC BY 4.0 / Access Rights Public (docs/research/PUBLIC_REALM_LICENSING.md section 4). The T002 honest gap about the FGDC terms for this vintage is now closed by inspection rather than assumption: the metadata shipped inside the zip asserts no access or use constraint, because those elements were never filled in. That is recorded as non-contradiction, not as an affirmative grant, so the operative basis remains NYC OTI's published metadata. 2024 was selected over older vintages because it is the confirmed-downloadable, most recent 6-inch full true orthoimagery for Manhattan. The archive is retained at data/raw/nyc-ortho-2024-manhattan/ pinned by SHA-256 with per-tile CRC-32; imagery tiles were deliberately not bulk-extracted because 215 of 258 tiles intersect a zone, so extraction would duplicate most of the archive for little saving. No redistribution, no public deployment, and no runtime provider request.",
  }),
  approvedEntry({
    id: "nyc.building-footprints",
    provider: "NYC Office of Technology and Innovation (OTI) GIS",
    datasetId: "jh45-qr5r",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Building-Footprints-Map-/jh45-qr5r",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Office of Technology and Innovation GIS, Building Footprints; accessed through NYC Open Data.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: "2026-07-18T00:00:00Z",
    cadence: "OTI metadata (10/09/2025) says features are updated daily and publicly released weekly; portal page reports Updated July 18, 2026. Verify the exact snapshot release at ingest time.",
    retention: cityRetention,
    derivativePolicy: generatedGeometryConveyanceDerivative,
    // Two independent gates, deliberately not merged. `access` still requires
    // explicit approval before any NEW download or runtime integration of the
    // raw dataset. The broadened derivative policy below governs only what may
    // be done with geometry ALREADY generated from the retained snapshot.
    access: pendingAccess,
    geographicScope: "New York City building footprints and centroid companion layer",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "GROUND_ELEVATION is NAVD88 for photogrammetric/modern-source records when documented, but its numeric field unit is not published; HEIGHT_ROOF is relative to ground, not sea level and the approved pilot records are ingested as feet-equivalent values with explicit unit provenance.",
    approvalNote: "User-approved in Orca reply msg_91770ac6d098 for this immutable local all-Manhattan citywide wave; preserve the City disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty. Scope is OTI jh45-qr5r raw retention, derived local spatial/search/detail artifacts, and local browser display; no new provider, Google data, or unrelated dataset. Broadened 2026-08-11 by in-session user authorization: exterior geometry generated from these footprints may additionally be publicly displayed, conveyed as a derivative, and redistributed, with NYC OTI attribution and the City modified-data disclaimer retained. That redistribution covers the generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded.",
  }),
  pendingEntry({
    id: "nyc.mappluto",
    provider: "NYC DCP/DOF",
    datasetId: "64uk-42ks",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/MapPLUTO/64uk-42ks",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: City of New York Open Data, MapPLUTO/PLUTO.",
    releaseTimestamp: "2024-11-01T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Approximately biannual; verify release/readme at ingest time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City tax lots",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not a terrain source; no height datum assumed.",
    approvalNote: "Parcel and land-use enrichment; BBL must not be treated as one-building identity.",
  }),
  pendingEntry({
    id: "nyc.dcp-centerline",
    provider: "NYC DCP",
    datasetId: "inkn-q76z",
    canonicalUrl: "https://data.cityofnewyork.us/api/views/inkn-q76z/files/4cff63bb-aeb0-4ca3-adb5-d6027dc133d5?download=true&filename=Centerline.pdf",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: City of New York DCP Centerline metadata.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Operational updates; verify dataset release at ingest time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City streets",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to centerline geometry.",
    approvalNote: "Civic street/address-range overlay; not lane-level or live traffic.",
  }),
  pendingEntry({
    id: "nyc.lidar-2017",
    provider: "NYC OTI / NYS GIS",
    datasetId: "NewYorkCity_2017_Topobathymetric_LiDAR",
    canonicalUrl: "https://gisdata.ny.gov/elevation/LIDAR/NYC_TopoBathymetric2017/NewYorkCity_2017_Topobathymetric_LiDAR.XML",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: New York City 2017 LiDAR metadata record.",
    releaseTimestamp: null,
    captureTimestamp: "2017-01-01T00:00:00Z",
    updateTimestamp: null,
    cadence: "Static capture; derived products vary.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City",
    expectedCrs: "varies",
    expectedVerticalDatum: "Read the chosen DEM/LiDAR product metadata.",
    approvalNote: "Preferred first-city terrain source; vertical datum must be verified per file.",
  }),
  approvedEntry({
    id: "nyc.nta-2020",
    provider: "NYC DCP",
    datasetId: "9nt8-h7nd",
    mappedViewId: "4hft-v355",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: City of New York DCP 2020 Neighborhood Tabulation Areas.",
    releaseTimestamp: "2026-05-28T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-05-28T00:00:00Z",
    cadence: "Quarterly automated updates; verify the dated 26B metadata at capture time. Mapped view 4hft-v355 is presentation-only, not a second source.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "New York City statistical areas",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D boundary semantics.",
    approvalEvidence: MANHATTAN_CIVIC_APPROVAL_EVIDENCE,
    approvalNote: "Approved under codex-user-turn:2026-08-04:manhattan-civic-context-local-v1 (SHA-256 7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58) for local dated Manhattan-filtered snapshots, derivatives, and browser display. NTA is a statistical area, not an assertion of vernacular neighborhood boundaries; mapped view 4hft-v355 is presentation-only.",
  }),
  pendingEntry({
    id: "nyc.community-districts",
    provider: "NYC DCP",
    datasetId: "yfnk-k7r4 / nycd",
    canonicalUrl: "https://data.cityofnewyork.us/api/views/yfnk-k7r4",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of City Planning, New York City Community Districts (nycd).",
    releaseTimestamp: "2026-05-19T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-05-04T00:00:00Z",
    cadence: "Quarterly according to DCP metadata; verify the dated release at ingest time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City statutory/administrative community districts clipped to shoreline",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D boundaries.",
    approvalNote: "Official DCP metadata verified 2026-08-03: Community Districts are charter-mandated administrative/community-board boundaries; dataset has 71 polygon features including joint-interest areas and uses EPSG:2263 source coordinates.",
  }),
  pendingEntry({
    id: "nyc.cdta-2020",
    provider: "NYC DCP",
    datasetId: "CDTA-2020-26B",
    canonicalUrl: "https://www.nyc.gov/content/planning/pages/resources/datasets/community-district-tabulation",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of City Planning, 2020 Community District Tabulation Areas (CDTAs), release 26B.",
    releaseTimestamp: "2026-05-01T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-05-01T00:00:00Z",
    cadence: "Quarterly; current DCP page lists 26B (May 2026) and previous quarterly releases.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City statistical areas approximating the 59 community districts",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D boundaries.",
    approvalNote: "DCP explicitly says CDTAs approximate community districts for ACS reporting and aggregate whole 2020 census tracts; never label a CDTA as the statutory boundary itself.",
  }),
  pendingEntry({
    id: "nyc.borough-boundaries",
    provider: "NYC DCP",
    datasetId: "nybb",
    canonicalUrl: "https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/nybb_metadata.pdf",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of City Planning, New York City Borough Boundary (nybb), release 26B.",
    releaseTimestamp: "2026-05-19T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-05-04T00:00:00Z",
    cadence: "Quarterly according to DCP metadata; use the shoreline-clipped variant when needed.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "Five New York City borough boundaries; official nybb includes water, nybbwi is shoreline variant.",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D boundaries.",
    approvalNote: "Official DCP metadata verified 2026-08-03: five polygon features, EPSG:2263 source CRS, quarterly maintenance, and informational-only disclaimer.",
  }),
  pendingEntry({
    id: "nyc.census-tracts-2020",
    provider: "NYC DCP",
    datasetId: "63ge-mke6",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/2020-Census-Tracts/63ge-mke6",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of City Planning, 2020 Census Tracts.",
    releaseTimestamp: "2026-05-26T00:00:00Z",
    captureTimestamp: "2020-01-01T00:00:00Z",
    updateTimestamp: "2026-05-26T00:00:00Z",
    cadence: "Quarterly portal metadata update; boundary edition follows DCP release series.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City 2020 US Census tracts clipped to shoreline",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D boundaries.",
    approvalNote: "Official portal verified 2026-08-03: 2,325 MultiPolygon rows, GEOID and borough/tract fields, current version 26B; portal license is unspecified and DCP informational limitations apply.",
  }),
  approvedEntry({
    id: "nyc.lpc-sites",
    provider: "NYC Landmarks Preservation Commission",
    datasetId: "ncre-qhxs",
    canonicalUrl: "https://data.cityofnewyork.us/Housing-Development/Designated-and-Calendared-Buildings-and-Sites/ncre-qhxs",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Landmarks Preservation Commission.",
    releaseTimestamp: "2026-06-18T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-06-18T00:00:00Z",
    cadence: "As-needed portal updates; verify dated metadata at capture time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "New York City designated/calendared sites",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable unless joined to building height.",
    approvalEvidence: MANHATTAN_CIVIC_APPROVAL_EVIDENCE,
    approvalNote: "Approved under codex-user-turn:2026-08-04:manhattan-civic-context-local-v1 (SHA-256 7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58) for local dated Manhattan-filtered observations, reversible source relationships, and browser display. Landmark status is semantic provenance, not an attraction, facade, or architectural-detail claim.",
  }),
  approvedEntry({
    id: "nyc.parks-properties",
    provider: "NYC Parks",
    datasetId: "enfh-gkve",
    canonicalUrl: "https://nycopendata.socrata.com/Recreation/Parks-Properties/enfh-gkve",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Parks Properties.",
    releaseTimestamp: "2026-07-17T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-07-17T00:00:00Z",
    cadence: "Monthly automated updates; verify dated metadata at capture time. Managed-property geometry is not a legal survey.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "New York City park-managed property",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to 2D park semantics.",
    approvalEvidence: MANHATTAN_CIVIC_APPROVAL_EVIDENCE,
    approvalNote: "Approved under codex-user-turn:2026-08-04:manhattan-civic-context-local-v1 (SHA-256 7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58) for local dated Manhattan-filtered acquisition observations, reversible parent grouping, and browser display. Presence means NYC Parks-managed property only; it does not prove legal-boundary accuracy, hours, amenities, or current access.",
  }),
  pendingEntry({
    id: "nyc.facilities",
    provider: "NYC DCP",
    datasetId: "2fpa-bnsx",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Facilities-Database-Shapefile/2fpa-bnsx/about",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: City of New York Facilities Database.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: "2024-12-23T00:00:00Z",
    cadence: "Annual; verify dataset page at ingest time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City and public facilities represented by DCP",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to facility point/polygon semantics.",
    approvalNote: "Facility identity is distinct from commercial business identity.",
  }),
  pendingEntry({
    id: "nyc.dca-businesses",
    provider: "NYC Department of Consumer and Worker Protection",
    datasetId: "hs5f-ecrb",
    canonicalUrl: "https://data.cityofnewyork.us/Business/Legally-Operating-Businesses-By-Industry/hs5f-ecrb",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Legally Operating Businesses by Industry.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: "2026-04-24T00:00:00Z",
    cadence: "Verify dataset page; license/status records are time-sensitive.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City licensed businesses",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to business point semantics.",
    approvalNote: "Supplement to broad POI coverage; not a complete business directory.",
  }),
  approvedEntry({
    id: "nyc.dohmh-restaurant-inspections",
    provider: "NYC Department of Health and Mental Hygiene",
    datasetId: "43nn-pn8j",
    canonicalUrl: "https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC DOHMH Restaurant Inspection Results.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Inspection history; verify dataset page at ingest time.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: pendingAccess,
    geographicScope: "New York City restaurant inspections",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to inspection point semantics.",
    approvalNote: "User-approved in Orca reply msg_91770ac6d098 for this immutable local all-Manhattan citywide wave under NYC Open Data/DataMine terms; preserve CAMIS and every inspection observation with capture date, source truth, and checksum, including unlocated groups. Scope is only DOHMH 43nn-pn8j raw retention, derived local spatial/search/detail artifacts, and local browser display; keep grades separate from consumer ratings/reviews/opening hours/current status, and do not claim directory completeness or public deployment.",
  }),
  pendingEntry({
    id: "mta.gtfs-static",
    provider: "Metropolitan Transportation Authority",
    datasetId: "fgm6-ccue",
    canonicalUrl: "https://data.ny.gov/Transportation/MTA-General-Transit-Feed-Specification-GTFS-Static/fgm6-ccue",
    termsUrl: "https://www.mta.info/open-data",
    licenseClass: "unknown",
    attribution: "Source: Metropolitan Transportation Authority General Transit Feed Specification (GTFS) Static Data.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Feed-specific; the official catalog exposes static GTFS files but does not establish a single release cadence.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "The official catalog marks the license unspecified; obtain written retention/redistribution terms and retain feed timestamps." },
    derivativePolicy: { allowed: "conditional", constraints: "No derivative or commercial permission is inferred while the official catalog license is unspecified." },
    access: { keyOrAgreementRequired: false, kind: "legal-review", constraints: "Static feed access is public; realtime feeds and API keys are separate products." },
    geographicScope: "New York City transit network",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to transit schedule/stop points.",
    approvalNote: "Official data.ny.gov record verified 2026-08-03; static GTFS is useful for stop/trip baseline, but its catalog license is unspecified and station-entrance geometry needs a separate authoritative source review.",
  }),
  pendingEntry({
    id: "mta.gtfs-realtime",
    provider: "Metropolitan Transportation Authority",
    datasetId: "nyc-subway-gtfs-realtime",
    canonicalUrl: "https://api.mta.info/GTFS.pdf",
    termsUrl: "https://www.mta.info/open-data",
    licenseClass: "unknown",
    attribution: "Source: Metropolitan Transportation Authority NYC Subway GTFS-Realtime documentation.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Operational feed; update interval and retention depend on official feed behavior.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Do not cache, replay, or expose live records until API terms, key policy and retention approval are documented." },
    derivativePolicy: { allowed: "no", constraints: "No live-derived runtime layer while source license and API policy remain unspecified." },
    access: { keyOrAgreementRequired: true, kind: "api-key", constraints: "MTA developer registration/API key and legal approval are required; no key is present in this repository." },
    geographicScope: "NYC subway operational trip updates, vehicle positions and alerts",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to realtime transit records.",
    approvalNote: "Official MTA GTFS-RT guide verified 2026-08-03; this source must remain separate from static station inventory and is never represented by the fixture runtime.",
  }),
  pendingEntry({
    id: "mta.subway-station-complexes",
    provider: "Metropolitan Transportation Authority",
    datasetId: "5f5g-n3cz",
    canonicalUrl: "https://data.ny.gov/Transportation/MTA-Subway-Stations-and-Complexes/5f5g-n3cz/data",
    termsUrl: "https://www.mta.info/open-data",
    licenseClass: "unknown",
    attribution: "Source: Metropolitan Transportation Authority, MTA Subway Stations and Complexes.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: "2026-07-24T00:00:00Z",
    cadence: "Posting as needed; verify portal metadata and capture timestamp at ingest.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Portal record reports an unspecified license; retain source date, attribution and written reuse decision." },
    derivativePolicy: { allowed: "conditional", constraints: "Station points and canonical IDs may be derived only after terms approval; ADA fields remain source claims with uncertainty." },
    access: pendingAccess,
    geographicScope: "NYC subway and Staten Island Railway station complexes",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to station point geometry.",
    approvalNote: "Official portal record verified 2026-08-03: complex/station IDs, GTFS stop IDs, routes, ADA status and centroid coordinates; source does not prove platform or tunnel geometry.",
  }),
  pendingEntry({
    id: "mta.subway-entrances-2024",
    provider: "Metropolitan Transportation Authority",
    datasetId: "i9wp-a4ja",
    canonicalUrl: "https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024/i9wp-a4ja",
    termsUrl: "https://www.mta.info/open-data",
    licenseClass: "unknown",
    attribution: "Source: Metropolitan Transportation Authority, MTA Subway Entrances and Exits 2024.",
    releaseTimestamp: "2024-08-01T00:00:00Z",
    captureTimestamp: "2024-08-01T00:00:00Z",
    updateTimestamp: "2025-12-05T00:00:00Z",
    cadence: "Point-in-time 2024 dataset; portal says static/not updated, verify at capture.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Portal license is unspecified; retain the data dictionary, source date and attribution if reuse is approved." },
    derivativePolicy: { allowed: "conditional", constraints: "Entrance points may be clipped and indexed after terms approval; georeference can be a platform-generated centroid and is not an exact address guarantee." },
    access: pendingAccess,
    geographicScope: "NYC subway entrances/exits with station-complex and GTFS identifiers",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to entrance point geometry.",
    approvalNote: "Official portal and data dictionary verified 2026-08-03: 2,120 rows, entrance/exit and station IDs, routes/division, and georeference caveat; never infer accessibility from presence of an entrance.",
  }),
  pendingEntry({
    id: "mta.station-amenities-2026",
    provider: "Metropolitan Transportation Authority",
    datasetId: "6yjv-fk7g",
    canonicalUrl: "https://data.ny.gov/Transportation/MTA-Subway-Station-Amenities-Beginning-May-2026/6yjv-fk7g",
    termsUrl: "https://www.mta.info/open-data",
    licenseClass: "unknown",
    attribution: "Source: Metropolitan Transportation Authority, MTA Subway Station Amenities Beginning May 2026.",
    releaseTimestamp: "2026-05-01T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Monthly beginning May 2026; verify each release before snapshotting.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Amenity presence is not live outage state; license and redistribution terms are unspecified in portal metadata." },
    derivativePolicy: { allowed: "conditional", constraints: "Join only by approved station/complex IDs and preserve source date and unknown state." },
    access: pendingAccess,
    geographicScope: "NYC subway station amenities including elevators, escalators and help points",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to amenity records.",
    approvalNote: "Official portal verified 2026-08-03; useful static amenity supplement, but do not display current operational accessibility without separate live status evidence.",
  }),
  pendingEntry({
    id: "overture.addresses",
    provider: "Overture Maps Foundation",
    datasetId: "addresses",
    canonicalUrl: "https://docs.overturemaps.org/schema/",
    termsUrl: "https://docs.overturemaps.org/attribution/",
    licenseClass: "unknown",
    attribution: "Source: Overture Maps Foundation Addresses theme; retain record-level source attribution and license metadata.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Monthly releases; verify release calendar and theme metadata at capture time.",
    retention: { rawSnapshots: "conditional", maximumDays: 60, caching: "restricted", constraints: "Address points have source-dependent accuracy and limited GERS ID stability; retain release and source metadata before derivatives." },
    derivativePolicy: { allowed: "conditional", constraints: "Do not flatten source licenses; legal review is required for address indexes, joins and redistribution." },
    access: { keyOrAgreementRequired: false, kind: "legal-review", constraints: "Direct release access only after source and license approval." },
    geographicScope: "Global address points; NYC coverage and point accuracy are release-dependent.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to address points.",
    approvalNote: "Official Overture schema/theme documentation verified 2026-08-03; address IDs and accuracy are source-dependent, so snapshot, retention and derivative terms remain pending.",
  }),
  pendingEntry({
    id: "overture.places",
    provider: "Overture Maps Foundation",
    datasetId: "places",
    canonicalUrl: "https://docs.overturemaps.org/guides/places/",
    termsUrl: "https://docs.overturemaps.org/attribution/",
    licenseClass: "unknown",
    attribution: "Source: Overture Maps Foundation Places; retain each record's source license and attribution fields.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Monthly releases; taxonomy cadence differs.",
    retention: { rawSnapshots: "conditional", maximumDays: 60, caching: "restricted", constraints: "Release files have a documented retention window; inspect release/source licence manifest before retaining derivatives." },
    derivativePolicy: { allowed: "conditional", constraints: "Places is multi-license by source (including CDLA, Apache, CC0 and other source-specific obligations); do not flatten licences." },
    access: { keyOrAgreementRequired: false, kind: "legal-review", constraints: "Direct release access is preferred after licence approval; no provider API call in this foundation." },
    geographicScope: "Global; NYC coverage is source-dependent",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to place points.",
    approvalNote: "Recommended bulk POI supplement; June 2026 guide documents GERS IDs and multi-license source rows. Approval must cover per-record licenses, 60-day public release retention, and derived indexes.",
  }),
  pendingEntry({
    id: "overture.transportation",
    provider: "Overture Maps Foundation",
    datasetId: "transportation",
    canonicalUrl: "https://docs.overturemaps.org/guides/transportation/",
    termsUrl: overtureTerms,
    licenseClass: "odbl-1.0",
    attribution: "Source: Overture Maps transportation; inspect release-level attribution.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Monthly releases.",
    retention: { rawSnapshots: "conditional", maximumDays: 60, caching: "restricted", constraints: "Inspect release/source licence manifest and ODbL obligations." },
    derivativePolicy: { allowed: "conditional", constraints: "ODbL and source-attribution obligations may flow into derived databases." },
    access: { keyOrAgreementRequired: false, kind: "legal-review", constraints: "Direct release access is preferred after licence approval." },
    geographicScope: "Global road/path/rail/water network",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to network centerlines.",
    approvalNote: "Complement to NYC civic Centerline, not live traffic and not a substitute without conflation evidence.",
  }),
  pendingEntry({
    id: "osm.nyc-extract",
    provider: "OpenStreetMap Foundation/community",
    datasetId: "OpenStreetMap NYC extract",
    canonicalUrl: "https://www.openstreetmap.org/copyright/sp",
    termsUrl: "https://www.openstreetmap.org/copyright/sp",
    licenseClass: "odbl-1.0",
    attribution: "© OpenStreetMap contributors.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Extract cadence chosen by the approved local snapshot process.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Follow OSM API/tile policy; show attribution and identify ODbL database derivatives." },
    derivativePolicy: { allowed: "conditional", constraints: "Adapted databases are subject to ODbL share-alike requirements." },
    access: { keyOrAgreementRequired: false, kind: "legal-review", constraints: "Do not use public tile/API servers as an application backend without policy review." },
    geographicScope: "OpenStreetMap NYC extract",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to 2D map features.",
    approvalNote: "Use only as an approved snapshot and never copy Google sources into OSM-derived data.",
  }),
  pendingEntry({
    id: "nyc.dot-traffic",
    provider: "NYC Department of Transportation",
    datasetId: "traffic speed feeds",
    canonicalUrl: "https://www.nyc.gov/html/dot/html/about/datafeeds.shtml",
    termsUrl: cityTerms,
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of Transportation traffic data feeds.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Feed-specific; sensor coverage is concentrated on major arterials/highways.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Use source timestamp and required City disclaimer; camera data may require a data-sharing agreement." },
    derivativePolicy: { allowed: "conditional", constraints: "Terms, disclaimer and any sharing agreement govern derived traffic overlays." },
    access: { keyOrAgreementRequired: true, kind: "data-agreement", constraints: "Camera access requires DOT contact; live traffic semantics are not approved." },
    geographicScope: "Selected New York City arterials/highways",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to traffic observations.",
    approvalNote: "Out of default slice until the product decides live, historical, simulated or illustrative traffic semantics.",
  }),
  pendingEntry({
    id: "511ny.traffic",
    provider: "511NY",
    datasetId: "developer traffic feeds",
    canonicalUrl: "https://www.511ny.org/developers/help",
    termsUrl: "https://www.511ny.org/developers/daa",
    licenseClass: "provider-terms",
    attribution: "Source: 511NY developer traffic service.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Real-time service; verify current endpoint and terms.",
    retention: { rawSnapshots: "not-permitted", maximumDays: null, caching: "restricted", constraints: "Use short TTL subject to developer agreement; documented throttling is 10 calls per 60 seconds." },
    derivativePolicy: { allowed: "conditional", constraints: "Developer Access Agreement controls use and may require product/use disclosure." },
    access: { keyOrAgreementRequired: true, kind: "data-agreement", constraints: "Registration, developer approval and key required." },
    geographicScope: "New York State traffic incidents/speeds/roadwork/cameras",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to traffic observations.",
    approvalNote: "Separate approval from NYC DOT; not integrated in the offline foundation.",
  }),
  pendingEntry({
    id: "google.places",
    provider: "Google Maps Platform",
    datasetId: "Places API",
    canonicalUrl: "https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places",
    termsUrl: "https://developers.google.com/maps/documentation/places/web-service/policies?hl=en",
    licenseClass: "provider-terms",
    attribution: "Google Maps Platform attribution is required where applicable.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Request-time; provider-controlled.",
    retention: { rawSnapshots: "not-permitted", maximumDays: null, caching: "not-permitted", constraints: "Place IDs are the durable exception; reviews/photos and other content have policy-specific restrictions and Google map/attribution requirements." },
    derivativePolicy: { allowed: "no", constraints: "Never use results as canonical geometry, bulk POI storage or a scraped Google Maps replacement." },
    access: { keyOrAgreementRequired: true, kind: "api-key", constraints: "Cloud project, billing, API key/OAuth and policy/legal review required." },
    geographicScope: "Provider place details for requested locations",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to place details.",
    approvalNote: "Optional request-time premium details only; no provider call in this foundation.",
  }),
  pendingEntry({
    id: "cesium.ion-hosting",
    provider: "Cesium",
    datasetId: "Cesium ion",
    canonicalUrl: "https://cesium.com/platform/",
    termsUrl: "https://cesium.com/platform/",
    licenseClass: "provider-terms",
    attribution: "Cesium ion attribution and source-specific asset attribution as required.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Hosted asset/service dependent.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Token, hosting, usage and asset terms require review; self-hosted tiles remain the default." },
    derivativePolicy: { allowed: "conditional", constraints: "Asset source rights and Cesium ion terms must be retained in manifests." },
    access: { keyOrAgreementRequired: true, kind: "account", constraints: "Cesium ion account/token and budget approval required." },
    geographicScope: "Hosted geospatial assets",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Asset-specific; record in asset metadata.",
    approvalNote: "Optional hosting/tiling service; not a dependency of the local fixture foundation.",
  }),
  {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: "fixture.local.manhattan-slice",
    provider: "Urban Digital Twin local test fixture",
    datasetId: "manhattan-flatiron-v1",
    canonicalUrl: "https://example.invalid/udt/local-fixture",
    termsUrl: "https://example.invalid/udt/local-fixture-terms",
    licenseClass: "fixture-only",
    attribution: "Synthetic local fixture; not real Manhattan coverage.",
    releaseTimestamp: "2026-08-03T00:00:00Z",
    captureTimestamp: "2026-08-03T00:00:00Z",
    updateTimestamp: "2026-08-03T00:00:00Z",
    cadence: "Versioned with the repository.",
    retention: { rawSnapshots: "allowed", maximumDays: null, caching: "allowed", constraints: "Test-only; never present as production city data." },
    derivativePolicy: { allowed: "yes", constraints: "Synthetic data created for tests and local browser validation." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "No external provider or network access." },
    geographicScope: "Synthetic points/polygons near the documented slice; no coverage claim.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Unknown; fixture height is illustrative only.",
    approval: { state: "approved", scope: "test-only", reviewedAt: evidenceDate, note: "Local synthetic fixture is safe for deterministic tests only." },
  } satisfies SourceRegistryEntry,
  {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: "fixture.local.transit",
    provider: "Urban Digital Twin local transit fixture",
    datasetId: "transit-v1",
    canonicalUrl: "https://example.invalid/udt/local-transit",
    termsUrl: "https://example.invalid/udt/local-transit-terms",
    licenseClass: "fixture-only",
    attribution: "Synthetic local transit fixture; not real Manhattan coverage.",
    releaseTimestamp: evidenceDate,
    captureTimestamp: evidenceDate,
    updateTimestamp: evidenceDate,
    cadence: "Versioned with the repository.",
    retention: { rawSnapshots: "allowed", maximumDays: null, caching: "allowed", constraints: "Test-only synthetic records; no provider data." },
    derivativePolicy: { allowed: "yes", constraints: "Synthetic fixture may be used in tests and local browser validation." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "No external provider or network access." },
    geographicScope: "Synthetic transit points and schematic lines near the documented slice; no coverage claim.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Unknown; transit fixtures have no elevation claim.",
    approval: { state: "approved", scope: "test-only", reviewedAt: evidenceDate, note: "Synthetic fixture only; production provider entries remain pending." },
  } satisfies SourceRegistryEntry,
  {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: "fixture.local.route-graph",
    provider: "Urban Digital Twin local route graph fixture",
    datasetId: "route-graph-v1",
    canonicalUrl: "https://example.invalid/udt/local-route-graph",
    termsUrl: "https://example.invalid/udt/local-route-graph-terms",
    licenseClass: "fixture-only",
    attribution: "Synthetic local route graph; not real navigation coverage.",
    releaseTimestamp: evidenceDate,
    captureTimestamp: evidenceDate,
    updateTimestamp: evidenceDate,
    cadence: "Versioned with the repository.",
    retention: { rawSnapshots: "allowed", maximumDays: null, caching: "allowed", constraints: "Test-only synthetic graph; no provider data." },
    derivativePolicy: { allowed: "yes", constraints: "Synthetic graph may be used in tests and local browser validation." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "No external provider or network access." },
    geographicScope: "Synthetic connected graph near the documented slice; no routing coverage claim.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Unknown; graph has no elevation claim.",
    approval: { state: "approved", scope: "test-only", reviewedAt: evidenceDate, note: "Synthetic fixture only; production route sources remain pending." },
  } satisfies SourceRegistryEntry,
  pendingEntry({
    id: "overture.transportation-routing",
    provider: "Overture Maps Foundation",
    datasetId: "transportation-segment-connector",
    canonicalUrl: "https://docs.overturemaps.org/guides/transportation/",
    termsUrl: "https://docs.overturemaps.org/attribution/",
    licenseClass: "unknown",
    attribution: "Source: Overture Maps Foundation Transportation theme; retain upstream source attribution.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Published release series; verify release calendar at capture time.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Transportation releases are multi-source; retain release ID and per-source attribution before deriving a routable graph." },
    derivativePolicy: { allowed: "conditional", constraints: "Derived graph/tiles require review of Overture and upstream licenses, including ODbL obligations where applicable." },
    access: pendingAccess,
    geographicScope: "Global roads, footpaths, rail and water segments/connectors; Manhattan coverage is release-dependent.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to 2D centerlines.",
    approvalNote: "Official Overture transportation documentation verified 2026-08-03; segment centerlines/connectors support graph topology but do not establish sidewalk accessibility or live conditions.",
  }),
  pendingEntry({
    id: "osm.nyc-routing",
    provider: "OpenStreetMap Foundation / OpenStreetMap contributors",
    datasetId: "nyc-extract",
    canonicalUrl: "https://www.openstreetmap.org/copyright",
    termsUrl: "https://www.openstreetmap.org/copyright",
    licenseClass: "odbl-1.0",
    attribution: "© OpenStreetMap contributors, ODbL 1.0; see https://www.openstreetmap.org/copyright.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Continuous community edits; extract release schedule depends on chosen provider.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "restricted", constraints: "Record extract date, attribution and ODbL database/produced-work treatment before redistribution." },
    derivativePolicy: { allowed: "conditional", constraints: "Routing graph derivatives must be reviewed under ODbL/DbCL and any third-party extract terms; never infer sidewalk completeness or accessibility." },
    access: pendingAccess,
    geographicScope: "OpenStreetMap road, path, crossing and transit network features for NYC extracts.",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to 2D network geometry.",
    approvalNote: "Official OSM copyright and OSMF attribution guidance verified 2026-08-03; public visibility is not permission to skip attribution or extract/provider review.",
  }),
  approvedAssetReferenceEntry({
    id: "nyc.lpc-flatiron-designation",
    provider: "NYC Landmarks Preservation Commission",
    datasetId: "LP-0219",
    canonicalUrl: "https://s-media.nyc.gov/agencies/lpc/lp/0219.pdf",
    termsUrl: "https://www.nyc.gov/home/terms-of-use.page",
    licenseClass: "nyc-publication-facts",
    attribution: "Source: NYC Landmarks Preservation Commission, Flatiron Building designation report (LP-0219).",
    releaseTimestamp: "1966-09-20T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Historic designation report; static reference.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Retain City attribution and disclaimer; use only documented architectural facts, not unverified detail." },
    derivativePolicy: { allowed: "conditional", constraints: "Use factual massing/material/height statements for a derived model with City attribution; legal review required for any protected artwork or marks." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public NYC government publication." },
    geographicScope: "Flatiron Building, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to architectural description.",
    approvalNote: "Reviewed 2026-08-04 as a factual architectural reference for the bounded Flatiron asset; no image or texture extraction.",
  }),
  approvedAssetReferenceEntry({
    id: "nyc.dcp-empire-state-design",
    provider: "NYC Department of City Planning",
    datasetId: "15 Penn Plaza FEIS chapters 8/9",
    canonicalUrl: "https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/15_penn/08_feis.pdf",
    termsUrl: "https://www.nyc.gov/home/terms-of-use.page",
    licenseClass: "nyc-publication-facts",
    attribution: "Source: NYC Department of City Planning, 15 Penn Plaza FEIS (Empire State Building visual/architectural description).",
    releaseTimestamp: "2010-07-01T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Historic planning document; static reference.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Retain City attribution and disclaimer; use only documented massing/material/height statements, not unverified detail." },
    derivativePolicy: { allowed: "conditional", constraints: "Use factual massing/material/height statements for a derived model with City attribution; do not copy images, logos, or marks." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public NYC government publication." },
    geographicScope: "Empire State Building, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to architectural description.",
    approvalNote: "Reviewed 2026-08-04 as a factual architectural reference for the bounded Empire asset; mast/antenna dimensions are recorded separately from OTI roof height.",
  }),
  approvedAssetReferenceEntry({
    id: "nps.theodore-roosevelt-birthplace-hsr",
    provider: "U.S. National Park Service",
    datasetId: "Theodore Roosevelt Birthplace Historic Structure Report",
    canonicalUrl: "https://www.nps.gov/parkhistory/online_books/thrb/thrb_hsr.pdf",
    termsUrl: "https://www.nps.gov/aboutus/disclaimer.htm",
    licenseClass: "public-domain",
    attribution: "Source: U.S. National Park Service, Theodore Roosevelt Birthplace National Historic Site Historic Structure Report; U.S. federal work attribution retained.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Historic structure report; static reference.",
    retention: { rawSnapshots: "allowed", maximumDays: null, caching: "allowed", constraints: "U.S. federal work; retain NPS attribution and page-specific notices where present." },
    derivativePolicy: { allowed: "yes", constraints: "Public-domain U.S. federal factual/architectural reference; do not imply NPS endorsement and do not copy third-party material embedded in the report." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public NPS publication." },
    geographicScope: "Theodore Roosevelt Birthplace National Historic Site, 28 East 20th Street, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to architectural description.",
    approvalNote: "Reviewed 2026-08-04 as the primary architectural reference for the bounded Theodore Roosevelt Birthplace asset.",
  }),
  pendingEntry({
    id: "commons.flatiron-photo-pd",
    provider: "Wikimedia Commons / Gryffindor",
    datasetId: "File:Flatiron building.jpg (oldid 1180887899)",
    canonicalUrl: "https://commons.wikimedia.org/wiki/File:Flatiron_building.jpg",
    termsUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    licenseClass: "public-domain",
    attribution: "Photo reference: Gryffindor, Wikimedia Commons, File:Flatiron building.jpg; public-domain dedication.",
    releaseTimestamp: "2007-08-01T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2026-03-14T00:00:00Z",
    cadence: "Static reference photo; verify file page revision before reuse.",
    retention: { rawSnapshots: "allowed", maximumDays: null, caching: "allowed", constraints: "Public-domain dedication; retain author and source URL as courtesy attribution." },
    derivativePolicy: { allowed: "yes", constraints: "Derivative/commercial use permitted under the public-domain dedication; no source image is shipped in this asset wave." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public Wikimedia Commons file page." },
    geographicScope: "Flatiron Building, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to photograph.",
    approvalNote: "Individually verified 2026-08-04 as a research-only optional visual reference; not used by the runtime GLB and no download/texture extraction/photogrammetry.",
  }),
  approvedAssetReferenceEntry({
    id: "commons.empire-state-photo-cc-by-sa-4",
    provider: "Wikimedia Commons / NegweS",
    datasetId: "File:Empire State Building.png",
    canonicalUrl: "https://commons.wikimedia.org/wiki/File:Empire_State_Building.png",
    termsUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    licenseClass: "cc-by-sa-4.0",
    attribution: "Photo reference: NegweS, Wikimedia Commons, File:Empire State Building.png; CC BY-SA 4.0.",
    releaseTimestamp: "2019-02-21T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Static reference photo; verify file page revision before reuse.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Attribution and link to CC BY-SA 4.0 required; share-alike applies to adapted photo material." },
    derivativePolicy: { allowed: "conditional", constraints: "Derivative/commercial use permitted with attribution; share-alike applies to adapted photo material. This wave uses the page only as a visual reference and ships no photo pixels." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public Wikimedia Commons file page." },
    geographicScope: "Empire State Building, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to photograph.",
    approvalNote: "Individually verified 2026-08-04 as a licensed CC BY-SA evidence reference for visible ESB observations only; runtime ships no source pixels, texture extraction, photogrammetry, logo, or unseen-side/roof claim.",
  }),
  pendingEntry({
    id: "commons.theodore-roosevelt-birthplace-photo-cc-by-sa-4",
    provider: "Wikimedia Commons / Beyond My Ken",
    datasetId: "File:Theodore Roosevelt Birthplace.jpg",
    canonicalUrl: "https://commons.wikimedia.org/wiki/File:Theodore_Roosevelt_Birthplace.jpg",
    termsUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    licenseClass: "cc-by-sa-4.0",
    attribution: "Photo reference: Beyond My Ken, Wikimedia Commons, File:Theodore Roosevelt Birthplace.jpg; CC BY-SA 4.0.",
    releaseTimestamp: "2010-08-09T00:00:00Z",
    captureTimestamp: null,
    updateTimestamp: "2025-06-21T00:00:00Z",
    cadence: "Static reference photo; verify file page revision before reuse.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Attribution and link to CC BY-SA 4.0 required; share-alike applies to adapted photo material." },
    derivativePolicy: { allowed: "conditional", constraints: "Derivative/commercial use permitted with attribution; share-alike applies to adapted photo material. This wave uses the page only as a visual reference and ships no photo pixels." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public Wikimedia Commons file page." },
    geographicScope: "Theodore Roosevelt Birthplace, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to photograph.",
    approvalNote: "Individually verified 2026-08-04 as a research-only optional visual reference; not used by the runtime GLB and no download/texture extraction/photogrammetry.",
  }),
  approvedEntry({
    id: "nyc.addresspoint",
    provider: "NYC Department of City Planning / NYC Address Point",
    datasetId: "uf93-f8nk",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Address-Points/uf93-f8nk",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of City Planning, Address Point, dataset uf93-f8nk; accessed through NYC Open Data.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Verify portal metadata at each immutable snapshot capture.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "New York City address points and building frontage references",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to address-point placement.",
    approvalEvidence: commercialApprovalEvidence,
    approvalNote: "Approved by codex-user-turn:2026-08-05:bounded-overpass-single-query-approval for one exact block-835 local snapshot; AddressPoint supports address frontage/BIN crosswalk, not exact tenant doors or storefront widths.",
  }),
  approvedEntry({
    id: "nyc.dcwp-legally-operating-businesses",
    provider: "NYC Department of Consumer and Worker Protection",
    datasetId: "w7w3-xahh",
    canonicalUrl: "https://data.cityofnewyork.us/Business/Issued-Licenses/w7w3-xahh",
    termsUrl: "https://opendata.cityofnewyork.us/overview/",
    licenseClass: "nyc-open-data-terms",
    attribution: "Source: NYC Department of Consumer and Worker Protection, Issued Licenses / Legally Operating Businesses base dataset w7w3-xahh; accessed through NYC Open Data.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "Verify portal metadata at each immutable snapshot capture.",
    retention: cityRetention,
    derivativePolicy: openDerivative,
    access: civicLocalAccess,
    geographicScope: "New York City licensed premises/organization records",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to business premises points.",
    approvalEvidence: commercialApprovalEvidence,
    approvalNote: "Approved by codex-user-turn:2026-08-05:bounded-overpass-single-query-approval for exact block-835 premises/organization records only; individual-licensee and contact fields are excluded, and Active means licence-listed active rather than live occupancy.",
  }),
  approvedEntry({
    id: "osm.block-835-overpass",
    provider: "OpenStreetMap contributors via Overpass API",
    datasetId: "overpass-api-de-20260805-block-835",
    canonicalUrl: "https://overpass-api.de/api/interpreter",
    termsUrl: "https://www.openstreetmap.org/copyright",
    licenseClass: "odbl-1.0",
    attribution: "Map data © OpenStreetMap contributors; ODbL 1.0. OSM-derived content is limited to the declared block-835 derivative-database partition.",
    releaseTimestamp: null,
    captureTimestamp: null,
    updateTimestamp: null,
    cadence: "One bounded local snapshot only; no runtime requests or refreshes.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Retain exact query/response/checksum and make the OSM-derived database or reproducible means available under ODbL 1.0 for any future conveyance; local-only present scope." },
    derivativePolicy: { allowed: "conditional", constraints: "Raw/normalized OSM features, OSM-derived spatial/address indexes, and OSM-dependent cross-source associations form one ODbL 1.0 derivative-database partition with attribution, licence link, share-alike and database-offer metadata." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Exactly one approved bounded Overpass request with identifying User-Agent, no credentials/cookies, no retry or alternate endpoint." },
    geographicScope: "OTI block-835 union extent plus a deterministic 25m geodesic buffer",
    expectedCrs: "EPSG:4326",
    expectedVerticalDatum: "Not applicable to OSM mapping observations.",
    approvalEvidence: commercialApprovalEvidence,
    approvalNote: "Route replacement approved by codex-user-turn:2026-08-05:bounded-overpass-single-query-approval; supersedes only the previously forbidden OSM main editing API route and does not authorize Overpass at runtime, tiles, Nominatim, Overpass Turbo, Geofabrik or third-party extracts.",
  }),
  approvedAssetReferenceEntry({
    id: "commons.herald-towers-photo-cc-by-sa-4",
    provider: "Wikimedia Commons / Deansfa",
    datasetId: "File:Herald Towers, 50 West 34th Street, Manhattan, New York.jpg",
    canonicalUrl: "https://commons.wikimedia.org/wiki/File:Herald_Towers,_50_West_34th_Street,_Manhattan,_New_York.jpg",
    termsUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    licenseClass: "cc-by-sa-4.0",
    attribution: "Photo reference: Deansfa, Wikimedia Commons, Herald Towers, 50 West 34th Street, Manhattan, New York; CC BY-SA 4.0; file revision/checksum retained in the Stage 3 evidence record; no source pixels shipped.",
    releaseTimestamp: "2020-12-19T00:00:00Z",
    captureTimestamp: "2026-08-05T00:00:00Z",
    updateTimestamp: null,
    cadence: "Static reviewed facade reference; no runtime fetch.",
    retention: { rawSnapshots: "conditional", maximumDays: null, caching: "allowed", constraints: "Per-file attribution and CC BY-SA 4.0 share-alike obligations; this wave ships no photo pixels and uses only cited observations." },
    derivativePolicy: { allowed: "conditional", constraints: "Visible evidence-backed observations only; no unseen side/roof claim, pixel texture, logo or trade dress." },
    access: { keyOrAgreementRequired: false, kind: "none", constraints: "Public Commons file page; exact reviewed revision/checksum retained in Stage 3 evidence." },
    geographicScope: "Herald Towers / McAlpin House, 50 West 34th Street, Manhattan",
    expectedCrs: "varies",
    expectedVerticalDatum: "Not applicable to photograph.",
    approvalEvidence: commercialApprovalEvidence,
    approvalNote: "Approved for a licensed-near-real Herald Towers claim only for visible evidence-backed portions; no source pixels are copied into GLBs or runtime assets.",
  }),
] as const satisfies readonly SourceRegistryEntry[];

export type SourceRegistryId = (typeof sourceRegistry)[number]["id"];

export const licenseRegistry: readonly LicenseRef[] = sourceRegistry.map((entry) => ({
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  id: `license:${entry.id}`,
  licenseClass: entry.licenseClass,
  termsUrl: entry.termsUrl,
  attribution: entry.attribution,
  derivativePolicy: entry.derivativePolicy,
  retention: entry.retention,
}));

export function getSourceRegistryEntry(id: string): SourceRegistryEntry | undefined {
  return sourceRegistry.find((entry) => entry.id === id);
}
