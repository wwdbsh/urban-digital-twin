/**
 * Cross-wave PUBLIC SHOWCASE CANDIDATE manifest.
 *
 * WHAT THIS IS. A versioned, closed enumeration of the public-audience roots of
 * the six promoted exterior waves, together with the rights instrument each wave
 * ships under (carried BY REFERENCE — the release module's own
 * `ExteriorApprovalEvidence` object, never a re-authored copy), the fidelity
 * labels that must travel with those bytes, and an INDEPENDENT digest over the
 * artifact checksums each root declares.
 *
 * WHAT THIS IS NOT. It is not a deployment, not a publication, and not a new
 * approval. Every wave's instrument excludes public (internet) deployment, and
 * assembling a showcase VIEW of already-approved local material does not touch
 * that exclusion. Because the instruments are referenced rather than copied, a
 * reader of the showcase cannot reach a weaker statement than the release itself
 * made: there is no second copy of the exclusions to drift. Where the six waves
 * disagree — and they do, on redistribution, and even on the wording of the
 * deployment exclusion ("public deployment" for the two texture-free waves,
 * "public internet deployment" for the four textured ones) — the disagreement is
 * preserved per wave rather than normalized into one convenient sentence.
 *
 * THE CLAUSE THIS ANSWERS TO. The Northern-Manhattan instrument anticipated
 * exactly this deliverable and refused it in advance: "nothing in this
 * instrument authorizes assembling the six waves into a redistributable whole
 * that no single wave's instrument would permit." This manifest is therefore an
 * INVENTORY, not a grant — see `PUBLIC_SHOWCASE_ASSEMBLY_POSTURE`.
 *
 * WHY A SEPARATE MANIFEST AT ALL. Each release already partitions its own bytes
 * into a public and a private root, and the runtime already refuses a private
 * artifact reference (`assertPublicExteriorArtifactRef`). What did not exist was
 * a CROSS-WAVE statement: the closed set of roots a public showcase is allowed
 * to resolve, pinned independently of the release graphs it describes, so that a
 * seventh root — or a private root, or a renamed root — is refused BY NAME
 * instead of being silently included because it happened to be on disk.
 *
 * PINS AND DRIFT. The payload directories under `public/data/` are intentionally
 * untracked (the citywide precedent), so the pins below are the committed record
 * that keeps the enumerated bytes checkable. They are recomputed from the actual
 * release graphs by `scripts/public-showcase-audit-cli.mjs` and by
 * `public-showcase-manifest.test.ts`; a pin may move only together with a
 * recorded successor (`PUBLIC_SHOWCASE_SUCCESSOR`), which is `null` today.
 */
import type { ExteriorApprovalEvidence } from "../domain/exterior-contract.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { BLOCK835_V3_CANARY_APPROVAL } from "./block835-v3-canary-release.ts";
import { CENTRAL_UPPER_MANHATTAN_APPROVAL } from "./central-upper-manhattan-release.ts";
import { LOWER_MANHATTAN_APPROVAL } from "./lower-manhattan-release.ts";
import { MIDTOWN_CORE_V3_APPROVAL } from "./midtown-core-v3-release.ts";
import { NORTHERN_MANHATTAN_APPROVAL } from "./northern-manhattan-release.ts";
import { SOUTHERN_REMAINDER_APPROVAL } from "./southern-remainder-release.ts";

export const PUBLIC_SHOWCASE_SCHEMA_VERSION = "1.0";

/** Identity of this candidate. Local-only; it names no host and no deployment target. */
export const PUBLIC_SHOWCASE_CANDIDATE_ID = "manhattan-public-showcase-20260812";

/**
 * Texture posture, stated per wave because it differs and because the rights
 * consequence differs with it. `texture-free` waves ship geometry alone;
 * `procedural-replay` waves additionally carry designed, replay-gated detail
 * tiles whose redistribution their instrument expressly withholds.
 */
export type PublicShowcaseTextureAdmission = "texture-free" | "procedural-replay";

/**
 * How the wave's instrument treats redistribution. This is a report of what was
 * approved, not a permission this module grants.
 */
export type PublicShowcaseRedistributionPosture =
  /** Instrument covers redistribution of the deterministically generated, texture-free geometry. */
  | "generated-geometry-covered"
  /** Instrument expressly withholds redistribution of the detail tiles and of any package carrying them. */
  | "tiles-withheld";

