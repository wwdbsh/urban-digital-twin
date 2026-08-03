import type { Feature, Freshness, Position, SourceRef } from "./schema.ts";

export const AREA_SEMANTICS = ["statistical", "administrative", "planning", "colloquial"] as const;
export type AreaSemantic = (typeof AREA_SEMANTICS)[number];

export function isAreaSemantic(value: unknown): value is AreaSemantic {
  return typeof value === "string" && (AREA_SEMANTICS as readonly string[]).includes(value);
}

export const AREA_TYPES = ["nta", "community-district", "borough", "census-tract", "planning-area", "colloquial-area", "other"] as const;
export type AreaType = (typeof AREA_TYPES)[number];

export interface AreaRecord {
  schemaVersion: "1.0";
  canonicalId: string;
  cityId: string;
  officialName: string;
  areaType: AreaType;
  areaLevel: string;
  semantics: AreaSemantic;
  labels: string[];
  coordinates: Position;
  geometry: Feature["geometry"];
  sourceRefs: SourceRef[];
  sourceRecordId: string;
  sourceLicense: {
    licenseClass: string;
    termsUrl: string;
    attribution: string;
  };
  freshness: Freshness;
  uncertainty: string;
  fixtureOnly: boolean;
}

export function areaSemanticsLabel(semantic: AreaSemantic): string {
  return {
    statistical: "Statistical geography",
    administrative: "Administrative geography",
    planning: "Planning geography",
    colloquial: "Colloquial label (not an official boundary)",
  }[semantic];
}
