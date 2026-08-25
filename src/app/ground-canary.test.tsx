// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroundClass, GroundFeature } from "../domain/ground";
import type { LoadedGroundRelease } from "../runtime/ground-release-runtime";
import type { LoadedGroundEmbellishmentRelease } from "../runtime/ground-embellishment-runtime";
import type { GroundRenderRefusal, GroundRenderSummary } from "../features/explorer/ground-render-plan";
import type { GroundEmbellishmentRenderSummary } from "../features/explorer/ground-embellishment-render-plan";

const groundMocks = vi.hoisted(() => ({ loadGroundRelease: vi.fn() }));
const embellishmentMocks = vi.hoisted(() => ({ loadGroundEmbellishmentRelease: vi.fn() }));
const CURB_FEATURE_ID = vi.hoisted(() => "udt:ground:manhattan:curb:01c6bff3f3fe931f");
const exteriorMocks = vi.hoisted(() => ({ loadExteriorPilotRelease: vi.fn() }));
const citywideMocks = vi.hoisted(() => ({ loadCitywideRelease: vi.fn() }));

/**
 * The viewport is mocked down to the ground contract only.
 *
 * What the assertions need is the PROPS the app hands the renderer — an overlay
 * or null, and which classes it may draw — plus a way to fire a ground pick.
 * Rendering CesiumJS in jsdom would test the mock, not the wiring.
 */
vi.mock("../features/explorer/CesiumViewport", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal() as Record<string, unknown>;
  // The grid-visibility rule is taken from the REAL module, not restated here:
  // the mock publishes what the actual predicate answers for the overlay prop
  // the app handed it. The `ImageryLayer.show` write it drives is not
  // observable in jsdom and is covered by CesiumViewport.test.ts plus visual
  // confirmation.
  const gridVisible = actual.syntheticGridVisible as (groundBaseActive: boolean) => boolean;
  const { activeGroundEmbellishmentCells: activeCells } = await import("../runtime/ground-embellishment-runtime");
  type MockProps = {
    groundOverlay?: LoadedGroundRelease | null;
    groundLayerVisibility?: Partial<Record<GroundClass, boolean>>;
    onGroundFeatureSelected?: (feature: GroundFeature) => void;
    onGroundRenderSummary?: (summary: GroundRenderSummary | null) => void;
    onGroundRefusals?: (refusals: ReadonlyMap<string, readonly GroundRenderRefusal[]>) => void;
    groundEmbellishmentOverlay?: LoadedGroundEmbellishmentRelease | null;
    onGroundEmbellishmentRenderSummary?: (summary: GroundEmbellishmentRenderSummary | null) => void;
  };
  const MockCesiumViewport = ({
    groundOverlay,
    groundLayerVisibility,
    onGroundFeatureSelected,
    onGroundRenderSummary,
    onGroundRefusals,
    groundEmbellishmentOverlay,
    onGroundEmbellishmentRenderSummary,
  }: MockProps) => {
    /**
     * The near tier's activation is run through the REAL selector, over the
     * overlay's real serving cells, from a camera standing on the first of
     * them. Restating the gate in the mock would have tested the mock; this
     * way the session assertions below are about the wiring and the scope
     * decision the production code actually makes.
     */
    React.useEffect(() => {
      if (!groundEmbellishmentOverlay) { onGroundEmbellishmentRenderSummary?.(null); return; }
      const cells = groundEmbellishmentOverlay.servingCells;
      const first = cells[0];
      const groundCenter = first ? { longitude: (first.bounds.west + first.bounds.east) / 2, latitude: (first.bounds.south + first.bounds.north) / 2 } : null;
      const active = (activeCells as (input: unknown) => { cellId: string }[])({ groundCenter, cells });
      onGroundEmbellishmentRenderSummary?.({
        activeCells: active.length,
        eligibleCells: active.length,
        drawnSegments: active.length * 20_000,
        skippedParts: 0,
        failedCells: 0,
        residentBytes: 1_200_000,
        nearTierMaxDistanceMeters: first ? first.maxDistanceMeters : null,
      });
    }, [groundEmbellishmentOverlay, onGroundEmbellishmentRenderSummary]);
    React.useEffect(() => {
      if (!groundOverlay) { onGroundRenderSummary?.(null); return; }
      onGroundRenderSummary?.({ drawnCells: 2, visibleCells: 3, drawnPolygons: 812, skippedParts: 4, failedCells: 0, residentBytes: 1024 });
      onGroundRefusals?.(new Map([["udt:manhattan:park:M010", [{
        partId: "udt:manhattan:park:M010#ground-cell-000060-14-4826-4483",
        canonicalFeatureId: "udt:manhattan:park:M010",
        groundClass: "park" as const,
        reason: "non-simple-ring" as const,
        selfTouchingRings: 1,
        statement: "Not drawn in cell ground-cell-000060-14-4826-4483: 1 ring of this park share visits a position twice.",
      }]]]));
    }, [groundOverlay, onGroundRenderSummary, onGroundRefusals]);
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-ground-overlay": groundOverlay ? groundOverlay.releaseId : "",
        "data-grid-visible": String(gridVisible(groundOverlay != null)),
        "data-ground-classes": Object.entries(groundLayerVisibility ?? {}).filter(([, visible]) => visible).map(([groundClass]) => groundClass).sort().join(","),
        "data-ground-embellishment-overlay": groundEmbellishmentOverlay ? groundEmbellishmentOverlay.releaseId : "",
        "data-ground-embellishment-cells": (groundEmbellishmentOverlay?.servingCells ?? []).map((cell) => cell.cellId).join(","),
      },
      React.createElement("button", { type: "button", onClick: () => { const feature = groundOverlay?.feature("udt:manhattan:park:M010"); if (feature) onGroundFeatureSelected?.(feature); } }, "Mock ground pick"),
      // The near tier's pick goes through the SAME callback the flat pass uses,
      // because in the real viewport it goes through the same pick map.
      React.createElement("button", { type: "button", onClick: () => { const feature = groundEmbellishmentOverlay?.feature(CURB_FEATURE_ID); if (feature) onGroundFeatureSelected?.(feature); } }, "Mock curb pick"),
    );
  };
  return { ...actual, CesiumViewport: MockCesiumViewport };
});

