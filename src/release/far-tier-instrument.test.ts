/**
 * The pinned instrument's whole value is that the harness cannot disagree with
 * the spec and cannot pass a scene that does not match it. These tests attack
 * both, plus the one property that caused the original failure: that the spec
 * actually covers the settings which moved a reading.
 */
import { describe, expect, it } from "vitest";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  FAR_TIER_INSTRUMENT_SPEC,
  farTierInstrumentAssertionPython,
  farTierInstrumentSpecHash,
} from "./far-tier-instrument.ts";

describe("the spec covers what actually moved a reading", () => {
  it("pins subject isolation, which is the defect that caused the divergence", () => {
    // T002 rendered both subjects resident and hid one with hide_render. A
    // hidden object still lights the scene: the same tile read 1.072801 that
    // way and 1.002152 isolated. Prose alone would not have stopped it, so the
    // rule is in the spec and the measured numbers are in the comment.
    const isolation = FAR_TIER_INSTRUMENT_SPEC.sceneHygiene.subjectIsolation;
    expect(isolation).toContain("FORBIDDEN");
    expect(isolation).toContain("hide_render");
    expect(isolation).toContain("deleted");
  });

  it("pins the user PREFERENCES, not only scene settings", () => {
    // Preferences persist across files and differ between installs, so a spec
    // that lists only scene state is a spec that travels badly.
    expect(Object.keys(FAR_TIER_INSTRUMENT_SPEC.preferences)).toContain("system.anisotropic_filter");
    expect(Object.keys(FAR_TIER_INSTRUMENT_SPEC.preferences)).toContain("system.gl_texture_limit");
  });

  it("pins the colour-management settings T002 left open", () => {
    const colour = FAR_TIER_INSTRUMENT_SPEC.colourManagement;
    for (const key of ["view_settings.look", "view_settings.exposure", "view_settings.gamma", "display_settings.display_device"]) {
      expect(Object.keys(colour), `${key} is not pinned`).toContain(key);
    }
  });

  it("pins the mask and luminance semantics, which are measurement not rendering", () => {
    expect(FAR_TIER_INSTRUMENT_SPEC.maskSemantics.rule).toContain("0.5");
    expect(FAR_TIER_INSTRUMENT_SPEC.maskSemantics.luminance).toContain("0.2126");
  });
});

describe("the generated harness", () => {
  const python = farTierInstrumentAssertionPython();

  it("emits Python literals, not JavaScript ones", () => {
    // The first version emitted `false`, which Python rejects. A harness that
    // cannot run is a harness that silently is not enforcing anything.
    expect(python).not.toMatch(/,\s(?:true|false)\)/u);
    expect(python).toMatch(/,\s(?:True|False)\)/u);
  });

  it("checks every pinned scalar, so a field cannot be added to the spec and forgotten", () => {
    const expected = [
      ...Object.keys(FAR_TIER_INSTRUMENT_SPEC.preferences).map((key) => `preferences.${key}`),
      ...Object.keys(FAR_TIER_INSTRUMENT_SPEC.render).map((key) => `render.${key}`),
      ...Object.keys(FAR_TIER_INSTRUMENT_SPEC.imageSettings).map((key) => `image_settings.${key}`),
      ...Object.keys(FAR_TIER_INSTRUMENT_SPEC.colourManagement).map((key) => `colour.${key}`),
      ...Object.keys(FAR_TIER_INSTRUMENT_SPEC.eevee).map((key) => `eevee.${key}`),
    ];
    for (const label of expected) expect(python, `${label} is not asserted`).toContain(`"${label}"`);
  });

  it("fails closed rather than reporting, when anything mismatches", () => {
    expect(python).toContain("raise RuntimeError('PINNED INSTRUMENT MISMATCH: '");
  });

  it("refuses a scene carrying more than one light", () => {
    // A stray second light is the classic surviving-session-state defect and
    // no per-setting check would catch it.
    expect(python).toContain("lights.total");
    expect(python).toContain("sun.count");
  });

  it("carries the spec hash into the run, so a capture can name what enforced it", () => {
    expect(python).toContain(farTierInstrumentSpecHash());
    expect(python).toContain("_ENFORCED");
  });

  it("uses an angular tolerance loose enough to survive a radians round trip", () => {
    // 1e-6 degrees refused a legitimate 60-degree camera, because degrees are
    // stored as radians. 1e-4 degrees is 0.36 arcseconds.
    expect(python).toMatch(/camera\.angle_y_degrees.*1e-4/u);
  });
});

describe("the spec hash", () => {
  it("moves when any pinned section changes", () => {
    const baseline = farTierInstrumentSpecHash();
    expect(sha256HexSync(stableSerialize(FAR_TIER_INSTRUMENT_SPEC))).toBe(baseline);
    for (const key of Object.keys(FAR_TIER_INSTRUMENT_SPEC)) {
      const mutated: Record<string, unknown> = { ...FAR_TIER_INSTRUMENT_SPEC };
      mutated[key] = { mutated: true };
      expect(sha256HexSync(stableSerialize(mutated)), `spec hash ignores ${key}`).not.toBe(baseline);
    }
  });
});
