import { navigationUrl, type CameraPose } from "./visitor-navigation.ts";
import type { GroundClass } from "./ground.ts";

/**
 * The named-place registry (T014).
 *
 * WHAT THIS IS: a deterministic, typed binding from a human place name to the
 * one canonical ground feature that actually carries it in the approved ground
 * release, plus a camera pose that frames that feature's real geometry.
 *
 * WHY IT IS A REGISTRY AND NOT A SEARCH HEURISTIC: the ground release is
 * content-addressed. `udt:ground:manhattan:water:96c4c6af8c1fea9b` is the
 * Hudson River only because the NYC hydrography row behind it says so, and
 * nothing in the id says it. Resolving "Hudson River" by fuzzy-matching
 * geometry at runtime would be a guess; pinning the id here, with the source
 * record it came from, is a citable claim that `named-places.test.ts` re-checks
 * against the release bytes on every run.
 *
 * DISPLAY NAMES ARE SOURCED, NOT INVENTED. Every `sourceDisplayName` below is
 * the literal string in the retained source snapshot (see `displayNameField`),
 * readable in the per-cell artifacts under
 * `public/data/manhattan-ground-20260824/artifacts/<cell>/<class>.json` as
 * `parts[].sourceProperties`. `displayName` differs from it only where the
 * source is upper-cased (the hydrography rows), and that transformation is
 * recorded per entry rather than applied silently.
 *
 * THE BATTERY, NOT "BATTERY PARK". NYC Parks has no property literally named
 * "Battery Park". The downtown landmark is property M005, whose `name` is
 * "The Battery". M283 is "Battery Park City", a different park further north
 * along the Hudson. The registry therefore ships "The Battery" and does not
 * offer "Battery Park" as a display name; see
 * `docs/implementation/NAMED_PLACES.md`.
 */

/** The ground release whose features and parts the registry is checked against. */
export const NAMED_PLACE_GROUND_RELEASE_ID = "manhattan-ground-20260824" as const;
/** The zone-imagery release whose index must account for every place cell. */
export const NAMED_PLACE_ZONE_IMAGERY_RELEASE_ID = "manhattan-ground-zone-imagery-20260826" as const;

/**
 * The ground-selection URL parameter, written exactly as `appendGroundUrl` in
 * `src/app/App.tsx` writes it. The `ground` token itself is deliberately absent
 * from a named-place link: `GROUND_DEFAULT_ON` is true, and that writer keeps
 * the default polarity silent so flipping the default does not churn links.
 */
export const GROUND_FEATURE_URL_PARAM = "groundFeature" as const;

export type NamedPlaceKey =
  | "central-park"
  | "bryant-park"
  | "washington-square-park"
  | "the-battery"
  | "times-square"
  | "east-river"
  | "hudson-river";

export interface NamedPlace {
  readonly placeKey: NamedPlaceKey;
  /** Presentation name. Equal to `sourceDisplayName` unless `displayNameNote` explains otherwise. */
  readonly displayName: string;
  /** The literal string in the retained source snapshot. */
  readonly sourceDisplayName: string;
  /** Which source property `sourceDisplayName` was read from. */
  readonly displayNameField: string;
  /** Set only when `displayName` is not byte-identical to `sourceDisplayName`. */
  readonly displayNameNote?: string;
  readonly canonicalFeatureId: string;
  readonly groundClass: GroundClass;
  /** How the ground release owns this identity: a park is a reference to an existing civic feature. */
  readonly identityOrigin: "referenced-existing" | "ground-owned";
  /** The `sourceRefs[].sourceRecordId` the ground feature carries. */
  readonly sourceRecordId: string;
  /** The published point for the place, used for selection and list ordering, not for framing. */
  readonly point: { readonly longitude: number; readonly latitude: number };
  readonly pose: CameraPose;
  /** Ground classes the pose is expected to show; asserted against the intersecting cells. */
  readonly expectedClasses: readonly GroundClass[];
  /** Anything a viewer would otherwise mistake for a defect. */
  readonly extentNote?: string;
}

