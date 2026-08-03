import { useEffect, useRef } from "react";
import type { KeyboardEventHandler } from "react";
import {
  Cartesian3,
  Cartesian2,
  Color,
  ColorGeometryInstanceAttribute,
  EllipsoidTerrainProvider,
  GridImageryProvider,
  HeightReference,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  PolygonHierarchy,
  PolygonGeometry,
  GeometryInstance,
  PerInstanceColorAppearance,
  Primitive,
  PointPrimitiveCollection,
  PrimitiveCollection,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import type { Feature, Position } from "../../domain/schema";
import type { Itinerary } from "../../domain/routing";
import { layerForFeature, type LayerVisibility } from "../../runtime/layers";
import type { RuntimeCityAdapter } from "../../runtime/fixture-adapter";
import type { TileCameraState } from "../../runtime/tile-stream";
import type { CameraPose } from "../../domain/visitor-navigation";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";

interface CesiumViewportProps {
  adapter: RuntimeCityAdapter;
  focusRequest: number;
  focusFeatureId: string | null;
  visibleLayers: LayerVisibility;
  onFeatureSelected: (feature: Feature) => void;
  featureFilter?: (feature: Feature) => boolean;
  itinerary?: Itinerary | null;
  previewRequest?: { action: "start" | "pause" | "stop" | "previous" | "next" | "focus"; requestId: number };
  denseRendering?: boolean;
  denseFeatures?: Feature[];
  selectedFeatureId?: string | null;
  onCameraChanged?: (camera: CameraPose) => void;
  cameraRequest?: (TileCameraState | CameraPose) & { requestId: number };
  cameraPoseRequest?: (CameraPose & { requestId: number });
  onViewportKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  assetResolver?: CityAssetResolver;
}

function polygonParts(feature: Feature): Position[][][] {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates;
  return [];
}

function positionsForRing(ring: Position[]): Cartesian3[] {
  const positions = ring;
  return Cartesian3.fromDegreesArray(positions.flatMap(([longitude, latitude]) => [longitude, latitude]));
}

function positionsForLine(line: Position[]): Cartesian3[] {
  return Cartesian3.fromDegreesArray(line.flatMap(([longitude, latitude]) => [longitude, latitude]));
}

function itineraryLines(itinerary: Itinerary): Position[][] {
  return itinerary.legs.flatMap((leg) => {
    if (leg.geometry.type === "LineString") return [leg.geometry.coordinates];
    if (leg.geometry.type === "MultiLineString") return leg.geometry.coordinates;
    return [];
  });
}

function itineraryWaypoints(itinerary: Itinerary): Position[] {
  return itinerary.legs.flatMap((leg) => leg.steps.flatMap((step) => {
    if (step.geometry.type === "LineString") return [step.geometry.coordinates[0]!, step.geometry.coordinates[step.geometry.coordinates.length - 1]!];
    if (step.geometry.type === "MultiLineString") return step.geometry.coordinates.flatMap((line) => [line[0]!, line[line.length - 1]!]);
    return [];
  }));
}

function hierarchyForArea(feature: Feature, partIndex = 0): PolygonHierarchy | undefined {
  const polygon = polygonParts(feature)[partIndex];
  if (!polygon) return undefined;
  const [outer, ...holes] = polygon;
  if (!outer) return undefined;
  return new PolygonHierarchy(positionsForRing(outer), holes.map((hole) => new PolygonHierarchy(positionsForRing(hole))));
}

function addFeatureEntity(viewer: Viewer, feature: Feature, partIndex = 0, assetResolver?: CityAssetResolver): ReturnType<Viewer["entities"]["add"]> {
  const assetResolution = assetResolver?.resolve(feature.id, 240, 1);
  const assetProperties = {
    assetResolution: assetResolution?.kind ?? "not-registered",
    assetDiagnostic: assetResolution?.kind === "procedural-fallback" ? assetResolution.diagnostic.message : null,
    assetContentRef: assetResolution?.kind === "asset" ? assetResolution.lod.content.relativeContentRef : null,
  };
  if (feature.kind === "area") {
    return viewer.entities.add({
      id: partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`,
      name: feature.name,
      polygon: {
        hierarchy: hierarchyForArea(feature, partIndex),
        height: 0,
        extrudedHeight: 0,
        material: Color.fromCssColorString("#7e9de8").withAlpha(0.18),
        outline: true,
        outlineColor: Color.fromCssColorString("#a7c0ff").withAlpha(0.9),
      },
      label: partIndex === 0 ? {
        text: `${feature.name} · ${feature.attributes.areaSemantics ?? "area"}`,
        font: "11px Inter, sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82),
        pixelOffset: new Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        canonicalFeatureId: feature.id,
        sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
        fixtureOnly: true,
        ...assetProperties,
      },
    });
  }
  if (feature.kind === "building" && feature.geometry.type === "Polygon") {
    const height = feature.geometryProvenance.height.valueMeters ?? 1;
    return viewer.entities.add({
      id: feature.id,
      name: feature.name,
      polygon: {
        hierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])),
        height: 0,
        extrudedHeight: Math.max(1, height),
        material: Color.fromCssColorString("#d7a85d").withAlpha(0.82),
        outline: true,
        outlineColor: Color.fromCssColorString("#f4d89a"),
      },
      properties: {
        canonicalFeatureId: feature.id,
        sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
        fixtureOnly: true,
        ...assetProperties,
      },
    });
  }

  if (feature.kind === "transit-route" && (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString")) {
    const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const colorValue = typeof feature.attributes.transitRouteColor === "string" && /^#[0-9a-f]{6}$/i.test(feature.attributes.transitRouteColor)
      ? feature.attributes.transitRouteColor
      : "#c56cff";
    return viewer.entities.add({
      id: partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`,
      name: feature.name,
      polyline: { positions: positionsForLine(lines[partIndex] ?? lines[0] ?? []), width: 5, material: Color.fromCssColorString(colorValue).withAlpha(0.92), clampToGround: true },
      label: partIndex === 0 ? { text: `${feature.name} · schematic`, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      properties: { canonicalFeatureId: feature.id, sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null, fixtureOnly: true, ...assetProperties },
    });
  }

  const [longitude, latitude] = feature.coordinates;
  const pointColor = feature.kind === "transit-station" ? "#ff7ac8" : feature.kind === "transit-entrance" ? "#ffd166" : "#4ce2e6";
  const pointSize = feature.kind === "transit-station" ? 22 : feature.kind === "transit-entrance" ? 12 : 16;
  return viewer.entities.add({
    id: feature.id,
    name: feature.name,
    position: Cartesian3.fromDegrees(longitude, latitude, 14),
    point: {
      pixelSize: pointSize,
      color: Color.fromCssColorString(pointColor),
      outlineColor: Color.fromCssColorString("#d5ffff"),
      outlineWidth: 2,
      heightReference: HeightReference.NONE,
    },
    label: {
      text: feature.name,
      font: "12px Inter, sans-serif",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82),
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      canonicalFeatureId: feature.id,
      sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
      fixtureOnly: true,
      ...assetProperties,
    },
  });
}

function addFeatureEntities(viewer: Viewer, feature: Feature, assetResolver?: CityAssetResolver): ReturnType<Viewer["entities"]["add"]>[] {
  if (feature.kind === "area" && feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver));
  }
  if (feature.kind === "transit-route" && feature.geometry.type === "MultiLineString") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver));
  }
  return [addFeatureEntity(viewer, feature, 0, assetResolver)];
}

