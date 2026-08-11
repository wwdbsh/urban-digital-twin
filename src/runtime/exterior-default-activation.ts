/**
 * Frozen promotion records for the exterior waves this build activates.
 *
 * The build activates an ORDERED SET of waves (`EXTERIOR_DEFAULT_ACTIVATIONS`),
 * today Block 835 followed by Midtown-core. Each wave is its own record, and the
 * per-record properties below hold PER RECORD — one wave rolling back neither
 * withdraws nor implies anything about another.
 *
 * The promoted release, its operator-pinned head, and its cell/building
 * membership are ONE indivisible constant. Rollback is the single edit that
 * exports `EXTERIOR_DEFAULT_ACTIVATION.predecessor` instead, so a partial
 * rollback (default still on, pin gone; pin kept, membership gone) is not
 * representable in this build. The predecessor also refuses explicit opt-ins
 * into the withdrawn release, so promotion-era `?exteriorCells=` bookmarks fail
 * closed without a second edit. The values are data-in-code on purpose: a
 * runtime-fetched promotion document could disagree with the bytes this build
 * was reviewed against, and nothing here is fetched, parsed, or negotiated.
 *
 * `snapshotId`, `snapshotChecksumSha256`, and `assemblyPackageIds` are a byte
 * copy of `defaultHead` in the committed
 * `public/data/manhattan-exterior-cells-20260811/index.json`;
 * `exterior-default-activation.test.ts` fails closed on any drift.
 */

export interface ExteriorAcceptedCell {
  readonly cellId: string;
  readonly cellReleaseId: string;
  readonly checksumSha256: string;
}

/**
 * Accepted cell membership, stated in exactly ONE of two forms.
 *
 * A small wave lists its cells literally: fourteen buildings in one cell is
 * reviewable as text, and the reviewer can see the accepted bytes. A 149-cell
 * wave cannot be: twenty kilobytes of triples in a source file is not read by
 * anybody, and pasting it does not make the acceptance stronger — the gate
 * still only compares it against what the runtime resolved. So a large wave
 * states the same fact as ONE digest over the canonical join, which the pin
 * gate RECOMPUTES from the resolved cells and compares. The digest is exactly
 * as strict (any cell id, cell-release id, or checksum differing changes it)
 * and is reviewable, which the literal form stops being at this size.
 *
 * `cellCount` is stated in both forms so a resolve that returned a truncated
 * or padded cell set fails closed even before the digest is compared.
 */
export interface ExteriorDefaultActivationMembership {
  /** The literal accepted cells. Empty exactly when `cellsDigestSha256` is set. */
  readonly cells: readonly ExteriorAcceptedCell[];
  /** SHA-256 over `exteriorAcceptedCellsJoin`, or `null` for the literal form. */
  readonly cellsDigestSha256: string | null;
  readonly cellCount: number;
  readonly buildingIds: readonly string[];
}

/**
 * The canonical, order-independent text form of a cell set. Both membership
 * forms compare against this exact string, so the digest form is a digest of
 * precisely what the literal form compares.
 */
export function exteriorAcceptedCellsJoin(cells: readonly ExteriorAcceptedCell[]): string {
  return cells.map((cell) => `${cell.cellId}|${cell.cellReleaseId}|${cell.checksumSha256}`).sort().join(", ");
}

