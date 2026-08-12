#!/usr/bin/env node
/* global console, process, TextDecoder */
/**
 * PRIVATE/PUBLIC DIFFERENTIAL AUDIT for the cross-wave public showcase candidate.
 *
 * WHAT THIS PROVES, per completed wave:
 *   (1) RESOLUTION. Every artifact the wave's PUBLIC root declares exists on
 *       disk at its declared relative path, at its declared byte size, and
 *       hashes to its declared checksum. A declared-but-absent artifact and a
 *       present-but-altered artifact are both failures, reported by name.
 *   (2) EXCLUSION. Every artifact the wave's PRIVATE root declares is named,
 *       together with the reason it is excluded, and is proven ABSENT from the
 *       browser-reachable tree. Private working records under `data/` are
 *       enumerated the same way.
 *   (3) NON-REACHABILITY. No private path, private root id, or restricted
 *       working-record identifier is reachable from the public candidate,
 *       except where the release graph itself DECLARES the reference — and
 *       every such declared disclosure is enumerated individually rather than
 *       waved through by a pattern.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE. It says nothing about what a browser
 * renders, what a user sees, or what the network actually requested; that is
 * `scripts/public-showcase-smoke-cli.mjs`. It also does not re-derive the
 * releases: it audits the emitted bytes against their own declarations.
 *
 * THE HONEST PART. A naive "grep the public tree for the word private and fail"
 * check would pass only by ignoring what the release graphs actually contain.
 * They legitimately publish their private counterpart's ROOT ID and CHECKSUM
 * (`privatePredecessor`) and one declared private artifact PATH, because the
 * public root's provenance is not stateable without naming what it succeeded.
 * Those are metadata, not bytes. This audit therefore splits findings into:
 *
 *   - `declared-provenance-disclosure`: the public root's `privatePredecessor`
 *     citation — the id and checksum it must state to be able to say what it
 *     succeeded. Names no fetchable byte. ACCEPTED, and counted.
 *   - `declared-private-root-metadata`: fields INSIDE the graph's own private
 *     root object. `validateExteriorReleaseGraph` requires the graph to carry
 *     exactly one private and one public root (`exterior-release.ts:508`), so
 *     this block is schema-mandated, not smuggled: a graph without it fails
 *     validation. It is metadata only — an id, a release id, two checksums and
 *     one allowlisted path. ACCEPTED, counted SEPARATELY from the line above,
 *     and never on the strength of the schema alone: for every declared private
 *     path this audit additionally proves no byte exists at that path in the
 *     browser-reachable tree, and the smoke stage proves the path 404s.
 *   - `undeclared-private-reference`: anything else. FAILS CLOSED.
 *
 * The second heading is the one a reader should be most suspicious of, because
 * a category that makes a failing audit pass is exactly how an audit gets
 * hollowed out. It is drawn as narrowly as the fact allows: it matches only the
 * `roots[i]` subtree whose own `audience` field reads `private`, resolved per
 * file from that file's parsed content rather than from a path pattern, so a
 * private identifier appearing anywhere else in the same file still fails.
 *
 * A private BYTE reachable from the public tree is never acceptable under any
 * heading and is a separate, unconditional failure.
 *
 * Usage:
 *   node scripts/public-showcase-audit-cli.mjs [--out <path>] [--public-data <dir>] [--json]
 *
 * Default `--out` is `data/public-showcase-20260812/differential-audit.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import {
  PUBLIC_SHOWCASE_ASSEMBLY_POSTURE,
  PUBLIC_SHOWCASE_CANDIDATE_ID,
  PUBLIC_SHOWCASE_DIGEST_SHA256,
  PUBLIC_SHOWCASE_SCHEMA_VERSION,
  PUBLIC_SHOWCASE_STANDING_REFUSALS,
  PUBLIC_SHOWCASE_WAVES,
  computePublicShowcaseDigest,
  showcaseApprovalFingerprint,
  showcaseApprovalId,
  showcaseExclusions,
} from "../src/release/public-showcase-manifest.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fail(message) {
  throw new Error(`public-showcase-audit: ${message}`);
}

/** Why a private-side item is excluded from the public candidate. Closed vocabulary. */
export const EXCLUSION_REASONS = {
  privateAudienceRoot:
    "private-audience-root: declared in the release's private root, which the public candidate never resolves and the browser runtime refuses by path prefix.",
  privateReferencePackage:
    "private-reference-package: an authoring/reference package whose every artifact lives under a `private/` partition; it reaches the public audience only as a named provenance ancestor, never as bytes.",
  workingEvidenceRecord:
    "working-evidence-record: a committed record under `data/` that pins what was built and measured. It is not served by the application at all — `data/` is outside the browser-reachable tree — and is retained so the emitted bytes stay checkable.",
  unmaterializedByDesign:
    "unmaterialized-by-design: the private root declares this artifact, but no byte for it was ever emitted into the browser-reachable payload tree, so there is nothing to prune or serve.",
};