export interface PublicShowcaseRightsInstrument {
  /**
   * The wave's approval, carried BY REFERENCE: this is the very object the
   * release module exports and the release graph pins, not a copy. Referencing
   * it rather than restating it is what makes "restate, never weaken"
   * structural instead of editorial — there is no second copy of the exclusions
   * that could drift into something more permissive, and a test asserts object
   * identity (`toBe`) rather than text equality.
   */
  readonly instrument: ExteriorApprovalEvidence;
  readonly redistribution: PublicShowcaseRedistributionPosture;
}

/** The approval id the wave's release graph pins. */
export function showcaseApprovalId(wave: PublicShowcaseWaveEntry): string {
  return wave.rights.instrument.id;
}

/** The approval fingerprint the wave's release graph pins. */
export function showcaseApprovalFingerprint(wave: PublicShowcaseWaveEntry): string {
  return wave.rights.instrument.fingerprintSha256;
}

/** The wave's exclusions, in the instrument's own order. Never edited here. */
export function showcaseExclusions(wave: PublicShowcaseWaveEntry): readonly string[] {
  return wave.rights.instrument.exclusions;
}

export interface PublicShowcaseFidelityLabels {
  /** Truth tier of the shipped exterior geometry. */
  readonly geometryTier: "generated";
  /** What the appearance is, in words that do not claim a real facade. */
  readonly designedAppearance: string;
  /** What remains uncertain about the shipped bytes. */
  readonly uncertainty: string;
}

export interface PublicShowcaseWaveEntry {
  /** Stable wave key, used for ordering and for audit grouping. */
  readonly waveId: string;
  /** Payload directory name under `public/data/`, and the browser path segment. */
  readonly packageId: string;
  readonly cityId: string;
  readonly configId: string;
  /** The one root a showcase may resolve for this wave. */
  readonly publicRootId: string;
  readonly publicReleaseId: string;
  readonly publicRootChecksumSha256: string;
  /** Artifacts the public root declares. */
  readonly artifactCount: number;
  readonly artifactByteTotal: number;
  /**
   * Independent digest over this root's declared artifact checksums:
   * sha256 of sorted `"<relativeRef> <checksumSha256> <byteSize>\n"` lines. It
   * does not reuse the release graph's own root-checksum algorithm, so a change
   * to that algorithm cannot silently carry this pin along with it.
   */
  readonly artifactChecksumDigestSha256: string;
  /**
   * The private counterpart, carried BY REFERENCE ONLY so the audit can name
   * what is excluded. No private byte, path, or evidence id is reachable from
   * these two fields — they are an id and a checksum.
   */
  readonly privateRootId: string;
  readonly privateRootChecksumSha256: string;
  readonly privateArtifactCount: number;
  readonly textureAdmission: PublicShowcaseTextureAdmission;
  readonly attribution: string;
  readonly fidelity: PublicShowcaseFidelityLabels;
  readonly rights: PublicShowcaseRightsInstrument;
}

/** NYC OTI attribution and the City's modified-data disclaimer, carried on every wave. */
const NYC_OTI_ATTRIBUTION =
  "Derived from NYC Office of Technology and Innovation Building Footprints (jh45-qr5r). This is modified data; the City of New York does not endorse or warrant it, and the modifications are this project's own.";

const TEXTURE_FREE_FIDELITY: PublicShowcaseFidelityLabels = {
  geometryTier: "generated",
  designedAppearance:
    "Exterior massing is deterministically generated from the sourced footprint and height. It carries no texture of any kind; any apparent surface variation is untextured shading of designed geometry and reports nothing about a real facade.",
  uncertainty:
    "The shipped massing reproduces the SOURCED polygon within the stated tolerance. It does not claim the sourced polygon matches the real building, and it claims nothing about facade, material, colour, tenancy, signage, age, or condition. Source height uncertainty is retained per building.",
};

const PROCEDURAL_REPLAY_FIDELITY: PublicShowcaseFidelityLabels = {
  geometryTier: "generated",
  designedAppearance:
    "Exterior massing is deterministically generated from the sourced footprint and height, and carries DESIGNED, procedurally generated facade detail tiles at level of detail 0. Every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte, carries luminance modulation only and no colour, and cites no evidence record. No pixel of any photograph is present in or derivable from the shipped bytes.",
  uncertainty:
    "The shipped massing reproduces the SOURCED polygon within the stated tolerance. It does not claim the sourced polygon matches the real building. A detail tile is designed ornament: it does not reproduce, resemble, or report on any real building's facade, material, colour, age, or condition. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building ships as an explicit unavailable detail with a stated reason.",
};

/**
 * THE CLOSED SET. Ordered as the build activates the waves
 * (`EXTERIOR_DEFAULT_ACTIVATIONS`). Membership is the whole point: a root that
 * does not appear here is refused by name, whether it is a private root, an
 * unpromoted canary, a superseded predecessor, or a package nobody declared.
 */
