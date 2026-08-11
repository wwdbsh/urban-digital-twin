/**
 * The tileset's root children are ordered by CANONICAL FEATURE ID, and that is
 * not the same order as their content URIs.
 *
 * `validateTileset` walks the root children in `compareText(canonicalFeatureId)`
 * order. `buildMidtownCoreRelease` sorted them by the content URI instead. The
 * two agree only while no building id is a strict PREFIX of another, because the
 * URI appends `__lod_0.glb` and `7` sorts before `_`:
 *
 *     doitt:615    < doitt:61531                    (feature id)
 *     doitt-61531__lod_0.glb < doitt-615__lod_0.glb  (content URI)
 *
 * Every release emitted before the curated `w03` successor happened to have no
 * such pair, so no frozen tileset byte moves with the fix. The 179-asset curated
 * subset is the first set that does, and the assembly replay REFUSED the emitted
 * tileset rather than shipping a chain the validator could not walk — the defect
 * failed closed, which is why this is a fix rather than an incident.
 *
 * This suite is the regression, and it is deliberately two claims: that the two
 * orders really do diverge on a prefix pair, and that they do NOT diverge for any
 * already-emitted release, which is what makes the fix byte-safe.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The comparison `multi-lod-assembly.ts` and the release builder both use. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contentUri(buildingId: string): string {
  return `../assets/${buildingId.replace(":", "-")}__lod_0.glb`;
}

function ordersAgree(buildingIds: readonly string[]): boolean {
  const byFeatureId = [...buildingIds].sort(compareText);
  const byContentUri = [...buildingIds].sort((left, right) => compareText(contentUri(left), contentUri(right)));
  return byFeatureId.every((id, index) => id === byContentUri[index]);
}

const ASSET_PATTERN = /^public\/assets\/(doitt-\d+)__lod_\d+\.glb$/u;

function idsFromInventory(path: string): string[] {
  const inventory = JSON.parse(new TextDecoder().decode(readFileSync(path))) as { files: { path: string }[] };
  const ids = new Set<string>();
  for (const file of inventory.files) {
    const match = ASSET_PATTERN.exec(file.path);
    if (match) ids.add(match[1]!.replace("doitt-", "doitt:"));
  }
  return [...ids];
}

function idsFromPayloadTree(root: string): string[] {
  const ids = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = /^(doitt-\d+)__lod_\d+\.glb$/u.exec(entry.name);
    if (match) ids.add(match[1]!.replace("doitt-", "doitt:"));
  }
  return [...ids];
}

describe("tileset child ordering", () => {
  it("diverges from content-URI order exactly when one id is a prefix of another", () => {
    expect(ordersAgree(["doitt:615", "doitt:61531"])).toBe(false);
    expect([...["doitt:615", "doitt:61531"]].sort(compareText)).toEqual(["doitt:615", "doitt:61531"]);
    expect([...["doitt:615", "doitt:61531"]].sort((l, r) => compareText(contentUri(l), contentUri(r))))
      .toEqual(["doitt:61531", "doitt:615"]);
    // No prefix relationship, no divergence — which is why this went unnoticed
    // through four releases. Note that `doitt:200` IS a prefix of `doitt:2001`,
    // so "same length" is not the condition; "no id is a prefix of another" is.
    expect(ordersAgree(["doitt:100", "doitt:2001", "doitt:399"])).toBe(true);
    expect(ordersAgree(["doitt:1", "doitt:2", "doitt:3"])).toBe(true);
    expect(ordersAgree(["doitt:200", "doitt:2001"])).toBe(false);
  });

  /**
   * The byte-safety claim for the fix, checked against every release that was
   * already emitted. If any of these diverged, changing the sort key would have
   * moved a frozen tileset checksum, and this suite would say so instead of the
   * change being discovered later by a broken pin.
   */
  it("leaves every already-emitted release's ordering unchanged", () => {
    for (const path of [
      "data/midtown-core-20260811-v3/payload-inventory.json",
      "data/lower-manhattan-20260812/payload-inventory.json",
      "data/lower-manhattan-20260812-p1/payload-inventory.json",
      "data/southern-remainder-20260812/payload-inventory.json",
    ]) {
      const ids = idsFromInventory(path);
      expect(ids.length).toBeGreaterThan(0);
      expect({ path, agree: ordersAgree(ids) }).toEqual({ path, agree: true });
    }
    // Block 835 V3 has no payload inventory; its payload tree is committed.
    const block835 = idsFromPayloadTree("public/data/manhattan-exterior-cells-20260811-v3/public/assets");
    expect(block835).toHaveLength(14);
    expect(ordersAgree(block835)).toBe(true);
  });

  it("does diverge for the curated w03 successor, which is why the fix was needed", () => {
    const ids = idsFromInventory("data/southern-remainder-20260812-p1/payload-inventory.json");
    expect(ids).toHaveLength(179);
    expect(ordersAgree(ids)).toBe(false);
    // Named, so the regression is about a real pair rather than about a count.
    expect(ids).toContain("doitt:615");
    expect(ids).toContain("doitt:61531");
  });
});
