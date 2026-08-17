/**
 * J7's FROZEN CONSTANTS: refused-parent honesty.
 *
 * Committed BEFORE the capture, in its own module rather than appended to
 * `exterior-acceptance-campaign-constants.mjs`, because that file is T006's
 * pre-registration: its values are checksummed into
 * `data/exterior-acceptance-20260817/pre-registration.json` and pinned by test.
 * A new task's bars do not belong inside a frozen one's record.
 *
 * WHY THE BUILDINGS ARE NAMED HERE. J7 asks whether a refused building explains
 * itself. If the capture picked its own subject at run time it could land on a
 * building whose refusal happens to render nicely, and a reader could not tell
 * that it had. One building per stop code is named below, chosen from the
 * committed serving graphs so that every branch of the closed vocabulary is
 * exercised and none is exercised twice.
 */

/** The dated evidence root. T007's own, never T006's. */
export const REFUSAL_EVIDENCE_ID = "refusal-ui-20260817";

/** The island-wide refusal population, from the six committed wave censuses. */
export const ISLAND_WIDE_TOMBSTONE_COUNT = 205;

/**
 * One refused building per stop code, read out of the `-s1` SERVING graphs the
 * app actually streams — not the `-c1` retention censuses. A building that is
 * tombstoned in retention but absent from serving would be unreachable in a
 * browser, and a journey that selected it would prove nothing.
 *
 * `lon`/`lat` are the owning cell's centre, which is where the camera goes.
 */
export const REFUSAL_SUBJECTS = [
  {
    stopCode: "ring-area-below-floor",
    buildingId: "doitt:1290701",
    releaseId: "manhattan-midtown-core-cells-20260811-v3-s1",
    cellId: "manhattan-exterior-cell-w01-000006-17-38594-35858",
    tombstoneId: "tombstone:manhattan-midtown-core-cells-20260811-v3-s1:doitt:1290701",
    lon: -73.997040,
    lat: 40.755844,
  },
  {
    stopCode: "ring-neck-below-grammar-minimum",
    buildingId: "doitt:510821",
    releaseId: "manhattan-central-upper-manhattan-cells-20260812-s1",
    cellId: "manhattan-exterior-cell-w04-000520-17-38610-35844",
    tombstoneId: "tombstone:manhattan-central-upper-manhattan-cells-20260812-s1:doitt:510821",
    lon: -73.953094,
    lat: 40.775070,
  },
  {
    stopCode: "ring-not-simple",
    buildingId: "doitt:819435",
    releaseId: "manhattan-central-upper-manhattan-cells-20260812-s1",
    cellId: "manhattan-exterior-cell-w04-000489-17-38607-35846",
    tombstoneId: "tombstone:manhattan-central-upper-manhattan-cells-20260812-s1:doitt:819435",
    lon: -73.961334,
    lat: 40.772324,
  },
  {
    stopCode: "volume-identity-failed",
    buildingId: "doitt:1269491",
    releaseId: "manhattan-central-upper-manhattan-cells-20260812-s1",
    cellId: "manhattan-exterior-cell-w04-000596-16-19307-17916",
    tombstoneId: "tombstone:manhattan-central-upper-manhattan-cells-20260812-s1:doitt:1269491",
    lon: -73.940735,
    lat: 40.790863,
  },
];

/** Street level over the subject's own cell. */
export const REFUSAL_POSE = { height: 300, heading: 45, pitch: -30, roll: 0 };

/**
 * THE TWO ARMS, and why J7 is captured in both.
 *
 * Every shipped refusal reason ends "...; base massing from the pinned citywide
 * release is what remains on screen." That clause is true in the DEFAULT arm and
 * false under `?exteriorScheduler=off`, where there is no overview tier drawing
 * base massing. H1 is the rule that the app must never ASSERT that clause as its
 * own live claim, and the only way to show the rule holds is to capture the same
 * refused building in both arms and check that what the app asserts does not
 * move while the release's quoted sentence stays intact.
 */
export const REFUSAL_ARMS = [
  { armId: "default", schedulerOff: false, note: "The shipped default: six promoted serving waves, overview tier active." },
  { armId: "scheduler-off", schedulerOff: true, note: "?exteriorScheduler=off — no visibility scheduling and no overview tier. The arm in which the release's trailing clause is FALSE." },
];

export const J7_GATES = {
  journeyId: "refused-parent-honesty",
  claim: "A refused parent's details panel names its stop code and gives a plain-language reason drawn from the release, in both streaming arms, without the app asserting the release's arm-dependent trailing clause.",
  "J7-a": { rule: "For every pre-registered subject, in BOTH arms, the panel renders the refusal case: [data-exterior-refusal] present, [data-exterior-not-resident] and [data-exterior-not-owned] absent." },
  "J7-b": { rule: "data-exterior-stop-code equals the subject's pre-registered stop code in both arms. 'unrecognized' is a FAIL: it would mean the shipped release carries a category this build does not know." },
  "J7-c": { rule: "The rendered tombstone id equals the pre-registered tombstoneId, so the panel is explaining THIS building's refusal and not a neighbour's." },
  "J7-d": { rule: "H1: the asserted statement carries neither 'base massing' nor 'what remains on screen' in EITHER arm, and is byte-identical between the two arms — what the app asserts must not depend on the arm." },
  "J7-e": { rule: "The attributed release quotation DOES carry the full sentence including the trailing clause, in both arms. Truncating without disclosing would hide what the release says." },
  "J7-f": { rule: "Zero external hosts contacted in either arm." },
};
