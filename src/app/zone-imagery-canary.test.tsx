// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroundClass, GroundFeature } from "../domain/ground";
import type { LoadedGroundRelease } from "../runtime/ground-release-runtime";
import type { LoadedGroundZoneImageryRelease } from "../runtime/ground-zone-imagery-runtime";
import type { GroundRenderSummary } from "../features/explorer/ground-render-plan";
import type { GroundZoneImageryRenderSummary } from "../features/explorer/ground-zone-imagery-render-plan";

const groundMocks = vi.hoisted(() => ({ loadGroundRelease: vi.fn() }));
const embellishmentMocks = vi.hoisted(() => ({ loadGroundEmbellishmentRelease: vi.fn() }));
const imageryMocks = vi.hoisted(() => ({ loadGroundZoneImageryRelease: vi.fn() }));
const exteriorMocks = vi.hoisted(() => ({ loadExteriorPilotRelease: vi.fn() }));
const citywideMocks = vi.hoisted(() => ({ loadCitywideRelease: vi.fn() }));

const PARK_ID = vi.hoisted(() => "udt:manhattan:park:M010");
const ROADBED_ID = vi.hoisted(() => "udt:ground:manhattan:roadbed:0f1e2d3c4b5a6978");

/**
 * The viewport is mocked down to the DRAPE contract only.
 *
 * It reports what the app hands it — an imagery overlay or null — and it
 * publishes the summary and draped-feature set a real drape would publish, for
 * whichever zones the overlay actually ships a texture for. The pick buttons go
 * through the SAME `onGroundFeatureSelected` callback the flat pass uses, which
 * is the assertion that matters for pick identity: the drape adds no second
 * selection path and mints no second id.
 */
vi.mock("../features/explorer/CesiumViewport", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal() as Record<string, unknown>;
  type MockProps = {
    groundOverlay?: LoadedGroundRelease | null;
    onGroundFeatureSelected?: (feature: GroundFeature) => void;
    onGroundRenderSummary?: (summary: GroundRenderSummary | null) => void;
    groundZoneImagery?: LoadedGroundZoneImageryRelease | null;
    onGroundZoneImageryRenderSummary?: (summary: GroundZoneImageryRenderSummary | null) => void;
    onGroundZoneImageryDrapedFeatures?: (ids: ReadonlySet<string>) => void;
  };
  const MockCesiumViewport = ({
    groundOverlay,
    onGroundFeatureSelected,
    onGroundRenderSummary,
    groundZoneImagery,
    onGroundZoneImageryRenderSummary,
    onGroundZoneImageryDrapedFeatures,
  }: MockProps) => {
    React.useEffect(() => {
      if (!groundOverlay) { onGroundRenderSummary?.(null); return; }
      onGroundRenderSummary?.({ drawnCells: 2, visibleCells: 2, drawnPolygons: 812, skippedParts: 0, failedCells: 0, residentBytes: 1024 });
    }, [groundOverlay, onGroundRenderSummary]);
    React.useEffect(() => {
      if (!groundZoneImagery) {
        onGroundZoneImageryRenderSummary?.(null);
        onGroundZoneImageryDrapedFeatures?.(new Set());
        return;
      }
      // Only zones the index actually ships a texture for are reported draped;
      // the roadbed in view is reported flat, exactly as the renderer does.
      const draped = groundZoneImagery.hasTexture(VISIBLE_CELL, "park") ? [PARK_ID] : [];
      onGroundZoneImageryRenderSummary?.({
        drapedZones: draped.length,
        drapedCells: draped.length > 0 ? 1 : 0,
        undrapedZones: 1,
        failedZones: 0,
        textureBytes: draped.length * 685_004,
        captureYear: groundZoneImagery.captureYear,
        releaseId: groundZoneImagery.releaseId,
      });
      onGroundZoneImageryDrapedFeatures?.(new Set(draped));
    }, [groundZoneImagery, onGroundZoneImageryRenderSummary, onGroundZoneImageryDrapedFeatures]);
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-ground-overlay": groundOverlay ? groundOverlay.releaseId : "",
        "data-zone-imagery-overlay": groundZoneImagery ? groundZoneImagery.releaseId : "",
      },
      React.createElement("button", { type: "button", onClick: () => { const feature = groundOverlay?.feature(PARK_ID); if (feature) onGroundFeatureSelected?.(feature); } }, "Mock park pick"),
      React.createElement("button", { type: "button", onClick: () => { const feature = groundOverlay?.feature(ROADBED_ID); if (feature) onGroundFeatureSelected?.(feature); } }, "Mock roadbed pick"),
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
vi.mock("../runtime/ground-zone-imagery-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadGroundZoneImageryRelease: imageryMocks.loadGroundZoneImageryRelease };
});
vi.mock("../runtime/exterior-pilot-release", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadExteriorPilotRelease: exteriorMocks.loadExteriorPilotRelease };
});
vi.mock("../runtime/citywide-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadCitywideRelease: citywideMocks.loadCitywideRelease };
});