export const PUBLIC_SHOWCASE_WAVES: readonly PublicShowcaseWaveEntry[] = [
  {
    waveId: "block-835",
    packageId: "manhattan-exterior-cells-20260811-v3",
    cityId: "manhattan",
    configId: "manhattan-esb-block-835",
    publicRootId: "root:manhattan-exterior-cells-20260811-v3:public",
    publicReleaseId: "manhattan-exterior-cells-20260811-v3",
    publicRootChecksumSha256: "3eb584b5106d6cf4574b98d9992b9246a0dcd176ea1ad03c691e1c54615680ba",
    artifactCount: 31,
    artifactByteTotal: 252632,
    artifactChecksumDigestSha256: "d79cdd799a55e75f0983fefd4e1adffd46c9d61400479edff6538f7c1a409447",
    privateRootId: "root:manhattan-exterior-cells-20260811-v3:private",
    privateRootChecksumSha256: "42c17fb44d14370d4d4669500b30d8cd792f22e012f0f582dc924e0ca2bf8933",
    privateArtifactCount: 1,
    textureAdmission: "texture-free",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: TEXTURE_FREE_FIDELITY,
    rights: { instrument: BLOCK835_V3_CANARY_APPROVAL, redistribution: "generated-geometry-covered" },
  },
  {
    waveId: "midtown-core",
    packageId: "manhattan-midtown-core-cells-20260811-v3",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    publicRootId: "root:manhattan-midtown-core-cells-20260811-v3:public",
    publicReleaseId: "manhattan-midtown-core-cells-20260811-v3",
    publicRootChecksumSha256: "13b382e76c39761b76aa8b2fac8e43e4519824bc56a7bc0564c841a7c0798804",
    artifactCount: 463,
    artifactByteTotal: 6349425,
    artifactChecksumDigestSha256: "41a4e413b08a97f89c75cc3d60660e597eb16d0b637a49e7d9027356880dac30",
    privateRootId: "root:manhattan-midtown-core-cells-20260811-v3:private",
    privateRootChecksumSha256: "9bb3f29439b202501235cdf2e07b0671a4ec9c530a6511bde0fb7b095096ee2c",
    privateArtifactCount: 1,
    textureAdmission: "texture-free",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: TEXTURE_FREE_FIDELITY,
    rights: { instrument: MIDTOWN_CORE_V3_APPROVAL, redistribution: "generated-geometry-covered" },
  },
  {
    waveId: "lower-manhattan",
    packageId: "manhattan-lower-manhattan-cells-20260812-p1",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    publicRootId: "root:manhattan-lower-manhattan-cells-20260812-p1:public",
    publicReleaseId: "manhattan-lower-manhattan-cells-20260812-p1",
    publicRootChecksumSha256: "408f7f619a025ec9d8cdd5d48c6dcde6e38f0c5a662b60f0243bc1ef1e6f6415",
    artifactCount: 270,
    artifactByteTotal: 4633556,
    artifactChecksumDigestSha256: "c4fc86ae5b59cb4f86e4b8fd65b5ee6d5def8f2c1350d9fd06bbb96e6e9df2d5",
    privateRootId: "root:manhattan-lower-manhattan-cells-20260812-p1:private",
    privateRootChecksumSha256: "26c0edf969a3cf2d2d9dba2c8bb10f2b583c89c966c5d033542b4a8785e5c2cd",
    privateArtifactCount: 1,
    textureAdmission: "procedural-replay",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: PROCEDURAL_REPLAY_FIDELITY,
    rights: { instrument: LOWER_MANHATTAN_APPROVAL, redistribution: "tiles-withheld" },
  },
  {
    waveId: "southern-remainder",
    packageId: "manhattan-southern-remainder-cells-20260812-p1",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    publicRootId: "root:manhattan-southern-remainder-cells-20260812-p1:public",
    publicReleaseId: "manhattan-southern-remainder-cells-20260812-p1",
    publicRootChecksumSha256: "59dc5d49b04770330bf95b4d91382c5c0500f1b8dd838e0775c2f4727b22b7a5",
    artifactCount: 536,
    artifactByteTotal: 8290815,
    artifactChecksumDigestSha256: "cb96cdecf98754f7892f90ae3da3666b31fa4d0c39e984ca6939b464f9b83a80",
    privateRootId: "root:manhattan-southern-remainder-cells-20260812-p1:private",
    privateRootChecksumSha256: "b23318c56531712633910f49beffd88ba47e22eacbcc14a59b3a28ed1721ba64",
    privateArtifactCount: 1,
    textureAdmission: "procedural-replay",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: PROCEDURAL_REPLAY_FIDELITY,
    rights: { instrument: SOUTHERN_REMAINDER_APPROVAL, redistribution: "tiles-withheld" },
  },
  {
    waveId: "central-upper-manhattan",
    packageId: "manhattan-central-upper-manhattan-cells-20260812-p1",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    publicRootId: "root:manhattan-central-upper-manhattan-cells-20260812-p1:public",
    publicReleaseId: "manhattan-central-upper-manhattan-cells-20260812-p1",
    publicRootChecksumSha256: "b7df778326786f7b44e2c9abf4c039e4848d562331a7f6ecc7cfc216aa55a9a0",
    artifactCount: 331,
    artifactByteTotal: 6982368,
    artifactChecksumDigestSha256: "3e83669e2999ac2da58682b972c3c7dce148043564be7ea41965d1bac06cf7d1",
    privateRootId: "root:manhattan-central-upper-manhattan-cells-20260812-p1:private",
    privateRootChecksumSha256: "9b454691d0fea8a656752cac01fb52e28cf2caa4d10a3889931c923cbd1ba6bb",
    privateArtifactCount: 1,
    textureAdmission: "procedural-replay",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: PROCEDURAL_REPLAY_FIDELITY,
    rights: { instrument: CENTRAL_UPPER_MANHATTAN_APPROVAL, redistribution: "tiles-withheld" },
  },
  {
    waveId: "northern-manhattan",
    packageId: "manhattan-northern-manhattan-cells-20260812-p1",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    publicRootId: "root:manhattan-northern-manhattan-cells-20260812-p1:public",
    publicReleaseId: "manhattan-northern-manhattan-cells-20260812-p1",
    publicRootChecksumSha256: "dd990f70cf681727a99b6381074469fa2afa6ee212f95a9cddcdb31929b3bc0a",
    artifactCount: 232,
    artifactByteTotal: 5667761,
    artifactChecksumDigestSha256: "0edf7bbddb375001c72044e4cae2c2a7ce9ca952a9f338d7cdce0f7f65eb28a5",
    privateRootId: "root:manhattan-northern-manhattan-cells-20260812-p1:private",
    privateRootChecksumSha256: "8bc2d5ca7f3bc99c29636cc924bef9f4e14da3d69b2c217609d1a73f659ec3de",
    privateArtifactCount: 1,
    textureAdmission: "procedural-replay",
    attribution: NYC_OTI_ATTRIBUTION,
    fidelity: PROCEDURAL_REPLAY_FIDELITY,
    rights: { instrument: NORTHERN_MANHATTAN_APPROVAL, redistribution: "tiles-withheld" },
  },
];