/** Tombstone/fallback classes a public cell release may carry. */
export const FALLBACK_KINDS = { unavailable: "unavailable-with-stated-reason" };

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Walk a tree, following the worktree's payload symlinks, returning repo-relative POSIX paths. */
export function walkFiles(root) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          isDirectory = statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDirectory) visit(full);
      else found.push(full);
    }
  };
  if (!existsSync(root)) return found;
  visit(root);
  return found.sort();
}

function toRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

/**
 * Restricted identifiers a public artifact must not carry undeclared. Built per
 * wave from that wave's own release graph, so the audit never has to guess at a
 * naming convention: it asks the graph what its private side is called.
 */
export function restrictedIdentifiersFor(graph, wave) {
  const privateRoot = graph.roots.find((root) => root.audience === "private");
  if (!privateRoot) fail(`${wave.packageId} declares no private root; the audience partition this audit checks does not exist.`);
  const identifiers = new Map();
  const add = (value, kind) => {
    if (typeof value === "string" && value.length > 0 && !identifiers.has(value)) identifiers.set(value, kind);
  };
  add(privateRoot.rootId, "private-root-id");
  add(privateRoot.releaseId, "private-release-id");
  add(privateRoot.rootChecksumSha256, "private-root-checksum");
  for (const artifact of privateRoot.artifacts ?? []) {
    add(artifact.relativeRef, "private-artifact-path");
    add(artifact.checksumSha256, "private-artifact-checksum");
  }
  for (const ref of privateRoot.artifactAllowlist ?? []) add(ref, "private-artifact-path");
  return identifiers;
}

/**
 * The EXACT normalized JSON paths at which a public root may cite its private
 * counterpart. Anchored, not suffix-matched.
 *
 * The earlier form matched any path ENDING in `privatePredecessor.rootId`, which
 * meant a deeply nested `some.note.privatePredecessor.rootId` earned the
 * accepted heading. Review also proved the looser form accepted a private
 * ARTIFACT PATH sitting at a `privatePredecessor.id` position — a path is not a
 * root id, and accepting it there was accepting the wrong KIND of secret in a
 * field that exists for a different one.
 *
 * So two things are pinned now: WHERE (exact path, after array indexes are
 * stripped) and WHAT KIND (`ACCEPTED_DISCLOSURE_IDENTIFIER_KINDS`). A citation
 * is a root's identity and hash; it is never a path, never a release id, and
 * never an artifact checksum.
 */
export const DECLARED_DISCLOSURE_PATHS = [
  // release-graph.json: roots[N].privatePredecessor.*
  "roots.privatePredecessor.rootId",
  "roots.privatePredecessor.rootChecksumSha256",
  // assemblies.json: [N].release.privatePredecessor.*
  "release.privatePredecessor.id",
  "release.privatePredecessor.checksumSha256",
];

/** Only a root's identity and hash may be cited. Not a path, not a release id. */
export const ACCEPTED_DISCLOSURE_IDENTIFIER_KINDS = ["private-root-id", "private-root-checksum"];

/**
 * The keys of the private root object that the release-graph schema requires,
 * whitelisted individually.
 *
 * Accepting the WHOLE `roots[private]` subtree was too generous: review proved
 * that an invented `roots[0].leakedFetchUrl` carrying a private URL classified
 * as accepted, because it merely sat under the right prefix. The schema mandates
 * specific fields, so those are what is accepted; a key the schema never defined
 * is exactly the thing that should fail.
 */
export const DECLARED_PRIVATE_ROOT_KEYS = [
  "rootId",
  "releaseId",
  "rootChecksumSha256",
  "artifacts.relativeRef",
  "artifacts.checksumSha256",
  "artifactAllowlist",
];

/**
 * Strip array indexes so `roots[1].x` and `artifacts[7].y` compare structurally.
 *
 * The leading-dot trim matters: `assemblies.json` is a top-level ARRAY, so its
 * paths start `[0].release…` and stripping the index leaves `.release…`, which
 * would match no anchored path at all. That is how it failed the first time.
 */
function normalizePath(path) {
  return path.replace(/\[\d+\]/gu, "").replace(/^\.+/u, "");
}