vi.mock("../runtime/ground-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadGroundRelease: groundMocks.loadGroundRelease };
});

vi.mock("../runtime/ground-embellishment-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadGroundEmbellishmentRelease: embellishmentMocks.loadGroundEmbellishmentRelease };
});

vi.mock("../runtime/exterior-pilot-release", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadExteriorPilotRelease: exteriorMocks.loadExteriorPilotRelease };
});

vi.mock("../runtime/citywide-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadCitywideRelease: citywideMocks.loadCitywideRelease };
});

import { App, GROUND_DEFAULT_ON, GROUND_OFF_VALUE, appendGroundUrl, groundOptOutValue, parseGroundRequested } from "./App";
import { MANHATTAN_GROUND_RELEASE_ID } from "../runtime/ground-release-runtime";
import {
  GROUND_EMBELLISHMENT_CANARY_WAVES,
  MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
  groundEmbellishmentCanaryTileRows,
  isGroundEmbellishmentCanaryCell,
} from "../runtime/ground-embellishment-runtime";
import { EXTERIOR_WAVE_PLAN, type ExteriorWaveId } from "../release/exterior-wave-ledger";
import { groundCellTileKey } from "../release/ground-release";
import { tileBounds } from "../runtime/spatial";

const parkFeature: GroundFeature = {
  canonicalFeatureId: "udt:manhattan:park:M010",
  cityId: "city:manhattan",
  class: "park",
  claimLevel: "source-backed",
  sourceRefs: [{
    schemaVersion: "1.0",
    id: "nyc.parks-properties:enfh-gkve:M010",
    registryEntryId: "nyc.parks-properties",
    provider: "NYC Parks",
    datasetId: "enfh-gkve",
    sourceRecordId: "M010",
    sourceUrl: "https://data.cityofnewyork.us/resource/enfh-gkve.json",
    licenseRefId: "nyc-open-data-terms",
    role: "primary",
    capturedAt: "2026-08-04T14:47:42.642Z",
    updatedAt: "2026-07-17T13:40:16.000Z",
    observedAt: "2026-08-04T14:47:42.642Z",
    release: null,
  }],
  uncertainty: { horizontalMeters: null, verticalMeters: null, temporal: "NYC Parks rows updated 2026-07-17; managed-property geometry is not a legal survey." },
  identityOrigin: { kind: "referenced-existing", existingFeatureId: "udt:manhattan:park:M010" },
};