/** The closed set of public root ids, in wave order. Anything else is refused by name. */
export const PUBLIC_SHOWCASE_PUBLIC_ROOT_IDS: readonly string[] = PUBLIC_SHOWCASE_WAVES.map((wave) => wave.publicRootId);

/** The closed set of payload directory names the showcase may resolve. */
export const PUBLIC_SHOWCASE_PACKAGE_IDS: readonly string[] = PUBLIC_SHOWCASE_WAVES.map((wave) => wave.packageId);

/**
 * The private roots the showcase EXCLUDES. Listed so that a reader can check the
 * exclusion is complete, and so the audit can assert that none of these ids
 * names a byte the public candidate resolves.
 */
export const PUBLIC_SHOWCASE_EXCLUDED_PRIVATE_ROOT_IDS: readonly string[] = PUBLIC_SHOWCASE_WAVES.map((wave) => wave.privateRootId);

/**
 * Browser path prefixes the showcase session is allowed to request, one per
 * wave. `/data/<packageId>/` mirrors `exteriorCellBasePath` in `App.tsx`.
 */
export const PUBLIC_SHOWCASE_DATA_URL_PREFIXES: readonly string[] = PUBLIC_SHOWCASE_WAVES.map((wave) => `/data/${wave.packageId}/`);

/**
 * THE BASE PACKAGES the six waves are composed OVER.
 *
 * A wave ships exterior geometry for a bounded subset of the buildings it owns;
 * everything else a session shows — the citywide massing, the details and search
 * shards behind a pick, the civic context layers — comes from these separately
 * approved public releases. A candidate that enumerated only the six waves would
 * therefore be an INCOMPLETE description of what the showcase resolves, and the
 * smoke run proved it: a default session requested all three of these and the
 * first draft of this allowlist refused them.
 *
 * They are enumerated rather than pattern-allowed, for the same reason the waves
 * are: this is a closed set, and a fourth base package is refused by name. None
 * of them carries an audience partition — each was checked to have no `private/`
 * directory at all — so there is no private counterpart to exclude.
 */
