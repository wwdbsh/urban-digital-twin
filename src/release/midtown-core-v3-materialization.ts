/**
 * Midtown-core **V3** offline materialization.
 *
 * This is a NEW SIBLING of `midtown-core-materialization.ts`, not a revision of
 * it. That module owns the byte-pinned V2 wave and is never edited; this one
 * owns the footprint-faithful V3 wave. The two share nothing but the source
 * adapter's building record shape, which is geometry-independent.
 *
 * What actually differs, and why it makes this a NEW materializer rather than a
 * regeneration:
 *
 * - V2 planned over an **oriented bounding rectangle** derived from the sourced
 *   ring. Its plan-local footprint was always a four-vertex box, so every
 *   footprint was representable and the only refusals were size-driven.
 * - V3 plans over the **sourced ring itself**, vertex for vertex. A real DOITT
 *   polygon can carry more vertices than the grammar admits, can be
 *   self-intersecting after millimetre rounding, or can be below the footprint
 *   area floor — none of which a rectangle could ever be. The refusal census
 *   therefore does not transfer from V2 and is re-derived here.
 * - V3 **refuses rather than repairs** the inward tier offset, so a building
 *   whose ring cannot carry a setback ships with `setbacks` declared `absent`
 *   and a stated reason. That is a materialized building with a disclosed hole,
 *   not a refusal, and it is counted separately.
 *
 * Nothing here invents geometry. Every building that cannot be described is
 * refused with a deterministic stop code and ships as an explicit unavailable
 * detail carrying the refusal text.
 */

import {
  DETERMINISTIC_FACADE_V3_LIMITS,
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  generateV3FacadePlan,
  deriveV3Parameters,
  ringIsSimple,
  ringSignedAreaMm2,
  tessellateV3Plan,
  validateV3Plan,
  type Point2Mm,
  V3_SHIPPED_GRAMMAR_OPTIONS,
  type V3GrammarOptions,
  type V3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbQuad, type CanonicalGlbSamplerFilter, type CanonicalGlbTri, type Vec3 } from "./canonical-glb.ts";
import { enuFrame, toEnuMeters, type EnuFrame, type Point2 } from "./block835-reference-package.ts";
import { V3_QUALITY_BUDGETS, v3GeometryForGlb, v3TruthTiers, type V3GlbGeometry } from "./block835-v3-package.ts";
import { proceduralTextureProvenance, proceduralTextureReplayIndex, type ProceduralTextureClass, type ProceduralTextureProfile } from "./procedural-texture.ts";
import type { ImmutablePin } from "./multi-lod-assembly.ts";
import { midtownCoreV3SilhouetteMeasurement, type MidtownCoreV3SilhouetteMeasurement } from "./midtown-core-v3-silhouette.ts";
import {
  MIDTOWN_CORE_FALLBACK_HEIGHT_METERS,
  type MidtownCoreBuildingSource,
} from "./midtown-core-materialization.ts";

// ---------------------------------------------------------------------------
// Declared identity
// ---------------------------------------------------------------------------

/**
 * The V3 successor release id.
 *
 * A `-v3` discriminator rather than the plain date stamp, for the same reason
 * the Block 835 V3 package took one: the V2 release already owns
 * `manhattan-midtown-core-cells-20260811` and that directory is byte-frozen.
 * A successor pins its predecessor; it never overwrites it.
 */
export const MIDTOWN_CORE_V3_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3" as const;
/** The V2 wave release this one succeeds. Pinned, never edited. */
export const MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID = "manhattan-midtown-core-cells-20260811" as const;

export const MIDTOWN_CORE_V3_GENERATED_AT = "2026-08-11T00:00:00.000Z" as const;
export const MIDTOWN_CORE_V3_SEED = "manhattan-midtown-core-20260811-v3" as const;
export const MIDTOWN_CORE_V3_TOOL = { id: "urban-digital-twin:midtown-core-v3-materialization", version: "3.0.0" } as const;

/** Two LODs per building, matching the accepted exterior LOD profile. */
export const MIDTOWN_CORE_V3_LOD_IDS = ["lod_0", "lod_1"] as const;
export type MidtownCoreV3LodId = (typeof MIDTOWN_CORE_V3_LOD_IDS)[number];
export const MIDTOWN_CORE_V3_LOD1_GEOMETRIC_ERROR_METERS = 0.2 as const;

/**
 * The V3 uncertainty statement every asset of this wave carries.
 *
 * Unlike the Block 835 `-v3e` package, no building of this wave carries a cited
 * style override: there is no rights-cleared facade-material record for any
 * Midtown-core building, so every style class here is the grammar's own designed
 * draw and the uncited statement is the true one for all of them.
 */
export const MIDTOWN_CORE_V3_UNCERTAINTY = DETERMINISTIC_FACADE_V3_UNCERTAINTY;

/**
 * Per-vertex shape and placement tolerances, identical to the Block 835 V3
 * package's. They bound THIS pipeline's error against the sourced polygon and
 * assert nothing about how well that polygon matches the real building.
 */