function addDensePrimitives(collection: PrimitiveCollection, features: Feature[], selectedFeatureId: string | null): void {
  const buildings = features.filter((feature): feature is Feature & { kind: "building"; geometry: Extract<Feature["geometry"], { type: "Polygon" }> } => feature.kind === "building" && feature.geometry.type === "Polygon");
  if (buildings.length) {
    const instances = buildings.map((feature) => new GeometryInstance({
      id: feature.id,
      geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])), height: 0, extrudedHeight: Math.max(1, feature.geometryProvenance.height.valueMeters ?? 1) }),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(feature.id === selectedFeatureId ? "#63f3c5" : "#d7a85d").withAlpha(0.82)) },
    }));
    const primitive = new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: false });
    collection.add(primitive);
  }
  const points = features.filter((feature) => feature.kind === "poi");
  if (points.length) {
    const pointCollection = collection.add(new PointPrimitiveCollection());
    points.forEach((feature) => pointCollection.add({ id: feature.id, position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 14), pixelSize: feature.id === selectedFeatureId ? 20 : 12, color: Color.fromCssColorString(feature.id === selectedFeatureId ? "#ffdf6b" : "#4ce2e6"), outlineColor: Color.WHITE, outlineWidth: feature.id === selectedFeatureId ? 3 : 1 }));
  }
}

function cameraStateForViewer(viewer: Viewer): CameraPose {
  const position = viewer.camera.positionCartographic;
  return { longitude: CesiumMath.toDegrees(position.longitude), latitude: CesiumMath.toDegrees(position.latitude), height: Math.max(0, Number.isFinite(position.height) ? position.height : 0), heading: CesiumMath.toDegrees(viewer.camera.heading), pitch: CesiumMath.toDegrees(viewer.camera.pitch), roll: CesiumMath.toDegrees(viewer.camera.roll) };
}
function cameraDuration(seconds: number): number { return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.01 : seconds; }