/**
 * Every string in a JSON value, with its dotted path — VALUES and KEYS both.
 *
 * Keys are scanned because review proved an object *keyed* by a private root id
 * (`{ "root:...:private": {...} }`) produced zero findings: the secret was in
 * the key, and only values were ever read. A key finding is reported at
 * `<path>#key` so it can never collide with a declared value path, which means
 * a private identifier used as a key always fails closed.
 */
function* stringLeaves(value, path = "") {
  if (typeof value === "string") {
    yield [path, value];
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) yield* stringLeaves(value[index], `${path}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      yield [`${childPath}#key`, key];
      yield* stringLeaves(child, childPath);
    }
  }
}

function isDeclaredDisclosurePath(path) {
  return DECLARED_DISCLOSURE_PATHS.includes(normalizePath(path));
}

/**
 * The dotted-path prefix of the graph's own private root object, resolved from
 * the parsed content rather than assumed. Returns `null` when the value carries
 * no such root, which is why a non-graph artifact can never earn this heading.
 */
export function privateRootPathPrefix(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.roots)) return null;
  const index = parsed.roots.findIndex((root) => root && typeof root === "object" && root.audience === "private");
  return index >= 0 ? `roots[${index}].` : null;
}

/** A path inside the private root that names a schema-mandated key, and nothing else. */
function isDeclaredPrivateRootPath(path, privatePrefix) {
  if (privatePrefix === null || !path.startsWith(privatePrefix)) return false;
  return DECLARED_PRIVATE_ROOT_KEYS.includes(normalizePath(path.slice(privatePrefix.length)));
}

/**
 * Scan one public JSON artifact for restricted identifiers. Structural (path-
 * aware) rather than a substring grep, so a legitimate `privatePredecessor`
 * field is distinguishable from the same string smuggled into a description.
 */
export function scanArtifactForRestricted(parsed, identifiers) {
  const findings = [];
  const privatePrefix = privateRootPathPrefix(parsed);
  for (const [path, leaf] of stringLeaves(parsed)) {
    for (const [identifier, kind] of identifiers) {
      if (!leaf.includes(identifier)) continue;
      let classification = "undeclared-private-reference";
      if (isDeclaredDisclosurePath(path) && ACCEPTED_DISCLOSURE_IDENTIFIER_KINDS.includes(kind)) classification = "declared-provenance-disclosure";
      else if (isDeclaredPrivateRootPath(path, privatePrefix)) classification = "declared-private-root-metadata";
      findings.push({ jsonPath: path, identifier, identifierKind: kind, classification });
    }
  }
  return findings;
}

/** Non-JSON public bytes (GLB, tileset payloads) are scanned as raw text. */
export function scanBytesForRestricted(bytes, identifiers) {
  const text = new TextDecoder("utf8", { fatal: false }).decode(bytes);
  const findings = [];
  for (const [identifier, kind] of identifiers) {
    if (text.includes(identifier)) findings.push({ jsonPath: null, identifier, identifierKind: kind, classification: "undeclared-private-reference" });
  }
  return findings;
}

/**
 * Audit one wave. Exported so a test can drive it against a SYNTHETIC package
 * whose bytes carry a planted private reference — a leak this audit cannot
 * detect on the six real waves, because they do not leak.
 */