/** SHA-256 hex of the canonical join. Async because Web Crypto is. */
export async function exteriorAcceptedCellsDigest(cells: readonly ExteriorAcceptedCell[]): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable; the exterior membership digest could not be computed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(exteriorAcceptedCellsJoin(cells)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The disabled state carries no *active* release: it is the base-only
 * predecessor. It does name the release it rolled back, because a rollback that
 * left the withdrawn release reachable through its own `?exteriorCells=` link
 * would not be a rollback — every bookmark taken during the promotion would keep
 * rendering the withdrawn wave, ungated. `rolledBackReleaseId` is what makes
 * those links fail closed, so the one-line record swap stays the whole rollback.
 */
export interface ExteriorDefaultActivationDisabled {
  readonly enabled: false;
  readonly releaseId: null;
  readonly rolledBackReleaseId: string | null;
}

export interface ExteriorDefaultActivationEnabled {
  readonly enabled: true;
  readonly releaseId: string;
  readonly snapshotId: string;
  readonly snapshotChecksumSha256: string;
  readonly assemblyPackageIds: readonly string[];
  readonly membership: ExteriorDefaultActivationMembership;
  readonly approvalRef: string;
  /**
   * The release THIS record withdrew, or `null` for a forward promotion.
   *
   * A rollback used to be expressible only as "off": the predecessor of a first
   * promotion is base massing, so `enabled: false` said everything. A wave on its
   * SECOND promotion has a different previous verified representation — the wave
   * itself, one version back — and rolling back to base would discard verified
   * geometry that was never withdrawn. So an enabled record may also name a
   * withdrawn successor, and `exteriorRolledBackReleaseNotice` reads the field on
   * both shapes: rolling back to the predecessor restores the older release as
   * the active default AND refuses promotion-era `?exteriorCells=` links into the
   * withdrawn one, still in a single record swap.
   *
   * A record may never name its own `releaseId` here; `exterior-default-activation.test.ts`
   * pins that, because a release cannot both be the active default and be refused.
   *
   * Optional, and absent means "withdrew nothing". A forward promotion — which
   * every record in this build except a rollback target is — genuinely has
   * nothing to say here, and making it optional is what keeps every existing
   * promotion record and every existing test literally unchanged.
   */
  readonly rolledBackReleaseId?: string | null;
  /**
   * The previous verified representation this record rolls back to.
   *
   * It may itself be ENABLED. Per-record indivisibility is preserved exactly:
   * the rollback is still the one edit that exports `predecessor` instead, and
   * the predecessor is still one indivisible constant carrying its own release,
   * pin and membership together.
   */
  readonly predecessor: ExteriorDefaultActivationRecord;
}

export type ExteriorDefaultActivationRecord = ExteriorDefaultActivationEnabled | ExteriorDefaultActivationDisabled;

/**
 * The fourteen canonical Block 835 identities. Unchanged across V2 and V3.
 *
 * Exported because the Lower-Manhattan wave sizes its renderable subset against
 * the shared runtime cache, and the entries the promoted Block 835 wave occupies
 * are a function of THIS membership rather than of a remembered number.
 */
export const BLOCK835_MEMBERSHIP_BUILDING_IDS: readonly string[] = [
  "doitt:102705", "doitt:131170", "doitt:147902", "doitt:262867", "doitt:39969",
  "doitt:460555", "doitt:498980", "doitt:502491", "doitt:584049", "doitt:778052",
  "doitt:812702", "doitt:835659", "doitt:925937", "doitt:982383",
];

/**
 * The V2 Block 835 promotion record, retained verbatim as the V3 record's
 * predecessor — the previous VERIFIED representation, not base massing.
 *
 * Every operative field is the byte copy that shipped as the active default from
 * 2026-08-11: release, snapshot, snapshot checksum, assembly package, literal
 * cell membership and approval reference. The single field it gains is
 * `rolledBackReleaseId`, which is empty while this record is only a predecessor
 * and names the withdrawn V3 release when a rollback exports it as the active
 * default. That field is what makes the rollback complete in one edit rather
 * than two: without it the V3 release would stop being the default while every
 * promotion-era `?exteriorCells=manhattan-exterior-cells-20260811-v3` bookmark
 * kept rendering the withdrawn wave, ungated.
 *
 * `block835-v3-promotion-record.test.ts` derives the V2 pins from the committed
 * `public/data/manhattan-exterior-cells-20260811/` bytes, so this copy cannot
 * drift from the release it names.
 */
export const BLOCK835_V2_EXTERIOR_ACTIVATION: ExteriorDefaultActivationEnabled = {
  enabled: true,
  releaseId: "manhattan-exterior-cells-20260811",
  snapshotId: "snapshot:manhattan-exterior-cells-20260811:v1",
  snapshotChecksumSha256: "18e1689e19264543d8aaacafe989769b5d74f04cf0f5ca9cfc6c5407632e0ae7",
  assemblyPackageIds: ["manhattan-esb-block-reference-20260811"],
  membership: {
    cells: [{
      cellId: "cell:manhattan:block-835",
      cellReleaseId: "cell-release:manhattan-exterior-cells-20260811:v1",
      checksumSha256: "418ec17d40cdbe89be781367df5cf4d47dc4fba3bf3902b019c6431e05ce4a87",
    }],
    cellsDigestSha256: null,
    cellCount: 1,
    buildingIds: BLOCK835_MEMBERSHIP_BUILDING_IDS,
  },
  approvalRef: "Issue #11 gate approval 2026-08-11 + perf evidence PR #38",
  rolledBackReleaseId: null,
  predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: "manhattan-exterior-cells-20260811" },
} as const;

/**
 * The rollback target a V3 withdrawal exports: the V2 record above, plus the one
 * statement a withdrawal has to make. It is built FROM that record rather than
 * retyped, so the two can never disagree about which bytes V2 was.
 */
export const BLOCK835_V2_EXTERIOR_ROLLBACK: ExteriorDefaultActivationEnabled = {
  ...BLOCK835_V2_EXTERIOR_ACTIVATION,
  rolledBackReleaseId: "manhattan-exterior-cells-20260811-v3",
} as const;

/**
 * Rollback: export `EXTERIOR_DEFAULT_ACTIVATION.predecessor` from here instead.
 *
 * The Block 835 wave on its SECOND promotion. Membership is byte-identical to
 * V2's fourteen identities — the V3 grammar changes how each building is drawn,
 * never which buildings the wave owns — so this promotion carries no
 * availability drift, and `block835-v3-promotion-record.test.ts` derives every
 * pin below from the committed `public/data/manhattan-exterior-cells-20260811-v3/`
 * bytes on every run.
 */
