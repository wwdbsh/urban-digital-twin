import { describe, expect, it } from "vitest";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  validateExteriorInventoryEvidence,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
  type ExteriorLicenseEvidence,
} from "../domain/exterior-contract.ts";
import {
  EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
  buildExteriorEvidenceIntakeAudit,
  projectAdmittedExteriorEvidence,
  validateExteriorEvidenceIntakeLedger,
  validateProjectedGraphAudience,
  verifyExteriorEvidenceProjectionIntegrity,
  type ExteriorEvidenceIntakeLedger,
  type ExteriorEvidenceIntakeRecord,
} from "../domain/exterior-evidence-intake.ts";
import { sha256HexSync, stableSerialize } from "./catalog-release.ts";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  validateExteriorReleaseGraph,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorReleaseGraph,
} from "./exterior-release.ts";

const NOW = "2026-08-09T00:00:00.000Z";
const FINGERPRINT = "a".repeat(64);
const ATTESTER = "Operator Alice Owner";
const STATEMENT = "I own these photographs and grant derivative and public-display rights.";
const REVIEWER = "Operator Bob Reviewer";
const REDACTED_REF = "private/intake/b2-front-redacted.png";

const OPEN_USE = {
  privateDerivative: true, publicDisplay: true, derivativeConveyance: true, redistribution: true,
  runtimeTexture: true, trainingInput: false, generationInput: false, validationOnly: false,
} as const;

function license(id: string, overrides: Partial<ExteriorLicenseEvidence> = {}): ExteriorLicenseEvidence {
  return {
    id,
    termsUrl: "https://example.invalid/owner-release",
    attribution: "Synthetic owner-supplied fixture.",
    retention: { mode: "permanent", expiresAt: null, conditions: "Retained until consent is withdrawn." },
    allowedUse: { ...OPEN_USE },
    personalDataRestricted: false,
    ...overrides,
  };
}

function approval(id: string, exclusions: string[] = []): ExteriorApprovalEvidence {
  return { id, fingerprintSha256: FINGERPRINT, scope: "Synthetic owner-supplied exterior evidence.", exclusions, approvedAt: NOW };
}

function intakeRecord(recordId: string, overrides: Partial<ExteriorEvidenceIntakeRecord> = {}): ExteriorEvidenceIntakeRecord {
  return {
    recordId,
    classification: "user-owned",
    buildingId: "b2",
    componentIds: ["b2:windows"],
    provider: "Operator supplied",
    datasetId: "operator-photo-set",
    sourceRecordId: recordId,
    sourceUrl: `https://example.invalid/owner/${recordId}`,
    attribution: "Photograph by the operator.",
    uncertainty: "Single-elevation photograph; no measured survey.",
    sourceDate: NOW,
    observedAt: NOW,
    capturedAt: NOW,
    updatedAt: NOW,
    licenseId: "license:open",
    approvalId: "approval:open",
    retention: { mode: "permanent", expiresAt: null, conditions: "Retained with the owner release." },
    derivativeScope: "geometry-derivative",
    attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: FINGERPRINT, exclusions: [] },
    privacyReview: { status: "reviewed-no-identifiers", identifiersFound: [], redactions: [], reviewer: REVIEWER, reviewedAt: NOW },
    ...overrides,
  };
}

