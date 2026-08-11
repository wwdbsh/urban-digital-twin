// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import type { Feature } from "../domain/schema";
import type { CameraPose } from "../domain/visitor-navigation";
import type { CommercialStorefrontPlacement, LoadedExteriorPilotRelease } from "../runtime/exterior-pilot-release";

const exteriorRuntimeMocks = vi.hoisted(() => ({
  loadExteriorPilotRelease: vi.fn(),
}));

const citywideRuntimeMocks = vi.hoisted(() => ({
  loadCitywideRelease: vi.fn(),
}));

/**
 * Rollback rehearsal seam. `<App />` reads the promotion record through this
 * live binding and passes it into the activation functions, so setting
 * `record` to the predecessor here rehearses the exact one-line rollback edit
 * without touching a release byte.
 */
const promotionMocks = vi.hoisted(() => ({ record: null as unknown }));

vi.mock("../features/explorer/CesiumViewport", async () => {
  const React = await import("react");

  type MockProps = {
    adapter: { getFeatures: () => Feature[] };
    focusRequest: number;
    focusFeatureId: string | null;
    focusOverlayOpen?: boolean;
    cameraPoseRequest?: { longitude: number; latitude: number; height: number; heading: number; pitch: number; roll: number; requestId: number };
    exteriorOverlay?: unknown;
    onFeatureSelected?: (feature: Feature) => void;
    onCameraChanged?: (camera: CameraPose) => void;
    onStorefrontSelected?: (placement: CommercialStorefrontPlacement) => void;
  };

  const MockCesiumViewport = ({ adapter, focusRequest, focusFeatureId, focusOverlayOpen, cameraPoseRequest, exteriorOverlay, onFeatureSelected, onCameraChanged, onStorefrontSelected }: MockProps) => {
    const [cameraCallbackSetupCount, setCameraCallbackSetupCount] = React.useState(0);
    React.useEffect(() => { setCameraCallbackSetupCount((count) => count + 1); }, [onCameraChanged]);
    const locatedFeature = adapter.getFeatures().find((feature) => feature.kind === "poi") ?? adapter.getFeatures()[0]!;
    const locationlessFeature: Feature = {
      ...locatedFeature,
      id: `${locatedFeature.id}:locationless-test`,
      name: "Locationless test record",
      attributes: { ...locatedFeature.attributes, civicNoMarker: true },
    };
    // The real projection is reused, so this counts exactly the verified exterior
    // assets the scene would build; a cell that failed verification contributes none.
    const exteriorRenderEntryCount = (actual.exteriorOverlayRenderEntries as (overlay: unknown) => unknown[])(exteriorOverlay).length;
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-focus-request": focusRequest,
        "data-focus-feature-id": focusFeatureId ?? "",
        "data-focus-overlay-open": focusOverlayOpen ? "true" : "false",
        "data-camera-pose-request": cameraPoseRequest ? `${cameraPoseRequest.longitude},${cameraPoseRequest.latitude},${cameraPoseRequest.height},${cameraPoseRequest.pitch},${cameraPoseRequest.requestId}` : "",
        "data-camera-callback-setup-count": cameraCallbackSetupCount,
        "data-exterior-render-entry-count": exteriorRenderEntryCount,
      },
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locatedFeature) }, "Mock located pick"),
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locationlessFeature) }, "Mock locationless pick"),
      React.createElement("button", { type: "button", onClick: () => onStorefrontSelected?.({ canonicalBuildingId: locatedFeature.id, storefrontId: "storefront:osm:node:10908810995@1" } as CommercialStorefrontPlacement) }, "Mock storefront pick"),
      React.createElement("button", { type: "button", onClick: () => onCameraChanged?.({ longitude: -73.99, latitude: 40.748, height: 900, heading: 15, pitch: -45, roll: 0 }) }, "Mock camera update"),
    );
  };

  const actual = await vi.importActual("../features/explorer/CesiumViewport") as Record<string, unknown>;

  return {
    ...actual,
    CesiumViewport: MockCesiumViewport,
    medianFrameInterval: (values: readonly number[]) => values.length === 0 ? null : values[0] ?? null,
    shouldFocusFeature: (feature: Pick<Feature, "attributes"> | null | undefined) => Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true),
  };
});

vi.mock("../runtime/exterior-pilot-release", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadExteriorPilotRelease: exteriorRuntimeMocks.loadExteriorPilotRelease };
});

// The 291 MB citywide release is not served to jsdom, so the loader is stubbed.
// The default stub reproduces what these tests already saw (an unavailable
// release); only the clean-load ordering test supplies a base adapter.
vi.mock("../runtime/citywide-release-runtime", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadCitywideRelease: citywideRuntimeMocks.loadCitywideRelease };
});

vi.mock("../runtime/exterior-default-activation", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    // A getter, so a rehearsal can swap the record between renders. It returns
    // the real committed record unless a test opts into the predecessor.
    get EXTERIOR_DEFAULT_ACTIVATION() { return promotionMocks.record ?? actual.EXTERIOR_DEFAULT_ACTIVATION; },
  };
});

import { App, EXTERIOR_CELL_STREAMING_RELEASE_ID, PINNED_EXTERIOR_CELL_RELEASE_IDS, appendBlock835PublicRealmUrl, appendExteriorProfileUrl, exteriorCellBasePath, exteriorCanarySnapshotMessage, exteriorDeepLinkMessage, exteriorSnapshotOriginLabel, isPinnedExteriorCellRelease, exteriorStreamingActivation, exteriorStreamingFailureMessage, exteriorStreamingNotices, parseExteriorStreamingUrl, applyStorefrontResolution, block835PerformanceGate, block835PerformanceProbeMode, block835PublicRealmActivation, block835PublicRealmFailureMessage, isCurrentStorefrontResolution, overlayLayoutPolicy, preserveFeatureSequence, resolveStorefrontBuilding, selectionFocusTransaction, summarizeBlock835Frames, type StorefrontResolutionState } from "./App";
import { EXTERIOR_DEFAULT_ACTIVATION } from "../runtime/exterior-default-activation";
import { navigationUrl, parseNavigationUrl } from "../domain/visitor-navigation";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { CITYWIDE_RELEASE_ID } from "../release/citywide-release";
import type { CitywideReleaseAdapter, CitywideRuntimeMetrics } from "../runtime/citywide-release-runtime";

const initialTestUrl = window.location.href;
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function exteriorOverlayFixture(assetFailures: LoadedExteriorPilotRelease["assetFailures"] = []): LoadedExteriorPilotRelease {
  return {
    document: { commercialRelease: { totals: { acceptedSigns: 8 } } },
    manifest: { assets: [] },
    resolver: {},
    verifiedContentRefs: new Set(),
    assetFailures,
    diagnostics: { overlay: "active", reason: null, assetFailures: [...assetFailures], buildingFallbacks: [...new Set(assetFailures.map((failure) => failure.canonicalFeatureId))], acceptedStorefronts: 8, unknownStorefronts: 72, ambiguousStorefronts: 12 },
    compatibleWith: () => true,
    resolve: () => ({ kind: "procedural-fallback", featureId: "doitt:778052", diagnostic: { message: "Fixture fallback" } }),
    buildingEntry: () => undefined,
    commercialForBuilding: () => ({ canonicalBuildingId: "doitt:778052", visualEvidenceLevel: "licensed-near-real", claim: "Fixture", entry: undefined, links: [], placements: [], unknownPlacements: [], acceptedPlacements: [] }),
    storefront: () => undefined,
  } as unknown as LoadedExteriorPilotRelease;
}

beforeEach(() => {
  promotionMocks.record = null;
  exteriorRuntimeMocks.loadExteriorPilotRelease.mockReset();
  exteriorRuntimeMocks.loadExteriorPilotRelease.mockResolvedValue(exteriorOverlayFixture());
  citywideRuntimeMocks.loadCitywideRelease.mockReset();
  citywideRuntimeMocks.loadCitywideRelease.mockImplementation(async () => { throw new Error("Citywide release bytes are not served in this test."); });
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });
const locatedFeature = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

