import { useEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import {
  Cartesian3,
  Cartesian2,
  Color,
  ColorGeometryInstanceAttribute,
  EllipsoidTerrainProvider,
  GridImageryProvider,
  HeightReference,
  ImageryLayer,
  Matrix3,
  Matrix4,
  ModelGraphics,
  Math as CesiumMath,
  PolygonHierarchy,
  PolygonGeometry,
  GeometryInstance,
  PerInstanceColorAppearance,
  Primitive,
  PointPrimitiveCollection,
  PrimitiveCollection,
  ScreenSpaceEventType,
  Quaternion,
  Transforms,
  Viewer,
} from "cesium";
import type { Feature, Position } from "../../domain/schema";
import type { Itinerary } from "../../domain/routing";
import { layerForFeature, type LayerVisibility } from "../../runtime/layers";
import type { RuntimeCityAdapter } from "../../runtime/fixture-adapter";
import type { TileCameraState } from "../../runtime/tile-stream";
import type { CameraPose } from "../../domain/visitor-navigation";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";
import type { CommercialStorefrontPlacement, LoadedExteriorPilotRelease } from "../../runtime/exterior-pilot-release";

interface CesiumViewportProps {
  adapter: RuntimeCityAdapter;
  focusRequest: number;
  focusFeatureId: string | null;
  focusOverlayOpen?: boolean;
  visibleLayers: LayerVisibility;
  onFeatureSelected: (feature: Feature) => void;
  onFeatureOverlap?: (features: Feature[]) => void;
  featureFilter?: (feature: Feature) => boolean;
  itinerary?: Itinerary | null;
  previewRequest?: { action: "start" | "pause" | "stop" | "previous" | "next" | "focus"; requestId: number };
  denseRendering?: boolean;
  denseFeatures?: Feature[];
  denseFeatureLimit?: number;
  denseFeatureGroups?: DenseFeatureGroups;
  denseFeatureGroupLimits?: { base: number; context: number };
  onDenseMetrics?: (metrics: DenseRenderMetrics) => void;
  selectedFeatureId?: string | null;
  onCameraChanged?: (camera: CameraPose) => void;
  cameraRequest?: (TileCameraState | CameraPose) & { requestId: number };
  cameraPoseRequest?: (CameraPose & { requestId: number });
  onViewportKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  assetResolver?: CityAssetResolver;
  commercialOverlay?: LoadedExteriorPilotRelease | null;
  onStorefrontSelected?: (placement: CommercialStorefrontPlacement) => void;
}

export interface DenseRenderMetrics {
  featureCount: number;
  primitiveCount: number;
  instanceCount: number;
  buildingFeatureCount: number;
  pointFeatureCount: number;
  baseFeatureCount?: number;
  contextFeatureCount?: number;
  contextPartCount?: number;
}

export interface DenseFeatureGroups {
  base: Feature[];
  context: Feature[];
}

export function commercialStorefrontProxyId(storefrontId: string): string {
  return `commercial-storefront:${storefrontId}`;
}

export interface DensePoiMarkerStyle {
  pixelSize: number;
  outlineWidth: number;
  color: string;
  opacity: number;
}

export function densePoiMarkerStyle(selected: boolean): DensePoiMarkerStyle {
  return selected
    ? { pixelSize: 20, outlineWidth: 3, color: "#ffdf6b", opacity: 1 }
    : { pixelSize: 5, outlineWidth: 0, color: "#4ce2e6", opacity: 0.78 };
}

function applyCameraPoseRequest(viewer: Viewer, request: CameraPose & { requestId: number }): void {
  viewer.camera.cancelFlight();
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(request.longitude, request.latitude, request.height),
    orientation: {
      heading: CesiumMath.toRadians(request.heading),
      pitch: CesiumMath.toRadians(request.pitch),
      roll: CesiumMath.toRadians(request.roll),
    },
  });
}

export interface DenseRenderCamera {
  longitude: number;
  latitude: number;
}

export interface DenseRenderBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

function positionsInFeature(feature: Feature): Position[] {
  if (feature.geometry.type === "Point") return [feature.geometry.coordinates];
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates.flat();
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates.flat(2);
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;
  return feature.geometry.coordinates.flat(1);
}

export function denseFeatureIntersectsBounds(feature: Feature, bounds: DenseRenderBounds): boolean {
  const positions = positionsInFeature(feature);
  if (positions.length === 0) return false;
  const west = Math.min(bounds.west, bounds.east);
  const east = Math.max(bounds.west, bounds.east);
  const south = Math.min(bounds.south, bounds.north);
  const north = Math.max(bounds.south, bounds.north);
  const longitudes = positions.map((position) => position[0]);
  const latitudes = positions.map((position) => position[1]);
  return Math.min(...longitudes) <= east && Math.max(...longitudes) >= west && Math.min(...latitudes) <= north && Math.max(...latitudes) >= south;
}

/**
 * Select a bounded, deterministic dense render proxy for a settled camera.
 * The adapter retains every loaded parent for search/detail/picking; this
 * seam only bounds the Cesium instance set at a dense citywide LOD. A
 * selected parent is retained even when it falls outside the nearest set.
 */