import { App, ZONE_IMAGERY_DEFAULT_ON, ZONE_IMAGERY_OFF_VALUE, appendZoneImageryUrl, parseZoneImageryRequested, zoneImageryOptOutValue } from "./App";
import { MANHATTAN_GROUND_RELEASE_ID } from "../runtime/ground-release-runtime";
import { MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID, groundZoneImageryFailureMessage } from "../runtime/ground-zone-imagery-runtime";

const VISIBLE_CELL = "ground-cell-000060-14-4826-4483";
const ATTRIBUTION = "Source: NYC Office of Technology and Innovation (OTI) / NYS Statewide Digital Orthoimagery Program, 2024 6-inch true orthoimagery, Manhattan borough. Licensed CC BY 4.0.";

function groundFeature(canonicalFeatureId: string, groundClass: GroundClass): GroundFeature {
  return {
    canonicalFeatureId,
    cityId: "city:manhattan",
    class: groundClass,
    claimLevel: "source-backed",
    sourceRefs: [{
      schemaVersion: "1.0",
      id: `nyc.source:${canonicalFeatureId}`,
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
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporal: "NYC Parks rows updated 2026-07-17." },
    identityOrigin: { kind: "referenced-existing", existingFeatureId: canonicalFeatureId },
  };
}

const parkFeature = groundFeature(PARK_ID, "park");
const roadbedFeature = groundFeature(ROADBED_ID, "roadbed");

function groundOverlayFixture(): LoadedGroundRelease {
  const features = new Map([[PARK_ID, parkFeature], [ROADBED_ID, roadbedFeature]]);
  return {
    releaseId: MANHATTAN_GROUND_RELEASE_ID,
    document: {
      releaseId: MANHATTAN_GROUND_RELEASE_ID,
      generatedAt: "2026-08-24T12:00:00.000Z",
      assets: [],
      claimCeilings: { park: "Source-backed NYC Parks managed-property polygons.", roadbed: "Source-backed roadbed polygons." },
      provenance: { sourceEpoch: "rows updated 2026-07-17", termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "NYC Open Data", disclaimer: "no warranty", localOnly: true, runtimeExternalNetwork: false },
    },
    ledger: { ledgerId: "ground-ledger:test", cityId: "city:manhattan", partitionSchemeId: "ground-partition-v1-level14" },
    features: [parkFeature, roadbedFeature],
    shippedClasses: ["roadbed", "sidewalk", "park", "plaza", "water"],
    partitionTileLevel: 14,
    coverage: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 },
    feature: (canonicalFeatureId: string) => features.get(canonicalFeatureId),
    cell: () => undefined,
    cellIdForTileKey: () => undefined,
    materializedCellIds: [],
    hasArtifact: () => false,
    loadCellClass: () => Promise.reject(new Error("not used in this test")),
    cached: () => undefined,
    retain: () => 0,
    residency: () => ({ entries: 0, bytes: 0, evictions: 0 }),
  } as unknown as LoadedGroundRelease;
}