export const MIDTOWN_CORE_V3_REGISTRATION_TOLERANCE = {
  horizontalMeters: 0.25,
  verticalMeters: 0.5,
  perVertexShapeMeters: 0.05,
} as const;

/** Relative tolerance of the analytic volume identity, matching the Blender pass. */
export const MIDTOWN_CORE_V3_VOLUME_TOLERANCE = 1e-6;

// ---------------------------------------------------------------------------
// Wave profile
//
// This materializer began as wave `w01`'s alone and hard-coded that wave's
// identity, seed, budgets and its texture-free emission. Wave `w02` needs the
// same grammar with a different identity and WITH detail tiles, so everything
// that differs between waves is collected here and nowhere else — the same
// device `V3PackageProfile` uses in `block835-v3-package.ts`, for the same
// reason: "the midtown path is unchanged" stays checkable by reading.
//
// Every function below defaults to `MIDTOWN_CORE_V3_WAVE_PROFILE`, so wave
// `w01` travels the identical code path with the identical constants it always
// did and its emitted bytes cannot move.
// ---------------------------------------------------------------------------

export interface V3WaveProfile {
  /** Release id the inventory and evidence-shard ids are namespaced under. */
  releaseId: string;
  generatedAt: string;
  seed: string;
  tool: { id: string; version: string };
  /** The asset-level uncertainty statement every asset of this wave carries. */
  uncertainty: string;
  budgets: { maxTriangles: number; maxMaterials: number; maxTextures: number };
  /**
   * Procedural detail tiles, or `null` for a texture-free wave.
   *
   * Tiles ride on LOD 0 ALONE. LOD 1 is selected beyond 250 m, where a
   * 128-pixel joint is far below a screen pixel: the bytes would buy nothing.
   * That is the committed Block 835 `-v3t` decision, carried here unchanged.
   */
  texture: ProceduralTextureProfile | null;
  /** Decided sampler filtering for this wave's detail tiles, when textured. */
  textureFilter?: CanonicalGlbSamplerFilter;
  /**
   * WHERE this wave's detail tiles live. `embedded` — the default and every
   * frozen wave — puts a copy of each tile inside every GLB that draws it.
   * `shared-uri` puts the bytes in the release ONCE, as declared `texture`
   * artifacts, and every GLB names the same relative URI.
   *
   * It changes delivery and nothing else: same catalogue, same sampler, same
   * UVs, same materials, same geometry, same plan hashes. Cesium keys an
   * embedded image by the OWNING MODEL's absolute URL and an external one by its
   * own resolved URI, which is why the identical tile decodes once per asset in
   * the first mode and once per release in the second.
   */
  textureDelivery?: "embedded" | "shared-uri";
  /**
   * The GRAMMAR STATE this wave is materialized under (T004 R1).
   *
   * Every frozen profile pins the shipped grammar explicitly, so the envelope a
   * wave ran under is a property of the wave rather than of whichever call site
   * happened to pass an options object. `buildMidtownCoreV3Plan` still takes a
   * `grammar` argument for the T003 differential replay; when a profile names an
   * envelope AND a caller passes one, the caller's wins and the disagreement is
   * the caller's to justify — the profile is the DECLARED default, not a lock.
   *
   * It is entered into `midtownCoreV3StageFingerprint` only when it differs from
   * the shipped grammar, so every frozen wave's fingerprints are the values they
   * always were. That conditional is the whole point of the field: without it a
   * resumable stage's receipt is BLIND to the grammar, and a receipt taken under
   * the shipped envelope would satisfy a stage running the extended one.
   */
  admissionEnvelope?: V3GrammarOptions;
}

/**
 * Where a shared tile lives in the package, and how a GLB reaches it.
 *
 * Assets are emitted at `public/assets/<id>__<lod>.glb`, so the URI is one hop
 * up and into `textures/`. Both halves are derived from the same two constants
 * so the artifact a release DECLARES and the URI a GLB NAMES cannot drift; the
 * offline gate resolves the second against the GLB's own ref and demands that it
 * land on the first.
 */
export const SHARED_TEXTURE_DIRECTORY = "public/textures" as const;
export function sharedTextureArtifactRef(textureClass: ProceduralTextureClass): string {
  return `${SHARED_TEXTURE_DIRECTORY}/${textureClass}.png`;
}
export function sharedTextureUriFromAsset(textureClass: ProceduralTextureClass): string {
  return `../textures/${textureClass}.png`;
}

/**
 * The grammar every FROZEN V3 wave was materialized under, named once.
 *
 * It is the shipped grammar, written down rather than left implicit, so a wave
 * profile states the envelope its committed bytes came from instead of relying
 * on nobody having passed an options object. Every frozen profile in this
 * repository pins this value; a successor wave that means to run a different
 * grammar overrides it, and that override is then visible in the profile diff
 * and in every one of that wave's stage fingerprints.
 */