export function auditWave(wave, options) {
  const packageRoot = join(options.publicDataDir, wave.packageId);
  if (!existsSync(packageRoot)) {
    fail(`${wave.packageId} is not present at ${packageRoot}. This audit reports on emitted bytes and refuses to report a pass it did not check.`);
  }
  const graph = readJson(join(packageRoot, "release-graph.json"));
  const publicRoot = graph.roots.find((root) => root.audience === "public");
  const privateRoot = graph.roots.find((root) => root.audience === "private");
  if (!publicRoot) fail(`${wave.packageId} declares no public root.`);
  // Checked before the first dereference below: a graph with no private root is
  // a missing audience partition, and saying so beats a TypeError three lines on.
  if (!privateRoot) fail(`${wave.packageId} declares no private root; the audience partition this audit checks does not exist.`);

  // --- Manifest pins vs the graph's own declarations -----------------------
  if (publicRoot.rootId !== wave.publicRootId) fail(`${wave.packageId} public rootId is ${publicRoot.rootId}, but the showcase manifest pins ${wave.publicRootId}.`);
  if (publicRoot.rootChecksumSha256 !== wave.publicRootChecksumSha256) fail(`${wave.packageId} public root checksum moved: graph ${publicRoot.rootChecksumSha256}, manifest ${wave.publicRootChecksumSha256}.`);
  if (privateRoot.rootId !== wave.privateRootId) fail(`${wave.packageId} private rootId is ${privateRoot.rootId}, but the showcase manifest pins ${wave.privateRootId}.`);
  if (privateRoot.rootChecksumSha256 !== wave.privateRootChecksumSha256) fail(`${wave.packageId} private root checksum moved: graph ${privateRoot.rootChecksumSha256}, manifest ${wave.privateRootChecksumSha256}.`);
  if (publicRoot.approval.id !== showcaseApprovalId(wave)) fail(`${wave.packageId} graph approval id ${publicRoot.approval.id} is not the instrument the manifest references (${showcaseApprovalId(wave)}).`);
  if (publicRoot.approval.fingerprintSha256 !== showcaseApprovalFingerprint(wave)) {
    fail(`${wave.packageId} graph approval fingerprint ${publicRoot.approval.fingerprintSha256} is not the referenced instrument's (${showcaseApprovalFingerprint(wave)}).`);
  }
  const graphExclusions = publicRoot.approval.exclusions ?? [];
  const manifestExclusions = showcaseExclusions(wave);
  const weakened = graphExclusions.filter((exclusion) => !manifestExclusions.includes(exclusion));
  if (weakened.length > 0) fail(`${wave.packageId}: the showcase omits exclusions the release asserted: ${weakened.join("; ")}`);

  // --- (1) RESOLUTION: every declared public artifact resolves -------------
  const resolved = [];
  const unresolved = [];
  const artifactLines = [];
  for (const artifact of publicRoot.artifacts) {
    const absolute = join(packageRoot, artifact.relativeRef);
    artifactLines.push(`${artifact.relativeRef} ${artifact.checksumSha256} ${artifact.byteSize}`);
    if (!existsSync(absolute)) {
      unresolved.push({ relativeRef: artifact.relativeRef, reason: "declared-but-absent" });
      continue;
    }
    const size = statSync(absolute).size;
    const checksum = sha256File(absolute);
    if (size !== artifact.byteSize) unresolved.push({ relativeRef: artifact.relativeRef, reason: "byte-size-mismatch", declared: artifact.byteSize, observed: size });
    else if (checksum !== artifact.checksumSha256) unresolved.push({ relativeRef: artifact.relativeRef, reason: "checksum-mismatch", declared: artifact.checksumSha256, observed: checksum });
    else resolved.push(artifact.relativeRef);
  }
  const artifactChecksumDigestSha256 = sha256HexSync(`${artifactLines.sort().join("\n")}\n`);
  if (artifactChecksumDigestSha256 !== wave.artifactChecksumDigestSha256) {
    fail(`${wave.packageId} artifact-checksum digest moved: computed ${artifactChecksumDigestSha256}, manifest pins ${wave.artifactChecksumDigestSha256}.`);
  }

  // Cell-release artifact refs (the GLB payloads) are declared outside the
  // root artifact list; a showcase that resolved only the root list would be
  // claiming a pass over the metadata while the geometry went unchecked.
  const cellArtifactRefs = new Set();
  for (const cellRelease of graph.cellReleases ?? []) {
    if (cellRelease.audience !== "public") continue;
    const ref = typeof cellRelease.artifactRef === "string" ? cellRelease.artifactRef : cellRelease.artifactRef?.relativeRef;
    if (typeof ref === "string") cellArtifactRefs.add(ref);
  }
  const assemblies = readJson(join(packageRoot, "assemblies.json"));
  const assemblyArtifactRefs = new Set();
  for (const assembly of assemblies) {
    if (assembly.audience !== "public") continue;
    for (const asset of assembly.assets ?? []) {
      for (const artifact of asset.artifacts ?? []) if (typeof artifact.relativeRef === "string") assemblyArtifactRefs.add(artifact.relativeRef);
    }
    for (const artifact of assembly.artifacts ?? []) if (typeof artifact.relativeRef === "string") assemblyArtifactRefs.add(artifact.relativeRef);
  }
  const payloadRefs = [...new Set([...cellArtifactRefs, ...assemblyArtifactRefs])].sort();
  const unresolvedPayload = payloadRefs.filter((ref) => !existsSync(join(packageRoot, ref)));

  // --- (2) EXCLUSION: name every private-side item and why ----------------
  //
  // Built over the UNION of `artifacts[].relativeRef` and `artifactAllowlist`,
  // because those are the two places `restrictedIdentifiersFor` admits a private
  // path from. Enumerating only `artifacts` happened to cover the allowlist on
  // these six waves — the two lists agree today — and a proof that holds by
  // coincidence is not a proof. The invariant is asserted below instead.
  const identifiers = restrictedIdentifiersFor(graph, wave);
  const artifactByRef = new Map((privateRoot.artifacts ?? []).map((artifact) => [artifact.relativeRef, artifact]));
  const declaredPrivatePaths = [...new Set([
    ...(privateRoot.artifacts ?? []).map((artifact) => artifact.relativeRef),
    ...(privateRoot.artifactAllowlist ?? []),
  ].filter((ref) => typeof ref === "string"))].sort();

  const exclusions = [];
  for (const relativeRef of declaredPrivatePaths) {
    const artifact = artifactByRef.get(relativeRef) ?? null;
    const present = existsSync(join(packageRoot, relativeRef));
    exclusions.push({
      relativeRef,
      logicalId: artifact?.logicalId ?? null,
      kind: artifact?.kind ?? null,
      declaredByteSize: artifact?.byteSize ?? null,
      declaredIn: artifact ? "private-root-artifacts" : "private-root-artifact-allowlist",
      reason: present ? EXCLUSION_REASONS.privateAudienceRoot : EXCLUSION_REASONS.unmaterializedByDesign,
      reachableInPayloadTree: present,
    });
  }

  // THE INVARIANT, asserted rather than assumed: every private PATH the scanner
  // treats as restricted must have a byte-absence proof beside it. If these ever
  // diverge the audit stops, because the alternative is reporting a clean scan
  // over an identifier nothing proved absent.
  const provenPaths = new Set(exclusions.map((entry) => entry.relativeRef));
  const unproven = [...identifiers.entries()]
    .filter(([, kind]) => kind === "private-artifact-path")
    .map(([identifier]) => identifier)
    .filter((identifier) => !provenPaths.has(identifier));
  if (unproven.length > 0) {
    fail(`${wave.packageId}: ${unproven.length} private path(s) are treated as restricted but carry no byte-absence proof: ${unproven.join(", ")}`);
  }

  // --- (3) NON-REACHABILITY over every public byte -------------------------
  const publicFiles = walkFiles(join(packageRoot, "public"));
  const entryPoints = ["index.json", "release-graph.json", "assemblies.json"].map((name) => join(packageRoot, name));
  const declaredDisclosures = [];
  const declaredPrivateRootMetadata = [];
  const undeclaredReferences = [];
  const privateBytesReachable = [];
  for (const path of [...entryPoints, ...publicFiles]) {
    const relativeRef = toRelative(packageRoot, path);
    if (relativeRef.split("/").some((segment) => segment.toLowerCase() === "private")) {
      privateBytesReachable.push(relativeRef);
      continue;
    }
    let findings;
    if (relativeRef.endsWith(".json")) findings = scanArtifactForRestricted(readJson(path), identifiers);
    else findings = scanBytesForRestricted(readFileSync(path), identifiers);
    for (const finding of findings) {
      const entry = { relativeRef, ...finding };
      if (finding.classification === "declared-provenance-disclosure") declaredDisclosures.push(entry);
      else if (finding.classification === "declared-private-root-metadata") declaredPrivateRootMetadata.push(entry);
      else undeclaredReferences.push(entry);
    }
  }

  // --- Tombstones / fallbacks ---------------------------------------------
  let availableDetails = 0;
  const unavailableReasons = new Map();
  for (const cellRelease of graph.cellReleases ?? []) {
    if (cellRelease.audience !== "public") continue;
    for (const detail of cellRelease.buildingDetails ?? []) {
      if (detail.status === "available") {
        availableDetails += 1;
        continue;
      }
      const reason = typeof detail.reason === "string" && detail.reason.length > 0 ? detail.reason : "(no reason stated)";
      unavailableReasons.set(reason, (unavailableReasons.get(reason) ?? 0) + 1);
    }
  }
  const unexplainedFallbacks = unavailableReasons.has("(no reason stated)") ? unavailableReasons.get("(no reason stated)") : 0;

  return {
    waveId: wave.waveId,
    packageId: wave.packageId,
    publicRootId: wave.publicRootId,
    privateRootId: wave.privateRootId,
    approvalId: showcaseApprovalId(wave),
    approvalFingerprintSha256: showcaseApprovalFingerprint(wave),
    textureAdmission: wave.textureAdmission,
    resolution: {
      declaredArtifacts: publicRoot.artifacts.length,
      resolvedArtifacts: resolved.length,
      unresolved,
      artifactChecksumDigestSha256,
      declaredPayloadRefs: payloadRefs.length,
      unresolvedPayloadRefs: unresolvedPayload,
    },
    exclusion: {
      privateRootArtifacts: privateRoot.artifacts?.length ?? 0,
      entries: exclusions,
      byReason: exclusions.reduce((counts, entry) => ({ ...counts, [entry.reason.split(":")[0]]: (counts[entry.reason.split(":")[0]] ?? 0) + 1 }), {}),
    },
    nonReachability: {
      restrictedIdentifierCount: identifiers.size,
      scannedFiles: publicFiles.length + entryPoints.length,
      privateBytesReachable,
      declaredDisclosures,
      declaredPrivateRootMetadata,
      undeclaredReferences,
      /**
       * The compensating proof that keeps `declared-private-root-metadata` from
       * being a loophole: every private path the graph names must resolve to no
       * byte in the browser-reachable tree.
       */
      declaredPrivatePathsMaterialized: exclusions.filter((entry) => entry.reachableInPayloadTree).map((entry) => entry.relativeRef),
    },
    fallbacks: {
      availableBuildingDetails: availableDetails,
      unavailableBuildingDetails: [...unavailableReasons.values()].reduce((total, count) => total + count, 0),
      distinctReasons: [...unavailableReasons.entries()].sort((left, right) => right[1] - left[1]).map(([reason, count]) => ({ reason, count })),
      unexplainedFallbacks,
    },
    passed:
      unresolved.length === 0 &&
      unresolvedPayload.length === 0 &&
      privateBytesReachable.length === 0 &&
      undeclaredReferences.length === 0 &&
      exclusions.every((entry) => !entry.reachableInPayloadTree) &&
      unexplainedFallbacks === 0,
  };
}