/** Mixed synthetic intake ledger: admitted, restricted and rejected origins. */
function intakeLedger(): ExteriorEvidenceIntakeLedger {
  return {
    schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
    ledgerId: "intake:partition-fixture",
    licenses: [
      license("license:open"),
      license("license:no-redistribution", { allowedUse: { ...OPEN_USE, redistribution: false } }),
    ],
    approvals: [approval("approval:open"), approval("approval:display-excluded", ["public-display"])],
    records: [
      intakeRecord("record:owned-public", { componentIds: ["b2:windows", "b2:storefronts"] }),
      intakeRecord("record:public-domain", { classification: "public-domain", componentIds: ["b2:cornices"] }),
      intakeRecord("record:redacted-faces", {
        classification: "compatible-licensed",
        componentIds: ["b2:materials"],
        privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [{ identifier: "faces", method: "blurred", redactedArtifactRef: REDACTED_REF, note: "Face blurred before ingest." }], reviewer: REVIEWER, reviewedAt: NOW },
      }),
      intakeRecord("record:license-private-only", { componentIds: ["b2:signage"], licenseId: "license:no-redistribution" }),
      intakeRecord("record:exclusion-locked", { classification: "explicitly-permitted", componentIds: ["b2:balconies"], approvalId: "approval:display-excluded" }),
      intakeRecord("record:unredacted-faces", {
        componentIds: ["b2:entrances"],
        privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces", "plates"], redactions: [], reviewer: REVIEWER, reviewedAt: NOW },
      }),
      intakeRecord("record:google-maps", { classification: "google-maps", componentIds: ["b2:setbacks"] }),
      intakeRecord("record:street-view", { classification: "street-view", componentIds: ["b2:roof-form"] }),
      intakeRecord("record:unlicensed-web-photo", { classification: "unlicensed-web-photo", componentIds: ["b2:fire-escapes"] }),
      intakeRecord("record:platform-restricted", { classification: "platform-restricted", componentIds: ["b2:water-tanks"] }),
      intakeRecord("record:missing-rights", { componentIds: ["b2:massing"], licenseId: "license:absent" }),
    ],
  };
}

const REJECTED_RECORD_IDS = [
  "record:google-maps", "record:street-view", "record:unlicensed-web-photo", "record:platform-restricted", "record:missing-rights",
] as const;
const PRIVATE_ONLY_RECORD_IDS = ["record:license-private-only", "record:exclusion-locked", "record:unredacted-faces"] as const;