/**
 * WHERE a base package's deployment exclusion comes from.
 *
 * This distinction is the whole point of the field. Two of the three base
 * packages carry an approval instrument in their own release manifest that
 * excludes "public deployment", and for those the showcase INHERITS an existing
 * restriction. The third carries no `approval` key at all, and an earlier draft
 * of this manifest still asserted `deploymentExcluded: true` for it — which was
 * an unbacked rights conclusion: it read as though an instrument said so when
 * nothing did.
 *
 * Imposing our own restriction on it is fine and is what this candidate does.
 * Claiming to have inherited one is not. The two cases are therefore recorded as
 * different things, and the test reads the actual release manifests rather than
 * trusting the literal below.
 */
export type PublicShowcaseDeploymentExclusionSource =
  /** The release's own manifest carries an approval whose exclusions name public deployment. */
  | "release-approval-instrument"
  /** No instrument in the release. The exclusion is imposed here and inherited from nothing. */
  | "imposed-by-this-showcase-manifest";

export interface PublicShowcaseBasePackage {
  readonly packageId: string;
  /** Why a showcase session legitimately requests it. */
  readonly role: string;
  /** Whether the six waves' `index.json` declares it under `baseCompatibility`. */
  readonly declaredByWaveBaseCompatibility: boolean;
  /**
   * True for all three, but NOT for the same reason — read
   * `deploymentExclusionSource` before quoting this field.
   */
  readonly deploymentExcluded: boolean;
  readonly deploymentExclusionSource: PublicShowcaseDeploymentExclusionSource;
  /** Stated in the record's own words, so a reader can check the claim against the release. */
  readonly deploymentExclusionBasis: string;
  /**
   * The declared top-level entry points and public directory prefixes of this
   * base package. A prefix ends in `/`; anything else is an exact file name.
   *
   * This exists for SYMMETRY with the wave branch of the classifier. A wave
   * request is anchored twice — once to an enumerated `/data/<id>/` prefix and
   * again to a declared entry point or the wave's `public/` partition — while a
   * base-package request used to be admitted on the package prefix ALONE, so
   * `/data/manhattan-citywide-20260804/anything/at/all` classified. Declaring
   * the anchors per package restores the second half of that check without
   * pretending the three base packages share a layout: they do not, and the
   * constant says so one package at a time.
   */
  readonly publicPathAnchors: readonly string[];
}

export const PUBLIC_SHOWCASE_BASE_PACKAGES: readonly PublicShowcaseBasePackage[] = [
  {
    packageId: "manhattan-citywide-20260804",
    role: "The pinned citywide base: canonical building identities, base massing geometry, and the detail and search shards a pick reads. Every wave's ownership ledger is a subset of this release's base identity set.",
    declaredByWaveBaseCompatibility: true,
    deploymentExcluded: true,
    deploymentExclusionSource: "release-approval-instrument",
    deploymentExclusionBasis: "public/data/manhattan-citywide-20260804/manifest.json `approval.exclusions` names \"public deployment\".",
    publicPathAnchors: ["manifest.json", "manifest.sha256", "details/", "geometry/", "search/"],
  },
  {
    packageId: "manhattan-civic-context-20260804",
    role: "Civic context layers (neighbourhood tabulation areas, parks, landmark districts) that give the exterior waves their surrounding frame.",
    declaredByWaveBaseCompatibility: true,
    deploymentExcluded: true,
    deploymentExclusionSource: "release-approval-instrument",
    deploymentExclusionBasis: "public/data/manhattan-civic-context-20260804/manifest.json `approval.exclusions` names \"public deployment\".",
    publicPathAnchors: ["manifest.json", "manifest.sha256", "details/", "geometry/", "search/"],
  },
  {
    packageId: "real-wave-20260804",
    role: "The application's small pilot fallback release. A default session probes it while resolving which base is available; it carries no exterior wave geometry.",
    declaredByWaveBaseCompatibility: false,
    deploymentExcluded: true,
    deploymentExclusionSource: "imposed-by-this-showcase-manifest",
    deploymentExclusionBasis: "public/data/real-wave-20260804/manifest.json carries NO `approval` key. Nothing in that release excludes deployment, and nothing here claims it does; this candidate imposes the exclusion on it because the candidate is local-only, and that restriction is inherited from nothing.",
    publicPathAnchors: ["manifest.json", "buildings.json", "restaurants.json"],
  },
];

export const PUBLIC_SHOWCASE_BASE_PACKAGE_IDS: readonly string[] = PUBLIC_SHOWCASE_BASE_PACKAGES.map((entry) => entry.packageId);

