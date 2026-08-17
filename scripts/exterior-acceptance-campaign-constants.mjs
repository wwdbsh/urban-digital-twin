/**
 * THE T006 ACCEPTANCE CAMPAIGN'S FROZEN CONSTANTS.
 *
 * Every station, bar, gate, storm step and budget this campaign is judged
 * against lives here, in ONE module, committed in a pre-registration commit that
 * contains NO capture. That is the whole point of the file: a bar that can be
 * edited after a number is seen is not a bar, and the only way to make
 * "pre-registered" checkable by someone who was not present is to put the bars
 * in the history before the measurements exist.
 *
 * Two disciplines follow from that and are enforced rather than described:
 *
 *   1. `exterior-acceptance-campaign-constants.test.mjs` PINS the load-bearing
 *      values byte-for-byte. Changing a bar after the pre-registration commit
 *      therefore breaks a committed test, which is a visible act rather than a
 *      silent one.
 *   2. Nothing here is derived from a reading. Where a bar is inherited from an
 *      earlier task's record (D-11's 4,000 ms leg-Y bar, the strict 16.7/25 ms
 *      pair, the runtime's own cache and concurrency ceilings) it is imported or
 *      restated with its source named, so a reader can check the inheritance
 *      rather than take it on trust.
 *
 * WHAT THIS FILE DOES NOT DO: it does not decide any verdict. The capture CLIs
 * compute verdicts from readings against these constants and record both.
 */

import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { CITYWIDE_OVERVIEW_BUDGETS } from "../src/release/citywide-release.ts";
import { predictedTextureByteLength } from "../src/features/explorer/gpu-texture-probe.ts";

/** The dated evidence root every artifact this campaign writes lands under. */
export const CAMPAIGN_EVIDENCE_ID = "exterior-acceptance-20260817";

/**
 * The release whose Block 835 opt-in carries the ONLY distinguished lod_0 /
 * lod_1 pair in the shipped set. L1 renders on it; see `LOD_L1`.
 *
 * S0 RECONCILIATION: this id must still appear in
 * `PINNED_EXTERIOR_CELL_RELEASE_IDS` (src/app/App.tsx), or the L1 and J3 arms
 * cannot address it through `?exteriorCells=` at all. The pinning test asserts
 * the membership rather than trusting this comment.
 */
export const BLOCK_835_V3_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

/** Midtown anchor: Block 835's own cell, and the anchor every prior task used. */
export const ANCHOR = { lon: -73.986360, lat: 40.748775 };
/** A Lower-Manhattan street pose INSIDE serving wave w02. */
export const LOWER = { lon: -74.009000, lat: 40.706900 };
/** The island centroid, for the pose that must see the whole island at once. */
export const ISLAND = { lon: -73.9712, lat: 40.7831 };

/**
 * The five frozen stations.
 *
 * Inherited verbatim from the instruments that established them so this
 * campaign's numbers are comparable to theirs rather than merely similar:
 * `overview-52km-island`, `transition-1200m-anchor` and `street-260m-midtown`
 * from `citywide-heap-repeat-cli.mjs`, `overview-2400m-anchor` and
 * `street-260m-w02-lower` from `exterior-serving-evidence-cli.mjs`.
 *
 * `overview-52km-island` is pitch -90 — straight down. That is deliberate and is
 * the reason it is a station rather than a pretty view: a nadir camera at 52 km
 * puts the ENTIRE island in the frustum, so it is the maximum-residency pose in
 * the whole campaign, and a frame bar that never visits it has not been asked
 * the hardest question.
 */
export const STATIONS = [
  { stationId: "overview-52km-island", ...ISLAND, height: 52_000, heading: 0, pitch: -90, roll: 0, role: "nadir island overview; maximum-residency pose in the campaign" },
  { stationId: "overview-2400m-anchor", ...ANCHOR, height: 2_400, heading: 45, pitch: -50, roll: 0, role: "outer scheduler band edge" },
  { stationId: "transition-1200m-anchor", ...ANCHOR, height: 1_200, heading: 45, pitch: -45, roll: 0, role: "inner scheduler band edge; the overview-to-street transition" },
  { stationId: "street-260m-midtown", ...ANCHOR, height: 260, heading: 45, pitch: -25, roll: 0, role: "street level over the promoted midtown wave" },
  { stationId: "street-260m-w02-lower", ...LOWER, height: 260, heading: 45, pitch: -25, roll: 0, role: "street level INSIDE served wave w02; a bar that never enters w02 measures the wrong thing" },
];

// ---------------------------------------------------------------------------
// F — frames
// ---------------------------------------------------------------------------