function groundOverlayFixture(): LoadedGroundRelease {
  return {
    releaseId: MANHATTAN_GROUND_RELEASE_ID,
    document: {
      schemaVersion: "1.0",
      releaseId: MANHATTAN_GROUND_RELEASE_ID,
      cityId: "city:manhattan",
      configId: "config:manhattan-ground",
      partitionSchemeId: "ground-partition-v1-level14",
      ownershipLedgerId: "ground-ledger:city-manhattan:ground-partition-v1-level14:35a834d29aafc8be7f4352c61d575f03",
      generatedAt: "2026-08-24T12:00:00.000Z",
      immutable: true,
      sourceSnapshots: [],
      clip: { sourceExtent: { west: -74.1, south: 40.6, east: -73.8, north: 40.95 }, clipBounds: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 }, bufferMeters: 0, rule: "per cell" },
      geometryValidation: { method: "shoelace", areaResidualToleranceRelative: 0.000001, maxObservedRelativeAreaError: 0, status: "pass" },
      assets: [],
      claimCeilings: { park: "Source-backed NYC Parks managed-property polygons; presence does not prove current access." },
      provenance: { sourceEpoch: "rows updated 2026-07-17", termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "NYC Open Data", disclaimer: "no warranty", localOnly: true, runtimeExternalNetwork: false },
      fallback: "flat tier",
    },
    ledger: { schemaVersion: "1.0", ledgerId: "ground-ledger:city-manhattan:ground-partition-v1-level14:35a834d29aafc8be7f4352c61d575f03", cityId: "city:manhattan", configId: "config:manhattan-ground", partitionSchemeId: "ground-partition-v1-level14", immutable: true, baseIdentitySet: { id: "ground-identity", checksumSha256: "a".repeat(64), featureCount: 1, partCount: 1 }, coverage: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 }, cells: [] },
    features: [parkFeature],
    shippedClasses: ["roadbed", "sidewalk", "park", "plaza", "water"],
    partitionTileLevel: 14,
    coverage: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 },
    feature: (canonicalFeatureId) => (canonicalFeatureId === parkFeature.canonicalFeatureId ? parkFeature : undefined),
    cell: () => undefined,
    cellIdForTileKey: () => undefined,
    materializedCellIds: [],
    hasArtifact: () => false,
    loadCellClass: () => Promise.reject(new Error("not used in this test")),
    cached: () => undefined,
    retain: () => 0,
    residency: () => ({ entries: 0, bytes: 0, evictions: 0 }),
  };
}

/**
 * One curb cell per promoted wave, and one outside every wave.
 *
 * T011 promoted all five row-owning waves, so the interesting boundary is no
 * longer Midtown against the rest of Manhattan: it is the island against row
 * 4489, which the ground partition reaches by outward-snapping the declared
 * extent and which no building wave owns. The out-of-wave cell is present in
 * the LEDGER and ships an artifact, and must never appear in `servingCells`.
 *
 * The Midtown cell stays FIRST because the mocked viewport stands its camera on
 * the first serving cell; the near tier's activation ring is unchanged by
 * promotion, so a wider promoted set must not widen what one camera activates.
 */
const MIDTOWN_CELL_ID = "ground-cell-000051-14-4824-4482";
const PROMOTED_WAVE_CELL_IDS = [
  MIDTOWN_CELL_ID,
  "ground-cell-000030-14-4824-4485",
  "ground-cell-000037-14-4824-4484",
  "ground-cell-000070-14-4825-4479",
  "ground-cell-000090-14-4826-4471",
];
const OUT_OF_WAVE_CELL_ID = "ground-cell-000001-14-4823-4489";