/**
 * Non-payload same-origin prefixes a production session legitimately requests:
 * the document, the bundled app, and the vendored Cesium runtime. Listed
 * explicitly so the smoke audit classifies every request rather than ignoring
 * the ones that are not release payload.
 */
export const PUBLIC_SHOWCASE_APP_URL_PREFIXES: readonly string[] = ["/", "/assets/", "/cesiumStatic/"];

/**
 * Anchored `/data/<packageId>/` prefixes for the three base packages, derived
 * from the package list rather than rebuilt inline at the call site.
 *
 * The sibling `PUBLIC_SHOWCASE_DATA_URL_PREFIXES` has always existed for the
 * six waves; the base branch used to build its prefix with a template literal
 * inside the classifier, which is the same value written a second time in a
 * second place. One derivation, one place.
 */
export const PUBLIC_SHOWCASE_BASE_URL_PREFIXES: readonly string[] = PUBLIC_SHOWCASE_BASE_PACKAGES.map((entry) => `/data/${entry.packageId}/`);

/**
 * Paths a BROWSER issues on its own, that no application code requests and no
 * release declares.
 *
 * This exists because of a measured reproducibility failure, and its shape is
 * chosen to repair that failure without weakening the check that found it. The
 * T023 `six-wave-default` smoke journey passed on the profile it was captured
 * with and FAILED on any fresh Chrome profile, because a fresh profile issues
 * `/favicon.ico` for a document that declares no icon, the classifier had no
 * category for it, and `everyRequestClassified` therefore read `false`. The
 * substance was never in doubt — zero external hosts, every wave streaming its
 * exact expected GLB count, every private probe returning the shell — but a
 * pass that depends on browser-profile state is not a property of the release.
 *
 * Three deliberate narrowings keep this from becoming a hole:
 *
 *  1. EXACT MATCH ONLY. These are compared with `===`, never as prefixes, so
 *     nothing is admitted by resembling one of them.
 *  2. IT IS A CLASSIFICATION, NOT AN EXEMPTION. A browser-implicit request is
 *     reported in the record with its own count. It is not dropped from the
 *     observed set, and an unrecognised path still refuses.
 *  3. THE SERVER STILL HAS TO FAIL CLOSED. Classifying the path says only that
 *     the browser asked; the smoke audit separately requires that no
 *     browser-implicit request was ANSWERED with bytes, because the candidate
 *     ships no such file. A build that started serving one would fail the
 *     journey even though the path classifies.
 */
export const PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS: readonly string[] = [
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
];

/**
 * The exclusions restated across the whole candidate. This is the UNION, kept
 * for a reader who wants the one-page statement — it is deliberately the union
 * and not an intersection, because a showcase that spans six waves may do only
 * what ALL six instruments allow. Per-wave text remains authoritative.
 */
export const PUBLIC_SHOWCASE_RESTATED_EXCLUSIONS: readonly string[] = (() => {
  const seen = new Set<string>();
  const union: string[] = [];
  for (const wave of PUBLIC_SHOWCASE_WAVES) {
    for (const exclusion of showcaseExclusions(wave)) {
      if (seen.has(exclusion)) continue;
      seen.add(exclusion);
      union.push(exclusion);
    }
  }
  return union.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
})();

/**
 * The two statements that a showcase is most likely to be read as weakening, so
 * they are stated in one place, in the strongest form any wave used, and the
 * audit asserts both are still present in every wave's restated exclusions.
 */
export const PUBLIC_SHOWCASE_STANDING_REFUSALS = {
  publicInternetDeployment:
    "This candidate is a LOCAL build only. Every wave's instrument excludes public deployment, and nothing here asserts a right to deploy it to the public internet.",
  tileRedistribution:
    "Redistribution of the procedural facade detail tiles, or of any package carrying them, is NOT asserted by any wave that ships them, whether or not the underlying generated geometry is separately redistributable.",
  /**
   * The clause this deliverable is most directly answerable to. The
   * Northern-Manhattan instrument anticipated a cross-wave assembly and refused
   * it in advance; the sentence below is quoted from
   * `NORTHERN_MANHATTAN_APPROVAL_NOTE`, and `public-showcase-manifest.test.ts`
   * asserts the quotation is still present in that note rather than trusting
   * this copy.
   */
  crossWaveAssembly:
    "nothing in this instrument authorizes assembling the six waves into a redistributable whole that no single wave's instrument would permit",
} as const;

