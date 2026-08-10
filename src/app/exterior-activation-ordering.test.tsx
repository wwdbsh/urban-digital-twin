/** @vitest-environment jsdom */
import { useEffect, useRef, useState } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ensureExteriorBaseIdentity, exteriorBaseIdentityHas } from "./App";

/**
 * Clean-load ordering regression for exterior activation.
 *
 * `exteriorStreamingRequested` is URL-derived and true on the first render,
 * while the citywide adapter arrives asynchronously afterwards. The activation
 * effect captured `activeAdapterRef.current`, so on a clean load it saw the
 * placeholder adapter, membership resolution no-opped, verification failed
 * `base-incompatible`, and nothing re-ran when the real adapter landed. Only a
 * manual disable/enable toggle recovered.
 *
 * This harness mirrors the effect's dependency structure rather than rendering
 * the whole App: `refCapture` reproduces the pre-fix wiring and `stateDep`
 * reproduces the fix, over the same membership helpers the App uses.
 */
interface Adapter { getFeature: (id: string) => unknown; ensureIdentityIndex?: () => Promise<number>; hasIdentityMember?: (id: string) => boolean }

const MEMBER = "doitt:102705";

/** Placeholder adapter: nothing resident, no identity surface — like the fixture at boot. */
const placeholder: Adapter = { getFeature: () => undefined };

/** Citywide adapter: nothing resident yet, but release membership is provable. */
function citywideAdapter(): Adapter {
  const index = new Set<string>();
  return {
    getFeature: () => undefined,
    ensureIdentityIndex: async () => { index.add(MEMBER); return index.size; },
    hasIdentityMember: (id: string) => index.has(id),
  };
}

function Harness({ mode, onVerified }: { mode: "refCapture" | "stateDep"; onVerified: (ok: boolean) => void }) {
  const [adapter, setAdapter] = useState<Adapter>(placeholder);
  const adapterRef = useRef<Adapter>(adapter);
  adapterRef.current = adapter;

  // The citywide adapter arrives after the first effect execution.
  useEffect(() => {
    const timer = setTimeout(() => { setAdapter(citywideAdapter()); }, 0);
    return () => { clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const active = mode === "refCapture" ? adapterRef.current : adapter;
    void ensureExteriorBaseIdentity(active).then(() => {
      if (controller.signal.aborted) return;
      onVerified(exteriorBaseIdentityHas(active, MEMBER));
    });
    return () => { controller.abort(); };
    // The dependency list is the subject under test, so it is supplied by mode.
  }, mode === "refCapture" ? [] : [adapter]);
  return null;
}

describe("exterior activation ordering on a clean load", () => {
  it("never verifies when the adapter is captured by ref (the pre-fix wiring)", async () => {
    const results: boolean[] = [];
    render(<Harness mode="refCapture" onVerified={(ok) => results.push(ok)} />);
    await waitFor(() => { expect(results.length).toBeGreaterThan(0); });
    // One attempt, against the placeholder, and no re-run when the real adapter lands.
    expect(results).toEqual([false]);
  });

  it("verifies without a manual toggle once the adapter is a dependency", async () => {
    const results: boolean[] = [];
    render(<Harness mode="stateDep" onVerified={(ok) => results.push(ok)} />);
    await waitFor(() => { expect(results.some((ok) => ok)).toBe(true); });
    // The first attempt still fails closed; the swap re-runs it and it verifies.
    expect(results[0]).toBe(false);
    expect(results.at(-1)).toBe(true);
  });
});
