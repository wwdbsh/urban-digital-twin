import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Bookmark,
  Box,
  ChevronLeft,
  Clock3,
  Compass,
  Crosshair,
  Database,
  HelpCircle,
  Layers3,
  Search,
  Settings,
  X,
} from "lucide-react";
import {
  featureMatchesQuery,
  projectFeatureToCityFeature,
  provenanceLabel,
  runtimeMarker,
} from "../domain/features";
import type { Feature } from "../domain/schema";
import type { Itinerary, TravelMode } from "../domain/routing";
import { PLACE_CATEGORIES, placeCategoriesFromFeature, type PlaceCategory } from "../domain/places";
import { areaSemanticsLabel, isAreaSemantic } from "../domain/areas";
import { transitKindLabel } from "../domain/transit";
import { DEFAULT_PROXIMITY_MAX_RESULTS, DEFAULT_PROXIMITY_THRESHOLD_METERS, findNearbyFeatures, formatDistanceMeters, representativePoint } from "../domain/proximity";
import { buildSyntheticReconciliationCatalog } from "../domain/reconciliation-fixtures";
import { searchReconciledCatalog, type CanonicalEntity } from "../domain/reconciliation";
import { searchUnifiedCatalog, type UnifiedSearchResult } from "../domain/exploration";
import { buildCatalogRelease } from "../release/catalog-release";
import { buildSyntheticCatalogArtifacts } from "../release/fixtures";
import { CesiumViewport } from "../features/explorer/CesiumViewport";
import { LocalFixtureCityAdapter } from "../runtime/fixture-adapter";
import { RouteGraphSnapshotAdapter } from "../ingestion/route-graph-snapshot";
import { sha256Hex } from "../ingestion/offline";
import routeGraphFixture from "../ingestion/fixtures/route-graph.synthetic.fixture.json";
import { generateSyntheticTileHarness, SYNTHETIC_TILE_ANCHORS, type SyntheticTileContent } from "../runtime/synthetic-tile-harness";
import { RuntimeTileStream, type TileCameraState, type TileStreamMetrics } from "../runtime/tile-stream";
import { DEFAULT_CAMERA_POSE, loadSavedNavigation, navigationUrl, normalizeCameraPose, parseNavigationUrl, persistSavedNavigation, saveJourney, savePlace, stepIndex, journeyStepCount, VISITOR_NAVIGATION_SCHEMA_VERSION, type CameraMode, type CameraPose, type SavedNavigationState } from "../domain/visitor-navigation";
import {
  DEFAULT_LAYER_VISIBILITY,
  LAYER_LABELS,
  type LayerVisibility,
  type RuntimeLayerId,
} from "../runtime/layers";

const navigation = [
  { label: "Explore", icon: Compass },
  { label: "Layers", icon: Layers3 },
  { label: "Bookmarks", icon: Bookmark },
] as const;

