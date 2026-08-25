declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
  /** Regeneration surface for committed evidence reports; tests only. */
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export interface NodeDirectoryEntry {
    name: string;
    /** Directory containing the entry, expressed relative to the path passed in. */
    parentPath: string;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { recursive: true; withFileTypes: true }): NodeDirectoryEntry[];
}