/** The V2 canary release. Still pinned and still reachable by explicit opt-in. */
const CANARY_EXTERIOR_RELEASE_ID = "manhattan-exterior-cells-20260811";
const CANARY_EXTERIOR_ROOT = `/data/${CANARY_EXTERIOR_RELEASE_ID}/`;
/** The V3 successor, which is what this build promotes as the Block 835 default. */
const PROMOTED_EXTERIOR_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const PROMOTED_EXTERIOR_ROOT = `/data/${PROMOTED_EXTERIOR_RELEASE_ID}/`;
const MIDTOWN_CORE_EXTERIOR_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const MIDTOWN_CORE_EXTERIOR_ROOT = `/data/${MIDTOWN_CORE_EXTERIOR_RELEASE_ID}/`;
const BLOCK_835_FEATURE_IDS = [...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`);

/**
 * Serves the COMMITTED canary release bytes from `public/` so the App drives the
 * real exterior runtime. Everything else fails closed exactly as it does when a
 * local release is absent.
 */
function serveCommittedCanaryRelease() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    // Both Block 835 releases are served: the promoted V3 successor and the V2
    // release its explicit opt-in links still name.
    if (!path.startsWith(CANARY_EXTERIOR_ROOT) && !path.startsWith(PROMOTED_EXTERIOR_ROOT)) return new Response(null, { status: 404 });
    try {
      return new Response(new Uint8Array(readFileSync(`public${path}`)), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

const ZERO_CITYWIDE_METRICS = {
  visibleShardCount: 0, requestedShardCount: 0, loadedFeatureCount: 0, loadedBytes: 0,
  maxConcurrentRequests: 6, activeRequests: 0, failedRequestCount: 0, cancelledRequestCount: 0,
  staleResultCount: 0, retainedSummaryCount: 0, retainedFeatureCount: 0, retainedDetailCount: 0,
  detailIndexEntryCount: BLOCK_835_FEATURE_IDS.length, cacheEntries: 0, cacheEvictions: 0, dedupedRefreshCount: 0,
} as unknown as CitywideRuntimeMetrics;

/**
 * A citywide base adapter with the shape that matters for exterior activation:
 * membership is provable from the checksum-verified detail index, while nothing
 * in Block 835 is resident because the camera has never streamed those shards.
 */
function lateCitywideBaseAdapter(memberIds: readonly string[]) {
  const identityIndex = new Set<string>();
  let ensureCalls = 0;
  const adapter = {
    releaseId: CITYWIDE_RELEASE_ID,
    fixtureOnly: false,
    // Camera-elsewhere clean load: no Block 835 building is resident.
    getFeature: () => undefined,
    // One resident summary keeps the mocked viewport's pick harness usable; it
    // is deliberately not a Block 835 building.
    getFeatures: () => [locatedFeature],
    search: () => [],
    searchAsync: async () => [],
    refreshViewport: async () => [],
    loadDetail: async () => undefined,
    getMetrics: () => ZERO_CITYWIDE_METRICS,
    destroy: () => {},
    ensureIdentityIndex: async () => { ensureCalls += 1; for (const id of memberIds) identityIndex.add(id); return identityIndex.size; },
    hasIdentityMember: (featureId: string) => identityIndex.has(featureId),
  };
  return { adapter: adapter as unknown as CitywideReleaseAdapter, ensureCalls: () => ensureCalls };
}

describe("explorer overlay policy", () => {
  it("parses only the two deterministic external-browser performance probe modes", () => {
    expect(block835PerformanceProbeMode("?block835Performance=stage3-only")).toBe("stage3-only");
    expect(block835PerformanceProbeMode("?block835Performance=stage3-plus-public-realm")).toBe("stage3-plus-public-realm");
    expect(block835PerformanceProbeMode("?block835Performance=unsupported")).toBeNull();
    expect(block835PerformanceProbeMode("")).toBeNull();
  });

  it("summarizes deterministic frame samples and enforces the unchanged overlay gates", () => {
    expect(summarizeBlock835Frames([10, 20, 30, 40])).toEqual({ sampleCount: 4, medianMs: 25, p95Ms: 40, maxMs: 40 });
    expect(block835PerformanceGate({ medianMs: 12, p95Ms: 30 }, { p95Ms: 25 })).toMatchObject({
      p95DeltaMs: 5,
      p95Regression: 0.2,
      overlayMedianPass: true,
      overlayP95Pass: true,
      p95RegressionPass: true,
      pass: true,
    });
    expect(block835PerformanceGate({ medianMs: 12.01, p95Ms: 30.01 }, { p95Ms: 25 })).toMatchObject({ pass: false });
  });

  it("fails closed when a bare publicRealm URL has no genuinely active real base or Stage 3 exterior", () => {
    const activation = block835PublicRealmActivation({
      requested: true,
      loadState: "ready",
      hasVerifiedOverlay: true,
      activeBaseReleaseId: null,
      exteriorActive: false,
      compatibleWithActiveBase: false,
    });

    expect(activation.active).toBe(false);
    expect(activation.prerequisiteMessage).toContain("requires an active compatible real base");
    expect(activation.prerequisiteMessage).toContain("active Stage 3 exterior/commercial overlay");
  });

  it("activates public realm only with a compatible active real base and active Stage 3 exterior", () => {
    expect(block835PublicRealmActivation({
      requested: true,
      loadState: "ready",
      hasVerifiedOverlay: true,
      activeBaseReleaseId: "manhattan-civic-context-20260804",
      exteriorActive: true,
      compatibleWithActiveBase: true,
    })).toEqual({ active: true, prerequisiteMessage: null });

    expect(block835PublicRealmActivation({
      requested: true,
      loadState: "ready",
      hasVerifiedOverlay: true,
      activeBaseReleaseId: "manhattan-incompatible-base",
      exteriorActive: true,
      compatibleWithActiveBase: false,
    }).active).toBe(false);
  });

  it("keeps public-realm fault status truthful when Stage 3 was never active", () => {
    expect(block835PublicRealmFailureMessage(new Error("Public-realm request failed (503)."))).toBe(
      "Public-realm request failed (503). The public-realm overlay was disabled; the existing base/exterior state was left unchanged.",
    );
    expect(block835PublicRealmFailureMessage(null)).toContain("The public-realm overlay was disabled; the existing base/exterior state was left unchanged.");
    expect(block835PublicRealmFailureMessage(null)).not.toContain("buildings/storefronts remain active");
  });

  it("round-trips the additive Block 835 public-realm URL state without touching base release parameters", () => {
    const canonical = appendBlock835PublicRealmUrl(
      navigationUrl({ featureId: "doitt:778052", query: "empire", cameraMode: "overview", pose: null, poseInvalid: false, dataMode: "fixtures", releaseId: null }, initialTestUrl),
      true,
      "crosswalk:intersection-1",
    );
    const parsed = new URL(canonical);
    expect(parsed.searchParams.get("feature")).toBe("doitt:778052");
    expect(parsed.searchParams.get("publicRealm")).toBe("manhattan-esb-block-public-realm-20260806");
    expect(parsed.searchParams.get("publicRealmFeature")).toBe("crosswalk:intersection-1");
    const disabled = new URL(appendBlock835PublicRealmUrl(canonical, false, null));
    expect(disabled.searchParams.has("publicRealm")).toBe(false);
    expect(disabled.searchParams.has("publicRealmFeature")).toBe(false);
    expect(disabled.searchParams.get("feature")).toBe("doitt:778052");
  });

  it("keeps the map as the desktop main region while reserving only overlay insets", () => {
    expect(overlayLayoutPolicy(false, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "inspector-width",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, true)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "inspector-sheet",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
  });

  it("claims exactly one focus transaction for a locatable selection", () => {
    expect(selectionFocusTransaction(locatedFeature)).toEqual({ focusFeatureId: locatedFeature.id, shouldFly: true });
  });

  it("opens locationless records without claiming a camera transaction", () => {
    const locationless = { ...locatedFeature, attributes: { ...locatedFeature.attributes, civicNoMarker: true } };
    expect(selectionFocusTransaction(locationless)).toEqual({ focusFeatureId: null, shouldFly: false });
  });

  it("does not retain an ID-only sequence when a same-ID feature receives new geometry or detail content", () => {
    const revisedCoordinates: Feature["coordinates"] = [locatedFeature.coordinates[0] + 0.001, locatedFeature.coordinates[1]];
    const revised: Feature = {
      ...locatedFeature,
      name: "Revised same-ID feature",
      coordinates: revisedCoordinates,
      geometry: locatedFeature.geometry.type === "Point" ? { ...locatedFeature.geometry, coordinates: revisedCoordinates } : locatedFeature.geometry,
      attributes: { ...locatedFeature.attributes, refreshedDetail: "new-content" },
    };
    const previous = [locatedFeature];
    const retained = preserveFeatureSequence(previous, [revised]);
    expect(retained).not.toBe(previous);
    expect(retained).toEqual([revised]);
  });

  it("loads a missing canonical building before resolving a storefront selection", async () => {
    const canonical = { ...locatedFeature, id: "doitt:982383" };
    const loadCanonical = vi.fn().mockResolvedValue(canonical);
    const adapter = { getFeature: vi.fn(() => undefined) };
    await expect(resolveStorefrontBuilding({ canonicalBuildingId: canonical.id }, adapter, loadCanonical)).resolves.toBe(canonical);
    expect(loadCanonical).toHaveBeenCalledWith(canonical.id);
  });

  it("ignores a stale storefront completion after a newer storefront selection", async () => {
    const adapter = {};
    const featureA = { ...locatedFeature, id: "doitt:storefront-a" };
    const featureB = { ...locatedFeature, id: "doitt:storefront-b" };
    const pendingA = deferred<Feature | undefined>();
    const pendingB = deferred<Feature | undefined>();
    let current: StorefrontResolutionState = { requestId: 0, adapter, dataMode: "real-pilot" };
    const state: { featureId: string | null; storefrontId: string | null; url: string } = { featureId: null, storefrontId: null, url: "" };
    const begin = (storefrontId: string, resolution: Promise<Feature | undefined>) => {
      current = { requestId: current.requestId + 1, adapter, dataMode: "real-pilot" };
      const request = current;
      return applyStorefrontResolution(request, () => current, resolution, (building) => {
        state.featureId = building?.id ?? null;
        state.storefrontId = building ? storefrontId : null;
        state.url = building ? `?feature=${building.id}&storefront=${storefrontId}` : "";
      });
    };

    const first = begin("storefront:A", pendingA.promise);
    const second = begin("storefront:B", pendingB.promise);
    pendingB.resolve(featureB);
    await second;
    pendingA.resolve(featureA);
    await first;

    expect(state).toEqual({ featureId: featureB.id, storefrontId: "storefront:B", url: `?feature=${featureB.id}&storefront=storefront:B` });
  });

  it("ignores stale success and rejection after an ordinary selection invalidates the request", async () => {
    const adapter = {};
    const nextAdapter = {};
    const staleFeature = { ...locatedFeature, id: "doitt:stale-storefront" };
    const pendingSuccess = deferred<Feature | undefined>();
    let current: StorefrontResolutionState = { requestId: 1, adapter, dataMode: "real-pilot" };
    const state: { featureId: string | null; storefrontId: string | null; url: string } = { featureId: null, storefrontId: "storefront:A", url: "?feature=doitt:old&storefront=storefront:A" };
    const staleRequest = current;
    const success = applyStorefrontResolution(staleRequest, () => current, pendingSuccess.promise, (building) => {
      state.featureId = building?.id ?? null;
      state.storefrontId = building ? "storefront:A" : null;
      state.url = building ? `?feature=${building.id}&storefront=storefront:A` : "";
    });

    current = { requestId: 2, adapter: nextAdapter, dataMode: "civic-context" };
    state.featureId = "doitt:ordinary-selection";
    state.storefrontId = null;
    state.url = "?feature=doitt:ordinary-selection";
    pendingSuccess.resolve(staleFeature);
    await success;
    expect(state).toEqual({ featureId: "doitt:ordinary-selection", storefrontId: null, url: "?feature=doitt:ordinary-selection" });
    expect(isCurrentStorefrontResolution(staleRequest, current)).toBe(false);

    const pendingFailure = deferred<Feature | undefined>();
    const failingRequest = current;
    const failure = applyStorefrontResolution(failingRequest, () => current, pendingFailure.promise, () => {
      state.featureId = "doitt:should-not-commit";
      state.storefrontId = "storefront:should-not-commit";
      state.url = "?feature=doitt:should-not-commit&storefront=storefront:should-not-commit";
    });
    current = { requestId: 3, adapter: nextAdapter, dataMode: "civic-context" };
    pendingFailure.reject(new Error("stale failure"));
    await failure;
    expect(state).toEqual({ featureId: "doitt:ordinary-selection", storefrontId: null, url: "?feature=doitt:ordinary-selection" });
    expect(isCurrentStorefrontResolution(failingRequest, current)).toBe(false);
  });
});

describe("App overlay and selection regressions", () => {
  it("keeps a selected storefront in the URL after a camera update without rebuilding the viewport callback", async () => {
    const storefrontId = "storefront:osm:node:10908810995@1";
    window.history.replaceState({}, "", `/?exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1`);
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    expect(viewport).not.toBeNull();
    await waitFor(() => expect(viewport).toHaveAttribute("data-camera-callback-setup-count", "1"));
    fireEvent.click(screen.getByRole("button", { name: "Mock storefront pick" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    const callbackSetupCount = viewport?.getAttribute("data-camera-callback-setup-count");

    fireEvent.click(screen.getByRole("button", { name: "Mock camera update" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    expect(viewport).toHaveAttribute("data-camera-callback-setup-count", callbackSetupCount);
  });

  it("keeps the optional commercial overlay and storefront deep-link separate from the base release", () => {
    const url = navigationUrl({ featureId: "doitt:778052", query: "", cameraMode: "overview", pose: null, poseInvalid: false, dataMode: "civic-context", releaseId: "manhattan-civic-context-20260804", exteriorReleaseId: "manhattan-esb-block-exterior-pilot-20260805", commercial: true, storefrontId: "storefront:osm:node:1@2" }, "http://localhost/");
    const parsed = parseNavigationUrl(url);
    expect(parsed.releaseId).toBe("manhattan-civic-context-20260804");
    expect(parsed.exteriorReleaseId).toBe("manhattan-esb-block-exterior-pilot-20260805");
    expect(parsed.commercial).toBe(true);
    expect(parsed.storefrontId).toBe("storefront:osm:node:1@2");
  });

  it("requests the normalized URL pose or safe default on the first viewport render", () => {
    render(<App />);

    expect(document.querySelector(".viewport")).toHaveAttribute("data-camera-pose-request", "-73.991,40.744,4000,-75,1");
    const cameraControls = within(screen.getByRole("region", { name: "Camera controls" }));
    expect(cameraControls.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    expect(cameraControls.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the inspector inside the map region and claims one focus request for a direct pick", async () => {
    render(<App />);

    const mapRegion = document.querySelector<HTMLElement>(".map-region");
    const viewport = document.querySelector<HTMLElement>(".viewport");
    const inspector = screen.getByRole("complementary", { name: "Selected feature details" });
    expect(mapRegion).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(mapRegion).toContainElement(viewport);
    expect(mapRegion).toContainElement(inspector);

    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock located pick" }));
    await waitFor(() => expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick + 1)));
    expect(viewport).toHaveAttribute("data-focus-feature-id", locatedFeature.id);
  });

  it("closes details with Escape and returns focus to the located-pick trigger", async () => {
    render(<App />);

    const trigger = screen.getByRole("button", { name: "Mock located pick" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Selected feature details" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps locationless picks in details without incrementing the focus transaction", async () => {
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock locationless pick" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Locationless test record"));
    expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick));
    expect(viewport).toHaveAttribute("data-focus-feature-id", "");
  });

  it("starts diagnostics and directions collapsed and makes their expanded surfaces mutually exclusive", async () => {
    render(<App />);

    const diagnostics = screen.getByRole("button", { name: /Diagnostics.*Runtime health/ });
    const directions = screen.getByRole("button", { name: /Directions.*Plan a synthetic route/ });
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
    expect(directions).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(diagnostics);
    expect(diagnostics).toHaveAttribute("aria-expanded", "true");
    expect(directions).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(directions);
    await waitFor(() => expect(directions).toHaveAttribute("aria-expanded", "true"));
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["tenant-placement", "Exterior overlay manifest failed closed: commercialRelease.storefrontPlacements Accepted storefront placement must reference one canonical tenant"],
    ["odbl-partition", "Exterior overlay manifest failed closed: commercialRelease.licensePartitions.odbl-derived ODbL partition must include exact attribution"],
    ["base-compatibility", "Exterior overlay manifest failed closed: baseReleaseId Exterior release must pin an approved citywide/civic base release"],
  ])("keeps the base/civic surface usable when the %s fault fails the overlay closed", async (fault, message) => {
    exteriorRuntimeMocks.loadExteriorPilotRelease.mockRejectedValueOnce(new Error(message));
    window.history.replaceState({}, "", `/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=${fault}`);
    render(<App />);

    const status = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-overlay-status='failed'] [role='status']");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(status).toHaveTextContent(`${message} The untouched base/civic release remains active.`);
    expect(document.querySelector(".viewport")).toBeInTheDocument();
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease).toHaveBeenCalledWith(
      "/data/manhattan-esb-block-exterior-pilot-20260805/",
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("keeps exactly one GLB fallback localized in the development fault journey", async () => {
    exteriorRuntimeMocks.loadExteriorPilotRelease.mockResolvedValueOnce(exteriorOverlayFixture([{
      canonicalFeatureId: "doitt:778052",
      lod: "lod0",
      relativeContentRef: "assets/manhattan-esb-block-exterior-pilot-20260805/doitt-778052__lod_0.glb",
      code: "checksum-mismatch",
      message: "Injected one-GLB response corruption; procedural building fallback remains active.",
    }]));
    window.history.replaceState({}, "", "/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=one-glb");
    render(<App />);

    const status = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-overlay-status='ready'] [role='status']");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(status).toHaveTextContent("Exterior overlay active with 1 asset fallback; the affected building remains procedural.");
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease.mock.calls[0]?.[2]).toEqual(expect.any(Function));
  });

  it("treats unsupported exteriorFault values as an inert production-equivalent query", async () => {
    window.history.replaceState({}, "", "/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=unsupported");
    render(<App />);
    await waitFor(() => expect(exteriorRuntimeMocks.loadExteriorPilotRelease).toHaveBeenCalled());
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease.mock.calls[0]?.[2]).toBeUndefined();
  });
});

describe("exterior streaming profiles and canary state", () => {
  const canonicalUrl = (overlayState: { requested: boolean; override?: "on" | "off" | null; releaseId?: string; profile: "exploration" | "inspection"; canarySnapshotId: string | null }) =>
    appendExteriorProfileUrl(
      appendBlock835PublicRealmUrl(
        navigationUrl({ featureId: "doitt:778052", query: "empire", cameraMode: "explore", pose: { longitude: -73.99, latitude: 40.748, height: 700, heading: 15, pitch: -35, roll: 0 }, poseInvalid: false, dataMode: "civic-context", releaseId: "manhattan-civic-context-20260804" }, initialTestUrl),
        true,
        "crosswalk:intersection-1",
      ),
      {
        override: overlayState.override === undefined ? (overlayState.requested ? "on" : null) : overlayState.override,
        streaming: overlayState.requested,
        releaseId: overlayState.releaseId ?? "udt-fixture-exterior-cells",
        profile: overlayState.profile,
        canarySnapshotId: overlayState.canarySnapshotId,
      },
    );

  it("preserves every base and public-realm parameter when profile and canary parameters are appended", () => {
    const base = new URL(canonicalUrl({ requested: false, profile: "exploration", canarySnapshotId: null }));
    const withProfile = new URL(canonicalUrl({ requested: true, profile: "inspection", canarySnapshotId: "snapshot:v3" }));
    for (const key of ["feature", "q", "camera", "lon", "lat", "height", "heading", "pitch", "roll", "data", "release", "publicRealm", "publicRealmFeature"]) {
      expect(withProfile.searchParams.get(key), key).toBe(base.searchParams.get(key));
    }
    expect(withProfile.searchParams.get("exteriorCells")).toBe("udt-fixture-exterior-cells");
    expect(withProfile.searchParams.get("exteriorProfile")).toBe("inspection");
    expect(withProfile.searchParams.get("exteriorCanary")).toBe("snapshot:v3");
  });

  it("changes only the profile parameter when the render profile switches", () => {
    const exploration = new URL(canonicalUrl({ requested: true, profile: "exploration", canarySnapshotId: null }));
    const inspection = new URL(canonicalUrl({ requested: true, profile: "inspection", canarySnapshotId: null }));
    const difference = [...inspection.searchParams.keys()].filter((key) => inspection.searchParams.get(key) !== exploration.searchParams.get(key));
    expect(difference).toEqual(["exteriorProfile"]);
    expect([...inspection.searchParams.keys()].sort()).toEqual([...exploration.searchParams.keys()].sort());
  });

  it("round-trips profile and canary state and clears all three when streaming is explicitly disabled", () => {
    const enabled = canonicalUrl({ requested: true, profile: "inspection", canarySnapshotId: "snapshot:v3" });
    expect(parseExteriorStreamingUrl(enabled)).toEqual({ override: "on", explicitReleaseId: "udt-fixture-exterior-cells", profile: "inspection", canarySnapshotId: "snapshot:v3" });
    const disabled = new URL(appendExteriorProfileUrl(enabled, { override: "off", streaming: false, releaseId: "udt-fixture-exterior-cells", profile: "inspection", canarySnapshotId: "snapshot:v3" }));
    expect(disabled.searchParams.has("exteriorCells")).toBe(false);
    expect(disabled.searchParams.has("exteriorProfile")).toBe(false);
    expect(disabled.searchParams.has("exteriorCanary")).toBe(false);
    // The distinct disable sentinel: "which release" and "no release at all" are
    // different questions, so an explicit off is not an absent parameter.
    expect(disabled.searchParams.get("exteriorStreaming")).toBe("off");
    expect(parseExteriorStreamingUrl(disabled.toString())).toEqual({ override: "off", explicitReleaseId: null, profile: "exploration", canarySnapshotId: null });
    expect(disabled.searchParams.get("publicRealm")).toBe("manhattan-esb-block-public-realm-20260806");
    expect(disabled.searchParams.get("feature")).toBe("doitt:778052");
  });

  it("serializes no exterior parameter for an untouched default-on session, and still shares a chosen profile", () => {
    // The promoted default is not URL state, so a default-on session must not
    // acquire exterior parameters just by streaming.
    const untouched = new URL(canonicalUrl({ requested: true, override: null, releaseId: CANARY_EXTERIOR_RELEASE_ID, profile: "exploration", canarySnapshotId: null }));
    expect(untouched.searchParams.has("exteriorCells")).toBe(false);
    expect(untouched.searchParams.has("exteriorStreaming")).toBe(false);
    expect(untouched.searchParams.has("exteriorProfile")).toBe(false);

    // A profile the user actually chose is still explicit intent, so it round-trips.
    const chosen = new URL(canonicalUrl({ requested: true, override: null, releaseId: CANARY_EXTERIOR_RELEASE_ID, profile: "inspection", canarySnapshotId: null }));
    expect(chosen.searchParams.get("exteriorProfile")).toBe("inspection");
    expect(chosen.searchParams.has("exteriorCells")).toBe(false);
    expect(parseExteriorStreamingUrl(chosen.toString())).toEqual({ override: null, explicitReleaseId: null, profile: "inspection", canarySnapshotId: null });
  });

  it("ignores an unknown exterior release ID and an unsupported profile instead of guessing", () => {
    // An unpinned release fails closed to an explicit off, so a link naming a
    // release this build does not have is never answered with the promoted one.
    expect(parseExteriorStreamingUrl("/?exteriorCells=manhattan-exterior-production&exteriorProfile=inspection")).toEqual({ override: "off-unpinned", explicitReleaseId: null, profile: "exploration", canarySnapshotId: null });
    expect(parseExteriorStreamingUrl("/?exteriorCells=udt-fixture-exterior-cells&exteriorProfile=cinematic")).toEqual({ override: "on", explicitReleaseId: "udt-fixture-exterior-cells", profile: "exploration", canarySnapshotId: null });
    expect(parseExteriorStreamingUrl("/?exteriorCanary=snapshot:v3")).toEqual({ override: null, explicitReleaseId: null, profile: "exploration", canarySnapshotId: null });
  });

  it("keeps an explicit disable dominant over every other exterior parameter", () => {
    expect(parseExteriorStreamingUrl("/?exteriorStreaming=off&exteriorCells=manhattan-exterior-cells-20260811&exteriorProfile=inspection&exteriorCanary=snapshot:v3"))
      .toEqual({ override: "off", explicitReleaseId: null, profile: "exploration", canarySnapshotId: null });
    const message = exteriorDeepLinkMessage("/?exteriorStreaming=on");
    expect(message).toContain("exteriorStreaming=on is not supported");
    expect(message).toContain("only exteriorStreaming=off disables the exterior wave");
    expect(exteriorDeepLinkMessage("/?exteriorStreaming=off")).toBeNull();
  });

  it("round-trips the pinned Manhattan release and keeps the fixture as the no-real-base fallback", () => {
    expect(PINNED_EXTERIOR_CELL_RELEASE_IDS).toEqual(["udt-fixture-exterior-cells", "manhattan-exterior-cells-20260811", "manhattan-exterior-cells-20260811-v3", "manhattan-midtown-core-cells-20260811", "manhattan-midtown-core-cells-20260811-v3"]);
    // Unchanged: this is the fallback for a session with no real base, not the
    // promoted default. The promoted default lives in EXTERIOR_DEFAULT_ACTIVATION.
    expect(EXTERIOR_CELL_STREAMING_RELEASE_ID).toBe("udt-fixture-exterior-cells");
    expect(EXTERIOR_DEFAULT_ACTIVATION.releaseId).toBe("manhattan-exterior-cells-20260811-v3");
    expect(isPinnedExteriorCellRelease(EXTERIOR_DEFAULT_ACTIVATION.releaseId)).toBe(true);
    expect(isPinnedExteriorCellRelease("manhattan-exterior-cells-20260811")).toBe(true);
    expect(isPinnedExteriorCellRelease("manhattan-exterior-production")).toBe(false);
    expect(exteriorCellBasePath("manhattan-exterior-cells-20260811")).toBe("/data/manhattan-exterior-cells-20260811/");

    const canary = new URL(canonicalUrl({ requested: true, releaseId: "manhattan-exterior-cells-20260811", profile: "inspection", canarySnapshotId: "snapshot:v3" }));
    expect(canary.searchParams.get("exteriorCells")).toBe("manhattan-exterior-cells-20260811");
    expect(parseExteriorStreamingUrl(canary.toString())).toEqual({ override: "on", explicitReleaseId: "manhattan-exterior-cells-20260811", profile: "inspection", canarySnapshotId: "snapshot:v3" });
    expect(canary.searchParams.get("feature")).toBe("doitt:778052");
    expect(canary.searchParams.get("publicRealm")).toBe("manhattan-esb-block-public-realm-20260806");
    expect(exteriorDeepLinkMessage(canary.toString())).toBeNull();
  });

  it("fails closed and stays loud when the URL names a release outside the allowlist", () => {
    const state = parseExteriorStreamingUrl("/?exteriorCells=manhattan-exterior-cells-20270101&exteriorProfile=inspection");
    // A parse that failed closed is its own state: no wave, but nobody switched
    // anything off, so the details panel must not report it as a user's disable.
    expect(state.override).toBe("off-unpinned");
    expect(state.explicitReleaseId).toBeNull();
    const message = exteriorDeepLinkMessage("/?exteriorCells=manhattan-exterior-cells-20270101&exteriorProfile=inspection");
    expect(message).toContain("manhattan-exterior-cells-20270101");
    expect(message).toContain("is not pinned by this build");
  });

  it("fails closed when exterior streaming has no compatible active base release", () => {
    expect(exteriorStreamingActivation({ requested: true, loadState: "ready", hasVerifiedRuntime: true, activeBaseReleaseId: null, compatibleWithActiveBase: false }))
      .toEqual({ active: false, prerequisiteMessage: expect.stringContaining("requires an active base release") });
    expect(exteriorStreamingActivation({ requested: true, loadState: "ready", hasVerifiedRuntime: true, activeBaseReleaseId: "manhattan-citywide-20260804", compatibleWithActiveBase: false }).active).toBe(false);
    expect(exteriorStreamingActivation({ requested: true, loadState: "failed", hasVerifiedRuntime: false, activeBaseReleaseId: "manhattan-citywide-20260804", compatibleWithActiveBase: true }))
      .toEqual({ active: false, prerequisiteMessage: null });
    expect(exteriorStreamingActivation({ requested: true, loadState: "ready", hasVerifiedRuntime: true, activeBaseReleaseId: "manhattan-citywide-20260804", compatibleWithActiveBase: true }))
      .toEqual({ active: true, prerequisiteMessage: null });
  });

  it("keeps an exterior streaming failure from implying the base or Stage 3 state changed", () => {
    expect(exteriorStreamingFailureMessage(new Error("Exterior runtime request failed (404)."))).toBe(
      "Exterior runtime request failed (404). Exterior streaming was disabled; the existing base/exterior state was left unchanged.",
    );
    expect(exteriorStreamingFailureMessage(null)).toContain("the existing base/exterior state was left unchanged");
  });

  it("surfaces one explicit notice for every cell that did not render its pinned head", () => {
    const notices = exteriorStreamingNotices("canary not pinned here", [
      { kind: "rendered", cellId: "c1", cellReleaseId: "cell:c1:v1", cellReleaseVersion: "v1", assemblyPackageId: "assembly:cell:c1:v1", representation: "predecessor", assets: [], notice: "predecessor is shown instead" },
      { kind: "rendered", cellId: "c2", cellReleaseId: "cell:c2:v1", cellReleaseVersion: "v1", assemblyPackageId: "assembly:cell:c2:v1", representation: "head", assets: [], notice: null },
      { kind: "base-massing", cellId: "c3", cellReleaseId: "cell:c3:v1", code: "checksum-mismatch", message: "corrupt", notice: "base massing remains for c3" },
      { kind: "failed", cellId: "c4", cellReleaseId: "cell:c4:v1", code: "checksum-mismatch", message: "corrupt", notice: "no exterior geometry for c4" },
    ]);
    expect(notices).toEqual([
      "canary not pinned here",
      "predecessor is shown instead",
      "base massing remains for c3",
      "no exterior geometry for c4",
    ]);
    expect(exteriorStreamingNotices(null, [])).toEqual([]);
  });

  it("labels the release origin so a canary is never mistaken for the default head", () => {
    expect(exteriorSnapshotOriginLabel("default", "snapshot:v2")).toBe("Default pinned snapshot snapshot:v2");
    expect(exteriorSnapshotOriginLabel("canary", "snapshot:v3")).toContain("Canary snapshot snapshot:v3");
    expect(exteriorSnapshotOriginLabel("canary", "snapshot:v3")).toContain("explicitly selected");
  });

  it("renders the profile controls disabled until the exterior runtime is genuinely active", async () => {
    render(<App />);
    const controls = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[aria-label='Exterior streaming and render profile']");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(within(controls).getByRole("button", { name: "Enable exterior streaming" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Inspection profile" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Exploration profile" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Exploration profile" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the exterior deep link and shows an explicit notice when the local release is absent", async () => {
    window.history.replaceState({}, "", "/?exteriorCells=udt-fixture-exterior-cells&exteriorProfile=inspection");
    render(<App />);
    const notice = await waitFor(() => {
      const element = [...document.querySelectorAll<HTMLElement>(".runtime-note [role='status']")].find((candidate) => candidate.textContent?.includes("Exterior streaming"));
      expect(element).toBeDefined();
      return element!;
    });
    expect(notice.textContent).toContain("Exterior streaming");
    expect(new URL(window.location.href).searchParams.get("exteriorCells")).toBe("udt-fixture-exterior-cells");
  });

  it("streams a pinned canary deep link from that release's own local base path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 404 }));
    try {
      window.history.replaceState({}, "", "/?exteriorCells=manhattan-exterior-cells-20260811");
      render(<App />);
      const requestedPaths = () => fetchSpy.mock.calls.map(([input]) => String(input));
      await waitFor(() => {
        expect(requestedPaths().some((path) => path.startsWith("/data/manhattan-exterior-cells-20260811/"))).toBe(true);
      });
      // The default pin must not be requested behind the canary's back.
      expect(requestedPaths().some((path) => path.startsWith("/data/udt-fixture-exterior-cells/"))).toBe(false);
      expect(new URL(window.location.href).searchParams.get("exteriorCells")).toBe("manhattan-exterior-cells-20260811");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  /**
   * Clean-load ordering regression, against the real App wiring.
   *
   * `exteriorStreamingRequested` is URL-derived and true on the very first
   * render, while the citywide base adapter arrives asynchronously afterwards.
   * The activation effect used to capture `activeAdapterRef.current` and carried
   * no adapter in its dependency list, so it ran once against the fixture
   * placeholder with no active base, every cell failed `base-incompatible`, and
   * nothing re-ran when the real adapter landed — only a manual disable/enable
   * toggle recovered. This drives the committed canary bytes through the real
   * exterior runtime inside `<App />` and allows no toggle.
   */
  it("renders the pinned canary on a clean load when the citywide base adapter arrives after the first activation attempt", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    const citywide = lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS);
    const citywideGate = deferred<CitywideReleaseAdapter>();
    citywideRuntimeMocks.loadCitywideRelease.mockReturnValue(citywideGate.promise);
    try {
      window.history.replaceState({}, "", `/?data=${CITYWIDE_RELEASE_ID}&release=${CITYWIDE_RELEASE_ID}&exteriorCells=${CANARY_EXTERIOR_RELEASE_ID}`);
      render(<App />);
      const requestedPaths = () => fetchSpy.mock.calls.map(([input]) => String(input));

      // Ordering under test: activation runs first, with the fixture placeholder
      // active and no real base release.
      await waitFor(() => {
        expect(requestedPaths().some((path) => path.startsWith(CANARY_EXTERIOR_ROOT))).toBe(true);
      });
      expect(citywide.ensureCalls()).toBe(0);

      // Only now does the base adapter land. No user interaction follows.
      citywideGate.resolve(citywide.adapter);

      const viewport = await waitFor(() => {
        const element = document.querySelector<HTMLElement>(".viewport");
        expect(element?.getAttribute("data-exterior-render-entry-count")).toBe(String(BLOCK_835_FEATURE_IDS.length));
        return element!;
      }, { timeout: 20_000 });
      expect(viewport.getAttribute("data-exterior-render-entry-count")).toBe("14");

      // Membership was proven from the release identity index, not residency.
      expect(citywide.ensureCalls()).toBeGreaterThan(0);

      const status = [...document.querySelectorAll<HTMLElement>(".runtime-note-overlay")].find((candidate) => candidate.textContent?.startsWith("Exterior streaming ·"));
      expect(status?.textContent).toContain("Default pinned snapshot");
      expect(status?.textContent).toContain("verified local GLB bytes only");
      expect(status?.getAttribute("data-exterior-snapshot-origin")).toBe("default");

      // No fallback notice, and nothing fell back to base massing.
      expect(document.querySelector("[data-exterior-notices]")).toBeNull();
      expect(document.body.textContent).not.toContain("failed verification");
      expect(document.body.textContent).not.toContain("base-incompatible");
      expect(document.body.textContent).not.toContain("requires an active base release");
      expect(within(document.body).getByRole("button", { name: "Disable exterior streaming" })).toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  /**
   * Migration invariant M1 for the midtown-core canary: adding
   * `manhattan-midtown-core-cells-20260811` to the pinned allowlist must leave
   * the default session byte-identical in behaviour. A session that names no
   * exterior parameter resolves the promoted Block 835 default and must issue
   * no request whatsoever into the midtown-core release root — opt-in is
   * exclusively `?exteriorCells=manhattan-midtown-core-cells-20260811`.
   */
  // T013 asserted the inverse of this: before the Midtown-core wave was
  // promoted, a default session had to issue NO midtown request, because the
  // wave was a strictly opt-in canary. T014 promotes it, so the default session
  // legitimately streams both waves and the T013 expectation is superseded by
  // the promotion itself. What still has to hold — and is what that test was
  // really protecting — is that a default session streams exactly the promoted
  // set, announces each wave by name, and serialises no exterior parameters.
  it("streams the whole promoted set in a default session, naming each wave", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    const citywide = lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS);
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(citywide.adapter as unknown as CitywideReleaseAdapter);
    try {
      window.history.replaceState({}, "", `/?data=${CITYWIDE_RELEASE_ID}&release=${CITYWIDE_RELEASE_ID}`);
      render(<App />);
      const requestedPaths = () => fetchSpy.mock.calls.map(([input]) => String(input));

      // The promoted default is what a parameterless session resolves.
      await waitFor(() => {
        expect(requestedPaths().some((path) => path.startsWith(PROMOTED_EXTERIOR_ROOT))).toBe(true);
      });
      await waitFor(() => {
        const viewport = document.querySelector<HTMLElement>(".viewport");
        expect(viewport?.getAttribute("data-exterior-render-entry-count")).toBe(String(BLOCK_835_FEATURE_IDS.length));
      }, { timeout: 20_000 });

      // Both promoted waves are attempted, and only promoted waves are.
      expect(requestedPaths().some((path) => path.startsWith(MIDTOWN_CORE_EXTERIOR_ROOT))).toBe(true);
      expect(new URL(window.location.href).searchParams.get("exteriorCells")).toBeNull();
      const status = [...document.querySelectorAll<HTMLElement>(".runtime-note-overlay")].find((candidate) => candidate.textContent?.startsWith("Exterior streaming ·"));
      expect(status?.textContent).toContain(PROMOTED_EXTERIOR_RELEASE_ID);
      // Each status line names its own wave rather than one line covering both.
      expect(status?.getAttribute("data-exterior-release")).toBe(PROMOTED_EXTERIOR_RELEASE_ID);
      expect(status?.textContent).not.toContain(MIDTOWN_CORE_EXTERIOR_RELEASE_ID);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);
});

describe("exterior streaming deep-link and anchor honesty", () => {
  it("names an exterior release this build does not pin instead of degrading silently", () => {
    const message = exteriorDeepLinkMessage("/?exteriorCells=manhattan-exterior-production-20270101&exteriorProfile=inspection");
    expect(message).toContain("manhattan-exterior-production-20270101");
    expect(message).toContain("is not pinned by this build");
    // Every pinned release is listed, so the notice never understates what this build accepts.
    for (const pinned of PINNED_EXTERIOR_CELL_RELEASE_IDS) expect(message).toContain(pinned);
    expect(exteriorDeepLinkMessage("/?exteriorCells=udt-fixture-exterior-cells&exteriorProfile=inspection")).toBeNull();
    expect(exteriorDeepLinkMessage("/?exteriorCells=manhattan-exterior-cells-20260811&exteriorProfile=inspection")).toBeNull();
    expect(exteriorDeepLinkMessage("/?feature=doitt:778052")).toBeNull();
  });

  it("names an unsupported render profile instead of quietly using the default", () => {
    const message = exteriorDeepLinkMessage("/?exteriorCells=udt-fixture-exterior-cells&exteriorProfile=cinematic");
    expect(message).toContain("cinematic");
    expect(message).toContain("exploration");
  });

  it("shows the unrecognized-release notice in the live app without changing the rest of the view", async () => {
    window.history.replaceState({}, "", "/?exteriorCells=manhattan-exterior-production-20270101");
    render(<App />);
    const alert = await waitFor(() => {
      const element = [...document.querySelectorAll<HTMLElement>("[role='alert']")].find((candidate) => candidate.textContent?.includes("is not pinned by this build"));
      expect(element).toBeDefined();
      return element!;
    });
    expect(alert.textContent).toContain("manhattan-exterior-production-20270101");
  });

  it("reports verified geometry withheld for want of a base anchor as an explicit notice", () => {
    const notices = exteriorStreamingNotices(null, [
      { kind: "rendered", cellId: "c1", cellReleaseId: "cell:c1:v1", cellReleaseVersion: "v1", assemblyPackageId: "assembly:cell:c1:v1", representation: "head", assets: [], notice: null },
    ], ["doitt:778052"]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("doitt:778052");
    expect(notices[0]).toContain("no verified WGS84 anchor");
    expect(exteriorStreamingNotices(null, [], [])).toEqual([]);
  });

  it("reports an exterior canary snapshot the loaded release cannot resolve", () => {
    // manhattan-exterior-cells-20260811 ships an empty canaryHeads, so a canary
    // deep link into it must say so instead of silently using the default head.
    expect(exteriorCanarySnapshotMessage("manhattan-exterior-cells-20260811", "snapshot:does-not-exist", []))
      .toBe("Exterior canary snapshot snapshot:does-not-exist is not available: release manhattan-exterior-cells-20260811 publishes no canary heads. The default pinned snapshot was used instead.");
    expect(exteriorCanarySnapshotMessage("udt-fixture-exterior-cells", "snapshot:missing", ["snapshot:canary-a"]))
      .toContain("Available canary snapshots are snapshot:canary-a");
    // A resolvable canary snapshot produces no notice at all.
    expect(exteriorCanarySnapshotMessage("udt-fixture-exterior-cells", "snapshot:canary-a", ["snapshot:canary-a"])).toBeNull();
  });
});

/**
 * Block 835 promotion: the exterior wave is the DEFAULT over an active real
 * base, with no `exteriorCells` opt-in, and its rollback is one record swap.
 */
describe("promoted Block 835 exterior default activation", () => {
  const REAL_BASE_URL = `/?data=real-pilot&release=${CITYWIDE_RELEASE_ID}`;
  // The real predecessor: it names the release the build withdrew, which is what
  // makes promotion-era `?exteriorCells=` bookmarks fail closed.
  const ROLLED_BACK_RECORD = { enabled: false, releaseId: null, rolledBackReleaseId: CANARY_EXTERIOR_RELEASE_ID };

  /** A base adapter that owns the Block 835 identities as ordinary base features. */
  function residentCitywideBaseAdapter() {
    const features: Feature[] = BLOCK_835_FEATURE_IDS.map((id) => ({
      ...locatedFeature,
      id,
      name: `Base massing ${id}`,
      kind: "building",
    } as Feature));
    const byId = new Map(features.map((feature) => [feature.id, feature]));
    const adapter = {
      releaseId: CITYWIDE_RELEASE_ID,
      fixtureOnly: false,
      getFeature: (featureId: string) => byId.get(featureId),
      getFeatures: () => features,
      search: () => [],
      searchAsync: async () => [],
      refreshViewport: async () => features,
      loadDetail: async (featureId: string) => byId.get(featureId),
      loadDetailsForFeature: async () => undefined,
      getMetrics: () => ZERO_CITYWIDE_METRICS,
      destroy: () => {},
      ensureIdentityIndex: async () => features.length,
      hasIdentityMember: (featureId: string) => byId.has(featureId),
    };
    return adapter as unknown as CitywideReleaseAdapter;
  }

  const exteriorPaths = (spy: { mock: { calls: unknown[][] } }): string[] =>
    spy.mock.calls.map((call) => String(call[0])).filter((path) => path.includes("exterior-cells"));

  /** The record is a union; these assertions are about the promoted variant. */
  const promoted = EXTERIOR_DEFAULT_ACTIVATION.enabled ? EXTERIOR_DEFAULT_ACTIVATION : null;

  it("streams the promoted release with no exterior parameters once a real base is active", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS).adapter);
    try {
      window.history.replaceState({}, "", REAL_BASE_URL);
      render(<App />);
      const viewport = await waitFor(() => {
        const element = document.querySelector<HTMLElement>(".viewport");
        expect(element?.getAttribute("data-exterior-render-entry-count")).toBe(String(BLOCK_835_FEATURE_IDS.length));
        return element!;
      }, { timeout: 20_000 });
      expect(viewport.getAttribute("data-exterior-render-entry-count")).toBe("14");

      // Exactly the accepted release resolved the default head, and the
      // pre-promotion fixture package was never requested behind its back.
      expect(exteriorPaths(fetchSpy).every((path) => path.startsWith(PROMOTED_EXTERIOR_ROOT))).toBe(true);
      const status = [...document.querySelectorAll<HTMLElement>(".runtime-note-overlay")].find((candidate) => candidate.textContent?.startsWith("Exterior streaming ·"));
      expect(status?.textContent).toContain(`Default pinned snapshot ${promoted!.snapshotId}`);
      expect(status?.getAttribute("data-exterior-snapshot-origin")).toBe("default");
      expect(document.querySelector("[data-exterior-notices]")).toBeNull();
      expect(within(document.body).getByRole("button", { name: "Disable exterior streaming" })).toBeInTheDocument();

      // A default-on session carries no exterior parameters at all.
      const url = new URL(window.location.href);
      expect(url.searchParams.has("exteriorCells")).toBe(false);
      expect(url.searchParams.has("exteriorStreaming")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("keeps a fixture-mode default session exterior-quiet with no load attempt and no failure banner", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 404 }));
    try {
      window.history.replaceState({}, "", "/");
      render(<App />);
      await waitFor(() => expect(document.querySelector(".viewport")).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The activation gate is `record.enabled && a real base is active`, so a
      // fixture session neither loads nor complains about not loading.
      expect(exteriorPaths(fetchSpy)).toEqual([]);
      expect(document.body.textContent).not.toContain("Exterior streaming ·");
      expect(document.body.textContent).not.toContain("Exterior streaming was disabled");
      expect(document.querySelector("[data-exterior-unavailable]")).toBeNull();
      expect(within(document.body).getByRole("button", { name: "Enable exterior streaming" })).toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("suppresses the promoted default when the URL explicitly disables exterior streaming", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(residentCitywideBaseAdapter());
    try {
      window.history.replaceState({}, "", `${REAL_BASE_URL}&exteriorStreaming=off`);
      render(<App />);
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Enable exterior streaming" })).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(exteriorPaths(fetchSpy)).toEqual([]);
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");

      // Explicit unavailability, never a silent disappearance.
      fireEvent.click(within(document.body).getByRole("button", { name: "Open details" }));
      const section = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-unavailable]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(section.textContent).toContain("switched off for this session");
      expect(section.textContent).toContain("no substitute exterior was selected");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 20_000);

  it("restores exterior intent on Back and Forward across the off/on boundary", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS).adapter);
    try {
      window.history.replaceState({}, "", REAL_BASE_URL);
      render(<App />);
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Disable exterior streaming" })).toBeInTheDocument(), { timeout: 20_000 });

      // Forward: a history entry that explicitly disabled streaming.
      window.history.pushState({}, "", `${REAL_BASE_URL}&exteriorStreaming=off`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Enable exterior streaming" })).toBeInTheDocument());

      // Back: the default-on entry restores itself instead of keeping the
      // session's last state, which is what the old mount-only parse did.
      window.history.pushState({}, "", REAL_BASE_URL);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Disable exterior streaming" })).toBeInTheDocument(), { timeout: 20_000 });
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("returns a re-enabled real-base session to the gated default instead of pinning the promoted release", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS).adapter);
    try {
      window.history.replaceState({}, "", `${REAL_BASE_URL}&exteriorStreaming=off`);
      render(<App />);
      // The promoted release is only the toggle's target once the real base is
      // genuinely active, so wait for the base rather than for the button.
      await waitFor(() => expect(document.body.textContent).toContain(`Real NYC citywide release · ${CITYWIDE_RELEASE_ID}`), { timeout: 20_000 });
      fireEvent.click(within(document.body).getByRole("button", { name: "Enable exterior streaming" }));
      // Reverses the pre-promotion expectation: this used to enable the fixture.
      await waitFor(() => expect(exteriorPaths(fetchSpy).some((path) => path.startsWith(PROMOTED_EXTERIOR_ROOT))).toBe(true));
      expect(exteriorPaths(fetchSpy).some((path) => path.startsWith("/data/udt-fixture-exterior-cells/"))).toBe(false);
      // ...and it re-enters the DEFAULT, not an explicit opt-in that happens to
      // name the promoted release: a default-on session serializes no exterior
      // parameters, and the promotion gates stay in force for the rest of it.
      const url = new URL(window.location.href);
      expect(url.searchParams.has("exteriorCells")).toBe(false);
      expect(url.searchParams.has("exteriorStreaming")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("keeps the promotion gates in force after an off/on toggle, so a drifted record still fails closed", async () => {
    // The regression: re-enabling used to pin the promoted release as an
    // explicit opt-in, which resolved `promotedDefault: false` and skipped both
    // gates for the rest of the session. A drifted record is the cheapest proof
    // the gates ran: the committed bytes no longer match what the build accepts.
    promotionMocks.record = { ...promoted!, snapshotChecksumSha256: "0".repeat(64) };
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(lateCitywideBaseAdapter(BLOCK_835_FEATURE_IDS).adapter);
    try {
      window.history.replaceState({}, "", REAL_BASE_URL);
      render(<App />);
      const failedNotice = () => [...document.querySelectorAll<HTMLElement>(".runtime-note-overlay")].find((candidate) => candidate.textContent?.includes("Exterior streaming failed closed"));
      // Cold load fails closed on the drift.
      await waitFor(() => expect(failedNotice()).toBeDefined(), { timeout: 20_000 });
      expect(failedNotice()!.textContent).toContain("snapshot checksum");
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");

      // Off, then on again: the re-enabled session is gated exactly as the cold
      // load was, so the drifted record still renders nothing.
      fireEvent.click(within(document.body).getByRole("button", { name: "Disable exterior streaming" }));
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Enable exterior streaming" })).toBeInTheDocument());
      // The disable clears the failure state, so its return is the gate rerunning.
      await waitFor(() => expect(failedNotice()).toBeUndefined());
      fireEvent.click(within(document.body).getByRole("button", { name: "Enable exterior streaming" }));
      await waitFor(() => expect(failedNotice()).toBeDefined(), { timeout: 20_000 });
      expect(failedNotice()!.textContent).toContain("no substitute release was selected");
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("refuses a promotion-era opt-in link once the build is rolled back, and still honours the fixture opt-in", async () => {
    promotionMocks.record = ROLLED_BACK_RECORD;
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(residentCitywideBaseAdapter());
    try {
      // The withdrawn release is still pinned and still on disk, so only the
      // refusal rule stops this bookmark from rendering the rolled-back wave.
      window.history.replaceState({}, "", `${REAL_BASE_URL}&exteriorCells=${CANARY_EXTERIOR_RELEASE_ID}`);
      render(<App />);
      await waitFor(() => expect(document.querySelector(".viewport")).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(exteriorPaths(fetchSpy)).toEqual([]);
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");

      const alert = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-deep-link-notice]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(alert.textContent).toContain(`${CANARY_EXTERIOR_RELEASE_ID} was rolled back in this build`);
      expect(alert.textContent).toContain("no substitute exterior release was selected");

      await waitFor(() => expect(document.body.textContent).toContain(`Real NYC citywide release · ${CITYWIDE_RELEASE_ID}`), { timeout: 20_000 });
      fireEvent.click(within(document.body).getByRole("button", { name: "Open details" }));
      const section = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-unavailable]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(section.textContent).toContain("was rolled back in this build");
      expect(section.textContent).not.toContain("switched off for this session");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("keeps the fixture opt-in working in a rolled-back build", async () => {
    promotionMocks.record = ROLLED_BACK_RECORD;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 404 }));
    try {
      window.history.replaceState({}, "", "/?exteriorCells=udt-fixture-exterior-cells");
      render(<App />);
      // Rollback withdraws the promoted wave only: the pre-promotion opt-in is
      // still attempted from its own base path, exactly as before.
      await waitFor(() => expect(fetchSpy.mock.calls.map((call) => String(call[0])).some((path) => path.startsWith("/data/udt-fixture-exterior-cells/"))).toBe(true));
      expect(new URL(window.location.href).searchParams.get("exteriorCells")).toBe("udt-fixture-exterior-cells");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 20_000);

  it("says a link named a release this build does not pin instead of claiming the session was switched off", async () => {
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(residentCitywideBaseAdapter());
    try {
      window.history.replaceState({}, "", `${REAL_BASE_URL}&exteriorCells=manhattan-exterior-production-20270101`);
      render(<App />);
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Enable exterior streaming" })).toBeInTheDocument(), { timeout: 20_000 });
      expect(exteriorPaths(fetchSpy)).toEqual([]);

      // The existing not-pinned banner is unchanged...
      const alert = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-deep-link-notice]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(alert.textContent).toContain("is not pinned by this build");

      // ...and the details panel no longer reports a typo as a user's disable.
      await waitFor(() => expect(document.body.textContent).toContain(`Real NYC citywide release · ${CITYWIDE_RELEASE_ID}`), { timeout: 20_000 });
      fireEvent.click(within(document.body).getByRole("button", { name: "Open details" }));
      const section = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-unavailable]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(section.textContent).toContain("not pinned by this build");
      expect(section.textContent).not.toContain("switched off for this session");
      expect(section.textContent).toContain("no substitute exterior was selected");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("isolates a cold-start exterior fault under default-on and keeps the base release intact", async () => {
    // Same shape as the harness fault seam: the pinned release answers, but one
    // required document does not verify. Nothing on disk is touched.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (!path.startsWith(CANARY_EXTERIOR_ROOT)) return new Response(null, { status: 404 });
      if (path.endsWith("release-graph.json")) return new Response(null, { status: 500 });
      try {
        return new Response(new Uint8Array(readFileSync(`public${path}`)), { status: 200 });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(residentCitywideBaseAdapter());
    try {
      window.history.replaceState({}, "", REAL_BASE_URL);
      render(<App />);
      const notice = await waitFor(() => {
        const element = [...document.querySelectorAll<HTMLElement>(".runtime-note-overlay")].find((candidate) => candidate.textContent?.includes("Exterior streaming was disabled"));
        expect(element).toBeDefined();
        return element!;
      }, { timeout: 20_000 });
      expect(notice.textContent).toContain("the existing base/exterior state was left unchanged");
      // The base scene booted anyway: real release, real features, no exteriors.
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");
      expect(document.body.textContent).toContain(CITYWIDE_RELEASE_ID);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);

  it("rolls back to the base-only predecessor with an explicit unavailable statement and stable identities", async () => {
    // The rehearsed rollback: the exported record becomes its predecessor.
    promotionMocks.record = ROLLED_BACK_RECORD;
    const fetchSpy = serveCommittedCanaryRelease();
    citywideRuntimeMocks.loadCitywideRelease.mockResolvedValue(residentCitywideBaseAdapter());
    try {
      window.history.replaceState({}, "", `${REAL_BASE_URL}&feature=doitt:778052`);
      render(<App />);
      await waitFor(() => expect(document.body.textContent).toContain("Base massing doitt:778052"), { timeout: 20_000 });

      // No load attempt at all, and no exterior geometry in the scene.
      expect(exteriorPaths(fetchSpy)).toEqual([]);
      expect(document.querySelector<HTMLElement>(".viewport")?.getAttribute("data-exterior-render-entry-count")).toBe("0");

      // The deep link still resolves to the base feature, with its identity
      // intact and no substitute or same-name stand-in.
      expect(document.body.textContent).not.toContain("no substitute was selected");
      expect(new URL(window.location.href).searchParams.get("feature")).toBe("doitt:778052");

      const section = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-exterior-unavailable]");
        expect(element).not.toBeNull();
        return element!;
      });
      expect(section.textContent).toContain("not active in this build");
      expect(section.textContent).toContain("no substitute exterior was selected");
      expect(document.querySelector(".exterior-streaming-detail [data-exterior-release-origin]")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  }, 30_000);
});