/**
 * Poses are derived, not eyeballed.
 *
 * `pose` is a CAMERA position (see `applyCameraPoseRequest` in
 * `CesiumViewport.tsx`), so a pitched camera placed at a feature's centroid
 * looks past it. Each pose below was produced by taking the feature's real
 * vertex bounding box from the release artifacts, choosing a height whose
 * footprint radius covers the larger half-extent, then walking the camera back
 * from the frame target by `height / tan(|pitch|)` along the heading — the
 * inverse of `groundTargetForPose` below. `named-places.test.ts` re-derives the
 * target and asserts the feature's own geometry falls inside the footprint, so
 * a pose that stops framing its place fails the suite rather than shipping.
 */
export const NAMED_PLACES: readonly NamedPlace[] = [
  {
    placeKey: "central-park",
    displayName: "Central Park",
    sourceDisplayName: "Central Park",
    displayNameField: "NYC Parks properties `name` (gispropnum M010)",
    canonicalFeatureId: "udt:manhattan:park:M010",
    groundClass: "park",
    identityOrigin: "referenced-existing",
    sourceRecordId: "M010",
    point: { longitude: -73.97199, latitude: 40.77389 },
    // Framed on the geometry bbox centre (-73.96595, 40.78235), not on `point`:
    // the park's retained extent is 2.75 km x 3.98 km, so the 1200 m first
    // draft framed roughly a quarter of it. Heading 35 follows the park's long
    // axis rather than fighting it.
    pose: { longitude: -73.972141, latitude: 40.775654, height: 2500, heading: 35, pitch: -70, roll: 0 },
    expectedClasses: ["park"],
  },
  {
    placeKey: "bryant-park",
    displayName: "Bryant Park",
    sourceDisplayName: "Bryant Park",
    displayNameField: "NYC Parks properties `name` (gispropnum M008)",
    canonicalFeatureId: "udt:manhattan:park:M008",
    groundClass: "park",
    identityOrigin: "referenced-existing",
    sourceRecordId: "M008",
    point: { longitude: -73.98303, latitude: 40.75342 },
    pose: { longitude: -73.98303, latitude: 40.750697, height: 650, heading: 0, pitch: -65, roll: 0 },
    expectedClasses: ["park"],
  },
  {
    placeKey: "washington-square-park",
    displayName: "Washington Square Park",
    sourceDisplayName: "Washington Square Park",
    displayNameField: "NYC Parks properties `name` (gispropnum M098)",
    canonicalFeatureId: "udt:manhattan:park:M098",
    groundClass: "park",
    identityOrigin: "referenced-existing",
    sourceRecordId: "M098",
    point: { longitude: -73.99744, latitude: 40.73061 },
    pose: { longitude: -73.99744, latitude: 40.727887, height: 650, heading: 0, pitch: -65, roll: 0 },
    expectedClasses: ["park"],
  },
  {
    placeKey: "the-battery",
    displayName: "The Battery",
    sourceDisplayName: "The Battery",
    displayNameField: "NYC Parks properties `name` (gispropnum M005)",
    canonicalFeatureId: "udt:manhattan:park:M005",
    groundClass: "park",
    identityOrigin: "referenced-existing",
    sourceRecordId: "M005",
    point: { longitude: -74.01415, latitude: 40.70199 },
    pose: { longitude: -74.01415, latitude: 40.699058, height: 700, heading: 0, pitch: -65, roll: 0 },
    expectedClasses: ["park"],
    extentNote: "NYC Parks property M005, named \"The Battery\". This is not M283 \"Battery Park City\", which is a separate property further north along the Hudson.",
  },
  {
    placeKey: "times-square",
    displayName: "Times Square Plaza",
    sourceDisplayName: "Times Square Plaza",
    displayNameField: "NYC DOT pedestrian plazas `plazaname` (objectid 11)",
    canonicalFeatureId: "udt:ground:manhattan:plaza:24aeb72178ec5bd0",
    groundClass: "plaza",
    identityOrigin: "ground-owned",
    sourceRecordId: "11",
    point: { longitude: -73.98514, latitude: 40.75871 },
    // Heading 20 follows Broadway. The DOT programme boundary is the pedestrian
    // plaza strip, so the frame is a 0.9 km ribbon, not a square.
    pose: { longitude: -73.987128, latitude: 40.754583, height: 700, heading: 20, pitch: -55, roll: 0 },
    expectedClasses: ["plaza"],
    extentNote: "The DOT plaza record spans Broadway from 41 Street to 53 Street (partner: Times Square Alliance). It is the pedestrian plaza programme boundary, not the colloquial extent of Times Square, and not a survey of current paving.",
  },
  {
    placeKey: "east-river",
    displayName: "East River",
    sourceDisplayName: "EAST RIVER",
    displayNameField: "NYC hydrography `name` (source_id 10262000010.0)",
    displayNameNote: "The hydrography snapshot stores names upper-cased; the display name is the same string in title case.",
    canonicalFeatureId: "udt:ground:manhattan:water:d32d405d331afe68",
    groundClass: "water",
    identityOrigin: "ground-owned",
    sourceRecordId: "10262000010.0",
    point: { longitude: -73.91896, latitude: 40.78971 },
    pose: { longitude: -73.909178, latitude: 40.797115, height: 2500, heading: 225, pitch: -65, roll: 0 },
    expectedClasses: ["water"],
    extentNote: "The retained clip of this hydrography polygon covers the upper East River reach beside Manhattan, roughly 40.7725 to 40.8069 N. The pose frames that reach; it is not a view of the whole river.",
  },
  {
    placeKey: "hudson-river",
    displayName: "Hudson River",
    sourceDisplayName: "HUDSON RIVER",
    displayNameField: "NYC hydrography `name` (source_id 12262000008.0)",
    displayNameNote: "The hydrography snapshot stores names upper-cased; the display name is the same string in title case.",
    canonicalFeatureId: "udt:ground:manhattan:water:96c4c6af8c1fea9b",
    groundClass: "water",
    identityOrigin: "ground-owned",
    sourceRecordId: "12262000008.0",
    point: { longitude: -74.0, latitude: 40.76 },
    // The retained clip runs the full 22 km west side, which no single pose can
    // frame. This one looks east across the river at midtown, which is the
    // recognisable view, and the extent note says what is off-frame.
    pose: { longitude: -74.027118, latitude: 40.76, height: 2500, heading: 90, pitch: -60, roll: 0 },
    expectedClasses: ["water"],
    extentNote: "The retained clip of this hydrography polygon runs the full west side of the island, roughly 40.6928 to 40.8911 N. The pose frames the midtown reach only; the rest of the feature is off-frame by design.",
  },
];

