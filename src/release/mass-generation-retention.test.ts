import { describe, expect, it } from "vitest";

import { V3_EXTENDED_GRAMMAR_OPTIONS, V3_ROOFTOP_HONESTY_OPTIONS } from "../domain/deterministic-facade-generator-v3.ts";
import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { MIDTOWN_CORE_V3_WAVE_PROFILE, V3_FROZEN_WAVE_ADMISSION_ENVELOPE } from "./midtown-core-v3-materialization.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER } from "./procedural-texture.ts";
import {
  MASS_GENERATION_ADMISSION_ENVELOPE,
  RETENTION_STATEMENT,
  massGenerationSuccessorProfile,
  retentionCellManifestRef,
  retentionRootChecksum,
  retentionTextureAdmissionPolicy,
  validateRetentionReleaseRoot,
  type RetentionReleaseRoot,
} from "./mass-generation-retention.ts";

const ADMISSION = {
  policy: "procedural-replay" as const,
  generatedTextureFact: {
    basis: "generated-texture" as const,
    profile: PROCEDURAL_TEXTURE_PROFILE,
    gate: "rasterizer-replay" as const,
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Generated, pattern-only detail tiles.",
  },
};

const CELL_ID = "manhattan-exterior-cell-w01-000001-14-19300-17921";

function draft(overrides: Partial<RetentionReleaseRoot> = {}): RetentionReleaseRoot {
  const base = {
    schemaVersion: "1.0" as const,
    rootId: "root:test-release-c1:retention",
    releaseId: "test-release-c1",
    predecessorReleaseId: "test-release",
    waveId: "w01",
    cityId: "city:manhattan",
    configId: "config:manhattan-exterior",
    generatedAt: "2026-08-11T00:00:00.000Z",
    immutable: true as const,
    textureAdmission: ADMISSION,
    baseIdentitySet: { id: "base:set", checksumSha256: "a".repeat(64) },
    ownershipLedger: { id: "ledger:test", checksumSha256: "b".repeat(64) },
    cellManifests: [{ cellId: CELL_ID, relativeRef: retentionCellManifestRef(CELL_ID), byteSize: 1024, checksumSha256: "c".repeat(64) }],
    retention: RETENTION_STATEMENT,
    ...overrides,
  };
  return { ...base, rootChecksumSha256: retentionRootChecksum(base) } as RetentionReleaseRoot;
}

describe("massGenerationSuccessorProfile", () => {
  it("overrides exactly the retention decision and inherits the rest by spread", () => {
    const successor = massGenerationSuccessorProfile(MIDTOWN_CORE_V3_WAVE_PROFILE);

    expect(successor.releaseId).toBe(`${MIDTOWN_CORE_V3_WAVE_PROFILE.releaseId}-c1`);
    expect(successor.admissionEnvelope).toEqual({ ...V3_EXTENDED_GRAMMAR_OPTIONS, ...V3_ROOFTOP_HONESTY_OPTIONS });
    expect(successor.lod1Policy).toBe("measured-fallback");
    expect(successor.budgets).toEqual({ ...V3T_QUALITY_BUDGETS });
    expect(successor.texture).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(successor.textureFilter).toEqual({ ...PROCEDURAL_TEXTURE_SAMPLER_FILTER });
    expect(successor.textureDelivery).toBe("shared-uri");

    // Generator identity arrives by spread; a successor cannot quietly become a
    // different generator than the wave it descends from.
    expect(successor.seed).toBe(MIDTOWN_CORE_V3_WAVE_PROFILE.seed);
    expect(successor.tool).toEqual(MIDTOWN_CORE_V3_WAVE_PROFILE.tool);
    expect(successor.generatedAt).toBe(MIDTOWN_CORE_V3_WAVE_PROFILE.generatedAt);
  });

  it("leaves the frozen wave profile itself untouched", () => {
    massGenerationSuccessorProfile(MIDTOWN_CORE_V3_WAVE_PROFILE);
    expect(MIDTOWN_CORE_V3_WAVE_PROFILE.admissionEnvelope).toEqual(V3_FROZEN_WAVE_ADMISSION_ENVELOPE);
    expect(MIDTOWN_CORE_V3_WAVE_PROFILE.lod1Policy).toBeUndefined();
    expect(MIDTOWN_CORE_V3_WAVE_PROFILE.releaseId.endsWith("-c1")).toBe(false);
  });

  it("refuses to compound the successor suffix", () => {
    const once = massGenerationSuccessorProfile(MIDTOWN_CORE_V3_WAVE_PROFILE);
    expect(() => massGenerationSuccessorProfile(once)).toThrow(/already a retention successor/u);
  });

  it("selects the envelope ADR 0048 withheld for a successor, and nothing wider", () => {
    expect(MASS_GENERATION_ADMISSION_ENVELOPE).toEqual({ ...V3_EXTENDED_GRAMMAR_OPTIONS, ...V3_ROOFTOP_HONESTY_OPTIONS });
  });
});