export const EXTERIOR_DEFAULT_ACTIVATION: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "manhattan-exterior-cells-20260811-v3",
  snapshotId: "snapshot:manhattan-exterior-cells-20260811-v3:v1",
  snapshotChecksumSha256: "6ade605778c5e2700930029a94354b4b86a8d905eb7fde67665fff84d03449e1",
  assemblyPackageIds: ["manhattan-esb-block-reference-20260811-v3e"],
  membership: {
    cells: [{
      cellId: "cell:manhattan:block-835",
      cellReleaseId: "cell-release:manhattan-exterior-cells-20260811-v3:v1",
      checksumSha256: "b5cb68f703f24db5d8f71e170d5de3a2b7fc0a372f853cdf8d48f0e194994d0d",
    }],
    cellsDigestSha256: null,
    cellCount: 1,
    buildingIds: BLOCK835_MEMBERSHIP_BUILDING_IDS,
  },
  approvalRef: "Issue #44 gate approval 2026-08-11 (T026 V3 promotion)",
  rolledBackReleaseId: null,
  predecessor: BLOCK835_V2_EXTERIOR_ROLLBACK,
} as const;

/**
 * The V2 Midtown-core promotion record, retained verbatim as the V3 record's
 * predecessor — the previous VERIFIED representation, not base massing.
 *
 * Every operative field is the byte copy that shipped as the active default
 * from 2026-08-11: release, snapshot, snapshot checksum, assembly package,
 * digest-form cell membership over 149 cells, the 160 accepted building
 * identities, and the approval reference. Nothing here is re-derived or
 * re-stated; the only field it gains is `rolledBackReleaseId`, which is empty
 * while this record is only a predecessor and names the withdrawn V3 release in
 * `MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK` below.
 *
 * `snapshotId`, `snapshotChecksumSha256`, `assemblyPackageIds`,
 * `cellsDigestSha256`, `cellCount`, and `buildingIds` are all recomputable
 * from the committed `data/midtown-core-20260811/payload-inventory.json`
 * alone, and `exterior-midtown-promotion-record.test.ts` recomputes every one
 * of them on every run — no payload directory required, so the drift gate is
 * never skipped.
 */
export const MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION: ExteriorDefaultActivationEnabled = {
  enabled: true,
  releaseId: "manhattan-midtown-core-cells-20260811",
  snapshotId: "snapshot:manhattan-midtown-core-cells-20260811:v1",
  snapshotChecksumSha256: "2b9be277663d4c5f06f44f8a5084ecacabd122641d536c22daa45c35e244518d",
  assemblyPackageIds: ["assembly:manhattan-midtown-core-cells-20260811:v1"],
  membership: {
    cells: [],
    cellsDigestSha256: "9b3edcc16395bee44395a8b90647bee0a40e9bc67ca83dd1ce45d0fc92db3074",
    cellCount: 149,
    buildingIds: [
      "doitt:1001111", "doitt:105916", "doitt:1104532", "doitt:1105839", "doitt:1106429",
      "doitt:1111726", "doitt:1114625", "doitt:1115013", "doitt:1116162", "doitt:111690",
      "doitt:1117425", "doitt:1158178", "doitt:1191064", "doitt:1195535", "doitt:1215127",
      "doitt:1221493", "doitt:1224763", "doitt:1232671", "doitt:1256080", "doitt:1260400",
      "doitt:1262786", "doitt:1263464", "doitt:1264335", "doitt:1268457", "doitt:1268463",
      "doitt:1268618", "doitt:1272399", "doitt:127864", "doitt:1279525", "doitt:1279526",
      "doitt:1279527", "doitt:1281874", "doitt:1282695", "doitt:1285662", "doitt:1286246",
      "doitt:1287486", "doitt:1288650", "doitt:1289963", "doitt:1289964", "doitt:1294316",
      "doitt:1295112", "doitt:1296496", "doitt:1297513", "doitt:1299442", "doitt:1299576",
      "doitt:1300185", "doitt:1302197", "doitt:1302589", "doitt:139071", "doitt:157592",
      "doitt:162071", "doitt:166790", "doitt:174372", "doitt:181184", "doitt:194068",
      "doitt:196987", "doitt:225670", "doitt:227702", "doitt:228631", "doitt:229752",
      "doitt:241646", "doitt:246449", "doitt:260361", "doitt:261397", "doitt:275393",
      "doitt:297071", "doitt:297390", "doitt:29844", "doitt:316002", "doitt:317859",
      "doitt:328864", "doitt:347215", "doitt:348074", "doitt:353265", "doitt:360993",
      "doitt:364273", "doitt:365764", "doitt:36922", "doitt:37170", "doitt:372755",
      "doitt:373902", "doitt:374636", "doitt:375025", "doitt:377010", "doitt:381141",
      "doitt:383893", "doitt:399990", "doitt:407018", "doitt:412072", "doitt:418207",
      "doitt:420075", "doitt:421971", "doitt:428362", "doitt:440180", "doitt:443409",
      "doitt:447981", "doitt:44827", "doitt:450560", "doitt:453302", "doitt:473907",
      "doitt:487836", "doitt:501878", "doitt:513787", "doitt:525090", "doitt:528581",
      "doitt:547528", "doitt:555676", "doitt:559204", "doitt:563161", "doitt:572887",
      "doitt:574826", "doitt:594251", "doitt:60572", "doitt:623314", "doitt:624434",
      "doitt:631125", "doitt:645311", "doitt:664715", "doitt:665924", "doitt:674326",
      "doitt:678033", "doitt:684855", "doitt:688120", "doitt:688158", "doitt:688202",
      "doitt:688213", "doitt:709441", "doitt:720315", "doitt:743834", "doitt:749711",
      "doitt:749752", "doitt:754187", "doitt:755561", "doitt:777515", "doitt:787935",
      "doitt:800671", "doitt:803147", "doitt:804055", "doitt:812305", "doitt:817527",
      "doitt:830782", "doitt:842122", "doitt:850090", "doitt:852472", "doitt:88101",
      "doitt:91300", "doitt:941537", "doitt:945838", "doitt:97522", "doitt:98082",
      "doitt:98363", "doitt:996627", "doitt:996629", "doitt:996630", "doitt:996631",
      "doitt:996632", "doitt:996636", "doitt:996688", "doitt:996689", "doitt:996746",
    ],
  },
  approvalRef: "Issue #15 gate approval 2026-08-11",
  rolledBackReleaseId: null,
  predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: "manhattan-midtown-core-cells-20260811" },
} as const;