const BY_KEY: ReadonlyMap<NamedPlaceKey, NamedPlace> = new Map(NAMED_PLACES.map((place) => [place.placeKey, place]));

export function namedPlace(placeKey: NamedPlaceKey): NamedPlace {
  const place = BY_KEY.get(placeKey);
  if (!place) throw new Error(`Unknown named place: ${placeKey}`);
  return place;
}

export function namedPlaceForFeatureId(canonicalFeatureId: string): NamedPlace | null {
  return NAMED_PLACES.find((place) => place.canonicalFeatureId === canonicalFeatureId) ?? null;
}

const METRES_PER_DEGREE_LATITUDE = 111_320;
const DEGREES = Math.PI / 180;

/**
 * Where a pitched camera is actually looking on the ellipsoid, in the plate
 * carree approximation that is accurate to well under a metre over the few
 * kilometres a pose spans. A nadir pose (pitch -90) targets its own position.
 */
export function groundTargetForPose(pose: CameraPose): { longitude: number; latitude: number } {
  const tangent = Math.tan(Math.abs(pose.pitch) * DEGREES);
  const distance = tangent === 0 ? 0 : pose.height / tangent;
  const north = distance * Math.cos(pose.heading * DEGREES);
  const east = distance * Math.sin(pose.heading * DEGREES);
  const latitude = pose.latitude + north / METRES_PER_DEGREE_LATITUDE;
  const longitude = pose.longitude + east / (METRES_PER_DEGREE_LATITUDE * Math.cos(latitude * DEGREES));
  return { longitude, latitude };
}

export interface GeographicBounds { west: number; south: number; east: number; north: number }

/**
 * A conservative footprint for what a pose can show.
 *
 * Cesium's default frustum plus the pitches used here put the visible along-
 * track ground swath at roughly 1.3 to 1.4 times the camera height, so a square
 * of one height either side of the ground target is an inner bound rather than
 * a generous one. Deliberately conservative: a place that passes the geometry
 * intersection below is genuinely in frame, not merely near it.
 */