export function CesiumViewport({
  adapter,
  focusRequest,
  focusFeatureId,
  visibleLayers,
  onFeatureSelected,
  featureFilter,
  itinerary = null,
  previewRequest,
  denseRendering = false,
  denseFeatures = [],
  selectedFeatureId = null,
  onCameraChanged,
  cameraRequest,
  cameraPoseRequest,
  onViewportKeyDown,
  assetResolver,
}: CesiumViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entitiesByFeatureIdRef = useRef(new Map<string, ReturnType<Viewer["entities"]["add"]>>());
  const previewIndexRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const denseFeatureMapRef = useRef(new Map<string, Feature>());
  const denseCollectionRef = useRef<PrimitiveCollection | null>(null);
  const suppressCameraEventsUntilRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Viewer(container, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      contextOptions: { webgl: { preserveDrawingBuffer: import.meta.env.DEV } },
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      terrainProvider: new EllipsoidTerrainProvider(),
    });

    viewer.scene.backgroundColor = Color.fromCssColorString("#0d151b");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#18252d");
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.enableLighting = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    const denseCollection = viewer.scene.primitives.add(new PrimitiveCollection());
    denseCollectionRef.current = denseCollection;
    viewer.imageryLayers.add(new ImageryLayer(new GridImageryProvider({
      cells: 16,
      color: Color.fromCssColorString("#5b737d").withAlpha(0.45),
      glowColor: Color.TRANSPARENT,
      glowWidth: 0,
      backgroundColor: Color.fromCssColorString("#18252d"),
    })));

    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity || typeof entity.id !== "string") return;
      const featureId = entity.id.split(":part:")[0] ?? entity.id;
      const feature = adapter.getFeature(featureId);
      if (feature) onFeatureSelected(feature);
    });
    viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position) as { id?: unknown } | undefined;
      const pickedId = typeof picked?.id === "string" ? picked.id : null;
      const feature = pickedId ? denseFeatureMapRef.current.get(pickedId) ?? adapter.getFeature(pickedId) : undefined;
      if (feature) onFeatureSelected(feature);
    }, ScreenSpaceEventType.LEFT_CLICK);
    viewerRef.current = viewer;
    let cameraTimer: ReturnType<typeof setTimeout> | null = null;
    const onCameraMove = () => {
      if (!onCameraChanged) return;
      if (Date.now() < suppressCameraEventsUntilRef.current) return;
      if (cameraTimer) clearTimeout(cameraTimer);
      cameraTimer = setTimeout(() => { cameraTimer = null; onCameraChanged(cameraStateForViewer(viewer)); }, 120);
    };
    if (onCameraChanged) viewer.camera.changed.addEventListener(onCameraMove);

    return () => {
      entitiesByFeatureIdRef.current.clear();
      denseCollectionRef.current?.removeAll();
      if (cameraTimer) clearTimeout(cameraTimer);
      if (onCameraChanged) viewer.camera.changed.removeEventListener(onCameraMove);
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [adapter, onCameraChanged, onFeatureSelected]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    const loadVisibleFeatures = async () => {
      const layers = (Object.keys(visibleLayers) as Array<keyof LayerVisibility>).filter((layer) => visibleLayers[layer]);
      const loaded = await Promise.all(layers.map((layer) => adapter.loadLayerFeatures(layer)));
      if (cancelled) return;
      const visibleFeatures = loaded.flat().filter((feature) => featureFilter?.(feature) ?? true);
      viewer.entities.removeAll();
      denseCollectionRef.current?.removeAll();
      entitiesByFeatureIdRef.current.clear();
      const visibleDenseFeatures = denseFeatures.filter((feature) => {
        const layer = layerForFeature(feature);
        return !layer || visibleLayers[layer];
      });
      denseFeatureMapRef.current = new Map(visibleDenseFeatures.map((feature) => [feature.id, feature]));
      const allFeatures = visibleDenseFeatures.length ? [...visibleFeatures, ...visibleDenseFeatures] : visibleFeatures;
      const semanticFeatures = denseRendering ? allFeatures.filter((feature) => feature.kind !== "building" && feature.kind !== "poi") : allFeatures;
      semanticFeatures.forEach((feature) => {
        const entities = addFeatureEntities(viewer, feature, assetResolver);
        entities.forEach((entity, partIndex) => {
          entitiesByFeatureIdRef.current.set(partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`, entity);
        });
      });
      if (denseRendering && denseCollectionRef.current) addDensePrimitives(denseCollectionRef.current, allFeatures, selectedFeatureId);
      if (itinerary) {
        itineraryLines(itinerary).forEach((line, index) => {
          viewer.entities.add({
            id: `synthetic-itinerary-route:${index}`,
            name: "Synthetic itinerary preview",
            polyline: { positions: positionsForLine(line), width: 8, material: Color.fromCssColorString("#63f3c5").withAlpha(0.95), clampToGround: true },
            properties: { fixtureOnly: true, routeWarning: "Synthetic route preview; not real navigation." },
          });
        });
      }
      if (focusFeatureId) {
        const entity = entitiesByFeatureIdRef.current.get(focusFeatureId);
        if (entity) void viewer.flyTo(entity, { duration: cameraDuration(0.6) });
        else {
          const denseFeature = denseFeatureMapRef.current.get(focusFeatureId);
          if (denseFeature) viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(denseFeature.coordinates[0], denseFeature.coordinates[1], 240), duration: cameraDuration(0.6) });
        }
      } else {
        const first = visibleFeatures[0];
        if (first) {
          const [longitude, latitude] = first.coordinates;
          viewer.camera.lookAt(
            Cartesian3.fromDegrees(longitude, latitude, first.geometryProvenance.height.valueMeters ?? 0),
            new HeadingPitchRange(CesiumMath.toRadians(18), CesiumMath.toRadians(-30), 2_000),
          );
        }
      }
    };
    void loadVisibleFeatures();
    return () => { cancelled = true; };
  }, [adapter, assetResolver, denseFeatures, denseRendering, featureFilter, itinerary, selectedFeatureId, visibleLayers.buildings, visibleLayers.pois, visibleLayers.areas, visibleLayers.stations, visibleLayers.entrances, visibleLayers.routes, focusFeatureId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraRequest) return;
    viewer.camera.cancelFlight();
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    const height = "height" in cameraRequest ? cameraRequest.height : cameraRequest.distanceMeters;
    const heading = "heading" in cameraRequest ? cameraRequest.heading : 0;
    const pitch = "pitch" in cameraRequest ? cameraRequest.pitch : -45;
    const roll = "roll" in cameraRequest ? cameraRequest.roll : 0;
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(cameraRequest.longitude, cameraRequest.latitude, height), orientation: { heading: CesiumMath.toRadians(heading), pitch: CesiumMath.toRadians(pitch), roll: CesiumMath.toRadians(roll) } });
    const callbackPose: CameraPose = "height" in cameraRequest ? cameraRequest : { longitude: cameraRequest.longitude, latitude: cameraRequest.latitude, height: cameraRequest.distanceMeters, heading: 0, pitch: -45, roll: 0 };
    onCameraChanged?.(callbackPose);
    const settleTimer = setTimeout(() => onCameraChanged?.(callbackPose), 950);
    return () => clearTimeout(settleTimer);
  }, [cameraRequest, onCameraChanged]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !previewRequest || !itinerary) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (previewRequest.action === "pause" || previewRequest.action === "stop") {
      viewer.camera.cancelFlight();
      if (previewRequest.action === "stop") previewIndexRef.current = 0;
      return;
    }
    const waypoints = itineraryWaypoints(itinerary);
    if (waypoints.length === 0) return;
    if (previewRequest.action === "start") previewIndexRef.current = 0;
    else if (previewRequest.action === "previous") previewIndexRef.current = Math.max(previewIndexRef.current - 1, 0);
    else if (previewRequest.action === "next") previewIndexRef.current = Math.min(previewIndexRef.current + 1, waypoints.length - 1);
    const [longitude, latitude] = waypoints[previewIndexRef.current] ?? waypoints[0]!;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(longitude, latitude, 220), duration: reducedMotion ? 0.01 : cameraDuration(0.6) });
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      viewer.camera.cancelFlight();
    };
  }, [itinerary, previewRequest]);

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    viewerRef.current?.camera.cancelFlight();
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || focusRequest === 0 || !focusFeatureId) return;
    const entity = entitiesByFeatureIdRef.current.get(focusFeatureId);
    if (entity) void viewer.flyTo(entity, { duration: cameraDuration(0.7) });
    else {
      const denseFeature = denseFeatureMapRef.current.get(focusFeatureId);
      if (denseFeature) viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(denseFeature.coordinates[0], denseFeature.coordinates[1], 240), duration: cameraDuration(0.7) });
    }
  }, [focusFeatureId, focusRequest]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraPoseRequest) return;
    viewer.camera.cancelFlight();
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(cameraPoseRequest.longitude, cameraPoseRequest.latitude, cameraPoseRequest.height), orientation: { heading: CesiumMath.toRadians(cameraPoseRequest.heading), pitch: CesiumMath.toRadians(cameraPoseRequest.pitch), roll: CesiumMath.toRadians(cameraPoseRequest.roll) } });
    onCameraChanged?.(cameraPoseRequest);
  }, [cameraPoseRequest, onCameraChanged]);

  return <div className="viewport" ref={containerRef} aria-label="3D city viewport" tabIndex={0} onKeyDown={onViewportKeyDown} />;
}
