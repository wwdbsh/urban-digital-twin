import type { FeatureKind } from "./schema";

export type TransitFeatureKind = "transit-station" | "transit-entrance" | "transit-route";
export type TransitMode = "subway" | "rail" | "bus" | "other";
export type TransitServiceSemantics = "static-schedule" | "live-operation" | "schematic-route" | "station-inventory";
export type AccessibilityStatus = "accessible" | "partial" | "not-accessible" | "unknown";

export interface TransitRecord {
  schemaVersion: "1.0";
  canonicalId: string;
  transitKind: TransitFeatureKind;
  sourceRecordId: string;
  name: string;
  mode: TransitMode;
  stationComplexId: string | null;
  parentStationId: string | null;
  parentStopId: string | null;
  routeIds: string[];
  routeNames: string[];
  routeColor: string | null;
  routeTextColor: string | null;
  serviceDate: string | null;
  serviceSemantics: TransitServiceSemantics;
  accessibility: AccessibilityStatus;
  elevatorStatus: "working" | "out-of-service" | "unknown";
  geometrySemantics: "point" | "schematic-route-centerline-not-tunnel";
}

export function isTransitFeatureKind(kind: FeatureKind): kind is TransitFeatureKind {
  return kind === "transit-station" || kind === "transit-entrance" || kind === "transit-route";
}

export function transitKindLabel(kind: TransitFeatureKind): string {
  return kind === "transit-station" ? "Station complex" : kind === "transit-entrance" ? "Entrance / exit" : "Schematic route";
}
