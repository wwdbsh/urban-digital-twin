import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { AGREEMENT_TOLERANCES, RECORD_ID, SAMPLES_PER_WAVE } from "./mass-generation-blender-agreement-cli.mjs";
import { WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agreementPath = join(repositoryRoot, "data", RECORD_ID, "blender-agreement.json");
const agreementText = readFileSync(agreementPath, "utf8");
const agreement = JSON.parse(agreementText);

const WAVE_IDS = Object.keys(WAVE_OWNED_PARENTS);
const MANDATORY = ["max-measured-deviation", "max-ring-vertices", "max-triangle-count", "min-sourced-height"];

/**
 * These assertions are about the RECORD, not about the geometry. They can only
 * catch a record that contradicts itself — a sample missing from a wave, a
 * mandatory stratum that was never drawn, a summary that disagrees with the rows
 * it summarises, a pass claimed over a failing check. The geometry claim is the
 * measurement itself, and no test here re-measures anything.
 */
describe("the T004 per-wave Blender agreement record", () => {
  it("carries a sidecar that matches its own bytes", () => {
    const sidecar = readFileSync(agreementPath.replace(/\.json$/u, ".sha256"), "utf8").trim().split(/\s+/u)[0];
    expect(sha256HexSync(agreementText)).toBe(sidecar);
  });

  it("covers all six waves, sixteen buildings each, except the wave that has fewer than sixteen", () => {
    expect(agreement.perWave.map((wave) => wave.waveId)).toEqual(WAVE_IDS);
    for (const wave of agreement.perWave) {
      // The obligation is sixteen. A wave that OWNS fewer generatable buildings
      // than that cannot yield sixteen distinct ones, and is measured whole
      // instead — which is stated as an exception rather than padded to sixteen.
      if (wave.candidateCount >= SAMPLES_PER_WAVE) {
        expect(wave.sampleCount).toBe(SAMPLES_PER_WAVE);
        expect(wave.exhaustive).toBe(false);
      } else {
        expect(wave.exhaustive).toBe(true);
        expect(wave.sampleCount).toBe(wave.candidateCount);
        expect(wave.coverageShare).toBe(1);
      }
      expect(wave.glbCount).toBe(wave.sampleCount * 2);
    }
    const total = agreement.perWave.reduce((sum, wave) => sum + wave.sampleCount, 0);
    expect(agreement.population.sampleTotal).toBe(total);
    expect(agreement.population.glbTotal).toBe(total * 2);
    expect(agreement.samples).toHaveLength(total);
  });

  it("draws all four mandatory inclusions in every wave", () => {
    for (const wave of agreement.perWave) {
      const labels = [...new Set(wave.mandatoryInclusions.map((entry) => entry.label))].sort();
      expect(labels).toEqual(MANDATORY);
      // And each named building is actually among that wave's measured samples.
      for (const entry of wave.mandatoryInclusions) {
        const row = agreement.samples.find((sample) => sample.buildingId === entry.buildingId && sample.waveId === wave.waveId);
        expect(row).toBeDefined();
        expect(row.mandatoryFor).toContain(entry.label);
      }
    }
  });

  it("draws the mandatory buildings the census data actually names as extreme", () => {
    // Recomputed from the sampled rows rather than trusted: within each wave's
    // sample the mandatory building must still hold its extreme, which a label
    // pinned to the wrong building would fail.
    for (const wave of agreement.perWave) {
      const subset = agreement.samples.filter((sample) => sample.waveId === wave.waveId);
      const holder = (label) => wave.mandatoryInclusions.find((entry) => entry.label === label).buildingId;
      const rowOf = (label) => subset.find((sample) => sample.buildingId === holder(label));
      expect(rowOf("max-ring-vertices").ringVertexCount).toBe(Math.max(...subset.map((row) => row.ringVertexCount)));
      expect(rowOf("min-sourced-height").sourcedHeightMeters).toBe(Math.min(...subset.map((row) => row.sourcedHeightMeters)));
      expect(rowOf("max-measured-deviation").analytic.silhouetteDeviationRatio)
        .toBe(Math.max(...subset.map((row) => row.analytic.silhouetteDeviationRatio)));
      const triangles = (row) => row.levels.find((level) => level.lodId === "lod_0").blender.triangleCount;
      expect(triangles(rowOf("max-triangle-count"))).toBe(Math.max(...subset.map(triangles)));
    }
  });

  it("gives every sample two measured LODs whose files the inventory pins", () => {
    for (const sample of agreement.samples) {
      expect(sample.levels.map((level) => level.lodId)).toEqual(["lod_0", "lod_1"]);
      for (const level of sample.levels) {
        expect(level.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(level.relativeRef).toMatch(/^public\/assets\/.+\.glb$/u);
      }
    }
    expect(agreement.crossCheck.filesMatchedToInventory).toBe(agreement.samples.length * 2);
    expect(agreement.crossCheck.checksumMismatchCount).toBe(0);
  });

  it("never records a passing sample that carries a failing check", () => {
    for (const sample of agreement.samples) {
      expect(sample.checks.length).toBeGreaterThan(0);
      expect(sample.pass).toBe(sample.checks.every((check) => check.pass));
    }
  });

  it("enumerates every failure and lets no wave claim agreement over one", () => {
    const failing = agreement.samples.filter((sample) => !sample.pass);
    expect(agreement.overall.failingSamples).toBe(failing.length);
    expect(agreement.overall.passingSamples).toBe(agreement.samples.length - failing.length);
    expect(agreement.overall.failures).toHaveLength(failing.length);
    for (const failure of agreement.overall.failures) {
      expect(failure.failedChecks.length).toBeGreaterThan(0);
      for (const check of failure.failedChecks) expect(check.pass).toBe(false);
    }
    for (const wave of agreement.perWave) {
      const subset = agreement.samples.filter((sample) => sample.waveId === wave.waveId);
      const waveFailures = subset.filter((sample) => !sample.pass);
      expect(wave.failingSamples).toHaveLength(waveFailures.length);
      expect(wave.status).toBe(waveFailures.length === 0 ? "agreed" : "disagreed");
    }
    expect(agreement.overall.status).toBe(failing.length === 0 ? "agreed" : "disagreed");
  });

  it("summarises the rows it actually carries", () => {
    for (const wave of agreement.perWave) {
      const subset = agreement.samples.filter((sample) => sample.waveId === wave.waveId);
      expect(subset).toHaveLength(wave.sampleCount);
      const worst = (id) => subset.reduce(
        (top, row) => Math.max(top, Math.abs(row.checks.find((check) => check.id === id)?.measured ?? 0)),
        0,
      );
      expect(wave.worst.groundRingExtentVsSourcedPolygonMeters).toBe(
        Math.max(worst("lod_0:ground-ring-extents-vs-sourced-polygon"), worst("lod_1:ground-ring-extents-vs-sourced-polygon")),
      );
      expect(wave.worst.volumeDeviation).toBe(
        Math.max(worst("lod_0:analytic-volume-identity"), worst("lod_1:analytic-volume-identity")),
      );
      expect(wave.importedTriangles).toBe(
        subset.reduce((sum, row) => sum + row.levels.reduce((total, level) => total + level.blender.triangleCount, 0), 0),
      );
    }
  });

  it("shows a conditional check that never applied as ABSENT rather than as a passing zero", () => {
    for (const wave of agreement.perWave) {
      const ran = wave.checkCoverage["blender-crown-vs-sourced-height"] ?? 0;
      if (ran === 0) expect(wave.worst.blenderCrownVsSourcedHeightMeters).toBeNull();
      else expect(typeof wave.worst.blenderCrownVsSourcedHeightMeters).toBe("number");
      // Every check the coverage map names really ran on that many samples.
      const subset = agreement.samples.filter((sample) => sample.waveId === wave.waveId);
      for (const [id, count] of Object.entries(wave.checkCoverage)) {
        expect(subset.filter((row) => row.checks.some((check) => check.id === id))).toHaveLength(count);
      }
    }
  });

  it("states its tolerances with the reason each one has its value", () => {
    expect(agreement.methodology.tolerances).toEqual(AGREEMENT_TOLERANCES);
    for (const key of Object.keys(AGREEMENT_TOLERANCES)) {
      if (!key.endsWith("Basis")) continue;
      expect(String(AGREEMENT_TOLERANCES[key]).length).toBeGreaterThan(40);
    }
    // Every numeric check states the tolerance it was judged against, or an
    // explicit null where the judgement is a relation rather than a threshold.
    for (const sample of agreement.samples) {
      for (const check of sample.checks) {
        expect(check).toHaveProperty("tolerance");
        expect(check).toHaveProperty("unit");
      }
    }
  });

  it("names what it did NOT measure, including the deviation ratio itself", () => {
    const notMeasured = agreement.methodology.notMeasuredInBlender.join(" ");
    expect(notMeasured).toMatch(/projected-silhouette deviation ratio/u);
    expect(notMeasured).toMatch(/No render, screenshot or eyeball/u);
    expect(agreement.notClaimedHere.join(" ")).toMatch(/visual, geographic, architectural, accessibility or performance acceptance/u);
  });

  it("agrees with every census it amended, byte for byte", () => {
    const recordChecksum = sha256HexSync(agreementText);
    for (const wave of agreement.perWave) {
      const censusText = readFileSync(join(repositoryRoot, "data", wave.releaseId, "wave-census.json"), "utf8");
      const census = JSON.parse(censusText);
      expect(census.blenderAgreement.status).toBe(wave.status);
      expect(census.blenderAgreement.sampleCount).toBe(wave.sampleCount);
      expect(census.blenderAgreement.recordSha256).toBe(recordChecksum);
      expect(census.blenderAgreement.note).toMatch(/AMENDED/u);
      const sidecar = readFileSync(join(repositoryRoot, "data", wave.releaseId, "wave-census.sha256"), "utf8").trim().split(/\s+/u)[0];
      expect(sha256HexSync(censusText)).toBe(sidecar);
    }
  });
});
