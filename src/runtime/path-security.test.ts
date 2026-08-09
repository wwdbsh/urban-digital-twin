import { describe, expect, it } from "vitest";
import {
  isSafeLocalReleaseReference,
  isSafeReleaseArtifactReference,
  normalizeLocalReleaseReference,
} from "./path-security";

describe("release path security", () => {
  it("preserves the legacy local-reference behavior", () => {
    expect(normalizeLocalReleaseReference("cells/a b.json")).toBe("cells/a b.json");
    expect(isSafeLocalReleaseReference("cells/a%20b.json")).toBe(true);
    expect(isSafeLocalReleaseReference("../escape.json")).toBe(false);
  });

  it("accepts only canonical allowlisted artifact path characters", () => {
    expect(isSafeReleaseArtifactReference("public/cells/cell-01.v2.json")).toBe(true);
    expect(isSafeReleaseArtifactReference("private/evidence/source_01.json")).toBe(true);
    for (const unsafe of [
      "%2e%2e/private.json",
      "public/%2f/private.json",
      "public/%5cprivate.json",
      "public/cell.json?download=1",
      "public/cell.json#fragment",
      "public/control\u0000.json",
      "public/control\u001f.json",
      "public/a b.json",
      " public/a.json",
      "https://example.invalid/a.json",
      "/public/a.json",
      "public\\a.json",
      "public/./a.json",
      "public/../a.json",
      "public/café.json",
    ]) expect(isSafeReleaseArtifactReference(unsafe)).toBe(false);
  });
});