/**
 * THE DECLARED SET OF WORKING-RECORD DIRECTORIES THIS AUDIT COVERS.
 *
 * This constant exists to repair a self-invalidating record, and the repair is
 * EXCLUDE-BY-DECLARED-SET rather than record-the-set-at-audit-time. The reason
 * is that only one of the two actually fixes the defect.
 *
 * The defect, measured during T024: `auditWorkingRecords` enumerated whatever
 * directories happened to exist under `data/`, so the count — and therefore the
 * record's checksum — moved the moment ANY later task committed a sibling
 * evidence directory. T024 created `data/goal-integration-acceptance-20260812/`,
 * the count went 19 → 20, and the committed record stopped reproducing. An
 * evidence record whose contents depend on the PRESENCE OF LATER EVIDENCE
 * RECORDS is self-invalidating by construction, and recording the set observed
 * at audit time would have made the drift legible without making it stop.
 *
 * So the audited scope is DECLARED here and the scan is intersected with it.
 * Two consequences, both intended:
 *
 *  1. A later task's record directory does NOT move these bytes. Re-running the
 *     audit after this task, or after the next five, reproduces it.
 *  2. Adding a directory to the audited scope is an EXPLICIT, reviewed edit to
 *     this list, not a side effect of committing a file. A directory named here
 *     that has gone missing FAILS the audit rather than silently shrinking the
 *     count, so the list cannot rot in the other direction either.
 *
 * What it deliberately does not do: report directories it was not asked to
 * audit. Counting them would reintroduce exactly the dependency this removes.
 * The scope statement in the record says so in the record's own words.
 */