function imageryOverlayFixture(): LoadedGroundZoneImageryRelease {
  return {
    releaseId: MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID,
    baseReleaseId: MANHATTAN_GROUND_RELEASE_ID,
    captureYear: 2024,
    attribution: ATTRIBUTION,
    provenance: {
      attribution: ATTRIBUTION,
      disclaimer: "Rectangular cell coverage; the zone polygon is the display mask.",
      termsUrl: "NYC OTI aerial-imagery metadata: 'Use Limitations | CC BY 4.0'",
      sourceEpoch: "2024-03-14/2024-03-24",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    generatedAt: "2026-08-26T00:00:00.000Z",
    targetGroundSampleDistanceMeters: 1.2,
    indexChecksumSha256: "f0edab3f06e5123d311ef834e1988be19a26b8b2582de65de5b4f4a5050b80ca",
    entryCount: 87,
    refusals: [],
    entry: () => undefined,
    hasTexture: (_cellId: string, groundClass: GroundClass) => groundClass === "park",
    refusal: () => undefined,
    loadTexture: () => Promise.reject(new Error("not used in this test")),
    cachedTexture: () => undefined,
    retain: () => 0,
    residency: () => ({ entries: 1, bytes: 685_004, evictions: 0 }),
  } as unknown as LoadedGroundZoneImageryRelease;
}

const initialTestUrl = window.location.href;
const origin = new URL(initialTestUrl).origin;
const imageryOffUrl = `${origin}/?zoneImagery=${ZONE_IMAGERY_OFF_VALUE}`;

beforeEach(() => {
  groundMocks.loadGroundRelease.mockReset();
  groundMocks.loadGroundRelease.mockResolvedValue(groundOverlayFixture());
  embellishmentMocks.loadGroundEmbellishmentRelease.mockReset();
  embellishmentMocks.loadGroundEmbellishmentRelease.mockImplementation(async () => { throw new Error("Curbs are not served in this test."); });
  imageryMocks.loadGroundZoneImageryRelease.mockReset();
  imageryMocks.loadGroundZoneImageryRelease.mockResolvedValue(imageryOverlayFixture());
  exteriorMocks.loadExteriorPilotRelease.mockReset();
  exteriorMocks.loadExteriorPilotRelease.mockImplementation(async () => { throw new Error("Exterior release bytes are not served in this test."); });
  citywideMocks.loadCitywideRelease.mockReset();
  citywideMocks.loadCitywideRelease.mockImplementation(async () => { throw new Error("Citywide release bytes are not served in this test."); });
});

afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });

const groundStatus = () => document.querySelector<HTMLElement>("[data-ground-release]");
const attributionLine = () => document.querySelector<HTMLElement>("[data-zone-imagery-release]");
const pick = (label: string) => fireEvent.click([...document.querySelectorAll("button")].find((button) => button.textContent === label)!);

describe("zone orthoimagery in the default view", () => {
  /**
   * AC3's whole claim in one test: a session that asks for nothing gets the
   * drape, the status line names the vintage, and the URL stays silent.
   */
  it("drapes by default, names the vintage on screen, and writes no parameter", async () => {
    expect(ZONE_IMAGERY_DEFAULT_ON).toBe(true);
    window.history.replaceState({}, "", initialTestUrl);
    render(<App />);
    await waitFor(() => expect(document.querySelector("[data-zone-imagery-overlay]")?.getAttribute("data-zone-imagery-overlay")).toBe(MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID));
    expect(imageryMocks.loadGroundZoneImageryRelease).toHaveBeenCalledWith(expect.objectContaining({ releaseId: MANHATTAN_GROUND_RELEASE_ID }), `/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`, expect.anything());
    await waitFor(() => expect(groundStatus()?.textContent).toContain("imagery 2024"));
    expect(groundStatus()!.textContent).toContain("1 zone draped across 1 cell");
    // The flat base's own reading is intact beside it, not replaced by it.
    expect(groundStatus()!.textContent).toContain("2 cells drawn");
    expect(window.location.search).not.toContain("zoneImagery=");
    expect(appendZoneImageryUrl(`${origin}/?featureId=x`, true)).toBe(`${origin}/?featureId=x`);
  });

  /**
   * The always-accessible attribution affordance: present without a click,
   * carrying the licence, both agencies and the capture window.
   */
  it("shows a persistent attribution line while any drape is visible", async () => {
    render(<App />);
    await waitFor(() => expect(attributionLine()).toBeInTheDocument());
    const line = attributionLine()!;
    expect(line.getAttribute("role")).toBe("status");
    expect(line.getAttribute("data-zone-imagery-capture-year")).toBe("2024");
    expect(line.getAttribute("data-zone-imagery-draped-zones")).toBe("1");
    expect(line.textContent).toContain("Orthoimagery 2024");
    expect(line.textContent).toContain("2024-03-14/2024-03-24");
    expect(line.textContent).toContain("CC BY 4.0");
  });

  it("puts capture year, attribution, misregistration and release id in the details panel of a draped zone", async () => {
    render(<App />);
    await waitFor(() => expect(attributionLine()).toBeInTheDocument());
    pick("Mock park pick");
    await waitFor(() => expect(document.querySelector("[data-zone-imagery-feature]")).toBeInTheDocument());
    const block = document.querySelector<HTMLElement>("[data-zone-imagery-feature]")!;
    expect(block.getAttribute("data-zone-imagery-feature")).toBe(PARK_ID);
    expect(block.getAttribute("data-zone-imagery-capture-year")).toBe("2024");
    expect(block.textContent).toContain("2024-03-14/2024-03-24");
    expect(block.textContent).toContain("Licensed CC BY 4.0");
    expect(block.textContent).toContain("roughly one pixel");
    expect(block.textContent).toContain(MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID);
    expect(block.textContent).toContain("1.2 m per pixel");
    // And the polygon's own provenance is still there, unchanged.
    expect(document.querySelector("[data-ground-feature]")?.textContent).toContain("NYC Open Data");
  });

  it("says nothing about imagery in the details of a zone that is not draped", async () => {
    render(<App />);
    await waitFor(() => expect(attributionLine()).toBeInTheDocument());
    pick("Mock roadbed pick");
    await waitFor(() => expect(document.querySelector("[data-ground-feature]")?.getAttribute("data-ground-feature")).toBe(ROADBED_ID));
    expect(document.querySelector("[data-zone-imagery-feature]")).toBeNull();
  });

  /**
   * Pick identity is unchanged by the drape: the same canonical id selects the
   * same feature whether the imagery overlay is present or absent.
   */
  it("does not change what a ground pick resolves to", async () => {
    render(<App />);
    await waitFor(() => expect(attributionLine()).toBeInTheDocument());
    pick("Mock park pick");
    await waitFor(() => expect(document.querySelector("[data-ground-feature]")?.getAttribute("data-ground-feature")).toBe(PARK_ID));
    cleanup();
    window.history.replaceState({}, "", imageryOffUrl);
    render(<App />);
    await waitFor(() => expect(document.querySelector("[data-ground-overlay]")?.getAttribute("data-ground-overlay")).toBe(MANHATTAN_GROUND_RELEASE_ID));
    pick("Mock park pick");
    await waitFor(() => expect(document.querySelector("[data-ground-feature]")?.getAttribute("data-ground-feature")).toBe(PARK_ID));
  });
});

