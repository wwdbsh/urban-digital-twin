import { describe, expect, it } from "vitest";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  exteriorComponentFidelity,
  isExteriorComponentReleaseEligible,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  validateExteriorComponentInventory,
  validateExteriorInventoryEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
} from "./exterior-contract";

const HASH = "a".repeat(64);
const NOW = "2026-08-09T00:00:00.000Z";

function generatedInventory(): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId: "building:1",
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => ({
      componentId: `building:1:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: "Procedural representation; no real-world facade-detail claim.",
      generator: {
        id: "fixture-generator",
        version: "1.0.0",
        inputFingerprintSha256: HASH,
        seed: `seed:${kind}`,
        generatedAt: NOW,
        constraintSourceIds: [],
      },
    })),
  };
}

function evidenceGraph(): ExteriorEvidenceGraph {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    sources: [{
      id: "source:1",
      provider: "Fixture provider",
      datasetId: "fixture-dataset",
      sourceRecordId: "record:1",
      sourceUrl: "https://example.invalid/source",
      sourceDate: NOW,
      observedAt: NOW,
      capturedAt: NOW,
      updatedAt: NOW,
      attribution: "Synthetic test evidence.",
      licenseId: "license:1",
      approvalId: "approval:1",
    }],
    licenses: [{
      id: "license:1",
      termsUrl: "https://example.invalid/terms",
      attribution: "Synthetic test evidence.",
      retention: { mode: "permanent", expiresAt: null, conditions: "Fixture only." },
      allowedUse: {
        privateDerivative: true,
        publicDisplay: true,
        derivativeConveyance: true,
        redistribution: true,
        runtimeTexture: true,
        trainingInput: false,
        generationInput: true,
        validationOnly: false,
      },
      personalDataRestricted: false,
    }],
    approvals: [{ id: "approval:1", fingerprintSha256: HASH, scope: "fixture exterior", exclusions: ["real-world claims"], approvedAt: NOW }],
    evidence: [{ id: "evidence:1", sourceId: "source:1", basis: "source-observed", uncertainty: "Synthetic observation." }],
  };
}

function observedInventory(): ExteriorComponentInventory {
  const value = generatedInventory();
  const component = value.components[0]!;
  value.components[0] = {
    componentId: component.componentId,
    kind: component.kind,
    state: "evidence-backed",
    basis: "source-observed",
    evidenceIds: ["evidence:1"],
    uncertainty: "Synthetic observation only.",
  };
  return value;
}

describe("provider-neutral exterior inventory", () => {
  it("requires exactly one unique class-level entry for the complete vocabulary", () => {
    const inventory = generatedInventory();
    expect(validateExteriorComponentInventory(inventory).ok).toBe(true);
    expect(inventory.components).toHaveLength(15);

    expect(validateExteriorComponentInventory({ ...inventory, components: inventory.components.slice(1) }).ok).toBe(false);
    expect(validateExteriorComponentInventory({ ...inventory, components: [...inventory.components, inventory.components[0]] }).ok).toBe(false);
    expect(validateExteriorComponentInventory({ ...inventory, components: inventory.components.map((entry, index) => index === 1 ? { ...entry, componentId: inventory.components[0]!.componentId } : entry) }).ok).toBe(false);
  });

  it("keeps truth/fidelity derived from the full discriminant", () => {
    const inventory = generatedInventory();
    const generated = inventory.components[0]!;
    const absent = { componentId: generated.componentId, kind: generated.kind, state: "absent", representation: "none", reason: "No representation was produced.", uncertainty: "No claim about the real building." } as const;
    expect(validateExteriorComponentInventory({ ...inventory, components: [absent, ...inventory.components.slice(1)] }).ok).toBe(true);
    expect(exteriorComponentFidelity(absent)).toBe("no-representation");
    expect(isExteriorComponentReleaseEligible(absent)).toBe(false);

    const mutated = { ...generated, state: "evidence-backed", basis: "source-observed", evidenceIds: ["evidence:1"] };
    expect(validateExteriorComponentInventory({ ...inventory, components: [mutated, ...inventory.components.slice(1)] }).ok).toBe(false);
    const laundering = { ...generated, evidenceIds: ["evidence:1"], realWorldAccuracyClaim: "exact" };
    expect(validateExteriorComponentInventory({ ...inventory, components: [laundering, ...inventory.components.slice(1)] }).ok).toBe(false);
  });

  it("closes evidence, license, approval, dates, uncertainty, and public rights", () => {
    const inventory = generatedInventory();
    const evidenceComponent = {
      componentId: inventory.components[0]!.componentId,
      kind: inventory.components[0]!.kind,
      state: "evidence-backed" as const,
      basis: "source-observed" as const,
      evidenceIds: ["evidence:1"],
      uncertainty: "Synthetic observation only.",
    };
    const withEvidence = { ...inventory, components: [evidenceComponent, ...inventory.components.slice(1)] };
    const graph = evidenceGraph();
    expect(validateExteriorInventoryEvidence(withEvidence, graph, { audience: "public", runtimeTexture: true, evaluatedAt: NOW }).ok).toBe(true);

    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, evidence: [] }, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, licenses: [] }, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, approvals: [] }, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, sources: graph.sources.map((source) => Object.fromEntries(Object.entries(source).filter(([key]) => key !== "updatedAt"))) }, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, evidence: graph.evidence.map((entry) => ({ ...entry, uncertainty: "" })) }, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, licenses: graph.licenses.map((entry) => ({ ...entry, allowedUse: { ...entry.allowedUse, publicDisplay: false } })) }, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);
    expect(validateExteriorInventoryEvidence(withEvidence, { ...graph, licenses: graph.licenses.map((entry) => ({ ...entry, personalDataRestricted: true })) }, { audience: "public", runtimeTexture: true, evaluatedAt: NOW }).ok).toBe(false);
  });

  it("requires valid not-applicable evidence and generation-input permission", () => {
    const inventory = generatedInventory();
    const grammar = { componentId: inventory.components[0]!.componentId, kind: inventory.components[0]!.kind, state: "not-applicable", basis: "grammar", reason: "Grammar excludes it.", uncertainty: "Fixture grammar.", evidenceIds: ["evidence:1"] };
    expect(validateExteriorComponentInventory({ ...inventory, components: [grammar, ...inventory.components.slice(1)] }).ok).toBe(false);

    const constrained = structuredClone(inventory);
    const component = constrained.components[0]!;
    if (component.state !== "generated") throw new Error("fixture component must be generated");
    component.generator.constraintSourceIds = ["source:1"];
    const graph = evidenceGraph();
    graph.evidence = [];
    graph.licenses[0]!.allowedUse.generationInput = false;
    expect(validateExteriorInventoryEvidence(constrained, graph, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);

    const contradictory = evidenceGraph();
    contradictory.evidence = [];
    contradictory.licenses[0]!.allowedUse.validationOnly = true;
    expect(validateExteriorInventoryEvidence(withGeneratedConstraintSource(inventory), contradictory, { audience: "private", evaluatedAt: NOW }).ok).toBe(false);
  });

  it("evaluates canonical chronology and retention at an explicit timestamp", () => {
    const inventory = observedInventory();
    const expiring = evidenceGraph();
    expiring.licenses[0]!.retention = { mode: "expires", expiresAt: "2027-01-01T00:00:00.000Z", conditions: "Retain until expiry." };
    expect(validateExteriorInventoryEvidence(inventory, expiring, { audience: "public", evaluatedAt: NOW }).ok).toBe(true);

    const expired = structuredClone(expiring);
    expired.licenses[0]!.retention.expiresAt = "2000-01-01T00:00:00.000Z";
    const expiredResult = validateExteriorInventoryEvidence(inventory, expired, { audience: "public", evaluatedAt: NOW });
    expect(expiredResult.ok).toBe(false);
    if (expiredResult.ok) throw new Error("expired evidence must fail closed");
    expect(expiredResult.issues).toContainEqual({ path: "evidenceGraph.licenses.license:1.retention.expiresAt", message: "Source retention is expired at the evaluation timestamp." });

    for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) {
      const future = evidenceGraph();
      future.sources[0]![field] = "2027-01-01T00:00:00.000Z";
      expect(validateExteriorInventoryEvidence(inventory, future, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);
    }
    const futureApproval = evidenceGraph();
    futureApproval.approvals[0]!.approvedAt = "2027-01-01T00:00:00.000Z";
    expect(validateExteriorInventoryEvidence(inventory, futureApproval, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);

    const futureGeneration = generatedInventory();
    const generated = futureGeneration.components[0]!;
    if (generated.state !== "generated") throw new Error("fixture component must be generated");
    generated.generator.generatedAt = "2027-01-01T00:00:00.000Z";
    expect(validateExteriorInventoryEvidence(futureGeneration, { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, sources: [], licenses: [], approvals: [], evidence: [] }, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);
  });

  it("rejects noncanonical timestamps and contradictory retention declarations", () => {
    const inventory = observedInventory();
    for (const malformed of ["0", "2026-02-30T00:00:00.000Z", "2026-08-09T00:00:00Z"]) {
      const graph = evidenceGraph();
      graph.sources[0]!.observedAt = malformed;
      expect(validateExteriorInventoryEvidence(inventory, graph, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);
    }
    expect(validateExteriorInventoryEvidence(inventory, evidenceGraph(), { audience: "public", evaluatedAt: "0" }).ok).toBe(false);

    const permanentWithExpiry = evidenceGraph();
    permanentWithExpiry.licenses[0]!.retention.expiresAt = "2027-01-01T00:00:00.000Z";
    expect(validateExteriorInventoryEvidence(inventory, permanentWithExpiry, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);

    const expiryWithoutDate = evidenceGraph();
    expiryWithoutDate.licenses[0]!.retention = { mode: "expires", expiresAt: null, conditions: "Missing expiry." };
    expect(validateExteriorInventoryEvidence(inventory, expiryWithoutDate, { audience: "public", evaluatedAt: NOW }).ok).toBe(false);
  });
});

function withGeneratedConstraintSource(value: ExteriorComponentInventory): ExteriorComponentInventory {
  const copy = structuredClone(value);
  const component = copy.components[0]!;
  if (component.state !== "generated") throw new Error("fixture component must be generated");
  component.generator.constraintSourceIds = ["source:1"];
  return copy;
}