/**
 * F1: the strict pair, at every station.
 *
 * 16.7 / 25 ms is the pair ADR 0045 registered and the flip campaign measured
 * against; it is inherited, not re-chosen. What is NEW here is the sample floor
 * and the settle.
 *
 * `minimumFrames: 600` and `windowMs: 12_000`: a 10 s window at a 60 Hz display
 * yields 600 rAF deltas MINUS the one the sampler drops (the first delta spans
 * the gap since the previous paint, not a rendered frame), i.e. 599 — one short
 * of the floor, every time, by construction. The window is therefore 12 s so the
 * floor is reachable on a nominal display without the sample count itself
 * becoming the thing that fails. This was worked out from the arithmetic before
 * the run, not after a short sample was seen.
 */
export const FRAME_F1 = {
  gateId: "F1",
  p50Ms: 16.7,
  p95Ms: 25,
  minimumFrames: 600,
  windowMs: 12_000,
  settleMs: 45_000,
  appliesTo: "every station in STATIONS",
  rule: "PASS if and only if, at EVERY station, p50 <= 16.7 ms AND p95 <= 25 ms over at least 600 sampled rAF deltas taken after 45,000 ms of settle.",
  inheritedFrom: "ADR 0045 FRAME_BUDGETS (scripts/citywide-default-flip-campaign-cli.mjs); the 45 s settle is that campaign's SETTLE_MS.",
};

/**
 * F2: the control discipline.
 *
 * A p95 frame time cannot be read as a property of the SCENE unless the
 * instrument's own noise floor is known, and on a vsync-capped display the
 * floor is the display. So the control is captured in the SAME browser, in both
 * vsync modes, and the rule below is a rule about what may be CONCLUDED rather
 * than a bar something passes.
 */
export const FRAME_F2 = {
  gateId: "F2",
  controlUrl: "about:blank",
  modes: ["vsync-on", "vsync-off"],
  sameBrowserRequired: true,
  rule: "The control is captured in the SAME browser session as the stations, in BOTH vsync modes, on about:blank. A station p95 verdict is only MEANINGFUL above the control's own p95 in the matching mode. A station p95 at or below the control's p95 is reported as instrument-limited, never as a scene result.",
  whyNotABar: "This gate cannot FAIL in the ordinary sense: it constrains interpretation. It is registered so that a p95 that merely reproduces the display cadence cannot later be quoted as evidence the scene is fast.",
};

/**
 * F4: the double-draw report, against D-11's INHERITED bar.
 *
 * D-11 (ADR 0045 section 5.2) recorded a 5,746 ms island-scale bounds-membership
 * double-draw that ALREADY exceeds this 4,000 ms bar, carried forward untouched
 * by ADR 0052. This campaign therefore cannot treat exceeding it as a NEW
 * failure: the deferral is the reason the number is expected to be large. The
 * registered outcome of exceeding it is a NAMED CARRY, not a campaign failure.
 */
export const FRAME_F4 = {
  gateId: "F4",
  legYDoubleDrawMs: 4_000,
  legXRebuildMs: 8_000,
  inheritedFrom: "ADR 0045 section 3.3 REVIVAL_BARS; the exceedance is ADR 0045 section 5.2 deferral D-11 (5,746 ms measured), carried forward unchanged by ADR 0052.",
  rule: "doubleDrawMs and totalBuildMs are REPORTED at every station and across the storm. Exceeding the 4,000 ms leg-Y bar is recorded as a named carry of D-11 with the measured value, NOT as a campaign failure. A value BELOW 4,000 ms is reported as such and does not close D-11 either, because one session is not the island-scale bounds rebuild D-11 names.",
};

/**
 * H1/H2: headroom, REPORTED and NON-GATING.
 *
 * Uncapping vsync is the only way to ask what the renderer could do if the
 * display were not the limit. It is registered as non-gating because an
 * uncapped loop is not what a user sees, so it can inform but must never
 * discharge a frame criterion.
 *
 * THE DETECTABILITY CONDITION is the honest part, and it is registered BEFORE
 * the capture: if the uncapped p50 at the heaviest street station does not
 * differ from the uncapped p50 at the overview by MORE than the vsync-off
 * control's own p95, then this instrument cannot separate the two scenes and the
 * finding is INSTRUMENT-STILL-SATURATED. That is a real result and it is the one
 * that gets reported; it is not a failure and it is not massaged into a signal.
 */
export const HEADROOM_H1 = {
  gateId: "H1",
  gating: false,
  launchFlags: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
  comparedStations: ["street-260m-w02-lower", "overview-2400m-anchor"],
  rule: "REPORTED, never gating. Uncapped rAF p50 is captured at every station.",
  detectabilityCondition: "The comparison is DETECTABLE only if |p50(street-260m-w02-lower) - p50(overview-2400m-anchor)| exceeds the vsync-off control's own p95. If it does not, the registered finding is INSTRUMENT-STILL-SATURATED: the loop is bounded by something other than the scene, and no scene conclusion may be drawn from it.",
};

