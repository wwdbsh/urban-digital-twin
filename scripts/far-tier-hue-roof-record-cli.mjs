/* global console, process */
/**
 * T013 ROOF STAGE — record emission.
 *
 * The roof term, measured by the same variant method that isolated the wall
 * absorption term, and the residual that survives once BOTH palette terms are
 * equalised. Numbers below were produced by the pinned instrument through
 * Blender MCP and are transcribed here so the record is emitted by code; every
 * render is digested from disk by this run.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-hue-roof-record-cli.mjs emit
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));

/** Measured over the SOURCE-and-V1-TILE intersection, un-premultiplied — the baseline domain. */
const MEASURED = [
  { pose: "400/55", d: 400, az: 55, intersectionPixels: 61862, unionPixels: 63724,
    v1Spread: 0.015976, roofAggSpread: 0.019756, residualSpread: 0.006848, absorbedResidualSpread: 0.009580,
    roofAggRatios: [1.031889, 1.036717, 1.051646], residualRatios: [0.978204, 0.982216, 0.985051],
    sourceLum: 0.21577073, v1Lum: 0.22449938, roofAggLum: 0.22743646,
    roofEnergyChange: 0.01509595, roofPixelsMoved: 23831, wallEnergyChange: 0.04806873,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
  { pose: "400/235", d: 400, az: 235, intersectionPixels: 58950, unionPixels: 60355,
    v1Spread: 0.025772, roofAggSpread: 0.035490, residualSpread: 0.025227, absorbedResidualSpread: 0.029089,
    roofAggRatios: [1.039664, 1.056135, 1.075154], residualRatios: [1.003062, 1.028289, 1.018451],
    sourceLum: 0.03766457, v1Lum: 0.0384144, roofAggLum: 0.04076391,
    roofEnergyChange: 0.06778047, roofPixelsMoved: 21429, wallEnergyChange: 0.00197256,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
  { pose: "1200/55", d: 1200, az: 55, intersectionPixels: 5801, unionPixels: 5964,
    v1Spread: 0.020627, roofAggSpread: 0.024554, residualSpread: 0.012542, absorbedResidualSpread: 0.015413,
    roofAggRatios: [1.017059, 1.024954, 1.041614], residualRatios: [0.962446, 0.971150, 0.974988],
    sourceLum: 0.20999704, v1Lum: 0.21486603, roofAggLum: 0.21764579,
    roofEnergyChange: 0.01462020, roofPixelsMoved: 2931, wallEnergyChange: 0.04734096,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
  { pose: "1200/235", d: 1200, az: 235, intersectionPixels: 5787, unionPixels: 5918,
    v1Spread: 0.025436, roofAggSpread: 0.034809, residualSpread: 0.022258, absorbedResidualSpread: 0.026034,
    roofAggRatios: [1.030635, 1.046894, 1.065444], residualRatios: [0.981088, 1.003346, 0.994642],
    sourceLum: 0.0394298, v1Lum: 0.03951768, roofAggLum: 0.0420953,
    roofEnergyChange: 0.07290602, roofPixelsMoved: 2798, wallEnergyChange: 0.00000001,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
  { pose: "4000/55", d: 4000, az: 55, intersectionPixels: 511, unionPixels: 524,
    v1Spread: 0.022772, roofAggSpread: 0.026628, residualSpread: 0.014859, absorbedResidualSpread: 0.018400,
    roofAggRatios: [1.012973, 1.022646, 1.039601], residualRatios: [0.958597, 0.969082, 0.973456],
    sourceLum: 0.2011661, v1Lum: 0.20518705, roofAggLum: 0.20783642,
    roofEnergyChange: 0.01444806, roofPixelsMoved: 394, wallEnergyChange: 0.04623123,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
  { pose: "4000/235", d: 4000, az: 235, intersectionPixels: 507, unionPixels: 517,
    v1Spread: 0.033824, roofAggSpread: 0.043074, residualSpread: 0.027301, absorbedResidualSpread: 0.030863,
    roofAggRatios: [0.968192, 0.988577, 1.011266], residualRatios: [0.928875, 0.956175, 0.950523],
    sourceLum: 0.04217802, v1Lum: 0.03976067, roofAggLum: 0.04236494,
    roofEnergyChange: 0.07296229, roofPixelsMoved: 371, wallEnergyChange: 0.00000008,
    silhouetteControlRoof: 0, silhouetteControlBothEq: 0 },
];

/** The roof-region composition, from committed plan data. */
const ROOF_REGION = {
  capsAndDecks: { areaSquareMeters: 18390.101, albedo: [0.168555914, 0.164096374, 0.15454613], redOverBlue: 1.090651 },
  equipmentAboveCrown: { areaSquareMeters: 353.325, albedo: [0.167665204, 0.163122175, 0.153441645], redOverBlue: 1.092697 },
  rooftopMetal: { areaSquareMeters: 710.918, albedo: [0.547147437, 0.553953878, 0.554675539], redOverBlue: 0.986428 },
  wallFireEscapeMetalExcluded: { areaSquareMeters: 2384.521, albedo: [0.542275085, 0.549081525, 0.55026722], redOverBlue: 0.985476 },
};

async function digestTree(root, prefix) {
  const entries = (await readdir(root)).filter((name) => name.startsWith(prefix)).sort();
  const out = [];
  for (const name of entries) {
    const bytes = new Uint8Array(await readFile(join(root, name)));
    out.push({ name, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  return out;
}

async function emit() {
  const captureText = await readFile(join(evidenceRoot, "pinned-capture.json"), "utf8");
  const verdictText = await readFile(join(evidenceRoot, "fix-capture-verdict.json"), "utf8");
  const roofManifestText = await readFile(join(workRoot, "roof-aggregate", "manifest.json"), "utf8");
  const bothManifestText = await readFile(join(workRoot, "both-equalised-sources", "placements.json"), "utf8");
  const roofManifest = JSON.parse(roofManifestText);

  const area = ROOF_REGION.capsAndDecks.areaSquareMeters + ROOF_REGION.equipmentAboveCrown.areaSquareMeters + ROOF_REGION.rooftopMetal.areaSquareMeters;
  const sums = [0, 0, 0];
  for (const part of [ROOF_REGION.capsAndDecks, ROOF_REGION.equipmentAboveCrown, ROOF_REGION.rooftopMetal]) {
    for (let channel = 0; channel < 3; channel += 1) sums[channel] += part.areaSquareMeters * part.albedo[channel];
  }
  const aggregate = sums.map((sum) => sum / area);
  const prismRoof = [0.168071962, 0.164843082, 0.154066652];
  const lum = (triple) => 0.2126 * triple[0] + 0.7152 * triple[1] + 0.0722 * triple[2];

  const poses = MEASURED.map((row) => {
    const bracket = [Math.min(row.residualSpread, row.absorbedResidualSpread), Math.max(row.residualSpread, row.absorbedResidualSpread)];
    return {
      pose: row.pose,
      distanceMeters: row.d,
      azimuthDegrees: row.az,
      intersectionPixels: row.intersectionPixels,
      unionPixels: row.unionPixels,
      silhouetteControlRoofAggregateAgainstV1: row.silhouetteControlRoof,
      silhouetteControlBothEqualisedAgainstSource: row.silhouetteControlBothEq,
      v1ChannelSpread: row.v1Spread,
      roofAggregateChannelSpread: row.roofAggSpread,
      roofAggregatePerChannelRatios: row.roofAggRatios,
      roofTermChangeInSpread: round(row.roofAggSpread - row.v1Spread, 6),
      roofTermDirection: row.roofAggSpread > row.v1Spread ? "WORSE" : "BETTER",
      legacyBar002AfterRoofAggregate: row.roofAggSpread <= 0.02 ? "PASS" : "MISS",
      a3PrimeAfterRoofAggregate: row.roofAggSpread <= 0.032 ? "PASS" : "MISS",
      residualAfterBothPaletteTermsEqualised: row.residualSpread,
      residualPerChannelRatios: row.residualRatios,
      residualAfterWallTermOnly: row.absorbedResidualSpread,
      residualBracket: bracket.map((value) => round(value, 6)),
      trustworthyEndOfBracket: row.az === 235 ? "both-equalised (metal to roof); walls contribute essentially nothing here" : "absorbed-wall (metal to facade); walls dominate here",
      shareOfSignalTheRoofRepaintReached: round(row.roofEnergyChange, 8),
      shareOfSignalTheWallCorrectionReached: round(row.wallEnergyChange, 8),
      luminance: {
        sourceUnionMean: row.sourceLum,
        v1UnionMean: row.v1Lum,
        roofAggregateUnionMean: row.roofAggLum,
        v1Ratio: round(row.v1Lum / row.sourceLum, 6),
        roofAggregateRatio: round(row.roofAggLum / row.sourceLum, 6),
        v1AbsoluteDifference: round(row.v1Lum - row.sourceLum, 8),
        roofAggregateAbsoluteDifference: round(row.roofAggLum - row.sourceLum, 8),
        A1AfterRoofAggregate: row.az === 55 ? (Math.abs(row.roofAggLum / row.sourceLum - 1) <= 0.05 ? "PASS" : "MISS") : "not applicable",
        A2AfterRoofAggregate: Math.abs(row.roofAggLum - row.sourceLum) <= 0.01 ? "PASS" : "MISS",
      },
    };
  });

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:roof-term`,
    task: "T013",
    artifact: "far-tier-hue-roof-term-measurement",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: "THE ROOF TERM MOVES HUE THE WRONG WAY AT EVERY POSE, AND FIXES THE TONE MISS THAT HAS BLOCKED THE MASS BAKE SINCE T002. An area-correct roof aggregate widens the hue spread at all six poses — 4,000 m / azimuth 235 goes 0.033824 to 0.043074, away from 0.02 and away from 0.032 — while taking that pose's luminance ratio from 0.942687 to 1.004432. This is a trade, not a fix, and it is put to the user rather than decided here.",
    lineage: {
      attribution: `hue-attribution.json, sha256 ${sha256HexSync(await readFile(join(evidenceRoot, "hue-attribution.json"), "utf8"))}`,
      wallCapture: `pinned-capture.json, sha256 ${sha256HexSync(captureText)}`,
      wallFixVerdict: `fix-capture-verdict.json, sha256 ${sha256HexSync(verdictText)}`,
      whatThisStageAdds: "The roof half of the surface-composition attribution, by the same variant method, plus the residual after BOTH palette terms are equalised.",
    },
    theAmbiguityThatDecidedTheMethod: {
      whatWasAsked: "A roof-SUBSTITUTED source variant: the source with its roof-region materials replaced by the prism's roof colour.",
      whyItCannotBeBuilt: "At material-record granularity it is not separable. The roof caps, setback decks and roof-equipment boxes already carry `material:roof`, which IS the colour the prism bakes, so substituting that record changes nothing. The only roof-region material that differs is `material:metal` on water tanks and their legs — and the FIRE ESCAPES carry the same record while hanging on walls.",
      theSplit: "Measured before any variant was built: 710.918 square metres of metal above the crown against 2,384.521 below it. 77.03 per cent of this cell's metal is wall fire escapes.",
      whatWasBuiltInstead: "The INVERSE variant the adjudication offered: the tile's roof cap repainted, per building, with the area-correct linear-light aggregate of the roof region it stands in for. Unambiguous, and it is the quantity a fix would actually have to install.",
      refusalIsRecordedNotSilent: "This is the ambiguity the tool was told to refuse on. It refused, and the refusal is the reason the method changed.",
    },
    roofRegionComposition: {
      parts: ROOF_REGION,
      note: "wallFireEscapeMetalExcluded is listed to show what was EXCLUDED and why, not as part of the aggregate.",
      aggregateAreaSquareMeters: round(area, 3),
      aggregateAlbedoLinear: aggregate.map((value) => round(value, 9)),
      aggregateRedOverBlue: round(aggregate[0] / aggregate[2], 6),
      prismRoofCapAlbedoLinear: prismRoof,
      prismRoofCapRedOverBlue: round(prismRoof[0] / prismRoof[2], 6),
      chromaticityShift: round((aggregate[0] / aggregate[2]) / (prismRoof[0] / prismRoof[2]) - 1, 6),
      luminanceShift: round(lum(aggregate) / lum(prismRoof) - 1, 6),
      theSignQuestion: "ANSWERED BY ARITHMETIC BEFORE IT WAS RENDERED, and the render agreed. Rooftop metal reads red-over-blue 0.986428 against the roof cap's 1.090904, so aggregating the tanks and legs in makes the roof LESS RED — while the tile is already RED-DEFICIENT against the source. The aggregate is 1.17 per cent less red and 8.36 per cent brighter than the cap it replaces.",
    },
    theRoofTerm: {
      question: "Does an area-correct roof aggregate close 4,000 m / azimuth 235 toward 0.02, toward 0.032, or move it the wrong way?",
      answer: "THE WRONG WAY, at every pose, by 0.0038 to 0.0097. 4,000 m / azimuth 235 goes from 0.033824 to 0.043074 — further from both bars.",
      perPose: poses.map((pose) => ({ pose: pose.pose, v1: pose.v1ChannelSpread, afterRoofAggregate: pose.roofAggregateChannelSpread, change: pose.roofTermChangeInSpread, direction: pose.roofTermDirection })),
      poseCountWorsened: poses.filter((pose) => pose.roofTermDirection === "WORSE").length,
      andWhatItDoesToTone: "The opposite. At 4,000 m / azimuth 235 the luminance ratio goes 0.942687 to 1.004432 and the absolute difference -0.00242 to +0.00019: the 5.7 per cent darkness that has blocked the mass bake since T002 is essentially ELIMINATED. But at 400 m / azimuth 55 the ratio goes 1.040453 to 1.054069 and the absolute difference 0.00089 to 0.01167, which MISSES both A1 at 0.05 and A2 at 0.010.",
      soItIsATrade: "A roof aggregate alone buys the tone finding and costs the hue finding, and breaks two luminance bars at the near azimuth-55 pose while fixing the far azimuth-235 one. No combination of the two aggregates was captured, because that would be a second fix without adjudication.",
    },
    whatTheChangeReached: {
      why: "The wall fix missed its prediction because the model assumed the whole tile carried the substitution. The share each correction actually reaches is now MEASURED for both, as relative energy change over the tile's own silhouette.",
      perPose: poses.map((pose) => ({ pose: pose.pose, roofRepaintReached: pose.shareOfSignalTheRoofRepaintReached, wallCorrectionReached: pose.shareOfSignalTheWallCorrectionReached })),
      finding: "The two corrections reach complementary poses. The WALL correction reaches 4.6 to 4.8 per cent of the signal at azimuth 55 and 1e-8 to 0.2 per cent at azimuth 235. The ROOF repaint reaches 1.44 to 1.51 per cent at azimuth 55 and 6.8 to 7.3 per cent at azimuth 235. Azimuth 235 is roof-dominated by a factor of about five against azimuth 55, and that is now a measurement rather than an inference from the wall stage.",
      consequenceForAnyCombinedPrediction: "At the two far azimuth-235 poses the wall correction reaches 1e-8 of the signal, so a combined wall-and-roof tile would read there essentially as the roof aggregate alone: about 0.0348 and 0.0431. At azimuth 55 both corrections act and no additive prediction is offered, because the wall stage already showed that transferring a model across a change it was not built for is how a prediction bar gets missed.",
    },
    theIrreducibleResidual: {
      what: "The v1 tile against a source whose palette has been equalised on BOTH sides — walls to the facade colour the prism bakes, roof region to the roof colour it bakes. What survives is geometry.",
      perPose: poses.map((pose) => ({
        pose: pose.pose,
        bothPaletteTermsEqualised: pose.residualAfterBothPaletteTermsEqualised,
        wallTermOnly: pose.residualAfterWallTermOnly,
        bracket: pose.residualBracket,
        trustworthyEnd: pose.trustworthyEndOfBracket,
      })),
      whyABracket: "The metal record cannot be split at material-record granularity. The absorbed-wall variant sends ALL metal to facade, which is right for the 77.03 per cent on walls; the both-equalised variant sends all of it to roof, which is right for the 22.97 per cent above the crown. Each is wrong in the opposite direction and the pair BRACKETS the truth. The bracket only matters where walls are visible, so the both-equalised end is the trustworthy one at azimuth 235 and the absorbed end at azimuth 55.",
      worstPoseResidual: round(Math.max(...poses.map((pose) => pose.residualAfterBothPaletteTermsEqualised)), 6),
      worstPoseResidualBracket: [round(Math.min(...poses.map((pose) => Math.min(...pose.residualBracket))), 6), round(Math.max(...poses.map((pose) => Math.max(...pose.residualBracket))), 6)],
      readAcrossThePoses: `Taking the trustworthy end at each azimuth, the irreducible geometric residual runs ${poses.map((pose) => (pose.azimuthDegrees === 235 ? pose.residualAfterBothPaletteTermsEqualised : pose.residualAfterWallTermOnly).toFixed(6)).join(", ")} across the six poses, worst 0.027301 at 4,000 m / azimuth 235.`,
      whatABarDerivationWouldRestOn: "0.027301 at the worst pose, or 0.030863 if the less trustworthy end of the bracket is taken there. Both are ABOVE the legacy 0.02 bar and BELOW the 0.043074 an area-correct roof aggregate produces. No bar is proposed here.",
    },
    positiveControls: {
      roofAggregateTileSilhouette: "Repainting texels cannot move geometry, and it did not: 0 pixels of silhouette difference from the v1 tile at all six poses.",
      bothEqualisedSourceSilhouette: "Geometry byte-identical to the source: 0 pixels of silhouette difference at all six poses.",
      v1BaselineVerifiedBeforeEditing: `The roof variant was built on a v1 atlas re-derived and checked against the committed digest before a single texel was repainted: ${roofManifest.baseAtlasSha256}.`,
      measurementDomain: "The SOURCE-and-V1-TILE intersection, un-premultiplied, at every pose — the same pixel set as the baseline and the wall stage, so all five subjects are directly comparable.",
    },
    poses,
    instrumentation: {
      retention: "LOCAL WORK PRODUCT, gitignored. These checksums are the committed artifact.",
      roofAggregateTile: { manifestSha256: sha256HexSync(roofManifestText), atlasSha256: roofManifest.variantAtlasSha256, glbSha256: roofManifest.variantGlbSha256, repaintedFaces: roofManifest.repaintedFaces, repaintedTexels: roofManifest.repaintedTexels },
      bothEqualisedSource: { manifestSha256: sha256HexSync(bothManifestText) },
      renders: [...(await digestTree(join(workRoot, "renders"), "roofagg-")), ...(await digestTree(join(workRoot, "renders"), "botheq-"))],
    },
    notClaimedHere: [
      "NO recipe change was made. Recipe v3 is untouched and no roof recipe exists.",
      "NO combined wall-and-roof tile was captured; that would be a second fix without adjudication.",
      "The roof aggregate is a MEASUREMENT of a candidate, not a proposal.",
      "No bar is proposed, widened or adopted.",
      "EEVEE under one sun is not the shipped Cesium renderer, and one cell is one cell.",
    ],
  };

  const text = serialize(record);
  await writeFile(join(evidenceRoot, "roof-term.json"), text);
  await writeFile(join(evidenceRoot, "roof-term.sha256"), `${sha256HexSync(text)}  roof-term.json\n`);
  console.log(serialize({
    ok: true,
    roofTermChanges: poses.map((pose) => pose.roofTermChangeInSpread),
    posesWorsened: record.theRoofTerm.poseCountWorsened,
    residualTrustworthy: poses.map((pose) => (pose.azimuthDegrees === 235 ? pose.residualAfterBothPaletteTermsEqualised : pose.residualAfterWallTermOnly)),
    worstResidual: record.theIrreducibleResidual.worstPoseResidual,
    a1AfterRoof: poses.map((pose) => pose.luminance.A1AfterRoofAggregate),
    a2AfterRoof: poses.map((pose) => pose.luminance.A2AfterRoofAggregate),
    recordSha256: sha256HexSync(text),
  }));
}

const command = process.argv[2] ?? "emit";
if (command !== "emit") { console.error(`far-tier-hue-roof-record: unknown command ${command}`); process.exit(1); }
await emit();