const curbFeature: GroundFeature = {
  canonicalFeatureId: CURB_FEATURE_ID,
  cityId: "city:manhattan",
  class: "curb",
  claimLevel: "estimated",
  sourceRefs: [{
    schemaVersion: "1.0",
    id: "nyc.oti-planimetrics-pavement-edge-block835:x9uq-u3qs:19226000628.0",
    registryEntryId: "nyc.oti-planimetrics-pavement-edge-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    datasetId: "x9uq-u3qs",
    sourceRecordId: "19226000628.0",
    sourceUrl: "https://data.cityofnewyork.us/resource/x9uq-u3qs.geojson",
    licenseRefId: "nyc-open-data-terms",
    role: "primary",
    capturedAt: "2026-08-24T02:41:06.563Z",
    updatedAt: "2024-04-26T20:48:18.000Z",
    observedAt: "2026-08-24T02:41:06.563Z",
    release: null,
  }],
  uncertainty: { horizontalMeters: 0.25, verticalMeters: 0.1, temporal: "Pavement edge rows updated 2024-04-26; the vertical profile is authored, not measured." },
  identityOrigin: { kind: "ground-owned" },
};

/**
 * The overlay the app is handed, scoped by the PRODUCTION wave predicate.
 *
 * `waves` defaults to the promoted set, so the default-session tests below
 * assert the scope decision production actually makes. Passing a reduced set is
 * how the rollback rehearsal asks what deleting one name from
 * `GROUND_EMBELLISHMENT_CANARY_WAVES` would do to a real session.
 */
function embellishmentOverlayFixture(waves: readonly ExteriorWaveId[] = GROUND_EMBELLISHMENT_CANARY_WAVES): LoadedGroundEmbellishmentRelease {
  const rows = groundEmbellishmentCanaryTileRows(waves);
  // The out-of-wave cell is offered to the same filter as the rest and is
  // dropped by it, rather than being omitted by the fixture's own choice.
  const servingCells = [...PROMOTED_WAVE_CELL_IDS, OUT_OF_WAVE_CELL_ID]
    .filter((cellId) => isGroundEmbellishmentCanaryCell(cellId, rows))
    .map((cellId, index) => ({
      cellId,
      groundClass: "curb" as const,
      bounds: tileBounds(groundCellTileKey(cellId)),
      maxDistanceMeters: 400,
      order: index,
    }));
  return {
    releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
    document: {
      schemaVersion: "1.0",
      releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
      cityId: "city:manhattan",
      configId: "config:manhattan-ground",
      partitionSchemeId: "ground-partition-v1-level14",
      ownershipLedgerId: "ground-ledger:city-manhattan:ground-partition-v1-level14:ab802550f84a870c732e5f598f2e3064",
      generatedAt: "2026-08-25T00:00:00.000Z",
      immutable: true,
      sourceSnapshots: [],
      clip: { sourceExtent: { west: -74.1, south: 40.6, east: -73.8, north: 40.95 }, clipBounds: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 }, bufferMeters: 0, rule: "per cell" },
      geometryValidation: { method: "L1 length", areaResidualToleranceRelative: 0.000001, maxObservedRelativeAreaError: 0, status: "pass" },
      assets: [],
      claimCeilings: { curb: "Estimated curb embellishment; the 0.22 m rise is authored and this is not a survey of current curb construction." },
      provenance: { sourceEpoch: "pavement edge rows updated 2024-04-26", termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "NYC Open Data", disclaimer: "no warranty", localOnly: true, runtimeExternalNetwork: false },
      fallback: "A consumer that cannot verify a curb draws the flat cartographic base alone.",
    },
    ledger: { schemaVersion: "1.0", ledgerId: "ground-ledger:city-manhattan:ground-partition-v1-level14:ab802550f84a870c732e5f598f2e3064", cityId: "city:manhattan", configId: "config:manhattan-ground", partitionSchemeId: "ground-partition-v1-level14", immutable: true, baseIdentitySet: { id: "ground-identity", checksumSha256: "b".repeat(64), featureCount: 1, partCount: 1 }, coverage: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 }, cells: [] },
    features: [curbFeature],
    shippedClasses: ["curb"],
    partitionTileLevel: 14,
    coverage: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 },
    canaryTileRows: rows,
    servingCells,
    feature: (canonicalFeatureId) => (canonicalFeatureId === CURB_FEATURE_ID ? curbFeature : undefined),
    cell: () => undefined,
    loadCellClass: () => Promise.reject(new Error("not used in this test")),
    cached: () => undefined,
    retain: () => 0,
    residency: () => ({ entries: 0, bytes: 0, evictions: 0 }),
  };
}