export const HEADROOM_H2 = {
  gateId: "H2",
  gating: false,
  source: "CDP Performance.getMetrics deltas across each station's frame window",
  rule: "REPORTED, never gating. Deltas (not absolutes) are recorded so a reader sees the work attributable to the window rather than to the session's whole history.",
  caveat: "Performance.getMetrics counters are renderer-process accounting, not a GPU query. They are recorded as a second, independent view of the same window and are never reconciled into the rAF series.",
};

// ---------------------------------------------------------------------------
// S-1 — the pan/zoom/translate storm
// ---------------------------------------------------------------------------

/**
 * The six cross-wave translation targets, PRE-COMMITTED.
 *
 * Roughly 600 m apart, stepping south-southwest down the island axis from the
 * midtown anchor. The list is committed here rather than generated at capture
 * time for one reason: a storm that picks its own waypoints can wander into a
 * cheap corner, and a reader cannot tell that it did. Each step is
 * -0.0045 deg latitude and -0.0038 deg longitude, which at 40.75 deg N is
 * sqrt((0.0045*111320)^2 + (0.0038*111320*cos40.75)^2) ~= 595 m.
 *
 * The traverse deliberately crosses wave boundaries: it starts over the promoted
 * midtown core, runs through the southern-remainder wave and ends inside the
 * Lower-Manhattan wave, so cross-wave residency churn is exercised rather than
 * assumed.
 */
export const STORM_TRANSLATIONS = [
  { stepId: "t1", lon: -73.990160, lat: 40.744275 },
  { stepId: "t2", lon: -73.993960, lat: 40.739775 },
  { stepId: "t3", lon: -73.997760, lat: 40.735275 },
  { stepId: "t4", lon: -74.001560, lat: 40.730775 },
  { stepId: "t5", lon: -74.005360, lat: 40.726275 },
  { stepId: "t6", lon: -74.009160, lat: 40.721775 },
];

/** The four zoom excursions, driven by pushState so no reload intervenes. */
export const STORM_ZOOM_EXCURSIONS = [
  { stepId: "z1", height: 1_200 },
  { stepId: "z2", height: 260 },
  { stepId: "z3", height: 1_200 },
  { stepId: "z4", height: 260 },
];

/**
 * S-1: the storm.
 *
 * S-1a IS THE STRICTER RESOLUTION OF A T005 EXCLUSION, AND THAT IS STATED
 * RATHER THAN GLOSSED. The flip campaign captured a during-storm window and
 * recorded in as many words that the frame budgets did NOT apply to it; only the
 * post-storm steady-state window was judged. This campaign applies the FULL
 * strict pair to the during-storm window. That is a harder bar than T005's, it
 * was chosen before the capture, and if it fails it fails as a real finding
 * rather than being retrospectively excluded again.
 */
export const STORM_S1 = {
  gateId: "S-1",
  dragCount: 12,
  dragDisclosure: "Flip-identical: dx = step % 2 === 0 ? -220 : 220, dy = step % 3 === 0 ? 120 : -120, from viewport centre, 10 interpolated steps 30 ms apart. Byte-identical to scripts/citywide-default-flip-campaign-cli.mjs so the two storms are comparable.",
  zoomExcursions: STORM_ZOOM_EXCURSIONS,
  translations: STORM_TRANSLATIONS,
  gates: {
    "S-1a": {
      rule: "During-storm p50 <= 16.7 ms AND p95 <= 25 ms, over the frame window that spans the drags, the zoom excursions and the translations.",
      stricterThanT005: "ADR 0045's flip campaign explicitly EXCLUDED its during-storm window from the frame budgets and judged only the post-storm steady state. This gate applies the strict pair to the during-storm window itself. The exclusion is resolved in the stricter direction, deliberately and in advance.",
    },
    "S-1b": {
      rule: "peakConcurrentRequests <= 4 on every probe read during the storm, AND cacheEntries <= 1024 AND cachedBytes <= 268435456 throughout.",
      ceilingSource: "EXTERIOR_RUNTIME_BUDGETS",
    },
    "S-1c": {
      rule: "fallbackCellCount === 0 AND failedCellCount === 0 AND failedArtifactCount === 0, at EVERY probe read during and after the storm.",
      whyItExists: "THE T005 CANCELLATION-DEFECT REGRESSION GATE. A storm cancels in-flight requests continuously by moving the camera out from under them. A cancellation that is mis-accounted as a FAILURE shows up here and nowhere else, because a settled station never cancels anything. Zero is the only passing value; a non-zero count is a real regression, not storm noise.",
    },
    "S-1d": {
      rule: "cacheEvictions, releasedArtifactCount, releasedArtifactBytes and every exterior notice are REPORTED. No bar. They are the storm's residency story and are recorded so the next task has them.",
    },
    "S-1e": {
      rule: "Zero external hosts contacted, over the whole storm session.",
    },
  },
};

// ---------------------------------------------------------------------------
// G — GPU texture memory
// ---------------------------------------------------------------------------

