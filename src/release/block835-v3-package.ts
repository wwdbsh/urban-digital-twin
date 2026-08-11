/**
 * V3 asset quality budgets.
 *
 * These are a NEW, versioned gate. `BLOCK835_QUALITY_BUDGETS` is byte-frozen
 * into the committed V1 and V2 manifests and into their drift tests, so it is
 * never edited; a V3 asset is measured against its own budget instead.
 *
 * The triangle raise from 75,000 to 200,000 is a deliberate, named gate change,
 * not an accommodation. A fourteen-vertex concave prism with per-edge facade
 * bands costs several times what an axis-aligned box costs, and the worst case
 * on the real Block 835 data — the Empire State Building — measures 102,338
 * triangles at full detail. The raise is disclosed in ADR 0031 and is only
 * legitimate once measured frame time has been re-checked at the higher count.
 *
 * The material raise from 8 to 12 leaves headroom above the nine materials the
 * base/shaft zoning actually emits, so a later crown zone (T026) does not need
 * a second gate change.
 *
 * Textures stay at zero. V3 designs appearance with per-primitive materials; it
 * derives nothing from imagery, so there is nothing to sample.
 */
export const V3_QUALITY_BUDGETS = { maxTriangles: 200_000, maxMaterials: 12, maxTextures: 0 } as const;

/**
 * Registration semantics change in V3, and the change is the point of the task.
 *
 * V1 and V2 registered the minimum-area oriented bounding RECTANGLE of the
 * DOITT footprint, so their registration report measured pipeline drift — unit
 * conversion, ENU anchoring, millimetre rounding, float32 quantisation — and
 * explicitly disclaimed any claim about shape fidelity. V3 carries the true
 * ring, so registration compares TRUE FOOTPRINT VERTICES and can make the
 * stronger claim.
 *
 * The two tolerances are different measures and must not be conflated:
 * `perVertexShapeMeters` bounds how far any shipped vertex may sit from the
 * sourced vertex it came from, and `horizontalMeters`/`verticalMeters` bound
 * whole-asset placement drift as before.
 */
export const V3_REGISTRATION_TOLERANCE = {
  horizontalMeters: 0.25,
  verticalMeters: 0.5,
  /**
   * One millimetre of rounding plus float32 quantisation over a few hundred
   * metres of local extent. It is a PIPELINE tolerance: it bounds this
   * pipeline's own error against the sourced polygon, and asserts nothing about
   * how well that sourced polygon matches the real building.
   */
  perVertexShapeMeters: 0.05,
} as const;

export const V3_REGISTRATION_METHOD = {
  method: "true-footprint-vertex-registration",
  contractual: false,
  referenceGeometry: "The DOITT source footprint ring itself, vertex for vertex. V1 and V2 registered the minimum-area oriented bounding rectangle of that ring instead.",
  measures: "Per-vertex deviation between each shipped ground-ring vertex and the sourced footprint vertex it was derived from, plus whole-asset horizontal and vertical placement drift.",
  claim: "The shipped massing reproduces the sourced polygon to within the stated per-vertex tolerance. It does NOT claim that the sourced polygon matches the real building, and it claims nothing at all about facade, appearance, colour or material, all of which are designed.",
  verticalReference: "Roof plane of the topmost tier against the sourced heightMeters.",
  aboveSourcedHeight: "Shipped geometry extends above the sourced heightMeters by the rooftop cluster, which is declared truth tier `generated` and is authored rather than suppressed.",
} as const;