const initialTestUrl = window.location.href;
const groundUrl = `${new URL(initialTestUrl).origin}/?ground=${MANHATTAN_GROUND_RELEASE_ID}`;
const groundOffUrl = `${new URL(initialTestUrl).origin}/?ground=${GROUND_OFF_VALUE}`;

beforeEach(() => {
  groundMocks.loadGroundRelease.mockReset();
  groundMocks.loadGroundRelease.mockResolvedValue(groundOverlayFixture());
  embellishmentMocks.loadGroundEmbellishmentRelease.mockReset();
  embellishmentMocks.loadGroundEmbellishmentRelease.mockResolvedValue(embellishmentOverlayFixture());
  exteriorMocks.loadExteriorPilotRelease.mockReset();
  exteriorMocks.loadExteriorPilotRelease.mockImplementation(async () => { throw new Error("Exterior release bytes are not served in this test."); });
  citywideMocks.loadCitywideRelease.mockReset();
  citywideMocks.loadCitywideRelease.mockImplementation(async () => { throw new Error("Citywide release bytes are not served in this test."); });
});

afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });

const groundStatus = () => document.querySelector<HTMLElement>("[data-ground-release]");
const gridVisible = () => document.querySelector("[data-grid-visible]")?.getAttribute("data-grid-visible");
const openLayers = () => fireEvent.click(document.querySelector<HTMLElement>(".layer-controls .overlay-launcher")!);