/** Four shared class tiles per release: the shipped per-class catalogue. */
export const SHARED_CLASS_TILE_NAMES = ["brick-running-bond", "curtain-mullion-grid", "limestone-ashlar", "spandrel-panel"];
export const SHARED_CLASS_TILES_PER_WAVE = 4;
export const PROMOTED_WAVE_COUNT = 6;
/** 4 tiles x 6 promoted waves. The derivation, not a typed-in total. */
export const EXPECTED_UNIQUE_TILE_COUNT = SHARED_CLASS_TILES_PER_WAVE * PROMOTED_WAVE_COUNT;
/**
 * 24 * trunc(128 * 128 * 4 * 4 / 3) = 24 * 87,381 = 2,097,144 bytes.
 * Computed by the shipped probe module rather than typed, so the bar cannot
 * drift away from the arithmetic it claims to be.
 */
export const EXPECTED_TEXTURE_BYTE_LENGTH = predictedTextureByteLength(EXPECTED_UNIQUE_TILE_COUNT);
/**
 * The tolerance, pre-registered at n = 1 tile.
 *
 * ONE additional 128 x 128 RGBA tile is allowed through the same accounting to
 * absorb a single non-class texture the renderer may upload (a default or
 * fallback image). n is NOT a fudge factor for population growth: the entire
 * claim of ADR 0047 is that texture cost does not scale with building count, so
 * anything beyond one extra tile means per-building duplication has reappeared
 * and the gate must fail.
 */
export const TEXTURE_TOLERANCE_TILES = 1;

export const GPU_GATES = {
  "G1": {
    rule: "Instrument validation FIRST, on a scene with a known unique tile count: validateGpuTextureProbe(...).deltaByteLength MUST be exactly 0. Not a tolerance. A probe that disagrees with arithmetic on a small known scene has not earned the right to be quoted on a large one, and if G1 fails, G2-G4 are NOT reported as measurements.",
    barBytes: 0,
  },
  "G2": {
    rule: `texturesByteLength <= ${EXPECTED_TEXTURE_BYTE_LENGTH} + n * 87381 with n <= ${TEXTURE_TOLERANCE_TILES}, at the maximum-residency station.`,
    expectedByteLength: EXPECTED_TEXTURE_BYTE_LENGTH,
    perTileByteLength: predictedTextureByteLength(1),
    toleranceTiles: TEXTURE_TOLERANCE_TILES,
  },
  "G3": {
    rule: "Unique class tiles resident === 4 per RESIDENT WAVE, independent of resident building count. Captured at a station with >= 300 resident assets and again at a station with <= 20 resident assets; texturesByteLength must be explained by the resident WAVE count at both, never by the asset count.",
    residentAssetHigh: 300,
    residentAssetLow: 20,
    whyItIsTheRealClaim: "G2 is a budget. G3 is the ARCHITECTURE claim: it is the reading that distinguishes shared per-class delivery from per-building duplication, because only duplication makes the number move with population.",
  },
  "G4": {
    rule: "The embedded-texture counterfactual is REPORTED from the committed data/shared-class-textures-20260815/gpu-campaign.json arms (p1-embedded 15,204,294 B over 174 distinct textures vs t1-shared 349,524 B over 4). It is a CITATION of an earlier measurement restated beside this one, not a new capture, and it is labelled as such.",
    gating: false,
  },
};

// ---------------------------------------------------------------------------
// E-1 — eviction
// ---------------------------------------------------------------------------

/**
 * The eight-pose closed loop through the midtown neighbourhood.
 *
 * A CLOSED loop: pose 8 is byte-identical to pose 1, which is what makes the
 * re-entry gate E-1b a statement about re-admission rather than about a first
 * visit. The intermediate poses are chosen to have working sets that displace
 * each other.
 */
export const EVICTION_LOOP = [
  { poseId: "e1-anchor", lon: -73.986360, lat: 40.748775, height: 260, heading: 45, pitch: -25, roll: 0 },
  { poseId: "e2-north", lon: -73.981500, lat: 40.754500, height: 260, heading: 45, pitch: -25, roll: 0 },
  { poseId: "e3-northeast", lon: -73.975500, lat: 40.759500, height: 260, heading: 90, pitch: -25, roll: 0 },
  { poseId: "e4-east", lon: -73.970500, lat: 40.755000, height: 260, heading: 135, pitch: -25, roll: 0 },
  { poseId: "e5-southeast", lon: -73.975000, lat: 40.748000, height: 260, heading: 180, pitch: -25, roll: 0 },
  { poseId: "e6-south", lon: -73.982000, lat: 40.742500, height: 260, heading: 225, pitch: -25, roll: 0 },
  { poseId: "e7-southwest", lon: -73.991000, lat: 40.744000, height: 260, heading: 315, pitch: -25, roll: 0 },
  { poseId: "e8-anchor-return", lon: -73.986360, lat: 40.748775, height: 260, heading: 45, pitch: -25, roll: 0 },
];