export const AUDITED_WORKING_RECORD_DIRECTORIES = Object.freeze([
  "block835-canary-validation-20260811",
  "block835-promotion-20260811",
  "block835-v3-repromotion-20260811",
  "central-upper-manhattan-20260812",
  "central-upper-manhattan-20260812-p1",
  "goal-bounded-gaps-20260812",
  "goal-integration-acceptance-20260812",
  "lower-manhattan-20260812",
  "lower-manhattan-20260812-p1",
  "manhattan-esb-block-reference-20260810",
  "manhattan-esb-block-reference-20260811",
  "manhattan-esb-block-reference-20260811-v3",
  "manhattan-esb-block-reference-20260811-v3e",
  "manhattan-esb-block-reference-20260811-v3t",
  "midtown-core-20260811",
  "midtown-core-20260811-v3",
  "northern-manhattan-20260812",
  "northern-manhattan-20260812-p1",
  "public-showcase-20260812",
  "southern-remainder-20260812",
  "southern-remainder-20260812-p1",
]);

/**
 * Committed working records under `data/`. They are private in the sense that
 * matters here — never served — and the audit names them so the exclusion is
 * enumerated rather than implied by their absence from a list.
 *
 * Scoped to `AUDITED_WORKING_RECORD_DIRECTORIES`; see the note there for why.
 */