export function poseViewFootprint(pose: CameraPose): GeographicBounds {
  const target = groundTargetForPose(pose);
  const latitudeSpan = pose.height / METRES_PER_DEGREE_LATITUDE;
  const longitudeSpan = pose.height / (METRES_PER_DEGREE_LATITUDE * Math.cos(target.latitude * DEGREES));
  return {
    west: target.longitude - longitudeSpan,
    east: target.longitude + longitudeSpan,
    south: target.latitude - latitudeSpan,
    north: target.latitude + latitudeSpan,
  };
}

export function boundsIntersect(left: GeographicBounds, right: GeographicBounds): boolean {
  return left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;
}

/**
 * The shipped deep link for a place.
 *
 * `navigationUrl` writes the pose in the canonical six-decimal form; the ground
 * selection rides the same `groundFeature` parameter the app's own URL writer
 * uses, so `applyUrl` in `App.tsx` restores both halves of the link from one
 * parse.
 *
 * NO `data=` OR `release=`. The ground release loads independently of data mode
 * (`App.tsx` calls `loadGroundRelease` unconditionally), so pinning the citywide
 * catalog here would add a second, unrelated release to the link — and with it
 * the fixture-fallback notice that appears while that release is still loading.
 * A named-place link asks for exactly one thing: this ground surface, from this
 * pose. Likewise no `ground=` token: `GROUND_DEFAULT_ON` is true and the app's
 * writer keeps the default polarity silent.
 */
export function namedPlaceDeepLink(place: NamedPlace, base: string): string {
  const url = new URL(navigationUrl({
    featureId: null,
    query: "",
    cameraMode: "explore",
    pose: place.pose,
    poseInvalid: false,
  }, base));
  url.searchParams.set(GROUND_FEATURE_URL_PARAM, place.canonicalFeatureId);
  return url.toString();
}

function normalizeNamedPlaceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface NamedPlaceMatch {
  readonly place: NamedPlace;
  readonly matchedBy: "id" | "source" | "name";
  readonly score: number;
}

/**
 * The minimal search path for ground-owned places.
 *
 * Parks already reach search through the travel-context catalog, so this exists
 * for the plaza and the two rivers, whose content-addressed ids appear in no
 * catalog. It matches only the strings this module can cite — the sourced
 * display names, the canonical id, and the source record id — and never
 * invents an alias.
 *
 * IDENTIFIERS MATCH WHOLE OR NOT AT ALL. A canonical ground id embeds its
 * class, so a substring match on ids would answer "park" with The Battery,
 * whose id contains `:park:`, alongside the three places actually named after
 * a park. Names are matched as prefixes and substrings; ids and record ids
 * only exactly.
 */
export function searchNamedPlaces(query: string): NamedPlaceMatch[] {
  const normalized = normalizeNamedPlaceText(query);
  if (!normalized) return [];
  const priority = { id: 0, source: 1, name: 2 } as const;
  return NAMED_PLACES.flatMap((place) => {
    const candidates: Array<{ value: string; matchedBy: NamedPlaceMatch["matchedBy"]; exactOnly: boolean }> = [
      { value: place.canonicalFeatureId, matchedBy: "id", exactOnly: true },
      { value: place.sourceRecordId, matchedBy: "source", exactOnly: true },
      { value: place.displayName, matchedBy: "name", exactOnly: false },
      { value: place.sourceDisplayName, matchedBy: "name", exactOnly: false },
    ];
    const matches = candidates
      .map(({ value, matchedBy, exactOnly }) => ({ normalized: normalizeNamedPlaceText(value), matchedBy, exactOnly }))
      .filter(({ normalized: value, exactOnly }) => value === normalized || (!exactOnly && (value.startsWith(normalized) || value.includes(normalized))));
    if (matches.length === 0) return [];
    const best = matches.sort((left, right) =>
      Number(left.normalized !== normalized) - Number(right.normalized !== normalized)
      || priority[left.matchedBy] - priority[right.matchedBy]
      || left.normalized.length - right.normalized.length
      || left.normalized.localeCompare(right.normalized))[0]!;
    const score = best.normalized === normalized ? priority[best.matchedBy] : 10 + priority[best.matchedBy];
    return [{ place, matchedBy: best.matchedBy, score }];
  }).sort((left, right) => left.score - right.score || left.place.displayName.localeCompare(right.place.displayName) || left.place.placeKey.localeCompare(right.place.placeKey));
}