export const EVICTION_GATES = {
  "E-1a": { rule: "cacheEvictions > 0 must be observed somewhere in the loop. The comparison condition is BYTE-IDENTICAL to the T005 condition that failed to observe eviction (data/exterior-serving-20260817/eviction-at-scale.json, findings.evictionsObserved === false, cacheEvictions === 0): same counter, same probe, same reading, different route." },
  "E-1b": { rule: "At the RETURN stop (e8-anchor-return): failedCellCount === 0 AND fallbackCellCount === 0 AND failedArtifactCount === 0. Every re-admitted byte is re-verified against the same declared size and SHA-256 by the runtime, so a clean re-entry IS a byte-identical re-entry; the gate names that inference rather than implying a separate byte comparison was made." },
  "E-1c": { rule: "peakConcurrentRequests <= 4 at every stop." },
  "E-1d": { rule: "cacheEntries <= 1024 AND cachedBytes <= 268435456 at every stop." },
  "E-1e": {
    rule: "Selection identity across the eviction cycle: the details-panel digest at e1-anchor and at e8-anchor-return must be EQUAL and BOTH NON-NULL.",
    selector: 'aside.inspector[aria-label="Selected feature details"]',
    openedVia: "?feature=<id> deep link applied BEFORE the roam begins, so the selection survives the loop rather than being re-made at the end.",
    whyNonNullIsRegistered: "T005 recorded selectionDigestFirstVisit: null and selectionDigestAfterReEntry: null and reported selectionStableAcrossEviction: false. Two nulls are EQUAL, so an equality-only rule would have been silently satisfied by an instrument that read nothing. The non-null conjunct is what makes this gate capable of failing. The null itself was an instrument defect: the old selector was [role=\"complementary\"], and the panel carries an IMPLICIT complementary role via <aside>, which a CSS attribute selector cannot match.",
  },
  "E-1f": {
    rule: "CARRIED VERBATIM, not closed: 'A CANVAS PICK on the re-admitted mesh was not captured. The selection above is reached through a ?feature= deep link against the canonical base identity set, so it shows the same building resolving to the same sourced information across an eviction cycle; it does not show that a mouse click on the re-admitted geometry returns that identity. That is a real gap and is named rather than approximated.'",
    source: "data/exterior-serving-20260817/eviction-at-scale.json, field uncapturedGap",
  },
};

// ---------------------------------------------------------------------------
// M — heap
// ---------------------------------------------------------------------------

export const HEAP_GATES = {
  instrument: "scripts/citywide-heap-repeat-cli.mjs, re-run with --out to this campaign's dated evidence root.",
  frozenPathProhibition: `The instrument's historical output root data/citywide-heap-repeat-20260815/ is FROZEN evidence of the T008 run and must not be written. This campaign passes --out ${CAMPAIGN_EVIDENCE_ID} and the drift test asserts the 20260815 record's checksum is unchanged.`,
  "M1": { rule: "The T008 pass rule, inherited unchanged: first-half-versus-second-half median growthRatio <= 0.10 AND heapVerdict.monotonicGrowthDetected === false, over >= 6 sampled repeats, each reading taken from performance.memory AFTER an explicit in-page window.gc()." },
  "M2": {
    rule: "NEW VALIDITY CONDITION: every heap sample must be taken with activeRequests === 0. A sample taken while artifacts are still in flight measures a transient, not what survives a cycle.",
    onViolation: "INSTRUMENT-FAILURE ABORT. The run writes no record and is repeated with attemptCount incremented. It is NOT recorded as a heap failure, because a sample taken mid-flight is not a reading of the quantity the gate is about.",
    whyItIsNew: "T008 relied on a 45 s settle to imply quiescence and never read activeRequests at sample time. At six-wave scale the settle is no longer self-evidently sufficient, so the implication is replaced by a reading.",
  },
  "M3": { rule: "The disclosed secondary series at overview-52km-island is captured and published, never the verdict." },
  "M4": { rule: "attemptCount is recorded. A run is repeated ONLY for a named instrument failure (a pre-flight abort, an M2 violation, a landing failure), never because a series looked wrong." },
  lapPhaseCapMs: 75 * 60 * 1_000,
  lapPhaseCapReason: "RAISED from 50 to 75 minutes for this campaign. The T008 cap was sized for a session whose exterior residency was one wave; the arithmetic floor at six promoted waves is 9 laps x 5 poses x (45 s settle + >= 5 s landing dwell) ~= 37.5 min BEFORE any re-dispatch, and six-wave boots and landings are materially slower than the one-wave session the 50-minute cap was fitted to. Raising it prevents the cap from firing on a healthy slow run, which would be an instrument failure masquerading as a result. It is raised in the pre-registration commit, before any lap ran.",
};