/**
 * The quoted clause's consequence for this manifest, stated plainly: a
 * cross-wave enumeration is an INVENTORY, not a grant. It reports what six
 * separately approved local releases contain; it does not create a seventh
 * thing that may be conveyed as a unit. Every verb a reader might infer from
 * "showcase" — deploy, publish, redistribute the assembled whole — is refused
 * above, by the instruments themselves and not merely by this file.
 */
export const PUBLIC_SHOWCASE_ASSEMBLY_POSTURE =
  "This candidate is an inventory of six separately approved local releases, not a new redistributable whole. It grants no verb, adds no source, and widens no audience; the narrowest instrument governs anything the six are read as doing together.";

/**
 * Recorded successor. Drift protection: the pins above are immutable while this
 * is `null`. Moving a pin without recording a successor here is the failure the
 * drift suite is looking for.
 */
export const PUBLIC_SHOWCASE_SUCCESSOR: { readonly candidateId: string; readonly reason: string } | null = null;

/** Canonical, order-stable projection of one wave entry for digest purposes. */
function digestProjection(wave: PublicShowcaseWaveEntry): unknown {
  return {
    artifactByteTotal: wave.artifactByteTotal,
    artifactChecksumDigestSha256: wave.artifactChecksumDigestSha256,
    artifactCount: wave.artifactCount,
    approvalFingerprintSha256: showcaseApprovalFingerprint(wave),
    approvalId: showcaseApprovalId(wave),
    exclusions: [...showcaseExclusions(wave)],
    packageId: wave.packageId,
    privateRootChecksumSha256: wave.privateRootChecksumSha256,
    privateRootId: wave.privateRootId,
    publicRootChecksumSha256: wave.publicRootChecksumSha256,
    publicRootId: wave.publicRootId,
    textureAdmission: wave.textureAdmission,
    waveId: wave.waveId,
  };
}

/**
 * The candidate's own digest, computed over the enumerated artifact checksums
 * (via each wave's independent artifact digest) and the identifying pins around
 * them. Independent of any release graph's internal hashing.
 */
export function computePublicShowcaseDigest(
  waves: readonly PublicShowcaseWaveEntry[] = PUBLIC_SHOWCASE_WAVES,
  basePackages: readonly PublicShowcaseBasePackage[] = PUBLIC_SHOWCASE_BASE_PACKAGES,
): string {
  return sha256HexSync(stableSerialize({
    // Base packages are inside the digest because they are inside the closed
    // set: a session resolves them, so a fourth one appearing is a change to
    // what the candidate is, and must move the pin rather than slip in.
    basePackages: basePackages.map((entry) => ({
      deploymentExcluded: entry.deploymentExcluded,
      deploymentExclusionSource: entry.deploymentExclusionSource,
      packageId: entry.packageId,
      // The anchors are part of WHAT THE CANDIDATE ADMITS, so they belong in
      // the identity of the candidate. Leaving them out would let someone
      // widen a base package's reachable surface — the exact thing the anchor
      // list exists to bound — without the digest moving, which is how a pinned
      // identity stops meaning anything.
      publicPathAnchors: [...entry.publicPathAnchors],
    })),
    candidateId: PUBLIC_SHOWCASE_CANDIDATE_ID,
    schemaVersion: PUBLIC_SHOWCASE_SCHEMA_VERSION,
    waves: waves.map(digestProjection),
  }));
}

/** Pinned value of `computePublicShowcaseDigest()`. */
export const PUBLIC_SHOWCASE_DIGEST_SHA256 = "8b54d4b1cd87b940340b29e580774fbc2683882f3d37c02703bcb0b61cd95646";

export class PublicShowcaseRefusal extends Error {
  readonly code: string;
  readonly subject: string;
  constructor(code: string, subject: string, message: string) {
    super(message);
    this.name = "PublicShowcaseRefusal";
    this.code = code;
    this.subject = subject;
  }
}

/**
 * Resolve a root id against the closed set. A private root is refused with its
 * own message, because "not in the allowlist" would understate what happened.
 */
export function assertShowcasePublicRootId(rootId: unknown): PublicShowcaseWaveEntry {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new PublicShowcaseRefusal("root-id-invalid", String(rootId), `Public showcase root id is not a non-empty string: ${String(rootId)}`);
  }
  const wave = PUBLIC_SHOWCASE_WAVES.find((entry) => entry.publicRootId === rootId);
  if (wave) return wave;
  const excluded = PUBLIC_SHOWCASE_WAVES.find((entry) => entry.privateRootId === rootId);
  if (excluded) {
    throw new PublicShowcaseRefusal("private-root-forbidden", rootId, `Public showcase refuses private root ${rootId}: it is the excluded private counterpart of ${excluded.publicRootId} and carries no showcase-resolvable byte.`);
  }
  throw new PublicShowcaseRefusal("root-not-in-candidate", rootId, `Public showcase refuses root ${rootId}: the candidate ${PUBLIC_SHOWCASE_CANDIDATE_ID} enumerates exactly ${PUBLIC_SHOWCASE_WAVES.length} public roots and this is not one of them.`);
}