export const V3_FROZEN_WAVE_ADMISSION_ENVELOPE: V3GrammarOptions = { ...V3_SHIPPED_GRAMMAR_OPTIONS };

/**
 * Wave `w01`'s profile: exactly the constants this module hard-coded before the
 * parameterization, including its texture-free emission and the zero-texture
 * `V3_QUALITY_BUDGETS` its committed manifest pins.
 */
export const MIDTOWN_CORE_V3_WAVE_PROFILE: V3WaveProfile = {
  releaseId: MIDTOWN_CORE_V3_RELEASE_ID,
  generatedAt: MIDTOWN_CORE_V3_GENERATED_AT,
  seed: MIDTOWN_CORE_V3_SEED,
  tool: { ...MIDTOWN_CORE_V3_TOOL },
  uncertainty: MIDTOWN_CORE_V3_UNCERTAINTY,
  budgets: { ...V3_QUALITY_BUDGETS },
  texture: null,
  admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
};

// ---------------------------------------------------------------------------
// Refusal vocabulary
// ---------------------------------------------------------------------------

/**
 * Closed refusal vocabulary.
 *
 * The first four are footprint-shape refusals that V2 could not experience at
 * all, because V2 planned over a rectangle. They are named individually rather
 * than folded into one `plan-generation-failed` bucket so the census can state
 * WHICH property of the sourced polygon the grammar could not carry.
 */
export const MIDTOWN_CORE_V3_STOP_CODES = [
  "absent-from-base-shards",
  "degenerate-footprint",
  "ring-vertex-count-unsupported",
  "ring-not-simple",
  "ring-area-below-floor",
  "ring-neck-below-grammar-minimum",
  "source-height-below-grammar-minimum",
  "plan-generation-failed",
  "plan-validation-failed",
  "asset-budget-exceeded",
  "volume-identity-failed",
  "registration-out-of-tolerance",
] as const;
export type MidtownCoreV3StopCode = (typeof MIDTOWN_CORE_V3_STOP_CODES)[number];