// ---------------------------------------------------------------------------
// Request ceilings — the TWO POOLS, and why there is no "8"
// ---------------------------------------------------------------------------

/**
 * THE CORRECTED CEILING STATEMENT.
 *
 * The old contract phrasing was "<= 8 active requests", and it is wrong in this
 * codebase in a way worth stating exactly, because the wrong number is the more
 * flattering one and nobody should inherit it by accident.
 *
 * Structurally there are TWO request pools:
 *   - the exterior loader's pool, ceiling EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests = 4;
 *   - the citywide adapter's pool, ceiling CITYWIDE_OVERVIEW_BUDGETS.maxConcurrentRequests = 4
 *     (inherited by spread from CITYWIDE_BUDGETS; the overview record does not raise it).
 *
 * But in the SHIPPED default session those two pools are not independent. App.tsx
 * constructs ONE `AggregateRequestBudget` (composed-release-runtime.ts:95,
 * maxConcurrent = CITYWIDE_BUDGETS.maxConcurrentRequests = 4) and hands the SAME
 * instance to the citywide adapter, the civic adapter and every exterior wave
 * runtime. Every loader must acquire that one permit before touching the local
 * payload. The app-wide bound is therefore a provable 4, which
 * exterior-cell-runtime.ts already records in its own header as satisfying the
 * old "<= 8" phrasing "by a stricter, provable 4".
 *
 * TWO CONSEQUENCES FOR THIS CAMPAIGN, both registered:
 *   1. The gate is `peak <= 4` on every probe read. There is no 8 anywhere.
 *   2. THE TWO PROBES' PEAKS MUST NEVER BE SUMMED. When a shared budget is
 *      installed, both the exterior metrics and the composed metrics report
 *      `sharedBudget.peakConcurrency()` — the SAME semaphore's peak. Adding them
 *      would double-count one number, and it would not measure any instant
 *      either, since two independently observed peaks need not be simultaneous.
 */
export const REQUEST_CEILINGS = {
  exteriorPoolMaxConcurrent: EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests,
  citywidePoolMaxConcurrent: CITYWIDE_OVERVIEW_BUDGETS.maxConcurrentRequests,
  appWideSharedSemaphoreMaxConcurrent: 4,
  gate: "peak <= 4 on every probe read, per pool, at every station and throughout the storm and the eviction loop.",
  neverSum: "The exterior and composed probes report the SAME AggregateRequestBudget peak when a shared budget is installed. Their peaks are never summed and no combined '8' bar is registered or reported.",
  supersededPhrasing: "The contract's '<= 8 active requests' is superseded by the stricter provable 4 and is recorded here only so the correction is visible.",
};

export const CACHE_CEILINGS = {
  maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
  maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
};

/**
 * The scheduler's HARD cap on resident cells.
 *
 * RESTATED here rather than imported, for a mechanical reason worth recording:
 * `exterior-visibility-scheduler.ts` imports `./viewport-footprint` without a
 * file extension, which Node's type-stripping ESM resolver cannot resolve, so a
 * `.mjs` CLI cannot import that module at all (vitest's resolver can). The
 * constant is therefore restated here and PINNED against the real one by
 * `exterior-acceptance-campaign-constants.test.mjs`, which runs under vitest and
 * can import it. A drift in the scheduler breaks that test rather than silently
 * invalidating the E-1 forcing argument.
 *
 * Its value is load-bearing: T005 lowered it from 128 to 8 on 2026-08-17 because
 * 8 is, in the scheduler's own words, "the LARGEST cap the unchanged byte
 * ceiling admits".
 */
export const SCHEDULER_RESIDENT_UNIT_CAP = 8;

// ---------------------------------------------------------------------------
// J — journeys
// ---------------------------------------------------------------------------

/**
 * The six journeys, captured by a NEW CLI.
 *
 * `scripts/exterior-serving-journeys-cli.mjs` is new on purpose. The seven
 * curated journey CLIs and the seven `journey-evidence.json` records they wrote
 * are FROZEN evidence of the waves they were captured for; re-running one to get
 * a six-wave reading would overwrite a record whose value is that it describes a
 * different composition. The new CLI writes to this campaign's own root and
 * touches none of them.
 */