export function auditWorkingRecords(dataDir, declaredDirectories = AUDITED_WORKING_RECORD_DIRECTORIES) {
  const records = [];
  const missing = [];
  for (const directory of [...declaredDirectories].sort()) {
    const absolute = join(dataDir, directory);
    if (!existsSync(absolute)) { missing.push(directory); continue; }
    const files = walkFiles(absolute).map((path) => toRelative(dataDir, path));
    if (files.length === 0) { missing.push(directory); continue; }
    records.push({ directory, fileCount: files.length, reason: EXCLUSION_REASONS.workingEvidenceRecord });
  }
  if (missing.length > 0) {
    throw new Error(`public-showcase-audit: ${missing.length} declared working-record director${missing.length === 1 ? "y is" : "ies are"} absent or empty: ${missing.join(", ")}. The declared scope in AUDITED_WORKING_RECORD_DIRECTORIES no longer matches the tree; fix the tree or edit the declared set deliberately.`);
  }
  return records;
}

/**
 * The private reference packages that sit INSIDE the browser-reachable
 * `public/` tree and are removed from `dist/` by `prune-private-partitions.mjs`.
 * These are the only private bytes anywhere near the build output, so they are
 * enumerated explicitly rather than described.
 */
export function auditPrivateReferencePackages(publicDataDir) {
  const showcasePackages = new Set(PUBLIC_SHOWCASE_WAVES.map((wave) => wave.packageId));
  const entries = existsSync(publicDataDir) ? readdirSync(publicDataDir, { withFileTypes: true }) : [];
  const packages = [];
  for (const entry of entries) {
    const packageId = entry.name;
    if (showcasePackages.has(packageId)) continue;
    const privateRoot = join(publicDataDir, packageId, "private");
    if (!existsSync(privateRoot)) continue;
    const files = walkFiles(privateRoot).map((path) => toRelative(join(publicDataDir, packageId), path));
    packages.push({
      packageId,
      privateFileCount: files.length,
      reason: EXCLUSION_REASONS.privateReferencePackage,
      prunedFromBuildOutputBy: "scripts/prune-private-partitions.mjs",
      inShowcaseCandidate: false,
    });
  }
  return packages.sort((left, right) => (left.packageId < right.packageId ? -1 : 1));
}

