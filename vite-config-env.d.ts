/**
 * Minimal ambient declarations for the Node surface `vite.config.ts` uses.
 *
 * This repository deliberately does not depend on `@types/node` (see the sibling
 * `src/node-fs.d.ts` and `src/node-child-process.d.ts`), so each config or
 * script file declares exactly the surface it touches and nothing else.
 */
declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "node:path" {
  export function resolve(...parts: string[]): string;
  export const sep: string;
}

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string;
};