/** Resolve a payload directory name against the closed set. */
export function assertShowcasePackageId(packageId: unknown): PublicShowcaseWaveEntry {
  if (typeof packageId !== "string" || packageId.length === 0) {
    throw new PublicShowcaseRefusal("package-id-invalid", String(packageId), `Public showcase package id is not a non-empty string: ${String(packageId)}`);
  }
  const wave = PUBLIC_SHOWCASE_WAVES.find((entry) => entry.packageId === packageId);
  if (wave) return wave;
  throw new PublicShowcaseRefusal("package-not-in-candidate", packageId, `Public showcase refuses package ${packageId}: it is not one of the ${PUBLIC_SHOWCASE_WAVES.length} enumerated public payload directories.`);
}

export type ShowcaseRequestClassification =
  | { readonly kind: "wave-payload"; readonly wave: PublicShowcaseWaveEntry; readonly path: string }
  | { readonly kind: "base-payload"; readonly base: PublicShowcaseBasePackage; readonly path: string }
  | { readonly kind: "app-shell"; readonly path: string }
  | { readonly kind: "browser-implicit"; readonly path: string };

/**
 * Classify one same-origin request path issued by a showcase session. Used by
 * the smoke audit: every observed request must classify, and a payload request
 * must land inside an enumerated wave's public partition.
 */
export function classifyShowcaseRequestPath(path: unknown): ShowcaseRequestClassification {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new PublicShowcaseRefusal("request-path-invalid", String(path), `Public showcase request path is not a rooted same-origin path: ${String(path)}`);
  }
  if (path.toLowerCase().includes("private")) {
    throw new PublicShowcaseRefusal("private-path-forbidden", path, `Public showcase session requested a private-partition path: ${path}`);
  }
  // Checked BEFORE `/data/`, and by exact match, so a browser-implicit name can
  // never shadow a payload path.
  if (PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS.includes(path)) return { kind: "browser-implicit", path };
  if (path.startsWith("/data/")) {
    const prefix = PUBLIC_SHOWCASE_DATA_URL_PREFIXES.find((candidate) => path.startsWith(candidate));
    if (!prefix) {
      const baseIndex = PUBLIC_SHOWCASE_BASE_URL_PREFIXES.findIndex((candidate) => path.startsWith(candidate));
      if (baseIndex >= 0) {
        const base = PUBLIC_SHOWCASE_BASE_PACKAGES[baseIndex]!;
        const rest = path.slice(PUBLIC_SHOWCASE_BASE_URL_PREFIXES[baseIndex]!.length);
        // The second anchor, symmetric with the wave branch below: a declared
        // top-level entry point (exact) or a declared public directory prefix.
        const anchored = base.publicPathAnchors.some((anchor) => (anchor.endsWith("/") ? rest.startsWith(anchor) && rest.length > anchor.length : rest === anchor));
        if (!anchored) {
          throw new PublicShowcaseRefusal("payload-outside-public-partition", path, `Public showcase session requested ${path}, which is inside base package ${base.packageId} but is neither a declared entry point nor under a declared public directory of that package.`);
        }
        return { kind: "base-payload", base, path };
      }
      throw new PublicShowcaseRefusal("payload-outside-candidate", path, `Public showcase session requested payload outside the enumerated public roots and base packages: ${path}`);
    }
    const wave = assertShowcasePackageId(prefix.slice("/data/".length, -1));
    const rest = path.slice(prefix.length);
    const allowedTop = rest === "index.json" || rest === "release-graph.json" || rest === "assemblies.json" || rest.startsWith("public/");
    if (!allowedTop) {
      throw new PublicShowcaseRefusal("payload-outside-public-partition", path, `Public showcase session requested ${path}, which is neither a declared package entry point nor a path under the wave's public/ partition.`);
    }
    return { kind: "wave-payload", wave, path };
  }
  const appPrefix = PUBLIC_SHOWCASE_APP_URL_PREFIXES.some((candidate) => (candidate === "/" ? path === "/" || path === "/index.html" : path.startsWith(candidate)));
  if (!appPrefix) {
    throw new PublicShowcaseRefusal("request-outside-candidate", path, `Public showcase session requested ${path}, which is neither app shell nor enumerated wave payload.`);
  }
  return { kind: "app-shell", path };
}