export function runPublicShowcaseAudit(options = {}) {
  const publicDataDir = options.publicDataDir ?? join(repoRoot, "public", "data");
  const dataDir = options.dataDir ?? join(repoRoot, "data");
  // `waves` is a test seam. Production callers never pass it, so the committed
  // record is always the audit of the real, pinned candidate.
  const manifestWaves = options.waves ?? PUBLIC_SHOWCASE_WAVES;
  // The audited working-record scope. A test seam for the same reason `waves`
  // is one: a synthetic fixture tree carries none of this repository's evidence
  // directories, and the production caller never passes it, so the committed
  // record is always the audit of the real declared set.
  const declaredWorkingRecordDirectories = options.workingRecordDirectories ?? AUDITED_WORKING_RECORD_DIRECTORIES;

  const digest = computePublicShowcaseDigest(manifestWaves);
  if (!options.waves && digest !== PUBLIC_SHOWCASE_DIGEST_SHA256) {
    fail(`the showcase manifest digest is ${digest} but the module pins ${PUBLIC_SHOWCASE_DIGEST_SHA256}. A pin moves only with a recorded successor.`);
  }

  const waves = manifestWaves.map((wave) => auditWave(wave, { publicDataDir }));
  const privateReferencePackages = auditPrivateReferencePackages(publicDataDir);
  const workingRecords = auditWorkingRecords(dataDir, declaredWorkingRecordDirectories);

  const totals = {
    declaredArtifacts: waves.reduce((total, wave) => total + wave.resolution.declaredArtifacts, 0),
    resolvedArtifacts: waves.reduce((total, wave) => total + wave.resolution.resolvedArtifacts, 0),
    unresolvedArtifacts: waves.reduce((total, wave) => total + wave.resolution.unresolved.length, 0),
    declaredPayloadRefs: waves.reduce((total, wave) => total + wave.resolution.declaredPayloadRefs, 0),
    unresolvedPayloadRefs: waves.reduce((total, wave) => total + wave.resolution.unresolvedPayloadRefs.length, 0),
    privateRootArtifactsExcluded: waves.reduce((total, wave) => total + wave.exclusion.privateRootArtifacts, 0),
    privateReferencePackageFiles: privateReferencePackages.reduce((total, entry) => total + entry.privateFileCount, 0),
    workingRecordDirectories: workingRecords.length,
    scannedPublicFiles: waves.reduce((total, wave) => total + wave.nonReachability.scannedFiles, 0),
    declaredDisclosures: waves.reduce((total, wave) => total + wave.nonReachability.declaredDisclosures.length, 0),
    declaredPrivateRootMetadata: waves.reduce((total, wave) => total + wave.nonReachability.declaredPrivateRootMetadata.length, 0),
    declaredPrivatePathsMaterialized: waves.reduce((total, wave) => total + wave.nonReachability.declaredPrivatePathsMaterialized.length, 0),
    undeclaredPrivateReferences: waves.reduce((total, wave) => total + wave.nonReachability.undeclaredReferences.length, 0),
    privateBytesReachable: waves.reduce((total, wave) => total + wave.nonReachability.privateBytesReachable.length, 0),
    unavailableBuildingDetails: waves.reduce((total, wave) => total + wave.fallbacks.unavailableBuildingDetails, 0),
    unexplainedFallbacks: waves.reduce((total, wave) => total + wave.fallbacks.unexplainedFallbacks, 0),
  };

  return {
    schemaVersion: PUBLIC_SHOWCASE_SCHEMA_VERSION,
    auditId: `${PUBLIC_SHOWCASE_CANDIDATE_ID}:differential-audit`,
    candidateId: PUBLIC_SHOWCASE_CANDIDATE_ID,
    manifestDigestSha256: digest,
    note:
      "Private/public differential audit across every completed wave. It proves that each wave's public root resolves fully against its own declarations, that each wave's private side is named with the reason it is excluded, and that no private byte and no undeclared private identifier is reachable from the public candidate. Declared provenance disclosures — the `privatePredecessor` root id and checksum that a public root must state to be able to say what it succeeded — are enumerated individually rather than pattern-matched away; they name no fetchable byte. This audit reports on emitted bytes only. It proves nothing about rendering, about what a user sees, or about what the network requested; that is the smoke evidence.",
    assemblyPosture: PUBLIC_SHOWCASE_ASSEMBLY_POSTURE,
    standingRefusals: PUBLIC_SHOWCASE_STANDING_REFUSALS,
    waves,
    excludedPrivateReferencePackages: privateReferencePackages,
    /**
     * The audited scope, stated so a reader knows this enumeration is BOUNDED
     * and why. Without it the count below silently depended on which evidence
     * directories happened to exist when the audit ran.
     */
    workingRecordScope: {
      basis: "exclude-by-declared-set",
      declaredDirectoryCount: declaredWorkingRecordDirectories.length,
      statement: "The working-record enumeration is intersected with the declared set in scripts/public-showcase-audit-cli.mjs (AUDITED_WORKING_RECORD_DIRECTORIES). A working-record directory committed by a LATER task does not appear here and does not move these bytes, which is what makes this record reproducible after the task that emitted it; widening the scope is a deliberate edit to that constant. A declared directory that is absent or empty fails the audit rather than shrinking the count. THE STABILITY IS ON THE DIRECTORY AXIS ONLY: `fileCount` below is still counted from the tree, so ADDING A FILE to an already-declared directory does move these bytes. That is intended - a declared directory is in scope and its contents are part of what this audit reports - but it means this record is reproducible against a given tree, not permanently frozen.",
    },
    excludedWorkingRecords: workingRecords,
    totals,
    allPassed:
      waves.every((wave) => wave.passed) &&
      totals.privateBytesReachable === 0 &&
      totals.undeclaredPrivateReferences === 0 &&
      totals.declaredPrivatePathsMaterialized === 0,
  };
}

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  const outPath = resolve(argValue(argv, "--out", join(repoRoot, "data", "public-showcase-20260812", "differential-audit.json")));
  const publicDataDir = argValue(argv, "--public-data", null);
  const report = runPublicShowcaseAudit(publicDataDir ? { publicDataDir: resolve(publicDataDir) } : {});
  const text = serializeExteriorWaveArtifact(report);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text, "utf8");
  console.log(JSON.stringify({
    ok: report.allPassed,
    outPath,
    outChecksumSha256: sha256HexSync(text),
    totals: report.totals,
    waves: report.waves.map((wave) => ({ waveId: wave.waveId, passed: wave.passed, resolved: wave.resolution.resolvedArtifacts, declared: wave.resolution.declaredArtifacts, disclosures: wave.nonReachability.declaredDisclosures.length })),
  }, null, 2));
  if (!report.allPassed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