/**
 * The rollback target a V3 withdrawal exports: the V2 record above, plus the one
 * statement a withdrawal has to make. Built FROM that record rather than
 * retyped, so the two can never disagree about which bytes V2 was.
 */
export const MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK: ExteriorDefaultActivationEnabled = {
  ...MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION,
  rolledBackReleaseId: "manhattan-midtown-core-cells-20260811-v3",
} as const;

/**
 * Rollback: export `MIDTOWN_CORE_EXTERIOR_ACTIVATION.predecessor` from here.
 *
 * The Midtown-core wave on its SECOND promotion, onto the footprint-faithful V3
 * grammar. Unlike Block 835, this promotion DOES carry availability drift, and
 * the drift is stated rather than smoothed over: the same three renderable cells
 * own the same 160 buildings, but the V3 grammar refuses four sourced polygons
 * it cannot carry — `doitt:88101` and `doitt:749711` exceed the 64-vertex ring
 * limit, `doitt:399990` and `doitt:555676` carry a sourced height below one
 * floor — so 156 buildings ship geometry and those four ship as explicit
 * `unavailable` details naming their refusal. A building the successor cannot
 * honestly draw is withdrawn; none is invented.
 *
 * `exterior-midtown-v3-promotion-record.test.ts` recomputes every pin below from
 * the committed `data/midtown-core-20260811-v3/payload-inventory.json` on every
 * run — no payload directory required, so the drift gate is never skipped.
 */
export const MIDTOWN_CORE_EXTERIOR_ACTIVATION: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "manhattan-midtown-core-cells-20260811-v3",
  snapshotId: "snapshot:manhattan-midtown-core-cells-20260811-v3:v1",
  snapshotChecksumSha256: "638be88afb71f3d761af58ccf901c5f375643e9df100d8968549e20f870c167e",
  assemblyPackageIds: ["assembly:manhattan-midtown-core-cells-20260811-v3:v1"],
  membership: {
    cells: [],
    cellsDigestSha256: "60e0ddaa6276acd3c462f6567fe8bf307455bb3222adccca6e9810e8c1a62273",
    cellCount: 149,
    buildingIds: [
      "doitt:1001111", "doitt:105916", "doitt:1104532", "doitt:1105839", "doitt:1106429",
      "doitt:1111726", "doitt:1114625", "doitt:1115013", "doitt:1116162", "doitt:111690",
      "doitt:1117425", "doitt:1158178", "doitt:1191064", "doitt:1195535", "doitt:1215127",
      "doitt:1221493", "doitt:1224763", "doitt:1232671", "doitt:1256080", "doitt:1260400",
      "doitt:1262786", "doitt:1263464", "doitt:1264335", "doitt:1268457", "doitt:1268463",
      "doitt:1268618", "doitt:1272399", "doitt:127864", "doitt:1279525", "doitt:1279526",
      "doitt:1279527", "doitt:1281874", "doitt:1282695", "doitt:1285662", "doitt:1286246",
      "doitt:1287486", "doitt:1288650", "doitt:1289963", "doitt:1289964", "doitt:1294316",
      "doitt:1295112", "doitt:1296496", "doitt:1297513", "doitt:1299442", "doitt:1299576",
      "doitt:1300185", "doitt:1302197", "doitt:1302589", "doitt:139071", "doitt:157592",
      "doitt:162071", "doitt:166790", "doitt:174372", "doitt:181184", "doitt:194068",
      "doitt:196987", "doitt:225670", "doitt:227702", "doitt:228631", "doitt:229752",
      "doitt:241646", "doitt:246449", "doitt:260361", "doitt:261397", "doitt:275393",
      "doitt:297071", "doitt:297390", "doitt:29844", "doitt:316002", "doitt:317859",
      "doitt:328864", "doitt:347215", "doitt:348074", "doitt:353265", "doitt:360993",
      "doitt:364273", "doitt:365764", "doitt:36922", "doitt:37170", "doitt:372755",
      "doitt:373902", "doitt:374636", "doitt:375025", "doitt:377010", "doitt:381141",
      "doitt:383893", "doitt:407018", "doitt:412072", "doitt:418207", "doitt:420075",
      "doitt:421971", "doitt:428362", "doitt:440180", "doitt:443409", "doitt:447981",
      "doitt:44827", "doitt:450560", "doitt:453302", "doitt:473907", "doitt:487836",
      "doitt:501878", "doitt:513787", "doitt:525090", "doitt:528581", "doitt:547528",
      "doitt:559204", "doitt:563161", "doitt:572887", "doitt:574826", "doitt:594251",
      "doitt:60572", "doitt:623314", "doitt:624434", "doitt:631125", "doitt:645311",
      "doitt:664715", "doitt:665924", "doitt:674326", "doitt:678033", "doitt:684855",
      "doitt:688120", "doitt:688158", "doitt:688202", "doitt:688213", "doitt:709441",
      "doitt:720315", "doitt:743834", "doitt:749752", "doitt:754187", "doitt:755561",
      "doitt:777515", "doitt:787935", "doitt:800671", "doitt:803147", "doitt:804055",
      "doitt:812305", "doitt:817527", "doitt:830782", "doitt:842122", "doitt:850090",
      "doitt:852472", "doitt:91300", "doitt:941537", "doitt:945838", "doitt:97522",
      "doitt:98082", "doitt:98363", "doitt:996627", "doitt:996629", "doitt:996630",
      "doitt:996631", "doitt:996632", "doitt:996636", "doitt:996688", "doitt:996689",
      "doitt:996746",
    ],
  },
  approvalRef: "Issue #44 gate approval 2026-08-11 (T026 P3 Midtown V3 promotion)",
  rolledBackReleaseId: null,
  predecessor: MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK,
} as const;