describe("the retention root pin", () => {
  it("accepts a well-formed root and reads its declared policy", () => {
    const root = draft();
    const result = validateRetentionReleaseRoot(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(retentionTextureAdmissionPolicy(result.value)).toBe("procedural-replay");
  });

  it("MOVES when the admission policy is edited, so a policy cannot be forged after the fact", () => {
    const honest = draft();
    const forged = { ...honest, textureAdmission: { ...ADMISSION, policy: "texture-free" as const } };
    // The pin is over the identity AND the admission, so the edited root no
    // longer matches its own checksum and is refused before any policy is read.
    expect(retentionRootChecksum(forged)).not.toBe(honest.rootChecksumSha256);
    const result = validateRetentionReleaseRoot(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/self-pin disagrees/u);
  });

  it("does NOT cover the cell-manifest list, because a manifest cites the pin", () => {
    const root = draft();
    // Appending a manifest entry cannot move the pin — that is the documented
    // cost of breaking the circularity, and the entry's own checksum plus the
    // manifest's cross-citation are what cover it instead.
    const extended = { ...root, cellManifests: [...root.cellManifests, { cellId: "manhattan-exterior-cell-w01-000002-14-19300-17922", relativeRef: retentionCellManifestRef("manhattan-exterior-cell-w01-000002-14-19300-17922"), byteSize: 2048, checksumSha256: "d".repeat(64) }] };
    expect(retentionRootChecksum(extended)).toBe(root.rootChecksumSha256);
    expect(validateRetentionReleaseRoot(extended).ok).toBe(true);
  });

  it("is fail-closed on an absent or unrecognised admission declaration", () => {
    const unknown = draft({ textureAdmission: { policy: "not-a-policy" } as never });
    const result = validateRetentionReleaseRoot(unknown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Structurally acceptable, but the policy reader refuses to invent an
    // admission it does not recognise.
    expect(retentionTextureAdmissionPolicy(result.value)).toBe("texture-free");
  });

  it("refuses a manifest ref that does not derive from its own cell id", () => {
    const root = draft();
    const tampered = { ...root, cellManifests: [{ ...root.cellManifests[0]!, relativeRef: "public/assemblies/some-other-cell.json" }] };
    const result = validateRetentionReleaseRoot(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/does not match the ref its own cellId derives/u);
  });

  it("refuses a duplicated cell and a duplicated manifest ref", () => {
    const root = draft();
    const duplicated = { ...root, cellManifests: [root.cellManifests[0]!, root.cellManifests[0]!] };
    const result = validateRetentionReleaseRoot(duplicated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/declared twice/u);
  });

  it("refuses a root that is not marked immutable", () => {
    const root = draft();
    const mutable = { ...root, immutable: false };
    expect(validateRetentionReleaseRoot(mutable).ok).toBe(false);
  });

  it("refuses an empty cell-manifest list", () => {
    const root = draft();
    const empty = { ...root, cellManifests: [] };
    const result = validateRetentionReleaseRoot(empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/non-empty array/u);
  });
});
