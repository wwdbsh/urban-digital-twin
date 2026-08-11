/**
 * Deep links must be refused by the record of the wave they name, not by
 * whichever wave the build happens to list first.
 */
import { describe, expect, it } from "vitest";
import { exteriorDeepLinkMessage } from "./App";
import { EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, exteriorDefaultActivations } from "../runtime/exterior-default-activation";

const BLOCK835 = "manhattan-exterior-cells-20260811";
const MIDTOWN = "manhattan-midtown-core-cells-20260811";
const withdrawn = (releaseId: string) => ({ enabled: false as const, releaseId: null, rolledBackReleaseId: releaseId });

describe("multi-wave exterior deep-link refusals", () => {
  it("accepts opt-in links into either promoted wave", () => {
    const promoted = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    expect(exteriorDeepLinkMessage(`/?exteriorCells=${BLOCK835}`, promoted)).toBeNull();
    expect(exteriorDeepLinkMessage(`/?exteriorCells=${MIDTOWN}`, promoted)).toBeNull();
  });

  it("refuses a link into the wave THIS build withdrew, naming that wave", () => {
    // The regression this covers: the deep-link check was still evaluated
    // against a single record, so a bookmark into a withdrawn SECOND wave was
    // accepted in silence while the resolver refused to stream it — the link
    // rendered nothing and said nothing.
    const midtownWithdrawn = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, withdrawn(MIDTOWN));
    const message = exteriorDeepLinkMessage(`/?exteriorCells=${MIDTOWN}`, midtownWithdrawn);
    expect(message).toContain(`${MIDTOWN} was rolled back in this build`);
    expect(message).toContain("no substitute exterior release was selected");
    // The surviving wave's own link is untouched.
    expect(exteriorDeepLinkMessage(`/?exteriorCells=${BLOCK835}`, midtownWithdrawn)).toBeNull();

    const blockWithdrawn = exteriorDefaultActivations(withdrawn(BLOCK835), MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    expect(exteriorDeepLinkMessage(`/?exteriorCells=${BLOCK835}`, blockWithdrawn)).toContain(`${BLOCK835} was rolled back`);
    expect(exteriorDeepLinkMessage(`/?exteriorCells=${MIDTOWN}`, blockWithdrawn)).toBeNull();
  });

  it("still names an unpinned release before any rollback rule applies", () => {
    const message = exteriorDeepLinkMessage("/?exteriorCells=manhattan-exterior-production-20270101");
    expect(message).toContain("is not pinned by this build");
    expect(message).toContain(MIDTOWN);
  });
});