export const JOURNEY_GATES = {
  cli: "scripts/exterior-serving-journeys-cli.mjs",
  frozenCliProhibition: "The seven curated journey CLIs and their seven committed journey-evidence.json records are not run and not modified. The drift test asserts their checksums are unchanged.",
  "J1": { journeyId: "cold-default-six-wave", claim: "A cold default session activates all six promoted serving waves with no opt-in parameter." },
  "J2": { journeyId: "search-select-details", claim: "Search resolves a served building, selection opens the details panel, and the panel carries cell/release, active asset, truth tiers and uncertainty rows." },
  "J3": { journeyId: "block835-opt-in", claim: "The Block 835 -v3 opt-in still resolves through ?exteriorCells= and renders beside the promoted default." },
  "J4": { journeyId: "deep-link-identity", claim: "A ?feature= deep link resolves the same building to the same sourced information as an interactive selection, and the URL round-trips." },
  "J5": { journeyId: "streaming-off-honesty", claim: "With exterior streaming off, the app states what is unavailable rather than silently drawing less, and the still differs from the default arm." },
  "J6": {
    journeyId: "eviction-identity-cross-reference",
    claim: "Selection identity across an eviction cycle.",
    crossReference: "CROSS-REFERENCES E-1e rather than duplicating it. The eviction loop is the E-1 capture; this journey records the E-1e digest pair and its verdict by reference, so one measurement is reported once. It does not re-run the loop.",
  },
};

// ---------------------------------------------------------------------------
// L — LOD
// ---------------------------------------------------------------------------

/**
 * The Block 835 camera pose family, inherited from App.test.tsx's
 * BLOCK_835_CAMERA_QUERY so the L1 stills are taken where the distinguished
 * pair actually lives.
 */
export const BLOCK_835_CAMERA = { lon: -73.986360, lat: 40.748775, height: 900, heading: 0, pitch: -45, roll: 0 };

export const LOD_L1 = {
  gateId: "L1",
  releaseId: BLOCK_835_V3_RELEASE_ID,
  buildingCount: 14,
  stillHeightsM: [300, 200],
  /**
   * The opt-in ships lod_0 with `maxDistanceMeters: 250` and lod_1 with
   * `maxDistanceMeters: null`. Under the INSPECTION profile the selector returns
   * lod_0 at or below 250 and lod_1 above it, so the pair straddles 250 m and
   * the two still heights are on opposite sides of that seam.
   *
   * THE EXPLORATION PROFILE CANNOT DEMONSTRATE THE TRANSITION and the capture
   * must not be taken in it: `exterior-render-profiles.test.ts` pins exploration
   * to lod_1 at 100, 250 AND 251 m — it never selects lod_0 at all, so a still
   * pair taken there would show one LOD twice and could be mistaken for a
   * working transition. The profile is therefore part of the frozen method.
   */
  profile: "inspection",
  lodSeamMeters: 250,
  /**
   * The selector is NOT fed a camera-to-asset distance. App.tsx feeds it
   * `Math.max(50, Math.round(cameraHeight / 100) * 100)` — a BUCKETED camera
   * ellipsoid height. 200 m buckets to 200 (below the seam, lod_0) and 300 m
   * buckets to 300 (above it, lod_1). A 260 m pose would bucket to 300 and land
   * on the same side as 300, which is why the still heights are 200 and 300
   * rather than 260 and 300.
   */
  heightBucketingDisclosure: "selectExteriorLod receives Math.max(50, Math.round(height / 100) * 100), not a true camera-to-asset distance. The still heights are chosen so the BUCKETED values (200 and 300) straddle the 250 m seam.",
  /**
   * NEGATIVE RESULT, established before the capture: no probe payload and no
   * data-* attribute exposes the selected lodId. The scheduler, citywide and
   * texture probes carry none. The ONLY surface is the details panel's
   * "Active asset" row, rendered as `${asset.lodId} · ${asset.checksumSha256}`.
   * The reading is therefore a DOM scrape of that row, and it requires a
   * selected feature.
   */
  lodIdReadMethod: 'Scrape the <dd> following <dt>Active asset</dt> inside aside.inspector[aria-label="Selected feature details"] and split on " · ". No probe exposes lodId; this is the only surface, and the campaign records that rather than adding one.',
  rule: "With a feature selected on the Block 835 -v3 opt-in under the inspection profile, capture rendered stills at bucketed heights 200 m and 300 m at the BLOCK_835_CAMERA pose family and read the selected lodId at each. PASS if the lodId is lod_0 at 200 m, lod_1 at 300 m, and both stills render and differ by checksum.",
  claim: "The lod_0-to-lod_1 transition MECHANISM renders, demonstrated on the only distinguished LOD pair addressable by the running app: 14 buildings in one opt-in release.",
  explicitlyNotDischarging: "AC #4. Criterion #4 requires the 2% key-silhouette gate on stratified samples PER WAVE, measured on rendered evidence. Fourteen buildings in one opt-in release is not a per-wave stratified sample of six waves, and this gate does not claim to be one.",
};