function admission() {
  const result = validateExteriorEvidenceIntakeLedger(intakeLedger(), { evaluatedAt: NOW });
  if (!result.ok) throw new Error(`fixture ledger must be structurally valid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function inventoryFor(buildingId: string, componentEvidenceIds: Record<string, string[]>): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => {
      const componentId = `${buildingId}:${kind}`;
      const evidenceIds = componentEvidenceIds[componentId];
      if (evidenceIds && evidenceIds.length > 0) {
        return { componentId, kind, state: "evidence-backed" as const, basis: "source-observed" as const, evidenceIds, uncertainty: "Observed from admitted intake evidence." };
      }
      return {
        componentId, kind, state: "generated" as const, uncertainty: "Procedural fixture; no real-world claim.",
        generator: { id: "fixture", version: "1", inputFingerprintSha256: FINGERPRINT, seed: componentId, generatedAt: NOW, constraintSourceIds: [] },
      };
    }),
  };
}

const emptyGraph: ExteriorEvidenceGraph = { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, sources: [], licenses: [], approvals: [], evidence: [] };

/**
 * Composes the intake projection with the accepted exterior release graph.
 * Mirrors the T002 release fixture shape without changing that test module.
 */
function releaseFixture(publicEvidence: ExteriorEvidenceGraph, publicInventory: ExteriorComponentInventory): ExteriorReleaseGraph {
  const makeArtifact = (audience: "private" | "public", kind: ExteriorArtifactKind, logicalId: string): ExteriorArtifactRef => {
    const relativeRef = `${audience}/${kind}/${logicalId.replaceAll(":", "-")}.json`;
    const content = stableSerialize({ audience, kind, logicalId });
    return { logicalId, kind, relativeRef, byteSize: new TextEncoder().encode(content).byteLength, checksumSha256: sha256HexSync(content) };
  };
  const privateArtifacts = [makeArtifact("private", "ownership-ledger", "ledger:city")];
  const publicArtifacts = [
    makeArtifact("public", "ownership-ledger", "ledger:city"),
    makeArtifact("public", "cell-release", "cell:c1:v1"),
    makeArtifact("public", "cell-release", "cell:c2:v1"),
    makeArtifact("public", "inventory", "inventory:b1"),
    makeArtifact("public", "inventory", "inventory:b2"),
    makeArtifact("public", "evidence", "evidence:b1"),
    makeArtifact("public", "evidence", "evidence:b2"),
    makeArtifact("public", "rollout-snapshot", "snapshot:v1"),
  ];
  const artifact = (id: string, kind: ExteriorArtifactKind) => publicArtifacts.find((entry) => entry.logicalId === id && entry.kind === kind)!;
  const c1Bounds = { west: -74.1, south: 40.6, east: -73.95, north: 40.9 };
  const c2Bounds = { west: -73.95, south: 40.6, east: -73.8, north: 40.9 };
  const baseChecksum = sha256HexSync(stableSerialize(["b1", "b2"]));
  const promotion = approval("approval:promotion");
  const cell = (cellId: string, bounds: typeof c1Bounds, buildingId: string) => ({
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    cellReleaseId: `cell:${cellId}:v1`, version: "v1", audience: "public" as const, artifactRef: artifact(`cell:${cellId}:v1`, "cell-release").relativeRef,
    cityId: "city:fixture", configId: "config:fixture", cellId, bounds, ownershipLedgerId: "ledger:city",
    baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
    buildingIds: [buildingId], predecessor: null, promotion,
    fallback: { mode: "pinned-base" as const, baseIdentitySetId: "identity:base:v1", checksumSha256: baseChecksum },
    buildingDetails: [{ buildingId, status: "available" as const, inventoryId: `inventory:${buildingId}`, evidenceShardId: `evidence:${buildingId}`, runtimeTexture: false }],
    immutable: true as const,
  });
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, audience: "private", rootId: "root:private:v1", rootChecksumSha256: "b".repeat(64),
      releaseId: "release:private:v1", cityId: "city:fixture", configId: "config:fixture", generatedAt: NOW, immutable: true,
      artifactAllowlist: privateArtifacts.map((entry) => entry.relativeRef), artifacts: privateArtifacts,
      approval: approval("approval:root"), predecessor: null, privatePredecessor: null,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, audience: "public", rootId: "root:public:v1", rootChecksumSha256: "c".repeat(64),
      releaseId: "release:public:v1", cityId: "city:fixture", configId: "config:fixture", generatedAt: NOW, immutable: true,
      artifactAllowlist: publicArtifacts.map((entry) => entry.relativeRef), artifacts: publicArtifacts,
      approval: approval("approval:root"), predecessor: null,
      privatePredecessor: { rootId: "root:private:v1", rootChecksumSha256: "b".repeat(64) },
    }],
    ownershipLedger: {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, ledgerId: "ledger:city", cityId: "city:fixture", configId: "config:fixture", immutable: true,
      baseIdentitySet: { id: "identity:base:v1", checksumSha256: baseChecksum, buildingCount: 2 },
      coverage: { west: -74.1, south: 40.6, east: -73.8, north: 40.9 },
      cells: [
        { cellId: "c1", order: 0, bounds: c1Bounds, buildingIds: ["b1"], membershipChecksumSha256: sha256HexSync(stableSerialize(["b1"])) },
        { cellId: "c2", order: 1, bounds: c2Bounds, buildingIds: ["b2"], membershipChecksumSha256: sha256HexSync(stableSerialize(["b2"])) },
      ],
    },
    cellReleases: [cell("c1", c1Bounds, "b1"), cell("c2", c2Bounds, "b2")],
    inventoryShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "inventory:b1", audience: "public", artifactRef: artifact("inventory:b1", "inventory").relativeRef, inventoryId: "inventory:b1", inventory: inventoryFor("b1", {}) },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "inventory:b2", audience: "public", artifactRef: artifact("inventory:b2", "inventory").relativeRef, inventoryId: "inventory:b2", inventory: publicInventory },
    ],
    evidenceShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "evidence:b1", audience: "public", artifactRef: artifact("evidence:b1", "evidence").relativeRef, inventoryId: "inventory:b1", graph: emptyGraph },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "evidence:b2", audience: "public", artifactRef: artifact("evidence:b2", "evidence").relativeRef, inventoryId: "inventory:b2", graph: publicEvidence },
    ],
    snapshots: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, snapshotId: "snapshot:v1", audience: "public", artifactRef: artifact("snapshot:v1", "rollout-snapshot").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      predecessor: null, rollbackTarget: null,
      cells: [
        { cellId: "c1", cellReleaseId: "cell:c1:v1", checksumSha256: artifact("cell:c1:v1", "cell-release").checksumSha256 },
        { cellId: "c2", cellReleaseId: "cell:c2:v1", checksumSha256: artifact("cell:c2:v1", "cell-release").checksumSha256 },
      ],
      promotion, generatedAt: NOW, immutable: true,
    }],
  };
}

function publicBaseline(): { graph: ExteriorReleaseGraph; publicEvidence: ExteriorEvidenceGraph } {
  const projection = projectAdmittedExteriorEvidence(admission(), { audience: "public", buildingId: "b2" });
  return { graph: releaseFixture(projection.graph, inventoryFor("b2", projection.componentEvidenceIds)), publicEvidence: projection.graph };
}

describe("private/public evidence partition replay", () => {
  it("rejects disallowed origins and missing rights evidence before any projection", () => {
    const admitted = admission();
    expect(admitted.rejected.map((entry) => entry.recordId).sort()).toEqual([...REJECTED_RECORD_IDS].sort());
    expect(admitted.rejected.find((entry) => entry.recordId === "record:missing-rights")?.reasonCodes).toContain("license-linkage-unresolved");
    for (const disallowed of ["record:google-maps", "record:street-view", "record:unlicensed-web-photo", "record:platform-restricted"]) {
      expect(admitted.rejected.find((entry) => entry.recordId === disallowed)?.reasonCodes).toContain("classification-disallowed");
    }
  });

  it("never projects rejected or restricted records into a public evidence graph", () => {
    const serialized = JSON.stringify(publicBaseline().publicEvidence);
    for (const excluded of [...REJECTED_RECORD_IDS, ...PRIVATE_ONLY_RECORD_IDS]) expect(serialized).not.toContain(excluded);
    for (const admittedPublic of ["record:owned-public", "record:public-domain", "record:redacted-faces"]) expect(serialized).toContain(admittedPublic);
  });

  it("composes the admitted public projection into a valid immutable release graph", () => {
    const { graph } = publicBaseline();
    const result = validateExteriorReleaseGraph(graph);
    if (!result.ok) throw new Error(`baseline must validate: ${JSON.stringify(result.issues)}`);
    expect(result.ok).toBe(true);
    const projection = projectAdmittedExteriorEvidence(admission(), { audience: "public", buildingId: "b2" });
    expect(verifyExteriorEvidenceProjectionIntegrity(projection, admission().ledgerChecksumSha256).ok).toBe(true);
    expect(validateProjectedGraphAudience(projection.graph, { audience: "public" }).ok).toBe(true);
  });

  it("fails closed when a public manifest is mutated to resolve private roots or restricted derivatives", () => {
    const privateProjection = projectAdmittedExteriorEvidence(admission(), { audience: "private", buildingId: "b2" });
    for (const mutate of [
      // Public artifact rewritten to a private path.
      (graph: ExteriorReleaseGraph) => {
        const evidenceArtifact = graph.roots[1]!.artifacts.find((entry) => entry.kind === "evidence")!;
        evidenceArtifact.relativeRef = "private/evidence/leak.json";
        graph.roots[1]!.artifactAllowlist = graph.roots[1]!.artifacts.map((entry) => entry.relativeRef);
      },
      // Public evidence shard reparented onto the private-only projection.
      (graph: ExteriorReleaseGraph) => {
        graph.evidenceShards[1]!.graph = privateProjection.graph;
        graph.inventoryShards[1]!.inventory = inventoryFor("b2", privateProjection.componentEvidenceIds);
      },
      // Public evidence shard pointed at the private root's audience.
      (graph: ExteriorReleaseGraph) => { graph.evidenceShards[1]!.audience = "private"; },
    ]) {
      const { graph } = publicBaseline();
      mutate(graph);
      expect(validateExteriorReleaseGraph(graph).ok).toBe(false);
    }
  });

  it("blocks a private projection re-presented as public, which phase B alone accepts", () => {
    // The reviewer's probe, verbatim: one record restricted solely by an
    // approval exclusion token, one with unredacted faces.
    const probeLedger: ExteriorEvidenceIntakeLedger = {
      schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
      ledgerId: "intake:reviewer-probe",
      licenses: [license("license:open")],
      approvals: [approval("approval:open"), approval("approval:display-excluded", ["public-display"])],
      records: [
        intakeRecord("record:exclusion-only", { componentIds: ["b2:windows"], approvalId: "approval:display-excluded", derivativeScope: "geometry-and-texture" }),
        intakeRecord("record:unredacted-faces", {
          componentIds: ["b2:storefronts"], derivativeScope: "geometry-and-texture",
          privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [], reviewer: REVIEWER, reviewedAt: NOW },
        }),
      ],
    };
    const probe = validateExteriorEvidenceIntakeLedger(probeLedger, { evaluatedAt: NOW });
    if (!probe.ok) throw new Error("probe ledger must be structurally valid");
    const privateProjection = projectAdmittedExteriorEvidence(probe.value, { audience: "private" });
    const reserialized = JSON.parse(JSON.stringify(privateProjection.graph)) as ExteriorEvidenceGraph;
    expect(reserialized.sources).toHaveLength(2);

    // Phase B has no notion of exclusion tokens or privacy verdicts: it accepts.
    const phaseB = validateExteriorInventoryEvidence(
      inventoryFor("b2", privateProjection.componentEvidenceIds),
      reserialized,
      { audience: "public", runtimeTexture: true, evaluatedAt: NOW },
    );
    expect(phaseB.ok).toBe(true);

    // The graph-level audience guard is what closes it.
    expect(validateProjectedGraphAudience(reserialized, { audience: "public", runtimeTexture: true }).ok).toBe(false);
    expect(validateProjectedGraphAudience(reserialized, { audience: "public" }).ok).toBe(false);
    expect(validateProjectedGraphAudience(reserialized, { audience: "private", runtimeTexture: true }).ok).toBe(false);
    expect(validateProjectedGraphAudience(reserialized, { audience: "private" }).ok).toBe(true);

    // Relabelling the private projection as public also breaks the fingerprint chain.
    expect(verifyExteriorEvidenceProjectionIntegrity({ ...privateProjection, audience: "public" }, probe.value.ledgerChecksumSha256).ok).toBe(false);
  });

  it("detects a fully wired smuggled source through the intake binding closure", () => {
    const admitted = admission();
    const projection = projectAdmittedExteriorEvidence(admitted, { audience: "public", buildingId: "b2" });
    const smuggled = JSON.parse(JSON.stringify(projection.graph)) as ExteriorEvidenceGraph;
    smuggled.sources.push({
      id: "source:record:google-maps", provider: "Google Maps", datasetId: "street-view", sourceRecordId: "b2",
      sourceUrl: "https://example.invalid/streetview", sourceDate: NOW, observedAt: NOW, capturedAt: NOW, updatedAt: NOW,
      attribution: "Not cleared.", licenseId: "license:open", approvalId: "approval:record:owned-public",
    });
    smuggled.evidence.push({ id: "claim:smuggled", sourceId: "source:record:google-maps", basis: "source-observed", uncertainty: "Smuggled." });
    const componentEvidenceIds = { ...projection.componentEvidenceIds, "b2:roof-form": ["claim:smuggled"] };

    // Wired into a component, phase B and the audience guard both accept it:
    // source classification is a phase A concept and is not re-derivable here.
    expect(validateExteriorInventoryEvidence(inventoryFor("b2", componentEvidenceIds), smuggled, { audience: "public", evaluatedAt: NOW }).ok).toBe(true);
    expect(validateProjectedGraphAudience(smuggled, { audience: "public" }).ok).toBe(true);

    // The intake binding closure is the mechanism that detects it.
    const integrity = verifyExteriorEvidenceProjectionIntegrity({ ...projection, graph: smuggled }, admitted.ledgerChecksumSha256);
    expect(integrity.ok).toBe(false);
    if (integrity.ok) throw new Error("smuggled source must break intake binding closure");
    expect(integrity.issues.map((entry) => entry.path)).toContain("sources.source:record:google-maps");
  });

  it("keeps the public audit surface free of private references, paths and operator free text", () => {
    const audit = buildExteriorEvidenceIntakeAudit(admission());
    const serialized = JSON.stringify(audit.public);
    for (const secret of [ATTESTER, STATEMENT, REVIEWER, REDACTED_REF, "private/", "https://example.invalid", "Google Maps", ...REJECTED_RECORD_IDS, ...PRIVATE_ONLY_RECORD_IDS]) {
      expect(serialized).not.toContain(secret);
    }
    expect(audit.public.admittedPublicRecordIds).toEqual(["record:owned-public", "record:public-domain", "record:redacted-faces"]);
    expect(audit.public.counts.rejected).toBe(REJECTED_RECORD_IDS.length);
  });
});
