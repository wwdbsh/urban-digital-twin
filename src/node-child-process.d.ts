/**
 * Minimal ambient declarations for the two Node built-ins the cross-process
 * determinism test needs, following the same convention as `node-fs.d.ts`:
 * declare the exact surface used rather than pull `@types/node` into a browser
 * application's type graph, where every Node global would then be in scope for
 * runtime code that must never touch one.
 *
 * The surface is deliberately narrow — one synchronous spawn and the path to
 * this interpreter — because the only caller is a test that must prove the PNG
 * encoder produces identical bytes in a FRESH process.
 */
declare module "node:child_process" {
  export function execFileSync(file: string, args: readonly string[], options: { cwd: string; encoding: "utf8" }): string;
}

declare module "node:process" {
  export const execPath: string;
  export function cwd(): string;
  /** Read-only in this codebase: the one flag that regenerates a committed evidence report. */
  export const env: Readonly<Record<string, string | undefined>>;
}