/**
 * The ordered promotion set this build activates, oldest wave first.
 *
 * Waves are COMPOSED from their own records instead of being copied into a
 * second, independently editable constant: each wave keeps exactly one record
 * and exactly one rollback edit, and composing here means the set can never
 * disagree with the record that edit actually swapped. The records arrive as
 * parameters rather than as reads of this module's own bindings, so a caller
 * holding a record — a build that rolled one back, or a rollback rehearsal —
 * orders precisely the record it holds.
 */
export function exteriorDefaultActivations(
  blockEight35: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
  midtownCore: ExteriorDefaultActivationRecord = MIDTOWN_CORE_EXTERIOR_ACTIVATION,
): readonly ExteriorDefaultActivationRecord[] {
  return [blockEight35, midtownCore];
}

/** The composed set, for callers with no substituted record of their own. */
export const EXTERIOR_DEFAULT_ACTIVATIONS: readonly ExteriorDefaultActivationRecord[] = exteriorDefaultActivations();

/**
 * One record or a whole set. Every per-record rule below reads the same way for
 * both, so a single-wave caller never has to know the set exists.
 */
export type ExteriorDefaultActivationRecords = ExteriorDefaultActivationRecord | readonly ExteriorDefaultActivationRecord[];

function activationRecordList(input: ExteriorDefaultActivationRecords): readonly ExteriorDefaultActivationRecord[] {
  return Array.isArray(input) ? input as readonly ExteriorDefaultActivationRecord[] : [input as ExteriorDefaultActivationRecord];
}

/**
 * URL intent, kept distinct from the resolved activation it feeds.
 *
 * `"off"` is a user's explicit disable. `"off-unpinned"` is the *parse* failing
 * closed on an `exteriorCells` value this build does not pin: no exterior wave
 * either, but nobody switched anything off, so it must not be reported as if
 * somebody had.
 */
export type ExteriorStreamingOverride = "on" | "off" | "off-unpinned" | null;

/** Every override value that means "no exterior wave", however it was reached. */
export function exteriorStreamingOverrideDisables(override: ExteriorStreamingOverride): boolean {
  return override === "off" || override === "off-unpinned";
}

/**
 * Refusal rule for a rolled-back release. An explicit opt-in link naming the
 * release this build withdrew resolves to nothing at all: the withdrawn bytes
 * are still on disk and still pinned by the allowlist, so without this the
 * rollback would only have removed the *default* while every promotion-era
 * bookmark kept rendering the withdrawn wave — and rendering it ungated, since
 * the pin and identity gates verify against a record that no longer accepts it.
 *
 * The rule is PER WAVE: one withdrawn record refuses opt-ins into ITS release
 * and says nothing about the other waves, which keep streaming. A build with
 * several waves therefore rolls one back without withdrawing the rest.
 */
export function exteriorRolledBackReleaseNotice(
  explicitReleaseId: string | null,
  records: ExteriorDefaultActivationRecords = EXTERIOR_DEFAULT_ACTIVATION,
): string | null {
  if (explicitReleaseId === null) return null;
  for (const record of activationRecordList(records)) {
    // Read on BOTH shapes. A wave rolled back to base states its withdrawal on a
    // disabled record; a wave rolled back to its own previous verified release
    // states it on the enabled predecessor that became the default again. The
    // link has to fail closed either way.
    const withdrawn = record.rolledBackReleaseId ?? null;
    if (withdrawn === null || explicitReleaseId !== withdrawn) continue;
    return `Exterior streaming release ${withdrawn} was rolled back in this build, so this link streamed no exterior geometry; no substitute exterior release was selected.`;
  }
  return null;
}