export function selectDenseFeatures(
  features: readonly Feature[],
  camera: DenseRenderCamera | null,
  limit: number,
  selectedFeatureId: string | null = null,
  bounds: DenseRenderBounds | null = null,
): Feature[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Dense render feature limit must be a positive integer.");
  const selected = selectedFeatureId ? features.find((feature) => feature.id === selectedFeatureId) : undefined;
  const spatial = bounds ? features.filter((feature) => denseFeatureIntersectsBounds(feature, bounds)) : [...features];
  const candidates = selected && !spatial.some((feature) => feature.id === selected.id) ? [...spatial, selected] : spatial;
  if (candidates.length <= limit) return [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  const distance = (feature: Feature): number => {
    if (!camera) return 0;
    const longitude = feature.coordinates[0] ?? 0;
    const latitude = feature.coordinates[1] ?? 0;
    return (longitude - camera.longitude) ** 2 + (latitude - camera.latitude) ** 2;
  };
  const ordered = [...candidates].sort((left, right) => distance(left) - distance(right) || left.id.localeCompare(right.id));
  const bounded = ordered.slice(0, limit);
  if (selected && !bounded.some((feature) => feature.id === selected.id)) bounded[bounded.length - 1] = selected;
  return bounded.sort((left, right) => left.id.localeCompare(right.id));
}

function denseRenderPartCount(feature: Feature): number {
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates.length;
  if (feature.geometry.type === "MultiLineString") return feature.geometry.coordinates.length;
  return 1;
}

/**
 * Select independent ordinary-base and civic-context quotas.  Both groups use
 * the same settled camera/bounds, and only the active selection may be added
 * after its group's bulk quota is full.
 */
export function selectDenseFeatureGroups(
  baseFeatures: readonly Feature[],
  contextFeatures: readonly Feature[],
  camera: DenseRenderCamera | null,
  limits: { base: number; context: number },
  selectedFeatureId: string | null = null,
  bounds: DenseRenderBounds | null = null,
): DenseFeatureGroups {
  const base = selectDenseFeatures(baseFeatures, camera, limits.base, selectedFeatureId, bounds);
  const spatial = contextFeatures.filter((feature) => !bounds || denseFeatureIntersectsBounds(feature, bounds));
  const distance = (feature: Feature): number => {
    if (!camera) return 0;
    return (feature.coordinates[0] - camera.longitude) ** 2 + (feature.coordinates[1] - camera.latitude) ** 2;
  };
  const ordered = [...spatial].sort((left, right) => distance(left) - distance(right) || left.id.localeCompare(right.id));
  const selected = selectedFeatureId ? contextFeatures.find((feature) => feature.id === selectedFeatureId) : undefined;
  const context: Feature[] = [];
  let parts = 0;
  for (const feature of ordered) {
    const count = denseRenderPartCount(feature);
    if (parts + count > limits.context && feature.id !== selectedFeatureId) continue;
    context.push(feature);
    parts += count;
    if (parts >= limits.context && !selected) break;
  }
  if (selected && !context.some((feature) => feature.id === selected.id)) context.push(selected);
  return { base: [...base].sort((left, right) => left.id.localeCompare(right.id)), context: context.sort((left, right) => left.id.localeCompare(right.id)) };
}

/** Build a pick map that omits ambiguous IDs instead of overwriting an owner. */
export function buildCollisionCheckedFeatureMap(features: readonly Feature[]): Map<string, Feature> {
  const map = new Map<string, Feature>();
  const collisions = new Set<string>();
  for (const feature of features) {
    if (collisions.has(feature.id)) continue;
    const existing = map.get(feature.id);
    if (existing) {
      map.delete(feature.id);
      collisions.add(feature.id);
      continue;
    }
    map.set(feature.id, feature);
  }
  return map;
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

/** Return the immutable runtime URI only when the manifest and package gate approve this building. */
export function assetModelUriForFeature(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): string | null {
  if (feature.kind !== "building") return null;
  const resolution = assetResolver?.resolve(feature.id, distanceMeters, 1);
  return resolution?.kind === "asset" ? `/${resolution.lod.content.relativeContentRef}` : null;
}

/** Construct the Cesium ModelGraphics payload used by the semantic entity branch. */
export function modelGraphicsForFeature(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): ModelGraphics | null {
  const uri = assetModelUriForFeature(feature, assetResolver, distanceMeters);
  return uri ? new ModelGraphics({ uri, scale: 1, minimumPixelSize: 1 }) : null;
}

/** Dense rendering intentionally keeps ordinary buildings in the procedural primitive path. */
export function denseFeatureRenderMode(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): "asset-model" | "procedural-massing" {
  return assetModelUriForFeature(feature, assetResolver, distanceMeters) ? "asset-model" : "procedural-massing";
}

export type PoiRenderMode = "point-primitive" | "selected-entity" | "entity";

/** Ordinary dense POIs stay in the app-owned point collection; only the active selection gets an entity label. */
export function poiRenderMode(feature: Feature, denseRendering: boolean, selected: boolean): PoiRenderMode {
  if (feature.kind !== "poi") return "entity";
  if (!denseRendering) return "entity";
  return selected ? "selected-entity" : "point-primitive";
}

function addFeatureEntity(
  viewer: Viewer,
  feature: Feature,
  partIndex = 0,
  assetResolver?: CityAssetResolver,
  assetDistanceMeters = 240,
  selectedFeatureId: string | null = null,
  suppressUnselectedLabels = false,
): ReturnType<Viewer["entities"]["add"]> {
  const selected = feature.id === selectedFeatureId;
  const showLabel = shouldShowFeatureLabel(feature, suppressUnselectedLabels, assetDistanceMeters >= 1_200, selectedFeatureId);
  const assetResolution = assetResolver?.resolve(feature.id, assetDistanceMeters, 1);
  const assetProperties = {
    assetResolution: assetResolution?.kind ?? "not-registered",
    assetDiagnostic: assetResolution?.kind === "procedural-fallback" ? assetResolution.diagnostic.message : null,
    assetContentRef: assetResolution?.kind === "asset" ? assetResolution.lod.content.relativeContentRef : null,
  };
  if (feature.kind === "area" || feature.kind === "park") {
    const isPark = feature.kind === "park";
    return viewer.entities.add({
      id: partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`,
      name: feature.name,
      position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 18),
      polygon: {
        hierarchy: hierarchyForArea(feature, partIndex),
        height: 0,
        extrudedHeight: 0,
        material: Color.fromCssColorString(selected ? "#63f3c5" : isPark ? "#55b875" : "#7e9de8").withAlpha(selected ? 0.42 : isPark ? 0.26 : 0.18),
        outline: true,
        outlineColor: Color.fromCssColorString(selected ? "#ffdf6b" : isPark ? "#b7f2c6" : "#a7c0ff").withAlpha(0.95),
      },
      label: partIndex === 0 && showLabel ? {
        text: `${feature.name}${selected ? " · selected" : ` · ${isPark ? "NYC Parks-managed property" : feature.attributes.areaSemantics ?? "area"}`}`,
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
        fixtureOnly: fixtureOnlyForFeature(feature),
        ...assetProperties,
      },
    });
  }
  if (feature.kind === "building" && feature.geometry.type === "Polygon") {
    const assetModelUri = assetModelUriForFeature(feature, assetResolver, assetDistanceMeters);
    const assetModel = modelGraphicsForFeature(feature, assetResolver, assetDistanceMeters);
    if (assetResolution?.kind === "asset" && assetModelUri && assetModel) {
      const anchor = Cartesian3.fromDegrees(assetResolution.entry.wgs84Anchor.longitude, assetResolution.entry.wgs84Anchor.latitude, assetResolution.entry.wgs84Anchor.heightMeters);
      const enuFrame = Transforms.eastNorthUpToFixedFrame(anchor);
      const enuRotation = Matrix4.getMatrix3(enuFrame, new Matrix3());
      return viewer.entities.add({
        id: feature.id,
        name: feature.name,
        position: anchor,
        orientation: Quaternion.fromRotationMatrix(enuRotation),
        model: assetModel,
        label: selected && showLabel ? {
          text: `${feature.name} · selected`,
          font: "12px Inter, sans-serif",
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
          pixelOffset: new Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        properties: {
          canonicalFeatureId: feature.id,
          sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
          fixtureOnly: fixtureOnlyForFeature(feature),
          ...assetProperties,
        },
      });
    }
    const height = feature.geometryProvenance.height.valueMeters ?? 1;
      return viewer.entities.add({
        id: feature.id,
        name: feature.name,
        position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 18),
        polygon: {
        hierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])),
        height: 0,
        extrudedHeight: Math.max(1, height),
        material: Color.fromCssColorString(selected ? "#63f3c5" : "#d7a85d").withAlpha(0.82),
        outline: true,
        outlineColor: Color.fromCssColorString(selected ? "#ffdf6b" : "#f4d89a"),
      },
      label: selected && showLabel ? {
        text: `${feature.name} · selected`,
        font: "12px Inter, sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
        pixelOffset: new Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        canonicalFeatureId: feature.id,
        sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
        fixtureOnly: fixtureOnlyForFeature(feature),
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
      polyline: { positions: positionsForLine(lines[partIndex] ?? lines[0] ?? []), width: selected ? 7 : 5, material: Color.fromCssColorString(selected ? "#63f3c5" : colorValue).withAlpha(0.92), clampToGround: true },
      label: partIndex === 0 && showLabel ? { text: `${feature.name}${selected ? " · selected" : " · schematic"}`, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      properties: { canonicalFeatureId: feature.id, sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null, fixtureOnly: fixtureOnlyForFeature(feature), ...assetProperties },
    });
  }

  const [longitude, latitude] = feature.coordinates;
  const pointColor = feature.kind === "transit-station" ? "#ff7ac8" : feature.kind === "transit-entrance" ? "#ffd166" : feature.kind === "landmark" ? "#f0a3ff" : "#4ce2e6";
  const ordinaryDensePoint = suppressUnselectedLabels && !selected;
  const pointSize = ordinaryDensePoint ? 6 : feature.kind === "transit-station" ? 22 : feature.kind === "transit-entrance" ? 12 : feature.kind === "landmark" ? 18 : 16;
  return viewer.entities.add({
    id: feature.id,
    name: feature.name,
    position: Cartesian3.fromDegrees(longitude, latitude, 14),
    point: {
      pixelSize: selected ? pointSize + 7 : pointSize,
      color: Color.fromCssColorString(selected ? "#ffdf6b" : pointColor),
      outlineColor: Color.fromCssColorString("#d5ffff"),
      outlineWidth: ordinaryDensePoint ? 0 : 2,
      heightReference: HeightReference.NONE,
    },
    label: showLabel ? {
      text: `${feature.name}${selected ? " · selected" : ""}`,
      font: "12px Inter, sans-serif",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82),
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    } : undefined,
    properties: {
      canonicalFeatureId: feature.id,
      sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
      fixtureOnly: fixtureOnlyForFeature(feature),
      ...assetProperties,
    },
  });
}

/** Source role, rather than a renderer branch, controls fixture truth. */
export function fixtureOnlyForFeature(feature: Feature): boolean {
  return feature.sourceRefs.length === 0 || feature.sourceRefs.every((source) => source.role === "fixture" || source.registryEntryId.startsWith("fixture."));
}

function addFeatureEntities(
  viewer: Viewer,
  feature: Feature,
  assetResolver?: CityAssetResolver,
  assetDistanceMeters = 240,
  selectedFeatureId: string | null = null,
  suppressUnselectedLabels = false,
): ReturnType<Viewer["entities"]["add"]>[] {
  if ((feature.kind === "area" || feature.kind === "park") && feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels));
  }
  if (feature.kind === "transit-route" && feature.geometry.type === "MultiLineString") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels));
  }
  return [addFeatureEntity(viewer, feature, 0, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels)];
}

function addDensePrimitives(collection: PrimitiveCollection, features: Feature[], selectedFeatureId: string | null): DenseRenderMetrics {
  const buildings = features.filter((feature): feature is Feature & { kind: "building"; geometry: Extract<Feature["geometry"], { type: "Polygon" }> } => feature.kind === "building" && feature.geometry.type === "Polygon" && feature.id !== selectedFeatureId);
  let primitiveCount = 0;
  if (buildings.length) {
    const instances = buildings.map((feature) => new GeometryInstance({
      id: feature.id,
      geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])), height: 0, extrudedHeight: Math.max(1, feature.geometryProvenance.height.valueMeters ?? 1) }),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(feature.id === selectedFeatureId ? "#63f3c5" : "#d7a85d").withAlpha(0.82)) },
    }));
    const primitive = new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: false });
    collection.add(primitive);
    primitiveCount += 1;
  }
  const points = features.filter((feature) => feature.kind === "poi" && feature.id !== selectedFeatureId);
  if (points.length) {
    const pointCollection = collection.add(new PointPrimitiveCollection());
    points.forEach((feature) => {
      const style = densePoiMarkerStyle(feature.id === selectedFeatureId);
      pointCollection.add({ id: feature.id, position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 14), pixelSize: style.pixelSize, color: Color.fromCssColorString(style.color).withAlpha(style.opacity), outlineColor: Color.WHITE, outlineWidth: style.outlineWidth });
    });
    primitiveCount += 1;
  }
  return { featureCount: buildings.length + points.length, primitiveCount, instanceCount: buildings.length + points.length, buildingFeatureCount: buildings.length, pointFeatureCount: points.length };
}

function addSelectedPoiEntity(viewer: Viewer, feature: Feature): ReturnType<Viewer["entities"]["add"]> {
  const [longitude, latitude] = feature.coordinates;
  return viewer.entities.add({
    id: feature.id,
    name: feature.name,
    position: Cartesian3.fromDegrees(longitude, latitude, 16),
    point: {
      pixelSize: 24,
      color: Color.fromCssColorString("#ffdf6b"),
      outlineColor: Color.WHITE,
      outlineWidth: 3,
      heightReference: HeightReference.NONE,
    },
    label: {
      text: `${feature.name} · selected`,
      font: "12px Inter, sans-serif",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
      pixelOffset: new Cartesian2(0, -26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      canonicalFeatureId: feature.id,
      sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
      fixtureOnly: fixtureOnlyForFeature(feature),
      selected: true,
    },
  });
}

function verifiedAssetBuildingIds(features: Feature[], assetResolver: CityAssetResolver | undefined, distanceMeters: number): ReadonlySet<string> {
  if (!assetResolver) return new Set<string>();
  return new Set(features.filter((feature) => denseFeatureRenderMode(feature, assetResolver, distanceMeters) === "asset-model").map((feature) => feature.id));
}

function cameraStateForViewer(viewer: Viewer): CameraPose {
  const position = viewer.camera.positionCartographic;
  return { longitude: CesiumMath.toDegrees(position.longitude), latitude: CesiumMath.toDegrees(position.latitude), height: Math.max(0, Number.isFinite(position.height) ? position.height : 0), heading: CesiumMath.toDegrees(viewer.camera.heading), pitch: CesiumMath.toDegrees(viewer.camera.pitch), roll: CesiumMath.toDegrees(viewer.camera.roll) };
}
function cameraDuration(seconds: number): number { return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.01 : seconds; }

/** Build the bounded, deterministic camera pose used for a selected parent. */
export function focusAssetEntryForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">) {
  const resolution = assetResolver?.resolve(feature.id, 180, 1);
  return resolution?.kind === "asset" ? resolution.entry : undefined;
}

/** Keep a selected asset outside the camera while retaining a little three-quarter context. */
export function focusHeightForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">, minimumHeight = 240): number {
  const sourceHeight = feature.geometryProvenance.height.valueMeters ?? 0;
  const assetBounds = focusAssetEntryForFeature(feature, assetResolver)?.bounds;
  const assetHeight = assetBounds ? Math.max(0, assetBounds.max[2] - assetBounds.min[2]) : 0;
  const targetHeight = Math.max(sourceHeight, assetHeight);
  return Math.max(minimumHeight, Math.ceil(targetHeight * 1.8 + 180));
}

export function focusCoordinatesForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">): Position {
  const anchor = focusAssetEntryForFeature(feature, assetResolver)?.wgs84Anchor;
  return anchor ? [anchor.longitude, anchor.latitude] : feature.coordinates;
}

/** Place the camera behind the selected target so a pitched view looks at it from outside. */
export function focusCameraCoordinatesForFeature(feature: Feature, height = 240, targetCoordinates: Position = feature.coordinates): Position {
  const headingRadians = CesiumMath.toRadians(35);
  const pitchRadians = CesiumMath.toRadians(35);
  const groundDistance = height / Math.max(0.1, Math.tan(pitchRadians));
  const eastOffset = groundDistance * Math.sin(headingRadians);
  const northOffset = groundDistance * Math.cos(headingRadians);
  const latitudeRadians = CesiumMath.toRadians(targetCoordinates[1]);
  const metersPerLongitudeDegree = 111_320 * Math.max(0.2, Math.cos(latitudeRadians));
  return [
    targetCoordinates[0] - eastOffset / metersPerLongitudeDegree,
    targetCoordinates[1] - northOffset / 111_320,
  ];
}

export function focusPoseForFeature(feature: Feature, height = 240, coordinates: Position = feature.coordinates): CameraPose {
  return { longitude: coordinates[0], latitude: coordinates[1], height, heading: 35, pitch: -35, roll: 0 };
}

export interface FocusOcclusion {
  leftPx?: number;
  rightPx?: number;
  topPx?: number;
  bottomPx?: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
}

/**
 * Keep dense and overview labels quiet while preserving a deterministic label
 * for the active feature. Geometry and picking remain present either way.
 */
export function shouldShowFeatureLabel(
  feature: Pick<Feature, "id">,
  denseRendering: boolean,
  overview: boolean,
  selectedFeatureId: string | null,
): boolean {
  return feature.id === selectedFeatureId || (!denseRendering && !overview);
}

/**
 * Shift the requested camera center away from an overlay's occluded center.
 * Cesium's camera destination is the visual center, so a right-side panel
 * requires an eastward destination shift to place the selected world point
 * on the left side of the unobscured viewport; a bottom sheet shifts south.
 */
export function focusPoseForFeatureWithOcclusion(feature: Feature, height = 240, occlusion?: FocusOcclusion, coordinates: Position = feature.coordinates): CameraPose {
  const base = focusPoseForFeature(feature, height, coordinates);
  if (!occlusion || occlusion.viewportWidthPx <= 0 || occlusion.viewportHeightPx <= 0) return base;
  const width = occlusion.viewportWidthPx;
  const viewportHeight = occlusion.viewportHeightPx;
  const horizontalShiftPx = ((occlusion.rightPx ?? 0) - (occlusion.leftPx ?? 0)) / 2;
  const verticalShiftPx = ((occlusion.bottomPx ?? 0) - (occlusion.topPx ?? 0)) / 2;
  if (horizontalShiftPx === 0 && verticalShiftPx === 0) return base;
  // A bounded 45° ground-span approximation is stable across fixtures and
  // local releases and avoids making focus dependent on provider imagery.
  const groundSpanMeters = Math.max(1, height) * 0.8284271247;
  const metersPerHorizontalPixel = groundSpanMeters / width;
  const metersPerVerticalPixel = groundSpanMeters / viewportHeight;
  const latitudeRadians = CesiumMath.toRadians(base.latitude);
  const metersPerLongitudeDegree = 111_320 * Math.max(0.2, Math.cos(latitudeRadians));
  return {
    ...base,
    longitude: base.longitude + (horizontalShiftPx * metersPerHorizontalPixel) / metersPerLongitudeDegree,
    latitude: base.latitude - (verticalShiftPx * metersPerVerticalPixel) / 111_320,
  };
}

/**
 * Cesium can report an equivalent 180° local-frame roll after a low-altitude
 * WGS84 flight even when the requested view is upright. Keep the published
 * focus link tied to its deterministic requested orientation.
 */
export function normalizeFocusCameraPose(actual: CameraPose, requested: CameraPose): CameraPose {
  return { ...actual, heading: requested.heading, pitch: requested.pitch, roll: requested.roll };
}

/**
 * A focus request owns one flight. Dense shard refreshes may rerun the effect,
 * but they must not restart that request's flight or re-enter the camera loop.
 */
export function shouldStartFocusFlight(lastRequest: number, nextRequest: number, hasTarget: boolean): boolean {
  return hasTarget && Number.isSafeInteger(nextRequest) && nextRequest > 0 && nextRequest !== lastRequest;
}

/** Cesium dense primitives use a part suffix, while runtime adapters index the parent. */
export function canonicalPickId(pickedId: string): string {
  const partSeparator = pickedId.indexOf(":part:");
  return partSeparator >= 0 ? pickedId.slice(0, partSeparator) : pickedId;
}

/** Resolve a Cesium pick through the canonical parent ID before consulting either index. */
export function featureForPickedId(
  pickedId: string | null,
  denseFeatureMap: ReadonlyMap<string, Feature>,
  adapter: Pick<RuntimeCityAdapter, "getFeature">,
): Feature | undefined {
  if (!pickedId) return undefined;
  const canonicalId = canonicalPickId(pickedId);
  return denseFeatureMap.get(canonicalId) ?? adapter.getFeature(canonicalId);
}

/** Locationless civic/citywide records remain selectable but must never trigger a camera flight. */
export function shouldFocusFeature(feature: Pick<Feature, "attributes"> | null | undefined): boolean {
  return Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true);
}

export function medianFrameInterval(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : ((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function CesiumViewport({
  adapter,
  focusRequest,
  focusFeatureId,
  focusOverlayOpen = false,
  visibleLayers,
  onFeatureSelected,
  onFeatureOverlap,
  featureFilter,
  itinerary = null,
  previewRequest,
  denseRendering = false,
  denseFeatures = [],
  denseFeatureLimit,
  denseFeatureGroups,
  denseFeatureGroupLimits,
  onDenseMetrics,
  selectedFeatureId = null,
  onCameraChanged,
  cameraRequest,
  cameraPoseRequest,
  onViewportKeyDown,
  assetResolver,
  commercialOverlay = null,
  onStorefrontSelected,
}: CesiumViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [viewerReadyGeneration, setViewerReadyGeneration] = useState(0);
  const cameraPoseRequestRef = useRef(cameraPoseRequest);
  cameraPoseRequestRef.current = cameraPoseRequest;
  const previewIndexRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const denseFeatureMapRef = useRef(new Map<string, Feature>());
  const denseCollectionRef = useRef<PrimitiveCollection | null>(null);
  const storefrontPickMapRef = useRef(new Map<string, CommercialStorefrontPlacement>());
  const suppressCameraEventsUntilRef = useRef(0);
  const lastFocusFlightRequestRef = useRef(0);
  const lastFocusTargetSignatureRef = useRef<string | null>(null);

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
      const storefront = storefrontPickMapRef.current.get(entity.id);
      if (storefront) { onStorefrontSelected?.(storefront); return; }
      const feature = featureForPickedId(entity.id, denseFeatureMapRef.current, adapter);
      if (feature) onFeatureSelected(feature);
    });
    viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picks = viewer.scene.drillPick(movement.position, 12) as Array<{ id?: unknown }>;
      const storefront = picks.map((picked) => typeof picked?.id === "string" ? storefrontPickMapRef.current.get(picked.id) : undefined).find((placement): placement is CommercialStorefrontPlacement => Boolean(placement));
      if (storefront) { onStorefrontSelected?.(storefront); return; }
      const pickedFeatures = [...new Map(picks.map((picked) => {
        const pickedId = typeof picked?.id === "string" ? picked.id : null;
        return pickedId ? [canonicalPickId(pickedId), featureForPickedId(pickedId, denseFeatureMapRef.current, adapter)] as const : ["", undefined] as const;
      }).filter((entry): entry is readonly [string, Feature] => Boolean(entry[0] && entry[1]))).values()];
      if (pickedFeatures.length > 1) {
        onFeatureOverlap?.(pickedFeatures);
        return;
      }
      const picked = viewer.scene.pick(movement.position) as { id?: unknown } | undefined;
      const pickedId = typeof picked?.id === "string" ? picked.id : null;
      const feature = featureForPickedId(pickedId, denseFeatureMapRef.current, adapter) ?? pickedFeatures[0];
      if (feature) onFeatureSelected(feature);
    }, ScreenSpaceEventType.LEFT_CLICK);
    viewerRef.current = viewer;
    const initialCameraPoseRequest = cameraPoseRequestRef.current;
    if (initialCameraPoseRequest) {
      suppressCameraEventsUntilRef.current = Date.now() + 900;
      applyCameraPoseRequest(viewer, initialCameraPoseRequest);
      onCameraChanged?.(initialCameraPoseRequest);
    }
    setViewerReadyGeneration((generation) => generation + 1);
    let cameraTimer: ReturnType<typeof setTimeout> | null = null;
    const onCameraMove = () => {
      if (!onCameraChanged) return;
      if (Date.now() < suppressCameraEventsUntilRef.current) return;
      if (cameraTimer) clearTimeout(cameraTimer);
      cameraTimer = setTimeout(() => { cameraTimer = null; onCameraChanged(cameraStateForViewer(viewer)); }, 120);
    };
    if (onCameraChanged) viewer.camera.changed.addEventListener(onCameraMove);

    return () => {
      denseCollectionRef.current?.removeAll();
      if (cameraTimer) clearTimeout(cameraTimer);
      if (onCameraChanged) viewer.camera.changed.removeEventListener(onCameraMove);
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [adapter, onCameraChanged, onFeatureOverlap, onFeatureSelected, onStorefrontSelected]);

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
      storefrontPickMapRef.current.clear();
      const visibleDenseFeatures = denseFeatures.filter((feature) => {
        const layer = layerForFeature(feature);
        return !layer || visibleLayers[layer];
      });
      const allFeatures = [...new Map([...visibleFeatures, ...visibleDenseFeatures].map((feature) => [feature.id, feature])).values()];
      const denseCamera = Number.isFinite(viewer.camera.positionCartographic.longitude) && Number.isFinite(viewer.camera.positionCartographic.latitude)
        ? { longitude: CesiumMath.toDegrees(viewer.camera.positionCartographic.longitude), latitude: CesiumMath.toDegrees(viewer.camera.positionCartographic.latitude) }
        : null;
      const viewRectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      const denseBounds = viewRectangle ? {
        west: CesiumMath.toDegrees(viewRectangle.west),
        east: CesiumMath.toDegrees(viewRectangle.east),
        south: CesiumMath.toDegrees(viewRectangle.south),
        north: CesiumMath.toDegrees(viewRectangle.north),
      } : null;
      const selectedFromAdapter = selectedFeatureId ? adapter.getFeature(selectedFeatureId) : undefined;
      const layerVisible = (feature: Feature): boolean => {
        const layer = layerForFeature(feature);
        return !layer || visibleLayers[layer] !== false;
      };
      const baseDenseFeatures = (denseFeatureGroups?.base ?? visibleDenseFeatures.filter((feature) => feature.kind === "building" || feature.kind === "poi")).filter(layerVisible);
      const contextDenseFeatures = (denseFeatureGroups?.context ?? visibleDenseFeatures.filter((feature) => feature.kind !== "building" && feature.kind !== "poi")).filter(layerVisible);
      const renderedGroups = denseFeatureGroups && denseFeatureGroupLimits
        ? selectDenseFeatureGroups(baseDenseFeatures, contextDenseFeatures, denseCamera, denseFeatureGroupLimits, selectedFeatureId, denseBounds)
        : { base: denseFeatureLimit ? selectDenseFeatures(allFeatures, denseCamera, denseFeatureLimit, selectedFeatureId, denseBounds) : allFeatures, context: [] };
      const renderedDenseFeatures = [...renderedGroups.base, ...renderedGroups.context];
      if (selectedFromAdapter && layerVisible(selectedFromAdapter) && !renderedDenseFeatures.some((feature) => feature.id === selectedFromAdapter.id)) renderedDenseFeatures.push(selectedFromAdapter);
      denseFeatureMapRef.current = buildCollisionCheckedFeatureMap(renderedDenseFeatures);
      const assetDistanceMeters = Math.max(0, Number.isFinite(viewer.camera.positionCartographic.height) ? viewer.camera.positionCartographic.height : 240);
      const assetBuildingIds = verifiedAssetBuildingIds(renderedDenseFeatures, assetResolver, assetDistanceMeters);
      const semanticBaseFeatures = denseRendering
        ? renderedGroups.base.filter((feature) => (feature.kind !== "building" && feature.kind !== "poi") || assetBuildingIds.has(feature.id))
        : renderedDenseFeatures;
      const semanticContextFeatures = denseRendering
        ? renderedGroups.context.filter((feature) => (feature.kind !== "building" && feature.kind !== "poi") || assetBuildingIds.has(feature.id))
        : [];
      const suppressUnselectedLabels = denseRendering || assetDistanceMeters >= 1_200;
      semanticBaseFeatures.forEach((feature) => {
        // Keep the selected model on its highest verified LOD while the camera
        // is framed from outside its full authored bounds; this preserves a
        // visible pinnacle/silhouette instead of swapping to a roof-only LOD.
        const selectedAssetDistanceMeters = feature.id === selectedFeatureId ? Math.min(assetDistanceMeters, 180) : assetDistanceMeters;
        addFeatureEntities(viewer, feature, assetResolver, selectedAssetDistanceMeters, selectedFeatureId, suppressUnselectedLabels);
      });
      const denseMetrics = denseRendering && denseCollectionRef.current
        ? addDensePrimitives(denseCollectionRef.current, renderedGroups.base.filter((feature) => !assetBuildingIds.has(feature.id)), selectedFeatureId)
        : { featureCount: 0, primitiveCount: 0, instanceCount: 0, buildingFeatureCount: 0, pointFeatureCount: 0 };
      onDenseMetrics?.({ ...denseMetrics, baseFeatureCount: renderedGroups.base.length, contextFeatureCount: renderedGroups.context.length, contextPartCount: renderedGroups.context.reduce((sum, feature) => sum + denseRenderPartCount(feature), 0) });
      semanticContextFeatures.forEach((feature) => {
        const selectedAssetDistanceMeters = feature.id === selectedFeatureId ? Math.min(assetDistanceMeters, 180) : assetDistanceMeters;
        addFeatureEntities(viewer, feature, assetResolver, selectedAssetDistanceMeters, selectedFeatureId, suppressUnselectedLabels);
      });
      if (commercialOverlay && (assetDistanceMeters <= 900)) {
        const visibleBuildingIds = new Set(allFeatures.filter((feature) => feature.kind === "building").map((feature) => feature.id));
        for (const buildingId of commercialOverlay.manifest.assets.map((asset) => asset.canonicalFeatureId)) {
          if (!visibleBuildingIds.has(buildingId)) continue;
          const frontage = commercialOverlay.commercialForBuilding(buildingId);
          for (const placement of frontage.acceptedPlacements) {
            const anchor = placement.anchorWgs84;
            if (!anchor || anchor.length !== 2) continue;
            const resolution = commercialOverlay.resolve(buildingId, assetDistanceMeters, 1);
            if (resolution.kind !== "asset") continue;
            const proxyId = commercialStorefrontProxyId(placement.storefrontId);
            storefrontPickMapRef.current.set(proxyId, placement);
            const tenantLabel = placement.displayName ?? placement.rawName ?? "Verified storefront";
            viewer.entities.add({
              id: proxyId,
              name: tenantLabel,
              position: Cartesian3.fromDegrees(anchor[0], anchor[1], 4),
              point: { pixelSize: 12, color: Color.fromCssColorString("#ffdf6b"), outlineColor: Color.fromCssColorString("#17372c"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
              label: resolution.lod.id === "lod0" ? { text: tenantLabel, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#17372c").withAlpha(0.9), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
              properties: { canonicalTenantId: placement.canonicalTenantId, canonicalBuildingId: placement.canonicalBuildingId, storefrontId: placement.storefrontId, evidenceIds: placement.evidenceIds.join(","), activeAssetLod: resolution.lod.id, placementDecision: placement.placementDecision, licensePartition: placement.licensePartition },
            });
          }
        }
      }
      if (denseRendering && selectedFeatureId) {
        const selectedFeature = renderedDenseFeatures.find((feature) => feature.id === selectedFeatureId);
        if (selectedFeature && !semanticBaseFeatures.some((feature) => feature.id === selectedFeature.id) && !semanticContextFeatures.some((feature) => feature.id === selectedFeature.id) && selectedFeature.kind !== "poi") {
          addFeatureEntities(viewer, selectedFeature, assetResolver, Math.min(assetDistanceMeters, 180), selectedFeatureId, false);
        }
        const selectedPoi = renderedDenseFeatures.find((feature) => feature.id === selectedFeatureId && feature.kind === "poi");
        if (selectedPoi) addSelectedPoiEntity(viewer, selectedPoi);
      }
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
    };
    void loadVisibleFeatures();
    return () => { cancelled = true; };
  }, [adapter, assetResolver, commercialOverlay, denseFeatureGroups, denseFeatureGroupLimits, denseFeatureLimit, denseFeatures, denseRendering, featureFilter, itinerary, onDenseMetrics, onStorefrontSelected, selectedFeatureId, visibleLayers.buildings, visibleLayers.pois, visibleLayers.areas, visibleLayers.stations, visibleLayers.entrances, visibleLayers.routes, visibleLayers["statistical-areas"], visibleLayers.parks, visibleLayers.landmarks]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraRequest) return;
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    const callbackPose: CameraPose = "height" in cameraRequest ? cameraRequest : { longitude: cameraRequest.longitude, latitude: cameraRequest.latitude, height: cameraRequest.distanceMeters, heading: 0, pitch: -45, roll: 0 };
    if ("height" in cameraRequest) applyCameraPoseRequest(viewer, cameraRequest);
    else {
      viewer.camera.cancelFlight();
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(cameraRequest.longitude, cameraRequest.latitude, cameraRequest.distanceMeters), orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 } });
    }
    onCameraChanged?.(callbackPose);
    const settleTimer = setTimeout(() => onCameraChanged?.(callbackPose), 950);
    return () => clearTimeout(settleTimer);
  }, [cameraRequest, onCameraChanged, viewerReadyGeneration]);

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
    const feature = denseFeatureMapRef.current.get(focusFeatureId) ?? adapter.getFeature(focusFeatureId);
    if (!feature || !shouldFocusFeature(feature)) return;
    const requestChanged = shouldStartFocusFlight(lastFocusFlightRequestRef.current, focusRequest, true);
    const focusHeight = focusHeightForFeature(feature, assetResolver);
    const focusCoordinates = focusCoordinatesForFeature(feature, assetResolver);
    const focusCameraCoordinates = focusCameraCoordinatesForFeature(feature, focusHeight, focusCoordinates);
    const focusTargetSignature = `${feature.id}:${focusHeight}:${focusCoordinates[0]}:${focusCoordinates[1]}`;
    const targetChanged = focusTargetSignature !== lastFocusTargetSignatureRef.current;
    if (!requestChanged && !targetChanged) return;
    lastFocusFlightRequestRef.current = focusRequest;
    lastFocusTargetSignatureRef.current = focusTargetSignature;
    viewer.camera.cancelFlight();
    const viewport = containerRef.current;
    const inspector = focusOverlayOpen ? viewport?.parentElement?.querySelector<HTMLElement>(".inspector") : null;
    const viewportRect = viewport?.getBoundingClientRect();
    const inspectorRect = inspector?.getBoundingClientRect();
    const viewportWidthPx = viewportRect?.width ?? 0;
    const viewportHeightPx = viewportRect?.height ?? 0;
    const intersectionLeft = viewportRect && inspectorRect ? Math.max(viewportRect.left, inspectorRect.left) : 0;
    const intersectionRight = viewportRect && inspectorRect ? Math.min(viewportRect.right, inspectorRect.right) : 0;
    const intersectionTop = viewportRect && inspectorRect ? Math.max(viewportRect.top, inspectorRect.top) : 0;
    const intersectionBottom = viewportRect && inspectorRect ? Math.min(viewportRect.bottom, inspectorRect.bottom) : 0;
    const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
    const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
    const overlayCenterX = viewportRect ? (intersectionLeft + intersectionRight) / 2 - viewportRect.left : 0;
    const overlayCenterY = viewportRect ? (intersectionTop + intersectionBottom) / 2 - viewportRect.top : 0;
    const occlusion: FocusOcclusion | undefined = viewportRect && inspectorRect && intersectionWidth > 0 && intersectionHeight > 0
      ? {
        leftPx: overlayCenterX < viewportWidthPx / 2 ? intersectionWidth : 0,
        rightPx: overlayCenterX > viewportWidthPx / 2 ? intersectionWidth : 0,
        topPx: overlayCenterY < viewportHeightPx / 2 ? intersectionHeight : 0,
        bottomPx: overlayCenterY > viewportHeightPx / 2 ? intersectionHeight : 0,
        viewportWidthPx,
        viewportHeightPx,
      }
      : undefined;
    const pose = focusPoseForFeatureWithOcclusion(feature, focusHeight, occlusion, focusCameraCoordinates);
    const duration = cameraDuration(0.6);
    suppressCameraEventsUntilRef.current = Date.now() + Math.max(900, duration * 1_000 + 250);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.height),
      orientation: {
        heading: CesiumMath.toRadians(pose.heading),
        pitch: CesiumMath.toRadians(pose.pitch),
        roll: CesiumMath.toRadians(pose.roll),
      },
      duration,
      complete: () => {
        suppressCameraEventsUntilRef.current = Date.now() + 900;
        onCameraChanged?.(normalizeFocusCameraPose(cameraStateForViewer(viewer), pose));
      },
    });
  }, [adapter, assetResolver, denseFeatures, focusFeatureId, focusOverlayOpen, focusRequest, onCameraChanged]);

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