export class MidtownCoreV3Stop extends Error {
  readonly code: MidtownCoreV3StopCode;
  readonly buildingId: string;
  /** The refusal text alone, without the id and code the message repeats. */
  readonly detail: string;
  constructor(buildingId: string, code: MidtownCoreV3StopCode, detail: string) {
    super(`${buildingId} [${code}]: ${detail}`);
    this.name = "MidtownCoreV3Stop";
    this.code = code;
    this.buildingId = buildingId;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Ring preparation
// ---------------------------------------------------------------------------

/**
 * Collapses exactly duplicated consecutive millimetre vertices and the repeated
 * closing vertex.
 *
 * A faithful copy of the generator's own private rule. It is used ONLY to LABEL
 * a refusal the generator already made, never to refuse on its own: every
 * building is put through `generateV3FacadePlan`, and this classifier is
 * consulted afterwards. A divergence between the two could therefore only
 * change a refusal's code, never turn an acceptance into a refusal.
 */
function collapseExactDuplicates(points: readonly Point2Mm[]): Point2Mm[] {
  const collapsed: Point2Mm[] = [];
  for (const point of points) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    collapsed.push([point[0], point[1]]);
  }
  while (collapsed.length > 1) {
    const first = collapsed[0]!;
    const last = collapsed[collapsed.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) collapsed.pop(); else break;
  }
  return collapsed;
}

/**
 * Names which of the generator's own ring-admission rules a sourced ring fails,
 * or `null` when the ring is admissible and the refusal came from later in
 * generation.
 */
export function classifyMidtownCoreV3Ring(
  ringMm: readonly Point2Mm[],
  options: Pick<V3GrammarOptions, "maxRingVertices"> = {},
): MidtownCoreV3StopCode | null {
  const collapsed = collapseExactDuplicates(ringMm);
  if (collapsed.length < DETERMINISTIC_FACADE_V3_LIMITS.minRingVertices) return "degenerate-footprint";
  if (collapsed.length > (options.maxRingVertices ?? DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices)) return "ring-vertex-count-unsupported";
  const oriented = ringSignedAreaMm2(collapsed) < 0 ? [...collapsed].reverse() : collapsed;
  if (!ringIsSimple(oriented)) return "ring-not-simple";
  if (Math.abs(ringSignedAreaMm2(oriented)) < DETERMINISTIC_FACADE_V3_LIMITS.minRingAreaMm2) return "ring-area-below-floor";
  return null;
}

/**
 * Names a generation refusal from the generator's OWN issue paths.
 *
 * Classification is keyed on `issue.path`, never on message text: paths are part
 * of the generator's validation contract, wording is not, and a census whose
 * buckets depend on a sentence would silently re-bucket itself the day somebody
 * improved an error message.
 *
 * The ring rules are consulted first because they are the admission rules the
 * generator applies before anything else; only when the ring was admissible does
 * a `geometry.footprint.outer` issue mean the different thing it names here —
 * that the polygon is legal but too pinched for this grammar to place openings
 * on without punching through the massing.
 */
export function classifyMidtownCoreV3Generation(
  ringMm: readonly Point2Mm[],
  issues: readonly { path: string; message: string }[],
  options: Pick<V3GrammarOptions, "maxRingVertices"> = {},
): MidtownCoreV3StopCode {
  const ring = classifyMidtownCoreV3Ring(ringMm, options);
  if (ring !== null) return ring;
  const paths = new Set(issues.map((issue) => issue.path));
  if (paths.has("geometry.heightMm")) return "source-height-below-grammar-minimum";
  if (paths.has("geometry.footprint.outer")) return "ring-neck-below-grammar-minimum";
  return "plan-generation-failed";
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

export interface MidtownCoreV3PlanContext {
  source: MidtownCoreBuildingSource;
  frame: EnuFrame;
  /** The sourced ring in plan-local millimetres, exactly as the plan carries it. */
  ringMm: Point2Mm[];
  /** True when the sourced ring was clockwise and had to be reversed to CCW. */
  reversed: boolean;
  plan: V3Plan;
  heightSource: "source" | "fallback";
}

/**
 * Builds and fully validates the V3 plan for one Midtown-core building.
 *
 * There is no oriented rectangle and no rotation: the plan-local frame IS the
 * building-anchored ENU frame in millimetres, so the sourced polygon travels
 * through the pipeline as itself. The only transforms are a metre-to-millimetre
 * rounding and, when the sourced ring is clockwise, a reversal to the
 * counter-clockwise orientation the grammar requires. Both are recorded.
 */
export function buildMidtownCoreV3Plan(
  source: MidtownCoreBuildingSource,
  baseManifestChecksumSha256: string,
  profile: V3WaveProfile = MIDTOWN_CORE_V3_WAVE_PROFILE,
  /**
   * Grammar state for this call.
   *
   * It DEFAULTS TO THE PROFILE'S declared envelope, so a wave materializes under
   * the grammar its own profile names rather than under whatever the last caller
   * remembered to pass. Every frozen profile names the shipped grammar, so the
   * wave CLIs and every existing caller travel the identical path they always
   * did. An explicit argument still wins — that is how the T003 differential
   * replay puts one profile through two envelopes in one process.
   */
  grammar: V3GrammarOptions = profile.admissionEnvelope ?? {},
): MidtownCoreV3PlanContext {
  const closed = source.outerRing.length > 1
    && source.outerRing[0]![0] === source.outerRing[source.outerRing.length - 1]![0]
    && source.outerRing[0]![1] === source.outerRing[source.outerRing.length - 1]![1]
    ? source.outerRing.slice(0, -1)
    : [...source.outerRing];
  const frame = enuFrame({ longitude: source.representative[0], latitude: source.representative[1] });
  const raw: Point2Mm[] = closed.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)];
  });
  const reversed = ringSignedAreaMm2(raw) < 0;
  const outer = reversed ? [...raw].reverse() : raw;

  const heightSource: "source" | "fallback" = source.heightMeters === null || source.heightUnknown ? "fallback" : "source";
  const heightMm = Math.round((heightSource === "fallback" ? MIDTOWN_CORE_FALLBACK_HEIGHT_METERS : source.heightMeters!) * 1_000);

  const generated = generateV3FacadePlan({
    schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
    buildingId: source.buildingId,
    generatedAt: profile.generatedAt,
    seed: profile.seed,
    tool: { ...profile.tool },
    geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      {
        id: `${source.buildingId}:anchor:footprint`,
        kind: "footprint",
        sourceRefId: source.sourceRefId,
        // Bound to the pinned base manifest, so a plan can never silently claim
        // provenance from a different snapshot.
        fingerprintSha256: sha256HexSync(stableSerialize({ outerRing: source.outerRing, baseManifestChecksumSha256 })),
      },
      {
        id: `${source.buildingId}:anchor:height`,
        kind: "height",
        sourceRefId: source.sourceRefId,
        fingerprintSha256: sha256HexSync(stableSerialize({ heightMeters: source.heightMeters, heightUnknown: source.heightUnknown, heightSource, baseManifestChecksumSha256 })),
      },
    ],
    parameters: deriveV3Parameters({ footprintOuterMm: outer, heightMm }, grammar),
  }, grammar);
  if (!generated.ok) {
    const detail = generated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new MidtownCoreV3Stop(source.buildingId, classifyMidtownCoreV3Generation(raw, generated.issues, grammar), detail);
  }
  // Generation alone does not run the plan validator, which carries the
  // containment, local-thickness and corner-clearance guards.
  const validated = validateV3Plan(generated.value, grammar);
  if (!validated.ok) {
    throw new MidtownCoreV3Stop(source.buildingId, "plan-validation-failed", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return { source, frame, ringMm: outer, reversed, plan: validated.value, heightSource };
}

// ---------------------------------------------------------------------------
// Analytic volume identity
// ---------------------------------------------------------------------------

function ringAreaMm2(ring: readonly Point2Mm[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twice += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twice) / 2;
}

/** Everything the grammar cuts INTO the wall; everything else is glued onto it. */
const RECESS_KINDS = new Set(["window", "entrance", "storefront"]);

/**
 * Analytic solid volume of the planned massing, in cubic metres.
 *
 * A transliteration of the Blender pass's `expected_volume`, kept here so the
 * identity can be applied to all 7,201 buildings offline rather than only to the
 * Blender sample. Shoelace area of each tier ring times its height, plus every
 * rooftop prism, less every recess box and plus every protrusion box. Corner
 * clearance is what makes the box terms a plain sum: no two placement boxes can
 * meet inside a corner, so none is double counted.
 */
export function midtownCoreV3AnalyticVolumeCubicMeters(plan: V3Plan, includeRecesses: boolean): number {
  let volume = 0;
  for (const tier of plan.tiers) volume += (ringAreaMm2(tier.ring) / 1e6) * ((tier.topZMm - tier.baseZMm) / 1_000);
  // Rooftop prisms are emitted at BOTH levels of detail — they are silhouette,
  // not detail — so the identity counts them at both.
  for (const prism of plan.prisms) volume += (ringAreaMm2(prism.ring) / 1e6) * ((prism.topZMm - prism.baseZMm) / 1_000);
  if (!includeRecesses) return volume;
  for (const placement of plan.placements) {
    const bounds = placement.bounds;
    const area = ((bounds.uMaxMm - bounds.uMinMm) / 1_000) * ((bounds.vMaxMm - bounds.vMinMm) / 1_000);
    const depth = Math.abs(placement.depthMm / 1_000);
    volume += RECESS_KINDS.has(placement.kind) ? -area * depth : area * depth;
  }
  return volume;
}

/**
 * Signed volume of the emitted surface, by the divergence theorem.
 *
 * Positive means outward-consistent normals; agreement with the analytic volume
 * means the surface is closed. A mesh with a hole, an inverted normal, a
 * self-overlapping tier ring or a placement that punched through a neck cannot
 * satisfy the identity.
 */
export function midtownCoreV3MeshVolumeCubicMeters(geometry: { quads: readonly CanonicalGlbQuad[]; triangles: readonly CanonicalGlbTri[] }): number {
  let sixTimes = 0;
  const accumulate = (a: Vec3, b: Vec3, c: Vec3): void => {
    sixTimes += a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
  };
  for (const quad of geometry.quads) {
    accumulate(quad.corners[0], quad.corners[1], quad.corners[2]);
    accumulate(quad.corners[0], quad.corners[2], quad.corners[3]);
  }
  for (const triangle of geometry.triangles) accumulate(triangle.a, triangle.b, triangle.c);
  return sixTimes / 6;
}

// ---------------------------------------------------------------------------
// True-footprint-vertex registration
// ---------------------------------------------------------------------------

export interface MidtownCoreV3Registration {
  buildingId: string;
  sourceVertexCount: number;
  ringVertexCount: number;
  /** Symmetric worst per-vertex distance between sourced ring and shipped ring. */
  perVertexShapeDeviationMeters: number;
  /** Worst shipped ring vertex to the nearest ground-plane vertex actually written. */
  ringVertexPresenceMeters: number;
  horizontalDeviationMeters: number;
  verticalDeviationMeters: number;
  ringOrientationReversed: boolean;
  withinTolerance: boolean;
}

const GROUND_PLANE_EPSILON_METERS = 1e-4;

function directedVertexDeviation(from: readonly Point2[], to: readonly Point2[]): number {
  let worst = 0;
  for (const point of from) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of to) nearest = Math.min(nearest, Math.hypot(candidate[0] - point[0], candidate[1] - point[1]));
    worst = Math.max(worst, nearest);
  }
  return worst;
}