/**
 * Whether turning streaming back on in this session is the promoted default
 * returning, rather than an explicit opt-in. Used by the toggle: re-enabling
 * with an explicit release equal to the promoted release would serialize a
 * release id into a default-on session's links, and — before the resolver also
 * gated explicitly-named promoted releases — skipped both promotion gates.
 */
export function restoresPromotedDefault(input: {
  targetReleaseId: string;
  activeRealBaseReleaseId: string | null;
  record?: ExteriorDefaultActivationRecords;
}): boolean {
  if (input.activeRealBaseReleaseId === null) return false;
  return activationRecordList(input.record ?? EXTERIOR_DEFAULT_ACTIVATION)
    .some((record) => record.enabled && input.targetReleaseId === record.releaseId);
}

export interface ExteriorActivationInput {
  /** `"on"`/`"off"` come from an explicit URL parameter or the Disable toggle. */
  override: ExteriorStreamingOverride;
  /** A pinned release named by `exteriorCells`; `null` means "no URL opinion". */
  explicitReleaseId: string | null;
  /** Non-null only while a compatible real base release is genuinely active. */
  activeRealBaseReleaseId: string | null;
  /** The pre-promotion default release (the synthetic fixture package). */
  fallbackReleaseId: string;
  record?: ExteriorDefaultActivationRecord;
}

export interface ExteriorActivationResolution {
  /** Whether a load should be attempted at all. */
  streaming: boolean;
  /** The release a load would target. Meaningful only when `streaming`. */
  releaseId: string;
  /**
   * True whenever the release being streamed IS the promoted release, however
   * it was selected. The promotion gates key off this, so an explicit link that
   * happens to name the promoted release is verified against the accepted pin
   * and membership too, rather than borrowing the promotion's identity while
   * skipping its acceptance.
   */
  promotedDefault: boolean;
  reason:
    | "url-disabled"
    /** The parse failed closed on an unpinned `exteriorCells` value. */
    | "url-unpinned-release"
    /** An explicit opt-in into the release this build rolled back. */
    | "rolled-back-release"
    | "url-explicit"
    | "promoted-default"
    /** A named release with no on/off override; not reachable from a URL. */
    | "explicit-release"
    | "no-real-base"
    | "not-promoted";
}

/**
 * The promotion gate. A promoted default activates ONLY over an active
 * compatible real base: a fixture-mode session has no base identity to anchor
 * exterior cells to, so it stays exterior-quiet rather than attempting a load it
 * would have to fail loudly. Explicit URL/toggle intent still wins in both
 * directions, which keeps every pre-promotion deep link behaving as it did.
 */
export function resolveExteriorActivation(input: ExteriorActivationInput): ExteriorActivationResolution {
  const record = input.record ?? EXTERIOR_DEFAULT_ACTIVATION;
  const promotable = record.enabled && input.activeRealBaseReleaseId !== null;
  const releaseId = input.explicitReleaseId ?? (promotable && record.enabled ? record.releaseId : input.fallbackReleaseId);
  // Streaming the promoted release is streaming the promoted release, whoever
  // named it, so the gates apply to an explicit opt-in into it as well.
  const promotedDefault = record.enabled && releaseId === record.releaseId;
  if (exteriorStreamingOverrideDisables(input.override)) {
    return { streaming: false, releaseId, promotedDefault: false, reason: input.override === "off-unpinned" ? "url-unpinned-release" : "url-disabled" };
  }
  if (exteriorRolledBackReleaseNotice(input.explicitReleaseId, record) !== null) {
    return { streaming: false, releaseId, promotedDefault: false, reason: "rolled-back-release" };
  }
  if (input.override === "on") return { streaming: true, releaseId, promotedDefault, reason: "url-explicit" };
  if (promotable) return { streaming: true, releaseId, promotedDefault, reason: input.explicitReleaseId === null ? "promoted-default" : "explicit-release" };
  return { streaming: false, releaseId, promotedDefault: false, reason: record.enabled ? "no-real-base" : "not-promoted" };
}

/** One record's resolution, carrying the record that governed it. */
export interface ExteriorReleaseActivation extends ExteriorActivationResolution {
  record: ExteriorDefaultActivationRecord;
}

export interface ExteriorActivationSetInput {
  override: ExteriorStreamingOverride;
  explicitReleaseId: string | null;
  activeRealBaseReleaseId: string | null;
  fallbackReleaseId: string;
  records?: readonly ExteriorDefaultActivationRecord[];
}

export interface ExteriorActivationSetResolution {
  /** One resolution per promotion record, in the set's order. */
  releases: readonly ExteriorReleaseActivation[];
  /** The releases a load should actually target, deduplicated, in set order. */
  targets: readonly ExteriorReleaseActivation[];
  /** Whether ANY wave streams. */
  streaming: boolean;
  /**
   * The release explicit intent serializes and the toggle re-pins. It is the
   * first record's resolved release, which for a one-wave build is exactly the
   * single release this session resolved.
   *
   * It is the URL-SERIALIZATION primary and NOT necessarily a streaming
   * release: a disabled or non-promotable session still resolves one so a link
   * write and a re-enable have something to name. Read `targets` (or
   * `streaming`) to find out what is actually loading; using this as "the
   * release being streamed" would report a release that is switched off.
   */
  primaryReleaseId: string;
}

