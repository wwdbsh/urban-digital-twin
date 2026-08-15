/**
 * The wave-pipeline ARGUMENT GUARD.
 *
 * ## Why this exists
 *
 * The four wave pipelines each parsed their own arguments with
 * `const stage = requested[0] ?? "all"`. That default is the defect: a bare
 * invocation, and any invocation whose only tokens are flags, resolves to
 * `all` — the whole five-stage pipeline, hours of generation, writing into the
 * payload and record roots. `node scripts/southern-remainder-cli.mjs --help`
 * therefore did not print help; it STARTED A REAL RUN. That happened during
 * T002 (killed immediately, no artifact damage, disclosed in the implementation
 * record and in ADR 0047).
 *
 * An operator pipeline that runs on the argument an operator types when they do
 * not know what to type is a fail-open default in the one place these scripts
 * are least allowed one. This module replaces it with a fail-closed one:
 *
 *   - a bare invocation prints usage and exits 1, running nothing;
 *   - an unknown token, an unknown flag, an unknown stage and an unknown
 *     variant all do the same;
 *   - `all` still means all, and still has to be TYPED.
 *
 * It decides and returns; it prints and exits nothing. That split is what lets
 * the whole grammar be tested without spawning a process, and it is why the
 * caller does the `process.exit`.
 *
 * It is shared by the four pipelines so the grammar cannot drift into four
 * slightly different grammars, which is how the original default survived
 * unnoticed in four files.
 */

/** Flags every wave pipeline accepts. Anything else is refused. */
const KNOWN_FLAGS = new Set(["--force", "--release"]);
const HELP_FLAGS = new Set(["--help", "-h", "help"]);

/**
 * @param {{ script: string, argv: readonly string[], stages: readonly string[], variants: readonly string[], defaultVariant: string, variantStages?: Record<string, readonly string[]> }} options
 * @returns {{ ok: true, stage: string, variantId: string, force: boolean } | { ok: false, reason: string, usage: string }}
 */
export function parseWaveCliArguments(options) {
  const { script, argv, stages, variants, defaultVariant, variantStages } = options;
  const usage = [
    `usage: node ${script} <${[...stages, "all"].join("|")}> [--release ${variants.join("|")}] [--force]`,
    "",
    "The stage is REQUIRED. There is no default stage: a bare invocation used to run the",
    "entire pipeline, which is hours of generation started by typing nothing.",
  ].join("\n");
  const refuse = (reason) => ({ ok: /** @type {const} */ (false), reason: `${script}: ${reason}`, usage });

  if (argv.some((token) => HELP_FLAGS.has(token))) return refuse("help requested; nothing was run.");

  const positional = [];
  let variantId = defaultVariant;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) { positional.push(token); continue; }
    if (!KNOWN_FLAGS.has(token)) return refuse(`unknown flag ${token}.`);
    if (token === "--force") { force = true; continue; }
    // `--release` consumes its value, so the value can never be mistaken for a
    // stage — which is how a mistyped release id used to become a bare run.
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) return refuse("--release requires a value.");
    variantId = value;
    index += 1;
  }

  if (positional.length === 0) return refuse("a stage is required.");
  if (positional.length > 1) return refuse(`expected one stage, received ${positional.length}: ${positional.join(", ")}.`);
  const stage = positional[0];
  if (stage !== "all" && !stages.includes(stage)) return refuse(`unknown stage ${stage}; expected one of ${stages.join(", ")} or all.`);
  if (!variants.includes(variantId)) return refuse(`unknown release variant ${variantId}; expected one of ${variants.join(", ")}.`);
  const allowed = variantStages?.[variantId];
  if (stage !== "all" && allowed && !allowed.includes(stage)) return refuse(`the ${variantId} variant does not run stage ${stage}; it runs ${allowed.join(", ")}.`);

  return { ok: true, stage, variantId, force };
}

/**
 * The caller side of the guard, in one line, so four pipelines cannot each
 * decide differently what a refusal means. Exits 1 without touching a receipt,
 * a payload root or a record root.
 *
 * @param {ReturnType<typeof parseWaveCliArguments>} parsed
 * @param {{ error: (message: string) => void, exit: (code: number) => never }} io
 */
export function requireWaveCliArguments(parsed, io) {
  if (parsed.ok) return parsed;
  io.error(parsed.reason);
  io.error(parsed.usage);
  return io.exit(1);
}