describe("zone orthoimagery opt-out and fail-closed", () => {
  it("opts out on ?zoneImagery=off: no load, no drape, no attribution line, ground untouched", async () => {
    window.history.replaceState({}, "", imageryOffUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    expect(imageryMocks.loadGroundZoneImageryRelease).not.toHaveBeenCalled();
    expect(document.querySelector("[data-zone-imagery-overlay]")?.getAttribute("data-zone-imagery-overlay")).toBe("");
    expect(attributionLine()).toBeNull();
    expect(groundStatus()!.textContent).not.toContain("imagery 2024");
    // The flat base is exactly what it was.
    expect(groundStatus()!.textContent).toContain("2 cells drawn");
    expect(parseZoneImageryRequested(imageryOffUrl)).toBe(false);
    expect(zoneImageryOptOutValue()).toBe(ZONE_IMAGERY_OFF_VALUE);
  });

  it("keeps the ground base and its status line when the imagery layer fails closed", async () => {
    imageryMocks.loadGroundZoneImageryRelease.mockRejectedValue(new Error("Zone imagery index checksum mismatch (aa declared bb); the whole imagery layer was refused."));
    render(<App />);
    await waitFor(() => expect(groundStatus()?.textContent).toContain("index checksum mismatch"));
    expect(groundStatus()!.getAttribute("data-ground-state")).toBe("ready");
    expect(groundStatus()!.textContent).toContain("2 cells drawn");
    expect(groundStatus()!.textContent).toContain("still draw as verified flat polygons");
    expect(attributionLine()).toBeNull();
    expect(document.querySelector("[data-zone-imagery-feature]")).toBeNull();
  });

  it("honours an explicit release-id link in either polarity", () => {
    expect(parseZoneImageryRequested(`${origin}/?zoneImagery=${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}`)).toBe(true);
    // A stale link to some other imagery release resolves to the DEFAULT rather
    // than to a release this build cannot verify.
    expect(parseZoneImageryRequested(`${origin}/?zoneImagery=manhattan-ground-zone-imagery-29991231`)).toBe(ZONE_IMAGERY_DEFAULT_ON);
    expect(appendZoneImageryUrl(`${origin}/?featureId=x`, false)).toContain(`zoneImagery=${ZONE_IMAGERY_OFF_VALUE}`);
  });

  it("offers a way back from the opt-out rather than a one-way door", async () => {
    window.history.replaceState({}, "", imageryOffUrl);
    render(<App />);
    await waitFor(() => expect(groundStatus()?.getAttribute("data-ground-state")).toBe("ready"));
    const toggle = [...document.querySelectorAll("button")].find((button) => button.textContent === "Enable orthoimagery")!;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(attributionLine()).toBeInTheDocument());
    expect(window.location.search).not.toContain("zoneImagery=");
  });

  it("never implies the polygons went away when only the drape did", () => {
    expect(groundZoneImageryFailureMessage(new Error("Zone imagery texture checksum mismatch."))).toContain("parks, plazas and water still draw as verified flat polygons");
  });
});