/** A build that promoted nothing has no wave to activate and none to refuse. */
const NO_PROMOTION: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: null };

/**
 * Set-level resolution. Two URL rules, stated here because they are what makes
 * a multi-wave default set safe to link to:
 *
 * 1. `exteriorStreaming=off` (and the unpinned-parse variant) disables ALL
 *    default waves. "Off" has never meant "off except the ones you did not
 *    know about", and a session that switched exteriors off must not keep
 *    streaming one because a second wave was promoted later.
 * 2. `exteriorCells=X` means EXACTLY release X and nothing else. Explicit
 *    intent replaces the whole default set rather than adding to it: a link
 *    naming one release must render that release, not that release plus
 *    whatever else this build happens to promote, or the link would stop
 *    meaning what it said the day it was taken.
 *
 * Under rule 2 the governing record is the one that CLAIMS X — the enabled
 * record that publishes it, or the withdrawn record that rolled it back — so a
 * promotion-era bookmark into a wave this build withdrew is refused by that
 * wave's own record while the other waves stay enabled.
 */
export function resolveExteriorActivationSet(input: ExteriorActivationSetInput): ExteriorActivationSetResolution {
  const records = input.records ?? EXTERIOR_DEFAULT_ACTIVATIONS;
  let releases: readonly ExteriorReleaseActivation[];
  if (input.explicitReleaseId === null) {
    releases = records.map((record) => ({ ...resolveExteriorActivation({ ...input, record }), record }));
  } else {
    // A record that PUBLISHES X governs X ahead of any record that withdrew X.
    // The two cannot both be true of one release in a valid set, and stating the
    // precedence keeps the resolution deterministic rather than order-dependent.
    const claiming = records.find((record) => record.enabled && record.releaseId === input.explicitReleaseId)
      ?? records.find((record) => (record.rolledBackReleaseId ?? null) === input.explicitReleaseId)
      ?? records[0] ?? NO_PROMOTION;
    releases = [{ ...resolveExteriorActivation({ ...input, record: claiming }), record: claiming }];
  }
  // Records that cannot promote all resolve the same fallback release, so the
  // target list is deduplicated: an enabled-by-override fixture session must
  // load one runtime, not one per promotion record.
  const seen = new Set<string>();
  const targets: ExteriorReleaseActivation[] = [];
  for (const entry of releases) {
    if (!entry.streaming || seen.has(entry.releaseId)) continue;
    seen.add(entry.releaseId);
    targets.push(entry);
  }
  return {
    releases,
    targets,
    streaming: targets.length > 0,
    primaryReleaseId: releases[0]?.releaseId ?? input.explicitReleaseId ?? input.fallbackReleaseId,
  };
}

export interface ExteriorPinVerificationInput {
  releaseId: string;
  snapshotId: string;
  snapshotChecksumSha256: string;
  assemblyPackageIds: readonly string[];
  cells: readonly ExteriorAcceptedCell[];
  /**
   * `exteriorAcceptedCellsDigest(cells)`, computed by the caller because Web
   * Crypto is async and this gate is not. A digest-form record with no digest
   * here fails closed rather than skipping the membership comparison.
   */
  cellsDigestSha256?: string | null;
}

export type ExteriorPinVerification = { ok: true } | { ok: false; message: string };

/**
 * Acceptance gate for the promoted default: the release the runtime actually
 * resolved must be the accepted hashes and the accepted cell membership, or
 * nothing renders. This never "repairs" a mismatch and never substitutes a
 * same-named release that resolved different bytes.
 */
export function verifyPromotedExteriorPin(
  resolved: ExteriorPinVerificationInput,
  record: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
): ExteriorPinVerification {
  if (!record.enabled) {
    return { ok: false, message: "Exterior streaming is not promoted in this build, so no promoted pin could be verified; no substitute release was selected." };
  }
  const mismatch = (field: string, expected: string, actual: string) => ({
    ok: false as const,
    message: `Exterior streaming failed closed: the promoted default resolved ${field} ${actual}, but this build accepted ${expected} (${record.approvalRef}). No exterior geometry was rendered and no substitute release was selected.`,
  });
  if (resolved.releaseId !== record.releaseId) return mismatch("release", record.releaseId, resolved.releaseId);
  if (resolved.snapshotId !== record.snapshotId) return mismatch("snapshot", record.snapshotId, resolved.snapshotId);
  if (resolved.snapshotChecksumSha256 !== record.snapshotChecksumSha256) return mismatch("snapshot checksum", record.snapshotChecksumSha256, resolved.snapshotChecksumSha256);
  const expectedPackages = [...record.assemblyPackageIds].sort().join(", ");
  const actualPackages = [...resolved.assemblyPackageIds].sort().join(", ");
  if (expectedPackages !== actualPackages) return mismatch("assembly packages", expectedPackages, actualPackages);
  // Count first: a truncated or padded resolve is named as such instead of
  // producing an unreadable diff of two long joins.
  if (resolved.cells.length !== record.membership.cellCount) {
    return mismatch("cell count", String(record.membership.cellCount), String(resolved.cells.length));
  }
  if (record.membership.cellsDigestSha256 === null) {
    const expectedCells = exteriorAcceptedCellsJoin(record.membership.cells);
    const actualCells = exteriorAcceptedCellsJoin(resolved.cells);
    if (expectedCells !== actualCells) return mismatch("cell membership", expectedCells, actualCells);
    return { ok: true };
  }
  // Digest form. The caller recomputes the digest from what the runtime
  // actually resolved; a caller that did not compute one has not verified
  // membership at all, so this is a failure, never a pass by omission.
  if (typeof resolved.cellsDigestSha256 !== "string" || resolved.cellsDigestSha256.length === 0) {
    return {
      ok: false,
      message: `Exterior streaming failed closed: release ${record.releaseId} states its accepted cell membership as a digest, but no digest was computed for the resolved cells, so membership was never verified (${record.approvalRef}). No exterior geometry was rendered and no substitute release was selected.`,
    };
  }
  if (resolved.cellsDigestSha256 !== record.membership.cellsDigestSha256) {
    return mismatch("cell membership digest", record.membership.cellsDigestSha256, resolved.cellsDigestSha256);
  }
  return { ok: true };
}

