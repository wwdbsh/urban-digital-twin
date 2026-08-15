/**
 * The wave-pipeline argument guard.
 *
 * The test that matters most is the first one: a bare invocation and `--help`
 * must run NOTHING. Before this guard they resolved to the `all` stage and
 * started the real five-stage pipeline, which is what happened during T002.
 */
import { describe, expect, it } from "vitest";
import { parseWaveCliArguments, requireWaveCliArguments } from "./wave-cli-arguments.mjs";

const BASE = {
  script: "scripts/southern-remainder-cli.mjs",
  stages: ["plans", "glbs", "gates", "graph", "sample"],
  variants: ["canary", "p1", "t1"],
  defaultVariant: "canary",
};

const parse = (argv, overrides = {}) => parseWaveCliArguments({ ...BASE, ...overrides, argv });

describe("the wave pipeline argument guard", () => {
  it("refuses to run anything when no stage is typed", () => {
    for (const argv of [[], ["--force"], ["--release", "p1"], ["--release", "t1", "--force"]]) {
      const parsed = parse(argv);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok === false && parsed.reason).toContain("a stage is required");
      expect(parsed.ok === false && parsed.usage).toContain("The stage is REQUIRED");
    }
  });

  it("treats every spelling of help as a refusal, never as a run", () => {
    for (const argv of [["--help"], ["-h"], ["help"], ["graph", "--help"]]) {
      const parsed = parse(argv);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok === false && parsed.reason).toContain("help requested; nothing was run");
    }
  });

  it("refuses unknown flags, unknown stages, unknown variants and extra positionals", () => {
    expect(parse(["graph", "--dry-run"]).ok).toBe(false);
    expect(parse(["graf"]).ok).toBe(false);
    expect(parse(["graph", "--release", "t9"]).ok).toBe(false);
    expect(parse(["graph", "sample"]).ok).toBe(false);
    expect(parse(["graph", "--release"]).ok).toBe(false);
    expect(parse(["graph", "--release", "--force"]).ok).toBe(false);
  });

  it("accepts exactly the invocations the pipelines document", () => {
    expect(parse(["all"])).toStrictEqual({ ok: true, stage: "all", variantId: "canary", force: false });
    expect(parse(["graph", "--force"])).toStrictEqual({ ok: true, stage: "graph", variantId: "canary", force: true });
    expect(parse(["glbs", "--release", "t1"])).toStrictEqual({ ok: true, stage: "glbs", variantId: "t1", force: false });
    expect(parse(["--release", "p1", "gates", "--force"])).toStrictEqual({ ok: true, stage: "gates", variantId: "p1", force: true });
  });

  it("keeps the per-variant stage restriction the pipelines already enforced", () => {
    const variantStages = { canary: BASE.stages, p1: BASE.stages, t1: ["graph"] };
    expect(parse(["graph", "--release", "t1"], { variantStages }).ok).toBe(true);
    const refused = parse(["plans", "--release", "t1"], { variantStages });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toContain("does not run stage plans");
  });

  it("exits 1 on a refusal without returning to the caller", () => {
    const errors = [];
    let exitCode = null;
    const io = { error: (message) => errors.push(message), exit: (code) => { exitCode = code; return undefined; } };
    requireWaveCliArguments(parse([]), io);
    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(2);
    // And a good parse is handed straight back, unchanged.
    expect(requireWaveCliArguments(parse(["all"]), io)).toStrictEqual({ ok: true, stage: "all", variantId: "canary", force: false });
  });
});