describe("citywide ground base", () => {
  /**
   * T008's whole claim, in one test: a session that asks for nothing gets the
   * verified cartographic ground, the grid stops being the visible ground, and
   * the URL still says nothing — the default is silent in either polarity.
   */
  it("is the default ground: loaded without any parameter, and the grid is hidden once it verifies", async () => {
    expect(GROUND_DEFAULT_ON).toBe(true);
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    expect(groundMocks.loadGroundRelease).toHaveBeenCalledWith(`/data/${MANHATTAN_GROUND_RELEASE_ID}/`, expect.anything(), undefined);
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID);
    expect(gridVisible()).toBe("false");
    openLayers();
    expect(document.querySelectorAll("[data-ground-layer]")).toHaveLength(5);
    expect(window.location.search).not.toContain("ground=");
    expect(appendGroundUrl(`${new URL(initialTestUrl).origin}/?featureId=x`, true, null)).toBe(`${new URL(initialTestUrl).origin}/?featureId=x`);
  });

  it("publishes the measured verification cost rather than claiming the flip is free", async () => {
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    const measured = groundStatus()!.getAttribute("data-ground-verify-ms");
    expect(measured).toMatch(/^\d+$/);
    expect(groundStatus()!.textContent).toContain(`verified in ${measured} ms`);
  });

  it("opts out on ?ground=off: no load, no status, and the grid is the ground again", async () => {
    window.history.replaceState({}, "", groundOffUrl);
    render(<App />);
    await waitFor(() => expect(document.querySelector(".viewport")).toBeInTheDocument());
    expect(groundMocks.loadGroundRelease).not.toHaveBeenCalled();
    expect(groundStatus()).toBeNull();
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe("");
    expect(gridVisible()).toBe("true");
    openLayers();
    expect(document.querySelectorAll("[data-ground-layer]")).toHaveLength(0);
  });

  it("states the opt-out and stays silent about the default, in whichever polarity is shipped", () => {
    const base = `${new URL(initialTestUrl).origin}/?featureId=x`;
    expect(groundOptOutValue()).toBe(GROUND_DEFAULT_ON ? GROUND_OFF_VALUE : MANHATTAN_GROUND_RELEASE_ID);
    expect(appendGroundUrl(base, GROUND_DEFAULT_ON, null)).toBe(base);
    const optedOut = appendGroundUrl(base, !GROUND_DEFAULT_ON, null);
    expect(new URL(optedOut).searchParams.get("ground")).toBe(groundOptOutValue());
    expect(parseGroundRequested(optedOut)).toBe(!GROUND_DEFAULT_ON);
    expect(parseGroundRequested(appendGroundUrl(optedOut, GROUND_DEFAULT_ON, null))).toBe(GROUND_DEFAULT_ON);
    // Naming the release is always an explicit request; an unknown spelling
    // resolves to the default rather than to something this build cannot verify.
    expect(parseGroundRequested(`${base}&ground=${MANHATTAN_GROUND_RELEASE_ID}`)).toBe(true);
    expect(parseGroundRequested(`${base}&ground=manhattan-ground-19990101`)).toBe(GROUND_DEFAULT_ON);
    expect(parseGroundRequested(base)).toBe(GROUND_DEFAULT_ON);
  });

  it("loads, verifies, and reports what it drew when the URL names the release", async () => {
    window.history.replaceState({}, "", groundUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    expect(groundMocks.loadGroundRelease).toHaveBeenCalledWith(`/data/${MANHATTAN_GROUND_RELEASE_ID}/`, expect.anything(), undefined);
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID);
    const status = groundStatus()!;
    expect(status.textContent).toContain("2 cells drawn");
    expect(status.textContent).toContain("4 parts skipped: non-simple rings");
    expect(status.textContent).toContain("1 cell in view not yet drawn");
    expect(status.getAttribute("data-ground-skipped-parts")).toBe("4");
  });

  it("shows the five class toggles only once the release is verified, and drops a class from the render on toggle", async () => {
    window.history.replaceState({}, "", groundUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    openLayers();
    const toggles = [...document.querySelectorAll<HTMLElement>("[data-ground-layer]")].map((node) => node.getAttribute("data-ground-layer"));
    expect(toggles).toEqual(["ground-roadbed", "ground-sidewalk", "ground-park", "ground-plaza", "ground-water"]);
    expect(document.querySelector("[data-ground-classes]")?.getAttribute("data-ground-classes")).toBe("park,plaza,roadbed,sidewalk,water");
    fireEvent.click(document.querySelector<HTMLElement>('[data-ground-layer="ground-water"]')!);
    await waitFor(() => expect(document.querySelector("[data-ground-classes]")?.getAttribute("data-ground-classes")).toBe("park,plaza,roadbed,sidewalk"));
    expect(document.querySelector<HTMLElement>('[data-ground-layer="ground-water"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("fails closed with a specific message and no overlay when verification fails", async () => {
    groundMocks.loadGroundRelease.mockRejectedValue(new Error("Ground artifact checksum mismatch for artifacts/ground-cell-000060-14-4826-4483/park.json."));
    window.history.replaceState({}, "", groundUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("failed"));
    expect(groundStatus()!.textContent).toContain("checksum mismatch");
    expect(groundStatus()!.textContent).toContain("the existing base scene was left unchanged");
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe("");
    // The failure direction the flip must preserve: no verified ground means
    // the grid is still drawn, beside a banner that says why. Never a void.
    expect(gridVisible()).toBe("true");
    expect(groundStatus()!.getAttribute("data-ground-verify-ms")).toBe("");
    openLayers();
    expect(document.querySelectorAll("[data-ground-layer]")).toHaveLength(0);
  });

  it("shows class, referenced identity, provenance, claim ceiling and refusals when a surface is picked", async () => {
    window.history.replaceState({}, "", groundUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    fireEvent.click(screen.getByRole("button", { name: "Mock ground pick" }));
    const section = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".ground-detail");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(section.getAttribute("data-ground-feature")).toBe("udt:manhattan:park:M010");
    expect(section.textContent).toContain("park");
    expect(section.textContent).toContain("Reuses the existing catalog identity udt:manhattan:park:M010");
    expect(section.textContent).toContain("NYC Parks · enfh-gkve · record M010");
    expect(section.textContent).toContain("source rows updated 2026-07-17T13:40:16.000Z");
    expect(section.textContent).toContain("presence does not prove current access");
    expect(section.textContent).toContain(MANHATTAN_GROUND_RELEASE_ID);
    expect(section.querySelector("[data-ground-refusal-count]")?.getAttribute("data-ground-refusal-count")).toBe("1");
    expect(section.textContent).toContain("visits a position twice");
    expect(window.location.search).toContain(`groundFeature=${encodeURIComponent("udt:manhattan:park:M010")}`);
  });

  it("restores the grid and writes the opt-out to the URL when the ground base is disabled, and takes it back", async () => {
    window.history.replaceState({}, "", groundUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    fireEvent.click(screen.getByRole("button", { name: "Disable ground base" }));
    await waitFor(() => expect(groundStatus()).toBeNull());
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe("");
    expect(gridVisible()).toBe("true");
    expect(new URL(window.location.href).searchParams.get("ground")).toBe(GROUND_OFF_VALUE);
    // A default-on opt-out that could not be undone in the session would be a
    // one-way door, so the same control re-arms the release.
    fireEvent.click(screen.getByRole("button", { name: "Enable ground base" }));
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    expect(gridVisible()).toBe("false");
    expect(window.location.search).not.toContain("ground=");
  });
});

const embellishmentOverlay = () => document.querySelector("[data-ground-embellishment-overlay]")?.getAttribute("data-ground-embellishment-overlay");
const curbPick = () => fireEvent.click(screen.getByRole("button", { name: "Mock curb pick" }));

describe("near-tier curb canary (T010)", () => {
  /**
   * The default session, end to end.
   *
   * Nothing is asked for: the base verifies, the near tier loads behind it, and
   * the status line grows a curb segment beside — never instead of — the base's
   * own reading.
   */
  it("serves near-tier curbs in the default session, appended to the base's status line", async () => {
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    expect(embellishmentMocks.loadGroundEmbellishmentRelease)
      .toHaveBeenCalledWith(`/data/${MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID}/`, expect.anything());
    const status = groundStatus()!;
    // The base's reading is intact, with the near tier appended.
    expect(status.textContent).toContain("2 cells drawn");
    expect(status.textContent).toContain("near-tier curbs within 400 m: 1 cell / 20000 segments");
  });

  /**
   * The promoted boundary, asserted on the data the app is actually handed.
   *
   * T011 widened the promoted set to every row-owning wave, so a default
   * session is offered cells from all five — and a cell in row 4489, which is
   * in the ledger and ships an artifact, is still never offered to the
   * renderer. Coverage is what changed; the boundary is still a boundary.
   */
  it("offers cells from every promoted wave to the renderer, and nothing outside coverage", async () => {
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    const served = document.querySelector("[data-ground-embellishment-cells]")!.getAttribute("data-ground-embellishment-cells")!.split(",");
    expect(served).toEqual(PROMOTED_WAVE_CELL_IDS);
    const rows = groundEmbellishmentCanaryTileRows();
    expect([...GROUND_EMBELLISHMENT_CANARY_WAVES])
      .toEqual(EXTERIOR_WAVE_PLAN.filter((wave) => wave.tileRowRange !== null).map((wave) => wave.waveId));
    for (const cellId of served) expect(isGroundEmbellishmentCanaryCell(cellId, rows)).toBe(true);
    expect(served).not.toContain(OUT_OF_WAVE_CELL_ID);
    expect(isGroundEmbellishmentCanaryCell(OUT_OF_WAVE_CELL_ID, rows)).toBe(false);
  });

  /**
   * Per-wave rollback, rehearsed as a session rather than as a set operation.
   *
   * Deleting one name from `GROUND_EMBELLISHMENT_CANARY_WAVES` must take that
   * wave's cells out of the renderer's hands and leave every other wave's cells
   * exactly where they were — including the flat base, which never notices.
   */
  it("deactivates exactly one wave's cells when that wave is rolled back", async () => {
    const rolledBack: ExteriorWaveId = "northern-manhattan";
    const northernCellId = "ground-cell-000090-14-4826-4471";
    embellishmentMocks.loadGroundEmbellishmentRelease.mockResolvedValue(
      embellishmentOverlayFixture(GROUND_EMBELLISHMENT_CANARY_WAVES.filter((waveId) => waveId !== rolledBack)),
    );
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    const served = document.querySelector("[data-ground-embellishment-cells]")!.getAttribute("data-ground-embellishment-cells")!.split(",");
    expect(served).toEqual(PROMOTED_WAVE_CELL_IDS.filter((cellId) => cellId !== northernCellId));
    expect(served).not.toContain(northernCellId);
    // The rest of the island is untouched, and so is the base beneath it.
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID);
    expect(groundStatus()!.textContent).toContain("near-tier curbs within 400 m");
  });

  /**
   * The fail-closed DIRECTION, at the session level.
   *
   * The curb release fails verification and the cartographic base keeps
   * everything: its state, its overlay, its counts, and a hidden grid. The curb
   * failure gets its own sentence and takes nothing with it.
   */
  it("fails closed to no curbs, leaving the flat base and its status untouched", async () => {
    embellishmentMocks.loadGroundEmbellishmentRelease.mockRejectedValue(
      new Error("Ground embellishment artifact checksum mismatch for artifacts/ground-cell-000051-14-4824-4482/curb.json."),
    );
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    await waitFor(() => expect(groundStatus()!.textContent).toContain("Near-tier curbs were disabled"));
    const status = groundStatus()!;
    expect(status.getAttribute("data-ground-state")).toBe("ready");
    expect(status.textContent).toContain("Ground embellishment artifact checksum mismatch");
    expect(status.textContent).toContain("the cartographic ground base was left unchanged");
    // The base is completely unaffected: same overlay, same counts, same grid.
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID);
    expect(status.textContent).toContain("2 cells drawn");
    expect(status.textContent).toContain("812 polygons");
    expect(gridVisible()).toBe("false");
    expect(embellishmentOverlay()).toBe("");
    expect(status.textContent).not.toContain("near-tier curbs within");
  });

  /**
   * Picking a 3D curb resolves to the SAME identity scheme a flat pick does,
   * and the panel attributes it to the release that actually shipped it —
   * including the sentence about which half of the solid is measured.
   */
  it("resolves a curb pick to the ground identity scheme, with the estimated-profile disclosure", async () => {
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    curbPick();
    const section = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".ground-detail");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(section.getAttribute("data-ground-feature")).toBe(CURB_FEATURE_ID);
    expect(section.textContent).toContain("curb");
    expect(section.querySelector(".claim-badge")?.getAttribute("data-visual-evidence-level")).toBe("estimated");
    expect(section.querySelector("[data-ground-embellishment-disclosure]")?.getAttribute("data-ground-embellishment-disclosure")).toBe("curb");
    expect(section.textContent).toContain("the vertical rise it is extruded by is an authored estimate");
    // Attributed to the embellishment release, not to the flat one it sits on.
    expect(section.textContent).toContain(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID);
    expect(section.textContent).toContain("this is not a survey of current curb construction");
    expect(section.textContent).toContain("NYC Office of Technology and Innovation (OTI) Planimetrics · x9uq-u3qs");
    // The deep link is the SAME scheme a flat ground pick writes.
    expect(window.location.search).toContain(`groundFeature=${encodeURIComponent(CURB_FEATURE_ID)}`);
  });

  /**
   * A tier transition, simulated by taking the near tier away and giving it
   * back, with a curb selected throughout.
   *
   * The selection, the deep link and the panel identity must all survive it:
   * deactivating a tier removes GEOMETRY, never an identity.
   */
  it("keeps a selected curb's identity and deep link across a tier deactivation and reactivation", async () => {
    window.history.replaceState({}, "", initialTestUrl);
    const view = render(<App />);
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    curbPick();
    await waitFor(() => expect(document.querySelector(".ground-detail")).not.toBeNull());
    const deepLink = window.location.search;
    expect(deepLink).toContain(encodeURIComponent(CURB_FEATURE_ID));

    // The tier goes away: the base ground is untouched and the URL still names
    // the curb, so a reload or a share is unaffected by where the camera was.
    embellishmentMocks.loadGroundEmbellishmentRelease.mockResolvedValue(embellishmentOverlayFixture());
    view.rerender(<App />);
    await waitFor(() => expect(embellishmentOverlay()).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID));
    expect(window.location.search).toBe(deepLink);
    const section = document.querySelector<HTMLElement>(".ground-detail");
    if (section) expect(section.getAttribute("data-ground-feature")).toBe(CURB_FEATURE_ID);
    // The flat ground never noticed any of it.
    expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID);
  });

  it("draws no curbs at all when the ground base is opted out", async () => {
    window.history.replaceState({}, "", groundOffUrl);
    render(<App />);
    await waitFor(() => expect(document.querySelector(".viewport")).toBeInTheDocument());
    expect(embellishmentMocks.loadGroundEmbellishmentRelease).not.toHaveBeenCalled();
    expect(embellishmentOverlay()).toBe("");
  });
});