export const LOD_L2 = {
  gateId: "L2",
  verdict: "HONEST-STOP",
  rule: "PRE-REGISTERED AS STRUCTURALLY UNREACHABLE. The per-wave rendered 2% key-silhouette gate cannot be measured under the shipped serving arrangement, because the six promoted -s1 serving waves deliver a SINGLE LOD per building. There is no rendered lod_0-to-lod_1 transition to sample per wave, so no capture this campaign could run would produce the evidence AC #4 asks for. This is registered BEFORE the capture as a stop, not discovered after a failed attempt.",
  reachabilityRoutes: [
    "ROUTE 1 - serve both LODs: re-cut the six serving waves to ship lod_0 and lod_1 per building and let the runtime select between them, then sample stratified per wave on rendered stills. This is a release-shape change (ADR 0052 territory), not a measurement change.",
    "ROUTE 2 - measure on the retained set: the -c1 retention packages DO carry both LODs for all 44,989 buildings. A per-wave stratified 2% gate could be measured by rendering from the retained packages directly, outside the serving path. That measures the ARTIFACTS rather than what the app draws, and the difference must be stated in any record that takes this route.",
  ],
  analyticRecordStatus: "The analytic island-scale LOD record is cited as PLAN-STAGE evidence only. It is arithmetic over generated plans, not rendered evidence, and AC #4 asks for rendered evidence; it is named here so a reader knows what does exist and what it is worth.",
};

// ---------------------------------------------------------------------------
// Visual verification (AC #8) and the Blender inheritance
// ---------------------------------------------------------------------------

export const VISUAL_GATES = {
  rule: "Rendered stills are captured at every station in STATIONS and at every journey, checksummed, and committed as what-is-drawn evidence.",
  blenderInheritance: {
    claim: "The T004 Blender re-import agreement (94 of 94 sampled buildings) INHERITS to the shipped -s1 serving releases and is NOT re-run.",
    argument: "The agreement was measured on the -c1 retention payloads. The -s1 serving releases are BYTE COPIES of the -c1 GLBs - the serving cut changes which artifacts a release declares and where the class tiles live, not the geometry bytes - and every served byte is re-verified at load against the same declared size and SHA-256. A re-import of a byte-identical GLB is arithmetically guaranteed to reproduce the same measurement, so re-running it would generate evidence that could not differ.",
    honesty: "This is an INHERITANCE ARGUMENT resting on the byte-copy proof, stated as such. If the byte-copy proof does not hold for a wave, the inheritance does not hold for that wave either, and the campaign records that rather than asserting agreement it did not measure.",
    source: "data/mass-generation-20260816/blender-agreement.json",
  },
};

// ---------------------------------------------------------------------------
// Campaign-wide discipline
// ---------------------------------------------------------------------------

export const CAMPAIGN_DISCIPLINE = {
  attemptPolicy: "SINGLE attempt per capture. attemptCount is recorded on every record. A capture is repeated ONLY for a NAMED instrument failure (a pre-flight abort, an M2 activeRequests violation, a pose-landing failure, a probe that never mounted), never because a reading looked wrong. The name of the failure is recorded with the attempt.",
  failurePolicy: "If ANY gate fails its pre-registered bar, the FAILURE IS RECORDED and the campaign CONTINUES. All verdicts are reported together at the end. The goal's own honest-stop form is a named failure with its number, not an abandoned run.",
  chromeDiscipline: "T008 discipline: a scratch user-data-dir per capture session, killed after, with the surviving-process count READ rather than assumed and recorded as a number.",
  preRegistrationCommit: "This module and its pinning test are committed BEFORE any capture. No capture exists at that commit.",
};

/**
 * The corrected acceptance-criterion mapping.
 *
 * Recorded because the mapping was wrong in an earlier reading of the plan, and
 * a campaign that measures the right things against the wrong criterion numbers
 * discharges nothing.
 */
export const AC_MAPPING = {
  "#3": "Texture architecture: shared per-class URI delivery (NO ATLAS) under ADR 0047's measured-equivalent clause; GPU texture memory measured, not arithmetic-only. Gates G1-G4.",
  "#4": "LOD chain: per-wave stratified 2% key-silhouette gate on RENDERED evidence. Gates L1 (mechanism only, does NOT discharge) and L2 (HONEST-STOP).",
  "#5": "Frame budgets at full-textured-city scale off the vsync floor with a capped control. Gates F1, F2, F4, S-1a.",
  "#6": "Repeated-camera-path heap non-monotonic under forced collection, plus GPU texture memory. Gates M1-M4 and G2.",
  "#7": "CACHE AND STREAMING GOVERNANCE, including the request ceiling: eviction correctness, pick identity across evict/reload, byte-identical re-entry, active requests bounded. Gates E-1a..E-1f, S-1b, S-1c, S-1d, and REQUEST_CEILINGS.",
  "#8": "VISUAL VERIFICATION: rendered stills at approved viewpoints as what-is-drawn evidence, plus picking/details/provenance/deep-links/attribution on the committed journey suites. Gates J1-J6, VISUAL_GATES, and the Blender inheritance argument.",
  correctionNote: "#7 is cache/streaming governance and owns the request ceiling; #8 is visual verification and owns the stills and the journey suites. An earlier reading had these two transposed.",
};
