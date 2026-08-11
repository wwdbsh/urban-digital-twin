import { describe, expect, it } from "vitest";

import {
  validateExteriorEvidenceIntakeLedgerStructure,
  validateExteriorEvidenceIntakeLedger,
} from "../domain/exterior-evidence-intake.ts";
import {
  BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT,
  BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER,
  BLOCK835_FACADE_MATERIAL_LICENSE,
  BLOCK835_V3_STYLE_OVERRIDES,
  ESB_FACADE_MATERIAL_RECORD_ID,
  block835CitedStyleFor,
  block835FacadeMaterialAdmission,
  block835FacadeMaterialAudit,
} from "./block835-facade-material-intake.ts";

describe("Block 835 facade-material evidence intake", () => {
  it("is structurally valid and admits exactly the one record", () => {
    const structural = validateExteriorEvidenceIntakeLedgerStructure(BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER);
    expect(structural.ok ? [] : structural.issues).toEqual([]);
    const admission = block835FacadeMaterialAdmission();
    expect(admission.rejected).toEqual([]);
    expect(admission.admitted.map((entry) => entry.recordId)).toEqual([ESB_FACADE_MATERIAL_RECORD_ID]);
    expect(admission.admitted[0]!.classification).toBe("compatible-licensed");
  });

  it("keeps the texture exclusion — the fact may drive a style class, never a texture", () => {
    const admitted = block835FacadeMaterialAdmission().admitted[0]!;
    // The load-bearing restriction. `derivativeScope: "measurement-only"` is what
    // produces it, and it must survive every future edit to this ledger.
    expect(admitted.restrictionCodes).toContain("derivative-scope-excludes-texture");
    expect(admitted.restrictionCodes).toContain("runtime-texture-not-permitted");
    expect(admitted.runtimeTextureEligible).toBe(false);
    expect(admitted.exclusionTokens).toContain("runtime-texture");
    expect(admitted.exclusionTokens).toContain("training-input");
    expect(BLOCK835_FACADE_MATERIAL_LICENSE.allowedUse.runtimeTexture).toBe(false);
    expect(BLOCK835_FACADE_MATERIAL_LICENSE.allowedUse.trainingInput).toBe(false);
    expect(BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER.records[0]!.derivativeScope).toBe("measurement-only");
  });

  it("is publicly conveyable, privacy-reviewed, and about exactly one component", () => {
    const admitted = block835FacadeMaterialAdmission().admitted[0]!;
    expect(admitted.publicEligible).toBe(true);
    expect(admitted.restrictionCodes).not.toContain("privacy-review-incomplete");
    expect(admitted.restrictionCodes).not.toContain("personal-data-restricted");
    const record = admitted.record;
    expect(record.privacyReview.status).toBe("reviewed-no-identifiers");
    expect(record.privacyReview.identifiersFound).toEqual([]);
    expect(record.privacyReview.redactions).toEqual([]);
    expect(record.provider).toBe("wikipedia");
    expect(record.sourceUrl).toBe("https://en.wikipedia.org/wiki/Empire_State_Building");
    // A facade-material fact bears on the materials component and no other.
    expect(record.componentIds).toEqual(["doitt:778052:materials"]);
  });

  it("binds the attestation to the cited approval, so a relabelled record is refused", () => {
    const admitted = block835FacadeMaterialAdmission().admitted[0]!;
    const approval = BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER.approvals[0]!;
    expect(admitted.record.attestation.fingerprintSha256).toBe(approval.fingerprintSha256);
    const tampered = {
      ...BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER,
      records: [{
        ...BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER.records[0]!,
        attestation: { ...BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER.records[0]!.attestation, fingerprintSha256: "0".repeat(64) },
      }],
    };
    const result = validateExteriorEvidenceIntakeLedger(tampered, { evaluatedAt: BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.admitted).toEqual([]);
      expect(result.value.rejected[0]!.reasonCodes).toContain("attestation-fingerprint-unbound");
    }
  });

  it("carries only counts and closed codes on the public audit surface", () => {
    const audit = block835FacadeMaterialAudit();
    expect(audit.public.counts).toEqual({ submitted: 1, admitted: 1, rejected: 0, publicEligible: 1, runtimeTextureEligible: 0 });
    expect(audit.public.admittedPublicRecordIds).toEqual([ESB_FACADE_MATERIAL_RECORD_ID]);
    // No operator prose, no attester, no reviewer, no path on the public surface.
    const serialized = JSON.stringify(audit.public);
    expect(serialized).not.toContain("operator");
    expect(serialized).not.toContain("artifacts/");
  });
});

describe("Block 835 style overrides", () => {
  it("is hand-listed, covers exactly the Empire State Building, and cites an admitted record", () => {
    expect([...BLOCK835_V3_STYLE_OVERRIDES.keys()]).toEqual(["doitt:778052"]);
    const override = BLOCK835_V3_STYLE_OVERRIDES.get("doitt:778052")!;
    expect(override.styleClass).toBe("stone-neutral");
    expect(override.evidenceRecordId).toBe(ESB_FACADE_MATERIAL_RECORD_ID);
    expect(override.fact).toContain("Indiana limestone");
    // The citation resolves against the ADMISSION, not the raw ledger, so an
    // override can never cite a record that was rejected or restricted.
    const cited = block835CitedStyleFor("doitt:778052")!;
    expect(cited.provider).toBe("wikipedia");
    expect(cited.attribution).toContain("CC BY-SA");
    expect(cited.fact).toBe(override.fact);
    expect(cited.styleClass).toBe(override.styleClass);
  });

  it("resolves to nothing for the thirteen buildings that keep the designed draw", () => {
    for (const buildingId of ["doitt:102705", "doitt:131170", "doitt:982383", "doitt:925937"]) {
      expect(block835CitedStyleFor(buildingId)).toBeUndefined();
    }
  });
});