const fixtureAdapter = new LocalFixtureCityAdapter();
const fixtureIngestionSummary = runtimeMarker.ingestionSummary;
const syntheticCatalog = buildSyntheticReconciliationCatalog();
const syntheticCatalogV1 = buildCatalogRelease(buildSyntheticCatalogArtifacts("v1"), { releaseVersion: "fixture-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });
const syntheticCatalogRelease = buildCatalogRelease(buildSyntheticCatalogArtifacts("v2"), { releaseVersion: "fixture-v2", generatedAt: "2026-08-04T00:00:00Z", fixtureOnly: true, previousRelease: syntheticCatalogV1 });

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toCityFeature(feature: Feature) {
  return projectFeatureToCityFeature(feature, "Manhattan, New York", fixtureIngestionSummary);
}

export function App() {
  const initialNavigation = typeof window === "undefined" ? { featureId: null, query: "", cameraMode: "explore" as CameraMode, pose: null, poseInvalid: false } : parseNavigationUrl(window.location.href);
  const fixtureFeatureIds = useMemo(() => new Set(fixtureAdapter.getFeatures().map((feature) => feature.id)), []);
  const initialSelectionId = initialNavigation.featureId && fixtureFeatureIds.has(initialNavigation.featureId) ? initialNavigation.featureId : null;
  const [activeNavigation, setActiveNavigation] = useState("Explore");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const [focusFeatureId, setFocusFeatureId] = useState<string | null>(runtimeMarker.id);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState(runtimeMarker);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(initialSelectionId);
  const [selectedCatalogEntityId, setSelectedCatalogEntityId] = useState<string | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<PlaceCategory[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);
  const [routeAdapter, setRouteAdapter] = useState<RouteGraphSnapshotAdapter | null>(null);
  const [routeOriginId, setRouteOriginId] = useState<string | null>(null);
  const [routeDestinationId, setRouteDestinationId] = useState<string | null>(null);
  const [routeOriginQuery, setRouteOriginQuery] = useState("");
  const [routeDestinationQuery, setRouteDestinationQuery] = useState("");
  const [routeMode, setRouteMode] = useState<TravelMode>("walking");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [previewRequest, setPreviewRequest] = useState<{ action: "start" | "pause" | "stop" | "previous" | "next" | "focus"; requestId: number } | undefined>();
  const [previewStep, setPreviewStep] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>(initialNavigation.cameraMode);
  const [cameraPose, setCameraPose] = useState<CameraPose>(initialNavigation.pose ?? DEFAULT_CAMERA_POSE);
  const [cameraRequest, setCameraRequest] = useState<(CameraPose & { requestId: number }) | undefined>(initialNavigation.pose ? { ...initialNavigation.pose, requestId: 1 } : undefined);
  const [poseInvalid, setPoseInvalid] = useState(initialNavigation.poseInvalid);
  const [savedNavigation, setSavedNavigation] = useState<SavedNavigationState>(() => typeof window === "undefined" ? { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places: [], journeys: [] } : loadSavedNavigation(window.localStorage, fixtureFeatureIds));
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stressMode, setStressMode] = useState(false);
  const [stressCameraRequest, setStressCameraRequest] = useState<{ longitude: number; latitude: number; distanceMeters: number; requestId: number } | undefined>();
  const [stressFeatures, setStressFeatures] = useState<Feature[]>([]);
  const [tileMetrics, setTileMetrics] = useState<TileStreamMetrics>({ generation: 0, selectedLod: null, visibleTileCount: 0, requestedTileCount: 0, loadedTileCount: 0, evictedTileCount: 0, failedTileCount: 0, loadedBytes: 0, activeRequests: 0, maxConcurrentRequests: 0, deduplicatedRequests: 0, cancelledRequestCount: 0, staleResultCount: 0, renderedFeatureCount: 0 });
  const stressStreamRef = useRef<RuntimeTileStream<SyntheticTileContent> | null>(null);
  const stressCameraRef = useRef<TileCameraState>({ longitude: -73.991, latitude: 40.744, distanceMeters: 4_000 });
  const stressCameraIntentRef = useRef<{ camera: TileCameraState; expiresAt: number } | null>(null);
  const queryRef = useRef(query);
  const cameraPoseRef = useRef(cameraPose);
  const cameraModeRef = useRef(cameraMode);
  const activeSelectionRef = useRef(activeSelectionId);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  queryRef.current = query;
  cameraPoseRef.current = cameraPose;
  cameraModeRef.current = cameraMode;
  activeSelectionRef.current = activeSelectionId;

  useEffect(() => { if (typeof window !== "undefined") persistSavedNavigation(window.localStorage, savedNavigation); }, [savedNavigation]);

  const publishStressState = useCallback((stream: RuntimeTileStream<SyntheticTileContent>) => {
    if (stressStreamRef.current !== stream) return;
    setStressFeatures(stream.getVisibleValues().flatMap((content) => content.features));
    setTileMetrics(stream.getMetrics());
  }, []);

  const onTileCameraChanged = useCallback((camera: CameraPose) => {
    const intent = stressCameraIntentRef.current;
    if (intent && Date.now() < intent.expiresAt) camera = { longitude: intent.camera.longitude, latitude: intent.camera.latitude, height: intent.camera.distanceMeters, heading: 0, pitch: -45, roll: 0 };
    else stressCameraIntentRef.current = null;
    const tileCamera: TileCameraState = { longitude: camera.longitude, latitude: camera.latitude, distanceMeters: camera.height };
    stressCameraRef.current = tileCamera;
    setCameraPose(normalizeCameraPose(camera) ?? DEFAULT_CAMERA_POSE);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrl({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: normalizeCameraPose(camera), poseInvalid: false }, window.location.href));
    const stream = stressStreamRef.current;
    if (!stream) return;
    void stream.refresh(tileCamera).then(() => publishStressState(stream));
  }, [publishStressState, selectedFeature.id]);

  const moveStressCamera = (anchorIndex: number, distanceMeters: number) => {
    const anchor = SYNTHETIC_TILE_ANCHORS[anchorIndex];
    if (!anchor) return;
    const camera = { longitude: anchor[0], latitude: anchor[1], distanceMeters };
    stressCameraIntentRef.current = { camera, expiresAt: Date.now() + 1_500 };
    setStressCameraRequest((current) => ({ ...camera, requestId: (current?.requestId ?? 0) + 1 }));
  };

  useEffect(() => {
    let active = true;
    const text = JSON.stringify(routeGraphFixture);
    void sha256Hex(text).then((inputChecksumSha256) => RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText: text, metadata: { inputFileName: "route-graph.synthetic.fixture.json", inputChecksumSha256, ingestedAt: "2026-08-03T00:00:00Z", immutable: true, fixtureOnly: true } })).then((adapter) => { if (active) setRouteAdapter(adapter); }).catch(() => { if (active) setRouteMessage("Synthetic route graph unavailable; no real routing is connected."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let stream: RuntimeTileStream<SyntheticTileContent> | null = null;
    if (!stressMode) {
      setStressFeatures([]);
      stressStreamRef.current?.destroy();
      stressStreamRef.current = null;
      setTileMetrics((current) => ({ ...current, selectedLod: null, visibleTileCount: 0, requestedTileCount: 0, loadedTileCount: 0, evictedTileCount: 0, failedTileCount: 0, loadedBytes: 0, activeRequests: 0, renderedFeatureCount: 0 }));
      return () => { active = false; };
    }
    void generateSyntheticTileHarness({ featuresPerLayerPerLod: 18 }).then(async ({ package: tilePackage, contents }) => {
      if (!active) return;
      const tileStream = new RuntimeTileStream<SyntheticTileContent>(tilePackage, async (manifest, signal) => {
        if (signal.aborted) throw new DOMException("Tile request cancelled", "AbortError");
        const content = contents.get(manifest.contentId); if (!content) throw new Error(`Synthetic tile content missing: ${manifest.contentId}`); return content;
      }, { maxLoadedTiles: 4, maxLoadedBytes: 1_000_000, maxConcurrentRequests: 2, minLod: 8, maxLod: 12 });
      stream = tileStream;
      stressStreamRef.current = tileStream;
      await tileStream.refresh(stressCameraRef.current);
      if (!active) { tileStream.destroy(); return; }
      publishStressState(tileStream);
    }).catch(() => { if (active) setTileMetrics((current) => ({ ...current, failedTileCount: current.failedTileCount + 1 })); });
    return () => { active = false; if (stressStreamRef.current === stream) stressStreamRef.current = null; stream?.destroy(); stream = null; };
  }, [publishStressState, stressMode]);

  const selectFeature = useCallback((feature: Feature, options: { syncUrl?: boolean } = {}) => {
    setSelectedFeature(toCityFeature(feature));
    setActiveSelectionId(feature.id);
    setSelectedCatalogEntityId(syntheticCatalog.entities.find((entity) => entity.fields.runtimeFeatureId === feature.id)?.canonicalId ?? null);
    setFocusFeatureId(feature.id);
    setInspectorOpen(true);
    setDeepLinkMessage(null);
    if (options.syncUrl !== false && typeof window !== "undefined") window.history.pushState({}, "", navigationUrl({ featureId: feature.id, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false }, window.location.href));
    window.setTimeout(() => detailsHeadingRef.current?.focus(), 0);
  }, []);

  const unifiedResults = useMemo(() => searchUnifiedCatalog(fixtureAdapter.getFeatures(), syntheticCatalog, query).filter((result) => selectedCategories.length === 0 || result.feature.kind !== "poi" || selectedCategories.some((category) => placeCategoriesFromFeature(result.feature).includes(category))), [query, selectedCategories]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const applyUrl = () => {
      const state = parseNavigationUrl(window.location.href);
      setQuery(state.query);
      setCameraMode(state.cameraMode); setPoseInvalid(state.poseInvalid);
      if (state.pose) { setCameraPose(state.pose); setCameraRequest((current) => ({ ...state.pose!, requestId: (current?.requestId ?? 0) + 1 })); }
      if (!state.featureId) { setActiveSelectionId(null); setDeepLinkMessage(state.poseInvalid ? "This shared camera pose is malformed; the safe default view is active." : null); return; }
      const feature = fixtureAdapter.getFeature(state.featureId);
      if (feature) selectFeature(feature, { syncUrl: false });
      else { setActiveSelectionId(null); setDeepLinkMessage(state.poseInvalid ? "This shared link has an invalid camera pose and a feature that is not in the current catalog release." : "This shared link points to a feature that is not in the current catalog release."); }
    };
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    return () => window.removeEventListener("popstate", applyUrl);
  }, [selectFeature]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false); setActiveSearchIndex(-1); setQualityOpen(false);
      if (inspectorOpen) setInspectorOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen]);

  const focusMarker = () => {
    setInspectorOpen(true);
    setFocusFeatureId(selectedFeature.id);
    setFocusRequest((request) => request + 1);
  };

  const selectSearchResult = (result: UnifiedSearchResult) => {
    setQuery(result.feature.name);
    selectFeature(result.feature);
    setSearchOpen(false);
    setActiveSearchIndex(-1);
    setFocusRequest((request) => request + 1);
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const unifiedMatch = unifiedResults[activeSearchIndex >= 0 ? activeSearchIndex : 0];
    if (unifiedMatch) { selectSearchResult(unifiedMatch); return; }
    const catalogMatch = searchReconciledCatalog(syntheticCatalog, query).find((entity) => {
      if (selectedCategories.length === 0 || entity.entityKind !== "poi") return true;
      return selectedCategories.some((category) => entity.fields.categories.includes(category));
    });
    const catalogFeature = catalogMatch?.fields.runtimeFeatureId ? fixtureAdapter.getFeature(catalogMatch.fields.runtimeFeatureId) : undefined;
    if (catalogMatch && catalogFeature) {
      setSelectedCatalogEntityId(catalogMatch.canonicalId);
      selectFeature(catalogFeature);
      setFocusRequest((request) => request + 1);
      return;
    }
    const matches = fixtureAdapter.search(query);
    const match = matches.find((feature) => selectedCategories.length === 0 || selectedCategories.some((category) => placeCategoriesFromFeature(feature).includes(category))) ?? matches[0];
    if (match && featureMatchesQuery(toCityFeature(match), query)) selectFeature(match);
    if (match) { setFocusRequest((request) => request + 1); setSearchOpen(false); }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSearchOpen(true); setActiveSearchIndex((index) => Math.min(index + 1, unifiedResults.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveSearchIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === "Escape") { event.preventDefault(); setSearchOpen(false); setActiveSearchIndex(-1); }
  };

  const copyShareLink = async () => {
    if (typeof window === "undefined") return;
    const link = navigationUrl({ featureId: selectedFeature.id, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false }, window.location.href);
    try { await navigator.clipboard?.writeText(link); setShareMessage("Share link copied."); } catch { setShareMessage(link); }
    window.setTimeout(() => setShareMessage(null), 2500);
  };

  const toggleCategory = (category: PlaceCategory) => {
    setSelectedCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  };

  const featureFilter = useCallback((feature: Feature) => {
    if (selectedCategories.length === 0 || feature.kind !== "poi") return true;
    const categories = placeCategoriesFromFeature(feature);
    return selectedCategories.some((category) => categories.includes(category));
  }, [selectedCategories]);

  const toggleLayer = (layer: RuntimeLayerId) => {
    setLayerVisibility((current) => ({ ...current, [layer]: !current[layer] }));
  };

  const selectedRuntimeFeature = fixtureAdapter.getFeature(selectedFeature.id);
  const selectedCatalogEntity: CanonicalEntity | undefined = syntheticCatalog.entities.find((entity) => entity.canonicalId === selectedCatalogEntityId)
    ?? syntheticCatalog.entities.find((entity) => entity.fields.runtimeFeatureId === selectedFeature.id);
  const relatedFeatureIds = selectedCatalogEntity ? [...selectedCatalogEntity.fields.links.buildingIds, ...selectedCatalogEntity.fields.links.areaIds, ...selectedCatalogEntity.fields.links.transitIds] : [];
  const relatedFeatures = relatedFeatureIds.map((id) => fixtureAdapter.getFeature(id)).filter((feature): feature is Feature => Boolean(feature));
  const nearbyTransit = findNearbyFeatures(selectedRuntimeFeature, fixtureAdapter.getFeatures(), {
    thresholdMeters: DEFAULT_PROXIMITY_THRESHOLD_METERS,
    maxResults: DEFAULT_PROXIMITY_MAX_RESULTS,
    predicate: (feature) => feature.kind === "transit-station" || feature.kind === "transit-entrance",
  });
  const proximityOriginAvailable = representativePoint(selectedRuntimeFeature) !== null;
  const routeOriginName = fixtureAdapter.getFeature(routeOriginId ?? "")?.name ?? "Not set";
  const routeDestinationName = fixtureAdapter.getFeature(routeDestinationId ?? "")?.name ?? "Not set";
  const selectedRouteSupported = Boolean(routeAdapter?.canRouteFeature(selectedRuntimeFeature, routeMode));
  const routeOriginFeature = fixtureAdapter.getFeature(routeOriginId ?? "");
  const routeDestinationFeature = fixtureAdapter.getFeature(routeDestinationId ?? "");
  const routeEndpointsSupported = Boolean(routeAdapter && routeOriginFeature && routeDestinationFeature
    && routeAdapter.canRouteFeature(routeOriginFeature, routeMode)
    && routeAdapter.canRouteFeature(routeDestinationFeature, routeMode));
  const setRouteEndpointFromSelected = (endpoint: "origin" | "destination") => {
    if (!selectedRuntimeFeature || !routeAdapter || !routeAdapter.canRouteFeature(selectedRuntimeFeature, routeMode)) {
      setRouteMessage(`Selected ${selectedRuntimeFeature?.kind ?? "feature"} is unsupported by the synthetic ${routeMode} graph.`);
      return;
    }
    if (endpoint === "origin") { setRouteOriginId(selectedRuntimeFeature.id); setRouteOriginQuery(selectedRuntimeFeature.name); }
    else { setRouteDestinationId(selectedRuntimeFeature.id); setRouteDestinationQuery(selectedRuntimeFeature.name); }
    setRouteMessage("");
  };
  const resolveRouteSearch = (endpoint: "origin" | "destination") => {
    const queryValue = endpoint === "origin" ? routeOriginQuery : routeDestinationQuery;
    const match = fixtureAdapter.search(queryValue)[0];
    if (!match) { setRouteMessage(`No synthetic feature matches “${queryValue}”.`); return; }
    if (!routeAdapter || !routeAdapter.canRouteFeature(match, routeMode)) {
      if (endpoint === "origin") setRouteOriginId(null); else setRouteDestinationId(null);
      setRouteMessage(`${match.name} is unsupported by the synthetic ${routeMode} graph; choose a linked point endpoint.`);
      return;
    }
    if (endpoint === "origin") setRouteOriginId(match.id);
    else setRouteDestinationId(match.id);
    setRouteMessage("");
  };
  const calculateRoute = () => {
    const origin = fixtureAdapter.getFeature(routeOriginId ?? ""); const destination = fixtureAdapter.getFeature(routeDestinationId ?? "");
    if (!origin || !destination || !routeAdapter) { setRouteMessage("Set both endpoints after the local fixture graph loads."); return; }
    if (!routeAdapter.canRouteFeature(origin, routeMode) || !routeAdapter.canRouteFeature(destination, routeMode)) {
      setItinerary(null);
      setRouteMessage(`One or more endpoints are unsupported by the synthetic ${routeMode} graph.`);
      return;
    }
    const nextItinerary = routeAdapter.route(origin, destination, routeMode, { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null });
    setItinerary(nextItinerary);
    setRouteMessage(nextItinerary ? "Synthetic route calculated; not real navigation." : "No synthetic route connects these endpoints in the selected mode.");
  };
  const clearRoute = () => { setItinerary(null); setRouteMessage(""); setPreviewRequest((current) => ({ action: "stop", requestId: (current?.requestId ?? 0) + 1 })); };
  const swapRoute = () => { setRouteOriginId(routeDestinationId); setRouteDestinationId(routeOriginId); setRouteOriginQuery(routeDestinationQuery); setRouteDestinationQuery(routeOriginQuery); setItinerary(null); };
  const preview = (action: "start" | "pause" | "stop" | "previous" | "next" | "focus") => {
    const count = journeyStepCount(itinerary);
    if (action !== "pause" && action !== "stop") setPreviewStep((current) => stepIndex(current, action, count));
    setPreviewRequest((current) => ({ action, requestId: (current?.requestId ?? 0) + 1 }));
  };
  const routeLines = useMemo(() => itinerary, [itinerary]);
  const updateCamera = (next: Partial<CameraPose>, nextMode = cameraMode) => {
    const normalized = normalizeCameraPose({ ...cameraPose, ...next });
    if (!normalized) return;
    setCameraMode(nextMode); setCameraPose(normalized); setPoseInvalid(false);
    setCameraRequest((current) => ({ ...normalized, requestId: (current?.requestId ?? 0) + 1 }));
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrl({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: nextMode, pose: normalized, poseInvalid: false }, window.location.href));
  };
  const focusCurrentSelection = () => {
    if (!selectedRuntimeFeature) return;
    setActiveSelectionId(selectedRuntimeFeature.id);
    updateCamera({ longitude: selectedRuntimeFeature.coordinates[0], latitude: selectedRuntimeFeature.coordinates[1], height: 240, pitch: -35 }, "explore");
    setFocusRequest((request) => request + 1);
  };
  const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.currentTarget !== document.activeElement) return;
    const delta = 0.0015;
    if (event.key === "ArrowUp") { event.preventDefault(); updateCamera({ latitude: cameraPose.latitude + delta }); }
    else if (event.key === "ArrowDown") { event.preventDefault(); updateCamera({ latitude: cameraPose.latitude - delta }); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); updateCamera({ longitude: cameraPose.longitude - delta }); }
    else if (event.key === "ArrowRight") { event.preventDefault(); updateCamera({ longitude: cameraPose.longitude + delta }); }
    else if (event.key.toLowerCase() === "n") { event.preventDefault(); updateCamera({ heading: 0 }); }
    else if (event.key === "Home") { event.preventDefault(); updateCamera(DEFAULT_CAMERA_POSE, "overview"); }
  };
  const saveCurrentPlace = () => {
    setSavedNavigation((current) => savePlace(current, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: selectedFeature.id, label: selectedFeature.name, savedAt: new Date().toISOString() }));
  };
  const saveCurrentJourney = () => {
    if (!itinerary) return;
    const journeyId = `journey:${itinerary.originFeatureId}:${itinerary.destinationFeatureId}:${itinerary.mode}`;
    setSavedNavigation((current) => saveJourney(current, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, id: journeyId, originFeatureId: itinerary.originFeatureId, destinationFeatureId: itinerary.destinationFeatureId, mode: itinerary.mode, label: `${routeOriginName} → ${routeDestinationName}`, savedAt: new Date().toISOString() }));
  };
  const restorePlace = (canonicalId: string) => { const feature = fixtureAdapter.getFeature(canonicalId); if (feature) { selectFeature(feature); setFocusRequest((request) => request + 1); } };
  const restoreJourney = (journey: SavedNavigationState["journeys"][number]) => { setRouteOriginId(journey.originFeatureId); setRouteDestinationId(journey.destinationFeatureId); setRouteOriginQuery(fixtureAdapter.getFeature(journey.originFeatureId)?.name ?? ""); setRouteDestinationQuery(fixtureAdapter.getFeature(journey.destinationFeatureId)?.name ?? ""); setRouteMode(journey.mode); setItinerary(null); setRouteMessage("Saved journey restored; calculate to preview the synthetic route."); };

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand" aria-label="Urban Digital Twin home">
          <span className="brand-mark" aria-hidden="true">
            UDT
          </span>
          <span>Urban Digital Twin</span>
        </div>
        <div className="search-shell">
          <form className="search" onSubmit={submitSearch} role="search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-activedescendant={activeSearchIndex >= 0 ? `search-result-${activeSearchIndex}` : undefined}
              aria-autocomplete="list"
              aria-controls="unified-search-results"
              aria-expanded={searchOpen && query.length > 0}
              aria-label="Search Manhattan"
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveSearchIndex(-1); }}
              onFocus={() => setSearchOpen(query.length > 0)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search buildings, places, areas, transit"
              role="combobox"
              value={query}
            />
          </form>
          {searchOpen && query.length > 0 && (
            <div className="search-results" id="unified-search-results" role="listbox" aria-label="Search results">
              {unifiedResults.length > 0 ? unifiedResults.slice(0, 8).map((result, index) => (
                <button className={index === activeSearchIndex ? "search-result is-active" : "search-result"} id={`search-result-${index}`} key={result.feature.id} onClick={() => selectSearchResult(result)} role="option" aria-selected={index === activeSearchIndex} type="button">
                  <span className="search-result-icon" aria-hidden="true">{result.typeLabel.slice(0, 1)}</span>
                  <span><strong>{result.feature.name}</strong><small>{result.typeLabel} · {result.group} · {result.matchedBy}</small></span>
                </button>
              )) : <p className="search-empty" role="status">No fixture result for “{query}”. Try a source ID, alias, address, or category.</p>}
            </div>
          )}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setQualityOpen((open) => !open)}><Database size={18} />Data</button>
          <button type="button"><Clock3 size={18} />Time</button>
        </div>
      </header>

      <nav className="navigation-rail" aria-label="Primary navigation">
        <div>
          {navigation.map(({ label, icon: Icon }) => (
            <button
              className={activeNavigation === label ? "is-active" : ""}
              key={label}
              onClick={() => setActiveNavigation(label)}
              type="button"
            >
              <Icon aria-hidden="true" size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div>
          <button type="button" aria-pressed={helpOpen} onClick={() => { setHelpOpen((open) => !open); setSettingsOpen(false); }}><HelpCircle size={21} /><span>Help</span></button>
          <button type="button" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen((open) => !open); setHelpOpen(false); }}><Settings size={21} /><span>Settings</span></button>
        </div>
      </nav>

      <section className="map-region" aria-label="City explorer">
        <CesiumViewport
          adapter={fixtureAdapter}
          assetResolver={fixtureAdapter.assetResolver}
          focusRequest={focusRequest}
          focusFeatureId={focusFeatureId}
          onFeatureSelected={selectFeature}
          featureFilter={featureFilter}
          visibleLayers={layerVisibility}
          itinerary={routeLines}
          previewRequest={previewRequest}
          denseRendering={stressMode}
          denseFeatures={stressFeatures}
          selectedFeatureId={selectedFeature.id}
          onCameraChanged={onTileCameraChanged}
          cameraRequest={stressCameraRequest}
          cameraPoseRequest={cameraRequest}
          onViewportKeyDown={onViewportKeyDown}
        />
        <section className="camera-controls" aria-label="Camera controls">
          <span>Camera</span>
          <button type="button" className={cameraMode === "overview" ? "is-selected" : ""} aria-pressed={cameraMode === "overview"} onClick={() => updateCamera(DEFAULT_CAMERA_POSE, "overview")}>Overview</button>
          <button type="button" className={cameraMode === "explore" ? "is-selected" : ""} aria-pressed={cameraMode === "explore"} onClick={() => updateCamera({ height: 700, pitch: -35 }, "explore")}>Explore</button>
          <button type="button" onClick={() => updateCamera({ heading: 0 })}>North</button>
          <button type="button" onClick={() => updateCamera(DEFAULT_CAMERA_POSE, "overview")}>Reset</button>
          <button type="button" onClick={focusCurrentSelection}>Current selection</button>
          <small>Keyboard arrows move only when this 3D viewport is focused; no street-level imagery or live navigation.</small>
          {poseInvalid && <small role="status">Malformed camera pose ignored; safe bounded view is active.</small>}
        </section>
        <div className="runtime-note">
          Local runtime layer
          <span>Synthetic fixture only · no real Manhattan coverage</span>
        </div>
        {deepLinkMessage && <div className="exploration-notice" role="alert">{deepLinkMessage} <button type="button" onClick={() => { setDeepLinkMessage(null); setPoseInvalid(false); window.history.replaceState({}, "", navigationUrl({ featureId: activeSelectionRef.current, query, cameraMode, pose: cameraPose, poseInvalid: false }, window.location.href)); }}>Dismiss</button></div>}
        {shareMessage && <div className="share-notice" role="status">{shareMessage}</div>}
        <section className="tile-diagnostics" aria-label="Tile diagnostics">
          <div><strong>Tile diagnostics</strong><button type="button" aria-pressed={stressMode} onClick={() => setStressMode((enabled) => !enabled)}>{stressMode ? "Normal mode" : "Stress harness"}</button></div>
          <span>Fixture-only synthetic harness · not full-Manhattan performance</span>
          <span>Assets: {fixtureAdapter.getAssetDiagnostics().registered} registered · {fixtureAdapter.getAssetDiagnostics().approved} approved · {fixtureAdapter.getAssetDiagnostics().verified} verified · procedural fallback retained when unavailable</span>
          {stressMode ? <div className="tile-stress-controls" aria-label="Synthetic camera anchors">
            <button type="button" onClick={() => moveStressCamera(0, 4_000)}>Center tile</button>
            <button type="button" onClick={() => moveStressCamera(1, 4_000)}>West tile</button>
            <button type="button" onClick={() => moveStressCamera(2, 4_000)}>North tile</button>
            <button type="button" onClick={() => moveStressCamera(2, 100)}>Zoom closer</button>
          </div> : null}
          <dl>
            <div><dt>LOD</dt><dd>{tileMetrics.selectedLod ?? "—"}</dd></div>
            <div><dt>Visible / requested</dt><dd>{tileMetrics.visibleTileCount} / {tileMetrics.requestedTileCount}</dd></div>
            <div><dt>Loaded / evicted</dt><dd>{tileMetrics.loadedTileCount} / {tileMetrics.evictedTileCount}</dd></div>
            <div><dt>Failed / active</dt><dd>{tileMetrics.failedTileCount} / {tileMetrics.activeRequests}</dd></div>
            <div><dt>Cancelled / stale</dt><dd>{tileMetrics.cancelledRequestCount} / {tileMetrics.staleResultCount}</dd></div>
            <div><dt>Bytes / features</dt><dd>{tileMetrics.loadedBytes.toLocaleString()} / {tileMetrics.renderedFeatureCount}</dd></div>
          </dl>
        </section>
        {qualityOpen && (
          <section className="quality-panel" aria-label="Data quality">
            <div className="quality-heading"><strong>Data quality</strong><button type="button" onClick={() => setQualityOpen(false)}>Close</button></div>
            <p className="section-label">Synthetic fixture catalog only · no real provider records</p>
            <p className="section-label">Unpublished vertical-slice release {syntheticCatalogRelease.releaseVersion} · {syntheticCatalogRelease.releaseId}</p>
            <dl>
              <div><dt>Artifacts / layers</dt><dd>{syntheticCatalogRelease.recordCounts.artifacts} / {syntheticCatalogRelease.tileCoverage.partitionCount}</dd></div>
              <div><dt>Accepted / rejected</dt><dd>{syntheticCatalogRelease.recordCounts.accepted} / {syntheticCatalogRelease.recordCounts.rejected}</dd></div>
              <div><dt>Freshness range</dt><dd>{syntheticCatalogRelease.freshness.earliest ?? "Unknown"} → {syntheticCatalogRelease.freshness.latest ?? "Unknown"}</dd></div>
              <div><dt>Changes / affected tiles</dt><dd>{syntheticCatalogRelease.releaseDiff?.entries.length ?? 0} / {syntheticCatalogRelease.releaseDiff?.affectedTileKeys.length ?? 0}</dd></div>
              <div><dt>Explicit tombstones</dt><dd>{syntheticCatalogRelease.recordCounts.tombstones}</dd></div>
              <div><dt>Canonical entities</dt><dd>{syntheticCatalog.quality.canonicalEntityCount}</dd></div>
              <div><dt>Source observations</dt><dd>{syntheticCatalog.quality.sourceObservationCount}</dd></div>
              <div><dt>Merged groups</dt><dd>{syntheticCatalog.quality.mergedGroupCount}</dd></div>
              <div><dt>Unmerged / quarantined</dt><dd>{syntheticCatalog.quality.unmergedCandidateCount} / {syntheticCatalog.quality.quarantinedCount}</dd></div>
              <div><dt>Conflicts / stale</dt><dd>{syntheticCatalog.quality.conflictCount} / {syntheticCatalog.quality.staleObservationCount}</dd></div>
              <div><dt>Rejected records</dt><dd>{syntheticCatalog.quality.rejectedRecordCount}</dd></div>
              <div><dt>Pending-source refusal</dt><dd>{syntheticCatalog.quality.pendingSourceRefusal ? "Yes" : "No"}</dd></div>
            </dl>
            <button type="button" onClick={() => {
              const conflict = syntheticCatalog.entities.find((entity) => entity.conflicts.length > 0);
              const feature = conflict?.fields.runtimeFeatureId ? fixtureAdapter.getFeature(conflict.fields.runtimeFeatureId) : undefined;
              if (conflict && feature) { setSelectedCatalogEntityId(conflict.canonicalId); selectFeature(feature); }
            }}>Inspect synthetic conflict</button>
          </section>
        )}
        {activeNavigation === "Bookmarks" && <section className="bookmarks-panel" aria-label="Saved places and journeys">
          <div className="quality-heading"><strong>Bookmarks</strong><span>Local only · no remote sync</span></div>
          <h2>Saved places</h2>
          {savedNavigation.places.length ? <ul>{savedNavigation.places.map((place) => <li key={place.canonicalId}><button type="button" onClick={() => restorePlace(place.canonicalId)}>{place.label}</button><small>{place.canonicalId}</small></li>)}</ul> : <p className="section-label">No saved places yet.</p>}
          <h2>Saved journeys</h2>
          {savedNavigation.journeys.length ? <ul>{savedNavigation.journeys.map((journey) => <li key={journey.id}><button type="button" onClick={() => restoreJourney(journey)}>{journey.label}</button><small>{journey.mode} · local synthetic route</small></li>)}</ul> : <p className="section-label">No saved journeys yet.</p>}
        </section>}
        {helpOpen && <section className="help-panel" aria-label="Help"><strong>Help</strong><p>Search or focus a fixture feature, then inspect its provenance. Use the camera controls or focus the viewport before arrow-key exploration; routes and camera previews are synthetic offline fixtures.</p><button type="button" onClick={() => setHelpOpen(false)}>Close</button></section>}
        {settingsOpen && <section className="settings-panel" aria-label="Settings"><strong>Settings</strong><p>Provider connections, live navigation, street imagery, and remote sync are not enabled. Reduced-motion preferences are honored by the camera journey.</p><button type="button" onClick={() => setSettingsOpen(false)}>Close</button></section>}
        <div className="layer-controls" aria-label="Runtime layers">
          {(Object.keys(LAYER_LABELS) as RuntimeLayerId[]).map((layer) => (
            <button
              aria-pressed={layerVisibility[layer]}
              className={layerVisibility[layer] ? "is-visible" : ""}
              key={layer}
              onClick={() => toggleLayer(layer)}
              type="button"
            >
              <span className={`layer-dot layer-dot-${layer}`} />
              {LAYER_LABELS[layer]}
            </button>
          ))}
        </div>
        <div className="category-controls" aria-label="POI categories">
          <span>POI</span>
          {PLACE_CATEGORIES.filter((category) => ["restaurant", "cafe", "bar", "retail", "department-store", "grocery", "attraction", "museum"].includes(category)).map((category) => (
            <button
              aria-pressed={selectedCategories.includes(category)}
              className={selectedCategories.includes(category) ? "is-selected" : ""}
              key={category}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              {category}
            </button>
          ))}
        </div>
        <section className="directions-panel" aria-label="Synthetic directions">
          <div className="directions-heading"><strong>Directions</strong><span>Synthetic 3D route preview</span></div>
          <div className="direction-field">
            <label htmlFor="route-origin">Start</label>
            <input id="route-origin" aria-label="Directions start" value={routeOriginQuery} onChange={(event) => setRouteOriginQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") resolveRouteSearch("origin"); }} placeholder="Search a start feature" />
            <button type="button" onClick={() => resolveRouteSearch("origin")} disabled={!routeAdapter}>Set</button>
          </div>
          <div className="direction-field">
            <label htmlFor="route-destination">End</label>
            <input id="route-destination" aria-label="Directions destination" value={routeDestinationQuery} onChange={(event) => setRouteDestinationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") resolveRouteSearch("destination"); }} placeholder="Search a destination feature" />
            <button type="button" onClick={() => resolveRouteSearch("destination")} disabled={!routeAdapter}>Set</button>
          </div>
          <div className="direction-endpoints"><span>From: {routeOriginName}</span><span>To: {routeDestinationName}</span></div>
          <div className="direction-actions">
            <button type="button" className={routeMode === "walking" ? "is-selected" : ""} aria-pressed={routeMode === "walking"} onClick={() => setRouteMode("walking")}>Walking</button>
            <button type="button" className={routeMode === "transit" ? "is-selected" : ""} aria-pressed={routeMode === "transit"} onClick={() => setRouteMode("transit")}>Synthetic transit</button>
            <button type="button" onClick={swapRoute}>Swap</button>
            <button type="button" onClick={clearRoute}>Clear</button>
          </div>
          <button className="calculate-route" type="button" onClick={calculateRoute} disabled={!routeEndpointsSupported}>Calculate synthetic route</button>
          {routeAdapter && !routeEndpointsSupported && (routeOriginId || routeDestinationId) && <p className="route-message" role="status">Choose valid point endpoints linked to the offline graph; areas, routes, polygons, stale IDs, and unsupported modes cannot be routed.</p>}
          {routeMessage && <p className="route-message" role="status">{routeMessage}</p>}
          {itinerary && (
            <div className="itinerary-result" aria-label="Synthetic itinerary">
              <strong>{(itinerary.distanceMeters / 1000).toFixed(2)} km · {Math.ceil(itinerary.durationSeconds / 60)} min</strong>
              <small>Fixture estimate only · source and accessibility uncertainty retained</small>
              <ol aria-label="Itinerary steps">{itinerary.legs.flatMap((leg) => leg.steps).map((step) => <li key={step.id}>{step.instruction} · {Math.round(step.distanceMeters)} m</li>)}</ol>
              <div className="preview-controls" aria-label="Route camera preview">
                <span>Camera journey</span>
                <button type="button" onClick={() => preview("start")}>Start</button>
                <button type="button" onClick={() => preview("pause")}>Pause</button>
                <button type="button" onClick={() => preview("stop")}>Stop</button>
                <button type="button" onClick={() => preview("previous")}>Previous</button>
                <button type="button" onClick={() => preview("next")}>Next</button>
                <button type="button" onClick={() => preview("focus")}>Focus step</button>
                <small>Step {Math.min(previewStep + 1, journeyStepCount(itinerary) || 1)} of {journeyStepCount(itinerary) || 0} · synthetic fixture only</small>
              </div>
              <button type="button" onClick={saveCurrentJourney}>Save journey locally</button>
            </div>
          )}
        </section>
        {!inspectorOpen && (
          <button
            className="open-inspector"
            onClick={() => setInspectorOpen(true)}
            type="button"
          >
            Open details
          </button>
        )}
      </section>

      {inspectorOpen && (
        <aside className="inspector" aria-label="Selected feature details">
          <div className="inspector-actions">
            <button
              aria-label="Collapse details"
              onClick={() => setInspectorOpen(false)}
              type="button"
            >
              <ChevronLeft />
            </button>
            <button aria-label="Close details" onClick={() => setInspectorOpen(false)} type="button"><X /></button>
          </div>
          <h1 ref={detailsHeadingRef} tabIndex={-1}>{selectedFeature.name}</h1>

          <section className="inspector-section">
            <h2>Overview</h2>
            <dl>
              <div><dt>Location</dt><dd>{selectedFeature.location}</dd></div>
              <div>
                <dt>Coordinates</dt>
                <dd>
                  {selectedFeature.coordinates.latitude.toFixed(4)}, {" "}
                  {selectedFeature.coordinates.longitude.toFixed(4)} ({" "}
                  {selectedFeature.coordinates.heightMeters.toFixed(1)} m)
                </dd>
              </div>
              <div><dt>Geometry</dt><dd>{selectedFeature.geometry}</dd></div>
              <div><dt>Feature ID</dt><dd>{selectedFeature.id}</dd></div>
              <div><dt>Confidence</dt><dd>{selectedFeature.confidence.label} ({selectedFeature.confidence.score.toFixed(2)})</dd></div>
              <div><dt>Uncertainty</dt><dd>{selectedFeature.uncertainty}</dd></div>
              <div><dt>Freshness</dt><dd>{selectedFeature.freshness.observedAt ?? "Not observed"}</dd></div>
            </dl>
          </section>

          <section className="inspector-section asset-detail" aria-label="3D asset diagnostics">
            <h2>3D asset diagnostics</h2>
            {(() => {
              const resolution = fixtureAdapter.getAssetResolution(selectedFeature.id, 240, 1);
              return resolution.kind === "asset" ? <dl><div><dt>Resolution</dt><dd>Verified {resolution.lod.id}</dd></div><div><dt>Content</dt><dd>{resolution.lod.content.relativeContentRef}</dd></div><div><dt>Geometric error</dt><dd>{resolution.lod.geometricErrorMeters} m</dd></div></dl> : <><p className="section-label">Procedural geometry fallback remains active.</p><p className="section-label" role="status">{resolution.diagnostic.message}</p></>;
            })()}
          </section>

          {selectedCatalogEntity && (
            <section className="inspector-section reconciliation-detail">
              <h2>Source &amp; freshness</h2>
              <p className="section-label">Canonical catalog projection · fixture only</p>
              <dl>
                <div><dt>Canonical ID</dt><dd>{selectedCatalogEntity.canonicalId}</dd></div>
                <div><dt>Merged from</dt><dd>{selectedCatalogEntity.observationIds.length} source observations · reversible merge</dd></div>
                <div><dt>Last observed</dt><dd>{selectedCatalogEntity.observedAt ?? "Unknown"}</dd></div>
                <div><dt>Valid interval</dt><dd>{selectedCatalogEntity.validFrom ?? "Unknown"} → {selectedCatalogEntity.validTo ?? "Unknown"}</dd></div>
                <div><dt>Confidence</dt><dd>{selectedCatalogEntity.confidence.toFixed(2)}</dd></div>
                <div><dt>Uncertainty</dt><dd>{selectedCatalogEntity.uncertainty || "Unknown"}</dd></div>
                {hasDisplayValue(selectedCatalogEntity.fields.address.formatted) && <div><dt>Address</dt><dd>{selectedCatalogEntity.fields.address.formatted}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.contact.phone) || hasDisplayValue(selectedCatalogEntity.fields.contact.website) ? <div><dt>Contact</dt><dd>{[selectedCatalogEntity.fields.contact.phone, selectedCatalogEntity.fields.contact.website].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedCatalogEntity.fields.brand) || hasDisplayValue(selectedCatalogEntity.fields.operator) ? <div><dt>Brand / operator</dt><dd>{[selectedCatalogEntity.fields.brand, selectedCatalogEntity.fields.operator].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedCatalogEntity.fields.cuisine) && <div><dt>Cuisine</dt><dd>{selectedCatalogEntity.fields.cuisine}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.openingHours.raw) && <div><dt>Hours</dt><dd>{selectedCatalogEntity.fields.openingHours.raw} ({selectedCatalogEntity.fields.openingHours.parsedStatus})</dd></div>}
                {selectedCatalogEntity.fields.accessibility !== "unknown" && <div><dt>Accessibility</dt><dd>{selectedCatalogEntity.fields.accessibility}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.priceLevel) || selectedCatalogEntity.fields.rating !== null ? <div><dt>Price / rating</dt><dd>{[selectedCatalogEntity.fields.priceLevel, selectedCatalogEntity.fields.rating].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {selectedCatalogEntity.conflicts.length > 0 && <div><dt>Conflicts</dt><dd>{selectedCatalogEntity.conflicts.map((conflict) => `${conflict.field}: conflicting values`).join("; ")}</dd></div>}
              </dl>
              {selectedCatalogEntity.conflicts.length > 0 && <div className="conflict-list">{selectedCatalogEntity.conflicts.map((conflict) => <div key={conflict.field}><strong>{conflict.field}</strong><small>{conflict.values.join(" · ")}</small><small>{conflict.sourceRefIds.join(", ")}</small></div>)}</div>}
              <details><summary>Field sources</summary><ul>{selectedCatalogEntity.fieldProvenance.map((field) => <li key={field.field}><strong>{field.field}</strong> · {field.sourceRefIds.join(", ")} · observed {field.observedAt ?? "Unknown"}</li>)}</ul></details>
            </section>
          )}

          <section className="inspector-section relationship-detail">
            <h2>Related entities</h2>
            {relatedFeatures.length > 0 ? <ul className="related-list">{relatedFeatures.map((feature) => <li key={feature.id}><button type="button" onClick={() => { selectFeature(feature); setFocusRequest((request) => request + 1); }}>{feature.name}<small>{feature.kind}</small></button></li>)}</ul> : <p className="section-label">No source-linked related entities recorded for this feature.</p>}
            <h3>Nearby transit</h3>
            {nearbyTransit.length > 0 ? <ul className="related-list">{nearbyTransit.map(({ feature, distanceMeters, method }) => <li key={feature.id}><button type="button" onClick={() => { selectFeature(feature); setFocusRequest((request) => request + 1); }}>{feature.name}<small>{feature.kind} · {formatDistanceMeters(distanceMeters)} · geometry-derived {method}</small></button></li>)}</ul> : <p className="section-label">{proximityOriginAvailable ? "Unknown · no geometry-derived transit within 1,000 meters." : "Proximity unavailable · this geometry has no trustworthy representative point."}</p>}
          </section>

          {selectedFeature.kind === "poi" && (
            <section className="inspector-section poi-detail">
              <h2>Place details</h2>
              <dl>
                {hasDisplayValue(selectedFeature.attributes.placeCategories) && <div><dt>Categories</dt><dd>{selectedFeature.attributes.placeCategories?.toString().split(",").join(", ")}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeAddress) && <div><dt>Address</dt><dd>{selectedFeature.attributes.placeAddress?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeWebsite) && <div><dt>Website</dt><dd>{selectedFeature.attributes.placeWebsite?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placePhone) && <div><dt>Phone</dt><dd>{selectedFeature.attributes.placePhone?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeCuisine) || hasDisplayValue(selectedFeature.attributes.placeBrand) ? <div><dt>Cuisine / brand</dt><dd>{[selectedFeature.attributes.placeCuisine, selectedFeature.attributes.placeBrand].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedFeature.attributes.placeOpeningHours) && <div><dt>Opening hours</dt><dd>{selectedFeature.attributes.placeOpeningHours?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeAccessibility) && <div><dt>Accessibility</dt><dd>{selectedFeature.attributes.placeAccessibility?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeLicenses) && <div><dt>License provenance</dt><dd>{selectedFeature.attributes.placeLicenses?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeConflicts) && <div><dt>Source conflicts</dt><dd>{selectedFeature.attributes.placeConflicts?.toString()}</dd></div>}
              </dl>
            </section>
          )}

          {selectedFeature.kind === "area" && (
            <section className="inspector-section area-detail">
              <h2>Area details</h2>
              <dl>
                <div><dt>Semantics</dt><dd>{isAreaSemantic(selectedFeature.attributes.areaSemantics) ? areaSemanticsLabel(selectedFeature.attributes.areaSemantics) : "Unknown"}</dd></div>
                {hasDisplayValue(selectedFeature.attributes.areaType) || hasDisplayValue(selectedFeature.attributes.areaLevel) ? <div><dt>Area type / level</dt><dd>{[selectedFeature.attributes.areaType, selectedFeature.attributes.areaLevel].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedFeature.attributes.areaOfficialName) && <div><dt>Official name</dt><dd>{selectedFeature.attributes.areaOfficialName?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaLabels) && <div><dt>Labels</dt><dd>{selectedFeature.attributes.areaLabels?.toString()}</dd></div>}
                {(selectedFeature.freshness.updatedAt || selectedFeature.freshness.capturedAt) && <div><dt>Source date</dt><dd>{selectedFeature.freshness.updatedAt ?? selectedFeature.freshness.capturedAt}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaUncertainty) && <div><dt>Boundary uncertainty</dt><dd>{selectedFeature.attributes.areaUncertainty?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaLicense) && <div><dt>License provenance</dt><dd>{selectedFeature.attributes.areaLicense?.toString()}</dd></div>}
              </dl>
            </section>
          )}

          {(selectedFeature.kind === "transit-station" || selectedFeature.kind === "transit-entrance" || selectedFeature.kind === "transit-route") && (
            <section className="inspector-section transit-detail">
              <h2>Transit details</h2>
              <p className="section-label">Synthetic fixture only · no live arrivals or routing</p>
              <dl>
                <div><dt>Transit kind</dt><dd>{transitKindLabel(selectedFeature.kind)}</dd></div>
                <div><dt>Mode</dt><dd>{selectedFeature.attributes.transitMode?.toString() || "Unknown"}</dd></div>
                <div><dt>Station complex</dt><dd>{selectedFeature.attributes.transitStationComplexId?.toString() || "Unknown"}</dd></div>
                <div><dt>Parent station</dt><dd>{selectedFeature.attributes.transitParentStationId?.toString() || "Unknown"}</dd></div>
                <div><dt>Parent stop</dt><dd>{selectedFeature.attributes.transitParentStopId?.toString() || "Unknown"}</dd></div>
                <div><dt>Routes / services</dt><dd>{selectedFeature.attributes.transitRouteNames?.toString() || selectedFeature.attributes.transitRouteIds?.toString() || "Unknown"}</dd></div>
                <div><dt>Service date</dt><dd>{selectedFeature.attributes.transitServiceDate?.toString() || "Unknown"}</dd></div>
                <div><dt>Semantics</dt><dd>{selectedFeature.attributes.transitServiceSemantics?.toString() || "Unknown"}</dd></div>
                <div><dt>Accessibility</dt><dd>{selectedFeature.attributes.transitAccessibility?.toString() || "Unknown"}</dd></div>
                <div><dt>Elevator status</dt><dd>{selectedFeature.attributes.transitElevatorStatus?.toString() || "Unknown"}</dd></div>
                <div><dt>Geometry meaning</dt><dd>{selectedFeature.attributes.transitGeometrySemantics?.toString() || (selectedFeature.kind === "transit-route" ? "Schematic centerline; not an exact tunnel path" : "Point location")}</dd></div>
                <div><dt>License / attribution</dt><dd>{selectedFeature.attributes.transitSourceLicense?.toString() || "Not recorded"}</dd></div>
              </dl>
            </section>
          )}

          <section className="inspector-section route-selection">
            <h2>Directions</h2>
            <p className="section-label">{selectedRouteSupported ? "Use this selected fixture feature as a route endpoint." : "Unsupported for this offline graph: only valid linked or nearby point features can be route endpoints."}</p>
            <div className="route-selection-actions">
              <button type="button" onClick={() => setRouteEndpointFromSelected("origin")} disabled={!selectedRouteSupported}>Set start</button>
              <button type="button" onClick={() => setRouteEndpointFromSelected("destination")} disabled={!selectedRouteSupported}>Set destination</button>
              <button type="button" onClick={saveCurrentPlace}>{savedNavigation.places.some((place) => place.canonicalId === selectedFeature.id) ? "Saved locally" : "Save place locally"}</button>
            </div>
          </section>

          <section className="inspector-section">
            <h2>Sources</h2>
            <p className="section-label">
              {selectedFeature.provenanceRecord.label} · local fixture only
            </p>
            <div className="provenance-list">
              {(["authoritative", "derived", "generated"] as const).map((kind) => (
                <div className={kind === selectedFeature.provenance ? "is-current" : ""} key={kind}>
                  <span className={`provenance-swatch provenance-${kind}`} />
                  <span>
                    <strong>{provenanceLabel(kind)}</strong>
                    <small>
                      {kind === selectedFeature.provenance
                        ? "Current normalized local fixture; not production city data."
                        : kind === "generated"
                          ? "Visible runtime-only geometry; not ground truth."
                          : "No source connected in this setup milestone."}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <dl className="source-record">
              <div>
                <dt>Source URL</dt>
                <dd>{selectedFeature.provenanceRecord.sourceUrl ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{selectedFeature.provenanceRecord.capturedAt ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{selectedFeature.provenanceRecord.updatedAt ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Source record</dt>
                <dd>{selectedFeature.sourceRefs[0]?.sourceRecordId ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Ingestion rejects</dt>
                <dd>{selectedFeature.ingestionSummary.rejectionReport}</dd>
              </div>
            </dl>
          </section>

          <div className="inspector-footer">
            <button className="primary-action" onClick={focusMarker} type="button">
              <Crosshair size={18} />Focus
            </button>
            <button disabled type="button">Compare</button>
            <button type="button" onClick={copyShareLink}><Crosshair size={18} />Copy share link</button>
          </div>
        </aside>
      )}

      <footer className="status-bar">
        <span>Manhattan, New York</span>
        <span><Box size={16} />Cesium entities ready</span>
        <span className="status-pending">Fixture data only · provider approval pending</span>
      </footer>
    </main>
  );
}