/**
 * Identity gate for what actually reached the scene. Rendered exterior assets
 * reuse canonical base building identities, so an identity outside the accepted
 * membership means the resolved bytes are not the accepted wave. A cell that
 * degraded to base massing renders no asset and is reported by the existing
 * per-cell notices, so an empty set is not a mismatch here.
 */
export function verifyPromotedExteriorMembership(
  renderedFeatureIds: readonly string[],
  record: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
): ExteriorPinVerification {
  if (!record.enabled) {
    return { ok: false, message: "Exterior streaming is not promoted in this build, so no promoted membership could be verified; no substitute release was selected." };
  }
  const accepted = new Set(record.membership.buildingIds);
  const unexpected = [...new Set(renderedFeatureIds)].filter((featureId) => !accepted.has(featureId)).sort();
  if (unexpected.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Exterior streaming failed closed: the promoted default rendered ${unexpected.join(", ")}, which the accepted membership of release ${record.releaseId} (${record.approvalRef}) does not contain. No exterior geometry was rendered and no substitute release was selected.`,
  };
}

export interface ExteriorUnavailableInput {
  /** Whether THIS wave is streaming. Another wave streaming says nothing here. */
  streaming: boolean;
  override: ExteriorStreamingOverride;
  activeRealBaseReleaseId: string | null;
  /** A pinned release the URL named, so a refused opt-in can say why. */
  explicitReleaseId?: string | null;
  record?: ExteriorDefaultActivationRecord;
}

/**
 * Explicit-unavailable rule. When a real base is active and the exterior wave is
 * not, the details panel says so in words instead of letting the exterior
 * section silently disappear. Fixture-mode sessions stay quiet: they never
 * claimed an exterior wave, so there is nothing to report as missing.
 */
export function exteriorUnavailableDetail(input: ExteriorUnavailableInput): string | null {
  const record = input.record ?? EXTERIOR_DEFAULT_ACTIVATION;
  if (input.streaming || input.activeRealBaseReleaseId === null) return null;
  const rolledBack = exteriorRolledBackReleaseNotice(input.explicitReleaseId ?? null, record);
  if (rolledBack) return `${rolledBack} Base massing from release ${input.activeRealBaseReleaseId} is shown.`;
  if (input.override === "off") {
    return `Exterior streaming is switched off for this session, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  // A typo in a link is not a session the user switched off, and saying so
  // would send them looking for a toggle they never touched.
  if (input.override === "off-unpinned") {
    return `The exterior release this link named is not pinned by this build, so exterior streaming stayed off and base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  if (!record.enabled) {
    // Name WHICH wave: with more than one promoted wave, "the exterior wave"
    // would leave the reader unable to tell which one this build withdrew.
    return `The ${record.rolledBackReleaseId ?? "promoted"} exterior wave is not active in this build, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  return null;
}

/**
 * The explicit-unavailable rule across the whole set: one statement per wave
 * that is not streaming, deduplicated because the session-wide reasons ("you
 * switched exteriors off", "this link named an unpinned release") are true of
 * every wave at once and must not be repeated once per promotion record.
 */
export function exteriorUnavailableStatements(input: {
  set: ExteriorActivationSetResolution;
  override: ExteriorStreamingOverride;
  activeRealBaseReleaseId: string | null;
  explicitReleaseId?: string | null;
}): readonly string[] {
  const seen = new Set<string>();
  const statements: string[] = [];
  for (const entry of input.set.releases) {
    const statement = exteriorUnavailableDetail({
      streaming: entry.streaming,
      override: input.override,
      activeRealBaseReleaseId: input.activeRealBaseReleaseId,
      explicitReleaseId: input.explicitReleaseId ?? null,
      record: entry.record,
    });
    if (statement === null || seen.has(statement)) continue;
    seen.add(statement);
    statements.push(statement);
  }
  return statements;
}
