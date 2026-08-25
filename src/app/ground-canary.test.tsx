// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroundClass, GroundFeature } from "../domain/ground";
import type { LoadedGroundRelease } from "../runtime/ground-release-runtime";
import type { GroundRenderRefusal, GroundRenderSummary } from "../features/explorer/ground-render-plan";

const groundMocks = vi.hoisted(() => ({ loadGroundRelease: vi.fn() }));
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
  type MockProps = {
    groundOverlay?: LoadedGroundRelease | null;
    groundLayerVisibility?: Partial<Record<GroundClass, boolean>>;
    onGroundFeatureSelected?: (feature: GroundFeature) => void;
    onGroundRenderSummary?: (summary: GroundRenderSummary | null) => void;
    onGroundRefusals?: (refusals: ReadonlyMap<string, readonly GroundRenderRefusal[]>) => void;
  };
  const MockCesiumViewport = ({ groundOverlay, groundLayerVisibility, onGroundFeatureSelected, onGroundRenderSummary, onGroundRefusals }: MockProps) => {
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
      },
      React.createElement("button", { type: "button", onClick: () => { const feature = groundOverlay?.feature("udt:manhattan:park:M010"); if (feature) onGroundFeatureSelected?.(feature); } }, "Mock ground pick"),
    );
  };
  return { ...actual, CesiumViewport: MockCesiumViewport };
});

vi.mock("../runtime/ground-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadGroundRelease: groundMocks.loadGroundRelease };
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

const initialTestUrl = window.location.href;
const groundUrl = `${new URL(initialTestUrl).origin}/?ground=${MANHATTAN_GROUND_RELEASE_ID}`;
const groundOffUrl = `${new URL(initialTestUrl).origin}/?ground=${GROUND_OFF_VALUE}`;

beforeEach(() => {
  groundMocks.loadGroundRelease.mockReset();
  groundMocks.loadGroundRelease.mockResolvedValue(groundOverlayFixture());
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