/**
 * Measures the shipped ground ring against the SOURCED polygon, vertex for
 * vertex, exactly as the Block 835 V3 package does. The measure is SYMMETRIC and
 * is taken against the ring alone, never against every ground-plane vertex — the
 * ground plane also carries entrance and storefront recess corners, and a one
 * directional measure over that superset would let an unrelated detail vertex
 * stand in for a ring vertex.
 */
export function midtownCoreV3Registration(
  context: MidtownCoreV3PlanContext,
  exported: { quads: readonly CanonicalGlbQuad[]; triangles: readonly CanonicalGlbTri[] },
): MidtownCoreV3Registration {
  const closedSource = context.source.outerRing.length > 1
    && context.source.outerRing[0]![0] === context.source.outerRing[context.source.outerRing.length - 1]![0]
    && context.source.outerRing[0]![1] === context.source.outerRing[context.source.outerRing.length - 1]![1]
    ? context.source.outerRing.slice(0, -1)
    : [...context.source.outerRing];
  const sourceVertices: Point2[] = closedSource.map((point) => toEnuMeters(context.frame, point));
  let minimumZ = Number.POSITIVE_INFINITY;
  const visit = (corner: Vec3): void => { if (corner[2] < minimumZ) minimumZ = corner[2]; };
  for (const quad of exported.quads) for (const corner of quad.corners) visit(corner);
  for (const triangle of exported.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) visit(corner);
  const observed: Point2[] = [];
  const collect = (corner: Vec3): void => { if (Math.abs(corner[2] - minimumZ) <= GROUND_PLANE_EPSILON_METERS) observed.push([corner[0], corner[1]]); };
  for (const quad of exported.quads) for (const corner of quad.corners) collect(corner);
  for (const triangle of exported.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) collect(corner);

  const shippedRing: Point2[] = context.ringMm.map((point) => [point[0] / 1_000, point[1] / 1_000]);
  const ringPresence = observed.length === 0 ? Number.POSITIVE_INFINITY : directedVertexDeviation(shippedRing, observed);
  const shape = Math.max(directedVertexDeviation(sourceVertices, shippedRing), directedVertexDeviation(shippedRing, sourceVertices));
  const mean = (points: readonly Point2[]): Point2 => [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
  const sourceCentroid = mean(sourceVertices);
  const shippedCentroid = mean(shippedRing);
  const horizontal = Math.hypot(shippedCentroid[0] - sourceCentroid[0], shippedCentroid[1] - sourceCentroid[1]);
  const roofElevation = context.plan.input.geometry.heightMm / 1_000;
  const sourcedHeight = context.heightSource === "fallback" ? MIDTOWN_CORE_FALLBACK_HEIGHT_METERS : context.source.heightMeters!;
  const vertical = Math.abs(roofElevation - minimumZ - sourcedHeight);
  return {
    buildingId: context.source.buildingId,
    sourceVertexCount: sourceVertices.length,
    ringVertexCount: shippedRing.length,
    perVertexShapeDeviationMeters: shape,
    ringVertexPresenceMeters: ringPresence,
    horizontalDeviationMeters: horizontal,
    verticalDeviationMeters: vertical,
    ringOrientationReversed: context.reversed,
    withinTolerance: shape <= MIDTOWN_CORE_V3_REGISTRATION_TOLERANCE.perVertexShapeMeters
      && horizontal <= MIDTOWN_CORE_V3_REGISTRATION_TOLERANCE.horizontalMeters
      && vertical <= MIDTOWN_CORE_V3_REGISTRATION_TOLERANCE.verticalMeters
      && ringPresence <= 1e-3,
  };
}

// ---------------------------------------------------------------------------
// Canonical GLB emission
// ---------------------------------------------------------------------------

export function midtownCoreV3AssetRef(buildingId: string, lodId: MidtownCoreV3LodId): string {
  return `public/assets/${buildingId.replace(":", "-")}__${lodId}.glb`;
}
export function midtownCoreV3InventoryId(buildingId: string, releaseId: string = MIDTOWN_CORE_V3_RELEASE_ID): string {
  return `inventory:${releaseId}:${buildingId}`;
}
export function midtownCoreV3EvidenceShardId(buildingId: string, releaseId: string = MIDTOWN_CORE_V3_RELEASE_ID): string {
  return `evidence-shard:${releaseId}:${buildingId}`;
}

export interface MidtownCoreV3AssetBytes {
  lodId: MidtownCoreV3LodId;
  relativeRef: string;
  bytes: Uint8Array;
  checksumSha256: string;
  counts: { triangleCount: number; materialCount: number; textureCount: number };
  /** Relative deviation of the emitted surface from the analytic solid volume. */
  volumeDeviation: number;
  meshVolumeCubicMeters: number;
  analyticVolumeCubicMeters: number;
  /**
   * The RELEASE-scoped tiles this asset references by URI, in emission order.
   * Empty for every embedded and texture-free asset, so a caller that ignores
   * it sees exactly the behaviour it saw before this field existed.
   */
  sharedTextureClasses: readonly ProceduralTextureClass[];
}

/**
 * Recovers each image's catalogue class from its BYTES, by digest.
 *
 * The class could have been threaded down from `bindTextures`, and deliberately
 * is not: recovering it from the bytes means a URI can never name a class the
 * bytes are not, and the recovery uses the same replay index the release gate
 * uses. An image this repository's rasterizer did not produce has no class and
 * fails here rather than being shipped under a plausible name.
 */
function sharedUriTextureSet(
  textures: NonNullable<V3GlbGeometry["textures"]>,
  buildingId: string,
): { images: { mimeType: "image/png"; uri: string }[]; materialImage: readonly (number | null)[]; filter?: CanonicalGlbSamplerFilter; classes: ProceduralTextureClass[] } {
  const index = proceduralTextureReplayIndex();
  const classes = textures.images.map((image) => {
    const textureClass = index.get(sha256HexBytes(image.bytes));
    // NOT a `MidtownCoreV3Stop`. A stop code is a REFUSAL: a statement that this
    // grammar cannot carry some property of a sourced polygon, and it is
    // counted as such in a census and drops that one building from the release.
    // This is not that. It says the tile this repository's rasterizer just
    // produced is not a tile its own replay index knows, which is the
    // repository contradicting itself and is true of every building, not this
    // one. Refusing the building would hide it behind a plausible refusal
    // count; throwing stops the run. (It was first reported as
    // `asset-budget-exceeded`, which was simply the wrong word for it, and the
    // closed stop-code vocabulary is pinned by a committed goal-completion
    // record, so the fix is to stop calling it a refusal rather than to widen
    // that vocabulary.)
    if (textureClass === undefined) throw new Error(`Shared detail tile for ${buildingId} is not byte-identical to any tile this repository's rasterizer produces, so it cannot be referenced by URI.`);
    return textureClass;
  });
  return {
    images: classes.map((textureClass) => ({ mimeType: "image/png" as const, uri: sharedTextureUriFromAsset(textureClass) })),
    materialImage: textures.materialImage,
    ...(textures.filter ? { filter: textures.filter } : {}),
    classes,
  };
}

export interface MidtownCoreV3AssetResult {
  assets: MidtownCoreV3AssetBytes[];
  registration: MidtownCoreV3Registration;
  /**
   * The LOD 0 / LOD 1 projected-silhouette measurement for this building.
   *
   * Reported, never enforced here. Every frozen wave ships a single LOD and
   * claims nothing about a transition, so refusing on this number would turn a
   * frozen release build into a failure over a property it never asserted. A
   * wave that means to ship two LODs turns the number into the record the
   * assembly schema demands through `midtownCoreV3SilhouetteRecord`, which is
   * the fail-closed half.
   */
  silhouette: MidtownCoreV3SilhouetteMeasurement;
  truthTiers: readonly string[];
  /** True when the tier offset was refused and `setbacks` ships `absent`. */
  setbacksAbsent: boolean;
  setbackDisclosure: string;
}

/** The URI a shared tile is named by, inverted back to its catalogue class. */
const SHARED_TEXTURE_CLASS_BY_URI = new Map<string, ProceduralTextureClass>();

function emittedSharedTextureClasses(bytes: Uint8Array, buildingId: string): ProceduralTextureClass[] {
  if (SHARED_TEXTURE_CLASS_BY_URI.size === 0) {
    for (const textureClass of proceduralTextureReplayIndex().values()) SHARED_TEXTURE_CLASS_BY_URI.set(sharedTextureUriFromAsset(textureClass), textureClass);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as { images?: Array<{ uri?: string }> };
  return (json.images ?? []).map((image) => {
    const textureClass = SHARED_TEXTURE_CLASS_BY_URI.get(image.uri ?? "");
    // Same reasoning as `sharedUriTextureSet`: an emitted URI naming no tile of
    // the catalogue is a writer/emitter contradiction, not a refusal of THIS
    // building's geometry, and it stops the run rather than being counted.
    if (textureClass === undefined) throw new Error(`Emitted image URI ${String(image.uri)} for ${buildingId} names no shared tile of this catalogue.`);
    return textureClass;
  });
}

/**
 * Writes both canonical GLBs for one planned building and runs every per-asset
 * census gate on the bytes it just produced.
 *
 * The gates are applied HERE rather than in a later pass so a building that
 * fails one is refused with a stop code and never reaches a release: an asset
 * that missed its analytic volume is not a warning, it is geometry nobody can
 * vouch for.
 */
export function writeMidtownCoreV3Assets(
  context: MidtownCoreV3PlanContext,
  options: {
    ownerCellId: string;
    capturedAt: string | null;
    updatedAt: string | null;
    /** V2 asset pin for this building, when the predecessor wave shipped one. */
    predecessor: ImmutablePin | null;
    /** Wave identity, budgets and texture policy. Defaults to wave `w01`'s. */
    profile?: V3WaveProfile;
  },
): MidtownCoreV3AssetResult {
  const profile = options.profile ?? MIDTOWN_CORE_V3_WAVE_PROFILE;
  const plan = context.plan;
  const buildingId = context.source.buildingId;
  const inventoryId = midtownCoreV3InventoryId(buildingId, profile.releaseId);
  const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
  let truthTiers: readonly string[];
  try {
    truthTiers = v3TruthTiers(plan);
  } catch (error) {
    throw new MidtownCoreV3Stop(buildingId, "plan-validation-failed", error instanceof Error ? error.message : String(error));
  }
  const setbacksComponent = plan.inventory.components.find((component) => component.kind === "setbacks");
  const setbacksAbsent = setbacksComponent?.state === "absent";

  const assets: MidtownCoreV3AssetBytes[] = [];
  let registration: MidtownCoreV3Registration | null = null;
  for (const [lodIndex, lodId] of MIDTOWN_CORE_V3_LOD_IDS.entries()) {
    const includeRecesses = lodIndex === 0;
    const tessellation = tessellateV3Plan(plan, { includeRecesses });
    const enu: V3GlbGeometry = v3GeometryForGlb(plan, tessellation, { yUp: false });
    if (lodIndex === 0) {
      registration = midtownCoreV3Registration(context, enu);
      if (!registration.withinTolerance) {
        throw new MidtownCoreV3Stop(
          buildingId,
          "registration-out-of-tolerance",
          `shape ${registration.perVertexShapeDeviationMeters} m / horizontal ${registration.horizontalDeviationMeters} m / vertical ${registration.verticalDeviationMeters} m / ring presence ${registration.ringVertexPresenceMeters} m.`,
        );
      }
    }
    const analyticVolume = midtownCoreV3AnalyticVolumeCubicMeters(plan, includeRecesses);
    const meshVolume = midtownCoreV3MeshVolumeCubicMeters(enu);
    const volumeDeviation = analyticVolume === 0 ? Number.POSITIVE_INFINITY : Math.abs(meshVolume - analyticVolume) / Math.abs(analyticVolume);
    if (!(volumeDeviation < MIDTOWN_CORE_V3_VOLUME_TOLERANCE) || !(meshVolume > 0)) {
      throw new MidtownCoreV3Stop(
        buildingId,
        "volume-identity-failed",
        `${lodId} signed mesh volume ${meshVolume} m³ against analytic ${analyticVolume} m³ (deviation ${volumeDeviation}).`,
      );
    }
    // Detail tiles ride on LOD 0 alone: LOD 1 is selected beyond 250 m, where a
    // 128-pixel joint is far below a screen pixel. A texture-free profile passes
    // null at both levels and emits exactly the bytes it always did.
    const texture = lodIndex === 0 ? profile.texture : null;
    const file = v3GeometryForGlb(plan, tessellation, {
      yUp: true,
      texture,
      textureFilter: texture ? profile.textureFilter ?? null : null,
    });
    // Same tiles, same sampler, same UVs; only WHERE the bytes live differs.
    const sharedUri = file.textures && profile.textureDelivery === "shared-uri" ? sharedUriTextureSet(file.textures, buildingId) : null;
    const written = writeCanonicalGlb({
      quads: file.quads,
      triangles: file.triangles,
      materials: file.materials,
      metadata: {
        canonicalFeatureId: buildingId,
        lodId,
        ownerCellId: options.ownerCellId,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId: midtownCoreV3EvidenceShardId(buildingId, profile.releaseId),
        truthTiers,
        sourceDates: { capturedAt: options.capturedAt, updatedAt: options.updatedAt },
        // The V2 asset this one supersedes, pinned by checksum and never edited.
        // Explicitly null when the predecessor wave shipped nothing for it.
        predecessor: options.predecessor,
        uncertainty: profile.uncertainty,
        planHashSha256: plan.planHashSha256,
        // Present exactly when the GLB carries images, which is the condition
        // the release validator uses to decide whether to demand a replay.
        ...(file.textures ? { textureProvenance: proceduralTextureProvenance() } : {}),
      },
      ...(sharedUri ? { uriTextures: { images: sharedUri.images, materialImage: sharedUri.materialImage, ...(sharedUri.filter ? { filter: sharedUri.filter } : {}) } } : file.textures ? { textures: file.textures } : {}),
    });
    if (
      written.counts.triangleCount > profile.budgets.maxTriangles
      || written.counts.materialCount > profile.budgets.maxMaterials
      || written.counts.textureCount > profile.budgets.maxTextures
    ) {
      throw new MidtownCoreV3Stop(
        buildingId,
        "asset-budget-exceeded",
        `${lodId} declares ${written.counts.triangleCount} triangles / ${written.counts.materialCount} materials / ${written.counts.textureCount} textures against the V3 budgets.`,
      );
    }
    assets.push({
      lodId,
      relativeRef: midtownCoreV3AssetRef(buildingId, lodId),
      bytes: written.bytes,
      checksumSha256: sha256HexBytes(written.bytes),
      counts: written.counts,
      volumeDeviation,
      meshVolumeCubicMeters: meshVolume,
      analyticVolumeCubicMeters: analyticVolume,
      // Only the tiles the WRITER KEPT, read back out of the bytes it just
      // emitted. An image no used material samples is dropped and the rest are
      // renumbered, so declaring the classes handed IN would declare an orphan
      // artifact the release gate refuses. Reading the emitted JSON cannot drift
      // from the writer's rule the way a restatement of that rule could.
      sharedTextureClasses: sharedUri ? emittedSharedTextureClasses(written.bytes, buildingId) : [],
    });
  }
  return {
    assets,
    registration: registration!,
    silhouette: midtownCoreV3SilhouetteMeasurement(plan),
    truthTiers,
    setbacksAbsent,
    setbackDisclosure: plan.massing.setbackDisclosure,
  };
}
